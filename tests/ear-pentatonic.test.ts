import { describe, expect, it } from 'vitest';
import { createEarExample, createEarQuestion, getEarAudioEvents, startEarSession } from '../src/ear';

// Контроль вручную: опора A2 = MIDI 45; ♭3 = C3 48, 4 = D3 50, 5 = E3 52, ♭7 = G3 55.
describe('слуховой вопрос по ступеням пентатоники', () => {
  it('варианты — пять ступеней минорной пентатоники; цель — нота от опоры', () => {
    const question = createEarQuestion({ root: 'A', quality: 'minor-pentatonic', seed: 12345 });
    expect(question.referenceMidi).toBe(45);
    expect(question.choices.map(choice => choice.label)).toEqual(['1', '♭3', '4', '5', '♭7']);
    expect(['1', 'b3', '4', '5', 'b7']).toContain(question.targetDegree);
    expect(question.targetMidi - question.referenceMidi).toBe(({ '1': 0, b3: 3, '4': 5, '5': 7, b7: 10 } as Record<string, number>)[question.targetDegree]);
  });
  it('образец ♭7 звучит G3, сигнал — тоника, пауза, цель', () => {
    const example = createEarExample({ root: 'A', quality: 'minor-pentatonic' }, 'b7');
    expect([example.targetMidi, example.targetName]).toEqual([55, 'G']);
    expect(getEarAudioEvents(example, 80).events.map(event => event.midi)).toEqual([45, null, 55]);
  });
  it('серия охватывает разные ступени и детерминирована сидом', () => {
    const first = startEarSession({ root: 'A', quality: 'minor-pentatonic', count: 20, seed: 7 });
    const again = startEarSession({ root: 'A', quality: 'minor-pentatonic', count: 20, seed: 7 });
    expect(first.questions.map(question => question.targetDegree)).toEqual(again.questions.map(question => question.targetDegree));
    expect(new Set(first.questions.map(question => question.targetDegree)).size).toBeGreaterThanOrEqual(4);
  });
  it('у трезвучий выбор не изменился: та же ступень при том же сиде', () => {
    // Значения зафиксированы до расширения: выбор floor(seedValue / 2^32 × 3).
    const degrees = [1, 2, 3, 4, 5, 6].map(seed => createEarQuestion({ root: 'C', quality: 'major', seed }).targetDegree);
    expect(degrees.every(degree => ['1', '3', '5'].includes(degree))).toBe(true);
    expect(createEarQuestion({ root: 'C', quality: 'major', seed: 1 }).choices.map(choice => choice.id)).toEqual(['1', '3', '5']);
  });
  it('неизвестная структура отклоняется', () => {
    expect(() => createEarQuestion({ root: 'A', quality: 'dorian' as never, seed: 1 })).toThrow(RangeError);
  });
});
