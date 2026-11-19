import { describe, expect, it } from 'vitest';
import { checkSeries } from '../src/practice/check-series';
import { lineSpec, newLineDraft, setBarPattern } from '../src/practice/line-builder';
import { materialId } from '../src/practice/material';
import { PROGRAM } from '../src/practice/program-data';
import { composeDay, evaluateProgram, lineFacts, stepRefs, type ProgramFacts } from '../src/practice/program';
import type { PlayRecord } from '../src/practice/results';

/**
 * Данные этапа 2 против таблицы R-028 «Этап 2. Паттерны и первая форма». Блоки, шаги и числа вариантов выписаны из таблицы
 * независимо от `program-data.ts`; позиция последовательности не названа — тональность в нижней позиции, затем в закрытой.
 */
const STAGE_2: readonly (readonly [string, string, string, number])[] = [
  ['t2-length', 't2-length.quarters', 'play', 3], ['t2-length', 't2-length.eighths', 'play', 3], ['t2-length', 't2-length.fretted', 'play', 2],
  ['t2-spider', 't2-spider.1234', 'play', 2], ['t2-spider', 't2-spider.1324', 'play', 2], ['t2-spider', 't2-spider.1243', 'play', 2], ['t2-spider', 't2-spider.diagonal', 'play', 2], ['t2-spider', 't2-spider.shift', 'play', 4],
  ['f2-dg', 'f2-dg.naturals', 'play', 2], ['f2-dg', 'f2-dg.name-note', 'check', 0],
  ['f2-all', 'f2-all.note', 'play', 6], ['f2-all', 'f2-all.fourths', 'play', 2], ['f2-all', 'f2-all.find-all', 'check', 0], ['f2-all', 'f2-all.name-note', 'check', 0],
  ['f2-penta', 'f2-penta.form', 'play', 3], ['f2-penta', 'f2-penta.groups', 'play', 3], ['f2-penta', 'f2-penta.find-degree', 'check', 0],
  ['h2-rhythm', 'h2-rhythm.eighth-rest', 'play', 6], ['h2-rhythm', 'h2-rhythm.tied', 'play', 6], ['h2-rhythm', 'h2-rhythm.shuffle', 'play', 6],
  ['h2-blues', 'h2-blues.root-fifth', 'play', 6], ['h2-blues', 'h2-blues.r5b78', 'play', 6], ['h2-blues', 'h2-blues.r56', 'play', 6], ['h2-blues', 'h2-blues.name-degree', 'check', 0],
  ['h2-approach', 'h2-approach.pop1', 'play', 6], ['h2-approach', 'h2-approach.pop2', 'play', 6], ['h2-approach', 'h2-approach.riff', 'play', 3], ['h2-approach', 'h2-approach.disco', 'play', 3],
  ['h2-triad', 'h2-triad.quarters', 'play', 6], ['h2-triad', 'h2-triad.eighths', 'play', 6], ['h2-triad', 'h2-triad.progression', 'play', 6], ['h2-triad', 'h2-triad.name-degree', 'check', 0],
  ['h2-own', 'h2-own.riff', 'play', 3], ['h2-own', 'h2-own.own', 'line', 0], ['h2-own', 'h2-own.song', 'song', 0],
];

describe('данные этапа 2 по таблице R-028', () => {
  const refs = stepRefs(PROGRAM);
  const stage = refs.filter(ref => PROGRAM.stages[1].blocks.some(block => block.id === ref.block.id));
  const stepOf = (id: string) => refs.find(ref => ref.step.id === id)!.step;
  const variants = (id: string) => { const step = stepOf(id); return step.kind === 'play' ? step.variants.map(materialId) : []; };
  const checkOf = (id: string) => { const step = stepOf(id); return step.kind === 'check' ? step.check : null; };

  it('этап 2 идёт вторым, этап 1 не тронут', () => {
    expect(PROGRAM.stages.map(item => item.number).slice(0, 2)).toEqual([1, 2]);
    expect(PROGRAM.stages[1].title).toBe('Паттерны и первая форма');
  });
  it('блоки и шаги по порядку таблицы, число вариантов каждого шага', () => {
    expect(stage.map(ref => [ref.block.id, ref.step.id, ref.step.kind, ref.step.kind === 'play' ? ref.step.variants.length : 0])).toEqual(STAGE_2.map(row => [...row]));
  });
  it('блоки по линиям: техника, гриф, аккорды и линии; карточки блоков из таблицы', () => {
    const block = (id: string) => PROGRAM.stages[1].blocks.find(item => item.id === id)!;
    expect(['t2-length', 't2-spider'].map(id => block(id).line)).toEqual(['technique', 'technique']);
    expect(['f2-dg', 'f2-all', 'f2-penta'].map(id => block(id).line)).toEqual(['fretboard', 'fretboard', 'fretboard']);
    expect(['h2-rhythm', 'h2-blues', 'h2-approach', 'h2-triad', 'h2-own'].map(id => block(id).line)).toEqual(Array(5).fill('chords'));
    expect(block('t2-length').cards).toEqual(['legato-staccato']);
    expect(block('f2-all').cards).toEqual(['accidentals', 'unison']);
    expect(block('f2-penta').cards).toEqual(['degree', 'pentatonic']);
    expect(block('h2-rhythm').cards).toEqual(['durations-rests', 'tie-syncopation']);
    expect(block('h2-triad').cards).toEqual(['triad']);
    for (const id of ['t2-spider', 'f2-dg', 'h2-blues', 'h2-approach', 'h2-own']) expect(block(id).cards, `у блока ${id} карточек нет`).toEqual([]);
  });
  it('варианты в порядке таблицы: струны E, A, D; пауки с 5-го и 7-го лада; D и G; круг кварт на E и A; формы A в Am, Bm, Gm; риффы', () => {
    expect(variants('t2-length.quarters')).toEqual(['E', 'A', 'D'].map(string => `long-short.${string}.5`));
    expect(variants('t2-spider.1324')).toEqual(['spider.5.5.1324.straight', 'spider.7.5.1324.straight']);
    expect(variants('t2-spider.diagonal')).toEqual(['spider.5.5.1234.diagonal', 'spider.7.5.1234.diagonal']);
    expect(variants('t2-length.fretted')).toEqual(['string-crossing.adjacent.5', 'string-crossing.skip.5']);
    expect(variants('t2-spider.shift')).toEqual(['E', 'A', 'D', 'G'].map(string => `position-shift.${string}.3.2.1`));
    expect(variants('f2-dg.naturals')).toEqual(['string-naturals.D.12', 'string-naturals.G.12']);
    expect(variants('f2-all.note')).toEqual(['C', 'G', 'D', 'A', 'F', 'Bb'].map(note => `note-all-positions.${note}`));
    expect(variants('f2-all.fourths')).toEqual(['string-fourths.E', 'string-fourths.A']);
    expect(variants('f2-penta.form')).toEqual(['A', 'B', 'G'].map(root => `pentatonic-form.${root}.minor-pentatonic.penta-a`));
    expect(variants('h2-own.riff')).toEqual(['A', 'E', 'G'].map(root => `riff.penta-a.${root}`));
    expect(variants('h2-approach.riff')).toEqual(['C', 'G', 'D'].map(root => `riff.approach-eighths.${root}`));
    expect(variants('h2-approach.disco')).toEqual(['C', 'G', 'D'].map(root => `riff.disco-octaves.${root}`));
  });
  it('позиция не названа: каждая тональность в нижней позиции, затем в закрытой', () => {
    expect(variants('h2-blues.r5b78')).toEqual([
      ...['A', 'E', 'G'].map(root => `progression.${root}.blues-12.r5b78.low`), ...['A', 'E', 'G'].map(root => `progression.${root}.blues-12.r5b78.closed`),
    ]);
    expect(variants('h2-approach.pop1').slice(0, 3)).toEqual(['C', 'G', 'D'].map(root => `progression.${root}.I-V-vi-IV.roots-approach.low`));
    expect(variants('h2-approach.pop2').slice(3)).toEqual(['C', 'G', 'D'].map(root => `progression.${root}.I-vi-IV-V.roots-approach.closed`));
    expect(variants('h2-triad.progression').slice(3)).toEqual(['G', 'A', 'C'].map(root => `progression.${root}.I-IV-V.arpeggio.closed`));
    expect(variants('h2-triad.progression').slice(0, 3)).toEqual(['G', 'A', 'C'].map(root => `progression.${root}.I-IV-V.arpeggio.low`));
    // Три шага ритма — одни и те же I–IV–V тониками в G, A, C: сначала нижняя позиция, затем закрытая.
    for (const id of ['h2-rhythm.eighth-rest', 'h2-rhythm.tied', 'h2-rhythm.shuffle']) {
      expect(variants(id)).toEqual([...['G', 'A', 'C'].map(root => `progression.${root}.I-IV-V.roots.low`), ...['G', 'A', 'C'].map(root => `progression.${root}.I-IV-V.roots.closed`)]);
    }
  });
  it('арпеджио 1–3–5–8: мажор и минор каждой тоники C, G, A по очереди', () => {
    expect(variants('h2-triad.quarters')).toEqual(['C', 'G', 'A'].flatMap(root => ['major-triad', 'minor-triad'].map(structure => `arpeggio-1358.${root}.${structure}.compact-e`)));
  });
  it('«как играть» из таблицы: четверти, восьмая пауза, синкопа с лигой, шаффл; шаффл под подложку «шаффл» у R–5–6', () => {
    const how = (id: string) => { const step = stepOf(id); return step.kind === 'play' ? [step.practice.rhythm, step.practice.groove] : null; };
    expect(how('t2-length.quarters')).toEqual(['quarters', null]);
    expect(how('t2-length.eighths')).toEqual(['eighths', null]);
    expect(how('h2-rhythm.eighth-rest')).toEqual(['eighth-rest', null]);
    expect(how('h2-rhythm.tied')).toEqual(['tied-syncopation', null]);
    expect(how('h2-rhythm.shuffle')).toEqual(['shuffle', null]);
    expect(how('h2-blues.r56')).toEqual(['shuffle', 'shuffle']);
    expect(how('h2-blues.r5b78')).toEqual(['eighths', null]);
    expect(how('h2-triad.quarters')).toEqual(['quarters', null]);
    expect(how('f2-dg.naturals')).toEqual(['quarters', null]);
  });
  it('проверки по таблице A9.7: диапазон, вид и предмет', () => {
    expect(checkOf('f2-dg.name-note')).toMatchObject({ kind: 'name-note', area: { type: 'range', strings: ['D', 'G'], fretMin: 0, fretMax: 12 }, subject: { type: 'notes', notes: 'natural' } });
    expect(checkOf('f2-all.find-all')).toMatchObject({ kind: 'find-all', area: { strings: ['E', 'A', 'D', 'G'], fretMax: 12 }, subject: { type: 'notes', notes: 'all' } });
    expect(checkOf('f2-all.name-note')).toMatchObject({ kind: 'name-note', subject: { type: 'notes', notes: 'all' } });
    expect(checkOf('f2-penta.find-degree')).toMatchObject({ kind: 'find-degree', area: { type: 'exercise' }, subject: { type: 'degrees', scale: null, targets: null } });
    expect(checkOf('h2-blues.name-degree')).toMatchObject({
      kind: 'name-degree', area: { type: 'range', strings: ['E', 'A', 'D'], fretMin: 4, fretMax: 7 }, subject: { scale: { root: 'A', degrees: ['1', '5', '6', 'b7'] } },
    });
    expect(checkOf('h2-triad.name-degree')).toMatchObject({
      kind: 'name-degree', area: { strings: ['A', 'D', 'G'], fretMin: 1, fretMax: 5 }, subject: { scale: { root: 'C', degrees: ['1', 'b3', '3', '5'] } },
    });
  });
  it('каждая проверка строит серию из шести вопросов', () => {
    for (const ref of stage) if (ref.step.kind === 'check') expect(checkSeries(ref.step.check, 1).questions, ref.step.id).toHaveLength(6);
  });
  it('шаг «Своя линия» — правило h2-own; необязательная песня вне счёта', () => {
    const line = stepOf('h2-own.own');
    expect(line.kind === 'line' && line.rule).toBe('h2-own');
    expect(stepOf('h2-own.song').kind).toBe('song');
  });
});

describe('переход между этапами и «Сегодня»', () => {
  const stage1 = PROGRAM.stages[0].blocks.map(block => block.id);
  const facts = (over: Partial<ProgramFacts> = {}): ProgramFacts => ({ plays: [], checks: [], lines: [], skippedBlocks: new Set(), today: '2026-11-20', ...over });
  const currentIds = (input: ProgramFacts) => Object.values(evaluateProgram(PROGRAM, input).current).map(ref => ref?.step.id ?? null);

  it('пока этап 1 не пройден, текущие шаги — из этапа 1; пройденный (здесь отмеченный «Уже умею») открывает первые шаги этапа 2 в трёх линиях', () => {
    expect(currentIds(facts())).toEqual(['t1-pulse.quarters', 'f1-ea5.naturals', 'h1-open.quarters']);
    expect(currentIds(facts({ skippedBlocks: new Set(stage1) }))).toEqual(['t2-length.quarters', 'f2-dg.naturals', 'h2-rhythm.eighth-rest']);
  });
  it('линия «Аккорды и линии» переходит на этап 2 по факту «Своей линии»: без него шаг h1-line.own остаётся текущим', () => {
    const skipped = new Set(stage1.filter(id => id !== 'h1-line'));
    expect(currentIds(facts({ skippedBlocks: skipped }))[2]).toBe('h1-line.own');
    const record: PlayRecord = {
      kind: 'play', id: 'p-1', exerciseKey: 'user:line', title: 'Своя линия', spec: lineSpec(setBarPattern(newLineDraft(), 1, 'root-fifth')), assessment: 'clean', bpm: 60, activeMs: 60000,
      localDate: '2026-11-19', occurredAt: '2026-11-19T10:00:00.000Z', view: 'both', wholePass: true, practice: { rhythm: 'eighths', echo: false, groove: null },
    };
    expect(currentIds(facts({ skippedBlocks: skipped, lines: lineFacts([record]) }))[2]).toBe('h2-rhythm.eighth-rest');
  });
  it('«Сегодня» после этапа 1 собирает занятие из шагов этапа 2 с их «как играть»', () => {
    const day = composeDay(PROGRAM, facts({ skippedBlocks: new Set(stage1) }));
    expect(day.items.map(item => item.step.id)).toEqual(['t2-length.quarters', 'f2-dg.naturals', 'h2-rhythm.eighth-rest']);
    expect(day.items.every(item => item.stage === 2)).toBe(true);
  });
  it('счётчики этапа 2: 34 обязательных шага — 8 в технике, 9 в гриф и 17 в аккордах и линиях; песни в счёт не входят', () => {
    const state = evaluateProgram(PROGRAM, facts());
    expect(state.stageCounts.get(2)).toMatchObject({ total: 34, passed: 0 });
    expect(['technique', 'fretboard', 'chords'].map(line => state.lineCounts.get(`2:${line}`)!.total)).toEqual([8, 9, 17]);
  });
});
