import './styles.css';
import './ui/fretboard.css';
import { renderStudyFretboard, renderOctaveLegend, type StudyFretboardOptions } from './ui/fretboard';
import { enhanceSelect } from './ui/select-picker';
import { renderStudySelection, renderStudyInterval, renderStudyConnections } from './ui/study-details';
import { mountTraining } from './ui/training';
import { mountPlayer } from './ui/player';
import { mountHistory } from './ui/history';
import { mountEar } from './ui/ear';
import { mountRhythm, type RhythmLibrary, type RhythmLibraryOperation } from './ui/rhythm';
import { DEFAULT_RHYTHM_PREFERENCES } from './rhythm/model';
import type { RhythmPracticeClock } from './audio/rhythm';
import { mountNotation } from './ui/notation';
import { mountTracks } from './ui/tracks';
import { mountMusicBank } from './ui/music-bank';
import { mountInput } from './ui/input';
import { mountRoute, type RouteStep } from './ui/route';
import type { EarSession } from './ear';
import type { RouteResult } from './route';
import { createWriteQueue } from './app/write-queue';
import { createThemeController } from './app/theme';
import { createPracticeDrafts, type PracticeBinding } from './app/practice-drafts';
import { readLegacyRhythmVelocityDefaults } from './app/rhythm-legacy-defaults';
import { mountIntroduction } from './ui/introduction';
import { getBoxCatalogue, getBoxInstance, type BoxSelection, type BoxInstance } from './music/boxes';
import { createRouteMaterial, createFreeRouteMaterial, type RouteSession } from './route';
import { acquireWriterLease } from './app/writer-lock';
import type { QuizSession } from './training';
import { createStudyStore, createMemoryStudyStore, DEFAULT_PREFERENCES, DEFAULT_PROFILE, makeScreenHistory, makeEarHistory, makeRouteHistory, validatePreferences, type AppPreferences, type HistoryMetadata, type GlobalProfile, type PracticeDraft, type StudySnapshot } from './storage';
import { rhythmPracticeLabel, type PracticeMaterial, type RhythmPracticeMaterial } from './training/results';
import {
  STRUCTURES,
  annotatePositions,
  createStructure,
  formatMidi,
  getPositions,
  type LabelMode,
  type StringId,
  type StructureId,
} from './music';

type AnnotatedPosition = ReturnType<typeof annotatePositions>[number];
const STRING_ORDER: StringId[] = ['G', 'D', 'A', 'E'];
const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ROOT_LABELS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
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
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения #app.');

app.innerHTML = `
  <div class="app-shell">
    <header class="site-header">
      <a class="brand" href="#" aria-label="bass.study — к началу страницы"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>bass<span class="brand-dot">.</span>study</a>
      <nav class="module-navigation" aria-label="Раздел тренажёра"><button type="button" data-app-module="foundation" aria-pressed="true" aria-current="page" disabled>Гриф и практика</button><button type="button" data-app-module="ear" aria-pressed="false" disabled>Слух</button><button type="button" data-app-module="harmony" aria-pressed="false" disabled>Метроном и ритм</button><button type="button" data-app-module="tracks" aria-pressed="false" disabled>Табулатура и ноты</button><button type="button" data-app-module="input" aria-pressed="false" disabled>Аудиовход</button><button type="button" data-app-module="route" aria-pressed="false" disabled>Маршрут занятия</button></nav>
      <div class="nav-secondary">
        <button type="button" id="open-history" class="text-button" aria-expanded="false" disabled>Мои занятия</button>
        <button type="button" id="open-introduction" class="text-button" disabled>Введение</button>
      </div>
      <div class="sidebar-art" aria-hidden="true"><img src="${import.meta.env.BASE_URL}images/bass-headstock.webp" alt="" width="568" height="1788" draggable="false"></div>
      <div class="nav-bottom">
        <div class="theme-control"><span>Тема</span><div class="segmented" role="group" aria-label="Тема оформления"><button type="button" data-theme-choice="light" aria-pressed="false" disabled>Светлая</button><button type="button" data-theme-choice="dark" aria-pressed="false" disabled>Тёмная</button></div></div>
        <span class="local-badge"><span aria-hidden="true"></span><span id="local-save-status" role="status">Локальный тренажёр</span><button type="button" id="open-storage-details" class="text-button" aria-controls="persistence-banner" aria-expanded="false" hidden>Без сохранения · подробнее</button></span>
      </div>
    </header>

    <div class="app-content">
    <div id="persistence-banner" class="persistence-banner" role="status"><span id="persistence-message">Читаем локальные настройки…</span><button type="button" id="retry-save" hidden>Повторить сохранение</button><button type="button" id="retry-tab" hidden>Проверить снова</button></div>
    <main inert aria-busy="true">
      <section class="intro" aria-labelledby="page-title">
        <div><h1 id="page-title">Гриф и практика</h1></div>
        <div class="intro-copy"><p>Найди ноты и ступени в выбранной области грифа E–A–D–G.</p></div>
      </section>
      <section id="onboarding-mount" aria-label="Введение" hidden></section>

      <div id="route-session-mount"></div>
      <section id="ear-mount" aria-label="Слуховые задания" hidden></section>
      <section id="harmony-mount" aria-label="Метроном и ритм" hidden></section>
      <section id="tracks-mount" aria-label="Табулатура и ноты" hidden><div class="bank-view-tabs" role="tablist" aria-label="Материал раздела «Табулатура и ноты»"><button id="bank-scores-tab" type="button" role="tab" data-bank-view="scores" aria-selected="true" aria-controls="music-bank-mount">Партитуры</button><button id="bank-audio-tab" type="button" role="tab" data-bank-view="audio" aria-selected="false" aria-controls="legacy-tracks-mount">Аудиозаписи</button></div><div id="music-bank-mount" role="tabpanel" aria-labelledby="bank-scores-tab"></div><div id="legacy-tracks-mount" role="tabpanel" aria-labelledby="bank-audio-tab" hidden></div></section>
      <section id="input-mount" aria-label="Диагностический аудиовход" hidden></section>
      <section id="route-mount" aria-label="Маршрут занятия" hidden></section>
      <section class="workspace${initialSettingsOpen ? '' : ' panel-closed'}" aria-label="Изучение грифа">
        <div class="workspace-main">
          <div class="study-heading"><div><h1 id="structure-heading"></h1><p id="study-context" class="study-context"></p></div><button type="button" id="toggle-study-settings" class="secondary-button" aria-controls="study-settings" aria-expanded="${initialSettingsOpen}">Параметры</button></div>
          <div id="mode-nav-mount"></div>
          <div class="board-toolbar"><span id="board-range" class="board-caption"></span><span id="position-count" class="sr-only"></span><fieldset class="label-field"><legend class="sr-only">Подписи на грифе</legend><div class="segmented" aria-label="Подписи на грифе"><button type="button" data-label-mode="notes" aria-pressed="true">Ноты</button><button type="button" data-label-mode="degrees" aria-pressed="false">Ступени</button><button type="button" data-label-mode="hidden" aria-pressed="false">Без подписей</button></div></fieldset></div>
          <div id="training-mount"></div>
          <div id="player-mount" hidden></div>
          <div id="sequence-view-controls" class="segmented" aria-label="Представление последовательности" hidden><button type="button" data-sequence-view="board" aria-pressed="true">Гриф</button><button type="button" data-sequence-view="notation" aria-pressed="false">Ноты и TAB</button><button type="button" id="return-to-notation" hidden>Вернуться к выбранной ноте в записи</button></div>
          <section id="notation-mount" aria-label="Нотная запись и табулатура последовательности" hidden></section>
          <div class="fretboard-section">
            <div class="board-scroll" id="board-scroll"><div id="fretboard-container"></div></div>
            <div class="board-footer"><div class="legend"><span><i class="legend-root" aria-hidden="true"></i>Тоника</span><span><i class="legend-note" aria-hidden="true"></i><span id="material-legend">Ноты формы</span></span><span id="interval-legend"><i class="legend-interval" aria-hidden="true"></i>Интервал</span></div></div>
            <div id="octave-legend"></div>
          </div>
          <section class="selection-section" aria-label="Выбранная нота и её связи"><div id="selection-detail" data-testid="selection-detail"></div><div id="interval-detail"></div></section>
          <details id="study-more" class="learning-help study-more"><summary>Состав, позиции и помощь</summary>
          <div class="structure-summary"><div id="structure-notes" class="note-pills" data-testid="structure-notes" aria-label="Ноты выбранной структуры"></div><div class="formula"><span class="sr-only">Формула</span><strong id="structure-formula" data-testid="structure-formula"></strong></div></div>
          <div id="connections" class="connections"></div>
          <p class="board-navigation">Стрелки — перемещение фокуса · Enter / пробел — выбрать · Home / End — края диапазона</p>
          </details>
        </div>
        <aside class="settings-panel" id="study-settings" aria-label="Параметры изучения">
          <div class="section-title"><h2>Что изучаем</h2><button type="button" id="close-study-settings" class="text-button">Свернуть</button></div>
          <div class="musical-controls">
            <label class="field root-field" for="root-note"><span>Тоника</span><select id="root-note" aria-label="Тоника">${ROOTS.map((root, i) => `<option value="${root}"${root === state.root ? ' selected' : ''}>${ROOT_LABELS[i]}</option>`).join('')}</select></label>
            <label class="field structure-field" for="structure"><span>Структура</span><select id="structure" aria-label="Структура">${STRUCTURES.map(item => `<option value="${item.id}"${item.id === state.structureId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
          </div>
          <div id="box-controls"><label class="field"><span>Учебная форма</span><select id="box-select" aria-label="Учебная форма"></select></label><details id="display-settings" class="display-controls"><summary>Отображение</summary><label class="switch-row"><span>Номера пальцев<small id="fingers-hint" hidden>Для учебной формы</small></span><input class="control-switch" type="checkbox" role="switch" id="show-fingers"></label><label class="switch-row"><span>Октавные участки</span><input class="control-switch" type="checkbox" role="switch" id="show-octaves" checked></label><label class="switch-row"><span>Интервал от тоники</span><input class="control-switch" type="checkbox" role="switch" id="show-interval" checked></label><p class="settings-hint">Линия соединяет тонику и выбранную ноту.</p></details><label class="field" id="neighbor-field" hidden><span>Направление</span><select id="box-neighbor" aria-label="Соседняя форма"><option value="next">Следующая</option><option value="previous">Предыдущая</option></select></label><p id="box-neighbor-name"></p><label id="neighbor-switch-row" class="switch-row"><span>Показать пересечение</span><input class="control-switch" type="checkbox" role="switch" id="show-neighbor"></label><p id="box-notice" role="status"></p><button type="button" id="show-whole-form" class="text-button" hidden>Показать форму целиком ↗</button></div>
          <details id="area-settings"><summary>Область грифа</summary>
          <div class="scope-controls">
            <fieldset class="range-field"><legend>Лады <span class="range-hint">включая границы</span></legend><div class="range-inputs"><label><span class="sr-only">Первый лад</span><input id="fret-min" aria-label="Первый лад" type="number" min="0" max="24" step="1" value="0"></label><span class="range-dash" aria-hidden="true">—</span><label><span class="sr-only">Последний лад</span><input id="fret-max" aria-label="Последний лад" type="number" min="0" max="24" step="1" value="12"></label></div></fieldset>
            <div class="range-presets" aria-label="Быстрый диапазон"><button type="button" data-range="0,5">0–5</button><button type="button" data-range="0,12" aria-pressed="true">0–12</button><button type="button" data-range="12,24">12–24</button></div>
            <fieldset class="string-field"><legend>Ноты на струнах</legend><div class="string-switches">${STRING_ORDER.map(string => `<label class="string-switch"><input type="checkbox" value="${string}" aria-label="Струна ${string}" checked><span>${string}</span></label>`).join('')}</div></fieldset>
            <p class="range-description">Выключенная струна остаётся пустой. Ручной выбор струн включает свободную область. Лад 0 — открытая струна.</p>
          </div>
          </details>
          <p id="range-error" class="range-error" data-testid="range-error" role="alert" hidden></p>
          <details class="learning-help"><summary>Ступени, пальцы и формы</summary><p id="box-material-caption" class="settings-hint"></p><p>Ступень — место звука относительно тоники: 1 — тоника, 3 — терция, 5 — квинта. ♭ понижает ступень на полутон. Квадрат — рекомендуемый палец, круг — нота или ступень.</p><p>Нота с цифрой обозначает звучащую октаву: C2 и C3 — разные высоты. В басовой записи нота написана на октаву выше звучания. Трезвучие содержит три разных звука; повтор тоники не добавляет четвёртый класс ноты.</p><p>Формы — учебный каталог bass.study, а не универсальная нумерация или единственная аппликатура. Материал выбранной формы сохраняется целиком; область показа не ограничивает задания формы.</p></details>
        </aside>
      </section>

      <section id="history-mount" aria-label="История и настройки" hidden></section>
      <p id="selection-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
    </main>
    </div>
  </div>
`;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const neighborDetails = document.createElement('details'); neighborDetails.id = 'box-neighbor-details'; neighborDetails.className = 'learning-help';
const neighborSummary = document.createElement('summary'); neighborSummary.textContent = 'Соседняя форма';
const neighborField = byId('neighbor-field'); neighborField.before(neighborDetails); neighborDetails.append(neighborSummary, neighborField, byId('box-neighbor-name'), byId('neighbor-switch-row'));
const rootSelect = byId<HTMLSelectElement>('root-note');
const structureSelect = byId<HTMLSelectElement>('structure');
const minInput = byId<HTMLInputElement>('fret-min');
const maxInput = byId<HTMLInputElement>('fret-max');
const container = byId('fretboard-container');
const selectPickers = [enhanceSelect(rootSelect, { gridColumns: 4 }), enhanceSelect(structureSelect), enhanceSelect(byId<HTMLSelectElement>('box-select')), enhanceSelect(byId<HTMLSelectElement>('box-neighbor'))];
let positions: readonly AnnotatedPosition[] = [];
let structure = createStructure(state.root, state.structureId);
let training: ReturnType<typeof mountTraining> | undefined;
let sequencePlayer: ReturnType<typeof mountPlayer> | undefined;
let history: ReturnType<typeof mountHistory> | undefined;
let ear: ReturnType<typeof mountEar> | undefined;
let rhythm: ReturnType<typeof mountRhythm> | undefined;
let notation: ReturnType<typeof mountNotation> | undefined;
let tracks: ReturnType<typeof mountTracks> | undefined;
let musicBank: ReturnType<typeof mountMusicBank> | undefined;
let bankView: 'scores' | 'audio' = 'scores';
let inputMonitor: ReturnType<typeof mountInput> | undefined;
let route: ReturnType<typeof mountRoute> | undefined;
let introduction: ReturnType<typeof mountIntroduction> | undefined;
let sequenceView: 'board' | 'notation' = 'board';
let profile: GlobalProfile = DEFAULT_PROFILE;
let showFingers = false;
let showOctaves = true;
let showInterval = true;
let showNeighbor = false;
let settingsOpen = initialSettingsOpen;
let boxes: readonly BoxInstance[] = [];
let bindingKey = '';
let activeModule: AppPreferences['activeModule'] = 'foundation';
let foundationMode: 'study' | 'quiz' | 'sequence' = 'study';
let routeNavigation = false;
let lastValidPreferences = DEFAULT_PREFERENCES;
let store: ReturnType<typeof createStudyStore> | ReturnType<typeof createMemoryStudyStore> = createStudyStore(readLegacyRhythmVelocityDefaults);
let persistent = true;
let applyingPreferences = true;
let retiring = false;
let retirement: Promise<void> | undefined;
let writerLease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
const sessionMetadata = new WeakMap<object, HistoryMetadata>();
const routeMetadata = new Map<string, HistoryMetadata>();
const deletedHistoryIds = new Set<string>();
const liveSessionFinishes = new Map<string, () => void>();
let currentScreenHistoryId: string | null = null;
let currentEarHistoryId: string | null = null;
let startupIssue = '';
let preferenceIssue = '';
let writeState: { pending: number; failures: readonly string[] } = { pending: 0, failures: [] };
let getDraftPending = () => false;
let draftStatusDirty = false;
const main = document.querySelector<HTMLElement>('main')!;
function showPersistenceStatus() {
  const { pending, failures } = writeState;
  const dirty = getDraftPending(); draftStatusDirty = dirty;
  const message = failures.length ? `Не сохранено операций: ${failures.length}. ${failures[0]} Экспорт содержит только подтверждённые записи.` : preferenceIssue || (pending ? 'Сохранение…' : dirty ? 'Черновик ожидает автосохранения…' : persistent ? 'Сохранено локально в этом браузере' : `Только в памяти страницы. Экспортируй копию перед закрытием. ${startupIssue}`);
  const error = failures.length > 0 || preferenceIssue !== '';
  const memoryDetails = byId('open-storage-details');
  memoryDetails.hidden = persistent;
  byId('local-save-status').hidden = !persistent && !error;
  byId('persistence-message').textContent = message;
  byId('persistence-banner').classList.toggle('has-error', error);
  byId('persistence-banner').hidden = !error && (persistent || memoryDetails.getAttribute('aria-expanded') !== 'true');
  byId('local-save-status').textContent = error ? 'Ошибка сохранения' : pending ? 'Сохранение…' : dirty ? 'Черновик занятия' : persistent ? 'Локально · сохранено' : 'Только в памяти';
  byId('retry-save').hidden = failures.length === 0;
  history?.setSaveStatus(message, error ? 'error' : pending || dirty ? 'saving' : persistent ? 'saved' : 'memory');
}
const writes = createWriteQueue(value => { writeState = value; showPersistenceStatus(); });
byId('open-storage-details').addEventListener('click', () => { const button = byId('open-storage-details'); button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true')); showPersistenceStatus(); });
const theme = createThemeController({ onChange(value) { setProfile({ ...profile, theme: value }); } });
function setProfile(value: GlobalProfile) {
  if (retiring || !writerLease?.acquired || main.inert || applyingPreferences) return;
  profile = structuredClone(value);
  const confirmed = structuredClone(value);
  void writes.run(async () => { await store.saveProfile(confirmed); if (persistent) theme.confirmPreference(confirmed.theme); }, 'profile').catch(() => {});
}
function enableHeader(enabled: boolean) { document.querySelectorAll<HTMLButtonElement>('.site-header button').forEach(button => { button.disabled = !enabled; }); }
document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(button => button.addEventListener('click', () => { const value = button.dataset.themeChoice; if (value === 'light' || value === 'dark') theme.setPreference(value); }));
const drafts = createPracticeDrafts({ getStore: () => store, write: (operation, key) => writes.run(operation, key), supersede: key => writes.supersede(key), resolveSuperseded: key => writes.resolveSuperseded(key),
  onCommit() { history?.updatePracticeContext(); showPersistenceStatus(); }, onEntry(entry) { history?.commitEntry(entry); if (entry.routeRef) route?.linkSession(entry.id, 'manual', entry.routeRef.step, entry.routeRef.routeId); },
  onChange() { history?.updatePracticeContext(); showPersistenceStatus(); },
});
getDraftPending = () => drafts.hasPendingChanges();
function rhythmPracticeBinding(practice: RhythmPracticeClock, readClock: PracticeBinding['readClock'] = () => practice): PracticeBinding {
  const material: RhythmPracticeMaterial = { kind: 'rhythm', playback: practice.playback };
  return { context: null, material, routeRef: null, label: rhythmPracticeLabel(material), readClock };
}
function syncPracticeBinding() {
  if (applyingPreferences) return;
  let next: PracticeBinding | null = null;
  let runtimeKey: string | undefined;
  const box = state.box ? getBoxInstance(state.box) : null;
  if (activeModule === 'harmony') {
    const practice = rhythm?.getPractice();
    if (practice) {
      runtimeKey = practice.runtimeContextKey;
      next = rhythmPracticeBinding(practice, () => {
        const live = rhythm?.getPractice();
        return live?.runtimeContextKey === practice.runtimeContextKey ? live : practice;
      });
    }
  } else if (activeModule === 'foundation' && rangeIsValid() && foundationMode !== 'quiz') {
    const sequence = training?.getCurrentSequence();
    const player = currentPlayerPreferences();
    const material: PracticeMaterial = foundationMode === 'sequence' && sequence ? { kind: 'sequence', pattern: training?.getPreferences().pattern ?? 'ascending', routePositionIds: sequence.notes.map(position => position.id), duration: player.duration,
      fragment: { from: (player.from ?? 1) - 1, toExclusive: player.to ?? sequence.notes.length }, box: state.box } : { kind: 'fretboard', box: state.box };
    next = { context: { root: structure.root, structureId: structure.id, scope: foundationMode === 'sequence' ? training?.getSequenceScope() ?? 'structure' : 'structure', positionIds: (box?.positions ?? positions).map(position => position.id), box: state.box }, material,
      routeRef: route?.getSession()?.status !== 'finished' ? training?.getRouteRef() ?? null : null, label: foundationMode === 'sequence' ? 'Последовательность на грифе' : 'Изучение грифа',
      readClock: foundationMode === 'sequence' ? () => sequencePlayer?.getPracticeDraft() ?? { durationMs: 0, comfortableBpm: 80 } : () => ({ durationMs: 0, comfortableBpm: player.bpm }) };
  }
  const key = runtimeKey ?? (next ? JSON.stringify({ context: next.context, material: next.material, routeRef: next.routeRef }) : '');
  if (key !== bindingKey) { drafts.bind(next); bindingKey = key; void drafts.flush().catch(() => {}); }
}
function currentPlayerPreferences() { try { return sequencePlayer?.getPreferences() ?? DEFAULT_PREFERENCES.player; } catch { return lastValidPreferences.player; } }
function draftView(value: PracticeDraft | null) {
  if (!value && activeModule === 'harmony') return { context: null, durationMs: 0, comfortableBpm: rhythm?.getPreferences().metronome.bpm ?? 92, note: '', label: 'Метроном и ритм', available: false };
  return value ? { id: value.id, createdAt: value.createdAt, timeZone: value.timeZone, context: value.context, material: value.material, routeRef: value.routeRef, durationMs: value.totalReferenceMs - value.recordedThroughMs, comfortableBpm: value.comfortableBpm, note: value.note,
    label: value.material.kind === 'rhythm' ? rhythmPracticeLabel(value.material) : value.material.kind === 'harmony' ? 'Аккомпанемент C–F–G–C · основной тон–3–5–3' : value.material.kind === 'sequence' ? 'Последовательность на грифе' : 'Изучение грифа', available: true }
    : { context: { root: structure.root, structureId: structure.id, scope: 'structure' as const, positionIds: rangeIsValid() ? (state.box ? getBoxInstance(state.box).positions : positions).map(position => position.id) : [], box: state.box }, durationMs: 0, comfortableBpm: currentPlayerPreferences().bpm, note: '', label: foundationMode === 'study' ? 'Изучение грифа' : 'Последовательность на грифе', available: activeModule === 'foundation' && foundationMode !== 'quiz' };
}
async function flushAll() { await drafts.flush(); await writes.flush(); }
function leaveRoute() { drafts.capture(); route?.stop(); training?.clearRouteContext(); ear?.clearRouteContext(); syncPracticeBinding(); }

function rhythmLibrary(snapshot: StudySnapshot): RhythmLibrary {
  return { projects: snapshot.rhythmProjects, activeId: snapshot.activeRhythmProjectId };
}

async function changeRhythmLibrary(operation: RhythmLibraryOperation): Promise<RhythmLibrary> {
  if (retiring || main.inert || !writerLease?.acquired) throw new Error('Эта вкладка не может сохранить проект ритма.');
  const key = 'rhythm-library';
  const generation = writes.supersede(key);
  const command = structuredClone(operation);
  return writes.run(async () => {
    if (command.kind === 'save') await store.saveRhythmProject(command.project);
    else if (command.kind === 'select') await store.selectRhythmProject(command.id);
    else await store.deleteRhythmProject(command.id);
    const snapshot = await store.readSnapshot();
    if (!retiring) void history?.refresh();
    return rhythmLibrary(snapshot);
  }, key, generation);
}

function getPreferences(): AppPreferences {
  const value = validatePreferences({
    activeModule,
    ear: activeModule === 'ear' ? ear?.getPreferences() ?? DEFAULT_PREFERENCES.ear : lastValidPreferences.ear,
    harmony: lastValidPreferences.harmony,
    rhythm: rhythm?.getPreferences() ?? lastValidPreferences.rhythm,
    tracks: activeModule === 'tracks' ? tracks?.getPreferences() ?? null : lastValidPreferences.tracks,
    musicBank: activeModule === 'tracks' ? musicBank?.getPreferences() ?? null : lastValidPreferences.musicBank,
    input: activeModule === 'input' ? inputMonitor?.getPreferences() ?? DEFAULT_PREFERENCES.input : lastValidPreferences.input,
    study: { root: state.root, structureId: state.structureId, labelMode: state.labelMode, strings: state.strings, fretMin: state.fretMin, fretMax: state.fretMax, box: state.box, showFingers },
    training: activeModule === 'foundation' ? training?.getPreferences() ?? DEFAULT_PREFERENCES.training : lastValidPreferences.training,
    player: activeModule === 'foundation' ? sequencePlayer?.getPreferences() ?? DEFAULT_PREFERENCES.player : lastValidPreferences.player,
  });
  lastValidPreferences = value;
  return value;
}

function savePreferences() {
  if (retiring || applyingPreferences || !training || !sequencePlayer || (activeModule === 'foundation' && !rangeIsValid())) return;
  try {
    const preferences = getPreferences();
    preferenceIssue = '';
    void writes.run(() => store.savePreferences(preferences), 'preferences').catch(() => {});
  } catch (failure) {
    // An unfinished input is not a valid preference and must not overwrite the last valid one.
    preferenceIssue = `Настройки ещё не сохранены: ${failure instanceof Error ? failure.message : String(failure)}`;
    showPersistenceStatus();
  }
}

function persistSession(session: QuizSession) {
  if (retiring) return;
  try {
    let metadata = sessionMetadata.get(session.questions);
    if (!metadata) { metadata = { id: `screen-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }; sessionMetadata.set(session.questions, metadata); }
    const entry = makeScreenHistory(session, metadata);
    if (deletedHistoryIds.has(metadata.id)) return;
    if (currentScreenHistoryId && currentScreenHistoryId !== metadata.id) liveSessionFinishes.delete(currentScreenHistoryId);
    currentScreenHistoryId = metadata.id;
    const historyId = metadata.id;
    liveSessionFinishes.set(historyId, () => { if (currentScreenHistoryId === historyId) training?.finishCurrentSession('Активный результат удаляется'); });
    if (entry) void writes.run(() => store.addHistory(entry), `history:${metadata.id}`).then(() => { history?.commitEntry(entry); if (entry.routeRef) route?.linkSession(entry.id, 'screen', entry.routeRef.step, entry.routeRef.routeId); }).catch(() => {});
  } catch (failure) { history?.setSaveStatus(`Результат не сохранён: ${failure instanceof Error ? failure.message : String(failure)}`, 'error'); }
}

function persistEarSession(session: EarSession) {
  if (retiring) return;
  try {
    let metadata = sessionMetadata.get(session.questions);
    if (!metadata) { metadata = { id: `ear-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }; sessionMetadata.set(session.questions, metadata); }
    const entry = makeEarHistory(session, metadata);
    if (deletedHistoryIds.has(metadata.id)) return;
    if (currentEarHistoryId && currentEarHistoryId !== metadata.id) liveSessionFinishes.delete(currentEarHistoryId);
    currentEarHistoryId = metadata.id;
    const historyId = metadata.id;
    liveSessionFinishes.set(historyId, () => { if (currentEarHistoryId === historyId) ear?.finishCurrentSession('Активный результат удаляется'); });
    if (entry) void writes.run(() => store.addHistory(entry), `history:${metadata.id}`).then(() => { history?.commitEntry(entry); if (entry.routeRef) route?.linkSession(entry.id, 'ear', entry.routeRef.step, entry.routeRef.routeId); }).catch(() => {});
  } catch (failure) { history?.setSaveStatus(`Слуховой результат не сохранён: ${failure instanceof Error ? failure.message : String(failure)}`, 'error'); }
}

function persistRouteSession(result: RouteResult) {
  if (retiring) return;
  try {
    let metadata = routeMetadata.get(result.id);
    if (!metadata) { metadata = { id: `route-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }; routeMetadata.set(result.id, metadata); }
    const entry = makeRouteHistory(result, metadata);
    if (deletedHistoryIds.has(metadata.id)) return;
    if (result.status === 'finished') liveSessionFinishes.delete(metadata.id);
    else liveSessionFinishes.set(metadata.id, () => { if (route?.getSession()?.id === result.id) route.stop(); });
    if (entry) void writes.run(() => store.addHistory(entry), `history:${metadata.id}`).then(() => history?.commitEntry(entry)).catch(() => {});
  } catch (failure) { history?.setSaveStatus(`Маршрут не сохранён: ${failure instanceof Error ? failure.message : String(failure)}`, 'error'); }
}

function updateModuleVisibility() {
  const foundation = activeModule === 'foundation';
  document.querySelector<HTMLElement>('.workspace')!.hidden = !foundation;
  document.querySelector<HTMLElement>('.selection-section')!.hidden = !foundation || foundationMode === 'quiz';
  byId('connections').hidden = !foundation || foundationMode === 'quiz';
  byId('study-more').hidden = !foundation || foundationMode === 'quiz';
  document.querySelector<HTMLElement>('.board-toolbar')!.hidden = foundationMode === 'quiz';
  document.querySelector<HTMLElement>('.fretboard-section')!.hidden = foundationMode === 'quiz' || (foundationMode === 'sequence' && sequenceView === 'notation');
  document.querySelector<HTMLElement>('.structure-summary')!.hidden = foundationMode === 'quiz';
  document.querySelector<HTMLElement>('.label-field')!.hidden = foundationMode === 'quiz';
  byId('player-mount').hidden = !foundation || foundationMode !== 'sequence';
  byId('sequence-view-controls').hidden = !foundation || foundationMode !== 'sequence';
  byId('notation-mount').hidden = !foundation || foundationMode !== 'sequence' || sequenceView !== 'notation';
  notation?.setVisible(foundation && foundationMode === 'sequence' && sequenceView === 'notation');
  document.querySelectorAll<HTMLElement>('[data-sequence-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sequenceView === sequenceView)));
  byId('ear-mount').hidden = activeModule !== 'ear';
  byId('harmony-mount').hidden = activeModule !== 'harmony';
  byId('tracks-mount').hidden = activeModule !== 'tracks';
  tracks?.setVisible(activeModule === 'tracks' && bankView === 'audio');
  musicBank?.setVisible(activeModule === 'tracks' && bankView === 'scores');
  document.querySelectorAll<HTMLButtonElement>('[data-bank-view]').forEach(button => { button.setAttribute('aria-selected', String(button.dataset.bankView === bankView)); button.tabIndex = button.dataset.bankView === bankView ? 0 : -1; });
  inputMonitor?.setVisible(activeModule === 'input');
  byId('route-mount').hidden = activeModule !== 'route';
  ear?.setVisible(activeModule === 'ear');
  rhythm?.setVisible(activeModule === 'harmony');
  document.querySelectorAll<HTMLElement>('[data-app-module]').forEach(button => { const selected = button.dataset.appModule === activeModule; button.setAttribute('aria-pressed', String(selected)); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  document.querySelector<HTMLElement>('.intro')!.hidden = foundation || activeModule === 'harmony' || (activeModule === 'tracks' && bankView === 'scores');
  byId('study-context').hidden = foundationMode === 'quiz';
  byId('structure-heading').textContent = foundationMode === 'quiz' ? 'Задания на грифе' : `${structure.root} · ${structure.name}`;
  byId('page-title').textContent = ({ foundation: 'Гриф и практика', ear: 'Слух', harmony: 'Метроном и ритм', tracks: 'Табулатура и ноты', input: 'Аудиовход', route: 'Маршрут занятия' })[activeModule];
  document.querySelector<HTMLElement>('.intro-copy > p')!.textContent = ({ foundation: 'Найди ноты и ступени в выбранной области грифа E–A–D–G.', ear: 'Сравни тонику и целевой звук, затем выбери ступень.', harmony: 'Настрой пульс или собери свой рисунок ударных.', tracks: 'Читай ноты и TAB, выбирай любые звучащие партии и повторяй фрагменты.', input: 'Проверь уровень и частоту сигнала; это диагностика без оценки исполнения.', route: 'Один музыкальный материал: 3 минуты грифа, 3 минуты слуха и 4 минуты практики.' })[activeModule];
}

function switchModule(next: AppPreferences['activeModule']) {
  if (next === activeModule) return;
  drafts.capture(); introduction?.stop();
  if (!routeNavigation) { route?.pause(); training?.clearRouteContext(); ear?.clearRouteContext(); }
  if (activeModule === 'foundation') { training?.finishCurrentSession('Занятие остановлено при смене раздела'); sequencePlayer?.stop(); }
  if (activeModule === 'ear') ear?.finishCurrentSession('Слуховое занятие остановлено при смене раздела');
  if (activeModule === 'harmony') rhythm?.pause('module');
  if (activeModule === 'tracks') tracks?.stop(); musicBank?.stop();
  if (activeModule === 'input') inputMonitor?.stop();
  activeModule = next;
  updateModuleVisibility();
  history?.updatePracticeContext();
  syncPracticeBinding();
  savePreferences();
}

function openRouteStep(step: RouteStep, session: RouteSession | null, initial: boolean) {
  if (!session) { drafts.capture(); training?.clearRouteContext(); ear?.clearRouteContext(); switchModule(step === 'ear' ? 'ear' : 'foundation'); if (step !== 'ear') training?.setMode(step === 'fretboard' ? 'quiz' : 'sequence'); syncPracticeBinding(); return; }
  const material = session.material ?? createRouteMaterial();
  drafts.capture();
  routeNavigation = true;
  try {
    const repairView = !rangeIsValid();
    const same = JSON.stringify(state.box) === JSON.stringify(material.box) && (state.box !== null || JSON.stringify(positions.map(position => position.id).sort()) === JSON.stringify([...material.referencePositionIds].sort()));
    if (!same || repairView || state.root !== material.root.replaceAll('♭', 'b').replaceAll('♯', '#') || state.structureId !== material.structureId) {
      training?.finishCurrentSession('Применён материал маршрута'); sequencePlayer?.stop(); state.root = material.root.replaceAll('♭', 'b').replaceAll('♯', '#'); state.structureId = material.structureId;
      applyBox(material.box);
      if (!material.box) { const frets = material.referencePositionIds.map(id => Number(id.split(':')[1])); state.strings = STRING_ORDER.filter(string => material.referencePositionIds.some(id => id.startsWith(`${string}:`))); state.fretMin = Math.min(...frets); state.fretMax = Math.max(...frets); }
      else if (repairView) { const frets = material.referencePositionIds.map(id => Number(id.split(':')[1])); state.fretMin = Math.min(state.fretMin, ...frets); state.fretMax = Math.max(state.fretMax, ...frets); }
      minInput.value = String(state.fretMin); maxInput.value = String(state.fretMax);
      byId('range-error').hidden = true; minInput.setAttribute('aria-invalid', 'false'); maxInput.setAttribute('aria-invalid', 'false');
      updateView();
    }
    switchModule(step === 'ear' ? 'ear' : 'foundation');
    if (step === 'ear') ear?.startRouteContext(material, { routeId: session.id, step }, false);
    else {
      training?.applyRouteContext(material, { routeId: session.id, step }, initial);
      if (step === 'sequence' && initial) sequencePlayer?.applyPreferences(material.player);
    }
  }
  finally { routeNavigation = false; }
  updateModuleVisibility(); syncPracticeBinding(); savePreferences();
  const heading = step === 'fretboard' ? document.querySelector<HTMLElement>('[data-testid="quiz-prompt"]') ?? byId('training-mount').querySelector<HTMLElement>('h2') : document.querySelector<HTMLElement>(step === 'ear' ? '#ear-mount h2' : '#player-mount h2');
  if (heading) { updateRouteInset(); heading.tabIndex = -1; heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: 'start' }); }
}

function applyPreferences(preferences: AppPreferences, source: 'preset' | 'restore' = 'restore') {
  const value = validatePreferences(preferences);
  lastValidPreferences = value;
  drafts.capture();
  applyingPreferences = true;
  try {
  route?.stop(); training?.clearRouteContext(); ear?.clearRouteContext();
  preferenceIssue = '';
  training?.finishCurrentSession('Занятие остановлено перед применением настроек');
  ear?.finishCurrentSession('Слуховое занятие остановлено перед применением настроек');
  rhythm?.stop();
  tracks?.stop(); musicBank?.stop();
  inputMonitor?.stop();
  sequencePlayer?.stop();
    Object.assign(state, value.study, { strings: [...value.study.strings] });
    showFingers = value.study.showFingers; byId<HTMLInputElement>('show-fingers').checked = showFingers;
    activeModule = value.activeModule;
    rootSelect.value = value.study.root;
    structureSelect.value = value.study.structureId;
    minInput.value = String(value.study.fretMin);
    maxInput.value = String(value.study.fretMax);
    document.querySelectorAll<HTMLInputElement>('.string-switch input').forEach(input => { input.checked = value.study.strings.includes(input.value as StringId); });
    byId('range-error').hidden = true;
    minInput.setAttribute('aria-invalid', 'false'); maxInput.setAttribute('aria-invalid', 'false');
    updateView();
    training?.applyPreferences(value.training);
    sequencePlayer?.refreshContext();
    sequencePlayer?.applyPreferences(value.player);
    ear?.applyPreferences(value.ear);
    if (source !== 'preset' || value.rhythm) rhythm?.applyPreferences(value.rhythm ?? DEFAULT_RHYTHM_PREFERENCES);
    tracks?.applyPreferences(value.tracks);
    musicBank?.applyPreferences(value.musicBank);
    bankView = value.musicBank?.file ? 'scores' : value.tracks ? 'audio' : 'scores';
    inputMonitor?.applyPreferences(value.input);
    updateModuleVisibility();
  } finally { applyingPreferences = false; syncPracticeBinding(); }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function positionLabel(position: AnnotatedPosition): string {
  return `${formatMidi(position.midi, position.noteName)}, струна ${position.string}, ${position.fret === 0 ? 'открытая струна, лад 0' : `лад ${position.fret}`}${position.isRoot ? ', тоника' : position.inStructure ? `, ступень ${position.degree}` : ', вне выбранной структуры'}`;
}

function updateView(announce = false) {
  structure = createStructure(state.root, state.structureId);
  positions = annotatePositions(getPositions({ strings: state.strings, fretMin: state.fretMin, fretMax: state.fretMax }), structure);
  boxes = getBoxCatalogue(state.root, state.structureId);
  const boxSelect = byId<HTMLSelectElement>('box-select');
  boxSelect.innerHTML = '<option value="">Свободный диапазон</option>' + boxes.map((box, index) => `<option value="${index}"${JSON.stringify(box.selection) === JSON.stringify(state.box) ? ' selected' : ''}>${box.selection.shapeId.startsWith('penta-') ? `Форма ${box.selection.shapeId.slice(-1).toUpperCase()} · ${box.window.fretMin}–${box.window.fretMax}` : `${escapeHtml(box.label)} · ${box.selection.anchorString}`}</option>`).join('');
  const box = state.box ? getBoxInstance(state.box) : null;
  const outside = box && rangeIsValid() && (box.window.fretMin < state.fretMin || box.window.fretMax > state.fretMax);
  byId('show-whole-form').hidden = !outside;
  if (box) byId('box-notice').textContent = outside ? 'Часть формы находится вне области показа. Её учебный материал сохраняется целиком.' : '';
  const formLabel = box ? box.selection.shapeId.startsWith('penta-') ? `Форма ${box.selection.shapeId.slice(-1).toUpperCase()} · ${box.window.fretMin}–${box.window.fretMax}` : `${box.label} · ${box.selection.anchorString}` : 'Свободный диапазон';
  byId('study-context').textContent = formLabel;
  byId('box-material-caption').textContent = box ? `${box.positions.length} позиций · ${box.label}` : 'Свободная область по струнам и ладам.';
  rootSelect.value = state.root; structureSelect.value = state.structureId;
  document.querySelectorAll<HTMLInputElement>('.string-switch input').forEach(input => { input.checked = state.strings.includes(input.value as StringId); });
  if (!positions.some(position => position.id === state.selectedId)) {
    state.selectedId = (positions.find(position => position.isRoot) ?? positions.find(position => position.inStructure) ?? positions[0])?.id ?? null;
  }
  if (!positions.some(position => position.id === state.activeId)) state.activeId = state.selectedId;

  byId('structure-heading').textContent = `${structure.root} · ${structure.name}`;
  byId('structure-formula').textContent = structure.formula;
  byId('structure-notes').innerHTML = structure.notes.map((note, index) => `<span class="note-pill${index === 0 ? ' is-root' : ''}" data-scale-note="${escapeHtml(note.name)}" data-degree="${escapeHtml(note.degree)}"><strong>${escapeHtml(note.name)}</strong><small>${escapeHtml(note.degree)}</small></span>`).join('');
  const included = positions.filter(position => position.inStructure).length;
  byId('position-count').textContent = `${state.box ? `${getBoxInstance(state.box).positions.length} в форме · ` : ''}${included} в структуре / ${positions.length} позиций`;
  document.querySelectorAll<HTMLButtonElement>('[data-label-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.labelMode === state.labelMode)));
  document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === `${state.fretMin},${state.fretMax}`)));
  renderBoard();
  renderSelection(announce);
  for (const picker of selectPickers) picker.refresh();
  updateModuleVisibility();
  training?.refreshContext();
  syncPracticeBinding();
  sequencePlayer?.refreshContext();
  history?.updatePracticeContext();
  savePreferences();
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
  document.querySelectorAll<HTMLElement>('[data-scale-note]').forEach(element => element.classList.toggle('is-current', Boolean(selected && element.dataset.scaleNote === selected.noteName)));
  if (announce) byId('selection-status').textContent = selected ? positionLabel(selected) : 'Нет доступных позиций. Выберите хотя бы одну струну.';
  fitStudyMore();
}

let studyMoreManual = false;
byId('study-more').querySelector('summary')!.addEventListener('click', () => { studyMoreManual = true; });
function fitStudyMore() {
  const more = byId<HTMLDetailsElement>('study-more');
  if (studyMoreManual || activeModule !== 'foundation' || foundationMode !== 'study' || more.hidden) return;
  more.open = true;
  const workspace = document.querySelector<HTMLElement>('.workspace-main')!;
  const shell = document.querySelector<HTMLElement>('.app-shell')!;
  const bottomSpace = parseFloat(getComputedStyle(workspace).paddingBottom) + parseFloat(getComputedStyle(shell).marginBottom) + 1;
  more.open = more.getBoundingClientRect().bottom + scrollY + bottomSpace <= innerHeight;
}

function focusPosition(id: string, scroll = false) {
  state.activeId = id;
  container.querySelectorAll<SVGGElement>('[data-position]').forEach(element => element.setAttribute('tabindex', element.dataset.position === id ? '0' : '-1'));
  const element = [...container.querySelectorAll<SVGGElement>('[data-position]')].find(item => item.dataset.position === id);
  element?.focus({ preventScroll: true });
  if (scroll) { updateRouteInset(); element?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
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
  drafts.capture(); leaveRoute(); introduction?.stop(); sequencePlayer?.stop(); change(); updateView(true);
}
function moveBoxToMaterial(previous: BoxSelection | null, newStructure = false) {
  if (!previous) return;
  const catalogue = getBoxCatalogue(state.root, state.structureId);
  const shape = state.structureId.endsWith('pentatonic') ? (!newStructure && previous.shapeId.startsWith('penta-') ? previous.shapeId : state.structureId === 'major-pentatonic' ? 'penta-b' : 'penta-a') : previous.shapeId.startsWith('compact-') ? previous.shapeId : 'compact-e';
  const previousWindow = getBoxInstance(previous).window.fretMin;
  const candidates = catalogue.filter(box => box.selection.shapeId === shape).sort((a, b) => Math.abs(a.window.fretMin - previousWindow) - Math.abs(b.window.fretMin - previousWindow) || a.window.fretMin - b.window.fretMin);
  applyBox(candidates[0]?.selection ?? catalogue[0]?.selection ?? null);
}
rootSelect.addEventListener('change', () => changeMaterial(() => { const previous = state.box; state.root = rootSelect.value; moveBoxToMaterial(previous); }));
structureSelect.addEventListener('change', () => changeMaterial(() => { const previous = state.box; state.structureId = structureSelect.value as StructureId; moveBoxToMaterial(previous, true); }));
byId<HTMLSelectElement>('box-select').addEventListener('change', event => changeMaterial(() => applyBox(boxes[Number((event.target as HTMLSelectElement).value)]?.selection && (event.target as HTMLSelectElement).value !== '' ? boxes[Number((event.target as HTMLSelectElement).value)].selection : null)));
byId<HTMLInputElement>('show-fingers').addEventListener('change', event => { showFingers = (event.target as HTMLInputElement).checked; renderBoard(); savePreferences(); });
byId<HTMLSelectElement>('box-neighbor').addEventListener('change', renderBoard);
byId<HTMLInputElement>('show-neighbor').addEventListener('change', event => { showNeighbor = (event.target as HTMLInputElement).checked; renderBoard(); });
byId<HTMLInputElement>('show-octaves').addEventListener('change', event => { showOctaves = (event.target as HTMLInputElement).checked; renderBoard(); });
byId<HTMLInputElement>('show-interval').addEventListener('change', event => { showInterval = (event.target as HTMLInputElement).checked; renderBoard(); });
function toggleSettings(open: boolean) { settingsOpen = open; document.querySelector<HTMLElement>('.workspace')!.classList.toggle('panel-closed', !open); byId('toggle-study-settings').setAttribute('aria-expanded', String(open)); if (!open) byId('toggle-study-settings').focus(); }
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
document.querySelectorAll<HTMLButtonElement>('[data-label-mode]').forEach(button => button.addEventListener('click', () => {
  state.labelMode = button.dataset.labelMode as LabelMode;
  updateView();
}));
document.querySelectorAll<HTMLInputElement>('.string-switch input').forEach(input => input.addEventListener('change', () => {
  drafts.capture(); leaveRoute(); applyBox(null); byId('box-notice').textContent = 'Струны изменены вручную: включён свободный диапазон. Прежняя форма не обрезается.';
  state.strings = [...document.querySelectorAll<HTMLInputElement>('.string-switch input:checked')].map(item => item.value as StringId);
  updateView(true);
}));

function rangeIsValid() {
  const min = Number(minInput.value);
  const max = Number(maxInput.value);
  return minInput.value !== '' && maxInput.value !== '' && Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max <= 24 && min <= max;
}

function applyRange() {
  const min = Number(minInput.value);
  const max = Number(maxInput.value);
  const valid = rangeIsValid();
  byId('range-error').hidden = valid;
  minInput.setAttribute('aria-invalid', String(!valid));
  maxInput.setAttribute('aria-invalid', String(!valid));
  if (!valid) {
    drafts.capture(); leaveRoute(); sequencePlayer?.stop();
    byId<HTMLDetailsElement>('area-settings').open = true;
    byId('range-error').textContent = 'Укажи целые лады от 0 до 24: первый не больше последнего.';
    positions = [];
    renderBoard(); renderSelection(true);
    training?.refreshContext();
    syncPracticeBinding();
    return;
  }
  if (!state.box) { drafts.capture(); leaveRoute(); }
  state.fretMin = min;
  state.fretMax = max;
  updateView(true);
}
minInput.addEventListener('input', applyRange);
maxInput.addEventListener('input', applyRange);
document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(button => button.addEventListener('click', () => {
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

function practiceFullPositions() {
  if (!rangeIsValid()) return [];
  const box = state.box ? getBoxInstance(state.box) : null;
  return box ? annotatePositions(getPositions({ strings: STRING_ORDER.filter(string => box.positions.some(note => note.string === string)), fretMin: box.window.fretMin, fretMax: box.window.fretMax }), structure) : positions;
}
updateView();
training = mountTraining(byId('training-mount'), () => ({ positions: rangeIsValid() ? state.box ? getBoxInstance(state.box).positions : positions : [], fullPositions: practiceFullPositions(), box: state.box, structure }), {
  navigationContainer: byId('mode-nav-mount'),
  onRouteExit: leaveRoute,
  onPreferencesChange: savePreferences,
  onSessionFinished(session) { persistSession(session); if (currentScreenHistoryId) liveSessionFinishes.delete(currentScreenHistoryId); currentScreenHistoryId = null; },
  onSessionChanged: persistSession,
  onModeChange(mode) {
    drafts.capture(); introduction?.stop();
    foundationMode = mode;
    if (mode !== 'sequence') sequencePlayer?.stop();
    updateModuleVisibility();
    if (mode === 'sequence') sequencePlayer?.refreshContext();
    syncPracticeBinding();
  },
  onSequenceChange() { drafts.capture(); sequencePlayer?.refreshContext(); sequencePlayer?.refreshHighlight(); void notation?.refreshContext(); syncPracticeBinding(); history?.updatePracticeContext(); },
});
let lastPlaybackState = 'stopped';
sequencePlayer = mountPlayer(byId('player-mount'), () => training?.getCurrentSequence()?.notes ?? [], {
  onBeforeStart() { introduction?.stop(); rhythm?.pause('audio-owner'); tracks?.stop(); musicBank?.stop(); inputMonitor?.stop(); ear?.pauseListening(); syncPracticeBinding(); },
  onPreferencesChange() {
    drafts.capture();
    if (getDraftPending() !== draftStatusDirty) showPersistenceStatus();
    const session = route?.getSession();
    if (training?.getRouteRef() && session?.material && session.status !== 'finished') {
      const current = currentPlayerPreferences(); const original = session.material.player;
      const musicalKeys = ['bpm', 'duration', 'repeat', 'countIn', 'from', 'to', 'ladderStart', 'ladderEnd', 'ladderStep', 'ladderRepeats', 'metronome', 'metronomeMode', 'subdivision'] as const;
      if (musicalKeys.some(key => current[key] !== original[key])) leaveRoute();
    }
    savePreferences(); void notation?.refreshContext(); syncPracticeBinding();
  },
  onSnapshot(snapshot) {
    const showPulse = currentPlayerPreferences().showPulse;
    notation?.setPlaybackState({ ...snapshot, showPulse });
    drafts.capture();
    if (getDraftPending() !== draftStatusDirty) showPersistenceStatus();
    if (snapshot.state !== lastPlaybackState) { lastPlaybackState = snapshot.state; if (['paused', 'stopped', 'finished'].includes(snapshot.state)) void drafts.flush().catch(() => {}); }
  },
  getContextKey: () => training?.getSequenceContextKey() ?? '',
  onPositionChange(id, noteIndex) {
    notation?.setActiveIndex(noteIndex);
    container.querySelectorAll<SVGGElement>('[data-position]').forEach(element => element.classList.toggle('is-playing', id !== null && element.dataset.position === id));
    document.querySelectorAll<HTMLElement>('[data-sequence-index]').forEach(element => {
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
      if (note) { state.fretMin = Math.min(state.fretMin, note.fret); state.fretMax = Math.max(state.fretMax, note.fret); minInput.value = String(state.fretMin); maxInput.value = String(state.fretMax); updateView(); }
    }
    selectPosition(positionId, false);
    if (action === 'show-position' && positions.some(position => position.id === positionId)) { sequenceView = 'board'; updateModuleVisibility(); byId('return-to-notation').hidden = false; focusPosition(positionId, true); }
  },
});
document.querySelectorAll<HTMLElement>('[data-sequence-view]').forEach(button => button.addEventListener('click', () => { sequenceView = button.dataset.sequenceView as 'board' | 'notation'; updateModuleVisibility(); }));
byId('return-to-notation').addEventListener('click', () => { sequenceView = 'notation'; updateModuleVisibility(); void notation?.refreshContext().then(() => byId('notation-mount').querySelector<SVGElement>('[data-notation-index][tabindex="0"]')?.focus()); });
notation.setVisible(false);
ear = mountEar(byId('ear-mount'), {
  onPreferencesChange: savePreferences,
  onSessionChanged: persistEarSession,
  onSessionFinished() { if (currentEarHistoryId) liveSessionFinishes.delete(currentEarHistoryId); currentEarHistoryId = null; },
  onBeforeListen() { introduction?.stop(); sequencePlayer?.stop(); rhythm?.pause('audio-owner'); tracks?.stop(); musicBank?.stop(); inputMonitor?.stop(); },
});
ear.setVisible(false);
rhythm = mountRhythm(byId('harmony-mount'), {
  onPreferencesChange: savePreferences,
  onLibraryChange: changeRhythmLibrary,
  onBeforeStart() {
    if (retiring || main.inert || document.hidden || activeModule !== 'harmony' || !writerLease?.acquired) throw new Error('Открой раздел «Метроном и ритм», чтобы запустить звук.');
    introduction?.stop(); sequencePlayer?.stop(); ear?.pauseListening('Открыт раздел «Метроном и ритм».');
    tracks?.stop(); musicBank?.stop(); inputMonitor?.stop();
  },
  onPracticeEnd(practice) {
    drafts.captureClosed(rhythmPracticeBinding(practice));
    void drafts.flush().catch(() => {});
  },
  onPracticeChange: syncPracticeBinding,
});
rhythm.setVisible(false);
tracks = mountTracks(byId('legacy-tracks-mount'), {
  onPreferencesChange: savePreferences,
  onBeforePlay() { introduction?.stop(); sequencePlayer?.stop(); rhythm?.pause('audio-owner'); ear?.pauseListening('Открыты аудиодорожки.'); inputMonitor?.stop(); },
});
tracks.setVisible(false);
musicBank = mountMusicBank(byId('music-bank-mount'), {
  onPreferencesChange: savePreferences,
  onBeforePlay() { introduction?.stop(); sequencePlayer?.stop(); rhythm?.pause('audio-owner'); tracks?.stop(); ear?.pauseListening('Открыт раздел «Табулатура и ноты».'); inputMonitor?.stop(); },
});
musicBank.setVisible(false);
function selectBankView(next: 'scores' | 'audio') {
  if (bankView === next) return;
  tracks?.stop(); musicBank?.stop(); bankView = next; updateModuleVisibility();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-bank-view]')) {
  button.addEventListener('click', () => selectBankView(button.dataset.bankView as 'scores' | 'audio'));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'scores' : event.key === 'End' ? 'audio' : bankView === 'scores' ? 'audio' : 'scores';
    selectBankView(next); document.querySelector<HTMLButtonElement>(`[data-bank-view="${next}"]`)?.focus();
  });
}
inputMonitor = mountInput(byId('input-mount'), {
  onPrefsChange: savePreferences,
  onBeforeStart() { introduction?.stop(); sequencePlayer?.stop(); rhythm?.pause('audio-owner'); tracks?.stop(); musicBank?.stop(); ear?.pauseListening('Открыт аудиовход.'); },
});
inputMonitor.setVisible(false);
route = mountRoute(byId('route-mount'), byId('route-session-mount'), {
  onBeforeStart() { drafts.capture(); training?.finishCurrentSession(); ear?.finishCurrentSession(); training?.clearRouteContext(); ear?.clearRouteContext(); introduction?.stop(); sequencePlayer?.stop(); },
  getFreeMaterial: () => { if (!rangeIsValid()) throw new Error('Сначала исправь диапазон грифа.'); return createFreeRouteMaterial({ box: state.box, root: state.root, structureId: state.structureId, referencePositionIds: positions.map(position => position.id), pattern: training!.getPreferences().pattern, scope: training!.getSequenceScope(), player: sequencePlayer!.getPreferences() }); },
  onGo: openRouteStep,
  onPause() { sequencePlayer?.stop(); rhythm?.pause('audio-owner'); tracks?.stop(); musicBank?.stop(); inputMonitor?.stop(); ear?.pauseListening('Активный таймер приостановлен.'); },
  onSessionChanged: persistRouteSession,
  onSessionFinished() { training?.clearRouteContext(); ear?.clearRouteContext(); syncPracticeBinding(); },
});
function updateRouteInset() {
  const host = byId('route-session-mount'); const bounds = host.getBoundingClientRect();
  const inset = host.hidden || !bounds.height ? 16 : bounds.height + (Number.parseFloat(getComputedStyle(host).top) || 0) + 16;
  document.documentElement.style.setProperty('--active-route-inset', `${inset}px`);
}
const routeInsetObserver = new ResizeObserver(updateRouteInset); routeInsetObserver.observe(byId('route-session-mount'));
introduction = mountIntroduction(byId('onboarding-mount'), { onChoice(choice, completed) { setProfile({ ...profile, onboarding: { version: 1, choice, completed } }); },
  onMaterial() { const material = createRouteMaterial(); const box = getBoxInstance(material.box!); applyPreferences({ ...lastValidPreferences, activeModule: 'foundation', study: { ...lastValidPreferences.study, root: 'C', structureId: 'major-triad', strings: STRING_ORDER.filter(string => box.positions.some(position => position.string === string)), fretMin: Math.min(lastValidPreferences.study.fretMin, box.window.fretMin), fretMax: Math.max(lastValidPreferences.study.fretMax, box.window.fretMax), box: material.box }, training: { ...lastValidPreferences.training, mode: 'study', reviewPositionIds: [], questionPolicy: 'random-v1' } }); savePreferences(); },
  onPosition(id) { selectPosition(id, true); }, onBeforeListen() { sequencePlayer?.stop(); rhythm?.pause('audio-owner'); tracks?.stop(); musicBank?.stop(); inputMonitor?.stop(); ear?.pauseListening(); },
});
history = mountHistory(byId('history-mount'), {
  store: {
    readSnapshot: options => store.readSnapshot(options),
    savePreset: value => store.savePreset(value),
    deletePreset: id => store.deletePreset(id),
    addHistory: value => store.addHistory(value),
    deleteHistory: id => store.deleteHistory(id),
    exportBackup: () => store.exportBackup(),
    previewImport: value => store.previewImport(value),
  },
  getPreferences,
  applyPreferences: async (value, source) => { await flushAll(); applyPreferences(value, source); savePreferences(); await writes.flush(); },
  runWrite: operation => retiring ? Promise.reject(new Error('Эта страница закрывается; дождись сохранения и открой занятие снова.')) : writes.run(operation),
  flush: flushAll,
  isPersistent: () => persistent,
  getPracticeDraft: force => { syncPracticeBinding(); return draftView(drafts.current(force)); },
  getPracticeDrafts: () => drafts.all().map(value => draftView(value)),
  editPracticeDraft: (id, note, bpm) => draftView(drafts.edit(id, note, bpm)),
  savePracticeDraft: async (id, note, bpm) => { await drafts.save(id, note, bpm); },
  deletePracticeDraft: async id => { if (drafts.current()?.id === id) { sequencePlayer?.stop(); rhythm?.stop(); } drafts.capture(); await drafts.remove(id); },
  async deleteHistory(id) { liveSessionFinishes.get(id)?.(); deletedHistoryIds.add(id); const generation = writes.supersede(`history:${id}`); await writes.run(() => store.deleteHistory(id), `history:${id}`, generation); liveSessionFinishes.delete(id); },
  async deletePreset(id) { const generation = writes.supersede(`preset:${id}`); await writes.run(() => store.deletePreset(id), `preset:${id}`, generation); },
  onRepeatErrors(ids, context) {
    const frets = ids.map(id => Number(id.split(':')[1]));
    const root = context.root.replaceAll('♭', 'b').replaceAll('♯', '#');
    const preferences = lastValidPreferences;
    applyPreferences({ ...preferences, activeModule: 'foundation', study: { ...preferences.study, root, structureId: context.structureId, strings: STRING_ORDER.filter(string => ids.some(id => id.startsWith(`${string}:`))), fretMin: Math.min(...frets), fretMax: Math.max(...frets), box: null }, training: { ...preferences.training, mode: 'quiz', quizMode: 'name-note', scope: context.scope, reviewPositionIds: [], questionPolicy: 'random-v1' } });
    training?.setReviewPositions(ids, context);
    savePreferences();
    byId('training-mount').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  async restoreBackup(json) {
    // Validation and preview happen before this explicit confirmation callback.
    store.previewImport(json);
    if (retiring || !writerLease?.acquired) throw new Error('Эта вкладка больше не владеет сохранением.');
    main.inert = true;
    enableHeader(false);
    main.setAttribute('aria-busy', 'true');
    try {
      sequencePlayer?.stop();
      rhythm?.stop();
      route?.stop();
      ear?.finishCurrentSession('Слуховое занятие остановлено перед восстановлением'); tracks?.stop(); musicBank?.stop(); inputMonitor?.stop();
      training?.finishCurrentSession('Занятие остановлено перед восстановлением');
      await flushAll();
      if (retiring) throw new Error('Страница закрывается; восстановление не начато.');
      await store.restore(json, { confirmed: true });
      if (retiring) throw new Error('Страница закрывается; данные уже восстановлены.');
      const snapshot = await store.readSnapshot();
      if (retiring) throw new Error('Страница закрывается; настройки будут прочитаны при следующем запуске.');
      writes.clearFailures();
      drafts.reload(snapshot.practiceDrafts); bindingKey = '';
      rhythm?.applyLibrary(rhythmLibrary(snapshot));
      profile = snapshot.profile; theme.setPreference(profile.theme, { notify: false }); if (persistent) theme.confirmPreference(profile.theme);
      applyPreferences(snapshot.preferences);
      return snapshot;
    } finally { main.inert = retiring || !writerLease?.acquired; main.setAttribute('aria-busy', String(main.inert)); enableHeader(!main.inert); }
  },
});
byId('retry-save').addEventListener('click', () => {
  if (retiring) return;
  void writes.retry().then(async () => {
    if (!writes.failureCount && !retiring) {
      rhythm?.confirmLibrary(rhythmLibrary(await store.readSnapshot()));
      history?.clearActionError();
    }
    await history?.refresh();
  }).catch(() => {});
});
byId('retry-tab').addEventListener('click', () => location.reload());
const historyDrawer = byId('history-mount').querySelector<HTMLDetailsElement>('.history-drawer')!;
function setHistoryOpen(open: boolean) {
  byId('history-mount').hidden = !open;
  historyDrawer.open = open;
  byId('open-history').setAttribute('aria-expanded', String(open));
}
function closeIntroduction() {
  const panel = byId('onboarding-mount');
  if (panel.hidden) return;
  introduction?.stop();
  panel.hidden = true;
}
byId('open-introduction').addEventListener('click', () => {
  setHistoryOpen(false);
  introduction?.open();
  const heading = byId('onboarding-mount').querySelector<HTMLElement>('h2');
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView({ block: 'start' });
});
document.querySelectorAll<HTMLElement>('[data-app-module]').forEach(button => button.addEventListener('click', () => {
  setHistoryOpen(false);
  closeIntroduction();
  switchModule(button.dataset.appModule as AppPreferences['activeModule']);
  window.scrollTo({ top: 0 });
}));
byId('open-history').addEventListener('click', () => {
  const open = !historyDrawer.open;
  if (open) closeIntroduction();
  setHistoryOpen(open);
});
historyDrawer.addEventListener('toggle', () => {
  byId('open-history').setAttribute('aria-expanded', String(historyDrawer.open));
  if (historyDrawer.open) {
    // The history view renders its body on this event before scrolling can use its height.
    historyDrawer.scrollIntoView({ block: 'start' });
    historyDrawer.querySelector('summary')?.focus({ preventScroll: true });
  } else {
    if (historyDrawer.contains(document.activeElement)) byId('open-history').focus({ preventScroll: true });
    byId('history-mount').hidden = true;
  }
});

async function initialize() {
  writerLease = await acquireWriterLease();
  if (retiring) { writerLease.release(); return; }
  if (!writerLease.acquired) {
    byId('persistence-banner').hidden = false;
    byId('persistence-message').textContent = 'Занятие уже открыто в другой вкладке. Закрой её и нажми «Проверить снова».';
    byId('retry-tab').hidden = false;
    return;
  }
  let snapshot;
  try { await store.open(); if (retiring) return; snapshot = await store.readSnapshot(); }
  catch (failure) {
    if (retiring) return;
    await store.close().catch(() => {});
    store = createMemoryStudyStore();
    persistent = false;
    startupIssue = `Исходная база не сброшена: ${failure instanceof Error ? failure.message : String(failure)}`;
    snapshot = await store.readSnapshot();
    console.warn('Локальная база не открылась; исходные данные не сброшены.', failure);
  }
  if (retiring) return;
  profile = snapshot.profile; theme.setPreference(profile.theme, { notify: false }); if (persistent) theme.confirmPreference(profile.theme);
  drafts.reload(snapshot.practiceDrafts); bindingKey = '';
  rhythm?.applyLibrary(rhythmLibrary(snapshot));
  applyPreferences(snapshot.preferences);
  writes.clearFailures();
  await history?.refresh();
  if (retiring) return;
  main.inert = false;
  main.setAttribute('aria-busy', 'false');
  enableHeader(true);
  // Start with the practice screen; introduction is an explicit navigation action.
}
void initialize().catch(failure => {
  byId('persistence-banner').hidden = false;
  byId('persistence-message').textContent = `Не удалось подготовить страницу: ${failure instanceof Error ? failure.message : String(failure)}`;
  byId('persistence-banner').classList.add('has-error');
});
function retire() {
  if (retirement) return retirement;
  main.inert = true;
  boardResizeObserver.disconnect();
  for (const picker of selectPickers) picker.dispose();
  enableHeader(false);
  routeInsetObserver.disconnect();
  sequencePlayer?.stop();
  rhythm?.stop();
  tracks?.stop(); musicBank?.stop();
  inputMonitor?.stop();
  route?.stop();
  ear?.stop('Страница закрывается');
  introduction?.stop(); drafts.capture();
  retiring = true;
  rhythm?.dispose();
  musicBank?.dispose();
  clearInterval(draftCheckpoint);
  retirement = (async () => { try { await flushAll(); await store.close(); } finally { drafts.dispose(); theme.dispose(); writerLease?.release(); } })();
  return retirement;
}
window.addEventListener('pagehide', () => { void retire(); });
const draftCheckpoint = setInterval(() => { if (!retiring && !main.inert) void drafts.flush().catch(() => {}); }, 5000);
document.addEventListener('visibilitychange', () => { if (document.hidden && !retiring) void drafts.flush().catch(() => {}); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
if (import.meta.hot) import.meta.hot.dispose(() => { void retire(); introduction?.dispose(); sequencePlayer?.dispose(); training?.dispose(); ear?.dispose(); rhythm?.dispose(); notation?.dispose(); tracks?.dispose(); void inputMonitor?.dispose(); route?.dispose(); history?.dispose(); });
