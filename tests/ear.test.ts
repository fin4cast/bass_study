import { describe, expect, it } from 'vitest';
import {
  GUIDED_ROUTE_STEPS, beginEarListen, cancelEarListen, collectEarResults, completeEarListen, createEarQuestion, createEarExample, getEarAudioEvents,
  getEarSummary, nextEarQuestion, revealEarAnswer, skipEarQuestion, startEarSession, submitEarAnswer,
  type EarConfig, type EarSession,
} from '../src/ear';

const config: EarConfig = { root: 'C', quality: 'major', count: 1, seed: 10000 };
function heard(session = startEarSession(config), startMs = 0, bpm = 80) {
  const listening = beginEarListen(session, startMs, bpm);
  return completeEarListen(listening, startMs + 180000 / bpm, listening.answerState.activeListen!.id);
}

describe('содержательная музыкальная модель слухового задания', () => {
  it('явная опора сохраняет регистр маршрута, свободный режим остаётся прежним', () => {
    expect(createEarQuestion({ root: 'A', quality: 'minor', referenceMidi: 33, seed: 10000 })).toMatchObject({ referenceMidi: 33, targetMidi: 36, targetName: 'C' });
    expect(createEarQuestion({ root: 'A', quality: 'minor', seed: 10000 })).toMatchObject({ referenceMidi: 45, targetMidi: 48 });
    for (const referenceMidi of [32, -1, 121, 33.5]) expect(() => createEarQuestion({ root: 'A', quality: 'minor', referenceMidi, seed: 10000 })).toThrow();
  });
  it('подписанные образцы имеют независимые C2/E2/G2, не создают попытки или результат', () => {
    const session = startEarSession(config); const before = JSON.stringify(session);
    const examples = (['1', '3', '5'] as const).map(degree => createEarExample({ root: 'C', quality: 'major', referenceMidi: 36 }, degree));
    expect(examples.map(question => question.targetMidi)).toEqual([36, 40, 43]);
    expect(examples.map(question => question.targetName)).toEqual(['C', 'E', 'G']);
    expect(createEarExample({ root: 'C', quality: 'minor', referenceMidi: 36 }, 'b3').targetMidi).toBe(39);
    expect(() => createEarExample({ root: 'C', quality: 'major' }, 'b3')).toThrow();
    expect(JSON.stringify(session)).toBe(before); expect(collectEarResults(session)).toEqual([]);
  });
  it.each([
    ['C', 'major', 36, 40, '3', 'E'], ['A', 'minor', 45, 48, 'b3', 'C'], ['C#', 'major', 37, 41, '3', 'E♯'],
    ['Gb', 'major', 42, 46, '3', 'B♭'], ['Cb', 'minor', 47, 50, 'b3', 'E♭♭'],
  ] as const)('%s %s: контрольные MIDI и контекстное написание', (root, quality, referenceMidi, targetMidi, targetDegree, targetName) => {
    expect(createEarQuestion({ root, quality, seed: 10000 })).toMatchObject({ referenceMidi, targetMidi, targetDegree, targetName });
  });

  it('даёт три варианта трезвучия, включая пониженную терцию минора', () => {
    expect(createEarQuestion(config).choices).toEqual([{ id: '1', label: '1' }, { id: '3', label: '3' }, { id: '5', label: '5' }]);
    expect(createEarQuestion({ ...config, quality: 'minor' }).choices).toEqual([{ id: '1', label: '1' }, { id: 'b3', label: '♭3' }, { id: '5', label: '5' }]);
  });

  it('строит независимый эталон времени: тоника, четверть тишины, цель', () => {
    const question = createEarQuestion(config);
    expect(getEarAudioEvents(question, 120)).toEqual({ bpm: 120, totalBeats: 3, durationSeconds: 1.5, events: [
      { kind: 'reference', midi: 36, atBeat: 0, durationBeats: 1, atSeconds: 0, durationSeconds: 0.5 },
      { kind: 'rest', midi: null, atBeat: 1, durationBeats: 1, atSeconds: 0.5, durationSeconds: 0.5 },
      { kind: 'target', midi: 40, atBeat: 2, durationBeats: 1, atSeconds: 1, durationSeconds: 0.5 },
    ] });
    expect(getEarAudioEvents(question).durationSeconds).toBe(2.25);
    expect(getEarAudioEvents(question, 60).events.map(event => event.atSeconds)).toEqual([0, 1, 2]);
    expect(() => getEarAudioEvents(question, 59)).toThrow(/60 до 120/);
  });

  it('воспроизводит серию по seed; эталон не зависит от фильтра грифа', () => {
    const first = startEarSession({ ...config, count: 20 });
    expect(first).toEqual(startEarSession({ ...config, count: 20 }));
    expect(first.questions).not.toEqual(startEarSession({ ...config, count: 20, seed: 10001 }).questions);
    expect(new Set(first.questions.map(question => question.targetDegree))).toEqual(new Set(['1', '3', '5']));
    expect(first.questions.every(question => question.referenceMidi === 36 && [36, 40, 43].includes(question.targetMidi))).toBe(true);
    expect(Object.isFrozen(first.questions)).toBe(true);
    expect(GUIDED_ROUTE_STEPS.map(step => step.id)).toEqual(['fretboard', 'ear', 'sequence']);
  });

  it('отклоняет неподдерживаемые параметры вместо неразрешимого вопроса', () => {
    expect(() => startEarSession({ ...config, count: 0 })).toThrow();
    expect(() => startEarSession({ ...config, count: 21 })).toThrow();
    expect(() => startEarSession({ ...config, seed: -1 })).toThrow(/Seed/);
    expect(() => createEarQuestion({ ...config, root: 'H' })).toThrow();
    expect(() => createEarQuestion({ ...config, quality: 'other' as 'major' })).toThrow(/трезвучие/);
  });
});

describe('прослушивание, реальные ответы и независимые показатели', () => {
  it('сбор для истории сохраняет частичное слушание без fakecancel и не дублирует финальный вопрос', () => {
    const initial = startEarSession(config);
    expect(collectEarResults(initial)).toEqual([]);
    const started = beginEarListen(initial, 0, 120);
    expect(collectEarResults(started)[0]).toMatchObject({ outcome: 'interrupted', listensStarted: 1, listensCompleted: 0, listensCancelled: 0, closedAtMs: null, completionAfterListenMs: null, independentCorrect: false });
    expect(collectEarResults(started)[0]?.listenEvents).toEqual([{ type: 'start', listenId: started.answerState.activeListen!.id, atMs: 0, bpm: 120, order: 1 }]);
    const complete = completeEarListen(started, 1500);
    const answered = submitEarAnswer(complete, complete.currentQuestion.targetDegree, 1700);
    expect(collectEarResults(answered)).toHaveLength(1);
    expect(collectEarResults(nextEarQuestion(answered))).toHaveLength(1);
  });
  it('запрещает ответ до фактического completion и преждевременное завершение звука', () => {
    const initial = startEarSession(config);
    expect(() => submitEarAnswer(initial, '1', 100)).toThrow(/прослушивания/);
    const listening = beginEarListen(initial, 100, 120);
    expect(() => beginEarListen(listening, 110)).toThrow(/уже идёт/);
    expect(() => completeEarListen(listening, 1599)).toThrow(/ещё не могло/);
    expect(() => submitEarAnswer(listening, '1', 1600)).toThrow(/прослушивания/);
    expect(completeEarListen(listening, 1600).answerState.listensCompleted).toBe(1);
    expect(initial.answerState.listensStarted).toBe(0);
  });

  it('отсчитывает первый ответ от конца первого полного прослушивания', () => {
    const initial = heard(); // end at2250ms
    const answered = submitEarAnswer(initial, initial.currentQuestion.targetDegree, 2600);
    const result = nextEarQuestion(answered).results[0];
    expect(result).toMatchObject({ kind: 'ear', source: 'audio-choice', firstResponseMs: 350, independentCorrect: true, attempts: 1, errors: 0, listensCompleted: 1, replayCount: 0, completionAfterListenMs: 350 });
    expect(result).not.toHaveProperty('bassAccuracy');
  });

  it('повтор слушания учитывается отдельно от правильного первого выбора', () => {
    let session = heard();
    session = heard(session, 2500);
    session = submitEarAnswer(session, session.currentQuestion.targetDegree, 5000);
    const result = nextEarQuestion(session).results[0];
    expect(result).toMatchObject({ listensStarted: 2, listensCompleted: 2, replayCount: 1, independentCorrect: true, hintUsed: false, firstResponseMs: 2750 });
    expect(getEarSummary(session)).toMatchObject({ independentCorrect: 1, completedListens: 2, replayCount: 1 });
  });

  it('ошибка и исправление не превращаются в самостоятельный ответ', () => {
    let session = heard();
    const target = session.currentQuestion.targetDegree;
    const wrong = session.currentQuestion.choices.find(choice => choice.id !== target)!.id;
    session = submitEarAnswer(session, wrong, 2500);
    expect(session.status).toBe('active');
    expect(session.answerState.feedback).not.toContain(session.currentQuestion.targetName);
    session = submitEarAnswer(session, target, 3000);
    const result = nextEarQuestion(session).results[0];
    expect(result).toMatchObject({ outcome: 'corrected', corrected: true, independentCorrect: false, errors: 1, firstResponseMs: 250, completionAfterListenMs: 750 });
    expect(result.answerEvents).toEqual([{ degree: wrong, atMs: 2500, correct: false, order: 3 }, { degree: target, atMs: 3000, correct: true, order: 4 }]);
  });

  it('отмена не считает звук услышанным; поздние callbacks другого run игнорируются', () => {
    let session = beginEarListen(startEarSession(config), 0);
    const oldId = session.answerState.activeListen!.id;
    session = cancelEarListen(session, 200, oldId);
    expect(session.answerState).toMatchObject({ listensStarted: 1, listensCompleted: 0, listensCancelled: 1 });
    expect(() => submitEarAnswer(session, '1', 300)).toThrow();
    session = beginEarListen(session, 400);
    expect(completeEarListen(session, 3000, oldId)).toBe(session);
    session = completeEarListen(session, 3000, session.answerState.activeListen!.id);
    const result = nextEarQuestion(submitEarAnswer(session, session.currentQuestion.targetDegree, 3200)).results[0];
    expect(result).toMatchObject({ listensStarted: 2, listensCompleted: 1, listensCancelled: 1, replayCount: 0 });
  });

  it('показ/пропуск возможны до слушания и не выдумывают ответ или время реакции', () => {
    const initial = startEarSession(config);
    const revealed = nextEarQuestion(revealEarAnswer(initial, 10)).results[0];
    expect(revealed).toMatchObject({ outcome: 'revealed', hintUsed: true, independentCorrect: false, firstResponseMs: null, completionAfterListenMs: null, attempts: 0 });
    const skipped = nextEarQuestion(skipEarQuestion(beginEarListen(initial, 0), 200)).results[0];
    expect(skipped).toMatchObject({ outcome: 'skipped', skipped: true, listensCompleted: 0, listensCancelled: 1, independentCorrect: false });
  });

  it('вопросы переходят ровно один раз, времена нового вопроса начинаются заново', () => {
    const initial = startEarSession({ ...config, count: 2 });
    expect(nextEarQuestion(initial)).toBe(initial);
    const second = nextEarQuestion(skipEarQuestion(initial, 5000));
    expect(second.questionIndex).toBe(1);
    expect(second.answerState.lastEventMs).toBe(0);
    const finished = nextEarQuestion(submitEarAnswer(heard(second), second.currentQuestion.targetDegree, 2400));
    expect(finished.status).toBe('finished');
    expect(getEarSummary(finished)).toMatchObject({ total: 2, completed: 2, skipped: 1, independentCorrect: 1 });
    expect(nextEarQuestion(finished)).toBe(finished);
    expect(submitEarAnswer(finished, '1', 5000)).toBe(finished);
  });

  it('отклоняет неизвестную ступень и регресс времени без порчи предыдущего состояния', () => {
    const session = heard();
    expect(() => submitEarAnswer(session, 'b3', 2500)).toThrow(/ступеней/);
    expect(() => submitEarAnswer(session, '1', 2249)).toThrow(/Время/);
    expect(session.answerState.attempts).toBe(0);
  });
});
