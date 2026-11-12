/**
 * Рекомендации вкладки «Сегодня» (VIS-10): до трёх, по детерминированным правилам, с объяснением «почему».
 * 1) следующая связка после сыгранной связки форм; 2) первое трудное место; 3) понятие последнего упражнения.
 */
import { createExerciseSpec, EXERCISE_TEMPLATES, type ConceptId, type ExerciseSpec } from '../exercises';
import { difficulties, type PlayRecord, type PracticeRecord } from './results';

export interface Recommendation {
  readonly kind: 'next' | 'repeat' | 'concept';
  readonly title: string;
  readonly reason: string;
  readonly spec: ExerciseSpec | null;
  readonly exerciseKey: string | null;
  readonly concept: ConceptId | null;
}

const SHAPES = ['penta-a', 'penta-b', 'penta-c', 'penta-d', 'penta-e'] as const;
const LETTER: Record<(typeof SHAPES)[number], string> = { 'penta-a': 'A', 'penta-b': 'B', 'penta-c': 'C', 'penta-d': 'D', 'penta-e': 'E' };

export function recommend(records: readonly PracticeRecord[]): readonly Recommendation[] {
  const result: Recommendation[] = [];
  const plays = records.filter((record): record is PlayRecord => record.kind === 'play').sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const last = plays.at(-1) ?? null;

  if (last?.spec.templateId === 'connect-forms') {
    const params = last.spec.params as { root: string; structureId: 'minor-pentatonic' | 'major-pentatonic'; shapeId: (typeof SHAPES)[number] };
    const index = SHAPES.indexOf(params.shapeId);
    const from = SHAPES[(index + 1) % SHAPES.length];
    const to = SHAPES[(index + 2) % SHAPES.length];
    try {
      const spec = createExerciseSpec('connect-forms', { ...params, shapeId: from });
      result.push({ kind: 'next', title: `Связка ${LETTER[from]} → ${LETTER[to]}`, reason: `Та же пентатоника ${params.root}, следующая пара форм.`, spec, exerciseKey: null, concept: 'shared-notes' });
    } catch { /* Следующая пара не помещается на грифе — рекомендация пропускается. */ }
  }

  const hard = difficulties(records)[0];
  if (hard) {
    const reason = hard.kind === 'errors' ? `В прошлые разы ты отметил «С ошибками» (${hard.count}).`
      : hard.kind === 'slow' ? `На ${hard.bpm} BPM ты отметил «Не успевал»${hard.bestCleanBpm ? `, чисто — ${hard.bestCleanBpm}` : ''}.`
      : `Ступень ${hard.degree.replace('b', '♭')}: ошибок или показов — ${hard.count}.`;
    const source = plays.find(record => record.exerciseKey === hard.exerciseKey);
    result.push({ kind: 'repeat', title: `Повтори: ${hard.title}`, reason, spec: source?.spec ?? null, exerciseKey: hard.exerciseKey, concept: null });
  }

  if (last) {
    const template = EXERCISE_TEMPLATES.find(item => item.id === last.spec.templateId);
    const concept = template?.concepts[0] ?? null;
    if (concept) result.push({ kind: 'concept', title: 'Понятие к последнему упражнению', reason: `Связано с «${last.title}».`, spec: null, exerciseKey: null, concept });
  }
  return Object.freeze(result.slice(0, 3).map(item => Object.freeze(item)));
}
