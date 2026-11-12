import { describe, expect, it } from 'vitest';
import current from './fixtures/backup.json?raw';
import shapeV1 from './fixtures/screen-shape-v1.json?raw';
import { createMemoryStudyStore, emptySnapshot, parseBackup, validateHistoryEntry, type ScreenHistoryEntry } from '../src/storage';

describe('буквальные резервные копии и исторические правила v1', () => {
  it('сохраняет текущий снимок со слухом, маршрутом, учебной серией и ритмом буквально', () => {
    const snapshot = parseBackup(current);
    expect(snapshot).toEqual(JSON.parse(current));
    expect(snapshot.history.find(entry => entry.result.kind === 'ear')?.result).toMatchObject({ questions: [{ outcome: 'corrected' }, { outcome: 'interrupted' }] });
    expect(snapshot.history.find(entry => entry.result.kind === 'route')?.result).toMatchObject({ actualStepMs: [180000, 2500, 0], finishReason: 'stopped' });
    expect(snapshot.history.find(entry => entry.result.kind === 'screen')?.result).toMatchObject({ questionPolicy: 'triad-6-v1' });
    expect(snapshot.rhythmProjects[0].channels[0].velocityDefaults).toEqual({ hit: 61, accent: 88 });
  });

  it('отклоняет изменения порядка, времени и исходного материала исторических записей', () => {
    for (const tamper of [
      (snapshot: ReturnType<typeof JSON.parse>) => snapshot.history[0].result.questions[0].question.choices.reverse(),
      (snapshot: ReturnType<typeof JSON.parse>) => snapshot.history[0].result.questions[0].answerEvents[0].order = 5,
      (snapshot: ReturnType<typeof JSON.parse>) => snapshot.history[0].result.questions[0].listenEvents[1].atMs = 1519,
      (snapshot: ReturnType<typeof JSON.parse>) => snapshot.history.find((entry: { result: { kind: string } }) => entry.result.kind === 'route').result.actualStepMs[1]++,
      (snapshot: ReturnType<typeof JSON.parse>) => snapshot.history.find((entry: { result: { kind: string } }) => entry.result.kind === 'screen').result.questions[0].questionId = 'wrong-id',
    ]) {
      const snapshot = JSON.parse(current);
      tamper(snapshot);
      expect(() => parseBackup(JSON.stringify(snapshot))).toThrow();
    }
  });

  it('сохраняет буквальную серию формы и сверяет её порядок, позиции и итоги', () => {
    const entry = JSON.parse(shapeV1);
    const backup = () => JSON.stringify({ ...emptySnapshot(), history: [entry] });
    expect(parseBackup(backup()).history[0]).toEqual(entry);

    entry.result.questions.reverse();
    expect(() => parseBackup(backup())).toThrow(/зафиксированному набору/);
    entry.result.questions.reverse();
    entry.result.questions[0].outcome = 'correct';
    expect(() => parseBackup(backup())).toThrow(/поле результата outcome/i);
    entry.result.questions[0].outcome = 'corrected';
    entry.result.context.positionIds[0] = 'E:0';
    expect(() => parseBackup(backup())).toThrow(/точное множество/);
  });

  it('сверяет длинный журнал «найди все» и отвергает повреждённый хвост', () => {
    const fixture = JSON.parse(shapeV1) as ScreenHistoryEntry;
    const wrongCount = 20_000;
    const attempts = [{ answer: 'A:5', elapsedMs: 0, correct: true },
      ...Array.from({ length: wrongCount }, (_, index) => ({ answer: 'A:7', elapsedMs: index + 1, correct: false })),
      { answer: 'G:7', elapsedMs: wrongCount + 1, correct: true }];
    const question = { ...fixture.result.questions[0], answerRule: 'all-positions', selectedPositionIds: ['A:5', 'G:7'],
      attempts: attempts.length, errors: wrongCount, firstAnswer: 'A:5', firstResponseMs: 0, firstAttemptCorrect: true,
      completionMs: wrongCount + 1, answerEvents: attempts };
    const entry = { ...fixture, result: { ...fixture.result, mode: 'find-all', plannedCount: 1, questionPolicy: 'random-v1', questions: [question] } };
    const restored = validateHistoryEntry(entry) as ScreenHistoryEntry;
    expect(restored.result.questions[0]).toMatchObject({ attempts: wrongCount + 2, errors: wrongCount, outcome: 'corrected' });

    attempts[wrongCount + 1] = { answer: 'A:5', elapsedMs: wrongCount + 1, correct: true };
    expect(() => validateHistoryEntry(entry)).toThrow(/дубликат/);
    attempts[wrongCount + 1] = { answer: 'G:7', elapsedMs: 0, correct: true };
    expect(() => validateHistoryEntry(entry)).toThrow(/время ответа/i);
    attempts[wrongCount + 1] = { answer: 'G:7', elapsedMs: wrongCount + 1, correct: false };
    expect(() => validateHistoryEntry(entry)).toThrow(/неверный признак/);
  });
});

it('публикует только подготовленный этим хранилищем кандидат и использует его один раз', async () => {
  const store = createMemoryStudyStore();
  const candidate = store.prepareImport(current);
  expect(Object.isFrozen(candidate)).toBe(true);
  expect(Object.isFrozen(candidate.snapshot.history)).toBe(true);
  expect(await store.readSnapshot()).toEqual(emptySnapshot());
  await expect(store.restorePrepared({ ...candidate })).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
  await expect(createMemoryStudyStore().restorePrepared(candidate)).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
  await expect(store.restorePrepared(candidate)).resolves.toMatchObject({ status: 'restored', history: 4 });
  expect(await store.readSnapshot()).toBe(candidate.snapshot);
  await expect(store.restorePrepared(candidate)).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
  const stale = store.prepareImport(current);
  await store.close();
  await expect(store.restorePrepared(stale)).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
});
