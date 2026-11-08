import { describe, expect, it } from 'vitest';
import { annotatePositions, createStructure, getPosition } from '../src/music';
import { buildTempoLadder, createPlaybackPlan, eventAtGrid, finiteDurationSeconds, type PlaybackConfig } from '../src/audio/plan';

const structure = createStructure('A', 'minor-pentatonic');
const notes = annotatePositions([getPosition('E', 5), getPosition('A', 3), getPosition('A', 5), getPosition('D', 2)], structure);
const base: PlaybackConfig = { notes, bpm: 120, countIn: false, duration: 'quarter', repeat: 'once' };

describe('музыкальный план проигрывания', () => {
  it('включает A и исключает B, затем завершает фрагмент после длительности последней ноты', () => {
    const plan = createPlaybackPlan({ ...base, range: { from: 1, toExclusive: 3 } });
    expect([0, 4].map(grid => eventAtGrid(plan, grid).note?.id)).toEqual(['A:3', 'A:5']);
    expect(eventAtGrid(plan, 7).finish).toBe(false);
    expect(eventAtGrid(plan, 8)).toMatchObject({ finish: true, note: null, click: null });
    expect(finiteDurationSeconds(plan)).toBe(1);
  });

  it('делает четыре четвертных отсчёта только перед первой нотой', () => {
    const plan = createPlaybackPlan({ ...base, countIn: true, repeat: 'infinite' });
    expect(Array.from({ length: 16 }, (_, i) => eventAtGrid(plan, i)).filter(event => event.click?.audible).map(event => event.grid)).toEqual([0, 4, 8, 12]);
    expect(eventAtGrid(plan, 15).note).toBe(null);
    expect(eventAtGrid(plan, 16)).toMatchObject({ phase: 'practice', noteIndex: 0, beat: 1, bar: 0 });
    expect(eventAtGrid(plan, 32)).toMatchObject({ phase: 'practice', noteIndex: 0, passIndex: 1, loopBoundary: true, beat: 1 });
  });

  it.each([
    ['quarter', [0, 4, 8, 12], 2],
    ['eighth', [0, 2, 4, 6], 1],
    ['sixteenth', [0, 1, 2, 3], 0.5],
  ] as const)('%s сохраняет длительности и окончание', (duration, grids, seconds) => {
    const plan = createPlaybackPlan({ ...base, duration });
    expect(Array.from({ length: plan.finishGrid! }, (_, grid) => eventAtGrid(plan, grid)).filter(event => event.note).map(event => event.grid)).toEqual(grids);
    expect(finiteDurationSeconds(plan)).toBe(seconds);
  });

  it('не перезапускает глобальный метроном при коротком цикле', () => {
    const plan = createPlaybackPlan({ ...base, notes: notes.slice(0, 1), repeat: 'infinite' });
    expect([0, 4, 8, 12, 16].map(grid => [eventAtGrid(plan, grid).passIndex, eventAtGrid(plan, grid).beat, eventAtGrid(plan, grid).bar])).toEqual([
      [0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 4, 0], [4, 1, 1],
    ]);
  });

  it('клик на 2 и 4 игнорирует подразделения и первую долю', () => {
    const plan = createPlaybackPlan({ ...base, repeat: 'infinite', metronome: { mode: 'two-four', subdivision: 'sixteenth' } });
    expect(Array.from({ length: 16 }, (_, grid) => eventAtGrid(plan, grid)).filter(event => event.click?.audible).map(event => event.grid)).toEqual([4, 12]);
  });

  it.each([
    ['quarter', [0, 4, 8, 12]],
    ['eighth', [0, 2, 4, 6, 8, 10, 12, 14]],
    ['sixteenth', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]],
  ] as const)('метроном %s использует независимое подразделение', (subdivision, expected) => {
    const plan = createPlaybackPlan({ ...base, repeat: 'infinite', metronome: { subdivision } });
    expect(Array.from({ length: 16 }, (_, grid) => eventAtGrid(plan, grid)).filter(event => event.click?.audible).map(event => event.grid)).toEqual(expected);
  });

  it('чередует два звучащих и два немых такта без остановки нот', () => {
    const plan = createPlaybackPlan({ ...base, repeat: 'infinite', metronome: { mode: 'gap-2-2' } });
    expect([0, 16, 32, 48, 64].map(grid => eventAtGrid(plan, grid).click?.audible)).toEqual([true, true, false, false, true]);
    expect(eventAtGrid(plan, 32).note).not.toBe(null);
    expect(eventAtGrid(plan, 64).passIndex).toBe(4);
  });

  it('не включает отсчёт в отсчёт звучащих и немых тактов', () => {
    const plan = createPlaybackPlan({ ...base, countIn: true, repeat: 'infinite', metronome: { mode: 'gap-2-2' } });
    expect([16, 32, 48, 64, 80].map(grid => eventAtGrid(plan, grid).click?.audible)).toEqual([true, true, false, false, true]);
  });

  it('отсчёт работает при выключенном метрономе, затем клик отсутствует', () => {
    const plan = createPlaybackPlan({ ...base, countIn: true, metronome: { enabled: false } });
    expect(eventAtGrid(plan, 0).click?.audible).toBe(true);
    expect(eventAtGrid(plan, 16).click).toBe(null);
  });

  it('лестница даёт ровно 60,60,63,63,66,66 и конечный стоп', () => {
    expect(buildTempoLadder(60, 66, 3, 2)).toEqual([60, 60, 63, 63, 66, 66]);
    const plan = createPlaybackPlan({ ...base, notes: notes.slice(0, 1), repeat: { kind: 'ladder', start: 60, end: 66, step: 3, repeatsPerTempo: 2 } });
    expect([0, 4, 8, 12, 16, 20].map(grid => eventAtGrid(plan, grid).bpm)).toEqual([60, 60, 63, 63, 66, 66]);
    expect(eventAtGrid(plan, 23).finish).toBe(false);
    expect(eventAtGrid(plan, 24).finish).toBe(true);
    expect(plan.totalPasses).toBe(6);
  });

  it('последний шаг ограничивает конечным BPM', () => {
    expect(buildTempoLadder(60, 65, 3, 1)).toEqual([60, 63, 65]);
    expect(buildTempoLadder(80, 80, 5, 2)).toEqual([80, 80]);
  });

  it('не изменяет входную последовательность и настройки', () => {
    const input = Object.freeze({ ...base, range: Object.freeze({ from: 0, toExclusive: 2 }) });
    const plan = createPlaybackPlan(input);
    expect(plan.notes).not.toBe(notes);
    expect(plan.range).not.toBe(input.range);
    expect(notes).toHaveLength(4);
  });

  it('отклоняет невозможные параметры до запуска звука', () => {
    expect(() => createPlaybackPlan({ ...base, notes: [] })).toThrow();
    expect(() => createPlaybackPlan({ ...base, range: { from: 2, toExclusive: 2 } })).toThrow(/Фрагмент/);
    expect(() => createPlaybackPlan({ ...base, range: { from: 0, toExclusive: 5 } })).toThrow(/Фрагмент/);
    expect(() => createPlaybackPlan({ ...base, bpm: 221 })).toThrow(/Темп/);
    expect(() => buildTempoLadder(66, 60, 3, 2)).toThrow();
    expect(() => buildTempoLadder(60, 66, 0, 2)).toThrow();
    expect(() => buildTempoLadder(60, 66, 3, 0)).toThrow();
    expect(() => buildTempoLadder(60, 66, 0.0001, 1)).toThrow(/Слишком много/);
  });
});
