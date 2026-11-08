import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runAudioBrowserChecks } from './helpers/audio-browser-harness.mjs';

const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });
const snapshot = page => page.evaluate(() => window.p4.player.getSnapshot());
const sounded = (state, type = 'note') => state.trace.filter(event => event.type === type && !event.cancelled && event.time <= state.audioTime + 0.000001);
const offline = (page, config = {}, options = {}) => page.evaluate(async ({ config, options }) => window.p4.player.renderOffline(window.p4.makeConfig(config), options), { config, options });
const player = page => page.locator('#player-mount');
const action = (page, name) => page.locator(`[data-player-action="${name}"]`);

function near(actual, expected, tolerance = 0.02, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}, tolerance ${tolerance}`);
}
function onsets(actual, expected) {
  assert.equal(actual.length, expected.length, `PCM onset count; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  actual.forEach((value, index) => near(value, expected[index], 0.02, `PCM onset ${index}`));
}
function pcm(report, bass, click = []) {
  assert.equal(report.channels, 2); assert.equal(report.sampleRate, 44100);
  onsets(report.bass.onsets, bass); onsets(report.click.onsets, click);
  assert.ok(report.bass.peak > 0.01); assert.ok(report.bass.tailRms < 0.000001);
  if (click.length) assert.ok(report.click.peak > 0.01);
  assert.ok(report.click.tailRms < 0.000001);
}
async function fixtureConfig(page, config) {
  await page.evaluate(config => { window.p4.config = window.p4.makeConfig(config); }, config);
}
async function fixtureAction(page, name) {
  await page.locator(`#${name}`).click();
  await page.waitForFunction(name => window.p4.action?.name === name && window.p4.action.done, name);
  assert.equal((await page.evaluate(() => window.p4.action)).error, null);
}
async function waitSnapshot(page, predicate, arg, timeout = 7000) {
  await page.waitForFunction(({ source, arg }) => (new Function('state', 'arg', `return (${source})(state, arg)`))(window.p4.player.getSnapshot(), arg), { source: predicate.toString(), arg }, { polling: 5, timeout });
  return snapshot(page);
}
async function stateIs(page, state) {
  await page.waitForFunction(state => document.querySelector('#player-mount')?.dataset.playerState === state, state, { polling: 20, timeout: 7000 });
}
async function setupUi(page, { last = 3, bpm = 120, repeat = 'infinite', countIn = false, duration = 'quarter' } = {}) {
  await page.getByLabel('Тоника', { exact: true }).selectOption('C');
  await page.getByLabel('Структура', { exact: true }).selectOption('major');
  const maximum = page.getByLabel('Последний лад', { exact: true });
  await maximum.fill(String(last)); await maximum.press('Tab');
  for (const string of ['A', 'D', 'G']) await page.getByRole('checkbox', { name: `Струна ${string}`, exact: true }).uncheck();
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  await page.getByLabel('Материал последовательности', { exact: true }).selectOption('chromatic');
  await page.getByLabel('Темп, BPM', { exact: true }).fill(String(bpm));
  await page.getByLabel('Длительность нот', { exact: true }).selectOption(duration);
  await page.getByLabel('Повтор', { exact: true }).selectOption(repeat);
  await page.getByLabel('Отсчёт перед стартом', { exact: true }).setChecked(countIn);
}

check('offline-quarter-notes-use-real-PCM-and-finish-with-silence', 'api', async ({ page }) => {
  const result = await offline(page);
  pcm(result, [0, 0.5, 1, 1.5]); near(result.finishAt, 2, 0.0001);
  assert.deepEqual(result.trace.filter(event => event.type === 'note').map(event => event.positionId), ['E:0', 'E:1', 'E:3', 'E:5']);
  return result;
});

check('offline-four-quarter-count-in-precedes-eighth-notes', 'api', async ({ page }) => {
  const result = await offline(page, { countIn: true, duration: 'eighth' });
  pcm(result, [2, 2.25, 2.5, 2.75], [0, 0.5, 1, 1.5]); near(result.finishAt, 3, 0.0001);
  assert.equal(result.trace.filter(event => event.type === 'count-in').length, 4);
  return result;
});

check('offline-inclusive-ui-fragment-corresponds-to-engine-half-open-range', 'api', async ({ page }) => {
  const result = await offline(page, { range: { from: 1, toExclusive: 3 } });
  pcm(result, [0, 0.5]); near(result.finishAt, 1, 0.0001);
  assert.deepEqual(result.trace.filter(event => event.type === 'note').map(event => event.positionId), ['E:1', 'E:3']);
  return result;
});

check('offline-gap-two-sounding-bars-two-silent-bars-keeps-bass-pulse', 'api', async ({ page }) => {
  const result = await offline(page, { repeat: 'infinite', metronome: { enabled: true, mode: 'gap-2-2', subdivision: 'quarter' } }, { durationSeconds: 8 });
  onsets(result.bass.onsets, Array.from({ length: 16 }, (_, i) => i / 2));
  onsets(result.click.onsets, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.ok(result.bass.peak > 0.01); assert.ok(result.click.peak > 0.01);
  assert.equal(result.trace.filter(event => event.type === 'click' && !event.audible).length, 8);
  return result;
});

check('offline-two-and-four-ignores-sixteenth-subdivision', 'api', async ({ page }) => {
  const result = await offline(page, { metronome: { enabled: true, mode: 'two-four', subdivision: 'sixteenth' } });
  pcm(result, [0, 0.5, 1, 1.5], [0.5, 1.5]);
  return result;
});

check('offline-eighth-and-sixteenth-metronome-subdivisions', 'api', async ({ page }) => {
  const eighth = await offline(page, { metronome: { enabled: true, mode: 'all', subdivision: 'eighth' } });
  const sixteenth = await offline(page, { metronome: { enabled: true, mode: 'all', subdivision: 'sixteenth' } });
  pcm(eighth, [0, 0.5, 1, 1.5], [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
  pcm(sixteenth, [0, 0.5, 1, 1.5], Array.from({ length: 16 }, (_, i) => i / 8));
  return { eighth, sixteenth };
});

check('offline-tempo-ladder-six-passes-reaches-target-and-finishes', 'api', async ({ page }) => {
  const result = await offline(page, { range: { from: 0, toExclusive: 1 }, repeat: { kind: 'ladder', start: 60, end: 66, step: 3, repeatsPerTempo: 2 } });
  const expected = [0, 1, 2, 2 + 60 / 63, 2 + 120 / 63, 2 + 120 / 63 + 60 / 66];
  pcm(result, expected); assert.deepEqual(result.passBpms, [60, 60, 63, 63, 66, 66]);
  near(result.finishAt, 2 + 120 / 63 + 120 / 66, 0.0001); assert.equal(result.totalPasses, 6);
  return result;
});

check('offline-independent-bass-and-click-mutes-affect-PCM', 'api', async ({ page }) => {
  await page.evaluate(() => window.p4.player.setVolumes({ bass: 0, click: 0.5 }));
  const onlyClick = await offline(page, { metronome: { enabled: true } });
  onsets(onlyClick.bass.onsets, []); assert.equal(onlyClick.bass.peak, 0); onsets(onlyClick.click.onsets, [0, 0.5, 1, 1.5]);
  await page.evaluate(() => window.p4.player.setVolumes({ bass: 0.7, click: 0 }));
  const onlyBass = await offline(page, { metronome: { enabled: true } });
  onsets(onlyBass.bass.onsets, [0, 0.5, 1, 1.5]); onsets(onlyBass.click.onsets, []); assert.equal(onlyBass.click.peak, 0);
  return { onlyClick, onlyBass };
});

check('live-user-gesture-creates-real-nonzero-audio-output', 'api', async ({ page }) => {
  await fixtureConfig(page, { repeat: 'infinite' }); await fixtureAction(page, 'start');
  const live = await waitSnapshot(page, state => state.output.rms > 0.003 && state.positionId === 'E:0');
  assert.equal(live.contextState, 'running'); assert.ok(live.activeVoices > 0);
  await fixtureAction(page, 'stop'); await delay(150);
  const stopped = await snapshot(page); assert.equal(stopped.activeVoices, 0); assert.ok(stopped.output.rms < 0.000001);
  return { live, stopped };
});

check('live-cursor-does-not-jump-to-lookahead-note-before-audio-clock', 'api', async ({ page }) => {
  await fixtureConfig(page, { repeat: 'infinite' }); await fixtureAction(page, 'start');
  const rows = await page.evaluate(async () => {
    const rows = []; const started = performance.now();
    while (performance.now() - started < 1200) {
      const state = window.p4.player.getSnapshot();
      const notes = state.trace.filter(event => event.type === 'note' && !event.cancelled);
      rows.push({ time: state.audioTime, cursor: state.positionId,
        actual: notes.filter(event => event.time <= state.audioTime + 0.000001).at(-1)?.positionId ?? null,
        future: notes.filter(event => event.time > state.audioTime + 0.005).map(event => event.positionId) });
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return rows;
  });
  assert.ok(rows.some(row => row.future.length && row.future[0] !== row.cursor), 'No actual lookahead window was observed');
  for (const row of rows) assert.equal(row.cursor, row.actual, `Cursor at audioTime ${row.time}`);
  await fixtureAction(page, 'stop'); return rows;
});

check('live-fractional-pause-resume-preserves-grid-route-and-one-scheduler', 'api', async ({ page }) => {
  await fixtureConfig(page, { repeat: 'infinite' }); await fixtureAction(page, 'start');
  await waitSnapshot(page, state => state.transportBeat >= 1.7 && state.transportBeat < 2);
  await fixtureAction(page, 'pause'); const paused = await snapshot(page);
  assert.equal(paused.state, 'paused'); assert.ok(paused.transportBeat > 1 && paused.transportBeat < 2.2);
  await delay(200); const frozen = await snapshot(page);
  near(frozen.transportBeat, paused.transportBeat, 0.000001); assert.equal(frozen.positionId, paused.positionId); assert.ok(frozen.output.rms < 0.000001);
  await fixtureAction(page, 'resume');
  const resumed = await waitSnapshot(page, state => state.trace.filter(event => event.type === 'note' && !event.cancelled && event.time <= state.audioTime).length >= 6);
  const notes = sounded(resumed).slice(0, 6);
  assert.deepEqual(notes.map(event => event.absoluteGrid), [0, 4, 8, 12, 16, 20]);
  assert.deepEqual(notes.map(event => event.noteIndex), [0, 1, 2, 3, 0, 1]);
  assert.deepEqual(notes.map(event => event.positionId), ['E:0', 'E:1', 'E:3', 'E:5', 'E:0', 'E:1']);
  assert.equal(new Set(notes.map(event => event.absoluteGrid)).size, 6);
  assert.equal(sounded(resumed, 'count-in').length, 0); assert.notEqual(resumed.repeatId, null);
  await fixtureAction(page, 'stop');
  return { paused, frozen, resumed };
});

check('live-pause-during-count-in-does-not-repeat-count-or-skip-first-note', 'api', async ({ page }) => {
  await fixtureConfig(page, { countIn: true, repeat: 'infinite' }); await fixtureAction(page, 'start');
  await waitSnapshot(page, state => state.transportBeat > 0.25 && state.transportBeat < 0.8);
  await fixtureAction(page, 'pause'); await delay(120); await fixtureAction(page, 'resume');
  const result = await waitSnapshot(page, state => state.trace.filter(event => event.type === 'note' && !event.cancelled && event.time <= state.audioTime).length >= 2);
  assert.deepEqual(sounded(result, 'count-in').map(event => event.absoluteGrid), [0, 4, 8, 12]);
  assert.deepEqual(sounded(result).slice(0, 2).map(event => [event.absoluteGrid, event.positionId]), [[16, 'E:0'], [20, 'E:1']]);
  await fixtureAction(page, 'stop'); return result;
});

check('live-pause-before-future-start-preserves-all-four-count-in-clicks', 'api', async ({ page }) => {
  await fixtureConfig(page, { countIn: true, repeat: 'infinite' }); await fixtureAction(page, 'start-pause');
  const paused = await snapshot(page); assert.equal(paused.state, 'paused'); near(paused.transportBeat, 0, 0.000001);
  await delay(100); assert.equal((await snapshot(page)).output.rms, 0);
  await fixtureAction(page, 'resume');
  const result = await waitSnapshot(page, state => state.trace.some(event => event.type === 'note' && !event.cancelled && event.time <= state.audioTime));
  assert.deepEqual(sounded(result, 'count-in').map(event => event.absoluteGrid), [0, 4, 8, 12]);
  assert.deepEqual(sounded(result).map(event => [event.absoluteGrid, event.positionId]), [[16, 'E:0']]);
  await fixtureAction(page, 'stop'); return { paused, result };
});

check('live-manual-tempo-applies-on-future-quarter-after-loop', 'api', async ({ page }) => {
  await fixtureConfig(page, { repeat: 'infinite', range: { from: 0, toExclusive: 2 } }); await fixtureAction(page, 'start');
  await waitSnapshot(page, state => state.passIndex >= 1 && state.transportBeat > 2.2);
  const requested = await page.evaluate(() => window.p4.player.setBpm(90));
  const result = await waitSnapshot(page, state => state.trace.some(event => event.type === 'tempo' && event.bpm === 90 && !event.cancelled && event.time <= state.audioTime));
  const change = result.trace.find(event => event.type === 'tempo' && event.bpm === 90 && !event.cancelled);
  assert.ok(change.requestedAt >= requested.audioTime - 0.02); assert.ok(change.time >= change.requestedAt); assert.equal(change.absoluteGrid % 4, 0);
  await waitSnapshot(page, state => state.trace.filter(event => event.type === 'note' && event.bpm === 90 && !event.cancelled && event.time <= state.audioTime).length >= 3);
  const final = await snapshot(page); const notes = sounded(final).filter(event => event.bpm === 90).slice(0, 3);
  near(notes[1].time - notes[0].time, 2 / 3, 0.015); near(notes[2].time - notes[1].time, 2 / 3, 0.015);
  await fixtureAction(page, 'pause'); await page.evaluate(() => window.p4.player.setBpm(100)); await fixtureAction(page, 'resume');
  const afterPause = await waitSnapshot(page, state => state.output.rms > 0.003 && Math.abs(state.bpm - 100) < 0.01);
  await fixtureAction(page, 'stop'); return { requested, change, final, afterPause };
});

check('live-stop-cancels-lookahead-and-three-restarts-have-no-duplicate-notes', 'api', async ({ page }) => {
  await fixtureConfig(page, { repeat: 'infinite' }); const runs = [];
  for (let index = 0; index < 3; index++) {
    await fixtureAction(page, 'start');
    const running = await waitSnapshot(page, state => state.trace.filter(event => event.runId === state.runId && event.type === 'note' && !event.cancelled && event.time <= state.audioTime).length >= 3);
    const notes = sounded(running).filter(event => event.runId === running.runId);
    assert.deepEqual(notes.map(event => event.absoluteGrid), [0, 4, 8]);
    await fixtureAction(page, 'stop'); const stopped = await snapshot(page); await delay(180); const later = await snapshot(page);
    assert.equal(later.activeVoices, 0); assert.equal(later.repeatId, null); assert.equal(later.positionId, null); assert.ok(later.output.rms < 0.000001);
    assert.equal(sounded(later).filter(event => event.runId === running.runId).length, sounded(stopped).filter(event => event.runId === running.runId).length);
    runs.push({ runId: running.runId, grids: notes.map(event => event.absoluteGrid), stopped, later });
  }
  assert.equal(new Set(runs.map(run => run.runId)).size, 3); return runs;
});

check('live-finite-end-waits-for-actual-audio-time-and-clears-voices', 'api', async ({ page }) => {
  await fixtureConfig(page, { range: { from: 0, toExclusive: 1 }, bpm: 80 }); await fixtureAction(page, 'start');
  const finishing = await waitSnapshot(page, state => state.state === 'finishing');
  assert.ok(finishing.audioTime < finishing.finishAt); assert.equal(finishing.noteIndex, 0); assert.equal(finishing.positionId, 'E:0');
  const finished = await waitSnapshot(page, state => state.state === 'finished');
  assert.ok(finished.audioTime >= finishing.finishAt); assert.equal(finished.positionId, null); assert.equal(finished.repeatId, null);
  await delay(150); const tail = await snapshot(page); assert.equal(tail.activeVoices, 0); assert.ok(tail.output.rms < 0.000001);
  return { finishing, finished, tail };
});

check('ui-initial-controls-and-fragment-validation', 'ui', async ({ page }) => {
  await setupUi(page);
  assert.deepEqual(await page.getByTestId('sequence-route').locator('li').evaluateAll(nodes => nodes.map(node => node.dataset.sequencePosition)), ['E:0', 'E:1', 'E:2', 'E:3']);
  await page.getByLabel('Первая нота фрагмента', { exact: true }).fill('3');
  await page.getByLabel('Последняя нота фрагмента', { exact: true }).fill('2');
  await action(page, 'start').click();
  assert.match(await page.getByTestId('player-error').innerText(), /позже последней/i); assert.equal(await player(page).getAttribute('data-player-state'), 'stopped');
  await page.getByLabel('Первая нота фрагмента', { exact: true }).fill('2');
  await page.getByLabel('Последняя нота фрагмента', { exact: true }).fill('3');
  await action(page, 'start').click(); await stateIs(page, 'running');
  await page.waitForFunction(() => ['E:1', 'E:2'].includes(document.querySelector('#player-mount')?.dataset.currentPosition));
  const ids = await page.evaluate(async () => {
    const ids = new Set(); const started = performance.now();
    while (performance.now() - started < 1300) { const id = document.querySelector('#player-mount').dataset.currentPosition; if (id) ids.add(id); await new Promise(resolve => setTimeout(resolve, 15)); }
    return [...ids];
  });
  assert.deepEqual(ids.sort(), ['E:1', 'E:2']); await action(page, 'stop').click();
  return { rejectedReverseRange: true, playedInclusiveFragment: ids };
});

check('ui-highlight-matches-current-audio-frame-and-clears-on-pause-stop', 'ui', async ({ page, resultDir }) => {
  await setupUi(page, { bpm: 100 }); await action(page, 'start').click(); await stateIs(page, 'running');
  await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.currentPosition);
  const samples = await page.evaluate(async () => {
    const rows = []; const started = performance.now();
    while (performance.now() - started < 1500) {
      const host = document.querySelector('#player-mount');
      rows.push({ position: host.dataset.currentPosition, index: host.dataset.noteIndex,
        board: [...document.querySelectorAll('.position.is-playing')].map(node => node.dataset.position),
        route: [...document.querySelectorAll('.sequence-route li.is-playing')].map(node => [node.dataset.sequenceIndex, node.dataset.sequencePosition, node.getAttribute('aria-current')]) });
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    return rows;
  });
  const populated = samples.filter(row => row.position);
  assert.ok(new Set(populated.map(row => row.position)).size >= 3);
  for (const row of populated) { assert.deepEqual(row.board, [row.position]); assert.deepEqual(row.route, [[row.index, row.position, 'step']]); }
  await page.screenshot({ path: join(resultDir, 'p4-player-desktop.png'), fullPage: true });
  await action(page, 'pause').click(); await stateIs(page, 'paused');
  assert.equal(await page.locator('.is-playing').count(), 0); await action(page, 'stop').click(); await stateIs(page, 'stopped');
  assert.equal(await page.locator('.is-playing').count(), 0); return { samples: populated, screenshot: 'test-results/p4-player-desktop.png' };
});

check('ui-count-in-locks-structural-controls-and-manual-tempo-remains-available', 'ui', async ({ page }) => {
  await setupUi(page, { countIn: true }); await action(page, 'start').click(); await stateIs(page, 'running');
  assert.equal(await player(page).getAttribute('data-player-phase'), 'count-in');
  assert.equal(await page.locator('.is-playing').count(), 0); assert.match(await page.getByTestId('player-current-note').innerText(), /1.*2.*3.*4/);
  for (const label of ['Длительность нот', 'Повтор', 'Первая нота фрагмента', 'Последняя нота фрагмента', 'Отсчёт перед стартом', 'Показывать пульс', 'Метроном']) assert.ok(await page.getByLabel(label, { exact: true }).isDisabled(), label);
  assert.ok(await page.getByLabel('Темп, BPM', { exact: true }).isEnabled()); assert.ok(await page.getByLabel('Громкость баса', { exact: true }).isEnabled());
  await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.playerPhase === 'practice');
  await page.getByLabel('Темп, BPM', { exact: true }).fill('150'); await page.getByLabel('Темп, BPM', { exact: true }).press('Tab');
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#player-mount')?.dataset.currentBpm) - 150) < 0.01);
  await action(page, 'pause').click(); await stateIs(page, 'paused'); assert.ok(await page.getByLabel('Длительность нот', { exact: true }).isDisabled());
  await action(page, 'resume').click(); await stateIs(page, 'running'); assert.equal(await player(page).getAttribute('data-player-phase'), 'practice');
  await action(page, 'stop').click(); assert.ok(await page.getByLabel('Длительность нот', { exact: true }).isEnabled());
  return { countIn: true, lockedUntilStop: true, tempoChanged: 150, resumedWithoutNewCountIn: true };
});

check('ui-pulse-off-removes-counters-current-note-and-both-highlights', 'ui', async ({ page }) => {
  await setupUi(page); await page.getByLabel('Показывать пульс', { exact: true }).uncheck();
  await action(page, 'start').click(); await stateIs(page, 'running');
  await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.currentPosition);
  assert.equal(await page.getByTestId('player-current-note').innerText(), '—');
  assert.equal(await page.getByTestId('player-status').innerText(), 'Практика без визуальных подсказок');
  assert.equal(await page.locator('.is-playing').count(), 0); assert.doesNotMatch(await page.getByTestId('player-status').innerText(), /такт|доля|повтор|BPM/);
  await action(page, 'stop').click(); return { noVisualPulse: true };
});

check('ui-tempo-ladder-validation-ownership-and-finite-completion', 'ui', async ({ page }) => {
  await setupUi(page, { last: 0, repeat: 'ladder', duration: 'sixteenth' });
  await page.getByLabel('Начальный темп', { exact: true }).fill('200');
  await page.getByLabel('Целевой темп', { exact: true }).fill('190');
  await action(page, 'start').click(); assert.match(await page.getByTestId('player-error').innerText(), /не меньше начального/);
  await page.getByLabel('Целевой темп', { exact: true }).fill('220');
  await page.getByLabel('Шаг темпа', { exact: true }).fill('10'); await page.getByLabel('Повторов на темп', { exact: true }).fill('2');
  await page.getByLabel('Повторов на темп', { exact: true }).press('Tab');
  assert.ok(await page.getByLabel('Темп, BPM', { exact: true }).isDisabled()); assert.equal(await page.getByLabel('Темп, BPM', { exact: true }).inputValue(), '200');
  await action(page, 'start').click(); await stateIs(page, 'running'); assert.ok(await page.getByLabel('Темп, BPM', { exact: true }).isDisabled());
  await stateIs(page, 'finished'); assert.match(await page.getByTestId('player-status').innerText(), /завершены/); assert.equal(await page.locator('.is-playing').count(), 0);
  return { manualTempoDisabled: true, completedThreeTemposTwoPassesEach: true };
});

check('ui-metronome-modes-subdivision-and-live-volume-controls', 'ui', async ({ page }) => {
  await setupUi(page); await page.getByLabel('Рисунок метронома', { exact: true }).selectOption('two-four');
  assert.ok(await page.getByLabel('Деление метронома', { exact: true }).isDisabled()); assert.match(await page.getByTestId('player-metronome-help').innerText(), /2 и 4/);
  await page.getByLabel('Рисунок метронома', { exact: true }).selectOption('gap-2-2');
  assert.ok(await page.getByLabel('Деление метронома', { exact: true }).isEnabled());
  await page.getByLabel('Деление метронома', { exact: true }).selectOption('sixteenth');
  await page.getByLabel('Метроном', { exact: true }).uncheck(); assert.ok(await page.getByLabel('Рисунок метронома', { exact: true }).isDisabled());
  await action(page, 'start').click(); await stateIs(page, 'running');
  for (const label of ['Громкость баса', 'Громкость метронома']) { await page.getByLabel(label, { exact: true }).fill('0'); await page.getByLabel(label, { exact: true }).dispatchEvent('input'); }
  assert.deepEqual(await page.locator('[data-player-output]').allTextContents(), ['0%', '0%']);
  await page.getByLabel('Громкость баса', { exact: true }).fill('70'); await page.getByLabel('Громкость баса', { exact: true }).dispatchEvent('input');
  assert.deepEqual(await page.locator('[data-player-output]').allTextContents(), ['70%', '0%']);
  await action(page, 'stop').click(); return { twoFourLocksSubdivision: true, gapAcceptsSubdivision: true, independentLiveVolumes: true };
});

check('ui-keyboard-space-escape-and-input-button-guards', 'ui', async ({ page }) => {
  await setupUi(page); const bpm = page.getByLabel('Темп, BPM', { exact: true });
  await bpm.focus(); await bpm.press('Space'); assert.equal(await player(page).getAttribute('data-player-state'), 'stopped');
  await page.getByTestId('player-status').click(); await page.keyboard.press('Space'); await stateIs(page, 'running');
  await bpm.focus(); await bpm.press('Escape'); assert.equal(await player(page).getAttribute('data-player-state'), 'running');
  await action(page, 'pause').focus(); await page.keyboard.press('Escape'); assert.equal(await player(page).getAttribute('data-player-state'), 'running');
  await page.getByTestId('player-status').click(); await page.keyboard.press('Space'); await stateIs(page, 'paused');
  await page.keyboard.press('Space'); await stateIs(page, 'running'); await page.keyboard.press('Escape'); await stateIs(page, 'stopped');
  return { keyboardStartPauseResumeStop: true, guardedInputAndButton: true };
});

check('ui-changing-scope-or-route-and-leaving-sequence-stops-playback', 'ui', async ({ page }) => {
  await setupUi(page); await action(page, 'start').click(); await stateIs(page, 'running');
  await page.getByLabel('Порядок последовательности', { exact: true }).selectOption('descending'); await stateIs(page, 'stopped');
  assert.match(await page.getByTestId('player-notice').innerText(), /изменились|остановлено/); assert.equal(await page.getByLabel('Первая нота фрагмента', { exact: true }).inputValue(), '1');
  await action(page, 'start').click(); await stateIs(page, 'running');
  await page.getByLabel('Тоника', { exact: true }).selectOption('G'); await stateIs(page, 'stopped');
  await action(page, 'start').click(); await stateIs(page, 'running');
  await page.getByRole('button', { name: 'Изучение', exact: true }).click(); assert.ok(await player(page).isHidden());
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click(); await stateIs(page, 'stopped');
  assert.equal(await page.locator('.is-playing').count(), 0); return { stoppedOnRouteScopeAndModeChange: true };
});

check('ui-invalid-global-range-cannot-start-stale-valid-sequence', 'ui', async ({ page }) => {
  await setupUi(page); await action(page, 'start').click(); await stateIs(page, 'running');
  await page.getByLabel('Первый лад', { exact: true }).fill('5'); await page.getByLabel('Первый лад', { exact: true }).press('Tab');
  await stateIs(page, 'stopped'); assert.ok(await action(page, 'start').isDisabled());
  assert.equal(await page.getByTestId('sequence-route').count(), 0); assert.equal(await page.locator('.is-playing').count(), 0);
  return { invalidRangeRemovesPlayableRoute: true };
});

check('ui-small-viewport-player-remains-usable-with-contained-fretboard-scroll', 'ui', async ({ page, resultDir }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setupUi(page);
  await action(page, 'start').click(); await stateIs(page, 'running'); await action(page, 'pause').click(); await stateIs(page, 'paused');
  await page.screenshot({ path: join(resultDir, 'p4-player-narrow.png'), fullPage: true });
  await action(page, 'stop').click();
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(width.scroll <= width.client + 2, `Unexpected document overflow ${JSON.stringify(width)}`);
  return { width, screenshot: 'test-results/p4-player-narrow.png', fullMobileSupportClaimed: false };
});

check('native-tab-hiding-pauses-product-and-return-requires-explicit-resume', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await setupUi(page); await action(page, 'start').click({ force: true });
  await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.playerState === 'running', undefined, { polling: 100 });
  assert.equal(await page.evaluate(() => document.hidden), false);
  const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
  await page.waitForFunction(() => document.hidden && document.querySelector('#player-mount')?.dataset.playerState === 'paused', undefined, { polling: 100, timeout: 6000 });
  const notice = await page.getByTestId('player-notice').innerText(); assert.match(notice, /скрыта|паузе/);
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden, undefined, { polling: 100 });
  await delay(200); assert.equal(await player(page).getAttribute('data-player-state'), 'paused');
  assert.match(await page.getByTestId('player-status').innerText(), /скрывалась/);
  await action(page, 'resume').click({ force: true });
  await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.playerState === 'running', undefined, { polling: 100 });
  await action(page, 'stop').click({ force: true });
  return { nativeDocumentHidden: true, notice, remainedPausedOnReturn: true, explicitResume: true, method: 'Isolated Edge, connectOverCDP(noDefaults:true), actual tab activation; no synthetic visibility events or patched document.hidden' };
}));

await runAudioBrowserChecks(checks);
