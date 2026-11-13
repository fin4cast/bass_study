/**
 * Экран «Прогресс» (VIS-08 r1, утверждён A+B): вкладка «Упражнения» — основной вид, «Календарь» — вторая вкладка.
 * Данные приходят в опциях и через `update`; действия уходят колбэками. Хранилище и звук модуль не трогает.
 */
import './progress.css';
import { renderPageHeader } from '../../app/page-frame';
import { confirmAction } from '../confirm';
import { escapeHtml } from '../html';
import { checkIcon, markIcon, outcomeIcon, sparkSvg, sparkText, tallyStack, tempoChartSvg } from './charts';
import {
  MANUAL_LABELS, MARK_LABELS, OUTCOME_LABELS, OUTCOME_ORDER, SOURCE_FILTER_LABELS, SOURCE_LABELS, WEEK_HEADER,
  addDays, calendarWeeks, countWord, datePeriod, dayRecords, defaultDay, difficultyViews, formatActive, formatDraftTime, formatLongDate,
  formatShortDate, isDateKey, localDateKey, matchesSource, mondayOf, parseTempo, progressRows, showsFretboardReview, tallyText, weekSummary, checkTally, missedDegrees,
  type Assessment, type CheckRow, type Difficulty, type DraftView, type FretboardReviewView, type PlayRow, type PracticeRecord, type ProgressRow, type SourceFilter,
} from './model';

export type ProgressTab = 'exercises' | 'calendar';
export interface ProgressData {
  readonly records: readonly PracticeRecord[];
  /** Что уже в плане на сегодня: ключи упражнений и/или `difficultyId(...)` трудных мест. */
  readonly plan?: readonly string[] | ReadonlySet<string>;
  /** Локальная дата «сегодня» (YYYY-MM-DD); по умолчанию — дата устройства. */
  readonly today?: string;
  /** Блок «Не сохранено»: черновики ручной практики «Грифа» и «Ритма». Без поля — прежний список. */
  readonly drafts?: readonly DraftView[];
  /** Карточка «Задания на грифе» с позициями для повтора; без поля — прежняя карточка. */
  readonly review?: FretboardReviewView | null;
}
/** Результат действия: `{ error }` — показать отказ; ничего — успех. */
export type ProgressActionResult = void | { readonly error: string };
export interface ProgressOptions extends Partial<ProgressData> {
  readonly initialTab?: ProgressTab;
  readonly initialSource?: SourceFilter;
  /** Подпись материала упражнения под названием, например «пентатоника Am · форма A». */
  readonly describe?: (row: PlayRow | CheckRow) => string;
  /** «Повторить» / «В план»: трудное место или ключ упражнения добавляется в план на сегодня. */
  readonly onRepeat?: (target: Difficulty | string) => void;
  /** Открыть упражнение; для игры — с лучшим или последним темпом. */
  readonly onPlay?: (exerciseKey: string, bpm: number | null) => void;
  readonly onGoToLesson?: () => void;
  /** Смена вкладки и источника — чтобы хост запомнил выбор. */
  readonly onTabChange?: (tab: ProgressTab) => void;
  readonly onSourceChange?: (source: SourceFilter) => void;
  /** «Повторить» в карточке «Задания на грифе»: открыть «Проверь себя» с повтором ошибочных позиций (P13-08). */
  readonly onRepeatErrors?: () => void;
  /** Удалить запись истории (после подтверждения на экране); промис завершается после записи. */
  readonly onDeleteRecord?: (id: string) => Promise<ProgressActionResult>;
  /** Ввод в поля черновика; `bpm` — `null`, пока поле темпа заполнено неверно. */
  readonly onDraftEdit?: (id: string, note: string, bpm: number | null) => void;
  readonly onDraftSave?: (id: string, note: string, bpm: number) => Promise<ProgressActionResult>;
  readonly onDraftDelete?: (id: string) => Promise<ProgressActionResult>;
}
export interface ProgressView {
  update(data: ProgressData): void;
  /** Только блок «Не сохранено»: ввод в его поля не перерисовывает остальной экран. */
  setDrafts(drafts: readonly DraftView[]): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

let mounts = 0;
const css = (value: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'));

export function mountProgress(container: HTMLElement, options: ProgressOptions = {}): ProgressView {
  const uid = `pg${++mounts}`;
  const state = {
    records: [...(options.records ?? [])] as PracticeRecord[],
    drafts: [...(options.drafts ?? [])] as DraftView[],
    review: (options.review ?? null) as FretboardReviewView | null,
    planned: new Set<string>(options.plan ?? []),
    today: isDateKey(options.today) ? options.today : localDateKey(),
    fixedToday: isDateKey(options.today),
    tab: options.initialTab ?? 'exercises' as ProgressTab,
    source: options.initialSource ?? 'all' as SourceFilter,
    open: null as string | null,
    day: '',
    highlight: null as string | null,
    visible: !container.hidden,
    disposed: false,
  };
  state.day = defaultDay(state.records, state.today);

  container.classList.add('p13-progress');
  container.innerHTML = `
    ${renderPageHeader('progress', {
      id: `${uid}-heading`, className: 'pg-top',
      descriptionText: 'Что получается и что стоит повторить.',
      actions: `<div class="pg-ctl" data-source-ctl><span id="${uid}-src">Источник:</span>
        <div class="pg-seg" role="group" aria-labelledby="${uid}-src">${(['play', 'check', 'all'] as const).map(id => `<button type="button" data-source="${id}" aria-pressed="false">${escapeHtml(SOURCE_FILTER_LABELS[id])}</button>`).join('')}</div>
      </div>`,
      navigation: `<div class="workspace-tabs" role="tablist" aria-label="Вид прогресса">
        <button type="button" role="tab" id="${uid}-tab-exercises" aria-controls="${uid}-panel-exercises" data-tab="exercises">Упражнения</button>
        <button type="button" role="tab" id="${uid}-tab-calendar" aria-controls="${uid}-panel-calendar" data-tab="calendar">Календарь</button>
      </div>`,
    })}
    <p class="pg-note" data-note></p>
    <div class="pg-panel" role="tabpanel" id="${uid}-panel-exercises" aria-labelledby="${uid}-tab-exercises" data-panel="exercises">
      <div class="pg-grid-a">
        <div class="pg-main-a" data-exercises></div>
        <aside class="pg-side" aria-label="Не сохранено, трудные места и неделя">
          <section class="pg-card pg-drafts" aria-labelledby="${uid}-drafts" data-drafts hidden></section>
          <section class="pg-card" aria-labelledby="${uid}-hard-a"><h2 class="pg-h2" id="${uid}-hard-a">Трудные места <small>повтори сегодня</small></h2><div data-hard></div></section>
          <section class="pg-card" aria-labelledby="${uid}-week" data-week></section>
        </aside>
      </div>
    </div>
    <div class="pg-panel" role="tabpanel" id="${uid}-panel-calendar" aria-labelledby="${uid}-tab-calendar" data-panel="calendar">
      <div class="pg-grid-b">
        <div class="pg-left-b">
          <section class="pg-card pg-calcard" aria-labelledby="${uid}-cal" data-calendar></section>
          <section class="pg-card pg-daycard" aria-live="polite" data-day-card></section>
        </div>
        <aside class="pg-side" aria-label="Трудные места и лучший темп">
          <section class="pg-card" aria-labelledby="${uid}-hard-b"><h2 class="pg-h2" id="${uid}-hard-b">Трудные места <small>повтори сегодня</small></h2><div data-hard></div></section>
          <section class="pg-card" data-best></section>
        </aside>
      </div>
    </div>
    <div class="pg-toast" role="status" aria-live="polite" data-toast></div>`;

  const $ = <T extends HTMLElement = HTMLElement>(selector: string, scope: ParentNode = container) => scope.querySelector<T>(selector);
  const $$ = (selector: string, scope: ParentNode = container) => [...scope.querySelectorAll<HTMLElement>(selector)];
  const toastBox = $('[data-toast]')!;
  let toastTimer = 0;
  let chartObserver: ResizeObserver | null = null;

  const hasHistory = () => state.records.length > 0;
  const rows = () => progressRows(state.records, state.source);
  const period = () => datePeriod(state.records.filter(record => matchesSource(record, state.source)), state.today);
  const describe = (row: ProgressRow) => {
    const text = options.describe?.(row) ?? '';
    const count = row.kind === 'check' ? countWord(row.passes.length, 'проверка', 'проверки', 'проверок') : countWord(row.passes.length, 'проход', 'прохода', 'проходов');
    return text ? `${text} · ${count}` : count;
  };

  function toast(text: string) {
    toastBox.textContent = text;
    toastBox.classList.add('is-on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastBox.classList.remove('is-on'), 2800);
  }

  /* ---------- Общие куски разметки ---------- */
  const markChip = (assessment: Assessment) => `<span class="pg-mark is-${assessment}">${markIcon(assessment)}${escapeHtml(MARK_LABELS[assessment])}</span>`;
  const checkChip = (self: number, total: number) => `<span class="pg-mark is-check">${checkIcon()}${self} из ${total}</span>`;
  const sourceTag = (kind: 'play' | 'check') => `<span class="pg-src is-${kind}">${escapeHtml(SOURCE_LABELS[kind])}</span>`;
  const deleteButton = (record: { id: string }, title: string, date: string) =>
    `<button type="button" class="text-button button-compact pg-del" data-delete="${escapeHtml(record.id)}" aria-label="${escapeHtml(`Удалить запись: ${title}, ${formatLongDate(date)}`)}">Удалить запись</button>`;
  const marksLegend = () => `<div class="pg-legend" aria-label="Обозначения">${(['clean', 'errors', 'slow'] as const).map(mark => `<span>${markIcon(mark)}${escapeHtml(MARK_LABELS[mark])}</span>`).join('')}${state.source === 'all' ? `<span>${checkIcon()}Проверь себя</span>` : ''}</div>`;
  const outcomesLegend = () => `<div class="pg-legend" aria-label="Обозначения ответов">${OUTCOME_ORDER.slice(0, 4).map(group => `<span>${outcomeIcon(group)}${escapeHtml(OUTCOME_LABELS[group])}</span>`).join('')}</div>`;
  const planButton = (id: string, label: string, describedAs: string) => {
    const planned = state.planned.has(id);
    return `<button type="button" class="secondary-button button-compact pg-plan" data-repeat="${escapeHtml(id)}" aria-pressed="${planned}"${planned ? ' aria-disabled="true"' : ''} aria-label="${escapeHtml(planned ? `Уже в плане на сегодня: ${describedAs}` : `${label}: добавить в план на сегодня — ${describedAs}`)}">${planned ? '✓ в плане' : escapeHtml(label)}</button>`;
  };

  function renderNote() {
    const note = $('[data-note]')!;
    note.innerHTML = hasHistory()
      ? '<span>Темп и отметку «Чисто / С ошибками / Не успевал» ставишь ты после прохода; ответы «Проверь себя» записывает экран.</span><span>Время — активное, без пауз.</span>'
      : '<span><b>Записей пока нет.</b> Здесь будут твои отметки после прохода и ответы «Проверь себя».</span>';
    $('[data-source-ctl]')!.hidden = !hasHistory();
    $$('[data-source]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.source === state.source)));
  }

  function renderTabs() {
    for (const button of $$('[role="tab"]')) {
      const on = button.dataset.tab === state.tab;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
    }
    for (const panel of $$('[data-panel]')) panel.hidden = panel.dataset.panel !== state.tab;
  }

  function renderHard() {
    const views = difficultyViews(state.records, state.source);
    const review = state.review && state.review.count > 0 && showsFretboardReview(state.source) ? state.review : null;
    const reviewItem = review ? `<li class="is-check is-board"><span class="pg-src is-check">Гриф · экранные задания</span><button type="button" class="secondary-button button-compact pg-plan" data-repeat-errors aria-label="${escapeHtml(`Повторить в «Проверь себя»: ${review.title}`)}">Повторить</button><b>${escapeHtml(review.title)}</b><p>${escapeHtml(review.detail)}${review.reasons ? `. ${escapeHtml(review.reasons)}` : ''}</p></li>` : '';
    const html = !hasHistory() && !review
      ? '<p class="pg-quiet">Сюда попадут места с отметками «С ошибками» и «Не успевал», а также ошибки в «Проверь себя» и в заданиях на грифе. Каждое можно повторить одной кнопкой.</p>'
      : !views.length && !review ? '<p class="pg-quiet">Для этого источника трудных мест нет.</p>'
      : `<ul class="pg-hard">${reviewItem}${views.map(view => `<li class="is-${view.source}">${sourceTag(view.source)}<b>${escapeHtml(view.title)}</b><p>${escapeHtml(view.detail)}</p>${planButton(view.id, 'Повторить', view.title)}</li>`).join('')}</ul>`;
    for (const box of $$('[data-hard]')) box.innerHTML = html;
  }

  /* ---------- Не сохранено: черновики ручной практики ---------- */
  /** Неверный текст поля темпа живёт только на экране: в черновике остаётся прежний темп. */
  const bpmText = new Map<string, string>();
  const busyDrafts = new Set<string>();
  /** Ошибки проверки поля до записи; ошибки записи приходят от приложения в `DraftView.error`. */
  const draftErrors = new Map<string, string>();
  let draftSignature = '';
  const draftError = (draft: DraftView) => draftErrors.get(draft.id) ?? draft.error ?? '';
  function draftCard(draft: DraftView) {
    const id = escapeHtml(draft.id);
    const busy = busyDrafts.has(draft.id);
    const bpm = bpmText.get(draft.id) ?? String(draft.bpm);
    const invalid = parseTempo(bpm, draft.minBpm, draft.maxBpm) === null;
    const day = draft.localDate === state.today ? '' : ` · ${formatShortDate(draft.localDate)}`;
    const error = draftError(draft);
    const label = `${draft.title}${day}`;
    return `<li class="pg-draft${draft.current ? ' is-current' : ''}" data-draft="${id}">
      <span class="pg-src is-manual">${escapeHtml(MANUAL_LABELS[draft.area])}${draft.current ? ' · последнее занятие' : ''}${escapeHtml(day)}</span>
      <b>${escapeHtml(draft.title)}</b>
      <span class="pg-draft-time">Время под звук: <strong data-draft-time>${escapeHtml(formatDraftTime(draft.activeMs))}</strong></span>
      <label class="pg-draft-bpm"><span>Темп, BPM</span><input class="form-control" type="number" inputmode="numeric" min="${draft.minBpm}" max="${draft.maxBpm}" step="1" value="${escapeHtml(bpm)}" aria-invalid="${invalid}" aria-label="${escapeHtml(`Темп, BPM: ${label}`)}" data-draft-field="bpm"${busy ? ' disabled' : ''}></label>
      <label class="pg-draft-note"><span>Заметка</span><textarea class="form-control" rows="2" maxlength="2000" placeholder="Что получилось и что повторить" aria-label="${escapeHtml(`Заметка: ${label}`)}" data-draft-field="note"${busy ? ' disabled' : ''}>${escapeHtml(draft.note)}</textarea></label>
      <p class="pg-draft-error" role="alert" tabindex="-1" data-draft-error${error ? '' : ' hidden'}>${escapeHtml(error)}</p>
      <span class="pg-draft-act"><button type="button" class="primary-button button-compact" data-draft-save${busy ? ' disabled' : ''}>${busy ? 'Сохраняем…' : 'Сохранить отметку'}</button><button type="button" class="text-button button-compact" data-draft-delete aria-label="${escapeHtml(`Удалить черновик: ${label}`)}"${busy ? ' disabled' : ''}>Удалить черновик</button></span>
    </li>`;
  }
  function renderDrafts() {
    const box = $('[data-drafts]')!;
    const list = state.drafts;
    box.hidden = !list.length;
    if (!list.length) { box.innerHTML = ''; draftSignature = ''; return; }
    for (const id of [...bpmText.keys()]) if (!list.some(draft => draft.id === id)) bpmText.delete(id);
    const signature = list.map(draft => `${draft.id}:${busyDrafts.has(draft.id)}:${draft.current}:${draft.localDate}`).join('|');
    if (signature === draftSignature) {
      // Тот же состав: обновляются время, ошибки и поля вне фокуса — ввод и курсор не сбиваются.
      for (const draft of list) {
        const card = $(`[data-draft="${css(draft.id)}"]`, box);
        if (!card) continue;
        $('[data-draft-time]', card)!.textContent = formatDraftTime(draft.activeMs);
        const error = $('[data-draft-error]', card)!;
        const text = draftError(draft);
        if (error.textContent !== text) error.textContent = text;
        error.hidden = !text;
        const bpm = $<HTMLInputElement>('[data-draft-field="bpm"]', card)!;
        if (bpm !== document.activeElement && !bpmText.has(draft.id) && bpm.value !== String(draft.bpm)) bpm.value = String(draft.bpm);
        const note = $<HTMLTextAreaElement>('[data-draft-field="note"]', card)!;
        if (note !== document.activeElement && note.value !== draft.note) note.value = draft.note;
      }
      return;
    }
    draftSignature = signature;
    const active = document.activeElement instanceof HTMLElement && box.contains(document.activeElement) ? document.activeElement : null;
    const focusDraft = active?.closest<HTMLElement>('[data-draft]')?.dataset.draft;
    const focusField = active?.dataset.draftField ?? (active?.hasAttribute('data-draft-save') ? 'save' : active?.hasAttribute('data-draft-delete') ? 'delete' : null);
    const selection = active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] as const : null;
    box.innerHTML = `<h2 class="pg-h2" id="${uid}-drafts" tabindex="-1">Не сохранено <small>${escapeHtml(countWord(list.length, 'черновик', 'черновика', 'черновиков'))}</small></h2>
      <p class="pg-hint">Время под звук в «Ритме» и прежние черновики «Грифа». Поставь удобный темп и сохрани отметку — она попадёт в календарь.</p>
      <ul class="pg-draftlist">${list.map(draftCard).join('')}</ul>`;
    if (focusDraft && focusField) {
      const card = $(`[data-draft="${css(focusDraft)}"]`, box);
      const target = !card ? null : focusField === 'save' ? $('[data-draft-save]', card) : focusField === 'delete' ? $('[data-draft-delete]', card) : $(`[data-draft-field="${focusField}"]`, card);
      if (target && !(target as HTMLButtonElement).disabled) {
        target.focus({ preventScroll: true });
        if (selection && target instanceof HTMLTextAreaElement) target.setSelectionRange(selection[0], selection[1]);
      }
    }
  }
  function draftFields(card: HTMLElement) {
    return { bpm: $<HTMLInputElement>('[data-draft-field="bpm"]', card)!, note: $<HTMLTextAreaElement>('[data-draft-field="note"]', card)! };
  }
  function onDraftInput(event: Event) {
    const field = (event.target as HTMLElement).closest?.<HTMLElement>('[data-draft-field]');
    const card = field?.closest<HTMLElement>('[data-draft]');
    const draft = card ? state.drafts.find(item => item.id === card.dataset.draft) : undefined;
    if (!card || !draft) return;
    const { bpm, note } = draftFields(card);
    const tempo = parseTempo(bpm.value, draft.minBpm, draft.maxBpm);
    bpm.setAttribute('aria-invalid', String(tempo === null));
    if (tempo === null) bpmText.set(draft.id, bpm.value); else bpmText.delete(draft.id);
    draftErrors.delete(draft.id);
    options.onDraftEdit?.(draft.id, note.value, tempo);
  }
  async function runDraftAction(id: string, action: () => Promise<ProgressActionResult> | undefined, done: string) {
    const box = $('[data-drafts]')!;
    busyDrafts.add(id); draftErrors.delete(id); renderDrafts();
    let result: ProgressActionResult;
    try { result = await action(); }
    catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; }
    if (state.disposed) return;
    busyDrafts.delete(id);
    const failed = Boolean(result && 'error' in result);
    if (result && 'error' in result) draftErrors.set(id, result.error);
    else { bpmText.delete(id); toast(done); }
    const focused = box.contains(document.activeElement) || document.activeElement === document.body;
    renderDrafts();
    renderHard();
    if (!focused) return;
    const card = $(`[data-draft="${css(id)}"]`, box);
    if (card) (failed ? $('[data-draft-error]', card) : $('[data-draft-save]', card))?.focus({ preventScroll: true });
    else {
      const heading = !box.hidden ? $<HTMLElement>(`#${uid}-drafts`, box) : $<HTMLElement>(`#${uid}-hard-a`);
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
  }
  async function onDraftButton(button: HTMLElement) {
    const card = button.closest<HTMLElement>('[data-draft]');
    const draft = card ? state.drafts.find(item => item.id === card.dataset.draft) : undefined;
    if (!card || !draft || busyDrafts.has(draft.id)) return;
    if (button.hasAttribute('data-draft-save')) {
      const { bpm, note } = draftFields(card);
      const tempo = parseTempo(bpm.value, draft.minBpm, draft.maxBpm);
      if (tempo === null) {
        draftErrors.set(draft.id, `Укажи темп от ${draft.minBpm} до ${draft.maxBpm} BPM.`);
        renderDrafts();
        bpm.focus();
        return;
      }
      await runDraftAction(draft.id, () => options.onDraftSave?.(draft.id, note.value, tempo), 'Отметка сохранена — она в календаре этого дня.');
      return;
    }
    const accepted = await confirmAction({
      title: 'Удалить черновик?',
      message: `${draft.title} · ${formatDraftTime(draft.activeMs)} под звук${draft.note ? ' · есть заметка' : ''}. Будут удалены заметка и несохранённое время.`,
      confirmLabel: 'Удалить черновик',
    });
    if (!accepted || state.disposed) return;
    await runDraftAction(draft.id, () => options.onDraftDelete?.(draft.id), 'Черновик удалён.');
  }

  /* ---------- Удаление записи истории ---------- */
  async function deleteRecord(button: HTMLElement) {
    const id = button.dataset.delete!;
    const record = state.records.find(item => item.id === id);
    if (!record || !options.onDeleteRecord) return;
    const what = record.kind === 'manual' ? MANUAL_LABELS[record.area] : record.kind === 'check' ? 'Проверь себя' : `Самооценка игры · ${record.bpm} BPM`;
    const accepted = await confirmAction({
      title: `Удалить запись «${record.title}»?`,
      message: `${what} от ${formatLongDate(record.localDate)}. Остальная история сохранится.`,
      confirmLabel: 'Удалить запись',
    });
    if (!accepted || state.disposed) return;
    const buttons = $$('[data-delete]').filter(element => element.offsetParent !== null);
    const index = buttons.indexOf(button);
    const neighbor = buttons[index + 1]?.dataset.delete ?? buttons[index - 1]?.dataset.delete;
    let result: ProgressActionResult;
    try { result = await options.onDeleteRecord(id); }
    catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; }
    if (state.disposed) return;
    if (result && 'error' in result) { toast(`Запись не удалена: ${result.error}`); button.focus(); return; }
    toast('Запись удалена.');
    const next = neighbor ? $$(`[data-delete="${css(neighbor)}"]`).find(element => element.offsetParent !== null) : undefined;
    if (next) next.focus();
    else {
      const heading = $<HTMLElement>(state.tab === 'calendar' ? `#${uid}-cal` : `#${uid}-list`) ?? $<HTMLElement>(`#${uid}-tab-${state.tab}`);
      if (heading && heading.tagName === 'H2') heading.tabIndex = -1;
      heading?.focus();
    }
  }

  /* ---------- A · Упражнения ---------- */
  function renderExercises() {
    const host = $('[data-exercises]')!;
    if (!hasHistory()) {
      host.innerHTML = `<section class="pg-card pg-empty" aria-labelledby="${uid}-empty">
        <p class="pg-eyebrow">Пока пусто — так и должно быть</p>
        <h2 id="${uid}-empty">Здесь появится то, что у тебя получается</h2>
        <ul>
          <li><span aria-hidden="true">1</span><span><b>Лучший темп упражнения.</b> После прохода ты ставишь отметку «Чисто», «С ошибками» или «Не успевал». Самый быстрый проход с отметкой «Чисто» станет лучшим темпом.</span></li>
          <li><span aria-hidden="true">2</span><span><b>Трудные места.</b> Отметки «С ошибками», «Не успевал» и ошибки в «Проверь себя» собираются справа — их можно повторить одной кнопкой.</span></li>
          <li><span aria-hidden="true">3</span><span><b>Время занятий.</b> Считается только активное время, паузы не входят.</span></li>
        </ul>
        <div class="pg-empty-act"><button type="button" class="primary-button" data-go-lesson>Перейти к занятию →</button><span>Первое упражнение появится здесь сразу после отметки.</span></div>
      </section>`;
      return;
    }
    const list = rows();
    const range = period();
    if (state.open && !list.some(row => row.key === state.open)) state.open = null;
    host.innerHTML = `<section class="pg-card pg-list" aria-labelledby="${uid}-list">
      <div class="pg-list-head"><h2 class="pg-h2" id="${uid}-list">Упражнения <small>${list.length} · сначала недавние · нажми строку, чтобы открыть историю</small></h2>${state.source === 'check' ? outcomesLegend() : marksLegend()}</div>
      ${list.length ? `<div class="pg-cols" aria-hidden="true"><span>Упражнение</span><span>${state.source === 'check' ? 'Ответы' : 'Темп'} по датам · ${escapeHtml(formatShortDate(range.start))} — ${escapeHtml(formatShortDate(range.end))}</span><span>Лучший</span><span>Последняя отметка</span><span></span></div>
      <ul class="pg-items">${list.map(row => rowHtml(row, range)).join('')}</ul>` : '<p class="pg-quiet">Для этого источника записей нет — переключи на «Всё».</p>'}
    </section>`;
    if (state.open) fillDetail(state.open);
  }

  function rowHtml(row: ProgressRow, range: ReturnType<typeof period>) {
    const open = state.open === row.key;
    const detailId = `${uid}-d-${list_index(row.key)}`;
    let best: string, last: string;
    if (row.kind === 'check') {
      best = `<b>${row.best.self}/${row.best.total}</b><small>самост.</small>`;
      last = `${checkChip(row.last.tally.self, row.last.tally.total)}<small>${escapeHtml(formatShortDate(row.last.localDate))} · самостоятельно</small>`;
    } else {
      best = row.bestCleanBpm !== null ? `<b>${row.bestCleanBpm}</b><small>было ${row.firstBpm}</small>` : '<b aria-hidden="true">—</b><small>ещё нет «Чисто»</small><span class="pg-sr">Лучшего темпа пока нет</span>';
      last = `${markChip(row.last.assessment)}<small>${escapeHtml(formatShortDate(row.last.localDate))} · ${row.last.bpm} BPM</small>`;
    }
    return `<li class="pg-item is-${row.kind}${open ? ' is-open' : ''}">
      <button type="button" class="pg-row" data-open="${escapeHtml(row.key)}" aria-expanded="${open}" aria-controls="${detailId}">
        <span class="pg-name"><b>${escapeHtml(row.title)}</b><span>${row.kind === 'check' ? `${sourceTag('check')} · ` : ''}${escapeHtml(describe(row))}</span></span>
        <span class="pg-sparkcell">${sparkSvg(row, range)}<span class="pg-sr">${escapeHtml(sparkText(row))}</span></span>
        <span class="pg-best">${best}</span>
        <span class="pg-last">${last}</span>
        <span class="pg-chev" aria-hidden="true">▸</span>
      </button>
      <div class="pg-detail" id="${detailId}" data-detail="${escapeHtml(row.key)}"${open ? '' : ' hidden'}></div>
    </li>`;
  }
  const keyIndex = new Map<string, number>();
  function list_index(key: string) {
    if (!keyIndex.has(key)) keyIndex.set(key, keyIndex.size);
    return keyIndex.get(key)!;
  }

  function fillDetail(key: string) {
    const box = $(`[data-detail="${css(key)}"]`);
    const row = rows().find(item => item.key === key);
    chartObserver?.disconnect();
    if (!box || !row) return;
    if (row.kind === 'check') {
      const passes = [...row.passes].reverse();
      box.innerHTML = `<div class="pg-dtop"><span>${escapeHtml(SOURCE_LABELS.check)} · первый ответ без подсказки считается «самостоятельно»</span><span class="pg-dact">${planButton(row.key, 'В план', row.title)}<button type="button" class="secondary-button button-compact" data-play="${escapeHtml(row.key)}">Проверить снова</button></span></div>
        <div class="pg-table-wrap"><table class="pg-table"><caption class="pg-sr">Проверки «${escapeHtml(row.title)}», сначала последние</caption><thead><tr><th scope="col">Дата</th><th scope="col">Результат</th><th scope="col">Ответы</th><th scope="col">Трудные ступени</th><th scope="col">Время</th><th scope="col"><span class="pg-sr">Действие</span></th></tr></thead>
        <tbody>${passes.map(pass => `<tr><td>${escapeHtml(formatShortDate(pass.localDate))}</td><td class="pg-num">${pass.tally.self} из ${pass.tally.total}</td><td><span class="pg-res">${tallyStack(pass.tally)}${escapeHtml(tallyText(pass.tally))}</span></td><td>${escapeHtml(pass.missed.join(', ') || '—')}</td><td>${escapeHtml(formatActive(pass.activeMs))}</td><td class="pg-act">${deleteButton(pass, row.title, pass.localDate)}</td></tr>`).join('')}</tbody></table></div>`;
      return;
    }
    const passes = [...row.passes].reverse();
    const bpm = row.bestCleanBpm ?? row.last.bpm;
    box.innerHTML = `<div class="pg-dtop"><span>${escapeHtml(SOURCE_LABELS.play)} · ♩ = BPM</span><span class="pg-dact">${planButton(row.key, 'В план', row.title)}<button type="button" class="primary-button button-compact" data-play="${escapeHtml(row.key)}" data-bpm="${bpm}">▶ Играть с ${bpm}</button></span></div>
      <div class="pg-chart-host" data-chart></div>
      <div class="pg-table-wrap"><table class="pg-table"><caption class="pg-sr">Проходы «${escapeHtml(row.title)}», сначала последние</caption><thead><tr><th scope="col">Дата</th><th scope="col">Темп</th><th scope="col">Отметка</th><th scope="col">Время</th><th scope="col"><span class="pg-sr">Действие</span></th></tr></thead>
      <tbody>${passes.map(pass => `<tr><td>${escapeHtml(formatShortDate(pass.localDate))}</td><td class="pg-num">${pass.bpm}</td><td>${markChip(pass.assessment)}</td><td>${escapeHtml(formatActive(pass.activeMs))}</td><td class="pg-act">${deleteButton(pass, row.title, pass.localDate)}</td></tr>`).join('')}</tbody></table></div>`;
    const chart = $('[data-chart]', box)!;
    const draw = () => { chart.innerHTML = tempoChartSvg(row, period(), state.today, chart.clientWidth || 560); };
    draw();
    if (typeof ResizeObserver !== 'undefined') {
      let width = chart.clientWidth;
      chartObserver = new ResizeObserver(() => { if (chart.clientWidth && chart.clientWidth !== width) { width = chart.clientWidth; draw(); } });
      chartObserver.observe(chart);
    }
  }

  function renderWeek() {
    const week = weekSummary(state.records, state.today, state.source);
    const max = Math.max(20, ...week.days.map(day => day.minutes));
    const scope = state.source === 'all' ? '' : state.source === 'play' ? ' · только игра' : ' · только «Проверь себя»';
    const label = `Активные минуты по дням: ${week.days.map(day => `${day.weekday} ${day.future ? 'впереди' : day.minutes ? `${day.minutes} мин` : 'без занятий'}`).join(', ')}`;
    $('[data-week]')!.innerHTML = `<h2 class="pg-h2" id="${uid}-week">Эта неделя <small>${escapeHtml(week.label + scope)}</small></h2>
      <div class="pg-week" role="img" aria-label="${escapeHtml(label)}">${week.days.map(day => `<div class="pg-wd${day.future ? ' is-future' : ''}${day.today ? ' is-today' : ''}">${day.minutes ? `<span class="pg-wv">${day.minutes}</span><i style="height:${Math.round((day.minutes / max) * 64)}px"></i>` : day.future ? '<i></i>' : ''}<span class="pg-wl">${escapeHtml(day.weekday)}</span></div>`).join('')}</div>
      ${!hasHistory() ? '<p class="pg-quiet">Первое занятие отметится здесь — минуты активного времени по дням.</p>'
        : `<div class="pg-wtot"><span><b>${week.minutes} мин</b> активного времени · ${escapeHtml(countWord(week.activeDays, 'день', 'дня', 'дней'))} занятий${week.inProgress ? ' (неделя идёт)' : ''}</span><span>Прошлая неделя: ${week.previous.minutes} мин · ${escapeHtml(countWord(week.previous.activeDays, 'день', 'дня', 'дней'))}</span></div>`}`;
  }

  /* ---------- B · Календарь ---------- */
  function renderCalendar() {
    const weeks = calendarWeeks(state.records, state.today, state.source, hasHistory() ? 4 : 1);
    const visibleDates = new Set(weeks.flatMap(week => week.days.filter(day => day.state !== 'future' && day.state !== 'before').map(day => day.date)));
    if (!visibleDates.has(state.day)) state.day = visibleDates.has(state.today) ? state.today : [...visibleDates].sort().at(-1) ?? state.today;
    const highlightTitle = state.highlight ? rows().find(row => row.key === state.highlight)?.title ?? null : null;
    if (!highlightTitle) state.highlight = null;
    const highlighted = (date: string) => state.highlight !== null && state.records.some(record => record.localDate === date && record.kind !== 'manual' && record.exerciseKey === state.highlight && matchesSource(record, state.source));
    const head = `<span class="pg-hd" aria-hidden="true">Неделя</span>${WEEK_HEADER.map(day => `<span class="pg-hd" aria-hidden="true">${day}</span>`).join('')}<span class="pg-hd" aria-hidden="true">Итог</span>`;
    const body = weeks.map(week => {
      const cells = week.days.map(day => {
        if (day.state === 'future') return `<span class="pg-day is-future" aria-hidden="true"><span class="pg-dn">${day.day}</span></span>`;
        if (day.state === 'before') return `<span class="pg-day is-out" title="До начала записей"><span class="pg-dn">${day.day}</span></span>`;
        const selected = day.date === state.day;
        const hi = highlighted(day.date);
        const aria = `${formatLongDate(day.date)}${day.state === 'today' ? ', сегодня' : ''}: ${day.records ? `${day.minutes ? `${day.minutes} мин` : 'меньше минуты'}, ${countWord(day.records, 'запись', 'записи', 'записей')}` : 'без занятий'}${hi && highlightTitle ? `, есть «${highlightTitle}»` : ''}`;
        return `<button type="button" class="pg-day lvl-${day.level}${day.state === 'today' ? ' is-today' : ''}${hi ? ' is-hi' : ''}" data-day="${day.date}" aria-pressed="${selected}" tabindex="${selected ? 0 : -1}" aria-label="${escapeHtml(aria)}"><span class="pg-dn">${day.day}</span>${day.minutes ? `<span class="pg-dm">${day.minutes} мин</span>` : '<span></span>'}${day.kinds.length ? `<span class="pg-dk" aria-hidden="true">${day.kinds.map(kind => `<i class="is-${kind}"></i>`).join('')}</span>` : ''}</button>`;
      }).join('');
      const total = !hasHistory() ? '' : week.minutes ? `<b>${week.minutes} мин</b><br>${escapeHtml(countWord(week.activeDays, 'день', 'дня', 'дней'))}` : '—';
      return `<span class="pg-wk">${escapeHtml(week.label)}</span>${cells}<span class="pg-tot">${total}</span>`;
    }).join('');
    const scope = state.source === 'all' ? 'всё' : state.source === 'play' ? 'только игра' : 'только «Проверь себя»';
    $('[data-calendar]')!.innerHTML = `<h2 class="pg-h2" id="${uid}-cal">Календарь <small>${hasHistory() ? `активные минуты · ${escapeHtml(scope)} · стрелки — выбор дня` : 'эта неделя'}</small></h2>
      <div class="pg-cal" role="group" aria-label="Дни по неделям">${head}${body}</div>
      ${hasHistory() ? `<div class="pg-cal-legend"><span>Число в клетке — минуты.</span><span class="pg-scale" aria-hidden="true">меньше <i class="lvl-1"></i><i class="lvl-2"></i><i class="lvl-3"></i><i class="lvl-4"></i> больше</span><span><span class="pg-dk"><i class="is-play"></i></span> игра и ручные отметки</span><span><span class="pg-dk"><i class="is-check"></i></span> проверь себя</span>${highlightTitle ? `<span>▬ дни с «${escapeHtml(highlightTitle)}» <button type="button" class="text-button button-compact" data-highlight-clear>Снять</button></span>` : ''}</div>` : ''}`;
  }

  function renderDay() {
    const box = $('[data-day-card]')!;
    box.classList.toggle('is-empty', !hasHistory());
    if (!hasHistory()) {
      box.innerHTML = `<div class="pg-empty-day"><h2 class="pg-h2">Календарь заполнится после первого занятия</h2><p class="pg-sub">Каждый день покажет активные минуты, а по выбору дня — что ты играл, в каком темпе, какую отметку поставил и как ответил в «Проверь себя».</p><div class="pg-empty-act"><button type="button" class="primary-button" data-go-lesson>Перейти к занятию →</button></div></div>`;
      return;
    }
    const { records, hidden, minutes } = dayRecords(state.records, state.day, state.source);
    const long = formatLongDate(state.day);
    const title = `<h2 class="pg-h2">${escapeHtml(long[0].toUpperCase() + long.slice(1))}${state.day === state.today ? ' · сегодня' : ''} <small>${records.length ? `${minutes ? `${minutes} мин` : 'меньше минуты'} активного времени · ${escapeHtml(countWord(records.length, 'запись', 'записи', 'записей'))}` : ''}</small></h2>`;
    if (!records.length) {
      box.innerHTML = `${title}<p class="pg-quiet">${hidden ? 'В этот день были только записи другого источника — переключи фильтр на «Всё».' : state.day === state.today ? 'Сегодня ещё не занимался. Трудные места справа можно добавить в план.' : 'В этот день занятий не было.'}</p>`;
      return;
    }
    box.innerHTML = `${title}<ul class="pg-entries">${records.map(record => {
      const remove = deleteButton(record, record.title, record.localDate);
      if (record.kind === 'check') {
        const tally = checkTally(record);
        const missed = missedDegrees(record);
        return `<li class="pg-entry is-check"><div>${sourceTag('check')}<b>${escapeHtml(record.title)}</b><span class="pg-res">${tallyStack(tally)}${escapeHtml(tallyText(tally))}${missed.length ? ` · трудные: ${escapeHtml(missed.join(', '))}` : ''}</span></div><span>${checkChip(tally.self, tally.total)}</span><span class="pg-min">${escapeHtml(formatActive(record.activeMs))}</span>${remove}</li>`;
      }
      if (record.kind === 'manual') {
        return `<li class="pg-entry is-manual"><div><span class="pg-src is-manual">${escapeHtml(MANUAL_LABELS[record.area])}</span><b>${escapeHtml(record.title)}</b>${record.note ? `<span class="pg-entry-note">${escapeHtml(record.note)}</span>` : ''}</div><span class="pg-entry-res"><span class="pg-bpm">${record.bpm}<small>BPM ♩</small></span></span><span class="pg-min">${escapeHtml(formatActive(record.activeMs))}</span>${remove}</li>`;
      }
      return `<li class="pg-entry is-play"><div>${sourceTag('play')}<b>${escapeHtml(record.title)}</b></div><span class="pg-entry-res">${markChip(record.assessment)}<span class="pg-bpm">${record.bpm}<small>BPM ♩</small></span></span><span class="pg-min">${escapeHtml(formatActive(record.activeMs))}</span>${remove}</li>`;
    }).join('')}</ul>`;
  }

  function renderBest() {
    const box = $('[data-best]')!;
    const onlyCheck = state.source === 'check';
    const head = `<h2 class="pg-h2">${onlyCheck ? 'Проверь себя: лучший результат' : 'Лучший темп'} <small>${onlyCheck ? 'самостоятельно' : 'BPM ♩ · «Чисто»'}</small></h2>`;
    if (!hasHistory()) { box.innerHTML = `${head}<p class="pg-quiet">Появится, когда отметишь первый проход «Чисто». Темп выбираешь ты — от удобного, без спешки.</p>`; return; }
    const list = rows();
    box.innerHTML = `${head}<p class="pg-hint">Нажми упражнение — дни с ним отметятся в календаре.</p><ul class="pg-bestlist">${list.map(row => {
      const value = row.kind === 'check' ? `${row.best.self} из ${row.best.total}<small>сам.</small>` : row.bestCleanBpm !== null ? `${row.bestCleanBpm}<small>было ${row.firstBpm}</small>` : '—<small>нет «Чисто»</small>';
      return `<li><button type="button" data-highlight="${escapeHtml(row.key)}" aria-pressed="${state.highlight === row.key}"><b title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</b><strong>${value}</strong></button></li>`;
    }).join('')}</ul>`;
  }

  function renderAll() {
    if (state.disposed) return;
    renderNote(); renderTabs(); renderDrafts(); renderHard(); renderExercises(); renderWeek(); renderCalendar(); renderDay(); renderBest();
  }

  /* ---------- События ---------- */
  function focusSame(selector: string) {
    const target = $$(selector).find(element => element.offsetParent !== null) ?? $(selector);
    target?.focus();
  }
  function onClick(event: MouseEvent) {
    const target = (event.target as Element).closest<HTMLElement>('button');
    if (!target || !container.contains(target) || (target as HTMLButtonElement).disabled) return;
    if (target.dataset.tab) { selectTab(target.dataset.tab as ProgressTab); return; }
    if (target.hasAttribute('data-draft-save') || target.hasAttribute('data-draft-delete')) { void onDraftButton(target); return; }
    if (target.dataset.delete) { void deleteRecord(target); return; }
    if (target.hasAttribute('data-repeat-errors')) { options.onRepeatErrors?.(); return; }
    if (target.dataset.source) {
      const source = target.dataset.source as SourceFilter;
      const changed = source !== state.source;
      state.source = source;
      renderAll();
      if (changed) options.onSourceChange?.(source);
      focusSame(`[data-source="${state.source}"]`);
      return;
    }
    if (target.dataset.open !== undefined) {
      const key = target.dataset.open;
      state.open = state.open === key ? null : key;
      renderExercises();
      const again = $<HTMLElement>(`[data-open="${css(key)}"]`);
      again?.focus();
      if (state.open) again?.closest('.pg-item')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (target.dataset.repeat !== undefined) {
      const id = target.dataset.repeat;
      if (state.planned.has(id)) return;
      const view = difficultyViews(state.records, 'all').find(item => item.id === id);
      state.planned.add(id);
      options.onRepeat?.(view ? view.difficulty : id);
      toast(`Добавлено в план на сегодня: ${view ? view.title : rows().find(row => row.key === id)?.title ?? id}`);
      renderHard();
      if (state.open) fillDetail(state.open);
      focusSame(`[data-repeat="${css(id)}"]`);
      return;
    }
    if (target.dataset.play !== undefined) { options.onPlay?.(target.dataset.play, target.dataset.bpm ? Number(target.dataset.bpm) : null); return; }
    if (target.dataset.goLesson !== undefined) { options.onGoToLesson?.(); return; }
    if (target.dataset.day) { selectDay(target.dataset.day); return; }
    if (target.dataset.highlight !== undefined) {
      const key = target.dataset.highlight;
      state.highlight = state.highlight === key ? null : key;
      renderBest(); renderCalendar();
      $<HTMLElement>(`[data-highlight="${css(key)}"]`)?.focus();
      return;
    }
    if (target.dataset.highlightClear !== undefined) { state.highlight = null; renderBest(); renderCalendar(); $<HTMLElement>(`[data-day="${state.day}"]`)?.focus(); }
  }
  function selectTab(tab: ProgressTab, focus = false) {
    const changed = tab !== state.tab;
    state.tab = tab;
    if (changed) options.onTabChange?.(tab);
    renderTabs();
    if (tab === 'exercises' && state.open) fillDetail(state.open);
    if (focus) $<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
  }
  function selectDay(date: string) {
    state.day = date;
    renderCalendar(); renderDay();
    $<HTMLElement>(`[data-day="${date}"]`)?.focus();
  }
  function onKeydown(event: KeyboardEvent) {
    const element = event.target as HTMLElement;
    if (element.getAttribute('role') === 'tab') {
      const order: ProgressTab[] = ['exercises', 'calendar'];
      const index = order.indexOf(element.dataset.tab as ProgressTab);
      const next = { ArrowRight: order[(index + 1) % 2], ArrowLeft: order[(index + 1) % 2], Home: order[0], End: order[1] }[event.key];
      if (next) { event.preventDefault(); selectTab(next, true); }
      return;
    }
    const day = element.dataset?.day;
    if (!day) return;
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
    let next: string | null = step ? addDays(day, step) : null;
    if (event.key === 'Home') next = mondayOf(day);
    if (event.key === 'End') next = addDays(mondayOf(day), 6);
    if (!next) return;
    event.preventDefault();
    let candidate = next;
    // Home/End могут попасть на будущий день — берём ближайший доступный внутри недели.
    while (!$(`[data-day="${candidate}"]`) && event.key === 'End' && candidate > day) candidate = addDays(candidate, -1);
    while (!$(`[data-day="${candidate}"]`) && event.key === 'Home' && candidate < day) candidate = addDays(candidate, 1);
    if ($(`[data-day="${candidate}"]`)) selectDay(candidate);
  }
  container.addEventListener('click', onClick);
  container.addEventListener('keydown', onKeydown);
  container.addEventListener('input', onDraftInput);

  renderAll();

  return {
    update(data: ProgressData) {
      if (state.disposed) return;
      state.records = [...(data.records ?? [])];
      if (data.drafts !== undefined) state.drafts = [...data.drafts];
      if (data.review !== undefined) state.review = data.review;
      if (data.plan !== undefined) state.planned = new Set(data.plan);
      if (isDateKey(data.today)) { state.today = data.today; state.fixedToday = true; }
      else if (!state.fixedToday) state.today = localDateKey();
      if (!state.records.some(record => record.localDate === state.day)) state.day = defaultDay(state.records, state.today);
      const active = document.activeElement instanceof HTMLElement && container.contains(document.activeElement) ? document.activeElement : null;
      const restore = active && !active.closest('[data-drafts]') ? ['data-open', 'data-day', 'data-source', 'data-tab', 'data-highlight', 'data-repeat', 'data-play', 'data-delete'].find(name => active.hasAttribute(name)) : undefined;
      const restoreValue = restore ? active!.getAttribute(restore)! : '';
      renderAll();
      if (restore) $<HTMLElement>(`[${restore}="${css(restoreValue)}"]`)?.focus();
    },
    setDrafts(drafts: readonly DraftView[]) {
      if (state.disposed) return;
      state.drafts = [...drafts];
      renderDrafts();
    },
    setVisible(visible: boolean) {
      if (state.disposed) return;
      state.visible = visible;
      container.hidden = !visible;
      if (visible && !state.fixedToday) {
        const today = localDateKey();
        if (today !== state.today) { state.today = today; renderAll(); }
      }
      if (visible && state.open && state.tab === 'exercises') fillDetail(state.open);
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      chartObserver?.disconnect();
      window.clearTimeout(toastTimer);
      container.removeEventListener('click', onClick);
      container.removeEventListener('keydown', onKeydown);
      container.removeEventListener('input', onDraftInput);
      container.classList.remove('p13-progress');
      container.innerHTML = '';
    },
  };
}

export { difficultyId } from './model';
