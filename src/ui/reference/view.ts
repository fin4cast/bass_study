/**
 * «Справочник» — страница (VIS-12 r1, вариант A): слева поиск и понятия по уровням, справа карточка.
 * «Освоено» отмечается самим пользователем и ничего не блокирует; состояние приходит из опций.
 */
import './reference.css';
import { escapeHtml } from '../html';
import { REFERENCE_CONCEPTS, findConcepts, getConcept } from '../../practice/concepts';
import { createCardController, type CardHandlers } from './card';
import { referenceListener } from './listen';
import { SEARCH_ICON, levelGroups } from './model';

export interface ReferenceCommonOptions {
  /** ID понятий, отмеченных «освоено». */
  readonly mastered?: Iterable<string>;
  readonly onMastered?: (id: string, value: boolean) => void;
  readonly onListen?: CardHandlers['onListen'];
  /**
   * «Послушать» звучит внутри справочника (`createConceptListener`): владелец звука разрешает старт.
   * Без обработчика и без `onListen` кнопка неактивна.
   */
  readonly onBeforeListen?: () => boolean;
  /** Звук справочника закончился или остановлен. */
  readonly onListenEnd?: () => void;
  readonly onPlayTemplate?: CardHandlers['onPlayTemplate'];
  readonly onOpenSection?: CardHandlers['onOpenSection'];
}
export interface ReferenceOptions extends ReferenceCommonOptions {
  readonly initialConcept?: string;
  /** Кнопка возврата в контексте, например «← Основы · уровень 2». */
  readonly backLabel?: string;
  readonly onBack?: () => void;
}
export interface ReferenceView {
  /** Показывает страницу и открывает понятие (по умолчанию — текущее) с фокусом на заголовке карточки. */
  open(conceptId?: string): void;
  close(): void;
  setVisible(visible: boolean): void;
  update(state: { readonly mastered?: Iterable<string> }): void;
  /** Остановить «Послушать» (другой владелец звука, уход со страницы). */
  stopListening(): void;
  dispose(): void;
}

let mounts = 0;

export function mountReference(container: HTMLElement, options: ReferenceOptions = {}): ReferenceView {
  const uid = `rf${++mounts}`;
  const mastered = new Set(options.mastered ?? []);
  let current = getConcept(options.initialConcept ?? '')?.id ?? 'octave-numbers';
  let query = '';
  let disposed = false;

  container.classList.add('p13-reference');
  container.innerHTML = `
    <div class="rf-ctx"><div class="rf-ctx-left">${options.backLabel && options.onBack ? `<button type="button" class="rf-back" data-back>${escapeHtml(options.backLabel)}</button>` : ''}<span class="rf-sub">Понятия по уровням: сначала звук и пальцы, потом термин. Ничего не закрыто.</span></div>
      <div class="rf-count"><span data-count></span><div class="rf-meter" aria-hidden="true"><i data-meter></i></div></div></div>
    <div class="rf-grid">
      <aside class="rf-side" aria-label="Понятия">
        <label class="rf-search">${SEARCH_ICON}<input type="search" data-q placeholder="Найти: октава, ♭3, H, кварта…" aria-label="Поиск понятий" aria-controls="${uid}-list" autocomplete="off"></label>
        <nav class="rf-list" id="${uid}-list" data-list aria-label="Понятия по уровням"></nav>
        <p class="rf-side-note">✓ — отметил сам «освоено». Отметка ничего не открывает и не закрывает.</p>
      </aside>
      <div class="rf-cardwrap" data-card-host></div>
    </div>`;

  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const input = $<HTMLInputElement>('[data-q]');
  const list = $('[data-list]');
  const cardHost = $('[data-card-host]');
  const listener = referenceListener(options, () => card);
  const card = createCardController(cardHost, `${uid}-card`, {
    isMastered: id => mastered.has(id),
    onMastered(id, value) {
      if (value) mastered.add(id); else mastered.delete(id);
      renderList();
      options.onMastered?.(id, value);
    },
    onListen: options.onListen ?? (listener ? concept => { void listener.play(concept); } : undefined),
    onPlayTemplate: options.onPlayTemplate,
    onOpenSection: options.onOpenSection,
  });

  function renderList() {
    const groups = levelGroups(findConcepts(query), mastered);
    list.innerHTML = groups.length
      ? groups.map(group => `<section class="rf-group"><h3><span class="rf-lvl" aria-hidden="true">${escapeHtml(group.mark)}</span>${escapeHtml(group.title)}<small>${group.mastered} из ${group.total}</small></h3><ul>${group.items.map(({ concept, alias }) => `<li><button type="button" class="rf-item" data-concept="${escapeHtml(concept.id)}" aria-current="${concept.id === current}"><span class="rf-ok" aria-hidden="true">${mastered.has(concept.id) ? '✓' : ''}</span><span>${escapeHtml(concept.title)}${mastered.has(concept.id) ? '<span class="rf-sr"> — освоено</span>' : ''}</span>${alias ? `<span class="rf-tag">ур. ${escapeHtml(String(concept.level))}</span>` : concept.later ? '<span class="rf-tag">позже</span>' : ''}</button></li>`).join('')}</ul></section>`).join('')
      : `<p class="rf-empty">Ничего не нашлось по «${escapeHtml(query)}». Попробуй «октава», «ступень», «H» или «доля».</p>`;
    const done = REFERENCE_CONCEPTS.filter(concept => mastered.has(concept.id)).length;
    $('[data-count]').textContent = `Освоено ${done} из ${REFERENCE_CONCEPTS.length}`;
    $('[data-meter]').style.width = `${Math.round((done / REFERENCE_CONCEPTS.length) * 100)}%`;
  }
  function select(id: string, focus = false) {
    if (!getConcept(id)) return;
    current = id;
    listener?.stop();
    card.render(id);
    cardHost.scrollTop = 0;
    renderList();
    if (focus) card.focusTitle();
  }

  function onInput() { query = input.value.trim(); renderList(); }
  function onInputKey(event: KeyboardEvent) {
    const first = list.querySelector<HTMLElement>('[data-concept]');
    if (event.key === 'Enter' && first) { event.preventDefault(); select(first.dataset.concept!); list.querySelector<HTMLElement>(`[data-concept="${first.dataset.concept}"]`)?.focus(); }
    if (event.key === 'ArrowDown' && first) { event.preventDefault(); first.focus(); }
    if (event.key === 'Escape' && input.value) { event.preventDefault(); input.value = ''; query = ''; renderList(); }
  }
  function onListKey(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...list.querySelectorAll<HTMLElement>('[data-concept]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && index === 0) { input.focus(); return; }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    items[next].focus();
  }
  function onClick(event: MouseEvent) {
    const target = (event.target as Element).closest<HTMLElement>('button');
    if (!target) return;
    if (target.dataset.concept) {
      select(target.dataset.concept);
      list.querySelector<HTMLElement>(`[data-concept="${target.dataset.concept}"]`)?.focus();
      return;
    }
    if (target.hasAttribute('data-back')) options.onBack?.();
  }
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onInputKey);
  list.addEventListener('keydown', onListKey);
  container.addEventListener('click', onClick);

  select(current);

  return {
    open(conceptId?: string) {
      if (disposed) return;
      container.hidden = false;
      select(conceptId && getConcept(conceptId) ? conceptId : current, true);
    },
    close() { if (!disposed) { listener?.stop(); container.hidden = true; } },
    setVisible(visible: boolean) {
      if (disposed) return;
      if (!visible) listener?.stop();
      container.hidden = !visible;
    },
    stopListening() { listener?.stop('Остановлено.'); },
    update(state) {
      if (disposed || !state.mastered) return;
      mastered.clear();
      for (const id of state.mastered) mastered.add(id);
      renderList();
      card.syncMastered();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listener?.dispose();
      card.dispose();
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onInputKey);
      list.removeEventListener('keydown', onListKey);
      container.removeEventListener('click', onClick);
      container.classList.remove('p13-reference');
      container.innerHTML = '';
    },
  };
}

export { mountReferencePanel } from './panel';
