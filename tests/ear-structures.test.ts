import { describe, expect, it } from 'vitest';
import { beginEarListen, completeEarListen, createEarExample, createEarQuestion, earQualityFor, isEarQuality, nextEarQuestion, startEarSession, submitEarAnswer, type EarQuality } from '../src/ear';
import { createExerciseSpec } from '../src/exercises';
import { degreeCheck, validateCheckSpec } from '../src/practice/check';
import { checkSeries } from '../src/practice/check-series';
import { makeEarHistory, validateHistoryEntry } from '../src/storage';
import { checkMaterial, modeFor, startRun } from '../src/ui/check/session';

/* ---------- Слух для уменьшённого трезвучия, септаккордов и блюзовой гаммы (P16-10) ---------- */

const metadata = { occurredAt: '2026-11-08T22:30:00.000Z', timeZone: 'Europe/Moscow' };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Ожидания выписаны вручную: подписи вариантов и полутона от тоники (опора C2 = MIDI 36).
const CASES: readonly (readonly [EarQuality, string[], number[]])[] = [
  ['diminished-triad', ['1', '♭3', '♭5'], [0, 3, 6]],
  ['major-seventh', ['1', '3', '5', '7'], [0, 4, 7, 11]],
  ['dominant-seventh', ['1', '3', '5', '♭7'], [0, 4, 7, 10]],
  ['minor-seventh', ['1', '♭3', '5', '♭7'], [0, 3, 7, 10]],
  ['half-diminished-seventh', ['1', '♭3', '♭5', '♭7'], [0, 3, 6, 10]],
  ['blues', ['1', '♭3', '4', '♭5', '5', '♭7'], [0, 3, 5, 6, 7, 10]],
];

describe('слуховой вопрос по новым структурам', () => {
  it.each(CASES)('%s: варианты и цель от опоры', (quality, labels, semitones) => {
    expect(isEarQuality(quality)).toBe(true);
    for (const seed of [1, 7, 12345, 4000000000]) {
      const question = createEarQuestion({ root: 'C', quality, seed });
      expect(question.referenceMidi).toBe(36);
      expect(question.choices.map(choice => choice.label)).toEqual(labels);
      const index = question.choices.findIndex(choice => choice.id === question.targetDegree);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(question.targetMidi - question.referenceMidi).toBe(semitones[index]);
    }
  });

  it('серия охватывает разные ступени и воспроизводится по seed', () => {
    const first = startEarSession({ root: 'A', quality: 'blues', count: 20, seed: 11 });
    const again = startEarSession({ root: 'A', quality: 'blues', count: 20, seed: 11 });
    expect(first.questions.map(question => question.targetDegree)).toEqual(again.questions.map(question => question.targetDegree));
    expect(new Set(first.questions.map(question => question.targetDegree)).size).toBeGreaterThanOrEqual(4);
  });

  it('образец ♭5 блюза от A: опора A2 = 45, цель E♭3 = 51', () => {
    const example = createEarExample({ root: 'A', quality: 'blues' }, 'b5');
    expect([example.referenceMidi, example.targetMidi, example.targetName]).toEqual([45, 51, 'E♭']);
  });

  it('структура материала даёт слуховое качество; для остальных слуха нет', () => {
    expect(earQualityFor('blues')).toBe('blues');
    expect(earQualityFor('major-triad')).toBe('major');
    expect(earQualityFor('minor-triad')).toBe('minor');
    expect(earQualityFor('major')).toBeNull();
    expect(earQualityFor('natural-minor')).toBeNull();
  });
});

describe('слух в шаге проверки', () => {
  it('описание check-v2 допускает слух у блюзовой гаммы и септаккорда, но не у гаммы', () => {
    expect(() => degreeCheck(createExerciseSpec('blues-scale', { root: 'A', shapeId: 'compact-e' }), 'name-degree', 6, true)).not.toThrow();
    expect(() => degreeCheck(createExerciseSpec('arpeggio-seventh', { root: 'C', structureId: 'minor-seventh', shapeId: 'compact-e' }), 'find-degree', 6, true)).not.toThrow();
    expect(() => degreeCheck(createExerciseSpec('scale-compact', { root: 'C', structureId: 'major', shapeId: 'compact-e' }), 'find-degree', 6, true)).toThrow(/Слух/);
  });

  it('экран проверки включает слух для блюзовой гаммы и строит слуховую серию с шестью вариантами', () => {
    const spec = validateCheckSpec(degreeCheck(createExerciseSpec('blues-scale', { root: 'A', shapeId: 'compact-e' }), 'name-degree', 6, true));
    const material = checkMaterial(spec);
    expect(material.earQuality).toBe('blues');
    expect(modeFor(material)).toBe('ear');
    const run = startRun(material, 'ear', 5);
    expect(run.mode === 'ear' && run.ear.currentQuestion.choices).toHaveLength(6);
  });

  it('генератор вопросов по ступеням работает для уменьшённого трезвучия, септаккорда и блюзовой гаммы', () => {
    for (const exercise of [
      createExerciseSpec('arpeggio-1358', { root: 'B', structureId: 'diminished-triad', shapeId: 'compact-a' }),
      createExerciseSpec('arpeggio-seventh', { root: 'C', structureId: 'major-seventh', shapeId: 'compact-e' }),
      createExerciseSpec('arpeggio-seventh', { root: 'D', structureId: 'half-diminished-seventh', shapeId: 'compact-a' }),
      createExerciseSpec('blues-scale', { root: 'A', shapeId: 'compact-e' }),
    ]) {
      const material = checkMaterial(degreeCheck(exercise, 'find-degree', 6));
      const run = startRun(material, 'board', 3);
      expect(run.mode === 'board' && run.quiz.questions, JSON.stringify(exercise.params)).toHaveLength(6);
      const series = checkSeries(degreeCheck(exercise, 'name-degree', 6), 3);
      expect(series.positions.length).toBeGreaterThan(0);
    }
  });
});

describe('слуховой результат в истории', () => {
  it('блюз с шестью вариантами сохраняется и повторяется при импорте', () => {
    let session = startEarSession({ root: 'A', quality: 'blues', count: 2, seed: 4242 });
    session = completeEarListen(beginEarListen(session, 0, 80), 2500);
    const target = session.currentQuestion.targetDegree;
    const wrong = session.currentQuestion.choices.find(choice => choice.id !== target)!.id;
    session = submitEarAnswer(submitEarAnswer(session, wrong, 3000), target, 3500);
    session = completeEarListen(beginEarListen(nextEarQuestion(session), 0, 80), 2500);
    const entry = makeEarHistory(session, { ...metadata, id: 'ear-blues' })!;
    expect(entry.result.context.quality).toBe('blues');
    expect(entry.result.questions[0].question.choices).toHaveLength(6);
    expect(validateHistoryEntry(clone(entry))).toEqual(entry);
    expect(validateHistoryEntry(clone(entry), 'stored')).toEqual(entry);
  });

  it('неизвестное слуховое качество по-прежнему отклоняется, в том числе старое «diminished»', () => {
    let session = startEarSession({ root: 'A', quality: 'diminished-triad', count: 1, seed: 9 });
    session = completeEarListen(beginEarListen(session, 0, 80), 2500);
    const entry = makeEarHistory(session, { ...metadata, id: 'ear-dim' })!;
    for (const quality of ['diminished', 'dorian']) {
      const forged = clone(entry) as { result: { context: { quality: string } } };
      forged.result.context.quality = quality;
      expect(() => validateHistoryEntry(forged as never), quality).toThrow();
    }
  });
});
