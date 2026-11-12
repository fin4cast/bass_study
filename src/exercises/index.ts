/**
 * Каталог упражнений exercise-v1 (R-026): чистое построение плана упражнения.
 * Модуль не обращается к DOM, звуку и базе. Формы берутся из boxes-v1, порядок «туда-обратно»
 * и группы по три — из существующего генератора последовательностей.
 */
import {
  annotatePositions, createStructure, formatMidi, getPosition, parseNote,
  type AnnotatedPosition, type MusicalStructure, type StringId, type StructureId,
} from '../music';
import { getBoxCatalogue, getBoxOverlap, type BoxInstance, type BoxShapeId } from '../music/boxes';
import { createSequence, type SequencePattern } from '../training';

export type ExerciseCategory = 'warmup' | 'notes' | 'forms' | 'connections' | 'positions' | 'arpeggios' | 'sequences' | 'transposition';
export type ConceptId =
  | 'finger-per-fret' | 'position-shift' | 'semitone' | 'octave' | 'unison' | 'degrees' | 'pentatonic' | 'relative-keys'
  | 'scale-formula' | 'shared-notes' | 'form-system' | 'triad' | 'fifth' | 'sequence' | 'third' | 'transposition' | 'circle-of-fifths';

type Pentatonic = 'minor-pentatonic' | 'major-pentatonic';
type Scale = 'major' | 'natural-minor';
type Triad = 'major-triad' | 'minor-triad';
type PentaShape = Extract<BoxShapeId, `penta-${string}`>;
type CompactShape = 'compact-e' | 'compact-a';

export interface ExerciseParams {
  readonly 'chromatic-position': { readonly startFret: number };
  readonly 'position-shift': { readonly string: StringId; readonly startFret: number; readonly shifts: number };
  readonly 'note-all-positions': { readonly note: string };
  readonly octaves: { readonly note: string };
  readonly 'pentatonic-form': { readonly root: string; readonly structureId: Pentatonic; readonly shapeId: PentaShape };
  readonly 'pentatonic-relative': { readonly minorRoot: string; readonly shapeId: PentaShape };
  readonly 'scale-compact': { readonly root: string; readonly structureId: Scale; readonly shapeId: CompactShape };
  readonly 'connect-forms': { readonly root: string; readonly structureId: Pentatonic; readonly shapeId: PentaShape };
  readonly 'pentatonic-neck': { readonly root: string; readonly structureId: Pentatonic };
  readonly 'scale-one-string': { readonly root: string; readonly structureId: Scale; readonly string: StringId };
  readonly 'scale-position': { readonly root: string; readonly structureId: Scale; readonly degree: number };
  readonly 'arpeggio-1358': { readonly root: string; readonly structureId: Triad; readonly shapeId: CompactShape };
  readonly 'root-five-eight': { readonly root: string; readonly string: 'E' | 'A' };
  readonly 'groups-of-three': { readonly root: string; readonly structureId: Pentatonic; readonly shapeId: PentaShape };
  readonly thirds: { readonly root: string; readonly structureId: Scale; readonly shapeId: CompactShape };
  readonly 'form-transpose': { readonly structureId: Pentatonic; readonly shapeId: PentaShape; readonly roots: readonly string[] };
  readonly 'cycle-fourths': { readonly root: string; readonly count: number };
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
}
export interface ExercisePlan {
  readonly spec: ExerciseSpec;
  readonly title: string;
  readonly category: ExerciseCategory;
  readonly concepts: readonly ConceptId[];
  readonly segments: readonly { readonly label: string }[];
  readonly notes: readonly ExerciseNote[];
  /** Те же позиции в порядке плана — вход для createNotationPlan. */
  readonly positions: readonly AnnotatedPosition[];
}
export interface ExerciseTemplate<Id extends ExerciseTemplateId = ExerciseTemplateId> {
  readonly id: Id; readonly category: ExerciseCategory; readonly title: string;
  readonly concepts: readonly ConceptId[]; readonly defaults: ExerciseParams[Id];
}

const STRINGS: readonly StringId[] = ['E', 'A', 'D', 'G'];
const PENTA_SHAPES: readonly PentaShape[] = ['penta-a', 'penta-b', 'penta-c', 'penta-d', 'penta-e'];
const SHAPE_LETTER: Record<PentaShape, string> = { 'penta-a': 'A', 'penta-b': 'B', 'penta-c': 'C', 'penta-d': 'D', 'penta-e': 'E' };

export const EXERCISE_TEMPLATES: readonly ExerciseTemplate[] = deepFreeze([
  { id: 'chromatic-position', category: 'warmup', title: 'Хроматика 1-2-3-4 в позиции', concepts: ['finger-per-fret', 'semitone'], defaults: { startFret: 5 } },
  { id: 'position-shift', category: 'warmup', title: 'Смена позиции по струне', concepts: ['position-shift', 'finger-per-fret'], defaults: { string: 'A', startFret: 3, shifts: 2 } },
  { id: 'note-all-positions', category: 'notes', title: 'Одна нота по всему грифу', concepts: ['octave', 'unison'], defaults: { note: 'C' } },
  { id: 'octaves', category: 'notes', title: 'Октавы: +2 струны, +2 лада', concepts: ['octave'], defaults: { note: 'G' } },
  { id: 'pentatonic-form', category: 'forms', title: 'Форма пентатоники вверх-вниз', concepts: ['pentatonic', 'degrees'], defaults: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a' } },
  { id: 'pentatonic-relative', category: 'forms', title: 'Мажорная и минорная пентатоника: одни ноты — разные тоники', concepts: ['relative-keys', 'degrees', 'pentatonic'], defaults: { minorRoot: 'A', shapeId: 'penta-a' } },
  { id: 'scale-compact', category: 'forms', title: 'Гамма в одной позиции', concepts: ['scale-formula', 'degrees'], defaults: { root: 'C', structureId: 'major', shapeId: 'compact-e' } },
  { id: 'connect-forms', category: 'connections', title: 'Связка соседних форм', concepts: ['shared-notes', 'position-shift', 'pentatonic'], defaults: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a' } },
  { id: 'pentatonic-neck', category: 'connections', title: 'Пентатоника по всему грифу', concepts: ['form-system', 'shared-notes', 'pentatonic'], defaults: { root: 'A', structureId: 'minor-pentatonic' } },
  { id: 'scale-one-string', category: 'positions', title: 'Гамма на одной струне', concepts: ['scale-formula', 'semitone'], defaults: { root: 'C', structureId: 'major', string: 'A' } },
  { id: 'scale-position', category: 'positions', title: 'Гамма в позиции «палец на лад»', concepts: ['finger-per-fret', 'scale-formula', 'degrees'], defaults: { root: 'C', structureId: 'major', degree: 1 } },
  { id: 'arpeggio-1358', category: 'arpeggios', title: 'Арпеджио 1–3–5–8', concepts: ['triad', 'degrees'], defaults: { root: 'C', structureId: 'major-triad', shapeId: 'compact-e' } },
  { id: 'root-five-eight', category: 'arpeggios', title: 'Root–5–8', concepts: ['fifth', 'octave'], defaults: { root: 'C', string: 'A' } },
  { id: 'groups-of-three', category: 'sequences', title: 'Группы по три', concepts: ['sequence', 'pentatonic'], defaults: { root: 'A', structureId: 'minor-pentatonic', shapeId: 'penta-a' } },
  { id: 'thirds', category: 'sequences', title: 'Терциями по гамме', concepts: ['third', 'sequence'], defaults: { root: 'C', structureId: 'major', shapeId: 'compact-e' } },
  { id: 'form-transpose', category: 'transposition', title: 'Та же форма от другой тоники', concepts: ['transposition', 'pentatonic'], defaults: { structureId: 'minor-pentatonic', shapeId: 'penta-a', roots: ['A', 'D', 'E'] } },
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
  'note-all-positions': raw => ({ note: noteName(raw.note, 'Нота') }),
  octaves: raw => ({ note: noteName(raw.note, 'Нота') }),
  'pentatonic-form': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма') }),
  'pentatonic-relative': raw => ({ minorRoot: noteName(raw.minorRoot, 'Тоника минора'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма') }),
  'scale-compact': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'connect-forms': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма') }),
  'pentatonic-neck': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура') }),
  'scale-one-string': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура'), string: oneOf(raw.string, STRINGS, 'Струна') }),
  'scale-position': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура'), degree: integer(raw.degree, 1, 7, 'Ступень позиции') }),
  'arpeggio-1358': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major-triad', 'minor-triad'], 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'root-five-eight': raw => ({ root: noteName(raw.root, 'Тоника'), string: oneOf(raw.string, ['E', 'A'], 'Струна') }),
  'groups-of-three': raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма') }),
  thirds: raw => ({ root: noteName(raw.root, 'Тоника'), structureId: oneOf(raw.structureId, ['major', 'natural-minor'], 'Структура'), shapeId: oneOf(raw.shapeId, ['compact-e', 'compact-a'], 'Форма') }),
  'form-transpose': raw => {
    if (!Array.isArray(raw.roots) || raw.roots.length < 2 || raw.roots.length > 6) throw new RangeError('Тоники: нужен список из 2–6 нот.');
    return { structureId: oneOf(raw.structureId, ['minor-pentatonic', 'major-pentatonic'], 'Структура'), shapeId: oneOf(raw.shapeId, PENTA_SHAPES, 'Форма'), roots: raw.roots.map((root, index) => noteName(root, `Тоника ${index + 1}`)) };
  },
  'cycle-fourths': raw => ({ root: noteName(raw.root, 'Тоника'), count: integer(raw.count, 2, 12, 'Число тоник') }),
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

interface Draft { readonly position: AnnotatedPosition; readonly finger: number | null; readonly segment: number; readonly degree?: string | null; readonly stretch?: boolean }

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

type Built = { readonly drafts: readonly Draft[]; readonly segments: readonly string[]; readonly title?: string };

const BUILDERS: { readonly [Id in ExerciseTemplateId]: (params: ExerciseParams[Id]) => Built } = {
  'chromatic-position': ({ startFret }) => ({
    drafts: STRINGS.flatMap(string => [0, 1, 2, 3].map(offset => ({ position: chromatic(string, startFret + offset), finger: offset + 1, segment: 0, degree: null }))),
    segments: [`Позиция ${startFret} · пальцы 1-2-3-4`],
  }),
  'position-shift': ({ string, startFret, shifts }) => ({
    drafts: Array.from({ length: shifts + 1 }, (_, shift) => [0, 1, 2, 3].map(offset => ({ position: chromatic(string, startFret + shift + offset), finger: offset + 1, segment: shift, degree: null }))).flat(),
    segments: Array.from({ length: shifts + 1 }, (_, shift) => `Лады ${startFret + shift}–${startFret + shift + 3}`),
  }),
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
      segments: [`Позиция от ${structure.notes[degree - 1].name} (ступень ${structure.notes[degree - 1].degree.replace('b', '♭')}) · лады ${best.window}–${best.window + 3}${best.stretches ? ` · растяжек: ${best.stretches}` : ''}`],
    };
  },
  'arpeggio-1358': ({ root, structureId, shapeId }) => {
    const box = lowestBox(root, structureId, shapeId);
    return { drafts: fromBox(box, sequence(box, 'round-trip'), 0), segments: [`Лады ${box.window.fretMin}–${box.window.fretMax}`] };
  },
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
};

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
  const notes = built.drafts.map(({ position, finger, segment, degree, stretch }) => ({
    id: position.id, string: position.string, fret: position.fret, midi: position.midi,
    name: formatMidi(position.midi, position.noteName), degree: degree === undefined ? position.degree : degree, finger, stretch: stretch ?? false, segment,
  }));
  return deepFreeze({
    spec, title: built.title ?? template.title, category: template.category, concepts: template.concepts,
    segments: built.segments.map(label => ({ label })), notes, positions: built.drafts.map(draft => draft.position),
  });
}

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
