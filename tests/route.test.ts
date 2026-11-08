import { describe, expect, it } from 'vitest';
import { advanceRouteSession, getRouteResult, nextRouteStep, pauseRouteSession, replayRouteResult, resumeRouteSession, startRouteSession, stopRouteSession } from '../src/route';

const start = () => startRouteSession({ id: 'independent-route' });
const replay = (session: ReturnType<typeof start>) => replayRouteResult({ id: session.id, events: session.events, asOfMs: session.asOfMs });

describe('активный маршрут 3 + 3 + 4 минуты', () => {
  it('задаёт 600 секунд и не начисляет время вперёд', () => {
    const session = start();
    expect(session.plannedStepMs).toEqual([180000, 180000, 240000]);
    expect(session.totalPlannedMs).toBe(600000);
    expect(session.actualStepMs).toEqual([0, 0, 0]);
    expect(getRouteResult(session, 45000).actualStepMs).toEqual([45000, 0, 0]);
    expect(session.actualStepMs).toEqual([0, 0, 0]);
  });

  it('считает только активные промежутки, исключая ручную паузу', () => {
    let session = pauseRouteSession(start(), 30000);
    session = advanceRouteSession(session, 90000);
    expect(session.actualStepMs).toEqual([30000, 0, 0]);
    session = resumeRouteSession(session, 100000);
    session = advanceRouteSession(session, 120000);
    expect(session.actualStepMs).toEqual([50000, 0, 0]);
    expect(replay(session)).toEqual(session);
  });

  it('пауза скрытой вкладки требует явного продолжения', () => {
    let session = pauseRouteSession(start(), 5000, 'hidden');
    session = advanceRouteSession(session, 1200000);
    expect(session.status).toBe('paused');
    expect(session.actualStepMs).toEqual([5000, 0, 0]);
    session = resumeRouteSession(session, 1201000);
    session = advanceRouteSession(session, 1206000);
    expect(session.actualStepMs).toEqual([10000, 0, 0]);
    expect(replay(session)).toEqual(session);
  });

  it('поздний кадр обрезает один шаг и не запускает следующий', () => {
    let session = advanceRouteSession(start(), 1000000);
    expect(session.status).toBe('between');
    expect(session.actualStepMs).toEqual([180000, 0, 0]);
    expect(session.events.at(-1)).toEqual({ type: 'boundary', atMs: 180000, reason: null });
    session = nextRouteStep(session, 1100000);
    session = advanceRouteSession(session, 1110000);
    expect(session.actualStepMs).toEqual([180000, 10000, 0]);
    expect(replay(session)).toEqual(session);
  });

  it('ранний переход сохраняет фактические минуты, не плановые', () => {
    let session = nextRouteStep(start(), 20000);
    session = nextRouteStep(session, 40000);
    session = nextRouteStep(session, 50000);
    expect(session.status).toBe('finished');
    expect(session.finishReason).toBe('completed');
    expect(session.actualStepMs).toEqual([20000, 20000, 10000]);
    expect(replay(session)).toEqual(session);
  });

  it('даже последний полный шаг ждёт подтверждения и не считает ожидание', () => {
    let session = nextRouteStep(start(), 180000);
    session = nextRouteStep(session, 360000);
    session = advanceRouteSession(session, 900000);
    expect(session.status).toBe('between');
    expect(session.actualStepMs).toEqual([180000, 180000, 240000]);
    session = nextRouteStep(session, 1000000);
    expect(session.finishReason).toBe('completed');
    expect(replay(session)).toEqual(session);
  });

  it('остановка сохраняет честный частичный итог', () => {
    const session = stopRouteSession(pauseRouteSession(start(), 12345), 80000);
    expect(session.actualStepMs).toEqual([12345, 0, 0]);
    expect(session.finishReason).toBe('stopped');
    expect(stopRouteSession(session, 90000)).toBe(session);
    expect(replay(session)).toEqual(session);
  });

  it('отклоняет обратные, дробные и бесконечные часы', () => {
    const session = advanceRouteSession(start(), 20);
    for (const time of [-1, 19, 20.5, Infinity, NaN]) expect(() => advanceRouteSession(session, time)).toThrow();
    expect(() => resumeRouteSession(session, 30)).toThrow();
  });

  it('восстановление отклоняет фальшивую границу/порядок и отсутствующую границу', () => {
    expect(() => replayRouteResult({ id: 'x', events: [{ type: 'start', atMs: 0, reason: null }, { type: 'boundary', atMs: 100, reason: null }], asOfMs: 100 })).toThrow();
    expect(() => replayRouteResult({ id: 'x', events: [{ type: 'start', atMs: 0, reason: null }], asOfMs: 200000 })).toThrow();
    expect(() => replayRouteResult({ id: 'x', events: [{ type: 'start', atMs: 0, reason: null }, { type: 'resume', atMs: 100, reason: null }], asOfMs: 100 })).toThrow();
    const valid = stopRouteSession(start(), 100);
    expect(() => replayRouteResult({ id: valid.id, events: valid.events, asOfMs: 101 })).toThrow();
  });
});
