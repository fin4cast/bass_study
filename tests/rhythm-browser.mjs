import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runTracksBrowserChecks } from './helpers/tracks-browser-harness.mjs';

const literalV7 = JSON.parse(await readFile(new URL('./fixtures/v7-backup.json', import.meta.url), 'utf8'));
const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });
const root = page => page.getByTestId('rhythm-view');
const playingField = page => root(page).locator('.rhythm-playing-field:visible');
const settingsToggle = page => root(page).locator('button[data-rhythm-settings-toggle]');
const settingsAside = page => root(page).locator('[data-rhythm-panel]:visible .rhythm-side-scroll');
const action = (page, name) => root(page).locator(`[data-rhythm-action="${name}"]`);
const setting = (page, name) => root(page).locator(`[data-rhythm-setting="${name}"]:visible`);
const output = (page, name) => root(page).locator(`[data-rhythm-output="${name}"]`);
const choice = (page, name, value) => root(page).locator(`[data-rhythm-choice="${name}"][data-rhythm-value="${value}"]`);
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
const desktopDockHeightLimit = 184;

async function assertSettings(page, open) {
  const toggle = settingsToggle(page), aside = settingsAside(page);
  const id = await aside.getAttribute('id');
  assert.ok(id);
  assert.equal(await toggle.getAttribute('aria-controls'), id);
  assert.equal(await toggle.getAttribute('aria-expanded'), String(open));
  assert.equal(await aside.isVisible(), open);
  return id;
}

async function setSettings(page, open) {
  const toggle = settingsToggle(page);
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.press('Enter');
  return assertSettings(page, open);
}

async function openGroup(page, selector) {
  const group = root(page).locator(selector);
  assert.equal(await group.evaluate(node => node.open), false);
  await group.locator(':scope > summary').press('Enter');
  assert.equal(await group.evaluate(node => node.open), true);
}

async function meterFieldCoverage(page, count) {
  const coverage = await playingField(page).evaluate(field => {
    const rows = [];
    const groupBounds = [];
    const keyWidths = [];
    for (const group of field.querySelectorAll('.rhythm-beat-group')) {
      const bounds = group.getBoundingClientRect();
      const key = group.querySelector('.rhythm-beat').getBoundingClientRect();
      groupBounds.push(bounds);
      keyWidths.push(key.width / bounds.width);
      let row = rows.find(item => Math.abs(item.top - bounds.top) < 1);
      if (!row) { row = { top: bounds.top, left: bounds.left, right: bounds.right }; rows.push(row); }
      row.left = Math.min(row.left, bounds.left);
      row.right = Math.max(row.right, bounds.right);
    }
    const height = Math.max(...groupBounds.map(bounds => bounds.bottom)) - Math.min(...groupBounds.map(bounds => bounds.top));
    return {
      count: groupBounds.length,
      rows: rows.length,
      width: Math.min(...rows.map(row => (row.right - row.left) / field.clientWidth)),
      height: height / field.clientHeight,
      keyWidth: Math.min(...keyWidths),
    };
  });
  assert.equal(coverage.count, count);
  assert.ok(coverage.width >= .90 && coverage.height >= .80 && coverage.keyWidth >= .80, `Meter groups fill the field: ${JSON.stringify(coverage)}`);
  return coverage;
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert);
}
async function enter(page) {
  await ready(page);
  await page.locator('[data-app-module="harmony"]').click();
  await root(page).waitFor();
}
async function edit(page, name, value) {
  const field = setting(page, name);
  await field.fill(String(value));
  await field.press('Tab');
}
async function state(page, expected) {
  await page.waitForFunction(value => document.querySelector('.rhythm-view')?.dataset.rhythmState === value, expected);
}
async function start(page) {
  await action(page, 'start').click();
  await state(page, 'running');
}
async function openHistory(page) {
  if (!await page.locator('.history-drawer').evaluate(node => node.open)) await page.locator('#open-history').click();
  await page.getByLabel('Название пресета', { exact: true }).waitFor();
}
async function exported(page) {
  await openHistory(page);
  const download = page.waitForEvent('download');
  await page.locator('[data-history-action="export"]').click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}
async function raw(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Readonly reader encountered a missing database')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const stores = [...db.objectStoreNames];
      const transaction = db.transaction(stores, 'readonly');
      const done = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
      const get = request => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const preferences = transaction.objectStore('preferences');
      const [current, presets, history, profile, practiceDrafts, rhythmProjects, activeRhythmProjectId] = await Promise.all([
        get(preferences.get('current')),
        get(transaction.objectStore('presets').getAll()),
        get(transaction.objectStore('history').getAll()),
        get(transaction.objectStore('profile').get('current')),
        get(transaction.objectStore('practiceDrafts').getAll()),
        stores.includes('rhythmProjects') ? get(transaction.objectStore('rhythmProjects').getAll()) : [],
        get(preferences.get('rhythm-selection')),
      ]);
      await done;
      return { version: db.version, stores, preferences: current, presets, history, profile, practiceDrafts, rhythmProjects, activeRhythmProjectId: activeRhythmProjectId ?? null };
    } finally { db.close(); }
  });
}
async function seedDatabase(page, origin, snapshot) {
  const response = await page.goto(`${origin}/vendor/music-bank/patch-manifest.json`);
  assert.equal(response.status(), 200);
  assert.equal(await page.locator('#history-mount').count(), 0);
  await page.evaluate(async snapshot => {
    if (location.origin !== 'http://localhost:4173') throw new Error('Unexpected test origin');
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('bass-study');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Isolated test database is still open'));
    });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study', snapshot.schemaVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        const preferences = db.createObjectStore('preferences');
        preferences.put(snapshot.preferences, 'current');
        if (snapshot.activeRhythmProjectId) preferences.put(snapshot.activeRhythmProjectId, 'rhythm-selection');
        db.createObjectStore('profile').put(snapshot.profile, 'current');
        const stores = ['presets', 'history', 'practiceDrafts'];
        if (snapshot.schemaVersion >= 8) stores.push('rhythmProjects');
        for (const name of stores) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          for (const value of snapshot[name]) store.put(value);
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
  }, snapshot);
}

async function observe(context) {
  await context.addInitScript(() => {
    const Original = window.AudioContext;
    const contexts = [];
    const analysers = [];
    window.AudioContext = new Proxy(Original, {
      construct(target, args) {
        const context = Reflect.construct(target, args);
        contexts.push(context);
        return context;
      },
    });
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...ports) {
      if (destination === this.context.destination) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        connect.call(this, analyser);
        analysers.push(analyser);
      }
      return connect.call(this, destination, ...ports);
    };
    window.__rhythmObservation = {
      count: () => contexts.length,
      async sample(ms) {
        const end = performance.now() + ms;
        let peak = 0;
        let samples = 0;
        while (performance.now() < end) {
          for (const analyser of analysers) {
            const data = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(data);
            for (const value of data) peak = Math.max(peak, Math.abs(value));
            samples += data.length;
          }
          await new Promise(resolve => setTimeout(resolve, 12));
        }
        return { peak, samples };
      },
    };
  });
}
const sample = (page, ms = 550) => page.evaluate(ms => window.__rhythmObservation.sample(ms), ms);

check('offline-click-subdivisions-and-silent-bar-boundary-use-real-isolated-pcm', 'api', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const { DEFAULT_RHYTHM_PREFERENCES } = await import('/src/rhythm/model.ts');
    const { renderRhythmOffline } = await import('/src/audio/rhythm.ts');
    const preferences = structuredClone(DEFAULT_RHYTHM_PREFERENCES);
    Object.assign(preferences.metronome, {
      bpm: 240, bpmUnit: 'quarter', kit: 'bell',
      meter: { beats: 6, denominator: 8, groups: [3, 3] },
      division: 2, accents: [0, 0, 0, 0, 0, 0], substeps: Array(6).fill(true),
    });
    Object.assign(preferences.metronome.training, { silentEnabled: true, soundBars: 1, silentBars: 1 });
    const result = await renderRhythmOffline({ preferences }, { durationSeconds: 2.2, sampleRate: 48000 });
    const peak = (source, from, to) => {
      const data = result.buffer.getChannelData(result.sources.indexOf(source));
      let maximum = 0;
      for (let i = Math.round(from * result.buffer.sampleRate); i < Math.round(to * result.buffer.sampleRate); i++) maximum = Math.max(maximum, Math.abs(data[i]));
      return maximum;
    };
    return {
      sources: result.sources,
      strong: peak('accent', 0, 2.2), ordinary: peak('click', 0, 2.2),
      beforeOffbeat: peak('subdivision', 0, .06), offbeat: peak('subdivision', .065, .11),
      beforeBoundary: peak('subdivision', .74, .75), silent: peak('subdivision', .75, 1.5),
      nextOffbeat: peak('subdivision', 1.565, 1.61),
    };
  });
  assert.equal(evidence.strong, 0);
  assert.equal(evidence.ordinary, 0);
  assert.equal(evidence.beforeOffbeat, 0);
  assert.ok(evidence.offbeat > .001 && evidence.beforeBoundary > .00001 && evidence.nextOffbeat > .001);
  assert.ok(evidence.silent < 1e-7, JSON.stringify(evidence));
  return evidence;
});

check('offline-rhythm-lanes-velocity-and-mute-preserve-the-other-lane-waveform', 'api', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const { DEFAULT_RHYTHM_PREFERENCES, createDefaultRhythmProject } = await import('/src/rhythm/model.ts');
    const { renderRhythmOffline } = await import('/src/audio/rhythm.ts');
    const preferences = { ...structuredClone(DEFAULT_RHYTHM_PREFERENCES), view: 'rhythm' };
    const project = structuredClone(createDefaultRhythmProject());
    Object.assign(project, { bpm: 120, repeat: 'once', scope: 'pattern', countIn: true, overlay: true });
    const render = () => renderRhythmOffline({ preferences, project }, { durationSeconds: 4.2, sampleRate: 48000 });
    const full = await render();
    const lane = project.patterns.find(pattern => pattern.id === project.activePatternId).lanes[0];
    const first = lane.steps.findIndex(Boolean);
    const originalVelocity = lane.velocities[first];
    lane.velocities[first] = originalVelocity * .25;
    const quiet = await render();
    project.channels.find(channel => channel.id === lane.channelId).muted = true;
    const muted = await render();
    project.channels.find(channel => channel.id === lane.channelId).muted = false;
    project.channels.find(channel => channel.id === lane.channelId).solo = true;
    const solo = await render();
    const source = `lane:${lane.channelId}`;
    const other = full.sources.find(id => id.startsWith('lane:') && id !== source);
    const samples = (take, id) => take.buffer.getChannelData(take.sources.indexOf(id));
    const otherAfterMute = samples(muted, other);
    const firstPeak = take => {
      const start = Math.round((2 + first / 8) * 48000);
      return Math.max(...samples(take, source).slice(start, start + 2200).map(Math.abs));
    };
    return {
      finishAt: full.finishAt, firstPeak: firstPeak(full), quietPeak: firstPeak(quiet), mutedPeak: firstPeak(muted),
      countInLanePeak: Math.max(...samples(full, source).slice(0, 96000).map(Math.abs)),
      otherMaxDifference: samples(full, other).reduce((peak, value, index) => Math.max(peak, Math.abs(value - otherAfterMute[index])), 0),
      soloSignal: firstPeak(solo), otherSilentInSolo: samples(solo, other).every(value => value === 0),
    };
  });
  near(evidence.finishAt, 4, .00001);
  assert.ok(evidence.firstPeak > .001);
  near(evidence.quietPeak / evidence.firstPeak, .25, .005);
  assert.equal(evidence.mutedPeak, 0);
  assert.equal(evidence.countInLanePeak, 0);
  assert.ok(evidence.otherMaxDifference < 1e-6, JSON.stringify(evidence));
  assert.ok(evidence.soloSignal > .001 && evidence.otherSilentInSolo);
  return evidence;
});

check('offline-ramp-counts-silent-practice-bars-and-holds-target-tempo', 'api', async ({ page }) => {
  const frames = await page.evaluate(async () => {
    const { DEFAULT_RHYTHM_PREFERENCES } = await import('/src/rhythm/model.ts');
    const { renderRhythmOffline } = await import('/src/audio/rhythm.ts');
    const preferences = structuredClone(DEFAULT_RHYTHM_PREFERENCES);
    Object.assign(preferences.metronome, {
      bpm: 120, countIn: true, accents: [2, 1], meter: { beats: 2, denominator: 4, groups: [2] },
      training: { silentEnabled: true, soundBars: 1, silentBars: 1, rampEnabled: true, everyBars: 1, stepBpm: 20, targetBpm: 150 },
    });
    const { trace, buffer, sources } = await renderRhythmOffline({ preferences }, { bars: 4, sampleRate: 48000 });
    const accents = buffer.getChannelData(sources.indexOf('accent'));
    return trace.filter(event => event.type === 'frame' && event.position.beat === 1).map(frame => {
      const first = Math.round(frame.time * 48000);
      return { time: frame.time, bpm: frame.bpm, phase: frame.position.phase, peak: Math.max(...accents.slice(first, first + 2400).map(Math.abs)) };
    });
  });
  assert.deepEqual(frames.map(frame => frame.bpm), [120, 120, 140, 150, 150]);
  [0, 1, 2, 2 + 120 / 140, 2 + 120 / 140 + 120 / 150].forEach((expected, index) => near(frames[index].time, expected, .00001));
  assert.deepEqual(frames.map(frame => frame.peak > .001), [true, true, false, true, false]);
  return { frames };
});

check('offline-overlay-inherits-accents-and-triplets-on-the-project-clock', 'api', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const { DEFAULT_RHYTHM_PREFERENCES, createDefaultRhythmProject } = await import('/src/rhythm/model.ts');
    const { renderRhythmOffline } = await import('/src/audio/rhythm.ts');
    const preferences = { ...structuredClone(DEFAULT_RHYTHM_PREFERENCES), view: 'rhythm' };
    Object.assign(preferences.metronome, {
      bpm: 120, division: 3, swing: 70, accents: [2, 0, 1, 0], substeps: [false, true, true, false, false, false, true, false],
    });
    const project = { ...createDefaultRhythmProject(), bpm: 120, swing: 68, repeat: 'once', overlay: true };
    const take = await renderRhythmOffline({ preferences, project }, { durationSeconds: 2.1, sampleRate: 48000 });
    const frameTimes = take.trace.filter(event => event.type === 'frame').map(event => event.time);
    const clickTimes = take.trace.filter(event => event.type === 'hit' && !event.source.startsWith('lane:')).map(({ source, time }) => [source, time]);
    const subdivisions = take.buffer.getChannelData(take.sources.indexOf('subdivision'));
    const peak = (from, to) => Math.max(...subdivisions.slice(Math.round(from * 48000), Math.round(to * 48000)).map(Math.abs));
    return { frameTimes, clickTimes, beforeTriplet: peak(.30, .33), triplet: peak(.335, .36), finishAt: take.finishAt };
  });
  assert.equal(evidence.frameTimes.length, 16);
  near(evidence.frameTimes[1], .17, 1e-6);
  near(evidence.frameTimes[2], .34, 1e-6);
  assert.deepEqual(evidence.clickTimes.map(([source]) => source), ['accent', 'subdivision', 'subdivision', 'click', 'subdivision']);
  [0, 1 / 3, 2 / 3, 1, 5 / 3].forEach((time, index) => near(evidence.clickTimes[index][1], time, 1e-6));
  assert.equal(evidence.beforeTriplet, 0);
  assert.ok(evidence.triplet > .001);
  near(evidence.finishAt, 2, 1e-6);
  return evidence;
});

check('live-overlay-pause-keeps-a-future-click-inside-the-current-groove-step', 'api', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const { DEFAULT_RHYTHM_PREFERENCES, createDefaultRhythmProject } = await import('/src/rhythm/model.ts');
    const { createRhythmPlayer } = await import('/src/audio/rhythm.ts');
    const preferences = { ...structuredClone(DEFAULT_RHYTHM_PREFERENCES), view: 'rhythm' };
    Object.assign(preferences.metronome, { bpm: 30, division: 3, accents: [2, 0, 0, 0], substeps: [true, false, false, false, false, false, false, false] });
    const project = { ...createDefaultRhythmProject(), bpm: 30, overlay: true };
    const player = createRhythmPlayer();
    async function at(time) {
      const limit = performance.now() + 2000;
      let snapshot = player.getSnapshot();
      while (snapshot.audioTime < time && performance.now() < limit) {
        await new Promise(resolve => setTimeout(resolve, 8));
        snapshot = player.getSnapshot();
      }
      return snapshot;
    }
    try {
      const initial = await player.start({ preferences, project });
      await at(initial.startAt + .54);
      player.pause();
      const paused = player.getSnapshot();
      const resumed = await player.resume();
      const after = await at(resumed.startAt + .3);
      const clicks = after.trace.filter(event => event.type === 'hit' && event.source === 'subdivision');
      return { first: initial.startAt, step: paused.position.step, paused: paused.audioTime, resumed: resumed.startAt,
        cancelled: clicks.filter(event => event.cancelled).map(event => event.time),
        actual: clicks.filter(event => !event.cancelled && !event.continuation && event.time <= after.audioTime).map(event => event.time) };
    } finally { await player.dispose(); }
  });
  assert.equal(evidence.step, 1);
  assert.ok(evidence.paused < evidence.first + 2 / 3);
  assert.equal(evidence.cancelled.length, 1);
  assert.equal(evidence.actual.length, 1);
  near(evidence.cancelled[0] - evidence.first, 2 / 3, .005);
  near(evidence.actual[0] - evidence.resumed, evidence.cancelled[0] - evidence.paused, .01);
  return evidence;
});

check('live-fractional-count-in-pause-resumes-tail-and-remaining-interval', 'api', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const { DEFAULT_RHYTHM_PREFERENCES } = await import('/src/rhythm/model.ts');
    const { createRhythmPlayer } = await import('/src/audio/rhythm.ts');
    const preferences = structuredClone(DEFAULT_RHYTHM_PREFERENCES);
    Object.assign(preferences.metronome, {
      bpm: 120, countIn: true, kit: 'bell', accents: [2, 1], meter: { beats: 2, denominator: 4, groups: [2] },
    });
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const player = createRhythmPlayer();
    try {
      await player.start({ preferences });
      await wait(105);
      player.pause();
      const paused = player.getSnapshot();
      const first = paused.trace.find(event => event.type === 'frame' && event.frameIndex === 0 && !event.cancelled);
      await wait(160);
      const silence = player.getSnapshot().output.peak;
      const resumed = await player.resume();
      await wait(500);
      const live = player.getSnapshot();
      const actual = live.trace.filter(event => !event.cancelled && event.time <= live.audioTime);
      const second = actual.find(event => event.type === 'frame' && event.frameIndex === 1);
      return {
        firstAt: first.time, pausedAt: paused.audioTime, resumedAt: resumed.startAt, secondAt: second.time,
        silence, activeMsWhileCounting: paused.practiceDurationMs, phase: live.phase,
        firstAttacks: actual.filter(event => event.type === 'hit' && event.frameIndex === 0 && !event.continuation).length,
        continuations: actual.filter(event => event.type === 'hit' && event.continuation).length,
      };
    } finally { await player.dispose(); }
  });
  assert.ok(evidence.pausedAt > evidence.firstAt && evidence.pausedAt < evidence.firstAt + .5);
  near(evidence.secondAt - evidence.resumedAt, .5 - (evidence.pausedAt - evidence.firstAt), .01);
  assert.equal(evidence.phase, 'count-in');
  assert.equal(evidence.activeMsWhileCounting, 0);
  assert.equal(evidence.firstAttacks, 1);
  assert.ok(evidence.continuations > 0 && evidence.silence < 1e-6);
  return evidence;
});

check('live-step-edit-and-tempo-edit-use-different-boundaries-and-seal-practice', 'api', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const { DEFAULT_RHYTHM_PREFERENCES, createDefaultRhythmProject } = await import('/src/rhythm/model.ts');
    const { createRhythmPlayer } = await import('/src/audio/rhythm.ts');
    const preferences = { ...structuredClone(DEFAULT_RHYTHM_PREFERENCES), view: 'rhythm' };
    const project = structuredClone(createDefaultRhythmProject());
    project.bpm = 240;
    const sealed = [];
    const player = createRhythmPlayer({ onPracticeEnd: clock => sealed.push(clock) });
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await player.start({ preferences, project });
      await wait(145);
      const candidate = structuredClone(project);
      candidate.bpm = 200;
      candidate.patterns[0].lanes[0].velocities = candidate.patterns[0].lanes[0].velocities.map(velocity => velocity ? .25 : 0);
      const before = player.getSnapshot();
      const lastScheduled = before.trace.filter(event => event.type === 'frame').at(-1).frameIndex;
      const queued = player.configure({ preferences, project: candidate });
      await wait(1160);
      const after = player.getSnapshot();
      const frames = after.trace.filter(event => event.type === 'frame' && !event.cancelled && event.time <= after.audioTime);
      const firstEdit = frames.find(event => event.epoch !== before.epoch);
      const tempoEdit = frames.find(event => event.bpm === 200);
      return { queued, lastScheduled, firstEdit, tempoEdit, oldTempo: sealed[0]?.playback.project.bpm,
        oldVelocity: sealed[0]?.playback.project.patterns[0].lanes[0].velocities[0],
        sealedDurations: sealed.map(clock => clock.durationMs), runId: after.runId, initialRun: before.runId };
    } finally { await player.dispose(); }
  });
  assert.equal(evidence.queued, 'queued');
  assert.equal(evidence.firstEdit.frameIndex, evidence.lastScheduled + 1);
  assert.equal(evidence.firstEdit.bpm, 240);
  assert.equal(evidence.tempoEdit.frameIndex, 16);
  assert.equal(evidence.tempoEdit.position.absoluteBar, 2);
  assert.equal(evidence.oldTempo, 240);
  assert.equal(evidence.oldVelocity, 1);
  assert.ok(evidence.sealedDurations.every(duration => duration > 0));
  assert.equal(evidence.runId, evidence.initialRun);
  return evidence;
});

check('product-meter-group-tempo-unit-offbeats-and-invalid-range', 'ui', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await enter(page);
  const defaultField = await playingField(page).boundingBox();
  assert.ok(defaultField);
  assert.equal(await page.locator('[data-app-module="harmony"]').textContent(), 'Метроном и ритм');
  const pulses = output(page, 'beats');
  const beats = pulses.locator('[data-rhythm-beat]');
  const subdivisions = pulses.locator('[data-rhythm-substep]');
  const groupStarts = () => pulses.locator('.rhythm-beat-group').evaluateAll(groups => groups.flatMap((group, index) => group.classList.contains('is-group-start') ? [index + 1] : []));
  assert.deepEqual(await beats.evaluateAll(keys => keys.map(key => Number(key.dataset.rhythmBeat) + 1)), [1, 2, 3, 4]);
  assert.deepEqual(await groupStarts(), [1]);
  assert.equal(await subdivisions.count(), 0);
  const defaultCoverage = await meterFieldCoverage(page, 4);
  await assertSettings(page, false);
  assert.equal(await output(page, 'meter-label').innerText(), '4/4');
  assert.equal(await output(page, 'division-label').isVisible(), true);
  assert.equal(await output(page, 'division-label').innerText(), 'Четверти');
  await setSettings(page, true);
  assert.equal(await root(page).locator('.rhythm-metro-parameters').isVisible(), true);
  assert.equal(await choice(page, 'bpmUnit', 'dotted-quarter').isDisabled(), true);
  await choice(page, 'denominator', 4).press('ArrowRight');
  assert.equal(await choice(page, 'denominator', 8).evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Space');
  assert.equal(await choice(page, 'denominator', 8).getAttribute('aria-pressed'), 'true');
  await edit(page, 'beats', 6);
  assert.equal(await choice(page, 'bpmUnit', 'dotted-quarter').getAttribute('aria-pressed'), 'true');
  assert.equal(await choice(page, 'bpmUnit', 'dotted-quarter').isEnabled(), true);
  await edit(page, 'bpm', 60);
  await choice(page, 'bpmUnit', 'eighth').press('Enter');
  assert.equal(await setting(page, 'bpm').inputValue(), '60');
  await edit(page, 'beats', 7);
  await edit(page, 'groups', '3+2+2');
  assert.equal(await beats.count(), 7);
  assert.deepEqual(await groupStarts(), [1, 4, 6]);
  assert.equal(await output(page, 'meter-label').innerText(), '7/8');
  const swingDial = root(page).locator('[data-rhythm-setting="metronomeSwing"]');
  assert.equal(await swingDial.isDisabled(), true);
  await root(page).locator('[data-rhythm-division="4"]').click();
  await choice(page, 'metro-swing-mode', 'sixteenth').press('Enter');
  await root(page).locator('[data-rhythm-division="2"]').click();
  assert.equal(await output(page, 'division-label').innerText(), 'Шестнадцатые');
  assert.equal(await setting(page, 'metronomeSwing').isEnabled(), true);
  assert.equal(await choice(page, 'metro-swing-mode', 'sixteenth').isDisabled(), true);
  assert.equal(await choice(page, 'metro-swing-mode', 'eighth').isDisabled(), true);
  assert.equal(await choice(page, 'metro-swing-mode', 'eighth').getAttribute('aria-pressed'), 'true');
  assert.equal(await subdivisions.count(), 7);
  await subdivisions.first().click();
  const copy = await exported(page);
  assert.deepEqual(copy.preferences.rhythm.metronome.meter, { beats: 7, denominator: 8, groups: [3, 2, 2] });
  assert.deepEqual(copy.preferences.rhythm.metronome.accents, [2, 1, 1, 2, 1, 2, 1]);
  assert.equal(copy.preferences.rhythm.metronome.substeps.length, 7);
  assert.equal(copy.preferences.rhythm.metronome.substeps[0], false);
  assert.equal(copy.preferences.rhythm.metronome.swingMode, 'sixteenth');
  await page.locator('#open-history').click();
  const groupedAccent = root(page).locator('[data-rhythm-beat="3"]');
  assert.equal(await groupedAccent.getAttribute('data-level'), '2');
  await groupedAccent.click();
  assert.notEqual(await groupedAccent.getAttribute('data-level'), '2');
  await start(page);
  await pulses.locator('.rhythm-beat-group.is-playing .rhythm-beat-lamp').waitFor();
  await edit(page, 'bpm', 300);
  await state(page, 'stopped');
  assert.equal(await action(page, 'start').isDisabled(), true);
  await output(page, 'error').waitFor();
  await edit(page, 'bpm', 60);
  await edit(page, 'beats', 12);
  await edit(page, 'groups', '3+3+3+3');
  await root(page).locator('[data-rhythm-division="4"]').click();
  await settingsAside(page).getByRole('button', { name: 'Свернуть', exact: true }).press('Enter');
  await assertSettings(page, false);
  assert.equal(await output(page, 'meter-label').innerText(), '12/8');
  assert.equal(await output(page, 'division-label').isVisible(), true);
  assert.equal(await output(page, 'division-label').innerText(), 'Тридцать вторые');
  const denseField = await playingField(page).boundingBox();
  assert.ok(denseField);
  near(denseField.width, defaultField.width, 1);
  near(denseField.height, defaultField.height, 1);
  assert.equal(await beats.count(), 12);
  assert.equal(await subdivisions.count(), 36);
  assert.deepEqual(await groupStarts(), [1, 4, 7, 10]);
  assert.equal(await pulses.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return [...node.children].every(group => {
      const rect = group.getBoundingClientRect();
      return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1;
    });
  }), true);
  const lastSubdivision = subdivisions.last();
  const enabled = await lastSubdivision.getAttribute('aria-pressed');
  await lastSubdivision.press('Space');
  assert.notEqual(await lastSubdivision.getAttribute('aria-pressed'), enabled);
  assert.equal(await lastSubdivision.evaluate(node => node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none'), true);
  const meterCoverage = [await meterFieldCoverage(page, 12)];
  await setSettings(page, true);
  for (let count = 2; count < 12; count++) {
    await edit(page, 'beats', count);
    assert.equal(await subdivisions.count(), 3 * count);
    meterCoverage.push(await meterFieldCoverage(page, count));
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  return { defaultFourBeats: true, defaultCoverage, meter: copy.preferences.rhythm.metronome.meter, independentlySavedSubsteps: 7, invalidContextStops: true, denseMeter: { beats: 12, subdivisions: 36, groupStarts: [1, 4, 7, 10], fieldSizeStable: true }, meterCoverage, keyboardFocusVisible: true };
});

check('product-linked-bpm-edits-in-both-tabs-and-survives-reload', 'ui', async ({ page }) => {
  await enter(page);
  const select = mode => root(page).locator(`[data-rhythm-mode="${mode}"]`).click();
  const bpm = () => setting(page, 'bpm').inputValue();
  await edit(page, 'bpm', 111);
  await select('rhythm');
  await edit(page, 'bpm', 125);
  await setSettings(page, true);
  const master = root(page).locator('.rhythm-master .rhythm-fader');
  const beforeLink = await master.boundingBox();
  await setting(page, 'rhythmClick').check();
  await output(page, 'linked-tempo').waitFor();
  near((await master.boundingBox()).y, beforeLink.y, 1);
  assert.equal(await bpm(), '111');
  await edit(page, 'bpm', 121);
  await select('metronome');
  assert.equal(await bpm(), '121');
  near((await master.boundingBox()).y, beforeLink.y, 1);
  await edit(page, 'bpm', 135);
  await select('rhythm');
  assert.equal(await bpm(), '135');
  const copy = await exported(page);
  assert.equal(copy.preferences.rhythm.metronome.bpm, 135);
  assert.equal(copy.rhythmProjects[0].bpm, 135);
  assert.equal(copy.rhythmProjects[0].overlay, true);
  await page.reload();
  await ready(page);
  await state(page, 'stopped');
  assert.equal(await bpm(), '135');
  await setSettings(page, true);
  await setting(page, 'rhythmClick').uncheck();
  await edit(page, 'bpm', 100);
  await select('metronome');
  assert.equal(await bpm(), '135');
  return { adoptedMetronomeBpm: 111, editsFromBothTabs: [121, 135], persistedBpm: 135, afterUnlink: { rhythm: 100, metronome: 135 } };
});

check('product-count-in-is-independent-and-applies-only-on-fresh-start', 'ui', async ({ page }) => {
  await enter(page);
  const select = mode => root(page).locator(`[data-rhythm-mode="${mode}"]`).click();
  const countIn = root(page).getByRole('switch', { name: 'Отсчёт', exact: true });
  const assertTransport = async (expectedState, expectedPhase) => {
    const { rhythmState, rhythmPhase } = await root(page).evaluate(node => ({
      rhythmState: node.dataset.rhythmState,
      rhythmPhase: node.dataset.rhythmPhase,
    }));
    assert.deepEqual([rhythmState, rhythmPhase], [expectedState, expectedPhase]);
  };
  assert.equal(await countIn.getAttribute('type'), 'checkbox');
  const descriptionId = await countIn.getAttribute('aria-describedby');
  assert.ok(descriptionId);
  assert.equal(await page.evaluate(id => document.getElementById(id)?.textContent?.trim(), descriptionId), 'Один такт перед новым стартом');

  await countIn.press('Space');
  assert.equal(await countIn.isChecked(), true);
  await select('rhythm');
  assert.equal(await countIn.isChecked(), false);
  await select('metronome');
  assert.equal(await countIn.isChecked(), true);
  await edit(page, 'bpm', 120);
  await start(page);
  await assertTransport('running', 'count-in');
  await countIn.press('Space');
  assert.equal(await countIn.isChecked(), false);
  await assertTransport('running', 'count-in');
  await action(page, 'faster').click();
  await assertTransport('running', 'count-in');
  await action(page, 'stop').click();
  await start(page);
  await assertTransport('running', 'practice');
  await action(page, 'stop').click();

  await select('rhythm');
  assert.equal(await countIn.isChecked(), false);
  await edit(page, 'bpm', 120);
  await start(page);
  await assertTransport('running', 'practice');
  await action(page, 'pause').click();
  await assertTransport('paused', 'practice');
  await countIn.press('Space');
  assert.equal(await countIn.isChecked(), true);
  await assertTransport('paused', 'practice');
  await action(page, 'resume').click();
  await state(page, 'running');
  await assertTransport('running', 'practice');
  await action(page, 'stop').click();
  await start(page);
  await assertTransport('running', 'count-in');
  await action(page, 'stop').click();
  await select('metronome');
  assert.equal(await countIn.isChecked(), false);
  return { switchOperableByKeyboard: true, independentSettings: true, preservedCountInAndPausedPractice: true, freshStartsUseNewSetting: true };
});

check('live-product-pause-owner-switch-and-explicit-resume', 'ui', async ({ page, context }) => {
  await observe(context);
  await page.reload();
  await enter(page);
  const initialContexts = await page.evaluate(() => window.__rhythmObservation.count());
  await edit(page, 'bpm', 240);
  await start(page);
  assert.ok((await sample(page)).peak > .001);
  await action(page, 'pause').click();
  await state(page, 'paused');
  await delay(140);
  assert.ok((await sample(page, 160)).peak < 1e-6);
  await action(page, 'resume').click();
  await state(page, 'running');
  await page.locator('[data-app-module="ear"]').click();
  await state(page, 'paused');
  await enter(page);
  await state(page, 'paused');
  await action(page, 'resume').click();
  await state(page, 'running');
  assert.ok((await sample(page)).peak > .001);
  const contexts = await page.evaluate(() => window.__rhythmObservation.count());
  assert.equal(contexts - initialContexts, 1);
  return { initialContexts, rhythmContexts: contexts - initialContexts, liveSignal: true, pausedSilence: true, noAutomaticResume: true };
});

check('leaving-section-cancels-audition-waiting-for-audio-context', 'ui', async ({ page, context }) => {
  await observe(context);
  await page.reload();
  await enter(page);
  await setSettings(page, true);
  const sounds = root(page).locator('.rhythm-sounds details');
  const soundToggle = sounds.locator(':scope > summary');
  assert.equal(await sounds.evaluate(node => node.open), false);
  await soundToggle.press('Enter');
  const kits = output(page, 'kits').getByRole('button');
  assert.equal(await kits.count(), 6);
  await kits.nth(1).press('Enter');
  assert.equal(await kits.nth(1).getAttribute('aria-pressed'), 'true');
  const selectedSound = await output(page, 'kit-name').innerText();
  await soundToggle.press('Enter');
  assert.equal(await sounds.evaluate(node => node.open), false);
  assert.ok(selectedSound);
  assert.equal(await output(page, 'kit-name').innerText(), selectedSound);
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume;
    const gate = new Promise(resolve => { window.__releaseRhythmPreview = resolve; });
    AudioContext.prototype.resume = function () {
      window.__rhythmPreviewWaiting = true;
      return gate.then(() => resume.call(this));
    };
  });
  await action(page, 'preview').click();
  await page.waitForFunction(() => window.__rhythmPreviewWaiting);
  await page.locator('[data-app-module="ear"]').click();
  await page.evaluate(() => window.__releaseRhythmPreview());
  await delay(100);
  const signal = await sample(page);
  assert.ok(signal.peak < 1e-6);
  await enter(page);
  await state(page, 'stopped');
  return { latePreviewSilent: true, selectedSound, previewFromCollapsedSounds: true };
});

check('project-steps-and-full-chain-survive-reload-and-export', 'ui', async ({ page }) => {
  await enter(page);
  await root(page).locator('[data-rhythm-mode="rhythm"]').click();
  const first = root(page).locator('[data-rhythm-step]').first();
  const before = await first.getAttribute('aria-pressed');
  await first.click();
  assert.notEqual(await first.getAttribute('aria-pressed'), before);
  const bars = output(page, 'bars');
  const bar = number => bars.getByRole('button', { name: `Такт ${number}`, exact: true });
  const addBar = bars.locator('[data-rhythm-action="add-bar"]');
  const lengths = settingsAside(page).locator('.rhythm-editor-pattern [data-rhythm-choice="bars"]');
  const length = value => lengths.and(choice(page, 'bars', value));
  const rack = output(page, 'rack').locator('[data-rhythm-step]');
  const stepLevels = () => rack.evaluateAll(steps => steps.map(step => step.dataset.level));
  const velocity = output(page, 'velocity').locator('[data-rhythm-velocity="8"]');
  await assertSettings(page, false);
  assert.equal(await length(1).isHidden(), true);
  assert.equal(await bar(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await bar(2).count(), 0);
  await openGroup(page, '.rhythm-velocity');
  const originalVelocity = await velocity.inputValue();
  await velocity.press('ArrowUp');
  const customVelocity = await velocity.inputValue();
  assert.notEqual(customVelocity, originalVelocity);
  const firstBar = await stepLevels();
  for (const number of [2, 3, 4]) {
    const addNextBar = addBar.and(bars.getByRole('button', { name: `Добавить такт ${number}`, exact: true }));
    assert.equal(await addNextBar.textContent(), '+ Такт');
    await addNextBar.press('Enter');
    await assertSettings(page, false);
    assert.equal(await bar(number).getAttribute('aria-pressed'), 'true');
    assert.equal(await bar(number).evaluate(node => node === document.activeElement), true);
    assert.ok((await stepLevels()).every(level => level === '0'));
    assert.ok(await output(page, 'velocity').locator('[data-rhythm-velocity]').evaluateAll(inputs => inputs.every(input => input.valueAsNumber === 0)));
  }
  assert.equal(await addBar.count(), 0);
  await bar(1).click();
  assert.deepEqual(await stepLevels(), firstBar);
  assert.equal(await velocity.inputValue(), customVelocity);
  await root(page).locator('.rhythm-velocity > summary').press('Enter');
  await setSettings(page, true);
  assert.deepEqual(await lengths.evaluateAll(buttons => buttons.map(button => button.dataset.rhythmValue)), ['1', '2', '3', '4']);
  assert.equal(await length(4).isVisible(), true);
  assert.equal(await length(4).getAttribute('aria-pressed'), 'true');
  await length(3).click();
  assert.equal(await bar(4).count(), 0);
  assert.equal(await addBar.isVisible(), true);

  const pattern = id => output(page, 'patterns').locator(`[data-rhythm-pattern="${id}"]`);
  await pattern('B').click();
  assert.equal(await addBar.isVisible(), true);
  assert.equal(await length(1).getAttribute('aria-pressed'), 'true');
  await length(4).click();
  await bar(4).click();
  assert.equal(await bar(4).getAttribute('aria-pressed'), 'true');
  assert.equal(await addBar.count(), 0);
  await length(1).click();
  assert.equal(await bar(4).count(), 0);
  assert.equal(await bar(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await addBar.isVisible(), true);
  await pattern('A').click();
  assert.equal(await length(3).getAttribute('aria-pressed'), 'true');

  const longName = 'Основной грув с открытым хэтом и вариациями';
  await edit(page, 'pattern-name', longName);
  await openGroup(page, '.rhythm-editor-bar');
  await action(page, 'copy-bar').click();
  await bar(2).click();
  await action(page, 'clear-bar').click();
  assert.ok((await stepLevels()).every(level => level === '0'));
  await action(page, 'copy-bar').click();
  assert.deepEqual(await stepLevels(), firstBar);
  await bar(3).click();
  assert.ok((await stepLevels()).every(level => level === '0'));
  const thirdBarStep = output(page, 'rack').locator('[data-rhythm-channel="kick"][data-rhythm-step="5"]');
  await thirdBarStep.click();
  assert.equal(await thirdBarStep.getAttribute('aria-pressed'), 'true');
  await openGroup(page, '.rhythm-editor-sounds');
  const soundKeys = output(page, 'sounds').locator('[data-rhythm-choice="new-sound"]');
  const sound = await soundKeys.nth(1).getAttribute('data-rhythm-value');
  assert.ok(sound);
  await soundKeys.first().press('ArrowRight');
  assert.equal(await choice(page, 'new-sound', sound).evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Enter');
  await bar(1).click();
  assert.equal(await choice(page, 'new-sound', sound).getAttribute('aria-pressed'), 'true');
  await action(page, 'add-lane').press('Enter');
  assert.equal(await choice(page, 'new-sound', sound).count(), 0);
  const clips = root(page).locator('[data-rhythm-clip]');
  const initialIds = await clips.evaluateAll(items => items.map(item => item.dataset.rhythmClip));
  const editor = output(page, 'clip-editor');
  assert.equal(await editor.isHidden(), true);
  await clips.nth(1).press('Enter');
  await editor.locator('[data-rhythm-clip-action="remove"]').press('Enter');
  assert.equal(await editor.isHidden(), true);
  assert.equal(await clips.nth(1).evaluate(node => document.activeElement === node), true);
  await clips.first().press('Enter');
  assert.equal(await clips.first().getAttribute('title'), longName);
  assert.ok((await editor.locator('.rhythm-clip-editor-title').innerText()).includes(longName));
  const clipPattern = value => editor.locator(`[data-rhythm-clip-select][data-rhythm-value="${value}"]`);
  await clipPattern('A').press('ArrowRight');
  assert.equal(await clipPattern('B').evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Space');
  assert.equal(await clipPattern('B').getAttribute('aria-pressed'), 'true');
  assert.equal(await clipPattern('B').evaluate(node => document.activeElement === node), true);
  await editor.locator('[data-rhythm-clip-action="right"]').press('Enter');
  await clips.nth(1).press('Enter');
  assert.equal(await editor.isHidden(), true);
  const expectedOrder = [initialIds[2], initialIds[0], ...initialIds.slice(3)];
  assert.deepEqual(await clips.evaluateAll(items => items.map(item => item.dataset.rhythmClip)), expectedOrder);
  await setSettings(page, false);
  await root(page).locator('.rhythm-chain-card [data-rhythm-scope="chain"]').click();
  await start(page);
  await clips.first().and(output(page, 'chain').locator('[aria-current="true"].is-playing')).waitFor();
  assert.equal(await clips.first().getAttribute('aria-pressed'), 'false');
  await action(page, 'stop').click();
  assert.equal(await output(page, 'chain').locator('[aria-current="true"]').count(), 0);
  const copy = await exported(page);
  assert.equal(copy.schemaVersion, 10);
  assert.equal(copy.rhythmProjects.length, 1);
  const [project] = copy.rhythmProjects;
  assert.equal(copy.activeRhythmProjectId, project.id);
  assert.ok(project.patterns.length >= 3);
  assert.deepEqual(project.chain.map(clip => clip.id), expectedOrder);
  assert.equal(project.chain[1].patternId, 'B');
  assert.ok(project.channels.some(channel => channel.sound === sound));
  const primaryPattern = project.patterns.find(item => item.id === 'A');
  assert.equal(primaryPattern.bars, 3);
  for (const lane of primaryPattern.lanes) {
    assert.deepEqual(lane.steps.slice(16, 32), lane.steps.slice(0, 16));
    assert.deepEqual(lane.velocities.slice(16, 32), lane.velocities.slice(0, 16));
    assert.deepEqual(lane.steps.slice(32), Array.from({ length: 16 }, (_, step) => lane.channelId === 'kick' && step === 5 ? 1 : 0));
  }
  assert.equal(primaryPattern.lanes.find(lane => lane.channelId === 'kick').velocities[8], Number(customVelocity));
  await page.reload();
  await ready(page);
  await state(page, 'stopped');
  assert.notEqual(await first.getAttribute('aria-pressed'), before);
  assert.equal(await addBar.isVisible(), true);
  await bar(3).click();
  assert.equal(await thirdBarStep.getAttribute('aria-pressed'), 'true');
  await bar(1).click();
  const restored = await exported(page);
  assert.deepEqual(restored.rhythmProjects, copy.rhythmProjects);
  assert.equal(restored.activeRhythmProjectId, project.id);
  const choose = async (name, snapshot) => {
    await page.locator('[data-history-file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) });
    await page.getByTestId('backup-preview').waitFor();
  };
  await choose('legacy-v7.json', literalV7);
  assert.match(await page.getByTestId('backup-preview').innerText(), /0 проектов ритма/);
  assert.deepEqual((await raw(page)).rhythmProjects, copy.rhythmProjects);
  await page.locator('[data-history-action="cancel-restore"]').click();
  await page.locator('#open-history').click();
  await root(page).locator('.rhythm-library > summary').click();
  await edit(page, 'project-name', 'Переименованный проект');
  await action(page, 'save-project').click();
  const renamed = await exported(page);
  assert.equal(renamed.rhythmProjects[0].name, 'Переименованный проект');
  await choose('rhythm-project.json', copy);
  await page.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
  await page.locator('[data-history-action="confirm-restore"]').click();
  await page.getByTestId('backup-preview').waitFor({ state: 'detached' });
  assert.deepEqual((await raw(page)).rhythmProjects, copy.rhythmProjects);
  await state(page, 'stopped');
  await page.locator('#open-history').click();
  await bar(3).click();
  assert.equal(await thirdBarStep.getAttribute('aria-pressed'), 'true');
  const library = root(page).locator('.rhythm-groove-detail-scroll .rhythm-library');
  if (!await library.evaluate(node => node.open)) await library.locator(':scope > summary').click();
  const preset = library.locator('[data-rhythm-preset="funk"]');
  await preset.click();
  assert.equal(await preset.getAttribute('aria-pressed'), 'true');
  assert.equal(await output(page, 'pattern-title').innerText(), 'Фанк');
  assert.equal(await setting(page, 'bpm').inputValue(), '102');
  return { project: project.id, patterns: project.patterns.length, clips: project.chain.length, emptyBarsAddedWithSettingsClosed: [2, 3, 4], copiedVelocity: Number(customVelocity), barClampedAfterResize: true, copiedAndClearedBar: true, persistedPatternBars: 3, keyboardChoices: true, singleClipEditor: true, exactReload: true, legacyPreviewReadOnly: true, exactUiRestore: true, lowerLibraryPreset: 'funk' };
});

check('manual-note-keeps-rhythm-material-and-time-after-changing-project', 'ui', async ({ page }) => {
  await enter(page);
  await root(page).locator('[data-rhythm-mode="rhythm"]').click();
  await root(page).locator('[data-rhythm-step]').first().click();
  await edit(page, 'bpm', 240);
  await start(page);
  await delay(450);
  await action(page, 'stop').click();
  const grooveGeometry = () => root(page).evaluate(view => {
    const stage = view.querySelector('.rhythm-content').getBoundingClientRect();
    const editors = view.querySelector('.rhythm-groove-detail-scroll').getBoundingClientRect();
    const dock = view.querySelector('.rhythm-transport').getBoundingClientRect();
    return { stageHeight: stage.height, editorHeight: editors.height, dockGap: dock.top - stage.bottom };
  });
  const grooveBeforeHistory = await grooveGeometry();
  await openHistory(page);
  const drafts = page.getByLabel('Черновики ручной практики', { exact: true });
  await drafts.waitFor();
  const id = await drafts.locator('option').last().getAttribute('value');
  const before = await raw(page);
  const original = before.practiceDrafts.find(item => item.id === id);
  assert.equal(original.material.kind, 'rhythm');
  assert.equal(original.context, null);
  assert.ok(original.totalReferenceMs > 150);
  await root(page).locator('.rhythm-header').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#history-mount').isVisible(), true);
  const grooveWithHistory = await grooveGeometry();
  assert.ok(grooveWithHistory.editorHeight > 0, 'The lower groove editor remains available with history open');
  for (const key of ['stageHeight', 'editorHeight', 'dockGap']) near(grooveWithHistory[key], grooveBeforeHistory[key], 1);
  await page.locator('#open-history').click();
  await root(page).locator('.rhythm-library > summary').click();
  await action(page, 'duplicate-project').click();
  await page.waitForFunction(async () => (await new Promise((resolve, reject) => {
    const request = indexedDB.open('bass-study');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction('rhythmProjects', 'readonly').objectStore('rhythmProjects').count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => { db.close(); reject(count.error); };
    };
  })) === 2);
  await openHistory(page);
  await drafts.selectOption(id);
  await page.getByLabel('Заметка к практике', { exact: true }).fill('Исходный грув');
  await page.getByLabel('Комфортный темп', { exact: true }).fill('235');
  await page.locator('[data-history-action="save-manual"]').click();
  await page.locator('[data-history-kind="manual"]').waitFor();
  const after = await raw(page);
  const entry = after.history.find(item => item.result.note === 'Исходный грув');
  assert.ok(entry);
  assert.deepEqual(entry.result.material, original.material);
  assert.equal(entry.result.context, null);
  assert.equal(entry.result.comfortableBpm, 235);
  assert.equal(entry.result.durationMs, original.totalReferenceMs - original.recordedThroughMs);
  assert.equal(entry.occurredAt, original.createdAt);
  assert.equal(entry.timeZone, original.timeZone);
  return { draftId: id, originalProject: original.material.playback.project.id, currentProject: after.activeRhythmProjectId, durationMs: entry.result.durationMs, grooveBeforeHistory, grooveWithHistory };
});

check('product-layout-keeps-transport-and-local-grid-in-two-themes', 'ui', async ({ page, context, resultDir }) => {
  const samples = [];
  const settingsChecks = [];
  const lightDocks = new Map();
  const profiles = [[1366, 768], [1280, 720], [1440, 900], [1890, 1000], [2048, 1000], [1782, 1220], [2028, 1000, 1.25]];
  const headingTypography = locator => locator.evaluate(heading => {
    const { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight } = getComputedStyle(heading);
    return { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight };
  });
  const frame = () => page.locator('.app-shell').evaluate(shell => {
    const measure = element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const sidebar = shell.querySelector(':scope > .site-header');
    return {
      shell: measure(shell),
      content: measure(shell.querySelector(':scope > .app-content')),
      sidebar: measure(sidebar),
      brand: measure(sidebar.querySelector('.brand')),
      navigation: measure(sidebar.querySelector('.module-navigation')),
      sidebarArt: measure(sidebar.querySelector('.sidebar-art')),
      themeControl: measure(sidebar.querySelector('.theme-control')),
    };
  });
  for (const theme of ['light', 'dark']) {
    let compactDock;
    for (const [width, height, deviceScaleFactor = 1] of profiles) {
      await page.setViewportSize({ width, height });
      const metrics = deviceScaleFactor !== 1 ? await context.newCDPSession(page) : null;
      if (metrics) await metrics.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
      await page.reload(); await ready(page);
      assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]), [width, height, deviceScaleFactor]);
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.locator('[data-app-module="foundation"]').click();
      await page.locator('#fretboard-container').waitFor();
      await page.evaluate(() => { window.scrollTo(0, 0); });
      const fretboardFrame = await frame();
      const fretboardHeading = page.locator('#structure-heading');
      const [fretboardTypography, fretboardHeadingBox, fretboardEndInset] = await Promise.all([
        headingTypography(fretboardHeading),
        fretboardHeading.boundingBox(),
        page.locator('.workspace-main').evaluate(workspace => parseFloat(getComputedStyle(workspace).paddingInlineEnd)),
      ]);
      assert.ok(fretboardHeadingBox);
      if (deviceScaleFactor === 1.25) await page.screenshot({ path: join(resultDir, `p10-rhythm-reference-fretboard-${theme}-2028x1000-dpr125.png`) });
      await enter(page);
      const startsOpen = width >= 1440 && height >= 700;
      const exerciseEditors = width === 1366 || width === 2048 || deviceScaleFactor === 1.25;
      const selectors = ['.rhythm-transport', '.rhythm-tempo', '.rhythm-dial-bank', '.rhythm-swing-dock:visible', '.rhythm-play-module', '.rhythm-mix-board', '.rhythm-master .rhythm-fader'];
      let metronomeLayout, metronomeField;
      for (const mode of ['metronome', 'rhythm']) {
        const tablist = root(page).getByRole('tablist');
        await tablist.locator(`[data-rhythm-mode="${mode}"]`).press('Enter');
        await assertSettings(page, startsOpen);
        const viewport = `${width}×${height} @${deviceScaleFactor}× ${theme} ${mode}`;
        const bounds = await action(page, 'start').boundingBox();
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height);
        const contentArea = root(page).locator('.rhythm-content');
        await contentArea.evaluate(node => { node.scrollTop = 0; });
        const content = await contentArea.boundingBox();
        const panelLocator = root(page).locator(`[data-rhythm-panel="${mode}"]`);
        const panel = await panelLocator.boundingBox();
        const dockBox = () => root(page).locator('.rhythm-transport').boundingBox();
        const dock = await dockBox();
        const mount = await root(page).boundingBox();
        const rhythmFrame = await frame();
        for (const section of Object.keys(fretboardFrame)) {
          for (const key of ['x', 'y', 'width', 'height']) {
            const actual = rhythmFrame[section][key], fretboard = fretboardFrame[section][key];
            assert.ok(Math.abs(actual - fretboard) <= 2, `Shared ${section} ${key} at ${viewport}: ${actual} vs fretboard ${fretboard}`);
          }
        }
        assert.ok(content && panel && dock && mount, viewport);
        const stageGap = dock.y - (content.y + content.height);
        assert.ok(stageGap >= -1 && stageGap <= 16, `Dock is ${stageGap}px below the workspace at ${viewport}`);
        assert.ok(dock.y + dock.height <= height, viewport);
        assert.ok(dock.height <= desktopDockHeightLimit, `Compact dock height ${dock.height}px at ${viewport}`);
        const dockKey = `${width}×${height} ${mode}`;
        if (theme === 'light') lightDocks.set(dockKey, dock);
        else for (const key of ['x', 'y', 'width', 'height']) near(dock[key], lightDocks.get(dockKey)[key], 1);
        const side = settingsAside(page);
        const settingsControls = mode === 'metronome'
          ? ['[data-rhythm-setting="beats"]', '[data-rhythm-choice="denominator"][data-rhythm-value="4"]', '[data-rhythm-division="1"]']
          : ['.rhythm-playback-settings [data-rhythm-repeat="once"]', '.rhythm-playback-settings [data-rhythm-setting="rhythmClick"]', '.rhythm-editor-pattern [data-rhythm-choice="bars"][data-rhythm-value="1"]'];
        for (const selector of settingsControls) {
          const control = side.locator(selector);
          assert.equal(await panelLocator.locator(selector).count(), 1, `Only one control ${selector} at ${viewport}`);
          assert.equal(await control.count(), 1, `Control ${selector} is in settings at ${viewport}`);
          assert.equal(await control.isVisible(), startsOpen, `Control ${selector} follows settings visibility at ${viewport}`);
        }
        const sideBox = startsOpen ? await side.boundingBox() : null;
        const previousBlock = await root(page).locator(mode === 'metronome' ? '.rhythm-pulse' : '.rhythm-constructor').boundingBox();
        const hasSide = Boolean(sideBox && sideBox.x >= previousBlock.x + previousBlock.width - 1);
        assert.equal(hasSide, startsOpen, `Settings initially sit to the right only in wide windows at ${viewport}`);
        if (hasSide) {
          near(sideBox.y, content.y, 2);
          near(sideBox.y + sideBox.height, content.y + content.height, 2);
        }
        const nextBlock = mode === 'metronome'
          ? sideBox
          : await panelLocator.locator(hasSide ? '.rhythm-groove-tools' : '.rhythm-groove-detail-scroll').boundingBox();
        const lastBlock = mode === 'metronome' ? await panelLocator.locator('.rhythm-metro-secondary').boundingBox() : nextBlock;
        assert.ok(lastBlock, viewport);
        const gap = dock.y - (lastBlock.y + lastBlock.height);
        assert.ok(gap >= -1, `The dock does not overlap the working controls at ${viewport}`);
        if (mode === 'rhythm') assert.ok(gap <= 24, `Dock is ${gap}px below the lower editor region at ${viewport}`);
        const contentSeparation = nextBlock && (mode === 'metronome'
          ? nextBlock.x - (previousBlock.x + previousBlock.width)
          : nextBlock.y - (previousBlock.y + previousBlock.height));
        if (contentSeparation !== null) assert.ok(contentSeparation >= -1 && contentSeparation <= 32, `Related blocks are ${contentSeparation}px apart at ${viewport}`);
        near(dock.x, content.x, 1);
        near(dock.width, content.width, 1);
        near(mount.x - rhythmFrame.content.x, fretboardHeadingBox.x - fretboardFrame.content.x, 1);
        near(rhythmFrame.content.x + rhythmFrame.content.width - mount.x - mount.width, fretboardEndInset, 1);
        const bottomInset = rhythmFrame.content.y + rhythmFrame.content.height - dock.y - dock.height;
        assert.ok(bottomInset >= -1 && bottomInset <= 24, `The shell ends ${bottomInset}px below the dock at ${viewport}`);
        const verifyFixedDock = async editor => {
          const openedDock = await dockBox();
          const openedFrame = await frame();
          const openedMaster = await root(page).locator('.rhythm-master .rhythm-fader').boundingBox();
          const openedInset = openedFrame.content.y + openedFrame.content.height - openedDock.y - openedDock.height;
          for (const key of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(openedDock[key] - dock[key]) <= 1, `Dock ${key} changed after opening ${editor} at ${viewport}`);
          }
          assert.ok(Math.abs(openedInset - bottomInset) <= 1, `Dock bottom inset changed after opening ${editor} at ${viewport}`);
          assert.ok(Math.abs(openedMaster.y - layout.at(-1).y) <= 1, `Master fader moved after opening ${editor} at ${viewport}`);
        };
        const header = root(page).locator('.rhythm-header');
        const heading = header.getByRole('heading', { level: 1, name: 'Метроном и ритм', exact: true });
        assert.deepEqual(await headingTypography(heading), fretboardTypography, `Heading typography matches the fretboard at ${viewport}`);
        const [headerBox, headingBox, toggleBox, tablistBox] = await Promise.all([
          header.boundingBox(), heading.boundingBox(), settingsToggle(page).boundingBox(), tablist.boundingBox(),
        ]);
        assert.ok(headingBox && toggleBox && tablistBox, viewport);
        near(headingBox.x, fretboardHeadingBox.x, 2);
        near(headingBox.y, fretboardHeadingBox.y, 2);
        assert.ok(toggleBox.x >= headingBox.x + headingBox.width - 1 && toggleBox.y < headingBox.y + headingBox.height && headingBox.y < toggleBox.y + toggleBox.height,
          `Heading and settings share the first row at ${viewport}`);
        assert.ok(tablistBox.y >= Math.max(headingBox.y + headingBox.height, toggleBox.y + toggleBox.height) - 1,
          `Tabs sit below the heading row at ${viewport}`);
        const tabStyles = await tablist.getByRole('tab').evaluateAll(tabs => tabs.map(tab => {
          const { backgroundColor, borderBottomWidth, borderBottomStyle, borderBottomColor } = getComputedStyle(tab);
          return { mode: tab.dataset.rhythmMode, selected: tab.getAttribute('aria-selected') === 'true', backgroundColor, borderBottomWidth, borderBottomStyle, borderBottomColor };
        }));
        assert.equal(tabStyles.length, 2);
        assert.deepEqual(tabStyles.filter(tab => tab.selected).map(tab => tab.mode), [mode]);
        const activeTab = tabStyles.find(tab => tab.selected), inactiveTab = tabStyles.find(tab => !tab.selected);
        assert.equal(activeTab.borderBottomStyle, 'solid');
        assert.ok(parseFloat(activeTab.borderBottomWidth) >= 2);
        assert.equal(inactiveTab.borderBottomColor, 'rgba(0, 0, 0, 0)');
        assert.notEqual(activeTab.borderBottomColor, inactiveTab.borderBottomColor);
        assert.equal(activeTab.backgroundColor, 'rgba(0, 0, 0, 0)');
        near(content.x, mount.x, 1);
        near(content.width, mount.width, 1);
        near(panel.x, content.x, 1);
        near(panel.width, await contentArea.evaluate(node => node.clientWidth), 1);
        near(headerBox.x, mount.x, 1);
        near(headerBox.width, mount.width, 1);
        const layout = await Promise.all(selectors.map(selector => root(page).locator(selector).boundingBox()));
        assert.ok(layout.every(Boolean));
        const faderHeight = layout.at(-1).height;
        if (width === 1366 && mode === 'metronome') compactDock = { height: dock.height, faderHeight };
        if (height >= 1000) {
          near(dock.height, compactDock.height, 1);
          near(faderHeight, compactDock.faderHeight, 1);
        }
        if (mode === 'metronome') metronomeLayout = layout;
        else layout.forEach((box, index) => {
          for (const dimension of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(box[dimension] - metronomeLayout[index][dimension]) < 1, `${width} ${theme} ${selectors[index]} ${dimension}`);
        });
        const field = await playingField(page).boundingBox();
        assert.ok(field && field.width > 0 && field.height > 0, viewport);
        const fieldInset = field.y - content.y;
        assert.ok(fieldInset >= -1 && fieldInset <= 64, `The playing field starts ${fieldInset}px into the workspace at ${viewport}`);
        const rackViewport = mode === 'rhythm' ? await panelLocator.locator('.rhythm-rack-scroll').boundingBox() : null;
        const visibleFieldWidth = Math.min(field.width, rackViewport?.width ?? field.width);
        if (mode === 'metronome') metronomeField = field;
        else {
          near(field.x, metronomeField.x, 1);
          near(field.y, metronomeField.y, 1);
          near(visibleFieldWidth, metronomeField.width, 1);
          near(field.height, metronomeField.height, 1);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const sample = { theme, width, height, deviceScaleFactor, mode, fretboardFrame, rhythmFrame, heading: headingBox, dock, gap, stageGap, contentSeparation, bottomInset, faderHeight, settingsInitiallyOpen: startsOpen, contrastField: { width: visibleFieldWidth, height: field.height } };
        samples.push(sample);
        if (width === 1366) await page.screenshot({ path: join(resultDir, `p10-rhythm-${mode}-${theme}.png`) });
        if (width === 2048) await page.screenshot({ path: join(resultDir, `p10-rhythm-${mode}-${theme}-2048x1000.png`) });
        if (width === 1890) await page.screenshot({ path: join(resultDir, `p10-rhythm-${mode}-${theme}-1890x1000.png`), fullPage: true });
        if (deviceScaleFactor === 1.25) await page.screenshot({ path: join(resultDir, `p10-rhythm-${mode}-${theme}-2028x1000-dpr125.png`) });
        if (mode === 'metronome') {
          const toolsGap = lastBlock.y - (field.y + field.height);
          assert.ok(toolsGap >= -1 && toolsGap <= 16, `Sound and training follow the pulse field at ${viewport}`);
          assert.ok(lastBlock.x >= field.x - 1 && lastBlock.x + lastBlock.width <= field.x + field.width + 1,
            `Sound and training stay in the main column at ${viewport}`);
          const detailsSelectors = ['.rhythm-sounds > details', '.rhythm-training'];
          for (const selector of detailsSelectors) {
            assert.equal(await panelLocator.locator(selector).evaluate(node => node.open), false, `${selector} is initially collapsed at ${viewport}`);
          }
          const defaultToolControls = [action(page, 'preview'), panelLocator.locator('.rhythm-training > summary')];
          const toolBounds = await Promise.all(defaultToolControls.map(control => control.boundingBox()));
          assert.ok(toolBounds.every(box => box && box.y >= lastBlock.y - 1 && box.y + box.height <= content.y + content.height + 1),
            `Default sound and training controls fit in the workspace at ${viewport}`);
          const toolsToDock = dock.y - Math.max(...toolBounds.map(box => box.y + box.height));
          assert.ok(toolsToDock >= -1, `Dock is below the actual sound and training controls at ${viewport}`);
          sample.metroTools = { fieldGap: toolsGap, dockGap: toolsToDock };
          const beatKeys = output(page, 'beats').locator('.rhythm-beat');
          const beats = await beatKeys.evaluateAll(keys => keys.map(key => key.getBoundingClientRect().toJSON()));
          assert.equal(beats.length, 4);
          assert.ok(beats[0].height > 0, `Visible accent keys at ${viewport}`);
          for (const [index, beat] of beats.entries()) {
            near(beat.y, beats[0].y, 1);
            near(beat.height, beats[0].height, 1);
            assert.ok(beat.left >= field.x - 1 && beat.right <= field.x + field.width + 1);
            if (index) assert.ok(beat.left >= beats[index - 1].right - 1);
          }
          sample.accentKeyHeight = beats[0].height;
          sample.meterCoverage = await meterFieldCoverage(page, 4);
          if (exerciseEditors) {
            await setSettings(page, true);
            await verifyFixedDock('the settings pane');
            for (const selector of detailsSelectors) {
              await openGroup(page, selector);
              await verifyFixedDock(selector);
              const details = panelLocator.locator(selector);
              await details.locator(':scope > summary').press('Enter');
              assert.equal(await details.evaluate(node => node.open), false);
              await verifyFixedDock(selector);
            }
            await setSettings(page, startsOpen);
            sample.editorsKeepDock = true;
          }
        } else {
          const grid = output(page, 'rack');
          const velocityDetails = panelLocator.locator('.rhythm-velocity');
          assert.equal(await velocityDetails.evaluate(node => node.open), false, `Velocity is initially collapsed at ${viewport}`);
          const patternHeader = root(page).locator('.rhythm-constructor .rhythm-deck-header');
          assert.equal(await patternHeader.locator('[data-rhythm-choice="bars"]').count(), 0);
          const headerBars = patternHeader.locator('[data-rhythm-output="bars"]');
          assert.equal(await headerBars.locator('[data-rhythm-bar="0"]').isVisible(), true);
          assert.equal(await headerBars.getByRole('button', { name: 'Добавить такт 2', exact: true }).isVisible(), true);
          const chainScope = root(page).locator('.rhythm-chain-heading [data-rhythm-scope="chain"]');
          assert.equal(await chainScope.isVisible(), true);
          assert.equal(await chainScope.evaluate(button => {
            const tape = button.closest('.rhythm-chain-card').querySelector('[data-rhythm-output="chain"]');
            return Boolean(button.compareDocumentPosition(tape) & Node.DOCUMENT_POSITION_FOLLOWING);
          }), true);
          const measureGrid = () => grid.locator('.rhythm-rack-row').evaluateAll(rows => rows.map(row => ({
            row: row.getBoundingClientRect().toJSON(),
            pads: [...row.querySelectorAll('[data-rhythm-step]')].map(key => key.getBoundingClientRect().toJSON()),
          })));
          const closedGrid = await measureGrid();
          assert.equal(closedGrid.length, 4);
          const firstPad = closedGrid[0].pads[0];
          assert.ok(firstPad.height > 0 && firstPad.height <= 36, `Compact step pads at ${viewport}`);
          if (visibleFieldWidth >= 900) assert.ok(firstPad.width > firstPad.height, `Rectangular step pads at ${viewport}`);
          assert.ok(rackViewport && closedGrid[0].pads.at(-1).right <= rackViewport.x + rackViewport.width + 1,
            `The full default rack fits horizontally at ${viewport}`);
          for (const { row, pads } of closedGrid) {
            assert.equal(pads.length, 16);
            near(row.height, closedGrid[0].row.height, 1);
            for (const [index, pad] of pads.entries()) {
              near(pad.y, pads[0].y, 1);
              near(pad.x, closedGrid[0].pads[index].x, 1);
              near(pad.width, firstPad.width, 1);
              near(pad.height, firstPad.height, 1);
              assert.ok(pad.top >= row.top - 1 && pad.bottom <= row.bottom + 1);
              if (index) assert.ok(pad.left >= pads[index - 1].right - 1);
            }
          }
          sample.stepPad = { width: firstPad.width, height: firstPad.height };
          assert.equal(await root(page).locator('.rhythm-rack-ruler .rhythm-rack-beat').count(), 4);
          const rack = await grid.boundingBox();
          const chain = await output(page, 'chain').boundingBox();
          assert.ok(rack && rack.y >= content.y - 1 && rack.y + rack.height <= content.y + content.height + 1, `All default grid rows fit at ${viewport}`);
          assert.ok(rack.height >= .85 * field.height, `The rack fills the playing field at ${viewport}`);
          const rackVerticalOverflow = await playingField(page).evaluate(node => node.scrollHeight - node.clientHeight);
          assert.ok(rackVerticalOverflow <= 1, `The four default rack rows are visible without vertical scrolling at ${viewport}`);
          assert.ok(chain && chain.y >= rack.y + rack.height - 1 && chain.y + chain.height <= content.y + content.height + 1, `The default chain fits below the grid at ${viewport}`);
          const lower = panelLocator.locator('.rhythm-groove-detail-scroll');
          const toolPane = nextBlock;
          const library = lower.locator('.rhythm-library');
          assert.equal(await library.evaluate(node => node.open), false, `The library is initially collapsed at ${viewport}`);
          const libraryBox = await library.locator(':scope > summary').boundingBox();
          assert.ok(libraryBox && libraryBox.y >= field.y + field.height - 1, `The library belongs below the playing field at ${viewport}`);
          assert.ok(toolPane && libraryBox.y + libraryBox.height <= Math.min(toolPane.y + toolPane.height, content.y + content.height) + 1,
            `The library entry fits completely in the default workspace at ${viewport}`);
          const chainClips = output(page, 'chain').locator('[data-rhythm-clip]');
          assert.equal(await chainClips.count(), 8);
          const tape = await chainClips.evaluateAll(clips => {
            const strip = clips[0].parentElement;
            const oldScroll = strip.scrollLeft;
            const bounds = strip.getBoundingClientRect();
            const fits = clip => {
              const { left, right } = clip.getBoundingClientRect();
              return left >= bounds.left - 1 && right <= bounds.right + 1;
            };
            strip.scrollLeft = 0;
            const allFit = clips.every(fits);
            const firstFits = fits(clips[0]);
            strip.scrollLeft = strip.scrollWidth;
            const lastFits = fits(clips.at(-1));
            const scrolled = strip.scrollLeft > 0;
            strip.scrollLeft = oldScroll;
            return { allFit, firstFits, lastFits, scrolled };
          });
          assert.ok(tape.firstFits && tape.lastFits && (tape.allFit || tape.scrolled), `Every default clip is reachable in the local tape at ${viewport}`);
          const names = root(page).locator('.rhythm-lane-name span, [data-rhythm-output="mixer"] .rhythm-channel-name');
          const clipped = await names.evaluateAll(elements => elements.flatMap(element => (
            element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1 ? [element.textContent] : []
          )));
          assert.deepEqual(clipped, [], `Standard instrument labels must fit at ${viewport}`);
          const unavailableClipLabels = await chainClips.evaluateAll((clips, allowOverflow) => clips.flatMap(clip => {
            const name = clip.querySelector('.rhythm-clip-name');
            if (name.scrollWidth <= name.clientWidth + 1) return [];
            return allowOverflow && clip.title === name.textContent && clip.getAttribute('aria-label')?.endsWith(name.textContent) ? [] : [name.textContent];
          }), tape.scrolled);
          assert.deepEqual(unavailableClipLabels, [], `Default clip labels fit or are available on the clipped button at ${viewport}`);
          await output(page, 'chain').scrollIntoViewIfNeeded();
          const sticky = await action(page, 'start').boundingBox();
          assert.ok(sticky && sticky.y >= 0 && sticky.y + sticky.height <= height);
          assert.ok(Math.abs(sticky.y - bounds.y) <= 1);
          if (exerciseEditors) {
            const verifyGrid = async () => {
              const measuredField = await playingField(page).boundingBox();
              for (const key of ['x', 'y', 'width', 'height']) near(measuredField[key], field[key], 1);
              const measuredGrid = await measureGrid();
              assert.equal(measuredGrid.length, closedGrid.length);
              for (const [index, { row, pads }] of measuredGrid.entries()) {
                const previous = closedGrid[index];
                for (const key of ['x', 'y', 'width', 'height']) near(row[key], previous.row[key], 1);
                assert.equal(pads.length, previous.pads.length);
                for (const [step, pad] of pads.entries()) {
                  for (const key of ['x', 'y', 'width', 'height']) near(pad[key], previous.pads[step][key], 1);
                }
              }
            };
            const verifyVelocityAlignment = async () => {
              const velocityCenters = await output(page, 'velocity').locator('[data-rhythm-velocity]').evaluateAll(inputs => inputs.map(input => {
                const { x, width } = input.getBoundingClientRect();
                return x + width / 2;
              }));
              assert.equal(velocityCenters.length, 16);
              for (const [index, center] of velocityCenters.entries()) {
                const pad = closedGrid[0].pads[index];
                near(center, pad.x + pad.width / 2, 1);
              }
            };
            await setSettings(page, true);
            await verifyGrid();
            await verifyFixedDock('the settings pane');
            const editors = ['.rhythm-velocity', '.rhythm-editor-bar', '.rhythm-editor-sounds', '.rhythm-library'];
            const toggleEditor = async (selector, expectedOpen) => {
              const details = panelLocator.locator(selector);
              await details.locator(':scope > summary').press('Enter');
              assert.equal(await details.evaluate(node => node.open), expectedOpen);
              await verifyGrid();
              await verifyFixedDock(selector);
            };
            for (const selector of editors) {
              await toggleEditor(selector, true);
              if (selector === '.rhythm-velocity') await verifyVelocityAlignment();
            }
            const panes = hasSide ? [lower.locator('.rhythm-groove-tools'), side] : [lower];
            const scrollDistances = [];
            for (const pane of panes) {
              const scrollLimit = await pane.evaluate(node => node.scrollHeight - node.clientHeight);
              if (scrollLimit <= 1) continue;
              await pane.hover();
              const before = await pane.evaluate(node => node.scrollTop);
              await page.mouse.wheel(0, before > scrollLimit / 2 ? -600 : 600);
              const element = await pane.elementHandle();
              await page.waitForFunction(({ element, before }) => Math.abs(element.scrollTop - before) > 1, { element, before }, { timeout: 3000 });
              const after = await pane.evaluate(node => node.scrollTop);
              scrollDistances.push(Math.abs(after - before));
              await verifyGrid();
              await verifyFixedDock('scrolling the open editors');
            }
            if (width === 1366) assert.ok(scrollDistances.length, 'The expanded settings genuinely scroll at 1366×768');
            for (const selector of editors.reverse()) await toggleEditor(selector, false);
            await setSettings(page, startsOpen);
            sample.editorsKeepGrid = true;
            sample.editorsKeepDock = true;
            sample.editorScrollDistances = scrollDistances;
          }
        }
      }
      if (exerciseEditors) {
        const toggle = settingsToggle(page);
        assert.equal(await toggle.and(root(page).getByRole('button', { name: 'Параметры', exact: true })).count(), 1);
        const grooveTab = root(page).getByRole('tab', { name: 'Ритм-секция', exact: true });
        const metroTab = root(page).getByRole('tab', { name: 'Метроном', exact: true });
        const grooveAside = await assertSettings(page, startsOpen);
        const initialAside = startsOpen ? await settingsAside(page).boundingBox() : null;
        const initialField = await playingField(page).boundingBox();
        const initialDock = await root(page).locator('.rhythm-transport').boundingBox();
        await toggle.press('Space');
        await assertSettings(page, !startsOpen);
        const resizedField = await playingField(page).boundingBox();
        const resizedDock = await root(page).locator('.rhythm-transport').boundingBox();
        near(resizedDock.y, initialDock.y, 1);
        near(resizedDock.height, initialDock.height, 1);
        for (const key of ['x', 'y', 'height']) near(resizedField[key], initialField[key], 1);
        if (startsOpen) {
          assert.ok(resizedField.width - initialField.width >= initialAside.width - 1,
            'Closing the right pane returns its width to the rhythm field');
          assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
        } else {
          near(resizedField.width, initialField.width, 1);
          assert.equal(await settingsAside(page).evaluate(node => document.activeElement === node), true);
          const inlineAside = await settingsAside(page).boundingBox();
          assert.ok(inlineAside && inlineAside.y >= resizedField.y + resizedField.height - 1, 'Opened settings stay below the playing field in a smaller window');
        }
        await grooveTab.press('ArrowLeft');
        const metroAside = await assertSettings(page, !startsOpen);
        assert.notEqual(metroAside, grooveAside);
        await setSettings(page, true);
        const metroOpenField = await playingField(page).boundingBox();
        await settingsAside(page).getByRole('button', { name: 'Свернуть', exact: true }).press('Enter');
        await assertSettings(page, false);
        assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
        const metroClosedField = await playingField(page).boundingBox();
        const grooveOpenField = startsOpen ? initialField : resizedField;
        const grooveClosedField = startsOpen ? resizedField : initialField;
        for (const key of ['width', 'height']) {
          near(metroOpenField[key], grooveOpenField[key], 1);
          near(metroClosedField[key], grooveClosedField[key], 1);
        }
        if (startsOpen) near(metroOpenField.y, metroClosedField.y, 1);
        await metroTab.press('ArrowRight');
        assert.equal(await assertSettings(page, false), grooveAside);
        await setSettings(page, startsOpen);
        settingsChecks.push({ theme, width, startsOpen, openField: { width: grooveOpenField.width, height: grooveOpenField.height }, closedField: { width: grooveClosedField.width, height: grooveClosedField.height }, sharedState: true, focusRestored: true });
      }
      if (metrics) {
        await metrics.send('Emulation.clearDeviceMetricsOverride');
        await metrics.detach();
      }
    }
  }
  await page.setViewportSize({ width: 500, height: 720 });
  await page.reload(); await enter(page);
  await root(page).getByRole('tab', { name: 'Ритм-секция', exact: true }).click();
  await assertSettings(page, false);
  const narrow = await root(page).locator('.rhythm-rack-scroll').evaluate(node => {
    const field = node.querySelector('.rhythm-playing-field');
    const scrollArea = field.scrollWidth > field.clientWidth + 1 ? field : node;
    scrollArea.scrollLeft = 80;
    return { rack: scrollArea.clientWidth, content: scrollArea.scrollWidth, offset: scrollArea.scrollLeft, page: document.documentElement.scrollWidth, viewport: innerWidth };
  });
  assert.ok(narrow.content > narrow.rack && narrow.offset > 0 && narrow.page <= narrow.viewport + 1, JSON.stringify(narrow));
  const tape = await output(page, 'chain').evaluate(node => {
    node.scrollLeft = 80;
    return node.scrollLeft;
  });
  assert.ok(tape > 0, 'The clip tape scrolls locally');
  const startKey = action(page, 'start');
  await startKey.scrollIntoViewIfNeeded();
  await startKey.focus();
  const startBox = await startKey.boundingBox();
  const mix = await root(page).locator('.rhythm-mix-module').boundingBox();
  assert.ok(startBox && startBox.y >= 0 && startBox.y + startBox.height <= 720 && mix.y >= startBox.y + startBox.height);
  return { samples, settingsChecks, shellAndNavigationMatchFretboard: true, controlsFitWorkspace: true, sharedHeadingTypography: true, underlinedTabs: true, playbackControlsGrouped: true, dockAlignedToWorkspace: true, dockMatchesAcrossTabs: true, dockMatchesAcrossThemes: true, contrastFieldAlignment: true, dockStableWhenEditorsOpen: true, defaultGridAndChainFit: true, allClipsReachable: true, instrumentNamesFit: true, narrow };
});

check('product-photo-panel-uses-local-images-and-keeps-shared-controls-compact', 'ui', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await enter(page);
  const origin = new URL(page.url()).origin;
  const dock = root(page).locator('.rhythm-transport');
  const photos = new Map();
  const samples = [];
  async function photo(locator, label, { pseudo = null, property = 'background-image' } = {}) {
    const paint = await locator.evaluate((node, { pseudo, property }) => getComputedStyle(node, pseudo).getPropertyValue(property), { pseudo, property });
    const match = /url\(\s*["']?([^"')]+)["']?\s*\)/u.exec(paint);
    assert.ok(match, `${label} has a photographic source: ${paint}`);
    const source = new URL(match[1].trim(), page.url());
    assert.equal(source.origin, origin, label);
    assert.match(source.pathname, /^\/images\/rhythm-panel\/[^/]+\.webp$/u, label);
    if (!photos.has(source.pathname)) {
      const decoded = await page.evaluate(async url => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, source.href);
      assert.ok(decoded.width >= 100 && decoded.height >= 50, `${label} has a usable local image`);
      photos.set(source.pathname, decoded);
    }
    return source.pathname;
  }
  async function assertDock(reference, context) {
    const box = await dock.boundingBox();
    assert.ok(box, context);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(box[key] - reference[key]) <= 1, `${context}: dock ${key} moved`);
    }
  }
  async function referenceLayout(mode, context) {
    const tempo = setting(page, 'bpm-slider').locator('..');
    const swing = setting(page, mode === 'metronome' ? 'metronomeSwing' : 'rhythm-swing').locator('..');
    const mixer = dock.getByRole('group', { name: 'Микшер', exact: true });
    const locators = {
      bpm: dock.locator('.rhythm-bpm-display'),
      slower: action(page, 'slower'),
      tap: action(page, 'tap'),
      faster: action(page, 'faster'),
      tempoCaption: tempo.locator('.rhythm-dial-label'),
      tempoDial: tempo.locator('.rhythm-dial-scale'),
      swingCaption: swing.locator('.rhythm-dial-label'),
      swingDial: swing.locator('.rhythm-dial-scale'),
      status: output(page, 'position'),
      start: action(page, 'start'),
      stop: action(page, 'stop'),
      count: dock.locator('.rhythm-count-in'),
      mixerTitle: mixer.getByRole('heading', { name: 'Микшер', exact: true }),
      faders: mixer.locator('.rhythm-mix-board'),
      master: setting(page, 'master'),
      tempoModule: dock.locator('.rhythm-tempo'),
      dialModule: dock.locator('.rhythm-dial-bank'),
      playModule: dock.locator('.rhythm-play-module'),
    };
    const bounds = Object.fromEntries(await Promise.all(Object.entries(locators).map(async ([key, locator]) => {
      const box = await locator.boundingBox();
      assert.ok(box, `${key} is visible at ${context}`);
      return [key, box];
    })));
    const { bpm, slower, tap, faster, tempoCaption, tempoDial, swingCaption, swingDial, status, start, stop, count, mixerTitle, faders } = bounds;
    const right = box => box.x + box.width;
    const above = (first, second, label) => {
      const gap = second.y - first.y - first.height;
      assert.ok(gap >= -1 && gap <= 13, `${label} at ${context} (gap ${gap}px)`);
    };
    above(bpm, slower, 'BPM display sits directly above the adjustment keys');
    near(slower.y, tap.y, 1);
    near(tap.y, faster.y, 1);
    near(slower.height, faster.height, 1);
    near(slower.height, tap.height, 1);
    near(slower.x, bpm.x, 2);
    near(right(faster), right(bpm), 2);
    assert.ok(right(slower) <= tap.x && right(tap) <= faster.x, `− / TAP / + are in reading order at ${context}`);

    above(tempoCaption, tempoDial, 'Tempo caption sits above its knob');
    above(swingCaption, swingDial, 'Swing caption sits above its knob');
    near(tempoCaption.y, swingCaption.y, 1);
    near(tempoDial.y, swingDial.y, 1);
    near(tempoDial.width, swingDial.width, 1);
    near(tempoDial.height, swingDial.height, 1);
    assert.ok(swingDial.x - right(tempoDial) >= -1 && swingDial.x - right(tempoDial) <= 18, `Adjacent dials at ${context}`);

    above(status, start, 'Transport status sits above Start and Stop');
    near(start.y, stop.y, 1);
    above(stop, count, 'Count-in sits below the transport keys');
    assert.ok(count.x >= bounds.playModule.x && right(count) <= right(bounds.playModule), `Count-in fits the transport module at ${context}`);
    above(mixerTitle, faders, 'Mixer heading sits above the faders');
    near(mixerTitle.x, faders.x, 12);
    assert.equal(await locators.master.getAttribute('type'), 'range');
    assert.equal(await locators.master.evaluate(node => getComputedStyle(node).writingMode), 'vertical-lr');
    const channels = await mixer.locator('.rhythm-mix-channels:visible > .rhythm-channel, .rhythm-master').evaluateAll(strips => strips.map(strip => {
      const measure = selector => strip.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null;
      const fader = strip.querySelector('.rhythm-fader');
      const name = strip.querySelector('.rhythm-channel-name');
      return {
        strip: strip.getBoundingClientRect().toJSON(),
        name: name.getBoundingClientRect().toJSON(), fader: fader.getBoundingClientRect().toJSON(), level: measure('output'),
        mute: measure('.rhythm-lane-mute'), solo: measure('.rhythm-lane-solo'),
        writingMode: getComputedStyle(fader).writingMode,
        nameFits: name.scrollWidth <= name.clientWidth + 1 && name.scrollHeight <= name.clientHeight + 1,
      };
    }));
    assert.equal(channels.length, mode === 'metronome' ? 4 : 5, context);
    const center = box => box.x + box.width / 2;
    const instrumentChannels = channels.slice(0, -1);
    for (const [index, channel] of channels.entries()) {
      const { strip, name, fader, level, mute, solo, writingMode, nameFits } = channel;
      assert.ok(strip.left >= faders.x - 1 && strip.right <= right(faders) + 1, `Every default strip fits in the mixer at ${context}`);
      assert.ok(nameFits, `The channel name fits its strip at ${context}`);
      assert.equal(writingMode, 'vertical-lr');
      near(center(name), center(fader), 1);
      near(center(level), center(fader), 1);
      near(fader.y, channels[0].fader.y, 1);
      near(fader.height, bounds.master.height, 1);
      assert.ok(name.bottom <= fader.top && fader.bottom <= level.top, `Mixer title, rail and level stay in reading order at ${context}`);
      if (index < instrumentChannels.length) {
        near(strip.width, channels[0].strip.width, 1);
        assert.ok(strip.width <= 155, `Channel pitch stays compact at ${context}`);
      }
      if (mode === 'rhythm' && index < instrumentChannels.length) {
        assert.ok(mute && solo && mute.right <= level.left && level.right <= solo.left, `Mute, level and solo share a strip at ${context}`);
        assert.ok(mute.height >= 20 && solo.height >= 20, `Mute and solo retain usable button height at ${context}`);
      }
    }
    return {
      tempoWidth: bounds.tempoModule.width,
      dialBankWidth: bounds.dialModule.width,
      playWidth: bounds.playModule.width,
      dialWidth: tempoDial.width,
      faderHeight: bounds.master.height,
      channelWidth: instrumentChannels[0].strip.width,
      master: channels.at(-1).strip,
    };
  }
  function assertSharedMixer(metronome, rhythm) {
    near(metronome.channelWidth, rhythm.channelWidth, 1);
    for (const key of ['x', 'y', 'width', 'height']) near(metronome.master[key], rhythm.master[key], 1);
  }

  for (const theme of ['light', 'dark']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    const before = await dock.boundingBox();
    assert.ok(before && before.height <= desktopDockHeightLimit && before.y + before.height <= 768, `Compact visible dock in ${theme}`);
    for (const [mode, bpm] of [['metronome', 113], ['rhythm', 127]]) {
      await root(page).getByRole('tablist').locator(`[data-rhythm-mode="${mode}"]`).press('Enter');
      await assertDock(before, `${theme} ${mode}`);
      const context = `${theme} ${mode}`;
      const count = root(page).getByRole('switch', { name: 'Отсчёт', exact: true });
      const exactTempo = root(page).getByRole('spinbutton', { name: 'Темп, BPM', exact: true });
      const bpmWindow = root(page).locator('.rhythm-bpm-display');
      assert.equal(await bpmWindow.getByRole('spinbutton', { name: 'Темп, BPM', exact: true }).count(), 1);
      const countBefore = await count.isChecked();
      await count.press('Space');
      assert.equal(await count.isChecked(), !countBefore);
      await state(page, 'stopped');
      await count.press('Space');
      await exactTempo.fill(String(bpm));
      await exactTempo.press('Tab');
      assert.equal(await exactTempo.inputValue(), String(bpm));
      assert.equal(await setting(page, 'bpm-slider').getAttribute('aria-valuetext'), `${bpm} BPM`);

      const glass = await photo(bpmWindow, `BPM glass at ${context}`);
      const knob = await photo(setting(page, 'bpm-slider').locator('..').locator('.rhythm-dial-face'), `Tempo dial at ${context}`);
      const fader = await photo(setting(page, 'master'), `Fader cap at ${context}`, { property: '--rhythm-photo-fader' });
      const startFace = await photo(action(page, 'start').locator('.rhythm-key-face'), `Start at ${context}`);
      const stopFace = await photo(action(page, 'stop').locator('.rhythm-key-face'), `Stop at ${context}`);
      const countFace = await photo(count.locator('..').locator('.rhythm-count-in-track'), `Count-in at ${context}`);
      const wood = await photo(dock, `Wood trim at ${context}`, { pseudo: '::after' });
      assert.equal(new Set([glass, knob, fader, startFace, stopFace, countFace, wood]).size, 7, context);
      await setSettings(page, true);
      await assertDock(before, `Settings open at ${context}`);
      if (mode === 'metronome') {
        await root(page).locator('[data-rhythm-division="2"]').click();
      } else {
        const overlay = setting(page, 'rhythmClick');
        const face = root(page).locator('.rhythm-overlay-switch-face');
        const off = await photo(face, `Overlay off in ${theme}`);
        await overlay.press('Space');
        assert.equal(await overlay.isChecked(), true);
        const on = await photo(face, `Overlay on in ${theme}`);
        assert.notEqual(on, off);
        await overlay.press('Space');
        assert.equal(await overlay.isChecked(), false);
        assert.equal(await count.isChecked(), countBefore);
      }
      await setSettings(page, false);
      await assertDock(before, `Settings closed at ${context}`);
      const reference = await referenceLayout(mode, context);
      const swing = setting(page, mode === 'metronome' ? 'metronomeSwing' : 'rhythm-swing');
      assert.equal(await photo(swing.locator('..').locator('.rhythm-dial-face'), `Swing dial at ${context}`), knob);
      if (mode === 'rhythm' && theme === 'dark') {
        await start(page);
        const pauseFace = await photo(action(page, 'pause').locator('.rhythm-key-face'), `Pause at ${context}`);
        assert.notEqual(pauseFace, startFace);
        await assertDock(before, `Playback at ${context}`);
        await action(page, 'stop').click();
      }
      samples.push({ theme, mode, dock: before, exactBpm: bpm, reference });
    }
    assertSharedMixer(samples.at(-2).reference, samples.at(-1).reference);
  }
  const wide = [];
  await page.setViewportSize({ width: 2048, height: 1000 });
  const wideDock = await dock.boundingBox();
  const wideWorkspace = await root(page).locator('.rhythm-content').boundingBox();
  assert.ok(wideDock && wideWorkspace && wideDock.height <= desktopDockHeightLimit);
  near(wideDock.x, wideWorkspace.x, 1);
  near(wideDock.width, wideWorkspace.width, 1);
  for (const mode of ['metronome', 'rhythm']) {
    await root(page).locator(`[data-rhythm-mode="${mode}"]`).press('Enter');
    await assertDock(wideDock, `2048×1000 ${mode}`);
    const reference = await referenceLayout(mode, `2048×1000 ${mode}`);
    const compact = samples.find(sample => sample.theme === 'dark' && sample.mode === mode);
    near(wideDock.height, compact.dock.height, 1);
    for (const key of ['dialWidth', 'faderHeight']) near(reference[key], compact.reference[key], 1);
    wide.push({ mode, dock: wideDock, reference });
  }
  assertSharedMixer(wide[0].reference, wide[1].reference);
  await root(page).locator('[data-rhythm-mode="metronome"]').press('Enter');
  await setSettings(page, true);
  await root(page).locator('[data-rhythm-division="1"]').click();
  await setSettings(page, false);
  const narrow = [];
  for (const width of [320, 500, 621]) {
    await page.setViewportSize({ width, height: 720 });
    const documentDock = () => dock.evaluate(node => {
      const { top, height } = node.getBoundingClientRect();
      return { top: top + window.scrollY, height };
    });
    let before, beforeField;
    for (const mode of ['metronome', 'rhythm']) {
      await root(page).locator(`[data-rhythm-mode="${mode}"]`).press('Enter');
      const workspace = root(page).locator('.rhythm-content');
      await workspace.evaluate(node => { node.scrollTop = 0; });
      const [field, stage] = await Promise.all([playingField(page).boundingBox(), workspace.boundingBox()]);
      assert.ok(field && stage && field.y >= stage.y - 1 && field.y + field.height <= stage.y + stage.height + 1,
        `The default field fits vertically at ${width}px in ${mode}`);
      const rackViewport = mode === 'rhythm' ? await root(page).locator('.rhythm-rack-scroll').boundingBox() : null;
      const fieldSize = { width: Math.min(field.width, rackViewport?.width ?? field.width), height: field.height };
      if (!beforeField) beforeField = fieldSize;
      else for (const key of ['width', 'height']) near(fieldSize[key], beforeField[key], 1);
      const box = await documentDock();
      if (!before) before = box;
      near(box.top, before.top, 1);
      near(box.height, before.height, 1);
      await setSettings(page, true);
      assert.deepEqual(await documentDock(), box);
      if (width === 500) {
        await settingsAside(page).getByRole('button', { name: 'Свернуть', exact: true }).press('Enter');
        await assertSettings(page, false);
      } else await setSettings(page, false);
      const [restoredField, restoredStage] = await Promise.all([playingField(page).boundingBox(), workspace.boundingBox()]);
      near(restoredField.y - restoredStage.y, field.y - stage.y, 1);
      assert.equal(await settingsToggle(page).evaluate(node => document.activeElement === node), true);
      assert.deepEqual(await documentDock(), box);
      const textFits = await dock.evaluate(node => {
        const inside = (child, parent) => {
          const outer = parent.getBoundingClientRect();
          const inner = child.getBoundingClientRect();
          return inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
        };
        const window = node.querySelector('.rhythm-bpm-display');
        return inside(window.querySelector('.rhythm-bpm-readout'), window)
          && [...node.querySelectorAll('.rhythm-play-buttons, .rhythm-count-in')].every(control => inside(control, node));
      });
      assert.ok(textFits, `Visible BPM and transport fit at ${width}px in ${mode}`);
    }
    if (width === 500) {
      await setSettings(page, true);
      await root(page).locator('[data-rhythm-mode="metronome"]').press('Enter');
      await assertSettings(page, true);
      const [switchedField, switchedStage] = await Promise.all([playingField(page).boundingBox(), root(page).locator('.rhythm-content').boundingBox()]);
      assert.ok(switchedField.y >= switchedStage.y - 1 && switchedField.y + switchedField.height <= switchedStage.y + switchedStage.height + 1,
        'Changing tabs with the inline settings open shows the new playing field');
      await setSettings(page, false);
    }
    narrow.push({ width, dock: before, contrastField: beforeField });
  }
  return { samples, wide, narrow, localPhotos: Object.fromEntries(photos), stableDock: true, independentCountSwitch: true };
});

check('product-amplifier-dials-faders-and-playhead-use-real-rhythm-state', 'ui', async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1000 });
  await enter(page);
  await root(page).getByRole('tab', { name: 'Ритм-секция' }).click();
  const tempo = setting(page, 'bpm-slider');
  await tempo.press('ArrowUp');
  assert.equal(await setting(page, 'bpm').inputValue(), '93');
  assert.equal(await tempo.getAttribute('aria-valuetext'), '93 BPM');
  const dial = await tempo.boundingBox();
  assert.ok(dial);
  const x = dial.x + dial.width / 2, y = dial.y + dial.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 34);
  const dragged = Number(await tempo.inputValue());
  assert.ok(dragged > 93);
  assert.equal(await setting(page, 'bpm').inputValue(), String(dragged));
  assert.equal(await root(page).getAttribute('data-rhythm-bpm'), '93');
  await page.mouse.up();
  assert.equal(await root(page).getAttribute('data-rhythm-bpm'), String(dragged));
  await setting(page, 'rhythm-swing').press('ArrowUp');
  assert.equal(await output(page, 'rhythm-swing').textContent(), '51%');

  const fader = root(page).getByRole('slider', { name: 'Громкость Бочка', exact: true });
  await fader.press('ArrowUp');
  assert.equal(await fader.getAttribute('aria-valuetext'), '75%');
  assert.equal(await fader.evaluate(node => getComputedStyle(node).writingMode), 'vertical-lr');
  const mute = root(page).getByRole('button', { name: 'Бочка. Заглушить', exact: true });
  const solo = root(page).getByRole('button', { name: 'Малый. Соло', exact: true });
  await mute.click();
  await solo.click();
  assert.equal(await mute.getAttribute('aria-pressed'), 'true');
  assert.equal(await solo.getAttribute('aria-pressed'), 'true');
  await setSettings(page, true);
  await root(page).getByRole('button', { name: 'Один проход', exact: true }).click();
  await setSettings(page, false);
  const copy = await exported(page);
  const project = copy.rhythmProjects.find(item => item.id === copy.activeRhythmProjectId);
  assert.ok(project);
  assert.equal(project.bpm, dragged);
  assert.equal(project.swing, 51);
  assert.equal(project.repeat, 'once');
  assert.equal(project.channels.find(channel => channel.sound === 'kick').volume, .75);
  assert.equal(project.channels.find(channel => channel.sound === 'kick').muted, true);
  assert.equal(project.channels.find(channel => channel.sound === 'snare').solo, true);
  await page.locator('#open-history').click();
  assert.equal(await root(page).locator('.rhythm-lane-name .rhythm-instrument-art').count(), 4);
  await openGroup(page, '.rhythm-velocity');
  const velocity = root(page).locator('[data-rhythm-velocity="8"]');
  await velocity.press('ArrowUp');
  assert.equal(await velocity.getAttribute('aria-valuetext'), '73%');
  assert.equal(await velocity.evaluate(input => input.parentElement.style.getPropertyValue('--velocity')), '73%');
  assert.equal(await root(page).locator('.rhythm-velocity-value').textContent(), 'Шаг 9 · 73%');
  const velocityBox = await velocity.boundingBox();
  const stepBox = await output(page, 'rack').locator('.rhythm-rack-row').first().locator('[data-rhythm-step="8"]').boundingBox();
  assert.ok(stepBox.width > stepBox.height, 'Velocity stays aligned to a rectangular pad at 2048×1000');
  near(velocityBox.x + velocityBox.width / 2, stepBox.x + stepBox.width / 2, 1);
  await velocity.click({ position: { x: velocityBox.width / 2, y: velocityBox.height * 0.78 } });
  const mouseVelocity = await velocity.getAttribute('aria-valuetext');
  assert.notEqual(mouseVelocity, '73%');
  assert.equal(await root(page).locator('.rhythm-velocity-value').textContent(), `Шаг 9 · ${mouseVelocity}`);
  await root(page).locator('.rhythm-velocity > summary').click();
  await start(page);
  await page.waitForFunction(() => {
    const grid = document.querySelector('[data-rhythm-output="rack"]');
    const column = grid?.style.getPropertyValue('--playhead-step');
    const current = grid?.querySelectorAll('.rhythm-step.is-playing');
    return column !== '' && current?.length === 4 && [...current].every(step => step.dataset.rhythmStep === column);
  });
  await action(page, 'pause').click();
  await state(page, 'paused');
  const pausedColumn = await output(page, 'rack').evaluate(node => node.style.getPropertyValue('--playhead-step'));
  const cursorOffset = await output(page, 'rack').evaluate(node => {
    const pad = node.querySelector('.rhythm-step.is-playing').getBoundingClientRect();
    const cursor = parseFloat(getComputedStyle(node, '::after').left);
    return Math.abs(node.getBoundingClientRect().left + cursor - pad.left - pad.width / 2);
  });
  assert.ok(cursorOffset < 1.5, `Cursor offset ${cursorOffset}px`);
  await delay(200);
  assert.equal(await output(page, 'rack').evaluate(node => node.style.getPropertyValue('--playhead-step')), pausedColumn);
  await action(page, 'stop').click();
  assert.equal(await root(page).locator('.rhythm-step.is-playing').count(), 0);

  await page.setViewportSize({ width: 1280, height: 720 });
  const fourLaneField = await playingField(page).boundingBox();
  await setSettings(page, true);
  await openGroup(page, '.rhythm-editor-sounds');
  const addLane = action(page, 'add-lane');
  for (let index = 0; index < 4; index++) await addLane.click();
  assert.equal(await addLane.isDisabled(), true);
  await setSettings(page, false);
  assert.equal(await output(page, 'rack').locator('.rhythm-rack-row').count(), 8);
  assert.equal(await output(page, 'rack').locator('[data-rhythm-step]').count(), 128);
  const mixer = output(page, 'mixer');
  assert.equal(await mixer.getByRole('slider').count(), 8);
  assert.equal(await mixer.locator('[data-rhythm-mute]').count(), 8);
  assert.equal(await mixer.locator('[data-rhythm-solo]').count(), 8);
  const contentArea = root(page).locator('.rhythm-content');
  await contentArea.evaluate(node => { node.scrollTop = 0; });
  const startBefore = await action(page, 'start').boundingBox();
  assert.ok(startBefore && startBefore.y + startBefore.height <= 720);
  const eightLaneField = await playingField(page).boundingBox();
  assert.ok(fourLaneField && eightLaneField);
  near(eightLaneField.width, fourLaneField.width, 1);
  near(eightLaneField.height, fourLaneField.height, 1);
  const fieldScroll = await playingField(page).evaluate(node => {
    node.scrollTop = node.scrollHeight;
    return node.scrollTop;
  });
  assert.ok(fieldScroll > 0, 'Eight rows scroll inside the fixed-size playing field');
  const startAfter = await action(page, 'start').boundingBox();
  assert.ok(startAfter && Math.abs(startBefore.y - startAfter.y) <= 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await start(page);
  await page.waitForFunction(() => document.querySelectorAll('[data-rhythm-output="rack"] .rhythm-step.is-playing').length === 8);
  await action(page, 'stop').click();
  return { exactTempo: dragged, swing: 51, verticalFader: true, savedMix: true, keyboardVelocity: '73%', mouseVelocity, audioPositionColumn: true, pausedColumn, cursorOffset, eightLanes: { mixerChannels: 8, steps: 128, fieldScroll, fieldSizeStable: true, pinnedTransport: true } };
});

check('product-keyboard-tabs-and-grid-do-not-intercept-transport-shortcuts', 'ui', async ({ page }) => {
  await enter(page);
  const tab = root(page).locator('[data-rhythm-mode="metronome"]');
  await tab.focus();
  await tab.press('ArrowRight');
  const groove = root(page).locator('[data-rhythm-mode="rhythm"]');
  assert.equal(await groove.getAttribute('aria-selected'), 'true');
  assert.equal(await groove.evaluate(node => document.activeElement === node), true);
  await setting(page, 'bpm').press('Space');
  await state(page, 'stopped');
  const step = root(page).locator('[data-rhythm-step]').first();
  const previous = await step.getAttribute('aria-pressed');
  await step.press('Space');
  assert.notEqual(await step.getAttribute('aria-pressed'), previous);
  assert.equal(await step.evaluate(node => document.activeElement === node), true);
  await state(page, 'stopped');
  await output(page, 'position').click();
  await page.keyboard.press('Space');
  await state(page, 'running');
  await page.keyboard.press('Space');
  await state(page, 'paused');
  await page.keyboard.press('Escape');
  await state(page, 'stopped');
  const transportFocus = async name => page.waitForFunction(value => document.activeElement?.dataset.rhythmAction === value, name);
  await action(page, 'start').focus();
  for (const [button, expected] of [['start', 'pause'], ['pause', 'resume'], ['resume', 'pause']]) {
    await action(page, button).press('Enter');
    await transportFocus(expected);
  }
  await action(page, 'stop').press('Enter');
  await transportFocus('start');
  assert.equal(await output(page, 'position').getAttribute('aria-live'), 'off');
  return { arrowTab: true, stepToggle: true, inputGuard: true, transportShortcuts: true };
});

check('product-step-accents-use-project-owned-channel-defaults', 'ui', async ({ page }) => {
  await enter(page);
  await root(page).getByRole('tab', { name: 'Ритм-секция', exact: true }).click();
  const velocityEditor = root(page).locator('details.rhythm-velocity');
  const velocitySummary = velocityEditor.locator(':scope > summary');
  const defaultHit = velocityEditor.locator('input[data-rhythm-default-velocity][type="number"]');
  const defaultAccent = velocityEditor.locator('input[data-rhythm-default-accent][type="number"]');
  const rack = output(page, 'rack');
  const track = channel => rack.locator(`[data-rhythm-select-lane="${channel}"]`);
  const step = (channel, index) => rack.locator(`[data-rhythm-channel="${channel}"][data-rhythm-step="${index}"]`);
  const velocities = output(page, 'velocity').locator('[data-rhythm-velocity]');
  const trackVelocities = () => velocities.evaluateAll(inputs => inputs.map(input => input.valueAsNumber));
  const hit = async (channel, index, level, percent) => {
    assert.equal(await track(channel).getAttribute('aria-pressed'), 'true');
    assert.equal(await step(channel, index).getAttribute('data-level'), String(level));
    assert.equal(await velocities.nth(index).getAttribute('aria-valuetext'), `${percent}%`);
  };
  const defaults = async (ordinary, accent) => {
    assert.equal(await defaultHit.inputValue(), String(ordinary));
    assert.equal(await defaultAccent.inputValue(), String(accent));
  };
  const closeVelocity = async () => {
    await velocitySummary.press('Enter');
    assert.equal(await defaultHit.isHidden(), true);
    assert.equal(await defaultAccent.isHidden(), true);
  };
  const setDefaults = async (ordinary, accent) => {
    const before = await trackVelocities();
    await defaultHit.fill(String(ordinary));
    await defaultHit.press('Tab');
    await defaultAccent.fill(String(accent));
    await defaultAccent.press('Tab');
    await defaults(ordinary, accent);
    assert.deepEqual(await trackVelocities(), before);
  };
  const controls = [[defaultHit, 'Сила нового удара'], [defaultAccent, 'Сила нового акцента']];
  for (const [control] of controls) {
    assert.equal(await control.count(), 1);
    assert.equal(await control.isHidden(), true);
  }
  await openGroup(page, '.rhythm-velocity');
  for (const [control, name] of controls) {
    assert.equal(await control.and(velocityEditor.getByRole('spinbutton', { name, exact: true })).count(), 1);
    assert.equal(await control.getAttribute('min'), '1');
    assert.equal(await control.getAttribute('max'), '100');
  }
  await defaults(72, 100);
  await hit('kick', 0, 2, 100);
  await hit('kick', 8, 1, 72);
  await setDefaults(61, 82);
  await track('snare').click();
  await defaults(72, 100);
  await hit('snare', 4, 2, 100);
  await setDefaults(74, 89);
  await track('kick').click();
  await defaults(61, 82);
  await closeVelocity();

  await step('snare', 5).click({ button: 'right' });
  await hit('snare', 5, 2, 89);
  await openGroup(page, '.rhythm-velocity');
  await defaults(74, 89);
  await velocities.nth(5).press('ArrowDown');
  await hit('snare', 5, 2, 88);
  await closeVelocity();

  await step('kick', 8).click({ button: 'right' });
  await hit('kick', 8, 2, 82);
  await defaults(61, 82);
  await step('kick', 8).click({ button: 'right' });
  await hit('kick', 8, 1, 61);

  await hit('kick', 5, 0, 0);
  await step('kick', 5).press('Shift+Enter');
  await hit('kick', 5, 2, 82);
  await step('kick', 5).press('Shift+Enter');
  await hit('kick', 5, 1, 61);
  await step('kick', 5).click();
  await hit('kick', 5, 0, 0);
  await step('kick', 5).click();
  await hit('kick', 5, 1, 61);
  assert.equal(await rack.evaluate(node => node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))), true);
  await state(page, 'stopped');

  const copy = await exported(page);
  assert.equal(copy.schemaVersion, 10);
  const project = copy.rhythmProjects.find(item => item.id === copy.activeRhythmProjectId);
  const exportedDefaults = (source, channel) => source.channels.find(item => item.id === channel).velocityDefaults;
  assert.deepEqual(exportedDefaults(project, 'kick'), { hit: 61, accent: 82 });
  assert.deepEqual(exportedDefaults(project, 'snare'), { hit: 74, accent: 89 });
  const lanes = project.patterns.find(pattern => pattern.id === project.activePatternId).lanes;
  const exportedHits = (channel, indices) => {
    const lane = lanes.find(item => item.channelId === channel);
    return indices.map(index => [lane.steps[index], lane.velocities[index]]);
  };
  assert.deepEqual(exportedHits('kick', [0, 5, 8, 10]), [[2, 1], [1, .61], [1, .61], [1, .72]]);
  assert.deepEqual(exportedHits('snare', [4, 5]), [[2, 1], [2, .88]]);

  const library = root(page).locator('.rhythm-library');
  const projectRows = output(page, 'projects');
  const activeProjectRow = projectRows.locator('[data-rhythm-open-project][aria-pressed="true"]');
  const selectProject = async id => {
    const row = projectRows.locator(`[data-rhythm-open-project="${id}"]`);
    await row.click();
    await row.and(activeProjectRow).waitFor();
  };
  await page.locator('#open-history').click();
  await openGroup(page, '.rhythm-velocity');
  await openGroup(page, '.rhythm-library');
  await action(page, 'new-project').click();
  await activeProjectRow.and(library.getByRole('button', { name: 'Новый проект', exact: true })).waitFor();
  const secondId = await activeProjectRow.getAttribute('data-rhythm-open-project');
  assert.notEqual(secondId, project.id);
  await defaults(72, 100);
  await setDefaults(67, 93);
  await selectProject(project.id);
  await defaults(61, 82);
  await selectProject(secondId);
  await defaults(67, 93);
  await action(page, 'duplicate-project').click();
  await page.waitForFunction(() => document.querySelector('[data-rhythm-output="status"]')?.textContent === 'Копия проекта сохранена.');
  const cloned = await exported(page);
  assert.equal(cloned.rhythmProjects.length, 3);
  assert.notEqual(cloned.activeRhythmProjectId, secondId);
  const clonedProject = cloned.rhythmProjects.find(item => item.id === cloned.activeRhythmProjectId);
  assert.deepEqual(exportedDefaults(clonedProject, 'kick'), { hit: 67, accent: 93 });
  await page.reload();
  await ready(page);
  await state(page, 'stopped');
  await openGroup(page, '.rhythm-velocity');
  await defaults(67, 93);
  await openGroup(page, '.rhythm-library');
  await selectProject(project.id);
  await defaults(61, 82);
  await track('snare').click();
  await defaults(74, 89);
  await hit('snare', 5, 2, 88);
  await track('closedHat').click();
  await defaults(72, 100);
  await closeVelocity();
  await step('kick', 6).click();
  await hit('kick', 6, 1, 61);
  await openHistory(page);
  await page.locator('[data-history-file]').setInputFiles({ name: 'rhythm-defaults-v10.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) });
  await page.getByTestId('backup-preview').waitFor();
  await page.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
  await page.locator('[data-history-action="confirm-restore"]').click();
  await page.getByTestId('backup-preview').waitFor({ state: 'detached' });
  assert.deepEqual((await raw(page)).rhythmProjects, copy.rhythmProjects);
  return { cleanDefaults: [72, 100], trackDefaults: { kick: [61, 82], snare: [74, 89] }, otherProjectKickDefaults: [67, 93], cloneCopiesDefaults: true, editedAccentVelocity: 88, existingHitsUnchanged: true, gesturesWithEditorClosed: true, keyboardAccent: true, rackContextMenuAllowed: true, survivesReload: true, exactUiRestore: true };
});

check('native-real-hidden-tab-pauses-until-explicit-resume', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await enter(page);
  await start(page);
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.waitForFunction(() => document.hidden);
  await state(page, 'paused');
  await page.bringToFront();
  await page.waitForFunction(() => !document.hidden);
  await state(page, 'paused');
  await action(page, 'resume').click();
  await state(page, 'running');
  return { actualDocumentHidden: true, noAutomaticResume: true };
}));

check('native-upgrade-seven-to-ten-keeps-legacy-history-and-drafts', 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await seedDatabase(page, origin, literalV7);
  const before = await raw(page);
  assert.equal(before.version, 7);
  await page.goto(origin);
  await ready(page);
  const after = await raw(page);
  assert.deepEqual(after, {
    ...before, version: 10, stores: [...before.stores, 'rhythmProjects'].sort(),
    preferences: { ...before.preferences, rhythm: null },
    presets: before.presets.map(preset => ({ ...preset, preferences: { ...preset.preferences, rhythm: null } })),
  });
  await openHistory(page);
  const legacy = before.practiceDrafts.find(item => item.material.kind === 'harmony');
  assert.ok(legacy);
  await page.getByLabel('Черновики ручной практики', { exact: true }).selectOption(legacy.id);
  await page.locator('[data-history-action="save-manual"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-history-kind="manual"]').length >= 2);
  const saved = (await raw(page)).history.find(item => item.id.startsWith('manual-') && !before.history.some(old => old.id === item.id));
  assert.deepEqual(saved.result.material, legacy.material);
  assert.deepEqual(saved.result.context, legacy.context);
  assert.equal(saved.occurredAt, legacy.createdAt);
  await page.locator('#open-history').click();
  await enter(page);
  await edit(page, 'bpm', 113);
  await root(page).locator('[data-rhythm-mode="rhythm"]').click();
  await root(page).locator('[data-rhythm-step]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-rhythm-output="projects"] [data-rhythm-open-project]'));
  const projectBeforePreset = (await raw(page)).rhythmProjects[0];
  await page.locator('[data-app-module="foundation"]').click();
  await openHistory(page);
  await page.locator('[data-apply-preset="fixture-harmony-preset"]').click();
  await root(page).waitFor();
  assert.equal(await root(page).locator('[data-rhythm-mode="rhythm"]').getAttribute('aria-selected'), 'true');
  const afterPreset = await raw(page);
  assert.deepEqual(afterPreset.rhythmProjects, [projectBeforePreset]);
  assert.equal(afterPreset.activeRhythmProjectId, projectBeforePreset.id);
  assert.equal(afterPreset.preferences.rhythm.metronome.bpm, 113);
  return { version: after.version, historyPreserved: before.history.length, draftsPreserved: before.practiceDrafts.length, savedLegacyDuration: saved.result.durationMs, legacyPresetPreservesRhythm: true };
}));

function legacyRhythmSnapshot(version) {
  const project = (id, name, bars) => {
    const steps = Array.from({ length: bars * 16 }, (_, index) => index % 16 === Math.floor(index / 16) ? 1 : 0);
    const channels = [
      { id: 'kick', name: 'Бочка', sound: 'kick', volume: .8, muted: false, solo: false },
      { id: 'snare', name: 'Малый', sound: 'snare', volume: .65, muted: false, solo: false },
    ];
    return {
      id, name, createdAt: '2026-11-08T22:30:00.000Z', updatedAt: '2026-11-08T22:30:01.000Z',
      bpm: 107, swing: 53, swingMode: 'eighth',
      channels,
      patterns: [{ id: 'A', name, bars, lanes: channels.map(channel => ({ channelId: channel.id, steps, velocities: steps.map(step => step * .63) })) }],
      chain: [{ id: 'clip-1', patternId: 'A' }], activePatternId: 'A', scope: 'pattern', repeat: 'once', countIn: true, overlay: false,
    };
  };
  const selected = project(`v${version}-rhythm-selected`, `Выбранный проект из версии ${version}`, version === 8 ? 4 : 3);
  const rhythm = {
    view: 'rhythm', master: .76, metronome: {
      bpm: 117, bpmUnit: 'quarter', meter: { beats: 4, denominator: 4, groups: [4] }, accents: [2, 1, 1, 1],
      division: 1, substeps: [], swing: 50, swingMode: 'eighth', kit: 'wood', accentVolume: .8, clickVolume: .8, subdivisionVolume: .35,
      countIn: false, training: { silentEnabled: false, soundBars: 3, silentBars: 1, rampEnabled: false, stepBpm: 2, everyBars: 8, targetBpm: 120 },
    },
  };
  const material = { kind: 'rhythm', playback: { preferences: rhythm, project: selected } };
  const oldDraft = literalV7.practiceDrafts.find(item => item.material.kind === 'harmony');
  const oldHistory = literalV7.history.find(item => item.result.kind === 'manual');
  return {
    ...literalV7, schemaVersion: version, preferences: { ...literalV7.preferences, rhythm },
    presets: literalV7.presets.map(preset => ({ ...preset, preferences: { ...preset.preferences, rhythm: null } })),
    practiceDrafts: [...literalV7.practiceDrafts, { ...oldDraft, id: `v${version}-rhythm-draft`, context: null, material }],
    history: [...literalV7.history, { ...oldHistory, id: `v${version}-rhythm-history`, result: { ...oldHistory.result, context: null, material } }],
    rhythmProjects: [project(`v${version}-rhythm-first`, `Один такт из версии ${version}`, 1), selected], activeRhythmProjectId: selected.id,
  };
}

for (const version of [8, 9]) {
  check(`native-upgrade-v${version}-to-v10-keeps-rhythm-projects-and-practice`, 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
    const snapshot = legacyRhythmSnapshot(version);
    const selected = snapshot.rhythmProjects.find(project => project.id === snapshot.activeRhythmProjectId);
    const factory = { hit: 72, accent: 100 };
    const migrateProject = (project, defaultsFor = () => factory) => ({
      ...project, channels: project.channels.map(channel => ({ ...channel, velocityDefaults: defaultsFor(channel) })),
    });
    const migrateMaterial = material => material?.kind === 'rhythm'
      ? { ...material, playback: { ...material.playback, project: migrateProject(material.playback.project) } }
      : material;
    await seedDatabase(page, origin, snapshot);
    const before = await raw(page);
    assert.equal(before.version, version);
    assert.equal(before.activeRhythmProjectId, selected.id);
    assert.deepEqual(before.rhythmProjects, snapshot.rhythmProjects);

    if (version === 9) {
      await page.evaluate(() => {
        localStorage.setItem('bass-study.rhythm.new-hit-velocity', '68');
        localStorage.setItem('bass-study.rhythm.track-velocity:["kick","kick"]', '{"hit":59,"accent":81}');
        sessionStorage.setItem('p10-rhythm-upgrade-fault', 'pending');
      });
      await context.addInitScript(() => {
        if (location.origin !== 'http://localhost:4173' || sessionStorage.getItem('p10-rhythm-upgrade-fault') !== 'pending') return;
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          const request = put.apply(this, args);
          const transaction = this.transaction;
          if (this.name === 'rhythmProjects' && transaction.mode === 'versionchange' && transaction.db.name === 'bass-study' && transaction.db.version === 10) {
            request.addEventListener('success', () => {
              sessionStorage.setItem('p10-rhythm-upgrade-fault', 'aborted');
              transaction.abort();
            }, { once: true });
          }
          return request;
        };
      });
      await page.goto(origin);
      await ready(page);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('p10-rhythm-upgrade-fault')), 'aborted');
      assert.deepEqual(await raw(page), before);
    }

    await page.goto(origin);
    await ready(page);
    const after = await raw(page);
    const expectedProjects = before.rhythmProjects.map(project => migrateProject(project, channel => {
      if (version === 8) return factory;
      return channel.id === 'kick' && channel.sound === 'kick' ? { hit: 59, accent: 81 } : { hit: 68, accent: 100 };
    }));
    assert.deepEqual(after, {
      ...before, version: 10, rhythmProjects: expectedProjects,
      practiceDrafts: before.practiceDrafts.map(draft => ({ ...draft, material: migrateMaterial(draft.material) })),
      history: before.history.map(entry => entry.result.material?.kind === 'rhythm'
        ? { ...entry, result: { ...entry.result, material: migrateMaterial(entry.result.material) } }
        : entry),
    });
    await root(page).waitFor();
    assert.equal(await output(page, 'pattern-title').innerText(), selected.name);
    assert.equal(await output(page, 'bars').getByRole('button', { name: `Такт ${selected.patterns[0].bars}`, exact: true }).isVisible(), true);

    if (version === 9) {
      await page.evaluate(() => {
        localStorage.setItem('bass-study.rhythm.new-hit-velocity', '31');
        localStorage.removeItem('bass-study.rhythm.track-velocity:["kick","kick"]');
      });
      await page.reload();
      await ready(page);
      assert.deepEqual(await raw(page), after);
      await openHistory(page);
      await page.locator('[data-history-file]').setInputFiles({ name: 'legacy-v9-rhythm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) });
      await page.getByTestId('backup-preview').waitFor();
      await page.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
      await page.locator('[data-history-action="confirm-restore"]').click();
      await page.getByTestId('backup-preview').waitFor({ state: 'detached' });
      const imported = await raw(page);
      assert.equal(imported.activeRhythmProjectId, selected.id);
      assert.deepEqual(imported.rhythmProjects, before.rhythmProjects.map(project => migrateProject(project)));
      assert.deepEqual(imported.practiceDrafts, after.practiceDrafts);
      assert.deepEqual(imported.history, after.history);
    }

    return { fromVersion: version, version: after.version, activeRhythmProjectId: selected.id, projectsPreserved: after.rhythmProjects.length, historyAndDraftDefaults: factory,
      ...(version === 9 && { abortAfterPutRolledBack: true, nativeBrowserDefaultsSeededOnce: true, legacyJsonUsesFactoryDefaults: true }) };
  }));
}

check('native-upgrade-abort-after-successful-cursor-update-retains-version-seven', 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await seedDatabase(page, origin, literalV7);
  const before = await raw(page);
  await context.addInitScript(() => {
    const update = IDBCursorWithValue.prototype.update;
    window.__rhythmUpgradeWrites = 0;
    IDBCursorWithValue.prototype.update = function (...args) {
      const request = update.apply(this, args);
      const transaction = this.source.transaction;
      if (transaction?.db.name === 'bass-study' && transaction.db.version === 10) request.addEventListener('success', () => {
        window.__rhythmUpgradeWrites++;
        transaction.abort();
      });
      return request;
    };
  });
  await page.goto(origin);
  await ready(page);
  assert.equal(await page.evaluate(() => window.__rhythmUpgradeWrites), 1);
  assert.deepEqual(await raw(page), before);
  return { successfulCursorUpdate: 1, databaseVersionAfterAbort: 7 };
}));

check('native-project-restore-validates-chain-and-rolls-back-after-project-and-selection-put', 'native', async ({ fixtureOrigin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await page.goto(`${fixtureOrigin}/tests/fixtures/storage.html`);
  await page.waitForFunction(() => window.p5?.ready);
  const result = await page.evaluate(async literal => {
    const { createDefaultRhythmProject } = await import('/src/rhythm/model.ts');
    const store = window.p5.store;
    await store.restore(JSON.stringify(literal), { confirmed: true });
    const first = createDefaultRhythmProject('rhythm-first', 'Первый');
    await store.saveRhythmProject(first);
    const confirmed = await store.readSnapshot();
    const second = createDefaultRhythmProject('rhythm-second', 'Второй');
    const candidate = { ...confirmed, rhythmProjects: [first, second], activeRhythmProjectId: second.id };
    const bad = structuredClone(candidate);
    bad.rhythmProjects[1].chain[0].patternId = 'H';
    let invalidCode, abortCode;
    try { await store.restore(JSON.stringify(bad), { confirmed: true }); } catch (error) { invalidCode = error.code; }
    const afterInvalid = await store.readSnapshot();
    const failAfterWrite = 2 + candidate.presets.length + candidate.history.length + candidate.practiceDrafts.length + candidate.rhythmProjects.length + 1;
    try { await store.restore(JSON.stringify(candidate), { confirmed: true, failAfterWrite }); } catch (error) { abortCode = error.code; }
    const transaction = store.getLastTransaction();
    const cached = await store.readSnapshot();
    const fresh = await store.readSnapshot({ fresh: true });
    return { confirmed, candidate, invalidCode, abortCode, failAfterWrite, transaction, sameCache: cached === confirmed && afterInvalid === confirmed, fresh };
  }, literalV7);
  assert.equal(result.invalidCode, 'INVALID_DATA');
  assert.equal(result.abortCode, 'INJECTED_ABORT');
  assert.equal(result.sameCache, true);
  assert.deepEqual(result.transaction, { successfulWrites: result.failAfterWrite, aborted: true });
  assert.deepEqual(result.fresh, result.confirmed);
  const persisted = await raw(page);
  assert.deepEqual(persisted.rhythmProjects, result.confirmed.rhythmProjects);
  assert.equal(persisted.activeRhythmProjectId, result.confirmed.activeRhythmProjectId);
  await page.evaluate(candidate => window.p5.store.restore(JSON.stringify(candidate), { confirmed: true }), result.candidate);
  const restored = await raw(page);
  assert.deepEqual(restored.rhythmProjects, result.candidate.rhythmProjects);
  assert.equal(restored.activeRhythmProjectId, result.candidate.activeRhythmProjectId);
  return { invalidChainRejected: true, successfulWritesBeforeAbort: result.failAfterWrite, retryCommitted: true };
}));

const selected = process.argv.find(argument => argument.startsWith('--case='))?.slice(7);
await runTracksBrowserChecks(checks.filter(check => !selected || check.name.includes(selected)), {
  scope: 'Product rhythm in Edge: VIS-05 r2 controls and layout, isolated offline PCM, live signal, native visibility, schema 10 migration and restore.',
  reportFile: selected ? 'p10-rhythm-case-edge.json' : 'p10-rhythm-edge.json',
});
