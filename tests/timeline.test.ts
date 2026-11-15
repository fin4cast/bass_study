import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec } from '../src/exercises';
import { barStepRange, buildTimeline } from '../src/exercises/rhythm';

const plan = (templateId: Parameters<typeof createExerciseSpec>[0], params = {}) => buildExercise(createExerciseSpec(templateId, params as never));
const names = (p: ReturnType<typeof plan>, steps: ReturnType<typeof buildTimeline>['steps']) => steps.map(step => step.note === null ? '—' : `${p.notes[step.note].id}:${step.grids}`);

describe('шкала прохода (D-050)', () => {
  it('пентатоника A: 14 восьмых и завершение тоникой A на E/5 четвертью — ровно два такта', () => {
    const form = plan('pentatonic-form');
    const timeline = buildTimeline(form);
    expect(form.notes).toHaveLength(14);
    expect(timeline.passGrids).toBe(32);
    // Последняя нота формы — E/8 (C, ♭3); ближайшая тоника — A1 на E/5, тянется до доли.
    expect(names(form, timeline.steps.slice(-2))).toEqual(['E:8:2', 'E:5:4']);
    expect(timeline.steps.at(-1)).toMatchObject({ landing: true, start: 28, bar: 1, beatInBar: 3 });
  });
  it('арпеджио 1–3–5–8: «туда-обратно» кончается терцией — завершение тоникой C четвертью, ровно такт', () => {
    const arpeggio = plan('arpeggio-1358');
    const timeline = buildTimeline(arpeggio);
    expect(arpeggio.notes.map(note => note.degree)).toEqual(['1', '3', '5', '1', '5', '3']);
    expect(timeline.steps.map(step => step.grids)).toEqual([2, 2, 2, 2, 2, 2, 4]);
    expect(arpeggio.notes[timeline.steps.at(-1)!.note!]).toMatchObject({ degree: '1', id: arpeggio.notes[0].id });
    expect(timeline.passGrids).toBe(16);
  });
  it('Root–5–8 (4 ноты R–5–8–5): завершение тоникой и пауза до конца такта', () => {
    const root = plan('root-five-eight');
    const timeline = buildTimeline(root);
    expect(timeline.steps.map(step => step.note === null ? null : step.grids)).toEqual([2, 2, 2, 2, 4, null]);
    expect(timeline.steps.at(-1)!.grids).toBe(4);
  });
});

describe('шкала: рисунки и эхо', () => {
  it('форма B завершается ближайшей нотой со ступенью 1, а не первой нотой формы', () => {
    const form = plan('pentatonic-form', { shapeId: 'penta-b' });
    const timeline = buildTimeline(form);
    const landing = timeline.steps.find(step => step.landing)!;
    expect(form.notes[0].degree).not.toBe('1');
    expect(form.notes[landing.note!].degree).toBe('1');
    expect(timeline.passGrids % 16).toBe(0);
  });
  it('хроматика: 16 восьмых ровно два такта, без завершения и пауз', () => {
    const chromatic = plan('chromatic-position');
    const timeline = buildTimeline(chromatic);
    expect(timeline.steps).toHaveLength(16);
    expect(timeline.steps.every(step => step.note !== null && step.grids === 2 && !step.landing)).toBe(true);
    expect(timeline.bars).toBe(2);
  });
  it('четверти: 16 нот хроматики — четыре такта; синкопа 8–4–8 повторяется и не пересекает тактовую черту', () => {
    expect(buildTimeline(plan('chromatic-position'), { pattern: 'quarters' }).bars).toBe(4);
    const sync = buildTimeline(plan('chromatic-position'), { pattern: 'syncopation' });
    expect(sync.steps.slice(0, 4).map(step => [step.grids, step.beatInBar])).toEqual([[2, 0], [4, 0.5], [2, 1.5], [2, 2]]);
    expect(sync.steps.every(step => step.start % 16 + step.grids <= 16)).toBe(true);
  });
  it('эхо: каждый такт повторяется тактом без эталона', () => {
    const timeline = buildTimeline(plan('chromatic-position'), { echo: true });
    expect(timeline.bars).toBe(4);
    expect(timeline.steps.filter(step => step.bar === 1).every(step => step.echo && !step.audible)).toBe(true);
    expect(timeline.steps.filter(step => step.bar === 0).map(step => step.note)).toEqual(timeline.steps.filter(step => step.bar === 1).map(step => step.note));
  });
  it('последовательность: такт — аккорд, рисунок только восьмые или шаффл; петля по тактам в шагах', () => {
    const progression = plan('progression');
    const timeline = buildTimeline(progression, { pattern: 'quarters' });
    expect(timeline.pattern).toBe('eighths');
    expect(timeline.bars).toBe(4);
    expect(timeline.steps.filter(step => step.bar === 1).every(step => progression.notes[step.note!].segment === 1)).toBe(true);
    expect(barStepRange(timeline, 1, 3)).toEqual({ from: 8, toExclusive: 24 });
    expect(buildTimeline(progression, { pattern: 'shuffle' }).swing).toBe(66);
  });
});
