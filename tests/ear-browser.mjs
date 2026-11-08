import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runEarBrowserChecks } from './helpers/ear-browser-harness.mjs';

const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });
const action = (page, name) => page.locator(`[data-ear-action="${name}"]`);
const choice = (page, degree) => page.locator(`[data-ear-choice="${degree}"]`);
const cueSnapshot = page => page.evaluate(() => window.p7ear.cue.getSnapshot());
const observation = page => page.evaluate(() => window.__earAudioObserved.read());
const near = (actual, expected, tolerance, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}, tolerance ${tolerance}`);

async function fixtureAction(page, name) {
  await page.locator(`#${name}`).click();
  await page.waitForFunction(name => window.p7ear.action?.name === name && window.p7ear.action.done, name);
  assert.equal((await page.evaluate(() => window.p7ear.action)).error, null);
}
async function ready(page) { await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert); }
async function saved(page) { await page.waitForFunction(() => document.querySelector('[data-testid="history-save-status"]')?.dataset.status === 'saved'); }
async function configure(page, { root = 'C', quality = 'major', count = 1, bpm = 120 } = {}) {
  await ready(page); await page.locator('[data-app-module="ear"]').click();
  await page.getByLabel('Тоника слухового задания', { exact: true }).selectOption(root);
  await page.getByLabel('Трезвучие для слуха', { exact: true }).selectOption(quality);
  for (const [label, value] of [['Слуховых вопросов', count], ['Темп прослушивания', bpm]]) { const input = page.getByLabel(label, { exact: true }); await input.fill(String(value)); await input.press('Tab'); }
}
async function start(page) { await action(page, 'start').click(); await page.getByTestId('ear-question').waitFor(); }
async function assertNoAnswerLeak(page) {
  const question = page.getByTestId('ear-question');
  assert.equal(await question.locator('[data-target],[data-target-midi],[data-midi],[data-note-name],[data-target-degree]').count(), 0);
  assert.equal(await question.locator('.is-correct').count(), 0);
  const markup = await question.evaluate(element => element.outerHTML);
  assert.doesNotMatch(markup, /targetMidi|targetDegree|targetName|referenceMidi|expectedAnswer|data-answer=/);
  assert.match(await page.getByTestId('ear-prompt').innerText(), /Какая ступень/);
}
async function beginListen(page) {
  await page.evaluate(() => window.__earAudioObserved.reset());
  await action(page, 'listen').click();
  await page.waitForFunction(() => window.__earAudioObserved.read().frequencies.filter(event => event.frequency > 0).length >= 2);
  const observed = await observation(page); const frequencies = observed.frequencies.filter(event => event.frequency > 0).slice(-2);
  const semitones = Math.round(12 * Math.log2(frequencies[1].frequency / frequencies[0].frequency));
  const degree = ({ 0: '1', 3: 'b3', 4: '3', 7: '5' })[semitones]; assert.ok(degree, `Unexpected native oscillator interval ${JSON.stringify(frequencies)}`);
  return { degree, semitones, frequencies };
}
async function fullListen(page) {
  const oracle = await beginListen(page); await choice(page, oracle.degree).waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-ear-choice]')].every(button => !button.disabled));
  return oracle;
}
async function summary(page) {
  await page.getByTestId('ear-summary').waitFor();
  return page.getByTestId('ear-summary').locator('[data-ear-result]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.earResult, Number(node.textContent)])));
}
async function openHistory(page) {
  await ready(page); const drawer = page.locator('.history-drawer'); if (!await drawer.evaluate(element => element.open)) await drawer.locator('summary').first().click();
  await page.getByLabel('Тип записей истории', { exact: true }).waitFor();
}
async function exportUi(page) {
  await openHistory(page); const downloading = page.waitForEvent('download'); await page.locator('[data-history-action="export"]').click();
  const download = await downloading; return JSON.parse(await readFile(await download.path(), 'utf8'));
}
async function readNativeHistory(page) {
  await saved(page);
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Expected the application database to exist already')); };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = db.transaction('history', 'readonly');
      const completion = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
      const request = transaction.objectStore('history').getAll();
      const history = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await completion;
      return { databaseVersion: db.version, history, method: 'Read-only native IndexedDB history in the runner-owned isolated Edge profile; no product test API or download plumbing.' };
    } finally { db.close(); }
  });
}

for (const fixture of [
  { name: 'C-major-E', root: 'C', quality: 'major', expected: [65.40639132514966, 82.4068892282175], target: 'E' },
  { name: 'A-minor-C', root: 'A', quality: 'minor', expected: [110, 130.8127826502993], target: 'C' },
  { name: 'C-sharp-major-E-sharp', root: 'C#', quality: 'major', expected: [69.29565774421802, 87.30705785825097], target: 'E♯' },
]) check(`pcm-reference-rest-target-${fixture.name}`, 'api', async ({ page }) => {
  const result = await page.evaluate(({ root, quality }) => window.p7ear.render(root, quality), fixture);
  assert.equal(result.channels, 1); assert.equal(result.sampleRate, 44100); near(result.duration, 1.6, 0.0001, 'buffer duration');
  assert.equal(result.onsets.length, 2); near(result.onsets[0], 0, .02, 'reference onset'); near(result.onsets[1], 1, .02, 'target onset');
  near(result.referenceHz, fixture.expected[0], .1, 'reference frequency measured from PCM'); near(result.targetHz, fixture.expected[1], .1, 'target frequency measured from PCM');
  assert.ok(result.referenceRms > .1 && result.targetRms > .1); assert.equal(result.restRms, 0); assert.equal(result.tailRms, 0); assert.equal(result.question.targetName, fixture.target);
  return { expectedHz: fixture.expected, ...result };
});

check('live-user-gesture-real-signal-and-completion-follow-actual-cue-clock', 'api', async ({ page }) => {
  await fixtureAction(page, 'play'); const started = await cueSnapshot(page); assert.equal(started.state, 'playing'); assert.ok(started.audioTime < started.finishAt);
  await page.waitForFunction(() => window.__earAudioObserved.read().levels.some(level => level.rms > .02));
  const sounding = await observation(page); near(started.finishAt - started.startAt, 1.5, .000001);
  await page.waitForFunction(() => { const state = window.p7ear.cue.getSnapshot(); return state.state === 'playing' && state.audioTime > state.startAt + 1.2; });
  assert.equal(await page.evaluate(() => window.p7ear.completions.length), 0, 'Completion must not fire from a future scheduled note');
  await page.waitForFunction(() => window.p7ear.cue.getSnapshot().state === 'finished'); const finished = await cueSnapshot(page);
  const completions = await page.evaluate(() => window.p7ear.completions); assert.equal(completions.length, 1); assert.ok(completions[0].snapshot.audioTime >= started.finishAt); assert.ok(finished.audioTime >= started.finishAt);
  await delay(100); assert.ok((await observation(page)).levels.every(level => level.rms < .000001));
  return { started, sounding, finished, completions };
});

check('live-stop-in-rest-cancels-future-target-and-completion', 'api', async ({ page }) => {
  await fixtureAction(page, 'play'); const started = await cueSnapshot(page);
  await page.waitForFunction(() => { const state = window.p7ear.cue.getSnapshot(); return state.audioTime > state.startAt + .65 && state.audioTime < state.startAt + 1; });
  await fixtureAction(page, 'stop'); await delay(650); const stopped = await cueSnapshot(page); const signal = await observation(page);
  assert.equal(stopped.state, 'stopped'); assert.equal(await page.evaluate(() => window.p7ear.completions.length), 0); assert.ok(signal.levels.every(level => level.rms < .000001));
  assert.ok(signal.frequencies.some(event => event.time > started.startAt + .9), 'The target really was scheduled in advance before cancellation');
  return { started, stopped, signal, futureTargetCancelled: true };
});

check('live-three-restarts-do-not-complete-cancelled-cues', 'api', async ({ page }) => {
  const runs = [];
  for (let index = 0; index < 3; index++) { await fixtureAction(page, 'play'); runs.push(await cueSnapshot(page)); if (index < 2) { await delay(100); await fixtureAction(page, 'stop'); } }
  await page.waitForFunction(() => window.p7ear.cue.getSnapshot().state === 'finished'); const completions = await page.evaluate(() => window.p7ear.completions);
  assert.equal(new Set(runs.map(run => run.runId)).size, 3); assert.deepEqual(completions.map(event => event.runId), [runs[2].runId]); return { runs, completions };
});

check('ui-listen-gates-answers-until-actual-end-and-first-correct-is-independent', 'ui', async ({ page }) => {
  await configure(page); await start(page); await assertNoAnswerLeak(page);
  assert.ok(await choice(page, '1').isDisabled()); const oracle = await beginListen(page);
  assert.ok(await choice(page, oracle.degree).isDisabled()); await delay(1050); assert.ok(await choice(page, oracle.degree).isDisabled(), 'Answer must remain locked while the target is still sounding');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-ear-choice]')].every(button => !button.disabled)); await assertNoAnswerLeak(page);
  assert.equal(await page.getByTestId('ear-completed-listens').innerText(), '1'); await choice(page, oracle.degree).click(); await action(page, 'next').click();
  const result = await summary(page); assert.deepEqual(result, { independentCorrect: 1, corrected: 0, errors: 0, hints: 0, skipped: 0, replayCount: 0 });
  const exported = await exportUi(page); const entry = exported.history[0]; assert.equal(entry.result.kind, 'ear'); assert.equal(entry.result.source, 'audio-choice');
  const question = entry.result.questions[0]; assert.equal(question.independentCorrect, true); assert.equal(question.listensCompleted, 1); assert.equal(question.question.targetDegree, oracle.degree);
  assert.deepEqual(question.listenEvents.map(event => event.type), ['start', 'complete']);
  const [startEvent, endEvent] = question.listenEvents; assert.ok(endEvent.atMs - startEvent.atMs >= 1500); assert.ok(question.answerEvents[0].atMs >= endEvent.atMs);
  return { oracle, result, entry };
});

check('ui-replay-is-counted-separately-from-first-answer-score', 'ui', async ({ page }) => {
  await configure(page, { root: 'A', quality: 'minor' }); await start(page); const first = await fullListen(page); const replay = await fullListen(page);
  assert.equal(first.degree, replay.degree); assert.equal(await page.getByTestId('ear-completed-listens').innerText(), '2'); assert.equal(await page.getByTestId('ear-replay-count').innerText(), '1');
  await choice(page, replay.degree).click(); await action(page, 'next').click(); const result = await summary(page); assert.equal(result.independentCorrect, 1); assert.equal(result.replayCount, 1); assert.equal(result.hints, 0);
  const entry = (await exportUi(page)).history[0]; assert.equal(entry.result.questions[0].replayCount, 1); assert.equal(entry.result.questions[0].hintUsed, false); return { first, replay, result };
});

check('ui-wrong-then-correct-preserves-error-and-corrected-result', 'ui', async ({ page }) => {
  await configure(page); await start(page); const oracle = await fullListen(page); const wrong = ['1', '3', '5'].find(degree => degree !== oracle.degree);
  await choice(page, wrong).click(); await assertNoAnswerLeak(page); await choice(page, oracle.degree).click(); await action(page, 'next').click();
  const result = await summary(page); assert.equal(result.independentCorrect, 0); assert.equal(result.corrected, 1); assert.equal(result.errors, 1);
  const question = (await exportUi(page)).history[0].result.questions[0]; assert.equal(question.firstAttemptCorrect, false); assert.equal(question.corrected, true); assert.equal(question.independentCorrect, false); assert.equal(question.answerEvents.length, 2);
  return { oracle, wrong, result, question };
});

check('ui-reveal-skip-and-next-have-distinct-nonindependent-outcomes', 'ui', async ({ page }) => {
  await configure(page, { count: 2 }); await start(page); await action(page, 'reveal').click(); assert.match(await page.getByTestId('ear-feedback').innerText(), /Ответ:|Показ/);
  await action(page, 'next').click(); await assertNoAnswerLeak(page); assert.ok(await choice(page, '1').isDisabled());
  await action(page, 'skip').click(); await action(page, 'next').click(); const result = await summary(page);
  assert.equal(result.independentCorrect, 0); assert.equal(result.hints, 1); assert.equal(result.skipped, 1);
  const questions = (await exportUi(page)).history[0].result.questions; assert.deepEqual(questions.map(question => question.outcome), ['revealed', 'skipped']); assert.ok(questions.every(question => !question.independentCorrect)); return { result, questions };
});

check('ui-stop-cancel-requires-a-new-full-listen-and-no-stale-completion', 'ui', async ({ page }) => {
  await configure(page); await start(page); await beginListen(page); await delay(200); await action(page, 'stop').click();
  await delay(1500); assert.ok(await choice(page, '1').isDisabled()); assert.equal(await page.getByTestId('ear-completed-listens').innerText(), '0');
  assert.ok((await observation(page)).levels.every(level => level.rms < .000001));
  const oracle = await fullListen(page); await choice(page, oracle.degree).click(); await action(page, 'next').click();
  const question = (await exportUi(page)).history[0].result.questions[0]; assert.equal(question.listensStarted, 2); assert.equal(question.listensCancelled, 1); assert.equal(question.listensCompleted, 1);
  assert.deepEqual(question.listenEvents.map(event => event.type), ['start', 'cancel', 'start', 'complete']); return { oracle, question };
});

check('ui-root-change-and-module-leave-archive-real-interruption', 'ui', async ({ page }) => {
  await configure(page); await start(page); await beginListen(page); await page.getByLabel('Тоника слухового задания', { exact: true }).selectOption('A');
  assert.equal(await page.getByTestId('ear-question').count(), 0); const first = await exportUi(page); assert.equal(first.history.length, 1);
  assert.equal(first.history[0].result.context.root, 'C'); assert.equal(first.history[0].result.questions[0].outcome, 'interrupted'); assert.equal(first.history[0].result.questions[0].listensCancelled, 1);
  await start(page); await beginListen(page); await page.locator('[data-app-module="foundation"]').click(); await saved(page);
  const second = await exportUi(page); assert.equal(second.history.length, 2); assert.ok(second.history.every(entry => entry.result.questions[0].outcome === 'interrupted'));
  await page.locator('[data-app-module="ear"]').click(); assert.equal(await page.getByTestId('ear-question').count(), 0); return { firstEntry: first.history[0], secondHistoryIds: second.history.map(entry => entry.id) };
});

check('ui-unfinished-ear-target-stays-hidden-in-global-history-and-after-reload', 'ui', async ({ page }) => {
  await configure(page); await start(page); await beginListen(page); await action(page, 'stop').click(); await saved(page); await openHistory(page);
  const entry = page.locator('[data-history-kind="ear"]'); await entry.locator('.history-question-details > summary').click();
  assert.match(await entry.locator('.history-question-details strong').innerText(), /цель скрыта/);
  assert.equal(await entry.locator('[data-midi],[data-target],[data-target-midi],[data-note-name]').count(), 0); await assertNoAnswerLeak(page);
  const text = await entry.locator('.history-question-details strong').innerText(); assert.doesNotMatch(text, /[A-G][♯♭]?\d|targetMidi/);
  await page.reload(); await ready(page); await openHistory(page); const reopened = page.locator('[data-history-kind="ear"]'); await reopened.locator('.history-question-details > summary').click();
  assert.match(await reopened.locator('.history-question-details strong').innerText(), /цель скрыта/); return { unfinishedTargetRedacted: true, persistsRedactedAfterReload: true };
});

check('ui-ear-preferences-and-three-route-links-persist-without-fret-filter-dependence', 'ui', async ({ page }) => {
  await ready(page); for (const string of ['E', 'A', 'D', 'G']) await page.getByRole('checkbox', { name: `Струна ${string}`, exact: true }).uncheck();
  await configure(page, { root: 'F#', quality: 'minor', bpm: 120 }); await start(page); const oracle = await fullListen(page); await choice(page, oracle.degree).click(); await action(page, 'next').click(); await saved(page);
  await page.reload(); await ready(page); assert.ok(await page.locator('#ear-mount').isVisible()); assert.equal(await page.getByLabel('Тоника слухового задания', { exact: true }).inputValue(), 'F#'); assert.equal(await page.getByLabel('Трезвучие для слуха', { exact: true }).inputValue(), 'minor');
  const visits = [];
  for (const step of ['fretboard', 'ear', 'sequence']) {
    await page.locator('[data-app-module="route"]').click(); assert.deepEqual(await page.locator('[data-route-step]').evaluateAll(nodes => nodes.map(node => node.dataset.routeStep)), ['fretboard', 'ear', 'sequence']);
    await page.locator(`[data-route-step="${step}"]`).click(); visits.push({ step, module: await page.locator('[data-app-module][aria-pressed="true"]').getAttribute('data-app-module') });
    assert.equal(visits.at(-1).module, step === 'ear' ? 'ear' : 'foundation');
    if (step === 'sequence') assert.equal(await page.locator('[data-training-mode="sequence"]').getAttribute('aria-pressed'), 'true');
  }
  return { oracle, configuredRoot: 'F#', quality: 'minor', emptyFretFilterDidNotPreventEar: true, visits, timedRouteClaimed: false };
});

check('ui-ear-history-filter-counts-reload-and-backup-replacement-stay-separate', 'ui', async ({ page }) => {
  await configure(page); await start(page); const oracle = await fullListen(page); await choice(page, oracle.degree).click(); await action(page, 'next').click();
  const exported = await exportUi(page); assert.equal(exported.schemaVersion, 3); assert.equal(exported.history[0].result.kind, 'ear');
  assert.match(await page.getByTestId('ear-history-summary').innerText(), /Слух — отдельно/); assert.match(await page.getByTestId('ear-history-summary').innerText(), /1 самостоятельных/);
  await page.getByLabel('Тип записей истории', { exact: true }).selectOption('screen'); assert.equal(await page.getByTestId('history-list').locator('[data-history-entry]').count(), 0);
  await page.getByLabel('Тип записей истории', { exact: true }).selectOption('ear'); assert.equal(await page.getByTestId('history-list').locator('[data-history-kind="ear"]').count(), 1);
  await page.getByLabel('Тип записей истории', { exact: true }).selectOption('all'); await page.getByLabel('Заметка к практике', { exact: true }).fill('Лишняя ручная отметка до полной замены');
  await page.locator('[data-history-action="save-manual"]').click(); await saved(page); assert.equal((await exportUi(page)).history.length, 2);
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles({ name: 'ear-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await page.getByTestId('backup-preview').waitFor(); await page.getByRole('checkbox', { name: 'Понимаю, что текущие данные будут заменены', exact: true }).check(); await page.locator('[data-history-action="confirm-restore"]').click();
  await page.getByTestId('backup-preview').waitFor({ state: 'detached' }); assert.deepEqual(await exportUi(page), exported);
  await page.reload(); await ready(page); assert.deepEqual(await exportUi(page), exported); return { oracle, source: exported.history[0].result.source, restoredExactly: true, manualRecordRemoved: true };
});

check('ui-invalid-ear-settings-recover-and-narrow-layout-remains-usable', 'ui', async ({ page, resultDir }) => {
  await configure(page); await page.getByLabel('Слуховых вопросов', { exact: true }).fill('21'); await action(page, 'start').click(); assert.match(await page.getByTestId('ear-error').innerText(), /1.*20/); assert.equal(await page.getByTestId('ear-question').count(), 0);
  await configure(page); await page.getByLabel('Темп прослушивания', { exact: true }).fill('150'); await action(page, 'start').click(); assert.match(await page.getByTestId('ear-error').innerText(), /60.*120/);
  await configure(page); await page.setViewportSize({ width: 390, height: 844 }); await start(page); await assertNoAnswerLeak(page);
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth })); assert.ok(width.page <= width.viewport + 2);
  await page.screenshot({ path: join(resultDir, 'p7-ear-narrow.png'), fullPage: true }); await action(page, 'skip').click(); await action(page, 'next').click(); await summary(page); return { width, recovered: true, screenshot: 'test-results/p7-ear-narrow.png' };
});

const routeAction = (page, name) => page.locator(`#route-session-mount [data-route-action="${name}"]`);
const routeActive = async page => Number(await page.locator('#route-session-mount').getAttribute('data-route-active-ms'));
async function routeState(page, expected) {
  await page.waitForFunction(expected => document.querySelector('#route-session-mount')?.dataset.routeState === expected, expected);
}
async function startRoute(page) {
  await ready(page); await page.locator('[data-app-module="route"]').click();
  assert.deepEqual(await page.locator('#route-mount [data-route-planned-ms]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.routePlannedMs))), [180000, 180000, 240000]);
  await page.locator('#route-mount [data-route-action="start"]').click(); await routeState(page, 'running');
  assert.equal(await page.locator('[data-app-module][aria-pressed="true"]').getAttribute('data-app-module'), 'foundation');
  assert.ok(await page.getByTestId('route-session-bar').isVisible());
}

check('timed-route-real-pause-resume-early-next-and-stop-save-actual-time', 'ui', async ({ page }) => {
  await startRoute(page);
  await page.waitForFunction(() => Number(document.querySelector('#route-session-mount')?.dataset.routeActiveMs) >= 900);
  await routeAction(page, 'pause').click(); await routeState(page, 'paused'); const paused = await routeActive(page);
  await delay(1000); assert.equal(await routeActive(page), paused, 'Paused wall time must not become active route time');
  await routeAction(page, 'resume').click(); await routeState(page, 'running');
  await page.waitForFunction(paused => Number(document.querySelector('#route-session-mount')?.dataset.routeActiveMs) > paused + 250, paused);
  await routeAction(page, 'next').click(); await routeState(page, 'running');
  assert.equal(await page.locator('#route-session-mount').getAttribute('data-route-step'), 'ear'); assert.ok(await page.locator('#ear-mount').isVisible());
  const next = await routeActive(page); await page.waitForFunction(next => Number(document.querySelector('#route-session-mount')?.dataset.routeActiveMs) > next + 200, next);
  await routeAction(page, 'stop').click(); await routeState(page, 'finished'); const exported = await exportUi(page);
  const entries = exported.history.filter(entry => entry.result.kind === 'route'); assert.equal(entries.length, 1); const entry = entries[0];
  assert.equal(entry.result.source, 'active-timer'); assert.equal(entry.result.finishReason, 'stopped'); assert.deepEqual(entry.result.plannedStepMs, [180000, 180000, 240000]);
  assert.ok(entry.result.actualStepMs[0] >= paused && entry.result.actualStepMs[0] < 10000); assert.ok(entry.result.actualStepMs[1] > 0 && entry.result.actualStepMs[1] < 10000); assert.equal(entry.result.actualStepMs[2], 0);
  assert.ok(entry.result.actualStepMs.reduce((sum, value) => sum + value, 0) < entry.result.totalPlannedMs);
  assert.deepEqual(entry.result.events.map(event => event.type), ['start', 'pause', 'resume', 'next', 'stop']);
  assert.equal(entry.result.events.find(event => event.type === 'pause').reason, 'manual'); assert.ok(!Object.hasOwn(entry.result, 'accuracy')); assert.ok(!Object.hasOwn(entry.result, 'independentCorrect'));
  return { pausedActiveMs: paused, pausedWallMsExcluded: 1000, earlyNextOpenedEar: true, entry, fullTenMinuteWaitClaimed: false };
});

check('timed-route-five-second-checkpoint-preserves-history-draft-focus-and-one-id', 'ui', async ({ page }) => {
  await startRoute(page);
  await page.waitForFunction(() => Number(document.querySelector('#route-session-mount')?.dataset.routeActiveMs) > 200);
  // A zero-active start deliberately creates no history row. A real pause with
  // nonzero time publishes a valid initial snapshot before the next checkpoint.
  await routeAction(page, 'pause').click(); await routeState(page, 'paused'); await saved(page);
  await routeAction(page, 'resume').click(); await routeState(page, 'running');
  const first = await exportUi(page); const initial = first.history.find(entry => entry.result.kind === 'route'); assert.ok(initial);
  const note = page.getByLabel('Заметка к практике', { exact: true }); const text = 'Черновик остаётся на месте при сохранении таймера.';
  await note.fill(text); await note.press('ArrowLeft'); await note.press('ArrowLeft');
  const caret = await note.evaluate(element => element.selectionStart);
  await delay(5500);
  assert.equal(await note.evaluate(element => document.activeElement === element), true, 'Autosave must not replace the focused draft field');
  assert.equal(await note.inputValue(), text); assert.equal(await note.evaluate(element => element.selectionStart), caret);
  assert.ok(await routeActive(page) >= 5000); await routeAction(page, 'stop').click(); await routeState(page, 'finished');
  const after = await exportUi(page); const entries = after.history.filter(entry => entry.result.kind === 'route'); assert.equal(entries.length, 1); assert.equal(entries[0].id, initial.id);
  assert.ok(entries[0].result.actualStepMs[0] >= 5000); assert.deepEqual(entries[0].result.actualStepMs.slice(1), [0, 0]);
  return { sameHistoryId: initial.id, observedCheckpointAfterMs: 5500, draftFocusAndCaretPreserved: true, entry: entries[0] };
});

check('native-hidden-tab-pauses-timed-route-and-return-requires-explicit-resume', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await startRoute(page); await page.waitForFunction(() => Number(document.querySelector('#route-session-mount')?.dataset.routeActiveMs) > 300, undefined, { polling: 100 });
  const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
  await page.waitForFunction(() => document.hidden && document.querySelector('#route-session-mount')?.dataset.routeState === 'paused', undefined, { polling: 100 });
  const paused = await routeActive(page); await delay(350); assert.equal(await routeActive(page), paused);
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden, undefined, { polling: 100 }); await delay(150);
  assert.equal(await page.locator('#route-session-mount').getAttribute('data-route-state'), 'paused');
  await routeAction(page, 'resume').click({ force: true }); await page.waitForFunction(() => document.querySelector('#route-session-mount')?.dataset.routeState === 'running', undefined, { polling: 100 });
  await page.waitForFunction(paused => Number(document.querySelector('#route-session-mount')?.dataset.routeActiveMs) > paused + 200, paused, { polling: 100 });
  await routeAction(page, 'stop').click({ force: true }); const persisted = await readNativeHistory(page); const entry = persisted.history.find(entry => entry.result.kind === 'route');
  assert.ok(entry); assert.equal(entry.result.events.find(event => event.type === 'pause').reason, 'hidden'); assert.equal(entry.result.events.filter(event => event.type === 'resume').length, 1);
  assert.ok(entry.result.actualStepMs.reduce((sum, value) => sum + value, 0) < 5000);
  return { actualDocumentHidden: true, pausedActiveMs: paused, automaticResumeClaimed: false, historyReadMethod: persisted.method, databaseVersion: persisted.databaseVersion, entry };
}));

check('native-hidden-tab-cancels-cue-and-requires-new-complete-listen', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await configure(page); await start(page); await beginListen(page); const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
  await page.waitForFunction(() => document.hidden && document.querySelector('[data-testid="ear-notice"]')?.textContent.includes('скрывалась'), undefined, { polling: 100 });
  await delay(100); assert.ok((await observation(page)).levels.every(level => level.rms < .000001));
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden, undefined, { polling: 100 });
  assert.ok(await choice(page, '1').isDisabled()); assert.equal(await page.getByTestId('ear-completed-listens').innerText(), '0');
  const oracle = await fullListen(page); await choice(page, oracle.degree).click(); await action(page, 'next').click(); const persisted = await readNativeHistory(page); const question = persisted.history[0].result.questions[0];
  assert.equal(question.listensCancelled, 1); assert.equal(question.listensCompleted, 1); return { oracle, actualDocumentHidden: true, newFullListenRequired: true, historyReadMethod: persisted.method, databaseVersion: persisted.databaseVersion, question, method: 'Separate Edge/CDP noDefaults:true, real tab activation; no synthetic visibility event' };
}));

await runEarBrowserChecks(checks);
