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
  it('последовательность: такт — аккорд; петля по тактам в шагах; рисунки из требований, а не только восьмые', () => {
    const progression = plan('progression');
    const timeline = buildTimeline(progression);
    expect(timeline.pattern).toBe('eighths');
    expect(timeline.bars).toBe(4);
    expect(timeline.steps.filter(step => step.bar === 1).every(step => progression.notes[step.note!].segment === 1)).toBe(true);
    expect(barStepRange(timeline, 1, 3)).toEqual({ from: 8, toExclusive: 24 });
    expect(buildTimeline(progression, { pattern: 'shuffle' }).swing).toBe(66);
    expect(buildTimeline(progression, { pattern: 'quarters' }).pattern).toBe('quarters');
    expect(buildTimeline(progression, { pattern: 'quarters' }).bars).toBe(4);
  });
});

/* ---------- Ячейки рисунка: нота, пауза, лига (R-028, A2) ---------- */

type Pattern = Parameters<typeof buildTimeline>[1] extends infer O ? NonNullable<O> extends { pattern?: infer P } ? NonNullable<P> : never : never;

/** Шкала в записи требований: `нота@начало(длина)`, `п` — пауза, `~` — лига; `|` — тактовая черта. */
function shape(timeline: ReturnType<typeof buildTimeline>): string {
  return timeline.steps.map((step, index) => {
    const head = index > 0 && step.start % 16 === 0 ? '| ' : '';
    const body = step.note === null ? 'п' : `${step.tie ? '~' : ''}n${step.note}`;
    return `${head}${body}@${step.start}(${step.grids})`;
  }).join(' ');
}

/** Плоский материал из `count` нот без тоники и ступеней — для контрольных шкал A2.6. */
function flat(count: number) {
  const spec = createExerciseSpec('chromatic-position');
  return { spec, cadence: 'none' as const, segments: ['материал'], notes: Array.from({ length: count }, (_, index) => ({ midi: 40 + index, degree: null, segment: 0 })) } as unknown as Parameters<typeof buildTimeline>[0];
}

describe('рисунки с паузами и лигами (A2)', () => {
  it('каталог: сумма ячеек делит такт, первая ячейка — нота, лига только после ноты или лиги, свинг только у одной восьмой', async () => {
    const { RHYTHM_PATTERNS } = await import('../src/exercises/rhythm');
    expect(RHYTHM_PATTERNS.map(pattern => pattern.id)).toEqual([
      'eighths', 'quarters', 'sixteenths', 'syncopation', 'shuffle',
      'quarter-two-eighths', 'note-rest', 'quarter-rest', 'eighth-rest', 'tied-syncopation',
    ]);
    for (const pattern of RHYTHM_PATTERNS) {
      const sum = pattern.cells.reduce((total, cell) => total + cell.grids, 0);
      expect([1, 2, 4, 8, 16], pattern.id).toContain(sum);
      expect(pattern.cells[0].kind, pattern.id).toBe('note');
      pattern.cells.forEach((cell, index) => { if (cell.kind === 'tie') expect(['note', 'tie'], pattern.id).toContain(pattern.cells[index - 1].kind); });
      if (pattern.swing !== 50) expect(pattern.cells.map(cell => `${cell.kind}${cell.grids}`), pattern.id).toEqual(['note2']);
    }
  });

  // Материал А: шесть нот, без тоники (A2.6, посчитано вручную в требованиях).
  it.each<[Pattern, string]>([
    ['quarters', 'n0@0(4) n1@4(4) n2@8(4) n3@12(4) | n4@16(4) n5@20(4) п@24(8)'],
    ['quarter-two-eighths', 'n0@0(4) n1@4(2) n2@6(2) n3@8(4) n4@12(2) n5@14(2)'],
    ['note-rest', 'n0@0(4) п@4(4) n1@8(4) п@12(4) | n2@16(4) п@20(4) n3@24(4) п@28(4) | n4@32(4) п@36(4) n5@40(4) п@44(4)'],
    ['quarter-rest', 'n0@0(4) n1@4(4) n2@8(4) п@12(4) | n3@16(4) n4@20(4) n5@24(4) п@28(4)'],
    ['eighth-rest', 'n0@0(4) п@4(2) n1@6(2) n2@8(4) п@12(2) n3@14(2) | n4@16(4) п@20(2) n5@22(2) п@24(8)'],
    ['tied-syncopation', 'n0@0(4) n1@4(2) n2@6(2) ~n2@8(2) n3@10(2) n4@12(4) | n5@16(4) п@20(12)'],
  ])('шесть нот, рисунок %s: %s', (pattern, expected) => {
    expect(shape(buildTimeline(flat(6), { pattern }))).toBe(expected);
  });

  // Материал Б: пентатоника A, форма A — 14 нот и завершение тоникой A1 (нота 0).
  it('пентатоника, «нота — пауза»: нота k на 8k, завершение A1 на 112 и пауза до конца 8-го такта', () => {
    const form = plan('pentatonic-form');
    const timeline = buildTimeline(form, { pattern: 'note-rest' });
    expect(timeline.bars).toBe(8);
    const notes = timeline.steps.filter(step => step.note !== null && !step.landing);
    expect(notes.map(step => [step.note, step.start, step.grids])).toEqual(Array.from({ length: 14 }, (_, k) => [k, 8 * k, 4]));
    const landing = timeline.steps.find(step => step.landing)!;
    expect([landing.note, landing.start, landing.grids]).toEqual([0, 112, 4]);
    expect(timeline.steps.at(-1)).toMatchObject({ note: null, start: 116, grids: 12 });
  });
  it('пентатоника, «синкопа с лигой»: такты 0 и 1 — ноты 0–4 и 5–9, в такте 2 лига у ноты 12 и завершение', () => {
    const form = plan('pentatonic-form');
    const timeline = buildTimeline(form, { pattern: 'tied-syncopation' });
    expect(timeline.bars).toBe(3);
    const attacks = (bar: number) => timeline.steps.filter(step => step.bar === bar && step.note !== null && !step.tie).map(step => step.note);
    expect(attacks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(attacks(1)).toEqual([5, 6, 7, 8, 9]);
    expect(timeline.steps.filter(step => step.bar === 2).map(step => `${step.tie ? '~' : ''}${step.note}@${step.start}(${step.grids})${step.landing ? 'L' : ''}`))
      .toEqual(['10@32(4)', '11@36(2)', '12@38(2)', '~12@40(2)', '13@42(2)', '0@44(4)L']);
  });

  // Материал В: одна нота, повторённая n раз (`pulse-note`).
  it.each<[number, Pattern, number, string]>([
    [16, 'quarters', 4, ''], [16, 'eighths', 2, ''], [16, 'sixteenths', 1, ''],
    [16, 'quarter-two-eighths', 3, 'n15@40(4) п@44(4)'],
    [8, 'note-rest', 4, 'n7@56(4) п@60(4)'],
    [32, 'sixteenths', 2, ''],
  ])('%i нот, рисунок %s — %i тактов', (count, pattern, bars, tail) => {
    const timeline = buildTimeline(flat(count), { pattern });
    expect(timeline.bars).toBe(bars);
    if (tail) expect(shape(timeline).endsWith(tail)).toBe(true);
  });

  it('лига — продолжение той же ноты: без атаки и без своего номера; эхо копирует паузы и лиги', () => {
    const timeline = buildTimeline(flat(6), { pattern: 'tied-syncopation', echo: true });
    const first = timeline.steps.filter(step => step.bar === 0), echo = timeline.steps.filter(step => step.bar === 1);
    expect(first.map(step => [step.note, step.grids, step.tie])).toEqual(echo.map(step => [step.note, step.grids, step.tie]));
    expect(echo.every(step => !step.audible && step.echo)).toBe(true);
    const tied = first.find(step => step.tie)!;
    expect(first[first.indexOf(tied) - 1].note).toBe(tied.note);
  });
});

/* ---------- Ритм последовательности: формы Q и E, хвост (R-028, B3) ---------- */

describe('ноты такта последовательности по правилу B3', () => {
  const bar = (p: ReturnType<typeof plan>, pattern: Pattern, index = 0) => buildTimeline(p, { pattern }).steps.filter(step => step.bar === index)
    .map(step => step.note === null ? 'п' : `${step.tie ? '~' : ''}${p.notes[step.note].name}`);
  const row = (text: string) => text.split(' ');

  // Таблица B3 (`C`, `I-IV-V`, такт 1: тоника A:3 (C2), квинта D:5 (G2)) — посчитана в требованиях вручную.
  it.each<[Pattern, string, string]>([
    ['quarters', 'C2 C2 C2 C2', 'C2 G2 C2 G2'],
    ['eighths', 'C2 C2 C2 C2 C2 C2 C2 C2', 'C2 C2 G2 G2 C2 C2 G2 G2'],
    ['shuffle', 'C2 C2 C2 C2 C2 C2 C2 C2', 'C2 C2 G2 G2 C2 C2 G2 G2'],
    ['quarter-rest', 'C2 C2 C2 п', 'C2 G2 C2 п'],
    ['syncopation', 'C2 C2 C2 C2 C2 C2', 'C2 C2 G2 C2 C2 G2'],
    ['sixteenths', 'C2 C2 C2 C2 C2 C2 C2 C2 C2 C2 C2 C2 C2 C2 C2 C2', 'C2 C2 C2 C2 G2 G2 G2 G2 C2 C2 C2 C2 G2 G2 G2 G2'],
  ])('%s: тоники и «тоника и квинта»', (pattern, roots, rootFifth) => {
    expect(bar(plan('progression', { root: 'C' }), pattern)).toEqual(row(roots));
    expect(bar(plan('progression', { root: 'C', pattern: 'root-fifth' }), pattern)).toEqual(row(rootFifth));
  });

  it('арпеджио: форма Q — первые четыре ноты, форма E — по восьмой; ступени не зависят от рисунка', () => {
    const arpeggio = plan('progression', { root: 'C', pattern: 'arpeggio' });
    expect(bar(arpeggio, 'quarters')).toEqual(row('C2 E2 G2 E2'));
    expect(bar(arpeggio, 'eighths')).toEqual(row('C2 E2 G2 E2 C2 E2 G2 E2'));
  });
  it('подход ставится на последнюю атаку такта вместо ноты формы; первую атаку не заменяет', () => {
    const approach = plan('progression', { root: 'C', pattern: 'approach' });
    const ids = (pattern: Pattern) => buildTimeline(approach, { pattern }).steps.filter(step => step.bar === 0 && step.note !== null).map(step => approach.notes[step.note!].id);
    // Тоника C — A:3, терция D:2, квинта D:5, подход к F (A:8) — A:7.
    expect(ids('quarters')).toEqual(['A:3', 'D:2', 'D:5', 'A:7']);
    expect(ids('eighths').at(-1)).toBe('A:7');
    expect(ids('quarter-rest')).toEqual(['A:3', 'D:2', 'A:7']);
    expect(ids('note-rest')).toEqual(['A:3', 'A:7']);
  });
  it('буги и октавы: форма Q берёт те же позиции, что форма E', () => {
    expect(bar(plan('progression', { root: 'C', progression: 'blues-12', pattern: 'boogie' }), 'quarters').filter(name => name !== 'п')).toHaveLength(4);
    const octaves = plan('progression', { root: 'C', pattern: 'octaves' });
    expect(bar(octaves, 'quarters')).toEqual(row('C2 C3 C2 C3'));
  });
  it('лига рисунка в такте последовательности продолжает ноту без новой атаки, пауза не берёт ноту', () => {
    const roots = plan('progression', { root: 'C', pattern: 'root-fifth' });
    // Синкопа с лигой: атаки на 0, 4, 6, 10, 12 шестнадцатых → места формы E 0, 2, 3, 5, 6 (1 5 5 1 5); лига на 8-й продолжает ноту 6-й.
    expect(bar(roots, 'tied-syncopation')).toEqual(row('C2 G2 G2 ~G2 C2 G2'));
  });
});

describe('контрольные шкалы A2.6 на настоящих шаблонах', () => {
  it('материал А — «Ноты на струне» по умолчанию (шесть нот, тоники нет): шесть рисунков', () => {
    const naturals = plan('string-naturals');
    expect(naturals.notes).toHaveLength(6);
    expect(shape(buildTimeline(naturals, { pattern: 'quarters' }))).toBe('n0@0(4) n1@4(4) n2@8(4) n3@12(4) | n4@16(4) n5@20(4) п@24(8)');
    expect(shape(buildTimeline(naturals, { pattern: 'tied-syncopation' }))).toBe('n0@0(4) n1@4(2) n2@6(2) ~n2@8(2) n3@10(2) n4@12(4) | n5@16(4) п@20(12)');
    expect(shape(buildTimeline(naturals, { pattern: 'eighth-rest' }))).toBe('n0@0(4) п@4(2) n1@6(2) n2@8(4) п@12(2) n3@14(2) | n4@16(4) п@20(2) n5@22(2) п@24(8)');
  });
  it.each<[number, Pattern, number, string]>([
    [16, 'quarters', 4, ''], [16, 'eighths', 2, ''], [16, 'sixteenths', 1, ''],
    [16, 'quarter-two-eighths', 3, 'n15@40(4) п@44(4)'],
    [8, 'note-rest', 4, 'n7@56(4) п@60(4)'],
    [32, 'sixteenths', 2, ''],
  ])('материал В — «Пульс на одной ноте», %i нот, рисунок %s: %i тактов', (notes, pattern, bars, tail) => {
    const pulse = plan('pulse-note', { notes });
    const timeline = buildTimeline(pulse, { pattern });
    expect(timeline.bars).toBe(bars);
    if (tail) expect(shape(timeline).endsWith(tail)).toBe(true);
  });
});

describe('подход рисунка «арпеджио и подходы» звучит один раз', () => {
  it('шестнадцатые: четырнадцатая атака — нота арпеджио, подход — только последняя', () => {
    const approach = plan('progression', { root: 'C', pattern: 'approach' });
    const ids = buildTimeline(approach, { pattern: 'sixteenths' }).steps.filter(step => step.bar === 0).map(step => approach.notes[step.note!].id);
    // Тоника C — A:3, терция D:2, квинта D:5; арпеджио 1-3-5-3-1-3-5-3, каждая нота дважды; подход к F — A:7 на последней атаке.
    expect(ids).toEqual(['A:3', 'A:3', 'D:2', 'D:2', 'D:5', 'D:5', 'D:2', 'D:2', 'A:3', 'A:3', 'D:2', 'D:2', 'D:5', 'D:5', 'D:2', 'A:7']);
  });
});

describe('рифф: ритм задан материалом (R-028, B4)', () => {
  it('рок-восьмые: четыре такта; в последнем такте четвертная нота и четвертная пауза', () => {
    const riff = plan('riff');
    const timeline = buildTimeline(riff);
    expect(timeline.bars).toBe(4);
    const last = timeline.steps.filter(step => step.bar === 3).map(step => [step.note === null ? null : 'нота', step.start % 16, step.grids]);
    expect(last).toEqual([['нота', 0, 2], ['нота', 2, 2], ['нота', 4, 2], ['нота', 6, 2], ['нота', 8, 4], [null, 12, 4]]);
    expect(timeline.steps.filter(step => step.bar === 0).map(step => step.grids)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
  });
  it('доступные рисунки: восьмые и шаффл (все события чётны); у фрагмента песни — только ритм партитуры', async () => {
    const { rhythmPatternsFor } = await import('../src/exercises/rhythm');
    expect(rhythmPatternsFor(plan('riff'))).toEqual(['eighths', 'shuffle']);
    expect(buildTimeline(plan('riff'), { pattern: 'shuffle' }).swing).toBe(66);
    expect(buildTimeline(plan('riff'), { pattern: 'quarters' }).pattern).toBe('eighths');
    expect(rhythmPatternsFor(plan('song-fragment'))).toEqual(['eighths']);
  });
});
