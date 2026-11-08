export const ROUTE_STEPS = Object.freeze([
  Object.freeze({ id: 'fretboard' as const, name: 'Гриф', plannedMs: 180_000, instruction: 'Найди знакомые ноты и ступени в выбранной области.' }),
  Object.freeze({ id: 'ear' as const, name: 'Слух', plannedMs: 180_000, instruction: 'Сравни тонику и целевой звук трезвучия без карты.' }),
  Object.freeze({ id: 'sequence' as const, name: 'Практика', plannedMs: 240_000, instruction: 'Сыграй последовательность с эталоном и отметь комфортный темп.' }),
] as const);

export type RouteStep = typeof ROUTE_STEPS[number]['id'];
export type RouteStatus = 'running' | 'paused' | 'between' | 'finished';
export type RoutePauseReason = 'manual' | 'hidden';
export interface RouteEvent {
  readonly type: 'start' | 'pause' | 'resume' | 'next' | 'stop' | 'boundary';
  readonly atMs: number;
  readonly reason: RoutePauseReason | null;
}
export interface RouteResult {
  readonly id: string;
  readonly kind: 'route';
  readonly source: 'active-timer';
  readonly plannedStepMs: readonly [180000, 180000, 240000];
  readonly actualStepMs: readonly [number, number, number];
  readonly stepIndex: 0 | 1 | 2;
  readonly totalPlannedMs: 600000;
  readonly status: RouteStatus;
  readonly finishReason: 'completed' | 'stopped' | null;
  readonly events: readonly RouteEvent[];
  readonly asOfMs: number;
}
export type RouteSession = RouteResult;

function immutable(result: RouteResult): RouteResult {
  Object.freeze(result.plannedStepMs);
  Object.freeze(result.actualStepMs);
  result.events.forEach(Object.freeze);
  Object.freeze(result.events);
  return Object.freeze(result);
}

function atTime(session: RouteSession, atMs: number) {
  if (!Number.isSafeInteger(atMs) || atMs < session.asOfMs) throw new RangeError('Время маршрута должно быть целым, неотрицательным и монотонным.');
}

export function startRouteSession(config: { readonly id: string }): RouteSession {
  if (typeof config.id !== 'string' || !config.id.trim() || config.id.length > 120) throw new RangeError('Маршруту нужен устойчивый идентификатор.');
  return immutable({ id: config.id, kind: 'route', source: 'active-timer', plannedStepMs: [180000, 180000, 240000], actualStepMs: [0, 0, 0],
    stepIndex: 0, totalPlannedMs: 600000, status: 'running', finishReason: null,
    events: [{ type: 'start', atMs: 0, reason: null }], asOfMs: 0 });
}

/** Observing late clamps at one step. Waiting never silently starts the next step. */
export function advanceRouteSession(session: RouteSession, atMs: number): RouteSession {
  atTime(session, atMs);
  if (session.status === 'finished' || atMs === session.asOfMs) return session;
  if (session.status !== 'running') return immutable({ ...session, asOfMs: atMs });
  const actualStepMs: [number, number, number] = [...session.actualStepMs];
  const remaining = session.plannedStepMs[session.stepIndex] - actualStepMs[session.stepIndex];
  const spent = Math.min(atMs - session.asOfMs, remaining);
  actualStepMs[session.stepIndex] += spent;
  const boundary = spent === remaining;
  return immutable({ ...session, actualStepMs, asOfMs: atMs, status: boundary ? 'between' : 'running',
    events: boundary ? [...session.events, { type: 'boundary', atMs: session.asOfMs + remaining, reason: null }] : session.events });
}

export function pauseRouteSession(session: RouteSession, atMs: number, reason: RoutePauseReason = 'manual'): RouteSession {
  if (reason !== 'manual' && reason !== 'hidden') throw new RangeError('Неизвестная причина паузы маршрута.');
  const current = advanceRouteSession(session, atMs);
  if (current.status === 'between') return current;
  if (current.status !== 'running') throw new Error('Поставить на паузу можно только текущий шаг.');
  return immutable({ ...current, status: 'paused', events: [...current.events, { type: 'pause', atMs, reason }] });
}

export function resumeRouteSession(session: RouteSession, atMs: number): RouteSession {
  const current = advanceRouteSession(session, atMs);
  if (current.status !== 'paused') throw new Error('Продолжить можно только шаг на паузе.');
  return immutable({ ...current, status: 'running', events: [...current.events, { type: 'resume', atMs, reason: null }] });
}

export function nextRouteStep(session: RouteSession, atMs: number): RouteSession {
  const current = advanceRouteSession(session, atMs);
  if (current.status === 'finished') throw new Error('Завершённому маршруту нужен новый старт.');
  const events: RouteEvent[] = [...current.events, { type: 'next', atMs, reason: null }];
  if (current.stepIndex === 2) return immutable({ ...current, status: 'finished', finishReason: 'completed', events });
  return immutable({ ...current, stepIndex: (current.stepIndex + 1) as 1 | 2, status: 'running', events });
}

export function stopRouteSession(session: RouteSession, atMs: number): RouteSession {
  const current = advanceRouteSession(session, atMs);
  if (current.status === 'finished') return current;
  return immutable({ ...current, status: 'finished', finishReason: 'stopped', events: [...current.events, { type: 'stop', atMs, reason: null }] });
}

export function getRouteResult(session: RouteSession, atMs = session.asOfMs): RouteResult { return advanceRouteSession(session, atMs); }

function sameEvent(a: RouteEvent, b: RouteEvent) {
  return a.type === b.type && a.atMs === b.atMs && a.reason === b.reason;
}

/** All saved durations/statuses can be independently derived from controls and the observation time. */
export function replayRouteResult(input: { readonly id: string; readonly events: readonly RouteEvent[]; readonly asOfMs: number }): RouteResult {
  if (!Array.isArray(input.events) || !input.events.length) throw new RangeError('В маршруте отсутствует событие старта.');
  let result = startRouteSession({ id: input.id });
  if (!sameEvent(result.events[0], input.events[0])) throw new RangeError('Первое событие маршрута должно быть стартом в момент 0.');
  let index = 1;
  while (index < input.events.length) {
    const event = input.events[index];
    if (!event || !Number.isSafeInteger(event.atMs) || (event.reason !== null && event.reason !== 'manual' && event.reason !== 'hidden')) throw new RangeError('Некорректное событие маршрута.');
    if (event.type !== 'pause' && event.reason !== null) throw new RangeError('Причина задаётся только для паузы.');
    if (event.type === 'boundary') {
      const before = result.events.length;
      result = advanceRouteSession(result, event.atMs);
      if (result.events.length === before) throw new RangeError('Граница шага не соответствует активному времени.');
    } else if (event.type === 'pause') {
      if (event.reason === null) throw new RangeError('Нужна причина паузы.');
      result = pauseRouteSession(result, event.atMs, event.reason);
    } else if (event.type === 'resume') result = resumeRouteSession(result, event.atMs);
    else if (event.type === 'next') result = nextRouteStep(result, event.atMs);
    else if (event.type === 'stop') result = stopRouteSession(result, event.atMs);
    else throw new RangeError('Неизвестное или повторное событие старта.');
    if (result.events.length <= index || result.events.length > input.events.length || result.events.some((actual, offset) => !sameEvent(actual, input.events[offset]))) throw new RangeError('Порядок событий маршрута не соответствует таймеру.');
    index = result.events.length;
  }
  result = advanceRouteSession(result, input.asOfMs);
  if (result.events.length !== input.events.length || result.events.some((event, offset) => !sameEvent(event, input.events[offset])) || result.asOfMs !== input.asOfMs) throw new RangeError('Время снимка маршрута не соответствует событиям.');
  return result;
}
