import { annotatePositions, createStructure, getPosition, parseNote, type AnnotatedPosition, type StringId, type StructureId } from './index';

export type BoxShapeId = 'penta-a' | 'penta-b' | 'penta-c' | 'penta-d' | 'penta-e' | 'compact-e' | 'compact-a';
export interface BoxSelection {
  readonly version: 'boxes-v1'; readonly shapeId: BoxShapeId; readonly root: string;
  readonly structureId: StructureId; readonly anchorFret: number; readonly anchorString: 'E' | 'A';
}
export interface BoxInstance {
  readonly selection: BoxSelection; readonly positions: readonly AnnotatedPosition[];
  readonly fingers: Readonly<Record<string, number>>; readonly referencePositionIds: readonly string[];
  readonly window: { readonly fretMin: number; readonly fretMax: number }; readonly label: string;
}
const STRINGS: readonly StringId[] = ['E', 'A', 'D', 'G'];
const PENTA = {
  'penta-a': { window: [0, 3], frets: [[0, 3], [0, 2], [0, 2], [0, 2]] },
  'penta-b': { window: [2, 5], frets: [[3, 5], [2, 5], [2, 5], [2, 4]] },
  'penta-c': { window: [4, 7], frets: [[5, 7], [5, 7], [5, 7], [4, 7]] },
  'penta-d': { window: [7, 10], frets: [[7, 10], [7, 10], [7, 9], [7, 9]] },
  'penta-e': { window: [9, 12], frets: [[10, 12], [10, 12], [9, 12], [9, 12]] },
} as const;
type CompactNote = readonly [number, number, number]; // string offset, fret offset, suggested finger
const COMPACT: Readonly<Record<string, readonly CompactNote[]>> = {
  major: [[0, 0, 2], [0, 2, 4], [1, -1, 1], [1, 0, 2], [1, 2, 4], [2, -1, 1], [2, 1, 3], [2, 2, 4]],
  'natural-minor': [[0, 0, 1], [0, 2, 3], [0, 3, 4], [1, 0, 1], [1, 2, 3], [1, 3, 4], [2, 0, 1], [2, 2, 3]],
  'major-triad': [[0, 0, 2], [1, -1, 1], [1, 2, 4], [2, 2, 4]],
  'minor-triad': [[0, 0, 1], [0, 3, 4], [1, 2, 3], [2, 2, 3]],
};
const mod = (value: number) => (value % 12 + 12) % 12;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function instance(selection: BoxSelection): BoxInstance {
  const structure = createStructure(selection.root, selection.structureId);
  const pentatonic = selection.structureId.endsWith('pentatonic');
  const fingers: Record<string, number> = {};
  let positions: readonly AnnotatedPosition[]; let fretMin: number; let fretMax: number;
  if (pentatonic) {
    if (!(selection.shapeId in PENTA) || selection.anchorString !== 'E') throw new RangeError('Пентатонике нужна одна из пяти форм EADG.');
    const minorRoot = mod(structure.rootPitchClass + (selection.structureId === 'major-pentatonic' ? 9 : 0));
    if (mod(4 + selection.anchorFret) !== minorRoot) throw new RangeError('Якорь цепочки не соответствует выбранной пентатонике.');
    const shape = PENTA[selection.shapeId as keyof typeof PENTA];
    fretMin = selection.anchorFret + shape.window[0]; fretMax = selection.anchorFret + shape.window[1];
    if (fretMin < 1 || fretMax > 24) throw new RangeError('Полная закрытая форма должна помещаться на ладах 1–24.');
    positions = annotatePositions(shape.frets.flatMap((frets, row) => frets.map(offset => getPosition(STRINGS[row], selection.anchorFret + offset))), structure);
    positions.forEach(position => { fingers[position.id] = position.fret - fretMin + 1; });
  } else {
    const shape = COMPACT[selection.structureId];
    if (!shape || selection.shapeId !== `compact-${selection.anchorString.toLowerCase()}`) throw new RangeError('Для структуры нужна компактная форма с тоникой на E или A.');
    if (getPosition(selection.anchorString, selection.anchorFret).pitchClass !== structure.rootPitchClass) throw new RangeError('Начальная позиция формы должна быть тоникой.');
    const firstString = STRINGS.indexOf(selection.anchorString);
    const offsets = shape.map(note => note[1]);
    fretMin = selection.anchorFret + Math.min(...offsets); fretMax = selection.anchorFret + Math.max(...offsets);
    if (fretMin < 1 || fretMax > 24) throw new RangeError('Полная закрытая форма должна помещаться на ладах 1–24.');
    positions = annotatePositions(shape.map(([row, offset, finger]) => {
      const position = getPosition(STRINGS[firstString + row], selection.anchorFret + offset); fingers[position.id] = finger; return position;
    }), structure);
  }
  if (positions.some(position => !position.inStructure)) throw new RangeError('Форма содержит ноту вне выбранной структуры.');
  const first = positions[0];
  const label = pentatonic ? `Начальная нота ${first.noteName} · ступень ${first.degree?.replace('b', '♭')} · лад ${first.fret}`
    : `Тоника ${structure.root} · лад ${selection.anchorFret}`;
  return freeze({ selection, positions, fingers, referencePositionIds: positions.map(position => position.id), window: { fretMin, fretMax }, label });
}
export function validateBoxSelection(value: unknown): BoxSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('Нужен сохранённый контекст формы.');
  const raw = value as Record<string, unknown>;
  const keys = ['version', 'shapeId', 'root', 'structureId', 'anchorFret', 'anchorString'];
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(raw).length !== keys.length || Object.values(Object.getOwnPropertyDescriptors(raw)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new RangeError('Описание формы должно содержать только обычные JSON-поля.');
  if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key)) || raw.version !== 'boxes-v1'
    || typeof raw.root !== 'string' || typeof raw.structureId !== 'string' || typeof raw.shapeId !== 'string'
    || (raw.anchorString !== 'E' && raw.anchorString !== 'A') || !Number.isInteger(raw.anchorFret) || Number(raw.anchorFret) < -11 || Number(raw.anchorFret) > 24) throw new RangeError('Некорректное описание учебной формы.');
  const selection: BoxSelection = { version: 'boxes-v1', shapeId: raw.shapeId as BoxShapeId, root: parseNote(raw.root).name, structureId: raw.structureId as StructureId, anchorFret: Number(raw.anchorFret), anchorString: raw.anchorString };
  instance(selection);
  return freeze(selection);
}
export function createBoxSelection(input: Omit<BoxSelection, 'version'>): BoxSelection { return validateBoxSelection({ ...input, version: 'boxes-v1' }); }
export function getBoxInstance(selection: BoxSelection): BoxInstance { return instance(validateBoxSelection(selection)); }
/** All complete closed instances, including +12 copies; no silently clipped forms. */
export function getBoxCatalogue(root: string, structureId: StructureId): readonly BoxInstance[] {
  const structure = createStructure(root, structureId); const pentatonic = structureId.endsWith('pentatonic');
  const shapes = pentatonic ? Object.keys(PENTA) as BoxShapeId[] : ['compact-e', 'compact-a'] as const;
  const result: BoxInstance[] = [];
  for (const shapeId of shapes) for (let anchorFret = pentatonic ? -11 : 1; anchorFret <= 24; anchorFret++) {
    const anchorString = shapeId === 'compact-a' ? 'A' : 'E';
    try { result.push(getBoxInstance({ version: 'boxes-v1', shapeId, root: structure.root, structureId, anchorFret, anchorString })); }
    catch { /* This physical instance is not complete or does not match the tonic. */ }
  }
  return freeze(result.sort((a, b) => a.window.fretMin - b.window.fretMin || a.selection.shapeId.localeCompare(b.selection.shapeId)));
}
export function getBoxOverlap(first: BoxInstance, second: BoxInstance): readonly string[] {
  const other = new Set(second.referencePositionIds); return Object.freeze(first.referencePositionIds.filter(id => other.has(id)));
}
