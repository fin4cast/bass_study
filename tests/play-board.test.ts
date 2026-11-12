import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec, type ExercisePlan } from '../src/exercises';
import { boardNotesFromPlan, fretWindow, planFretWindow, renderBoard } from '../src/ui/play/board';

/** Контрольный пример EX-1 из карточки VIS-11 (набран вручную, R-014): связка форм A → B пентатоники Am. */
const EX1_ORDER = ['E:5', 'E:8', 'A:5', 'A:7', 'D:5', 'D:7', 'G:5', 'G:7', 'G:9', 'G:7', 'D:10', 'D:7', 'A:10', 'A:7', 'E:10', 'E:8'];
const EX1_SHARED = ['E:8', 'A:7', 'D:7', 'G:7'];
const ex1 = () => buildExercise(createExerciseSpec('connect-forms'));

/** Группа маркера позиции в SVG. */
function noteGroup(svg: string, id: string): string {
  const match = new RegExp(`<g class="([^"]*)" data-position="${id}">(.*?)</g>`).exec(svg);
  if (!match) throw new Error(`Позиция ${id} не нарисована`);
  return `${match[1]}|${match[2]}`;
}

describe('ноты доски из плана', () => {
  it('EX-1: каждая позиция один раз, общие позиции двух сегментов — сиреневые', () => {
    const plan = ex1();
    expect(plan.notes.map(note => note.id)).toEqual(EX1_ORDER);
    const notes = boardNotesFromPlan(plan);
    expect(notes).toHaveLength(12);
    expect(notes.filter(note => note.kind === 'shared').map(note => note.id).sort()).toEqual([...EX1_SHARED].sort());
    const kind = (id: string) => notes.find(note => note.id === id)!.kind;
    expect(kind('E:5')).toBe('root');
    expect(kind('A:5')).toBe('a');
    expect(kind('G:5')).toBe('a');
    expect(kind('G:9')).toBe('b');
    expect(kind('D:10')).toBe('b');
  });

  it('тоника на общей позиции остаётся общей и помечается флагом кольца', () => {
    const d7 = boardNotesFromPlan(ex1()).find(note => note.id === 'D:7')!;
    expect(d7).toMatchObject({ kind: 'shared', root: true, label: 'A', segments: [0, 1] });
  });

  it('подписи: ноты без октавы, ступени со знаком ♭', () => {
    const names = boardNotesFromPlan(ex1(), { labels: 'name' });
    const degrees = boardNotesFromPlan(ex1(), { labels: 'degree' });
    const label = (list: typeof names, id: string) => list.find(note => note.id === id)!.label;
    expect(label(names, 'E:5')).toBe('A');
    expect(label(names, 'G:9')).toBe('E');
    expect(label(degrees, 'E:8')).toBe('♭3');
    expect(label(degrees, 'A:5')).toBe('4');
    expect(label(degrees, 'D:5')).toBe('♭7');
    expect(boardNotesFromPlan(ex1(), { labels: 'none' }).every(note => note.label === '')).toBe(true);
  });

  it('пальцы берутся из формы, которую сейчас играют', () => {
    const fingerOf = (segment: number, id: string) => boardNotesFromPlan(ex1(), { labels: 'finger', segment }).find(note => note.id === id)!.label;
    expect(fingerOf(0, 'G:7')).toBe('3');
    expect(fingerOf(1, 'G:7')).toBe('1');
    expect(fingerOf(1, 'G:9')).toBe('3');
    // Позиции нет в текущем сегменте — палец из её собственной формы.
    expect(fingerOf(1, 'E:5')).toBe('1');
  });

  it('ступени зависят от сегмента: одни позиции — разные тоники', () => {
    const plan = buildExercise(createExerciseSpec('pentatonic-relative'));
    const majorRoot = boardNotesFromPlan(plan, { labels: 'degree', segment: 0 }).filter(note => note.root).map(note => note.label);
    const minorRoot = boardNotesFromPlan(plan, { labels: 'name', segment: 1 }).filter(note => note.root).map(note => note.label);
    expect(new Set(majorRoot)).toEqual(new Set(['1']));
    expect(new Set(minorRoot)).toEqual(new Set(['A']));
    const majorNames = boardNotesFromPlan(plan, { labels: 'name', segment: 0 }).filter(note => note.root).map(note => note.label);
    expect(new Set(majorNames)).toEqual(new Set(['C']));
  });

  it('растяжка переносится из плана', () => {
    const plans: ExercisePlan[] = [1, 2, 3, 4, 5, 6, 7].map(degree => buildExercise(createExerciseSpec('scale-position', { degree })));
    const withStretch = plans.find(plan => plan.notes.some(note => note.stretch));
    expect(withStretch).toBeDefined();
    const stretched = withStretch!.notes.find(note => note.stretch)!;
    const board = boardNotesFromPlan(withStretch!, { segment: stretched.segment });
    expect(board.find(note => note.id === stretched.id)!.stretch).toBe(true);
    const svg = renderBoard({ notes: board, ...planFretWindow(withStretch!) });
    expect(noteGroup(svg, stretched.id)).toMatch(/is-stretch.*↔/);
    expect(noteGroup(svg, stretched.id)).toContain('растяжка');
  });
});

describe('окно ладов', () => {
  it('EX-1: 3–12 с запасом 2 и 4–11 с запасом 1', () => {
    expect(planFretWindow(ex1(), { pad: 2 })).toEqual({ fretMin: 3, fretMax: 12 });
    expect(planFretWindow(ex1(), { pad: 1 })).toEqual({ fretMin: 4, fretMax: 11 });
  });
  it('не уже 6 ладов и в пределах 0–24', () => {
    expect(fretWindow([0, 1])).toEqual({ fretMin: 0, fretMax: 5 });
    expect(fretWindow([24])).toEqual({ fretMin: 19, fretMax: 24 });
    expect(fretWindow([7])).toEqual({ fretMin: 5, fretMax: 10 });
    expect(fretWindow([0, 24], { pad: 3 })).toEqual({ fretMin: 0, fretMax: 24 });
  });
  it('весь гриф для пентатоники по всему грифу помещается в окно', () => {
    const plan = buildExercise(createExerciseSpec('pentatonic-neck'));
    const window = planFretWindow(plan);
    expect(Math.min(...plan.notes.map(note => note.fret))).toBeGreaterThanOrEqual(window.fretMin);
    expect(Math.max(...plan.notes.map(note => note.fret))).toBeLessThanOrEqual(window.fretMax);
  });
});

describe('SVG-гриф', () => {
  const svgFor = (current: string | null, next: string | null, segment = 0) =>
    renderBoard({ notes: boardNotesFromPlan(ex1(), { segment }), fretMin: 3, fretMax: 12, current, next });

  it('строки G-D-A-E сверху вниз и номера ладов окна', () => {
    const svg = svgFor(null, 'E:5');
    const strings = [...svg.matchAll(/class="pl-string-name" x="12" y="([\d.]+)">([GDAE])</g)].map(match => [match[2], Number(match[1])] as const);
    expect(strings.map(([name]) => name)).toEqual(['G', 'D', 'A', 'E']);
    expect(strings.map(([, y]) => y)).toEqual([...strings.map(([, y]) => y)].sort((a, b) => a - b));
    expect([...svg.matchAll(/class="pl-fret-number"[^>]*>(\d+)</g)].map(match => Number(match[1]))).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(svg).toContain('aria-label="Гриф, лады 3–12; дальше E/5"');
  });

  it('одна текущая нота с белым кольцом и одна следующая с пунктиром', () => {
    const svg = svgFor('D:7', 'G:5');
    expect(svg.match(/is-current/g)).toHaveLength(1);
    expect(svg.match(/is-next/g)).toHaveLength(1);
    expect(noteGroup(svg, 'D:7')).toMatch(/is-current.*pl-current-ring.*pl-dot.*pl-root-ring/);
    expect(noteGroup(svg, 'G:5')).toMatch(/is-next.*pl-next-ring/);
    expect(noteGroup(svg, 'E:5')).not.toContain('pl-root-ring');
    expect(svg.match(/pl-root-ring/g)).toHaveLength(1);
  });

  it('позиции вне окна не рисуются, подписи экранируются', () => {
    const svg = renderBoard({ notes: [{ id: 'E:2', string: 'E', fret: 2, label: '<x>', kind: 'a', root: false, finger: null, stretch: false, segments: [0] },
      { id: 'A:5', string: 'A', fret: 5, label: '<b>', kind: 'a', root: false, finger: null, stretch: false, segments: [0] }], fretMin: 3, fretMax: 8 });
    expect(svg).not.toContain('data-position="E:2"');
    expect(svg).toContain('&lt;b&gt;');
    expect(svg).not.toContain('<b>');
  });

  it('открытая струна: при окне от 0 рисуется порожек', () => {
    const svg = renderBoard({ notes: [], fretMin: 0, fretMax: 5 });
    expect(svg.match(/class="pl-nut"/g)).toHaveLength(1);
  });
});
