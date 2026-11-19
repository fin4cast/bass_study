import { describe, expect, it } from 'vitest';
import { checkSeries } from '../src/practice/check-series';
import { materialId } from '../src/practice/material';
import { PROGRAM } from '../src/practice/program-data';
import { composeDay, evaluateProgram, stepRefs, type ProgramFacts } from '../src/practice/program';
import { buildExercise } from '../src/exercises';
import { rhythmPatternsFor } from '../src/exercises/rhythm';

/**
 * Данные этапа 3 против таблицы R-028 «Этап 3. Тоны аккорда и свои линии». Блоки, шаги и числа вариантов выписаны из таблицы
 * независимо от `program-data.ts`; позиция последовательности не названа — тональность в нижней позиции, затем в закрытой.
 */
const STAGE_3: readonly (readonly [string, string, string, number])[] = [
  ['t3-sixteenths', 't3-sixteenths.pulse', 'play', 3], ['t3-sixteenths', 't3-sixteenths.chromatic', 'play', 2],
  ['t3-spider', 't3-spider.1432', 'play', 2], ['t3-spider', 't3-spider.permutations', 'play', 2], ['t3-spider', 't3-spider.neck', 'play', 2], ['t3-spider', 't3-spider.pairs', 'play', 2],
  ['f3-major', 'f3-major.scale', 'play', 3], ['f3-major', 'f3-major.thirds', 'play', 3], ['f3-major', 'f3-major.groups', 'play', 3], ['f3-major', 'f3-major.name-degree', 'check', 0],
  ['f3-minor', 'f3-minor.scale', 'play', 3], ['f3-minor', 'f3-minor.relative', 'play', 2], ['f3-minor', 'f3-minor.groups', 'play', 3], ['f3-minor', 'f3-minor.name-degree', 'check', 0],
  ['f3-penta', 'f3-penta.form-b', 'play', 3], ['f3-penta', 'f3-penta.link', 'play', 3], ['f3-penta', 'f3-penta.major', 'play', 2], ['f3-penta', 'f3-penta.find-degree', 'check', 0],
  ['h3-minor', 'h3-minor.i-iv', 'play', 6], ['h3-minor', 'h3-minor.i-v-i', 'play', 6], ['h3-minor', 'h3-minor.i-vii-vi-v', 'play', 6], ['h3-minor', 'h3-minor.arpeggio', 'play', 6],
  ['h3-diatonic', 'h3-diatonic.diatonic', 'play', 4], ['h3-diatonic', 'h3-diatonic.pop1', 'play', 6], ['h3-diatonic', 'h3-diatonic.pop2', 'play', 6], ['h3-diatonic', 'h3-diatonic.roman-root', 'check', 0],
  ['h3-passing', 'h3-passing.i-iv-v', 'play', 6], ['h3-passing', 'h3-passing.pop1', 'play', 6],
  ['h3-blues', 'h3-blues.scale', 'play', 3], ['h3-blues', 'h3-blues.arpeggio7', 'play', 3], ['h3-blues', 'h3-blues.arpeggio12', 'play', 6], ['h3-blues', 'h3-blues.boogie', 'play', 6],
  ['h3-blues', 'h3-blues.riff', 'play', 3], ['h3-blues', 'h3-blues.name-degree', 'check', 0],
  ['h3-line', 'h3-line.riff', 'play', 2], ['h3-line', 'h3-line.own', 'line', 0], ['h3-line', 'h3-line.song', 'song', 0],
];

describe('данные этапа 3 по таблице R-028', () => {
  const refs = stepRefs(PROGRAM);
  const stage = refs.filter(ref => PROGRAM.stages[2].blocks.some(block => block.id === ref.block.id));
  const stepOf = (id: string) => refs.find(ref => ref.step.id === id)!.step;
  const variants = (id: string) => { const step = stepOf(id); return step.kind === 'play' ? step.variants.map(materialId) : []; };
  const checkOf = (id: string) => { const step = stepOf(id); return step.kind === 'check' ? step.check : null; };
  const lowThenClosed = (roots: string[], progression: string, pattern: string) =>
    ['low', 'closed'].flatMap(position => roots.map(root => `progression.${root}.${progression}.${pattern}.${position}`));

  it('этап 3 идёт третьим, этапы 1 и 2 не тронуты', () => {
    expect(PROGRAM.stages.map(item => item.number).slice(0, 3)).toEqual([1, 2, 3]);
    expect(PROGRAM.stages[2].title).toBe('Тоны аккорда и свои линии');
  });
  it('блоки и шаги по порядку таблицы, число вариантов каждого шага', () => {
    expect(stage.map(ref => [ref.block.id, ref.step.id, ref.step.kind, ref.step.kind === 'play' ? ref.step.variants.length : 0])).toEqual(STAGE_3.map(row => [...row]));
  });
  it('блоки по линиям и карточки блоков из таблицы', () => {
    const block = (id: string) => PROGRAM.stages[2].blocks.find(item => item.id === id)!;
    expect(['t3-sixteenths', 't3-spider'].map(id => block(id).line)).toEqual(['technique', 'technique']);
    expect(['f3-major', 'f3-minor', 'f3-penta'].map(id => block(id).line)).toEqual(Array(3).fill('fretboard'));
    expect(['h3-minor', 'h3-diatonic', 'h3-passing', 'h3-blues', 'h3-line'].map(id => block(id).line)).toEqual(Array(5).fill('chords'));
    expect(block('f3-major').cards).toEqual(['major-formula']);
    expect(block('f3-minor').cards).toEqual(['natural-minor', 'relative-keys']);
    expect(block('h3-diatonic').cards).toEqual(['triad']);
    expect(block('h3-blues').cards).toEqual(['blues-scale']);
    expect(block('t3-spider').cards).toEqual(['finger-independence']);
    for (const id of ['t3-sixteenths', 'f3-penta', 'h3-minor', 'h3-passing', 'h3-line']) expect(block(id).cards, `у блока ${id} карточек нет`).toEqual([]);
  });
  it('техника: пульс шестнадцатыми на открытых E, A и E/5; паук 1-4-3-2 с 5-го и 7-го лада; паук по всему грифу с 1-го лада на 12 позиций', () => {
    expect(variants('t3-sixteenths.pulse')).toEqual(['pulse-note.E.0.32', 'pulse-note.A.0.32', 'pulse-note.E.5.32']);
    expect(variants('t3-sixteenths.chromatic')).toEqual(['chromatic-position.5.1234.up', 'chromatic-position.7.1234.up']);
    expect(variants('t3-spider.1432')).toEqual(['spider.5.5.1432.straight', 'spider.7.5.1432.straight']);
    expect(variants('t3-spider.neck')).toEqual(['spider.1.12.1234.straight', 'spider.1.12.1324.straight']);
    expect(variants('t3-spider.permutations')).toEqual(['spider.5.5.2413.straight', 'spider.5.5.3142.straight']);
    expect(variants('t3-spider.pairs')).toEqual(['finger-pairs.5.13', 'finger-pairs.5.24']);
    expect(variants('f3-major.groups')).toEqual(['groups-of-three.C.major.compact-e.3', 'groups-of-three.G.major.compact-e.3', 'groups-of-three.D.major.compact-a.3']);
    expect(variants('f3-minor.groups')).toEqual(['groups-of-three.A.natural-minor.compact-e.3', 'groups-of-three.B.natural-minor.compact-e.3', 'groups-of-three.D.natural-minor.compact-a.3']);
  });
  it('гриф: гаммы C и G от струны E, D от струны A; минор Am, Bm от E, Dm от A; формы B, связки A→B, мажорная форма A', () => {
    expect(variants('f3-major.scale')).toEqual(['scale-compact.C.major.compact-e', 'scale-compact.G.major.compact-e', 'scale-compact.D.major.compact-a']);
    expect(variants('f3-major.thirds')).toEqual(['thirds.C.major.compact-e', 'thirds.G.major.compact-e', 'thirds.D.major.compact-a']);
    expect(variants('f3-minor.scale')).toEqual(['scale-compact.A.natural-minor.compact-e', 'scale-compact.B.natural-minor.compact-e', 'scale-compact.D.natural-minor.compact-a']);
    expect(variants('f3-minor.relative')).toEqual(['pentatonic-relative.A.penta-a', 'pentatonic-relative.B.penta-a']);
    expect(variants('f3-penta.form-b')).toEqual(['A', 'B', 'G'].map(root => `pentatonic-form.${root}.minor-pentatonic.penta-b`));
    expect(variants('f3-penta.link')).toEqual(['A', 'B', 'G'].map(root => `connect-forms.${root}.minor-pentatonic.penta-a`));
    expect(variants('f3-penta.major')).toEqual(['C', 'D'].map(root => `pentatonic-form.${root}.major-pentatonic.penta-a`));
  });
  it('последовательности: нижняя позиция, затем закрытая; «Трезвучия по ступеням» в C и G', () => {
    expect(variants('h3-minor.i-iv')).toEqual(lowThenClosed(['A', 'E', 'D'], 'i-iv', 'roots'));
    expect(variants('h3-minor.i-v-i')).toEqual(lowThenClosed(['A', 'E', 'D'], 'i-V-i', 'roots'));
    expect(variants('h3-minor.i-vii-vi-v')).toEqual(lowThenClosed(['A', 'E', 'D'], 'i-VII-VI-V', 'roots'));
    expect(variants('h3-minor.arpeggio')).toEqual(lowThenClosed(['A', 'E', 'D'], 'i-iv', 'arpeggio'));
    expect(variants('h3-diatonic.diatonic')).toEqual(lowThenClosed(['C', 'G'], 'diatonic', 'arpeggio'));
    expect(variants('h3-diatonic.pop1')).toEqual(lowThenClosed(['C', 'G', 'D'], 'I-V-vi-IV', 'arpeggio'));
    expect(variants('h3-diatonic.pop2')).toEqual(lowThenClosed(['C', 'G', 'D'], 'I-vi-IV-V', 'arpeggio'));
    expect(variants('h3-passing.i-iv-v')).toEqual(lowThenClosed(['C', 'G', 'A'], 'I-IV-V', 'roots-passing'));
    expect(variants('h3-passing.pop1')).toEqual(lowThenClosed(['C', 'G', 'D'], 'I-V-vi-IV', 'roots-passing'));
  });
  it('блюз 2: гамма и арпеджио септаккорда в A, G, B; 12 тактов в A, E, G; рифф «буги»; рифф с переходом A→B в Am, Bm', () => {
    expect(variants('h3-blues.scale')).toEqual(['A', 'G', 'B'].map(root => `blues-scale.${root}.compact-e`));
    expect(variants('h3-blues.arpeggio7')).toEqual(['A', 'G', 'B'].map(root => `arpeggio-seventh.${root}.dominant-seventh.compact-e`));
    expect(variants('h3-blues.arpeggio12')).toEqual(lowThenClosed(['A', 'E', 'G'], 'blues-12', 'arpeggio'));
    expect(variants('h3-blues.boogie')).toEqual(lowThenClosed(['A', 'E', 'G'], 'blues-12', 'boogie'));
    expect(variants('h3-blues.riff')).toEqual(['A', 'E', 'G'].map(root => `riff.boogie-12.${root}`));
    expect(variants('h3-line.riff')).toEqual(['A', 'B'].map(root => `riff.shift-ab.${root}`));
  });
  it('«как играть»: шестнадцатые у техники, шаффл у арпеджио блюза; остальное — восьмые без подложки', () => {
    const how = (id: string) => { const step = stepOf(id); return step.kind === 'play' ? [step.practice.rhythm, step.practice.groove] : null; };
    expect(how('t3-sixteenths.pulse')).toEqual(['sixteenths', null]);
    expect(how('t3-sixteenths.chromatic')).toEqual(['sixteenths', null]);
    expect(how('h3-blues.arpeggio12')).toEqual(['shuffle', null]);
    for (const id of ['t3-spider.1432', 'f3-major.scale', 'h3-minor.i-iv', 'h3-passing.pop1', 'h3-blues.boogie', 'h3-blues.riff', 'h3-line.riff']) expect(how(id), id).toEqual(['eighths', null]);
  });
  it('проверки по таблице A9.7: материал, ступени и предмет', () => {
    expect(checkOf('f3-major.name-degree')).toMatchObject({ kind: 'name-degree', area: { type: 'exercise' }, subject: { type: 'degrees', scale: null, targets: null } });
    expect(checkOf('f3-minor.name-degree')).toMatchObject({ kind: 'name-degree', subject: { type: 'degrees', scale: null, targets: ['b3', 'b6', 'b7'] } });
    expect(checkOf('f3-penta.find-degree')).toMatchObject({ kind: 'find-degree', area: { type: 'exercise' }, subject: { targets: null } });
    expect(checkOf('h3-diatonic.roman-root')).toMatchObject({ kind: 'find-note', area: { type: 'range', strings: ['E', 'A'], fretMin: 0, fretMax: 12 }, subject: { type: 'roman-root', key: 'C' } });
    expect(checkOf('h3-blues.name-degree')).toMatchObject({ kind: 'name-degree', area: { type: 'exercise' }, subject: { targets: null } });
    for (const [id, material] of [['f3-major.name-degree', 'scale-compact.C.major.compact-e'], ['f3-minor.name-degree', 'scale-compact.A.natural-minor.compact-e'],
      ['f3-penta.find-degree', 'pentatonic-form.A.minor-pentatonic.penta-b'], ['h3-blues.name-degree', 'blues-scale.A.compact-e']] as const) {
      const check = checkOf(id)!;
      expect(check.area.type === 'exercise' && materialId(check.area.exercise), id).toBe(material);
    }
  });
  it('каждая проверка строит серию из шести вопросов', () => {
    for (const ref of stage) if (ref.step.kind === 'check') expect(checkSeries(ref.step.check, 1).questions, ref.step.id).toHaveLength(6);
  });
  it('каждый вариант строится, а ритм шага допустим материалу', () => {
    for (const ref of stage) {
      if (ref.step.kind !== 'play') continue;
      for (const variant of ref.step.variants) {
        const plan = buildExercise(variant);
        expect(rhythmPatternsFor(plan), `${ref.step.id}: ${materialId(variant)}`).toContain(ref.step.practice.rhythm);
      }
    }
  });
  it('шаг «Своя линия» — правило h3-line; необязательная песня вне счёта', () => {
    const line = stepOf('h3-line.own');
    expect(line.kind === 'line' && line.rule).toBe('h3-line');
    expect(stepOf('h3-line.song').kind).toBe('song');
  });
});

describe('переход между этапами и «Сегодня» (этап 3)', () => {
  const earlier = PROGRAM.stages.slice(0, 2).flatMap(stage => stage.blocks.map(block => block.id));
  const facts = (over: Partial<ProgramFacts> = {}): ProgramFacts => ({ plays: [], checks: [], lines: [], skippedBlocks: new Set(), today: '2026-11-20', ...over });
  const currentIds = (input: ProgramFacts) => Object.values(evaluateProgram(PROGRAM, input).current).map(ref => ref?.step.id ?? null);

  it('пройденные этапы 1 и 2 (здесь отмеченные «Уже умею») открывают первые шаги этапа 3 в трёх линиях', () => {
    expect(currentIds(facts({ skippedBlocks: new Set(earlier) }))).toEqual(['t3-sixteenths.pulse', 'f3-major.scale', 'h3-minor.i-iv']);
  });
  it('«Сегодня» собирает занятие из шагов этапа 3 с их «как играть»', () => {
    const day = composeDay(PROGRAM, facts({ skippedBlocks: new Set(earlier) }));
    expect(day.items.filter(item => item.reason === 'current').map(item => item.step.id)).toEqual(['t3-sixteenths.pulse', 'f3-major.scale', 'h3-minor.i-iv']);
    expect(day.items.every(item => item.stage === 3)).toBe(true);
    const pulse = day.items[0].step;
    expect(pulse.kind === 'play' && pulse.practice.rhythm).toBe('sixteenths');
  });
  it('счётчики этапа 3 по таблице: 6 шагов техники, 12 — гриф, 18 — аккорды и линии; песни в счёт не входят', () => {
    const state = evaluateProgram(PROGRAM, facts());
    const table = STAGE_3.filter(row => row[2] !== 'song');
    expect(state.stageCounts.get(3)).toMatchObject({ total: table.length, passed: 0 });
    const lineOf = (block: string) => PROGRAM.stages[2].blocks.find(item => item.id === block)!.line;
    expect(['technique', 'fretboard', 'chords'].map(line => state.lineCounts.get(`3:${line}`)!.total)).toEqual(
      ['technique', 'fretboard', 'chords'].map(line => table.filter(row => lineOf(row[0]) === line).length));
    expect(['technique', 'fretboard', 'chords'].map(line => state.lineCounts.get(`3:${line}`)!.total)).toEqual([6, 12, 18]);
  });
});

describe('ключ материала укладывается в предел длины (168 символов) у всех вариантов программы', () => {
  it('builtin:<materialId> каждого варианта шагов «играть»', () => {
    for (const ref of stepRefs(PROGRAM)) {
      if (ref.step.kind !== 'play') continue;
      for (const variant of ref.step.variants) expect(`builtin:${materialId(variant)}`.length, `${ref.step.id}: ${materialId(variant)}`).toBeLessThanOrEqual(168);
    }
  });
});
