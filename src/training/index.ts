import {
  BASS_STRINGS, formatMidi,
  type AnnotatedPosition, type MusicalStructure, type StructureId,
} from '../music';
import type { IntervalDegree } from './constraints';
import type { BoxSelection } from '../music/boxes';
import { checkQuizElapsedV1, createQuestionV1, createQuizQuestionsV1, eligiblePositionsV1, namedPitchClassV1 } from './quiz-rules-v1';
import type { RouteRef } from '../route';
export { INTERVAL_DEGREES, createIntervalTarget, createPitchTarget, spellInterval } from './constraints';
export type { IntervalDegree } from './constraints';

export { createManualPracticeResult } from './results';
export type { ManualPracticeResult, TrainingResult } from './results';

export type QuizMode = 'name-note' | 'find-note' | 'find-all' | 'find-degree' | 'find-pitch' | 'find-interval';
export type TrainingScope = 'structure' | 'chromatic';
export type SequencePattern = 'ascending' | 'descending' | 'round-trip' | 'groups-of-three';
export type QuizAnswer = string | number;
export type QuestionPolicy = 'random-v1' | 'triad-6-v1' | 'shape-6-v1';

export interface TrainingConfig {
  readonly box?: BoxSelection | null;
  readonly positions: readonly AnnotatedPosition[];
  readonly structure: MusicalStructure;
  readonly scope?: TrainingScope;
}

export interface QuizConfig extends TrainingConfig {
  readonly questionPolicy?: QuestionPolicy;
  readonly routeRef?: RouteRef | null;
  readonly mode: QuizMode;
  readonly seed: number;
  readonly intervalDegree?: IntervalDegree;
}

export interface QuestionContext {
  readonly box?: BoxSelection | null;
  readonly scope: TrainingScope;
  readonly root: string;
  readonly structureId: StructureId;
  readonly positionIds: readonly string[];
}

export interface Question {
  readonly id: string;
  readonly mode: QuizMode;
  readonly prompt: string;
  readonly seed: number;
  readonly context: QuestionContext;
  readonly target: { readonly pitchClass: number; readonly name: string; readonly degree: string | null };
  readonly targetMidi: number | null;
  readonly targetPositionId?: string;
  readonly expectedPositionIds: readonly string[];
  readonly choices: readonly { readonly id: string; readonly label: string; readonly pitchClass: number }[];
  readonly answerRule: 'pitch-class' | 'any-position' | 'all-positions' | 'exact-pitch';
}

export interface AnswerEvent {
  readonly answer: QuizAnswer;
  readonly elapsedMs: number;
  readonly correct: boolean;
}

export interface AnswerState {
  readonly status: 'awaiting' | 'completed' | 'revealed' | 'skipped';
  readonly selectedPositionIds: readonly string[];
  readonly attempts: number;
  readonly errors: number;
  readonly firstAnswer: QuizAnswer | null;
  readonly firstResponseMs: number | null;
  readonly completionMs: number | null;
  readonly firstAttemptCorrect: boolean | null;
  readonly hintUsed: boolean;
  readonly lastElapsedMs: number;
  readonly answerEvents: readonly AnswerEvent[];
  readonly feedback: {
    readonly kind: 'neutral' | 'correct' | 'incorrect' | 'partial' | 'duplicate' | 'revealed' | 'skipped';
    readonly message: string;
  };
}

export interface QuizResult {
  readonly kind: 'screen';
  readonly questionId: string;
  readonly mode: QuizMode;
  readonly context: QuestionContext;
  readonly answerRule: Question['answerRule'];
  readonly target: Question['target'];
  readonly targetMidi: number | null;
  readonly selectedPositionIds: readonly string[];
  readonly attempts: number;
  readonly errors: number;
  readonly firstAnswer: QuizAnswer | null;
  readonly firstResponseMs: number | null;
  readonly completionMs: number | null;
  readonly firstAttemptCorrect: boolean | null;
  readonly hintUsed: boolean;
  readonly skipped: boolean;
  readonly independentCorrect: boolean;
  readonly corrected: boolean;
  readonly outcome: 'correct' | 'corrected' | 'revealed' | 'skipped';
  readonly answerEvents: readonly AnswerEvent[];
}

export interface QuizSession {
  readonly questionPolicy: QuestionPolicy;
  readonly routeRef?: RouteRef | null;
  readonly kind: 'screen';
  readonly seed: number;
  readonly questions: readonly Question[];
  readonly questionIndex: number;
  readonly currentQuestion: Question;
  readonly status: 'active' | 'review' | 'finished';
  readonly answerState: AnswerState;
  readonly results: readonly QuizResult[];
}

const PATTERN_NAMES: Readonly<Record<SequencePattern, string>> = {
  ascending: 'Вверх', descending: 'Вниз', 'round-trip': 'Вверх-вниз', 'groups-of-three': 'Группы по три',
};
/** All objects passed here are constructed by this module, not caller-owned inputs. */
function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export const createQuestion = createQuestionV1;
export { createQuizQuestionsV1 } from './quiz-rules-v1';

function initialAnswer(): AnswerState {
  return {
    status: 'awaiting', selectedPositionIds: [], attempts: 0, errors: 0,
    firstAnswer: null, firstResponseMs: null, completionMs: null, firstAttemptCorrect: null,
    hintUsed: false, lastElapsedMs: 0, answerEvents: [], feedback: { kind: 'neutral', message: '' },
  };
}

export function startQuiz(config: QuizConfig, count = 10): QuizSession {
  const questions = createQuizQuestionsV1(config, count);
  const questionPolicy = config.questionPolicy ?? 'random-v1';
  return immutable({
    kind: 'screen', questionPolicy, ...(config.routeRef ? { routeRef: { ...config.routeRef } } : {}), seed: config.seed, questions, questionIndex: 0, currentQuestion: questions[0],
    status: 'active', answerState: initialAnswer(), results: [],
  });
}

export function submitAnswer(session: QuizSession, answer: QuizAnswer, elapsedMs: number): QuizSession {
  if (session.status !== 'active') return session;
  const previous = session.answerState;
  checkQuizElapsedV1(previous.lastElapsedMs, elapsedMs);
  const question = session.currentQuestion;
  const positionId = typeof answer === 'string' ? answer : null;
  if (question.mode === 'find-all' && positionId !== null && previous.selectedPositionIds.includes(positionId)) {
    return immutable({ ...session, answerState: { ...previous, lastElapsedMs: elapsedMs,
      feedback: { kind: 'duplicate', message: 'Эта позиция уже найдена. Повторный выбор не меняет результат.' } } });
  }
  const correct = question.mode === 'name-note'
    ? namedPitchClassV1(answer, question.choices) === question.target.pitchClass
    : positionId !== null && question.expectedPositionIds.includes(positionId);
  const selectedPositionIds = correct && question.mode !== 'name-note'
    ? [...previous.selectedPositionIds, positionId!]
    : [...previous.selectedPositionIds];
  const complete = correct && (question.mode !== 'find-all' || selectedPositionIds.length === question.expectedPositionIds.length);
  const feedback: AnswerState['feedback'] = !correct
    ? { kind: 'incorrect', message: question.mode === 'name-note'
      ? `Это нота ${question.target.name}. Сравните её с выбранным ответом и попробуйте ещё раз.`
      : `Эта позиция не подходит. Ищите ${question.targetMidi === null ? question.target.name : formatMidi(question.targetMidi, question.target.name)} в доступных струнах и ладах${question.targetMidi === null ? '' : '; другая октава не подходит'}.` }
    : complete
      ? { kind: 'correct', message: question.mode === 'find-all' ? 'Все позиции найдены.' : `Верно: ${question.targetMidi === null ? question.target.name : formatMidi(question.targetMidi, question.target.name)}.` }
      : { kind: 'partial', message: `Найдено ${selectedPositionIds.length} из ${question.expectedPositionIds.length}. Продолжайте поиск.` };
  return immutable({ ...session,
    status: complete ? 'review' : 'active',
    answerState: { ...previous,
      status: complete ? 'completed' : 'awaiting', selectedPositionIds,
      attempts: previous.attempts + 1, errors: previous.errors + (correct ? 0 : 1),
      firstAnswer: previous.attempts === 0 ? answer : previous.firstAnswer,
      firstResponseMs: previous.firstResponseMs ?? elapsedMs,
      firstAttemptCorrect: previous.firstAttemptCorrect ?? correct,
      completionMs: complete ? elapsedMs : null, lastElapsedMs: elapsedMs,
      answerEvents: [...previous.answerEvents, { answer, elapsedMs, correct }], feedback,
    },
  });
}

export function revealAnswer(session: QuizSession, elapsedMs: number): QuizSession {
  if (session.status !== 'active') return session;
  checkQuizElapsedV1(session.answerState.lastElapsedMs, elapsedMs);
  return immutable({ ...session, status: 'review', answerState: { ...session.answerState,
    status: 'revealed', hintUsed: true, completionMs: elapsedMs, lastElapsedMs: elapsedMs,
    feedback: { kind: 'revealed', message: `Ответ: ${session.currentQuestion.targetMidi === null ? session.currentQuestion.target.name : formatMidi(session.currentQuestion.targetMidi, session.currentQuestion.target.name)}. Показанный ответ не считается самостоятельным.` },
  } });
}

export function skipQuestion(session: QuizSession, elapsedMs: number): QuizSession {
  if (session.status !== 'active') return session;
  checkQuizElapsedV1(session.answerState.lastElapsedMs, elapsedMs);
  return immutable({ ...session, status: 'review', answerState: { ...session.answerState,
    status: 'skipped', completionMs: elapsedMs, lastElapsedMs: elapsedMs,
    feedback: { kind: 'skipped', message: 'Задание пропущено. Оно не считается правильным ответом.' },
  } });
}

function currentResult(session: QuizSession): QuizResult {
  const answer = session.answerState;
  if (answer.status === 'awaiting') throw new Error('Незавершённое задание ещё не имеет итогового результата.');
  const independentCorrect = answer.status === 'completed' && answer.errors === 0 && !answer.hintUsed;
  const corrected = answer.status === 'completed' && !independentCorrect;
  return immutable({
    kind: 'screen', questionId: session.currentQuestion.id, mode: session.currentQuestion.mode,
    context: session.currentQuestion.context, answerRule: session.currentQuestion.answerRule,
    target: session.currentQuestion.target, targetMidi: session.currentQuestion.targetMidi, selectedPositionIds: [...answer.selectedPositionIds],
    attempts: answer.attempts, errors: answer.errors, firstAnswer: answer.firstAnswer,
    firstResponseMs: answer.firstResponseMs, completionMs: answer.completionMs,
    firstAttemptCorrect: answer.firstAttemptCorrect, hintUsed: answer.hintUsed,
    skipped: answer.status === 'skipped', independentCorrect, corrected,
    outcome: independentCorrect ? 'correct' : corrected ? 'corrected' : answer.status === 'skipped' ? 'skipped' : 'revealed',
    answerEvents: [...answer.answerEvents],
  });
}

export function nextQuestion(session: QuizSession): QuizSession {
  if (session.status !== 'review') return session;
  const results = [...session.results, currentResult(session)];
  const next = session.questionIndex + 1;
  if (next === session.questions.length) return immutable({ ...session, status: 'finished', results });
  return immutable({ ...session, status: 'active', questionIndex: next,
    currentQuestion: session.questions[next], answerState: initialAnswer(), results });
}

export function getQuizSummary(session: QuizSession) {
  const results = session.status === 'review' ? [...session.results, currentResult(session)] : session.results;
  return immutable({
    total: session.questions.length,
    completed: results.length,
    independentCorrect: results.filter(result => result.independentCorrect).length,
    corrected: results.filter(result => result.corrected).length,
    errors: results.reduce((sum, result) => sum + result.errors, 0) + (session.status === 'active' ? session.answerState.errors : 0),
    hints: results.filter(result => result.hintUsed).length,
    skipped: results.filter(result => result.skipped).length,
  });
}

export function createSequence(config: TrainingConfig & { readonly pattern: SequencePattern }) {
  if (!Object.hasOwn(PATTERN_NAMES, config.pattern)) throw new RangeError('Неизвестный порядок нот.');
  const positions = [...eligiblePositionsV1(config)].sort((a, b) =>
    a.midi - b.midi
    || BASS_STRINGS.findIndex(string => string.id === a.string) - BASS_STRINGS.findIndex(string => string.id === b.string)
    || a.fret - b.fret,
  );
  const unique: AnnotatedPosition[] = [];
  for (const position of positions) {
    if (unique.at(-1)?.midi !== position.midi) unique.push(position);
  }
  const minimum = config.pattern === 'groups-of-three' ? 3 : config.pattern === 'round-trip' ? 2 : 1;
  if (unique.length < minimum) throw new RangeError(`Для этого порядка нужно не менее ${minimum} разных высот в выбранной области.`);
  const notes = config.pattern === 'descending' ? [...unique].reverse()
    : config.pattern === 'round-trip' ? [...unique, ...unique.slice(1, -1).reverse()]
    : config.pattern === 'groups-of-three' ? unique.slice(0, -2).flatMap((_, index) => unique.slice(index, index + 3))
    : unique;
  return immutable({ pattern: config.pattern, name: PATTERN_NAMES[config.pattern], notes });
}
