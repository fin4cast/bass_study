import { describe, expect, it } from 'vitest';
import { buildExercise, configureSpec, createExerciseSpec } from '../src/exercises';
import { approachName, patternFits, toneName } from '../src/exercises/bars';

/* ---------- Последовательности и рисунки этапа 2 (R-028, B1.4, B2.2, B2.3) ---------- */

const run = (params: Record<string, unknown>) => buildExercise(createExerciseSpec('progression', params as never));
const bar = (plan: ReturnType<typeof run>, index: number) => plan.notes.filter(note => note.segment === index);
/** «подпись — позиция (нота)» первой ноты каждого такта; таблицы B1.4 выписаны в требованиях вручную. */
const tonics = (plan: ReturnType<typeof run>) => plan.segments.map((segment, index) => `${segment.label} — ${bar(plan, index)[0].id} (${bar(plan, index)[0].name})`);

describe('последовательности I–V–vi–IV, I–vi–IV–V, i–iv–v (B1.4)', () => {
  it('C, I–V–vi–IV — C A:3, G E:3, Am E:5, F A:8', () => {
    expect(tonics(run({ root: 'C', progression: 'I-V-vi-IV' }))).toEqual(['C · I — A:3 (C2)', 'G · V — E:3 (G1)', 'Am · vi — E:5 (A1)', 'F · IV — A:8 (F2)']);
  });
  it('C, I–vi–IV–V — C A:3, Am E:5, F A:8, G A:10', () => {
    expect(tonics(run({ root: 'C', progression: 'I-vi-IV-V' }))).toEqual(['C · I — A:3 (C2)', 'Am · vi — E:5 (A1)', 'F · IV — A:8 (F2)', 'G · V — A:10 (G2)']);
  });
  it('A, i–iv–v — Am E:5, Dm A:5, Em A:7, Am E:5 (ступени натурального минора)', () => {
    expect(tonics(run({ root: 'A', progression: 'i-iv-v' }))).toEqual(['Am · i — E:5 (A1)', 'Dm · iv — A:5 (D2)', 'Em · v — A:7 (E2)', 'Am · i — E:5 (A1)']);
  });
});

describe('рисунки r5b78 и r56 (B2.2): блюз в A, такты 1, 5, 9 — A7, D7, E7', () => {
  const blues = (pattern: string) => run({ root: 'A', progression: 'blues-12', pattern });
  const row = (plan: ReturnType<typeof run>, index: number) => ({
    ids: bar(plan, index).map(note => note.id).join(' '), names: bar(plan, index).map(note => note.name).join(' '),
    degrees: bar(plan, index).map(note => note.degree).join(' '), fingers: bar(plan, index).map(note => note.finger).join(' '),
  });
  it.each([
    [0, 'E:5 E:5 A:7 A:7 D:5 D:5 D:7 D:7', 'A1 A1 E2 E2 G2 G2 A2 A2'],
    [4, 'A:5 A:5 D:7 D:7 G:5 G:5 G:7 G:7', 'D2 D2 A2 A2 C3 C3 D3 D3'],
    [8, 'A:7 A:7 D:9 D:9 G:7 G:7 G:9 G:9', 'E2 E2 B2 B2 D3 D3 E3 E3'],
  ])('r5b78, такт %i', (index, ids, names) => {
    expect(row(blues('r5b78'), index)).toEqual({ ids, names, degrees: '1 1 5 5 b7 b7 1 1', fingers: '2 2 4 4 2 2 4 4' });
  });
  it.each([
    [0, 'E:5 E:5 A:7 A:7 D:4 D:4 A:7 A:7', 'A1 A1 E2 E2 F♯2 F♯2 E2 E2'],
    [4, 'A:5 A:5 D:7 D:7 G:4 G:4 D:7 D:7', 'D2 D2 A2 A2 B2 B2 A2 A2'],
    [8, 'A:7 A:7 D:9 D:9 G:6 G:6 D:9 D:9', 'E2 E2 B2 B2 C♯3 C♯3 B2 B2'],
  ])('r56, такт %i', (index, ids, names) => {
    expect(row(blues('r56'), index)).toEqual({ ids, names, degrees: '1 1 5 5 6 6 5 5', fingers: '2 2 4 4 1 1 4 4' });
  });
  it('r56 в миноре (Am): вместо 6 — ♭7, пальцы минорного семейства', () => {
    expect(row(run({ root: 'A', progression: 'i-iv-v', pattern: 'r56' }), 0)).toEqual({
      ids: 'E:5 E:5 A:7 A:7 D:5 D:5 A:7 A:7', names: 'A1 A1 E2 E2 G2 G2 E2 E2', degrees: '1 1 5 5 b7 b7 5 5', fingers: '1 1 3 3 1 1 3 3',
    });
  });
  it('maj7 берёт свою 7 вместо ♭7: Cmaj7 в ii–V–I — B2 на G:2', () => {
    const cmaj7 = bar(run({ root: 'C', progression: 'ii-V-I', pattern: 'r5b78' }), 2);
    expect(cmaj7.map(note => note.degree).join(' ')).toBe('1 1 5 5 7 7 1 1');
    expect(cmaj7[4].name).toBe('B2');
  });
});

describe('подход (B2.3): roots-approach и написание', () => {
  it('C, I–IV–V: тоника ×7 и подход E2, F♯2, B1, B1; последний такт — тоника ближайшей позиции E:8', () => {
    const plan = run({ root: 'C', pattern: 'roots-approach' });
    const shape = (index: number) => `${bar(plan, index).slice(0, 7).map(note => note.id).join(' ')} | ${bar(plan, index)[7].id} ${bar(plan, index)[7].name}`;
    expect([0, 1, 2, 3].map(shape)).toEqual([
      `${Array(7).fill('A:3').join(' ')} | A:7 E2`, `${Array(7).fill('A:8').join(' ')} | A:9 F♯2`,
      `${Array(7).fill('A:10').join(' ')} | E:7 B1`, `${Array(7).fill('E:8').join(' ')} | A:2 B1`,
    ]);
    expect(bar(plan, 0)[7]).toMatchObject({ finger: null, degree: null });
  });
  it('буква на одну ниже буквы цели, знак — до полутона; независимые примеры из требований', () => {
    const expected: [string, string][] = [['D', 'C♯'], ['A', 'G♯'], ['E', 'D♯'], ['G', 'F♯'], ['C', 'B'], ['F', 'E'], ['B♭', 'A'], ['E♭', 'D'], ['B', 'A♯'], ['F♯', 'E♯']];
    for (const [target, name] of expected) expect(approachName(target), `к ${target}`).toBe(name);
  });
  it('A, I–IV–V: закрытая — подходы к D, E и A пишутся C♯2, D♯2, G♯1 (не A♭)', () => {
    const plan = run({ root: 'A', pattern: 'roots-approach' });
    expect([0, 1, 2].map(index => bar(plan, index)[7].name)).toEqual(['C♯2', 'D♯2', 'G♯1']);
    expect(bar(run({ root: 'A', pattern: 'approach' }), 2)[7].name).toBe('G♯1');
  });
  it('A, I–IV–V: нижняя — подход к D снизу (C♯2), к тонике на открытой струне — сверху: F1 к E, B♭1 к A', () => {
    const plan = run({ root: 'A', pattern: 'roots-approach', position: 'low' });
    expect([0, 1, 2].map(index => `${bar(plan, index)[7].id} ${bar(plan, index)[7].name}`)).toEqual(['A:4 C♯2', 'E:1 F1', 'A:1 B♭1']);
    expect(approachName('A', true)).toBe('B♭');
    expect(approachName('E', true)).toBe('F');
  });
  it('тоны вне структуры пишутся по ступени от тоники аккорда: у A — F♯ и G, у E♭ — C и D♭', () => {
    expect([toneName('A', '6'), toneName('A', 'b7'), toneName('E♭', '6'), toneName('E♭', 'b7')]).toEqual(['F♯', 'G', 'C', 'D♭']);
    expect(toneName('A', '5')).toBeNull();
  });
});

describe('границы и допустимость', () => {
  it('все 12 тоник: новые последовательности и рисунки строятся на ладах 1–24', () => {
    for (const root of ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']) {
      for (const progression of ['I-V-vi-IV', 'I-vi-IV-V', 'i-iv-v'] as const) for (const pattern of ['roots', 'r5b78', 'r56', 'roots-approach'] as const) {
        const plan = run({ root, progression, pattern });
        expect(plan.notes, `${root} ${progression} ${pattern}`).toHaveLength(32);
        expect(Math.min(...plan.notes.map(note => note.fret))).toBeGreaterThanOrEqual(1);
        expect(Math.max(...plan.notes.map(note => note.fret))).toBeLessThanOrEqual(24);
      }
    }
  });
  it('r5b78 и r56 не строятся на уменьшённых аккордах (B2.1), остальные рисунки допустимы; буги — только мажорное трезвучие и доминантсептаккорд', () => {
    for (const structureId of ['diminished-triad', 'half-diminished-seventh'] as const) {
      expect([patternFits('r5b78', structureId), patternFits('r56', structureId), patternFits('roots-approach', structureId), patternFits('arpeggio', structureId)]).toEqual([false, false, true, true]);
    }
    expect(['major-triad', 'minor-triad', 'dominant-seventh', 'minor-seventh', 'major-seventh'].map(id => patternFits('r56', id as never))).toEqual([true, true, true, true, true]);
    expect(['major-triad', 'dominant-seventh', 'minor-triad', 'major-seventh'].map(id => patternFits('boogie', id as never))).toEqual([true, true, false, false]);
  });
  it('открытые струны — только тоники: r5b78 и roots-approach на open отклоняются', () => {
    expect(() => createExerciseSpec('progression', { progression: 'I-IV-V', pattern: 'r5b78', position: 'open' } as never)).toThrow(RangeError);
    expect(() => createExerciseSpec('progression', { root: 'A', progression: 'I-IV-V', pattern: 'roots-approach', position: 'open' } as never)).toThrow(RangeError);
  });
  it('смена рисунка у минорной последовательности сохраняет последовательность', () => {
    expect(configureSpec(createExerciseSpec('progression', { root: 'A', progression: 'i-iv-v' }), 'pattern', 'r56').params).toMatchObject({ progression: 'i-iv-v', pattern: 'r56' });
  });
});
