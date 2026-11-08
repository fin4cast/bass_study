import type { QuestionContext, QuizResult } from './index';

/** A person's report about practice is deliberately not an instrument accuracy score. */
export interface ManualPracticeResult {
  readonly kind: 'manual';
  readonly source: 'self-report';
  readonly comfortableBpm: number;
  readonly durationMs: number;
  readonly note: string;
  readonly context: QuestionContext;
}

export type TrainingResult = QuizResult | ManualPracticeResult;

export function createManualPracticeResult(input: {
  context: QuestionContext;
  comfortableBpm: number;
  durationMs: number;
  note?: string;
}): ManualPracticeResult {
  if (!Number.isInteger(input.comfortableBpm) || input.comfortableBpm < 40 || input.comfortableBpm > 220) {
    throw new RangeError('Комфортный темп должен быть целым числом от 40 до 220 BPM.');
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) throw new RangeError('Продолжительность занятия должна быть неотрицательной.');
  const note = input.note ?? '';
  if (typeof note !== 'string' || note.length > 2000) throw new RangeError('Заметка должна содержать не более 2000 символов.');
  return Object.freeze({
    kind: 'manual',
    source: 'self-report',
    comfortableBpm: input.comfortableBpm,
    durationMs: input.durationMs,
    note,
    context: Object.freeze({ ...input.context, positionIds: Object.freeze([...input.context.positionIds]) }),
  });
}
