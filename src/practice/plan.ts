/**
 * План на сегодня (R-026): плейлист шагов занятия с плановым временем.
 * Чистый модуль: без DOM, звука и хранилища. Все значения заморожены; операции возвращают новый план.
 */
import { validateExerciseSpec, type ExerciseSpec } from '../exercises';
import { validatePractice, type PracticeOptions } from '../exercises/rhythm';
import { checkExercise, validateCheckSpec, type CheckSpec } from './check';

export { validateCheckSpec, type CheckKind, type CheckSpec } from './check';

export type PlanStepContent =
  /** `practice` — как играть шаг (эхо, подложка, ритм); без него — восьмые без эха и подложки (D-050). */
  | { readonly kind: 'exercise'; readonly spec: ExerciseSpec; readonly practice?: PracticeOptions }
  | { readonly kind: 'check'; readonly spec: CheckSpec };
/** Материал содержимого шага: упражнение или материал проверки по упражнению; у проверки по диапазону — `null`. */
export const contentExerciseOf = (content: PlanStepContent): ExerciseSpec | null => (content.kind === 'exercise' ? content.spec : checkExercise(content.spec));
export type PlanStepStatus = 'pending' | 'current' | 'done';
export interface PlanStep {
  readonly id: string;
  readonly content: PlanStepContent;
  readonly minutes: number;
  readonly status: PlanStepStatus;
  /** ID шага программы (R-028, `h1-roots.eighths`); у шагов, добавленных из библиотеки вручную, поля нет. */
  readonly programStep?: string;
}
/** Шаг, который принимают `createPlan` и `addStep`: статус назначает план. */
export type NewPlanStep = { readonly id: string; readonly content: PlanStepContent; readonly minutes: number; readonly programStep?: string };
export interface DayPlan {
  readonly version: 'plan-v1';
  /** Локальная дата плана YYYY-MM-DD. */
  readonly localDate: string;
  readonly steps: readonly PlanStep[];
}

export const MAX_PLAN_STEPS = 12;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** ID шага программы: блок и шаг через точку, строчными латиницей, цифрами и дефисом. */
export const PROGRAM_STEP_ID = /^(?=.{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new RangeError(`${label}: нужен обычный JSON-объект.`);
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new RangeError(`${label}: допускаются только обычные поля.`);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new RangeError(`${label}: ожидаются поля ${keys.join(', ')}.`);
  return value as Record<string, unknown>;
}

function validateContent(value: unknown): PlanStepContent {
  const withPractice = !!value && typeof value === 'object' && Object.hasOwn(value, 'practice');
  const raw = record(value, withPractice ? ['kind', 'spec', 'practice'] : ['kind', 'spec'], 'Шаг плана');
  if (raw.kind === 'exercise') {
    return deepFreeze(withPractice ? { kind: 'exercise', spec: validateExerciseSpec(raw.spec), practice: validatePractice(raw.practice) } : { kind: 'exercise', spec: validateExerciseSpec(raw.spec) });
  }
  if (withPractice) throw new RangeError('Шаг плана: «как играть» есть только у упражнения.');
  if (raw.kind === 'check') return deepFreeze({ kind: 'check', spec: validateCheckSpec(raw.spec) });
  throw new RangeError('Шаг плана: неизвестный вид.');
}

function validateStep(value: unknown): PlanStep {
  const linked = !!value && typeof value === 'object' && Object.hasOwn(value, 'programStep');
  const raw = record(value, linked ? ['id', 'content', 'minutes', 'status', 'programStep'] : ['id', 'content', 'minutes', 'status'], 'Шаг плана');
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) throw new RangeError('Шаг плана: некорректный идентификатор.');
  if (!Number.isInteger(raw.minutes) || (raw.minutes as number) < 1 || (raw.minutes as number) > 60) throw new RangeError('Шаг плана: от 1 до 60 минут.');
  if (raw.status !== 'pending' && raw.status !== 'current' && raw.status !== 'done') throw new RangeError('Шаг плана: неизвестный статус.');
  const base = { id: raw.id, content: validateContent(raw.content), minutes: raw.minutes as number, status: raw.status as PlanStepStatus };
  if (!linked) return base;
  if (typeof raw.programStep !== 'string' || !PROGRAM_STEP_ID.test(raw.programStep)) throw new RangeError('Шаг плана: некорректный ID шага программы.');
  return { ...base, programStep: raw.programStep };
}

/** Не больше одного текущего шага; если текущего нет — им становится первый незавершённый. */
function normalize(steps: readonly PlanStep[]): readonly PlanStep[] {
  const firstCurrent = steps.findIndex(step => step.status === 'current');
  const target = firstCurrent >= 0 ? firstCurrent : steps.findIndex(step => step.status === 'pending');
  return steps.map((step, index) => {
    const status: PlanStepStatus = step.status === 'done' ? 'done' : index === target ? 'current' : 'pending';
    return status === step.status ? step : { ...step, status };
  });
}

/** Строгая проверка сохранённого плана; второй текущий шаг или повтор ID отклоняются, а не исправляются. */
export function validatePlan(value: unknown): DayPlan {
  const raw = record(value, ['version', 'localDate', 'steps'], 'План');
  if (raw.version !== 'plan-v1') throw new RangeError('Неизвестная версия плана.');
  if (typeof raw.localDate !== 'string' || !DATE.test(raw.localDate)) throw new RangeError('План: дата должна быть в формате ГГГГ-ММ-ДД.');
  if (!Array.isArray(raw.steps) || raw.steps.length > MAX_PLAN_STEPS) throw new RangeError(`План: от 0 до ${MAX_PLAN_STEPS} шагов.`);
  const steps = raw.steps.map(validateStep);
  if (new Set(steps.map(step => step.id)).size !== steps.length) throw new RangeError('План: идентификаторы шагов повторяются.');
  const current = steps.filter(step => step.status === 'current').length;
  if (current > 1) throw new RangeError('План: текущим может быть только один шаг.');
  if (current === 0 && steps.some(step => step.status === 'pending')) throw new RangeError('План: у незавершённого плана должен быть текущий шаг.');
  return deepFreeze({ version: 'plan-v1', localDate: raw.localDate, steps });
}

export function createPlan(localDate: string, steps: readonly NewPlanStep[] = []): DayPlan {
  return validatePlan(JSON.parse(JSON.stringify({ version: 'plan-v1', localDate, steps: normalize(steps.map(step => ({ ...step, status: 'pending' as const }))) })));
}

const rebuild = (plan: DayPlan, steps: readonly PlanStep[]) => validatePlan(JSON.parse(JSON.stringify({ ...plan, steps: normalize(steps) })));

export function addStep(plan: DayPlan, step: NewPlanStep): DayPlan {
  if (plan.steps.length >= MAX_PLAN_STEPS) throw new RangeError(`В плане не больше ${MAX_PLAN_STEPS} шагов.`);
  return rebuild(plan, [...plan.steps, { ...step, status: 'pending' }]);
}
export function removeStep(plan: DayPlan, id: string): DayPlan {
  if (!plan.steps.some(step => step.id === id)) throw new RangeError('Шаг не найден в плане.');
  return rebuild(plan, plan.steps.filter(step => step.id !== id));
}
/** Сдвиг шага на delta позиций; завершённые шаги не переставляются. */
export function moveStep(plan: DayPlan, id: string, delta: -1 | 1): DayPlan {
  const index = plan.steps.findIndex(step => step.id === id);
  if (index < 0) throw new RangeError('Шаг не найден в плане.');
  const target = index + delta;
  if (target < 0 || target >= plan.steps.length || plan.steps[index].status === 'done' || plan.steps[target].status === 'done') return plan;
  const steps = [...plan.steps];
  [steps[index], steps[target]] = [steps[target], steps[index]];
  return rebuild(plan, steps);
}
/** Отмечает шаг выполненным; текущим становится следующий незавершённый. */
export function completeStep(plan: DayPlan, id: string): DayPlan {
  if (!plan.steps.some(step => step.id === id)) throw new RangeError('Шаг не найден в плане.');
  return rebuild(plan, plan.steps.map(step => step.id === id ? { ...step, status: 'done' as const } : step.status === 'current' ? { ...step, status: 'pending' as const } : step));
}
/** Делает шаг текущим (пользователь выбрал другой шаг). */
export function selectStep(plan: DayPlan, id: string): DayPlan {
  const step = plan.steps.find(candidate => candidate.id === id);
  if (!step) throw new RangeError('Шаг не найден в плане.');
  if (step.status === 'done') return plan;
  return rebuild(plan, plan.steps.map(candidate => candidate.id === id ? { ...candidate, status: 'current' as const } : candidate.status === 'current' ? { ...candidate, status: 'pending' as const } : candidate));
}

export const currentStep = (plan: DayPlan) => plan.steps.find(step => step.status === 'current') ?? null;
export const plannedMinutes = (plan: DayPlan) => plan.steps.reduce((sum, step) => sum + step.minutes, 0);
export const doneMinutes = (plan: DayPlan) => plan.steps.filter(step => step.status === 'done').reduce((sum, step) => sum + step.minutes, 0);
