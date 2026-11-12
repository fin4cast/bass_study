import { browserRun, startBrowserBuild, writeBrowserReport, startBrowserFixture } from './browser-runner.mjs';
import { browserTier } from './browser-case.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DEFAULT_EDGE_PATH, launchIsolatedEdge } from './native-edge.mjs';

const loopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

export async function runAudioBrowserChecks(allChecks) {
  const { checks, skipped: skippedChecks } = browserTier(allChecks);

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const config = browserRun(root);
  let origin = config.origin;
  let fixtureOrigin = null;
  let fixtureUrl;
  const { resultDir } = config;
  const report = {
    generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    node: process.version, browserChannel: 'msedge', browserVersion: null, origin, fixtureOrigin,
    scope: 'P4 actual Web Audio lookahead scheduling, OfflineAudioContext PCM, live analyser and product player UI; physical speakers muted; no physical output latency measurement.',
    networkIsolation: 'Fresh Edge contexts with cache disabled; non-loopback page HTTP requests aborted. No user profile or Windows network adapter change.',
    checks: [], externalRequests: [], pageErrors: [], cleanupErrors: [],
  };
  let server, fixtureServer, browser, temporary;
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
    contexts.add(context); await isolate(context);
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(url);
    if (url === fixtureUrl) await page.waitForFunction(() => window.p4?.ready);
    else await page.waitForSelector('[data-position="E:5"]');
    return { context, page };
  }
  async function withNativeBrowser(run) {
    const executablePath = process.env.BASS_P4_EDGE_PATH || DEFAULT_EDGE_PATH;
    let nativeEdge;
    try {
      nativeEdge = await launchIsolatedEdge({ executablePath, userDataDir: join(temporary, 'visibility'), args: ['--mute-audio'] });
      const context = nativeEdge.context; await isolate(context);
      const page = nativeEdge.page; page.setDefaultTimeout(6000);
      page.on('pageerror', error => report.pageErrors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => document.querySelector('[data-position="E:5"]'), undefined, { polling: 100 });
      await page.bringToFront();
      return await run({ page, context });
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
    temporary = await mkdtemp(join(tmpdir(), 'bass-study-p4-'));
    fixtureServer = await startBrowserFixture(root, config, 4181, report);
    fixtureOrigin = report.fixtureOrigin;
    fixtureUrl = `${fixtureOrigin}/tests/fixtures/audio.html`;
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
      assert.ok(inside.startsWith('bass-study-p4-') && !inside.includes(sep) && !inside.startsWith('..'), 'Temporary profile escaped the intended temp directory');
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    });
    await writeBrowserReport(resultDir, 'p4-edge.json', report, checks.length, skippedChecks);
  }
}
