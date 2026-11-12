// Edge-раннер экранов P13 на собранном приложении: свежий контекст на сценарий, отдельный процесс Edge с собственным
// профилем для настоящего скрытия вкладки. Тестового API в продукте нет: сценарии действуют через DOM и клавиатуру,
// данные читают readonly-транзакцией нативной IndexedDB. Наблюдатель Web Audio ставится initScript-ом только
// в live-сценариях и только в тестовом контексте.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { browserRun, startBrowserBuild, writeBrowserReport } from './browser-runner.mjs';
import { browserTier } from './browser-case.mjs';
import { DEFAULT_EDGE_PATH, launchIsolatedEdge } from './native-edge.mjs';

const loopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const VIEWPORT = { width: 1366, height: 900 };

/**
 * Наблюдатель настоящих вызовов Web Audio (только тестовый initScript): каждый осциллятор с типом волны,
 * частотой и временами start/stop на аудиочасах, плюс анализатор на выходе в destination.
 * Это наблюдение вызовов, а не PCM и не API правильного ответа.
 */
export function installNativeAudioObserver() {
  const voices = []; const outputs = []; const contexts = new WeakMap(); let nextContext = 0;
  const contextId = context => { if (!contexts.has(context)) contexts.set(context, ++nextContext); return contexts.get(context); };
  const byNode = new WeakMap();
  const createOscillator = BaseAudioContext.prototype.createOscillator;
  BaseAudioContext.prototype.createOscillator = function (...args) {
    const oscillator = createOscillator.apply(this, args);
    const record = { id: voices.length, contextId: contextId(this), type: null, frequency: null, startAt: null, startObservedAt: null, stops: [] };
    voices.push(record); byNode.set(oscillator, { record, context: this });
    return oscillator;
  };
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when = 0, ...rest) {
    const entry = byNode.get(this);
    if (entry) Object.assign(entry.record, { type: this.type, frequency: this.frequency.value, startAt: when, startObservedAt: entry.context.currentTime });
    return start.call(this, when, ...rest);
  };
  const stop = AudioScheduledSourceNode.prototype.stop;
  AudioScheduledSourceNode.prototype.stop = function (when = 0, ...rest) {
    const entry = byNode.get(this);
    if (entry) entry.record.stops.push({ at: when, observedAt: entry.context.currentTime });
    return stop.call(this, when, ...rest);
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    const result = connect.apply(this, args);
    if (args[0] instanceof AudioDestinationNode) {
      const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
      connect.call(this, analyser); outputs.push({ analyser, context: this.context });
    }
    return result;
  };
  window.__p13Audio = {
    voices: () => voices.map(voice => ({ ...voice, stops: voice.stops.map(item => ({ ...item })) })),
    levels: () => outputs.map(({ analyser, context }) => {
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      let peak = 0, squares = 0; for (const value of samples) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
      return { contextId: contextId(context), audioTime: context.currentTime, state: context.state, peak, rms: Math.sqrt(squares / samples.length) };
    }),
  };
}

export async function runP13BrowserChecks(allChecks, suite = {}) {
  const { checks, skipped: skippedChecks } = browserTier(allChecks);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const config = browserRun(root);
  let origin = config.origin;
  const { resultDir, reuseRequested } = config;
  const report = {
    generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    node: process.version, browserChannel: 'msedge', browserVersion: null, origin,
    scope: suite.scope ?? 'P13 screens in the built product: shell menu, «Занятие» (today, library, plan), play screen, «Проверь себя», reference page and panel, theme; «Прогресс» only as the place where a rated pass appears after reload.',
    oracle: 'UI through DOM, keyboard and pointer; durable data through read-only native IndexedDB transactions; check answers through independent semitone arithmetic on E–A–D–G; live audio (full set) through native oscillator start/stop calls observed by a test-only initScript, compared with AudioContext.currentTime.',
    networkIsolation: 'Fresh Edge contexts with cache disabled; non-loopback page HTTP requests aborted. No user profile or Windows network adapter change.',
    staticServer: { reuseRequested, owned: false, mode: 'not-started' },
    checks: [], externalRequests: [], cleanupErrors: [],
  };
  let server, browser, temporary; let nativeSequence = 0;
  const contexts = new Set();
  async function cleanup(name, operation) {
    try { await operation(); }
    catch (error) { report.cleanupErrors.push({ name, error: error.stack || String(error) }); console.error(`Cleanup failed (${name}): ${error.message}`); }
  }
  /** Ошибки страниц сценария: любая ошибка выполнения — провал этого сценария. */
  function watch(context, errors) {
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  }
  async function isolate(context, { audio = false } = {}) {
    if (audio) await context.addInitScript(installNativeAudioObserver);
    await context.route('**/*', route => {
      if (loopback(route.request().url())) return route.continue();
      report.externalRequests.push(route.request().url()); return route.abort('internetdisconnected');
    });
  }
  async function preparePage(page) {
    page.setDefaultTimeout(8000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.detach();
  }
  async function freshContext(errors, options = {}) {
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' });
    contexts.add(context); watch(context, errors); await isolate(context, options);
    const page = await context.newPage();
    await preparePage(page);
    return { context, page };
  }
  async function withNativeBrowser(errors, run) {
    const nativeProfile = `profile-${++nativeSequence}`;
    const executablePath = process.env.BASS_P13_EDGE_PATH || DEFAULT_EDGE_PATH;
    let nativeEdge;
    try {
      nativeEdge = await launchIsolatedEdge({ executablePath, userDataDir: join(temporary, nativeProfile), args: ['--mute-audio'] });
      const { context, page } = nativeEdge;
      watch(context, errors); await isolate(context);
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize(VIEWPORT);
      await preparePage(page);
      await page.bringToFront();
      return await run({ page, context, origin, nativeProfile });
    } finally {
      await cleanup('native-browser', async () => {
        const closed = await nativeEdge?.close();
        if (closed) (report.nativeBrowsers ??= []).push(closed);
      });
    }
  }
  try {
    server = await startBrowserBuild(config, report);
    origin = server.origin;
    await mkdir(resultDir, { recursive: true });
    temporary = await mkdtemp(join(tmpdir(), 'bass-study-p13-'));
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
    report.browserVersion = browser.version();
    for (const { name, scope, run } of checks) {
      const started = performance.now();
      const errors = [];
      let context;
      try {
        let evidence;
        if (scope === 'native') evidence = await run({ origin, withNativeBrowser: inner => withNativeBrowser(errors, inner) });
        else {
          const setup = await freshContext(errors, { audio: scope === 'live' });
          context = setup.context;
          evidence = await run({ ...setup, origin, newPage: async () => { const page = await context.newPage(); await preparePage(page); return page; } });
        }
        assert.deepEqual(errors, [], 'Ошибки выполнения на странице');
        report.checks.push({ name, scope, status: 'passed', durationMs: Math.round(performance.now() - started), evidence });
        console.log(`PASS ${name} (${Math.round(performance.now() - started)} ms)`);
      } catch (error) {
        report.checks.push({ name, scope, status: 'failed', durationMs: Math.round(performance.now() - started), error: error.stack || String(error), pageErrors: errors });
        console.error(`FAIL ${name}: ${error.message}`);
      } finally {
        if (context) { await cleanup(`context:${name}`, () => context.close()); contexts.delete(context); }
      }
    }
    assert.deepEqual(report.externalRequests, [], 'Приложение не должно обращаться к внешним адресам');
  } catch (error) {
    report.setupError = error.stack || String(error); console.error(error);
  } finally {
    for (const context of contexts) await cleanup('remaining-context', () => context.close());
    await cleanup('browser', async () => { await browser?.close(); });
    await cleanup('static-server', async () => { await server?.close(); });
    await cleanup('isolated-profiles', async () => {
      if (!temporary) return;
      const parentPath = await realpath(tmpdir()); const target = await realpath(temporary);
      const inside = relative(parentPath, target);
      assert.ok(inside.startsWith('bass-study-p13-') && !inside.includes(sep) && !inside.startsWith('..'), 'Временный профиль вне ожидаемого каталога');
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    });
    await writeBrowserReport(resultDir, suite.reportFile ?? 'p13-edge.json', report, checks.length, skippedChecks);
  }
}
