import { describe, expect, it } from 'vitest';
import { createHarmonyPlaybackPlan, getHarmonyBeat } from '../src/audio/harmony';

describe('единая сетка сопровождения и отсчёта', () => {
  it('без отсчёта при120 BPM играет16 четвертей и заканчивается после8 секунд', () => {
    const plan = createHarmonyPlaybackPlan({ bpm: 120, countIn: false });
    expect(plan.totalBeats).toBe(16);
    expect(plan.harmony.durationSeconds).toBe(8);
    expect([0, 4, 8, 12].map(beat => getHarmonyBeat(plan, beat).events.filter(event => event.source === 'pad').map(event => event.midi))).toEqual([[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55]]);
    expect(getHarmonyBeat(plan, 15).events.find(event => event.source === 'bass')?.midi).toBe(40);
    expect(getHarmonyBeat(plan, 16).finish).toBe(true);
  });

  it('один отсчёт добавляет4 четверти, но цикл не создаёт второй', () => {
    const plan = createHarmonyPlaybackPlan({ bpm: 120, repeat: 'infinite' });
    expect(plan.totalBeats).toBeNull();
    expect([0, 1, 2, 3].map(beat => getHarmonyBeat(plan, beat).phase)).toEqual(['count-in', 'count-in', 'count-in', 'count-in']);
    expect(getHarmonyBeat(plan, 3).events.map(event => event.source)).toEqual(['click']);
    expect(getHarmonyBeat(plan, 4).events.find(event => event.source === 'bass')?.midi).toBe(36);
    expect(getHarmonyBeat(plan, 20)).toMatchObject({ phase: 'practice', passIndex: 1 });
    expect(getHarmonyBeat(plan, 20).events.find(event => event.source === 'bass')?.midi).toBe(36);
  });

  it('mute хранится отдельно от громкости и не меняет музыкальную сетку', () => {
    const plan = createHarmonyPlaybackPlan({ muted: { bass: true }, volumes: { bass: .8, pad: 0 } });
    expect(plan.mix).toEqual({ volumes: { bass: .8, pad: 0, click: .5 }, muted: { bass: true, pad: false, click: false } });
    expect(getHarmonyBeat(plan, 4).events.some(event => event.source === 'bass')).toBe(true);
    expect(Object.isFrozen(plan.mix.volumes)).toBe(true);
  });

  it('не принимает несогласованные параметры, нечисловой BPM и номер доли', () => {
    for (const bpm of [39, 221, 80.5, NaN]) expect(() => createHarmonyPlaybackPlan({ bpm })).toThrow();
    expect(() => createHarmonyPlaybackPlan({ volumes: { click: 1.1 } })).toThrow();
    expect(() => createHarmonyPlaybackPlan({ muted: { pad: 'false' as unknown as boolean } })).toThrow();
    expect(() => getHarmonyBeat(createHarmonyPlaybackPlan(), 1.5)).toThrow();
  });
});
