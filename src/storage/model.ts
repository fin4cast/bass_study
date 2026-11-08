import { STRUCTURES, annotatePositions, createStructure, getPosition, parseNote, type LabelMode, type StringId, type StructureId } from '../music';
import {
  nextQuestion, revealAnswer, skipQuestion, startQuiz, submitAnswer,
  type AnswerEvent, type Question, type QuestionContext, type QuizAnswer, type QuizMode,
  type QuizResult, type QuizSession, type SequencePattern, type TrainingScope,
  INTERVAL_DEGREES, createIntervalTarget, type IntervalDegree,
} from '../training';
import { createManualPracticeResult, type ManualPracticeResult } from '../training/results';

export interface AppPreferences {
  readonly study: { readonly root: string; readonly structureId: StructureId; readonly labelMode: LabelMode; readonly strings: readonly StringId[]; readonly fretMin: number; readonly fretMax: number };
  readonly training: { readonly mode: 'study' | 'quiz' | 'sequence'; readonly quizMode: QuizMode; readonly scope: TrainingScope; readonly intervalDegree: IntervalDegree; readonly count: number; readonly pattern: SequencePattern; readonly sequenceScope: TrainingScope; readonly reviewPositionIds: readonly string[] };
  readonly player: {
    readonly bpm: number; readonly duration: 'quarter' | 'eighth' | 'sixteenth'; readonly repeat: 'once' | 'infinite' | 'ladder';
    readonly countIn: boolean; readonly showPulse: boolean; readonly from: number | null; readonly to: number | null;
    readonly ladderStart: number; readonly ladderEnd: number; readonly ladderStep: number; readonly ladderRepeats: number;
    readonly metronome: boolean; readonly metronomeMode: 'all' | 'two-four' | 'gap-2-2'; readonly subdivision: 'quarter' | 'eighth' | 'sixteenth';
    readonly bassVolume: number; readonly clickVolume: number;
  };
}
export interface Preset { readonly id: string; readonly name: string; readonly createdAt: string; readonly preferences: AppPreferences }
export interface HistoryMetadata { readonly id: string; readonly occurredAt: string; readonly timeZone: string }
export type StoredQuestion = Omit<QuizResult, 'kind' | 'mode' | 'context' | 'outcome'> & {
  readonly targetPositionId: string | null;
  readonly outcome: QuizResult['outcome'] | 'interrupted';
};
export interface ScreenHistoryResult {
  readonly kind: 'screen'; readonly source: 'screen-input'; readonly seed: number; readonly mode: QuizMode;
  readonly context: QuestionContext; readonly plannedCount: number; readonly questions: readonly StoredQuestion[];
}
interface HistoryEnvelope { readonly id: string; readonly occurredAt: string; readonly timeZone: string; readonly localDate: string }
export interface ScreenHistoryEntry extends HistoryEnvelope { readonly result: ScreenHistoryResult }
export interface ManualHistoryEntry extends HistoryEnvelope { readonly result: ManualPracticeResult }
export type HistoryEntry = ScreenHistoryEntry | ManualHistoryEntry;
export interface StudySnapshot {
  readonly format: 'bass-study-backup'; readonly schemaVersion: 2; readonly preferences: AppPreferences;
  readonly presets: readonly Preset[]; readonly history: readonly HistoryEntry[];
}

export class StudyStorageError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'StudyStorageError'; }
}
export const MAX_BACKUP_BYTES = 10_485_760;

const ROOT_IDS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const LEGACY_MODES = ['name-note', 'find-note', 'find-all', 'find-degree'] as const;
const MODES: readonly QuizMode[] = [...LEGACY_MODES, 'find-pitch', 'find-interval'];
const PATTERNS: readonly SequencePattern[] = ['ascending', 'descending', 'round-trip', 'groups-of-three'];
const SCOPES: readonly TrainingScope[] = ['structure', 'chromatic'];
const DURATIONS = ['quarter', 'eighth', 'sixteenth'];
const STRUCTURE_IDS = STRUCTURES.map(item => item.id);
type Data = Record<string, unknown>;

function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(immutable); Object.freeze(value);
  }
  return value;
}
function invalid(message: string): never { throw new StudyStorageError('INVALID_DATA', message); }
function object(value: unknown, keys: readonly string[], label: string): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label}: нужен обычный объект данных.`);
  const data = value as Data;
  const actual = Object.keys(data);
  if (Reflect.ownKeys(data).length !== actual.length || Object.values(Object.getOwnPropertyDescriptors(data)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) invalid(`${label}: допускаются только обычные JSON-поля.`);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(data, key))) invalid(`${label}: отсутствуют обязательные поля или присутствуют неизвестные.`);
  return data;
}
function text(value: unknown, label: string, max = 160, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.trim().length === 0)) invalid(`${label}: некорректная строка.`);
  return value;
}
function number(value: unknown, min: number, max: number, label: string, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(`${label}: число вне допустимого диапазона.`);
  return value;
}
function boolean(value: unknown, label: string): boolean { if (typeof value !== 'boolean') invalid(`${label}: требуется true или false.`); return value; }
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(`${label}: неизвестное значение.`);
  return value as T;
}
function array(value: unknown, max: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${label}: некорректный массив или превышен размер.`);
  const keys = Reflect.ownKeys(value);
  if (Object.getPrototypeOf(value) !== Array.prototype || keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')))) invalid(`${label}: допускается только плотный JSON-массив без дополнительных полей.`);
  return value;
}
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function utc(value: unknown, label: string): string {
  const result = text(value, label, 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) invalid(`${label}: требуется корректное UTC-время ISO с миллисекундами.`);
  return result;
}
export function originalLocalDate(occurredAt: string, timeZone: string): string {
  utc(occurredAt, 'Время занятия');
  text(timeZone, 'Часовой пояс', 100);
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(occurredAt));
    const part = (type: string) => parts.find(item => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { invalid('Неизвестный часовой пояс занятия.'); }
}

export const DEFAULT_PREFERENCES: AppPreferences = immutable({
  study: { root: 'A', structureId: 'minor-pentatonic', labelMode: 'notes', strings: ['G', 'D', 'A', 'E'], fretMin: 0, fretMax: 12 },
  training: { mode: 'study', quizMode: 'name-note', scope: 'structure', intervalDegree: '#4', count: 10, pattern: 'ascending', sequenceScope: 'structure', reviewPositionIds: [] },
  player: { bpm: 80, duration: 'eighth', repeat: 'once', countIn: true, showPulse: true, from: null, to: null,
    ladderStart: 60, ladderEnd: 100, ladderStep: 5, ladderRepeats: 2, metronome: true, metronomeMode: 'all', subdivision: 'quarter', bassVolume: 70, clickVolume: 50 },
});

function positionIds(value: unknown, label: string, allowEmpty: boolean): string[] {
  const ids = array(value, 100, label).map(item => {
    const id = text(item, label, 5);
    if (!/^[EADG]:(?:[0-9]|1[0-9]|2[0-4])$/.test(id)) invalid(`${label}: неизвестная струна или лад.`);
    return id;
  });
  if ((!allowEmpty && ids.length === 0) || new Set(ids).size !== ids.length) invalid(`${label}: список пуст или содержит повторения.`);
  return ids;
}
function position(id: string) { const [string, fret] = id.split(':'); return getPosition(string as StringId, Number(fret)); }

export function validatePreferences(value: unknown): AppPreferences {
  const data = object(value, ['study', 'training', 'player'], 'Настройки');
  const study = object(data.study, ['root', 'structureId', 'labelMode', 'strings', 'fretMin', 'fretMax'], 'Настройки грифа');
  const strings = array(study.strings, 4, 'Струны').map(item => oneOf(item, ['E', 'A', 'D', 'G'] as const, 'Струна'));
  if (new Set(strings).size !== strings.length) invalid('Струны не должны повторяться.');
  const fretMin = number(study.fretMin, 0, 24, 'Первый лад');
  const fretMax = number(study.fretMax, 0, 24, 'Последний лад');
  if (fretMin > fretMax) invalid('Первый лад больше последнего.');
  const training = object(data.training, ['mode', 'quizMode', 'scope', 'intervalDegree', 'count', 'pattern', 'sequenceScope', 'reviewPositionIds'], 'Настройки заданий');
  const quizMode = oneOf(training.quizMode, MODES, 'Тип задания');
  const scope = oneOf(training.scope, SCOPES, 'Область задания');
  if (quizMode === 'find-degree' && scope !== 'structure') invalid('Поиск ступени требует область «Ноты структуры».');
  if (quizMode === 'find-interval' && scope !== 'chromatic') invalid('Поиск произвольного интервала требует область «Все ноты».');
  const player = object(data.player, ['bpm', 'duration', 'repeat', 'countIn', 'showPulse', 'from', 'to', 'ladderStart', 'ladderEnd', 'ladderStep', 'ladderRepeats', 'metronome', 'metronomeMode', 'subdivision', 'bassVolume', 'clickVolume'], 'Настройки проигрывателя');
  const from = player.from === null ? null : number(player.from, 1, 10000, 'Начало фрагмента');
  const to = player.to === null ? null : number(player.to, 1, 10000, 'Конец фрагмента');
  if (from !== null && to !== null && from > to) invalid('Начало фрагмента позже конца.');
  const ladderStart = number(player.ladderStart, 40, 220, 'Начальный BPM');
  const ladderEnd = number(player.ladderEnd, 40, 220, 'Конечный BPM');
  if (ladderStart > ladderEnd) invalid('Конечный темп лестницы ниже начального.');
  return immutable({
    study: { root: oneOf(study.root, ROOT_IDS, 'Тоника'), structureId: oneOf(study.structureId, STRUCTURE_IDS, 'Структура'), labelMode: oneOf(study.labelMode, ['notes', 'degrees', 'hidden'] as const, 'Подписи'), strings, fretMin, fretMax },
    training: { mode: oneOf(training.mode, ['study', 'quiz', 'sequence'] as const, 'Режим занятия'), quizMode, scope, intervalDegree: oneOf(training.intervalDegree, INTERVAL_DEGREES, 'Интервал'),
      count: number(training.count, 1, 30, 'Число вопросов'), pattern: oneOf(training.pattern, PATTERNS, 'Порядок нот'), sequenceScope: oneOf(training.sequenceScope, SCOPES, 'Материал последовательности'), reviewPositionIds: positionIds(training.reviewPositionIds, 'Позиции для повторения', true) },
    player: { bpm: number(player.bpm, 40, 220, 'Темп'), duration: oneOf(player.duration, DURATIONS as readonly AppPreferences['player']['duration'][], 'Длительность'), repeat: oneOf(player.repeat, ['once', 'infinite', 'ladder'] as const, 'Повтор'),
      countIn: boolean(player.countIn, 'Отсчёт'), showPulse: boolean(player.showPulse, 'Визуальный пульс'), from, to, ladderStart, ladderEnd,
      ladderStep: number(player.ladderStep, 1, 180, 'Шаг темпа'), ladderRepeats: number(player.ladderRepeats, 1, 20, 'Повторов на темп'), metronome: boolean(player.metronome, 'Метроном'),
      metronomeMode: oneOf(player.metronomeMode, ['all', 'two-four', 'gap-2-2'] as const, 'Рисунок клика'), subdivision: oneOf(player.subdivision, DURATIONS as readonly AppPreferences['player']['subdivision'][], 'Деление клика'),
      bassVolume: number(player.bassVolume, 0, 100, 'Громкость баса'), clickVolume: number(player.clickVolume, 0, 100, 'Громкость клика') },
  });
}

function context(value: unknown): QuestionContext {
  const data = object(value, ['scope', 'root', 'structureId', 'positionIds'], 'Контекст занятия');
  const root = text(data.root, 'Тоника контекста', 32);
  const structureId = oneOf(data.structureId, STRUCTURE_IDS, 'Структура контекста');
  let normalizedRoot: string;
  try { normalizedRoot = createStructure(root, structureId).root; } catch { invalid('Некорректная тоника контекста.'); }
  return immutable({ scope: oneOf(data.scope, SCOPES, 'Область контекста'), root: normalizedRoot, structureId, positionIds: positionIds(data.positionIds, 'Позиции контекста', false) });
}

export function validatePreset(value: unknown): Preset {
  const data = object(value, ['id', 'name', 'createdAt', 'preferences'], 'Пресет');
  return immutable({ id: text(data.id, 'ID пресета', 120), name: text(data.name, 'Название пресета', 80).trim(), createdAt: utc(data.createdAt, 'Дата пресета'), preferences: validatePreferences(data.preferences) });
}

const LEGACY_QUESTION_KEYS = ['questionId', 'answerRule', 'target', 'targetPositionId', 'selectedPositionIds', 'attempts', 'errors', 'firstAnswer', 'firstResponseMs', 'completionMs', 'firstAttemptCorrect', 'hintUsed', 'skipped', 'independentCorrect', 'corrected', 'outcome', 'answerEvents'];
const QUESTION_KEYS = [...LEGACY_QUESTION_KEYS, 'targetMidi'];

function answerValue(value: unknown): QuizAnswer {
  if (typeof value === 'string') return text(value, 'Ответ', 160);
  return number(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'Ответ', false);
}

function validateScreenQuestion(value: unknown, mode: QuizMode, originalContext: QuestionContext): StoredQuestion {
  const raw = object(value, QUESTION_KEYS, 'Результат вопроса');
  const questionId = text(raw.questionId, 'ID вопроса', 160);
  const structure = createStructure(originalContext.root, originalContext.structureId);
  const allPositions = annotatePositions(originalContext.positionIds.map(position), structure);
  const eligible = allPositions.filter(item => originalContext.scope === 'chromatic' || item.inStructure);
  if (eligible.length === 0) invalid('В контексте нет доступных нот для задания.');
  const targetData = object(raw.target, ['pitchClass', 'name', 'degree'], 'Цель вопроса');
  const targetClass = number(targetData.pitchClass, 0, 11, 'Класс целевой ноты');
  const targetMidi = raw.targetMidi === null ? null : number(raw.targetMidi, 0, 127, 'Целевая высота');
  if (mode === 'find-pitch' ? targetMidi === null || targetMidi % 12 !== targetClass : targetMidi !== null) invalid('Целевая высота не соответствует режиму или классу ноты.');
  const candidates = eligible.filter(item => item.pitchClass === targetClass && (targetMidi === null || item.midi === targetMidi));
  if (candidates.length === 0) invalid('Целевая нота отсутствует в исходной области.');
  let targetName: string;
  try { targetName = parseNote(text(targetData.name, 'Имя целевой ноты', 32)).name; } catch { invalid('Некорректное имя целевой ноты.'); }
  const intervalDegree = mode === 'find-interval' ? oneOf(targetData.degree, INTERVAL_DEGREES, 'Интервал цели') : undefined;
  const interval = intervalDegree === undefined ? null : createIntervalTarget(originalContext.root, intervalDegree, allPositions);
  if (interval ? interval.target.name !== targetName || interval.target.pitchClass !== targetClass : targetName !== candidates[0].noteName || targetData.degree !== candidates[0].degree) invalid('Написание или ступень цели не соответствует исходному контексту.');
  const targetPositionId = raw.targetPositionId === null ? null : text(raw.targetPositionId, 'Позиция вопроса', 5);
  if (mode === 'name-note' ? !candidates.some(item => item.id === targetPositionId) : targetPositionId !== null) invalid('Позиция вопроса не соответствует режиму или целевой ноте.');
  const answerRule = mode === 'name-note' ? 'pitch-class' : mode === 'find-all' ? 'all-positions' : mode === 'find-pitch' ? 'exact-pitch' : 'any-position';
  if (raw.answerRule !== answerRule) invalid('Правило проверки не соответствует типу вопроса.');
  positionIds(raw.selectedPositionIds, 'Найденные позиции', true);
  const attempts = number(raw.attempts, 0, Number.MAX_SAFE_INTEGER, 'Число попыток');
  number(raw.errors, 0, attempts, 'Число ошибок');
  if (raw.firstAnswer !== null) answerValue(raw.firstAnswer);
  if (raw.firstResponseMs !== null) number(raw.firstResponseMs, 0, Number.MAX_SAFE_INTEGER, 'Первое время ответа', false);
  if (raw.firstAttemptCorrect !== null) boolean(raw.firstAttemptCorrect, 'Первый правильный ответ');
  for (const key of ['hintUsed', 'skipped', 'independentCorrect', 'corrected']) boolean(raw[key], key);
  const target = { pitchClass: targetClass, name: targetName, degree: intervalDegree ?? candidates[0].degree };
  let replay = startQuiz({ positions: allPositions, structure, scope: originalContext.scope, mode, seed: 0, intervalDegree }, 1);
  const question: Question = { ...replay.currentQuestion, id: questionId, context: originalContext, target, targetMidi,
    expectedPositionIds: candidates.map(item => item.id), ...(targetPositionId === null ? { targetPositionId: undefined } : { targetPositionId }) };
  replay = { ...replay, questions: [question], currentQuestion: question };
  const events = array(raw.answerEvents, Number.MAX_SAFE_INTEGER, 'Попытки ответа').map((item, index): AnswerEvent => {
    const event = object(item, ['answer', 'elapsedMs', 'correct'], 'Попытка ответа');
    const answer = answerValue(event.answer);
    const elapsedMs = number(event.elapsedMs, 0, Number.MAX_SAFE_INTEGER, 'Время ответа', false);
    const correct = boolean(event.correct, 'Правильность попытки');
    replay = submitAnswer(replay, answer, elapsedMs);
    if (replay.answerState.answerEvents.length !== index + 1 || replay.answerState.answerEvents[index].correct !== correct) invalid('Попытки содержат дубликат, лишний ответ или неверный признак правильности.');
    return { answer, elapsedMs, correct };
  });
  const outcome = oneOf(raw.outcome, ['correct', 'corrected', 'revealed', 'skipped', 'interrupted'] as const, 'Итог вопроса');
  const completionMs = raw.completionMs === null ? null : number(raw.completionMs, 0, Number.MAX_SAFE_INTEGER, 'Время завершения', false);
  if (outcome === 'revealed' || outcome === 'skipped') {
    if (completionMs === null || replay.status !== 'active') invalid('Показ или пропуск не соответствует состоянию ответов.');
    replay = outcome === 'revealed' ? revealAnswer(replay, completionMs) : skipQuestion(replay, completionMs);
  }
  let expected: Omit<StoredQuestion, 'targetPositionId'>;
  if (outcome === 'interrupted') {
    if (replay.status !== 'active' || replay.answerState.attempts === 0 || completionMs !== null) invalid('Прерванный вопрос должен содержать реальные незавершённые попытки.');
    const state = replay.answerState;
    expected = { questionId, target, targetMidi, answerRule, selectedPositionIds: state.selectedPositionIds,
      attempts: state.attempts, errors: state.errors, firstAnswer: state.firstAnswer, firstResponseMs: state.firstResponseMs,
      completionMs: null, firstAttemptCorrect: state.firstAttemptCorrect, hintUsed: false, skipped: false,
      independentCorrect: false, corrected: false, outcome: 'interrupted', answerEvents: events };
  } else {
    if (replay.status !== 'review') invalid('Завершённый вопрос не имеет полного правильного ответа, показа или пропуска.');
    const { kind: _kind, mode: _mode, context: _context, ...result } = nextQuestion(replay).results[0];
    expected = result;
  }
  for (const key of ['selectedPositionIds', 'attempts', 'errors', 'firstAnswer', 'firstResponseMs', 'completionMs', 'firstAttemptCorrect', 'hintUsed', 'skipped', 'independentCorrect', 'corrected', 'outcome'] as const) {
    if (!same(raw[key], expected[key])) invalid(`Поле результата ${key} не соответствует реальным попыткам.`);
  }
  return immutable({ ...expected, targetPositionId });
}

export function validateHistoryEntry(value: unknown): HistoryEntry {
  const raw = object(value, ['id', 'occurredAt', 'timeZone', 'localDate', 'result'], 'Запись истории');
  const id = text(raw.id, 'ID истории', 160);
  const occurredAt = utc(raw.occurredAt, 'Время занятия');
  const timeZone = text(raw.timeZone, 'Часовой пояс', 100);
  const localDate = originalLocalDate(occurredAt, timeZone);
  if (raw.localDate !== localDate) invalid('Дата занятия не соответствует исходному времени и часовому поясу.');
  if (!raw.result || typeof raw.result !== 'object' || Array.isArray(raw.result)) invalid('Отсутствует результат занятия.');
  const kindProperty = Object.getOwnPropertyDescriptor(raw.result, 'kind');
  if (!kindProperty || !Object.hasOwn(kindProperty, 'value')) invalid('Происхождение результата должно быть обычным JSON-полем.');
  const kind = kindProperty.value;
  const envelope = { id, occurredAt, timeZone, localDate };
  if (kind === 'manual') {
    const result = object(raw.result, ['kind', 'source', 'comfortableBpm', 'durationMs', 'note', 'context'], 'Ручная отметка');
    if (result.source !== 'self-report') invalid('Ручная отметка должна быть явно помечена как самооценка.');
    const manual = createManualPracticeResult({
      context: context(result.context), comfortableBpm: number(result.comfortableBpm, 40, 220, 'Комфортный темп'),
      durationMs: number(result.durationMs, 0, Number.MAX_SAFE_INTEGER, 'Длительность занятия', false), note: text(result.note, 'Заметка', 2000, true),
    });
    return immutable({ ...envelope, result: manual });
  }
  if (kind !== 'screen') invalid('Неизвестное происхождение результата.');
  const result = object(raw.result, ['kind', 'source', 'seed', 'mode', 'context', 'plannedCount', 'questions'], 'Экранное занятие');
  if (result.source !== 'screen-input') invalid('Экранный результат должен иметь источник screen-input.');
  const originalContext = context(result.context);
  const mode = oneOf(result.mode, MODES, 'Тип экранного задания');
  if (mode === 'find-degree' && originalContext.scope !== 'structure') invalid('Поиск ступени не может иметь хроматический контекст.');
  if (mode === 'find-interval' && originalContext.scope !== 'chromatic') invalid('Произвольный интервал требует хроматический контекст.');
  const plannedCount = number(result.plannedCount, 1, 100, 'Запланированные вопросы');
  const questions = array(result.questions, plannedCount, 'Результаты вопросов').map(item => validateScreenQuestion(item, mode, originalContext));
  if (questions.length === 0 || new Set(questions.map(item => item.questionId)).size !== questions.length) invalid('Экранная история пуста или содержит повторяющиеся вопросы.');
  if (questions.some((item, index) => item.outcome === 'interrupted' && index !== questions.length - 1)) invalid('Прерванным может быть только последний сохранённый вопрос.');
  return immutable({ ...envelope, result: { kind: 'screen', source: 'screen-input', seed: number(result.seed, 0, 0xffffffff, 'Seed'), mode, context: originalContext, plannedCount, questions } });
}

export function validateSnapshot(value: unknown): StudySnapshot {
  const raw = object(value, ['format', 'schemaVersion', 'preferences', 'presets', 'history'], 'Резервная копия');
  if (raw.format !== 'bass-study-backup') throw new StudyStorageError('UNSUPPORTED_FORMAT', 'Это не резервная копия bass_study.');
  if (raw.schemaVersion !== 2) throw new StudyStorageError('UNSUPPORTED_VERSION', 'Эта версия резервной копии не поддерживается. Данные не изменены.');
  // Import bytes are bounded by parseBackup; ordinary native writes must never make
  // an otherwise valid database unreadable merely by exceeding an arbitrary count.
  const presets = array(raw.presets, Number.MAX_SAFE_INTEGER, 'Пресеты').map(validatePreset);
  const history = array(raw.history, Number.MAX_SAFE_INTEGER, 'История').map(validateHistoryEntry);
  if (new Set(presets.map(item => item.id)).size !== presets.length || new Set(history.map(item => item.id)).size !== history.length) invalid('ID пресетов или истории повторяются.');
  const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return immutable({ format: 'bass-study-backup', schemaVersion: 2, preferences: validatePreferences(raw.preferences), presets: presets.sort(byId), history: history.sort(byId) });
}

/** Exact schema-1 records are validated before adding schema-2 defaults. */
export function migrateV1Preferences(value: unknown): AppPreferences {
  const data = object(value, ['study', 'training', 'player'], 'Настройки версии 1');
  const training = object(data.training, ['mode', 'quizMode', 'scope', 'count', 'pattern', 'sequenceScope', 'reviewPositionIds'], 'Настройки заданий версии 1');
  oneOf(training.quizMode, LEGACY_MODES, 'Тип задания версии 1');
  return validatePreferences({ ...data, training: { ...training, intervalDegree: '#4' } });
}

export function migrateV1Preset(value: unknown): Preset {
  const data = object(value, ['id', 'name', 'createdAt', 'preferences'], 'Пресет версии 1');
  return validatePreset({ ...data, preferences: migrateV1Preferences(data.preferences) });
}

export function migrateV1HistoryEntry(value: unknown): HistoryEntry {
  const data = object(value, ['id', 'occurredAt', 'timeZone', 'localDate', 'result'], 'История версии 1');
  if (!data.result || typeof data.result !== 'object') invalid('Отсутствует результат версии 1.');
  const kind = Object.getOwnPropertyDescriptor(data.result, 'kind');
  if (!kind || !Object.hasOwn(kind, 'value')) invalid('Происхождение результата версии 1 должно быть обычным JSON-полем.');
  if (kind.value === 'manual') return validateHistoryEntry(data);
  const result = object(data.result, ['kind', 'source', 'seed', 'mode', 'context', 'plannedCount', 'questions'], 'Экранное занятие версии 1');
  oneOf(result.mode, LEGACY_MODES, 'Тип задания версии 1');
  const questions = array(result.questions, 100, 'Вопросы версии 1').map(question => ({ ...object(question, LEGACY_QUESTION_KEYS, 'Вопрос версии 1'), targetMidi: null }));
  return validateHistoryEntry({ ...data, result: { ...result, questions } });
}

export function migrateBackup(value: unknown): StudySnapshot {
  const data = object(value, ['format', 'schemaVersion', 'preferences', 'presets', 'history'], 'Резервная копия');
  if (data.format !== 'bass-study-backup') throw new StudyStorageError('UNSUPPORTED_FORMAT', 'Это не резервная копия bass_study.');
  if (data.schemaVersion === 2) return validateSnapshot(data);
  if (data.schemaVersion !== 1) throw new StudyStorageError('UNSUPPORTED_VERSION', 'Эта версия резервной копии не поддерживается. Данные не изменены.');
  return validateSnapshot({ ...data, schemaVersion: 2, preferences: migrateV1Preferences(data.preferences),
    presets: array(data.presets, Number.MAX_SAFE_INTEGER, 'Пресеты версии 1').map(migrateV1Preset),
    history: array(data.history, Number.MAX_SAFE_INTEGER, 'История версии 1').map(migrateV1HistoryEntry) });
}

export function parseBackup(json: string): StudySnapshot {
  if (typeof json !== 'string' || json.length > MAX_BACKUP_BYTES || new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new StudyStorageError('INVALID_BACKUP', 'Нужен JSON-файл размером не более 10 МиБ.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new StudyStorageError('INVALID_BACKUP', 'Не удалось прочитать JSON резервной копии.'); }
  return migrateBackup(value);
}

export function emptySnapshot(): StudySnapshot { return validateSnapshot({ format: 'bass-study-backup', schemaVersion: 2, preferences: DEFAULT_PREFERENCES, presets: [], history: [] }); }

function envelope(metadata: HistoryMetadata) {
  return { id: metadata.id, occurredAt: metadata.occurredAt, timeZone: metadata.timeZone, localDate: originalLocalDate(metadata.occurredAt, metadata.timeZone) };
}

export function makeScreenHistory(session: QuizSession, metadata: HistoryMetadata): ScreenHistoryEntry | null {
  const results: Array<QuizResult | (Omit<QuizResult, 'outcome'> & { outcome: 'interrupted' })> = [...session.results];
  if (session.status === 'review') results.push(nextQuestion(session).results.at(-1)!);
  else if (session.status === 'active' && session.answerState.attempts > 0) {
    const answer = session.answerState;
    results.push({ kind: 'screen', questionId: session.currentQuestion.id, mode: session.currentQuestion.mode,
      context: session.currentQuestion.context, target: session.currentQuestion.target, targetMidi: session.currentQuestion.targetMidi, answerRule: session.currentQuestion.answerRule,
      selectedPositionIds: answer.selectedPositionIds, attempts: answer.attempts, errors: answer.errors, firstAnswer: answer.firstAnswer,
      firstResponseMs: answer.firstResponseMs, completionMs: null, firstAttemptCorrect: answer.firstAttemptCorrect,
      hintUsed: false, skipped: false, independentCorrect: false, corrected: false, outcome: 'interrupted', answerEvents: answer.answerEvents });
  }
  if (results.length === 0) return null;
  const originalContext = session.questions[0].context;
  const questions = results.map(result => {
    const question = session.questions.find(item => item.id === result.questionId);
    if (!question || !same(result.context, originalContext)) invalid('Результаты занятия имеют несовместимый исходный контекст.');
    const { kind: _kind, mode: _mode, context: _context, ...record } = result;
    return { ...record, targetPositionId: question.targetPositionId ?? null };
  });
  return validateHistoryEntry({ ...envelope(metadata), result: { kind: 'screen', source: 'screen-input', seed: session.seed,
    mode: session.questions[0].mode, context: originalContext, plannedCount: session.questions.length, questions } }) as ScreenHistoryEntry;
}

export function makeManualHistory(result: ManualPracticeResult, metadata: HistoryMetadata): ManualHistoryEntry {
  return validateHistoryEntry({ ...envelope(metadata), result }) as ManualHistoryEntry;
}

export interface HistoryGroupSummary {
  readonly key: string; readonly mode: QuizMode; readonly context: QuestionContext;
  readonly questions: number; readonly completedQuestions: number; readonly independentCorrect: number; readonly corrected: number;
  readonly errors: number; readonly hints: number; readonly skipped: number; readonly interrupted: number;
  readonly meanFirstResponseMs: number | null;
}

export function getHistorySummary(history: readonly HistoryEntry[]) {
  const groups = new Map<string, { mode: QuizMode; context: QuestionContext; questions: StoredQuestion[] }>();
  let screenSessions = 0; let manualSessions = 0; let manualDurationMs = 0;
  for (const entry of history) {
    if (entry.result.kind === 'manual') { manualSessions++; manualDurationMs += entry.result.durationMs; continue; }
    screenSessions++;
    const { context: area, mode, questions } = entry.result;
    const key = JSON.stringify([mode, area.scope, area.root, area.structureId, [...area.positionIds].sort()]);
    const group = groups.get(key) ?? { mode, context: area, questions: [] };
    group.questions.push(...questions); groups.set(key, group);
  }
  const summaries: HistoryGroupSummary[] = [...groups].map(([key, group]) => {
    const firstResponses = group.questions.map(item => item.firstResponseMs).filter((value): value is number => value !== null);
    return { key, mode: group.mode, context: group.context, questions: group.questions.length,
      completedQuestions: group.questions.filter(item => item.outcome !== 'interrupted').length,
      independentCorrect: group.questions.filter(item => item.independentCorrect).length,
      corrected: group.questions.filter(item => item.corrected).length,
      errors: group.questions.reduce((sum, item) => sum + item.errors, 0), hints: group.questions.filter(item => item.hintUsed).length,
      skipped: group.questions.filter(item => item.skipped).length, interrupted: group.questions.filter(item => item.outcome === 'interrupted').length,
      meanFirstResponseMs: firstResponses.length ? firstResponses.reduce((sum, value) => sum + value, 0) / firstResponses.length : null };
  });
  const total = (key: 'questions' | 'completedQuestions' | 'independentCorrect' | 'corrected' | 'errors' | 'hints' | 'skipped' | 'interrupted') => summaries.reduce((sum, group) => sum + group[key], 0);
  return immutable({ entries: history.length, screenSessions, manualSessions, manualDurationMs,
    questions: total('questions'), completedQuestions: total('completedQuestions'), independentCorrect: total('independentCorrect'),
    corrected: total('corrected'), errors: total('errors'), hints: total('hints'), skipped: total('skipped'), interrupted: total('interrupted'), groups: summaries });
}

export function getReviewPositionIds(history: readonly HistoryEntry[]): readonly string[] {
  const ids = new Set<string>();
  for (const entry of history) {
    if (entry.result.kind !== 'screen') continue;
    for (const question of entry.result.questions) {
      if (question.independentCorrect) continue;
      if (entry.result.mode === 'name-note') {
        if (question.targetPositionId) ids.add(question.targetPositionId);
      } else for (const id of entry.result.context.positionIds) if (question.targetMidi === null ? position(id).pitchClass === question.target.pitchClass : position(id).midi === question.targetMidi) ids.add(id);
    }
  }
  const order = ['E', 'A', 'D', 'G'];
  return Object.freeze([...ids].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) || Number(a.split(':')[1]) - Number(b.split(':')[1])));
}
