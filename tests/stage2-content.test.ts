import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec, RIFF_IDS, validateExerciseSpec } from '../src/exercises';
import { buildTimeline, rhythmPatternsFor } from '../src/exercises/rhythm';

/* ---------- Содержание этапа 2 (R-028, A6.2, B4): круг кварт и риффы; контрольные примеры выписаны в требованиях вручную ---------- */

describe('круг кварт на струне (A6.2)', () => {
  const run = (string: string) => buildExercise(createExerciseSpec('string-fourths', { string } as never));
  const pairs = (string: string) => run(string).notes.map(note => `${note.id} ${note.name}`).join(', ');

  it('струна E: C2 F1 B♭1 E♭2 A♭1 D♭2 G♭1 B1 E1 A1 D2 G1 на ладах 8 1 6 11 4 9 2 7 0 5 10 3', () => {
    expect(pairs('E')).toBe('E:8 C2, E:1 F1, E:6 B♭1, E:11 E♭2, E:4 A♭1, E:9 D♭2, E:2 G♭1, E:7 B1, E:0 E1, E:5 A1, E:10 D2, E:3 G1');
  });
  it('струна A: A:3 C2, A:8 F2, A:1 B♭1, A:6 E♭2, A:11 A♭2, A:4 D♭2, A:9 G♭2, A:2 B1, A:7 E2, A:0 A1, A:5 D2, A:10 G2', () => {
    expect(pairs('A')).toBe('A:3 C2, A:8 F2, A:1 B♭1, A:6 E♭2, A:11 A♭2, A:4 D♭2, A:9 G♭2, A:2 B1, A:7 E2, A:0 A1, A:5 D2, A:10 G2');
  });
  it('лады 0–11 на любой струне; пальцы и ступени не назначаются; один сегмент; все ритмы; программа — четверти по три такта', () => {
    for (const string of ['E', 'A', 'D', 'G']) {
      const plan = run(string);
      expect(plan.notes).toHaveLength(12);
      expect(plan.notes.every(note => note.fret >= 0 && note.fret <= 11 && note.finger === null && note.degree === null && note.gate === null)).toBe(true);
      expect(plan.segments.map(segment => segment.label)).toEqual([`Струна ${string} · круг кварт · лады 0–11`]);
      expect(new Set(plan.notes.map(note => note.midi % 12)).size).toBe(12);
    }
    const plan = run('E');
    expect(rhythmPatternsFor(plan)).toContain('quarters');
    expect(buildTimeline(plan, { pattern: 'quarters' }).bars).toBe(3);
  });
});

describe('риффы этапа 2 (B4)', () => {
  const riff = (id: string, root: string) => buildExercise(createExerciseSpec('riff', { riff: id, root } as never));
  const bar = (plan: ReturnType<typeof riff>, index: number) => plan.notes.filter(note => note.segment === index);
  const shape = (plan: ReturnType<typeof riff>, index: number) => bar(plan, index).map(note => `${note.id} ${note.name}`).join(', ');
  const fingers = (plan: ReturnType<typeof riff>, index: number) => bar(plan, index).map(note => note.finger ?? '-').join(' ');
  const events = (plan: ReturnType<typeof riff>) => {
    const timeline = buildTimeline(plan);
    return Array.from({ length: timeline.bars }, (_, index) => timeline.steps.filter(step => step.bar === index).map(step => `${step.beatInBar * 4}/${step.grids}${step.note === null ? ':—' : ''}`).join(' '));
  };

  it('каталог: фигуры этапа 2 входят в список; риффы без привязки к песне — категория «Риффы», завершения тоникой нет', () => {
    expect(RIFF_IDS).toEqual(expect.arrayContaining(['rock-eighths', 'approach-eighths', 'disco-octaves', 'penta-a']));
    for (const id of RIFF_IDS) expect(riff(id, 'C')).toMatchObject({ category: 'riffs', cadence: 'none', overlap: 'none' });
  });

  it('approach-eighths, C: тоника ×5 и подход (F♯1, G♯1, E2, B1); ритм 4 2 2 4 2 2', () => {
    const plan = riff('approach-eighths', 'C');
    expect(plan.segments.map(segment => segment.label)).toEqual(['C · I', 'G · V', 'Am · vi', 'F · IV']);
    const tonic = (index: number) => bar(plan, index).slice(0, 5).map(note => note.id);
    expect([0, 1, 2, 3].map(tonic)).toEqual([Array(5).fill('A:3'), Array(5).fill('E:3'), Array(5).fill('E:5'), Array(5).fill('A:8')]);
    expect([0, 1, 2, 3].map(index => `${bar(plan, index)[5].id} ${bar(plan, index)[5].name}`)).toEqual(['E:2 F♯1', 'E:4 G♯1', 'A:7 E2', 'A:2 B1']);
    expect(bar(plan, 0)[5]).toMatchObject({ finger: null, degree: null });
    expect(events(plan)[0]).toBe('0/4 4/2 6/2 8/4 12/2 14/2');
  });

  it('disco-octaves, C: тоника восьмая, октава шестнадцатая, шестнадцатая пауза на каждую долю; пальцы 2 и 4 (1 и 3 у Am)', () => {
    const plan = riff('disco-octaves', 'C');
    expect(plan.segments.map(segment => segment.label)).toEqual(['C · I', 'Am · vi', 'F · IV', 'G · V']);
    const [first, octave] = [bar(plan, 0)[0], bar(plan, 0)[1]];
    expect([first.id, first.name, first.finger, octave.id, octave.name, octave.finger]).toEqual(['A:3', 'C2', 2, 'G:5', 'C3', 4]);
    const pairOf = (index: number) => { const notes = bar(plan, index); return `${notes[0].id}→${notes[1].id} ${notes[0].finger},${notes[1].finger}`; };
    expect([0, 1, 2, 3].map(pairOf)).toEqual(['A:3→G:5 2,4', 'E:5→D:7 1,3', 'A:8→G:10 2,4', 'A:10→G:12 2,4']);
    expect(bar(plan, 0)).toHaveLength(8);
    expect(events(plan)[0]).toBe('0/2 2/1 3/1:— 4/2 6/1 7/1:— 8/2 10/1 11/1:— 12/2 14/1 15/1:—');
    // События нечётной длины — шаффл недопустим.
    expect(rhythmPatternsFor(plan)).toEqual(['eighths']);
  });

  it('penta-a, A: форма A пентатоники от тоники каждого аккорда; длительности 4 2 2 4 2 2, ступени 1 ♭3 4 5 ♭7 5, пальцы 1 4 1 3 1 3', () => {
    const plan = riff('penta-a', 'A');
    expect(plan.segments.map(segment => segment.label)).toEqual(['Am · i', 'Dm · iv', 'Em · v', 'Am · i']);
    expect(shape(plan, 0)).toBe('E:5 A1, E:8 C2, A:5 D2, A:7 E2, D:5 G2, A:7 E2');
    expect(shape(plan, 1)).toBe('A:5 D2, A:8 F2, D:5 G2, D:7 A2, G:5 C3, D:7 A2');
    expect(shape(plan, 2)).toBe('A:7 E2, A:10 G2, D:7 A2, D:9 B2, G:7 D3, D:9 B2');
    expect(shape(plan, 3)).toBe(shape(plan, 0));
    expect([0, 1, 2].map(index => bar(plan, index).map(note => note.degree).join(' '))).toEqual(Array(3).fill('1 b3 4 5 b7 5'));
    expect([0, 1, 2, 3].map(index => fingers(plan, index))).toEqual(Array(4).fill('1 4 1 3 1 3'));
    expect(events(plan)[0]).toBe('0/4 4/2 6/2 8/4 12/2 14/2');
    // Все события чётны — шаффл допустим.
    expect(rhythmPatternsFor(plan)).toEqual(['eighths', 'shuffle']);
  });

  it('тональность выбирается: penta-a в G даёт Gm · Cm · Dm · Gm; перенос сохраняет фигуру', () => {
    const plan = riff('penta-a', 'G');
    expect(plan.segments.map(segment => segment.label)).toEqual(['Gm · i', 'Cm · iv', 'Dm · v', 'Gm · i']);
    expect(plan.notes).toHaveLength(24);
    expect(validateExerciseSpec(createExerciseSpec('riff', { riff: 'penta-a', root: 'G' })).params).toEqual({ riff: 'penta-a', root: 'G' });
  });

  it('все 12 тоник: каждая фигура строится на ладах 1–24', () => {
    for (const root of ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']) for (const id of RIFF_IDS) {
      const plan = riff(id, root);
      expect(Math.min(...plan.notes.map(note => note.fret)), `${id} ${root}`).toBeGreaterThanOrEqual(1);
      expect(Math.max(...plan.notes.map(note => note.fret)), `${id} ${root}`).toBeLessThanOrEqual(24);
    }
  });
});
