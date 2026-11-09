import { annotatePositions, getPositions, type AnnotatedPosition, type StringId } from '../music';
import type { BoxInstance } from '../music/boxes';

interface StudyWindow {
  readonly strings: readonly StringId[];
  readonly fretMin: number;
  readonly fretMax: number;
}

type Structure = Parameters<typeof annotatePositions>[1];

export function studyWindow(structure: Structure, window: StudyWindow | null): readonly AnnotatedPosition[] {
  return window ? annotatePositions(getPositions(window), structure) : [];
}

export function studyExerciseMaterial(structure: Structure, positions: readonly AnnotatedPosition[], box: BoxInstance | null) {
  if (!box) return { exact: positions, interval: positions };
  const strings = [...new Set(box.positions.map(position => position.string))];
  return { exact: box.positions, interval: studyWindow(structure, { ...box.window, strings }) };
}
