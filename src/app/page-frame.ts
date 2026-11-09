import type { AppPreferences } from '../storage';

export type AppSection = AppPreferences['activeModule'];

const sections = {
  foundation: { title: 'Гриф и практика' },
  ear: { title: 'Слух' },
  harmony: { title: 'Метроном и ритм', workspace: 'bounded' },
  tracks: { title: 'Табулатура и ноты' },
  input: { title: 'Аудиовход' },
  route: { title: 'Маршрут занятия' },
} satisfies Record<AppSection, { title: string; workspace?: 'bounded' }>;

export const APP_SECTIONS = Object.keys(sections) as readonly AppSection[];

export function workspaceLayout(section: AppSection) {
  const page = sections[section];
  return 'workspace' in page ? page.workspace : 'flow';
}

export function renderPrimaryNavigation(initial: AppSection, available: readonly AppSection[] = APP_SECTIONS) {
  const buttons = available.map(section => {
    const current = section === initial;
    return `<button type="button" data-app-module="${section}"${current ? ' aria-current="page"' : ''} disabled>${sections[section].title}</button>`;
  });
  return `<nav class="module-navigation" aria-label="Раздел тренажёра">${buttons.join('')}</nav>`;
}

interface PageHeaderOptions {
  readonly id?: string;
  readonly className?: string;
  readonly descriptionId?: string;
  readonly descriptionText?: string;
  readonly actions?: string;
  readonly navigation?: string;
}

/** Options are trusted markup owned by the calling screen. Set changing text via the DOM. */
export function renderPageHeader(section: AppSection, options: PageHeaderOptions = {}) {
  const { id = `page-title-${section}`, className = '', descriptionId, descriptionText = '', actions = '', navigation = '' } = options;
  const description = descriptionId || descriptionText
    ? `<p${descriptionId ? ` id="${descriptionId}"` : ''} class="page-header-context">${descriptionText}</p>`
    : '';
  return `<header class="page-header ${className}">
    <div class="page-header-row"><div class="page-header-copy"><h1 id="${id}" data-page-heading="${section}">${sections[section].title}</h1>${description}</div>${actions}</div>
    ${navigation ? `<div class="page-header-navigation">${navigation}</div>` : ''}
  </header>`;
}

export function renderPageSettingsButton(id: string, panelId: string, expanded = false) {
  return `<button type="button" id="${id}" class="secondary-button button-compact page-settings-button" data-page-settings-toggle aria-controls="${panelId}" aria-expanded="${expanded}">
    <svg viewBox="0 0 20 16" width="20" height="16" aria-hidden="true"><path d="M4 2v12m6-12v12m6-12v12"/><path class="page-settings-faders" d="M2 6h4m2 4h4m2-5h4"/></svg>
    <span>Параметры</span><span class="page-settings-lamp" aria-hidden="true"></span>
  </button>`;
}
