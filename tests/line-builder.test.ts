import { describe, expect, it } from 'vitest';
import { buildExercise } from '../src/exercises';
import { lineSpec, lineVolume, newLineDraft, patternsFor, setBarPattern, setLineRoot, transposeLine } from '../src/practice/line-builder';
import { evaluateProgram, lineFacts, type Program, type ProgramFacts } from '../src/practice/program';
import type { PlayRecord } from '../src/practice/results';

describe('конструктор «Своей линии» (R-028, B5.4)', () => {
  it('объём 1: тональность и четыре такта I–IV–V–I мажорными трезвучиями, рисунки этапа 1, восьмые', () => {
    const draft = newLineDraft();
    expect(draft.bars.map(bar => [bar.step, bar.chord, bar.pattern, bar.rhythm])).toEqual([0, 5, 7, 0].map(step => [step, 'major-triad', 'roots', 'eighths']));
    expect(lineVolume(draft)).toBe(1);
    expect(lineVolume(setBarPattern(draft, 1, 'root-fifth'))).toBe(1);
    expect(lineVolume(setBarPattern(draft, 2, 'octaves'))).toBe(1);
  });
  it('объём растёт с выходом за ограничения: арпеджио — 2, ритм не восьмыми, минор и девять тактов — 3', () => {
    const draft = newLineDraft();
    expect(lineVolume(setBarPattern(draft, 0, 'arpeggio'))).toBe(2);
    expect(lineVolume({ ...draft, bars: draft.bars.map((bar, index) => (index ? bar : { ...bar, chord: 'minor-triad' as const })) })).toBe(2);
    expect(lineVolume({ ...draft, bars: draft.bars.map((bar, index) => (index ? bar : { ...bar, rhythm: 'quarters' as const })) })).toBe(3);
    expect(lineVolume({ ...draft, mode: 'minor' })).toBe(2);
    expect(lineVolume({ ...draft, bars: [...draft.bars, ...draft.bars, draft.bars[0]] })).toBe(3);
    expect(lineVolume({ ...draft, bars: draft.bars.map(bar => ({ ...bar, chord: 'major-seventh' as const })) })).toBe(3);
  });
  it('недопустимое сочетание рисунка и аккорда не предлагается', () => {
    expect(patternsFor(1, 'major-triad')).toEqual(['roots', 'root-fifth', 'octaves']);
    expect(patternsFor(2, 'major-triad')).toEqual(['roots', 'root-fifth', 'octaves', 'arpeggio']);
    expect(patternsFor(3, 'minor-triad')).not.toContain('boogie');
    expect(patternsFor(3, 'dominant-seventh')).toContain('boogie');
  });
  it('описание строится из черновика; перенос в другую тональность сохраняет состав тактов', () => {
    const draft = setBarPattern(setBarPattern(newLineDraft(), 1, 'root-fifth'), 2, 'octaves');
    const spec = lineSpec(draft);
    expect(spec.templateId === 'line' && spec.params.bars.map(bar => bar.pattern)).toEqual(['roots', 'root-fifth', 'octaves', 'roots']);
    const moved = transposeLine(spec, 'A');
    expect(moved.templateId === 'line' && moved.params).toMatchObject({ root: 'A', mode: 'major', position: 'closed', bars: spec.templateId === 'line' ? spec.params.bars : [] });
    expect(buildExercise(moved).notes.filter(note => note.segment === 0).every(note => note.id === 'E:5')).toBe(true);
    expect(lineSpec(setLineRoot(draft, 'D')).templateId).toBe('line');
    expect(() => setBarPattern(draft, 9, 'roots')).toThrow(RangeError);
    expect(() => transposeLine(buildExercise(lineSpec(draft)).spec.templateId === 'line' ? { version: 'exercise-v1', templateId: 'octaves', params: { note: 'G' } } as never : spec, 'A')).toThrow(RangeError);
  });
});

describe('факты и статусы «Своей линии» (R-028, «Шаги „Своя линия“»)', () => {
  const play = (spec: ReturnType<typeof lineSpec>, localDate: string, bpm: number, assessment: PlayRecord['assessment'] = 'clean', wholePass = true): PlayRecord => ({
    kind: 'play', id: `p-${localDate}-${bpm}`, exerciseKey: 'user:line', title: 'Своя линия', spec, assessment, bpm, activeMs: 60000, localDate, occurredAt: `${localDate}T10:00:00.000Z`,
    view: 'both', wholePass, practice: { rhythm: 'eighths', echo: false, groove: null },
  });
  const program: Program = { stages: [{ number: 1, title: 'Этап', blocks: [{ id: 'h1-line', title: 'Своя линия', line: 'chords', cards: [], steps: [{ kind: 'line', id: 'h1-line.own', title: 'Первая своя линия', rule: 'h1-line' }] }] }] };
  const state = (records: PlayRecord[], today = '2026-11-20') => {
    const facts: ProgramFacts = { plays: [], checks: [], lines: lineFacts(records), skippedBlocks: new Set(), today };
    return evaluateProgram(program, facts).statuses.get('h1-line.own')!.state;
  };
  const withRoot = (root: string, pattern = 'root-fifth') => lineSpec(setBarPattern(setLineRoot(newLineDraft(), root), 1, pattern as never));

  it('факт линии: объём, тональность как класс высоты, лад, признаки правил', () => {
    const [fact] = lineFacts([play(withRoot('G'), '2026-11-10', 60)]);
    expect(fact).toMatchObject({ volume: 1, tonality: '7', mode: 'major', allRoots: false, standardChords: true, beyondVolume2: false, assessment: 'clean', wholePass: true, bpm: 60 });
    expect(fact.composition).toBe('0M_roots_eighths.5M_root-fifth_eighths.7M_roots_eighths.0M_roots_eighths');
    expect(lineFacts([play(lineSpec(newLineDraft()), '2026-11-10', 60)])[0].allRoots).toBe(true);
  });
  it('h1-line: один проход «Чисто» линии объёма 1, не все такты — «тоники»; линия только из «тоник» не засчитывается', () => {
    expect(state([])).toBe('new');
    expect(state([play(lineSpec(newLineDraft()), '2026-11-10', 60)])).toBe('progress');
    expect(state([play(withRoot('G'), '2026-11-10', 60, 'errors')])).toBe('progress');
    expect(state([play(withRoot('G'), '2026-11-10', 60, 'clean', false)])).toBe('progress');
    expect(state([play(withRoot('G'), '2026-11-10', 50)])).toBe('passed');
  });
  it('h1-line: «освоен» — такие проходы в темпе не ниже базового в двух тональностях в два разных дня', () => {
    expect(state([play(withRoot('G'), '2026-11-10', 60), play(withRoot('G'), '2026-11-11', 60)])).toBe('passed');
    expect(state([play(withRoot('G'), '2026-11-10', 60), play(withRoot('A'), '2026-11-10', 60)])).toBe('passed');
    expect(state([play(withRoot('G'), '2026-11-10', 60), play(withRoot('A'), '2026-11-11', 60)])).toBe('mastered');
    expect(state([play(withRoot('G'), '2026-11-10', 50), play(withRoot('A'), '2026-11-11', 50)])).toBe('passed');
  });
});
