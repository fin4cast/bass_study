import { describe, expect, it } from 'vitest';
import { barChords, buildExercise, createExerciseSpec, RIFF_IDS } from '../src/exercises';
import { buildTimeline, rhythmPatternsFor } from '../src/exercises/rhythm';

/* ---------- Риффы этапа 4 (R-028, B4): таблицы и контрольные примеры выписаны в требованиях вручную ---------- */

const riff = (id: string, root: string) => buildExercise(createExerciseSpec('riff', { riff: id, root } as never));
type Plan = ReturnType<typeof riff>;
const bar = (plan: Plan, index: number) => plan.notes.filter(note => note.segment === index);
const shape = (plan: Plan, index: number) => bar(plan, index).map(note => `${note.id} ${note.name}`).join(', ');
const fingers = (plan: Plan, index: number) => bar(plan, index).map(note => note.finger ?? '-').join(' ');
const degrees = (plan: Plan, index: number) => bar(plan, index).map(note => note.degree ?? '-').join(' ');
const events = (plan: Plan) => {
  const timeline = buildTimeline(plan);
  return Array.from({ length: timeline.bars }, (_, index) => timeline.steps.filter(step => step.bar === index).map(step => `${step.beatInBar * 4}/${step.grids}${step.note === null ? ':—' : ''}`).join(' '));
};

describe('fourths-cycle, C: C7, F7, B♭7, E♭7 по кварте вверх', () => {
  const plan = riff('fourths-cycle', 'C');
  it('подписи тактов — имя аккорда без цифры; тоники A:3, A:8, E:6 (2 против A:13), A:6', () => {
    expect(plan.segments.map(segment => segment.label)).toEqual(['C7', 'F7', 'B♭7', 'E♭7']);
    expect([0, 1, 2, 3].map(index => bar(plan, index)[0].id)).toEqual(['A:3', 'A:8', 'E:6', 'A:6']);
  });
  it.each([
    [0, 'A:3 C2, A:3 C2, D:5 G2, G:3 B♭2, G:5 C3, G:3 B♭2, D:5 G2'],
    [1, 'A:8 F2, A:8 F2, D:10 C3, G:8 E♭3, G:10 F3, G:8 E♭3, D:10 C3'],
    [2, 'E:6 B♭1, E:6 B♭1, A:8 F2, D:6 A♭2, D:8 B♭2, D:6 A♭2, A:8 F2'],
    [3, 'A:6 E♭2, A:6 E♭2, D:8 B♭2, G:6 D♭3, G:8 E♭3, G:6 D♭3, D:8 B♭2'],
  ])('такт %i', (index, expected) => {
    expect(shape(plan, index)).toBe(expected);
  });
  it('ступени 1 1 5 ♭7 1 ♭7 5; пальцы 2 2 4 2 4 2 4; длительности 3 1 2 2 4 2 2; шаффл недопустим', () => {
    for (const index of [0, 1, 2, 3]) {
      expect(degrees(plan, index)).toBe('1 1 5 b7 1 b7 5');
      expect(fingers(plan, index)).toBe('2 2 4 2 4 2 4');
    }
    expect(events(plan)[0]).toBe('0/3 3/1 4/2 6/2 8/4 12/2 14/2');
    expect(rhythmPatternsFor(plan)).toEqual(['eighths']);
  });
  it('аккорды для аккомпанемента — четыре доминантсептаккорда; от G — G7, C7, F7, B♭7', () => {
    expect(barChords(createExerciseSpec('riff', { riff: 'fourths-cycle', root: 'C' }))!.map(chord => [chord?.name, chord?.structureId])).toEqual(
      ['C7', 'F7', 'B♭7', 'E♭7'].map(name => [name, 'dominant-seventh']));
    expect(riff('fourths-cycle', 'G').segments.map(segment => segment.label)).toEqual(['G7', 'C7', 'F7', 'B♭7']);
  });
});

describe('three-forms, A (a = 5): формы A, B, C, C', () => {
  const plan = riff('three-forms', 'A');
  it('подписи сегментов и позиции по таблице B4', () => {
    expect(plan.segments.map(segment => segment.label)).toEqual(['Am · форма A · лады 5–8', 'Am · форма B · лады 7–10', 'Am · форма C · лады 9–12', 'Am · форма C · лады 9–12']);
    expect(shape(plan, 0)).toBe('E:5 A1, E:8 C2, A:5 D2, A:7 E2, A:5 D2, E:8 C2, E:5 A1');
    expect(shape(plan, 1)).toBe('A:7 E2, A:10 G2, D:7 A2, D:10 C3, D:7 A2, A:10 G2, A:7 E2');
    expect(shape(plan, 2)).toBe('D:10 C3, D:12 D3, G:9 E3, G:12 G3, G:9 E3, D:12 D3, D:10 C3');
    expect(shape(plan, 3)).toBe('A:12 A2, D:10 C3, A:12 A2, A:12 A2');
  });
  it('пальцы по формам: 1 4 1 3 1 4 1 · 1 4 1 4 1 4 1 · 2 4 1 4 1 4 2 · 4 2 4 4', () => {
    expect([0, 1, 2, 3].map(index => fingers(plan, index))).toEqual(['1 4 1 3 1 4 1', '1 4 1 4 1 4 1', '2 4 1 4 1 4 2', '4 2 4 4']);
    expect(degrees(plan, 0)).toBe('1 b3 4 5 4 b3 1');
    expect(degrees(plan, 3)).toBe('1 b3 1 1');
  });
  it('ритм: шесть восьмых и четверть; последний такт — четверть, восьмая, восьмая, половинная; шаффл допустим', () => {
    expect(events(plan)).toEqual(['0/2 2/2 4/2 6/2 8/2 10/2 12/4', '0/2 2/2 4/2 6/2 8/2 10/2 12/4', '0/2 2/2 4/2 6/2 8/2 10/2 12/4', '0/4 4/2 6/2 8/8']);
    expect(rhythmPatternsFor(plan)).toEqual(['eighths', 'shuffle']);
  });
  it('Bm (a = 7): формы A 7–10, B 9–12, C 11–14 — позиции сдвигаются вместе с тоникой', () => {
    const high = riff('three-forms', 'B');
    expect(high.segments.map(segment => segment.label)).toEqual(['Bm · форма A · лады 7–10', 'Bm · форма B · лады 9–12', 'Bm · форма C · лады 11–14', 'Bm · форма C · лады 11–14']);
    expect(shape(high, 0)).toBe('E:7 B1, E:10 D2, A:7 E2, A:9 F♯2, A:7 E2, E:10 D2, E:7 B1');
    expect(shape(high, 3)).toBe('A:14 B2, D:12 D3, A:14 B2, A:14 B2');
    expect(fingers(high, 2)).toBe('2 4 1 4 1 4 2');
  });
  it('аккорд каждого такта — i', () => {
    expect(barChords(createExerciseSpec('riff', { riff: 'three-forms', root: 'A' }))!.map(chord => chord?.name)).toEqual(Array(4).fill('Am'));
  });
});

describe('границы', () => {
  it('все 12 тоник: новые фигуры строятся на ладах 1–24, категория «Риффы», завершения тоникой нет', () => {
    for (const root of ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']) for (const id of ['fourths-cycle', 'three-forms']) {
      const plan = riff(id, root);
      expect(RIFF_IDS).toContain(id);
      expect(plan, `${id} ${root}`).toMatchObject({ category: 'riffs', cadence: 'none', overlap: 'none' });
      expect(Math.min(...plan.notes.map(note => note.fret)), `${id} ${root}`).toBeGreaterThanOrEqual(1);
      expect(Math.max(...plan.notes.map(note => note.fret)), `${id} ${root}`).toBeLessThanOrEqual(24);
    }
  });
});
