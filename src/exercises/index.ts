/**
 * Каталог упражнений exercise-v1 (R-026): чистое построение плана упражнения.
 * Модуль не обращается к DOM, звуку и базе. Формы берутся из boxes-v1, порядок «туда-обратно»
 * и группы по три — из существующего генератора последовательностей.
 */
import {
  annotatePositions, createStructure, formatDegree, formatMidi, getPosition, parseNote,
  type AnnotatedPosition, type MusicalStructure, type StringId, type StructureId,
} from '../music';
import { getBoxCatalogue, getBoxOverlap, type BoxInstance, type BoxShapeId } from '../music/boxes';
import { degreeFrom, parseChord } from '../music/chords';
import { createSequence, type SequencePattern } from '../training';
import { TEMPLATE_TASKS, type TemplateTask } from './tasks';

export { TASK_LINE_MAX, TEMPLATE_TASKS, type TemplateTask } from './tasks';

export type ExerciseCategory = 'warmup' | 'notes' | 'forms' | 'connections' | 'positions' | 'arpeggios' | 'sequences' | 'transposition' | 'progressions';
export type ConceptId =
  | 'finger-per-fret' | 'position-shift' | 'semitone' | 'octave' | 'unison' | 'degrees' | 'pentatonic' | 'relative-keys'
  | 'scale-formula' | 'shared-notes' | 'form-system' | 'triad' | 'fifth' | 'sequence' | 'third' | 'transposition' | 'circle-of-fifths'
  | 'seventh-chord' | 'inversion' | 'progression' | 'blues' | 'right-hand';

type Pentatonic = 'minor-pentatonic' | 'major-pentatonic';
type Scale = 'major' | 'natural-minor';
type Triad = 'major-triad' | 'minor-triad' | 'diminished-triad';
type Seventh = 'major-seventh' | 'dominant-seventh' | 'minor-seventh' | 'half-diminished-seventh';
export type SpiderPattern = '1234' | '1324' | '1243' | '1432';
export type ProgressionId = 'I-IV-V' | 'ii-V-I' | 'blues-12';
export type ProgressionPattern = 'roots' | 'root-fifth' | 'octaves' | 'arpeggio' | 'approach' | 'boogie';
/**
 * Событие такта фрагмента песни: `[струна, лад, начало, длина]` в шестнадцатых от начала такта;
 * пауза — `[null, null, начало, длина]`. События такта идут подряд и покрывают его целиком.
 * Пятый элемент `1` — продолжение ноты прошлого такта (лига через тактовую черту): только у первого события
 * такта, кроме первого, и только той же струны и лада, что последняя нота прошлого такта.
 */
export type SongEvent = readonly [StringId | null, number | null, number, number] | readonly [StringId, number, 0, number, 1];
export interface SongBar { readonly chord: string | null; readonly events: readonly SongEvent[] }
export interface SongSource {
  /** SHA-256 файла партитуры (64 hex), размер, партия и такты (с 1, включительно). */
  readonly sha256: string; readonly size: number; readonly trackIndex: number; readonly trackName: string; readonly fromBar: number; readonly toBar: number;
}
/** Рисунок правой руки на открытых струнах: соседние струны, через струну, рейкинг. */
export type CrossingPattern = 'adjacent' | 'skip' | 'raking';
type PentaShape = Extract<BoxShapeId, `penta-${string}`>;
type CompactShape = 'compact-e' | 'compact-a';

export interface ExerciseParams {
  readonly 'chromatic-position': { readonly startFret: number };
  readonly 'position-shift': { readonly string: StringId; readonly startFret: number; readonly shifts: number };
  readonly spider: { readonly startFret: number; readonly positions: number; readonly pattern: SpiderPattern };
  readonly 'string-crossing': { readonly pattern: CrossingPattern };
  readonly 'note-all-positions': { readonly note: string };
  readonly octaves: { readonly note: string };
  readonly 'pentatonic-form': { readonly root: string; readonly structureId: Pentatonic; readonly shapeId: PentaShape };
  readonly 'pentatonic-relative': { readonly minorRoot: string; readonly shapeId: PentaShape };
  readonly 'scale-compact': { readonly root: string; readonly structureId: Scale; readonly shapeId: CompactShape };
  readonly 'blues-scale': { readonly root: string; readonly shapeId: CompactShape };
  readonly 'connect-forms': { readonly root: string; readonly structureId: Pentatonic; readonly shapeId: PentaShape };
  readonly 'pentatonic-neck': { readonly root: string; readonly structureId: Pentatonic };
  readonly 'scale-one-string': { readonly root: string; readonly structureId: Scale; readonly string: StringId };
  readonly 'scale-position': { readonly root: string; readonly structureId: Scale; readonly degree: number };
  readonly 'arpeggio-1358': { readonly root: string; readonly structureId: Triad; readonly shapeId: CompactShape };
  readonly 'arpeggio-seventh': { readonly root: string; readonly structureId: Seventh; readonly shapeId: CompactShape };
  readonly 'arpeggio-inversion': { readonly root: string; readonly structureId: Triad; readonly inversion: number };
  readonly 'root-five-eight': { readonly root: string; readonly string: 'E' | 'A' };
  readonly 'groups-of-three': { readonly root: string; readonly structureId: Pentatonic; readonly shapeId: PentaShape };
  readonly thirds: { readonly root: string; readonly structureId: Scale; readonly shapeId: CompactShape };
  readonly 'form-transpose': { readonly structureId: Pentatonic; readonly shapeId: PentaShape; readonly roots: readonly string[] };
  readonly 'cycle-fourths': { readonly root: string; readonly count: number };
  readonly progression: { readonly root: string; readonly progression: ProgressionId; readonly pattern: ProgressionPattern };
  /** Фрагмент басовой партии из «Песен» (P14-04): снимок нот, файл для игры не нужен. Только своё упражнение. */
  readonly 'song-fragment': { readonly title: string; readonly source: SongSource; readonly bpm: number; readonly key: string | null; readonly bars: readonly SongBar[] };
}
export type ExerciseTemplateId = keyof ExerciseParams;
export type ExerciseSpec = { [Id in ExerciseTemplateId]: { readonly version: 'exercise-v1'; readonly templateId: Id; readonly params: ExerciseParams[Id] } }[ExerciseTemplateId];

export interface ExerciseNote {
  readonly id: string; readonly string: StringId; readonly fret: number; readonly midi: number;
  /** Звучащая нота с научной октавой, например «E♭2». */
  readonly name: string;
  readonly degree: string | null;
  readonly finger: number | null;
  /** Нота берётся растяжкой за пределы окна позиции «палец на лад». */
  readonly stretch: boolean;
  readonly segment: number;
  /** Палец правой руки: «i» — указательный, «m» — средний; `null` — не подписан (D-050). */
  readonly pluck: 'i' | 'm' | null;
}
export interface ExercisePlan {
  readonly spec: ExerciseSpec;
  readonly title: string;
  readonly category: ExerciseCategory;
  readonly concepts: readonly ConceptId[];
  readonly segments: readonly { readonly label: string }[];
  /** Задание из трёх строк (R-028); шаг программы может заменить его своим. */
  readonly task: TemplateTask;
  readonly notes: readonly ExerciseNote[];
  /** Те же позиции в порядке плана — вход для createNotationPlan. */
  readonly positions: readonly AnnotatedPosition[];
  /**
   * `shared` — позиция из нескольких сегментов отмечается общей (связки форм); `none` — сегменты идут подряд
   * по одним и тем же ладам (паук, такты последовательности), и «общих» позиций нет.
   */
  readonly overlap: 'shared' | 'none';
  /**
   * `tonic` — проход завершается тоникой (ближайшей нотой плана со ступенью 1) и паузой до конца такта (D-050);
   * `none` — у материала нет тоники (хроматика, паук, ноты по грифу) или такт задан аккордом (последовательность).
   */
  readonly cadence: 'tonic' | 'none';
  /**
   * Ритм задан материалом (фрагмент песни): шаги `note` — индекс ноты или пауза, длина в шестнадцатых;
   * `tie` — продолжение ноты прошлого шага (лига через тактовую черту), не новая нота.
   */
  readonly timing: readonly { readonly note: number | null; readonly grids: number; readonly tie?: boolean }[] | null;
}
export interface ExerciseTemplate<Id extends ExerciseTemplateId = ExerciseTemplateId> {
  readonly id: Id; readonly category: ExerciseCategory; readonly title: string;
  readonly concepts: readonly ConceptId[]; readonly defaults: ExerciseParams[Id];
  /** Только своё упражнение: не показывается в библиотеке и рекомендациях. */
  readonly userOnly?: boolean;
}

const STRINGS: readonly StringId[] = ['E', 'A', 'D', 'G'];
export const SPIDER_PATTERNS: readonly SpiderPattern[] = ['1234', '1324', '1243', '1432'];
export const PROGRESSION_IDS: readonly ProgressionId[] = ['I-IV-V', 'ii-V-I', 'blues-12'];
export const PROGRESSION_PATTERNS: readonly ProgressionPattern[] = ['roots', 'root-fifth', 'octaves', 'arpeggio', 'approach', 'boogie'];
export const CROSSING_PATTERNS: readonly CrossingPattern[] = ['adjacent', 'skip', 'raking'];
export const TRIADS: readonly Triad[] = ['major-triad', 'minor-triad', 'diminished-triad'];
export const SEVENTHS: readonly Seventh[] = ['major-seventh', 'dominant-seventh', 'minor-seventh', 'half-diminished-seventh'];
const PENTA_SHAPES: readonly PentaShape[] = ['penta-a', 'penta-b', 'penta-c', 'penta-d', 'penta-e'];
const SHAPE_LETTER: Record<PentaShape, string> = { 'penta-a': 'A', 'penta-b': 'B', 'penta-c': 'C', 'penta-d': 'D', 'penta-e': 'E' };

export const EXERCISE_TEMPLATES: readonly ExerciseTemplate[] = deepFreeze([
  { id: 'chromatic-position', category: 'warmup', title: 'Хроматика 1-2-3-4 в позиции', concepts: ['finger-per-fret', 'semitone'], defaults: { startFret: 5 } },
  { id: 'position-shift', category: 'warmup', title: 'Смена позиции по струне', concepts: ['position-shift', 'finger-per-fret'], defaults: { string: 'A', startFret: 3, shifts: 2 } },
  { id: 'spider', category: 'warmup', title: 'Паук: четыре пальца по грифу', concepts: ['finger-per-fret', 'position-shift'], defaults: { startFret: 5, positions: 5, pattern: '1234' } },
  { id: 'string-crossing', category: 'warmup', title: 'Переход между струнами (правая рука)', concepts: ['right-hand'], defaults: { pattern: 'adjacent' } },
  { id: 'note-all-positions', category: 'notes', title: 'Одна нота по всему грифу', concepts: ['octave', 'unison'], defaults: { note: 'C' } },
  { id: 'octaves', category: 'notes', title: 'Октавы: +2 струны, +2 лада', concepts: ['octave'], defaults: { note: 'G' } },
  { id: 'pentatonic-form', category: 'forms', title: 'Форма пентатоники вверх-вниз', concepts: ['pentatonic', 'degrees'], defaults: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a' } },
  { id: 'pentatonic-relative', category: 'forms', title: 'Мажорная и минорная пентатоника: одни ноты — разные тоники', concepts: ['relative-keys', 'degrees', 'pentatonic'], defaults: { minorRoot: 'A', shapeId: 'penta-a' } },
  { id: 'scale-compact', category: 'forms', title: 'Гамма в одной позиции', concepts: ['scale-formula', 'degrees'], defaults: { root: 'C', structureId: 'major', shapeId: 'compact-e' } },
  { id: 'blues-scale', category: 'forms', title: 'Блюзовая гамма', concepts: ['blues', 'degrees'], defaults: { root: 'A', shapeId: 'compact-e' } },
  { id: 'connect-forms', category: 'connections', title: 'Связка соседних форм', concepts: ['shared-notes', 'position-shift', 'pentatonic'], defaults: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a' } },
  { id: 'pentatonic-neck', category: 'connections', title: 'Пентатоника по всему грифу', concepts: ['form-system', 'shared-notes', 'pentatonic'], defaults: { root: 'A', structureId: 'minor-pentatonic' } },
  { id: 'scale-one-string', category: 'positions', title: 'Гамма на одной струне', concepts: ['scale-formula', 'semitone'], defaults: { root: 'C', structureId: 'major', string: 'A' } },
  { id: 'scale-position', category: 'positions', title: 'Гамма в позиции «палец на лад»', concepts: ['finger-per-fret', 'scale-formula', 'degrees'], defaults: { root: 'C', structureId: 'major', degree: 1 } },
  { id: 'arpeggio-1358', category: 'arpeggios', title: 'Арпеджио 1–3–5–8', concepts: ['triad', 'degrees'], defaults: { root: 'C', structureId: 'major-triad', shapeId: 'compact-e' } },
  { id: 'arpeggio-seventh', category: 'arpeggios', title: 'Арпеджио септаккорда 1–3–5–7', concepts: ['seventh-chord', 'degrees'], defaults: { root: 'C', structureId: 'dominant-seventh', shapeId: 'compact-e' } },
  { id: 'arpeggio-inversion', category: 'arpeggios', title: 'Обращение трезвучия', concepts: ['inversion', 'triad'], defaults: { root: 'C', structureId: 'major-triad', inversion: 1 } },
  { id: 'root-five-eight', category: 'arpeggios', title: 'Root–5–8', concepts: ['fifth', 'octave'], defaults: { root: 'C', string: 'A' } },
  { id: 'groups-of-three', category: 'sequences', title: 'Группы по три', concepts: ['sequence', 'pentatonic'], defaults: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a' } },
  { id: 'thirds', category: 'sequences', title: 'Терциями по гамме', concepts: ['third', 'sequence'], defaults: { root: 'C', structureId: 'major', shapeId: 'compact-e' } },
  { id: 'form-transpose', category: 'transposition', title: 'Та же форма от другой тоники', concepts: ['transposition', 'pentatonic'], defaults: { structureId: 'minor-pentatonic', shapeId: 'penta-a', roots: ['A', 'D', 'E'] } },
  { id: 'progression', category: 'progressions', title: 'Игра по последовательности аккордов', concepts: ['progression', 'degrees'], defaults: { root: 'C', progression: 'I-IV-V', pattern: 'roots' } },
  { id: 'song-fragment', category: 'progressions', title: 'Фрагмент песни', concepts: ['degrees'], userOnly: true, defaults: {
    title: 'Фрагмент', source: { sha256: '0'.repeat(64), size: 1, trackIndex: 0, trackName: 'Бас', fromBar: 1, toBar: 1 }, bpm: 90, key: null,
    bars: [{ chord: 'C', events: [['A', 3, 0, 4], ['A', 3, 4, 4], ['E', 3, 8, 4], [null, null, 12, 4]] }],
  } },
  { id: 'cycle-fourths', category: 'transposition', title: 'Паттерн по квинтовому кругу', concepts: ['circle-of-fifths', 'fifth', 'transposition'], defaults: { root: 'C', count: 4 } },
] satisfies readonly ExerciseTemplate[]);

const byId = new Map(EXERCISE_TEMPLATES.map(template => [template.id, template]));

export function getExerciseTemplate<Id extends ExerciseTemplateId>(id: Id): ExerciseTemplate<Id> {
  const template = byId.get(id);
  if (!template) throw new RangeError('Неизвестный шаблон упражнения.');
  return template as ExerciseTemplate<Id>;
}

export function createExerciseSpec<Id extends ExerciseTemplateId>(templateId: Id, params?: Partial<ExerciseParams[Id]>): ExerciseSpec {
  const template = getExerciseTemplate(templateId);
  return validateExerciseSpec({ version: 'exercise-v1', templateId, params: { ...template.defaults, ...params } });
}

/* ---------- Строгая проверка описания ---------- */

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new RangeError(`${label}: нужен обычный JSON-объект.`);
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new RangeError(`${label}: допускаются только обычные поля.`);
  return value as Record<string, unknown>;
}
function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string) {
  const own = Reflect.ownKeys(record);
  if (own.length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) throw new RangeError(`${label}: ожидаются поля ${keys.join(', ')}.`);
}
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], label: string): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new RangeError(`${label}: недопустимое значение.`);
  return value as T;
};
const integer = (value: unknown, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new RangeError(`${label}: требуется целое число от ${min} до ${max}.`);
  return value as number;
};
const noteName = (value: unknown, label: string) => {
  if (typeof value !== 'string') throw new RangeError(`${label}: нужно название ноты.`);
  return parseNote(value).name;
};

const PARAM_RULES: { readonly [Id in ExerciseTemplateId]: (raw: Record<string, unknown>) => ExerciseParams[Id] } = {
  'chromatic-position': raw => ({ startFret: integer(raw.startFret, 1, 21, 'Первый лад') }),
  'position-shift': raw => {
    const startFret = integer(raw.startFret, 1, 20, 'Первый лад'); const shifts = integer(raw.shifts, 1, 4, 'Число сдвигов');
    if (startFret + shifts + 3 > 24) throw new RangeError('Последняя группа должна помещаться на ладах до 24.');
    return { string: oneOf(raw.string, STRINGS, 'Струна'), startFret, shifts };
  },
  'string-crossing': raw => ({ pattern: oneOf(raw.pattern, CROSSING_PATTERNS, 'Рисунок правой руки') }),
  spider: raw => {
    const startFret = integer(raw.startFret, 1, 12, 'Первый лад'); const positions = integer(raw.positions, 2, 12, 'Число позиций');
    if (startFret + positions + 2 > 16) throw new RangeError('Паук должен заканчиваться не дальше 16-го лада.');
    return { startFret, positions, pattern: oneOf(raw.pattern, SPIDER_PATTERNS, 'Порядок пальцев') };
  },
  'note-all-positions': raw => ({ note: noteName(raw.note, 'Нота') }),
  octaves: raw => ({ note: noteName(raw.note, 'Нота') }),
  'pentatonic-form': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма') }),
  'pentatonic-relative': raw => ({ minorRoot: noteName(raw.minorRoot, 'Тоника минора'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма') }),
  'scale-compact': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'blues-scale': raw => ({ root: noteName(raw.root, 'Тоника'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'connect-forms': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма') }),
  'pentatonic-neck': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура') }),
  'scale-one-string': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура'), string: oneOf(raw.string, STRINGS, 'Струна') }),
  'scale-position': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура'), degree: integer(raw.degree, 1, 7, 'Ступень позиции') }),
  'arpeggio-1358': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, TRIADS, 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'arpeggio-seventh': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, SEVENTHS, 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'arpeggio-inversion': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, TRIADS, 'Структура'), inversion: integer(raw.inversion, 1, 2, 'Обращение') }),
  'root-five-eight': raw => ({ root: noteName(raw.root, 'Тоника'), string: oneOf(raw.string, ['E', 'A'], 'Струна') }),
  'groups-of-three': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма') }),
  thirds: raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'form-transpose': raw => {
    if (!Array.isArray(raw.roots) || raw.roots.length < 2 || raw.roots.length > 6) throw new RangeError('Тоники: нужен список из 2–6 нот.');
    return { structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма'), roots: raw.roots.map((root, index) => noteName(root, `Тоника ${index + 1}`)) };
  },
  'cycle-fourths': raw => ({ root: noteName(raw.root, 'Тоника'), count: integer(raw.count, 2, 12, 'Число тоник') }),
  'song-fragment': raw => {
    const text = (value: unknown, label: string, max: number) => {
      if (typeof value !== 'string' || !value.trim() || value.length > max) throw new RangeError(`${label}: нужен текст до ${max} символов.`);
      return value;
    };
    const source = plainRecord(raw.source, 'Источник фрагмента');
    exactKeys(source, ['sha256', 'size', 'trackIndex', 'trackName', 'fromBar', 'toBar'], 'Источник фрагмента');
    if (typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.sha256)) throw new RangeError('Источник фрагмента: некорректный SHA-256.');
    const fromBar = integer(source.fromBar, 1, 9999, 'Первый такт');
    const toBar = integer(source.toBar, fromBar, fromBar + 15, 'Последний такт');
    if (!Array.isArray(raw.bars) || raw.bars.length !== toBar - fromBar + 1) throw new RangeError('Фрагмент: число тактов не совпадает с источником.');
    let total = 0;
    const bars = raw.bars.map((value, barIndex): SongBar => {
      const bar = plainRecord(value, 'Такт фрагмента');
      exactKeys(bar, ['chord', 'events'], 'Такт фрагмента');
      const chord = bar.chord === null ? null : text(bar.chord, 'Аккорд', 16);
      if (!Array.isArray(bar.events) || !bar.events.length) throw new RangeError(`Такт ${fromBar + barIndex}: нет событий.`);
      let at = 0;
      const events = bar.events.map((item, eventIndex): SongEvent => {
        if (!Array.isArray(item) || (item.length !== 4 && item.length !== 5)) throw new RangeError('Событие фрагмента: ожидается [струна, лад, начало, длина] или продолжение лиги.');
        const [string, fret, start, length, tie] = item as unknown[];
        if (start !== at) throw new RangeError(`Такт ${fromBar + barIndex}: события идут подряд без пропусков.`);
        const grids = integer(length, 1, 16 - at, 'Длительность');
        at += grids;
        if (item.length === 5) {
          // Лига через черту: первое событие такта продолжает последнюю ноту прошлого такта той же позиции.
          const before = barIndex > 0 ? (raw.bars as { events?: unknown[] }[])[barIndex - 1]?.events?.at(-1) : undefined;
          if (tie !== 1 || eventIndex !== 0 || barIndex === 0 || !Array.isArray(before) || before[0] === null || before[0] !== string || before[1] !== fret) {
            throw new RangeError(`Такт ${fromBar + barIndex}: продолжение лиги — только первое событие такта той же струны и лада, что последняя нота прошлого.`);
          }
          return [oneOf(string, STRINGS, 'Струна'), integer(fret, 0, 24, 'Лад'), 0, grids, 1];
        }
        if (string === null && fret === null) return [null, null, start as number, grids];
        return [oneOf(string, STRINGS, 'Струна'), integer(fret, 0, 24, 'Лад'), start as number, grids];
      });
      if (at !== 16) throw new RangeError(`Такт ${fromBar + barIndex}: события должны занять весь такт 4/4.`);
      total += events.length;
      return { chord, events };
    });
    if (total > 512) throw new RangeError('Фрагмент: не больше 512 событий.');
    if (!bars.some(bar => bar.events.some(event => event[0] !== null))) throw new RangeError('Во фрагменте нет ни одной ноты.');
    return {
      title: text(raw.title, 'Название фрагмента', 80),
      source: { sha256: source.sha256, size: integer(source.size, 1, 2 ** 31, 'Размер файла'), trackIndex: integer(source.trackIndex, 0, 255, 'Партия'),
        trackName: text(source.trackName, 'Название партии', 60), fromBar, toBar },
      bpm: integer(raw.bpm, 40, 220, 'Темп фрагмента'),
      key: raw.key === null ? null : text(raw.key, 'Тональность', 8),
      bars,
    };
  },
  progression: raw => {
    const progression = oneOf(raw.progression, PROGRESSION_IDS, 'Последовательность');
    const pattern = oneOf(raw.pattern, PROGRESSION_PATTERNS, 'Рисунок');
    if (pattern === 'boogie' && progression !== 'blues-12') throw new RangeError('Буги-рисунок играется только по 12-тактовому блюзу.');
    return { root: noteName(raw.root, 'Тоника'), progression, pattern };
  },
};

const BUILDABLE = new Set<string>();
const MAX_BUILDABLE = 1024;

/** Проверяет описание целиком; ошибочные параметры отклоняются, а не исправляются. */
export function validateExerciseSpec(value: unknown): ExerciseSpec {
  const raw = plainRecord(value, 'Упражнение');
  exactKeys(raw, ['version', 'templateId', 'params'], 'Упражнение');
  if (raw.version !== 'exercise-v1') throw new RangeError('Неизвестная версия упражнения.');
  const templateId = oneOf(raw.templateId, [...byId.keys()], 'Шаблон') as ExerciseTemplateId;
  const params = plainRecord(raw.params, 'Параметры');
  exactKeys(params, Object.keys(getExerciseTemplate(templateId).defaults), 'Параметры');
  const spec = deepFreeze({ version: 'exercise-v1', templateId, params: PARAM_RULES[templateId](params) }) as ExerciseSpec;
  // Построение плана — проверка, что материал помещается на гриф; для формы по всему грифу оно стоит десятки миллисекунд.
  // Результат детерминирован, поэтому уже построенные описания запоминаются: история и копия с повторами одного
  // упражнения не перестраивают его план на каждой записи. Ошибки не запоминаются.
  const key = JSON.stringify(spec);
  if (!BUILDABLE.has(key)) {
    buildPlan(spec);
    if (BUILDABLE.size >= MAX_BUILDABLE) BUILDABLE.clear();
    BUILDABLE.add(key);
  }
  return spec;
}

/* ---------- Построение плана ---------- */

interface Draft { readonly position: AnnotatedPosition; readonly finger: number | null; readonly segment: number; readonly degree?: string | null; readonly stretch?: boolean; readonly pluck?: 'i' | 'm' | null }

const stringIndex = (string: StringId) => STRINGS.indexOf(string);
const byPitch = (a: AnnotatedPosition, b: AnnotatedPosition) => a.midi - b.midi || stringIndex(a.string) - stringIndex(b.string) || a.fret - b.fret;
const fromBox = (box: BoxInstance, notes: readonly AnnotatedPosition[], segment: number): Draft[] => notes.map(position => ({ position, finger: box.fingers[position.id] ?? null, segment }));
const plain = (notes: readonly AnnotatedPosition[], segment = 0): Draft[] => notes.map(position => ({ position, finger: null, segment }));
const annotate = (ids: readonly (readonly [StringId, number])[], structure: MusicalStructure) => annotatePositions(ids.map(([string, fret]) => getPosition(string, fret)), structure);

function lowestBox(root: string, structureId: StructureId, shapeId: BoxShapeId): BoxInstance {
  const box = getBoxCatalogue(root, structureId).find(candidate => candidate.selection.shapeId === shapeId);
  if (!box) throw new RangeError('Полная форма не помещается на ладах 1–24.');
  return box;
}
function sequence(box: BoxInstance, pattern: SequencePattern) {
  const structure = createStructure(box.selection.root, box.selection.structureId);
  return createSequence({ box: box.selection, positions: box.positions, structure, pattern }).notes;
}
const ascending = (box: BoxInstance) => sequence(box, 'ascending');
const descending = (box: BoxInstance) => sequence(box, 'descending');
function nextInChain(previous: BoxInstance, shapeId: BoxShapeId): BoxInstance {
  const next = getBoxCatalogue(previous.selection.root, previous.selection.structureId)
    .find(candidate => candidate.selection.shapeId === shapeId && getBoxOverlap(previous, candidate).length === 4);
  if (!next) throw new RangeError('Следующая форма цепочки не помещается на ладах 1–24.');
  return next;
}
const nextShape = (shapeId: PentaShape) => PENTA_SHAPES[(PENTA_SHAPES.indexOf(shapeId) + 1) % PENTA_SHAPES.length];
const formLabel = (box: BoxInstance) => `Форма ${SHAPE_LETTER[box.selection.shapeId as PentaShape]} · лады ${box.window.fretMin}–${box.window.fretMax}`;
const nearest = (candidates: readonly number[], target: number) => [...candidates].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0];
function rootFrets(root: string, string: StringId, min: number, max: number) {
  const pitch = parseNote(root).pitchClass;
  const frets: number[] = [];
  for (let fret = min; fret <= max; fret++) if (getPosition(string, fret).pitchClass === pitch) frets.push(fret);
  return frets;
}
function rootFiveEight(root: string, string: 'E' | 'A', fret: number, segment: number): Draft[] {
  const s = stringIndex(string);
  const notes = annotate([[string, fret], [STRINGS[s + 1], fret + 2], [STRINGS[s + 2], fret + 2], [STRINGS[s + 1], fret + 2]], createStructure(root, 'major-triad'));
  return plain(notes, segment);
}

/** Открытые струны рисунков правой руки: два такта восьмыми. */
const CROSSING_ORDER: Readonly<Record<CrossingPattern, readonly StringId[]>> = {
  adjacent: ['E', 'A', 'E', 'A', 'A', 'D', 'A', 'D', 'D', 'G', 'D', 'G', 'G', 'D', 'G', 'D'],
  skip: ['E', 'D', 'E', 'D', 'A', 'G', 'A', 'G', 'E', 'D', 'E', 'D', 'A', 'G', 'A', 'G'],
  raking: ['E', 'A', 'D', 'G', 'D', 'A', 'E', 'A', 'D', 'G', 'D', 'A', 'E', 'A', 'D', 'G'],
};
/** Написание открытых струн: E, A, D, G без знаков. */
const OPEN_STRINGS = createStructure('C', 'major');
const CROSSING_TITLES: Readonly<Record<CrossingPattern, string>> = { adjacent: 'Соседние струны', skip: 'Через струну', raking: 'Рейкинг' };
/**
 * Пальцы правой руки: строгое чередование i–m. В рейкинге при переходе на соседнюю более низкую по звуку
 * струну (G→D→A→E) палец не меняется — он «съезжает» на следующую струну.
 */
export function pluckOrder(strings: readonly StringId[], raking: boolean): ('i' | 'm')[] {
  const result: ('i' | 'm')[] = [];
  strings.forEach((string, index) => {
    if (!index) { result.push('i'); return; }
    const previous = result[index - 1];
    const rake = raking && STRINGS.indexOf(string) === STRINGS.indexOf(strings[index - 1]) - 1;
    result.push(rake ? previous : previous === 'i' ? 'm' : 'i');
  });
  return result;
}

type Built = { readonly drafts: readonly Draft[]; readonly segments: readonly string[]; readonly title?: string; readonly overlap?: 'shared' | 'none';
  readonly timing?: readonly { readonly note: number | null; readonly grids: number; readonly tie?: boolean }[] };

const BUILDERS: { readonly [Id in ExerciseTemplateId]: (params: ExerciseParams[Id]) => Built } = {
  'chromatic-position': ({ startFret }) => ({
    drafts: STRINGS.flatMap(string => [0, 1, 2, 3].map(offset => ({ position: chromatic(string, startFret + offset), finger: offset + 1, segment: 0, degree: null }))),
    segments: [`Позиция ${startFret} · пальцы 1-2-3-4`],
  }),
  'position-shift': ({ string, startFret, shifts }) => ({
    drafts: Array.from({ length: shifts + 1 }, (_, shift) => [0, 1, 2, 3].map(offset => ({ position: chromatic(string, startFret + shift + offset), finger: offset + 1, segment: shift, degree: null }))).flat(),
    segments: Array.from({ length: shifts + 1 }, (_, shift) => `Лады ${startFret + shift}–${startFret + shift + 3}`),
  }),
  'string-crossing': ({ pattern }) => {
    const order = CROSSING_ORDER[pattern];
    const plucks = pluckOrder(order, pattern === 'raking');
    return {
      drafts: order.map((string, index) => ({ position: annotate([[string, 0]], OPEN_STRINGS)[0], finger: null, segment: Math.floor(index / 8), degree: null, pluck: plucks[index] })),
      segments: [CROSSING_TITLES[pattern], CROSSING_TITLES[pattern]], overlap: 'none',
    };
  },
  'song-fragment': ({ title, bars, source, key }) => {
    const drafts: Draft[] = [];
    const timing: { note: number | null; grids: number; tie?: boolean }[] = [];
    const keyRoot = key ? key.replace(/m$/, '') : null;
    bars.forEach((bar, index) => {
      // Ступени — от тоники аккорда такта (и у «E5», «Asus»), без аккорда — от тональности.
      const chord = parseChord(bar.chord);
      const root = chord ? chord.root : keyRoot;
      for (const event of bar.events) {
        const [string, fret, , grids] = event;
        // Продолжение лиги — та же нота, без новой атаки и без своего номера в «Нота N из M».
        if (event.length === 5 && drafts.length) { timing.push({ note: drafts.length - 1, grids, tie: true }); continue; }
        if (string === null || fret === null) { timing.push({ note: null, grids }); continue; }
        const position = annotate([[string, fret]], createStructure(root ?? 'C', 'major'))[0];
        timing.push({ note: drafts.length, grids });
        drafts.push({ position, finger: null, segment: index, degree: root ? degreeFrom(root, position.midi) : null });
      }
    });
    return {
      drafts, timing, overlap: 'none', title,
      segments: bars.map((bar, index) => `${bar.chord ?? '—'} · такт ${source.fromBar + index}`),
    };
  },
  spider: ({ startFret, positions, pattern }) => {
    const fingers = [...pattern].map(Number);
    const drafts: Draft[] = [];
    const segments: string[] = [];
    for (let index = 0; index < positions; index++) {
      const fret = startFret + index;
      const strings = index % 2 === 0 ? STRINGS : [...STRINGS].reverse();
      for (const string of strings) for (const finger of fingers) drafts.push({ position: chromatic(string, fret + finger - 1), finger, segment: index, degree: null });
      segments.push(`Лады ${fret}–${fret + 3} · ${index % 2 === 0 ? 'E → G' : 'G → E'}`);
    }
    return { drafts, segments, overlap: 'none' };
  },
  'note-all-positions': ({ note }) => {
    const structure = createStructure(note, 'major');
    const positions = STRINGS.flatMap(string => rootFrets(note, string, 0, 12).map(fret => getPosition(string, fret)));
    return { drafts: plain([...annotatePositions(positions, structure)].sort(byPitch)), segments: [`Все ${structure.root} на ладах 0–12`] };
  },
  octaves: ({ note }) => {
    const structure = createStructure(note, 'major');
    const pairs = (['E', 'A'] as const).flatMap(string => rootFrets(note, string, 0, 10).map(fret => annotate([[string, fret], [STRINGS[stringIndex(string) + 2], fret + 2]], structure)));
    pairs.sort((a, b) => byPitch(a[0], b[0]));
    return { drafts: plain(pairs.flat()), segments: [`Октавы ${structure.root}`] };
  },
  'pentatonic-form': ({ root, structureId, shapeId }) => {
    const box = lowestBox(root, structureId, shapeId);
    return { drafts: fromBox(box, sequence(box, 'round-trip'), 0), segments: [formLabel(box)] };
  },
  'pentatonic-relative': ({ minorRoot, shapeId }) => {
    const box = lowestBox(minorRoot, 'minor-pentatonic', shapeId);
    const majorRoot = createStructure(minorRoot, 'natural-minor').notes[2].name;
    const major = createStructure(majorRoot, 'major-pentatonic');
    const up = annotatePositions(ascending(box), major);
    const down = descending(box).slice(1);
    return {
      drafts: [...fromBox(box, up, 0), ...fromBox(box, down, 1)],
      segments: [`${major.root} мажорная пентатоника · вверх`, `${box.selection.root} минорная пентатоника · вниз`],
      title: `${major.root} мажорная и ${box.selection.root} минорная пентатоника: одни ноты — разные тоники`,
    };
  },
  'scale-compact': ({ root, structureId, shapeId }) => {
    const box = lowestBox(root, structureId, shapeId);
    return { drafts: fromBox(box, sequence(box, 'round-trip'), 0), segments: [`Лады ${box.window.fretMin}–${box.window.fretMax}`] };
  },
  'blues-scale': ({ root, shapeId }) => {
    const box = lowestBox(root, 'blues', shapeId);
    return { drafts: fromBox(box, sequence(box, 'round-trip'), 0), segments: [`Лады ${box.window.fretMin}–${box.window.fretMax}`] };
  },
  'connect-forms': ({ root, structureId, shapeId }) => {
    const first = lowestBox(root, structureId, shapeId);
    const second = nextInChain(first, nextShape(shapeId));
    return { drafts: [...fromBox(first, ascending(first), 0), ...fromBox(second, descending(second), 1)], segments: [`${formLabel(first)} · вверх`, `${formLabel(second)} · вниз`] };
  },
  'pentatonic-neck': ({ root, structureId }) => {
    const start = getBoxCatalogue(root, structureId).find(box => PENTA_SHAPES.includes(box.selection.shapeId as PentaShape));
    if (!start) throw new RangeError('Цепочка форм не помещается на ладах 1–24.');
    const chain = [start];
    while (chain.length < 5) chain.push(nextInChain(chain.at(-1)!, nextShape(chain.at(-1)!.selection.shapeId as PentaShape)));
    return {
      drafts: chain.flatMap((box, index) => fromBox(box, index % 2 === 0 ? ascending(box) : descending(box), index)),
      segments: chain.map((box, index) => `${formLabel(box)} · ${index % 2 === 0 ? 'вверх' : 'вниз'}`),
    };
  },
  'scale-one-string': ({ root, structureId, string }) => {
    const structure = createStructure(root, structureId);
    const start = rootFrets(root, string, 0, 12)[0];
    const positions = annotatePositions(Array.from({ length: 13 }, (_, offset) => getPosition(string, start + offset)), structure).filter(position => position.inStructure);
    return { drafts: plain(positions), segments: [`Струна ${string} · лады ${start}–${start + 12}`] };
  },
  'scale-position': ({ root, structureId, degree }) => {
    const structure = createStructure(root, structureId);
    const start = rootFrets(structure.notes[degree - 1].name, 'E', 1, 12)[0];
    const candidates = [start, start - 1].filter(window => window >= 1).map(window => scalePosition(structure, start, window));
    const best = candidates.reduce((a, b) => b.stretches < a.stretches ? b : a);
    const up = best.drafts;
    const roundTrip = [...up, ...up.slice(1, -1).reverse()];
    return {
      drafts: roundTrip,
      segments: [`Позиция от ${structure.notes[degree - 1].name} (ступень ${formatDegree(structure.notes[degree - 1].degree)}) · лады ${best.window}–${best.window + 3}${best.stretches ? ` · растяжек: ${best.stretches}` : ''}`],
    };
  },
  'arpeggio-1358': ({ root, structureId, shapeId }) => {
    const box = lowestBox(root, structureId, shapeId);
    return { drafts: fromBox(box, sequence(box, 'round-trip'), 0), segments: [`Лады ${box.window.fretMin}–${box.window.fretMax}`] };
  },
  'arpeggio-seventh': ({ root, structureId, shapeId }) => {
    const box = lowestBox(root, structureId, shapeId);
    return { drafts: fromBox(box, sequence(box, 'round-trip'), 0), segments: [`Лады ${box.window.fretMin}–${box.window.fretMax}`] };
  },
  'arpeggio-inversion': ({ root, structureId, inversion }) => inversionPlan(createStructure(root, structureId), inversion),
  'root-five-eight': ({ root, string }) => {
    const fret = rootFrets(root, string, 1, 22)[0];
    return { drafts: rootFiveEight(root, string, fret, 0), segments: [`${parseNote(root).name} · ${string}/${fret}`] };
  },
  'groups-of-three': ({ root, structureId, shapeId }) => {
    const box = lowestBox(root, structureId, shapeId);
    return { drafts: fromBox(box, sequence(box, 'groups-of-three'), 0), segments: [formLabel(box)] };
  },
  thirds: ({ root, structureId, shapeId }) => {
    const box = lowestBox(root, structureId, shapeId);
    const unique = ascending(box);
    return { drafts: fromBox(box, unique.slice(0, -2).flatMap((note, index) => [note, unique[index + 2]]), 0), segments: [`Лады ${box.window.fretMin}–${box.window.fretMax}`] };
  },
  'form-transpose': ({ structureId, shapeId, roots }) => {
    const first = lowestBox(roots[0], structureId, shapeId);
    const boxes = roots.map((root, index) => {
      if (index === 0) return first;
      const candidates = getBoxCatalogue(root, structureId).filter(box => box.selection.shapeId === shapeId);
      const fret = nearest(candidates.map(box => box.window.fretMin), first.window.fretMin);
      return candidates.find(box => box.window.fretMin === fret)!;
    });
    return {
      drafts: boxes.flatMap((box, index) => fromBox(box, sequence(box, 'round-trip'), index)),
      segments: boxes.map(box => `${box.selection.root} · лады ${box.window.fretMin}–${box.window.fretMax}`),
    };
  },
  'cycle-fourths': ({ root, count }) => {
    const roots = [parseNote(root).name];
    while (roots.length < count) roots.push(createStructure(roots.at(-1)!, 'major').notes[3].name);
    // На ладах 1–12 струны E каждая нота встречается ровно один раз.
    const segments: string[] = [];
    const drafts = roots.flatMap((current, index) => {
      const fret = rootFrets(current, 'E', 1, 12)[0];
      segments.push(`${current} · E/${fret}`);
      return rootFiveEight(current, 'E', fret, index);
    });
    return { drafts, segments };
  },
  progression: ({ root, progression, pattern }) => progressionPlan(root, progression, pattern),
};

/**
 * Обращение трезвучия (D-049): тоны аккорда по возрастанию — от 3-й (1-е обращение) или 5-й (2-е) ступени через
 * остальные тоны к октаве начального — в окне из четырёх ладов «палец на лад», на струнах не ниже предыдущей.
 * Начало — нота обращения на струне E или A на самом низком подходящем ладу 1–15 (при равенстве — на E); туда и обратно.
 * Первому обращению уменьшённого нужны все четыре струны, поэтому от D, E♭ и E оно строится в верхней позиции.
 */
function inversionPlan(structure: MusicalStructure, inversion: number): Built {
  const [first, third, fifth] = structure.notes;
  const order = inversion === 1 ? [third, fifth, first] : [fifth, first, third];
  const starts = (['E', 'A'] as const).flatMap(string => rootFrets(order[0].name, string, 1, 15).map(fret => ({ string, fret })))
    .sort((a, b) => a.fret - b.fret || STRINGS.indexOf(a.string) - STRINGS.indexOf(b.string));
  for (const { string: startString, fret } of starts) {
    {
      const startMidi = getPosition(startString, fret).midi;
      const midis = [startMidi];
      for (const tone of order.slice(1)) {
        let midi = midis.at(-1)! + 1;
        while (midi % 12 !== tone.pitchClass) midi++;
        midis.push(midi);
      }
      midis.push(startMidi + 12);
      for (let window = fret; window >= Math.max(1, fret - 3); window--) {
        const placed: { string: StringId; fret: number }[] = [];
        let lowestString = STRINGS.indexOf(startString);
        for (const midi of midis) {
          const candidate = STRINGS.slice(lowestString).map(string => ({ string, fret: midi - getPosition(string, 0).midi }))
            .find(option => option.fret >= window && option.fret <= window + 3);
          if (!candidate) break;
          placed.push(candidate);
          lowestString = STRINGS.indexOf(candidate.string);
        }
        if (placed.length !== midis.length) continue;
        const up = placed.map(({ string, fret: at }) => ({ position: annotate([[string, at]], structure)[0], finger: at - window + 1, segment: 0 }));
        return {
          drafts: [...up, ...up.slice(0, -1).reverse()],
          segments: [`${inversion === 1 ? '1-е' : '2-е'} обращение · от ${order[0].name} · лады ${window}–${window + 3}`],
        };
      }
    }
  }
  throw new RangeError('Обращение не помещается в окно из четырёх ладов на ладах 1–15.');
}

const PROGRESSION_CHORDS: Readonly<Record<ProgressionId, readonly (readonly [number, StructureId, string])[]>> = {
  'I-IV-V': [[1, 'major-triad', 'I'], [4, 'major-triad', 'IV'], [5, 'major-triad', 'V'], [1, 'major-triad', 'I']],
  'ii-V-I': [[2, 'minor-seventh', 'ii7'], [5, 'dominant-seventh', 'V7'], [1, 'major-seventh', 'Imaj7'], [1, 'major-seventh', 'Imaj7']],
  'blues-12': [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5].map(degree => [degree, 'dominant-seventh', degree === 1 ? 'I7' : degree === 4 ? 'IV7' : 'V7'] as const),
};
const CHORD_SYMBOL: Partial<Readonly<Record<StructureId, string>>> = { 'minor-triad': 'm', 'major-seventh': 'maj7', 'dominant-seventh': '7', 'minor-seventh': 'm7' };

/**
 * Игра по последовательности (D-049): такт = восемь восьмых = один аккорд. Тоника аккорда — компактная форма
 * от E или A (лады ≥ 1): у первого аккорда — самая низкая с тоникой на 3-м ладу и выше, дальше — ближайшая
 * по ладу к предыдущей тонике (при равенстве — на E). Ступени подписываются от тоники своего аккорда.
 */
function progressionPlan(root: string, progression: ProgressionId, pattern: ProgressionPattern): Built {
  const key = createStructure(root, 'major');
  const chords = PROGRESSION_CHORDS[progression].map(([degree, structureId, roman]) => ({ root: key.notes[degree - 1].name, structureId, roman }));
  const order = (a: BoxInstance, b: BoxInstance) => a.selection.anchorFret - b.selection.anchorFret || STRINGS.indexOf(a.selection.anchorString) - STRINGS.indexOf(b.selection.anchorString);
  const boxes: BoxInstance[] = [];
  for (const chord of chords) {
    const candidates = getBoxCatalogue(chord.root, chord.structureId).filter(box => box.selection.shapeId.startsWith('compact-') && box.selection.anchorFret >= 2);
    if (!candidates.length) throw new RangeError('Форма аккорда не помещается на грифе.');
    const previous = boxes.at(-1);
    const sorted = previous
      ? [...candidates].sort((a, b) => Math.abs(a.selection.anchorFret - previous.selection.anchorFret) - Math.abs(b.selection.anchorFret - previous.selection.anchorFret) || order(a, b))
      : [...candidates].sort((a, b) => Number(b.selection.anchorFret >= 3) - Number(a.selection.anchorFret >= 3) || order(a, b));
    boxes.push(sorted[0]);
  }
  const drafts: Draft[] = [];
  boxes.forEach((box, index) => {
    const tones = [...box.positions].sort(byPitch);
    const rootPosition = tones[0];
    const byDegree = (pattern: RegExp, above = rootPosition.midi) => tones.find(tone => pattern.test(tone.degree ?? '') && tone.midi > above);
    const third = byDegree(/^b?3$/)!; const fifth = byDegree(/^b?5$/)!; const seventh = byDegree(/^b?7$/);
    const octave = tones.find(tone => tone.degree === '1' && tone.midi === rootPosition.midi + 12);
    const note = (position: AnnotatedPosition): Draft => ({ position, finger: box.fingers[position.id] ?? null, segment: index, degree: position.degree });
    let bar: Draft[];
    if (pattern === 'roots') bar = Array.from({ length: 8 }, () => note(rootPosition));
    else if (pattern === 'root-fifth') bar = [rootPosition, rootPosition, fifth, fifth, rootPosition, rootPosition, fifth, fifth].map(note);
    else if (pattern === 'octaves') bar = Array.from({ length: 8 }, (_, step) => note(step % 2 && octave ? octave : rootPosition));
    else if (pattern === 'boogie') bar = boogieBar(box, index);
    else {
      const arpeggio = seventh && octave ? [rootPosition, third, fifth, seventh, octave, seventh, fifth, third] : [rootPosition, third, fifth, third, rootPosition, third, fifth, third];
      bar = arpeggio.map(note);
      if (pattern === 'approach') bar[7] = approachNote(boxes[(index + 1) % boxes.length], box, index);
    }
    drafts.push(...bar);
  });
  return {
    drafts, overlap: 'none',
    segments: chords.map(chord => `${chord.root}${CHORD_SYMBOL[chord.structureId] ?? ''} · ${chord.roman}`),
  };
}

/** Хроматический подход: полутон снизу к тонике следующего аккорда на её струне (на 1-м ладу — сверху); без пальца и ступени. */
function approachNote(next: BoxInstance, current: BoxInstance, segment: number): Draft {
  const { anchorString, anchorFret } = next.selection;
  const fret = anchorFret - 1 >= 1 ? anchorFret - 1 : anchorFret + 1;
  return { position: annotate([[anchorString, fret]], createStructure(current.selection.root, current.selection.structureId))[0], finger: null, segment, degree: null };
}

/** Буги 1-3-5-6-♭7-6-5-3 от тоники формы: 3 и 6 — на лад ниже тоники, 5 — на два выше, ♭7 — на её ладу. */
function boogieBar(box: BoxInstance, segment: number): Draft[] {
  const { anchorString, anchorFret: fret } = box.selection;
  const s = STRINGS.indexOf(anchorString);
  if (fret - 1 < 1) throw new RangeError('Буги-рисунку нужен лад ниже тоники.');
  const structure = createStructure(box.selection.root, 'dominant-seventh');
  const cells: readonly (readonly [number, number, string])[] = [[0, 0, '1'], [1, -1, '3'], [1, 2, '5'], [2, -1, '6'], [2, 0, 'b7'], [2, -1, '6'], [1, 2, '5'], [1, -1, '3']];
  return cells.map(([row, offset, degree]) => ({
    position: annotate([[STRINGS[s + row], fret + offset]], structure)[0], finger: offset === -1 ? 1 : offset === 0 ? 2 : 4, segment, degree,
  }));
}

/**
 * Позиция «палец на лад» (R-026): окно window…window+3 от стартовой ноты на E; пропущенные ноты гаммы
 * между соседними нотами окна берутся растяжкой мизинцем на window+4, а если на этой струне мизинец уже стоит на window+3 или такой позиции нет — указательным на window−1.
 */
function scalePosition(structure: MusicalStructure, start: number, window: number) {
  const lowest = getPosition('E', start).midi;
  const inScale = new Set(structure.notes.map(note => note.pitchClass));
  const inWindow = annotatePositions(STRINGS.flatMap(string => [0, 1, 2, 3].map(offset => getPosition(string, window + offset))), structure)
    .filter(position => position.inStructure && position.midi >= lowest).sort(byPitch);
  const drafts: Draft[] = [];
  let stretches = 0;
  const at = (midi: number, fret: number) => STRINGS.map(string => ({ string, fret: midi - getPosition(string, 0).midi })).find(candidate => candidate.fret === fret);
  inWindow.forEach((position, index) => {
    const previous = inWindow[index - 1];
    if (previous) for (let midi = previous.midi + 1; midi < position.midi; midi++) {
      if (!inScale.has(midi % 12)) continue;
      const forward = window + 4 <= 24 ? at(midi, window + 4) : undefined;
      const back = window - 1 >= 1 ? at(midi, window - 1) : undefined;
      // Мизинец не ставится два раза подряд на одной струне (лад window+3 уже занят им).
      const pinkyBusy = forward && inWindow.some(note => note.string === forward.string && note.fret === window + 3);
      const choice = pinkyBusy ? back ?? forward : forward ?? back;
      if (!choice) throw new RangeError('Позиция требует растяжки больше чем на один лад.');
      drafts.push({ position: annotate([[choice.string, choice.fret]], structure)[0], finger: choice.fret > window ? 4 : 1, segment: 0, stretch: true });
      stretches++;
    }
    drafts.push({ position, finger: position.fret - window + 1, segment: 0 });
  });
  return { drafts, stretches, window };
}

const CHROMATIC_LABELS = createStructure('C', 'major');
function chromatic(string: StringId, fret: number) { return annotatePositions([getPosition(string, fret)], CHROMATIC_LABELS)[0]; }

function buildPlan(spec: ExerciseSpec): ExercisePlan {
  const template = getExerciseTemplate(spec.templateId);
  const built = (BUILDERS[spec.templateId] as (params: ExerciseSpec['params']) => Built)(spec.params);
  if (!built.drafts.length) throw new RangeError('Упражнение не содержит нот.');
  const notes = built.drafts.map(({ position, finger, segment, degree, stretch, pluck }) => ({
    id: position.id, string: position.string, fret: position.fret, midi: position.midi,
    name: formatMidi(position.midi, position.noteName), degree: degree === undefined ? position.degree : degree, finger, stretch: stretch ?? false, segment,
    pluck: pluck ?? null,
  }));
  return deepFreeze({
    spec, title: built.title ?? template.title, category: template.category, concepts: template.concepts,
    segments: built.segments.map(label => ({ label })), task: TEMPLATE_TASKS[spec.templateId], notes, positions: built.drafts.map(draft => draft.position),
    overlap: built.overlap ?? 'shared',
    cadence: TONIC_CADENCE.has(spec.templateId) && notes.some(note => note.degree === '1') ? 'tonic' : 'none',
    timing: built.timing ?? null,
  });
}
/**
 * Цель темпа шаблона, четверти в минуту при восьмых (D-050): с неё начинается «Цель» экрана игры и по ней
 * засчитывается освоение шага цели. Ориентир уверенной игры, а не предел.
 */
export const TEMPLATE_TARGET_BPM: Readonly<Record<ExerciseTemplateId, number>> = Object.freeze({
  'chromatic-position': 100, 'position-shift': 100, spider: 96, 'string-crossing': 100, 'note-all-positions': 80, octaves: 84,
  'pentatonic-form': 96, 'pentatonic-relative': 92, 'scale-compact': 96, 'blues-scale': 96, 'connect-forms': 92, 'pentatonic-neck': 88,
  'scale-one-string': 88, 'scale-position': 92, 'arpeggio-1358': 96, 'arpeggio-seventh': 92, 'arpeggio-inversion': 88, 'root-five-eight': 100,
  'groups-of-three': 88, thirds: 88, 'form-transpose': 88, 'cycle-fourths': 84, progression: 100, 'song-fragment': 0,
});
/** Цель темпа материала: у фрагмента песни — темп партитуры, у остальных — цель шаблона. */
export const targetBpmFor = (spec: ExerciseSpec): number => spec.templateId === 'song-fragment' ? spec.params.bpm : TEMPLATE_TARGET_BPM[spec.templateId];

/** Шаблоны, проход которых завершается тоникой: формы, гаммы, арпеджио, секвенции, транспонирование. */
const TONIC_CADENCE: ReadonlySet<ExerciseTemplateId> = new Set<ExerciseTemplateId>([
  'pentatonic-form', 'pentatonic-relative', 'scale-compact', 'blues-scale', 'connect-forms', 'pentatonic-neck', 'scale-one-string',
  'scale-position', 'arpeggio-1358', 'arpeggio-seventh', 'arpeggio-inversion', 'root-five-eight', 'groups-of-three', 'thirds',
  'form-transpose', 'cycle-fourths',
]);

/**
 * Структура, по которой у материала есть ступени для «Проверь себя».
 * У хроматики, смены позиции, нот по грифу, октав, транспонирования формы и квинтового круга
 * одной тоники с осмысленными ступенями нет — проверка ступеней для них недоступна.
 */
export function exerciseStructure(spec: ExerciseSpec): MusicalStructure | null {
  switch (spec.templateId) {
    case 'pentatonic-form': case 'scale-compact': case 'connect-forms': case 'pentatonic-neck': case 'scale-one-string':
    case 'scale-position': case 'arpeggio-1358': case 'groups-of-three': case 'thirds':
      return createStructure(spec.params.root, spec.params.structureId);
    case 'arpeggio-seventh': case 'arpeggio-inversion':
      return createStructure(spec.params.root, spec.params.structureId);
    case 'blues-scale': return createStructure(spec.params.root, 'blues');
    case 'pentatonic-relative': return createStructure(spec.params.minorRoot, 'minor-pentatonic');
    case 'root-five-eight': return createStructure(spec.params.root, 'major-triad');
    default: return null;
  }
}

/** План упражнения по проверенному описанию. Тот же список позиций читают гриф, TAB, звук и история. */
export function buildExercise(spec: ExerciseSpec): ExercisePlan {
  return buildPlan(validateExerciseSpec(spec));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

/* ---------- Настройка упражнения на карточке (D-049) ---------- */

export interface TemplateOptionValue { readonly value: string | number; readonly label: string }
/** Настраиваемый параметр шаблона: подпись и допустимые значения (структуры подписывает интерфейс). */
export interface TemplateOption { readonly param: string; readonly label: string; readonly values: readonly TemplateOptionValue[] }

export const NOTE_CHOICES: readonly string[] = Object.freeze(['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']);
const PENTA_STRUCTURES = ['minor-pentatonic', 'major-pentatonic'] as const;
const SCALE_STRUCTURES = ['major', 'natural-minor'] as const;
const COMPACT_SHAPES = ['compact-e', 'compact-a'] as const;
const PROGRESSION_NAMES: Readonly<Record<ProgressionId, string>> = { 'I-IV-V': 'I–IV–V', 'ii-V-I': 'ii–V–I', 'blues-12': 'блюз 12 тактов' };
const PATTERN_NAMES: Readonly<Record<ProgressionPattern, string>> = { roots: 'тоники', 'root-fifth': 'тоника и квинта', octaves: 'октавы', arpeggio: 'арпеджио', approach: 'арпеджио и подходы', boogie: 'буги' };
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const option = <T extends string | number>(param: string, label: string, values: readonly T[], name: (value: T) => string = String): TemplateOption =>
  ({ param, label, values: values.map(value => ({ value, label: name(value) })) });
const notes = (param: string, label = 'Тоника') => option(param, label, NOTE_CHOICES);
const pentaShape = option('shapeId', 'Форма', PENTA_SHAPES, shape => `форма ${SHAPE_LETTER[shape]}`);
const compactShape = option('shapeId', 'Форма', COMPACT_SHAPES, shape => (shape === 'compact-e' ? 'от струны E' : 'от струны A'));
const structures = (values: readonly string[]) => option('structureId', 'Структура', values);
const pentaForm = [notes('root'), structures(PENTA_STRUCTURES), pentaShape];

const OPTIONS: { readonly [Id in ExerciseTemplateId]: readonly TemplateOption[] } = {
  'chromatic-position': [option('startFret', 'Лад', range(1, 12))],
  'position-shift': [option('string', 'Струна', STRINGS), option('startFret', 'С лада', range(1, 12)), option('shifts', 'Сдвигов', range(1, 4))],
  'string-crossing': [option('pattern', 'Рисунок', CROSSING_PATTERNS, pattern => CROSSING_TITLES[pattern].toLowerCase())],
  spider: [option('startFret', 'С лада', range(1, 12)), option('positions', 'Позиций', range(2, 12)), option('pattern', 'Пальцы', SPIDER_PATTERNS, pattern => [...pattern].join('-'))],
  'note-all-positions': [notes('note', 'Нота')],
  octaves: [notes('note', 'Нота')],
  'pentatonic-form': pentaForm,
  'pentatonic-relative': [notes('minorRoot', 'Тоника минора'), pentaShape],
  'scale-compact': [notes('root'), structures(SCALE_STRUCTURES), compactShape],
  'blues-scale': [notes('root'), compactShape],
  'connect-forms': pentaForm,
  'pentatonic-neck': [notes('root'), structures(PENTA_STRUCTURES)],
  'scale-one-string': [notes('root'), structures(SCALE_STRUCTURES), option('string', 'Струна', STRINGS)],
  'scale-position': [notes('root'), structures(SCALE_STRUCTURES), option('degree', 'Позиция', range(1, 7), degree => `от ${degree}-й ступени`)],
  'arpeggio-1358': [notes('root'), structures(TRIADS), compactShape],
  'arpeggio-seventh': [notes('root'), structures(SEVENTHS), compactShape],
  'arpeggio-inversion': [notes('root'), structures(TRIADS), option('inversion', 'Обращение', [1, 2], inversion => `${inversion}-е`)],
  'root-five-eight': [notes('root'), option('string', 'Струна', ['E', 'A'])],
  'groups-of-three': pentaForm,
  thirds: [notes('root'), structures(SCALE_STRUCTURES), compactShape],
  'form-transpose': [structures(PENTA_STRUCTURES), pentaShape],
  'cycle-fourths': [notes('root'), option('count', 'Тоник', range(2, 12))],
  'song-fragment': [],
  progression: [notes('root', 'Тональность'), option('progression', 'Последовательность', PROGRESSION_IDS, id => PROGRESSION_NAMES[id]), option('pattern', 'Рисунок', PROGRESSION_PATTERNS, id => PATTERN_NAMES[id])],
};

/** Настраиваемые параметры шаблона: статические списки, без перебора построений. */
export const templateOptions = (templateId: ExerciseTemplateId): readonly TemplateOption[] => OPTIONS[templateId];

/**
 * Меняет один параметр материала. Если сочетание недопустимо, подстраивает зависимые параметры (форма, число позиций
 * паука, рисунок последовательности) под первое допустимое; иначе — исходная ошибка: материал не исправляется молча.
 */
export function configureSpec(spec: ExerciseSpec, param: string, value: string | number): ExerciseSpec {
  const params: Record<string, unknown> = { ...(spec.params as Record<string, unknown>), [param]: value };
  const attempt = (patch: Record<string, unknown> = {}) => validateExerciseSpec({ version: 'exercise-v1', templateId: spec.templateId, params: { ...params, ...patch } });
  try { return attempt(); } catch (failure) {
    const patches: Record<string, unknown>[] = [];
    if (spec.templateId === 'spider') patches.push({ positions: Math.max(2, 14 - Number(params.startFret)) }, { startFret: Math.max(1, 14 - Number(params.positions)) });
    if (spec.templateId === 'progression') patches.push({ pattern: 'roots' }, { progression: 'blues-12' });
    if ('shapeId' in params) {
      const shapes = String(params.shapeId).startsWith('penta-') ? PENTA_SHAPES : COMPACT_SHAPES;
      for (const shapeId of shapes) patches.push({ shapeId });
    }
    // Выбранный пользователем параметр не подстраивается — только зависимые.
    for (const patch of patches.filter(candidate => !(param in candidate))) {
      try { return attempt(patch); } catch { /* Следующее допустимое сочетание. */ }
    }
    throw failure;
  }
}
