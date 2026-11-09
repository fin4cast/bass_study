import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runTracksBrowserChecks } from './helpers/tracks-browser-harness.mjs';

const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });
const near = (actual, expected, tolerance, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}, tolerance ${tolerance}`);
const snap = page => page.evaluate(() => window.p7tracks.player.getSnapshot());
const manifest = page => page.evaluate(() => window.p7tracks.player.getManifest());
const render = (page, options = {}) => page.evaluate(options => window.p7tracks.render(options), options);
const load = (page, specs) => page.evaluate(specs => window.p7tracks.load(specs), specs);
const pulseSpecs = [{ name: 'long.wav', duration: 2, pulses: [0, .5, 1, 1.5] }, { name: 'short.wav', duration: .75, pulses: [0, .5] }];
const sineSpecs = [{ name: 'bass.wav', duration: 2, frequency: 55 }, { name: 'reference.wav', duration: 2, frequency: 110 }];
function onsets(actual, expected) { assert.equal(actual.length, expected.length, `Expected PCM onsets ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); actual.forEach((time, index) => near(time, expected[index], .0051, `PCM onset ${index}`)); }
async function fixtureAction(page, name) {
  await page.locator(`#${name}`).click(); await page.waitForFunction(name => window.p7tracks.action?.name === name && window.p7tracks.action.done, name);
  assert.equal((await page.evaluate(() => window.p7tracks.action)).error, null);
}
async function waitSnapshot(page, predicate, argument, timeout = 6000) {
  await page.waitForFunction(({ source, argument }) => (new Function('state', 'argument', `return (${source})(state, argument)`))(window.p7tracks.player.getSnapshot(), argument), { source: predicate.toString(), argument }, { polling: 10, timeout }); return snap(page);
}
function wavPayload({ name = 'long.wav', duration = 2, frequency = 55 } = {}) {
  const sampleRate = 48000, frames = Math.round(duration * sampleRate), buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) buffer.writeInt16LE(Math.round(.5 * Math.sin(2 * Math.PI * frequency * frame / sampleRate) * 32767), 44 + frame * 2);
  return { name, mimeType: 'audio/wav', buffer };
}
const uiFiles = () => [wavPayload({ name: 'long.wav', duration: 2, frequency: 55 }), wavPayload({ name: 'short.wav', duration: .75, frequency: 110 })];
const tracksAction = (page, name) => page.locator(`[data-tracks-action="${name}"]`);
async function ready(page) { await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert); const free = page.locator('[data-intro="free"]'); if (await free.isVisible()) await free.click(); }
async function setupUi(page, files = uiFiles()) {
  await ready(page); await page.locator('[data-app-module="tracks"]').click();
  await page.locator('[data-bank-view="audio"]').click();
  if (files) { await page.getByLabel('Новый набор аудиофайлов', { exact: true }).setInputFiles(files); await page.waitForFunction(() => document.querySelector('#legacy-tracks-mount')?.dataset.tracksReady === 'true'); }
}
async function stateIs(page, value) { await page.waitForFunction(value => document.querySelector('#legacy-tracks-mount')?.dataset.tracksState === value, value, { polling: 20 }); }
async function fieldValue(page, label, value) { const field = page.getByLabel(label, { exact: true }); await field.fill(String(value)); await field.press('Tab'); }
async function openHistory(page) { await ready(page); const drawer = page.locator('.history-drawer'); if (!await drawer.evaluate(element => element.open)) await page.locator('#open-history').click(); await page.getByLabel('Название пресета', { exact: true }).waitFor(); }
async function exportUi(page) { await openHistory(page); const pending = page.waitForEvent('download'); await page.locator('[data-history-action="export"]').click(); const download = await pending; return JSON.parse(await readFile(await download.path(), 'utf8')); }
async function restoreUi(page, backup) {
  await openHistory(page); await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles({ name: 'tracks-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByTestId('backup-preview').waitFor(); await page.getByRole('checkbox', { name: 'Понимаю, что текущие данные будут заменены', exact: true }).check(); await page.locator('[data-history-action="confirm-restore"]').click();
  await page.getByTestId('backup-preview').waitFor({ state: 'detached' }); await ready(page);
}

check('pcm-native-decoder-aligns-stems-at-common-zero-and-keeps-short-tail-silent', 'api', async ({ page }) => {
  const source = await load(page, pulseSpecs), result = await render(page);
  assert.equal(source.tracks.length, 2); assert.equal(result.sampleRate, 48000); near(result.durationSeconds, 2, .00001);
  onsets(result.channels[0].onsets, [0, .5, 1, 1.5]); onsets(result.channels[1].onsets, [0, .5]);
  assert.ok(result.channels.every(channel => channel.peak > .39 && channel.peak < .41));
  assert.deepEqual(result.channels[1].windows.slice(3), [0, 0, 0, 0, 0]);
  assert.ok(result.channels.every(channel => channel.tailRms === 0));
  assert.equal(source.tracks[0].decoded.frames, 96000); assert.equal(source.tracks[1].decoded.frames, 36000);
  return { source, pcm: result };
});

check('pcm-ab-is-half-open-and-two-loops-restart-both-stems-on-one-boundary', 'api', async ({ page }) => {
  await load(page, pulseSpecs);
  await page.evaluate(() => { window.p7tracks.player.setClip({ from: .5, to: 1.5 }); window.p7tracks.player.setLoop(true); });
  const result = await render(page); near(result.durationSeconds, 2, .00001);
  onsets(result.channels[0].onsets, [0, .5, 1, 1.5]); onsets(result.channels[1].onsets, [0, 1]);
  assert.deepEqual(result.channels[1].windows.map((value, index) => value > .001 ? index : null).filter(value => value !== null), [0, 4]);
  assert.equal(result.channels[0].onsets.filter(time => time === 1).length, 1);
  // A's source pulse is included. The pulse at source B=1.5 is excluded;
  // there are two long pulses per cycle, never an extra endpoint pulse.
  return { manifest: await manifest(page), pcm: result };
});

check('pcm-varispeed-changes-duration-and-pitch-without-claiming-time-stretch', 'api', async ({ page }) => {
  await load(page, [sineSpecs[0]]); const rows = [];
  for (const [rate, expectedHz, expectedDuration, expectedCents] of [[1, 55, 2, 0], [.5, 27.5, 4, -1200], [1.5, 82.5, 4 / 3, 701.955000865]]) {
    await page.evaluate(rate => window.p7tracks.player.setRate(rate), rate);
    const result = await render(page), state = await snap(page);
    near(result.channels[0].hz, expectedHz, .02, 'frequency from rendered zero crossings'); near(result.durationSeconds, expectedDuration, 1 / 48000);
    near(state.pitchShiftCents, expectedCents, .00001); rows.push({ rate, pcm: result, state });
  }
  return rows;
});

check('pcm-per-stem-mute-and-gain-leave-other-stem-samples-and-timeline-unchanged', 'api', async ({ page }) => {
  const source = await load(page, pulseSpecs), before = await render(page);
  await page.evaluate(id => window.p7tracks.player.setTrackMix(id, { muted: true }), source.tracks[0].id);
  const muted = await render(page); assert.equal(muted.channels[0].peak, 0); assert.deepEqual(muted.channels[1], before.channels[1]);
  await page.evaluate(id => window.p7tracks.player.setTrackMix(id, { muted: false, volume: .4 }), source.tracks[0].id);
  const half = await render(page); near(half.channels[0].peak, before.channels[0].peak / 2, .000001); onsets(half.channels[0].onsets, [0, .5, 1, 1.5]); assert.deepEqual(half.channels[1], before.channels[1]);
  return { before, muted, half };
});

check('metadata-restore-has-no-pcm-and-rebind-validates-content-not-filename', 'api', async ({ page }) => {
  const source = await load(page, sineSpecs);
  const result = await page.evaluate(async source => {
    const { player, wav, attempt } = window.p7tracks;
    const portable = JSON.parse(JSON.stringify(source)); player.restoreManifest(portable);
    const missing = player.getSnapshot(); const playError = await attempt(() => player.play());
    const wrong = await attempt(() => player.rebindFile(source.tracks[0].id, wav({ name: 'bass.wav', duration: 2, frequency: 56 })));
    const afterWrong = player.getSnapshot();
    await player.rebindFile(source.tracks[0].id, wav({ name: 'renamed.wav', duration: 2, frequency: 55 })); const partial = player.getSnapshot();
    await player.rebindFile(source.tracks[1].id, wav({ name: 'also-renamed.wav', duration: 2, frequency: 110 }));
    return { portable, missing, playError, wrong, afterWrong, partial, bound: player.getSnapshot(), pcm: await window.p7tracks.render() };
  }, source);
  assert.equal(result.missing.ready, false); assert.deepEqual(result.missing.boundTrackIds, []); assert.equal(result.playError.code, 'MISSING_FILES');
  assert.equal(result.wrong.code, 'FILE_MISMATCH'); assert.deepEqual(result.afterWrong.boundTrackIds, []);
  assert.equal(result.partial.ready, false); assert.deepEqual(result.partial.boundTrackIds, [source.tracks[0].id]); assert.equal(result.bound.ready, true);
  assert.deepEqual(result.portable, source); near(result.pcm.channels[0].hz, 55, .02); near(result.pcm.channels[1].hz, 110, .02);
  const json = JSON.stringify(result.portable); assert.ok(!/data:audio|blob:|base64|channelData|samples|arrayBuffer/.test(json));
  return result;
});

check('native-decode-cancellation-and-corrupt-file-failure-atomically-preserve-old-set', 'api', async ({ page }) => {
  const before = await load(page, pulseSpecs), pcm = await render(page);
  const cancelled = await page.evaluate(() => window.p7tracks.cancelDuringDecode());
  assert.equal(cancelled.nativeDecodeCalls, 1); assert.equal(cancelled.error.code, 'LOAD_CANCELLED');
  assert.deepEqual(await manifest(page), before); assert.deepEqual(await render(page), pcm); assert.equal((await snap(page)).loading, false);
  const corrupt = await page.evaluate(() => window.p7tracks.attempt(() => window.p7tracks.player.loadFiles([new File([new Uint8Array([1, 2, 3, 4])], 'corrupt.wav', { type: 'audio/wav' })])));
  assert.equal(corrupt.code, 'DECODE_FAILED'); assert.deepEqual(await manifest(page), before); assert.deepEqual(await render(page), pcm);
  return { cancelled, corrupt, preservedManifest: before, preservedPcm: pcm };
});

check('count-type-source-size-clip-rate-and-manifest-errors-do-not-replace-valid-data', 'api', async ({ page }) => {
  const before = await load(page, pulseSpecs);
  const errors = await page.evaluate(async () => {
    const { player, wav, attempt } = window.p7tracks;
    const results = {};
    results.count = await attempt(() => player.loadFiles(Array.from({ length: 5 }, () => wav({ duration: .1 }))));
    results.type = await attempt(() => player.loadFiles([new File(['test'], 'unsupported.ogg')]));
    results.size = await attempt(() => player.loadFiles([new File([new Uint8Array(64 * 1024 * 1024 + 1)], 'too-large.wav')]));
    results.clip = await attempt(() => player.setClip({ from: .5, to: .5 }));
    results.range = await attempt(() => player.setClip({ from: 0, to: 2.01 }));
    results.rate = await attempt(() => player.setRate(.49));
    results.seek = await attempt(() => player.seek(-1));
    results.format = await attempt(() => player.restoreManifest({ ...player.getManifest(), schemaVersion: 2 }));
    return results;
  });
  assert.equal(errors.count.code, 'TRACK_COUNT'); assert.equal(errors.type.code, 'FILE_TYPE'); assert.equal(errors.size.code, 'SOURCE_LIMIT');
  assert.equal(errors.seek.code, 'INVALID_SEEK'); assert.equal(errors.format.code, 'UNSUPPORTED_FORMAT');
  for (const error of Object.values(errors)) assert.ok(error?.message); assert.deepEqual(await manifest(page), before); assert.equal((await snap(page)).ready, true);
  return { errors, preservedManifest: before, note: 'The source limit is checked on a real synthetic File before decode. Large decoded PCM capacity remains covered by model tests, without allocating 512 MiB here.' };
});

check('live-pause-seek-and-resume-keep-the-common-source-position-at-rate-one', 'api', async ({ page }) => {
  await load(page, sineSpecs); await page.evaluate(() => window.p7tracks.player.setLoop(true));
  await fixtureAction(page, 'play'); await waitSnapshot(page, state => state.position > .3 && state.output.rms > .05);
  await fixtureAction(page, 'pause'); const paused = await snap(page); await delay(200); const frozen = await snap(page);
  near(frozen.position, paused.position, .000001); assert.equal(frozen.state, 'paused'); assert.equal(frozen.activeSources, 0); assert.ok(frozen.output.rms < .000001);
  await page.evaluate(() => window.p7tracks.player.seek(.75)); near((await snap(page)).position, .75, .000001);
  await fixtureAction(page, 'play'); const resumed = await waitSnapshot(page, state => state.position > 1.05 && state.output.rms > .05);
  assert.ok(resumed.position < 1.3); assert.equal(resumed.activeSources, 2);
  await page.evaluate(() => window.p7tracks.player.seek(1.5)); const sought = await waitSnapshot(page, state => state.position > 1.6 && state.position < 1.9 && state.output.rms > .05);
  assert.equal(sought.state, 'playing'); assert.equal(sought.activeSources, 2); await fixtureAction(page, 'stop');
  return { paused, frozen, resumed, sought };
});

check('live-mixing-keeps-common-clock-and-other-stem-running-without-a-restart', 'api', async ({ page }) => {
  const source = await load(page, sineSpecs); await page.evaluate(() => window.p7tracks.player.setLoop(true)); await fixtureAction(page, 'play');
  const before = await waitSnapshot(page, state => state.position > .25 && state.output.rms > .05);
  await page.evaluate(id => window.p7tracks.player.setTrackMix(id, { muted: true }), source.tracks[0].id); await delay(200); const one = await snap(page);
  assert.equal(one.activeSources, 2); assert.ok(one.position > before.position + .12 && one.position < before.position + .35); assert.ok(one.output.rms > .1); assert.ok(one.output.rms < before.output.rms * .85);
  await page.evaluate(id => window.p7tracks.player.setTrackMix(id, { volume: 0 }), source.tracks[1].id); await delay(100); const silent = await snap(page); assert.ok(silent.output.rms < .000001); assert.equal(silent.state, 'playing'); assert.ok(silent.position > one.position);
  await page.evaluate(id => window.p7tracks.player.setTrackMix(id, { muted: false }), source.tracks[0].id); const audible = await waitSnapshot(page, state => state.output.rms > .1);
  assert.ok(audible.position >= silent.position); assert.equal(audible.activeSources, 2); await fixtureAction(page, 'stop');
  return { before, one, silent, audible };
});

check('live-edit-guards-and-three-restarts-have-no-stale-sources-or-audible-tail', 'api', async ({ page }) => {
  await load(page, sineSpecs); const runs = [];
  for (let index = 0; index < 3; index++) {
    await fixtureAction(page, 'play'); const playing = await waitSnapshot(page, state => state.position > .1 && state.output.rms > .05);
    assert.equal(playing.activeSources, 2); assert.ok(playing.position < .45);
    const guards = await page.evaluate(async () => ({ rate: await window.p7tracks.attempt(() => window.p7tracks.player.setRate(.5)), clip: await window.p7tracks.attempt(() => window.p7tracks.player.setClip({ from: .5, to: 1.5 })), loop: await window.p7tracks.attempt(() => window.p7tracks.player.setLoop(true)) }));
    for (const error of Object.values(guards)) assert.equal(error.code, 'PAUSE_REQUIRED');
    await fixtureAction(page, 'stop'); await delay(120); const stopped = await snap(page); assert.equal(stopped.activeSources, 0); assert.equal(stopped.position, 0); assert.equal(stopped.state, 'stopped'); assert.ok(stopped.output.rms < .000001);
    runs.push({ playing, guards, stopped });
  }
  return runs;
});

check('live-finite-end-is-actual-common-end-not-short-stem-end-or-lookahead', 'api', async ({ page }) => {
  await load(page, [{ name: 'long.wav', duration: 1, frequency: 55 }, { name: 'short.wav', duration: .3, frequency: 110 }]); await fixtureAction(page, 'play');
  const afterShort = await waitSnapshot(page, state => state.position > .45 && state.position < .7); assert.equal(afterShort.state, 'playing'); assert.ok(afterShort.output.rms > .1); assert.equal(afterShort.activeSources, 1);
  const beforeEnd = await waitSnapshot(page, state => state.position > .9 && state.position < .99); assert.equal(beforeEnd.state, 'playing'); assert.ok(beforeEnd.output.rms > .1);
  const finished = await waitSnapshot(page, state => state.state === 'finished'); near(finished.position, 1, .000001); assert.equal(finished.activeSources, 0);
  await delay(100); const quiet = await snap(page); assert.ok(quiet.output.rms < .000001); return { afterShort, beforeEnd, finished, quiet };
});

check('live-early-pause-and-disposal-cancel-voices-and-release-decoded-bindings', 'api', async ({ page }) => {
  await load(page, sineSpecs); await fixtureAction(page, 'play-pause'); const early = await snap(page); assert.equal(early.state, 'paused'); near(early.position, 0, .000001); assert.equal(early.activeSources, 0);
  await fixtureAction(page, 'play'); const resumed = await waitSnapshot(page, state => state.position > .1 && state.output.rms > .05);
  await page.evaluate(() => window.p7tracks.player.dispose()); await delay(100); const disposed = await snap(page);
  assert.equal(disposed.activeSources, 0); assert.equal(disposed.ready, false); assert.deepEqual(disposed.boundTrackIds, []);
  const error = await page.evaluate(() => window.p7tracks.attempt(() => window.p7tracks.player.play())); assert.equal(error.code, 'DISPOSED');
  return { early, resumed, disposed, error };
});

check('ui-local-file-selection-shows-shared-material-and-clear-scope-limits', 'ui', async ({ page }) => {
  await setupUi(page, null); assert.ok(await page.getByTestId('tracks-empty').isVisible());
  assert.match(await page.locator('#legacy-tracks-mount').innerText(), /автоматического выравнивания.*нет/);
  assert.match(await page.locator('#legacy-tracks-mount .tracks-intro').innerText(), /четырёх.*64 МиБ/);
  await page.getByLabel('Новый набор аудиофайлов', { exact: true }).setInputFiles(uiFiles()); await page.waitForFunction(() => document.querySelector('#legacy-tracks-mount')?.dataset.tracksReady === 'true');
  assert.equal(await page.locator('[data-track-id]').count(), 2); assert.equal(await page.locator('[data-track-bound="true"]').count(), 2);
  assert.match(await page.getByTestId('tracks-rate-warning').innerText(), /исходная высота.*B исключается.*тишиной/);
  assert.equal(await page.getByLabel('Начало фрагмента A', { exact: true }).inputValue(), '0'); assert.equal(await page.getByLabel('Конец фрагмента B', { exact: true }).inputValue(), '2');
  const copy = await exportUi(page); assert.equal(copy.schemaVersion, 9); assert.equal(copy.preferences.activeModule, 'tracks'); assert.equal(copy.preferences.tracks.tracks.length, 2);
  assert.ok(await page.getByTestId('manual-unavailable').isVisible());
  assert.ok(await page.locator('[data-history-action="save-manual"]').isHidden());
  return { loadStatus: await page.getByTestId('tracks-load-status').innerText(), manifest: copy.preferences.tracks, externalUploadRequests: 0 };
});

check('ui-exact-native-B-and-subsecond-fragment-show-hundredths-without-truncating-source', 'ui', async ({ page }) => {
  const frames = 130816, duration = frames / 48000;
  await setupUi(page, [wavPayload({ name: 'fractional-end.wav', duration })]);
  const end = page.getByLabel('Конец фрагмента B', { exact: true });
  const validity = await end.evaluate(input => ({ valid: input.validity.valid, mismatch: input.validity.stepMismatch, overflow: input.validity.rangeOverflow, value: input.value, max: input.max }));
  assert.equal(validity.valid, true); assert.equal(validity.mismatch, false); assert.equal(validity.overflow, false);
  near(Number(validity.value), duration, 1e-12); assert.equal(validity.value, validity.max);
  assert.match(await page.locator('#legacy-tracks-mount').innerText(), /Минимум фрагмента — 0,05 с/);
  await fieldValue(page, 'Начало фрагмента A', .1); await fieldValue(page, 'Конец фрагмента B', .36);
  await tracksAction(page, 'play').click(); await stateIs(page, 'finished');
  assert.equal(await page.getByTestId('tracks-position').innerText(), '0:00,36 / 0:02,73');
  const copy = await exportUi(page); near(copy.preferences.tracks.tracks[0].decoded.duration, duration, 1e-12);
  assert.deepEqual(copy.preferences.tracks.clip, { from: .1, to: .36 });
  return { validity, displayedPosition: '0:00,36 / 0:02,73', originalDuration: duration, clip: copy.preferences.tracks.clip };
});

check('ui-set-A-and-B-here-captures-position-and-never-resumes-implicitly', 'ui', async ({ page }) => {
  await setupUi(page);
  const seek = page.getByLabel('Позиция аудиофрагмента', { exact: true });
  await seek.fill('.25'); await seek.press('Tab'); await tracksAction(page, 'from-here').click();
  assert.equal(await page.getByLabel('Начало фрагмента A', { exact: true }).inputValue(), '0.25');
  await seek.fill('.7'); await seek.press('Tab'); await tracksAction(page, 'to-here').click();
  assert.equal(await page.getByLabel('Конец фрагмента B', { exact: true }).inputValue(), '0.7');
  assert.notEqual(await page.locator('#legacy-tracks-mount').getAttribute('data-tracks-state'), 'playing');
  await tracksAction(page, 'full-clip').click(); await tracksAction(page, 'play').click(); await stateIs(page, 'playing');
  await page.waitForFunction(() => Number(document.querySelector('[data-tracks-setting="seek"]').value) > .2);
  await tracksAction(page, 'from-here').click(); await stateIs(page, 'paused');
  const captured = Number(await page.getByLabel('Начало фрагмента A', { exact: true }).inputValue()); assert.ok(captured > .2 && captured < 1.5);
  await delay(150); assert.equal(await page.locator('#legacy-tracks-mount').getAttribute('data-tracks-state'), 'paused');
  assert.match(await page.getByTestId('tracks-notice').innerText(), /на паузе/);
  const copy = await exportUi(page); near(copy.preferences.tracks.clip.from, captured, 1e-12);
  return { stoppedClip: [.25, .7], liveCapturedA: captured, noImplicitResume: true };
});

check('ui-clear-names-the-loss-and-cancel-preserves-set-before-confirmation', 'ui', async ({ page }) => {
  await setupUi(page); await fieldValue(page, 'Начало фрагмента A', .25);
  const before = (await exportUi(page)).preferences.tracks;
  await tracksAction(page, 'clear').click();
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  const confirmationText = await dialog.innerText();
  assert.match(confirmationText, /границы фрагмента.*привязки.*Аудиофайлы на компьютере сохранятся/);
  for (const track of before.tracks) assert.ok(confirmationText.includes(`«${track.name}»`), `Confirmation must name ${track.name}`);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.deepEqual((await exportUi(page)).preferences.tracks, before);
  await tracksAction(page, 'clear').click(); await dialog.getByRole('button', { name: 'Очистить набор', exact: true }).click();
  await page.getByTestId('tracks-empty').waitFor();
  assert.equal((await exportUi(page)).preferences.tracks, null);
  assert.equal(await page.locator('[data-track-id]').count(), 0);
  return { cancelledManifest: before, namedFiles: before.tracks.map(track => track.name), confirmedManifest: null, diskFilesUntouched: true };
});

check('ui-ab-loop-and-varispeed-are-explicit-validatable-and-persisted', 'ui', async ({ page, resultDir }) => {
  await setupUi(page); await fieldValue(page, 'Начало фрагмента A', .5); await fieldValue(page, 'Конец фрагмента B', 1.5); await page.getByLabel('Повторять аудиофрагмент', { exact: true }).check();
  await fieldValue(page, 'Скорость с изменением высоты', .5); assert.match(await page.getByTestId('tracks-rate-warning').innerText(), /высота тоже меняется.*varispeed.*без сохранения/);
  let copy = await exportUi(page); assert.deepEqual(copy.preferences.tracks.clip, { from: .5, to: 1.5 }); assert.equal(copy.preferences.tracks.loop, true); assert.equal(copy.preferences.tracks.rate, .5);
  await fieldValue(page, 'Скорость с изменением высоты', 1); await tracksAction(page, 'play').focus(); await page.keyboard.press('Space'); await stateIs(page, 'playing');
  assert.ok(await page.getByLabel('Скорость с изменением высоты', { exact: true }).isDisabled()); assert.ok(await page.getByLabel('Начало фрагмента A', { exact: true }).isDisabled());
  await tracksAction(page, 'pause').click(); await stateIs(page, 'paused'); assert.ok(await page.getByLabel('Скорость с изменением высоты', { exact: true }).isEnabled());
  await tracksAction(page, 'full-clip').click(); assert.equal(await page.getByLabel('Начало фрагмента A', { exact: true }).inputValue(), '0'); assert.equal(await page.getByLabel('Конец фрагмента B', { exact: true }).inputValue(), '2');
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(resultDir, 'p7-tracks-narrow.png'), fullPage: true });
  const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.ok(geometry.scrollWidth <= geometry.width + 2, JSON.stringify(geometry));
  copy = await exportUi(page); return { manifest: copy.preferences.tracks, geometry };
});

check('ui-live-mute-seek-pause-and-module-leave-preserve-one-common-timeline', 'ui', async ({ page }) => {
  await setupUi(page); await page.getByLabel('Повторять аудиофрагмент', { exact: true }).check(); await tracksAction(page, 'play').click(); await stateIs(page, 'playing');
  await page.waitForFunction(() => Number(document.querySelector('[data-tracks-setting="seek"]').value) > .2);
  const before = Number(await page.getByLabel('Позиция аудиофрагмента', { exact: true }).inputValue());
  await page.getByLabel('Выключить дорожку 1', { exact: true }).check(); await delay(180);
  const afterMute = Number(await page.getByLabel('Позиция аудиофрагмента', { exact: true }).inputValue()); assert.ok(afterMute > before + .1); assert.ok(afterMute < before + .45);
  const volume = page.getByLabel('Громкость дорожки 2', { exact: true }); await volume.focus(); await volume.press('Home'); for (let index = 0; index < 25; index++) await volume.press('ArrowRight');
  const seekControl = page.getByLabel('Позиция аудиофрагмента', { exact: true });
  await seekControl.scrollIntoViewIfNeeded();
  const seekBox = await seekControl.boundingBox(); assert.ok(seekBox); await page.mouse.click(seekBox.x + seekBox.width / 2, seekBox.y + seekBox.height / 2);
  near(Number(await page.getByLabel('Позиция аудиофрагмента', { exact: true }).inputValue()), 1, .03, 'native slider midpoint');
  // The focused slider deliberately keeps the user's edit value. Leave it as
  // a user would before expecting its display to follow the real audio clock.
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => Number(document.querySelector('[data-tracks-setting="seek"]').value) > 1.05);
  await tracksAction(page, 'pause').click(); await stateIs(page, 'paused'); await delay(50);
  const paused = Number(await page.getByLabel('Позиция аудиофрагмента', { exact: true }).inputValue()); await delay(180); near(Number(await page.getByLabel('Позиция аудиофрагмента', { exact: true }).inputValue()), paused, .000001);
  await tracksAction(page, 'play').click(); await stateIs(page, 'playing'); await page.locator('[data-app-module="foundation"]').click(); await stateIs(page, 'stopped');
  await page.locator('[data-app-module="tracks"]').click(); near(Number(await page.getByLabel('Позиция аудиофрагмента', { exact: true }).inputValue()), 0, .000001);
  const copy = await exportUi(page); assert.equal(copy.preferences.tracks.tracks[0].muted, true); near(copy.preferences.tracks.tracks[1].volume, .25, .000001);
  return { before, afterMute, paused, savedMix: copy.preferences.tracks.tracks.map(({ volume, muted }) => ({ volume, muted })) };
});

check('ui-reload-keeps-only-metadata-and-rebinds-renamed-source-by-sha-not-name', 'ui', async ({ page }) => {
  await setupUi(page); const copy = await exportUi(page), portable = copy.preferences.tracks;
  await page.reload(); await ready(page); await page.getByTestId('tracks-missing').waitFor();
  assert.equal(await page.locator('#legacy-tracks-mount').getAttribute('data-tracks-ready'), 'false'); assert.equal(await page.locator('[data-track-bound="false"]').count(), 2); assert.ok(await tracksAction(page, 'play').isDisabled());
  assert.match(await page.getByTestId('tracks-missing').innerText(), /SHA-256.*JSON нет|SHA-256.*размер|только названия/);
  await page.getByLabel('Исходный файл дорожки 1', { exact: true }).setInputFiles(wavPayload({ name: 'long.wav', duration: 2, frequency: 56 }));
  await page.getByTestId('tracks-error').waitFor({ state: 'visible' }); assert.match(await page.getByTestId('tracks-error').innerText(), /SHA-256/); assert.equal(await page.locator('[data-track-bound="true"]').count(), 0);
  await page.getByLabel('Исходный файл дорожки 1', { exact: true }).setInputFiles(wavPayload({ name: 'renamed.wav', duration: 2, frequency: 55 })); await page.waitForFunction(() => document.querySelector('#legacy-tracks-mount').dataset.tracksBound === '1');
  assert.ok(await tracksAction(page, 'play').isDisabled()); await page.getByLabel('Исходный файл дорожки 2', { exact: true }).setInputFiles(wavPayload({ name: 'renamed-short.wav', duration: .75, frequency: 110 })); await page.waitForFunction(() => document.querySelector('#legacy-tracks-mount').dataset.tracksReady === 'true');
  assert.deepEqual((await exportUi(page)).preferences.tracks, portable); await tracksAction(page, 'play').click(); await stateIs(page, 'playing'); await tracksAction(page, 'stop').click();
  return { metadataUnchanged: portable, wrongContentRejected: true, renamedExactFilesAccepted: true, originalFilenameNotAnIdentityKey: true };
});

check('ui-json-restore-stops-playback-and-requires-source-files-again', 'ui', async ({ page }) => {
  await setupUi(page); await fieldValue(page, 'Начало фрагмента A', .25); await page.getByLabel('Повторять аудиофрагмент', { exact: true }).check(); const copy = await exportUi(page);
  assert.ok(!/data:audio|blob:|base64|channelData|arrayBuffer/.test(JSON.stringify(copy.preferences.tracks)));
  await tracksAction(page, 'play').click(); await stateIs(page, 'playing'); await restoreUi(page, copy);
  await stateIs(page, 'stopped'); assert.ok(await page.getByTestId('tracks-missing').isVisible()); assert.ok(await tracksAction(page, 'play').isDisabled()); assert.equal(await page.locator('#legacy-tracks-mount').getAttribute('data-tracks-bound'), '0');
  const restored = await exportUi(page); assert.deepEqual(restored, copy);
  await page.getByLabel('Привязать исходные файлы', { exact: true }).setInputFiles(uiFiles()); await page.waitForFunction(() => document.querySelector('#legacy-tracks-mount').dataset.tracksReady === 'true'); await tracksAction(page, 'play').click(); await stateIs(page, 'playing'); await tracksAction(page, 'stop').click();
  return { metadataOnlyJson: true, restoredManifest: restored.preferences.tracks, restoreStoppedAndDiscardedBuffers: true, bulkRebindSucceeded: true };
});

check('ui-errors-and-explicit-load-cancellation-preserve-the-previous-ready-set', 'ui', async ({ page }) => {
  await setupUi(page); const before = (await exportUi(page)).preferences.tracks;
  await page.getByLabel('Новый набор аудиофайлов', { exact: true }).setInputFiles({ name: 'corrupt.wav', mimeType: 'audio/wav', buffer: Buffer.from([1, 2, 3]) }); await page.getByTestId('tracks-error').waitFor({ state: 'visible' }); assert.match(await page.getByTestId('tracks-error').innerText(), /декодировать/);
  assert.deepEqual((await exportUi(page)).preferences.tracks, before);
  await page.getByLabel('Новый набор аудиофайлов', { exact: true }).setInputFiles(Array.from({ length: 5 }, (_, index) => wavPayload({ name: `too-many-${index}.wav`, duration: .1 }))); assert.match(await page.getByTestId('tracks-error').innerText(), /четырёх/);
  // Delay only delivery of the genuine native decoding result, so the real
  // Cancel UI can be operated deterministically before its async settlement.
  await page.evaluate(() => {
    const original = AudioContext.prototype.decodeAudioData; window.__tracksOriginalDecode = original;
    AudioContext.prototype.decodeAudioData = async function(...args) { const result = await original.apply(this, args); window.__tracksNativeDecodeCompleted = true; await new Promise(resolve => { window.__tracksReleaseDecode = resolve; }); return result; };
  });
  await page.getByLabel('Новый набор аудиофайлов', { exact: true }).setInputFiles(wavPayload({ name: 'cancelled-new.wav', duration: 3, frequency: 82.5 })); await page.waitForFunction(() => window.__tracksNativeDecodeCompleted);
  await tracksAction(page, 'cancel-load').click(); await page.evaluate(() => { AudioContext.prototype.decodeAudioData = window.__tracksOriginalDecode; window.__tracksReleaseDecode(); });
  await delay(100); assert.match(await page.getByTestId('tracks-notice').innerText(), /отменена.*сохранён/); assert.deepEqual((await exportUi(page)).preferences.tracks, before); assert.ok(await tracksAction(page, 'play').isEnabled());
  return { previousManifest: before, nativeDecodeReallyCompleted: true, cancellationMethod: 'Real UI Cancel after actual native decode; test-only async delivery gate, no fake decoded buffer or exception.', preservedAfterCorruptionCountAndCancellation: true };
});

check('native-hidden-tab-pauses-real-tracks-and-needs-explicit-resume', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await setupUi(page); await page.getByLabel('Повторять аудиофрагмент', { exact: true }).check(); await tracksAction(page, 'play').click(); await stateIs(page, 'playing'); await delay(250);
  const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
  await page.waitForFunction(() => document.hidden && document.querySelector('#legacy-tracks-mount')?.dataset.tracksState === 'paused');
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden); await delay(100); const paused = Number(await page.getByLabel('Позиция аудиофрагмента', { exact: true }).inputValue());
  await delay(200); assert.equal(await page.locator('#legacy-tracks-mount').getAttribute('data-tracks-state'), 'paused'); near(Number(await page.getByLabel('Позиция аудиофрагмента', { exact: true }).inputValue()), paused, .000001); assert.match(await page.getByTestId('tracks-play-status').innerText(), /скрывалась.*явно/);
  await tracksAction(page, 'play').click(); await stateIs(page, 'playing'); await page.waitForFunction(paused => Number(document.querySelector('[data-tracks-setting="seek"]').value) > paused + .1, paused);
  await tracksAction(page, 'stop').click(); await stateIs(page, 'stopped'); await other.close();
  return { realNativeVisibilityTransition: true, pausePosition: paused, noSyntheticVisibilityEvent: true, explicitResumeRequired: true };
}));

await runTracksBrowserChecks(checks);
