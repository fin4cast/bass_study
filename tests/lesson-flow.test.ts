import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import { builtinLibrary, type UserExercise } from '../src/practice/library';
import { materialId } from '../src/practice/material';
import { createPlan, completeStep } from '../src/practice/plan';
import { checkId, degreeCheck, validateCheckSpec, type CheckSpec } from '../src/practice/check';
import { practiceRecords } from '../src/practice/history';
import { difficulties, type PracticeRecord } from '../src/practice/results';
import { MAX_EXERCISE_VIEWS, type ExerciseView, type PlayPreferences } from '../src/storage/model';
import { backupFileName, backupVersion } from '../src/app/backup';
import {
  addToPlan, bpmForExercise, planAfterSkipChange, checkEntry, checkForKey, describeProgressRow, exerciseKey, fromPlayDefaults, hasPlayed, nextPlanStep, planAfterCheck, planAfterRating,
  planForToday, planStepInfo, playRatingEntry, plannedProgressIds, rememberExerciseSettings, EMPTY_EXERCISE_SETTINGS, playSettingsFor, repeatContent, specForKey, stepPosition, todayKey, toPlayDefaults, variantChange, viewForExercise,
} from '../src/app/lesson-flow';
import { difficultyId, progressRows } from '../src/ui/progress/model';
import { DEFAULT_PREFERENCES } from '../src/storage/model';

const TODAY = '2026-11-12';
const penta = createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' });
const arpeggio = createExerciseSpec('arpeggio-1358');
const own: UserExercise = { version: 'user-exercise-v1', id: 'own-1', name: 'Моя пентатоника', spec: penta, createdAt: '2026-11-10T10:00:00.000Z' };
const meta = (id: string, occurredAt = '2026-11-12T10:00:00.000Z') => ({ id, occurredAt, timeZone: 'Europe/Moscow' });
const playRecord = (key: string, bpm: number, occurredAt: string, assessment: 'clean' | 'errors' | 'slow' = 'clean', spec = arpeggio): PracticeRecord =>
  ({ kind: 'play', id: `play-${key}-${occurredAt}`, exerciseKey: key, title: 'Арпеджио', spec, assessment, bpm, activeMs: 60000, localDate: occurredAt.slice(0, 10), occurredAt, view: 'both', wholePass: true, practice: { rhythm: 'eighths', echo: false, groove: null } });
/** План из четырёх шагов: три упражнения и проверка — основа тестов плана. */
const fourStepPlan = (date: string) => createPlan(date, [
  { id: 'step-1', content: { kind: 'exercise', spec: createExerciseSpec('chromatic-position') }, minutes: 3 },
  { id: 'step-2', content: { kind: 'exercise', spec: createExerciseSpec('connect-forms') }, minutes: 5 },
  { id: 'step-3', content: { kind: 'exercise', spec: arpeggio }, minutes: 4 },
  { id: 'step-4', content: { kind: 'check', spec: degreeCheck(createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' }), 'name-degree', 6) }, minutes: 3 },
]);
const checkSpec = (exercise = penta): CheckSpec => degreeCheck(exercise, 'name-degree', 6);

describe('план на сегодня', () => {
  it('локальная дата устройства — YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('план этого дня сохраняется как есть; без плана день начинается с пустого', () => {
    const stored = fourStepPlan(TODAY);
    expect(planForToday(stored, TODAY)).toBe(stored);
    const first = planForToday(null, TODAY);
    expect(first.localDate).toBe(TODAY);
    expect(first.steps).toEqual([]);
  });

  it('план прошлого дня переносит только незавершённые шаги, текущим становится первый', () => {
    const yesterday = fourStepPlan('2026-11-11');
    const done = completeStep(yesterday, yesterday.steps[0].id);
    const today = planForToday(done, TODAY);
    expect(today.localDate).toBe(TODAY);
    expect(today.steps.map(step => step.id)).toEqual(yesterday.steps.slice(1).map(step => step.id));
    expect(today.steps.map(step => step.status)).toEqual(['current', 'pending', 'pending']);
    const finished = yesterday.steps.reduce((plan, step) => completeStep(plan, step.id), yesterday);
    expect(planForToday(finished, TODAY).steps).toEqual([]);
  });
});

describe('«Уже умею» и план дня', () => {
  const composed = [
    { id: 'd1', content: { kind: 'exercise' as const, spec: createExerciseSpec('connect-forms') }, minutes: 4, programStep: 't1-pulse.quarters' },
  ];
  it('пока ничего не выполнено, шаги программы собираются заново, ручные остаются', () => {
    const stored = createPlan(TODAY, [
      { id: 'd1', content: { kind: 'exercise', spec: createExerciseSpec('chromatic-position') }, minutes: 3, programStep: 'f1-ea5.naturals' },
      { id: 'manual-1', content: { kind: 'exercise', spec: createExerciseSpec('arpeggio-1358') }, minutes: 5 },
    ]);
    const next = planAfterSkipChange(stored, TODAY, () => composed)!;
    expect(next.steps.map(step => [step.id, step.programStep])).toEqual([['d1', 't1-pulse.quarters'], ['manual-1', undefined]]);
    expect(next.steps[0].status).toBe('current');
  });
  it('после выполненного шага, в другой день и без плана — без изменений', () => {
    const stored = createPlan(TODAY, [{ id: 'd1', content: composed[0].content, minutes: 4, programStep: 'f1-ea5.naturals' }, { id: 'd2', content: composed[0].content, minutes: 4 }]);
    const started = completeStep(stored, 'd1');
    expect(planAfterSkipChange(started, TODAY, () => composed)).toBe(started);
    expect(planAfterSkipChange(stored, '2026-11-13', () => composed)).toBe(stored);
    expect(planAfterSkipChange(null, TODAY, () => composed)).toBeNull();
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
    const lesson = { exerciseSettings: { 'builtin:arpeggio-1358': { view: 'memory' as ExerciseView, bpm: null, targetBpm: null, rhythm: 'eighths' as const, groove: null } } };
    expect(viewForExercise('builtin:arpeggio-1358', false, lesson, play)).toBe('memory');
    expect(viewForExercise('builtin:octaves', false, lesson, play)).toBe('board');
    expect(viewForExercise('builtin:octaves', true, lesson, play)).toBe('both');
    expect(viewForExercise('builtin:octaves', false, lesson, { defaultView: 'tab', newExerciseView: null })).toBe('tab');
    expect(viewForExercise('constructor', false, { exerciseSettings: {} }, play)).toBe('board');
  });

  it('настройки упражнения запоминаются по ключу; последний — в конце, не больше предела', () => {
    const all = { 'builtin:a': { ...EMPTY_EXERCISE_SETTINGS, view: 'board' as ExerciseView }, 'builtin:b': { ...EMPTY_EXERCISE_SETTINGS, view: 'tab' as ExerciseView } };
    expect(rememberExerciseSettings(all, 'builtin:a', { view: 'board' })).toBe(all);
    const next = rememberExerciseSettings(all, 'builtin:a', { bpm: 84, rhythm: 'quarters' });
    expect(Object.keys(next)).toEqual(['builtin:b', 'builtin:a']);
    expect(next['builtin:a']).toEqual({ view: 'board', bpm: 84, targetBpm: null, rhythm: 'quarters', groove: null });
    let many: Readonly<Record<string, typeof EMPTY_EXERCISE_SETTINGS>> = {};
    for (let index = 0; index <= MAX_EXERCISE_VIEWS; index++) many = rememberExerciseSettings(many, `builtin:k${index}`, { view: 'both' });
    expect(Object.keys(many)).toHaveLength(MAX_EXERCISE_VIEWS);
    expect(many['builtin:k0']).toBeUndefined();
    expect(many[`builtin:k${MAX_EXERCISE_VIEWS}`].view).toBe('both');
  });

  it('настройки экрана игры: темп и ритм упражнения, общий звук; «как играть» шага главнее', () => {
    const prefs = DEFAULT_PREFERENCES;
    const key = 'builtin:arpeggio-1358.C.major-triad.compact-e';
    const lesson = { exerciseSettings: { [key]: { view: null, bpm: 84, targetBpm: 100, rhythm: 'quarters' as const, groove: 'rock' } } };
    expect(playSettingsFor(arpeggio, key, { lesson, play: prefs.play, records: [] })).toMatchObject({ bpm: 84, targetBpm: 100, rhythm: 'quarters', groove: 'rock', echo: false, reference: 'auto', countInBars: 1 });
    expect(playSettingsFor(arpeggio, key, { lesson, play: prefs.play, records: [], practice: { rhythm: 'eighths', echo: true, groove: null } })).toMatchObject({ rhythm: 'eighths', echo: true, groove: null });
    expect(playSettingsFor(arpeggio, key, { lesson: { exerciseSettings: {} }, play: prefs.play, records: [] })).toMatchObject({ bpm: prefs.play.bpm, targetBpm: 96, rhythm: 'eighths' });
  });

  it('темп открытия — последний сыгранный темп упражнения, иначе умолчание', () => {
    const records = [playRecord('builtin:arpeggio-1358', 70, '2026-11-11T10:00:00.000Z'), playRecord('builtin:arpeggio-1358', 64, '2026-11-12T09:00:00.000Z', 'slow'), playRecord('builtin:octaves', 90, '2026-11-12T11:00:00.000Z')];
    // Последний проход — «Не успевал» на 64: темп не повышается, предлагается 60.
    expect(bpmForExercise('builtin:arpeggio-1358', records, 72)).toBe(60);
    expect(bpmForExercise('builtin:chromatic-position', records, 72)).toBe(72);
    // Новый материал того же шаблона (другая форма) начинается с последнего темпа шаблона, а не с запасного.
    expect(bpmForExercise('builtin:arpeggio-1358.G.major-triad.compact-a', records, 72)).toBe(60);
    expect(bpmForExercise('user:other', records, 72)).toBe(72);
    expect(hasPlayed('builtin:octaves', records)).toBe(true);
    expect(hasPlayed('builtin:chromatic-position', records)).toBe(false);
  });
});

describe('план после самооценки и проверки', () => {
  const plan = fourStepPlan(TODAY);
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
    const target = { kind: 'target' as const, exerciseKey: `check:${checkId(degreeCheck(penta, 'name-degree', 6))}`, title: 'Форма', target: 'b7', check: degreeCheck(penta, 'name-degree', 6), count: 2, dates: [TODAY] };
    expect(repeatContent(target, penta)).toEqual({ kind: 'check', spec: degreeCheck(penta, 'name-degree', 6) });
    // Трудная цель повторяется той же проверкой и без описания упражнения (проверка по диапазону его не имеет).
    expect(repeatContent(target, null)).toEqual({ kind: 'check', spec: degreeCheck(penta, 'name-degree', 6) });
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
      { kind: 'check', id: 'check-1', exerciseKey: `check:${checkId(checkSpec())}`, title: 'Проверь себя', check: checkSpec(), activeMs: 1000, localDate: TODAY, occurredAt: '2026-11-12T11:00:00.000Z',
        answers: [{ target: 'b7', outcome: 'revealed', errors: 0 }, { target: 'b7', outcome: 'skipped', errors: 0 }] },
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
    const entry = playRatingEntry({ spec: penta, userExercises: [own], view: 'tab', wholePass: true, practice: { rhythm: 'eighths', echo: false, groove: null }, assessment: 'clean', bpm: 300.4, activeMs: 61234.6 }, meta('exercise-1'));
    expect(entry.result).toMatchObject({ kind: 'manual', source: 'self-report', assessment: 'clean', comfortableBpm: 220, durationMs: 61235, context: null,
      material: { kind: 'exercise', key: 'user:own-1', title: 'Моя пентатоника', spec: penta, view: 'tab' } });
    expect(practiceRecords([entry])).toEqual([expect.objectContaining({ kind: 'play', exerciseKey: 'user:own-1', bpm: 220, assessment: 'clean', localDate: '2026-11-12' })]);
  });

  it('итог «Проверь себя» без ответов не пишется; активное время ограничено', () => {
    expect(checkEntry({ spec: checkSpec(), userExercises: [], activeMs: 1000, answers: [] }, meta('check-0'))).toBeNull();
    const entry = checkEntry({ spec: checkSpec(), userExercises: [], activeMs: 10 * 60 * 60 * 1000, answers: [{ target: '1', outcome: 'correct', errors: 0 }] }, meta('check-1'))!;
    expect(entry.result).toMatchObject({ kind: 'check', source: 'screen-check', exerciseKey: `check:${checkId(checkSpec())}`, activeMs: 6 * 60 * 60 * 1000 });
    expect(entry.result.kind === 'check' && entry.result.title).toMatch(/^Проверь себя: /);
    const records = practiceRecords([entry]);
    expect(records).toEqual([expect.objectContaining({ kind: 'check', exerciseKey: `check:${checkId(checkSpec())}`, check: checkSpec() })]);
    const [row] = progressRows(records, 'check');
    expect(describeProgressRow(row, [entry])).toMatch(/6 вопросов$/);
  });
});

describe('умолчания экрана игры и копия', () => {
  it('умолчания «Настроек» и настройки хранения переводятся без потерь', () => {
    const play: PlayPreferences = { defaultView: 'both', newExerciseView: 'board', countInBars: 0, labels: 'degree', bpm: 96, reference: 'quiet', metronome: 'two-four', click: 0.3, grooveVolume: 0.5, accompaniment: 'hold', accompanimentVolume: 0.8 };
    expect(toPlayDefaults(play)).toEqual({ view: 'tabBoard', newExerciseView: 'board', countInBars: 0, labels: 'degrees', bpm: 96, reference: 'quiet', metronome: 'two-four', accompaniment: 'hold' });
    expect(fromPlayDefaults(toPlayDefaults(play), play)).toEqual(play);
    const plain: PlayPreferences = { defaultView: 'memory', newExerciseView: null, countInBars: 2, labels: 'finger', bpm: 60, reference: 'auto', metronome: 'beats', click: 0.45, grooveVolume: 0.6, accompaniment: 'off', accompanimentVolume: 0.5 };
    expect(fromPlayDefaults(toPlayDefaults(plain), plain)).toEqual(plain);
  });

  it('версия копии распознаётся до полной проверки; чужой файл и не-JSON — без версии', () => {
    expect(backupVersion(JSON.stringify({ format: 'bass-study-backup', schemaVersion: 10 }))).toBe(10);
    expect(backupVersion(JSON.stringify({ format: 'other', schemaVersion: 11 }))).toBeUndefined();
    expect(backupVersion('[1,2]')).toBeUndefined();
    expect(backupVersion('{oops')).toBeUndefined();
    expect(backupFileName('bass-study-backup', new Date(2026, 10, 2))).toBe('bass-study-backup-2026-11-02.json');
  });
});

describe('P18-04: вариант материала на экране игры', () => {
  const chromatic5 = createExerciseSpec('chromatic-position');
  const sources = (over: Partial<{ records: PracticeRecord[]; lesson: typeof DEFAULT_PREFERENCES.lesson }> = {}) => ({
    lesson: over.lesson ?? DEFAULT_PREFERENCES.lesson, play: DEFAULT_PREFERENCES.play, records: over.records ?? [], userExercises: [] as UserExercise[], practice: null,
  });

  it('смена лада даёт новый материал, ключ, план и настройки нового материала; прежний спек не меняется', () => {
    const change = variantChange(chromatic5, 'startFret', 7, sources());
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.spec.params).toMatchObject({ startFret: 7 });
    expect(chromatic5.params).toMatchObject({ startFret: 5 });
    expect(change.key).toBe(exerciseKey(change.spec));
    expect(change.key).not.toBe(exerciseKey(chromatic5));
    expect(change.plan.notes[0].id).toBe('E:7');
    expect(change.plan.spec).toEqual(change.spec);
    expect(change.settings.targetBpm).toBe(100);
  });

  it('вид и темп берутся для нового материала: запомненные — его, иначе темп последнего прохода того же шаблона', () => {
    const seven = createExerciseSpec('chromatic-position', { startFret: 7 });
    const lesson = { ...DEFAULT_PREFERENCES.lesson, exerciseSettings: { [exerciseKey(seven)]: { view: 'memory' as ExerciseView, bpm: 52, targetBpm: null, rhythm: 'eighths' as const, groove: null } } };
    const remembered = variantChange(chromatic5, 'startFret', 7, sources({ lesson }));
    expect(remembered.ok && remembered.view).toBe('memory');
    expect(remembered.ok && remembered.settings.bpm).toBe(52);
    const records = [playRecord(exerciseKey(chromatic5), 88, '2026-11-12T10:00:00.000Z', 'clean', chromatic5)];
    const inherited = variantChange(chromatic5, 'startFret', 9, sources({ records }));
    expect(inherited.ok && inherited.settings.bpm).toBe(88);
  });

  it('несуществующий параметр и значение вне списка — понятная ошибка, а не исключение', () => {
    const wrongParam = variantChange(chromatic5, 'nope', 7, sources());
    expect(wrongParam.ok).toBe(false);
    expect(!wrongParam.ok && wrongParam.error.length).toBeGreaterThan(5);
    const wrongValue = variantChange(chromatic5, 'startFret', 99, sources());
    expect(wrongValue.ok).toBe(false);
  });

  it('«как играть» шага и ритм остаются при смене варианта', () => {
    const practice = { rhythm: 'shuffle' as const, echo: false, groove: null };
    const change = variantChange(chromatic5, 'startFret', 7, { ...sources(), practice });
    expect(change.ok && change.settings.rhythm).toBe('shuffle');
  });

  it('таймер шага считает время всех вариантов, открытых на этом шаге, и не чужих материалов', () => {
    const five = exerciseKey(chromatic5);
    const seven = exerciseKey(createExerciseSpec('chromatic-position', { startFret: 7 }));
    const records = [
      playRecord(five, 80, `${TODAY}T10:00:00.000Z`, 'clean', chromatic5),
      playRecord(seven, 80, `${TODAY}T10:05:00.000Z`, 'clean', createExerciseSpec('chromatic-position', { startFret: 7 })),
      playRecord(exerciseKey(arpeggio), 80, `${TODAY}T10:10:00.000Z`),
    ];
    const plan = createPlan(TODAY, [{ id: 'step-a', content: { kind: 'exercise', spec: chromatic5 }, minutes: 3 }]);
    expect(planStepInfo(plan, 'step-a', [five], records)?.doneMs).toBe(60000);
    expect(planStepInfo(plan, 'step-a', [five, seven], records)?.doneMs).toBe(120000);
  });
});

describe('P18-11: план нового дня собирает программа', () => {
  const composed = [
    { id: 'd1', content: { kind: 'exercise' as const, spec: createExerciseSpec('chromatic-position') }, minutes: 2, programStep: 't1-left.quarters' },
    { id: 'd2', content: { kind: 'exercise' as const, spec: createExerciseSpec('octaves') }, minutes: 3, programStep: 'f1-octave.quarters' },
  ];

  it('новый день — шаги программы со связью programStep, первый — текущий', () => {
    const plan = planForToday(null, TODAY, () => composed);
    expect(plan.steps.map(step => [step.id, step.programStep, step.status])).toEqual([['d1', 't1-left.quarters', 'current'], ['d2', 'f1-octave.quarters', 'pending']]);
  });

  it('план этого дня не пересобирается в течение дня', () => {
    const stored = planForToday(null, TODAY, () => composed);
    let calls = 0;
    expect(planForToday(stored, TODAY, () => { calls += 1; return []; })).toBe(stored);
    expect(calls).toBe(0);
  });

  it('со вчера переносятся только невыполненные шаги, добавленные вручную; шаги программы пересобираются', () => {
    const yesterday = createPlan('2026-11-11', [
      { id: 'd1', content: composed[0].content, minutes: 2, programStep: 't1-left.quarters' },
      { id: 'step-5', content: { kind: 'exercise', spec: arpeggio }, minutes: 4 },
      { id: 'step-6', content: { kind: 'exercise', spec: penta }, minutes: 3 },
    ]);
    const done = completeStep(yesterday, 'step-6');
    const today = planForToday(done, TODAY, () => composed);
    expect(today.steps.map(step => step.id)).toEqual(['d1', 'd2', 'step-5']);
    expect(today.steps.map(step => step.programStep)).toEqual(['t1-left.quarters', 'f1-octave.quarters', undefined]);
  });

  it('в плане не больше 16 шагов', () => {
    const many = Array.from({ length: 18 }, (_, index) => ({ id: `d${index + 1}`, content: composed[0].content, minutes: 2 }));
    expect(planForToday(null, TODAY, () => many).steps).toHaveLength(16);
  });

  it('разминка и шаги программы на следующий день не переносятся; ручной шаг переносится', () => {
    const warmup = { id: 'd1', content: composed[0].content, minutes: 5, role: 'warmup' as const };
    const program = { id: 'd2', content: composed[0].content, minutes: 2, programStep: 't1-left.quarters', role: 'variant' as const };
    const manual = { id: 'step-3', content: composed[0].content, minutes: 3 };
    const yesterday = createPlan('2026-11-15', [warmup, program, manual]);
    expect(planForToday(yesterday, TODAY).steps.map(step => step.id)).toEqual(['step-3']);
  });

  it('смена длины до первого сделанного шага пересобирает шаги программы с разминкой, ручные остаются; после — план не меняется', () => {
    const warmup = { id: 'd0', content: composed[0].content, minutes: 5, role: 'warmup' as const };
    const manual = { id: 'step-9', content: composed[0].content, minutes: 3 };
    const stored = createPlan(TODAY, [warmup, ...composed, manual]);
    const shorter = composed.slice(0, 1);
    expect(planAfterSkipChange(stored, TODAY, () => shorter)!.steps.map(step => step.id)).toEqual([shorter[0].id, 'step-9']);
    const started = completeStep(stored, 'd0');
    expect(planAfterSkipChange(started, TODAY, () => shorter)).toBe(started);
  });
});

describe('строка проверки по диапазону называет вид вопроса и диапазон', () => {
  it('название записи — вид вопроса и область, а не ступени', () => {
    const spec = validateCheckSpec({ version: 'check-v2', kind: 'name-note', area: { type: 'range', strings: ['E', 'A'], fretMin: 0, fretMax: 5 }, subject: { type: 'notes', notes: 'natural' }, count: 6, ear: false });
    const entry = checkEntry({ spec, userExercises: [], activeMs: 1000, answers: [{ target: 'E', outcome: 'correct', errors: 0 }] }, { id: 'r1', occurredAt: '2026-11-10T10:00:00.000Z', timeZone: 'Europe/Moscow' })!;
    expect(entry.result.kind === 'check' && entry.result.title).toBe('Проверь себя: назови ноту · струны E, A · лады 0–5');
    expect(entry.result.kind === 'check' && entry.result.exerciseKey).toBe('check:name-note.EA-0-5.notes-natural');
  });
});

describe('описание проверки по ключу записи', () => {
  it('«Проверить снова» и «В план» строки проверки берут проверку из последней записи с этим ключом', () => {
    const spec = checkSpec();
    const key = `check:${checkId(spec)}`;
    const older = checkEntry({ spec, userExercises: [], activeMs: 1000, answers: [{ target: '1', outcome: 'correct', errors: 0 }] }, { id: 'c1', occurredAt: '2026-11-10T10:00:00.000Z', timeZone: 'Europe/Moscow' })!;
    expect(checkForKey(key, [older])).toEqual(spec);
    expect(checkForKey('check:нет-такой', [older])).toBeNull();
    expect(checkForKey(`builtin:${key}`, [older])).toBeNull();
  });
});
