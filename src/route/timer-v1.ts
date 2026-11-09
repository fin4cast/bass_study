import type { RouteMaterial, RoutePauseReason, RouteSessionLink, RouteStatus } from './index';

/** Version 1 rules also validate timers already stored in history. */
export interface RouteEvent {
  readonly type: 'start' | 'pause' | 'resume' | 'next' | 'stop' | 'boundary';
  readonly atMs: number;
  readonly reason: RoutePauseReason | null;
}
export interface RouteResult {
  readonly material: RouteMaterial | null;
  readonly sessionLinks: readonly RouteSessionLink[];
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
  if (!Object.isFrozen(result.sessionLinks)) { result.sessionLinks.forEach(Object.freeze); Object.freeze(result.sessionLinks); }
  Object.freeze(result.plannedStepMs);
  Object.freeze(result.actualStepMs);
  if (!Object.isFrozen(result.events)) { result.events.forEach(Object.freeze); Object.freeze(result.events); }
  return Object.freeze(result);
}

function atTime(session: RouteSession, atMs: number) {
  if (!Number.isSafeInteger(atMs) || atMs < session.asOfMs) throw new RangeError('Время маршрута должно быть целым, неотрицательным и монотонным.');
}

export function createRouteTimerV1(config: { readonly id: string; readonly material: RouteMaterial | null; readonly sessionLinks?: readonly RouteSessionLink[] }): RouteSession {
  if (typeof config.id !== 'string' || !config.id.trim() || config.id.length > 120) throw new RangeError('Маршруту нужен устойчивый идентификатор.');
  const sessionLinks = (config.sessionLinks ?? []).map(link => {
    if (!link || !['screen', 'ear', 'manual'].includes(link.kind) || !['fretboard', 'ear', 'sequence'].includes(link.step) || typeof link.id !== 'string' || !link.id.trim() || link.id.length > 160) throw new RangeError('Неверная связь занятия с маршрутом.');
    return { id: link.id, kind: link.kind, step: link.step };
  });
  if (new Set(sessionLinks.map(link => link.id)).size !== sessionLinks.length) throw new RangeError('Занятия маршрута не должны дублироваться.');
  return immutable({ id: config.id, material: config.material, sessionLinks, kind: 'route', source: 'active-timer', plannedStepMs: [180000, 180000, 240000], actualStepMs: [0, 0, 0],
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
export function linkRouteSession(session: RouteSession, link: RouteSessionLink): RouteSession {
  const checked = createRouteTimerV1({ id: session.id, material: session.material, sessionLinks: [...session.sessionLinks.filter(item => item.id !== link.id), link] });
  return immutable({ ...session, sessionLinks: checked.sessionLinks });
}

function sameEvent(a: RouteEvent, b: RouteEvent | undefined) {
  return b !== undefined && a.type === b.type && a.atMs === b.atMs && a.reason === b.reason;
}

/** All saved durations/statuses can be independently derived from controls and the observation time. */
export function replayRouteTimerV1(initial: RouteSession, input: { readonly events: readonly RouteEvent[]; readonly asOfMs: number }): RouteResult {
  if (!Array.isArray(input.events) || !input.events.length) throw new RangeError('В маршруте отсутствует событие старта.');
  let result = initial;
  if (!sameEvent(result.events[0], input.events[0])) throw new RangeError('Первое событие маршрута должно быть стартом в момент 0.');
  const events = [...result.events];
  let index = 1;
  while (index < input.events.length) {
    const event = input.events[index];
    if (!event || !Number.isSafeInteger(event.atMs) || (event.reason !== null && event.reason !== 'manual' && event.reason !== 'hidden')) throw new RangeError('Некорректное событие маршрута.');
    if (event.type !== 'pause' && event.reason !== null) throw new RangeError('Причина задаётся только для паузы.');
    // Run the same transition as live timing, with only its newly emitted events.
    result = { ...result, events: [] };
    if (event.type === 'boundary') {
      result = advanceRouteSession(result, event.atMs);
      if (result.events.length === 0) throw new RangeError('Граница шага не соответствует активному времени.');
    } else if (event.type === 'pause') {
      if (event.reason === null) throw new RangeError('Нужна причина паузы.');
      result = pauseRouteSession(result, event.atMs, event.reason);
    } else if (event.type === 'resume') result = resumeRouteSession(result, event.atMs);
    else if (event.type === 'next') result = nextRouteStep(result, event.atMs);
    else if (event.type === 'stop') result = stopRouteSession(result, event.atMs);
    else throw new RangeError('Неизвестное или повторное событие старта.');
    if (result.events.length === 0) throw new RangeError('Порядок событий маршрута не соответствует таймеру.');
    for (const actual of result.events) {
      if (!sameEvent(actual, input.events[index++])) throw new RangeError('Порядок событий маршрута не соответствует таймеру.');
      events.push(actual);
    }
  }
  result = advanceRouteSession({ ...result, events: [] }, input.asOfMs);
  if (result.events.length !== 0 || result.asOfMs !== input.asOfMs) throw new RangeError('Время снимка маршрута не соответствует событиям.');
  return immutable({ ...result, events });
}
