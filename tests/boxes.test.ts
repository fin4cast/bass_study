import { describe, expect, it } from 'vitest';
import { createBoxSelection, getBoxCatalogue, getBoxInstance, getBoxOverlap, validateBoxSelection, type BoxShapeId } from '../src/music/boxes';
import { createStructure, formatMidi, STRUCTURES } from '../src/music';
import { createSequence, startQuiz } from '../src/training';

const shapes: BoxShapeId[] = ['penta-a', 'penta-b', 'penta-c', 'penta-d', 'penta-e'];
const minor = (shapeId: BoxShapeId, anchorFret = 5) => getBoxInstance(createBoxSelection({ root: 'A', structureId: 'minor-pentatonic', anchorString: 'E', anchorFret, shapeId }));
const fixture = [
  ['E:5 E:8 A:5 A:7 D:5 D:7 G:5 G:7', 'A1 C2 D2 E2 G2 A2 C3 D3', '1 4 1 3 1 3 1 3'],
  ['E:8 E:10 A:7 A:10 D:7 D:10 G:7 G:9', 'C2 D2 E2 G2 A2 C3 D3 E3', '2 4 1 4 1 4 1 3'],
  ['E:10 E:12 A:10 A:12 D:10 D:12 G:9 G:12', 'D2 E2 G2 A2 C3 D3 E3 G3', '2 4 2 4 2 4 1 4'],
  ['E:12 E:15 A:12 A:15 D:12 D:14 G:12 G:14', 'E2 G2 A2 C3 D3 E3 G3 A3', '1 4 1 4 1 3 1 3'],
  ['E:15 E:17 A:15 A:17 D:14 D:17 G:14 G:17', 'G2 A2 C3 D3 E3 G3 A3 C4', '2 4 2 4 1 4 1 4'],
];
describe('пять связанных форм bass.study EADG', () => {
  it.each(shapes.map((shape, index) => [shape, index] as const))('%s: независимые позиции, звучание и пальцы', (shape, index) => {
    const box = minor(shape); const [ids, names, fingers] = fixture[index];
    expect(box.referencePositionIds).toEqual(ids.split(' '));
    expect(box.positions.map(position => formatMidi(position.midi, position.noteName))).toEqual(names.split(' '));
    expect(box.positions.map(position => box.fingers[position.id])).toEqual(fingers.split(' ').map(Number));
    expect(box.positions.every(position => position.inStructure)).toBe(true);
  });
  it('соседи пересекаются четырьмя физическими позициями, включая следующий период', () => {
    const expected = ['E:8 A:7 D:7 G:7', 'E:10 A:10 D:10 G:9', 'E:12 A:12 D:12 G:12', 'E:15 A:15 D:14 G:14', 'E:17 A:17 D:17 G:17'];
    const chain = [...shapes.map(shape => minor(shape)), minor('penta-a', 17)];
    for (let index = 0; index < 5; index++) expect(getBoxOverlap(chain[index], chain[index + 1])).toEqual(expected[index].split(' '));
  });
  it('связанные цепочки обеих пентатоник имеют четыре общие позиции во всех12тониках', () => {
    const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const anchors = { 'minor-pentatonic': [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7], 'major-pentatonic': [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4] } as const;
    for (const structureId of ['minor-pentatonic', 'major-pentatonic'] as const) roots.forEach((root, index) => {
      const chain = shapes.map(shapeId => getBoxInstance(createBoxSelection({ root, structureId, shapeId, anchorString: 'E', anchorFret: anchors[structureId][index] })));
      for (let pair = 0; pair < 4; pair++) {
        const overlap = getBoxOverlap(chain[pair], chain[pair + 1]);
        expect(overlap).toHaveLength(4); expect(overlap.map(id => id[0])).toEqual(['E', 'A', 'D', 'G']);
      }
    });
  });
  it('C major/A minor имеют одинаковую геометрию и разные тоники/ступени', () => {
    const expectedRoots = ['E:8 G:5', 'E:8 D:10', 'D:10', 'A:15', 'A:15 G:17'];
    shapes.forEach((shapeId, index) => {
      const box = getBoxInstance(createBoxSelection({ root: 'C', structureId: 'major-pentatonic', anchorString: 'E', anchorFret: 5, shapeId }));
      expect(box.referencePositionIds).toEqual(minor(shapeId).referencePositionIds);
      expect(box.positions.filter(position => position.isRoot).map(position => position.id)).toEqual(expectedRoots[index].split(' '));
    });
  });
  it('каталог включает целые ранние и +12 экземпляры без обрезки', () => {
    const catalogue = getBoxCatalogue('A', 'minor-pentatonic');
    expect(catalogue.some(box => box.selection.shapeId === 'penta-e' && box.selection.anchorFret === -7 && box.window.fretMin === 2)).toBe(true);
    expect(catalogue.some(box => box.selection.shapeId === 'penta-a' && box.selection.anchorFret === 17)).toBe(true);
    expect(catalogue.every(box => box.positions.length === 8 && box.window.fretMin >= 1 && box.window.fretMax <= 24)).toBe(true);
  });
  it('отклоняет подмену якоря, несовместимую структуру, лишние поля и усечённый край', () => {
    const good = minor('penta-a').selection;
    for (const changed of [{ anchorFret: 6 }, { anchorFret: 29 }, { anchorString: 'A' }, { structureId: 'major' }, { unexpected: true }]) expect(() => validateBoxSelection({ ...good, ...changed })).toThrow();
    expect(Object.isFrozen(good)).toBe(true);
  });
});
describe('компактные формы и точная область заданий', () => {
  it.each([
    ['major', 'compact-e', 'E', 8, 'E:8 E:10 A:7 A:8 A:10 D:7 D:9 D:10', 'C2 D2 E2 F2 G2 A2 B2 C3'],
    ['major', 'compact-a', 'A', 3, 'A:3 A:5 D:2 D:3 D:5 G:2 G:4 G:5', 'C2 D2 E2 F2 G2 A2 B2 C3'],
    ['major-triad', 'compact-e', 'E', 8, 'E:8 A:7 A:10 D:10', 'C2 E2 G2 C3'],
    ['minor-triad', 'compact-e', 'E', 8, 'E:8 E:11 A:10 D:10', 'C2 E♭2 G2 C3'],
    ['natural-minor', 'compact-e', 'E', 8, 'E:8 E:10 E:11 A:8 A:10 A:11 D:8 D:10', 'C2 D2 E♭2 F2 G2 A♭2 B♭2 C3'],
  ] as const)('%s %s: буквальный октавный эталон', (structureId, shapeId, anchorString, anchorFret, ids, notes) => {
    const box = getBoxInstance(createBoxSelection({ root: 'C', structureId, shapeId, anchorString, anchorFret }));
    expect(box.referencePositionIds).toEqual(ids.split(' '));
    expect(box.positions.map(position => formatMidi(position.midi, position.noteName))).toEqual(notes.split(' '));
    if (structureId === 'major') expect(box.positions.map(position => position.midi)).toEqual([36, 38, 40, 41, 43, 45, 47, 48]);
    expect(box.label).toBe(`Тоника C · лад ${anchorFret}`);
  });
  it('triad-6-v1 даёт ровно два C/E/G и разрешает обе C только внутри формы', () => {
    const box = getBoxCatalogue('C', 'major-triad').find(box => box.selection.anchorString === 'E' && box.selection.anchorFret === 8)!;
    const config = { positions: box.positions, structure: createStructure('C', 'major-triad'), box: box.selection, mode: 'find-note' as const, seed: 12345, questionPolicy: 'triad-6-v1' as const };
    const session = startQuiz(config, 6);
    expect(session.questions.map(question => question.target.name).sort()).toEqual(['C', 'C', 'E', 'E', 'G', 'G']);
    expect(session.questions.filter(question => question.target.name === 'C').every(question => question.expectedPositionIds.join(',') === 'E:8,D:10')).toBe(true);
    expect(session).toEqual(startQuiz(config, 6));
    expect(() => startQuiz(config, 5)).toThrow();
    expect(createSequence({ ...config, pattern: 'ascending' }).notes.map(note => note.id)).toEqual(['E:8', 'A:7', 'A:10', 'D:10']);
  });
  it('12 тоник × 6 структур: целые формы, квинта/терция над нижней тоникой, допустимые пальцы', () => {
    for (const root of ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']) for (const structure of STRUCTURES) {
      const boxes = getBoxCatalogue(root, structure.id);
      expect(boxes.length).toBeGreaterThanOrEqual(structure.id.endsWith('pentatonic') ? 5 : 2);
      for (const box of boxes) {
        const reference = box.positions.filter(position => position.isRoot).sort((a, b) => a.midi - b.midi)[0].midi;
        const third = structure.id.startsWith('minor') || structure.id === 'natural-minor' ? 3 : 4;
        expect(box.positions.some(position => position.midi === reference + third)).toBe(true);
        expect(box.positions.some(position => position.midi === reference + 7)).toBe(true);
        expect(Object.values(box.fingers).every(finger => Number.isInteger(finger) && finger >= 1 && finger <= 4)).toBe(true);
      }
    }
  });
  it('shape-6-v1 не повторяет первые классы и не обещает вместить семь классов в шесть вопросов', () => {
    const box = getBoxCatalogue('C', 'major').find(box => box.selection.anchorString === 'E' && box.selection.anchorFret === 8)!;
    const session = startQuiz({ positions: box.positions, structure: createStructure('C', 'major'), box: box.selection, mode: 'find-note', seed: 91, questionPolicy: 'shape-6-v1' }, 6);
    expect(new Set(session.questions.map(question => question.target.pitchClass)).size).toBe(6);
    expect(session.questions.every(question => question.expectedPositionIds.every(id => box.referencePositionIds.includes(id)))).toBe(true);
  });
});
