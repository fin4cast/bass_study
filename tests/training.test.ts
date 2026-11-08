import { describe, expect, it } from 'vitest';
import { annotatePositions, createStructure, getPosition, getPositions } from '../src/music';
import {
  createQuestion, createSequence, getQuizSummary, nextQuestion, revealAnswer,
  skipQuestion, startQuiz, submitAnswer, type QuizConfig, type QuizMode, type QuizSession,
} from '../src/training';

const structure = createStructure('A', 'minor-pentatonic');
const all = annotatePositions(getPositions({ strings: ['E', 'A', 'D', 'G'], fretMin: 0, fretMax: 12 }), structure);
const narrow = annotatePositions(getPositions({ strings: ['E'], fretMin: 0, fretMax: 3 }), structure);
const base: QuizConfig = { positions: all, structure, mode: 'find-note', scope: 'structure', seed: 100 };
const correct = (session: QuizSession) => session.currentQuestion.mode === 'name-note'
  ? session.currentQuestion.target.pitchClass
  : session.currentQuestion.expectedPositionIds[0];

describe('разрешимые и воспроизводимые задания', () => {
  it('различает точную высоту A1 и класс A во всех октавах', () => {
    const positions = annotatePositions([getPosition('E', 5), getPosition('A', 0), getPosition('A', 12)], structure);
    const question = createQuestion({ ...base, positions, mode: 'find-pitch', seed: 1 });
    expect(question).toMatchObject({ targetMidi: 33, answerRule: 'exact-pitch', expectedPositionIds: ['E:5', 'A:0'] });
    expect(question.prompt).toContain('A1');
    const initial = startQuiz({ ...base, positions, mode: 'find-pitch' }, 1);
    const matching = initial.currentQuestion.expectedPositionIds;
    const wrong = initial.currentQuestion.targetMidi === 33 ? 'A:12' : 'A:0';
    expect(submitAnswer(initial, wrong, 100).answerState.feedback.kind).toBe('incorrect');
    for (const id of matching) expect(submitAnswer(initial, id, 200).status).toBe('review');
    expect(createQuestion({ ...base, positions, mode: 'find-note' }).targetMidi).toBeNull();
    expect(createQuestion({ ...base, positions, mode: 'find-note' }).expectedPositionIds).toEqual(['E:5', 'A:0', 'A:12']);
  });

  it('интервал #4 от C доступен вне структуры и автоматически использует все ноты', () => {
    const cMajor = createStructure('C', 'major');
    const positions = annotatePositions([getPosition('E', 2), getPosition('E', 14), getPosition('A', 0)], cMajor);
    const question = createQuestion({ ...base, positions, structure: cMajor, mode: 'find-interval', scope: 'structure', intervalDegree: '#4' });
    expect(question).toMatchObject({ answerRule: 'any-position', targetMidi: null, context: { scope: 'chromatic' }, target: { name: 'F♯', degree: '#4', pitchClass: 6 }, expectedPositionIds: ['E:2', 'E:14'] });
    const flat = createQuestion({ ...base, positions, structure: cMajor, mode: 'find-interval', intervalDegree: 'b5' });
    expect(flat.target.name).toBe('G♭');
    expect(flat.expectedPositionIds).toEqual(question.expectedPositionIds);
    expect(() => createQuestion({ ...base, positions: annotatePositions([getPosition('E', 0)], cMajor), structure: cMajor, mode: 'find-interval' })).toThrow(/отсутствует/);
  });
  it.each(['name-note', 'find-note', 'find-all', 'find-degree'] as QuizMode[])('%s использует только доступные позиции', mode => {
    for (let seed = 0; seed < 40; seed++) {
      const question = createQuestion({ ...base, positions: narrow, mode, seed });
      expect(question.expectedPositionIds.length).toBeGreaterThan(0);
      expect(question.expectedPositionIds.every(id => ['E:0', 'E:3'].includes(id))).toBe(true);
      expect([4, 7]).toContain(question.target.pitchClass);
      expect(question.target.name).not.toBe('A');
      expect(question.context.positionIds).toEqual(['E:0', 'E:1', 'E:2', 'E:3']);
    }
  });

  it('scope chromatic действительно включает ноты вне структуры', () => {
    const one = annotatePositions([getPosition('E', 1)], structure);
    expect(() => createQuestion({ ...base, positions: one })).toThrow(/нет подходящих нот/);
    const question = createQuestion({ ...base, positions: one, scope: 'chromatic' });
    expect(question.target).toMatchObject({ name: 'F', pitchClass: 5, degree: null });
    expect(question.expectedPositionIds).toEqual(['E:1']);
  });

  it('поиск ступеней не маскирует неработающую хроматическую область', () => {
    expect(() => createQuestion({ ...base, mode: 'find-degree', scope: 'chromatic' })).toThrow(/Ноты структуры/);
  });

  it('даёт одинаковую серию при одинаковом seed и отличную при другом', () => {
    expect(startQuiz(base).questions).toEqual(startQuiz(base).questions);
    expect(startQuiz(base).questions.map(q => q.id)).not.toEqual(startQuiz({ ...base, seed: 101 }).questions.map(q => q.id));
    expect(new Set(startQuiz(base).questions.map(q => q.id)).size).toBe(10);
  });

  it('восстанавливает аннотации из текущей структуры без изменения входа', () => {
    const before = JSON.stringify(all);
    const fMajor = createStructure('F', 'major');
    const question = createQuestion({ ...base, structure: fMajor, positions: annotatePositions([getPosition('A', 1)], structure) });
    expect(question.target).toMatchObject({ name: 'B♭', degree: '4', pitchClass: 10 });
    expect(JSON.stringify(all)).toBe(before);
  });

  it('различает вопрос об имени, любой позиции и полном наборе', () => {
    const one = annotatePositions([getPosition('E', 5), getPosition('A', 0), getPosition('A', 12)], structure);
    const named = createQuestion({ ...base, positions: one, mode: 'name-note' });
    expect(named.answerRule).toBe('pitch-class');
    expect(named.targetPositionId).toBeDefined();
    expect(named.target.name).toBe('A');
    for (const mode of ['find-note', 'find-all', 'find-degree'] as QuizMode[]) {
      const question = createQuestion({ ...base, positions: one, mode });
      expect(question.expectedPositionIds).toEqual(['E:5', 'A:0', 'A:12']);
      expect(question.targetPositionId).toBeUndefined();
    }
  });

  it('отклоняет пустую область, неправильный seed, режим и длину серии', () => {
    expect(() => createQuestion({ ...base, positions: [] })).toThrow(/нет подходящих нот/);
    expect(() => createQuestion({ ...base, seed: -1 })).toThrow(/Seed/);
    expect(() => createQuestion({ ...base, seed: 0x100000000 })).toThrow(/Seed/);
    expect(() => createQuestion({ ...base, mode: 'other' as QuizMode })).toThrow(/режим/);
    expect(() => startQuiz(base, 0)).toThrow();
    expect(() => startQuiz(base, 101)).toThrow();
  });
});

describe('ответы, подсказки и экранные результаты', () => {
  it('принимает правильный первый ответ и не изменяет исходную сессию', () => {
    const initial = startQuiz(base, 1);
    const answered = submitAnswer(initial, correct(initial), 450);
    expect(initial.status).toBe('active');
    expect(initial.answerState.attempts).toBe(0);
    expect(answered.status).toBe('review');
    expect(getQuizSummary(answered)).toMatchObject({ completed: 1, independentCorrect: 1, errors: 0 });
    const done = nextQuestion(answered);
    expect(done.status).toBe('finished');
    expect(done.results[0]).toMatchObject({ kind: 'screen', outcome: 'correct', independentCorrect: true, firstResponseMs: 450, completionMs: 450, attempts: 1 });
    expect(nextQuestion(done)).toBe(done);
    expect(submitAnswer(done, correct(done), 900)).toBe(done);
    expect(getQuizSummary(done).completed).toBe(1);
  });

  it('сохраняет первую ошибку и исправление отдельно от самостоятельного результата', () => {
    let session = startQuiz(base, 1);
    session = submitAnswer(session, 'not-a-position', 300);
    expect(session.answerState.feedback.kind).toBe('incorrect');
    expect(session.status).toBe('active');
    session = submitAnswer(session, correct(session), 850);
    const result = nextQuestion(session).results[0];
    expect(result).toMatchObject({ outcome: 'corrected', firstAttemptCorrect: false, independentCorrect: false, corrected: true, attempts: 2, errors: 1, firstAnswer: 'not-a-position', firstResponseMs: 300, completionMs: 850 });
    expect(result.answerEvents).toEqual([
      { answer: 'not-a-position', elapsedMs: 300, correct: false },
      { answer: correct(session), elapsedMs: 850, correct: true },
    ]);
  });

  it('имя C♯ и D♭ принимается по высоте независимо от написания', () => {
    const db = createStructure('Db', 'major');
    const positions = annotatePositions([getPosition('A', 4)], db);
    const config = { ...base, structure: db, positions, mode: 'name-note' as const };
    for (const answer of ['C#', 'D♭', 'pc:1', 1]) {
      const session = submitAnswer(startQuiz(config, 1), answer, 200);
      expect(session.status).toBe('review');
      expect(getQuizSummary(session).independentCorrect).toBe(1);
    }
  });

  it('find-all требует весь уникальный набор, повторный выбор игнорируется', () => {
    const positions = annotatePositions([getPosition('E', 5), getPosition('A', 0), getPosition('A', 12)], structure);
    let session = startQuiz({ ...base, positions, mode: 'find-all' }, 1);
    session = submitAnswer(session, 'E:5', 100);
    expect(session.status).toBe('active');
    expect(session.answerState.feedback.kind).toBe('partial');
    session = submitAnswer(session, 'E:5', 200);
    expect(session.answerState).toMatchObject({ attempts: 1, errors: 0, selectedPositionIds: ['E:5'], firstResponseMs: 100 });
    expect(session.answerState.feedback.kind).toBe('duplicate');
    session = submitAnswer(session, 'A:0', 400);
    expect(session.status).toBe('active');
    session = submitAnswer(session, 'A:12', 600);
    expect(session.status).toBe('review');
    expect(nextQuestion(session).results[0]).toMatchObject({ independentCorrect: true, attempts: 3, completionMs: 600 });
  });

  it('ошибка после правильной части find-all исключает самостоятельное завершение', () => {
    const positions = annotatePositions([getPosition('E', 5), getPosition('A', 0)], structure);
    let session = startQuiz({ ...base, positions, mode: 'find-all' }, 1);
    session = submitAnswer(session, 'E:5', 100);
    session = submitAnswer(session, 'D:0', 200);
    session = submitAnswer(session, 'A:0', 300);
    expect(nextQuestion(session).results[0]).toMatchObject({ firstAttemptCorrect: true, independentCorrect: false, corrected: true, errors: 1 });
  });

  it('показанный ответ не становится самостоятельным и не порождает мнимый первый ответ', () => {
    const shown = revealAnswer(startQuiz(base, 1), 1200);
    expect(shown.status).toBe('review');
    expect(submitAnswer(shown, correct(shown), 1500)).toBe(shown);
    expect(nextQuestion(shown).results[0]).toMatchObject({ outcome: 'revealed', hintUsed: true, independentCorrect: false, firstAnswer: null, firstResponseMs: null, attempts: 0 });
    expect(getQuizSummary(shown)).toMatchObject({ hints: 1, independentCorrect: 0, completed: 1 });
  });

  it('пропуск и следующая задача сохраняют разные времена и состояния', () => {
    const initial = startQuiz(base, 2);
    expect(nextQuestion(initial)).toBe(initial);
    const second = nextQuestion(skipQuestion(initial, 700));
    expect(second.questionIndex).toBe(1);
    expect(second.status).toBe('active');
    expect(second.answerState).toMatchObject({ attempts: 0, firstResponseMs: null, lastElapsedMs: 0 });
    expect(second.results[0]).toMatchObject({ outcome: 'skipped', skipped: true, completionMs: 700 });
    expect(getQuizSummary(second)).toMatchObject({ completed: 1, skipped: 1, total: 2 });
  });

  it('не принимает отрицательное, бесконечное или убывающее время', () => {
    const initial = startQuiz(base);
    expect(() => submitAnswer(initial, correct(initial), -1)).toThrow(/Время/);
    expect(() => revealAnswer(initial, Infinity)).toThrow(/Время/);
    const afterError = submitAnswer(initial, 'wrong', 300);
    expect(() => submitAnswer(afterError, correct(afterError), 250)).toThrow(/Время/);
    expect(() => skipQuestion(afterError, 299)).toThrow(/Время/);
  });
});

describe('детерминированные последовательности', () => {
  const config = { positions: narrow, structure, scope: 'chromatic' as const };

  it.each([
    ['ascending', [28, 29, 30, 31]],
    ['descending', [31, 30, 29, 28]],
    ['round-trip', [28, 29, 30, 31, 30, 29]],
    ['groups-of-three', [28, 29, 30, 29, 30, 31]],
  ] as const)('%s имеет независимый ожидаемый порядок', (pattern, expected) => {
    expect(createSequence({ ...config, pattern }).notes.map(note => note.midi)).toEqual(expected);
  });

  it('выбирает E перед A для одной высоты даже при перемешанном входе', () => {
    const positions = annotatePositions([getPosition('A', 0), getPosition('E', 5), getPosition('D', 0), getPosition('A', 5)], structure);
    const route = createSequence({ ...config, positions, pattern: 'ascending' });
    expect(route.notes.map(note => [note.midi, note.id])).toEqual([[33, 'E:5'], [38, 'A:5']]);
    expect(positions.map(note => note.id)).toEqual(['A:0', 'E:5', 'D:0', 'A:5']);
  });

  it('применяет scope и минимальное количество высот', () => {
    expect(createSequence({ ...config, scope: 'structure', pattern: 'ascending' }).notes.map(note => note.id)).toEqual(['E:0', 'E:3']);
    expect(createSequence({ ...config, positions: [narrow[0]], pattern: 'ascending' }).notes).toHaveLength(1);
    expect(() => createSequence({ ...config, positions: [], pattern: 'ascending' })).toThrow(/не менее 1/);
    expect(() => createSequence({ ...config, positions: [narrow[0]], pattern: 'round-trip' })).toThrow(/не менее 2/);
    expect(() => createSequence({ ...config, scope: 'structure', pattern: 'groups-of-three' })).toThrow(/не менее 3/);
    expect(createSequence({ ...config, scope: 'structure', pattern: 'round-trip' }).notes.map(note => note.id)).toEqual(['E:0', 'E:3']);
  });
});
