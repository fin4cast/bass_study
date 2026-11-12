import { browserRun, startBrowserBuild, writeBrowserReport } from './browser-runner.mjs';
import { browserTier } from './browser-case.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export async function runTrainingBrowserChecks(allChecks) {
  const { checks, skipped: skippedChecks } = browserTier(allChecks);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const config = browserRun(root);
  let origin = config.origin;
  const { resultDir } = config;
  const externalRequests = [];
  const pageErrors = [];
  const report = {
    generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    node: process.version, browserChannel: 'msedge', browserVersion: null, origin,
    scope: 'P3 real-user quiz interactions and sequence preview; no audio or durable storage acceptance.',
    networkIsolation: 'Non-loopback HTTP requests from application pages are aborted. Fresh browser context and disabled cache; no Windows NIC change.',
    checks: [], cleanupErrors: [],
  };
  let server;
  let browser;
  let context;
  let page;
  try {
    server = await startBrowserBuild(config, report);
    origin = server.origin;
    await mkdir(resultDir, { recursive: true });
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    report.browserVersion = browser.version();
    context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) await route.continue();
      else { externalRequests.push(url.href); await route.abort('internetdisconnected'); }
    });
    page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.clearBrowserCache');
    for (const { name, run } of checks) {
      const started = performance.now();
      try {
        // Re-navigation now preserves settings. These independent P3 cases need
        // an empty origin; P5 owns persistence and full-browser restart checks.
        await page.goto('about:blank');
        const session = await context.newCDPSession(page);
        await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb' });
        await session.detach();
        await page.goto(origin);
        await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
        await page.waitForSelector('[data-position="E:5"]');
        const evidence = await run({ page, origin, resultDir, externalRequests, pageErrors });
        report.checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started), evidence });
        console.log(`PASS ${name}`);
      } catch (error) {
        report.checks.push({ name, status: 'failed', durationMs: Math.round(performance.now() - started), error: error.stack || String(error) });
        console.error(`FAIL ${name}: ${error.message}`);
      }
    }
  } catch (error) {
    report.setupError = error.stack || String(error);
    console.error(error);
  } finally {
    async function cleanup(name, operation) {
      try { await operation(); }
      catch (error) { report.cleanupErrors.push({ name, error: error.stack || String(error) }); console.error(`Cleanup failed (${name}): ${error.message}`); }
    }
    await cleanup('browser-context', async () => { await context?.close(); });
    await cleanup('browser', async () => { await browser?.close(); });
    await cleanup('local-server', async () => { await server?.close(); });
    await writeBrowserReport(resultDir, 'p3-edge.json', report, checks.length, skippedChecks);
  }
}
