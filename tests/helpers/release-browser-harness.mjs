import { browserRun, startBrowserBuild, writeBrowserReport, startBrowserFixture, launchTestBuild } from './browser-runner.mjs';
import { browserTier } from './browser-case.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export async function runReleaseBrowserChecks(allChecks) {
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
    scope: 'P6 actual v1/v10 IndexedDB upgrade to empty schema 11, refusal of old JSON copies, exact-pitch/interval UI, keyboard-only practice, partial history, whole browser/server restart and writer lease.',
    networkIsolation: 'Clean Edge contexts/profiles, cache disabled, non-loopback page HTTP requests blocked. No user profile, physical disk filling or Windows NIC changes.',
    staticServer: { reuseRequested, owned: false, mode: 'not-started' },
    checks: [], externalRequests: [], pageErrors: [], cleanupErrors: [],
  };
  let browser, server, fixtureServer, temporary;
  const contexts = new Set();
  async function cleanup(name, operation) {
    try { await operation(); }
    catch (error) { report.cleanupErrors.push({ name, error: error.stack || String(error) }); console.error(`Cleanup failed (${name}): ${error.message}`); }
  }
  async function prepare(context) {
    contexts.add(context);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return route.continue();
      report.externalRequests.push(url.href); return route.abort('internetdisconnected');
    });
    context.on('page', page => page.on('pageerror', error => report.pageErrors.push(error.message)));
  }
  async function freshPage(url = fixtureUrl, memory = false, persistentName = null) {
    const options = { viewport: { width: 1360, height: 1050 } };
    const context = persistentName
      ? await chromium.launchPersistentContext(join(temporary, persistentName), { ...options, channel: 'msedge', headless: true, args: ['--mute-audio'] })
      : await browser.newContext(options);
    await prepare(context);
    if (memory) await context.addInitScript(() => Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined }));
    const page = persistentName ? context.pages()[0] : await context.newPage();
    if (persistentName) page.on('pageerror', error => report.pageErrors.push(error.message));
    page.setDefaultTimeout(7000);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(url);
    if (url === fixtureUrl) await page.waitForFunction(() => window.p6?.ready);
    else await page.waitForSelector('[data-page-frame="lesson"]', { state: 'attached' });
    return { page, context, cdp };
  }
  async function closeContext(context) { await context.close(); contexts.delete(context); }
  async function restartServer() {
    if (!report.staticServer.owned) return false;
    const port = Number(new URL(origin).port);
    await server.close();
    server = await startBrowserBuild(config, report, port);
    assert.equal(server.origin, origin);
    return true;
  }
  async function refuseOccupiedServer() {
    const port = Number(new URL(origin).port);
    try {
      const duplicate = await launchTestBuild(config.directory, port);
      await duplicate.close();
    } catch (error) {
      assert.match(error.message, /EADDRINUSE/);
      return error.message;
    }
    throw new Error('The static server opened a second listener on the occupied port');
  }

  try {
    server = await startBrowserBuild(config, report);
    origin = server.origin;
    await mkdir(resultDir, { recursive: true });
    temporary = await mkdtemp(join(tmpdir(), 'bass-study-p6-'));
    fixtureServer = await startBrowserFixture(root, config, 4183, report);
    fixtureOrigin = report.fixtureOrigin;
    fixtureUrl = `${fixtureOrigin}/tests/fixtures/migration.html`;
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] }); report.browserVersion = browser.version();
    for (const { name, scope = 'api', memory = false, run } of checks) {
      const started = performance.now(); let context;
      try {
        const setup = scope === 'persistent' ? {} : await freshPage(scope === 'ui' ? origin : fixtureUrl, memory);
        context = setup.context;
        const evidence = await run({ ...setup, origin, fixtureOrigin, fixtureUrl, resultDir, report, freshPage, closeContext, restartServer, refuseOccupiedServer });
        report.checks.push({ name, scope, status: 'passed', durationMs: Math.round(performance.now() - started), evidence }); console.log(`PASS ${name}`);
      } catch (error) {
        report.checks.push({ name, scope, status: 'failed', durationMs: Math.round(performance.now() - started), error: error.stack || String(error) }); console.error(`FAIL ${name}: ${error.message}`);
      } finally {
        if (context) { await cleanup(`context:${name}`, () => context.close()); contexts.delete(context); }
      }
    }
    assert.deepEqual(report.externalRequests, [], 'Unexpected remote application resources');
    assert.deepEqual(report.pageErrors, [], 'Unexpected browser runtime errors');
  } catch (error) { report.setupError = error.stack || String(error); console.error(error); }
  finally {
    for (const context of contexts) await cleanup('remaining-context', () => context.close());
    await cleanup('browser', async () => { await browser?.close(); });
    await cleanup('fixture-server', async () => { await fixtureServer?.close(); });
    await cleanup('static-server', async () => { await server?.close(); });
    await cleanup('isolated-profiles', async () => {
      if (!temporary) return;
      const parentPath = await realpath(tmpdir()); const target = await realpath(temporary); const inside = relative(parentPath, target);
      assert.ok(inside.startsWith('bass-study-p6-') && !inside.startsWith('..') && !inside.includes(sep), 'Refusing cleanup outside the isolated temp root');
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    });
    await writeBrowserReport(resultDir, 'p6-edge.json', report, checks.length, skippedChecks);
  }
}
