import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import * as alphaTab from '@coderline/alphatab';
import { selection, sampleBytes, resultDir } from './inspect.mjs';
import { startServer } from './server.mjs';

// Изолированный дополнительный runner. Не запускать параллельно другим аудиопроверкам.
const port = 4198;
const origin = `http://127.0.0.1:${port}`;
const liveOnly = process.argv.includes('--live-only');
const report = {
  generatedAt: new Date().toISOString(), alphaTabVersion: '1.9.0', browser: null,
  mode: liveOnly ? 'live-only' : 'full',
  scope: 'Живой выход AudioWorklet и отдельно экспорт синтезированного PCM. Исходники и PCM не записываются. Физический вывод заглушён, акустика не проверяется.',
  server: { owned: false, port }, checks: [], files: [], externalRequests: [], pageErrors: [],
  limitations: [
    'PCM-экспорт не наследует live mute/solo/volume: параметры всех партий задаются явно через AudioExportOptions.trackVolume.',
    'Каждый PCM-тест касается короткого участка с нотами; музыкальная верность полной транскрипции не проверяется.',
    'Партии с общим каналом пропускаются как явный блокер независимого микшера, а не считаются пройденными.'
  ]
};
let server, browser;
await mkdir(resultDir, { recursive: true });
async function check(name, action) {
  try {
    const details = await action(); report.checks.push({ name, status: 'passed', details });
    console.log(`PASS ${name}`); return details;
  } catch (error) {
    report.checks.push({ name, status: 'failed', error: error.stack || String(error) });
    console.log(`FAIL ${name}: ${error.message}`); return undefined;
  }
}

// Range контролы меняются настоящей клавиатурой: fill() не поддерживает input[type=range].
async function slider(locator, value) {
  const limits = await locator.evaluate(el => ({ min: Number(el.min || 0), step: Number(el.step || 1), max: Number(el.max || 100) }));
  assert.ok(value >= limits.min && value <= limits.max);
  const steps = Math.round((value - limits.min) / limits.step);
  assert.ok(steps <= 100, 'Для этой проверки ожидается короткий диапазон клавиатурных шагов');
  await locator.focus(); await locator.press('Home');
  for (let i = 0; i < steps; i++) await locator.press('ArrowRight');
  assert.ok(Math.abs(Number(await locator.inputValue()) - value) < 0.0001);
}

async function load(page, sample) {
  await page.selectOption('#sample', sample.id);
  await page.waitForFunction(id => {
    const p = window.bankProbe;
    return p.state.error || (p.state.id === id && !p.state.loading && p.api.isReadyForPlayback);
  }, sample.id);
  const error = await page.evaluate(() => window.bankProbe.state.error);
  assert.equal(error, null, `${sample.id}: ${error}`);
}

async function setLiveMix(page, { audible, solo, volume = 1 }) {
  const count = await page.locator('#tracks tr').count();
  for (let i = 0; i < count; i++) {
    const row = page.locator(`#tracks tr[data-track="${i}"]`);
    await row.locator('[data-control=solo]').setChecked(solo.includes(i));
    await row.locator('[data-control=audible]').setChecked(audible.includes(i));
    if (Number(await row.locator('[data-control=volume]').inputValue()) !== volume) await slider(row.locator('[data-control=volume]'), volume);
  }
}

async function liveMeasure(page, milliseconds = 900) {
  return page.evaluate(duration => window.__musicMixerLive.measure(duration), milliseconds);
}

// Независимо вычислить время из настоящих MIDI-событий файла: сюда уже развёрнуты
// репризы, изменения темпа и начала нот. Тишина в начале файла допустима.
async function liveMusicTiming(sample) {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(await sampleBytes(sample), settings);
  const midi = new alphaTab.midi.MidiFile();
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, new alphaTab.midi.AlphaSynthMidiFileHandler(midi));
  generator.generate();
  const channelOwners = new Map();
  for (const track of score.tracks) for (const ch of new Set([track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel])) {
    channelOwners.set(ch, [...(channelOwners.get(ch) || []), track.index]);
  }
  let target;
  outer: for (const track of score.tracks) {
    const p = track.playbackInfo;
    if (track.isPercussion || (p.program >= 32 && p.program <= 39) || p.volume === 0 ||
      channelOwners.get(p.primaryChannel).length > 1 || channelOwners.get(p.secondaryChannel).length > 1) continue;
    for (const staff of track.staves) for (const bar of staff.bars) {
      const notes = bar.voices.flatMap(v => v.beats).filter(b => b.notes.some(n => !n.isTieDestination));
      if (notes.length >= 3) {
        target = { index: track.index, name: track.name, program: p.program, bar: bar.index,
          startTick: generator.tickLookup.getMasterBarStart(bar.masterBar), noteBeats: notes.length };
        break outer;
      }
    }
  }
  assert.ok(target, 'Не найдена небасовая партия с несколькими атаками');
  let time = 0, previousTick = 0, tempo = score.tempo;
  const noteStarts = [], tempoEvents = [];
  const events = midi.tracks.flatMap(t => t.events).sort((a,b) => a.tick - b.tick);
  // Отдельный маркер позволяет вычислить время такта без предположения о постоянном BPM.
  events.push({ tick: target.startTick, marker: true }); events.sort((a,b) => a.tick - b.tick);
  for (const event of events) {
    time += (event.tick - previousTick) * 60000 / (tempo * midi.division); previousTick = event.tick;
    if (event.marker) target.startTimeMs = time;
    if (event.type === 81) { tempo = event.beatsPerMinute; tempoEvents.push({ tick: event.tick, timeMs: time, bpm: tempo }); }
    if (event.type === 128 && event.track === target.index && event.noteVelocity > 0) {
      noteStarts.push({ tick: event.tick, timeMs: time, channel: event.channel, key: event.noteKey, velocity: event.noteVelocity });
    }
  }
  return { target, division: midi.division, scoreTempo: score.tempo,
    firstNote: noteStarts[0], targetNotes: noteStarts.filter(n => n.tick >= target.startTick).slice(0, 8),
    tempoEvents: tempoEvents.filter(e => e.timeMs <= target.startTimeMs + 5000),
    method: 'Node: MidiFileGenerator, развёрнутый порядок MIDI-событий и интегрирование TempoChangeEvent' };
}

try {
  server = await startServer(port); report.server.owned = true;
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1380, height: 1000 } });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.continue();
    report.externalRequests.push(url); return route.abort();
  });
  await context.addInitScript(() => {
    const taps = [], nativeConnect = AudioNode.prototype.connect, nativeDisconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(...args) {
      const result = nativeConnect.apply(this, args);
      if (args[0] === this.context.destination && this.constructor.name === 'AudioWorkletNode') {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
        nativeConnect.call(this, analyser);
        taps.push({ node: this, analyser, context: this.context, active: true });
      }
      return result;
    };
    AudioNode.prototype.disconnect = function(...args) {
      const result = nativeDisconnect.apply(this, args);
      if (args.length === 0) for (const tap of taps) if (tap.node === this) tap.active = false;
      return result;
    };
    window.__musicMixerLive = { measure: async (milliseconds = 900) => {
      let peak = 0, squares = 0, samples = 0, windows = 0, activeMax = 0;
      const deadline = performance.now() + milliseconds;
      while (performance.now() < deadline) {
        const active = taps.filter(t => t.active && t.context.state === 'running');
        activeMax = Math.max(activeMax, active.length);
        for (const tap of active) {
          const data = new Float32Array(tap.analyser.fftSize);
          tap.analyser.getFloatTimeDomainData(data); windows++;
          for (const v of data) { peak = Math.max(peak, Math.abs(v)); squares += v * v; samples++; }
        }
        await new Promise(ok => setTimeout(ok, 20));
      }
      return { peak, rms: Math.sqrt(squares / Math.max(samples, 1)), sampledValues: samples, windows, activeMax,
        source: 'Настоящий AudioWorkletNode → AnalyserNode в живом AudioContext' };
    } };
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  await page.goto(origin); await page.waitForFunction(() => window.bankProbe);

  // Независимые PCM-пробы всех непустых партий всех поддержанных файлов.
  for (const sample of liveOnly ? [] : selection.samples.filter(s => s.extension !== '.gtp')) {
    const file = { id: sample.id, path: sample.relativePath, tracks: [] }; report.files.push(file);
    await check(`${sample.id}: PCM каждой независимой партии`, async () => {
      await load(page, sample);
      const tracks = await page.evaluate(() => {
        const { api, state } = window.bankProbe;
        const shared = new Set(state.sharedChannels.flatMap(g => g.tracks));
        return api.score.tracks.map(track => {
          const candidates = [];
          for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
            if (!beat.notes.some(n => !n.isTieDestination)) continue;
            const master = api.tickCache.masterBars.find(b => b.masterBar.index === bar.index);
            if (!master) continue;
            const startTick = Math.max(0, api.tickCache.getBeatStart(beat));
            candidates.push({ startTick, endTick: Math.min(api.endTick, startTick + 3840), bar: bar.index });
          }
          const distinct = [...new Map(candidates.sort((a,b) => a.startTick - b.startTick).map(c => [c.startTick, c])).values()];
          return { index: track.index, name: track.name, program: track.playbackInfo.program, sourceVolume: track.playbackInfo.volume,
            shared: shared.has(track.index), candidates: distinct.slice(0, 4), noteCount: candidates.length };
        });
      });
      file.sharedChannels = await page.evaluate(() => window.bankProbe.state.sharedChannels);
      for (const track of tracks) {
        const entry = { ...track }; delete entry.candidates; file.tracks.push(entry);
        if (track.shared) { entry.status = 'blocked-shared-channel'; entry.reason = 'Нельзя независимо изолировать партию штатным API'; continue; }
        if (!track.noteCount) { entry.status = 'empty'; entry.reason = 'Нет отдельной атаки ноты'; continue; }
        if (track.sourceVolume === 0) { entry.status = 'blocked-source-zero-volume'; entry.reason = 'Исходный уровень партии нулевой, множитель его не восстанавливает'; continue; }
        entry.attempts = [];
        for (const range of track.candidates) {
          const stats = await page.evaluate(async ({ trackIndex, range }) => {
            const { api, alphaTab } = window.bankProbe;
            const render = async factor => {
              const opts = new alphaTab.synth.AudioExportOptions();
              opts.sampleRate = 44100; opts.masterVolume = 0.5; opts.metronomeVolume = 0; opts.useSyncPoints = false;
              opts.playbackRange = { startTick: range.startTick, endTick: range.endTick };
              for (const t of api.score.tracks) opts.trackVolume.set(t.index, t.index === trackIndex ? factor : 0);
              const exporter = await api.exportAudio(opts);
              try {
                const chunk = await exporter.render(1200);
                if (!chunk) return { frames: 0, peak: 0, rms: 0 };
                let peak = 0, squares = 0;
                for (const v of chunk.samples) { peak = Math.max(peak, Math.abs(v)); squares += v*v; }
                return { frames: chunk.samples.length / 2, peak, rms: Math.sqrt(squares / Math.max(1, chunk.samples.length)) };
              } finally { exporter.destroy(); }
            };
            return { full: await render(1), quarter: await render(0.25), zero: await render(0), channels: 2, sampleRate: 44100 };
          }, { trackIndex: track.index, range });
          entry.attempts.push({ range, ...stats });
          if (stats.full.peak > 1e-6 && stats.full.rms > 1e-7) {
            assert.ok(stats.zero.peak < 1e-7, `${sample.id}/${track.index}: volume0 не молчит`);
            const ratio = stats.quarter.rms / stats.full.rms;
            assert.ok(ratio > 0.20 && ratio < 0.30, `${sample.id}/${track.index}: RMS quarter/full=${ratio}`);
            assert.equal(stats.full.frames, stats.quarter.frames);
            entry.status = 'passed'; entry.rmsRatioQuarterToFull = ratio; break;
          }
        }
        if (!entry.status) entry.status = 'failed-silent-windows';
      }
      const failed = file.tracks.filter(t => t.status.startsWith('failed'));
      assert.deepEqual(failed.map(t => t.index), [], 'Непустые партии не дали PCM ни в одном из первых четырёх участков');
      return { independentPassed: file.tracks.filter(t => t.status === 'passed').length,
        blocked: file.tracks.filter(t => t.status.startsWith('blocked')).map(t => ({ index: t.index, reason: t.reason })),
        empty: file.tracks.filter(t => t.status === 'empty').length };
    });
  }

  await check('live: произвольное solo, mute всех, громкость, пауза, seek и loop', async () => {
    const sample = selection.samples.find(s => s.id === 'sample-02');
    const live = report.live = { sample: sample.id, phase: 'loading' };
    live.musicalTiming = await liveMusicTiming(sample);
    const target = live.target = live.musicalTiming.target;
    await load(page, sample);
    const loadedTarget = await page.evaluate(target => {
      const { api } = window.bankProbe, t = api.score.tracks[target.index];
      return { name: t.name, program: t.playbackInfo.program, barStart: api.tickCache.getMasterBarStart(t.staves[0].bars[target.bar].masterBar) };
    }, target);
    assert.equal(loadedTarget.name, target.name); assert.equal(loadedTarget.program, target.program);
    assert.equal(loadedTarget.barStart, target.startTick);
    const count = await page.locator('#tracks tr').count(), all = Array.from({ length: count }, (_, i) => i);
    await page.selectOption('#speed', '1');
    await page.locator('#from-bar').fill(String(target.bar + 1));
    await page.locator('#to-bar').fill(String(target.bar + 1));
    await page.click('#apply-range'); await page.locator('#loop').check();
    await setLiveMix(page, { audible: [], solo: [] });
    await page.click('#play'); await page.waitForFunction(() => window.bankProbe.api.playerState === 1);
    live.phase = 'all-muted';
    await delay(600); const muted = live.muted = await liveMeasure(page, 800);
    assert.ok(muted.windows > 0 && muted.activeMax === 1, 'Нужен один настоящий активный AudioWorklet');
    assert.ok(muted.peak < 1e-7, `Все партии выключены, но peak=${muted.peak}`);
    await page.click('#stop');
    await setLiveMix(page, { audible: all, solo: [target.index] });
    const isolated = live.isolated = await page.evaluate(index => ({ tracks: window.bankProbe.state.tracks, index }), target.index);
    assert.equal(isolated.tracks.filter(t => t.solo).length, 1);
    const runLevel = async level => {
      await page.click('#stop'); await page.click('#apply-range');
      await slider(page.locator(`#tracks tr[data-track="${target.index}"] [data-control=volume]`), level);
      await page.click('#play'); await page.waitForFunction(() => window.bankProbe.api.playerState === 1);
      await delay(500); const stats = await liveMeasure(page, 2200);
      await page.click('#stop'); return stats;
    };
    live.phase = 'volume';
    const full = live.full = await runLevel(1), quiet = live.quiet = await runLevel(0.2);
    assert.ok(full.peak > 1e-5 && full.rms > 1e-6, 'Небасовая solo-партия не дала живого сигнала');
    const ratio = live.rmsQuietToFull = quiet.rms / full.rms;
    assert.ok(ratio > 0.06 && ratio < 0.40, `Live RMS quiet/full=${ratio}`);
    await slider(page.locator(`#tracks tr[data-track="${target.index}"] [data-control=volume]`), 1);
    await page.click('#apply-range');
    const range = live.range = await page.evaluate(() => window.bankProbe.api.playbackRange);
    assert.ok(range.endTick > range.startTick);
    live.phase = 'loop';
    const since = await page.evaluate(() => performance.now());
    await page.click('#play');
    await page.waitForFunction(since => {
      const events = window.bankProbe.state.positionEvents.filter(e => e.at >= since);
      return events.some((e, i) => i > 0 && e.tick < events[i - 1].tick - 100);
    }, since, { timeout: 15000 });
    const loopEvents = live.loopEvents = await page.evaluate(since => window.bankProbe.state.positionEvents.filter(e => e.at >= since), since);
    live.loopDrops = loopEvents.filter((e,i) => i && e.tick < loopEvents[i-1].tick - 100).length;
    live.phase = 'pause';
    await page.click('#pause'); await delay(250);
    const paused = live.paused = await page.evaluate(() => ({ time: window.bankProbe.api.timePosition, tick: window.bankProbe.api.tickPosition, state: window.bankProbe.api.playerState }));
    await delay(350);
    assert.equal(await page.evaluate(() => window.bankProbe.api.timePosition), paused.time);
    assert.equal(paused.state, 0);
    const pausedSignal = live.pausedSignal = await liveMeasure(page, 350);
    assert.ok(pausedSignal.peak < 1e-7, 'После паузы остаётся живой сигнал');
    await page.click('#play'); await page.waitForFunction(() => window.bankProbe.api.playerState === 1);
    live.phase = 'continue';
    const continued = live.continued = await liveMeasure(page, 2200);
    assert.ok(continued.peak > 1e-5, 'Продолжение после паузы не восстановило живой сигнал');
    const continuedTime = live.continuedTime = await page.evaluate(() => window.bankProbe.api.timePosition);
    assert.notEqual(continuedTime, paused.time);
    await page.click('#pause'); await delay(200);
    await page.click('#full-range'); await page.locator('#loop').uncheck();
    await page.locator('#seek').focus(); await page.locator('#seek').press('Home');
    live.phase = 'seek-home';
    const seek = live.seekHome = await page.evaluate(() => ({ time: window.bankProbe.api.timePosition, tick: window.bankProbe.api.tickPosition }));
    assert.ok(seek.time < 1, 'Home на видимом seek не перевёл реальное время к началу');
    // Home проверяет позицию. Требовать звук в произвольном начальном окне нельзя.
    // Через настоящий UI seek выбираем вычисленное начало такта с несколькими атаками.
    const targetSeconds = Math.round(target.startTimeMs / 50) * 0.05;
    await slider(page.locator('#seek'), targetSeconds);
    const soundingSeek = live.soundingSeek = await page.evaluate(() => ({ time: window.bankProbe.api.timePosition, tick: window.bankProbe.api.tickPosition }));
    assert.ok(Math.abs(soundingSeek.time - target.startTimeMs) <= 26, 'Seek не соответствует рассчитанному времени звучащего такта');
    assert.ok(Math.abs(soundingSeek.tick - target.startTick) <= 96, 'Seek не соответствует MIDI-тикам выбранного такта');
    await page.click('#play'); await page.waitForFunction(() => window.bankProbe.api.playerState === 1);
    live.phase = 'seek-play';
    await page.waitForFunction(time => window.bankProbe.api.timePosition > time + 100, soundingSeek.time);
    const resumed = live.resumed = await liveMeasure(page, 2200);
    assert.ok(resumed.peak > 1e-5, 'После seek/resume нет живого сигнала');
    const resumedTime = live.resumedTime = await page.evaluate(() => window.bankProbe.api.timePosition);
    assert.ok(resumedTime > soundingSeek.time + 100);
    await page.click('#stop');
    live.phase = 'complete';
    return { sample: sample.id, target, muted, full, quiet, rmsQuietToFull: ratio, range,
      loopDrops: loopEvents.filter((e,i) => i && e.tick < loopEvents[i-1].tick - 100).length,
      paused, pausedSignal, continued, continuedTime, seek, soundingSeek, resumed, resumedTime };
  });
  await check('только локальные ресурсы, без ошибок страницы', async () => {
    assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.pageErrors, []);
    return { externalRequests: 0, pageErrors: 0 };
  });
  await context.close();
} catch (error) {
  report.fatal = error.stack || String(error); console.error(error);
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(ok => server.close(ok));
  report.completedAt = new Date().toISOString();
  report.summary = { passed: report.checks.filter(c => c.status === 'passed').length,
    failed: report.checks.filter(c => c.status === 'failed').length,
    pcmTracksPassed: report.files.flatMap(f => f.tracks).filter(t => t.status === 'passed').length,
    blockedSharedTracks: report.files.flatMap(f => f.tracks).filter(t => t.status === 'blocked-shared-channel').length };
  await writeFile(resolve(resultDir, liveOnly ? 'mixer-live.json' : 'mixer.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report.summary, fatal: report.fatal || null }));
if (report.fatal || report.checks.some(c => c.status === 'failed')) process.exitCode = 1;
