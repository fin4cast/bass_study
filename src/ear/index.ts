import { createStructure } from '../music';
import type { RouteRef } from '../route';

export type EarQuality = 'major' | 'minor';
export type EarDegree = '1' | '3' | 'b3' | '5';
export interface EarContext { readonly root: string; readonly quality: EarQuality; readonly referenceMidi: number }
export interface EarConfig { readonly root: string; readonly quality: EarQuality; readonly count: number; readonly seed: number; readonly referenceMidi?: number; readonly routeRef?: RouteRef | null }
export interface EarQuestion {
  readonly id: string; readonly seed: number; readonly root: string; readonly quality: EarQuality;
  readonly referenceMidi: number; readonly targetMidi: number; readonly targetDegree: EarDegree; readonly targetName: string;
  readonly choices: readonly { readonly id: EarDegree; readonly label: string }[];
}
export type EarListenEvent = { readonly type: 'start'; readonly listenId: string; readonly atMs: number; readonly order: number; readonly bpm: number }
  | { readonly type: 'complete' | 'cancel'; readonly listenId: string; readonly atMs: number; readonly order: number };
export interface EarAnswerEvent { readonly degree: EarDegree; readonly atMs: number; readonly correct: boolean; readonly order: number }
export interface EarAnswerState {
  readonly activeListen: { readonly id: string; readonly startedAtMs: number; readonly minimumEndMs: number; readonly bpm: number } | null;
  readonly listensStarted: number; readonly listensCompleted: number; readonly listensCancelled: number;
  readonly firstListenCompletedAtMs: number | null; readonly listenEvents: readonly EarListenEvent[];
  readonly attempts: number; readonly errors: number; readonly firstAnswer: EarDegree | null; readonly firstResponseMs: number | null;
  readonly firstAttemptCorrect: boolean | null; readonly answerEvents: readonly EarAnswerEvent[];
  readonly outcome: 'correct' | 'corrected' | 'revealed' | 'skipped' | null;
  readonly closedAtMs: number | null; readonly lastEventMs: number; readonly feedback: string;
}
export interface EarResult {
  readonly kind: 'ear'; readonly source: 'audio-choice'; readonly question: EarQuestion;
  readonly listensStarted: number; readonly listensCompleted: number; readonly listensCancelled: number; readonly replayCount: number;
  readonly listenEvents: readonly EarListenEvent[]; readonly answerEvents: readonly EarAnswerEvent[];
  readonly attempts: number; readonly errors: number; readonly firstAnswer: EarDegree | null; readonly firstResponseMs: number | null;
  readonly firstAttemptCorrect: boolean | null; readonly independentCorrect: boolean; readonly corrected: boolean;
  readonly hintUsed: boolean; readonly skipped: boolean; readonly outcome: Exclude<EarAnswerState['outcome'], null>;
  readonly closedAtMs: number; readonly completionAfterListenMs: number | null;
}
export interface EarSession {
  readonly routeRef?: RouteRef | null;
  readonly kind: 'ear'; readonly source: 'audio-choice'; readonly seed: number;
  readonly questions: readonly EarQuestion[]; readonly questionIndex: number; readonly currentQuestion: EarQuestion;
  readonly status: 'active' | 'review' | 'finished'; readonly answerState: EarAnswerState; readonly results: readonly EarResult[];
}
export type SavedEarResult = EarResult | (Omit<EarResult, 'outcome' | 'closedAtMs'> & { readonly outcome: 'interrupted'; readonly closedAtMs: null });

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
function seedValue(seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed должен быть целым числом от 0 до 4294967295.');
  let state = seed || 0x9e3779b9;
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return state >>> 0;
}
function bpmValue(bpm: number) {
  if (!Number.isInteger(bpm) || bpm < 60 || bpm > 120) throw new RangeError('Для слухового задания выберите целый темп от 60 до 120 BPM.');
  return bpm;
}
function checkTime(state: EarAnswerState, atMs: number) {
  if (!Number.isFinite(atMs) || atMs < state.lastEventMs) throw new RangeError('Время должно быть неотрицательным, монотонным и отсчитываться от начала текущего вопроса.');
}
function initialAnswer(): EarAnswerState {
  return { activeListen: null, listensStarted: 0, listensCompleted: 0, listensCancelled: 0, firstListenCompletedAtMs: null,
    listenEvents: [], attempts: 0, errors: 0, firstAnswer: null, firstResponseMs: null, firstAttemptCorrect: null, answerEvents: [],
    outcome: null, closedAtMs: null, lastEventMs: 0, feedback: 'Послушай тонику и целевой звук, затем выбери ступень.' };
}

export function createEarQuestion(config: Omit<EarConfig, 'count'>): EarQuestion {
  if (config.quality !== 'major' && config.quality !== 'minor') throw new RangeError('Выберите мажорное или минорное трезвучие.');
  const structure = createStructure(config.root, config.quality === 'major' ? 'major-triad' : 'minor-triad');
  const selected = structure.notes[Math.floor(seedValue(config.seed) / 0x100000000 * 3)];
  const referenceMidi = config.referenceMidi ?? 36 + structure.rootPitchClass;
  if (!Number.isInteger(referenceMidi) || referenceMidi < 0 || referenceMidi > 120 || referenceMidi % 12 !== structure.rootPitchClass) throw new RangeError('Опорная высота должна быть тоникой и оставлять место для квинты в MIDI 0–127.');
  return immutable({ id: `ear-${config.seed.toString(16)}-${config.quality}-${structure.root}`, seed: config.seed,
    root: structure.root, quality: config.quality, referenceMidi, targetMidi: referenceMidi + selected.semitones,
    targetDegree: selected.degree as EarDegree, targetName: selected.name,
    choices: structure.notes.map(note => ({ id: note.degree as EarDegree, label: note.degree.replace('b', '♭') })) });
}

/** Labelled study/review cues have no answer state and never contribute to a score. */
export function createEarExample(context: { readonly root: string; readonly quality: EarQuality; readonly referenceMidi?: number }, degree: EarDegree): EarQuestion {
  const question = createEarQuestion({ ...context, seed: 0 });
  const structure = createStructure(context.root, context.quality === 'major' ? 'major-triad' : 'minor-triad');
  const note = structure.notes.find(candidate => candidate.degree === degree);
  if (!note) throw new RangeError('В выбранном трезвучии нет такой ступени.');
  return immutable({ ...question, id: `example-${question.referenceMidi}-${context.quality}-${degree}`, targetDegree: degree, targetMidi: question.referenceMidi + note.semitones, targetName: note.name });
}

/** Beat 0: tonic, beat 1: silence, beat 2: target. The controller uses actual audio-end callbacks. */
export function getEarAudioEvents(question: EarQuestion, bpm = 80) {
  const beatSeconds = 60 / bpmValue(bpm);
  return immutable({ bpm, totalBeats: 3, durationSeconds: 3 * beatSeconds, events: [
    { kind: 'reference' as const, midi: question.referenceMidi, atBeat: 0, durationBeats: 1, atSeconds: 0, durationSeconds: beatSeconds },
    { kind: 'rest' as const, midi: null, atBeat: 1, durationBeats: 1, atSeconds: beatSeconds, durationSeconds: beatSeconds },
    { kind: 'target' as const, midi: question.targetMidi, atBeat: 2, durationBeats: 1, atSeconds: 2 * beatSeconds, durationSeconds: beatSeconds },
  ] });
}

export function startEarSession(config: EarConfig): EarSession {
  if (!Number.isInteger(config.count) || config.count < 1 || config.count > 20) throw new RangeError('Выберите от 1 до 20 слуховых вопросов.');
  seedValue(config.seed);
  let seed = config.seed;
  const questions = Array.from({ length: config.count }, () => { seed = seedValue(seed); return createEarQuestion({ ...config, seed }); });
  return immutable({ kind: 'ear', source: 'audio-choice', ...(config.routeRef ? { routeRef: { ...config.routeRef } } : {}), seed: config.seed, questions, questionIndex: 0,
    currentQuestion: questions[0], status: 'active', answerState: initialAnswer(), results: [] });
}

export function beginEarListen(session: EarSession, atMs: number, bpm = 80): EarSession {
  if (session.status !== 'active') return session;
  const previous = session.answerState;
  checkTime(previous, atMs);
  if (previous.activeListen) throw new Error('Прослушивание уже идёт. Дождись окончания или останови его.');
  const durationMs = getEarAudioEvents(session.currentQuestion, bpm).durationSeconds * 1000;
  const id = `${session.currentQuestion.id}:listen-${previous.listensStarted + 1}`;
  return immutable({ ...session, answerState: { ...previous, activeListen: { id, startedAtMs: atMs, minimumEndMs: atMs + durationMs, bpm },
    listensStarted: previous.listensStarted + 1, lastEventMs: atMs,
    listenEvents: [...previous.listenEvents, { type: 'start', listenId: id, atMs, bpm, order: previous.listenEvents.length + previous.answerEvents.length + 1 }], feedback: 'Слушай тонику и целевой звук.' } });
}

/** Pass activeListen.id to ignore a late callback from an older audio run. */
export function completeEarListen(session: EarSession, atMs: number, listenId?: string): EarSession {
  const previous = session.answerState;
  const active = previous.activeListen;
  if (session.status !== 'active' || !active || (listenId !== undefined && active.id !== listenId)) return session;
  checkTime(previous, atMs);
  if (atMs < active.minimumEndMs) throw new RangeError('Прослушивание ещё не могло завершиться. Дождись фактического конца звука.');
  return immutable({ ...session, answerState: { ...previous, activeListen: null, listensCompleted: previous.listensCompleted + 1,
    firstListenCompletedAtMs: previous.firstListenCompletedAtMs ?? atMs, lastEventMs: atMs,
    listenEvents: [...previous.listenEvents, { type: 'complete', listenId: active.id, atMs, order: previous.listenEvents.length + previous.answerEvents.length + 1 }], feedback: 'Выбери услышанную ступень. Можно послушать ещё раз.' } });
}

export function cancelEarListen(session: EarSession, atMs: number, listenId?: string): EarSession {
  const previous = session.answerState;
  const active = previous.activeListen;
  if (session.status !== 'active' || !active || (listenId !== undefined && active.id !== listenId)) return session;
  checkTime(previous, atMs);
  return immutable({ ...session, answerState: { ...previous, activeListen: null, listensCancelled: previous.listensCancelled + 1, lastEventMs: atMs,
    listenEvents: [...previous.listenEvents, { type: 'cancel', listenId: active.id, atMs, order: previous.listenEvents.length + previous.answerEvents.length + 1 }], feedback: 'Прослушивание остановлено. Незавершённый звук не считается прослушанным.' } });
}

export function submitEarAnswer(session: EarSession, degree: EarDegree, atMs: number): EarSession {
  if (session.status !== 'active') return session;
  const previous = session.answerState;
  checkTime(previous, atMs);
  if (previous.firstListenCompletedAtMs === null || previous.activeListen) throw new Error('Сначала дождись полного прослушивания тоники и целевого звука.');
  if (!session.currentQuestion.choices.some(choice => choice.id === degree)) throw new RangeError('Выбери одну из ступеней этого трезвучия.');
  const correct = degree === session.currentQuestion.targetDegree;
  return immutable({ ...session, status: correct ? 'review' : 'active', answerState: { ...previous,
    attempts: previous.attempts + 1, errors: previous.errors + (correct ? 0 : 1),
    firstAnswer: previous.firstAnswer ?? degree, firstResponseMs: previous.firstResponseMs ?? atMs - previous.firstListenCompletedAtMs,
    firstAttemptCorrect: previous.firstAttemptCorrect ?? correct, lastEventMs: atMs,
    answerEvents: [...previous.answerEvents, { degree, atMs, correct, order: previous.listenEvents.length + previous.answerEvents.length + 1 }], outcome: correct ? previous.errors === 0 ? 'correct' : 'corrected' : null,
    closedAtMs: correct ? atMs : null, feedback: correct ? `Верно: ${degree.replace('b', '♭')} — ${session.currentQuestion.targetName}.` : 'Ступень не совпала. Сравни тонику и цель; можно послушать ещё раз.' } });
}

function closeQuestion(session: EarSession, atMs: number, outcome: 'revealed' | 'skipped'): EarSession {
  if (session.status !== 'active') return session;
  checkTime(session.answerState, atMs);
  const cancelled = cancelEarListen(session, atMs);
  return immutable({ ...cancelled, status: 'review', answerState: { ...cancelled.answerState, outcome, closedAtMs: atMs, lastEventMs: atMs,
    feedback: outcome === 'skipped' ? 'Вопрос пропущен и не считается правильным ответом.' : `Ответ: ${session.currentQuestion.targetDegree.replace('b', '♭')} — ${session.currentQuestion.targetName}. Показ не считается самостоятельным ответом.` } });
}
export function revealEarAnswer(session: EarSession, atMs: number) { return closeQuestion(session, atMs, 'revealed'); }
export function skipEarQuestion(session: EarSession, atMs: number) { return closeQuestion(session, atMs, 'skipped'); }

function currentResult(session: EarSession): EarResult {
  const state = session.answerState;
  if (state.outcome === null || state.closedAtMs === null) throw new Error('Незавершённый слуховой вопрос ещё не имеет итогового результата.');
  return immutable({ kind: 'ear', source: 'audio-choice', question: session.currentQuestion,
    listensStarted: state.listensStarted, listensCompleted: state.listensCompleted, listensCancelled: state.listensCancelled,
    replayCount: Math.max(0, state.listensCompleted - 1), listenEvents: state.listenEvents, answerEvents: state.answerEvents,
    attempts: state.attempts, errors: state.errors, firstAnswer: state.firstAnswer, firstResponseMs: state.firstResponseMs,
    firstAttemptCorrect: state.firstAttemptCorrect, independentCorrect: state.outcome === 'correct', corrected: state.outcome === 'corrected',
    hintUsed: state.outcome === 'revealed', skipped: state.outcome === 'skipped', outcome: state.outcome,
    closedAtMs: state.closedAtMs, completionAfterListenMs: state.firstListenCompletedAtMs === null ? null : state.closedAtMs - state.firstListenCompletedAtMs });
}

export function nextEarQuestion(session: EarSession): EarSession {
  if (session.status !== 'review') return session;
  const results = [...session.results, currentResult(session)];
  const questionIndex = session.questionIndex + 1;
  if (questionIndex === session.questions.length) return immutable({ ...session, status: 'finished', results });
  return immutable({ ...session, questionIndex, currentQuestion: session.questions[questionIndex], status: 'active', answerState: initialAnswer(), results });
}

/** Keeps genuine partial events; an interrupted question never becomes a skip or a correct answer. */
export function collectEarResults(session: EarSession): readonly SavedEarResult[] {
  const results: SavedEarResult[] = [...session.results];
  if (session.status === 'review') results.push(currentResult(session));
  else if (session.status === 'active' && session.answerState.listensStarted > 0) {
    const state = session.answerState;
    results.push(immutable({ kind: 'ear', source: 'audio-choice', question: session.currentQuestion,
      listensStarted: state.listensStarted, listensCompleted: state.listensCompleted, listensCancelled: state.listensCancelled,
      replayCount: Math.max(0, state.listensCompleted - 1), listenEvents: state.listenEvents, answerEvents: state.answerEvents,
      attempts: state.attempts, errors: state.errors, firstAnswer: state.firstAnswer, firstResponseMs: state.firstResponseMs,
      firstAttemptCorrect: state.firstAttemptCorrect, independentCorrect: false, corrected: false, hintUsed: false, skipped: false,
      outcome: 'interrupted', closedAtMs: null, completionAfterListenMs: null }));
  }
  return immutable(results);
}

export function getEarSummary(session: EarSession) {
  const results = session.status === 'review' ? [...session.results, currentResult(session)] : session.results;
  return immutable({ kind: 'ear', source: 'audio-choice', total: session.questions.length, completed: results.length,
    independentCorrect: results.filter(result => result.independentCorrect).length, corrected: results.filter(result => result.corrected).length,
    errors: results.reduce((sum, result) => sum + result.errors, 0) + (session.status === 'active' ? session.answerState.errors : 0),
    hints: results.filter(result => result.hintUsed).length, skipped: results.filter(result => result.skipped).length,
    completedListens: results.reduce((sum, result) => sum + result.listensCompleted, 0) + (session.status === 'active' ? session.answerState.listensCompleted : 0),
    replayCount: results.reduce((sum, result) => sum + result.replayCount, 0) + (session.status === 'active' ? Math.max(0, session.answerState.listensCompleted - 1) : 0) });
}

export const GUIDED_ROUTE_STEPS = immutable([
  { id: 'fretboard' as const, name: 'Гриф', instruction: 'Найди знакомые ноты и ступени в выбранной области.' },
  { id: 'ear' as const, name: 'Слух', instruction: 'Сравни тонику и целевой звук трезвучия без подсказки грифа.' },
  { id: 'sequence' as const, name: 'Практика', instruction: 'Сыграй короткую последовательность с эталоном и отметь комфортный темп.' },
]);
