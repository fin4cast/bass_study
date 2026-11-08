import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://localhost:4173';
const report = {
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  browserChannel: 'msedge',
  browserVersion: null,
  origin,
  networkIsolation: 'Non-loopback HTTP requests from application pages are aborted; loopback remains available. Clean browser profiles, cache disabled. This does not isolate Windows/browser background services or change NIC state.',
  physicalAudio: 'Not measured. Headless browser has muted physical output; live Web Audio analyser and OfflineAudioContext PCM are checked.',
  cleanupErrors: [],
  checks: [],
};
const temporary = await mkdtemp(join(tmpdir(), 'bass-study-p1-'));
let server;
let context;
let page;
let unexpectedExternal = [];

async function check(name, action) {
  const start = performance.now();
  try {
    const evidence = await action();
    report.checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - start), evidence });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, status: 'failed', durationMs: Math.round(performance.now() - start), error: error.stack || String(error) });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function launch(profile) {
  const ctx = await chromium.launchPersistentContext(join(temporary, profile), {
    channel: 'msedge', headless: true, viewport: { width: 1280, height: 950 },
    args: ['--autoplay-policy=user-gesture-required'],
  });
  report.browserVersion ||= ctx.browser().version();
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      unexpectedExternal.push(url.href);
      await route.abort('internetdisconnected');
    } else await route.continue();
  });
  const nextPage = ctx.pages()[0] || await ctx.newPage();
  const session = await ctx.newCDPSession(nextPage);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.clearBrowserCache');
  await nextPage.goto(origin);
  await nextPage.waitForFunction(() => window.p1?.ready);
  return { ctx, nextPage };
}

async function action(id) {
  await page.locator(`#${id}`).click();
  await page.waitForFunction(id => window.p1.lastAction.name === id && window.p1.lastAction.done, id);
  const state = await page.evaluate(() => window.p1.lastAction);
  assert.equal(state.error, null, `UI action ${id}: ${state.error}`);
}
const snapshot = () => page.evaluate(() => window.p1.audio.getSnapshot());
const storageRead = () => page.evaluate(() => window.p1.storage.read());

async function checkRealVisibility() {
  // Playwright's normal launch enables focus emulation on its own CDP session.
  // Use a separate isolated Edge process with noDefaults so a genuine tab switch
  // can produce document.hidden. No monkey-patched property/event is used.
  const edge = process.env.BASS_P1_EDGE_PATH || join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const child = spawn(edge, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'visibility')}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  let output = '';
  let launchError;
  child.on('error', error => { launchError = error; });
  child.stderr.on('data', data => { output += data; });
  try {
    let endpoint;
    for (let i = 0; i < 100; i++) {
      if (launchError) throw launchError;
      endpoint = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      if (endpoint) break;
      if (child.exitCode !== null) throw new Error(`Visibility browser exited: ${output.slice(-500)}`);
      await delay(100);
    }
    assert.ok(endpoint, 'No isolated Edge CDP endpoint');
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    const ctx = browser.contexts()[0];
    await ctx.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort('internetdisconnected'));
    const source = ctx.pages()[0];
    await source.goto(origin);
    await source.waitForFunction(() => window.p1?.ready, undefined, { polling: 100 });
    await source.bringToFront();
    await source.locator('#start').click({ force: true });
    await source.waitForFunction(() => window.p1.audio.getSnapshot().state === 'running', undefined, { polling: 100 });
    assert.equal(await source.evaluate(() => document.hidden), false);
    const other = await ctx.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await source.waitForFunction(() => document.hidden && window.p1.audio.getSnapshot().state === 'paused', undefined, { polling: 100, timeout: 5000 });
    const paused = await source.evaluate(() => window.p1.audio.getSnapshot());
    assert.equal(paused.pauseReason, 'hidden');
    await delay(100);
    assert.ok((await source.evaluate(() => window.p1.audio.getOutputLevel().peak)) < 0.000001);
    await source.bringToFront();
    await source.waitForFunction(() => !document.hidden, undefined, { polling: 100 });
    assert.equal((await source.evaluate(() => window.p1.audio.getSnapshot())).state, 'paused');
    await source.locator('#resume').click({ force: true });
    await source.waitForFunction(() => window.p1.audio.getSnapshot().state === 'running', undefined, { polling: 100 });
    await source.locator('#stop').click({ force: true });
    return { nativeDocumentHidden: true, pauseReason: paused.pauseReason, stayedPausedOnReturn: true, explicitResume: true,
      method: 'Isolated Edge process, connectOverCDP(noDefaults:true), real tab activation; no synthetic visibility event' };
  } finally {
    if (browser) {
      try { await (await browser.newBrowserCDPSession()).send('Browser.close'); } catch { /* already closed */ }
      await browser.close().catch(() => {});
    }
    if (child.pid && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done; }
  }
}

try {
  // Fail clearly on a busy port: tests must not attach to an unrelated server.
  try { await fetch(origin, { signal: AbortSignal.timeout(500) }); throw new Error('Port 4173 is already occupied'); }
  catch (error) { if (error.message === 'Port 4173 is already occupied') throw error; }
  await readFile(join(root, 'dist', 'index.html'));
  server = spawn(process.execPath, [join(root, 'server.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let startup = '';
  server.stdout.on('data', data => { startup += data; });
  server.stderr.on('data', data => { startup += data; });
  for (let i = 0; i < 100 && !startup.includes('P1 probe:'); i++) {
    if (server.exitCode !== null) throw new Error(`Server failed: ${startup}`);
    await delay(50);
  }
  assert.match(startup, /P1 probe:/, 'Local server did not start');

  ({ ctx: context, nextPage: page } = await launch('persistent'));
  await check('local-built-page-without-external-network', async () => {
    assert.match(await page.title(), /технические проверки P1/);
    assert.deepEqual(unexpectedExternal, []);
    const url = await page.evaluate(() => location.origin);
    assert.equal(url, origin);
    const result = await page.evaluate(async () => {
      try { await fetch('https://example.com/p1-network-sentinel'); return 'unexpected-success'; }
      catch { return 'blocked'; }
    });
    assert.equal(result, 'blocked');
    assert.equal(unexpectedExternal.length, 1);
    unexpectedExternal = [];
    return { cache: 'empty/disabled', externalSentinel: result, actualOrigin: url };
  });

  await check('busy-port-does-not-change-origin', async () => {
    const second = spawn(process.execPath, [join(root, 'server.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    second.stderr.on('data', data => { errors += data; });
    const exit = await new Promise(resolve => second.once('exit', resolve));
    assert.notEqual(exit, 0);
    assert.match(errors, /EADDRINUSE/);
    assert.equal((await fetch(origin)).status, 200);
    return { secondExitCode: exit, diagnostic: errors.trim() };
  });

  await check('audio-user-start-count-in-loop-and-live-signal', async () => {
    await action('start');
    await page.waitForFunction(() => window.p1.audio.getSnapshot().trace.filter(x => x.type === 'note').length >= 6);
    await page.waitForFunction(() => window.p1.audio.getOutputLevel().peak > 0.003);
    const state = await snapshot();
    assert.equal(state.contextState, 'running');
    assert.equal(state.activeVoices, 1);
    const ticks = state.trace.filter(x => x.generation === state.generation && ['count-in', 'note'].includes(x.type));
    assert.equal(ticks.filter(x => x.type === 'count-in').length, 2);
    assert.deepEqual(ticks.filter(x => x.type === 'note').slice(0, 6).map(x => x.step), [0, 1, 2, 3, 0, 1]);
    const intervals = ticks.slice(1).map((x, i) => x.scheduledTime - ticks[i].scheduledTime);
    intervals.forEach(value => assert.ok(Math.abs(value - 1 / 3) < 0.005, `Scheduled beat interval ${value}`));
    return { generation: state.generation, countIn: 2, noteSteps: [0, 1, 2, 3, 0, 1], scheduledIntervals: intervals, outputPeak: state.output.peak };
  });

  await check('audio-pause-resume-without-new-count-in', async () => {
    await action('pause');
    await delay(120);
    const paused = await snapshot();
    assert.equal(paused.state, 'paused');
    assert.ok(paused.output.peak < 0.000001);
    await delay(300);
    assert.ok(Math.abs((await snapshot()).transportBeat - paused.transportBeat) < 0.001);
    const countIn = paused.trace.filter(x => x.type === 'count-in').length;
    const notes = paused.trace.filter(x => x.type === 'note').length;
    await action('resume');
    await page.waitForFunction(notes => window.p1.audio.getSnapshot().trace.filter(x => x.type === 'note').length >= notes + 2, notes);
    const resumed = await snapshot();
    assert.equal(resumed.trace.filter(x => x.type === 'count-in').length, countIn);
    assert.equal(resumed.generation, paused.generation);
    return { pausedPeak: paused.output.peak, generation: resumed.generation, countInUnchanged: true };
  });

  await check('audio-tempo-next-quarter', async () => {
    await page.locator('#bpm').fill('220');
    await action('tempo');
    await page.waitForFunction(() => window.p1.audio.getSnapshot().trace.some(x => x.type === 'tempo'));
    const changed = await snapshot();
    const event = changed.trace.filter(x => x.type === 'tempo').at(-1);
    assert.ok(event.scheduledTime >= event.requestedAt);
    const requestToBoundary = event.scheduledTime - event.requestedAt;
    assert.ok(requestToBoundary <= 1 / 3 + 0.15, `Late tempo boundary ${requestToBoundary}`);
    assert.ok(changed.trace.some(x => x.type === 'note' && Math.abs(x.scheduledTime - event.scheduledTime) < 0.001), 'Tempo applies to an actual beat');
    await page.waitForFunction(time => window.p1.audio.getSnapshot().trace.filter(x => x.type === 'note' && x.scheduledTime > time + 0.01).length >= 4, event.scheduledTime);
    const after = await snapshot();
    const notes = after.trace.filter(x => x.type === 'note' && x.scheduledTime > event.scheduledTime + 0.01).slice(0, 4);
    const intervals = notes.slice(1).map((x, i) => x.scheduledTime - notes[i].scheduledTime);
    intervals.forEach(value => assert.ok(Math.abs(value - 60 / 220) < 0.005, `Changed interval ${value}`));
    return { appliedAt: event.scheduledTime, requestedAt: event.requestedAt, requestToBoundary, scheduledIntervals: intervals };
  });

  await check('audio-real-visibility-pause', checkRealVisibility);

  await check('audio-stop-silence-and-repeated-starts', async () => {
    await action('stop');
    await delay(120);
    const stopped = await snapshot();
    assert.equal(stopped.activeVoices, 0);
    assert.equal(stopped.repeatId, null);
    assert.equal(stopped.transportState, 'stopped');
    assert.ok(stopped.output.peak < 0.000001);
    const count = stopped.trace.filter(x => ['note', 'count-in'].includes(x.type)).length;
    await delay(450);
    assert.equal((await snapshot()).trace.filter(x => ['note', 'count-in'].includes(x.type)).length, count);
    await page.evaluate(() => { window.p1.nextAudioConfig = { bpm: 180, countInBeats: 0, loopBeats: 2 }; });
    const generations = [];
    for (let i = 0; i < 3; i++) {
      await action('start');
      const generation = (await snapshot()).generation;
      generations.push(generation);
      await page.waitForFunction(generation => window.p1.audio.getSnapshot().trace.filter(x => x.generation === generation && x.type === 'note').length >= 3, generation);
      const notes = (await snapshot()).trace.filter(x => x.generation === generation && x.type === 'note');
      assert.equal(new Set(notes.map(x => x.scheduledTime)).size, notes.length);
      notes.slice(1).forEach((x, j) => assert.ok(Math.abs(x.scheduledTime - notes[j].scheduledTime - 1 / 3) < 0.005));
      await action('stop');
      await delay(100);
      assert.ok((await snapshot()).output.peak < 0.000001);
    }
    assert.deepEqual(generations.slice(1).map((x, i) => x - generations[i]), [1, 1]);
    return { postStopPeak: stopped.output.peak, extraEventsAfterStop: 0, freshGenerations: generations };
  });

  await check('audio-independent-offline-pcm-render', async () => {
    const result = await page.evaluate(() => window.p1.audio.renderOfflineCheck());
    assert.ok(result.peak > 0.01 && result.peak < 1);
    assert.ok(result.postStopRms < 0.000001);
    const expected = [0, 0.5, 1, 1.5, 1.75, 2];
    assert.equal(result.onsets.length, expected.length);
    result.onsets.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 0.02, `PCM onset ${i}: ${value}`));
    return result;
  });

  let canonical;
  let exported;
  await check('indexeddb-write-read-export', async () => {
    await action('seed');
    canonical = await storageRead();
    assert.equal(canonical.schemaVersion, 1);
    assert.equal(canonical.presets.length, 2);
    assert.equal(canonical.history.length, 2);
    assert.deepEqual(canonical.history.map(x => x.kind).sort(), ['manual', 'screen']);
    await action('export');
    exported = await page.locator('#backup').inputValue();
    assert.deepEqual(JSON.parse(exported), canonical);
    return { schemaVersion: 1, presets: 2, historyKinds: ['manual', 'screen'], backupBytes: Buffer.byteLength(exported) };
  });

  await check('indexeddb-rejects-invalid-import-before-write', async () => {
    const cases = [
      ['malformed-json', '{broken', 'INVALID_BACKUP'],
      ['future-version', JSON.stringify({ ...canonical, schemaVersion: 2 }), 'UNSUPPORTED_VERSION'],
      ['invalid-tempo', JSON.stringify({ ...canonical, settings: { ...canonical.settings, bpm: -1 } }), 'INVALID_BACKUP'],
      ['dangling-reference', JSON.stringify({ ...canonical, history: [{ ...canonical.history[0], presetId: 'missing' }] }), 'INVALID_BACKUP'],
    ];
    for (const [name, json, expectedCode] of cases) {
      const code = await page.evaluate(async json => {
        try { await window.p1.storage.restore(json, { confirmed: true }); return 'unexpected-success'; }
        catch (error) { return error.code; }
      }, json);
      assert.equal(code, expectedCode, name);
      assert.deepEqual(await storageRead(), canonical, name);
    }
    return { rejectedCases: cases.map(x => x[0]), existingStateUnchanged: true };
  });

  await check('indexeddb-cancel-and-atomic-rollback', async () => {
    const changed = JSON.stringify({ ...canonical, settings: { ...canonical.settings, bpm: 99 } });
    const cancellation = await page.evaluate(json => window.p1.storage.restore(json, { confirmed: false }), changed);
    assert.equal(cancellation.status, 'cancelled');
    assert.deepEqual(await storageRead(), canonical);
    const failure = await page.evaluate(async json => {
      try { await window.p1.storage.restore(json, { confirmed: true, failAfterWrite: 1 }); return { code: 'unexpected-success' }; }
      catch (error) { return { code: error.code, transaction: window.p1.storage.getLastTransaction() }; }
    }, changed);
    assert.equal(failure.code, 'INJECTED_ABORT');
    assert.equal(failure.transaction.successfulWrites, 1);
    assert.equal(failure.transaction.aborted, true);
    assert.deepEqual(await storageRead(), canonical);
    return failure;
  });

  await check('indexeddb-persists-after-browser-restart', async () => {
    await context.close(); context = null;
    ({ ctx: context, nextPage: page } = await launch('persistent'));
    assert.deepEqual(await storageRead(), canonical);
    return { origin, samePersistentProfile: true, fullStateEqual: true };
  });

  await check('indexeddb-restore-in-clean-profile-and-replace', async () => {
    await context.close(); context = null;
    ({ ctx: context, nextPage: page } = await launch('clean'));
    assert.equal(await storageRead(), null);
    const preview = await page.evaluate(json => window.p1.storage.previewImport(json), exported);
    assert.equal(preview.replacement, 'full');
    assert.equal(preview.requiresConfirmation, true);
    await page.locator('#backup').fill(exported);
    await action('preview');
    await page.locator('#confirm').check();
    await action('restore');
    assert.deepEqual(await storageRead(), canonical);
    const replacement = { ...canonical, presets: [], history: [], settings: { ...canonical.settings, bpm: 100 } };
    await page.evaluate(json => window.p1.storage.restore(json, { confirmed: true }), JSON.stringify(replacement));
    assert.deepEqual(await storageRead(), replacement);
    assert.deepEqual(unexpectedExternal, []);
    return { cleanProfileInitiallyEmpty: true, restoredEqual: true, stalePresetsRemoved: true, externalRequests: 0 };
  });

  await mkdir(join(root, 'results'), { recursive: true });
  await page.screenshot({ path: join(root, 'results', 'probe.png'), fullPage: true });
} catch (error) {
  report.setupError = error.stack || String(error);
  console.error(error);
} finally {
  async function cleanup(name, operation) {
    try { await operation(); }
    catch (error) {
      report.cleanupErrors.push({ name, error: error.stack || String(error) });
      console.error(`Cleanup failed (${name}): ${error.message}`);
    }
  }
  await cleanup('browser-context', async () => { await context?.close(); });
  await cleanup('local-server', async () => {
    if (server?.pid && server.exitCode === null) {
      const done = new Promise(resolve => server.once('exit', resolve));
      server.kill(); await done;
    }
  });
  await cleanup('isolated-temporary-profiles', async () => {
    // Delete only the exact freshly-created test directory under the OS temp root.
    const actual = await realpath(temporary);
    const tempRoot = await realpath(tmpdir());
    if (!actual.startsWith(tempRoot + sep) || !actual.split(sep).at(-1).startsWith('bass-study-p1-')) throw new Error('Refusing deletion outside the isolated test directory');
    await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  });
  report.passed = report.checks.filter(x => x.status === 'passed').length;
  report.failed = report.checks.filter(x => x.status === 'failed').length;
  report.status = !report.setupError && report.failed === 0 && report.cleanupErrors.length === 0 ? 'passed' : 'failed';
  await mkdir(join(root, 'results'), { recursive: true });
  await writeFile(join(root, 'results', 'edge-windows.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${report.passed} passed, ${report.failed} failed; report results/edge-windows.json`);
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
