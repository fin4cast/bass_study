import './tracks.css';
import { createTracksPlayer } from '../audio/tracks';
import { TRACK_LIMITS, TracksError, setTracksPlayback, validateTracksManifest, type TracksManifest } from '../tracks';
import { confirmAction } from './confirm';
import { createActiveFrame } from './active-frame';

export interface TracksOptions {
  readonly onPreferencesChange?: () => void;
  readonly onBeforePlay?: () => boolean | void;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, mark => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[mark]!);
function timeText(seconds: number) { const hundredths = Math.max(0, Math.round(seconds * 100)); return `${Math.floor(hundredths / 6000)}:${String(Math.floor(hundredths / 100) % 60).padStart(2, '0')},${String(hundredths % 100).padStart(2, '0')}`; }
function inputTime(seconds: number) { return String(seconds); }
function megabytes(bytes: number) { return `${(bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МиБ`; }

/** File bytes and decoded buffers stay in the adapter; preferences contain only the portable manifest. */
export function mountTracks(container: HTMLElement, options: TracksOptions = {}) {
  let player = createTracksPlayer();
  let visible = !container.hidden;
  let disposed = false;
  let request = 0;
  let busy: 'load' | 'rebind' | 'transport' | null = null;
  let error = '', notice = '';
  let fromDraft: string | null = null, toDraft: string | null = null, rateDraft: string | null = null;
  let lastAnnouncement = '';
  let controlSignature = '';
  const frame = createActiveFrame(update);
  const controller = new AbortController();
  container.classList.add('tracks-section');

  function snapshot() { return player.getPlaybackState(); }
  function field<T extends HTMLInputElement = HTMLInputElement>(name: string) { return container.querySelector<T>(`[data-tracks-setting="${name}"]`); }
  function changed() { options.onPreferencesChange?.(); }
  function number(raw: string, label: string) { if (!raw.trim() || !Number.isFinite(Number(raw))) throw new RangeError(`${label}: укажи корректное число.`); return Number(raw); }
  function getPreferences(): TracksManifest | null {
    const manifest = player.getManifest();
    if (!manifest) return null;
    if (fromDraft !== null || toDraft !== null || rateDraft !== null) {
      setTracksPlayback(manifest, { clip: { from: number(fromDraft ?? String(manifest.clip.from), 'Начало A'), to: number(toDraft ?? String(manifest.clip.to), 'Конец B') }, rate: number(rateDraft ?? String(manifest.rate), 'Скорость') });
      throw new RangeError('Заверши изменение фрагмента или скорости: перейди из поля, чтобы применить значение.');
    }
    return manifest;
  }
  function refreshMessage() {
    const errorElement = container.querySelector<HTMLElement>('[data-testid="tracks-error"]');
    const noticeElement = container.querySelector<HTMLElement>('[data-testid="tracks-notice"]');
    if (errorElement) { errorElement.textContent = error; errorElement.hidden = !error; }
    if (noticeElement) { noticeElement.textContent = notice; noticeElement.hidden = !notice; }
  }
  function render() {
    if (disposed) return;
    const focused = document.activeElement instanceof HTMLElement && container.contains(document.activeElement) ? document.activeElement : null;
    const focusSetting = focused?.dataset.tracksSetting, focusAction = focused?.dataset.tracksAction;
    const manifest = player.getManifest(), state = snapshot();
    const bound = new Set(state.boundTrackIds);
    const duration = manifest ? Math.max(...manifest.tracks.map(track => track.decoded.duration)) : 0;
    container.innerHTML = `
      <div class="studio-file-row"><p class="tracks-intro">Выбери локальные WAV/MP3: до четырёх файлов, каждый не больше 64 МиБ. Готовые отдельные партии (stems) должны начинаться в одной точке; автоматического выравнивания и выделения инструментов здесь нет.</p><div class="tracks-file-actions studio-file-actions"><label class="primary-button button-compact">${manifest ? 'Открыть новый набор' : 'Выбрать аудиофайлы'}<input type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" multiple aria-label="Новый набор аудиофайлов" data-tracks-files${busy ? ' disabled' : ''}></label>${manifest ? `<label class="secondary-button button-compact">Привязать исходные файлы<input type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" multiple aria-label="Привязать исходные файлы" data-tracks-rebind${busy ? ' disabled' : ''}></label><button class="text-button button-compact" type="button" data-tracks-action="clear"${busy ? ' disabled' : ''}>Очистить набор</button>` : ''}${busy === 'load' || busy === 'rebind' ? '<button class="text-button button-compact" type="button" data-tracks-action="cancel-load">Отменить загрузку</button>' : ''}</div></div>
      <p class="tracks-load-status studio-status" role="status" data-testid="tracks-load-status">${busy === 'load' ? 'Читаем и декодируем выбранные файлы…' : busy === 'rebind' ? 'Проверяем содержимое и привязываем файлы по очереди…' : manifest ? `Готово ${bound.size} из ${manifest.tracks.length} дорожек` : 'Файлы остаются на этом компьютере.'}</p><p class="status-error" role="alert" data-testid="tracks-error" hidden></p><p class="status-notice" role="status" data-testid="tracks-notice" hidden></p>${manifest ? `<div class="tracks-list" data-testid="tracks-list">${manifest.tracks.map((track, index) => `<article class="tracks-track content-panel content-panel-raised${bound.has(track.id) ? '' : ' is-missing'}" data-track-id="${escapeHtml(track.id)}"><div class="tracks-track-name"><span class="tracks-number">${String(index + 1).padStart(2, '0')}</span><div><h3>${escapeHtml(track.name)}</h3><p>${timeText(track.decoded.duration)} · ${megabytes(track.size)} · ${track.decoded.channels} ${track.decoded.channels === 1 ? 'канал' : 'канала'}</p></div><strong class="tracks-file-state" data-track-bound="${bound.has(track.id)}">${bound.has(track.id) ? 'Файл привязан' : 'Нужен исходный файл'}</strong></div><div class="tracks-track-mix"><label><span>Громкость</span><input type="range" min="0" max="100" step="1" value="${Math.round(track.volume * 100)}" aria-label="Громкость дорожки ${index + 1}" data-track-volume="${escapeHtml(track.id)}"${busy === 'load' || busy === 'rebind' ? ' disabled' : ''}><output data-track-volume-output="${escapeHtml(track.id)}">${Math.round(track.volume * 100)}%</output></label><label class="tracks-check"><input type="checkbox" aria-label="Выключить дорожку ${index + 1}" data-track-mute="${escapeHtml(track.id)}"${track.muted ? ' checked' : ''}${busy === 'load' || busy === 'rebind' ? ' disabled' : ''}><span>Выключить</span></label><label class="tracks-rebind-one secondary-button button-compact">${bound.has(track.id) ? 'Найти тот же исходный файл' : 'Выбрать этот файл'}<input type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" aria-label="Исходный файл дорожки ${index + 1}" data-track-rebind="${escapeHtml(track.id)}"${busy ? ' disabled' : ''}></label></div></article>`).join('')}</div>${!state.ready ? '<p class="tracks-missing-notice" role="status" data-testid="tracks-missing">В сохранённом наборе есть только названия и метки. Выбери исходные файлы снова — проверим содержимое (SHA-256) и размер. Имена файлов могут отличаться. Старт доступен после привязки всех дорожек.</p>' : ''}<div class="tracks-clip-controls"><fieldset><legend>Фрагмент исходника · A включено, B исключено</legend><label class="tracks-field"><span class="form-label">A · начало, с</span><input type="number" class="form-control" min="0" max="${duration}" step="any" value="${escapeHtml(fromDraft ?? inputTime(manifest.clip.from))}" aria-label="Начало фрагмента A" data-tracks-setting="from"></label><span class="tracks-clip-dash">—</span><label class="tracks-field"><span class="form-label">B · конец, с</span><input type="number" class="form-control" min="0" max="${duration}" step="any" value="${escapeHtml(toDraft ?? inputTime(manifest.clip.to))}" aria-label="Конец фрагмента B" data-tracks-setting="to"></label></fieldset><label class="tracks-check"><input type="checkbox" aria-label="Повторять аудиофрагмент" data-tracks-setting="loop"${manifest.loop ? ' checked' : ''}><span>По кругу</span></label><label class="tracks-field"><span class="form-label">Скорость · меняет высоту</span><input type="number" class="form-control" min="0.5" max="1.5" step="0.05" value="${escapeHtml(rateDraft ?? String(manifest.rate))}" aria-label="Скорость с изменением высоты" data-tracks-setting="rate"></label><button class="secondary-button" type="button" data-tracks-action="from-here">Начало здесь</button><button class="secondary-button" type="button" data-tracks-action="to-here">Конец здесь</button><button class="text-button button-compact" type="button" data-tracks-action="full-clip">Весь файл</button></div><p class="tracks-edit-help">Минимум фрагмента — 0,05 с. «Начало здесь» и «Конец здесь» ставят воспроизведение на паузу и используют текущую позицию. Для выбора за пределами участка сначала нажми «Весь файл».</p><p class="tracks-rate-warning" data-testid="tracks-rate-warning">${manifest.rate === 1 ? 'Скорость ×1: исходная высота. A включается, B исключается; короткая дорожка заканчивается тишиной до общей границы.' : `Скорость ×${manifest.rate.toLocaleString('ru-RU')}: высота тоже меняется. Это varispeed, без сохранения исходной высоты.`}</p><section class="tracks-player content-panel content-panel-raised" aria-label="Проигрывание"><div class="studio-playback"><button class="primary-button button-compact" type="button" data-tracks-action="play">${state.state === 'paused' ? 'Продолжить' : 'Старт'}<span aria-hidden="true">▶</span></button><button class="secondary-button button-compact" type="button" data-tracks-action="pause">Пауза</button><button class="secondary-button button-compact" type="button" data-tracks-action="stop">Стоп</button></div>
      <div class="studio-timeline"><label><span class="sr-only">Позиция аудиофрагмента</span><input type="range" min="${manifest.clip.from}" max="${manifest.clip.to}" step="0.01" value="${state.position}" aria-label="Позиция аудиофрагмента" data-tracks-setting="seek"></label><output data-testid="tracks-position">${timeText(state.position)} / ${timeText(duration)}</output></div>
      <p class="tracks-edit-help">Время показано от начала исходной записи.</p><p class="tracks-play-status studio-status" data-testid="tracks-play-status"></p><p class="tracks-edit-help" data-testid="tracks-edit-help"></p></section>` : '<div class="tracks-empty studio-empty" data-testid="tracks-empty"><span aria-hidden="true">≋</span><h3>Твоя запись — твоя учебная петля</h3><p>Загрузи один трек для разбора или готовые отдельные партии. В JSON-копию попадут только метаданные и границы фрагмента, без аудио.</p></div>'}<details class="tracks-memory-help"><summary class="section-disclosure">Ограничение памяти</summary><p>Набор ограничен 512 МиБ расчётных декодированных данных. Декодер, прежний набор и временные копии могут требовать дополнительную память; это не гарантия пикового расхода RAM.</p></details><p class="tracks-backup-note">Резервная копия хранит названия, метки и параметры, без аудиофайлов. После перезагрузки и восстановления исходные файлы нужно привязать повторно.</p><span class="sr-only" role="status" data-tracks-live></span>`;
    controlSignature = '';
    refreshMessage(); update();
    if (visible && focused) {
      const next = focusSetting ? field(focusSetting) : focusAction ? container.querySelector<HTMLButtonElement>(`[data-tracks-action="${focusAction}"]`) : null;
      if (next && !next.disabled) next.focus({ preventScroll: true });
      else container.querySelector<HTMLInputElement>('[data-tracks-files]')?.focus({ preventScroll: true });
    }
  }
  function updateControls(state: ReturnType<typeof snapshot>) {
    const signature = `${state.state}/${state.ready}/${busy ?? ''}`;
    if (signature === controlSignature) return;
    controlSignature = signature;
    const playing = state.state === 'playing' || state.state === 'starting';
    const loading = busy === 'load' || busy === 'rebind';
    for (const name of ['from', 'to', 'loop', 'rate']) { const input = field(name); if (input) input.disabled = playing || busy !== null; }
    const full = container.querySelector<HTMLButtonElement>('[data-tracks-action="full-clip"]'); if (full) full.disabled = playing || busy !== null;
    for (const name of ['from-here', 'to-here']) {
      const button = container.querySelector<HTMLButtonElement>(`[data-tracks-action="${name}"]`);
      if (button) button.disabled = !state.ready || busy !== null;
    }
    const play = container.querySelector<HTMLButtonElement>('[data-tracks-action="play"]');
    if (play) {
      play.disabled = !state.ready || playing || busy !== null;
      const label = state.state === 'paused' ? 'Продолжить' : 'Старт';
      if (play.firstChild?.nodeType === Node.TEXT_NODE && play.firstChild.nodeValue !== label) play.firstChild.nodeValue = label;
    }
    const pause = container.querySelector<HTMLButtonElement>('[data-tracks-action="pause"]'); if (pause) pause.disabled = !playing || loading;
    const stop = container.querySelector<HTMLButtonElement>('[data-tracks-action="stop"]'); if (stop) stop.disabled = (!playing && state.state !== 'paused' && state.state !== 'finished') || loading;
    const seek = field('seek'); if (seek) seek.disabled = busy !== null;
    const help = container.querySelector<HTMLElement>('[data-testid="tracks-edit-help"]'); if (help) help.textContent = playing ? 'Поставь воспроизведение на паузу, чтобы изменить фрагмент, повтор или скорость. Громкость и перемещение доступны сейчас.' : 'Настрой A–B, повтор и скорость перед продолжением. Файлы используют общую временную шкалу.';
  }
  function update() {
    if (disposed) return;
    const state = snapshot(), manifest = player.getManifest();
    frame.setActive(visible && !document.hidden && (state.state === 'playing' || state.state === 'starting'));
    const ready = String(state.ready), bound = String(state.boundTrackIds.length);
    if (container.dataset.tracksState !== state.state) container.dataset.tracksState = state.state;
    if (container.dataset.tracksReady !== ready) container.dataset.tracksReady = ready;
    if (container.dataset.tracksBound !== bound) container.dataset.tracksBound = bound;
    if (!manifest) return;
    updateControls(state);
    const seek = field('seek');
    if (seek && document.activeElement !== seek && seek.valueAsNumber !== state.position) seek.value = String(state.position);
    const position = container.querySelector<HTMLOutputElement>('[data-testid="tracks-position"]');
    const positionText = `${timeText(state.position)} / ${timeText(Math.max(...manifest.tracks.map(track => track.decoded.duration)))}`;
    if (position && position.value !== positionText) position.value = positionText;
    const labels: Record<typeof state.state, string> = { stopped: state.ready ? 'Готово к воспроизведению' : 'Нужны исходные файлы', starting: 'Подготавливаем звук…', playing: `Звучит фрагмент · проход ${state.cycleIndex + 1}`, paused: state.pauseReason === 'hidden' ? 'Пауза: вкладка скрывалась. Продолжи явно.' : 'На паузе', finished: 'Фрагмент завершён' };
    const status = container.querySelector<HTMLElement>('[data-testid="tracks-play-status"]'); if (status && status.textContent !== labels[state.state]) status.textContent = labels[state.state];
    const announced = `${state.state}/${state.pauseReason ?? ''}/${state.ready}`;
    if (announced !== lastAnnouncement) { lastAnnouncement = announced; const live = container.querySelector<HTMLElement>('[data-tracks-live]'); if (live) live.textContent = labels[state.state]; }
  }
  function stop() {
    ++request; busy = null; player.cancelLoad(); player.stop(); render();
  }
  function pause(reason = 'manual') {
    if (busy === 'load' || busy === 'rebind') { cancelLoad(); return; }
    ++request; busy = null; player.pause(reason); update();
  }
  function cancelLoad() {
    ++request; player.cancelLoad(); busy = null;
    notice = 'Загрузка отменена. Предыдущий набор сохранён.'; error = ''; render();
  }
  function checkSources(files: readonly File[]) {
    if (!files.length || files.length > TRACK_LIMITS.maxTracks) throw new TracksError('TRACK_COUNT', 'Выбери от одного до четырёх WAV/MP3 файлов.');
    if (files.some(file => file.size > TRACK_LIMITS.sourcePerFile || file.size === 0)) throw new TracksError('SOURCE_LIMIT', 'Каждый исходный файл должен быть непустым и не больше 64 МиБ. Прежний набор сохранён.');
    if (files.reduce((sum, file) => sum + file.size, 0) > TRACK_LIMITS.sourceTotal) throw new TracksError('SOURCE_LIMIT', 'Суммарный размер исходников превышает 256 МиБ. Прежний набор сохранён.');
  }
  async function load(files: readonly File[], expectedTrackId?: string, rebind = false) {
    if (busy || disposed) return;
    const currentPlayer = player;
    const currentRequest = ++request;
    error = ''; notice = '';
    try {
      checkSources(files);
      currentPlayer.stop(); busy = rebind ? 'rebind' : 'load'; render();
      if (!rebind) await currentPlayer.loadFiles(files);
      else {
        const manifest = currentPlayer.getManifest(); if (!manifest) throw new TracksError('NO_TRACKS', 'Сначала восстанови или открой набор дорожек.');
        const selected = new Set<string>();
        for (const file of files) {
          if (currentRequest !== request || currentPlayer !== player || disposed) return;
          let id = expectedTrackId;
          if (!id) {
            const bytes = await file.arrayBuffer();
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            if (currentRequest !== request || currentPlayer !== player || disposed) return;
            const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
            const bound = new Set(currentPlayer.getSnapshot().boundTrackIds);
            const candidates = manifest.tracks.filter(track => track.size === file.size && track.sha256 === sha256 && !selected.has(track.id));
            id = candidates.find(track => !bound.has(track.id))?.id ?? candidates[0]?.id;
            if (!id) throw new TracksError('FILE_MISMATCH', `«${file.name}» не совпадает с сохранёнными дорожками по содержимому и размеру. Прежние привязки сохранены.`);
          }
          await currentPlayer.rebindFile(id, file);
          selected.add(id);
        }
      }
      if (currentRequest !== request || currentPlayer !== player || disposed) return;
      fromDraft = null; toDraft = null; rateDraft = null;
      notice = rebind ? 'Исходные файлы проверены и привязаны. Метки фрагмента сохранены.' : 'Набор загружен. Можно выбрать фрагмент или начать воспроизведение.';
      changed();
    } catch (failure) {
      if (currentRequest !== request || currentPlayer !== player || disposed) return;
      error = failure instanceof Error ? failure.message : String(failure);
    } finally { if (currentRequest === request && currentPlayer === player && !disposed) {
      busy = null; render();
      if (visible) {
        if (error) { const message = container.querySelector<HTMLElement>('[data-testid="tracks-error"]'); if (message) { message.tabIndex = -1; message.focus({ preventScroll: true }); } }
        else (snapshot().ready ? container.querySelector<HTMLButtonElement>('[data-tracks-action="play"]') : container.querySelector<HTMLInputElement>('.is-missing [data-track-rebind]'))?.focus({ preventScroll: true });
      }
    } }
  }
  async function act(action: string) {
    if (disposed || (busy && action !== 'stop' && action !== 'cancel-load')) return;
    if (action === 'cancel-load') { cancelLoad(); return; }
    if (action === 'stop') { stop(); return; }
    if (action === 'pause') { pause(); return; }
    if (action === 'clear') {
      const manifest = player.getManifest();
      if (!manifest) return;
      const expected = ++request, manifestId = manifest.id;
      const fileNames = manifest.tracks.map(track => `«${track.name}»`).join(', ');
      if (await confirmAction({ title: 'Очистить набор дорожек?', message: `Набор: ${fileNames}. Будут удалены границы фрагмента, параметры и привязки этого набора. Аудиофайлы на компьютере сохранятся.`, confirmLabel: 'Очистить набор' }) && !disposed && expected === request && player.getManifest()?.id === manifestId) {
        applyPreferences(null); changed(); container.querySelector<HTMLInputElement>('[data-tracks-files]')?.focus();
      }
      return;
    }
    const currentRequest = ++request, currentPlayer = player;
    try {
      error = '';
      if (action === 'play') {
        getPreferences();
        if (options.onBeforePlay?.() === false) return;
        busy = 'transport';
        const pending = currentPlayer.play();
        update();
        await pending;
      } else if (action === 'full-clip') {
        const manifest = currentPlayer.getManifest(); if (!manifest) return;
        currentPlayer.setClip({ from: 0, to: Math.max(...manifest.tracks.map(track => track.decoded.duration)) });
        fromDraft = null; toDraft = null; changed(); render();
      } else if (action === 'from-here' || action === 'to-here') {
        const manifest = getPreferences(); if (!manifest) return;
        currentPlayer.pause('fragment-edit');
        const position = currentPlayer.getSnapshot().position;
        const clip = action === 'from-here' ? { from: position, to: manifest.clip.to } : { from: manifest.clip.from, to: position };
        currentPlayer.setClip(clip);
        fromDraft = null; toDraft = null;
        notice = `${action === 'from-here' ? 'Начало A' : 'Конец B'}: ${timeText(position)}. Воспроизведение на паузе; для прослушивания нажми «Продолжить» или «Старт».`;
        changed(); render(); container.querySelector<HTMLButtonElement>(`[data-tracks-action="${action}"]`)?.focus({ preventScroll: true });
      }
    } catch (failure) { if (currentRequest === request && currentPlayer === player && !disposed) { error = failure instanceof Error ? failure.message : String(failure); refreshMessage(); } }
    finally { if (currentRequest === request && currentPlayer === player && !disposed) { busy = null; update(); } }
  }
  function applyPreferences(value: TracksManifest | null) {
    const validated = value === null ? null : validateTracksManifest(value);
    stop();
    if (validated) player.restoreManifest(validated);
    else { const previous = player; player = createTracksPlayer(); void previous.dispose(); }
    fromDraft = null; toDraft = null; rateDraft = null; error = '';
    notice = validated ? 'Набор восстановлен из метаданных. Для воспроизведения выбери исходные файлы снова.' : '';
    render();
  }
  container.addEventListener('click', event => { const action = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-tracks-action]')?.dataset.tracksAction : undefined; if (action) void act(action); }, { signal: controller.signal });
  container.addEventListener('input', event => {
    const input = event.target; if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.trackVolume) {
      try { player.setTrackMix(input.dataset.trackVolume, { volume: Number(input.value) / 100 }); const out = container.querySelector<HTMLOutputElement>(`[data-track-volume-output="${input.dataset.trackVolume}"]`); if (out) out.value = `${input.value}%`; changed(); }
      catch (failure) { error = failure instanceof Error ? failure.message : String(failure); refreshMessage(); }
    }
    if (input.dataset.tracksSetting === 'from') fromDraft = input.value;
    if (input.dataset.tracksSetting === 'to') toDraft = input.value;
    if (input.dataset.tracksSetting === 'rate') rateDraft = input.value;
    if (['from', 'to', 'rate'].includes(input.dataset.tracksSetting ?? '')) input.setAttribute('aria-invalid', String(!input.value || !Number.isFinite(Number(input.value))));
  }, { signal: controller.signal });
  container.addEventListener('change', event => {
    const input = event.target; if (!(input instanceof HTMLInputElement)) return;
    if (input.hasAttribute('data-tracks-files') && input.files) { void load([...input.files]); return; }
    if (input.hasAttribute('data-tracks-rebind') && input.files) { void load([...input.files], undefined, true); return; }
    if (input.dataset.trackRebind && input.files?.[0]) { void load([input.files[0]], input.dataset.trackRebind, true); return; }
    try {
      if (input.dataset.trackMute) { player.setTrackMix(input.dataset.trackMute, { muted: input.checked }); changed(); return; }
      const manifest = player.getManifest(); if (!manifest) return;
      const setting = input.dataset.tracksSetting;
      if (setting === 'from' || setting === 'to') {
        player.setClip({ from: number(fromDraft ?? String(manifest.clip.from), 'Начало A'), to: number(toDraft ?? String(manifest.clip.to), 'Конец B') });
        fromDraft = null; toDraft = null;
      } else if (setting === 'rate') { player.setRate(number(rateDraft ?? String(manifest.rate), 'Скорость')); rateDraft = null; }
      else if (setting === 'loop') player.setLoop(input.checked);
      else if (setting === 'seek') {
        const currentPlayer = player, currentRequest = ++request;
        const seconds = Number(input.value);
        busy = 'transport'; update();
        void currentPlayer.seek(seconds).catch(failure => { if (currentRequest === request && currentPlayer === player) { error = failure instanceof Error ? failure.message : String(failure); refreshMessage(); } }).finally(() => { if (currentRequest === request && currentPlayer === player && !disposed) { busy = null; update(); } });
        return;
      } else return;
      error = ''; changed(); render(); container.querySelector<HTMLInputElement>(`[data-tracks-setting="${setting}"]`)?.focus({ preventScroll: true });
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); input.setAttribute('aria-invalid', 'true'); refreshMessage(); }
  }, { signal: controller.signal });
  document.addEventListener('visibilitychange', () => {
    if (visible && document.hidden && ['playing', 'starting'].includes(snapshot().state)) { pause('hidden'); notice = 'Вкладка скрывалась. Продолжи воспроизведение явно.'; refreshMessage(); }
  }, { signal: controller.signal });
  render();
  return {
    getPreferences, applyPreferences,
    setVisible(next: boolean) {
      if (disposed || visible === next) return;
      visible = next; container.hidden = !next;
      if (visible) update();
      else stop();
    },
    stop, pause,
    getSnapshot: () => player.getSnapshot(),
    dispose() { if (disposed) return; stop(); disposed = true; controller.abort(); frame.setActive(false); void player.dispose(); container.innerHTML = ''; },
  };
}
