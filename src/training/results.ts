import type { QuestionContext, QuizResult } from './index';
import type { BoxSelection } from '../music/boxes';
import type { RhythmPlaybackConfig } from '../rhythm/model';

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
  | { readonly kind: 'harmony'; readonly patternId: 'CFGC-1-3-5-3-v1' }
  | RhythmPracticeMaterial;

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
  readonly context: QuestionContext | null;
  readonly material: PracticeMaterial;
}

export type TrainingResult = QuizResult | ManualPracticeResult;

export function createManualPracticeResult(input: {
  context: QuestionContext | null;
  comfortableBpm: number;
  durationMs: number;
  note?: string;
  material: PracticeMaterial;
}): ManualPracticeResult {
  if (!input.material) throw new RangeError('Для ручной отметки нужен материал практики.');
  const [minBpm, maxBpm] = manualTempoBounds(input.material);
  if (!Number.isInteger(input.comfortableBpm) || input.comfortableBpm < minBpm || input.comfortableBpm > maxBpm) {
    throw new RangeError(`Комфортный темп должен быть целым числом от ${minBpm} до ${maxBpm} BPM.`);
  }
  if ((input.context === null) !== (input.material?.kind === 'rhythm')) throw new RangeError('Контекст должен соответствовать материалу ручной практики.');
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
    context: input.context === null ? null : Object.freeze({ ...input.context, positionIds: Object.freeze([...input.context.positionIds]) }),
    material: freezeMaterial(structuredClone(input.material)),
  });
}
