import './training.css';
import type { AppPreferences } from '../storage';
import { INTERVAL_DEGREES, type IntervalDegree } from '../training/constraints';
import { formatMidi, type AnnotatedPosition, type MusicalStructure, type StringId } from '../music';
import {
  createSequence,
  getQuizSummary,
  nextQuestion,
  revealAnswer,
  skipQuestion,
  startQuiz,
  submitAnswer,
  type QuizMode,
  type SequencePattern,
  type TrainingScope,
  type QuestionContext,
} from '../training';

type Session = ReturnType<typeof startQuiz>;
type Summary = ReturnType<typeof getQuizSummary>;
export type TrainingMode = 'study' | 'quiz' | 'sequence';
export interface TrainingContext {
  positions: readonly AnnotatedPosition[];
  structure: MusicalStructure;
}
export interface TrainingOptions {
  onModeChange?: (mode: TrainingMode) => void;
  onSequenceChange?: () => void;
  onPreferencesChange?: () => void;
  onSessionFinished?: (session: Session) => void;
  onSessionChanged?: (session: Session) => void;
}

const STRING_ORDER: StringId[] = ['G', 'D', 'A', 'E'];
const QUIZ_MODES: readonly { id: QuizMode; name: string; description: string }[] = [
  { id: 'name-note', name: 'Назови ноту', description: 'На грифе отмечена позиция. Выбери название её ноты.' },
  { id: 'find-note', name: 'Найди ноту', description: 'Найди любую подходящую позицию в выбранной области.' },
  { id: 'find-all', name: 'Найди все позиции', description: 'Собери все позиции названной ноты, включая другие октавы.' },
  { id: 'find-degree', name: 'Найди ступень', description: 'Найди ступень относительно тоники выбранной структуры.' },
  { id: 'find-pitch', name: 'Найди высоту', description: 'Найди точную звучащую высоту с указанной октавой. Подходят все её позиции.' },
  { id: 'find-interval', name: 'Найди интервал', description: 'Найди указанный интервал от тоники в любой октаве. Доступны все ноты области, включая ноты вне структуры.' },
];
const PATTERNS: readonly { id: SequencePattern; name: string }[] = [
  { id: 'ascending', name: 'Вверх' },
  { id: 'descending', name: 'Вниз' },
  { id: 'round-trip', name: 'Туда и обратно' },
  { id: 'groups-of-three', name: 'Группы по три' },
];

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/** Screen training owns its answer board; the explorer never submits quiz answers. */
export function mountTraining(container: HTMLElement, getContext: () => TrainingContext, options: TrainingOptions = {}) {
  let mode: TrainingMode = 'study';
  let quizMode: QuizMode = 'name-note';
  let scope: TrainingScope = 'structure';
  let sequenceScope: TrainingScope = 'structure';
  let pattern: SequencePattern = 'ascending';
  let count = 10;
  let intervalDegree: IntervalDegree = '#4';
  let countDraft: string | null = null;
  let reviewPositionIds: readonly string[] = [];
  let session: Session | null = null;
  let lastSession: Session | null = null;
  let summary: Summary | null = null;
  let summaryTitle = 'Занятие завершено';
  let sessionContextLabel = '';
  let summaryContextLabel = '';
  let notice = '';
  let error = '';
  let questionStartedAt = 0;
  let answerFocus: string | null = null;
  const wrongPositions = new Set<string>();
  const wrongChoices = new Set<string>();
  const controller = new AbortController();
  let disposed = false;
  let fingerprint = contextFingerprint(getContext());

  container.classList.add('training-section');
  container.innerHTML = `
    <div class="training-switcher" role="group" aria-label="Режим занятия">
      <button type="button" data-training-mode="study" aria-pressed="true"><span class="mode-icon" aria-hidden="true">○</span>Изучение</button>
      <button type="button" data-training-mode="quiz" aria-pressed="false"><span class="mode-icon" aria-hidden="true">?</span>Задания</button>
      <button type="button" data-training-mode="sequence" aria-pressed="false"><span class="mode-icon" aria-hidden="true">↗</span>Последовательности</button>
    </div>
    <div class="training-content" data-testid="training-content"></div>
  `;
  const content = container.querySelector<HTMLElement>('.training-content')!;

  function contextFingerprint(context: TrainingContext) {
    return `${context.structure.root}|${context.structure.id}|${context.positions.map(position => position.id).join(',')}`;
  }

  function quizContext(): TrainingContext {
    const context = getContext();
    if (!reviewPositionIds.length) return context;
    const ids = new Set(reviewPositionIds);
    return { ...context, positions: context.positions.filter(position => ids.has(position.id)) };
  }

  function render() {
    if (disposed) return;
    container.querySelectorAll<HTMLButtonElement>('[data-training-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.trainingMode === mode)));
    content.hidden = mode === 'study';
    if (mode === 'study') { content.innerHTML = ''; return; }
    if (mode === 'quiz') renderQuiz();
    else renderSequence();
  }

  function quizSetup() {
    const context = quizContext();
    return `<div class="training-intro"><div><p class="eyebrow">ПРОВЕРКА ЗНАНИЙ</p><h2>Вспомни. Найди. Проверь себя.</h2></div><p>Здесь проверяются ответы на экране.<br>Точность игры на басу не измеряется.</p></div>
      <div class="quiz-settings">
        <label class="training-field"><span>Тип задания</span><select aria-label="Тип задания" data-quiz-setting="mode"${reviewPositionIds.length ? ' disabled' : ''}>${QUIZ_MODES.map(item => `<option value="${item.id}"${item.id === quizMode ? ' selected' : ''}>${item.name}</option>`).join('')}</select></label>
        <label class="training-field"><span>Материал заданий</span><select aria-label="Материал заданий" data-quiz-setting="scope"${quizMode === 'find-degree' || quizMode === 'find-interval' || reviewPositionIds.length ? ' disabled' : ''}><option value="structure"${scope === 'structure' ? ' selected' : ''}>В выбранной структуре</option><option value="chromatic"${scope === 'chromatic' ? ' selected' : ''}>Все ноты диапазона</option></select></label>
        ${quizMode === 'find-interval' ? `<label class="training-field"><span>Интервал от тоники</span><select aria-label="Интервал от тоники" data-quiz-setting="interval">${INTERVAL_DEGREES.map(degree => `<option value="${degree}"${degree === intervalDegree ? ' selected' : ''}>${degree.replaceAll('b', '♭').replaceAll('#', '♯')}</option>`).join('')}</select></label>` : ''}
        <label class="training-field count-field"><span>Вопросов</span><input type="number" min="1" max="30" step="1" value="${escapeHtml(countDraft ?? String(count))}" aria-label="Количество вопросов" aria-invalid="${countDraft !== null && (!countDraft || !Number.isInteger(Number(countDraft)) || Number(countDraft) < 1 || Number(countDraft) > 30)}" data-quiz-setting="count"></label>
        <button class="primary-button" type="button" data-training-action="start">${session ? 'Начать заново' : 'Начать занятие'}<span aria-hidden="true">→</span></button>
      </div>
      <p class="training-scope-caption">${escapeHtml(QUIZ_MODES.find(item => item.id === quizMode)!.description)} ${quizMode === 'find-degree' ? 'Используются ступени выбранной структуры.' : ''}<span>${escapeHtml(context.structure.root)} · ${escapeHtml(context.structure.name)} · ${context.positions.length} доступных позиций</span></p>${reviewPositionIds.length ? `<div class="quiz-review-banner" role="status" data-testid="review-banner"><span>Повтор ошибок: только ${reviewPositionIds.length} выбранных позиций. Другие позиции не подмешиваются.</span><button class="text-button" type="button" data-training-action="clear-review">Обычные задания</button></div>` : ''}`;
  }

  function renderQuiz() {
    let body = '';
    if (session) {
      const question = session.currentQuestion;
      const terminal = session.answerState.status !== 'awaiting';
      const feedback = session.answerState.feedback;
      body = `<div class="quiz-question" data-testid="quiz-question" data-question-id="${escapeHtml(question.id)}" data-quiz-mode="${quizMode}">
        <div class="quiz-progress"><span>Вопрос <strong>${session.questionIndex + 1}</strong> из ${session.questions.length}</span><div class="quiz-progress-track" aria-hidden="true"><i style="width:${100 * session.questionIndex / session.questions.length}%"></i></div><button type="button" class="text-button" data-training-action="finish">Завершить занятие</button></div>
        <h3 id="quiz-prompt" tabindex="-1" data-testid="quiz-prompt">${escapeHtml(question.prompt)}</h3>
        ${quizMode === 'find-note' || quizMode === 'find-all' ? `<p class="quiz-target-caption">Ищем: <strong data-testid="quiz-target">${escapeHtml(question.target.name)}</strong></p>` : ''}
        <p class="quiz-rule">${question.answerRule === 'all-positions' ? `Найдено ${session.answerState.selectedPositionIds.length} из ${question.expectedPositionIds.length}. Одна и та же нота может находиться в разных октавах.` : question.answerRule === 'pitch-class' ? 'Выбери название ноты. Октаву называть не нужно.' : 'Подойдёт любая правильная позиция в показанном диапазоне.'}</p>
        ${answerBoard(terminal)}
        ${quizMode === 'name-note' ? `<div class="note-answers" role="group" aria-label="Варианты названия ноты">${question.choices.map(choice => `<button type="button" data-choice="${escapeHtml(choice.id)}" class="note-answer${wrongChoices.has(choice.id) ? ' was-wrong' : ''}${terminal && choice.pitchClass === question.target.pitchClass ? ' is-answer' : ''}"${terminal ? ' disabled' : ''}>${escapeHtml(choice.label)}</button>`).join('')}</div>` : ''}
        <div class="quiz-feedback ${feedback.kind}" role="status" aria-live="polite" data-testid="quiz-feedback">${escapeHtml(feedback.message || 'Можно отвечать. Подсказка покажет ответ и будет отмечена в результате.')}</div>
        <div class="quiz-actions"><div><button type="button" class="secondary-button" data-training-action="hint"${terminal ? ' disabled' : ''}>Показать ответ</button><button type="button" class="text-button" data-training-action="skip"${terminal ? ' disabled' : ''}>Пропустить</button></div>${terminal ? `<button type="button" class="primary-button" data-training-action="next">${session.questionIndex === session.questions.length - 1 ? 'Посмотреть результат' : 'Следующий вопрос'}<span aria-hidden="true">→</span></button>` : '<span class="quiz-keyboard-hint">Стрелки — позиция · Enter / пробел — ответ</span>'}</div>
      </div>`;
    } else if (summary) body = summaryMarkup(summary);
    else body = '<div class="quiz-ready"><span aria-hidden="true">?</span><div><h3>Небольшая проверка без спешки</h3><p>Ошибки можно исправлять. Подсказки и пропуски сохраняют свой статус — они не превращаются в самостоятельный правильный ответ.</p></div></div>';
    content.innerHTML = `${quizSetup()}${notice ? `<p class="training-notice" role="status">${escapeHtml(notice)}</p>` : ''}${error ? `<p class="training-error" role="alert" data-testid="training-error">${escapeHtml(error)}</p>` : ''}${body}`;
  }

  function answerBoard(terminal: boolean) {
    if (!session) return '';
    const positions = quizContext().positions;
    if (!positions.length) return '';
    const question = session.currentQuestion;
    const rows = STRING_ORDER.filter(string => positions.some(position => position.string === string));
    const min = Math.min(...positions.map(position => position.fret));
    const max = Math.max(...positions.map(position => position.fret));
    const cell = 58, left = 56, top = 42, rowGap = 54;
    const width = left + (max - min + 1) * cell + 18;
    const canvasWidth = Math.max(width, 620);
    const height = top + (rows.length - 1) * rowGap + 44;
    const x = (fret: number) => left + (fret - min + .5) * cell;
    const y = (string: StringId) => top + rows.indexOf(string) * rowGap;
    const firstId = question.targetPositionId ?? positions.find(position => position.string === rows[0])?.id ?? positions[0].id;
    if (!positions.some(position => position.id === answerFocus)) answerFocus = firstId;
    const found = new Set(session.answerState.selectedPositionIds);
    const revealed = session.answerState.status === 'revealed';
    const answerNames = new Map(positions.map(position => [position.id, position.noteName]));
    return `<div class="quiz-board-scroll"><svg class="quiz-board" data-testid="quiz-answer-board" viewBox="0 0 ${canvasWidth} ${height}" style="min-width:${canvasWidth}px" aria-label="Гриф для ответа: позиции без названий нот">
      <rect x="${left}" y="18" width="${(max - min + 1) * cell}" height="${height - 32}" rx="4" fill="#293631"/>
      ${Array.from({ length: max - min + 1 }, (_, i) => min + i).map(fret => `<text class="answer-fret-number" x="${x(fret)}" y="11" text-anchor="middle">${fret}</text><line class="answer-wire" x1="${left + (fret - min + 1) * cell}" y1="18" x2="${left + (fret - min + 1) * cell}" y2="${height - 14}"/>`).join('')}
      ${rows.map(string => `<text class="answer-string-name" x="22" y="${y(string) + 4}" text-anchor="middle">${string}</text><line class="answer-string" x1="${left - 9}" y1="${y(string)}" x2="${width - 18}" y2="${y(string)}"/>`).join('')}
      ${positions.map(position => {
        const target = quizMode === 'name-note' && question.targetPositionId === position.id;
        const correct = found.has(position.id);
        const wrong = wrongPositions.has(position.id);
        const show = revealed && question.expectedPositionIds.includes(position.id);
        const label = `Струна ${position.string}, ${position.fret === 0 ? 'открытая струна, лад 0' : `лад ${position.fret}`}${target ? ', отмеченная позиция' : ''}${correct ? ', найдено верно' : wrong ? ', ошибочный выбор' : show ? ', показанный ответ' : ''}`;
        const interactive = quizMode !== 'name-note' && !terminal;
        return `<g class="answer-position${target ? ' target' : ''}${correct ? ' correct' : ''}${wrong ? ' wrong' : ''}${show ? ' revealed' : ''}" data-answer-position="${position.id}" transform="translate(${x(position.fret)},${y(position.string)})"${interactive ? ` role="button" tabindex="${answerFocus === position.id ? '0' : '-1'}"` : ''} aria-label="${escapeHtml(label)}"${interactive ? ` aria-pressed="${correct}"` : ''}><title>${escapeHtml(label)}</title><rect class="answer-hit" x="-27" y="-24" width="54" height="48" rx="4"/><circle class="answer-focus" r="23"/><circle class="answer-dot" r="${target || correct || wrong || show ? 16 : 4}"/>${target ? '<text text-anchor="middle" dy=".35em">?</text>' : correct ? '<text text-anchor="middle" dy=".35em">✓</text>' : wrong ? '<text text-anchor="middle" dy=".35em">×</text>' : show ? `<text text-anchor="middle" dy=".35em">${escapeHtml(answerNames.get(position.id) ?? '')}</text>` : ''}</g>`;
      }).join('')}
    </svg></div>`;
  }

  function summaryMarkup(value: Summary) {
    return `<div class="quiz-summary" data-testid="quiz-summary"><p class="eyebrow">РЕЗУЛЬТАТ ЭКРАННЫХ ЗАДАНИЙ</p><h3>${escapeHtml(summaryTitle)}</h3><p class="summary-completed">Завершено <strong data-result="completed">${value.completed}</strong> из ${value.total} вопросов. Это результаты проверки знаний, а не оценка игры на инструменте.</p><p class="summary-context">Материал занятия: ${escapeHtml(summaryContextLabel)}</p><div class="summary-grid"><div><strong data-result="independentCorrect">${value.independentCorrect}</strong><span>Самостоятельно</span></div><div><strong data-result="corrected">${value.corrected}</strong><span>С исправлением</span></div><div><strong data-result="errors">${value.errors}</strong><span>Ошибочных ответов</span></div><div><strong data-result="hints">${value.hints}</strong><span>Ответов показано</span></div><div><strong data-result="skipped">${value.skipped}</strong><span>Пропущено</span></div></div><p class="summary-footnote">Самостоятельный ответ — верный с первой попытки, без показа ответа. Новое занятие начнётся с новым набором вопросов.</p></div>`;
  }

  function renderSequence() {
    let body = '';
    try {
      const sequence = createSequence({ ...getContext(), scope: sequenceScope, pattern });
      body = `<div class="sequence-heading"><h3>${escapeHtml(sequence.name)}</h3><span data-testid="sequence-count">${sequence.notes.length} нот</span></div><ol class="sequence-route" data-testid="sequence-route">${sequence.notes.map((position, index) => `<li data-sequence-index="${index}" data-sequence-position="${position.id}"><span>${index + 1}</span><strong>${escapeHtml(formatMidi(position.midi, position.noteName))}</strong><small>${position.string} · ${position.fret === 0 ? 'откр.' : `${position.fret} лад`}</small>${position.degree ? `<em>${escapeHtml(position.degree.replaceAll('b', '♭').replaceAll('#', '♯'))}</em>` : ''}</li>`).join('')}</ol><p class="sequence-caption">Маршрут выбирает одну позицию для каждой высоты: по порядку струн E → A → D → G. Это последовательность для изучения, без автоматической оценки исполнения.</p>`;
    } catch (failure) { body = `<p class="training-error" role="status" data-testid="sequence-error">${escapeHtml(failure instanceof Error ? failure.message : String(failure))}</p>`; }
    content.innerHTML = `<div class="training-intro"><div><p class="eyebrow">ПРОСТЫЕ ПОСЛЕДОВАТЕЛЬНОСТИ</p><h2>Один материал. Разные маршруты.</h2></div><p>Сначала посмотри порядок нот.<br>Затем пройди маршрут на инструменте.</p></div><div class="sequence-settings"><label class="training-field"><span>Порядок</span><select aria-label="Порядок последовательности" data-sequence-setting="pattern">${PATTERNS.map(item => `<option value="${item.id}"${item.id === pattern ? ' selected' : ''}>${item.name}</option>`).join('')}</select></label><label class="training-field"><span>Материал</span><select aria-label="Материал последовательности" data-sequence-setting="scope"><option value="structure"${sequenceScope === 'structure' ? ' selected' : ''}>Выбранная структура</option><option value="chromatic"${sequenceScope === 'chromatic' ? ' selected' : ''}>Все ноты диапазона</option></select></label></div>${body}`;
    options.onSequenceChange?.();
  }

  function resetQuestionUi() {
    questionStartedAt = performance.now();
    answerFocus = null;
    wrongPositions.clear();
    wrongChoices.clear();
  }

  function finish(title = 'Занятие завершено') {
    if (!session) return;
    archiveSession();
    summaryTitle = title;
    session = null;
    error = '';
    render();
  }

  function start() {
    try {
      const input = content.querySelector<HTMLInputElement>('[data-quiz-setting="count"]');
      const nextCount = Number(input?.value ?? count);
      if (!input?.value || !Number.isInteger(nextCount) || nextCount < 1 || nextCount > 30) throw new RangeError('Количество вопросов — целое число от 1 до 30.');
      count = nextCount;
      countDraft = null;
      const random = crypto.getRandomValues(new Uint32Array(1))[0];
      const nextSession = startQuiz({ ...quizContext(), mode: quizMode, scope, intervalDegree, seed: random }, count);
      if (session) archiveSession();
      session = nextSession;
      sessionContextLabel = `${quizContext().structure.root} · ${quizContext().structure.name}; ${scope === 'structure' ? 'ноты структуры' : 'все ноты диапазона'}; ${quizContext().positions.length} позиций`;
      summary = null;
      notice = '';
      error = '';
      resetQuestionUi();
      render();
      content.querySelector<HTMLElement>('#quiz-prompt')?.focus();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      render();
    }
  }

  function answer(value: string) {
    if (!session || session.answerState.status !== 'awaiting') return;
    const beforeErrors = session.answerState.errors;
    session = submitAnswer(session, value, Math.max(0, performance.now() - questionStartedAt));
    options.onSessionChanged?.(session);
    if (session.answerState.errors > beforeErrors) {
      if (quizMode === 'name-note') wrongChoices.add(value);
      else wrongPositions.add(value);
    }
    const terminal = session.answerState.status !== 'awaiting';
    render();
    if (terminal) content.querySelector<HTMLButtonElement>('[data-training-action="next"]')?.focus();
    else if (quizMode === 'name-note') content.querySelector<HTMLButtonElement>(`[data-choice="${value}"]`)?.focus();
    else focusAnswer(value, false);
  }

  function focusAnswer(id: string, scroll: boolean) {
    answerFocus = id;
    content.querySelectorAll<SVGGElement>('[data-answer-position][role="button"]').forEach(element => element.setAttribute('tabindex', element.dataset.answerPosition === id ? '0' : '-1'));
    const element = [...content.querySelectorAll<SVGGElement>('[data-answer-position][role="button"]')].find(item => item.dataset.answerPosition === id);
    element?.focus({ preventScroll: true });
    if (scroll) element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function configurationChanged() {
    if (session) {
      archiveSession();
      summaryTitle = 'Предыдущее занятие остановлено';
      session = null;
      notice = 'Параметры изменились. Начни новое занятие — прежние ответы не смешиваются с новой областью.';
    }
    error = '';
    resetQuestionUi();
  }

  function archiveSession() {
    if (!session) return;
    // Archive a terminal current answer before discarding the current session.
    // The next untouched question, if any, has no invented result record.
    lastSession = session.status === 'review' ? nextQuestion(session) : session;
    summary = getQuizSummary(lastSession);
    summaryContextLabel = sessionContextLabel;
    options.onSessionFinished?.(lastSession);
  }

  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest<HTMLButtonElement>('[data-training-mode]');
    if (tab) {
      const nextMode = tab.dataset.trainingMode as TrainingMode;
      if (mode !== nextMode && session) {
        finish('Занятие остановлено при смене режима');
        notice = 'Занятие прервано при смене режима. Начни новое занятие.';
      }
      mode = nextMode;
      countDraft = null;
      options.onModeChange?.(mode);
      render();
      options.onPreferencesChange?.();
      return;
    }
    const choice = target?.closest<HTMLButtonElement>('[data-choice]');
    if (choice?.dataset.choice) { answer(choice.dataset.choice); return; }
    const position = target?.closest<SVGGElement>('[data-answer-position][role="button"]');
    if (position?.dataset.answerPosition) { answerFocus = position.dataset.answerPosition; answer(position.dataset.answerPosition); return; }
    const action = target?.closest<HTMLButtonElement>('[data-training-action]')?.dataset.trainingAction;
    if (!action) return;
    if (action === 'clear-review') {
      configurationChanged();
      reviewPositionIds = [];
      scope = 'structure';
      notice = 'Повтор ошибок выключен. Можно выбрать обычный тип задания и материал.';
      render();
      options.onPreferencesChange?.();
      return;
    }
    if (action === 'start') { start(); return; }
    if (!session) return;
    if (action === 'finish') { finish(); return; }
    const elapsed = Math.max(0, performance.now() - questionStartedAt);
    if (action === 'hint') session = revealAnswer(session, elapsed);
    if (action === 'skip') session = skipQuestion(session, elapsed);
    if (action === 'next') {
      session = nextQuestion(session);
      if (session.status === 'finished') { finish(); return; }
      resetQuestionUi();
    }
    options.onSessionChanged?.(session);
    render();
    content.querySelector<HTMLElement>(action === 'next' ? '#quiz-prompt' : '[data-training-action="next"]')?.focus();
  }, { signal: controller.signal });

  container.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLSelectElement || input instanceof HTMLInputElement)) return;
    const setting = input.dataset.quizSetting;
    if (setting) {
      if (setting === 'count') {
        const nextCount = Number(input.value);
        if (input.value !== '' && Number.isInteger(nextCount) && nextCount >= 1 && nextCount <= 30) {
          count = nextCount;
          countDraft = null;
          options.onPreferencesChange?.();
        }
        return;
      }
      configurationChanged();
      if (setting === 'mode') {
        quizMode = input.value as QuizMode;
        if (quizMode === 'find-degree') scope = 'structure';
        if (quizMode === 'find-interval') scope = 'chromatic';
      }
      if (setting === 'scope') scope = input.value as TrainingScope;
      if (setting === 'interval') intervalDegree = input.value as IntervalDegree;
      render();
      content.querySelector<HTMLElement>(`[data-quiz-setting="${setting}"]`)?.focus();
      options.onPreferencesChange?.();
    }
    if (input.dataset.sequenceSetting === 'pattern') { pattern = input.value as SequencePattern; render(); content.querySelector<HTMLElement>('[data-sequence-setting="pattern"]')?.focus(); options.onPreferencesChange?.(); }
    if (input.dataset.sequenceSetting === 'scope') { sequenceScope = input.value as TrainingScope; render(); content.querySelector<HTMLElement>('[data-sequence-setting="scope"]')?.focus(); options.onPreferencesChange?.(); }
  }, { signal: controller.signal });

  container.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.dataset.quizSetting !== 'count') return;
    countDraft = input.value;
    const number = Number(input.value);
    input.setAttribute('aria-invalid', String(!input.value || !Number.isInteger(number) || number < 1 || number > 30));
  }, { signal: controller.signal });

  container.addEventListener('keydown', event => {
    const target = event.target instanceof Element ? event.target.closest<SVGGElement>('[data-answer-position][role="button"]') : null;
    const current = quizContext().positions.find(position => position.id === target?.dataset.answerPosition);
    if (!current || !session || session.answerState.status !== 'awaiting') return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); answer(current.id); return; }
    const positions = quizContext().positions;
    const rows = STRING_ORDER.filter(string => positions.some(position => position.string === string));
    const frets = positions.filter(position => position.string === current.string).map(position => position.fret);
    let string = current.string;
    let fret = current.fret;
    switch (event.key) {
      case 'ArrowLeft': fret = [...frets].sort((a, b) => b - a).find(value => value < current.fret) ?? current.fret; break;
      case 'ArrowRight': fret = [...frets].sort((a, b) => a - b).find(value => value > current.fret) ?? current.fret; break;
      case 'ArrowUp': string = rows[Math.max(0, rows.indexOf(string) - 1)]; break;
      case 'ArrowDown': string = rows[Math.min(rows.length - 1, rows.indexOf(string) + 1)]; break;
      case 'Home': fret = Math.min(...frets); break;
      case 'End': fret = Math.max(...frets); break;
      default: return;
    }
    event.preventDefault();
    if (string !== current.string) fret = positions.filter(position => position.string === string).sort((a, b) => Math.abs(a.fret - current.fret) - Math.abs(b.fret - current.fret) || a.fret - b.fret)[0].fret;
    focusAnswer(`${string}:${fret}`, true);
  }, { signal: controller.signal });

  render();
  return {
    getPreferences(): AppPreferences['training'] {
      const input = content.querySelector<HTMLInputElement>('[data-quiz-setting="count"]');
      if (input && (!input.value || !Number.isInteger(Number(input.value)) || Number(input.value) < 1 || Number(input.value) > 30)) throw new RangeError('Количество вопросов — целое число от 1 до 30.');
      return { mode, quizMode, scope, intervalDegree, count, pattern, sequenceScope, reviewPositionIds: [...reviewPositionIds] };
    },
    applyPreferences(preferences: AppPreferences['training']) {
      if (session) archiveSession();
      session = null;
      mode = preferences.mode;
      quizMode = preferences.quizMode;
      scope = preferences.scope;
      intervalDegree = preferences.intervalDegree;
      count = preferences.count;
      countDraft = null;
      pattern = preferences.pattern;
      sequenceScope = preferences.sequenceScope;
      const allowed = new Set(getContext().positions.map(position => position.id));
      reviewPositionIds = preferences.reviewPositionIds.filter(id => allowed.has(id));
      if (reviewPositionIds.length) { quizMode = 'name-note'; scope = 'chromatic'; }
      fingerprint = contextFingerprint(getContext());
      summary = null;
      notice = '';
      error = '';
      resetQuestionUi();
      options.onModeChange?.(mode);
      render();
    },
    setReviewPositions(ids: readonly string[], originalContext?: QuestionContext) {
      const context = getContext();
      if (originalContext && (originalContext.root !== context.structure.root || originalContext.structureId !== context.structure.id)) throw new RangeError('Для повторения сначала восстанови исходную тональность и структуру.');
      const allowed = new Set(context.positions.map(position => position.id));
      if (!ids.length || ids.some(id => !allowed.has(id))) throw new RangeError('Позиции для повторения должны входить в текущую область грифа.');
      configurationChanged();
      reviewPositionIds = [...new Set(ids)];
      countDraft = null;
      mode = 'quiz'; quizMode = 'name-note'; scope = 'chromatic';
      fingerprint = contextFingerprint(context);
      summary = null;
      notice = 'Повторяем только позиции из прошлых ошибок. Для нового набора нажми «Начать занятие».';
      options.onModeChange?.(mode);
      render();
      options.onPreferencesChange?.();
    },
    finishCurrentSession(reason = 'Занятие завершено') { finish(reason); },
    getLastSession() { return lastSession; },
    getSequenceScope(): TrainingScope { return sequenceScope; },
    getCurrentSequence() {
      try { return createSequence({ ...getContext(), scope: sequenceScope, pattern }); }
      catch { return null; }
    },
    getSequenceContextKey() { return `${contextFingerprint(getContext())}|${sequenceScope}|${pattern}`; },
    refreshContext() {
      if (disposed) return;
      const nextFingerprint = contextFingerprint(getContext());
      if (nextFingerprint !== fingerprint) {
        fingerprint = nextFingerprint;
        const hadReview = reviewPositionIds.length > 0;
        reviewPositionIds = [];
        configurationChanged();
        render();
        if (hadReview) options.onPreferencesChange?.();
      }
    },
    dispose() {
      controller.abort();
      disposed = true;
      container.innerHTML = '';
    },
  };
}
