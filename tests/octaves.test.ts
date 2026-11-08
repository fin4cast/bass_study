import { describe, expect, it } from 'vitest';
import { annotatePositions, createStructure, getPosition, type AnnotatedPosition, type StructureId } from '../src/music';
import { createBoxSelection, getBoxInstance } from '../src/music/boxes';
import { getOctaveSections } from '../src/music/octaves';

const box = (root: string, structureId: StructureId, shapeId: 'penta-a' | 'penta-e' | 'compact-e', anchorFret: number) => getBoxInstance(createBoxSelection({ root, structureId, shapeId, anchorFret, anchorString: 'E' }));
const heights = (positions: readonly AnnotatedPosition[]) => [...new Set(positions.map(position => position.midi))].sort((a, b) => a - b);

describe('октавные участки по звучащей высоте', () => {
  it('A minor pentatonic A: одна полная октава и фрагмент с общей A2', () => {
    const form = box('A', 'minor-pentatonic', 'penta-a', 5);
    const groups = getOctaveSections(form.positions, form.positions, createStructure('A', 'minor-pentatonic'));
    expect(groups.map(group => [group.fromMidi, group.toMidi, group.completeVisible])).toEqual([[33, 45, true], [45, 57, false]]);
    expect(groups.map(group => heights(group.positions))).toEqual([[33, 36, 38, 40, 43, 45], [45, 48, 50]]);
    expect(groups[0].positions.find(position => position.midi === 45)?.id).toBe('D:7');
    expect(groups[1].positions.find(position => position.midi === 45)?.id).toBe('D:7');
  });

  it('C major pentatonic на той же геометрии сохраняет ведущий фрагмент до C2', () => {
    const form = box('C', 'major-pentatonic', 'penta-a', 5);
    const groups = getOctaveSections(form.positions, form.positions, createStructure('C', 'major-pentatonic'));
    expect(groups.map(group => [group.fromMidi, group.startsAtTonic, group.completeVisible])).toEqual([[24, false, false], [36, true, true], [48, true, false]]);
    expect(heights(groups[0].positions)).toEqual([33, 36]);
    expect(heights(groups[1].positions)).toEqual([36, 38, 40, 43, 45, 48]);
  });

  it('четырёх нот достаточно для полного участка трезвучия, но не гаммы', () => {
    const form = box('C', 'major-triad', 'compact-e', 8);
    expect(heights(form.positions)).toEqual([36, 40, 43, 48]);
    expect(getOctaveSections(form.positions, form.positions, createStructure('C', 'major-triad'))[0].completeVisible).toBe(true);
    const major = annotatePositions(form.positions, createStructure('C', 'major'));
    expect(getOctaveSections(major, major, createStructure('C', 'major'))[0].completeVisible).toBe(false);
  });

  it('полная гамма требует верхней тоники, а не просто семи ступеней', () => {
    const form = box('C', 'major', 'compact-e', 8);
    const withoutUpperTonic = form.positions.filter(position => position.midi !== 48);
    const groups = getOctaveSections(withoutUpperTonic, withoutUpperTonic, createStructure('C', 'major'));
    expect(heights(withoutUpperTonic)).toEqual([36, 38, 40, 41, 43, 45, 47]);
    expect(groups).toHaveLength(1);
    expect(groups[0].completeVisible).toBe(false);
  });

  it('дубли одной высоты сохраняют позиции, но не заменяют отсутствующую ступень', () => {
    const structure = createStructure('C', 'major');
    const form = box('C', 'major', 'compact-e', 8);
    const withoutF = form.positions.filter(position => position.midi !== 41);
    const source = [...withoutF, ...annotatePositions([getPosition('G', 0)], structure)]; // G2, already present at A/10.
    const groups = getOctaveSections(source, source, structure);
    expect(groups[0].positions.filter(position => position.midi === 43).map(position => position.id)).toEqual(['A:10', 'G:0']);
    expect(groups[0].positions).toHaveLength(8);
    expect(groups[0].completeVisible).toBe(false);
  });

  it('потеря позиции в области показа не объявляет усечённый участок полным', () => {
    const form = box('C', 'major', 'compact-e', 8);
    const visible = form.positions.filter(position => position.string !== 'D');
    const groups = getOctaveSections(form.positions, visible, createStructure('C', 'major'));
    expect(groups[0].completeMaterial).toBe(true);
    expect(groups[0].completeVisible).toBe(false);
    expect(groups[0].partiallyShown).toBe(true);
  });

  it('одна граничная тоника после обрезки не создаёт дополнительную группу', () => {
    const form = box('C', 'major-pentatonic', 'penta-e', -7);
    const visible = form.positions.filter(position => position.fret === 3);
    expect(heights(visible)).toEqual([31, 36]);
    const groups = getOctaveSections(form.positions, visible, createStructure('C', 'major-pentatonic'));
    expect(groups).toHaveLength(1);
    expect(groups[0].fromMidi).toBe(24);
    expect(groups[0].completeVisible).toBe(false);
  });

  it('пустые области и единственная тоника не образуют октав', () => {
    const structure = createStructure('A', 'minor-pentatonic');
    const tonic = annotatePositions([getPosition('E', 5)], structure);
    expect(getOctaveSections([], tonic, structure)).toEqual([]);
    expect(getOctaveSections(tonic, [], structure)).toEqual([]);
    expect(getOctaveSections(tonic, tonic, structure)).toEqual([]);
  });
});
