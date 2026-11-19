import { describe, expect, it } from 'vitest';
import { buildExercise } from '../src/exercises';
import { rhythmPatternsFor } from '../src/exercises/rhythm';
import { checkSeries } from '../src/practice/check-series';
import { materialId } from '../src/practice/material';
import { composeDay, evaluateProgram, lineCountsLabel, stepRefs, type ProgramFacts } from '../src/practice/program';
import { PROGRAM } from '../src/practice/program-data';
import { programOverview } from '../src/ui/progress/model';
import { pathModel, stageTransitions } from '../src/ui/lesson/path';

/**
 * Данные этапа 4 против таблицы R-028 «Этап 4. Весь гриф». Блоки, шаги и числа вариантов выписаны из таблицы независимо
 * от `program-data.ts`; порядок вариантов — тоника снаружи, вторая ось внутри; позиция не названа — нижняя, затем закрытая.
 */
const STAGE_4: readonly (readonly [string, string, string, number])[] = [
  ['f4-neck', 'f4-neck.forms', 'play', 6], ['f4-neck', 'f4-neck.links', 'play', 8], ['f4-neck', 'f4-neck.neck', 'play', 3], ['f4-neck', 'f4-neck.find-degree', 'check', 0],
  ['f4-positions', 'f4-positions.position', 'play', 9], ['f4-positions', 'f4-positions.string', 'play', 3], ['f4-positions', 'f4-positions.name-degree', 'check', 0],
  ['f4-intervals', 'f4-intervals.seconds', 'play', 4], ['f4-intervals', 'f4-intervals.sixths', 'play', 4], ['f4-intervals', 'f4-intervals.sevenths', 'play', 4], ['f4-intervals', 'f4-intervals.find-degree', 'check', 0],
  ['f4-sequences', 'f4-sequences.groups', 'play', 2], ['f4-sequences', 'f4-sequences.transpose', 'play', 1], ['f4-sequences', 'f4-sequences.cycle', 'play', 3],
  ['h4-seventh', 'h4-seventh.arpeggio', 'play', 12], ['h4-seventh', 'h4-seventh.inversions', 'play', 6], ['h4-seventh', 'h4-seventh.riff', 'play', 2], ['h4-seventh', 'h4-seventh.name-degree', 'check', 0],
  ['h4-iivi', 'h4-iivi.roots', 'play', 6], ['h4-iivi', 'h4-iivi.arpeggio', 'play', 6], ['h4-iivi', 'h4-iivi.approach', 'play', 6],
  ['h4-walking', 'h4-walking.iivi', 'play', 6], ['h4-walking', 'h4-walking.blues', 'play', 6],
  ['h4-line', 'h4-line.riff', 'play', 2], ['h4-line', 'h4-line.own', 'line', 0], ['h4-line', 'h4-line.song', 'song', 0],
];

describe('данные этапа 4 по таблице R-028', () => {
  const refs = stepRefs(PROGRAM);
  const stage = refs.filter(ref => PROGRAM.stages[3].blocks.some(block => block.id === ref.block.id));
  const stepOf = (id: string) => refs.find(ref => ref.step.id === id)!.step;
  const variants = (id: string) => { const step = stepOf(id); return step.kind === 'play' ? step.variants.map(materialId) : []; };
  const checkOf = (id: string) => { const step = stepOf(id); return step.kind === 'check' ? step.check : null; };
  const lowThenClosed = (roots: string[], progression: string, pattern: string) =>
    ['low', 'closed'].flatMap(position => roots.map(root => `progression.${root}.${progression}.${pattern}.${position}`));

  it('этап 4 идёт четвёртым, этапы 1–3 не тронуты', () => {
    expect(PROGRAM.stages.map(item => item.number)).toEqual([1, 2, 3, 4]);
    expect(PROGRAM.stages[3].title).toBe('Весь гриф');
  });
  it('блоки и шаги по порядку таблицы, число вариантов каждого шага', () => {
    expect(stage.map(ref => [ref.block.id, ref.step.id, ref.step.kind, ref.step.kind === 'play' ? ref.step.variants.length : 0])).toEqual(STAGE_4.map(row => [...row]));
  });
  it('у «Техники» этапа 4 блоков нет; блоки по линиям и карточки из таблицы', () => {
    const blocks = PROGRAM.stages[3].blocks;
    expect(blocks.filter(block => block.line === 'technique')).toEqual([]);
    expect(blocks.filter(block => block.line === 'fretboard').map(block => block.id)).toEqual(['f4-neck', 'f4-positions', 'f4-intervals', 'f4-sequences']);
    expect(blocks.filter(block => block.line === 'chords').map(block => block.id)).toEqual(['h4-seventh', 'h4-iivi', 'h4-walking', 'h4-line']);
    const block = (id: string) => blocks.find(item => item.id === id)!;
    expect(block('f4-intervals').cards).toEqual(['seconds', 'sixths', 'sevenths']);
    expect(block('h4-seventh').cards).toEqual(['seventh-chords', 'inversions']);
    for (const id of ['f4-neck', 'f4-positions', 'f4-sequences', 'h4-iivi', 'h4-walking', 'h4-line']) expect(block(id).cards, `у блока ${id} карточек нет`).toEqual([]);
  });
  it('пентатоника по грифу: формы C, D, E и связки по тоникам Am, затем Bm; по всему грифу Am, Bm, Gm', () => {
    expect(variants('f4-neck.forms')).toEqual(['A', 'B'].flatMap(root => ['penta-c', 'penta-d', 'penta-e'].map(shape => `pentatonic-form.${root}.minor-pentatonic.${shape}`)));
    expect(variants('f4-neck.links')).toEqual(['A', 'B'].flatMap(root => ['penta-b', 'penta-c', 'penta-d', 'penta-e'].map(shape => `connect-forms.${root}.minor-pentatonic.${shape}`)));
    expect(variants('f4-neck.neck')).toEqual(['A', 'B', 'G'].map(root => `pentatonic-neck.${root}.minor-pentatonic`));
  });
  it('позиции гамм: тональность снаружи, ступень внутри; гамма на струне — G на E, C на A, Am на A', () => {
    expect(variants('f4-positions.position')).toEqual([['C', 'major'], ['A', 'natural-minor'], ['G', 'major']].flatMap(([root, structure]) => [1, 2, 5].map(degree => `scale-position.${root}.${structure}.${degree}`)));
    expect(variants('f4-positions.string')).toEqual(['scale-one-string.G.major.E', 'scale-one-string.C.major.A', 'scale-one-string.A.natural-minor.A']);
  });
  it('интервалы от C: малая и большая вверх, затем малая и большая вниз; секвенции и перенос', () => {
    expect(variants('f4-intervals.seconds')).toEqual(['min2.up', 'maj2.up', 'min2.down', 'maj2.down'].map(text => `interval-from-note.C.${text}`));
    expect(variants('f4-intervals.sixths')).toEqual(['min6.up', 'maj6.up', 'min6.down', 'maj6.down'].map(text => `interval-from-note.C.${text}`));
    expect(variants('f4-intervals.sevenths')).toEqual(['min7.up', 'maj7.up', 'min7.down', 'maj7.down'].map(text => `interval-from-note.C.${text}`));
    expect(variants('f4-sequences.groups')).toEqual(['penta-b', 'penta-c'].map(shape => `groups-of-three.A.minor-pentatonic.${shape}.3`));
    expect(variants('f4-sequences.transpose')).toEqual(['form-transpose.minor-pentatonic.penta-a.A-D-E']);
    expect(variants('f4-sequences.cycle')).toEqual(['C', 'G', 'E'].map(root => `cycle-fourths.${root}.4`));
  });
  it('септаккорды: тоника снаружи, вид внутри (maj7, 7, m7, m7♭5); обращения 1-е и 2-е; рифф по кругу кварт', () => {
    expect(variants('h4-seventh.arpeggio')).toEqual(['C', 'G', 'A'].flatMap(root => ['major-seventh', 'dominant-seventh', 'minor-seventh', 'half-diminished-seventh'].map(kind => `arpeggio-seventh.${root}.${kind}.compact-e`)));
    expect(variants('h4-seventh.inversions')).toEqual(['C', 'G', 'D'].flatMap(root => [1, 2].map(inversion => `arpeggio-inversion.${root}.major-triad.${inversion}`)));
    expect(variants('h4-seventh.riff')).toEqual(['riff.fourths-cycle.C', 'riff.fourths-cycle.G']);
  });
  it('ii–V–I и шагающий бас в C, F, B♭: нижняя позиция, затем закрытая; блюз шагающим басом в F, B♭, G; рифф через три формы', () => {
    expect(variants('h4-iivi.roots')).toEqual(lowThenClosed(['C', 'F', 'Bb'], 'ii-V-I', 'roots'));
    expect(variants('h4-iivi.arpeggio')).toEqual(lowThenClosed(['C', 'F', 'Bb'], 'ii-V-I', 'arpeggio'));
    expect(variants('h4-iivi.approach')).toEqual(lowThenClosed(['C', 'F', 'Bb'], 'ii-V-I', 'approach'));
    expect(variants('h4-walking.iivi')).toEqual(lowThenClosed(['C', 'F', 'Bb'], 'ii-V-I', 'walking'));
    expect(variants('h4-walking.blues')).toEqual(lowThenClosed(['F', 'Bb', 'G'], 'blues-12', 'walking'));
    expect(variants('h4-line.riff')).toEqual(['riff.three-forms.A', 'riff.three-forms.B']);
  });
  it('«как играть»: четверти у интервалов, шагающего баса и арпеджио септаккордов; блюз шагающим басом — под подложку «шаффл»', () => {
    const how = (id: string) => { const step = stepOf(id); return step.kind === 'play' ? [step.practice.rhythm, step.practice.groove] : null; };
    for (const id of ['f4-intervals.seconds', 'f4-intervals.sixths', 'f4-intervals.sevenths', 'h4-walking.iivi', 'h4-seventh.arpeggio']) expect(how(id), id).toEqual(['quarters', null]);
    expect(how('h4-walking.blues')).toEqual(['quarters', 'shuffle']);
    for (const id of ['f4-neck.forms', 'f4-positions.position', 'f4-sequences.cycle', 'h4-iivi.approach', 'h4-line.riff']) expect(how(id), id).toEqual(['eighths', null]);
  });
  it('проверки по таблице A9.7: материал, ступени и предмет', () => {
    expect(checkOf('f4-neck.find-degree')).toMatchObject({ kind: 'find-degree', area: { type: 'exercise' }, subject: { type: 'degrees', scale: null, targets: null } });
    expect(checkOf('f4-positions.name-degree')).toMatchObject({ kind: 'name-degree', area: { type: 'exercise' }, subject: { scale: null, targets: null } });
    expect(checkOf('f4-intervals.find-degree')).toMatchObject({ kind: 'find-degree', subject: { scale: null, targets: ['2', '6', '7'] } });
    expect(checkOf('h4-seventh.name-degree')).toMatchObject({
      kind: 'name-degree', area: { type: 'range', strings: ['A', 'D', 'G'], fretMin: 2, fretMax: 5 }, subject: { scale: { root: 'C', degrees: ['1', '3', '5', 'b7', '7'] }, targets: ['b7', '7'] },
    });
    for (const [id, material] of [['f4-neck.find-degree', 'pentatonic-neck.A.minor-pentatonic'], ['f4-positions.name-degree', 'scale-position.C.major.2'], ['f4-intervals.find-degree', 'scale-compact.C.major.compact-a']] as const) {
      const check = checkOf(id)!;
      expect(check.area.type === 'exercise' && materialId(check.area.exercise), id).toBe(material);
    }
  });
  it('каждая проверка строит серию из шести вопросов; у «h4-seventh» пять вариантов ответа', () => {
    for (const ref of stage) if (ref.step.kind === 'check') expect(checkSeries(ref.step.check, 1).questions, ref.step.id).toHaveLength(6);
    expect(checkSeries(checkOf('h4-seventh.name-degree')!, 1).questions[0].choices).toHaveLength(5);
  });
  it('каждый вариант строится, а ритм шага допустим материалу', () => {
    for (const ref of stage) {
      if (ref.step.kind !== 'play') continue;
      for (const variant of ref.step.variants) expect(rhythmPatternsFor(buildExercise(variant)), `${ref.step.id}: ${materialId(variant)}`).toContain(ref.step.practice.rhythm);
    }
  });
  it('шаг «Своя линия» — правило h4-line; необязательная песня вне счёта', () => {
    const line = stepOf('h4-line.own');
    expect(line.kind === 'line' && line.rule).toBe('h4-line');
    expect(stepOf('h4-line.song').kind).toBe('song');
  });
});

describe('переход в этап 4 и «Сегодня»', () => {
  const earlier = PROGRAM.stages.slice(0, 3).flatMap(stage => stage.blocks.map(block => block.id));
  const facts = (over: Partial<ProgramFacts> = {}): ProgramFacts => ({ plays: [], checks: [], lines: [], skippedBlocks: new Set(), today: '2026-11-20', ...over });
  const stage3 = facts({ skippedBlocks: new Set(earlier) });

  it('после этапов 1–3 текущие шаги — у «Грифа» и «Аккордов и линий»; у «Техники» шага нет', () => {
    const current = evaluateProgram(PROGRAM, stage3).current;
    expect([current.technique?.step.id ?? null, current.fretboard?.step.id, current.chords?.step.id]).toEqual([null, 'f4-neck.forms', 'h4-seventh.arpeggio']);
  });
  it('«Сегодня» собирает занятие из двух шагов; место «Техники» отдано закреплению, а кандидатов нет', () => {
    const day = composeDay(PROGRAM, stage3);
    expect(day.items.map(item => item.step.id)).toEqual(['f4-neck.forms', 'h4-seventh.arpeggio']);
    expect(day.items.every(item => item.stage === 4)).toBe(true);
  });
  it('счётчики этапа 4 по таблице: 0 шагов техники, 14 — гриф, 11 — аккорды и линии; песни в счёт не входят', () => {
    const state = evaluateProgram(PROGRAM, facts());
    const table = STAGE_4.filter(row => row[2] !== 'song');
    expect(state.stageCounts.get(4)).toMatchObject({ total: table.length, passed: 0 });
    expect(['technique', 'fretboard', 'chords'].map(line => state.lineCounts.get(`4:${line}`)!.total)).toEqual([0, 14, 11]);
    expect(table).toHaveLength(25);
  });
  it('линия без шагов в «Основах» и в «Прогрессе»: «шагов нет — место отдаётся закреплению», она пройдена; сообщений о переходе — две', () => {
    const state = evaluateProgram(PROGRAM, stage3);
    const path = pathModel(PROGRAM, state, new Set(earlier), new Map())[3];
    expect(path.lines[0]).toMatchObject({ id: 'technique', blocks: [], counts: 'шагов нет — место отдаётся закреплению', done: true });
    const overview = programOverview(PROGRAM, state)[3];
    expect(overview.lines[0]).toMatchObject({ id: 'technique', steps: [], counts: 'шагов нет — место отдаётся закреплению' });
    expect(lineCountsLabel({ passed: 0, skipped: 0, mastered: 0, review: 0, total: 0 })).toBe('шагов нет — место отдаётся закреплению');
    const lines = stageTransitions(PROGRAM, state);
    expect(lines).toHaveLength(2);
    expect(lines.every(line => line.includes('теперь этап 4'))).toBe(true);
  });
});
