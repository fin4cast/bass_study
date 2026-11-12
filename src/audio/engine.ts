import { BASS_TIMBRE, bassLowpassHz } from './bass-timbre';
import { audioContext, resumeAudio } from './context';
import { createPlaybackPlan, eventAtGrid, finiteDurationSeconds, validateBpm, type GridEvent, type PlaybackConfig, type PlaybackPlan } from './plan';
import { checkSchedule, createTicker, scheduleHorizon } from './scheduler';

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
  /** Номер текущей досылки сетки; null, когда сетка не планируется (стоп, пауза, конец). */
  readonly repeatId: number | null;
  readonly activeVoices: number;
  readonly transportBeat: number;
  readonly contextState: string;
}

type Frame = GridEvent & { readonly time: number; readonly epoch: number };
/** Точка темпа: с момента time сетка идёт от grid со скоростью bpm (шестнадцатая = 15/bpm с). */
interface TempoPoint { readonly time: number; readonly grid: number; readonly bpm: number }
const MAX_TRACE = 4096;
const MAX_FRAMES = 4096;
const EPSILON = 0.000001;
/** Задержка первой шестнадцатой после старта или продолжения (как у прежнего transport). */
const START_LEAD = 0.1;
const OFFLINE_SAMPLE_RATE = 44100;
const gridSeconds = (bpm: number) => 15 / bpm;
const dbToGain = (db: number) => 10 ** (db / 20);

interface Envelope { readonly attack: number; readonly decay: number; readonly sustain: number; readonly release: number }
const BASS_VOICE = { waveform: BASS_TIMBRE.waveform, level: dbToGain(-12), envelope: { attack: 0.003, decay: 0.008, sustain: 0.65, release: 0.006 } } as const;
const CLICK_VOICE = { waveform: 'triangle', level: dbToGain(-18), envelope: { attack: 0.001, decay: 0.004, sustain: 0.3, release: 0.003 } } as const;
/** Постоянная экспоненциального спада, при которой значение почти доходит до цели за rampTime. */
const approachConstant = (rampTime: number) => Math.log(rampTime + 1) / Math.log(200);

interface Voice { readonly oscillator: OscillatorNode; readonly nodes: readonly AudioNode[]; readonly end: number }

function createGraph(context: BaseAudioContext, separateChannels: boolean) {
  const master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
  const analyser = context.createAnalyser(); analyser.fftSize = 1024; master.connect(analyser);
  const bassBus = context.createGain(); bassBus.gain.value = 0.65;
  const clickBus = context.createGain(); clickBus.gain.value = 0.45;
  const merger = separateChannels ? context.createChannelMerger(2) : null;
  if (merger) { bassBus.connect(merger, 0, 0); clickBus.connect(merger, 0, 1); merger.connect(master); }
  else { bassBus.connect(master); clickBus.connect(master); }
  const samples = new Float32Array(analyser.fftSize);
  let voices: Voice[] = [];

  /** Нота с огибающей ADSR: атака линейно, спад к sustain экспоненциально, короткое линейное затухание. */
  function voice(destination: AudioNode, waveform: OscillatorType, frequency: number, level: number, envelope: Envelope, time: number, duration: number, lowpassHz?: number) {
    const oscillator = context.createOscillator();
    oscillator.type = waveform;
    oscillator.frequency.value = frequency;
    const amplitude = context.createGain();
    const peak = level, held = level * envelope.sustain, releaseAt = time + duration, end = releaseAt + envelope.release;
    amplitude.gain.value = 0;
    amplitude.gain.setValueAtTime(0, time);
    amplitude.gain.linearRampToValueAtTime(peak, time + envelope.attack);
    amplitude.gain.setTargetAtTime(held, time + envelope.attack, approachConstant(envelope.decay));
    amplitude.gain.setValueAtTime(held, releaseAt);
    amplitude.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(amplitude);
    const nodes: AudioNode[] = [oscillator, amplitude];
    if (lowpassHz === undefined) amplitude.connect(destination);
    else {
      // Голос баса — пила через lowpass (общий тембр с cue).
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = lowpassHz; filter.Q.value = BASS_TIMBRE.filterQ;
      amplitude.connect(filter); filter.connect(destination); nodes.push(filter);
    }
    oscillator.start(time); oscillator.stop(end);
    prune();
    voices.push({ oscillator, nodes, end });
  }
  /** Отзвучавшие голоса отключаются, чтобы долгий проход не копил узлы. */
  function prune() {
    const now = context.currentTime;
    voices = voices.filter(voice => {
      if (voice.end > now) return true;
      release(voice);
      return false;
    });
  }
  function release(voice: Voice, at?: number) {
    if (at !== undefined) { try { voice.oscillator.stop(at); } catch { /* already stopped */ } }
    voice.nodes.forEach(node => node.disconnect());
  }
  return {
    activate() {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(1, context.currentTime);
    },
    bass(frequency: number, duration: number, time: number) {
      voice(bassBus, BASS_VOICE.waveform, frequency, BASS_VOICE.level, BASS_VOICE.envelope, time, duration, bassLowpassHz(frequency));
    },
    click(accent: boolean, time: number) {
      voice(clickBus, CLICK_VOICE.waveform, accent ? 2093.004522 : 1046.502261, CLICK_VOICE.level * (accent ? 1 : 0.7), CLICK_VOICE.envelope, time, 0.018);
    },
    gateAt(time: number) { master.gain.setValueAtTime(0, time); },
    silence() {
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(0, now);
      voices.forEach(voice => release(voice, now)); voices = [];
    },
    setVolumes(volumes: PlayerVolumes) {
      const now = context.currentTime;
      bassBus.gain.cancelScheduledValues(now); clickBus.gain.cancelScheduledValues(now);
      bassBus.gain.setValueAtTime(volumes.bass, now); clickBus.gain.setValueAtTime(volumes.click, now);
    },
    level() {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0; let squares = 0;
      for (const value of samples) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
      return { peak, rms: Math.sqrt(squares / samples.length) };
    },
    /** Голоса, которые ещё звучат или уже отправлены в Web Audio на будущее. */
    voices() { prune(); return voices.length; },
    dispose() {
      voices.forEach(voice => release(voice, context.currentTime)); voices = [];
      bassBus.disconnect(); clickBus.disconnect(); merger?.disconnect(); master.disconnect(); analyser.disconnect();
    },
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

function validateOfflineDuration(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30) throw new RangeError('Offline-проверка должна длиться больше 0 и не более 30 секунд.');
}

/** Один проигрыватель последовательностей на общем AudioContext. Скрытие вкладки обрабатывает контроллер: pause('hidden'). */
export function createPlayer() { return createInternalPlayer(audioContext(), false, null); }

/**
 * Живой проигрыватель досылает шестнадцатые по общему планировщику. Offline-вариант (offlineUntil)
 * сразу ставит все события до конца буфера на часы OfflineAudioContext.
 */
function createInternalPlayer(context: BaseAudioContext, separateChannels: boolean, offlineUntil: number | null) {
  const offline = offlineUntil !== null;
  const graph = createGraph(context, separateChannels);
  const ticker = createTicker(() => pump());
  let state: PlayerState = 'stopped';
  let plan: PlaybackPlan | null = null;
  let repeatId: number | null = null;
  let repeats = 0;
  let runId = 0; let epoch = 0; let operation = 0;
  let tempo: TempoPoint[] = [];
  let idleBpm = 80;
  let nextGrid = 0; let nextAt = 0;
  let pausedGrid = 0;
  let pauseReason: string | null = null;
  let finishAt: number | null = null;
  let interruptionAt: number | null = null;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false; let offlineRendering = false;
  let manualBpm = 80;
  let pendingTempo: { bpm: number; requestedAt: number } | null = null;
  let volumes: PlayerVolumes = { bass: 0.65, click: 0.45 };
  let frames: Frame[] = [];
  const trace: AudioTraceEvent[] = [];

  function ensureUsable() {
    if (disposed) throw new Error('Проигрыватель уже освобождён.');
    if (offlineRendering) throw new Error('Дождитесь завершения offline-проверки.');
  }
  function now() { return context.currentTime; }
  const ladder = () => typeof plan?.repeat === 'object';
  function tempoAt(time: number): TempoPoint | null {
    for (let index = tempo.length - 1; index >= 0; index--) if (tempo[index].time <= time + EPSILON) return tempo[index];
    return tempo[0] ?? null;
  }
  function bpmAt(time: number) { return tempoAt(time)?.bpm ?? idleBpm; }
  /** Дробная позиция сетки по аудиочасам; до запуска — позиция, с которой сетка начнётся. */
  function gridAt(time: number) {
    const point = tempoAt(time);
    return point ? point.grid + Math.max(0, time - point.time) / gridSeconds(point.bpm) : 0;
  }
  function record(type: AudioTraceEvent['type'], time = now(), frame?: Partial<GridEvent>, extra: Partial<AudioTraceEvent> = {}) {
    trace.push({ runId, epoch, type, time, absoluteGrid: frame?.grid ?? Math.floor(gridAt(time) + EPSILON),
      noteIndex: frame?.noteIndex ?? null, positionId: frame?.note?.id ?? null, passIndex: frame?.passIndex ?? 0,
      bpm: bpmAt(time), ...extra });
    if (trace.length > MAX_TRACE) trace.splice(0, trace.length - MAX_TRACE);
  }
  function cancelFutureTrace(time: number) {
    for (let index = 0; index < trace.length; index++) {
      const event = trace[index];
      if (event.runId === runId && event.epoch === epoch && event.time > time + EPSILON) trace[index] = { ...event, cancelled: true };
    }
  }
  function clearFinishTimer() { if (finishTimer !== null) clearTimeout(finishTimer); finishTimer = null; }
  /** Сетка больше не досылается; уже отправленные голоса решает вызывающий. */
  function haltGrid() { ticker.stop(); repeatId = null; }
  function settleFinished() {
    if (state !== 'finishing' || finishAt === null || now() + EPSILON < finishAt) return;
    haltGrid(); clearFinishTimer();
    graph.silence();
    state = 'finished';
  }
  function queueFinishCheck() {
    if (offline || finishAt === null || state !== 'finishing') return;
    clearFinishTimer();
    finishTimer = setTimeout(() => {
      finishTimer = null;
      settleFinished();
      if (state === 'finishing') queueFinishCheck();
    }, Math.max(5, (finishAt - now()) * 1000 + 3));
  }
  function remember(frame: Frame) {
    frames.push(frame);
    if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
  }
  function setTempo(time: number, grid: number, bpm: number) {
    tempo = tempo.filter(point => point.time < time - EPSILON);
    tempo.push({ time, grid, bpm });
  }
  function scheduleGrid(grid: number, time: number) {
    const current = plan!;
    const event = eventAtGrid(current, grid);
    remember({ ...event, time, epoch });
    if (event.finish) {
      finishAt = time;
      graph.gateAt(time);
      haltGrid();
      state = 'finishing';
      record('finish', time, event);
      queueFinishCheck();
      return;
    }
    if (current.passBpms && ladder() && Math.abs(bpmAt(time) - event.bpm) > EPSILON) {
      setTempo(time, grid, event.bpm);
      record('tempo', time, event, { bpm: event.bpm });
    } else if (pendingTempo && grid % 4 === 0) {
      const change = pendingTempo; pendingTempo = null;
      setTempo(time, grid, change.bpm);
      record('tempo', time, event, { bpm: change.bpm, requestedAt: change.requestedAt });
    }
    const bpm = bpmAt(time);
    if (event.loopBoundary) record('loop', time, event, { bpm });
    if (event.note) {
      const duration = (current.noteGrids / 4) * (60 / bpm) * 0.72;
      graph.bass(event.note.frequency, duration, time);
      record('note', time, event, { bpm, audible: volumes.bass > 0 });
    }
    if (event.click) {
      if (event.click.audible) graph.click(event.click.accent, time);
      record(event.click.countIn ? 'count-in' : 'click', time, event, { bpm, audible: event.click.audible && volumes.click > 0 });
    }
    nextGrid = grid + 1;
    nextAt = time + gridSeconds(bpm);
  }
  function pump() {
    if (state !== 'running' || !plan) return;
    if (!offline) {
      const check = checkSchedule(context, nextAt);
      if (check === 'interrupted') { pause('interrupted'); return; }
      if (check === 'late') { pause('timing', nextAt); return; }
    }
    const horizon = offline ? offlineUntil : scheduleHorizon(context);
    while (state === 'running' && (offline ? nextAt < horizon - EPSILON : nextAt <= horizon)) scheduleGrid(nextGrid, nextAt);
  }
  /** Сетка начинается в time с позиции grid; первое событие — firstGrid. */
  function runGrid(time: number, grid: number, firstGrid: number, bpm: number) {
    tempo = [{ time, grid, bpm }];
    nextGrid = firstGrid; nextAt = time + (firstGrid - grid) * gridSeconds(bpm);
    repeatId = ++repeats;
    graph.setVolumes(volumes); graph.activate();
    state = 'running';
  }
  function stopInternal() {
    interruptionAt = now();
    cancelFutureTrace(interruptionAt);
    operation++; epoch++;
    idleBpm = bpmAt(interruptionAt);
    haltGrid(); clearFinishTimer();
    tempo = [];
    graph.silence();
    pendingTempo = null; finishAt = null; pauseReason = null; pausedGrid = 0;
    frames = []; state = 'stopped';
    record('stop');
  }
  async function start(config: PlaybackConfig) {
    ensureUsable();
    const nextPlan = createPlaybackPlan(config);
    stopInternal();
    plan = nextPlan; manualBpm = nextPlan.bpm;
    const request = ++operation;
    state = 'starting';
    if (!offline) await resumeAudio(context as AudioContext);
    if (disposed || request !== operation || state !== 'starting') return getSnapshot();
    const startTime = offline ? 0 : now() + START_LEAD;
    runId++; epoch++;
    interruptionAt = null; frames = []; finishAt = null; pausedGrid = 0; pauseReason = null;
    runGrid(startTime, 0, 0, ladder() ? nextPlan.bpm : manualBpm);
    record('start', startTime);
    pump();
    if (!offline && repeatId !== null) ticker.start();
    return getSnapshot();
  }
  function pause(reason = 'manual', limit?: number) {
    ensureUsable(); settleFinished();
    if (!['running', 'finishing', 'starting'].includes(state)) return getSnapshot();
    // Пауза 'timing' встаёт на первом неотправленном событии, а не на текущем времени.
    const time = limit === undefined ? now() : Math.min(now(), limit);
    interruptionAt = time;
    pausedGrid = gridAt(time);
    idleBpm = bpmAt(time);
    cancelFutureTrace(time);
    operation++; epoch++;
    haltGrid(); clearFinishTimer();
    tempo = [];
    graph.silence(); finishAt = null;
    frames = frames.filter(frame => frame.time <= time + EPSILON);
    state = 'paused'; pauseReason = reason;
    record('pause', time, undefined, { reason });
    return getSnapshot();
  }
  async function resume() {
    ensureUsable();
    if (state !== 'paused' || !plan) return getSnapshot();
    const request = ++operation;
    if (!offline) await resumeAudio(context as AudioContext);
    if (disposed || request !== operation || state !== 'paused' || !plan) return getSnapshot();
    epoch++;
    const heardGrid = frames.at(-1)?.grid ?? -1;
    const firstGrid = Math.max(Math.ceil(pausedGrid - 0.0000001), heardGrid + 1);
    const time = offline ? now() : now() + START_LEAD;
    pendingTempo = null;
    pauseReason = null; interruptionAt = null;
    // Продолжение без отсчёта: сетка идёт с сохранённой дробной позиции.
    runGrid(time, pausedGrid, firstGrid, ladder() ? (frames.at(-1)?.bpm ?? plan.bpm) : manualBpm);
    record('resume', time);
    pump();
    if (!offline && repeatId !== null) ticker.start();
    return getSnapshot();
  }
  function stop() { ensureUsable(); stopInternal(); return getSnapshot(); }
  function setBpm(bpm: number) {
    ensureUsable(); validateBpm(bpm); settleFinished();
    if (plan && ladder() && ['starting', 'running', 'finishing', 'paused'].includes(state)) {
      throw new Error('Во время лестницы темп задаёт её план. Остановите проигрывание, чтобы изменить параметры.');
    }
    manualBpm = bpm;
    if (state === 'running') pendingTempo = { bpm, requestedAt: now() };
    else {
      pendingTempo = null;
      if (tempo.length) setTempo(now(), gridAt(now()), bpm); else idleBpm = bpm;
    }
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
      bpm: bpmAt(time), positionId: noteIndex !== null ? plan?.notes[noteIndex]?.id ?? null : null,
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
      transportBeat: (state === 'paused' ? pausedGrid : state === 'finished' && plan?.finishGrid !== null ? (plan?.finishGrid ?? 0) : gridAt(playback.audioTime)) / 4,
      contextState: context.state,
    };
  }
  /** Общий AudioContext не закрывается: освобождается только собственный граф. */
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
    validateOfflineDuration(duration);
    if (expectedDuration !== null && duration < expectedDuration + 0.05) throw new RangeError('Буфер offline-проверки должен включать конец упражнения и не менее 50 мс тишины.');
    offlineRendering = true;
    try {
      const { buffer, finishAt: offlineFinishAt, trace: offlineTrace } = await renderSequenceOffline(config, { durationSeconds: duration, volumes });
      return {
        scope: 'OfflineAudioContext PCM; no physical speakers, device or output latency measurement',
        duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels,
        finishAt: offlineFinishAt, totalPasses: offlinePlan.totalPasses,
        passBpms: offlinePlan.passBpms ? [...offlinePlan.passBpms] : null,
        bass: analysePcm(buffer.getChannelData(0), buffer.sampleRate),
        click: analysePcm(buffer.getChannelData(1), buffer.sampleRate),
        trace: offlineTrace,
      };
    } finally { offlineRendering = false; }
  }
  return { start, pause, resume, stop, setBpm, setVolumes, getSnapshot, playbackState, dispose, renderOffline };
}

/**
 * Настоящий PCM продуктового проигрывателя: канал 0 — бас, канал 1 — клик. Тот же план, голоса
 * и сетка, что у живого проигрывания, но все события сразу ставятся на часы OfflineAudioContext.
 */
export async function renderSequenceOffline(config: PlaybackConfig, options: { durationSeconds: number; volumes?: Partial<PlayerVolumes> }) {
  const duration = options.durationSeconds;
  validateOfflineDuration(duration);
  const context = new OfflineAudioContext(2, Math.ceil(duration * OFFLINE_SAMPLE_RATE), OFFLINE_SAMPLE_RATE);
  const player = createInternalPlayer(context, true, duration);
  try {
    if (options.volumes) player.setVolumes(options.volumes);
    await player.start(config);
    const { finishAt, trace } = player.getSnapshot();
    const buffer = await context.startRendering();
    return { buffer, finishAt, trace };
  } finally { player.dispose(); }
}
