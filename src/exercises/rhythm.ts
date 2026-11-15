/**
 * Шкала прохода упражнения (D-050): ноты плана ложатся на ритмический рисунок, проход завершается тоникой
 * и добивается паузой до целого такта, поэтому каждый проход начинается с «раз». Чистые вычисления:
 * шкалу читают звук (`PlaybackConfig.steps`), TAB, строка ритма и подсветка экрана игры.
 */
import type { ExercisePlan } from './index';

export type RhythmPatternId = 'eighths' | 'quarters' | 'sixteenths' | 'syncopation' | 'shuffle';

export interface RhythmPattern {
  readonly id: RhythmPatternId;
  readonly label: string;
  /** Длительности нот по кругу, в шестнадцатых; сумма делит такт. */
  readonly cells: readonly number[];
  /** Свинг слабой восьмой, % (50 — ровно). */
  readonly swing: number;
}

export const RHYTHM_PATTERNS: readonly RhythmPattern[] = Object.freeze(([
  { id: 'eighths', label: 'Восьмые', cells: [2], swing: 50 },
  { id: 'quarters', label: 'Четверти', cells: [4], swing: 50 },
  { id: 'sixteenths', label: 'Шестнадцатые', cells: [1], swing: 50 },
  { id: 'syncopation', label: 'Синкопа 8–4–8', cells: [2, 4, 2], swing: 50 },
  { id: 'shuffle', label: 'Шаффл (свинг-восьмые)', cells: [2], swing: 66 },
] satisfies RhythmPattern[]).map(pattern => Object.freeze({ ...pattern, cells: Object.freeze([...pattern.cells]) })));

export const isRhythmPatternId = (value: unknown): value is RhythmPatternId => RHYTHM_PATTERNS.some(pattern => pattern.id === value);
export const rhythmPattern = (id: RhythmPatternId): RhythmPattern => RHYTHM_PATTERNS.find(pattern => pattern.id === id)!;

/**
 * Рисунки, доступные материалу. У последовательности аккордов такт — это аккорд из восьми восьмых, поэтому
 * только ровные или свинговые восьмые; у фрагмента песни ритм задан партитурой.
 */
export function rhythmPatternsFor(plan: Pick<ExercisePlan, 'spec'>): readonly RhythmPatternId[] {
  if (plan.spec.templateId === 'progression') return ['eighths', 'shuffle'];
  return RHYTHM_PATTERNS.map(pattern => pattern.id);
}

export interface TimelineStep {
  /** Индекс ноты плана; `null` — пауза. */
  readonly note: number | null;
  /** Длительность, шестнадцатые. */
  readonly grids: number;
  /** Эталон звучит (в такте «эха» — молчит). */
  readonly audible: boolean;
  /** Начало от начала прохода, шестнадцатые. */
  readonly start: number;
  readonly bar: number;
  /** Доля в такте от 0 (может быть дробной: 0.5 — «и»). */
  readonly beatInBar: number;
  /** Нота — завершение прохода тоникой (не из основной последовательности). */
  readonly landing: boolean;
  /** Такт «эха»: повтор предыдущего такта без эталона. */
  readonly echo: boolean;
}

export interface Timeline {
  readonly steps: readonly TimelineStep[];
  readonly passGrids: number;
  readonly bars: number;
  readonly pattern: RhythmPatternId;
  readonly swing: number;
  readonly echo: boolean;
}

export interface TimelineOptions {
  readonly pattern?: RhythmPatternId;
  /** Каждый такт повторяется тактом тишины эталона для повтора («услышь — сыграй»). */
  readonly echo?: boolean;
}

const BAR = 16;

/** Ближайшая по высоте к `last` нота плана со ступенью 1 (при равенстве — ниже). */
function landingNote(plan: Pick<ExercisePlan, 'notes'>, last: number): number | null {
  const target = plan.notes[last];
  if (target.degree === '1') return null;
  let best: number | null = null;
  plan.notes.forEach((note, index) => {
    if (note.degree !== '1') return;
    if (best === null) { best = index; return; }
    const distance = Math.abs(note.midi - target.midi), current = Math.abs(plan.notes[best].midi - target.midi);
    if (distance < current || (distance === current && note.midi < plan.notes[best].midi)) best = index;
  });
  return best;
}

export function buildTimeline(plan: Pick<ExercisePlan, 'spec' | 'notes' | 'segments' | 'cadence'>, options: TimelineOptions = {}): Timeline {
  const allowed = rhythmPatternsFor(plan);
  const patternId = options.pattern && allowed.includes(options.pattern) ? options.pattern : allowed[0];
  const pattern = rhythmPattern(patternId);
  const raw: { note: number | null; grids: number; landing: boolean }[] = [];
  let at = 0;
  const push = (note: number | null, grids: number, landing = false) => { raw.push({ note, grids, landing }); at += grids; };
  if (plan.spec.templateId === 'progression') {
    // Такт — аккорд: ноты сегмента заполняют свой такт, следующий аккорд начинается с «раз».
    plan.notes.forEach((note, index) => {
      push(index, pattern.cells[0]);
      const nextSegment = plan.notes[index + 1]?.segment;
      if (nextSegment !== note.segment && at % BAR) push(null, BAR - (at % BAR));
    });
  } else {
    plan.notes.forEach((_, index) => push(index, pattern.cells[index % pattern.cells.length]));
    const landing = plan.cadence === 'tonic' ? landingNote(plan, plan.notes.length - 1) : null;
    if (landing !== null) push(landing, pattern.cells[plan.notes.length % pattern.cells.length], true);
    // Последняя нота тянется до доли, остаток такта — пауза.
    const last = raw[raw.length - 1];
    const toBeat = (4 - (at % 4)) % 4;
    if (toBeat) { last.grids += toBeat; at += toBeat; }
    if (at % BAR) push(null, BAR - (at % BAR));
  }
  const bars = at / BAR;
  const steps: TimelineStep[] = [];
  const place = (source: typeof raw, bar: number, echo: boolean) => {
    let start = 0;
    for (const step of source) {
      steps.push({ note: step.note, grids: step.grids, audible: !echo, start: bar * BAR + start, bar, beatInBar: start / 4, landing: step.landing, echo });
      start += step.grids;
    }
  };
  // Раскладка по тактам: шаги не пересекают тактовую черту (все рисунки делят такт).
  const byBar: (typeof raw)[] = Array.from({ length: bars }, () => []);
  let cursor = 0;
  for (const step of raw) { byBar[Math.floor(cursor / BAR)].push(step); cursor += step.grids; }
  let bar = 0;
  for (const source of byBar) {
    place(source, bar++, false);
    if (options.echo) place(source, bar++, true);
  }
  const totalBars = options.echo ? bars * 2 : bars;
  return Object.freeze({
    steps: Object.freeze(steps.map(step => Object.freeze(step))), passGrids: totalBars * BAR, bars: totalBars,
    pattern: patternId, swing: pattern.swing, echo: options.echo === true,
  });
}

/** Шаги тактов [fromBar, toBar) — фрагмент для петли в индексах шагов. */
export function barStepRange(timeline: Pick<Timeline, 'steps'>, fromBar: number, toBarExclusive: number): { from: number; toExclusive: number } | null {
  const from = timeline.steps.findIndex(step => step.bar >= fromBar);
  if (from < 0) return null;
  let toExclusive = timeline.steps.length;
  for (let index = from; index < timeline.steps.length; index++) if (timeline.steps[index].bar >= toBarExclusive) { toExclusive = index; break; }
  return toExclusive > from ? { from, toExclusive } : null;
}
