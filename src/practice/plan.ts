/**
 * План на сегодня (R-026): плейлист шагов занятия с плановым временем.
 * Чистый модуль: без DOM, звука и хранилища. Все значения заморожены; операции возвращают новый план.
 */
import { createExerciseSpec, validateExerciseSpec, type ExerciseSpec } from '../exercises';

export type CheckKind = 'find-degree' | 'name-degree';
export interface CheckSpec {
  readonly version: 'check-v1';
  /** Материал проверки — то же упражнение, по которому задаются вопросы. */
  readonly exercise: ExerciseSpec;
  readonly kind: CheckKind;
  readonly count: number;
  /** Слух как опция вопроса: сначала тоника, потом нота. */
  readonly ear: boolean;
}
export type PlanStepContent =
  | { readonly kind: 'exercise'; readonly spec: ExerciseSpec }
  | { readonly kind: 'check'; readonly spec: CheckSpec };
export type PlanStepStatus = 'pending' | 'current' | 'done';
export interface PlanStep {
  readonly id: string;
  readonly content: PlanStepContent;
  readonly minutes: number;
  readonly status: PlanStepStatus;
}
export interface DayPlan {
  readonly version: 'plan-v1';
  /** Локальная дата плана YYYY-MM-DD. */
  readonly localDate: string;
  readonly steps: readonly PlanStep[];
}

export const MAX_PLAN_STEPS = 12;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
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

export function validateCheckSpec(value: unknown): CheckSpec {
  const raw = record(value, ['version', 'exercise', 'kind', 'count', 'ear'], 'Проверка');
  if (raw.version !== 'check-v1') throw new RangeError('Неизвестная версия проверки.');
  if (raw.kind !== 'find-degree' && raw.kind !== 'name-degree') throw new RangeError('Неизвестный вид проверки.');
  if (!Number.isInteger(raw.count) || (raw.count as number) < 3 || (raw.count as number) > 20) throw new RangeError('В проверке от 3 до 20 вопросов.');
  if (typeof raw.ear !== 'boolean') throw new RangeError('Опция слуха должна быть да или нет.');
  return deepFreeze({ version: 'check-v1', exercise: validateExerciseSpec(raw.exercise), kind: raw.kind, count: raw.count as number, ear: raw.ear });
}

function validateContent(value: unknown): PlanStepContent {
  const raw = record(value, ['kind', 'spec'], 'Шаг плана');
  if (raw.kind === 'exercise') return deepFreeze({ kind: 'exercise', spec: validateExerciseSpec(raw.spec) });
  if (raw.kind === 'check') return deepFreeze({ kind: 'check', spec: validateCheckSpec(raw.spec) });
  throw new RangeError('Шаг плана: неизвестный вид.');
}

function validateStep(value: unknown): PlanStep {
  const raw = record(value, ['id', 'content', 'minutes', 'status'], 'Шаг плана');
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) throw new RangeError('Шаг плана: некорректный идентификатор.');
  if (!Number.isInteger(raw.minutes) || (raw.minutes as number) < 1 || (raw.minutes as number) > 60) throw new RangeError('Шаг плана: от 1 до 60 минут.');
  if (raw.status !== 'pending' && raw.status !== 'current' && raw.status !== 'done') throw new RangeError('Шаг плана: неизвестный статус.');
  return { id: raw.id, content: validateContent(raw.content), minutes: raw.minutes as number, status: raw.status };
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

export function createPlan(localDate: string, steps: readonly { readonly id: string; readonly content: PlanStepContent; readonly minutes: number }[] = []): DayPlan {
  return validatePlan(JSON.parse(JSON.stringify({ version: 'plan-v1', localDate, steps: normalize(steps.map(step => ({ ...step, status: 'pending' as const }))) })));
}

const rebuild = (plan: DayPlan, steps: readonly PlanStep[]) => validatePlan(JSON.parse(JSON.stringify({ ...plan, steps: normalize(steps) })));

export function addStep(plan: DayPlan, step: { readonly id: string; readonly content: PlanStepContent; readonly minutes: number }): DayPlan {
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

/** Встроенные шаблоны планов: первый запуск («Основы») и обычное занятие на 15 минут. */
export const PLAN_TEMPLATES = deepFreeze({
  firstRun: {
    title: 'Начни с «Основ»',
    steps: [
      { content: { kind: 'exercise', spec: createExerciseSpec('note-all-positions') }, minutes: 3 },
      { content: { kind: 'exercise', spec: createExerciseSpec('octaves') }, minutes: 3 },
      { content: { kind: 'exercise', spec: createExerciseSpec('chromatic-position') }, minutes: 4 },
    ],
  },
  standard: {
    title: 'Занятие на 15 минут',
    steps: [
      { content: { kind: 'exercise', spec: createExerciseSpec('chromatic-position') }, minutes: 3 },
      { content: { kind: 'exercise', spec: createExerciseSpec('connect-forms') }, minutes: 5 },
      { content: { kind: 'exercise', spec: createExerciseSpec('arpeggio-1358') }, minutes: 4 },
      { content: { kind: 'check', spec: { version: 'check-v1', exercise: createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' }), kind: 'name-degree', count: 6, ear: false } }, minutes: 3 },
    ],
  },
} as const satisfies Record<string, { title: string; steps: readonly { content: PlanStepContent; minutes: number }[] }>);

export function planFromTemplate(localDate: string, template: keyof typeof PLAN_TEMPLATES): DayPlan {
  return createPlan(localDate, PLAN_TEMPLATES[template].steps.map((step, index) => ({ id: `${template}-${index + 1}`, content: step.content, minutes: step.minutes })));
}
