/**
 * Reference build entry for VIS-10/VIS-11 r1.
 * Uses the product's pure musical rules; the two helpers below exist only in the reference
 * and are candidates for R-026, not product behaviour.
 */
import { annotatePositions, createStructure, formatMidi, getPositions, type AnnotatedPosition, type StringId } from '../../../src/music/index';
import { getBoxCatalogue, getBoxOverlap, type BoxInstance } from '../../../src/music/boxes';
import { createSequence } from '../../../src/training/index';
import { createNotationPlan } from '../../../src/notation/index';

export { formatMidi, createStructure, getBoxCatalogue, getBoxOverlap, createNotationPlan };

const ALL_STRINGS: StringId[] = ['E', 'A', 'D', 'G'];
const FINGER_BY_OFFSET = [1, 2, 3, 4];

function neck(root: string, structureId: Parameters<typeof createStructure>[1]) {
  const structure = createStructure(root, structureId);
  return { structure, positions: annotatePositions(getPositions({ strings: ALL_STRINGS, fretMin: 0, fretMax: 24 }), structure) };
}

function findBox(catalogue: readonly BoxInstance[], fretMin: number, fretMax: number) {
  const found = catalogue.find(box => box.window.fretMin === fretMin && box.window.fretMax === fretMax);
  if (!found) throw new Error(`Форма с окном ${fretMin}–${fretMax} не найдена.`);
  return found;
}

/** Reference helper: up through the first form, then from the top of the second form down. */
export function connectBoxes(first: BoxInstance, second: BoxInstance) {
  const { structure, positions } = neck(first.selection.root, first.selection.structureId);
  const up = createSequence({ box: first.selection, positions, structure, pattern: 'ascending' }).notes;
  const down = createSequence({ box: second.selection, positions, structure, pattern: 'descending' }).notes;
  return { notes: [...up, ...down], shared: getBoxOverlap(first, second), split: up.length };
}

/** Reference helper: chromatic 1-2-3-4 in one position across the strings E→G. */
export function chromaticPosition(startFret: number, root: string) {
  const structure = createStructure(root, 'natural-minor');
  const notes = annotatePositions(getPositions({ strings: ALL_STRINGS, fretMin: startFret, fretMax: startFret + 3 }), structure);
  return { notes, fingers: notes.map(position => FINGER_BY_OFFSET[position.fret - startFret]) };
}

const describe = (notes: readonly AnnotatedPosition[]) => notes.map(position => ({
  id: position.id, string: position.string, fret: position.fret, midi: position.midi,
  name: formatMidi(position.midi, position.noteName ?? position.naturalName), degree: position.degree,
}));

export function buildLessonMaterial() {
  const penta = getBoxCatalogue('A', 'minor-pentatonic');
  const formA = findBox(penta, 5, 8);
  const formB = findBox(penta, 7, 10);
  const ex1 = connectBoxes(formA, formB);

  const triads = getBoxCatalogue('C', 'major-triad');
  const arpeggioBox = triads.find(box => box.selection.anchorString === 'E' && box.selection.anchorFret === 8);
  if (!arpeggioBox) throw new Error('Компактная форма C от E/8 не найдена.');
  const triadNeck = neck('C', 'major-triad');
  const ex2 = createSequence({ box: arpeggioBox.selection, ...triadNeck, pattern: 'round-trip' }).notes;

  const ex3 = chromaticPosition(5, 'A');

  return {
    ex1: {
      title: 'Связка форм A→B · пентатоника Am',
      formA: { label: formA.label, window: formA.window, ids: formA.positions.map(p => p.id), fingers: formA.fingers },
      formB: { label: formB.label, window: formB.window, ids: formB.positions.map(p => p.id), fingers: formB.fingers },
      shared: ex1.shared, split: ex1.split,
      notes: describe(ex1.notes),
      notation: createNotationPlan({ positions: ex1.notes, duration: 'eighth' }),
    },
    ex2: {
      title: 'Арпеджио 1–3–5–8 · C-мажор от E/8',
      notes: describe(ex2), fingers: arpeggioBox.fingers,
      notation: createNotationPlan({ positions: ex2, duration: 'quarter' }),
    },
    ex3: {
      title: 'Хроматика 1-2-3-4 · позиция V',
      notes: describe(ex3.notes), fingers: ex3.fingers,
      notation: createNotationPlan({ positions: ex3.notes, duration: 'eighth' }),
    },
  };
}
