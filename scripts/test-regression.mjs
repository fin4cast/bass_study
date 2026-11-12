import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { prepareMusicBankVendor } from './prepare-music-bank.mjs';

// Браузерные раннеры и их отчёты. Порядок — от самых долгих к коротким: пул берёт раннеры по очереди,
// длинные стартуют первыми и не остаются одиноким хвостом в конце прогона.
const suites = [
  ['rhythm-browser', 'p10-rhythm-edge.json'], ['ear-browser', 'p7-ear-edge.json'], ['storage-browser', 'p5-edge.json'],
  ['release-browser', 'p6-edge.json'], ['audio-browser', 'p4-edge.json'],
  ['music-bank-browser', 'p10-music-bank-edge.json'], ['uiux-browser', 'p8-uiux-edge.json'], ['tracks-browser', 'p7-tracks-edge.json'],
  ['design-browser', 'p9-design-edge.json'], ['training-browser', 'p3-edge.json'], ['browser', 'p2-edge.json'],
  ['notation-browser', 'p7-notation-edge.json'], ['music-bank-storage-browser', 'p10-music-bank-storage-edge.json'],
];
// Захват fake-устройства в input анализируется в реальном времени: при занятом другими Edge процессоре сигнал рвётся
// и классификация меняется. Такие раннеры идут до пула, в одиночку.
const exclusiveSuites = [['input-browser', 'p7-input-edge.json']];
const root = fileURLToPath(new URL('../', import.meta.url));

function parseArgs(argv) {
  const options = { corpus: false, full: false, jobs: null };
  for (const arg of argv) {
    if (arg === '--corpus') options.corpus = true;
    else if (arg === '--full') options.full = true;
    else if (/^--jobs=\d+$/.test(arg)) options.jobs = arg.slice(7);
    else throw new Error(`Неизвестный аргумент ${arg}. Допустимы --full, --corpus и --jobs=<1..8>.`);
  }
  if (process.env.BASS_FULL === '1') options.full = true;
  else assert.ok([undefined, '', '0'].includes(process.env.BASS_FULL), 'BASS_FULL допускает только 0 или 1.');
  const jobs = options.jobs ?? process.env.BASS_TEST_JOBS ?? String(Math.max(1, Math.min(3, availableParallelism() - 2)));
  assert.match(jobs, /^[1-8]$/, 'Число параллельных раннеров (--jobs или BASS_TEST_JOBS) — от 1 до 8.');
  return { ...options, jobs: Number(jobs) };
}

const options = parseArgs(process.argv.slice(2));
const mode = options.full ? 'full' : 'fast';
const withCorpus = options.corpus;
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
const summary = { runId, mode, jobs: options.jobs, profile: withCorpus ? 'portable + corpus' : 'portable', startedAt: new Date().toISOString(),
  status: 'running', platform: process.platform, node: process.version, commit: git(['rev-parse', 'HEAD']).trim(),
  dirty: Boolean(git(['status', '--porcelain', '--untracked-files=normal']).trim()), steps: [] };
// Параллельные шаги публикуют протокол через одну очередь, чтобы записи summary.json не перекрывались.
let publishing = Promise.resolve();
const publish = () => (publishing = publishing.then(() => writeFile(summaryPath, toJson(summary))));
await publish();
console.log(`Протокол регрессии (${mode === 'full' ? 'полный' : 'быстрый'} набор, раннеров одновременно: ${options.jobs}): ${summaryPath}`);

function runnerEnv(profile, resultDir) {
  return { ...process.env, BASS_REGRESSION_RUN: runId, BASS_REGRESSION_DIST: dist, BASS_REGRESSION_RESULTS: resultDir,
    BASS_REGRESSION_PROFILE: profile, BASS_FULL: options.full ? '1' : '0' };
}
async function command(entry, args, { profile = 'portable', resultDir = reports } = {}) {
  const logPath = join(logs, `${entry.name}.log`);
  entry.log = portablePath(runDir, logPath);
  const log = createWriteStream(logPath, { flags: 'wx' });
  let logError;
  log.on('error', error => { logError = error; });
  const child = spawn(process.execPath, args, { cwd: root, env: runnerEnv(profile, resultDir), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // Полный вывод идёт в лог шага; в консоль — построчно с именем шага, чтобы параллельный вывод не смешивался.
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.on('data', data => {
      log.write(data);
      const lines = (pending + data).split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) process.stdout.write(`[${entry.name}] ${line}\n`);
    });
    stream.on('end', () => { if (pending) process.stdout.write(`[${entry.name}] ${pending}\n`); });
  }
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
  const entry = { name, status: 'running', startedAt: new Date().toISOString() };
  const started = performance.now();
  summary.steps.push(entry);
  await publish();
  try {
    console.log(`=== ${name}: старт ===`);
    await action(entry);
    assert.ok(entry.exitCode === undefined || entry.exitCode === 0, `Код завершения ${entry.exitCode}, сигнал ${entry.signal}`);
    entry.status = 'passed';
  } catch (error) {
    entry.status = 'failed'; entry.error = error.stack ?? String(error);
    console.error(`[${name}] ${error.stack ?? error}`);
  }
  entry.durationMs = Math.round(performance.now() - started);
  const counts = ['passed', 'failed', 'skipped'].filter(key => Number.isFinite(entry[key])).map(key => `${key} ${entry[key]}`).join(', ');
  console.log(`=== ${name}: ${entry.status}, ${(entry.durationMs / 1000).toFixed(1)} с${counts ? `; ${counts}` : ''} ===`);
  await publish();
  return entry.status === 'passed';
}

/** Выполняет задачи не более чем по `limit` одновременно, в порядке списка. */
async function pool(tasks, limit) {
  let next = 0;
  const worker = async () => { while (next < tasks.length) await tasks[next++](); };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

function checksComplete(entry, checks, expected, reportMode) {
  assert.ok(Array.isArray(checks) && expected > 0, 'Отчёт пуст.');
  assert.equal(new Set(checks.map(check => check.name)).size, checks.length, 'Имена сценариев должны быть уникальными.');
  const skipped = checks.filter(check => check.status === 'skipped');
  const executed = checks.filter(check => check.status !== 'skipped');
  assert.equal(executed.length, expected, 'Часть выполняемых сценариев отсутствует в отчёте.');
  entry.passed = executed.filter(check => check.status === 'passed').length;
  entry.failed = executed.filter(check => check.status === 'failed').length;
  entry.skipped = skipped.length;
  if (skipped.length) entry.skippedChecks = skipped.map(({ name, reason }) => ({ name, reason }));
  // Пропуск допустим только в быстром наборе и только с причиной полного набора; полный набор выполняет всё.
  assert.ok(reportMode === 'fast' || skipped.length === 0, 'В полном наборе пропусков быть не должно.');
  assert.ok(skipped.every(check => typeof check.reason === 'string' && check.reason.startsWith('Только полный набор')), 'Пропуск без причины полного набора.');
  assert.equal(entry.passed, expected, 'Есть проваленные сценарии.');
}
async function browserSuite(entry, runner, filename, profile, resultDir) {
  const path = join(resultDir, filename);
  entry.report = portablePath(runDir, path);
  await command(entry, [`tests/${runner}.mjs`], { profile, resultDir });
  const report = await readJson(path);
  assert.equal(report.runId, runId, 'Отчёт относится к другому запуску.');
  assert.equal(report.profile, profile, 'Отчёт относится к другому профилю.');
  assert.equal(report.mode, mode, 'Отчёт относится к другому набору.');
  entry.browserVersion = report.browserVersion;
  entry.profile = profile;
  entry.origin = report.origin;
  entry.fixtureOrigin = report.fixtureOrigin ?? null;
  entry.staticServer = report.staticServer;
  checksComplete(entry, report.checks, report.expected, report.mode);
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
  const expected = profile === 'portable' ? 9 : 22;
  assert.ok(Array.isArray(report.checks) && report.checks.length === expected && new Set(report.checks.map(check => check.name)).size === expected, 'Отчёт DSP неполон.');
  entry.passed = report.checks.filter(check => check.status === 'passed').length;
  entry.failed = report.checks.filter(check => check.status === 'failed').length;
  assert.equal(entry.passed, expected, 'Есть проваленные проверки DSP.');
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
    // Раннеры изолированы друг от друга: свои серверы и fixtures на портах, выданных ОС (порт 0), временные профили
    // Edge в собственных mkdtemp-каталогах и отчёты с разными именами. Поэтому их можно запускать пулом.
    for (const [runner, filename] of exclusiveSuites) await step(runner, entry => browserSuite(entry, runner, filename, 'portable', reports));
    const tasks = suites.map(([runner, filename]) => () => step(runner, entry => browserSuite(entry, runner, filename, 'portable', reports)));
    if (withCorpus) {
      const corpusDir = join(reports, 'corpus');
      await mkdir(corpusDir);
      tasks.push(() => step('dsp-corpus', entry => dspSuite(entry, 'corpus', corpusDir)));
      tasks.push(() => step('music-bank-corpus', entry => browserSuite(entry, 'music-bank-browser', 'p10-music-bank-edge.json', 'corpus', corpusDir)));
    }
    await pool(tasks, options.jobs);
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
    skipped: steps.reduce((sum, entry) => sum + (entry.skipped ?? 0), 0),
  });
  summary.browser = { ...count(browserSteps), portable: count(browserSteps.filter(entry => entry.profile === 'portable')),
    corpus: count(browserSteps.filter(entry => entry.profile === 'corpus')) };
  summary.status = built && browserSteps.length === suites.length + exclusiveSuites.length + Number(withCorpus) && summary.steps.every(entry => entry.status === 'passed') ? 'passed' : 'failed';
} catch (error) {
  summary.status = 'failed'; summary.error = error.stack ?? String(error); console.error(error);
} finally {
  summary.completedAt = new Date().toISOString();
  summary.durationMs = Date.parse(summary.completedAt) - Date.parse(summary.startedAt);
  await publish();
  const failed = summary.steps.filter(entry => entry.status !== 'passed').map(entry => entry.name);
  console.log(`\n${summary.status} (${mode}), ${(summary.durationMs / 1000).toFixed(0)} с; пропущено сценариев полного набора: ${summary.browser?.skipped ?? 0}${failed.length ? `; не прошли: ${failed.join(', ')}` : ''}\n${summaryPath}`);
  process.exitCode = summary.status === 'passed' ? 0 : 1;
}
