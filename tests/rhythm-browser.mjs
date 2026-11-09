import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runTracksBrowserChecks } from './helpers/tracks-browser-harness.mjs';

const literalV7 = JSON.parse(await readFile(new URL('./fixtures/v7-backup.json', import.meta.url), 'utf8'));
const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });
const root = page => page.getByTestId('rhythm-view');
const action = (page, name) => root(page).locator(`[data-rhythm-action="${name}"]`);
const setting = (page, name) => root(page).locator(`[data-rhythm-setting="${name}"]:visible`);
const output = (page, name) => root(page).locator(`[data-rhythm-output="${name}"]`);
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);

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
  if (await field.evaluate(node => node.tagName === 'SELECT')) await field.selectOption(String(value));
  else {
    await field.fill(String(value));
    await field.press('Tab');
  }
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
async function seedV7(page, origin) {
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
      const request = indexedDB.open('bass-study', 7);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('preferences').put(snapshot.preferences, 'current');
        db.createObjectStore('profile').put(snapshot.profile, 'current');
        for (const name of ['presets', 'history', 'practiceDrafts']) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          for (const value of snapshot[name]) store.put(value);
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
  }, literalV7);
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
  await enter(page);
  assert.equal(await page.locator('[data-app-module="harmony"]').textContent(), 'Метроном и ритм');
  await edit(page, 'denominator', 8);
  await edit(page, 'beats', 6);
  assert.equal(await setting(page, 'bpmUnit').inputValue(), 'dotted-quarter');
  await edit(page, 'bpm', 60);
  await edit(page, 'bpmUnit', 'eighth');
  assert.equal(await setting(page, 'bpm').inputValue(), '60');
  await edit(page, 'beats', 7);
  await edit(page, 'groups', '3+2+2');
  assert.equal(await setting(page, 'metronomeSwing').isDisabled(), true);
  await root(page).locator('[data-rhythm-division="4"]').click();
  await edit(page, 'metro-swing-mode', 'sixteenth');
  await root(page).locator('[data-rhythm-division="2"]').click();
  assert.equal(await setting(page, 'metronomeSwing').isEnabled(), true);
  assert.equal(await setting(page, 'metro-swing-mode').isDisabled(), true);
  assert.equal(await setting(page, 'metro-swing-mode').inputValue(), 'eighth');
  await root(page).locator('[data-rhythm-substep]').first().click();
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
  await edit(page, 'bpm', 300);
  await state(page, 'stopped');
  assert.equal(await action(page, 'start').isDisabled(), true);
  await output(page, 'error').waitFor();
  return { meter: copy.preferences.rhythm.metronome.meter, independentlySavedSubsteps: 7, invalidContextStops: true };
});

check('product-linked-bpm-edits-in-both-tabs-and-survives-reload', 'ui', async ({ page }) => {
  await enter(page);
  const select = mode => root(page).locator(`[data-rhythm-mode="${mode}"]`).click();
  const bpm = () => setting(page, 'bpm').inputValue();
  await edit(page, 'bpm', 111);
  await select('rhythm');
  await edit(page, 'bpm', 125);
  await setting(page, 'rhythmClick').check();
  assert.equal(await bpm(), '111');
  await edit(page, 'bpm', 121);
  await select('metronome');
  assert.equal(await bpm(), '121');
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
  await setting(page, 'rhythmClick').uncheck();
  await edit(page, 'bpm', 100);
  await select('metronome');
  assert.equal(await bpm(), '135');
  return { adoptedMetronomeBpm: 111, editsFromBothTabs: [121, 135], persistedBpm: 135, afterUnlink: { rhythm: 100, metronome: 135 } };
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
  return { latePreviewSilent: true };
});

check('project-steps-and-full-chain-survive-reload-and-export', 'ui', async ({ page }) => {
  await enter(page);
  await root(page).locator('[data-rhythm-mode="rhythm"]').click();
  const first = root(page).locator('[data-rhythm-step]').first();
  const before = await first.getAttribute('aria-pressed');
  await first.click();
  assert.notEqual(await first.getAttribute('aria-pressed'), before);
  await edit(page, 'bars', 2);
  const rack = output(page, 'rack').locator('[data-rhythm-step]');
  const firstBar = await rack.evaluateAll(steps => steps.map(step => step.dataset.level));
  await action(page, 'copy-bar').click();
  await output(page, 'bars').locator('[data-rhythm-bar="1"]').click();
  await action(page, 'clear-bar').click();
  assert.ok((await rack.evaluateAll(steps => steps.map(step => step.dataset.level))).every(level => level === '0'));
  await action(page, 'copy-bar').click();
  assert.deepEqual(await rack.evaluateAll(steps => steps.map(step => step.dataset.level)), firstBar);
  await output(page, 'bars').locator('[data-rhythm-bar="0"]').click();
  const clips = root(page).locator('[data-rhythm-clip]');
  const initialIds = await clips.evaluateAll(items => items.map(item => item.dataset.rhythmClip));
  await clips.nth(1).locator('[data-rhythm-clip-action="remove"]').click();
  await clips.first().locator('[data-rhythm-clip-action="right"]').click();
  const expectedOrder = [initialIds[2], initialIds[0], ...initialIds.slice(3)];
  assert.deepEqual(await clips.evaluateAll(items => items.map(item => item.dataset.rhythmClip)), expectedOrder);
  const copy = await exported(page);
  assert.equal(copy.schemaVersion, 8);
  assert.equal(copy.rhythmProjects.length, 1);
  const [project] = copy.rhythmProjects;
  assert.equal(copy.activeRhythmProjectId, project.id);
  assert.ok(project.patterns.length >= 3);
  assert.deepEqual(project.chain.map(clip => clip.id), expectedOrder);
  await page.reload();
  await ready(page);
  await state(page, 'stopped');
  assert.notEqual(await first.getAttribute('aria-pressed'), before);
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
  return { project: project.id, patterns: project.patterns.length, clips: project.chain.length, copiedAndClearedBar: true, exactReload: true, legacyPreviewReadOnly: true, exactUiRestore: true };
});

check('manual-note-keeps-rhythm-material-and-time-after-changing-project', 'ui', async ({ page }) => {
  await enter(page);
  await root(page).locator('[data-rhythm-mode="rhythm"]').click();
  await root(page).locator('[data-rhythm-step]').first().click();
  await edit(page, 'bpm', 240);
  await start(page);
  await delay(450);
  await action(page, 'stop').click();
  await openHistory(page);
  const drafts = page.getByLabel('Черновики ручной практики', { exact: true });
  await drafts.waitFor();
  const id = await drafts.locator('option').last().getAttribute('value');
  const before = await raw(page);
  const original = before.practiceDrafts.find(item => item.id === id);
  assert.equal(original.material.kind, 'rhythm');
  assert.equal(original.context, null);
  assert.ok(original.totalReferenceMs > 150);
  await page.locator('#open-history').click();
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
  return { draftId: id, originalProject: original.material.playback.project.id, currentProject: after.activeRhythmProjectId, durationMs: entry.result.durationMs };
});

check('product-layout-keeps-transport-and-local-grid-in-two-themes', 'ui', async ({ page, resultDir }) => {
  await enter(page);
  const samples = [];
  for (const theme of ['light', 'dark']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    for (const width of [1366, 1280]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 720 });
      for (const mode of ['metronome', 'rhythm']) {
        await root(page).locator(`[data-rhythm-mode="${mode}"]`).click();
        const bounds = await action(page, 'start').boundingBox();
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= (width === 1366 ? 768 : 720));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        samples.push({ theme, width, mode, startTop: bounds.y });
        if (width === 1366) await page.screenshot({ path: join(resultDir, `p10-rhythm-${mode}-${theme}.png`) });
        if (mode === 'rhythm') {
          await output(page, 'chain').scrollIntoViewIfNeeded();
          const sticky = await action(page, 'start').boundingBox();
          assert.ok(sticky && sticky.y >= 0 && sticky.y + sticky.height <= (width === 1366 ? 768 : 720));
        }
      }
    }
  }
  await page.setViewportSize({ width: 500, height: 720 });
  const narrow = await root(page).locator('.rhythm-rack-scroll').evaluate(node => {
    node.scrollLeft = 80;
    return { rack: node.clientWidth, content: node.scrollWidth, offset: node.scrollLeft, page: document.documentElement.scrollWidth, viewport: innerWidth };
  });
  assert.ok(narrow.content > narrow.rack && narrow.offset > 0 && narrow.page <= narrow.viewport + 1, JSON.stringify(narrow));
  return { samples, narrow };
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
  await output(page, 'status').click();
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

check('native-upgrade-seven-to-eight-keeps-legacy-history-and-drafts', 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await seedV7(page, origin);
  const before = await raw(page);
  assert.equal(before.version, 7);
  await page.goto(origin);
  await ready(page);
  const after = await raw(page);
  assert.deepEqual(after, {
    ...before, version: 8, stores: [...before.stores, 'rhythmProjects'].sort(),
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

check('native-upgrade-abort-after-successful-cursor-update-retains-version-seven', 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await seedV7(page, origin);
  const before = await raw(page);
  await context.addInitScript(() => {
    const update = IDBCursorWithValue.prototype.update;
    window.__rhythmUpgradeWrites = 0;
    IDBCursorWithValue.prototype.update = function (...args) {
      const request = update.apply(this, args);
      const transaction = this.source.transaction;
      if (transaction?.db.name === 'bass-study' && transaction.db.version === 8) request.addEventListener('success', () => {
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
  scope: 'P10-02 product rhythm in Edge: isolated offline PCM, live signal, UI, native visibility, real schema 8 migration and restore.',
  reportFile: selected ? 'p10-rhythm-case-edge.json' : 'p10-rhythm-edge.json',
});
