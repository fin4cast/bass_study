/**
 * P13-09: PCM эталона «Сначала услышь» и сигнала «Послушать» в Edge (OfflineAudioContext), плюс живой
 * проигрыватель: запланированная нота не считается прозвучавшей. Фикстура обслуживается собственным
 * Vite-сервером на свободном порту; физический вывод, тембр и задержка здесь не измеряются.
 *
 * Запуск: `node tests/p13-sound-browser.mjs` (отчёт — `test-results/p13-sound-browser.json`).
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const report = {
  generatedAt: new Date().toISOString(), browserChannel: 'msedge', browserVersion: null, fixtureOrigin: null,
  scope: 'P13-09 OfflineAudioContext PCM of the play-screen reference and reference-card cues; live player trace (cancelled vs sounded). Physical output, timbre and latency are not measured.',
  checks: [], pageErrors: [],
};
const checks = [];
const check = (name, run) => checks.push({ name, run });
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual} (±${tolerance})`);
/** Высота в пределах четверти полутона (≈1,5 %). */
const samePitch = (measured, expected, message) => {
  assert.ok(measured !== null, `${message}: высота не определена`);
  assert.ok(Math.abs(1200 * Math.log2(measured / expected)) < 25, `${message}: ${measured.toFixed(2)} Гц вместо ${expected.toFixed(2)} Гц`);
};

check('reference-pcm-one-pass-no-count-in-no-click', async page => {
  const result = await page.evaluate(() => window.p13sound.renderReference({ template: 'connect-forms', bpm: 76 }));
  const slot = 60 / 76 / 2;
  assert.equal(result.channels, 2);
  assert.equal(result.countInInTrace, 0, 'нет отсчёта');
  assert.equal(result.clicksInTrace, 0, 'нет клика в расписании');
  assert.equal(result.click.peak, 0, 'канал клика в PCM — тишина');
  assert.deepEqual(result.traceNotes.map(note => note.positionId), result.positions, 'те же позиции, что у игры');
  assert.equal(result.bass.onsets.length, result.positions.length, `число начал PCM ${JSON.stringify(result.bass.onsets)}`);
  result.bass.onsets.forEach((time, index) => near(time, index * slot, .02, `начало ноты ${index + 1}`));
  near(result.finishAt, result.positions.length * slot, .0001, 'finishAt — один проход');
  result.pitches.forEach(note => samePitch(note.measuredHz, note.expectedHz, note.positionId));
  assert.ok(result.tailRms < 1e-6, `после finishAt тишина (${result.tailRms})`);
  return { onsets: result.bass.onsets.length, finishAt: result.finishAt, pitches: result.pitches };
});

check('reference-pcm-loop-range-only', async page => {
  const result = await page.evaluate(() => window.p13sound.renderReference({ template: 'connect-forms', bpm: 100, range: { from: 4, toExclusive: 12 } }));
  const slot = 60 / 100 / 2;
  assert.deepEqual(result.traceNotes.map(note => note.noteIndex), [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(result.bass.onsets.length, 8);
  result.bass.onsets.forEach((time, index) => near(time, index * slot, .02, `начало ноты петли ${index + 1}`));
  result.pitches.forEach(note => samePitch(note.measuredHz, note.expectedHz, note.positionId));
  assert.equal(result.click.peak, 0);
  return { onsets: result.bass.onsets, finishAt: result.finishAt };
});

check('reference-card-cues-pcm', async page => {
  const ids = await page.evaluate(() => window.p13sound.listenConcepts);
  assert.equal(ids.length, 8);
  const summary = [];
  for (const id of ids) {
    const result = await page.evaluate(conceptId => window.p13sound.renderConcept(conceptId), id);
    assert.equal(result.channels, 1);
    assert.equal(result.onsets.length, result.expectedOnsets.length, `${id}: начала ${JSON.stringify(result.onsets)}`);
    result.onsets.forEach((time, index) => near(time, result.expectedOnsets[index], .02, `${id}: начало ${index + 1}`));
    result.pitches.forEach(note => samePitch(note.measuredHz, note.expectedHz, `${id} ${note.label}`));
    result.gapRms.forEach((value, index) => assert.ok(value < 1e-4, `${id}: пауза после ноты ${index + 1} (${value})`));
    assert.ok(result.tailRms < 1e-6, `${id}: тишина после сигнала`);
    summary.push({ id, notes: result.pitches.map(note => `${note.label}≈${note.measuredHz.toFixed(1)}`), onsets: result.onsets });
  }
  return summary;
});

check('live-reference-stop-cancels-scheduled-notes', async page => {
  const result = await page.evaluate(() => window.p13sound.liveStopAfter(2));
  assert.equal(result.stateAfter, 'stopped');
  assert.ok(result.soundedBeforeStop >= 2 && result.soundedBeforeStop < result.total, 'прозвучала только часть эталона');
  // Планировщик ставит ноты с опережением: запланированных было больше, чем прозвучавших.
  assert.ok(result.scheduledBeforeStop > result.soundedBeforeStop, `запланировано ${result.scheduledBeforeStop}, прозвучало ${result.soundedBeforeStop}`);
  assert.ok(result.cancelled >= 1, 'будущие ноты помечены cancelled');
  assert.equal(result.notCancelledAfterStop, 0, 'после остановки нет неотменённых нот');
  assert.equal(result.clicks, 0);
  return result;
});

let server, browser;
try {
  server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'warn', clearScreen: false });
  await server.listen();
  const address = server.httpServer.address();
  report.fixtureOrigin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  report.browserVersion = browser.version();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.setDefaultTimeout(20000);
  await page.goto(`${report.fixtureOrigin}/tests/fixtures/p13-sound.html`);
  await page.waitForFunction(() => window.p13sound?.ready);
  for (const { name, run } of checks) {
    try { report.checks.push({ name, status: 'passed', evidence: await run(page) }); }
    catch (error) { report.checks.push({ name, status: 'failed', error: error.stack || String(error) }); }
  }
} catch (error) {
  report.setupError = error.stack || String(error);
} finally {
  await browser?.close();
  await server?.close();
}
report.passed = report.checks.filter(item => item.status === 'passed').length;
report.failed = report.checks.filter(item => item.status === 'failed').length;
report.status = !report.setupError && report.passed === checks.length && !report.pageErrors.length ? 'passed' : 'failed';
const resultDir = join(root, 'test-results');
await mkdir(resultDir, { recursive: true });
await writeFile(join(resultDir, 'p13-sound-browser.json'), JSON.stringify(report, null, 2) + '\n');
for (const item of report.checks) console.log(`${item.status}: ${item.name}${item.error ? `\n${item.error}` : ''}`);
if (report.setupError) console.error(report.setupError);
if (report.pageErrors.length) console.error('pageerror:', report.pageErrors);
console.log(`${report.status}: ${report.passed} passed, ${report.failed} failed`);
process.exitCode = report.status === 'passed' ? 0 : 1;
