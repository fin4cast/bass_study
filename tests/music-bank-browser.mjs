import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runTracksBrowserChecks } from './helpers/tracks-browser-harness.mjs';
import { browserCases, markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';
import { browserRun } from './helpers/browser-runner.mjs';
import { openMusicBankTestInputs } from './helpers/music-bank-fixtures.mjs';
import { go, currentSection, exported, previewCopy, confirmCopy, restoreCopy } from './helpers/shell-data-ui.mjs';

const checks = [], check = (name, scope, run) => checks.push({ name, scope, run });
const bank = page => page.locator('#music-bank-mount');
const field = (page, name) => bank(page).locator(`[data-mb="${name}"]`);
const row = (page, index) => field(page, 'tracks').locator(`tr[data-track="${index}"]`);
let inputs;
const sample = id => inputs.selection.samples.find(item => item.id === (!inputs.corpus && id === 'sample-08' ? 'sample-05' : id));
const samplePath = item => inputs.samplePath(item);
const sampleBytes = item => inputs.sampleBytes(item);
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main')?.inert);
}
async function enter(page) { await ready(page); await go(page, 'tracks'); await page.locator('[data-bank-view="scores"]').click(); }
/** Readonly-чтение сохранённых настроек нативной IndexedDB: без продуктового API и без создания базы. */
async function storedPreferences(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Readonly reader encountered a missing database')); };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = db.transaction('preferences', 'readonly');
      const request = transaction.objectStore('preferences').get('current');
      return await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    } finally { db.close(); }
  });
}
async function load(page, id) {
  await sampleBytes(sample(id));
  await field(page, 'file').setInputFiles(samplePath(sample(id)));
  await page.waitForFunction(() => document.querySelector('#music-bank-mount')?.dataset.musicBankReady === 'true', undefined, { timeout: 20000 });
  await field(page, 'score').locator('svg').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#music-bank-mount [data-mb="score"] svg text, #music-bank-mount [data-mb="score"] svg path').length > 5);
}
function studioWav() {
  const sampleRate = 16000, frames = sampleRate * 2, buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) buffer.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 55 * frame / sampleRate)), 44 + frame * 2);
  return { name: 'studio-synthetic-bass.wav', mimeType: 'audio/wav', buffer };
}
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
    window.__bankAudioTime = () => Math.max(0, ...window.__bankContexts.filter(ctx => ctx.state === 'running').map(ctx => ctx.currentTime));
    window.__bankLive = async (duration = 450) => { let peak = 0, windows = 0; const end = performance.now() + duration;
      while (performance.now() < end) { for (const tap of taps.filter(t => t.active && t.node.context.state === 'running')) { const data = new Float32Array(2048); tap.analyser.getFloatTimeDomainData(data); windows++; for (const value of data) peak = Math.max(peak, Math.abs(value)); } await new Promise(ok => setTimeout(ok, 20)); } return { peak, windows }; };
  });
  await page.reload(); await ready(page);
}
/** Состояние «playing» не значит, что вывод уже звучит: Edge запускает устройство с задержкой. Ждём хода аудиочасов. */
async function untilBankAudioMoves(page) {
  const from = await page.evaluate(() => window.__bankAudioTime());
  await page.waitForFunction(from => window.__bankAudioTime() > from + .05, from, { timeout: 6000 });
}

check('product-files-render-independent-track-controls-and-reject-unsupported-input', 'ui', async ({ page }) => {
  await enter(page); assert.equal(await page.locator('.site-header [data-app-module="tracks"]').innerText(), 'Песни');
  assert.equal(await page.locator('#tracks-mount').getByRole('heading', { level: 1 }).innerText(), 'Песни'); const results = [];
  for (const item of inputs.selection.samples) {
    if (item.extension === '.gtp') {
      const before = await field(page, 'song-info').innerText(); await field(page, 'file').setInputFiles(samplePath(item));
      await field(page, 'error').waitFor(); assert.match(await field(page, 'error').innerText(), /не поддерживается/);
      assert.equal(await field(page, 'song-info').innerText(), before); results.push({ id: item.id, rejected: true }); continue;
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
  await field(page, 'folder').setInputFiles(inputs.libraryRoot);
  await page.waitForFunction(minimum => Number(document.querySelector('[data-mb="catalogue-count"]')?.textContent) >= minimum, inputs.minimumCount);
  const count = Number(await field(page, 'catalogue-count').innerText());
  assert.ok(await field(page, 'file-list').locator('button').count() <= 80);
  assert.equal(await page.evaluate(() => window.__bankReads), 0);
  await field(page, 'next').click(); assert.match(await field(page, 'page-count').innerText(), /2 \/ /);
  await field(page, 'search').fill(inputs.query); const matches = await field(page, 'file-list').locator('button').count(); assert.ok(matches > 0 && matches < 80);
  await field(page, 'file-list').locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount')?.dataset.musicBankReady === 'true');
  assert.equal(await page.evaluate(() => window.__bankReads), 1);
  const copy = await exported(page); assert.equal(copy.schemaVersion, 11); assert.ok(copy.preferences.musicBank.file.relativePath);
  const serialized = JSON.stringify(copy); assert.ok(!serialized.includes('music-bank-file-') && serialized.length < 100000);
  return { count, matching: matches, sourceReads: 1, backupBytes: Buffer.byteLength(serialized), onlySelectedDescriptor: true };
});

check('product-save-reload-content-rebind-export-restore-keep-original-context', 'ui', async ({ page }) => {
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
  const preview = await previewCopy(page, original, 'bank.json');
  assert.equal((await storedPreferences(page)).musicBank.file.name, actual.file.name, 'Предпросмотр копии ничего не записывает');
  await confirmCopy(page, preview);
  assert.equal(await bank(page).getAttribute('data-music-bank-state'), 'missing');
  const restored = await exported(page); assert.deepEqual(restored.preferences.musicBank, expected);
  return { schema: 7, renameByContent: true, previewDidNotWrite: true, exactRestoredPreferences: true, rebindRequired: true };
});

check('product-studio-bindings-survive-atlas-and-progress-shortcuts', 'ui', async ({ page }) => {
  const wav = studioWav();
  const audio = page.locator('#legacy-tracks-mount');
  const audioAction = name => audio.locator(`[data-tracks-action="${name}"]`);
  const audioTab = page.locator('[data-bank-view="audio"]');
  const scoreTab = page.locator('[data-bank-view="scores"]');
  const activeSection = () => currentSection(page);
  const audioReady = () => page.waitForFunction(() => document.querySelector('#legacy-tracks-mount')?.dataset.tracksReady === 'true');
  const timeline = panel => panel.locator('.studio-timeline').evaluate(element => {
    const seek = element.querySelector('input[type="range"]');
    const time = element.querySelector('output');
    const seekStyle = getComputedStyle(seek), timeStyle = getComputedStyle(time);
    const seekBounds = seek.getBoundingClientRect(), timeBounds = time.getBoundingClientRect();
    return {
      seek: [seekStyle.height, seekStyle.accentColor, seekStyle.backgroundColor, seekStyle.cursor],
      time: [timeStyle.fontFamily, timeStyle.fontSize, timeStyle.color, timeStyle.lineHeight],
      rightAligned: timeBounds.right === element.getBoundingClientRect().right && timeBounds.left >= seekBounds.right,
      centered: Math.abs((seekBounds.top + seekBounds.bottom) - (timeBounds.top + timeBounds.bottom)) < 1,
    };
  });
  const playScore = async () => {
    assert.equal(await bank(page).getAttribute('data-music-bank-ready'), 'true');
    await field(page, 'play').click();
    await page.waitForFunction(() => document.querySelector('#music-bank-mount')?.dataset.musicBankState === 'playing');
  };
  const playAudio = async () => {
    assert.equal(await audio.getAttribute('data-tracks-bound'), '1');
    await audioAction('play').click();
    await page.waitForFunction(() => document.querySelector('#legacy-tracks-mount')?.dataset.tracksState === 'playing');
  };

  await ready(page);
  const initial = await exported(page);
  initial.history.push(JSON.parse(await readFile(new URL('./fixtures/screen-shape-v1.json', import.meta.url), 'utf8')));
  await restoreCopy(page, initial, 'studio-practice.json');

  await enter(page); await load(page, 'sample-05');
  const scoreTimeline = await timeline(bank(page));
  assert.equal(scoreTimeline.rightAligned && scoreTimeline.centered, true);
  await row(page, 0).locator('[data-control=volume]').fill('0.6');
  await audioTab.click();
  await audio.getByLabel('Новый набор аудиофайлов', { exact: true }).setInputFiles(wav);
  await audioReady();
  assert.deepEqual(await timeline(audio), scoreTimeline);
  await audio.getByLabel('Повторять аудиофрагмент', { exact: true }).check();
  const studio = (await exported(page)).preferences;
  assert.ok(studio.musicBank.file && studio.tracks);

  // Переходы, которые открывают другой раздел не из меню: мостик атласа «Сыграть эту форму» и «Повторить» ошибки заданий в «Прогрессе».
  await scoreTab.click(); await playScore();
  await go(page, 'foundation'); await page.locator('#atlas-play').click();
  await page.waitForFunction(() => document.querySelector('.site-header [aria-current="page"]')?.dataset.appModule === 'lesson');
  assert.equal(await activeSection(), 'lesson');
  await enter(page); await playScore(); await field(page, 'stop').click();
  await audioTab.click(); await playAudio();

  await go(page, 'progress'); await page.locator('[data-page-frame="progress"] [data-repeat-errors]:visible').first().click();
  await page.waitForFunction(() => document.querySelector('.site-header [aria-current="page"]')?.dataset.appModule === 'lesson');
  assert.equal(await activeSection(), 'lesson');
  await enter(page); await playScore(); await field(page, 'stop').click();
  await audioTab.click(); await playAudio(); await audioAction('stop').click();
  const afterShortcuts = (await exported(page)).preferences;
  assert.deepEqual(afterShortcuts.musicBank, studio.musicBank);
  assert.deepEqual(afterShortcuts.tracks, studio.tracks);

  return { playedAfterAtlasPlayBridge: ['score', 'audio'], playedAfterProgressRepeatErrors: ['score', 'audio'],
    exactDescriptorsAndMixPreserved: true, sharedTimeline: scoreTimeline };
});

check('product-pending-file-disables-old-mixer-and-cancel-retains-exact-context', 'ui', async ({ page }) => {
  await enter(page); await load(page, 'sample-03');
  const before = await field(page, 'song-info').innerText();
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
  assert.equal(await field(page, 'song-info').innerText(), before);
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
  await field(page, 'full-range').click(); assert.equal(await field(page, 'play').isEnabled(), true);
  return { oldRangeCleared: true, noStalePlayback: true, fullSongExplicitRecovery: true };
});

check('product-module-switches-coordinate-bank-and-rhythm-audio-owners', 'ui', async ({ page }) => {
  await observe(page); await enter(page); await load(page, 'sample-05'); await row(page, 1).locator('[data-control=solo]').check();
  await field(page, 'play').click(); await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  assert.ok((await page.evaluate(() => window.__bankLive(700))).peak > 1e-5);
  await go(page, 'harmony'); await delay(150);
  assert.notEqual(await bank(page).getAttribute('data-music-bank-state'), 'playing');
  const stoppedBank = await page.evaluate(() => window.__bankLive(350)); assert.ok(stoppedBank.peak < 1e-7);
  // Другой владелец звука: метроном «Ритма» начинает играть, пока партитура остановлена.
  await page.locator('[data-rhythm-action="start"]').click();
  await page.waitForFunction(() => document.querySelector('.rhythm-view')?.dataset.rhythmState === 'running');
  await go(page, 'tracks');
  await page.waitForFunction(() => document.querySelector('.rhythm-view')?.dataset.rhythmState !== 'running');
  await field(page, 'play').click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  const resumedBank = await page.evaluate(() => window.__bankLive(700)); assert.ok(resumedBank.peak > 1e-5);
  return { bankStoppedOnLeave: stoppedBank, rhythmOwnerPausedOnReturn: true, bankRestartedAfterRhythm: resumedBank };
});

// Типичная ширина 1366×768 в обеих темах входит в быстрый набор; остальные реальные размеры — в полный.
const studioViewports = (viewports, { finalChecks }) => async ({ page, resultDir }) => {
  await enter(page); await load(page, 'sample-08'); const layouts = [];
  for (const theme of ['light','dark']) {
    await page.locator(`.site-header [data-theme-choice="${theme}"]`).click();
    for (const [width, height] of viewports) {
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
    if (!finalChecks) continue;
    await page.setViewportSize({ width: 1440, height: 1000 }); await field(page, 'sheet-scroll').evaluate(el => el.scrollTop = 0);
    await page.waitForFunction(() => {
      const pane = document.querySelector('#music-bank-mount [data-mb="sheet-scroll"]').getBoundingClientRect();
      return [...document.querySelectorAll('#music-bank-mount [data-mb="score"] svg text, #music-bank-mount [data-mb="score"] svg path')].filter(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.bottom > pane.top && rect.top < pane.bottom; }).length > 5;
    });
    await delay(250);
    await page.screenshot({ path: join(resultDir, `p10-music-bank-${theme}.png`) });
  }
  if (!finalChecks) return { layouts };
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
};
check('product-studio-scroll-and-both-themes-remain-visible-at-1366x768', 'ui', studioViewports([[1366,768]], { finalChecks: true }));
check('product-studio-scroll-and-both-themes-remain-visible-at-other-real-viewports', 'ui', studioViewports([[1440,1000],[1024,768],[736,900]], { finalChecks: false }));

check('product-native-tab-hide-pauses-and-return-waits-for-explicit-start', 'native', async ({ withNativeBrowser, origin }) => withNativeBrowser(async ({ page, context }) => {
  await observe(page); await enter(page); await load(page, 'sample-05'); await row(page, 1).locator('[data-control=solo]').check(); await field(page, 'play').click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  await untilBankAudioMoves(page);
  const signal = await page.evaluate(() => window.__bankLive(600)); assert.ok(signal.peak > 1e-5);
  const other = await context.newPage(); await other.goto(`${origin}/vendor/music-bank/patch-manifest.json`); await other.bringToFront();
  await page.waitForFunction(() => document.hidden, undefined, { polling: 100 }); await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState !== 'playing', undefined, { polling: 100 });
  const position = await field(page, 'seek').inputValue(); await delay(250); assert.equal(await field(page, 'seek').inputValue(), position);
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden); assert.equal(await field(page, 'play').isEnabled(), true);
  assert.notEqual(await bank(page).getAttribute('data-music-bank-state'), 'playing'); await field(page, 'play').click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  await untilBankAudioMoves(page);
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
    await go(page, 'foundation'); release(); await delay(500);
    const after = await page.evaluate(() => ({ contexts: window.__bankContexts.length, states: window.__bankContexts.map(ctx => ctx.state), info: window.__bankContextInfo }));
    assert.equal(after.contexts, before.contexts, JSON.stringify({ before, after }));
    assert.deepEqual(after.states, before.states, 'Отменённая загрузка активировала прежний контекст');
    await go(page, 'tracks'); assert.notEqual(await bank(page).getAttribute('data-music-bank-state'), 'playing');
  } finally { release?.(); }
  return { pendingImportCancelled: true, existingContextCount: before.contexts, existingContextStates: before.states, lateAudioContexts: 0 };
});

check('product-engine-failure-keeps-committed-score-and-latest-selection-wins', 'ui', async ({ page, context }) => {
  await enter(page);
  await load(page, 'sample-03');
  const title = await field(page, 'song-info').innerText();
  await row(page, 0).locator('[data-control=volume]').fill('0.45');
  await field(page, 'from').fill('2');
  await field(page, 'to').fill('3');
  await field(page, 'apply-range').click();
  const saved = (await exported(page)).preferences.musicBank;
  await field(page, 'play').click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  let blocked = 0;
  const soundFont = '**/sonivox.sf2';
  const rejectSoundFont = route => { blocked++; return route.abort('failed'); };
  await context.route(soundFont, rejectSoundFont);
  await field(page, 'file').setInputFiles(samplePath(sample('sample-05')));
  await field(page, 'error').waitFor();
  assert.ok(blocked > 0);
  assert.equal(await field(page, 'song-info').innerText(), title);
  assert.equal(await field(page, 'play').isEnabled(), true);
  assert.equal(await bank(page).getAttribute('data-music-bank-state'), 'paused');
  assert.deepEqual((await exported(page)).preferences.musicBank, saved);
  await field(page, 'play').click();
  await page.waitForFunction(() => document.querySelector('#music-bank-mount').dataset.musicBankState === 'playing');
  await context.unroute(soundFont, rejectSoundFont);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requests = 0;
  const delayFirst = async route => {
    if (++requests === 1) await gate;
    await route.continue().catch(() => {});
  };
  await context.route(soundFont, delayFirst);
  try {
    await field(page, 'file').setInputFiles(samplePath(sample('sample-05')));
    for (let i = 0; i < 150 && !requests; i++) await delay(20);
    assert.equal(requests, 1);
    await load(page, 'sample-03');
    release();
    await delay(350);
    assert.equal(await field(page, 'song-info').innerText(), title);
    assert.equal(await page.locator('.mb-score-staging').count(), 0);
    assert.deepEqual((await exported(page)).preferences.musicBank, saved);
  } finally {
    release();
    await context.unroute(soundFont, delayFirst);
  }
  return { retainedAfterSoundFontFailure: true, lastFileIntentWins: true, unchangedDescriptorAndMix: true };
});

markFullOnly(checks, [
  'product-native-tab-hide-pauses-and-return-waits-for-explicit-start',
], FULL_ONLY.hiddenTab);
markFullOnly(checks, ['product-studio-scroll-and-both-themes-remain-visible-at-other-real-viewports'], FULL_ONLY.viewports);
markFullOnly(checks, [
  'product-independent-drums-live-volume-mute-solo-and-four-notation-states',
], FULL_ONLY.liveAudio);
markFullOnly(checks, [
  'product-directory-search-pages-read-only-selected-file-and-no-full-catalogue-backup',
  'product-studio-bindings-survive-atlas-and-progress-shortcuts',
  'product-pending-file-disables-old-mixer-and-cancel-retains-exact-context',
  'product-module-switches-coordinate-bank-and-rhythm-audio-owners',
  'product-engine-failure-keeps-committed-score-and-latest-selection-wins',
], FULL_ONLY.smoke);
const selection = browserCases(checks);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
inputs = await openMusicBankTestInputs(browserRun(root).resultDir);
await runTracksBrowserChecks(selection.checks, { reportFile: selection.filtered ? 'p10-music-bank-case-edge.json' : 'p10-music-bank-edge.json',
  scope: `Product music-bank Studio A with ${inputs.corpus ? 'personal corpus' : 'original synthetic scores'}, local files/folder, native schema11 persistence, independent real audio and UI; no physical latency claim.` });
