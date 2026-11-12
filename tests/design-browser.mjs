// Визуальная матрица атласа «Гриф» (VIS-01 r5) и экранов, на которые он ведёт после P13-08: экран игры и «Проверь себя».
// Общие роли оформления (заголовок страницы, вкладки, панели параметров, поля и раскрытия) сравниваются у «Грифа»,
// «Ритма», «Песен» и «Настройки → Аудиовход». Измерения — по computed styles и геометрии; это не сертификация WCAG.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runNotationBrowserChecks } from './helpers/notation-browser-harness.mjs';
import { markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';

const checks = [];
const check = (name, run) => checks.push({ name, scope: 'ui', run });
const current = page => page.locator('.site-header [aria-current="page"]').getAttribute('data-app-module');
async function navigate(page, id) {
  await page.locator(`.site-header [data-app-module="${id}"]`).click();
  await page.waitForFunction(value => document.querySelector('.site-header [aria-current="page"]')?.dataset.appModule === value, id);
}
/** Стартовый раздел оболочки P13 — «Занятие»; атлас открывается из меню (после перезагрузки — сохранённый раздел). */
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert);
  if (await current(page) !== 'foundation') await navigate(page, 'foundation');
  await page.locator('[data-position]').first().waitFor();
}
const theme = (page, value) => page.locator(`.site-header [data-theme-choice="${value}"]`).click();
async function settings(page) { if (!await page.locator('#study-settings').isVisible()) await page.locator('#toggle-study-settings').click(); }
async function area(page) { await settings(page); if (!await page.locator('#area-settings').evaluate(el => el.open)) await page.locator('#area-settings > summary').click(); }
async function display(page) { await settings(page); if (!await page.locator('#display-settings').evaluate(el => el.open)) await page.locator('#display-settings > summary').click(); }
async function range(page, min, max) {
  await area(page);
  await page.locator('#fret-max').fill('24'); await page.locator('#fret-min').fill(String(min)); await page.locator('#fret-max').fill(String(max));
}
async function form(page, label) { await settings(page); await page.locator('#box-select').selectOption({ label }); }
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function geometry(page, min, max) {
  await page.waitForFunction(() => [...document.querySelectorAll('svg.study-fretboard')].every(svg => Math.abs(Number(svg.getAttribute('viewBox').split(' ')[2]) - svg.getBoundingClientRect().width) < 2));
  assert.deepEqual((await page.locator('.study-fretboard .fret-number').allTextContents()).map(Number), Array.from({ length: max - min + 1 }, (_, i) => min + i));
  for (const svg of await page.locator('svg.study-fretboard').all()) assert.deepEqual(await svg.locator('.string-name').allTextContents(), ['G', 'D', 'A', 'E']);
  const layers = await page.locator('svg.study-fretboard').evaluateAll(svgs => svgs.map(svg => {
    const surface = svg.querySelector('.board-surface').getBoundingClientRect();
    return [...svg.querySelectorAll('.octave-underlay')].map(layer => { const bounds = layer.getBoundingClientRect(); return { top: bounds.top - surface.top, bottom: surface.bottom - bounds.bottom }; });
  }).flat());
  for (const layer of layers) assert.ok(layer.top >= -.1 && layer.bottom >= -.1, `Octave layer exceeds the neck surface: ${JSON.stringify(layer)}`);
  const rows = await page.locator('.study-fretboard .position.is-large').evaluateAll(elements => elements.map(element => {
    const note = element.querySelector('.note-marker'), label = element.querySelector('[data-position-label]'), bounds = note.getBoundingClientRect(), svg = element.closest('svg').getBoundingClientRect();
    return { id: element.dataset.position, width: bounds.width, height: bounds.height, font: label ? getComputedStyle(label).fontSize : null, fits: bounds.left >= svg.left && bounds.right <= svg.right && bounds.top >= svg.top && bounds.bottom <= svg.bottom };
  }));
  for (const row of rows) { assert.ok(Math.abs(row.width - 46) < .1, JSON.stringify(row)); assert.ok(Math.abs(row.height - 46) < .1); if (row.font) assert.equal(row.font, '18px'); assert.equal(row.fits, true, JSON.stringify(row)); }
  const ids = await page.locator('[data-position]').evaluateAll(elements => elements.map(element => element.dataset.position));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  return { parts: await page.locator('svg.study-fretboard').count(), positions: ids.length, large: rows.length };
}
/** Позиции материала «Проверь себя» — контуры на грифе ответа, сопоставленные с ячейками по геометрии страницы. */
async function checkMaterial(page) {
  const host = page.locator('[data-lesson-screen="check"]');
  const material = await host.evaluate(element => {
    const cells = [...element.querySelectorAll('[data-cell]')].map(cell => ({ id: cell.dataset.cell, rect: cell.getBoundingClientRect() }));
    return [...element.querySelectorAll('.ck-wrap svg .mb-ghost')].map(ghost => {
      const box = ghost.getBoundingClientRect(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
      return cells.filter(({ rect }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom).map(cell => cell.id);
    });
  });
  assert.ok(material.length && material.every(ids => ids.length === 1), JSON.stringify(material));
  return material.map(([id]) => id).sort();
}

// Типичная ширина 1366 в обеих темах — быстрый набор; остальные четыре ширины — полный (FULL_ONLY.viewports).
const approvedDefault = (widths, { screenshots }) => async ({ page, resultDir }) => {
  await ready(page);
  assert.equal(await page.locator('#fret-min').inputValue(), '0'); assert.equal(await page.locator('#fret-max').inputValue(), '12');
  assert.equal(await page.locator('[data-position]').count(), 52); assert.equal(await page.locator('.position.is-large').count(), 8);
  for (const removed of ['#history-mount', '#training-mount', '#player-mount', '#notation-mount', '#onboarding-mount']) assert.equal(await page.locator(removed).count(), 0, removed);
  assert.equal(await page.locator('#persistence-banner').isVisible(), false);
  const layouts = [];
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1100 });
      for (const limits of [[0, 12], [12, 24]]) { await range(page, ...limits); layouts.push({ theme: choice, width, range: limits, ...await geometry(page, ...limits) }); }
    }
    if (!screenshots) continue;
    await page.setViewportSize({ width: 1440, height: 1300 }); await range(page, 0, 12);
    await page.locator('[data-position="A:7"]').click(); await page.locator('#toggle-study-settings').focus();
    await frame(page);
    await page.screenshot({ path: join(resultDir, `p9-${choice}.png`), fullPage: true });
  }
  return { layouts, brandBars: await page.locator('.brand-mark i').evaluateAll(elements => elements.map(element => getComputedStyle(element).height)) };
};
check('approved-default-and-both-themes-at-1366', approvedDefault([1366], { screenshots: true }));
check('approved-default-and-both-themes-at-four-other-widths', approvedDefault([1440, 1024, 736, 320], { screenshots: false }));

check('octave-semantics-independent-layers-and-shared-tonic', async ({ page }) => {
  await ready(page);
  await display(page);
  assert.deepEqual(await page.locator('[data-octave-group]').allTextContents(), ['От A1Полный участок · до A2', 'От A2Фрагмент · до D3']);
  assert.deepEqual(await page.locator('[data-octave-group]').evaluateAll(elements => elements.map(element => element.dataset.complete)), ['true', 'false']);
  assert.equal(await page.locator('[data-position="D:7"]').count(), 1);
  await page.locator('#show-interval').uncheck(); assert.equal(await page.locator('.study-interval-link').count(), 0); assert.equal(await page.locator('[data-octave-group]').count(), 2);
  await page.locator('#show-interval').check(); await page.locator('#show-octaves').uncheck(); assert.equal(await page.locator('[data-octave-group]').count(), 0); assert.equal(await page.locator('.study-interval-link').count(), 1);
  await page.locator('#show-octaves').check();
  const groups = await page.locator('#octave-legend').innerText(); await page.locator('[data-position="E:7"]').click(); assert.equal(await page.locator('#octave-legend').innerText(), groups);
  await range(page, 0, 6); assert.equal(await page.locator('[data-complete="true"]').count(), 0); assert.match(await page.locator('#octave-legend').innerText(), /Показан частично/);
  await page.locator('#root-note').selectOption('C'); await page.locator('#structure').selectOption('major-pentatonic'); await form(page, 'Форма E · 2–5'); await range(page, 3, 3);
  assert.equal(await page.locator('[data-octave-group]').count(), 1); assert.match(await page.locator('#octave-legend').innerText(), /До C2/); assert.doesNotMatch(await page.locator('#octave-legend').innerText(), /общая тоника/);
  return { completeA1A2: true, secondFragment: true, physicalA2: 1, boundaryOnlyRegression: true, layerIndependence: true };
});

check('view-range-does-not-clip-exact-form-material-and-survives-reload', async ({ page }) => {
  await ready(page); await form(page, 'Форма B · 7–10');
  assert.equal(await page.locator('#fret-min').inputValue(), '0'); assert.equal(await page.locator('#fret-max').inputValue(), '12');
  await range(page, 0, 5); assert.match(await page.locator('#box-select option:checked').textContent(), /Форма B/);
  assert.equal(await page.locator('#show-whole-form').isVisible(), true);
  // Материал «Проверь себя по этой форме» — точная форма B, а не видимое окно 0–5.
  await page.getByRole('button', { name: 'Проверь себя по этой форме', exact: true }).click();
  await page.locator('[data-lesson-screen="check"]:not([hidden]) [data-ck-title]').waitFor();
  const exact = await checkMaterial(page);
  assert.deepEqual(exact, ['A:10', 'A:7', 'D:10', 'D:7', 'E:10', 'E:8', 'G:7', 'G:9']);
  await page.locator('[data-lesson-screen="check"] [data-act="back"]').click();
  assert.equal(await current(page), 'foundation');
  await page.locator('[data-label-mode="degrees"]').click();
  await page.locator('#show-whole-form').click(); assert.equal(await page.locator('#fret-min').inputValue(), '0'); assert.equal(await page.locator('#fret-max').inputValue(), '10');
  await page.waitForFunction(() => document.querySelector('#persistence-message')?.textContent.includes('Сохранено локально'));
  await page.reload(); await ready(page); assert.match(await page.locator('#box-select option:checked').textContent(), /Форма B/); assert.equal(await page.locator('#fret-max').inputValue(), '10');
  assert.equal(await page.locator('[data-label-mode="degrees"]').getAttribute('aria-pressed'), 'true');
  await area(page); await page.locator('#fret-min').fill('20'); assert.equal(await page.locator('[data-position]').count(), 0); assert.equal(await page.locator('#selection-detail .selected-note').count(), 0);
  await range(page, 0, 12); await page.getByRole('checkbox', { name: 'Струна G', exact: true }).uncheck(); assert.equal(await page.locator('#box-select').inputValue(), '');
  assert.equal(await page.locator('[data-position^="G:"]').count(), 0); await geometry(page, 0, 12);
  return { exactFormNotes: exact, expandedDisplay: [0, 10], restoredDisplay: [0, 10], invalidClearsView: true, manualStringSwitchesToFree: true };
});

check('actual-picker-keyboard-focus-and-settings-panel-toggle', async ({ page }) => {
  await ready(page); await settings(page);
  const root = page.getByRole('button', { name: 'Тоника: A', exact: true });
  await root.focus(); await page.keyboard.press('ArrowDown'); assert.equal(await page.getByRole('listbox', { name: 'Тоника: варианты' }).getByRole('option').count(), 12);
  await page.keyboard.press('ArrowUp'); assert.equal(await page.evaluate(() => document.activeElement.textContent), 'F');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); assert.equal(await root.evaluate(element => element === document.activeElement), true);
  await root.click(); await page.keyboard.press('End'); await page.keyboard.press('Tab'); assert.equal(await page.getByRole('listbox').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('select-picker-trigger')), true);
  await root.click(); await page.locator('[data-label-mode="degrees"]').click(); assert.equal(await page.locator('[data-label-mode="degrees"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#close-study-settings').click(); assert.equal(await page.locator('#study-settings').isVisible(), false); assert.equal(await page.locator('#toggle-study-settings').evaluate(element => element === document.activeElement), true);
  assert.equal(await page.locator('#toggle-study-settings').getAttribute('aria-expanded'), 'false');
  await page.locator('#toggle-study-settings').click(); assert.equal(await page.locator('#study-settings').isVisible(), true);
  assert.equal(await page.locator('#toggle-study-settings').getAttribute('aria-expanded'), 'true');
  return { pickerGrid: 12, focusPreserved: true, firstOutsideClickApplied: true, settingsCollapsible: true };
});

check('shared-page-headings-menu-and-tabs', async ({ page }) => {
  await ready(page);
  const menu = page.getByRole('navigation', { name: 'Разделы тренажёра' });
  const main = page.getByRole('main');
  const pages = [['foundation', 'Гриф'], ['harmony', 'Ритм'], ['tracks', 'Песни']];
  const layouts = [];
  for (const [choice, width, height] of [['light', 1440, 900], ['dark', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await theme(page, choice);
    assert.deepEqual((await menu.getByRole('button').allTextContents()).map(text => text.trim()), ['Занятие', 'Гриф', 'Ритм', 'Песни', 'Прогресс']);
    for (const [id, label] of pages) {
      const button = menu.getByRole('button', { name: label, exact: true });
      await button.press('Enter');
      assert.equal(await button.getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('.site-header [aria-current="page"]').count(), 1);
      const heading = main.getByRole('heading', { level: 1, name: label, exact: true });
      assert.equal(await heading.getAttribute('data-page-heading'), id);
      assert.equal(await heading.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        return node.closest('.page-header') !== null && bounds.left >= -1 && bounds.right <= innerWidth + 1;
      }), true, `Header geometry for ${choice} ${id} at ${width}×${height}`);
    }
    await menu.getByRole('button', { name: 'Песни', exact: true }).click();
    const studio = main.locator('#tracks-mount');
    const scores = studio.getByRole('tab', { name: 'Партитуры', exact: true });
    await scores.click();
    const header = studio.locator(':scope > .page-header');
    const box = () => header.evaluate(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y: y + scrollY, width, height, fontSize: getComputedStyle(node.querySelector('h1')).fontSize };
    });
    const before = await box();
    const original = await header.elementHandle();
    await studio.getByRole('tab', { name: 'Аудиозаписи', exact: true }).click();
    assert.equal(await header.evaluate((node, previous) => node === previous, original), true);
    assert.deepEqual(await box(), before);
    assert.equal(await studio.locator('[role="tabpanel"] .page-header').count(), 0);
    await original.dispose();
    await scores.click();
    layouts.push({ theme: choice, width, height, sharedStudioHeader: before });
  }
  // Атлас — без вкладок: изучение одной страницей.
  await navigate(page, 'foundation');
  assert.equal(await page.locator('[data-page-frame="foundation"] [role="tab"], [data-page-frame="foundation"] .workspace-tabs').count(), 0);

  const verifyTabs = async (id, label, tabNames) => {
    await navigate(page, id);
    const first = main.getByRole('tab', { name: tabNames[0], exact: true });
    const second = main.getByRole('tab', { name: tabNames[1], exact: true });
    async function expectSelected(active, inactive) {
      assert.equal(await active.getAttribute('aria-selected'), 'true');
      assert.equal(await active.getAttribute('tabindex'), '0');
      assert.equal(await inactive.getAttribute('aria-selected'), 'false');
      assert.equal(await inactive.getAttribute('tabindex'), '-1');
      const activePanel = page.locator(`#${await active.getAttribute('aria-controls')}`);
      const inactivePanel = page.locator(`#${await inactive.getAttribute('aria-controls')}`);
      assert.equal(await activePanel.getAttribute('aria-labelledby'), await active.getAttribute('id'));
      assert.equal(await activePanel.isVisible(), true);
      assert.equal(await inactivePanel.isHidden(), true);
      assert.equal(await active.evaluate(button => button === document.activeElement), true);
      assert.equal(await main.getByRole('heading', { level: 1, name: label, exact: true }).count(), 1);
    }
    await first.focus();
    await first.press('End');
    await expectSelected(second, first);
    await second.press('ArrowRight');
    await expectSelected(first, second);
    await first.press('ArrowLeft');
    await expectSelected(second, first);
    await second.press('Home');
    await expectSelected(first, second);
    await second.press('Space');
    await expectSelected(second, first);
  };
  await verifyTabs('harmony', 'Ритм', ['Метроном', 'Ритм-секция']);
  await verifyTabs('tracks', 'Песни', ['Партитуры', 'Аудиозаписи']);
  return { layouts, pairedTabs: ['rhythm', 'studio'], atlasWithoutTabs: true, automaticActivation: true, nativeSpace: true };
});

check('section-tabs-share-styles-and-settings-panels-have-clear-edges', async ({ page }) => {
  await ready(page);
  const navigation = () => page.locator('main .workspace-tabs:visible');
  const edges = () => navigation().evaluate(row => {
    const { left, right } = row.getBoundingClientRect();
    return { left, right };
  });
  const styles = () => navigation().evaluate(row => {
    const read = (node, keys) => Object.fromEntries(keys.map(key => [key, getComputedStyle(node)[key]]));
    const buttonKeys = ['backgroundColor', 'borderBottomColor', 'borderBottomStyle', 'borderBottomWidth', 'borderRadius', 'color', 'fontSize', 'fontWeight', 'lineHeight', 'minHeight', 'padding'];
    return {
      row: read(row, ['columnGap', 'borderBottomColor', 'borderBottomStyle', 'borderBottomWidth']),
      selected: read(row.querySelector('[aria-pressed="true"], [aria-selected="true"]'), buttonKeys),
      inactive: read(row.querySelector('[aria-pressed="false"], [aria-selected="false"]'), buttonKeys),
    };
  });
  const layouts = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const choice of ['light', 'dark']) {
      await theme(page, choice);
      await navigate(page, 'harmony');
      const reference = await styles();
      const alignment = await edges();
      assert.equal(reference.selected.backgroundColor, 'rgba(0, 0, 0, 0)');
      assert.ok(parseFloat(reference.selected.borderBottomWidth) >= 2, `Подчёркивание выбранной вкладки: ${reference.selected.borderBottomWidth}`);
      assert.notEqual(reference.selected.borderBottomColor, reference.inactive.borderBottomColor);
      await navigate(page, 'tracks');
      assert.deepEqual(await styles(), reference, `tracks ${choice} ${width}×${height}`);
      assert.deepEqual(await edges(), alignment, 'tracks aligns with the shared workspace');
      layouts.push({ width, height, theme: choice, styles: reference });
    }
  }

  /** Панель параметров ниже шапки страницы, правый край — по краю `edge` (вкладки или кнопка «Параметры»), рамка 1px с контрастом ≥3:1. */
  async function measurePanel(panel, header, edge = header) {
    const bounds = await header.boundingBox();
    const right = await edge.boundingBox();
    assert.ok(bounds && right);
    const evidence = await panel.evaluate(node => {
      const style = getComputedStyle(node);
      const luminance = rgb => rgb.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(channel => Number(channel) / 255)
        .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      const boundary = luminance(style.borderLeftColor);
      const backgrounds = [style.backgroundColor, getComputedStyle(node.closest('.app-content')).backgroundColor];
      return {
        top: node.getBoundingClientRect().top,
        right: node.getBoundingClientRect().right,
        borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => [style[`border${side}Width`], style[`border${side}Style`], style[`border${side}Color`]]),
        contrast: backgrounds.map(color => {
          const background = luminance(color);
          return (Math.max(background, boundary) + .05) / (Math.min(background, boundary) + .05);
        }),
      };
    });
    assert.ok(evidence.top >= bounds.y + bounds.height - 1, JSON.stringify({ bounds, evidence }));
    assert.ok(Math.abs(evidence.right - (right.x + right.width)) <= 1, JSON.stringify({ right, evidence }));
    for (const [borderWidth, style, color] of evidence.borders) {
      assert.equal(borderWidth, '1px');
      assert.equal(style, 'solid');
      assert.equal(color, evidence.borders[0][2]);
    }
    assert.ok(evidence.contrast.every(ratio => ratio >= 3), JSON.stringify(evidence));
    return evidence;
  }

  const panels = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    await navigate(page, 'foundation');
    await settings(page);
    panels.push({ theme: choice, panel: 'foundation', ...await measurePanel(page.locator('#study-settings'), page.locator('#foundation-mount .page-header'), page.locator('#toggle-study-settings')) });
    await navigate(page, 'harmony');
    for (const mode of ['metronome', 'rhythm']) {
      await page.locator(`[data-rhythm-mode="${mode}"]`).click();
      const panel = page.locator(`[data-rhythm-settings-panel="${mode}"]`);
      if (!(await panel.isVisible())) await page.locator('.rhythm-header [data-page-settings-toggle]').click();
      panels.push({ theme: choice, panel: mode, ...await measurePanel(panel, navigation()) });
    }
  }
  return { layouts, panels };
});

check('shared-visual-roles-across-atlas-rhythm-and-songs', async ({ page }) => {
  await ready(page);
  const main = page.getByRole('main');
  const typography = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color'];
  const button = ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopStyle', 'borderRadius', 'color', 'fontSize', 'fontWeight', 'lineHeight', 'minHeight', 'padding'];
  const panelFrame = ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopStyle', 'borderRadius'];
  const read = (locator, keys) => locator.evaluate((element, properties) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(properties.map(key => [key, style[key]]));
  }, keys);
  const studioFileLayout = panel => panel.locator('.studio-file-row').evaluate(row => {
    const host = row.closest('[data-page-frame]').getBoundingClientRect();
    const { left, top, right } = row.getBoundingClientRect();
    const description = row.querySelector('p').getBoundingClientRect();
    const actions = row.querySelector('.studio-file-actions').getBoundingClientRect();
    const wrapped = actions.top >= description.bottom;
    return { x: left - host.left, y: top - host.top, wrapped, actionEdge: wrapped ? actions.left - left : right - actions.right };
  });
  const title = () => main.getByRole('heading', { level: 1 }).evaluate((element, keys) => {
    const style = getComputedStyle(element);
    const { x, y } = element.getBoundingClientRect();
    const top = y - element.closest('main').getBoundingClientRect().top;
    return { x, top, ...Object.fromEntries(keys.map(key => [key, style[key]])) };
  }, typography);
  const headerLayout = () => main.locator('.page-header:visible').evaluate(header => {
    const row = header.querySelector('.page-header-row').getBoundingClientRect();
    const heading = header.querySelector('h1').getBoundingClientRect();
    const context = header.querySelector('.page-header-context')?.getBoundingClientRect();
    const tabs = header.querySelector('.workspace-tabs')?.getBoundingClientRect();
    const frame = header.closest('main').getBoundingClientRect();
    return {
      context: context ? { x: context.x - heading.x, y: context.y - heading.y, after: context.left - heading.right, below: context.top - heading.bottom } : null,
      navigation: tabs ? { x: tabs.x - heading.x, top: tabs.top - frame.top, gap: tabs.top - row.bottom } : null,
    };
  });
  const verifyHeader = async (id, width, hasContext, hasNavigation) => {
    const layout = await headerLayout();
    assert.equal(Boolean(layout.context), hasContext, `${id} context slot`);
    assert.equal(Boolean(layout.navigation), hasNavigation, `${id} navigation slot`);
    if (layout.context) {
      const { x, y, after, below } = layout.context;
      if (width >= 1050 || x > 0) {
        assert.equal(after, 12, `${id} context is beside the title`);
        assert.ok(y >= 0 && below < 0, `${id} context shares the title line`);
      } else {
        assert.equal(x, 0, `${id} wrapped context starts at the title edge`);
        assert.equal(below, 5, `${id} wrapped context is just below the title`);
      }
    }
    if (layout.navigation) {
      assert.equal(layout.navigation.x, 0, `${id} navigation starts at the title edge`);
      assert.equal(layout.navigation.gap, 10, `${id} navigation follows the title row`);
    }
    return layout;
  };

  const layouts = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const choice of ['light', 'dark']) {
      await theme(page, choice);
      await navigate(page, 'foundation');
      const headingStyle = await title();
      const foundationHeader = await verifyHeader('foundation', width, true, false);
      const atlasPrimary = await read(main.locator('#atlas-play'), button);
      await navigate(page, 'harmony');
      assert.deepEqual(await title(), headingStyle, 'Rhythm page heading');
      const rhythmHeader = await verifyHeader('harmony', width, false, true);
      await navigate(page, 'tracks');
      assert.deepEqual(await title(), headingStyle, 'Studio page heading');
      await main.getByRole('tab', { name: 'Партитуры', exact: true }).click();
      const studioHeader = await verifyHeader('scores', width, true, true);
      const scores = main.locator('#music-bank-mount');
      const scoreFile = await read(scores.locator('.studio-file-actions > .primary-button'), button);
      const fileLayout = await studioFileLayout(scores);
      const emptyStyle = await read(scores.locator('.studio-empty'), panelFrame);
      await main.getByRole('tab', { name: 'Аудиозаписи', exact: true }).click();
      assert.deepEqual(await verifyHeader('audio', width, true, true), studioHeader);
      if (width >= 1050) assert.deepEqual(studioHeader.navigation, rhythmHeader.navigation, 'Studio navigation has the same baseline as Rhythm');
      const audio = main.locator('#legacy-tracks-mount');
      assert.deepEqual(await read(audio.locator('.studio-file-actions > .primary-button'), button), scoreFile);
      assert.deepEqual(await studioFileLayout(audio), fileLayout);
      assert.deepEqual(await read(audio.locator('.studio-empty'), panelFrame), emptyStyle);
      layouts.push({ width, height, theme: choice, headingStyle, foundationHeader, rhythmHeader, studioHeader, atlasPrimary, scoreFile });
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    await navigate(page, 'foundation');
    await settings(page);
    const foundationToggle = main.locator('#toggle-study-settings');
    const show = await read(foundationToggle, button);
    const showIcon = await foundationToggle.locator('svg').innerHTML();
    const hide = await read(main.locator('#close-study-settings'), button);
    await navigate(page, 'harmony');
    const toggle = main.locator('.rhythm-header [data-page-settings-toggle]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.mouse.move(0, 0);
    assert.deepEqual(await read(toggle, button), show);
    assert.equal(await toggle.locator('svg').innerHTML(), showIcon);
    assert.deepEqual(await read(main.locator('[data-rhythm-settings-close]:visible'), button), hide);
  }
  return { layouts, sharedSettingsActions: true };
});

check('shared-form-and-disclosure-states-in-atlas-and-audio-input-settings', async ({ page }) => {
  await ready(page);
  const look = locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    return ['fontSize', 'fontWeight', 'minHeight', 'backgroundColor', 'borderTopColor', 'borderTopLeftRadius', 'color'].map(key => style[key]);
  });
  const disclosure = locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    const mark = getComputedStyle(element, '::after').content;
    return ['display', 'fontSize', 'fontWeight', 'lineHeight', 'minHeight', 'color'].map(key => style[key]).concat(mark);
  });
  const toggleDisclosure = async locator => {
    const before = await disclosure(locator);
    await locator.press('Space');
    await locator.locator('..').evaluate(element => {
      if (!element.open) throw new Error('Space did not open disclosure');
    });
    const after = await disclosure(locator);
    assert.notEqual(after.at(-1), before.at(-1));
    await locator.press('Space');
    return { before, after };
  };
  const evidence = [];
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    await navigate(page, 'foundation');
    await settings(page);
    const normal = await look(page.getByRole('button', { name: 'Тоника: A', exact: true }));
    const help = page.locator('#study-settings .learning-help > summary').last();
    const disclosureStates = await toggleDisclosure(help);
    await area(page);
    await page.locator('#fret-min').fill('20');
    assert.equal(await page.locator('#fret-min').getAttribute('aria-invalid'), 'true');
    const invalid = await look(page.locator('#fret-min'));
    await page.locator('#fret-min').fill('0');
    assert.equal(await page.locator('#fret-min').getAttribute('aria-invalid'), 'false');
    assert.notDeepEqual(invalid, await look(page.locator('#fret-min')), 'Неверное поле отличается от исправленного');
    // Аудиовход теперь в «Настройках»: поле устройства и раскрытия карточек — те же роли, что в атласе.
    await navigate(page, 'settings');
    await page.locator('[data-page-frame="settings"] [data-section="input"]').click();
    assert.deepEqual(await look(page.locator('[data-input-setting="deviceId"]')), normal);
    assert.deepEqual(await toggleDisclosure(page.locator('.input-card-explainer > summary').first()), disclosureStates);
    evidence.push({ theme: choice, normal, invalid, disclosureStates });
  }
  return { evidence };
});

check('bounded-rhythm-frame-at-viewport-boundaries', async ({ page }) => {
  await ready(page);
  await navigate(page, 'harmony');
  const measurements = [];
  const sizes = [[1049, 660], [1050, 659], [1050, 660], [1439, 700], [1440, 699], [1440, 700], [1440, 740], [1440, 741]];
  const shell = page.locator('.app-shell');
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const sample = await shell.evaluate(element => {
      const rhythm = element.querySelector('[data-page-frame="harmony"]');
      const style = getComputedStyle(rhythm);
      const sidebar = element.querySelector('.site-header');
      const fader = rhythm.querySelector('.rhythm-transport:not([hidden])');
      return {
        bounded: style.getPropertyValue('--rhythm-wide').trim() === '1',
        sideSettings: style.getPropertyValue('--rhythm-side-panel').trim() === '1',
        sidebarPosition: getComputedStyle(sidebar).position,
        faderHeight: getComputedStyle(fader).getPropertyValue('--amp-fader-height').trim(),
      };
    });
    const bounded = width >= 1050 && height >= 660;
    assert.equal(sample.bounded, bounded);
    assert.equal(sample.sidebarPosition, bounded ? 'sticky' : 'static');
    assert.equal(sample.sideSettings, width >= 1440 && height >= 700);
    assert.equal(sample.faderHeight === '64px', height <= 740);
    measurements.push({ width, height, ...sample });
  }
  return { measurements };
});

check('atlas-bridged-play-and-check-screens-fit-1366-in-both-themes-and-hide-the-atlas', async ({ page, resultDir }) => {
  await ready(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  const screens = [];
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    for (const [bridge, selector, back] of [['Сыграть эту форму', '[data-lesson-screen="play"] .pl-scene [data-back]', 'play'], ['Проверь себя по этой форме', '[data-lesson-screen="check"] [data-act="back"]', 'check']]) {
      await navigate(page, 'foundation');
      await page.getByRole('button', { name: bridge, exact: true }).click();
      await page.locator(`[data-lesson-screen="${back}"]:not([hidden])`).waitFor();
      assert.equal(await current(page), 'lesson');
      await frame(page);
      const layout = await page.evaluate(screen => {
        const host = document.querySelector(`[data-lesson-screen="${screen}"]`);
        const heading = host.querySelector('h1').getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          heading: { left: heading.left, right: heading.right, top: heading.top },
          atlasHidden: document.getElementById('foundation-mount').hidden && document.getElementById('foundation-mount').getClientRects().length === 0,
          atlasPositions: [...document.querySelectorAll('#foundation-mount [data-position]')].filter(node => node.getClientRects().length).length,
          background: getComputedStyle(document.body).backgroundColor,
        };
      }, back);
      assert.equal(layout.overflow, false, `${back} ${choice}: нет горизонтальной прокрутки`);
      assert.ok(layout.heading.left >= 0 && layout.heading.right <= 1366, JSON.stringify(layout));
      assert.equal(layout.atlasHidden, true); assert.equal(layout.atlasPositions, 0, 'Атлас скрыт под экраном «Занятия»');
      assert.equal(await page.locator('#foundation-mount').ariaSnapshot(), '', 'Атлас не в дереве доступности');
      assert.equal(await page.locator(selector).innerText(), '← Гриф');
      await page.screenshot({ path: join(resultDir, `p13-atlas-${back}-${choice}.png`), fullPage: true });
      screens.push({ theme: choice, screen: back, ...layout });
      await page.locator(selector).click();
      assert.equal(await current(page), 'foundation');
    }
  }
  return { screens };
});

// Типичный размер 1366×768 в обеих темах — быстрый набор; остальные четыре размера — полный (FULL_ONLY.viewports).
const defaultDesktop = viewports => async ({ page, resultDir }) => {
  const layouts = [];
  for (const choice of ['light', 'dark']) {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height }); await page.reload(); await ready(page);
      await theme(page, choice);
      await frame(page);
      const moreInitiallyOpen = await page.locator('#study-more').evaluate(el => el.open);
      if (height === 1080) assert.equal(moreInitiallyOpen, true, 'Details are initially open when the full content fits');
      const measured = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, height: innerHeight, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, sidebarScroll: document.querySelector('.site-header').scrollHeight > document.querySelector('.site-header').clientHeight + 1 }));
      assert.ok(measured.scrollHeight <= height, JSON.stringify({ theme: choice, ...measured }));
      assert.equal(measured.overflow, false); assert.equal(measured.sidebarScroll, false);
      assert.deepEqual((await page.locator('.study-fretboard .fret-number').allTextContents()).map(Number), Array.from({ length: 13 }, (_, i) => i));
      assert.deepEqual(await page.locator('.study-fretboard .string-name').allTextContents(), ['G', 'D', 'A', 'E']);
      await page.waitForFunction(() => [...document.querySelectorAll('svg.study-fretboard')].every(svg => Math.abs(Number(svg.getAttribute('viewBox').split(' ')[2]) - svg.getBoundingClientRect().width) < 2));
      for (const marker of await page.locator('.position.is-large .note-marker').all()) { const diameter = await marker.evaluate(el => el.getBoundingClientRect().width); assert.ok(Math.abs(diameter - 46) < .1, String(diameter)); }
      layouts.push({ theme: choice, moreInitiallyOpen, ...measured });
      if (width === 1366) { await page.mouse.move(width - 3, 3); await page.screenshot({ path: join(resultDir, `compact-default-${choice}.png`), fullPage: true }); }
      if (!moreInitiallyOpen) await page.locator('#study-more > summary').click();
      assert.equal(await page.getByTestId('structure-notes').isVisible(), true);
      if (!moreInitiallyOpen) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), 'Explicit detail expansion may extend the page');
      await page.locator('#study-more > summary').click();
    }
  }
  return { layouts, explicitDisclosureEnablesScroll: true, noteDiameter: 46, completeDefaultRange: [0, 12] };
};
check('default-desktop-fits-height-and-scroll-follows-explicit-disclosure-at-1366x768', defaultDesktop([[1366, 768]]));
check('default-desktop-fits-height-and-scroll-follows-explicit-disclosure-at-four-other-sizes', defaultDesktop([[1440, 1080], [1440, 900], [1280, 720], [1024, 768]]));

markFullOnly(checks, [
  'approved-default-and-both-themes-at-four-other-widths',
  'default-desktop-fits-height-and-scroll-follows-explicit-disclosure-at-four-other-sizes',
], FULL_ONLY.viewports);
markFullOnly(checks, [
  'octave-semantics-independent-layers-and-shared-tonic',
  'actual-picker-keyboard-focus-and-settings-panel-toggle',
  'section-tabs-share-styles-and-settings-panels-have-clear-edges',
  'shared-visual-roles-across-atlas-rhythm-and-songs',
  'shared-form-and-disclosure-states-in-atlas-and-audio-input-settings',
], FULL_ONLY.smoke);
await runNotationBrowserChecks(checks, { reportName: 'p9-design-edge.json', scope: 'Approved VIS-01 r5 atlas after P13-08 in the P13 shell: complete 46/18 fretboard, height-fit desktop, explicit disclosures, musical intervals/octaves, exact form material behind the bridges, bridged play and «Проверь себя» screens in both themes, and shared page/tab/panel/field roles across atlas, rhythm, songs and audio-input settings. No physical bass or full WCAG certification.' });
