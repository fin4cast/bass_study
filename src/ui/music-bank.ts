import './music-bank.css';
import { loadAlphaTab, type AlphaTabModule } from '../music-bank/engine';
import { createScorePlayer, destroyScorePlayer, type BankApi, type BankScore, type ScorePosition, type ScoreTransport } from '../music-bank/score-player';
import {
  DEFAULT_MUSIC_BANK_PREFERENCES, MUSIC_BANK_LIMITS, musicBankSha256,
  validateMusicBankPreferences, type MusicBankPreferences, type MusicBankTrackPreferences,
} from '../music-bank/model';
import { createMusicBankCatalog, searchMusicBankCatalog, type MusicBankCatalogEntry } from '../music-bank/catalog';
import type { PageHeightObservation } from '../app/page-layout';
import { handleTransportKey } from './transport-shortcut';
import { onPageVisibility } from './page-visibility';

interface PendingEngine {
  host: HTMLElement;
  player: ReturnType<typeof createScorePlayer> | null;
}
export interface MusicBankOptions {
  readonly observeHeight: (host: HTMLElement, measure: (available: number) => void) => PageHeightObservation;
  readonly preferences?: MusicBankPreferences | null;
  readonly onBeforePlay?: () => boolean | void;
  readonly onPreferencesChange?: (preferences: MusicBankPreferences | null) => void;
}
let instance = 0;
const PAGE_SIZE = 80;
function failureText(failure: unknown) { return failure instanceof Error ? failure.message : String(failure); }
function timeLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A-local studio. Files/catalogue and the audio engine never enter preferences. */
export function mountMusicBank(container: HTMLElement, options: MusicBankOptions) {
  const id = `music-bank-${++instance}`;
  const abort = new AbortController();
  const listen = { signal: abort.signal };
  let preferences = validateMusicBankPreferences(options.preferences ?? DEFAULT_MUSIC_BANK_PREFERENCES);
  let alphaTab: AlphaTabModule | null = null;
  let api: BankApi | null = null;
  let score: BankScore | null = null;
  let disposed = false, visible = false, bound = false, loading = false;
  let intent = 0, engineError = '', rangeInvalid = false;
  let pendingEngine: PendingEngine | null = null;
  let transportState: ScoreTransport = 'stopped';
  let catalogue: readonly MusicBankCatalogEntry[] = [], cataloguePage = 0;
  let layoutFrame = 0;
  container.classList.add('music-bank');
  container.dataset.testid = 'music-bank';
  container.hidden = true;
  container.innerHTML = `
    <div class="studio-file-row">
      <p data-mb="song-info"></p>
      <div class="studio-file-actions">
        <label class="primary-button button-compact">Открыть файл<input data-mb="file" data-music-bank-file type="file" class="mb-sr-only" aria-label="Открыть музыкальный файл"></label>
        <label class="secondary-button button-compact">Выбрать папку<input data-mb="folder" data-music-bank-folder type="file" webkitdirectory multiple class="mb-sr-only" aria-label="Выбрать папку с партитурами"></label>
        <button type="button" class="text-button button-compact" data-mb="cancel" hidden>Отменить загрузку</button>
      </div>
    </div>
    <details class="mb-catalogue" data-mb="catalogue"><summary class="section-disclosure">Файлы папки <span data-mb="catalogue-count">не выбраны</span></summary><div class="mb-catalogue-body"><div class="mb-catalogue-tools"><label class="mb-search form-label">Поиск по названию или пути<input type="search" class="form-control" data-mb="search" placeholder="Исполнитель или песня" autocomplete="off"></label><span data-mb="catalogue-notice"></span></div><div class="mb-file-list" data-mb="file-list" role="list" aria-label="Файлы выбранной папки"></div><div class="mb-pagination"><button type="button" data-mb="previous">← Назад</button><span data-mb="page-count"></span><button type="button" data-mb="next">Далее →</button></div></div></details>
    <section class="mb-transport content-panel content-panel-raised" aria-label="Проигрывание"><div class="mb-transport-line"><div class="studio-playback"><button type="button" class="primary-button button-compact" data-mb="play" disabled>Старт<span aria-hidden="true">▶</span></button><button type="button" class="secondary-button button-compact" data-mb="pause" disabled>Пауза</button><button type="button" class="secondary-button button-compact" data-mb="stop" disabled>Стоп</button></div><label class="mb-inline-field form-label">Скорость<select class="form-control form-control-compact" data-mb="speed"><option value="0.25">25%</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label><label class="mb-master">Громкость<input data-mb="master" type="range" min="0" max="1" step="0.05"></label></div>
      <div class="studio-timeline"><label><span class="mb-sr-only">Позиция в песне</span><input data-mb="seek" type="range" min="0" max="1" step="0.05" value="0" disabled></label><output data-mb="position">0:00 / 0:00</output></div>
      <div class="mb-range"><span class="mb-range-caption">Фрагмент · такты</span><label class="mb-sr-only" for="${id}-from">Первый такт</label><input id="${id}-from" data-mb="from" type="number" class="form-control form-control-compact" min="1" value="1" disabled><span>—</span><label class="mb-sr-only" for="${id}-to">Последний такт</label><input id="${id}-to" data-mb="to" type="number" class="form-control form-control-compact" min="1" value="4" disabled><button type="button" data-mb="apply-range" disabled>Выбрать</button><label class="mb-check"><input data-mb="loop" type="checkbox" aria-label="Повторять фрагмент партитуры" disabled>Повтор</label><button type="button" class="text-button button-compact" data-mb="full-range" disabled>Вся песня</button><span class="mb-current-bar" data-mb="current-bar"></span></div><p class="mb-range-description" data-mb="range-description"></p></section>
    <div class="mb-work"><section class="mb-sheet content-panel" aria-label="Партитура"><div class="mb-sheet-toolbar"><span class="mb-sheet-label" data-mb="sheet-label">Партитура</span><div class="mb-sheet-options"><label class="mb-check"><input data-mb="staff" type="checkbox">Ноты</label><label class="mb-check"><input data-mb="tab" type="checkbox">TAB</label><label class="mb-check mb-follow"><input data-mb="follow" type="checkbox">Следовать</label><button type="button" data-mb="toggle-mixer" aria-controls="${id}-mixer" aria-expanded="true">Микшер</button></div></div><div id="${id}-sheet" class="mb-sheet-scroll" data-mb="sheet-scroll" tabindex="0" aria-label="Прокрутка партитуры"><div class="mb-score" data-mb="score"></div><div class="mb-score-empty studio-empty" data-mb="empty"><span aria-hidden="true">♫</span><h3 data-mb="empty-heading">Музыка начинается с выбора</h3><p data-mb="empty-copy">Открой файл Guitar Pro. Звук синтезируется по нотам и не является записью исполнителя.</p></div></div></section>
      <aside id="${id}-mixer" class="mb-mixer content-panel content-panel-raised" data-mb="mixer" aria-label="Микшер инструментов"><div class="mb-mixer-heading panel-heading"><div><span class="mb-eyebrow">СОСТАВ АНСАМБЛЯ</span><h2>Инструменты <span data-mb="track-count"></span></h2></div><button type="button" class="text-button button-compact mb-close" data-mb="close-mixer" aria-label="Свернуть микшер">×</button></div><p class="mb-mixer-hint">Показывай одни партии, слушай другие.</p><div class="mb-mixer-scroll"><table class="mb-mixer-table"><thead class="mb-sr-only"><tr><th>Инструмент</th><th>Показывать</th><th>Звучит</th><th>Solo</th><th>Громкость</th></tr></thead><tbody data-mb="tracks"></tbody></table><p data-mb="mixer-empty">Партии появятся после выбора файла.</p></div></aside></div>
    <footer class="mb-footer"><p class="studio-status" data-mb="status" role="status" aria-live="polite"></p><p class="status-error" data-mb="error" role="alert" hidden></p><p class="mb-source-note">Файлы выбираются заново после открытия страницы. Каталог и звук не входят в резервную копию.</p></footer>`;

  function element<T extends HTMLElement = HTMLElement>(name: string) { return container.querySelector<T>(`[data-mb="${name}"]`)!; }
  let surface = element('score');
  const sheet = element('sheet-scroll');
  const fileInput = element<HTMLInputElement>('file'), folderInput = element<HTMLInputElement>('folder');
  const status = element('status'), errorOutput = element('error');
  function message(text: string, failure = '') {
    status.textContent = text; errorOutput.textContent = failure; errorOutput.hidden = !failure;
  }
  function notify() { if (!disposed) options.onPreferencesChange?.(getPreferences()); }
  function updatePreferences(patch: Partial<MusicBankPreferences>, save = true) {
    preferences = validateMusicBankPreferences({ ...preferences, ...patch });
    if (save) notify();
  }
  function getPreferences(): MusicBankPreferences { return validateMusicBankPreferences(preferences); }
  function ready() { return !!api && !!score && bound && api.isReadyForPlayback && !engineError; }
  function controls() {
    const canUse = ready() && !loading && visible && !document.hidden;
    for (const name of ['play', 'pause', 'stop', 'seek', 'from', 'to', 'apply-range', 'full-range', 'loop']) {
      (element(name) as HTMLButtonElement | HTMLInputElement).disabled = !canUse || name === 'play' && rangeInvalid;
    }
    // A pending intent must always have an accessible cancellation control.
    element<HTMLButtonElement>('cancel').hidden = !loading;
    element<HTMLButtonElement>('stop').disabled = !canUse && !loading;
    for (const name of ['speed', 'master', 'staff', 'tab', 'follow', 'toggle-mixer', 'close-mixer']) {
      element<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(name).disabled = loading;
    }
    for (const control of container.querySelectorAll<HTMLInputElement>('[data-control]')) control.disabled = loading || !bound;
    surface.setAttribute('aria-busy', String(loading));
    container.dataset.musicBankReady = String(ready() && !loading && !rangeInvalid);
    container.dataset.musicBankState = loading ? 'loading' : engineError ? 'error' : !bound ? preferences.file ? 'missing' : 'empty' : transportState;
    container.dataset.musicBankTrackCount = String(preferences.tracks.length);
  }
  function synchronizeFields() {
    const speed = element<HTMLSelectElement>('speed');
    for (const option of speed.querySelectorAll('[data-custom-speed]')) option.remove();
    if (![...speed.options].some(option => Number(option.value) === preferences.speed)) {
      const option = new Option(`${Math.round(preferences.speed * 100)}%`, String(preferences.speed));
      option.dataset.customSpeed = ''; speed.append(option);
    }
    speed.value = String(preferences.speed);
    element<HTMLInputElement>('master').value = String(preferences.master);
    element<HTMLInputElement>('staff').checked = preferences.notation.staff;
    element<HTMLInputElement>('tab').checked = preferences.notation.tab;
    element<HTMLInputElement>('follow').checked = preferences.follow;
    element<HTMLInputElement>('loop').checked = preferences.loop;
    const bars = preferences.file?.barCount ?? 1;
    element<HTMLInputElement>('from').max = element<HTMLInputElement>('to').max = String(bars);
    element<HTMLInputElement>('from').value = String(preferences.range?.fromBar ?? 1);
    element<HTMLInputElement>('to').value = String(preferences.range?.toBar ?? bars);
    rangeDescription(); synchronizeMixer();
  }
  function rangeDescription() {
    element('range-description').textContent = preferences.range
      ? `Такты ${preferences.range.fromBar}–${preferences.range.toBar}, первое вхождение при репризах.`
      : preferences.file ? 'Вся песня. Для фрагмента с репризами используется первое вхождение.' : '';
  }
  function synchronizeMixer(focus = false) {
    container.classList.toggle('mb-mixer-collapsed', !preferences.mixerOpen);
    const panel = element('mixer'); panel.hidden = !preferences.mixerOpen;
    element('toggle-mixer').setAttribute('aria-expanded', String(preferences.mixerOpen));
    if (focus) (preferences.mixerOpen ? element('close-mixer') : element('toggle-mixer')).focus({ preventScroll: true });
    scheduleLayout();
  }
  function setMixer(open: boolean, focus = false) {
    updatePreferences({ mixerOpen: open }); synchronizeMixer(focus);
  }
  function scheduleLayout() {
    if (disposed || !visible || layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      if (api && score && !disposed && visible && !surface.hidden) api.render();
    });
  }
  function measureHeight() {
    heightObservation.refresh();
  }
  function updateScoreInfo() {
    const file = preferences.file;
    const info = element('song-info');
    const label = file ? `${file.artist ? `${file.artist} — ` : ''}${file.title || file.name}` : '';
    info.textContent = file ? `${label} · ${file.trackCount} партий · ${file.barCount} тактов · ${file.name}` : 'Открой партитуру и выбери свой состав.';
    info.title = file ? info.textContent : '';
  }
  function empty(heading: string, copy: string) {
    surface.hidden = true; element('empty').hidden = false;
    element('empty-heading').textContent = heading; element('empty-copy').textContent = copy;
  }
  function renderNotation(initial = false) {
    if (!api || !score || !alphaTab) return;
    const selected = score.tracks.filter(track => preferences.tracks[track.index]?.visible);
    const displayed = preferences.notation.staff ? selected : preferences.notation.tab
      ? selected.filter(track => track.staves.some(staff => staff.isStringed)) : [];
    element('sheet-label').textContent = selected.length ? selected.map(track => track.name || `Партия ${track.index + 1}`).join(' · ') : 'Партитура';
    if (!displayed.length) {
      if (!selected.length) empty('Выбери партии для чтения', 'Отметь «Показывать» у нужного инструмента. Звук настраивается отдельно.');
      else if (!preferences.notation.staff && !preferences.notation.tab) empty('Ноты и TAB скрыты', 'Звучание не меняется. Включи любое представление для чтения.');
      else empty('У этих партий нет табулатуры', 'Для ударных и инструментов без струн включи ноты. Звучание не меняется.');
      return;
    }
    surface.hidden = false; element('empty').hidden = true;
    if (!initial) {
      api.settings.display.staveProfile = preferences.notation.staff ? preferences.notation.tab ? alphaTab.StaveProfile.ScoreTab : alphaTab.StaveProfile.Score : alphaTab.StaveProfile.Tab;
      api.updateSettings(); api.renderTracks(displayed);
    }
  }
  function applyMix(player = api, material = score, settings = preferences) {
    if (!player || !material) return;
    for (const track of material.tracks) {
      const mix = settings.tracks[track.index];
      player.changeTrackMute([track], !mix.audible);
      player.changeTrackSolo([track], mix.solo);
      player.changeTrackVolume([track], mix.volume);
    }
    player.masterVolume = settings.master;
    player.playbackSpeed = settings.speed;
  }
  function renderMixer() {
    const body = element<HTMLTableSectionElement>('tracks'); body.replaceChildren();
    for (const settings of preferences.tracks) {
      const track = score?.tracks[settings.index];
      const row = document.createElement('tr'); row.dataset.track = String(settings.index);
      const title = document.createElement('td'); title.textContent = settings.name || `Партия ${settings.index + 1}`;
      const detail = document.createElement('small');
      detail.textContent = !track ? 'Выбери исходный файл, чтобы вернуть партию.' : track.staves.some(staff => staff.isPercussion) ? 'Ударные'
        : track.staves[0]?.isStringed ? `${track.staves[0].tuning.length} струн` : 'Мелодический инструмент';
      title.append(detail); row.append(title);
      for (const [key, label] of [['visible', 'Показывать'], ['audible', 'Звучит'], ['solo', 'Solo'], ['volume', 'Громкость']] as const) {
        const cell = document.createElement('td'), input = document.createElement('input');
        input.dataset.control = key; input.dataset.trackControl = String(settings.index);
        input.type = key === 'volume' ? 'range' : 'checkbox'; input.disabled = !bound;
        input.setAttribute('aria-label', `${label}: ${settings.name || `Партия ${settings.index + 1}`}`);
        if (key === 'volume') { input.min = '0'; input.max = '1.5'; input.step = '0.05'; input.value = String(settings.volume); }
        else input.checked = settings[key];
        const output = document.createElement('output'); output.textContent = `${Math.round(settings.volume * 100)}%`;
        input.addEventListener(key === 'volume' ? 'input' : 'change', () => {
          if (disposed || !bound || !score || !api || loading) return;
          const value = key === 'volume' ? Number(input.value) : input.checked;
          const tracks = preferences.tracks.map(item => item.index === settings.index ? { ...item, [key]: value } : item);
          updatePreferences({ tracks });
          const currentTrack = score.tracks[settings.index], mix = preferences.tracks[settings.index];
          if (key === 'visible') renderNotation();
          else if (key === 'audible') api.changeTrackMute([currentTrack], !mix.audible);
          else if (key === 'solo') api.changeTrackSolo([currentTrack], mix.solo);
          else { api.changeTrackVolume([currentTrack], mix.volume); output.textContent = `${Math.round(mix.volume * 100)}%`; }
        }, listen);
        if (key === 'volume') cell.append(input, output);
        else { const wrapper = document.createElement('label'), text = document.createElement('span'); text.textContent = label; wrapper.append(input, text); cell.append(wrapper); }
        row.append(cell);
      }
      body.append(row);
    }
    element('track-count').textContent = preferences.tracks.length ? String(preferences.tracks.length) : '';
    element('mixer-empty').hidden = preferences.tracks.length > 0;
  }
  function setResources(player: BankApi, module: AlphaTabModule) {
    const style = getComputedStyle(container);
    const color = (name: string, fallback: string) => {
      const value = style.getPropertyValue(name).trim() || fallback;
      return module.model.Color.fromJson(value) ?? module.model.Color.fromJson(fallback)!;
    };
    const rendering = player.settings.display.resources;
    rendering.mainGlyphColor = color('--notation-ink', '#27372e');
    rendering.scoreInfoColor = rendering.mainGlyphColor;
    rendering.secondaryGlyphColor = color('--text-secondary', '#637168');
    rendering.staffLineColor = color('--border-strong', '#74836d');
    rendering.barSeparatorColor = rendering.staffLineColor;
    rendering.barNumberColor = color('--accent-text', '#345d42');
    player.updateSettings();
  }
  function resources() {
    if (!api || !alphaTab) return;
    setResources(api, alphaTab);
    if (score && api.score === score && !surface.hidden) api.render();
  }
  function discardPending() {
    const pending = pendingEngine;
    pendingEngine = null;
    if (pending) {
      pending.player?.cancelPreparation();
      destroyScorePlayer(pending.player?.api ?? null);
      pending.host.remove();
    }
  }
  function clearEngine() {
    const previous = api; api = null; score = null; bound = false;
    transportState = 'stopped';
    destroyScorePlayer(previous);
    surface.replaceChildren();
  }
  function applyRange(seek = false, player = api, settings = preferences): boolean {
    if (!player) return false;
    const range = settings.range;
    if (!range) { player.playbackRange = null; player.isLooping = settings.loop; return true; }
    const bars = player.tickCache?.masterBars ?? [];
    const first = bars.find(bar => bar.masterBar.index === range.fromBar - 1), last = bars.find(bar => bar.masterBar.index === range.toBar - 1);
    if (!first || !last || last.end <= first.start) return false;
    player.playbackRange = { startTick: first.start, endTick: last.end }; player.isLooping = settings.loop;
    if (seek) player.tickPosition = first.start;
    return true;
  }
  function invalidateRange() {
    api?.pause(); if (api) { api.playbackRange = null; api.isLooping = false; }
    rangeInvalid = true;
    updatePreferences({ range: null, loop: false });
    element<HTMLInputElement>('loop').checked = false;
    for (const name of ['from', 'to']) element(name).setAttribute('aria-invalid', 'true');
    rangeDescription(); controls();
    message('Воспроизведение приостановлено.', 'Недопустимый диапазон. Прежний фрагмент и повтор сняты. Исправь такты или выбери всю песню.');
  }
  function stage(candidate: BankScore, next: MusicBankPreferences, module: AlphaTabModule, active: () => boolean) {
    const host = document.createElement('div');
    host.className = 'mb-score mb-score-staging';
    host.inert = true;
    host.setAttribute('aria-hidden', 'true');
    sheet.append(host);
    const staged: PendingEngine = { host, player: null };
    pendingEngine = staged;
    const isPending = () => active() && pendingEngine === staged;
    const isCurrent = () => !disposed && staged.player !== null && api === staged.player.api;
    let position: ScorePosition | null = null;
    function showPosition(event: ScorePosition) {
      const seek = element<HTMLInputElement>('seek');
      seek.max = String(Math.max(0, event.endTime / 1000));
      seek.value = String(event.currentTime / 1000);
      element('position').textContent = `${timeLabel(event.currentTime)} / ${timeLabel(event.endTime)}`;
    }
    function fail(error: unknown) {
      if (!isPending()) return;
      discardPending(); loading = false; controls();
      message(preferences.file ? 'Прежняя партитура и её настройки сохранены.' : 'Файл не открыт.',
        failureText(error) || 'Не удалось загрузить звуковой банк. Выбери файл повторно.');
    }
    function settled() {
      if (!isPending()) return;
      let validRange: boolean;
      try {
        // The global theme can change while the candidate is waiting for its SoundFont.
        setResources(current, module);
        applyMix(current, candidate, next);
        validRange = applyRange(true, current, next);
      }
      catch (failure) { fail(failure); return; }
      if (!isPending()) return;
      pendingEngine = null;
      const previous = api;
      api = current; score = candidate; alphaTab = module; preferences = next;
      bound = true; loading = false; transportState = 'stopped'; engineError = ''; rangeInvalid = !validRange;
      host.inert = false;
      host.removeAttribute('aria-hidden');
      host.classList.remove('mb-score-staging');
      host.dataset.mb = 'score';
      surface.replaceWith(host);
      surface = host;
      destroyScorePlayer(previous);
      updateScoreInfo(); synchronizeFields(); renderMixer();
      element('current-bar').textContent = ''; element('position').textContent = '0:00 / 0:00';
      element<HTMLInputElement>('seek').value = '0';
      if (position) showPosition(position);
      for (const name of ['from', 'to']) element(name).removeAttribute('aria-invalid');
      renderNotation(true); scheduleLayout();
      message('Партитура открыта. Выбирай любые партии для чтения и звучания.',
        rangeInvalid ? 'Сохранённый фрагмент отсутствует в порядке исполнения. Выбери другой фрагмент или всю песню.' : '');
      controls(); notify();
    }
    staged.player = createScorePlayer(host, sheet, module, next, {
      ready: settled,
      error(error) {
        if (isPending()) { fail(error); return; }
        if (!isCurrent()) return;
        engineError = failureText(error); current.pause(); controls();
        message('Не удалось подготовить партитуру.', `${engineError} Выбери файл повторно, чтобы попробовать ещё раз.`);
      },
      position(event) { if (isPending()) position = event; else if (isCurrent()) showPosition(event); },
      bar(index) { if (isCurrent()) element('current-bar').textContent = `Такт ${index + 1} из ${candidate.masterBars.length}`; },
      transport(state) { if (isCurrent()) { transportState = state; controls(); } },
    });
    const current = staged.player.api;
    setResources(current, module);
    const shown = candidate.tracks.filter(track => next.tracks[track.index].visible && (next.notation.staff || next.notation.tab && track.staves.some(staff => staff.isStringed)));
    staged.player.prepare(candidate, shown.map(track => track.index));
    controls();
  }
  async function openFile(file: File, relativePath: string | null = null) {
    if (disposed || !visible || document.hidden) return;
    const request = ++intent;
    discardPending();
    const active = () => !disposed && visible && !document.hidden && request === intent;
    api?.pause(); loading = true; message(`Читаем «${file.name}»…`); controls();
    try {
      if (file.size < 1 || file.size > MUSIC_BANK_LIMITS.maxFileBytes) throw new Error(`Нужен непустой файл не больше ${MUSIC_BANK_LIMITS.maxFileBytes / 1048576} МиБ.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!active()) return;
      if (bytes.byteLength !== file.size) throw new Error('Файл изменился во время чтения. Выбери его заново; прежняя партитура сохранена.');
      const [module, sha256] = await Promise.all([loadAlphaTab(), musicBankSha256(bytes)]);
      if (!active()) return;
      const candidate = module.importer.ScoreLoader.loadScoreFromBytes(bytes, new module.Settings());
      const channels = new Set<number>();
      for (const track of candidate.tracks) for (const channel of new Set([track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel])) {
        if (channels.has(channel)) throw new Error('В этом файле не удалось разделить звуковые каналы партий. Независимый микшер недоступен.');
        channels.add(channel);
      }
      const descriptor = { name: file.name, size: file.size, sha256, relativePath,
        title: candidate.title, artist: candidate.artist, trackCount: candidate.tracks.length, barCount: candidate.masterBars.length };
      const sameFile = preferences.file?.sha256 === sha256 && preferences.file.size === file.size;
      const tracks: readonly MusicBankTrackPreferences[] = sameFile ? preferences.tracks : candidate.tracks.map((track, index) => ({
        index, name: track.name, visible: index === 0, audible: !track.playbackInfo.isMute, solo: track.playbackInfo.isSolo, volume: 1,
      }));
      const next = validateMusicBankPreferences({ ...preferences, file: descriptor, tracks,
        range: sameFile ? preferences.range : null, loop: sameFile ? preferences.loop : false });
      if (!active()) return;
      stage(candidate, next, module, active);
    } catch (failure) {
      if (!active()) return;
      discardPending(); loading = false;
      const text = failureText(failure);
      const unsupported = /No compatible importer|Unsupported version|unsupported format/iu.test(text);
      message(preferences.file ? 'Прежняя партитура и её настройки сохранены.' : 'Файл не открыт.',
        unsupported ? `Этот формат файла не поддерживается. Старый GTP v1.04 открыть нельзя. ${text}` : text);
      controls();
    }
  }
  function cancelLoad(showNotice = true) {
    const pending = loading; ++intent; loading = false;
    discardPending();
    controls(); if (pending && showNotice) message('Загрузка отменена. Прежняя партитура и её настройки сохранены.');
  }
  function stop() {
    if (disposed) return;
    cancelLoad(false); api?.stop(); controls();
  }
  function play() {
    if (!ready() || loading || rangeInvalid || disposed || !visible || document.hidden) return;
    const current = api!;
    if (options.onBeforePlay?.() === false) return;
    if (disposed || !visible || document.hidden || current !== api) return;
    applyMix();
    if (!current.play()) message('Проигрыватель ещё не готов. Нажми «Старт» повторно.');
  }
  function catalogueView() {
    const filtered = searchMusicBankCatalog(catalogue, element<HTMLInputElement>('search').value);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); cataloguePage = Math.max(0, Math.min(cataloguePage, pages - 1));
    const list = element('file-list'); list.replaceChildren();
    for (const entry of filtered.slice(cataloguePage * PAGE_SIZE, (cataloguePage + 1) * PAGE_SIZE)) {
      const item = document.createElement('div'), button = document.createElement('button'), path = document.createElement('small');
      item.setAttribute('role', 'listitem'); button.type = 'button'; button.textContent = entry.name; button.dataset.catalogueId = entry.id;
      path.textContent = entry.relativePath ?? entry.name; button.title = path.textContent;
      const size = document.createElement('span'); size.textContent = `${Math.ceil(entry.size / 1024)} КиБ`;
      button.append(path, size); item.append(button); list.append(item);
    }
    if (!filtered.length) { const hint = document.createElement('p'); hint.textContent = catalogue.length ? 'Совпадений нет.' : 'Выбери папку с музыкальными файлами.'; list.append(hint); }
    element('catalogue-count').textContent = catalogue.length ? String(catalogue.length) : 'не выбраны';
    element('page-count').textContent = `${filtered.length} файлов · ${cataloguePage + 1} / ${pages}`;
    element<HTMLButtonElement>('previous').disabled = cataloguePage === 0;
    element<HTMLButtonElement>('next').disabled = cataloguePage >= pages - 1;
  }
  fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; fileInput.value = ''; if (file) void openFile(file); }, listen);
  folderInput.addEventListener('change', () => {
    const files = [...folderInput.files ?? []]; folderInput.value = ''; if (!files.length || disposed) return;
    try {
      const eligible = files.filter(file => file.size > 0 && file.size <= MUSIC_BANK_LIMITS.maxFileBytes);
      const next = createMusicBankCatalog(eligible);
      catalogue = next; cataloguePage = 0; element<HTMLInputElement>('search').value = '';
      element('catalogue-notice').textContent = files.length > eligible.length ? `Пропущено по размеру: ${files.length - eligible.length}.` : 'Имена и пути. Партитура читается только после выбора.';
      element<HTMLDetailsElement>('catalogue').open = true; catalogueView(); measureHeight();
    } catch (failure) { message('Прежний каталог сохранён.', failureText(failure)); }
  }, listen);
  element('file-list').addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-catalogue-id]');
    const entry = button && catalogue.find(item => item.id === button.dataset.catalogueId);
    if (entry) { element<HTMLDetailsElement>('catalogue').open = false; measureHeight(); void openFile(entry.file, entry.relativePath); }
  }, listen);
  element('search').addEventListener('input', () => { cataloguePage = 0; catalogueView(); }, listen);
  element('previous').addEventListener('click', () => { cataloguePage--; catalogueView(); }, listen);
  element('next').addEventListener('click', () => { cataloguePage++; catalogueView(); }, listen);
  element('catalogue').addEventListener('toggle', measureHeight, listen);
  element('cancel').addEventListener('click', () => cancelLoad(), listen);
  element('play').addEventListener('click', play, listen);
  element('pause').addEventListener('click', () => { api?.pause(); controls(); }, listen);
  element('stop').addEventListener('click', () => { if (loading) cancelLoad(); else stop(); }, listen);
  element('speed').addEventListener('change', () => {
    updatePreferences({ speed: Number(element<HTMLSelectElement>('speed').value) });
    if (api) api.playbackSpeed = preferences.speed;
  }, listen);
  element('master').addEventListener('input', () => {
    updatePreferences({ master: Number(element<HTMLInputElement>('master').value) });
    if (api) api.masterVolume = preferences.master;
  }, listen);
  element('seek').addEventListener('input', () => { if (api && ready() && !loading) api.timePosition = Number(element<HTMLInputElement>('seek').value) * 1000; }, listen);
  element('loop').addEventListener('change', () => {
    if (!ready() || rangeInvalid || loading) return;
    updatePreferences({ loop: element<HTMLInputElement>('loop').checked }); if (api) api.isLooping = preferences.loop;
  }, listen);
  element('apply-range').addEventListener('click', () => {
    if (!ready() || loading) return;
    const fromBar = Number(element<HTMLInputElement>('from').value), toBar = Number(element<HTMLInputElement>('to').value);
    if (!Number.isInteger(fromBar) || !Number.isInteger(toBar) || fromBar < 1 || toBar < fromBar || toBar > (preferences.file?.barCount ?? 0)) { invalidateRange(); return; }
    const next = validateMusicBankPreferences({ ...preferences, range: { fromBar, toBar } });
    const previous = preferences; preferences = next;
    if (!applyRange(true)) { preferences = previous; invalidateRange(); return; }
    api?.pause(); rangeInvalid = false; for (const name of ['from', 'to']) element(name).removeAttribute('aria-invalid');
    notify(); rangeDescription(); controls(); message(`Выбраны такты ${fromBar}–${toBar}.`);
  }, listen);
  element('full-range').addEventListener('click', () => {
    if (!ready() || loading) return;
    rangeInvalid = false; updatePreferences({ range: null }); applyRange();
    for (const name of ['from', 'to']) element(name).removeAttribute('aria-invalid');
    synchronizeFields(); controls(); message('Выбрана вся песня.');
  }, listen);
  for (const [name, key] of [['staff', 'staff'], ['tab', 'tab']] as const) element(name).addEventListener('change', () => {
    updatePreferences({ notation: { ...preferences.notation, [key]: element<HTMLInputElement>(name).checked } }); renderNotation();
  }, listen);
  element('follow').addEventListener('change', () => {
    updatePreferences({ follow: element<HTMLInputElement>('follow').checked });
    if (api && alphaTab) { api.settings.player.scrollMode = preferences.follow ? alphaTab.ScrollMode.Continuous : alphaTab.ScrollMode.Off; api.updateSettings(); }
  }, listen);
  element('toggle-mixer').addEventListener('click', () => setMixer(!preferences.mixerOpen, container.clientWidth <= 900), listen);
  element('close-mixer').addEventListener('click', () => setMixer(false, true), listen);
  container.addEventListener('keydown', event => {
    if (disposed || !visible || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' && preferences.mixerOpen && container.clientWidth <= 900 && element('mixer').contains(target)) {
      setMixer(false, true); event.preventDefault(); return;
    }
    handleTransportKey(event, container, { stop, toggle: () => { if (api?.playerState === 1) api.pause(); else play(); } });
  }, listen);
  onPageVisibility(abort.signal, () => {
    if (disposed) return;
    cancelLoad(false); api?.pause(); controls();
    if (bound) message('Пауза: вкладка скрыта. Для продолжения нажми «Старт».');
  }, () => { if (!disposed) controls(); });
  const heightObservation = options.observeHeight(container, available => {
    const height = `${Math.max(360, available)}px`;
    if (container.style.getPropertyValue('--mb-height') !== height) container.style.setProperty('--mb-height', height);
  });
  const observer = new MutationObserver(resources); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function applyPreferences(next: MusicBankPreferences | null) {
    const checked = validateMusicBankPreferences(next ?? DEFAULT_MUSIC_BANK_PREFERENCES);
    cancelLoad(false); clearEngine(); preferences = checked; engineError = ''; rangeInvalid = false;
    synchronizeFields(); updateScoreInfo(); renderMixer();
    empty(checked.file ? 'Нужен исходный файл' : 'Музыка начинается с выбора', checked.file
      ? `Выбери «${checked.file.name}» заново. Совпадение проверяется по содержимому; сохранённый микшер и фрагмент вернутся.`
      : 'Открой файл Guitar Pro. Звук синтезируется по нотам и не является записью исполнителя.');
    message(checked.file ? 'Настройки восстановлены. Для запуска выбери исходный файл.' : 'Выбери файл. Звук начнётся только по кнопке «Старт».'); controls();
  }
  function setVisible(next: boolean) {
    if (disposed || visible === next) return;
    visible = next; container.hidden = !next;
    if (!next) { stop(); return; }
    measureHeight(); controls(); scheduleLayout();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ++intent; loading = false; discardPending(); clearEngine();
    abort.abort(); heightObservation.dispose(); observer.disconnect();
    cancelAnimationFrame(layoutFrame);
    catalogue = []; container.replaceChildren(); container.classList.remove('music-bank', 'mb-mixer-collapsed');
    container.style.removeProperty('--mb-height');
  }
  catalogueView(); applyPreferences(options.preferences ?? null);
  return { setVisible, stop, cancelPending() { if (loading) cancelLoad(); }, applyPreferences, getPreferences, dispose };
}
