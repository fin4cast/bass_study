/**
 * Чистая логика раздела «Занятие» (P13-02): план на сегодня, выбор вида экрана игры, ключ упражнения,
 * обновление плана после самооценки и «Проверь себя», записи истории и умолчания экрана игры.
 * Без DOM, звука и хранилища: координатор `lesson-section.ts` только применяет результат.
 */
import { buildExercise, configureSpec, targetBpmFor, type ExercisePlan, type ExerciseSpec } from '../exercises';
import { DEFAULT_PRACTICE, type PracticeOptions } from '../exercises/rhythm';
import { builtinLibrary, type UserExercise } from '../practice/library';
import { builtinTemplateOf } from '../practice/material';
import { addStep, completeStep, contentExerciseOf, createPlan, currentStep, MAX_PLAN_STEPS, type DayPlan, type NewPlanStep, type PlanStepContent } from '../practice/plan';
import { checkExercise, checkId, type CheckSpec } from '../practice/check';
import { BASE_BPM, checkFacts, evaluateProgram, lineFacts, playFacts, type ProgramState } from '../practice/program';
import { PROGRAM } from '../practice/program-data';
import { difficulties, type Assessment, type Difficulty, type PracticeRecord } from '../practice/results';
import {
  makeCheckHistory, makeManualHistory, MAX_CHECK_ACTIVE_MS, MAX_EXERCISE_VIEWS,
  type CheckAnswer, type CheckHistoryEntry, type ExerciseSettings, type ExerciseView, type HistoryEntry, type HistoryMetadata, type LessonPreferences, type ManualHistoryEntry, type PlayPreferences,
} from '../storage/model';
import { createManualPracticeResult, manualTempoBounds } from '../training/results';
import { checkContent, contentMinutes, exerciseKey, exerciseTitle, nextStepId, pendingMatches, stepMaterial } from '../ui/lesson/model';
import { difficultyId, type ProgressRow } from '../ui/progress/model';
import type { PlayDefaults } from '../ui/settings/model';
import type { PlaySettings } from '../ui/play/model';

export { exerciseKey } from '../ui/lesson/model';

/** Локальная дата устройства YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Шаг, добавленный вручную: без ссылки на программу и без причины места (разминку ставит программа). */
const isManual = (step: { readonly programStep?: string; readonly role?: string }) => step.programStep === undefined && step.role === undefined;

/**
 * План на сегодня: сохранённый или собранный для нового дня. Новый день собирает программа (`compose`, R-028); из плана
 * прошлого дня переносятся только шаги, добавленные вручную, и не выполненные: разминка и шаги программы не переносятся.
 * В течение дня план не пересобирается. Всего не больше `MAX_PLAN_STEPS` шагов.
 */
export function planForToday(stored: DayPlan | null, today: string, compose: () => readonly NewPlanStep[] = () => []): DayPlan {
  if (stored?.localDate === today) return stored;
  const carried = stored ? stored.steps.filter(step => step.status !== 'done' && isManual(step)) : [];
  const steps = [...compose(), ...carried.map(({ id, content, minutes }) => ({ id, content, minutes }))].slice(0, MAX_PLAN_STEPS);
  return createPlan(today, steps);
}

/**
 * План дня после смены отметок «Уже умею» или длины занятия: пока в плане нет выполненных шагов, шаги программы
 * (с разминкой) собираются заново, вручную добавленные остаются; после первого выполненного шага план дня не меняется.
 */
export function planAfterSkipChange(stored: DayPlan | null, today: string, compose: () => readonly NewPlanStep[]): DayPlan | null {
  if (!stored || stored.localDate !== today || stored.steps.some(step => step.status === 'done')) return stored;
  const manual = stored.steps.filter(isManual).map(({ id, content, minutes }) => ({ id, content, minutes }));
  return createPlan(today, [...compose(), ...manual].slice(0, MAX_PLAN_STEPS));
}

export const contentExercise = contentExerciseOf;

/**
 * Вид экрана игры: запомненный для упражнения; иначе для ни разу не сыгранного — вид нового упражнения
 * (или вид по умолчанию, если он не задан); иначе вид по умолчанию.
 */
export function viewForExercise(key: string, played: boolean, lesson: Pick<LessonPreferences, 'exerciseSettings'>, play: Pick<PlayPreferences, 'defaultView' | 'newExerciseView'>): ExerciseView {
  const remembered = Object.hasOwn(lesson.exerciseSettings, key) ? lesson.exerciseSettings[key].view : null;
  if (remembered) return remembered;
  return played ? play.defaultView : play.newExerciseView ?? play.defaultView;
}

export const EMPTY_EXERCISE_SETTINGS: ExerciseSettings = Object.freeze({ view: null, bpm: null, targetBpm: null, rhythm: 'eighths', groove: null });

/** Запоминает настройки упражнения; последний ключ — в конце, старейшие сверх предела отбрасываются. */
export function rememberExerciseSettings(all: Readonly<Record<string, ExerciseSettings>>, key: string, patch: Partial<ExerciseSettings>): Readonly<Record<string, ExerciseSettings>> {
  const current = Object.hasOwn(all, key) ? all[key] : EMPTY_EXERCISE_SETTINGS;
  const next = { ...current, ...patch };
  if (Object.hasOwn(all, key) && JSON.stringify(current) === JSON.stringify(next)) return all;
  const entries = Object.entries(all).filter(([candidate]) => candidate !== key);
  entries.push([key, next]);
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_EXERCISE_VIEWS)));
}

/**
 * Начальные настройки экрана игры (D-050): темп и цель, ритм и подложка — упражнения; эталон, метроном,
 * громкости и отсчёт — общие умолчания; «как играть» шага плана главнее запомненного ритма и подложки.
 */
export function playSettingsFor(spec: ExerciseSpec, key: string, sources: {
  readonly lesson: Pick<LessonPreferences, 'exerciseSettings'>; readonly play: PlayPreferences; readonly records: readonly PracticeRecord[];
  readonly practice?: PracticeOptions | null; readonly bpm?: number;
  /** Шаг программы (R-028): темп — запомненный для этого материала, иначе базовый 60 BPM, без наследования от соседа по шаблону. */
  readonly baseBpm?: boolean;
}): Partial<PlaySettings> {
  const saved = Object.hasOwn(sources.lesson.exerciseSettings, key) ? sources.lesson.exerciseSettings[key] : EMPTY_EXERCISE_SETTINGS;
  const practice = sources.practice ?? null;
  return {
    bpm: sources.bpm ?? saved.bpm ?? (sources.baseBpm ? bpmForExercise(key, sources.records, BASE_BPM, false) : bpmForExercise(key, sources.records, sources.play.bpm)),
    targetBpm: saved.targetBpm ?? targetBpmFor(spec),
    rhythm: practice?.rhythm ?? saved.rhythm,
    groove: (practice ? practice.groove : saved.groove) as PlaySettings['groove'],
    echo: practice?.echo ?? false,
    countInBars: sources.play.countInBars, reference: sources.play.reference, metronome: sources.play.metronome,
    click: sources.play.click, grooveVolume: sources.play.grooveVolume,
    accompaniment: sources.play.accompaniment, accompanimentVolume: sources.play.accompanimentVolume,
  };
}

/**
 * Темп: последний проход этого материала, иначе последний проход того же шаблона (другая форма или тоника),
 * иначе запасной. После «Не успевал» темп не повышается: предлагается на 4 BPM ниже отмеченного.
 */
export function bpmForExercise(key: string, records: readonly PracticeRecord[], fallback: number, inherit = true): number {
  const template = inherit ? builtinTemplateOf(key) : null;
  let last: { bpm: number; occurredAt: string; assessment: Assessment } | null = null;
  let sameTemplate: { bpm: number; occurredAt: string; assessment: Assessment } | null = null;
  for (const record of records) {
    if (record.kind !== 'play') continue;
    if (record.exerciseKey === key && (!last || record.occurredAt >= last.occurredAt)) last = record;
    else if (template && builtinTemplateOf(record.exerciseKey) === template && (!sameTemplate || record.occurredAt >= sameTemplate.occurredAt)) sameTemplate = record;
  }
  const chosen = last ?? sameTemplate;
  if (!chosen) return fallback;
  return chosen.assessment === 'slow' ? Math.max(40, chosen.bpm - 4) : chosen.bpm;
}

/** Темп следующего открытия после оценки: «Не успевал» — на 4 BPM ниже (не ниже 40), иначе темп подхода. */
export function bpmAfterRating(assessment: Assessment, bpm: number): number {
  return assessment === 'slow' ? Math.max(40, Math.round(bpm) - 4) : Math.round(bpm);
}

/**
 * Что запомнить в настройках упражнения после изменения на экране игры: только менявшиеся поля; ритм и подложка
 * шага с явным «как играть» (шаг цели) не запоминаются — это свойство шага, а не упражнения.
 */
export function exerciseSettingsPatch(settings: Pick<PlaySettings, 'bpm' | 'targetBpm' | 'rhythm' | 'groove'>, changed: readonly string[], stepPractice: boolean): Partial<ExerciseSettings> {
  const patch: { bpm?: number; targetBpm?: number; rhythm?: ExerciseSettings['rhythm']; groove?: ExerciseSettings['groove'] } = {};
  if (changed.includes('bpm')) patch.bpm = settings.bpm;
  if (changed.includes('targetBpm')) patch.targetBpm = settings.targetBpm;
  if (!stepPractice && changed.includes('rhythm')) patch.rhythm = settings.rhythm;
  if (!stepPractice && changed.includes('groove')) patch.groove = settings.groove;
  return patch;
}

export const hasPlayed = (key: string, records: readonly PracticeRecord[]) => records.some(record => record.kind === 'play' && record.exerciseKey === key);

/** Результат смены параметра материала на экране игры (P18-04). */
export type VariantChange =
  | { readonly ok: true; readonly spec: ExerciseSpec; readonly key: string; readonly plan: ExercisePlan; readonly view: ExerciseView; readonly settings: Partial<PlaySettings> }
  | { readonly ok: false; readonly error: string };

/**
 * Другой вариант того же шаблона: параметр меняется по правилам карточки библиотеки (`configureSpec`), вид и темп берутся
 * для нового материала. «Как играть» шага (ритм, эхо, подложка) не меняется. Несовместимое сочетание — ошибка, материал прежний.
 */
export function variantChange(spec: ExerciseSpec, param: string, value: string | number, sources: {
  readonly lesson: Pick<LessonPreferences, 'exerciseSettings'>; readonly play: PlayPreferences; readonly records: readonly PracticeRecord[];
  readonly userExercises: readonly UserExercise[]; readonly practice: PracticeOptions | null; readonly baseBpm?: boolean;
}): VariantChange {
  try {
    const next = configureSpec(spec, param, value);
    const plan = buildExercise(next);
    const key = exerciseKey(next, sources.userExercises);
    const view = viewForExercise(key, hasPlayed(key, sources.records), sources.lesson, sources.play);
    const settings = playSettingsFor(next, key, { lesson: sources.lesson, play: sources.play, records: sources.records, practice: sources.practice, baseBpm: sources.baseBpm });
    return { ok: true, spec: next, key, plan, view, settings };
  } catch (failure) {
    return { ok: false, error: failure instanceof Error ? failure.message : String(failure) };
  }
}

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

/**
 * Шаг плана для экрана игры (D-050): плановое время, уже сыгранное сегодня этим материалом (сумма активного
 * времени проходов за дату плана), есть ли другой невыполненный шаг и выполнен ли этот.
 */
export function planStepInfo(plan: DayPlan, stepId: string | null, keys: string | readonly string[], records: readonly PracticeRecord[]) {
  const step = stepId ? plan.steps.find(candidate => candidate.id === stepId) : undefined;
  if (!step) return null;
  // Ключи — все варианты материала, открытые на этом шаге (P18-04): смена лада не обнуляет таймер шага.
  const own = new Set(typeof keys === 'string' ? [keys] : keys);
  const doneMs = records.reduce((sum, record) => record.kind === 'play' && own.has(record.exerciseKey) && record.localDate === plan.localDate ? sum + record.activeMs : sum, 0);
  return { plannedMs: step.minutes * 60_000, doneMs, hasNext: plan.steps.some(candidate => candidate.id !== step.id && candidate.status !== 'done'), done: step.status === 'done' };
}

/** «Следующий шаг плана» с экрана игры: текущий шаг отмечается выполненным, дальше — следующий невыполненный. */
export function planAfterNext(plan: DayPlan, stepId: string | null): DayPlan {
  return completeIfOpen(plan, stepId);
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
  if (key.startsWith('user:')) return sources.userExercises.find(exercise => `user:${exercise.id}` === key)?.spec ?? null;
  return builtinLibrary(sources.playFrom).find(item => item.key === key)?.spec ?? null;
}

/** Описание проверки по ключу `check:<checkId>`: последняя запись истории с этим ключом. */
export function checkForKey(key: string, history: readonly HistoryEntry[]): CheckSpec | null {
  let found: { check: CheckSpec; occurredAt: string } | null = null;
  for (const entry of history) {
    if (entry.result.kind === 'check' && entry.result.exerciseKey === key && (!found || entry.occurredAt >= found.occurredAt)) found = { check: entry.result.check, occurredAt: entry.occurredAt };
  }
  return found?.check ?? null;
}

/** Что добавить в план по «Повторить» / «В план» «Прогресса»: трудная цель — та же проверка, остальное — упражнение. */
export function repeatContent(target: Difficulty | string, spec: ExerciseSpec | null): PlanStepContent | null {
  if (typeof target !== 'string' && target.kind === 'target') return { kind: 'check', spec: target.check };
  if (!spec) return null;
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
    if (step.content.kind === 'check') { checks.add(`check:${checkId(step.content.spec)}`); continue; }
    const material = contentExercise(step.content);
    if (!material) continue;
    exercises.add(exerciseKey(material, userExercises));
  }
  const ids = new Set<string>([...exercises, ...checks]);
  for (const difficulty of difficulties(records)) {
    if ((difficulty.kind === 'target' ? checks : exercises).has(difficulty.exerciseKey)) ids.add(difficultyId(difficulty));
  }
  return ids;
}

const clampInteger = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));

/** Самооценка прохода упражнения как ручная отметка истории (R-026, R-011). */
export function playRatingEntry(input: {
  readonly spec: ExerciseSpec; readonly userExercises: readonly UserExercise[]; readonly view: ExerciseView; readonly wholePass: boolean;
  readonly assessment: Assessment; readonly bpm: number; readonly activeMs: number; readonly practice?: PracticeOptions;
}, metadata: HistoryMetadata): ManualHistoryEntry {
  const material = { kind: 'exercise' as const, key: exerciseKey(input.spec, input.userExercises), title: exerciseTitle(input.spec, input.userExercises), spec: input.spec, view: input.view, wholePass: input.wholePass,
    practice: input.practice ?? DEFAULT_PRACTICE };
  const result = createManualPracticeResult({
    context: null, material, assessment: input.assessment,
    comfortableBpm: clampInteger(input.bpm, manualTempoBounds(material)),
    durationMs: Math.max(0, Math.round(Number.isFinite(input.activeMs) ? input.activeMs : 0)),
  });
  return makeManualHistory(result, metadata);
}

const CHECK_KIND_TITLES: Readonly<Record<CheckSpec['kind'], string>> = {
  'find-note': 'найди ноту', 'name-note': 'назови ноту', 'find-all': 'найди все позиции', 'find-degree': 'найди ступень', 'name-degree': 'назови ступень',
};
/** Название проверки по диапазону для строки «Прогресса»: вид вопроса и область («назови ноту · струны E, A · лады 0–5»). */
function rangeCheckTitle(spec: CheckSpec): string {
  const area = spec.area;
  return `${CHECK_KIND_TITLES[spec.kind]} · ${area.type === 'range' ? `струны ${area.strings.join(', ')} · лады ${area.fretMin}–${area.fretMax}` : 'материал упражнения'}`;
}

/** Итог «Проверь себя»; без ответов записи нет. */
export function checkEntry(input: {
  readonly spec: CheckSpec; readonly userExercises: readonly UserExercise[]; readonly activeMs: number; readonly answers: readonly CheckAnswer[];
}, metadata: HistoryMetadata): CheckHistoryEntry | null {
  const exercise = checkExercise(input.spec);
  return makeCheckHistory({
    exerciseKey: `check:${checkId(input.spec)}`,
    title: `Проверь себя: ${exercise ? exerciseTitle(exercise, input.userExercises) : rangeCheckTitle(input.spec)}`.slice(0, 120),
    check: input.spec,
    activeMs: Math.min(MAX_CHECK_ACTIVE_MS, Math.max(0, Math.round(Number.isFinite(input.activeMs) ? input.activeMs : 0))),
    answers: input.answers,
  }, metadata);
}

/** Подпись материала строки «Прогресса»: материал прохода или последней проверки этого упражнения. */
export function describeProgressRow(row: ProgressRow, history: readonly HistoryEntry[]): string {
  if (row.kind === 'play') return stepMaterial({ kind: 'exercise', spec: row.spec });
  let last: { spec: CheckSpec; occurredAt: string } | null = null;
  for (const entry of history) {
    if (entry.result.kind === 'check' && entry.result.exerciseKey === row.key && (!last || entry.occurredAt >= last.occurredAt)) last = { spec: entry.result.check, occurredAt: entry.occurredAt };
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
  return { view: VIEW_TO_SETTINGS[play.defaultView], newExerciseView: play.newExerciseView === null ? null : VIEW_TO_SETTINGS[play.newExerciseView], countInBars: play.countInBars,
    labels: LABELS_TO_SETTINGS[play.labels], bpm: play.bpm, reference: play.reference, metronome: play.metronome, accompaniment: play.accompaniment };
}
/** Умолчания из «Настроек»; громкости клика, подложки и аккордов задаются на экране игры и сохраняются как есть. */
export function fromPlayDefaults(defaults: PlayDefaults, current: Pick<PlayPreferences, 'click' | 'grooveVolume' | 'accompanimentVolume'>): PlayPreferences {
  return { defaultView: VIEW_FROM_SETTINGS[defaults.view], newExerciseView: defaults.newExerciseView === null ? null : VIEW_FROM_SETTINGS[defaults.newExerciseView], countInBars: defaults.countInBars,
    labels: LABELS_FROM_SETTINGS[defaults.labels], bpm: defaults.bpm, reference: defaults.reference, metronome: defaults.metronome, click: current.click, grooveVolume: current.grooveVolume,
    accompaniment: defaults.accompaniment, accompanimentVolume: current.accompanimentVolume };
}

/** Статусы программы по истории, отметкам «Уже умею» и дате (R-028): вычисляются, нигде не хранятся. */
export function programStateFor(records: readonly PracticeRecord[], skipped: readonly string[], today: string): ProgramState {
  return evaluateProgram(PROGRAM, { plays: playFacts(records), checks: checkFacts(records), lines: lineFacts(records), skippedBlocks: new Set(skipped), today });
}
