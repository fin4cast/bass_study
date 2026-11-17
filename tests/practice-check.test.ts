import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import { checkId, validateCheckSpec, type CheckSpec } from '../src/practice/check';

const range = (strings: string[], fretMin: number, fretMax: number) => ({ type: 'range', strings, fretMin, fretMax });
const base = (over: Record<string, unknown> = {}) => ({
  version: 'check-v2', kind: 'name-note', area: range(['E', 'A'], 0, 5), subject: { type: 'notes', notes: 'natural' }, count: 6, ear: false, ...over,
});

describe('check-v2: тождество проверки (A9.6)', () => {
  it('примеры из дополнения', () => {
    expect(checkId(validateCheckSpec(base()))).toBe('name-note.EA-0-5.notes-natural');
    expect(checkId(validateCheckSpec(base({
      kind: 'name-degree', area: range(['E', 'A', 'D'], 4, 7), subject: { type: 'degrees', scale: { root: 'A', degrees: ['1', '5', '6', 'b7'] }, targets: null },
    })))).toBe('name-degree.EAD-4-7.deg-A-1_5_6_b7');
    expect(checkId(validateCheckSpec(base({
      kind: 'find-degree', area: { type: 'exercise', exercise: createExerciseSpec('pentatonic-form') }, subject: { type: 'degrees', scale: null, targets: null },
    })))).toBe('find-degree.ex-pentatonic-form.A.minor-pentatonic.penta-a.deg');
  });

  it('знаки пишутся латиницей, цели и слух входят в тождество, число вопросов — нет', () => {
    const seventh = validateCheckSpec(base({
      kind: 'name-degree', area: range(['A', 'D', 'G'], 2, 5),
      subject: { type: 'degrees', scale: { root: 'C', degrees: ['1', '3', '5', 'b7', '7'] }, targets: ['b7', '7'] },
    }));
    expect(checkId(seventh)).toBe('name-degree.ADG-2-5.deg-C-1_3_5_b7_7-t-b7_7');
    expect(checkId(validateCheckSpec(base({ kind: 'find-note', subject: { type: 'roman-root', key: 'B♭' }, area: range(['E', 'A'], 0, 12) })))).toBe('find-note.EA-0-12.roman-Bb');
    expect(checkId(validateCheckSpec(base({ kind: 'find-note', subject: { type: 'chord-root', notes: 'all' }, area: range(['E', 'A'], 0, 12) })))).toBe('find-note.EA-0-12.chord-all');
    const ear = validateCheckSpec(base({
      kind: 'find-degree', area: { type: 'exercise', exercise: createExerciseSpec('pentatonic-form') }, subject: { type: 'degrees', scale: null, targets: null }, ear: true,
    }));
    expect(checkId(ear)).toBe('find-degree.ex-pentatonic-form.A.minor-pentatonic.penta-a.deg.ear');
    expect(checkId(validateCheckSpec(base({ count: 6 })))).toBe(checkId(validateCheckSpec(base({ count: 10 }))));
  });
});

describe('check-v2: строгая проверка описания (A9.1)', () => {
  const rejects = (value: unknown, message?: RegExp) => expect(() => validateCheckSpec(value)).toThrow(message ?? RangeError);

  it('принимает допустимые сочетания и замораживает результат', () => {
    const spec = validateCheckSpec(base());
    expect(Object.isFrozen(spec) && Object.isFrozen(spec.area) && Object.isFrozen(spec.subject)).toBe(true);
    for (const kind of ['find-note', 'name-note', 'find-all']) expect(() => validateCheckSpec(base({ kind }))).not.toThrow();
    expect(() => validateCheckSpec(base({ kind: 'find-note', subject: { type: 'chord-root', notes: 'natural' } }))).not.toThrow();
    expect(() => validateCheckSpec(base({ kind: 'find-note', subject: { type: 'roman-root', key: 'C' } }))).not.toThrow();
  });

  it('ровно перечисленные поля на каждом уровне', () => {
    rejects({ ...base(), extra: 1 });
    rejects({ ...base(), count: undefined });
    rejects(base({ area: { ...range(['E'], 0, 5), extra: 1 } }));
    rejects(base({ subject: { type: 'notes', notes: 'natural', extra: 1 } }));
    rejects(base({ version: 'check-v1' }), /версия/);
    rejects(null);
    rejects([]);
  });

  it('число вопросов 3–20, слух — логическое значение', () => {
    rejects(base({ count: 2 }));
    rejects(base({ count: 21 }));
    rejects(base({ count: 6.5 }));
    expect(() => validateCheckSpec(base({ count: 3 }))).not.toThrow();
    expect(() => validateCheckSpec(base({ count: 20 }))).not.toThrow();
    rejects(base({ ear: 'no' }));
  });

  it('диапазон: 1–4 струны по порядку E, A, D, G, лады 0–24 и начало не больше конца', () => {
    rejects(base({ area: range([], 0, 5) }));
    rejects(base({ area: range(['A', 'E'], 0, 5) }), /порядке/);
    rejects(base({ area: range(['E', 'E'], 0, 5) }));
    rejects(base({ area: range(['B'], 0, 5) }));
    rejects(base({ area: range(['E'], -1, 5) }));
    rejects(base({ area: range(['E'], 6, 5) }));
    rejects(base({ area: range(['E'], 0, 25) }));
    expect(() => validateCheckSpec(base({ area: range(['E', 'A', 'D', 'G'], 0, 24) }))).not.toThrow();
  });

  it('ступени: известные, по возрастанию полутонов, без двух одного класса высоты; гамма — с 1', () => {
    const degrees = (scale: unknown, targets: unknown = null) => base({ kind: 'name-degree', area: range(['E', 'A'], 0, 7), subject: { type: 'degrees', scale, targets } });
    expect(() => validateCheckSpec(degrees({ root: 'C', degrees: ['1', '3', '5'] }))).not.toThrow();
    rejects(degrees({ root: 'C', degrees: ['1', '9'] }));
    rejects(degrees({ root: 'C', degrees: ['1', '5', '3'] }));
    rejects(degrees({ root: 'C', degrees: ['1', '#4', 'b5'] }));
    rejects(degrees({ root: 'C', degrees: ['3', '5'] }), /с 1/);
    rejects(degrees({ root: 'C', degrees: ['1'] }));
    rejects(degrees({ root: 'H', degrees: ['1', '5'] }));
    rejects(degrees({ root: 'C', degrees: ['1', '3', '5'] }, ['7']), /входят/);
    expect(() => validateCheckSpec(degrees({ root: 'C', degrees: ['1', '3', '5'] }, ['3', '5']))).not.toThrow();
    rejects(degrees({ root: 'C', degrees: ['1', '3', '5'] }, []));
  });

  it('вид вопроса согласован с предметом и областью', () => {
    rejects(base({ kind: 'find-degree' }), /о нотах/);
    rejects(base({ kind: 'name-degree', subject: { type: 'degrees', scale: null, targets: null } }), /гамма/);
    rejects(base({ kind: 'name-degree', area: { type: 'exercise', exercise: createExerciseSpec('pentatonic-form') }, subject: { type: 'degrees', scale: { root: 'A', degrees: ['1', '5'] }, targets: null } }), /структуры/);
    rejects(base({ kind: 'name-note', subject: { type: 'chord-root', notes: 'natural' } }));
    rejects(base({ kind: 'find-note', subject: { type: 'chord-root', notes: 'natural' }, area: { type: 'exercise', exercise: createExerciseSpec('pentatonic-form') } }));
    rejects(base({ kind: 'find-note', subject: { type: 'roman-root', key: 'C' }, area: { type: 'exercise', exercise: createExerciseSpec('pentatonic-form') } }));
    rejects(base({ kind: 'find-note', subject: { type: 'roman-root', key: 'X' } }));
  });

  it('слух — только у ступеней материала без ограничения целей', () => {
    const exercise = { type: 'exercise', exercise: createExerciseSpec('pentatonic-form') };
    expect(() => validateCheckSpec(base({ kind: 'find-degree', area: exercise, subject: { type: 'degrees', scale: null, targets: null }, ear: true }))).not.toThrow();
    rejects(base({ kind: 'find-degree', area: exercise, subject: { type: 'degrees', scale: null, targets: ['1'] }, ear: true }), /Слух/);
    rejects(base({ ear: true }), /Слух/);
  });
});

describe('check-v2: структура, цели и слух по A9.1', () => {
  const exercise = (templateId: Parameters<typeof createExerciseSpec>[0]) => createExerciseSpec(templateId);
  const degrees = (area: unknown, targets: string[] | null = null, ear = false, kind = 'name-degree') =>
    () => validateCheckSpec({ version: 'check-v2', kind, area, subject: { type: 'degrees', scale: null, targets }, count: 6, ear });
  it('ступени материала без одной структуры отклоняются при описании, а не при игре', () => {
    expect(degrees({ type: 'exercise', exercise: exercise('chromatic-position') })).toThrow(RangeError);
    expect(degrees({ type: 'exercise', exercise: exercise('form-transpose') })).toThrow(RangeError);
    expect(degrees({ type: 'exercise', exercise: exercise('pentatonic-form') })).not.toThrow();
  });
  it('цели вопросов — подмножество ступеней структуры материала', () => {
    expect(degrees({ type: 'exercise', exercise: exercise('pentatonic-form') }, ['b7', '1'].sort())).not.toThrow();
    expect(degrees({ type: 'exercise', exercise: exercise('pentatonic-form') }, ['2'])).toThrow(RangeError);
  });
  it('слух — только у пентатоник и трезвучий', () => {
    expect(degrees({ type: 'exercise', exercise: exercise('pentatonic-form') }, null, true)).not.toThrow();
    expect(degrees({ type: 'exercise', exercise: exercise('scale-compact') }, null, true)).toThrow(RangeError);
  });
});
