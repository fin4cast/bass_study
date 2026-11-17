import { describe, expect, it } from 'vitest';
import { createPlaybackPlan, eventAtGrid, type PlaybackConfig } from '../src/audio/plan';
import { barChords, createExerciseSpec, type ExerciseSpec } from '../src/exercises';
import { annotatePositions, createStructure, getPosition } from '../src/music';
import { parseChord } from '../src/music/chords';
import { chordVoicing } from '../src/music/voicing';
import { chordTrack, DEFAULT_PLAY_SETTINGS, hasChords, listenConfig, playbackConfig } from '../src/ui/play/model';
import { buildExercise } from '../src/exercises';
import { timelineFor } from '../src/ui/play/model';

/** Высоты MIDI по именам: G3 = 55, A3 = 57, B3 = 59, C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67. */
const NOTE: Readonly<Record<string, number>> = { G3: 55, A3: 57, B3: 59, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67 };
const voices = (name: string) => chordVoicing(parseChord(name)!);

describe('голоса аккомпанемента по таблице R-028 (B6)', () => {
  it.each([
    ['C', ['G3', 'C4', 'E4']],
    ['F', ['A3', 'C4', 'F4']],
    ['G7', ['G3', 'B3', 'D4', 'F4']],
    ['Am', ['A3', 'C4', 'E4']],
    ['Dm7', ['A3', 'C4', 'D4', 'F4']],
    ['Cmaj7', ['G3', 'B3', 'C4', 'E4']],
  ] as const)('%s — %j', (name, expected) => {
    expect(voices(name)).toEqual(expected.map(note => NOTE[note]));
  });
  it('аккорд без распознанной структуры («E5») — тоника и квинта; все голоса в окне G3–F♯4', () => {
    expect(chordVoicing({ root: 'E', structureId: null })).toEqual([59, 64]);
    for (const name of ['C', 'C#m7', 'Ab', 'F#', 'Bb7', 'Bdim', 'Em7']) for (const midi of voices(name)) expect(midi >= 55 && midi <= 66).toBe(true);
  });
});

describe('аккорды по тактам материала', () => {
  it('последовательность: аккорд каждого такта по ступеням тональности', () => {
    const chords = barChords(createExerciseSpec('progression', { root: 'C', progression: 'I-IV-V' }))!;
    expect(chords.map(chord => chord && chord.name)).toEqual(['C', 'F', 'G', 'C']);
  });
  it('у материала без аккордов по тактам — null', () => {
    expect(barChords(createExerciseSpec('pentatonic-form'))).toBeNull();
  });
  it('фрагмент песни: нераспознанное имя — такт без аккорда', () => {
    // barChords читает только аккорды тактов, поэтому полное описание фрагмента (источник, партия) не нужно.
    const spec = { version: 'exercise-v1', templateId: 'song-fragment', params: { bars: [{ chord: 'Am', events: [] }, { chord: '?', events: [] }, { chord: null, events: [] }] } } as unknown as ExerciseSpec;
    const chords = barChords(spec)!;
    expect(chords[0]?.root).toBe('A');
    expect(chords[1]).toBeNull();
    expect(chords[2]).toBeNull();
  });
});

describe('дорожка аккордов экрана игры', () => {
  const spec = createExerciseSpec('progression', { root: 'C', progression: 'I-IV-V', pattern: 'roots' });
  const plan = buildExercise(spec);
  const timeline = timelineFor(plan, { rhythm: 'eighths', echo: false });
  it('выключено — нет дорожки; включено — по голосам на каждый такт', () => {
    expect(chordTrack(spec, timeline, null, 'off')).toBeNull();
    const track = chordTrack(spec, timeline, null, 'hold')!;
    expect(track.mode).toBe('hold');
    expect(track.bars.slice(0, 4)).toEqual([voices('C'), voices('F'), voices('G'), voices('C')]);
  });
  it('«эхо»: пара тактов — один аккорд; петля берёт свои такты', () => {
    const echoed = timelineFor(plan, { rhythm: 'eighths', echo: true });
    const track = chordTrack(spec, echoed, null, 'beats')!;
    expect(track.bars.slice(0, 4)).toEqual([voices('C'), voices('C'), voices('F'), voices('F')]);
    const loop = chordTrack(spec, timeline, { fromBar: 1, toBar: 3 }, 'hold')!;
    expect(loop.bars).toEqual([voices('F'), voices('G')]);
  });
  it('материал без аккордов — дорожки нет', () => {
    const other = createExerciseSpec('pentatonic-form');
    expect(chordTrack(other, timelineFor(buildExercise(other), { rhythm: 'eighths', echo: false }), null, 'hold')).toBeNull();
  });
  it('конфигурация звука несёт режим; «Сначала услышь» её не получает даже у материала с аккордами', () => {
    const config = playbackConfig(plan, timeline, { ...DEFAULT_PLAY_SETTINGS, accompaniment: 'hold' });
    expect(config.chords?.mode).toBe('hold');
    expect(listenConfig(plan, { ...DEFAULT_PLAY_SETTINGS, accompaniment: 'hold' }).chords).toBeUndefined();
    expect(playbackConfig(plan, timeline, DEFAULT_PLAY_SETTINGS).chords).toBeNull();
  });
});

describe('план: аккорды на сетке шестнадцатых', () => {
  const structure = createStructure('C', 'major');
  const notes = annotatePositions([getPosition('A', 3), getPosition('D', 2)], structure);
  const base: PlaybackConfig = { notes, bpm: 120, countInBars: 0, steps: [{ note: 0, grids: 16 }, { note: 1, grids: 16 }], repeat: 'infinite' };
  const C = [60, 64, 67], F = [57, 60, 65];

  it('«Держать»: аккорд на первой шестнадцатой такта; в «Долях» — на каждой доле', () => {
    const hold = createPlaybackPlan({ ...base, chords: { mode: 'hold', bars: [C, F] } });
    expect([0, 4, 15, 16, 20].map(grid => eventAtGrid(hold, grid).chord)).toEqual([
      { mode: 'hold', midis: C, grids: 16 }, null, null, { mode: 'hold', midis: F, grids: 16 }, null,
    ]);
    const beats = createPlaybackPlan({ ...base, chords: { mode: 'beats', bars: [C, F] } });
    expect([0, 4, 8, 12, 16, 20].map(grid => eventAtGrid(beats, grid).chord?.midis)).toEqual([C, C, C, C, F, F]);
  });
  it('продолжение с паузы посреди такта: «Держать» доигрывает аккорд такта на остаток, «Доли» и обычный ход не меняются', () => {
    const hold = createPlaybackPlan({ ...base, chords: { mode: 'hold', bars: [C, F] } });
    expect(eventAtGrid(hold, 6, true).chord).toEqual({ mode: 'hold', midis: C, grids: 10 });
    expect(eventAtGrid(hold, 22, true).chord).toEqual({ mode: 'hold', midis: F, grids: 10 });
    expect(eventAtGrid(hold, 16, true).chord).toEqual({ mode: 'hold', midis: F, grids: 16 });
    expect(eventAtGrid(hold, 6).chord).toBeNull();
    const beats = createPlaybackPlan({ ...base, chords: { mode: 'beats', bars: [C, F] } });
    expect(eventAtGrid(beats, 6, true).chord).toBeNull();
    const silent = createPlaybackPlan({ ...base, chords: { mode: 'hold', bars: [C, null] } });
    expect(eventAtGrid(silent, 22, true).chord).toBeNull();
  });
  it('в отсчёте и без дорожки аккордов нет; такт без аккорда молчит', () => {
    const counted = createPlaybackPlan({ ...base, countInBars: 1, chords: { mode: 'hold', bars: [C, null] } });
    expect([0, 4, 8, 12].map(grid => eventAtGrid(counted, grid).chord)).toEqual([null, null, null, null]);
    expect(eventAtGrid(counted, 16).chord?.midis).toEqual(C);
    // Граница такта без аккорда в «Держать» — событие без голосов: оно снимает прошлый аккорд.
    expect(eventAtGrid(counted, 32).chord).toEqual({ mode: 'hold', midis: [], grids: 16 });
    const beats = createPlaybackPlan({ ...base, countInBars: 0, chords: { mode: 'beats', bars: [C, null] } });
    expect(eventAtGrid(beats, 16).chord).toBeNull();
    expect(eventAtGrid(createPlaybackPlan(base), 0).chord).toBeNull();
  });
  it('строгая проверка: режим, непустой список тактов, голоса — целые MIDI', () => {
    expect(() => createPlaybackPlan({ ...base, chords: { mode: 'both' as never, bars: [C] } })).toThrow(RangeError);
    expect(() => createPlaybackPlan({ ...base, chords: { mode: 'hold', bars: [] } })).toThrow(RangeError);
    expect(() => createPlaybackPlan({ ...base, chords: { mode: 'hold', bars: [[60.5]] } })).toThrow(RangeError);
    expect(() => createPlaybackPlan({ ...base, chords: { mode: 'hold', bars: [[]] } })).toThrow(RangeError);
  });
});

describe('материал без названных аккордов', () => {
  it('фрагмент песни, где ни у одного такта нет распознанного аккорда, управления аккордами не получает', () => {
    const noChords = { version: 'exercise-v1', templateId: 'song-fragment', params: { bars: [{ chord: null, events: [] }, { chord: '?', events: [] }] } } as unknown as ExerciseSpec;
    expect(hasChords(noChords)).toBe(false);
    expect(chordTrack(noChords, { bars: 2, echo: false }, null, 'hold')).toBeNull();
    expect(hasChords(createExerciseSpec('progression'))).toBe(true);
  });
  it('аккорды риффа строятся от той же тональности, что его ноты: penta-a в A — Am, Dm, Em, Am', () => {
    expect(barChords(createExerciseSpec('riff', { riff: 'penta-a', root: 'A' }))!.map(chord => chord?.name)).toEqual(['Am', 'Dm', 'Em', 'Am']);
  });
});
