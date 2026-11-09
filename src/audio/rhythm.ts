import {
  DEFAULT_RHYTHM_PREFERENCES, RHYTHM_KITS, SOUND_LABELS, createRhythmPlan, rhythmFrameAt, validateRhythmChannel,
  type RhythmChannel, type RhythmFrame, type RhythmHit, type RhythmKit, type RhythmPlan,
  type RhythmPlaybackConfig, type RhythmPosition, type RhythmSource,
} from '../rhythm/model';
import { createRhythmNoise, describeRhythmHit, scheduleRhythmVoice, type RhythmTail, type RhythmVoice } from './rhythm-synth';

export type { RhythmPlaybackConfig, RhythmPosition, RhythmSource } from '../rhythm/model';
export interface RhythmMix {
  readonly master: number; readonly accentVolume: number; readonly clickVolume: number; readonly subdivisionVolume: number;
  readonly channels: readonly RhythmChannel[];
}
export interface RhythmPracticeClock {
  readonly playback: RhythmPlaybackConfig; readonly durationMs: number; readonly comfortableBpm: number;
  readonly runtimeContextKey: string;
}
export type RhythmState = 'stopped' | 'starting' | 'running' | 'paused' | 'finishing' | 'finished';
export interface RhythmTraceEvent {
  readonly type: 'frame' | 'hit' | 'gate' | 'pause' | 'resume' | 'stop' | 'finish';
  readonly time: number; readonly frameIndex: number | null; readonly position: RhythmPosition | null;
  readonly bpm: number; readonly source: RhythmSource | null; readonly sound: RhythmHit['sound'] | null;
  readonly velocity: number | null; readonly continuation: boolean; readonly runId: number; readonly epoch: number;
  cancelled: boolean;
}
export interface RhythmSnapshot {
  readonly state: RhythmState; readonly phase: 'count-in' | 'practice'; readonly position: RhythmPosition | null;
  readonly effectiveConfig: RhythmPlaybackConfig | null; readonly mix: RhythmMix;
  readonly audioTime: number; readonly bpm: number; readonly runId: number; readonly epoch: number;
  readonly practiceDurationMs: number; readonly runtimeContextKey: string | null;
  readonly startAt: number | null; readonly finishAt: number | null; readonly pauseReason: string | null;
  readonly activeVoices: number; readonly trace: readonly RhythmTraceEvent[];
  readonly output: { readonly peak: number; readonly rms: number };
}
export type RhythmViewSnapshot = Pick<RhythmSnapshot, 'state' | 'phase' | 'position' | 'effectiveConfig' | 'bpm' | 'runtimeContextKey' | 'pauseReason'>;
export interface RhythmPlayerOptions {
  readonly onSnapshot?: (snapshot: RhythmViewSnapshot) => void;
  readonly onPracticeEnd?: (clock: RhythmPracticeClock) => void;
}
interface PlanVersion {
  readonly plan: RhythmPlan;
  /** Абсолютный номер завершённого такта, с которого заново отсчитывается рост. */
  readonly tempoBaseBar: number;
  readonly epoch: number;
}
interface ScheduledFrame {
  readonly frame: RhythmFrame; readonly version: PlanVersion; readonly at: number; readonly end: number;
}
interface PausedPosition {
  readonly nextIndex: number; readonly remaining: number;
  readonly tails: readonly RhythmTail[]; readonly pendingHits: readonly RhythmHit[];
}
interface RhythmGraph {
  readonly context: BaseAudioContext; readonly master: GainNode; readonly gate: GainNode;
  readonly buses: Map<RhythmSource, GainNode>; readonly noise: AudioBuffer;
}
interface LiveGraph extends RhythmGraph { readonly preview: GainNode; readonly analyser: AnalyserNode }

const CLICK_SOURCES = ['accent', 'click', 'subdivision'] as const;
const LOOKAHEAD = .1;
const LEAD = .035;
const LATE_MARGIN = .006;
const MIX_RAMP = .005;
const TRACE_LIMIT = 4096;
const mixFor = ({ preferences, project }: RhythmPlaybackConfig): RhythmMix => Object.freeze({
  master: preferences.master, accentVolume: preferences.metronome.accentVolume,
  clickVolume: preferences.metronome.clickVolume, subdivisionVolume: preferences.metronome.subdivisionVolume,
  channels: project?.channels ?? Object.freeze([]),
});
const DEFAULT_MIX = mixFor({ preferences: DEFAULT_RHYTHM_PREFERENCES });

const sameChannelMix = (left: RhythmChannel, right: RhythmChannel) =>
  left.id === right.id && left.volume === right.volume && left.muted === right.muted && left.solo === right.solo;
function sameMix(left: RhythmMix, right: RhythmMix) {
  return left.master === right.master && left.accentVolume === right.accentVolume &&
    left.clickVolume === right.clickVolume && left.subdivisionVolume === right.subdivisionVolume &&
    left.channels.length === right.channels.length && left.channels.every((channel, index) => sameChannelMix(channel, right.channels[index]));
}

/** The sounding grid can lag behind the settings while the gain buses apply immediately. */
function withMix(config: RhythmPlaybackConfig, mix: RhythmMix): RhythmPlaybackConfig {
  if (sameMix(mixFor(config), mix)) return config;
  const { master, accentVolume, clickVolume, subdivisionVolume } = mix;
  const preferences = Object.freeze({ ...config.preferences, master,
    metronome: Object.freeze({ ...config.preferences.metronome, accentVolume, clickVolume, subdivisionVolume }) });
  if (!config.project) return Object.freeze({ preferences });
  const channels = config.project.channels.map(channel => {
    const applied = mix.channels.find(candidate => candidate.id === channel.id);
    if (!applied || sameChannelMix(channel, applied)) return channel;
    const { volume, muted, solo } = applied;
    return Object.freeze({ ...channel, volume, muted, solo });
  });
  return Object.freeze({ preferences, project: Object.freeze({ ...config.project, channels: Object.freeze(channels) }) });
}

function mixSources(mix: RhythmMix): RhythmSource[] {
  return [...CLICK_SOURCES, ...mix.channels.map(channel => `lane:${channel.id}` as const)];
}
function gainsFor(mix: RhythmMix): ReadonlyMap<RhythmSource, number> {
  const gains = new Map<RhythmSource, number>([['accent', mix.accentVolume], ['click', mix.clickVolume], ['subdivision', mix.subdivisionVolume]]);
  const anySolo = mix.channels.some(channel => channel.solo);
  for (const channel of mix.channels) gains.set(`lane:${channel.id}`, channel.muted || anySolo && !channel.solo ? 0 : channel.volume);
  return gains;
}
function setGain(gain: AudioParam, value: number, at: number, smooth: boolean) {
  if (!smooth) {
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(value, at);
    return;
  }
  // При повторном движении ползунка удерживаем фактическое значение шины.
  if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(at);
  else { gain.cancelScheduledValues(at); gain.setValueAtTime(gain.value, at); }
  gain.linearRampToValueAtTime(value, at + MIX_RAMP);
}
function applyGraphMix(graph: RhythmGraph, mix: RhythmMix, smooth: boolean, at = graph.context.currentTime) {
  const gains = gainsFor(mix);
  setGain(graph.master.gain, mix.master, at, smooth);
  for (const [source, node] of graph.buses) setGain(node.gain, gains.get(source) ?? 0, at, smooth);
}
function createGraph(context: BaseAudioContext, sources: readonly RhythmSource[], target: AudioNode, separate: boolean): RhythmGraph {
  const gate = context.createGain();
  gate.channelInterpretation = 'discrete';
  gate.connect(target);
  const master = context.createGain();
  master.channelInterpretation = 'discrete';
  master.connect(gate);
  const merger = separate ? context.createChannelMerger(sources.length) : null;
  if (merger) { merger.channelInterpretation = 'discrete'; merger.connect(master); }
  const buses = new Map<RhythmSource, GainNode>();
  for (const [index, source] of sources.entries()) {
    const bus = context.createGain();
    if (merger) bus.connect(merger, 0, index);
    else bus.connect(master);
    buses.set(source, bus);
  }
  return { context, master, gate, buses, noise: createRhythmNoise(context) };
}
function schedulePart(graph: RhythmGraph, destination: AudioNode, part: RhythmTail, at: number, voices: RhythmVoice[]) {
  const voice = scheduleRhythmVoice(graph.context, destination, graph.noise, part, at);
  if (voice) voices.push(voice);
}
function scheduleHit(graph: RhythmGraph, hit: RhythmHit, kit: RhythmKit, at: number, voices: RhythmVoice[], destination = graph.buses.get(hit.source)) {
  if (!destination) return;
  for (const part of describeRhythmHit(hit.sound, kit)) {
    schedulePart(graph, destination, { part, sourceId: hit.source, sound: hit.sound, velocity: hit.velocity, age: -part.offset }, at, voices);
  }
}
function cutoffVoices(voices: readonly RhythmVoice[], time: number) {
  for (const voice of voices) voice.cutoff(time);
}
const hitTime = (scheduled: ScheduledFrame, hit: RhythmHit) => scheduled.at + (hit.offset ?? 0);
function scheduleFrame(graph: RhythmGraph, scheduled: ScheduledFrame, voices: RhythmVoice[], until = Infinity) {
  const { frame, at, version } = scheduled;
  if (frame.barStart) {
    graph.gate.gain.setValueAtTime(frame.position.silent ? 0 : 1, at);
    // Сэмплы за границей немого такта не остаются ждать открытия шины.
    if (frame.position.silent) cutoffVoices(voices, at);
  }
  const hits = until === Infinity ? frame.hits : frame.hits.filter(hit => hitTime(scheduled, hit) < until);
  for (const hit of hits) scheduleHit(graph, hit, version.plan.config.preferences.metronome.kit, hitTime(scheduled, hit), voices);
  return hits;
}
function eventFor(type: RhythmTraceEvent['type'], scheduled: ScheduledFrame | null, time: number, runId: number, epoch: number,
  bpm: number, hit?: RhythmHit, continuation = false): RhythmTraceEvent {
  return { type, time, frameIndex: scheduled?.frame.index ?? null, position: scheduled?.frame.position ?? null, bpm,
    source: hit?.source ?? null, sound: hit?.sound ?? null, velocity: hit?.velocity ?? null, continuation, runId, epoch, cancelled: false };
}

/** Структура определяет индексы кадров. Изменение этой структуры завершает запуск. */
function structureKey(config: RhythmPlaybackConfig): string {
  const { project } = config;
  if (project) return JSON.stringify([project.id, project.scope, project.repeat, project.countIn,
    project.scope === 'pattern' ? project.activePatternId : project.chain,
    project.channels.map(channel => [channel.id, channel.sound]), project.patterns.map(pattern => [pattern.id, pattern.bars])]);
  const { meter, division, training, countIn } = config.preferences.metronome;
  return JSON.stringify([meter, division, training, countIn]);
}
function barKey(config: RhythmPlaybackConfig): string {
  const { project, preferences: { metronome } } = config;
  if (!project) return JSON.stringify([metronome.bpm, metronome.bpmUnit, metronome.swing, metronome.swingMode]);
  const clickGrid = project.overlay ? [metronome.meter.beats, metronome.meter.denominator, metronome.division, metronome.swing, metronome.swingMode] : null;
  return JSON.stringify([project.bpm, project.swing, project.swingMode, clickGrid]);
}
function audibleKey(config: RhythmPlaybackConfig): string {
  const { project, preferences: { metronome } } = config;
  if (!project) return JSON.stringify([barKey(config), metronome.accents, metronome.substeps, metronome.kit]);
  const used = new Set(project.scope === 'chain' ? project.chain.map(clip => clip.patternId) : [project.activePatternId]);
  return JSON.stringify([barKey(config), metronome.kit, project.overlay ? [metronome.accents, metronome.substeps] : null,
    project.patterns.filter(pattern => used.has(pattern.id)).map(pattern => pattern.lanes)]);
}
function holdBarSettings(desired: RhythmPlaybackConfig, scheduled: RhythmPlaybackConfig): RhythmPlaybackConfig {
  if (desired.project && scheduled.project) {
    const { bpm, swing, swingMode } = scheduled.project;
    const before = scheduled.preferences.metronome, after = desired.preferences.metronome;
    const sameGrid = before.meter.beats === after.meter.beats && before.meter.denominator === after.meter.denominator && before.division === after.division;
    const clickGrid = sameGrid ? after : { ...after, meter: before.meter, bpmUnit: before.bpmUnit, division: before.division, accents: before.accents, substeps: before.substeps };
    const metronome = { ...clickGrid, swing: before.swing, swingMode: before.swingMode };
    return { preferences: { ...desired.preferences, metronome }, project: { ...desired.project, bpm, swing, swingMode } };
  }
  const { bpm, bpmUnit, swing, swingMode } = scheduled.preferences.metronome;
  return { preferences: { ...desired.preferences, metronome: { ...desired.preferences.metronome, bpm, bpmUnit, swing, swingMode } } };
}
const baseBpm = (config: RhythmPlaybackConfig) => config.project?.bpm ?? config.preferences.metronome.bpm;

export function createRhythmPlayer(options: RhythmPlayerOptions = {}) {
  let context: AudioContext | null = null;
  let graph: LiveGraph | null = null;
  let state: RhythmState = 'stopped';
  let desired: RhythmPlaybackConfig | null = null;
  let effective: PlanVersion | null = null;
  let scheduledPlan: PlanVersion | null = null;
  let mix = DEFAULT_MIX;
  let planDirty = false;
  let waitingForBar = false;
  let current: ScheduledFrame | null = null;
  let nextIndex = 0;
  let nextAt = 0;
  let paused: PausedPosition | null = null;
  let pauseReason: string | null = null;
  let startAt: number | null = null;
  let finishAt: number | null = null;
  let practiceSince: number | null = null;
  let practiceSeconds = 0;
  let sealedPracticeSeconds = 0;
  let practiceEpoch = 0;
  let practiceConfig: RhythmPlaybackConfig | null = null;
  let practiceClosed = true;
  let dispatchClock: RhythmPracticeClock | null = null;
  let runId = 0;
  let nextEpoch = 0;
  let generation = 0;
  let disposed = false;
  let updating = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let voices: RhythmVoice[] = [];
  const queued: ScheduledFrame[] = [];
  const trace: RhythmTraceEvent[] = [];

  const clock = () => context?.currentTime ?? 0;
  const running = () => state === 'running' || state === 'finishing';
  const practiceKey = () => `rhythm:${runId}:${practiceEpoch}`;
  function traceEvent(type: RhythmTraceEvent['type'], time: number, frame = current, hit?: RhythmHit, continuation = false) {
    trace.push(eventFor(type, frame, time, runId, frame?.version.epoch ?? effective?.epoch ?? 0,
      frame?.frame.bpm ?? (effective ? baseBpm(effective.plan.config) : 92), hit, continuation));
    if (trace.length > TRACE_LIMIT) trace.splice(0, TRACE_LIMIT / 4);
  }
  function elapsedPractice(at: number) {
    return practiceSeconds + (practiceSince === null ? 0 : Math.max(0, at - practiceSince));
  }
  function currentPractice(at: number): RhythmPracticeClock | null {
    if (!practiceConfig || practiceClosed) return null;
    // Round the running total at each boundary so short consecutive intervals do not accumulate rounding errors.
    const durationMs = Math.round((sealedPracticeSeconds + elapsedPractice(at)) * 1000) - Math.round(sealedPracticeSeconds * 1000);
    return { playback: practiceConfig, durationMs,
      comfortableBpm: current?.frame.bpm ?? baseBpm(practiceConfig), runtimeContextKey: practiceKey() };
  }
  function closePractice(at: number) {
    if (practiceClosed) return;
    const practice = currentPractice(at);
    sealedPracticeSeconds += elapsedPractice(at);
    practiceClosed = true;
    practiceSince = null;
    if (!practice || practice.durationMs === 0 || !options.onPracticeEnd) return;
    dispatchClock = practice;
    try { options.onPracticeEnd(practice); } finally { dispatchClock = null; }
  }
  function switchPractice(at: number, config: RhythmPlaybackConfig) {
    const since = practiceSince;
    closePractice(at);
    practiceConfig = config;
    practiceEpoch++;
    practiceClosed = false;
    practiceSeconds = 0;
    practiceSince = since === null ? null : Math.max(since, at);
  }
  function quiet(at = clock()) {
    if (timer !== null) clearInterval(timer);
    timer = null;
    for (const event of trace) if (!event.cancelled && event.runId === runId && event.time > at) event.cancelled = true;
    queued.length = 0;
    for (const voice of voices) voice.cancel(at);
    voices = [];
    if (graph) { graph.gate.gain.cancelScheduledValues(at); graph.gate.gain.setValueAtTime(0, at); }
  }
  function advanceActual(now = clock()) {
    if (!running() || updating) return;
    updating = true;
    try {
      while (queued.length && queued[0].at <= now) {
        const frame = queued.shift()!;
        if (frame.version !== effective) {
          switchPractice(frame.at, withMix(frame.version.plan.config, mix));
          effective = frame.version;
        }
        current = frame;
        if (frame.frame.position.phase === 'practice' && practiceSince === null) practiceSince = frame.at;
      }
      if (finishAt !== null && now >= finishAt) {
        closePractice(finishAt);
        traceEvent('finish', finishAt);
        state = 'finished';
        quiet(now);
      }
    } finally { updating = false; }
  }
  function viewSnapshot(now: number): RhythmViewSnapshot {
    advanceActual(now);
    const position = state === 'stopped' || state === 'finished' ? null : current?.frame.position ?? null;
    const phase = position?.phase ?? (effective?.plan.countInSteps ? 'count-in' : 'practice');
    return { state, phase, position, effectiveConfig: effective ? practiceConfig : null,
      bpm: current?.frame.bpm ?? (desired ? baseBpm(desired) : 92), pauseReason,
      runtimeContextKey: dispatchClock?.runtimeContextKey ?? (practiceClosed ? null : practiceKey()) };
  }
  function getSnapshot({ includeTrace = true }: { includeTrace?: boolean } = {}): RhythmSnapshot {
    const now = clock();
    const view = viewSnapshot(now);
    const practice = dispatchClock ?? currentPractice(now);
    let peak = 0, squares = 0;
    const analyser = graph?.analyser;
    if (analyser) {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      for (const value of samples) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
    }
    return { ...view, mix, audioTime: now, runId, epoch: effective?.epoch ?? 0,
      practiceDurationMs: practice?.durationMs ?? 0,
      startAt, finishAt, activeVoices: voices.filter(voice => voice.start <= now && voice.end > now).length,
      trace: includeTrace ? trace.map(event => ({ ...event })) : [], output: { peak, rms: Math.sqrt(squares / (analyser?.fftSize ?? 1)) } };
  }
  const emit = () => options.onSnapshot?.(viewSnapshot(clock()));
  function stop() {
    if (disposed) return;
    const now = clock();
    advanceActual(now);
    closePractice(now);
    if (state !== 'stopped') traceEvent('stop', now);
    ++generation;
    quiet(now);
    state = 'stopped'; effective = null; scheduledPlan = null; current = null; paused = null;
    pauseReason = null; startAt = null; finishAt = null;
    emit();
  }
  function updateMix(value: RhythmMix, smooth = true) {
    const changed = !sameMix(mix, value);
    const now = clock();
    if (changed && effective && !practiceClosed) switchPractice(now, withMix(effective.plan.config, value));
    mix = value;
    if (graph && changed) {
      applyGraphMix(graph, mix, smooth, now);
      setGain(graph.preview.gain, mix.master, now, smooth);
    }
    return changed;
  }
  function setMix(change: Partial<RhythmMix>) {
    const next = { ...mix, ...change };
    for (const value of [next.master, next.accentVolume, next.clickVolume, next.subdivisionVolume]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Громкость должна быть от 0 до 1.');
    }
    const channels = next.channels.map(validateRhythmChannel);
    if (JSON.stringify(channels.map(channel => [channel.id, channel.sound])) !== JSON.stringify(mix.channels.map(channel => [channel.id, channel.sound]))) {
      throw new RangeError('Состав инструментов меняется после остановки.');
    }
    advanceActual();
    updateMix(Object.freeze({ ...next, channels: Object.freeze(channels) }));
    emit();
  }
  function configure(input: RhythmPlaybackConfig): 'applied' | 'queued' | 'stopped' {
    let next: RhythmPlaybackConfig;
    try { next = createRhythmPlan(input).config; }
    catch (failure) { stop(); throw failure; }
    advanceActual();
    const active = effective && !['stopped', 'finished'].includes(state);
    if (active && structureKey(effective!.plan.config) !== structureKey(next)) {
      stop(); desired = next; updateMix(mixFor(next)); emit(); return 'stopped';
    }
    desired = next;
    if (updateMix(mixFor(next))) emit();
    if (active && audibleKey(scheduledPlan!.plan.config) !== audibleKey(next)) {
      planDirty = true;
      return 'queued';
    }
    // Пользователь мог вернуть исходное значение до границы применения.
    planDirty = false; waitingForBar = false;
    return 'applied';
  }
  async function acquireContext(expected: number): Promise<AudioContext | null> {
    if (!context || context.state === 'closed') {
      context = new AudioContext({ latencyHint: 'interactive' });
      graph = null;
    }
    const audio = context;
    await audio.resume();
    if (disposed || expected !== generation || context !== audio) return null;
    if (audio.state !== 'running') throw new Error('Браузер не разрешил звук. Нажми запуск ещё раз.');
    return audio;
  }
  function prepareGraph(audio: AudioContext) {
    const sources = mixSources(mix);
    if (graph && JSON.stringify([...graph.buses.keys()]) === JSON.stringify(sources)) return graph;
    if (graph) {
      for (const bus of graph.buses.values()) bus.disconnect();
      graph.master.disconnect(); graph.gate.disconnect(); graph.preview.disconnect(); graph.analyser.disconnect();
    }
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    analyser.connect(audio.destination);
    const preview = audio.createGain();
    preview.gain.value = mix.master;
    preview.connect(analyser);
    return graph = { ...createGraph(audio, sources, analyser, false), analyser, preview };
  }
  function updateScheduledPlan(index: number) {
    const version = scheduledPlan!;
    const plan = version.plan;
    const practiceStep = index - plan.countInSteps;
    const barBoundary = index === 0 || practiceStep >= 0 && practiceStep % plan.practiceStepsPerBar === 0;
    if (!desired || !planDirty && !(waitingForBar && barBoundary)) return;
    const next = barBoundary ? desired : holdBarSettings(desired, plan.config);
    planDirty = false;
    waitingForBar = barKey(next) !== barKey(desired);
    if (audibleKey(next) === audibleKey(plan.config)) return;
    const tempoBaseBar = baseBpm(next) === baseBpm(plan.config) ? version.tempoBaseBar : Math.max(0, Math.floor(practiceStep / plan.practiceStepsPerBar));
    scheduledPlan = { plan: createRhythmPlan(next), tempoBaseBar, epoch: ++nextEpoch };
  }
  function pause(reason = 'manual', limit?: number) {
    if (state === 'stopped') {
      ++generation;
      quiet();
      return;
    }
    if (!running() && state !== 'starting') return;
    const now = clock();
    advanceActual(now);
    if (state === 'finished') { emit(); return; }
    // В задержке перед возобновлением музыкальная позиция ещё удерживается.
    const at = current && startAt !== null && now < startAt ? startAt : limit === undefined ? now : Math.min(now, limit);
    if (practiceSince !== null) practiceSeconds += Math.max(0, at - practiceSince);
    practiceSince = null;
    if (state !== 'starting' || !paused) {
      const frame = current;
      paused = { nextIndex: frame ? frame.frame.index + 1 : 0, remaining: frame ? Math.max(0, frame.end - at) : 0,
        pendingHits: frame ? frame.frame.hits.filter(hit => hitTime(frame, hit) > at) : [],
        tails: frame?.frame.position.silent ? [] : voices.filter(voice => voice.originAt <= at && voice.end > at).map(voice => ({
          part: voice.part, sourceId: voice.sourceId, sound: voice.sound, velocity: voice.velocity, age: at - voice.virtualPartStart,
        })) };
    }
    ++generation;
    traceEvent('pause', now);
    quiet(now);
    scheduledPlan = effective;
    planDirty = true; waitingForBar = false;
    finishAt = null; state = 'paused'; pauseReason = reason;
    emit();
  }
  function pump() {
    if (!running() || !context || !graph) return;
    const now = clock();
    advanceActual(now);
    if (!running()) { emit(); return; }
    if (context.state !== 'running') { pause('interrupted'); return; }
    if (state === 'running' && nextAt < now - LATE_MARGIN) { pause('timing', current?.end ?? nextAt); return; }
    while (state === 'running' && nextAt <= now + LOOKAHEAD) {
      updateScheduledPlan(nextIndex);
      const version = scheduledPlan!;
      const frame = rhythmFrameAt(version.plan, nextIndex, version.tempoBaseBar);
      if (!frame) {
        finishAt = nextAt;
        graph.gate.gain.setValueAtTime(0, finishAt);
        cutoffVoices(voices, finishAt);
        state = 'finishing';
        break;
      }
      const scheduled = { frame, version, at: nextAt, end: nextAt + frame.duration };
      queued.push(scheduled);
      const hits = scheduleFrame(graph, scheduled, voices);
      traceEvent('frame', nextAt, scheduled);
      if (frame.barStart && frame.position.silent) traceEvent('gate', nextAt, scheduled);
      for (const hit of hits) traceEvent('hit', hitTime(scheduled, hit), scheduled, hit);
      nextIndex++;
      nextAt = scheduled.end;
    }
    voices = voices.filter(voice => voice.end > now);
    emit();
  }
  function begin(audio: AudioContext, resumeAt: PausedPosition | null, expected: number) {
    const output = prepareGraph(audio);
    const anchor = audio.currentTime + LEAD;
    startAt = anchor; finishAt = null; pauseReason = null;
    nextIndex = resumeAt?.nextIndex ?? 0; nextAt = anchor + (resumeAt?.remaining ?? 0);
    state = 'running'; paused = null;
    applyGraphMix(output, mix, false);
    output.gate.gain.setValueAtTime(current?.frame.position.silent ? 0 : 1, audio.currentTime);
    if (resumeAt && current) {
      current = { ...current, at: anchor - (current.frame.duration - resumeAt.remaining), end: nextAt };
      if (current.frame.position.phase === 'practice') practiceSince = anchor;
      traceEvent('resume', anchor);
      for (const tail of resumeAt.tails) {
        const destination = output.buses.get(tail.sourceId);
        if (destination) {
          schedulePart(output, destination, tail, anchor, voices);
          traceEvent('hit', anchor + Math.max(0, -tail.age), current, { source: tail.sourceId, sound: tail.sound, velocity: tail.velocity }, true);
        }
      }
      for (const hit of resumeAt.pendingHits) {
        const at = hitTime(current, hit);
        scheduleHit(output, hit, current.version.plan.config.preferences.metronome.kit, at, voices);
        traceEvent('hit', at, current, hit);
      }
    }
    pump();
    if (running() && expected === generation) timer = setInterval(pump, 20);
  }
  return {
    configure, setMix, pause, stop, getSnapshot,
    getPractice(): RhythmPracticeClock | null {
      if (dispatchClock) return dispatchClock;
      advanceActual();
      return currentPractice(clock());
    },
    async start(input: RhythmPlaybackConfig): Promise<RhythmSnapshot> {
      if (disposed) throw new Error('Проигрыватель ритма закрыт.');
      let plan: RhythmPlan;
      try { plan = createRhythmPlan(input); } catch (failure) { stop(); throw failure; }
      stop();
      const expected = ++generation;
      runId++; nextEpoch = 0; trace.length = 0;
      desired = plan.config; effective = scheduledPlan = { plan, tempoBaseBar: 0, epoch: 0 };
      practiceSeconds = 0; practiceSince = null; sealedPracticeSeconds = 0; practiceEpoch = 0;
      planDirty = false; waitingForBar = false;
      updateMix(mixFor(plan.config), false);
      practiceConfig = plan.config; practiceClosed = false;
      state = 'starting'; emit();
      try {
        const audio = await acquireContext(expected);
        if (audio && expected === generation) begin(audio, null, expected);
      } catch (failure) {
        if (expected !== generation || disposed) return getSnapshot();
        stop(); throw failure;
      }
      return getSnapshot();
    },
    async resume(): Promise<RhythmSnapshot> {
      if (disposed || state !== 'paused' || !paused || !effective) throw new Error('Сначала поставь ритм на паузу.');
      const expected = ++generation, position = paused;
      state = 'starting'; emit();
      try {
        const audio = await acquireContext(expected);
        if (audio && expected === generation) begin(audio, position, expected);
      } catch (failure) {
        if (expected !== generation || disposed) return getSnapshot();
        quiet(); state = 'paused'; paused = position; emit(); throw failure;
      }
      return getSnapshot();
    },
    async preview(sound: RhythmHit['sound'] = 'accent', kit = desired?.preferences.metronome.kit ?? 'wood'): Promise<void> {
      if (disposed) throw new Error('Проигрыватель ритма закрыт.');
      if (!RHYTHM_KITS.includes(kit) || !Object.hasOwn(SOUND_LABELS, sound) && !['accent', 'normal', 'subdivision'].includes(sound)) throw new RangeError('Неизвестный звук.');
      stop(); const expected = ++generation;
      try {
        const audio = await acquireContext(expected);
        if (!audio || expected !== generation) return;
        const output = prepareGraph(audio);
        setGain(output.preview.gain, mix.master, audio.currentTime, false);
        const at = audio.currentTime + .015;
        for (const part of describeRhythmHit(sound, kit)) {
          schedulePart(output, output.preview, { part, sourceId: 'accent', sound, velocity: 1, age: -part.offset }, at, voices);
        }
      } catch (failure) { if (expected === generation && !disposed) throw failure; }
    },
    async dispose() {
      if (disposed) return;
      stop(); disposed = true; ++generation;
      const audio = context;
      context = null; graph = null;
      if (audio && audio.state !== 'closed') await audio.close();
    },
  };
}

export interface RhythmMixControl { readonly time: number; readonly source: RhythmSource | 'master'; readonly volume?: number; readonly muted?: boolean }
export interface RhythmOfflineOptions { readonly durationSeconds?: number; readonly sampleRate?: number; readonly bars?: number; readonly controls?: readonly RhythmMixControl[] }
export interface RhythmOfflineResult { readonly buffer: AudioBuffer; readonly sources: readonly RhythmSource[]; readonly trace: readonly RhythmTraceEvent[]; readonly finishAt: number | null }

/** Настоящий многоканальный PCM. Использует тот же план, синтез и границы тишины. */
export async function renderRhythmOffline(input: RhythmPlaybackConfig, options: RhythmOfflineOptions = {}): Promise<RhythmOfflineResult> {
  const plan = createRhythmPlan(input);
  const sampleRate = options.sampleRate ?? 44100;
  const bars = options.bars ?? (plan.totalSteps === null ? Math.max(4, plan.bars.length) : plan.bars.length);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || !Number.isInteger(bars) || bars < 1 || bars > 64
    || options.durationSeconds !== undefined && (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0 || options.durationSeconds > 120)) throw new RangeError('Некорректная длительность PCM.');
  const version: PlanVersion = { plan, tempoBaseBar: 0, epoch: 0 };
  const frames: ScheduledFrame[] = [];
  let time = 0;
  let index = 0;
  const limit = plan.countInSteps + bars * plan.practiceStepsPerBar;
  while (index < limit && time < (options.durationSeconds ?? 120)) {
    const frame = rhythmFrameAt(plan, index);
    if (!frame) break;
    frames.push({ frame, version, at: time, end: time + frame.duration });
    time += frame.duration;
    index++;
  }
  const finishAt = index === plan.totalSteps ? time : null;
  const duration = options.durationSeconds ?? time + .1;
  const mix = mixFor(plan.config), sources = mixSources(mix);
  const length = Math.ceil(sampleRate * duration);
  if (duration > 120 || length * sources.length > 32_000_000) throw new RangeError('Слишком большой контрольный PCM.');
  const context = new OfflineAudioContext(sources.length, length, sampleRate);
  const graph = createGraph(context, sources, context.destination, true);
  applyGraphMix(graph, mix, false);
  const baseGains = gainsFor(mix);
  const levels = new Map<RhythmSource | 'master', number>(baseGains);
  levels.set('master', mix.master);
  const muted = new Set<RhythmSource | 'master'>();
  for (const change of [...(options.controls ?? [])].sort((a, b) => a.time - b.time)) {
    const gain = change.source === 'master' ? graph.master.gain : graph.buses.get(change.source)?.gain;
    if (!gain || !Number.isFinite(change.time) || change.time < 0 || change.time > duration || change.volume !== undefined
      && (!Number.isFinite(change.volume) || change.volume < 0 || change.volume > (change.source.startsWith('lane:') ? 1.5 : 1))
      || change.muted !== undefined && typeof change.muted !== 'boolean') throw new RangeError('Некорректная настройка контрольного микшера.');
    if (change.volume !== undefined) levels.set(change.source, change.volume);
    if (change.muted === true) muted.add(change.source);
    if (change.muted === false) muted.delete(change.source);
    gain.setValueAtTime(muted.has(change.source) ? 0 : levels.get(change.source) ?? 0, change.time);
  }
  let voices: RhythmVoice[] = [];
  const trace: RhythmTraceEvent[] = [];
  for (const frame of frames) {
    voices = voices.filter(voice => voice.end > frame.at);
    const hits = scheduleFrame(graph, frame, voices, duration);
    trace.push(eventFor('frame', frame, frame.at, 1, 0, frame.frame.bpm));
    if (frame.frame.barStart && frame.frame.position.silent) trace.push(eventFor('gate', frame, frame.at, 1, 0, frame.frame.bpm));
    for (const hit of hits) trace.push(eventFor('hit', frame, hitTime(frame, hit), 1, 0, frame.frame.bpm, hit));
  }
  if (finishAt !== null && finishAt <= duration) {
    graph.gate.gain.setValueAtTime(0, finishAt);
    cutoffVoices(voices, finishAt);
    trace.push(eventFor('finish', frames.at(-1) ?? null, finishAt, 1, 0, frames.at(-1)?.frame.bpm ?? baseBpm(plan.config)));
  }
  return { buffer: await context.startRendering(), sources, trace, finishAt: finishAt !== null && finishAt <= duration ? finishAt : null };
}
