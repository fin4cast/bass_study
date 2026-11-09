import type { RhythmHit, RhythmKit, RhythmSound, RhythmSource } from '../rhythm/model';

export type RhythmVoicePart = {
  readonly offset: number; readonly duration: number; readonly level: number; readonly frequency: number;
} & ({ readonly kind: 'tone'; readonly waveform: OscillatorType; readonly endFrequency?: number }
  | { readonly kind: 'noise'; readonly filter: BiquadFilterType; readonly q: number });

const tone = (frequency: number, duration: number, level: number, waveform: OscillatorType = 'sine', endFrequency?: number): RhythmVoicePart =>
  ({ kind: 'tone', offset: 0, frequency, duration, level, waveform, endFrequency });
const noise = (frequency: number, duration: number, level: number, filter: BiquadFilterType = 'highpass', q = .7, offset = 0): RhythmVoicePart =>
  ({ kind: 'noise', offset, frequency, duration, level, filter, q });

function drums(sound: RhythmSound): RhythmVoicePart[] {
  switch (sound) {
    case 'kick': return [tone(145, .19, .6, 'sine', 42), tone(1600, .012, .04)];
    case 'snare': return [noise(1800, .16, .25, 'bandpass', .75), tone(185, .085, .17, 'triangle', 120)];
    case 'closedHat': return [noise(7200, .045, .16)];
    case 'openHat': return [noise(6500, .32, .14)];
    case 'clap': return [[0, .5], [.012, .4], [.025, .85]].map(([offset, weight]) => noise(1400, .085, .15 * weight, 'bandpass', .9, offset));
    case 'shaker': return [noise(5200, .055, .14, 'bandpass')];
    case 'rim': return [tone(1750, .026, .2, 'triangle'), tone(930, .018, .12)];
    case 'ride': return [tone(720, .48, .06), tone(1720, .48, .05), tone(2960, .48, .035), noise(7500, .18, .055)];
  }
}
export function describeRhythmHit(sound: RhythmHit['sound'], kit: RhythmKit): RhythmVoicePart[] {
  if (sound !== 'accent' && sound !== 'normal' && sound !== 'subdivision') return drums(sound);
  const frequency = sound === 'accent' ? 1700 : sound === 'subdivision' ? 850 : 1200;
  switch (kit) {
    case 'classic': return [tone(frequency, .035, .24)];
    case 'electronic': return [tone(frequency * .75, .055, .16, 'triangle'), tone(frequency * 1.5, .022, .05)];
    case 'wood': return [tone(frequency * .8, .04, .23, 'triangle', frequency * .55), tone(frequency * 1.9, .024, .06)];
    case 'bell': return [tone(frequency, .23, .13), tone(frequency * 2.756, .14, .05)];
    case 'clave': return [tone(frequency * 1.3, .026, .27), noise(frequency * 1.6, .012, .06, 'bandpass', 7)];
    case 'drum': return drums(sound === 'accent' ? 'kick' : sound === 'subdivision' ? 'closedHat' : 'rim').map(part => ({ ...part, level: part.level * .8 }));
  }
}

export function createRhythmNoise(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 0x6d2b79f5;
  for (let index = 0; index < samples.length; index++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    samples[index] = (seed >>> 0) / 2147483648 - 1;
  }
  return buffer;
}

export interface RhythmTail {
  readonly part: RhythmVoicePart; readonly sourceId: RhythmSource; readonly sound: RhythmHit['sound'];
  readonly velocity: number; readonly age: number;
}
export interface RhythmVoice extends Omit<RhythmTail, 'age'> {
  readonly originAt: number; readonly virtualPartStart: number; readonly start: number;
  end: number;
  cutoff(time: number): void;
  cancel(time: number): void;
}

const ENVELOPE_FLOOR = 1e-5;
function envelopeAt(age: number, attack: number, duration: number): number {
  if (age < attack) return age / attack;
  return Math.pow(ENVELOPE_FLOOR, (age - attack) / (duration - attack));
}

/** age < 0 обозначает остаток задержки до следующей части уже начавшегося удара. */
export function scheduleRhythmVoice(context: BaseAudioContext, destination: AudioNode, noiseBuffer: AudioBuffer,
  voice: RhythmTail, anchor: number): RhythmVoice | null {
  const { part, velocity } = voice;
  const age = Math.max(0, voice.age);
  const start = anchor + Math.max(0, -voice.age);
  const remaining = part.duration - age;
  const peak = part.level * velocity;
  if (remaining <= 0 || peak <= 0) return null;
  const envelope = context.createGain();
  const attack = Math.min(.0015, part.duration / 8);
  const fade = age > 0 ? Math.min(.003, remaining / 4) : 0;
  const end = start + remaining;
  envelope.gain.setValueAtTime(0, start);
  if (fade) envelope.gain.linearRampToValueAtTime(peak * envelopeAt(age + fade, attack, part.duration), start + fade);
  if (age + fade < attack) envelope.gain.linearRampToValueAtTime(peak, start + attack - age);
  envelope.gain.exponentialRampToValueAtTime(peak * ENVELOPE_FLOOR, end);

  let source: AudioScheduledSourceNode;
  let filter: BiquadFilterNode | null = null;
  const frequency = (value: number) => Math.min(context.sampleRate * .45, value);
  if (part.kind === 'tone') {
    const oscillator = context.createOscillator();
    oscillator.type = part.waveform;
    const glide = part.duration * .8;
    const initial = part.endFrequency === undefined ? part.frequency
      : part.frequency * Math.pow(part.endFrequency / part.frequency, Math.min(1, age / glide));
    oscillator.frequency.setValueAtTime(frequency(initial), start);
    if (part.endFrequency !== undefined && age < glide) oscillator.frequency.exponentialRampToValueAtTime(frequency(part.endFrequency), start + glide - age);
    oscillator.connect(envelope);
    oscillator.start(start);
    source = oscillator;
  } else {
    const buffer = context.createBufferSource();
    buffer.buffer = noiseBuffer;
    filter = context.createBiquadFilter();
    filter.type = part.filter;
    filter.frequency.value = frequency(part.frequency);
    filter.Q.value = part.q;
    buffer.connect(filter);
    filter.connect(envelope);
    buffer.start(start, age);
    source = buffer;
  }
  envelope.connect(destination);
  const disconnect = () => { source.disconnect(); filter?.disconnect(); envelope.disconnect(); };
  source.onended = disconnect;
  source.stop(end);
  return {
    part, sourceId: voice.sourceId, sound: voice.sound, velocity, originAt: start - age - part.offset,
    virtualPartStart: start - age, start, end,
    cutoff(time) {
      if (time >= this.end) return;
      this.end = time;
      source.stop(time);
    },
    cancel(time) {
      this.end = Math.min(time, this.end);
      try { source.stop(time); } catch { /* Окончившийся источник уже молчит. */ }
      disconnect();
    },
  };
}
