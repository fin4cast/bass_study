/**
 * Данные программы обучения (R-028, D-051): четыре этапа целиком по таблицам R-028; программа появлялась по этапам
 * заходами [P18](../../docs/PLAN.md#p18). Формы хранения после этапа 1 не менялись.
 */
import { createExerciseSpec, type ExerciseSpec, type IntervalDirection, type IntervalId, type ProgressionId, type ProgressionPattern, type RiffId, type SpiderPattern } from '../exercises';
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
const pulse = (string: String4, notes: 8 | 16 | 32 = 16, fret = 0) => createExerciseSpec('pulse-note', { string, fret, notes });
const naturals = (string: String4, fretMax: 5 | 12) => createExerciseSpec('string-naturals', { string, fretMax });
const crossing = (pattern: 'adjacent' | 'skip' | 'raking') => createExerciseSpec('string-crossing', { pattern });
/** Хроматика «палец на лад» (1-2-3-4) или аппликатурой 1-2-4 на трёх ладах. */
const chromatic = (startFret: number, fingering: '1234' | '124' = '1234') => createExerciseSpec('chromatic-position', { startFret, fingering });
const shift = (startFret: number) => createExerciseSpec('chromatic-shift', { startFret });
const octaves = (note: string) => createExerciseSpec('octaves', { note });
const rootFiveEight = (root: string, string: 'E' | 'A') => createExerciseSpec('root-five-eight', { root, string });
type Pattern = ProgressionPattern;
const progression = (root: string, progressionId: ProgressionId, pattern: Pattern, position: 'closed' | 'low' | 'open') =>
  createExerciseSpec('progression', { root, progression: progressionId, pattern, position });
/** Позиция в таблице не названа: каждая тональность в нижней позиции, затем каждая в закрытой (R-028). */
const lowThenClosed = (roots: readonly string[], progressionId: ProgressionId, pattern: Pattern) =>
  [...roots.map(root => progression(root, progressionId, pattern, 'low')), ...roots.map(root => progression(root, progressionId, pattern, 'closed'))];
const riff = (root: string, id: RiffId = 'rock-eighths') => createExerciseSpec('riff', { riff: id, root });
const range = (strings: readonly String4[], fretMin: number, fretMax: number) => ({ type: 'range' as const, strings, fretMin, fretMax });
const natural = { type: 'notes', notes: 'natural' } as const;
const allNotes = { type: 'notes', notes: 'all' } as const;
const longShort = (string: 'E' | 'A' | 'D') => createExerciseSpec('long-short', { string, fret: 5 });
const spider = (startFret: number, pattern: SpiderPattern, positions?: number) => createExerciseSpec('spider', positions === undefined ? { startFret, pattern } : { startFret, pattern, positions });
const positionShift = (string: String4) => createExerciseSpec('position-shift', { string });
const pentaForm = (root: string, template: 'pentatonic-form' | 'groups-of-three' | 'connect-forms' = 'pentatonic-form', shapeId: 'penta-a' | 'penta-b' = 'penta-a', structureId: 'minor-pentatonic' | 'major-pentatonic' = 'minor-pentatonic') =>
  createExerciseSpec(template, { root, structureId, shapeId });
const scale = (root: string, structureId: 'major' | 'natural-minor', shapeId: 'compact-e' | 'compact-a', template: 'scale-compact' | 'thirds' = 'scale-compact') => createExerciseSpec(template, { root, structureId, shapeId });
const bluesScale = (root: string) => createExerciseSpec('blues-scale', { root, shapeId: 'compact-e' });
const dominantArpeggio = (root: string) => createExerciseSpec('arpeggio-seventh', { root, structureId: 'dominant-seventh', shapeId: 'compact-e' });
const arpeggio = (root: string, structureId: 'major-triad' | 'minor-triad') => createExerciseSpec('arpeggio-1358', { root, structureId });
/** Мажор и минор каждой тоники по очереди. */
const triads = (roots: readonly string[]) => roots.flatMap(root => [arpeggio(root, 'major-triad'), arpeggio(root, 'minor-triad')]);
const EIGHTH_REST = practice('eighth-rest');
const SHUFFLE_UNDER_SHUFFLE = practice('shuffle', 'shuffle');

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
    play('h1-fifth.riff', 'Рифф «рок-восьмые»', ['G', 'A', 'C', 'D'].map(root => riff(root))),
    play('h1-fifth.riff-rock', 'Рифф «рок-восьмые» под подложку «рок»', ['G', 'A', 'C', 'D'].map(root => riff(root)), ROCK_EIGHTHS),
  ]),
  block('h1-line', 'Первая своя линия', 'chords', [], [
    own('h1-line.own', 'Своя линия объёма 1', 'h1-line'),
    song('h1-line.song', 'Фрагмент своей песни'),
  ]),
];

const STAGE_2: readonly Block[] = [
  /* ---- Техника ---- */
  block('t2-length', 'Длинные и короткие', 'technique', ['legato-staccato'], [
    play('t2-length.quarters', 'Длинные и короткие ноты четвертями', (['E', 'A', 'D'] as const).map(longShort), QUARTERS),
    play('t2-length.eighths', 'Длинные и короткие ноты восьмыми', (['E', 'A', 'D'] as const).map(longShort)),
  ]),
  block('t2-spider', 'Четыре пальца по грифу', 'technique', [], [
    play('t2-spider.1234', 'Паук 1-2-3-4', [spider(5, '1234'), spider(7, '1234')]),
    play('t2-spider.1324', 'Паук 1-3-2-4', [spider(5, '1324'), spider(7, '1324')]),
    play('t2-spider.1243', 'Паук 1-2-4-3', [spider(5, '1243'), spider(7, '1243')]),
    play('t2-spider.shift', 'Смена позиции по струне', OPEN_STRINGS.map(positionShift)),
  ]),
  /* ---- Гриф ---- */
  block('f2-dg', 'Струны D и G', 'fretboard', [], [
    play('f2-dg.naturals', 'Ноты на струне, лады 0–12, четвертями', [naturals('D', 12), naturals('G', 12)], QUARTERS),
    check('f2-dg.name-note', 'Назови ноту: струны D и G, лады 0–12', { kind: 'name-note', area: range(['D', 'G'], 0, 12), subject: natural }),
  ]),
  block('f2-all', 'Нота на всём грифе', 'fretboard', ['accidentals', 'unison'], [
    play('f2-all.note', 'Одна нота по всему грифу четвертями', ['C', 'G', 'D', 'A', 'F', 'B♭'].map(note => createExerciseSpec('note-all-positions', { note })), QUARTERS),
    play('f2-all.fourths', 'Круг кварт на струне четвертями', (['E', 'A'] as const).map(string => createExerciseSpec('string-fourths', { string })), QUARTERS),
    check('f2-all.find-all', 'Найди все позиции ноты со знаками: лады 0–12', { kind: 'find-all', area: range(['E', 'A', 'D', 'G'], 0, 12), subject: allNotes }),
    check('f2-all.name-note', 'Назови ноту со знаками: все струны, лады 0–12', { kind: 'name-note', area: range(['E', 'A', 'D', 'G'], 0, 12), subject: allNotes }),
  ]),
  block('f2-penta', 'Первая форма', 'fretboard', ['degree', 'pentatonic'], [
    play('f2-penta.form', 'Форма A минорной пентатоники вверх-вниз', ['A', 'B', 'G'].map(root => pentaForm(root))),
    play('f2-penta.groups', 'Группы по три по форме A', ['A', 'B', 'G'].map(root => pentaForm(root, 'groups-of-three'))),
    check('f2-penta.find-degree', 'Найди ступень по форме A', { kind: 'find-degree', area: { type: 'exercise', exercise: pentaForm('A') }, subject: { type: 'degrees', scale: null, targets: null } }),
  ]),
  /* ---- Аккорды и линии ---- */
  block('h2-rhythm', 'Ритм с паузами', 'chords', ['durations-rests', 'tie-syncopation'], [
    play('h2-rhythm.eighth-rest', 'I–IV–V тониками с восьмой паузой', lowThenClosed(['G', 'A', 'C'], 'I-IV-V', 'roots'), EIGHTH_REST),
    play('h2-rhythm.tied', 'I–IV–V тониками с синкопой и лигой', lowThenClosed(['G', 'A', 'C'], 'I-IV-V', 'roots'), practice('tied-syncopation')),
    play('h2-rhythm.shuffle', 'I–IV–V тониками шаффлом', lowThenClosed(['G', 'A', 'C'], 'I-IV-V', 'roots'), practice('shuffle')),
  ]),
  block('h2-blues', 'Блюз по ступеням', 'chords', [], [
    play('h2-blues.root-fifth', '12 тактов рисунком «тоника и квинта»', lowThenClosed(['A', 'E', 'G'], 'blues-12', 'root-fifth')),
    play('h2-blues.r5b78', '12 тактов рисунком «R–5–♭7–8»', lowThenClosed(['A', 'E', 'G'], 'blues-12', 'r5b78')),
    play('h2-blues.r56', '12 тактов рисунком «R–5–6» шаффлом под подложку «шаффл»', lowThenClosed(['A', 'E', 'G'], 'blues-12', 'r56'), SHUFFLE_UNDER_SHUFFLE),
    check('h2-blues.name-degree', 'Назови ступень: 1, 5, 6 и ♭7 от A', {
      kind: 'name-degree', area: range(['E', 'A', 'D'], 4, 7), subject: { type: 'degrees', scale: { root: 'A', degrees: ['1', '5', '6', 'b7'] }, targets: null },
    }),
  ]),
  block('h2-approach', 'Подход', 'chords', [], [
    play('h2-approach.pop1', 'I–V–vi–IV тониками с подходом', lowThenClosed(['C', 'G', 'D'], 'I-V-vi-IV', 'roots-approach')),
    play('h2-approach.pop2', 'I–vi–IV–V тониками с подходом', lowThenClosed(['C', 'G', 'D'], 'I-vi-IV-V', 'roots-approach')),
    play('h2-approach.riff', 'Рифф «с подходом»', ['C', 'G', 'D'].map(root => riff(root, 'approach-eighths'))),
    play('h2-approach.disco', 'Рифф «октавы диско»', ['C', 'G', 'D'].map(root => riff(root, 'disco-octaves'))),
  ]),
  block('h2-triad', 'Трезвучие', 'chords', ['triad'], [
    play('h2-triad.quarters', 'Арпеджио 1–3–5–8 четвертями', triads(['C', 'G', 'A']), QUARTERS),
    play('h2-triad.eighths', 'Арпеджио 1–3–5–8 восьмыми', triads(['C', 'G', 'A'])),
    play('h2-triad.progression', 'I–IV–V рисунком «арпеджио»', lowThenClosed(['G', 'A', 'C'], 'I-IV-V', 'arpeggio')),
    check('h2-triad.name-degree', 'Назови ступень: 1, 3, ♭3 и 5 от C', {
      kind: 'name-degree', area: range(['A', 'D', 'G'], 1, 5), subject: { type: 'degrees', scale: { root: 'C', degrees: ['1', 'b3', '3', '5'] }, targets: null },
    }),
  ]),
  block('h2-own', 'Своя последовательность', 'chords', [], [
    play('h2-own.riff', 'Рифф в форме A пентатоники по i–iv–v', ['A', 'E', 'G'].map(root => riff(root, 'penta-a'))),
    own('h2-own.own', 'Своя линия объёма 2', 'h2-own'),
    song('h2-own.song', 'Фрагмент своей песни'),
  ]),
];

const SIXTEENTHS = practice('sixteenths');
const QUARTERS_UNDER_SHUFFLE = practice('quarters', 'shuffle');
const SHUFFLE = practice('shuffle');
const major = (root: string, shapeId: 'compact-e' | 'compact-a', template: 'scale-compact' | 'thirds' = 'scale-compact') => scale(root, 'major', shapeId, template);
const minor = (root: string, shapeId: 'compact-e' | 'compact-a') => scale(root, 'natural-minor', shapeId);

const STAGE_3: readonly Block[] = [
  /* ---- Техника ---- */
  block('t3-sixteenths', 'Шестнадцатые', 'technique', [], [
    play('t3-sixteenths.pulse', 'Пульс на одной ноте шестнадцатыми', [pulse('E', 32), pulse('A', 32), pulse('E', 32, 5)], SIXTEENTHS),
    play('t3-sixteenths.chromatic', 'Хроматика в позиции шестнадцатыми', [chromatic(5), chromatic(7)], SIXTEENTHS),
  ]),
  block('t3-spider', 'Перестановки по грифу', 'technique', [], [
    play('t3-spider.1432', 'Паук 1-4-3-2', [spider(5, '1432'), spider(7, '1432')]),
    play('t3-spider.neck', 'Паук по всему грифу с 1-го лада', [spider(1, '1234', 12), spider(1, '1324', 12)]),
  ]),
  /* ---- Гриф ---- */
  block('f3-major', 'Мажорная гамма', 'fretboard', ['major-formula'], [
    play('f3-major.scale', 'Гамма в одной позиции', [major('C', 'compact-e'), major('G', 'compact-e'), major('D', 'compact-a')]),
    play('f3-major.thirds', 'Терциями по гамме', [major('C', 'compact-e', 'thirds'), major('G', 'compact-e', 'thirds'), major('D', 'compact-a', 'thirds')]),
    check('f3-major.name-degree', 'Назови ступень по мажорной гамме C', { kind: 'name-degree', area: { type: 'exercise', exercise: major('C', 'compact-e') }, subject: { type: 'degrees', scale: null, targets: null } }),
  ]),
  block('f3-minor', 'Натуральный минор', 'fretboard', ['natural-minor', 'relative-keys'], [
    play('f3-minor.scale', 'Гамма в одной позиции', [minor('A', 'compact-e'), minor('B', 'compact-e'), minor('D', 'compact-a')]),
    play('f3-minor.relative', 'Одни ноты — разные тоники', ['A', 'B'].map(minorRoot => createExerciseSpec('pentatonic-relative', { minorRoot, shapeId: 'penta-a' }))),
    check('f3-minor.name-degree', 'Назови ступень: ♭3, ♭6 и ♭7 по гамме A минор', {
      kind: 'name-degree', area: { type: 'exercise', exercise: minor('A', 'compact-e') }, subject: { type: 'degrees', scale: null, targets: ['b3', 'b6', 'b7'] },
    }),
  ]),
  block('f3-penta', 'Две формы', 'fretboard', [], [
    play('f3-penta.form-b', 'Форма B минорной пентатоники', ['A', 'B', 'G'].map(root => pentaForm(root, 'pentatonic-form', 'penta-b'))),
    play('f3-penta.link', 'Связка форм A→B', ['A', 'B', 'G'].map(root => pentaForm(root, 'connect-forms'))),
    play('f3-penta.major', 'Мажорная пентатоника, форма A', ['C', 'D'].map(root => pentaForm(root, 'pentatonic-form', 'penta-a', 'major-pentatonic'))),
    check('f3-penta.find-degree', 'Найди ступень по форме B', { kind: 'find-degree', area: { type: 'exercise', exercise: pentaForm('A', 'pentatonic-form', 'penta-b') }, subject: { type: 'degrees', scale: null, targets: null } }),
  ]),
  /* ---- Аккорды и линии ---- */
  block('h3-minor', 'Минорные последовательности', 'chords', [], [
    play('h3-minor.i-iv', 'i–iv тониками', lowThenClosed(['A', 'E', 'D'], 'i-iv', 'roots')),
    play('h3-minor.i-v-i', 'i–V–i тониками', lowThenClosed(['A', 'E', 'D'], 'i-V-i', 'roots')),
    play('h3-minor.i-vii-vi-v', 'i–VII–VI–V тониками', lowThenClosed(['A', 'E', 'D'], 'i-VII-VI-V', 'roots')),
    play('h3-minor.arpeggio', 'i–iv рисунком «арпеджио»', lowThenClosed(['A', 'E', 'D'], 'i-iv', 'arpeggio')),
  ]),
  block('h3-diatonic', 'Аккорды тональности', 'chords', ['triad'], [
    play('h3-diatonic.diatonic', 'Трезвучия по ступеням', lowThenClosed(['C', 'G'], 'diatonic', 'arpeggio')),
    play('h3-diatonic.pop1', 'I–V–vi–IV рисунком «арпеджио»', lowThenClosed(['C', 'G', 'D'], 'I-V-vi-IV', 'arpeggio')),
    play('h3-diatonic.pop2', 'I–vi–IV–V рисунком «арпеджио»', lowThenClosed(['C', 'G', 'D'], 'I-vi-IV-V', 'arpeggio')),
    check('h3-diatonic.roman-root', 'Найди ноту: тоника аккорда по римской цифре в C', { kind: 'find-note', area: range(['E', 'A'], 0, 12), subject: { type: 'roman-root', key: 'C' } }),
  ]),
  block('h3-passing', 'Проходящие ноты', 'chords', [], [
    play('h3-passing.i-iv-v', 'I–IV–V тониками с проходящими', lowThenClosed(['C', 'G', 'A'], 'I-IV-V', 'roots-passing')),
    play('h3-passing.pop1', 'I–V–vi–IV тониками с проходящими', lowThenClosed(['C', 'G', 'D'], 'I-V-vi-IV', 'roots-passing')),
  ]),
  block('h3-blues', 'Блюз 2', 'chords', ['blues-scale'], [
    play('h3-blues.scale', 'Блюзовая гамма', ['A', 'G', 'B'].map(bluesScale)),
    play('h3-blues.arpeggio7', 'Арпеджио доминантсептаккорда', ['A', 'G', 'B'].map(dominantArpeggio)),
    play('h3-blues.arpeggio12', '12 тактов рисунком «арпеджио» шаффлом', lowThenClosed(['A', 'E', 'G'], 'blues-12', 'arpeggio'), SHUFFLE),
    play('h3-blues.boogie', '12 тактов «буги»', lowThenClosed(['A', 'E', 'G'], 'blues-12', 'boogie')),
    play('h3-blues.riff', 'Буги-рифф', ['A', 'E', 'G'].map(root => riff(root, 'boogie-12'))),
    check('h3-blues.name-degree', 'Назови ступень по блюзовой гамме A', { kind: 'name-degree', area: { type: 'exercise', exercise: bluesScale('A') }, subject: { type: 'degrees', scale: null, targets: null } }),
  ]),
  block('h3-line', 'Своя линия 2', 'chords', [], [
    play('h3-line.riff', 'Рифф с переходом A→B', ['A', 'B'].map(root => riff(root, 'shift-ab'))),
    own('h3-line.own', 'Своя линия объёма 3', 'h3-line'),
    song('h3-line.song', 'Фрагмент своей песни'),
  ]),
];

/** Тональности внутри, форма снаружи не используется: порядок вариантов этапа 4 — тоника снаружи, вторая ось внутри (R-028, решения для этапа 4). */
const pentaNeckForms = (roots: readonly string[], shapes: readonly ('penta-c' | 'penta-d' | 'penta-e')[]) =>
  roots.flatMap(root => shapes.map(shapeId => createExerciseSpec('pentatonic-form', { root, structureId: 'minor-pentatonic', shapeId })));
const connectForms = (roots: readonly string[], shapes: readonly ('penta-b' | 'penta-c' | 'penta-d' | 'penta-e')[]) =>
  roots.flatMap(root => shapes.map(shapeId => createExerciseSpec('connect-forms', { root, structureId: 'minor-pentatonic', shapeId })));
const interval = (interval: IntervalId, direction: IntervalDirection) => createExerciseSpec('interval-from-note', { note: 'C', interval, direction });
/** Малая и большая вверх, затем малая и большая вниз от C. */
const intervals = (small: IntervalId, large: IntervalId) => [interval(small, 'up'), interval(large, 'up'), interval(small, 'down'), interval(large, 'down')];
const seventh = (root: string, structureId: 'major-seventh' | 'dominant-seventh' | 'minor-seventh' | 'half-diminished-seventh') => createExerciseSpec('arpeggio-seventh', { root, structureId, shapeId: 'compact-e' });

const STAGE_4: readonly Block[] = [
  /* ---- Гриф ---- */
  block('f4-neck', 'Пентатоника по грифу', 'fretboard', [], [
    play('f4-neck.forms', 'Формы C, D, E минорной пентатоники', pentaNeckForms(['A', 'B'], ['penta-c', 'penta-d', 'penta-e'])),
    play('f4-neck.links', 'Связки B→C, C→D, D→E, E→A', connectForms(['A', 'B'], ['penta-b', 'penta-c', 'penta-d', 'penta-e'])),
    play('f4-neck.neck', 'Пентатоника по всему грифу', ['A', 'B', 'G'].map(root => createExerciseSpec('pentatonic-neck', { root, structureId: 'minor-pentatonic' }))),
    check('f4-neck.find-degree', 'Найди ступень по всему грифу', { kind: 'find-degree', area: { type: 'exercise', exercise: createExerciseSpec('pentatonic-neck', { root: 'A', structureId: 'minor-pentatonic' }) }, subject: { type: 'degrees', scale: null, targets: null } }),
  ]),
  block('f4-positions', 'Позиции гамм', 'fretboard', [], [
    play('f4-positions.position', 'Гамма в позиции от 1-й, 2-й и 5-й ступени', [['C', 'major'], ['A', 'natural-minor'], ['G', 'major']].flatMap(([root, structureId]) =>
      [1, 2, 5].map(degree => createExerciseSpec('scale-position', { root, structureId: structureId as 'major' | 'natural-minor', degree })))),
    play('f4-positions.string', 'Гамма на одной струне', [
      createExerciseSpec('scale-one-string', { root: 'G', structureId: 'major', string: 'E' }), createExerciseSpec('scale-one-string', { root: 'C', structureId: 'major', string: 'A' }),
      createExerciseSpec('scale-one-string', { root: 'A', structureId: 'natural-minor', string: 'A' }),
    ]),
    check('f4-positions.name-degree', 'Назови ступень по гамме C мажор в позиции от 2-й ступени', {
      kind: 'name-degree', area: { type: 'exercise', exercise: createExerciseSpec('scale-position', { root: 'C', structureId: 'major', degree: 2 }) }, subject: { type: 'degrees', scale: null, targets: null },
    }),
  ]),
  block('f4-intervals', 'Интервалы', 'fretboard', ['seconds', 'sixths', 'sevenths'], [
    play('f4-intervals.seconds', 'Секунды от C четвертями', intervals('min2', 'maj2'), QUARTERS),
    play('f4-intervals.sixths', 'Сексты от C четвертями', intervals('min6', 'maj6'), QUARTERS),
    play('f4-intervals.sevenths', 'Септимы от C четвертями', intervals('min7', 'maj7'), QUARTERS),
    check('f4-intervals.find-degree', 'Найди ступень: 2, 6 и 7 по гамме C мажор', {
      kind: 'find-degree', area: { type: 'exercise', exercise: scale('C', 'major', 'compact-a') }, subject: { type: 'degrees', scale: null, targets: ['2', '6', '7'] },
    }),
  ]),
  block('f4-sequences', 'Секвенции и перенос', 'fretboard', [], [
    play('f4-sequences.groups', 'Группы по три', ['penta-b', 'penta-c'].map(shapeId => createExerciseSpec('groups-of-three', { root: 'A', structureId: 'minor-pentatonic', shapeId: shapeId as 'penta-b' | 'penta-c' }))),
    play('f4-sequences.transpose', 'Та же форма от другой тоники', [createExerciseSpec('form-transpose')]),
    play('f4-sequences.cycle', 'Паттерн по квинтовому кругу', ['C', 'G', 'E'].map(root => createExerciseSpec('cycle-fourths', { root }))),
  ]),
  /* ---- Аккорды и линии ---- */
  block('h4-seventh', 'Септаккорды и обращения', 'chords', ['seventh-chords', 'inversions'], [
    // Четвертями: те же доминантсептаккорды A и G восьмыми уже играются в h3-blues, а проход засчитывается одному шагу.
    play('h4-seventh.arpeggio', 'Арпеджио maj7, 7, m7 и m7♭5 четвертями', ['C', 'G', 'A'].flatMap(root => (['major-seventh', 'dominant-seventh', 'minor-seventh', 'half-diminished-seventh'] as const).map(structureId => seventh(root, structureId))), QUARTERS),
    play('h4-seventh.inversions', 'Обращения 1-е и 2-е', ['C', 'G', 'D'].flatMap(root => [1, 2].map(inversion => createExerciseSpec('arpeggio-inversion', { root, structureId: 'major-triad', inversion })))),
    play('h4-seventh.riff', 'Рифф по кругу кварт', ['C', 'G'].map(root => riff(root, 'fourths-cycle'))),
    check('h4-seventh.name-degree', 'Назови ступень: ♭7 и 7 по септаккорду от C', {
      kind: 'name-degree', area: range(['A', 'D', 'G'], 2, 5), subject: { type: 'degrees', scale: { root: 'C', degrees: ['1', '3', '5', 'b7', '7'] }, targets: ['b7', '7'] },
    }),
  ]),
  block('h4-iivi', 'ii–V–I', 'chords', [], [
    play('h4-iivi.roots', 'ii–V–I тониками', lowThenClosed(['C', 'F', 'B♭'], 'ii-V-I', 'roots')),
    play('h4-iivi.arpeggio', 'ii–V–I рисунком «арпеджио»', lowThenClosed(['C', 'F', 'B♭'], 'ii-V-I', 'arpeggio')),
    play('h4-iivi.approach', 'ii–V–I рисунком «арпеджио и подходы»', lowThenClosed(['C', 'F', 'B♭'], 'ii-V-I', 'approach')),
  ]),
  block('h4-walking', 'Шагающий бас', 'chords', [], [
    play('h4-walking.iivi', 'ii–V–I шагающим басом четвертями', lowThenClosed(['C', 'F', 'B♭'], 'ii-V-I', 'walking'), QUARTERS),
    play('h4-walking.blues', '12 тактов шагающим басом четвертями под подложку «шаффл»', lowThenClosed(['F', 'B♭', 'G'], 'blues-12', 'walking'), QUARTERS_UNDER_SHUFFLE),
  ]),
  block('h4-line', 'Линия в трёх тональностях', 'chords', [], [
    play('h4-line.riff', 'Рифф через три формы', ['A', 'B'].map(root => riff(root, 'three-forms'))),
    own('h4-line.own', 'Своя линия в трёх тональностях', 'h4-line'),
    song('h4-line.song', 'Фрагмент своей песни'),
  ]),
];

export const PROGRAM: Program = Object.freeze({
  stages: Object.freeze([
    Object.freeze({ number: 1, title: 'Пульс и опора', blocks: Object.freeze(STAGE_1) }),
    Object.freeze({ number: 2, title: 'Паттерны и первая форма', blocks: Object.freeze(STAGE_2) }),
    Object.freeze({ number: 3, title: 'Тоны аккорда и свои линии', blocks: Object.freeze(STAGE_3) }),
    Object.freeze({ number: 4, title: 'Весь гриф', blocks: Object.freeze(STAGE_4) }),
  ]),
});
