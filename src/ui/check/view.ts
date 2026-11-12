/**
 * Экран «Проверь себя» (VIS-02 r1, утверждён как A+B 2026-11-12).
 * A «На грифе» — «Найди …» кликом по позициям; B «Карточки» — «Назови …» и слух.
 * Виды вопросов — задания R-006 по материалу (P13-08): ступени, ноты, все позиции, высота, интервал; повтор ошибок.
 * Правильный ответ живёт только в модели сессии: в DOM и ARIA он появляется после ответа, показа или в итоге.
 * Данные не сохраняются здесь: итог ступеней уходит в `onFinish`, серия прочих видов — в `onScreen`;
 * звук начинается только после `onBeforeListen`.
 */
import '../lesson/mini-board.css';
import { onPageVisibility } from '../page-visibility';
import './check.css';
import { createAudioCue } from '../../audio/cue';
import { getEarAudioEvents } from '../../ear';
import type { CheckSpec } from '../../practice/plan';
import type { CheckOutcome } from '../../practice/results';
import type { QuestionContext, QuizSession } from '../../training';
import { escapeHtml as e } from '../html';
import { CHECK_MINUTES, CONCEPT_LABELS, formatDegree, formatPosition } from '../lesson/material';
import { boardGeometry, boardSvg, BOARD_STRINGS, type BoardNote } from '../lesson/mini-board';
import {
  advance, answerChoice, answerPosition, answersOpen, beginListen, cancelListen, checkMaterial, choiceLabels, completeListen, defaultSettings, degreeAt,
  entries, hardIndices, hasActivity, inQuizArea, INTERVAL_CHOICES, isDegreeKind, lastEventMs, markedPosition, modeFor, noteAt, OUTCOME_LABELS, prompt, QUESTION_KINDS,
  questionCount, questionIndex, recordAnswers, recordsDegrees, retryRun, reveal, revealedAnswer, reviewMaterial, runKind, runStatus, scopeApplies, skip,
  startRun, summarize, summaryRow, wrongFeedback,
  type CheckEntry, type CheckMaterial, type CheckMode, type CheckRun, type CheckSummary, type QuestionKind, type QuestionSettings,
} from './session';

export interface CheckFinishSummary extends CheckSummary {
  /** Видимое активное время серии без скрытой вкладки, мс. */
  readonly activeMs: number;
  /** Вопросов, на которые отвечали с контурами формы на грифе. */
  readonly contour: number;
  readonly retry: boolean;
}
export interface CheckOptions {
  /** Итог вопросов о ступенях по шагу плана — запись «Проверь себя» в истории. */
  readonly onFinish: (summary: CheckFinishSummary, answers: readonly { readonly degree: string; readonly outcome: CheckOutcome; readonly errors: number }[]) => void;
  /**
   * Серия прочих видов вопросов (ноты, все позиции, высота, интервал, повтор ошибок) — экранное задание R-006.
   * Вызывается после каждого закрытого ответа и в итоге с тем же объектом вопросов: одна запись на серию.
   */
  readonly onScreen?: (session: QuizSession) => void;
  readonly onBack: () => void;
  readonly onNextStep: () => void;
  /** Владелец звука разрешает сигнал; `false` — звук не начинается. */
  readonly onBeforeListen?: () => boolean;
}
export interface CheckContext {
  /** Подпись возврата, например «план на сегодня, шаг 4 из 4». */
  readonly backLabel?: string;
  /** Подпись под кнопкой «К следующему шагу плана». */
  readonly nextLabel?: string;
  /** Полный текст кнопки возврата вместо «← Занятие …», например «← Гриф». */
  readonly backText?: string;
  /** Текст главной кнопки итога вместо «К следующему шагу плана →». */
  readonly nextText?: string;
}

const BPM = 80;
const BOARD_WIDTH = 1000;
const BOARD_MARKER = 48;
const STATUS_CLASS: Readonly<Record<CheckOutcome, string>> = { correct: 'ck-st-self', corrected: 'ck-st-fix', revealed: 'ck-st-shown', skipped: 'ck-st-skip', unanswered: 'ck-st-none' };
const isTextField = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"]');
const plural = (count: number, one: string, few: string, many: string) => {
  const a = count % 10, b = count % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

export function mountCheck(container: HTMLElement, options: CheckOptions) {
  const controller = new AbortController();
  const listen = { signal: controller.signal };
  let material: CheckMaterial | null = null;
  let context: CheckContext = {};
  let run: CheckRun | null = null;
  let ear = false;
  let settings: QuestionSettings = { kind: 'find-degree', scope: 'structure', interval: '#4' };
  let seed = 1;
  let retry = false;
  let summaryList: readonly CheckEntry[] | null = null;
  let summaryRun: CheckRun | null = null;
  let summary: CheckFinishSummary | null = null;
  let failure = '';
  let notice = '';
  let feedback = { text: '', tone: '' };
  let wrongPositions = new Set<string>();
  let wrongChoices = new Set<number>();
  let contour = true;
  let contourUsed: boolean[] = [];
  let focusCell = '';
  let questionStartedAt = 0;
  let activeMs = 0;
  let activeSince: number | null = null;
  let visible = !container.hidden;
  let disposed = false;
  let token = 0;
  let listening: { token: number; runId: number | null; listenId: string } | null = null;
  let cueStep = -1;
  let cueTimers: number[] = [];

  const cue = createAudioCue({ onComplete(runId) {
    if (disposed || !run || !listening || listening.runId !== runId || listening.token !== token || run.mode !== 'ear') return;
    const active = run.ear.answerState.activeListen;
    if (!active || active.id !== listening.listenId) return;
    try {
      // Конец сигнала определяют аудиочасы; время вопроса не может быть раньше расчётного конца.
      run = completeListen(run, Math.max(elapsed(), active.minimumEndMs), listening.listenId);
      listening = null; clearCue();
      const listens = run.mode === 'ear' ? run.ear.answerState.listensCompleted : 1;
      feedback = { text: listens > 1 ? `Повтор прослушивания (${listens}) — не ошибка и не показ ответа. Выбери ступень.` : 'Сигнал закончился — выбери ступень.', tone: '' };
      render();
      container.querySelector<HTMLElement>('[data-choice]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
    } catch (error) { fail(error); }
  } });

  container.classList.add('check-view');
  container.innerHTML = `<section class="ck-scene">
      <header class="ck-head" data-ck-head></header>
      <div class="ck-bar" data-ck-bar></div>
      <div class="ck-live" data-ck-live>
        <div class="ck-qarea" data-ck-question></div>
        <div class="ck-actions"><p class="ck-feedback" data-ck-feedback aria-live="polite"></p><div class="ck-buttons" data-ck-buttons></div></div>
      </div>
      <section class="ck-summary" data-ck-summary aria-labelledby="ck-summary-title" hidden></section>
      <p class="ck-sr" role="status" data-ck-status></p>
    </section>`;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const head = $('[data-ck-head]'), bar = $('[data-ck-bar]'), live = $('[data-ck-live]'), question = $('[data-ck-question]');
  const feedbackBox = $('[data-ck-feedback]'), buttons = $('[data-ck-buttons]'), summaryBox = $('[data-ck-summary]'), status = $('[data-ck-status]');

  const elapsed = () => Math.max(run ? lastEventMs(run) : 0, performance.now() - questionStartedAt);
  function fail(error: unknown) { notice = error instanceof Error ? error.message : String(error); render(); }

  /* ---------- Активное время ---------- */
  const counting = () => visible && !document.hidden && !!run && !summary;
  function syncClock() {
    const now = performance.now();
    if (activeSince !== null) { activeMs += now - activeSince; activeSince = null; }
    if (counting()) activeSince = now;
  }

  /* ---------- Звук ---------- */
  function clearCue() { cueTimers.forEach(timer => window.clearTimeout(timer)); cueTimers = []; cueStep = -1; paintCue(); }
  function stopAudio(message = '') {
    ++token;
    cue.stop();
    clearCue();
    if (run && run.mode === 'ear' && run.ear.answerState.activeListen) run = cancelListen(run, elapsed());
    listening = null;
    if (message) feedback = { text: message, tone: '' };
  }
  function paintCue() {
    container.querySelectorAll<HTMLElement>('[data-cue-step]').forEach(item => item.classList.toggle('is-on', Number(item.dataset.cueStep) === cueStep));
  }
  async function playSignal() {
    if (!run || run.mode !== 'ear' || runStatus(run) !== 'active' || run.ear.answerState.activeListen || !visible || document.hidden) return;
    if (options.onBeforeListen && options.onBeforeListen() === false) { feedback = { text: 'Звук сейчас занят другим разделом. Останови его и нажми «Прослушать» ещё раз.', tone: '' }; render(); return; }
    let attempt: number | null = null;
    try {
      run = beginListen(run, elapsed(), BPM);
      if (run.mode !== 'ear') return;
      const listenId = run.ear.answerState.activeListen!.id;
      attempt = ++token;
      listening = { token: attempt, runId: null, listenId };
      feedback = { text: '', tone: '' }; notice = '';
      render();
      container.querySelector<HTMLElement>('[data-act="stop-signal"]')?.focus({ preventScroll: true });
      const plan = getEarAudioEvents(run.ear.currentQuestion, BPM);
      const scheduled = await cue.play({ bpm: plan.bpm, totalBeats: plan.totalBeats, notes: plan.events.filter(event => event.midi !== null).map(event => ({ midi: event.midi!, beat: event.atBeat, durationBeats: event.durationBeats })) });
      if (disposed || attempt !== token || !listening) return;
      listening.runId = scheduled.runId;
      const lead = Math.max(0, ((scheduled.startAt ?? scheduled.audioTime) - scheduled.audioTime) * 1000);
      const beat = 60000 / BPM;
      [0, 1, 2].forEach(step => cueTimers.push(window.setTimeout(() => { cueStep = step; paintCue(); }, lead + step * beat)));
    } catch (error) {
      if (disposed || (attempt !== null && attempt !== token)) return;
      stopAudio(); fail(error);
    }
  }

  /* ---------- Серия ---------- */
  /** Новая серия по текущим материалу, виду вопроса и слуху. */
  function freshRun(mat: CheckMaterial): CheckRun {
    return startRun(mat, modeFor(mat, ear, settings.kind), seed, mat.count, settings);
  }
  /** Экранное задание прочих видов уходит в историю после каждого закрытого ответа и в итоге. */
  function publishScreen(current: CheckRun | null = run) {
    if (!current || current.mode === 'ear' || recordsDegrees(runKind(current))) return;
    try { options.onScreen?.(current.quiz); } catch (error) { notice = error instanceof Error ? error.message : String(error); }
  }
  function begin(nextRun: CheckRun, isRetry: boolean) {
    stopAudio();
    run = nextRun; retry = isRetry; summary = null; summaryList = null; summaryRun = null;
    contourUsed = Array.from({ length: questionCount(nextRun) }, () => false);
    activeMs = 0; activeSince = null;
    resetQuestion();
    syncClock();
    render();
    container.querySelector<HTMLElement>('[data-ck-title]')?.focus({ preventScroll: true });
  }
  function resetQuestion() {
    wrongPositions = new Set(); wrongChoices = new Set(); feedback = { text: '', tone: '' }; notice = '';
    questionStartedAt = performance.now();
    if (material && run?.mode === 'board') {
      const middle = material.positions[Math.floor(material.positions.length / 2)];
      focusCell = middle?.id ?? `G:${material.fretMin}`;
    }
  }
  function finalize() {
    if (!run || !material) return;
    stopAudio();
    syncClock();
    const list = entries(run);
    const base = summarize(run, list);
    summaryList = list; summaryRun = run;
    summary = Object.freeze({ ...base, activeMs: Math.round(activeMs), contour: contourUsed.filter(Boolean).length, retry });
    activeSince = null;
    const finished = run;
    render();
    summaryBox.querySelector<HTMLElement>('[data-act="next-step"]')?.focus({ preventScroll: true });
    if (finished.mode !== 'ear' && !recordsDegrees(runKind(finished))) { publishScreen(finished); if (notice) render(); return; }
    if (!material.spec) return;
    try { options.onFinish(summary, recordAnswers(list)); } catch (error) { notice = error instanceof Error ? error.message : String(error); render(); }
  }
  function markContour() { if (run && run.mode === 'board' && contour) contourUsed[questionIndex(run)] = true; }

  function answerAt(positionId: string) {
    if (!run || !material || run.mode !== 'board' || !answersOpen(run)) return;
    if (run.quiz.answerState.selectedPositionIds.includes(positionId)) { feedback = { text: `${formatPosition(positionId)} уже отмечена.`, tone: '' }; render(); return; }
    if (wrongPositions.has(positionId)) { feedback = { text: `${formatPosition(positionId)} уже проверена — это не ответ.`, tone: '' }; render(); return; }
    markContour();
    const before = run;
    run = answerPosition(run, positionId, elapsed());
    afterAnswer(before, { positionId });
  }
  function answerCard(index: number) {
    if (!run || !material || run.mode === 'board') return;
    if (!answersOpen(run)) {
      if (run.mode === 'ear' && runStatus(run) === 'active') { feedback = { text: run.ear.answerState.activeListen ? 'Дослушай сигнал — ответы откроются после его конца.' : 'Сначала прослушай сигнал — ответы откроются после его конца.', tone: '' }; render(); }
      return;
    }
    if (index < 0 || index >= choiceLabels(run).length) return;
    if (wrongChoices.has(index)) { feedback = { text: `${choiceLabels(run)[index]} уже проверена — это не ответ.`, tone: '' }; render(); return; }
    const before = run;
    run = answerChoice(run, index, elapsed());
    afterAnswer(before, { choice: index });
  }
  function afterAnswer(before: CheckRun, answer: { positionId?: string; choice?: number }) {
    if (!run || !material) return;
    publishScreen();
    if (run.mode !== 'ear' && run.quiz.status === 'active' && run.quiz.answerState.feedback.kind === 'partial') {
      feedback = { text: `${formatPosition(answer.positionId ?? '')} — верно. ${run.quiz.answerState.feedback.message.replace('Продолжайте поиск.', 'Ищи дальше.')}`, tone: 'ok' };
      render();
      return;
    }
    if (runStatus(run) === 'review') {
      const revealed = revealedAnswer(run, material)!;
      const errors = run.mode === 'ear' ? run.ear.answerState.errors : run.quiz.answerState.errors;
      feedback = { text: `${errors ? `Верно, с исправлением (ошибок: ${errors}).` : 'Верно, с первой попытки.'} ${revealed.text}`, tone: 'ok' };
      render();
      container.querySelector<HTMLElement>('[data-act="next"]')?.focus({ preventScroll: true });
      return;
    }
    if (answer.positionId) wrongPositions.add(answer.positionId);
    if (answer.choice !== undefined) wrongChoices.add(answer.choice);
    feedback = { text: wrongFeedback(before, material, answer), tone: 'err' };
    render();
  }
  function revealCurrent() {
    if (!run || !material || runStatus(run) !== 'active') return;
    stopAudio();
    markContour();
    run = reveal(run, elapsed());
    publishScreen();
    feedback = { text: `Ответ показан: ${revealedAnswer(run, material)!.text} В итоге — «показано», не самостоятельно.`, tone: 'shown' };
    render();
    container.querySelector<HTMLElement>('[data-act="next"]')?.focus({ preventScroll: true });
  }
  function skipCurrent() {
    if (!run || runStatus(run) !== 'active') return;
    stopAudio();
    run = skip(run, elapsed());
    goNext();
  }
  function goNext() {
    if (!run || runStatus(run) !== 'review') return;
    run = advance(run);
    if (runStatus(run) === 'finished') { finalize(); return; }
    publishScreen();
    resetQuestion();
    render();
    container.querySelector<HTMLElement>(run.mode === 'board' ? `[data-cell="${focusCell}"]` : run.mode === 'ear' ? '[data-act="listen"]' : '[data-choice]')?.focus({ preventScroll: true });
  }

  /* ---------- Отрисовка ---------- */
  function backMarkup() {
    return `<button type="button" class="ck-back" data-act="back">${context.backText ? e(context.backText) : `← Занятие${context.backLabel ? ` · ${e(context.backLabel)}` : ''}`}</button>`;
  }
  const KIND_TITLES: Readonly<Record<QuestionKind, string>> = {
    'find-degree': 'найди ступень на грифе', 'name-degree': 'назови ступень', 'find-note': 'найди ноту', 'find-all': 'найди все позиции',
    'name-note': 'назови ноту', 'find-pitch': 'найди высоту', 'find-interval': 'найди интервал',
  };
  function headMarkup() {
    if (!material) return `${backMarkup()}<h1 class="ck-h1">Проверь себя</h1><p class="ck-note">Это проверка знаний на экране — игру на басу она не оценивает.</p>`;
    const mode = run?.mode ?? modeFor(material, ear, settings.kind);
    const title = mode === 'ear' ? 'услышь ступень' : material.review ? 'повтор ошибок' : KIND_TITLES[run ? runKind(run) : settings.kind];
    const count = run ? questionCount(run) : material.count;
    return `${backMarkup()}
      <div class="ck-title-row"><h1 class="ck-h1">Проверь себя: ${e(title)}</h1><span class="ck-sub">${e(material.material)} · ${e(count)} ${plural(count, 'вопрос', 'вопроса', 'вопросов')} · ≈${CHECK_MINUTES} мин</span>
        <span class="ck-chips">${(material.plan?.concepts ?? []).slice(0, 3).map(concept => `<span class="ck-chip">${e(CONCEPT_LABELS[concept])}</span>`).join('')}</span></div>
      <p class="ck-note">Это проверка знаний на экране — игру на басу она не оценивает.</p>`;
  }

  function dotsMarkup(list: readonly CheckEntry[], current: number | null) {
    return `<ol class="ck-dots" aria-label="Ход серии">${list.map(entry => {
      const closed = entry.outcome !== 'pending';
      const label = closed ? OUTCOME_LABELS[entry.outcome as CheckOutcome] : entry.index === current ? 'текущий' : 'впереди';
      return `<li class="${closed ? STATUS_CLASS[entry.outcome as CheckOutcome] : entry.index === current ? 'is-current' : ''}" title="${e(`Вопрос ${entry.index + 1}: ${label}`)}"><span class="ck-sr">${e(`Вопрос ${entry.index + 1}: ${label}`)}</span></li>`;
    }).join('')}</ol>`;
  }

  function barMarkup() {
    if (!run || !material) return '';
    const list = summaryList ?? entries(run);
    const index = questionIndex(run);
    // Вид вопроса, интервал, ноты и слух меняются до первого ответа серии или после итога (новая серия).
    const fresh = !hasActivity(run) || !!summary;
    const degreeKind = isDegreeKind(settings.kind);
    const canToggleEar = !!material.earQuality && degreeKind && !hasActivity(run) && !summary;
    const earOn = run.mode === 'ear';
    const lockedTitle = material.review ? 'Повтор ошибок задаёт вопрос «Назови ноту» по этим позициям' : 'Вид вопроса меняется до первого ответа серии или после итога';
    const kindSelect = `<label class="ck-field"><span class="ck-sr">Вид вопроса</span><select class="ck-select" data-kind data-key="kind" aria-label="Вид вопроса"${fresh && !material.review ? '' : ` disabled title="${e(lockedTitle)}"`}>${QUESTION_KINDS.map(item => `<option value="${item.id}"${item.id === settings.kind ? ' selected' : ''}>${e(item.label)}</option>`).join('')}</select></label>`;
    const intervalSelect = settings.kind === 'find-interval' ? `<label class="ck-field"><span class="ck-sr">Интервал от тоники</span><select class="ck-select" data-interval data-key="interval" aria-label="Интервал от тоники"${fresh ? '' : ' disabled'}>${INTERVAL_CHOICES.map(degree => `<option value="${degree}"${degree === settings.interval ? ' selected' : ''}>${e(formatDegree(degree))}</option>`).join('')}</select></label>` : '';
    const scopeToggle = scopeApplies(settings.kind) && !material.review ? `<button type="button" class="ck-toggle" data-act="toggle-scope" data-key="toggle-scope" aria-pressed="${settings.scope === 'chromatic'}"${fresh ? '' : ' disabled'} title="${e(fresh ? 'Все ноты участка формы, а не только ноты структуры' : 'Ноты меняются до первого ответа серии или после итога')}">◫ Все ноты участка</button>` : '';
    return `<div class="ck-progress"><strong>${summary ? `Итог · ${e(list.length)} из ${e(list.length)}` : `Вопрос ${e(index + 1)} из ${e(questionCount(run))}`}</strong>${dotsMarkup(list, summary ? null : index)}</div>
      <div class="ck-tools">${kindSelect}${intervalSelect}${scopeToggle}
        ${summary ? '' : `${degreeKind ? `<button type="button" class="ck-toggle" data-act="toggle-ear" data-key="toggle-ear" aria-pressed="${earOn}"${canToggleEar ? '' : ' disabled'} title="${e(!material.earQuality ? 'Слух пока только для пентатоник и трезвучий' : canToggleEar ? 'Слух — опция вопроса: сначала тоника, потом нота' : 'Слух меняется до первого ответа серии')}">♪ <b>+ слух</b></button>` : ''}
        ${run.mode === 'board' ? `<button type="button" class="ck-toggle" data-act="toggle-contour" data-key="toggle-contour" aria-pressed="${contour}" title="Подсказка: контуры позиций материала без подписей">◌ Контуры формы</button>` : ''}
        <button type="button" class="ck-btn ck-btn-ghost" data-act="finish" data-key="finish" title="Незаданные вопросы попадут в итог как «без ответа»">Завершить серию</button>`}</div>`;
  }

  function boardAnswerMarkup(current: CheckRun & { mode: 'board' }, mat: CheckMaterial) {
    const review = current.quiz.status === 'review';
    const state = current.quiz.answerState;
    const shown = review && state.status === 'revealed' ? new Set(current.quiz.currentQuestion.expectedPositionIds) : new Set<string>();
    const found = new Set(state.selectedPositionIds);
    const question = current.quiz.currentQuestion;
    const degrees = question.mode === 'find-degree';
    const notes: BoardNote[] = review
      ? mat.positions.map(position => ({ id: position.id, kind: position.degree === '1' ? 'root' : 'b', label: degrees ? formatDegree(position.degree) : position.noteName }))
      : contour ? mat.positions.map(position => ({ id: position.id, kind: 'ghost' })) : [];
    const foundText = degrees ? formatDegree(question.target.degree) : question.mode === 'find-interval' ? formatDegree(question.target.degree) : question.target.name;
    const geo = boardGeometry({ fretMin: mat.fretMin, fretMax: mat.fretMax, width: BOARD_WIDTH, marker: BOARD_MARKER, labels: true });
    const w = geo.cell * .9, h = geo.rowGap * .94;
    const dot = (BOARD_MARKER / w * 100).toFixed(2);
    const cells: string[] = [];
    const locked = review;
    for (const string of BOARD_STRINGS) for (let fret = mat.fretMin; fret <= mat.fretMax; fret++) {
      const cell = `${string}:${fret}`;
      const wrong = wrongPositions.has(cell), isFound = found.has(cell), isShown = shown.has(cell) && !isFound;
      const inside = inQuizArea(current, mat, cell);
      // После ошибки подпись объясняет нажатое: ступень у ступеней, нота у прочих видов.
      const said = wrong && inside ? (degrees ? formatDegree(degreeAt(mat, cell)) : noteAt(mat, cell, question.mode === 'find-pitch')) : '';
      const text = review ? '' : isFound ? foundText : wrong ? (inside ? said : '✕') : '';
      const note = isFound ? ' — найдено' : wrong ? ` — неверно${inside ? `: это ${said}` : ', вне материала'}` : isShown ? ' — ответ' : '';
      const style = `left:${((geo.x(fret) - w / 2) / geo.width * 100).toFixed(3)}%;top:${((geo.y(string) - h / 2) / geo.height * 100).toFixed(3)}%;width:${(w / geo.width * 100).toFixed(3)}%;height:${(h / geo.height * 100).toFixed(3)}%`;
      cells.push(`<button type="button" class="ck-cell${isFound ? ' is-found' : ''}${wrong ? ' is-wrong' : ''}${isShown ? ' is-shown' : ''}${review ? ' is-final' : ''}" data-cell="${cell}" data-key="cell:${cell}" tabindex="${cell === focusCell ? 0 : -1}" aria-label="${e(`Струна ${string}, лад ${fret}${note}`)}"${locked ? ' aria-disabled="true"' : ''} style="${style}"><span class="ck-dot">${e(text)}</span></button>`);
    }
    return `<div class="ck-boardwrap"><div class="ck-wrap" style="--ck-dot:${dot}%">${boardSvg({ fretMin: mat.fretMin, fretMax: mat.fretMax, notes, width: BOARD_WIDTH, marker: BOARD_MARKER, labels: true, decorative: true })}<div class="ck-hit" role="group" aria-label="${e(`Гриф для ответа, лады ${mat.fretMin}–${mat.fretMax}: стрелки — по позициям, Enter — ответ`)}">${cells.join('')}</div></div></div>
      <div class="ck-foot"><span>Клик по позиции — ответ · <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> по позициям, <kbd>Enter</kbd> — ответ</span><span>${review ? `Подписи — ${degrees ? 'ступени' : 'ноты'} материала · кольцо — ответ · ✕ — ошибка` : contour ? 'Контуры — позиции материала, без подписей' : 'Без контуров: материал по памяти'}</span></div>`;
  }

  function cardsMarkup(current: CheckRun, mat: CheckMaterial) {
    const review = runStatus(current) === 'review';
    const answer = review ? revealedAnswer(current, mat) : null;
    const outcome = current.mode === 'ear' ? current.ear.answerState.outcome : current.mode !== 'board' && review ? (current.quiz.answerState.status === 'revealed' ? 'revealed' : 'done') : null;
    const labels = choiceLabels(current);
    const notes = current.mode !== 'ear' && current.quiz.currentQuestion.mode === 'name-note';
    // Верная карточка — только после закрытия вопроса: у нот по классу высоты, у ступеней по подписи ступени.
    const question = current.mode === 'ear' ? null : current.quiz.currentQuestion;
    const right = !answer ? -1 : notes && question
      ? question.choices.findIndex(choice => choice.pitchClass === question.target.pitchClass)
      : labels.indexOf(formatDegree(answer.degree));
    const open = answersOpen(current);
    const keys = Math.min(9, labels.length);
    return `<div class="ck-pad${notes ? ' ck-pad-notes' : ''}" role="group" aria-label="${e(notes ? `Названия нот: клавиши 1–${keys}` : `Ступени от тоники ${mat.root}: клавиши 1–${keys}`)}" style="--ck-cols:${notes ? 6 : labels.length}">${labels.map((label, index) => {
      const wrong = wrongChoices.has(index);
      const isRight = index === right && outcome !== 'revealed';
      const isShown = index === right && outcome === 'revealed';
      const locked = !open || wrong;
      const key = index < 9 ? index + 1 : null;
      return `<button type="button" class="ck-deg${wrong ? ' is-wrong' : ''}${isRight ? ' is-right' : ''}${isShown ? ' is-shown' : ''}" data-choice="${index}" data-key="choice:${index}"${key ? ` aria-keyshortcuts="${key}"` : ''} aria-label="${e(`${label}${wrong ? ', неверно' : isRight ? ', верно' : isShown ? ', показанный ответ' : ''}${key ? `, клавиша ${key}` : ''}`)}"${locked ? ' aria-disabled="true"' : ''}><strong>${e(label)}</strong>${key ? `<small><kbd>${key}</kbd></small>` : ''}</button>`;
    }).join('')}</div>`;
  }

  function compactBoard(current: CheckRun, mat: CheckMaterial) {
    const review = runStatus(current) === 'review';
    const marked = markedPosition(current);
    const notes: BoardNote[] = review
      ? mat.positions.map(position => ({ id: position.id, kind: position.degree === '1' ? 'root' : 'b', label: current.mode !== 'ear' && current.quiz.currentQuestion.mode === 'name-note' ? position.noteName : formatDegree(position.degree) }))
      : mat.positions.map(position => ({ id: position.id, kind: 'ghost' }));
    const aria = current.mode === 'ear' ? `Гриф материала, лады ${mat.fretMin}–${mat.fretMax}; нота скрыта до ответа` : `Гриф, отмечена позиция ${formatPosition(marked ?? '')}`;
    return `<div class="ck-compact">${boardSvg({ fretMin: mat.fretMin, fretMax: mat.fretMax, notes, current: current.mode === 'cards' ? marked : null, width: 700, marker: 40, labels: true, ariaLabel: aria })}</div>`;
  }

  function cueMarkup(current: CheckRun & { mode: 'ear' }, mat: CheckMaterial) {
    const state = current.ear.answerState;
    const playing = !!state.activeListen;
    const review = current.ear.status === 'review';
    return `<div class="ck-cue">
      <div class="ck-cue-row"><button type="button" class="ck-btn${state.listensCompleted ? '' : ' ck-btn-primary'}" data-act="listen" data-key="listen"${playing || review ? ' disabled' : ''}>${playing ? '♪ Звучит…' : state.listensCompleted ? '↻ Ещё раз <kbd>Пробел</kbd>' : '▶ Прослушать <kbd>Пробел</kbd>'}</button>
        <button type="button" class="ck-btn" data-act="stop-signal" data-key="stop-signal"${playing ? '' : ' disabled'}>Остановить</button></div>
      <ol class="ck-steps" aria-label="Сигнал"><li data-cue-step="0">Тоника ${e(mat.root)}</li><li data-cue-step="1">пауза</li><li data-cue-step="2">Нота ?</li></ol>
      <small>${playing ? 'Слушаем… Ответы откроются после конца сигнала.' : state.listensCompleted ? `Прослушано полностью: ${e(state.listensCompleted)} · повторов: ${e(Math.max(0, state.listensCompleted - 1))}${state.listensCancelled ? ` · остановлено: ${e(state.listensCancelled)}` : ''}` : 'Ответы откроются после конца сигнала.'}</small></div>`;
  }

  function questionMarkup(current: CheckRun, mat: CheckMaterial) {
    const text = prompt(current, mat);
    const ask = `<div class="ck-ask-copy"><span class="ck-eyebrow">${e(text.kind)}</span><h2 class="ck-question" tabindex="-1" data-ck-title>${e(text.title)}</h2><p class="ck-sub">${e(text.sub)}</p>${current.mode === 'ear' ? cueMarkup(current as CheckRun & { mode: 'ear' }, mat) : ''}</div>`;
    if (current.mode === 'board') return `<div class="ck-card ck-ask">${ask}</div>${boardAnswerMarkup(current as CheckRun & { mode: 'board' }, mat)}`;
    return `<div class="ck-card ck-ask ck-ask-cards">${ask}${compactBoard(current, mat)}</div>${cardsMarkup(current, mat)}`;
  }

  function buttonsMarkup(current: CheckRun) {
    const review = runStatus(current) === 'review';
    const last = questionIndex(current) + 1 >= questionCount(current);
    return `<button type="button" class="ck-btn" data-act="reveal" data-key="reveal"${review ? ' disabled' : ''}>Показать ответ</button><button type="button" class="ck-btn" data-act="skip" data-key="skip"${review ? ' disabled' : ''}>Пропустить</button>${review ? `<button type="button" class="ck-btn ck-btn-primary" data-act="next" data-key="next">${last ? 'К итогу →' : 'Дальше →'} <kbd>Enter</kbd></button>` : ''}`;
  }

  function summaryMarkup(result: CheckFinishSummary, list: readonly CheckEntry[], source: CheckRun, mat: CheckMaterial) {
    const hard = hardIndices(list);
    const tiles: [string, number, string, string][] = [
      ['self', result.correct, 'Самостоятельно', 'верно с первой попытки, без показа'],
      ['fix', result.corrected, 'С исправлением', 'верно после ошибки'],
      ['err', result.errors, 'Ошибочных ответов', 'всего неверных нажатий'],
      ['shown', result.revealed, 'Показано', 'ответ открыт кнопкой'],
      ['skip', result.skipped, 'Пропущено', 'вернутся в «трудные»'],
    ];
    if (result.unanswered) tiles.push(['none', result.unanswered, 'Без ответа', 'серия завершена раньше']);
    if (source.mode === 'ear') tiles.push(['listen', result.replays, 'Повторов прослушивания', 'не ошибка и не показ']);
    const rows = list.map(entry => {
      const outcome: CheckOutcome = entry.outcome === 'pending' ? 'unanswered' : entry.outcome;
      const row = summaryRow(source, mat, entry);
      const tags = [`<span class="ck-status ${STATUS_CLASS[outcome]}">${e(OUTCOME_LABELS[outcome])}</span>`];
      if (entry.errors) tags.push(`<span class="ck-chip">ошибок: ${e(entry.errors)}</span>`);
      if (entry.listens) tags.push(`<span class="ck-chip">♪ прослушано ${e(entry.listens)}</span>`);
      if (contourUsed[entry.index]) tags.push('<span class="ck-chip">с контуром формы</span>');
      return `<li><span class="ck-num">${e(entry.index + 1)}</span><span>${e(row.question)}</span><span class="ck-ans">${e(row.answer)}</span><span class="ck-tags">${tags.join('')}</span></li>`;
    }).join('');
    return `<div class="ck-sum-head"><span class="ck-eyebrow">Итог серии${result.retry ? ' · повтор трудных' : ''}</span><h2 id="ck-summary-title" tabindex="-1">${result.unanswered ? `Серия завершена досрочно: ${e(result.total - result.unanswered)} из ${e(result.total)}` : `Серия завершена: ${e(result.total)} ${plural(result.total, 'вопрос', 'вопроса', 'вопросов')}`}</h2>
        <p class="ck-sub">Самостоятельно — только верный ответ с первой попытки без показа. Исправление, показ и пропуск считаются отдельно; повтор прослушивания — не ошибка.</p></div>
      <div class="ck-tiles">${tiles.map(([kind, value, label, hint]) => `<div class="ck-tile ck-st-${kind}"><strong>${e(value)}</strong><b>${e(label)}</b><span>${e(hint)}</span></div>`).join('')}</div>
      <ol class="ck-list">${rows}</ol>
      <div class="ck-sum-actions"><button type="button" class="ck-btn ck-btn-primary" data-act="next-step" data-key="next-step">${e(context.nextText ?? 'К следующему шагу плана →')}</button>
        <button type="button" class="ck-btn" data-act="retry" data-key="retry"${hard.length ? '' : ' disabled'}>${hard.length ? `Повторить трудные (${e(hard.length)})` : 'Трудных нет'}</button>
        <button type="button" class="ck-btn ck-btn-ghost" data-act="again" data-key="again">Вся серия заново</button>${context.nextLabel ? `<span class="ck-sub">${e(context.nextLabel)}</span>` : ''}</div>`;
  }

  function render() {
    if (disposed) return;
    const active = document.activeElement instanceof HTMLElement && container.contains(document.activeElement) ? document.activeElement.dataset.key ?? null : null;
    head.innerHTML = headMarkup();
    bar.innerHTML = barMarkup();
    if (failure || !material || !run) {
      live.hidden = false; summaryBox.hidden = true;
      question.innerHTML = failure ? `<p class="ck-error" role="alert">${e(failure)}</p>` : '<p class="ck-sub">Выбери шаг «Проверь себя» в плане на сегодня.</p>';
      buttons.innerHTML = ''; feedbackBox.textContent = '';
      return;
    }
    if (summary && summaryList && summaryRun) {
      live.hidden = true; summaryBox.hidden = false;
      summaryBox.innerHTML = summaryMarkup(summary, summaryList, summaryRun, material) + (notice ? `<p class="ck-error" role="alert">${e(notice)}</p>` : '');
    } else {
      live.hidden = false; summaryBox.hidden = true; summaryBox.innerHTML = '';
      question.innerHTML = questionMarkup(run, material) + (notice ? `<p class="ck-error" role="alert">${e(notice)}</p>` : '');
      buttons.innerHTML = buttonsMarkup(run);
      feedbackBox.textContent = feedback.text || idleText(run);
      feedbackBox.dataset.tone = feedback.tone;
      paintCue();
    }
    status.textContent = run.mode === 'ear' && run.ear.answerState.activeListen ? 'Слушаем сигнал. Ответы закрыты до его конца.' : '';
    if (active) container.querySelector<HTMLElement>(`[data-key="${CSS.escape(active)}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }
  function idleText(current: CheckRun) {
    if (current.mode === 'ear') return answersOpen(current) ? 'Выбери ступень: кнопка или клавиша 1–5.' : 'Нажми «Прослушать» — ответы откроются после конца сигнала.';
    if (current.mode === 'board') return current.quiz.currentQuestion.mode === 'find-all'
      ? `Отмечай позиции по одной: найдено ${current.quiz.answerState.selectedPositionIds.length} из ${current.quiz.currentQuestion.expectedPositionIds.length}.`
      : 'Кликни позицию на грифе или выбери её стрелками и нажми Enter.';
    const count = Math.min(9, choiceLabels(current).length);
    return current.quiz.currentQuestion.mode === 'name-note' ? `Выбери ноту: кнопка или клавиша 1–${count}.` : `Выбери ступень: кнопка или клавиша 1–${count}.`;
  }

  /* ---------- События ---------- */
  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const cell = target?.closest<HTMLElement>('[data-cell]');
    if (cell && container.contains(cell)) { focusCell = cell.dataset.cell!; answerAt(cell.dataset.cell!); return; }
    const choice = target?.closest<HTMLElement>('[data-choice]');
    if (choice && container.contains(choice)) { answerCard(Number(choice.dataset.choice)); return; }
    const action = target?.closest<HTMLButtonElement>('[data-act]');
    if (!action || action.disabled || !container.contains(action)) return;
    try {
      switch (action.dataset.act) {
        case 'back': stopAudio(); render(); options.onBack(); break;
        case 'listen': void playSignal(); break;
        case 'stop-signal': stopAudio('Сигнал остановлен. Для ответа прослушай его до конца.'); render(); container.querySelector<HTMLElement>('[data-act="listen"]')?.focus(); break;
        case 'reveal': revealCurrent(); break;
        case 'skip': skipCurrent(); break;
        case 'next': goNext(); break;
        case 'finish': finalize(); break;
        case 'toggle-contour': contour = !contour; markContour(); render(); break;
        case 'toggle-ear': if (material && run && !hasActivity(run)) { ear = run.mode !== 'ear'; begin(freshRun(material), false); } break;
        case 'toggle-scope': if (material && run && (!hasActivity(run) || summary)) { settings = { ...settings, scope: settings.scope === 'chromatic' ? 'structure' : 'chromatic' }; seed = nextSeed(); begin(freshRun(material), false); } break;
        case 'next-step': options.onNextStep(); break;
        case 'retry': if (material && summaryRun && summaryList) { const hard = hardIndices(summaryList); if (hard.length) begin(retryRun(material, summaryRun, hard, nextSeed()), true); } break;
        case 'again': if (material) { seed = nextSeed(); begin(freshRun(material), false); } break;
      }
    } catch (error) { fail(error); }
  }, listen);

  /** Вид вопроса и интервал: новая серия до первого ответа или после итога; начатая серия не меняется. */
  container.addEventListener('change', event => {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select || !material || !run || (hasActivity(run) && !summary)) return;
    try {
      if (select.matches('[data-kind]')) {
        if (material.review) return;
        const kind = QUESTION_KINDS.find(item => item.id === select.value)?.id;
        if (!kind) return;
        settings = { ...settings, kind };
        if (!isDegreeKind(kind)) ear = false;
      } else if (select.matches('[data-interval]')) {
        const interval = INTERVAL_CHOICES.find(degree => degree === select.value);
        if (!interval) return;
        settings = { ...settings, interval };
      } else return;
      seed = nextSeed();
      begin(freshRun(material), false);
    } catch (error) { fail(error); }
  }, listen);

  document.addEventListener('keydown', event => {
    if (!visible || container.hidden || !run || !material || summary || event.ctrlKey || event.altKey || event.metaKey || isTextField(event.target)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && !container.contains(target) && target !== document.body) return;
    const onAnswer = !!target?.closest('[data-cell], [data-choice]') || !target?.closest('button');
    if (event.key === 'Enter' && runStatus(run) === 'review' && onAnswer) { event.preventDefault(); goNext(); return; }
    if (event.code === 'Space' && run.mode === 'ear' && runStatus(run) === 'active' && !run.ear.answerState.activeListen && onAnswer) { event.preventDefault(); void playSignal(); return; }
    if (run.mode !== 'board') {
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
      if (digit) { event.preventDefault(); answerCard(Number(digit[1]) - 1); }
      return;
    }
    const moves: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const move = moves[event.key];
    if (!move || !target?.closest('[data-cell]')) return;
    event.preventDefault();
    const [string, fret] = focusCell.split(':');
    const row = Math.min(3, Math.max(0, BOARD_STRINGS.indexOf(string as typeof BOARD_STRINGS[number]) + move[0]));
    const nextFret = Math.min(material.fretMax, Math.max(material.fretMin, Number(fret) + move[1]));
    focusCell = `${BOARD_STRINGS[row]}:${nextFret}`;
    container.querySelectorAll<HTMLElement>('[data-cell]').forEach(button => { button.tabIndex = button.dataset.cell === focusCell ? 0 : -1; });
    container.querySelector<HTMLElement>(`[data-cell="${focusCell}"]`)?.focus();
  }, listen);

  onPageVisibility(listen.signal, () => {
    syncClock();
    if (run?.mode === 'ear' && (listening || run.ear.answerState.activeListen)) { stopAudio('Вкладка скрывалась — прослушай сигнал заново, когда вернёшься.'); render(); }
  }, syncClock);

  function nextSeed() { return crypto.getRandomValues(new Uint32Array(1))[0]; }

  render();

  return {
    /** Новая серия по шагу плана; прежняя серия без итога заканчивается молча (без `onFinish`), если на неё ещё не отвечали. */
    start(spec: CheckSpec, nextContext: CheckContext = {}) {
      if (disposed) return;
      if (run && !summary && hasActivity(run)) finalize();
      stopAudio();
      context = nextContext; failure = ''; notice = '';
      try {
        material = checkMaterial(spec);
        settings = defaultSettings(material);
        ear = spec.ear && !!material.earQuality;
        seed = nextSeed();
        begin(freshRun(material), false);
        if (spec.ear && !material.earQuality) { feedback = { text: 'Слух для этой структуры пока не поддерживается — вопросы без звука.', tone: '' }; render(); }
      } catch (error) {
        material = null; run = null; summary = null;
        failure = error instanceof Error ? error.message : String(error);
        render();
      }
    },
    /**
     * Повтор ошибок прежних заданий (R-011): «Назови ноту» только по этим позициям в исходной тональности и структуре.
     * Прежняя начатая серия завершается, как при `start`. Неверные позиции или контекст — ошибка без новой серии.
     */
    startReview(positionIds: readonly string[], original: Pick<QuestionContext, 'root' | 'structureId'>, nextContext: CheckContext = {}) {
      if (disposed) return;
      const next = reviewMaterial(positionIds, original);
      if (run && !summary && hasActivity(run)) finalize();
      stopAudio();
      context = nextContext; failure = ''; notice = '';
      material = next;
      settings = defaultSettings(next);
      ear = false;
      seed = nextSeed();
      try { begin(freshRun(next), false); }
      catch (error) {
        material = null; run = null; summary = null;
        failure = error instanceof Error ? error.message : String(error);
        render();
      }
    },
    setVisible(next: boolean) {
      if (visible && !next) stopAudio('Экран скрывался — прослушай сигнал заново.');
      visible = next; container.hidden = !next;
      syncClock();
      render();
    },
    /** Досрочное завершение: незакрытые вопросы — «без ответа»; итог уходит в `onFinish`, если серия начата. */
    stop() {
      if (!run || summary) { stopAudio(); return; }
      if (hasActivity(run)) finalize(); else { stopAudio(); render(); }
    },
    dispose() {
      if (disposed) return;
      stopAudio();
      disposed = true;
      controller.abort();
      cue.dispose();
      container.innerHTML = '';
      container.classList.remove('check-view');
    },
  };
}

export type { CheckMode };
