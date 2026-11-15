import { describe, expect, it } from 'vitest';
import { NOTE_CHOICES, buildExercise, createExerciseSpec, pluckOrder, type ExerciseSpec } from '../src/exercises';
import { DEFAULT_PRACTICE, type PracticeOptions } from '../src/exercises/rhythm';
import { goalProgress, GOALS, goalSteps, recordsByMaterial, reviewSteps, stepMastery, transposeRoot, type GoalStep } from '../src/practice/goals';
import { materialId } from '../src/practice/material';
import { addStep, createPlan, MAX_PLAN_STEPS, planFromTemplate } from '../src/practice/plan';
import type { PracticeRecord } from '../src/practice/results';
import { addGoalSteps, basicsBadge, basicsCourse, goalLine, heroModel, planFromGoal, recommendationCards, stepMaterial, storedGoal, untouchedFirstRunPlan } from '../src/ui/lesson/model';

const specOf = (step: GoalStep): ExerciseSpec => step.content.kind === 'exercise' ? step.content.spec : step.content.spec.exercise;
let serial = 0;
interface PlayOptions { view?: 'board' | 'both' | 'tab' | 'memory'; wholePass?: boolean; assessment?: 'clean' | 'errors'; bpm?: number; date?: string; key?: string; practice?: PracticeOptions }
const play = (spec: ExerciseSpec, options: PlayOptions = {}): PracticeRecord => {
  const date = options.date ?? '2026-11-13';
  return {
    kind: 'play', id: `p${++serial}`, exerciseKey: options.key ?? `builtin:${materialId(spec)}`, title: 't', spec, assessment: options.assessment ?? 'clean', bpm: options.bpm ?? 120, activeMs: 60000,
    localDate: date, occurredAt: `${date}T10:${String(serial % 60).padStart(2, '0')}:00.000Z`, view: options.view ?? 'memory', wholePass: options.wholePass ?? true, practice: options.practice ?? DEFAULT_PRACTICE,
  };
};
/** Засчитываемый проход в два разных дня. */
const twoDays = (spec: ExerciseSpec, options: PlayOptions = {}) => [play(spec, { ...options, date: '2026-11-12' }), play(spec, { ...options, date: '2026-11-13' })];
const check = (spec: ExerciseSpec, firstTry: number, checkKind: 'find-degree' | 'name-degree' = 'find-degree', date = '2026-11-13'): PracticeRecord => ({
  kind: 'check', id: `c${++serial}`, exerciseKey: `builtin:${materialId(spec)}`, title: 't', spec, checkKind, ear: false, activeMs: 60000,
  localDate: date, occurredAt: `${date}T11:00:00.000Z`,
  answers: Array.from({ length: 6 }, (_, index) => ({ degree: '1', outcome: index < firstTry ? 'correct' as const : 'corrected' as const, errors: index < firstTry ? 0 : 1 })),
});

describe('цели «Основ» (D-049, D-050)', () => {
  it('семь целей с заданным числом шагов; в каждой цели у шагов разный материал или «как играть»', () => {
    const counts = Object.fromEntries(GOALS.map(goal => [goal.id, goalSteps(goal.id).length]));
    expect(counts).toEqual({ notes: 6, pentatonic: 15, 'major-scale': 9, 'natural-minor': 9, 'four-fingers': 9, chords: 14, blues: 6 });
    for (const goal of GOALS) {
      const ids = goalSteps(goal.id).map(step => `${step.content.kind}:${materialId(specOf(step))}:${JSON.stringify(step.content.kind === 'exercise' ? step.content.practice ?? null : null)}`);
      expect(new Set(ids).size, goal.id).toBe(ids.length);
    }
    expect(GOALS.find(goal => goal.id === 'four-fingers')!.title).toBe('Техника рук');
  });
  it('цели с тоникой строятся от любой из 12 тоник; «другая тональность» — на кварту выше', () => {
    for (const goal of GOALS.filter(item => item.defaultRoot !== null)) {
      for (const root of NOTE_CHOICES) expect(() => goalSteps(goal.id, root), `${goal.id} ${root}`).not.toThrow();
    }
    expect(transposeRoot('A', 5)).toBe('D');
    expect(transposeRoot('G', 5)).toBe('C');
    expect(specOf(goalSteps('pentatonic', 'E').find(step => step.id === 'other-key')!).params).toMatchObject({ root: 'A' });
  });
  it('у шага — цель темпа шаблона; у эха и шаффла — «как играть»', () => {
    const steps = goalSteps('pentatonic', 'A');
    expect(steps.find(step => step.id === 'form-a')!.targetBpm).toBe(96);
    expect(steps.find(step => step.id === 'check')!.targetBpm).toBeNull();
    expect(steps.find(step => step.id === 'echo-a')!.content).toMatchObject({ practice: { echo: true } });
    expect(stepMaterial(steps.find(step => step.id === 'echo-a')!.content)).toBe('Am · минорная пентатоника · форма A · эхо: услышь — повтори');
    expect(stepMaterial(goalSteps('blues', 'A').find(step => step.id === 'blues-12-shuffle')!.content)).toMatch(/под шаффл$/);
    expect(goalSteps('blues', 'A').find(step => step.id === 'blues-12-shuffle')!.content).toMatchObject({ practice: { groove: 'shuffle' } });
  });
});

describe('освоение: целиком, в виде, на цели темпа, в два разных дня', () => {
  const formB = goalSteps('pentatonic', 'A').find(item => item.id === 'form-b')!;
  const spec = specOf(formB);
  it('«по памяти»: смена вида, петля, «С ошибками» и темп ниже цели не засчитываются', () => {
    expect(stepMastery(formB, recordsByMaterial([]))).toEqual({ state: 'new', label: 'не начат' });
    expect(stepMastery(formB, recordsByMaterial(twoDays(spec, { view: 'both' }))).label).toBe('в работе · чисто, теперь по памяти');
    expect(stepMastery(formB, recordsByMaterial(twoDays(spec, { wholePass: false }))).state).toBe('progress');
    expect(stepMastery(formB, recordsByMaterial(twoDays(spec, { assessment: 'errors' }))).state).toBe('progress');
    expect(stepMastery(formB, recordsByMaterial(twoDays(spec, { bpm: 84 })))).toEqual({ state: 'progress', label: 'в работе · 84/96' });
  });
  it('один день — ещё в работе; второй день — освоено; форма A не осваивает форму B', () => {
    expect(stepMastery(formB, recordsByMaterial([play(spec, { bpm: 100 })]))).toEqual({ state: 'progress', label: 'в работе · 1 из 2 дней · 100' });
    expect(stepMastery(formB, recordsByMaterial([play(spec, { bpm: 100 }), play(spec, { bpm: 104 })])).state).toBe('progress');
    expect(stepMastery(formB, recordsByMaterial(twoDays(spec, { bpm: 100 })))).toEqual({ state: 'done', label: '✓ по памяти · 100' });
    const formA = specOf(goalSteps('pentatonic', 'A')[0]);
    expect(stepMastery(formB, recordsByMaterial(twoDays(formA))).state).toBe('new');
  });
  it('«как играли» — часть материала: четверти или эхо не засчитываются за обычный шаг, и наоборот', () => {
    expect(stepMastery(formB, recordsByMaterial(twoDays(spec, { practice: { ...DEFAULT_PRACTICE, rhythm: 'quarters' } }))).state).toBe('new');
    const echo = goalSteps('pentatonic', 'A').find(item => item.id === 'echo-a')!;
    expect(stepMastery(echo, recordsByMaterial(twoDays(specOf(echo)))).state).toBe('new');
    expect(stepMastery(echo, recordsByMaterial(twoDays(specOf(echo), { practice: { ...DEFAULT_PRACTICE, echo: true } }))).state).toBe('done');
  });
  it('«чисто» — любой вид; проверка — 5 из 6 с первой попытки того же вида', () => {
    const chromatic = goalSteps('four-fingers')[0];
    expect(stepMastery(chromatic, recordsByMaterial(twoDays(specOf(chromatic), { view: 'board', bpm: 100 }))).label).toBe('✓ чисто · 100');
    const checkStep = goalSteps('pentatonic', 'A').find(item => item.rule === 'check')!;
    const material = specOf(checkStep);
    expect(stepMastery(checkStep, recordsByMaterial([check(material, 4)]))).toEqual({ state: 'progress', label: 'в работе · 4 из 6' });
    expect(stepMastery(checkStep, recordsByMaterial([check(material, 6, 'name-degree')])).state).toBe('new');
    expect(stepMastery(checkStep, recordsByMaterial([check(material, 4), check(material, 5)]))).toEqual({ state: 'done', label: '✓ 5 из 6' });
  });
  it('«Ноты на грифе» засчитываются только по памяти', () => {
    const note = goalSteps('notes')[0];
    expect(note.rule).toBe('memory');
    expect(stepMastery(note, recordsByMaterial(twoDays(specOf(note), { view: 'board' }))).state).toBe('progress');
  });
  it('освоенное без подтверждения дольше 14 дней — «пора повторить», но остаётся освоенным', () => {
    const records = twoDays(spec, { bpm: 100 });
    expect(stepMastery(formB, recordsByMaterial(records), '2026-11-27').state).toBe('done');
    expect(stepMastery(formB, recordsByMaterial(records), '2026-11-28')).toEqual({ state: 'review', label: 'пора повторить · ✓ по памяти · 100' });
    const progress = goalProgress('pentatonic', 'A', records, undefined, '2026-11-28');
    expect(progress.done).toBe(1);
    expect(reviewSteps(progress).map(step => step.id)).toEqual(['form-b']);
    expect(progress.next?.id).toBe('form-a');
  });
  it('освоение считается по материалу: запись под ключом своего упражнения засчитывается', () => {
    const blues = goalSteps('blues', 'A')[0];
    const progress = goalProgress('blues', 'A', twoDays(specOf(blues), { key: 'user:my-blues' }));
    expect(progress.steps[0].mastery.state).toBe('done');
    expect(progress).toMatchObject({ done: 1, total: 6 });
    expect(progress.next?.id).toBe('scale-compact-a');
  });
});

describe('правая рука', () => {
  it('чередование i–m; в рейкинге на соседнюю более низкую струну палец не меняется', () => {
    expect(pluckOrder(['E', 'A', 'E', 'A'], false)).toEqual(['i', 'm', 'i', 'm']);
    // Вверх E A D G — чередование; вниз G→D, D→A, A→E — тот же палец съезжает.
    expect(pluckOrder(['E', 'A', 'D', 'G', 'D', 'A', 'E'], true)).toEqual(['i', 'm', 'i', 'm', 'm', 'm', 'm']);
    // С G на A — не соседняя струна: чередование.
    expect(pluckOrder(['G', 'A'], true)).toEqual(['i', 'm']);
    const raking = buildExercise(createExerciseSpec('string-crossing', { pattern: 'raking' }));
    expect(raking.notes.map(note => note.pluck).slice(0, 7)).toEqual(['i', 'm', 'i', 'm', 'm', 'm', 'm']);
    expect(raking.notes.every(note => note.fret === 0 && note.finger === null)).toBe(true);
  });
});

describe('«Сегодня» и план из цели', () => {
  it('«Добавить шаги цели»: разминка и два следующих шага, без повторов и не больше предела плана', () => {
    const progress = goalProgress('pentatonic', 'A', []);
    const first = addGoalSteps(createPlan('2026-11-13'), progress, []);
    expect(first.added.map(step => step.id)).toEqual(['chromatic', 'form-a', 'form-b']);
    expect(addGoalSteps(first.plan, progress, []).added).toHaveLength(0);
    expect(addGoalSteps(createPlan('2026-11-13'), goalProgress('four-fingers', null, []), []).added.map(step => step.id)).toEqual(['chromatic', 'spider-1234']);
    let full = createPlan('2026-11-13');
    for (let index = 0; full.steps.length < MAX_PLAN_STEPS - 1; index++) full = addStep(full, { id: `f${index}`, content: goalSteps('chords', 'C')[index].content, minutes: 3 });
    const capped = addGoalSteps(full, goalProgress('notes', null, []), []);
    expect(capped.plan.steps).toHaveLength(MAX_PLAN_STEPS);
    expect(capped.added).toHaveLength(1);
  });
  it('пора повторить — разминкой вместо «Техники рук»; «как играть» шага переходит в план', () => {
    const formB = goalSteps('pentatonic', 'A').find(item => item.id === 'form-b')!;
    const records = twoDays(specOf(formB), { bpm: 100 });
    const progress = goalProgress('pentatonic', 'A', records, undefined, '2026-12-01');
    expect(addGoalSteps(createPlan('2026-12-01'), progress, records).added.map(step => step.id)).toEqual(['form-b', 'form-a', 'form-c']);
    const shuffle = goalSteps('blues', 'A').find(item => item.id === 'blues-12-shuffle')!;
    const plan = addStep(createPlan('2026-12-01'), { id: 's1', content: shuffle.content, minutes: 4 });
    expect(plan.steps[0].content).toMatchObject({ practice: { groove: 'shuffle' } });
  });
  it('цель пересобирает только нетронутый план первого запуска', () => {
    const firstRun = planFromTemplate('2026-11-13', 'firstRun');
    expect(untouchedFirstRunPlan(firstRun)).toBe(true);
    const rebuilt = planFromGoal(firstRun, goalProgress('pentatonic', 'A', []), []);
    expect(rebuilt.steps.map(step => step.content.kind === 'exercise' ? step.content.spec.templateId : 'check')).toEqual(['chromatic-position', 'pentatonic-form', 'pentatonic-form']);
    const touched = addStep(firstRun, { id: 'mine', content: { kind: 'exercise', spec: createExerciseSpec('octaves') }, minutes: 3 });
    expect(untouchedFirstRunPlan(touched)).toBe(false);
  });
  it('«Сегодня» и бейдж знают цель; неизвестная цель хранилища — цели нет', () => {
    const progress = goalProgress('pentatonic', 'E', []);
    expect(goalLine(progress)).toBe('Цель: Пентатоника на всём грифе · Em · освоено 0/15');
    expect(basicsBadge(basicsCourse([]), progress)).toBe('0/15');
    const hero = heroModel({ plan: createPlan('2026-11-13'), records: [], userExercises: [], firstRun: false }, progress);
    expect(hero).toMatchObject({ mode: 'goal', eyebrow: 'Следующий шаг цели', title: 'Форма пентатоники вверх-вниз', goalLine: goalLine(progress) });
    expect(hero.meta).toMatch(/Цель темпа — 96 BPM/);
    expect(recommendationCards([], false, { progress, step: progress.steps[1].step })[0]).toMatchObject({ id: 'goal', eyebrow: 'Шаг цели' });
    expect(storedGoal({ id: 'pentatonic-neck', root: 'A' })).toBeNull();
    expect(storedGoal({ id: 'four-fingers', root: null })).toEqual({ id: 'four-fingers', root: null });
  });
});
