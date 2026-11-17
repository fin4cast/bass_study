import assert from 'node:assert/strict';
import { seedPlan } from './helpers/seed-plan.mjs';
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
  // Каналы PCM: бас, клик, подложка (D-050), аккорды; без подложки и аккордов их каналы молчат.
  assert.equal(report.channels, 4); assert.equal(report.sampleRate, 44100);
  assert.equal(report.groove.onsets.length, 0); assert.equal(report.chords.onsets.length, 0);
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
    now: scene.querySelector('[data-now-detail]')?.textContent ?? '', bpm: Number(scene.querySelector('[data-bpm]').value),
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
  await seedPlan(page);
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

/** Аккорд такта: C, E, G (MIDI 60, 64, 67) и A, C, E (57, 60, 64) — окно G3–F♯4 с минимальным движением голосов. */
const C_CHORD = [60, 64, 67], A_CHORD = [57, 60, 64];
const bar = note => ({ note, grids: 16 });
check('offline-chords-hold-start-on-bar-downbeats-and-stay-silent-between', 'api', async ({ page }) => {
  // 120 BPM: такт — 2 с. «Держать»: аккорд звучит весь такт; такт без аккорда (null) — тишина на канале аккордов.
  const result = await offline(page, { steps: [bar(0), bar(1), bar(2)], chords: { mode: 'hold', bars: [C_CHORD, null, A_CHORD] } });
  onsets(result.chords.onsets, [0, 4]); onsets(result.bass.onsets, [0, 2, 4]);
  assert.ok(result.chords.peak > 0.01 && result.chords.peak < 0.9, `громкость аккордов: ${result.chords.peak}`);
  assert.equal(result.trace.filter(event => event.type === 'chord').length, 2);
  return result.chords;
});
check('offline-chords-beats-sound-on-every-quarter-and-follow-the-bar-chord', 'api', async ({ page }) => {
  const result = await offline(page, { steps: [bar(0), bar(1)], chords: { mode: 'beats', bars: [C_CHORD, A_CHORD] } });
  onsets(result.chords.onsets, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  const times = result.trace.filter(event => event.type === 'chord').map(event => event.time);
  assert.equal(times.length, 8); times.forEach((time, index) => near(time - times[0], index * 0.5, 0.001, `доля ${index}`));
  return result.chords;
});
check('offline-chords-are-silent-in-count-in-and-off-by-volume', 'api', async ({ page }) => {
  const counted = await offline(page, { countIn: true, steps: [bar(0)], chords: { mode: 'hold', bars: [C_CHORD] } });
  // Четыре отсчётных клика занимают первые 2 с; аккорд — только на первой доле практики.
  onsets(counted.chords.onsets, [2]); onsets(counted.bass.onsets, [2]);
  const muted = await page.evaluate(async config => {
    window.p4.player.setVolumes({ bass: 0.65, chords: 0 });
    try { return await window.p4.player.renderOffline(window.p4.makeConfig(config)); }
    finally { window.p4.player.setVolumes({ bass: 0.65, chords: 0.35 }); }
  }, { steps: [{ note: 0, grids: 16 }], chords: { mode: 'hold', bars: [[60, 64, 67]] } });
  assert.ok(muted.chords.peak < 0.0001, `шина аккордов с нулевой громкостью молчит: ${muted.chords.peak}`);
  return { counted: counted.chords, muted: muted.chords };
});
check('offline-chord-voices-sound-at-their-own-frequencies-and-do-not-carry-over', 'api', async ({ page }) => {
  const result = await page.evaluate(() => window.p4.chordSpectrum());
  const [first, second] = result;
  // Первый такт — C E G: голоса C4, E4, G4 заметны, посторонняя D4 нет; второй такт — A C E без G4 первого такта.
  for (const level of first.voices) assert.ok(level > 0.003, `голос C-E-G слышен: ${JSON.stringify(first)}`);
  assert.ok(first.control < first.voices.reduce((min, level) => Math.min(min, level), 1) / 4, `D4 не звучит в C-E-G: ${JSON.stringify(first)}`);
  for (const level of second.voices) assert.ok(level > 0.003, `голос A-C-E слышен: ${JSON.stringify(second)}`);
  assert.ok(second.gone < second.voices.reduce((min, level) => Math.min(min, level), 1) / 4, `G4 первого аккорда не остаётся во втором такте: ${JSON.stringify(second)}`);
  return result;
});

check('offline-hold-chord-is-cut-at-the-pass-boundary-when-tempo-changes-mid-bar', 'api', async ({ page }) => {
  const { before, after } = await page.evaluate(() => window.p4.chordCutAtTempoChange());
  assert.ok(before > 0.003, `A3 звучит в своём такте: ${before}`);
  assert.ok(after < before / 4, `A3 снят на границе прохода: до ${before}, после ${after}`);
  return { before, after };
});
check('offline-chord-volume-outside-zero-one-is-rejected-and-keeps-previous', 'api', async ({ page }) => {
  const result = await page.evaluate(() => {
    const before = window.p4.player.getSnapshot().volumes;
    let message = null;
    try { window.p4.player.setVolumes({ chords: 2 }); } catch (error) { message = error.message; }
    return { message, before, after: window.p4.player.getSnapshot().volumes };
  });
  assert.ok(result.message, 'громкость аккордов 2 должна отклоняться');
  assert.deepEqual(result.after, result.before);
  return result;
});

check('offline-note-gate-long-sounds-to-the-end-short-is-silent-after-half', 'api', async ({ page }) => {
  // A3: 60 BPM, четверть — 1 с. Длинная (gate 1) звучит на 0,9 шага; короткая (0,5) молчит на отрезке 0,6–0,95; без gate — по умолчанию 0,72.
  const result = await page.evaluate(() => window.p4.gateWindows());
  assert.ok(result.long.at90 > 0.02, `длинная звучит на 0,9 шага: ${JSON.stringify(result.long)}`);
  assert.ok(result.short.early > 0.02, `короткая звучит в первой половине: ${JSON.stringify(result.short)}`);
  assert.ok(result.short.gap < 0.0005, `короткая молчит на 0,6–0,95 шага: ${JSON.stringify(result.short)}`);
  assert.ok(result.plain.early > 0.02 && result.plain.gap < 0.0005, `без gate прежние 0,72: ${JSON.stringify(result.plain)}`);
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

/* ---------- Шкала шагов, эталон, подложка, свинг (D-050) ---------- */

check('offline-steps-of-different-length-and-rest-sound-on-their-onsets', 'api', async ({ page }) => {
  // 120 BPM: шестнадцатая — 0,125 с. Восьмая, четверть, пауза-восьмая, половинная → ноты на 0; 0,25; 1,0.
  const result = await offline(page, { steps: [{ note: 0, grids: 2 }, { note: 1, grids: 4 }, { note: null, grids: 2 }, { note: 2, grids: 8 }] });
  pcm(result, [0, 0.25, 1]); near(result.finishAt, 2, 0.0001);
  assert.deepEqual(result.trace.filter(event => event.type === 'note').map(event => event.positionId), ['E:0', 'E:1', 'E:3']);
  return result;
});

check('offline-rhythm-pattern-rest-is-silent-and-tie-has-no-second-attack', 'api', async ({ page }) => {
  // Шкала настоящего рисунка (A2) → шаги звука; 120 BPM: шестнадцатая — 0,125 с, четыре ноты из материала по умолчанию.
  const noteRest = await offline(page, { steps: await page.evaluate(() => window.p4.rhythmSteps('note-rest', 4)) });
  pcm(noteRest, [0, 1, 2, 3]); near(noteRest.finishAt, 4, 0.0001);
  // «Синкопа с лигой»: нота 2 держится через середину такта, атаки на 0; 0,5; 0,75 и 1,25 с.
  const tied = await offline(page, { steps: await page.evaluate(() => window.p4.rhythmSteps('tied-syncopation', 4)) });
  pcm(tied, [0, 0.5, 0.75, 1.25]);
  return { noteRest: noteRest.bass, tied: tied.bass };
});

check('offline-tie-across-barline-sounds-one-attack-for-the-held-note', 'api', async ({ page }) => {
  // 120 BPM: четверть E:0, затем E:1 на 0,5 с, продолжение той же ноты по лиге (шаг 3) без атаки, E:3 на 1,5 с.
  const result = await offline(page, { steps: [{ note: 0, grids: 4 }, { note: 1, grids: 4 }, { note: 1, grids: 4, tie: true }, { note: 2, grids: 4 }] });
  onsets(result.bass.onsets, [0, 0.5, 1.5]);
  return result.bass;
});

check('offline-echo-step-and-muted-reference-keep-timing-without-bass-sound', 'api', async ({ page }) => {
  // Шаг «эха» (audible: false) не звучит, но время и запись ноты остаются.
  const echo = await offline(page, { steps: [{ note: 0, grids: 4 }, { note: 1, grids: 4, audible: false }] });
  onsets(echo.bass.onsets, [0]);
  assert.deepEqual(echo.trace.filter(event => event.type === 'note').map(event => event.audible), [true, false]);
  // Эталон выключен громкостью: басовый канал молчит, клик метронома слышен на долях.
  const muted = await page.evaluate(async config => {
    window.p4.player.setVolumes({ bass: 0 });
    try { return await window.p4.player.renderOffline(window.p4.makeConfig(config)); }
    finally { window.p4.player.setVolumes({ bass: 0.65 }); }
  }, { metronome: { enabled: true, mode: 'all', subdivision: 'quarter' } });
  assert.ok(muted.bass.peak < 0.0001, `Басовый канал молчит: ${muted.bass.peak}`);
  onsets(muted.click.onsets, [0, 0.5, 1, 1.5]);
  return { echo: echo.bass, muted: { bass: muted.bass, click: muted.click } };
});

check('offline-groove-hits-sound-on-bar-steps-in-the-same-clock', 'api', async ({ page }) => {
  const groove = Array.from({ length: 16 }, (_, step) => step === 0 ? [{ sound: 'kick', velocity: 1 }] : step === 8 ? [{ sound: 'snare', velocity: 1 }] : []);
  const result = await offline(page, { steps: [{ note: 0, grids: 16 }], groove, repeat: 'once' });
  // Бочка на «раз» (0 с) и малый на «3» (1 с) — на шине подложки, в одном времени с басом.
  onsets(result.groove.onsets, [0, 1]);
  onsets(result.bass.onsets, [0]);
  assert.ok(result.groove.peak > 0.01);
  return result.groove;
});

check('offline-swing-delays-only-the-weak-eighth', 'api', async ({ page }) => {
  // Свинг 66: слабая восьмая сдвигается на 0,64 шестнадцатой = 0,08 с при 120 BPM; сильные доли на месте.
  const result = await offline(page, { steps: [0, 1, 2, 3].map(note => ({ note, grids: 2 })), swing: 66 });
  onsets(result.bass.onsets, [0, 0.33, 0.5, 0.83]);
  return result.bass;
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

check('live-hold-chord-keeps-sounding-after-pause-in-the-middle-of-a-bar', 'api', async ({ page }) => {
  // Пауза на второй доле такта и продолжение: аккорд «Держать» текущего такта доигрывается, а не молчит до следующей границы.
  await fixtureConfig(page, { repeat: 'infinite', countIn: false, steps: [bar(0), bar(1)], chords: { mode: 'hold', bars: [C_CHORD, A_CHORD] } });
  await fixtureAction(page, 'start');
  await waitSnapshot(page, state => state.transportBeat >= 1.7 && state.transportBeat < 2);
  await fixtureAction(page, 'pause'); await fixtureAction(page, 'resume');
  const resumed = await waitSnapshot(page, state => state.trace.some(event => event.type === 'chord' && !event.cancelled && event.absoluteGrid % 16 !== 0 && event.time <= state.audioTime));
  const chord = resumed.trace.find(event => event.type === 'chord' && !event.cancelled && event.absoluteGrid % 16 !== 0);
  assert.ok(chord, 'после продолжения посреди такта нет события аккорда');
  await fixtureAction(page, 'stop');
  return { chord };
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
  // Опрос по таймеру: на виде «Гриф» подсвечена ровно одна нота — та, что названа в «Сейчас».
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

check('ui-play-tempo-step-during-playback-keeps-playing-and-is-remembered-for-the-exercise', 'ui', async ({ page }) => {
  const initial = await openPlay(page);
  await playScene(page).locator('[data-play]').click();
  const playing = await waitPlay(page, state => state.status === 'playing' && state.note >= 1, null, 20000);
  await playScene(page).locator('[data-bpm-step]:not([data-bpm-step^="-"])').click();
  const changed = await waitPlay(page, (state, bpm) => state.bpm > bpm, initial.bpm, 3000);
  const later = await waitPlay(page, (state, note) => state.status === 'playing' && state.note > note, changed.note, 5000);
  assert.equal(later.bpm, changed.bpm, 'Темп держится, игра не остановлена');
  await focusTitle(page); await page.keyboard.press('Escape'); await waitPlay(page, state => state.status === 'stopped', null, 3000);
  // Темп упражнения запоминается при остановке (D-050): упражнение снова открывается с ним.
  await playScene(page).locator('[data-back]').first().click();
  const reopened = await openPlay(page);
  assert.equal(reopened.bpm, changed.bpm, 'Темп упражнения сохранён при остановке');
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

check('ui-play-four-views-fit-1280x720-after-a-pass-with-rating-and-open-sound-panel', 'ui', async ({ page }) => {
  // R-026: TAB, гриф и транспорт помещаются без прокрутки в окне 1280×720, в том числе после прохода (с оценкой подхода).
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPlay(page);
  await playScene(page).locator('[data-flag="loop"]').click();
  await playScene(page).locator('[data-bpm]').fill('200'); await playScene(page).locator('[data-bpm]').press('Enter');
  await focusTitle(page); await page.keyboard.press('Space');
  await playScene(page).getByRole('group', { name: 'Самооценка подхода' }).waitFor({ timeout: 20000 });
  const sizes = {};
  for (const view of ['board', 'both', 'tab', 'memory']) {
    await playScene(page).locator(`button[data-view="${view}"]`).click();
    for (const panel of [false, true]) {
      if (panel !== (await playScene(page).locator('[data-panel-toggle]').getAttribute('aria-expanded') === 'true')) await playScene(page).locator('[data-panel-toggle]').click();
      const size = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight }));
      assert.ok(size.scrollWidth <= size.clientWidth + 1 && size.scrollHeight <= size.clientHeight + 1, `${view}${panel ? ' + панель' : ''}: прокрутка ${JSON.stringify(size)}`);
      sizes[`${view}${panel ? '+panel' : ''}`] = size;
    }
  }
  return sizes;
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
  'ui-play-tempo-step-during-playback-keeps-playing-and-is-remembered-for-the-exercise',
  'ui-play-smallest-design-window-has-no-page-scroll-while-paused',
], FULL_ONLY.smoke);
await runAudioBrowserChecks(checks);
