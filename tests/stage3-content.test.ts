import { describe, expect, it } from 'vitest';
import { barChords, buildExercise, chordSeries, createExerciseSpec, RIFF_IDS } from '../src/exercises';
import { buildTimeline, rhythmPatternsFor } from '../src/exercises/rhythm';

/* ---------- Риффы этапа 3 (R-028, B4): таблицы и контрольные примеры выписаны в требованиях вручную ---------- */

const riff = (id: string, root: string) => buildExercise(createExerciseSpec('riff', { riff: id, root } as never));
type Plan = ReturnType<typeof riff>;
const bar = (plan: Plan, index: number) => plan.notes.filter(note => note.segment === index);
const shape = (plan: Plan, index: number) => bar(plan, index).map(note => `${note.id} ${note.name}`).join(', ');
const fingers = (plan: Plan, index: number) => bar(plan, index).map(note => note.finger ?? '-').join(' ');
const degrees = (plan: Plan, index: number) => bar(plan, index).map(note => note.degree).join(' ');
const events = (plan: Plan) => {
  const timeline = buildTimeline(plan);
  return Array.from({ length: timeline.bars }, (_, index) => timeline.steps.filter(step => step.bar === index).map(step => `${step.beatInBar * 4}/${step.grids}${step.note === null ? ':—' : ''}`).join(' '));
};

describe('shift-ab, A (a = 5): форма A лады 5–8, затем форма B лады 7–10', () => {
  const plan = riff('shift-ab', 'A');
  it('подписи сегментов и позиции по таблице B4', () => {
    expect(plan.segments.map(segment => segment.label)).toEqual(['Am · форма A · лады 5–8', 'Am · форма B · лады 7–10']);
    expect(shape(plan, 0)).toBe('E:5 A1, E:8 C2, A:5 D2, A:7 E2, D:5 G2, A:7 E2, A:5 D2, A:7 E2');
    expect(shape(plan, 1)).toBe('D:7 A2, D:10 C3, G:7 D3, G:9 E3, G:7 D3, D:10 C3, D:7 A2');
  });
  it('пальцы — лад минус первый лад окна плюс 1; ступени из таблицы', () => {
    expect(fingers(plan, 0)).toBe('1 4 1 3 1 3 1 3');
    expect(fingers(plan, 1)).toBe('1 4 1 3 1 4 1');
    expect(degrees(plan, 0)).toBe('1 b3 4 5 b7 5 4 5');
    expect(degrees(plan, 1)).toBe('1 b3 4 5 4 b3 1');
  });
  it('ритм: восемь восьмых и шесть восьмых с последней четвертью; все события чётны — шаффл допустим', () => {
    expect(events(plan)).toEqual(['0/2 2/2 4/2 6/2 8/2 10/2 12/2 14/2', '0/2 2/2 4/2 6/2 8/2 10/2 12/4']);
    expect(rhythmPatternsFor(plan)).toEqual(['eighths', 'shuffle']);
  });
  it('аккорд каждого такта — i (для аккомпанемента)', () => {
    expect(barChords(createExerciseSpec('riff', { riff: 'shift-ab', root: 'A' }))!.map(chord => chord?.name)).toEqual(['Am', 'Am']);
  });
  it('E → a = 12: формы лежат выше, фигура строится на ладах 12–19', () => {
    const high = riff('shift-ab', 'E');
    expect(shape(high, 0).split(', ')[0]).toBe('E:12 E2');
    expect(Math.max(...high.notes.map(note => note.fret))).toBe(17);
  });
});

describe('boogie-12, A: блюз, ход вверх U, вниз D, остановка', () => {
  const plan = riff('boogie-12', 'A');
  const names = (index: number) => bar(plan, index).map(note => `${note.id} ${note.name}`).join(', ');
  it('A7 U — такты 1, 3, 7, 11: E:5 ×2, A:4 ×2, A:7 ×2, D:4 ×2', () => {
    for (const index of [0, 2, 6, 10]) expect(names(index), `такт ${index + 1}`).toBe('E:5 A1, E:5 A1, A:4 C♯2, A:4 C♯2, A:7 E2, A:7 E2, D:4 F♯2, D:4 F♯2');
  });
  it('A7 D — такты 2, 4, 8: D:5 ×2, D:4 ×2, A:7 ×2, A:4 ×2', () => {
    for (const index of [1, 3, 7]) expect(names(index), `такт ${index + 1}`).toBe('D:5 G2, D:5 G2, D:4 F♯2, D:4 F♯2, A:7 E2, A:7 E2, A:4 C♯2, A:4 C♯2');
  });
  it('D7 U — такты 5, 10 и D — такт 6; E7 U — такт 9', () => {
    for (const index of [4, 9]) expect(names(index)).toBe('A:5 D2, A:5 D2, D:4 F♯2, D:4 F♯2, D:7 A2, D:7 A2, G:4 B2, G:4 B2');
    expect(names(5)).toBe('G:5 C3, G:5 C3, G:4 B2, G:4 B2, D:7 A2, D:7 A2, D:4 F♯2, D:4 F♯2');
    expect(names(8)).toBe('A:7 E2, A:7 E2, D:6 G♯2, D:6 G♯2, D:9 B2, D:9 B2, G:6 C♯3, G:6 C♯3');
  });
  it('такт 12 — остановка: E:7 ×2 восьмыми, 3 ×2 восьмыми, 5 четвертью и четвертная пауза', () => {
    expect(names(11)).toBe('A:7 E2, A:7 E2, D:6 G♯2, D:6 G♯2, D:9 B2');
    expect(events(plan)[11]).toBe('0/2 2/2 4/2 6/2 8/4 12/4:—');
  });
  it('пальцы: 1 — 2, 3 и 6 — 1, 5 — 4, ♭7 — 2; ступени U: 1 1 3 3 5 5 6 6, D: ♭7 ♭7 6 6 5 5 3 3', () => {
    expect(fingers(plan, 0)).toBe('2 2 1 1 4 4 1 1');
    expect(fingers(plan, 1)).toBe('2 2 1 1 4 4 1 1');
    expect(degrees(plan, 0)).toBe('1 1 3 3 5 5 6 6');
    expect(degrees(plan, 1)).toBe('b7 b7 6 6 5 5 3 3');
  });
  it('серия одинаковых аккордов: номер такта в серии идёт с нуля и обнуляется при смене аккорда', () => {
    const chords = barChords(createExerciseSpec('riff', { riff: 'boogie-12', root: 'A' }))!;
    expect(chordSeries(chords.map(chord => ({ root: chord!.root, structureId: chord!.structureId!})))).toEqual([0, 1, 2, 3, 0, 1, 0, 1, 0, 0, 0, 0]);
  });
  it('все события чётны — шаффл допустим; такт блюза — A7 · I7', () => {
    expect(rhythmPatternsFor(plan)).toEqual(['eighths', 'shuffle']);
    expect(plan.segments[0].label).toBe('A7 · I7');
  });
});

describe('границы', () => {
  it('все 12 тоник: новые фигуры строятся на ладах 1–24, категория «Риффы», завершения тоникой нет', () => {
    for (const root of ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']) for (const id of ['shift-ab', 'boogie-12']) {
      const plan = riff(id, root);
      expect(RIFF_IDS).toContain(id);
      expect(plan, `${id} ${root}`).toMatchObject({ category: 'riffs', cadence: 'none', overlap: 'none' });
      expect(Math.min(...plan.notes.map(note => note.fret)), `${id} ${root}`).toBeGreaterThanOrEqual(1);
      expect(Math.max(...plan.notes.map(note => note.fret)), `${id} ${root}`).toBeLessThanOrEqual(24);
    }
  });
});
