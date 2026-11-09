import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runNotationBrowserChecks } from './helpers/notation-browser-harness.mjs';

const checks = [];
const check = (name, run) => checks.push({ name, scope: 'ui', run });
async function ready(page) { if (await page.locator('[data-intro="free"]').isVisible()) await page.locator('[data-intro="free"]').click(); }
async function settings(page) { if (!await page.locator('#study-settings').isVisible()) await page.locator('#toggle-study-settings').click(); }
async function area(page) { await settings(page); if (!await page.locator('#area-settings').evaluate(el => el.open)) await page.locator('#area-settings > summary').click(); }
async function display(page) { await settings(page); if (!await page.locator('#display-settings').evaluate(el => el.open)) await page.locator('#display-settings > summary').click(); }
async function range(page, min, max) {
  await area(page);
  await page.locator('#fret-max').fill('24'); await page.locator('#fret-min').fill(String(min)); await page.locator('#fret-max').fill(String(max));
}
async function form(page, label) { await settings(page); await page.locator('#box-select').selectOption({ label }); }
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

check('approved-default-and-both-themes-at-five-widths', async ({ page, resultDir }) => {
  await ready(page);
  assert.equal(await page.locator('#fret-min').inputValue(), '0'); assert.equal(await page.locator('#fret-max').inputValue(), '12');
  assert.equal(await page.locator('[data-position]').count(), 52); assert.equal(await page.locator('.position.is-large').count(), 8);
  assert.equal(await page.locator('#history-mount').isVisible(), false);
  assert.equal(await page.locator('#persistence-banner').isVisible(), false);
  const layouts = [];
  for (const theme of ['light', 'dark']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    for (const width of [1440, 1366, 1024, 736, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const limits of [[0, 12], [12, 24]]) { await range(page, ...limits); layouts.push({ theme, width, range: limits, ...await geometry(page, ...limits) }); }
    }
    await page.setViewportSize({ width: 1440, height: 1300 }); await range(page, 0, 12);
    await page.locator('[data-position="A:7"]').click(); await page.locator('#toggle-study-settings').focus();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: join(resultDir, `p9-${theme}.png`), fullPage: true });
  }
  return { layouts, brandBars: await page.locator('.brand-mark i').evaluateAll(elements => elements.map(element => getComputedStyle(element).height)) };
});

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

check('view-range-does-not-clip-exact-training-material-and-survives-reload', async ({ page }) => {
  await ready(page); await form(page, 'Форма B · 7–10');
  assert.equal(await page.locator('#fret-min').inputValue(), '0'); assert.equal(await page.locator('#fret-max').inputValue(), '12');
  await range(page, 0, 5); assert.match(await page.locator('#box-select option:checked').textContent(), /Форма B/);
  assert.equal(await page.locator('#show-whole-form').isVisible(), true);
  await page.locator('[data-training-mode="sequence"]').click(); assert.equal(await page.getByTestId('sequence-count').innerText(), '8 нот');
  const exact = await page.locator('[data-sequence-position]').evaluateAll(elements => elements.map(element => element.dataset.sequencePosition));
  assert.deepEqual([...exact].sort(), ['E:8', 'E:10', 'A:7', 'A:10', 'D:7', 'D:10', 'G:7', 'G:9'].sort());
  await page.locator('[data-player-action="start"]').click();
  await page.waitForFunction(() => document.querySelector('#player-mount').dataset.playerState === 'running');
  await page.locator('[data-label-mode="degrees"]').click();
  await page.locator('#show-whole-form').click(); assert.equal(await page.locator('#fret-min').inputValue(), '0'); assert.equal(await page.locator('#fret-max').inputValue(), '10');
  assert.equal(await page.locator('#player-mount').getAttribute('data-player-state'), 'running');
  assert.deepEqual(await page.locator('[data-sequence-position]').evaluateAll(elements => elements.map(element => element.dataset.sequencePosition)), exact);
  await page.locator('[data-player-action="stop"]').click();
  await page.locator('[data-training-mode="study"]').click();
  await page.waitForFunction(() => document.querySelector('#persistence-message')?.textContent.includes('Сохранено локально'));
  await page.reload(); await ready(page); assert.match(await page.locator('#box-select option:checked').textContent(), /Форма B/); assert.equal(await page.locator('#fret-max').inputValue(), '10');
  await area(page); await page.locator('#fret-min').fill('20'); assert.equal(await page.locator('[data-position]').count(), 0); assert.equal(await page.locator('#selection-detail .selected-note').count(), 0);
  await range(page, 0, 12); await page.getByRole('checkbox', { name: 'Струна G', exact: true }).uncheck(); assert.equal(await page.locator('#box-select').inputValue(), '');
  assert.equal(await page.locator('[data-position^="G:"]').count(), 0); await geometry(page, 0, 12);
  return { exactFormNotes: exact, expandedDisplay: [0, 10], restoredDisplay: [0, 10], invalidClearsView: true, manualStringSwitchesToFree: true };
});

check('actual-picker-keyboard-focus-and-history-navigation', async ({ page }) => {
  await ready(page); const root = page.getByRole('button', { name: 'Тоника: A', exact: true });
  await root.focus(); await page.keyboard.press('ArrowDown'); assert.equal(await page.getByRole('listbox', { name: 'Тоника: варианты' }).getByRole('option').count(), 12);
  await page.keyboard.press('ArrowUp'); assert.equal(await page.evaluate(() => document.activeElement.textContent), 'F');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); assert.equal(await root.evaluate(element => element === document.activeElement), true);
  await root.click(); await page.keyboard.press('End'); await page.keyboard.press('Tab'); assert.equal(await page.getByRole('listbox').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('select-picker-trigger')), true);
  await root.click(); await page.locator('[data-label-mode="degrees"]').click(); assert.equal(await page.locator('[data-label-mode="degrees"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#close-study-settings').click(); assert.equal(await page.locator('#study-settings').isVisible(), false); assert.equal(await page.locator('#toggle-study-settings').evaluate(element => element === document.activeElement), true);
  await page.locator('#toggle-study-settings').click(); assert.equal(await page.locator('#study-settings').isVisible(), true);
  const historyButton = page.locator('#open-history');
  const drawer = page.locator('.history-drawer');
  const historySummary = drawer.locator(':scope > summary');
  const introductionButton = page.locator('#open-introduction');
  const introductionHeading = page.locator('#onboarding-mount h2');
  const activeModule = () => page.locator('.module-navigation [aria-current="page"]').getAttribute('data-app-module');
  const assertNavigationTarget = async locator => {
    const frame = await locator.evaluate(element => {
      const { top, bottom } = element.getBoundingClientRect();
      const scroller = document.scrollingElement;
      const minReachableTop = top + scroller.scrollTop - (scroller.scrollHeight - scroller.clientHeight);
      return { top, bottom, minReachableTop, viewportHeight: innerHeight, focused: element === document.activeElement };
    });
    assert.ok(frame.focused && frame.top >= -1 && frame.bottom <= frame.viewportHeight + 1
      && frame.top <= Math.max(40, frame.minReachableTop + 2), `Navigation target in viewport: ${JSON.stringify(frame)}`);
    return frame;
  };
  const openHistoryFrom = async module => {
    await historyButton.click();
    await page.getByRole('textbox', { name: 'Название пресета', exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.history-drawer > summary'));
    assert.equal(await drawer.evaluate(element => element.open), true);
    assert.equal(await activeModule(), module);
    return assertNavigationTarget(historySummary);
  };
  const closeHistory = async () => {
    await historySummary.click();
    await page.locator('#history-mount').waitFor({ state: 'hidden' });
    assert.equal(await historyButton.getAttribute('aria-expanded'), 'false');
  };
  await page.locator('[data-app-module="ear"]').click();
  assert.equal(await page.getByTestId('history-body').locator(':scope > *').count(), 0);
  const historyFromEar = await openHistoryFrom('ear');
  await introductionButton.click();
  assert.equal(await activeModule(), 'ear');
  const introductionFromHistory = await assertNavigationTarget(introductionHeading);
  assert.equal(await page.locator('#history-mount').isHidden(), true);
  await page.setViewportSize({ width: 1782, height: 1220 });
  const tracksButton = page.locator('[data-app-module="tracks"]');
  await tracksButton.click();
  const scorePanel = page.locator('#music-bank-mount');
  await page.waitForFunction(() => {
    const panel = document.getElementById('music-bank-mount');
    const bounds = panel.getBoundingClientRect();
    return Math.abs(bounds.height - (innerHeight - bounds.top - scrollY - 16)) <= 1;
  });
  const initialScoreHeight = await scorePanel.evaluate(panel => panel.getBoundingClientRect().height);
  await introductionButton.click();
  assert.equal(await introductionHeading.isVisible(), true);
  const firstHistoryFrame = await openHistoryFrom('tracks');
  assert.equal(await page.locator('#onboarding-mount').isHidden(), true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const historyFromTracks = await assertNavigationTarget(historySummary);
  assert.ok(historyFromTracks.top <= 40 && Math.abs(historyFromTracks.top - firstHistoryFrame.top) <= 2,
    `History stays at the top after the score layout settles: ${JSON.stringify({ firstHistoryFrame, historyFromTracks })}`);
  const scoreHeightWithHistory = await scorePanel.evaluate(panel => panel.getBoundingClientRect().height);
  assert.ok(Math.abs(scoreHeightWithHistory - initialScoreHeight) <= 1,
    `Scrolling to history keeps the score height: ${initialScoreHeight} → ${scoreHeightWithHistory}`);
  await tracksButton.click();
  assert.equal(await activeModule(), 'tracks');
  assert.equal(await page.locator('#history-mount').isHidden(), true);
  const tracksAfterHistory = await page.locator('#tracks-mount > .page-header [data-page-heading="tracks"]').evaluate(heading => {
    const { top, bottom } = heading.getBoundingClientRect();
    return { top, bottom, scroll: window.scrollY, viewportHeight: innerHeight };
  });
  assert.ok(tracksAfterHistory.scroll <= 1 && tracksAfterHistory.top >= 0 && tracksAfterHistory.bottom <= tracksAfterHistory.viewportHeight,
    `Returning directly to the selected section shows its heading: ${JSON.stringify(tracksAfterHistory)}`);
  await openHistoryFrom('tracks');
  await closeHistory();
  return { pickerGrid: 12, focusPreserved: true, firstOutsideClickApplied: true, settingsCollapsible: true, historyViaNavigation: true, historyFromEar, historyFromTracks, introductionFromHistory, tracksAfterHistory, initialScoreHeight, scoreHeightWithHistory };
});

check('shared-page-headings-navigation-and-tabs', async ({ page }) => {
  const sections = [
    ['foundation', 'Гриф и практика'], ['ear', 'Слух'], ['harmony', 'Метроном и ритм'],
    ['tracks', 'Табулатура и ноты'], ['input', 'Аудиовход'], ['route', 'Маршрут занятия'],
  ];
  const primary = page.getByRole('navigation', { name: 'Раздел тренажёра' });
  const main = page.getByRole('main');
  const layouts = [];
  for (const [theme, width, height] of [['light', 1440, 900], ['dark', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    assert.deepEqual(await primary.getByRole('button').allTextContents(), sections.map(([, label]) => label));
    for (const [id, label] of sections) {
      const button = primary.getByRole('button', { name: label, exact: true });
      await button.press('Enter');
      assert.equal(await button.getAttribute('aria-current'), 'page');
      assert.equal(await primary.locator('[aria-current="page"]').count(), 1);
      assert.equal(await main.getByRole('heading', { level: 1 }).count(), 1);
      const heading = main.getByRole('heading', { level: 1, name: label, exact: true });
      assert.equal(await heading.getAttribute('data-page-heading'), id);
      assert.equal(await heading.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        return node.closest('.page-header') !== null && bounds.left >= -1 && bounds.right <= innerWidth + 1;
      }), true, `Header geometry for ${theme} ${id} at ${width}×${height}`);
    }
    await primary.getByRole('button', { name: 'Табулатура и ноты', exact: true }).click();
    const studio = main.locator('#tracks-mount');
    const scores = studio.getByRole('tab', { name: 'Партитуры', exact: true });
    await scores.click();
    const header = studio.locator(':scope > .page-header');
    const geometry = () => header.evaluate(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y: y + scrollY, width, height, fontSize: getComputedStyle(node.querySelector('h1')).fontSize };
    });
    const before = await geometry();
    const original = await header.elementHandle();
    await studio.getByRole('tab', { name: 'Аудиозаписи', exact: true }).click();
    assert.equal(await header.evaluate((node, previous) => node === previous, original), true);
    assert.deepEqual(await geometry(), before);
    assert.equal(await studio.locator('[role="tabpanel"] .page-header').count(), 0);
    await original.dispose();
    await scores.click();
    layouts.push({ theme, width, height, sections: sections.length, sharedStudioHeader: before });
  }

  const verifyTabs = async (section, tabNames) => {
    await primary.getByRole('button', { name: section, exact: true }).click();
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
      assert.equal(await main.getByRole('heading', { level: 1, name: section, exact: true }).count(), 1);
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
  await verifyTabs('Метроном и ритм', ['Метроном', 'Ритм-секция']);
  await verifyTabs('Табулатура и ноты', ['Партитуры', 'Аудиозаписи']);
  return { layouts, pairedTabs: ['rhythm', 'studio'], automaticActivation: true, nativeSpace: true };
});

check('section-navigation-shares-styles-and-settings-panels-have-clear-edges', async ({ page }) => {
  const navigate = id => page.locator(`[data-app-module="${id}"]`).click();
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
    for (const theme of ['light', 'dark']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await navigate('foundation');
      const reference = await styles();
      const alignment = await edges();
      assert.equal(reference.selected.backgroundColor, 'rgba(0, 0, 0, 0)');
      assert.equal(reference.selected.borderBottomWidth, '2px');
      assert.notEqual(reference.selected.borderBottomColor, reference.inactive.borderBottomColor);
      for (const section of ['harmony', 'tracks']) {
        await navigate(section);
        assert.deepEqual(await styles(), reference, `${section} ${theme} ${width}×${height}`);
        assert.deepEqual(await edges(), alignment, `${section} aligns with the shared workspace`);
      }
      layouts.push({ width, height, theme, styles: reference });
    }
  }

  async function measurePanel(panel) {
    const bounds = await navigation().boundingBox();
    assert.ok(bounds);
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
    assert.ok(Math.abs(evidence.right - (bounds.x + bounds.width)) <= 1, JSON.stringify({ bounds, evidence }));
    for (const [width, style, color] of evidence.borders) {
      assert.equal(width, '1px');
      assert.equal(style, 'solid');
      assert.equal(color, evidence.borders[0][2]);
    }
    assert.ok(evidence.contrast.every(ratio => ratio >= 3), JSON.stringify(evidence));
    return evidence;
  }

  const panels = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const theme of ['light', 'dark']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await navigate('foundation');
    await settings(page);
    panels.push({ theme, panel: 'foundation', ...await measurePanel(page.locator('#study-settings')) });
    await navigate('harmony');
    for (const mode of ['metronome', 'rhythm']) {
      await page.locator(`[data-rhythm-mode="${mode}"]`).click();
      const panel = page.locator(`[data-rhythm-settings-panel="${mode}"]`);
      if (!(await panel.isVisible())) await page.locator('.rhythm-header [data-page-settings-toggle]').click();
      panels.push({ theme, panel: mode, ...await measurePanel(panel) });
    }
  }
  return { layouts, panels };
});

check('shared-visual-roles-across-the-six-sections', async ({ page }) => {
  const navigate = id => page.locator(`[data-app-module="${id}"]`).click();
  const main = page.getByRole('main');
  const typography = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color'];
  const frame = ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopStyle', 'borderRadius'];
  const button = [...frame, 'color', 'fontSize', 'fontWeight', 'lineHeight', 'minHeight', 'padding'];
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
    const title = header.querySelector('h1').getBoundingClientRect();
    const context = header.querySelector('.page-header-context')?.getBoundingClientRect();
    const tabs = header.querySelector('.workspace-tabs')?.getBoundingClientRect();
    const page = header.closest('main').getBoundingClientRect();
    return {
      context: context ? { x: context.x - title.x, y: context.y - title.y, after: context.left - title.right, below: context.top - title.bottom } : null,
      navigation: tabs ? { x: tabs.x - title.x, top: tabs.top - page.top, gap: tabs.top - row.bottom } : null,
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
    for (const theme of ['light', 'dark']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await navigate('foundation');
      const headingStyle = await title();
      const foundationHeader = await verifyHeader('foundation', width, true, true);
      await main.getByRole('button', { name: 'Задания', exact: true }).click();
      await verifyHeader('foundation quiz', width, true, true);
      const taskHeading = await read(main.locator('.training-intro h2'), typography);
      const panelStyle = await read(main.locator('.training-content'), frame);
      const primaryStyle = await read(main.locator('[data-training-action="start"]'), button);
      const compare = async (id, mount, action) => {
        await navigate(id);
        assert.deepEqual(await title(), headingStyle, `${id} page heading`);
        await verifyHeader(id, width, true, false);
        const panel = main.locator(mount);
        assert.deepEqual(await read(panel.locator('.panel-heading h2'), typography), taskHeading, `${id} panel heading`);
        assert.deepEqual(await read(panel, frame), panelStyle, `${id} panel frame`);
        assert.deepEqual(await read(panel.locator(action), button), primaryStyle, `${id} primary action`);
      };
      await compare('ear', '#ear-mount', '[data-ear-action="start"]');
      await compare('input', '#input-mount', '[data-input-action="connect"]');
      await compare('route', '#route-mount', '[data-route-action="start"]');
      await navigate('harmony');
      assert.deepEqual(await title(), headingStyle, 'Rhythm page heading');
      const rhythmHeader = await verifyHeader('harmony', width, false, true);
      await navigate('tracks');
      assert.deepEqual(await title(), headingStyle, 'Studio page heading');
      await main.getByRole('tab', { name: 'Партитуры', exact: true }).click();
      const studioHeader = await verifyHeader('scores', width, true, true);
      const scores = main.locator('#music-bank-mount');
      const scoreFile = await read(scores.locator('.studio-file-actions > .primary-button'), button);
      const fileLayout = await studioFileLayout(scores);
      const emptyStyle = await read(scores.locator('.studio-empty'), frame);
      await main.getByRole('tab', { name: 'Аудиозаписи', exact: true }).click();
      assert.deepEqual(await verifyHeader('audio', width, true, true), studioHeader);
      if (width >= 1050) {
        assert.deepEqual(studioHeader.navigation, foundationHeader.navigation, 'Studio navigation has the same baseline as Foundation');
        assert.deepEqual(rhythmHeader.navigation, foundationHeader.navigation, 'Rhythm navigation has the same baseline as Foundation');
      }
      const audio = main.locator('#legacy-tracks-mount');
      assert.deepEqual(await read(audio.locator('.studio-file-actions > .primary-button'), button), scoreFile);
      assert.deepEqual(await studioFileLayout(audio), fileLayout);
      assert.deepEqual(await read(audio.locator('.studio-empty'), frame), emptyStyle);
      layouts.push({ width, height, theme, headingStyle, foundationHeader, rhythmHeader, studioHeader, taskHeading, panelStyle, primaryStyle, scoreFile });
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const theme of ['light', 'dark']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await navigate('foundation');
    await settings(page);
    const foundationToggle = main.locator('#toggle-study-settings');
    const show = await read(foundationToggle, button);
    const showIcon = await foundationToggle.locator('svg').innerHTML();
    const hide = await read(main.locator('#close-study-settings'), button);
    await navigate('harmony');
    const toggle = main.locator('.rhythm-header [data-page-settings-toggle]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.mouse.move(0, 0);
    assert.deepEqual(await read(toggle, button), show);
    assert.equal(await toggle.locator('svg').innerHTML(), showIcon);
    assert.deepEqual(await read(main.locator('[data-rhythm-settings-close]:visible'), button), hide);
  }
  return { layouts, sharedSettingsActions: true };
});

check('shared-form-and-disclosure-states', async ({ page }) => {
  const navigate = id => page.locator(`[data-app-module="${id}"]`).click();
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
  for (const theme of ['light', 'dark']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await navigate('foundation');
    await settings(page);
    const normal = await look(page.getByRole('button', { name: 'Тоника: A', exact: true }));
    await page.locator('[data-training-mode="quiz"]').click();
    const advanced = page.locator('.training-advanced > summary');
    const disclosureStates = await toggleDisclosure(advanced);
    await advanced.press('Space');
    const quizCount = page.locator('[data-quiz-setting="count"]');
    await quizCount.fill('0');
    assert.equal(await quizCount.getAttribute('aria-invalid'), 'true');
    const invalid = await look(quizCount);
    await quizCount.fill('10');
    await advanced.press('Space');
    await navigate('ear');
    assert.deepEqual(await look(page.locator('[data-ear-setting="root"]')), normal);
    const earCount = page.locator('[data-ear-setting="count"]');
    await earCount.fill('0');
    assert.equal(await earCount.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(await look(earCount), invalid);
    await earCount.fill('10');
    await navigate('input');
    assert.deepEqual(await look(page.locator('[data-input-setting="deviceId"]')), normal);
    assert.deepEqual(await toggleDisclosure(page.locator('.input-card-explainer > summary').first()), disclosureStates);
    await page.locator('#open-history').click();
    assert.deepEqual(await look(page.locator('[data-history-field="presetName"]')), normal);
    const compact = await look(page.locator('[data-history-field="filter"]'));
    await navigate('harmony');
    await page.locator('[data-rhythm-mode="metronome"]').click();
    const panel = page.locator('[data-rhythm-settings-panel="metronome"]');
    if (!(await panel.isVisible())) await page.locator('.rhythm-header [data-page-settings-toggle]').click();
    assert.deepEqual(await look(panel.locator('[data-rhythm-setting="beats"]')), compact);
    evidence.push({ theme, normal, compact, invalid, disclosureStates });
  }
  return { evidence };
});

check('shared-lesson-result-metrics', async ({ page }) => {
  const resultStyles = panel => panel.evaluate(element => {
    const read = (selector, keys) => {
      const style = getComputedStyle(element.querySelector(selector));
      return keys.map(key => style[key]);
    };
    return {
      title: read('.lesson-result-title', ['fontSize', 'fontWeight', 'color']),
      card: read('.lesson-result-metrics > div', ['padding', 'borderTopColor', 'borderRadius', 'backgroundColor']),
      value: read('.lesson-result-metrics strong', ['fontSize', 'fontFamily', 'lineHeight', 'color']),
      label: read('.lesson-result-metrics span', ['fontSize', 'color']),
    };
  });
  const evidence = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.locator('[data-app-module="foundation"]').click();
      await page.locator('[data-training-mode="quiz"]').click();
      for (const action of ['start', 'skip', 'finish']) await page.locator(`[data-training-action="${action}"]`).click();
      const quiz = page.getByTestId('quiz-summary');
      const styles = await resultStyles(quiz);
      assert.equal(await quiz.locator('.lesson-result-metrics > div').count(), 5);
      await page.locator('[data-app-module="ear"]').click();
      for (const action of ['start', 'skip', 'finish']) await page.locator(`[data-ear-action="${action}"]`).click();
      const ear = page.getByTestId('ear-summary');
      assert.equal(await ear.locator('.lesson-result-metrics > div').count(), 6);
      assert.deepEqual(await resultStyles(ear), styles);
      evidence.push({ theme, width, height, styles });
    }
  }
  return { evidence };
});

check('bounded-rhythm-frame-at-viewport-boundaries', async ({ page }) => {
  await page.locator('[data-app-module="harmony"]').click();
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

check('quiz-hides-explorer-information-in-rendered-and-accessible-view', async ({ page }) => {
  await ready(page); await page.locator('[data-training-mode="quiz"]').click();
  for (const selector of ['.fretboard-section', '.selection-section', '#connections', '.structure-summary', '.board-toolbar']) assert.equal(await page.locator(selector).isVisible(), false, selector);
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Гриф и практика');
  assert.equal(await page.locator('#study-context').innerText(), 'Задания на грифе');
  const explorer = await page.locator('.fretboard-section').ariaSnapshot(); assert.equal(explorer, '');
  return { hiddenExplorer: true, hiddenInspector: true, hiddenConnections: true, neutralHeading: true };
});

check('explicit-route-start-repairs-invalid-display-before-quiz', async ({ page }) => {
  await ready(page); await area(page); await page.locator('#fret-min').fill('');
  await page.locator('[data-app-module="route"]').click(); await page.locator('[data-route-action="start"]').click();
  await page.getByTestId('quiz-prompt').waitFor(); assert.equal(await page.locator('#range-error').isVisible(), false);
  assert.equal(await page.locator('[data-answer-position]').count(), 4);
  await page.locator('[data-route-action="pause"]').click();
  await page.locator('#open-history').click();
  await page.getByLabel('Название пресета', { exact: true }).fill('');
  await page.locator('[data-history-action="save-preset"]').click();
  const error = page.getByTestId('history-error');
  await error.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'history-error');
  const visibility = await error.evaluate(element => {
    const route = document.getElementById('route-session-mount');
    const bounds = element.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, viewport: innerHeight, routeBottom: route.getBoundingClientRect().bottom, margin: Number.parseFloat(getComputedStyle(element).scrollMarginTop) };
  });
  assert.ok(visibility.margin > 16 && visibility.top >= visibility.routeBottom && visibility.bottom <= visibility.viewport, JSON.stringify(visibility));
  return { invalidDisplayRepairedExplicitly: true, exactTriadPositions: 4, quizStarted: true, validationRevealedBelowRoute: visibility };
});

check('notation-explicitly-reveals-offscreen-form-position-without-changing-material', async ({ page }) => {
  await ready(page); await range(page, 0, 2); await page.locator('[data-training-mode="sequence"]').click();
  assert.equal(await page.getByTestId('sequence-count').innerText(), '8 нот');
  await page.locator('[data-sequence-view="notation"]').click();
  const note = page.locator('[data-notation-view="staff"][data-notation-index="0"]'); await note.waitFor();
  await note.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-position="E:5"][aria-pressed="true"]').isVisible(), true);
  assert.equal(await page.locator('#fret-min').inputValue(), '0'); assert.equal(await page.locator('#fret-max').inputValue(), '5');
  assert.equal(await page.getByTestId('sequence-count').innerText(), '8 нот');
  assert.match(await page.locator('#box-select option:checked').textContent(), /Форма A/);
  return { selectedPosition: 'E:5', expandedDisplay: [0, 5], exactFormRetained: true };
});

check('default-desktop-fits-height-and-scroll-follows-explicit-disclosure', async ({ page, resultDir }) => {
  const layouts = [];
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of [[1440, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768]]) {
      await page.setViewportSize({ width, height }); await page.reload(); await ready(page);
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.locator('.sidebar-art img').evaluate(img => img.decode());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#onboarding-mount').isVisible(), false);
      const moreInitiallyOpen = await page.locator('#study-more').evaluate(el => el.open);
      if (height === 1080) assert.equal(moreInitiallyOpen, true, 'Details are initially open when the full content fits');
      const measured = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, height: innerHeight, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, photo: getComputedStyle(document.querySelector('.sidebar-art img')).display !== 'none' && getComputedStyle(document.querySelector('.sidebar-art')).display !== 'none', sidebarScroll: document.querySelector('.site-header').scrollHeight > document.querySelector('.site-header').clientHeight + 1 }));
      assert.ok(measured.scrollHeight <= height, JSON.stringify({ theme, ...measured }));
      assert.equal(measured.overflow, false); assert.equal(measured.photo, true); assert.equal(measured.sidebarScroll, false);
      assert.deepEqual((await page.locator('.study-fretboard .fret-number').allTextContents()).map(Number), Array.from({ length: 13 }, (_, i) => i));
      assert.deepEqual(await page.locator('.study-fretboard .string-name').allTextContents(), ['G', 'D', 'A', 'E']);
      await page.waitForFunction(() => [...document.querySelectorAll('svg.study-fretboard')].every(svg => Math.abs(Number(svg.getAttribute('viewBox').split(' ')[2]) - svg.getBoundingClientRect().width) < 2));
      for (const marker of await page.locator('.position.is-large .note-marker').all()) { const diameter = await marker.evaluate(el => el.getBoundingClientRect().width); assert.ok(Math.abs(diameter - 46) < .1, String(diameter)); }
      layouts.push({ theme, moreInitiallyOpen, ...measured });
      if (width === 1366) { await page.mouse.move(width - 3, 3); await page.screenshot({ path: join(resultDir, `compact-default-${theme}.png`), fullPage: true }); }
      if (!moreInitiallyOpen) await page.locator('#study-more > summary').click();
      assert.equal(await page.getByTestId('structure-notes').isVisible(), true);
      if (!moreInitiallyOpen) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), 'Explicit detail expansion may extend the page');
      await page.locator('#study-more > summary').click();
    }
  }
  return { layouts, explicitDisclosureEnablesScroll: true, noteDiameter: 46, completeDefaultRange: [0, 12] };
});

await runNotationBrowserChecks(checks, { reportName: 'p9-design-edge.json', scope: 'Approved VIS-01 r5 with compact default shell: complete 46/18 fretboard, height-fit desktop, explicit disclosures, local photo, musical intervals/octaves and hidden quiz explorer. No physical bass or full WCAG certification.' });
