import {
  BASS_STRINGS, annotatePositions, formatMidi, parseNote,
  type AnnotatedPosition, type MusicalStructure, type StructureId,
} from '../music';
import { createIntervalTarget, createPitchTarget, type IntervalDegree } from './constraints';
export { INTERVAL_DEGREES, createIntervalTarget, createPitchTarget, spellInterval } from './constraints';
export type { IntervalDegree } from './constraints';

export { createManualPracticeResult } from './results';
export type { ManualPracticeResult, TrainingResult } from './results';

export type QuizMode = 'name-note' | 'find-note' | 'find-all' | 'find-degree' | 'find-pitch' | 'find-interval';
export type TrainingScope = 'structure' | 'chromatic';
export type SequencePattern = 'ascending' | 'descending' | 'round-trip' | 'groups-of-three';
export type QuizAnswer = string | number;

export interface TrainingConfig {
  readonly positions: readonly AnnotatedPosition[];
  readonly structure: MusicalStructure;
  readonly scope?: TrainingScope;
}

export interface QuizConfig extends TrainingConfig {
  readonly mode: QuizMode;
  readonly seed: number;
  readonly intervalDegree?: IntervalDegree;
}

export interface QuestionContext {
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
  readonly kind: 'screen';
  readonly seed: number;
  readonly questions: readonly Question[];
  readonly questionIndex: number;
  readonly currentQuestion: Question;
  readonly status: 'active' | 'review' | 'finished';
  readonly answerState: AnswerState;
  readonly results: readonly QuizResult[];
}

const QUIZ_MODES: readonly QuizMode[] = ['name-note', 'find-note', 'find-all', 'find-degree', 'find-pitch', 'find-interval'];
const PATTERN_NAMES: Readonly<Record<SequencePattern, string>> = {
  ascending: 'Вверх', descending: 'Вниз', 'round-trip': 'Вверх-вниз', 'groups-of-three': 'Группы по три',
};
const CHROMATIC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

/** All objects passed here are constructed by this module, not caller-owned inputs. */
function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function validateSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed должен быть целым числом от 0 до 4294967295.');
}

function randomUint32(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function eligiblePositions(config: TrainingConfig): readonly AnnotatedPosition[] {
  const scope = config.scope ?? 'structure';
  if (scope !== 'structure' && scope !== 'chromatic') throw new RangeError('Неизвестная область: выберите ноты структуры или все ноты.');
  const annotated = annotatePositions(config.positions, config.structure);
  const unique = [...new Map(annotated.map(position => [position.id, position])).values()];
  return unique.filter(position => scope === 'chromatic' || position.inStructure);
}

export function createQuestion(config: QuizConfig): Question {
  validateSeed(config.seed);
  if (!QUIZ_MODES.includes(config.mode)) throw new RangeError('Неизвестный режим задания.');
  const scope = config.mode === 'find-interval' ? 'chromatic' : config.scope ?? 'structure';
  if (config.mode === 'find-degree' && scope === 'chromatic') {
    throw new RangeError('Поиск ступеней работает по выбранной гамме или трезвучию. Выберите «Ноты структуры».');
  }
  const choices = CHROMATIC_NAMES.map((fallback, pitchClass) => ({
    id: `pc:${pitchClass}`,
    label: config.structure.notes.find(note => note.pitchClass === pitchClass)?.name ?? fallback,
    pitchClass,
  }));
  const context = { scope, root: config.structure.root, structureId: config.structure.id, positionIds: [...new Set(config.positions.map(position => position.id))] };
  if (config.mode === 'find-pitch' || config.mode === 'find-interval') {
    const generated = config.mode === 'find-pitch' ? createPitchTarget(config)
      : createIntervalTarget(config.structure.root, config.intervalDegree ?? '#4', config.positions);
    return immutable({
      id: `q-${config.seed.toString(16)}-${config.mode}-${generated.targetMidi ?? generated.target.degree}`,
      mode: config.mode, seed: config.seed, context, ...generated, choices,
      answerRule: config.mode === 'find-pitch' ? 'exact-pitch' : 'any-position',
    });
  }
  const positions = eligiblePositions(config);
  if (positions.length === 0) throw new RangeError('В выбранной области нет подходящих нот. Измените струны, лады или структуру.');
  const next = randomUint32(config.seed);
  const targets = config.mode === 'name-note'
    ? positions
    : [...new Map(positions.map(position => [position.pitchClass, position])).values()];
  const selected = targets[Math.floor((next() / 0x100000000) * targets.length)];
  const expectedPositionIds = positions.filter(position => position.pitchClass === selected.pitchClass).map(position => position.id);
  const target = { pitchClass: selected.pitchClass, name: selected.noteName, degree: selected.degree };
  const prompts = {
    'name-note': `Назовите ноту: струна ${selected.string}, лад ${selected.fret}. Октава не влияет на выбор имени.`,
    'find-note': `Найдите ноту ${target.name} в выбранной области. Подходит любая её октава.`,
    'find-all': `Найдите все позиции ноты ${target.name} в выбранной области: ${expectedPositionIds.length}.`,
    'find-degree': `Найдите ступень ${(target.degree ?? '').replaceAll('b', '♭').replaceAll('#', '♯')} от ${config.structure.root} в выбранной структуре.`,
  };
  return immutable({
    id: `q-${config.seed.toString(16)}-${config.mode}-${config.mode === 'name-note' ? selected.id : selected.pitchClass}`,
    mode: config.mode,
    prompt: prompts[config.mode],
    seed: config.seed,
    context, target, targetMidi: null,
    ...(config.mode === 'name-note' ? { targetPositionId: selected.id } : {}),
    expectedPositionIds,
    choices,
    answerRule: config.mode === 'name-note' ? 'pitch-class' : config.mode === 'find-all' ? 'all-positions' : 'any-position',
  });
}

function initialAnswer(): AnswerState {
  return {
    status: 'awaiting', selectedPositionIds: [], attempts: 0, errors: 0,
    firstAnswer: null, firstResponseMs: null, completionMs: null, firstAttemptCorrect: null,
    hintUsed: false, lastElapsedMs: 0, answerEvents: [], feedback: { kind: 'neutral', message: '' },
  };
}

export function startQuiz(config: QuizConfig, count = 10): QuizSession {
  validateSeed(config.seed);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('Число заданий должно быть целым от 1 до 100.');
  const next = randomUint32(config.seed);
  const questions = Array.from({ length: count }, () => createQuestion({ ...config, seed: next() }));
  return immutable({
    kind: 'screen', seed: config.seed, questions, questionIndex: 0, currentQuestion: questions[0],
    status: 'active', answerState: initialAnswer(), results: [],
  });
}

function checkElapsed(state: AnswerState, elapsedMs: number): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < state.lastElapsedMs) {
    throw new RangeError('Время ответа должно быть неотрицательным и отсчитываться от начала текущего задания.');
  }
}

function namedPitchClass(question: Question, answer: QuizAnswer): number | null {
  if (typeof answer === 'number') return Number.isInteger(answer) && answer >= 0 && answer <= 11 ? answer : null;
  const choice = question.choices.find(candidate => candidate.id === answer);
  if (choice) return choice.pitchClass;
  try { return parseNote(answer).pitchClass; } catch { return null; }
}

export function submitAnswer(session: QuizSession, answer: QuizAnswer, elapsedMs: number): QuizSession {
  if (session.status !== 'active') return session;
  const previous = session.answerState;
  checkElapsed(previous, elapsedMs);
  const question = session.currentQuestion;
  const positionId = typeof answer === 'string' ? answer : null;
  if (question.mode === 'find-all' && positionId !== null && previous.selectedPositionIds.includes(positionId)) {
    return immutable({ ...session, answerState: { ...previous, lastElapsedMs: elapsedMs,
      feedback: { kind: 'duplicate', message: 'Эта позиция уже найдена. Повторный выбор не меняет результат.' } } });
  }
  const correct = question.mode === 'name-note'
    ? namedPitchClass(question, answer) === question.target.pitchClass
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
  checkElapsed(session.answerState, elapsedMs);
  return immutable({ ...session, status: 'review', answerState: { ...session.answerState,
    status: 'revealed', hintUsed: true, completionMs: elapsedMs, lastElapsedMs: elapsedMs,
    feedback: { kind: 'revealed', message: `Ответ: ${session.currentQuestion.targetMidi === null ? session.currentQuestion.target.name : formatMidi(session.currentQuestion.targetMidi, session.currentQuestion.target.name)}. Показанный ответ не считается самостоятельным.` },
  } });
}

export function skipQuestion(session: QuizSession, elapsedMs: number): QuizSession {
  if (session.status !== 'active') return session;
  checkElapsed(session.answerState, elapsedMs);
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
  const positions = [...eligiblePositions(config)].sort((a, b) =>
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
