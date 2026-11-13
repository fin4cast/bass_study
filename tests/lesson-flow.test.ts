import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import { builtinLibrary, type UserExercise } from '../src/practice/library';
import { materialId } from '../src/practice/material';
import { createPlan, completeStep, planFromTemplate, type CheckSpec } from '../src/practice/plan';
import { practiceRecords } from '../src/practice/history';
import { difficulties, type PracticeRecord } from '../src/practice/results';
import { MAX_EXERCISE_VIEWS, type ExerciseView, type PlayPreferences } from '../src/storage/model';
import { backupFileName, backupVersion } from '../src/app/backup';
import {
  addToPlan, bpmForExercise, checkEntry, describeProgressRow, exerciseKey, fromPlayDefaults, hasPlayed, nextPlanStep, planAfterCheck, planAfterRating,
  planForToday, playRatingEntry, plannedProgressIds, rememberView, repeatContent, specForKey, stepPosition, todayKey, toPlayDefaults, viewForExercise,
} from '../src/app/lesson-flow';
import { difficultyId, progressRows } from '../src/ui/progress/model';

const TODAY = '2026-11-12';
const penta = createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' });
const arpeggio = createExerciseSpec('arpeggio-1358');
const own: UserExercise = { version: 'user-exercise-v1', id: 'own-1', name: 'Моя пентатоника', spec: penta, createdAt: '2026-11-10T10:00:00.000Z' };
const meta = (id: string, occurredAt = '2026-11-12T10:00:00.000Z') => ({ id, occurredAt, timeZone: 'Europe/Moscow' });
const playRecord = (key: string, bpm: number, occurredAt: string, assessment: 'clean' | 'errors' | 'slow' = 'clean', spec = arpeggio): PracticeRecord =>
  ({ kind: 'play', id: `play-${key}-${occurredAt}`, exerciseKey: key, title: 'Арпеджио', spec, assessment, bpm, activeMs: 60000, localDate: occurredAt.slice(0, 10), occurredAt, view: 'both', wholePass: true });
const checkSpec = (exercise = penta): CheckSpec => ({ version: 'check-v1', exercise, kind: 'name-degree', count: 6, ear: false });

describe('план на сегодня', () => {
  it('локальная дата устройства — YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('план этого дня сохраняется как есть; первый запуск получает шаблон «Основ»', () => {
    const stored = planFromTemplate(TODAY, 'standard');
    expect(planForToday(stored, TODAY, true)).toBe(stored);
    const first = planForToday(null, TODAY, true);
    expect(first.localDate).toBe(TODAY);
    expect(first.steps.map(step => step.content.kind === 'exercise' && step.content.spec.templateId)).toEqual(['note-all-positions', 'octaves', 'chromatic-position']);
    expect(first.steps[0].status).toBe('current');
    expect(planForToday(null, TODAY, false).steps).toEqual([]);
  });

  it('план прошлого дня переносит только незавершённые шаги, текущим становится первый', () => {
    const yesterday = planFromTemplate('2026-11-11', 'standard');
    const done = completeStep(yesterday, yesterday.steps[0].id);
    const today = planForToday(done, TODAY, false);
    expect(today.localDate).toBe(TODAY);
    expect(today.steps.map(step => step.id)).toEqual(yesterday.steps.slice(1).map(step => step.id));
    expect(today.steps.map(step => step.status)).toEqual(['current', 'pending', 'pending']);
    const finished = yesterday.steps.reduce((plan, step) => completeStep(plan, step.id), yesterday);
    expect(planForToday(finished, TODAY, false).steps).toEqual([]);
  });
});

describe('ключ и вид упражнения', () => {
  it('встроенное упражнение — builtin:<материал> (D-049), своё — user:<id>', () => {
    const fromC = builtinLibrary('C').find(item => item.spec.templateId === 'pentatonic-form')!.spec;
    expect(fromC).not.toEqual(createExerciseSpec('pentatonic-form'));
    expect(exerciseKey(fromC)).toBe('builtin:pentatonic-form.C.minor-pentatonic.penta-a');
    expect(exerciseKey(createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' }))).not.toBe(exerciseKey(createExerciseSpec('pentatonic-form')));
    expect(exerciseKey(arpeggio, [own])).toBe('builtin:arpeggio-1358.C.major-triad.compact-e');
    expect(exerciseKey(penta, [own])).toBe('user:own-1');
  });

  it('запомненный вид важнее умолчаний; новое упражнение открывается видом нового упражнения', () => {
    const play: Pick<PlayPreferences, 'defaultView' | 'newExerciseView'> = { defaultView: 'both', newExerciseView: 'board' };
    const lesson = { viewByExercise: { 'builtin:arpeggio-1358': 'memory' as ExerciseView } };
    expect(viewForExercise('builtin:arpeggio-1358', false, lesson, play)).toBe('memory');
    expect(viewForExercise('builtin:octaves', false, lesson, play)).toBe('board');
    expect(viewForExercise('builtin:octaves', true, lesson, play)).toBe('both');
    expect(viewForExercise('builtin:octaves', false, lesson, { defaultView: 'tab', newExerciseView: null })).toBe('tab');
    expect(viewForExercise('constructor', false, { viewByExercise: {} }, play)).toBe('board');
  });

  it('вид запоминается по ключу, старейшие ключи сверх предела отбрасываются', () => {
    const views = { 'builtin:a': 'board', 'builtin:b': 'tab' } as Record<string, ExerciseView>;
    expect(rememberView(views, 'builtin:a', 'board')).toBe(views);
    expect(Object.entries(rememberView(views, 'builtin:a', 'memory'))).toEqual([['builtin:b', 'tab'], ['builtin:a', 'memory']]);
    let many: Readonly<Record<string, ExerciseView>> = {};
    for (let index = 0; index <= MAX_EXERCISE_VIEWS; index++) many = rememberView(many, `builtin:k${index}`, 'both');
    expect(Object.keys(many)).toHaveLength(MAX_EXERCISE_VIEWS);
    expect(many['builtin:k0']).toBeUndefined();
    expect(many[`builtin:k${MAX_EXERCISE_VIEWS}`]).toBe('both');
  });

  it('темп открытия — последний сыгранный темп упражнения, иначе умолчание', () => {
    const records = [playRecord('builtin:arpeggio-1358', 70, '2026-11-11T10:00:00.000Z'), playRecord('builtin:arpeggio-1358', 64, '2026-11-12T09:00:00.000Z', 'slow'), playRecord('builtin:octaves', 90, '2026-11-12T11:00:00.000Z')];
    expect(bpmForExercise('builtin:arpeggio-1358', records, 72)).toBe(64);
    expect(bpmForExercise('builtin:chromatic-position', records, 72)).toBe(72);
    // Новый материал того же шаблона (другая форма) начинается с последнего темпа шаблона, а не с запасного.
    expect(bpmForExercise('builtin:arpeggio-1358.G.major-triad.compact-a', records, 72)).toBe(64);
    expect(bpmForExercise('user:other', records, 72)).toBe(72);
    expect(hasPlayed('builtin:octaves', records)).toBe(true);
    expect(hasPlayed('builtin:chromatic-position', records)).toBe(false);
  });
});

describe('план после самооценки и проверки', () => {
  const plan = planFromTemplate(TODAY, 'standard');
  const [first, second, , last] = plan.steps;

  it('«Чисто» завершает шаг из плана, остальные отметки оставляют его текущим', () => {
    const clean = planAfterRating(plan, first.id, 'clean');
    expect(clean.steps.map(step => step.status)).toEqual(['done', 'current', 'pending', 'pending']);
    expect(planAfterRating(plan, first.id, 'errors')).toBe(plan);
    expect(planAfterRating(plan, first.id, 'slow')).toBe(plan);
    expect(planAfterRating(plan, null, 'clean')).toBe(plan);
    expect(planAfterRating(clean, first.id, 'clean')).toBe(clean);
    expect(planAfterRating(plan, 'missing', 'clean')).toBe(plan);
  });

  it('«К следующему шагу» завершает проверку и ведёт к текущему шагу; после последнего — в «Сегодня»', () => {
    const afterSecond = planAfterCheck(planAfterRating(plan, first.id, 'clean'), second.id);
    expect(nextPlanStep(afterSecond)).toEqual({ stepId: plan.steps[2].id, content: plan.steps[2].content });
    const allButLast = plan.steps.slice(0, 3).reduce((value, step) => completeStep(value, step.id), plan);
    const finished = planAfterCheck(allButLast, last.id);
    expect(finished.steps.every(step => step.status === 'done')).toBe(true);
    expect(nextPlanStep(finished)).toBeNull();
    expect(planAfterCheck(plan, null)).toBe(plan);
  });

  it('номер шага для подписей', () => {
    expect(stepPosition(plan, last.id)).toEqual({ index: 4, total: 4 });
    expect(stepPosition(plan, null)).toBeNull();
    expect(stepPosition(plan, 'missing')).toBeNull();
  });
});

describe('«Повторить» и «В план» из «Прогресса»', () => {
  it('трудная ступень добавляет проверку, остальное — упражнение; без описания — ничего', () => {
    const degree = { kind: 'degree' as const, exerciseKey: 'builtin:pentatonic-form', title: 'Форма', degree: 'b7', count: 2, dates: [TODAY] };
    expect(repeatContent(degree, penta)).toEqual({ kind: 'check', spec: { version: 'check-v1', exercise: penta, kind: 'name-degree', count: 6, ear: false } });
    expect(repeatContent('builtin:pentatonic-form', penta)).toEqual({ kind: 'exercise', spec: penta });
    expect(repeatContent({ kind: 'errors', exerciseKey: 'builtin:pentatonic-form', title: 'Форма', count: 2, dates: [TODAY] }, penta)).toEqual({ kind: 'exercise', spec: penta });
    expect(repeatContent('builtin:pentatonic-form', null)).toBeNull();
  });

  it('шаг добавляется на 3–5 минут и не повторяется, пока не выполнен', () => {
    const empty = createPlan(TODAY);
    const added = addToPlan(empty, { kind: 'exercise', spec: arpeggio });
    expect(added.steps).toHaveLength(1);
    expect(added.steps[0].minutes).toBeGreaterThanOrEqual(3);
    expect(added.steps[0].minutes).toBeLessThanOrEqual(5);
    expect(added.steps[0].status).toBe('current');
    expect(addToPlan(added, { kind: 'exercise', spec: arpeggio })).toBe(added);
    const check = addToPlan(added, { kind: 'check', spec: checkSpec() });
    expect(check.steps.map(step => step.content.kind)).toEqual(['exercise', 'check']);
    expect(new Set(check.steps.map(step => step.id)).size).toBe(2);
  });

  it('уже запланированные строки и трудные места отмечаются по ключу упражнения и виду шага', () => {
    const records = [
      playRecord(exerciseKey(arpeggio), 70, '2026-11-11T10:00:00.000Z', 'errors'),
      playRecord(exerciseKey(arpeggio), 70, '2026-11-12T10:00:00.000Z', 'errors'),
      { kind: 'check', id: 'check-1', exerciseKey: exerciseKey(penta), title: 'Проверь себя', spec: penta, checkKind: 'name-degree', ear: false, activeMs: 1000, localDate: TODAY, occurredAt: '2026-11-12T11:00:00.000Z',
        answers: [{ degree: 'b7', outcome: 'revealed', errors: 0 }, { degree: 'b7', outcome: 'skipped', errors: 0 }] },
    ] satisfies PracticeRecord[];
    const [errors, degree] = difficulties(records);
    const plan = addToPlan(createPlan(TODAY), { kind: 'exercise', spec: arpeggio });
    expect([...plannedProgressIds(plan, records)].sort()).toEqual([exerciseKey(arpeggio), difficultyId(errors)].sort());
    const both = addToPlan(plan, { kind: 'check', spec: checkSpec() });
    expect(plannedProgressIds(both, records)).toContain(difficultyId(degree));
    expect(plannedProgressIds(completeStep(plan, plan.steps[0].id), records).size).toBe(0);
  });

  it('описание по ключу: последний проход, затем своё упражнение и шаблон библиотеки', () => {
    const records = [playRecord('builtin:pentatonic-form', 70, '2026-11-12T10:00:00.000Z', 'clean', penta)];
    const sources = { records, history: [], userExercises: [own], playFrom: null };
    expect(specForKey('builtin:pentatonic-form', sources)).toEqual(penta);
    expect(specForKey('user:own-1', sources)).toEqual(penta);
    expect(specForKey(`builtin:${materialId(createExerciseSpec('octaves'))}`, sources)).toEqual(createExerciseSpec('octaves'));
    // Материала нет ни в записях, ни в библиотеке: честное «не найдено», а не подмена другим материалом шаблона.
    expect(specForKey('builtin:octaves.D', sources)).toBeNull();
    expect(specForKey('user:missing', sources)).toBeNull();
  });
});

describe('записи истории занятия', () => {
  it('самооценка — ручная отметка упражнения с видом, темпом в пределах и активным временем', () => {
    const entry = playRatingEntry({ spec: penta, userExercises: [own], view: 'tab', wholePass: true, assessment: 'clean', bpm: 300.4, activeMs: 61234.6 }, meta('exercise-1'));
    expect(entry.result).toMatchObject({ kind: 'manual', source: 'self-report', assessment: 'clean', comfortableBpm: 220, durationMs: 61235, context: null,
      material: { kind: 'exercise', key: 'user:own-1', title: 'Моя пентатоника', spec: penta, view: 'tab' } });
    expect(practiceRecords([entry])).toEqual([expect.objectContaining({ kind: 'play', exerciseKey: 'user:own-1', bpm: 220, assessment: 'clean', localDate: '2026-11-12' })]);
  });

  it('итог «Проверь себя» без ответов не пишется; активное время ограничено', () => {
    expect(checkEntry({ spec: checkSpec(), userExercises: [], activeMs: 1000, answers: [] }, meta('check-0'))).toBeNull();
    const entry = checkEntry({ spec: checkSpec(), userExercises: [], activeMs: 10 * 60 * 60 * 1000, answers: [{ degree: '1', outcome: 'correct', errors: 0 }] }, meta('check-1'))!;
    expect(entry.result).toMatchObject({ kind: 'check', source: 'screen-check', exerciseKey: exerciseKey(penta), activeMs: 6 * 60 * 60 * 1000 });
    expect(entry.result.kind === 'check' && entry.result.title).toMatch(/^Проверь себя: /);
    const records = practiceRecords([entry]);
    expect(records).toEqual([expect.objectContaining({ kind: 'check', exerciseKey: exerciseKey(penta), checkKind: 'name-degree', ear: false })]);
    const [row] = progressRows(records, 'check');
    expect(describeProgressRow(row, [entry])).toMatch(/6 вопросов$/);
  });
});

describe('умолчания экрана игры и копия', () => {
  it('умолчания «Настроек» и настройки хранения переводятся без потерь', () => {
    const play: PlayPreferences = { defaultView: 'both', newExerciseView: 'board', countIn: false, labels: 'degree', bpm: 96 };
    expect(toPlayDefaults(play)).toEqual({ view: 'tabBoard', newExerciseView: 'board', countIn: false, labels: 'degrees', bpm: 96 });
    expect(fromPlayDefaults(toPlayDefaults(play))).toEqual(play);
    const plain: PlayPreferences = { defaultView: 'memory', newExerciseView: null, countIn: true, labels: 'finger', bpm: 60 };
    expect(fromPlayDefaults(toPlayDefaults(plain))).toEqual(plain);
  });

  it('версия копии распознаётся до полной проверки; чужой файл и не-JSON — без версии', () => {
    expect(backupVersion(JSON.stringify({ format: 'bass-study-backup', schemaVersion: 10 }))).toBe(10);
    expect(backupVersion(JSON.stringify({ format: 'other', schemaVersion: 11 }))).toBeUndefined();
    expect(backupVersion('[1,2]')).toBeUndefined();
    expect(backupVersion('{oops')).toBeUndefined();
    expect(backupFileName('bass-study-backup', new Date(2026, 10, 2))).toBe('bass-study-backup-2026-11-02.json');
  });
});
