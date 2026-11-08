import { describe, expect, it } from 'vitest';
import { createStructure, getPosition, getPositions } from '../src/music';
import { createIntervalTarget, createPitchTarget, INTERVAL_DEGREES, spellInterval, type IntervalDegree } from '../src/training/constraints';

describe('точная звучащая высота', () => {
  const structure = createStructure('A', 'minor-pentatonic');
  it('A1 допускает E5/A0, исключает A12 и именует октаву', () => {
    const result = createPitchTarget({ positions: [getPosition('E', 5), getPosition('A', 0), getPosition('A', 12)], structure, seed: 1 });
    expect(result.targetMidi).toBe(33);
    expect(result.target).toEqual({ pitchClass: 9, name: 'A', degree: '1' });
    expect(result.expectedPositionIds).toEqual(['E:5', 'A:0']);
    expect(result.prompt).toContain('A1');
    expect(result.expectedPositionIds).not.toContain('A:12');
  });

  it('не выбирает отсутствующие высоты и учитывает область структуры', () => {
    const positions = [getPosition('E', 1), getPosition('E', 5)]; // F outside A minor pentatonic.
    for (const seed of [0, 1, 1024, 250000, 0xffffffff]) {
      expect(createPitchTarget({ positions, structure, seed }).targetMidi).toBe(33);
      expect([29, 33]).toContain(createPitchTarget({ positions, structure, scope: 'chromatic', seed }).targetMidi);
    }
    expect(() => createPitchTarget({ positions: [getPosition('E', 1)], structure, seed: 1 })).toThrow(/нет доступных высот/);
  });

  it('sampling по unique MIDI не меняет выбранную высоту при дублировании и перестановке позиций', () => {
    const positions = [getPosition('E', 5), getPosition('A', 12), getPosition('E', 17)];
    const seed = 100000;
    const first = createPitchTarget({ positions, structure, seed });
    const second = createPitchTarget({ positions: [positions[2], positions[1], positions[0], positions[0], getPosition('A', 0)], structure, seed });
    expect(second.targetMidi).toBe(first.targetMidi);
    expect(new Set(second.expectedPositionIds).size).toBe(second.expectedPositionIds.length);
    expect(Object.isFrozen(second.target)).toBe(true);
  });

  it('контекстное B♯ имеет октаву B♯1 при звучащем C2', () => {
    const result = createPitchTarget({ positions: [getPosition('A', 3)], structure: createStructure('C#', 'major'), seed: 1 });
    expect(result.targetMidi).toBe(36);
    expect(result.target.name).toBe('B♯');
    expect(result.prompt).toContain('B♯1');
  });

  it('проверяет пустоту, seed и реальность позиции', () => {
    expect(() => createPitchTarget({ positions: [], structure, seed: 1 })).toThrow();
    expect(() => createPitchTarget({ positions: [getPosition('E', 5)], structure, seed: -1 })).toThrow(/Seed/);
    expect(() => createPitchTarget({ positions: [{ ...getPosition('E', 5), midi: 45 }], structure, seed: 1 })).toThrow(/строю/);
  });
});

describe('интервал от тоники', () => {
  it.each([
    ['C', '#4', 'F♯', 6, 6], ['C', 'b5', 'G♭', 6, 6], ['F#', '3', 'A♯', 10, 4],
    ['Gb', '4', 'C♭', 11, 5], ['C#', '7', 'B♯', 0, 11], ['Bb', 'b3', 'D♭', 1, 3],
    ['G#', '#4', 'C♯♯', 2, 6], ['Cb', '1', 'C♭', 11, 0],
  ] as const)('%s → %s правильно сохраняет букву и знак', (root, degree, name, pitchClass, semitones) => {
    expect(spellInterval(root, degree)).toMatchObject({ name, pitchClass, semitones, degree });
  });

  it('контрольный полный набор от C независим от выбранной структуры', () => {
    expect(INTERVAL_DEGREES.map(degree => spellInterval('C', degree).name)).toEqual(['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']);
  });

  it('C→#4 и C→b5 принимают одни позиции F♯/G♭ во всех октавах', () => {
    const positions = [getPosition('E', 2), getPosition('E', 14), getPosition('D', 4), getPosition('A', 0)];
    const sharp = createIntervalTarget('C', '#4', positions);
    const flat = createIntervalTarget('C', 'b5', positions);
    expect(sharp).toMatchObject({ scope: 'chromatic', targetMidi: null, target: { name: 'F♯', pitchClass: 6, degree: '#4' }, expectedPositionIds: ['E:2', 'E:14', 'D:4'] });
    expect(flat.target.name).toBe('G♭');
    expect(flat.expectedPositionIds).toEqual(sharp.expectedPositionIds);
    expect(sharp.prompt).toContain('♯4 от C');
  });

  it('тоника 1 явно не ограничивает октаву; 8 не предлагается как отдельный класс', () => {
    const positions = [getPosition('A', 0), getPosition('A', 12)];
    expect(createIntervalTarget('A', '1', positions).expectedPositionIds).toEqual(['A:0', 'A:12']);
    expect(() => createIntervalTarget('A', '8' as IntervalDegree, positions)).toThrow(/Неизвестный интервал/);
  });

  it('диапазон 0–24 включителен; невозможный интервал не создаёт пустой вопрос', () => {
    const positions = getPositions({ strings: ['E'], fretMin: 0, fretMax: 24 });
    expect(createIntervalTarget('E', '1', positions).expectedPositionIds).toEqual(['E:0', 'E:12', 'E:24']);
    expect(() => createIntervalTarget('C', '#4', [getPosition('E', 0)])).toThrow(/отсутствует/);
    expect(() => createIntervalTarget('C', '#4', [])).toThrow(/отсутствует/);
    expect(() => spellInterval('C', '#9' as IntervalDegree)).toThrow(/Неизвестный интервал/);
    expect(() => spellInterval('H', '1')).toThrow();
  });
});
