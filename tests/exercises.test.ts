import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec, EXERCISE_TEMPLATES, validateExerciseSpec, type ExerciseTemplateId } from '../src/exercises';
import { createNotationPlan } from '../src/notation';

/**
 * Контрольные примеры R-014: выведены вручную независимым проверяющим по правилам R-026
 * без доступа к коду; «-» — палец не назначается.
 */
const CONTROL: Record<ExerciseTemplateId, { ids: string; names?: string; degrees?: string; fingers: string; segments: string }> = {
  'chromatic-position': { ids: 'E:5 E:6 E:7 E:8 A:5 A:6 A:7 A:8 D:5 D:6 D:7 D:8 G:5 G:6 G:7 G:8', fingers: '1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4', segments: '16' },
  'position-shift': { ids: 'A:3 A:4 A:5 A:6 A:4 A:5 A:6 A:7 A:5 A:6 A:7 A:8', fingers: '1 2 3 4 1 2 3 4 1 2 3 4', segments: '4 4 4' },
  'note-all-positions': { ids: 'E:8 A:3 D:10 G:5', names: 'C2 C2 C3 C3', degrees: '1 1 1 1', fingers: '- - - -', segments: '4' },
  octaves: { ids: 'E:3 D:5 A:10 G:12', names: 'G1 G2 G2 G3', degrees: '1 1 1 1', fingers: '- - - -', segments: '4' },
  'pentatonic-form': {
    ids: 'E:5 E:8 A:5 A:7 D:5 D:7 G:5 G:7 G:5 D:7 D:5 A:7 A:5 E:8', names: 'A1 C2 D2 E2 G2 A2 C3 D3 C3 A2 G2 E2 D2 C2',
    degrees: '1 b3 4 5 b7 1 b3 4 b3 1 b7 5 4 b3', fingers: '1 4 1 3 1 3 1 3 1 3 1 3 1 4', segments: '14',
  },
  'pentatonic-relative': {
    ids: 'E:5 E:8 A:5 A:7 D:5 D:7 G:5 G:7 G:5 D:7 D:5 A:7 A:5 E:8 E:5', names: 'A1 C2 D2 E2 G2 A2 C3 D3 C3 A2 G2 E2 D2 C2 A1',
    degrees: '6 1 2 3 5 6 1 2 b3 1 b7 5 4 b3 1', fingers: '1 4 1 3 1 3 1 3 1 3 1 3 1 4 1', segments: '8 7',
  },
  'scale-compact': {
    ids: 'E:8 E:10 A:7 A:8 A:10 D:7 D:9 D:10 D:9 D:7 A:10 A:8 A:7 E:10', names: 'C2 D2 E2 F2 G2 A2 B2 C3 B2 A2 G2 F2 E2 D2',
    degrees: '1 2 3 4 5 6 7 1 7 6 5 4 3 2', fingers: '2 4 1 2 4 1 3 4 3 1 4 2 1 4', segments: '14',
  },
  'connect-forms': {
    ids: 'E:5 E:8 A:5 A:7 D:5 D:7 G:5 G:7 G:9 G:7 D:10 D:7 A:10 A:7 E:10 E:8', names: 'A1 C2 D2 E2 G2 A2 C3 D3 E3 D3 C3 A2 G2 E2 D2 C2',
    degrees: '1 b3 4 5 b7 1 b3 4 5 4 b3 1 b7 5 4 b3', fingers: '1 4 1 3 1 3 1 3 3 1 4 1 4 1 4 2', segments: '8 8',
  },
  'pentatonic-neck': {
    ids: 'E:3 E:5 A:3 A:5 D:2 D:5 G:2 G:5 G:7 G:5 D:7 D:5 A:7 A:5 E:8 E:5 E:8 E:10 A:7 A:10 D:7 D:10 G:7 G:9 G:12 G:9 D:12 D:10 A:12 A:10 E:12 E:10 E:12 E:15 A:12 A:15 D:12 D:14 G:12 G:14',
    names: 'G1 A1 C2 D2 E2 G2 A2 C3 D3 C3 A2 G2 E2 D2 C2 A1 C2 D2 E2 G2 A2 C3 D3 E3 G3 E3 D3 C3 A2 G2 E2 D2 E2 G2 A2 C3 D3 E3 G3 A3',
    degrees: 'b7 1 b3 4 5 b7 1 b3 4 b3 1 b7 5 4 b3 1 b3 4 5 b7 1 b3 4 5 b7 5 4 b3 1 b7 5 4 5 b7 1 b3 4 5 b7 1',
    fingers: '2 4 2 4 1 4 1 4 3 1 3 1 3 1 4 1 2 4 1 4 1 4 1 3 4 1 4 2 4 2 4 2 1 4 1 4 1 3 1 3', segments: '8 8 8 8 8',
  },
  'scale-one-string': { ids: 'A:3 A:5 A:7 A:8 A:10 A:12 A:14 A:15', names: 'C2 D2 E2 F2 G2 A2 B2 C3', degrees: '1 2 3 4 5 6 7 1', fingers: '- - - - - - - -', segments: '8' },
  'arpeggio-1358': { ids: 'E:8 A:7 A:10 D:10 A:10 A:7', names: 'C2 E2 G2 C3 G2 E2', degrees: '1 3 5 1 5 3', fingers: '2 1 4 4 4 1', segments: '6' },
  'root-five-eight': { ids: 'A:3 D:5 G:5 D:5', names: 'C2 G2 C3 G2', degrees: '1 5 1 5', fingers: '- - - -', segments: '4' },
  'groups-of-three': {
    ids: 'E:5 E:8 A:5 E:8 A:5 A:7 A:5 A:7 D:5 A:7 D:5 D:7 D:5 D:7 G:5 D:7 G:5 G:7', names: 'A1 C2 D2 C2 D2 E2 D2 E2 G2 E2 G2 A2 G2 A2 C3 A2 C3 D3',
    degrees: '1 b3 4 b3 4 5 4 5 b7 5 b7 1 b7 1 b3 1 b3 4', fingers: '1 4 1 4 1 3 1 3 1 3 1 3 1 3 1 3 1 3', segments: '18',
  },
  thirds: {
    ids: 'E:8 A:7 E:10 A:8 A:7 A:10 A:8 D:7 A:10 D:9 D:7 D:10', names: 'C2 E2 D2 F2 E2 G2 F2 A2 G2 B2 A2 C3',
    degrees: '1 3 2 4 3 5 4 6 5 7 6 1', fingers: '2 1 4 2 1 4 2 1 4 3 1 4', segments: '12',
  },
  'form-transpose': {
    ids: 'E:5 E:8 A:5 A:7 D:5 D:7 G:5 G:7 G:5 D:7 D:5 A:7 A:5 E:8 E:10 E:13 A:10 A:12 D:10 D:12 G:10 G:12 G:10 D:12 D:10 A:12 A:10 E:13 E:12 E:15 A:12 A:14 D:12 D:14 G:12 G:14 G:12 D:14 D:12 A:14 A:12 E:15',
    names: 'A1 C2 D2 E2 G2 A2 C3 D3 C3 A2 G2 E2 D2 C2 D2 F2 G2 A2 C3 D3 F3 G3 F3 D3 C3 A2 G2 F2 E2 G2 A2 B2 D3 E3 G3 A3 G3 E3 D3 B2 A2 G2',
    degrees: '1 b3 4 5 b7 1 b3 4 b3 1 b7 5 4 b3 1 b3 4 5 b7 1 b3 4 b3 1 b7 5 4 b3 1 b3 4 5 b7 1 b3 4 b3 1 b7 5 4 b3',
    fingers: '1 4 1 3 1 3 1 3 1 3 1 3 1 4 1 4 1 3 1 3 1 3 1 3 1 3 1 4 1 4 1 3 1 3 1 3 1 3 1 3 1 4', segments: '14 14 14',
  },
  'cycle-fourths': {
    ids: 'E:8 A:10 D:10 A:10 E:1 A:3 D:3 A:3 E:6 A:8 D:8 A:8 E:11 A:13 D:13 A:13', names: 'C2 G2 C3 G2 F1 C2 F2 C2 B♭1 F2 B♭2 F2 E♭2 B♭2 E♭3 B♭2',
    degrees: '1 5 1 5 1 5 1 5 1 5 1 5 1 5 1 5', fingers: '- - - - - - - - - - - - - - - -', segments: '4 4 4 4',
  },
};

const segmentSizes = (segments: readonly number[]) => {
  const sizes: number[] = [];
  for (const segment of segments) sizes[segment] = (sizes[segment] ?? 0) + 1;
  return sizes.join(' ');
};

describe('каталог exercise-v1: независимые контрольные примеры', () => {
  it('каталог содержит 16 шаблонов с уникальными ID, по одному эталону на каждый', () => {
    expect(EXERCISE_TEMPLATES.map(template => template.id).sort()).toEqual(Object.keys(CONTROL).sort());
  });
  it.each(Object.entries(CONTROL))('%s по умолчанию', (templateId, expected) => {
    const plan = buildExercise(createExerciseSpec(templateId as ExerciseTemplateId));
    expect(plan.notes.map(note => note.id).join(' ')).toBe(expected.ids);
    if (expected.names) expect(plan.notes.map(note => note.name).join(' ')).toBe(expected.names);
    if (expected.degrees) expect(plan.notes.map(note => note.degree).join(' ')).toBe(expected.degrees);
    expect(plan.notes.map(note => note.finger ?? '-').join(' ')).toBe(expected.fingers);
    expect(segmentSizes(plan.notes.map(note => note.segment))).toBe(expected.segments);
    expect(plan.segments).toHaveLength(expected.segments.split(' ').length);
  });
  it('хроматика не приписывает ступени нотам вне структуры', () => {
    expect(buildExercise(createExerciseSpec('chromatic-position')).notes.every(note => note.degree === null)).toBe(true);
  });
  it('арпеджио A минорного трезвучия от E/5', () => {
    const plan = buildExercise(createExerciseSpec('arpeggio-1358', { root: 'A', structureId: 'minor-triad' }));
    expect(plan.notes.map(note => note.id).join(' ')).toBe('E:5 E:8 A:7 D:7 A:7 E:8');
    expect(plan.notes.map(note => note.degree).join(' ')).toBe('1 b3 5 1 5 b3');
    expect(plan.notes.map(note => note.finger).join(' ')).toBe('1 4 3 3 3 4');
  });
  it('перенос формы выбирает ближайший экземпляр, когда кандидатов несколько', () => {
    // C минорная пентатоника, форма A: экземпляры 8–11 и 20–23; ближе к 5–8 — 8–11.
    const plan = buildExercise(createExerciseSpec('form-transpose', { roots: ['A', 'C'] }));
    expect(plan.segments.map(segment => segment.label)).toEqual(['A · лады 5–8', 'C · лады 8–11']);
    expect(plan.notes.filter(note => note.segment === 1).map(note => note.id).join(' ')).toBe('E:8 E:11 A:8 A:10 D:8 D:10 G:8 G:10 G:8 D:10 D:8 A:10 A:8 E:11');
    expect(plan.notes.filter(note => note.segment === 1).map(note => note.name).join(' ')).toBe('C2 E♭2 F2 G2 B♭2 C3 E♭3 F3 E♭3 C3 B♭2 G2 F2 E♭2');
  });
});

describe('план упражнения как единый источник', () => {
  it.each(EXERCISE_TEMPLATES.map(template => template.id))('%s: TAB строится из тех же позиций', templateId => {
    const plan = buildExercise(createExerciseSpec(templateId));
    const notation = createNotationPlan({ positions: plan.positions, duration: 'eighth' });
    expect(notation.events.map(event => event.positionId)).toEqual(plan.notes.map(note => note.id));
    expect(Object.isFrozen(plan) && Object.isFrozen(plan.notes[0])).toBe(true);
  });
  it('связка форм отдаёт подписи сегментов и понятия', () => {
    const plan = buildExercise(createExerciseSpec('connect-forms'));
    expect(plan.segments.map(segment => segment.label)).toEqual(['Форма A · лады 5–8 · вверх', 'Форма B · лады 7–10 · вниз']);
    expect(plan.concepts).toContain('shared-notes');
  });
});

describe('строгое описание exercise-v1', () => {
  const good = createExerciseSpec('connect-forms');
  it.each([
    ['лишнее поле', { ...good, extra: 1 }],
    ['лишний параметр', { ...good, params: { ...good.params, bpm: 80 } }],
    ['нет параметра', { version: 'exercise-v1', templateId: 'connect-forms', params: { root: 'A', structureId: 'minor-pentatonic' } }],
    ['неизвестный шаблон', { ...good, templateId: 'scale-fpf' }],
    ['чужая версия', { ...good, version: 'exercise-v2' }],
    ['неверная структура', { ...good, params: { ...good.params, structureId: 'major' } }],
    ['неверная нота', { ...good, params: { ...good.params, root: 'H' } }],
    ['дробный лад', { version: 'exercise-v1', templateId: 'chromatic-position', params: { startFret: 5.5 } }],
    ['за пределом грифа', { version: 'exercise-v1', templateId: 'position-shift', params: { string: 'A', startFret: 20, shifts: 4 } }],
    ['слишком мало тоник', { version: 'exercise-v1', templateId: 'form-transpose', params: { structureId: 'minor-pentatonic', shapeId: 'penta-a', roots: ['A'] } }],
  ])('отклоняет: %s', (_, value) => {
    expect(() => validateExerciseSpec(value)).toThrow(RangeError);
  });
  it('нормализует написание ноты и замораживает описание', () => {
    const spec = createExerciseSpec('root-five-eight', { root: 'Bb' });
    expect(spec.params).toEqual({ root: 'B♭', string: 'A' });
    expect(Object.isFrozen(spec) && Object.isFrozen(spec.params)).toBe(true);
    expect(validateExerciseSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
  });
});
