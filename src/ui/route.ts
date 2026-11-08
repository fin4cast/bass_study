import './route.css';
import {
  ROUTE_STEPS, advanceRouteSession, getRouteResult, nextRouteStep, pauseRouteSession,
  resumeRouteSession, startRouteSession, stopRouteSession, type RouteResult, type RouteSession,
} from '../route';

export type RouteStep = typeof ROUTE_STEPS[number]['id'];
export interface RouteOptions {
  readonly onGo: (step: RouteStep) => void;
  readonly onPause: () => void;
  readonly onSessionChanged: (result: RouteResult) => void;
  readonly onSessionFinished?: (result: RouteResult) => void;
}

function timeText(milliseconds: number, remaining = false) {
  const seconds = Math.max(0, remaining ? Math.ceil(milliseconds / 1000) : Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The clock counts an explicitly running block, never instrument accuracy or attention. */
export function mountRoute(container: HTMLElement, barContainer: HTMLElement, options: RouteOptions) {
  let session: RouteSession | null = null;
  let clockOrigin = 0;
  let lastPersistAtMs = 0;
  let disposed = false;
  let frame: number;
  let barSignature = '';
  const controller = new AbortController();
  container.classList.add('route-section');
  barContainer.classList.add('route-session-host');
  barContainer.hidden = true;
  const now = () => session ? Math.max(session.asOfMs, Math.floor(performance.now() - clockOrigin)) : 0;
  const total = () => session?.actualStepMs.reduce((sum, value) => sum + value, 0) ?? 0;
  const stepActions: Record<RouteStep, string> = { fretboard: 'Открыть карту', ear: 'Слушать ступени', sequence: 'Практика под клик' };

  function publish(finished = false) {
    if (!session) return;
    lastPersistAtMs = session.asOfMs;
    options.onSessionChanged(getRouteResult(session));
    if (finished) options.onSessionFinished?.(getRouteResult(session));
  }

  function page() {
    const active = session && session.status !== 'finished';
    container.innerHTML = `<div class="route-heading"><p class="eyebrow">10 АКТИВНЫХ МИНУТ</p><h2>Посмотри. Услышь. Сыграй.</h2><p>План: 3 минуты грифа, 3 минуты слуха и 4 минуты практики. Паузы и ожидание следующего шага не входят в это время.</p></div><ol class="route-steps">${ROUTE_STEPS.map((step, index) => `<li class="${active && session!.stepIndex === index ? 'is-current' : ''}" data-route-planned-ms="${step.plannedMs}"><span class="route-number">0${index + 1}</span><h3>${step.name} <small>${step.plannedMs / 60000} мин</small></h3><p>${step.instruction}</p><div class="route-step-time">Фактически: <strong data-route-actual="${index}">${timeText(session?.actualStepMs[index] ?? 0)}</strong></div><button class="secondary-button" type="button" data-route-step="${step.id}">${stepActions[step.id]} <span aria-hidden="true">→</span></button></li>`).join('')}</ol><div class="route-plan-actions"><button class="primary-button" type="button" data-route-action="start">${active ? 'Начать маршрут заново' : 'Начать маршрут'}<span aria-hidden="true">→</span></button>${active ? `<button class="secondary-button" type="button" data-route-action="${session!.status === 'paused' ? 'resume' : session!.status === 'between' ? 'next' : 'go'}">${session!.status === 'paused' ? 'Продолжить текущий шаг' : session!.status === 'between' ? session!.stepIndex === 2 ? 'Завершить маршрут' : 'Следующий шаг' : 'Вернуться к текущему шагу'}</button>` : ''}</div>${session?.status === 'finished' ? `<p class="route-finished-note" role="status">${session.finishReason === 'stopped' ? 'Маршрут остановлен.' : total() < 600000 ? 'Маршрут завершён досрочно.' : 'Маршрут завершён.'} Активное время: <strong data-route-total>${timeText(total())}</strong> из плановых 10:00. Ранний переход сохраняет фактическое время.</p>` : ''}<p class="route-note">Таймер считает время выбранного шага до паузы. Он не определяет внимание, реальную игру или правильность исполнения. На границе блока практика остановится и дождётся твоего перехода.</p>`;
  }

  function bar() {
    if (!session) { barContainer.hidden = true; return; }
    barContainer.hidden = false;
    const step = ROUTE_STEPS[session.stepIndex];
    const signature = `${session.id}/${session.stepIndex}/${session.status}/${session.finishReason ?? ''}`;
    if (signature !== barSignature) {
      const focusedAction = barContainer.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.routeAction : undefined;
      barSignature = signature;
      const hiddenPause = session.events.at(-1)?.type === 'pause' && session.events.at(-1)?.reason === 'hidden';
      const status = session.status === 'running' ? 'Шаг идёт' : session.status === 'paused' ? hiddenPause ? 'Пауза: вкладка скрывалась — продолжи явно' : 'Пауза — продолжи явно, когда будешь готов' : session.status === 'between' ? session.stepIndex === 2 ? 'Последний блок завершён — подтверди окончание' : 'Время шага завершено — выбери следующий' : session.finishReason === 'stopped' ? 'Маршрут остановлен' : total() < 600000 ? 'Завершён досрочно' : 'Маршрут завершён';
      barContainer.innerHTML = `<aside class="route-session-bar" aria-label="Текущее занятие по маршруту" data-testid="route-session-bar"><div class="route-bar-heading"><span class="eyebrow">МАРШРУТ · ШАГ ${session.stepIndex + 1} ИЗ 3</span><strong>${step.name}</strong><span data-testid="route-status" role="status">${status}</span></div><div class="route-bar-time"><span>${session.status === 'finished' ? 'Активное время' : 'Осталось в шаге'}</span><strong data-testid="route-remaining"></strong><small>Всего <span data-route-total></span> / 10:00</small></div><div class="route-bar-actions">${session.status === 'finished' ? '<button class="secondary-button" type="button" data-route-action="start">Новый маршрут</button>' : `${session.status === 'running' ? '<button class="secondary-button" type="button" data-route-action="pause">Пауза маршрута</button>' : session.status === 'paused' ? '<button class="secondary-button" type="button" data-route-action="resume">Продолжить маршрут</button>' : ''}<button class="secondary-button" type="button" data-route-action="next">${session.stepIndex === 2 ? 'Завершить маршрут' : 'Следующий шаг'}</button><button class="text-button" type="button" data-route-action="stop">Остановить маршрут</button>`}</div></aside>`;
      if (focusedAction) barContainer.querySelector<HTMLButtonElement>(`[data-route-action="${focusedAction}"]`)?.focus({ preventScroll: true });
      if (focusedAction && !barContainer.contains(document.activeElement)) barContainer.querySelector<HTMLButtonElement>('[data-route-action]')?.focus({ preventScroll: true });
    }
    for (const target of [barContainer, barContainer.querySelector<HTMLElement>('[data-testid="route-session-bar"]')!]) {
      target.dataset.routeState = session.status;
      target.dataset.routeStep = step.id;
      target.dataset.routeActiveMs = String(total());
    }
    const remaining = session.status === 'finished' ? total() : session.plannedStepMs[session.stepIndex] - session.actualStepMs[session.stepIndex];
    const remainingOutput = barContainer.querySelector<HTMLElement>('[data-testid="route-remaining"]')!;
    const remainingText = timeText(remaining, session.status !== 'finished');
    if (remainingOutput.textContent !== remainingText) remainingOutput.textContent = remainingText;
    for (const element of [...barContainer.querySelectorAll<HTMLElement>('[data-route-total]'), ...container.querySelectorAll<HTMLElement>('[data-route-total]')]) if (element.textContent !== timeText(total())) element.textContent = timeText(total());
    container.querySelectorAll<HTMLElement>('[data-route-actual]').forEach(element => {
      const value = timeText(session!.actualStepMs[Number(element.dataset.routeActual)]);
      if (element.textContent !== value) element.textContent = value;
    });
  }

  function advance(persistCheckpoint = true) {
    if (!session || session.status !== 'running') return;
    session = advanceRouteSession(session, now());
    if (session.status === 'between') {
      options.onPause();
      page(); bar(); publish();
    } else {
      bar();
      if (persistCheckpoint && session.asOfMs - lastPersistAtMs >= 5000) publish();
    }
  }

  function stop() {
    if (!session || session.status === 'finished') return;
    session = stopRouteSession(session, now());
    options.onPause();
    page(); bar(); publish(true);
  }

  function start() {
    stop();
    options.onPause();
    session = startRouteSession({ id: crypto.randomUUID() });
    clockOrigin = performance.now(); lastPersistAtMs = 0; barSignature = '';
    page(); bar(); publish();
    options.onGo(ROUTE_STEPS[0].id);
  }

  function pause(reason: 'manual' | 'hidden' = 'manual') {
    if (!session || session.status !== 'running') return;
    session = pauseRouteSession(session, now(), reason);
    options.onPause();
    page(); bar(); publish();
  }

  function resume() {
    if (!session || session.status !== 'paused') return;
    session = resumeRouteSession(session, now());
    page(); bar(); publish();
    options.onGo(ROUTE_STEPS[session.stepIndex].id);
  }

  function next() {
    if (!session || session.status === 'finished') return;
    session = nextRouteStep(session, now());
    options.onPause();
    page(); bar(); publish(session.status === 'finished');
    if (session.status !== 'finished') options.onGo(ROUTE_STEPS[session.stepIndex].id);
  }

  function action(event: Event) {
    const navigation = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-route-step]')?.dataset.routeStep : undefined;
    if (ROUTE_STEPS.some(step => step.id === navigation)) {
      pause();
      options.onGo(navigation as RouteStep);
      return;
    }
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-route-action]') : null;
    const value = target?.dataset.routeAction;
    if (value === 'start') start();
    else if (value === 'pause') pause();
    else if (value === 'resume') resume();
    else if (value === 'next') next();
    else if (value === 'stop') stop();
    else if (value === 'go' && session && session.status !== 'finished') options.onGo(ROUTE_STEPS[session.stepIndex].id);
  }

  container.addEventListener('click', action, { signal: controller.signal });
  barContainer.addEventListener('click', action, { signal: controller.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('hidden'); }, { signal: controller.signal });
  function draw() {
    if (disposed) return;
    advance();
    frame = requestAnimationFrame(draw);
  }
  page();
  frame = requestAnimationFrame(draw);
  return {
    stop, pause,
    getSession() { advance(false); return session ? getRouteResult(session) : null; },
    dispose() {
      if (disposed) return;
      stop(); disposed = true;
      cancelAnimationFrame(frame); controller.abort();
      container.innerHTML = ''; barContainer.innerHTML = ''; barContainer.hidden = true;
    },
  };
}
