import { renderPrimaryNavigation, renderSectionButton, type AppSection } from './page-frame';

/**
 * Разметка оболочки до загрузки данных (D-043): боковое меню из пяти разделов, внизу «Настройки», тема и статус
 * сохранения; баннер сохранения и пустые места разделов. `main` остаётся `inert` до получения права записи.
 */
export function renderAppShell(fallback: AppSection, available: readonly AppSection[]): string {
  const pageMarkup: Record<AppSection, string> = {
    lesson: '<section id="lesson-mount" data-page-frame="lesson" class="page-frame-pad" aria-label="Занятие" hidden></section>',
    foundation: '<div id="foundation-mount" data-page-frame="foundation" hidden></div>',
    harmony: '<section id="harmony-mount" data-page-frame="harmony" aria-label="Ритм" hidden></section>',
    tracks: '<section id="tracks-mount" data-page-frame="tracks" aria-label="Песни" hidden></section>',
    progress: '<section id="progress-mount" data-page-frame="progress" class="page-frame-pad" aria-label="Прогресс" hidden></section>',
    settings: '<section id="settings-mount" data-page-frame="settings" class="page-frame-pad" aria-label="Настройки" hidden></section>',
  };
  return `
    <div class="app-shell" data-section="${fallback}">
      <header class="site-header">
        <a class="brand" href="#" aria-label="bass.study — к началу страницы"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>bass<span class="brand-dot">.</span>study</a>
        ${renderPrimaryNavigation(fallback, available)}
        <div class="nav-bottom">
          ${available.includes('settings') ? renderSectionButton('settings', fallback) : ''}
          <div class="theme-control"><span>Тема</span><div class="segmented" role="group" aria-label="Тема оформления"><button type="button" data-theme-choice="light" aria-pressed="false" disabled>Светлая</button><button type="button" data-theme-choice="dark" aria-pressed="false" disabled>Тёмная</button></div></div>
          <span class="local-badge"><span aria-hidden="true"></span><span id="local-save-status" role="status">Локальный тренажёр</span><button type="button" id="open-storage-details" class="text-button" aria-controls="persistence-banner" aria-expanded="false" hidden>Без сохранения · подробнее</button></span>
        </div>
      </header>

      <div class="app-content">
      <div id="persistence-banner" class="persistence-banner" role="status"><span id="persistence-message">Читаем локальные настройки…</span><button type="button" class="secondary-button button-compact" id="retry-save" hidden>Повторить сохранение</button><button type="button" class="secondary-button button-compact" id="retry-tab" hidden>Проверить снова</button></div>
      <main inert aria-busy="true">
        ${available.map(id => pageMarkup[id]).join('')}
      </main>
      </div>
    </div>
  `;
}
