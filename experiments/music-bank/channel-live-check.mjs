import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { selection, resultDir } from './inspect.mjs';
import { startServer } from './server.mjs';
import { generatedVendor } from './prepare-vendor.mjs';

const port = 4201, origin = `http://127.0.0.1:${port}`;
const outputDir = resolve(resultDir, '../music-bank-r1');
const report = { generatedAt: new Date().toISOString(), browser: null,
  scope: 'Настоящие sample-05/08, четыре ранее объединённые ударные партии. Видимые UI-контролы и фактический AudioWorklet PCM через Analyser. Физический выход заглушён, акустика не проверяется.',
  server: { port, owned: false }, manifest: JSON.parse(await readFile(resolve(generatedVendor, 'patch-manifest.json'), 'utf8')),
  files: [], checks: [], externalRequests: [], pageErrors: [], limitations: [
    'Короткие повторяемые участки четырёх партий из двух реальных файлов; не приёмка всего банка.',
    'Live-окна статистически сравниваются; точное совпадение с одиночным штатным синтезом отдельно проверено Node PCM в channels.json.'
  ] };
let server, browser;
async function check(name, action) {
  try { const details = await action(); report.checks.push({ name, status: 'passed', details }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, status: 'failed', error: error.stack || String(error) }); console.log(`FAIL ${name}: ${error.message}`); }
}
async function slider(input, value) {
  const step = Number(await input.getAttribute('step'));
  await input.focus(); await input.press('Home');
  for (let i = 0; i < Math.round(value / step); i++) await input.press('ArrowRight');
  assert.ok(Math.abs(Number(await input.inputValue()) - value) < 1e-6);
}

try {
  await mkdir(outputDir, { recursive: true });
  server = await startServer(port); report.server.owned = true;
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] }); report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1380, height: 1000 } });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.continue();
    report.externalRequests.push(url); return route.abort();
  });
  await context.addInitScript(() => {
    const taps = [], connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(...args) {
      const result = connect.apply(this, args);
      if (args[0] === this.context.destination && this.constructor.name === 'AudioWorkletNode') {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
        connect.call(this, analyser); taps.push({ node: this, analyser, context: this.context, active: true });
      }
      return result;
    };
    AudioNode.prototype.disconnect = function(...args) {
      const result = disconnect.apply(this, args);
      if (!args.length) for (const t of taps) if (t.node === this) t.active = false;
      return result;
    };
    window.__channelLive = { measure: async duration => {
      let peak = 0, squares = 0, samples = 0, windows = 0, activeMax = 0;
      const end = performance.now() + duration;
      while (performance.now() < end) {
        const active = taps.filter(t => t.active && t.context.state === 'running'); activeMax = Math.max(activeMax, active.length);
        for (const t of active) {
          const values = new Float32Array(t.analyser.fftSize); t.analyser.getFloatTimeDomainData(values); windows++;
          for (const v of values) { peak = Math.max(peak, Math.abs(v)); squares += v*v; samples++; }
        }
        await new Promise(ok => setTimeout(ok, 20));
      }
      return { peak, rms: Math.sqrt(squares / Math.max(samples, 1)), sampledValues: samples, windows, activeMax, durationMs: duration };
    } };
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  await page.goto(origin); await page.waitForFunction(() => window.bankProbe);
  for (const id of ['sample-05', 'sample-08']) {
    const sample = selection.samples.find(s => s.id === id), file = { id, sha256: sample.sha256, targets: [] };
    report.files.push(file);
    await page.selectOption('#sample', id);
    await page.waitForFunction(id => window.bankProbe.state.error || (window.bankProbe.state.id === id && !window.bankProbe.state.loading), id);
    assert.equal(await page.evaluate(() => window.bankProbe.state.error), null);
    const targets = await page.evaluate(() => {
      const { api, state } = window.bankProbe;
      if (state.sharedChannels.length) throw new Error('После нормализации остались общие каналы');
      return api.score.tracks.filter(t => t.isPercussion).map(t => {
        for (const staff of t.staves) for (const bar of staff.bars) {
          const beats = bar.voices.flatMap(v => v.beats).filter(b => b.notes.some(n => !n.isTieDestination));
          if (!beats.length) continue;
          const master = api.tickCache.getMasterBar(bar.masterBar);
          const tempoChanges = master.tempoChanges.slice().sort((a,b) => a.tick - b.tick);
          let tempo = master.tempo, position = master.start, ms = 0;
          for (const change of tempoChanges) {
            if (change.tick > position) ms += (change.tick - position) * 60000 / (960 * tempo);
            position = change.tick; tempo = change.tempo;
          }
          ms += (master.end - position) * 60000 / (960 * tempo);
          return { index: t.index, name: t.name, program: t.playbackInfo.program, bank: t.playbackInfo.bank,
            channels: [...new Set([t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel])],
            bar: bar.index, startTick: master.start, endTick: master.end, barMs: ms,
            firstNoteTick: api.tickCache.getBeatStart(beats[0]), noteBeats: beats.length };
        }
        throw new Error(`Ударная партия ${t.index} пуста`);
      });
    });
    assert.equal(targets.length, 2, 'Ожидаются две исходно связанные ударные партии');
    assert.deepEqual(targets.map(t => t.channels), [[9], [25]]);
    for (const target of targets) {
      const entry = { ...target, phase: 'start', measurements: {} }; file.targets.push(entry);
      await check(`${id}/${target.index}: независимые live solo/mute/volume`, async () => {
        const neighbor = targets.find(t => t.index !== target.index).index;
        const rows = await page.locator('#tracks tr').count();
        const row = index => page.locator(`#tracks tr[data-track="${index}"]`);
        await page.click('#stop'); await page.selectOption('#speed', '1');
        for (let i = 0; i < rows; i++) {
          await row(i).locator('[data-control=audible]').check();
          await row(i).locator('[data-control=solo]').setChecked(i === target.index);
          await slider(row(i).locator('[data-control=volume]'), 1);
        }
        await page.locator('#from-bar').fill(String(target.bar + 1));
        await page.locator('#to-bar').fill(String(target.bar + 1)); await page.locator('#loop').check();
        const duration = Math.ceil(target.barMs * 2 + 250);
        assert.ok(duration > 500 && duration < 12000, `Неожиданная длительность такта ${target.barMs}`);
        async function measure(name) {
          entry.phase = name;
          await page.click('#stop'); await page.click('#apply-range'); await page.click('#play');
          await page.waitForFunction(() => window.bankProbe.api.playerState === 1);
          await delay(200);
          const stats = entry.measurements[name] = await page.evaluate(ms => window.__channelLive.measure(ms), duration);
          stats.ui = await page.evaluate(() => window.bankProbe.state.tracks.map(t => ({ audible: t.audible, solo: t.solo, volume: t.volume })));
          await page.click('#stop');
          assert.ok(stats.windows > 0 && stats.activeMax === 1, 'Ожидается один настоящий AudioWorklet');
          return stats;
        }
        const full = await measure('solo-full'); assert.ok(full.peak > 1e-5);
        // Меняется только сосед. При общем канале любой из этих шагов гасил бы и цель.
        await row(neighbor).locator('[data-control=audible]').uncheck();
        assert.equal(await row(target.index).locator('[data-control=audible]').isChecked(), true);
        const neighborMuted = await measure('neighbor-muted'); assert.ok(neighborMuted.peak > 1e-5);
        assert.ok(neighborMuted.peak / full.peak > 0.75 && neighborMuted.peak / full.peak < 1.25);
        await row(neighbor).locator('[data-control=audible]').check();
        await slider(row(neighbor).locator('[data-control=volume]'), 0);
        assert.equal(Number(await row(target.index).locator('[data-control=volume]').inputValue()), 1);
        const neighborZero = await measure('neighbor-volume-zero'); assert.ok(neighborZero.peak > 1e-5);
        assert.ok(neighborZero.peak / full.peak > 0.75 && neighborZero.peak / full.peak < 1.25);
        await slider(row(neighbor).locator('[data-control=volume]'), 1);
        await slider(row(target.index).locator('[data-control=volume]'), 0.25);
        const quiet = await measure('target-volume-quarter');
        entry.peakQuarterToFull = quiet.peak / full.peak; entry.rmsQuarterToFull = quiet.rms / full.rms;
        assert.ok(entry.peakQuarterToFull > 0.18 && entry.peakQuarterToFull < 0.32, `Live peak quarter/full=${entry.peakQuarterToFull}`);
        assert.ok(entry.rmsQuarterToFull > 0.12 && entry.rmsQuarterToFull < 0.45, `Live RMS quarter/full=${entry.rmsQuarterToFull}`);
        await row(target.index).locator('[data-control=audible]').uncheck();
        const muted = await measure('target-muted'); assert.ok(muted.peak < 1e-7);
        // Альтернативная изоляция той же партии: solo снято, остальные выключены.
        for (let i = 0; i < rows; i++) {
          await row(i).locator('[data-control=solo]').uncheck();
          await row(i).locator('[data-control=audible]').setChecked(i === target.index);
        }
        await slider(row(target.index).locator('[data-control=volume]'), 1);
        const onlyAudible = await measure('only-target-audible'); assert.ok(onlyAudible.peak > 1e-5);
        assert.ok(onlyAudible.peak / full.peak > 0.75 && onlyAudible.peak / full.peak < 1.25);
        entry.phase = 'complete';
        return { channels: target.channels, neighbor, peakQuarterToFull: entry.peakQuarterToFull,
          rmsQuarterToFull: entry.rmsQuarterToFull, mutedPeak: muted.peak,
          neighborMutedPeak: neighborMuted.peak, neighborZeroPeak: neighborZero.peak, onlyTargetPeak: onlyAudible.peak };
      });
    }
  }
  await check('Смена песни сбрасывает старые mute/solo/volume, включая отсутствующие каналы', async () => {
    const regression = report.fileChangeRegression = { phase: 'previous-mix', from: 'sample-08', to: 'sample-05' };
    assert.equal(await page.evaluate(() => window.bankProbe.state.id), 'sample-08');
    await page.click('#stop');
    const rows = await page.locator('#tracks tr').count();
    for (let i = 0; i < rows; i++) await page.locator(`#tracks tr[data-track="${i}"] [data-control=solo]`).setChecked(i === 7);
    await page.locator('#tracks tr[data-track="7"] [data-control=audible]').check();
    await page.locator('#tracks tr[data-track="1"] [data-control=audible]').uncheck();
    await slider(page.locator('#tracks tr[data-track="1"] [data-control=volume]'), 0);
    regression.before = await page.evaluate(() => ({
      ui: window.bankProbe.state.tracks.map(t => ({ audible: t.audible, solo: t.solo, volume: t.volume })),
      oldSoloChannels: [window.bankProbe.api.score.tracks[7].playbackInfo.primaryChannel, window.bankProbe.api.score.tracks[7].playbackInfo.secondaryChannel]
    }));
    assert.deepEqual(regression.before.oldSoloChannels, [11, 12]);
    regression.phase = 'new-file';
    await page.selectOption('#sample', 'sample-05');
    await page.waitForFunction(() => window.bankProbe.state.error || (window.bankProbe.state.id === 'sample-05' && !window.bankProbe.state.loading));
    assert.equal(await page.evaluate(() => window.bankProbe.state.error), null);
    regression.after = await page.evaluate(() => ({
      ui: window.bankProbe.state.tracks.map(t => ({ audible: t.audible, solo: t.solo, volume: t.volume })),
      channels: window.bankProbe.api.score.tracks.flatMap(t => [t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel])
    }));
    assert.equal(regression.after.channels.includes(11), false); assert.equal(regression.after.channels.includes(12), false);
    assert.ok(regression.after.ui.every(t => t.audible && !t.solo && t.volume === 1));
    // Никаких изменений микшера новой песни: UI уже показывает исходные значения,
    // и её реальный звук должен соответствовать им без повторного щелчка.
    regression.phase = 'new-file-live';
    await page.click('#play'); await page.waitForFunction(() => window.bankProbe.api.playerState === 1);
    regression.live = await page.evaluate(() => window.__channelLive.measure(2500));
    assert.ok(regression.live.activeMax === 1 && regression.live.windows > 0);
    assert.ok(regression.live.peak > 1e-5, 'Старый solo отсутствующего канала или mute/volume0 заглушил новую песню');
    await page.click('#stop'); regression.phase = 'complete';
    return { oldSoloChannels: regression.before.oldSoloChannels, newChannels: regression.after.channels, live: regression.live };
  });
  await check('Только локальные ресурсы, без ошибок страницы', () => {
    assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.pageErrors, []); return { externalRequests: 0, pageErrors: 0 };
  });
  await context.close();
} catch (error) { report.fatal = error.stack || String(error); console.error(error); }
finally {
  if (browser) await browser.close();
  if (server) await new Promise(ok => server.close(ok));
  report.completedAt = new Date().toISOString();
  report.summary = { passed: report.checks.filter(c => c.status === 'passed').length, failed: report.checks.filter(c => c.status === 'failed').length,
    drumTracksPassed: report.files.flatMap(f => f.targets).filter(t => t.phase === 'complete').length };
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'channels-live.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report.summary, fatal: report.fatal || null }));
if (report.fatal || report.summary.failed) process.exitCode = 1;
