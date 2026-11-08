import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { root } from './inspect.mjs';
import { startServer } from './server.mjs';

const port = 4199;
const origin = `http://127.0.0.1:${port}`;
const resultDir = resolve(root, '../../test-results/music-bank-r1');
const report = {
  startedAt: new Date().toISOString(), browser: null,
  scope: 'Реальный UI отдельного стенда музбанка r1: геометрия, прокрутка, варианты A/B, темы, независимые ноты/TAB и непрерывность транспорта. Физический звук заглушён; PCM и точность транскрипции этим runner не проверяются.',
  server: { port, owned: false }, checks: [], screenshots: [], pageErrors: [], externalRequests: [], limitations: [
    '390×844 — дополнительная проба телефона, не заявление поддержки мобильной платформы.',
    'Смена темы при скрытой узкой навигации выполняется видимой кнопкой до уменьшения окна; доступность смены темы на телефоне не подтверждается.',
    'Непрерывность измеряется по часам браузерного проигрывателя; это не измерение физической задержки или звука.'
  ]
};
let server, browser, page;

async function check(name, run, { required = true, prerequisites = true, skippedReason = '' } = {}) {
  if (!prerequisites) {
    report.checks.push({ name, status: 'skipped', required, reason: skippedReason || 'Предусловие не выполнено.' });
    console.log(`SKIP ${name}`); return false;
  }
  const started = performance.now();
  try {
    const details = await run();
    report.checks.push({ name, status: 'passed', required, elapsedMs: performance.now() - started, details });
    console.log(`PASS ${name}`); return true;
  } catch (error) {
    report.checks.push({ name, status: 'failed', required, elapsedMs: performance.now() - started, error: error.stack || String(error) });
    console.log(`FAIL ${name}: ${error.message}`); return false;
  }
}

async function waitReady(id) {
  await page.waitForFunction(sampleId => {
    const p = window.bankProbe;
    return p && (p.state.error || (p.state.id === sampleId && !p.state.loading && p.api.isReadyForPlayback));
  }, id, { timeout: 45000 });
  const error = await page.evaluate(() => window.bankProbe.state.error);
  assert.equal(error, null, `Ошибка открытия ${id}: ${error}`);
  await page.waitForSelector('#score svg', { timeout: 45000 });
}
async function openSample(id) {
  await page.selectOption('#sample', id); await waitReady(id);
}
async function layout(value) {
  await page.locator(`button[data-layout="${value}"]`).click();
  await page.waitForFunction(v => document.body.dataset.layout === v, value);
}
async function theme(value, viewport) {
  if (!await page.locator(`button[data-theme="${value}"]`).isVisible()) {
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.locator(`button[data-theme="${value}"]`).click();
  await page.waitForFunction(v => document.body.dataset.theme === v, value);
  if (viewport) await page.setViewportSize(viewport);
}
async function showMixer(open) {
  const isOpen = await page.locator('#mixer-panel').isVisible();
  if (isOpen !== open) {
    await page.locator(open ? '#toggle-mixer' : '#close-mixer').click();
  }
  await page.waitForFunction(expected => {
    const panel = document.getElementById('mixer-panel');
    return (panel.getBoundingClientRect().width > 0 && getComputedStyle(panel).display !== 'none') === expected;
  }, open);
  assert.equal(await page.locator('#toggle-mixer').getAttribute('aria-expanded'), String(open));
}
async function geometry() {
  return page.evaluate(() => {
    const rect = selector => {
      const el = document.querySelector(selector), r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
        visible: r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' };
    };
    const sheet = document.getElementById('sheet-scroll');
    const controls = ['#play', '#pause', '#stop', '#speed', '#position', '#from-bar', '#to-bar', '#apply-range', '#loop', '#full-range', '#show-staff', '#show-tab', '#toggle-mixer'];
    return { viewport: { width: innerWidth, height: innerHeight }, document: {
      width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      scrollX, scrollY
    }, boxes: Object.fromEntries(['.reference-bar', '.app-shell', '.main-area', '#transport', '.sheet-pane', '.sheet-toolbar', '#sheet-scroll', '#mixer-panel', '.mixer-heading'].map(s => [s, rect(s)])),
    controls: Object.fromEntries(controls.map(s => [s, rect(s)])),
    sheet: { top: sheet.scrollTop, clientWidth: sheet.clientWidth, scrollWidth: sheet.scrollWidth, clientHeight: sheet.clientHeight, scrollHeight: sheet.scrollHeight } };
  });
}
function inside(box, viewport, name) {
  assert.ok(box.visible, `${name} не виден`);
  assert.ok(box.x >= -2 && box.y >= -2 && box.right <= viewport.width + 2 && box.bottom <= viewport.height + 2,
    `${name} вне окна: ${JSON.stringify(box)}`);
}
function closeBox(a, b, name) {
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(a[key] - b[key]) <= 2,
    `${name}.${key} изменился при прокрутке: ${a[key]} → ${b[key]}`);
}
async function clockAndMix() {
  return page.evaluate(() => ({ id: window.bankProbe.state.id, time: window.bankProbe.api.timePosition,
    playerState: window.bankProbe.api.playerState,
    tracks: window.bankProbe.state.tracks.map(t => ({ audible: t.audible, solo: t.solo, volume: t.volume })) }));
}
function sameMix(before, after) {
  assert.equal(after.id, before.id); assert.deepEqual(after.tracks, before.tracks);
}
function advancing(before, after) {
  sameMix(before, after); assert.equal(after.playerState, 1, 'Смена представления остановила транспорт');
  assert.ok(after.time >= before.time - 50, `Аудиочасы отмотались: ${before.time} → ${after.time}`);
}
async function renderState() {
  return page.evaluate(() => ({ notation: window.bankProbe.state.notation,
    profile: window.bankProbe.api.settings.display.staveProfile,
    scoreVisible: !document.getElementById('score').hidden,
    emptyVisible: !document.getElementById('score-empty').hidden,
    height: document.getElementById('score').getBoundingClientRect().height,
    glyphs: document.querySelectorAll('#score svg path, #score svg text').length,
    renders: window.__bankUiRenders || 0 }));
}
async function notation(staff, tab) {
  const before = await renderState();
  if (await page.locator('#show-staff').isChecked() === staff && await page.locator('#show-tab').isChecked() === tab) return before;
  if (await page.locator('#show-staff').isChecked() !== staff) await page.locator('#show-staff').setChecked(staff);
  if (await page.locator('#show-tab').isChecked() !== tab) await page.locator('#show-tab').setChecked(tab);
  await page.waitForFunction(expected => {
    const { state, api, alphaTab } = window.bankProbe;
    if (state.notation?.staff !== expected.staff || state.notation?.tab !== expected.tab) return false;
    if (!expected.staff && !expected.tab) return document.getElementById('score').hidden && !document.getElementById('score-empty').hidden;
    const profile = expected.staff && expected.tab ? alphaTab.StaveProfile.ScoreTab : expected.staff ? alphaTab.StaveProfile.Score : alphaTab.StaveProfile.Tab;
    return !document.getElementById('score').hidden && api.settings.display.staveProfile === profile &&
      (window.__bankUiRenders || 0) > expected.renders;
  }, { staff, tab, renders: before.renders }, { timeout: 30000 });
  await delay(120); return renderState();
}

await mkdir(resultDir, { recursive: true });
try {
  server = await startServer(port); report.server.owned = true;
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.continue();
    if (url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
    report.externalRequests.push(url); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  await page.goto(origin); await page.waitForFunction(() => window.bankProbe);
  const loaded = await check('sample-03: загрузка и контракт UI', async () => {
    await openSample('sample-03');
    const state = await renderState();
    assert.deepEqual(state.notation, { staff: true, tab: true });
    await page.locator('#follow').uncheck();
    await page.evaluate(() => { window.__bankUiRenders = 0; window.bankProbe.api.renderFinished.on(() => window.__bankUiRenders++); });
    return { tracks: await page.locator('#tracks tr').count(), profile: state.profile, glyphs: state.glyphs };
  });
  const sizes = [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }, { width: 1366, height: 640 }, { width: 1024, height: 768 },
    { width: 736, height: 900 }, { width: 390, height: 844 }];
  for (const viewport of sizes) for (const variant of ['studio', 'reading']) for (const appearance of ['light', 'dark']) {
    await check(`${variant}/${appearance}/${viewport.width}×${viewport.height}: геометрия и закреплённое управление`, async () => {
      await theme(appearance, viewport); await layout(variant); await showMixer(true);
      await page.evaluate(() => { document.getElementById('sheet-scroll').scrollTop = 0; });
      await delay(200);
      const before = await geometry();
      assert.ok(before.document.width <= viewport.width + 2, 'Горизонтальный overflow страницы');
      assert.ok(before.document.height <= viewport.height + 2, 'Вертикальный overflow вместо отдельной области партитуры');
      for (const selector of ['#transport', '.sheet-pane', '.sheet-toolbar', '#mixer-panel', '.mixer-heading']) inside(before.boxes[selector], viewport, selector);
      for (const [selector, box] of Object.entries(before.controls)) inside(box, viewport, selector);
      assert.ok(before.sheet.clientHeight >= 100, 'Партитуре осталось меньше 100 px');
      assert.ok(before.sheet.scrollWidth <= before.sheet.clientWidth + 2, 'Горизонтальный overflow партитуры');
      assert.ok(before.sheet.scrollHeight > before.sheet.clientHeight + 200, 'Материал недостаточно длинный для проверки прокрутки');
      await page.locator('#sheet-scroll').evaluate(el => { el.scrollTop = Math.min(1800, el.scrollHeight - el.clientHeight); });
      await delay(150);
      const after = await geometry();
      assert.ok(after.sheet.top > 100, 'Партитура не прокрутилась');
      for (const selector of ['#transport', '#mixer-panel', '.mixer-heading', '.sheet-toolbar']) closeBox(before.boxes[selector], after.boxes[selector], selector);
      assert.equal(after.document.scrollY, before.document.scrollY);
      return { viewport, variant, appearance, before, after };
    }, { required: viewport.width !== 390, prerequisites: loaded, skippedReason: 'Образец sample-03 не загружен.' });
  }

  const notationPassed = await check('Ноты/TAB независимо: четыре состояния без сброса звука и микшера', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await layout('studio'); await showMixer(true);
    await theme('light'); await page.locator('#follow').uncheck();
    const first = page.locator('#tracks tr').first();
    const volume = first.locator('[data-control=volume]');
    await volume.focus(); await volume.press('Home'); for (let i = 0; i < 7; i++) await volume.press('ArrowRight');
    await first.locator('[data-control=solo]').check();
    await page.click('#play'); await page.waitForFunction(() => window.bankProbe.api.playerState === 1);
    await delay(250);
    const initial = await clockAndMix();
    const combined = await renderState();
    const staff = await notation(true, false); advancing(initial, await clockAndMix());
    assert.ok(staff.height < combined.height - 5, 'Отключение TAB не уменьшило высоту реальной партитуры');
    assert.ok(staff.glyphs > 5, 'Ноты не отрисованы');
    const tab = await notation(false, true); advancing(initial, await clockAndMix());
    assert.ok(tab.height < combined.height - 5, 'Отключение нот не уменьшило высоту реальной партитуры');
    assert.ok(tab.glyphs > 5, 'TAB не отрисован');
    const hidden = await notation(false, false); advancing(initial, await clockAndMix());
    assert.equal(hidden.scoreVisible, false); assert.equal(hidden.emptyVisible, true);
    assert.ok((await page.locator('#score-empty').innerText()).trim().length > 15, 'Нет объяснения скрытой партитуры');
    await notation(true, true); const final = await clockAndMix(); advancing(initial, final);
    assert.ok(final.time > initial.time + 150, 'Аудиочасы не шли во время смены представления');
    await page.click('#pause');
    return { combined, staff, tab, hidden, initial, final };
  }, { prerequisites: loaded, skippedReason: 'Образец sample-03 не загружен.' });

  await check('Выбор видимых партий и сворачивание микшера сохраняют выбранный звук', async () => {
    await notation(true, true); await showMixer(true);
    const initial = await clockAndMix();
    const rows = page.locator('#tracks tr'), count = await rows.count(); assert.ok(count > 1);
    await rows.last().locator('[data-control=visible]').check();
    await rows.first().locator('[data-control=visible]').uncheck();
    await page.waitForFunction(index => window.bankProbe.api.tracks.length === 1 && window.bankProbe.api.tracks[0].index === index, count - 1);
    sameMix(initial, await clockAndMix());
    const time = await page.evaluate(() => window.bankProbe.api.timePosition);
    await showMixer(false); await showMixer(true);
    sameMix(initial, await clockAndMix());
    assert.equal(await page.evaluate(() => window.bankProbe.api.timePosition), time);
    await rows.last().locator('[data-control=visible]').uncheck();
    await page.waitForFunction(() => document.getElementById('score').hidden && !document.getElementById('score-empty').hidden);
    sameMix(initial, await clockAndMix());
    await rows.first().locator('[data-control=visible]').check();
    await page.waitForSelector('#score:not([hidden]) svg');
    return { selectedVisibleIndex: count - 1, tracks: initial.tracks, pausedTime: time };
  }, { prerequisites: notationPassed, skippedReason: 'Не подтверждён контракт независимых нот/TAB; зависимый сценарий не запущен.' });

  await check('Клавиатура: фокус, переключение TAB и прокрутка партитуры', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await showMixer(false);
    await page.locator('#show-staff').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'show-tab');
    const wasChecked = await page.locator('#show-tab').isChecked();
    await page.keyboard.press('Space'); assert.equal(await page.locator('#show-tab').isChecked(), !wasChecked);
    await notation(true, true);
    await page.locator('#sheet-scroll').evaluate(el => { el.scrollTop = 0; });
    await page.locator('#sheet-scroll').focus();
    const focused = await page.evaluate(() => ({ id: document.activeElement.id, outlineStyle: getComputedStyle(document.activeElement).outlineStyle,
      outlineWidth: getComputedStyle(document.activeElement).outlineWidth }));
    assert.equal(focused.id, 'sheet-scroll'); assert.notEqual(focused.outlineStyle, 'none');
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.getElementById('sheet-scroll').scrollTop > 50);
    return { focused, scrollTop: await page.locator('#sheet-scroll').evaluate(el => el.scrollTop) };
  }, { prerequisites: loaded, skippedReason: 'Образец sample-03 не загружен.' });

  await check('Снимки A светлая/тёмная и B чтение на девяти партиях sample-08', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await layout('studio'); await showMixer(true);
    await openSample('sample-08');
    assert.ok(await page.locator('#tracks tr').count() >= 9, 'В образце не найден ожидаемый большой состав');
    await page.locator('#follow').uncheck();
    for (const [variant, appearance, mixer, file] of [['studio', 'light', true, 'studio-light.png'], ['studio', 'dark', true, 'studio-dark.png'], ['reading', 'light', false, 'reading-light.png']]) {
      await theme(appearance); await layout(variant); await showMixer(mixer);
      await page.locator('#sheet-scroll').evaluate(el => { el.scrollTop = 0; });
      await delay(250); await page.waitForSelector('#score svg');
      const path = resolve(resultDir, file); await page.screenshot({ path });
      report.screenshots.push({ file, variant, appearance, sample: 'sample-08', viewport: { width: 1440, height: 1000 }, mixer });
    }
    return { screenshots: report.screenshots };
  }, { prerequisites: loaded, skippedReason: 'Основной стенд не загрузился.' });
  await check('Без ошибок страницы и внешних HTTP-запросов', () => {
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    return { pageErrors: 0, externalRequests: 0 };
  });
  await context.close();
} catch (error) {
  report.fatal = error.stack || String(error); console.error(error);
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(ok => server.close(ok));
  report.completedAt = new Date().toISOString();
  report.summary = { passed: report.checks.filter(c => c.status === 'passed').length,
    failed: report.checks.filter(c => c.status === 'failed').length, skipped: report.checks.filter(c => c.status === 'skipped').length,
    requiredFailed: report.checks.filter(c => c.required && c.status === 'failed').length,
    supplementalFailed: report.checks.filter(c => !c.required && c.status === 'failed').length };
  await writeFile(resolve(resultDir, 'ui.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report.summary, fatal: report.fatal || null }));
if (report.fatal || report.summary.requiredFailed) process.exitCode = 1;
