import { annotatePositions, getPositions, type AnnotatedPosition, type StringId } from '../music';

interface StudyWindow {
  readonly strings: readonly StringId[];
  readonly fretMin: number;
  readonly fretMax: number;
}

type Structure = Parameters<typeof annotatePositions>[1];

export function studyWindow(structure: Structure, window: StudyWindow | null): readonly AnnotatedPosition[] {
  return window ? annotatePositions(getPositions(window), structure) : [];
}
