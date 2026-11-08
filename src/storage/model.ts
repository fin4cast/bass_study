import { STRUCTURES, annotatePositions, createStructure, getPosition, parseNote, type LabelMode, type StringId, type StructureId } from '../music';
import {
  nextQuestion, revealAnswer, skipQuestion, startQuiz, submitAnswer,
  type AnswerEvent, type Question, type QuestionContext, type QuizAnswer, type QuizMode,
  type QuizResult, type QuizSession, type SequencePattern, type TrainingScope,
  INTERVAL_DEGREES, createIntervalTarget, type IntervalDegree,
} from '../training';
import { createManualPracticeResult, type ManualPracticeResult } from '../training/results';
import { beginEarListen, cancelEarListen, collectEarResults, completeEarListen, createEarQuestion, revealEarAnswer, skipEarQuestion, startEarSession, submitEarAnswer,
  type EarDegree, type EarQuality, type EarSession, type SavedEarResult } from '../ear';
import { getRouteResult, replayRouteResult, type RouteEvent, type RouteResult } from '../route';
import { DEFAULT_HARMONY_PREFERENCES, type HarmonyPreferences } from '../harmony';
import { validateTracksManifest, type TracksManifest } from '../tracks';
import { validateMusicBankPreferences, type MusicBankPreferences } from '../music-bank/model';
import { createBoxSelection, getBoxInstance, validateBoxSelection as validateDomainBoxSelection, type BoxSelection } from '../music/boxes';
import type { StoredPracticeMaterial, PracticeMaterial } from '../training/results';
import { DEFAULT_PROFILE, type GlobalProfile, type PracticeDraft, type DrainDraftRequest } from './contracts';
export * from './contracts';
export type { PracticeMaterial, StoredPracticeMaterial } from '../training/results';
export type { RouteRef } from '../route';

export interface AppPreferences {
  readonly activeModule: 'foundation' | 'ear' | 'route' | 'harmony' | 'tracks' | 'input';
  readonly tracks: TracksManifest | null;
  readonly musicBank: MusicBankPreferences | null;
  readonly input: { readonly deviceId: string };
  readonly harmony: HarmonyPreferences;
  readonly ear: { readonly root: string; readonly quality: EarQuality; readonly count: number; readonly bpm: number };
  readonly study: { readonly root: string; readonly structureId: StructureId; readonly labelMode: LabelMode; readonly strings: readonly StringId[]; readonly fretMin: number; readonly fretMax: number; readonly box: BoxSelection | null; readonly showFingers: boolean };
  readonly training: { readonly mode: 'study' | 'quiz' | 'sequence'; readonly quizMode: QuizMode; readonly scope: TrainingScope; readonly intervalDegree: IntervalDegree; readonly count: number; readonly pattern: SequencePattern; readonly sequenceScope: TrainingScope; readonly reviewPositionIds: readonly string[]; readonly questionPolicy: 'random-v1' | 'triad-6-v1' | 'shape-6-v1' };
  readonly player: {
    readonly bpm: number; readonly duration: 'quarter' | 'eighth' | 'sixteenth'; readonly repeat: 'once' | 'infinite' | 'ladder';
    readonly countIn: boolean; readonly showPulse: boolean; readonly from: number | null; readonly to: number | null;
    readonly ladderStart: number; readonly ladderEnd: number; readonly ladderStep: number; readonly ladderRepeats: number;
    readonly metronome: boolean; readonly metronomeMode: 'all' | 'two-four' | 'gap-2-2'; readonly subdivision: 'quarter' | 'eighth' | 'sixteenth';
    readonly bassVolume: number; readonly clickVolume: number;
  };
}
export interface Preset { readonly id: string; readonly name: string; readonly createdAt: string; readonly preferences: AppPreferences }
export interface HistoryMetadata { readonly id: string; readonly occurredAt: string; readonly timeZone: string; readonly routeRef?: import('../route').RouteRef | null }
export type StoredQuestion = Omit<QuizResult, 'kind' | 'mode' | 'context' | 'outcome'> & {
  readonly targetPositionId: string | null;
  readonly outcome: QuizResult['outcome'] | 'interrupted';
};
export interface ScreenHistoryResult {
  readonly kind: 'screen'; readonly source: 'screen-input'; readonly seed: number; readonly mode: QuizMode;
  readonly context: QuestionContext; readonly plannedCount: number; readonly questions: readonly StoredQuestion[];
  readonly questionPolicy: 'random-v1' | 'triad-6-v1' | 'shape-6-v1';
}
interface HistoryEnvelope { readonly id: string; readonly occurredAt: string; readonly timeZone: string; readonly localDate: string; readonly routeRef: import('../route').RouteRef | null }
export interface ScreenHistoryEntry extends HistoryEnvelope { readonly result: ScreenHistoryResult }
export interface ManualHistoryEntry extends HistoryEnvelope { readonly result: ManualPracticeResult }
export interface EarHistoryResult {
  readonly kind: 'ear'; readonly source: 'audio-choice'; readonly context: { readonly root: string; readonly quality: EarQuality; readonly referenceMidi: number };
  readonly seed: number; readonly plannedCount: number; readonly questions: readonly SavedEarResult[];
}
export interface EarHistoryEntry extends HistoryEnvelope { readonly result: EarHistoryResult }
export interface RouteHistoryEntry extends HistoryEnvelope { readonly result: RouteResult }
export type HistoryEntry = ScreenHistoryEntry | ManualHistoryEntry | EarHistoryEntry | RouteHistoryEntry;
export interface StudySnapshot {
  readonly format: 'bass-study-backup'; readonly schemaVersion: 7; readonly preferences: AppPreferences;
  readonly profile: GlobalProfile; readonly practiceDrafts: readonly PracticeDraft[];
  readonly presets: readonly Preset[]; readonly history: readonly HistoryEntry[];
}

export class StudyStorageError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'StudyStorageError'; }
}
export const MAX_BACKUP_BYTES = 67_108_864;

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
function diagnosticFieldNames(names: readonly string[]): string {
  const shown = names.slice(0, 6).map(name => {
    const quoted = JSON.stringify(name).replace(/[\u202a-\u202e\u2066-\u2069]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return quoted.length > 66 ? `${quoted.slice(0, 64)}…"` : quoted;
  });
  return `${shown.join(', ')}${names.length > shown.length ? `, … (ещё ${names.length - shown.length})` : ''}`;
}
function recordContext<T>(label: string, operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (error instanceof StudyStorageError) throw new StudyStorageError(error.code, `${label}: ${error.message}`);
    throw error;
  }
}
function object(value: unknown, keys: readonly string[], label: string): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label}: нужен обычный объект данных.`);
  const data = value as Data;
  const actual = Object.keys(data);
  if (Reflect.ownKeys(data).length !== actual.length || Object.values(Object.getOwnPropertyDescriptors(data)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) invalid(`${label}: допускаются только обычные JSON-поля.`);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(data, key))) {
    const missing = keys.filter(key => !Object.hasOwn(data, key));
    const extra = actual.filter(key => !keys.includes(key));
    invalid(`${label}: отсутствуют обязательные поля или присутствуют неизвестные.${missing.length ? ` Отсутствуют: ${diagnosticFieldNames(missing)}.` : ''}${extra.length ? ` Неизвестные: ${diagnosticFieldNames(extra)}.` : ''}`);
  }
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
function validateBoxSelection(value: unknown): BoxSelection {
  object(value, ['version', 'shapeId', 'root', 'structureId', 'anchorFret', 'anchorString'], 'Учебная форма');
  return validateDomainBoxSelection(value);
}
function plainJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || seen.has(value)) invalid('Материал должен состоять из обычных JSON-данных без циклов.');
  seen.add(value);
  if (Array.isArray(value)) array(value, Number.MAX_SAFE_INTEGER, 'Данные материала').forEach(item => plainJson(item, seen));
  else { const data = object(value, Object.keys(value), 'Данные материала'); Object.values(data).forEach(item => plainJson(item, seen)); }
  seen.delete(value);
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || !a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => same(item, b[i]));
  const left = a as Data; const right = b as Data;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
}
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
  tracks: null, musicBank: null, input: { deviceId: '' },
  harmony: DEFAULT_HARMONY_PREFERENCES,
  activeModule: 'foundation', ear: { root: 'A', quality: 'minor', count: 10, bpm: 80 },
  study: { root: 'A', structureId: 'minor-pentatonic', labelMode: 'notes', strings: ['G', 'D', 'A', 'E'], fretMin: 0, fretMax: 12,
    box: createBoxSelection({ root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a', anchorString: 'E', anchorFret: 5 }), showFingers: false },
  training: { mode: 'study', quizMode: 'name-note', scope: 'structure', intervalDegree: '#4', count: 10, pattern: 'ascending', sequenceScope: 'structure', reviewPositionIds: [], questionPolicy: 'random-v1' },
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
  const data = object(value, ['activeModule', 'ear', 'harmony', 'tracks', 'musicBank', 'input', 'study', 'training', 'player'], 'Настройки');
  const input = object(data.input, ['deviceId'], 'Настройки аудиовхода');
  let tracks: TracksManifest | null = null;
  if (data.tracks !== null) {
    try { tracks = validateTracksManifest(data.tracks); }
    catch (failure) { invalid(`Настройки дорожек: ${failure instanceof Error ? failure.message : String(failure)}`); }
  }
  let musicBank: MusicBankPreferences | null = null;
  if (data.musicBank !== null) {
    try { musicBank = validateMusicBankPreferences(data.musicBank); }
    catch (failure) { invalid(`Настройки раздела «Табулатура и ноты»: ${failure instanceof Error ? failure.message : String(failure)}`); }
  }
  const ear = object(data.ear, ['root', 'quality', 'count', 'bpm'], 'Настройки слуха');
  const harmony = object(data.harmony, ['bpm', 'countIn', 'repeat', 'bassVolume', 'padVolume', 'clickVolume', 'bassMuted', 'padMuted', 'clickMuted'], 'Настройки сопровождения');
  const study = object(data.study, ['root', 'structureId', 'labelMode', 'strings', 'fretMin', 'fretMax', 'box', 'showFingers'], 'Настройки грифа');
  const box = study.box === null ? null : validateBoxSelection(study.box);
  if (box && (parseNote(box.root).name !== parseNote(String(study.root)).name || box.structureId !== study.structureId)) invalid('Бокс не соответствует тонике или структуре.');
  const strings = array(study.strings, 4, 'Струны').map(item => oneOf(item, ['E', 'A', 'D', 'G'] as const, 'Струна'));
  if (new Set(strings).size !== strings.length) invalid('Струны не должны повторяться.');
  const fretMin = number(study.fretMin, 0, 24, 'Первый лад');
  const fretMax = number(study.fretMax, 0, 24, 'Последний лад');
  if (fretMin > fretMax) invalid('Первый лад больше последнего.');
  const training = object(data.training, ['mode', 'quizMode', 'scope', 'intervalDegree', 'count', 'pattern', 'sequenceScope', 'reviewPositionIds', 'questionPolicy'], 'Настройки заданий');
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
    activeModule: oneOf(data.activeModule, ['foundation', 'ear', 'route', 'harmony', 'tracks', 'input'] as const, 'Раздел'),
    tracks, musicBank, input: { deviceId: text(input.deviceId, 'Устройство аудиовхода', 2048, true) },
    harmony: { bpm: number(harmony.bpm, 40, 220, 'Темп сопровождения'), countIn: boolean(harmony.countIn, 'Отсчёт сопровождения'), repeat: oneOf(harmony.repeat, ['once', 'infinite'] as const, 'Повтор сопровождения'),
      bassVolume: number(harmony.bassVolume, 0, 100, 'Громкость басового рисунка'), padVolume: number(harmony.padVolume, 0, 100, 'Громкость гармонии'), clickVolume: number(harmony.clickVolume, 0, 100, 'Громкость клика сопровождения'),
      bassMuted: boolean(harmony.bassMuted, 'Отключение басового рисунка'), padMuted: boolean(harmony.padMuted, 'Отключение гармонии'), clickMuted: boolean(harmony.clickMuted, 'Отключение клика сопровождения') },
    ear: { root: oneOf(ear.root, ROOT_IDS, 'Тоника слухового задания'), quality: oneOf(ear.quality, ['major', 'minor'] as const, 'Трезвучие слухового задания'), count: number(ear.count, 1, 20, 'Число слуховых вопросов'), bpm: number(ear.bpm, 60, 120, 'Темп слухового задания') },
    study: { root: oneOf(study.root, ROOT_IDS, 'Тоника'), structureId: oneOf(study.structureId, STRUCTURE_IDS, 'Структура'), labelMode: oneOf(study.labelMode, ['notes', 'degrees', 'hidden'] as const, 'Подписи'), strings, fretMin, fretMax, box, showFingers: boolean(study.showFingers, 'Показывать пальцы') },
    training: { mode: oneOf(training.mode, ['study', 'quiz', 'sequence'] as const, 'Режим занятия'), quizMode, scope, intervalDegree: oneOf(training.intervalDegree, INTERVAL_DEGREES, 'Интервал'),
      count: number(training.count, 1, 30, 'Число вопросов'), pattern: oneOf(training.pattern, PATTERNS, 'Порядок нот'), sequenceScope: oneOf(training.sequenceScope, SCOPES, 'Материал последовательности'), reviewPositionIds: positionIds(training.reviewPositionIds, 'Позиции для повторения', true), questionPolicy: oneOf(training.questionPolicy, ['random-v1', 'triad-6-v1', 'shape-6-v1'] as const, 'Политика вопросов') },
    player: { bpm: number(player.bpm, 40, 220, 'Темп'), duration: oneOf(player.duration, DURATIONS as readonly AppPreferences['player']['duration'][], 'Длительность'), repeat: oneOf(player.repeat, ['once', 'infinite', 'ladder'] as const, 'Повтор'),
      countIn: boolean(player.countIn, 'Отсчёт'), showPulse: boolean(player.showPulse, 'Визуальный пульс'), from, to, ladderStart, ladderEnd,
      ladderStep: number(player.ladderStep, 1, 180, 'Шаг темпа'), ladderRepeats: number(player.ladderRepeats, 1, 20, 'Повторов на темп'), metronome: boolean(player.metronome, 'Метроном'),
      metronomeMode: oneOf(player.metronomeMode, ['all', 'two-four', 'gap-2-2'] as const, 'Рисунок клика'), subdivision: oneOf(player.subdivision, DURATIONS as readonly AppPreferences['player']['subdivision'][], 'Деление клика'),
      bassVolume: number(player.bassVolume, 0, 100, 'Громкость баса'), clickVolume: number(player.clickVolume, 0, 100, 'Громкость клика') },
  });
}

export function validateQuestionContext(value: unknown): QuestionContext {
  const hasBox = value !== null && typeof value === 'object' && Object.hasOwn(value, 'box');
  const data = object(value, ['scope', 'root', 'structureId', 'positionIds', ...(hasBox ? ['box'] : [])], 'Контекст занятия');
  const root = text(data.root, 'Тоника контекста', 32);
  const structureId = oneOf(data.structureId, STRUCTURE_IDS, 'Структура контекста');
  let normalizedRoot: string;
  try { normalizedRoot = createStructure(root, structureId).root; } catch { invalid('Некорректная тоника контекста.'); }
  const box = !hasBox || data.box === null ? null : validateBoxSelection(data.box);
  if (box && (parseNote(box.root).pitchClass !== parseNote(normalizedRoot).pitchClass || box.structureId !== structureId)) invalid('Бокс исходного контекста не соответствует материалу.');
  const ids = positionIds(data.positionIds, 'Позиции контекста', false);
  if (box) { const expected = getBoxInstance(box).referencePositionIds; if (ids.length !== expected.length || expected.some(id => !ids.includes(id))) invalid('Контекст должен содержать точное множество позиций выбранной формы.'); }
  return immutable({ scope: oneOf(data.scope, SCOPES, 'Область контекста'), root: normalizedRoot, structureId, positionIds: ids, ...(hasBox ? { box } : {}) });
}
const context = validateQuestionContext;
function legacyContext(value: unknown): QuestionContext {
  object(value, ['scope', 'root', 'structureId', 'positionIds'], 'Контекст старого занятия');
  return context(value);
}

export function validateProfile(value: unknown): GlobalProfile {
  const data = object(value, ['theme', 'onboarding'], 'Профиль интерфейса');
  const onboarding = object(data.onboarding, ['version', 'choice', 'completed'], 'Введение');
  if (onboarding.version !== 1) invalid('Неизвестная версия введения.');
  const choice = onboarding.choice === null ? null : oneOf(onboarding.choice, ['guided', 'free'] as const, 'Первое занятие');
  const completed = boolean(onboarding.completed, 'Введение завершено');
  if (completed && choice === null) invalid('Завершённое введение требует выбранного сценария.');
  return immutable({ theme: oneOf(data.theme, ['system', 'light', 'dark'] as const, 'Тема'), onboarding: { version: 1, choice, completed } });
}

export function validateRouteRef(value: unknown): import('../route').RouteRef | null {
  if (value === null) return null;
  const data = object(value, ['routeId', 'step'], 'Связь с маршрутом');
  return immutable({ routeId: text(data.routeId, 'ID маршрута', 160), step: oneOf(data.step, ['fretboard', 'ear', 'sequence'] as const, 'Блок маршрута') });
}

export function validatePracticeMaterial(value: unknown, area?: QuestionContext, allowLegacy = false): StoredPracticeMaterial {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Отсутствует материал практики.');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid('Вид материала должен быть обычным полем.');
  const kind = descriptor.value;
  if (kind === 'legacy-unknown') { object(value, ['kind'], 'Старый материал'); if (!allowLegacy) invalid('Новый черновик требует известного материала.'); return immutable({ kind }); }
  if (kind === 'harmony') {
    const data = object(value, ['kind', 'patternId'], 'Сопровождение');
    if (data.patternId !== 'CFGC-1-3-5-3-v1') invalid('Неизвестный рисунок сопровождения.');
    if (area && (parseNote(area.root).pitchClass !== 0 || area.structureId !== 'major')) invalid('Сопровождение C–F–G–C требует контекст C major.');
    return immutable({ kind, patternId: 'CFGC-1-3-5-3-v1' });
  }
  if (kind !== 'sequence' && kind !== 'fretboard') invalid('Неизвестный материал практики.');
  const data = object(value, kind === 'fretboard' ? ['kind', 'box'] : ['kind', 'pattern', 'routePositionIds', 'duration', 'fragment', 'box'], 'Материал грифа');
  const box = data.box === null ? null : validateBoxSelection(data.box);
  if (box && area && (box.structureId !== area.structureId || parseNote(box.root).pitchClass !== parseNote(area.root).pitchClass)) invalid('Бокс практики не соответствует контексту.');
  if (area && !same(box, area.box ?? null)) invalid('Форма материала и исходного контекста должны совпадать.');
  if (kind === 'fretboard') return immutable({ kind, box });
  const routePositionIds = array(data.routePositionIds, 10000, 'Маршрут нот').map(id => positionIds([id], 'Позиция маршрута', false)[0]);
  if (!routePositionIds.length || area && routePositionIds.some(id => !area.positionIds.includes(id))) invalid('Маршрут выходит за исходную область или пуст.');
  const fragment = object(data.fragment, ['from', 'toExclusive'], 'Фрагмент последовательности');
  const from = number(fragment.from, 0, routePositionIds.length - 1, 'Начало последовательности');
  const toExclusive = number(fragment.toExclusive, 1, routePositionIds.length, 'Конец последовательности');
  if (from >= toExclusive) invalid('Фрагмент последовательности пуст.');
  return immutable({ kind, box, pattern: oneOf(data.pattern, PATTERNS, 'Порядок практики'), routePositionIds,
    duration: oneOf(data.duration, DURATIONS as readonly ('quarter' | 'eighth' | 'sixteenth')[], 'Длительность практики'), fragment: { from, toExclusive } });
}

export function validatePracticeDraft(value: unknown): PracticeDraft {
  const data = object(value, ['id', 'createdAt', 'updatedAt', 'timeZone', 'localDate', 'context', 'material', 'routeRef', 'totalReferenceMs', 'recordedThroughMs', 'suggestedBpm', 'comfortableBpm', 'note', 'editRevision'], 'Черновик практики');
  const createdAt = utc(data.createdAt, 'Начало черновика');
  const timeZone = text(data.timeZone, 'Часовой пояс черновика', 100);
  const localDate = originalLocalDate(createdAt, timeZone);
  if (data.localDate !== localDate) invalid('Локальная дата черновика не соответствует исходному поясу.');
  const area = context(data.context);
  const totalReferenceMs = number(data.totalReferenceMs, 0, Number.MAX_SAFE_INTEGER, 'Накопленное время', false);
  const recordedThroughMs = number(data.recordedThroughMs, 0, totalReferenceMs, 'Сохранённое время', false);
  const material = validatePracticeMaterial(data.material, area) as PracticeMaterial;
  if (material.kind === 'fretboard' && totalReferenceMs !== 0) invalid('Изучение грифа не измеряет время проигрывания эталона.');
  return immutable({ id: text(data.id, 'ID черновика', 160), createdAt, updatedAt: utc(data.updatedAt, 'Обновление черновика'), timeZone, localDate,
    context: area, material, routeRef: validateRouteRef(data.routeRef), totalReferenceMs, recordedThroughMs,
    suggestedBpm: number(data.suggestedBpm, 40, 220, 'Предлагаемый темп'), comfortableBpm: number(data.comfortableBpm, 40, 220, 'Комфортный темп'), note: text(data.note, 'Заметка', 2000, true), editRevision: number(data.editRevision, 0, Number.MAX_SAFE_INTEGER, 'Версия заметки') });
}

/** Merge only monotonic progress/newer edits; stale checkpoints cannot undo a drain. */
export function mergePracticeDraft(current: PracticeDraft | undefined, incoming: PracticeDraft): PracticeDraft {
  if (!current) return incoming;
  if (!same(current.context, incoming.context) || !same(current.material, incoming.material) || !same(current.routeRef, incoming.routeRef) || current.createdAt !== incoming.createdAt || current.timeZone !== incoming.timeZone) invalid('Исходный материал черновика неизменяем.');
  const newerText = incoming.editRevision > current.editRevision;
  return validatePracticeDraft({ ...current, totalReferenceMs: Math.max(current.totalReferenceMs, incoming.totalReferenceMs),
    recordedThroughMs: current.recordedThroughMs, suggestedBpm: incoming.suggestedBpm, updatedAt: incoming.updatedAt,
    ...(newerText ? { note: incoming.note, comfortableBpm: incoming.comfortableBpm, editRevision: incoming.editRevision } : {}) });
}

export function validatePreset(value: unknown): Preset {
  const data = object(value, ['id', 'name', 'createdAt', 'preferences'], 'Пресет');
  return immutable({ id: text(data.id, 'ID пресета', 120), name: text(data.name, 'Название пресета', 80).trim(), createdAt: utc(data.createdAt, 'Дата пресета'), preferences: recordContext('Настройки пресета', () => validatePreferences(data.preferences)) });
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

const EAR_QUESTION_KEYS = ['id', 'seed', 'root', 'quality', 'referenceMidi', 'targetMidi', 'targetDegree', 'targetName', 'choices'];
const EAR_RESULT_KEYS = ['kind', 'source', 'question', 'listensStarted', 'listensCompleted', 'listensCancelled', 'replayCount', 'listenEvents', 'answerEvents', 'attempts', 'errors', 'firstAnswer', 'firstResponseMs', 'firstAttemptCorrect', 'independentCorrect', 'corrected', 'hintUsed', 'skipped', 'outcome', 'closedAtMs', 'completionAfterListenMs'];

function validateEarResult(value: unknown, root: string, quality: EarQuality, referenceMidi: number): SavedEarResult {
  const raw = object(value, EAR_RESULT_KEYS, 'Результат слухового вопроса');
  if (raw.kind !== 'ear' || raw.source !== 'audio-choice') invalid('Неверное происхождение слухового результата.');
  const questionData = object(raw.question, EAR_QUESTION_KEYS, 'Слуховой вопрос');
  const question = createEarQuestion({ root, quality, referenceMidi, seed: number(questionData.seed, 0, 0xffffffff, 'Seed слухового вопроса') });
  array(questionData.choices, 3, 'Варианты слухового ответа').forEach(choice => object(choice, ['id', 'label'], 'Вариант слухового ответа'));
  if (!same(questionData, question)) invalid('Слуховая цель, написание, октава или варианты не соответствуют исходному вопросу.');
  let replay = startEarSession({ root, quality, referenceMidi, count: 1, seed: 0 });
  replay = { ...replay, currentQuestion: question, questions: [question] };
  const listens = array(raw.listenEvents, Number.MAX_SAFE_INTEGER, 'Прослушивания').map(item => {
    if (!item || typeof item !== 'object') invalid('Некорректное событие прослушивания.');
    const descriptor = Object.getOwnPropertyDescriptor(item, 'type');
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid('Тип события прослушивания должен быть обычным полем.');
    const type = oneOf(descriptor.value, ['start', 'complete', 'cancel'] as const, 'Событие прослушивания');
    const event = object(item, type === 'start' ? ['type', 'listenId', 'atMs', 'order', 'bpm'] : ['type', 'listenId', 'atMs', 'order'], 'Событие прослушивания');
    return { category: 'listen' as const, type, listenId: text(event.listenId, 'ID прослушивания', 160), atMs: number(event.atMs, 0, Number.MAX_SAFE_INTEGER, 'Время прослушивания', false), order: number(event.order, 1, Number.MAX_SAFE_INTEGER, 'Порядок события'), bpm: type === 'start' ? number(event.bpm, 60, 120, 'Темп прослушивания') : undefined };
  });
  const answers = array(raw.answerEvents, Number.MAX_SAFE_INTEGER, 'Слуховые ответы').map(item => {
    const event = object(item, ['degree', 'atMs', 'correct', 'order'], 'Слуховой ответ');
    return { category: 'answer' as const, degree: oneOf(event.degree, question.choices.map(choice => choice.id), 'Ответ ступенью'),
      atMs: number(event.atMs, 0, Number.MAX_SAFE_INTEGER, 'Время слухового ответа', false), correct: boolean(event.correct, 'Правильность слухового ответа'), order: number(event.order, 1, Number.MAX_SAFE_INTEGER, 'Порядок события') };
  });
  const timeline = [...listens, ...answers].sort((a, b) => a.order - b.order);
  timeline.forEach((event, index) => {
    if (event.order !== index + 1) invalid('Слуховые события должны иметь уникальный непрерывный порядок.');
    if (event.category === 'answer') replay = submitEarAnswer(replay, event.degree, event.atMs);
    else if (event.type === 'start') {
      replay = beginEarListen(replay, event.atMs, event.bpm);
      if (replay.answerState.activeListen?.id !== event.listenId) invalid('ID начатого прослушивания не соответствует вопросу.');
    } else replay = event.type === 'complete' ? completeEarListen(replay, event.atMs, event.listenId) : cancelEarListen(replay, event.atMs, event.listenId);
  });
  const outcome = oneOf(raw.outcome, ['correct', 'corrected', 'revealed', 'skipped', 'interrupted'] as const, 'Итог слухового вопроса');
  if (outcome === 'revealed' || outcome === 'skipped') {
    const closedAtMs = number(raw.closedAtMs, 0, Number.MAX_SAFE_INTEGER, 'Закрытие слухового вопроса', false);
    replay = outcome === 'revealed' ? revealEarAnswer(replay, closedAtMs) : skipEarQuestion(replay, closedAtMs);
  }
  const expected = collectEarResults(replay)[0];
  if (!expected || !same(raw, expected)) invalid('Показатели слухового результата не соответствуют реальным прослушиваниям и ответам.');
  return expected;
}

function validateEarHistory(value: unknown, legacy = false): EarHistoryResult {
  const raw = object(value, ['kind', 'source', 'context', 'seed', 'plannedCount', 'questions'], 'Слуховое занятие');
  if (raw.kind !== 'ear' || raw.source !== 'audio-choice') invalid('Неверное происхождение слухового занятия.');
  const area = object(raw.context, ['root', 'quality', ...(legacy ? [] : ['referenceMidi'])], 'Контекст слуха');
  const quality = oneOf(area.quality, ['major', 'minor'] as const, 'Слуховое трезвучие');
  const root = parseNote(text(area.root, 'Тоника слуха', 32)).name;
  const seed = number(raw.seed, 0, 0xffffffff, 'Seed слухового занятия');
  const plannedCount = number(raw.plannedCount, 1, 20, 'Число слуховых вопросов');
  const referenceMidi = legacy ? 36 + parseNote(root).pitchClass : number(area.referenceMidi, 0, 120, 'Опорная высота слуха');
  if (referenceMidi % 12 !== parseNote(root).pitchClass) invalid('Опорная высота не соответствует тонике слуха.');
  const questions = array(raw.questions, plannedCount, 'Результаты слуховых вопросов').map(item => validateEarResult(item, root, quality, referenceMidi));
  const generated = startEarSession({ root, quality, referenceMidi, seed, count: plannedCount }).questions;
  if (!questions.length || questions.some((item, index) => !same(item.question, generated[index]) || item.outcome === 'interrupted' && index !== questions.length - 1)) invalid('Порядок или состав слуховых вопросов не соответствует исходной серии.');
  return immutable({ kind: 'ear', source: 'audio-choice', context: { root, quality, referenceMidi: legacy ? questions[0].question.referenceMidi : referenceMidi }, seed, plannedCount, questions });
}

function validateRouteHistory(value: unknown, legacy = false): RouteResult {
  const raw = object(value, ['id', 'kind', 'source', 'plannedStepMs', 'actualStepMs', 'stepIndex', 'totalPlannedMs', 'status', 'finishReason', 'events', 'asOfMs', ...(legacy ? [] : ['material', 'sessionLinks'])], 'Учебный маршрут');
  if (raw.kind !== 'route' || raw.source !== 'active-timer') invalid('Маршрут учитывает активное время, без оценки точности игры.');
  array(raw.plannedStepMs, 3, 'Плановое время шагов');
  const actual = array(raw.actualStepMs, 3, 'Активное время шагов').map(value => number(value, 0, 600000, 'Активное время шага'));
  const id = text(raw.id, 'ID маршрута', 160);
  const asOfMs = number(raw.asOfMs, 0, Number.MAX_SAFE_INTEGER, 'Время снимка маршрута');
  const events = array(raw.events, Number.MAX_SAFE_INTEGER, 'События маршрута').map((item): RouteEvent => {
    const event = object(item, ['type', 'atMs', 'reason'], 'Событие маршрута');
    return { type: oneOf(event.type, ['start', 'pause', 'resume', 'next', 'stop', 'boundary'] as const, 'Тип события маршрута'),
      atMs: number(event.atMs, 0, Number.MAX_SAFE_INTEGER, 'Время события маршрута'),
      reason: event.reason === null ? null : oneOf(event.reason, ['manual', 'hidden'] as const, 'Причина паузы маршрута') };
  });
  const normalized = legacy ? { ...raw, material: null, sessionLinks: [] } : raw;
  plainJson(normalized.material);
  array(normalized.sessionLinks, Number.MAX_SAFE_INTEGER, 'Связанные занятия').forEach(link => object(link, ['id', 'kind', 'step'], 'Связь занятия'));
  const expected = replayRouteResult({ id, events, asOfMs, material: normalized.material as RouteResult['material'], sessionLinks: normalized.sessionLinks as RouteResult['sessionLinks'] });
  if (actual.reduce((sum, value) => sum + value, 0) === 0 || !same(normalized, expected)) invalid('Состояние маршрута не соответствует событиям или не содержит активного времени.');
  return expected;
}

export function validateHistoryEntry(value: unknown, legacy = false): HistoryEntry {
  const raw = object(value, ['id', 'occurredAt', 'timeZone', 'localDate', 'result', ...(legacy ? [] : ['routeRef'])], 'Запись истории');
  const id = text(raw.id, 'ID истории', 160);
  const occurredAt = utc(raw.occurredAt, 'Время занятия');
  const timeZone = text(raw.timeZone, 'Часовой пояс', 100);
  const localDate = originalLocalDate(occurredAt, timeZone);
  if (raw.localDate !== localDate) invalid('Дата занятия не соответствует исходному времени и часовому поясу.');
  if (!raw.result || typeof raw.result !== 'object' || Array.isArray(raw.result)) invalid('Отсутствует результат занятия.');
  const kindProperty = Object.getOwnPropertyDescriptor(raw.result, 'kind');
  if (!kindProperty || !Object.hasOwn(kindProperty, 'value')) invalid('Происхождение результата должно быть обычным JSON-полем.');
  const kind = kindProperty.value;
  const routeRef = legacy ? null : validateRouteRef(raw.routeRef);
  const envelope = { id, occurredAt, timeZone, localDate, routeRef };
  if (kind === 'ear') return immutable({ ...envelope, result: validateEarHistory(raw.result, legacy) });
  if (kind === 'route') { if (routeRef) invalid('Маршрут не может ссылаться на родительский маршрут.'); return immutable({ ...envelope, result: validateRouteHistory(raw.result, legacy) }); }
  if (kind === 'manual') {
    const result = object(raw.result, ['kind', 'source', 'comfortableBpm', 'durationMs', 'note', 'context', ...(legacy ? [] : ['material'])], 'Ручная отметка');
    if (result.source !== 'self-report') invalid('Ручная отметка должна быть явно помечена как самооценка.');
    const manual = createManualPracticeResult({
      context: legacy ? legacyContext(result.context) : context(result.context), comfortableBpm: number(result.comfortableBpm, 40, 220, 'Комфортный темп'),
      durationMs: number(result.durationMs, 0, Number.MAX_SAFE_INTEGER, 'Длительность занятия', false), note: text(result.note, 'Заметка', 2000, true),
      material: legacy ? { kind: 'legacy-unknown' } : validatePracticeMaterial(result.material, context(result.context), true),
    });
    return immutable({ ...envelope, result: manual });
  }
  if (kind !== 'screen') invalid('Неизвестное происхождение результата.');
  const result = object(raw.result, ['kind', 'source', 'seed', 'mode', 'context', 'plannedCount', 'questions', ...(legacy ? [] : ['questionPolicy'])], 'Экранное занятие');
  if (result.source !== 'screen-input') invalid('Экранный результат должен иметь источник screen-input.');
  const originalContext = legacy ? legacyContext(result.context) : context(result.context);
  const mode = oneOf(result.mode, MODES, 'Тип экранного задания');
  if (mode === 'find-degree' && originalContext.scope !== 'structure') invalid('Поиск ступени не может иметь хроматический контекст.');
  if (mode === 'find-interval' && originalContext.scope !== 'chromatic') invalid('Произвольный интервал требует хроматический контекст.');
  const plannedCount = number(result.plannedCount, 1, 100, 'Запланированные вопросы');
  const questionPolicy = legacy ? 'random-v1' : oneOf(result.questionPolicy, ['random-v1', 'triad-6-v1', 'shape-6-v1'] as const, 'Политика вопросов');
  const questions = array(result.questions, plannedCount, 'Результаты вопросов').map(item => validateScreenQuestion(item, mode, originalContext));
  if (questions.length === 0 || new Set(questions.map(item => item.questionId)).size !== questions.length) invalid('Экранная история пуста или содержит повторяющиеся вопросы.');
  if (questions.some((item, index) => item.outcome === 'interrupted' && index !== questions.length - 1)) invalid('Прерванным может быть только последний сохранённый вопрос.');
  if (questionPolicy === 'triad-6-v1' && (plannedCount !== 6 || !['major-triad', 'minor-triad'].includes(originalContext.structureId))) invalid('Серия трезвучия требует шесть вопросов и трезвучный контекст.');
  if (questionPolicy === 'triad-6-v1' || questionPolicy === 'shape-6-v1') {
    const generated = startQuiz({ structure: createStructure(originalContext.root, originalContext.structureId), positions: annotatePositions(originalContext.positionIds.map(position), createStructure(originalContext.root, originalContext.structureId)),
      mode, scope: originalContext.scope, seed: number(result.seed, 0, 0xffffffff, 'Seed'), questionPolicy, box: originalContext.box ?? null }, plannedCount).questions;
    if (questions.some((question, index) => question.questionId !== generated[index].id || !same(question.target, generated[index].target) || question.targetMidi !== generated[index].targetMidi || question.targetPositionId !== (generated[index].targetPositionId ?? null))) invalid('Учебная серия не соответствует зафиксированному набору шести вопросов.');
  }
  return immutable({ ...envelope, result: { kind: 'screen', source: 'screen-input', seed: number(result.seed, 0, 0xffffffff, 'Seed'), mode, context: originalContext, plannedCount, questions, questionPolicy } });
}

export function validateSnapshot(value: unknown): StudySnapshot {
  const raw = object(value, ['format', 'schemaVersion', 'preferences', 'presets', 'history', 'profile', 'practiceDrafts'], 'Резервная копия');
  if (raw.format !== 'bass-study-backup') throw new StudyStorageError('UNSUPPORTED_FORMAT', 'Это не резервная копия bass_study.');
  if (raw.schemaVersion !== 7) throw new StudyStorageError('UNSUPPORTED_VERSION', 'Эта версия резервной копии не поддерживается. Данные не изменены.');
  // Import bytes are bounded by parseBackup; ordinary native writes must never make
  // an otherwise valid database unreadable merely by exceeding an arbitrary count.
  const presets = array(raw.presets, Number.MAX_SAFE_INTEGER, 'Пресеты').map((value, index) => recordContext(`Пресет №${index + 1}`, () => validatePreset(value)));
  const history = array(raw.history, Number.MAX_SAFE_INTEGER, 'История').map(item => validateHistoryEntry(item));
  const practiceDrafts = array(raw.practiceDrafts, Number.MAX_SAFE_INTEGER, 'Черновики').map(validatePracticeDraft);
  if (new Set(presets.map(item => item.id)).size !== presets.length || new Set(history.map(item => item.id)).size !== history.length) invalid('ID пресетов или истории повторяются.');
  const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (new Set(practiceDrafts.map(item => item.id)).size !== practiceDrafts.length) invalid('ID черновиков повторяются.');
  return immutable({ format: 'bass-study-backup', schemaVersion: 7, preferences: recordContext('Текущие настройки (preferences/current)', () => validatePreferences(raw.preferences)), profile: validateProfile(raw.profile), practiceDrafts: practiceDrafts.sort(byId), presets: presets.sort(byId), history: history.sort(byId) });
}

/** Exact schema-1 records are validated before adding schema-2 defaults. */
export function migrateV1Preferences(value: unknown): AppPreferences {
  const data = object(value, ['study', 'training', 'player'], 'Настройки версии 1');
  const training = object(data.training, ['mode', 'quizMode', 'scope', 'count', 'pattern', 'sequenceScope', 'reviewPositionIds'], 'Настройки заданий версии 1');
  oneOf(training.quizMode, LEGACY_MODES, 'Тип задания версии 1');
  return migrateV2Preferences({ ...data, training: { ...training, intervalDegree: '#4' } });
}

export function migrateV2Preferences(value: unknown): AppPreferences {
  const data = object(value, ['study', 'training', 'player'], 'Настройки версии 2');
  return migrateV3Preferences({ ...data, activeModule: 'foundation', ear: DEFAULT_PREFERENCES.ear });
}
export function migrateV2Preset(value: unknown): Preset {
  const data = object(value, ['id', 'name', 'createdAt', 'preferences'], 'Пресет версии 2');
  return validatePreset({ ...data, preferences: migrateV2Preferences(data.preferences) });
}
export function migrateV2HistoryEntry(value: unknown): HistoryEntry {
  const entry = validateHistoryEntry(value, true);
  if (entry.result.kind !== 'screen' && entry.result.kind !== 'manual') invalid('Версия 2 поддерживала только экранные результаты и ручные отметки.');
  return entry;
}
export function migrateV3Preferences(value: unknown): AppPreferences {
  const data = object(value, ['activeModule', 'ear', 'study', 'training', 'player'], 'Настройки версии 3');
  oneOf(data.activeModule, ['foundation', 'ear', 'route'] as const, 'Раздел версии 3');
  return migrateV4Preferences({ ...data, harmony: DEFAULT_HARMONY_PREFERENCES });
}
export function migrateV3Preset(value: unknown): Preset {
  const data = object(value, ['id', 'name', 'createdAt', 'preferences'], 'Пресет версии 3');
  return validatePreset({ ...data, preferences: migrateV3Preferences(data.preferences) });
}
export function migrateV3HistoryEntry(value: unknown): HistoryEntry { return validateHistoryEntry(value, true); }

export function migrateV4Preferences(value: unknown): AppPreferences {
  const data = object(value, ['activeModule', 'ear', 'harmony', 'study', 'training', 'player'], 'Настройки версии 4');
  oneOf(data.activeModule, ['foundation', 'ear', 'route', 'harmony'] as const, 'Раздел версии 4');
  return migrateV5Preferences({ ...data, tracks: null, input: { deviceId: '' } });
}
export function migrateV4Preset(value: unknown): Preset {
  const data = object(value, ['id', 'name', 'createdAt', 'preferences'], 'Пресет версии 4');
  return validatePreset({ ...data, preferences: migrateV4Preferences(data.preferences) });
}
export function migrateV4HistoryEntry(value: unknown): HistoryEntry { return validateHistoryEntry(value, true); }

export function migrateV5Preferences(value: unknown): AppPreferences {
  const data = object(value, ['activeModule', 'ear', 'harmony', 'tracks', 'input', 'study', 'training', 'player'], 'Настройки версии 5');
  const study = object(data.study, ['root', 'structureId', 'labelMode', 'strings', 'fretMin', 'fretMax'], 'Настройки грифа версии 5');
  const training = object(data.training, ['mode', 'quizMode', 'scope', 'intervalDegree', 'count', 'pattern', 'sequenceScope', 'reviewPositionIds'], 'Настройки заданий версии 5');
  return migrateV6Preferences({ ...data, study: { ...study, box: null, showFingers: false }, training: { ...training, questionPolicy: 'random-v1' } });
}
export function migrateV5Preset(value: unknown): Preset {
  const data = object(value, ['id', 'name', 'createdAt', 'preferences'], 'Пресет версии 5');
  return validatePreset({ ...data, preferences: migrateV5Preferences(data.preferences) });
}
export function migrateV5HistoryEntry(value: unknown): HistoryEntry { return validateHistoryEntry(value, true); }

/** Версия 6 уже содержит профиль/черновики; меняются только настройки. */
export function migrateV6Preferences(value: unknown): AppPreferences {
  const data = object(value, ['activeModule', 'ear', 'harmony', 'tracks', 'input', 'study', 'training', 'player'], 'Настройки версии 6');
  return validatePreferences({ ...data, musicBank: null });
}
export function migrateV6Preset(value: unknown): Preset {
  const data = object(value, ['id', 'name', 'createdAt', 'preferences'], 'Пресет версии 6');
  return validatePreset({ ...data, preferences: migrateV6Preferences(data.preferences) });
}
export function migrateV6HistoryEntry(value: unknown): HistoryEntry { return validateHistoryEntry(value); }

export function migrateV1Preset(value: unknown): Preset {
  const data = object(value, ['id', 'name', 'createdAt', 'preferences'], 'Пресет версии 1');
  return validatePreset({ ...data, preferences: migrateV1Preferences(data.preferences) });
}

export function migrateV1HistoryEntry(value: unknown): HistoryEntry {
  const data = object(value, ['id', 'occurredAt', 'timeZone', 'localDate', 'result'], 'История версии 1');
  if (!data.result || typeof data.result !== 'object') invalid('Отсутствует результат версии 1.');
  const kind = Object.getOwnPropertyDescriptor(data.result, 'kind');
  if (!kind || !Object.hasOwn(kind, 'value')) invalid('Происхождение результата версии 1 должно быть обычным JSON-полем.');
  if (kind.value === 'manual') return migrateV2HistoryEntry(data);
  const result = object(data.result, ['kind', 'source', 'seed', 'mode', 'context', 'plannedCount', 'questions'], 'Экранное занятие версии 1');
  oneOf(result.mode, LEGACY_MODES, 'Тип задания версии 1');
  const questions = array(result.questions, 100, 'Вопросы версии 1').map(question => ({ ...object(question, LEGACY_QUESTION_KEYS, 'Вопрос версии 1'), targetMidi: null }));
  return migrateV2HistoryEntry({ ...data, result: { ...result, questions } });
}

export function migrateBackup(value: unknown): StudySnapshot {
  const version = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'schemaVersion')?.value : undefined;
  if (version !== undefined && ![1, 2, 3, 4, 5, 6, 7].includes(version)) throw new StudyStorageError('UNSUPPORTED_VERSION', 'Эта версия резервной копии не поддерживается. Данные не изменены.');
  if (version === 7) return validateSnapshot(value);
  if (version === 6) {
    const previous = object(value, ['format', 'schemaVersion', 'preferences', 'presets', 'history', 'profile', 'practiceDrafts'], 'Резервная копия версии 6');
    return validateSnapshot({ ...previous, schemaVersion: 7, preferences: recordContext('Текущие настройки (preferences/current)', () => migrateV6Preferences(previous.preferences)),
      presets: array(previous.presets, Number.MAX_SAFE_INTEGER, 'Пресеты версии 6').map((value, index) => recordContext(`Пресет №${index + 1}`, () => migrateV6Preset(value))) });
  }
  const data = object(value, ['format', 'schemaVersion', 'preferences', 'presets', 'history'], 'Резервная копия');
  if (data.format !== 'bass-study-backup') throw new StudyStorageError('UNSUPPORTED_FORMAT', 'Это не резервная копия bass_study.');
  if (data.schemaVersion !== 1 && data.schemaVersion !== 2 && data.schemaVersion !== 3 && data.schemaVersion !== 4 && data.schemaVersion !== 5) throw new StudyStorageError('UNSUPPORTED_VERSION', 'Эта версия резервной копии не поддерживается. Данные не изменены.');
  const migrations = data.schemaVersion === 1 ? { preferences: migrateV1Preferences, preset: migrateV1Preset, history: migrateV1HistoryEntry }
    : data.schemaVersion === 2 ? { preferences: migrateV2Preferences, preset: migrateV2Preset, history: migrateV2HistoryEntry }
    : data.schemaVersion === 3 ? { preferences: migrateV3Preferences, preset: migrateV3Preset, history: migrateV3HistoryEntry }
    : data.schemaVersion === 4 ? { preferences: migrateV4Preferences, preset: migrateV4Preset, history: migrateV4HistoryEntry }
    : { preferences: migrateV5Preferences, preset: migrateV5Preset, history: migrateV5HistoryEntry };
  return validateSnapshot({ ...data, schemaVersion: 7, profile: DEFAULT_PROFILE, practiceDrafts: [], preferences: recordContext('Текущие настройки (preferences/current)', () => migrations.preferences(data.preferences)),
    presets: array(data.presets, Number.MAX_SAFE_INTEGER, 'Старые пресеты').map((value, index) => recordContext(`Пресет №${index + 1}`, () => migrations.preset(value))),
    history: array(data.history, Number.MAX_SAFE_INTEGER, 'Старая история').map(migrations.history) });
}

export function parseBackup(json: string): StudySnapshot {
  if (typeof json !== 'string' || json.length > MAX_BACKUP_BYTES || new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new StudyStorageError('INVALID_BACKUP', 'Нужен JSON-файл размером не более 64 МиБ.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new StudyStorageError('INVALID_BACKUP', 'Не удалось прочитать JSON резервной копии.'); }
  return migrateBackup(value);
}

export function emptySnapshot(): StudySnapshot { return validateSnapshot({ format: 'bass-study-backup', schemaVersion: 7, profile: DEFAULT_PROFILE, practiceDrafts: [], preferences: DEFAULT_PREFERENCES, presets: [], history: [] }); }

function envelope(metadata: HistoryMetadata) {
  return { id: metadata.id, occurredAt: metadata.occurredAt, timeZone: metadata.timeZone, localDate: originalLocalDate(metadata.occurredAt, metadata.timeZone), routeRef: metadata.routeRef ?? null };
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
  return validateHistoryEntry({ ...envelope({ ...metadata, routeRef: metadata.routeRef ?? session.routeRef ?? null }), result: { kind: 'screen', source: 'screen-input', seed: session.seed,
    mode: session.questions[0].mode, context: originalContext, plannedCount: session.questions.length, questions, questionPolicy: session.questionPolicy } }) as ScreenHistoryEntry;
}

export function makeManualHistory(result: ManualPracticeResult, metadata: HistoryMetadata): ManualHistoryEntry {
  return validateHistoryEntry({ ...envelope(metadata), result }) as ManualHistoryEntry;
}

export function applyDraftDrain(draftValue: PracticeDraft, request: DrainDraftRequest, existing?: HistoryEntry): { entry: ManualHistoryEntry; draft: PracticeDraft } {
  const draft = validatePracticeDraft(draftValue);
  object(request, ['draftId', 'historyId', 'expectedRecordedThroughMs', 'throughMs', 'editRevision', 'comfortableBpm', 'note', 'occurredAt', 'timeZone', ...(Object.hasOwn(request, 'failAfterWrite') ? ['failAfterWrite'] : [])], 'Сохранение черновика');
  if (request.draftId !== draft.id) invalid('Выбран другой черновик.');
  if (request.occurredAt !== draft.createdAt || request.timeZone !== draft.timeZone) invalid('Отметка должна сохранять исходные время и часовой пояс черновика.');
  const baseline = number(request.expectedRecordedThroughMs, 0, Number.MAX_SAFE_INTEGER, 'Исходная граница сохранения', false);
  const through = number(request.throughMs, baseline, draft.totalReferenceMs, 'Граница сохранения', false);
  number(request.editRevision, 0, draft.editRevision, 'Версия сохраняемой заметки');
  if (request.failAfterWrite !== undefined && request.failAfterWrite !== 1 && request.failAfterWrite !== 2) invalid('Неизвестная точка отказа сохранения черновика.');
  const entry = makeManualHistory(createManualPracticeResult({ context: draft.context, material: draft.material,
    comfortableBpm: number(request.comfortableBpm, 40, 220, 'Сохраняемый темп'), durationMs: through - baseline, note: text(request.note, 'Сохраняемая заметка', 2000, true) }),
  { id: text(request.historyId, 'ID ручной отметки', 160), occurredAt: request.occurredAt, timeZone: request.timeZone, routeRef: draft.routeRef });
  if (existing) {
    if (!same(validateHistoryEntry(existing), entry)) throw new StudyStorageError('SAVE_CONFLICT', 'Этот ID уже принадлежит другой записи. Черновик не изменён.');
    if (draft.recordedThroughMs < through) invalid('Записанная отметка не соответствует границе черновика.');
    return { entry, draft };
  }
  if (draft.recordedThroughMs !== baseline) throw new StudyStorageError('STALE_DRAFT', 'Часть этого черновика уже сохранена. Обнови отметку перед повторным сохранением.');
  if (draft.editRevision === request.editRevision && (draft.note !== request.note || draft.comfortableBpm !== request.comfortableBpm)) invalid('Текст или темп не соответствует сохраняемой версии черновика.');
  return { entry, draft: validatePracticeDraft({ ...draft, recordedThroughMs: through,
    ...(draft.editRevision === request.editRevision ? { note: '' } : {}) }) };
}

export function makeEarHistory(session: EarSession, metadata: HistoryMetadata): EarHistoryEntry | null {
  const questions = collectEarResults(session);
  if (!questions.length) return null;
  const first = session.questions[0];
  return validateHistoryEntry({ ...envelope({ ...metadata, routeRef: metadata.routeRef ?? session.routeRef ?? null }), result: { kind: 'ear', source: 'audio-choice', context: { root: first.root, quality: first.quality, referenceMidi: first.referenceMidi }, seed: session.seed, plannedCount: session.questions.length, questions } }) as EarHistoryEntry;
}

export function makeRouteHistory(session: RouteResult, metadata: HistoryMetadata): RouteHistoryEntry | null {
  const result = getRouteResult(session);
  if (result.actualStepMs.reduce((sum, value) => sum + value, 0) === 0) return null;
  return validateHistoryEntry({ ...envelope(metadata), result }) as RouteHistoryEntry;
}

export interface HistoryGroupSummary {
  readonly key: string; readonly mode: QuizMode; readonly context: QuestionContext;
  readonly questionPolicy: ScreenHistoryResult['questionPolicy']; readonly intervalDegrees: readonly IntervalDegree[];
  readonly questions: number; readonly completedQuestions: number; readonly independentCorrect: number; readonly corrected: number;
  readonly errors: number; readonly hints: number; readonly skipped: number; readonly interrupted: number;
  readonly meanFirstResponseMs: number | null;
}

/** Derives from records already validated at the storage/import boundary. */
export function getHistorySummary(history: readonly HistoryEntry[]) {
  const groups = new Map<string, { mode: QuizMode; context: QuestionContext; questionPolicy: ScreenHistoryResult['questionPolicy']; intervalDegrees: readonly IntervalDegree[]; questions: StoredQuestion[] }>();
  let screenSessions = 0; let manualSessions = 0; let manualDurationMs = 0;
  let earSessions = 0;
  let routeSessions = 0; let routeActiveMs = 0;
  const earQuestions: SavedEarResult[] = [];
  for (const entry of history) {
    if (entry.result.kind === 'manual') { manualSessions++; manualDurationMs += entry.result.durationMs; continue; }
    if (entry.result.kind === 'ear') { earSessions++; earQuestions.push(...entry.result.questions); continue; }
    if (entry.result.kind === 'route') { routeSessions++; routeActiveMs += entry.result.actualStepMs.reduce((sum, value) => sum + value, 0); continue; }
    screenSessions++;
    const { context: area, mode, questions, questionPolicy } = entry.result;
    // Contexts have already passed the storage boundary. Canonicalise field
    // order without regenerating a shape for every historical session.
    const box = area.box ? { version: area.box.version, shapeId: area.box.shapeId, root: area.box.root,
      structureId: area.box.structureId, anchorFret: area.box.anchorFret, anchorString: area.box.anchorString } : null;
    const intervalDegrees: readonly IntervalDegree[] = mode === 'find-interval'
      ? INTERVAL_DEGREES.filter(degree => questions.some(question => question.target.degree === degree)) : [];
    const key = JSON.stringify([mode, area.scope, area.root, area.structureId, [...area.positionIds].sort(), box, questionPolicy, intervalDegrees]);
    const group = groups.get(key) ?? { mode, context: area, questionPolicy, intervalDegrees, questions: [] };
    group.questions.push(...questions); groups.set(key, group);
  }
  const summaries: HistoryGroupSummary[] = [...groups].map(([key, group]) => {
    const firstResponses = group.questions.map(item => item.firstResponseMs).filter((value): value is number => value !== null);
    return { key, mode: group.mode, context: group.context, questionPolicy: group.questionPolicy, intervalDegrees: group.intervalDegrees, questions: group.questions.length,
      completedQuestions: group.questions.filter(item => item.outcome !== 'interrupted').length,
      independentCorrect: group.questions.filter(item => item.independentCorrect).length,
      corrected: group.questions.filter(item => item.corrected).length,
      errors: group.questions.reduce((sum, item) => sum + item.errors, 0), hints: group.questions.filter(item => item.hintUsed).length,
      skipped: group.questions.filter(item => item.skipped).length, interrupted: group.questions.filter(item => item.outcome === 'interrupted').length,
      meanFirstResponseMs: firstResponses.length ? firstResponses.reduce((sum, value) => sum + value, 0) / firstResponses.length : null };
  });
  const total = (key: 'questions' | 'completedQuestions' | 'independentCorrect' | 'corrected' | 'errors' | 'hints' | 'skipped' | 'interrupted') => summaries.reduce((sum, group) => sum + group[key], 0);
  return immutable({ entries: history.length, screenSessions, manualSessions, manualDurationMs,
    routeSessions, routeActiveMs,
    earSessions, earQuestions: earQuestions.length, earCompletedQuestions: earQuestions.filter(question => question.outcome !== 'interrupted').length,
    earIndependentCorrect: earQuestions.filter(question => question.independentCorrect).length, earCorrected: earQuestions.filter(question => question.corrected).length,
    earErrors: earQuestions.reduce((sum, question) => sum + question.errors, 0), earHints: earQuestions.filter(question => question.hintUsed).length,
    earSkipped: earQuestions.filter(question => question.skipped).length, earInterrupted: earQuestions.filter(question => question.outcome === 'interrupted').length,
    earCompletedListens: earQuestions.reduce((sum, question) => sum + question.listensCompleted, 0), earReplayCount: earQuestions.reduce((sum, question) => sum + question.replayCount, 0),
    questions: total('questions'), completedQuestions: total('completedQuestions'), independentCorrect: total('independentCorrect'),
    corrected: total('corrected'), errors: total('errors'), hints: total('hints'), skipped: total('skipped'), interrupted: total('interrupted'), groups: summaries });
}

/** Derives from validated records; never replays all quiz answers on the UI path. */
export function getReviewPositionIds(history: readonly HistoryEntry[]): readonly string[] {
  const ids = new Set<string>();
  const pitches = new Map<string, { midi: number; pitchClass: number }>();
  const pitch = (id: string) => {
    let value = pitches.get(id);
    if (!value) { const found = position(id); value = { midi: found.midi, pitchClass: found.pitchClass }; pitches.set(id, value); }
    return value;
  };
  for (const entry of history) {
    if (entry.result.kind !== 'screen') continue;
    const targetClasses = new Set<number>();
    const targetHeights = new Set<number>();
    for (const question of entry.result.questions) {
      if (question.independentCorrect) continue;
      if (entry.result.mode === 'name-note') {
        if (question.targetPositionId) ids.add(question.targetPositionId);
      } else if (question.targetMidi === null) targetClasses.add(question.target.pitchClass);
      else targetHeights.add(question.targetMidi);
    }
    if (targetClasses.size || targetHeights.size) for (const id of entry.result.context.positionIds) {
      const available = pitch(id);
      if (targetClasses.has(available.pitchClass) || targetHeights.has(available.midi)) ids.add(id);
    }
  }
  const order = ['E', 'A', 'D', 'G'];
  return Object.freeze([...ids].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) || Number(a.split(':')[1]) - Number(b.split(':')[1])));
}
