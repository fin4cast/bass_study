/**
 * Конструктор «Своей линии» (R-028, дополнение B5.4): объёмы 1–3, допустимые рисунки по объёму и сборка описания `line`.
 * Чистый модуль без DOM: экран держит состояние `LineDraft` и получает описание упражнения.
 */
import {
  createExerciseSpec, patternFits, PROGRESSION_PATTERNS, type ExerciseSpec, type LineBar, type LineChord, type LineMode, type LinePosition, type ProgressionPattern,
} from '../exercises';

export type LineVolume = 1 | 2 | 3;
export interface LineDraft { readonly root: string; readonly mode: LineMode; readonly position: LinePosition; readonly bars: readonly LineBar[] }

/** Рисунки объёма 1: тоники, тоника и квинта, октавы; объёма 2 — плюс тоники с подходом и арпеджио; объёма 3 — все. */
const VOLUME_1_PATTERNS: readonly string[] = ['roots', 'root-fifth', 'octaves'];
const VOLUME_2_PATTERNS: readonly string[] = [...VOLUME_1_PATTERNS, 'roots-approach', 'arpeggio'];
const VOLUME_2_CHORDS: readonly LineChord[] = ['major-triad', 'minor-triad', 'dominant-seventh'];
const STANDARD_STEPS: readonly number[] = [0, 5, 7, 0];

export const VOLUME_TITLES: Readonly<Record<LineVolume, string>> = { 1: 'I–IV–V–I, рисунки этапа 1', 2: 'до восьми тактов, любые аккорды', 3: 'все рисунки и ритм на такт' };

/** Линия объёма 1: тональность, такты I–IV–V–I мажорными трезвучиями, рисунок «тоники». */
export function newLineDraft(root = 'G'): LineDraft {
  return { root, mode: 'major', position: 'closed', bars: STANDARD_STEPS.map(step => ({ step, chord: 'major-triad', pattern: 'roots', rhythm: 'eighths' })) };
}

/** Наименьший объём, в который укладывается линия (аккорды, рисунки и ритмы тактов). */
export function lineVolume(draft: Pick<LineDraft, 'mode' | 'bars'>): LineVolume {
  const { bars } = draft;
  const eighths = bars.every(bar => bar.rhythm === 'eighths');
  if (draft.mode === 'major' && eighths && bars.length === STANDARD_STEPS.length && bars.every((bar, index) => bar.step === STANDARD_STEPS[index] && bar.chord === 'major-triad' && VOLUME_1_PATTERNS.includes(bar.pattern))) return 1;
  if (eighths && bars.length >= 2 && bars.length <= 8 && bars.every(bar => VOLUME_2_CHORDS.includes(bar.chord) && VOLUME_2_PATTERNS.includes(bar.pattern))) return 2;
  return 3;
}

/** Рисунки, которые конструктор объёма предлагает для вида аккорда: недопустимое сочетание не предлагается. */
export function patternsFor(volume: LineVolume, chord: LineChord): readonly ProgressionPattern[] {
  const allowed = volume === 1 ? VOLUME_1_PATTERNS : volume === 2 ? VOLUME_2_PATTERNS : null;
  return PROGRESSION_PATTERNS.filter(pattern => (allowed === null || allowed.includes(pattern)) && patternFits(pattern, chord));
}

export const setLineRoot = (draft: LineDraft, root: string): LineDraft => ({ ...draft, root });
export function setBarPattern(draft: LineDraft, index: number, pattern: ProgressionPattern): LineDraft {
  if (!Number.isInteger(index) || index < 0 || index >= draft.bars.length) throw new RangeError('Нет такого такта.');
  return { ...draft, bars: draft.bars.map((bar, at) => (at === index ? { ...bar, pattern } : bar)) };
}

/** Описание упражнения по черновику; недопустимое — `RangeError` из строгой проверки шаблона. */
export const lineSpec = (draft: LineDraft): ExerciseSpec => createExerciseSpec('line', { root: draft.root, mode: draft.mode, position: draft.position, bars: draft.bars });

/** Та же линия в другой тональности: тело (лад, позиция, такты) сохраняется, позиции тоник пересчитываются (B5.5). */
export function transposeLine(spec: ExerciseSpec, root: string): ExerciseSpec {
  if (spec.templateId !== 'line') throw new RangeError('Переносится только «Своя линия».');
  return createExerciseSpec('line', { ...spec.params, root });
}
