import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import { DEFAULT_PRACTICE } from '../src/exercises/rhythm';
import { bpmAfterRating, exerciseSettingsPatch } from '../src/app/lesson-flow';
import { createPlan } from '../src/practice/plan';
import { pendingMatches } from '../src/ui/lesson/model';
import { continueApproach, PARTIAL_PASS_MIN_MS, stopApproach, type ApproachTally } from '../src/ui/play/model';

const eighths = { rhythm: 'eighths', echo: false, groove: null } as const;
const tally = (patch: Partial<ApproachTally> = {}): ApproachTally => ({ passes: 2, lastBpm: 96, activeMs: 9000, hints: [3, 2], wholePass: true, practice: eighths, ...patch });

describe('подход до оценки (P17-fix, D-050)', () => {
  it('новый запуск с тем же «как играть» продолжает подход; петля делает его не целым', () => {
    const { tally: next, lost } = continueApproach(tally(), { bpm: 100, wholePass: false, practice: eighths });
    expect(lost).toBe(false);
    expect(next).toMatchObject({ passes: 2, activeMs: 9000, hints: [3, 2], wholePass: false, lastBpm: 96 });
  });
  it('другое «как играть» начинает новый подход, прежний с проходами помечен потерянным', () => {
    const { tally: next, lost } = continueApproach(tally(), { bpm: 100, wholePass: true, practice: { ...eighths, rhythm: 'quarters' } });
    expect(lost).toBe(true);
    expect(next).toMatchObject({ passes: 0, activeMs: 0, hints: [], lastBpm: 100, wholePass: true });
    expect(continueApproach(null, { bpm: 80, wholePass: true, practice: eighths }).lost).toBe(false);
  });
  it('остановка: время недоигранного прохода в подход; без проходов — неполный проход от 5 с, иначе ничего', () => {
    expect(stopApproach(tally(), 1500, 0)).toMatchObject({ passes: 2, activeMs: 10500, hints: [3, 2], wholePass: true });
    expect(stopApproach(tally({ passes: 0, activeMs: 0, hints: [] }), PARTIAL_PASS_MIN_MS, 1)).toMatchObject({ passes: 0, activeMs: PARTIAL_PASS_MIN_MS, hints: [1], wholePass: false });
    expect(stopApproach(tally({ passes: 0, activeMs: 0, hints: [] }), PARTIAL_PASS_MIN_MS - 1, 1)).toBeNull();
  });
});

describe('темп и настройки упражнения после экрана игры', () => {
  it('«Не успевал» — на 4 BPM ниже, не ниже 40; иначе темп подхода', () => {
    expect(bpmAfterRating('slow', 120)).toBe(116);
    expect(bpmAfterRating('slow', 42)).toBe(40);
    expect(bpmAfterRating('clean', 120)).toBe(120);
    expect(bpmAfterRating('errors', 99.6)).toBe(100);
  });
  it('запоминается только менявшееся; ритм и подложка шага цели — нет', () => {
    const settings = { bpm: 120, targetBpm: 96, rhythm: 'quarters' as const, groove: 'shuffle' as const };
    expect(exerciseSettingsPatch(settings, ['metronome'], false)).toEqual({});
    expect(exerciseSettingsPatch(settings, ['bpm'], false)).toEqual({ bpm: 120 });
    expect(exerciseSettingsPatch(settings, ['rhythm', 'groove'], false)).toEqual({ rhythm: 'quarters', groove: 'shuffle' });
    expect(exerciseSettingsPatch(settings, ['rhythm', 'groove', 'targetBpm'], true)).toEqual({ targetBpm: 96 });
  });
});

describe('«как играть» шагов плана', () => {
  it('тот же материал с эхо — другой шаг плана; без practice — те же восьмые', () => {
    const spec = createExerciseSpec('pentatonic-form', { shapeId: 'penta-a' });
    const plan = createPlan('2026-11-15', [{ id: 'a', content: { kind: 'exercise', spec }, minutes: 4 }]);
    expect(pendingMatches(plan, { kind: 'exercise', spec, practice: DEFAULT_PRACTICE })).toHaveLength(1);
    expect(pendingMatches(plan, { kind: 'exercise', spec, practice: { ...DEFAULT_PRACTICE, echo: true } })).toHaveLength(0);
  });
});
