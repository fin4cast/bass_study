import { browserRun, startBrowserBuild, writeBrowserReport, startBrowserFixture } from './browser-runner.mjs';
import { browserTier } from './browser-case.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DEFAULT_EDGE_PATH, launchIsolatedEdge } from './native-edge.mjs';

const WAV_SIGNALS = { a1: 55, 'low-e': 41.2034446141, harmonics: 41.2034446141, noise: 0, 'out-of-range': 500, clipping: 55 };
function makeWav(signal) {
  const rate = 44100, count = rate * 4, buffer = Buffer.alloc(44 + count * 2); let seed = 0x789abc;
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + count * 2, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) { const phase = 2 * Math.PI * WAV_SIGNALS[signal] * i / rate; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const value = signal === 'noise' ? .25 * (seed / 0x100000000 * 2 - 1) : signal === 'clipping' ? Math.sign(Math.sin(phase)) : signal === 'harmonics' ? .08 * Math.sin(phase) + .32 * Math.sin(phase * 2) : .25 * Math.sin(phase); buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2); }
  return buffer;
}
function observeCapture() {
  const media = navigator.mediaDevices; if (!media) return;
  const native = media.getUserMedia.bind(media);
  const observations = { calls: [], streams: [], connections: [], delayMs: 0 };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, ...rest) { observations.connections.push({ source: this.constructor.name, destination: destination?.constructor?.name, gain: this instanceof GainNode ? this.gain.value : null }); return connect.call(this, destination, ...rest); };
  Object.defineProperty(window, '__inputObservations', { value: observations });
  media.getUserMedia = async function(constraints) {
    observations.calls.push({ constraints, at: performance.now() });
    const stream = await native(constraints); observations.streams.push(stream);
    if (observations.delayMs) await new Promise(resolve => setTimeout(resolve, observations.delayMs));
    return stream;
  };
}

const loopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

export async function runInputBrowserChecks(allChecks) {
  const { checks, skipped: skippedChecks } = browserTier(allChecks);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const config = browserRun(root);
  let origin = config.origin;
  let fixtureOrigin = null;
  let fixtureUrl;
  const { resultDir, reuseRequested } = config;
  const report = {
    generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    node: process.version, browserChannel: 'msedge', browserVersion: null, origin, fixtureOrigin,
    scope: 'R020 explicit diagnostic capture from Chromium native fake WAV devices only; no physical microphone/interface, grading or latency measurement.',
    networkIsolation: 'Fresh Edge contexts with cache disabled; non-loopback page HTTP requests aborted. Only isolated test profiles and fake WAV capture flags; permissions granted explicitly to loopback test origins. No user profile or Windows network adapter change.',
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

    await context.route('**/*', route => {
      if (loopback(route.request().url())) return route.continue();
      report.externalRequests.push(route.request().url()); return route.abort('internetdisconnected');
    });
    context.on('page', page => page.on('pageerror', error => report.pageErrors.push(error.message)));
  }
  async function freshPage(url) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 1050 } });
    contexts.add(context); await isolate(context); await context.addInitScript(observeCapture);
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(url);
    if (url === fixtureUrl) await page.waitForFunction(() => window.p7input?.ready);
    else await page.waitForSelector('[data-input-mount]', { state: 'attached' });
    return { context, page };
  }
  async function withNativeBrowser(run) {
    const nativeProfile = `visibility-${++nativeSequence}`;
    const executablePath = process.env.BASS_INPUT_EDGE_PATH || DEFAULT_EDGE_PATH;
    let nativeEdge;
    try {
      nativeEdge = await launchIsolatedEdge({ executablePath, userDataDir: join(temporary, nativeProfile), args: ['--mute-audio', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(temporary, 'a1.wav')}`] });
      const context = nativeEdge.context; await isolate(context); await context.addInitScript(observeCapture);
      const page = nativeEdge.page; page.setDefaultTimeout(6000);
      page.on('pageerror', error => report.pageErrors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => document.querySelector('[data-input-mount]'), undefined, { polling: 100 });
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
    temporary = await mkdtemp(join(tmpdir(), 'bass-study-input-'));
    fixtureServer = await startBrowserFixture(root, config, 4192, report);
    fixtureOrigin = report.fixtureOrigin;
    fixtureUrl = `${fixtureOrigin}/tests/fixtures/input.html`;
    for (const signal of Object.keys(WAV_SIGNALS)) await writeFile(join(temporary, `${signal}.wav`), makeWav(signal));
    for (const { name, scope, run, signal = 'a1' } of checks) {
      const started = performance.now(); let context;
      try {
        if (scope !== 'native') { browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(temporary, `${signal}.wav`)}`] }); report.browserVersion = browser.version(); }
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
        await cleanup(`browser:${name}`, async () => { await browser?.close(); browser = undefined; });
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
      assert.ok(inside.startsWith('bass-study-input-') && !inside.includes(sep) && !inside.startsWith('..'), 'Temporary profile escaped the intended temp directory');
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    });
    await writeBrowserReport(resultDir, 'p7-input-edge.json', report, checks.length, skippedChecks);
  }
}
