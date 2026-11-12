import { renderPageHeader, renderPrimaryNavigation, type AppSection } from './page-frame';

/** Разметка оболочки до загрузки данных: шапка, навигация, баннер сохранения и пустые места разделов. `main` остаётся `inert`. */
export function renderAppShell(fallback: AppSection, available: readonly AppSection[]): string {
  const genericPage = (section: AppSection, id: string, descriptionText: string) => `<section data-page-frame="${section}" class="page-frame-inset" hidden>${renderPageHeader(section, { descriptionText })}<div id="${id}"></div></section>`;
  const pageMarkup: Record<AppSection, string> = {
    foundation: '<div id="foundation-mount" data-page-frame="foundation" hidden></div>',
    ear: genericPage('ear', 'ear-mount', 'Сравни тонику и целевой звук, затем выбери ступень.'),
    harmony: '<section id="harmony-mount" data-page-frame="harmony" aria-label="Метроном и ритм" hidden></section>',
    tracks: '<section id="tracks-mount" data-page-frame="tracks" aria-label="Табулатура и ноты" hidden></section>',
    input: genericPage('input', 'input-mount', 'Проверь уровень и частоту сигнала.'),
    route: genericPage('route', 'route-mount', 'Гриф, слух и практика на одном музыкальном материале.'),
  };
  return `
    <div class="app-shell" data-section="${fallback}" data-auxiliary="none">
      <header class="site-header">
        <a class="brand" href="#" aria-label="bass.study — к началу страницы"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>bass<span class="brand-dot">.</span>study</a>
        ${renderPrimaryNavigation(fallback, available)}
        <div class="nav-secondary">
          <button type="button" id="open-history" class="text-button" aria-expanded="false" disabled>Мои занятия</button>
          <button type="button" id="open-introduction" class="text-button" disabled>Введение</button>
        </div>
        <div class="sidebar-art" aria-hidden="true"><img src="${import.meta.env.BASE_URL}images/bass-headstock.webp" alt="" width="568" height="1788" draggable="false"></div>
        <div class="nav-bottom">
          <div class="theme-control"><span>Тема</span><div class="segmented" role="group" aria-label="Тема оформления"><button type="button" data-theme-choice="light" aria-pressed="false" disabled>Светлая</button><button type="button" data-theme-choice="dark" aria-pressed="false" disabled>Тёмная</button></div></div>
          <span class="local-badge"><span aria-hidden="true"></span><span id="local-save-status" role="status">Локальный тренажёр</span><button type="button" id="open-storage-details" class="text-button" aria-controls="persistence-banner" aria-expanded="false" hidden>Без сохранения · подробнее</button></span>
        </div>
      </header>

      <div class="app-content">
      <div id="persistence-banner" class="persistence-banner" role="status"><span id="persistence-message">Читаем локальные настройки…</span><button type="button" class="secondary-button button-compact" id="retry-save" hidden>Повторить сохранение</button><button type="button" class="secondary-button button-compact" id="retry-tab" hidden>Проверить снова</button></div>
      <main inert aria-busy="true">
        <section id="onboarding-mount" aria-label="Введение" hidden></section>

        <div id="route-session-mount"></div>
        ${available.map(id => pageMarkup[id]).join('')}
        <section id="history-mount" aria-label="История и настройки" hidden></section>
      </main>
      </div>
    </div>
  `;
}
