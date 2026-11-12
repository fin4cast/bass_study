import { browserRun, startBrowserBuild, writeBrowserReport } from './helpers/browser-runner.mjs';
import { browserTier, FULL_ONLY } from './helpers/browser-case.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = browserRun(root);
let origin = config.origin;
const { resultDir } = config;
const report = {
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  browserChannel: 'msedge',
  browserVersion: null,
  origin,
  scope: 'P2 musical structures and interactive fretboard; no quiz, audio or persistence acceptance.',
  networkIsolation: 'Non-loopback HTTP requests from application pages are aborted. Clean contexts and disabled cache. Windows/browser background services are not isolated.',
  checks: [],
  cleanupErrors: [],
};

let server;
let browser;
let context;
let page;
let externalRequests = [];
let pageErrors = [];

const normalize = value => value.replaceAll('♭', 'b').replaceAll('♯', '#').replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();
const positions = () => page.locator('[data-position]');
const at = id => page.locator(`[data-position="${id}"]`);
const detail = () => page.getByTestId('selection-detail');
const rootSelect = () => page.getByLabel('Тоника', { exact: true });
const structureSelect = () => page.getByLabel('Структура', { exact: true });
const firstFret = () => page.getByLabel('Первый лад', { exact: true });
const lastFret = () => page.getByLabel('Последний лад', { exact: true });
const activePosition = () => page.evaluate(() => document.activeElement?.getAttribute('data-position'));
const selectedPosition = () => page.locator('[data-position][aria-pressed="true"]').getAttribute('data-position');
/** Стартовый раздел оболочки P13 — «Занятие»; атлас «Гриф» открывается из меню. */
async function openAtlas() {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert);
  await page.locator('.site-header [data-app-module="foundation"]').click();
  await page.waitForSelector('[data-position="E:5"]');
}

// Сценарии этого раннера выполняются сразу при вызове check, поэтому полный набор задаётся списком имён.
const fullOnly = new Map([
  'contextual-flat-and-sharp-spelling',
  'restricted-string-and-fret-domain',
  'inclusive-zero-twenty-four-and-upper-range',
  'empty-filter-explains-and-recovers',
  'same-height-different-string-and-octave',
  'chromatic-position-is-selectable-and-context-is-explicit',
  'labels-degrees-and-hidden-keep-accessible-position',
  'root-and-selection-have-accessible-independent-states',
  'keyboard-home-end-and-filtered-string-boundaries',
  'narrow-viewport-scroll-and-last-fret-selection',
].map(name => [name, FULL_ONLY.smoke]));
const skippedChecks = [], seenFullOnly = new Set();

async function check(name, operation) {
  if (fullOnly.has(name)) {
    seenFullOnly.add(name);
    const { skipped } = browserTier([{ name, full: fullOnly.get(name) }]);
    if (skipped.length) { skippedChecks.push(...skipped); console.log(`SKIP ${name}`); return; }
  }
  const start = performance.now();
  try {
    // Every case specifies a fresh P2 baseline; persistence itself is tested in P5.
    await context?.close();
    ({ ctx: context, nextPage: page } = await newContext());
    await page.setViewportSize({ width: 1280, height: 950 });
    await page.goto(origin);
    await openAtlas();
    await revealControl(firstFret());
    // P2 retains its explicit free-map baseline; P8 tests the new default form.
    await page.getByLabel('Учебная форма', { exact: true }).selectOption('');
    await setRange(0, 12);
    await at('E:5').click();
    const evidence = await operation();
    report.checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - start), evidence });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, status: 'failed', durationMs: Math.round(performance.now() - start), error: error.stack || String(error) });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function revealControl(locator) {
  const settings = page.locator('#study-settings');
  if (await locator.locator('xpath=ancestor::*[@id="study-settings"]').count() && !await settings.isVisible()) await page.locator('#toggle-study-settings').click();
  const parents = locator.locator('xpath=ancestor::details');
  for (let index = 0; index < await parents.count(); index++) {
    const details = parents.nth(index);
    if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  }
}

async function setRange(min, max) {
  await revealControl(firstFret());
  // Expand before shrinking so range validation never has to infer an edit intent.
  await lastFret().fill('24');
  await lastFret().press('Tab');
  await firstFret().fill(String(min));
  await firstFret().press('Tab');
  await lastFret().fill(String(max));
  await lastFret().press('Tab');
}

async function setStrings(enabled) {
  await revealControl(page.getByRole('checkbox', { name: 'Струна E', exact: true }));
  for (const name of ['E', 'A', 'D', 'G']) {
    await page.getByRole('checkbox', { name: `Струна ${name}`, exact: true }).setChecked(enabled.includes(name));
  }
}

async function scaleNotes() {
  await revealControl(page.getByTestId('structure-notes'));
  return page.getByTestId('structure-notes').locator('[data-scale-note]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-scale-note')));
}

async function newContext() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      externalRequests.push(url.href);
      await route.abort('internetdisconnected');
    } else await route.continue();
  });
  const nextPage = await ctx.newPage();
  nextPage.on('pageerror', error => pageErrors.push(error.message));
  const cdp = await ctx.newCDPSession(nextPage);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  return { ctx, nextPage };
}

try {
  server = await startBrowserBuild(config, report);
  origin = server.origin;
  await mkdir(resultDir, { recursive: true });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  report.browserVersion = browser.version();
  ({ ctx: context, nextPage: page } = await newContext());

  await check('initial-eadg-range-and-selection', async () => {
    assert.match(await page.title(), /bass/i);
    assert.equal(await rootSelect().inputValue(), 'A');
    assert.equal(await structureSelect().inputValue(), 'minor-pentatonic');
    assert.equal(await rootSelect().locator('option').count(), 12);
    assert.equal(await structureSelect().locator('option').count(), 6);
    assert.equal(await firstFret().inputValue(), '0');
    assert.equal(await lastFret().inputValue(), '12');
    assert.equal(await positions().count(), 52);
    assert.equal(await selectedPosition(), 'E:5');
    assert.equal(await at('E:5').getAttribute('data-midi'), '33');
    assert.match(await detail().innerText(), /A1/);
    return { positions: 52, range: [0, 12], selected: 'E:5', selectedMidi: 33 };
  });

  await check('atlas-has-no-task-tabs-player-or-score-and-bridges-need-a-form', async () => {
    // P13-08: атлас без вкладок «Задания»/«Последовательности», проигрывателя и нотации; звук здесь не начинается.
    for (const selector of ['#training-mount', '#player-mount', '#notation-mount', '[data-player-action]', '[data-training-action]']) {
      assert.equal(await page.locator(selector).count(), 0, selector);
    }
    assert.equal(await page.locator('[data-page-frame="foundation"] [role="tab"]').count(), 0);
    const play = page.getByRole('button', { name: 'Сыграть эту форму', exact: true });
    const checkForm = page.getByRole('button', { name: 'Проверь себя по этой форме', exact: true });
    assert.equal(await play.isDisabled(), true); assert.equal(await checkForm.isDisabled(), true);
    const reason = await page.locator('#atlas-bridge-note').innerText();
    assert.match(reason, /Выбери учебную форму/);
    assert.equal(await play.getAttribute('aria-describedby'), 'atlas-bridge-note');
    await page.getByLabel('Учебная форма', { exact: true }).selectOption({ index: 1 });
    assert.equal(await play.isDisabled(), false); assert.equal(await checkForm.isDisabled(), false);
    assert.doesNotMatch(await page.locator('#atlas-bridge-note').innerText(), /Выбери учебную форму/);
    return { removedMounts: 0, freeRangeReason: reason, formEnablesBridges: true };
  });

  await check('contextual-flat-and-sharp-spelling', async () => {
    await rootSelect().selectOption('F');
    await structureSelect().selectOption('major');
    assert.deepEqual(await scaleNotes(), ['F', 'G', 'A', 'B♭', 'C', 'D', 'E']);
    assert.equal(await at('A:1').getAttribute('data-note-name'), 'B♭');
    assert.equal(await at('A:1').getAttribute('data-in-structure'), 'true');
    await rootSelect().selectOption('F#');
    assert.deepEqual(await scaleNotes(), ['F♯', 'G♯', 'A♯', 'B', 'C♯', 'D♯', 'E♯']);
    assert.equal(await at('E:1').getAttribute('data-note-name'), 'E♯');
    return { fMajorFourth: 'B♭', fSharpMajorSeventh: 'E♯' };
  });

  await check('six-structures-independent-musical-fixtures', async () => {
    const fixtures = [
      ['C', 'major', ['C', 'D', 'E', 'F', 'G', 'A', 'B'], '1 - 2 - 3 - 4 - 5 - 6 - 7'],
      ['A', 'natural-minor', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], '1 - 2 - b3 - 4 - 5 - b6 - b7'],
      ['D', 'major-pentatonic', ['D', 'E', 'F♯', 'A', 'B'], '1 - 2 - 3 - 5 - 6'],
      ['G', 'minor-pentatonic', ['G', 'B♭', 'C', 'D', 'F'], '1 - b3 - 4 - 5 - b7'],
      ['F#', 'major-triad', ['F♯', 'A♯', 'C♯'], '1 - 3 - 5'],
      ['Eb', 'minor-triad', ['E♭', 'G♭', 'B♭'], '1 - b3 - 5'],
    ];
    for (const [tonic, structure, notes, formula] of fixtures) {
      await rootSelect().selectOption(tonic);
      await structureSelect().selectOption(structure);
      assert.deepEqual(await scaleNotes(), notes, `${tonic} ${structure}`);
      assert.equal(normalize(await page.getByTestId('structure-formula').innerText()), formula, `${tonic} ${structure} formula`);
    }
    return { fixtures: fixtures.map(([tonic, structure, notes]) => ({ tonic, structure, notes })) };
  });

  await check('restricted-string-and-fret-domain', async () => {
    await setStrings(['E']);
    await setRange(0, 3);
    assert.equal(await positions().count(), 4);
    assert.deepEqual(await positions().evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-midi'))).sort((a, b) => a - b)), [28, 29, 30, 31]);
    assert.equal(await page.locator('[data-position][data-note-name="A"]').count(), 0);
    return { string: 'E', range: [0, 3], exactMidi: [28, 29, 30, 31] };
  });

  await check('inclusive-zero-twenty-four-and-upper-range', async () => {
    await setRange(0, 24);
    assert.equal(await positions().count(), 100);
    assert.equal(await at('E:0').getAttribute('data-midi'), '28');
    assert.equal(await at('G:24').getAttribute('data-midi'), '67');
    await setRange(12, 24);
    assert.equal(await positions().count(), 52);
    assert.equal(await at('E:11').count(), 0);
    assert.equal(await at('E:12').count(), 1);
    return { fullPositions: 100, upperPositions: 52, endpoints: { E0: 28, G24: 67 } };
  });

  await check('empty-filter-explains-and-recovers', async () => {
    await setStrings([]);
    assert.equal(await positions().count(), 0);
    const message = page.getByTestId('empty-state');
    assert.equal(await message.isVisible(), true);
    assert.match(await message.innerText(), /струн|выбер/i);
    await setStrings(['A']);
    assert.equal(await positions().count(), 13);
    assert.equal(await message.isVisible(), false);
    return { emptyPositions: 0, restoredString: 'A', restoredPositions: 13 };
  });

  await check('invalid-range-recovery-without-runtime-error', async () => {
    await firstFret().fill('20');
    await firstFret().press('Tab');
    const rangeError = page.getByTestId('range-error');
    assert.equal(await rangeError.isVisible(), true);
    assert.ok((await rangeError.innerText()).trim().length > 0);
    await firstFret().fill('0');
    await firstFret().press('Tab');
    assert.equal(await positions().count(), 52);
    assert.equal(await rangeError.isVisible(), false);
    return { invalidRangeReported: true, validRangeRecovered: [0, 12] };
  });

  await check('same-height-different-string-and-octave', async () => {
    await at('E:5').click();
    await revealControl(page.locator('.note-technical .note-facts'));
    assert.match(await detail().innerText(), /A1/);
    assert.match(await page.locator('.note-technical').innerText(), /33/);
    await at('A:0').click();
    await revealControl(page.locator('.note-technical .note-facts'));
    assert.match(await detail().innerText(), /A1/);
    assert.match(await page.locator('.note-technical').innerText(), /33/);
    assert.equal(await selectedPosition(), 'A:0');
    await at('E:12').click();
    await revealControl(page.locator('.note-technical .note-facts'));
    assert.match(await detail().innerText(), /E2/);
    assert.match(await page.locator('.note-technical').innerText(), /40/);
    return { sameHeightPositions: ['E:5', 'A:0'], sameHeightMidi: 33, octavePosition: 'E:12', octaveMidi: 40 };
  });

  await check('chromatic-position-is-selectable-and-context-is-explicit', async () => {
    await at('E:1').click();
    assert.equal(await selectedPosition(), 'E:1');
    assert.equal(await at('E:1').getAttribute('data-in-structure'), 'false');
    assert.match(await detail().innerText(), /F1/);
    assert.match(await detail().innerText(), /не входит|вне/i);
    return { selected: 'E:1', pitch: 'F1', inStructure: false };
  });

  await check('labels-degrees-and-hidden-keep-accessible-position', async () => {
    await page.getByRole('button', { name: 'Ступени', exact: true }).click();
    assert.equal(normalize(await at('E:8').locator('[data-position-label]').textContent()), 'b3');
    await page.getByRole('button', { name: 'Без подписей', exact: true }).click();
    const visibleLabels = await page.locator('[data-position-label]').evaluateAll(nodes => nodes.filter(node => {
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && node.textContent.trim();
    }).length);
    assert.equal(visibleLabels, 0);
    assert.ok((await at('E:8').getAttribute('aria-label')).length > 0);
    assert.equal(await selectedPosition(), 'E:5');
    await page.getByRole('button', { name: 'Ноты', exact: true }).click();
    assert.equal(await at('E:8').locator('[data-position-label]').textContent(), 'C');
    return { minorThird: 'b3', hiddenVisibleLabels: 0, accessiblePositionsRemain: true };
  });

  await check('root-and-selection-have-accessible-independent-states', async () => {
    assert.ok(await page.locator('[data-position][data-root="true"]').count() > 1);
    assert.equal(await at('E:5').getAttribute('data-root'), 'true');
    assert.equal(await at('E:5').getAttribute('aria-pressed'), 'true');
    assert.match(await at('E:5').getAttribute('aria-label'), /тоник/i);
    await at('E:8').click();
    assert.equal(await at('E:8').getAttribute('aria-pressed'), 'true');
    assert.equal(await at('E:8').getAttribute('data-root'), 'false');
    assert.equal(await at('E:5').getAttribute('data-root'), 'true');
    assert.equal(await at('E:5').getAttribute('aria-pressed'), 'false');
    return { rootRemainsIndependent: true, selectionUsesAriaPressed: true };
  });

  await check('keyboard-roving-focus-and-explicit-selection', async () => {
    assert.equal(await page.locator('[data-position][tabindex="0"]').count(), 1);
    await at('E:5').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await activePosition(), 'E:6');
    assert.equal(await selectedPosition(), 'E:5');
    await page.keyboard.press('Enter');
    assert.equal(await selectedPosition(), 'E:6');
    assert.equal(await activePosition(), 'E:6');
    await page.keyboard.press('ArrowUp');
    assert.equal(await activePosition(), 'A:6');
    await page.keyboard.press('Space');
    assert.equal(await selectedPosition(), 'A:6');
    assert.equal(await page.locator('[data-position][tabindex="0"]').count(), 1);
    return { right: 'E:6', up: 'A:6', selectionRequiresActivation: true, tabStops: 1 };
  });

  await check('keyboard-home-end-and-filtered-string-boundaries', async () => {
    await setStrings(['E', 'D']);
    await at('E:5').focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await activePosition(), 'D:5');
    await page.keyboard.press('Home');
    assert.equal(await activePosition(), 'D:0');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await activePosition(), 'D:0');
    await page.keyboard.press('End');
    assert.equal(await activePosition(), 'D:12');
    await page.keyboard.press('ArrowDown');
    assert.equal(await activePosition(), 'E:12');
    await page.keyboard.press('ArrowDown');
    assert.equal(await activePosition(), 'E:12');
    return { visibleStrings: ['D', 'E'], home: 0, end: 12, filteredStringsSkipped: true };
  });

  await check('narrow-viewport-scroll-and-last-fret-selection', async () => {
    await page.setViewportSize({ width: 800, height: 900 });
    await setRange(0, 24);
    await at('G:24').scrollIntoViewIfNeeded();
    await at('G:24').click();
    assert.equal(await selectedPosition(), 'G:24');
    assert.match(await detail().innerText(), /G4/);
    const dimensions = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth }));
    assert.ok(dimensions.body <= dimensions.width + 2, `Entire page overflows: ${JSON.stringify(dimensions)}`);
    await page.screenshot({ path: join(resultDir, 'p2-narrow.png'), fullPage: true });
    return { viewport: 800, lastFretSelectable: 'G:24', bodyWidth: dimensions.body };
  });

  await check('clean-context-local-resources-and-no-runtime-errors', async () => {
    await context.close(); context = null;
    ({ ctx: context, nextPage: page } = await newContext());
    await page.goto(origin);
    await openAtlas();
    assert.equal(await positions().count(), 52);
    assert.match(await page.locator('#box-select option:checked').innerText(), /^Форма A/);
    assert.equal(await firstFret().inputValue(), '0'); assert.equal(await lastFret().inputValue(), '12');
    assert.deepEqual(externalRequests, []);
    const sentinel = await page.evaluate(async () => {
      try { await fetch('https://example.com/p2-network-sentinel'); return 'unexpected-success'; }
      catch { return 'blocked'; }
    });
    assert.equal(sentinel, 'blocked');
    assert.equal(externalRequests.length, 1);
    externalRequests = [];
    assert.deepEqual(pageErrors, []);
    await page.screenshot({ path: join(resultDir, 'p2-desktop.png'), fullPage: true });
    return { freshContextPositions: 16, defaultShape: 'A', defaultRange: [5, 8], externalApplicationRequests: 0, sentinel, pageErrors: [] };
  });
} catch (error) {
  report.setupError = error.stack || String(error);
  console.error(error);
} finally {
  async function cleanup(name, operation) {
    try { await operation(); }
    catch (error) { report.cleanupErrors.push({ name, error: error.stack || String(error) }); console.error(`Cleanup failed (${name}): ${error.message}`); }
  }
  await cleanup('browser-context', async () => { await context?.close(); });
  await cleanup('browser', async () => { await browser?.close(); });
  await cleanup('local-server', async () => { await server?.close(); });
  const unknown = [...fullOnly.keys()].filter(name => !seenFullOnly.has(name));
  if (unknown.length && !report.setupError) report.setupError = `Сценарии полного набора не найдены: ${unknown.join(', ')}`;
  await writeBrowserReport(resultDir, 'p2-edge.json', report, report.checks.length, skippedChecks);
}
