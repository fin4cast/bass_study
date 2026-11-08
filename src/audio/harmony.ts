import { createHarmonyPlan, type HarmonyEvent, type HarmonyPlan } from '../harmony';
import { midiToFrequency } from '../music';

export type HarmonySource = 'bass' | 'pad' | 'click';
export interface HarmonyMix { readonly volumes: Readonly<Record<HarmonySource, number>>; readonly muted: Readonly<Record<HarmonySource, boolean>> }
export interface HarmonyPlaybackConfig { readonly bpm?: number; readonly countIn?: boolean; readonly repeat?: 'once' | 'infinite'; readonly volumes?: Partial<Record<HarmonySource, number>>; readonly muted?: Partial<Record<HarmonySource, boolean>> }
export interface HarmonyPlaybackPlan { readonly harmony: HarmonyPlan; readonly bpm: number; readonly countInBeats: 0 | 4; readonly totalBeats: number | null; readonly repeat: 'once' | 'infinite'; readonly mix: HarmonyMix }
export interface HarmonyTraceEvent { readonly type: HarmonySource | 'pause' | 'resume' | 'stop' | 'finish'; readonly runId: number; readonly epoch: number; readonly time: number; readonly transportBeat: number; readonly phase: 'count-in' | 'practice'; readonly midi: number | null; readonly continuation: boolean; cancelled: boolean }
export interface HarmonySnapshot {
  readonly state: 'stopped' | 'starting' | 'running' | 'paused' | 'finishing' | 'finished';
  readonly phase: 'count-in' | 'practice'; readonly audioTime: number; readonly bpm: number; readonly runId: number; readonly epoch: number;
  readonly transportBeat: number; readonly chordIndex: number | null; readonly beat: number; readonly passIndex: number; readonly positionId: string | null;
  readonly startAt: number | null; readonly finishAt: number | null; readonly pauseReason: string | null; readonly activeVoices: number;
  readonly trace: readonly HarmonyTraceEvent[]; readonly output: { readonly peak: number; readonly rms: number };
}
const SOURCES: readonly HarmonySource[] = ['bass', 'pad', 'click'];
const DEFAULT_MIX: HarmonyMix = Object.freeze({ volumes: Object.freeze({ bass: .7, pad: .45, click: .5 }), muted: Object.freeze({ bass: false, pad: false, click: false }) });

function mixValue(previous: HarmonyMix, change: { volumes?: Partial<Record<HarmonySource, number>>; muted?: Partial<Record<HarmonySource, boolean>> }): HarmonyMix {
  const volumes = { ...previous.volumes, ...change.volumes }, muted = { ...previous.muted, ...change.muted };
  for (const source of SOURCES) {
    if (!Number.isFinite(volumes[source]) || volumes[source] < 0 || volumes[source] > 1) throw new RangeError('Громкость каждого голоса должна быть от 0 до 1.');
    if (typeof muted[source] !== 'boolean') throw new RangeError('Выключение голоса должно быть true или false.');
  }
  return Object.freeze({ volumes: Object.freeze(volumes), muted: Object.freeze(muted) });
}

export function createHarmonyPlaybackPlan(config: HarmonyPlaybackConfig = {}): HarmonyPlaybackPlan {
  const harmony = createHarmonyPlan({ bpm: config.bpm ?? 80 });
  if (config.countIn !== undefined && typeof config.countIn !== 'boolean') throw new RangeError('Отсчёт должен быть включён или выключен.');
  const repeat = config.repeat ?? 'once';
  if (repeat !== 'once' && repeat !== 'infinite') throw new RangeError('Выбери один проход или повтор по кругу.');
  const countInBeats = config.countIn === false ? 0 : 4;
  return Object.freeze({ harmony, bpm: harmony.bpm, countInBeats, totalBeats: repeat === 'once' ? countInBeats + 16 : null, repeat, mix: mixValue(DEFAULT_MIX, config) });
}

export function getHarmonyBeat(plan: HarmonyPlaybackPlan, beat: number) {
  if (!Number.isSafeInteger(beat) || beat < 0) throw new RangeError('Номер доли должен быть целым и неотрицательным.');
  if (plan.totalBeats !== null && beat >= plan.totalBeats) return { finish: true, phase: 'practice' as const, passIndex: 0, events: [] as readonly HarmonyEvent[] };
  if (beat < plan.countInBeats) return { finish: false, phase: 'count-in' as const, passIndex: 0, events: [{ id: `count-in-${beat}`, source: 'click' as const, beat, durationBeats: 1, atSeconds: beat * 60 / plan.bpm, durationSeconds: 60 / plan.bpm, midi: null, chordIndex: -1, degree: null, spelling: null, position: null, accent: beat === 0 }] };
  const practiceBeat = beat - plan.countInBeats;
  return { finish: false, phase: 'practice' as const, passIndex: Math.floor(practiceBeat / 16), events: plan.harmony.events.filter(event => event.beat === practiceBeat % 16) };
}

function voiceDuration(event: HarmonyEvent) { return event.source === 'click' ? Math.min(.065, event.durationSeconds) : event.source === 'bass' ? event.durationSeconds * .9 : event.durationSeconds; }
interface Voice { oscillator: OscillatorNode; envelope: GainNode; start: number; end: number }
function synthesize(context: BaseAudioContext, destination: AudioNode, event: HarmonyEvent, time: number, duration = voiceDuration(event)): Voice {
  const oscillator = context.createOscillator(), envelope = context.createGain();
  const end = time + duration;
  const amplitude = event.source === 'bass' ? .22 : event.source === 'pad' ? .085 : event.accent ? .24 : .16;
  const attack = Math.min(event.source === 'pad' ? .025 : .006, duration / 5);
  const release = Math.min(event.source === 'pad' ? .055 : .025, duration / 4);
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(event.midi === null ? event.accent ? 1300 : 900 : midiToFrequency(event.midi), time);
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(amplitude, time + attack);
  envelope.gain.setValueAtTime(amplitude, end - release);
  envelope.gain.linearRampToValueAtTime(0, end);
  oscillator.connect(envelope); envelope.connect(destination);
  oscillator.start(time); oscillator.stop(end);
  return { oscillator, envelope, start: time, end };
}

export function createHarmonyPlayer() {
  let context: AudioContext | null = null;
  let buses: Record<HarmonySource, GainNode> | null = null;
  let analyser: AnalyserNode | null = null;
  let voices: Voice[] = [];
  let plan: HarmonyPlaybackPlan | null = null;
  let mix = DEFAULT_MIX;
  let state: HarmonySnapshot['state'] = 'stopped';
  let runId = 0, epoch = 0, generation = 0;
  let anchorTime: number | null = null, finishAt: number | null = null;
  let offsetBeat = 0, nextBeat = 0;
  let startedBeforePause = false;
  let pauseReason: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let trace: HarmonyTraceEvent[] = [];
  let disposed = false;

  function actualBeat() {
    if (!context || !plan || anchorTime === null || !['running', 'finishing'].includes(state)) return offsetBeat;
    const beat = offsetBeat + Math.max(0, context.currentTime - anchorTime) * plan.bpm / 60;
    return plan.totalBeats === null ? beat : Math.min(plan.totalBeats, beat);
  }
  function addTrace(type: HarmonyTraceEvent['type'], time: number, transportBeat: number, phase: HarmonyTraceEvent['phase'], midi: number | null = null, continuation = false) {
    trace.push({ type, runId, epoch, time, transportBeat, phase, midi, continuation, cancelled: false });
    if (trace.length > 4096) trace = trace.slice(-3072);
  }
  function clearTimer() { if (timer !== null) { clearInterval(timer); timer = null; } }
  function silence() {
    clearTimer();
    const at = context?.currentTime ?? 0;
    trace.forEach(event => { if (event.runId === runId && event.epoch === epoch && event.time > at) event.cancelled = true; });
    for (const voice of voices) {
      try { voice.envelope.gain.cancelScheduledValues(at); voice.envelope.gain.setValueAtTime(0, at); voice.oscillator.stop(at); } catch { /* Ended voices are safe to disconnect. */ }
      voice.oscillator.disconnect(); voice.envelope.disconnect();
    }
    voices = [];
  }
  function applyMix(at = context?.currentTime ?? 0, ramp = true) {
    if (!buses) return;
    for (const source of SOURCES) {
      const gain = buses[source].gain;
      gain.cancelScheduledValues(at);
      const value = mix.muted[source] ? 0 : mix.volumes[source];
      if (ramp) { gain.setValueAtTime(gain.value, at); gain.linearRampToValueAtTime(value, at + .005); }
      else gain.setValueAtTime(value, at);
    }
  }
  function ensureContext() {
    context ??= new AudioContext({ latencyHint: 'interactive' });
    if (!buses) {
      analyser = context.createAnalyser(); analyser.fftSize = 512; analyser.connect(context.destination);
      buses = { bass: context.createGain(), pad: context.createGain(), click: context.createGain() };
      SOURCES.forEach(source => buses![source].connect(analyser!));
    }
    return context;
  }
  function schedule(event: HarmonyEvent, time: number, transportBeat: number, phase: HarmonyTraceEvent['phase'], duration?: number, continuation = false) {
    voices.push(synthesize(context!, buses![event.source], event, time, duration));
    addTrace(event.source, time, transportBeat, phase, event.midi, continuation);
  }
  function finishIfDue() {
    if (!context || finishAt === null || !['running', 'finishing'].includes(state) || context.currentTime < finishAt) return;
    offsetBeat = plan!.totalBeats!;
    addTrace('finish', finishAt, offsetBeat, 'practice');
    state = 'finished'; silence();
  }
  function pauseClock(reason: string) {
    if (!['starting', 'running', 'finishing'].includes(state)) return;
    offsetBeat = actualBeat(); startedBeforePause = anchorTime !== null && (context?.currentTime ?? 0) >= anchorTime;
    ++generation; addTrace('pause', context?.currentTime ?? 0, offsetBeat, offsetBeat < (plan?.countInBeats ?? 0) ? 'count-in' : 'practice');
    state = 'paused'; pauseReason = reason; silence();
  }
  function tick() {
    if (!context || !plan || anchorTime === null || !['running', 'finishing'].includes(state)) return;
    finishIfDue();
    if (state === 'finished') return;
    // A delayed main thread must not dump missed quarters into one audible burst.
    if (anchorTime + (nextBeat - offsetBeat) * 60 / plan.bpm < context.currentTime - .075) { pauseClock('timing'); return; }
    const horizon = context.currentTime + .1;
    while (anchorTime + (nextBeat - offsetBeat) * 60 / plan.bpm <= horizon) {
      const beat = getHarmonyBeat(plan, nextBeat);
      if (beat.finish) { state = 'finishing'; break; }
      const time = anchorTime + (nextBeat - offsetBeat) * 60 / plan.bpm;
      beat.events.forEach(event => schedule(event, time, nextBeat, beat.phase));
      nextBeat++;
    }
    voices = voices.filter(voice => {
      if (voice.end >= context!.currentTime - .02) return true;
      voice.oscillator.disconnect(); voice.envelope.disconnect(); return false;
    });
  }
  function continuation() {
    if (!plan || !context || !anchorTime || offsetBeat < plan.countInBeats || !startedBeforePause) return;
    const practice = offsetBeat - plan.countInBeats;
    const pass = Math.floor(practice / 16), within = practice % 16;
    for (const event of plan.harmony.events) {
      if (event.source === 'click') continue;
      const age = (within - event.beat) * 60 / plan.bpm;
      const duration = voiceDuration(event);
      if (age >= 0 && age < duration) schedule(event, anchorTime, offsetBeat, 'practice', duration - age, true);
    }
    // The next regular quarter starts strictly after the retained musical position.
    nextBeat = Math.floor(offsetBeat + 1e-9) + 1;
    if (plan.totalBeats !== null && pass > 0) nextBeat = plan.totalBeats;
  }
  function beginClock(resuming: boolean) {
    anchorTime = context!.currentTime + .035;
    finishAt = plan!.totalBeats === null ? null : anchorTime + (plan!.totalBeats - offsetBeat) * 60 / plan!.bpm;
    nextBeat = Math.ceil(offsetBeat - 1e-9);
    state = 'running'; pauseReason = null;
    applyMix(context!.currentTime, false);
    if (resuming) continuation();
    tick(); timer = setInterval(tick, 25);
  }
  function snapshot(includeTrace = true): HarmonySnapshot {
    finishIfDue();
    const beat = actualBeat(), countIn = plan?.countInBeats ?? 0;
    const phase = beat < countIn ? 'count-in' as const : 'practice' as const;
    const practice = Math.max(0, beat - countIn), within = practice % 16;
    const audible = ['running', 'finishing'].includes(state) && anchorTime !== null && (context?.currentTime ?? 0) >= anchorTime && phase === 'practice';
    const chordIndex = audible ? Math.floor(within / 4) : null;
    const bass = audible ? plan!.harmony.events.find(event => event.source === 'bass' && event.beat === Math.floor(within)) : null;
    let peak = 0, rms = 0;
    if (analyser) { const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples); for (const sample of samples) { peak = Math.max(peak, Math.abs(sample)); rms += sample * sample; } rms = Math.sqrt(rms / samples.length); }
    return { state, phase, audioTime: context?.currentTime ?? 0, bpm: plan?.bpm ?? 80, runId, epoch, transportBeat: beat,
      chordIndex, beat: Math.floor(phase === 'count-in' ? beat : within) % 4 + 1, passIndex: Math.floor(practice / 16), positionId: bass?.position?.id ?? null,
      startAt: anchorTime, finishAt, pauseReason, activeVoices: voices.filter(voice => voice.start <= (context?.currentTime ?? 0) && voice.end > (context?.currentTime ?? 0)).length,
      trace: includeTrace ? trace.map(event => ({ ...event })) : [], output: { peak, rms } };
  }
  return {
    async start(config: HarmonyPlaybackConfig = {}) {
      if (disposed) throw new Error('Сопровождение уже закрыто.');
      const next = createHarmonyPlaybackPlan(config);
      ++generation; silence();
      const expected = generation;
      runId++; epoch = 0; trace = []; plan = next; mix = next.mix; offsetBeat = 0; startedBeforePause = false;
      anchorTime = null; finishAt = null; pauseReason = null; state = 'starting';
      try {
        const audio = ensureContext(); await audio.resume();
        if (disposed || expected !== generation) return snapshot();
        if (audio.state !== 'running') throw new Error('Браузер не разрешил звук. Нажми «Старт» ещё раз.');
        beginClock(false); return snapshot();
      } catch (failure) { if (expected === generation) { state = 'stopped'; silence(); } throw failure; }
    },
    pause(reason = 'manual') {
      pauseClock(reason);
    },
    async resume() {
      if (disposed || state !== 'paused' || !plan) throw new Error('Сначала поставь сопровождение на паузу.');
      const expected = ++generation;
      state = 'starting';
      try {
        const audio = ensureContext(); await audio.resume();
        if (disposed || expected !== generation) return snapshot();
        if (audio.state !== 'running') throw new Error('Не удалось продолжить звук. Попробуй ещё раз.');
        epoch++; addTrace('resume', audio.currentTime, offsetBeat, offsetBeat < plan.countInBeats ? 'count-in' : 'practice');
        beginClock(true); return snapshot();
      } catch (failure) { if (expected === generation) { state = 'paused'; silence(); } throw failure; }
    },
    stop() {
      const beat = actualBeat(); ++generation;
      if (state !== 'stopped') addTrace('stop', context?.currentTime ?? 0, beat, beat < (plan?.countInBeats ?? 0) ? 'count-in' : 'practice');
      state = 'stopped'; silence(); offsetBeat = 0; anchorTime = null; finishAt = null; pauseReason = null;
    },
    setMix(change: { volumes?: Partial<Record<HarmonySource, number>>; muted?: Partial<Record<HarmonySource, boolean>> }) { mix = mixValue(mix, change); applyMix(); },
    getSnapshot: (options?: { includeTrace?: boolean }) => snapshot(options?.includeTrace !== false),
    async dispose() { if (disposed) return; disposed = true; ++generation; state = 'stopped'; silence(); SOURCES.forEach(source => buses?.[source].disconnect()); analyser?.disconnect(); const closing = context; context = null; buses = null; analyser = null; if (closing && closing.state !== 'closed') await closing.close(); },
  };
}

export interface HarmonyMixControl { readonly time: number; readonly source: HarmonySource; readonly volume?: number; readonly muted?: boolean }
export async function renderHarmonyOffline(config: HarmonyPlaybackConfig = {}, options: { readonly durationSeconds?: number; readonly sampleRate?: number; readonly controls?: readonly HarmonyMixControl[] } = {}): Promise<AudioBuffer> {
  const plan = createHarmonyPlaybackPlan(config), seconds = 60 / plan.bpm;
  const sampleRate = options.sampleRate ?? 44100;
  const duration = options.durationSeconds ?? ((plan.totalBeats ?? plan.countInBeats + 32) * seconds + .1);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || !Number.isFinite(duration) || duration <= 0 || duration > 120) throw new RangeError('Некорректный размер offline PCM.');
  const context = new OfflineAudioContext(3, Math.ceil(duration * sampleRate), sampleRate);
  const merger = context.createChannelMerger(3); merger.channelInterpretation = 'discrete'; merger.connect(context.destination);
  const buses = { bass: context.createGain(), pad: context.createGain(), click: context.createGain() };
  SOURCES.forEach((source, index) => buses[source].connect(merger, 0, index));
  let mix = plan.mix;
  SOURCES.forEach(source => buses[source].gain.setValueAtTime(mix.muted[source] ? 0 : mix.volumes[source], 0));
  for (const control of [...(options.controls ?? [])].sort((a, b) => a.time - b.time)) {
    if (!SOURCES.includes(control.source) || !Number.isFinite(control.time) || control.time < 0 || control.time > duration) throw new RangeError('Некорректный момент изменения микшера.');
    mix = mixValue(mix, { volumes: control.volume === undefined ? {} : { [control.source]: control.volume }, muted: control.muted === undefined ? {} : { [control.source]: control.muted } });
    buses[control.source].gain.setValueAtTime(mix.muted[control.source] ? 0 : mix.volumes[control.source], control.time);
  }
  for (let beat = 0; beat * seconds < duration; beat++) {
    const frame = getHarmonyBeat(plan, beat); if (frame.finish) break;
    frame.events.forEach(event => synthesize(context, buses[event.source], event, beat * seconds));
  }
  return context.startRendering();
}
