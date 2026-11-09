/** Keep native controls and the foreground dialog in charge of their own keys. */
export function allowsTransportShortcut(event: KeyboardEvent, surface: HTMLElement): boolean {
  const document = surface.ownerDocument;
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
    || document.hidden || document.querySelector('dialog[open]') || surface.closest('[hidden], [inert]')
    || !surface.getClientRects().length) return false;
  const target = event.target;
  return !(target instanceof Element && target.closest(
    'input, select, textarea, button, a, summary, [inert], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="tab"]',
  ));
}
