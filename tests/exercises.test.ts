import { describe, expect, it } from 'vitest';
import { buildExercise, configureSpec, createExerciseSpec, EXERCISE_TEMPLATES, TASK_LINE_MAX, TEMPLATE_TASKS, templateOptions, validateExerciseSpec, type ExerciseTemplateId } from '../src/exercises';
import { createNotationPlan } from '../src/notation';
import { buildTimeline } from '../src/exercises/rhythm';

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
  'scale-position': {
    ids: 'E:8 E:10 A:7 A:8 A:10 D:7 D:9 D:10 G:7 G:9 G:10 G:9 G:7 D:10 D:9 D:7 A:10 A:8 A:7 E:10', names: 'C2 D2 E2 F2 G2 A2 B2 C3 D3 E3 F3 E3 D3 C3 B2 A2 G2 F2 E2 D2',
    degrees: '1 2 3 4 5 6 7 1 2 3 4 3 2 1 7 6 5 4 3 2', fingers: '2 4 1 2 4 1 3 4 1 3 4 3 1 4 3 1 4 2 1 4', segments: '20',
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
  // Паук 1-2-3-4 от 5-го лада, 5 позиций: чётные — E→G, нечётные — G→E, позиция сдвигается на лад.
  'song-fragment': { ids: 'A:3 A:3 E:3', names: 'C2 C2 G1', degrees: '1 1 5', fingers: '- - -', segments: '3' },
  'string-crossing': {
    ids: 'E:0 A:0 E:0 A:0 A:0 D:0 A:0 D:0 D:0 G:0 D:0 G:0 G:0 D:0 G:0 D:0', names: 'E1 A1 E1 A1 A1 D2 A1 D2 D2 G2 D2 G2 G2 D2 G2 D2',
    fingers: '- - - - - - - - - - - - - - - -', segments: '8 8',
  },
  spider: {
    ids: 'E:5 E:6 E:7 E:8 A:5 A:6 A:7 A:8 D:5 D:6 D:7 D:8 G:5 G:6 G:7 G:8 G:6 G:7 G:8 G:9 D:6 D:7 D:8 D:9 A:6 A:7 A:8 A:9 E:6 E:7 E:8 E:9 E:7 E:8 E:9 E:10 A:7 A:8 A:9 A:10 D:7 D:8 D:9 D:10 G:7 G:8 G:9 G:10 G:8 G:9 G:10 G:11 D:8 D:9 D:10 D:11 A:8 A:9 A:10 A:11 E:8 E:9 E:10 E:11 E:9 E:10 E:11 E:12 A:9 A:10 A:11 A:12 D:9 D:10 D:11 D:12 G:9 G:10 G:11 G:12',
    fingers: '1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4',
    segments: '16 16 16 16 16',
  },
  // Блюзовая гамма A от E/5: форма A пентатоники в одну октаву и ♭5 (E♭) на струне A.
  'blues-scale': {
    ids: 'E:5 E:8 A:5 A:6 A:7 D:5 D:7 D:5 A:7 A:6 A:5 E:8', names: 'A1 C2 D2 E♭2 E2 G2 A2 G2 E2 E♭2 D2 C2',
    degrees: '1 b3 4 b5 5 b7 1 b7 5 b5 4 b3', fingers: '1 4 1 2 3 1 3 1 3 2 1 4', segments: '12',
  },
  // C7 от E/8: 1 (E8) 3 (A7) 5 (A10) ♭7 (D8) 8 (D10) — восемь нот туда и обратно, ровно такт.
  'arpeggio-seventh': { ids: 'E:8 A:7 A:10 D:8 D:10 D:8 A:10 A:7', names: 'C2 E2 G2 B♭2 C3 B♭2 G2 E2', degrees: '1 3 5 b7 1 b7 5 3', fingers: '2 1 4 2 4 2 4 1', segments: '8' },
  // C мажор, 1-е обращение: E2 (A7) G2 (A10) C3 (D10) E3 (G9) в окне 7–10 и обратно.
  'arpeggio-inversion': { ids: 'A:7 A:10 D:10 G:9 D:10 A:10 A:7', names: 'E2 G2 C3 E3 C3 G2 E2', degrees: '3 5 1 3 1 5 3', fingers: '1 4 4 3 4 4 1', segments: '7' },
  // I–IV–V–I в C тониками: C (A3, лад ≥ 3, самый низкий), F (A8 — ближе к 3, чем E13), G (A10), C (E8 — ближе к 10, чем A15).
  progression: {
    ids: 'A:3 A:3 A:3 A:3 A:3 A:3 A:3 A:3 A:8 A:8 A:8 A:8 A:8 A:8 A:8 A:8 A:10 A:10 A:10 A:10 A:10 A:10 A:10 A:10 E:8 E:8 E:8 E:8 E:8 E:8 E:8 E:8',
    names: 'C2 C2 C2 C2 C2 C2 C2 C2 F2 F2 F2 F2 F2 F2 F2 F2 G2 G2 G2 G2 G2 G2 G2 G2 C2 C2 C2 C2 C2 C2 C2 C2',
    degrees: '1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1',
    fingers: '2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2', segments: '8 8 8 8',
  },
  // B4: рок-восьмые в G. Тоники: G — E:3, C — A:3, D — A:5, G — E:3; такты 1–3: шесть тоник и две квинты, такт 4: четыре восьмых и четверть тоники.
  riff: {
    ids: [...Array(6).fill('E:3'), 'A:5', 'A:5', ...Array(6).fill('A:3'), 'D:5', 'D:5', ...Array(6).fill('A:5'), 'D:7', 'D:7', ...Array(5).fill('E:3')].join(' '),
    names: [...Array(6).fill('G1'), 'D2', 'D2', ...Array(6).fill('C2'), 'G2', 'G2', ...Array(6).fill('D2'), 'A2', 'A2', ...Array(5).fill('G1')].join(' '),
    degrees: [...Array(6).fill('1'), '5', '5', ...Array(6).fill('1'), '5', '5', ...Array(6).fill('1'), '5', '5', ...Array(5).fill('1')].join(' '),
    fingers: [...Array(6).fill('2'), '4', '4', ...Array(6).fill('2'), '4', '4', ...Array(6).fill('2'), '4', '4', ...Array(5).fill('2')].join(' '),
    segments: '8 8 8 5',
  },
  // A5: шестнадцать нот E:0, пальцы левой руки и ступени не назначаются.
  'pulse-note': { ids: Array(16).fill('E:0').join(' '), names: Array(16).fill('E1').join(' '), fingers: Array(16).fill('-').join(' '), segments: '16' },
  // A6.1: натуральные ноты струны E на ладах 0–5 и обратно: E F G A G F.
  'string-naturals': { ids: 'E:0 E:1 E:3 E:5 E:3 E:1', names: 'E1 F1 G1 A1 G1 F1', fingers: '- - - - - -', segments: '6' },
  // A7.2: f = 5, n = 3, ряд позиций 5, 6, 7, 6; чётные — E→G пальцами 1-2-3-4, нечётные — G→E пальцами 4-3-2-1; 64 ноты.
  'chromatic-shift': {
    ids: 'E:5 E:6 E:7 E:8 A:5 A:6 A:7 A:8 D:5 D:6 D:7 D:8 G:5 G:6 G:7 G:8 '
      + 'G:9 G:8 G:7 G:6 D:9 D:8 D:7 D:6 A:9 A:8 A:7 A:6 E:9 E:8 E:7 E:6 '
      + 'E:7 E:8 E:9 E:10 A:7 A:8 A:9 A:10 D:7 D:8 D:9 D:10 G:7 G:8 G:9 G:10 '
      + 'G:9 G:8 G:7 G:6 D:9 D:8 D:7 D:6 A:9 A:8 A:7 A:6 E:9 E:8 E:7 E:6',
    names: 'A1 B♭1 B1 C2 D2 E♭2 E2 F2 G2 A♭2 A2 B♭2 C3 C♯3 D3 E♭3 '
      + 'E3 E♭3 D3 C♯3 B2 B♭2 A2 A♭2 F♯2 F2 E2 E♭2 C♯2 C2 B1 B♭1 '
      + 'B1 C2 C♯2 D2 E2 F2 F♯2 G2 A2 B♭2 B2 C3 D3 E♭3 E3 F3 '
      + 'E3 E♭3 D3 C♯3 B2 B♭2 A2 A♭2 F♯2 F2 E2 E♭2 C♯2 C2 B1 B♭1',
    fingers: Array.from({ length: 4 }, (_, segment) => (segment % 2 ? '4 3 2 1' : '1 2 3 4')).flatMap(group => [group, group, group, group]).join(' '),
    segments: '16 16 16 16',
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
  it('каталог содержит шаблоны с уникальными ID, по одному эталону на каждый', () => {
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

describe('гамма в позиции «палец на лад»: независимые примеры', () => {
  // Выведены вручную независимым проверяющим. II позиция C мажора — по уточнённому правилу:
  // мизинец уже стоит на E/12, поэтому F2 берётся указательным на A/8 (проверяющий указал её как позицию p−1).
  it.each([
    ['C', 'major', 1, 'E:8 E:10 A:7 A:8 A:10 D:7 D:9 D:10 G:7 G:9 G:10', '2 4 1 2 4 1 3 4 1 3 4', '- - - - - - - - - - -', '7–10'],
    ['C', 'major', 2, 'E:10 E:12 A:8 A:10 A:12 D:9 D:10 D:12 G:9 G:10 G:12', '2 4 1 2 4 1 2 4 1 2 4', '- - * - - - - - - - -', '9–12'],
    ['C', 'major', 3, 'E:12 E:13 E:15 A:12 A:14 A:15 D:12 D:14 D:15 G:12 G:14', '1 2 4 1 3 4 1 3 4 1 3', '- - - - - - - - - - -', '12–15'],
    ['C', 'major', 4, 'E:1 E:3 E:5 A:2 A:3 A:5 D:2 D:3 D:5 G:2 G:4', '1 3 4 2 3 4 2 3 4 2 4', '- - * - - * - - * - -', '1–4'],
    ['C', 'major', 5, 'E:3 E:5 A:2 A:3 A:5 D:2 D:3 D:5 G:2 G:4 G:5', '2 4 1 2 4 1 2 4 1 3 4', '- - - - - - - - - - -', '2–5'],
    ['C', 'major', 6, 'E:5 E:7 E:8 A:5 A:7 A:8 D:5 D:7 D:9 G:5 G:7', '1 3 4 1 3 4 1 3 4 1 3', '- - - - - - - - * - -', '5–8'],
    ['C', 'major', 7, 'E:7 E:8 E:10 A:7 A:8 A:10 D:7 D:9 D:10 G:7 G:9 G:10', '1 2 4 1 2 4 1 3 4 1 3 4', '- - - - - - - - - - - -', '7–10'],
    ['A', 'natural-minor', 1, 'E:5 E:7 E:8 A:5 A:7 A:8 D:5 D:7 D:9 G:5 G:7', '1 3 4 1 3 4 1 3 4 1 3', '- - - - - - - - * - -', '5–8'],
    ['G', 'major', 1, 'E:3 E:5 A:2 A:3 A:5 D:2 D:4 D:5 G:2 G:4 G:5', '2 4 1 2 4 1 3 4 1 3 4', '- - - - - - - - - - -', '2–5'],
  ] as const)('%s %s, позиция %i', (root, structureId, degree, ids, fingers, stretch, window) => {
    const plan = buildExercise(createExerciseSpec('scale-position', { root, structureId, degree }));
    const count = ids.split(' ').length;
    const up = plan.notes.slice(0, count);
    expect(up.map(note => note.id).join(' ')).toBe(ids);
    expect(up.map(note => note.finger).join(' ')).toBe(fingers);
    expect(up.map(note => note.stretch ? '*' : '-').join(' ')).toBe(stretch);
    expect(plan.notes.slice(count).map(note => note.id)).toEqual(up.slice(1, -1).reverse().map(note => note.id));
    expect(plan.segments[0].label).toContain(`лады ${window}`);
  });
  it('все 7 позиций строятся во всех 12 тониках мажора и минора без растяжки больше чем на лад', () => {
    for (const root of ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']) for (const structureId of ['major', 'natural-minor'] as const) for (let degree = 1; degree <= 7; degree++) {
      const plan = buildExercise(createExerciseSpec('scale-position', { root, structureId, degree }));
      const frets = plan.notes.map(note => note.fret);
      expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(5);
      expect(plan.notes.every(note => note.degree !== null)).toBe(true);
    }
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

describe('новые шаблоны D-049: аккорды, обращения, последовательности, паук', () => {
  const ROOTS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const ids = (spec: Parameters<typeof buildExercise>[0]) => buildExercise(spec).notes.map(note => note.id).join(' ');

  it('2-е обращение C мажора — ручной пример: G1 (E3) C2 (A3) E2 (D2) G2 (D5), пальцы 2-2-1-4', () => {
    const plan = buildExercise(createExerciseSpec('arpeggio-inversion', { inversion: 2 }));
    expect(plan.notes.map(note => note.id).join(' ')).toBe('E:3 A:3 D:2 D:5 D:2 A:3 E:3');
    expect(plan.notes.map(note => note.name).join(' ')).toBe('G1 C2 E2 G2 E2 C2 G1');
    expect(plan.notes.map(note => note.finger).join(' ')).toBe('2 2 1 4 1 2 2');
  });

  it('все 12 тоник: септаккорды, уменьшённое, обращения, блюзовая гамма и последовательности строятся', () => {
    for (const root of ROOTS) {
      for (const structureId of ['major-seventh', 'dominant-seventh', 'minor-seventh', 'half-diminished-seventh'] as const) {
        for (const shapeId of ['compact-e', 'compact-a'] as const) expect(buildExercise(createExerciseSpec('arpeggio-seventh', { root, structureId, shapeId })).notes).toHaveLength(8);
      }
      expect(buildExercise(createExerciseSpec('arpeggio-1358', { root, structureId: 'diminished-triad' })).notes.map(note => note.degree)).toEqual(['1', 'b3', 'b5', '1', 'b5', 'b3']);
      for (const structureId of ['major-triad', 'minor-triad', 'diminished-triad'] as const) for (const inversion of [1, 2]) {
        const plan = buildExercise(createExerciseSpec('arpeggio-inversion', { root, structureId, inversion }));
        const up = plan.notes.slice(0, 4);
        expect(up[3].midi - up[0].midi).toBe(12);
        expect(up.every((note, index) => index === 0 || note.midi > up[index - 1].midi)).toBe(true);
        expect(Math.max(...up.map(note => note.fret)) - Math.min(...up.map(note => note.fret))).toBeLessThanOrEqual(3);
      }
      for (const shapeId of ['compact-e', 'compact-a'] as const) expect(buildExercise(createExerciseSpec('blues-scale', { root, shapeId })).notes).toHaveLength(12);
      for (const progression of ['I-IV-V', 'ii-V-I', 'blues-12'] as const) for (const pattern of ['roots', 'arpeggio', 'approach'] as const) {
        const plan = buildExercise(createExerciseSpec('progression', { root, progression, pattern }));
        expect(plan.notes).toHaveLength(plan.segments.length * 8);
        expect(Math.min(...plan.notes.map(note => note.fret))).toBeGreaterThanOrEqual(1);
      }
      expect(buildExercise(createExerciseSpec('progression', { root, progression: 'blues-12', pattern: 'boogie' })).notes).toHaveLength(96);
    }
  });

  it('последовательность: аккорд на такт, тоника каждого такта — «1», подпись «аккорд · ступень», такты нотации совпадают с аккордами', () => {
    const plan = buildExercise(createExerciseSpec('progression', { progression: 'ii-V-I', pattern: 'arpeggio' }));
    expect(plan.segments.map(segment => segment.label)).toEqual(['Dm7 · ii7', 'G7 · V7', 'Cmaj7 · Imaj7', 'Cmaj7 · Imaj7']);
    expect(plan.overlap).toBe('none');
    for (let bar = 0; bar < 4; bar++) expect(plan.notes.slice(bar * 8, bar * 8 + 8).map(note => note.degree).join(' ')).toMatch(/^1 b?3 b?5 b?7 1 b?7 b?5 b?3$/);
    const notation = createNotationPlan({ positions: plan.positions, duration: 'eighth' });
    expect(notation.events.map(event => event.bar)).toEqual(plan.notes.map(note => note.segment));
    const blues = buildExercise(createExerciseSpec('progression', { root: 'A', progression: 'blues-12', pattern: 'roots' }));
    expect(blues.segments.map(segment => segment.label.split(' · ')[0]).join(' ')).toBe('A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7');
  });

  it('подход: восьмая нота такта — на полутон от тоники следующего аккорда, без пальца и ступени; последний такт ведёт к первому', () => {
    const plan = buildExercise(createExerciseSpec('progression', { pattern: 'approach' }));
    const bars = plan.segments.length;
    for (let bar = 0; bar < bars; bar++) {
      const approach = plan.notes[bar * 8 + 7];
      const nextRoot = plan.notes[((bar + 1) % bars) * 8];
      expect(Math.abs(approach.midi - nextRoot.midi)).toBe(1);
      expect(approach.string).toBe(nextRoot.string);
      expect([approach.finger, approach.degree]).toEqual([null, null]);
    }
  });

  it('рисунки «тоника и квинта» и «октавы»: в такте аккорда 1 1 5 5 1 1 5 5 и 1 8 1 8…', () => {
    const fifth = buildExercise(createExerciseSpec('progression', { root: 'C', progression: 'I-IV-V', pattern: 'root-fifth' }));
    expect(fifth.notes.slice(0, 8).map(note => note.degree).join(' ')).toBe('1 1 5 5 1 1 5 5');
    expect(fifth.notes.slice(0, 8).map(note => note.name).join(' ')).toBe('C2 C2 G2 G2 C2 C2 G2 G2');
    const octaves = buildExercise(createExerciseSpec('progression', { root: 'C', progression: 'I-IV-V', pattern: 'octaves' }));
    expect(octaves.notes.slice(0, 4).map(note => note.name).join(' ')).toBe('C2 C3 C2 C3');
    expect(octaves.notes.slice(8, 10).map(note => note.name).join(' ')).toBe('F2 F3');
  });
  it('буги 1-3-5-6-♭7-6-5-3 только по блюзу; паук — до 16-го лада и без «общих» позиций', () => {
    const boogie = buildExercise(createExerciseSpec('progression', { root: 'A', progression: 'blues-12', pattern: 'boogie' }));
    expect(boogie.notes.slice(0, 8).map(note => note.degree).join(' ')).toBe('1 3 5 6 b7 6 5 3');
    expect(boogie.notes.slice(0, 8).map(note => note.name).join(' ')).toBe('A1 C♯2 E2 F♯2 G2 F♯2 E2 C♯2');
    expect(() => createExerciseSpec('progression', { pattern: 'boogie' })).toThrow(RangeError);
    expect(buildExercise(createExerciseSpec('spider')).overlap).toBe('none');
    expect(ids(createExerciseSpec('spider', { startFret: 1, positions: 2, pattern: '1324' })))
      .toBe('E:1 E:3 E:2 E:4 A:1 A:3 A:2 A:4 D:1 D:3 D:2 D:4 G:1 G:3 G:2 G:4 G:2 G:4 G:3 G:5 D:2 D:4 D:3 D:5 A:2 A:4 A:3 A:5 E:2 E:4 E:3 E:5');
    expect(() => createExerciseSpec('spider', { startFret: 12, positions: 3 })).toThrow(RangeError);
    expect(createExerciseSpec('spider', { startFret: 1, positions: 12 }).params).toMatchObject({ positions: 12 });
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

describe('настройка упражнения на карточке (D-049)', () => {
  it('у каждого шаблона списки содержат материал по умолчанию, и каждый вариант даёт допустимый материал или понятную ошибку', () => {
    // Фрагмент песни — только своё упражнение: настройки карточки у него нет.
    for (const template of EXERCISE_TEMPLATES.filter(item => !item.userOnly)) {
      const spec = createExerciseSpec(template.id);
      const options = templateOptions(template.id);
      expect(options.length, template.id).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.values.map(item => item.value), `${template.id}.${option.param}`).toContain((spec.params as Record<string, unknown>)[option.param]);
        for (const { value } of option.values) {
          let configured;
          try { configured = configureSpec(spec, option.param, value); } catch (failure) {
            expect((failure as Error).message.length, `${template.id}.${option.param}=${value}`).toBeGreaterThan(5);
            continue;
          }
          expect((configured.params as Record<string, unknown>)[option.param]).toBe(value);
          expect(() => buildExercise(configured)).not.toThrow();
        }
      }
    }
  });
  it('несовместимое сочетание подстраивает зависимый параметр, а не меняет выбранный', () => {
    const spider = configureSpec(createExerciseSpec('spider'), 'startFret', 12);
    expect(spider.params).toMatchObject({ startFret: 12, positions: 2 });
    const boogie = configureSpec(createExerciseSpec('progression'), 'pattern', 'boogie');
    expect(boogie.params).toMatchObject({ progression: 'blues-12', pattern: 'boogie' });
    expect(configureSpec(boogie, 'progression', 'ii-V-I').params).toMatchObject({ progression: 'ii-V-I', pattern: 'roots' });
    expect(configureSpec(createExerciseSpec('spider'), 'positions', 12).params).toMatchObject({ startFret: 2, positions: 12 });
  });
});

describe('P18-03: задание из трёх строк у каждого шаблона каталога', () => {
  const ids = EXERCISE_TEMPLATES.map(template => template.id);
  it('текст задан у каждого шаблона и только у них', () => {
    expect(Object.keys(TEMPLATE_TASKS).sort()).toEqual([...ids].sort());
  });
  it('три непустые строки по правилу «что делать, на что обратить внимание, что считать чисто» умещаются в предел', () => {
    for (const id of ids) {
      const task = TEMPLATE_TASKS[id];
      expect(Object.keys(task), id).toEqual(['do', 'notice', 'clean']);
      for (const line of [task.do, task.notice, task.clean]) {
        expect(line.trim(), id).toBe(line);
        expect(line.length, `${id}: «${line}»`).toBeGreaterThan(20);
        expect(line.length, `${id}: «${line}»`).toBeLessThanOrEqual(TASK_LINE_MAX);
        expect(line, id).toMatch(/[.!]$/);
      }
      expect(Object.isFrozen(task) || Object.isFrozen(TEMPLATE_TASKS), id).toBe(true);
    }
  });
  it('ни одна строка не повторяется у разных шаблонов, а «что делать» не совпадает с «чисто»', () => {
    const lines = ids.flatMap(id => [TEMPLATE_TASKS[id].do, TEMPLATE_TASKS[id].notice, TEMPLATE_TASKS[id].clean]);
    expect(new Set(lines).size).toBe(lines.length);
  });
  it('план упражнения несёт задание своего шаблона', () => {
    for (const id of ids) expect(buildExercise(createExerciseSpec(id)).task, id).toBe(TEMPLATE_TASKS[id]);
  });
});

describe('форма A1/B7: аппликатура, направление и позиция (P18-20)', () => {
  it('новые параметры идут в порядке A1/B7 и входят в ключ материала', async () => {
    const { materialId } = await import('../src/practice/material');
    expect(Object.keys(createExerciseSpec('chromatic-position').params)).toEqual(['startFret', 'fingering', 'direction']);
    expect(materialId(createExerciseSpec('chromatic-position'))).toBe('chromatic-position.5.1234.up');
    expect(Object.keys(createExerciseSpec('progression').params)).toEqual(['root', 'progression', 'pattern', 'position']);
    expect(materialId(createExerciseSpec('progression'))).toBe('progression.C.I-IV-V.roots.closed');
  });

  it('значения аппликатуры, направления и позиции допустимы, посторонние отклоняются', () => {
    const chromatic = createExerciseSpec('chromatic-position');
    for (const [param, value] of [['fingering', '124'], ['direction', 'up-down']] as const) {
      expect(() => validateExerciseSpec({ ...chromatic, params: { ...chromatic.params, [param]: value } }), `${param}=${value}`).not.toThrow();
    }
    for (const [param, value] of [['fingering', '134'], ['direction', 'down'], ['fingering', '']] as const) {
      expect(() => validateExerciseSpec({ ...chromatic, params: { ...chromatic.params, [param]: value } }), `${param}=${value}`).toThrow(RangeError);
    }
    const progression = createExerciseSpec('progression');
    for (const value of ['closed', 'low']) expect(() => validateExerciseSpec({ ...progression, params: { ...progression.params, position: value } }), value).not.toThrow();
    for (const value of ['Closed', 'middle', '']) expect(() => validateExerciseSpec({ ...progression, params: { ...progression.params, position: value } }), value).toThrow(RangeError);
    // Старая форма без новых полей — не материал этой версии.
    expect(() => validateExerciseSpec({ version: 'exercise-v1', templateId: 'chromatic-position', params: { startFret: 5 } })).toThrow(RangeError);
  });
});

/* ---------- Шаблоны этапа 1: хроматика 1-2-4, пульс, ноты на струне, хроматика по позициям (R-028, A5–A7) ---------- */

describe('хроматика: аппликатура 1-2-4 и направление (A7.1)', () => {
  const run = (params: Record<string, unknown>) => buildExercise(createExerciseSpec('chromatic-position', params as never));
  const ids = (plan: ReturnType<typeof run>) => plan.notes.map(note => note.id).join(' ');
  const fingers = (plan: ReturnType<typeof run>) => plan.notes.map(note => note.finger).join(' ');
  const names = (plan: ReturnType<typeof run>) => plan.notes.map(note => note.name).join(' ');

  it('1-2-4 от 1-го лада вверх: три лада на струне, пальцы 1, 2, 4', () => {
    const plan = run({ startFret: 1, fingering: '124' });
    expect(ids(plan)).toBe('E:1 E:2 E:3 A:1 A:2 A:3 D:1 D:2 D:3 G:1 G:2 G:3');
    expect(names(plan)).toBe('F1 F♯1 G1 B♭1 B1 C2 E♭2 E2 F2 A♭2 A2 B♭2');
    expect(fingers(plan)).toBe('1 2 4 1 2 4 1 2 4 1 2 4');
    expect(plan.segments.map(segment => segment.label)).toEqual(['Позиция 1 · пальцы 1-2-4 · лады 1–3']);
  });
  it('1-2-4 от 3-го лада вверх', () => {
    const plan = run({ startFret: 3, fingering: '124' });
    expect(ids(plan)).toBe('E:3 E:4 E:5 A:3 A:4 A:5 D:3 D:4 D:5 G:3 G:4 G:5');
    expect(names(plan)).toBe('G1 A♭1 A1 C2 C♯2 D2 F2 F♯2 G2 B♭2 B2 C3');
    expect(fingers(plan)).toBe('1 2 4 1 2 4 1 2 4 1 2 4');
  });
  it('вверх и вниз с 1-2-4: ход вниз по струнам G, D, A, E теми же ладами по убыванию, пальцы 4-2-1', () => {
    const plan = run({ startFret: 1, fingering: '124', direction: 'up-down' });
    expect(plan.notes).toHaveLength(24);
    expect(ids(plan)).toBe('E:1 E:2 E:3 A:1 A:2 A:3 D:1 D:2 D:3 G:1 G:2 G:3 G:3 G:2 G:1 D:3 D:2 D:1 A:3 A:2 A:1 E:3 E:2 E:1');
    expect(names(plan).split(' ').slice(12).join(' ')).toBe('B♭2 A2 A♭2 F2 E2 E♭2 C2 B1 B♭1 G1 F♯1 F1');
    expect(fingers(plan).split(' ').slice(12).join(' ')).toBe('4 2 1 4 2 1 4 2 1 4 2 1');
    expect(plan.segments.map(segment => segment.label)).toEqual(['Позиция 1 · пальцы 1-2-4 · лады 1–3 · вверх', 'Позиция 1 · пальцы 1-2-4 · лады 1–3 · вниз']);
  });
  it('1-2-3-4 вверх и вниз: 32 ноты, верхняя нота дважды подряд, последняя — E:f', () => {
    const plan = run({ startFret: 5, direction: 'up-down' });
    expect(plan.notes).toHaveLength(32);
    expect(plan.notes.slice(15, 17).map(note => note.id)).toEqual(['G:8', 'G:8']);
    expect(plan.notes.at(-1)!.id).toBe('E:5');
    expect(fingers(plan).split(' ').slice(16, 20).join(' ')).toBe('4 3 2 1');
  });
  it('умолчания не изменились; заголовок называет аппликатуру и направление', () => {
    expect(run({}).title).toBe('Хроматика 1-2-3-4 в позиции');
    expect(run({ fingering: '124' }).title).toBe('Хроматика 1-2-4 в позиции');
    expect(run({ direction: 'up-down' }).title).toBe('Хроматика 1-2-3-4 в позиции, вверх и вниз');
    expect(templateOptions('chromatic-position').map(option => option.param)).toEqual(['startFret', 'fingering', 'direction']);
  });
});

describe('пульс на одной ноте (A5)', () => {
  const run = (params: Record<string, unknown>) => buildExercise(createExerciseSpec('pulse-note', params as never));
  it('варианты программы: открытые A, D, G и E:5 — та же высота, что у открытой A', () => {
    expect(run({ string: 'A' }).notes.map(note => `${note.id} ${note.name}`)[0]).toBe('A:0 A1');
    expect(run({ string: 'D' }).notes[0]).toMatchObject({ id: 'D:0', name: 'D2' });
    expect(run({ string: 'G' }).notes[0]).toMatchObject({ id: 'G:0', name: 'G2' });
    expect(run({ fret: 5 }).notes[0]).toMatchObject({ id: 'E:5', name: 'A1' });
  });
  it('правая рука чередуется i–m по нотам, ступеней и пальцев левой руки нет', () => {
    const plan = run({});
    expect(plan.notes.map(note => note.pluck).join(' ')).toBe('i m i m i m i m i m i m i m i m');
    expect(plan.notes.every(note => note.degree === null && note.finger === null)).toBe(true);
    expect(plan.cadence).toBe('none');
    expect(plan.segments.map(segment => segment.label)).toEqual(['Открытая струна E · i–m']);
    expect(run({ fret: 5 }).segments.map(segment => segment.label)).toEqual(['Струна E · лад 5 · i–m']);
  });
  it('число нот — 8, 16 или 32; остальное отклоняется', () => {
    for (const notes of [8, 16, 32]) expect(run({ notes }).notes).toHaveLength(notes);
    for (const notes of [0, 7, 12, 64]) expect(() => createExerciseSpec('pulse-note', { notes } as never), String(notes)).toThrow(RangeError);
    expect(() => createExerciseSpec('pulse-note', { fret: 13 })).toThrow(RangeError);
    expect(() => validateExerciseSpec({ version: 'exercise-v1', templateId: 'pulse-note', params: { string: 'E', fret: 0 } })).toThrow(RangeError);
  });
});

describe('ноты на струне (A6.1)', () => {
  // Лады натуральных нот вверх: независимая таблица из требований.
  const UP: Record<string, Record<5 | 12, string>> = {
    E: { 5: '0 1 3 5', 12: '0 1 3 5 7 8 10 12' },
    A: { 5: '0 2 3 5', 12: '0 2 3 5 7 8 10 12' },
    D: { 5: '0 2 3 5', 12: '0 2 3 5 7 9 10 12' },
    G: { 5: '0 2 4 5', 12: '0 2 4 5 7 9 10 12' },
  };
  const NAMES: Record<string, Record<5 | 12, string>> = {
    E: { 5: 'E1 F1 G1 A1', 12: 'E1 F1 G1 A1 B1 C2 D2 E2' }, A: { 5: 'A1 B1 C2 D2', 12: 'A1 B1 C2 D2 E2 F2 G2 A2' },
    D: { 5: 'D2 E2 F2 G2', 12: 'D2 E2 F2 G2 A2 B2 C3 D3' }, G: { 5: 'G2 A2 B2 C3', 12: 'G2 A2 B2 C3 D3 E3 F3 G3' },
  };
  const back = (items: string[]) => [...items, ...items.slice(1, -1).reverse()];
  it.each(['E', 'A', 'D', 'G'].flatMap(string => [5, 12].map(fretMax => [string, fretMax] as const)))('струна %s, лады 0–%i: вверх по таблице и обратно без крайних', (string, fretMax) => {
    const plan = buildExercise(createExerciseSpec('string-naturals', { string, fretMax } as never));
    expect(plan.notes.map(note => note.fret.toString())).toEqual(back(UP[string][fretMax as 5 | 12].split(' ')));
    expect(plan.notes.map(note => note.name)).toEqual(back(NAMES[string][fretMax as 5 | 12].split(' ')));
    expect(plan.notes.every(note => note.string === string && note.degree === null && note.finger === null && note.pluck === null)).toBe(true);
  });
  it('E, 0–12: четырнадцать нот', () => {
    expect(buildExercise(createExerciseSpec('string-naturals', { fretMax: 12 })).notes.map(note => note.id).join(' '))
      .toBe('E:0 E:1 E:3 E:5 E:7 E:8 E:10 E:12 E:10 E:8 E:7 E:5 E:3 E:1');
  });
  it('допустимо только до 5-го или 12-го лада', () => {
    for (const fretMax of [0, 4, 7, 24]) expect(() => createExerciseSpec('string-naturals', { fretMax } as never), String(fretMax)).toThrow(RangeError);
  });
});

describe('хроматика по позициям (A7.2)', () => {
  it('ряд позиций «туда-обратно», крайние не повторяются; (2n−2)·16 нот', () => {
    for (const [positions, rows] of [[2, [5, 6]], [3, [5, 6, 7, 6]], [4, [5, 6, 7, 8, 7, 6]], [5, [5, 6, 7, 8, 9, 8, 7, 6]]] as const) {
      const plan = buildExercise(createExerciseSpec('chromatic-shift', { positions }));
      expect(plan.notes, String(positions)).toHaveLength(rows.length * 16);
      expect(plan.segments.map(segment => Number(/Лады (\d+)/.exec(segment.label)![1]))).toEqual(rows);
    }
  });
  it('подписи сегментов: чётные — E → G, нечётные — G → E; стыки позиций ведут пальцы 4→4, 1→1', () => {
    const plan = buildExercise(createExerciseSpec('chromatic-shift'));
    expect(plan.segments.map(segment => segment.label)).toEqual(['Лады 5–8 · E → G', 'Лады 6–9 · G → E', 'Лады 7–10 · E → G', 'Лады 6–9 · G → E']);
    const at = (index: number) => `${plan.notes[index].id}(${plan.notes[index].finger})`;
    // G:8 (4) → G:9 (4); E:6 (1) → E:7 (1); G:10 (4) → G:9 (4); при повторе E:6 (1) → E:5 (1).
    expect([at(15), at(16)]).toEqual(['G:8(4)', 'G:9(4)']);
    expect([at(31), at(32)]).toEqual(['E:6(1)', 'E:7(1)']);
    expect([at(47), at(48)]).toEqual(['G:10(4)', 'G:9(4)']);
    expect([at(63), at(0)]).toEqual(['E:6(1)', 'E:5(1)']);
  });
  it('граница: начало плюс число позиций плюс 2 не дальше 16-го лада; configureSpec подстраивает число позиций', () => {
    expect(() => createExerciseSpec('chromatic-shift', { startFret: 12, positions: 5 })).toThrow(RangeError);
    expect(() => createExerciseSpec('chromatic-shift', { startFret: 10, positions: 5 })).toThrow(RangeError);
    expect(() => createExerciseSpec('chromatic-shift', { startFret: 9, positions: 5 })).not.toThrow();
    expect(configureSpec(createExerciseSpec('chromatic-shift', { startFret: 5, positions: 5 }), 'startFret', 12).params).toMatchObject({ startFret: 12, positions: 2 });
  });
});

/* ---------- Позиции последовательности: нижняя и открытые струны (R-028, B0.1) ---------- */

describe('позиции последовательности low и open', () => {
  const run = (params: Record<string, unknown>) => buildExercise(createExerciseSpec('progression', params as never));
  const tonics = (plan: ReturnType<typeof run>) => plan.segments.map((_, bar) => plan.notes.find(note => note.segment === bar)!.id);
  const bar = (plan: ReturnType<typeof run>, index: number) => plan.notes.filter(note => note.segment === index);

  it('нижняя: C, I–IV–V, тоники — 1-й лад и открытые струны разрешены (A:3, E:1, E:3, A:3)', () => {
    const plan = run({ root: 'C', position: 'low' });
    expect(tonics(plan)).toEqual(['A:3', 'E:1', 'E:3', 'A:3']);
    expect(bar(plan, 1).map(note => note.name)).toEqual(Array(8).fill('F1'));
  });
  it('нижняя: A, I–IV–V — A:0, A:5, E:0, A:0; открытая струна без пальца', () => {
    const plan = run({ root: 'A', position: 'low' });
    expect(tonics(plan)).toEqual(['A:0', 'A:5', 'E:0', 'A:0']);
    expect(bar(plan, 0).map(note => note.finger)).toEqual(Array(8).fill(null));
    expect(bar(plan, 1).map(note => note.finger)).toEqual(Array(8).fill(2));
  });
  it('нижняя, арпеджио, такт F: E:1 A:0 A:3 A:0, повтор; пальцы 2, —, 4, —', () => {
    const plan = run({ root: 'C', pattern: 'arpeggio', position: 'low' });
    const f = bar(plan, 1);
    expect(f.map(note => note.id).join(' ')).toBe('E:1 A:0 A:3 A:0 E:1 A:0 A:3 A:0');
    expect(f.map(note => note.finger ?? '-').join(' ')).toBe('2 - 4 - 2 - 4 -');
    expect(f.map(note => note.degree).join(' ')).toBe('1 3 5 3 1 3 5 3');
  });
  it('нижняя, арпеджио, аккорд E: терция на ладу −1 невозможна, берётся A:7 — D:6, D:9', () => {
    const plan = run({ root: 'A', pattern: 'arpeggio', position: 'low' });
    const e = bar(plan, 2);
    expect(e.map(note => note.id).join(' ')).toBe('A:7 D:6 D:9 D:6 A:7 D:6 D:9 D:6');
    expect(e.map(note => note.finger).join(' ')).toBe('2 1 4 1 2 1 4 1');
    expect(e.map(note => note.name).slice(0, 4)).toEqual(['E2', 'G♯2', 'B2', 'G♯2']);
  });
  it('нижняя, подход: на лад ниже следующей тоники на её струне, лад 0 допустим', () => {
    const plan = run({ root: 'C', pattern: 'approach', position: 'low' });
    expect([0, 1, 2, 3].map(index => bar(plan, index)[7].id)).toEqual(['E:0', 'E:2', 'A:2', 'A:2']);
    expect(bar(plan, 0)[7]).toMatchObject({ finger: null, degree: null });
  });
  it('открытые струны: A и D по I–IV–V, блюз в A; палец не назначается', () => {
    expect(tonics(run({ root: 'A', position: 'open' }))).toEqual(['A:0', 'D:0', 'E:0', 'A:0']);
    expect(tonics(run({ root: 'D', position: 'open' }))).toEqual(['D:0', 'G:0', 'A:0', 'D:0']);
    const blues = run({ root: 'A', progression: 'blues-12', position: 'open' });
    expect(tonics(blues)).toEqual(['A:0', 'A:0', 'A:0', 'A:0', 'D:0', 'D:0', 'A:0', 'A:0', 'E:0', 'D:0', 'A:0', 'E:0']);
    expect(blues.notes.every(note => note.finger === null)).toBe(true);
    expect(blues.segments.map(segment => segment.label).slice(0, 5)).toEqual(['A7 · I7', 'A7 · I7', 'A7 · I7', 'A7 · I7', 'D7 · IV7']);
  });
  it('открытые струны: только тоники по I–IV–V и блюзу; тональность без открытой струны аккорда отклоняется', () => {
    expect(() => run({ root: 'A', pattern: 'root-fifth', position: 'open' })).toThrow(RangeError);
    expect(() => run({ root: 'C', progression: 'ii-V-I', position: 'open' })).toThrow(RangeError);
    for (const root of ['C', 'G', 'E', 'F']) expect(() => run({ root, position: 'open' }), root).toThrow(RangeError);
  });
  it('ритм работает на новых позициях: форма Q и форма E', () => {
    const plan = run({ root: 'A', pattern: 'root-fifth', position: 'low' });
    const quarters = buildTimeline(plan, { pattern: 'quarters' }).steps.filter(step => step.bar === 1).map(step => plan.notes[step.note!].id);
    expect(quarters).toEqual(['A:5', 'D:7', 'A:5', 'D:7']);
  });
  it('«Настроить»: недопустимая позиция уступает, выбранный параметр не меняется; подпись называет позицию', async () => {
    const open = createExerciseSpec('progression', { root: 'A', progression: 'blues-12', position: 'open' });
    expect(configureSpec(open, 'pattern', 'arpeggio').params).toMatchObject({ pattern: 'arpeggio', position: 'closed', progression: 'blues-12' });
    expect(templateOptions('progression').map(option => option.param)).toEqual(['root', 'progression', 'pattern', 'position']);
    const { materialLabel } = await import('../src/ui/lesson/material');
    expect(materialLabel(open)).toBe('A · блюз 12 тактов · тоники · открытые струны');
    expect(materialLabel(createExerciseSpec('progression', { position: 'low' }))).toBe('C · I–IV–V · тоники · нижняя');
    expect(materialLabel(createExerciseSpec('progression'))).toBe('C · I–IV–V · тоники');
  });
});

describe('рифф «Рок-восьмые» (R-028, B4)', () => {
  it('идентификатор материала, категория, тональность A (тоники E:5, A:5, A:7, E:5)', async () => {
    const { materialId } = await import('../src/practice/material');
    expect(materialId(createExerciseSpec('riff'))).toBe('riff.rock-eighths.G');
    const plan = buildExercise(createExerciseSpec('riff', { root: 'A' }));
    expect(plan).toMatchObject({ category: 'riffs', cadence: 'none', overlap: 'none', title: 'Рифф «Рок-восьмые»' });
    expect(plan.notes.slice(0, 8).map(note => note.id)).toEqual([...Array(6).fill('E:5'), 'A:7', 'A:7']);
    expect(plan.segments.map(segment => segment.label)).toEqual(['A · I', 'D · IV', 'E · V', 'A · I']);
  });
  it('параметры строгие: неизвестный рифф и лишние поля отклоняются', () => {
    expect(() => createExerciseSpec('riff', { riff: 'unknown' as never })).toThrow(RangeError);
    expect(() => validateExerciseSpec({ version: 'exercise-v1', templateId: 'riff', params: { riff: 'rock-eighths', root: 'G', position: 'low' } })).toThrow(RangeError);
  });
});
