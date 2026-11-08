import { describe, expect, it } from 'vitest';
import { getPosition, getPositions } from '../src/music';
import { createHarmonyPlan, DEFAULT_PROGRESSION, type HarmonyChord } from '../src/harmony';

const repeated = (root: string, quality: 'major' | 'minor' = 'major'): readonly HarmonyChord[] => Array.from({ length: 4 }, () => ({ root, quality }));

describe('фиксированное музыкальное содержание четырёх тактов', () => {
  it('C–F–G–C при 120 BPM имеет независимые контрольные MIDI и секунды', () => {
    const plan = createHarmonyPlan({ bpm: 120 });
    expect(plan).toMatchObject({ meter: '4/4', totalBeats: 16, durationSeconds: 8, name: 'C – F – G – C' });
    expect(plan.chords.map(chord => chord.bassRootMidi)).toEqual([36, 29, 31, 36]);
    expect(plan.chords.map(chord => chord.startBeat * 0.5)).toEqual([0, 2, 4, 6]);
    const bass = plan.events.filter(event => event.source === 'bass');
    expect(bass.map(event => event.midi)).toEqual([36, 40, 43, 40, 29, 33, 36, 33, 31, 35, 38, 35, 36, 40, 43, 40]);
    expect(bass.map(event => event.atSeconds)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5]);
    expect(bass.every(event => event.durationBeats === 1 && event.durationSeconds === 0.5)).toBe(true);
    expect(bass.map(event => event.degree)).toEqual(['1', '3', '5', '3', '1', '3', '5', '3', '1', '3', '5', '3', '1', '3', '5', '3']);
  });

  it('сопровождение — отдельные верхние трезвучия, не позиции басового рисунка', () => {
    const pads = createHarmonyPlan({ bpm: 120 }).events.filter(event => event.source === 'pad');
    expect(pads.map(event => event.midi)).toEqual([48, 52, 55, 53, 57, 60, 55, 59, 62, 48, 52, 55]);
    expect(pads.map(event => event.atSeconds)).toEqual([0, 0, 0, 2, 2, 2, 4, 4, 4, 6, 6, 6]);
    expect(pads.every(event => event.durationSeconds === 2 && event.position === null)).toBe(true);
  });

  it('клик идёт по всем четвертям и акцентирует первую долю каждого такта', () => {
    const clicks = createHarmonyPlan().events.filter(event => event.source === 'click');
    expect(clicks.map(event => event.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(clicks.filter(event => event.accent).map(event => event.beat)).toEqual([0, 4, 8, 12]);
    expect(clicks.every(event => event.midi === null && event.position === null && event.spelling === null)).toBe(true);
  });

  it.each([
    ['A', 'minor', [33, 36, 40, 36], ['A', 'C', 'E', 'C'], ['1', 'b3', '5', 'b3']],
    ['C#', 'major', [37, 41, 44, 41], ['C♯', 'E♯', 'G♯', 'E♯'], ['1', '3', '5', '3']],
    ['Gb', 'major', [30, 34, 37, 34], ['G♭', 'B♭', 'D♭', 'B♭'], ['1', '3', '5', '3']],
    ['Cb', 'minor', [35, 38, 42, 38], ['C♭', 'E♭♭', 'G♭', 'E♭♭'], ['1', 'b3', '5', 'b3']],
  ] as const)('%s %s сохраняет интервалы и контекстное написание', (root, quality, midis, names, degrees) => {
    const bass = createHarmonyPlan({ chords: repeated(root, quality) }).events.filter(event => event.source === 'bass' && event.chordIndex === 0);
    expect(bass.map(event => event.midi)).toEqual(midis);
    expect(bass.map(event => event.spelling)).toEqual(names);
    expect(bass.map(event => event.degree)).toEqual(degrees);
  });
});

describe('доступные позиции, границы и воспроизводимость', () => {
  it('одну высоту выбирает по E–A–D–G, затем ладу, независимо от входного порядка', () => {
    const positions = [getPosition('G', 5), getPosition('A', 10), getPosition('D', 2), getPosition('A', 3), getPosition('E', 8), getPosition('E', 12)];
    const plan = createHarmonyPlan({ chords: repeated('C'), positions });
    const ids = plan.events.filter(event => event.source === 'bass' && event.chordIndex === 0).map(event => event.position?.id);
    expect(ids).toEqual(['E:8', 'E:12', 'A:10', 'E:12']);
    expect(createHarmonyPlan({ chords: repeated('C'), positions: [...positions].reverse() })).toEqual(plan);
  });

  it('если нижний корень неполон, берёт следующий полный, не расширяя фильтр', () => {
    const positions = [getPosition('A', 3), getPosition('G', 5), getPosition('G', 9), getPosition('G', 12)]; // C2 incomplete; C3/E3/G3 complete.
    const plan = createHarmonyPlan({ chords: repeated('C'), positions });
    expect(plan.chords.map(chord => chord.bassRootMidi)).toEqual([48, 48, 48, 48]);
    expect(plan.events.filter(event => event.source === 'bass').map(event => event.midi)).toEqual([48, 52, 55, 52, 48, 52, 55, 52, 48, 52, 55, 52, 48, 52, 55, 52]);
  });

  it('не обещает басовый рисунок, когда терция/квинта отсутствуют', () => {
    expect(() => createHarmonyPlan({ positions: [getPosition('A', 3)] })).toThrow(/Такт 1/);
    expect(() => createHarmonyPlan({ positions: [] })).toThrow(/Нет доступных позиций/);
    expect(() => createHarmonyPlan({ positions: getPositions({ strings: ['E'], fretMin: 0, fretMax: 3 }) })).toThrow(/не помещается/);
  });

  it('0–24 разрешён: верхняя граница участвует в полной высотной форме', () => {
    const plan = createHarmonyPlan({ chords: repeated('E'), positions: [getPosition('G', 9), getPosition('G', 13), getPosition('G', 16), getPosition('E', 24)] });
    expect(plan.chords[0].bassRootMidi).toBe(52);
    expect(plan.events.filter(event => event.source === 'bass' && event.chordIndex === 0).map(event => event.position?.id)).toEqual(['E:24', 'G:13', 'G:16', 'G:13']);
    expect(() => createHarmonyPlan({ positions: [{ ...getPosition('E', 0), fret: 25 }] })).toThrow();
  });

  it('проверяет параметры и противоречивую высоту позиции', () => {
    expect(() => createHarmonyPlan({ bpm: 39 })).toThrow(/40 до 220/);
    expect(() => createHarmonyPlan({ bpm: 220.5 })).toThrow();
    expect(() => createHarmonyPlan({ chords: [] })).toThrow(/четыре/);
    expect(() => createHarmonyPlan({ chords: repeated('H') })).toThrow();
    expect(() => createHarmonyPlan({ chords: repeated('C', 'diminished' as 'major') })).toThrow(/трезвучием/);
    expect(() => createHarmonyPlan({ positions: [{ ...getPosition('E', 0), midi: 40 }] })).toThrow(/строю/);
  });

  it('не изменяет вход, замораживает результат и не запускает loop в чистой модели', () => {
    const chords = [{ root: 'A', quality: 'minor' as const }, ...DEFAULT_PROGRESSION.slice(1)];
    const before = JSON.stringify(chords);
    const plan = createHarmonyPlan({ chords });
    expect(JSON.stringify(chords)).toBe(before);
    expect(Object.isFrozen(chords[0])).toBe(false);
    expect(Object.isFrozen(plan.events)).toBe(true);
    expect(Object.isFrozen(plan.events[0].position)).toBe(true);
    expect(plan.events).toHaveLength(44);
    expect(new Set(plan.events.map(event => event.id)).size).toBe(44);
    expect(plan.events.every(event => event.beat + event.durationBeats <= 16)).toBe(true);
    expect(plan).not.toHaveProperty('loop');
  });
});
