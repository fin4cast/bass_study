import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import { DEFAULT_PRACTICE } from '../src/exercises/rhythm';
import { materialId } from '../src/practice/material';
import { PROGRAM } from '../src/practice/program-data';
import { evaluateProgram, type PlayFact, type ProgramFacts } from '../src/practice/program';
import { countsLabel, pathBadge, pathModel, stageLine, STATE_LABELS } from '../src/ui/lesson/path';

const TODAY = '2026-11-16';
const day = (offset: number) => new Date(Date.UTC(2026, 10, 16 + offset)).toISOString().slice(0, 10);
const facts = (over: Partial<ProgramFacts> = {}): ProgramFacts => ({ plays: [], checks: [], lines: [], skippedBlocks: new Set(), today: TODAY, ...over });
const QUARTERS = { rhythm: 'quarters' as const, echo: false, groove: null };
const clean = (spec: ReturnType<typeof createExerciseSpec>, over: Partial<PlayFact> = {}): PlayFact =>
  ({ materialId: materialId(spec), practice: DEFAULT_PRACTICE, assessment: 'clean', wholePass: true, bpm: 60, localDate: TODAY, view: 'both', ...over });
const model = (input: ProgramFacts = facts(), picks = new Map<string, number>()) => pathModel(PROGRAM, evaluateProgram(PROGRAM, input), input.skippedBlocks, picks);
const stepOf = (stages: ReturnType<typeof model>, id: string) => stages.flatMap(stage => stage.lines.flatMap(line => line.blocks.flatMap(block => block.steps))).find(step => step.id === id)!;

describe('путь программы для «Основ»', () => {
  it('этап 1: три линии с блоками, счётчики и бейдж без истории', () => {
    const stages = model();
    expect(stages).toHaveLength(1);
    expect(stages[0].lines.map(line => [line.id, line.blocks.map(block => block.id)])).toEqual([
      ['technique', ['t1-crossing', 't1-left']], ['fretboard', ['f1-octave']], ['chords', ['h1-roots', 'h1-fifth']],
    ]);
    expect(stages[0].counts).toBe('пройдено 0 · пропущено 0 · освоено 0 из 11');
    expect(pathBadge(evaluateProgram(PROGRAM, facts()))).toBe('0/11');
  });

  it('счётчик по-русски: пропущено и «повторить» показываются, когда они есть', () => {
    expect(countsLabel({ passed: 5, skipped: 2, mastered: 1, review: 0, total: 9 })).toBe('пройдено 5 · пропущено 2 · освоено 1 из 9');
    expect(countsLabel({ passed: 5, skipped: 0, mastered: 3, review: 2, total: 9 })).toBe('пройдено 5 · пропущено 0 · освоено 3 · повторить 2 из 9');
  });

  it('текущие шаги линий отмечены, вариант по умолчанию — первый без «Чисто»', () => {
    const start = model();
    expect(['t1-crossing.eighths', 'f1-octave.quarters', 'h1-roots.eighths'].every(id => stepOf(start, id).current)).toBe(true);
    expect(stepOf(start, 't1-crossing.raking').current).toBe(false);
    const after = model(facts({ plays: [clean(createExerciseSpec('string-crossing', { pattern: 'adjacent' }))] }));
    const step = stepOf(after, 't1-crossing.eighths');
    expect(step.variants.map(variant => variant.clean)).toEqual([true, false]);
    expect(step.selected).toBe(1);
    expect(step.label).toBe('в работе');
  });

  it('выбранный пользователем вариант важнее умолчания; выход за список игнорируется', () => {
    const picked = model(facts(), new Map([['t1-left.quarters', 2]]));
    expect(stepOf(picked, 't1-left.quarters').selected).toBe(2);
    expect(stepOf(model(facts(), new Map([['t1-left.quarters', 9]])), 't1-left.quarters').selected).toBe(0);
  });

  it('статусы: пройден, освоен с лучшим темпом, пропущен; «пора повторить» — пометка', () => {
    const fives = ['G', 'A'].map(note => createExerciseSpec('octaves', { note }));
    const plays = [clean(fives[0], { practice: QUARTERS, view: 'memory', bpm: 84, localDate: day(-1) }), clean(fives[1], { practice: QUARTERS, view: 'memory', bpm: 70 })];
    const mastered = stepOf(model(facts({ plays })), 'f1-octave.quarters');
    expect(mastered.state).toBe('mastered');
    expect(mastered.label).toBe('освоен · 84');
    const stale = stepOf(model(facts({ plays: plays.map((fact, index) => ({ ...fact, localDate: day(-30 - index) })) })), 'f1-octave.quarters');
    expect(stale.review).toBe(true);
    const skipped = model(facts({ skippedBlocks: new Set(['h1-roots']) }));
    expect(stepOf(skipped, 'h1-roots.eighths').label).toBe(STATE_LABELS.skipped);
    expect(skipped[0].lines[2].blocks[0].skipped).toBe(true);
  });

  it('карточки блоков — существующие понятия справочника; проверка показывает свой материал', () => {
    const stages = model();
    const block = stages[0].lines[0].blocks[0];
    expect(block.cards.map(card => card.id)).toEqual(['alternate-plucking', 'muting']);
    expect(block.cards.every(card => card.title.length > 0)).toBe(true);
    const check = stepOf(stages, 'f1-octave.degrees');
    expect(check.kind).toBe('check');
    expect(check.variants).toHaveLength(1);
    expect(check.variants[0].label).toContain('C');
  });
});

describe('строка этапа под «Сегодня»', () => {
  it('«Этап 1 · пройдено N · освоено M» по этапу текущих шагов; у пройденной программы строки нет', () => {
    expect(stageLine(evaluateProgram(PROGRAM, facts()))).toBe('Этап 1 · пройдено 0 · освоено 0');
    const plays = [createExerciseSpec('string-crossing', { pattern: 'adjacent' }), createExerciseSpec('string-crossing', { pattern: 'skip' })].map(spec => clean(spec));
    expect(stageLine(evaluateProgram(PROGRAM, facts({ plays })))).toBe('Этап 1 · пройдено 1 · освоено 0');
    expect(stageLine(evaluateProgram(PROGRAM, facts({ skippedBlocks: new Set(PROGRAM.stages[0].blocks.map(block => block.id)) })))).toBeNull();
  });
});
