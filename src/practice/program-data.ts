/**
 * Данные программы обучения (R-028, D-051). Программа появляется по этапам: здесь только то, что выражается
 * существующими шаблонами, ритмами и параметрами. Остальное из таблицы этапа 1 добавляется заходом C
 * (пульс и паузы, ноты струн, нижняя позиция, аппликатура 1-2-4, рифф, «Своя линия») — формы при этом не меняются.
 */
import { createExerciseSpec, type ExerciseSpec } from '../exercises';
import { DEFAULT_PRACTICE, type PracticeOptions } from '../exercises/rhythm';
import type { CheckSpec } from './check';
import { PROGRAM_CHECK_COUNT } from './check';
import type { Block, CheckStep, LineId, PlayStep, Program, Step } from './program';

const QUARTERS: PracticeOptions = Object.freeze({ rhythm: 'quarters', echo: false, groove: null });
const ROCK_EIGHTHS: PracticeOptions = Object.freeze({ rhythm: 'eighths', echo: false, groove: 'rock' });

const play = (id: string, title: string, variants: readonly ExerciseSpec[], practice: PracticeOptions = DEFAULT_PRACTICE): PlayStep =>
  ({ kind: 'play', id, title, variants, practice });
const check = (id: string, title: string, spec: Omit<CheckSpec, 'version' | 'count' | 'ear'>): CheckStep =>
  ({ kind: 'check', id, title, check: { version: 'check-v2', count: PROGRAM_CHECK_COUNT, ear: false, ...spec } });
const block = (id: string, title: string, line: LineId, cards: readonly string[], steps: readonly Step[]): Block => ({ id, title, line, cards, steps });

const crossing = (pattern: 'adjacent' | 'skip' | 'raking') => createExerciseSpec('string-crossing', { pattern });
const chromatic = (startFret: number) => createExerciseSpec('chromatic-position', { startFret });
const octaves = (note: string) => createExerciseSpec('octaves', { note });
const rootFiveEight = (root: string, string: 'E' | 'A') => createExerciseSpec('root-five-eight', { root, string });
const progression = (root: string, progressionId: 'I-IV-V' | 'blues-12', pattern: 'roots' | 'root-fifth' | 'octaves') =>
  createExerciseSpec('progression', { root, progression: progressionId, pattern });

const STAGE_1: readonly Block[] = [
  block('t1-crossing', 'Переход и глушение', 'technique', ['alternate-plucking', 'muting'], [
    play('t1-crossing.eighths', 'Переход между струнами восьмыми', [crossing('adjacent'), crossing('skip')]),
    play('t1-crossing.raking', 'Рейкинг восьмыми', [crossing('raking')]),
  ]),
  block('t1-left', 'Левая рука', 'technique', ['semitone'], [
    play('t1-left.quarters', 'Хроматика в позиции четвертями', [chromatic(5), chromatic(7), chromatic(9)], QUARTERS),
    play('t1-left.eighths', 'Хроматика в позиции восьмыми', [chromatic(5), chromatic(7), chromatic(9)]),
  ]),
  block('f1-octave', 'Октава', 'fretboard', ['octave'], [
    play('f1-octave.quarters', 'Октавы четвертями', ['G', 'A', 'C', 'D'].map(octaves), QUARTERS),
    check('f1-octave.degrees', 'Найди ступень: 1 и 5 по Root–5–8', {
      kind: 'find-degree', area: { type: 'exercise', exercise: rootFiveEight('C', 'A') }, subject: { type: 'degrees', scale: null, targets: null },
    }),
  ]),
  block('h1-roots', 'Тоника под аккорд', 'chords', [], [
    play('h1-roots.eighths', 'I–IV–V тониками восьмыми', ['G', 'A', 'C', 'D'].map(root => progression(root, 'I-IV-V', 'roots'))),
    play('h1-roots.rock12', '12 тактов блюза тониками под подложку «рок»', ['A', 'G', 'C'].map(root => progression(root, 'blues-12', 'roots')), ROCK_EIGHTHS),
  ]),
  block('h1-fifth', 'Квинта и октава', 'chords', ['fifth'], [
    play('h1-fifth.root-five-eight', 'Root–5–8 четвертями', [rootFiveEight('G', 'E'), rootFiveEight('A', 'E'), rootFiveEight('C', 'A'), rootFiveEight('D', 'A')], QUARTERS),
    play('h1-fifth.root-fifth', 'I–IV–V рисунком «тоника и квинта»', ['G', 'A', 'C', 'D'].map(root => progression(root, 'I-IV-V', 'root-fifth'))),
    play('h1-fifth.octaves', 'I–IV–V октавами', ['G', 'A', 'C', 'D'].map(root => progression(root, 'I-IV-V', 'octaves'))),
  ]),
];

export const PROGRAM: Program = Object.freeze({
  stages: Object.freeze([Object.freeze({ number: 1, title: 'Пульс и опора', blocks: Object.freeze(STAGE_1) })]),
});
