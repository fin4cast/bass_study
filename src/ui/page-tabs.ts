interface TabOptions<Key> {
  readonly keys: readonly Key[];
  readonly select: (key: Key) => void;
  readonly canSelect?: () => boolean;
  readonly signal: AbortSignal;
}

/** The feature owns selection; tabs project it onto paired panels and route user intent back. */
export function bindPageTabs<Key>(list: HTMLElement, options: TabOptions<Key>) {
  const tabs = [...list.querySelectorAll<HTMLButtonElement>(':scope > button[role="tab"]')];
  if (!tabs.length || tabs.length !== options.keys.length) throw new Error('Список вкладок не соответствует разделам.');
  const panels = tabs.map(tab => {
    const panel = list.ownerDocument.getElementById(tab.getAttribute('aria-controls') ?? '');
    if (panel?.getAttribute('role') !== 'tabpanel' || panel.getAttribute('aria-labelledby') !== tab.id) {
      throw new Error(`У вкладки «${tab.textContent}» отсутствует связанная панель.`);
    }
    return panel;
  });
  const listener = { signal: options.signal };
  function select(index: number) {
    if (tabs[index].disabled || options.canSelect?.() === false) return false;
    options.select(options.keys[index]);
    return true;
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index), listener);
    tab.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const enabled = tabs.filter(button => !button.disabled);
      const current = enabled.indexOf(tab);
      if (current < 0) return;
      let next: HTMLButtonElement;
      switch (event.key) {
        case 'ArrowLeft': next = enabled[(current + enabled.length - 1) % enabled.length]; break;
        case 'ArrowRight': next = enabled[(current + 1) % enabled.length]; break;
        case 'Home': next = enabled[0]; break;
        case 'End': next = enabled[enabled.length - 1]; break;
        default: return;
      }
      if (!select(tabs.indexOf(next))) return;
      event.preventDefault();
      next.focus({ preventScroll: true });
    }, listener);
  });

  return {
    setSelected(key: Key) {
      tabs.forEach((tab, index) => {
        const selected = options.keys[index] === key;
        tab.tabIndex = selected ? 0 : -1;
        tab.setAttribute('aria-selected', String(selected));
        panels[index].hidden = !selected;
      });
    },
  };
}
