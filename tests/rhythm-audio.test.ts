import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRhythmPlayer, type RhythmPracticeClock } from '../src/audio/rhythm';
import { DEFAULT_RHYTHM_PREFERENCES, createDefaultRhythmProject } from '../src/rhythm/model';

function stubClock(startVoice = vi.fn()) {
  const parameter = () => ({
    value: 1, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
  });
  const node = () => ({ connect() {}, disconnect() {} });
  const audio = {
    currentTime: 0, state: 'running', sampleRate: 8000, destination: node(),
    async resume() {}, async close() {},
    createGain: () => ({ ...node(), gain: parameter() }),
    createAnalyser: () => ({ ...node(), fftSize: 1024, getFloatTimeDomainData() {} }),
    createBuffer: () => ({ getChannelData: () => new Float32Array(16000) }),
    createOscillator: () => ({ ...node(), frequency: parameter(), start: startVoice, stop() {} }),
  };
  vi.stubGlobal('AudioContext', class { constructor() { return audio; } });
  return audio;
}

describe('отложенный запуск Web Audio', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(['start', 'preview'] as const)('отменяет %s при уходе до завершения AudioContext.resume', async (action) => {
    let release: () => void = () => { throw new Error('Контекст не запрашивал разрешение.'); };
    const buildAudioGraph = vi.fn(() => { throw new Error('Граф не должен создаваться после ухода.'); });
    const constructed = vi.fn();
    const closed = vi.fn();
    class PendingContext {
      state: AudioContextState = 'suspended';
      readonly currentTime = 0;
      readonly createAnalyser = buildAudioGraph;
      constructor() { constructed(); }
      resume() {
        return new Promise<void>(resolve => {
          release = () => { this.state = 'running'; resolve(); };
        });
      }
      async close() { this.state = 'closed'; closed(); }
    }
    vi.stubGlobal('AudioContext', PendingContext);
    const player = createRhythmPlayer();
    const input = { preferences: DEFAULT_RHYTHM_PREFERENCES };
    player.configure(input);
    expect(constructed).not.toHaveBeenCalled();
    const pending = action === 'preview' ? player.preview() : player.start(input);
    expect(constructed).toHaveBeenCalledOnce();
    player.pause('module');
    release();
    await pending;
    const snapshot = player.getSnapshot();
    expect(snapshot.state).toBe(action === 'preview' ? 'stopped' : 'paused');
    expect(snapshot.activeVoices).toBe(0);
    expect(snapshot.practiceDurationMs).toBe(0);
    expect(buildAudioGraph).not.toHaveBeenCalled();
    await player.dispose();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('переносит ещё не начатый клик внутри шага при дробной и повторной паузе', async () => {
    vi.useFakeTimers();
    const startVoice = vi.fn();
    const audio = stubClock(startVoice);
    const seed = createDefaultRhythmProject('pause-overlay', 'Проверка', '2026-11-09T12:00:00.000Z');
    const project = {
      ...seed, bpm: 120, overlay: true,
      patterns: seed.patterns.map(pattern => ({ ...pattern, lanes: pattern.lanes.map(lane => ({
        ...lane, steps: lane.steps.map(() => 0 as const),
      })) })),
    };
    const player = createRhythmPlayer();
    try {
      const first = await player.start({ project, preferences: { ...DEFAULT_RHYTHM_PREFERENCES, view: 'rhythm', metronome: {
        ...DEFAULT_RHYTHM_PREFERENCES.metronome, kit: 'classic', accents: [0, 0, 0, 0], division: 3,
        substeps: [true, false, false, false, false, false, false, false],
      } } });
      audio.currentTime = first.startAt! + .1;
      vi.advanceTimersByTime(20);
      audio.currentTime = first.startAt! + .145;
      player.pause();
      const hits = () => player.getSnapshot().trace.filter(event => event.type === 'hit' && event.source === 'subdivision');
      expect(hits()).toHaveLength(1);
      expect(hits()[0]).toMatchObject({ frameIndex: 1, cancelled: true, continuation: false });
      expect(hits()[0].time).toBeCloseTo(first.startAt! + 1 / 6, 9);

      const premature = await player.resume();
      audio.currentTime = premature.startAt! - .01;
      player.pause();
      expect(hits().every(hit => hit.cancelled)).toBe(true);
      const resumed = await player.resume();
      const expectedTime = resumed.startAt! + 1 / 6 - .145;
      expect(hits().filter(hit => !hit.cancelled)).toHaveLength(1);
      expect(hits().at(-1)!.time).toBeCloseTo(expectedTime, 9);
      expect(startVoice).toHaveBeenCalledTimes(3);
      expect(startVoice.mock.calls.at(-1)![0]).toBeCloseTo(expectedTime, 9);

      audio.currentTime = expectedTime + .005;
      player.pause();
      await player.resume();
      const played = hits().filter(hit => !hit.cancelled);
      expect(played.map(hit => hit.continuation)).toEqual([false, true]);
      expect(played[0].frameIndex).toBe(1);
    } finally { await player.dispose(); }
  });

  it('закрывает фактический микс по аудиочасам и округляет суммарное время прохода', async () => {
    vi.useFakeTimers();
    const audio = stubClock();
    const sealed: RhythmPracticeClock[] = [];
    const player = createRhythmPlayer({ onPracticeEnd: clock => sealed.push(clock) });
    const preferences = { ...DEFAULT_RHYTHM_PREFERENCES, metronome: {
      ...DEFAULT_RHYTHM_PREFERENCES.metronome, bpm: 120, division: 1 as const, substeps: [], kit: 'classic' as const,
    } };
    try {
      const { startAt } = await player.start({ preferences });
      audio.currentTime = startAt! - .01;
      player.setMix({ master: .4 }); // No practice time before the first actual frame.
      audio.currentTime = startAt! + .1006;
      expect(player.configure({ preferences: { ...preferences, master: .5, metronome: { ...preferences.metronome, bpm: 180 } } })).toBe('queued');
      player.setMix({ master: .5 });
      audio.currentTime = startAt! + .2012;
      player.pause();
      audio.currentTime += 1;
      player.setMix({ master: .4 });
      const resumed = await player.resume();
      audio.currentTime = resumed.startAt! + .1006;
      player.stop();
      expect(sealed.map(value => value.playback.preferences.master)).toEqual([.4, .5, .4]);
      expect(sealed.map(value => value.playback.preferences.metronome.bpm)).toEqual([120, 120, 120]);
      expect(sealed.map(value => value.durationMs)).toEqual([101, 100, 101]);
      expect(new Set(sealed.map(value => value.runtimeContextKey)).size).toBe(3);
    } finally { await player.dispose(); }
  });

  it('во время отсчёта меняет стартовый снимок, не добавляя время самого отсчёта', async () => {
    vi.useFakeTimers();
    const audio = stubClock();
    const sealed: RhythmPracticeClock[] = [];
    const player = createRhythmPlayer({ onPracticeEnd: clock => sealed.push(clock) });
    const preferences = { ...DEFAULT_RHYTHM_PREFERENCES, metronome: {
      ...DEFAULT_RHYTHM_PREFERENCES.metronome, bpm: 240, meter: { beats: 2, denominator: 4 as const, groups: [2] },
      accents: [2, 1] as const, division: 1 as const, substeps: [], countIn: true, kit: 'classic' as const,
    } };
    function advanceTo(milliseconds: number) {
      for (let elapsed = Math.round(audio.currentTime * 1000) + 20; elapsed <= milliseconds; elapsed += 20) {
        audio.currentTime = elapsed / 1000;
        vi.advanceTimersByTime(20);
      }
    }
    try {
      const { startAt } = await player.start({ preferences });
      advanceTo(400);
      expect(player.getSnapshot().phase).toBe('count-in');
      player.setMix({ accentVolume: .3 });
      expect(sealed).toEqual([]);
      advanceTo(740);
      player.stop();
      expect(sealed).toHaveLength(1);
      expect(sealed[0].playback.preferences.metronome.accentVolume).toBe(.3);
      expect(sealed[0].durationMs).toBe(Math.round((.74 - startAt! - .5) * 1000));
    } finally { await player.dispose(); }
  });

  it('фиксирует M/S поверх действующей формы, не захватывая ещё отложенный BPM', async () => {
    vi.useFakeTimers();
    const audio = stubClock();
    const sealed: RhythmPracticeClock[] = [];
    const player = createRhythmPlayer({ onPracticeEnd: clock => sealed.push(clock) });
    const project = createDefaultRhythmProject('mix-epoch', 'Проверка');
    const silent = { ...project, patterns: project.patterns.map(pattern => ({
      ...pattern, lanes: pattern.lanes.map(lane => ({ ...lane, steps: lane.steps.map(() => 0 as const), velocities: lane.velocities.map(() => 0) })),
    })) };
    const preferences = { ...DEFAULT_RHYTHM_PREFERENCES, view: 'rhythm' as const };
    try {
      const { startAt } = await player.start({ preferences, project: silent });
      audio.currentTime = startAt! + .03;
      const pending = {
        ...silent, bpm: 160,
        channels: silent.channels.map((channel, index) => ({ ...channel, muted: index === 0, solo: index === 1 })),
      };
      expect(player.configure({ preferences, project: pending })).toBe('queued');
      audio.currentTime = startAt! + .06;
      player.stop();
      expect(sealed.map(clock => clock.playback.project?.bpm)).toEqual([project.bpm, project.bpm]);
      expect(sealed.map(clock => clock.playback.project?.channels[0].muted)).toEqual([false, true]);
      expect(sealed.map(clock => clock.playback.project?.channels[1].solo)).toEqual([false, true]);
      expect(sealed.map(clock => clock.durationMs)).toEqual([30, 30]);
    } finally { await player.dispose(); }
  });
});

describe('запас планирования метронома', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const sixteenths = { ...DEFAULT_RHYTHM_PREFERENCES, metronome: {
    ...DEFAULT_RHYTHM_PREFERENCES.metronome, bpm: 120, division: 4 as const, substeps: Array<boolean>(12).fill(true), kit: 'classic' as const, countIn: false,
  } };
  function clockDriver(audio: { currentTime: number }) {
    let ms = Math.round(audio.currentTime * 1000);
    /** Таймер планировщика срабатывает один раз; аудиочасы ушли на step + late мс. */
    return (step = 20, late = 0) => { ms += step + late; audio.currentTime = ms / 1000; vi.advanceTimersByTime(20); };
  }
  const played = <T extends { readonly type: string; readonly cancelled: boolean }>(trace: readonly T[], type: string) => trace.filter(event => event.type === type && !event.cancelled);

  it.each([110, 150, 200])('опоздание таймера на %s мс не ставит метроном на паузу; кадры и удары не теряются и не повторяются', async late => {
    vi.useFakeTimers();
    const audio = stubClock();
    const player = createRhythmPlayer();
    try {
      await player.start({ preferences: sixteenths });
      const tick = clockDriver(audio);
      // Опоздания приходятся на разные фазы сетки шестнадцатых (0,125 с), включая худшую — сразу после планирования кадра.
      for (let gap = 3; gap <= 14; gap++) { for (let normal = 0; normal < gap; normal++) tick(); tick(20, late); }
      for (let normal = 0; normal < 10; normal++) tick();
      const snapshot = player.getSnapshot();
      expect(snapshot.state, `pauseReason=${snapshot.pauseReason}`).toBe('running');
      const frames = played(snapshot.trace, 'frame');
      expect(frames.map(frame => frame.frameIndex)).toEqual(frames.map((_, index) => index));
      for (let index = 1; index < frames.length; index++) expect(frames[index].time - frames[index - 1].time).toBeCloseTo(.125, 9);
      const hits = played(snapshot.trace, 'hit');
      expect(new Set(hits.map(hit => `${hit.frameIndex}:${hit.source}`)).size).toBe(hits.length);
      expect(new Set(hits.map(hit => hit.frameIndex))).toEqual(new Set(frames.map(frame => frame.frameIndex)));
      expect(frames.at(-1)!.time).toBeGreaterThan(audio.currentTime);
    } finally { await player.dispose(); }
  });

  it('изменение подразделений не ждёт уже запланированный запас: старые удары не звучат позже прежних 0,1 с', async () => {
    vi.useFakeTimers();
    const audio = stubClock();
    const player = createRhythmPlayer();
    try {
      await player.start({ preferences: sixteenths });
      const tick = clockDriver(audio);
      for (let normal = 0; normal < 30; normal++) tick();
      const changedAt = audio.currentTime;
      const quiet = { ...sixteenths, metronome: { ...sixteenths.metronome, substeps: Array<boolean>(12).fill(false) } };
      expect(player.configure({ preferences: quiet })).toBe('queued');
      for (let normal = 0; normal < 40; normal++) tick();
      const snapshot = player.getSnapshot();
      expect(snapshot.state).toBe('running');
      const late = played(snapshot.trace, 'hit').filter(hit => hit.source === 'subdivision' && hit.time > changedAt + .1);
      expect(late).toEqual([]);
      const frames = played(snapshot.trace, 'frame');
      expect(frames.map(frame => frame.frameIndex)).toEqual(frames.map((_, index) => index));
    } finally { await player.dispose(); }
  });

  it('новый темп применяется на ближайшей ещё не прозвучавшей границе такта, даже если она уже была в запасе', async () => {
    vi.useFakeTimers();
    const audio = stubClock();
    const player = createRhythmPlayer();
    try {
      const { startAt } = await player.start({ preferences: sixteenths });
      const tick = clockDriver(audio);
      // Такт 4/4 при 120 BPM длится 2 с; изменение за 0,2 с до второй границы.
      while (audio.currentTime < startAt! + 1.8 - .0001) tick();
      expect(player.configure({ preferences: { ...sixteenths, metronome: { ...sixteenths.metronome, bpm: 180 } } })).toBe('queued');
      for (let normal = 0; normal < 40; normal++) tick();
      const frames = played(player.getSnapshot().trace, 'frame');
      const boundary = frames.find(frame => Math.abs(frame.time - (startAt! + 2)) < 1e-9)!;
      expect(boundary).toMatchObject({ bpm: 180 });
      const next = frames[frames.indexOf(boundary) + 1];
      expect(next.time - boundary.time).toBeCloseTo(60 / 180 / 4, 9);
      expect(frames.filter(frame => frame.time < startAt! + 2).every(frame => frame.bpm === 120)).toBe(true);
    } finally { await player.dispose(); }
  });
});
