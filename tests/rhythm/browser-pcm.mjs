import assert from 'node:assert/strict';
import { near } from './browser-context.mjs';

export const pcmChecks = [];
const check = (name, scope, run) => pcmChecks.push({ name, scope, run });

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
    // Интервалы — по аудиочасам проигрывателя: Edge без окна запускает вывод позже, чем возвращается start().
    const until = async (ready, label) => {
      const deadline = performance.now() + 6000;
      for (;;) {
        const snapshot = player.getSnapshot();
        if (ready(snapshot)) return snapshot;
        if (performance.now() > deadline) throw new Error(`${label}: аудиочасы стоят на ${snapshot.audioTime}`);
        await wait(5);
      }
    };
    const firstFrame = snapshot => snapshot.trace.find(event => event.type === 'frame' && event.frameIndex === 0 && !event.cancelled);
    try {
      await player.start({ preferences });
      await until(snapshot => firstFrame(snapshot) && snapshot.audioTime >= firstFrame(snapshot).time + .105, 'пауза внутри первой доли отсчёта');
      player.pause();
      const paused = player.getSnapshot();
      const first = firstFrame(paused);
      await wait(160);
      const silence = player.getSnapshot().output.peak;
      const resumed = await player.resume();
      const live = await until(snapshot => snapshot.audioTime >= resumed.startAt + .5, 'вторая доля после продолжения');
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
      const beforeEdit = frames.filter(event => event.frameIndex < firstEdit.frameIndex);
      return { queued, lastScheduled, configuredAt: before.audioTime, firstEdit, tempoEdit,
        oldEpochBeforeEdit: beforeEdit.every(event => event.epoch === before.epoch && event.bpm === 240),
        contiguous: frames.every((event, index) => event.frameIndex === index), oldTempo: sealed[0]?.playback.project.bpm,
        oldVelocity: sealed[0]?.playback.project.patterns[0].lanes[0].velocities[0],
        sealedDurations: sealed.map(clock => clock.durationMs), runId: after.runId, initialRun: before.runId };
    } finally { await player.dispose(); }
  });
  assert.equal(evidence.queued, 'queued');
  // Изменение не ждёт весь запас планирования: переигрывается первый кадр, начинающийся не раньше configure + 35 мс.
  assert.ok(evidence.firstEdit.frameIndex <= evidence.lastScheduled + 1);
  assert.ok(evidence.firstEdit.time >= evidence.configuredAt + .035 - 1e-6 && evidence.firstEdit.time < evidence.configuredAt + .035 + .0625 + .01, JSON.stringify(evidence));
  assert.ok(evidence.oldEpochBeforeEdit && evidence.contiguous);
  // Темп ждёт ближайшую ещё не прозвучавшую границу такта (16 шагов).
  assert.equal(evidence.tempoEdit.frameIndex, Math.ceil(evidence.firstEdit.frameIndex / 16) * 16);
  assert.equal(evidence.tempoEdit.position.absoluteBar, evidence.tempoEdit.frameIndex / 16 + 1);
  if (evidence.firstEdit.frameIndex % 16) assert.equal(evidence.firstEdit.bpm, 240);
  if (evidence.firstEdit.frameIndex > 0) { assert.equal(evidence.oldTempo, 240); assert.equal(evidence.oldVelocity, 1); }
  assert.ok(evidence.sealedDurations.every(duration => duration > 0));
  assert.equal(evidence.runId, evidence.initialRun);
  return evidence;
});
