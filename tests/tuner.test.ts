import { describe, expect, it } from 'vitest';
import { createTunerState, nearestString, TUNER, tunerHint, tunerStep, type TunerState } from '../src/input/tuner';
import type { PitchEstimate } from '../src/input/pitch';

/** Озвученная оценка кадра с частотой `hz` (остальные поля для тюнера не важны). */
const voiced = (hz: number): PitchEstimate => ({
  voiced: true, hz, nearestMidi: Math.round(69 + 12 * Math.log2(hz / 440)), cents: 0, reason: null,
  confidence: 0.99, rms: 0.1, acRms: 0.1, windowMs: 170, downsampleFactor: 4,
} as PitchEstimate);
const silence = { voiced: false, hz: null, nearestMidi: null, cents: null, reason: 'silence', confidence: 0, rms: 0, acRms: 0, windowMs: 170, downsampleFactor: 4 } as PitchEstimate;
const hzOf = (midi: number, cents = 0) => 440 * 2 ** ((midi + cents / 100 - 69) / 12);
const run = (frames: readonly (PitchEstimate | null)[], start = 0, step = 100, from: TunerState = createTunerState()) =>
  frames.reduce((state, frame, index) => tunerStep(state, frame, start + index * step), from);

describe('тюнер (R-020, D-052): модель без DOM', () => {
  it('ближайшая открытая струна и центы: E1, A1, D2, G2 — MIDI 28, 33, 38, 43', () => {
    expect(nearestString(28).string).toBe('E');
    expect(nearestString(33.2)).toMatchObject({ string: 'A', name: 'A1' });
    expect(nearestString(33.2).cents).toBeCloseTo(20, 6);
    expect(nearestString(37.6)).toMatchObject({ string: 'D' });
    expect(nearestString(37.6).cents).toBeCloseTo(-40, 6);
    expect(nearestString(43).string).toBe('G');
  });

  it('E1 на 10 центов выше — «выше, отпусти»; на 12 ниже — «ниже, подтяни»', () => {
    const sharp = run(Array(5).fill(voiced(hzOf(28, 10)))).reading!;
    expect(sharp).toMatchObject({ string: 'E', target: 'E1', verdict: 'high' });
    expect(sharp.cents).toBeCloseTo(10, 3);
    expect(tunerHint(sharp)).toBe('E1 выше — отпусти.');
    const flat = run(Array(5).fill(voiced(hzOf(33, -12)))).reading!;
    expect(flat).toMatchObject({ string: 'A', verdict: 'low' });
    expect(tunerHint(flat)).toBe('A1 ниже — подтяни.');
  });

  it('«в строю» — не больше 5 центов дольше 0,5 с; выход — больше 8 центов; струна отмечается', () => {
    const close = Array(5).fill(voiced(hzOf(33, 3)));
    expect(run(close, 0, 100).reading!.verdict).toBe('close');
    expect(tunerHint(run(close, 0, 100).reading)).toBe('A1 почти в строю — держи ноту.');
    const held = run(Array(7).fill(voiced(hzOf(33, 3))), 0, 100);
    expect(held.reading!.verdict).toBe('in-tune');
    expect(held.tuned).toEqual(['A']);
    expect(tunerHint(held.reading)).toBe('A1 в строю.');
    // 7 центов — между порогами: остаётся «в строю»; 9 центов — выход.
    const drift = run(Array(5).fill(voiced(hzOf(33, 7))), 700, 100, held);
    expect(drift.reading!.verdict).toBe('in-tune');
    const away = run(Array(5).fill(voiced(hzOf(33, 9))), 1300, 100, drift);
    expect(away.reading!.verdict).toBe('high');
    expect(away.tuned).toEqual(['A']);
  });

  it('медиана гасит одиночный выброс атаки', () => {
    const frames = [voiced(hzOf(38)), voiced(hzOf(38)), voiced(hzOf(38, 80)), voiced(hzOf(38)), voiced(hzOf(38))];
    expect(Math.abs(run(frames).reading!.cents)).toBeLessThan(1);
  });

  it('тишина и шум: несколько кадров показание держат, после пяти — «нет сигнала»', () => {
    const playing = run(Array(5).fill(voiced(hzOf(43, 2))));
    const short = run(Array(TUNER.silentFrames - 1).fill(silence), 600, 100, playing);
    expect(short.reading?.string).toBe('G');
    const long = run(Array(TUNER.silentFrames).fill(silence), 600, 100, playing);
    expect(long.reading).toBeNull();
    expect(tunerHint(long.reading)).toMatch(/^Нет сигнала/);
    expect(run([null, null, null, null, null]).reading).toBeNull();
  });

  it('прижатая нота далеко от открытой струны — «сыграй открытую струну», а не совет крутить колок', () => {
    const fretted = run(Array(5).fill(voiced(hzOf(36)))).reading!;
    expect(fretted.verdict).toBe('far');
    expect(tunerHint(fretted)).toMatch(/сыграй открытую струну/);
  });

  it('смена струны сбрасывает время близости', () => {
    const a = run(Array(4).fill(voiced(hzOf(33))), 0, 100);
    const d = run(Array(5).fill(voiced(hzOf(38))), 400, 100, a);
    expect(d.reading).toMatchObject({ string: 'D', verdict: 'close' });
  });
});
