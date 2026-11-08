import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

export async function runNotationBrowserChecks(checks) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const origin = 'http://localhost:4173', fixtureOrigin = 'http://127.0.0.1:4194';
  const fixtureUrl = `${fixtureOrigin}/tests/fixtures/notation.html`, resultDir = join(root, 'test-results');
  const reuseRequested = process.argv.includes('--reuse-server');
  const report = { generatedAt: new Date().toISOString(), platform: process.platform, node: process.version, browserChannel: 'msedge', browserVersion: null,
    scope: 'R018 independent real SVG geometry/glyphs, local bundled fonts, keyboard/mobile/zoom and existing sequence audio cursor; synthetic notes, no physical bass assessment.',
    origin, fixtureOrigin, staticServer: { reuseRequested, owned: false, mode: 'not-started' },
    networkIsolation: 'Fresh Edge contexts, cache disabled, non-loopback HTTP denied; no user browser profile or hardware microphone.',
    checks: [], externalRequests: [], pageErrors: [], cleanupErrors: [] };
  let server, fixtureServer, browser; let externalServer = false;
  const contexts = new Set();
  async function cleanup(name, operation) { try { await operation(); } catch (error) { report.cleanupErrors.push({ name, error: error.stack || String(error) }); } }
  async function freshPage(url) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 1050 } }); contexts.add(context);
    await context.route('**/*', route => {
      if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname)) return route.continue();
      report.externalRequests.push(route.request().url()); return route.abort('internetdisconnected');
    });
    await context.addInitScript(() => {
      window.__notationAudioContexts = [];
      const original = window.AudioContext;
      if (original) {
        const wrapped = new Proxy(original, { construct(target, args) { const value = Reflect.construct(target, args); window.__notationAudioContexts.push(value); return value; } });
        window.AudioContext = wrapped; if (window.webkitAudioContext === original) window.webkitAudioContext = wrapped;
      }
    });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(url);
    if (url === fixtureUrl) await page.waitForFunction(() => window.p7notation?.ready);
    else await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main')?.inert);
    return { page, context, cdp };
  }
  try {
    const expectedIndex = await readFile(join(root, 'dist/index.html'));
    let existing; try { existing = await fetch(origin, { signal: AbortSignal.timeout(500), redirect: 'error' }); } catch { /* runner may own a new server */ }
    if (existing) {
      assert.ok(reuseRequested, 'Port4173 is occupied; explicit --reuse-server required.');
      assert.equal(existing.status, 200); assert.ok(Buffer.from(await existing.arrayBuffer()).equals(expectedIndex), 'Existing server differs from root/dist index.');
      externalServer = true; report.staticServer = { reuseRequested, owned: false, mode: 'external-reused', indexVerifiedByteForByte: true, shutdownAllowed: false };
    }
    try { await fetch(fixtureOrigin, { signal: AbortSignal.timeout(500) }); throw new Error('Fixture port4194 is occupied.'); }
    catch (error) { if (error.message === 'Fixture port4194 is occupied.') throw error; }
    fixtureServer = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 4194, strictPort: true }, logLevel: 'warn', clearScreen: false });
    await fixtureServer.listen(); await mkdir(resultDir, { recursive: true });
    if (!externalServer) {
      server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let startup = '', failure; server.on('error', error => { failure = error; });
      server.stdout.on('data', value => { startup += value; }); server.stderr.on('data', value => { startup += value; });
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (failure) throw failure; if (server.exitCode !== null) throw new Error(`Static server exited: ${startup}`);
        try { if ((await fetch(origin, { signal: AbortSignal.timeout(300) })).ok) { ready = true; break; } } catch { /* starting */ }
        await delay(50);
      }
      assert.ok(ready, startup); report.staticServer = { reuseRequested, owned: true, mode: 'runner-owned', shutdownAllowed: true };
    }
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] }); report.browserVersion = browser.version();
    for (const { name, scope = 'fixture', run } of checks) {
      const started = performance.now(); let context;
      try {
        const setup = await freshPage(scope === 'ui' ? origin : fixtureUrl); context = setup.context;
        const evidence = await run({ ...setup, root, origin, fixtureOrigin, resultDir });
        report.checks.push({ name, scope, status: 'passed', durationMs: Math.round(performance.now() - started), evidence }); console.log(`PASS ${name}`);
      } catch (error) { report.checks.push({ name, scope, status: 'failed', durationMs: Math.round(performance.now() - started), error: error.stack || String(error) }); console.error(`FAIL ${name}: ${error.message}`); }
      finally { if (context) { await cleanup(`context:${name}`, () => context.close()); contexts.delete(context); } }
    }
    assert.deepEqual(report.externalRequests, [], 'Notation requested remote assets.'); assert.deepEqual(report.pageErrors, [], 'Browser runtime errors.');
  } catch (error) { report.setupError = error.stack || String(error); console.error(error); }
  finally {
    for (const context of contexts) await cleanup('remaining-context', () => context.close());
    await cleanup('browser', async () => { await browser?.close(); }); await cleanup('fixture-server', async () => { await fixtureServer?.close(); });
    await cleanup('owned-static-server', async () => { if (!externalServer && server?.pid && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; } });
    report.passed = report.checks.filter(check => check.status === 'passed').length; report.failed = report.checks.filter(check => check.status === 'failed').length;
    report.status = !report.setupError && !report.failed && !report.cleanupErrors.length ? 'passed' : 'failed';
    await mkdir(resultDir, { recursive: true }); await writeFile(join(resultDir, 'p7-notation-edge.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.status}: ${report.passed} passed, ${report.failed} failed; test-results/p7-notation-edge.json`); process.exitCode = report.status === 'passed' ? 0 : 1;
  }
}
