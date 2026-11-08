import type { QuestionContext, QuizResult } from './index';
import type { BoxSelection } from '../music/boxes';

export type PracticeMaterial = {
  readonly kind: 'sequence';
  readonly pattern: 'ascending' | 'descending' | 'round-trip' | 'groups-of-three';
  readonly routePositionIds: readonly string[];
  readonly duration: 'quarter' | 'eighth' | 'sixteenth';
  readonly fragment: { readonly from: number; readonly toExclusive: number };
  readonly box: BoxSelection | null;
} | { readonly kind: 'fretboard'; readonly box: BoxSelection | null }
  | { readonly kind: 'harmony'; readonly patternId: 'CFGC-1-3-5-3-v1' };
export type StoredPracticeMaterial = PracticeMaterial | { readonly kind: 'legacy-unknown' };
function freezeMaterial<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeMaterial); Object.freeze(value); }
  return value;
}

/** A person's report about practice is deliberately not an instrument accuracy score. */
export interface ManualPracticeResult {
  readonly kind: 'manual';
  readonly source: 'self-report';
  readonly comfortableBpm: number;
  readonly durationMs: number;
  readonly note: string;
  readonly context: QuestionContext;
  readonly material: StoredPracticeMaterial;
}

export type TrainingResult = QuizResult | ManualPracticeResult;

export function createManualPracticeResult(input: {
  context: QuestionContext;
  comfortableBpm: number;
  durationMs: number;
  note?: string;
  material?: StoredPracticeMaterial;
}): ManualPracticeResult {
  if (!Number.isInteger(input.comfortableBpm) || input.comfortableBpm < 40 || input.comfortableBpm > 220) {
    throw new RangeError('Комфортный темп должен быть целым числом от 40 до 220 BPM.');
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) throw new RangeError('Продолжительность занятия должна быть неотрицательной.');
  if (input.material?.kind === 'fretboard' && input.durationMs !== 0) throw new RangeError('Изучение грифа не измеряет длительность воспроизведения.');
  const note = input.note ?? '';
  if (typeof note !== 'string' || note.length > 2000) throw new RangeError('Заметка должна содержать не более 2000 символов.');
  return Object.freeze({
    kind: 'manual',
    source: 'self-report',
    comfortableBpm: input.comfortableBpm,
    durationMs: input.durationMs,
    note,
    context: Object.freeze({ ...input.context, positionIds: Object.freeze([...input.context.positionIds]) }),
    material: freezeMaterial(structuredClone(input.material ?? { kind: 'legacy-unknown' as const })),
  });
}
