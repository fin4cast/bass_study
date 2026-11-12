/**
 * «Проверь себя» (VIS-02 r1, утверждён как A+B): чистая обёртка над сессиями `training` и `ear`.
 * Тип вопроса задаёт способ ответа: «Найди ступень» — по позициям грифа (A), «Назови ступень» и слух — карточками (B).
 * Модуль без DOM и звука: время передаётся явно, правильный ответ наружу выдаётся только после ответа, показа или итога.
 */
import {
  beginEarListen, cancelEarListen, completeEarListen, nextEarQuestion, revealEarAnswer, skipEarQuestion, startEarSession, submitEarAnswer,
  type EarQuality, type EarSession,
} from '../../ear';
import type { ExercisePlan } from '../../exercises';
import { annotatePositions, getPosition, type AnnotatedPosition, type MusicalStructure, type StringId } from '../../music';
import { validateCheckSpec, type CheckSpec } from '../../practice/plan';
import type { CheckOutcome } from '../../practice/results';
import { nextQuestion, revealAnswer, skipQuestion, startQuiz, submitAnswer, type QuizSession } from '../../training';
import { exercisePlan, exerciseStructure, formatDegree, formatPosition, keyName, materialLabel } from '../lesson/material';
import { boardWindow } from '../lesson/mini-board';

export type CheckMode = 'board' | 'cards' | 'ear';
export interface CheckMaterial {
  readonly spec: CheckSpec;
  readonly plan: ExercisePlan;
  readonly structure: MusicalStructure;
  /** Позиции материала без повторов, подписанные ступенями структуры. */
  readonly positions: readonly AnnotatedPosition[];
  readonly earQuality: EarQuality | null;
  readonly fretMin: number;
  readonly fretMax: number;
  readonly root: string;
  readonly key: string;
  readonly material: string;
}

const EAR_QUALITY: Partial<Record<MusicalStructure['id'], EarQuality>> = {
  'minor-pentatonic': 'minor-pentatonic', 'major-pentatonic': 'major-pentatonic', 'major-triad': 'major', 'minor-triad': 'minor',
};

export function checkMaterial(input: CheckSpec): CheckMaterial {
  const spec = validateCheckSpec(JSON.parse(JSON.stringify(input)));
  const structure = exerciseStructure(spec.exercise);
  if (!structure) throw new RangeError('В материале этого упражнения нет ступеней одной тоники — проверка ступеней недоступна.');
  const plan = exercisePlan(spec.exercise);
  const unique = [...new Map(plan.positions.map(position => [position.id, position])).values()];
  const positions = annotatePositions(unique, structure).filter(position => position.inStructure);
  if (!positions.length) throw new RangeError('В материале нет нот выбранной структуры.');
  const window = boardWindow(positions.map(position => position.fret), 6);
  return Object.freeze({
    spec, plan, structure, positions: Object.freeze(positions), earQuality: EAR_QUALITY[structure.id] ?? null,
    fretMin: window.fretMin, fretMax: window.fretMax, root: structure.root, key: keyName(structure), material: materialLabel(spec.exercise),
  });
}

/** Слух выбирает карточки (B); без слуха «Найди ступень» — гриф (A), «Назови ступень» — карточки (B). */
export function modeFor(material: CheckMaterial, ear = material.spec.ear): CheckMode {
  if (ear && material.earQuality) return 'ear';
  return material.spec.kind === 'find-degree' ? 'board' : 'cards';
}

export type CheckRun =
  | { readonly mode: 'board' | 'cards'; readonly quiz: QuizSession }
  | { readonly mode: 'ear'; readonly ear: EarSession };

export function startRun(material: CheckMaterial, mode: CheckMode, seed: number, count = material.spec.count): CheckRun {
  if (mode === 'ear') {
    if (!material.earQuality) throw new RangeError('Слух пока работает только для пентатоник и трезвучий.');
    return { mode, ear: startEarSession({ root: material.root, quality: material.earQuality, count, seed }) };
  }
  const quiz = startQuiz({ positions: material.positions, structure: material.structure, box: null, mode: mode === 'board' ? 'find-degree' : 'name-degree', seed }, count);
  return { mode, quiz };
}

/** «Повторить трудные»: те же вопросы по индексам прошлой серии, с чистыми ответами. */
export function retryRun(material: CheckMaterial, previous: CheckRun, indices: readonly number[], seed: number): CheckRun {
  if (!indices.length) throw new RangeError('Трудных вопросов нет.');
  if (previous.mode === 'ear') {
    const questions = indices.map(index => previous.ear.questions[index]);
    const fresh = startEarSession({ root: material.root, quality: material.earQuality!, count: 1, seed });
    return { mode: 'ear', ear: Object.freeze({ ...fresh, questions: Object.freeze(questions), currentQuestion: questions[0] }) };
  }
  const questions = indices.map(index => previous.quiz.questions[index]);
  const fresh = startRun(material, previous.mode, seed, 1) as { mode: 'board' | 'cards'; quiz: QuizSession };
  return { mode: previous.mode, quiz: Object.freeze({ ...fresh.quiz, questions: Object.freeze(questions), currentQuestion: questions[0] }) };
}

export const runStatus = (run: CheckRun) => run.mode === 'ear' ? run.ear.status : run.quiz.status;
export const questionIndex = (run: CheckRun) => run.mode === 'ear' ? run.ear.questionIndex : run.quiz.questionIndex;
export const questionCount = (run: CheckRun) => run.mode === 'ear' ? run.ear.questions.length : run.quiz.questions.length;
/** Время последнего события текущего вопроса: следующий ответ не может быть раньше. */
export const lastEventMs = (run: CheckRun) => run.mode === 'ear' ? run.ear.answerState.lastEventMs : run.quiz.answerState.lastElapsedMs;

/* ---------- Действия ---------- */

export function answerPosition(run: CheckRun, positionId: string, atMs: number): CheckRun {
  if (run.mode !== 'board') throw new Error('Ответ позицией — только в вопросе «Найди на грифе».');
  return { mode: run.mode, quiz: submitAnswer(run.quiz, positionId, atMs) };
}
/** Ответ карточкой по номеру варианта (клавиши 1–N). */
export function answerChoice(run: CheckRun, index: number, atMs: number): CheckRun {
  if (run.mode === 'ear') {
    const choice = run.ear.currentQuestion.choices[index];
    if (!choice) throw new RangeError('Нет такого варианта.');
    return { mode: 'ear', ear: submitEarAnswer(run.ear, choice.id, atMs) };
  }
  if (run.mode !== 'cards') throw new Error('Ответ карточкой — только в вопросе «Назови ступень».');
  const choice = run.quiz.currentQuestion.choices[index];
  if (!choice) throw new RangeError('Нет такого варианта.');
  return { mode: run.mode, quiz: submitAnswer(run.quiz, choice.id, atMs) };
}
export function reveal(run: CheckRun, atMs: number): CheckRun {
  return run.mode === 'ear' ? { mode: 'ear', ear: revealEarAnswer(run.ear, atMs) } : { mode: run.mode, quiz: revealAnswer(run.quiz, atMs) };
}
export function skip(run: CheckRun, atMs: number): CheckRun {
  return run.mode === 'ear' ? { mode: 'ear', ear: skipEarQuestion(run.ear, atMs) } : { mode: run.mode, quiz: skipQuestion(run.quiz, atMs) };
}
export function advance(run: CheckRun): CheckRun {
  return run.mode === 'ear' ? { mode: 'ear', ear: nextEarQuestion(run.ear) } : { mode: run.mode, quiz: nextQuestion(run.quiz) };
}
export function beginListen(run: CheckRun, atMs: number, bpm: number): CheckRun {
  if (run.mode !== 'ear') return run;
  return { mode: 'ear', ear: beginEarListen(run.ear, atMs, bpm) };
}
export function completeListen(run: CheckRun, atMs: number, listenId: string): CheckRun {
  if (run.mode !== 'ear') return run;
  return { mode: 'ear', ear: completeEarListen(run.ear, atMs, listenId) };
}
export function cancelListen(run: CheckRun, atMs: number): CheckRun {
  if (run.mode !== 'ear' || !run.ear.answerState.activeListen) return run;
  return { mode: 'ear', ear: cancelEarListen(run.ear, atMs, run.ear.answerState.activeListen.id) };
}
/** Ответы открыты: вопрос активен, а у слуха — сигнал полностью прозвучал и сейчас не звучит. */
export function answersOpen(run: CheckRun): boolean {
  if (runStatus(run) !== 'active') return false;
  if (run.mode !== 'ear') return true;
  return run.ear.answerState.firstListenCompletedAtMs !== null && run.ear.answerState.activeListen === null;
}
export function hasActivity(run: CheckRun): boolean {
  if (run.mode === 'ear') return run.ear.results.length > 0 || run.ear.answerState.listensStarted > 0 || run.ear.answerState.attempts > 0;
  return run.quiz.results.length > 0 || run.quiz.answerState.attempts > 0 || run.quiz.status !== 'active';
}

/* ---------- Вопрос и подписи без утечки ответа ---------- */

const STRING_NAMES: readonly StringId[] = ['E', 'A', 'D', 'G'];
export interface Prompt { readonly kind: string; readonly title: string; readonly sub: string }

/** Текст вопроса. Для «Найди ступень» ступень — это сам вопрос; у карточек и слуха ступени в тексте нет. */
export function prompt(run: CheckRun, material: CheckMaterial): Prompt {
  const window = `лады ${Math.min(...material.positions.map(p => p.fret))}–${Math.max(...material.positions.map(p => p.fret))}`;
  if (run.mode === 'ear') return { kind: '♪ Услышь и назови', title: 'Какая ступень прозвучала?', sub: `Сначала тоника ${material.root}, потом нота материала. Ответы откроются после конца сигнала.` };
  const question = run.quiz.currentQuestion;
  if (run.mode === 'board') return { kind: 'Найди на грифе', title: `Найди ${question.target.degree === '1' ? 'тонику 1' : formatDegree(question.target.degree)}`, sub: `Тоника — ${material.root}. Материал: ${material.material}, ${window}. Подходит любая позиция этой ступени в материале.` };
  return { kind: 'Назови ступень', title: `Какая это ступень от ${material.root}?`, sub: `Отмеченная нота — ${formatPosition(question.targetPositionId!)}. Ответь кнопкой или клавишей 1–${question.choices.length}.` };
}

/** Отмеченная позиция вопроса «Назови ступень» — это сам вопрос, а не ответ. */
export const markedPosition = (run: CheckRun) => run.mode === 'cards' ? run.quiz.currentQuestion.targetPositionId ?? null : null;

export function choiceLabels(run: CheckRun): readonly string[] {
  return run.mode === 'ear' ? run.ear.currentQuestion.choices.map(choice => choice.label)
    : run.mode === 'cards' ? run.quiz.currentQuestion.choices.map(choice => choice.label) : [];
}

/** Ступень произвольной позиции грифа по структуре материала (для объяснения ошибки, после ответа). */
export function degreeAt(material: CheckMaterial, positionId: string): string | null {
  const [string, fret] = positionId.split(':');
  if (!STRING_NAMES.includes(string as StringId)) return null;
  return annotatePositions([getPosition(string as StringId, Number(fret))], material.structure)[0].degree;
}
const inMaterial = (material: CheckMaterial, positionId: string) => material.positions.some(position => position.id === positionId);

/** Отклик на неверный ответ: что нажато, без раскрытия правильного ответа. */
export function wrongFeedback(run: CheckRun, material: CheckMaterial, answer: { positionId?: string; choice?: number }): string {
  if (run.mode === 'board' && answer.positionId) {
    const here = formatPosition(answer.positionId);
    const target = run.quiz.currentQuestion.target.degree;
    const degree = degreeAt(material, answer.positionId);
    if (!inMaterial(material, answer.positionId)) return degree === target
      ? `${here} — тоже ${formatDegree(degree)}, но вне материала упражнения. Найди её внутри.`
      : `${here} — вне материала упражнения (${material.material}). Ищи внутри.`;
    return `${here} — это ${formatDegree(degree)}, не ${formatDegree(target)}. Попробуй ещё.`;
  }
  const label = choiceLabels(run)[answer.choice ?? -1] ?? '';
  return run.mode === 'ear' ? `Не ${label}. Попробуй ещё или прослушай снова — повтор не ошибка.` : `Не ${label}. Попробуй ещё — считай полутоны от ближайшей ${material.root}.`;
}

/** Правильный ответ текущего вопроса — только когда вопрос закрыт (верно или показан). */
export function revealedAnswer(run: CheckRun, material: CheckMaterial): { degree: string; positions: readonly string[]; text: string } | null {
  if (runStatus(run) !== 'review') return null;
  if (run.mode === 'ear') {
    const state = run.ear.answerState;
    if (state.outcome === 'skipped') return null;
    const question = run.ear.currentQuestion;
    const positions = material.positions.filter(position => position.degree === question.targetDegree).map(position => position.id);
    return { degree: question.targetDegree, positions, text: `${formatDegree(question.targetDegree)} от ${material.root} — ${question.targetName}${positions.length ? `; в материале: ${positions.map(formatPosition).join(', ')}` : ''}.` };
  }
  if (run.quiz.answerState.status === 'skipped') return null;
  const question = run.quiz.currentQuestion;
  const degree = question.target.degree ?? '';
  if (run.mode === 'cards') {
    const position = material.positions.find(item => item.id === question.targetPositionId)!;
    return { degree, positions: [position.id], text: `${formatPosition(position.id)} — ${position.noteName}, ${formatDegree(degree)} от ${material.root}.` };
  }
  return { degree, positions: question.expectedPositionIds, text: `${formatDegree(degree)} от ${material.root} — ${question.expectedPositionIds.map(id => `${formatPosition(id)} ${material.positions.find(position => position.id === id)!.noteName}`).join('; ')}.` };
}

/* ---------- Итог ---------- */

export interface CheckEntry {
  readonly index: number;
  /** Ступень вопроса, например `b7`; до итога хранится только в модели. */
  readonly degree: string;
  readonly outcome: CheckOutcome | 'pending';
  readonly errors: number;
  readonly listens: number;
  readonly positionId: string | null;
}

function closedOutcome(run: CheckRun): CheckOutcome | null {
  if (run.mode === 'ear') {
    const outcome = run.ear.status === 'review' ? run.ear.answerState.outcome : null;
    return outcome ?? null;
  }
  if (run.quiz.status !== 'review') return null;
  const state = run.quiz.answerState;
  if (state.status === 'completed') return state.errors === 0 && !state.hintUsed ? 'correct' : 'corrected';
  return state.status === 'revealed' ? 'revealed' : state.status === 'skipped' ? 'skipped' : null;
}

/** Строки серии: закрытые вопросы, текущий и ещё не заданные (`pending`). */
export function entries(run: CheckRun): readonly CheckEntry[] {
  const list: CheckEntry[] = [];
  if (run.mode === 'ear') {
    run.ear.results.forEach((result, index) => list.push({ index, degree: result.question.targetDegree, outcome: result.outcome, errors: result.errors, listens: result.listensCompleted, positionId: null }));
    const state = run.ear.answerState;
    run.ear.questions.slice(run.ear.results.length).forEach((question, offset) => {
      const current = offset === 0 && run.ear.status !== 'finished';
      list.push({ index: run.ear.results.length + offset, degree: question.targetDegree, outcome: current ? closedOutcome(run) ?? 'pending' : 'pending', errors: current ? state.errors : 0, listens: current ? state.listensCompleted : 0, positionId: null });
    });
    return list;
  }
  run.quiz.results.forEach((result, index) => list.push({ index, degree: result.target.degree ?? '', outcome: result.outcome, errors: result.errors, listens: 0, positionId: run.quiz.questions[index].targetPositionId ?? null }));
  run.quiz.questions.slice(run.quiz.results.length).forEach((question, offset) => {
    const current = offset === 0 && run.quiz.status !== 'finished';
    list.push({ index: run.quiz.results.length + offset, degree: question.target.degree ?? '', outcome: current ? closedOutcome(run) ?? 'pending' : 'pending', errors: current ? run.quiz.answerState.errors : 0, listens: 0, positionId: question.targetPositionId ?? null });
  });
  return list;
}

/** Ответы для `CheckRecord`: незаданные и незакрытые вопросы — «без ответа», ошибки сохраняются. */
export function recordAnswers(list: readonly CheckEntry[]): readonly { readonly degree: string; readonly outcome: CheckOutcome; readonly errors: number }[] {
  return Object.freeze(list.map(entry => Object.freeze({ degree: entry.degree, outcome: entry.outcome === 'pending' ? 'unanswered' as const : entry.outcome, errors: entry.errors })));
}

export interface CheckSummary {
  readonly mode: CheckMode;
  readonly total: number;
  readonly correct: number;
  readonly corrected: number;
  readonly revealed: number;
  readonly skipped: number;
  readonly unanswered: number;
  readonly errors: number;
  /** Полные прослушивания и повторы — не ошибки и не показы. */
  readonly listens: number;
  readonly replays: number;
  readonly early: boolean;
}

export function summarize(run: CheckRun, list: readonly CheckEntry[] = entries(run)): CheckSummary {
  const answers = recordAnswers(list);
  const count = (outcome: CheckOutcome) => answers.filter(answer => answer.outcome === outcome).length;
  const listens = list.reduce((sum, entry) => sum + entry.listens, 0);
  const replays = list.reduce((sum, entry) => sum + Math.max(0, entry.listens - 1), 0);
  return Object.freeze({
    mode: run.mode, total: list.length, correct: count('correct'), corrected: count('corrected'), revealed: count('revealed'), skipped: count('skipped'),
    unanswered: count('unanswered'), errors: answers.reduce((sum, answer) => sum + answer.errors, 0), listens, replays, early: count('unanswered') > 0,
  });
}

/** «Трудные» — всё, что не решено самостоятельно с первой попытки. */
export const hardIndices = (list: readonly CheckEntry[]) => list.filter(entry => entry.outcome !== 'correct').map(entry => entry.index);

export const OUTCOME_LABELS: Readonly<Record<CheckOutcome, string>> = Object.freeze({
  correct: 'Самостоятельно', corrected: 'С исправлением', revealed: 'Показано', skipped: 'Пропущено', unanswered: 'Без ответа',
});

/** Строка итога: вопрос и ответ (ответ — только для решённых и показанных). */
export function summaryRow(run: CheckRun, material: CheckMaterial, entry: CheckEntry): { question: string; answer: string } {
  const shown = entry.outcome === 'correct' || entry.outcome === 'corrected' || entry.outcome === 'revealed';
  const degree = formatDegree(entry.degree);
  if (run.mode === 'board') {
    const positions = material.positions.filter(position => position.degree === entry.degree).map(position => formatPosition(position.id));
    return { question: `Найди ${degree}`, answer: shown ? positions.join(', ') : '—' };
  }
  if (run.mode === 'cards') return { question: `Ступень ноты ${formatPosition(entry.positionId ?? '')}`, answer: shown ? degree : '—' };
  return { question: '♪ Услышь ступень', answer: shown ? degree : '—' };
}
