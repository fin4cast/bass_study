import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

export async function runStorageBrowserChecks(checks) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const origin = 'http://localhost:4173';
  const fixtureOrigin = 'http://127.0.0.1:4182';
  const fixtureUrl = `${fixtureOrigin}/tests/fixtures/storage.html`;
  const resultDir = join(root, 'test-results');
  const reuseRequested = process.argv.includes('--reuse-server');
  const report = {
    generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    node: process.version, browserChannel: 'msedge', browserVersion: null, origin, fixtureOrigin,
    scope: 'P5 native IndexedDB, real transaction abort and browser quota override, browser restart, backup/restore and actual product UI; memory fallback separately labelled.',
    networkIsolation: 'Clean Edge contexts/profiles, cache disabled, non-loopback page HTTP requests blocked. No user profile, physical disk filling or Windows NIC changes.',
    staticServer: { reuseRequested, owned: false, mode: 'not-started' },
    checks: [], externalRequests: [], pageErrors: [], cleanupErrors: [],
  };
  let browser, server, fixtureServer, temporary; let externalServer = false;
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
    if (url === fixtureUrl) await page.waitForFunction(() => window.p5?.ready);
    else await page.waitForSelector('[data-position="E:5"]');
    return { page, context, cdp };
  }
  async function closeContext(context) { await context.close(); contexts.delete(context); }
  try {
    const expectedIndex = await readFile(join(root, 'dist', 'index.html'));
    let existing;
    try { existing = await fetch(origin, { signal: AbortSignal.timeout(500), redirect: 'error' }); } catch { /* no usable HTTP listener */ }
    if (existing) {
      assert.ok(reuseRequested, `Port already occupied: ${origin}; explicit --reuse-server is required`);
      assert.equal(existing.status, 200, 'Existing server must return the built index directly');
      assert.ok(Buffer.from(await existing.arrayBuffer()).equals(expectedIndex), 'Existing server index differs from root/dist/index.html; refusing reuse');
      externalServer = true;
      report.staticServer = { reuseRequested, owned: false, mode: 'external-reused', indexVerifiedByteForByte: true, restartAllowed: false, shutdownAllowed: false };
    }
    for (const url of [fixtureOrigin]) {
      try { await fetch(url, { signal: AbortSignal.timeout(500) }); throw new Error(`Port already occupied: ${url}`); }
      catch (error) { if (error.message.startsWith('Port already occupied:')) throw error; }
    }
    await mkdir(resultDir, { recursive: true });
    temporary = await mkdtemp(join(tmpdir(), 'bass-study-p5-'));
    fixtureServer = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 4182, strictPort: true }, clearScreen: false, logLevel: 'warn' });
    await fixtureServer.listen();
    if (!externalServer) {
    server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let startup = '', launchError;
    server.on('error', error => { launchError = error; }); server.stdout.on('data', data => { startup += data; }); server.stderr.on('data', data => { startup += data; });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      if (server.exitCode !== null) throw new Error(`Static server exited: ${startup}`);
      try { if ((await fetch(origin, { signal: AbortSignal.timeout(300) })).ok) { ready = true; break; } } catch { /* starting */ }
      await delay(50);
    }
    assert.ok(ready, `Server did not become ready: ${startup}`);
    report.staticServer = { reuseRequested, owned: true, mode: 'runner-owned', restartAllowed: true, shutdownAllowed: true };
    }
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] }); report.browserVersion = browser.version();
    for (const { name, scope = 'api', memory = false, run } of checks) {
      const started = performance.now(); let context;
      try {
        const setup = scope === 'persistent' ? {} : await freshPage(scope === 'ui' ? origin : fixtureUrl, memory);
        context = setup.context;
        const evidence = await run({ ...setup, origin, fixtureOrigin, fixtureUrl, resultDir, report, freshPage, closeContext });
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
    await cleanup('static-server', async () => {
      if (!externalServer && server?.pid && server.exitCode === null) { const done = new Promise(resolve => server.once('exit', resolve)); server.kill(); await done; }
    });
    await cleanup('isolated-profiles', async () => {
      if (!temporary) return;
      const parentPath = await realpath(tmpdir()); const target = await realpath(temporary); const inside = relative(parentPath, target);
      assert.ok(inside.startsWith('bass-study-p5-') && !inside.startsWith('..') && !inside.includes(sep), 'Refusing cleanup outside the isolated temp root');
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    });
    report.passed = report.checks.filter(check => check.status === 'passed').length; report.failed = report.checks.filter(check => check.status === 'failed').length;
    report.status = !report.setupError && report.failed === 0 && report.cleanupErrors.length === 0 ? 'passed' : 'failed';
    await mkdir(resultDir, { recursive: true }); await writeFile(join(resultDir, 'p5-edge.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.status}: ${report.passed} passed, ${report.failed} failed; report test-results/p5-edge.json`); process.exitCode = report.status === 'passed' ? 0 : 1;
  }
}
