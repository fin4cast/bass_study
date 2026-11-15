import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec, validateExerciseSpec } from '../src/exercises';
import { buildTimeline } from '../src/exercises/rhythm';
import { degreeFrom, keyFromSignature, parseChord } from '../src/music/chords';
import { extractFragment, fragmentSpec, type BeatLike, type ScoreLike } from '../src/music-bank/extract';
import { builtinLibrary } from '../src/practice/library';
import { materialId } from '../src/practice/material';

/** Партитура alphaTab в миниатюре: четверть — 960 тиков, струны с 1 от нижней, строй от верхней. */
const Q = 960;
const note = (midi: number, string: number, fret: number, tie = false) => ({ realValue: midi, isTieDestination: tie, string, fret });
const beat = (start: number, duration: number, notes: ReturnType<typeof note>[] = [], extra: Partial<BeatLike> = {}): BeatLike =>
  ({ isRest: !notes.length, playbackStart: start, playbackDuration: duration, hasTuplet: false, graceType: 0, notes, chord: null, ...extra });
function score(bars: BeatLike[][], options: { tuning?: number[]; chords?: (string | null)[]; tempo?: number; meter?: [number, number]; tempoAt?: number } = {}): ScoreLike {
  return {
    tempo: options.tempo ?? 100,
    masterBars: bars.map((_, index) => ({ timeSignatureNumerator: options.meter?.[0] ?? 4, timeSignatureDenominator: options.meter?.[1] ?? 4,
      tempoAutomations: options.tempoAt === index ? [{ value: 140 }] : [] })),
    tracks: [
      { name: 'Бас', staves: [{ isPercussion: false, tuning: options.tuning ?? [43, 38, 33, 28], bars: bars.map(beats => ({ voices: [{ beats }], keySignature: 3, keySignatureType: 1 })) }] },
      { name: 'Гитара', staves: [{ isPercussion: false, tuning: [64, 59, 55, 50, 45, 40], bars: bars.map((_, index) => ({ voices: [{ beats: [beat(0, 4 * Q, [], { chord: options.chords?.[index] ? { name: options.chords[index]! } : null })] }] })) }] },
    ],
  };
}

describe('аккорды и ступени', () => {
  it('имя аккорда → тоника и структура; слеш-бас не меняет тонику', () => {
    expect(parseChord('Am7')).toMatchObject({ root: 'A', structureId: 'minor-seventh' });
    expect(parseChord('F#m7b5')).toMatchObject({ root: 'F♯', structureId: 'half-diminished-seventh' });
    expect(parseChord('Cmaj7')).toMatchObject({ root: 'C', structureId: 'major-seventh' });
    expect(parseChord('G7')).toMatchObject({ root: 'G', structureId: 'dominant-seventh' });
    expect(parseChord('Bb')).toMatchObject({ root: 'B♭', structureId: 'major-triad' });
    expect(parseChord('C/E')).toMatchObject({ root: 'C', structureId: 'major-triad' });
    expect(parseChord('E5')).toMatchObject({ root: 'E', structureId: null });
    expect(parseChord('Hello')).toBeNull();
    expect(degreeFrom('A', 36)).toBe('b3');
    expect(degreeFrom('G', 43)).toBe('1');
    expect(keyFromSignature(3, true)).toBe('F♯m');
    expect(keyFromSignature(-1, false)).toBe('F');
  });
});

describe('фрагмент партии из партитуры', () => {
  it('ноты, длительности, паузы до конца такта, аккорд из другой партии, темп и тональность', () => {
    const fragment = extractFragment(score([[beat(0, Q, [note(33, 2, 0)]), beat(Q, Q / 2, [note(40, 2, 7)]), beat(3 * Q / 2, Q / 2), beat(2 * Q, Q, [note(45, 3, 7)])]], { chords: ['A7'] }), 0, 1, 1);
    expect(fragment).toMatchObject({ bpm: 100, key: 'F♯m' });
    expect(fragment.bars[0].chord).toBe('A7');
    expect(fragment.bars[0].events).toEqual([['A', 0, 0, 4], ['A', 7, 4, 2], [null, null, 6, 2], ['D', 7, 8, 4], [null, null, 12, 4]]);
  });
  it('связанные ноты сливаются; из двойной ноты — нижняя; форшлаг отбрасывается', () => {
    const fragment = extractFragment(score([[beat(0, Q, [note(40, 2, 7), note(45, 3, 7)]), beat(Q, Q, [note(40, 2, 7, true)]), beat(2 * Q, 0, [note(41, 2, 8)], { graceType: 1 }), beat(2 * Q, 2 * Q, [note(28, 1, 0)])]]), 0, 1, 1);
    expect(fragment.bars[0].events).toEqual([['A', 7, 0, 8], ['E', 0, 8, 8]]);
  });
  it('другой строй — по высоте на ближайший лад; нота ниже E1 — отказ с номером такта', () => {
    const dropD = extractFragment(score([[beat(0, 4 * Q, [note(26 + 2, 1, 2)])]], { tuning: [43, 38, 33, 26] }), 0, 1, 1);
    expect(dropD.bars[0].events[0]).toEqual(['E', 0, 0, 16]);
    expect(() => extractFragment(score([[beat(0, 4 * Q, [note(26, 1, 0)])]], { tuning: [43, 38, 33, 26] }), 0, 1, 1)).toThrow(/Такт 1: нота MIDI 26/);
  });
  it('отказы: триоль, 32-е, не 4/4, смена темпа внутри, больше 16 тактов, ударные', () => {
    expect(() => extractFragment(score([[beat(0, Q, [note(33, 2, 0)], { hasTuplet: true })]]), 0, 1, 1)).toThrow(/Такт 1: триоли/);
    expect(() => extractFragment(score([[beat(0, Q / 8, [note(33, 2, 0)])]]), 0, 1, 1)).toThrow(/шестнадцатой/);
    expect(() => extractFragment(score([[beat(0, Q, [note(33, 2, 0)])]], { meter: [3, 4] }), 0, 1, 1)).toThrow(/3\/4/);
    const two = [[beat(0, 4 * Q, [note(33, 2, 0)])], [beat(0, 4 * Q, [note(33, 2, 0)])]];
    expect(() => extractFragment(score(two, { tempoAt: 1 }), 0, 1, 2)).toThrow(/Такт 2: внутри фрагмента меняется темп/);
    expect(extractFragment(score(two, { tempoAt: 0 }), 0, 1, 2).bpm).toBe(140);
    expect(() => extractFragment(score(Array.from({ length: 17 }, () => [beat(0, 4 * Q, [note(33, 2, 0)])])), 0, 1, 17)).toThrow(/не больше 16/);
  });
  it('упражнение: снимок нот, ступени от аккорда, шкала из партитуры, ключ без снимка, вне библиотеки', () => {
    const fragment = extractFragment(score([[beat(0, Q, [note(33, 2, 0)]), beat(Q, 3 * Q, [note(40, 2, 7)])], [beat(0, 4 * Q, [note(38, 3, 0)])]], { chords: ['A', 'D'] }), 0, 1, 2);
    const source = { sha256: 'a'.repeat(64), size: 1234, trackIndex: 0, trackName: 'Бас', fromBar: 5, toBar: 6 };
    const spec = fragmentSpec(fragment, source, 'Рифф');
    const plan = buildExercise(spec);
    expect(plan.title).toBe('Рифф');
    expect(plan.notes.map(item => [item.id, item.degree])).toEqual([['A:0', '1'], ['A:7', '5'], ['D:0', '1']]);
    expect(plan.segments.map(segment => segment.label)).toEqual(['A · такт 5', 'D · такт 6']);
    const timeline = buildTimeline(plan, { pattern: 'quarters' });
    expect(timeline.pattern).toBe('eighths');
    expect(timeline.steps.map(step => [step.note, step.grids])).toEqual([[0, 4], [1, 12], [2, 16]]);
    expect(materialId(spec)).toBe(`song-fragment.${'a'.repeat(16)}.0.5-6`);
    expect(builtinLibrary(null).some(item => item.spec.templateId === 'song-fragment')).toBe(false);
    expect(() => validateExerciseSpec({ ...spec, params: { ...spec.params, bars: [fragment.bars[0]] } })).toThrow(/число тактов/);
    expect(createExerciseSpec('song-fragment').templateId).toBe('song-fragment');
  });
});
