/**
 * Шаг проверки `check-v2` (R-028, дополнение A9): описание серии экранных вопросов по диапазону грифа
 * или по материалу упражнения и тождество проверки `checkId`. Чистый модуль без DOM и хранилища.
 * Здесь — форма, строгая проверка полей и допустимых сочетаний; наличие целей вопроса в области
 * проверяет генератор серии.
 */
import { earQualityFor } from '../ear';
import { exerciseStructure, validateExerciseSpec, type ExerciseSpec } from '../exercises';
import { parseNote, type StringId } from '../music';
import { materialId } from './material';

export type CheckKind = 'find-note' | 'name-note' | 'find-all' | 'find-degree' | 'name-degree';
export const CHECK_KINDS: readonly CheckKind[] = Object.freeze(['find-note', 'name-note', 'find-all', 'find-degree', 'name-degree']);

export type CheckArea =
  | { readonly type: 'exercise'; readonly exercise: ExerciseSpec }
  | { readonly type: 'range'; readonly strings: readonly StringId[]; readonly fretMin: number; readonly fretMax: number };
export type NoteSet = 'natural' | 'all';
export type CheckSubject =
  | { readonly type: 'notes'; readonly notes: NoteSet }
  | { readonly type: 'chord-root'; readonly notes: NoteSet }
  | { readonly type: 'roman-root'; readonly key: string }
  | { readonly type: 'degrees'; readonly scale: { readonly root: string; readonly degrees: readonly string[] } | null; readonly targets: readonly string[] | null };

export interface CheckSpec {
  readonly version: 'check-v2';
  readonly kind: CheckKind;
  readonly area: CheckArea;
  readonly subject: CheckSubject;
  /** 3–20; шаги программы — 6. */
  readonly count: number;
  readonly ear: boolean;
}

/** Серия в шаге программы — всегда шесть вопросов. */
export const PROGRAM_CHECK_COUNT = 6;
export const CHECK_COUNT_MIN = 3;
export const CHECK_COUNT_MAX = 20;
export const CHECK_MAX_FRET = 24;

/** Ступени по возрастанию полутонов; `#4` и `b5` — один класс высоты и вместе не встречаются. */
const DEGREE_SEMITONES: Readonly<Record<string, number>> = Object.freeze({
  1: 0, b2: 1, 2: 2, b3: 3, 3: 4, 4: 5, '#4': 6, b5: 6, 5: 7, b6: 8, 6: 9, b7: 10, 7: 11,
});
const STRING_ORDER: readonly StringId[] = ['E', 'A', 'D', 'G'];
const DEGREE_KINDS: ReadonlySet<CheckKind> = new Set(['find-degree', 'name-degree']);
const NOTE_KINDS: ReadonlySet<CheckKind> = new Set(['find-note', 'name-note', 'find-all']);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new RangeError(`${label}: нужен обычный JSON-объект.`);
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new RangeError(`${label}: допускаются только обычные поля.`);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new RangeError(`${label}: ожидаются поля ${keys.join(', ')}.`);
  return value as Record<string, unknown>;
}
function note(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new RangeError(`${label}: нужно название ноты.`);
  parseNote(value);
  return value;
}
function degreeList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new RangeError(`${label}: нужен непустой список ступеней.`);
  let previous = -1;
  for (const degree of value) {
    if (typeof degree !== 'string' || !Object.hasOwn(DEGREE_SEMITONES, degree)) throw new RangeError(`${label}: неизвестная ступень.`);
    if (DEGREE_SEMITONES[degree] <= previous) throw new RangeError(`${label}: ступени идут по возрастанию полутонов, без двух ступеней одного класса высоты.`);
    previous = DEGREE_SEMITONES[degree];
  }
  return value as string[];
}

function validateArea(value: unknown): CheckArea {
  const type = (value as { type?: unknown } | null)?.type;
  if (type === 'exercise') {
    const raw = record(value, ['type', 'exercise'], 'Область проверки');
    return { type: 'exercise', exercise: validateExerciseSpec(raw.exercise) };
  }
  if (type === 'range') {
    const raw = record(value, ['type', 'strings', 'fretMin', 'fretMax'], 'Область проверки');
    const strings = raw.strings;
    if (!Array.isArray(strings) || strings.length < 1 || strings.length > 4 || strings.some(item => !STRING_ORDER.includes(item as StringId))) throw new RangeError('Область проверки: от одной до четырёх струн E, A, D, G.');
    const indexes = (strings as StringId[]).map(item => STRING_ORDER.indexOf(item));
    if (indexes.some((index, at) => at > 0 && index <= indexes[at - 1])) throw new RangeError('Область проверки: струны идут в порядке E, A, D, G без повторов.');
    const { fretMin, fretMax } = raw;
    if (!Number.isInteger(fretMin) || !Number.isInteger(fretMax) || (fretMin as number) < 0 || (fretMin as number) > (fretMax as number) || (fretMax as number) > CHECK_MAX_FRET) {
      throw new RangeError(`Область проверки: лады от 0 до ${CHECK_MAX_FRET}, начало не больше конца.`);
    }
    return { type: 'range', strings: strings as StringId[], fretMin: fretMin as number, fretMax: fretMax as number };
  }
  throw new RangeError('Неизвестная область проверки.');
}

function validateSubject(value: unknown): CheckSubject {
  const type = (value as { type?: unknown } | null)?.type;
  if (type === 'notes' || type === 'chord-root') {
    const raw = record(value, ['type', 'notes'], 'Предмет проверки');
    if (raw.notes !== 'natural' && raw.notes !== 'all') throw new RangeError('Предмет проверки: natural или all.');
    return { type, notes: raw.notes };
  }
  if (type === 'roman-root') {
    const raw = record(value, ['type', 'key'], 'Предмет проверки');
    return { type, key: note(raw.key, 'Тональность') };
  }
  if (type === 'degrees') {
    const raw = record(value, ['type', 'scale', 'targets'], 'Предмет проверки');
    let scale: { root: string; degrees: readonly string[] } | null = null;
    if (raw.scale !== null) {
      const parsed = record(raw.scale, ['root', 'degrees'], 'Гамма проверки');
      const degrees = degreeList(parsed.degrees, 'Ступени гаммы');
      if (degrees.length < 2 || degrees[0] !== '1') throw new RangeError('Гамма проверки: от двух ступеней, обязательно с 1.');
      scale = { root: note(parsed.root, 'Тоника гаммы'), degrees };
    }
    let targets: readonly string[] | null = null;
    if (raw.targets !== null) {
      targets = degreeList(raw.targets, 'Цели вопросов');
      if (scale && targets.some(degree => !scale!.degrees.includes(degree))) throw new RangeError('Цели вопросов входят в ступени гаммы.');
    }
    return { type, scale, targets };
  }
  throw new RangeError('Неизвестный предмет проверки.');
}

/**
 * Строгая проверка описания `check-v2`: ровно перечисленные поля на каждом уровне и допустимые сочетания
 * вида вопроса, области и предмета (A9.1). Слух — только у ступеней материала без ограничения целей.
 */
export function validateCheckSpec(value: unknown): CheckSpec {
  const raw = record(value, ['version', 'kind', 'area', 'subject', 'count', 'ear'], 'Проверка');
  if (raw.version !== 'check-v2') throw new RangeError('Неизвестная версия проверки.');
  if (!CHECK_KINDS.includes(raw.kind as CheckKind)) throw new RangeError('Неизвестный вид проверки.');
  const kind = raw.kind as CheckKind;
  if (!Number.isInteger(raw.count) || (raw.count as number) < CHECK_COUNT_MIN || (raw.count as number) > CHECK_COUNT_MAX) throw new RangeError(`В проверке от ${CHECK_COUNT_MIN} до ${CHECK_COUNT_MAX} вопросов.`);
  if (typeof raw.ear !== 'boolean') throw new RangeError('Опция слуха должна быть да или нет.');
  const area = validateArea(raw.area);
  const subject = validateSubject(raw.subject);
  if (subject.type === 'degrees') {
    if (!DEGREE_KINDS.has(kind)) throw new RangeError('Вопросы о ступенях — виды find-degree и name-degree.');
    if (area.type === 'exercise' && subject.scale !== null) throw new RangeError('У материала упражнения гамма берётся из его структуры.');
    if (area.type === 'exercise') {
      const structure = exerciseStructure(area.exercise);
      if (!structure) throw new RangeError('В материале этого упражнения нет ступеней одной тоники — проверка ступеней недоступна.');
      if (subject.targets && subject.targets.some(degree => !structure.notes.some(note => note.degree === degree))) throw new RangeError('Цели вопросов входят в ступени структуры материала.');
    }
    if (area.type === 'range' && subject.scale === null) throw new RangeError('У диапазона грифа нужна гамма проверки.');
  } else {
    if (!NOTE_KINDS.has(kind)) throw new RangeError('Вопросы о нотах — виды find-note, name-note и find-all.');
    if ((subject.type === 'chord-root' || subject.type === 'roman-root') && (kind !== 'find-note' || area.type !== 'range')) {
      throw new RangeError('Тоника аккорда: вид find-note и диапазон грифа.');
    }
  }
  if (raw.ear && !(subject.type === 'degrees' && area.type === 'exercise' && subject.targets === null)) {
    throw new RangeError('Слух — только у ступеней материала упражнения без ограничения целей.');
  }
  if (raw.ear && area.type === 'exercise' && earQualityFor(exerciseStructure(area.exercise)!.id) === null) throw new RangeError('Слух есть только у пентатоник, трезвучий, септаккордов и блюзовой гаммы.');
  return deepFreeze({ version: 'check-v2', kind, area, subject, count: raw.count as number, ear: raw.ear }) as CheckSpec;
}

const slug = (text: string) => text.replaceAll('♯', 's').replaceAll('#', 's').replaceAll('♭', 'b');

/**
 * Тождество проверки (A9.6): `вид.область.предмет[.ear]`; число вопросов в него не входит.
 * Область — `ex-<материал>` или `<струны>-<от>-<до>`; предмет — `notes-natural`, `chord-all`, `roman-C`, `deg`, `deg-A-1_5_6_b7-t-b7`.
 */
export function checkId(spec: CheckSpec): string {
  const area = spec.area.type === 'exercise' ? `ex-${materialId(spec.area.exercise)}` : `${spec.area.strings.join('')}-${spec.area.fretMin}-${spec.area.fretMax}`;
  const subject = spec.subject;
  let name: string;
  if (subject.type === 'notes') name = `notes-${subject.notes}`;
  else if (subject.type === 'chord-root') name = `chord-${subject.notes}`;
  else if (subject.type === 'roman-root') name = `roman-${slug(subject.key)}`;
  else {
    name = subject.scale ? `deg-${slug(subject.scale.root)}-${subject.scale.degrees.map(slug).join('_')}` : 'deg';
    if (subject.targets) name += `-t-${subject.targets.map(slug).join('_')}`;
  }
  return `${spec.kind}.${area}.${name}${spec.ear ? '.ear' : ''}`;
}

/** Серия засчитывается шагу только при описании без изменений, включая число вопросов (A9.5): сравнение полное. */

/** Материал упражнения, если проверка задана по нему; у проверки по диапазону — `null`. */
export const checkExercise = (spec: CheckSpec): ExerciseSpec | null => (spec.area.type === 'exercise' ? spec.area.exercise : null);

/** Проверка ступеней материала упражнения: вид find-degree или name-degree, цели — любые ступени структуры. */
export function degreeCheck(exercise: ExerciseSpec, kind: 'find-degree' | 'name-degree', count: number, ear = false): CheckSpec {
  return validateCheckSpec({ version: 'check-v2', kind, area: { type: 'exercise', exercise }, subject: { type: 'degrees', scale: null, targets: null }, count, ear });
}
