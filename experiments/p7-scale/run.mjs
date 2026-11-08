import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const afterFix = process.argv.includes('--after-fix');
const reports = [];
let browser, server;
try {
  try { await fetch('http://127.0.0.1:4184', { signal: AbortSignal.timeout(400) }); throw new Error('Port 4184 is occupied.'); }
  catch (error) { if (error.message === 'Port 4184 is occupied.') throw error; }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const candidate of afterFix ? [true] : [false, true]) {
    const changes = [];
    server = await createServer({ configFile: false, root, logLevel: 'warn', clearScreen: false,
      server: { host: '127.0.0.1', port: 4184, strictPort: true },
      plugins: candidate && !afterFix ? [{ name: 'p7-only-in-memory-candidate-config', enforce: 'pre', transform(source, id) {
        const path = id.replaceAll('\\', '/');
        if (path.endsWith('/src/storage/model.ts')) {
          assert.ok(source.includes('export const MAX_BACKUP_BYTES = 10_485_760;'));
          changes.push('Served model.ts only: 10MiB cap →64MiB');
          return source.replace('export const MAX_BACKUP_BYTES = 10_485_760;', 'export const MAX_BACKUP_BYTES = 67_108_864;');
        }
        if (path.endsWith('/src/storage/index.ts')) {
          assert.ok(source.includes('JSON.stringify(await read(), null, 2)'));
          changes.push('Served index.ts only: export JSON whitespace removed');
          return source.replace('JSON.stringify(await read(), null, 2)', 'JSON.stringify(await read())');
        }
      } }] : [],
    });
    await server.listen();
    const context = await browser.newContext();
    const errors = [], remote = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
      remote.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4184/experiments/p7-scale/index.html?candidate=${candidate}&afterFix=${afterFix}`);
    await page.waitForFunction(() => window.p7Scale);
    console.log(`Starting ${candidate ? 'candidate' : 'baseline'} full-year synthetic benchmark…`);
    const evidence = await page.evaluate(() => window.p7Scale.run());
    assert.equal(evidence.checks.sessions, 1460); assert.equal(evidence.checks.questions, 29200);
    assert.ok(evidence.checks.sizes.compactBytes > 10_485_760); assert.deepEqual(errors, []); assert.deepEqual(remote, []);
    if (candidate) {
      assert.equal(evidence.checks.restoredHistoryCount, 1460); assert.equal(evidence.checks.reopenedCount, 1460);
      assert.equal(evidence.checks.exportCompact, true); assert.equal(evidence.checks.restore.status, 'restored');
      assert.equal(evidence.checks.exportByteForByteEqual, true);
      assert.equal(evidence.checks.restoredQuestions, 29200); assert.equal(evidence.checks.restoredAttempts, 58400);
      assert.deepEqual(evidence.checks.restoreTransaction, { successfulWrites: 1461, aborted: false });
    } else { assert.equal(evidence.checks.currentCapPreservedEmptyDatabase, true); assert.equal(evidence.checks.currentCapErrorCode, 'INVALID_BACKUP'); }
    reports.push({ browserVersion: browser.version(), candidate, servedSourceTransforms: [...new Set(changes)], ...evidence });
    console.log(JSON.stringify({ candidate, ...evidence.checks.sizes, measurements: evidence.samples }, null, 2));
    await context.close(); await server.close(); server = null;
  }
  await mkdir(directory, { recursive: true });
  const resultName = afterFix ? 'after-fix.json' : 'results.json';
  await writeFile(resolve(directory, resultName), JSON.stringify({ generatedAt: new Date().toISOString(), synthetic: true, productionFilesChanged: false, productionModulesTransformedInMemory: !afterFix, platform: process.platform, node: process.version, reports }, null, 2) + '\n');
  console.log(`PASS: experiments/p7-scale/${resultName}`);
} finally { await server?.close(); await browser?.close(); }
