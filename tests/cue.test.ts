import { describe, expect, it } from 'vitest';
import { getEarAudioEvents, createEarQuestion } from '../src/ear';
import { validateCue } from '../src/audio/cue';

describe('граница расписания слухового сигнала', () => {
  it('сохраняет отдельную долю тишины между опорой и целью', () => {
    const events = getEarAudioEvents(createEarQuestion({ root: 'C', quality: 'major', seed: 5 }), 120);
    const cue = validateCue({ bpm: events.bpm, totalBeats: events.totalBeats, notes: events.events.filter(event => event.midi !== null).map(event => ({ midi: event.midi!, beat: event.atBeat, durationBeats: event.durationBeats })) });
    expect(cue.totalBeats).toBe(3);
    expect(cue.notes).toHaveLength(2);
    expect(cue.notes.map(note => [note.beat, note.durationBeats])).toEqual([[0, 1], [2, 1]]);
    expect(cue.notes[0].midi).toBe(36);
  });

  it('фиксирует копию расписания до асинхронного разрешения AudioContext', () => {
    const input = { bpm: 80, totalBeats: 3, notes: [{ midi: 36, beat: 0, durationBeats: 1 }] };
    const cue = validateCue(input);
    input.notes[0].midi = 48;
    input.notes.push({ midi: 60, beat: 2, durationBeats: 1 });
    expect(cue.notes).toEqual([{ midi: 36, beat: 0, durationBeats: 1 }]);
    expect(Object.isFrozen(cue.notes[0])).toBe(true);
  });

  it('отклоняет ноту за концом фрагмента, нечисловую высоту и бесконечное прослушивание', () => {
    const configuration = { bpm: 80, totalBeats: 3, notes: [{ midi: 36, beat: 0, durationBeats: 1 }] };
    expect(() => validateCue({ ...configuration, notes: [{ midi: 36, beat: 2.5, durationBeats: 1 }] })).toThrow();
    expect(() => validateCue({ ...configuration, notes: [{ midi: NaN, beat: 0, durationBeats: 1 }] })).toThrow();
    expect(() => validateCue({ ...configuration, totalBeats: Infinity })).toThrow();
    expect(() => validateCue({ ...configuration, notes: [] })).toThrow();
  });

  it('не принимает дробный/пустой темп или BPM вне слухового диапазона', () => {
    for (const bpm of [0, 59, 121, 80.5, NaN]) expect(() => validateCue({ bpm, totalBeats: 3, notes: [{ midi: 36, beat: 0, durationBeats: 1 }] })).toThrow();
  });
});
