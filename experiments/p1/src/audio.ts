import * as Tone from "tone";

/** Technical probe, not the product player. Times in the trace are Web Audio seconds. */
export interface AudioProbeConfig {
  bpm?: number;
  countInBeats?: number;
  loopBeats?: number;
}

interface TraceEntry {
  generation: number;
  type: "start" | "count-in" | "note" | "loop" | "tempo" | "pause" | "resume" | "stop";
  scheduledTime: number;
  observedAudioTime: number;
  transportBeat: number;
  loopIndex: number;
  bpm: number;
  step?: number;
  note?: string;
  reason?: string;
  requestedAt?: number;
}

const TRACE_LIMIT = 512;
const NOTES = ["A1", "C2", "D2", "E2"] as const;

function validateConfig(input: AudioProbeConfig) {
  const config = {
    bpm: input.bpm ?? 120,
    countInBeats: input.countInBeats ?? 4,
    loopBeats: input.loopBeats ?? 4,
  };
  if (!Number.isFinite(config.bpm) || config.bpm < 40 || config.bpm > 240) {
    throw new Error("Темп технической пробы должен быть от 40 до 240 BPM.");
  }
  if (!Number.isInteger(config.countInBeats) || config.countInBeats < 0 || config.countInBeats > 8) {
    throw new Error("Отсчёт должен содержать от 0 до 8 долей.");
  }
  if (!Number.isInteger(config.loopBeats) || config.loopBeats < 1 || config.loopBeats > 8) {
    throw new Error("Фрагмент должен содержать от 1 до 8 долей.");
  }
  return config;
}

function makeVoice() {
  return new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 0.01, sustain: 0.6, release: 0.008 },
    volume: -18,
  });
}

/** Owns the page's one Tone transport. Do not create concurrent probe instances. */
export function createAudioProbe() {
  const context = Tone.getContext();
  const transport = Tone.getTransport();
  const bus = new Tone.Gain(0);
  const analyser = new Tone.Analyser("waveform", 1024);
  bus.connect(analyser);
  analyser.toDestination();

  let voice: ReturnType<typeof makeVoice> | undefined;
  let state: "stopped" | "starting" | "running" | "paused" = "stopped";
  let pauseReason: string | null = null;
  let disposed = false;
  let renderingOffline = false;
  let generation = 0;
  let operationVersion = 0;
  let loopIndex = 0;
  let config = validateConfig({});
  let pendingTempo: { bpm: number; requestedAt: number } | null = null;
  let repeatId: number | null = null;
  const trace: TraceEntry[] = [];

  function now() {
    return context.immediate();
  }

  function ensureUsable() {
    if (disposed) throw new Error("Аудиопроба уже освобождена.");
    if (renderingOffline) throw new Error("Дождитесь завершения offline-render.");
  }

  function record(type: TraceEntry["type"], time = now(), extra: Partial<TraceEntry> = {}) {
    trace.push({
      generation,
      type,
      scheduledTime: time,
      observedAudioTime: now(),
      transportBeat: transport.getTicksAtTime(time) / transport.PPQ,
      loopIndex,
      bpm: transport.bpm.getValueAtTime(time),
      ...extra,
    });
    if (trace.length > TRACE_LIMIT) trace.splice(0, trace.length - TRACE_LIMIT);
  }

  function muteAndDiscardVoice() {
    const time = now();
    bus.gain.cancelScheduledValues(time);
    bus.gain.setValueAtTime(0, time);
    // Disconnection also cancels the audible effect of attacks already submitted
    // by the look-ahead scheduler. transport.cancel() alone cannot do that.
    voice?.dispose();
    voice = undefined;
  }

  function newVoice() {
    voice = makeVoice().connect(bus);
    bus.gain.cancelScheduledValues(now());
    bus.gain.setValueAtTime(1, now());
  }

  function onLoop(time: number) {
    if (state !== "running") return;
    loopIndex += 1;
    record("loop", time);
  }
  transport.on("loop", onLoop);

  function onBeat(time: number) {
    if (state !== "running" || !voice) return;
    // A callback is invoked ahead of the audio boundary. Apply a queued change
    // to this real boundary instead of deriving it again from looped ticks.
    // This also behaves correctly after a pause/resume or native loop wrap.
    if (pendingTempo) {
      const change = pendingTempo;
      pendingTempo = null;
      transport.bpm.cancelScheduledValues(time);
      transport.bpm.setValueAtTime(change.bpm, time);
      record("tempo", time, { bpm: change.bpm, requestedAt: change.requestedAt });
    }
    const beat = Math.round(transport.getTicksAtTime(time) / transport.PPQ);
    const countIn = beat < config.countInBeats;
    const step = countIn ? beat : (beat - config.countInBeats) % config.loopBeats;
    const note = countIn ? "C5" : NOTES[step % NOTES.length];
    // 'time' is supplied by Tone's audio scheduler; Date.now()/timer callbacks
    // are deliberately not used to decide when the sound begins.
    voice.triggerAttackRelease(note, 0.06, time);
    record(countIn ? "count-in" : "note", time, { transportBeat: beat, step, note });
  }

  function stop() {
    ensureUsable();
    operationVersion += 1;
    transport.stop(now());
    transport.cancel(0);
    repeatId = null;
    pendingTempo = null;
    transport.loop = false;
    muteAndDiscardVoice();
    state = "stopped";
    pauseReason = null;
    record("stop");
    return getSnapshot();
  }

  async function start(input: AudioProbeConfig = {}) {
    ensureUsable();
    const nextConfig = validateConfig(input);
    stop();
    const operation = ++operationVersion;
    state = "starting";
    // The caller attaches start() to an actual button/keyboard user gesture.
    await Tone.start();
    if (disposed || operation !== operationVersion) return getSnapshot();
    config = nextConfig;
    generation += 1;
    loopIndex = 0;
    transport.bpm.cancelScheduledValues(0);
    transport.bpm.value = config.bpm;
    transport.ticks = 0;
    transport.loopStart = `${config.countInBeats * transport.PPQ}i`;
    transport.loopEnd = `${(config.countInBeats + config.loopBeats) * transport.PPQ}i`;
    transport.loop = true;
    repeatId = transport.scheduleRepeat(onBeat, "4n", 0);
    newVoice();
    state = "running";
    pauseReason = null;
    const startTime = context.now();
    record("start", startTime);
    transport.start(startTime, 0);
    return getSnapshot();
  }

  function pause(reason = "manual") {
    ensureUsable();
    if (state !== "running") return getSnapshot();
    transport.pause(now());
    muteAndDiscardVoice();
    state = "paused";
    pauseReason = reason;
    record("pause", now(), { reason });
    return getSnapshot();
  }

  async function resume() {
    ensureUsable();
    if (state !== "paused") return getSnapshot();
    const operation = ++operationVersion;
    await Tone.start();
    if (disposed || operation !== operationVersion || state !== "paused") return getSnapshot();
    newVoice();
    state = "running";
    pauseReason = null;
    const time = context.now();
    record("resume", time);
    transport.start(time);
    return getSnapshot();
  }

  function setBpm(bpm: number) {
    ensureUsable();
    validateConfig({ ...config, bpm });
    config.bpm = bpm;
    const requestedAt = now();
    if (state === "running") {
      // Last request wins until the next callback. An already submitted beat
      // is left intact; the next not-yet-submitted quarter gets the new tempo.
      pendingTempo = { bpm, requestedAt };
    } else {
      pendingTempo = null;
      transport.bpm.cancelScheduledValues(requestedAt);
      transport.bpm.setValueAtTime(bpm, requestedAt);
      record("tempo", requestedAt, { bpm, requestedAt });
    }
    return getSnapshot();
  }

  function getOutputLevel() {
    const samples = analyser.getValue() as Float32Array;
    let peak = 0;
    let sum = 0;
    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample));
      sum += sample * sample;
    }
    return { peak, rms: Math.sqrt(sum / samples.length) };
  }

  function getSnapshot() {
    return {
      state,
      pauseReason,
      disposed,
      generation,
      config: { ...config },
      contextState: context.state,
      audioTime: now(),
      currentBpm: transport.bpm.getValueAtTime(now()),
      pendingTempo: pendingTempo ? { ...pendingTempo } : null,
      transportState: transport.state,
      transportBeat: transport.ticks / transport.PPQ,
      loopIndex,
      repeatId,
      activeVoices: voice ? 1 : 0,
      output: disposed ? { peak: 0, rms: 0 } : getOutputLevel(),
      trace: trace.map((entry) => ({ ...entry })),
    };
  }

  function onVisibilityChange() {
    if (document.hidden && state === "running") pause("hidden");
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  /**
   * A real OfflineAudioContext render using Tone transport, not a fake clock.
   * Does not exercise the computer's physical speakers or live output latency.
   */
  async function renderOfflineCheck() {
    ensureUsable();
    if (state !== "stopped") throw new Error("Сначала остановите live-пробу.");
    renderingOffline = true;
    const scheduled: Array<{ type: string; time: number; beat: number }> = [];
    let offlineVoice: ReturnType<typeof makeVoice> | undefined;
    let gate: Tone.Gain | undefined;
    const stopTime = 2.25;
    try {
      const buffer = await Tone.Offline(({ transport: offlineTransport }) => {
        gate = new Tone.Gain(1).toDestination();
        offlineVoice = makeVoice().connect(gate);
        offlineTransport.bpm.setValueAtTime(120, 0);
        offlineTransport.bpm.setValueAtTime(240, 1.5);
        // Quarter-beat ticks avoid time-signature notation ambiguity here.
        offlineTransport.loopStart = `${2 * offlineTransport.PPQ}i`;
        offlineTransport.loopEnd = `${4 * offlineTransport.PPQ}i`;
        offlineTransport.loop = true;
        offlineTransport.scheduleRepeat((time) => {
          const beat = Math.round(offlineTransport.getTicksAtTime(time) / offlineTransport.PPQ);
          const countIn = beat < 2;
          const note = countIn ? "C5" : NOTES[(beat - 2) % 2];
          offlineVoice!.triggerAttackRelease(note, 0.06, time);
          scheduled.push({ type: countIn ? "count-in" : "note", time, beat });
        }, "4n", 0);
        offlineTransport.start(0);
        offlineTransport.stop(stopTime);
        // The bus gate independently proves silence after the scheduled stop.
        gate.gain.setValueAtTime(0, stopTime);
      }, 3, 1, 44100);
      const pcm = buffer.getChannelData(0);
      const windowSize = Math.round(buffer.sampleRate * 0.005);
      const onsets: number[] = [];
      let wasActive = false;
      let peak = 0;
      let postStopSquares = 0;
      let postStopSamples = 0;
      for (let start = 0; start < pcm.length; start += windowSize) {
        const end = Math.min(start + windowSize, pcm.length);
        let squares = 0;
        for (let i = start; i < end; i += 1) {
          peak = Math.max(peak, Math.abs(pcm[i]));
          squares += pcm[i] * pcm[i];
          if (i / buffer.sampleRate >= stopTime + 0.05) {
            postStopSquares += pcm[i] * pcm[i];
            postStopSamples += 1;
          }
        }
        const active = Math.sqrt(squares / (end - start)) > 0.002;
        if (active && !wasActive) onsets.push(start / buffer.sampleRate);
        wasActive = active;
      }
      const result = {
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        peak,
        stopTime,
        postStopRms: Math.sqrt(postStopSquares / postStopSamples),
        onsets,
        scheduled,
        scope: "OfflineAudioContext PCM; not physical speaker or live-latency measurement",
      };
      buffer.dispose();
      return result;
    } finally {
      offlineVoice?.dispose();
      gate?.dispose();
      renderingOffline = false;
    }
  }

  function dispose() {
    if (disposed) return;
    stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    transport.off("loop", onLoop);
    bus.dispose();
    analyser.dispose();
    disposed = true;
  }

  return { start, pause, resume, stop, setBpm, getSnapshot, getOutputLevel, renderOfflineCheck, dispose };
}
