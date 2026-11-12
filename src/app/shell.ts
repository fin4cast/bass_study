import { workspaceLayout, type AppSection } from './page-frame';

/** Навигация оболочки: кнопки разделов (меню и «Настройки» внизу) и видимость страниц. */
export function mountShell(shell: HTMLElement, options: {
  navigate(section: AppSection): void;
}) {
  const controller = new AbortController();
  const listen = { signal: controller.signal };
  const buttons = Array.from(shell.querySelectorAll<HTMLButtonElement>('.site-header [data-app-module]'));
  const pages = Array.from(shell.querySelectorAll<HTMLElement>('main > [data-page-frame]'));
  /** `layout` уточняет компоновку раздела, например «Занятие» на экране игры — ограниченная высота. */
  function setActivePage(section: AppSection, layout: 'bounded' | 'flow' = workspaceLayout(section)) {
    shell.dataset.section = section;
    shell.dataset.workspaceLayout = layout;
    for (const page of pages) page.hidden = page.dataset.pageFrame !== section;
    for (const button of buttons) {
      const selected = button.dataset.appModule === section;
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
  for (const button of buttons) {
    button.addEventListener('click', () => {
      options.navigate(button.dataset.appModule as AppSection);
      window.scrollTo({ top: 0 });
    }, listen);
  }
  return {
    setActivePage,
    setLayout(layout: 'bounded' | 'flow') { shell.dataset.workspaceLayout = layout; },
    focusActivePage() { buttons.find(button => button.getAttribute('aria-current') === 'page')?.focus(); },
    dispose: () => controller.abort(),
  };
}
