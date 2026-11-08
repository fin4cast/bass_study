import './history.css';
import { STRUCTURES, formatMidi, getPosition, type StringId } from '../music';
import { createManualPracticeResult, type QuestionContext } from '../training';
import {
  createStudyStore,
  getHistorySummary,
  getReviewPositionIds,
  makeManualHistory,
  type AppPreferences,
  type HistoryEntry,
  type StudySnapshot,
} from '../storage';

type Store = ReturnType<typeof createStudyStore>;
export type HistoryStore = Pick<Store, 'readSnapshot' | 'savePreset' | 'deletePreset' | 'addHistory' | 'deleteHistory' | 'exportBackup' | 'previewImport'>;
type StatusKind = 'saving' | 'saved' | 'memory' | 'error';

export interface ManualPracticeDraft {
  context: QuestionContext;
  durationMs: number;
  comfortableBpm: number;
  runtimeContextKey?: string;
}

export interface HistoryOptions {
  store: HistoryStore;
  getPreferences: () => AppPreferences;
  applyPreferences: (preferences: AppPreferences, source: 'preset' | 'restore') => void | Promise<void>;
  runWrite: <T>(operation: () => Promise<T>) => Promise<T>;
  flush: () => Promise<void>;
  restoreBackup: (json: string) => Promise<StudySnapshot>;
  getPracticeDraft: () => ManualPracticeDraft;
  onRepeatErrors: (positionIds: readonly string[], context: QuestionContext) => void;
  isPersistent: () => boolean;
  onManualSaved?: (durationMs: number, runtimeContextKey?: string) => void;
}

const MODE_NAMES: Record<string, string> = {
  'name-note': 'Назови ноту', 'find-note': 'Найди ноту', 'find-all': 'Все позиции', 'find-degree': 'Найди ступень',
  'find-pitch': 'Найди высоту', 'find-interval': 'Найди интервал',
};
const OUTCOME_NAMES: Record<string, string> = {
  correct: 'Самостоятельно', corrected: 'С исправлением', revealed: 'Ответ показан', skipped: 'Пропущено', interrupted: 'Не завершено',
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

function contextName(context: QuestionContext): string {
  const structure = STRUCTURES.find(item => item.id === context.structureId)?.name ?? context.structureId;
  return `${context.root} · ${structure} · ${context.scope === 'structure' ? 'ноты структуры' : 'все ноты'} · ${context.positionIds.length} позиций`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} с`;
  return `${Math.floor(seconds / 60)} мин ${String(seconds % 60).padStart(2, '0')} с`;
}

function formatDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
}

/** All mutations go through the root write queue; import coordination belongs to root. */
export function mountHistory(container: HTMLElement, options: HistoryOptions) {
  const controller = new AbortController();
  let snapshot: StudySnapshot | null = null;
  let disposed = false;
  let busy = false;
  let refreshVersion = 0;
  let filter: 'all' | 'screen' | 'manual' = 'all';
  let visibleEntries = 10;
  let reviewContextKey: string | null = null;
  let status = 'Читаем локальные данные…';
  let statusKind: StatusKind = 'saving';
  let actionError = '';
  let actionNotice = '';
  let presetName = '';
  let manualBpm: string | null = null;
  let manualNote = '';
  let pendingImport: string | null = null;
  let pendingFilename = '';
  let preview: ReturnType<Store['previewImport']> | null = null;
  let importConfirmed = false;
  const revokeTimers = new Set<ReturnType<typeof setTimeout>>();
  const blobUrls = new Set<string>();

  container.classList.add('history-section');
  container.innerHTML = `<details class="history-drawer"><summary><span class="history-summary-label"><span class="history-icon" aria-hidden="true">≡</span><strong>Мои занятия и настройки</strong><small data-history-count>История · пресеты · резервная копия</small></span><span class="history-save-status" data-testid="history-save-status" role="status" aria-live="polite"></span><span class="history-chevron" aria-hidden="true">⌄</span></summary><div class="history-body" data-testid="history-body"></div></details>`;
  const body = container.querySelector<HTMLElement>('.history-body')!;

  function setSaveStatus(message: string, kind: StatusKind) {
    status = message;
    statusKind = kind;
    const output = container.querySelector<HTMLElement>('[data-testid="history-save-status"]')!;
    output.textContent = status;
    output.dataset.status = statusKind;
  }

  function render() {
    if (disposed) return;
    setSaveStatus(status, statusKind);
    if (!snapshot) {
      body.innerHTML = `<p class="history-loading">${statusKind === 'error' ? 'Данные пока не прочитаны. Можно повторить чтение; текущая работа с грифом остаётся доступной.' : 'Загружаем настройки и историю этого браузера…'}</p>${statusKind === 'error' ? '<button class="secondary-button" type="button" data-history-action="refresh">Повторить чтение</button>' : ''}`;
      return;
    }
    const summary = getHistorySummary(snapshot.history);
    const groups = reviewGroups();
    const review = groups.find(group => group.key === reviewContextKey) ?? groups[0];
    reviewContextKey = review?.key ?? null;
    const reviewIds = review?.ids ?? [];
    const ordered = [...snapshot.history].filter(entry => filter === 'all' || entry.result.kind === filter).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
    const draft = options.getPracticeDraft();
    const canSaveManual = draft.context.positionIds.length > 0;
    const currentManualBpm = manualBpm ?? String(Math.round(draft.comfortableBpm));
    container.querySelector<HTMLElement>('[data-history-count]')!.textContent = `${snapshot.history.length} записей · ${snapshot.presets.length} пресетов`;
    body.innerHTML = `
      ${!options.isPersistent() ? '<p class="history-memory-notice" role="status">Работаем только в памяти этой страницы: изменения не переживут закрытие. Экспортируй копию, чтобы сохранить их отдельно.</p>' : ''}
      ${actionError ? `<p class="history-error" data-testid="history-error" role="alert">${escapeHtml(actionError)}</p>` : ''}
      ${actionNotice ? `<p class="history-notice" data-testid="history-notice" role="status">${escapeHtml(actionNotice)}</p>` : ''}
      <div class="history-overview"><div><strong>${summary.screenSessions}</strong><span>Экранных занятий</span></div><div><strong>${summary.completedQuestions}</strong><span>Завершённых вопросов</span></div><div><strong>${summary.independentCorrect}</strong><span>Самостоятельных ответов</span></div><div><strong>${summary.errors}</strong><span>Ошибочных ответов</span></div><div><strong>${summary.manualSessions}</strong><span>Ручных отметок</span></div></div>
      <section class="history-block history-weak" aria-labelledby="weak-heading"><div><p class="eyebrow">ТОЧЕЧНОЕ ПОВТОРЕНИЕ</p><h3 id="weak-heading">Вернись к трудным позициям</h3><p>${reviewIds.length ? `${reviewIds.length} позиций из прошлых ошибок. Повтор содержит только эту выборку и сохраняет исходную тональность.` : 'Пока нет позиций для повторения. Они появятся из реальных ошибочных ответов.'}</p>${groups.length > 1 ? `<label class="history-field review-context-field"><span>Контекст повторения</span><select aria-label="Контекст повторения" data-history-field="reviewContext">${groups.map(group => `<option value="${escapeHtml(group.key)}"${group.key === reviewContextKey ? ' selected' : ''}>${escapeHtml(contextName(group.context))}</option>`).join('')}</select></label>` : review ? `<p>${escapeHtml(contextName(review.context))}</p>` : ''}<div class="weak-position-chips">${reviewIds.slice(0, 12).map(id => { const [string, fret] = id.split(':'); const position = getPosition(string as StringId, Number(fret)); return `<span>${escapeHtml(formatMidi(position.midi))}<small>${escapeHtml(string)}/${fret}</small></span>`; }).join('')}${reviewIds.length > 12 ? `<span>ещё ${reviewIds.length - 12}</span>` : ''}</div></div><button class="secondary-button" type="button" data-history-action="review-errors"${reviewIds.length === 0 || busy ? ' disabled' : ''}>Повторить ошибки</button></section>
      <section class="history-block" aria-labelledby="manual-heading"><div class="history-block-heading"><div><p class="eyebrow">СВОЯ ОЦЕНКА ПРАКТИКИ</p><h3 id="manual-heading">Отметь комфортный темп</h3></div><span class="history-kind manual">Ручная отметка</span></div><p class="history-help">Темп и заметка — твоя оценка. Длительность берётся из проигрывателя эталона и не измеряет, сколько ты играл на басу.</p>${!canSaveManual ? '<p class="history-help" role="status">Выбери хотя бы одну струну и корректный диапазон. Без доступных позиций ручная отметка не сохраняется.</p>' : ''}<div class="manual-form"><label class="history-field"><span>Комфортный темп, BPM</span><input type="number" min="40" max="220" step="1" value="${escapeHtml(currentManualBpm)}" aria-label="Комфортный темп" data-history-field="manualBpm"${busy ? ' disabled' : ''}></label><div class="manual-duration"><span>Время с эталоном</span><strong data-testid="manual-duration">${formatDuration(draft.durationMs)}</strong><small>${escapeHtml(contextName(draft.context))}</small></div></div><label class="history-field manual-note-field"><span>Заметка</span><textarea maxlength="2000" rows="2" aria-label="Заметка к практике" data-history-field="manualNote" placeholder="Что получилось и что хочется повторить"${busy ? ' disabled' : ''}>${escapeHtml(manualNote)}</textarea></label><div class="history-form-actions"><button class="secondary-button" type="button" data-history-action="save-manual"${busy || !canSaveManual ? ' disabled' : ''}>Сохранить ручную отметку</button><button class="text-button" type="button" data-history-action="refresh-draft"${busy ? ' disabled' : ''}>Обновить время</button></div></section>
      <section class="history-block" aria-labelledby="presets-heading"><div class="history-block-heading"><div><p class="eyebrow">БЫСТРО ВЕРНУТЬСЯ К ЗАНЯТИЮ</p><h3 id="presets-heading">Сохранённые настройки</h3></div><span class="history-small-count">${snapshot.presets.length} пресетов</span></div><p class="history-help">Пресет включает область грифа, тип заданий, последовательность и параметры проигрывателя. Ответы текущего занятия в него не входят.</p><div class="preset-save-form"><label class="history-field"><span>Название пресета</span><input type="text" maxlength="80" value="${escapeHtml(presetName)}" aria-label="Название пресета" data-history-field="presetName" placeholder="Например, A minor · первые пять ладов"${busy ? ' disabled' : ''}></label><button class="secondary-button" type="button" data-history-action="save-preset"${busy ? ' disabled' : ''}>Сохранить пресет</button></div><div class="preset-list" data-testid="preset-list">${snapshot.presets.length ? [...snapshot.presets].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(preset => `<article class="preset-card"><div><strong>${escapeHtml(preset.name)}</strong><p>${escapeHtml(preset.preferences.study.root)} · ${escapeHtml(STRUCTURES.find(item => item.id === preset.preferences.study.structureId)?.name ?? '')} · ${preset.preferences.study.fretMin}–${preset.preferences.study.fretMax} лады</p><small>${formatDate(preset.createdAt)}</small></div><div><button class="secondary-button" type="button" data-apply-preset="${escapeHtml(preset.id)}"${busy ? ' disabled' : ''}>Применить</button><button class="text-button" type="button" data-delete-preset="${escapeHtml(preset.id)}" aria-label="Удалить пресет ${escapeHtml(preset.name)}"${busy ? ' disabled' : ''}>Удалить</button></div></article>`).join('') : '<p class="history-empty">Сохрани удобную настройку, чтобы вернуться к ней одной кнопкой.</p>'}</div></section>
      <section class="history-block" aria-labelledby="history-heading"><div class="history-block-heading"><div><p class="eyebrow">ФАКТИЧЕСКИЕ РЕЗУЛЬТАТЫ</p><h3 id="history-heading">История занятий</h3></div><label class="history-filter"><span class="sr-only">Тип записей истории</span><select aria-label="Тип записей истории" data-history-field="filter"><option value="all"${filter === 'all' ? ' selected' : ''}>Все записи</option><option value="screen"${filter === 'screen' ? ' selected' : ''}>Экранные задания</option><option value="manual"${filter === 'manual' ? ' selected' : ''}>Ручные отметки</option></select></label></div><p class="history-help">Результаты хранят исходную тональность, область и способ оценки. Здесь нет общего «уровня басиста».</p><div class="history-entry-list" data-testid="history-list">${ordered.length ? ordered.slice(0, visibleEntries).map(entryMarkup).join('') : '<p class="history-empty">Записей пока нет. Выполни экранное задание или добавь свою отметку практики.</p>'}</div>${ordered.length > visibleEntries ? '<button class="text-button" type="button" data-history-action="show-more">Показать ещё</button>' : ''}
      ${summary.groups.length ? `<details class="history-context-groups"><summary>Сводка по одинаковым условиям · ${summary.groups.length} групп</summary><p class="history-help">Время первого ответа сравнивается только внутри одинакового режима и музыкального контекста.</p><div class="history-table-scroll"><table><thead><tr><th>Контекст</th><th>Самостоятельно</th><th>Ошибки</th><th>Первый ответ, среднее</th></tr></thead><tbody>${summary.groups.map(group => `<tr><td>${escapeHtml(MODE_NAMES[group.mode] ?? group.mode)}<small>${escapeHtml(contextName(group.context))}</small></td><td>${group.independentCorrect} / ${group.completedQuestions}</td><td>${group.errors}</td><td>${group.meanFirstResponseMs === null ? '—' : `${(group.meanFirstResponseMs / 1000).toFixed(2)} с`}</td></tr>`).join('')}</tbody></table></div></details>` : ''}</section>
      <section class="history-block backup-block" aria-labelledby="backup-heading"><div class="history-block-heading"><div><p class="eyebrow">ПЕРЕНОСИМАЯ КОПИЯ</p><h3 id="backup-heading">Сохрани данные отдельно</h3></div><span class="history-backup-format">JSON · версия ${snapshot.schemaVersion}</span></div><p class="history-help">В копию входят настройки, пресеты и история. Восстановление полностью заменяет текущие данные; предварительный просмотр ничего не меняет.</p><div class="backup-actions"><button class="secondary-button" type="button" data-history-action="export"${busy ? ' disabled' : ''}>Экспортировать JSON</button><label class="backup-file-label">Выбрать копию<input type="file" accept="application/json,.json" aria-label="Файл резервной копии" data-history-file${busy ? ' disabled' : ''}></label></div>${preview ? importPreviewMarkup() : ''}</section>
    `;
  }

  function entryMarkup(entry: HistoryEntry): string {
    const result = entry.result;
    const date = formatDate(entry.occurredAt, entry.timeZone);
    if (result.kind === 'manual') return `<article class="history-entry manual-entry" data-history-entry="${escapeHtml(entry.id)}" data-history-kind="manual"><header><span class="history-kind manual">Ручная отметка</span><time datetime="${entry.occurredAt}">${date}</time><button class="text-button" type="button" data-delete-history="${escapeHtml(entry.id)}" aria-label="Удалить ручную отметку от ${escapeHtml(date)}"${busy ? ' disabled' : ''}>Удалить</button></header><h4>${result.comfortableBpm} BPM — комфортный темп</h4><p class="entry-context">${escapeHtml(contextName(result.context))}</p><p class="entry-facts">Время с эталоном: ${formatDuration(result.durationMs)} · Самооценка, не измерение точности игры</p>${result.note ? `<p class="entry-note">${escapeHtml(result.note)}</p>` : ''}</article>`;
    const completed = result.questions.filter(question => question.outcome !== 'interrupted').length;
    const independent = result.questions.filter(question => question.independentCorrect).length;
    const errors = result.questions.reduce((total, question) => total + question.errors, 0);
    return `<article class="history-entry screen-entry" data-history-entry="${escapeHtml(entry.id)}" data-history-kind="screen"><header><span class="history-kind screen">Экранные задания</span><time datetime="${entry.occurredAt}">${date}</time><button class="text-button" type="button" data-delete-history="${escapeHtml(entry.id)}" aria-label="Удалить экранное занятие от ${escapeHtml(date)}"${busy ? ' disabled' : ''}>Удалить</button></header><h4>${escapeHtml(MODE_NAMES[result.mode] ?? result.mode)}</h4><p class="entry-context">${escapeHtml(contextName(result.context))}</p><p class="entry-facts">${completed < result.plannedCount ? `<strong>Не завершено</strong> · ` : ``}Завершено ${completed} из ${result.plannedCount} · самостоятельно ${independent} · ошибок ${errors}</p><details class="history-question-details"><summary>Ответы и попытки · ${result.questions.length}</summary><ol>${result.questions.map(question => `<li><strong>${escapeHtml(question.targetMidi !== null ? formatMidi(question.targetMidi, question.target.name) : result.mode === "find-interval" ? `${question.target.degree} от ${result.context.root} · ${question.target.name}` : question.target.name)}${question.targetPositionId ? ` · ${escapeHtml(question.targetPositionId.replace(':', '/'))}` : ''}</strong><span>${escapeHtml(OUTCOME_NAMES[question.outcome] ?? question.outcome)}</span><small>${question.errors} ошибок · первый ответ ${question.firstResponseMs === null ? '—' : `${(question.firstResponseMs / 1000).toFixed(2)} с`}</small></li>`).join('')}</ol></details></article>`;
  }

  function reviewGroups() {
    const groups = new Map<string, { key: string; context: QuestionContext; entries: HistoryEntry[]; ids: readonly string[] }>();
    for (const entry of [...(snapshot?.history ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
      if (entry.result.kind !== 'screen' || getReviewPositionIds([entry]).length === 0) continue;
      const context = entry.result.context;
      const key = JSON.stringify({ ...context, positionIds: [...context.positionIds].sort() });
      const existing = groups.get(key);
      if (existing) existing.entries.push(entry);
      else groups.set(key, { key, context, entries: [entry], ids: [] });
    }
    return [...groups.values()].map(group => ({ ...group, ids: getReviewPositionIds(group.entries) }));
  }

  function importPreviewMarkup(): string {
    if (!preview) return '';
    return `<div class="backup-preview" data-testid="backup-preview"><h4 id="restore-preview-title" tabindex="-1">Проверь копию перед заменой</h4><p>${escapeHtml(pendingFilename)} · ${preview.presets} пресетов · ${preview.history} записей истории</p><p class="restore-warning">Текущие настройки, пресеты и история будут полностью заменены содержимым файла. Объединения записей нет. До замены можно экспортировать текущую копию.</p><label class="restore-confirm"><input type="checkbox" data-history-confirm${importConfirmed ? ' checked' : ''}${busy ? ' disabled' : ''}><span>Понимаю, что текущие данные будут заменены</span></label><div class="backup-actions"><button class="restore-button" type="button" data-history-action="confirm-restore"${!importConfirmed || busy ? ' disabled' : ''}>Заменить данные копией</button><button class="text-button" type="button" data-history-action="cancel-restore"${busy ? ' disabled' : ''}>Отменить импорт</button></div></div>`;
  }

  async function refresh() {
    const version = ++refreshVersion;
    try {
      await options.flush();
      const next = await options.store.readSnapshot();
      if (disposed || version !== refreshVersion) return;
      snapshot = next;
      if (status === 'Читаем локальные данные…') {
        status = options.isPersistent() ? 'Локальные данные прочитаны' : 'Только в памяти страницы';
        statusKind = options.isPersistent() ? 'saved' : 'memory';
      }
      render();
    } catch (failure) {
      if (disposed || version !== refreshVersion) return;
      setSaveStatus(`Ошибка чтения: ${failure instanceof Error ? failure.message : String(failure)}`, 'error');
      render();
    }
  }

  async function perform(operation: () => Promise<void>) {
    if (busy || disposed) return;
    busy = true;
    actionError = '';
    actionNotice = '';
    render();
    try { await operation(); }
    catch (failure) {
      actionError = failure instanceof Error ? failure.message : String(failure);
      setSaveStatus('Ошибка сохранения — изменения не подтверждены', 'error');
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function write<T>(operation: () => Promise<T>): Promise<T> {
    return options.runWrite(operation);
  }

  async function downloadBackup() {
    await options.flush();
    const json = await options.store.exportBackup();
    const blobUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    blobUrls.add(blobUrl);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = `bass-study-backup-${new Intl.DateTimeFormat('sv-SE').format(new Date())}.json`;
    anchor.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(blobUrl); blobUrls.delete(blobUrl); revokeTimers.delete(timer); }, 1000);
    revokeTimers.add(timer);
    actionNotice = 'Копия подготовлена для скачивания. Проверь сохранённый файл.';
  }

  container.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
    if (input.dataset.historyField === 'presetName') presetName = input.value;
    if (input.dataset.historyField === 'manualBpm') manualBpm = input.value;
    if (input.dataset.historyField === 'manualNote') manualNote = input.value;
  }, { signal: controller.signal });

  container.addEventListener('change', event => {
    const input = event.target;
    if (input instanceof HTMLSelectElement && input.dataset.historyField === 'filter') {
      filter = input.value as typeof filter;
      visibleEntries = 10;
      render();
    }
    if (input instanceof HTMLSelectElement && input.dataset.historyField === 'reviewContext') {
      reviewContextKey = input.value;
      render();
      body.querySelector<HTMLSelectElement>('[data-history-field="reviewContext"]')?.focus();
    }
    if (input instanceof HTMLInputElement && input.hasAttribute('data-history-confirm')) {
      importConfirmed = input.checked;
      const button = body.querySelector<HTMLButtonElement>('[data-history-action="confirm-restore"]');
      if (button) button.disabled = !importConfirmed || busy;
    }
    if (input instanceof HTMLInputElement && input.hasAttribute('data-history-file') && input.files?.[0]) {
      const file = input.files[0];
      pendingImport = null;
      pendingFilename = '';
      preview = null;
      importConfirmed = false;
      void perform(async () => {
        await options.flush();
        const json = await file.text();
        const nextPreview = options.store.previewImport(json);
        pendingImport = json;
        pendingFilename = file.name;
        preview = nextPreview;
        importConfirmed = false;
      }).then(() => { if (preview) body.querySelector<HTMLElement>('#restore-preview-title')?.focus(); });
    }
  }, { signal: controller.signal });

  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const presetApply = target?.closest<HTMLButtonElement>('[data-apply-preset]')?.dataset.applyPreset;
    if (presetApply) {
      const preset = snapshot?.presets.find(item => item.id === presetApply);
      if (preset) void perform(async () => { await options.applyPreferences(preset.preferences, 'preset'); await options.flush(); actionNotice = `Пресет «${preset.name}» применён.`; });
      return;
    }
    const presetDelete = target?.closest<HTMLButtonElement>('[data-delete-preset]')?.dataset.deletePreset;
    if (presetDelete) { void perform(async () => { await write(() => options.store.deletePreset(presetDelete)); actionNotice = 'Пресет удалён.'; }); return; }
    const historyDelete = target?.closest<HTMLButtonElement>('[data-delete-history]')?.dataset.deleteHistory;
    if (historyDelete) { void perform(async () => { await write(() => options.store.deleteHistory(historyDelete)); actionNotice = 'Запись истории удалена.'; }); return; }
    const action = target?.closest<HTMLButtonElement>('[data-history-action]')?.dataset.historyAction;
    if (!action || busy) return;
    if (action === 'refresh') { void refresh(); return; }
    if (action === 'show-more') { visibleEntries += 10; render(); return; }
    if (action === 'refresh-draft') { render(); return; }
    if (action === 'cancel-restore') {
      pendingImport = null; preview = null; importConfirmed = false; actionNotice = 'Импорт отменён. Данные не изменились.'; actionError = ''; render(); return;
    }
    if (action === 'review-errors') {
      const groups = reviewGroups();
      const review = groups.find(group => group.key === reviewContextKey) ?? groups[0];
      if (review?.ids.length) options.onRepeatErrors(review.ids, review.context);
      return;
    }
    void perform(async () => {
      if (action === 'save-preset') {
        const name = presetName.trim();
        if (!name) throw new RangeError('Дай пресету короткое понятное название.');
        const preset = { id: `preset-${crypto.randomUUID()}`, name, createdAt: new Date().toISOString(), preferences: options.getPreferences() };
        await write(() => options.store.savePreset(preset));
        presetName = '';
        actionNotice = 'Пресет сохранён.';
      } else if (action === 'save-manual') {
        const draft = options.getPracticeDraft();
        const rawBpm = manualBpm ?? String(draft.comfortableBpm);
        if (!rawBpm.trim()) throw new RangeError('Укажи комфортный темп от 40 до 220 BPM.');
        const bpm = Number(rawBpm);
        const result = createManualPracticeResult({ context: draft.context, comfortableBpm: bpm, durationMs: draft.durationMs, note: manualNote });
        const entry = makeManualHistory(result, { id: `manual-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        await write(() => options.store.addHistory(entry));
        options.onManualSaved?.(draft.durationMs, draft.runtimeContextKey);
        manualNote = '';
        actionNotice = 'Ручная отметка сохранена отдельно от экранных результатов.';
      } else if (action === 'export') await downloadBackup();
      else if (action === 'confirm-restore') {
        if (!pendingImport || !preview || !importConfirmed) throw new Error('Сначала выбери копию и подтверди полную замену.');
        await options.restoreBackup(pendingImport);
        pendingImport = null; preview = null; importConfirmed = false;
        actionNotice = 'Данные восстановлены из копии; настройки применены.';
      }
    });
  }, { signal: controller.signal });

  render();
  return {
    refresh,
    clearActionError() { actionError = ''; },
    setSaveStatus,
    dispose() {
      disposed = true;
      refreshVersion++;
      controller.abort();
      revokeTimers.forEach(timer => clearTimeout(timer));
      blobUrls.forEach(url => URL.revokeObjectURL(url));
      container.innerHTML = '';
    },
  };
}
