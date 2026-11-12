import type { QuestionContext, QuizResult } from './index';
import type { BoxSelection } from '../music/boxes';
import type { RhythmPlaybackConfig } from '../rhythm/model';
import type { ExerciseSpec } from '../exercises';
import type { Assessment } from '../practice/results';

export interface RhythmPracticeMaterial {
  readonly kind: 'rhythm';
  readonly playback: RhythmPlaybackConfig;
}

export type PracticeMaterial = {
  readonly kind: 'sequence';
  readonly pattern: 'ascending' | 'descending' | 'round-trip' | 'groups-of-three';
  readonly routePositionIds: readonly string[];
  readonly duration: 'quarter' | 'eighth' | 'sixteenth';
  readonly fragment: { readonly from: number; readonly toExclusive: number };
  readonly box: BoxSelection | null;
} | { readonly kind: 'fretboard'; readonly box: BoxSelection | null }
  | RhythmPracticeMaterial
  | ExercisePracticeMaterial;

/** Виды экрана игры (VIS-11): от «Гриф крупно» до «По памяти». */
export const EXERCISE_VIEWS = Object.freeze(['board', 'both', 'tab', 'memory'] as const);
export type ExerciseView = typeof EXERCISE_VIEWS[number];

/** Проход упражнения на экране игры (R-026): ключ библиотеки, название и полное описание на момент прохода. */
export interface ExercisePracticeMaterial {
  readonly kind: 'exercise';
  /** `builtin:<шаблон>` или `user:<id>`. */
  readonly key: string;
  readonly title: string;
  readonly spec: ExerciseSpec;
  readonly view: ExerciseView;
}

export function manualTempoBounds(material?: PracticeMaterial): readonly [number, number] {
  return material?.kind === 'rhythm' ? [30, 240] : [40, 220];
}

export function rhythmPracticeLabel(material: RhythmPracticeMaterial): string {
  const { preferences, project } = material.playback;
  if (preferences.view === 'metronome') {
    const { meter, bpm, bpmUnit } = preferences.metronome;
    const unit = { quarter: '♩', eighth: '♪', 'dotted-quarter': '♩.' }[bpmUnit];
    return `Метроном · ${meter.beats}/${meter.denominator} · ${unit} = ${bpm}`;
  }
  if (!project) return 'Ритм-секция';
  const pattern = project.patterns.find(item => item.id === project.activePatternId);
  const scope = project.scope === 'chain' ? 'Цепочка' : pattern?.name ?? 'Паттерн';
  return `Ритм-секция · ${project.name} · ${scope} · ${project.bpm} BPM`;
}
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
  /** Самооценка прохода упражнения; у прочих материалов — null. */
  readonly assessment: Assessment | null;
  readonly context: QuestionContext | null;
  readonly material: PracticeMaterial;
}

export type TrainingResult = QuizResult | ManualPracticeResult;

export function createManualPracticeResult(input: {
  context: QuestionContext | null;
  comfortableBpm: number;
  durationMs: number;
  note?: string;
  assessment?: Assessment | null;
  material: PracticeMaterial;
}): ManualPracticeResult {
  if (!input.material) throw new RangeError('Для ручной отметки нужен материал практики.');
  const [minBpm, maxBpm] = manualTempoBounds(input.material);
  if (!Number.isInteger(input.comfortableBpm) || input.comfortableBpm < minBpm || input.comfortableBpm > maxBpm) {
    throw new RangeError(`Комфортный темп должен быть целым числом от ${minBpm} до ${maxBpm} BPM.`);
  }
  const withoutBoard = input.material.kind === 'rhythm' || input.material.kind === 'exercise';
  if ((input.context === null) !== withoutBoard) throw new RangeError('Контекст должен соответствовать материалу ручной практики.');
  const assessment = input.assessment ?? null;
  if (input.material.kind === 'exercise' ? !['clean', 'errors', 'slow'].includes(assessment as string) : assessment !== null) {
    throw new RangeError('Самооценка «Чисто / С ошибками / Не успевал» обязательна для прохода упражнения и не применяется к другим материалам.');
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
    assessment,
    context: input.context === null ? null : Object.freeze({ ...input.context, positionIds: Object.freeze([...input.context.positionIds]) }),
    material: freezeMaterial(structuredClone(input.material)),
  });
}
