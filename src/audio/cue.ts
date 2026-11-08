import { midiToFrequency } from '../music';

export interface CueNote {
  readonly midi: number;
  readonly beat: number;
  readonly durationBeats: number;
}

export interface CueConfiguration {
  readonly notes: readonly CueNote[];
  readonly totalBeats: number;
  readonly bpm: number;
}

export interface CueSnapshot {
  readonly state: 'stopped' | 'starting' | 'playing' | 'finished';
  readonly runId: number;
  readonly audioTime: number;
  readonly startAt: number | null;
  readonly finishAt: number | null;
}

export interface CueOptions {
  readonly onComplete?: (runId: number) => void;
}

/** A cue has no transport of its own; each note is scheduled on the AudioContext clock. */
export function validateCue(configuration: CueConfiguration): CueConfiguration {
  if (!Number.isInteger(configuration.bpm) || configuration.bpm < 60 || configuration.bpm > 120) throw new RangeError('Темп прослушивания — целое число от 60 до 120 BPM.');
  if (!Number.isFinite(configuration.totalBeats) || configuration.totalBeats <= 0 || configuration.totalBeats > 32) throw new RangeError('Некорректная длительность прослушивания.');
  if (!Array.isArray(configuration.notes) || configuration.notes.length === 0 || configuration.notes.length > 32) throw new RangeError('Для прослушивания нужны ноты.');
  const notes = configuration.notes.map(note => {
    midiToFrequency(note.midi);
    if (!Number.isFinite(note.beat) || !Number.isFinite(note.durationBeats) || note.beat < 0 || note.durationBeats <= 0 || note.beat + note.durationBeats > configuration.totalBeats) throw new RangeError('Нота выходит за границы прослушивания.');
    return Object.freeze({ midi: note.midi, beat: note.beat, durationBeats: note.durationBeats });
  });
  return Object.freeze({ notes: Object.freeze(notes), totalBeats: configuration.totalBeats, bpm: configuration.bpm });
}

interface Voice { oscillator: OscillatorNode; envelope: GainNode }

function scheduleNote(context: BaseAudioContext, destination: AudioNode, note: CueNote, startAt: number, beatSeconds: number): Voice {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const start = startAt + note.beat * beatSeconds;
  const end = start + note.durationBeats * beatSeconds;
  const attack = Math.min(.012, (end - start) / 8);
  const release = Math.min(.045, (end - start) / 5);
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(midiToFrequency(note.midi), start);
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(.22, start + attack);
  envelope.gain.setValueAtTime(.22, end - release);
  envelope.gain.linearRampToValueAtTime(0, end);
  oscillator.connect(envelope);
  envelope.connect(destination);
  oscillator.start(start);
  oscillator.stop(end);
  return { oscillator, envelope };
}

export function createAudioCue(options: CueOptions = {}) {
  let context: AudioContext | null = null;
  let output: GainNode | null = null;
  let voices: Voice[] = [];
  let state: CueSnapshot['state'] = 'stopped';
  let runId = 0;
  let startAt: number | null = null;
  let finishAt: number | null = null;
  let frame: number | null = null;
  let disposed = false;

  function cancelVoices() {
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    if (output && context) {
      output.gain.cancelScheduledValues(context.currentTime);
      output.gain.setValueAtTime(0, context.currentTime);
    }
    for (const voice of voices) {
      try { voice.oscillator.stop(context?.currentTime ?? 0); } catch { /* A completed voice may already be stopped. */ }
      voice.oscillator.disconnect();
      voice.envelope.disconnect();
    }
    voices = [];
  }

  function completeIfDue() {
    if (state !== 'playing' || !context || finishAt === null || context.currentTime < finishAt) return;
    const completedRun = runId;
    state = 'finished';
    cancelVoices();
    options.onComplete?.(completedRun);
  }

  function snapshot(): CueSnapshot {
    completeIfDue();
    return { state, runId, audioTime: context?.currentTime ?? 0, startAt, finishAt };
  }

  function observe(expectedRun: number) {
    frame = requestAnimationFrame(() => {
      frame = null;
      if (disposed || expectedRun !== runId) return;
      completeIfDue();
      if (state === 'playing') observe(expectedRun);
    });
  }

  return {
    async play(input: CueConfiguration): Promise<CueSnapshot> {
      if (disposed) throw new Error('Прослушивание уже закрыто.');
      const configuration = validateCue(input);
      cancelVoices();
      const expectedRun = ++runId;
      state = 'starting';
      startAt = null; finishAt = null;
      try {
        context ??= new AudioContext({ latencyHint: 'interactive' });
        output ??= context.createGain();
        output.disconnect(); output.connect(context.destination);
        await context.resume();
        if (disposed || expectedRun !== runId) return snapshot();
        if (context.state !== 'running') throw new Error('Браузер не разрешил звук. Нажми «Прослушать» ещё раз.');
        const seconds = 60 / configuration.bpm;
        startAt = context.currentTime + .035;
        finishAt = startAt + configuration.totalBeats * seconds;
        output.gain.setValueAtTime(1, context.currentTime);
        for (const note of configuration.notes) voices.push(scheduleNote(context, output, note, startAt, seconds));
        state = 'playing';
        observe(expectedRun);
        return snapshot();
      } catch (failure) {
        if (expectedRun === runId) {
          cancelVoices(); state = 'stopped'; startAt = null; finishAt = null;
        }
        throw failure;
      }
    },
    stop() {
      ++runId;
      cancelVoices();
      state = 'stopped'; startAt = null; finishAt = null;
    },
    getSnapshot: snapshot,
    async dispose() {
      if (disposed) return;
      disposed = true;
      ++runId;
      cancelVoices();
      output?.disconnect(); output = null;
      const closing = context; context = null;
      state = 'stopped'; startAt = null; finishAt = null;
      if (closing && closing.state !== 'closed') await closing.close();
    },
  };
}

/** Real PCM rendering for independent timing/frequency tests; no DOM or live context needed. */
export async function renderCueOffline(input: CueConfiguration, sampleRate = 44_100): Promise<AudioBuffer> {
  const configuration = validateCue(input);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96_000) throw new RangeError('Неподдерживаемая частота PCM.');
  const seconds = 60 / configuration.bpm;
  const duration = configuration.totalBeats * seconds + .1;
  const context = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);
  configuration.notes.forEach(note => scheduleNote(context, context.destination, note, 0, seconds));
  return context.startRendering();
}
