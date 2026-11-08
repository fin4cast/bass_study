import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { selection, root, resultDir } from './inspect.mjs';
import { startServer } from './server.mjs';

const origin = 'http://127.0.0.1:4197';
const report = { generatedAt: new Date().toISOString(), alphaTab: '1.9.0', browser: null,
  scope: 'Отдельный стенд; реальные файлы и синтезированный PCM/live Web Audio. Физический вывод заглушён; восприятие и задержка не проверяются.',
  server: { owned: false, port: 4197 }, files: [], checks: [], externalRequests: [], pageErrors: [], consoleWarnings: [], limitations: [] };
let server, browser;
let currentSample = null;
await mkdir(resultDir, { recursive: true });
async function check(name, run) {
  try { const details = await run(); report.checks.push({ name, status: 'passed', details }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, status: 'failed', error: error.stack || String(error) }); console.log(`FAIL ${name}: ${error.message}`); }
}
try {
  server = await startServer(4197); report.server.owned = true;
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1380, height: 1000 } });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) return route.continue();
    report.externalRequests.push(url); return route.abort();
  });
  await context.addInitScript(() => {
    const taps = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(...args) {
      const result = connect.apply(this, args);
      if (args[0] === this.context.destination) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
        connect.call(this, analyser); taps.push({ analyser, context: this.context, nodeType: this.constructor.name });
      }
      return result;
    };
    window.__musicLive = { taps, measure: async (milliseconds = 350) => {
      let peak = 0, sum = 0, count = 0, running = 0;
      const end = performance.now() + milliseconds;
      while (performance.now() < end) {
        for (const tap of taps) {
          if (tap.context.state !== 'running') continue;
          running++;
          const data = new Float32Array(tap.analyser.fftSize); tap.analyser.getFloatTimeDomainData(data);
          for (const sample of data) { peak = Math.max(peak, Math.abs(sample)); sum += sample * sample; count++; }
        }
        await new Promise(ok => setTimeout(ok, 20));
      }
      return { peak, rms: Math.sqrt(sum / Math.max(count, 1)), sampleWindows: running,
        nodes: [...new Set(taps.map(t => t.nodeType))] };
    } };
  });
  const page = await context.newPage(); page.setDefaultTimeout(25000);
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'warning') report.consoleWarnings.push({ id: currentSample, text: message.text() }); });
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto(origin); await page.waitForFunction(() => window.bankProbe);
  for (const sample of selection.samples) {
    if (process.argv.includes('--first') && sample !== selection.samples[0]) break;
    currentSample = sample.id;
    const result = { id: sample.id, path: sample.relativePath, checks: [] }; report.files.push(result);
    await check(`${sample.id}: import-render-pcm-live`, async () => {
      await page.selectOption('#sample', sample.id);
      await page.waitForFunction(id => (window.bankProbe.state.id === id && !window.bankProbe.state.loading) || window.bankProbe.state.error, sample.id);
      if (!await page.evaluate(() => window.bankProbe.state.error)) {
        await page.evaluate(() => scrollTo(0, document.querySelector('#score').getBoundingClientRect().top + scrollY - 80));
        await page.waitForSelector('#score svg');
      }
      const imported = await page.evaluate(() => {
        const { api, state } = window.bankProbe;
        if (state.error) return { error: state.error };
        return { id: state.id, title: api.score.title, tracks: api.score.tracks.length, bars: api.score.masterBars.length,
          sharedChannels: state.sharedChannels, svg: document.querySelectorAll('#score svg').length,
          glyphs: document.querySelectorAll('#score svg text, #score svg path').length,
          ready: api.isReadyForPlayback, tuning: api.score.tracks.map(t => t.staves.map(s => s.tuning)),
          trackChannels: api.score.tracks.map(t => [t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel]) };
      });
      result.import = imported;
      if (sample.extension === '.gtp') {
        assert.match(imported.error, /No compatible importer/); result.status = 'unsupported-gtp'; return imported;
      }
      assert.equal(imported.id, sample.id); assert.equal(imported.ready, true); assert.ok(imported.svg > 0); assert.ok(imported.glyphs > 5);
      assert.equal(await page.locator('#tracks tr').count(), imported.tracks);
      // Произвольные партии: каждый звуковой контрол через видимый UI.
      for (let i = 0; i < imported.tracks; i++) {
        const row = page.locator(`#tracks tr[data-track="${i}"]`);
        await row.locator('[data-control=audible]').uncheck();
        await row.locator('[data-control=audible]').check();
        await row.locator('[data-control=solo]').check();
        await row.locator('[data-control=solo]').uncheck();
        await row.locator('[data-control=volume]').fill('0.35');
        await row.locator('[data-control=volume]').fill('1');
      }
      const target = await page.evaluate(() => {
        const { api } = window.bankProbe; const candidates = [];
        for (const track of api.score.tracks) for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
          if (beat.notes.length && track.playbackInfo.volume > 0) {
            const master = api.tickCache.masterBars.find(b => b.masterBar.index === bar.index);
            if (master) candidates.push({ track: track.index, startTick: master.start + beat.playbackStart, endTick: master.start + beat.playbackStart + 3840 });
          }
        }
        return candidates.sort((a,b) => a.startTick - b.startTick)[0];
      });
      assert.ok(target, 'Нет звучащих нот'); result.target = target;
      result.pcm = await page.evaluate(async range => {
        const { api, alphaTab } = window.bankProbe;
        const options = new alphaTab.synth.AudioExportOptions(); options.playbackRange = range; options.masterVolume = 0.5;
        const exporter = await api.exportAudio(options);
        try {
          const chunk = await exporter.render(900); let peak = 0, sum = 0;
          for (const value of chunk.samples) { peak = Math.max(peak, Math.abs(value)); sum += value * value; }
          return { frames: chunk.samples.length / 2, channels: 2, sampleRate: 44100, peak, rms: Math.sqrt(sum/chunk.samples.length) };
        } finally { exporter.destroy(); }
      }, { startTick: target.startTick, endTick: target.endTick });
      assert.ok(result.pcm.peak > 0.00001, 'Экспорт PCM молчит');
      await page.evaluate(tick => { window.bankProbe.api.tickPosition = tick; }, target.startTick);
      await page.click('#play');
      await page.waitForFunction(() => window.bankProbe.api.playerState === 1);
      result.live = await page.evaluate(() => window.__musicLive.measure(700));
      assert.ok(result.live.peak > 0.00001, 'Живой выход молчит');
      result.cursor = await page.evaluate(() => ({ events: window.bankProbe.state.positionEvents.length,
        beats: window.bankProbe.state.beatEvents.length, tick: window.bankProbe.api.tickPosition,
        cursors: document.querySelectorAll('.at-cursor-beat').length }));
      assert.ok(result.cursor.events > 1); assert.ok(result.cursor.tick > target.startTick);
      assert.ok(result.cursor.beats > 0); assert.ok(result.cursor.cursors > 0);
      await page.click('#pause'); await delay(150);
      result.paused = await page.evaluate(() => ({ state: window.bankProbe.api.playerState, time: window.bankProbe.api.timePosition }));
      await delay(180); const pausedTime = await page.evaluate(() => window.bankProbe.api.timePosition);
      assert.equal(pausedTime, result.paused.time);
      await page.selectOption('#speed', '0.75');
      assert.equal(await page.evaluate(() => window.bankProbe.api.playbackSpeed), 0.75);
      await page.click('#play'); await page.waitForFunction(() => window.bankProbe.api.playerState === 1); await delay(180);
      await page.click('#stop'); await page.selectOption('#speed', '1');
      // Видимость последней партии не меняет произвольный выбранный микс.
      if (imported.tracks > 1) {
        await page.locator('#tracks tr').last().locator('[data-control=visible]').check();
        await page.locator('#tracks tr').first().locator('[data-control=visible]').uncheck();
        await page.waitForFunction(() => window.bankProbe.api.tracks.length === 1);
        assert.equal(await page.evaluate(() => window.bankProbe.api.tracks[0].index), imported.tracks - 1);
        assert.ok(await page.evaluate(() => window.bankProbe.state.tracks.every(t => t.audible && !t.solo && t.volume === 1)));
      }
      result.status = imported.sharedChannels.length ? 'works-with-shared-channel-limit' : 'works';
      return { tracks: imported.tracks, bars: imported.bars, sharedChannels: imported.sharedChannels, pcmPeak: result.pcm.peak, livePeak: result.live.peak };
    });
    if (!result.status) result.status = 'failed';
  }
  currentSample = 'sample-03';
  await page.selectOption('#sample', currentSample);
  await page.waitForFunction(() => window.bankProbe.state.id === 'sample-03' && !window.bankProbe.state.loading);
  await check('invalid-range-pauses-clears-old-loop-and-blocks-start', async () => {
    await page.locator('#from-bar').fill('1'); await page.locator('#to-bar').fill('2');
    await page.click('#apply-range'); await page.locator('#loop').check(); await page.click('#play');
    await page.waitForFunction(() => window.bankProbe.api.playerState === 1);
    await page.locator('#from-bar').fill('3'); await page.locator('#to-bar').fill('2');
    await page.click('#apply-range');
    await page.waitForFunction(() => window.bankProbe.api.playerState === 0);
    const rejected = await page.evaluate(() => ({ state: window.bankProbe.api.playerState,
      range: window.bankProbe.api.playbackRange, loop: window.bankProbe.api.isLooping,
      startDisabled: document.getElementById('play').disabled, message: document.getElementById('status').textContent }));
    assert.equal(rejected.state, 0); assert.equal(rejected.range, null); assert.equal(rejected.loop, false);
    assert.equal(rejected.startDisabled, true); assert.match(rejected.message, /Недопустимый диапазон/);
    await page.click('#full-range'); assert.equal(await page.locator('#play').isEnabled(), true);
    return rejected;
  });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(resultDir, 'mixer.png') });
  await page.evaluate(() => scrollTo(0, document.querySelector('#score').getBoundingClientRect().top + scrollY - 30));
  await page.waitForSelector('#score svg');
  await page.screenshot({ path: resolve(resultDir, 'score-tab.png') });
  await check('no-external-requests-or-page-errors', () => {
    assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.pageErrors, []); return { requests: 0, pageErrors: 0 };
  });
  await context.close();
} catch (error) { report.fatal = error.stack || String(error); console.error(error); }
finally {
  if (browser) await browser.close();
  if (server) await new Promise(ok => server.close(ok));
  report.completedAt = new Date().toISOString();
  await writeFile(resolve(resultDir, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.checks.filter(c => c.status === 'passed').length, failed: report.checks.filter(c => c.status === 'failed').length, fatal: report.fatal || null }));
if (report.fatal || report.checks.some(c => c.status === 'failed')) process.exitCode = 1;
