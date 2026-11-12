/**
 * «Проверь себя» (VIS-02 r1, утверждён как A+B): чистая обёртка над сессиями `training` и `ear`.
 * Тип вопроса задаёт способ ответа: «Найди …» — по позициям грифа (A), «Назови …» и слух — карточками (B).
 * Виды вопросов — все задания R-006 по материалу упражнения (P13-08): ступени, ноты, все позиции, высота, интервал.
 * Модуль без DOM и звука: время передаётся явно, правильный ответ наружу выдаётся только после ответа, показа или итога.
 */
import {
  beginEarListen, cancelEarListen, completeEarListen, nextEarQuestion, revealEarAnswer, skipEarQuestion, startEarSession, submitEarAnswer,
  type EarQuality, type EarSession,
} from '../../ear';
import type { ExercisePlan } from '../../exercises';
import { annotatePositions, createStructure, formatMidi, getPosition, getPositions, parseNote, type AnnotatedPosition, type MusicalStructure, type StringId } from '../../music';
import { validateCheckSpec, type CheckSpec } from '../../practice/plan';
import type { CheckOutcome } from '../../practice/results';
import { INTERVAL_DEGREES, nextQuestion, revealAnswer, skipQuestion, startQuiz, submitAnswer, type IntervalDegree, type QuestionContext, type QuizMode, type QuizSession } from '../../training';
import { exercisePlan, exerciseStructure, formatDegree, formatPosition, keyName, materialLabel, STRUCTURE_LABELS } from '../lesson/material';
import { boardWindow } from '../lesson/mini-board';

export type CheckMode = 'board' | 'cards' | 'ear';
/** Вид вопроса: задания R-006 по материалу. Ступени («Найди/Назови ступень») — основа плана и слуха. */
export type QuestionKind = QuizMode;
/** Ноты для вопросов о нотах: ноты структуры формы или все ноты её участка грифа. */
export type NoteScope = 'structure' | 'chromatic';
export interface QuestionSettings {
  readonly kind: QuestionKind;
  readonly scope: NoteScope;
  readonly interval: IntervalDegree;
}

export const QUESTION_KINDS: readonly { readonly id: QuestionKind; readonly label: string }[] = Object.freeze(([
  { id: 'find-degree', label: 'Найди ступень' },
  { id: 'name-degree', label: 'Назови ступень' },
  { id: 'find-note', label: 'Найди ноту' },
  { id: 'find-all', label: 'Найди все позиции' },
  { id: 'name-note', label: 'Назови ноту' },
  { id: 'find-pitch', label: 'Найди высоту' },
  { id: 'find-interval', label: 'Найди интервал' },
] as const).map(item => Object.freeze({ ...item })));
export const INTERVAL_CHOICES: readonly IntervalDegree[] = INTERVAL_DEGREES;

export const isDegreeKind = (kind: QuestionKind) => kind === 'find-degree' || kind === 'name-degree';
const isNamingKind = (kind: QuestionKind) => kind === 'name-note' || kind === 'name-degree';
/** Можно ли выбрать «все ноты участка»: ступени — только по структуре, интервал — всегда по всем нотам участка. */
export const scopeApplies = (kind: QuestionKind) => !isDegreeKind(kind) && kind !== 'find-interval';
/** Итог ступеней («Проверь себя» в истории) — только у вопросов о ступенях; остальные виды — экранные задания. */
export const recordsDegrees = (kind: QuestionKind) => isDegreeKind(kind);

export interface CheckMaterial {
  /** Описание проверки шага плана; у повтора ошибок — `null`. */
  readonly spec: CheckSpec | null;
  readonly plan: ExercisePlan | null;
  readonly structure: MusicalStructure;
  /** Позиции материала без повторов, подписанные ступенями структуры (у повтора ошибок — повторяемые позиции). */
  readonly positions: readonly AnnotatedPosition[];
  /** Все ноты участка материала (струны материала, лады от первого до последнего) — для интервала и «все ноты участка». */
  readonly chromatic: readonly AnnotatedPosition[];
  readonly earQuality: EarQuality | null;
  readonly fretMin: number;
  readonly fretMax: number;
  readonly root: string;
  readonly key: string;
  readonly material: string;
  readonly count: number;
  /** Повтор ошибок прежних заданий: вид вопроса и материал фиксированы. */
  readonly review: boolean;
}

const EAR_QUALITY: Partial<Record<MusicalStructure['id'], EarQuality>> = {
  'minor-pentatonic': 'minor-pentatonic', 'major-pentatonic': 'major-pentatonic', 'major-triad': 'major', 'minor-triad': 'minor',
};
const STRING_ORDER: readonly StringId[] = ['E', 'A', 'D', 'G'];

function area(positions: readonly AnnotatedPosition[], structure: MusicalStructure): readonly AnnotatedPosition[] {
  const frets = positions.map(position => position.fret);
  const strings = STRING_ORDER.filter(string => positions.some(position => position.string === string));
  return Object.freeze(annotatePositions(getPositions({ strings, fretMin: Math.min(...frets), fretMax: Math.max(...frets) }), structure));
}

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
    spec, plan, structure, positions: Object.freeze(positions), chromatic: area(positions, structure), earQuality: EAR_QUALITY[structure.id] ?? null,
    fretMin: window.fretMin, fretMax: window.fretMax, root: structure.root, key: keyName(structure), material: materialLabel(spec.exercise),
    count: spec.count, review: false,
  });
}

export const REVIEW_COUNT = 10;
/**
 * Повтор ошибок прежних заданий (R-011): только перечисленные позиции в исходной тональности и структуре,
 * вопрос «Назови ноту» по всем нотам этих позиций, как прежний повтор во вкладке «Задания».
 */
export function reviewMaterial(positionIds: readonly string[], context: Pick<QuestionContext, 'root' | 'structureId'>): CheckMaterial {
  const ids = [...new Set(positionIds)];
  if (!ids.length) throw new RangeError('Позиций для повтора нет.');
  const positions = ids.map(id => {
    const [string, fret] = id.split(':');
    if (!STRING_ORDER.includes(string as StringId) || !/^\d{1,2}$/.test(fret ?? '') || Number(fret) > 24) throw new RangeError(`Неизвестная позиция для повтора: ${id}.`);
    return getPosition(string as StringId, Number(fret));
  });
  const structure = createStructure(parseNote(context.root).name, context.structureId);
  const annotated = Object.freeze(annotatePositions(positions, structure));
  const window = boardWindow(annotated.map(position => position.fret), 6);
  return Object.freeze({
    spec: null, plan: null, structure, positions: annotated, chromatic: annotated, earQuality: null,
    fretMin: window.fretMin, fretMax: window.fretMax, root: structure.root, key: keyName(structure),
    material: `повтор ошибок · ${keyName(structure)} · ${STRUCTURE_LABELS[structure.id]} · ${ids.length} ${ids.length % 10 === 1 && ids.length % 100 !== 11 ? 'позиция' : ids.length % 10 >= 2 && ids.length % 10 <= 4 && (ids.length % 100 < 12 || ids.length % 100 > 14) ? 'позиции' : 'позиций'}`,
    count: REVIEW_COUNT, review: true,
  });
}

/** Начальные настройки вопроса: вид шага плана, у повтора ошибок — «Назови ноту» по всем нотам. */
export function defaultSettings(material: CheckMaterial): QuestionSettings {
  return material.review ? { kind: 'name-note', scope: 'chromatic', interval: '#4' } : { kind: material.spec?.kind ?? 'find-degree', scope: 'structure', interval: '#4' };
}

/** Слух выбирает карточки (B) и только для ступеней; иначе «Найди …» — гриф (A), «Назови …» — карточки (B). */
export function modeFor(material: CheckMaterial, ear = material.spec?.ear ?? false, kind: QuestionKind = defaultSettings(material).kind): CheckMode {
  if (ear && material.earQuality && isDegreeKind(kind)) return 'ear';
  return isNamingKind(kind) ? 'cards' : 'board';
}

export type CheckRun =
  | { readonly mode: 'board' | 'cards'; readonly quiz: QuizSession }
  | { readonly mode: 'ear'; readonly ear: EarSession };

/** Вид вопроса серии. */
export const runKind = (run: CheckRun): QuestionKind => run.mode === 'ear' ? 'name-degree' : run.quiz.questions[0].mode;

export function startRun(material: CheckMaterial, mode: CheckMode, seed: number, count = material.count, settings?: QuestionSettings): CheckRun {
  if (mode === 'ear') {
    if (!material.earQuality) throw new RangeError('Слух пока работает только для пентатоник и трезвучий.');
    return { mode, ear: startEarSession({ root: material.root, quality: material.earQuality, count, seed }) };
  }
  const kind = settings?.kind ?? (mode === 'board' ? 'find-degree' : 'name-degree');
  if (isNamingKind(kind) !== (mode === 'cards')) throw new RangeError('Способ ответа не соответствует виду вопроса.');
  if (material.review && kind !== 'name-note') throw new RangeError('Повтор ошибок задаёт вопрос «Назови ноту».');
  const chromatic = kind === 'find-interval' || material.review || (settings?.scope === 'chromatic' && scopeApplies(kind));
  const quiz = startQuiz({
    positions: chromatic ? material.chromatic : material.positions, structure: material.structure, box: null, mode: kind,
    scope: chromatic ? 'chromatic' : 'structure', intervalDegree: settings?.interval ?? '#4', seed,
  }, count);
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
  const first = previous.quiz.questions[0];
  const interval = first.mode === 'find-interval' && INTERVAL_DEGREES.includes(first.target.degree as IntervalDegree) ? first.target.degree as IntervalDegree : '#4';
  const settings: QuestionSettings = { kind: runKind(previous), scope: first.context.scope, interval };
  const fresh = startRun(material, previous.mode, seed, 1, settings) as { mode: 'board' | 'cards'; quiz: QuizSession };
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

/** Нота с октавой, если вопрос о точной высоте. */
const targetText = (question: QuizSession['currentQuestion']) => question.targetMidi === null ? question.target.name : formatMidi(question.targetMidi, question.target.name);
const keysHint = (count: number) => count > 9 ? 'кнопкой или клавишей 1–9' : `кнопкой или клавишей 1–${count}`;
/** Позиции, среди которых отвечают в этой серии (материал вопроса). */
const quizArea = (run: CheckRun & { mode: 'board' | 'cards' }) => run.quiz.currentQuestion.context.positionIds;
const INTERVAL_FROM_SEMITONES = ['1', '♭2', '2', '♭3', '3', '4', '♯4/♭5', '5', '♭6', '6', '♭7', '7'];

/**
 * Текст вопроса. Вопрос «найди» называет искомое (ступень, ноту, высоту или интервал) — это сам вопрос;
 * у карточек и слуха ответа в тексте нет.
 */
export function prompt(run: CheckRun, material: CheckMaterial): Prompt {
  if (run.mode === 'ear') return { kind: '♪ Услышь и назови', title: 'Какая ступень прозвучала?', sub: `Сначала тоника ${material.root}, потом нота материала. Ответы откроются после конца сигнала.` };
  const question = run.quiz.currentQuestion;
  const frets = quizArea(run).map(id => Number(id.split(':')[1]));
  const window = `лады ${Math.min(...frets)}–${Math.max(...frets)}`;
  const notes = question.context.scope === 'chromatic' ? 'все ноты участка' : 'ноты материала';
  switch (question.mode) {
    case 'find-degree': return { kind: 'Найди на грифе', title: `Найди ${question.target.degree === '1' ? 'тонику 1' : formatDegree(question.target.degree)}`, sub: `Тоника — ${material.root}. Материал: ${material.material}, ${window}. Подходит любая позиция этой ступени в материале.` };
    case 'name-degree': return { kind: 'Назови ступень', title: `Какая это ступень от ${material.root}?`, sub: `Отмеченная нота — ${formatPosition(question.targetPositionId!)}. Ответь ${keysHint(question.choices.length)}.` };
    case 'name-note': return { kind: 'Назови ноту', title: 'Какая это нота?', sub: `Отмеченная позиция — ${formatPosition(question.targetPositionId!)}. Октава не важна. Ответь ${keysHint(question.choices.length)}.` };
    case 'find-note': return { kind: 'Найди ноту', title: `Найди ${question.target.name}`, sub: `Материал: ${material.material}, ${window}, ${notes}. Подходит любая её позиция.` };
    case 'find-all': return { kind: 'Найди все позиции', title: `Найди все ${question.target.name} — их ${question.expectedPositionIds.length}`, sub: `Материал: ${material.material}, ${window}, ${notes}. Одна нота встречается в разных октавах.` };
    case 'find-pitch': return { kind: 'Найди высоту', title: `Найди ${targetText(question)}`, sub: `Точная высота: другая октава не подходит. Материал: ${material.material}, ${window}, ${notes}.` };
    case 'find-interval': return { kind: 'Найди интервал', title: `Найди ${formatDegree(question.target.degree)} от ${material.root}`, sub: `Интервал от тоники в любой октаве. Доступны все ноты участка: ${window}, включая ноты вне структуры.` };
  }
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
/** Позиция входит в материал вопроса серии (для ступеней — ноты структуры материала). */
export function inQuizArea(run: CheckRun, material: CheckMaterial, positionId: string): boolean {
  return run.mode === 'ear' ? material.positions.some(position => position.id === positionId) : quizArea(run).includes(positionId);
}
function positionAt(material: CheckMaterial, positionId: string): AnnotatedPosition | null {
  const [string, fret] = positionId.split(':');
  if (!STRING_NAMES.includes(string as StringId)) return null;
  return annotatePositions([getPosition(string as StringId, Number(fret))], material.structure)[0];
}

/** Нота произвольной позиции по написанию структуры (для объяснения ошибки, после ответа). */
export function noteAt(material: CheckMaterial, positionId: string, withOctave = false): string {
  const position = positionAt(material, positionId);
  return position ? withOctave ? formatMidi(position.midi, position.noteName) : position.noteName : '';
}

/** Отклик на неверный ответ: что нажато, без раскрытия правильного ответа (искомое уже названо в вопросе). */
export function wrongFeedback(run: CheckRun, material: CheckMaterial, answer: { positionId?: string; choice?: number }): string {
  if (run.mode === 'board' && answer.positionId) {
    const here = formatPosition(answer.positionId);
    const question = run.quiz.currentQuestion;
    const inside = inQuizArea(run, material, answer.positionId);
    if (question.mode === 'find-degree') {
      const target = question.target.degree;
      const degree = degreeAt(material, answer.positionId);
      if (!inside) return degree === target
        ? `${here} — тоже ${formatDegree(degree)}, но вне материала упражнения. Найди её внутри.`
        : `${here} — вне материала упражнения (${material.material}). Ищи внутри.`;
      return `${here} — это ${formatDegree(degree)}, не ${formatDegree(target)}. Попробуй ещё.`;
    }
    const position = positionAt(material, answer.positionId);
    if (!position) return `${here} — нет такой позиции.`;
    if (question.mode === 'find-interval') {
      const semitones = (position.pitchClass - parseNote(material.root).pitchClass + 12) % 12;
      const sameClass = position.pitchClass === question.target.pitchClass;
      if (!inside) return sameClass ? `${here} — тоже ${formatDegree(question.target.degree)} от ${material.root}, но вне участка. Найди внутри.` : `${here} — вне участка вопроса. Ищи внутри.`;
      return `${here} — это ${position.noteName}, ${INTERVAL_FROM_SEMITONES[semitones]} от ${material.root}; нужен ${formatDegree(question.target.degree)}. Считай полутоны от тоники.`;
    }
    const heard = question.mode === 'find-pitch' ? formatMidi(position.midi, position.noteName) : position.noteName;
    const match = question.mode === 'find-pitch' ? position.midi === question.targetMidi : position.pitchClass === question.target.pitchClass;
    if (!inside) return match ? `${here} — тоже ${targetText(question)}, но вне материала вопроса. Найди внутри.` : `${here} — вне материала вопроса (${material.material}). Ищи внутри.`;
    return question.mode === 'find-pitch' && position.pitchClass === question.target.pitchClass
      ? `${here} — это ${heard}: та же нота, другая октава. Нужна ${targetText(question)}.`
      : `${here} — это ${heard}, не ${targetText(question)}. Попробуй ещё.`;
  }
  const label = choiceLabels(run)[answer.choice ?? -1] ?? '';
  if (run.mode === 'ear') return `Не ${label}. Попробуй ещё или прослушай снова — повтор не ошибка.`;
  return run.quiz.currentQuestion.mode === 'name-note'
    ? `Не ${label}. Попробуй ещё — отсчитай лады от открытой струны.`
    : `Не ${label}. Попробуй ещё — считай полутоны от ближайшей ${material.root}.`;
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
  if (question.mode === 'name-note') {
    return { degree, positions: [question.targetPositionId!], text: `${formatPosition(question.targetPositionId!)} — ${question.target.name}.` };
  }
  if (question.mode !== 'find-degree' && question.mode !== 'name-degree') {
    const what = question.mode === 'find-interval' ? `${formatDegree(degree)} от ${material.root} — ${question.target.name}` : targetText(question);
    return { degree, positions: question.expectedPositionIds, text: `${what}: ${question.expectedPositionIds.map(formatPosition).join(', ')}.` };
  }
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
  const question = run.mode === 'ear' ? null : run.quiz.questions[entry.index];
  if (question && question.mode !== 'find-degree' && question.mode !== 'name-degree') {
    if (question.mode === 'name-note') return { question: `Нота ${formatPosition(question.targetPositionId ?? '')}`, answer: shown ? question.target.name : '—' };
    const asked = question.mode === 'find-interval' ? `Найди ${formatDegree(question.target.degree)} от ${material.root}` : question.mode === 'find-all' ? `Найди все ${question.target.name}` : `Найди ${targetText(question)}`;
    return { question: asked, answer: shown ? question.expectedPositionIds.map(formatPosition).join(', ') : '—' };
  }
  if (run.mode === 'board') {
    const positions = material.positions.filter(position => position.degree === entry.degree).map(position => formatPosition(position.id));
    return { question: `Найди ${degree}`, answer: shown ? positions.join(', ') : '—' };
  }
  if (run.mode === 'cards') return { question: `Ступень ноты ${formatPosition(entry.positionId ?? '')}`, answer: shown ? degree : '—' };
  return { question: '♪ Услышь ступень', answer: shown ? degree : '—' };
}
