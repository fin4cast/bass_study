import './fretboard.css';
import { renderStudyFretboard, renderOctaveLegend, type StudyFretboardOptions } from './fretboard';
import { enhanceSelect } from './select-picker';
import { renderStudySelection, renderStudyInterval, renderStudyConnections } from './study-details';
import { mountTraining } from './training';
import { mountPlayer } from './player';
import { mountNotation } from './notation';
import { studyExerciseMaterial, studyWindow } from '../app/study-material';
import { getBoxCatalogue, getBoxInstance, type BoxSelection, type BoxInstance } from '../music/boxes';
import { createRouteMaterial, createFreeRouteMaterial, type RouteMaterial, type RouteSession } from '../route';
import { DEFAULT_PREFERENCES, type AppPreferences } from '../storage';
import type { PracticeBinding } from '../app/practice-drafts';
import type { PracticeMaterial } from '../training/results';
import type { QuizSession, QuestionContext } from '../training';
import { createStructure, type AnnotatedPosition, type LabelMode, type StringId, type StructureId } from '../music';
import { STRING_ORDER, boxLabel, boxOptionsMarkup, foundationMarkup, nearestBoxSelection, positionLabel, structureNotesMarkup } from './foundation-view';

interface FoundationOptions {
  onPreferencesChange(value: Pick<AppPreferences, 'study' | 'training' | 'player'>): void;
  getPlayerFallback(): AppPreferences['player'];
  onBeforeMaterialChange(): void;
  onBeforeModeChange(): void;
  onContextChange(): void;
  onRouteExit(): void;
  capturePractice(): void;
  getRouteSession(): RouteSession | null | undefined;
  onBeforeStart(): boolean;
  onPlaybackStopped(): void;
  onSessionChanged(session: QuizSession): void;
  onSessionFinished(session: QuizSession): void;
  getOuterBottomSpace(): number;
  reveal(target: HTMLElement | SVGElement): void;
}

export function mountFoundation(host: HTMLElement, options: FoundationOptions) {
  const state = {
    root: 'A',
    structureId: 'minor-pentatonic' as StructureId,
    labelMode: 'notes' as LabelMode,
    strings: [...STRING_ORDER],
    fretMin: 0,
    fretMax: 12,
    selectedId: 'A:7' as string | null,
    activeId: 'A:7' as string | null,
    box: null as BoxSelection | null,
  };

  const initialSettingsOpen = window.matchMedia('(min-width: 1320px)').matches;
  host.innerHTML = foundationMarkup(state.root, state.structureId, initialSettingsOpen);
  const root = host.querySelector<HTMLElement>('.workspace')!;
  const byId = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const neighborDetails = document.createElement('details'); neighborDetails.id = 'box-neighbor-details'; neighborDetails.className = 'learning-help';
  const neighborSummary = document.createElement('summary'); neighborSummary.className = 'section-disclosure'; neighborSummary.textContent = 'Соседняя форма';
  const neighborField = byId('neighbor-field'); neighborField.before(neighborDetails); neighborDetails.append(neighborSummary, neighborField, byId('box-neighbor-name'), byId('neighbor-switch-row'));
  const rootSelect = byId<HTMLSelectElement>('root-note');
  const structureSelect = byId<HTMLSelectElement>('structure');
  const minInput = byId<HTMLInputElement>('fret-min');
  const maxInput = byId<HTMLInputElement>('fret-max');
  const container = byId('fretboard-container');
  const selectPickers = [enhanceSelect(rootSelect, { gridColumns: 4 }), enhanceSelect(structureSelect), enhanceSelect(byId<HTMLSelectElement>('box-select')), enhanceSelect(byId<HTMLSelectElement>('box-neighbor'))];
  let positions: readonly AnnotatedPosition[] = [];
  let structure = createStructure(state.root, state.structureId);
  let exerciseMaterial = studyExerciseMaterial(structure, positions, null);
  let training: ReturnType<typeof mountTraining> | undefined;
  let sequencePlayer: ReturnType<typeof mountPlayer> | undefined;
  let notation: ReturnType<typeof mountNotation> | undefined;
  let sequenceView: 'board' | 'notation' = 'board';
  let showFingers = false;
  let showOctaves = true;
  let showInterval = true;
  let showNeighbor = false;
  let settingsOpen = initialSettingsOpen;
  let boxes: readonly BoxInstance[] = [];
  let foundationMode: 'study' | 'quiz' | 'sequence' = 'study';
  let visible = false;
  let rangeValid = true;
  let formLabel = '';
  function updateModuleVisibility() {
    const foundation = visible;
    root.querySelector<HTMLElement>('.selection-section')!.hidden = !foundation || foundationMode === 'quiz';
    byId('connections').hidden = !foundation || foundationMode === 'quiz';
    byId('study-more').hidden = !foundation || foundationMode === 'quiz';
    root.querySelector<HTMLElement>('.board-toolbar')!.hidden = foundationMode === 'quiz';
    root.querySelector<HTMLElement>('.fretboard-section')!.hidden = foundationMode === 'quiz' || (foundationMode === 'sequence' && sequenceView === 'notation');
    root.querySelector<HTMLElement>('.structure-summary')!.hidden = foundationMode === 'quiz';
    root.querySelector<HTMLElement>('.label-field')!.hidden = foundationMode === 'quiz';
    byId('player-mount').hidden = !foundation || foundationMode !== 'sequence';
    byId('sequence-view-controls').hidden = !foundation || foundationMode !== 'sequence';
    byId('notation-mount').hidden = !foundation || foundationMode !== 'sequence' || sequenceView !== 'notation';
    notation?.setVisible(foundation && foundationMode === 'sequence' && sequenceView === 'notation');
    root.querySelectorAll<HTMLElement>('[data-sequence-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sequenceView === sequenceView)));
    byId('study-context').textContent = foundationMode === 'quiz' ? 'Задания на грифе' : `${structure.root} · ${structure.name} · ${formLabel}`;
  }

  function applyStudy(study: AppPreferences['study']) {
    Object.assign(state, study, { strings: [...study.strings] });
    showFingers = study.showFingers;
    byId<HTMLInputElement>('show-fingers').checked = showFingers;
    minInput.value = String(state.fretMin); maxInput.value = String(state.fretMax);
    setRangeValidity(true);
    updateView();
  }

  function currentPlayerPreferences() {
    try { return sequencePlayer?.getPreferences() ?? options.getPlayerFallback(); }
    catch { return options.getPlayerFallback(); }
  }

  function savePreferences() {
    if (training && sequencePlayer) options.onPreferencesChange(readPreferences());
  }

  function readPreferences() {
    return {
      study: { root: state.root, structureId: state.structureId, labelMode: state.labelMode, strings: [...state.strings], fretMin: state.fretMin, fretMax: state.fretMax, box: state.box, showFingers },
      training: training?.getPreferences() ?? DEFAULT_PREFERENCES.training,
      player: currentPlayerPreferences(),
    };
  }

  function applyRouteMaterial(material: RouteMaterial) {
    const repairView = !rangeIsValid();
    const same = JSON.stringify(state.box) === JSON.stringify(material.box) && (state.box !== null || JSON.stringify(positions.map(position => position.id).sort()) === JSON.stringify([...material.referencePositionIds].sort()));
    const rootNote = material.root.replaceAll('♭', 'b').replaceAll('♯', '#');
    if (same && !repairView && state.root === rootNote && state.structureId === material.structureId) return;
    training?.finishCurrentSession('Применён материал маршрута');
    sequencePlayer?.stop();
    state.root = rootNote; state.structureId = material.structureId;
    applyBox(material.box);
    const frets = material.referencePositionIds.map(id => Number(id.split(':')[1]));
    if (!material.box) {
      state.strings = STRING_ORDER.filter(string => material.referencePositionIds.some(id => id.startsWith(`${string}:`)));
      state.fretMin = Math.min(...frets); state.fretMax = Math.max(...frets);
    } else if (repairView) {
      state.fretMin = Math.min(state.fretMin, ...frets); state.fretMax = Math.max(state.fretMax, ...frets);
    }
    minInput.value = String(state.fretMin); maxInput.value = String(state.fretMax);
    setRangeValidity(true);
    updateView();
  }

  function practiceBinding(): PracticeBinding | null {
    if (!rangeIsValid() || foundationMode === 'quiz') return null;
    const sequence = training?.getCurrentSequence();
    const player = currentPlayerPreferences();
    const material: PracticeMaterial = foundationMode === 'sequence' && sequence ? { kind: 'sequence', pattern: training?.getPreferences().pattern ?? 'ascending', routePositionIds: sequence.notes.map(position => position.id), duration: player.duration,
      fragment: { from: (player.from ?? 1) - 1, toExclusive: player.to ?? sequence.notes.length }, box: state.box } : { kind: 'fretboard', box: state.box };
    return { context: { root: structure.root, structureId: structure.id, scope: foundationMode === 'sequence' ? training?.getSequenceScope() ?? 'structure' : 'structure', positionIds: exerciseMaterial.exact.map(position => position.id), box: state.box }, material,
      routeRef: options.getRouteSession()?.status !== 'finished' ? training?.getRouteRef() ?? null : null,
      label: foundationMode === 'sequence' ? 'Последовательность на грифе' : 'Изучение грифа',
      readClock: foundationMode === 'sequence' ? () => sequencePlayer?.getPracticeDraft() ?? { durationMs: 0, comfortableBpm: 80 } : () => ({ durationMs: 0, comfortableBpm: player.bpm }) };
  }


  function updateView(announce = false, materialChanged = true) {
    if (materialChanged) {
      structure = createStructure(state.root, state.structureId);
      boxes = getBoxCatalogue(state.root, state.structureId);
      const boxSelect = byId<HTMLSelectElement>('box-select');
      boxSelect.innerHTML = boxOptionsMarkup(boxes, state.box);
    }
    const box = state.box ? getBoxInstance(state.box) : null;
    const valid = rangeIsValid();
    positions = studyWindow(structure, valid ? state : null);
    if (materialChanged) exerciseMaterial = studyExerciseMaterial(structure, positions, valid ? box : null);
    const outside = box && valid && (box.window.fretMin < state.fretMin || box.window.fretMax > state.fretMax);
    byId('show-whole-form').hidden = !outside;
    if (box) byId('box-notice').textContent = outside ? 'Часть формы находится вне области показа. Её учебный материал сохраняется целиком.' : '';
    formLabel = box ? boxLabel(box) : 'Свободный диапазон';
    byId('box-material-caption').textContent = box ? `${box.positions.length} позиций · ${box.label}` : 'Свободная область по струнам и ладам.';
    rootSelect.value = state.root; structureSelect.value = state.structureId;
    root.querySelectorAll<HTMLInputElement>('.string-switch input').forEach(input => { input.checked = state.strings.includes(input.value as StringId); });
    if (!positions.some(position => position.id === state.selectedId)) {
      state.selectedId = (positions.find(position => position.isRoot) ?? positions.find(position => position.inStructure) ?? positions[0])?.id ?? null;
    }
    if (!positions.some(position => position.id === state.activeId)) state.activeId = state.selectedId;

    byId('structure-formula').textContent = structure.formula;
    byId('structure-notes').innerHTML = structureNotesMarkup(structure);
    const included = positions.filter(position => position.inStructure).length;
    byId('position-count').textContent = `${state.box ? `${getBoxInstance(state.box).positions.length} в форме · ` : ''}${included} в структуре / ${positions.length} позиций`;
    syncLabelButtons();
    root.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === `${state.fretMin},${state.fretMax}`)));
    renderBoard();
    renderSelection(announce);
    updateModuleVisibility();
    if (materialChanged) {
      for (const picker of selectPickers) picker.refresh();
      training?.refreshContext();
      sequencePlayer?.refreshContext();
      options.onContextChange();
    }
    savePreferences();
  }

  function syncLabelButtons() {
    root.querySelectorAll<HTMLButtonElement>('[data-label-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.labelMode === state.labelMode)));
  }

  function boardOptions(): StudyFretboardOptions {
    const box = state.box ? getBoxInstance(state.box) : null;
    const boxIds = new Set(box?.referencePositionIds ?? []);
    const index = box ? boxes.findIndex(other => JSON.stringify(other.selection) === JSON.stringify(box.selection)) : -1;
    const direction = byId<HTMLSelectElement>('box-neighbor').value === 'previous' ? -1 : 1;
    const neighbor = index >= 0 ? boxes[index + direction] : undefined;
    const overlap = new Set(box && neighbor ? neighbor.referencePositionIds.filter(id => boxIds.has(id)) : []);
    neighborDetails.hidden = !box?.selection.shapeId.startsWith('penta-');
    byId('neighbor-field').hidden = neighborDetails.hidden;
    byId('box-neighbor-name').textContent = neighborDetails.hidden ? '' : neighbor ? 'Форма ' + neighbor.selection.shapeId.slice(-1).toUpperCase() + ' · общих позиций ' + overlap.size : 'С этой стороны нет полной формы.';
    byId<HTMLInputElement>('show-neighbor').disabled = !neighbor;
    return { width: container.getBoundingClientRect().width || 640, positions, structure, fretMin: state.fretMin, fretMax: state.fretMax, selectedId: state.selectedId, activeId: state.activeId, box, showFingers, showOctaves, showInterval, sharedIds: showNeighbor ? overlap : new Set<string>(), labelMode: state.labelMode };
  }

  function renderBoard() {
    const focusedId = document.activeElement instanceof Element && container.contains(document.activeElement) ? document.activeElement.closest<SVGGElement>('[data-position]')?.dataset.position : undefined;
    byId('board-range').textContent = rangeIsValid() ? 'Лады ' + state.fretMin + '–' + state.fretMax : 'Диапазон требует исправления';
    const fingers = byId<HTMLInputElement>('show-fingers');
    fingers.disabled = !state.box || !rangeIsValid() || positions.length === 0;
    byId('fingers-hint').hidden = !fingers.disabled;
    byId('fingers-hint').textContent = !state.box ? 'Для учебной формы' : 'После исправления области';
    if (!rangeIsValid()) {
      container.innerHTML = '<div class="study-range-empty"><h2>Проверь диапазон ладов</h2><p>Укажи целые границы от 0 до 24: первый лад не больше последнего.</p></div>';
      byId('octave-legend').innerHTML = '';
      byId('interval-legend').hidden = true;
      return;
    }
    const options = boardOptions();
    container.innerHTML = renderStudyFretboard(options);
    byId('octave-legend').innerHTML = renderOctaveLegend(options);
    byId('material-legend').textContent = state.box ? 'Ноты формы' : state.structureId.endsWith('triad') ? 'Звуки трезвучия' : 'Ноты гаммы';
    byId('interval-legend').hidden = !showInterval;
    sequencePlayer?.refreshHighlight();
    if (focusedId) focusPosition(focusedId);
  }

  function renderSelection(announce: boolean) {
    const technicalOpen = byId('connections').querySelector<HTMLDetailsElement>('.note-technical')?.open ?? false;
    const connectionsOpen = byId('connections').querySelector<HTMLDetailsElement>('.study-connections')?.open ?? false;
    const selected = rangeIsValid() ? positions.find(position => position.id === state.selectedId) : undefined;
    if (!rangeIsValid()) {
      byId('selection-detail').innerHTML = '<div class="selection-card selection-empty"><p>Выбор недоступен: исправь диапазон.</p></div>';
      byId('interval-detail').innerHTML = ''; byId('connections').innerHTML = '';
      if (announce) byId('selection-status').textContent = 'Неверный диапазон. Выбор недоступен.';
      return;
    }
    const options = { positions, selectedId: state.selectedId, structure, box: state.box ? getBoxInstance(state.box) : null };
    byId('selection-detail').innerHTML = renderStudySelection(options, technicalOpen);
    byId('interval-detail').innerHTML = renderStudyInterval(options);
    byId('connections').innerHTML = renderStudyConnections(options, connectionsOpen);
    // Technical data stays a disclosure below the primary musical information.
    const technical = byId('selection-detail').querySelector('.note-technical');
    if (technical) byId('connections').append(technical);
    root.querySelectorAll<HTMLElement>('[data-scale-note]').forEach(element => element.classList.toggle('is-current', Boolean(selected && element.dataset.scaleNote === selected.noteName)));
    if (announce) byId('selection-status').textContent = selected ? positionLabel(selected) : 'Нет доступных позиций. Выберите хотя бы одну струну.';
    fitStudyMore();
  }

  let studyMoreManual = false;
  byId('study-more').querySelector('summary')!.addEventListener('click', () => { studyMoreManual = true; });
  function fitStudyMore() {
    const more = byId<HTMLDetailsElement>('study-more');
    if (studyMoreManual || !visible || foundationMode !== 'study' || more.hidden) return;
    more.open = true;
    const workspace = root.querySelector<HTMLElement>('.workspace-main')!;
    const bottomSpace = parseFloat(getComputedStyle(workspace).paddingBottom) + options.getOuterBottomSpace() + 1;
    more.open = more.getBoundingClientRect().bottom + scrollY + bottomSpace <= innerHeight;
  }

  function focusPosition(id: string, scroll = false) {
    state.activeId = id;
    container.querySelectorAll<SVGGElement>('[data-position]').forEach(element => element.setAttribute('tabindex', element.dataset.position === id ? '0' : '-1'));
    const element = [...container.querySelectorAll<SVGGElement>('[data-position]')].find(item => item.dataset.position === id);
    element?.focus({ preventScroll: true });
    if (scroll) { if (element) options.reveal(element); }
  }

  function selectPosition(id: string, focus = true) {
    if (!rangeIsValid() || !positions.some(position => position.id === id)) return;
    state.selectedId = id;
    state.activeId = id;
    renderBoard();
    renderSelection(true);
    if (focus) focusPosition(id, true);
  }

  function applyBox(selection: BoxSelection | null) {
    state.box = selection;
    if (selection) { const box = getBoxInstance(selection); state.strings = STRING_ORDER.filter(string => box.positions.some(position => position.string === string));
      state.selectedId = (box.positions.find(position => position.isRoot) ?? box.positions[0]).id; state.activeId = state.selectedId;
    }
    byId('box-notice').textContent = selection ? 'Обычные задания и последовательность используют только точные позиции этой полной формы.' : 'Свободная область: позиции выбираются по струнам и ладам.';
  }
  function changeMaterial(change: () => void) {
    options.onBeforeMaterialChange(); sequencePlayer?.stop(); change(); updateView(true);
  }
  function moveBoxToMaterial(previous: BoxSelection | null, newStructure = false) {
    if (!previous) return;
    applyBox(nearestBoxSelection(previous, state.root, state.structureId, newStructure));
  }
  rootSelect.addEventListener('change', () => changeMaterial(() => { const previous = state.box; state.root = rootSelect.value; moveBoxToMaterial(previous); }));
  structureSelect.addEventListener('change', () => changeMaterial(() => { const previous = state.box; state.structureId = structureSelect.value as StructureId; moveBoxToMaterial(previous, true); }));
  byId<HTMLSelectElement>('box-select').addEventListener('change', event => changeMaterial(() => applyBox(boxes[Number((event.target as HTMLSelectElement).value)]?.selection && (event.target as HTMLSelectElement).value !== '' ? boxes[Number((event.target as HTMLSelectElement).value)].selection : null)));
  byId<HTMLInputElement>('show-fingers').addEventListener('change', event => { showFingers = (event.target as HTMLInputElement).checked; renderBoard(); savePreferences(); });
  byId<HTMLSelectElement>('box-neighbor').addEventListener('change', renderBoard);
  byId<HTMLInputElement>('show-neighbor').addEventListener('change', event => { showNeighbor = (event.target as HTMLInputElement).checked; renderBoard(); });
  byId<HTMLInputElement>('show-octaves').addEventListener('change', event => { showOctaves = (event.target as HTMLInputElement).checked; renderBoard(); });
  byId<HTMLInputElement>('show-interval').addEventListener('change', event => { showInterval = (event.target as HTMLInputElement).checked; renderBoard(); });
  function toggleSettings(open: boolean) { settingsOpen = open; root.classList.toggle('panel-closed', !open); byId('toggle-study-settings').setAttribute('aria-expanded', String(open)); if (!open) byId('toggle-study-settings').focus(); }
  byId('toggle-study-settings').addEventListener('click', () => toggleSettings(!settingsOpen));
  byId('close-study-settings').addEventListener('click', () => toggleSettings(false));
  byId('show-whole-form').addEventListener('click', () => {
    if (!state.box || !rangeIsValid()) return;
    const box = getBoxInstance(state.box);
    minInput.value = String(Math.min(state.fretMin, box.window.fretMin));
    maxInput.value = String(Math.max(state.fretMax, box.window.fretMax));
    applyRange();
  });
  byId('interval-detail').addEventListener('click', event => { const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-interval-target]')?.dataset.intervalTarget : null; if (target) selectPosition(target); });
  root.querySelectorAll<HTMLButtonElement>('[data-label-mode]').forEach(button => button.addEventListener('click', () => {
    state.labelMode = button.dataset.labelMode as LabelMode;
    syncLabelButtons(); renderBoard(); renderSelection(false); savePreferences();
  }));
  root.querySelectorAll<HTMLInputElement>('.string-switch input').forEach(input => input.addEventListener('change', () => {
    options.onBeforeMaterialChange(); applyBox(null); byId('box-notice').textContent = 'Струны изменены вручную: включён свободный диапазон. Прежняя форма не обрезается.';
    state.strings = [...root.querySelectorAll<HTMLInputElement>('.string-switch input:checked')].map(item => item.value as StringId);
    updateView(true);
  }));

  function rangeIsValid() { return rangeValid; }

  function setRangeValidity(valid: boolean) {
    rangeValid = valid;
    byId('range-error').hidden = valid;
    minInput.setAttribute('aria-invalid', String(!valid));
    maxInput.setAttribute('aria-invalid', String(!valid));
  }

  function applyRange() {
    const min = minInput.valueAsNumber;
    const max = maxInput.valueAsNumber;
    const valid = Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max <= 24 && min <= max;
    const previouslyValid = rangeValid;
    if ((previouslyValid && !valid) || (valid && !state.box)) options.onBeforeMaterialChange();
    setRangeValidity(valid);
    if (!valid) {
      sequencePlayer?.stop();
      byId<HTMLDetailsElement>('area-settings').open = true;
      byId('range-error').textContent = 'Укажи целые лады от 0 до 24: первый не больше последнего.';
      positions = [];
      exerciseMaterial = studyExerciseMaterial(structure, positions, null);
      renderBoard(); renderSelection(true);
      training?.refreshContext();
      sequencePlayer?.refreshContext();
      options.onContextChange();
      return;
    }
    state.fretMin = min;
    state.fretMax = max;
    updateView(true, !state.box || !previouslyValid);
  }
  minInput.addEventListener('input', applyRange);
  maxInput.addEventListener('input', applyRange);
  root.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(button => button.addEventListener('click', () => {
    const [min, max] = button.dataset.range!.split(',');
    minInput.value = min!;
    maxInput.value = max!;
    applyRange();
  }));
  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<SVGGElement>('[data-position]') : null;
    if (target?.dataset.position) selectPosition(target.dataset.position);
  });
  container.addEventListener('keydown', event => {
    const target = event.target instanceof Element ? event.target.closest<SVGGElement>('[data-position]') : null;
    const current = positions.find(position => position.id === target?.dataset.position);
    if (!current) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectPosition(current.id);
      return;
    }
    const rows = STRING_ORDER.filter(string => state.strings.includes(string));
    let nextString = current.string;
    let nextFret = current.fret;
    switch (event.key) {
      case 'ArrowLeft': nextFret = Math.max(state.fretMin, current.fret - 1); break;
      case 'ArrowRight': nextFret = Math.min(state.fretMax, current.fret + 1); break;
      case 'ArrowUp': nextString = rows[Math.max(0, rows.indexOf(current.string) - 1)]!; break;
      case 'ArrowDown': nextString = rows[Math.min(rows.length - 1, rows.indexOf(current.string) + 1)]!; break;
      case 'Home': nextFret = state.fretMin; break;
      case 'End': nextFret = state.fretMax; break;
      default: return;
    }
    event.preventDefault();
    focusPosition(`${nextString}:${nextFret}`, true);
  });
  byId('connections').addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-connect]') : null;
    if (button?.dataset.connect) selectPosition(button.dataset.connect);
  });

  let lastBoardWidth = 0;
  const boardResizeObserver = new ResizeObserver(entries => { const width = Math.floor(entries[0]?.contentRect.width ?? 0); if (width > 0 && width !== lastBoardWidth) { lastBoardWidth = width; renderBoard(); } });
  boardResizeObserver.observe(container);

  updateView();
  training = mountTraining(byId('training-mount'), () => ({ positions: exerciseMaterial.exact, fullPositions: exerciseMaterial.interval, box: state.box, structure }), {
    navigationContainer: byId('mode-nav-mount'),
    onRouteExit: options.onRouteExit,
    onPreferencesChange: savePreferences,
    onSessionFinished: options.onSessionFinished,
    onSessionChanged: options.onSessionChanged,
    onModeChange(mode) {
      options.onBeforeModeChange();
      foundationMode = mode;
      if (mode !== 'sequence') sequencePlayer?.stop();
      updateModuleVisibility();
      if (mode === 'sequence') sequencePlayer?.refreshContext();
      options.onContextChange();
    },
    onSequenceChange() { options.capturePractice(); sequencePlayer?.refreshContext(); sequencePlayer?.refreshHighlight(); void notation?.refreshContext(); options.onContextChange(); },
  });
  let lastPlaybackState = 'stopped';
  sequencePlayer = mountPlayer(byId('player-mount'), () => training?.getCurrentSequence()?.notes ?? [], {
    onBeforeStart: options.onBeforeStart,
    onPreferencesChange() {
      options.capturePractice();
      const session = options.getRouteSession();
      if (training?.getRouteRef() && session?.material && session.status !== 'finished') {
        const current = currentPlayerPreferences(); const original = session.material.player;
        const musicalKeys = ['bpm', 'duration', 'repeat', 'countIn', 'from', 'to', 'ladderStart', 'ladderEnd', 'ladderStep', 'ladderRepeats', 'metronome', 'metronomeMode', 'subdivision'] as const;
        if (musicalKeys.some(key => current[key] !== original[key])) options.onRouteExit();
      }
      savePreferences(); void notation?.refreshContext(); options.onContextChange();
    },
    onSnapshot(snapshot) {
      notation?.setPlaybackState(snapshot);
      if (snapshot.state !== lastPlaybackState) { lastPlaybackState = snapshot.state; if (['paused', 'stopped', 'finished'].includes(snapshot.state)) options.onPlaybackStopped(); }
    },
    getContextKey: () => training?.getSequenceContextKey() ?? '',
    onPositionChange(id, noteIndex) {
      notation?.setActiveIndex(noteIndex);
      container.querySelectorAll<SVGGElement>('[data-position]').forEach(element => element.classList.toggle('is-playing', id !== null && element.dataset.position === id));
      root.querySelectorAll<HTMLElement>('[data-sequence-index]').forEach(element => {
        const current = id !== null && Number(element.dataset.sequenceIndex) === noteIndex;
        element.classList.toggle('is-playing', current);
        if (current) element.setAttribute('aria-current', 'step');
        else element.removeAttribute('aria-current');
      });
    },
  });
  notation = mountNotation(byId('notation-mount'), () => { const preferences = sequencePlayer?.getPreferences(); return { positions: training?.getCurrentSequence()?.notes ?? [], duration: sequencePlayer?.getDuration() ?? 'eighth', fragment: { from: preferences?.from ?? 1, to: preferences?.to ?? training?.getCurrentSequence()?.notes.length ?? 1 } }; }, {
    onSelect: (_index, positionId, action) => {
      if (action === 'show-position' && rangeIsValid() && !positions.some(position => position.id === positionId)) {
        const note = training?.getCurrentSequence()?.notes.find(position => position.id === positionId);
        if (note) { state.fretMin = Math.min(state.fretMin, note.fret); state.fretMax = Math.max(state.fretMax, note.fret); minInput.value = String(state.fretMin); maxInput.value = String(state.fretMax); updateView(false, !state.box); }
      }
      selectPosition(positionId, false);
      if (action === 'show-position' && positions.some(position => position.id === positionId)) { sequenceView = 'board'; updateModuleVisibility(); byId('return-to-notation').hidden = false; focusPosition(positionId, true); }
    },
  });
  root.querySelectorAll<HTMLElement>('[data-sequence-view]').forEach(button => button.addEventListener('click', () => { sequenceView = button.dataset.sequenceView as 'board' | 'notation'; updateModuleVisibility(); }));
  byId('return-to-notation').addEventListener('click', () => { sequenceView = 'notation'; updateModuleVisibility(); void notation?.refreshContext().then(() => byId('notation-mount').querySelector<SVGElement>('[data-notation-index][tabindex="0"]')?.focus()); });
  notation.setVisible(false);
  return {
    setVisible(next: boolean) { visible = next; root.hidden = !next; updateModuleVisibility(); if (next) fitStudyMore(); },
    get mode() { return foundationMode; },
    rangeIsValid, getPreferences: readPreferences, practiceBinding, selectPosition,
    stop() { sequencePlayer?.stop(); },
    finishSession(reason?: string) { training?.finishCurrentSession(reason); },
    clearRouteContext() { training?.clearRouteContext(); },
    applyPreferences(value: Pick<AppPreferences, 'study' | 'training' | 'player'>) {
      applyStudy(value.study); training?.applyPreferences(value.training); sequencePlayer?.refreshContext(); sequencePlayer?.applyPreferences(value.player);
    },
    introduction() {
      const box = getBoxInstance(createRouteMaterial().box!);
      applyStudy({ ...readPreferences().study, root: 'C', structureId: 'major-triad', strings: STRING_ORDER.filter(string => box.positions.some(position => position.string === string)), fretMin: Math.min(state.fretMin, box.window.fretMin), fretMax: Math.max(state.fretMax, box.window.fretMax), box: box.selection });
      training?.applyPreferences({ ...readPreferences().training, mode: 'study', reviewPositionIds: [], questionPolicy: 'random-v1' });
    },
    repeatErrors(ids: readonly string[], context: QuestionContext) {
      const frets = ids.map(id => Number(id.split(':')[1]));
      applyStudy({ ...readPreferences().study, root: context.root.replaceAll('♭', 'b').replaceAll('♯', '#'), structureId: context.structureId, strings: STRING_ORDER.filter(string => ids.some(id => id.startsWith(`${string}:`))), fretMin: Math.min(...frets), fretMax: Math.max(...frets), box: null });
      training?.setReviewPositions(ids, context);
      byId('training-mount').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    getFreeMaterial() {
      if (!rangeIsValid()) throw new Error('Сначала исправь диапазон грифа.');
      return createFreeRouteMaterial({ box: state.box, root: state.root, structureId: state.structureId, referencePositionIds: positions.map(position => position.id), pattern: training!.getPreferences().pattern, scope: training!.getSequenceScope(), player: currentPlayerPreferences() });
    },
    applyRouteMaterial,
    openRouteStep(step: 'fretboard' | 'sequence', session: RouteSession | null, material: RouteMaterial | null, initial: boolean) {
      if (!session || !material) { training?.setMode(step === 'fretboard' ? 'quiz' : 'sequence'); return; }
      training?.applyRouteContext(material, { routeId: session.id, step }, initial);
      if (step === 'sequence' && initial) sequencePlayer?.applyPreferences(material.player);
    },
    routeFocus(step: 'fretboard' | 'sequence') {
      return step === 'fretboard' ? root.querySelector<HTMLElement>('[data-testid="quiz-prompt"]') ?? byId('training-mount').querySelector<HTMLElement>('h2') : byId('player-mount').querySelector<HTMLElement>('h2');
    },
    getPracticeFallback() {
      return { context: { root: structure.root, structureId: structure.id, scope: 'structure' as const, positionIds: rangeIsValid() ? exerciseMaterial.exact.map(position => position.id) : [], box: state.box },
        // Без запущенного эталона отметка относится к изучению грифа: этот материал и сохраняется.
        material: { kind: 'fretboard' as const, box: state.box },
        durationMs: 0, comfortableBpm: currentPlayerPreferences().bpm, note: '', label: 'Изучение грифа', available: visible && foundationMode !== 'quiz' };
    },
    dispose() {
      boardResizeObserver.disconnect();
      for (const picker of selectPickers) picker.dispose();
      sequencePlayer?.dispose(); training?.dispose(); notation?.dispose();
      host.replaceChildren();
    },
  };
}
