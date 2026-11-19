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
import { degreeFrom, parseChord, type ChordInfo } from '../music/chords';
import { createSequence, type SequencePattern } from '../training';
import { TEMPLATE_TASKS, type TemplateTask } from './tasks';
import { barLayout, isRhythmPatternId, rhythmPattern, RHYTHM_PATTERNS, type RhythmPatternId } from './rhythm';
import { approachFret, approachName, barTones, chordFamily, letterIndex, lowTonic, openTonic, passingNotes, patternFits, placeTones, spellNote, toneName, walkingBar, type PassingNote, type Tone, type Tonic } from './bars';

export { TASK_LINE_MAX, TEMPLATE_TASKS, type TemplateTask } from './tasks';

export type ExerciseCategory = 'warmup' | 'notes' | 'forms' | 'connections' | 'positions' | 'arpeggios' | 'sequences' | 'transposition' | 'progressions' | 'riffs';
export type ConceptId =
  | 'finger-per-fret' | 'position-shift' | 'semitone' | 'octave' | 'unison' | 'degrees' | 'pentatonic' | 'relative-keys'
  | 'scale-formula' | 'shared-notes' | 'form-system' | 'triad' | 'fifth' | 'sequence' | 'third' | 'transposition' | 'circle-of-fifths'
  | 'seventh-chord' | 'inversion' | 'progression' | 'blues' | 'right-hand' | 'finger-independence';

type Pentatonic = 'minor-pentatonic' | 'major-pentatonic';
type Scale = 'major' | 'natural-minor';
type Triad = 'major-triad' | 'minor-triad' | 'diminished-triad';
type Seventh = 'major-seventh' | 'dominant-seventh' | 'minor-seventh' | 'half-diminished-seventh';
/** Порядок пальцев «паука»: все 24 перестановки 1-2-3-4 (P19, часть C). */
export type SpiderPattern =
  | '1234' | '1324' | '1243' | '1432' | '1342' | '1423'
  | '2134' | '2143' | '2314' | '2341' | '2413' | '2431'
  | '3124' | '3142' | '3214' | '3241' | '3412' | '3421'
  | '4123' | '4132' | '4213' | '4231' | '4312' | '4321';
/** Путь «паука»: прямо — четыре пальца на струне; по диагонали — по пальцу на струну E→G и обратно. */
export type SpiderPath = 'straight' | 'diagonal';
export const SPIDER_PATHS: readonly SpiderPath[] = ['straight', 'diagonal'];
/** Шаг сдвига «Смены позиции по струне», лады: 1 — соседняя позиция, дальше — скачки. */
export type ShiftJump = 1 | 2 | 3 | 5 | 7 | 12;
export const SHIFT_JUMPS: readonly ShiftJump[] = [1, 2, 3, 5, 7, 12];
/** Пара пальцев левой руки для упражнения на независимость. */
export type FingerPair = '12' | '13' | '14' | '23' | '24' | '34';
export const FINGER_PAIRS: readonly FingerPair[] = ['12', '13', '14', '23', '24', '34'];
/** Число нот в группе секвенции. */
export type SequenceGroup = 3 | 4;
export const SEQUENCE_GROUPS: readonly SequenceGroup[] = [3, 4];
export type ProgressionId = 'I-IV-V' | 'ii-V-I' | 'blues-12' | 'I-V-vi-IV' | 'I-vi-IV-V' | 'i-iv-v' | 'i-iv' | 'i-V-i' | 'i-VII-VI-V' | 'diatonic';
export type ProgressionPattern = 'roots' | 'root-fifth' | 'octaves' | 'arpeggio' | 'approach' | 'boogie' | 'r5b78' | 'r56' | 'roots-approach' | 'roots-passing' | 'walking';
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

/** Аппликатура и направление хроматики, позиция последовательности (R-028, A1/B7): форма введена сейчас, значения добавляются новыми значениями списков без повышения версии. */
export type Fingering = '1234' | '124';
export type Direction = 'up' | 'up-down';
export type ProgressionPosition = 'closed' | 'low' | 'open';
export const FINGERINGS: readonly Fingering[] = ['1234', '124'];
export const DIRECTIONS: readonly Direction[] = ['up', 'up-down'];
/** Число нот «Пульса на одной ноте»: 16 — четыре такта четвертями, 8 — «нота — пауза», 32 — два такта шестнадцатыми (A5). */
/** Риффы (R-028, B4): типовые стилевые фигуры без привязки к песне; список дополняется без повышения версии. */
export type RiffId = 'rock-eighths' | 'approach-eighths' | 'disco-octaves' | 'penta-a' | 'shift-ab' | 'boogie-12' | 'fourths-cycle' | 'three-forms';
export const RIFF_IDS: readonly RiffId[] = ['rock-eighths', 'approach-eighths', 'disco-octaves', 'penta-a', 'shift-ab', 'boogie-12', 'fourths-cycle', 'three-forms'];
/** «Своя линия» (R-028, B5): тональность, лад, позиция и такты — аккорд относительно тоники, рисунок такта и его ритм. */
export type LineMode = 'major' | 'minor';
export type LinePosition = 'closed' | 'low';
export type LineChord = 'major-triad' | 'minor-triad' | 'dominant-seventh' | 'minor-seventh' | 'major-seventh';
export const LINE_CHORDS: readonly LineChord[] = ['major-triad', 'minor-triad', 'dominant-seventh', 'minor-seventh', 'major-seventh'];
export interface LineBar { readonly step: number; readonly chord: LineChord; readonly pattern: ProgressionPattern; readonly rhythm: RhythmPatternId }
export const LINE_MIN_BARS = 2;
export const LINE_MAX_BARS = 16;
/** «Интервал от ноты» (R-028, A8.2): малые и большие секунды, сексты, септимы вверх и вниз; список дополняется без повышения версии. */
export type IntervalId = 'min2' | 'maj2' | 'min6' | 'maj6' | 'min7' | 'maj7';
export const INTERVAL_IDS: readonly IntervalId[] = ['min2', 'maj2', 'min6', 'maj6', 'min7', 'maj7'];
export type IntervalDirection = 'up' | 'down';
export const INTERVAL_DIRECTIONS: readonly IntervalDirection[] = ['up', 'down'];
export type PulseNotes = 8 | 16 | 32;
export const PULSE_NOTES: readonly PulseNotes[] = [8, 16, 32];
/** Натуральные ноты струны: до 5-го лада у порожка или до 12-го (A6.1). */
export type NaturalsFretMax = 5 | 12;
export const NATURALS_FRET_MAX: readonly NaturalsFretMax[] = [5, 12];
export const PROGRESSION_POSITIONS: readonly ProgressionPosition[] = ['closed', 'low', 'open'];

export interface ExerciseParams {
  readonly 'chromatic-position': { readonly startFret: number; readonly fingering: Fingering; readonly direction: Direction };
  readonly 'position-shift': { readonly string: StringId; readonly startFret: number; readonly shifts: number; readonly jump: ShiftJump };
  readonly spider: { readonly startFret: number; readonly positions: number; readonly pattern: SpiderPattern; readonly path: SpiderPath };
  /** Лад 0 — открытые струны; 1–12 — нота на этом ладу первым пальцем (P19). */
  readonly 'string-crossing': { readonly pattern: CrossingPattern; readonly fret: number };
  /** Пары пальцев: a-b-a-b на каждой струне E→G и обратно (P19). */
  readonly 'finger-pairs': { readonly startFret: number; readonly pair: FingerPair };
  /** Растяжка «тон-тон» 1-2-4 по позициям от середины грифа к порожку (P19). */
  readonly stretch: { readonly startFret: number; readonly positions: number };
  /** Пульс правой рукой на одной ноте (R-028, A5). */
  readonly 'pulse-note': { readonly string: StringId; readonly fret: number; readonly notes: PulseNotes };
  /** Интервал от ноты: пары «нота — нота интервала» на всех струнах, где форма помещается на ладах 1–12 (A8.2). */
  readonly 'interval-from-note': { readonly note: string; readonly interval: IntervalId; readonly direction: IntervalDirection };
  /** Круг кварт на струне: двенадцать нот C F B♭ … G на ладах 0–11 (A6.2). */
  readonly 'string-fourths': { readonly string: StringId };
  /** Длинные и короткие ноты: половина прохода звучит полностью, половина — вполовину (A8.1). */
  readonly 'long-short': { readonly string: StringId; readonly fret: number };
  /** Хроматика по позициям: ход вверх по грифу и обратно (A7.2). */
  readonly 'chromatic-shift': { readonly startFret: number; readonly positions: number };
  /** Натуральные ноты на одной струне, туда и обратно (A6.1). */
  readonly 'string-naturals': { readonly string: StringId; readonly fretMax: NaturalsFretMax };
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
  /** Гамма в две октавы по три ноты на струну со сдвигом по струне G (P19). */
  readonly 'scale-two-octaves': { readonly root: string; readonly structureId: Scale };
  /** Гамма по всему грифу: позиции «палец на лад» змейкой (P19). */
  readonly 'scale-neck': { readonly root: string; readonly structureId: Scale };
  readonly 'arpeggio-1358': { readonly root: string; readonly structureId: Triad; readonly shapeId: CompactShape };
  readonly 'arpeggio-seventh': { readonly root: string; readonly structureId: Seventh; readonly shapeId: CompactShape };
  readonly 'arpeggio-inversion': { readonly root: string; readonly structureId: Triad; readonly inversion: number };
  readonly 'root-five-eight': { readonly root: string; readonly string: 'E' | 'A' };
  /** Секвенция группами по 3 или 4: пентатоника — формы `penta-*`, гаммы — компактные формы (P19). */
  readonly 'groups-of-three': { readonly root: string; readonly structureId: Pentatonic | Scale; readonly shapeId: PentaShape | CompactShape; readonly group: SequenceGroup };
  readonly thirds: { readonly root: string; readonly structureId: Scale; readonly shapeId: CompactShape };
  readonly 'form-transpose': { readonly structureId: Pentatonic; readonly shapeId: PentaShape; readonly roots: readonly string[] };
  readonly 'cycle-fourths': { readonly root: string; readonly count: number };
  readonly progression: { readonly root: string; readonly progression: ProgressionId; readonly pattern: ProgressionPattern; readonly position: ProgressionPosition };
  /** Рифф: фигура такта по аккордам последовательности, ритм задан материалом (B4). */
  readonly riff: { readonly riff: RiffId; readonly root: string };
  /** Своя линия: такты из аккордов, рисунков и ритмов (B5). Только своё упражнение; собирает конструктор. */
  readonly line: { readonly root: string; readonly mode: LineMode; readonly position: LinePosition; readonly bars: readonly LineBar[] };
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
  /** Доля шага, которую звучит эталон (A3): 1 — длинная нота, 0,5 — короткая; `null` — обычная длительность. */
  readonly gate: number | null;
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
  /**
   * Такты последовательности (R-028, B2.1, B3): на такт — форма Q (по ноте на долю), форма E (по ноте на восьмую)
   * и хвост (подход, проходящие) — индексы нот плана. Какую форму и какие ноты звучит такт, решает ритм: `buildTimeline`.
   */
  readonly bars: readonly BarForms[] | null;
}
/** Индексы нот плана для одного такта: четыре ноты формы Q, восемь нот формы E, ноты хвоста (последние атаки такта). */
export interface BarForms { readonly q: readonly number[]; readonly e: readonly number[]; readonly tail: readonly number[] }
export interface ExerciseTemplate<Id extends ExerciseTemplateId = ExerciseTemplateId> {
  readonly id: Id; readonly category: ExerciseCategory; readonly title: string;
  readonly concepts: readonly ConceptId[]; readonly defaults: ExerciseParams[Id];
  /** Только своё упражнение: не показывается в библиотеке и рекомендациях. */
  readonly userOnly?: boolean;
}

const STRINGS: readonly StringId[] = ['E', 'A', 'D', 'G'];
/** Сначала четыре прежних порядка (в списке «Пальцы» они остаются первыми), затем остальные по возрастанию. */
export const SPIDER_PATTERNS: readonly SpiderPattern[] = [
  '1234', '1324', '1243', '1432', '1342', '1423',
  '2134', '2143', '2314', '2341', '2413', '2431',
  '3124', '3142', '3214', '3241', '3412', '3421',
  '4123', '4132', '4213', '4231', '4312', '4321',
];
export const PROGRESSION_IDS: readonly ProgressionId[] = ['I-IV-V', 'ii-V-I', 'blues-12', 'I-V-vi-IV', 'I-vi-IV-V', 'i-iv-v', 'i-iv', 'i-V-i', 'i-VII-VI-V', 'diatonic'];
export const PROGRESSION_PATTERNS: readonly ProgressionPattern[] = ['roots', 'root-fifth', 'octaves', 'arpeggio', 'approach', 'boogie', 'r5b78', 'r56', 'roots-approach', 'roots-passing', 'walking'];
export { patternFits } from './bars';
export const CROSSING_PATTERNS: readonly CrossingPattern[] = ['adjacent', 'skip', 'raking'];
export const TRIADS: readonly Triad[] = ['major-triad', 'minor-triad', 'diminished-triad'];
export const SEVENTHS: readonly Seventh[] = ['major-seventh', 'dominant-seventh', 'minor-seventh', 'half-diminished-seventh'];
const PENTA_SHAPES: readonly PentaShape[] = ['penta-a', 'penta-b', 'penta-c', 'penta-d', 'penta-e'];
const SHAPE_LETTER: Record<PentaShape, string> = { 'penta-a': 'A', 'penta-b': 'B', 'penta-c': 'C', 'penta-d': 'D', 'penta-e': 'E' };

export const EXERCISE_TEMPLATES: readonly ExerciseTemplate[] = deepFreeze([
  { id: 'chromatic-position', category: 'warmup', title: 'Хроматика 1-2-3-4 в позиции', concepts: ['finger-per-fret', 'semitone'], defaults: { startFret: 5, fingering: '1234', direction: 'up' } },
  { id: 'position-shift', category: 'warmup', title: 'Смена позиции по струне', concepts: ['position-shift', 'finger-per-fret'], defaults: { string: 'A', startFret: 3, shifts: 2, jump: 1 } },
  { id: 'spider', category: 'warmup', title: 'Паук: четыре пальца по грифу', concepts: ['finger-per-fret', 'position-shift'], defaults: { startFret: 5, positions: 5, pattern: '1234', path: 'straight' } },
  { id: 'string-crossing', category: 'warmup', title: 'Переход между струнами (правая рука)', concepts: ['right-hand'], defaults: { pattern: 'adjacent', fret: 0 } },
  { id: 'finger-pairs', category: 'warmup', title: 'Пары пальцев', concepts: ['finger-independence', 'finger-per-fret'], defaults: { startFret: 5, pair: '13' } },
  { id: 'stretch', category: 'warmup', title: 'Растяжка тон-тон', concepts: ['finger-independence', 'position-shift'], defaults: { startFret: 7, positions: 3 } },
  { id: 'pulse-note', category: 'warmup', title: 'Пульс на одной ноте', concepts: ['right-hand'], defaults: { string: 'E', fret: 0, notes: 16 } },
  { id: 'string-fourths', category: 'notes', title: 'Круг кварт на струне', concepts: ['circle-of-fifths', 'semitone'], defaults: { string: 'E' } },
  { id: 'interval-from-note', category: 'notes', title: 'Интервал от ноты', concepts: ['degrees'], defaults: { note: 'C', interval: 'maj2', direction: 'up' } },
  { id: 'long-short', category: 'warmup', title: 'Длинные и короткие ноты', concepts: ['right-hand'], defaults: { string: 'E', fret: 5 } },
  { id: 'chromatic-shift', category: 'warmup', title: 'Хроматика по позициям', concepts: ['finger-per-fret', 'position-shift', 'semitone'], defaults: { startFret: 5, positions: 3 } },
  { id: 'note-all-positions', category: 'notes', title: 'Одна нота по всему грифу', concepts: ['octave', 'unison'], defaults: { note: 'C' } },
  { id: 'octaves', category: 'notes', title: 'Октавы: +2 струны, +2 лада', concepts: ['octave'], defaults: { note: 'G' } },
  { id: 'string-naturals', category: 'notes', title: 'Ноты на струне', concepts: ['semitone', 'octave'], defaults: { string: 'E', fretMax: 5 } },
  { id: 'pentatonic-form', category: 'forms', title: 'Форма пентатоники вверх-вниз', concepts: ['pentatonic', 'degrees'], defaults: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a' } },
  { id: 'pentatonic-relative', category: 'forms', title: 'Мажорная и минорная пентатоника: одни ноты — разные тоники', concepts: ['relative-keys', 'degrees', 'pentatonic'], defaults: { minorRoot: 'A', shapeId: 'penta-a' } },
  { id: 'scale-compact', category: 'forms', title: 'Гамма в одной позиции', concepts: ['scale-formula', 'degrees'], defaults: { root: 'C', structureId: 'major', shapeId: 'compact-e' } },
  { id: 'blues-scale', category: 'forms', title: 'Блюзовая гамма', concepts: ['blues', 'degrees'], defaults: { root: 'A', shapeId: 'compact-e' } },
  { id: 'connect-forms', category: 'connections', title: 'Связка соседних форм', concepts: ['shared-notes', 'position-shift', 'pentatonic'], defaults: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a' } },
  { id: 'pentatonic-neck', category: 'connections', title: 'Пентатоника по всему грифу', concepts: ['form-system', 'shared-notes', 'pentatonic'], defaults: { root: 'A', structureId: 'minor-pentatonic' } },
  { id: 'scale-one-string', category: 'positions', title: 'Гамма на одной струне', concepts: ['scale-formula', 'semitone'], defaults: { root: 'C', structureId: 'major', string: 'A' } },
  { id: 'scale-position', category: 'positions', title: 'Гамма в позиции «палец на лад»', concepts: ['finger-per-fret', 'scale-formula', 'degrees'], defaults: { root: 'C', structureId: 'major', degree: 1 } },
  { id: 'scale-two-octaves', category: 'positions', title: 'Гамма в две октавы', concepts: ['scale-formula', 'position-shift', 'degrees'], defaults: { root: 'G', structureId: 'major' } },
  { id: 'scale-neck', category: 'positions', title: 'Гамма по всему грифу', concepts: ['scale-formula', 'form-system', 'position-shift'], defaults: { root: 'C', structureId: 'major' } },
  { id: 'arpeggio-1358', category: 'arpeggios', title: 'Арпеджио 1–3–5–8', concepts: ['triad', 'degrees'], defaults: { root: 'C', structureId: 'major-triad', shapeId: 'compact-e' } },
  { id: 'arpeggio-seventh', category: 'arpeggios', title: 'Арпеджио септаккорда 1–3–5–7', concepts: ['seventh-chord', 'degrees'], defaults: { root: 'C', structureId: 'dominant-seventh', shapeId: 'compact-e' } },
  { id: 'arpeggio-inversion', category: 'arpeggios', title: 'Обращение трезвучия', concepts: ['inversion', 'triad'], defaults: { root: 'C', structureId: 'major-triad', inversion: 1 } },
  { id: 'root-five-eight', category: 'arpeggios', title: 'Root–5–8', concepts: ['fifth', 'octave'], defaults: { root: 'C', string: 'A' } },
  { id: 'groups-of-three', category: 'sequences', title: 'Секвенция группами', concepts: ['sequence', 'pentatonic'], defaults: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a', group: 3 } },
  { id: 'thirds', category: 'sequences', title: 'Терциями по гамме', concepts: ['third', 'sequence'], defaults: { root: 'C', structureId: 'major', shapeId: 'compact-e' } },
  { id: 'form-transpose', category: 'transposition', title: 'Та же форма от другой тоники', concepts: ['transposition', 'pentatonic'], defaults: { structureId: 'minor-pentatonic', shapeId: 'penta-a', roots: ['A', 'D', 'E'] } },
  { id: 'progression', category: 'progressions', title: 'Игра по последовательности аккордов', concepts: ['progression', 'degrees'], defaults: { root: 'C', progression: 'I-IV-V', pattern: 'roots', position: 'closed' } },
  { id: 'song-fragment', category: 'progressions', title: 'Фрагмент песни', concepts: ['degrees'], userOnly: true, defaults: {
    title: 'Фрагмент', source: { sha256: '0'.repeat(64), size: 1, trackIndex: 0, trackName: 'Бас', fromBar: 1, toBar: 1 }, bpm: 90, key: null,
    bars: [{ chord: 'C', events: [['A', 3, 0, 4], ['A', 3, 4, 4], ['E', 3, 8, 4], [null, null, 12, 4]] }],
  } },
  { id: 'riff', category: 'riffs', title: 'Рифф', concepts: ['progression', 'degrees'], defaults: { riff: 'rock-eighths', root: 'G' } },
  { id: 'line', category: 'progressions', title: 'Своя линия', concepts: ['progression', 'degrees'], userOnly: true, defaults: {
    root: 'G', mode: 'major', position: 'closed',
    bars: [0, 5, 7, 0].map(step => ({ step, chord: 'major-triad', pattern: 'roots', rhythm: 'eighths' })),
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
  'chromatic-position': raw => ({ startFret: integer(raw.startFret, 1, 21, 'Первый лад'), fingering: oneOf(raw.fingering, FINGERINGS, 'Аппликатура'), direction: oneOf(raw.direction, DIRECTIONS, 'Направление') }),
  'position-shift': raw => {
    const startFret = integer(raw.startFret, 1, 20, 'Первый лад'); const shifts = integer(raw.shifts, 1, 4, 'Число сдвигов');
    const jump = integer(raw.jump, 1, 12, 'Шаг сдвига') as ShiftJump;
    if (!SHIFT_JUMPS.includes(jump)) throw new RangeError('Шаг сдвига: допустимо 1, 2, 3, 5, 7 или 12 ладов.');
    if (startFret + shifts * jump + 3 > 24) throw new RangeError('Последняя группа должна помещаться на ладах до 24.');
    return { string: oneOf(raw.string, STRINGS, 'Струна'), startFret, shifts, jump };
  },
  'string-crossing': raw => ({ pattern: oneOf(raw.pattern, CROSSING_PATTERNS, 'Рисунок правой руки'), fret: integer(raw.fret, 0, 12, 'Лад') }),
  'finger-pairs': raw => ({ startFret: integer(raw.startFret, 1, 12, 'Первый лад'), pair: oneOf(raw.pair, FINGER_PAIRS, 'Пара пальцев') }),
  stretch: raw => {
    const startFret = integer(raw.startFret, 1, 12, 'Первый лад'); const positions = integer(raw.positions, 1, 5, 'Число позиций');
    if (startFret - positions + 1 < 1) throw new RangeError('Растяжка идёт к порожку: последняя позиция должна начинаться не ниже 1-го лада.');
    return { startFret, positions };
  },
  'pulse-note': raw => {
    const notes = integer(raw.notes, 8, 32, 'Число нот') as PulseNotes;
    if (!PULSE_NOTES.includes(notes)) throw new RangeError('Число нот: допустимо 8, 16 или 32.');
    return { string: oneOf(raw.string, STRINGS, 'Струна'), fret: integer(raw.fret, 0, 12, 'Лад'), notes };
  },
  'string-fourths': raw => ({ string: oneOf(raw.string, STRINGS, 'Струна') }),
  'interval-from-note': raw => ({ note: noteName(raw.note, 'Нота'), interval: oneOf(raw.interval, INTERVAL_IDS, 'Интервал'), direction: oneOf(raw.direction, INTERVAL_DIRECTIONS, 'Направление') }),
  'long-short': raw => ({ string: oneOf(raw.string, STRINGS, 'Струна'), fret: integer(raw.fret, 0, 12, 'Лад') }),
  'chromatic-shift': raw => {
    const startFret = integer(raw.startFret, 1, 12, 'Первый лад'); const positions = integer(raw.positions, 2, 5, 'Число позиций');
    if (startFret + positions + 2 > 16) throw new RangeError('Хроматика по позициям должна заканчиваться не дальше 16-го лада.');
    return { startFret, positions };
  },
  'string-naturals': raw => {
    const fretMax = integer(raw.fretMax, 5, 12, 'Последний лад') as NaturalsFretMax;
    if (!NATURALS_FRET_MAX.includes(fretMax)) throw new RangeError('Последний лад: допустимо 5 или 12.');
    return { string: oneOf(raw.string, STRINGS, 'Струна'), fretMax };
  },
  spider: raw => {
    const startFret = integer(raw.startFret, 1, 12, 'Первый лад'); const positions = integer(raw.positions, 2, 12, 'Число позиций');
    if (startFret + positions + 2 > 16) throw new RangeError('Паук должен заканчиваться не дальше 16-го лада.');
    return { startFret, positions, pattern: oneOf(raw.pattern, SPIDER_PATTERNS, 'Порядок пальцев'), path: oneOf(raw.path, SPIDER_PATHS, 'Путь') };
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
  'scale-two-octaves': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура') }),
  'scale-neck': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура') }),
  'arpeggio-1358': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, TRIADS, 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'arpeggio-seventh': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, SEVENTHS, 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'arpeggio-inversion': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, TRIADS, 'Структура'), inversion: integer(raw.inversion, 1, 2, 'Обращение') }),
  'root-five-eight': raw => ({ root: noteName(raw.root, 'Тоника'), string: oneOf(raw.string, ['E', 'A'], 'Струна') }),
  'groups-of-three': raw => {
    const structureId = oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic', 'major', 'natural-minor'], 'Структура');
    // Пентатоника строится по формам `penta-*`, гаммы — по компактным формам (часть C).
    const shapes: readonly (PentaShape | CompactShape)[] = structureId.endsWith('pentatonic') ? PENTA_SHAPES : ['compact-e', 'compact-a'];
    const group = integer(raw.group, 3, 4, 'Нот в группе') as SequenceGroup;
    return { root: noteName(raw.root, 'Тоника'), structureId, shapeId: oneOf(raw.shapeId, shapes, 'Форма'), group };
  },
  thirds: raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'form-transpose': raw => {
    if (!Array.isArray(raw.roots) || raw.roots.length < 2 || raw.roots.length > 6) throw new RangeError('Тоники: нужен список из 2–6 нот.');
    return { structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма'), roots: raw.roots.map((root, index) => noteName(root, `Тоника ${index + 1}`)) };
  },
  'cycle-fourths': raw => ({ root: noteName(raw.root, 'Тоника'), count: integer(raw.count, 2, 12, 'Число тоник') }),
  line: raw => {
    if (!Array.isArray(raw.bars) || raw.bars.length < LINE_MIN_BARS || raw.bars.length > LINE_MAX_BARS) throw new RangeError(`Линия: от ${LINE_MIN_BARS} до ${LINE_MAX_BARS} тактов.`);
    const bars = raw.bars.map((item, index): LineBar => {
      const bar = plainRecord(item, `Такт ${index + 1}`);
      exactKeys(bar, ['step', 'chord', 'pattern', 'rhythm'], `Такт ${index + 1}`);
      const chord = oneOf(bar.chord, LINE_CHORDS, 'Вид аккорда');
      const pattern = oneOf(bar.pattern, PROGRESSION_PATTERNS, 'Рисунок');
      if (!patternFits(pattern, chord)) throw new RangeError(pattern === 'boogie' ? 'Буги строится только на мажорном трезвучии и доминантсептаккорде.' : 'Рисунок не строится на уменьшённом аккорде.');
      // Ритм такта — рисунок части A на сетке шестнадцатых, без свинга (свинг задаёт «как играть»).
      const rhythm = oneOf(bar.rhythm, RHYTHM_PATTERNS.filter(candidate => candidate.swing === 50).map(candidate => candidate.id), 'Ритм такта');
      return { step: integer(bar.step, 0, 11, 'Ступень аккорда'), chord, pattern, rhythm };
    });
    return { root: noteName(raw.root, 'Тоника'), mode: oneOf(raw.mode, ['major', 'minor'], 'Лад'), position: oneOf(raw.position, ['closed', 'low'], 'Позиция'), bars };
  },
  riff: raw => ({ riff: oneOf(raw.riff, RIFF_IDS, 'Рифф'), root: noteName(raw.root, 'Тональность') }),
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
    if (!PROGRESSION_CHORDS[progression].every(([, structureId]) => patternFits(pattern, structureId))) throw new RangeError('Рисунок не строится на аккорде этой последовательности.');
    const position = oneOf(raw.position, PROGRESSION_POSITIONS, 'Позиция');
    // Открытые струны (B1.3): только тоники рисунком `roots`, только I–IV–V и блюз; тональности без нужных открытых струн отклоняет построение.
    if (position === 'open' && (pattern !== 'roots' || (progression !== 'I-IV-V' && progression !== 'blues-12'))) throw new RangeError('Открытые струны: только тоники по I–IV–V или блюзу.');
    return { root: noteName(raw.root, 'Тоника'), progression, pattern, position };
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

interface Draft { readonly position: AnnotatedPosition; readonly finger: number | null; readonly segment: number; readonly degree?: string | null; readonly stretch?: boolean; readonly pluck?: 'i' | 'm' | null; readonly gate?: number | null }

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
  readonly timing?: readonly { readonly note: number | null; readonly grids: number; readonly tie?: boolean }[]; readonly bars?: readonly BarForms[] };

/** Формы интервалов на квартовом строе (A8.2): смещение по струнам к G и по ладам вверх и вниз. */
const INTERVAL_FORMS: Readonly<Record<IntervalId, { readonly title: string; readonly number: number; readonly up: { readonly dString: number; readonly dFret: number }; readonly down: { readonly dString: number; readonly dFret: number } }>> = {
  min2: { title: 'Малая секунда', number: 2, up: { dString: 0, dFret: 1 }, down: { dString: 0, dFret: -1 } },
  maj2: { title: 'Большая секунда', number: 2, up: { dString: 0, dFret: 2 }, down: { dString: 0, dFret: -2 } },
  min6: { title: 'Малая секста', number: 6, up: { dString: 1, dFret: 3 }, down: { dString: -1, dFret: -3 } },
  maj6: { title: 'Большая секста', number: 6, up: { dString: 2, dFret: -1 }, down: { dString: -2, dFret: 1 } },
  min7: { title: 'Малая септима', number: 7, up: { dString: 2, dFret: 0 }, down: { dString: -2, dFret: 0 } },
  maj7: { title: 'Большая септима', number: 7, up: { dString: 2, dFret: 1 }, down: { dString: -2, dFret: -1 } },
};

const BUILDERS: { readonly [Id in ExerciseTemplateId]: (params: ExerciseParams[Id]) => Built } = {
  'chromatic-position': ({ startFret, fingering, direction }) => {
    // Аппликатура 1-2-3-4: четыре лада; 1-2-4: три лада, пальцы 1, 2 и 4 (A7.1). Вниз — те же лады по убыванию, пальцы в обратном порядке.
    const offsets = fingering === '124' ? [0, 1, 2] : [0, 1, 2, 3];
    const fingers = fingering === '124' ? [1, 2, 4] : [1, 2, 3, 4];
    const stroke = (strings: readonly StringId[], reverse: boolean, segment: number): Draft[] => strings.flatMap(string => offsets.map((_, index) => {
      const at = reverse ? offsets.length - 1 - index : index;
      return { position: chromatic(string, startFret + offsets[at]), finger: fingers[at], segment, degree: null };
    }));
    const label = fingering === '124' ? `Позиция ${startFret} · пальцы 1-2-4 · лады ${startFret}–${startFret + 2}` : `Позиция ${startFret} · пальцы 1-2-3-4`;
    const title = `Хроматика ${fingering === '124' ? '1-2-4' : '1-2-3-4'} в позиции`;
    if (direction === 'up') return { drafts: stroke(STRINGS, false, 0), segments: [label], title, overlap: 'none' };
    return {
      drafts: [...stroke(STRINGS, false, 0), ...stroke([...STRINGS].reverse(), true, 1)], segments: [`${label} · вверх`, `${label} · вниз`],
      title: `${title}, вверх и вниз`, overlap: 'none',
    };
  },
  'pulse-note': ({ string, fret, notes }) => ({
    drafts: Array.from({ length: notes }, (_, index): Draft => ({ position: chromatic(string, fret), finger: null, segment: 0, degree: null, pluck: index % 2 ? 'm' : 'i' })),
    segments: [fret === 0 ? `Открытая струна ${string} · i–m` : `Струна ${string} · лад ${fret} · i–m`], overlap: 'none',
  }),
  'string-fourths': ({ string }) => ({
    // A6.2: C F B♭ E♭ A♭ D♭ G♭ B E A D G; лад — класс высоты ноты минус открытая струна, в ладах 0–11; написание ровно как в ряду.
    drafts: FOURTHS_ROW.map((name, index): Draft => ({
      position: spelled(chromatic(string, (parseNote(name).pitchClass - getPosition(string, 0).pitchClass + 12) % 12), name), finger: null, segment: 0, degree: null,
    })),
    segments: [`Струна ${string} · круг кварт · лады 0–11`], overlap: 'none',
  }),
  'interval-from-note': ({ note, interval, direction }) => {
    // A8.2: одна нота и все места грифа на ладах 1–12, где форма интервала помещается; пары по возрастанию высоты исходной ноты.
    const root = parseNote(note);
    const structure = createStructure(note, 'major');
    const form = INTERVAL_FORMS[interval];
    const { dString, dFret } = form[direction];
    const sources = STRINGS.flatMap(string => range(1, 12).filter(fret => getPosition(string, fret).pitchClass === root.pitchClass).map(fret => ({ string, fret, midi: getPosition(string, fret).midi })))
      .sort((a, b) => a.midi - b.midi || stringIndex(a.string) - stringIndex(b.string));
    const drafts: Draft[] = [];
    let first: string | null = null;
    for (const source of sources) {
      const string = STRINGS[stringIndex(source.string) + dString];
      const fret = source.fret + dFret;
      if (!string || fret < 1 || fret > 12) continue;
      const low = Math.min(source.fret, fret);
      const target = annotate([[string, fret]], structure)[0];
      // Буква ноты интервала отстоит от буквы исходной на номер интервала − 1 вверх или вниз; знак — по числу полутонов (допустимы двойные).
      const name = spellNote(letterIndex(root.letter) + (direction === 'up' ? form.number - 1 : 1 - form.number), target.pitchClass);
      first ??= name;
      drafts.push(
        { position: annotate([[source.string, source.fret]], structure)[0], finger: source.fret - low + 1, segment: 0, degree: '1' },
        { position: spelled(target, name), finger: fret - low + 1, segment: 0, degree: degreeFrom(note, target.midi) },
      );
    }
    if (!drafts.length) throw new RangeError('Интервал не помещается на ладах 1–12.');
    const label = `${form.title} ${direction === 'up' ? 'вверх' : 'вниз'}`;
    return { drafts, segments: [`${label} · ${root.name} → ${first}`], title: `${label} от ${root.name}`, overlap: 'none' };
  },
  'long-short': ({ string, fret }) => ({
    // A8.1: ноты 0–7 длинные (звучат весь шаг), 8–15 короткие (половина шага); граница совпадает с тактовой чертой в обоих ритмах.
    drafts: Array.from({ length: 16 }, (_, index): Draft => ({
      position: chromatic(string, fret), finger: null, segment: index < 8 ? 0 : 1, degree: null, pluck: index % 2 ? 'm' : 'i', gate: index < 8 ? 1 : 0.5,
    })),
    segments: ['Длинные · легато', 'Короткие · стаккато'], overlap: 'none',
  }),
  'chromatic-shift': ({ startFret, positions }) => {
    // Ряд позиций «туда-обратно», крайние не повторяются: P = f…f+n−1, f+n−2…f+1 (длина 2n−2).
    const row = [...range(startFret, startFret + positions - 1), ...(positions > 2 ? range(startFret + 1, startFret + positions - 2).reverse() : [])];
    const drafts: Draft[] = []; const segments: string[] = [];
    row.forEach((position, segment) => {
      const up = segment % 2 === 0;
      const strings = up ? STRINGS : [...STRINGS].reverse();
      for (const string of strings) for (let step = 0; step < 4; step++) {
        const offset = up ? step : 3 - step;
        drafts.push({ position: chromatic(string, position + offset), finger: offset + 1, segment, degree: null });
      }
      segments.push(`Лады ${position}–${position + 3} · ${up ? 'E → G' : 'G → E'}`);
    });
    return { drafts, segments, overlap: 'none' };
  },
  'string-naturals': ({ string, fretMax }) => {
    // Натуральные ноты струны на ладах 0…fretMax по возрастанию, затем обратно без крайних (R-007 «туда-обратно»).
    const natural = new Set([0, 2, 4, 5, 7, 9, 11]);
    const frets = range(0, fretMax).filter(fret => natural.has(getPosition(string, fret).midi % 12));
    const order = [...frets, ...frets.slice(1, -1).reverse()];
    return {
      drafts: order.map((fret): Draft => ({ position: chromatic(string, fret), finger: null, segment: 0, degree: null })),
      segments: [`Струна ${string} · натуральные ноты · лады 0–${fretMax}`], overlap: 'none',
    };
  },
  'position-shift': ({ string, startFret, shifts, jump }) => ({
    // Группа k начинается на ладу f + k·j (часть C): шаг 1 — соседняя позиция, больше — скачок позиции.
    drafts: Array.from({ length: shifts + 1 }, (_, shift) => [0, 1, 2, 3].map(offset => ({ position: chromatic(string, startFret + shift * jump + offset), finger: offset + 1, segment: shift, degree: null }))).flat(),
    segments: Array.from({ length: shifts + 1 }, (_, shift) => `Лады ${startFret + shift * jump}–${startFret + shift * jump + 3}`),
    // Скачок от 4 ладов: у групп нет общих ладов.
    ...(jump > 3 ? { overlap: 'none' as const } : {}),
  }),
  'string-crossing': ({ pattern, fret }) => {
    const order = CROSSING_ORDER[pattern];
    const plucks = pluckOrder(order, pattern === 'raking');
    // Лад 0 — открытые струны без пальца; с ладом нота прижимается первым пальцем и переставляется по струнам.
    const title = fret === 0 ? CROSSING_TITLES[pattern] : `${CROSSING_TITLES[pattern]} · лад ${fret}`;
    return {
      drafts: order.map((string, index) => ({
        position: fret === 0 ? annotate([[string, 0]], OPEN_STRINGS)[0] : chromatic(string, fret), finger: fret === 0 ? null : 1,
        segment: Math.floor(index / 8), degree: null, pluck: plucks[index],
      })),
      segments: [title, title], overlap: 'none',
    };
  },
  'finger-pairs': ({ startFret, pair }) => {
    const [a, b] = [...pair].map(Number);
    const drafts: Draft[] = [];
    [STRINGS, [...STRINGS].reverse()].forEach((strings, segment) => {
      for (const string of strings) for (const finger of [a, b, a, b]) drafts.push({ position: chromatic(string, startFret + finger - 1), finger, segment, degree: null });
    });
    const label = `Пальцы ${a}–${b} · лады ${startFret + a - 1} и ${startFret + b - 1}`;
    return { drafts, segments: [`${label} · E → G`, `${label} · G → E`], overlap: 'none' };
  },
  stretch: ({ startFret, positions }) => {
    // Позиции от середины грифа к порожку: лады p, p+2, p+4 пальцами 1, 2, 4; нота мизинцем — растяжка.
    const drafts: Draft[] = []; const segments: string[] = [];
    for (let index = 0; index < positions; index++) {
      const fret = startFret - index;
      const up = index % 2 === 0;
      const cells: readonly (readonly [number, number])[] = up ? [[0, 1], [2, 2], [4, 4]] : [[4, 4], [2, 2], [0, 1]];
      for (const string of up ? STRINGS : [...STRINGS].reverse()) for (const [offset, finger] of cells) {
        drafts.push({ position: chromatic(string, fret + offset), finger, segment: index, degree: null, stretch: finger === 4 });
      }
      segments.push(`Лады ${fret}–${fret + 4} · ${up ? 'E → G' : 'G → E'}`);
    }
    return { drafts, segments, overlap: 'none' };
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
  spider: ({ startFret, positions, pattern, path }) => {
    const fingers = [...pattern].map(Number);
    const drafts: Draft[] = [];
    const segments: string[] = [];
    for (let index = 0; index < positions; index++) {
      const fret = startFret + index;
      if (path === 'diagonal') {
        // По пальцу на струну: E→G, затем G→E; j-й струне хода — j-й палец порядка (часть C).
        for (const strings of [STRINGS, [...STRINGS].reverse()]) strings.forEach((string, at) => {
          drafts.push({ position: chromatic(string, fret + fingers[at] - 1), finger: fingers[at], segment: index, degree: null });
        });
        segments.push(`Лады ${fret}–${fret + 3} · по диагонали`);
        continue;
      }
      const strings = index % 2 === 0 ? STRINGS : [...STRINGS].reverse();
      for (const string of strings) for (const finger of fingers) drafts.push({ position: chromatic(string, fret + finger - 1), finger, segment: index, degree: null });
      segments.push(`Лады ${fret}–${fret + 3} · ${index % 2 === 0 ? 'E → G' : 'G → E'}`);
    }
    return { drafts, segments, overlap: 'none', ...(path === 'diagonal' ? { title: 'Паук по диагонали' } : {}) };
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
  'scale-two-octaves': ({ root, structureId }) => {
    // Часть C: 15 нот от тоники на E по три на струну (E, A, D, G, G со сдвигом); пальцы — по смещениям ладов группы.
    const structure = createStructure(root, structureId);
    const start = getPosition('E', rootFrets(root, 'E', 1, 12)[0]).midi;
    const pitches = new Set(structure.notes.map(note => note.pitchClass));
    const scale: number[] = [];
    for (let midi = start; scale.length < 15; midi++) if (pitches.has(midi % 12)) scale.push(midi);
    const groups: readonly StringId[] = ['E', 'A', 'D', 'G', 'G'];
    const up = groups.flatMap((string, index): Draft[] => {
      const frets = scale.slice(index * 3, index * 3 + 3).map(midi => midi - getPosition(string, 0).midi);
      const offsets = frets.map(fret => fret - frets[0]);
      const fingers = offsets[2] === 4 ? [1, 2, 4] : offsets.map(offset => offset + 1);
      return frets.map((fret, at) => ({
        position: annotate([[string, fret]], structure)[0], finger: fingers[at], segment: 0, stretch: offsets[2] === 4 && at === 2,
      }));
    });
    const frets = up.map(draft => draft.position.fret);
    return { drafts: [...up, ...up.slice(1, -1).reverse()], segments: [`Две октавы · по три ноты на струну · лады ${Math.min(...frets)}–${Math.max(...frets)}`] };
  },
  'scale-neck': ({ root, structureId }) => {
    // Часть C: позиции «палец на лад» по возрастанию окна; окно, совпавшее с предыдущим, пропускается; «змейка».
    const structure = createStructure(root, structureId);
    const all = structure.notes.map(note => {
      const start = rootFrets(note.name, 'E', 1, 12)[0];
      const candidates = [start, start - 1].filter(window => window >= 1).map(window => scalePosition(structure, start, window));
      return { note, start, best: candidates.reduce((a, b) => b.stretches < a.stretches ? b : a) };
    }).sort((a, b) => a.best.window - b.best.window || a.start - b.start);
    const chain = all.filter((entry, index) => index === 0 || entry.best.window !== all[index - 1].best.window);
    return {
      drafts: chain.flatMap(({ best }, index) => (index % 2 === 0 ? best.drafts : [...best.drafts].reverse()).map(draft => ({ ...draft, segment: index }))),
      segments: chain.map(({ note, best }, index) => `Позиция от ${note.name} · лады ${best.window}–${best.window + 3} · ${index % 2 === 0 ? 'вверх' : 'вниз'}`),
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
  'groups-of-three': ({ root, structureId, shapeId, group }) => {
    const box = lowestBox(root, structureId, shapeId);
    // Перекрывающиеся группы по g нот вверх (g = 3 — паттерн R-007 `groups-of-three`).
    const unique = ascending(box);
    const notes = unique.slice(0, unique.length - group + 1).flatMap((_, index) => unique.slice(index, index + group));
    const label = shapeId.startsWith('penta-') ? formLabel(box) : `Лады ${box.window.fretMin}–${box.window.fretMax}`;
    return { drafts: fromBox(box, notes, 0), segments: [label], title: `Группы по ${group === 3 ? 'три' : 'четыре'}` };
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
  progression: ({ root, progression, pattern, position }) => progressionPlan(root, progression, pattern, position),
  riff: ({ riff, root }) => riffPlan(riff, root),
  line: ({ root, mode, position, bars }) => linePlan(root, mode, position, bars),
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
  'I-V-vi-IV': [[1, 'major-triad', 'I'], [5, 'major-triad', 'V'], [6, 'minor-triad', 'vi'], [4, 'major-triad', 'IV']],
  'I-vi-IV-V': [[1, 'major-triad', 'I'], [6, 'minor-triad', 'vi'], [4, 'major-triad', 'IV'], [5, 'major-triad', 'V']],
  // Минорная последовательность (B1.2): ступени — из натурального минора от тоники, v — минорное трезвучие.
  'i-iv-v': [[1, 'minor-triad', 'i'], [4, 'minor-triad', 'iv'], [5, 'minor-triad', 'v'], [1, 'minor-triad', 'i']],
  'i-iv': [[1, 'minor-triad', 'i'], [4, 'minor-triad', 'iv'], [1, 'minor-triad', 'i'], [4, 'minor-triad', 'iv']],
  // V, VII и VI — мажорные трезвучия на ступенях натурального минора (B1.2): терция V — повышенная VII ступень.
  'i-V-i': [[1, 'minor-triad', 'i'], [5, 'major-triad', 'V'], [1, 'minor-triad', 'i'], [1, 'minor-triad', 'i']],
  'i-VII-VI-V': [[1, 'minor-triad', 'i'], [7, 'major-triad', 'VII'], [6, 'major-triad', 'VI'], [5, 'major-triad', 'V']],
  diatonic: [[1, 'major-triad', 'I'], [2, 'minor-triad', 'ii'], [3, 'minor-triad', 'iii'], [4, 'major-triad', 'IV'], [5, 'major-triad', 'V'], [6, 'minor-triad', 'vi'], [7, 'diminished-triad', 'vii°'], [1, 'major-triad', 'I']],
};
/** Минорные последовательности: `root` — тоника натурального минора (B1.1). */
const MINOR_PROGRESSIONS: ReadonlySet<ProgressionId> = new Set<ProgressionId>(['i-iv-v', 'i-iv', 'i-V-i', 'i-VII-VI-V']);
/** Аккорды последовательности в тональности `root`: тоника с написанием из гаммы, вид и цифра. */
function progressionChordRefs(root: string, progression: ProgressionId): ChordRef[] {
  const key = createStructure(root, MINOR_PROGRESSIONS.has(progression) ? 'natural-minor' : 'major');
  return PROGRESSION_CHORDS[progression].map(([degree, structureId, roman]) => ({ root: key.notes[degree - 1].name, structureId, roman }));
}
const CHORD_SYMBOL: Partial<Readonly<Record<StructureId, string>>> = { 'minor-triad': 'm', 'diminished-triad': 'dim', 'major-seventh': 'maj7', 'dominant-seventh': '7', 'minor-seventh': 'm7' };

/**
 * Игра по последовательности (D-049): такт = восемь восьмых = один аккорд. Тоника аккорда — компактная форма
 * от E или A (лады ≥ 1): у первого аккорда — самая низкая с тоникой на 3-м ладу и выше, дальше — ближайшая
 * по ладу к предыдущей тонике (при равенстве — на E). Ступени подписываются от тоники своего аккорда.
 */
function progressionPlan(root: string, progression: ProgressionId, pattern: ProgressionPattern, position: ProgressionPosition = 'closed'): Built {
  const chords = progressionChordRefs(root, progression);
  return chordBars(chords, chords.map(() => pattern), position, createStructure(root, MINOR_PROGRESSIONS.has(progression) ? 'natural-minor' : 'major'));
}

/** Аккорд такта: тоника с написанием, вид и цифра для подписи сегмента. */
interface ChordRef { readonly root: string; readonly structureId: StructureId; readonly roman: string }

/** Ноты такта по формам Q и E (B2.1) и хвост: индексы в списке нот такта, начинающегося с `base`. */
function patternForms(pattern: ProgressionPattern, base: number, extra: { readonly passing?: number; readonly approach?: boolean } = {}): BarForms {
  const passing = extra.passing ?? 0;
  const quarters = pattern === 'root-fifth' ? [0, 2, 0, 2] : pattern === 'octaves' ? [0, 1, 0, 1] : pattern === 'roots' || pattern === 'roots-approach' || pattern === 'roots-passing' ? [0, 0, 0, 0]
    : pattern === 'r5b78' || pattern === 'r56' || pattern === 'walking' ? [0, 2, 4, 6] : [0, 1, 2, 3];
  // У рисунка с подходом последняя нота формы E — нота рисунка вместо подхода (тоника или терция арпеджио); сам подход живёт в хвосте.
  const last = pattern === 'approach' ? 1 : pattern === 'roots-approach' ? 0 : 7;
  const hasTail = pattern === 'approach' || pattern === 'roots-approach' || extra.approach === true;
  // Проходящие (B2.3) занимают последние `passing` нот такта: они и есть хвост.
  const tail = hasTail ? [base + 7] : Array.from({ length: passing }, (_, at) => base + 8 - passing + at);
  return { q: quarters.map(offset => base + offset), e: Array.from({ length: 8 }, (_, step) => base + (step === 7 ? last : step)), tail };
}

/** Проходящая нота хвоста: написание из гаммы, ступень от тоники своего аккорда, без пальца (B2.3). */
const passingDraft = (item: PassingNote, structure: MusicalStructure, segment: number): Draft =>
  ({ position: spelled(annotate([[item.string, item.fret]], structure)[0], item.name), finger: null, segment, degree: item.degree });

/** Нота с заданным написанием: подход и тоны вне структуры аккорда (B0.2, B2.3). */
const spelled = (position: AnnotatedPosition, name: string | null): AnnotatedPosition => (name === null ? position : { ...position, noteName: name });

/**
 * Такты по аккордам и рисункам (по рисунку на такт): позиции тоник — `closed` (ближайшая к прошлой), `low` или `open` (R-028, B0.1);
 * общий сборщик `progression` (один рисунок на все такты) и «Своей линии» (рисунок на такт).
 */
/** Тоника следующего такта (у последнего — первого) — другой класс высоты (B2.4: тогда доля 4 шагающего баса — подход). */
const differentTonic = (chords: readonly ChordRef[], index: number): boolean => parseNote(chords[(index + 1) % chords.length].root).pitchClass !== parseNote(chords[index].root).pitchClass;

function chordBars(chords: readonly ChordRef[], patterns: readonly ProgressionPattern[], position: ProgressionPosition, scale: MusicalStructure): Built {
  if (position !== 'closed') return positionedProgressionPlan(chords, patterns, position, scale);
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
  const bars: BarForms[] = [];
  const series = chordSeries(chords);
  boxes.forEach((box, index) => {
    const base = drafts.length;
    const pattern = patterns[index];
    const tones = [...box.positions].sort(byPitch);
    const rootPosition = tones[0];
    const byDegree = (pattern: RegExp, above = rootPosition.midi) => tones.find(tone => pattern.test(tone.degree ?? '') && tone.midi > above);
    const third = byDegree(/^b?3$/)!; const fifth = byDegree(/^b?5$/)!; const seventh = byDegree(/^b?7$/);
    const octave = tones.find(tone => tone.degree === '1' && tone.midi === rootPosition.midi + 12);
    const note = (position: AnnotatedPosition): Draft => ({ position, finger: box.fingers[position.id] ?? null, segment: index, degree: position.degree });
    let bar: Draft[];
    let passingCount = 0;
    let walkingApproach = false;
    if (pattern === 'roots') bar = Array.from({ length: 8 }, () => note(rootPosition));
    else if (pattern === 'root-fifth') bar = [rootPosition, rootPosition, fifth, fifth, rootPosition, rootPosition, fifth, fifth].map(note);
    else if (pattern === 'octaves') bar = Array.from({ length: 8 }, (_, step) => note(step % 2 && octave ? octave : rootPosition));
    else if (pattern === 'boogie') bar = boogieBar(box, index);
    else if (pattern === 'r5b78' || pattern === 'r56') {
      // Клетки B0.2 от тоники формы; 6 и ♭7 у трезвучий — дополнение к форме, написание — от тоники аккорда.
      const structure = createStructure(chords[index].root, chords[index].structureId);
      const placed = placeTones({ string: box.selection.anchorString, fret: box.selection.anchorFret }, barTones(pattern, chords[index].structureId), chordFamily(chords[index].structureId))!;
      bar = placed.map(item => ({ position: spelled(annotate([[item.string, item.fret]], structure)[0], toneName(chords[index].root, item.tone)), finger: item.finger, segment: index, degree: item.tone === '8' ? '1' : item.tone }));
    } else if (pattern === 'walking') {
      // B2.4: четыре четверти по таблице серии; подход к тонике следующего такта — только если её класс высоты другой.
      const structure = createStructure(chords[index].root, chords[index].structureId);
      const placed = placeTones({ string: box.selection.anchorString, fret: box.selection.anchorFret }, walkingBar(chords[index].structureId, series[index]), chordFamily(chords[index].structureId))!;
      bar = placed.map(item => ({ position: spelled(annotate([[item.string, item.fret]], structure)[0], toneName(chords[index].root, item.tone)), finger: item.finger, segment: index, degree: item.tone === '8' ? '1' : item.tone }));
      if (differentTonic(chords, index)) {
        bar[7] = approachNote(boxes[(index + 1) % boxes.length], chords[(index + 1) % chords.length].root, index, structure);
        walkingApproach = true;
      }
    } else if (pattern === 'roots-passing') {
      bar = Array.from({ length: 8 }, () => note(rootPosition));
      const next = boxes[(index + 1) % boxes.length].selection;
      const nextTonic = { string: next.anchorString, fret: next.anchorFret };
      const passing = passingNotes(scale.notes, parseNote(chords[index].root).pitchClass, rootPosition.midi, getPosition(nextTonic.string, nextTonic.fret).midi, nextTonic, false);
      const structure = createStructure(chords[index].root, chords[index].structureId);
      passing.forEach((item, at) => { bar[8 - passing.length + at] = passingDraft(item, structure, index); });
      passingCount = passing.length;
    } else if (pattern === 'roots-approach') {
      bar = Array.from({ length: 8 }, () => note(rootPosition));
      bar[7] = approachNote(boxes[(index + 1) % boxes.length], chords[(index + 1) % chords.length].root, index, createStructure(chords[index].root, chords[index].structureId));
    } else {
      const arpeggio = seventh && octave ? [rootPosition, third, fifth, seventh, octave, seventh, fifth, third] : [rootPosition, third, fifth, third, rootPosition, third, fifth, third];
      bar = arpeggio.map(note);
      if (pattern === 'approach') bar[7] = approachNote(boxes[(index + 1) % boxes.length], chords[(index + 1) % chords.length].root, index, createStructure(chords[index].root, chords[index].structureId));
    }
    drafts.push(...bar);
    bars.push(patternForms(pattern, base, { passing: passingCount, approach: walkingApproach }));
  });
  return {
    drafts, overlap: 'none', bars,
    segments: chords.map(chord => `${chord.root}${CHORD_SYMBOL[chord.structureId] ?? ''} · ${chord.roman}`),
  };
}

/**
 * Нижняя (`low`) и открытые струны (`open`) — R-028 B0.1: тоника каждого аккорда выбирается отдельно, тоны — по клеткам B0.2.
 * Нота на открытой струне — без пальца; подход к тонике следующего аккорда — на лад ниже (у открытой струны — на лад выше).
 */
function positionedProgressionPlan(chords: readonly ChordRef[], patterns: readonly ProgressionPattern[], position: 'low' | 'open', scale: MusicalStructure): Built {
  const tonics: Tonic[] = chords.map((chord, index) => {
    const pitch = parseNote(chord.root).pitchClass;
    if (position === 'open') {
      const open = openTonic(pitch);
      if (!open) throw new RangeError(`У аккорда ${chord.root} нет открытой струны.`);
      return open;
    }
    return lowTonic(pitch, barTones(patterns[index], chord.structureId), chordFamily(chord.structureId));
  });
  const drafts: Draft[] = [];
  const bars: BarForms[] = [];
  const series = chordSeries(chords);
  chords.forEach((chord, index) => {
    const base = drafts.length;
    const structure = createStructure(chord.root, chord.structureId);
    const pattern = patterns[index];
    const placed = placeTones(tonics[index], pattern === 'walking' ? walkingBar(chord.structureId, series[index]) : barTones(pattern, chord.structureId), chordFamily(chord.structureId))!;
    const bar: Draft[] = placed.map(item => ({
      position: spelled(annotate([[item.string, item.fret]], structure)[0], toneName(chord.root, item.tone)), finger: item.finger, segment: index, degree: item.tone === '8' ? '1' : item.tone,
    }));
    let passingCount = 0;
    let walkingApproach = false;
    if (pattern === 'walking' && differentTonic(chords, index)) {
      const next = tonics[(index + 1) % tonics.length];
      bar[7] = { position: spelled(annotate([[next.string, approachFret(next)]], structure)[0], approachName(chords[(index + 1) % chords.length].root, next.fret < 1)), finger: null, segment: index, degree: null };
      walkingApproach = true;
    } else if (pattern === 'approach' || pattern === 'roots-approach') {
      const next = tonics[(index + 1) % tonics.length];
      bar[7] = { position: spelled(annotate([[next.string, approachFret(next)]], structure)[0], approachName(chords[(index + 1) % chords.length].root, next.fret < 1)), finger: null, segment: index, degree: null };
    } else if (pattern === 'roots-passing') {
      const own = tonics[index], next = tonics[(index + 1) % tonics.length];
      const passing = passingNotes(scale.notes, parseNote(chord.root).pitchClass, getPosition(own.string, own.fret).midi, getPosition(next.string, next.fret).midi, next, true);
      passing.forEach((item, at) => { bar[8 - passing.length + at] = passingDraft(item, structure, index); });
      passingCount = passing.length;
    }
    drafts.push(...bar);
    bars.push(patternForms(pattern, base, { passing: passingCount, approach: walkingApproach }));
  });
  return { drafts, overlap: 'none', bars, segments: chords.map(chord => `${chord.root}${CHORD_SYMBOL[chord.structureId] ?? ''} · ${chord.roman}`) };
}

/**
 * Аккорд каждого такта материала для аккомпанемента (R-028, B6): последовательность, рифф, «Своя линия» и фрагмент песни
 * с аккордами партитуры; нераспознанное имя — `null` (такт без аккорда). У материала без аккордов по тактам — `null`.
 */
export function barChords(spec: ExerciseSpec): readonly (ChordInfo | null)[] | null {
  const info = (root: string, structureId: StructureId): ChordInfo => ({ root, structureId, name: `${root}${CHORD_SYMBOL[structureId] ?? ''}` });
  switch (spec.templateId) {
    case 'progression': return progressionChordRefs(spec.params.root, spec.params.progression).map(chord => info(chord.root, chord.structureId));
    case 'riff': return riffChords(RIFFS[spec.params.riff], spec.params.root).map(chord => info(chord.root, chord.structureId));
    case 'line': return spec.params.bars.map(bar => info(stepName(spec.params.root, bar.step), bar.chord));
    case 'song-fragment': return spec.params.bars.map(bar => parseChord(bar.chord));
    default: return null;
  }
}

/* ---------- «Своя линия» (R-028, B5) ---------- */

const STEP_LETTERS = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PITCH = [0, 2, 4, 5, 7, 9, 11];
/** Тоника аккорда: буква — по ступени от тоники линии, знак — чтобы получилось `step` полутонов (B5.2). */
export function stepName(root: string, step: number): string {
  const tonic = parseNote(root);
  const letter = (LETTER_NAMES.indexOf(tonic.letter) + STEP_LETTERS[step]) % 7;
  let accidental = (((tonic.pitchClass + step - LETTER_PITCH[letter]) % 12) + 12) % 12;
  if (accidental > 6) accidental -= 12;
  return LETTER_NAMES[letter] + (accidental > 0 ? '♯'.repeat(accidental) : '♭'.repeat(-accidental));
}
const ROMAN_MAJOR = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♭V', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const ROMAN_MINOR = ['I', '♭II', 'II', 'III', '♯III', 'IV', '♭V', 'V', 'VI', '♯VI', 'VII', '♯VII'];
/** Цифра аккорда по ступени и ладу; строчная у минорных аккордов, суффикс `7` или `maj7`. */
function lineRoman(step: number, mode: LineMode, chord: LineChord): string {
  const base = (mode === 'major' ? ROMAN_MAJOR : ROMAN_MINOR)[step];
  const minor = chordFamily(chord) === 'minor';
  const [, sign, numeral] = /^([♭♯]?)(.+)$/.exec(base)!;
  return `${sign}${minor ? numeral.toLowerCase() : numeral}${chord === 'major-seventh' ? 'maj7' : chord === 'dominant-seventh' || chord === 'minor-seventh' ? '7' : ''}`;
}

/** «Своя линия»: аккорды по `step`, позиции тоник и ноты — как у последовательности, ритм каждого такта — по его рисунку (`timing`). */
function linePlan(root: string, mode: LineMode, position: LinePosition, bars: readonly LineBar[]): Built {
  const chords: ChordRef[] = bars.map(bar => ({ root: stepName(root, bar.step), structureId: bar.chord, roman: lineRoman(bar.step, mode, bar.chord) }));
  const built = chordBars(chords, bars.map(bar => bar.pattern), position, createStructure(root, mode === 'major' ? 'major' : 'natural-minor'));
  const timing = built.bars!.flatMap((forms, index) => barLayout(rhythmPattern(bars[index].rhythm), forms).map(step => (step.tie ? { note: step.note, grids: step.grids, tie: true } : { note: step.note, grids: step.grids })));
  return { ...built, timing, title: 'Своя линия' };
}

/** Событие фигуры такта: начало и длина в шестнадцатых; `null` вместо тона — пауза. */
interface RiffEvent { readonly start: number; readonly grids: number; readonly tone: Tone | 'approach' | null }
const eighths = (tone: Tone | 'approach', from: number, count: number): RiffEvent[] => Array.from({ length: count }, (_, step) => ({ start: from + step * 2, grids: 2, tone }));

/** Фигура по аккордам: позиция тоники — `closed` (B0.1), тоны — клетки B0.2 от тоники своего аккорда. `series` — номер такта в серии одинаковых аккордов. */
interface ChordRiff {
  readonly kind: 'chords'; readonly title: string;
  /** Подпись такта — имя аккорда без римской цифры («C7»), если у аккордов нет цифр. */
  readonly plainLabels?: true;
  readonly chords: (root: string) => readonly ChordRef[];
  readonly bar: (index: number, series: number, last: boolean) => readonly RiffEvent[];
}
/** Нота фигуры в окне пентатоники: струна и лад относительно `a` (лад тоники на струне E), тон, длина в шестнадцатых. */
interface FormEvent { readonly string: StringId; readonly offset: number; readonly tone: Tone; readonly grids: number }
/** Такт фигуры в форме пентатоники: форма A, B или C (окно `a…a+3`, `a+2…a+5`, `a+4…a+7`) и ноты по порядку. */
interface FormBar { readonly form: 'A' | 'B' | 'C'; readonly events: readonly FormEvent[] }
interface FormRiff { readonly kind: 'forms'; readonly title: string; readonly bars: readonly FormBar[] }
type RiffFigure = ChordRiff | FormRiff;

/** Начало окна формы от `a`. */
const FORM_WINDOW: Readonly<Record<FormBar['form'], number>> = { A: 0, B: 2, C: 4 };
const fn = (string: StringId, offset: number, tone: Tone, grids = 2): FormEvent => ({ string, offset, tone, grids });

/**
 * Номер такта в серии подряд идущих тактов с одним и тем же аккордом (тоника и вид), с нуля, от первого такта прохода;
 * через конец прохода серия не продолжается (B2.4, B4). Общий для `boogie-12` и `walking`.
 */
export function chordSeries(chords: readonly { readonly root: string; readonly structureId: StructureId }[]): number[] {
  const result: number[] = [];
  chords.forEach((chord, index) => {
    const previous = chords[index - 1];
    result.push(previous && previous.root === chord.root && previous.structureId === chord.structureId ? result[index - 1] + 1 : 0);
  });
  return result;
}

const progressionRiff = (progression: ProgressionId) => (root: string) => progressionChordRefs(root, progression);
/** Четыре доминантсептаккорда по кварте вверх: `root`, затем IV ступень мажора предыдущего (как у `cycle-fourths`). */
function fourthsCycleChords(root: string): readonly ChordRef[] {
  const chords: ChordRef[] = [];
  let name = parseNote(root).name;
  for (let bar = 0; bar < 4; bar++) {
    chords.push({ root: name, structureId: 'dominant-seventh', roman: '' });
    name = createStructure(name, 'major').notes[3].name;
  }
  return chords;
}

/** Фигуры такта по B4: на каждом такте последовательности — своя функция; ритм входит в фигуру. */
const RIFFS: Readonly<Record<RiffId, RiffFigure>> = {
  'rock-eighths': {
    kind: 'chords', title: 'Рок-восьмые', chords: progressionRiff('I-IV-V'),
    // Такты 1–3: шесть восьмых тоники и две восьмых квинты; такт 4: четыре восьмых, тоника четвертью и четвертная пауза.
    bar: index => index < 3
      ? [...eighths('1', 0, 6), ...eighths('5', 12, 2)]
      : [...eighths('1', 0, 4), { start: 8, grids: 4, tone: '1' }, { start: 12, grids: 4, tone: null }],
  },
  'approach-eighths': {
    kind: 'chords', title: 'С подходом', chords: progressionRiff('I-V-vi-IV'),
    // Четверть, две восьмых, четверть, восьмая — тоника; последняя восьмая — подход к тонике следующего такта.
    bar: () => [{ start: 0, grids: 4, tone: '1' }, { start: 4, grids: 2, tone: '1' }, { start: 6, grids: 2, tone: '1' }, { start: 8, grids: 4, tone: '1' }, { start: 12, grids: 2, tone: '1' }, { start: 14, grids: 2, tone: 'approach' }],
  },
  'disco-octaves': {
    kind: 'chords', title: 'Октавы диско', chords: progressionRiff('I-vi-IV-V'),
    // На каждую долю: тоника восьмой, октава шестнадцатой на «и», шестнадцатая пауза.
    bar: () => Array.from({ length: 4 }, (_, beat): RiffEvent[] => [{ start: beat * 4, grids: 2, tone: '1' }, { start: beat * 4 + 2, grids: 1, tone: '8' }, { start: beat * 4 + 3, grids: 1, tone: null }]).flat(),
  },
  'penta-a': {
    kind: 'chords', title: 'В форме A пентатоники', chords: progressionRiff('i-iv-v'),
    // Форма A минорной пентатоники от тоники своего аккорда: 1, ♭3, 4, 5, ♭7, 5.
    bar: () => [{ start: 0, grids: 4, tone: '1' }, { start: 4, grids: 2, tone: 'b3' }, { start: 6, grids: 2, tone: '4' }, { start: 8, grids: 4, tone: '5' }, { start: 12, grids: 2, tone: 'b7' }, { start: 14, grids: 2, tone: '5' }],
  },
  'boogie-12': {
    kind: 'chords', title: 'Буги-рифф', chords: progressionRiff('blues-12'),
    // Нечётный такт серии — ход вверх U (1 1 3 3 5 5 6 6), чётный — вниз D (♭7 ♭7 6 6 5 5 3 3); последний такт — остановка.
    bar: (_, series, last) => last
      ? [...eighths('1', 0, 2), ...eighths('3', 4, 2), { start: 8, grids: 4, tone: '5' }, { start: 12, grids: 4, tone: null }]
      : (series % 2 === 0 ? (['1', '1', '3', '3', '5', '5', '6', '6'] as const) : (['b7', 'b7', '6', '6', '5', '5', '3', '3'] as const))
        .map((tone, at): RiffEvent => ({ start: at * 2, grids: 2, tone })),
  },
  'fourths-cycle': {
    kind: 'chords', title: 'По кругу кварт', plainLabels: true, chords: fourthsCycleChords,
    // Длины 3, 1, 2, 2, 4, 2, 2: нечётные события — шаффл недопустим.
    bar: () => [{ start: 0, grids: 3, tone: '1' }, { start: 3, grids: 1, tone: '1' }, { start: 4, grids: 2, tone: '5' }, { start: 6, grids: 2, tone: 'b7' }, { start: 8, grids: 4, tone: '8' }, { start: 12, grids: 2, tone: 'b7' }, { start: 14, grids: 2, tone: '5' }],
  },
  'three-forms': {
    kind: 'forms', title: 'Через три формы',
    // Четыре такта i: формы A, B, C и ещё раз C; смена формы — на первой ноте такта.
    bars: [
      { form: 'A', events: [fn('E', 0, '1'), fn('E', 3, 'b3'), fn('A', 0, '4'), fn('A', 2, '5'), fn('A', 0, '4'), fn('E', 3, 'b3'), fn('E', 0, '1', 4)] },
      { form: 'B', events: [fn('A', 2, '5'), fn('A', 5, 'b7'), fn('D', 2, '1'), fn('D', 5, 'b3'), fn('D', 2, '1'), fn('A', 5, 'b7'), fn('A', 2, '5', 4)] },
      { form: 'C', events: [fn('D', 5, 'b3'), fn('D', 7, '4'), fn('G', 4, '5'), fn('G', 7, 'b7'), fn('G', 4, '5'), fn('D', 7, '4'), fn('D', 5, 'b3', 4)] },
      { form: 'C', events: [fn('A', 7, '1', 4), fn('D', 5, 'b3'), fn('A', 7, '1'), fn('A', 7, '1', 8)] },
    ],
  },
  'shift-ab': {
    kind: 'forms', title: 'Переход A→B',
    // Два такта i: форма A (лады a…a+3), затем форма B (a+2…a+5); смена формы — на первой ноте такта.
    bars: [
      { form: 'A', events: [fn('E', 0, '1'), fn('E', 3, 'b3'), fn('A', 0, '4'), fn('A', 2, '5'), fn('D', 0, 'b7'), fn('A', 2, '5'), fn('A', 0, '4'), fn('A', 2, '5')] },
      { form: 'B', events: [fn('D', 2, '1'), fn('D', 5, 'b3'), fn('G', 2, '4'), fn('G', 4, '5'), fn('G', 2, '4'), fn('D', 5, 'b3'), fn('D', 2, '1', 4)] },
    ],
  },
};

/** Аккорды риффа по тактам: у фигуры по аккордам — её последовательность, у фигуры в формах пентатоники — i в каждом такте. */
function riffChords(figure: RiffFigure, root: string): readonly ChordRef[] {
  if (figure.kind === 'chords') return figure.chords(root);
  const name = parseNote(root).name;
  return figure.bars.map(() => ({ root: name, structureId: 'minor-triad', roman: 'i' }));
}

/** Рифф: позиции — по аккордам (`closed`, B0.1) или по формам пентатоники, ритм задан материалом (`timing`). */
function riffPlan(riff: RiffId, root: string): Built {
  const figure = RIFFS[riff];
  return figure.kind === 'forms' ? formRiffPlan(figure, root) : chordRiffPlan(figure, root);
}

function chordRiffPlan(figure: ChordRiff, root: string): Built {
  const chords = figure.chords(root);
  const base = chordBars(chords, chords.map(() => 'roots'), 'closed', createStructure(root, 'major'));
  const series = chordSeries(chords);
  const drafts: Draft[] = [];
  const timing: { note: number | null; grids: number }[] = [];
  chords.forEach((chord, bar) => {
    const tonic = base.drafts[bar * 8].position;
    const structure = createStructure(chord.root, chord.structureId);
    for (const event of figure.bar(bar, series[bar], bar === chords.length - 1)) {
      if (event.tone === null) { timing.push({ note: null, grids: event.grids }); continue; }
      if (event.tone === 'approach') {
        // Подход (B2.3): на лад ниже тоники следующего такта (у последнего — первого) на её струне; без пальца и ступени.
        const next = base.drafts[((bar + 1) % chords.length) * 8].position;
        drafts.push({ position: spelled(annotate([[next.string, next.fret - 1]], structure)[0], approachName(chords[(bar + 1) % chords.length].root)), finger: null, segment: bar, degree: null });
        timing.push({ note: drafts.length - 1, grids: event.grids });
        continue;
      }
      const [placed] = placeTones({ string: tonic.string, fret: tonic.fret }, [event.tone], chordFamily(chord.structureId))!;
      drafts.push({ position: spelled(annotate([[placed.string, placed.fret]], structure)[0], toneName(chord.root, placed.tone)), finger: placed.finger, segment: bar, degree: event.tone === '8' ? '1' : event.tone });
      timing.push({ note: drafts.length - 1, grids: event.grids });
    }
  });
  const segments = figure.plainLabels ? chords.map(chord => `${chord.root}${CHORD_SYMBOL[chord.structureId] ?? ''}`) : base.segments;
  return { drafts, timing, overlap: 'none', title: `Рифф «${figure.title}»`, segments };
}

/**
 * Рифф в формах пентатоники (B4): `a` — лад тоники на струне E в пределах 1–12 (E → 12); ноты заданы струной и ладом от `a`,
 * палец — лад минус первый лад окна формы плюс 1; аккорд всех тактов — i.
 */
function formRiffPlan(figure: FormRiff, root: string): Built {
  const key = parseNote(root);
  const a = (((key.pitchClass - 4) % 12) + 12) % 12 || 12;
  const structure = createStructure(root, 'minor-triad');
  const drafts: Draft[] = [];
  const timing: { note: number | null; grids: number }[] = [];
  const segments: string[] = [];
  figure.bars.forEach((bar, index) => {
    const from = a + FORM_WINDOW[bar.form];
    segments.push(`${key.name}m · форма ${bar.form} · лады ${from}–${from + 3}`);
    for (const event of bar.events) {
      const fret = a + event.offset;
      if (fret < 1 || fret > 24) throw new RangeError('Рифф не помещается на ладах 1–24.');
      drafts.push({ position: spelled(annotate([[event.string, fret]], structure)[0], toneName(key.name, event.tone)), finger: fret - from + 1, segment: index, degree: event.tone });
      timing.push({ note: drafts.length - 1, grids: event.grids });
    }
  });
  return { drafts, timing, overlap: 'none', title: `Рифф «${figure.title}»`, segments };
}

/** Хроматический подход: полутон снизу к тонике следующего аккорда на её струне (на 1-м ладу — сверху); без пальца и ступени, написание — по B2.3. */
function approachNote(next: BoxInstance, nextRoot: string, segment: number, structure: MusicalStructure): Draft {
  const { anchorString, anchorFret } = next.selection;
  const fret = anchorFret - 1 >= 1 ? anchorFret - 1 : anchorFret + 1;
  return { position: spelled(annotate([[anchorString, fret]], structure)[0], approachName(nextRoot, anchorFret - 1 < 1)), finger: null, segment, degree: null };
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

const FOURTHS_ROW = ['C', 'F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'B', 'E', 'A', 'D', 'G'] as const;
const CHROMATIC_LABELS = createStructure('C', 'major');
function chromatic(string: StringId, fret: number) { return annotatePositions([getPosition(string, fret)], CHROMATIC_LABELS)[0]; }

function buildPlan(spec: ExerciseSpec): ExercisePlan {
  const template = getExerciseTemplate(spec.templateId);
  const built = (BUILDERS[spec.templateId] as (params: ExerciseSpec['params']) => Built)(spec.params);
  if (!built.drafts.length) throw new RangeError('Упражнение не содержит нот.');
  const notes = built.drafts.map(({ position, finger, segment, degree, stretch, pluck, gate }) => ({
    id: position.id, string: position.string, fret: position.fret, midi: position.midi,
    name: formatMidi(position.midi, position.noteName), degree: degree === undefined ? position.degree : degree, finger, stretch: stretch ?? false, segment,
    pluck: pluck ?? null, gate: gate ?? null,
  }));
  return deepFreeze({
    spec, title: built.title ?? template.title, category: template.category, concepts: template.concepts,
    segments: built.segments.map(label => ({ label })), task: TEMPLATE_TASKS[spec.templateId], notes, positions: built.drafts.map(draft => draft.position),
    overlap: built.overlap ?? 'shared',
    cadence: TONIC_CADENCE.has(spec.templateId) && notes.some(note => note.degree === '1') ? 'tonic' : 'none',
    timing: built.timing ?? null, bars: built.bars ?? null,
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
  'pulse-note': 100, 'chromatic-shift': 96, 'string-naturals': 80, riff: 96, line: 96, 'long-short': 100, 'string-fourths': 80, 'interval-from-note': 84,
  'finger-pairs': 96, stretch: 80, 'scale-two-octaves': 84, 'scale-neck': 80,
});
/** Цель темпа материала: у фрагмента песни — темп партитуры, у остальных — цель шаблона. */
export const targetBpmFor = (spec: ExerciseSpec): number => spec.templateId === 'song-fragment' ? spec.params.bpm : TEMPLATE_TARGET_BPM[spec.templateId];

/** Шаблоны, проход которых завершается тоникой: формы, гаммы, арпеджио, секвенции, транспонирование. */
const TONIC_CADENCE: ReadonlySet<ExerciseTemplateId> = new Set<ExerciseTemplateId>([
  'pentatonic-form', 'pentatonic-relative', 'scale-compact', 'blues-scale', 'connect-forms', 'pentatonic-neck', 'scale-one-string',
  'scale-position', 'arpeggio-1358', 'arpeggio-seventh', 'arpeggio-inversion', 'root-five-eight', 'groups-of-three', 'thirds',
  'form-transpose', 'cycle-fourths', 'scale-two-octaves', 'scale-neck',
]);

/**
 * Структура, по которой у материала есть ступени для «Проверь себя».
 * У хроматики, смены позиции, нот по грифу, октав, транспонирования формы и квинтового круга
 * одной тоники с осмысленными ступенями нет — проверка ступеней для них недоступна.
 */
export function exerciseStructure(spec: ExerciseSpec): MusicalStructure | null {
  switch (spec.templateId) {
    case 'pentatonic-form': case 'scale-compact': case 'connect-forms': case 'pentatonic-neck': case 'scale-one-string':
    case 'scale-position': case 'arpeggio-1358': case 'groups-of-three': case 'thirds': case 'scale-two-octaves': case 'scale-neck':
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
const PROGRESSION_NAMES: Readonly<Record<ProgressionId, string>> = { 'I-IV-V': 'I–IV–V', 'ii-V-I': 'ii–V–I', 'blues-12': 'блюз 12 тактов', 'I-V-vi-IV': 'I–V–vi–IV', 'I-vi-IV-V': 'I–vi–IV–V', 'i-iv-v': 'i–iv–v', 'i-iv': 'i–iv', 'i-V-i': 'i–V–i', 'i-VII-VI-V': 'i–VII–VI–V', diatonic: 'трезвучия по ступеням' };
/** Позиция последовательности (B0.1): закрытая переносится по грифу, нижняя начинается у порожка, открытые — тоники на открытых струнах. */
export const POSITION_NAMES: Readonly<Record<ProgressionPosition, string>> = { closed: 'закрытая', low: 'нижняя', open: 'открытые струны' };
const PATTERN_NAMES: Readonly<Record<ProgressionPattern, string>> = { roots: 'тоники', 'root-fifth': 'тоника и квинта', octaves: 'октавы', arpeggio: 'арпеджио', approach: 'арпеджио и подходы', boogie: 'буги', r5b78: '1–5–♭7–8', r56: '1–5–6', 'roots-approach': 'тоники с подходом', 'roots-passing': 'тоники с проходящими', walking: 'шагающий бас' };
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const option = <T extends string | number>(param: string, label: string, values: readonly T[], name: (value: T) => string = String): TemplateOption =>
  ({ param, label, values: values.map(value => ({ value, label: name(value) })) });
const notes = (param: string, label = 'Тоника') => option(param, label, NOTE_CHOICES);
const pentaShape = option('shapeId', 'Форма', PENTA_SHAPES, shape => `форма ${SHAPE_LETTER[shape]}`);
const compactShape = option('shapeId', 'Форма', COMPACT_SHAPES, shape => (shape === 'compact-e' ? 'от струны E' : 'от струны A'));
const structures = (values: readonly string[]) => option('structureId', 'Структура', values);
const pentaForm = [notes('root'), structures(PENTA_STRUCTURES), pentaShape];

const OPTIONS: { readonly [Id in ExerciseTemplateId]: readonly TemplateOption[] } = {
  'chromatic-position': [
    option('startFret', 'Лад', range(1, 12)),
    option('fingering', 'Аппликатура', FINGERINGS, fingering => (fingering === '1234' ? 'палец на лад 1-2-3-4' : 'три лада 1-2-4')),
    option('direction', 'Направление', DIRECTIONS, direction => (direction === 'up' ? 'вверх' : 'вверх и вниз')),
  ],
  'string-fourths': [option('string', 'Струна', STRINGS)],
  'interval-from-note': [
    notes('note', 'Нота'), option('interval', 'Интервал', INTERVAL_IDS, id => INTERVAL_FORMS[id].title.toLowerCase()), option('direction', 'Направление', INTERVAL_DIRECTIONS, direction => (direction === 'up' ? 'вверх' : 'вниз')),
  ],
  'long-short': [option('string', 'Струна', STRINGS), option('fret', 'Лад', range(0, 12), fret => (fret === 0 ? 'открытая' : String(fret)))],
  'pulse-note': [option('string', 'Струна', STRINGS), option('fret', 'Лад', range(0, 12), fret => (fret === 0 ? 'открытая' : String(fret))), option('notes', 'Нот', PULSE_NOTES)],
  'chromatic-shift': [option('startFret', 'С лада', range(1, 12)), option('positions', 'Позиций', range(2, 5))],
  'string-naturals': [option('string', 'Струна', STRINGS), option('fretMax', 'До лада', NATURALS_FRET_MAX)],
  'position-shift': [
    option('string', 'Струна', STRINGS), option('startFret', 'С лада', range(1, 12)), option('shifts', 'Сдвигов', range(1, 4)),
    option('jump', 'Шаг', SHIFT_JUMPS, jump => (jump === 1 ? 'на лад' : `скачок на ${jump}`)),
  ],
  'string-crossing': [
    option('pattern', 'Рисунок', CROSSING_PATTERNS, pattern => CROSSING_TITLES[pattern].toLowerCase()),
    option('fret', 'Лад', range(0, 12), fret => (fret === 0 ? 'открытые' : String(fret))),
  ],
  spider: [
    option('startFret', 'С лада', range(1, 12)), option('positions', 'Позиций', range(2, 12)), option('pattern', 'Пальцы', SPIDER_PATTERNS, pattern => [...pattern].join('-')),
    option('path', 'Путь', SPIDER_PATHS, path => (path === 'straight' ? 'прямо' : 'по диагонали')),
  ],
  'finger-pairs': [option('startFret', 'С лада', range(1, 12)), option('pair', 'Пальцы', FINGER_PAIRS, pair => [...pair].join('–'))],
  stretch: [option('startFret', 'С лада', range(1, 12)), option('positions', 'Позиций', range(1, 5))],
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
  'scale-two-octaves': [notes('root'), structures(SCALE_STRUCTURES)],
  'scale-neck': [notes('root'), structures(SCALE_STRUCTURES)],
  'arpeggio-1358': [notes('root'), structures(TRIADS), compactShape],
  'arpeggio-seventh': [notes('root'), structures(SEVENTHS), compactShape],
  'arpeggio-inversion': [notes('root'), structures(TRIADS), option('inversion', 'Обращение', [1, 2], inversion => `${inversion}-е`)],
  'root-five-eight': [notes('root'), option('string', 'Струна', ['E', 'A'])],
  'groups-of-three': [
    notes('root'), structures([...PENTA_STRUCTURES, ...SCALE_STRUCTURES]),
    option('shapeId', 'Форма', [...PENTA_SHAPES, ...COMPACT_SHAPES], shape => (shape.startsWith('penta-') ? `форма ${SHAPE_LETTER[shape as PentaShape]}` : shape === 'compact-e' ? 'от струны E' : 'от струны A')),
    option('group', 'Группа', SEQUENCE_GROUPS, group => `по ${group}`),
  ],
  thirds: [notes('root'), structures(SCALE_STRUCTURES), compactShape],
  'form-transpose': [structures(PENTA_STRUCTURES), pentaShape],
  'cycle-fourths': [notes('root'), option('count', 'Тоник', range(2, 12))],
  'song-fragment': [],
  line: [],
  riff: [option('riff', 'Рифф', RIFF_IDS, id => RIFFS[id].title), notes('root', 'Тональность')],
  progression: [
    notes('root', 'Тональность'), option('progression', 'Последовательность', PROGRESSION_IDS, id => PROGRESSION_NAMES[id]), option('pattern', 'Рисунок', PROGRESSION_PATTERNS, id => PATTERN_NAMES[id]),
    option('position', 'Позиция', PROGRESSION_POSITIONS, id => POSITION_NAMES[id]),
  ],
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
    if (spec.templateId === 'chromatic-shift') patches.push({ positions: Math.max(2, 14 - Number(params.startFret)) }, { startFret: Math.max(1, 14 - Number(params.positions)) });
    if (spec.templateId === 'spider') patches.push({ positions: Math.max(2, 14 - Number(params.startFret)) }, { startFret: Math.max(1, 14 - Number(params.positions)) });
    if (spec.templateId === 'position-shift') {
      // Скачок не помещается: сначала меньше сдвигов, потом ниже первый лад.
      const jump = Number(params.jump);
      for (let shifts = Number(params.shifts) - 1; shifts >= 1; shifts--) patches.push({ shifts });
      patches.push({ startFret: Math.max(1, 21 - Number(params.shifts) * jump) }, { shifts: 1, startFret: Math.max(1, 21 - jump) });
    }
    if (spec.templateId === 'stretch') patches.push({ positions: Math.min(5, Number(params.startFret)) }, { startFret: Math.max(Number(params.positions), 1) });
    if (spec.templateId === 'progression') patches.push({ pattern: 'roots' }, { position: 'closed' }, { progression: 'blues-12' });
    if ('shapeId' in params) {
      // Форма — по структуре: пентатоника по формам `penta-*`, гаммы и аккорды — по компактным.
      const pentatonic = typeof params.structureId === 'string' ? params.structureId.endsWith('pentatonic') : String(params.shapeId).startsWith('penta-');
      for (const shapeId of pentatonic ? PENTA_SHAPES : COMPACT_SHAPES) patches.push({ shapeId });
    }
    // Выбранный пользователем параметр не подстраивается — только зависимые.
    for (const patch of patches.filter(candidate => !(param in candidate))) {
      try { return attempt(patch); } catch { /* Следующее допустимое сочетание. */ }
    }
    throw failure;
  }
}
