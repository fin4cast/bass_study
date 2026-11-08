import { SOUND_LABELS } from './patterns.mjs';

const KITS = new Set(['wood', 'classic', 'electronic', 'bell', 'clave', 'drum']);
const DIVISIONS = new Set([1, 2, 3, 4]);
const number = (value, min, max, label, integer = false) => {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new RangeError(`Некорректное значение: ${label}.`);
  return value;
};

/** Чистая проверка конфигурации. Ошибка не меняет уже принятый материал. */
export function normalizeReferenceConfig(input = {}) {
  const c = { mode: 'metronome', bpm: 92, beats: 4, denominator: 4, division: 1, swing: 50, kit: 'wood',
    accents: [2, 1, 1, 1], master: 0.65, clickVolume: 0.8, subdivisionVolume: 0.35, bars: 1, lanes: [], rhythmClick: false, ...input };
  if (!['metronome', 'rhythm'].includes(c.mode) || !KITS.has(c.kit) || !DIVISIONS.has(c.division)) throw new RangeError('Неизвестный режим, тембр или деление.');
  number(c.bpm, 10, 300, 'темп'); number(c.beats, 1, 16, 'доли', true);
  if (![1, 2, 4, 8, 16].includes(c.denominator)) throw new RangeError('Неизвестная длительность доли.');
  if (c.mode === 'rhythm' && (c.beats !== 4 || c.denominator !== 4)) throw new RangeError('Конструктор этой ревизии работает в размере 4/4.');
  number(c.swing, 50, 70, 'свинг'); number(c.bars, 1, 32, 'такты', true);
  for (const key of ['master', 'clickVolume', 'subdivisionVolume']) number(c[key], 0, 1, key);
  if (!Array.isArray(c.accents) || c.accents.length !== c.beats || c.accents.some(n => ![0, 1, 2].includes(n))) throw new RangeError('Нужен акцент каждой доли: 0, 1 или 2.');
  const ids = new Set();
  if (!Array.isArray(c.lanes)) throw new RangeError('Нужен список инструментов.');
  c.lanes = c.lanes.map(lane => {
    if (!lane.id || ids.has(lane.id) || !Object.hasOwn(SOUND_LABELS, lane.sound)) throw new RangeError('Неизвестный или повторяющийся инструмент.');
    ids.add(lane.id); number(lane.volume, 0, 1.5, 'громкость инструмента');
    if (!Array.isArray(lane.steps) || lane.steps.length !== c.bars * 16 || lane.steps.some(n => ![0, 1, 2].includes(n))) throw new RangeError('В каждом такте инструмента нужны 16 шагов.');
    if (lane.velocities !== undefined && (!Array.isArray(lane.velocities) || lane.velocities.length !== lane.steps.length || lane.velocities.some(v => !Number.isFinite(v) || v < 0 || v > 1))) throw new RangeError('Velocity должна быть в диапазоне 0–1 для каждого шага.');
    return { ...lane, muted: Boolean(lane.muted), solo: Boolean(lane.solo), steps: [...lane.steps],
      ...(lane.velocities ? { velocities: [...lane.velocities] } : {}) };
  });
  c.accents = [...c.accents]; c.rhythmClick = Boolean(c.rhythmClick);
  c.training = { silentEnabled: false, soundBars: 3, silentBars: 1, rampEnabled: false, stepBpm: 2, everyBars: 8, targetBpm: 120, ...c.training };
  for (const key of ['soundBars', 'silentBars', 'everyBars']) number(c.training[key], 1, 128, key, true);
  number(c.training.stepBpm, 1, 30, 'шаг темпа'); number(c.training.targetBpm, 10, 300, 'цель темпа');
  c.training.silentEnabled = Boolean(c.training.silentEnabled); c.training.rampEnabled = Boolean(c.training.rampEnabled);
  return c;
}

/** BPM — четверти; в ритм-секции 16 шагов делят такт 4/4. Свинг — восьмыми. */
export function referenceStepDuration(config, localStep, bpm = config.bpm) {
  const quarter = 60 / bpm, division = config.mode === 'rhythm' ? 4 : config.division;
  const unit = config.mode === 'rhythm' ? quarter : quarter * 4 / config.denominator;
  const ratio = config.swing / 100;
  if (division === 2) return unit * (localStep % 2 === 0 ? ratio : 1 - ratio);
  if (division === 4) return unit * (localStep % 4 < 2 ? ratio / 2 : (1 - ratio) / 2);
  return unit / division;
}

export function createReferencePlayer({ onTick, onState } = {}) {
  let config = normalizeReferenceConfig(), pending = null, context = null, destination = null, noise = null;
  let playing = false, disposed = false, generation = 0, timer = null, nextTime = 0, localStep = 0, patternBar = 0, absoluteBar = 0;
  let runtimeBpm = config.bpm, lastTick = null, boundary = -1;
  const voices = new Set(), ticks = [], buses = new Map();
  let liveMix = config, route = null;
  const state = reason => ({ playing, bpm: lastTick?.bpm ?? runtimeBpm, bar: lastTick?.bar ?? 1, beat: lastTick?.beat ?? 1,
    absoluteBar: lastTick?.absoluteBar ?? 1, silent: lastTick?.silent ?? false, ...(reason ? { reason } : {}) });
  const emitState = reason => onState?.(state(reason));
  const countSteps = c => c.mode === 'rhythm' ? 16 : c.beats * c.division;
  function busVolume(key, c = liveMix) {
    if (key === 'click') return c.clickVolume;
    if (key === 'subdivision') return c.subdivisionVolume;
    if (key === 'preview') return 1;
    const lane = c.lanes.find(l => `lane:${l.id}` === key);
    return !lane || lane.muted || (c.lanes.some(l => l.solo) && !lane.solo) ? 0 : lane.volume;
  }
  function applyMix(next) {
    liveMix = next;
    if (!context || !destination || context.state === 'closed') return;
    const now = context.currentTime;
    destination.gain.cancelScheduledValues(now); destination.gain.setTargetAtTime(next.master, now, 0.003);
    for (const [key, gain] of buses) { gain.gain.cancelScheduledValues(now); gain.gain.setTargetAtTime(busVolume(key, next), now, 0.003); }
  }
  function through(key, action) {
    let bus = buses.get(key);
    if (!bus) { bus = context.createGain(); bus.gain.value = busVolume(key); bus.connect(destination); buses.set(key, bus); }
    const previous = route; route = bus;
    try { action(); } finally { route = previous; }
  }
  function cancelVoices() {
    const now = context?.currentTime ?? 0;
    for (const voice of voices) {
      try { voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setValueAtTime(0, now); } catch {}
      try { voice.source.stop(now); } catch {}
      try { voice.source.disconnect(); voice.gain.disconnect(); voice.filter?.disconnect(); } catch {}
    }
    voices.clear();
    for (const bus of buses.values()) bus.disconnect(); buses.clear(); route = null;
  }
  function stop(reason = 'stopped') {
    generation++; playing = false;
    if (timer !== null) clearInterval(timer); timer = null;
    ticks.length = 0; cancelVoices(); emitState(reason);
  }
  async function readyContext() {
    if (disposed) throw new Error('Проигрыватель референса уже закрыт.');
    if (!context || context.state === 'closed') {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) throw new Error('В этом браузере недоступен Web Audio.');
      context = new Audio({ latencyHint: 'interactive' });
      destination = context.createGain(); destination.gain.value = liveMix.master; destination.connect(context.destination);
      noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = noise.getChannelData(0); let seed = 0x6d2b79f5;
      for (let i = 0; i < data.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; data[i] = (seed >>> 0) / 2147483648 - 1; }
    }
    const current = context;
    await current.resume();
    if (disposed || context !== current) return;
    if (current.state !== 'running') throw new Error('Браузер не разрешил звук. Нажми запуск ещё раз.');
  }
  function voice(source, at, duration, level, filter = null) {
    if (level <= 0) return;
    const gain = context.createGain(); gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + Math.min(0.0015, duration / 8));
    gain.gain.exponentialRampToValueAtTime(0.00001, at + duration);
    if (filter) { source.connect(filter); filter.connect(gain); } else source.connect(gain);
    gain.connect(route || destination);
    const entry = { source, gain, filter }; voices.add(entry);
    source.onended = () => { voices.delete(entry); source.disconnect(); gain.disconnect(); filter?.disconnect(); };
    source.start(at); source.stop(at + duration + 0.01);
  }
  function tone(at, frequency, duration, level, type = 'sine', endFrequency = null) {
    if (level <= 0) return;
    const osc = context.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(frequency, at);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, at + duration * 0.8);
    voice(osc, at, duration, level);
  }
  function hiss(at, duration, level, frequency, kind = 'highpass', q = 0.7) {
    if (level <= 0) return;
    const source = context.createBufferSource(); source.buffer = noise;
    const filter = context.createBiquadFilter(); filter.type = kind; filter.frequency.value = frequency; filter.Q.value = q;
    voice(source, at, duration, level, filter);
  }
  function drum(sound, at, amplitude) {
    if (amplitude <= 0) return;
    switch (sound) {
      case 'kick': tone(at, 145, 0.19, amplitude * 0.6, 'sine', 42); tone(at, 1600, 0.012, amplitude * 0.04); break;
      case 'snare': hiss(at, 0.16, amplitude * 0.25, 1800, 'bandpass', 0.75); tone(at, 185, 0.085, amplitude * 0.17, 'triangle', 120); break;
      case 'closedHat': hiss(at, 0.045, amplitude * 0.16, 7200); break;
      case 'openHat': hiss(at, 0.32, amplitude * 0.14, 6500); break;
      case 'clap': for (const [offset, weight] of [[0, 0.5], [0.012, 0.4], [0.025, 0.85]]) hiss(at + offset, 0.085, amplitude * 0.15 * weight, 1400, 'bandpass', 0.9); break;
      case 'shaker': hiss(at, 0.055, amplitude * 0.14, 5200, 'bandpass', 0.7); break;
      case 'rim': tone(at, 1750, 0.026, amplitude * 0.2, 'triangle'); tone(at, 930, 0.018, amplitude * 0.12); break;
      case 'ride': for (const [frequency, weight] of [[720, 0.06], [1720, 0.05], [2960, 0.035]]) tone(at, frequency, 0.48, amplitude * weight); hiss(at, 0.18, amplitude * 0.055, 7500); break;
      default: throw new RangeError('Неизвестный ударный инструмент.');
    }
  }
  function click(at, kind, kit, amplitude) {
    if (amplitude <= 0) return;
    const accent = kind === 'accent', sub = kind === 'subdivision';
    const frequency = accent ? 1700 : sub ? 850 : 1200;
    switch (kit) {
      case 'classic': tone(at, frequency, 0.035, amplitude * 0.24); break;
      case 'electronic': tone(at, frequency * 0.75, 0.055, amplitude * 0.16, 'triangle'); tone(at, frequency * 1.5, 0.022, amplitude * 0.05); break;
      case 'wood': tone(at, frequency * 0.8, 0.04, amplitude * 0.23, 'triangle', frequency * 0.55); tone(at, frequency * 1.9, 0.024, amplitude * 0.06); break;
      case 'bell': tone(at, frequency, 0.23, amplitude * 0.13); tone(at, frequency * 2.756, 0.14, amplitude * 0.05); break;
      case 'clave': tone(at, frequency * 1.3, 0.026, amplitude * 0.27); hiss(at, 0.012, amplitude * 0.06, frequency * 1.6, 'bandpass', 7); break;
      case 'drum': drum(accent ? 'kick' : sub ? 'closedHat' : 'rim', at, amplitude * 0.8); break;
      default: throw new RangeError('Неизвестный набор звуков.');
    }
  }
  function applyPending() {
    if (!pending) return;
    const before = config, next = pending; pending = null;
    localStep = Math.min(countSteps(next) - 1, Math.floor(localStep * countSteps(next) / countSteps(before)));
    patternBar %= next.bars; config = next;
    if (next.bpm !== before.bpm) runtimeBpm = next.bpm;
  }
  function scheduleStep() {
    applyPending();
    if (localStep === 0 && boundary !== absoluteBar) {
      boundary = absoluteBar;
      const training = config.training;
      if (absoluteBar > 0 && training.rampEnabled && absoluteBar % training.everyBars === 0) {
        const direction = Math.sign(training.targetBpm - runtimeBpm);
        runtimeBpm += direction * Math.min(training.stepBpm, Math.abs(training.targetBpm - runtimeBpm));
      }
    }
    const training = config.training;
    const silent = training.silentEnabled && absoluteBar % (training.soundBars + training.silentBars) >= training.soundBars;
    const beat = Math.floor(localStep / (config.mode === 'rhythm' ? 4 : config.division)) + 1;
    const subdivision = localStep % (config.mode === 'rhythm' ? 4 : config.division);
    const step = patternBar * countSteps(config) + localStep;
    ticks.push({ step, beat, bar: patternBar + 1, absoluteBar: absoluteBar + 1, bpm: runtimeBpm, time: nextTime, silent, subdivision, generation });
    if (!silent) {
      if (config.mode === 'metronome') {
        const accent = config.accents[beat - 1];
        if (!subdivision && accent) through('click', () => click(nextTime, accent === 2 ? 'accent' : 'normal', config.kit, accent === 2 ? 1 : 0.72));
        if (subdivision && accent) through('subdivision', () => click(nextTime, 'subdivision', config.kit, 1));
      } else {
        const anySolo = config.lanes.some(lane => lane.solo);
        for (const lane of config.lanes) {
          const flag = lane.steps[step];
          if (!flag || lane.muted || (anySolo && !lane.solo)) continue;
          const velocity = lane.velocities ? lane.velocities[step] : flag === 2 ? 1 : 0.7;
          through(`lane:${lane.id}`, () => drum(lane.sound, nextTime, velocity));
        }
        if (config.rhythmClick && subdivision === 0 && config.accents[beat - 1]) through('click', () => click(nextTime, config.accents[beat - 1] === 2 ? 'accent' : 'normal', config.kit, 1));
      }
    }
    nextTime += referenceStepDuration(config, localStep, runtimeBpm);
    localStep++;
    if (localStep >= countSteps(config)) { localStep = 0; patternBar = (patternBar + 1) % config.bars; absoluteBar++; }
  }
  function pump() {
    if (!playing || disposed) return;
    if (context.state !== 'running') { stop('interrupted'); return; }
    const now = context.currentTime;
    if (nextTime < now - 0.2) { stop('timing'); return; }
    while (nextTime < now + 0.1) scheduleStep();
    while (ticks.length && ticks[0].time <= context.currentTime) {
      const tick = ticks.shift();
      if (!playing || tick.generation !== generation) continue;
      const { generation: ignored, ...event } = tick; lastTick = event;
      onTick?.(event); if (playing && tick.generation === generation) emitState();
    }
  }
  return {
    configure(input) {
      if (disposed) throw new Error('Проигрыватель референса уже закрыт.');
      const next = normalizeReferenceConfig(input);
      if (playing) pending = next; else { config = next; runtimeBpm = next.bpm; pending = null; }
      applyMix(next);
      return next;
    },
    async start() {
      if (disposed) throw new Error('Проигрыватель референса уже закрыт.');
      stop(); applyPending(); const expected = generation;
      try {
        await readyContext();
        if (disposed || expected !== generation) return;
        playing = true; runtimeBpm = config.bpm; localStep = 0; patternBar = 0; absoluteBar = 0; boundary = -1; lastTick = null;
        nextTime = context.currentTime + 0.035; emitState();
        if (!playing || expected !== generation) return;
        pump(); if (playing && expected === generation) timer = setInterval(pump, 20);
      } catch (error) { if (disposed || expected !== generation) return; stop('error'); throw error; }
    },
    stop,
    async preview(sound = 'normal', kit) {
      if (!Object.hasOwn(SOUND_LABELS, sound) && !['accent', 'normal', 'beat', 'click', 'subdivision'].includes(sound)) throw new RangeError('Неизвестный звук для прослушивания.');
      stop(); applyPending(); const expected = generation;
      kit ??= config.kit;
      if (!KITS.has(kit)) throw new RangeError('Неизвестный набор звуков.');
      try {
        await readyContext(); if (disposed || expected !== generation) return;
        through('preview', () => {
          if (Object.hasOwn(SOUND_LABELS, sound)) drum(sound, context.currentTime + 0.015, 1);
          else click(context.currentTime + 0.015, sound === 'beat' || sound === 'click' ? 'normal' : sound, kit, 1);
        });
      } catch (error) { if (disposed || expected !== generation) return; stop('error'); throw error; }
    },
    async dispose() {
      if (disposed) return;
      stop('disposed'); disposed = true;
      const old = context; context = null; destination = null; noise = null;
      if (old && old.state !== 'closed') await old.close();
    },
  };
}
