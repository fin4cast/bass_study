import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runHarmonyBrowserChecks } from './helpers/harmony-browser-harness.mjs';

const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });
const near = (actual, expected, tolerance, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}, tolerance ${tolerance}`);
const BASS_MIDI = [36, 40, 43, 40, 29, 33, 36, 33, 31, 35, 38, 35, 36, 40, 43, 40];
const BASS_HZ = [65.4063913251, 82.4068892282, 97.9988589954, 82.4068892282, 43.6535289291, 55, 65.4063913251, 55, 48.9994294977, 61.7354126570, 73.4161919794, 61.7354126570, 65.4063913251, 82.4068892282, 97.9988589954, 82.4068892282];
const BASS_NAMES = ['C2', 'E2', 'G2', 'E2', 'F1', 'A1', 'C2', 'A1', 'G1', 'B1', 'D2', 'B1', 'C2', 'E2', 'G2', 'E2'];
const BASS_POSITIONS = ['E:8', 'E:12', 'A:10', 'E:12', 'E:1', 'E:5', 'E:8', 'E:5', 'E:3', 'E:7', 'E:10', 'E:7', 'E:8', 'E:12', 'A:10', 'E:12'];
const snap = page => page.evaluate(() => window.p7harmony.player.getSnapshot());
const render = (page, overrides = {}, options = {}) => page.evaluate(({ overrides, options }) => window.p7harmony.render(overrides, options), { overrides, options });
// JS strict equality distinguishes -0 from 0; adding 0 canonicalizes only that
// identical musical origin, while all quarter-grid expectations stay exact.
const regular = (state, type) => state.trace.filter(event => event.type === type && !event.cancelled && !event.continuation && event.time <= state.audioTime + .000001);
const act = (page, name) => page.locator(`[data-harmony-action="${name}"]`);
async function fixtureAction(page, name) {
  await page.locator(`#${name}`).click(); await page.waitForFunction(name => window.p7harmony.action?.name === name && window.p7harmony.action.done, name);
  assert.equal((await page.evaluate(() => window.p7harmony.action)).error, null);
}
async function configureFixture(page, value) { await page.evaluate(value => { window.p7harmony.current = window.p7harmony.makeConfig(value); }, value); }
async function waitSnapshot(page, predicate, argument, timeout = 9000) {
  await page.waitForFunction(({ source, argument }) => (new Function('state', 'argument', `return (${source})(state, argument)`))(window.p7harmony.player.getSnapshot(), argument), { source: predicate.toString(), argument }, { polling: 5, timeout }); return snap(page);
}
function onsets(actual, expected) { assert.equal(actual.length, expected.length, `Expected PCM onsets ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); actual.forEach((value, index) => near(value, expected[index], .02, `PCM onset ${index}`)); }
function finitePcm(result) { assert.equal(result.channels, 3); assert.equal(result.sampleRate, 44100); for (const source of ['bass', 'pad', 'click']) assert.ok(result[source].tailRms < .000001, `${source} tail`); }
async function ready(page) { await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert); const free = page.locator('[data-intro="free"]'); if (await free.isVisible()) await free.click(); }
async function stateIs(page, state) { await page.waitForFunction(state => document.querySelector('#harmony-mount')?.dataset.harmonyState === state, state, { polling: 20, timeout: 9000 }); }
async function setupUi(page, { bpm = 120, countIn = false, repeat = 'infinite' } = {}) {
  await ready(page); await page.locator('[data-app-module="harmony"]').click();
  await page.getByLabel('Темп сопровождения', { exact: true }).fill(String(bpm)); await page.getByLabel('Темп сопровождения', { exact: true }).press('Tab');
  await page.getByLabel('Повтор сопровождения', { exact: true }).selectOption(repeat); await page.getByLabel('Отсчёт сопровождения', { exact: true }).setChecked(countIn);
}
async function saved(page) { await page.waitForFunction(() => document.querySelector('[data-testid="history-save-status"]')?.dataset.status === 'saved'); }
async function openHistory(page) { await ready(page); const drawer = page.locator('.history-drawer'); if (!await drawer.evaluate(element => element.open)) await page.locator('#open-history').click(); await page.getByLabel('Название пресета', { exact: true }).waitFor(); }
async function exportUi(page) { await openHistory(page); const downloading = page.waitForEvent('download'); await page.locator('[data-history-action="export"]').click(); const download = await downloading; return JSON.parse(await readFile(await download.path(), 'utf8')); }

check('pcm-four-bars-have-sixteen-independent-bass-pitches-clicks-and-pad-triads', 'api', async ({ page }) => {
  const result = await render(page); finitePcm(result); near(result.duration, 8.1, .0001);
  onsets(result.bass.onsets, Array.from({ length: 16 }, (_, i) => i / 2)); onsets(result.click.onsets, Array.from({ length: 16 }, (_, i) => i / 2));
  assert.equal(result.bass.noteHz.length, 16); result.bass.noteHz.forEach((value, index) => near(value, BASS_HZ[index], .15, BASS_NAMES[index]));
  assert.equal(result.pad.bars.length, 4); for (const bar of result.pad.bars) { assert.ok(bar.rms > .03); assert.ok(bar.amplitudes.every(amplitude => amplitude > .025), JSON.stringify(bar)); assert.ok(bar.nonChordFSharp3 < .006); }
  return result;
});

check('pcm-four-quarter-count-in-precedes-all-three-practice-voices', 'api', async ({ page }) => {
  const result = await render(page, { countIn: true }); finitePcm(result); near(result.duration, 10.1, .0001);
  onsets(result.bass.onsets, Array.from({ length: 16 }, (_, i) => 2 + i / 2)); onsets(result.click.onsets, Array.from({ length: 20 }, (_, i) => i / 2));
  near(result.pad.onsets[0], 2, .02); assert.equal(result.click.countInPeaks.length, 4); assert.ok(result.click.countInPeaks[0] > result.click.countInPeaks[1] * 1.3);
  return result;
});

check('pcm-infinite-loop-crosses-two-cycle-boundaries-without-count-in-or-extra-note', 'api', async ({ page }) => {
  const result = await render(page, { repeat: 'infinite' }, { durationSeconds: 16 });
  onsets(result.bass.onsets, Array.from({ length: 32 }, (_, i) => i / 2)); onsets(result.click.onsets, Array.from({ length: 32 }, (_, i) => i / 2));
  assert.equal(result.bass.onsets.filter(time => Math.abs(time - 8) < .02).length, 1);
  for (let i = 0; i < 32; i++) near(result.bass.noteHz[i], BASS_HZ[i % 16], .15); assert.equal(result.pad.bars.length, 8);
  return result;
});

check('pcm-initial-mutes-isolate-bass-pad-and-click-channels', 'api', async ({ page }) => {
  const results = {};
  for (const source of ['bass', 'pad', 'click']) {
    const result = await render(page, { muted: { [source]: true } }); finitePcm(result); assert.equal(result[source].peak, 0); assert.equal(result[source].rms, 0);
    for (const other of ['bass', 'pad', 'click'].filter(value => value !== source)) assert.ok(result[other].peak > .01);
    results[source] = result;
  }
  return results;
});

check('pcm-mid-cycle-mixer-controls-do-not-restart-other-voices', 'api', async ({ page }) => {
  const result = await render(page, {}, { controls: [{ time: 2, source: 'pad', muted: true }, { time: 4, source: 'pad', muted: false }, { time: 4, source: 'bass', volume: 0 }, { time: 6, source: 'bass', volume: .7 }] });
  finitePcm(result); onsets(result.bass.onsets, [...Array.from({ length: 8 }, (_, i) => i / 2), 6, 6.5, 7, 7.5]);
  onsets(result.click.onsets, Array.from({ length: 16 }, (_, i) => i / 2)); assert.equal(result.pad.bars[1].rms, 0); assert.ok(result.pad.bars[0].rms > .03 && result.pad.bars[2].rms > .03);
  return result;
});

check('live-actual-audio-clock-drives-position-rather-than-lookahead', 'api', async ({ page }) => {
  await configureFixture(page, { repeat: 'infinite' }); await fixtureAction(page, 'start');
  await waitSnapshot(page, state => state.output.rms > .01 && state.positionId !== null);
  const rows = await page.evaluate(async () => {
    const rows = [], started = performance.now();
    while (performance.now() - started < 1300) {
      const state = window.p7harmony.player.getSnapshot(); const audible = state.trace.filter(event => event.type === 'bass' && !event.cancelled && !event.continuation && event.time <= state.audioTime + .000001);
      rows.push({ audioTime: state.audioTime, position: state.positionId, actualBeat: audible.at(-1)?.transportBeat ?? null, futureBass: state.trace.filter(event => event.type === 'bass' && !event.cancelled && !event.continuation && event.time > state.audioTime + .005).map(event => event.transportBeat) });
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return rows;
  });
  assert.ok(rows.some(row => row.futureBass.length)); for (const row of rows.filter(row => row.actualBeat !== null)) assert.equal(row.position, BASS_POSITIONS[row.actualBeat % 16]);
  await fixtureAction(page, 'stop'); await delay(100); const stopped = await snap(page); assert.equal(stopped.activeVoices, 0); assert.ok(stopped.output.rms < .000001); return { rows, stopped };
});

check('live-fractional-pause-restores-tails-and-continues-regular-quarter-grid', 'api', async ({ page }) => {
  await configureFixture(page, { repeat: 'infinite' }); await fixtureAction(page, 'start'); await waitSnapshot(page, state => state.transportBeat >= 1.65 && state.transportBeat < 2);
  await fixtureAction(page, 'pause'); const paused = await snap(page); assert.equal(paused.state, 'paused'); assert.ok(paused.transportBeat > 1 && paused.transportBeat < 2.2);
  await delay(150); const frozen = await snap(page); near(frozen.transportBeat, paused.transportBeat, .000001); assert.ok(frozen.output.rms < .000001);
  await fixtureAction(page, 'resume'); const resumed = await waitSnapshot(page, state => state.trace.filter(event => event.type === 'bass' && !event.cancelled && !event.continuation && event.time <= state.audioTime).length >= 6);
  const bass = regular(resumed, 'bass').slice(0, 6); assert.deepEqual(bass.map(event => event.transportBeat + 0), [0, 1, 2, 3, 4, 5]); assert.deepEqual(bass.map(event => event.midi), BASS_MIDI.slice(0, 6));
  assert.ok(resumed.trace.some(event => event.type === 'pad' && event.continuation && !event.cancelled)); assert.equal(regular(resumed, 'click').filter(event => event.phase === 'count-in').length, 0);
  await fixtureAction(page, 'stop'); return { paused, frozen, resumed };
});

check('live-pause-before-future-start-keeps-all-four-count-in-beats', 'api', async ({ page }) => {
  await configureFixture(page, { countIn: true, repeat: 'infinite' }); await fixtureAction(page, 'start-pause'); const paused = await snap(page); assert.equal(paused.state, 'paused'); near(paused.transportBeat, 0, .000001);
  await fixtureAction(page, 'resume'); const resumed = await waitSnapshot(page, state => state.trace.filter(event => event.type === 'bass' && !event.cancelled && !event.continuation && event.time <= state.audioTime).length >= 2);
  assert.deepEqual(regular(resumed, 'click').filter(event => event.phase === 'count-in').map(event => event.transportBeat + 0), [0, 1, 2, 3]);
  assert.deepEqual(regular(resumed, 'bass').slice(0, 2).map(event => [event.transportBeat + 0, event.midi]), [[4, 36], [5, 40]]);
  await fixtureAction(page, 'stop'); return { paused, resumed };
});

check('live-three-restarts-and-stop-leave-no-active-or-future-audible-voices', 'api', async ({ page }) => {
  await configureFixture(page, { repeat: 'infinite' }); const runs = [];
  for (let index = 0; index < 3; index++) {
    await fixtureAction(page, 'start'); const running = await waitSnapshot(page, state => state.trace.filter(event => event.type === 'bass' && !event.cancelled && !event.continuation && event.time <= state.audioTime).length >= 3);
    assert.deepEqual(regular(running, 'bass').map(event => event.transportBeat + 0), [0, 1, 2]);
    await fixtureAction(page, 'stop'); const stopped = await snap(page); await delay(150); const later = await snap(page);
    assert.equal(later.activeVoices, 0); assert.equal(later.positionId, null); assert.ok(later.output.rms < .000001); assert.equal(regular(later, 'bass').length, regular(stopped, 'bass').length); runs.push({ runId: running.runId, stopped, later });
  }
  assert.equal(new Set(runs.map(run => run.runId)).size, 3); return runs;
});

check('live-finite-ending-waits-for-actual-clock-with-last-chord-visible', 'api', async ({ page }) => {
  await configureFixture(page, { bpm: 220 }); await fixtureAction(page, 'start'); const finishing = await waitSnapshot(page, state => state.state === 'finishing');
  assert.ok(finishing.audioTime < finishing.finishAt); assert.equal(finishing.chordIndex, 3); assert.equal(finishing.positionId, 'E:12');
  const finished = await waitSnapshot(page, state => state.state === 'finished'); assert.ok(finished.audioTime >= finishing.finishAt); assert.equal(finished.positionId, null); assert.equal(finished.activeVoices, 0);
  await delay(100); assert.ok((await snap(page)).output.rms < .000001); return { finishing, finished };
});

check('live-delayed-main-thread-pauses-instead-of-bursting-missed-quarters', 'api', async ({ page }) => {
  await configureFixture(page, { repeat: 'infinite' }); await fixtureAction(page, 'start'); await waitSnapshot(page, state => state.transportBeat > .25 && state.transportBeat < .7);
  await page.evaluate(() => { const until = performance.now() + 750; while (performance.now() < until) { /* intentionally block this isolated test page */ } });
  const paused = await waitSnapshot(page, state => state.state === 'paused'); assert.equal(paused.pauseReason, 'timing');
  const bass = regular(paused, 'bass'); assert.ok(bass.length <= 2); assert.equal(new Set(bass.map(event => event.transportBeat)).size, bass.length);
  await delay(100); assert.ok((await snap(page)).output.rms < .000001); await fixtureAction(page, 'resume'); const resumed = await waitSnapshot(page, state => state.output.rms > .005); assert.equal(resumed.state, 'running'); await fixtureAction(page, 'stop'); return { deliberatelyBlockedMs: 750, paused, resumed };
});

check('live-mixer-changes-preserve-run-and-musical-time', 'api', async ({ page }) => {
  await configureFixture(page, { repeat: 'infinite' }); await fixtureAction(page, 'start'); const before = await waitSnapshot(page, state => state.output.rms > .02);
  await page.evaluate(() => window.p7harmony.player.setMix({ muted: { bass: true, pad: true, click: true } })); await delay(150); const silent = await snap(page); assert.ok(silent.output.rms < .000001); assert.equal(silent.runId, before.runId); assert.ok(silent.transportBeat > before.transportBeat);
  await page.evaluate(() => window.p7harmony.player.setMix({ muted: { pad: false } })); const pad = await waitSnapshot(page, state => state.output.rms > .005); assert.equal(pad.runId, before.runId); assert.ok(pad.transportBeat > silent.transportBeat); await fixtureAction(page, 'stop'); return { before, silent, pad };
});

check('ui-four-chords-and-sixteen-bass-notes-use-independent-musical-fixture', 'ui', async ({ page }) => {
  await setupUi(page); assert.deepEqual(await page.locator('[data-harmony-chord] > strong').allTextContents(), ['C', 'F', 'G', 'C']);
  assert.deepEqual(await page.locator('[data-harmony-note] > strong').allTextContents(), BASS_NAMES);
  assert.deepEqual(await page.locator('[data-harmony-note] > span').allTextContents(), Array.from({ length: 4 }, () => ['1', '3', '5', '3']).flat());
  assert.deepEqual(await page.locator('.harmony-function').allTextContents(), ['Тоника · T', 'Субдоминанта · S', 'Доминанта · D', 'Тоника · T']);
  assert.match(await page.locator('.harmony-preview h3').innerText(), /Основной тон аккорда/);
  await page.locator('.harmony-learning > summary').click();
  assert.match(await page.locator('.harmony-learning').innerText(), /Am–Dm–Em.*E использует G♯/s);
  assert.match(await page.locator('.harmony-learning').innerText(), /не добавляет.*отсутствующие звуки/);
  assert.deepEqual(await page.locator('[data-harmony-note] > strong').allTextContents(), BASS_NAMES);
  assert.match(await page.locator('#harmony-mount').innerText(), /нет автоматической оценки/); return { chords: ['C', 'F', 'G', 'C'], bassNotes: BASS_NAMES };
});

check('ui-count-in-locks-clock-settings-but-leaves-live-mixer-available', 'ui', async ({ page }) => {
  await setupUi(page, { countIn: true }); await act(page, 'start').click(); await stateIs(page, 'running'); assert.equal(await page.locator('#harmony-mount').getAttribute('data-harmony-phase'), 'count-in');
  assert.equal(await page.locator('#harmony-mount .is-playing').count(), 0); for (const label of ['Темп сопровождения', 'Повтор сопровождения', 'Отсчёт сопровождения']) assert.ok(await page.getByLabel(label, { exact: true }).isDisabled());
  await page.getByLabel('Выключить бас сопровождения', { exact: true }).check(); await page.getByLabel('Громкость аккордов сопровождения', { exact: true }).fill('30');
  assert.ok(await page.getByLabel('Громкость метронома сопровождения', { exact: true }).isEnabled());
  await page.waitForFunction(() => document.querySelector('#harmony-mount')?.dataset.harmonyPhase === 'practice'); await act(page, 'pause').click(); await stateIs(page, 'paused');
  assert.equal(await page.locator('#harmony-mount .is-playing').count(), 0); await act(page, 'resume').click(); await stateIs(page, 'running'); assert.equal(await page.locator('#harmony-mount').getAttribute('data-harmony-phase'), 'practice');
  await act(page, 'stop').click(); assert.ok(await page.getByLabel('Темп сопровождения', { exact: true }).isEnabled()); return { countIn: 4, noHighlightDuringCountIn: true, mixerAvailable: true, resumedWithoutNewCountIn: true };
});

check('ui-chord-note-highlight-follows-current-frame-and-finite-finish-clears-it', 'ui', async ({ page, resultDir }) => {
  await setupUi(page, { bpm: 220, repeat: 'once' }); await act(page, 'start').click(); await stateIs(page, 'running');
  const samples = await page.evaluate(async () => {
    const rows = [], started = performance.now(); while (performance.now() - started < 1600) {
      const host = document.querySelector('#harmony-mount'); rows.push({ chord: host.dataset.harmonyChord, beat: Number(host.dataset.harmonyBeat), chords: [...host.querySelectorAll('[data-harmony-chord].is-playing')].map(node => node.dataset.harmonyChord), notes: [...host.querySelectorAll('[data-harmony-note].is-playing')].map(node => Number(node.dataset.harmonyNote)) }); await new Promise(resolve => setTimeout(resolve, 10));
    } return rows;
  });
  const active = samples.filter(row => row.chord !== ''); assert.ok(new Set(active.flatMap(row => row.notes)).size >= 4);
  for (const row of active) { assert.deepEqual(row.chords, [row.chord]); assert.deepEqual(row.notes, [Number(row.chord) * 4 + row.beat - 1]); }
  await page.screenshot({ path: join(resultDir, 'p7-harmony-desktop.png'), fullPage: true }); await stateIs(page, 'finished'); assert.equal(await page.locator('#harmony-mount .is-playing').count(), 0); return { samples: active, screenshot: 'test-results/p7-harmony-desktop.png' };
});

check('ui-keyboard-space-escape-respect-input-and-button-guards', 'ui', async ({ page }) => {
  await setupUi(page); await page.getByLabel('Темп сопровождения', { exact: true }).focus(); await page.keyboard.press('Space'); assert.equal(await page.locator('#harmony-mount').getAttribute('data-harmony-state'), 'stopped');
  await page.getByTestId('harmony-status').click(); await page.keyboard.press('Space'); await stateIs(page, 'running');
  await page.getByLabel('Громкость баса сопровождения', { exact: true }).focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('#harmony-mount').getAttribute('data-harmony-state'), 'running');
  await act(page, 'pause').focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('#harmony-mount').getAttribute('data-harmony-state'), 'running');
  await page.getByTestId('harmony-status').click(); await page.keyboard.press('Space'); await stateIs(page, 'paused'); await page.keyboard.press('Space'); await stateIs(page, 'running'); await page.keyboard.press('Escape'); await stateIs(page, 'stopped'); return { keyboardStartPauseResumeStop: true, guards: ['input', 'button'] };
});

check('ui-harmony-preferences-preset-reload-and-json-restore-are-exact', 'ui', async ({ page }) => {
  await setupUi(page, { bpm: 96 });
  for (const [source, value] of [['bass', 40], ['pad', 30], ['click', 20]]) await page.locator(`[data-harmony-setting="${source}Volume"]`).fill(String(value));
  await page.getByLabel('Выключить бас сопровождения', { exact: true }).check(); await page.getByLabel('Выключить метроном сопровождения', { exact: true }).check(); await saved(page); await openHistory(page);
  await page.getByLabel('Название пресета', { exact: true }).fill('Три голоса'); await page.locator('[data-history-action="save-preset"]').click(); await page.getByTestId('preset-list').getByText('Три голоса', { exact: true }).waitFor();
  const before = await exportUi(page); assert.equal(before.schemaVersion, 6); assert.deepEqual(before.preferences.harmony, { bpm: 96, countIn: false, repeat: 'infinite', bassVolume: 40, padVolume: 30, clickVolume: 20, bassMuted: true, padMuted: false, clickMuted: true });
  await page.reload(); await ready(page); assert.ok(await page.locator('#harmony-mount').isVisible()); assert.equal(await page.locator('#harmony-mount').getAttribute('data-harmony-state'), 'stopped'); assert.equal(await page.getByLabel('Темп сопровождения', { exact: true }).inputValue(), '96');
  await page.getByLabel('Темп сопровождения', { exact: true }).fill('120'); await page.getByLabel('Темп сопровождения', { exact: true }).press('Tab'); await openHistory(page); await page.getByTestId('preset-list').getByRole('button', { name: 'Применить', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Темп сопровождения"]')?.value === '96');
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles({ name: 'harmony-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(before)) }); await page.getByTestId('backup-preview').waitFor();
  await page.getByRole('checkbox', { name: 'Понимаю, что текущие данные будут заменены', exact: true }).check(); await page.locator('[data-history-action="confirm-restore"]').click(); await page.getByTestId('backup-preview').waitFor({ state: 'detached' }); assert.deepEqual(await exportUi(page), before); return { harmonyPreferences: before.preferences.harmony, presetApplied: true, roundtripExact: true };
});

check('ui-invalid-bpm-recovers-and-narrow-layout-retains-controls', 'ui', async ({ page, resultDir }) => {
  await setupUi(page); await page.getByLabel('Темп сопровождения', { exact: true }).fill('300'); await act(page, 'start').click(); assert.match(await page.getByTestId('harmony-error').innerText(), /40.*220/); assert.equal(await page.locator('#harmony-mount').getAttribute('data-harmony-state'), 'stopped');
  await page.getByLabel('Темп сопровождения', { exact: true }).fill('120'); await page.getByLabel('Темп сопровождения', { exact: true }).press('Tab'); await page.setViewportSize({ width: 390, height: 844 }); await act(page, 'start').click(); await stateIs(page, 'running'); await act(page, 'pause').click(); await stateIs(page, 'paused');
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth })); assert.ok(width.page <= width.viewport + 2); await page.screenshot({ path: join(resultDir, 'p7-harmony-narrow.png'), fullPage: true }); await act(page, 'stop').click(); return { width, recovered: true, screenshot: 'test-results/p7-harmony-narrow.png' };
});

check('ui-timing-pause-is-explained-and-module-exit-stops-playback', 'ui', async ({ page }) => {
  await setupUi(page); await act(page, 'start').click(); await stateIs(page, 'running');
  await page.evaluate(() => { const until = performance.now() + 750; while (performance.now() < until) { /* intentionally delay scheduling */ } });
  await stateIs(page, 'paused'); assert.match(await page.getByTestId('harmony-status').innerText(), /задержал расписание/); await act(page, 'resume').click(); await stateIs(page, 'running');
  await page.locator('[data-app-module="ear"]').click(); assert.equal(await page.locator('#harmony-mount').getAttribute('data-harmony-state'), 'stopped');
  await page.locator('[data-app-module="harmony"]').click(); await stateIs(page, 'stopped'); assert.equal(await page.locator('#harmony-mount .is-playing').count(), 0); return { deliberateBusyMs: 750, explicitTimingPause: true, stoppedOnExit: true };
});

check('native-hidden-tab-pauses-harmony-and-requires-explicit-resume', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await setupUi(page); await act(page, 'start').click({ force: true }); await page.waitForFunction(() => document.querySelector('#harmony-mount')?.dataset.harmonyState === 'running', undefined, { polling: 100 });
  const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront(); await page.waitForFunction(() => document.hidden && document.querySelector('#harmony-mount')?.dataset.harmonyState === 'paused', undefined, { polling: 100 });
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden, undefined, { polling: 100 }); assert.match(await page.getByTestId('harmony-status').innerText(), /скрывалась/);
  assert.match(await page.getByTestId('harmony-notice').innerText(), /нажми «Продолжить»/);
  await delay(150); assert.equal(await page.locator('#harmony-mount').getAttribute('data-harmony-state'), 'paused'); await act(page, 'resume').click({ force: true }); await page.waitForFunction(() => document.querySelector('#harmony-mount')?.dataset.harmonyState === 'running', undefined, { polling: 100 });
  await page.getByTestId('harmony-notice').waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('harmony-notice').innerText(), '');
  await act(page, 'stop').click({ force: true });
  return { realDocumentHidden: true, explicitResumeRequired: true, method: 'Separate Edge/CDP noDefaults:true, actual tab activation; physical output muted.' };
}));

await runHarmonyBrowserChecks(checks);
