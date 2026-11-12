/**
 * Чистая логика раздела «Занятие» (P13-02): план на сегодня, выбор вида экрана игры, ключ упражнения,
 * обновление плана после самооценки и «Проверь себя», записи истории и умолчания экрана игры.
 * Без DOM, звука и хранилища: координатор `lesson-section.ts` только применяет результат.
 */
import type { ExerciseSpec } from '../exercises';
import { builtinLibrary, type UserExercise } from '../practice/library';
import { addStep, completeStep, createPlan, currentStep, planFromTemplate, type CheckSpec, type DayPlan, type PlanStepContent } from '../practice/plan';
import { difficulties, type Assessment, type Difficulty, type PracticeRecord } from '../practice/results';
import {
  makeCheckHistory, makeManualHistory, MAX_CHECK_ACTIVE_MS, MAX_EXERCISE_VIEWS,
  type CheckAnswer, type CheckHistoryEntry, type ExerciseView, type HistoryEntry, type HistoryMetadata, type LessonPreferences, type ManualHistoryEntry, type PlayPreferences,
} from '../storage/model';
import { createManualPracticeResult, manualTempoBounds } from '../training/results';
import { checkContent, contentMinutes, exerciseKey, exerciseTitle, nextStepId, pendingMatches, stepMaterial } from '../ui/lesson/model';
import { difficultyId, type ProgressRow } from '../ui/progress/model';
import type { PlayDefaults } from '../ui/settings/model';

export { exerciseKey } from '../ui/lesson/model';

/** Локальная дата устройства YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * План на сегодня из сохранённого. План другого дня переносит незавершённые шаги в новый день;
 * без сохранённого плана и без записей прогресса — шаблон первого запуска, иначе пустой план.
 */
export function planForToday(stored: DayPlan | null, today: string, firstRun: boolean): DayPlan {
  if (stored?.localDate === today) return stored;
  if (!stored && firstRun) return planFromTemplate(today, 'firstRun');
  const carried = stored ? stored.steps.filter(step => step.status !== 'done') : [];
  return createPlan(today, carried.map(({ id, content, minutes }) => ({ id, content, minutes })));
}

export const contentExercise = (content: PlanStepContent): ExerciseSpec => content.kind === 'exercise' ? content.spec : content.spec.exercise;

/**
 * Вид экрана игры: запомненный для упражнения; иначе для ни разу не сыгранного — вид нового упражнения
 * (или вид по умолчанию, если он не задан); иначе вид по умолчанию.
 */
export function viewForExercise(key: string, played: boolean, lesson: Pick<LessonPreferences, 'viewByExercise'>, play: Pick<PlayPreferences, 'defaultView' | 'newExerciseView'>): ExerciseView {
  const remembered = Object.hasOwn(lesson.viewByExercise, key) ? lesson.viewByExercise[key] : undefined;
  if (remembered) return remembered;
  return played ? play.defaultView : play.newExerciseView ?? play.defaultView;
}

/** Запоминает вид упражнения; последний выбранный ключ — в конце, старейшие сверх предела отбрасываются. */
export function rememberView(views: Readonly<Record<string, ExerciseView>>, key: string, view: ExerciseView): Readonly<Record<string, ExerciseView>> {
  if (views[key] === view) return views;
  const entries = Object.entries(views).filter(([candidate]) => candidate !== key);
  entries.push([key, view]);
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_EXERCISE_VIEWS)));
}

/** Темп открытия: последний сыгранный темп упражнения («продолжить с прежним темпом»), иначе умолчание. */
export function bpmForExercise(key: string, records: readonly PracticeRecord[], fallback: number): number {
  let last: { bpm: number; occurredAt: string } | null = null;
  for (const record of records) {
    if (record.kind === 'play' && record.exerciseKey === key && (!last || record.occurredAt >= last.occurredAt)) last = record;
  }
  return last?.bpm ?? fallback;
}

export const hasPlayed = (key: string, records: readonly PracticeRecord[]) => records.some(record => record.kind === 'play' && record.exerciseKey === key);

function completeIfOpen(plan: DayPlan, stepId: string | null): DayPlan {
  if (!stepId) return plan;
  const step = plan.steps.find(candidate => candidate.id === stepId);
  return step && step.status !== 'done' ? completeStep(plan, stepId) : plan;
}

/** Шаг плана выполнен самооценкой «Чисто»; «С ошибками» и «Не успевал» оставляют шаг текущим. */
export function planAfterRating(plan: DayPlan, stepId: string | null, assessment: Assessment): DayPlan {
  return assessment === 'clean' ? completeIfOpen(plan, stepId) : plan;
}

/** «К следующему шагу плана» после «Проверь себя»: шаг отмечается выполненным. */
export function planAfterCheck(plan: DayPlan, stepId: string | null): DayPlan {
  return completeIfOpen(plan, stepId);
}

/** Следующий шаг после выполненного: текущий шаг плана или `null`, если план пройден. */
export function nextPlanStep(plan: DayPlan): { readonly stepId: string; readonly content: PlanStepContent } | null {
  const step = currentStep(plan);
  return step ? { stepId: step.id, content: step.content } : null;
}

/** Номер шага в плане для подписей «шаг 2 из 4». */
export function stepPosition(plan: DayPlan, stepId: string | null): { readonly index: number; readonly total: number } | null {
  if (!stepId) return null;
  const index = plan.steps.findIndex(step => step.id === stepId);
  return index < 0 ? null : { index: index + 1, total: plan.steps.length };
}

/** Описание упражнения по ключу: последний проход, затем последняя проверка, своё упражнение или шаблон библиотеки. */
export function specForKey(key: string, sources: { readonly records: readonly PracticeRecord[]; readonly history: readonly HistoryEntry[]; readonly userExercises: readonly UserExercise[]; readonly playFrom: string | null }): ExerciseSpec | null {
  let found: { spec: ExerciseSpec; occurredAt: string } | null = null;
  for (const record of sources.records) {
    if (record.kind === 'play' && record.exerciseKey === key && (!found || record.occurredAt >= found.occurredAt)) found = { spec: record.spec, occurredAt: record.occurredAt };
  }
  if (found) return found.spec;
  for (const entry of sources.history) {
    if (entry.result.kind === 'check' && entry.result.exerciseKey === key && (!found || entry.occurredAt >= found.occurredAt)) found = { spec: entry.result.spec.exercise, occurredAt: entry.occurredAt };
  }
  if (found) return found.spec;
  if (key.startsWith('user:')) return sources.userExercises.find(exercise => `user:${exercise.id}` === key)?.spec ?? null;
  return builtinLibrary(sources.playFrom).find(item => item.key === key)?.spec ?? null;
}

/** Что добавить в план по «Повторить» / «В план» «Прогресса»: трудная ступень — проверка, остальное — упражнение. */
export function repeatContent(target: Difficulty | string, spec: ExerciseSpec | null): PlanStepContent | null {
  if (!spec) return null;
  if (typeof target !== 'string' && target.kind === 'degree') return checkContent(spec, 'name-degree') ?? { kind: 'exercise', spec };
  return { kind: 'exercise', spec };
}

/** Добавляет шаг (3–5 минут); то же незавершённое содержимое не повторяется. */
export function addToPlan(plan: DayPlan, content: PlanStepContent, userExercises: readonly UserExercise[] = []): DayPlan {
  if (pendingMatches(plan, content, userExercises).length) return plan;
  const minutes = Math.min(5, Math.max(3, contentMinutes(content)));
  return addStep(plan, { id: nextStepId(plan), content, minutes });
}

/** Ключи строк и трудных мест «Прогресса», которые уже стоят в незавершённых шагах плана. */
export function plannedProgressIds(plan: DayPlan, records: readonly PracticeRecord[], userExercises: readonly UserExercise[] = []): ReadonlySet<string> {
  const exercises = new Set<string>();
  const checks = new Set<string>();
  for (const step of plan.steps) {
    if (step.status === 'done') continue;
    const key = exerciseKey(contentExercise(step.content), userExercises);
    (step.content.kind === 'exercise' ? exercises : checks).add(key);
  }
  const ids = new Set<string>([...exercises, ...checks]);
  for (const difficulty of difficulties(records)) {
    if ((difficulty.kind === 'degree' ? checks : exercises).has(difficulty.exerciseKey)) ids.add(difficultyId(difficulty));
  }
  return ids;
}

const clampInteger = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));

/** Самооценка прохода упражнения как ручная отметка истории (R-026, R-011). */
export function playRatingEntry(input: {
  readonly spec: ExerciseSpec; readonly userExercises: readonly UserExercise[]; readonly view: ExerciseView;
  readonly assessment: Assessment; readonly bpm: number; readonly activeMs: number;
}, metadata: HistoryMetadata): ManualHistoryEntry {
  const material = { kind: 'exercise' as const, key: exerciseKey(input.spec, input.userExercises), title: exerciseTitle(input.spec, input.userExercises), spec: input.spec, view: input.view };
  const result = createManualPracticeResult({
    context: null, material, assessment: input.assessment,
    comfortableBpm: clampInteger(input.bpm, manualTempoBounds(material)),
    durationMs: Math.max(0, Math.round(Number.isFinite(input.activeMs) ? input.activeMs : 0)),
  });
  return makeManualHistory(result, metadata);
}

/** Итог «Проверь себя»; без ответов записи нет. */
export function checkEntry(input: {
  readonly spec: CheckSpec; readonly userExercises: readonly UserExercise[]; readonly activeMs: number; readonly answers: readonly CheckAnswer[];
}, metadata: HistoryMetadata): CheckHistoryEntry | null {
  const exercise = input.spec.exercise;
  return makeCheckHistory({
    exerciseKey: exerciseKey(exercise, input.userExercises),
    title: `Проверь себя: ${exerciseTitle(exercise, input.userExercises)}`.slice(0, 120),
    spec: input.spec,
    activeMs: Math.min(MAX_CHECK_ACTIVE_MS, Math.max(0, Math.round(Number.isFinite(input.activeMs) ? input.activeMs : 0))),
    answers: input.answers,
  }, metadata);
}

/** Подпись материала строки «Прогресса»: материал прохода или последней проверки этого упражнения. */
export function describeProgressRow(row: ProgressRow, history: readonly HistoryEntry[]): string {
  if (row.kind === 'play') return stepMaterial({ kind: 'exercise', spec: row.spec });
  let last: { spec: CheckSpec; occurredAt: string } | null = null;
  for (const entry of history) {
    if (entry.result.kind === 'check' && entry.result.exerciseKey === row.key && (!last || entry.occurredAt >= last.occurredAt)) last = { spec: entry.result.spec, occurredAt: entry.occurredAt };
  }
  return last ? stepMaterial({ kind: 'check', spec: last.spec }) : '';
}

/* ---------- Умолчания экрана игры ↔ «Настройки» ---------- */

const VIEW_TO_SETTINGS = { board: 'board', both: 'tabBoard', tab: 'tab', memory: 'memory' } as const satisfies Record<ExerciseView, PlayDefaults['view']>;
const LABELS_TO_SETTINGS = { name: 'notes', degree: 'degrees', finger: 'fingers' } as const satisfies Record<PlayPreferences['labels'], PlayDefaults['labels']>;
const invert = <K extends string, V extends string>(map: Record<K, V>) => Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key])) as Record<V, K>;
const VIEW_FROM_SETTINGS = invert(VIEW_TO_SETTINGS);
const LABELS_FROM_SETTINGS = invert(LABELS_TO_SETTINGS);

export function toPlayDefaults(play: PlayPreferences): PlayDefaults {
  return { view: VIEW_TO_SETTINGS[play.defaultView], newExerciseView: play.newExerciseView === null ? null : VIEW_TO_SETTINGS[play.newExerciseView], countIn: play.countIn, labels: LABELS_TO_SETTINGS[play.labels], bpm: play.bpm };
}
export function fromPlayDefaults(defaults: PlayDefaults): PlayPreferences {
  return { defaultView: VIEW_FROM_SETTINGS[defaults.view], newExerciseView: defaults.newExerciseView === null ? null : VIEW_FROM_SETTINGS[defaults.newExerciseView], countIn: defaults.countIn, labels: LABELS_FROM_SETTINGS[defaults.labels], bpm: defaults.bpm };
}
