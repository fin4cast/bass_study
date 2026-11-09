import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RHYTHM_PREFERENCES, RHYTHM_PRESETS, allowsDottedQuarter, createDefaultRhythmProject, createLanes,
  createRhythmPlan, defaultRhythmAccents, defaultRhythmMeter, rhythmFrameAt, validateRhythmPlaybackConfig,
  validateRhythmProject, type RhythmMetronome, type RhythmPlan,
} from '../src/rhythm/model';

const defaultMetro = DEFAULT_RHYTHM_PREFERENCES.metronome;
const makeProject = () => createDefaultRhythmProject('rhythm-control', 'Контрольный ритм', '2026-11-09T12:00:00.000Z');
const metronomePlan = (overrides: Partial<RhythmMetronome> = {}) => createRhythmPlan({
  preferences: { ...DEFAULT_RHYTHM_PREFERENCES, metronome: { ...defaultMetro, ...overrides } },
});
const frames = (plan: RhythmPlan, start: number, count: number) =>
  Array.from({ length: count }, (_, index) => rhythmFrameAt(plan, start + index)!);
function boundaries(plan: RhythmPlan, count: number): number[] {
  const at = [0];
  for (const frame of frames(plan, 0, count)) at.push(at.at(-1)! + frame.duration);
  return at;
}
function expectTimes(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, at] of expected.entries()) expect(actual[index]).toBeCloseTo(at, 9);
}

describe('ритмическая сетка метронома', () => {
  it('сохраняет показание 120 BPM и меняет длительность восьмой в зависимости от единицы', () => {
    const meter = defaultRhythmMeter(6, 8);
    const base = { bpm: 120, meter, accents: defaultRhythmAccents(meter) };
    const durations = [
      ['quarter', 0.25, 1.5], ['eighth', 0.5, 3], ['dotted-quarter', 1 / 6, 1],
    ] as const;
    for (const [bpmUnit, beat, bar] of durations) {
      const plan = metronomePlan({ ...base, bpmUnit });
      expect(rhythmFrameAt(plan, 0)).toMatchObject({ bpm: 120, position: { beat: 1 } });
      expect(rhythmFrameAt(plan, 0)!.duration).toBeCloseTo(beat, 9);
      expect(boundaries(plan, 6).at(-1)).toBeCloseTo(bar, 9);
    }
    const dotted = metronomePlan({ ...base, bpm: 60, bpmUnit: 'dotted-quarter' });
    const times = boundaries(dotted, 6);
    expectTimes([times[0], times[3], times[6]], [0, 1, 2]);
  });

  it('ставит акценты на границы групп и проверяет область четверти с точкой', () => {
    const five = defaultRhythmMeter(5, 8);
    const seven = defaultRhythmMeter(7, 8);
    expect(five.groups).toEqual([2, 3]);
    expect(seven.groups).toEqual([2, 2, 3]);
    expect(defaultRhythmAccents(five)).toEqual([2, 1, 2, 1, 1]);
    expect(defaultRhythmAccents(seven)).toEqual([2, 1, 2, 1, 2, 1, 1]);
    expect([6, 9, 12].map(beats => defaultRhythmMeter(beats, 8).groups)).toEqual([[3, 3], [3, 3, 3], [3, 3, 3, 3]]);
    expect(allowsDottedQuarter(five)).toBe(false);
    expect(allowsDottedQuarter(defaultRhythmMeter(6, 4))).toBe(false);
    expect(() => metronomePlan({ meter: { beats: 5, denominator: 8, groups: [2, 2] }, accents: [2, 1, 2, 1, 1] })).toThrow();
    expect(() => metronomePlan({ meter: five, accents: defaultRhythmAccents(five), bpmUnit: 'dotted-quarter' })).toThrow();
    const custom = { beats: 5, denominator: 8, groups: [3, 2] } as const;
    expect(defaultRhythmAccents(metronomePlan({ meter: custom, accents: [2, 1, 1, 2, 1] }).meter)).toEqual([2, 1, 1, 2, 1]);
    const accentTimes = (groups: readonly number[]) => {
      const meter = { ...seven, groups };
      const plan = metronomePlan({ meter, accents: defaultRhythmAccents(meter), bpmUnit: 'eighth', bpm: 120 });
      const times = boundaries(plan, 7);
      expect(times.at(-1)).toBe(3.5);
      return frames(plan, 0, 7).filter(frame => frame.hits.some(hit => hit.source === 'accent')).map(frame => times[frame.index]);
    };
    expect(accentTimes([2, 2, 3])).toEqual([0, 1, 2]);
    expect(accentTimes([3, 2, 2])).toEqual([0, 1.5, 2.5]);
  });

  it('держит независимые подразделения при пропущенной основной доле', () => {
    const plan = metronomePlan({ division: 3, accents: [0, 2, 1, 1], substeps: [true, false, false, true, false, false, true, true] });
    expect(frames(plan, 0, 12).map(frame => frame.hits.map(hit => hit.source))).toEqual([
      [], ['subdivision'], [], ['accent'], [], ['subdivision'], ['click'], [], [], ['click'], ['subdivision'], ['subdivision'],
    ]);
    expect(() => metronomePlan({ division: 3, substeps: [true] })).toThrow();
  });

  it('растягивает половины для восьмых, пары для шестнадцатых, оставляет триоли ровными', () => {
    const straight = { bpm: 120, swing: 66 } as const;
    const fourths = { ...straight, division: 4, substeps: Array<boolean>(12).fill(true) } as const;
    expectTimes(boundaries(metronomePlan({ ...fourths, swingMode: 'eighth' }), 4), [0, .165, .33, .415, .5]);
    expectTimes(boundaries(metronomePlan({ ...fourths, swingMode: 'sixteenth' }), 4), [0, .165, .25, .415, .5]);
    expectTimes(boundaries(metronomePlan({ ...straight, division: 2, substeps: [true, true, true, true] }), 2), [0, .33, .5]);
    expectTimes(boundaries(metronomePlan({ ...straight, division: 3, substeps: Array<boolean>(8).fill(true) }), 3), [0, 1 / 6, 1 / 3, .5]);
  });

  it('отсчитывает такт отдельно и повышает BPM через звучащие и немые такты до цели', () => {
    const plan = metronomePlan({ bpm: 80, countIn: true, training: {
      silentEnabled: true, soundBars: 1, silentBars: 1, rampEnabled: true, stepBpm: 5, everyBars: 2, targetBpm: 88,
    } });
    expect(frames(plan, 0, 4).map(frame => [frame.position.phase, frame.position.absoluteBar, frame.position.beat, frame.bpm]))
      .toEqual([1, 2, 3, 4].map(beat => ['count-in', 0, beat, 80]));
    expect(boundaries(plan, 4).at(-1)).toBeCloseTo(3, 9);
    expect([4, 8, 12, 16, 20, 24].map(index => {
      const frame = rhythmFrameAt(plan, index)!;
      return [frame.position.absoluteBar, frame.bpm, frame.position.silent, frame.hits.length];
    })).toEqual([[1, 80, false, 1], [2, 80, true, 0], [3, 85, false, 1], [4, 85, true, 0], [5, 88, false, 1], [6, 88, true, 0]]);
    expect(frames(plan, 8, 4).every(frame => frame.hits.length === 0)).toBe(true);
    expect(rhythmFrameAt(plan, 20, 3)?.bpm).toBe(80);
  });
});

describe('паттерны ритм-секции', () => {
  const preferences = { ...DEFAULT_RHYTHM_PREFERENCES, view: 'rhythm' } as const;

  it('сохраняет повторённые клипы как отдельные вхождения и завершается после всей цепочки', () => {
    const seed = makeProject();
    const first = seed.patterns[0];
    const extended = { ...first, bars: 3, lanes: first.lanes.map(lane => ({
      ...lane, steps: [...lane.steps, ...lane.steps, ...Array<0>(16).fill(0)], velocities: [...lane.velocities, ...lane.velocities, ...Array<number>(16).fill(0)],
    })) } as const;
    const plan = createRhythmPlan({ preferences, project: {
      ...seed, bpm: 120, patterns: [extended, ...seed.patterns.slice(1)], countIn: true, repeat: 'once', scope: 'chain',
      chain: [{ id: 'intro', patternId: 'A' }, { id: 'fill', patternId: 'C' }, { id: 'return', patternId: 'A' }],
    } });
    expect(plan.totalSteps).toBe(116);
    expect([4, 20, 36, 52, 68, 84, 100].map(index => {
      const { clipId, patternId, patternBar, step, bar } = rhythmFrameAt(plan, index)!.position;
      return [clipId, patternId, patternBar, step, bar];
    })).toEqual([
      ['intro', 'A', 1, 0, 1], ['intro', 'A', 2, 0, 2], ['intro', 'A', 3, 0, 3], ['fill', 'C', 1, 0, 4],
      ['return', 'A', 1, 0, 5], ['return', 'A', 2, 0, 6], ['return', 'A', 3, 0, 7],
    ]);
    expect(frames(plan, 36, 16).every(frame => frame.hits.length === 0)).toBe(true);
    expect(rhythmFrameAt(plan, 115)?.position).toMatchObject({ clipId: 'return', patternBar: 3, step: 15 });
    expect(rhythmFrameAt(plan, 116)).toBeNull();
    expect(boundaries(plan, 116).at(-1)).toBeCloseTo(16, 9);
  });

  it('берёт выбранный паттерн, ставит velocity без повторного масштабирования и оставляет выключенный шаг тихим', () => {
    const seed = makeProject();
    const pattern = seed.patterns[1];
    const lane = pattern.lanes[0];
    const edited = { ...lane, steps: [2, 0, 1, ...lane.steps.slice(3)] as const, velocities: [.25, 1, 0, ...lane.velocities.slice(3)] };
    const project = { ...seed, overlay: true, activePatternId: 'B' as const, patterns: [seed.patterns[0], { ...pattern, lanes: [edited, ...pattern.lanes.slice(1)] }] };
    const plan = createRhythmPlan({ preferences, project: { ...project, chain: [{ id: 'other', patternId: 'A' }] } });
    const hit = (index: number) => rhythmFrameAt(plan, index)!.hits.find(item => item.source === 'lane:kick');
    expect(rhythmFrameAt(plan, 0)?.position).toMatchObject({ patternId: 'B', clipId: null, absoluteBar: 1 });
    expect(rhythmFrameAt(plan, 0)?.hits).toContainEqual({ source: 'accent', sound: 'accent', velocity: 1 });
    expect(hit(0)).toMatchObject({ velocity: .25 });
    expect(hit(1)).toBeUndefined();
    expect(hit(2)).toBeUndefined();
    expect(hit(16)).toEqual(hit(0));
    expect(rhythmFrameAt(plan, 16)?.position).toMatchObject({ bar: 1, absoluteBar: 2 });
  });

  it('повторяет короткий рисунок клика, сохраняет триоли между шагами и не переносит тренировку на грув', () => {
    const project = { ...makeProject(), bpm: 120, swing: 66, overlay: true, countIn: true };
    const plan = createRhythmPlan({ project, preferences: { ...preferences, metronome: {
      ...defaultMetro, bpm: 180, meter: defaultRhythmMeter(2, 4), accents: [0, 2], division: 3,
      substeps: [true, false, false, true], swing: 70,
      training: { ...defaultMetro.training, silentEnabled: true, soundBars: 1, silentBars: 1, rampEnabled: true, everyBars: 1, targetBpm: 220 },
    } } });
    expect(frames(plan, 0, 4).map(frame => frame.hits[0].source)).toEqual(['accent', 'click', 'click', 'click']);
    const starts = boundaries(plan, 36);
    const overlay = frames(plan, 4, 32).flatMap(frame => frame.hits.filter(hit => !hit.source.startsWith('lane:'))
      .map(hit => ({ at: starts[frame.index] + (hit.offset ?? 0), source: hit.source })));
    expect(plan.practiceStepsPerBar).toBe(16);
    expectTimes(overlay.map(hit => hit.at), [2 + 1 / 6, 2.5, 2 + 5 / 6, 3 + 1 / 6, 3.5, 3 + 5 / 6, 4 + 1 / 6, 4.5, 4 + 5 / 6, 5 + 1 / 6, 5.5, 5 + 5 / 6]);
    expect(overlay.map(hit => hit.source)).toEqual(Array.from({ length: 4 }, () => ['subdivision', 'accent', 'subdivision']).flat());
    expect(frames(plan, 4, 32).every(frame => frame.bpm === 120 && !frame.position.silent)).toBe(true);
    expect(rhythmFrameAt(plan, 5)!.hits.some(hit => hit.source === 'subdivision' && hit.offset! > 0)).toBe(true);
  });

  it('кладёт восемь базовых восьмых в такт и наследует тип свинга клика отдельно от грува', () => {
    const project = { ...makeProject(), bpm: 120, swing: 66, overlay: true, repeat: 'once' as const };
    for (const [swingMode, secondSubstep] of [['eighth', .15], ['sixteenth', .125]] as const) {
      const plan = createRhythmPlan({ project, preferences: { ...preferences, metronome: {
        ...defaultMetro, bpm: 90, bpmUnit: 'dotted-quarter', meter: defaultRhythmMeter(9, 8),
        accents: [2, 1, 1, 1, 2, 1, 1, 1, 2], division: 4,
        substeps: Array.from({ length: 27 }, (_, index) => index === 1), swing: 60, swingMode,
      } } });
      const starts = boundaries(plan, 16);
      const events = frames(plan, 0, 16).flatMap(frame => frame.hits.filter(hit => !hit.source.startsWith('lane:'))
        .map(hit => ({ at: starts[frame.index] + (hit.offset ?? 0), source: hit.source })));
      expectTimes(events.filter(hit => hit.source !== 'subdivision').map(hit => hit.at), [0, .25, .5, .75, 1, 1.25, 1.5, 1.75]);
      expectTimes(events.filter(hit => hit.source === 'subdivision').map(hit => hit.at), [secondSubstep]);
      expectTimes(events.filter(hit => hit.source === 'accent').map(hit => hit.at), [0, 1]);
      expectTimes(starts.slice(0, 5), [0, .165, .33, .415, .5]);
      expect(starts.at(-1)).toBeCloseTo(2, 9);
      expect(rhythmFrameAt(plan, 16)).toBeNull();
    }
  });

  it('даёт независимые копии пресета и 16 шагов на каждый такт', () => {
    const [kick] = createLanes('rock', 3);
    expect(RHYTHM_PRESETS.map(preset => preset.id)).toEqual(['rock', 'funk', 'shuffle', 'blues', 'latin', 'disco', 'blank']);
    expect(kick.steps).toHaveLength(48);
    expect(kick.steps.slice(16)).toEqual([...kick.steps.slice(0, 16), ...kick.steps.slice(0, 16)]);
    expect(kick.steps[0]).toBe(2);
    kick.steps[0] = 0;
    expect(createLanes('rock')[0].steps[0]).toBe(2);
    expect(createLanes('blank', 4).every(lane => lane.velocities.length === 64 && lane.velocities.every(velocity => velocity === 0))).toBe(true);
  });

  it('создаёт отдельный замороженный снимок и отклоняет повреждённые ссылки, форму и данные', () => {
    const seed = makeProject();
    const detached = JSON.parse(JSON.stringify(seed));
    const validated = validateRhythmProject(detached);
    expect(validated).toEqual(seed);
    expect(Object.isFrozen(validated.patterns[0].lanes[0].velocities)).toBe(true);
    detached.patterns[0].lanes[0].velocities[0] = .2;
    expect(validated.patterns[0].lanes[0].velocities[0]).toBe(1);
    const invalid = [
      { ...seed, chain: [{ id: 'other', patternId: 'H' }] },
      { ...seed, chain: [seed.chain[0], seed.chain[0]] },
      { ...seed, channels: [seed.channels[0], seed.channels[0]] },
      { ...seed, patterns: new Array(seed.patterns.length) },
      { ...seed, bpm: Infinity },
      { ...seed, updatedAt: '2026-11-08T12:00:00.000Z' },
      Object.defineProperty({ ...seed }, 'bpm', { get: () => { throw new Error('Геттер не должен вызываться'); } }),
    ];
    for (const input of invalid) expect(() => validateRhythmProject(input)).toThrow(RangeError);
    expect(() => validateRhythmPlaybackConfig({ preferences })).toThrow(RangeError);
    expect(validateRhythmPlaybackConfig({ preferences: DEFAULT_RHYTHM_PREFERENCES, project: seed }))
      .toEqual({ preferences: DEFAULT_RHYTHM_PREFERENCES });
  });
});
