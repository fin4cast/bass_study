import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec } from '../src/exercises';
import { createStructure } from '../src/music';
import { getQuizSummary, nextQuestion, revealAnswer, startQuiz, submitAnswer, type QuizConfig } from '../src/training';
import { replayQuizResultV1 } from '../src/training/quiz-rules-v1';

// Форма B пентатоники Am (лады 7–10): позиции и ступени выведены независимо в tests/exercises.test.ts.
const plan = buildExercise(createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' }));
const config: QuizConfig = { positions: plan.positions, structure: createStructure('A', 'minor-pentatonic'), box: null, mode: 'name-degree', seed: 0x5eed };
const DEGREE_PC: Record<string, number> = { '1': 9, b3: 0, '4': 2, '5': 4, b7: 7 };

describe('режим «Назови ступень» на материале упражнения', () => {
  it('варианты — пять ступеней пентатоники с идентификаторами pc:N; позиции только из формы', () => {
    const session = startQuiz(config, 6);
    const question = session.currentQuestion;
    expect(question.choices.map(choice => `${choice.label}=${choice.id}`)).toEqual(['1=pc:9', '♭3=pc:0', '4=pc:2', '5=pc:4', '♭7=pc:7']);
    expect(question.answerRule).toBe('pitch-class');
    expect(plan.positions.map(position => position.id)).toContain(question.targetPositionId);
    expect(question.prompt).toMatch(/^Какая это ступень от A: струна [EADG], лад \d+\?$/);
  });
  it('ошибка не раскрывает ответ; верный ответ после ошибки — «с исправлением»', () => {
    let session = startQuiz(config, 3);
    const target = session.currentQuestion.target.pitchClass;
    const wrong = session.currentQuestion.choices.find(choice => choice.pitchClass !== target)!;
    session = submitAnswer(session, wrong.id, 900);
    expect(session.answerState.feedback?.kind).toBe('incorrect');
    expect(session.answerState.feedback?.message).toBe('Это другая ступень. Сравни расстояние от тоники и попробуй ещё раз.');
    session = submitAnswer(session, `pc:${target}`, 1800);
    expect(session.answerState.status).toBe('completed');
    expect(session.answerState.feedback?.message).toMatch(/^Верно: ступень /);
  });
  it('серия: самостоятельно, с исправлением, показано — сводка как у остальных режимов', () => {
    let session = startQuiz(config, 3);
    const answerFirst = () => `pc:${session.currentQuestion.target.pitchClass}`;
    session = submitAnswer(session, answerFirst(), 500);
    session = nextQuestion(session);
    const target = session.currentQuestion.target.pitchClass;
    session = submitAnswer(session, `pc:${(target + 1) % 12}`, 400);
    session = submitAnswer(session, `pc:${target}`, 800);
    session = nextQuestion(session);
    session = revealAnswer(session, 1000);
    expect(getQuizSummary(session)).toMatchObject({ completed: 3, independentCorrect: 1, corrected: 1, errors: 1, hints: 1 });
  });
  it('сохранённые ответы pc:N повторяются правилом v1 без списка вариантов', () => {
    const replay = replayQuizResultV1('name-degree', DEGREE_PC.b7, [], [
      { answer: 'pc:4', elapsedMs: 300, correct: false }, { answer: 'pc:7', elapsedMs: 900, correct: true },
    ] as never);
    expect(replay).toMatchObject({ errors: 1, corrected: true, independentCorrect: false });
  });
  it('хроматическая область для ступеней отклоняется', () => {
    expect(() => startQuiz({ ...config, scope: 'chromatic' }, 3)).toThrow(RangeError);
  });
});
