import './harmony.css';
import { createHarmonyPlayer, type HarmonySnapshot, type HarmonySource } from '../audio/harmony';
import { createHarmonyPlan, type HarmonyPreferences } from '../harmony';
import { formatMidi } from '../music';

export type { HarmonyPreferences } from '../harmony';
export interface HarmonyOptions {
  readonly onBeforeStart?: () => void;
  readonly onPreferencesChange?: () => void;
  readonly onSnapshot?: (snapshot: HarmonySnapshot) => void;
}
const SOURCES: readonly HarmonySource[] = ['bass', 'pad', 'click'];
const SOURCE_NAMES = { bass: 'Бас', pad: 'Аккорды', click: 'Метроном' };

export function mountHarmony(container: HTMLElement, options: HarmonyOptions = {}) {
  const player = createHarmonyPlayer();
  const plan = createHarmonyPlan();
  const controller = new AbortController();
  let visible = !container.hidden;
  let disposed = false, pending = false;
  let request = 0;
  let lastAnnouncement = '';
  let practiceDurationMs = 0;
  let practiceEpoch = 0;
  let practiceProgress: { runId: number; beat: number } | null = null;
  let runCountInBeats = 4;
  const runtimeContextKey = 'harmony:CFGC';
  let frame: number;
  container.classList.add('harmony-section');
  container.innerHTML = `<div class="harmony-heading"><div><p class="eyebrow">ИГРА ПО ГАРМОНИИ</p><h2>Четыре такта. Одна опора.</h2></div><p>C – F – G – C · 4/4<br>Бас 1–3–5–3 · аккорды · клик</p></div><p class="harmony-intro">Играй вместе с эталоном или выключи его бас и займи своё место в сопровождении. Здесь нет автоматической оценки исполнения.</p><div class="harmony-chords" aria-label="Четыре такта сопровождения">${plan.chords.map(chord => `<article data-harmony-chord="${chord.index}"><span>ТАКТ ${chord.index + 1}</span><strong>${chord.root}</strong><small>${chord.structure.notes.map(note => note.name).join(' · ')}</small></article>`).join('')}</div><div class="harmony-settings"><label class="harmony-field"><span>Темп, BPM</span><input type="number" min="40" max="220" step="1" value="80" aria-label="Темп сопровождения" data-harmony-setting="bpm"></label><label class="harmony-field"><span>Повтор</span><select aria-label="Повтор сопровождения" data-harmony-setting="repeat"><option value="once">Один проход</option><option value="infinite">По кругу</option></select></label><label class="harmony-check"><input type="checkbox" checked aria-label="Отсчёт сопровождения" data-harmony-setting="countIn"><span>Отсчёт: 4 доли</span></label></div><fieldset class="harmony-mixer"><legend>Три независимых голоса</legend>${SOURCES.map(source => `<div class="harmony-bus"><label class="harmony-volume"><span>${SOURCE_NAMES[source]}</span><input type="range" min="0" max="100" step="1" value="${source === 'bass' ? 70 : source === 'pad' ? 45 : 50}" aria-label="Громкость ${source === 'bass' ? 'баса' : source === 'pad' ? 'аккордов' : 'метронома'} сопровождения" data-harmony-setting="${source}Volume"><output data-harmony-volume="${source}">${source === 'bass' ? 70 : source === 'pad' ? 45 : 50}%</output></label><label class="harmony-check"><input type="checkbox" aria-label="Выключить ${source === 'bass' ? 'бас' : source === 'pad' ? 'аккорды' : 'метроном'} сопровождения" data-harmony-setting="${source}Muted"><span>Выключить</span></label></div>`).join('')}</fieldset><div class="harmony-controls"><button class="primary-button" type="button" data-harmony-action="start">Старт<span aria-hidden="true">▶</span></button><button class="secondary-button" type="button" data-harmony-action="pause" disabled>Пауза</button><button class="secondary-button" type="button" data-harmony-action="resume" disabled>Продолжить</button><button class="text-button" type="button" data-harmony-action="stop" disabled>Стоп</button></div><div class="harmony-playback"><p data-testid="harmony-status">Готово к сопровождению</p><strong data-testid="harmony-position">—</strong></div><p class="harmony-help" data-testid="harmony-edit-help">Темп и повтор настраиваются до старта; громкость и выключение голосов доступны во время игры.</p><p class="harmony-notice" role="status" data-testid="harmony-notice" hidden></p><p class="harmony-error" role="alert" data-testid="harmony-error" hidden></p><div class="harmony-preview"><div><p class="eyebrow">РИСУНОК ЭТАЛОННОГО БАСА</p><h3>Тоника. Терция. Квинта. Терция.</h3></div><ol>${plan.events.filter(event => event.source === 'bass').map(event => `<li data-harmony-note="${event.beat}"><span>${event.degree}</span><strong>${formatMidi(event.midi!, event.spelling!)}</strong><small>${event.position!.string} · ${event.position!.fret === 0 ? 'откр.' : `${event.position!.fret} лад`}</small></li>`).join('')}</ol><p>Показан один воспроизводимый путь в стандартном EADG, лады 0–12. Он не обещает оптимальную аппликатуру и не меняется от фильтров изучения грифа.</p></div><span class="sr-only" role="status" data-harmony-live></span>`;

  const field = <T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(name: string) => container.querySelector<T>(`[data-harmony-setting="${name}"]`)!;
  const button = (name: string) => container.querySelector<HTMLButtonElement>(`[data-harmony-action="${name}"]`)!;
  const output = (name: string) => container.querySelector<HTMLElement>(`[data-testid="harmony-${name}"]`)!;
  function message(name: 'error' | 'notice', text = '') { output(name).textContent = text; output(name).hidden = !text; }
  function number(name: string, min: number, max: number) {
    const input = field<HTMLInputElement>(name), value = Number(input.value);
    const valid = input.value !== '' && Number.isInteger(value) && value >= min && value <= max;
    input.setAttribute('aria-invalid', String(!valid));
    if (!valid) throw new RangeError(name === 'bpm' ? 'Темп сопровождения — целое число от 40 до 220 BPM.' : 'Громкость должна быть от 0 до 100.');
    return value;
  }
  function getPreferences(): HarmonyPreferences {
    return { bpm: number('bpm', 40, 220), repeat: field<HTMLSelectElement>('repeat').value as 'once' | 'infinite', countIn: field<HTMLInputElement>('countIn').checked,
      bassVolume: number('bassVolume', 0, 100), padVolume: number('padVolume', 0, 100), clickVolume: number('clickVolume', 0, 100),
      bassMuted: field<HTMLInputElement>('bassMuted').checked, padMuted: field<HTMLInputElement>('padMuted').checked, clickMuted: field<HTMLInputElement>('clickMuted').checked };
  }
  function applyMix(preferences = getPreferences()) {
    player.setMix({ volumes: { bass: preferences.bassVolume / 100, pad: preferences.padVolume / 100, click: preferences.clickVolume / 100 }, muted: { bass: preferences.bassMuted, pad: preferences.padMuted, click: preferences.clickMuted } });
    SOURCES.forEach(source => { container.querySelector<HTMLOutputElement>(`[data-harmony-volume="${source}"]`)!.value = `${preferences[`${source}Volume`]}%`; });
  }
  function measurePractice(snapshot: HarmonySnapshot) {
    if (snapshot.state === 'stopped') { practiceProgress = null; return; }
    const practiceBeat = Math.max(0, snapshot.transportBeat - runCountInBeats);
    const previousBeat = practiceProgress?.runId === snapshot.runId ? practiceProgress.beat : 0;
    practiceDurationMs += Math.max(0, practiceBeat - previousBeat) * 60000 / snapshot.bpm;
    practiceProgress = { runId: snapshot.runId, beat: practiceBeat };
  }
  function render() {
    if (disposed) return;
    const snapshot = player.getSnapshot({ includeTrace: false });
    measurePractice(snapshot);
    const active = ['running', 'finishing'].includes(snapshot.state);
    const locked = ['starting', 'running', 'paused', 'finishing'].includes(snapshot.state);
    ['bpm', 'repeat', 'countIn'].forEach(name => { field(name).disabled = locked || pending; });
    button('start').disabled = locked || pending;
    button('pause').disabled = !active || pending;
    button('resume').disabled = snapshot.state !== 'paused' || pending;
    button('stop').disabled = !locked && snapshot.state !== 'finished';
    container.dataset.harmonyState = snapshot.state;
    container.dataset.harmonyPhase = snapshot.phase;
    container.dataset.harmonyChord = snapshot.chordIndex === null ? '' : String(snapshot.chordIndex);
    container.dataset.harmonyBeat = String(snapshot.beat);
    container.dataset.harmonyPass = String(snapshot.passIndex);
    const labels: Record<HarmonySnapshot['state'], string> = { stopped: 'Готово к сопровождению', starting: 'Подготавливаем звук…', running: snapshot.phase === 'count-in' ? `Отсчёт · доля ${snapshot.beat} из 4` : `Сопровождение · такт ${(snapshot.chordIndex ?? 0) + 1} · доля ${snapshot.beat} · проход ${snapshot.passIndex + 1}`, paused: snapshot.pauseReason === 'hidden' ? 'Пауза: вкладка скрывалась. Продолжи явно.' : snapshot.pauseReason === 'timing' ? 'Пауза: браузер задержал расписание. Продолжи, когда будет готов.' : 'Сопровождение на паузе', finishing: `Завершается последний такт · доля ${snapshot.beat}`, finished: 'Четыре такта завершены' };
    const status = labels[snapshot.state];
    if (output('status').textContent !== status) output('status').textContent = status;
    const chord = snapshot.chordIndex === null ? null : plan.chords[snapshot.chordIndex];
    output('position').textContent = active && chord ? `${chord.root} · 1–3–5–3` : '—';
    output('edit-help').textContent = locked ? 'Чтобы изменить темп, повтор или отсчёт, сначала нажми «Стоп». Микшер доступен сейчас.' : 'Темп и повтор настраиваются до старта; громкость и выключение голосов доступны во время игры.';
    container.querySelectorAll<HTMLElement>('[data-harmony-chord]').forEach(element => {
      const current = active && snapshot.chordIndex === Number(element.dataset.harmonyChord);
      element.classList.toggle('is-playing', current);
      if (current) element.setAttribute('aria-current', 'step'); else element.removeAttribute('aria-current');
    });
    container.querySelectorAll<HTMLElement>('[data-harmony-note]').forEach(element => element.classList.toggle('is-playing', active && snapshot.phase === 'practice' && Math.floor(snapshot.transportBeat - (field<HTMLInputElement>('countIn').checked ? 4 : 0)) % 16 === Number(element.dataset.harmonyNote)));
    const announcement = `${snapshot.state}/${snapshot.phase}/${snapshot.pauseReason ?? ''}`;
    if (announcement !== lastAnnouncement) { lastAnnouncement = announcement; container.querySelector<HTMLElement>('[data-harmony-live]')!.textContent = labels[snapshot.state]; }
    options.onSnapshot?.(snapshot);
  }
  function stop() { measurePractice(player.getSnapshot({ includeTrace: false })); ++request; pending = false; player.stop(); render(); }
  function pause(reason = 'manual') { measurePractice(player.getSnapshot({ includeTrace: false })); ++request; pending = false; player.pause(reason); render(); }
  async function act(action: string) {
    if (disposed || (pending && action !== 'stop')) return;
    if (action === 'stop') { stop(); return; }
    if (action === 'pause') { pause(); return; }
    const expected = ++request;
    message('error');
    try {
      if (action === 'start') {
        const preferences = getPreferences();
        options.onBeforeStart?.(); message('notice'); pending = true;
        measurePractice(player.getSnapshot({ includeTrace: false }));
        runCountInBeats = preferences.countIn ? 4 : 0;
        const started = player.start({ bpm: preferences.bpm, countIn: preferences.countIn, repeat: preferences.repeat, volumes: { bass: preferences.bassVolume / 100, pad: preferences.padVolume / 100, click: preferences.clickVolume / 100 }, muted: { bass: preferences.bassMuted, pad: preferences.padMuted, click: preferences.clickMuted } });
        render(); await started;
      } else if (action === 'resume') {
        options.onBeforeStart?.(); pending = true;
        const resumed = player.resume(); render(); await resumed;
      }
    } catch (failure) {
      if (expected !== request || disposed) return;
      player.stop(); message('error', failure instanceof Error ? failure.message : String(failure));
    } finally { if (expected === request && !disposed) { pending = false; render(); } }
  }
  container.addEventListener('click', event => { const action = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-harmony-action]')?.dataset.harmonyAction : undefined; if (action) void act(action); }, { signal: controller.signal });
  container.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) || !input.dataset.harmonySetting) return;
    try { message('error'); applyMix(); options.onPreferencesChange?.(); render(); }
    catch (failure) { message('error', failure instanceof Error ? failure.message : String(failure)); }
  }, { signal: controller.signal });
  container.addEventListener('input', event => { const input = event.target; if (input instanceof HTMLInputElement && input.type === 'range') { try { applyMix(); options.onPreferencesChange?.(); } catch (failure) { message('error', failure instanceof Error ? failure.message : String(failure)); } } }, { signal: controller.signal });
  document.addEventListener('visibilitychange', () => { if (visible && document.hidden && ['starting', 'running', 'finishing'].includes(player.getSnapshot({ includeTrace: false }).state)) { pause('hidden'); message('notice', 'Вкладка скрывалась. Для продолжения нажми «Продолжить».'); } }, { signal: controller.signal });
  document.addEventListener('keydown', event => {
    if (!visible || disposed || document.hidden || event.repeat || container.getClientRects().length === 0) return;
    if (event.target instanceof Element && event.target.closest('input, select, textarea, button, a, [role="button"], [contenteditable="true"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); stop(); }
    else if (event.code === 'Space' || event.key === ' ') { event.preventDefault(); const state = player.getSnapshot({ includeTrace: false }).state; void act(['running', 'finishing'].includes(state) ? 'pause' : state === 'paused' ? 'resume' : 'start'); }
  }, { signal: controller.signal });
  function draw() { if (disposed) return; if (visible) render(); frame = requestAnimationFrame(draw); }
  render(); frame = requestAnimationFrame(draw);
  return {
    getPreferences,
    applyPreferences(preferences: HarmonyPreferences) {
      if (!Number.isInteger(preferences.bpm) || preferences.bpm < 40 || preferences.bpm > 220 || !['once', 'infinite'].includes(preferences.repeat) || typeof preferences.countIn !== 'boolean') throw new RangeError('Некорректные настройки сопровождения.');
      for (const source of SOURCES) if (!Number.isInteger(preferences[`${source}Volume`]) || preferences[`${source}Volume`] < 0 || preferences[`${source}Volume`] > 100 || typeof preferences[`${source}Muted`] !== 'boolean') throw new RangeError('Некорректные настройки микшера.');
      stop();
      practiceDurationMs = 0; practiceProgress = null; practiceEpoch++;
      field('bpm').value = String(preferences.bpm); field('repeat').value = preferences.repeat; field<HTMLInputElement>('countIn').checked = preferences.countIn;
      for (const source of SOURCES) { field(`${source}Volume`).value = String(preferences[`${source}Volume`]); field<HTMLInputElement>(`${source}Muted`).checked = preferences[`${source}Muted`]; }
      applyMix(preferences); message('error'); message('notice'); render();
    },
    setVisible(next: boolean) { if (visible && !next) stop(); visible = next; container.hidden = !next; },
    stop, pause,
    getPracticeDraft() {
      const snapshot = player.getSnapshot({ includeTrace: false });
      measurePractice(snapshot);
      const configured = Number(field('bpm').value);
      const active = ['starting', 'running', 'paused', 'finishing'].includes(snapshot.state);
      const comfortableBpm = Math.round(active ? snapshot.bpm : Number.isFinite(configured) && configured >= 40 && configured <= 220 ? configured : snapshot.bpm);
      return { durationMs: Math.round(practiceDurationMs), comfortableBpm, runtimeContextKey: `${runtimeContextKey}#${practiceEpoch}` };
    },
    consumePracticeDuration(durationMs: number, expectedContextKey = `${runtimeContextKey}#${practiceEpoch}`) {
      if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError('Длительность должна быть неотрицательной.');
      measurePractice(player.getSnapshot({ includeTrace: false }));
      if (expectedContextKey === `${runtimeContextKey}#${practiceEpoch}`) practiceDurationMs = Math.max(0, practiceDurationMs - durationMs);
    },
    getSnapshot: () => player.getSnapshot(),
    dispose() { if (disposed) return; stop(); disposed = true; controller.abort(); cancelAnimationFrame(frame); void player.dispose(); container.innerHTML = ''; },
  };
}
