import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runTracksBrowserChecks } from './helpers/tracks-browser-harness.mjs';
import { selection, samplePath, sampleBytes, libraryRoot } from '../experiments/music-bank/inspect.mjs';

const checks = [], check = (name, scope, run) => checks.push({ name, scope, run });
const bank = page => page.locator('#music-bank-mount');
const field = (page, name) => bank(page).locator(`[data-mb="${name}"]`);
const row = (page, index) => field(page, 'tracks').locator(`tr[data-track="${index}"]`);
const sample = id => selection.samples.find(item => item.id === id);
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main')?.inert);
  if (await page.locator('[data-intro="free"]').isVisible()) await page.locator('[data-intro="free"]').click();
}
async function enter(page) { await ready(page); await page.locator('[data-app-module="tracks"]').click(); await page.locator('[data-bank-view="scores"]').click(); }
async function load(page, id) {
  await sampleBytes(sample(id));
  await field(page, 'file').setInputFiles(samplePath(sample(id)));
  await page.waitForFunction(() => document.querySelector('#music-bank-mount')?.dataset.musicBankReady === 'true', undefined, { timeout: 20000 });
  await field(page, 'score').locator('svg').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#music-bank-mount [data-mb="score"] svg text, #music-bank-mount [data-mb="score"] svg path').length > 5);
}
async function exported(page) {
  if (!await page.locator('.history-drawer').evaluate(element => element.open)) await page.locator('#open-history').click();
  const pending = page.waitForEvent('download'); await page.locator('[data-history-action="export"]').click();
  const file = await pending; return JSON.parse(await readFile(await file.path(), 'utf8'));
}
async function closeHistory(page) { if (await page.locator('.history-drawer').evaluate(element => element.open)) await page.locator('#open-history').click(); }
async function observe(page) {
  await page.addInitScript(() => {
    window.__bankContexts = []; window.__bankContextInfo = []; window.__bankReads = 0;
    const Audio = AudioContext;
    window.AudioContext = new Proxy(Audio, { construct(target, args) { const value = Reflect.construct(target, args); window.__bankContexts.push(value); window.__bankContextInfo.push({ stack: new Error().stack, createdAt: performance.now() }); return value; } });
    const originalRead = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function() { window.__bankReads++; return originalRead.call(this); };
    const taps = [], connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(...args) { const result = connect.apply(this, args);
      if (args[0] === this.context.destination && this.constructor.name === 'AudioWorkletNode') { const analyser = this.context.createAnalyser(); analyser.fftSize = 2048; connect.call(this, analyser); taps.push({ node: this, analyser, active: true }); } return result; };
    AudioNode.prototype.disconnect = function(...args) { const result = disconnect.apply(this, args); if (!args.length) for (const tap of taps) if (tap.node === this) tap.active = false; return result; };
    window.__bankLive = async (duration = 450) => { let peak = 0, windows = 0; const end = performance.now() + duration;
      while (performance.now() < end) { for (const tap of taps.filter(t => t.active && t.node.context.state === 'running')) { const data = new Float32Array(2048); tap.analyser.getFloatTimeDomainData(data); windows++; for (const value of data) peak = Math.max(peak, Math.abs(value)); } await new Promise(ok => setTimeout(ok, 20)); } return { peak, windows }; };
  });
  await page.reload(); await ready(page);
}

check('product-15-real-files-render-independent-track-controls-and-reject-old-GTP', 'ui', async ({ page }) => {
  await enter(page); assert.equal(await page.locator('[data-app-module="tracks"]').innerText(), 'Табулатура и ноты');
  assert.equal(await field(page, 'title').innerText(), 'Табулатура и ноты'); const results = [];
  for (const item of selection.samples) {
    if (item.extension === '.gtp') {
      const before = await field(page, 'title').innerText(); await field(page, 'file').setInputFiles(samplePath(item));
      await field(page, 'error').waitFor(); assert.match(await field(page, 'error').innerText(), /не поддерживается/);
      assert.equal(await field(page, 'title').innerText(), before); results.push({ id: item.id, rejected: true }); continue;
    }
    await load(page, item.id);
    const count = await row(page, 0).locator('..').locator('tr').count();
    assert.ok(count > 0); assert.equal(await field(page, 'error').isVisible(), false);
    const last = row(page, count - 1);
    await last.locator('[data-control=audible]').uncheck(); await last.locator('[data-control=audible]').check();
    await last.locator('[data-control=solo]').check(); await last.locator('[data-control=solo]').uncheck();
    await last.locator('[data-control=volume]').fill('0.35'); await last.locator('[data-control=volume]').fill('1');
    results.push({ id: item.id, tracks: count, rendered: true });
  }
  assert.equal(await page.evaluate(() => [window.bankProbe, window.p4, window.p5, window.p6].some(Boolean)), false);
  return { files: results, productHiddenTestApi: false };
});

check('product-independent-drums-live-volume-mute-solo-and-four-notation-states', 'ui', async ({ page }) => {
  await observe(page); await enter(page); await load(page, 'sample-05');
  await row(page, 1).locator('[data-control=solo]').check();
  await field(page, 'from').fill('1'); await field(page, 'to').fill('2'); await field(page, 'apply-range').click(); await field(page, 'loop').check();
  const measure = async () => { await field(page, 'stop').click(); await field(page, 'play').click(); await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing'); return page.evaluate(() => window.__bankLive(1300)); };
  const full = await measure(); assert.ok(full.peak > 1e-5);
  await row(page, 2).locator('[data-control=audible]').uncheck();
  assert.equal(await row(page, 1).locator('[data-control=audible]').isChecked(), true);
  const neighborMuted = await measure(); assert.ok(neighborMuted.peak / full.peak > .7);
  await row(page, 1).locator('[data-control=volume]').fill('0.25');
  const quiet = await measure(); assert.ok(quiet.peak / full.peak > .15 && quiet.peak / full.peak < .4);
  await row(page, 1).locator('[data-control=audible]').uncheck(); const silence = await measure(); assert.ok(silence.peak < 1e-7);
  await field(page, 'stop').click(); await load(page, 'sample-03');
  await field(page, 'play').click(); const before = Number(await field(page, 'seek').inputValue());
  for (const [staff, tab] of [[true,false],[false,true],[false,false],[true,true]]) {
    await field(page, 'staff').setChecked(staff); await field(page, 'tab').setChecked(tab);
    if (!staff && !tab) assert.equal(await field(page, 'empty').isVisible(), true);
    else await field(page, 'score').locator('svg').first().waitFor();
    assert.equal(await bank(page).getAttribute('data-music-bank-state'), 'playing');
  }
  await delay(200); assert.ok(Number(await field(page, 'seek').inputValue()) > before);
  await field(page, 'stop').click();
  return { full, neighborMuted, quiet, silence, quarterToFull: quiet.peak / full.peak, notationStates: 4 };
});

check('product-directory-search-pages-read-only-selected-file-and-no-full-catalogue-backup', 'ui', async ({ page }) => {
  page.setDefaultTimeout(60000); await observe(page); await enter(page);
  await field(page, 'folder').setInputFiles(libraryRoot);
  await page.waitForFunction(() => Number(document.querySelector('[data-mb="catalogue-count"]')?.textContent) > 48000);
  const count = Number(await field(page, 'catalogue-count').innerText());
  assert.ok(await field(page, 'file-list').locator('button').count() <= 80);
  assert.equal(await page.evaluate(() => window.__bankReads), 0);
  await field(page, 'next').click(); assert.match(await field(page, 'page-count').innerText(), /2 \/ /);
  await field(page, 'search').fill('Jackson Billie Jean'); const matches = await field(page, 'file-list').locator('button').count(); assert.ok(matches > 0 && matches < 80);
  await field(page, 'file-list').locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount')?.dataset.musicBankReady === 'true');
  assert.equal(await page.evaluate(() => window.__bankReads), 1);
  const copy = await exported(page); assert.equal(copy.schemaVersion, 9); assert.ok(copy.preferences.musicBank.file.relativePath);
  const serialized = JSON.stringify(copy); assert.ok(!serialized.includes('music-bank-file-') && serialized.length < 100000);
  return { count, matching: matches, sourceReads: 1, backupBytes: Buffer.byteLength(serialized), onlySelectedDescriptor: true };
});

check('product-save-reload-content-rebind-export-restore-and-presets-keep-original-context', 'ui', async ({ page }) => {
  await enter(page); await load(page, 'sample-08');
  await row(page, 1).locator('[data-control=audible]').uncheck(); await row(page, 2).locator('[data-control=volume]').fill('0.4');
  await field(page, 'staff').uncheck(); await field(page, 'speed').selectOption('0.75');
  await field(page, 'from').fill('5'); await field(page, 'to').fill('8'); await field(page, 'apply-range').click(); await field(page, 'loop').check();
  const original = await exported(page); assert.equal(original.preferences.musicBank.tracks[1].audible, false); assert.equal(original.preferences.musicBank.tracks[2].volume, .4);
  await page.reload(); await ready(page); assert.equal(await bank(page).getAttribute('data-music-bank-state'), 'missing'); assert.equal(await field(page, 'play').isEnabled(), false);
  const expected = original.preferences.musicBank;
  const bytes = await sampleBytes(sample('sample-08'));
  await field(page, 'file').setInputFiles({ name: 'Переименованная.gp4', mimeType: 'application/octet-stream', buffer: bytes });
  await page.waitForFunction(() => document.querySelector('#music-bank-mount')?.dataset.musicBankReady === 'true');
  const rebound = await exported(page); const actual = rebound.preferences.musicBank;
  assert.deepEqual(actual.tracks, expected.tracks); assert.deepEqual(actual.notation, expected.notation); assert.deepEqual(actual.range, expected.range); assert.equal(actual.file.sha256, expected.file.sha256);
  await page.locator('[data-history-file]').setInputFiles({ name: 'bank.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
  await page.getByTestId('backup-preview').waitFor(); assert.equal((await exported(page)).preferences.musicBank.file.name, actual.file.name);
  await page.getByRole('checkbox', { name: 'Понимаю, что текущие данные будут заменены', exact: true }).check(); await page.locator('[data-history-action="confirm-restore"]').click();
  await page.getByTestId('backup-preview').waitFor({ state: 'detached' });
  assert.equal(await bank(page).getAttribute('data-music-bank-state'), 'missing');
  const restored = await exported(page); assert.deepEqual(restored.preferences.musicBank, expected);
  return { schema: 7, renameByContent: true, previewDidNotWrite: true, exactRestoredPreferences: true, rebindRequired: true };
});

check('product-pending-file-disables-old-mixer-and-cancel-retains-exact-context', 'ui', async ({ page }) => {
  await enter(page); await load(page, 'sample-03');
  const before = await field(page, 'title').innerText();
  await page.evaluate(() => {
    const native = File.prototype.arrayBuffer;
    const gate = new Promise(resolve => { window.__releaseRead = resolve; });
    File.prototype.arrayBuffer = async function() { const bytes = await native.call(this); await gate; return bytes; };
  });
  await field(page, 'file').setInputFiles(samplePath(sample('sample-08')));
  await field(page, 'cancel').waitFor();
  assert.equal(await row(page, 1).locator('[data-control=audible]').isDisabled(), true);
  assert.equal(await row(page, 1).locator('[data-control=volume]').isDisabled(), true);
  await field(page, 'cancel').click(); await page.evaluate(() => window.__releaseRead()); await delay(200);
  assert.equal(await field(page, 'title').innerText(), before);
  assert.equal(await row(page, 1).locator('[data-control=audible]').isEnabled(), true);
  assert.equal(await row(page, 1).locator('[data-control=audible]').isChecked(), true);
  const copy = await exported(page); assert.equal(copy.preferences.musicBank.file.sha256, sample('sample-03').sha256);
  return { pendingControlsDisabled: true, cancelledCandidateNotSaved: true };
});

check('product-invalid-range-cannot-continue-previous-valid-loop', 'ui', async ({ page }) => {
  await enter(page); await load(page, 'sample-03');
  await field(page, 'from').fill('1'); await field(page, 'to').fill('2'); await field(page, 'apply-range').click(); await field(page, 'loop').check();
  await field(page, 'play').click(); await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  await field(page, 'from').fill('5'); await field(page, 'to').fill('2'); await field(page, 'apply-range').click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState !== 'playing');
  assert.equal(await field(page, 'play').isEnabled(), false); assert.equal(await field(page, 'loop').isChecked(), false);
  assert.match(await field(page, 'error').innerText(), /Недопустимый диапазон/);
  const copy = await exported(page); assert.equal(copy.preferences.musicBank.range, null); assert.equal(copy.preferences.musicBank.loop, false);
  await closeHistory(page); await field(page, 'full-range').click(); assert.equal(await field(page, 'play').isEnabled(), true);
  return { oldRangeCleared: true, noStalePlayback: true, fullSongExplicitRecovery: true };
});

check('product-module-switches-coordinate-bank-and-ear-audio-owners', 'ui', async ({ page }) => {
  await observe(page); await enter(page); await load(page, 'sample-05'); await row(page, 1).locator('[data-control=solo]').check();
  await field(page, 'play').click(); await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  assert.ok((await page.evaluate(() => window.__bankLive(700))).peak > 1e-5);
  await page.locator('[data-app-module="ear"]').click(); await delay(150);
  assert.notEqual(await bank(page).getAttribute('data-music-bank-state'), 'playing');
  const stoppedBank = await page.evaluate(() => window.__bankLive(350)); assert.ok(stoppedBank.peak < 1e-7);
  await page.locator('[data-ear-action="start"]').click(); await page.locator('[data-ear-action="listen"]').click();
  await page.locator('[data-app-module="tracks"]').click(); await field(page, 'play').click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  const resumedBank = await page.evaluate(() => window.__bankLive(700)); assert.ok(resumedBank.peak > 1e-5);
  return { bankStoppedOnLeave: stoppedBank, bankRestartedAfterEar: resumedBank };
});

check('product-studio-scroll-and-both-themes-remain-visible-at-real-viewports', 'ui', async ({ page, resultDir }) => {
  await enter(page); await load(page, 'sample-08'); const layouts = [];
  for (const theme of ['light','dark']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    for (const [width, height] of [[1440,1000],[1366,768],[1024,768],[736,900]]) {
      await page.setViewportSize({ width, height }); await delay(150);
      await page.waitForFunction(() => document.querySelectorAll('#music-bank-mount [data-mb="score"] svg text, #music-bank-mount [data-mb="score"] svg path').length > 5);
      const result = await bank(page).evaluate(root => {
        const scroll = root.querySelector('[data-mb="sheet-scroll"]'), transport = root.querySelector('.mb-transport');
        const before = transport.getBoundingClientRect(); scroll.scrollTop = Math.min(2500, scroll.scrollHeight - scroll.clientHeight); const after = transport.getBoundingClientRect();
        return { top: after.top, bottom: after.bottom, viewport: innerHeight, delta: after.top - before.top, scroll: scroll.scrollTop,
          bodyOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert.equal(result.bodyOverflow, false); assert.equal(result.delta, 0); assert.ok(result.top >= 0 && result.bottom <= height); assert.ok(result.scroll > 0);
      layouts.push({ theme, width, height, ...result });
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await field(page, 'sheet-scroll').evaluate(el => el.scrollTop = 0);
    await page.waitForFunction(() => {
      const pane = document.querySelector('#music-bank-mount [data-mb="sheet-scroll"]').getBoundingClientRect();
      return [...document.querySelectorAll('#music-bank-mount [data-mb="score"] svg text, #music-bank-mount [data-mb="score"] svg path')].filter(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.bottom > pane.top && rect.top < pane.bottom; }).length > 5;
    });
    await delay(250);
    await page.screenshot({ path: join(resultDir, `p10-music-bank-${theme}.png`) });
  }
  const banner = await page.evaluate(() => {
    const element = document.getElementById('persistence-banner'), text = document.getElementById('persistence-message');
    const before = { hidden: element.hidden, className: element.className, text: text.textContent };
    element.hidden = false; element.classList.add('has-error'); text.textContent = 'Проверка размещения длинного сообщения об ошибке сохранения. '.repeat(5);
    return before;
  });
  await delay(150);
  const afterBanner = await bank(page).evaluate(root => ({ bottom: root.getBoundingClientRect().bottom, viewport: innerHeight }));
  assert.ok(afterBanner.bottom <= afterBanner.viewport + 1, JSON.stringify(afterBanner));
  await page.evaluate(before => { const element = document.getElementById('persistence-banner'); element.hidden = before.hidden; element.className = before.className; document.getElementById('persistence-message').textContent = before.text; }, banner);
  return { layouts, bannerPresentationOnly: afterBanner, actualQuotaNotSimulated: true };
});

check('product-native-tab-hide-pauses-and-return-waits-for-explicit-start', 'native', async ({ withNativeBrowser, origin }) => withNativeBrowser(async ({ page, context }) => {
  await observe(page); await enter(page); await load(page, 'sample-05'); await row(page, 1).locator('[data-control=solo]').check(); await field(page, 'play').click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  const signal = await page.evaluate(() => window.__bankLive(600)); assert.ok(signal.peak > 1e-5);
  const other = await context.newPage(); await other.goto(`${origin}/vendor/music-bank/patch-manifest.json`); await other.bringToFront();
  await page.waitForFunction(() => document.hidden); await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState !== 'playing');
  const position = await field(page, 'seek').inputValue(); await delay(250); assert.equal(await field(page, 'seek').inputValue(), position);
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden); assert.equal(await field(page, 'play').isEnabled(), true);
  assert.notEqual(await bank(page).getAttribute('data-music-bank-state'), 'playing'); await field(page, 'play').click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  assert.ok((await page.evaluate(() => window.__bankLive(600))).peak > 1e-5);
  return { nativeHidden: true, signal, noAutomaticResume: true };
}));

check('product-switching-away-cancels-pending-module-load-with-no-late-audio-owner', 'ui', async ({ page, context }) => {
  await observe(page); await enter(page);
  const before = await page.evaluate(() => ({ contexts: window.__bankContexts.length, states: window.__bankContexts.map(ctx => ctx.state), info: window.__bankContextInfo }));
  let release; const gate = new Promise(ok => release = ok); let requested = false;
  await context.route('**/vendor/music-bank/alphaTab.js', async route => { requested = true; await gate; await route.continue(); });
  try {
    await field(page, 'file').setInputFiles(samplePath(sample('sample-03')));
    for (let i = 0; i < 100 && !requested; i++) await delay(20); assert.equal(requested, true);
    await page.locator('[data-app-module="ear"]').click(); release(); await delay(500);
    const after = await page.evaluate(() => ({ contexts: window.__bankContexts.length, states: window.__bankContexts.map(ctx => ctx.state), info: window.__bankContextInfo }));
    assert.equal(after.contexts, before.contexts, JSON.stringify({ before, after }));
    assert.deepEqual(after.states, before.states, 'Отменённая загрузка активировала прежний контекст');
    await page.locator('[data-app-module="tracks"]').click(); assert.notEqual(await bank(page).getAttribute('data-music-bank-state'), 'playing');
  } finally { release?.(); }
  return { pendingImportCancelled: true, existingContextCount: before.contexts, existingContextStates: before.states, lateAudioContexts: 0 };
});

const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
await runTracksBrowserChecks(selectedCase ? checks.filter(test => test.name.includes(selectedCase)) : checks, { reportFile: selectedCase ? 'p10-music-bank-case-edge.json' : 'p10-music-bank-edge.json', scope: 'Product music-bank Studio A, local files/folder, native schema9 persistence, independent real audio and UI; no physical latency claim.' });
