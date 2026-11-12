/**
 * «Справочник» — панель поверх экрана (VIS-12 r1, вариант B): клик по подчёркнутому термину открывает
 * боковую панель на этом понятии. Внутри — поиск и переходы с историей «назад». Esc закрывает панель
 * и возвращает фокус к термину; Tab не выводит фокус из панели, остальная страница на время панели инертна.
 */
import './reference.css';
import { escapeHtml } from '../html';
import { findConcepts, getConcept } from '../../practice/concepts';
import { createCardController } from './card';
import { SEARCH_ICON, levelInfo } from './model';
import type { ReferenceCommonOptions } from './view';

export interface ReferencePanelOptions extends ReferenceCommonOptions {
  /** «Весь справочник →»: открыть страницу A на этом понятии. */
  readonly onOpenFull?: (conceptId: string) => void;
  /** Подпись внизу панели, например «Игра на паузе под панелью». */
  readonly footnote?: string;
  readonly onClose?: () => void;
}
export interface ReferencePanel {
  /** `from` — откуда открыто, например «из экрана игры · «Общие ноты»». */
  open(conceptId: string, returnFocusTo?: HTMLElement | null, from?: string): void;
  close(): void;
  update(state: { readonly mastered?: Iterable<string> }): void;
  readonly isOpen: boolean;
  dispose(): void;
}

let mounts = 0;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function mountReferencePanel(host: HTMLElement, options: ReferencePanelOptions = {}): ReferencePanel {
  const uid = `rfp${++mounts}`;
  const mastered = new Set(options.mastered ?? []);
  const root = document.createElement('div');
  root.className = 'p13-reference-panel';
  root.hidden = true;
  root.innerHTML = `
    <div class="rf-scrim" data-scrim></div>
    <aside class="rf-drawer" role="dialog" aria-modal="true" aria-labelledby="${uid}-title" data-drawer>
      <header class="rf-d-head"><button type="button" class="rf-d-icon" data-back aria-label="Назад к предыдущему понятию" hidden>←</button><strong id="${uid}-title">Справочник</strong><span class="rf-sub" data-from></span>
        <button type="button" class="rf-d-close" data-close aria-label="Закрыть справочник">✕ <span class="rf-kbd" aria-hidden="true">Esc</span></button></header>
      <div class="rf-d-search"><label class="rf-search">${SEARCH_ICON}<input type="search" data-dq placeholder="Другое понятие: кварта, E1, H…" aria-label="Поиск по справочнику" aria-controls="${uid}-hits" autocomplete="off"></label></div>
      <ul class="rf-d-hits" id="${uid}-hits" data-hits hidden></ul>
      <div class="rf-d-body" data-card-host></div>
      <footer class="rf-d-foot"><span>${escapeHtml(options.footnote ?? '')}</span>${options.onOpenFull ? '<button type="button" data-full>Весь справочник →</button>' : ''}</footer>
    </aside>`;
  host.append(root);

  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const drawer = $('[data-drawer]');
  const input = $<HTMLInputElement>('[data-dq]');
  const hits = $('[data-hits]');
  const body = $('[data-card-host]');
  const stack: string[] = [];
  let returnFocus: HTMLElement | null = null;
  let inerted: HTMLElement[] = [];
  let open = false;
  let disposed = false;

  const card = createCardController(body, `${uid}-card`, {
    isMastered: id => mastered.has(id),
    onMastered(id, value) { if (value) mastered.add(id); else mastered.delete(id); options.onMastered?.(id, value); },
    onListen: options.onListen,
    onPlayTemplate: options.onPlayTemplate,
    onOpenSection: options.onOpenSection,
  });

  function render(focus = true) {
    card.render(stack.at(-1)!);
    body.scrollTop = 0;
    $('[data-back]').hidden = stack.length < 2;
    if (focus) card.focusTitle();
  }
  function go(id: string) {
    if (!getConcept(id)) return;
    stack.push(id);
    input.value = '';
    hits.hidden = true;
    render();
  }
  function search() {
    const query = input.value.trim();
    if (!query) { hits.hidden = true; hits.innerHTML = ''; return; }
    const found = findConcepts(query).slice(0, 6);
    hits.innerHTML = found.length
      ? found.map(concept => `<li><button type="button" data-hit="${escapeHtml(concept.id)}"><span>${escapeHtml(concept.title)}</span><small>${escapeHtml(levelInfo(concept.level).title)}</small></button></li>`).join('')
      : `<li class="rf-empty">Ничего не нашлось по «${escapeHtml(query)}».</li>`;
    hits.hidden = false;
  }

  /** Делает инертным всё вне панели: соседей на каждом уровне от панели до body. */
  function setOutsideInert(on: boolean) {
    if (!on) { inerted.forEach(element => { element.inert = false; }); inerted = []; return; }
    let node: HTMLElement | null = root;
    while (node && node !== document.body && node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert && sibling.tagName !== 'SCRIPT' && sibling.tagName !== 'STYLE') {
          sibling.inert = true;
          inerted.push(sibling);
        }
      }
      node = node.parentElement;
    }
  }
  function onDocumentKey(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      if (document.activeElement === input && input.value) { event.preventDefault(); input.value = ''; search(); return; }
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable.at(-1)!;
    const active = document.activeElement as HTMLElement | null;
    const inside = active ? drawer.contains(active) : false;
    const index = active ? focusable.indexOf(active) : -1;
    if (!inside) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
    if (event.shiftKey && (active === first || index === -1 && active === drawer.querySelector('.rf-card-head h2'))) { event.preventDefault(); last.focus(); return; }
    if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  }
  function onClick(event: MouseEvent) {
    const target = (event.target as Element).closest<HTMLElement>('button, [data-scrim]');
    if (!target) return;
    if (target.matches('[data-scrim], [data-close]')) { close(); return; }
    if (target.matches('[data-back]')) { stack.pop(); render(); return; }
    if (target.dataset.hit) { go(target.dataset.hit); return; }
    if (target.matches('[data-full]')) { const id = stack.at(-1)!; close(); options.onOpenFull?.(id); }
  }
  function onInputKey(event: KeyboardEvent) {
    if (event.key === 'Enter') { const first = hits.querySelector<HTMLElement>('[data-hit]'); if (first) { event.preventDefault(); go(first.dataset.hit!); } }
    if (event.key === 'ArrowDown') { const first = hits.querySelector<HTMLElement>('[data-hit]'); if (first) { event.preventDefault(); first.focus(); } }
  }
  function onHitsKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...hits.querySelectorAll<HTMLElement>('[data-hit]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && index === 0) { input.focus(); return; }
    items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
  }

  function close() {
    if (!open) return;
    open = false;
    root.hidden = true;
    setOutsideInert(false);
    document.removeEventListener('keydown', onDocumentKey, true);
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected) back.focus();
    options.onClose?.();
  }

  root.addEventListener('click', onClick);
  input.addEventListener('input', search);
  input.addEventListener('keydown', onInputKey);
  hits.addEventListener('keydown', onHitsKey);

  return {
    open(conceptId: string, returnFocusTo?: HTMLElement | null, from?: string) {
      if (disposed) return;
      if (!getConcept(conceptId)) throw new RangeError(`Нет понятия «${conceptId}».`);
      if (!open) returnFocus = returnFocusTo ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
      else if (returnFocusTo) returnFocus = returnFocusTo;
      stack.length = 0;
      stack.push(conceptId);
      input.value = '';
      hits.hidden = true;
      $('[data-from]').textContent = from ?? '';
      if (!open) {
        open = true;
        root.hidden = false;
        setOutsideInert(true);
        document.addEventListener('keydown', onDocumentKey, true);
      }
      render();
    },
    close,
    update(state) {
      if (disposed || !state.mastered) return;
      mastered.clear();
      for (const id of state.mastered) mastered.add(id);
      card.syncMastered();
    },
    get isOpen() { return open; },
    dispose() {
      if (disposed) return;
      close();
      disposed = true;
      card.dispose();
      root.removeEventListener('click', onClick);
      input.removeEventListener('input', search);
      input.removeEventListener('keydown', onInputKey);
      hits.removeEventListener('keydown', onHitsKey);
      root.remove();
    },
  };
}
