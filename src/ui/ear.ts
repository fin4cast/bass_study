import './ear.css';
import { createAudioCue } from '../audio/cue';
import {
  beginEarListen, cancelEarListen, completeEarListen, getEarAudioEvents, getEarSummary,
  nextEarQuestion, revealEarAnswer, skipEarQuestion, startEarSession, submitEarAnswer,
  type EarDegree, type EarQuality, type EarSession,
} from '../ear';

export interface EarPreferences { readonly root: string; readonly quality: EarQuality; readonly count: number; readonly bpm: number }
export interface EarOptions {
  readonly onPreferencesChange?: () => void;
  readonly onSessionChanged?: (session: EarSession) => void;
  readonly onSessionFinished?: (session: EarSession) => void;
  readonly onBeforeListen?: () => void;
}

const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ROOT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, mark => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[mark]!);

/** The target stays inside the controller/domain until an answer has been completed or revealed. */
export function mountEar(container: HTMLElement, options: EarOptions = {}) {
  let preferences: EarPreferences = { root: 'C', quality: 'major', count: 10, bpm: 80 };
  const drafts: { count: string | null; bpm: string | null } = { count: null, bpm: null };
  let session: EarSession | null = null;
  let summary: ReturnType<typeof getEarSummary> | null = null;
  let summaryTitle = 'Слуховое занятие завершено';
  let summaryContext = '';
  let questionStartedAt = 0;
  let listening: { token: number; runId: number | null; listenId: string } | null = null;
  let token = 0;
  let needsListen = true;
  let visible = !container.hidden;
  let disposed = false;
  let error = '';
  let notice = '';
  const wrong = new Set<EarDegree>();
  const controller = new AbortController();

  const cue = createAudioCue({ onComplete(runId) {
    if (disposed || !session || !listening || listening.runId !== runId) return;
    const current = listening;
    if (current.token !== token || session.answerState.activeListen?.id !== current.listenId) return;
    try {
      session = completeEarListen(session, elapsed(), current.listenId);
      listening = null;
      needsListen = false;
      options.onSessionChanged?.(session);
      render();
      container.querySelector<HTMLButtonElement>('[data-ear-choice]:not(:disabled)')?.focus();
    } catch (failure) { fail(failure); }
  } });

  container.classList.add('ear-section');
  const elapsed = () => Math.max(session?.answerState.lastEventMs ?? 0, performance.now() - questionStartedAt);
  const describe = () => `${ROOT_NAMES[ROOTS.indexOf(preferences.root)]} · ${preferences.quality === 'major' ? 'мажорное' : 'минорное'} трезвучие`;

  function fail(failure: unknown) {
    error = failure instanceof Error ? failure.message : String(failure);
    render();
  }

  function validNumber(raw: string, min: number, max: number, message: string) {
    const value = Number(raw);
    if (!raw || !Number.isInteger(value) || value < min || value > max) throw new RangeError(message);
    return value;
  }

  function getPreferences(): EarPreferences {
    const count = validNumber(drafts.count ?? String(preferences.count), 1, 20, 'Слуховых вопросов должно быть от 1 до 20.');
    const bpm = validNumber(drafts.bpm ?? String(preferences.bpm), 60, 120, 'Темп прослушивания — целое число от 60 до 120 BPM.');
    return { ...preferences, count, bpm };
  }

  function stopAudio(reason = '', notify = true) {
    ++token;
    cue.stop();
    listening = null;
    if (session?.answerState.activeListen) {
      session = cancelEarListen(session, elapsed(), session.answerState.activeListen.id);
      if (notify) options.onSessionChanged?.(session);
    }
    needsListen = true;
    if (reason) notice = reason;
  }

  function finishCurrentSession(title = 'Слуховое занятие завершено') {
    if (!session) { stopAudio(); return; }
    const focusWasInside = container.contains(document.activeElement);
    stopAudio('', false);
    const archived = session.status === 'review' ? nextEarQuestion(session) : session;
    summary = getEarSummary(archived);
    summaryContext = describe();
    summaryTitle = title;
    options.onSessionChanged?.(archived);
    options.onSessionFinished?.(archived);
    session = null;
    wrong.clear();
    render();
    if (focusWasInside && visible) container.querySelector<HTMLElement>('.ear-summary h3')?.focus({ preventScroll: true });
  }

  function render() {
    if (disposed) return;
    const count = drafts.count ?? String(preferences.count);
    const bpm = drafts.bpm ?? String(preferences.bpm);
    const invalidCount = !count || !Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > 20;
    const invalidBpm = !bpm || !Number.isInteger(Number(bpm)) || Number(bpm) < 60 || Number(bpm) > 120;
    const state = session?.answerState;
    const terminal = session?.status === 'review';
    const activeListen = state?.activeListen !== null && state?.activeListen !== undefined;
    const readyToAnswer = session?.status === 'active' && !activeListen && !needsListen && state?.firstListenCompletedAtMs !== null;
    const reveal = state?.outcome === 'correct' || state?.outcome === 'corrected' || state?.outcome === 'revealed';
    const summaryMarkup = summary ? `<div class="ear-summary" data-testid="ear-summary"><p class="eyebrow">РЕЗУЛЬТАТ ОТВЕТОВ ПОСЛЕ ПРОСЛУШИВАНИЯ</p><h3 tabindex="-1">${escapeHtml(summaryTitle)}</h3><p>${escapeHtml(summaryContext)} · завершено ${summary.completed} из ${summary.total}. Это выбор ступени на экране, не оценка реальной игры.</p><div class="ear-summary-grid">${([
      ['independentCorrect', 'Самостоятельно'], ['corrected', 'С исправлением'], ['errors', 'Ошибочных ответов'], ['hints', 'Ответов показано'], ['skipped', 'Пропущено'], ['replayCount', 'Полных повторов'],
    ] as const).map(([key, label]) => `<div><strong data-ear-result="${key}">${summary![key]}</strong><span>${label}</span></div>`).join('')}</div><p>Повтор звука учитывается отдельно от показа ответа и ошибки. Полных прослушиваний: ${summary.completedListens}.</p></div>` : '<div class="ear-ready"><span aria-hidden="true">♪</span><div><h3>Сначала услышь опору</h3><p>Тоника → пауза → целевой звук. Затем выбери: тоника, терция или квинта. Карту грифа мы покажем после выхода из задания.</p></div></div>';
    container.innerHTML = `<div class="ear-heading"><div><p class="eyebrow">СЛУХ В ТОНАЛЬНОСТИ</p><h2>Услышь связь с тоникой.</h2></div><p>Сравни два звука трезвучия.<br>Ответь ступенью, а не названием ноты.</p></div>
      <div class="ear-settings"><label class="ear-field"><span>Тоника</span><select aria-label="Тоника слухового задания" data-ear-setting="root">${ROOTS.map((root, index) => `<option value="${root}"${root === preferences.root ? ' selected' : ''}>${ROOT_NAMES[index]}</option>`).join('')}</select></label><label class="ear-field"><span>Трезвучие</span><select aria-label="Трезвучие для слуха" data-ear-setting="quality"><option value="major"${preferences.quality === 'major' ? ' selected' : ''}>Мажорное · 1–3–5</option><option value="minor"${preferences.quality === 'minor' ? ' selected' : ''}>Минорное · 1–♭3–5</option></select></label><label class="ear-field ear-number-field"><span>Вопросов</span><input type="number" min="1" max="20" step="1" aria-label="Слуховых вопросов" aria-invalid="${invalidCount}" data-ear-setting="count" value="${escapeHtml(count)}"></label><label class="ear-field ear-number-field"><span>Темп прослушивания</span><input type="number" min="60" max="120" step="1" aria-label="Темп прослушивания" aria-invalid="${invalidBpm}" data-ear-setting="bpm" value="${escapeHtml(bpm)}"></label><button class="primary-button" type="button" data-ear-action="start">${session ? 'Начать заново' : 'Начать слуховое занятие'}<span aria-hidden="true">→</span></button></div>
      <p class="ear-description">${escapeHtml(describe())}. Звуки звучат в фиксированном регистре; фильтры исследовательского грифа на это задание не влияют.</p>
      ${notice ? `<p class="ear-notice" role="status" data-testid="ear-notice">${escapeHtml(notice)}</p>` : ''}${error ? `<p class="ear-error" role="alert" data-testid="ear-error">${escapeHtml(error)}</p>` : ''}
      ${session ? `<div class="ear-question" data-testid="ear-question"><div class="ear-progress"><span>Вопрос <strong>${session.questionIndex + 1}</strong> из ${session.questions.length}</span><button class="text-button" type="button" data-ear-action="finish">Завершить занятие</button></div><h3 tabindex="-1" data-testid="ear-prompt">Какая ступень прозвучала после тоники?</h3><div class="ear-sound-path" aria-hidden="true"><span>Тоника</span><i>→</i><span>Пауза</span><i>→</i><span>Целевой звук</span></div><div class="ear-listen-controls"><button class="primary-button" type="button" data-ear-action="listen"${activeListen || terminal ? ' disabled' : ''}><span aria-hidden="true">▶</span>${(state?.listensCompleted ?? 0) > 0 ? 'Послушать ещё раз' : 'Прослушать'}</button><button class="secondary-button" type="button" data-ear-action="stop"${activeListen ? '' : ' disabled'}>Остановить звук</button><span class="ear-listen-status" role="status" data-testid="ear-listen-status">${activeListen ? 'Слушаем… Ответы откроются после окончания звука.' : terminal ? 'Вопрос завершён' : readyToAnswer ? 'Можно выбрать ступень' : 'Сначала прослушай оба звука до конца'}</span></div><div class="ear-answers" role="group" aria-label="Услышанная ступень">${session.currentQuestion.choices.map(choice => `<button class="ear-answer${wrong.has(choice.id) ? ' was-wrong' : ''}${reveal && choice.id === session!.currentQuestion.targetDegree ? ' is-correct' : ''}" type="button" data-ear-choice="${choice.id}"${readyToAnswer ? '' : ' disabled'}><strong>${escapeHtml(choice.label)}</strong><span>${choice.id === '1' ? 'Тоника' : choice.id === '5' ? 'Квинта' : 'Терция'}</span></button>`).join('')}</div><p class="ear-feedback" role="status" aria-live="polite" data-testid="ear-feedback">${escapeHtml(state?.feedback ?? '')}</p><p class="ear-listen-counts">Полных прослушиваний: <strong data-testid="ear-completed-listens">${state?.listensCompleted ?? 0}</strong> · полных повторов: <strong data-testid="ear-replay-count">${Math.max(0, (state?.listensCompleted ?? 0) - 1)}</strong>${state?.listensCancelled ? ` · остановлено: ${state.listensCancelled}` : ''}</p><div class="ear-actions"><div><button class="secondary-button" type="button" data-ear-action="reveal"${terminal ? ' disabled' : ''}>Показать ответ</button><button class="text-button" type="button" data-ear-action="skip"${terminal ? ' disabled' : ''}>Пропустить</button></div>${terminal ? `<button class="primary-button" type="button" data-ear-action="next">${session.questionIndex + 1 === session.questions.length ? 'Посмотреть результат' : 'Следующий вопрос'}<span aria-hidden="true">→</span></button>` : '<span>Повтор звука и показ ответа учитываются по-разному.</span>'}</div></div>` : summaryMarkup}`;
  }

  function start() {
    try {
      const next = getPreferences();
      const created = startEarSession({ ...next, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
      finishCurrentSession('Предыдущее слуховое занятие завершено');
      preferences = next; drafts.count = null; drafts.bpm = null;
      session = created; summary = null; notice = ''; error = ''; wrong.clear();
      questionStartedAt = performance.now(); needsListen = true;
      render();
      container.querySelector<HTMLElement>('[data-testid="ear-prompt"]')?.focus();
      options.onPreferencesChange?.();
    } catch (failure) { fail(failure); }
  }

  async function listen() {
    if (!session || session.status !== 'active' || session.answerState.activeListen || !visible || document.hidden) return;
    let attemptToken: number | null = null;
    try {
      const next = getPreferences();
      options.onBeforeListen?.();
      session = beginEarListen(session, elapsed(), next.bpm);
      const listenId = session.answerState.activeListen!.id;
      const expectedToken = ++token;
      attemptToken = expectedToken;
      listening = { token: expectedToken, runId: null, listenId };
      needsListen = true; error = ''; notice = '';
      options.onSessionChanged?.(session);
      render();
      const plan = getEarAudioEvents(session.currentQuestion, next.bpm);
      const scheduled = await cue.play({ bpm: plan.bpm, totalBeats: plan.totalBeats, notes: plan.events.filter(event => event.midi !== null).map(event => ({ midi: event.midi!, beat: event.atBeat, durationBeats: event.durationBeats })) });
      if (disposed || expectedToken !== token || !listening) return;
      listening.runId = scheduled.runId;
    } catch (failure) {
      if (disposed || (attemptToken !== null && attemptToken !== token)) return;
      stopAudio(); fail(failure);
    }
  }

  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const choice = target?.closest<HTMLButtonElement>('[data-ear-choice]');
    if (choice && session && !needsListen && !session.answerState.activeListen) {
      try {
        session = submitEarAnswer(session, choice.dataset.earChoice as EarDegree, elapsed());
        if (session.status === 'active') wrong.add(choice.dataset.earChoice as EarDegree);
        options.onSessionChanged?.(session);
        render();
        container.querySelector<HTMLButtonElement>(session.status === 'review' ? '[data-ear-action="next"]' : `[data-ear-choice="${choice.dataset.earChoice}"]`)?.focus();
      } catch (failure) { fail(failure); }
      return;
    }
    const action = target?.closest<HTMLButtonElement>('[data-ear-action]')?.dataset.earAction;
    if (action === 'start') { start(); return; }
    if (action === 'listen') { void listen(); return; }
    if (action === 'stop') { stopAudio('Звук остановлен. Для ответа прослушай оба звука заново.'); render(); container.querySelector<HTMLButtonElement>('[data-ear-action="listen"]')?.focus(); return; }
    if (action === 'finish') { finishCurrentSession(); return; }
    if (!session) return;
    try {
      if (action === 'reveal' || action === 'skip') {
        stopAudio();
        session = action === 'reveal' ? revealEarAnswer(session, elapsed()) : skipEarQuestion(session, elapsed());
      }
      if (action === 'next') {
        session = nextEarQuestion(session);
        if (session.status === 'finished') { finishCurrentSession(); return; }
        questionStartedAt = performance.now(); needsListen = true; wrong.clear(); notice = ''; error = '';
      }
      if (action) { options.onSessionChanged?.(session); render(); container.querySelector<HTMLElement>(action === 'next' ? '[data-testid="ear-prompt"]' : '[data-ear-action="next"]')?.focus(); }
    } catch (failure) { fail(failure); }
  }, { signal: controller.signal });

  container.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !['count', 'bpm'].includes(input.dataset.earSetting ?? '')) return;
    const setting = input.dataset.earSetting as 'count' | 'bpm';
    drafts[setting] = input.value;
    const wasActive = session !== null;
    if (wasActive) {
      finishCurrentSession('Параметры слухового задания изменились');
      container.querySelector<HTMLInputElement>(`[data-ear-setting="${setting}"]`)?.focus();
    } else input.setAttribute('aria-invalid', String(!input.validity.valid || !input.value));
  }, { signal: controller.signal });

  container.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) || !input.dataset.earSetting) return;
    try {
      if (session) finishCurrentSession('Параметры слухового задания изменились');
      if (input.dataset.earSetting === 'root') preferences = { ...preferences, root: input.value };
      if (input.dataset.earSetting === 'quality') preferences = { ...preferences, quality: input.value as EarQuality };
      preferences = getPreferences(); drafts.count = null; drafts.bpm = null; error = '';
      render();
      container.querySelector<HTMLElement>(`[data-ear-setting="${input.dataset.earSetting}"]`)?.focus();
      options.onPreferencesChange?.();
    } catch (failure) { fail(failure); }
  }, { signal: controller.signal });

  document.addEventListener('visibilitychange', () => {
    if (!visible || !document.hidden || !session || session.status !== 'active') return;
    stopAudio('Вкладка скрывалась. Прослушай оба звука заново, когда вернёшься.');
    render();
  }, { signal: controller.signal });

  render();
  return {
    getPreferences,
    applyPreferences(next: EarPreferences) {
      if (!ROOTS.includes(next.root) || !['major', 'minor'].includes(next.quality)) throw new RangeError('Некорректные настройки слухового задания.');
      validNumber(String(next.count), 1, 20, 'Слуховых вопросов должно быть от 1 до 20.');
      validNumber(String(next.bpm), 60, 120, 'Темп прослушивания — целое число от 60 до 120 BPM.');
      finishCurrentSession('Настройки слухового задания изменились');
      preferences = { ...next }; drafts.count = null; drafts.bpm = null;
      summary = null; notice = ''; error = ''; render();
    },
    setVisible(next: boolean) {
      if (visible && !next) finishCurrentSession('Слуховое занятие прервано при смене режима');
      visible = next; container.hidden = !next;
    },
    stop(reason = 'Слуховое занятие прервано') { finishCurrentSession(reason); },
    pauseListening(reason = 'Прослушивание на паузе. Для ответа послушай оба звука заново.') { stopAudio(reason); render(); },
    finishCurrentSession,
    dispose() {
      if (disposed) return;
      finishCurrentSession('Раздел слуха закрыт');
      disposed = true; controller.abort();
      void cue.dispose(); container.innerHTML = '';
    },
  };
}
