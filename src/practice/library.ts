/**
 * Библиотека упражнений (R-026): встроенные шаблоны exercise-v1 и собственные упражнения,
 * которые заменяют прежние пресеты. Чистый модуль.
 */
import {
  createExerciseSpec, EXERCISE_TEMPLATES, validateExerciseSpec,
  type ConceptId, type ExerciseCategory, type ExerciseParams, type ExerciseSpec, type ExerciseTemplateId,
} from '../exercises';
import { parseNote, type StructureId } from '../music';
import { builtinTemplateOf, exerciseKey } from './material';

export const CATEGORY_TITLES: Readonly<Record<ExerciseCategory, string>> = Object.freeze({
  warmup: 'Разминка и техника',
  notes: 'Ноты на грифе',
  forms: 'Формы',
  connections: 'Связки форм',
  positions: 'Гаммы по позициям',
  arpeggios: 'Арпеджио и тоны аккорда',
  sequences: 'Секвенции',
  transposition: 'Транспонирование',
  progressions: 'Последовательности аккордов',
});
export const CATEGORY_ORDER = Object.keys(CATEGORY_TITLES) as readonly ExerciseCategory[];

export interface UserExercise {
  readonly version: 'user-exercise-v1';
  readonly id: string;
  readonly name: string;
  readonly spec: ExerciseSpec;
  readonly createdAt: string;
}
export interface LibraryItem {
  /** Неизменный id карточки: `tpl:<шаблон>` или `user:<id>` (разметка, фокус, настройка карточки). */
  readonly id: string;
  /** `builtin:<материал>` или `user:<id>`; по ключу связываются план, результаты и прогресс. */
  readonly key: string;
  readonly title: string;
  readonly category: ExerciseCategory;
  readonly concepts: readonly ConceptId[];
  readonly spec: ExerciseSpec;
  readonly builtin: boolean;
}
export interface LibraryFilter {
  readonly category?: ExerciseCategory | null;
  readonly structureId?: StructureId | null;
  readonly concept?: ConceptId | null;
  readonly status?: 'all' | 'new' | 'played';
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

export function validateUserExercise(value: unknown): UserExercise {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new RangeError('Упражнение: нужен обычный JSON-объект.');
  const raw = value as Record<string, unknown>;
  const keys = ['version', 'id', 'name', 'spec', 'createdAt'];
  if (Reflect.ownKeys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) throw new RangeError(`Упражнение: ожидаются поля ${keys.join(', ')}.`);
  if (raw.version !== 'user-exercise-v1') throw new RangeError('Неизвестная версия упражнения.');
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) throw new RangeError('Упражнение: некорректный идентификатор.');
  if (typeof raw.name !== 'string' || raw.name.trim() !== raw.name || raw.name.length < 1 || raw.name.length > 80) throw new RangeError('Название упражнения: от 1 до 80 символов без пробелов по краям.');
  if (typeof raw.createdAt !== 'string' || !ISO.test(raw.createdAt) || Number.isNaN(Date.parse(raw.createdAt))) throw new RangeError('Упражнение: некорректная дата создания.');
  return deepFreeze({ version: 'user-exercise-v1', id: raw.id, name: raw.name, spec: validateExerciseSpec(raw.spec), createdAt: raw.createdAt });
}

/** Параметр тоники шаблона, если он есть (у «Хроматики» и «Смены позиции» тоники нет). */
const ROOT_PARAM: Partial<Record<ExerciseTemplateId, 'root' | 'minorRoot' | 'note'>> = {
  'note-all-positions': 'note', octaves: 'note', 'pentatonic-form': 'root', 'pentatonic-relative': 'minorRoot', 'scale-compact': 'root',
  'connect-forms': 'root', 'pentatonic-neck': 'root', 'scale-one-string': 'root', 'scale-position': 'root', 'arpeggio-1358': 'root',
  'root-five-eight': 'root', 'groups-of-three': 'root', thirds: 'root', 'cycle-fourths': 'root',
  'blues-scale': 'root', 'arpeggio-seventh': 'root', 'arpeggio-inversion': 'root', progression: 'root',
};

/**
 * Встроенные шаблоны. «Играть от» подставляет тонику в шаблоны с одной тоникой; если форма с этой тоникой
 * не помещается на грифе, шаблон остаётся со своей тоникой, а не исправляется молча на другую структуру.
 */
export function builtinLibrary(playFrom: string | null = null): readonly LibraryItem[] {
  const root = playFrom === null ? null : parseNote(playFrom).name;
  return deepFreeze(EXERCISE_TEMPLATES.map(template => {
    let spec = createExerciseSpec(template.id);
    const param = ROOT_PARAM[template.id];
    if (root && param) {
      try { spec = createExerciseSpec(template.id, { [param]: root } as Partial<ExerciseParams[typeof template.id]>); }
      catch { /* Тоника не подходит этому шаблону: остаётся его материал по умолчанию. */ }
    }
    return { id: `tpl:${template.id}`, key: exerciseKey(spec), title: template.title, category: template.category, concepts: template.concepts, spec, builtin: true };
  }));
}

export function userLibrary(exercises: readonly UserExercise[]): readonly LibraryItem[] {
  const templates = new Map(EXERCISE_TEMPLATES.map(template => [template.id, template]));
  return deepFreeze(exercises.map(exercise => {
    const template = templates.get(exercise.spec.templateId)!;
    return { id: `user:${exercise.id}`, key: `user:${exercise.id}`, title: exercise.name, category: template.category, concepts: template.concepts, spec: exercise.spec, builtin: false };
  }));
}

function structureOf(spec: ExerciseSpec): StructureId | null {
  const params = spec.params as Record<string, unknown>;
  if (typeof params.structureId === 'string') return params.structureId as StructureId;
  if (spec.templateId === 'pentatonic-relative') return 'minor-pentatonic';
  if (spec.templateId === 'blues-scale') return 'blues';
  return null;
}

/**
 * Упражнение «в работе»: своё — по своему ключу, встроенное — если играно любое исполнение шаблона
 * (другая тоника или форма тоже считаются: «Играть от» не делает упражнение «неигранным»).
 */
export function isPlayed(item: LibraryItem, played: ReadonlySet<string>): boolean {
  if (!item.builtin) return played.has(item.key);
  for (const key of played) if (builtinTemplateOf(key) === item.spec.templateId) return true;
  return false;
}

/** Фильтр библиотеки; `played` — ключи упражнений, по которым уже есть самооценка. */
export function filterLibrary(items: readonly LibraryItem[], filter: LibraryFilter, played: ReadonlySet<string> = new Set()): readonly LibraryItem[] {
  return items.filter(item =>
    (!filter.category || item.category === filter.category)
    && (!filter.structureId || structureOf(item.spec) === filter.structureId)
    && (!filter.concept || item.concepts.includes(filter.concept))
    && (filter.status === undefined || filter.status === 'all' || (filter.status === 'new') !== isPlayed(item, played)));
}

export function countByCategory(items: readonly LibraryItem[]): Readonly<Record<ExerciseCategory, number>> {
  const counts = Object.fromEntries(CATEGORY_ORDER.map(category => [category, 0])) as Record<ExerciseCategory, number>;
  for (const item of items) counts[item.category]++;
  return Object.freeze(counts);
}
