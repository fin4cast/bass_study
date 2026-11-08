import { inspectStaticServer } from './static-server-ownership.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

export async function runTrainingBrowserChecks(checks) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const origin = 'http://localhost:4173';
  const resultDir = join(root, 'test-results');
  const externalRequests = [];
  const pageErrors = [];
  const report = {
    generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    node: process.version, browserChannel: 'msedge', browserVersion: null, origin,
    scope: 'P3 real-user quiz interactions and sequence preview; no audio or durable storage acceptance.',
    networkIsolation: 'Non-loopback HTTP requests from application pages are aborted. Fresh browser context and disabled cache; no Windows NIC change.',
    checks: [], cleanupErrors: [],
  };
  let server; let externalServer = false;
  let browser;
  let context;
  let page;
  try {
    const ownership = await inspectStaticServer(origin, join(root, 'dist', 'index.html'), process.argv.includes('--reuse-server'));
    externalServer = ownership.external; report.staticServer = ownership.evidence;
    await mkdir(resultDir, { recursive: true });
    if (!externalServer) {
    server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let startup = '';
    let launchError;
    server.on('error', error => { launchError = error; });
    server.stdout.on('data', data => { startup += data; });
    server.stderr.on('data', data => { startup += data; });
    let ready = false;
    for (let index = 0; index < 100; index++) {
      if (launchError) throw launchError;
      if (server.exitCode !== null) throw new Error(`Server exited: ${startup}`);
      try { if ((await fetch(origin, { signal: AbortSignal.timeout(300) })).ok) { ready = true; break; } } catch { /* wait for listener */ }
      await delay(50);
    }
    assert.ok(ready, `Server did not become ready: ${startup}`);
    }
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
    await cleanup('local-server', async () => {
      if (!externalServer && server?.pid && server.exitCode === null) {
        const exited = new Promise(resolve => server.once('exit', resolve));
        server.kill(); await exited;
      }
    });
    report.passed = report.checks.filter(item => item.status === 'passed').length;
    report.failed = report.checks.filter(item => item.status === 'failed').length;
    report.status = !report.setupError && report.failed === 0 && report.cleanupErrors.length === 0 ? 'passed' : 'failed';
    await mkdir(resultDir, { recursive: true });
    await writeFile(join(resultDir, 'p3-edge.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.status}: ${report.passed} passed, ${report.failed} failed; report test-results/p3-edge.json`);
    process.exitCode = report.status === 'passed' ? 0 : 1;
  }
}
