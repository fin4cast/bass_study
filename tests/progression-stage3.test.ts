import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec, PROGRESSION_IDS, PROGRESSION_PATTERNS, templateOptions } from '../src/exercises';
import { buildTimeline } from '../src/exercises/rhythm';
import { PATTERN_LABELS, PROGRESSION_LABELS } from '../src/ui/lesson/material';

/* ---------- Последовательности и рисунок этапа 3 (R-028, B1.4, B2.3): таблицы в требованиях выписаны вручную ---------- */

const run = (params: Record<string, unknown>) => buildExercise(createExerciseSpec('progression', params as never));
type Plan = ReturnType<typeof run>;
const bar = (plan: Plan, index: number) => plan.notes.filter(note => note.segment === index);
const tonics = (plan: Plan) => plan.segments.map((segment, index) => `${segment.label} — ${bar(plan, index)[0].id} (${bar(plan, index)[0].name})`);
const row = (plan: Plan, index: number, count = 8) => ({
  ids: bar(plan, index).slice(0, count).map(note => note.id).join(' '), names: bar(plan, index).slice(0, count).map(note => note.name).join(' '),
  degrees: bar(plan, index).slice(0, count).map(note => note.degree).join(' '), fingers: bar(plan, index).slice(0, count).map(note => note.finger ?? '-').join(' '),
});

describe('минорные последовательности (B1.4)', () => {
  it('A, i–iv — Am E:5, Dm A:5, Am E:5, Dm A:5', () => {
    expect(tonics(run({ root: 'A', progression: 'i-iv' }))).toEqual(['Am · i — E:5 (A1)', 'Dm · iv — A:5 (D2)', 'Am · i — E:5 (A1)', 'Dm · iv — A:5 (D2)']);
  });
  it('A, i–V–i — V мажорное: E на A:7; Am E:5 два раза подряд в конце', () => {
    expect(tonics(run({ root: 'A', progression: 'i-V-i' }))).toEqual(['Am · i — E:5 (A1)', 'E · V — A:7 (E2)', 'Am · i — E:5 (A1)', 'Am · i — E:5 (A1)']);
  });
  it('A, i–V–i, арпеджио: такт E · V — A:7 E2, D:6 G♯2, D:9 B2, D:6 G♯2; пальцы 2-1-4-1; ступени 1-3-5-3', () => {
    expect(row(run({ root: 'A', progression: 'i-V-i', pattern: 'arpeggio' }), 1, 4)).toEqual({ ids: 'A:7 D:6 D:9 D:6', names: 'E2 G♯2 B2 G♯2', degrees: '1 3 5 3', fingers: '2 1 4 1' });
  });
  it('A, i–VII–VI–V — Am E:5, G E:3, F A:8, E A:7', () => {
    expect(tonics(run({ root: 'A', progression: 'i-VII-VI-V' }))).toEqual(['Am · i — E:5 (A1)', 'G · VII — E:3 (G1)', 'F · VI — A:8 (F2)', 'E · V — A:7 (E2)']);
  });
  it('E, i–VII–VI–V — Em A:7, D A:5, C A:3, B A:2', () => {
    expect(tonics(run({ root: 'E', progression: 'i-VII-VI-V' }))).toEqual(['Em · i — A:7 (E2)', 'D · VII — A:5 (D2)', 'C · VI — A:3 (C2)', 'B · V — A:2 (B1)']);
  });
  it('A, i–VII–VI–V, нижняя: Am A:0, G E:3, F E:1, E E:0 — линия идёт вниз', () => {
    expect(tonics(run({ root: 'A', progression: 'i-VII-VI-V', position: 'low' }))).toEqual(['Am · i — A:0 (A1)', 'G · VII — E:3 (G1)', 'F · VI — E:1 (F1)', 'E · V — E:0 (E1)']);
  });
});

describe('«Трезвучия по ступеням» — diatonic (B1.4)', () => {
  const plan = run({ root: 'C', progression: 'diatonic', pattern: 'arpeggio' });
  it('восемь тактов с подписями из B1.2, vii° — Bdim', () => {
    expect(plan.segments.map(segment => segment.label)).toEqual(['C · I', 'Dm · ii', 'Em · iii', 'F · IV', 'G · V', 'Am · vi', 'Bdim · vii°', 'C · I']);
  });
  it.each([
    [0, 'A:3 D:2 D:5', 'C2 E2 G2', '2 1 4'],
    [1, 'A:5 A:8 D:7', 'D2 F2 A2', '1 4 3'],
    [2, 'A:7 A:10 D:9', 'E2 G2 B2', '1 4 3'],
    [3, 'A:8 D:7 D:10', 'F2 A2 C3', '2 1 4'],
    [4, 'A:10 D:9 D:12', 'G2 B2 D3', '2 1 4'],
    [5, 'A:12 A:15 D:14', 'A2 C3 E3', '1 4 3'],
    [6, 'A:14 A:17 D:15', 'B2 D3 F3', '1 4 2'],
    [7, 'A:15 D:14 D:17', 'C3 E3 G3', '2 1 4'],
  ])('C, diatonic, арпеджио, такт %i', (index, ids, names, fingers) => {
    expect(row(plan, index, 3)).toEqual({ ids, names, degrees: expect.any(String), fingers });
  });
  it('у уменьшённого трезвучия ступени 1, ♭3, ♭5', () => {
    expect(row(plan, 6, 3).degrees).toBe('1 b3 b5');
  });
  it('в нижней позиции у Bdim квинта уменьшённая: A:2 B1, A:5 D2, D:3 F2 (не F♯2)', () => {
    const low = run({ root: 'C', progression: 'diatonic', pattern: 'arpeggio', position: 'low' });
    expect(row(low, 6, 3)).toEqual({ ids: 'A:2 A:5 D:3', names: 'B1 D2 F2', degrees: '1 b3 b5', fingers: '1 4 2' });
  });
  it('рисунки r5b78, r56 и буги на уменьшённом аккорде отклоняются, остальные строятся', () => {
    for (const pattern of ['r5b78', 'r56', 'boogie'] as const) expect(() => createExerciseSpec('progression', { root: 'C', progression: 'diatonic', pattern } as never), pattern).toThrow(RangeError);
    for (const pattern of ['roots', 'root-fifth', 'octaves', 'arpeggio', 'approach', 'roots-approach', 'roots-passing'] as const) expect(() => run({ root: 'C', progression: 'diatonic', pattern }), pattern).not.toThrow();
  });
});

describe('тоники с проходящими — roots-passing (B2.3)', () => {
  it('C, I–IV–V, восьмые: тоника ×6 и две проходящие либо тоника ×8; ступени хвоста 2, 3 и 6, 5', () => {
    const plan = run({ root: 'C', pattern: 'roots-passing' });
    expect(row(plan, 0)).toEqual({ ids: 'A:3 A:3 A:3 A:3 A:3 A:3 A:5 A:7', names: 'C2 C2 C2 C2 C2 C2 D2 E2', degrees: '1 1 1 1 1 1 2 3', fingers: '2 2 2 2 2 2 - -' });
    expect(row(plan, 1).ids).toBe(Array(8).fill('A:8').join(' '));
    expect(row(plan, 2)).toEqual({ ids: 'A:10 A:10 A:10 A:10 A:10 A:10 E:12 E:10', names: 'G2 G2 G2 G2 G2 G2 E2 D2', degrees: '1 1 1 1 1 1 6 5', fingers: '2 2 2 2 2 2 - -' });
    expect(row(plan, 3).ids).toBe(Array(8).fill('E:8').join(' '));
  });
  it('G, I–IV–V: лад получается меньше 1 — нота уходит на струну E: E:5 (A1), A:2 (B1)', () => {
    expect(row(run({ root: 'G', pattern: 'roots-passing' }), 0).ids).toBe('E:3 E:3 E:3 E:3 E:3 E:3 E:5 A:2');
  });
  it('в нижней позиции лад 0 допустим: A, I–IV–V — A:2 B1, A:4 C♯2; к E — E:2 F♯1 и E:4 G♯1 (струна E)', () => {
    const plan = run({ root: 'A', pattern: 'roots-passing', position: 'low' });
    expect(bar(plan, 0).slice(6).map(note => `${note.id} ${note.name}`)).toEqual(['A:2 B1', 'A:4 C♯2']);
    expect(row(plan, 1).ids.split(' ').slice(6)).toEqual(['E:4', 'E:2']);
    expect(row(plan, 2).ids).toBe('E:0 E:0 E:0 E:0 E:0 E:0 E:2 E:4');
    expect(bar(plan, 2).slice(6).map(note => note.name)).toEqual(['F♯1', 'G♯1']);
  });
  it('в миноре гамма — натуральный минор: Am, i–iv–v, тоники A→D: B, C (не C♯)', () => {
    const plan = run({ root: 'A', progression: 'i-iv-v', pattern: 'roots-passing' });
    expect(bar(plan, 0).slice(6).map(note => note.name)).toEqual(['B1', 'C2']);
  });
  it('в четвертях проходящие встают на две последние доли; в восьмых — на две последние восьмые', () => {
    const plan = run({ root: 'C', pattern: 'roots-passing' });
    const quarters = buildTimeline(plan, { pattern: 'quarters' }).steps.slice(0, 4).map(step => plan.notes[step.note!].name);
    expect(quarters).toEqual(['C2', 'C2', 'D2', 'E2']);
    const eighths = buildTimeline(plan, { pattern: 'eighths' }).steps.slice(0, 8).map(step => plan.notes[step.note!].name);
    expect(eighths).toEqual(['C2', 'C2', 'C2', 'C2', 'C2', 'C2', 'D2', 'E2']);
  });
  it('открытые струны — только тоники: roots-passing на open отклоняется', () => {
    expect(() => createExerciseSpec('progression', { root: 'A', progression: 'I-IV-V', pattern: 'roots-passing', position: 'open' } as never)).toThrow(RangeError);
  });
});

describe('границы', () => {
  const ROOTS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  it('все 12 тоник × новые последовательности × рисунки × позиции строятся на ладах 0–24 (закрытая — 1–24)', () => {
    for (const root of ROOTS) for (const progression of ['i-iv', 'i-V-i', 'i-VII-VI-V', 'diatonic'] as const) {
      for (const pattern of ['roots', 'arpeggio', 'roots-passing'] as const) for (const position of ['closed', 'low'] as const) {
        const plan = run({ root, progression, pattern, position });
        const label = `${root} ${progression} ${pattern} ${position}`;
        expect(plan.notes, label).toHaveLength(progression === 'diatonic' ? 64 : 32);
        expect(Math.min(...plan.notes.map(note => note.fret)), label).toBeGreaterThanOrEqual(position === 'closed' ? 1 : 0);
        expect(Math.max(...plan.notes.map(note => note.fret)), label).toBeLessThanOrEqual(24);
      }
    }
  });
  it('roots-passing строится для всех старых последовательностей во всех тональностях', () => {
    for (const root of ROOTS) for (const progression of ['I-IV-V', 'ii-V-I', 'blues-12', 'I-V-vi-IV', 'I-vi-IV-V', 'i-iv-v'] as const) for (const position of ['closed', 'low'] as const) {
      expect(() => run({ root, progression, pattern: 'roots-passing', position }), `${root} ${progression} ${position}`).not.toThrow();
    }
  });
});

describe('подписи', () => {
  it('у каждой последовательности и рисунка есть подпись — в каталоге и в экранных словарях, и они совпадают', () => {
    const options = Object.fromEntries(templateOptions('progression').map(entry => [entry.param, entry.values]));
    for (const id of PROGRESSION_IDS) {
      expect(PROGRESSION_LABELS[id], id).toBeTruthy();
      expect(options.progression.find(value => value.value === id)?.label, id).toBe(PROGRESSION_LABELS[id]);
    }
    for (const id of PROGRESSION_PATTERNS) {
      expect(PATTERN_LABELS[id], id).toBeTruthy();
      expect(options.pattern.find(value => value.value === id)?.label, id).toBe(PATTERN_LABELS[id]);
    }
  });
});
