import './music-bank.css';
import { loadAlphaTab, musicBankAssets, type AlphaTabModule } from '../music-bank/engine';
import {
  DEFAULT_MUSIC_BANK_PREFERENCES, MUSIC_BANK_LIMITS, musicBankSha256,
  validateMusicBankPreferences, type MusicBankPreferences, type MusicBankTrackPreferences,
} from '../music-bank/model';
import { createMusicBankCatalog, searchMusicBankCatalog, type MusicBankCatalogEntry } from '../music-bank/catalog';

type BankApi = InstanceType<AlphaTabModule['AlphaTabApi']>;
type BankScore = NonNullable<BankApi['score']>;
export interface MusicBankOptions {
  readonly preferences?: MusicBankPreferences | null;
  readonly onBeforePlay?: () => void;
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
export function mountMusicBank(container: HTMLElement, options: MusicBankOptions = {}) {
  const id = `music-bank-${++instance}`;
  const abort = new AbortController();
  const listen = { signal: abort.signal };
  let preferences = validateMusicBankPreferences(options.preferences ?? DEFAULT_MUSIC_BANK_PREFERENCES);
  let alphaTab: AlphaTabModule | null = null;
  let api: BankApi | null = null;
  let score: BankScore | null = null;
  let disposed = false, visible = false, bound = false, loading = false;
  let intent = 0, epoch = 0, rendered = false, midi = false, engineError = '', rangeInvalid = false;
  let transportState: 'stopped' | 'paused' | 'playing' = 'stopped';
  let catalogue: readonly MusicBankCatalogEntry[] = [], cataloguePage = 0;
  let heightFrame = 0, layoutFrame = 0, notifiedInitialLoad = false;
  container.classList.add('music-bank');
  container.dataset.testid = 'music-bank';
  container.hidden = true;
  container.innerHTML = `
    <header class="mb-heading"><div class="mb-song-copy"><span class="mb-eyebrow">ИГРА С АНСАМБЛЕМ</span><h2 data-mb="title">Табулатура и ноты</h2><p data-mb="song-info">Открой партитуру и выбери свой состав.</p></div>
      <div class="mb-file-actions"><label class="mb-button">Открыть файл<input data-mb="file" data-music-bank-file type="file" class="mb-sr-only" aria-label="Открыть музыкальный файл"></label><label class="mb-button">Выбрать папку<input data-mb="folder" data-music-bank-folder type="file" webkitdirectory multiple class="mb-sr-only" aria-label="Выбрать папку с партитурами"></label><button type="button" data-mb="cancel" hidden>Отменить загрузку</button></div></header>
    <details class="mb-catalogue" data-mb="catalogue"><summary>Файлы папки <span data-mb="catalogue-count">не выбраны</span></summary><div class="mb-catalogue-body"><div class="mb-catalogue-tools"><label class="mb-search">Поиск по названию или пути<input type="search" data-mb="search" placeholder="Исполнитель или песня" autocomplete="off"></label><span data-mb="catalogue-notice"></span></div><div class="mb-file-list" data-mb="file-list" role="list" aria-label="Файлы выбранной папки"></div><div class="mb-pagination"><button type="button" data-mb="previous">← Назад</button><span data-mb="page-count"></span><button type="button" data-mb="next">Далее →</button></div></div></details>
    <section class="mb-transport" aria-label="Проигрывание"><div class="mb-transport-line"><div class="mb-playback"><button type="button" class="mb-primary" data-mb="play" disabled>▶ Старт</button><button type="button" data-mb="pause" disabled>Пауза</button><button type="button" data-mb="stop" disabled>Стоп</button></div><label class="mb-inline-field">Скорость<select data-mb="speed"><option value="0.25">25%</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label><label class="mb-master">Громкость<input data-mb="master" type="range" min="0" max="1" step="0.05"></label><output class="mb-time" data-mb="position">0:00 / 0:00</output></div>
      <label class="mb-seek"><span class="mb-sr-only">Позиция в песне</span><input data-mb="seek" type="range" min="0" max="1" step="0.05" value="0" disabled></label>
      <div class="mb-range"><span class="mb-range-caption">Фрагмент · такты</span><label class="mb-sr-only" for="${id}-from">Первый такт</label><input id="${id}-from" data-mb="from" type="number" min="1" value="1" disabled><span>—</span><label class="mb-sr-only" for="${id}-to">Последний такт</label><input id="${id}-to" data-mb="to" type="number" min="1" value="4" disabled><button type="button" data-mb="apply-range" disabled>Выбрать</button><label class="mb-check"><input data-mb="loop" type="checkbox" aria-label="Повторять фрагмент партитуры" disabled>Повтор</label><button type="button" class="mb-text-button" data-mb="full-range" disabled>Вся песня</button><span class="mb-current-bar" data-mb="current-bar"></span></div><p class="mb-range-description" data-mb="range-description"></p></section>
    <div class="mb-work"><section class="mb-sheet" aria-label="Партитура"><div class="mb-sheet-toolbar"><span class="mb-sheet-label" data-mb="sheet-label">Партитура</span><div class="mb-sheet-options"><label class="mb-check"><input data-mb="staff" type="checkbox">Ноты</label><label class="mb-check"><input data-mb="tab" type="checkbox">TAB</label><label class="mb-check mb-follow"><input data-mb="follow" type="checkbox">Следовать</label><button type="button" data-mb="toggle-mixer" aria-controls="${id}-mixer" aria-expanded="true">Микшер</button></div></div><div id="${id}-sheet" class="mb-sheet-scroll" data-mb="sheet-scroll" tabindex="0" aria-label="Прокрутка партитуры"><div class="mb-score" data-mb="score"></div><div class="mb-score-empty" data-mb="empty"><span aria-hidden="true">♫</span><h3 data-mb="empty-heading">Музыка начинается с выбора</h3><p data-mb="empty-copy">Открой файл Guitar Pro. Звук синтезируется по нотам и не является записью исполнителя.</p></div></div></section>
      <aside id="${id}-mixer" class="mb-mixer" data-mb="mixer" aria-label="Микшер инструментов"><div class="mb-mixer-heading"><div><span class="mb-eyebrow">СОСТАВ АНСАМБЛЯ</span><h3>Инструменты <span data-mb="track-count"></span></h3></div><button type="button" class="mb-text-button mb-close" data-mb="close-mixer" aria-label="Свернуть микшер">×</button></div><p class="mb-mixer-hint">Показывай одни партии, слушай другие.</p><div class="mb-mixer-scroll"><table class="mb-mixer-table"><thead class="mb-sr-only"><tr><th>Инструмент</th><th>Показывать</th><th>Звучит</th><th>Solo</th><th>Громкость</th></tr></thead><tbody data-mb="tracks"></tbody></table><p data-mb="mixer-empty">Партии появятся после выбора файла.</p></div></aside></div>
    <footer class="mb-footer"><p data-mb="status" role="status" aria-live="polite"></p><p data-mb="error" role="alert" hidden></p><p class="mb-source-note">Файлы выбираются заново после открытия страницы. Каталог и звук не входят в резервную копию.</p></footer>`;

  function element<T extends HTMLElement = HTMLElement>(name: string) { return container.querySelector<T>(`[data-mb="${name}"]`)!; }
  const surface = element('score');
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
  function ready() { return !!api && !!score && bound && rendered && midi && api.isReadyForPlayback && !engineError; }
  function controls() {
    const canUse = ready() && !loading && visible && !document.hidden;
    for (const name of ['play', 'pause', 'stop', 'seek', 'from', 'to', 'apply-range', 'full-range', 'loop']) {
      (element(name) as HTMLButtonElement | HTMLInputElement).disabled = !canUse || name === 'play' && rangeInvalid;
    }
    // A pending intent must always have an accessible cancellation control.
    element<HTMLButtonElement>('cancel').hidden = !loading;
    element<HTMLButtonElement>('stop').disabled = !canUse && !loading;
    for (const control of container.querySelectorAll<HTMLInputElement>('[data-control]')) control.disabled = loading || !bound;
    surface.setAttribute('aria-busy', String(loading || bound && (!rendered || !midi)));
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
    if (disposed || !visible || heightFrame) return;
    heightFrame = requestAnimationFrame(() => {
      heightFrame = 0;
      if (disposed || !visible) return;
      // Scrolling to history must not resize the score area above it.
      const top = Math.max(0, container.getBoundingClientRect().top + window.scrollY);
      const height = `${Math.max(360, Math.floor(innerHeight - top - 16))}px`;
      if (container.style.getPropertyValue('--mb-height') !== height) container.style.setProperty('--mb-height', height);
    });
  }
  function scoreHeading() {
    const file = preferences.file;
    element('title').textContent = file ? `${file.artist ? `${file.artist} — ` : ''}${file.title || file.name}` : 'Табулатура и ноты';
    element('song-info').textContent = file ? `${file.trackCount} партий · ${file.barCount} тактов · ${file.name}` : 'Открой партитуру и выбери свой состав.';
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
  function applyMix() {
    if (!api || !score) return;
    for (const track of score.tracks) {
      const settings = preferences.tracks[track.index];
      api.changeTrackMute([track], !settings.audible);
      api.changeTrackSolo([track], settings.solo);
      api.changeTrackVolume([track], settings.volume);
    }
    api.masterVolume = preferences.master; api.playbackSpeed = preferences.speed;
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
  function resources() {
    if (!api || !alphaTab) return;
    const style = getComputedStyle(container);
    const color = (name: string, fallback: string) => {
      const value = style.getPropertyValue(name).trim() || fallback;
      return alphaTab!.model.Color.fromJson(value) ?? alphaTab!.model.Color.fromJson(fallback)!;
    };
    const rendering = api.settings.display.resources;
    rendering.mainGlyphColor = color('--notation-ink', '#27372e');
    rendering.scoreInfoColor = rendering.mainGlyphColor;
    rendering.secondaryGlyphColor = color('--text-secondary', '#637168');
    rendering.staffLineColor = color('--border-strong', '#74836d');
    rendering.barSeparatorColor = rendering.staffLineColor;
    rendering.barNumberColor = color('--accent-text', '#345d42');
    api.updateSettings(); if (score && api.score === score && !surface.hidden) api.render();
  }
  function clearEngine() {
    ++epoch; const previous = api; api = null; score = null; bound = false; rendered = false; midi = false;
    transportState = 'stopped';
    if (previous) { previous.stop(); previous.destroy(); }
    surface.replaceChildren();
  }
  function applyRange(seek = false): boolean {
    if (!api || !score) return false;
    const range = preferences.range;
    if (!range) { api.playbackRange = null; api.isLooping = preferences.loop; return true; }
    const bars = api.tickCache?.masterBars ?? [];
    const first = bars.find(bar => bar.masterBar.index === range.fromBar - 1), last = bars.find(bar => bar.masterBar.index === range.toBar - 1);
    if (!first || !last || last.end <= first.start) return false;
    api.playbackRange = { startTick: first.start, endTick: last.end }; api.isLooping = preferences.loop;
    if (seek) api.tickPosition = first.start;
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
  function accepted(candidate: BankScore, next: MusicBankPreferences, module: AlphaTabModule) {
    clearEngine(); preferences = next; alphaTab = module;
    engineError = ''; rangeInvalid = false; notifiedInitialLoad = false;
    score = candidate; bound = true; rendered = false; midi = false; loading = false;
    const assets = musicBankAssets();
    surface.hidden = false; element('empty').hidden = true;
    const current = new module.AlphaTabApi(surface, {
      core: { scriptFile: assets.moduleUrl, fontDirectory: assets.fontDirectory, engine: 'svg' },
      display: { staveProfile: preferences.notation.staff ? preferences.notation.tab ? module.StaveProfile.ScoreTab : module.StaveProfile.Score : module.StaveProfile.Tab },
      player: { playerMode: module.PlayerMode.EnabledSynthesizer, soundFont: assets.soundFont, enableCursor: true,
        enableUserInteraction: true, scrollElement: `#${id}-sheet`, scrollOffsetY: -12,
        scrollMode: preferences.follow ? module.ScrollMode.Continuous : module.ScrollMode.Off }
    });
    api = current; const currentEpoch = epoch;
    const isCurrent = () => !disposed && api === current && epoch === currentEpoch && current.score === candidate;
    function settled() {
      if (!isCurrent()) return;
      if (ready() && !notifiedInitialLoad) {
        notifiedInitialLoad = true; renderNotation(true);
        if (!rangeInvalid) message('Партитура открыта. Выбирай любые партии для чтения и звучания.');
        notify();
      }
      controls();
    }
    current.error.on(error => {
      if (!isCurrent()) return;
      engineError = failureText(error); current.pause(); controls();
      message('Не удалось подготовить партитуру.', `${engineError} Выбери файл повторно, чтобы попробовать ещё раз.`);
    });
    current.renderFinished.on(() => { if (isCurrent()) { rendered = true; settled(); } });
    current.midiLoaded.on(() => {
      if (!isCurrent()) return;
      applyMix(); midi = true;
      if (!applyRange(true)) { rangeInvalid = true; message('Партитура открыта.', 'Сохранённый фрагмент отсутствует в порядке исполнения. Выбери другой фрагмент или всю песню.'); }
      settled();
    });
    current.playerReady.on(() => {
      // alphaTab applies source volumes after raising playerReady. Reapply the
      // complete visible mixer after that handler, including default/false values.
      queueMicrotask(() => { if (isCurrent()) { applyMix(); settled(); } });
    });
    current.playerPositionChanged.on(event => {
      if (!isCurrent()) return;
      const seek = element<HTMLInputElement>('seek'); seek.max = String(Math.max(0, event.endTime / 1000)); seek.value = String(event.currentTime / 1000);
      element('position').textContent = `${timeLabel(event.currentTime)} / ${timeLabel(event.endTime)}`;
    });
    current.playedBeatChanged.on(beat => {
      if (!isCurrent()) return;
      element('current-bar').textContent = `Такт ${beat.voice.bar.index + 1} из ${candidate.masterBars.length}`;
    });
    current.playerStateChanged.on(event => {
      if (!isCurrent()) return;
      transportState = event.state === 1 ? 'playing' : event.stopped ? 'stopped' : 'paused'; controls();
    });
    scoreHeading(); synchronizeFields(); renderMixer();
    element('current-bar').textContent = ''; element('position').textContent = '0:00 / 0:00';
    for (const name of ['from', 'to']) element(name).removeAttribute('aria-invalid');
    resources();
    const shown = candidate.tracks.filter(track => preferences.tracks[track.index].visible && (preferences.notation.staff || preferences.notation.tab && track.staves.some(staff => staff.isStringed)));
    // A fresh player also resets previous-channel overrides explicitly before MIDI generation.
    current.player?.resetChannelStates();
    current.renderScore(candidate, shown.length ? shown.map(track => track.index) : [0]);
    controls();
  }
  async function openFile(file: File, relativePath: string | null = null) {
    if (disposed || !visible || document.hidden) return;
    const request = ++intent;
    let replaced = false;
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
      replaced = true; accepted(candidate, next, module);
    } catch (failure) {
      if (!active()) return;
      loading = false;
      const text = failureText(failure);
      if (replaced) {
        clearEngine(); engineError = text; scoreHeading(); synchronizeFields(); renderMixer();
        empty('Не удалось подготовить партитуру', 'Выбери исходный файл повторно, чтобы попробовать ещё раз.');
        message('Проигрывание недоступно.', text); controls(); return;
      }
      const unsupported = /No compatible importer|Unsupported version|unsupported format/iu.test(text);
      message(preferences.file ? 'Прежняя партитура и её настройки сохранены.' : 'Файл не открыт.',
        unsupported ? `Этот формат файла не поддерживается. Старый GTP v1.04 открыть нельзя. ${text}` : text);
      controls();
    }
  }
  function cancelLoad(showNotice = true) {
    const pending = loading; ++intent; loading = false;
    controls(); if (pending && showNotice) message('Загрузка отменена. Прежняя партитура и её настройки сохранены.');
  }
  function stop() {
    if (disposed) return;
    cancelLoad(false); api?.stop(); controls();
  }
  function play() {
    if (!ready() || loading || rangeInvalid || disposed || !visible || document.hidden) return;
    const current = api!;
    options.onBeforePlay?.();
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
  element('stop').addEventListener('click', stop, listen);
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
    if (target.closest('input,select,textarea,button,a,summary,[contenteditable="true"]')) return;
    if (event.key === 'Escape') { stop(); event.preventDefault(); return; }
    if (event.code !== 'Space') return;
    event.preventDefault(); if (api?.playerState === 1) api.pause(); else play();
  }, listen);
  document.addEventListener('visibilitychange', () => {
    if (disposed) return;
    if (!document.hidden) { controls(); return; }
    cancelLoad(false); api?.pause(); controls();
    if (bound) message('Пауза: вкладка скрыта. Для продолжения нажми «Старт».');
  }, listen);
  window.addEventListener('resize', measureHeight, listen);
  const resize = new ResizeObserver(measureHeight); resize.observe(container);
  const layoutHost = container.closest('.app-content');
  if (layoutHost) resize.observe(layoutHost);
  const observer = new MutationObserver(resources); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function applyPreferences(next: MusicBankPreferences | null) {
    const checked = validateMusicBankPreferences(next ?? DEFAULT_MUSIC_BANK_PREFERENCES);
    cancelLoad(false); clearEngine(); preferences = checked; engineError = ''; rangeInvalid = false;
    synchronizeFields(); scoreHeading(); renderMixer();
    empty(checked.file ? 'Нужен исходный файл' : 'Музыка начинается с выбора', checked.file
      ? `Выбери «${checked.file.name}» заново. Совпадение проверяется по содержимому; сохранённый микшер и фрагмент вернутся.`
      : 'Открой файл Guitar Pro. Звук синтезируется по нотам и не является записью исполнителя.');
    message(checked.file ? 'Настройки восстановлены. Для запуска выбери исходный файл.' : 'Выбери файл. Звук начнётся только по кнопке «Старт».'); controls();
  }
  function setVisible(next: boolean) {
    if (disposed) return;
    visible = next; container.hidden = !next;
    if (!next) { stop(); return; }
    measureHeight(); controls(); scheduleLayout();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ++intent; loading = false; clearEngine();
    abort.abort(); resize.disconnect(); observer.disconnect();
    cancelAnimationFrame(heightFrame); cancelAnimationFrame(layoutFrame);
    catalogue = []; container.replaceChildren(); container.classList.remove('music-bank', 'mb-mixer-collapsed');
    container.style.removeProperty('--mb-height');
  }
  catalogueView(); applyPreferences(options.preferences ?? null);
  return { setVisible, stop, applyPreferences, getPreferences, dispose };
}
