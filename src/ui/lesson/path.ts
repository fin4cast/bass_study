/**
 * Путь программы для вкладки «Основы» (R-028): этапы, линии, блоки и шаги с вариантами и статусами.
 * Чистая модель без DOM: данные приходят из `practice/program` (статусы вычислены по истории).
 */
import { checkExercise } from '../../practice/check';
import { getConcept } from '../../practice/concepts';
import {
  LINES, isDone, type Block, type Counts, type LineId, type Program, type ProgramState, type Step, type StepState,
} from '../../practice/program';
import { materialLabel } from './material';

export const STATE_LABELS: Readonly<Record<StepState, string>> = Object.freeze({
  new: 'не начат', progress: 'в работе', passed: 'пройден', mastered: 'освоен', skipped: 'пропущен',
});

/** «пройдено 5 · пропущено 2 · освоено 1 из 9» (и «повторить N», если есть). */
export function countsLabel(counts: Counts): string {
  return `пройдено ${counts.passed} · пропущено ${counts.skipped} · освоено ${counts.mastered}${counts.review ? ` · повторить ${counts.review}` : ''} из ${counts.total}`;
}

export interface PathVariant { readonly label: string; readonly clean: boolean }
export interface PathStep {
  readonly id: string;
  readonly kind: Step['kind'];
  readonly title: string;
  readonly state: StepState;
  /** «освоен · 84», «пройден», «в работе»… */
  readonly label: string;
  readonly review: boolean;
  readonly current: boolean;
  readonly variants: readonly PathVariant[];
  /** Вариант, который откроется: выбранный или первый без «Чисто». */
  readonly selected: number;
}
export interface PathBlock {
  readonly id: string;
  readonly title: string;
  readonly counts: string;
  readonly skipped: boolean;
  readonly cards: readonly { readonly id: string; readonly title: string }[];
  readonly steps: readonly PathStep[];
}
export interface PathLine { readonly id: LineId; readonly title: string; readonly counts: string; readonly done: boolean; readonly blocks: readonly PathBlock[] }
export interface PathStage { readonly number: number; readonly title: string; readonly counts: string; readonly lines: readonly PathLine[] }

function variantsOf(step: Step, clean: readonly number[]): PathVariant[] {
  if (step.kind === 'play') return step.variants.map((variant, index) => ({ label: materialLabel(variant), clean: clean.includes(index) }));
  if (step.kind === 'check') {
    const material = checkExercise(step.check);
    const area = step.check.area;
    return [{ label: material ? materialLabel(material) : area.type === 'range' ? `струны ${area.strings.join(', ')} · лады ${area.fretMin}–${area.fretMax}` : '', clean: clean.length > 0 }];
  }
  return [];
}

/** Модель пути: `picks` — варианты, выбранные пользователем (ID шага → индекс). */
export function pathModel(program: Program, state: ProgramState, skipped: ReadonlySet<string>, picks: ReadonlyMap<string, number> = new Map()): readonly PathStage[] {
  const currentIds = new Set(Object.values(state.current).filter(Boolean).map(ref => ref!.step.id));
  const stepView = (step: Step): PathStep => {
    const status = state.statuses.get(step.id);
    const stateName: StepState = status?.state ?? 'new';
    const variants = variantsOf(step, status?.cleanVariants ?? []);
    const firstOpen = variants.findIndex(variant => !variant.clean);
    const picked = picks.get(step.id);
    const selected = picked !== undefined && picked >= 0 && picked < variants.length ? picked : Math.max(0, firstOpen);
    const label = stateName === 'mastered' && status?.bestCleanBpm ? `${STATE_LABELS.mastered} · ${status.bestCleanBpm}` : STATE_LABELS[stateName];
    return { id: step.id, kind: step.kind, title: step.title, state: stateName, label, review: status?.review ?? false, current: currentIds.has(step.id), variants, selected };
  };
  const blockView = (block: Block): PathBlock => ({
    id: block.id, title: block.title, counts: countsLabel(state.blockCounts.get(block.id)!), skipped: skipped.has(block.id),
    cards: block.cards.flatMap(id => { const concept = getConcept(id); return concept ? [{ id, title: concept.title }] : []; }),
    steps: block.steps.map(stepView),
  });
  return program.stages.map(stage => ({
    number: stage.number, title: stage.title, counts: countsLabel(state.stageCounts.get(stage.number)!),
    lines: LINES.map(line => ({
      id: line.id, title: line.title, counts: countsLabel(state.lineCounts.get(`${stage.number}:${line.id}`)!), done: isDone(state.lineCounts.get(`${stage.number}:${line.id}`)!),
      blocks: stage.blocks.filter(block => block.line === line.id).map(blockView),
    })),
  }));
}

/** Бейдж вкладки «Основы»: сколько обязательных шагов пройдено или пропущено из всех. */
export function pathBadge(state: ProgramState): string {
  let done = 0;
  let total = 0;
  for (const counts of state.stageCounts.values()) { done += counts.passed + counts.skipped; total += counts.total; }
  return `${done}/${total}`;
}
