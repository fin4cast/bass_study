import './player.css';
import type { AppPreferences } from '../storage';
import { formatMidi, type AnnotatedPosition } from '../music';
import { createPlayer, type PlaybackConfig } from '../audio/engine';

type Engine = ReturnType<typeof createPlayer>;
type Snapshot = ReturnType<Engine['getSnapshot']>;

export interface PlayerOptions {
  onPositionChange?: (id: string | null, noteIndex: number | null) => void;
  onSnapshot?: (snapshot: Snapshot) => void;
  getContextKey?: () => string;
  onPreferencesChange?: () => void;
}

/** User-facing controls for a sequence; the engine owns all musical timing. */
export function mountPlayer(container: HTMLElement, getNotes: () => readonly AnnotatedPosition[], options: PlayerOptions = {}) {
  const player = createPlayer();
  const controller = new AbortController();
  let disposed = false;
  let operationPending = false;
  let contextKey = '';
  let notes: readonly AnnotatedPosition[] = [];
  let lastPosition: string | null = null;
  let lastIndex: number | null = null;
  let forcePositionCallback = false;
  let lastAnnouncedState = '';
  let animationFrame = 0;
  let practiceElapsedMs = 0;
  let practiceClock: { at: number; runId: number; active: boolean } | null = null;

  container.classList.add('player-section');
  container.innerHTML = `
    <div class="player-heading"><div><p class="eyebrow">ПРАКТИКА ПОД РИТМ</p><h2>Послушай маршрут. Сыграй вместе.</h2></div><span class="player-scope" data-testid="player-scope"></span></div>
    <div class="player-settings">
      <label class="player-field player-bpm-field"><span>Темп, BPM</span><input type="number" min="40" max="220" step="1" value="80" aria-label="Темп, BPM" data-player="bpm"></label>
      <label class="player-field"><span>Длительность нот</span><select aria-label="Длительность нот" data-player="duration"><option value="quarter">Четверти · ¼</option><option value="eighth" selected>Восьмые · ⅛</option><option value="sixteenth">Шестнадцатые · 1/16</option></select></label>
      <label class="player-field"><span>Повтор</span><select aria-label="Повтор" data-player="repeat"><option value="once">Один проход</option><option value="infinite">По кругу</option><option value="ladder">Лестница темпа</option></select></label>
      <label class="player-check"><input type="checkbox" checked data-player="countIn" aria-label="Отсчёт перед стартом"><span>Отсчёт: 4 доли</span></label>
      <label class="player-check"><input type="checkbox" checked data-player="showPulse" aria-label="Показывать пульс"><span>Показывать пульс</span></label>
    </div>
    <div class="player-fragment">
      <span class="player-group-label">Фрагмент</span>
      <label class="player-field"><span>С ноты</span><input type="number" min="1" step="1" value="1" aria-label="Первая нота фрагмента" data-player="from"></label>
      <span class="fragment-arrow" aria-hidden="true">→</span>
      <label class="player-field"><span>По ноту</span><input type="number" min="1" step="1" value="1" aria-label="Последняя нота фрагмента" data-player="to"></label>
      <p class="player-caption" data-testid="player-fragment-caption">Обе границы включены.</p>
    </div>
    <div class="player-ladder" data-player-panel="ladder" hidden>
      <label class="player-field"><span>Начальный BPM</span><input type="number" min="40" max="220" step="1" value="60" aria-label="Начальный темп" data-player="ladderStart"></label>
      <label class="player-field"><span>Целевой BPM</span><input type="number" min="40" max="220" step="1" value="100" aria-label="Целевой темп" data-player="ladderEnd"></label>
      <label class="player-field"><span>Шаг, BPM</span><input type="number" min="1" max="180" step="1" value="5" aria-label="Шаг темпа" data-player="ladderStep"></label>
      <label class="player-field"><span>Повторов на темп</span><input type="number" min="1" max="20" step="1" value="2" aria-label="Повторов на темп" data-player="ladderRepeats"></label>
      <p class="player-caption">Темп меняется только после заданного числа проходов. Последний темп не превышает цель.</p>
    </div>
    <div class="player-metronome">
      <label class="player-check"><input type="checkbox" checked data-player="metronome" aria-label="Метроном"><span>Метроном</span></label>
      <label class="player-field"><span>Рисунок клика</span><select aria-label="Рисунок метронома" data-player="metronomeMode"><option value="all">Каждая доля</option><option value="two-four">Только 2 и 4</option><option value="gap-2-2">2 такта звук / 2 тишина</option></select></label>
      <label class="player-field"><span>Деление клика</span><select aria-label="Деление метронома" data-player="subdivision"><option value="quarter">Четверти</option><option value="eighth">Восьмые</option><option value="sixteenth">Шестнадцатые</option></select></label>
      <p class="player-caption" data-testid="player-metronome-help">Первая доля такта выделена акцентом.</p>
    </div>
    <div class="player-volumes">
      <label><span>Бас</span><input type="range" min="0" max="100" step="1" value="70" aria-label="Громкость баса" data-player="bassVolume"><output data-player-output="bassVolume">70%</output></label>
      <label><span>Клик</span><input type="range" min="0" max="100" step="1" value="50" aria-label="Громкость метронома" data-player="clickVolume"><output data-player-output="clickVolume">50%</output></label>
    </div>
    <p class="player-error" role="alert" data-testid="player-error" hidden></p>
    <p class="player-notice" role="status" data-testid="player-notice" hidden></p>
    <div class="player-transport"><div class="player-buttons"><button class="primary-button" type="button" data-player-action="start">Старт <span aria-hidden="true">▶</span></button><button class="secondary-button" type="button" data-player-action="pause" disabled>Пауза</button><button class="secondary-button" type="button" data-player-action="resume" disabled>Продолжить</button><button class="text-button" type="button" data-player-action="stop" disabled>Стоп</button></div><p class="player-shortcuts">Пробел — старт / пауза · Esc — стоп</p></div>
    <div class="player-now"><span class="player-state-dot" aria-hidden="true"></span><p data-testid="player-status" aria-live="off">Готово к практике</p><strong data-testid="player-current-note">—</strong></div>
    <p class="player-edit-help" data-testid="player-edit-help">Маршрут и ритм настраиваются до старта. Во время воспроизведения доступны темп и громкость.</p>
    <p class="sr-only" role="status" aria-live="polite" data-player-live></p>
    <p class="player-evaluation-note">Звучит эталонная последовательность. Точность твоей игры на басу не оценивается автоматически.</p>
  `;

  const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => container.querySelector<T>(`[data-player="${name}"]`)!;
  const button = (name: string) => container.querySelector<HTMLButtonElement>(`[data-player-action="${name}"]`)!;
  const element = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;

  function message(testId: 'player-error' | 'player-notice', text = '') {
    const output = element(testId);
    output.hidden = !text;
    output.textContent = text;
  }

  function number(name: string, min: number, max: number) {
    const input = field<HTMLInputElement>(name);
    const value = Number(input.value);
    if (input.value === '' || !Number.isInteger(value) || value < min || value > max) {
      input.setAttribute('aria-invalid', 'true');
      throw new RangeError(`${input.getAttribute('aria-label')}: требуется целое число от ${min} до ${max}.`);
    }
    input.setAttribute('aria-invalid', 'false');
    return value;
  }

  function configuration(): PlaybackConfig {
    const from = number('from', 1, notes.length);
    const to = number('to', 1, notes.length);
    if (from > to) throw new RangeError('Первая нота фрагмента не может быть позже последней. Обе границы включены.');
    const repeatMode = field<HTMLSelectElement>('repeat').value;
    let repeat: PlaybackConfig['repeat'] = repeatMode === 'infinite' ? 'infinite' : 'once';
    if (repeatMode === 'ladder') {
      const start = number('ladderStart', 40, 220);
      const end = number('ladderEnd', 40, 220);
      if (start > end) throw new RangeError('Целевой темп лестницы должен быть не меньше начального.');
      repeat = { kind: 'ladder', start, end, step: number('ladderStep', 1, 180), repeatsPerTempo: number('ladderRepeats', 1, 20) };
    }
    return {
      notes,
      range: { from: from - 1, toExclusive: to },
      duration: field<HTMLSelectElement>('duration').value as PlaybackConfig['duration'],
      bpm: typeof repeat === 'object' ? repeat.start : number('bpm', 40, 220),
      countIn: field<HTMLInputElement>('countIn').checked,
      repeat,
      metronome: {
        enabled: field<HTMLInputElement>('metronome').checked,
        mode: field<HTMLSelectElement>('metronomeMode').value as NonNullable<PlaybackConfig['metronome']>['mode'],
        subdivision: field<HTMLSelectElement>('subdivision').value as NonNullable<PlaybackConfig['metronome']>['subdivision'],
      },
    };
  }

  function setVolumes() {
    const bass = Number(field<HTMLInputElement>('bassVolume').value) / 100;
    const click = Number(field<HTMLInputElement>('clickVolume').value) / 100;
    player.setVolumes({ bass, click });
    container.querySelector<HTMLOutputElement>('[data-player-output="bassVolume"]')!.value = `${Math.round(bass * 100)}%`;
    container.querySelector<HTMLOutputElement>('[data-player-output="clickVolume"]')!.value = `${Math.round(click * 100)}%`;
  }

  function currentFingerprint(nextNotes: readonly AnnotatedPosition[]) {
    return `${options.getContextKey?.() ?? ''}|${nextNotes.map(note => `${note.id}/${note.midi}/${note.noteName}/${note.degree ?? ''}`).join(',')}`;
  }

  function playing(snapshot = player.getSnapshot()) {
    return ['starting', 'running', 'paused', 'finishing'].includes(snapshot.state);
  }

  function measurePractice(snapshot: Snapshot) {
    let end = snapshot.audioTime;
    if (snapshot.finishAt !== null) end = Math.min(end, snapshot.finishAt);
    if (snapshot.state === 'paused' || snapshot.state === 'stopped') {
      const boundary = [...snapshot.trace].reverse().find(event => event.runId === snapshot.runId && (event.type === 'pause' || event.type === 'stop') && event.time <= snapshot.audioTime);
      if (boundary) end = Math.min(end, boundary.time);
    }
    const latestNote = [...snapshot.trace].reverse().find(event => event.runId === snapshot.runId && event.epoch === snapshot.epoch && event.type === 'note' && event.time <= snapshot.audioTime);
    const active = ['running', 'finishing'].includes(snapshot.state) && snapshot.phase === 'practice' && latestNote !== undefined;
    if (practiceClock?.runId === snapshot.runId && practiceClock.active) practiceElapsedMs += Math.max(0, end - practiceClock.at) * 1000;
    else if (active && latestNote) practiceElapsedMs += Math.max(0, end - latestNote.time) * 1000;
    practiceClock = { at: end, runId: snapshot.runId, active };
  }

  function renderControls(snapshot: Snapshot) {
    const locked = playing(snapshot);
    const ladder = field<HTMLSelectElement>('repeat').value === 'ladder';
    const twoFour = field<HTMLSelectElement>('metronomeMode').value === 'two-four';
    const metronome = field<HTMLInputElement>('metronome').checked;
    const freeze = ['duration', 'repeat', 'countIn', 'showPulse', 'from', 'to', 'ladderStart', 'ladderEnd', 'ladderStep', 'ladderRepeats', 'metronome', 'metronomeMode', 'subdivision'];
    freeze.forEach(name => { field(name).disabled = locked; });
    field('bpm').disabled = operationPending || ladder || snapshot.state === 'finishing';
    field('metronomeMode').disabled = locked || !metronome;
    field('subdivision').disabled = locked || !metronome || twoFour;
    container.querySelector<HTMLElement>('[data-player-panel="ladder"]')!.hidden = !ladder;
    button('start').disabled = locked || operationPending || notes.length === 0;
    button('pause').disabled = !['running', 'finishing'].includes(snapshot.state) || operationPending;
    button('resume').disabled = snapshot.state !== 'paused' || operationPending;
    button('stop').disabled = !locked && snapshot.state !== 'finished';
    element('player-metronome-help').textContent = !metronome
      ? 'Метроном выключен. Эталонные ноты продолжают звучать.'
      : twoFour ? 'В режиме «2 и 4» клик звучит четвертями только на этих долях; деление не применяется.'
        : 'Первая доля такта выделена акцентом. В немых тактах внутренний счёт продолжается.';
    element('player-edit-help').textContent = locked
      ? ladder ? 'Работает лестница темпа. Чтобы менять темп, маршрут или ритм, сначала нажми «Стоп». Громкость доступна сейчас.' : 'Чтобы менять фрагмент, длительность, повторы или метроном, сначала нажми «Стоп». Темп и громкость доступны сейчас.'
      : ladder ? 'Темп воспроизведения задаёт лестница. Изменения фрагмента и ритма применятся при новом старте.' : 'Маршрут и ритм настраиваются до старта. Во время воспроизведения доступны темп и громкость.';
    if (locked && document.activeElement !== field('bpm') && !snapshot.pendingTempo) field<HTMLInputElement>('bpm').value = String(Math.round(snapshot.bpm));
    if (ladder && !locked) {
      const start = Number(field<HTMLInputElement>('ladderStart').value);
      if (Number.isInteger(start) && start >= 40 && start <= 220) field<HTMLInputElement>('bpm').value = String(start);
    }
  }

  function renderSnapshot() {
    if (disposed) return;
    const snapshot = player.getSnapshot();
    measurePractice(snapshot);
    container.dataset.playerState = snapshot.state;
    container.dataset.playerPhase = snapshot.phase;
    container.dataset.currentPosition = snapshot.positionId ?? '';
    container.dataset.noteIndex = snapshot.noteIndex === null ? '' : String(snapshot.noteIndex);
    container.dataset.currentBpm = String(snapshot.bpm);
    const labels: Record<Snapshot['state'], string> = {
      stopped: 'Готово к практике', starting: 'Подготавливаем звук…', running: snapshot.phase === 'count-in' ? 'Отсчёт' : 'Звучит последовательность', paused: snapshot.pauseReason === 'hidden' ? 'Пауза: вкладка скрывалась' : 'Пауза', finishing: 'Завершается звучание', finished: 'Проходы завершены',
    };
    const active = ['running', 'finishing'].includes(snapshot.state);
    const showPulse = field<HTMLInputElement>('showPulse').checked;
    const counter = showPulse && (active || snapshot.state === 'paused' || snapshot.state === 'finishing')
      ? ` · такт ${snapshot.bar + 1} · доля ${snapshot.beat} · повтор ${snapshot.passIndex + 1}${snapshot.totalPasses === null ? '' : ` / ${snapshot.totalPasses}`} · ${Math.round(snapshot.bpm)} BPM`
      : '';
    element('player-status').textContent = active && !showPulse && snapshot.phase === 'practice' ? 'Практика без визуальных подсказок' : labels[snapshot.state] + counter;
    const note = snapshot.noteIndex === null ? null : notes[snapshot.noteIndex];
    element('player-current-note').textContent = !showPulse ? '—' : active && note ? `${formatMidi(note.midi, note.noteName)} · ${note.string}/${note.fret}` : snapshot.phase === 'count-in' && active ? '1 · 2 · 3 · 4' : '—';
    const audibleId = showPulse && active && snapshot.phase === 'practice' ? snapshot.positionId : null;
    const audibleIndex = audibleId === null ? null : snapshot.noteIndex;
    if (forcePositionCallback || audibleId !== lastPosition || audibleIndex !== lastIndex) {
      forcePositionCallback = false;
      lastPosition = audibleId;
      lastIndex = audibleIndex;
      options.onPositionChange?.(audibleId, audibleIndex);
    }
    const announced = `${snapshot.state}/${snapshot.phase}/${snapshot.pauseReason ?? ''}`;
    if (announced !== lastAnnouncedState) {
      lastAnnouncedState = announced;
      container.querySelector<HTMLElement>('[data-player-live]')!.textContent = labels[snapshot.state];
    }
    renderControls(snapshot);
    options.onSnapshot?.(snapshot);
  }

  async function act(action: string) {
    if (disposed || (operationPending && action !== 'stop')) return;
    message('player-error');
    try {
      measurePractice(player.getSnapshot());
      if (action === 'start') {
        if (!notes.length) throw new RangeError('Для воспроизведения нужен непустой маршрут. Проверь диапазон и выбранные струны.');
        const config = configuration();
        message('player-notice');
        operationPending = true;
        setVolumes();
        const result = player.start(config);
        renderSnapshot();
        await result;
      } else if (action === 'pause') player.pause('manual');
      else if (action === 'resume') {
        operationPending = true;
        message('player-notice');
        await player.resume();
      } else if (action === 'stop') player.stop();
    } catch (failure) {
      if (action === 'start' || action === 'resume') {
        try { player.stop(); } catch { /* Keep the original startup failure visible. */ }
      }
      message('player-error', failure instanceof Error ? failure.message : String(failure));
    } finally {
      operationPending = false;
      renderSnapshot();
    }
  }

  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-player-action]') : null;
    if (target?.dataset.playerAction) void act(target.dataset.playerAction);
  }, { signal: controller.signal });

  container.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    const name = input.dataset.player;
    message('player-error');
    try {
      if (name === 'bpm' && playing()) {
        if (field<HTMLSelectElement>('repeat').value === 'ladder') throw new Error('В лестнице темпа ручное изменение BPM недоступно. Сначала останови воспроизведение.');
        player.setBpm(number('bpm', 40, 220));
      }
      if (name === 'bassVolume' || name === 'clickVolume') setVolumes();
      renderSnapshot();
      getPreferences();
      options.onPreferencesChange?.();
    } catch (failure) { message('player-error', failure instanceof Error ? failure.message : String(failure)); }
  }, { signal: controller.signal });
  container.addEventListener('input', event => {
    const input = event.target;
    if (input instanceof HTMLInputElement && ['bassVolume', 'clickVolume'].includes(input.dataset.player ?? '')) {
      try { setVolumes(); getPreferences(); options.onPreferencesChange?.(); } catch (failure) { message('player-error', failure instanceof Error ? failure.message : String(failure)); }
    }
  }, { signal: controller.signal });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ['starting', 'running', 'finishing'].includes(player.getSnapshot().state)) {
      measurePractice(player.getSnapshot());
      player.pause('hidden');
      message('player-notice', 'Вкладка была скрыта. Воспроизведение на паузе — для продолжения нажми «Продолжить».');
      renderSnapshot();
    }
  }, { signal: controller.signal });

  document.addEventListener('keydown', event => {
    if (disposed || event.repeat || container.hidden || container.getClientRects().length === 0 || document.hidden) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea, button, a, [role="button"], [contenteditable="true"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); void act('stop'); }
    else if (event.code === 'Space' || event.key === ' ') {
      const state = player.getSnapshot().state;
      event.preventDefault();
      void act(state === 'running' || state === 'finishing' ? 'pause' : state === 'paused' ? 'resume' : 'start');
    }
  }, { signal: controller.signal });

  function refreshContext() {
    if (disposed) return;
    let nextNotes: readonly AnnotatedPosition[] = [];
    try { nextNotes = getNotes(); }
    catch (failure) { message('player-error', failure instanceof Error ? failure.message : String(failure)); }
    const nextKey = currentFingerprint(nextNotes);
    if (nextKey !== contextKey) {
      const hadContext = notes.length > 0 || playing();
      player.stop();
      practiceElapsedMs = 0;
      practiceClock = null;
      notes = nextNotes;
      contextKey = nextKey;
      field<HTMLInputElement>('from').value = '1';
      field<HTMLInputElement>('to').value = String(Math.max(1, notes.length));
      field<HTMLInputElement>('from').max = String(Math.max(1, notes.length));
      field<HTMLInputElement>('to').max = String(Math.max(1, notes.length));
      if (hadContext) message('player-notice', 'Маршрут или область изменились. Воспроизведение остановлено; фрагмент выбран заново.');
    }
    element('player-scope').textContent = notes.length ? `${notes.length} нот в маршруте` : 'Нет доступного маршрута';
    renderSnapshot();
  }

  function frame() {
    if (!container.hidden && container.getClientRects().length > 0) renderSnapshot();
    if (!disposed) animationFrame = requestAnimationFrame(frame);
  }

  function getPreferences(): AppPreferences['player'] {
    const from = number('from', 1, Math.max(1, notes.length));
    const to = number('to', 1, Math.max(1, notes.length));
    if (from > to) throw new RangeError('Первая нота фрагмента не может быть позже последней.');
    const ladderStart = number('ladderStart', 40, 220);
    const ladderEnd = number('ladderEnd', 40, 220);
    if (ladderStart > ladderEnd) throw new RangeError('Целевой темп лестницы должен быть не меньше начального.');
    return {
      bpm: number('bpm', 40, 220),
      duration: field<HTMLSelectElement>('duration').value as AppPreferences['player']['duration'],
      repeat: field<HTMLSelectElement>('repeat').value as AppPreferences['player']['repeat'],
      countIn: field<HTMLInputElement>('countIn').checked,
      showPulse: field<HTMLInputElement>('showPulse').checked,
      from: from === 1 ? null : from,
      to: to === notes.length || notes.length === 0 ? null : to,
      ladderStart, ladderEnd,
      ladderStep: number('ladderStep', 1, 180),
      ladderRepeats: number('ladderRepeats', 1, 20),
      metronome: field<HTMLInputElement>('metronome').checked,
      metronomeMode: field<HTMLSelectElement>('metronomeMode').value as AppPreferences['player']['metronomeMode'],
      subdivision: field<HTMLSelectElement>('subdivision').value as AppPreferences['player']['subdivision'],
      bassVolume: number('bassVolume', 0, 100), clickVolume: number('clickVolume', 0, 100),
    };
  }
  refreshContext();
  animationFrame = requestAnimationFrame(frame);
  return {
    getPreferences,
    applyPreferences(preferences: AppPreferences['player']) {
      measurePractice(player.getSnapshot());
      player.stop();
      practiceElapsedMs = 0;
      practiceClock = null;
      for (const name of ['bpm', 'duration', 'repeat', 'ladderStart', 'ladderEnd', 'ladderStep', 'ladderRepeats', 'metronomeMode', 'subdivision', 'bassVolume', 'clickVolume'] as const) field(name).value = String(preferences[name]);
      for (const name of ['countIn', 'showPulse', 'metronome'] as const) field<HTMLInputElement>(name).checked = preferences[name];
      field<HTMLInputElement>('from').value = String(preferences.from ?? 1);
      field<HTMLInputElement>('to').value = String(preferences.to ?? Math.max(1, notes.length));
      player.setBpm(preferences.bpm);
      setVolumes();
      message('player-error');
      message('player-notice');
      renderSnapshot();
    },
    getPracticeDraft() {
      const snapshot = player.getSnapshot();
      measurePractice(snapshot);
      const configured = Number(field<HTMLInputElement>('bpm').value);
      const comfortableBpm = Math.round(playing(snapshot) ? snapshot.bpm : Number.isFinite(configured) && configured >= 40 && configured <= 220 ? configured : snapshot.bpm);
      return { durationMs: Math.round(practiceElapsedMs), comfortableBpm, runtimeContextKey: contextKey };
    },
    consumePracticeDuration(durationMs: number, expectedContextKey?: string) {
      if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError('Длительность должна быть неотрицательной.');
      measurePractice(player.getSnapshot());
      if (expectedContextKey !== undefined && expectedContextKey !== contextKey) return;
      practiceElapsedMs = Math.max(0, practiceElapsedMs - durationMs);
    },
    refreshContext,
    refreshHighlight() { forcePositionCallback = true; renderSnapshot(); },
    getSnapshot: () => player.getSnapshot(),
    stop() { measurePractice(player.getSnapshot()); player.stop(); renderSnapshot(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      cancelAnimationFrame(animationFrame);
      player.dispose();
      options.onPositionChange?.(null, null);
      container.innerHTML = '';
    },
  };
}
