import { browserRun, startBrowserBuild, writeBrowserReport, startBrowserFixture } from './browser-runner.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DEFAULT_EDGE_PATH, launchIsolatedEdge } from './native-edge.mjs';

const loopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

function installNativeAudioObserver() {
  const frequencies = []; const outputs = []; let nextContext = 0; const contexts = new WeakMap();
  const contextId = context => { if (!contexts.has(context)) contexts.set(context, ++nextContext); return contexts.get(context); };
  const createOscillator = BaseAudioContext.prototype.createOscillator;
  BaseAudioContext.prototype.createOscillator = function (...args) {
    const oscillator = createOscillator.apply(this, args); const context = this;
    const setFrequency = oscillator.frequency.setValueAtTime;
    oscillator.frequency.setValueAtTime = function (value, time) {
      frequencies.push({ frequency: value, time, observedAt: context.currentTime, contextId: contextId(context) });
      return setFrequency.call(this, value, time);
    };
    return oscillator;
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
  window.__earAudioObserved = {
    reset() { frequencies.length = 0; },
    read() {
      return { frequencies: frequencies.map(event => ({ ...event })), levels: outputs.map(({ analyser, context }) => {
        const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        let peak = 0, squares = 0; for (const value of samples) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
        return { contextId: contextId(context), audioTime: context.currentTime, state: context.state, peak, rms: Math.sqrt(squares / samples.length) };
      }) };
    },
  };
}

export async function runEarBrowserChecks(checks) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const config = browserRun(root);
  let origin = config.origin;
  let fixtureOrigin = null;
  let fixtureUrl;
  const { resultDir, reuseRequested } = config;
  const report = {
    generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    node: process.version, browserChannel: 'msedge', browserVersion: null, origin, fixtureOrigin,
    scope: 'R016 actual native Web Audio cue/PCM, live clock/cancellation, user ear answers derived from observed native oscillator scheduling, separate persisted ear history. Physical output muted; no hardware/latency claims.',
    oracle: 'Fixture PCM frequencies are measured from samples. UI answer oracle observes actual native oscillator frequency.setValueAtTime calls; those properties are not represented as PCM measurements or a private application answer API.',
    networkIsolation: 'Fresh Edge contexts with cache disabled; non-loopback page HTTP requests aborted. No user profile or Windows network adapter change.',
    staticServer: { reuseRequested, owned: false, mode: 'not-started' },
    checks: [], externalRequests: [], pageErrors: [], cleanupErrors: [],
  };
  let server, fixtureServer, browser, temporary; let nativeSequence = 0;
  const contexts = new Set();
  async function cleanup(name, operation) {
    try { await operation(); }
    catch (error) { report.cleanupErrors.push({ name, error: error.stack || String(error) }); console.error(`Cleanup failed (${name}): ${error.message}`); }
  }
  async function isolate(context) {
    await context.addInitScript(installNativeAudioObserver);
    await context.route('**/*', route => {
      if (loopback(route.request().url())) return route.continue();
      report.externalRequests.push(route.request().url()); return route.abort('internetdisconnected');
    });
    context.on('page', page => page.on('pageerror', error => report.pageErrors.push(error.message)));
  }
  async function freshPage(url) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 1050 } });
    contexts.add(context); await isolate(context);
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(url);
    if (url === fixtureUrl) await page.waitForFunction(() => window.p7ear?.ready);
    else await page.waitForSelector('#history-mount', { state: 'attached' });
    return { context, page };
  }
  async function withNativeBrowser(run) {
    const nativeProfile = `visibility-${++nativeSequence}`;
    const executablePath = process.env.BASS_EAR_EDGE_PATH || DEFAULT_EDGE_PATH;
    let nativeEdge;
    try {
      nativeEdge = await launchIsolatedEdge({ executablePath, userDataDir: join(temporary, nativeProfile), args: ['--mute-audio'] });
      const context = nativeEdge.context; await isolate(context);
      const page = nativeEdge.page; page.setDefaultTimeout(6000);
      page.on('pageerror', error => report.pageErrors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => document.querySelector('#history-mount'), undefined, { polling: 100 });
      await page.bringToFront();
      try { return await run({ page, context }); }
      catch (error) {
        const tabs = await Promise.all(context.pages().map(async tab => {
          const url = tab.url();
          try { return { url, ...await tab.evaluate(() => ({ persistenceMessage: document.querySelector('#persistence-message')?.textContent ?? null, hidden: document.hidden, mainInert: document.querySelector('main')?.inert ?? null, mainBusy: document.querySelector('main')?.getAttribute('aria-busy') ?? null })) }; }
          catch (failure) { return { url, diagnosticError: failure.message }; }
        }));
        throw new Error(`${error.stack || error}\nIsolated native Edge diagnostics: ${JSON.stringify({ nativeProfile, tabs })}`, { cause: error });
      }
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
    temporary = await mkdtemp(join(tmpdir(), 'bass-study-ear-'));
    fixtureServer = await startBrowserFixture(root, config, 4185, report);
    fixtureOrigin = report.fixtureOrigin;
    fixtureUrl = `${fixtureOrigin}/tests/fixtures/ear.html`;
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
    report.browserVersion = browser.version();
    for (const { name, scope, run } of checks) {
      const started = performance.now(); let context;
      try {
        const setup = scope === 'native' ? {} : await freshPage(scope === 'ui' ? origin : fixtureUrl);
        context = setup.context;
        const evidence = await run({ ...setup, origin, fixtureOrigin, resultDir, report, withNativeBrowser });
        report.checks.push({ name, scope, status: 'passed', durationMs: Math.round(performance.now() - started), evidence });
        console.log(`PASS ${name}`);
      } catch (error) {
        report.checks.push({ name, scope, status: 'failed', durationMs: Math.round(performance.now() - started), error: error.stack || String(error) });
        console.error(`FAIL ${name}: ${error.message}`);
      } finally {
        if (context) { await cleanup(`context:${name}`, () => context.close()); contexts.delete(context); }
      }
    }
    assert.deepEqual(report.externalRequests, [], 'The audio/player must not request remote assets');
    assert.deepEqual(report.pageErrors, [], 'Browser runtime errors occurred');
  } catch (error) {
    report.setupError = error.stack || String(error); console.error(error);
  } finally {
    for (const context of contexts) await cleanup('remaining-context', () => context.close());
    await cleanup('browser', async () => { await browser?.close(); });
    await cleanup('fixture-server', async () => { await fixtureServer?.close(); });
    await cleanup('static-server', async () => { await server?.close(); });
    await cleanup('isolated-profile', async () => {
      if (!temporary) return;
      const parentPath = await realpath(tmpdir()); const target = await realpath(temporary);
      const inside = relative(parentPath, target);
      assert.ok(inside.startsWith('bass-study-ear-') && !inside.includes(sep) && !inside.startsWith('..'), 'Temporary profile escaped the intended temp directory');
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    });
    await writeBrowserReport(resultDir, 'p7-ear-edge.json', report, checks.length);
  }
}
