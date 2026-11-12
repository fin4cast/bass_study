/** Keep native controls and the foreground dialog in charge of their own keys. */
function allowsTransportShortcut(event: KeyboardEvent, surface: HTMLElement): boolean {
  const document = surface.ownerDocument;
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
    || document.hidden || document.querySelector('dialog[open]') || surface.closest('[hidden], [inert]')
    || !surface.getClientRects().length) return false;
  const target = event.target;
  return !(target instanceof Element && target.closest(
    'input, select, textarea, button, a, summary, [inert], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="tab"]',
  ));
}

export interface TransportKeyActions {
  /** Escape. */
  readonly stop: () => void;
  /** Space: пауза во время звучания, иначе продолжение или старт. */
  readonly toggle: () => void;
  /** Элементы, на которых Space оставлен браузеру (например, прокрутка области). */
  readonly keepSpaceOn?: string;
}

/** Escape останавливает, Space переключает транспорт раздела, если клавишу не забрал элемент управления или диалог. */
export function handleTransportKey(event: KeyboardEvent, surface: HTMLElement, actions: TransportKeyActions): void {
  if (!allowsTransportShortcut(event, surface)) return;
  const space = event.code === 'Space' || event.key === ' ';
  if (space && actions.keepSpaceOn && event.target instanceof Element && event.target.matches(actions.keepSpaceOn)) return;
  if (event.key === 'Escape') { event.preventDefault(); actions.stop(); }
  else if (space) { event.preventDefault(); actions.toggle(); }
}
