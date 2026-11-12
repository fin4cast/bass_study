import './history.css';
import { STRUCTURES, createStructure, formatMidi, getPosition, type StringId } from '../music';
import { getBoxInstance } from '../music/boxes';
import { createManualPracticeResult, type QuestionContext } from '../training';
import { manualTempoBounds, rhythmPracticeLabel, type PracticeMaterial } from '../training/results';
import type { RouteRef, RouteMaterial } from '../route';
import type { SavedEarResult } from '../ear';
import { confirmAction } from './confirm';
import {
  MAX_BACKUP_BYTES,
  getHistorySummary,
  getReviewPositionIds,
  makeManualHistory,
  type AppPreferences,
  type HistoryEntry,
  type PreparedStudyImport,
  type Preset,
  type StudySnapshot,
  type StoredQuestion,
} from '../storage';
import { escapeHtml } from './html';

type StatusKind = 'saving' | 'saved' | 'memory' | 'error';

export interface ManualPracticeDraft {
  id?: string;
  createdAt?: string;
  timeZone?: string;
  note?: string;
  material?: PracticeMaterial;
  routeRef?: RouteRef | null;
  context: QuestionContext | null;
  durationMs: number;
  comfortableBpm: number;
  label?: string;
  available?: boolean;
  runtimeContextKey?: string;
}

export interface HistoryOptions {
  readConfirmed: (options?: { fresh?: boolean }) => Promise<StudySnapshot>;
  savePreset: (preset: Preset) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  saveManual: (entry: HistoryEntry) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  prepareImport: (json: string) => PreparedStudyImport;
  exportConfirmed: () => Promise<{ json: string; incomplete: boolean }>;
  /** Raw dump of the browser database for the case when the application cannot read it. */
  exportRaw?: () => Promise<string>;
  getSkippedRecords?: () => readonly unknown[];
  reveal?: (target: HTMLElement) => void;
  getPreferences: () => AppPreferences;
  applyPreferences: (preferences: AppPreferences, source: 'preset' | 'restore') => void | Promise<void>;
  waitForWrites: () => Promise<void>;
  restoreBackup: (candidate: PreparedStudyImport, onCommitted: () => void) => Promise<StudySnapshot>;
  peekPracticeDraft: () => ManualPracticeDraft;
  capturePracticeDraft: (force: boolean) => ManualPracticeDraft;
  getPracticeDrafts?: () => ManualPracticeDraft[];
  editPracticeDraft?: (id: string | null, note: string, bpm: number) => ManualPracticeDraft;
  savePracticeDraft?: (id: string, note: string, bpm: number) => Promise<void>;
  deletePracticeDraft?: (id: string) => Promise<void>;
  onRepeatErrors?: (positionIds: readonly string[], context: QuestionContext) => void;
  isPersistent: () => boolean;
  onManualSaved?: (durationMs: number, runtimeContextKey?: string) => void;
}

const MODE_NAMES: Record<string, string> = {
  'name-note': 'Назови ноту', 'find-note': 'Найди ноту', 'find-all': 'Все позиции', 'find-degree': 'Найди ступень',
  'find-pitch': 'Найди высоту', 'find-interval': 'Найди интервал',
};
const OUTCOME_NAMES: Record<string, string> = {
  correct: 'Самостоятельно', corrected: 'С исправлением', revealed: 'Ответ показан', skipped: 'Пропущено', interrupted: 'Не завершено',
};

function contextName(context: QuestionContext | null): string {
  if (!context) return 'Ритмическая практика';
  const structure = STRUCTURES.find(item => item.id === context.structureId)?.name ?? context.structureId;
  const strings = (['G', 'D', 'A', 'E'] as const).filter(string => context.positionIds.some(id => id.startsWith(`${string}:`)));
  const frets = context.positionIds.map(id => Number(id.split(':')[1]));
  const min = frets.length ? Math.min(...frets) : null, max = frets.length ? Math.max(...frets) : null;
  const rectangle = min !== null && max !== null && context.positionIds.length === strings.length * (max - min + 1);
  const scope = !frets.length ? 'без позиций' : rectangle ? `струны ${strings.join('/')} · лады ${min}–${max}` : `выборка ${strings.map(string => `${string}: ${fretsForString(context.positionIds, string)}`).join('; ')}`;
  const box = context.box ? ` · форма: ${getBoxInstance(context.box).label}` : '';
  return `${context.root} · ${structure} · ${context.scope === 'structure' ? 'ноты структуры' : 'все ноты'} · ${scope}${box} · ${context.positionIds.length} позиций`;
}

function comparisonConditions(group: ReturnType<typeof getHistorySummary>['groups'][number]): string {
  const interval = group.intervalDegrees.length ? `Интервал: ${group.intervalDegrees.map(degree => degree.replaceAll('b', '♭').replaceAll('#', '♯')).join(', ')}. ` : '';
  const policy = { 'random-v1': 'Случайные вопросы', 'triad-6-v1': 'Маршрут: по два вопроса на звук', 'shape-6-v1': 'Маршрут: шесть целей формы' }[group.questionPolicy];
  return `${interval}${policy}`;
}

function fretsForString(ids: readonly string[], string: StringId): string {
  const frets = [...new Set(ids.filter(id => id.startsWith(`${string}:`)).map(id => Number(id.split(':')[1])))].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < frets.length; index++) {
    const first = frets[index]; let last = first;
    while (frets[index + 1] === last + 1) last = frets[++index];
    ranges.push(last === first ? String(first) : `${first}–${last}`);
  }
  return ranges.join(',');
}

function materialName(material?: PracticeMaterial): string {
  if (!material) return 'Материал не выбран';
  if (material.kind === 'rhythm') return rhythmPracticeLabel(material);
  if (material.kind === 'fretboard') return 'Изучение грифа';
  const pattern = { ascending: 'Вверх', descending: 'Вниз', 'round-trip': 'Туда и обратно', 'groups-of-three': 'Группами по три' }[material.pattern];
  return `Последовательность: ${pattern} · ноты ${material.fragment.from + 1}–${material.fragment.toExclusive} · ${{ quarter: 'четверти', eighth: 'восьмые', sixteenth: 'шестнадцатые' }[material.duration]}`;
}

function presetDescription(preferences: AppPreferences): string {
  const { activeModule, study, training, player } = preferences;
  if (activeModule === 'ear') return `Слух · ${preferences.ear.root} · ${preferences.ear.quality === 'major' ? 'мажорное' : 'минорное'} трезвучие · ${preferences.ear.count} вопросов · ${preferences.ear.bpm} BPM`;
  if (activeModule === 'harmony') {
    if (!preferences.rhythm) return 'Метроном и ритм';
    const { bpm, meter } = preferences.rhythm.metronome;
    return `Метроном и ритм · ${meter.beats}/${meter.denominator} · ${bpm} BPM`;
  }
  if (activeModule === 'tracks') {
    const bank = preferences.musicBank;
    if (bank?.file) return `Табулатура и ноты · ${bank.file.artist ? bank.file.artist + ' — ' : ''}${bank.file.title || bank.file.name} · ${bank.tracks.length} партий · скорость ×${bank.speed}. Исходный файл выбирается заново.`;
    return preferences.tracks ? `Личные записи · ${preferences.tracks.tracks.map(track => track.name).join(', ')} · фрагмент ${preferences.tracks.clip.from}–${preferences.tracks.clip.to} с · скорость ×${preferences.tracks.rate}. Исходные файлы выбираются заново.` : 'Табулатура и ноты · материал не выбран';
  }
  if (activeModule === 'input') return `Аудиовход · ${preferences.input.deviceId ? 'сохранённый выбор устройства' : 'устройство по умолчанию'} · подключение только по кнопке`;
  if (activeModule === 'route') return 'Маршрут C major · гриф → слух → практика · 10 активных минут';
  const mode = training.mode === 'study' ? 'Изучение грифа' : training.mode === 'quiz' ? `Задания: ${MODE_NAMES[training.quizMode]}` : `Последовательности · ${player.bpm} BPM`;
  return `${mode} · ${study.root} · ${STRUCTURES.find(item => item.id === study.structureId)?.name ?? study.structureId} · струны ${study.strings.join('/')} · лады ${study.fretMin}–${study.fretMax}${study.box ? ` · форма: ${getBoxInstance(study.box).label}` : ''}`;
}

function answerName(answer: string | number | null, context: QuestionContext, target?: { pitchClass: number; name: string }): string {
  if (answer === null) return 'нет ответа';
  if (typeof answer === 'string' && /^[EADG]:\d+$/.test(answer)) {
    const [string, fret] = answer.split(':'); const position = getPosition(string as StringId, Number(fret));
    const name = target?.pitchClass === position.pitchClass ? target.name : createStructure(context.root, context.structureId).notes.find(note => note.pitchClass === position.pitchClass)?.name;
    return `${formatMidi(position.midi, name)} · ${string}/${fret}`;
  }
  const pitch = typeof answer === 'number' ? answer : /^pc:\d+$/.test(answer) ? Number(answer.slice(3)) : null;
  if (pitch !== null) return target?.pitchClass === pitch ? target.name : createStructure(context.root, context.structureId).notes.find(note => note.pitchClass === pitch)?.name ?? ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch] ?? String(answer);
  return String(answer);
}

function screenQuestionMarkup(question: StoredQuestion, context: QuestionContext, mode: string): string {
  const target = question.targetMidi !== null ? formatMidi(question.targetMidi, question.target.name) : mode === 'find-interval' ? `${question.target.degree} от ${context.root} · ${question.target.name}` : question.target.name;
  const required = `${target}${question.targetPositionId ? ` · ${question.targetPositionId.replace(':', '/')}` : ''}`;
  return `<li><strong>${escapeHtml(required)}</strong><span>${OUTCOME_NAMES[question.outcome]}</span><small>Первый ответ: ${escapeHtml(answerName(question.firstAnswer, context, question.target))} → требуется ${escapeHtml(required)}. ${question.errors} ошибок · первый ответ ${question.firstResponseMs === null ? '—' : `${(question.firstResponseMs / 1000).toFixed(2)} с`}</small>${question.answerEvents.length ? `<details class="attempt-details"><summary class="section-disclosure">Все попытки · ${question.answerEvents.length}</summary><ol>${question.answerEvents.map((event, index) => `<li>${index + 1}. ${escapeHtml(answerName(event.answer, context, question.target))} — ${event.correct ? 'верно' : 'не совпало'} · ${(event.elapsedMs / 1000).toFixed(2)} с</li>`).join('')}</ol></details>` : ''}</li>`;
}

function earQuestionMarkup(question: SavedEarResult, index: number): string {
  const hidden = question.outcome === 'interrupted';
  const required = hidden ? 'цель скрыта' : `${question.question.targetDegree.replace('b', '♭')} · ${formatMidi(question.question.targetMidi, question.question.targetName)}`;
  return `<li><strong>${hidden ? `Вопрос ${index + 1} · цель скрыта` : escapeHtml(required)}</strong><span>${OUTCOME_NAMES[question.outcome]}</span><small>Первый ответ: ${escapeHtml(question.firstAnswer?.replace('b', '♭') ?? 'нет ответа')} → ${hidden ? 'цель скрыта' : `требуется ${escapeHtml(required)}`} · прослушиваний ${question.listensCompleted} · повторов ${question.replayCount} · ошибок ${question.errors} · первый ответ ${question.firstResponseMs === null ? '—' : `${(question.firstResponseMs / 1000).toFixed(2)} с`}</small>${question.answerEvents.length ? `<details class="attempt-details"><summary class="section-disclosure">Все попытки · ${question.answerEvents.length}</summary><ol>${question.answerEvents.map(event => `<li>Ступень ${escapeHtml(event.degree.replace('b', '♭'))} — ${event.correct ? 'верно' : 'не совпало'} · ${(event.atMs / 1000).toFixed(2)} с</li>`).join('')}</ol></details>` : ''}</li>`;
}

function reviewReasons(entries: readonly HistoryEntry[]): string {
  const questions = entries.flatMap(entry => entry.result.kind === 'screen' ? entry.result.questions : []);
  return `Причины в вопросах: ошибка — ${questions.filter(question => question.errors > 0).length}, показ ответа — ${questions.filter(question => question.hintUsed).length}, пропуск — ${questions.filter(question => question.skipped).length}. Причины могут пересекаться.`;
}

function routeMaterialMarkup(material: RouteMaterial): string {
  const context: QuestionContext = { root: material.root, structureId: material.structureId, scope: material.scope, positionIds: material.referencePositionIds, box: material.box };
  const player = material.player;
  const pattern = { ascending: 'Вверх', descending: 'Вниз', 'round-trip': 'Туда и обратно', 'groups-of-three': 'Группами по три' }[material.pattern];
  const duration = { quarter: 'четверти', eighth: 'восьмые', sixteenth: 'шестнадцатые' }[player.duration];
  const repeat = { once: 'один проход', infinite: 'по кругу', ladder: `лестница ${player.ladderStart}–${player.ladderEnd} BPM, шаг ${player.ladderStep}, по ${player.ladderRepeats} прохода` }[player.repeat];
  const from = player.from ?? 1, to = player.to ?? material.sequencePositionIds.length;
  const positions = (ids: readonly string[]) => ids.map(id => id.replace(':', '/')).join(' → ');
  const triad = createStructure(material.root, material.earQuality === 'major' ? 'major-triad' : 'minor-triad');
  return `<p class="entry-context">${material.kind === 'triad-route-v1' ? 'Вводный маршрут' : 'Маршрут из выбранного материала'} · ${escapeHtml(contextName(context))}</p><p class="history-help">${pattern} · ${player.bpm} BPM · ${duration} · ${repeat} · фрагмент: ноты ${from}–${to}, обе границы включены.</p><details class="route-material-details"><summary class="section-disclosure">Точный материал и ритм</summary><p>Позиции грифа: ${escapeHtml(positions(material.referencePositionIds))}.</p><p>Слух: опора ${escapeHtml(formatMidi(material.referenceMidi, material.root))} · ${triad.notes.map(note => escapeHtml(formatMidi(material.referenceMidi + note.semitones, note.name))).join(' / ')} · ${material.earBpm} BPM.</p><p>Путь последовательности: ${escapeHtml(positions(material.sequencePositionIds))}.</p><p>Отсчёт: ${player.countIn ? '4 доли' : 'выключен'}. Метроном: ${player.metronome ? { all: 'каждая доля', 'two-four': '2 и 4', 'gap-2-2': 'два такта звук / два тишина' }[player.metronomeMode] : 'выключен'}; деление: ${{ quarter: 'четверти', eighth: 'восьмые', sixteenth: 'шестнадцатые' }[player.subdivision]}. Визуальный пульс ${player.showPulse ? 'включён' : 'выключен'}.</p></details>`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} с`;
  return `${Math.floor(seconds / 60)} мин ${String(seconds % 60).padStart(2, '0')} с`;
}

function formatDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
}

/** All mutations go through the root write queue; import coordination belongs to root. */
export function mountHistory(container: HTMLElement, options: HistoryOptions) {
  const controller = new AbortController();
  let snapshot: StudySnapshot | null = null;
  let disposed = false;
  let busy = false;
  let refreshVersion = 0;
  let filter: 'all' | 'screen' | 'manual' | 'ear' | 'route' = 'all';
  let visibleEntries = 10;
  let reviewContextKey: string | null = null;
  let status = 'Читаем локальные данные…';
  let statusKind: StatusKind = 'saving';
  let actionError = '';
  let actionNotice = '';
  let presetName = '';
  let manualBpm: string | null = null;
  let manualNote = '';
  let manualDraft: ManualPracticeDraft | null = null;
  let importIntent = 0;
  let pendingFilename = '';
  let preview: PreparedStudyImport | null = null;
  let importConfirmed = false;
  let stableFocus: { attribute: string; value: string } | null = null;
  const revokeTimers = new Set<ReturnType<typeof setTimeout>>();
  const blobUrls = new Set<string>();
  let derived: { history: readonly HistoryEntry[]; summary: ReturnType<typeof getHistorySummary>; groups: ReturnType<typeof reviewGroups> } | null = null;

  container.classList.add('history-section');
  container.innerHTML = `<details class="history-drawer content-panel"><summary><span class="history-summary-label"><span class="history-icon" aria-hidden="true">≡</span><strong>Мои занятия и настройки</strong><small data-history-count>История · пресеты · резервная копия</small></span><span class="history-save-status" data-testid="history-save-status" role="status" aria-live="polite"></span><span class="history-chevron" aria-hidden="true">⌄</span></summary><div class="history-body" data-testid="history-body"></div></details>`;
  const body = container.querySelector<HTMLElement>('.history-body')!;
  const drawer = container.querySelector<HTMLDetailsElement>('.history-drawer')!;
  drawer.addEventListener('toggle', () => { if (drawer.open) render(); }, { signal: controller.signal });

  function setSaveStatus(message: string, kind: StatusKind) {
    status = message;
    statusKind = kind;
    const output = container.querySelector<HTMLElement>('[data-testid="history-save-status"]')!;
    output.textContent = status;
    output.dataset.status = statusKind;
  }

  const draftKey = (draft: ManualPracticeDraft) => draft.id ?? JSON.stringify({ context: draft.context, material: draft.material, runtime: draft.runtimeContextKey });
  function captureDraft(force = true) {
    const current = options.capturePracticeDraft(force);
    manualDraft = structuredClone(current);
    manualBpm = String(Math.round(current.comfortableBpm));
    manualNote = current.note ?? '';
    return manualDraft;
  }

  function editDraft() {
    if (!options.editPracticeDraft || !manualDraft) return;
    const entered = Number(manualBpm);
    const [min, max] = manualTempoBounds(manualDraft.material);
    const bpm = manualBpm?.trim() && Number.isInteger(entered) && entered >= min && entered <= max ? entered : manualDraft.comfortableBpm;
    manualDraft = options.editPracticeDraft(manualDraft.id ?? null, manualNote, bpm);
  }

  const SCROLLABLE = '.history-table-scroll, textarea';
  /** Ключ элемента, устойчивый к пересборке разметки: запись истории, тег, классы и порядковый номер среди таких же. */
  function viewKey(element: HTMLElement) {
    const entry = element.closest<HTMLElement>('[data-history-entry]');
    const same = [...(entry ?? body).querySelectorAll<HTMLElement>(element.tagName)].filter(item => item.className === element.className);
    return `${entry?.dataset.historyEntry ?? ''}|${element.tagName}|${element.className}|${same.indexOf(element)}`;
  }
  /** Раскрытые блоки и прокрутка внутри панели переживают перерисовку (например, после контрольного сохранения черновика). */
  function captureView() {
    const open = new Map<string, boolean>(), scroll = new Map<string, readonly [number, number]>();
    body.querySelectorAll<HTMLDetailsElement>('details').forEach(details => open.set(viewKey(details), details.open));
    body.querySelectorAll<HTMLElement>(SCROLLABLE).forEach(element => { if (element.scrollTop || element.scrollLeft) scroll.set(viewKey(element), [element.scrollTop, element.scrollLeft]); });
    return { open, scroll };
  }
  function restoreView(view: ReturnType<typeof captureView>) {
    if (!view.open.size && !view.scroll.size) return;
    body.querySelectorAll<HTMLDetailsElement>('details').forEach(details => { const open = view.open.get(viewKey(details)); if (open !== undefined && details.open !== open) details.open = open; });
    if (view.scroll.size) body.querySelectorAll<HTMLElement>(SCROLLABLE).forEach(element => { const position = view.scroll.get(viewKey(element)); if (position) { element.scrollTop = position[0]; element.scrollLeft = position[1]; } });
  }
  function render() {
    if (disposed) return;
    const active = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? document.activeElement : null;
    if (active) {
      const attribute = ['data-history-field', 'data-history-action', 'data-apply-preset', 'data-delete-preset', 'data-delete-history', 'data-history-reveal', 'data-history-file'].find(name => active.hasAttribute(name));
      stableFocus = attribute ? { attribute, value: active.getAttribute(attribute)! } : null;
    } else if (document.activeElement !== document.body) stableFocus = null;
    const focused = body.contains(document.activeElement) && (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement) ? document.activeElement : null;
    const focusField = focused?.dataset.historyField;
    const selection = focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement && focused.type === 'text' ? [focused.selectionStart, focused.selectionEnd] as const : null;
    setSaveStatus(status, statusKind);
    if (!snapshot) {
      body.innerHTML = `<p class="history-loading">${statusKind === 'error' ? 'Данные пока не прочитаны. Можно повторить чтение; текущая работа с грифом остаётся доступной.' : 'Загружаем настройки и историю этого браузера…'}</p>${statusKind === 'error' ? '<button class="secondary-button" type="button" data-history-action="refresh">Повторить чтение</button>' : ''}`;
      return;
    }
    container.querySelector<HTMLElement>('[data-history-count]')!.textContent = `${snapshot.history.length} записей · ${snapshot.presets.length} пресетов`;
    if (!drawer.open) { body.innerHTML = ''; return; }
    if (!derived || derived.history !== snapshot.history) derived = { history: snapshot.history, summary: getHistorySummary(snapshot.history), groups: reviewGroups() };
    const { summary, groups } = derived;
    const review = groups.find(group => group.key === reviewContextKey) ?? groups[0];
    reviewContextKey = review?.key ?? null;
    const reviewIds = review?.ids ?? [];
    const ordered = [...snapshot.history].filter(entry => filter === 'all' || entry.result.kind === filter).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
    const currentDraft = options.peekPracticeDraft();
    const savedDrafts = options.getPracticeDrafts?.() ?? [];
    if (!manualDraft && manualBpm === null && !manualNote && currentDraft.id && (currentDraft.durationMs > 0 || currentDraft.note)) {
      manualDraft = currentDraft; manualNote = currentDraft.note ?? ''; manualBpm = String(currentDraft.comfortableBpm);
    }
    if (manualDraft?.id) {
      const updated = savedDrafts.find(item => item.id === manualDraft?.id);
      if (updated) manualDraft = updated;
    }
    const draft = manualDraft ?? currentDraft;
    const draftChanged = manualDraft !== null && (currentDraft.available === false || draftKey(manualDraft) !== draftKey(currentDraft));
    const changedDraftNotice = draftChanged ? `<p class="history-notice status-notice" data-testid="manual-context-notice">Эта заметка относится к прежнему материалу. Черновик остаётся в списке; другое занятие открывается отдельно.</p><button class="text-button" type="button" data-history-action="use-current-draft"${currentDraft.available === false ? ' disabled' : ''}>Открыть текущее занятие</button>` : '';
    const manualInfo = `<p class="history-help" data-testid="manual-material">${escapeHtml(draft.label ?? (draft.material ? materialName(draft.material) : 'Практика с эталоном'))} · ${escapeHtml(contextName(draft.context))}</p><p class="history-help" data-testid="manual-draft-state">${manualDraft?.id ? 'Текст черновика сохраняется отдельно; кнопка записывает ручную отметку в историю. Новое время и текст не пропадут, если вводить их во время сохранения.' : 'Перед сохранением проверь материал и комфортный темп.'}</p>${changedDraftNotice}`;
    const draftPicker = savedDrafts.length ? `<section class="history-block practice-drafts"><label class="history-field"><span class="form-label">Черновики ручной практики</span><select class="form-control" aria-label="Черновики ручной практики" data-history-field="practiceDraft"><option value="">Текущее занятие</option>${savedDrafts.map(item => `<option value="${escapeHtml(item.id!)}"${item.id === manualDraft?.id ? ' selected' : ''}>${escapeHtml(item.label ?? materialName(item.material))} · ${escapeHtml(contextName(item.context))} · ${formatDuration(item.durationMs)}${item.createdAt ? ` · ${escapeHtml(formatDate(item.createdAt, item.timeZone))} (${escapeHtml(item.timeZone ?? 'местное время')})` : ''}${item.note ? ' · есть заметка' : ''}</option>`).join('')}</select></label><button class="text-button button-compact" type="button" data-history-action="delete-draft"${manualDraft?.id && !busy ? '' : ' disabled'}>Удалить выбранный черновик</button></section>` : '';
    const canSaveManual = draft.available !== false && (draft.material?.kind === 'rhythm' || Boolean(draft.context?.positionIds.length));
    const [manualMin, manualMax] = manualTempoBounds(draft.material);
    const currentManualBpm = manualBpm ?? String(Math.round(draft.comfortableBpm));
    container.querySelector<HTMLElement>('[data-history-count]')!.textContent = `${snapshot.history.length} записей · ${snapshot.presets.length} пресетов`;
    const view = captureView();
    body.innerHTML = `
      ${summary.earSessions ? `<p class="history-help" data-testid="ear-history-summary"><strong>Слух — отдельно:</strong> ${summary.earSessions} занятий · ${summary.earCompletedQuestions} завершённых вопросов · ${summary.earIndependentCorrect} самостоятельных ответов · ${summary.earErrors} ошибок · ${summary.earReplayCount} повторов прослушивания.</p>` : ''}
      ${summary.routeSessions ? `<p class="history-help" data-testid="route-history-summary"><strong>Маршруты:</strong> ${summary.routeSessions} · активный таймер ${formatDuration(summary.routeActiveMs)}. Это время запущенного таймера, без оценки игры или внимания.</p>` : ''}
      ${!options.isPersistent() ? '<p class="history-memory-notice" role="status">Работаем только в памяти этой страницы: изменения не переживут закрытие. Экспортируй копию, чтобы сохранить их отдельно.</p>' : ''}
      ${actionError ? `<p class="history-error status-error" data-testid="history-error" role="alert">${escapeHtml(actionError)}</p>` : ''}
      ${actionNotice ? `<p class="history-notice status-notice" data-testid="history-notice" role="status">${escapeHtml(actionNotice)}</p>` : ''}
      <div class="history-overview"><div><strong>${summary.screenSessions}</strong><span>Экранных занятий</span></div><div><strong>${summary.completedQuestions}</strong><span>Завершённых вопросов</span></div><div><strong>${summary.independentCorrect}</strong><span>Самостоятельных ответов</span></div><div><strong>${summary.errors}</strong><span>Ошибочных ответов</span></div><div><strong>${summary.manualSessions}</strong><span>Ручных отметок</span></div></div>
      <section class="history-block history-weak" aria-labelledby="weak-heading"><div><p class="eyebrow">ТОЧЕЧНОЕ ПОВТОРЕНИЕ</p><h3 id="weak-heading">Вернись к трудным позициям</h3><p>${reviewIds.length ? `${reviewIds.length} трудных позиций после ошибок, показа ответа или пропуска. Повтор содержит только эту выборку и сохраняет исходный контекст.` : 'Пока нет позиций для закрепления. Они появятся после ошибки, показа ответа или пропуска.'}</p>${review ? `<p class="history-help">${reviewReasons(review.entries)}</p>` : ''}${groups.length > 1 ? `<label class="history-field review-context-field"><span>Контекст повторения</span><select class="form-control" aria-label="Контекст повторения" data-history-field="reviewContext">${groups.map(group => `<option value="${escapeHtml(group.key)}"${group.key === reviewContextKey ? ' selected' : ''}>${escapeHtml(contextName(group.context))}</option>`).join('')}</select></label>` : review ? `<p>${escapeHtml(contextName(review.context))}</p>` : ''}<div class="weak-position-chips">${reviewIds.slice(0, 12).map(id => { const [string, fret] = id.split(':'); const position = getPosition(string as StringId, Number(fret)); return `<span>${escapeHtml(formatMidi(position.midi))}<small>${escapeHtml(string)}/${fret}</small></span>`; }).join('')}${reviewIds.length > 12 ? `<span>ещё ${reviewIds.length - 12}</span>` : ''}</div></div><button class="secondary-button" type="button" data-history-action="review-errors"${reviewIds.length === 0 || !options.onRepeatErrors || busy ? ' disabled' : ''}>Закрепить трудные позиции</button></section>
      ${draftPicker}${draft.available === false ? '<p class="history-help" data-testid="manual-unavailable">Начни практику под последовательность, метроном или ритм либо выбери сохранённый черновик.</p>' : ''}<section class="history-block" aria-labelledby="manual-heading"${draft.available === false ? ' hidden' : ''}><div class="history-block-heading"><div><p class="eyebrow">СВОЯ ОЦЕНКА ПРАКТИКИ</p><h3 id="manual-heading">Отметь комфортный темп</h3></div><span class="history-kind manual">Ручная отметка</span></div><p class="history-help">Темп и заметка — твоя оценка. Длительность берётся из проигрывателя эталона и не измеряет, сколько ты играл на басу.</p>${!canSaveManual ? '<p class="history-help" role="status">Выбери хотя бы одну струну и корректный диапазон. Без доступных позиций ручная отметка не сохраняется.</p>' : ''}${manualInfo}<div class="manual-form"><label class="history-field"><span class="form-label">Комфортный темп, BPM</span><input class="form-control" type="number" min="${manualMin}" max="${manualMax}" step="1" value="${escapeHtml(currentManualBpm)}" aria-label="Комфортный темп" aria-invalid="${!currentManualBpm || !Number.isInteger(Number(currentManualBpm)) || Number(currentManualBpm) < manualMin || Number(currentManualBpm) > manualMax}" data-history-field="manualBpm"></label><div class="manual-duration"><span>Время с эталоном</span><strong data-testid="manual-duration">${formatDuration(draft.durationMs)}</strong><small>${escapeHtml(contextName(draft.context))}</small></div></div><label class="history-field manual-note-field"><span class="form-label">Заметка</span><textarea class="form-control" maxlength="2000" rows="2" aria-label="Заметка к практике" data-history-field="manualNote" placeholder="Что получилось и что хочется повторить">${escapeHtml(manualNote)}</textarea></label><div class="history-form-actions"><button class="secondary-button" type="button" data-history-action="save-manual"${busy || !canSaveManual ? ' disabled' : ''}>Сохранить ручную отметку</button><button class="text-button" type="button" data-history-action="refresh-draft"${busy ? ' disabled' : ''}>Обновить время</button></div></section>
      <section class="history-block" aria-labelledby="presets-heading"><div class="history-block-heading"><div><p class="eyebrow">БЫСТРО ВЕРНУТЬСЯ К ЗАНЯТИЮ</p><h3 id="presets-heading">Сохранённые настройки</h3></div><span class="history-small-count">${snapshot.presets.length} пресетов</span></div><p class="history-help">Пресет открывает указанный раздел с его материалом и настройками. Тема оформления, введение, ответы и черновики в него не входят. Аудиофайлы при применении выбираются заново.</p><div class="preset-save-form"><label class="history-field"><span class="form-label">Название пресета</span><input class="form-control" type="text" maxlength="80" value="${escapeHtml(presetName)}" aria-label="Название пресета" data-history-field="presetName" placeholder="Например, A minor · первые пять ладов"${busy ? ' disabled' : ''}></label><button class="secondary-button" type="button" data-history-action="save-preset"${busy ? ' disabled' : ''}>Сохранить пресет</button></div><div class="preset-list" data-testid="preset-list">${snapshot.presets.length ? [...snapshot.presets].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(preset => `<article class="preset-card" data-preset-id="${escapeHtml(preset.id)}"><div><strong>${escapeHtml(preset.name)}</strong><p>${escapeHtml(presetDescription(preset.preferences))}</p><small>${escapeHtml(formatDate(preset.createdAt))}</small></div><div><button class="secondary-button" type="button" data-apply-preset="${escapeHtml(preset.id)}"${busy ? ' disabled' : ''}>Применить</button><button class="text-button button-compact" type="button" data-delete-preset="${escapeHtml(preset.id)}" aria-label="Удалить пресет ${escapeHtml(preset.name)}"${busy ? ' disabled' : ''}>Удалить</button></div></article>`).join('') : '<p class="history-empty">Сохрани удобную настройку, чтобы вернуться к ней одной кнопкой.</p>'}</div></section>
      <section class="history-block" aria-labelledby="history-heading"><div class="history-block-heading"><div><p class="eyebrow">ФАКТИЧЕСКИЕ РЕЗУЛЬТАТЫ</p><h3 id="history-heading">История занятий</h3></div><label class="history-filter"><span class="sr-only">Тип записей истории</span><select class="form-control form-control-compact" aria-label="Тип записей истории" data-history-field="filter"><option value="all"${filter === 'all' ? ' selected' : ''}>Все записи</option><option value="screen"${filter === 'screen' ? ' selected' : ''}>Экранные задания</option><option value="manual"${filter === 'manual' ? ' selected' : ''}>Ручные отметки</option><option value="ear"${filter === "ear" ? " selected" : ""}>Слух</option><option value="route"${filter === "route" ? " selected" : ""}>Маршруты</option></select></label></div><p class="history-help">Результаты хранят исходную тональность, область и способ оценки. Здесь нет общего «уровня басиста».</p><div class="history-entry-list" data-testid="history-list">${ordered.length ? ordered.slice(0, visibleEntries).map(entryMarkup).join('') : `<p class="history-empty">${filter === 'all' ? 'Записей пока нет. Закончи упражнение или сохрани ручную отметку.' : ({ screen: 'Экранных заданий', manual: 'Ручных отметок', ear: 'Слуховых занятий', route: 'Маршрутов' }[filter]) + ' пока нет. В других категориях записи могут быть.'}</p>`}</div>${ordered.length > visibleEntries ? '<button class="text-button" type="button" data-history-action="show-more">Показать ещё</button>' : ''}
      ${summary.groups.length ? `<details class="history-context-groups"><summary class="section-disclosure">Сводка по одинаковым условиям · ${summary.groups.length} групп</summary><p class="history-help">Время первого ответа сравнивается только внутри одинакового режима и музыкального контекста.</p><div class="history-table-scroll"><table><thead><tr><th>Контекст</th><th>Самостоятельно</th><th>Ошибки</th><th>Первый ответ, среднее</th></tr></thead><tbody>${summary.groups.map(group => `<tr><td>${escapeHtml(MODE_NAMES[group.mode] ?? group.mode)}<small>${escapeHtml(comparisonConditions(group))}</small><small>${escapeHtml(contextName(group.context))}</small></td><td>${group.independentCorrect} / ${group.completedQuestions}</td><td>${group.errors}</td><td>${group.meanFirstResponseMs === null ? '—' : `${(group.meanFirstResponseMs / 1000).toFixed(2)} с`}</td></tr>`).join('')}</tbody></table></div></details>` : ''}</section>
      <section class="history-block backup-block" aria-labelledby="backup-heading"><div class="history-block-heading"><div><p class="eyebrow">ПЕРЕНОСИМАЯ КОПИЯ</p><h3 id="backup-heading">Сохрани данные отдельно</h3></div><span class="history-backup-format">JSON · версия ${snapshot.schemaVersion}</span></div><p class="history-help">В копию входят настройки, профиль оформления и введения, пресеты, история и черновики ручной практики. Восстановление полностью заменяет эти данные; предварительный просмотр ничего не меняет.</p>${rawExportOffered() ? `<p class="history-help" data-testid="raw-export-help">${options.isPersistent() ? 'Часть записей базы не прочитана. Обычная копия их не содержит.' : 'База не открылась, обычная копия содержит только данные этой страницы.'} Сырой экспорт сохраняет содержимое базы браузера как есть, без проверки; восстановить из него можно только вручную.</p>` : ''}<div class="backup-actions"><button class="secondary-button" type="button" data-history-action="export"${busy ? ' disabled' : ''}>Экспортировать JSON</button>${rawExportOffered() ? `<button class="text-button" type="button" data-history-action="export-raw"${busy ? ' disabled' : ''}>Сырой экспорт базы</button>` : ''}<label class="backup-file-label secondary-button">Выбрать копию<input type="file" accept="application/json,.json" aria-label="Файл резервной копии" data-history-file${busy ? ' disabled' : ''}></label></div>${preview ? importPreviewMarkup() : ''}</section>
    `;
    restoreView(view);
    if (focusField) {
      const next = body.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-history-field="${focusField}"]`);
      if (next && !next.disabled) { next.focus({ preventScroll: true }); if (selection && (next instanceof HTMLTextAreaElement || next instanceof HTMLInputElement && next.type === 'text')) next.setSelectionRange(selection[0], selection[1]); }
    } else if (stableFocus) {
      const key = stableFocus;
      const next = [...body.querySelectorAll<HTMLElement>(`[${key.attribute}]`)].find(element => element.getAttribute(key.attribute) === key.value);
      if (next && !next.matches(':disabled')) next.focus({ preventScroll: true });
      else if (!busy) {
        const heading = body.querySelector<HTMLElement>(key.attribute === 'data-history-action' && ['refresh-draft', 'use-current-draft'].includes(key.value) ? '#manual-heading' : key.value === 'cancel-restore' ? '#backup-heading' : '#history-heading');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
        stableFocus = null;
      }
    }
  }

  function entryMarkup(entry: HistoryEntry): string {
    const result = entry.result;
    const date = formatDate(entry.occurredAt, entry.timeZone);
    const routeBadge = entry.routeRef ? `<p class="history-help">В маршруте · шаг ${{ fretboard: 'Гриф', ear: 'Слух', sequence: 'Практика' }[entry.routeRef.step]}</p>` : '';
    if (result.kind === 'route') {
      const total = result.actualStepMs.reduce((sum, value) => sum + value, 0);
      return `<article class="history-entry route-entry" data-history-entry="${escapeHtml(entry.id)}" data-history-kind="route"><header><span class="history-kind">Маршрут</span><time datetime="${escapeHtml(entry.occurredAt)}">${escapeHtml(date)}</time><button class="text-button button-compact" type="button" data-delete-history="${escapeHtml(entry.id)}" aria-label="Удалить маршрут от ${escapeHtml(date)}"${busy ? ' disabled' : ''}>Удалить</button></header>${routeBadge}<h4>Гриф → слух → практика</h4><p class="entry-facts">${result.status !== 'finished' ? 'Не завершено' : result.finishReason === 'completed' ? total < result.totalPlannedMs ? 'Завершён досрочно' : 'Маршрут пройден' : 'Остановлен'} · активный таймер ${formatDuration(total)} из ${formatDuration(result.totalPlannedMs)}</p><p class="history-help">Гриф: ${formatDuration(result.actualStepMs[0])} · слух: ${formatDuration(result.actualStepMs[1])} · практика: ${formatDuration(result.actualStepMs[2])}. Паузы и ожидание следующего блока исключены. Таймер не измеряет игру на инструменте.</p>${result.material ? routeMaterialMarkup(result.material) : '<p class="history-help">Прежний маршрут: материал не был сохранён.</p>'}${result.sessionLinks.length ? `<details class="route-linked-results"><summary class="section-disclosure">Результаты этого маршрута · ${result.sessionLinks.length}</summary><ul>${result.sessionLinks.map(link => `<li>${{ fretboard: 'Гриф', ear: 'Слух', sequence: 'Практика' }[link.step]} · ${{ screen: 'экранные ответы', ear: 'слуховая серия', manual: 'ручная отметка' }[link.kind]} ${snapshot?.history.some(item => item.id === link.id) ? `<button class="text-button" type="button" data-history-reveal="${escapeHtml(link.id)}">Открыть результат</button>` : '· запись удалена'}</li>`).join('')}</ul></details>` : ''}</article>`;
    }
    if (result.kind === 'ear') {
      const completed = result.questions.filter(question => question.outcome !== 'interrupted').length;
      const independent = result.questions.filter(question => question.independentCorrect).length;
      const errors = result.questions.reduce((total, question) => total + question.errors, 0);
      const replays = result.questions.reduce((total, question) => total + question.replayCount, 0);
      return `<article class="history-entry ear-entry" data-history-entry="${escapeHtml(entry.id)}" data-history-kind="ear"><header><span class="history-kind">Слух</span><time datetime="${escapeHtml(entry.occurredAt)}">${escapeHtml(date)}</time><button class="text-button button-compact" type="button" data-delete-history="${escapeHtml(entry.id)}" aria-label="Удалить слуховое занятие от ${escapeHtml(date)}"${busy ? ' disabled' : ''}>Удалить</button></header>${routeBadge}<h4>${escapeHtml(result.context.root)} · ${result.context.quality === 'major' ? 'Мажорное' : 'Минорное'} трезвучие</h4><p class="entry-facts">${completed < result.plannedCount ? '<strong>Не завершено</strong> · ' : ''}Завершено ${completed} из ${result.plannedCount} · самостоятельно ${independent} · ошибок ${errors} · повторов прослушивания ${replays}</p><p class="history-help">Это ответы на слух. Они не входят в точность экранных заданий и не оценивают игру на басу.</p><details class="history-question-details"><summary class="section-disclosure">Слуховые ответы и прослушивания · ${result.questions.length}</summary><ol>${result.questions.map(earQuestionMarkup).join('')}</ol></details></article>`;
    }
    if (result.kind === 'manual') return `<article class="history-entry manual-entry" data-history-entry="${escapeHtml(entry.id)}" data-history-kind="manual"><header><span class="history-kind manual">Ручная отметка</span><time datetime="${escapeHtml(entry.occurredAt)}">${escapeHtml(date)}</time><button class="text-button button-compact" type="button" data-delete-history="${escapeHtml(entry.id)}" aria-label="Удалить ручную отметку от ${escapeHtml(date)}"${busy ? ' disabled' : ''}>Удалить</button></header>${routeBadge}<h4>${result.comfortableBpm} BPM — комфортный темп</h4><p class="entry-context">${escapeHtml(materialName(result.material))}</p><p class="entry-context">${escapeHtml(contextName(result.context))}</p><p class="entry-facts">Время с эталоном: ${formatDuration(result.durationMs)} · Самооценка, не измерение точности игры</p>${result.material.kind === 'sequence' ? `<details class="route-material-details"><summary class="section-disclosure">Путь последовательности</summary><p>${escapeHtml(result.material.routePositionIds.map(id => id.replace(':', '/')).join(' → '))}</p></details>` : ''}${result.note ? `<p class="entry-note">${escapeHtml(result.note)}</p>` : ''}</article>`;
    const completed = result.questions.filter(question => question.outcome !== 'interrupted').length;
    const independent = result.questions.filter(question => question.independentCorrect).length;
    const errors = result.questions.reduce((total, question) => total + question.errors, 0);
    return `<article class="history-entry screen-entry" data-history-entry="${escapeHtml(entry.id)}" data-history-kind="screen"><header><span class="history-kind screen">Экранные задания</span><time datetime="${escapeHtml(entry.occurredAt)}">${escapeHtml(date)}</time><button class="text-button button-compact" type="button" data-delete-history="${escapeHtml(entry.id)}" aria-label="Удалить экранное занятие от ${escapeHtml(date)}"${busy ? ' disabled' : ''}>Удалить</button></header>${routeBadge}<h4>${escapeHtml(MODE_NAMES[result.mode] ?? result.mode)}</h4><p class="entry-context">${escapeHtml(contextName(result.context))}</p><p class="entry-facts">${completed < result.plannedCount ? `<strong>Не завершено</strong> · ` : ``}Завершено ${completed} из ${result.plannedCount} · самостоятельно ${independent} · ошибок ${errors}</p><details class="history-question-details"><summary class="section-disclosure">Ответы и попытки · ${result.questions.length}</summary><ol>${result.questions.map(question => screenQuestionMarkup(question, result.context, result.mode)).join('')}</ol></details></article>`;
  }

  function reviewGroups() {
    const groups = new Map<string, { key: string; context: QuestionContext; entries: HistoryEntry[]; ids: readonly string[] }>();
    for (const entry of [...(snapshot?.history ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
      if (entry.result.kind !== 'screen') continue;
      const context = entry.result.context;
      const key = JSON.stringify({ ...context, positionIds: [...context.positionIds].sort() });
      const existing = groups.get(key);
      if (existing) existing.entries.push(entry);
      else groups.set(key, { key, context, entries: [entry], ids: [] });
    }
    return [...groups.values()].map(group => ({ ...group, ids: getReviewPositionIds(group.entries) })).filter(group => group.ids.length > 0);
  }

  function importPreviewMarkup(): string {
    if (!preview) return '';
    return `<div class="backup-preview" data-testid="backup-preview"><h4 id="restore-preview-title" tabindex="-1">Проверь копию перед заменой</h4><p>${escapeHtml(pendingFilename)} · ${preview.presets} пресетов · ${preview.history} записей истории · ${preview.snapshot.practiceDrafts.length} черновиков · ${preview.snapshot.rhythmProjects.length} проектов ритма · тема: ${{ system: 'как в системе', light: 'светлая', dark: 'тёмная' }[preview.snapshot.profile.theme]}</p><p class="restore-warning">Копия заменит текущие настройки, профиль, пресеты, историю, черновики и проекты ритма. Будут заменены текущие проекты: ${snapshot?.rhythmProjects.length ?? 0}. Перед заменой можно скачать текущую копию.</p><label class="restore-confirm"><input type="checkbox" data-history-confirm${importConfirmed ? ' checked' : ''}${busy ? ' disabled' : ''}><span>Понимаю, что текущие данные будут заменены</span></label><div class="backup-actions"><button class="restore-button" type="button" data-history-action="confirm-restore"${!importConfirmed || busy ? ' disabled' : ''}>Заменить данные копией</button><button class="text-button" type="button" data-history-action="cancel-restore"${busy ? ' disabled' : ''}>Отменить импорт</button></div></div>`;
  }

  async function refresh(readOptions: { fresh?: boolean } = {}) {
    if (disposed) return;
    const version = ++refreshVersion;
    try {
      await options.waitForWrites();
      if (disposed || version !== refreshVersion) return;
      const next = await options.readConfirmed(readOptions);
      if (disposed || version !== refreshVersion) return;
      snapshot = next;
      if (status === 'Читаем локальные данные…') {
        status = options.isPersistent() ? 'Локальные данные прочитаны' : 'Только в памяти страницы';
        statusKind = options.isPersistent() ? 'saved' : 'memory';
      }
      render();
    } catch (failure) {
      if (disposed || version !== refreshVersion) return;
      setSaveStatus(`Ошибка чтения: ${failure instanceof Error ? failure.message : String(failure)}`, 'error');
      render();
    }
  }

  async function perform(operation: (onCommitted: () => void) => Promise<void>) {
    if (busy || disposed) return;
    busy = true;
    actionError = '';
    actionNotice = '';
    render();
    let committed = false;
    try { await operation(() => { committed = true; }); }
    catch (failure) {
      actionError = failure instanceof Error ? failure.message : String(failure);
      if (!committed) setSaveStatus('Ошибка сохранения — изменения не подтверждены', 'error');
    } finally {
      busy = false;
      await refresh();
      if (disposed) return;
      const editing = document.activeElement instanceof Element && document.activeElement.matches('[data-history-field="manualNote"], [data-history-field="manualBpm"]');
      if (actionError) {
        const invalid = body.querySelector<HTMLInputElement>('[aria-invalid="true"]');
        const alert = body.querySelector<HTMLElement>('[data-testid="history-error"]');
        const target = invalid ?? (!editing ? alert : null);
        if (target) {
          if (target === alert) target.tabIndex = -1;
          if (options.reveal) options.reveal(target);
          else { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
        }
      } else if (!editing && actionNotice && (document.activeElement === document.body || container.contains(document.activeElement))) { const confirmation = body.querySelector<HTMLElement>('[data-testid="history-notice"]'); if (confirmation) { confirmation.tabIndex = -1; confirmation.focus(); } }
    }
  }

  async function deleteWithConfirmation(kind: 'preset' | 'history', id: string, title: string, message: string) {
    const attribute = kind === 'preset' ? 'data-delete-preset' : 'data-delete-history';
    const buttons = [...body.querySelectorAll<HTMLButtonElement>(`[${attribute}]`)];
    const index = buttons.findIndex(button => button.getAttribute(attribute) === id);
    const neighbor = buttons[index + 1]?.getAttribute(attribute) ?? buttons[index - 1]?.getAttribute(attribute);
    if (!await confirmAction({ title: `Удалить: ${title}?`, message, confirmLabel: 'Удалить' }) || disposed) return;
    await perform(async () => {
      if (kind === 'preset') await options.deletePreset(id);
      else await options.deleteHistory(id);
      actionNotice = kind === 'preset' ? 'Пресет удалён.' : 'Запись истории удалена.';
    });
    const nextId = actionError ? id : neighbor;
    const next = nextId ? [...body.querySelectorAll<HTMLButtonElement>(`[${attribute}]`)].find(button => button.getAttribute(attribute) === nextId) : undefined;
    if (next) next.focus({ preventScroll: true });
    else { const heading = body.querySelector<HTMLElement>(kind === 'preset' ? '#presets-heading' : '#history-heading'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }
  }

  function rawExportOffered() { return Boolean(options.exportRaw) && (!options.isPersistent() || Boolean(options.getSkippedRecords?.().length)); }

  function download(json: string, prefix: string) {
    const blobUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    blobUrls.add(blobUrl);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = `${prefix}-${new Intl.DateTimeFormat('sv-SE').format(new Date())}.json`;
    anchor.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(blobUrl); blobUrls.delete(blobUrl); revokeTimers.delete(timer); }, 1000);
    revokeTimers.add(timer);
  }

  async function downloadBackup() {
    const { incomplete, json } = await options.exportConfirmed();
    download(json, 'bass-study-backup');
    actionNotice = incomplete
      ? 'Копия содержит подтверждённые данные. Несохранённые изменения в неё не вошли. Повтори сохранение.'
      : 'Копия подготовлена для скачивания. Проверь сохранённый файл.';
  }

  async function prepareFile(file: File) {
    const request = ++importIntent;
    preview = null; pendingFilename = ''; importConfirmed = false;
    actionError = ''; actionNotice = '';
    render();
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new RangeError(`Копия должна быть не больше ${MAX_BACKUP_BYTES / 1024 / 1024} МиБ.`);
      const json = await file.text();
      if (disposed || request !== importIntent) return;
      preview = options.prepareImport(json);
      pendingFilename = file.name;
      render();
      body.querySelector<HTMLElement>('#restore-preview-title')?.focus();
    } catch (failure) {
      if (disposed || request !== importIntent) return;
      actionError = `Ошибка чтения копии: ${failure instanceof Error ? failure.message : String(failure)}`;
      render();
    }
  }

  container.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
    if (input.dataset.historyField === 'presetName') presetName = input.value;
    if (input.dataset.historyField === 'manualBpm' || input.dataset.historyField === 'manualNote') {
      if (!manualDraft) captureDraft();
      const state = body.querySelector<HTMLElement>('[data-testid="manual-draft-state"]');
      if (state) state.textContent = 'Текст черновика сохраняется отдельно. Материал остаётся связан с исходным занятием.';
    }
    if (input.dataset.historyField === 'manualBpm') {
      manualBpm = input.value;
      const [min, max] = manualTempoBounds((manualDraft ?? options.peekPracticeDraft()).material);
      const bpm = Number(input.value);
      input.setAttribute('aria-invalid', String(!input.value || !Number.isInteger(bpm) || bpm < min || bpm > max));
    }
    if (input.dataset.historyField === 'manualNote') manualNote = input.value;
    if (input.dataset.historyField === 'manualBpm' || input.dataset.historyField === 'manualNote') {
      try { editDraft(); }
      catch (failure) { actionError = failure instanceof Error ? failure.message : String(failure); setSaveStatus(`Черновик не сохранён: ${actionError}`, 'error'); }
    }
  }, { signal: controller.signal });

  container.addEventListener('change', event => {
    const input = event.target;
    if (input instanceof HTMLSelectElement && input.dataset.historyField === 'practiceDraft') {
      const next = options.getPracticeDrafts?.().find(item => item.id === input.value);
      if (next) { manualDraft = next; manualNote = next.note ?? ''; manualBpm = String(next.comfortableBpm); }
      else { manualDraft = null; manualNote = ''; manualBpm = null; }
      render(); body.querySelector<HTMLElement>('[data-history-field="practiceDraft"]')?.focus(); return;
    }
    if (input instanceof HTMLSelectElement && input.dataset.historyField === 'filter') {
      filter = input.value as typeof filter;
      visibleEntries = 10;
      render();
      body.querySelector<HTMLElement>('[data-history-field="filter"]')?.focus();
    }
    if (input instanceof HTMLSelectElement && input.dataset.historyField === 'reviewContext') {
      reviewContextKey = input.value;
      render();
      body.querySelector<HTMLSelectElement>('[data-history-field="reviewContext"]')?.focus();
    }
    if (input instanceof HTMLInputElement && input.hasAttribute('data-history-confirm')) {
      importConfirmed = input.checked;
      const button = body.querySelector<HTMLButtonElement>('[data-history-action="confirm-restore"]');
      if (button) button.disabled = !importConfirmed || busy;
    }
    if (input instanceof HTMLInputElement && input.hasAttribute('data-history-file') && input.files?.[0] && !busy) void prepareFile(input.files[0]);
  }, { signal: controller.signal });

  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const linked = target?.closest<HTMLButtonElement>('[data-history-reveal]')?.dataset.historyReveal;
    if (linked && snapshot) {
      filter = 'all';
      const order = [...snapshot.history].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
      visibleEntries = Math.max(visibleEntries, order.findIndex(entry => entry.id === linked) + 1);
      render();
      const entry = [...body.querySelectorAll<HTMLElement>('[data-history-entry]')].find(item => item.dataset.historyEntry === linked);
      if (entry) { entry.tabIndex = -1; entry.focus({ preventScroll: true }); entry.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    const presetApply = target?.closest<HTMLButtonElement>('[data-apply-preset]')?.dataset.applyPreset;
    if (presetApply) {
      const preset = snapshot?.presets.find(item => item.id === presetApply);
      if (preset) void perform(async () => { await options.applyPreferences(preset.preferences, 'preset'); actionNotice = `Пресет «${preset.name}» применён.`; });
      return;
    }
    const presetDelete = target?.closest<HTMLButtonElement>('[data-delete-preset]')?.dataset.deletePreset;
    if (presetDelete && !busy) {
      const preset = snapshot?.presets.find(item => item.id === presetDelete);
      if (preset) void deleteWithConfirmation('preset', presetDelete, `Пресет «${preset.name}»`, `Будет удалён пресет «${preset.name}» от ${formatDate(preset.createdAt)}. Настройки текущего занятия сохранятся.`);
      return;
    }
    const historyDelete = target?.closest<HTMLButtonElement>('[data-delete-history]')?.dataset.deleteHistory;
    if (historyDelete && !busy) {
      const entry = snapshot?.history.find(item => item.id === historyDelete);
      if (entry) void deleteWithConfirmation('history', historyDelete, `Запись от ${formatDate(entry.occurredAt, entry.timeZone)}`, `Будет удалена ${entry.result.kind === 'manual' ? materialName(entry.result.material) : entry.result.kind === 'screen' ? MODE_NAMES[entry.result.mode] : entry.result.kind === 'ear' ? 'слуховая серия' : 'запись маршрута'} от ${formatDate(entry.occurredAt, entry.timeZone)}. Остальная история сохранится.`);
      return;
    }
    const action = target?.closest<HTMLButtonElement>('[data-history-action]')?.dataset.historyAction;
    if (!action || busy) return;
    if (action === 'refresh') { void refresh({ fresh: true }); return; }
    if (action === 'show-more') { visibleEntries += 10; render(); return; }
    if (action === 'refresh-draft') {
      const current = options.capturePracticeDraft(false);
      if (manualDraft && draftKey(manualDraft) !== draftKey(current)) actionNotice = 'Черновик относится к прежнему занятию. Сохрани его отдельно или явно отнеси заметку к текущему материалу.';
      else captureDraft();
      render(); return;
    }
    if (action === 'use-current-draft') { if (options.peekPracticeDraft().available === false) return; captureDraft(); actionNotice = 'Открыт черновик текущего занятия. Прежний черновик остаётся в списке.'; render(); return; }
    if (action === 'delete-draft') {
      const draft = manualDraft;
      if (draft?.id && options.deletePracticeDraft) void (async () => {
        if (!await confirmAction({ title: 'Удалить черновик?', message: `${draft.label ?? materialName(draft.material)}${draft.createdAt ? ` · ${formatDate(draft.createdAt, draft.timeZone)} (${draft.timeZone ?? 'местное время'})` : ''} · ${contextName(draft.context)}. Будут удалены его заметка и несохранённое время.`, confirmLabel: 'Удалить черновик' }) || disposed) return;
        await perform(async () => { await options.deletePracticeDraft!(draft.id!); manualDraft = null; manualNote = ''; manualBpm = null; actionNotice = 'Черновик удалён.'; });
      })();
      return;
    }
    if (action === 'cancel-restore') {
      ++importIntent; preview = null; pendingFilename = ''; importConfirmed = false; actionNotice = 'Импорт отменён. Данные не изменились.'; actionError = ''; render(); return;
    }
    if (action === 'review-errors') {
      const groups = reviewGroups();
      const review = groups.find(group => group.key === reviewContextKey) ?? groups[0];
      if (review?.ids.length) options.onRepeatErrors?.(review.ids, review.context);
      return;
    }
    void perform(async onCommitted => {
      if (action === 'save-preset') {
        const name = presetName.trim();
        if (!name) throw new RangeError('Дай пресету короткое понятное название.');
        const preset = { id: `preset-${crypto.randomUUID()}`, name, createdAt: new Date().toISOString(), preferences: options.getPreferences() };
        await options.savePreset(preset);
        presetName = '';
        actionNotice = 'Пресет сохранён.';
      } else if (action === 'save-manual') {
        const draft = manualDraft ?? captureDraft();
        if (draft.available === false) throw new Error('Начни практику или выбери сохранённый черновик.');
        const rawBpm = manualBpm ?? String(draft.comfortableBpm);
        const [min, max] = manualTempoBounds(draft.material);
        if (!rawBpm.trim()) throw new RangeError(`Укажи комфортный темп от ${min} до ${max} BPM.`);
        const bpm = Number(rawBpm);
        if (draft.id && options.savePracticeDraft) {
          const savedNote = manualNote;
          await options.savePracticeDraft(draft.id, savedNote, bpm);
          const current = options.getPracticeDrafts?.().find(item => item.id === draft.id);
          if (current) { manualDraft = current; manualNote = current.note ?? ''; manualBpm = String(current.comfortableBpm); }
          else { manualDraft = null; manualNote = ''; manualBpm = null; }
        } else {
          if (!draft.material) throw new Error('Начни практику или выбери сохранённый черновик.');
          const result = createManualPracticeResult({ context: draft.context, material: draft.material, comfortableBpm: bpm, durationMs: draft.durationMs, note: manualNote });
          const entry = makeManualHistory(result, { id: `manual-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, routeRef: draft.routeRef });
          await options.saveManual(entry);
          options.onManualSaved?.(draft.durationMs, draft.runtimeContextKey);
          manualNote = ''; manualBpm = null; manualDraft = null;
        }
        actionNotice = 'Ручная отметка сохранена отдельно от экранных результатов.';
      } else if (action === 'export') await downloadBackup();
      else if (action === 'export-raw' && options.exportRaw) {
        download(await options.exportRaw(), 'bass-study-raw');
        actionNotice = 'Сырой экспорт базы подготовлен. Это не резервная копия: восстановление из него выполняется вручную.';
      }
      else if (action === 'confirm-restore') {
        if (!preview || !importConfirmed) throw new Error('Сначала выбери копию и подтверди полную замену.');
        await options.restoreBackup(preview, () => {
          onCommitted();
          manualDraft = null; manualNote = ''; manualBpm = null;
          ++importIntent; preview = null; pendingFilename = ''; importConfirmed = false;
        });
        actionNotice = 'Данные восстановлены из копии; настройки применены.';
      }
    });
  }, { signal: controller.signal });

  render();
  return {
    refresh,
    updatePracticeContext() { if (!body.contains(document.activeElement)) render(); },
    commitEntry(entry: HistoryEntry) {
      if (disposed || !snapshot) return;
      const history = [...snapshot.history];
      const index = history.findIndex(item => item.id === entry.id);
      if (index === -1) history.push(entry); else history[index] = entry;
      snapshot = { ...snapshot, history };
      if (!body.contains(document.activeElement)) render();
      else container.querySelector<HTMLElement>('[data-history-count]')!.textContent = `${history.length} записей · ${snapshot.presets.length} пресетов`;
    },
    setSaveStatus,
    dispose() {
      disposed = true;
      refreshVersion++;
      controller.abort();
      revokeTimers.forEach(timer => clearTimeout(timer));
      blobUrls.forEach(url => URL.revokeObjectURL(url));
      container.innerHTML = '';
    },
  };
}
