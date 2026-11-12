import './rhythm.css';
import { createRhythmPlayer, type RhythmPracticeClock, type RhythmViewSnapshot } from '../audio/rhythm';
import {
  DEFAULT_RHYTHM_PREFERENCES, RHYTHM_PATTERN_LENGTHS, RHYTHM_PRESETS, RHYTHM_STEPS_PER_BAR, SOUND_LABELS,
  createDefaultRhythmProject, defaultRhythmAccents, defaultRhythmMeter,
  validateRhythmPreferences, validateRhythmProject, type RhythmBpmUnit, type RhythmDivision, type RhythmKit,
  type RhythmPatternBars, type RhythmPatternId, type RhythmPlaybackConfig, type RhythmPreferences,
  type RhythmProject, type RhythmSound, type RhythmStep, type RhythmSwingMode,
} from '../rhythm/model';
import { applyRhythmProjectEdit, copyRhythmBar, metronomeTempo, playbackForRhythmRun, withProjectTempo, type RhythmBarCopy, type RhythmProjectEdit } from '../rhythm/editor';
import { confirmAction } from './confirm';
import { bindPageTabs } from './page-tabs';
import { handleTransportKey } from './transport-shortcut';
import { onPageVisibility } from './page-visibility';
import { bindRhythmDial, paintRhythmDial, rhythmMarkup } from './rhythm/view';
import {
  RHYTHM_KITS, paintRhythmFader as paintFader, rhythmBarButtons, rhythmBeatGroups, rhythmChainClips, rhythmClipEditor, rhythmKitButtons,
  rhythmMixerStrips, rhythmPatternButtons, rhythmPresetButtons, rhythmProjectRows, rhythmRackRows, rhythmSoundButtons, rhythmVelocityRow,
} from './rhythm/editor-dom';
import { createRhythmLibrary, type RhythmLibrary, type RhythmLibraryOperation } from './rhythm/library';

export type { RhythmLibrary, RhythmLibraryOperation } from './rhythm/library';
export interface RhythmOptions {
  readonly onBeforeStart?: () => boolean | void;
  readonly onPreferencesChange?: () => void;
  readonly onLibraryChange?: (operation: RhythmLibraryOperation, onCommit: (library: RhythmLibrary) => void) => Promise<void>;
  readonly onLibraryRetry?: () => Promise<boolean>;
  readonly onPracticeEnd?: (practice: RhythmPracticeClock) => void;
  readonly onPracticeChange?: () => void;
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
const clone = <T,>(value: T) => structuredClone(value) as Mutable<T>;
const nextPatternLength = (bars: RhythmPatternBars) => RHYTHM_PATTERN_LENGTHS.find(length => length > bars);
const TRAINING_NUMBERS = ['soundBars', 'silentBars', 'stepBpm', 'everyBars', 'targetBpm'] as const;
const TRAINING_FLAGS = ['silentEnabled', 'rampEnabled'] as const;
const STARTED = new Set(['starting', 'running', 'finishing']);
const TRANSPORT_LABELS = { starting: 'Подготовка звука…', running: 'Играет', paused: 'Пауза', finishing: 'Завершение', finished: 'Проход завершён', stopped: 'Остановлено' };
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error);
let instance = 0;

function setMetronomeTempo(metronome: Mutable<RhythmPreferences['metronome']>, bpm: number) {
  const next = metronomeTempo(metronome, bpm);
  metronome.bpm = next.bpm;
  metronome.training.targetBpm = next.targetBpm;
}

export function mountRhythm(container: HTMLElement, options: RhythmOptions = {}) {
  const listener = new AbortController();
  const listen = { signal: listener.signal };
  let visible = !container.hidden, disposed = false;
  let preferences = DEFAULT_RHYTHM_PREFERENCES;
  const newProject = (name?: string) => createDefaultRhythmProject(crypto.randomUUID(), name);
  let project = newProject();
  let selectedBar = 0, selectedStep = 0, selectedLane = project.channels[0].id;
  let selectedSound: RhythmSound | null = null;
  let selectedClip: string | null = null;
  let copiedBar: RhythmBarCopy | null = null;
  let runIntent = 0;
  let snapshot: RhythmViewSnapshot | null = null, practiceKey = '';
  let presetId: string | null = 'rock';
  let taps: number[] = [];
  let faderGesture: { readonly pointerId: number; readonly input: HTMLInputElement; readonly value: string; readonly level: string | null } | null = null;
  const inputErrors = new Map<string, string>();
  let audioError = '';
  const library = createRhythmLibrary({
    write: options.onLibraryChange, retry: options.onLibraryRetry,
    onStateChange: syncLibraryState, onSelection: selectLibraryProject, onNotice: status,
    onFailure: failure => status(`Изменения пока не сохранены. ${failureText(failure)}`),
  });

  container.classList.add('rhythm-view');
  container.dataset.testid = 'rhythm-view';
  container.innerHTML = rhythmMarkup(`rhythm-${++instance}`);
  const output = (key: string) => container.querySelector<HTMLElement>(`[data-rhythm-output="${key}"]`)!;
  const field = (key: string) => container.querySelector<HTMLInputElement>(`[data-rhythm-setting="${key}"]`)!;
  const action = (key: string) => container.querySelector<HTMLButtonElement>(`[data-rhythm-action="${key}"]`)!;
  const newHitVelocity = container.querySelector<HTMLInputElement>('[data-rhythm-default-velocity]')!;
  const newAccentVelocity = container.querySelector<HTMLInputElement>('[data-rhythm-default-accent]')!;
  const rack = output('rack');
  const rackScroll = rack.closest<HTMLElement>('.rhythm-rack-scroll')!;
  const velocityScroll = output('velocity').parentElement!;
  const velocityEditor = velocityScroll.closest('details')!;
  const editorScroll = container.querySelector<HTMLElement>('.rhythm-content')!;
  const grooveDetailScroll = container.querySelector<HTMLElement>('.rhythm-groove-detail-scroll')!;
  const layoutFlag = (key: string) => getComputedStyle(container).getPropertyValue(key).trim() === '1';
  const settingsToggle = container.querySelector<HTMLButtonElement>('[data-page-settings-toggle]')!;
  const settingsPanels = Array.from(container.querySelectorAll<HTMLElement>('[data-rhythm-settings-panel]'));
  const viewTabs = bindPageTabs<RhythmPreferences['view']>(container.querySelector<HTMLElement>('.rhythm-tabs')!, {
    keys: ['metronome', 'rhythm'], select: changeView, signal: listener.signal,
    canSelect: () => visible && !disposed && !library.locked,
  });
  let settingsOpen = layoutFlag('--rhythm-side-panel');
  const activePattern = () => project.patterns.find(pattern => pattern.id === project.activePatternId)!;
  const isRhythm = () => preferences.view === 'rhythm';
  const playing = () => snapshot !== null && STARTED.has(snapshot.state);
  const canUseAudio = () => visible && !disposed && !document.hidden && !inputErrors.size && !library.locked;
  const config = (): RhythmPlaybackConfig => ({ preferences, ...(isRhythm() ? { project } : {}) });
  function syncSettingsPanel() {
    const panel = settingsPanels.find(item => item.dataset.rhythmSettingsPanel === preferences.view)!;
    for (const item of settingsPanels) item.toggleAttribute('hidden', !settingsOpen || item !== panel);
    settingsToggle.setAttribute('aria-controls', panel.id);
    settingsToggle.setAttribute('aria-expanded', String(settingsOpen));
    return panel;
  }
  function setSettingsOpen(open: boolean) {
    settingsOpen = open;
    const panel = syncSettingsPanel();
    if (!layoutFlag('--rhythm-side-panel')) {
      const scroll = isRhythm() && layoutFlag('--rhythm-wide') ? grooveDetailScroll : editorScroll;
      if (open) {
        panel.focus({ preventScroll: true });
        scroll.scrollTop += panel.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      } else {
        scroll.scrollTop = 0;
      }
    }
    if (!open) settingsToggle.focus();
  }
  function status(text: string) { output('status').textContent = text; }
  function showError() {
    const error = inputErrors.values().next().value ?? audioError;
    output('error').textContent = error;
    output('error').hidden = !error;
    for (const input of container.querySelectorAll<HTMLElement>('[data-rhythm-setting], [data-rhythm-choice]')) {
      if (inputErrors.has((input.dataset.rhythmSetting ?? input.dataset.rhythmChoice)!)) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
  function syncTransport() {
    const state = snapshot?.state ?? 'stopped';
    const paused = state === 'paused';
    const active = playing();
    const focus = document.activeElement;
    const start = action('start'), pauseButton = action('pause'), resume = action('resume'), stopButton = action('stop');
    start.hidden = active || paused;
    start.disabled = !canUseAudio() || active || paused;
    pauseButton.hidden = !active;
    pauseButton.disabled = !active;
    resume.hidden = !paused;
    resume.disabled = !canUseAudio();
    stopButton.disabled = !active && !paused;
    action('preview').disabled = !canUseAudio();
    if (visible && !document.hidden) {
      if (active && (focus === start || focus === resume)) pauseButton.focus({ preventScroll: true });
      else if (paused && snapshot?.pauseReason === 'manual' && focus === pauseButton && !resume.disabled) resume.focus({ preventScroll: true });
      else if (!active && !paused && (focus === stopButton || focus === pauseButton || focus === resume) && !start.disabled) start.focus({ preventScroll: true });
      if (container.dataset.rhythmState !== state) output('transport-announcement').textContent = TRANSPORT_LABELS[state];
    }
    container.dataset.rhythmState = state;
    container.dataset.rhythmPhase = snapshot?.phase ?? '';
    const configuredBpm = isRhythm() ? project.bpm : preferences.metronome.bpm;
    container.dataset.rhythmBpm = String(active || paused ? snapshot?.bpm ?? configuredBpm : configuredBpm);
    container.dataset.rhythmLibraryPending = String(library.pending);
    container.dataset.rhythmLibraryError = String(library.failedKind !== null);
  }
  function paintPosition() {
    const position = snapshot?.position;
    const active = playing() || snapshot?.state === 'paused';
    const chain = output('chain');
    const currentClip = active && isRhythm() && position?.clipId
      ? chain.querySelector(`[data-rhythm-clip="${CSS.escape(position.clipId)}"]`)
      : null;
    const markedClip = chain.querySelector('[aria-current="true"]');
    if (markedClip !== currentClip) {
      markedClip?.removeAttribute('aria-current');
      currentClip?.setAttribute('aria-current', 'true');
    }
    for (const node of container.querySelectorAll('.is-playing')) node.classList.remove('is-playing');
    rack.style.removeProperty('--playhead-step');
    container.dataset.rhythmBar = active ? String(position?.bar ?? '') : '';
    container.dataset.rhythmBeat = active ? String(position?.beat ?? '') : '';
    container.dataset.rhythmStep = active ? String(position?.step ?? '') : '';
    container.dataset.rhythmClip = active ? position?.clipId ?? '' : '';
    const tempo = isRhythm() ? project.bpm : preferences.metronome.bpm;
    const phase = !active || !position ? TRANSPORT_LABELS[snapshot?.state ?? 'stopped']
      : snapshot?.state === 'paused' ? 'Пауза' : snapshot?.phase === 'count-in' ? 'Отсчёт' : position.silent ? 'Немой такт' : 'Играет';
    const phaseText = active && position && snapshot && snapshot.bpm !== tempo ? `${phase} · ${snapshot.bpm} BPM` : phase;
    const detailText = active && position ? `Такт ${position.bar} · доля ${position.beat}` : '';
    const phaseOutput = output('position-phase'), detailOutput = output('position-detail');
    if (phaseOutput.textContent !== phaseText) {
      phaseOutput.textContent = phaseText;
      phaseOutput.title = phaseText;
    }
    if (detailOutput.textContent !== detailText) {
      detailOutput.textContent = detailText;
      detailOutput.title = detailText;
    }
    if (!active || !position) return;
    if (isRhythm()) {
      currentClip?.classList.add('is-playing');
      if (position.patternId === project.activePatternId && position.patternBar === selectedBar + 1) {
        const column = position.step % 16;
        rack.style.setProperty('--playhead-step', String(column));
        rack.style.setProperty('--playhead-beat', String(Math.floor(column / 4)));
        rack.style.setProperty('--playhead-pad', String(column % 4));
        for (const step of rack.querySelectorAll(`[data-rhythm-step="${column}"]`)) step.classList.add('is-playing');
      }
    } else {
      const beat = output('beats').children[position.beat - 1];
      beat?.classList.add('is-playing');
      beat?.querySelector(`[data-rhythm-substep="${position.subdivision}"]`)?.classList.add('is-playing');
    }
  }
  const player = createRhythmPlayer({
    onPracticeEnd: options.onPracticeEnd,
    onSnapshot(next) {
      if (disposed) return;
      const previous = snapshot;
      snapshot = next;
      if (previous?.state !== next.state || previous.phase !== next.phase || previous.bpm !== next.bpm || previous.pauseReason !== next.pauseReason) syncTransport();
      if (previous?.position !== next.position || previous.state !== next.state || previous.bpm !== next.bpm) paintPosition();
      const key = next.runtimeContextKey ?? '';
      if (key !== practiceKey) { practiceKey = key; options.onPracticeChange?.(); }
    },
  });
  function stop() { if (!disposed) { ++runIntent; player.stop(); syncTransport(); } }
  function pause(reason = 'manual') { if (!disposed) { ++runIntent; player.pause(reason); syncTransport(); } }
  function configForCurrentRun(): RhythmPlaybackConfig {
    const next = config();
    // Длина отсчёта определяет нумерацию шагов уже запущенного прохода.
    return playbackForRhythmRun(next, playing() || snapshot?.state === 'paused' ? snapshot?.effectiveConfig ?? null : null);
  }
  function configure() {
    if (inputErrors.size || disposed) return;
    try { player.configure(configForCurrentRun()); }
    catch (failure) { stop(); audioError = failureText(failure); showError(); }
  }
  async function sound(command: 'start' | 'resume' | 'preview') {
    if (!canUseAudio() || (command === 'start' && (playing() || snapshot?.state === 'paused'))) return;
    const expected = ++runIntent;
    audioError = ''; showError();
    try {
      if (options.onBeforeStart?.() === false || expected !== runIntent || !canUseAudio()) return;
      if (command === 'start') await player.start(config());
      else if (command === 'resume') await player.resume();
      else { player.configure(config()); await player.preview('accent', preferences.metronome.kit); }
    } catch (failure) {
      if (disposed || expected !== runIntent) return;
      stop(); audioError = failureText(failure); showError();
    }
  }
  function cancelFader() {
    const gesture = faderGesture;
    if (!gesture) return;
    faderGesture = null;
    gesture.input.value = gesture.value;
    if (gesture.level !== null) {
      gesture.input.setAttribute('aria-valuetext', gesture.level);
      gesture.input.closest('.rhythm-channel')?.querySelector<HTMLOutputElement>('[data-rhythm-level]')?.replaceChildren(gesture.level);
    }
  }
  function commitFader(input: HTMLInputElement) {
    if (input.dataset.rhythmVolume) {
      changeProject({ kind: 'lane-volume', id: input.dataset.rhythmVolume, volume: input.valueAsNumber }, false);
      paintFader(input);
    } else applyField(input);
  }
  function setField(key: string, value: string | number | boolean) {
    const input = field(key);
    if (inputErrors.has(key) || input === faderGesture?.input) return;
    if (typeof value === 'boolean') input.checked = value;
    else input.value = String(value);
    if (input.hasAttribute('data-rhythm-dial')) paintRhythmDial(input);
    if (input.classList.contains('rhythm-fader')) paintFader(input, Number(value));
  }
  function syncChoice(key: string, value: string | number | null, disabled: boolean | string = false) {
    for (const button of container.querySelectorAll<HTMLButtonElement>(`[data-rhythm-choice="${key}"]`)) {
      const choice = button.dataset.rhythmValue;
      button.setAttribute('aria-pressed', String(choice === String(value)));
      button.disabled = disabled === true || disabled === choice;
    }
  }
  function syncFields() {
    const metro = preferences.metronome;
    for (const name of ['accentVolume', 'clickVolume', 'subdivisionVolume'] as const) setField(name, metro[name]);
    for (const name of [...TRAINING_NUMBERS, ...TRAINING_FLAGS]) setField(name, metro.training[name]);
    setField('beats', metro.meter.beats); syncChoice('denominator', metro.meter.denominator); setField('groups', metro.meter.groups.join('+'));
    const compound = metro.meter.denominator === 8 && metro.meter.groups.every(group => group === 3);
    syncChoice('bpmUnit', metro.bpmUnit, !compound && 'dotted-quarter');
    const swingAvailable = metro.division === 2 || metro.division === 4;
    setField('metronomeSwing', metro.swing);
    syncChoice('metro-swing-mode', metro.division === 2 ? 'eighth' : metro.swingMode, metro.division !== 4);
    field('metronomeSwing').disabled = !swingAvailable;
    output('swing-explanation').textContent = metro.division === 4 ? 'Выбери, где чередуются длинные и короткие шаги.'
      : metro.division === 2 ? 'Свинг делит долю на длинную и короткую части.' : 'Свинг доступен при делении доли на две или четыре части.';
    setField('rhythm-swing', project.swing); syncChoice('rhythm-swing-mode', project.swingMode);
    setField('master', preferences.master); setField('rhythmClick', project.overlay);
    const bpm = isRhythm() ? project.bpm : metro.bpm;
    const tempoUnit = isRhythm() ? 'quarter' : metro.bpmUnit;
    setField('bpm', bpm); setField('bpm-slider', bpm); setField('countIn', isRhythm() ? project.countIn : metro.countIn);
    output('tempo-unit').textContent = tempoUnit === 'quarter' ? '♩' : tempoUnit === 'eighth' ? '♪' : '♩.';
    const linkedTempo = output('linked-tempo');
    linkedTempo.hidden = !project.overlay;
    if (project.overlay) field('bpm').setAttribute('aria-describedby', linkedTempo.id);
    else field('bpm').removeAttribute('aria-describedby');
    output('overlay-help').textContent = project.overlay
      ? 'Общий BPM. Ритм считает четверти в 4/4. Клик наследует акценты, подразделения и свинг метронома. /4 даёт четыре позиции основного клика на такт, /8 — восемь. Рисунок повторяется или обрезается на границе такта.'
      : 'Включи наложение, чтобы использовать настройки клика метронома и связать темп двух вкладок.';
    output('metro-swing').textContent = swingAvailable ? `${metro.swing}%` : '—';
    output('rhythm-swing').textContent = `${project.swing}%`;
    const meter = `${metro.meter.beats}/${metro.meter.denominator}`;
    output('meter-label').textContent = meter;
    const groups = output('meter-summary');
    groups.hidden = metro.meter.groups.length < 2;
    groups.textContent = groups.hidden ? '' : metro.meter.groups.join('+');
    output('kit-name').textContent = RHYTHM_KITS.find(([key]) => key === metro.kit)![1];
    const { silentEnabled, rampEnabled, soundBars, silentBars, stepBpm, targetBpm } = metro.training;
    const training = [silentEnabled && `Со звуком: ${soundBars}, без: ${silentBars}`, rampEnabled && `+${stepBpm} BPM до ${targetBpm}`].filter(Boolean);
    output('training-summary').textContent = training.length ? training.join(' · ') : 'Немые такты и рост темпа';
    viewTabs.setSelected(preferences.view);
    for (const panel of container.querySelectorAll<HTMLElement>('[data-rhythm-dock]')) {
      panel.hidden = panel.dataset.rhythmDock !== preferences.view;
    }
    syncSettingsPanel();
    const divisions = metro.meter.denominator === 4 ? ['Четверти', 'Восьмые', 'Триоли', 'Шестнадцатые'] : ['Восьмые', 'Шестнадцатые', 'Триоли', 'Тридцать вторые'];
    output('division-label').textContent = divisions[metro.division - 1];
    for (const control of container.querySelectorAll<HTMLButtonElement>('[data-rhythm-division]')) {
      const division = Number(control.dataset.rhythmDivision);
      control.textContent = divisions[division - 1]; control.setAttribute('aria-pressed', String(division === metro.division));
    }
    for (const control of container.querySelectorAll<HTMLButtonElement>('[data-rhythm-scope]')) control.setAttribute('aria-pressed', String(control.dataset.rhythmScope === project.scope));
    for (const control of container.querySelectorAll<HTMLButtonElement>('[data-rhythm-repeat]')) control.setAttribute('aria-pressed', String(control.dataset.rhythmRepeat === project.repeat));
    for (const control of output('kits').querySelectorAll<HTMLButtonElement>('[data-rhythm-kit]')) control.setAttribute('aria-pressed', String(control.dataset.rhythmKit === metro.kit));
    for (const control of output('presets').querySelectorAll<HTMLButtonElement>('[data-rhythm-preset]')) control.setAttribute('aria-pressed', String(control.dataset.rhythmPreset === presetId));
  }
  function withFocus(render: () => void) {
    const before = document.activeElement instanceof HTMLElement && container.contains(document.activeElement) ? document.activeElement : null;
    const key = before?.dataset.rhythmFocus;
    render();
    if (key && !before?.isConnected) container.querySelector<HTMLElement>(`[data-rhythm-focus="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }
  function renderBeats() {
    const beats = rhythmBeatGroups(preferences.metronome);
    withFocus(() => output('beats').replaceChildren(...beats)); paintPosition();
  }
  function renderLibrary() {
    const unavailable = !options.onLibraryChange || library.pending || library.failedKind !== null;
    const rows = rhythmProjectRows(library.projects, project.id, unavailable);
    withFocus(() => output('projects').replaceChildren(...rows));
    output('project-count').textContent = String(rows.length);
    action('new-project').disabled = unavailable;
    action('duplicate-project').disabled = unavailable;
    action('save-project').disabled = !options.onLibraryChange || library.pending;
    action('save-project').textContent = library.failedKind === 'save' ? 'Повторить сохранение' : library.failedKind ? 'Повторить действие' : 'Сохранить проект';
    action('retry-project').hidden = library.failedKind === null;
    action('retry-project').disabled = library.pending;
    syncTransport();
  }
  function paintSteps() {
    for (const button of output('rack').querySelectorAll<HTMLButtonElement>('[data-rhythm-step]')) {
      const step = Number(button.dataset.rhythmStep), channel = project.channels.find(item => item.id === button.dataset.rhythmChannel)!;
      const lane = activePattern().lanes.find(item => item.channelId === channel.id)!;
      const level = lane.steps[selectedBar * 16 + step], selected = channel.id === selectedLane && step === selectedStep;
      button.dataset.level = String(level);
      button.classList.toggle('is-selected', selected); button.tabIndex = selected ? 0 : -1;
      button.setAttribute('aria-pressed', String(level > 0));
      button.setAttribute('aria-label', `${channel.name}, такт ${selectedBar + 1}, шаг ${step + 1}. ${level === 2 ? 'Акцент' : level === 1 ? 'Удар' : 'Пусто'}`);
    }
    const lane = activePattern().lanes.find(item => item.channelId === selectedLane)!;
    const level = lane.steps[selectedBar * RHYTHM_STEPS_PER_BAR + selectedStep];
    const accent = action('accent-step');
    accent.disabled = level === 0;
    accent.setAttribute('aria-pressed', String(level === 2));
    paintPosition();
  }
  function renderVelocity() {
    const channel = project.channels.find(item => item.id === selectedLane)!;
    const lane = activePattern().lanes.find(item => item.channelId === selectedLane)!;
    const defaults = channel.velocityDefaults;
    output('velocity-default-track').textContent = `По умолчанию · ${channel.name}`;
    newHitVelocity.valueAsNumber = defaults.hit;
    newAccentVelocity.valueAsNumber = defaults.accent;
    const row = rhythmVelocityRow(channel, lane, selectedBar);
    withFocus(() => output('velocity').replaceChildren(row));
    paintVelocity();
  }
  function paintVelocity() {
    const row = output('velocity');
    const label = row.querySelector<HTMLOutputElement>('.rhythm-velocity-value');
    for (const slider of row.querySelectorAll<HTMLInputElement>('[data-rhythm-velocity]')) {
      const cell = slider.parentElement!;
      const percent = `${Math.round(slider.valueAsNumber * 100)}%`;
      cell.style.setProperty('--velocity', percent);
      cell.dataset.silent = String(slider.valueAsNumber === 0);
      slider.setAttribute('aria-valuetext', percent);
      const step = Number(slider.dataset.rhythmVelocity);
      cell.classList.toggle('is-selected', step === selectedStep);
      if (step === selectedStep && label) label.value = `Шаг ${step + 1} · ${percent}`;
    }
  }
  function renderRack() {
    const rows = rhythmRackRows(project, selectedLane);
    withFocus(() => rack.replaceChildren(...rows));
    paintSteps(); renderVelocity();
  }
  function renderMixer() {
    if (faderGesture?.input.dataset.rhythmVolume) cancelFader();
    const channels = rhythmMixerStrips(project);
    withFocus(() => output('mixer').replaceChildren(...channels));
  }
  function renderChain() {
    const selectedIndex = project.chain.findIndex(clip => clip.id === selectedClip);
    if (selectedIndex < 0) selectedClip = null;
    const { clips, bars } = rhythmChainClips(project, selectedIndex);
    const editor = output('clip-editor');
    withFocus(() => {
      output('chain').replaceChildren(...clips);
      editor.hidden = selectedIndex < 0;
      editor.replaceChildren();
      if (selectedIndex < 0) return;
      editor.append(...rhythmClipEditor(project, selectedIndex));
    });
    output('chain-length').textContent = `${bars} такт. ${project.repeat === 'loop' ? '· по кругу' : '· один проход'}`;
    action('add-clip').disabled = project.chain.length >= 8; paintPosition();
  }
  function renderEditor() {
    const pattern = activePattern();
    selectedBar = Math.min(selectedBar, pattern.bars - 1);
    if (!project.channels.some(channel => channel.id === selectedLane)) selectedLane = project.channels[0].id;
    const patternButtons = rhythmPatternButtons(project, pattern.id);
    const bars = rhythmBarButtons(pattern.bars, selectedBar, nextPatternLength(pattern.bars));
    withFocus(() => { output('patterns').replaceChildren(...patternButtons); output('bars').replaceChildren(...bars); });
    output('pattern-title').textContent = pattern.name;
    setField('pattern-name', pattern.name); syncChoice('bars', pattern.bars);
    const sounds = output('sounds');
    const unused = (Object.keys(SOUND_LABELS) as RhythmSound[]).filter(sound => !project.channels.some(channel => channel.sound === sound));
    if (!selectedSound || !unused.includes(selectedSound)) selectedSound = unused[0] ?? null;
    const soundButtons = rhythmSoundButtons(unused);
    withFocus(() => sounds.replaceChildren(...soundButtons));
    syncChoice('new-sound', selectedSound, project.channels.length >= 8);
    sounds.hidden = !unused.length;
    action('add-lane').disabled = !selectedSound || project.channels.length >= 8;
    action('add-pattern').disabled = action('duplicate-pattern').disabled = project.patterns.length >= 8;
    action('copy-bar').textContent = copiedBar ? 'Вставить такт' : 'Копировать такт';
    renderRack(); renderMixer(); renderChain();
  }

  function resetEditing() {
    selectedBar = selectedStep = 0; selectedLane = project.channels[0].id; selectedClip = null; copiedBar = null; presetId = null;
    inputErrors.clear(); audioError = '';
    setField('project-name', project.name); syncFields(); renderEditor(); renderLibrary(); showError(); configure();
  }
  function selectLibraryProject(active: RhythmProject | undefined, saveLinkedTempo: boolean) {
    stop();
    project = active ? validateRhythmProject(active) : newProject();
    const before = preferences;
    preferences = withProjectTempo(preferences, project);
    resetEditing();
    if (saveLinkedTempo && preferences !== before) options.onPreferencesChange?.();
  }
  function syncLibraryState() {
    if (library.locked) cancelFader();
    for (const section of container.querySelectorAll<HTMLElement>('.rhythm-constructor, .rhythm-chain-card, .rhythm-project-tools, .rhythm-mix-module, .rhythm-velocity-defaults')) section.inert = library.locked;
    renderLibrary();
  }
  function changeProject(edit: RhythmProjectEdit, paint = true) {
    if (library.locked || disposed) return;
    const result = applyRhythmProjectEdit(project, preferences, edit, Date.now());
    const before = preferences;
    project = result.project;
    preferences = result.preferences;
    selectedLane = result.selectedLane ?? selectedLane;
    configure(); syncFields();
    if (paint) renderEditor();
    void library.write({ kind: 'save', project });
    if (preferences !== before) options.onPreferencesChange?.();
  }
  function resizePattern(bars: RhythmPatternBars, nextBar = selectedBar) {
    changeProject({ kind: 'resize', bars }, false);
    selectedBar = nextBar;
    renderEditor();
  }
  function changePreferences(edit: (draft: Mutable<RhythmPreferences>) => void, beats = false) {
    const draft = clone(preferences); edit(draft); preferences = validateRhythmPreferences(draft);
    configure(); syncFields(); if (beats) renderBeats(); options.onPreferencesChange?.();
  }
  function changeView(view: RhythmPreferences['view']) {
    if (view === preferences.view) return;
    cancelFader();
    stop(); inputErrors.clear(); audioError = ''; taps = [];
    changePreferences(draft => { draft.view = view; }); showError(); syncTransport();
    editorScroll.scrollTop = 0;
  }
  function meterChanged(beats: number, denominator: 4 | 8, groups?: number[]) {
    changePreferences(draft => {
      const metro = draft.metronome, old = metro.meter;
      metro.meter = groups ? { beats, denominator, groups } : clone(defaultRhythmMeter(beats, denominator));
      const sizeChanged = old.beats !== beats || old.denominator !== denominator;
      const groupsChanged = old.groups.length !== metro.meter.groups.length || old.groups.some((group, index) => group !== metro.meter.groups[index]);
      if (sizeChanged || groupsChanged) metro.accents = [...defaultRhythmAccents(metro.meter)];
      if (sizeChanged) {
        metro.substeps = Array<boolean>(beats * (metro.division - 1)).fill(true);
      }
      const compound = denominator === 8 && metro.meter.groups.every(group => group === 3);
      if (!groups && compound) metro.bpmUnit = 'dotted-quarter';
      else if (!compound && metro.bpmUnit === 'dotted-quarter') metro.bpmUnit = 'quarter';
    }, true);
  }
  function numeric(input: HTMLInputElement) {
    const value = input.valueAsNumber, min = Number(input.min), max = Number(input.max);
    if (!Number.isFinite(value) || value < min || value > max || (input.type === 'number' && !Number.isInteger(value))) {
      const name = input.getAttribute('aria-label') ?? input.closest('label')?.textContent?.trim() ?? 'Значение';
      throw new RangeError(`${name}. Допустимый диапазон ${min}–${max}.`);
    }
    return value;
  }
  function setBpm(bpm: number) {
    inputErrors.delete('bpm'); audioError = '';
    if (isRhythm() || project.overlay) changeProject({ kind: 'settings', change: { bpm } }, false);
    else changePreferences(draft => { setMetronomeTempo(draft.metronome, bpm); });
    showError(); syncTransport();
  }
  function applyField(input: HTMLInputElement | HTMLButtonElement) {
    if (disposed || library.locked) return;
    const key = input.dataset.rhythmSetting ?? input.dataset.rhythmChoice;
    const value = input.dataset.rhythmValue ?? input.value;
    if (!key || key === 'project-name') return;
    inputErrors.delete(key); audioError = '';
    try {
      if (key === 'bpm' || key === 'bpm-slider') setBpm(numeric(input as HTMLInputElement));
      else if (key === 'beats' || key === 'denominator') {
        const beats = numeric(field('beats'));
        const denominator = key === 'denominator' ? Number(value) as 4 | 8 : preferences.metronome.meter.denominator;
        inputErrors.delete('groups'); inputErrors.delete('beats'); inputErrors.delete('denominator'); meterChanged(beats, denominator);
      } else if (key === 'groups') {
        if (!/^\s*\d+(?:\s*\+\s*\d+)*\s*$/u.test(input.value)) throw new RangeError('Укажи группы через плюс, например 2+2+3.');
        const groups = input.value.split('+').map(Number), { beats, denominator } = preferences.metronome.meter;
        if (groups.some(group => group < 1) || groups.reduce((sum, group) => sum + group, 0) !== beats) throw new RangeError(`Сумма групп должна равняться числу долей (${beats}).`);
        meterChanged(beats, denominator, groups);
      } else if (key === 'bpmUnit') changePreferences(draft => { draft.metronome.bpmUnit = value as RhythmBpmUnit; });
      else if (key === 'master') changePreferences(draft => { draft.master = Number(input.value); });
      else if (key === 'countIn') {
        const value = (input as HTMLInputElement).checked;
        if (isRhythm()) changeProject({ kind: 'settings', change: { countIn: value } }, false);
        else changePreferences(draft => { draft.metronome.countIn = value; });
      } else if (key === 'rhythmClick') {
        const overlay = (input as HTMLInputElement).checked;
        if (overlay) inputErrors.delete('bpm');
        changeProject({ kind: 'overlay', enabled: overlay }, false);
      } else if (key === 'rhythm-swing' || key === 'rhythm-swing-mode') {
        const change = key === 'rhythm-swing' ? { swing: Number(value) } : { swingMode: value as RhythmSwingMode };
        changeProject({ kind: 'settings', change }, false);
      } else if (key === 'pattern-name') {
        const name = input.value.trim(); if (!name) { setField(key, activePattern().name); return; }
        changeProject({ kind: 'rename-pattern', name });
      } else if (key === 'bars') {
        resizePattern(Number(value) as RhythmPatternBars);
      } else if (key === 'metro-swing-mode' || key === 'metronomeSwing' || ['accentVolume', 'clickVolume', 'subdivisionVolume'].includes(key)) {
        changePreferences(draft => {
          if (key === 'metro-swing-mode') draft.metronome.swingMode = value as RhythmSwingMode;
          else if (key === 'metronomeSwing') draft.metronome.swing = Number(input.value);
          else draft.metronome[key as 'accentVolume' | 'clickVolume' | 'subdivisionVolume'] = Number(input.value);
        });
      } else if ((TRAINING_NUMBERS as readonly string[]).includes(key)) {
        const value = numeric(input as HTMLInputElement);
        changePreferences(draft => { draft.metronome.training[key as typeof TRAINING_NUMBERS[number]] = value; });
      } else if ((TRAINING_FLAGS as readonly string[]).includes(key)) {
        changePreferences(draft => {
          draft.metronome.training[key as typeof TRAINING_FLAGS[number]] = (input as HTMLInputElement).checked;
          if (key === 'rampEnabled') setMetronomeTempo(draft.metronome, draft.metronome.bpm);
        });
      }
    } catch (failure) { inputErrors.set(key, failureText(failure)); stop(); }
    showError(); syncTransport();
  }
  function editStep(laneId: string, step: number, level: RhythmStep, velocity?: number, keepSlider = false) {
    selectedLane = laneId; selectedStep = step; presetId = null;
    changeProject({ kind: 'step', channelId: laneId, bar: selectedBar, step, level, velocity }, false);
    paintSteps();
    for (const name of output('rack').querySelectorAll<HTMLButtonElement>('[data-rhythm-select-lane]')) name.setAttribute('aria-pressed', String(name.dataset.rhythmSelectLane === selectedLane));
    if (keepSlider) paintVelocity(); else renderVelocity();
  }
  function toggleStepAccent(laneId: string, step: number) {
    const lane = activePattern().lanes.find(item => item.channelId === laneId)!;
    editStep(laneId, step, lane.steps[selectedBar * RHYTHM_STEPS_PER_BAR + step] === 2 ? 1 : 2);
  }
  function accentFromRack(button: HTMLButtonElement) {
    try {
      button.focus({ preventScroll: true });
      toggleStepAccent(button.dataset.rhythmChannel!, Number(button.dataset.rhythmStep));
    } catch (failure) { stop(); audioError = failureText(failure); showError(); }
  }
  function loadPreset(id: string) {
    const preset = RHYTHM_PRESETS.find(item => item.id === id); if (!preset) return;
    stop(); presetId = id; selectedBar = selectedStep = 0; inputErrors.delete('bpm'); audioError = '';
    changeProject({ kind: 'preset', id: preset.id, fallbackIds: Array.from({ length: 8 }, () => crypto.randomUUID()) });
    showError(); syncTransport();
    status(`Основа «${preset.name}» открыта в паттерне ${project.activePatternId}.`);
  }
  function patternAction(duplicate: boolean) {
    if (project.patterns.length >= 8) return;
    stop(); selectedBar = selectedStep = 0; presetId = null;
    changeProject({ kind: 'add-pattern', duplicate });
  }
  function barAction(copy: boolean) {
    if (copy && !copiedBar) {
      copiedBar = copyRhythmBar(project, selectedBar);
      action('copy-bar').textContent = 'Вставить такт'; status('Такт скопирован. Выбери такт для вставки.'); return;
    }
    const paste = copy ? copiedBar : null;
    if (copy) copiedBar = null;
    presetId = null;
    changeProject({ kind: 'bar', bar: selectedBar, source: paste });
  }
  function clipAction(id: string, move: string) {
    if (move !== 'remove' && move !== 'left' && move !== 'right') return;
    const index = project.chain.findIndex(clip => clip.id === id);
    if (index < 0 || move === 'remove' && project.chain.length === 1) return;
    changeProject({ kind: 'move-clip', id, move });
    const focusClip = move === 'remove' ? project.chain[Math.min(index, project.chain.length - 1)].id : id;
    if (move === 'remove' || document.activeElement === document.body) {
      output('chain').querySelector<HTMLButtonElement>(`[data-rhythm-clip="${CSS.escape(focusClip)}"]`)?.focus();
    }
  }
  function addLane() {
    const sound = selectedSound;
    if (!sound || project.channels.length >= 8 || project.channels.some(channel => channel.sound === sound)) return;
    const id = project.channels.some(channel => channel.id === sound) ? crypto.randomUUID() : sound;
    selectedLane = id;
    changeProject({ kind: 'add-lane', id, sound });
  }
  function nameForProject(fallback: string) { return field('project-name').value.trim() || fallback; }
  async function projectAction(command: 'new-project' | 'duplicate-project' | 'save-project') {
    if (library.pending || (library.failedKind && command !== 'save-project')) return;
    if (library.failedKind) { await library.retry(); return; }
    if (command === 'new-project') { await library.write({ kind: 'save', project: newProject('Новый проект') }, true, 'Создан новый проект.'); return; }
    const draft = clone(project), now = new Date().toISOString();
    draft.name = nameForProject(project.name);
    draft.updatedAt = new Date(Math.max(Date.now(), Date.parse(draft.updatedAt))).toISOString();
    if (command === 'duplicate-project') {
      draft.id = crypto.randomUUID(); draft.createdAt = draft.updatedAt = now;
      if (draft.name === project.name) draft.name = `${project.name.slice(0, 41)} · копия`;
      await library.write({ kind: 'save', project: validateRhythmProject(draft) }, true, 'Копия проекта сохранена.');
    } else {
      project = validateRhythmProject(draft); setField('project-name', project.name);
      await library.write({ kind: 'save', project }, false, 'Проект сохранён.');
    }
  }
  async function deleteProject(id: string) {
    if (library.pending || library.failedKind) return;
    const expected = library.revision, entry = library.projects.find(item => item.id === id);
    if (!entry || !await confirmAction({ title: 'Удалить проект?', message: `«${entry.name}» будет удалён из библиотеки.`, confirmLabel: 'Удалить проект' })) return;
    if (disposed || !visible || expected !== library.revision) return;
    await library.write({ kind: 'delete', id }, id === project.id, 'Проект удалён.');
  }

  function runAction(name: string) {
    switch (name) {
      case 'start': case 'resume': case 'preview': void sound(name); break;
      case 'pause': pause(); break;
      case 'stop': stop(); break;
      case 'slower': case 'faster': setBpm(Math.min(240, Math.max(30, (isRhythm() ? project.bpm : preferences.metronome.bpm) + (name === 'slower' ? -1 : 1)))); break;
      case 'tap': {
        const now = performance.now(); if (taps.length && now - taps[taps.length - 1] > 2500) taps = [];
        taps.push(now); if (taps.length > 6) taps.shift();
        if (taps.length < 2) status('Настучи ещё несколько долей.');
        else setBpm(Math.min(240, Math.max(30, Math.round(60000 * (taps.length - 1) / (now - taps[0])))));
        break;
      }
      case 'add-pattern': case 'duplicate-pattern': patternAction(name === 'duplicate-pattern'); break;
      case 'add-bar': {
        const length = nextPatternLength(activePattern().bars);
        if (length !== undefined) resizePattern(length, length - 1);
        break;
      }
      case 'copy-bar': case 'clear-bar': barAction(name === 'copy-bar'); break;
      case 'add-lane': addLane(); break;
      case 'accent-step': toggleStepAccent(selectedLane, selectedStep); break;
      case 'add-clip': if (project.chain.length < 8) changeProject({ kind: 'add-clip', id: crypto.randomUUID() }); break;
      case 'retry-project': void projectAction('save-project').catch(failure => status(failureText(failure))); break;
      case 'new-project': case 'duplicate-project': case 'save-project': void projectAction(name).catch(failure => status(failureText(failure))); break;
    }
  }
  function click(button: HTMLButtonElement) {
    const data = button.dataset;
    if (data.rhythmAction) { runAction(data.rhythmAction); return; }
    if (data.rhythmChoice === 'new-sound') {
      selectedSound = data.rhythmValue as RhythmSound;
      syncChoice('new-sound', selectedSound);
    } else if (data.rhythmChoice && button.getAttribute('aria-pressed') !== 'true') applyField(button);
    else if (data.rhythmClip) {
      selectedClip = selectedClip === data.rhythmClip ? null : data.rhythmClip;
      renderChain();
    }
    else if (data.rhythmClipSelect && button.getAttribute('aria-pressed') !== 'true') {
      changeProject({ kind: 'assign-clip', id: data.rhythmClipSelect, patternId: data.rhythmValue as RhythmPatternId });
    } else if (data.rhythmDivision) changePreferences(draft => {
      const metro = draft.metronome, division = Number(data.rhythmDivision) as RhythmDivision, before = metro.division;
      metro.substeps = Array.from({ length: metro.meter.beats * (division - 1) }, (_, index) => {
        const beat = Math.floor(index / (division - 1)), sub = index % (division - 1);
        return sub < before - 1 ? metro.substeps[beat * (before - 1) + sub] : true;
      }); metro.division = division;
    }, true);
    else if (data.rhythmBeat !== undefined) changePreferences(draft => {
      const index = Number(data.rhythmBeat); draft.metronome.accents[index] = ((draft.metronome.accents[index] + 1) % 3) as RhythmStep;
    }, true);
    else if (data.rhythmSubIndex !== undefined) changePreferences(draft => { const index = Number(data.rhythmSubIndex); draft.metronome.substeps[index] = !draft.metronome.substeps[index]; }, true);
    else if (data.rhythmKit) changePreferences(draft => { draft.metronome.kit = data.rhythmKit as RhythmKit; });
    else if (data.rhythmScope && data.rhythmScope !== project.scope) changeProject({ kind: 'settings', change: { scope: data.rhythmScope as RhythmProject['scope'] } });
    else if (data.rhythmRepeat && data.rhythmRepeat !== project.repeat) {
      changeProject({ kind: 'settings', change: { repeat: data.rhythmRepeat as RhythmProject['repeat'] } }, false); renderChain();
    }
    else if (data.rhythmPreset) loadPreset(data.rhythmPreset);
    else if (data.rhythmPattern && data.rhythmPattern !== project.activePatternId) {
      selectedBar = selectedStep = 0; presetId = null; changeProject({ kind: 'settings', change: { activePatternId: data.rhythmPattern as RhythmPatternId } });
    } else if (data.rhythmBar !== undefined) { selectedBar = Number(data.rhythmBar); renderEditor(); }
    else if (data.rhythmStep !== undefined && data.rhythmChannel) {
      const step = Number(data.rhythmStep), lane = activePattern().lanes.find(item => item.channelId === data.rhythmChannel)!;
      editStep(lane.channelId, step, lane.steps[selectedBar * 16 + step] ? 0 : 1);
    } else if (data.rhythmSelectLane) { selectedLane = data.rhythmSelectLane; renderRack(); }
    else if (data.rhythmMute) changeProject({ kind: 'lane-toggle', id: data.rhythmMute, control: 'muted' });
    else if (data.rhythmSolo) changeProject({ kind: 'lane-toggle', id: data.rhythmSolo, control: 'solo' });
    else if (data.rhythmClipAction && data.rhythmClipId) clipAction(data.rhythmClipId, data.rhythmClipAction);
    else if (data.rhythmOpenProject && !library.pending && !library.failedKind && data.rhythmOpenProject !== project.id) void library.write({ kind: 'select', id: data.rhythmOpenProject }, true, 'Проект открыт.');
    else if (data.rhythmDeleteProject) void deleteProject(data.rhythmDeleteProject);
  }
  container.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!button || button.disabled || disposed || button.dataset.rhythmMode) return;
    if (button === settingsToggle || button.hasAttribute('data-rhythm-settings-close')) {
      setSettingsOpen(button === settingsToggle && !settingsOpen);
      return;
    }
    if (library.locked && button.dataset.rhythmAction !== 'stop' && button.dataset.rhythmAction !== 'pause') return;
    try { click(button); }
    catch (failure) { stop(); audioError = failureText(failure); showError(); }
  }, listen);
  rack.addEventListener('contextmenu', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-rhythm-step]') : null;
    if (!button || !visible || !isRhythm() || disposed || library.locked) return;
    event.preventDefault();
    accentFromRack(button);
  }, listen);
  for (const [input, kind] of [[newHitVelocity, 'hit'], [newAccentVelocity, 'accent']] as const) {
    input.addEventListener('change', () => {
      if (disposed || library.locked) return;
      const channel = project.channels.find(item => item.id === selectedLane)!;
      const previous = channel.velocityDefaults[kind];
      if (!input.validity.valid) {
        input.valueAsNumber = previous;
        return;
      }
      const value = input.valueAsNumber;
      if (value !== previous) changeProject({ kind: 'lane-default', id: channel.id, control: kind, value }, false);
    }, listen);
  }
  container.addEventListener('pointerdown', event => {
    const input = event.target;
    if (event.button !== 0 || !event.isPrimary || !visible || disposed || library.locked ||
      !(input instanceof HTMLInputElement) || !input.classList.contains('rhythm-fader')) return;
    cancelFader();
    faderGesture = { pointerId: event.pointerId, input, value: input.value, level: input.getAttribute('aria-valuetext') };
  }, listen);
  document.addEventListener('pointerup', event => {
    const gesture = faderGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    faderGesture = null;
    if (gesture.input.value !== gesture.value) commitFader(gesture.input);
  }, listen);
  document.addEventListener('pointercancel', event => {
    if (event.pointerId === faderGesture?.pointerId) cancelFader();
  }, listen);
  window.addEventListener('blur', cancelFader, listen);
  container.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || disposed || library.locked) return;
    if (input.classList.contains('rhythm-fader')) {
      if (faderGesture?.input === input) paintFader(input);
      else commitFader(input);
    }
    else if (input.dataset.rhythmVelocity !== undefined) {
      const step = Number(input.dataset.rhythmVelocity);
      const value = input.valueAsNumber;
      const lane = activePattern().lanes.find(item => item.channelId === selectedLane)!;
      const previous = lane.steps[selectedBar * RHYTHM_STEPS_PER_BAR + step];
      editStep(selectedLane, step, value === 0 ? 0 : previous === 2 ? 2 : 1, value, true);
    } else if (input.type === 'range' || input.type === 'number' || input.dataset.rhythmSetting === 'groups') applyField(input);
  }, listen);
  container.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || disposed || library.locked) return;
    if (['checkbox', 'text'].includes(input.type) && input.dataset.rhythmSetting !== 'groups') applyField(input);
  }, listen);
  const followRackScroll = () => {
    if (velocityEditor.open) velocityScroll.scrollLeft = rackScroll.scrollLeft;
  };
  rackScroll.addEventListener('scroll', followRackScroll, listen);
  velocityEditor.addEventListener('toggle', followRackScroll, listen);
  velocityScroll.addEventListener('scroll', () => {
    if (velocityEditor.open) rackScroll.scrollLeft = velocityScroll.scrollLeft;
  }, listen);
  for (const [key, label] of [['bpm-slider', 'bpm'], ['metronomeSwing', 'metro-swing'], ['rhythm-swing', 'rhythm-swing']] as const) {
    const input = field(key);
    bindRhythmDial(input, () => {
      if (key === 'bpm-slider') {
        if (!inputErrors.has('bpm')) field('bpm').value = input.value;
      } else output(label).textContent = `${input.value}%`;
    }, listener.signal);
  }
  container.addEventListener('keydown', event => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !visible || disposed || library.locked) return;
    if (target.dataset.rhythmStep !== undefined && event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) accentFromRack(target);
    } else if ((target.dataset.rhythmChoice || target.dataset.rhythmClipSelect) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const keys = Array.from(target.closest('.rhythm-segment')?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const index = keys.indexOf(target);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1
        : Math.min(keys.length - 1, Math.max(0, index + (event.key === 'ArrowLeft' ? -1 : 1)));
      keys[next].focus();
    } else if (target.dataset.rhythmStep !== undefined && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const step = Number(target.dataset.rhythmStep), row = project.channels.findIndex(item => item.id === target.dataset.rhythmChannel);
      selectedStep = event.key === 'Home' ? 0 : event.key === 'End' ? 15 : Math.min(15, Math.max(0, step + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)));
      selectedLane = project.channels[Math.min(project.channels.length - 1, Math.max(0, row + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)))].id;
      renderRack(); output('rack').querySelector<HTMLElement>(`[data-rhythm-channel="${CSS.escape(selectedLane)}"][data-rhythm-step="${selectedStep}"]`)?.focus();
    }
  }, listen);
  document.addEventListener('keydown', event => {
    if (!visible || disposed) return;
    handleTransportKey(event, container, {
      stop,
      toggle: () => { if (playing()) pause(); else void sound(snapshot?.state === 'paused' ? 'resume' : 'start'); },
      keepSpaceOn: '[role="region"][tabindex], .rhythm-rack-scroll, .rhythm-side-scroll',
    });
  }, listen);
  onPageVisibility(listener.signal, () => {
    if (visible) { cancelFader(); pause('hidden'); }
    syncTransport();
  }, syncTransport);

  function applyPreferences(next: RhythmPreferences) {
    if (disposed) return;
    cancelFader();
    const checked = withProjectTempo(validateRhythmPreferences(next), project);
    stop(); preferences = checked; inputErrors.clear(); audioError = ''; taps = [];
    syncFields(); renderBeats(); syncTransport(); showError(); configure();
  }
  function setVisible(next: boolean) {
    if (disposed || next === visible) return;
    if (!next) { cancelFader(); pause('module'); }
    visible = next; container.hidden = !next; syncTransport();
  }
  function dispose() {
    if (disposed) return;
    cancelFader();
    library.dispose(); ++runIntent; disposed = true;
    listener.abort(); void player.dispose(); container.replaceChildren(); container.classList.remove('rhythm-view');
  }
  output('kits').append(...rhythmKitButtons());
  output('presets').append(...rhythmPresetButtons());
  setField('project-name', project.name); syncFields(); renderBeats(); renderEditor(); renderLibrary(); configure(); syncTransport();
  return {
    getPreferences: () => preferences, applyPreferences, applyLibrary: library.apply,
    getPractice: () => player.getPractice(), setVisible, pause, stop, dispose,
  };
}
