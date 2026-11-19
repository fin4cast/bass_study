import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec } from '../src/exercises';
import { patternFits, walkingTones } from '../src/exercises/bars';
import { buildTimeline } from '../src/exercises/rhythm';
import { lineSpec, newLineDraft, setBarKind, setBarPattern, setBarRhythm, setBarStep } from '../src/practice/line-builder';

/* ---------- «Шагающий бас» — walking (R-028, B2.4): примеры в требованиях выписаны вручную ---------- */

const run = (params: Record<string, unknown>) => buildExercise(createExerciseSpec('progression', { pattern: 'walking', ...params } as never));
type Plan = ReturnType<typeof run>;
/** Четыре ноты такта в четвертях: по шкале прохода. */
function quarters(plan: Plan, bar: number) {
  const timeline = buildTimeline(plan, { pattern: 'quarters' });
  return timeline.steps.filter(step => step.bar === bar && step.note !== null).map(step => plan.notes[step.note!]);
}
const show = (plan: Plan, bar: number) => {
  const notes = quarters(plan, bar);
  return {
    ids: notes.map(note => note.id).join(' '), names: notes.map(note => note.name).join(' '),
    degrees: notes.map(note => note.degree ?? '-').join(' '), fingers: notes.map(note => note.finger ?? '-').join(' '),
  };
};

describe('таблица шагающего баса (B2.4)', () => {
  it('нечётный такт серии — 1, 3/♭3, 5, x; чётный — y, x, 5, 3/♭3; x и y по виду аккорда', () => {
    expect([walkingTones('major-triad', 0), walkingTones('major-triad', 1)]).toEqual([['1', '3', '5', '6'], ['8', '6', '5', '3']]);
    expect([walkingTones('dominant-seventh', 0), walkingTones('dominant-seventh', 1)]).toEqual([['1', '3', '5', '6'], ['b7', '6', '5', '3']]);
    expect([walkingTones('major-seventh', 0), walkingTones('major-seventh', 1)]).toEqual([['1', '3', '5', '6'], ['7', '6', '5', '3']]);
    expect([walkingTones('minor-triad', 0), walkingTones('minor-triad', 1)]).toEqual([['1', 'b3', '5', 'b7'], ['8', 'b7', '5', 'b3']]);
    expect([walkingTones('minor-seventh', 0), walkingTones('minor-seventh', 1)]).toEqual([['1', 'b3', '5', 'b7'], ['8', 'b7', '5', 'b3']]);
  });
  it('допустим всем видам аккорда, кроме уменьшённых', () => {
    expect(['major-triad', 'minor-triad', 'dominant-seventh', 'minor-seventh', 'major-seventh'].map(id => patternFits('walking', id as never))).toEqual(Array(5).fill(true));
    expect(['diminished-triad', 'half-diminished-seventh'].map(id => patternFits('walking', id as never))).toEqual([false, false]);
    expect(() => createExerciseSpec('progression', { root: 'C', progression: 'diatonic', pattern: 'walking' } as never)).toThrow(RangeError);
    expect(() => createExerciseSpec('progression', { root: 'A', progression: 'I-IV-V', pattern: 'walking', position: 'open' } as never)).toThrow(RangeError);
  });
});

describe('ii–V–I в C, четверти (закрытая позиция): Dm7 — A:5, G7 — E:3, Cmaj7 — A:3', () => {
  const plan = run({ root: 'C', progression: 'ii-V-I' });
  it('Dm7: 1 ♭3 5 и подход к G — F♯1', () => {
    expect(show(plan, 0)).toEqual({ ids: 'A:5 A:8 D:7 E:2', names: 'D2 F2 A2 F♯1', degrees: '1 b3 5 -', fingers: '1 4 3 -' });
  });
  it('G7: 1 3 5 и подход к C — B1 (по высоте совпал с терцией, но это нота хвоста: без ступени и пальца)', () => {
    expect(show(plan, 1)).toEqual({ ids: 'E:3 A:2 A:5 A:2', names: 'G1 B1 D2 B1', degrees: '1 3 5 -', fingers: '2 1 4 -' });
  });
  it('Cmaj7, первый такт серии: 1 3 5 6; второй — 7 6 5 и подход к D — C♯2', () => {
    expect(show(plan, 2)).toEqual({ ids: 'A:3 D:2 D:5 G:2', names: 'C2 E2 G2 A2', degrees: '1 3 5 6', fingers: '2 1 4 1' });
    expect(show(plan, 3)).toEqual({ ids: 'G:4 G:2 D:5 A:4', names: 'B2 A2 G2 C♯2', degrees: '7 6 5 -', fingers: '3 1 4 -' });
  });
  it('в восьмых каждая нота четверти звучит дважды, подход — только на последней атаке', () => {
    const eighths = buildTimeline(plan, { pattern: 'eighths' }).steps.filter(step => step.bar === 0).map(step => plan.notes[step.note!].id);
    expect(eighths).toEqual(['A:5', 'A:5', 'A:8', 'A:8', 'D:7', 'D:7', 'G:5', 'E:2']);
  });
});

describe('блюз в A, четверти (закрытая позиция) — таблица B2.4', () => {
  const plan = run({ root: 'A', progression: 'blues-12' });
  const A7_FIRST = { ids: 'E:5 A:4 A:7 D:4', names: 'A1 C♯2 E2 F♯2', degrees: '1 3 5 6', fingers: '2 1 4 1' };
  it.each([
    [0, A7_FIRST.ids, A7_FIRST.names], [2, A7_FIRST.ids, A7_FIRST.names], [6, A7_FIRST.ids, A7_FIRST.names],
    [1, 'D:5 D:4 A:7 A:4', 'G2 F♯2 E2 C♯2'], [3, 'D:5 D:4 A:7 A:4', 'G2 F♯2 E2 C♯2'],
    [4, 'A:5 D:4 D:7 G:4', 'D2 F♯2 A2 B2'], [5, 'G:5 G:4 D:7 E:4', 'C3 B2 A2 G♯1'], [7, 'D:5 D:4 A:7 A:6', 'G2 F♯2 E2 D♯2'],
    [8, 'A:7 D:6 D:9 A:4', 'E2 G♯2 B2 C♯2'], [9, 'A:5 D:4 D:7 E:4', 'D2 F♯2 A2 G♯1'],
    [10, 'E:5 A:4 A:7 A:6', 'A1 C♯2 E2 D♯2'], [11, 'A:7 D:6 D:9 E:4', 'E2 G♯2 B2 G♯1'],
  ])('такт %i', (bar, ids, names) => {
    expect(show(plan, bar)).toMatchObject({ ids, names });
  });
  it('над доминантсептаккордом два такта серии дают буги-ход 1 3 5 6 | ♭7 6 5 3; через смену аккорда серия начинается заново', () => {
    expect([show(plan, 0).degrees, show(plan, 1).degrees, show(plan, 2).degrees, show(plan, 3).degrees]).toEqual(['1 3 5 6', 'b7 6 5 3', '1 3 5 6', 'b7 6 5 -']);
    expect(show(plan, 4).degrees).toBe('1 3 5 6');
    expect(show(plan, 5).degrees).toBe('b7 6 5 -');
    expect(show(plan, 6).degrees).toBe('1 3 5 6');
  });
});

describe('нижняя позиция (low): тоника подбирается по нотам обоих видов такта серии', () => {
  const plan = run({ root: 'F', progression: 'blues-12', position: 'low' });
  it('F7 — E:1: терция A:0 и секста D:0 — на открытых струнах, без пальца', () => {
    expect(show(plan, 0)).toEqual({ ids: 'E:1 A:0 A:3 D:0', names: 'F1 A1 C2 D2', degrees: '1 3 5 6', fingers: '2 - 4 -' });
  });
  it('второй такт серии: ♭7 на D:1, секста D:0, квинта A:3, терция A:0', () => {
    expect(show(plan, 1)).toEqual({ ids: 'D:1 D:0 A:3 A:0', names: 'E♭2 D2 C2 A1', degrees: 'b7 6 5 3', fingers: '2 - 4 -' });
  });
  it('такт 4 (F7 → B♭7): подход к B♭ на A:1 — A:0 (A1), на лад ниже тоники', () => {
    expect(show(plan, 3)).toEqual({ ids: 'D:1 D:0 A:3 A:0', names: 'E♭2 D2 C2 A1', degrees: 'b7 6 5 -', fingers: '2 - 4 -' });
  });
});

describe('границы и «Своя линия»', () => {
  it('все 12 тоник: ii–V–I и блюз строятся шагающим басом в закрытой (1–24) и нижней (0–24) позиции', () => {
    for (const root of ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']) for (const progression of ['ii-V-I', 'blues-12', 'I-IV-V', 'i-iv'] as const) for (const position of ['closed', 'low'] as const) {
      const plan = run({ root: progression === 'i-iv' ? root : root, progression, position });
      expect(Math.min(...plan.notes.map(note => note.fret)), `${root} ${progression} ${position}`).toBeGreaterThanOrEqual(position === 'closed' ? 1 : 0);
      expect(Math.max(...plan.notes.map(note => note.fret)), `${root} ${progression} ${position}`).toBeLessThanOrEqual(24);
    }
  });
  it('в «Своей линии» серию образуют подряд идущие такты с тем же аккордом независимо от рисунка соседних', () => {
    let draft = newLineDraft('C');
    draft = setBarKind(setBarStep(draft, 0, 0), 0, 'dominant-seventh', 3);
    draft = setBarKind(setBarStep(draft, 1, 0), 1, 'dominant-seventh', 3);
    draft = setBarRhythm(setBarRhythm(setBarPattern(setBarPattern(draft, 0, 'walking'), 1, 'walking'), 0, 'quarters'), 1, 'quarters');
    const plan = buildExercise(lineSpec(draft));
    const timeline = buildTimeline(plan);
    const degrees = (bar: number) => timeline.steps.filter(step => step.bar === bar && step.note !== null).map(step => plan.notes[step.note!].degree ?? '-').join(' ');
    // Такты 0 и 1 — один аккорд C7: первый ход вверх, второй вниз; после второго аккорд меняется — доля 4 заменена подходом.
    expect([degrees(0), degrees(1)]).toEqual(['1 3 5 6', 'b7 6 5 -']);
  });
});
