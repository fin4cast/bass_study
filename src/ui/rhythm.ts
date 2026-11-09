import './rhythm.css';
import { createRhythmPlayer, type RhythmPracticeClock, type RhythmSnapshot } from '../audio/rhythm';
import {
  DEFAULT_RHYTHM_PREFERENCES, DEFAULT_RHYTHM_VELOCITY, RHYTHM_PATTERN_LENGTHS, RHYTHM_PRESETS, RHYTHM_STEPS_PER_BAR, SOUND_LABELS,
  createDefaultRhythmProject, createLanes, defaultRhythmAccents, defaultRhythmMeter,
  validateRhythmPreferences, validateRhythmProject, type RhythmBpmUnit, type RhythmDivision, type RhythmKit,
  type RhythmPatternBars, type RhythmPatternId, type RhythmPlaybackConfig, type RhythmPreferences,
  type RhythmProject, type RhythmSound, type RhythmStep, type RhythmSwingMode,
} from '../rhythm/model';
import { confirmAction } from './confirm';
import { rhythmInstrumentArt } from './rhythm/instrument-art';
import { bindRhythmDial, paintRhythmDial, rhythmButton, rhythmMarkup } from './rhythm/view';

export type RhythmLibraryOperation = { readonly kind: 'save'; readonly project: RhythmProject }
  | { readonly kind: 'select'; readonly id: string | null } | { readonly kind: 'delete'; readonly id: string };
export interface RhythmLibrary { readonly projects: readonly RhythmProject[]; readonly activeId: string | null }
export interface RhythmOptions {
  readonly onBeforeStart?: () => void;
  readonly onPreferencesChange?: () => void;
  readonly onLibraryChange?: (operation: RhythmLibraryOperation) => Promise<RhythmLibrary>;
  readonly onPracticeEnd?: (practice: RhythmPracticeClock) => void;
  readonly onPracticeChange?: () => void;
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
const clone = <T,>(value: T) => structuredClone(value) as Mutable<T>;
const nextPatternLength = (bars: RhythmPatternBars) => RHYTHM_PATTERN_LENGTHS.find(length => length > bars);
const PATTERN_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
const LEVELS = ['Без щелчка', 'Доля', 'Акцент'];
const KITS: ReadonlyArray<readonly [RhythmKit, string, string]> = [
  ['wood', 'Дерево', 'Мягкий короткий щелчок'], ['classic', 'Классический', 'Чёткий механический пульс'],
  ['electronic', 'Электронный', 'Чистый короткий тон'], ['bell', 'Колокольчик', 'Светлый звонкий акцент'],
  ['clave', 'Клавес', 'Сухой деревянный удар'], ['drum', 'Ударные', 'Бочка и малый'],
];
const TRAINING_NUMBERS = ['soundBars', 'silentBars', 'stepBpm', 'everyBars', 'targetBpm'] as const;
const TRAINING_FLAGS = ['silentEnabled', 'rampEnabled'] as const;
const STARTED = new Set(['starting', 'running', 'finishing']);
const TRANSPORT_LABELS = { starting: 'Подготовка звука…', running: 'Играет', paused: 'Пауза', finishing: 'Завершение', finished: 'Проход завершён', stopped: 'Остановлено' };
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error);
let instance = 0;

function setMetronomeTempo(metronome: Mutable<RhythmPreferences['metronome']>, bpm: number) {
  metronome.bpm = bpm;
  if (metronome.training.rampEnabled) metronome.training.targetBpm = Math.max(metronome.training.targetBpm, bpm);
}

function withProjectTempo(preferences: RhythmPreferences, project: RhythmProject): RhythmPreferences {
  if (!project.overlay || project.bpm === preferences.metronome.bpm) return preferences;
  const next = clone(preferences);
  setMetronomeTempo(next.metronome, project.bpm);
  return validateRhythmPreferences(next);
}

export function mountRhythm(container: HTMLElement, options: RhythmOptions = {}) {
  const listener = new AbortController();
  const listen = { signal: listener.signal };
  let visible = !container.hidden, disposed = false;
  let preferences = DEFAULT_RHYTHM_PREFERENCES;
  let library: RhythmLibrary = { projects: [], activeId: null };
  const newProject = (name?: string) => createDefaultRhythmProject(crypto.randomUUID(), name);
  let project = newProject();
  let selectedBar = 0, selectedStep = 0, selectedLane = project.channels[0].id;
  let selectedSound: RhythmSound | null = null;
  let selectedClip: string | null = null;
  let copiedBar: Map<string, { steps: RhythmStep[]; velocities: number[] }> | null = null;
  let intent = 0, runIntent = 0, saving = false, libraryCommand = false;
  let failedWrite: { operation: RhythmLibraryOperation; replace: boolean; notice?: string } | null = null;
  let snapshot: RhythmSnapshot | null = null, practiceKey = '';
  let presetId: string | null = 'rock';
  let taps: number[] = [];
  const inputErrors = new Map<string, string>();
  let audioError = '';

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
  const wideSettings = window.matchMedia('(min-width: 1440px) and (min-height: 700px)');
  const settingsToggle = container.querySelector<HTMLButtonElement>('[data-rhythm-settings-toggle]')!;
  const settingsPanels = Array.from(container.querySelectorAll<HTMLElement>('[data-rhythm-settings-panel]'));
  let settingsOpen = wideSettings.matches;
  const activePattern = () => project.patterns.find(pattern => pattern.id === project.activePatternId)!;
  const isRhythm = () => preferences.view === 'rhythm';
  const playing = () => snapshot !== null && STARTED.has(snapshot.state);
  const canUseAudio = () => visible && !disposed && !document.hidden && !inputErrors.size && !libraryCommand;
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
    if (!open) settingsToggle.focus();
    else if (!wideSettings.matches) {
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ block: 'nearest' });
    }
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
    container.dataset.rhythmLibraryPending = String(saving);
    container.dataset.rhythmLibraryError = String(!!failedWrite);
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
    const positionOutput = output('position');
    if (!active || !position) {
      const text = TRANSPORT_LABELS[snapshot?.state ?? 'stopped'];
      if (positionOutput.textContent !== text) positionOutput.textContent = text;
      return;
    }
    const phase = snapshot?.state === 'paused' ? 'Пауза' : snapshot?.phase === 'count-in' ? 'Отсчёт' : position.silent ? 'Немой такт' : 'Играет';
    const tempo = isRhythm() ? project.bpm : preferences.metronome.bpm;
    const text = `${phase} · такт ${position.bar}, доля ${position.beat}${snapshot?.bpm === tempo ? '' : ` · ${snapshot?.bpm} BPM`}`;
    if (positionOutput.textContent !== text) positionOutput.textContent = text;
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
      snapshot = next;
      syncTransport(); paintPosition();
      const key = next.runtimeContextKey ?? '';
      if (key !== practiceKey) { practiceKey = key; options.onPracticeChange?.(); }
    },
  });
  function stop() { if (!disposed) { ++runIntent; player.stop(); syncTransport(); } }
  function pause(reason = 'manual') { if (!disposed) { ++runIntent; player.pause(reason); syncTransport(); } }
  function configure() {
    if (inputErrors.size || disposed) return;
    try { player.configure(config()); }
    catch (failure) { stop(); audioError = failureText(failure); showError(); }
  }
  async function sound(command: 'start' | 'resume' | 'preview') {
    if (!canUseAudio() || (command === 'start' && (playing() || snapshot?.state === 'paused'))) return;
    const expected = ++runIntent;
    audioError = ''; showError();
    try {
      options.onBeforeStart?.();
      if (expected !== runIntent || !canUseAudio()) return;
      if (command === 'start') await player.start(config());
      else if (command === 'resume') await player.resume();
      else { player.configure(config()); await player.preview('accent', preferences.metronome.kit); }
    } catch (failure) {
      if (disposed || expected !== runIntent) return;
      stop(); audioError = failureText(failure); showError();
    }
  }
  function paintFader(input: HTMLInputElement, value = input.valueAsNumber) {
    const label = `${Math.round(value * 100)}%`;
    input.setAttribute('aria-valuetext', label);
    input.closest('.rhythm-channel')!.querySelector<HTMLOutputElement>('[data-rhythm-level]')!.value = label;
  }
  function setField(key: string, value: string | number | boolean) {
    const input = field(key);
    if (inputErrors.has(key)) return;
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
    field('metronomeSwing').closest('label')!.hidden = !swingAvailable;
    output('metro-swing').hidden = !swingAvailable;
    output('swing-unavailable').hidden = swingAvailable;
    output('swing-explanation').textContent = metro.division === 4 ? 'Выбери, где чередуются длинные и короткие шаги.'
      : metro.division === 2 ? 'Свинг делит долю на длинную и короткую части.' : 'Свинг доступен при делении доли на две или четыре части.';
    setField('rhythm-swing', project.swing); syncChoice('rhythm-swing-mode', project.swingMode);
    setField('master', preferences.master); setField('rhythmClick', project.overlay);
    const bpm = isRhythm() ? project.bpm : metro.bpm;
    const tempoUnit = isRhythm() ? 'quarter' : metro.bpmUnit;
    setField('bpm', bpm); setField('bpm-slider', bpm); setField('countIn', isRhythm() ? project.countIn : metro.countIn);
    output('tempo-unit').textContent = tempoUnit === 'quarter' ? '♩' : tempoUnit === 'eighth' ? '♪' : '♩.';
    output('linked-tempo').hidden = !project.overlay;
    output('overlay-help').textContent = project.overlay
      ? 'Общий BPM. Ритм считает четверти в 4/4. Клик наследует акценты, подразделения и свинг метронома. /4 даёт четыре позиции основного клика на такт, /8 — восемь. Рисунок повторяется или обрезается на границе такта.'
      : 'Включи наложение, чтобы использовать настройки клика метронома и связать темп двух вкладок.';
    output('metro-swing').textContent = `${metro.swing}%`; output('rhythm-swing').textContent = `${project.swing}%`;
    const meter = `${metro.meter.beats}/${metro.meter.denominator}`;
    output('meter-label').textContent = meter;
    const groups = output('meter-summary');
    groups.hidden = metro.meter.groups.length < 2;
    groups.textContent = groups.hidden ? '' : metro.meter.groups.join('+');
    output('kit-name').textContent = KITS.find(([key]) => key === metro.kit)![1];
    const { silentEnabled, rampEnabled, soundBars, silentBars, stepBpm, targetBpm } = metro.training;
    const training = [silentEnabled && `Со звуком: ${soundBars}, без: ${silentBars}`, rampEnabled && `+${stepBpm} BPM до ${targetBpm}`].filter(Boolean);
    output('training-summary').textContent = training.length ? training.join(' · ') : 'Немые такты и рост темпа';
    for (const control of container.querySelectorAll<HTMLButtonElement>('[data-rhythm-mode]')) {
      const active = control.dataset.rhythmMode === preferences.view;
      control.tabIndex = active ? 0 : -1; control.setAttribute('aria-selected', String(active));
    }
    for (const panel of container.querySelectorAll<HTMLElement>('[data-rhythm-panel], [data-rhythm-dock]')) {
      panel.hidden = (panel.dataset.rhythmPanel ?? panel.dataset.rhythmDock) !== preferences.view;
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
    const metro = preferences.metronome, starts = new Set<number>();
    let start = 0;
    for (const group of metro.meter.groups) { starts.add(start); start += group; }
    const beats = metro.accents.map((level, index) => {
      const group = document.createElement('div'); group.className = `rhythm-beat-group${starts.has(index) ? ' is-group-start' : ''}`;
      const beat = rhythmButton(String(index + 1), { rhythmBeat: String(index), rhythmFocus: `beat-${index}`, level: String(level) }, `Доля ${index + 1}. ${LEVELS[level]}`);
      beat.className = 'rhythm-beat';
      const lamp = document.createElement('span'); lamp.className = 'rhythm-beat-lamp'; lamp.setAttribute('aria-hidden', 'true');
      const label = document.createElement('small'); label.textContent = level === 0 ? 'Пауза' : LEVELS[level];
      beat.append(lamp, label); group.append(beat);
      if (metro.division > 1) {
        const subdivisions = document.createElement('div'); subdivisions.className = 'rhythm-substeps';
        for (let subdivision = 1; subdivision < metro.division; subdivision++) {
          const key = index * (metro.division - 1) + subdivision - 1;
          const step = rhythmButton('·', { rhythmSubstep: String(subdivision), rhythmSubIndex: String(key), rhythmFocus: `sub-${key}` }, `Доля ${index + 1}, подразделение ${subdivision}`);
          step.className = 'rhythm-substep'; step.setAttribute('aria-pressed', String(metro.substeps[key])); subdivisions.append(step);
        }
        group.append(subdivisions);
      }
      return group;
    });
    withFocus(() => output('beats').replaceChildren(...beats)); paintPosition();
  }
  function renderLibrary() {
    const unavailable = !options.onLibraryChange || saving || !!failedWrite;
    const rows = library.projects.map(entry => {
      const row = document.createElement('div'); row.className = 'rhythm-project-row';
      const open = rhythmButton(entry.name, { rhythmOpenProject: entry.id, rhythmFocus: `project-${entry.id}` });
      open.disabled = unavailable; open.setAttribute('aria-pressed', String(entry.id === project.id));
      const remove = rhythmButton('×', { rhythmDeleteProject: entry.id, rhythmFocus: `delete-${entry.id}` }, `Удалить проект «${entry.name}»`);
      remove.disabled = unavailable; row.append(open, remove); return row;
    });
    withFocus(() => output('projects').replaceChildren(...rows));
    output('project-count').textContent = String(rows.length);
    action('new-project').disabled = unavailable;
    action('duplicate-project').disabled = unavailable;
    action('save-project').disabled = !options.onLibraryChange || saving;
    action('save-project').textContent = failedWrite ? failedWrite.operation.kind === 'save' ? 'Повторить сохранение' : 'Повторить действие' : 'Сохранить проект';
    action('retry-project').hidden = !failedWrite;
    action('retry-project').disabled = saving;
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
    const row = document.createElement('div'); row.className = 'rhythm-velocity-row';
    const label = document.createElement('div'); label.className = 'rhythm-velocity-label';
    const name = document.createElement('strong'); name.textContent = channel.name;
    const level = document.createElement('output'); level.className = 'rhythm-velocity-value'; level.setAttribute('aria-live', 'off');
    label.append(name, level); row.append(label);
    for (let beat = 0; beat < 4; beat++) {
      const bank = document.createElement('div'); bank.className = 'rhythm-pad-bank';
      for (let offset = 0; offset < 4; offset++) {
        const step = beat * 4 + offset;
        const cell = document.createElement('div'); cell.className = 'rhythm-velocity-cell';
        const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '.01';
        slider.value = String(lane.velocities[selectedBar * 16 + step]); slider.dataset.rhythmVelocity = String(step);
        slider.dataset.rhythmFocus = `velocity-${step}`; slider.setAttribute('aria-label', `Сила удара ${channel.name}, шаг ${step + 1}`);
        const track = document.createElement('span'); track.className = 'rhythm-velocity-track'; track.setAttribute('aria-hidden', 'true');
        cell.append(track, slider); bank.append(cell);
      }
      row.append(bank);
    }
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
    const ruler = document.createElement('div'); ruler.className = 'rhythm-rack-ruler';
    const meter = document.createElement('span'); meter.textContent = '4/4'; ruler.append(meter);
    for (let beat = 1; beat <= 4; beat++) {
      const span = document.createElement('span'); span.className = 'rhythm-rack-beat'; span.textContent = String(beat); ruler.append(span);
    }
    const rows = project.channels.map(channel => {
      const row = document.createElement('div'); row.className = `rhythm-rack-row${channel.muted ? ' is-muted' : ''}`; row.dataset.rhythmLane = channel.id;
      const controls = document.createElement('div'); controls.className = 'rhythm-lane-controls';
      const name = rhythmButton('', { rhythmSelectLane: channel.id, rhythmFocus: `lane-${channel.id}` }, `Выбрать канал ${channel.name}`);
      name.className = 'rhythm-lane-name'; name.setAttribute('aria-pressed', String(channel.id === selectedLane));
      name.innerHTML = rhythmInstrumentArt(channel.sound);
      const label = document.createElement('span'); label.textContent = channel.name; name.append(label);
      controls.append(name); row.append(controls);
      for (let beat = 0; beat < 4; beat++) {
        const bank = document.createElement('div'); bank.className = 'rhythm-pad-bank';
        for (let offset = 0; offset < 4; offset++) {
          const step = beat * 4 + offset;
          const button = rhythmButton('', { rhythmStep: String(step), rhythmChannel: channel.id, rhythmFocus: `step-${channel.id}-${step}` });
          button.className = 'rhythm-step';
          button.title = 'Правый клик или Shift+Enter — переключить акцент';
          button.setAttribute('aria-keyshortcuts', 'Shift+Enter');
          bank.append(button);
        }
        row.append(bank);
      }
      return row;
    });
    withFocus(() => rack.replaceChildren(ruler, ...rows));
    paintSteps(); renderVelocity();
  }
  function renderMixer() {
    const channels = project.channels.map(channel => {
      const strip = document.createElement('div'); strip.className = 'rhythm-channel';
      const title = document.createElement('span'); title.className = 'rhythm-channel-name'; title.textContent = channel.name; title.title = channel.name;
      const slot = document.createElement('span'); slot.className = 'rhythm-fader-slot';
      const volume = document.createElement('input'); volume.type = 'range'; volume.className = 'rhythm-fader';
      volume.min = '0'; volume.max = '1.5'; volume.step = '.05'; volume.value = String(channel.volume);
      volume.dataset.rhythmVolume = channel.id; volume.dataset.rhythmFocus = `volume-${channel.id}`; volume.setAttribute('aria-label', `Громкость ${channel.name}`);
      slot.append(volume);
      const level = document.createElement('output'); level.dataset.rhythmLevel = '';
      const keys = document.createElement('div'); keys.className = 'rhythm-channel-keys';
      const mute = rhythmButton('M', { rhythmMute: channel.id, rhythmFocus: `mute-${channel.id}` }, `${channel.name}. Заглушить`);
      mute.className = 'rhythm-lane-mute'; mute.setAttribute('aria-pressed', String(channel.muted)); mute.title = 'Заглушить';
      const solo = rhythmButton('S', { rhythmSolo: channel.id, rhythmFocus: `solo-${channel.id}` }, `${channel.name}. Соло`);
      solo.className = 'rhythm-lane-solo'; solo.setAttribute('aria-pressed', String(channel.solo)); solo.title = 'Соло';
      keys.append(mute, solo); strip.append(title, slot, level, keys); paintFader(volume, channel.volume);
      return strip;
    });
    withFocus(() => output('mixer').replaceChildren(...channels));
  }
  function renderChain() {
    const selectedIndex = project.chain.findIndex(clip => clip.id === selectedClip);
    if (selectedIndex < 0) selectedClip = null;
    let bars = 0;
    const clips = project.chain.map((clip, index) => {
      const pattern = project.patterns.find(item => item.id === clip.patternId)!;
      const card = rhythmButton('', { rhythmClip: clip.id, rhythmClipPattern: pattern.id, rhythmFocus: `clip-title-${clip.id}` }, `Блок ${index + 1}. Паттерн ${pattern.id}. ${pattern.name}`);
      card.className = 'rhythm-clip'; card.setAttribute('aria-pressed', String(index === selectedIndex));
      card.title = pattern.name;
      const mark = document.createElement('span'); mark.className = 'rhythm-clip-mark'; mark.textContent = pattern.id;
      const name = document.createElement('span'); name.className = 'rhythm-clip-name'; name.textContent = pattern.name;
      const range = document.createElement('span'); range.className = 'rhythm-clip-range';
      range.textContent = pattern.bars === 1 ? `Такт ${bars + 1}` : `Такты ${bars + 1}–${bars + pattern.bars}`;
      bars += pattern.bars; card.append(mark, name, range);
      return card;
    });
    const editor = output('clip-editor');
    withFocus(() => {
      output('chain').replaceChildren(...clips);
      editor.hidden = selectedIndex < 0;
      editor.replaceChildren();
      if (selectedIndex < 0) return;
      const clip = project.chain[selectedIndex];
      const title = document.createElement('strong'); title.className = 'rhythm-clip-editor-title';
      title.textContent = `Блок ${selectedIndex + 1} · ${project.patterns.find(pattern => pattern.id === clip.patternId)!.name}`;
      const patterns = document.createElement('div'); patterns.className = 'rhythm-segment';
      patterns.setAttribute('role', 'group'); patterns.setAttribute('aria-label', `Паттерн блока ${selectedIndex + 1}`);
      for (const item of project.patterns) {
        const key = rhythmButton(item.id, {
          rhythmClipSelect: clip.id, rhythmValue: item.id, rhythmFocus: `clip-${clip.id}-${item.id}`,
        }, `Паттерн ${item.id}. ${item.name}`);
        key.title = item.name;
        key.setAttribute('aria-pressed', String(item.id === clip.patternId)); patterns.append(key);
      }
      const controls = document.createElement('div'); controls.className = 'rhythm-clip-actions';
      for (const [move, label, text] of [['left', 'Переместить влево', '←'], ['right', 'Переместить вправо', '→'], ['remove', 'Убрать', '×']] as const) {
        const button = rhythmButton(text, { rhythmClipAction: move, rhythmClipId: clip.id, rhythmFocus: `clip-${move}-${clip.id}` }, `${label} блок ${selectedIndex + 1}`);
        button.title = label;
        button.disabled = move === 'left' ? selectedIndex === 0 : move === 'right' ? selectedIndex + 1 === project.chain.length : project.chain.length === 1;
        controls.append(button);
      }
      editor.append(title, patterns, controls);
    });
    output('chain-length').textContent = `${bars} такт. ${project.repeat === 'loop' ? '· по кругу' : '· один проход'}`;
    action('add-clip').disabled = project.chain.length >= 8; paintPosition();
  }
  function renderEditor() {
    const pattern = activePattern();
    selectedBar = Math.min(selectedBar, pattern.bars - 1);
    if (!project.channels.some(channel => channel.id === selectedLane)) selectedLane = project.channels[0].id;
    const patternButtons = project.patterns.map(item => {
      const button = rhythmButton(item.id, { rhythmPattern: item.id, rhythmFocus: `pattern-${item.id}` }, `Паттерн ${item.id}. ${item.name}`);
      button.setAttribute('aria-pressed', String(item.id === pattern.id)); return button;
    });
    const bars = Array.from({ length: pattern.bars }, (_, index) => {
      const button = rhythmButton(`Такт ${index + 1}`, { rhythmBar: String(index), rhythmFocus: `bar-${index}` });
      button.setAttribute('aria-pressed', String(index === selectedBar)); return button;
    });
    const nextLength = nextPatternLength(pattern.bars);
    if (nextLength !== undefined) {
      const addBar = rhythmButton('+ Такт', { rhythmAction: 'add-bar', rhythmFocus: `bar-${pattern.bars}` }, `Добавить такт ${nextLength}`);
      addBar.className = 'rhythm-add-bar';
      addBar.title = `Добавить пустой такт ${nextLength}`;
      bars.push(addBar);
    }
    withFocus(() => { output('patterns').replaceChildren(...patternButtons); output('bars').replaceChildren(...bars); });
    output('pattern-title').textContent = pattern.name;
    setField('pattern-name', pattern.name); syncChoice('bars', pattern.bars);
    const sounds = output('sounds');
    const unused = (Object.keys(SOUND_LABELS) as RhythmSound[]).filter(sound => !project.channels.some(channel => channel.sound === sound));
    if (!selectedSound || !unused.includes(selectedSound)) selectedSound = unused[0] ?? null;
    const soundButtons = unused.map(sound => {
      const button = rhythmButton('', { rhythmChoice: 'new-sound', rhythmValue: sound, rhythmFocus: `sound-${sound}` });
      button.innerHTML = rhythmInstrumentArt(sound);
      const label = document.createElement('span'); label.textContent = SOUND_LABELS[sound]; button.append(label);
      return button;
    });
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
  function acceptLibrary(next: RhythmLibrary, saveLinkedTempo = false) {
    stop(); library = next;
    const active = next.projects.find(item => item.id === next.activeId);
    project = active ? validateRhythmProject(active) : newProject();
    const before = preferences;
    preferences = withProjectTempo(preferences, project);
    resetEditing();
    if (saveLinkedTempo && preferences !== before) options.onPreferencesChange?.();
  }
  function setLibraryBusy(next: boolean, command: boolean) {
    saving = next; libraryCommand = command;
    for (const section of container.querySelectorAll<HTMLElement>('.rhythm-constructor, .rhythm-chain-card, .rhythm-project-tools, .rhythm-mix-module, .rhythm-velocity-defaults')) section.inert = command;
    renderLibrary();
  }
  async function write(operation: RhythmLibraryOperation, replace = false, notice?: string) {
    if (disposed || !options.onLibraryChange) return;
    const expected = ++intent;
    failedWrite = null; setLibraryBusy(true, replace || operation.kind !== 'save');
    try {
      const next = await options.onLibraryChange(operation);
      if (disposed || expected !== intent) return;
      setLibraryBusy(false, false);
      if (replace) acceptLibrary(next, true); else { library = next; renderLibrary(); }
      if (notice) status(notice);
    } catch (failure) {
      if (disposed || expected !== intent) return;
      failedWrite = { operation, replace, notice }; setLibraryBusy(false, false);
      status(`Изменения пока не сохранены. ${failureText(failure)}`);
    }
  }
  function changeProject(edit: (draft: Mutable<RhythmProject>) => void, paint = true) {
    if (libraryCommand || disposed) return;
    const draft = clone(project); edit(draft);
    draft.updatedAt = new Date(Math.max(Date.now(), Date.parse(draft.updatedAt))).toISOString();
    project = validateRhythmProject(draft);
    const before = preferences;
    preferences = withProjectTempo(preferences, project);
    configure(); syncFields();
    if (paint) renderEditor();
    void write({ kind: 'save', project });
    if (preferences !== before) options.onPreferencesChange?.();
  }
  function resizePattern(bars: RhythmPatternBars, nextBar = selectedBar) {
    changeProject(draft => {
      const pattern = draft.patterns.find(item => item.id === draft.activePatternId)!;
      const length = bars * RHYTHM_STEPS_PER_BAR;
      for (const lane of pattern.lanes) {
        lane.steps = Array.from({ length }, (_, index) => lane.steps[index] ?? 0);
        lane.velocities = Array.from({ length }, (_, index) => lane.velocities[index] ?? 0);
      }
      pattern.bars = bars;
    }, false);
    selectedBar = nextBar;
    renderEditor();
  }
  function changePreferences(edit: (draft: Mutable<RhythmPreferences>) => void, beats = false) {
    const draft = clone(preferences); edit(draft); preferences = validateRhythmPreferences(draft);
    configure(); syncFields(); if (beats) renderBeats(); options.onPreferencesChange?.();
  }
  function changeView(view: RhythmPreferences['view']) {
    if (view === preferences.view) return;
    stop(); inputErrors.clear(); audioError = ''; taps = [];
    changePreferences(draft => { draft.view = view; }); showError(); syncTransport();
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
    if (isRhythm() || project.overlay) changeProject(draft => { draft.bpm = bpm; }, false);
    else changePreferences(draft => { setMetronomeTempo(draft.metronome, bpm); });
    showError(); syncTransport();
  }
  function applyField(input: HTMLInputElement | HTMLButtonElement) {
    if (disposed || libraryCommand) return;
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
        if (isRhythm()) changeProject(draft => { draft.countIn = value; }, false);
        else changePreferences(draft => { draft.metronome.countIn = value; });
      } else if (key === 'rhythmClick') {
        const overlay = (input as HTMLInputElement).checked;
        if (overlay) inputErrors.delete('bpm');
        changeProject(draft => {
          if (overlay && !draft.overlay) draft.bpm = preferences.metronome.bpm;
          draft.overlay = overlay;
        }, false);
      } else if (key === 'rhythm-swing' || key === 'rhythm-swing-mode') {
        changeProject(draft => { if (key === 'rhythm-swing') draft.swing = Number(value); else draft.swingMode = value as RhythmSwingMode; }, false);
      } else if (key === 'pattern-name') {
        const name = input.value.trim(); if (!name) { setField(key, activePattern().name); return; }
        changeProject(draft => { draft.patterns.find(pattern => pattern.id === draft.activePatternId)!.name = name; });
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
  function editLane(id: string, update: (channel: Mutable<RhythmProject['channels'][number]>) => void, paint = false) {
    changeProject(draft => { const lane = draft.channels.find(channel => channel.id === id); if (lane) update(lane); }, paint);
  }
  function defaultStepVelocity(laneId: string, level: RhythmStep) {
    if (level === 0) return 0;
    const defaults = project.channels.find(channel => channel.id === laneId)!.velocityDefaults;
    return (level === 2 ? defaults.accent : defaults.hit) / 100;
  }
  function editStep(laneId: string, step: number, level: RhythmStep, velocity = defaultStepVelocity(laneId, level), keepSlider = false) {
    selectedLane = laneId; selectedStep = step; presetId = null;
    changeProject(draft => {
      const lane = draft.patterns.find(item => item.id === draft.activePatternId)!.lanes.find(item => item.channelId === laneId)!;
      const index = selectedBar * 16 + step; lane.steps[index] = level; lane.velocities[index] = velocity;
    }, false);
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
    const lanes = createLanes(preset.id, activePattern().bars);
    stop(); presetId = id; selectedBar = selectedStep = 0; inputErrors.delete('bpm'); audioError = '';
    changeProject(draft => {
      const sources = new Map<string, typeof lanes[number]>();
      for (const { steps: _steps, velocities: _velocities, ...channel } of lanes) {
        const existing = draft.channels.find(item => item.sound === channel.sound);
        if (!existing && draft.channels.length >= 8) continue;
        const id = existing?.id ?? (draft.channels.some(item => item.id === channel.id) ? crypto.randomUUID() : channel.id);
        if (!existing) draft.channels.push({ ...channel, id });
        sources.set(id, lanes.find(item => item.sound === channel.sound)!);
      }
      selectedLane = sources.keys().next().value ?? draft.channels[0].id;
      for (const pattern of draft.patterns) {
        const active = pattern.id === draft.activePatternId;
        pattern.lanes = draft.channels.map(channel => {
          const source = active ? sources.get(channel.id) : pattern.lanes.find(item => item.channelId === channel.id);
          return { channelId: channel.id, steps: source?.steps ?? Array<RhythmStep>(pattern.bars * 16).fill(0), velocities: source?.velocities ?? Array<number>(pattern.bars * 16).fill(0) };
        });
        if (active) pattern.name = preset.name;
      }
      draft.bpm = preset.bpm; draft.swing = preset.swing; draft.swingMode = 'eighth';
    });
    showError(); syncTransport();
    status(`Основа «${preset.name}» открыта в паттерне ${project.activePatternId}.`);
  }
  function patternAction(duplicate: boolean) {
    const id = PATTERN_IDS.find(value => !project.patterns.some(pattern => pattern.id === value)); if (!id) return;
    stop(); selectedBar = selectedStep = 0; presetId = null;
    changeProject(draft => {
      const source = draft.patterns.find(item => item.id === draft.activePatternId)!;
      const pattern = duplicate ? { ...structuredClone(source), id, name: `${source.name.slice(0, 41)} · копия` }
        : { id, name: `Паттерн ${id}`, bars: 1 as const, lanes: draft.channels.map(channel => ({ channelId: channel.id, steps: Array<RhythmStep>(16).fill(0), velocities: Array<number>(16).fill(0) })) };
      draft.patterns.push(pattern); draft.activePatternId = id;
    });
  }
  function barAction(copy: boolean) {
    if (copy && !copiedBar) {
      copiedBar = new Map(activePattern().lanes.map(lane => [lane.channelId, { steps: lane.steps.slice(selectedBar * 16, (selectedBar + 1) * 16), velocities: lane.velocities.slice(selectedBar * 16, (selectedBar + 1) * 16) }]));
      action('copy-bar').textContent = 'Вставить такт'; status('Такт скопирован. Выбери такт для вставки.'); return;
    }
    const paste = copy ? copiedBar : null;
    if (copy) copiedBar = null;
    presetId = null;
    changeProject(draft => {
      for (const lane of draft.patterns.find(pattern => pattern.id === draft.activePatternId)!.lanes) {
        const source = paste?.get(lane.channelId);
        if (source) { lane.steps.splice(selectedBar * 16, 16, ...source.steps); lane.velocities.splice(selectedBar * 16, 16, ...source.velocities); }
        else { lane.steps.fill(0, selectedBar * 16, (selectedBar + 1) * 16); lane.velocities.fill(0, selectedBar * 16, (selectedBar + 1) * 16); }
      }
    });
  }
  function clipAction(id: string, move: string) {
    const index = project.chain.findIndex(clip => clip.id === id);
    if (index < 0 || move === 'remove' && project.chain.length === 1) return;
    changeProject(draft => {
      if (move === 'remove') { draft.chain.splice(index, 1); return; }
      const target = index + (move === 'left' ? -1 : 1);
      if (target >= 0 && target < draft.chain.length) [draft.chain[index], draft.chain[target]] = [draft.chain[target], draft.chain[index]];
    });
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
    changeProject(draft => {
      draft.channels.push({
        id, name: SOUND_LABELS[sound], sound, volume: .65, muted: false, solo: false,
        velocityDefaults: { ...DEFAULT_RHYTHM_VELOCITY },
      });
      for (const pattern of draft.patterns) pattern.lanes.push({ channelId: id, steps: Array<RhythmStep>(pattern.bars * 16).fill(0), velocities: Array<number>(pattern.bars * 16).fill(0) });
    });
  }
  function nameForProject(fallback: string) { return field('project-name').value.trim() || fallback; }
  async function projectAction(command: 'new-project' | 'duplicate-project' | 'save-project') {
    if (saving || libraryCommand || (failedWrite && command !== 'save-project')) return;
    if (failedWrite && command === 'save-project' && failedWrite.replace) {
      const { operation, replace, notice } = failedWrite;
      await write(operation, replace, notice); return;
    }
    if (failedWrite?.operation.kind === 'delete' && command === 'save-project') {
      const { operation, replace, notice } = failedWrite;
      await write(operation, replace, notice); return;
    }
    if (command === 'new-project') { await write({ kind: 'save', project: newProject('Новый проект') }, true, 'Создан новый проект.'); return; }
    const draft = clone(project), now = new Date().toISOString();
    draft.name = nameForProject(project.name);
    draft.updatedAt = new Date(Math.max(Date.now(), Date.parse(draft.updatedAt))).toISOString();
    if (command === 'duplicate-project') {
      draft.id = crypto.randomUUID(); draft.createdAt = draft.updatedAt = now;
      if (draft.name === project.name) draft.name = `${project.name.slice(0, 41)} · копия`;
      await write({ kind: 'save', project: validateRhythmProject(draft) }, true, 'Копия проекта сохранена.');
    } else {
      project = validateRhythmProject(draft); setField('project-name', project.name);
      await write({ kind: 'save', project }, false, 'Проект сохранён.');
    }
  }
  async function deleteProject(id: string) {
    if (saving || failedWrite || libraryCommand) return;
    const expected = intent, entry = library.projects.find(item => item.id === id);
    if (!entry || !await confirmAction({ title: 'Удалить проект?', message: `«${entry.name}» будет удалён из библиотеки.`, confirmLabel: 'Удалить проект' })) return;
    if (disposed || !visible || expected !== intent) return;
    await write({ kind: 'delete', id }, id === project.id, 'Проект удалён.');
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
      case 'add-clip': if (project.chain.length < 8) changeProject(draft => { draft.chain.push({ id: crypto.randomUUID(), patternId: draft.activePatternId }); }); break;
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
      changeProject(draft => {
        const clip = draft.chain.find(item => item.id === data.rhythmClipSelect);
        if (clip) clip.patternId = data.rhythmValue as RhythmPatternId;
      });
    } else if (data.rhythmMode) changeView(data.rhythmMode as RhythmPreferences['view']);
    else if (data.rhythmDivision) changePreferences(draft => {
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
    else if (data.rhythmScope && data.rhythmScope !== project.scope) changeProject(draft => { draft.scope = data.rhythmScope as RhythmProject['scope']; });
    else if (data.rhythmRepeat && data.rhythmRepeat !== project.repeat) {
      changeProject(draft => { draft.repeat = data.rhythmRepeat as RhythmProject['repeat']; }, false); renderChain();
    }
    else if (data.rhythmPreset) loadPreset(data.rhythmPreset);
    else if (data.rhythmPattern && data.rhythmPattern !== project.activePatternId) {
      selectedBar = selectedStep = 0; presetId = null; changeProject(draft => { draft.activePatternId = data.rhythmPattern as RhythmPatternId; });
    } else if (data.rhythmBar !== undefined) { selectedBar = Number(data.rhythmBar); renderEditor(); }
    else if (data.rhythmStep !== undefined && data.rhythmChannel) {
      const step = Number(data.rhythmStep), lane = activePattern().lanes.find(item => item.channelId === data.rhythmChannel)!;
      editStep(lane.channelId, step, lane.steps[selectedBar * 16 + step] ? 0 : 1);
    } else if (data.rhythmSelectLane) { selectedLane = data.rhythmSelectLane; renderRack(); }
    else if (data.rhythmMute) editLane(data.rhythmMute, channel => { channel.muted = !channel.muted; }, true);
    else if (data.rhythmSolo) editLane(data.rhythmSolo, channel => { channel.solo = !channel.solo; }, true);
    else if (data.rhythmClipAction && data.rhythmClipId) clipAction(data.rhythmClipId, data.rhythmClipAction);
    else if (data.rhythmOpenProject && !saving && !failedWrite && data.rhythmOpenProject !== project.id) void write({ kind: 'select', id: data.rhythmOpenProject }, true, 'Проект открыт.');
    else if (data.rhythmDeleteProject) void deleteProject(data.rhythmDeleteProject);
  }
  container.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!button || button.disabled || disposed) return;
    if (button === settingsToggle || button.hasAttribute('data-rhythm-settings-close')) {
      setSettingsOpen(button === settingsToggle && !settingsOpen);
      return;
    }
    if (libraryCommand && button.dataset.rhythmAction !== 'stop' && button.dataset.rhythmAction !== 'pause') return;
    try { click(button); }
    catch (failure) { stop(); audioError = failureText(failure); showError(); }
  }, listen);
  rack.addEventListener('contextmenu', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-rhythm-step]') : null;
    if (!button || !visible || !isRhythm() || disposed || libraryCommand) return;
    event.preventDefault();
    accentFromRack(button);
  }, listen);
  for (const [input, kind] of [[newHitVelocity, 'hit'], [newAccentVelocity, 'accent']] as const) {
    input.addEventListener('change', () => {
      if (disposed || libraryCommand) return;
      const channel = project.channels.find(item => item.id === selectedLane)!;
      const previous = channel.velocityDefaults[kind];
      if (!input.validity.valid) {
        input.valueAsNumber = previous;
        return;
      }
      const value = input.valueAsNumber;
      if (value !== previous) editLane(channel.id, draft => { draft.velocityDefaults[kind] = value; });
    }, listen);
  }
  container.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || disposed || libraryCommand) return;
    if (input.dataset.rhythmVolume) {
      editLane(input.dataset.rhythmVolume, channel => { channel.volume = Number(input.value); });
      paintFader(input);
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
    if (!(input instanceof HTMLInputElement) || disposed || libraryCommand) return;
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
    if (!(target instanceof HTMLButtonElement) || !visible || disposed || libraryCommand) return;
    if (target.dataset.rhythmStep !== undefined && event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) accentFromRack(target);
    } else if (target.dataset.rhythmMode && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 'metronome' : event.key === 'End' ? 'rhythm' : isRhythm() ? 'metronome' : 'rhythm';
      changeView(next); container.querySelector<HTMLButtonElement>(`[data-rhythm-mode="${next}"]`)?.focus();
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
    if (!visible || disposed || document.hidden || event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('dialog[open]')) return;
    if (event.target instanceof Element && event.target.closest('input,select,textarea,button,a,summary,[contenteditable], [role="button"]')) return;
    if (event.code === 'Space' && event.target instanceof Element && event.target.matches('[role="region"][tabindex], .rhythm-rack-scroll, .rhythm-side-scroll')) return;
    if (event.key === 'Escape') { stop(); event.preventDefault(); }
    else if (event.code === 'Space') { event.preventDefault(); if (playing()) pause(); else void sound(snapshot?.state === 'paused' ? 'resume' : 'start'); }
  }, listen);
  document.addEventListener('visibilitychange', () => {
    if (visible && document.hidden) pause('hidden');
    syncTransport();
  }, listen);

  function applyLibrary(next: RhythmLibrary) {
    if (disposed) return;
    ++intent; failedWrite = null; setLibraryBusy(false, false); acceptLibrary(next);
  }
  function confirmLibrary(next: RhythmLibrary) {
    if (disposed) return;
    const active = next.projects.find(item => item.id === next.activeId);
    const deleted = failedWrite?.operation.kind === 'delete' && !next.projects.some(item => item.id === (failedWrite?.operation as { id: string }).id);
    if (next.activeId !== library.activeId && next.activeId !== project.id) {
      ++intent; failedWrite = null; setLibraryBusy(false, false); acceptLibrary(next, true);
    }
    else if (active && JSON.stringify(active) === JSON.stringify(project) || deleted) {
      ++intent; library = next; failedWrite = null; setLibraryBusy(false, false); status('Проект сохранён.');
    }
    else { library = next; renderLibrary(); }
  }
  function applyPreferences(next: RhythmPreferences) {
    if (disposed) return;
    const checked = withProjectTempo(validateRhythmPreferences(next), project);
    stop(); preferences = checked; inputErrors.clear(); audioError = ''; taps = [];
    syncFields(); renderBeats(); syncTransport(); showError(); configure();
  }
  function setVisible(next: boolean) {
    if (disposed) return;
    if (visible && !next) pause('module');
    visible = next; container.hidden = !next; syncTransport();
  }
  function dispose() {
    if (disposed) return;
    ++intent; ++runIntent; disposed = true;
    listener.abort(); void player.dispose(); container.replaceChildren(); container.classList.remove('rhythm-view');
  }
  for (const [id, name, description] of KITS) {
    const button = rhythmButton(name, { rhythmKit: id });
    const hint = document.createElement('small'); hint.textContent = description; button.append(hint); output('kits').append(button);
  }
  for (const preset of RHYTHM_PRESETS) {
    const button = rhythmButton(preset.name, { rhythmPreset: preset.id });
    const hint = document.createElement('small'); hint.textContent = `${preset.bpm} BPM · 4/4${preset.swing > 50 ? ' · свинг' : ''}`; button.append(hint); output('presets').append(button);
  }
  setField('project-name', project.name); syncFields(); renderBeats(); renderEditor(); renderLibrary(); configure(); syncTransport();
  return {
    getPreferences: () => preferences, applyPreferences, applyLibrary, confirmLibrary,
    getPractice: () => player.getPractice(), setVisible, pause, stop, dispose,
  };
}
