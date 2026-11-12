export type SaveStatusKind = 'error' | 'saving' | 'saved' | 'memory';

export interface PersistenceStatusOptions {
  /** Страница закрывается или ждёт перезагрузки: статус больше не обновляется. */
  readonly isSuspended: () => boolean;
  readonly isPersistent: () => boolean;
  readonly hasDraftChanges: () => boolean;
  /** Дублирует статус в «Моих занятиях». */
  readonly publish: (message: string, kind: SaveStatusKind) => void;
}

/** Статус сохранения в шапке и баннере: очередь записи, ошибки настроек, пропущенные записи, временная память. */
export function createPersistenceStatus(app: HTMLElement, options: PersistenceStatusOptions) {
  const byId = (id: string) => app.querySelector<HTMLElement>(`#${id}`)!;
  let writeState: { pending: number; failures: readonly string[] } = { pending: 0, failures: [] };
  let startupIssue = '';
  let preferenceIssue = '';
  let skippedIssue = '';
  let shownDraftChanges = false;

  function show() {
    if (options.isSuspended()) return;
    const { pending, failures } = writeState;
    const persistent = options.isPersistent();
    const dirty = options.hasDraftChanges(); shownDraftChanges = dirty;
    const message = failures.length ? `Не сохранено операций: ${failures.length}. ${failures[0]} Экспорт содержит только подтверждённые записи.` : preferenceIssue || skippedIssue || (pending ? 'Сохранение…' : dirty ? 'Черновик ожидает автосохранения…' : persistent ? 'Сохранено локально в этом браузере' : `Только в памяти страницы. Экспортируй копию перед закрытием. ${startupIssue}`);
    const error = failures.length > 0 || preferenceIssue !== '' || skippedIssue !== '';
    const memoryDetails = byId('open-storage-details');
    memoryDetails.hidden = persistent;
    byId('local-save-status').hidden = !persistent && !error;
    byId('persistence-message').textContent = message;
    byId('persistence-banner').classList.toggle('has-error', error);
    byId('persistence-banner').hidden = !error && (persistent || memoryDetails.getAttribute('aria-expanded') !== 'true');
    byId('local-save-status').textContent = error ? 'Ошибка сохранения' : pending ? 'Сохранение…' : dirty ? 'Черновик занятия' : persistent ? 'Локально · сохранено' : 'Только в памяти';
    byId('retry-save').hidden = failures.length === 0;
    options.publish(message, error ? 'error' : pending || dirty ? 'saving' : persistent ? 'saved' : 'memory');
  }

  return {
    show,
    setWriteState(value: typeof writeState) { writeState = value; show(); },
    /** Показывает статус, только если признак несохранённого черновика изменился. */
    showIfDraftChanged() { if (options.hasDraftChanges() !== shownDraftChanges) show(); },
    get preferenceIssue() { return preferenceIssue; },
    setPreferenceIssue(text: string) { preferenceIssue = text; },
    setSkippedIssue(text: string) { skippedIssue = text; show(); },
    setStartupIssue(text: string) { startupIssue = text; },
    toggleDetails() {
      const button = byId('open-storage-details');
      button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'));
      show();
    },
    /** Сообщение баннера вне очереди записи; `retryTab` показывает «Проверить снова». */
    showBanner(message: string, settings: { retryTab?: boolean; error?: boolean } = {}) {
      byId('persistence-banner').hidden = false;
      byId('persistence-message').textContent = message;
      if (settings.retryTab) byId('retry-tab').hidden = false;
      if (settings.error) byId('persistence-banner').classList.add('has-error');
    },
  };
}
