import { describe, expect, it } from 'vitest';
import { NOTE_CHOICES, type ExerciseSpec } from '../src/exercises';
import { goalProgress, GOALS, goalSteps, stepMastery, recordsByMaterial, transposeRoot, type GoalStep } from '../src/practice/goals';
import { materialId } from '../src/practice/material';
import { createPlan, MAX_PLAN_STEPS, addStep } from '../src/practice/plan';
import type { PracticeRecord } from '../src/practice/results';
import { addGoalSteps, basicsBadge, basicsCourse, goalLine, heroModel, recommendationCards, storedGoal } from '../src/ui/lesson/model';

const specOf = (step: GoalStep): ExerciseSpec => step.content.kind === 'exercise' ? step.content.spec : step.content.spec.exercise;
let serial = 0;
const play = (spec: ExerciseSpec, view: 'board' | 'both' | 'tab' | 'memory', wholePass: boolean, assessment: 'clean' | 'errors' = 'clean', bpm = 88, key?: string): PracticeRecord => ({
  kind: 'play', id: `p${++serial}`, exerciseKey: key ?? `builtin:${materialId(spec)}`, title: 't', spec, assessment, bpm, activeMs: 60000,
  localDate: '2026-11-13', occurredAt: `2026-11-13T10:${String(serial % 60).padStart(2, '0')}:00.000Z`, view, wholePass,
});
const check = (spec: ExerciseSpec, firstTry: number, checkKind: 'find-degree' | 'name-degree' = 'find-degree'): PracticeRecord => ({
  kind: 'check', id: `c${++serial}`, exerciseKey: `builtin:${materialId(spec)}`, title: 't', spec, checkKind, ear: false, activeMs: 60000,
  localDate: '2026-11-13', occurredAt: '2026-11-13T11:00:00.000Z',
  answers: Array.from({ length: 6 }, (_, index) => ({ degree: '1', outcome: index < firstTry ? 'correct' as const : 'corrected' as const, errors: index < firstTry ? 0 : 1 })),
});

describe('цели «Основ» (D-049)', () => {
  it('семь целей с заданным числом шагов; в каждой цели у шагов разный материал', () => {
    const counts = Object.fromEntries(GOALS.map(goal => [goal.id, goalSteps(goal.id).length]));
    expect(counts).toEqual({ notes: 6, pentatonic: 14, 'major-scale': 9, 'natural-minor': 9, 'four-fingers': 7, chords: 14, blues: 5 });
    for (const goal of GOALS) {
      const ids = goalSteps(goal.id).map(step => `${step.content.kind}:${materialId(specOf(step))}`);
      expect(new Set(ids).size, goal.id).toBe(ids.length);
    }
  });
  it('цели с тоникой строятся от любой из 12 тоник; «другая тональность» — на кварту выше', () => {
    for (const goal of GOALS.filter(item => item.defaultRoot !== null)) {
      for (const root of NOTE_CHOICES) expect(() => goalSteps(goal.id, root), `${goal.id} ${root}`).not.toThrow();
    }
    expect(transposeRoot('A', 5)).toBe('D');
    expect(transposeRoot('G', 5)).toBe('C');
    expect(specOf(goalSteps('pentatonic', 'E').find(step => step.id === 'other-key')!).params).toMatchObject({ root: 'A' });
  });
  it('«по памяти»: только «Чисто» целым проходом в виде «По памяти»; смена вида или петля не засчитываются', () => {
    const step = goalSteps('pentatonic', 'A').find(item => item.id === 'form-b')!;
    const spec = specOf(step);
    expect(stepMastery(step, recordsByMaterial([]))).toEqual({ state: 'new', label: 'не начат' });
    expect(stepMastery(step, recordsByMaterial([play(spec, 'both', true)])).state).toBe('progress');
    expect(stepMastery(step, recordsByMaterial([play(spec, 'memory', false)])).state).toBe('progress');
    expect(stepMastery(step, recordsByMaterial([play(spec, 'memory', true, 'errors')])).state).toBe('progress');
    expect(stepMastery(step, recordsByMaterial([play(spec, 'memory', true, 'clean', 88)]))).toEqual({ state: 'done', label: '✓ по памяти · 88' });
    // Форма A с той же тоникой не осваивает форму B.
    const formA = specOf(goalSteps('pentatonic', 'A')[0]);
    expect(stepMastery(step, recordsByMaterial([play(formA, 'memory', true)])).state).toBe('new');
  });
  it('«чисто» — любой вид, но целым проходом; проверка — 5 из 6 с первой попытки того же вида', () => {
    const chromatic = goalSteps('four-fingers')[0];
    expect(stepMastery(chromatic, recordsByMaterial([play(specOf(chromatic), 'board', false)])).state).toBe('progress');
    expect(stepMastery(chromatic, recordsByMaterial([play(specOf(chromatic), 'board', true, 'clean', 96)])).label).toBe('✓ чисто · 96');
    const checkStep = goalSteps('pentatonic', 'A').find(item => item.rule === 'check')!;
    const spec = specOf(checkStep);
    expect(stepMastery(checkStep, recordsByMaterial([check(spec, 4)]))).toEqual({ state: 'progress', label: 'в работе · 4 из 6' });
    expect(stepMastery(checkStep, recordsByMaterial([check(spec, 6, 'name-degree')])).state).toBe('new');
    expect(stepMastery(checkStep, recordsByMaterial([check(spec, 4), check(spec, 5)]))).toEqual({ state: 'done', label: '✓ 5 из 6' });
  });
  it('освоение считается по материалу: запись под ключом своего упражнения засчитывается и после удаления упражнения', () => {
    const step = goalSteps('blues', 'A')[0];
    const record = play(specOf(step), 'memory', true, 'clean', 80, 'user:my-blues');
    const progress = goalProgress('blues', 'A', [record]);
    expect(progress.steps[0].mastery.state).toBe('done');
    expect(progress).toMatchObject({ done: 1, total: 5 });
    expect(progress.next?.id).toBe('scale-compact-a');
  });
  it('«Добавить шаги цели»: разминка и два следующих шага, без повторов и не больше предела плана', () => {
    const progress = goalProgress('pentatonic', 'A', []);
    const first = addGoalSteps(createPlan('2026-11-13'), progress, []);
    expect(first.added.map(step => step.id)).toEqual(['chromatic', 'form-a', 'form-b']);
    expect(first.plan.steps).toHaveLength(3);
    const again = addGoalSteps(first.plan, progress, []);
    expect(again.added).toHaveLength(0);
    expect(addGoalSteps(createPlan('2026-11-13'), goalProgress('four-fingers', null, []), []).added.map(step => step.id)).toEqual(['chromatic', 'spider-1234']);
    let full = createPlan('2026-11-13');
    for (let index = 0; full.steps.length < MAX_PLAN_STEPS - 1; index++) full = addStep(full, { id: `f${index}`, content: goalSteps('chords', 'C')[index].content, minutes: 3 });
    const capped = addGoalSteps(full, goalProgress('notes', null, []), []);
    expect(capped.plan.steps).toHaveLength(MAX_PLAN_STEPS);
    expect(capped.added).toHaveLength(1);
  });
  it('«Сегодня» и бейдж знают цель; неизвестная цель хранилища — цели нет', () => {
    const progress = goalProgress('pentatonic', 'E', []);
    expect(goalLine(progress)).toBe('Цель: Пентатоника на всём грифе · Em · освоено 0/14');
    expect(basicsBadge(basicsCourse([]), progress)).toBe('0/14');
    const hero = heroModel({ plan: createPlan('2026-11-13'), records: [], userExercises: [], firstRun: false }, progress);
    expect(hero).toMatchObject({ mode: 'goal', eyebrow: 'Следующий шаг цели', title: 'Форма пентатоники вверх-вниз', goalLine: goalLine(progress) });
    expect(recommendationCards([], false, { progress, step: progress.steps[1].step })[0]).toMatchObject({ id: 'goal', eyebrow: 'Шаг цели' });
    expect(storedGoal({ id: 'pentatonic-neck', root: 'A' })).toBeNull();
    expect(storedGoal({ id: 'four-fingers', root: null })).toEqual({ id: 'four-fingers', root: null });
  });
});
