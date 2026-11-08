import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runNotationBrowserChecks } from './helpers/notation-browser-harness.mjs';

const checks = [];
const check = (name, run) => checks.push({ name, scope: 'ui', run });
async function ready(page) { if (await page.locator('[data-intro="free"]').isVisible()) await page.locator('[data-intro="free"]').click(); }
async function range(page, min, max) {
  await page.locator('#fret-max').fill('24'); await page.locator('#fret-min').fill(String(min)); await page.locator('#fret-max').fill(String(max));
}
async function form(page, label) { await page.locator('#box-select').selectOption({ label }); }
async function geometry(page, min, max) {
  await page.waitForFunction(() => [...document.querySelectorAll('svg.study-fretboard')].every(svg => Math.abs(Number(svg.getAttribute('viewBox').split(' ')[2]) - svg.getBoundingClientRect().width) < 2));
  assert.deepEqual((await page.locator('.study-fretboard .fret-number').allTextContents()).map(Number), Array.from({ length: max - min + 1 }, (_, i) => min + i));
  for (const svg of await page.locator('svg.study-fretboard').all()) assert.deepEqual(await svg.locator('.string-name').allTextContents(), ['G', 'D', 'A', 'E']);
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
  await page.locator('#show-whole-form').click(); assert.equal(await page.locator('#fret-min').inputValue(), '0'); assert.equal(await page.locator('#fret-max').inputValue(), '10');
  await page.locator('[data-training-mode="study"]').click();
  await page.waitForFunction(() => document.querySelector('#persistence-message')?.textContent.includes('Сохранено локально'));
  await page.reload(); await ready(page); assert.match(await page.locator('#box-select option:checked').textContent(), /Форма B/); assert.equal(await page.locator('#fret-max').inputValue(), '10');
  await page.locator('#fret-min').fill('20'); assert.equal(await page.locator('[data-position]').count(), 0); assert.equal(await page.locator('#selection-detail .selected-note').count(), 0);
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
  await page.locator('#open-history').click(); assert.equal(await page.locator('.history-drawer').evaluate(element => element.open), true); assert.equal(await page.locator('#history-mount').isVisible(), true);
  await page.locator('.history-drawer > summary').click(); await page.locator('#history-mount').waitFor({ state: 'hidden' }); assert.equal(await page.locator('#history-mount').isVisible(), false); assert.equal(await page.locator('#open-history').getAttribute('aria-expanded'), 'false');
  return { pickerGrid: 12, focusPreserved: true, firstOutsideClickApplied: true, settingsCollapsible: true, historyViaNavigation: true };
});

check('quiz-hides-explorer-information-in-rendered-and-accessible-view', async ({ page }) => {
  await ready(page); await page.locator('[data-training-mode="quiz"]').click();
  for (const selector of ['.fretboard-section', '.selection-section', '#connections', '.structure-summary', '.board-toolbar', '#study-context']) assert.equal(await page.locator(selector).isVisible(), false, selector);
  assert.equal(await page.locator('#structure-heading').innerText(), 'Задания на грифе');
  const explorer = await page.locator('.fretboard-section').ariaSnapshot(); assert.equal(explorer, '');
  return { hiddenExplorer: true, hiddenInspector: true, hiddenConnections: true, neutralHeading: true };
});

check('explicit-route-start-repairs-invalid-display-before-quiz', async ({ page }) => {
  await ready(page); await page.locator('#fret-min').fill('');
  await page.locator('[data-app-module="route"]').click(); await page.locator('[data-route-action="start"]').click();
  await page.getByTestId('quiz-prompt').waitFor(); assert.equal(await page.locator('#range-error').isVisible(), false);
  assert.equal(await page.locator('[data-answer-position]').count(), 4);
  await page.locator('[data-route-action="pause"]').click();
  return { invalidDisplayRepairedExplicitly: true, exactTriadPositions: 4, quizStarted: true };
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

await runNotationBrowserChecks(checks, { reportName: 'p9-design-edge.json', scope: 'Approved VIS-01 r5 implemented in product: shared shell, custom controls, both themes, complete view ranges, 46/18 markers, MIDI octave sections, separate exact material, navigation, invalid states and hidden quiz explorer. No physical bass or full WCAG certification.' });
