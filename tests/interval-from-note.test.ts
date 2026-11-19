import { describe, expect, it } from 'vitest';
import { buildExercise, configureSpec, createExerciseSpec, INTERVAL_IDS, validateExerciseSpec } from '../src/exercises';
import { buildTimeline, rhythmPatternsFor } from '../src/exercises/rhythm';
import { materialId } from '../src/practice/material';

/* ---------- «Интервал от ноты» (R-028, A8.2): контрольные примеры от C выписаны в требованиях вручную ---------- */

const plan = (params: Record<string, unknown>) => buildExercise(createExerciseSpec('interval-from-note', params as never));
const view = (interval: string, direction: string) => {
  const result = plan({ note: 'C', interval, direction });
  return { ids: result.notes.map(note => note.id).join(' '), names: result.notes.map(note => note.name).join(' '), fingers: result.notes.map(note => note.finger).join(' '), degrees: result.notes.map(note => note.degree).join(' ') };
};

describe('контрольные примеры A8.2 от C (исходные позиции E:8, A:3, D:10, G:5)', () => {
  it.each([
    ['maj2', 'up', 'E:8 E:10 A:3 A:5 D:10 D:12 G:5 G:7', 'C2 D2 C2 D2 C3 D3 C3 D3', '1 3 1 3 1 3 1 3', '1 2 1 2 1 2 1 2'],
    ['min2', 'up', 'E:8 E:9 A:3 A:4 D:10 D:11 G:5 G:6', 'C2 D♭2 C2 D♭2 C3 D♭3 C3 D♭3', '1 2 1 2 1 2 1 2', '1 b2 1 b2 1 b2 1 b2'],
    ['min6', 'up', 'E:8 A:11 A:3 D:6', 'C2 A♭2 C2 A♭2', '1 4 1 4', '1 b6 1 b6'],
    ['maj6', 'up', 'E:8 D:7 A:3 G:2', 'C2 A2 C2 A2', '2 1 2 1', '1 6 1 6'],
    ['min7', 'up', 'E:8 D:8 A:3 G:3', 'C2 B♭2 C2 B♭2', '1 1 1 1', '1 b7 1 b7'],
    ['maj7', 'up', 'E:8 D:9 A:3 G:4', 'C2 B2 C2 B2', '1 2 1 2', '1 7 1 7'],
    ['min2', 'down', 'E:8 E:7 A:3 A:2 D:10 D:9 G:5 G:4', 'C2 B1 C2 B1 C3 B2 C3 B2', '2 1 2 1 2 1 2 1', '1 7 1 7 1 7 1 7'],
    ['maj2', 'down', 'E:8 E:6 A:3 A:1 D:10 D:8 G:5 G:3', 'C2 B♭1 C2 B♭1 C3 B♭2 C3 B♭2', '3 1 3 1 3 1 3 1', '1 b7 1 b7 1 b7 1 b7'],
    ['min6', 'down', 'D:10 A:7 G:5 D:2', 'C3 E2 C3 E2', '4 1 4 1', '1 3 1 3'],
    ['maj6', 'down', 'D:10 E:11 G:5 A:6', 'C3 E♭2 C3 E♭2', '1 2 1 2', '1 b3 1 b3'],
    ['min7', 'down', 'D:10 E:10 G:5 A:5', 'C3 D2 C3 D2', '1 1 1 1', '1 2 1 2'],
    ['maj7', 'down', 'D:10 E:9 G:5 A:4', 'C3 D♭2 C3 D♭2', '2 1 2 1', '1 b2 1 b2'],
  ])('%s %s', (interval, direction, ids, names, fingers, degrees) => {
    expect(view(interval, direction)).toEqual({ ids, names, fingers, degrees });
  });
});

describe('устройство шаблона', () => {
  it('по умолчанию C, большая секунда вверх; материал interval-from-note.C.maj2.up; заголовок и сегмент', () => {
    const result = plan({ note: 'C', interval: 'maj2', direction: 'up' });
    expect(materialId(result.spec)).toBe('interval-from-note.C.maj2.up');
    expect(createExerciseSpec('interval-from-note').params).toEqual({ note: 'C', interval: 'maj2', direction: 'up' });
    expect(result.title).toBe('Большая секунда вверх от C');
    expect(result.segments.map(segment => segment.label)).toEqual(['Большая секунда вверх · C → D']);
    expect(result).toMatchObject({ category: 'notes', cadence: 'none', overlap: 'none' });
    expect(result.notes.every(note => note.pluck === null)).toBe(true);
  });
  it('написание ноты интервала: двойной бемоль допустим (A♭ + малая секунда = B♭♭)', () => {
    const result = plan({ note: 'A♭', interval: 'min2', direction: 'up' });
    expect(result.notes[1].name).toMatch(/^B(♭♭|𝄫)\d$/);
    expect(result.segments[0].label).toMatch(/^Малая секунда вверх · A♭ → B(♭♭|𝄫)$/);
  });
  it('для любой ноты и любого интервала строится хотя бы одна пара на ладах 1–12', () => {
    for (const note of ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']) for (const interval of INTERVAL_IDS) for (const direction of ['up', 'down']) {
      const result = plan({ note, interval, direction });
      expect(result.notes.length, `${note} ${interval} ${direction}`).toBeGreaterThanOrEqual(2);
      expect(result.notes.length % 2).toBe(0);
      for (const item of result.notes) { expect(item.fret).toBeGreaterThanOrEqual(1); expect(item.fret).toBeLessThanOrEqual(12); }
    }
  });
  it('допустимы все ритмы; в четвертях проход — пары по порядку; программа — «четверти»', () => {
    const result = plan({ note: 'C', interval: 'maj2', direction: 'up' });
    expect(rhythmPatternsFor(result)).toContain('quarters');
    expect(buildTimeline(result, { pattern: 'quarters' }).steps.filter(step => step.note !== null)).toHaveLength(8);
  });
  it('строгая проверка: неизвестный интервал или направление отклоняется; «Настроить» меняет интервал', () => {
    expect(() => createExerciseSpec('interval-from-note', { interval: 'min3' } as never)).toThrow(RangeError);
    expect(() => createExerciseSpec('interval-from-note', { direction: 'sideways' } as never)).toThrow(RangeError);
    expect(() => validateExerciseSpec({ version: 'exercise-v1', templateId: 'interval-from-note', params: { note: 'C', interval: 'maj2' } })).toThrow(RangeError);
    expect(configureSpec(createExerciseSpec('interval-from-note'), 'interval', 'min7').params).toMatchObject({ interval: 'min7' });
  });
});
