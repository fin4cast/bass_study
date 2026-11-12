import { describe, expect, it } from 'vitest';
import { createManualPracticeResult, type QuestionContext } from '../src/training';

const context: QuestionContext = { root: 'A', structureId: 'minor-pentatonic', scope: 'structure', positionIds: ['E:0', 'E:3'] };
const sequence = { kind: 'sequence', pattern: 'ascending', routePositionIds: ['E:0', 'E:3'], duration: 'quarter', fragment: { from: 0, toExclusive: 2 }, box: null } as const;
const fretboard = { kind: 'fretboard', box: null } as const;

describe('ручная отметка игры отделена от экранной оценки', () => {
  it('явно маркирует самооценку и не создаёт измеренную правильность игры', () => {
    const result = createManualPracticeResult({ context, material: sequence, comfortableBpm: 72, durationMs: 60_000, note: 'Ровно на 72 BPM' });
    expect(result).toMatchObject({ kind: 'manual', source: 'self-report', comfortableBpm: 72, durationMs: 60_000, note: 'Ровно на 72 BPM' });
    expect(result).not.toHaveProperty('independentCorrect');
    expect(result).not.toHaveProperty('accuracy');
    expect(result).not.toHaveProperty('errors');
  });

  it('сохраняет исходный контекст независимо от последующих изменений фильтров', () => {
    const ids = ['E:0'];
    const mutable = { ...context, positionIds: ids };
    const result = createManualPracticeResult({ context: mutable, material: fretboard, comfortableBpm: 80, durationMs: 0 });
    ids.push('E:12'); mutable.root = 'C';
    expect(result.context?.root).toBe('A');
    expect(result.context?.positionIds).toEqual(['E:0']);
    expect(result.note).toBe('');
    expect(Object.isFrozen(result.context?.positionIds)).toBe(true);
  });

  it('не принимает недостоверные параметры темпа, времени и заметки', () => {
    for (const bpm of [39, 221, 80.5, NaN]) {
      expect(() => createManualPracticeResult({ context, material: sequence, comfortableBpm: bpm, durationMs: 1000 })).toThrow();
    }
    for (const durationMs of [-1, Infinity, NaN]) {
      expect(() => createManualPracticeResult({ context, material: sequence, comfortableBpm: 80, durationMs })).toThrow();
    }
    expect(() => createManualPracticeResult({ context, material: sequence, comfortableBpm: 80, durationMs: 1000, note: 'x'.repeat(2001) })).toThrow();
  });

  it('не создаёт отметку без материала: «Изучение грифа» сохраняется явно', () => {
    expect(() => createManualPracticeResult({ context, comfortableBpm: 80, durationMs: 0 } as never)).toThrow(/материал/i);
    expect(createManualPracticeResult({ context, material: fretboard, comfortableBpm: 80, durationMs: 0 }).material).toEqual(fretboard);
  });
});
