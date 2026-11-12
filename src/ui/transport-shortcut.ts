/**
 * Общие клавиши транспорта звучащих разделов (P14-01, эталон — экран игры VIS-11):
 * пробел — играть / пауза / продолжить с той же позиции, Esc — «С начала»
 * (остановка к началу; следующий старт — с отсчётом, если он включён).
 */
export type TransportIntent = 'toggle' | 'restart';

/** Что находится в фокусе при нажатии клавиши. */
export type TransportFocus =
  /** Не элемент управления: страница, текст, прокручиваемая область. */
  | 'none'
  /** Обычная кнопка внутри раздела: своего действия на Esc у неё нет. */
  | 'own-button'
  /** Поле, ссылка, раскрытая кнопка или элемент со своими клавишами. */
  | 'control';

export interface TransportKeyInput {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  /** Нажат Ctrl, Alt, Meta или Shift. */
  readonly modified: boolean;
  readonly defaultPrevented: boolean;
}

export interface TransportKeyContext {
  /** Раздел скрыт, вкладка не видна или открыт модальный диалог. */
  readonly blocked: boolean;
  readonly focus: TransportFocus;
  /** Пробел оставлен браузеру на этом элементе (например, прокрутка области). */
  readonly keepSpace?: boolean;
}

/** Чистое правило клавиш транспорта; разбор события и фокуса — в `handleTransportKey`. */
export function transportKeyIntent(input: TransportKeyInput, context: TransportKeyContext): TransportIntent | null {
  if (input.defaultPrevented || input.repeat || input.modified || context.blocked) return null;
  if (input.key === 'Escape') return context.focus === 'control' ? null : 'restart';
  const space = input.code === 'Space' || input.key === ' ';
  // На кнопке пробел нажимает её саму: транспорт не перехватывает чужое действие.
  if (!space || context.focus !== 'none' || context.keepSpace) return null;
  return 'toggle';
}

const CONTROLS = 'input, select, textarea, button, a, summary, [inert], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="tab"]';

function focusKind(target: EventTarget | null, surface: HTMLElement): TransportFocus {
  if (!(target instanceof Element)) return 'none';
  const control = target.closest(CONTROLS);
  if (!control) return 'none';
  if (control instanceof HTMLButtonElement && surface.contains(control)
    && control.getAttribute('aria-expanded') !== 'true' && !control.hasAttribute('aria-haspopup')) return 'own-button';
  return 'control';
}

function blocked(surface: HTMLElement) {
  const document = surface.ownerDocument;
  return document.hidden || !!document.querySelector('dialog[open]') || !!surface.closest('[hidden], [inert]') || !surface.getClientRects().length;
}

/** Keep native controls and the foreground dialog in charge of their own keys. */
export function allowsTransportShortcut(event: KeyboardEvent, surface: HTMLElement): boolean {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || blocked(surface)) return false;
  return focusKind(event.target, surface) === 'none';
}

export interface TransportKeyActions {
  /** Escape: «С начала» — остановка к началу. */
  readonly stop: () => void;
  /** Space: пауза во время звучания, иначе продолжение или старт. */
  readonly toggle: () => void;
  /** Элементы, на которых Space оставлен браузеру (например, прокрутка области). */
  readonly keepSpaceOn?: string;
}

/** Esc возвращает к началу, пробел переключает транспорт раздела, если клавишу не забрал элемент управления или диалог. */
export function handleTransportKey(event: KeyboardEvent, surface: HTMLElement, actions: TransportKeyActions): void {
  const target = event.target;
  const intent = transportKeyIntent({
    key: event.key, code: event.code, repeat: event.repeat, defaultPrevented: event.defaultPrevented,
    modified: event.ctrlKey || event.altKey || event.metaKey || event.shiftKey,
  }, {
    blocked: blocked(surface),
    focus: focusKind(target, surface),
    keepSpace: !!actions.keepSpaceOn && target instanceof Element && target.matches(actions.keepSpaceOn),
  });
  if (!intent) return;
  event.preventDefault();
  if (intent === 'restart') actions.stop(); else actions.toggle();
}
