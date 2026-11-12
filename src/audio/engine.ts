import * as Tone from 'tone';
import { BASS_TIMBRE, bassLowpassHz } from './bass-timbre';
import { createPlaybackPlan, eventAtGrid, finiteDurationSeconds, validateBpm, type GridEvent, type PlaybackConfig, type PlaybackPlan } from './plan';

export type { PlaybackConfig, NoteDuration, RepeatMode, MetronomeMode } from './plan';
export { buildTempoLadder, createPlaybackPlan, eventAtGrid, finiteDurationSeconds } from './plan';

export interface PlayerVolumes { readonly bass: number; readonly click: number }
export type PlayerState = 'stopped' | 'starting' | 'running' | 'paused' | 'finishing' | 'finished';
export interface AudioTraceEvent {
  readonly runId: number;
  readonly epoch: number;
  readonly type: 'start' | 'count-in' | 'note' | 'click' | 'loop' | 'tempo' | 'pause' | 'resume' | 'finish' | 'stop';
  readonly time: number;
  readonly absoluteGrid: number;
  readonly noteIndex: number | null;
  readonly positionId: string | null;
  readonly passIndex: number;
  readonly bpm: number;
  readonly audible?: boolean;
  readonly requestedAt?: number;
  readonly reason?: string;
  readonly cancelled?: boolean;
}
export interface PlayerSnapshot {
  readonly state: PlayerState;
  readonly phase: 'count-in' | 'practice';
  readonly audioTime: number;
  readonly bpm: number;
  readonly positionId: string | null;
  readonly noteIndex: number | null;
  readonly beat: number;
  readonly bar: number;
  readonly passIndex: number;
  readonly totalPasses: number | null;
  readonly finishAt: number | null;
  readonly pauseReason: string | null;
  readonly pendingTempo: { readonly bpm: number; readonly requestedAt: number } | null;
  readonly output: { readonly peak: number; readonly rms: number };
  readonly volumes: PlayerVolumes;
  readonly trace: readonly AudioTraceEvent[];
  readonly runId: number;
  readonly epoch: number;
  readonly repeatId: number | null;
  readonly activeVoices: number;
  readonly transportBeat: number;
  readonly contextState: string;
}

type ToneContext = ReturnType<typeof Tone.getContext>;
type Frame = GridEvent & { readonly time: number; readonly epoch: number };
const MAX_TRACE = 4096;
const MAX_FRAMES = 4096;

function createGraph(context: ToneContext, separateChannels: boolean) {
  const master = new Tone.Gain({ context, gain: 0 }).toDestination();
  const bassBus = new Tone.Gain({ context, gain: 0.65 });
  const clickBus = new Tone.Gain({ context, gain: 0.45 });
  const analyser = new Tone.Analyser({ context, type: 'waveform', size: 1024 });
  // Голос баса — пила через lowpass (общий тембр с cue), фильтр живёт вместе с шиной.
  const bassFilter = new Tone.Filter({ context, type: 'lowpass', frequency: bassLowpassHz(41.2), Q: BASS_TIMBRE.filterQ, rolloff: -12 }).connect(bassBus);
  master.connect(analyser);
  const merger = separateChannels ? new Tone.Merge({ context, channels: 2 }).connect(master) : null;
  if (merger) { bassBus.connect(merger, 0, 0); clickBus.connect(merger, 0, 1); }
  else { bassBus.connect(master); clickBus.connect(master); }
  let bass: Tone.Synth | null = null;
  let click: Tone.Synth | null = null;

  function discardVoices() { bass?.dispose(); click?.dispose(); bass = null; click = null; }
  return {
    activate() {
      discardVoices();
      bass = new Tone.Synth({ context, oscillator: { type: BASS_TIMBRE.waveform }, volume: -12,
        envelope: { attack: 0.003, decay: 0.008, sustain: 0.65, release: 0.006 } }).connect(bassFilter);
      click = new Tone.Synth({ context, oscillator: { type: 'triangle' }, volume: -18,
        envelope: { attack: 0.001, decay: 0.004, sustain: 0.3, release: 0.003 } }).connect(clickBus);
      master.gain.cancelScheduledValues(context.immediate());
      master.gain.setValueAtTime(1, context.immediate());
    },
    bass(frequency: number, duration: number, time: number) {
      if (!bass) return;
      bassFilter.frequency.setValueAtTime(bassLowpassHz(frequency), time);
      bass.triggerAttackRelease(frequency, duration, time);
    },
    click(accent: boolean, time: number) { click?.triggerAttackRelease(accent ? 2093.004522 : 1046.502261, 0.018, time, accent ? 1 : 0.7); },
    gateAt(time: number) { master.gain.setValueAtTime(0, time); },
    silence() {
      const now = context.immediate();
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(0, now);
      discardVoices();
    },
    setVolumes(volumes: PlayerVolumes) {
      bassBus.gain.cancelScheduledValues(context.immediate());
      clickBus.gain.cancelScheduledValues(context.immediate());
      bassBus.gain.setValueAtTime(volumes.bass, context.immediate());
      clickBus.gain.setValueAtTime(volumes.click, context.immediate());
    },
    level() {
      const samples = analyser.getValue() as Float32Array;
      let peak = 0; let squares = 0;
      for (const value of samples) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
      return { peak, rms: Math.sqrt(squares / samples.length) };
    },
    voices() { return Number(bass !== null) + Number(click !== null); },
    dispose() { discardVoices(); bassFilter.dispose(); bassBus.dispose(); clickBus.dispose(); merger?.dispose(); master.dispose(); analyser.dispose(); },
  };
}

function analysePcm(samples: Float32Array, sampleRate: number) {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.005));
  const onsets: number[] = [];
  let wasActive = false; let peak = 0; let squares = 0; let tailSquares = 0; let tailSamples = 0;
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
    let windowSquares = 0;
    for (let i = start; i < end; i++) {
      const value = samples[i];
      peak = Math.max(peak, Math.abs(value)); squares += value * value; windowSquares += value * value;
      if (i >= samples.length - Math.round(sampleRate * 0.05)) { tailSquares += value * value; tailSamples++; }
    }
    const active = Math.sqrt(windowSquares / (end - start)) > 0.002;
    if (active && !wasActive) onsets.push(start / sampleRate);
    wasActive = active;
  }
  return { onsets, peak, rms: Math.sqrt(squares / samples.length), tailRms: Math.sqrt(tailSquares / Math.max(tailSamples, 1)) };
}

/** Owns one transport. Visibility belongs to the controller, which calls pause('hidden'). */
export function createPlayer() { return createInternalPlayer(Tone.getContext(), false); }

function createInternalPlayer(context: ToneContext, separateChannels: boolean) {
  const transport = context.transport;
  const graph = createGraph(context, separateChannels);
  const gridTicks = transport.PPQ / 4;
  let state: PlayerState = 'stopped';
  let plan: PlaybackPlan | null = null;
  let repeatId: number | null = null;
  let runId = 0; let epoch = 0; let operation = 0;
  let pausedTicks = 0;
  let pauseReason: string | null = null;
  let finishAt: number | null = null;
  let interruptionAt: number | null = null;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false; let offlineRendering = false;
  let manualBpm = 80;
  let pendingTempo: { bpm: number; requestedAt: number } | null = null;
  let volumes: PlayerVolumes = { bass: 0.65, click: 0.45 };
  let frames: Frame[] = [];
  const servedGrids = new Set<number>();
  const trace: AudioTraceEvent[] = [];

  function ensureUsable() {
    if (disposed) throw new Error('Проигрыватель уже освобождён.');
    if (offlineRendering) throw new Error('Дождитесь завершения offline-проверки.');
  }
  function now() { return context.immediate(); }
  function record(type: AudioTraceEvent['type'], time = now(), frame?: Partial<GridEvent>, extra: Partial<AudioTraceEvent> = {}) {
    trace.push({ runId, epoch, type, time, absoluteGrid: frame?.grid ?? Math.floor(transport.getTicksAtTime(time) / gridTicks),
      noteIndex: frame?.noteIndex ?? null, positionId: frame?.note?.id ?? null, passIndex: frame?.passIndex ?? 0,
      bpm: transport.bpm.getValueAtTime(time), ...extra });
    if (trace.length > MAX_TRACE) trace.splice(0, trace.length - MAX_TRACE);
  }
  function clearRepeat() { if (repeatId !== null) transport.clear(repeatId); repeatId = null; }
  function cancelFutureTrace(time: number) {
    for (let index = 0; index < trace.length; index++) {
      const event = trace[index];
      if (event.runId === runId && event.epoch === epoch && event.time > time + 0.000001) trace[index] = { ...event, cancelled: true };
    }
  }
  function clearFinishTimer() { if (finishTimer !== null) clearTimeout(finishTimer); finishTimer = null; }
  function settleFinished() {
    if (state !== 'finishing' || finishAt === null || now() + 0.000001 < finishAt) return;
    clearRepeat(); clearFinishTimer();
    transport.stop(now());
    graph.silence();
    state = 'finished';
  }
  function queueFinishCheck() {
    if (context.isOffline || finishAt === null || state !== 'finishing') return;
    clearFinishTimer();
    finishTimer = setTimeout(() => {
      finishTimer = null;
      settleFinished();
      if (state === 'finishing') queueFinishCheck();
    }, Math.max(5, (finishAt - now()) * 1000 + 3));
  }
  function remember(frame: Frame) {
    frames.push(frame); servedGrids.add(frame.grid);
    if (frames.length > MAX_FRAMES) {
      const removed = frames.splice(0, frames.length - MAX_FRAMES);
      removed.forEach(item => servedGrids.delete(item.grid));
    }
  }
  function scheduleFrom(firstGrid: number) {
    const callbackEpoch = epoch;
    repeatId = transport.scheduleRepeat(time => {
      if (callbackEpoch !== epoch || state !== 'running' || !plan) return;
      const grid = Math.round(transport.getTicksAtTime(time) / gridTicks);
      if (servedGrids.has(grid)) return;
      const event = eventAtGrid(plan, grid);
      remember({ ...event, time, epoch });
      if (event.finish) {
        finishAt = time;
        graph.gateAt(time);
        clearRepeat();
        state = 'finishing';
        record('finish', time, event);
        queueFinishCheck();
        return;
      }
      if (plan.passBpms && typeof plan.repeat === 'object' && Math.abs(transport.bpm.getValueAtTime(time) - event.bpm) > 0.000001) {
        transport.bpm.cancelScheduledValues(time);
        transport.bpm.setValueAtTime(event.bpm, time);
        record('tempo', time, event, { bpm: event.bpm });
      } else if (pendingTempo && grid % 4 === 0) {
        const change = pendingTempo; pendingTempo = null;
        transport.bpm.cancelScheduledValues(time);
        transport.bpm.setValueAtTime(change.bpm, time);
        record('tempo', time, event, { bpm: change.bpm, requestedAt: change.requestedAt });
      }
      const bpm = transport.bpm.getValueAtTime(time);
      if (event.loopBoundary) record('loop', time, event, { bpm });
      if (event.note) {
        const duration = (plan.noteGrids / 4) * (60 / bpm) * 0.72;
        graph.bass(event.note.frequency, duration, time);
        record('note', time, event, { bpm, audible: volumes.bass > 0 });
      }
      if (event.click) {
        if (event.click.audible) graph.click(event.click.accent, time);
        record(event.click.countIn ? 'count-in' : 'click', time, event, { bpm, audible: event.click.audible && volumes.click > 0 });
      }
    }, '16n', `${firstGrid * gridTicks}i`);
  }
  function stopInternal() {
    interruptionAt = now();
    cancelFutureTrace(interruptionAt);
    operation++; epoch++;
    clearRepeat(); clearFinishTimer();
    transport.stop(now());
    transport.loop = false;
    transport.bpm.cancelScheduledValues(now());
    graph.silence();
    pendingTempo = null; finishAt = null; pauseReason = null; pausedTicks = 0;
    frames = []; servedGrids.clear(); state = 'stopped';
    record('stop');
  }
  function arm(nextPlan: PlaybackPlan, startTime: number) {
    plan = nextPlan; runId++; epoch++;
    interruptionAt = null;
    frames = []; servedGrids.clear(); finishAt = null; pausedTicks = 0; pauseReason = null;
    transport.loop = false;
    transport.bpm.cancelScheduledValues(0);
    transport.bpm.setValueAtTime(typeof nextPlan.repeat === 'object' ? nextPlan.bpm : manualBpm, now());
    graph.setVolumes(volumes); graph.activate();
    state = 'running';
    scheduleFrom(0);
    transport.start(startTime, 0);
    record('start', startTime);
  }
  async function start(config: PlaybackConfig) {
    ensureUsable();
    const nextPlan = createPlaybackPlan(config);
    stopInternal();
    plan = nextPlan; manualBpm = nextPlan.bpm;
    const request = ++operation;
    state = 'starting';
    if (!context.isOffline) await Tone.start();
    if (disposed || request !== operation || state !== 'starting') return getSnapshot();
    arm(nextPlan, context.isOffline ? 0 : context.now());
    return getSnapshot();
  }
  function pause(reason = 'manual') {
    ensureUsable(); settleFinished();
    if (!['running', 'finishing', 'starting'].includes(state)) return getSnapshot();
    const time = now();
    interruptionAt = time;
    pausedTicks = Math.max(0, transport.getTicksAtTime(time));
    const actualBpm = transport.bpm.getValueAtTime(time);
    cancelFutureTrace(time);
    operation++; epoch++;
    clearRepeat(); clearFinishTimer();
    // stop() cancels a future start as well; the actual musical offset is kept
    // separately and supplied explicitly on resume rather than using look-ahead ticks.
    transport.stop(time);
    transport.bpm.cancelScheduledValues(time);
    transport.bpm.setValueAtTime(actualBpm, time);
    graph.silence(); finishAt = null;
    frames = frames.filter(frame => frame.time <= time + 0.000001);
    servedGrids.clear(); frames.forEach(frame => servedGrids.add(frame.grid));
    state = 'paused'; pauseReason = reason;
    record('pause', time, undefined, { reason });
    return getSnapshot();
  }
  async function resume() {
    ensureUsable();
    if (state !== 'paused' || !plan) return getSnapshot();
    const request = ++operation;
    if (!context.isOffline) await Tone.start();
    if (disposed || request !== operation || state !== 'paused' || !plan) return getSnapshot();
    epoch++;
    const heardGrid = frames.at(-1)?.grid ?? -1;
    const firstGrid = Math.max(Math.ceil(pausedTicks / gridTicks - 0.0000001), heardGrid + 1);
    const time = context.isOffline ? now() : context.now();
    transport.bpm.cancelScheduledValues(now());
    transport.bpm.setValueAtTime(typeof plan.repeat === 'object' ? (frames.at(-1)?.bpm ?? plan.bpm) : manualBpm, now());
    pendingTempo = null;
    graph.setVolumes(volumes); graph.activate();
    state = 'running'; pauseReason = null;
    interruptionAt = null;
    scheduleFrom(firstGrid);
    // Tone's string parser accepts integer tick strings only. A fractional
    // "350.976i" falls back to seconds; the explicit class preserves ticks.
    const offset = new Tone.TicksClass(context, pausedTicks, 'i');
    // Transport's runtime toTicks() accepts a TimeBaseClass (verified in 15.1.22),
    // while start()'s declaration narrows its offset to primitive Time values.
    transport.start(time, offset as unknown as Parameters<typeof transport.start>[1]);
    record('resume', time);
    return getSnapshot();
  }
  function stop() { ensureUsable(); stopInternal(); return getSnapshot(); }
  function setBpm(bpm: number) {
    ensureUsable(); validateBpm(bpm); settleFinished();
    if (plan && typeof plan.repeat === 'object' && ['starting', 'running', 'finishing', 'paused'].includes(state)) {
      throw new Error('Во время лестницы темп задаёт её план. Остановите проигрывание, чтобы изменить параметры.');
    }
    manualBpm = bpm;
    if (state === 'running') pendingTempo = { bpm, requestedAt: now() };
    else { pendingTempo = null; transport.bpm.cancelScheduledValues(now()); transport.bpm.setValueAtTime(bpm, now()); }
    return getSnapshot();
  }
  function setVolumes(change: Partial<PlayerVolumes>) {
    ensureUsable();
    const next = { ...volumes, ...change };
    if (![next.bass, next.click].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError('Громкость должна быть от 0 до 1.');
    volumes = next; graph.setVolumes(volumes); return getSnapshot();
  }
  function playbackState() {
    if (!disposed) settleFinished();
    const time = now();
    let frame: Frame | undefined;
    let lastNoteAt: number | null = null;
    for (let index = frames.length - 1; index >= 0; index--) {
      const candidate = frames[index];
      if (candidate.time > time) continue;
      frame ??= candidate;
      if (candidate.epoch !== epoch || candidate.phase !== 'practice') break;
      if (candidate.note) { lastNoteAt = candidate.time; break; }
    }
    const inactive = state === 'stopped' || state === 'starting' || state === 'finished';
    const noteIndex = inactive ? null : frame?.noteIndex ?? null;
    return {
      state, phase: frame?.phase ?? (plan?.countInGrids ? 'count-in' : 'practice'), audioTime: time,
      bpm: transport.bpm.getValueAtTime(time), positionId: noteIndex !== null ? plan?.notes[noteIndex]?.id ?? null : null,
      noteIndex, beat: frame?.beat ?? 1, bar: frame?.bar ?? 0,
      passIndex: Math.min(frame?.passIndex ?? 0, Math.max(0, (plan?.totalPasses ?? Infinity) - 1)),
      totalPasses: plan?.totalPasses ?? null, finishAt, pauseReason,
      pendingTempo: pendingTempo ? { ...pendingTempo } : null, runId, epoch, lastNoteAt, interruptionAt,
    };
  }
  function getSnapshot(): PlayerSnapshot {
    const { lastNoteAt: _lastNote, interruptionAt: _interruption, ...playback } = playbackState();
    return {
      ...playback,
      output: disposed ? { peak: 0, rms: 0 } : graph.level(), volumes: { ...volumes },
      trace: trace.map(event => ({ ...event })), repeatId,
      activeVoices: disposed ? 0 : graph.voices(),
      transportBeat: state === 'paused' ? pausedTicks / transport.PPQ : state === 'finished' && plan?.finishGrid !== null ? (plan?.finishGrid ?? 0) / 4 : transport.getTicksAtTime(playback.audioTime) / transport.PPQ,
      contextState: context.state,
    };
  }
  function dispose() {
    if (disposed) return;
    stopInternal(); graph.dispose(); disposed = true;
  }
  async function renderOffline(config: PlaybackConfig, options: { durationSeconds?: number } = {}) {
    ensureUsable(); settleFinished();
    if (state !== 'stopped' && state !== 'finished') throw new Error('Для offline-проверки сначала остановите живое проигрывание.');
    const offlinePlan = createPlaybackPlan(config);
    const expectedDuration = finiteDurationSeconds(offlinePlan);
    const duration = options.durationSeconds ?? (expectedDuration !== null ? expectedDuration + 0.25 : 8);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 30) throw new RangeError('Offline-проверка должна длиться больше 0 и не более 30 секунд.');
    if (expectedDuration !== null && duration < expectedDuration + 0.05) throw new RangeError('Буфер offline-проверки должен включать конец упражнения и не менее 50 мс тишины.');
    offlineRendering = true;
    let offlinePlayer: ReturnType<typeof createInternalPlayer> | null = null;
    try {
      const buffer = await Tone.Offline(async offlineContext => {
        offlinePlayer = createInternalPlayer(offlineContext, true);
        offlinePlayer.setVolumes(volumes);
        await offlinePlayer.start(config);
      }, duration, 2, 44100);
      const player = offlinePlayer as ReturnType<typeof createInternalPlayer> | null;
      const snapshot = player?.getSnapshot();
      const result = {
        scope: 'OfflineAudioContext PCM; no physical speakers, device or output latency measurement',
        duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels,
        finishAt: snapshot?.finishAt ?? null, totalPasses: offlinePlan.totalPasses,
        passBpms: offlinePlan.passBpms ? [...offlinePlan.passBpms] : null,
        bass: analysePcm(buffer.getChannelData(0), buffer.sampleRate),
        click: analysePcm(buffer.getChannelData(1), buffer.sampleRate),
        trace: snapshot?.trace ?? [],
      };
      buffer.dispose(); return result;
    } finally {
      const player = offlinePlayer as ReturnType<typeof createInternalPlayer> | null;
      player?.dispose(); offlineRendering = false;
    }
  }
  return { start, pause, resume, stop, setBpm, setVolumes, getSnapshot, playbackState, dispose, renderOffline };
}
