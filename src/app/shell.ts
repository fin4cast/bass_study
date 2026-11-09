import { workspaceLayout, type AppSection } from './page-frame';

export function mountShell(shell: HTMLElement, options: {
  history: HTMLElement;
  introduction: HTMLElement;
  openIntroduction(): void;
  stopIntroduction(): void;
  navigate(section: AppSection): void;
  reveal(target: HTMLElement, block?: ScrollLogicalPosition): void;
}) {
  const controller = new AbortController();
  const listen = { signal: controller.signal };
  const historyButton = shell.querySelector<HTMLButtonElement>('#open-history')!;
  const introductionButton = shell.querySelector<HTMLButtonElement>('#open-introduction')!;
  const drawer = options.history.querySelector<HTMLDetailsElement>('.history-drawer')!;
  const buttons = Array.from(shell.querySelectorAll<HTMLButtonElement>('.module-navigation [data-app-module]'));
  const pages = Array.from(shell.querySelectorAll<HTMLElement>('main > [data-page-frame]'));
  historyButton.setAttribute('aria-controls', options.history.id);
  introductionButton.setAttribute('aria-controls', options.introduction.id);
  const syncAuxiliary = () => {
    shell.dataset.auxiliary = drawer.open ? 'history' : options.introduction.hidden ? 'none' : 'introduction';
    introductionButton.setAttribute('aria-expanded', String(!options.introduction.hidden));
  };
  function setActivePage(section: AppSection) {
    shell.dataset.section = section;
    shell.dataset.workspaceLayout = workspaceLayout(section);
    for (const page of pages) page.hidden = page.dataset.pageFrame !== section;
    for (const button of buttons) {
      const selected = button.dataset.appModule === section;
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
  function setHistory(open: boolean) {
    options.history.hidden = !open;
    drawer.open = open;
    historyButton.setAttribute('aria-expanded', String(open));
    syncAuxiliary();
  }
  function closeIntroduction() {
    if (options.introduction.hidden) return;
    options.stopIntroduction();
    options.introduction.hidden = true;
    syncAuxiliary();
  }
  introductionButton.addEventListener('click', () => {
    setHistory(false);
    options.openIntroduction();
    syncAuxiliary();
    const heading = options.introduction.querySelector<HTMLElement>('h2');
    if (heading) options.reveal(heading, 'start');
  }, listen);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      setHistory(false);
      closeIntroduction();
      options.navigate(button.dataset.appModule as AppSection);
      window.scrollTo({ top: 0 });
    }, listen);
  }
  historyButton.addEventListener('click', () => {
    const open = !drawer.open;
    if (open) closeIntroduction();
    setHistory(open);
  }, listen);
  drawer.addEventListener('toggle', () => {
    historyButton.setAttribute('aria-expanded', String(drawer.open));
    if (drawer.open) {
      // The history view renders the body before this listener measures it.
      const summary = drawer.querySelector('summary');
      if (summary) options.reveal(summary, 'start');
    } else {
      if (drawer.contains(document.activeElement)) historyButton.focus({ preventScroll: true });
      options.history.hidden = true;
    }
    syncAuxiliary();
  }, listen);
  syncAuxiliary();
  return {
    setActivePage, syncAuxiliary,
    focusActivePage() { buttons.find(button => button.getAttribute('aria-current') === 'page')?.focus(); },
    dispose: () => controller.abort(),
  };
}
