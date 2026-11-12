import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runAudioBrowserChecks } from './helpers/audio-browser-harness.mjs';
import { markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';

const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });
const snapshot = page => page.evaluate(() => window.p4.player.getSnapshot());
const sounded = (state, type = 'note') => state.trace.filter(event => event.type === type && !event.cancelled && event.time <= state.audioTime + 0.000001);
const offline = (page, config = {}, options = {}) => page.evaluate(async ({ config, options }) => window.p4.player.renderOffline(window.p4.makeConfig(config), options), { config, options });

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
/* ---------- Экран игры «Занятия» (P13): владелец звука `play` ---------- */

const playScene = page => page.locator('[data-lesson-screen="play"] .pl-scene');
/** Состояние транспорта экрана игры из DOM; без продуктового API. */
const READ_PLAY = `(() => {
  const scene = document.querySelector('[data-lesson-screen="play"] .pl-scene');
  if (!scene) return null;
  const text = scene.querySelector('[data-progress-text]').textContent;
  const match = /Нота (\\d+) из (\\d+)/.exec(text);
  return { status: scene.dataset.status, view: scene.dataset.view, text, note: match ? Number(match[1]) : null,
    now: scene.querySelector('[data-now-detail]')?.textContent ?? '', bpm: Number(scene.querySelector('[data-bpm]').textContent),
    current: [...scene.querySelectorAll('.pl-note.is-current')].map(node => node.dataset.position) };
})()`;
const playState = page => page.evaluate(READ_PLAY);
async function waitPlay(page, predicate, arg = null, timeout = 15000) {
  await page.waitForFunction(`(() => { const state = ${READ_PLAY}; return !!state && (${predicate.toString()})(state, ${JSON.stringify(arg)}); })()`, null, { timeout, polling: 30 });
  return playState(page);
}
/** «Сегодня» → «Играть: <упражнение>» стартового плана. */
async function openPlay(page, title = 'Хроматика 1-2-3-4 в позиции') {
  const home = page.locator('[data-lesson-screen="home"]');
  await home.getByRole('tab', { name: /^Сегодня/ }).click();
  await home.locator('.ls-plan').getByRole('button', { name: `Играть: ${title}`, exact: true }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  return playState(page);
}
/** Клавиши транспорта действуют, когда фокус не на элементе управления: заголовок экрана игры. */
const focusTitle = page => playScene(page).locator('[data-title]').focus();
/** «E/3 · ступень 3» в подробностях «Сейчас» → идентификатор позиции «E:3». */
const shownPosition = detail => { const match = /([EADG])\/(\d+)/.exec(detail); return match ? `${match[1]}:${match[2]}` : null; };

check('offline-quarter-notes-use-real-PCM-and-finish-with-silence', 'api', async ({ page }) => {
  const result = await offline(page);
  pcm(result, [0, 0.5, 1, 1.5]); near(result.finishAt, 2, 0.0001);
  assert.deepEqual(result.trace.filter(event => event.type === 'note').map(event => event.positionId), ['E:0', 'E:1', 'E:3', 'E:5']);
  return result;
});

check('offline-sequence-bass-timbre-has-second-and-third-harmonics', 'api', async ({ page }) => {
  // Синус E1 (41 Гц) почти не слышен на динамиках ноутбука; тембр должен нести заметные 2f и 3f.
  const results = [];
  for (const fret of [0, 5, 12]) {
    const result = await page.evaluate(fret => window.p4.bassSpectrum(fret), fret);
    assert.ok(result.levels[0] > .01, `fundamental present at E${fret}: ${JSON.stringify(result)}`);
    assert.ok(result.ratios[0] >= .2 && result.ratios[1] >= .12, `2nd/3rd harmonics at E${fret}: ${JSON.stringify(result)}`);
    assert.ok(result.peak < .9, `headroom at E${fret}: ${result.peak}`);
    results.push(result);
  }
  return { method: 'OfflineAudioContext PCM of the product player, Hann-window correlation at k·f0; perceived timbre/speaker audibility not inferred', results };
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

// UI-сценарии прежнего проигрывателя «Грифа» (фрагмент, лестница темпа, рисунки метронома, громкости) удалены вместе
// с ним в P13-08. Звук последовательности — на экране игры «Занятия»; его отсчёт, пауза/продолжение и Esc проверяет
// p13-browser, live-сигнал по аудиочасам и настоящее скрытие вкладки — там же (полный набор). Здесь — подсветка,
// темп во время игры, охрана клавиш и уход из раздела, наименьшее окно VIS-11.

check('ui-play-board-current-note-follows-shown-note-and-pause-stop-keep-screen-consistent', 'ui', async ({ page, resultDir }) => {
  const initial = await openPlay(page);
  assert.equal(initial.status, 'stopped'); assert.equal(initial.view, 'board');
  await playScene(page).locator('[data-play]').click();
  await waitPlay(page, state => state.status === 'playing' && state.note >= 1, null, 20000);
  // Опрос по таймеру: на виде «Гриф крупно» подсвечена ровно одна нота — та, что названа в «Сейчас».
  const samples = await page.evaluate(async source => {
    const read = () => (0, eval)(source); const rows = []; const started = performance.now();
    while (performance.now() - started < 1500) { const state = read(); if (state.status === 'playing') rows.push(state); await new Promise(resolve => setTimeout(resolve, 15)); }
    return rows;
  }, READ_PLAY);
  assert.ok(new Set(samples.map(row => row.note)).size >= 3, `Нота меняется: ${JSON.stringify(samples.map(row => row.note))}`);
  for (const row of samples) {
    assert.equal(row.current.length, 1, `Одна текущая нота: ${JSON.stringify(row)}`);
    assert.equal(row.current[0], shownPosition(row.now), `Подсветка совпадает с «Сейчас»: ${JSON.stringify(row)}`);
  }
  await page.screenshot({ path: join(resultDir, 'p4-play-desktop.png'), fullPage: true });
  await focusTitle(page); await page.keyboard.press('Space');
  const paused = await waitPlay(page, state => state.status === 'paused', null, 3000);
  await delay(400);
  const still = await playState(page);
  assert.deepEqual([still.status, still.note, still.current], ['paused', paused.note, paused.current], 'На паузе экран и подсветка не меняются');
  await page.keyboard.press('Escape');
  const stopped = await waitPlay(page, state => state.status === 'stopped', null, 3000);
  assert.equal(stopped.note, 0); assert.deepEqual(stopped.current, [], 'После «С начала» текущей ноты нет');
  return { samples: samples.length, distinctNotes: new Set(samples.map(row => row.note)).size, paused: { note: paused.note, current: paused.current }, stopped: stopped.text, screenshot: 'test-results/p4-play-desktop.png' };
});

check('ui-play-tempo-step-during-playback-keeps-playing-without-rating-not-remembered', 'ui', async ({ page }) => {
  const initial = await openPlay(page);
  await playScene(page).locator('[data-play]').click();
  const playing = await waitPlay(page, state => state.status === 'playing' && state.note >= 1, null, 20000);
  await playScene(page).locator('[data-bpm-step]:not([data-bpm-step^="-"])').click();
  const changed = await waitPlay(page, (state, bpm) => state.bpm > bpm, initial.bpm, 3000);
  const later = await waitPlay(page, (state, note) => state.status === 'playing' && state.note > note, changed.note, 5000);
  assert.equal(later.bpm, changed.bpm, 'Темп держится, игра не остановлена');
  await focusTitle(page); await page.keyboard.press('Escape'); await waitPlay(page, state => state.status === 'stopped', null, 3000);
  // Без отметки прохода темп не записывается: упражнение без истории снова открывается с темпом занятия (D-046).
  await playScene(page).locator('[data-back]').first().click();
  const reopened = await openPlay(page);
  assert.equal(reopened.bpm, initial.bpm, 'Темп без отметки прохода не становится темпом упражнения');
  return { initialBpm: initial.bpm, playingNote: playing.note, changedBpm: changed.bpm, keptPlayingAtNote: later.note, reopenedBpm: reopened.bpm };
});

check('ui-play-keyboard-guards-own-buttons-modal-dialog-and-section-leave', 'ui', async ({ page }) => {
  await openPlay(page);
  // Пробел на кнопке нажимает её саму (смена вида), транспорт не стартует.
  await playScene(page).locator('button[data-view="tab"]').focus(); await page.keyboard.press('Space');
  await waitPlay(page, state => state.view === 'tab', null, 3000);
  assert.equal((await playState(page)).status, 'stopped');
  // Открытый модальный диалог забирает клавиши.
  await page.evaluate(() => { const dialog = document.body.appendChild(document.createElement('dialog')); dialog.id = 'guard-dialog'; dialog.showModal(); });
  await page.keyboard.press('Space'); await delay(300);
  assert.equal((await playState(page)).status, 'stopped', 'Пробел при модальном диалоге не запускает игру');
  await page.evaluate(() => document.querySelector('#guard-dialog').remove());
  // Без фокуса на элементе управления: пробел — старт, пауза, продолжение.
  await focusTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing' && state.note >= 1, null, 20000);
  await page.keyboard.press('Space'); const paused = await waitPlay(page, state => state.status === 'paused', null, 3000);
  await page.keyboard.press('Space'); await waitPlay(page, (state, note) => state.status === 'playing' && state.note > note, paused.note, 5000);
  // Уход из «Занятия» прерывает владельца `play`; возврат не продолжает игру сам.
  await page.locator('.site-header [data-app-module="foundation"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-page-frame="foundation"]').hidden);
  await page.locator('.site-header [data-app-module="lesson"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-page-frame="lesson"]').hidden);
  const back = await playState(page);
  assert.ok(back === null || back.status !== 'playing', `После смены раздела игра не звучит: ${JSON.stringify(back)}`);
  await delay(800);
  const later = await playState(page);
  assert.ok(later === null || later.status !== 'playing', 'Возврат в раздел не продолжает игру сам');
  return { ownButtonSpacePressedButton: true, modalBlocksTransport: true, keyboardStartPauseResume: true, sectionLeave: back?.status ?? 'screen closed', afterReturn: later?.status ?? 'screen closed' };
});

check('ui-play-smallest-design-window-has-no-page-scroll-while-paused', 'ui', async ({ page, resultDir }) => {
  // VIS-11: окна 1440×900, 1280×720 и 1024×768 без прокрутки во время игры; телефонная ширина экраном игры не заявлена.
  await page.setViewportSize({ width: 1024, height: 768 });
  await openPlay(page);
  await playScene(page).locator('[data-play]').click();
  await waitPlay(page, state => state.status === 'playing' && state.note >= 1, null, 20000);
  await focusTitle(page); await page.keyboard.press('Space'); await waitPlay(page, state => state.status === 'paused', null, 3000);
  await page.screenshot({ path: join(resultDir, 'p4-play-1024.png') });
  const size = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight }));
  assert.ok(size.scrollWidth <= size.clientWidth + 1 && size.scrollHeight <= size.clientHeight + 1, `Прокрутка страницы ${JSON.stringify(size)}`);
  await page.keyboard.press('Escape');
  return { size, screenshot: 'test-results/p4-play-1024.png', fullMobileSupportClaimed: false };
});

markFullOnly(checks, [
  'live-user-gesture-creates-real-nonzero-audio-output',
  'live-cursor-does-not-jump-to-lookahead-note-before-audio-clock',
  'live-fractional-pause-resume-preserves-grid-route-and-one-scheduler',
  'live-pause-during-count-in-does-not-repeat-count-or-skip-first-note',
  'live-pause-before-future-start-preserves-all-four-count-in-clicks',
  'live-manual-tempo-applies-on-future-quarter-after-loop',
  'live-stop-cancels-lookahead-and-three-restarts-have-no-duplicate-notes',
  'live-finite-end-waits-for-actual-audio-time-and-clears-voices',
], FULL_ONLY.liveAudio);
markFullOnly(checks, [
  'offline-inclusive-ui-fragment-corresponds-to-engine-half-open-range',
  'offline-gap-two-sounding-bars-two-silent-bars-keeps-bass-pulse',
  'offline-two-and-four-ignores-sixteenth-subdivision',
  'offline-eighth-and-sixteenth-metronome-subdivisions',
  'offline-tempo-ladder-six-passes-reaches-target-and-finishes',
  'ui-play-tempo-step-during-playback-keeps-playing-without-rating-not-remembered',
  'ui-play-smallest-design-window-has-no-page-scroll-while-paused',
], FULL_ONLY.smoke);
await runAudioBrowserChecks(checks);
