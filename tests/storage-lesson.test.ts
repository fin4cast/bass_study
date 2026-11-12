import { describe, expect, it } from 'vitest';
import backupJson from './fixtures/backup.json?raw';
import { createExerciseSpec } from '../src/exercises';
import { createPlan } from '../src/practice/plan';
import { REFERENCE_CONCEPTS } from '../src/practice/concepts';
import { annotatePositions, createStructure, getPosition, parseNote } from '../src/music';
import { nextQuestion, startQuiz, submitAnswer } from '../src/training';
import { createManualPracticeResult, type ExercisePracticeMaterial } from '../src/training/results';
import { beginEarListen, completeEarListen, startEarSession, submitEarAnswer, nextEarQuestion } from '../src/ear';
import {
  DEFAULT_PREFERENCES, MAX_CHECK_ACTIVE_MS, StudyStorageError, applyDraftDrain, createMemoryStudyStore, emptySnapshot, getHistorySummary, getReviewPositionIds,
  makeCheckHistory, makeEarHistory, makeManualHistory, makeScreenHistory, parseBackup, readStoredSnapshot, validateHistoryEntry, validatePracticeDraft,
  validatePreferences, validateSnapshot, type CheckHistoryEntry, type PracticeDraft,
} from '../src/storage';

const metadata = { occurredAt: '2026-11-08T22:30:00.000Z', timeZone: 'Europe/Moscow' };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const pentaB = createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' });
const material = (patch: Partial<ExercisePracticeMaterial> = {}): ExercisePracticeMaterial =>
  ({ kind: 'exercise', key: 'builtin:pentatonic-form', title: 'Форма пентатоники вверх-вниз', spec: pentaB, view: 'both', ...patch });
const pass = (id = 'exercise-pass', assessment: 'clean' | 'errors' | 'slow' = 'clean', bpm = 84) =>
  makeManualHistory(createManualPracticeResult({ context: null, comfortableBpm: bpm, durationMs: 120000, note: '', assessment, material: material() }), { ...metadata, id });
const checkResult = () => ({
  exerciseKey: 'builtin:pentatonic-form', title: 'Форма пентатоники вверх-вниз', activeMs: 90000,
  spec: { version: 'check-v1' as const, exercise: pentaB, kind: 'name-degree' as const, count: 4, ear: false },
  answers: [{ degree: 'b3', outcome: 'correct' as const, errors: 0 }, { degree: 'b7', outcome: 'corrected' as const, errors: 1 },
    { degree: '4', outcome: 'revealed' as const, errors: 2 }, { degree: '1', outcome: 'unanswered' as const, errors: 0 }],
});
const check = (id = 'check-entry') => makeCheckHistory(checkResult(), { ...metadata, id })!;
function invalid(operation: () => unknown) {
  let failure: unknown;
  try { operation(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(StudyStorageError);
  expect((failure as StudyStorageError).code).toBe('INVALID_DATA');
}

describe('настройки P13: занятие, экран игры, справочник', () => {
  it('умолчания и новый стартовый раздел', () => {
    expect(validatePreferences(DEFAULT_PREFERENCES)).toMatchObject({
      activeModule: 'lesson',
      lesson: { plan: null, tab: 'today', playFrom: null, viewByExercise: {}, progressTab: 'exercises', progressSource: 'all' },
      play: { defaultView: 'both', newExerciseView: 'board', countIn: true, labels: 'name', bpm: 72 },
      reference: { mastered: [] },
    });
    for (const section of ['lesson', 'foundation', 'harmony', 'tracks', 'progress', 'settings']) expect(validatePreferences({ ...DEFAULT_PREFERENCES, activeModule: section }).activeModule).toBe(section);
  });

  it('принимает план, «Играть от», виды упражнений и освоенные понятия', () => {
    const plan = createPlan('2026-11-12', [{ id: 'step-1', content: { kind: 'exercise', spec: pentaB }, minutes: 5 }]);
    const value = validatePreferences({ ...clone(DEFAULT_PREFERENCES),
      lesson: { plan, tab: 'library', playFrom: 'F♯', viewByExercise: { 'builtin:octaves': 'memory', 'user:my-1': 'tab' }, progressTab: 'calendar', progressSource: 'check' },
      play: { defaultView: 'tab', newExerciseView: null, countIn: false, labels: 'finger', bpm: 40 },
      reference: { mastered: REFERENCE_CONCEPTS.slice(0, 3).map(concept => concept.id) } });
    expect(value.lesson.plan).toEqual(plan);
    expect(value.lesson.playFrom).toBe(parseNote('F♯').name);
    expect(value.lesson.viewByExercise).toEqual({ 'builtin:octaves': 'memory', 'user:my-1': 'tab' });
    expect(value.play.newExerciseView).toBeNull();
    expect(Object.isFrozen(value.lesson.viewByExercise)).toBe(true);
    const views = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`user:e${index}`, 'board']));
    expect(Object.keys(validatePreferences({ ...clone(DEFAULT_PREFERENCES), lesson: { ...DEFAULT_PREFERENCES.lesson, viewByExercise: views } }).lesson.viewByExercise)).toHaveLength(200);
  });

  it.each([
    ['прежний раздел ear', (x: any) => { x.activeModule = 'ear'; }],
    ['прежний раздел input', (x: any) => { x.activeModule = 'input'; }],
    ['лишнее поле lesson', (x: any) => { x.lesson.extra = 1; }],
    ['нет поля play', (x: any) => { delete x.play; }],
    ['вкладка', (x: any) => { x.lesson.tab = 'progress'; }],
    ['нота «Играть от»', (x: any) => { x.lesson.playFrom = 'H'; }],
    ['нота с октавой', (x: any) => { x.lesson.playFrom = 'A1'; }],
    ['ключ вида', (x: any) => { x.lesson.viewByExercise = { octaves: 'board' }; }],
    ['ключ с пробелом', (x: any) => { x.lesson.viewByExercise = { 'user:my exercise': 'board' }; }],
    ['значение вида', (x: any) => { x.lesson.viewByExercise = { 'user:a': 'large' }; }],
    ['201 вид', (x: any) => { x.lesson.viewByExercise = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`user:e${index}`, 'board'])); }],
    ['вид массивом', (x: any) => { x.lesson.viewByExercise = []; }],
    ['вкладка прогресса', (x: any) => { x.lesson.progressTab = 'history'; }],
    ['источник прогресса', (x: any) => { x.lesson.progressSource = 'ear'; }],
    ['два текущих шага плана', (x: any) => { x.lesson.plan = { version: 'plan-v1', localDate: '2026-11-12', steps: [
      { id: 'a', content: { kind: 'exercise', spec: clone(pentaB) }, minutes: 3, status: 'current' },
      { id: 'b', content: { kind: 'exercise', spec: clone(pentaB) }, minutes: 3, status: 'current' }] }; }],
    ['план с лишним полем', (x: any) => { x.lesson.plan = { ...clone(createPlan('2026-11-12')), title: 'x' }; }],
    ['вид по умолчанию', (x: any) => { x.play.defaultView = 'notes'; }],
    ['вид нового упражнения', (x: any) => { x.play.newExerciseView = 'auto'; }],
    ['подписи', (x: any) => { x.play.labels = 'interval'; }],
    ['темп ниже', (x: any) => { x.play.bpm = 39; }],
    ['темп выше', (x: any) => { x.play.bpm = 221; }],
    ['дробный темп', (x: any) => { x.play.bpm = 72.5; }],
    ['отсчёт', (x: any) => { x.play.countIn = 'yes'; }],
    ['неизвестное понятие', (x: any) => { x.reference.mastered = ['made-up']; }],
    ['повтор понятия', (x: any) => { x.reference.mastered = ['semitone', 'semitone']; }],
    ['лишнее поле справочника', (x: any) => { x.reference.extra = []; }],
  ])('отклоняет: %s', (_name, change) => {
    const input = clone(DEFAULT_PREFERENCES) as any; change(input);
    invalid(() => validatePreferences(input));
  });
});

describe('проход упражнения: самооценка и материал', () => {
  it('сохраняет самооценку прохода и null у прочих материалов', () => {
    const entry = pass('exercise-pass', 'errors');
    expect(entry.result).toMatchObject({ kind: 'manual', source: 'self-report', assessment: 'errors', context: null, material: { kind: 'exercise', view: 'both' } });
    expect(validateHistoryEntry(clone(entry))).toEqual(entry);
    const fixture = parseBackup(backupJson);
    expect(fixture.history.filter(item => item.result.kind === 'manual' && item.result.material.kind !== 'exercise').every(item => item.result.kind === 'manual' && item.result.assessment === null)).toBe(true);
  });

  it.each([
    ['без самооценки', (x: any) => { x.result.assessment = null; }],
    ['неизвестная самооценка', (x: any) => { x.result.assessment = 'perfect'; }],
    ['нет поля assessment', (x: any) => { delete x.result.assessment; }],
    ['контекст грифа', (x: any) => { x.result.context = { scope: 'structure', root: 'A', structureId: 'minor-pentatonic', positionIds: ['E:5'] }; }],
    ['маршрут', (x: any) => { x.routeRef = { routeId: 'route-1', step: 'sequence' }; }],
    ['темп ниже 40', (x: any) => { x.result.comfortableBpm = 39; }],
    ['темп выше 220', (x: any) => { x.result.comfortableBpm = 221; }],
    ['ключ без префикса', (x: any) => { x.result.material.key = 'pentatonic-form'; }],
    ['чужой шаблон встроенного ключа', (x: any) => { x.result.material.key = 'builtin:octaves'; }],
    ['пустое название', (x: any) => { x.result.material.title = ' '; }],
    ['длинное название', (x: any) => { x.result.material.title = 'x'.repeat(121); }],
    ['вид экрана', (x: any) => { x.result.material.view = 'score'; }],
    ['неверное описание', (x: any) => { x.result.material.spec.params.shapeId = 'penta-z'; }],
    ['лишнее поле материала', (x: any) => { x.result.material.context = null; }],
  ])('отклоняет проход упражнения: %s', (_name, change) => {
    const input = clone(pass()) as any; change(input);
    invalid(() => validateHistoryEntry(input));
  });

  it('прочие материалы не принимают самооценку', () => {
    const rhythm = clone(parseBackup(backupJson).history.find(item => item.id === 'fixture-rhythm-history')) as any;
    rhythm.result.assessment = 'clean';
    invalid(() => validateHistoryEntry(rhythm));
    expect(() => createManualPracticeResult({ context: null, comfortableBpm: 84, durationMs: 1, material: material() })).toThrow(RangeError);
    expect(() => createManualPracticeResult({ context: null, comfortableBpm: 84, durationMs: 1, material: material(), assessment: null })).toThrow(RangeError);
  });

  it('черновик прохода сливается только с самооценкой; у прочих черновиков её нет', () => {
    const draft: PracticeDraft = validatePracticeDraft({ id: 'exercise-draft', createdAt: metadata.occurredAt, updatedAt: metadata.occurredAt, timeZone: metadata.timeZone,
      localDate: '2026-11-09', context: null, material: clone(material()), routeRef: null, totalReferenceMs: 1500, recordedThroughMs: 0, suggestedBpm: 84, comfortableBpm: 80, note: 'Проход', editRevision: 1 });
    const request = { draftId: draft.id, historyId: 'drained', expectedRecordedThroughMs: 0, throughMs: 1500, editRevision: 1, comfortableBpm: 80, note: 'Проход', occurredAt: draft.createdAt, timeZone: draft.timeZone };
    invalid(() => applyDraftDrain(draft, request));
    invalid(() => applyDraftDrain(draft, { ...request, assessment: null }));
    invalid(() => applyDraftDrain(draft, { ...request, assessment: 'fast' as never }));
    const drained = applyDraftDrain(draft, { ...request, assessment: 'slow' });
    expect(drained.entry.result).toMatchObject({ assessment: 'slow', durationMs: 1500, material: { kind: 'exercise' } });
    expect(drained.draft.recordedThroughMs).toBe(1500);
    invalid(() => validatePracticeDraft({ ...clone(draft), routeRef: { routeId: 'route-1', step: 'sequence' } }));
    invalid(() => validatePracticeDraft({ ...clone(draft), context: { scope: 'structure', root: 'A', structureId: 'minor-pentatonic', positionIds: ['E:5'] } }));
  });
});

describe('«Проверь себя» в истории', () => {
  it('строит запись итога и не создаёт пустую', () => {
    const entry = check();
    expect(entry.result).toMatchObject({ kind: 'check', source: 'screen-check', activeMs: 90000, answers: checkResult().answers });
    expect(entry.localDate).toBe('2026-11-09');
    expect(Object.isFrozen(entry.result.answers[0])).toBe(true);
    expect(validateHistoryEntry(clone(entry))).toEqual(entry);
    expect(validateHistoryEntry(clone(entry), 'stored')).toEqual(entry);
    expect(makeCheckHistory({ ...checkResult(), answers: [] }, { ...metadata, id: 'empty' })).toBeNull();
    expect(getReviewPositionIds([entry])).toEqual([]);
    expect(getHistorySummary([entry, pass()])).toMatchObject({ entries: 2, checkSessions: 1, checkActiveMs: 90000, manualSessions: 1, screenSessions: 0, questions: 0 });
  });

  it('пентатоника и трезвучия: ступени — только из структуры упражнения', () => {
    const minorTriad = { ...checkResult(), exerciseKey: 'user:arpeggio', spec: { ...checkResult().spec, exercise: createExerciseSpec('arpeggio-1358', { structureId: 'minor-triad' }) },
      answers: [{ degree: 'b3', outcome: 'correct' as const, errors: 0 }, { degree: '5', outcome: 'skipped' as const, errors: 0 }] };
    expect(makeCheckHistory(minorTriad, { ...metadata, id: 'triad' })!.result.answers).toHaveLength(2);
    invalid(() => makeCheckHistory({ ...minorTriad, answers: [{ degree: '4', outcome: 'correct', errors: 0 }] }, { ...metadata, id: 'triad' }));
  });

  it.each([
    ['ступень вне структуры', (x: any) => { x.result.answers[0].degree = '3'; }],
    ['ступень юникодом', (x: any) => { x.result.answers[0].degree = '♭3'; }],
    ['исход', (x: any) => { x.result.answers[0].outcome = 'interrupted'; }],
    ['«верно» с ошибками', (x: any) => { x.result.answers[0].errors = 1; }],
    ['«исправлено» без ошибок', (x: any) => { x.result.answers[1].errors = 0; }],
    ['21 ошибка', (x: any) => { x.result.answers[2].errors = 21; }],
    ['дробные ошибки', (x: any) => { x.result.answers[2].errors = 1.5; }],
    ['нет ответов', (x: any) => { x.result.answers = []; }],
    ['21 ответ', (x: any) => { x.result.answers = Array.from({ length: 21 }, () => ({ degree: '1', outcome: 'correct', errors: 0 })); }],
    ['лишнее поле ответа', (x: any) => { x.result.answers[0].positionId = 'E:5'; }],
    ['активное время больше 6 ч', (x: any) => { x.result.activeMs = MAX_CHECK_ACTIVE_MS + 1; }],
    ['дробное активное время', (x: any) => { x.result.activeMs = 10.5; }],
    ['отрицательное время', (x: any) => { x.result.activeMs = -1; }],
    ['источник', (x: any) => { x.result.source = 'screen-input'; }],
    ['ключ', (x: any) => { x.result.exerciseKey = 'pentatonic-form'; }],
    ['чужой шаблон встроенного ключа', (x: any) => { x.result.exerciseKey = 'builtin:octaves'; }],
    ['пустое название', (x: any) => { x.result.title = ''; }],
    ['версия проверки', (x: any) => { x.result.spec.version = 'check-v2'; }],
    ['число вопросов', (x: any) => { x.result.spec.count = 2; }],
    ['хроматика без одной структуры', (x: any) => { x.result.spec.exercise = clone(createExerciseSpec('chromatic-position')); x.result.exerciseKey = 'user:chromatic'; }],
    ['транспонирование без одной структуры', (x: any) => { x.result.spec.exercise = clone(createExerciseSpec('form-transpose')); x.result.exerciseKey = 'user:transpose'; }],
    ['маршрут', (x: any) => { x.routeRef = { routeId: 'route-1', step: 'ear' }; }],
    ['лишнее поле', (x: any) => { x.result.seed = 1; }],
  ])('отклоняет: %s', (_name, change) => {
    const input = clone(check()) as any; change(input);
    invalid(() => validateHistoryEntry(input));
  });
});

describe('новые режимы экрана и слуха в истории', () => {
  it('«Назови ступень» сохраняет ответы pc:N и повтор ошибок по позиции', () => {
    const structure = createStructure('A', 'minor-pentatonic');
    const positions = annotatePositions([getPosition('E', 5), getPosition('E', 8), getPosition('A', 5), getPosition('A', 7)], structure);
    let session = startQuiz({ positions, structure, mode: 'name-degree', scope: 'structure', seed: 7 }, 1);
    const question = session.currentQuestion;
    const wrong = question.choices!.find(choice => choice.pitchClass !== question.target.pitchClass)!;
    session = submitAnswer(session, wrong.id, 300);
    session = nextQuestion(submitAnswer(session, `pc:${question.target.pitchClass}`, 700));
    const entry = makeScreenHistory(session, { ...metadata, id: 'name-degree' })!;
    expect(entry.result).toMatchObject({ mode: 'name-degree', questions: [{ answerRule: 'pitch-class', outcome: 'corrected', errors: 1, targetPositionId: question.targetPositionId }] });
    expect(validateHistoryEntry(clone(entry))).toEqual(entry);
    expect(getReviewPositionIds([entry])).toEqual([question.targetPositionId]);
    const forged = clone(entry) as any; forged.result.questions[0].errors = 0;
    invalid(() => validateHistoryEntry(forged));
    const chromatic = clone(entry) as any; chromatic.result.context.scope = 'chromatic';
    invalid(() => validateHistoryEntry(chromatic));
  });

  it('слух по ступеням пентатоники повторяется при импорте; прежнее трезвучие — без изменений', () => {
    let session = startEarSession({ root: 'A', quality: 'minor-pentatonic', count: 2, seed: 4242 });
    session = completeEarListen(beginEarListen(session, 0, 80), 2500);
    const target = session.currentQuestion.targetDegree;
    const wrong = session.currentQuestion.choices.find(choice => choice.id !== target)!.id;
    session = submitEarAnswer(submitEarAnswer(session, wrong, 3000), target, 3500);
    session = completeEarListen(beginEarListen(nextEarQuestion(session), 0, 80), 2500);
    const entry = makeEarHistory(session, { ...metadata, id: 'ear-penta' })!;
    expect(entry.result.context.quality).toBe('minor-pentatonic');
    expect(entry.result.questions[0].question.choices).toHaveLength(5);
    expect(validateHistoryEntry(clone(entry))).toEqual(entry);
    expect(validateHistoryEntry(clone(entry), 'stored')).toEqual(entry);
    const forged = clone(entry) as any; forged.result.context.quality = 'diminished';
    invalid(() => validateHistoryEntry(forged));
    const literal = parseBackup(backupJson).history.find(item => item.result.kind === 'ear')!;
    expect(validateHistoryEntry(clone(literal))).toEqual(literal);
  });
});

describe('упражнения и история в снимке и временном хранилище', () => {
  const exercise = (id: string, name = 'Моё упражнение') => ({ version: 'user-exercise-v1', id, name, spec: clone(pentaB), createdAt: metadata.occurredAt });

  it('сохраняет, удаляет и восстанавливает упражнения, проход и проверку целиком', async () => {
    const store = createMemoryStudyStore();
    await store.saveExercise(exercise('b-second') as never); await store.saveExercise(exercise('a-first') as never);
    await store.addHistory(pass()); await store.addHistory(check());
    await expect(store.saveExercise({ ...exercise('bad'), extra: true } as never)).rejects.toMatchObject({ code: 'INVALID_DATA' });
    await expect(store.addHistory({ ...check('bad-check'), result: { ...check().result, answers: [{ degree: '2', outcome: 'correct', errors: 0 }] } } as CheckHistoryEntry)).rejects.toMatchObject({ code: 'INVALID_DATA' });
    const snapshot = await store.readSnapshot();
    expect(snapshot.exercises.map(item => item.id)).toEqual(['a-first', 'b-second']);
    expect(snapshot.history.map(item => item.result.kind)).toEqual(['check', 'manual']);
    const json = await store.exportBackup();
    expect(Object.keys(JSON.parse(json))).toEqual(['format', 'schemaVersion', 'preferences', 'profile', 'practiceDrafts', 'exercises', 'history', 'rhythmProjects', 'activeRhythmProjectId']);
    const restored = createMemoryStudyStore();
    await expect(restored.restorePrepared(restored.prepareImport(json))).resolves.toMatchObject({ status: 'restored', exercises: 2, history: 2 });
    expect(await restored.readSnapshot()).toEqual(snapshot);
    expect(JSON.stringify(await restored.readSnapshot())).toBe(json);
    await store.deleteExercise('a-first');
    expect((await store.readSnapshot()).exercises.map(item => item.id)).toEqual(['b-second']);
  });

  it('отклоняет копию с пресетами, дублями упражнений и битой записью целиком', () => {
    const copy = JSON.parse(backupJson);
    invalid(() => validateSnapshot({ ...copy, presets: [] }));
    invalid(() => validateSnapshot({ ...copy, exercises: [copy.exercises[0], copy.exercises[0]] }));
    const broken = clone(copy); broken.history.find((entry: any) => entry.result.kind === 'check').result.answers[0].degree = '7';
    invalid(() => parseBackup(JSON.stringify(broken)));
    const { exercises: _exercises, ...withoutExercises } = copy;
    invalid(() => validateSnapshot(withoutExercises));
    expect(validateSnapshot({ ...emptySnapshot(), exercises: [] }).exercises).toEqual([]);
  });

  it('чтение своей базы пропускает одно битое упражнение, остальные доступны', () => {
    const copy = JSON.parse(backupJson);
    const records = { preferences: copy.preferences, profile: copy.profile, activeRhythmProjectId: copy.activeRhythmProjectId, history: copy.history,
      practiceDrafts: copy.practiceDrafts, rhythmProjects: copy.rhythmProjects, exercises: [...copy.exercises, { ...exercise('broken'), name: '' }] };
    const { snapshot, skipped } = readStoredSnapshot(records);
    expect(snapshot.exercises.map(item => item.id)).toEqual(['fixture-penta']);
    expect(skipped).toEqual([{ store: 'exercises', id: 'broken', reason: expect.stringMatching(/^Упражнение: /) }]);
  });
});
