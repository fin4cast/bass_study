import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec, type ExerciseSpec } from '../src/exercises';
import { DEFAULT_PRACTICE, GROOVE_IDS, rhythmPatternsFor, type PracticeOptions } from '../src/exercises/rhythm';
import { checkId, degreeCheck, validateCheckSpec, type CheckSpec } from '../src/practice/check';
import { getConcept } from '../src/practice/concepts';
import { materialId } from '../src/practice/material';
import { PROGRAM } from '../src/practice/program-data';
import {
  BASE_BPM, checkFacts, composeDay, daysBetween, evaluateProgram, isDone, isRequired, MEMORY_TEMPLATE_IDS, playContent, playFacts, stepMinutes, stepRefs, stepRuleText, dayPlanSteps,
  type Block, type CheckFact, type LineFact, type PlayFact, type PlayStep, type Program, type ProgramFacts, type Step,
} from '../src/practice/program';
import type { PlayRecord } from '../src/practice/results';

const TODAY = '2026-11-16';
const day = (offset: number) => { const date = new Date(Date.UTC(2026, 10, 16 + offset)); return date.toISOString().slice(0, 10); };
const QUARTERS: PracticeOptions = { rhythm: 'quarters', echo: false, groove: null };

const chromatic = (startFret: number) => createExerciseSpec('chromatic-position', { startFret });
const octaves = (note: string) => createExerciseSpec('octaves', { note });
const playStep = (id: string, variants: ExerciseSpec[], practice: PracticeOptions = DEFAULT_PRACTICE): PlayStep => ({ kind: 'play', id, title: id, variants, practice });
const rangeCheck: CheckSpec = validateCheckSpec({
  version: 'check-v2', kind: 'name-note', area: { type: 'range', strings: ['E', 'A'], fretMin: 0, fretMax: 5 }, subject: { type: 'notes', notes: 'natural' }, count: 6, ear: false,
});
const program = (...blocks: Block[]): Program => ({ stages: [{ number: 1, title: 'Этап', blocks }] });
const block = (id: string, line: Block['line'], steps: Step[]): Block => ({ id, title: id, line, cards: [], steps });

const fact = (spec: ExerciseSpec, over: Partial<PlayFact> = {}): PlayFact =>
  ({ materialId: materialId(spec), practice: DEFAULT_PRACTICE, assessment: 'clean', wholePass: true, bpm: 60, localDate: TODAY, view: 'both', ...over });
const facts = (over: Partial<ProgramFacts> = {}): ProgramFacts => ({ plays: [], checks: [], lines: [], skippedBlocks: new Set(), today: TODAY, ...over });
const stateOf = (prog: Program, stepId: string, input: ProgramFacts) => evaluateProgram(prog, input).statuses.get(stepId)!;

describe('статусы шага «играть» (R-028)', () => {
  const two = playStep('b.two', [chromatic(5), chromatic(7)]);
  const prog = program(block('b', 'technique', [two]));
  const state = (plays: PlayFact[], extra: Partial<ProgramFacts> = {}) => stateOf(prog, 'b.two', facts({ plays, ...extra })).state;

  it('не начат: засчитываемых проходов нет — чужой материал или другое «как играть» не считаются', () => {
    expect(state([])).toBe('new');
    expect(state([fact(octaves('G'))])).toBe('new');
    expect(state([fact(chromatic(5), { practice: QUARTERS })])).toBe('new');
    expect(state([fact(chromatic(5), { practice: { rhythm: 'eighths', echo: true, groove: null } })])).toBe('new');
    expect(state([fact(chromatic(5), { practice: { rhythm: 'eighths', echo: false, groove: 'rock' } })])).toBe('new');
  });

  it('в работе: проход засчитан, но «пройден» не достигнут; не «Чисто» и не целиком — не продвигают', () => {
    expect(state([fact(chromatic(5), { assessment: 'errors' })])).toBe('progress');
    expect(state([fact(chromatic(5), { assessment: 'slow' }), fact(chromatic(7), { assessment: 'errors' })])).toBe('progress');
    expect(state([fact(chromatic(5), { wholePass: false }), fact(chromatic(7), { wholePass: false })])).toBe('progress');
    expect(state([fact(chromatic(5))])).toBe('progress');
    expect(state([fact(chromatic(5)), fact(chromatic(5), { localDate: day(-1) })])).toBe('progress');
  });

  it('пройден: «Чисто» целиком в двух разных вариантах; темп, вид и день любые', () => {
    expect(state([fact(chromatic(5), { bpm: 40, view: 'board' }), fact(chromatic(7), { bpm: 200, view: 'memory', localDate: day(-30) })])).toBe('passed');
  });

  it('у шага с одним вариантом пройден — один проход «Чисто»', () => {
    const single = program(block('b', 'technique', [playStep('b.one', [chromatic(5)])]));
    expect(stateOf(single, 'b.one', facts({ plays: [fact(chromatic(5))] })).state).toBe('passed');
  });

  it('освоен: те же два варианта не ниже базового темпа в два разных дня', () => {
    const mastered = state([fact(chromatic(5), { localDate: day(-1) }), fact(chromatic(7))]);
    expect(mastered).toBe('mastered');
    expect(state([fact(chromatic(5)), fact(chromatic(7))])).toBe('passed');
    expect(state([fact(chromatic(5), { bpm: BASE_BPM - 1, localDate: day(-1) }), fact(chromatic(7))])).toBe('passed');
    expect(state([fact(chromatic(5), { localDate: day(-1) }), fact(chromatic(5))])).toBe('progress');
  });

  it('освоен у шага с одним вариантом — два дня', () => {
    const single = program(block('b', 'technique', [playStep('b.one', [chromatic(5)])]));
    expect(stateOf(single, 'b.one', facts({ plays: [fact(chromatic(5)), fact(chromatic(5), { localDate: day(-1) })] })).state).toBe('mastered');
    expect(stateOf(single, 'b.one', facts({ plays: [fact(chromatic(5)), fact(chromatic(5))] })).state).toBe('passed');
  });

  it('у шаблонов «по памяти» в «освоен» считаются только проходы в этом виде, в «пройден» — любые', () => {
    expect(MEMORY_TEMPLATE_IDS.size).toBe(13);
    const memory = program(block('b', 'fretboard', [playStep('b.mem', [octaves('G'), octaves('A')])]));
    const plays = (view: PlayFact['view']) => [fact(octaves('G'), { view, localDate: day(-1) }), fact(octaves('A'), { view })];
    expect(stateOf(memory, 'b.mem', facts({ plays: plays('both') })).state).toBe('passed');
    expect(stateOf(memory, 'b.mem', facts({ plays: plays('memory') })).state).toBe('mastered');
  });

  it('пропущен: блок отмечен «Уже умею», а по истории шаг не пройден; история важнее отметки', () => {
    const skipped = new Set(['b']);
    expect(state([], { skippedBlocks: skipped })).toBe('skipped');
    expect(state([fact(chromatic(5))], { skippedBlocks: skipped })).toBe('skipped');
    expect(state([fact(chromatic(5)), fact(chromatic(7))], { skippedBlocks: skipped })).toBe('passed');
  });

  it('лучший чистый темп — по проходам «Чисто» целиком', () => {
    const status = stateOf(prog, 'b.two', facts({ plays: [fact(chromatic(5), { bpm: 84 }), fact(chromatic(7), { bpm: 70 }), fact(chromatic(5), { bpm: 120, assessment: 'errors' })] }));
    expect(status.bestCleanBpm).toBe(84);
    expect(stateOf(prog, 'b.two', facts()).bestCleanBpm).toBeNull();
  });

  it('«пора повторить»: освоен и подтверждение старше 14 дней; статус не откатывается', () => {
    const old = (offset: number) => [fact(chromatic(5), { localDate: day(offset - 1) }), fact(chromatic(7), { localDate: day(offset) })];
    const fresh = stateOf(prog, 'b.two', facts({ plays: old(-14) }));
    expect(fresh.state).toBe('mastered');
    expect(fresh.review).toBe(false);
    const stale = stateOf(prog, 'b.two', facts({ plays: old(-15) }));
    expect(stale.state).toBe('mastered');
    expect(stale.review).toBe(true);
    expect(daysBetween(day(-15), TODAY)).toBe(15);
  });
});

describe('статусы шага «проверка» (R-028, A9)', () => {
  const step: Step = { kind: 'check', id: 'b.check', title: 'проверка', check: rangeCheck };
  const prog = program(block('b', 'fretboard', [step]));
  const id = checkId(rangeCheck);
  const series = (firstTry: number, offset = 0, over: Partial<CheckFact> = {}): CheckFact => ({ checkId: id, firstTry, count: 6, localDate: day(offset), ...over });
  const state = (checks: CheckFact[], extra: Partial<ProgramFacts> = {}) => stateOf(prog, 'b.check', facts({ checks, ...extra })).state;

  it('не начат, в работе, пройден: одна серия не меньше 5 из 6 с первой попытки', () => {
    expect(state([])).toBe('new');
    expect(state([series(4)])).toBe('progress');
    expect(state([series(5)])).toBe('passed');
    expect(state([series(6)])).toBe('passed');
  });

  it('серия с изменённым описанием не засчитывается', () => {
    expect(state([series(6, 0, { count: 5 })])).toBe('new');
    expect(state([series(6, 0, { checkId: 'find-note.EA-0-5.notes-natural' })])).toBe('new');
  });

  it('освоен — такие серии в два разных дня; пропущен — по отметке блока', () => {
    expect(state([series(5, 0), series(6, 0)])).toBe('passed');
    expect(state([series(5, 0), series(6, -1)])).toBe('mastered');
    expect(state([], { skippedBlocks: new Set(['b']) })).toBe('skipped');
  });
});

describe('шаги «Своя линия» (R-028)', () => {
  const line = (over: Partial<LineFact> = {}): LineFact => ({
    volume: 1, composition: 'a', tonality: 'A', mode: 'major', allRoots: false, standardChords: true, beyondVolume2: true, assessment: 'clean', wholePass: true, bpm: 60, localDate: TODAY, ...over,
  });
  const rule = (ruleId: 'h1-line' | 'h2-own' | 'h3-line' | 'h4-line', lines: LineFact[]) =>
    stateOf(program(block('b', 'chords', [{ kind: 'line', id: 'b.line', title: 'линия', rule: ruleId }])), 'b.line', facts({ lines })).state;

  it('h1-line: проход «Чисто» линии объёма 1, не все такты — тоники; освоен — в двух тональностях в два дня', () => {
    expect(rule('h1-line', [line({ allRoots: true })])).toBe('progress');
    expect(rule('h1-line', [line({ volume: 2 })])).toBe('new');
    expect(rule('h1-line', [line({ assessment: 'errors' })])).toBe('progress');
    expect(rule('h1-line', [line()])).toBe('passed');
    expect(rule('h1-line', [line(), line({ tonality: 'D' })])).toBe('passed');
    expect(rule('h1-line', [line(), line({ tonality: 'D', localDate: day(-1) })])).toBe('mastered');
    expect(rule('h1-line', [line(), line({ tonality: 'D', localDate: day(-1), bpm: 50 })])).toBe('passed');
  });

  it('h2-own: линия объёма 2, аккорды которой не I–IV–V–I', () => {
    expect(rule('h2-own', [line({ volume: 2 })])).toBe('progress');
    expect(rule('h2-own', [line({ volume: 2, standardChords: false })])).toBe('passed');
    expect(rule('h2-own', [line({ volume: 2, standardChords: false }), line({ volume: 2, standardChords: false, tonality: 'E', localDate: day(-2) })])).toBe('mastered');
  });

  it('h3-line: две линии с разным составом тактов, у каждой есть рисунок вне объёма 2; освоен — три, мажорная и минорная', () => {
    expect(rule('h3-line', [line({ volume: 3 })])).toBe('progress');
    expect(rule('h3-line', [line({ volume: 3 }), line({ volume: 3, composition: 'b' })])).toBe('passed');
    expect(rule('h3-line', [line({ volume: 3 }), line({ volume: 3, composition: 'a', tonality: 'E' })])).toBe('progress');
    expect(rule('h3-line', [line({ volume: 3, beyondVolume2: false }), line({ volume: 3, composition: 'b', beyondVolume2: false })])).toBe('progress');
    const three = [line({ volume: 3 }), line({ volume: 3, composition: 'b', mode: 'minor', localDate: day(-1) }), line({ volume: 3, composition: 'c' })];
    expect(rule('h3-line', three)).toBe('mastered');
    expect(rule('h3-line', three.map(item => ({ ...item, mode: 'major' as const })))).toBe('passed');
  });

  it('h4-line: один состав тактов в двух тональностях; освоен — в трёх в два дня', () => {
    expect(rule('h4-line', [line({ volume: 3 })])).toBe('progress');
    expect(rule('h4-line', [line({ volume: 3 }), line({ volume: 3, tonality: 'D' })])).toBe('passed');
    expect(rule('h4-line', [line({ volume: 3 }), line({ volume: 3, composition: 'b', tonality: 'D' })])).toBe('progress');
    const three = [line({ volume: 3 }), line({ volume: 3, tonality: 'D', localDate: day(-1) }), line({ volume: 3, tonality: 'E' })];
    expect(rule('h4-line', three)).toBe('mastered');
  });
});

describe('текущие шаги линий и счётчики (R-028)', () => {
  const one = (id: string, spec: ExerciseSpec) => playStep(id, [spec]);
  const prog: Program = {
    stages: [
      { number: 1, title: 'Первый', blocks: [
        block('t1', 'technique', [one('t1.a', chromatic(5)), { kind: 'song', id: 't1.song', title: 'песня' }, one('t1.b', chromatic(7))]),
        block('f1', 'fretboard', [one('f1.a', octaves('G'))]),
      ] },
      { number: 2, title: 'Второй', blocks: [block('t2', 'technique', [one('t2.a', chromatic(9))])] },
    ],
  };
  const done = (spec: ExerciseSpec) => fact(spec);

  it('текущий шаг линии — первый обязательный без «пройден», «освоен» и «пропущен»; необязательный не бывает текущим', () => {
    const start = evaluateProgram(prog, facts());
    expect(start.current.technique?.step.id).toBe('t1.a');
    expect(start.current.fretboard?.step.id).toBe('f1.a');
    expect(start.current.chords).toBeNull();
    const next = evaluateProgram(prog, facts({ plays: [done(chromatic(5))] }));
    expect(next.current.technique?.step.id).toBe('t1.b');
  });

  it('линия продолжается в следующем этапе, не дожидаясь остальных; «Уже умею» продвигает линию', () => {
    const afterStage = evaluateProgram(prog, facts({ plays: [done(chromatic(5)), done(chromatic(7))] }));
    expect(afterStage.current.technique?.stage).toBe(2);
    expect(afterStage.current.technique?.step.id).toBe('t2.a');
    expect(afterStage.current.fretboard?.step.id).toBe('f1.a');
    const skipped = evaluateProgram(prog, facts({ skippedBlocks: new Set(['t1']) }));
    expect(skipped.current.technique?.step.id).toBe('t2.a');
  });

  it('когда в линию добавляются более ранние шаги, текущим становится первый из них', () => {
    const later: Program = { stages: [{ number: 1, title: 'Этап', blocks: [block('t1', 'technique', [one('t1.b', chromatic(7))])] }] };
    const earlier: Program = { stages: [{ number: 1, title: 'Этап', blocks: [block('t0', 'technique', [one('t0.a', chromatic(3))]), ...later.stages[0].blocks] }] };
    const history = facts({ plays: [done(chromatic(7))] });
    expect(evaluateProgram(later, history).current.technique).toBeNull();
    expect(evaluateProgram(earlier, history).current.technique?.step.id).toBe('t0.a');
  });

  it('счётчики «пройдено · пропущено · освоено · повторить из N» не считают необязательные шаги; линия и этап пройдены, когда закрыты все', () => {
    const history = facts({ plays: [{ ...done(chromatic(5)), localDate: day(-21) }, { ...done(chromatic(5)), localDate: day(-20) }], skippedBlocks: new Set(['f1']) });
    const state = evaluateProgram(prog, history);
    expect(state.blockCounts.get('t1')).toEqual({ passed: 1, skipped: 0, mastered: 1, review: 1, total: 2 });
    expect(state.blockCounts.get('f1')).toEqual({ passed: 0, skipped: 1, mastered: 0, review: 0, total: 1 });
    expect(state.stageCounts.get(1)?.total).toBe(3);
    expect(isDone(state.lineCounts.get('1:fretboard')!)).toBe(true);
    expect(isDone(state.lineCounts.get('1:technique')!)).toBe(false);
    expect(isDone(state.lineCounts.get('1:chords')!)).toBe(true);
    expect(isDone(state.stageCounts.get(1)!)).toBe(false);
  });
});

describe('занятие (R-028)', () => {
  const step = (id: string, spec: ExerciseSpec | ExerciseSpec[], practice?: PracticeOptions) => playStep(id, Array.isArray(spec) ? spec : [spec], practice);
  const ids = (items: readonly { step: Step }[]) => items.map(item => item.step.id);

  it('первое занятие — текущие шаги линий в порядке «Техника → Гриф → Аккорды и линии», первый вариант', () => {
    const prog = program(
      block('c', 'chords', [step('c.a', [createExerciseSpec('progression'), createExerciseSpec('progression', { root: 'G' })])]),
      block('f', 'fretboard', [step('f.a', octaves('G'))]),
      block('t', 'technique', [step('t.a', [chromatic(5), chromatic(7)])]),
    );
    const day1 = composeDay(prog, facts());
    expect(day1.mode).toBe('normal');
    expect(ids(day1.items)).toEqual(['t.a', 'f.a', 'c.a']);
    expect(day1.items.map(item => [item.variant, item.reason])).toEqual([[0, 'current'], [0, 'current'], [0, 'current']]);
  });

  it('вариант не меняется, пока не сыгран «Чисто»; после «Чисто» открывается следующий', () => {
    const prog = program(block('t', 'technique', [step('t.a', [chromatic(5), chromatic(7), chromatic(9)])]));
    expect(composeDay(prog, facts({ plays: [fact(chromatic(5), { assessment: 'errors' })] })).items[0].variant).toBe(0);
    expect(composeDay(prog, facts({ plays: [fact(chromatic(5))] })).items[0].variant).toBe(1);
  });

  it('закрепление: после текущих шагов идут «пройден, не освоен», давно не игравшиеся первыми; вариант — без засчитанного в «освоен»', () => {
    const passedStep = (id: string, base: number) => step(id, [chromatic(base), chromatic(base + 1)]);
    const prog = program(
      block('t', 'technique', [passedStep('t.old', 1), passedStep('t.new', 3), step('t.cur', octaves('G'))]),
    );
    const played = (base: number, date: string) => [fact(chromatic(base), { localDate: date }), fact(chromatic(base + 1), { localDate: date })];
    const plays = [...played(3, day(-1)), ...played(1, day(-5))];
    const result = composeDay(prog, facts({ plays }));
    expect(ids(result.items)).toEqual(['t.cur', 't.old', 't.new']);
    expect(result.items.map(item => item.reason)).toEqual(['current', 'reinforce', 'reinforce']);
  });

  it('закрепление берёт вариант без освоения; если освоены все — самый давний', () => {
    const prog = program(block('t', 'technique', [step('t.a', [chromatic(1), chromatic(2), chromatic(3)]), step('t.next', octaves('G'))]));
    // Пройден (два варианта «Чисто» ниже базового темпа): первый вариант без засчитанного в «освоен» — тот же первый.
    const slow = [fact(chromatic(1), { bpm: 40, localDate: day(-3) }), fact(chromatic(2), { bpm: 40, localDate: day(-2) })];
    expect(composeDay(prog, facts({ plays: slow })).items.find(item => item.step.id === 't.a')?.variant).toBe(0);
    // Первый вариант освоен по темпу, второй нет: закрепление открывает второй.
    const mixed = [fact(chromatic(1), { localDate: day(-3) }), fact(chromatic(2), { bpm: 40, localDate: day(-2) })];
    expect(composeDay(prog, facts({ plays: mixed })).items.find(item => item.step.id === 't.a')?.variant).toBe(1);
  });

  it('закрепление добавляется, пока время меньше 12 минут, и не больше шести шагов', () => {
    const steps = Array.from({ length: 8 }, (_, index) => step(`t.s${index}`, [chromatic(2 * index + 1), chromatic(2 * index + 2)]));
    const prog = program(block('t', 'technique', [...steps, step('t.cur', octaves('G'))]));
    const plays = steps.flatMap((item, index) => [fact(chromatic(2 * index + 1), { localDate: day(-index - 1) }), fact(chromatic(2 * index + 2), { localDate: day(-index - 1) })]);
    const result = composeDay(prog, facts({ plays }));
    expect(result.items.length).toBeLessThanOrEqual(6);
    const minutesBeforeLast = result.items.slice(0, -1).reduce((sum, item) => sum + item.minutes, 0);
    expect(minutesBeforeLast).toBeLessThan(12);
    expect(result.minutes >= 12 || result.items.length === 6).toBe(true);
  });

  it('если шагов «пройден, не освоен» нет — закрепление берёт «пора повторить», самые давние первыми', () => {
    const prog = program(block('t', 'technique', [step('t.a', [chromatic(1), chromatic(2)]), step('t.b', [chromatic(3), chromatic(4)]), step('t.cur', octaves('G'))]));
    const mastered = (base: number, offset: number) => [fact(chromatic(base), { localDate: day(offset - 1) }), fact(chromatic(base + 1), { localDate: day(offset) })];
    const recent = fact(octaves('G'), { assessment: 'errors' });
    const result = composeDay(prog, facts({ plays: [recent, ...mastered(3, -20), ...mastered(1, -40)] }));
    expect(ids(result.items)).toEqual(['t.cur', 't.a', 't.b']);
    expect(result.items.slice(1).map(item => item.reason)).toEqual(['review', 'review']);
  });

  it('место линии без текущего шага отдаётся закреплению: шагов закрепления может быть больше трёх мест', () => {
    const prog = program(block('t', 'technique', [step('t.a', [chromatic(1), chromatic(2)]), step('t.b', [chromatic(3), chromatic(4)])]));
    const plays = [fact(chromatic(1), { localDate: day(-3) }), fact(chromatic(2), { localDate: day(-3) })];
    const result = composeDay(prog, facts({ plays }));
    expect(ids(result.items)).toEqual(['t.b', 't.a']);
  });

  it('после перерыва больше 14 дней — «Вспомнить»: последние пройденные шаги линий, текущие шаги не меняются', () => {
    const prog = program(
      block('t', 'technique', [step('t.a', [chromatic(1), chromatic(2)]), step('t.b', [chromatic(3), chromatic(4)])]),
      block('f', 'fretboard', [step('f.a', octaves('G'))]),
    );
    const plays = [fact(chromatic(1), { localDate: day(-30) }), fact(chromatic(2), { localDate: day(-30) })];
    const result = composeDay(prog, facts({ plays }));
    expect(result.mode).toBe('recall');
    expect(result.items.map(item => [item.step.id, item.reason])).toEqual([['t.a', 'recall'], ['f.a', 'recall']]);
    expect(evaluateProgram(prog, facts({ plays })).current.technique?.step.id).toBe('t.b');
    expect(composeDay(prog, facts({ plays: [fact(chromatic(1), { localDate: day(-14) }), fact(chromatic(2), { localDate: day(-14) })] })).mode).toBe('normal');
  });

  it('плановое время шага: такты × 4 с × 3 прохода + минута, вверх до минуты, от 2 до 5; проверка — 2; своя линия — 5', () => {
    const blues = playStep('x', [createExerciseSpec('progression', { progression: 'blues-12' })]);
    expect(stepMinutes(blues)).toBe(4);
    expect(stepMinutes(playStep('x', [createExerciseSpec('progression', { progression: 'blues-12' })], { ...DEFAULT_PRACTICE, echo: true }))).toBe(5);
    expect(stepMinutes(playStep('x', [createExerciseSpec('progression')]))).toBe(2);
    expect(stepMinutes(playStep('x', [chromatic(5)], QUARTERS))).toBe(2);
    expect(stepMinutes({ kind: 'check', id: 'x', title: 'x', check: rangeCheck })).toBe(2);
    expect(stepMinutes({ kind: 'line', id: 'x', title: 'x', rule: 'h1-line' })).toBe(5);
  });

  it('содержимое шага плана несёт вариант и «как играть» шага', () => {
    const base = playStep('t.a', [chromatic(5), chromatic(7)], QUARTERS);
    expect(playContent(base, 1)).toEqual({ kind: 'exercise', spec: chromatic(7), practice: QUARTERS });
  });
});

describe('факты из записей игры', () => {
  it('записи игры переводятся в факты, остальные виды записей пропускаются', () => {
    const spec = chromatic(5);
    const record: PlayRecord = { kind: 'play', id: 'p1', exerciseKey: 'builtin:x', title: 'Хроматика', spec, assessment: 'clean', bpm: 72, activeMs: 1, localDate: TODAY, occurredAt: `${TODAY}T10:00:00.000Z`, view: 'memory', wholePass: true, practice: DEFAULT_PRACTICE };
    expect(playFacts([record, { kind: 'manual', id: 'm', area: 'rhythm', title: 'r', bpm: 60, activeMs: 1, note: '', localDate: TODAY, occurredAt: `${TODAY}T10:00:00.000Z` }]))
      .toEqual([{ materialId: materialId(spec), practice: DEFAULT_PRACTICE, assessment: 'clean', wholePass: true, bpm: 72, localDate: TODAY, view: 'memory' }]);
  });
});

describe('данные программы (этап 1, заход B)', () => {
  const refs = stepRefs(PROGRAM);
  const STEP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const BLOCK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  it('ID блоков и шагов уникальны, неизменяемы по маске и начинаются с ID блока', () => {
    const blocks = PROGRAM.stages.flatMap(stage => stage.blocks.map(item => item.id));
    expect(new Set(blocks).size).toBe(blocks.length);
    for (const id of blocks) expect(id).toMatch(BLOCK_ID);
    expect(new Set(refs.map(ref => ref.step.id)).size).toBe(refs.length);
    for (const ref of refs) { expect(ref.step.id).toMatch(STEP_ID); expect(ref.step.id.startsWith(`${ref.block.id}.`)).toBe(true); }
  });

  it('у каждого блока есть линия, шаги и существующие карточки; у каждой линии этапа есть блоки', () => {
    for (const stage of PROGRAM.stages) {
      for (const line of ['technique', 'fretboard', 'chords']) expect(stage.blocks.some(item => item.line === line), `${stage.number}:${line}`).toBe(true);
      for (const item of stage.blocks) {
        expect(item.steps.length, item.id).toBeGreaterThan(0);
        for (const card of item.cards) expect(getConcept(card), `${item.id}: карточка ${card}`).not.toBeNull();
      }
    }
  });

  it('каждый шаг «играть» называет существующий шаблон, допустимый ритм, известную подложку и строящиеся варианты', () => {
    for (const ref of refs) {
      if (ref.step.kind !== 'play') continue;
      const step = ref.step;
      expect(step.variants.length, step.id).toBeGreaterThan(0);
      expect(new Set(step.variants.map(materialId)).size, `${step.id}: варианты различны`).toBe(step.variants.length);
      expect(step.variants.map(variant => variant.templateId).every(id => id === step.variants[0].templateId), `${step.id}: один шаблон`).toBe(true);
      if (step.practice.groove) expect(GROOVE_IDS, step.id).toContain(step.practice.groove);
      for (const variant of step.variants) {
        const plan = buildExercise(variant);
        expect(rhythmPatternsFor(plan), `${step.id}: ритм ${step.practice.rhythm}`).toContain(step.practice.rhythm);
      }
    }
  });

  it('пара «материал + как играть» не повторяется между шагами: проход не засчитается двум шагам', () => {
    const seen = new Map<string, string>();
    for (const ref of refs) {
      if (ref.step.kind !== 'play') continue;
      for (const variant of ref.step.variants) {
        const key = `${materialId(variant)}|${JSON.stringify(ref.step.practice)}`;
        expect(seen.has(key), `${ref.step.id} повторяет ${seen.get(key)}`).toBe(false);
        seen.set(key, ref.step.id);
      }
    }
  });

  it('проверки — серия из шести вопросов без слуха и с допустимым описанием', () => {
    for (const ref of refs) {
      const step = ref.step;
      if (step.kind !== 'check') continue;
      expect(step.check.count).toBe(6);
      expect(step.check.ear).toBe(false);
      expect(() => validateCheckSpec(JSON.parse(JSON.stringify(step.check)))).not.toThrow();
    }
  });

  it('первое занятие по данным: текущие шаги трёх линий с первым вариантом; все шаги — обязательные или необязательная песня', () => {
    const first = composeDay(PROGRAM, facts());
    expect(first.items.map(item => item.step.id)).toEqual(['t1-pulse.quarters', 'f1-ea5.naturals', 'h1-open.quarters']);
    expect(first.items.every(item => item.variant === 0 && item.minutes >= 2 && item.minutes <= 5)).toBe(true);
    for (const ref of refs) expect(isRequired(ref.step) || ref.step.kind === 'song').toBe(true);
  });
});

describe('факты из записей «Проверь себя»', () => {
  it('проверка по материалу превращается в факт с тем же checkId, что у шага программы', () => {
    const exercise = createExerciseSpec('root-five-eight', { root: 'C', string: 'A' });
    const answers = [
      { target: '1', outcome: 'correct' as const, errors: 0 }, { target: '5', outcome: 'corrected' as const, errors: 1 },
      { target: '1', outcome: 'revealed' as const, errors: 0 }, { target: '5', outcome: 'correct' as const, errors: 0 },
      { target: '1', outcome: 'correct' as const, errors: 0 }, { target: '5', outcome: 'correct' as const, errors: 0 },
    ];
    const record = { kind: 'check' as const, id: 'c1', exerciseKey: 'builtin:x', title: 'Октава', check: degreeCheck(exercise, 'find-degree', 6), activeMs: 1, localDate: TODAY, occurredAt: `${TODAY}T10:00:00.000Z`, answers };
    const [fact] = checkFacts([record]);
    const step = stepRefs(PROGRAM).map(ref => ref.step).find(item => item.id === 'f1-octave.degrees');
    expect(step?.kind === 'check' && fact.checkId === checkId(step.check)).toBe(true);
    expect(fact).toMatchObject({ firstTry: 4, count: 6, localDate: TODAY });
    const status = evaluateProgram(PROGRAM, facts({ checks: [{ ...fact, firstTry: 5 }] })).statuses.get('f1-octave.degrees');
    expect(status?.state).toBe('passed');
  });
});

describe('правило зачёта шага словами', () => {
  const step = (variants: ExerciseSpec[], practice: PracticeOptions = DEFAULT_PRACTICE) => playStep('b.x', variants, practice);
  const status = (plays: PlayFact[], variants: ExerciseSpec[], practice: PracticeOptions = DEFAULT_PRACTICE) =>
    stateOf(program(block('b', 'technique', [step(variants, practice)])), 'b.x', facts({ plays }));

  it('называет как играть, сколько вариантов сыграно и условие «освоен»', () => {
    const variants = [chromatic(5), chromatic(7)];
    const text = stepRuleText(step(variants, QUARTERS), status([fact(chromatic(5), { practice: QUARTERS })], variants, QUARTERS));
    expect(text).toContain('четверти');
    expect(text).toContain('в 2 вариантах — сыграно 1 из 2');
    expect(text).toContain('не ниже 60 BPM');
    expect(text).not.toContain('По памяти');
  });

  it('у шага с одним вариантом — «в одном варианте»; у «по памяти» — вид; подложка названа', () => {
    const one = [octaves('G')];
    expect(stepRuleText(step(one), status([], one))).toContain('в одном варианте — сыграно 0 из 1');
    expect(stepRuleText(step(one), status([], one))).toContain('«По памяти»');
    const rock = { rhythm: 'eighths' as const, echo: false, groove: 'rock' as const };
    expect(stepRuleText(step([chromatic(5)], rock), status([], [chromatic(5)], rock))).toContain('подложка «рок»');
  });

  it('вариант вне списка шага не засчитается — это сказано первым', () => {
    const variants = [chromatic(5), chromatic(7)];
    const text = stepRuleText(step(variants), status([], variants), false);
    expect(text.startsWith('Этот вариант шагу не засчитается')).toBe(true);
  });
});

describe('занятие как шаги плана', () => {
  it('обычный день: ID d<n>, программный шаг, вариант и «как играть» в содержимом, проверка — описанием шага', () => {
    const day = composeDay(PROGRAM, facts());
    const steps = dayPlanSteps(day);
    expect(steps.map(step => [step.id, step.programStep])).toEqual([['d1', 't1-pulse.quarters'], ['d2', 'f1-ea5.naturals'], ['d3', 'h1-open.quarters']]);
    expect(steps[1].content).toMatchObject({ kind: 'exercise', practice: { rhythm: 'quarters' } });
    expect(steps.every(step => step.minutes >= 2 && step.minutes <= 5)).toBe(true);
    const withCheck = composeDay(PROGRAM, facts({ plays: (['E', 'A'] as const).map(string => fact(createExerciseSpec('string-naturals', { string, fretMax: 5 }), { practice: QUARTERS, bpm: 80 })) }));
    const check = dayPlanSteps(withCheck).find(step => step.programStep === 'f1-ea5.name-note');
    expect(check?.content.kind).toBe('check');
    expect(check?.minutes).toBe(2);
  });

  it('после перерыва: ID r<n> — «Вспомнить»', () => {
    const plays = [createExerciseSpec('string-crossing', { pattern: 'adjacent' }), createExerciseSpec('string-crossing', { pattern: 'skip' })].map(spec => fact(spec, { localDate: day(-30) }));
    const recall = composeDay(PROGRAM, facts({ plays }));
    expect(recall.mode).toBe('recall');
    expect(dayPlanSteps(recall).map(step => [step.id, step.programStep])).toEqual([['r1', 't1-crossing.eighths'], ['r2', 'f1-ea5.naturals'], ['r3', 'h1-open.quarters']]);
  });
});
