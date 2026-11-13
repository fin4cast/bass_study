/**
 * Мостики «Грифа» (P13-08, D-043): из изучаемой формы — упражнение для экрана игры и «Проверь себя» по её материалу.
 * Чистый модуль без DOM, звука и хранилища. Упражнения каталога `exercise-v1` строятся на нижнем полном экземпляре
 * формы (дополнение R-026), поэтому выбранный выше по грифу экземпляр честно называется в пояснении.
 */
import { createExerciseSpec, type ExerciseSpec } from '../exercises';
import type { StructureId } from '../music';
import { getBoxCatalogue, getBoxInstance, type BoxSelection } from '../music/boxes';
import type { CheckSpec } from '../practice/plan';

export interface AtlasStudy {
  readonly root: string;
  readonly structureId: StructureId;
  readonly box: BoxSelection | null;
}

export interface AtlasBridge {
  /** Упражнение по форме; `null` — для выбранного материала упражнения нет. */
  readonly exercise: ExerciseSpec | null;
  /** «Проверь себя» по материалу этого упражнения: вопросы о ступенях, вид меняется на экране проверки. */
  readonly check: CheckSpec | null;
  /** Почему мостики недоступны (пусто, если доступны). */
  readonly reason: string;
  /** Уточнение для доступных мостиков: какой экземпляр формы играет упражнение. */
  readonly note: string;
}

/** Число вопросов «Проверь себя» по форме — как у шага плана. */
export const ATLAS_CHECK_COUNT = 6;

const PENTATONIC: readonly StructureId[] = ['minor-pentatonic', 'major-pentatonic'];
const SCALES: readonly StructureId[] = ['major', 'natural-minor'];
const TRIADS: readonly StructureId[] = ['major-triad', 'minor-triad', 'diminished-triad'];
const SEVENTHS: readonly StructureId[] = ['major-seventh', 'dominant-seventh', 'minor-seventh', 'half-diminished-seventh'];

function exerciseFor(study: AtlasStudy, box: BoxSelection): ExerciseSpec | null {
  const shape = box.shapeId;
  if (PENTATONIC.includes(study.structureId) && shape.startsWith('penta-')) {
    return createExerciseSpec('pentatonic-form', { root: study.root, structureId: study.structureId as 'minor-pentatonic' | 'major-pentatonic', shapeId: shape as 'penta-a' });
  }
  if (shape !== 'compact-e' && shape !== 'compact-a') return null;
  if (SCALES.includes(study.structureId)) return createExerciseSpec('scale-compact', { root: study.root, structureId: study.structureId as 'major' | 'natural-minor', shapeId: shape });
  if (TRIADS.includes(study.structureId)) return createExerciseSpec('arpeggio-1358', { root: study.root, structureId: study.structureId as 'major-triad', shapeId: shape });
  if (SEVENTHS.includes(study.structureId)) return createExerciseSpec('arpeggio-seventh', { root: study.root, structureId: study.structureId as 'dominant-seventh', shapeId: shape });
  if (study.structureId === 'blues') return createExerciseSpec('blues-scale', { root: study.root, shapeId: shape });
  return null;
}

export function atlasBridge(study: AtlasStudy): AtlasBridge {
  if (!study.box) return Object.freeze({ exercise: null, check: null, reason: 'Выбери учебную форму: упражнение и проверка идут по точной форме.', note: '' });
  let exercise: ExerciseSpec | null;
  try { exercise = exerciseFor(study, study.box); }
  catch { exercise = null; }
  if (!exercise) return Object.freeze({ exercise: null, check: null, reason: 'Для этой формы в каталоге упражнений нет шаблона.', note: '' });
  const selected = getBoxInstance(study.box);
  const lowest = getBoxCatalogue(study.box.root, study.box.structureId).find(box => box.selection.shapeId === study.box!.shapeId);
  const note = lowest && lowest.window.fretMin !== selected.window.fretMin
    ? `Упражнение и проверка — по нижнему экземпляру этой формы: лады ${lowest.window.fretMin}–${lowest.window.fretMax}.`
    : '';
  const check: CheckSpec = Object.freeze({ version: 'check-v1', exercise, kind: 'find-degree', count: ATLAS_CHECK_COUNT, ear: false });
  return Object.freeze({ exercise, check, reason: '', note });
}
