import './select-picker.css';

export interface SelectPicker {
  refresh(): void;
  dispose(): void;
}

const enhanced = new WeakMap<HTMLSelectElement, SelectPicker>();
let nextPickerId = 0;

/** A single-value picker backed by the original select and its change event. */
export function enhanceSelect(select: HTMLSelectElement, { gridColumns = 1 }: { gridColumns?: number } = {}): SelectPicker {
  const existing = enhanced.get(select);
  if (existing) return existing;
  if (select.multiple) throw new TypeError('Picker поддерживает только одиночный выбор.');
  if (!Number.isInteger(gridColumns) || gridColumns < 1) throw new RangeError('Число колонок должно быть положительным целым.');

  const doc = select.ownerDocument;
  const id = `select-picker-${++nextPickerId}`;
  const previousAriaHidden = select.getAttribute('aria-hidden');
  const previousTabIndex = select.getAttribute('tabindex');
  const wrapper = doc.createElement('div');
  wrapper.className = 'select-picker';
  wrapper.style.setProperty('--picker-columns', String(gridColumns));
  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-picker-trigger form-control';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-controls', id);
  trigger.setAttribute('aria-expanded', 'false');
  const list = doc.createElement('div');
  list.id = id;
  list.className = 'select-picker-options';
  if (gridColumns > 1) list.classList.add('is-grid');
  list.setAttribute('role', 'listbox');
  list.hidden = true;

  select.before(wrapper);
  wrapper.append(select, trigger, list);
  select.classList.add('select-picker-native');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;

  let open = false;
  let disposed = false;
  let active = -1;
  let options: HTMLOptionElement[] = [];
  let optionElements: HTMLButtonElement[] = [];
  let search = '';
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  function disabled(option: HTMLOptionElement): boolean {
    return option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
  }

  function name(): string {
    const labelledBy = select.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(label => doc.getElementById(label)?.textContent?.trim()).filter(Boolean).join(' ');
      if (text) return text;
    }
    return select.getAttribute('aria-label') || select.labels?.[0]?.querySelector('span')?.textContent?.trim() || 'Выбор';
  }

  function close(restoreFocus = false): void {
    open = false;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    search = '';
    clearTimeout(searchTimer);
    if (restoreFocus && trigger.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
  }

  function focusOption(index: number): void {
    if (index < 0 || index >= options.length || disabled(options[index])) return;
    active = index;
    optionElements[index]?.focus({ preventScroll: true });
    optionElements[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function show(preferLast = false): void {
    if (trigger.disabled) return;
    open = true;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const selected = options.findIndex(option => option.selected && !disabled(option));
    const first = options.findIndex(option => !disabled(option));
    const last = options.map(option => !disabled(option)).lastIndexOf(true);
    focusOption(selected >= 0 ? selected : preferLast ? last : first);
  }

  function commit(index: number): void {
    const option = options[index];
    if (!option || disabled(option)) return;
    const changed = select.value !== option.value;
    select.value = option.value;
    close(true);
    refresh();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function refresh(): void {
    if (disposed) return;
    const focusedValue = options[active]?.value;
    const hadFocus = list.contains(doc.activeElement);
    options = Array.from(select.options).filter(option => !option.hidden);
    const selected = select.selectedOptions[0];
    const label = name();
    trigger.textContent = selected?.label || 'Не выбрано';
    trigger.setAttribute('aria-label', `${label}: ${selected?.label || 'не выбрано'}`);
    trigger.disabled = select.disabled || !options.some(option => !disabled(option));
    list.setAttribute('aria-label', `${label}: варианты`);
    optionElements = options.map((option, index) => {
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'select-picker-option';
      item.id = `${id}-option-${index}`;
      item.tabIndex = -1;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.textContent = option.label;
      item.disabled = disabled(option);
      item.addEventListener('click', () => commit(index));
      return item;
    });
    list.replaceChildren(...optionElements);
    if (trigger.disabled) close();
    else if (open && hadFocus) {
      const previous = options.findIndex(option => option.value === focusedValue && !disabled(option));
      focusOption(previous >= 0 ? previous : options.findIndex(option => option.selected && !disabled(option)));
    }
  }

  function onTrigger(): void { if (open) close(true); else show(); }
  function onNativeFocus(): void { if (!trigger.disabled) trigger.focus({ preventScroll: true }); }
  function onOutside(event: PointerEvent): void { if (open && event.target instanceof Node && !wrapper.contains(event.target)) close(); }
  function onFocusOut(event: FocusEvent): void { if (open && event.relatedTarget instanceof Node && !wrapper.contains(event.relatedTarget)) close(); }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Tab') { close(open); return; }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (open && event.target !== trigger) commit(active);
      else if (open) close(true);
      else show();
      return;
    }
    const movement: Record<string, number> = { ArrowDown: gridColumns, ArrowUp: -gridColumns, ArrowRight: 1, ArrowLeft: -1 };
    if (Object.hasOwn(movement, event.key) || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!open) { show(event.key === 'ArrowUp' || event.key === 'End'); if (!['Home', 'End'].includes(event.key)) return; }
      let index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, active + movement[event.key]));
      const direction = event.key === 'End' || (movement[event.key] || 1) < 0 ? -1 : 1;
      while (index >= 0 && index < options.length && disabled(options[index])) index += direction;
      focusOption(index);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!open) show();
      event.preventDefault();
      search += event.key.toLocaleLowerCase();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { search = ''; }, 650);
      const index = options.findIndex(option => !disabled(option) && option.label.toLocaleLowerCase().startsWith(search));
      focusOption(index);
    }
  }

  const observer = new MutationObserver(refresh);
  observer.observe(select, { attributes: true, childList: true, subtree: true, characterData: true });
  select.addEventListener('change', refresh);
  select.addEventListener('focus', onNativeFocus);
  trigger.addEventListener('click', onTrigger);
  wrapper.addEventListener('keydown', onKeyDown);
  wrapper.addEventListener('focusout', onFocusOut);
  doc.addEventListener('pointerdown', onOutside, true);
  refresh();

  const picker: SelectPicker = { refresh, dispose() {
    if (disposed) return;
    close();
    disposed = true;
    observer.disconnect();
    select.removeEventListener('change', refresh);
    select.removeEventListener('focus', onNativeFocus);
    trigger.removeEventListener('click', onTrigger);
    wrapper.removeEventListener('keydown', onKeyDown);
    wrapper.removeEventListener('focusout', onFocusOut);
    doc.removeEventListener('pointerdown', onOutside, true);
    select.classList.remove('select-picker-native');
    if (previousAriaHidden === null) select.removeAttribute('aria-hidden'); else select.setAttribute('aria-hidden', previousAriaHidden);
    if (previousTabIndex === null) select.removeAttribute('tabindex'); else select.setAttribute('tabindex', previousTabIndex);
    wrapper.replaceWith(select);
    enhanced.delete(select);
  } };
  enhanced.set(select, picker);
  return picker;
}
