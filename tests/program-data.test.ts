import { describe, expect, it } from 'vitest';
import { buildExercise } from '../src/exercises';
import { buildTimeline } from '../src/exercises/rhythm';
import { checkSeries } from '../src/practice/check-series';
import { materialId } from '../src/practice/material';
import { PROGRAM } from '../src/practice/program-data';
import { stepRefs } from '../src/practice/program';

/**
 * Данные этапа 1 против таблицы R-028 «Этап 1. Пульс и опора». Список блоков, шагов и числа вариантов выписан из таблицы
 * независимо от `program-data.ts`: если данные разойдутся с требованиями, тест краснеет.
 */
const STAGE_1: readonly (readonly [string, string, string, number])[] = [
  ['t1-pulse', 't1-pulse.quarters', 'play', 4], ['t1-pulse', 't1-pulse.eighths', 'play', 4], ['t1-pulse', 't1-pulse.quarter-two-eighths', 'play', 4],
  ['t1-crossing', 't1-crossing.eighths', 'play', 2], ['t1-crossing', 't1-crossing.note-rest', 'play', 4], ['t1-crossing', 't1-crossing.raking', 'play', 1],
  ['t1-left', 't1-left.quarters', 'play', 5], ['t1-left', 't1-left.eighths', 'play', 5], ['t1-left', 't1-left.shift', 'play', 3],
  ['f1-ea5', 'f1-ea5.naturals', 'play', 2], ['f1-ea5', 'f1-ea5.name-note', 'check', 0],
  ['f1-ea12', 'f1-ea12.naturals', 'play', 2], ['f1-ea12', 'f1-ea12.find-note', 'check', 0], ['f1-ea12', 'f1-ea12.name-note', 'check', 0],
  ['f1-octave', 'f1-octave.quarters', 'play', 4], ['f1-octave', 'f1-octave.degrees', 'check', 0],
  ['h1-open', 'h1-open.quarters', 'play', 2], ['h1-open', 'h1-open.blues', 'play', 2],
  ['h1-roots', 'h1-roots.quarters', 'play', 8], ['h1-roots', 'h1-roots.eighths', 'play', 8], ['h1-roots', 'h1-roots.quarter-rest', 'play', 8],
  ['h1-roots', 'h1-roots.rock12', 'play', 6], ['h1-roots', 'h1-roots.find-note', 'check', 0],
  ['h1-fifth', 'h1-fifth.root-five-eight', 'play', 4], ['h1-fifth', 'h1-fifth.root-fifth', 'play', 8], ['h1-fifth', 'h1-fifth.octaves', 'play', 8],
  ['h1-fifth', 'h1-fifth.riff', 'play', 4], ['h1-fifth', 'h1-fifth.riff-rock', 'play', 4],
  ['h1-line', 'h1-line.own', 'line', 0], ['h1-line', 'h1-line.song', 'song', 0],
];

describe('данные этапа 1 по таблице R-028', () => {
  const refs = stepRefs(PROGRAM);
  const stage1 = refs.filter(ref => PROGRAM.stages[0].blocks.some(block => block.id === ref.block.id));
  const stepOf = (id: string) => refs.find(ref => ref.step.id === id)!.step;

  it('блоки и шаги по порядку таблицы, число вариантов каждого шага', () => {
    expect(stage1.map(ref => [ref.block.id, ref.step.id, ref.step.kind, ref.step.kind === 'play' ? ref.step.variants.length : 0])).toEqual(STAGE_1.map(row => [...row]));
  });
  it('блоки по линиям: техника, гриф, аккорды и линии', () => {
    const lineOf = (block: string) => PROGRAM.stages[0].blocks.find(item => item.id === block)!.line;
    expect(['t1-pulse', 't1-crossing', 't1-left'].map(lineOf)).toEqual(['technique', 'technique', 'technique']);
    expect(['f1-ea5', 'f1-ea12', 'f1-octave'].map(lineOf)).toEqual(['fretboard', 'fretboard', 'fretboard']);
    expect(['h1-open', 'h1-roots', 'h1-fifth', 'h1-line'].map(lineOf)).toEqual(['chords', 'chords', 'chords', 'chords']);
  });
  it('варианты в порядке таблицы: открытые струны E, A, D, G; позиции хроматики 5, 7, 9 и 1, 3 аппликатурой 1-2-4', () => {
    const variants = (id: string) => { const step = stepOf(id); return step.kind === 'play' ? step.variants.map(materialId) : []; };
    expect(variants('t1-pulse.quarters')).toEqual(['E', 'A', 'D', 'G'].map(string => `pulse-note.${string}.0.16`));
    expect(variants('t1-crossing.note-rest')).toEqual(['E', 'A', 'D', 'G'].map(string => `pulse-note.${string}.0.8`));
    expect(variants('t1-left.quarters')).toEqual(['chromatic-position.5.1234.up', 'chromatic-position.7.1234.up', 'chromatic-position.9.1234.up', 'chromatic-position.1.124.up', 'chromatic-position.3.124.up']);
    expect(variants('t1-left.shift')).toEqual(['chromatic-shift.5.3', 'chromatic-shift.7.3', 'chromatic-shift.9.3']);
    expect(variants('f1-ea5.naturals')).toEqual(['string-naturals.E.5', 'string-naturals.A.5']);
    expect(variants('f1-ea12.naturals')).toEqual(['string-naturals.E.12', 'string-naturals.A.12']);
    expect(variants('h1-open.quarters')).toEqual(['progression.A.I-IV-V.roots.open', 'progression.D.I-IV-V.roots.open']);
    expect(variants('h1-open.blues')).toEqual(['progression.A.blues-12.roots.open', 'progression.D.blues-12.roots.open']);
    expect(variants('h1-fifth.riff')).toEqual(['G', 'A', 'C', 'D'].map(root => `riff.rock-eighths.${root}`));
  });
  it('позиция не названа в таблице: каждая тональность в нижней позиции, затем в закрытой', () => {
    const variants = (id: string) => { const step = stepOf(id); return step.kind === 'play' ? step.variants.map(materialId) : []; };
    expect(variants('h1-roots.quarters')).toEqual([
      ...['G', 'A', 'C', 'D'].map(root => `progression.${root}.I-IV-V.roots.low`), ...['G', 'A', 'C', 'D'].map(root => `progression.${root}.I-IV-V.roots.closed`),
    ]);
    expect(variants('h1-roots.rock12')).toEqual([
      ...['A', 'G', 'C'].map(root => `progression.${root}.blues-12.roots.low`), ...['A', 'G', 'C'].map(root => `progression.${root}.blues-12.roots.closed`),
    ]);
    expect(variants('h1-fifth.root-fifth').slice(0, 2)).toEqual(['progression.G.I-IV-V.root-fifth.low', 'progression.A.I-IV-V.root-fifth.low']);
  });
  it('«как играть» из таблицы: четверти, восьмые, «нота — пауза», «четвертная пауза», подложка «рок»', () => {
    const how = (id: string) => { const step = stepOf(id); return step.kind === 'play' ? [step.practice.rhythm, step.practice.groove] : null; };
    expect(how('t1-pulse.quarters')).toEqual(['quarters', null]);
    expect(how('t1-pulse.quarter-two-eighths')).toEqual(['quarter-two-eighths', null]);
    expect(how('t1-crossing.note-rest')).toEqual(['note-rest', null]);
    expect(how('h1-roots.quarter-rest')).toEqual(['quarter-rest', null]);
    expect(how('h1-roots.rock12')).toEqual(['eighths', 'rock']);
    expect(how('h1-fifth.riff-rock')).toEqual(['eighths', 'rock']);
  });
  it('каждый вариант строится и играет заданный ритм без замены; число тактов у шага укладывается в плановое время', () => {
    for (const ref of refs) {
      if (ref.step.kind !== 'play') continue;
      for (const variant of ref.step.variants) {
        const timeline = buildTimeline(buildExercise(variant), { pattern: ref.step.practice.rhythm });
        expect(timeline.pattern, `${ref.step.id}: ${materialId(variant)}`).toBe(ref.step.practice.rhythm);
        expect(timeline.bars, ref.step.id).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('проверки по диапазону: область и цели строятся серией из шести вопросов', () => {
    for (const ref of refs) {
      if (ref.step.kind !== 'check') continue;
      const series = checkSeries(ref.step.check, 1);
      expect(series.questions, ref.step.id).toHaveLength(6);
    }
    const check = (id: string) => { const step = stepOf(id); return step.kind === 'check' ? step.check : null; };
    expect(check('f1-ea5.name-note')).toMatchObject({ kind: 'name-note', area: { type: 'range', strings: ['E', 'A'], fretMin: 0, fretMax: 5 }, subject: { type: 'notes', notes: 'natural' } });
    expect(check('f1-ea12.find-note')).toMatchObject({ kind: 'find-note', area: { fretMax: 12 } });
    expect(check('h1-roots.find-note')).toMatchObject({ kind: 'find-note', subject: { type: 'chord-root', notes: 'natural' } });
  });
  it('шаг «Своя линия» — правило h1-line; необязательная песня вне счёта', () => {
    const line = stepOf('h1-line.own');
    expect(line.kind === 'line' && line.rule).toBe('h1-line');
    expect(stepOf('h1-line.song').kind).toBe('song');
  });
});
