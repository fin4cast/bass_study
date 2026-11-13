import { describe, expect, it } from 'vitest';
import {
  BASS_STRINGS, STRUCTURES, annotatePositions, createStructure, formatMidi,
  getPosition, getPositions, midiToFrequency, parseNote, pitchClass,
  type StructureId, type StringId,
} from '../src/music';

const names = (root: string, structure: StructureId) => createStructure(root, structure).notes.map(note => note.name);

describe('строй, абсолютная высота и позиции', () => {
  it('использует звучащий строй E1–A1–D2–G2 и реальные номера струн', () => {
    expect(BASS_STRINGS.map(string => [string.id, string.number, string.openMidi])).toEqual([
      ['E', 4, 28], ['A', 3, 33], ['D', 2, 38], ['G', 1, 43],
    ]);
    expect(BASS_STRINGS.map(string => formatMidi(getPosition(string.id, 0).midi))).toEqual(['E1', 'A1', 'D2', 'G2']);
  });

  it('различает одну высоту на разных струнах и одинаковое имя в разных октавах', () => {
    const e5 = getPosition('E', 5);
    const a0 = getPosition('A', 0);
    const a12 = getPosition('A', 12);
    expect(e5.midi).toBe(33);
    expect(a0.midi).toBe(33);
    expect(e5.id).not.toBe(a0.id);
    expect(a12.midi).toBe(45);
    expect(a12.pitchClass).toBe(a0.pitchClass);
    expect(getPosition('E', 0).midi).toBe(28);
    expect(getPosition('E', 12).midi).toBe(40);
    expect(getPosition('G', 24).midi).toBe(67);
  });

  it('вычисляет эталонные частоты при A4 = 440 Гц', () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(57)).toBe(220);
    expect(getPosition('E', 0).frequency).toBeCloseTo(41.2034446, 6);
    expect(getPosition('A', 0).frequency).toBeCloseTo(55, 8);
  });

  it.each([
    [0, 0], [28, 4], [33, 9], [60, 0], [127, 7],
  ])('класс MIDI %i равен %i', (midi, expected) => {
    expect(pitchClass(midi)).toBe(expected);
  });

  it.each([
    [28, undefined, 'E1'], [60, undefined, 'C4'], [0, undefined, 'C-1'], [127, undefined, 'G9'],
    [36, 'B#', 'B♯1'], [59, 'Cb', 'C♭4'], [65, 'E#', 'E♯4'],
  ])('научная запись MIDI %i учитывает написание %s', (midi, spelling, expected) => {
    expect(formatMidi(midi, spelling)).toBe(expected);
  });

  it('отклоняет неправильную высоту, струну, лад и несовпадающее написание', () => {
    for (const value of [-1, 128, 33.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pitchClass(value)).toThrow();
      expect(() => midiToFrequency(value)).toThrow();
      expect(() => formatMidi(value)).toThrow();
    }
    for (const fret of [-1, 25, 0.5, Number.NaN]) expect(() => getPosition('E', fret)).toThrow();
    expect(() => getPosition('B' as StringId, 0)).toThrow();
    expect(() => formatMidi(36, 'B')).toThrow(/не соответствует/);
  });
});

describe('музыкальное написание', () => {
  it.each([
    ['C', 'C', 0, 0], ['db', 'D♭', 1, -1], ['F#', 'F♯', 6, 1],
    ['E♭', 'E♭', 3, -1], ['B#', 'B♯', 0, 1], ['Cb', 'C♭', 11, -1],
    ['Cbb', 'C♭♭', 10, -2], ['F##', 'F♯♯', 7, 2], ['F𝄪', 'F♯♯', 7, 2],
    ['B𝄫', 'B♭♭', 9, -2], ['Fx', 'F♯♯', 7, 2], ['G♮', 'G', 7, 0],
  ])('читает %s как %s', (input, name, expectedClass, accidental) => {
    expect(parseNote(input)).toMatchObject({ name, pitchClass: expectedClass, accidental });
  });

  it.each(['', 'H', 'C4', 'A-1', 'C#b', 'D #', 'D♮#'])('отклоняет неподдерживаемое имя %s', value => {
    expect(() => parseNote(value)).toThrow();
  });
});

describe('структуры', () => {
  it('содержит только заданный набор структур', () => {
    expect(STRUCTURES.map(item => item.id)).toEqual([
      'major', 'natural-minor', 'major-pentatonic', 'minor-pentatonic', 'major-triad', 'minor-triad',
      'diminished-triad', 'major-seventh', 'dominant-seventh', 'minor-seventh', 'half-diminished-seventh', 'blues',
    ]);
  });

  it.each([
    ['major', ['C', 'D', 'E', 'F', 'G', 'A', 'B'], ['1', '2', '3', '4', '5', '6', '7']],
    ['natural-minor', ['C', 'D', 'E♭', 'F', 'G', 'A♭', 'B♭'], ['1', '2', 'b3', '4', '5', 'b6', 'b7']],
    ['major-pentatonic', ['C', 'D', 'E', 'G', 'A'], ['1', '2', '3', '5', '6']],
    ['minor-pentatonic', ['C', 'E♭', 'F', 'G', 'B♭'], ['1', 'b3', '4', '5', 'b7']],
    ['major-triad', ['C', 'E', 'G'], ['1', '3', '5']],
    ['minor-triad', ['C', 'E♭', 'G'], ['1', 'b3', '5']],
    ['diminished-triad', ['C', 'E♭', 'G♭'], ['1', 'b3', 'b5']],
    ['major-seventh', ['C', 'E', 'G', 'B'], ['1', '3', '5', '7']],
    ['dominant-seventh', ['C', 'E', 'G', 'B♭'], ['1', '3', '5', 'b7']],
    ['minor-seventh', ['C', 'E♭', 'G', 'B♭'], ['1', 'b3', '5', 'b7']],
    ['half-diminished-seventh', ['C', 'E♭', 'G♭', 'B♭'], ['1', 'b3', 'b5', 'b7']],
    ['blues', ['C', 'E♭', 'F', 'G♭', 'G', 'B♭'], ['1', 'b3', '4', 'b5', '5', 'b7']],
  ] as const)('%s от C имеет правильные ноты и функции', (id, expected, degrees) => {
    const structure = createStructure('C', id);
    expect(structure.notes.map(note => note.name)).toEqual(expected);
    expect(structure.notes.map(note => note.degree)).toEqual(degrees);
  });

  it('сохраняет функции пентатоники относительно мажорной шкалы', () => {
    const structure = createStructure('A', 'minor-pentatonic');
    expect(structure.notes.map(note => note.name)).toEqual(['A', 'C', 'D', 'E', 'G']);
    expect(structure.formula).toBe('1 – ♭3 – 4 – 5 – ♭7');
    expect(structure.notes.map(note => note.semitones)).toEqual([0, 3, 5, 7, 10]);
  });

  it.each([
    ['C', ['C', 'D', 'E', 'F', 'G', 'A', 'B']],
    ['Db', ['D♭', 'E♭', 'F', 'G♭', 'A♭', 'B♭', 'C']],
    ['D', ['D', 'E', 'F♯', 'G', 'A', 'B', 'C♯']],
    ['Eb', ['E♭', 'F', 'G', 'A♭', 'B♭', 'C', 'D']],
    ['E', ['E', 'F♯', 'G♯', 'A', 'B', 'C♯', 'D♯']],
    ['F', ['F', 'G', 'A', 'B♭', 'C', 'D', 'E']],
    ['F#', ['F♯', 'G♯', 'A♯', 'B', 'C♯', 'D♯', 'E♯']],
    ['G', ['G', 'A', 'B', 'C', 'D', 'E', 'F♯']],
    ['Ab', ['A♭', 'B♭', 'C', 'D♭', 'E♭', 'F', 'G']],
    ['A', ['A', 'B', 'C♯', 'D', 'E', 'F♯', 'G♯']],
    ['Bb', ['B♭', 'C', 'D', 'E♭', 'F', 'G', 'A']],
    ['B', ['B', 'C♯', 'D♯', 'E', 'F♯', 'G♯', 'A♯']],
  ])('мажор от %s соответствует независимому эталону', (root, expected) => {
    expect(names(root as string, 'major')).toEqual(expected);
  });

  it.each([
    ['C', ['C', 'D', 'E♭', 'F', 'G', 'A♭', 'B♭']],
    ['Db', ['D♭', 'E♭', 'F♭', 'G♭', 'A♭', 'B♭♭', 'C♭']],
    ['D', ['D', 'E', 'F', 'G', 'A', 'B♭', 'C']],
    ['Eb', ['E♭', 'F', 'G♭', 'A♭', 'B♭', 'C♭', 'D♭']],
    ['E', ['E', 'F♯', 'G', 'A', 'B', 'C', 'D']],
    ['F', ['F', 'G', 'A♭', 'B♭', 'C', 'D♭', 'E♭']],
    ['F#', ['F♯', 'G♯', 'A', 'B', 'C♯', 'D', 'E']],
    ['G', ['G', 'A', 'B♭', 'C', 'D', 'E♭', 'F']],
    ['Ab', ['A♭', 'B♭', 'C♭', 'D♭', 'E♭', 'F♭', 'G♭']],
    ['A', ['A', 'B', 'C', 'D', 'E', 'F', 'G']],
    ['Bb', ['B♭', 'C', 'D♭', 'E♭', 'F', 'G♭', 'A♭']],
    ['B', ['B', 'C♯', 'D', 'E', 'F♯', 'G', 'A']],
  ])('натуральный минор от %s сохраняет контекстные имена', (root, expected) => {
    expect(names(root as string, 'natural-minor')).toEqual(expected);
  });

  it('поддерживает энгармонические тоники без потери написания', () => {
    expect(names('C#', 'major')).toEqual(['C♯', 'D♯', 'E♯', 'F♯', 'G♯', 'A♯', 'B♯']);
    expect(names('Gb', 'major')).toEqual(['G♭', 'A♭', 'B♭', 'C♭', 'D♭', 'E♭', 'F']);
    expect(names('G#', 'natural-minor')).toEqual(['G♯', 'A♯', 'B', 'C♯', 'D♯', 'E', 'F♯']);
    expect(createStructure('C#', 'major').notes.map(note => note.pitchClass)).toEqual(createStructure('Db', 'major').notes.map(note => note.pitchClass));
    expect(names('C#', 'major')).not.toEqual(names('Db', 'major'));
  });

  it('сохраняет диатоническое написание при двойной альтерации тоники', () => {
    expect(names('B##', 'major')).toEqual(['B♯♯', 'C♯♯♯', 'D♯♯♯', 'E♯♯', 'F♯♯♯', 'G♯♯♯', 'A♯♯♯']);
    expect(formatMidi(39, createStructure('B##', 'major').notes[1].name)).toBe('C♯♯♯2');
  });

  it('отклоняет неизвестный вид структуры', () => {
    expect(() => createStructure('C', 'dorian' as StructureId)).toThrow();
  });
});

describe('диапазоны и контекст грифа', () => {
  it('охватывает 100 уникальных позиций от открытых струн до 24 лада включительно', () => {
    const positions = getPositions({ strings: ['E', 'A', 'D', 'G'], fretMin: 0, fretMax: 24 });
    expect(positions).toHaveLength(100);
    expect(new Set(positions.map(position => position.id)).size).toBe(100);
    expect(positions[0]).toMatchObject({ id: 'E:0', midi: 28 });
    expect(positions.at(-1)).toMatchObject({ id: 'G:24', midi: 67 });
  });

  it('уважает фильтры, включая открытые струны и один крайний лад', () => {
    expect(getPositions({ strings: ['G', 'E'], fretMin: 24, fretMax: 24 }).map(position => position.id)).toEqual(['E:24', 'G:24']);
    expect(getPositions({ strings: ['A'], fretMin: 0, fretMax: 0 }).map(position => position.id)).toEqual(['A:0']);
    expect(getPositions({ strings: [], fretMin: 0, fretMax: 12 })).toEqual([]);
  });

  it('не изменяет переданные фильтры и позиции', () => {
    const strings = Object.freeze(['D', 'E'] as StringId[]);
    const filter = Object.freeze({ strings, fretMin: 0, fretMax: 1 });
    const positions = getPositions(filter);
    const before = JSON.stringify(positions);
    const annotated = annotatePositions(positions, createStructure('C', 'major'));
    expect(JSON.stringify(positions)).toBe(before);
    expect(strings).toEqual(['D', 'E']);
    expect(annotated[0]).not.toBe(positions[0]);
  });

  it('различает полный гриф, ноты структуры и тонику', () => {
    const positions = annotatePositions(getPositions({ strings: ['E'], fretMin: 0, fretMax: 3 }), createStructure('A', 'minor-pentatonic'));
    expect(positions.map(position => [position.noteName, position.inStructure, position.isRoot, position.degree])).toEqual([
      ['E', true, false, '5'], ['F', false, false, null], ['F♯', false, false, null], ['G', true, false, 'b7'],
    ]);
    expect(positions.some(position => position.pitchClass === 9)).toBe(false);
  });

  it('подписывает гамму F major бемолем в нужной позиции', () => {
    const positions = annotatePositions([getPosition('A', 1), getPosition('D', 3)], createStructure('F', 'major'));
    expect(positions[0]).toMatchObject({ id: 'A:1', noteName: 'B♭', inStructure: true, degree: '4', isRoot: false });
    expect(positions[1]).toMatchObject({ id: 'D:3', noteName: 'F', inStructure: true, degree: '1', isRoot: true });
  });

  it('не смешивает научную октаву с хроматическим именем позиции', () => {
    const [position] = annotatePositions([getPosition('E', 12)], createStructure('C#', 'major'));
    expect(position.noteName).toBe('E');
    expect(position.degree).toBe(null);
    const [bSharp] = annotatePositions([getPosition('A', 3)], createStructure('C#', 'major'));
    expect(bSharp.noteName).toBe('B♯');
    expect(formatMidi(bSharp.midi, bSharp.noteName)).toBe('B♯1');
  });

  it('отклоняет невозможные или неоднозначные настройки диапазона', () => {
    expect(() => getPositions({ strings: ['E'], fretMin: 5, fretMax: 4 })).toThrow();
    expect(() => getPositions({ strings: ['E'], fretMin: -1, fretMax: 5 })).toThrow();
    expect(() => getPositions({ strings: ['E'], fretMin: 0, fretMax: 25 })).toThrow();
    expect(() => getPositions({ strings: ['E', 'E'], fretMin: 0, fretMax: 5 })).toThrow();
    expect(() => getPositions({ strings: ['B' as StringId], fretMin: 0, fretMax: 5 })).toThrow();
  });
});
