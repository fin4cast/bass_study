/**
 * Учебные цели «Основ» (D-049, D-050): цепочки шагов-материалов от тоники и освоение шага по истории.
 * Чистый модуль: шаги строятся лениво от тоники, записи сопоставляются по материалу (`materialId`),
 * поэтому ☆ и удаление своего упражнения не откатывают освоение. Шаг освоен, когда сыгран «Чисто»
 * целиком, в требуемом виде, так же («как играли»), не медленнее цели темпа — в два разных дня.
 */
import { createExerciseSpec, NOTE_CHOICES, TEMPLATE_TARGET_BPM, type ExerciseSpec, type ExerciseTemplateId } from '../exercises';
import { DEFAULT_PRACTICE, samePractice, type PracticeOptions } from '../exercises/rhythm';
import { parseNote } from '../music';
import { materialId } from './material';
import type { CheckKind, PlanStepContent } from './plan';
import type { PracticeRecord } from './results';

/** Правило освоения шага: целиком «По памяти» и «Чисто», любой проход целиком «Чисто», проверка 5 из 6. */
export type MasteryRule = 'memory' | 'clean' | 'check';
export type GoalId = 'notes' | 'pentatonic' | 'major-scale' | 'natural-minor' | 'four-fingers' | 'chords' | 'blues';

export interface GoalStep {
  readonly id: string;
  readonly content: PlanStepContent;
  readonly rule: MasteryRule;
  /** Цель темпа (четверти в минуту); у проверки — `null`. */
  readonly targetBpm: number | null;
}
export interface GoalInfo {
  readonly id: GoalId;
  readonly title: string;
  readonly summary: string;
  /** Тоника по умолчанию; `null` — цель без тоники (выбора тоники нет). */
  readonly defaultRoot: string | null;
  /** Слова поиска «Основ» сверх названия и описания. */
  readonly keywords: readonly string[];
}

export const GOAL_CHECK_COUNT = 6;
/** Освоение — в столько разных дней. */
export const MASTERY_DAYS = 2;
/** Освоенный шаг без подтверждения дольше стольких дней — «пора повторить». */
export const REVIEW_AFTER_DAYS = 14;
/** Проверка освоена при стольких верных ответах с первой попытки. */
export const GOAL_CHECK_PASS = 5;

export const GOALS: readonly GoalInfo[] = Object.freeze([
  { id: 'notes', title: 'Ноты на грифе', summary: 'Найти любую ноту на всех струнах, октавы и опору Root–5–8.', defaultRoot: null, keywords: ['ноты', 'названия', 'октава', 'октавы'] },
  { id: 'pentatonic', title: 'Пентатоника на всём грифе', summary: 'Пять форм, связки соседних форм и весь гриф одной тональности.', defaultRoot: 'A', keywords: ['пентатоника', 'формы', 'минорная', 'связки'] },
  { id: 'major-scale', title: 'Мажорная гамма', summary: 'Компактные формы, одна струна, позиции, терции и ступени.', defaultRoot: 'C', keywords: ['гамма', 'мажор', 'мажорная', 'ионийский', 'лад'] },
  { id: 'natural-minor', title: 'Натуральный минор', summary: 'Те же шаги для натурального минора.', defaultRoot: 'A', keywords: ['гамма', 'минор', 'минорная', 'натуральный', 'эолийский', 'лад'] },
  { id: 'four-fingers', title: 'Техника рук', summary: 'Хроматика, «паук» и перестановки пальцев, переход между струнами и рейкинг.', defaultRoot: null, keywords: ['паук', 'хроматика', 'пальцы', 'разминка', 'техника', 'четыре', 'правая', 'рука', 'рейкинг', 'щипок'] },
  { id: 'chords', title: 'Арпеджио и аккорды', summary: 'Трезвучия, септаккорды, обращения и игра по последовательности.', defaultRoot: 'C', keywords: ['аккорд', 'аккорды', 'арпеджио', 'трезвучие', 'септаккорд', 'обращение', 'последовательность'] },
  { id: 'blues', title: 'Блюз', summary: 'Блюзовая гамма и 12 тактов: тоники, арпеджио, буги, под шаффл.', defaultRoot: 'A', keywords: ['блюз', 'блюзовая', 'буги', 'гамма', '12', 'тактов'] },
] satisfies GoalInfo[]);

/** Цели первого запуска — карточки «Выбери цель». */
export const STARTER_GOALS: readonly GoalId[] = Object.freeze(['notes', 'pentatonic', 'four-fingers']);

export const isGoalId = (value: string): value is GoalId => GOALS.some(goal => goal.id === value);
export const goalInfo = (id: GoalId): GoalInfo => GOALS.find(goal => goal.id === id)!;

/** Нота тем же написанием, что в списке тоник, на `semitones` выше. */
export function transposeRoot(root: string, semitones: number): string {
  const pitch = parseNote(root).pitchClass;
  return NOTE_CHOICES.find(note => parseNote(note).pitchClass === (pitch + semitones + 12) % 12)!;
}

/** Шаг цели всегда со своим «как играть»: освоение засчитывает подходы только так (D-050). */
const exercise = (templateId: ExerciseTemplateId, params: Record<string, unknown> = {}, practice: PracticeOptions = DEFAULT_PRACTICE): PlanStepContent =>
  ({ kind: 'exercise', spec: createExerciseSpec(templateId, params as never), practice });
const checkOf = (content: PlanStepContent, kind: CheckKind): PlanStepContent => ({
  kind: 'check', spec: { version: 'check-v1', exercise: (content as { spec: ExerciseSpec }).spec, kind, count: GOAL_CHECK_COUNT, ear: false },
});
const step = (id: string, content: PlanStepContent, rule: MasteryRule): GoalStep =>
  ({ id, content, rule, targetBpm: content.kind === 'exercise' ? TEMPLATE_TARGET_BPM[content.spec.templateId] : null });
/** Как играть шаг: из шага плана или обычные восьмые без эха и подложки. */
export const stepPractice = (goalStep: GoalStep): PracticeOptions => goalStep.content.kind === 'exercise' ? goalStep.content.practice ?? DEFAULT_PRACTICE : DEFAULT_PRACTICE;
const SHAPES = ['a', 'b', 'c', 'd', 'e'] as const;

function scaleSteps(root: string, structureId: 'major' | 'natural-minor'): GoalStep[] {
  const compactE = exercise('scale-compact', { root, structureId, shapeId: 'compact-e' });
  return [
    step('compact-e', compactE, 'memory'),
    step('compact-a', exercise('scale-compact', { root, structureId, shapeId: 'compact-a' }), 'memory'),
    step('one-string', exercise('scale-one-string', { root, structureId, string: 'A' }), 'clean'),
    ...[1, 2, 5].map(degree => step(`position-${degree}`, exercise('scale-position', { root, structureId, degree }), 'memory')),
    step('thirds', exercise('thirds', { root, structureId, shapeId: 'compact-e' }), 'clean'),
    step('other-key', exercise('scale-compact', { root: transposeRoot(root, 5), structureId, shapeId: 'compact-e' }), 'memory'),
    step('check', checkOf(compactE, 'name-degree'), 'check'),
  ];
}

/** Шаги цели от тоники; у цели без тоники `root` не используется. */
export function goalSteps(id: GoalId, root: string | null = goalInfo(id).defaultRoot): readonly GoalStep[] {
  const tonic = root ?? goalInfo(id).defaultRoot ?? 'C';
  switch (id) {
    case 'notes': return [
      // Ноты ищутся без подписей: шаг засчитывается в виде «По памяти» (D-050).
      ...['E', 'A', 'C'].map(note => step(`note-${note}`, exercise('note-all-positions', { note }), 'memory')),
      ...['G', 'D'].map(note => step(`octaves-${note}`, exercise('octaves', { note }), 'memory')),
      step('root-five-eight', exercise('root-five-eight', { root: 'A', string: 'E' }), 'clean'),
    ];
    case 'pentatonic': {
      const structureId = 'minor-pentatonic';
      const formA = exercise('pentatonic-form', { root: tonic, structureId, shapeId: 'penta-a' });
      return [
        ...SHAPES.map(shape => step(`form-${shape}`, exercise('pentatonic-form', { root: tonic, structureId, shapeId: `penta-${shape}` }), 'memory')),
        ...SHAPES.map(shape => step(`connect-${shape}`, exercise('connect-forms', { root: tonic, structureId, shapeId: `penta-${shape}` }), 'clean')),
        step('neck', exercise('pentatonic-neck', { root: tonic, structureId }), 'memory'),
        step('other-key', exercise('pentatonic-form', { root: transposeRoot(tonic, 5), structureId, shapeId: 'penta-a' }), 'memory'),
        step('groups-of-three', exercise('groups-of-three', { root: tonic, structureId, shapeId: 'penta-a' }), 'clean'),
        // Слух: такт звучит эталоном, следующий повторяешь сам.
        step('echo-a', exercise('pentatonic-form', { root: tonic, structureId, shapeId: 'penta-a' }, { ...DEFAULT_PRACTICE, echo: true }), 'clean'),
        step('check', checkOf(formA, 'find-degree'), 'check'),
      ];
    }
    case 'major-scale': return scaleSteps(tonic, 'major');
    case 'natural-minor': return scaleSteps(tonic, 'natural-minor');
    case 'four-fingers': return [
      step('chromatic', exercise('chromatic-position', { startFret: 5 }), 'clean'),
      ...['1234', '1324', '1243', '1432'].map(pattern => step(`spider-${pattern}`, exercise('spider', { startFret: 5, positions: 5, pattern }), 'clean')),
      step('position-shift', exercise('position-shift'), 'clean'),
      step('spider-neck', exercise('spider', { startFret: 1, positions: 12, pattern: '1234' }), 'clean'),
      step('crossing-adjacent', exercise('string-crossing', { pattern: 'adjacent' }), 'clean'),
      step('crossing-raking', exercise('string-crossing', { pattern: 'raking' }), 'clean'),
    ];
    case 'chords': return [
      ...(['major-triad', 'minor-triad', 'diminished-triad'] as const).map(structureId => step(structureId, exercise('arpeggio-1358', { root: tonic, structureId, shapeId: 'compact-e' }), 'memory')),
      step('root-five-eight', exercise('root-five-eight', { root: tonic, string: 'E' }), 'clean'),
      ...(['major-seventh', 'dominant-seventh', 'minor-seventh', 'half-diminished-seventh'] as const).map(structureId => step(structureId, exercise('arpeggio-seventh', { root: tonic, structureId, shapeId: 'compact-e' }), 'memory')),
      ...([1, 2] as const).map(inversion => step(`inversion-${inversion}`, exercise('arpeggio-inversion', { root: tonic, structureId: 'major-triad', inversion }), 'memory')),
      ...(['roots', 'arpeggio', 'approach'] as const).map(pattern => step(`i-iv-v-${pattern}`, exercise('progression', { root: tonic, progression: 'I-IV-V', pattern }), 'clean')),
      step('ii-v-i-arpeggio', exercise('progression', { root: tonic, progression: 'ii-V-I', pattern: 'arpeggio' }), 'clean'),
    ];
    case 'blues': return [
      ...(['compact-e', 'compact-a'] as const).map(shapeId => step(`scale-${shapeId}`, exercise('blues-scale', { root: tonic, shapeId }), 'memory')),
      ...(['roots', 'arpeggio', 'boogie'] as const).map(pattern => step(`blues-12-${pattern}`, exercise('progression', { root: tonic, progression: 'blues-12', pattern }), 'clean')),
      // Применение: 12 тактов под барабанный шаффл.
      step('blues-12-shuffle', exercise('progression', { root: tonic, progression: 'blues-12', pattern: 'roots' }, { ...DEFAULT_PRACTICE, groove: 'shuffle' }), 'clean'),
    ];
  }
}

/* ---------- Освоение ---------- */

export type StepState = 'new' | 'progress' | 'done' | 'review';
export interface StepMastery {
  readonly state: StepState;
  /** «✓ по памяти · 96», «в работе · 84/96», «в работе · 1 из 2 дней», «пора повторить», «не начат». */
  readonly label: string;
}

/** Записи истории по материалу; строится один раз на расчёт цели. */
export function recordsByMaterial(records: readonly PracticeRecord[]): ReadonlyMap<string, readonly PracticeRecord[]> {
  const index = new Map<string, PracticeRecord[]>();
  for (const record of records) {
    if (record.kind !== 'play' && record.kind !== 'check') continue;
    let id: string;
    try { id = materialId(record.spec); } catch { continue; }
    index.set(id, [...(index.get(id) ?? []), record]);
  }
  return index;
}

const firstTry = (record: Extract<PracticeRecord, { kind: 'check' }>) => record.answers.filter(answer => answer.outcome === 'correct' && answer.errors === 0).length;
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
/** Освоенное, но давно не подтверждённое: последний засчитанный день старше `REVIEW_AFTER_DAYS`. */
const stale = (dates: readonly string[], today: string | null) => !!today && dayNumber(today) - Math.max(...dates.map(dayNumber)) > REVIEW_AFTER_DAYS;

/** Освоение шага по истории его материала; `today` (YYYY-MM-DD) включает «пора повторить». */
export function stepMastery(goalStep: GoalStep, index: ReadonlyMap<string, readonly PracticeRecord[]>, today: string | null = null): StepMastery {
  const spec = goalStep.content.kind === 'exercise' ? goalStep.content.spec : goalStep.content.spec.exercise;
  const records = index.get(materialId(spec)) ?? [];
  if (goalStep.rule === 'check') {
    const kind = goalStep.content.kind === 'check' ? goalStep.content.spec.kind : null;
    const checks = records.filter((record): record is Extract<PracticeRecord, { kind: 'check' }> => record.kind === 'check' && record.checkKind === kind);
    const passed = checks.filter(record => firstTry(record) >= GOAL_CHECK_PASS);
    const best = Math.max(-1, ...checks.map(firstTry));
    if (passed.length) {
      if (stale(passed.map(record => record.localDate), today)) return { state: 'review', label: `пора повторить · ✓ ${best} из ${GOAL_CHECK_COUNT}` };
      return { state: 'done', label: `✓ ${best} из ${GOAL_CHECK_COUNT}` };
    }
    return checks.length ? { state: 'progress', label: `в работе · ${best} из ${GOAL_CHECK_COUNT}` } : { state: 'new', label: 'не начат' };
  }
  const practice = stepPractice(goalStep);
  const target = goalStep.targetBpm ?? 0;
  const plays = records.filter((record): record is Extract<PracticeRecord, { kind: 'play' }> => record.kind === 'play' && samePractice(record.practice, practice));
  const clean = plays.filter(record => record.assessment === 'clean' && record.wholePass);
  const inView = goalStep.rule === 'memory' ? clean.filter(record => record.view === 'memory') : clean;
  const counted = inView.filter(record => record.bpm >= target);
  const days = [...new Set(counted.map(record => record.localDate))];
  const tempo = (list: readonly { bpm: number }[]) => Math.max(...list.map(record => record.bpm));
  const how = goalStep.rule === 'memory' ? 'по памяти' : 'чисто';
  if (days.length >= MASTERY_DAYS) {
    if (stale(days, today)) return { state: 'review', label: `пора повторить · ✓ ${how} · ${tempo(counted)}` };
    return { state: 'done', label: `✓ ${how} · ${tempo(counted)}` };
  }
  if (days.length === 1) return { state: 'progress', label: `в работе · 1 из ${MASTERY_DAYS} дней · ${tempo(counted)}` };
  if (inView.length) return { state: 'progress', label: `в работе · ${tempo(inView)}/${target}` };
  if (goalStep.rule === 'memory' && clean.length) return { state: 'progress', label: 'в работе · чисто, теперь по памяти' };
  if (!plays.length) return { state: 'new', label: 'не начат' };
  return { state: 'progress', label: 'в работе' };
}

/** Шаг засчитан (освоен или освоен и ждёт повторения). */
export const mastered = (mastery: StepMastery) => mastery.state === 'done' || mastery.state === 'review';

export interface GoalProgress {
  readonly goal: GoalInfo;
  readonly root: string | null;
  readonly steps: readonly { readonly step: GoalStep; readonly mastery: StepMastery }[];
  readonly done: number;
  readonly total: number;
  /** Первый неосвоенный шаг; у освоенной цели — `null`. */
  readonly next: GoalStep | null;
}

export function goalProgress(id: GoalId, root: string | null, records: readonly PracticeRecord[], index = recordsByMaterial(records), today: string | null = null): GoalProgress {
  const goal = goalInfo(id);
  const tonic = goal.defaultRoot === null ? null : root ?? goal.defaultRoot;
  const steps = goalSteps(id, tonic).map(item => ({ step: item, mastery: stepMastery(item, index, today) }));
  const done = steps.filter(item => mastered(item.mastery)).length;
  return { goal, root: tonic, steps, done, total: steps.length, next: steps.find(item => !mastered(item.mastery))?.step ?? null };
}

/** Следующие неосвоенные шаги цели по порядку. */
export function nextGoalSteps(progress: GoalProgress, count: number): readonly GoalStep[] {
  return progress.steps.filter(item => !mastered(item.mastery)).slice(0, count).map(item => item.step);
}

/** Освоенные шаги, которые пора повторить. */
export function reviewSteps(progress: GoalProgress): readonly GoalStep[] {
  return progress.steps.filter(item => item.mastery.state === 'review').map(item => item.step);
}
