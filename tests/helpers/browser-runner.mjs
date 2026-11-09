import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { inspectStaticServer } from './static-server-ownership.mjs';

export function browserRun(root) {
  const isolated = Boolean(process.env.BASS_REGRESSION_RUN);
  const reuseRequested = process.argv.includes('--reuse-server');
  assert.ok(!isolated || !reuseRequested, 'The regression runner owns its servers.');
  const directory = isolated ? process.env.BASS_REGRESSION_DIST : join(root, 'dist');
  const resultDir = isolated ? process.env.BASS_REGRESSION_RESULTS : join(root, 'test-results');
  assert.ok(directory && resultDir, 'The regression runner must provide the build and results directories.');
  return {
    isolated,
    reuseRequested,
    directory,
    resultDir,
    origin: 'http://localhost:4173',
  };
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(10000) });
  child.kill();
  await exited;
}

export async function launchTestBuild(directory, port) {
  const launcher = fileURLToPath(new URL('./serve-test-build.mjs', import.meta.url));
  const child = fork(launcher, [directory, String(port)], { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let diagnostics = '';
  child.stderr.on('data', data => { diagnostics += data; });
  let timer;
  try {
    const boundPort = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Static server startup timed out')), 10000);
      child.once('message', message => resolve(message.port));
      child.once('error', reject);
      child.once('close', () => reject(new Error(`Static server exited before binding: ${diagnostics.trim()}`)));
    });
    assert.ok(Number.isInteger(boundPort) && boundPort > 0 && (!port || boundPort === port), 'Unexpected bound port');
    const origin = `http://localhost:${boundPort}`;
    const response = await fetch(origin, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    assert.equal(response.status, 200);
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(await readFile(join(directory, 'index.html'))), 'Owned server index differs from build');
    return { origin, close: () => stopChild(child) };
  } catch (error) {
    await stopChild(child);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function startBrowserBuild(config, report, restartPort) {
  const { isolated, reuseRequested, directory } = config;
  if (!isolated && restartPort === undefined) {
    const ownership = await inspectStaticServer(config.origin, join(directory, 'index.html'), reuseRequested);
    report.staticServer = ownership.evidence;
    if (ownership.external) return { origin: config.origin, close: async () => {} };
  }
  const server = await launchTestBuild(directory, restartPort ?? (isolated ? 0 : 4173));
  report.staticServer = { reuseRequested, owned: true, mode: 'runner-owned', restartAllowed: true, shutdownAllowed: true };
  report.origin = server.origin;
  return server;
}

export async function startBrowserFixture(root, config, legacyPort, report) {
  const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: config.isolated ? 0 : legacyPort, strictPort: true, hmr: false }, logLevel: 'warn', clearScreen: false });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(address && typeof address === 'object' && address.port > 0, 'Vite fixture did not bind a loopback port');
    report.fixtureOrigin = `http://127.0.0.1:${address.port}`;
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function writeBrowserReport(resultDir, file, report, expected = report.checks.length) {
  report.passed = report.checks.filter(check => check.status === 'passed').length;
  report.failed = report.checks.filter(check => check.status === 'failed').length;
  report.expected = expected;
  report.runId = process.env.BASS_REGRESSION_RUN ?? null;
  report.profile = process.env.BASS_REGRESSION_PROFILE ?? null;
  report.status = !report.setupError && expected > 0 && report.passed === expected && !report.failed && !report.cleanupErrors.length ? 'passed' : 'failed';
  await mkdir(resultDir, { recursive: true });
  await writeFile(join(resultDir, file), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${report.passed} passed, ${report.failed} failed; ${join(resultDir, file)}`);
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
