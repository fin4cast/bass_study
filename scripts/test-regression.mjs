import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { prepareMusicBankVendor } from './prepare-music-bank.mjs';

const suites = [
  ['browser', 'p2-edge.json'], ['training-browser', 'p3-edge.json'], ['audio-browser', 'p4-edge.json'],
  ['storage-browser', 'p5-edge.json'], ['release-browser', 'p6-edge.json'], ['ear-browser', 'p7-ear-edge.json'],
  ['harmony-browser', 'p7-harmony-edge.json'], ['tracks-browser', 'p7-tracks-edge.json'], ['notation-browser', 'p7-notation-edge.json'],
  ['input-browser', 'p7-input-edge.json'], ['uiux-browser', 'p8-uiux-edge.json'], ['design-browser', 'p9-design-edge.json'],
  ['rhythm-browser', 'p10-rhythm-edge.json'], ['music-bank-browser', 'p10-music-bank-edge.json'],
  ['music-bank-storage-browser', 'p10-music-bank-storage-edge.json'],
];
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 1 && args[0] === '--corpus', 'Команда принимает только необязательный --corpus.');
const withCorpus = args.includes('--corpus');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const sha256 = data => createHash('sha256').update(data).digest('hex');
const toJson = data => JSON.stringify(data, null, 2) + '\n';
const portablePath = (directory, file) => relative(directory, file).split(sep).join('/');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

async function manifest(directory, paths) {
  const files = [];
  for (const path of [...new Set(paths)].sort()) {
    try { files.push({ path, sha256: sha256(await readFile(join(directory, path))) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; files.push({ path, deleted: true }); }
  }
  return { sha256: sha256(toJson(files)), files };
}
async function inputManifest() {
  return manifest(root, git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean));
}
async function buildManifest(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return manifest(directory, entries.filter(entry => entry.isFile()).map(entry => portablePath(directory, join(entry.parentPath, entry.name))));
}

const resultRoot = join(root, 'test-results');
await mkdir(resultRoot, { recursive: true });
const runDir = await mkdtemp(join(resultRoot, 'regression-'));
const runId = portablePath(resultRoot, runDir);
const dist = join(runDir, 'dist'), publicDir = join(runDir, 'public');
const logs = join(runDir, 'logs'), reports = join(runDir, 'reports');
await mkdir(logs); await mkdir(reports);
const summaryPath = join(runDir, 'summary.json');
const summary = { runId, profile: withCorpus ? 'portable + corpus' : 'portable', startedAt: new Date().toISOString(),
  status: 'running', platform: process.platform, node: process.version, commit: git(['rev-parse', 'HEAD']).trim(),
  dirty: Boolean(git(['status', '--porcelain', '--untracked-files=normal']).trim()), steps: [] };
const publish = () => writeFile(summaryPath, toJson(summary));
await publish();
console.log(`Протокол регрессии: ${summaryPath}`);

function runnerEnv(profile, resultDir) {
  return { ...process.env, BASS_REGRESSION_RUN: runId, BASS_REGRESSION_DIST: dist, BASS_REGRESSION_RESULTS: resultDir, BASS_REGRESSION_PROFILE: profile };
}
async function command(entry, args, { profile = 'portable', resultDir = reports } = {}) {
  const logPath = join(logs, `${entry.name}.log`);
  entry.log = portablePath(runDir, logPath);
  const log = createWriteStream(logPath, { flags: 'wx' });
  let logError;
  log.on('error', error => { logError = error; });
  const child = spawn(process.execPath, args, { cwd: root, env: runnerEnv(profile, resultDir), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log.write(data); process.stdout.write(data); });
  try {
    const [exitCode, signal] = await once(child, 'close');
    Object.assign(entry, { exitCode, signal });
  } finally {
    if (!log.destroyed) await new Promise(resolve => log.end(resolve));
  }
  if (logError) throw logError;
  return logPath;
}

async function step(name, action) {
  const entry = { name, status: 'running' };
  summary.steps.push(entry);
  await publish();
  try {
    console.log(`\n=== ${name} ===`);
    await action(entry);
    assert.ok(entry.exitCode === undefined || entry.exitCode === 0, `Код завершения ${entry.exitCode}, сигнал ${entry.signal}`);
    entry.status = 'passed';
  } catch (error) {
    entry.status = 'failed'; entry.error = error.stack ?? String(error);
    console.error(error);
  }
  await publish();
  return entry.status === 'passed';
}

function checksComplete(entry, checks, expected) {
  assert.ok(Array.isArray(checks) && checks.length === expected && expected > 0, 'Отчёт пуст или часть сценариев пропущена.');
  assert.equal(new Set(checks.map(check => check.name)).size, expected, 'Имена сценариев должны быть уникальными.');
  entry.passed = checks.filter(check => check.status === 'passed').length;
  entry.failed = checks.filter(check => check.status === 'failed').length;
  assert.equal(entry.passed, expected, 'Есть проваленные или пропущенные сценарии.');
}
async function browserSuite(entry, runner, filename, profile, resultDir) {
  const path = join(resultDir, filename);
  entry.report = portablePath(runDir, path);
  await command(entry, [`tests/${runner}.mjs`], { profile, resultDir });
  const report = await readJson(path);
  assert.equal(report.runId, runId, 'Отчёт относится к другому запуску.');
  assert.equal(report.profile, profile, 'Отчёт относится к другому профилю.');
  entry.browserVersion = report.browserVersion;
  entry.profile = profile;
  entry.origin = report.origin;
  entry.fixtureOrigin = report.fixtureOrigin ?? null;
  entry.staticServer = report.staticServer;
  checksComplete(entry, report.checks, report.expected);
  assert.equal(report.status, 'passed', 'Ошибка сценариев, подготовки или очистки.');
  assert.equal(report.browserChannel, 'msedge');
  assert.ok(report.browserVersion && report.staticServer.owned && new URL(report.origin).port !== '4173');
}
async function dspSuite(entry, profile, resultDir) {
  const path = join(resultDir, 'p10-music-bank-channels.json');
  entry.report = portablePath(runDir, path);
  await command(entry, ['tests/music-bank-channels.mjs'], { profile, resultDir });
  const report = await readJson(path);
  assert.equal(report.runId, runId);
  assert.equal(report.profile, profile);
  checksComplete(entry, report.checks, profile === 'portable' ? 9 : 22);
  entry.pcmTracks = report.summary.pcmTracksPassed;
  assert.equal(entry.pcmTracks, profile === 'portable' ? 6 : 65);
}

try {
  if (withCorpus) {
    assert.ok(process.env.BASS_MUSIC_BANK_ROOT, 'Для --corpus укажи BASS_MUSIC_BANK_ROOT.');
    assert.ok((await stat(process.env.BASS_MUSIC_BANK_ROOT)).isDirectory(), 'BASS_MUSIC_BANK_ROOT должен указывать на папку.');
  }
  const inputs = await inputManifest();
  summary.inputsSha256 = inputs.sha256;
  await writeFile(join(runDir, 'inputs.json'), toJson(inputs));
  await step('docs', entry => command(entry, ['scripts/check-docs.mjs']));
  const checked = await step('types', entry => command(entry, ['node_modules/typescript/bin/tsc', '--noEmit']));
  const built = checked && await step('build', async () => {
    const sourcePublic = join(root, 'public');
    await cp(sourcePublic, publicDir, { recursive: true, filter: source => portablePath(sourcePublic, source) !== 'vendor/music-bank' });
    await prepareMusicBankVendor(join(publicDir, 'vendor', 'music-bank'));
    await build({ root, publicDir, build: { outDir: dist, emptyOutDir: false } });
    const output = await buildManifest(dist);
    assert.ok(output.files.some(file => file.path === 'index.html' && file.sha256));
    summary.buildSha256 = output.sha256;
    await writeFile(join(runDir, 'build.json'), toJson(output));
  });
  await step('unit', async entry => {
    const path = join(reports, 'unit.json');
    entry.report = portablePath(runDir, path);
    await command(entry, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', '--outputFile', path]);
    const report = await readJson(path);
    entry.passed = report.numPassedTests; entry.failed = report.numFailedTests;
    assert.ok(report.success && report.numTotalTests > 0 && report.numPassedTests === report.numTotalTests, 'Модульные проверки не прошли целиком.');
  });
  if (built) {
    await step('vendor', async entry => {
      const log = await command(entry, ['--test', '--test-reporter=tap', 'scripts/music-bank/vendor.test.mjs']);
      const output = await readFile(log, 'utf8');
      entry.passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
      assert.ok(entry.passed > 0 && entry.passed === Number(output.match(/^# tests (\d+)$/m)?.[1]), 'Проверки vendor не прошли целиком.');
    });
    await step('dsp', entry => dspSuite(entry, 'portable', reports));
    for (const [runner, filename] of suites) await step(runner, entry => browserSuite(entry, runner, filename, 'portable', reports));
    if (withCorpus) {
      const corpusDir = join(reports, 'corpus');
      await mkdir(corpusDir);
      await step('dsp-corpus', entry => dspSuite(entry, 'corpus', corpusDir));
      await step('music-bank-corpus', entry => browserSuite(entry, 'music-bank-browser', 'p10-music-bank-edge.json', 'corpus', corpusDir));
    }
    await step('provenance', async () => {
      assert.equal((await inputManifest()).sha256, summary.inputsSha256, 'Входы изменились в ходе проверки.');
      assert.equal((await buildManifest(dist)).sha256, summary.buildSha256, 'Сборка изменилась в ходе проверки.');
    });
  }
  const browserSteps = summary.steps.filter(entry => entry.staticServer);
  summary.edgeVersions = [...new Set(browserSteps.map(entry => entry.browserVersion).filter(Boolean))];
  const count = steps => ({
    suites: steps.length,
    passed: steps.reduce((sum, entry) => sum + (entry.passed ?? 0), 0),
    failed: steps.reduce((sum, entry) => sum + (entry.failed ?? 0), 0),
  });
  summary.browser = { ...count(browserSteps), portable: count(browserSteps.filter(entry => entry.profile === 'portable')),
    corpus: count(browserSteps.filter(entry => entry.profile === 'corpus')) };
  summary.status = built && browserSteps.length === suites.length + Number(withCorpus) && summary.steps.every(entry => entry.status === 'passed') ? 'passed' : 'failed';
} catch (error) {
  summary.status = 'failed'; summary.error = error.stack ?? String(error); console.error(error);
} finally {
  summary.completedAt = new Date().toISOString();
  await publish();
  console.log(`\n${summary.status}: ${summaryPath}`);
  process.exitCode = summary.status === 'passed' ? 0 : 1;
}
