import type { AppPreferences } from '../storage';
import { escapeHtml } from '../ui/html';

/** Раздел оболочки — то же, что сохраняемый `AppPreferences['activeModule']` (D-043). */
export type AppSection = AppPreferences['activeModule'];

const ICONS = {
  lesson: '<path d="M4 3h9l3 3v11H4z"/><path d="M7 9h6M7 12h6M7 6h3"/>',
  foundation: '<rect x="2" y="5" width="16" height="10" rx="2"/><path d="M6 5v10M10 5v10M14 5v10M2 8.5h16M2 11.5h16"/>',
  harmony: '<path d="M7 17 9 3h2l2 14z"/><path d="M10 11l5-6"/>',
  tracks: '<path d="M8 15V4l9-2v11"/><circle cx="5.5" cy="15" r="2.5"/><circle cx="14.5" cy="13" r="2.5"/>',
  progress: '<path d="M3 16h14"/><path d="M5 13l4-4 3 2 4-6"/>',
  settings: '<circle cx="10" cy="10" r="2.5"/><path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M4.3 15.7l1.8-1.8M13.9 6.1l1.8-1.8"/>',
} satisfies Record<AppSection, string>;

const sections = {
  lesson: { title: 'Занятие' },
  foundation: { title: 'Гриф' },
  harmony: { title: 'Ритм', workspace: 'bounded' },
  tracks: { title: 'Песни' },
  // Прогресс прокручивает только свои списки, поэтому занимает высоту окна целиком.
  progress: { title: 'Прогресс', workspace: 'bounded' },
  settings: { title: 'Настройки' },
} satisfies Record<AppSection, { title: string; workspace?: 'bounded' }>;

/** Порядок разделов: пять в основном меню, «Настройки» — внизу меню рядом с темой. */
export const APP_SECTIONS = Object.keys(sections) as readonly AppSection[];
export const MENU_SECTIONS: readonly AppSection[] = Object.freeze(['lesson', 'foundation', 'harmony', 'tracks', 'progress']);

export function workspaceLayout(section: AppSection) {
  const page = sections[section];
  return 'workspace' in page ? page.workspace : 'flow';
}

/** Кнопка раздела с иконкой; подпись скрывается в узком меню, но остаётся доступным именем. */
export function renderSectionButton(section: AppSection, current: AppSection) {
  return `<button type="button" class="nav-item" data-app-module="${section}"${section === current ? ' aria-current="page"' : ''} disabled><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${ICONS[section]}</svg><span>${sections[section].title}</span></button>`;
}

export function renderPrimaryNavigation(initial: AppSection, available: readonly AppSection[] = APP_SECTIONS) {
  const buttons = MENU_SECTIONS.filter(section => available.includes(section)).map(section => renderSectionButton(section, initial));
  return `<nav class="module-navigation" aria-label="Разделы тренажёра">${buttons.join('')}</nav>`;
}

interface PageHeaderOptions {
  readonly id?: string;
  readonly className?: string;
  readonly descriptionId?: string;
  readonly descriptionText?: string;
  readonly actions?: string;
  readonly navigation?: string;
}

/** `actions` and `navigation` are trusted markup owned by the calling screen; `descriptionText` is escaped. Set changing text via the DOM. */
export function renderPageHeader(section: AppSection, options: PageHeaderOptions = {}) {
  const { id = `page-title-${section}`, className = '', descriptionId, descriptionText = '', actions = '', navigation = '' } = options;
  const description = descriptionId || descriptionText
    ? `<p${descriptionId ? ` id="${descriptionId}"` : ''} class="page-header-context">${escapeHtml(descriptionText)}</p>`
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
