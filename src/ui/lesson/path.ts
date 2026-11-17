/**
 * Путь программы для вкладки «Основы» (R-028): этапы, линии, блоки и шаги с вариантами и статусами.
 * Чистая модель без DOM: данные приходят из `practice/program` (статусы вычислены по истории).
 */
import { checkExercise } from '../../practice/check';
import { getConcept } from '../../practice/concepts';
import {
  LINES, STATE_LABELS, countsLabel, isDone, statusLabel, type Block, type Counts, type LineId, type Program, type ProgramState, type Step, type StepState,
} from '../../practice/program';
import { materialLabel } from './material';

export { STATE_LABELS, countsLabel };

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
  /** Объём конструктора «Своей линии» для шага `line` (1 — `h1-line`, 2 — `h2-own`); у остальных шагов `null`. */
  readonly builderVolume: 1 | 2 | null;
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
    const label = status ? statusLabel(status) : STATE_LABELS.new;
    return { id: step.id, kind: step.kind, title: step.title, state: stateName, label, review: status?.review ?? false, current: currentIds.has(step.id), variants, selected,
      builderVolume: step.kind === 'line' ? (step.rule === 'h1-line' ? 1 : step.rule === 'h2-own' ? 2 : null) : null };
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

/** Строка этапа под «Сегодня»: «Этап 1 · пройдено 3 · освоено 1»; этап — тот, где сейчас текущий шаг ближайшей линии. */
export function stageLine(state: ProgramState): string | null {
  const stages = Object.values(state.current).filter(Boolean).map(ref => ref!.stage);
  if (!stages.length) return null;
  const number = Math.min(...stages);
  const counts = state.stageCounts.get(number);
  return counts ? `Этап ${number} · пройдено ${counts.passed} · освоено ${counts.mastered}` : null;
}

/** Текущий шаг «Своя линия»: в план дня он не входит (строится в конструкторе), поэтому «Сегодня» предлагает его отдельной строкой. */
export function currentLineStep(state: ProgramState): { id: string; title: string; volume: 1 | 2 | null } | null {
  for (const ref of Object.values(state.current)) {
    const step = ref?.step;
    if (step?.kind !== 'line') continue;
    return { id: step.id, title: step.title, volume: step.rule === 'h1-line' ? 1 : step.rule === 'h2-own' ? 2 : null };
  }
  return null;
}

/** Бейдж вкладки «Основы»: сколько обязательных шагов пройдено или пропущено из всех. */
export function pathBadge(state: ProgramState): string {
  let done = 0;
  let total = 0;
  for (const counts of state.stageCounts.values()) { done += counts.passed + counts.skipped; total += counts.total; }
  return `${done}/${total}`;
}
