import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import {
  addStep, completeStep, createPlan, currentStep, doneMinutes, moveStep, planFromTemplate, plannedMinutes, removeStep, selectStep, validatePlan,
} from '../src/practice/plan';
import { builtinLibrary, countByCategory, filterLibrary, userLibrary, validateUserExercise } from '../src/practice/library';
import { checkProgress, difficulties, exerciseProgress, minutesByDay, playedKeys, type PracticeRecord } from '../src/practice/results';
import { recommend } from '../src/practice/recommend';

const connect = createExerciseSpec('connect-forms');
const chromatic = createExerciseSpec('chromatic-position');
const step = (id: string, spec = chromatic, minutes = 3) => ({ id, content: { kind: 'exercise' as const, spec }, minutes });

describe('план на сегодня', () => {
  it('первый незавершённый шаг становится текущим; выполнение передаёт его следующему', () => {
    let plan = createPlan('2026-11-12', [step('a'), step('b', connect, 5), step('c')]);
    expect(plan.steps.map(item => item.status)).toEqual(['current', 'pending', 'pending']);
    plan = completeStep(plan, 'a');
    expect(plan.steps.map(item => item.status)).toEqual(['done', 'current', 'pending']);
    expect([plannedMinutes(plan), doneMinutes(plan), currentStep(plan)?.id]).toEqual([11, 3, 'b']);
    plan = completeStep(completeStep(plan, 'b'), 'c');
    expect(currentStep(plan)).toBeNull();
  });
  it('добавление, удаление, перестановка и выбор шага сохраняют один текущий', () => {
    let plan = createPlan('2026-11-12', [step('a'), step('b')]);
    plan = addStep(plan, step('c', connect));
    plan = moveStep(plan, 'c', -1);
    expect(plan.steps.map(item => item.id)).toEqual(['a', 'c', 'b']);
    plan = selectStep(plan, 'b');
    expect(plan.steps.map(item => item.status)).toEqual(['pending', 'pending', 'current']);
    plan = removeStep(plan, 'b');
    expect(plan.steps.map(item => `${item.id}:${item.status}`)).toEqual(['a:current', 'c:pending']);
  });
  it('завершённый шаг не переставляется и не выбирается', () => {
    const plan = completeStep(createPlan('2026-11-12', [step('a'), step('b')]), 'a');
    expect(moveStep(plan, 'b', -1)).toBe(plan);
    expect(selectStep(plan, 'a')).toBe(plan);
  });
  it('строгая проверка отклоняет два текущих шага, повтор ID, лишние поля и неверную дату', () => {
    const good = JSON.parse(JSON.stringify(createPlan('2026-11-12', [step('a'), step('b')])));
    const bad = [
      { ...good, steps: good.steps.map((item: { status: string }) => ({ ...item, status: 'current' })) },
      { ...good, steps: [good.steps[0], good.steps[0]] },
      { ...good, extra: true },
      { ...good, localDate: '2026-13-01' },
      { ...good, steps: [{ ...good.steps[0], minutes: 0 }] },
      { ...good, steps: [{ ...good.steps[0], content: { kind: 'exercise', spec: { ...chromatic, params: { startFret: 30 } } } }] },
    ];
    for (const value of bad) expect(() => validatePlan(value)).toThrow(RangeError);
    expect(validatePlan(good)).toEqual(createPlan('2026-11-12', [step('a'), step('b')]));
  });
  it('шаблоны планов строятся и проходят проверку', () => {
    expect(plannedMinutes(planFromTemplate('2026-11-12', 'standard'))).toBe(15);
    expect(planFromTemplate('2026-11-12', 'firstRun').steps).toHaveLength(3);
    expect(planFromTemplate('2026-11-12', 'standard').steps[3].content.kind).toBe('check');
  });
});

describe('библиотека', () => {
  it('22 встроенных шаблона в 9 категориях; «Играть от» меняет тонику только у шаблонов с тоникой', () => {
    const items = builtinLibrary('E');
    expect(items).toHaveLength(22);
    expect(Object.values(countByCategory(items)).reduce((a, b) => a + b, 0)).toBe(22);
    expect((items.find(item => item.id === 'tpl:connect-forms')!.spec.params as { root: string }).root).toBe('E');
    expect(items.find(item => item.id === 'tpl:chromatic-position')!.spec).toEqual(chromatic);
  });
  it('фильтры по категории, структуре, понятию и статусу', () => {
    const items = builtinLibrary();
    expect(filterLibrary(items, { category: 'connections' }).map(item => item.id)).toEqual(['tpl:connect-forms', 'tpl:pentatonic-neck']);
    expect(filterLibrary(items, { structureId: 'minor-pentatonic' }).length).toBeGreaterThanOrEqual(5);
    expect(filterLibrary(items, { concept: 'shared-notes' }).map(item => item.id)).toContain('tpl:connect-forms');
    const played = new Set(['builtin:connect-forms']);
    expect(filterLibrary(items, { status: 'played' }, played).map(item => item.id)).toEqual(['tpl:connect-forms']);
    expect(filterLibrary(items, { status: 'new' }, played)).toHaveLength(21);
  });
  it('собственные упражнения проверяются строго и попадают в библиотеку по своему ключу', () => {
    const own = validateUserExercise({ version: 'user-exercise-v1', id: 'my-1', name: 'Связка в E', spec: createExerciseSpec('connect-forms', { root: 'E' }), createdAt: '2026-11-12T10:00:00.000Z' });
    expect(userLibrary([own])[0]).toMatchObject({ key: 'user:my-1', title: 'Связка в E', category: 'connections', builtin: false });
    for (const changed of [{ name: '' }, { name: ' x' }, { id: '../x' }, { createdAt: 'вчера' }, { extra: 1 }]) {
      expect(() => validateUserExercise({ ...own, ...changed })).toThrow(RangeError);
    }
  });
});

const play = (date: string, assessment: 'clean' | 'errors' | 'slow', bpm: number, key = 'builtin:connect-forms', spec = connect): PracticeRecord =>
  ({ kind: 'play', id: `play-${date}-${key}-${bpm}`, exerciseKey: key, title: key === 'builtin:connect-forms' ? 'Связка соседних форм' : 'Хроматика 1-2-3-4 в позиции', spec, assessment, bpm, activeMs: 300000, localDate: date, occurredAt: `${date}T18:00:00.000Z`, view: 'both', wholePass: true });
const check = (date: string, answers: { degree: string; outcome: 'correct' | 'corrected' | 'revealed' | 'skipped' | 'unanswered'; errors: number }[]): PracticeRecord =>
  ({ kind: 'check', id: `check-${date}`, exerciseKey: 'builtin:pentatonic-form', title: 'Ступени формы B', spec: createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' }), checkKind: 'name-degree', ear: false, activeMs: 120000, localDate: date, occurredAt: `${date}T18:10:00.000Z`, answers });

const history: PracticeRecord[] = [
  play('2026-11-01', 'clean', 60), play('2026-11-04', 'errors', 72), play('2026-11-06', 'clean', 72), play('2026-11-10', 'errors', 76), play('2026-11-11', 'clean', 76),
  play('2026-11-03', 'clean', 84, 'builtin:chromatic-position', chromatic), play('2026-11-08', 'slow', 88, 'builtin:chromatic-position', chromatic),
  check('2026-10-28', [{ degree: 'b7', outcome: 'corrected', errors: 1 }, { degree: '1', outcome: 'correct', errors: 0 }]),
  check('2026-11-06', [{ degree: 'b7', outcome: 'revealed', errors: 0 }, { degree: '5', outcome: 'correct', errors: 0 }, { degree: '4', outcome: 'skipped', errors: 0 }]),
];

describe('прогресс', () => {
  it('лучший комфортный темп — самый быстрый проход «Чисто»; серия в порядке времени', () => {
    const [connectProgress, chromaticProgress] = exerciseProgress(history);
    expect(connectProgress).toMatchObject({ exerciseKey: 'builtin:connect-forms', passes: 5, bestCleanBpm: 76, firstBpm: 60, last: { localDate: '2026-11-11', bpm: 76, assessment: 'clean' } });
    expect(connectProgress.series.map(item => item.bpm)).toEqual([60, 72, 72, 76, 76]);
    expect(chromaticProgress).toMatchObject({ bestCleanBpm: 84, last: { assessment: 'slow', bpm: 88 } });
  });
  it('«Проверь себя» считается отдельно: самостоятельно — только с первой попытки без показа', () => {
    expect(checkProgress(history)[0]).toMatchObject({ checks: 2, last: { localDate: '2026-11-06', independent: 1, total: 3 } });
  });
  it('трудные места: дважды «С ошибками», «Не успевал» выше лучшего, ступень с двумя промахами', () => {
    expect(difficulties(history)).toEqual([
      { kind: 'errors', exerciseKey: 'builtin:connect-forms', title: 'Связка соседних форм', count: 2, dates: ['2026-11-04', '2026-11-10'] },
      { kind: 'slow', exerciseKey: 'builtin:chromatic-position', title: 'Хроматика 1-2-3-4 в позиции', bpm: 88, bestCleanBpm: 84, dates: ['2026-11-08'] },
      { kind: 'degree', exerciseKey: 'builtin:pentatonic-form', title: 'Ступени формы B', degree: 'b7', count: 2, dates: ['2026-10-28', '2026-11-06'] },
    ]);
  });
  it('«Не успевал» на темпе не выше лучшего «Чисто» не считается трудным местом', () => {
    expect(difficulties([play('2026-11-01', 'clean', 90), play('2026-11-02', 'slow', 80)])).toEqual([]);
  });
  it('минуты по дням разделяются по источнику', () => {
    expect([...minutesByDay(history, 'check')]).toEqual([['2026-10-28', 2], ['2026-11-06', 2]]);
    expect(minutesByDay(history, 'play').get('2026-11-06')).toBe(5);
    expect(minutesByDay(history).get('2026-11-06')).toBe(7);
    expect([...playedKeys(history)].sort()).toEqual(['builtin:chromatic-position', 'builtin:connect-forms']);
  });
});

describe('рекомендации «Сегодня»', () => {
  it('после связки A→B — связка B→C, затем трудное место и понятие', () => {
    const items = recommend(history);
    expect(items.map(item => item.kind)).toEqual(['next', 'repeat', 'concept']);
    expect(items[0].title).toBe('Связка B → C');
    expect((items[0].spec!.params as { shapeId: string }).shapeId).toBe('penta-b');
    expect(items[1].reason).toContain('«С ошибками» (2)');
    expect(items[2].concept).toBe('shared-notes');
  });
  it('без истории рекомендаций нет — «Сегодня» предлагает план первого запуска', () => {
    expect(recommend([])).toEqual([]);
  });
});
