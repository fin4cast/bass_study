/**
 * Модель раздела «Занятие» (VIS-10 r2): карточки вкладок «Сегодня», «Библиотека» и «Основы».
 * Чистый модуль без DOM, звука и хранилища: данные приходят из опций экрана, изменения плана
 * возвращаются новыми проверенными планами `plan-v1`.
 */
import { createExerciseSpec, EXERCISE_TEMPLATES, type ConceptId, type ExerciseCategory, type ExerciseSpec, type ExerciseTemplateId } from '../../exercises';
import { builtinLibrary, CATEGORY_ORDER, isPlayed, CATEGORY_TITLES, countByCategory, filterLibrary, userLibrary, type LibraryItem, type UserExercise } from '../../practice/library';
import {
  addStep, currentStep, doneMinutes, MAX_PLAN_STEPS, PLAN_TEMPLATES, plannedMinutes, removeStep, validatePlan,
  type CheckKind, type CheckSpec, type DayPlan, type PlanStep, type PlanStepContent,
} from '../../practice/plan';
import { ASSESSMENT_LABELS, exerciseProgress, playedKeys, type Assessment, type PracticeRecord } from '../../practice/results';
import { recommend } from '../../practice/recommend';
import { goalProgress, GOALS, isGoalId, nextGoalSteps, recordsByMaterial, type GoalId, type GoalProgress, type GoalStep, type MasteryRule } from '../../practice/goals';
import { conceptForExerciseConcept, REFERENCE_CONCEPTS, REFERENCE_LEVELS, type ReferenceConcept, type ReferenceLevel } from '../../practice/concepts';
import { annotatePositions, getPosition, type StructureId } from '../../music';
import type { BoardNote } from './mini-board';
import {
  CHECK_COUNT, CHECK_MINUTES, CONCEPT_LABELS, exercisePlan, exerciseStructure, formatDegree, materialLabel, TEMPLATE_MINUTES,
} from './material';

export type LessonTab = 'today' | 'library' | 'basics';
export interface LessonState {
  readonly plan: DayPlan;
  readonly records: readonly PracticeRecord[];
  readonly userExercises: readonly UserExercise[];
  readonly firstRun: boolean;
  readonly playFrom: string | null;
  readonly tab: LessonTab;
  /** Текущая учебная цель; неизвестная цель хранилища сюда не попадает. */
  readonly goal: { readonly id: GoalId; readonly root: string | null } | null;
  readonly basicsView: BasicsView;
}
export type BasicsView = 'goals' | 'levels';

/* ---------- Ключи и подписи шагов ---------- */

import { exerciseKey, materialId, sameSpec } from '../../practice/material';
export { exerciseKey, materialId };

export const CHECK_KIND_TITLES: Readonly<Record<CheckKind, string>> = Object.freeze({ 'find-degree': 'найди ступень', 'name-degree': 'назови ступень' });

export function exerciseTitle(spec: ExerciseSpec, userExercises: readonly UserExercise[] = []): string {
  return userExercises.find(exercise => sameSpec(exercise.spec, spec))?.name ?? exercisePlan(spec).title;
}

export function stepTitle(content: PlanStepContent, userExercises: readonly UserExercise[] = []): string {
  if (content.kind === 'exercise') return exerciseTitle(content.spec, userExercises);
  return `Проверь себя: ${content.spec.ear ? 'услышь и назови ступень' : CHECK_KIND_TITLES[content.spec.kind]}`;
}

export function stepMaterial(content: PlanStepContent): string {
  if (content.kind === 'exercise') return materialLabel(content.spec);
  return `${materialLabel(content.spec.exercise)} · ${content.spec.count} вопросов`;
}

/** Проверка ступеней по материалу упражнения; без ступеней в материале — `null`. */
export function checkContent(spec: ExerciseSpec, kind: CheckKind = 'name-degree', ear = false): PlanStepContent | null {
  if (!exerciseStructure(spec)) return null;
  const check: CheckSpec = { version: 'check-v1', exercise: spec, kind, count: CHECK_COUNT, ear };
  return { kind: 'check', spec: check };
}

/* ---------- Операции плана ---------- */

/** Новый идентификатор шага: `step-N`, не совпадающий с уже существующими. */
export function nextStepId(plan: DayPlan): string {
  const used = new Set(plan.steps.map(step => step.id));
  let index = plan.steps.length + 1;
  while (used.has(`step-${index}`)) index++;
  return `step-${index}`;
}

export const contentMinutes = (content: PlanStepContent) => content.kind === 'check' ? CHECK_MINUTES : TEMPLATE_MINUTES[content.spec.templateId];

/** Незавершённые шаги с тем же ключом (упражнение) или той же проверкой. */
export function pendingMatches(plan: DayPlan, content: PlanStepContent, userExercises: readonly UserExercise[] = []): readonly PlanStep[] {
  return plan.steps.filter(step => step.status !== 'done' && sameKey(step.content, content, userExercises));
}
function sameKey(a: PlanStepContent, b: PlanStepContent, userExercises: readonly UserExercise[]) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'exercise' && b.kind === 'exercise') return exerciseKey(a.spec, userExercises) === exerciseKey(b.spec, userExercises);
  if (a.kind === 'check' && b.kind === 'check') return a.spec.kind === b.spec.kind && sameSpec(a.spec.exercise, b.spec.exercise);
  return false;
}

/**
 * «+ в план» и повторное нажатие: добавляет шаг или снимает все незавершённые шаги того же упражнения
 * (VIS-10 r2, «Границы»). Возвращает новый план и что произошло.
 */
export function togglePlanContent(plan: DayPlan, content: PlanStepContent, userExercises: readonly UserExercise[] = []): { plan: DayPlan; action: 'added' | 'removed' } {
  const matches = pendingMatches(plan, content, userExercises);
  if (matches.length) return { plan: matches.reduce((current, step) => removeStep(current, step.id), plan), action: 'removed' };
  if (plan.steps.length >= MAX_PLAN_STEPS) throw new RangeError(`В плане не больше ${MAX_PLAN_STEPS} шагов.`);
  return { plan: addStep(plan, { id: nextStepId(plan), content, minutes: contentMinutes(content) }), action: 'added' };
}

/** Встроенный шаблон плана (R-026): добавляет его шаги, которых ещё нет в плане, с плановым временем шаблона. */
export function appendTemplate(plan: DayPlan, template: keyof typeof PLAN_TEMPLATES, userExercises: readonly UserExercise[] = []): DayPlan {
  if (!Object.hasOwn(PLAN_TEMPLATES, template)) throw new RangeError('Неизвестный шаблон плана.');
  let next = plan;
  for (const step of PLAN_TEMPLATES[template].steps) {
    if (pendingMatches(next, step.content, userExercises).length) continue;
    if (next.steps.length >= MAX_PLAN_STEPS) break;
    next = addStep(next, { id: nextStepId(next), content: step.content, minutes: step.minutes });
  }
  return next;
}

const rebuild = (plan: DayPlan, steps: readonly PlanStep[]) => validatePlan(JSON.parse(JSON.stringify({ ...plan, steps })));

export function setStepMinutes(plan: DayPlan, id: string, minutes: number): DayPlan {
  if (!plan.steps.some(step => step.id === id)) throw new RangeError('Шаг не найден в плане.');
  const value = Math.min(60, Math.max(1, Math.round(minutes)));
  return rebuild(plan, plan.steps.map(step => step.id === id ? { ...step, minutes: value } : step));
}

/** Опция «+ слух» шага проверки. */
export function toggleStepEar(plan: DayPlan, id: string): DayPlan {
  const step = plan.steps.find(candidate => candidate.id === id);
  if (!step || step.content.kind !== 'check') throw new RangeError('Слух — опция шага «Проверь себя».');
  const spec: CheckSpec = { ...step.content.spec, ear: !step.content.spec.ear };
  const changed: PlanStep = { ...step, content: { kind: 'check', spec } };
  return rebuild(plan, plan.steps.map(candidate => candidate === step ? changed : candidate));
}

/** Слух доступен там, где R-016 умеет задать вопрос: пентатоники и трезвучия. */
export function earSupported(spec: ExerciseSpec): boolean {
  const structure = exerciseStructure(spec);
  return !!structure && (['minor-pentatonic', 'major-pentatonic', 'major-triad', 'minor-triad'] as StructureId[]).includes(structure.id);
}

/* ---------- «Сегодня» ---------- */

export interface StepRow {
  readonly id: string;
  readonly index: number;
  readonly status: PlanStep['status'];
  readonly title: string;
  readonly meta: string;
  readonly minutes: number;
  readonly check: boolean;
  readonly ear: boolean | null;
  readonly earAvailable: boolean;
  /** Отметка выполненного шага: самооценка игры за дату плана или «выполнено». */
  readonly mark: string | null;
  readonly first: boolean;
  readonly last: boolean;
}

export function planRows(plan: DayPlan, records: readonly PracticeRecord[], userExercises: readonly UserExercise[] = []): readonly StepRow[] {
  const best = new Map(exerciseProgress(records).map(item => [item.exerciseKey, item]));
  const movable = plan.steps.filter(step => step.status !== 'done');
  return plan.steps.map((step, index) => {
    const key = step.content.kind === 'exercise' ? exerciseKey(step.content.spec, userExercises) : null;
    const progress = key ? best.get(key) : undefined;
    const tempo = progress ? ` · ${progress.bestCleanBpm ?? progress.last.bpm} BPM` : '';
    const sameDay = key ? [...records].filter(record => record.kind === 'play' && record.exerciseKey === key && record.localDate === plan.localDate)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1) : undefined;
    const mark = step.status !== 'done' ? null : sameDay?.kind === 'play' ? ASSESSMENT_LABELS[sameDay.assessment] : 'выполнено';
    return {
      id: step.id, index, status: step.status, title: stepTitle(step.content, userExercises), meta: `${stepMaterial(step.content)}${tempo}`,
      minutes: step.minutes, check: step.content.kind === 'check', ear: step.content.kind === 'check' ? step.content.spec.ear : null,
      earAvailable: step.content.kind === 'check' && earSupported(step.content.spec.exercise), mark,
      first: movable[0]?.id === step.id, last: movable.at(-1)?.id === step.id,
    };
  });
}

export interface HeroModel {
  readonly mode: 'continue' | 'first-run' | 'empty' | 'goal';
  /** Строка цели над главным блоком: «Цель: Пентатоника на всём грифе · Am · освоено 3/14». */
  readonly goalLine: string | null;
  readonly eyebrow: string;
  readonly title: string;
  readonly meta: string;
  readonly content: PlanStepContent | null;
  readonly stepId: string | null;
  readonly concepts: readonly string[];
  readonly stats: readonly { readonly value: string; readonly label: string }[];
}

/** Подпись тоники цели: минорные цели — «Am», остальные — нота. */
export function goalRootLabel(progress: GoalProgress): string {
  if (progress.root === null) return '';
  return ['pentatonic', 'natural-minor', 'blues'].includes(progress.goal.id) ? `${progress.root}m` : progress.root;
}
export function goalLine(progress: GoalProgress): string {
  const root = goalRootLabel(progress);
  return `Цель: ${progress.goal.title}${root ? ` · ${root}` : ''} · освоено ${progress.done}/${progress.total}`;
}

export function heroModel(state: Pick<LessonState, 'plan' | 'records' | 'userExercises' | 'firstRun'>, goal: GoalProgress | null = null): HeroModel {
  const step = currentStep(state.plan);
  const line = goal ? goalLine(goal) : null;
  if (state.firstRun && !goal) {
    return { mode: 'first-run', goalLine: null, eyebrow: 'Первый запуск', title: 'Начни с «Основ»', meta: 'Короткие шаги: понятие → упражнение → проверка. Или сразу сыграй готовый план — около 10 минут.',
      content: step?.content ?? null, stepId: step?.id ?? null, concepts: [], stats: [] };
  }
  if (!step && goal?.next) {
    const next = goal.next;
    return { mode: 'goal', goalLine: line, eyebrow: 'Следующий шаг цели', title: stepTitle(next.content, state.userExercises),
      meta: `${stepMaterial(next.content)} · ${RULE_HINTS[next.rule]}`, content: next.content, stepId: null, concepts: [], stats: [] };
  }
  let content: PlanStepContent | null = step?.content ?? null;
  let eyebrow = step ? `Продолжить · шаг ${state.plan.steps.indexOf(step) + 1} из ${state.plan.steps.length} плана` : '';
  if (!content) {
    const last = [...state.records].filter(record => record.kind === 'play').sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1);
    if (last?.kind === 'play') { content = { kind: 'exercise', spec: last.spec }; eyebrow = 'Продолжить · с прошлого занятия'; }
  }
  if (!content) return { mode: 'empty', goalLine: line, eyebrow: 'План пуст', title: 'Собери план на сегодня', meta: 'Добавь упражнения из библиотеки или возьми готовый шаблон плана.', content: null, stepId: null, concepts: [], stats: [] };
  const exercise = content.kind === 'exercise' ? content.spec : content.spec.exercise;
  const key = exerciseKey(exercise, state.userExercises);
  const progress = content.kind === 'exercise' ? exerciseProgress(state.records).find(item => item.exerciseKey === key) : undefined;
  const stats: { value: string; label: string }[] = [];
  if (progress?.bestCleanBpm) stats.push({ value: String(progress.bestCleanBpm), label: 'лучший удобный темп' });
  if (progress) stats.push({ value: String(progress.last.bpm), label: 'темп в прошлый раз' }, { value: ASSESSMENT_LABELS[progress.last.assessment], label: 'твоя отметка' });
  return {
    mode: 'continue', goalLine: line, eyebrow, title: stepTitle(content, state.userExercises), meta: stepMaterial(content),
    content, stepId: step && step.content === content ? step.id : null,
    concepts: exercisePlan(exercise).concepts.slice(0, 3).map(concept => CONCEPT_LABELS[concept]), stats,
  };
}

/**
 * Ноты мини-грифа упражнения: тоники структуры, сегменты A/B и общие позиции двух сегментов.
 * Если оба сегмента играют одни и те же позиции («одни ноты — разные тоники»), сегменты не красятся,
 * а вторая тоника (параллельного мажора) отмечается отдельным цветом.
 */
export function exerciseBoard(spec: ExerciseSpec, labels: 'name' | 'degree' | 'finger' | 'none' = 'name') {
  const plan = exercisePlan(spec);
  const structure = exerciseStructure(spec);
  const segments = new Map<string, Set<number>>();
  for (const note of plan.notes) segments.set(note.id, (segments.get(note.id) ?? new Set()).add(note.segment));
  const seen = new Map<string, typeof plan.notes[number]>();
  for (const note of plan.notes) if (!seen.has(note.id)) seen.set(note.id, note);
  // Один сегмент — подмножество другого: это те же позиции (сравнение тоник), а не связка двух форм.
  const ids = (segment: number) => new Set(plan.notes.filter(note => note.segment === segment).map(note => note.id));
  const [first, second] = [ids(0), ids(1)];
  const subset = (a: Set<string>, b: Set<string>) => [...a].every(id => b.has(id));
  const sameNotes = plan.segments.length === 2 && (subset(first, second) || subset(second, first));
  const two = plan.segments.length === 2 && !sameNotes;
  const roots = new Set(structure ? annotatePositions([...seen.values()].map(note => getPosition(note.string, note.fret)), structure).filter(position => position.isRoot).map(position => position.id) : []);
  const notes: BoardNote[] = [...seen.values()].map(note => {
    const inSegments = segments.get(note.id)!;
    const root = roots.has(note.id);
    const otherTonic = sameNotes && !root && note.degree === '1';
    const kind = two && inSegments.size === 2 ? 'shared' : root ? 'root' : otherTonic ? 'b' : two && inSegments.has(1) ? 'b' : two ? 'a' : 'plain';
    const label = labels === 'degree' ? formatDegree(note.degree) : labels === 'finger' ? (note.finger ? String(note.finger) : '') : labels === 'none' ? '' : note.name.replace(/-?\d+$/, '');
    return { id: note.id, label, kind, root, finger: null };
  });
  const legend: { kind: BoardNote['kind']; label: string }[] = [];
  const clean = (label: string) => label.replace(/ · (вверх|вниз)$/, '');
  if (two) {
    legend.push({ kind: 'a', label: clean(plan.segments[0].label) }, { kind: 'b', label: clean(plan.segments[1].label) });
    if (notes.some(note => note.kind === 'shared')) legend.push({ kind: 'shared', label: 'общие ноты' });
  } else if (sameNotes) {
    const other = [...seen.values()].find(note => note.degree === '1' && !roots.has(note.id));
    if (other) legend.push({ kind: 'b', label: `тоника ${other.name.replace(/-?\d+$/, '')} · ${clean(plan.segments[0].label)}` });
  } else legend.push({ kind: 'plain', label: plan.segments.map(segment => segment.label).join(' → ') });
  if (structure && notes.some(note => note.root)) legend.push({ kind: 'root', label: `тоника ${structure.root}${sameNotes ? ` · ${clean(plan.segments[1].label)}` : ''}` });
  return { notes, legend, frets: plan.notes.map(note => note.fret) };
}

export interface RecommendationCard {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly reason: string;
  readonly concept: boolean;
  readonly content: PlanStepContent | null;
  /** Карточка понятия справочника R-027. */
  readonly conceptId: string | null;
  readonly openBasics: boolean;
}

export function isPentatonic(spec: ExerciseSpec): boolean {
  const id = exerciseStructure(spec)?.id;
  return spec.templateId === 'form-transpose' || id === 'minor-pentatonic' || id === 'major-pentatonic';
}

const EYEBROW = { next: 'Следующий шаг', repeat: 'Повтори', concept: 'Понятие' } as const;
const PENTATONIC_REC: RecommendationCard = Object.freeze({
  id: 'pentatonic-relative', eyebrow: 'Пентатоника', title: 'Одни ноты — разные тоники',
  reason: 'Мажорная C и минорная Am — те же пять нот: C D E G A. Меняется тоника.', concept: true,
  content: Object.freeze({ kind: 'exercise', spec: createExerciseSpec('pentatonic-relative') }) as PlanStepContent, conceptId: 'relative-keys', openBasics: false,
});

/** Три рекомендации «Сегодня» с причиной; одна из них — про пентатонику (VIS-10 r2). */
export function recommendationCards(records: readonly PracticeRecord[], firstRun: boolean, goalStep: { readonly progress: GoalProgress; readonly step: GoalStep } | null = null): readonly RecommendationCard[] {
  if (goalStep) {
    const { progress, step } = goalStep;
    const card: RecommendationCard = { id: 'goal', eyebrow: 'Шаг цели', title: stepTitle(step.content), reason: `${progress.goal.title} · ${stepMaterial(step.content)}. ${RULE_HINTS[step.rule]}`,
      concept: false, content: step.content, conceptId: null, openBasics: false };
    const rest = recommendationCards(records, firstRun).filter(item => !(item.content && JSON.stringify(item.content) === JSON.stringify(step.content)));
    return [card, ...rest].slice(0, 3);
  }
  if (firstRun || !records.length) {
    return [
      { id: 'semitone', eyebrow: 'Понятие', title: 'Тон и полутон', reason: 'Соседний лад — полутон, через лад — тон. С этого читаются все формулы.', concept: true, content: null, conceptId: 'semitone', openBasics: false },
      { id: 'basics', eyebrow: 'Основы', title: 'Уровень 0 · Ориентация', reason: 'Понятие → упражнение → проверка. Ничего не заблокировано.', concept: false, content: null, conceptId: null, openBasics: true },
      { id: 'pentatonic-form', eyebrow: 'Пентатоника', title: 'Первая форма — пентатоника', reason: 'Пять нот под рукой. С неё начинаются формы и связки.', concept: true,
        content: { kind: 'exercise', spec: createExerciseSpec('pentatonic-form') }, conceptId: 'pentatonic', openBasics: false },
    ];
  }
  const cards: RecommendationCard[] = recommend(records).map((item, index) => ({
    id: `${item.kind}-${index}`, eyebrow: EYEBROW[item.kind], title: item.title, reason: item.reason, concept: item.kind === 'concept',
    content: item.spec ? { kind: 'exercise', spec: item.spec } : null,
    conceptId: item.concept ? conceptForExerciseConcept(item.concept)?.id ?? null : null, openBasics: false,
  }));
  const pentatonic = cards.some(card => card.content?.kind === 'exercise' && isPentatonic(card.content.spec));
  if (!pentatonic) { if (cards.length >= 3) cards.pop(); cards.push(PENTATONIC_REC); }
  // Мало истории для правил recommend(): добираем до трёх общими входами, а не пустыми карточками.
  const fillers: RecommendationCard[] = [
    { id: 'basics', eyebrow: 'Основы', title: 'Следующее понятие курса', reason: 'Понятие → упражнение → проверка. Ничего не заблокировано.', concept: false, content: null, conceptId: null, openBasics: true },
    { id: 'connect-forms', eyebrow: 'Связки форм', title: 'Связка соседних форм', reason: 'Четыре общие ноты соседних форм — переход без прыжка рукой.', concept: false,
      content: { kind: 'exercise', spec: createExerciseSpec('connect-forms') }, conceptId: null, openBasics: false },
  ];
  for (const filler of fillers) if (cards.length < 3 && !cards.some(card => card.id === filler.id || (card.content && filler.content && JSON.stringify(card.content) === JSON.stringify(filler.content)))) cards.push(filler);
  return cards.slice(0, 3);
}

/* ---------- «Библиотека» ---------- */

export type LibraryCategory = ExerciseCategory | 'user' | 'all';
export type LibrarySort = 'recommended' | 'played' | 'catalogue';
export interface LibraryControls {
  readonly category: LibraryCategory;
  readonly structureId: StructureId | null;
  readonly concept: ConceptId | null;
  readonly status: 'all' | 'new' | 'played';
  readonly sort: LibrarySort;
}
export const DEFAULT_LIBRARY: LibraryControls = Object.freeze({ category: 'all', structureId: null, concept: null, status: 'all', sort: 'recommended' });
export const LIBRARY_CONCEPTS: readonly ConceptId[] = Object.freeze(['degrees', 'pentatonic', 'shared-notes', 'relative-keys', 'triad', 'octave', 'finger-per-fret']);
export const LIBRARY_STRUCTURES: readonly StructureId[] = Object.freeze(['minor-pentatonic', 'major-pentatonic', 'major', 'natural-minor', 'blues', 'major-triad', 'minor-triad', 'diminished-triad', 'major-seventh', 'dominant-seventh', 'minor-seventh', 'half-diminished-seventh']);
const FEATURED: ReadonlySet<ExerciseTemplateId> = new Set(['pentatonic-relative']);

export interface LibraryCard {
  /** Неизменный id карточки (`tpl:<шаблон>` / `user:<id>`); `key` — материал и меняется вместе с параметрами. */
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly category: string;
  readonly material: string;
  readonly concepts: readonly string[];
  readonly minutes: number;
  readonly bestBpm: number | null;
  readonly played: boolean;
  readonly playedToday: boolean;
  readonly inPlan: boolean;
  readonly featured: boolean;
  readonly builtin: boolean;
  /** Материал настроен на карточке. */
  readonly configured: boolean;
  readonly content: PlanStepContent;
}

export function libraryItems(playFrom: string | null, userExercises: readonly UserExercise[]): readonly LibraryItem[] {
  return [...builtinLibrary(playFrom), ...userLibrary(userExercises)];
}

/** Элементы библиотеки с настроенным на карточках материалом (свои упражнения не настраиваются). */
export function configuredItems(playFrom: string | null, userExercises: readonly UserExercise[], cardSpecs: ReadonlyMap<string, ExerciseSpec>): readonly LibraryItem[] {
  return libraryItems(playFrom, userExercises).map(item => {
    const spec = item.builtin ? cardSpecs.get(item.id) : undefined;
    return spec && spec.templateId === item.spec.templateId ? { ...item, spec, key: exerciseKey(spec, userExercises) } : item;
  });
}

/**
 * Модель библиотеки. `cardSpecs` — материал, настроенный на встроенной карточке (по id карточки): он важнее «Играть от»
 * и определяет ключ, «в плане», лучший темп и то, что сохраняет ☆.
 */
export function libraryModel(state: Pick<LessonState, 'plan' | 'records' | 'userExercises' | 'playFrom'>, controls: LibraryControls,
  cardSpecs: ReadonlyMap<string, ExerciseSpec> = new Map()) {
  const items = configuredItems(state.playFrom, state.userExercises, cardSpecs);
  const played = playedKeys(state.records);
  const progress = new Map(exerciseProgress(state.records).map(item => [item.exerciseKey, item]));
  const scoped = controls.category === 'user' ? items.filter(item => !item.builtin)
    : controls.category === 'all' ? items : items.filter(item => item.builtin && item.category === controls.category);
  const filtered = filterLibrary(scoped, { structureId: controls.structureId, concept: controls.concept, status: controls.status }, played);
  const indexed = filtered.map((item, index) => ({ item, index }));
  const rank = (item: LibraryItem) => controls.sort === 'recommended' ? (FEATURED.has(item.spec.templateId) && item.builtin ? 0 : isPlayed(item, played) ? 1 : 2)
    : controls.sort === 'played' ? (isPlayed(item, played) ? 0 : 1) : 0;
  indexed.sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index);
  const cards: LibraryCard[] = indexed.map(({ item }) => {
    const content: PlanStepContent = { kind: 'exercise', spec: item.spec };
    const entry = progress.get(item.key);
    return {
      id: item.id, key: item.key, title: item.title, category: CATEGORY_TITLES[item.category], material: materialLabel(item.spec),
      concepts: item.concepts.map(concept => CONCEPT_LABELS[concept]), minutes: TEMPLATE_MINUTES[item.spec.templateId],
      bestBpm: entry?.bestCleanBpm ?? null, played: isPlayed(item, played),
      playedToday: state.plan.steps.some(step => step.status === 'done' && step.content.kind === 'exercise' && exerciseKey(step.content.spec, state.userExercises) === item.key),
      inPlan: inPlanFor(state.plan, item, state.userExercises), featured: item.builtin && FEATURED.has(item.spec.templateId), builtin: item.builtin, content,
      configured: cardSpecs.has(item.id),
    };
  });
  const counts = countByCategory(items.filter(item => item.builtin));
  return {
    cards, total: items.length,
    categories: [
      { id: 'all' as LibraryCategory, title: 'Все упражнения', count: items.length },
      ...CATEGORY_ORDER.map((id, index) => ({ id: id as LibraryCategory, title: `${index + 1}. ${CATEGORY_TITLES[id]}`, count: counts[id] })),
      ...(state.userExercises.length ? [{ id: 'user' as LibraryCategory, title: 'Свои упражнения', count: state.userExercises.length }] : []),
    ],
  };
}

/** Встроенная карточка «в плане», если в плане есть незавершённый шаг этого шаблона (не своего упражнения). */
function inPlanFor(plan: DayPlan, item: LibraryItem, userExercises: readonly UserExercise[]) {
  return plan.steps.some(step => step.status !== 'done' && step.content.kind === 'exercise' && exerciseKey(step.content.spec, userExercises) === item.key);
}

/** Плашка плана внизу библиотеки: шаги через «→», текущий выделен. */
export function planStrip(plan: DayPlan, userExercises: readonly UserExercise[] = []) {
  const current = currentStep(plan);
  return {
    count: plan.steps.length, minutes: plannedMinutes(plan), done: doneMinutes(plan),
    items: plan.steps.map(step => ({ id: step.id, title: stepTitle(step.content, userExercises), current: step === current, done: step.status === 'done' })),
    current: current ? { id: current.id, content: current.content } : null,
  };
}

/* ---------- «Основы» ---------- */

export type BasicsStepKind = 'concept' | 'exercise' | 'check';
export interface BasicsStep {
  readonly key: string;
  readonly kind: BasicsStepKind;
  readonly conceptId: string;
  readonly title: string;
  readonly content: PlanStepContent | null;
  /** Шаг, для которого приложение хранит результат (упражнение или проверка ступеней). */
  readonly tracked: boolean;
  readonly done: boolean;
}
export interface BasicsLevel {
  readonly id: ReferenceLevel;
  readonly key: string;
  readonly mark: string;
  readonly title: string;
  readonly lane: 'main' | 'side';
  readonly steps: readonly BasicsStep[];
  readonly status: 'done' | 'current' | 'open';
  readonly doneCount: number;
  /** Шаги, которые могут стать выполненными: понятия, упражнения и проверки ступеней (без вопросов карточек). */
  readonly total: number;
}

/** Порядок понятий уровня 2: пентатоника и связки форм — до гамм по позициям (VIS-10 r2). */
const LEVEL_ORDER: Partial<Record<string, readonly string[]>> = {
  2: ['degree', 'pentatonic', 'shared-notes', 'relative-keys', 'major-formula', 'natural-minor', 'blues-scale'],
};
/**
 * Упражнение шага там, где первое связанное упражнение каталога с параметрами по умолчанию не подходит понятию
 * или повторяет материал другого понятия: во всём курсе у каждого понятия свой материал (D-049).
 */
const STEP_EXERCISE: Partial<Record<string, () => ExerciseSpec>> = {
  accidentals: () => createExerciseSpec('note-all-positions', { note: 'F♯' }),
  enharmonic: () => createExerciseSpec('note-all-positions', { note: 'B♭' }),
  unison: () => createExerciseSpec('note-all-positions', { note: 'C' }),
  'octave-numbers': () => createExerciseSpec('octaves', { note: 'E' }),
  degree: () => createExerciseSpec('form-transpose'),
  'natural-minor': () => createExerciseSpec('scale-compact', { root: 'A', structureId: 'natural-minor' }),
  'shared-notes': () => createExerciseSpec('connect-forms'),
  'beat-bar': () => createExerciseSpec('chromatic-position', { startFret: 3 }),
  counting: () => createExerciseSpec('connect-forms', { shapeId: 'penta-b' }),
  tab: () => createExerciseSpec('scale-one-string', { root: 'G', structureId: 'major', string: 'E' }),
  'bass-clef': () => createExerciseSpec('note-all-positions', { note: 'G' }),
};
const FORM_TEMPLATES: ReadonlySet<ExerciseTemplateId> = new Set(['pentatonic-form', 'connect-forms', 'pentatonic-neck', 'groups-of-three', 'pentatonic-relative']);

function conceptExercise(concept: ReferenceConcept): ExerciseSpec | null {
  const override = STEP_EXERCISE[concept.id];
  if (override) { try { return override(); } catch { /* Материал по умолчанию ниже. */ } }
  const card = concept.full ?? concept.brief;
  const template = card?.related[0];
  return template ? createExerciseSpec(template) : null;
}

export function conceptsOfLevel(level: ReferenceLevel): readonly ReferenceConcept[] {
  const list = REFERENCE_CONCEPTS.filter(concept => !concept.later && (concept.level === level || concept.alsoLevels?.includes(level)));
  const order = LEVEL_ORDER[String(level)];
  if (!order) return list;
  return [...list].sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
}

export function basicsCourse(records: readonly PracticeRecord[], userExercises: readonly UserExercise[] = []): readonly BasicsLevel[] {
  const played = playedKeys(records);
  const checked = new Set(records.filter(record => record.kind === 'check').map(record => record.exerciseKey));
  let currentFound = false;
  return REFERENCE_LEVELS.map(level => {
    const steps: BasicsStep[] = conceptsOfLevel(level.id).flatMap(concept => {
      const spec = conceptExercise(concept);
      const key = spec ? exerciseKey(spec, userExercises) : null;
      const exerciseDone = !!key && played.has(key);
      const check = spec ? checkContent(spec, FORM_TEMPLATES.has(spec.templateId) ? 'find-degree' : 'name-degree') : null;
      const checkDone = !!check && !!key && checked.has(key);
      const base = `${String(level.id)}:${concept.id}`;
      const result: BasicsStep[] = [{ key: `${base}:concept`, kind: 'concept', conceptId: concept.id, title: concept.title, content: null, tracked: false, done: exerciseDone || checkDone }];
      if (spec) result.push({ key: `${base}:exercise`, kind: 'exercise', conceptId: concept.id, title: exerciseTitle(spec, userExercises), content: { kind: 'exercise', spec }, tracked: true, done: exerciseDone });
      result.push(check
        ? { key: `${base}:check`, kind: 'check', conceptId: concept.id, title: `Ступени: ${concept.title.toLowerCase()}`, content: check, tracked: true, done: checkDone }
        : { key: `${base}:check`, kind: 'check', conceptId: concept.id, title: `Вопрос карточки: ${concept.title.toLowerCase()}`, content: null, tracked: false, done: false });
      return result;
    });
    const tracked = steps.filter(step => step.tracked);
    const doneCount = steps.filter(step => step.done).length;
    const total = steps.filter(step => step.tracked || step.kind === 'concept').length;
    const lane: 'main' | 'side' = typeof level.id === 'number' ? 'main' : 'side';
    const complete = tracked.length > 0 && tracked.every(step => step.done);
    let status: BasicsLevel['status'] = complete ? 'done' : 'open';
    if (!complete && lane === 'main' && !currentFound) { status = 'current'; currentFound = true; }
    return { id: level.id, key: String(level.id), mark: level.mark, title: level.title.replace(/ · параллельно$/, ''), lane, steps, status, doneCount, total };
  });
}

/**
 * Текущий шаг уровня — первый невыполненный понятие, упражнение или проверка ступеней.
 * Вопрос карточки не хранит результат, поэтому текущим не становится; у пройденного уровня — первый шаг.
 */
export function currentBasicsStep(level: BasicsLevel): BasicsStep {
  return level.steps.find(step => !step.done && (step.tracked || step.kind === 'concept')) ?? level.steps[0];
}

/** Ближайшее упражнение после выбранного шага (для «Дальше: сыграть упражнение»). */
export function nextExerciseStep(level: BasicsLevel, from: BasicsStep): BasicsStep | null {
  const index = level.steps.indexOf(from);
  return level.steps.slice(index).find(step => step.kind === 'exercise') ?? null;
}

/** Плашка вкладки «Основы»: номер уровня, на котором ты сейчас. */
export function basicsBadge(levels: readonly BasicsLevel[], goal: GoalProgress | null = null) {
  if (goal) return `${goal.done}/${goal.total}`;
  const current = levels.find(level => level.status === 'current');
  return current ? `ур. ${current.mark}` : 'пройдено';
}

/* ---------- Поиск «Основ» ---------- */

const normalizeSearch = (value: string) => value.toLowerCase().replace(/ё/g, 'е');
/**
 * Слово запроса подходит, если входит в текст или совпадает с началом слова текста по основе: при длине ≥ 4 —
 * без двух последних букв, но не короче четырёх («минорную» → «минорная», «гамму» → «гамма»).
 */
export function searchMatches(query: string, text: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const haystack = normalizeSearch(text);
  const tokens = haystack.split(/[^a-zа-я0-9♭♯#-]+/).filter(Boolean);
  return words.length > 0 && words.every(word => {
    if (haystack.includes(word)) return true;
    if (word.length < 4) return false;
    const stem = word.slice(0, Math.max(4, word.length - 2));
    return tokens.some(token => token.startsWith(stem));
  });
}

export type SearchHit =
  | { readonly kind: 'goal'; readonly title: string; readonly hint: string; readonly goalId: GoalId }
  | { readonly kind: 'concept'; readonly title: string; readonly hint: string; readonly levelKey: string; readonly stepKey: string }
  | { readonly kind: 'exercise'; readonly title: string; readonly hint: string; readonly content: PlanStepContent };

/** Поиск «Основ»: цели, понятия справочника, упражнения библиотеки (по названию и словам их понятий). */
export function searchBasics(query: string, levels: readonly BasicsLevel[], items: readonly LibraryItem[]): readonly SearchHit[] {
  if (!normalizeSearch(query).trim()) return [];
  const goalHits: SearchHit[] = GOALS.filter(goal => searchMatches(query, [goal.title, goal.summary, ...goal.keywords].join(' ')))
    .map(goal => ({ kind: 'goal', title: goal.title, hint: 'цель', goalId: goal.id }));
  const steps = levels.flatMap(level => level.steps.filter(step => step.kind === 'concept').map(step => ({ level, step })));
  const conceptHits = steps.filter(({ step }) => {
    const concept = REFERENCE_CONCEPTS.find(item => item.id === step.conceptId)!;
    return searchMatches(query, [concept.title, concept.summary, ...concept.keywords].join(' '));
  }).map(({ level, step }) => ({ kind: 'concept' as const, title: step.title, hint: `понятие · ${level.title}`, levelKey: level.key, stepKey: step.key }));
  const unique = [...new Map(conceptHits.map(hit => [hit.stepKey.split(':').slice(1).join(':'), hit])).values()];
  const exerciseHits: SearchHit[] = items.filter(item => {
    const concept = item.concepts[0] ? conceptForExerciseConcept(item.concepts[0]) : null;
    return searchMatches(query, [item.title, ...item.concepts.map(id => CONCEPT_LABELS[id]), ...(concept?.keywords ?? [])].join(' '));
  }).map(item => ({ kind: 'exercise', title: item.title, hint: 'упражнение', content: { kind: 'exercise', spec: item.spec } }));
  // Совпадение в названии — выше совпадения только по описанию и ключевым словам; внутри — цели, понятия, упражнения.
  const all = [...goalHits, ...unique, ...exerciseHits];
  return [...all.filter(hit => searchMatches(query, hit.title)), ...all.filter(hit => !searchMatches(query, hit.title))].slice(0, 10);
}

/** Подписи шаблонов для понятий без своей карточки (для тестов и подсказок). */
export const TEMPLATE_TITLES: Readonly<Record<ExerciseTemplateId, string>> = Object.freeze(Object.fromEntries(EXERCISE_TEMPLATES.map(template => [template.id, template.title])) as Record<ExerciseTemplateId, string>);

export const ASSESSMENT_SCALE: readonly Assessment[] = Object.freeze(['clean', 'errors', 'slow']);

/* ---------- Цели «Основ» (D-049) ---------- */

export const RULE_HINTS: Readonly<Record<MasteryRule, string>> = Object.freeze({
  memory: 'Сыграй с подсказкой, потом целиком в виде «По памяти» и отметь «Чисто».',
  clean: 'Сыграй целиком и отметь «Чисто».',
  check: 'Ответь верно с первой попытки на 5 вопросов из 6.',
});

/** Цель из настроек: неизвестный id (каталог целей меняется) — цели нет. */
export function storedGoal(value: { readonly id: string; readonly root: string | null } | null): LessonState['goal'] {
  return value && isGoalId(value.id) ? { id: value.id, root: value.root } : null;
}

/** Прогресс всех целей: для выбранной цели — её тоника, для остальных — тоника по умолчанию. */
export function goalsOverview(records: readonly PracticeRecord[], roots: ReadonlyMap<GoalId, string | null> = new Map()): readonly GoalProgress[] {
  const index = recordsByMaterial(records);
  return GOALS.map(goal => goalProgress(goal.id, roots.get(goal.id) ?? goal.defaultRoot, records, index));
}

export function currentGoalProgress(state: Pick<LessonState, 'goal' | 'records'>): GoalProgress | null {
  return state.goal ? goalProgress(state.goal.id, state.goal.root, state.records) : null;
}

export const goalStepTitle = (step: GoalStep, userExercises: readonly UserExercise[] = []) => stepTitle(step.content, userExercises);

/**
 * «Добавить шаги цели»: два следующих неосвоенных шага и разминка — следующий шаг «Четырёх пальцев»
 * (если цель не они). Без повторов по материалу среди незавершённых шагов, не больше предела плана.
 */
export function addGoalSteps(plan: DayPlan, progress: GoalProgress, records: readonly PracticeRecord[], userExercises: readonly UserExercise[] = []) {
  const warmup = progress.goal.id === 'four-fingers' ? [] : nextGoalSteps(goalProgress('four-fingers', null, records), 1);
  let next = plan;
  const added: GoalStep[] = [];
  for (const step of [...warmup, ...nextGoalSteps(progress, 2)]) {
    if (pendingMatches(next, step.content, userExercises).length) continue;
    if (next.steps.length >= MAX_PLAN_STEPS) break;
    next = addStep(next, { id: nextStepId(next), content: step.content, minutes: contentMinutes(step.content) });
    added.push(step);
  }
  return { plan: next, added };
}
