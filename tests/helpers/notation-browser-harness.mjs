import { browserRun, startBrowserBuild, writeBrowserReport, startBrowserFixture } from './browser-runner.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export async function runNotationBrowserChecks(checks, suite = {}) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const config = browserRun(root);
  let origin = config.origin, fixtureOrigin = null;
  let fixtureUrl;
  const { resultDir, reuseRequested } = config;
  const report = { generatedAt: new Date().toISOString(), platform: process.platform, node: process.version, browserChannel: 'msedge', browserVersion: null,
    scope: suite.scope ?? 'R018 independent real SVG geometry/glyphs, local bundled fonts, keyboard/mobile/zoom and existing sequence audio cursor; synthetic notes, no physical bass assessment.',
    origin, fixtureOrigin, staticServer: { reuseRequested, owned: false, mode: 'not-started' },
    networkIsolation: 'Fresh Edge contexts, cache disabled, non-loopback HTTP denied; no user browser profile or hardware microphone.',
    checks: [], externalRequests: [], pageErrors: [], cleanupErrors: [] };
  let server, fixtureServer, browser;
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
    server = await startBrowserBuild(config, report);
    origin = server.origin;
    await mkdir(resultDir, { recursive: true });
    fixtureServer = await startBrowserFixture(root, config, 4194, report);
    fixtureOrigin = report.fixtureOrigin;
    fixtureUrl = `${fixtureOrigin}/tests/fixtures/notation.html`;
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
    await cleanup('owned-static-server', async () => { await server?.close(); });
    await writeBrowserReport(resultDir, suite.reportName ?? 'p7-notation-edge.json', report, checks.length);
  }
}
