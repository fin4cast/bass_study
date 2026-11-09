import { annotatePositions, parseNote, type AnnotatedPosition } from '../music';
import { getBoxInstanceV1 } from '../music/boxes';
import { createIntervalTarget, createPitchTarget } from './constraints';
import type { AnswerEvent, Question, QuestionContext, QuizAnswer, QuizConfig, QuizMode, QuizResult, TrainingConfig } from './index';

const QUIZ_MODES: readonly QuizMode[] = ['name-note', 'find-note', 'find-all', 'find-degree', 'find-pitch', 'find-interval'];
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

export function eligiblePositionsV1(config: TrainingConfig): readonly AnnotatedPosition[] {
  const scope = config.scope ?? 'structure';
  if (scope !== 'structure' && scope !== 'chromatic') throw new RangeError('Неизвестная область: выберите ноты структуры или все ноты.');
  let supplied = config.positions;
  if (config.box) {
    const box = getBoxInstanceV1(config.box);
    if (box.selection.root !== config.structure.root || box.selection.structureId !== config.structure.id) throw new RangeError('Форма не соответствует выбранной тонике и структуре.');
    const allowed = new Set(config.positions.map(position => position.id));
    if (box.referencePositionIds.some(id => !allowed.has(id))) throw new RangeError('Учебная форма не помещается в доступную область. Покажи её целиком.');
    supplied = box.positions;
  }
  const annotated = annotatePositions(supplied, config.structure);
  const unique = [...new Map(annotated.map(position => [position.id, position])).values()];
  return unique.filter(position => scope === 'chromatic' || position.inStructure);
}

export function createQuestionV1(config: QuizConfig, forcedPitchClass?: number): Question {
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
  const effectiveIds = config.box && config.mode !== 'find-interval' ? eligiblePositionsV1(config).map(position => position.id) : config.positions.map(position => position.id);
  const context: QuestionContext = { scope, root: config.structure.root, structureId: config.structure.id, positionIds: [...new Set(effectiveIds)], ...(config.box && config.mode !== 'find-interval' ? { box: getBoxInstanceV1(config.box).selection } : {}) };
  if (config.mode === 'find-pitch' || config.mode === 'find-interval') {
    const generated = config.mode === 'find-pitch' ? createPitchTarget({ ...config, positions: eligiblePositionsV1(config) })
      : createIntervalTarget(config.structure.root, config.intervalDegree ?? '#4', config.positions);
    return immutable({
      id: `q-${config.seed.toString(16)}-${config.mode}-${generated.targetMidi ?? generated.target.degree}`,
      mode: config.mode, seed: config.seed, context, ...generated, choices,
      answerRule: config.mode === 'find-pitch' ? 'exact-pitch' : 'any-position',
    });
  }
  const positions = eligiblePositionsV1(config);
  if (positions.length === 0) throw new RangeError('В выбранной области нет подходящих нот. Измените струны, лады или структуру.');
  const next = randomUint32(config.seed);
  const targets = config.mode === 'name-note'
    ? positions
    : [...new Map(positions.map(position => [position.pitchClass, position])).values()];
  const selected = forcedPitchClass === undefined ? targets[Math.floor((next() / 0x100000000) * targets.length)] : targets.find(position => position.pitchClass === forcedPitchClass);
  if (!selected) throw new RangeError('Запрошенная нота отсутствует в учебной форме.');
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
/** Saved series with a v1 policy always use this ordering and these question IDs. */
export function createQuizQuestionsV1(config: QuizConfig, count: number): readonly Question[] {
  validateSeed(config.seed);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('Число заданий должно быть целым от 1 до 100.');
  const next = randomUint32(config.seed);
  const questionPolicy = config.questionPolicy ?? 'random-v1';
  if (!['random-v1', 'triad-6-v1', 'shape-6-v1'].includes(questionPolicy)) throw new RangeError('Неизвестное правило набора вопросов.');
  let targetClasses: number[] | null = null;
  if (questionPolicy === 'triad-6-v1') {
    if (count !== 6 || config.mode !== 'find-note' || !['major-triad', 'minor-triad'].includes(config.structure.id)) throw new RangeError('Учебная серия трезвучия — шесть вопросов «Найди ноту».');
    targetClasses = config.structure.notes.flatMap(note => [note.pitchClass, note.pitchClass]);
    for (let index = targetClasses.length - 1; index > 0; index--) { const swap = next() % (index + 1); [targetClasses[index], targetClasses[swap]] = [targetClasses[swap], targetClasses[index]]; }
  }
  if (questionPolicy === 'shape-6-v1') {
    if (count !== 6 || config.mode !== 'find-note') throw new RangeError('Серия формы — шесть вопросов «Найди ноту».');
    const classes = [...new Set(eligiblePositionsV1(config).map(position => position.pitchClass))];
    if (!classes.length) throw new RangeError('В выбранном материале нет доступных нот.');
    for (let index = classes.length - 1; index > 0; index--) { const swap = next() % (index + 1); [classes[index], classes[swap]] = [classes[swap], classes[index]]; }
    targetClasses = Array.from({ length: 6 }, (_, index) => classes[index % classes.length]);
  }
  return Array.from({ length: count }, (_, index) => createQuestionV1({ ...config, seed: next() }, targetClasses?.[index]));
}

export function checkQuizElapsedV1(previousMs: number, elapsedMs: number): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < previousMs) {
    throw new RangeError('Время ответа должно быть неотрицательным и отсчитываться от начала текущего задания.');
  }
}

export function namedPitchClassV1(answer: QuizAnswer, choices?: Question['choices']): number | null {
  if (typeof answer === 'number') return Number.isInteger(answer) && answer >= 0 && answer <= 11 ? answer : null;
  const choice = choices?.find(candidate => candidate.id === answer)?.pitchClass;
  if (choice !== undefined) return choice;
  if (!choices && answer.startsWith('pc:')) {
    const pitchClass = Number(answer.slice(3));
    if (Number.isInteger(pitchClass) && pitchClass >= 0 && pitchClass <= 11 && answer === `pc:${pitchClass}`) return pitchClass;
  }
  try { return parseNote(answer).pitchClass; } catch { return null; }
}

type ReplayResult = Pick<QuizResult, 'selectedPositionIds' | 'answerEvents' | 'attempts' | 'errors' | 'firstAnswer' | 'firstResponseMs'
  | 'completionMs' | 'firstAttemptCorrect' | 'hintUsed' | 'skipped' | 'independentCorrect' | 'corrected'> & {
  readonly outcome: QuizResult['outcome'] | 'interrupted';
};

/** Validate each saved event in order. Historical answers do not need a live quiz session or feedback text. */
export function replayQuizResultV1(
  mode: QuizMode,
  targetPitchClass: number,
  expectedPositionIds: readonly string[],
  events: Iterable<AnswerEvent>,
  closure?: { readonly outcome: 'revealed' | 'skipped'; readonly atMs: number },
): ReplayResult {
  const expected = new Set(expectedPositionIds);
  const selected = new Set<string>();
  const answerEvents: AnswerEvent[] = [];
  let errors = 0;
  let lastElapsedMs = 0;
  let completionMs: number | null = null;

  for (const event of events) {
    checkQuizElapsedV1(lastElapsedMs, event.elapsedMs);
    const positionId = typeof event.answer === 'string' ? event.answer : null;
    const correct = mode === 'name-note'
      ? namedPitchClassV1(event.answer) === targetPitchClass
      : positionId !== null && expected.has(positionId);
    if (completionMs !== null || correct !== event.correct || (mode === 'find-all' && positionId !== null && selected.has(positionId))) {
      throw new RangeError('Попытки содержат дубликат, лишний ответ или неверный признак правильности.');
    }
    answerEvents.push(event);
    lastElapsedMs = event.elapsedMs;
    if (!correct) errors++;
    else {
      if (mode !== 'name-note' && positionId !== null) selected.add(positionId);
      if (mode !== 'find-all' || selected.size === expected.size) completionMs = lastElapsedMs;
    }
  }

  let outcome: ReplayResult['outcome'];
  if (closure) {
    if (completionMs !== null) throw new RangeError('Показ или пропуск не соответствует состоянию ответов.');
    checkQuizElapsedV1(lastElapsedMs, closure.atMs);
    completionMs = closure.atMs;
    outcome = closure.outcome;
  } else if (completionMs !== null) outcome = errors === 0 ? 'correct' : 'corrected';
  else {
    if (!answerEvents.length) throw new RangeError('Прерванный вопрос должен содержать реальные незавершённые попытки.');
    outcome = 'interrupted';
  }

  return {
    selectedPositionIds: [...selected], answerEvents, attempts: answerEvents.length, errors,
    firstAnswer: answerEvents[0]?.answer ?? null, firstResponseMs: answerEvents[0]?.elapsedMs ?? null,
    firstAttemptCorrect: answerEvents[0]?.correct ?? null, completionMs,
    hintUsed: outcome === 'revealed', skipped: outcome === 'skipped',
    independentCorrect: outcome === 'correct', corrected: outcome === 'corrected', outcome,
  };
}
