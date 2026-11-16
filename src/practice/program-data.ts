/**
 * Данные программы обучения (R-028, D-051). Программа появляется по этапам: здесь этап 1 целиком по таблице R-028;
 * следующие этапы добавляются своими заходами [P18](../../docs/PLAN.md#p18). Формы хранения после этапа 1 не меняются.
 */
import { createExerciseSpec, type ExerciseSpec } from '../exercises';
import { DEFAULT_PRACTICE, type PracticeOptions, type RhythmPatternId } from '../exercises/rhythm';
import type { CheckSpec } from './check';
import { PROGRAM_CHECK_COUNT } from './check';
import type { Block, CheckStep, LineId, LineStep, PlayStep, Program, SongStep, Step } from './program';

const practice = (rhythm: RhythmPatternId, groove: string | null = null): PracticeOptions => Object.freeze({ rhythm, echo: false, groove });
const QUARTERS = practice('quarters');
const ROCK_EIGHTHS = practice('eighths', 'rock');

const play = (id: string, title: string, variants: readonly ExerciseSpec[], how: PracticeOptions = DEFAULT_PRACTICE): PlayStep =>
  ({ kind: 'play', id, title, variants, practice: how });
const check = (id: string, title: string, spec: Omit<CheckSpec, 'version' | 'count' | 'ear'>): CheckStep =>
  ({ kind: 'check', id, title, check: { version: 'check-v2', count: PROGRAM_CHECK_COUNT, ear: false, ...spec } });
const own = (id: string, title: string, rule: LineStep['rule']): LineStep => ({ kind: 'line', id, title, rule });
const song = (id: string, title: string): SongStep => ({ kind: 'song', id, title });
const block = (id: string, title: string, line: LineId, cards: readonly string[], steps: readonly Step[]): Block => ({ id, title, line, cards, steps });

type String4 = 'E' | 'A' | 'D' | 'G';
const OPEN_STRINGS: readonly String4[] = ['E', 'A', 'D', 'G'];
const pulse = (string: String4, notes: 8 | 16 | 32 = 16) => createExerciseSpec('pulse-note', { string, fret: 0, notes });
const naturals = (string: 'E' | 'A', fretMax: 5 | 12) => createExerciseSpec('string-naturals', { string, fretMax });
const crossing = (pattern: 'adjacent' | 'skip' | 'raking') => createExerciseSpec('string-crossing', { pattern });
/** Хроматика «палец на лад» (1-2-3-4) или аппликатурой 1-2-4 на трёх ладах. */
const chromatic = (startFret: number, fingering: '1234' | '124' = '1234') => createExerciseSpec('chromatic-position', { startFret, fingering });
const shift = (startFret: number) => createExerciseSpec('chromatic-shift', { startFret });
const octaves = (note: string) => createExerciseSpec('octaves', { note });
const rootFiveEight = (root: string, string: 'E' | 'A') => createExerciseSpec('root-five-eight', { root, string });
type Pattern = 'roots' | 'root-fifth' | 'octaves';
const progression = (root: string, progressionId: 'I-IV-V' | 'blues-12', pattern: Pattern, position: 'closed' | 'low' | 'open') =>
  createExerciseSpec('progression', { root, progression: progressionId, pattern, position });
/** Позиция в таблице не названа: каждая тональность в нижней позиции, затем каждая в закрытой (R-028). */
const lowThenClosed = (roots: readonly string[], progressionId: 'I-IV-V' | 'blues-12', pattern: Pattern) =>
  [...roots.map(root => progression(root, progressionId, pattern, 'low')), ...roots.map(root => progression(root, progressionId, pattern, 'closed'))];
const riff = (root: string) => createExerciseSpec('riff', { riff: 'rock-eighths', root });
const range = (strings: readonly String4[], fretMin: number, fretMax: number) => ({ type: 'range' as const, strings, fretMin, fretMax });
const natural = { type: 'notes', notes: 'natural' } as const;

const STAGE_1: readonly Block[] = [
  /* ---- Техника ---- */
  block('t1-pulse', 'Пульс правой рукой', 'technique', ['tuning', 'posture', 'right-hand-basics'], [
    play('t1-pulse.quarters', 'Пульс на одной ноте четвертями', OPEN_STRINGS.map(string => pulse(string)), QUARTERS),
    play('t1-pulse.eighths', 'Пульс на одной ноте восьмыми', OPEN_STRINGS.map(string => pulse(string))),
    play('t1-pulse.quarter-two-eighths', 'Пульс рисунком «четверть и две восьмые»', OPEN_STRINGS.map(string => pulse(string)), practice('quarter-two-eighths')),
  ]),
  block('t1-crossing', 'Переход и глушение', 'technique', ['alternate-plucking', 'muting'], [
    play('t1-crossing.eighths', 'Переход между струнами восьмыми', [crossing('adjacent'), crossing('skip')]),
    play('t1-crossing.note-rest', 'Пульс рисунком «нота — пауза»', OPEN_STRINGS.map(string => pulse(string, 8)), practice('note-rest')),
    play('t1-crossing.raking', 'Рейкинг восьмыми', [crossing('raking')]),
  ]),
  block('t1-left', 'Левая рука', 'technique', ['left-hand-basics', 'semitone'], [
    play('t1-left.quarters', 'Хроматика в позиции четвертями', [chromatic(5), chromatic(7), chromatic(9), chromatic(1, '124'), chromatic(3, '124')], QUARTERS),
    play('t1-left.eighths', 'Хроматика в позиции восьмыми', [chromatic(5), chromatic(7), chromatic(9), chromatic(1, '124'), chromatic(3, '124')]),
    play('t1-left.shift', 'Хроматика по позициям восьмыми', [shift(5), shift(7), shift(9)]),
  ]),
  /* ---- Гриф ---- */
  block('f1-ea5', 'Ноты у порожка', 'fretboard', ['tab'], [
    play('f1-ea5.naturals', 'Ноты на струне, лады 0–5, четвертями', [naturals('E', 5), naturals('A', 5)], QUARTERS),
    check('f1-ea5.name-note', 'Назови ноту: струны E и A, лады 0–5', { kind: 'name-note', area: range(['E', 'A'], 0, 5), subject: natural }),
  ]),
  block('f1-ea12', 'Струны E и A до 12-го лада', 'fretboard', [], [
    play('f1-ea12.naturals', 'Ноты на струне, лады 0–12, четвертями', [naturals('E', 12), naturals('A', 12)], QUARTERS),
    check('f1-ea12.find-note', 'Найди ноту: струны E и A, лады 0–12', { kind: 'find-note', area: range(['E', 'A'], 0, 12), subject: natural }),
    check('f1-ea12.name-note', 'Назови ноту: струны E и A, лады 0–12', { kind: 'name-note', area: range(['E', 'A'], 0, 12), subject: natural }),
  ]),
  block('f1-octave', 'Октава', 'fretboard', ['octave'], [
    play('f1-octave.quarters', 'Октавы четвертями', ['G', 'A', 'C', 'D'].map(octaves), QUARTERS),
    check('f1-octave.degrees', 'Найди ступень: 1 и 5 по Root–5–8', {
      kind: 'find-degree', area: { type: 'exercise', exercise: rootFiveEight('C', 'A') }, subject: { type: 'degrees', scale: null, targets: null },
    }),
  ]),
  /* ---- Аккорды и линии ---- */
  block('h1-open', 'Блюз на открытых струнах', 'chords', ['beat-bar', 'chord-progression'], [
    play('h1-open.quarters', 'I–IV–V тониками на открытых струнах четвертями', ['A', 'D'].map(root => progression(root, 'I-IV-V', 'roots', 'open')), QUARTERS),
    play('h1-open.blues', '12 тактов блюза на открытых струнах четвертями', ['A', 'D'].map(root => progression(root, 'blues-12', 'roots', 'open')), QUARTERS),
  ]),
  block('h1-roots', 'Тоника под аккорд', 'chords', [], [
    play('h1-roots.quarters', 'I–IV–V тониками четвертями', lowThenClosed(['G', 'A', 'C', 'D'], 'I-IV-V', 'roots'), QUARTERS),
    play('h1-roots.eighths', 'I–IV–V тониками восьмыми', lowThenClosed(['G', 'A', 'C', 'D'], 'I-IV-V', 'roots')),
    play('h1-roots.quarter-rest', 'I–IV–V тониками с четвертной паузой', lowThenClosed(['G', 'A', 'C', 'D'], 'I-IV-V', 'roots'), practice('quarter-rest')),
    play('h1-roots.rock12', '12 тактов блюза тониками под подложку «рок»', lowThenClosed(['A', 'G', 'C'], 'blues-12', 'roots'), ROCK_EIGHTHS),
    check('h1-roots.find-note', 'Найди ноту: тоника названного аккорда', { kind: 'find-note', area: range(['E', 'A'], 0, 12), subject: { type: 'chord-root', notes: 'natural' } }),
  ]),
  block('h1-fifth', 'Квинта и октава', 'chords', ['fifth'], [
    play('h1-fifth.root-five-eight', 'Root–5–8 четвертями', [rootFiveEight('G', 'E'), rootFiveEight('A', 'E'), rootFiveEight('C', 'A'), rootFiveEight('D', 'A')], QUARTERS),
    play('h1-fifth.root-fifth', 'I–IV–V рисунком «тоника и квинта»', lowThenClosed(['G', 'A', 'C', 'D'], 'I-IV-V', 'root-fifth')),
    play('h1-fifth.octaves', 'I–IV–V октавами', lowThenClosed(['G', 'A', 'C', 'D'], 'I-IV-V', 'octaves')),
    play('h1-fifth.riff', 'Рифф «рок-восьмые»', ['G', 'A', 'C', 'D'].map(riff)),
    play('h1-fifth.riff-rock', 'Рифф «рок-восьмые» под подложку «рок»', ['G', 'A', 'C', 'D'].map(riff), ROCK_EIGHTHS),
  ]),
  block('h1-line', 'Первая своя линия', 'chords', [], [
    own('h1-line.own', 'Своя линия объёма 1', 'h1-line'),
    song('h1-line.song', 'Фрагмент своей песни'),
  ]),
];

export const PROGRAM: Program = Object.freeze({
  stages: Object.freeze([Object.freeze({ number: 1, title: 'Пульс и опора', blocks: Object.freeze(STAGE_1) })]),
});
