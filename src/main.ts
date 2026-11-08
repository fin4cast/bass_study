import './styles.css';
import { mountTraining } from './ui/training';
import { mountPlayer } from './ui/player';
import { mountHistory } from './ui/history';
import { mountEar } from './ui/ear';
import { mountHarmony } from './ui/harmony';
import { mountNotation } from './ui/notation';
import { mountTracks } from './ui/tracks';
import { mountInput } from './ui/input';
import { mountRoute, type RouteStep } from './ui/route';
import type { EarSession } from './ear';
import type { RouteResult } from './route';
import { createWriteQueue } from './app/write-queue';
import { createThemeController, type ThemePreference } from './app/theme';
import { createPracticeDrafts } from './app/practice-drafts';
import { mountIntroduction } from './ui/introduction';
import { getBoxCatalogue, getBoxInstance, type BoxSelection, type BoxInstance } from './music/boxes';
import { createRouteMaterial, createFreeRouteMaterial, type RouteSession } from './route';
import { acquireWriterLease } from './app/writer-lock';
import type { QuizSession } from './training';
import { createStudyStore, createMemoryStudyStore, DEFAULT_PREFERENCES, DEFAULT_PROFILE, makeScreenHistory, makeEarHistory, makeRouteHistory, validatePreferences, type AppPreferences, type HistoryMetadata, type GlobalProfile, type PracticeDraft } from './storage';
import type { PracticeMaterial } from './training/results';
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
  selectedId: 'E:5' as string | null,
  activeId: 'E:5' as string | null,
  box: null as BoxSelection | null,
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения #app.');

app.innerHTML = `
  <div class="app-shell">
    <header class="site-header">
      <a class="brand" href="#" aria-label="bass.study — к началу страницы"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>bass<span class="brand-dot">.</span>study</a>
      <span class="header-caption">Личный тренажёр бас-гитары</span>
      <button type="button" id="open-introduction" class="text-button" disabled>Введение</button>
      <label class="theme-picker"><span>Тема</span><select id="theme-preference" aria-label="Тема оформления" disabled><option value="system">Системная</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label>
      <span class="local-badge"><span aria-hidden="true"></span>Локально</span>
    </header>

    <div id="persistence-banner" class="persistence-banner" role="status"><span id="persistence-message">Читаем локальные настройки…</span><button type="button" id="retry-save" hidden>Повторить сохранение</button><button type="button" id="retry-tab" hidden>Проверить снова</button></div>
    <main inert aria-busy="true">
      <section class="intro" aria-labelledby="page-title">
        <div><h1 id="page-title">Гриф и практика</h1></div>
        <div class="intro-copy"><p>Найди ноты и ступени в выбранной области грифа E–A–D–G.</p></div>
      </section>
      <section id="onboarding-mount" aria-label="Введение" hidden></section>

      <nav class="module-navigation" aria-label="Раздел тренажёра"><button type="button" data-app-module="foundation" aria-pressed="true">Гриф и практика</button><button type="button" data-app-module="ear" aria-pressed="false">Слух</button><button type="button" data-app-module="harmony" aria-pressed="false">Аккомпанемент</button><button type="button" data-app-module="tracks" aria-pressed="false">Аудиодорожки</button><button type="button" data-app-module="input" aria-pressed="false">Аудиовход</button><button type="button" data-app-module="route" aria-pressed="false">Маршрут занятия</button></nav>
      <div id="route-session-mount"></div>
      <section id="ear-mount" aria-label="Слуховые задания" hidden></section>
      <section id="harmony-mount" aria-label="Аккомпанемент" hidden></section>
      <section id="tracks-mount" aria-label="Локальные аудиодорожки" hidden></section>
      <section id="input-mount" aria-label="Диагностический аудиовход" hidden></section>
      <section id="route-mount" aria-label="Маршрут занятия" hidden></section>
      <section class="workspace" aria-label="Изучение грифа">
        <div id="mode-nav-mount"></div>
        <div class="settings-panel">
          <div class="section-title"><span class="section-number">01</span><h2>Что изучаем</h2></div>
          <div class="musical-controls">
            <label class="field root-field" for="root-note"><span>Тоника</span><select id="root-note" aria-label="Тоника">${ROOTS.map((root, i) => `<option value="${root}"${root === state.root ? ' selected' : ''}>${ROOT_LABELS[i]}</option>`).join('')}</select></label>
            <label class="field structure-field" for="structure"><span>Структура</span><select id="structure" aria-label="Структура">${STRUCTURES.map(item => `<option value="${item.id}"${item.id === state.structureId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
            <fieldset class="label-field"><legend>Подписи на грифе</legend><div class="segmented" aria-label="Подписи на грифе"><button type="button" data-label-mode="notes" aria-pressed="true">Ноты</button><button type="button" data-label-mode="degrees" aria-pressed="false">Ступени</button><button type="button" data-label-mode="hidden" aria-pressed="false">Без подписей</button></div></fieldset>
          </div>
          <div id="box-controls"><label class="field"><span>Учебная форма</span><select id="box-select" aria-label="Учебная форма"></select></label><label><input type="checkbox" id="show-fingers"> Пальцы (в квадрате)</label><label class="field" id="neighbor-field" hidden><span>Общие позиции с соседом</span><select id="box-neighbor" aria-label="Соседняя форма"><option value="next">Следующая</option><option value="previous">Предыдущая</option></select></label><p id="box-neighbor-name"></p><p id="box-notice" role="status"></p><details class="learning-help"><summary>О формах</summary><p>Это версионированный учебный каталог bass.study, а не универсальная нумерация или единственная аппликатура. Закрытые формы целиком помещаются на ладах 1–24. Свободная карта включает открытые струны. Круг — ступень, квадрат — рекомендуемый палец. Общие физические позиции с выбранной соседней формой отмечены контуром.</p></details><details class="learning-help"><summary>Ступени и знаки</summary><p>Ступень — место звука относительно тоники: 1 — тоника, 3 — терция, 5 — квинта. Альтерация ♭ понижает ступень на полутон, ♯ повышает: ♭3 — малая терция. Номер ступени не является номером пальца.</p><p>Нота с цифрой обозначает звучащую октаву: C2 и C3 — разные высоты одной ноты. В басовой записи нота написана на октаву выше звучания. Трезвучие содержит три разных звука по терциям; повтор тоники выше не добавляет четвёртый класс ноты.</p></details></div>
          <details id="area-settings"><summary>Струны и свободный диапазон</summary>
          <div class="scope-controls">
            <fieldset class="string-field"><legend>Струны</legend><div class="string-switches">${STRING_ORDER.map(string => `<label class="string-switch"><input type="checkbox" value="${string}" aria-label="Струна ${string}" checked><span>${string}</span></label>`).join('')}</div></fieldset>
            <fieldset class="range-field"><legend>Лады <span class="range-hint">включая границы</span></legend><div class="range-inputs"><label><span class="sr-only">Первый лад</span><input id="fret-min" aria-label="Первый лад" type="number" min="0" max="24" step="1" value="0"></label><span class="range-dash" aria-hidden="true">—</span><label><span class="sr-only">Последний лад</span><input id="fret-max" aria-label="Последний лад" type="number" min="0" max="24" step="1" value="12"></label></div></fieldset>
            <div class="range-presets" aria-label="Быстрый диапазон"><button type="button" data-range="0,5">0–5</button><button type="button" data-range="0,12" aria-pressed="true">0–12</button><button type="button" data-range="12,24">12–24</button></div>
            <p class="range-description">Лад 0 — открытая струна.<br> Модель грифа: 0–24 лада.</p>
          </div>
          </details>
          <p id="range-error" class="range-error" data-testid="range-error" role="alert" hidden></p>
        </div>

        <div class="structure-summary">
          <div><p class="eyebrow summary-eyebrow">ВЫБРАННАЯ СТРУКТУРА</p><h2 id="structure-heading"></h2></div>
          <div id="structure-notes" class="note-pills" data-testid="structure-notes" aria-label="Ноты выбранной структуры"></div>
          <div class="formula"><span>Формула</span><strong id="structure-formula" data-testid="structure-formula"></strong></div>
        </div>

        <div id="training-mount"></div>
        <div id="player-mount" hidden></div>
        <div id="sequence-view-controls" class="segmented" aria-label="Представление последовательности" hidden><button type="button" data-sequence-view="board" aria-pressed="true">Гриф</button><button type="button" data-sequence-view="notation" aria-pressed="false">Ноты и TAB</button><button type="button" id="return-to-notation" hidden>Вернуться к выбранной ноте в записи</button></div>
        <section id="notation-mount" aria-label="Нотная запись и табулатура последовательности" hidden></section>
        <div class="fretboard-section">
          <div class="board-header"><div class="section-title"><span class="section-number">02</span><h2>Исследуй позиции</h2></div><span id="position-count" class="position-count"></span></div>
          <div class="board-scroll" id="board-scroll"><div id="fretboard-container"></div></div>
          <div class="board-footer"><div class="legend"><span><i class="legend-root" aria-hidden="true"></i>Тоника</span><span><i class="legend-note" aria-hidden="true"></i>Нота структуры</span><span><i class="legend-selected" aria-hidden="true"></i>Выбранная позиция</span></div><p class="board-navigation">Стрелки — перемещение · Enter / пробел — выбрать</p></div>
        </div>
      </section>

      <section class="selection-section" aria-label="Выбранная нота и её связи"><div id="selection-detail" data-testid="selection-detail"></div><div id="connections" class="connections"></div></section>
      <section id="history-mount" aria-label="История и настройки"></section>
      <p id="selection-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
      <footer class="page-footer"><span>Маленький участок. Понятная структура. Больше уверенности на грифе.</span><span>E · A · D · G</span></footer>
    </main>
  </div>
`;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const neighborDetails = document.createElement('details'); neighborDetails.id = 'box-neighbor-details'; neighborDetails.className = 'learning-help';
const neighborSummary = document.createElement('summary'); neighborSummary.textContent = 'Соседняя форма';
const neighborField = byId('neighbor-field'); neighborField.before(neighborDetails); neighborDetails.append(neighborSummary, neighborField, byId('box-neighbor-name'));
const rootSelect = byId<HTMLSelectElement>('root-note');
const structureSelect = byId<HTMLSelectElement>('structure');
const minInput = byId<HTMLInputElement>('fret-min');
const maxInput = byId<HTMLInputElement>('fret-max');
const container = byId('fretboard-container');
let positions: readonly AnnotatedPosition[] = [];
let structure = createStructure(state.root, state.structureId);
let training: ReturnType<typeof mountTraining> | undefined;
let sequencePlayer: ReturnType<typeof mountPlayer> | undefined;
let history: ReturnType<typeof mountHistory> | undefined;
let ear: ReturnType<typeof mountEar> | undefined;
let accompaniment: ReturnType<typeof mountHarmony> | undefined;
let notation: ReturnType<typeof mountNotation> | undefined;
let tracks: ReturnType<typeof mountTracks> | undefined;
let inputMonitor: ReturnType<typeof mountInput> | undefined;
let route: ReturnType<typeof mountRoute> | undefined;
let introduction: ReturnType<typeof mountIntroduction> | undefined;
let sequenceView: 'board' | 'notation' = 'board';
let profile: GlobalProfile = DEFAULT_PROFILE;
let showFingers = false;
let boxes: readonly BoxInstance[] = [];
let bindingKey = '';
let activeModule: AppPreferences['activeModule'] = 'foundation';
let foundationMode: 'study' | 'quiz' | 'sequence' = 'study';
let routeNavigation = false;
let lastValidPreferences = DEFAULT_PREFERENCES;
let store: ReturnType<typeof createStudyStore> | ReturnType<typeof createMemoryStudyStore> = createStudyStore();
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
  byId('persistence-message').textContent = message;
  byId('persistence-banner').classList.toggle('has-error', error);
  byId('retry-save').hidden = failures.length === 0;
  history?.setSaveStatus(message, error ? 'error' : pending || dirty ? 'saving' : persistent ? 'saved' : 'memory');
}
const writes = createWriteQueue(value => { writeState = value; showPersistenceStatus(); });
const theme = createThemeController({ onChange(value) { setProfile({ ...profile, theme: value }); } });
function setProfile(value: GlobalProfile) {
  if (retiring || !writerLease?.acquired || main.inert || applyingPreferences) return;
  profile = structuredClone(value);
  const confirmed = structuredClone(value);
  void writes.run(async () => { await store.saveProfile(confirmed); if (persistent) theme.confirmPreference(confirmed.theme); }, 'profile').catch(() => {});
}
function enableHeader(enabled: boolean) { byId<HTMLSelectElement>('theme-preference').disabled = !enabled; byId<HTMLButtonElement>('open-introduction').disabled = !enabled; }
byId<HTMLSelectElement>('theme-preference').addEventListener('change', event => theme.setPreference((event.target as HTMLSelectElement).value as ThemePreference));
const drafts = createPracticeDrafts({ getStore: () => store, write: (operation, key) => writes.run(operation, key), supersede: key => writes.supersede(key), resolveSuperseded: key => writes.resolveSuperseded(key),
  onCommit() { history?.updatePracticeContext(); showPersistenceStatus(); }, onEntry(entry) { history?.commitEntry(entry); if (entry.routeRef) route?.linkSession(entry.id, 'manual', entry.routeRef.step, entry.routeRef.routeId); },
  onChange() { history?.updatePracticeContext(); showPersistenceStatus(); },
});
getDraftPending = () => drafts.hasPendingChanges();
function syncPracticeBinding() {
  if (applyingPreferences) return;
  let next: import('./app/practice-drafts').PracticeBinding | null = null;
  const box = state.box ? getBoxInstance(state.box) : null;
  if (activeModule === 'harmony') next = { context: { root: 'C', structureId: 'major', scope: 'structure', positionIds: getPositions({ strings: ['E', 'A', 'D', 'G'], fretMin: 0, fretMax: 12 }).map(position => position.id), box: null },
    material: { kind: 'harmony', patternId: 'CFGC-1-3-5-3-v1' }, routeRef: null, label: 'Аккомпанемент C–F–G–C · основной тон–3–5–3', readClock: () => accompaniment?.getPracticeDraft() ?? { durationMs: 0, comfortableBpm: 80 } };
  else if (activeModule === 'foundation' && rangeIsValid() && foundationMode !== 'quiz') {
    const sequence = training?.getCurrentSequence();
    const player = currentPlayerPreferences();
    const material: PracticeMaterial = foundationMode === 'sequence' && sequence ? { kind: 'sequence', pattern: training?.getPreferences().pattern ?? 'ascending', routePositionIds: sequence.notes.map(position => position.id), duration: player.duration,
      fragment: { from: (player.from ?? 1) - 1, toExclusive: player.to ?? sequence.notes.length }, box: state.box } : { kind: 'fretboard', box: state.box };
    next = { context: { root: structure.root, structureId: structure.id, scope: foundationMode === 'sequence' ? training?.getSequenceScope() ?? 'structure' : 'structure', positionIds: (box?.positions ?? positions).map(position => position.id), box: state.box }, material,
      routeRef: route?.getSession()?.status !== 'finished' ? training?.getRouteRef() ?? null : null, label: foundationMode === 'sequence' ? 'Последовательность на грифе' : 'Изучение грифа',
      readClock: foundationMode === 'sequence' ? () => sequencePlayer?.getPracticeDraft() ?? { durationMs: 0, comfortableBpm: 80 } : () => ({ durationMs: 0, comfortableBpm: player.bpm }) };
  }
  const key = next ? JSON.stringify({ context: next.context, material: next.material, routeRef: next.routeRef }) : '';
  if (key !== bindingKey) { drafts.bind(next); bindingKey = key; void drafts.flush().catch(() => {}); }
}
function currentPlayerPreferences() { try { return sequencePlayer?.getPreferences() ?? DEFAULT_PREFERENCES.player; } catch { return lastValidPreferences.player; } }
function draftView(value: PracticeDraft | null) {
  return value ? { id: value.id, createdAt: value.createdAt, timeZone: value.timeZone, context: value.context, material: value.material, routeRef: value.routeRef, durationMs: value.totalReferenceMs - value.recordedThroughMs, comfortableBpm: value.comfortableBpm, note: value.note,
    label: value.material.kind === 'harmony' ? 'Аккомпанемент C–F–G–C · основной тон–3–5–3' : value.material.kind === 'sequence' ? 'Последовательность на грифе' : 'Изучение грифа', available: true }
    : { context: { root: structure.root, structureId: structure.id, scope: 'structure' as const, positionIds: rangeIsValid() ? (state.box ? getBoxInstance(state.box).positions : positions).map(position => position.id) : [], box: state.box }, durationMs: 0, comfortableBpm: currentPlayerPreferences().bpm, note: '', label: foundationMode === 'study' ? 'Изучение грифа' : 'Последовательность на грифе', available: activeModule === 'harmony' || (activeModule === 'foundation' && foundationMode !== 'quiz') };
}
async function flushAll() { await drafts.flush(); await writes.flush(); }
function leaveRoute() { drafts.capture(); route?.stop(); training?.clearRouteContext(); ear?.clearRouteContext(); syncPracticeBinding(); }

function getPreferences(): AppPreferences {
  const value = validatePreferences({
    activeModule,
    ear: activeModule === 'ear' ? ear?.getPreferences() ?? DEFAULT_PREFERENCES.ear : lastValidPreferences.ear,
    harmony: activeModule === 'harmony' ? accompaniment?.getPreferences() ?? DEFAULT_PREFERENCES.harmony : lastValidPreferences.harmony,
    tracks: activeModule === 'tracks' ? tracks?.getPreferences() ?? null : lastValidPreferences.tracks,
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
  tracks?.setVisible(activeModule === 'tracks');
  inputMonitor?.setVisible(activeModule === 'input');
  byId('route-mount').hidden = activeModule !== 'route';
  ear?.setVisible(activeModule === 'ear');
  accompaniment?.setVisible(activeModule === 'harmony');
  document.querySelectorAll<HTMLElement>('[data-app-module]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.appModule === activeModule)));
  byId('page-title').textContent = ({ foundation: 'Гриф и практика', ear: 'Слух', harmony: 'Аккомпанемент', tracks: 'Аудиодорожки', input: 'Аудиовход', route: 'Маршрут занятия' })[activeModule];
  document.querySelector<HTMLElement>('.intro-copy > p')!.textContent = ({ foundation: 'Найди ноты и ступени в выбранной области грифа E–A–D–G.', ear: 'Сравни тонику и целевой звук, затем выбери ступень.', harmony: 'Слушай C–F–G–C и играй своё сопровождение.', tracks: 'Загрузи личную запись и повторяй точный фрагмент.', input: 'Проверь уровень и частоту сигнала; это диагностика без оценки исполнения.', route: 'Один музыкальный материал: 3 минуты грифа, 3 минуты слуха и 4 минуты практики.' })[activeModule];
}

function switchModule(next: AppPreferences['activeModule']) {
  if (next === activeModule) return;
  drafts.capture(); introduction?.stop();
  if (!routeNavigation) { route?.pause(); training?.clearRouteContext(); ear?.clearRouteContext(); }
  if (activeModule === 'foundation') { training?.finishCurrentSession('Занятие остановлено при смене раздела'); sequencePlayer?.stop(); }
  if (activeModule === 'ear') ear?.finishCurrentSession('Слуховое занятие остановлено при смене раздела');
  if (activeModule === 'harmony') accompaniment?.stop();
  if (activeModule === 'tracks') tracks?.stop();
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
    const same = JSON.stringify(state.box) === JSON.stringify(material.box) && (state.box !== null || JSON.stringify(positions.map(position => position.id).sort()) === JSON.stringify([...material.referencePositionIds].sort()));
    if (!same || state.root !== material.root.replaceAll('♭', 'b').replaceAll('♯', '#') || state.structureId !== material.structureId) {
      training?.finishCurrentSession('Применён материал маршрута'); sequencePlayer?.stop(); state.root = material.root.replaceAll('♭', 'b').replaceAll('♯', '#'); state.structureId = material.structureId;
      applyBox(material.box);
      if (!material.box) { const frets = material.referencePositionIds.map(id => Number(id.split(':')[1])); state.strings = STRING_ORDER.filter(string => material.referencePositionIds.some(id => id.startsWith(`${string}:`))); state.fretMin = Math.min(...frets); state.fretMax = Math.max(...frets); }
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

function applyPreferences(preferences: AppPreferences) {
  const value = validatePreferences(preferences);
  lastValidPreferences = value;
  drafts.capture();
  applyingPreferences = true;
  try {
  route?.stop(); training?.clearRouteContext(); ear?.clearRouteContext();
  preferenceIssue = '';
  training?.finishCurrentSession('Занятие остановлено перед применением настроек');
  ear?.finishCurrentSession('Слуховое занятие остановлено перед применением настроек');
  accompaniment?.stop();
  tracks?.stop();
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
    accompaniment?.applyPreferences(value.harmony);
    tracks?.applyPreferences(value.tracks);
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
  boxSelect.innerHTML = '<option value="">Свободный диапазон</option>' + boxes.map((box, index) => `<option value="${index}"${JSON.stringify(box.selection) === JSON.stringify(state.box) ? ' selected' : ''}>${box.selection.shapeId.startsWith('penta-') ? `Форма ${box.selection.shapeId.slice(-1).toUpperCase()} · ` : ''}${escapeHtml(box.label)}</option>`).join('');
  if (state.box) byId('box-notice').textContent = 'Обычные задания и последовательность используют только точные позиции этой полной формы.';
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
  training?.refreshContext();
  syncPracticeBinding();
  sequencePlayer?.refreshContext();
  history?.updatePracticeContext();
  savePreferences();
}

function renderBoard() {
  const focusedId = document.activeElement instanceof Element ? document.activeElement.closest<SVGGElement>('[data-position]')?.dataset.position : undefined;
  const box = state.box ? getBoxInstance(state.box) : null;
  const boxIds = new Set(box?.referencePositionIds ?? []);
  const currentBoxIndex = box ? boxes.findIndex(other => JSON.stringify(other.selection) === JSON.stringify(box.selection)) : -1;
  const direction = byId<HTMLSelectElement>('box-neighbor').value === 'previous' ? -1 : 1;
  const neighbor = currentBoxIndex >= 0 ? boxes[currentBoxIndex + direction] : undefined;
  const sharedIds = new Set(box && neighbor ? neighbor.referencePositionIds.filter(id => boxIds.has(id)) : []);
  byId('neighbor-field').hidden = !box || !box.selection.shapeId.startsWith('penta-');
  neighborDetails.hidden = !box || !box.selection.shapeId.startsWith('penta-');
  byId('box-neighbor-name').textContent = box && box.selection.shapeId.startsWith('penta-') ? neighbor ? `Сосед: форма ${neighbor.selection.shapeId.slice(-1).toUpperCase()} · ${neighbor.label}. Общих позиций: ${sharedIds.size}.` : 'С этой стороны нет полной формы на ладах 1–24.' : '';
  const emptyMessage = positions.length === 0 ? '<div class="empty-state" data-testid="empty-state"><h3>Выбери хотя бы одну струну</h3><p>Четыре струны остаются на месте; ноты появятся на включённых струнах.</p></div>' : '';
  const rows = STRING_ORDER;
  const columnCount = state.fretMax - state.fretMin + 1;
  const cell = 72;
  const left = 82;
  const right = 24;
  const top = 58;
  const rowGap = 72;
  const width = left + columnCount * cell + right;
  // Keep a physical fret cell readable without enlarging a compact form to the
  // whole laptop width. All four string rows retain the same natural height.
  const canvasWidth = width;
  const height = top + (rows.length - 1) * rowGap + 58;
  const x = (fret: number) => left + (fret - state.fretMin + 0.5) * cell;
  const y = (string: StringId) => top + rows.indexOf(string) * rowGap;
  const frets = Array.from({ length: columnCount }, (_, index) => index + state.fretMin);
  const selected = positions.find(position => position.id === state.selectedId);
  container.innerHTML = `${emptyMessage}<svg class="fretboard" data-testid="fretboard" viewBox="0 0 ${canvasWidth} ${height}" style="min-width:${canvasWidth}px;height:${height}px" aria-labelledby="board-title board-description">
    <title id="board-title">Гриф четырёхструнного баса</title><desc id="board-description">Струны сверху вниз G, D, A, E. Выберите позицию мышью или перейдите стрелками и нажмите Enter. Лады от ${state.fretMin} до ${state.fretMax} включительно.</desc>
    <defs><linearGradient id="board-grain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--board-top)"/><stop offset="1" stop-color="var(--board-bottom)"/></linearGradient></defs>
    <rect class="board-surface" x="${left}" y="24" width="${columnCount * cell}" height="${height - 48}" rx="3" fill="url(#board-grain)"/>
    ${frets.map(fret => `<text class="fret-number" x="${x(fret)}" y="15" text-anchor="middle">${fret === 0 ? '0' : fret}</text><line class="fret-wire${fret === 0 ? ' nut-line' : ''}" x1="${left + (fret - state.fretMin + 1) * cell}" y1="24" x2="${left + (fret - state.fretMin + 1) * cell}" y2="${height - 24}"/>`).join('')}
    ${frets.filter(fret => [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(fret)).map(fret => fret % 12 === 0 ? `<circle class="fret-inlay" cx="${x(fret) - 5}" cy="${height - 34}" r="2.5"/><circle class="fret-inlay" cx="${x(fret) + 5}" cy="${height - 34}" r="2.5"/>` : `<circle class="fret-inlay" cx="${x(fret)}" cy="${height - 34}" r="2.5"/>`).join('')}
    ${rows.map(string => `<text class="string-name" x="27" y="${y(string) + 5}" text-anchor="middle">${string}</text><line class="bass-string string-${string}" x1="${left - 17}" y1="${y(string)}" x2="${width - right}" y2="${y(string)}"/>`).join('')}
    ${positions.map(position => {
      const text = state.labelMode === 'notes' ? position.noteName : position.degree ?? '';
      const samePitch = selected && selected.midi === position.midi && selected.id !== position.id;
      const isSelected = selected?.id === position.id;
      return `<g role="button" class="position${position.inStructure ? ' in-structure' : ' outside-structure'}${box ? boxIds.has(position.id) ? ' in-box' : ' outside-box' : ''}${sharedIds.has(position.id) ? ' shared-box-position' : ''}${position.isRoot ? ' root-position' : ''}${isSelected ? ' selected-position' : ''}${samePitch ? ' same-pitch-position' : ''}" data-position="${position.id}" data-note-name="${escapeHtml(position.noteName)}" data-midi="${position.midi}" data-root="${position.isRoot}" data-in-structure="${position.inStructure}" transform="translate(${x(position.fret)},${y(position.string)})" tabindex="${position.id === state.activeId ? 0 : -1}" aria-label="${escapeHtml(positionLabel(position))}${showFingers && box?.fingers[position.id] ? `, рекомендуемый палец ${box.fingers[position.id]}` : ''}" aria-pressed="${isSelected}">
        <title>${escapeHtml(positionLabel(position))}</title>
        <rect class="position-hit" x="-34" y="-31" width="68" height="62" rx="5"/>
        <circle class="position-focus" r="29"/><circle class="position-selection" r="25"/>
        <circle class="note-marker" r="${position.inStructure ? 19 : 5}"/>
        ${position.isRoot ? '<circle class="root-ring" r="15"/>' : ''}
        ${state.labelMode !== 'hidden' && position.inStructure ? `<text data-position-label text-anchor="middle" dy=".35em">${escapeHtml(text)}</text>` : ''}
        ${showFingers && box?.fingers[position.id] ? `<rect class="finger-background" x="14" y="-30" width="16" height="16" rx="2"/><text class="finger-label" x="22" y="-18" text-anchor="middle">${box.fingers[position.id]}</text>` : ''}
      </g>`;
    }).join('')}
  </svg>`;
  sequencePlayer?.refreshHighlight();
  if (focusedId) focusPosition(focusedId);
}

function renderSelection(announce: boolean) {
  const selected = positions.find(position => position.id === state.selectedId);
  if (!selected) {
    byId('selection-detail').innerHTML = '<div class="selection-card selection-empty"><p class="eyebrow">ВЫБРАННАЯ ПОЗИЦИЯ</p><h2>Пока нет позиции</h2><p>Включи струну, чтобы продолжить исследование.</p></div>';
    byId('connections').innerHTML = '';
    if (announce) byId('selection-status').textContent = 'Нет доступных позиций. Выберите хотя бы одну струну.';
    return;
  }
  const fullName = formatMidi(selected.midi, selected.noteName);
  const samePitch = positions.filter(position => position.midi === selected.midi && position.id !== selected.id);
  const otherOctaves = positions.filter(position => position.pitchClass === selected.pitchClass && position.midi !== selected.midi);
  byId('selection-detail').innerHTML = `<div class="selection-card"><div class="selected-heading"><p class="eyebrow">ВЫБРАННАЯ ПОЗИЦИЯ</p><span class="selection-kind${selected.isRoot ? ' is-root' : selected.inStructure ? '' : ' outside'}">${selected.isRoot ? 'Тоника' : selected.inStructure ? `Ступень ${escapeHtml(selected.degree ?? '')}` : 'Вне структуры'}</span></div><div class="selected-note"><h2>${escapeHtml(fullName)}</h2><div><strong>Струна ${selected.string} · ${selected.fret === 0 ? 'открытая' : `лад ${selected.fret}`}</strong><span>${selected.inStructure ? `Входит в ${structure.root} · ${escapeHtml(structure.name.toLowerCase())}` : 'Не входит в выбранную структуру'}</span></div></div><dl class="note-facts"><div><dt>Звучащая высота</dt><dd>${escapeHtml(fullName)}</dd></div><div><dt>MIDI</dt><dd>${selected.midi}</dd></div><div><dt>Частота</dt><dd>${selected.frequency.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Гц</dd></div></dl></div>`;
  byId('connections').innerHTML = `<div class="connections-heading"><span class="section-number">03</span><h2>Та же нота — разные места</h2></div><p class="connections-intro">Связи в выбранном диапазоне. Одинаковая высота и другая октава — разные случаи.</p><div class="connection-group"><h3>Та же высота <span>${samePitch.length}</span></h3><div class="connection-buttons">${connectionButtons(samePitch, 'same') || '<p class="no-connections">Других позиций в этом диапазоне нет.</p>'}</div></div><div class="connection-group"><h3>Другие октавы <span>${otherOctaves.length}</span></h3><div class="connection-buttons">${connectionButtons(otherOctaves, 'octave') || '<p class="no-connections">Другие октавы вне выбранной области.</p>'}</div></div>`;
  const facts = byId('selection-detail').querySelector('dl');
  if (facts) { const details = document.createElement('details'); details.className = 'learning-help note-technical'; const summary = document.createElement('summary'); summary.textContent = 'Технические сведения: MIDI и частота'; facts.before(details); details.append(summary, facts); }
  if (announce) byId('selection-status').textContent = positionLabel(selected);
}

function connectionButtons(items: readonly AnnotatedPosition[], kind: string): string {
  return [...items].sort((a, b) => a.midi - b.midi || STRING_ORDER.indexOf(a.string) - STRING_ORDER.indexOf(b.string)).map(position => `<button class="connection-button" type="button" data-connect="${position.id}" data-connection-kind="${kind}"><strong>${escapeHtml(formatMidi(position.midi, position.noteName))}</strong><span>${position.string} · ${position.fret === 0 ? 'откр.' : `${position.fret} лад`}</span><span aria-hidden="true">↗</span></button>`).join('');
}

function focusPosition(id: string, scroll = false) {
  state.activeId = id;
  container.querySelectorAll<SVGGElement>('[data-position]').forEach(element => element.setAttribute('tabindex', element.dataset.position === id ? '0' : '-1'));
  const element = [...container.querySelectorAll<SVGGElement>('[data-position]')].find(item => item.dataset.position === id);
  element?.focus({ preventScroll: true });
  if (scroll) { updateRouteInset(); element?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}

function selectPosition(id: string, focus = true) {
  if (!positions.some(position => position.id === id)) return;
  state.selectedId = id;
  state.activeId = id;
  renderBoard();
  renderSelection(true);
  if (focus) focusPosition(id, true);
}

function applyBox(selection: BoxSelection | null) {
  state.box = selection;
  if (selection) { const box = getBoxInstance(selection); state.strings = STRING_ORDER.filter(string => box.positions.some(position => position.string === string)); state.fretMin = box.window.fretMin; state.fretMax = box.window.fretMax;
    state.selectedId = (box.positions.find(position => position.isRoot) ?? box.positions[0]).id; state.activeId = state.selectedId;
    minInput.value = String(state.fretMin); maxInput.value = String(state.fretMax); byId('range-error').hidden = true; minInput.setAttribute('aria-invalid', 'false'); maxInput.setAttribute('aria-invalid', 'false');
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
  drafts.capture(); leaveRoute();
  const min = Number(minInput.value);
  const max = Number(maxInput.value);
  const valid = rangeIsValid();
  byId('range-error').hidden = valid;
  minInput.setAttribute('aria-invalid', String(!valid));
  maxInput.setAttribute('aria-invalid', String(!valid));
  if (!valid) {
    byId<HTMLDetailsElement>('area-settings').open = true;
    byId('range-error').textContent = 'Укажи целые лады от 0 до 24: первый не больше последнего. На грифе сохранён последний корректный диапазон.';
    training?.refreshContext();
    return;
  }
  state.fretMin = min;
  state.fretMax = max;
  applyBox(null); byId('box-notice').textContent = 'Область изменена вручную: включён свободный диапазон. Прежняя форма не обрезается.';
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

updateView();
training = mountTraining(byId('training-mount'), () => ({ positions: rangeIsValid() ? state.box ? getBoxInstance(state.box).positions : positions : [], fullPositions: rangeIsValid() ? positions : [], box: state.box, structure }), {
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
  onBeforeStart() { introduction?.stop(); accompaniment?.stop(); tracks?.stop(); inputMonitor?.stop(); ear?.pauseListening(); syncPracticeBinding(); },
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
  onSelect: (_index, positionId, action) => { selectPosition(positionId, false); if (action === 'show-position') { sequenceView = 'board'; updateModuleVisibility(); byId('return-to-notation').hidden = false; focusPosition(positionId, true); } },
});
document.querySelectorAll<HTMLElement>('[data-sequence-view]').forEach(button => button.addEventListener('click', () => { sequenceView = button.dataset.sequenceView as 'board' | 'notation'; updateModuleVisibility(); }));
byId('return-to-notation').addEventListener('click', () => { sequenceView = 'notation'; updateModuleVisibility(); void notation?.refreshContext().then(() => byId('notation-mount').querySelector<SVGElement>('[data-notation-index][tabindex="0"]')?.focus()); });
notation.setVisible(false);
ear = mountEar(byId('ear-mount'), {
  onPreferencesChange: savePreferences,
  onSessionChanged: persistEarSession,
  onSessionFinished() { if (currentEarHistoryId) liveSessionFinishes.delete(currentEarHistoryId); currentEarHistoryId = null; },
  onBeforeListen() { introduction?.stop(); sequencePlayer?.stop(); accompaniment?.stop(); tracks?.stop(); inputMonitor?.stop(); },
});
ear.setVisible(false);
accompaniment = mountHarmony(byId('harmony-mount'), {
  onPreferencesChange: savePreferences,
  onBeforeStart() { introduction?.stop(); sequencePlayer?.stop(); ear?.pauseListening('Открыто сопровождение.'); tracks?.stop(); inputMonitor?.stop(); syncPracticeBinding(); },
});
accompaniment.setVisible(false);
tracks = mountTracks(byId('tracks-mount'), {
  onPreferencesChange: savePreferences,
  onBeforePlay() { introduction?.stop(); sequencePlayer?.stop(); accompaniment?.stop(); ear?.pauseListening('Открыты аудиодорожки.'); inputMonitor?.stop(); },
});
tracks.setVisible(false);
inputMonitor = mountInput(byId('input-mount'), {
  onPrefsChange: savePreferences,
  onBeforeStart() { introduction?.stop(); sequencePlayer?.stop(); accompaniment?.stop(); tracks?.stop(); ear?.pauseListening('Открыт аудиовход.'); },
});
inputMonitor.setVisible(false);
route = mountRoute(byId('route-mount'), byId('route-session-mount'), {
  onBeforeStart() { drafts.capture(); training?.finishCurrentSession(); ear?.finishCurrentSession(); training?.clearRouteContext(); ear?.clearRouteContext(); introduction?.stop(); sequencePlayer?.stop(); },
  getFreeMaterial: () => { if (!rangeIsValid()) throw new Error('Сначала исправь диапазон грифа.'); return createFreeRouteMaterial({ box: state.box, root: state.root, structureId: state.structureId, referencePositionIds: positions.map(position => position.id), pattern: training!.getPreferences().pattern, scope: training!.getSequenceScope(), player: sequencePlayer!.getPreferences() }); },
  onGo: openRouteStep,
  onPause() { sequencePlayer?.stop(); accompaniment?.stop(); tracks?.stop(); inputMonitor?.stop(); ear?.pauseListening('Активный таймер приостановлен.'); },
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
  onMaterial() { const material = createRouteMaterial(); const box = getBoxInstance(material.box!); applyPreferences({ ...lastValidPreferences, activeModule: 'foundation', study: { ...lastValidPreferences.study, root: 'C', structureId: 'major-triad', strings: STRING_ORDER.filter(string => box.positions.some(position => position.string === string)), fretMin: box.window.fretMin, fretMax: box.window.fretMax, box: material.box }, training: { ...lastValidPreferences.training, mode: 'study', reviewPositionIds: [], questionPolicy: 'random-v1' } }); savePreferences(); },
  onPosition(id) { selectPosition(id, true); }, onBeforeListen() { sequencePlayer?.stop(); accompaniment?.stop(); tracks?.stop(); inputMonitor?.stop(); ear?.pauseListening(); },
});
byId('open-introduction').addEventListener('click', () => introduction?.open());
document.querySelectorAll<HTMLElement>('[data-app-module]').forEach(button => button.addEventListener('click', () => switchModule(button.dataset.appModule as AppPreferences['activeModule'])));
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
  applyPreferences: async value => { await flushAll(); applyPreferences(value); savePreferences(); await writes.flush(); },
  runWrite: operation => retiring ? Promise.reject(new Error('Эта страница закрывается; дождись сохранения и открой занятие снова.')) : writes.run(operation),
  flush: flushAll,
  isPersistent: () => persistent,
  getPracticeDraft: force => { syncPracticeBinding(); return draftView(drafts.current(force)); },
  getPracticeDrafts: () => drafts.all().map(value => draftView(value)),
  editPracticeDraft: (id, note, bpm) => draftView(drafts.edit(id, note, bpm)),
  savePracticeDraft: async (id, note, bpm) => { await drafts.save(id, note, bpm); },
  deletePracticeDraft: async id => { if (drafts.current()?.id === id) { sequencePlayer?.stop(); accompaniment?.stop(); } drafts.capture(); await drafts.remove(id); },
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
      accompaniment?.stop();
      route?.stop();
      ear?.finishCurrentSession('Слуховое занятие остановлено перед восстановлением'); tracks?.stop(); inputMonitor?.stop();
      training?.finishCurrentSession('Занятие остановлено перед восстановлением');
      await flushAll();
      if (retiring) throw new Error('Страница закрывается; восстановление не начато.');
      await store.restore(json, { confirmed: true });
      if (retiring) throw new Error('Страница закрывается; данные уже восстановлены.');
      const snapshot = await store.readSnapshot();
      if (retiring) throw new Error('Страница закрывается; настройки будут прочитаны при следующем запуске.');
      writes.clearFailures();
      drafts.reload(snapshot.practiceDrafts); bindingKey = '';
      profile = snapshot.profile; theme.setPreference(profile.theme, { notify: false }); if (persistent) theme.confirmPreference(profile.theme);
      applyPreferences(snapshot.preferences);
      return snapshot;
    } finally { main.inert = retiring || !writerLease?.acquired; main.setAttribute('aria-busy', String(main.inert)); enableHeader(!main.inert); }
  },
});
byId('retry-save').addEventListener('click', () => { if (!retiring) void writes.retry().then(() => { if (!writes.failureCount) history?.clearActionError(); return history?.refresh(); }); });
byId('retry-tab').addEventListener('click', () => location.reload());

async function initialize() {
  writerLease = await acquireWriterLease();
  if (retiring) { writerLease.release(); return; }
  if (!writerLease.acquired) {
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
  applyPreferences(snapshot.preferences);
  writes.clearFailures();
  await history?.refresh();
  if (retiring) return;
  main.inert = false;
  main.setAttribute('aria-busy', 'false');
  enableHeader(true);
  if (profile.onboarding.choice === null) introduction?.open(profile);
}
void initialize().catch(failure => {
  byId('persistence-message').textContent = `Не удалось подготовить страницу: ${failure instanceof Error ? failure.message : String(failure)}`;
  byId('persistence-banner').classList.add('has-error');
});
function retire() {
  if (retirement) return retirement;
  main.inert = true;
  enableHeader(false);
  routeInsetObserver.disconnect();
  sequencePlayer?.stop();
  accompaniment?.stop();
  tracks?.stop();
  inputMonitor?.stop();
  route?.stop();
  ear?.stop('Страница закрывается');
  introduction?.stop(); drafts.capture();
  retiring = true;
  clearInterval(draftCheckpoint);
  retirement = (async () => { try { await flushAll(); await store.close(); } finally { drafts.dispose(); theme.dispose(); writerLease?.release(); } })();
  return retirement;
}
window.addEventListener('pagehide', () => { void retire(); });
const draftCheckpoint = setInterval(() => { if (!retiring && !main.inert) void drafts.flush().catch(() => {}); }, 5000);
document.addEventListener('visibilitychange', () => { if (document.hidden && !retiring) void drafts.flush().catch(() => {}); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
if (import.meta.hot) import.meta.hot.dispose(() => { void retire(); introduction?.dispose(); sequencePlayer?.dispose(); training?.dispose(); ear?.dispose(); accompaniment?.dispose(); notation?.dispose(); tracks?.dispose(); void inputMonitor?.dispose(); route?.dispose(); history?.dispose(); });
