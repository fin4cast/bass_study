import { describe, expect, it } from 'vitest';
import { annotatePositions, createStructure, getPosition, getPositions, type AnnotatedPosition } from '../src/music';
import { createNotationPlan, type NotationDuration } from '../src/notation';

const cMajor = createStructure('C', 'major');
const annotated = (...positions: ReturnType<typeof getPosition>[]) => annotatePositions(positions, cMajor);
function spelled(string: 'E' | 'A' | 'D' | 'G', fret: number, noteName: string): AnnotatedPosition {
  return { ...annotated(getPosition(string, fret))[0], noteName };
}

describe('написанная и звучащая высота баса', () => {
  it('открытая E1 звучит MIDI28 и записывается E2 с одной добавочной линией', () => {
    const plan = createNotationPlan({ positions: annotated(getPosition('E', 0)), duration: 'quarter' });
    expect(plan).toMatchObject({ clef: 'bass', meter: '4/4', transpositionSemitones: 12, bars: 1, totalBeats: 1 });
    expect(plan.events[0]).toMatchObject({ soundingMidi: 28, writtenMidi: 40, spelling: 'E', writtenName: 'E2', writtenOctave: 2, staffStep: -2, ledgerSteps: [-2], tab: { row: 3, string: 'E', fret: 0 } });
  });

  it('E5/A0 имеют одну написанную A2, но сохраняют разные позиции таба', () => {
    const events = createNotationPlan({ positions: annotated(getPosition('E', 5), getPosition('A', 0)), duration: 'quarter' }).events;
    expect(events.map(event => [event.soundingMidi, event.writtenMidi, event.writtenName, event.staffStep])).toEqual([[33, 45, 'A2', 1], [33, 45, 'A2', 1]]);
    expect(events.map(event => event.tab)).toEqual([{ row: 3, string: 'E', fret: 5 }, { row: 2, string: 'A', fret: 0 }]);
    expect(events[0].id).not.toBe(events[1].id);
  });

  it('B♯1→B♯2 и C♭2→C♭3 не канонизируются в C/B', () => {
    const bSharp = annotatePositions([getPosition('A', 3)], createStructure('C#', 'major'));
    const cFlat = annotatePositions([getPosition('E', 7)], createStructure('Gb', 'major'));
    const events = createNotationPlan({ positions: [...bSharp, ...cFlat], duration: 'quarter' }).events;
    expect(events[0]).toMatchObject({ soundingMidi: 36, writtenMidi: 48, spelling: 'B♯', writtenName: 'B♯2', writtenOctave: 2, staffStep: 2, accidental: 1 });
    expect(events[1]).toMatchObject({ soundingMidi: 35, writtenMidi: 47, spelling: 'C♭', writtenName: 'C♭3', writtenOctave: 3, staffStep: 3, accidental: -1 });
  });

  it('буква определяет место на стане, знак меняет высоту без движения головки', () => {
    const events = createNotationPlan({ positions: [spelled('D', 3, 'E#'), spelled('D', 2, 'E'), spelled('D', 1, 'Eb')], duration: 'quarter' }).events;
    expect(events.map(event => event.writtenName)).toEqual(['E♯3', 'E3', 'E♭3']);
    expect(events.map(event => event.staffStep)).toEqual([5, 5, 5]);
    expect(events.map(event => event.accidentalDisplay)).toEqual(['♯', '♮', '♭']);
  });

  it('верхняя линия A3 и добавочные линии определены независимыми примерами', () => {
    const events = createNotationPlan({ positions: [spelled('G', 2, 'A'), spelled('G', 5, 'C'), spelled('G', 7, 'D')], duration: 'quarter' }).events;
    expect(events.map(event => [event.writtenName, event.staffStep, event.ledgerSteps])).toEqual([['A3', 8, []], ['C4', 10, [10]], ['D4', 11, [10]]]);
  });

  it('весь диапазон0–24 включает G4→G5 с нужными верхними добавочными линиями', () => {
    const positions = annotatePositions(getPositions({ strings: ['E', 'A', 'D', 'G'], fretMin: 0, fretMax: 24 }), cMajor);
    const plan = createNotationPlan({ positions, duration: 'sixteenth' });
    expect(plan.events).toHaveLength(100);
    expect(plan.events[0].writtenName).toBe('E2');
    expect(plan.events.at(-1)).toMatchObject({ soundingMidi: 67, writtenMidi: 79, writtenName: 'G5', staffStep: 21, ledgerSteps: [10, 12, 14, 16, 18, 20], tab: { row: 0, string: 'G', fret: 24 } });
    expect(plan.events.every(event => event.writtenMidi - event.soundingMidi === 12)).toBe(true);
  });
});

describe('ритм, такты, знаки и неизменяемость', () => {
  it.each([['quarter', 1, 0, 4], ['eighth', 0.5, 1, 8], ['sixteenth', 0.25, 2, 16]] as const)('%s имеет собственную длительность и границу такта', (duration, beats, flags, notesPerBar) => {
    const positions = Array.from({ length: notesPerBar + 1 }, () => annotated(getPosition('E', 0))[0]);
    const plan = createNotationPlan({ positions, duration });
    expect(plan.events[1]).toMatchObject({ beat: beats, beatInBar: beats, bar: 0, durationBeats: beats, flagCount: flags });
    expect(plan.events[notesPerBar]).toMatchObject({ beat: 4, beatInBar: 0, bar: 1 });
    expect(plan.totalBeats).toBe(4 + beats);
    expect(plan.bars).toBe(2);
    expect(new Set(plan.events.map(event => event.id)).size).toBe(notesPerBar + 1);
  });

  it('знаки действуют на букву/октаву до конца такта; следующий такт повторяет знак', () => {
    const positions = [spelled('A', 4, 'C#'), spelled('A', 4, 'C#'), spelled('A', 3, 'C'), spelled('A', 3, 'C'), spelled('A', 4, 'C#')];
    expect(createNotationPlan({ positions, duration: 'quarter' }).events.map(event => event.accidentalDisplay)).toEqual(['♯', '', '♮', '', '♯']);
  });

  it('знак другой октавы и двойной знак не теряют контекстную букву', () => {
    const positions = [spelled('A', 4, 'C#'), spelled('G', 6, 'C#'), spelled('A', 5, 'C##')];
    const events = createNotationPlan({ positions, duration: 'quarter' }).events;
    expect(events.map(event => event.accidentalDisplay)).toEqual(['♯', '♯', '♯♯']);
    expect(events.map(event => event.writtenName)).toEqual(['C♯3', 'C♯4', 'C♯♯3']);
  });

  it('пустой маршрут имеет честный пустой план без вымышленного такта', () => {
    expect(createNotationPlan({ positions: [], duration: 'quarter' })).toMatchObject({ events: [], totalBeats: 0, bars: 0 });
  });

  it('не изменяет и не замораживает вход, но сохраняет результат immutable', () => {
    const positions = [{ ...annotated(getPosition('E', 0))[0] }];
    const before = JSON.stringify(positions);
    const plan = createNotationPlan({ positions, duration: 'quarter' });
    expect(JSON.stringify(positions)).toBe(before);
    expect(Object.isFrozen(positions[0])).toBe(false);
    expect(Object.isFrozen(plan.events[0].tab)).toBe(true);
    expect(Object.isFrozen(plan.events[0].ledgerSteps)).toBe(true);
  });

  it('отвергает несовместимые высоту/написание, строй, лад и длительность', () => {
    expect(() => createNotationPlan({ positions: [spelled('E', 0, 'F')], duration: 'quarter' })).toThrow(/написание/);
    expect(() => createNotationPlan({ positions: [{ ...spelled('E', 0, 'E'), midi: 40 }], duration: 'quarter' })).toThrow(/строю/);
    expect(() => createNotationPlan({ positions: [{ ...spelled('E', 0, 'E'), fret: 25 }], duration: 'quarter' })).toThrow();
    expect(() => createNotationPlan({ positions: [], duration: 'half' as NotationDuration })).toThrow(/четверти/);
  });
});
