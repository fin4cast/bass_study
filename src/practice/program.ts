/**
 * Программа обучения (R-028, D-051): этапы → линии → блоки → шаги. Чистая модель без DOM и хранилища:
 * статусы шагов, текущие шаги линий, счётчики, «пора повторить» и состав занятия вычисляются из фактов
 * (нормализованных записей истории) и нигде не записываются. Данные этапов — `program-data.ts`.
 */
import { buildExercise, type ExerciseSpec } from '../exercises';
import { buildTimeline, samePractice, type PracticeOptions } from '../exercises/rhythm';
import type { TemplateTask } from '../exercises/tasks';
import { checkId, degreeCheck, type CheckSpec } from './check';
import { materialId } from './material';
import type { NewPlanStep, PlanStepContent } from './plan';
import type { PlayRecord, PracticeRecord } from './results';

/** Базовый темп программы: с него открывается шаг и по нему считается «освоен». */
export const BASE_BPM = 60;
/** Пройден — «Чисто» в стольких разных вариантах (у шага с меньшим числом вариантов — во всех). */
export const REQUIRED_VARIANTS = 2;
/** Освоен — проходы приходятся на столько разных дней. */
export const MASTERY_DAYS = 2;
/** Освоенный шаг без подтверждения дольше стольких дней — «пора повторить»; перерыв дольше — «Вспомнить». */
export const REVIEW_DAYS = 14;
/** Серия проверки пройдена при стольких верных с первой попытки ответах. */
export const CHECK_PASS = 5;
/** Занятие добирается закреплением, пока плановое время меньше этого. */
export const DAY_TARGET_MINUTES = 12;
export const DAY_MAX_STEPS = 6;

export type LineId = 'technique' | 'fretboard' | 'chords';
export const LINES: readonly { readonly id: LineId; readonly title: string }[] = Object.freeze([
  { id: 'technique', title: 'Техника' }, { id: 'fretboard', title: 'Гриф' }, { id: 'chords', title: 'Аккорды и линии' },
]);

/** Шаблоны, у которых «освоен» считает только проходы в виде «По памяти» (R-028); часть из них появится вместе с шаблонами. */
export const MEMORY_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  'pentatonic-form', 'pentatonic-relative', 'scale-compact', 'scale-position', 'blues-scale', 'arpeggio-1358', 'arpeggio-seventh', 'arpeggio-inversion',
  'note-all-positions', 'octaves', 'string-naturals', 'string-fourths', 'interval-from-note',
]);

/** Шаг «играть»: список вариантов (материалов) и одно «как играть». */
export interface PlayStep {
  readonly kind: 'play';
  readonly id: string;
  readonly title: string;
  readonly variants: readonly ExerciseSpec[];
  readonly practice: PracticeOptions;
  /** Задание шага вместо задания шаблона. */
  readonly task?: TemplateTask;
}
/** Шаг «проверка»: серия из шести вопросов заданного вида. */
export interface CheckStep { readonly kind: 'check'; readonly id: string; readonly title: string; readonly check: CheckSpec }
export type OwnLineRule = 'h1-line' | 'h2-own' | 'h3-line' | 'h4-line';
/** Шаг «Своя линия»: вариантов заранее нет, статус — по правилу шага. */
export interface LineStep { readonly kind: 'line'; readonly id: string; readonly title: string; readonly rule: OwnLineRule }
/** Необязательный шаг «Своя песня»: в счёт не входит, статуса не имеет, текущим не бывает. */
export interface SongStep { readonly kind: 'song'; readonly id: string; readonly title: string }
export type Step = PlayStep | CheckStep | LineStep | SongStep;
export type RequiredStep = PlayStep | CheckStep | LineStep;
export const isRequired = (step: Step): step is RequiredStep => step.kind !== 'song';

export interface Block {
  readonly id: string;
  readonly title: string;
  readonly line: LineId;
  /** Понятия справочника: ссылка «Сначала прочитай» у первого шага блока; результата не хранят и в счёт не входят. */
  readonly cards: readonly string[];
  readonly steps: readonly Step[];
}
export interface Stage { readonly number: number; readonly title: string; readonly blocks: readonly Block[] }
export interface Program { readonly stages: readonly Stage[] }

export interface StepRef { readonly stage: number; readonly block: Block; readonly step: Step; readonly index: number }

/** Все шаги программы по порядку: этап → блок → шаг. */
export function stepRefs(program: Program): readonly StepRef[] {
  const refs: StepRef[] = [];
  for (const stage of program.stages) for (const block of stage.blocks) for (const step of block.steps) refs.push({ stage: stage.number, block, step, index: refs.length });
  return refs;
}

/* ---------- Факты ---------- */

export type FactView = 'board' | 'both' | 'tab' | 'memory';
export type FactAssessment = 'clean' | 'errors' | 'slow';
export interface PlayFact {
  readonly materialId: string;
  readonly practice: PracticeOptions;
  readonly assessment: FactAssessment;
  readonly wholePass: boolean;
  readonly bpm: number;
  /** Локальная дата YYYY-MM-DD. */
  readonly localDate: string;
  readonly view: FactView;
}
export interface CheckFact {
  readonly checkId: string;
  /** Верные с первой попытки ответы. */
  readonly firstTry: number;
  readonly count: number;
  readonly localDate: string;
}
/** Проход «Своей линии»: сведения о линии, которые нужны правилам шагов. */
export interface LineFact {
  /** Объём конструктора, в котором укладывается линия. */
  readonly volume: number;
  /** Состав тактов линии (аккорды, рисунки, ритмы). */
  readonly composition: string;
  readonly tonality: string;
  readonly mode: 'major' | 'minor';
  /** Все такты — рисунок «тоники». */
  readonly allRoots: boolean;
  /** Аккорды — I–IV–V–I. */
  readonly standardChords: boolean;
  /** Есть рисунок вне объёма 2 или ритм не восьмыми. */
  readonly beyondVolume2: boolean;
  readonly assessment: FactAssessment;
  readonly wholePass: boolean;
  readonly bpm: number;
  readonly localDate: string;
}
export interface ProgramFacts {
  readonly plays: readonly PlayFact[];
  readonly checks: readonly CheckFact[];
  readonly lines: readonly LineFact[];
  /** ID блоков с отметкой «Уже умею». */
  readonly skippedBlocks: ReadonlySet<string>;
  /** Сегодня, YYYY-MM-DD. */
  readonly today: string;
}

/** Факты из записей игры; записи с неописуемым материалом пропускаются. */
export function playFacts(records: readonly PracticeRecord[]): PlayFact[] {
  const facts: PlayFact[] = [];
  for (const record of records) {
    if (record.kind !== 'play') continue;
    let id: string;
    try { id = materialId((record as PlayRecord).spec); } catch { continue; }
    facts.push({ materialId: id, practice: record.practice, assessment: record.assessment, wholePass: record.wholePass, bpm: record.bpm, localDate: record.localDate, view: record.view });
  }
  return facts;
}

/**
 * Факты из записей «Проверь себя»: описание проверки восстанавливается из материала, вида вопроса и слуха записи
 * (проверка по материалу упражнения), число вопросов — по числу ответов; верные с первой попытки — без ошибок и показа.
 */
export function checkFacts(records: readonly PracticeRecord[]): CheckFact[] {
  const facts: CheckFact[] = [];
  for (const record of records) {
    if (record.kind !== 'check') continue;
    try {
      const id = checkId(degreeCheck(record.spec, record.checkKind as 'find-degree' | 'name-degree', record.answers.length, record.ear));
      facts.push({ checkId: id, firstTry: record.answers.filter(answer => answer.outcome === 'correct' && answer.errors === 0).length, count: record.answers.length, localDate: record.localDate });
    } catch { /* запись с описанием, которое не строится, шагу не засчитывается */ }
  }
  return facts;
}

/* ---------- Статусы ---------- */

export type StepState = 'new' | 'progress' | 'passed' | 'mastered' | 'skipped';
export interface StepStatus {
  readonly state: StepState;
  /** Индексы вариантов, сыгранных «Чисто» целиком. */
  readonly cleanVariants: readonly number[];
  /** Индексы вариантов, засчитанных в «освоен» (темп не ниже базового, у «по памяти» — в виде «По памяти»). */
  readonly masteredVariants: readonly number[];
  /** Дата последнего засчитанного прохода шага (любой вариант, любая самооценка); `null` — проходов нет. */
  readonly lastDate: string | null;
  /** Последняя дата, засчитанная в «освоен». */
  readonly lastMasteryDate: string | null;
  /** Дата последнего прохода каждого варианта. */
  readonly variantLast: readonly (string | null)[];
  /** Лучший чистый темп; у проверки — `null`. */
  readonly bestCleanBpm: number | null;
  /** «Пора повторить»: освоен, подтверждение старше REVIEW_DAYS. */
  readonly review: boolean;
}

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);
const latest = (dates: readonly string[]) => dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
const distinct = <T>(values: readonly T[]) => [...new Set(values)];

function finish(base: Omit<StepStatus, 'state' | 'review'>, passed: boolean, mastered: boolean, counted: boolean, skipped: boolean, today: string): StepStatus {
  const review = mastered && base.lastMasteryDate !== null && daysBetween(base.lastMasteryDate, today) > REVIEW_DAYS;
  let state: StepState = 'new';
  if (mastered) state = 'mastered';
  else if (passed) state = 'passed';
  else if (skipped) state = 'skipped';
  else if (counted) state = 'progress';
  return Object.freeze({ ...base, state, review });
}

function playStatus(step: PlayStep, facts: ProgramFacts, skipped: boolean): StepStatus {
  const ids = step.variants.map(materialId);
  const counted = facts.plays.filter(fact => ids.includes(fact.materialId) && samePractice(fact.practice, step.practice));
  const clean = counted.filter(fact => fact.assessment === 'clean' && fact.wholePass);
  const memory = (index: number) => MEMORY_TEMPLATE_IDS.has(step.variants[index].templateId);
  const mastery = clean.filter(fact => fact.bpm >= BASE_BPM && (!memory(ids.indexOf(fact.materialId)) || fact.view === 'memory'));
  const cleanVariants = distinct(clean.map(fact => ids.indexOf(fact.materialId))).sort((a, b) => a - b);
  const masteredVariants = distinct(mastery.map(fact => ids.indexOf(fact.materialId))).sort((a, b) => a - b);
  const need = Math.min(REQUIRED_VARIANTS, ids.length);
  const passed = cleanVariants.length >= need;
  const mastered = masteredVariants.length >= need && distinct(mastery.map(fact => fact.localDate)).length >= MASTERY_DAYS;
  return finish({
    cleanVariants, masteredVariants, lastDate: latest(counted.map(fact => fact.localDate)), lastMasteryDate: latest(mastery.map(fact => fact.localDate)),
    variantLast: ids.map(id => latest(counted.filter(fact => fact.materialId === id).map(fact => fact.localDate))),
    bestCleanBpm: clean.length ? Math.max(...clean.map(fact => fact.bpm)) : null,
  }, passed, mastered, counted.length > 0, skipped, facts.today);
}

function checkStatus(step: CheckStep, facts: ProgramFacts, skipped: boolean): StepStatus {
  const id = checkId(step.check);
  const series = facts.checks.filter(fact => fact.checkId === id && fact.count === step.check.count);
  const good = series.filter(fact => fact.firstTry >= CHECK_PASS);
  const days = distinct(good.map(fact => fact.localDate));
  return finish({
    cleanVariants: good.length ? [0] : [], masteredVariants: days.length >= MASTERY_DAYS ? [0] : [], lastDate: latest(series.map(fact => fact.localDate)),
    lastMasteryDate: latest(good.map(fact => fact.localDate)), variantLast: [latest(series.map(fact => fact.localDate))], bestCleanBpm: null,
  }, good.length > 0, days.length >= MASTERY_DAYS, series.length > 0, skipped, facts.today);
}

/** Проходы «Своей линии» «Чисто» целиком; для «освоен» — с темпом не ниже базового. */
function lineStatus(step: LineStep, facts: ProgramFacts, skipped: boolean): StepStatus {
  const clean = (list: readonly LineFact[]) => list.filter(fact => fact.assessment === 'clean' && fact.wholePass);
  // Проходы шага — линии его объёма (по ним «в работе»); засчитываются те, что удовлетворяют условию шага.
  const sameVolume = (fact: LineFact) => fact.volume === (step.rule === 'h1-line' ? 1 : step.rule === 'h2-own' ? 2 : 3);
  const qualifies = (fact: LineFact) => {
    switch (step.rule) {
      case 'h1-line': return !fact.allRoots;
      case 'h2-own': return !fact.standardChords;
      case 'h3-line': return fact.beyondVolume2;
      case 'h4-line': return true;
    }
  };
  const own = facts.lines.filter(sameVolume);
  const passes = clean(own.filter(qualifies));
  const strong = passes.filter(fact => fact.bpm >= BASE_BPM);
  const days = distinct(strong.map(fact => fact.localDate)).length >= MASTERY_DAYS;
  const tonalities = (list: readonly LineFact[]) => distinct(list.map(fact => fact.tonality)).length;
  const compositions = (list: readonly LineFact[]) => distinct(list.map(fact => fact.composition));
  const oneComposition = (list: readonly LineFact[], count: number) => compositions(list).some(name => tonalities(list.filter(fact => fact.composition === name)) >= count);
  let passed: boolean;
  let mastered: boolean;
  switch (step.rule) {
    case 'h1-line': case 'h2-own':
      passed = passes.length >= 1;
      mastered = tonalities(strong) >= 2 && days;
      break;
    case 'h3-line': {
      passed = compositions(passes).length >= 2;
      const modes = new Set(strong.map(fact => fact.mode));
      mastered = compositions(strong).length >= 3 && modes.has('major') && modes.has('minor') && days;
      break;
    }
    case 'h4-line':
      passed = oneComposition(passes, 2);
      mastered = oneComposition(strong, 3) && days;
      break;
  }
  return finish({
    cleanVariants: passed ? [0] : [], masteredVariants: mastered ? [0] : [], lastDate: latest(own.map(fact => fact.localDate)),
    lastMasteryDate: latest(strong.map(fact => fact.localDate)), variantLast: [latest(own.map(fact => fact.localDate))],
    bestCleanBpm: passes.length ? Math.max(...passes.map(fact => fact.bpm)) : null,
  }, passed, mastered, own.length > 0, skipped, facts.today);
}

export function stepStatus(step: Step, block: Block, facts: ProgramFacts): StepStatus | null {
  if (step.kind === 'song') return null;
  const skipped = facts.skippedBlocks.has(block.id);
  if (step.kind === 'play') return playStatus(step, facts, skipped);
  if (step.kind === 'check') return checkStatus(step, facts, skipped);
  return lineStatus(step, facts, skipped);
}

export interface Counts { readonly passed: number; readonly skipped: number; readonly mastered: number; readonly review: number; readonly total: number }
export interface ProgramState {
  readonly statuses: ReadonlyMap<string, StepStatus>;
  /** Текущий шаг каждой линии; `null` — линия пройдена. */
  readonly current: Readonly<Record<LineId, StepRef | null>>;
  readonly stageCounts: ReadonlyMap<number, Counts>;
  readonly lineCounts: ReadonlyMap<string, Counts>;
  readonly blockCounts: ReadonlyMap<string, Counts>;
}

const counts = (refs: readonly StepRef[], statuses: ReadonlyMap<string, StepStatus>): Counts => {
  const list = refs.filter(ref => isRequired(ref.step)).map(ref => statuses.get(ref.step.id)!);
  const passed = list.filter(status => status.state === 'passed' || status.state === 'mastered').length;
  return Object.freeze({
    passed, skipped: list.filter(status => status.state === 'skipped').length, mastered: list.filter(status => status.state === 'mastered').length,
    review: list.filter(status => status.review).length, total: list.length,
  });
};
const closed = (status: StepStatus) => status.state === 'passed' || status.state === 'mastered' || status.state === 'skipped';

/** Статусы, текущие шаги линий и счётчики по факту истории (R-028). */
export function evaluateProgram(program: Program, facts: ProgramFacts): ProgramState {
  const refs = stepRefs(program);
  const statuses = new Map<string, StepStatus>();
  for (const ref of refs) { const status = stepStatus(ref.step, ref.block, facts); if (status) statuses.set(ref.step.id, status); }
  const current = { technique: null, fretboard: null, chords: null } as Record<LineId, StepRef | null>;
  for (const line of LINES) current[line.id] = refs.find(ref => ref.block.line === line.id && isRequired(ref.step) && !closed(statuses.get(ref.step.id)!)) ?? null;
  const stageCounts = new Map<number, Counts>();
  const lineCounts = new Map<string, Counts>();
  const blockCounts = new Map<string, Counts>();
  for (const stage of program.stages) {
    stageCounts.set(stage.number, counts(refs.filter(ref => ref.stage === stage.number), statuses));
    for (const line of LINES) lineCounts.set(`${stage.number}:${line.id}`, counts(refs.filter(ref => ref.stage === stage.number && ref.block.line === line.id), statuses));
    for (const block of stage.blocks) blockCounts.set(block.id, counts(refs.filter(ref => ref.block === block), statuses));
  }
  return { statuses, current, stageCounts, lineCounts, blockCounts };
}

/** Линия (в этапе) пройдена, когда каждый её обязательный шаг пройден или пропущен; пустая линия — тоже. */
export const isDone = (value: Counts) => value.passed + value.skipped >= value.total;

/* ---------- Занятие ---------- */

export type DayReason = 'current' | 'reinforce' | 'review' | 'recall';
export interface DayItem {
  readonly step: RequiredStep;
  readonly block: Block;
  readonly stage: number;
  /** Вариант, с которого открывается шаг. */
  readonly variant: number;
  readonly minutes: number;
  readonly reason: DayReason;
}
export interface DayComposition { readonly mode: 'normal' | 'recall'; readonly items: readonly DayItem[]; readonly minutes: number }

/** Плановое время шага: «играть» — такты прохода × 4 с × 3 прохода плюс минута, вверх до минуты, 2–5; проверка — 2; своя линия — 5. */
export function stepMinutes(step: RequiredStep, variant = 0): number {
  if (step.kind === 'check') return 2;
  if (step.kind === 'line') return 5;
  const plan = buildExercise(step.variants[variant] ?? step.variants[0]);
  const bars = buildTimeline(plan, { pattern: step.practice.rhythm, echo: step.practice.echo }).bars;
  return Math.min(5, Math.max(2, Math.ceil((bars * 4 * 3 + 60) / 60)));
}

/** Содержимое шага плана для шага «играть» с выбранным вариантом. */
export function playContent(step: PlayStep, variant: number): Extract<PlanStepContent, { kind: 'exercise' }> {
  return { kind: 'exercise', spec: step.variants[variant] ?? step.variants[0], practice: step.practice };
}

const firstUncleanVariant = (status: StepStatus, count: number) => {
  for (let index = 0; index < count; index += 1) if (!status.cleanVariants.includes(index)) return index;
  return 0;
};
/** Для закрепления: первый вариант без засчитанного в «освоен» прохода, иначе самый давний. */
function reinforceVariant(status: StepStatus, count: number): number {
  for (let index = 0; index < count; index += 1) if (!status.masteredVariants.includes(index)) return index;
  let oldest = 0;
  status.variantLast.forEach((date, index) => { if ((date ?? '') < (status.variantLast[oldest] ?? '')) oldest = index; });
  return oldest;
}
const variantCount = (step: RequiredStep) => (step.kind === 'play' ? step.variants.length : 1);

/**
 * Состав занятия (R-028): текущие шаги линий в порядке «Техника → Гриф → Аккорды и линии»; вариант — первый без «Чисто».
 * Затем закрепление: шаги «пройден, не освоен», давно не игравшиеся первыми; если таких нет — «пора повторить».
 * Закрепление добавляется, пока время меньше 12 минут, но не больше шести шагов. После перерыва больше 14 дней —
 * «Вспомнить»: последние пройденные шаги линий.
 */
export function composeDay(program: Program, facts: ProgramFacts, state: ProgramState = evaluateProgram(program, facts)): DayComposition {
  const refs = stepRefs(program).filter((ref): ref is StepRef & { step: RequiredStep } => isRequired(ref.step));
  const item = (ref: StepRef & { step: RequiredStep }, variant: number, reason: DayReason): DayItem =>
    ({ step: ref.step, block: ref.block, stage: ref.stage, variant, minutes: stepMinutes(ref.step, variant), reason });
  const total = (list: readonly DayItem[]) => list.reduce((sum, entry) => sum + entry.minutes, 0);

  const dates = [...facts.plays.map(fact => fact.localDate), ...facts.checks.map(fact => fact.localDate), ...facts.lines.map(fact => fact.localDate)];
  const last = latest(dates);
  if (last !== null && daysBetween(last, facts.today) > REVIEW_DAYS) {
    const items: DayItem[] = [];
    for (const line of LINES) {
      const passed = refs.filter(ref => ref.block.line === line.id && ['passed', 'mastered'].includes(state.statuses.get(ref.step.id)!.state));
      const ref = passed.at(-1);
      if (ref) {
        const status = state.statuses.get(ref.step.id)!;
        const recent = status.variantLast.reduce((best, date, index) => ((date ?? '') > (status.variantLast[best] ?? '') ? index : best), 0);
        items.push(item(ref, recent, 'recall'));
      } else {
        const current = state.current[line.id];
        if (current && isRequired(current.step)) items.push(item(current as StepRef & { step: RequiredStep }, firstUncleanVariant(state.statuses.get(current.step.id)!, variantCount(current.step)), 'recall'));
      }
    }
    return { mode: 'recall', items, minutes: total(items) };
  }

  const items: DayItem[] = [];
  for (const line of LINES) {
    const current = state.current[line.id];
    if (!current || !isRequired(current.step)) continue;
    items.push(item(current as StepRef & { step: RequiredStep }, firstUncleanVariant(state.statuses.get(current.step.id)!, variantCount(current.step)), 'current'));
  }
  const taken = new Set(items.map(entry => entry.step.id));
  const rank = (ref: StepRef, date: string | null) => `${date ?? ''}|${String(ref.index).padStart(6, '0')}`;
  const passed = refs.filter(ref => !taken.has(ref.step.id) && state.statuses.get(ref.step.id)!.state === 'passed')
    .sort((a, b) => rank(a, state.statuses.get(a.step.id)!.lastDate).localeCompare(rank(b, state.statuses.get(b.step.id)!.lastDate)));
  const stale = refs.filter(ref => !taken.has(ref.step.id) && state.statuses.get(ref.step.id)!.review)
    .sort((a, b) => rank(a, state.statuses.get(a.step.id)!.lastMasteryDate).localeCompare(rank(b, state.statuses.get(b.step.id)!.lastMasteryDate)));
  const candidates = passed.length ? passed : stale;
  const reason: DayReason = passed.length ? 'reinforce' : 'review';
  for (const ref of candidates) {
    if (total(items) >= DAY_TARGET_MINUTES || items.length >= DAY_MAX_STEPS) break;
    items.push(item(ref, reinforceVariant(state.statuses.get(ref.step.id)!, variantCount(ref.step)), reason));
  }
  return { mode: 'normal', items, minutes: total(items) };
}

/**
 * Занятие как шаги плана дня: упражнение — вариант и «как играть» шага, проверка — описание шага; шаг программы связан с планом
 * через `programStep`. ID шагов: `d<n>` — обычное занятие, `r<n>` — «Вспомнить» после перерыва (по ним экран отличает занятие).
 * «Своя линия» без шаблона в план не попадает.
 */
export function dayPlanSteps(day: DayComposition): NewPlanStep[] {
  const prefix = day.mode === 'recall' ? 'r' : 'd';
  const steps: NewPlanStep[] = [];
  for (const item of day.items) {
    const id = `${prefix}${steps.length + 1}`;
    if (item.step.kind === 'play') steps.push({ id, content: playContent(item.step, item.variant), minutes: item.minutes, programStep: item.step.id });
    else if (item.step.kind === 'check') steps.push({ id, content: { kind: 'check', spec: item.step.check }, minutes: item.minutes, programStep: item.step.id });
  }
  return steps;
}

const GROOVE_TITLES: Readonly<Record<string, string>> = { rock: 'рок', funk: 'фанк', shuffle: 'шаффл', blues: 'блюзовый пульс', latin: 'латина', disco: 'диско' };
const RHYTHM_TITLES: Readonly<Record<string, string>> = { eighths: 'восьмые', quarters: 'четверти', sixteenths: 'шестнадцатые', syncopation: 'синкопа', shuffle: 'шаффл' };

/**
 * Правило зачёта шага словами для экрана игры (R-028): как играть, что значит «пройден» и «освоен».
 * `variantCounts` — материал открытого варианта входит в варианты шага; иначе проход шагу не засчитается.
 */
export function stepRuleText(step: PlayStep, status: StepStatus, variantCounts = true): string {
  const how = [RHYTHM_TITLES[step.practice.rhythm] ?? step.practice.rhythm, step.practice.echo ? 'эхо' : '',
    step.practice.groove ? `подложка «${GROOVE_TITLES[step.practice.groove] ?? step.practice.groove}»` : ''].filter(Boolean).join(', ');
  const need = Math.min(REQUIRED_VARIANTS, step.variants.length);
  const memory = step.variants.some(variant => MEMORY_TEMPLATE_IDS.has(variant.templateId));
  const done = Math.min(status.cleanVariants.length, need);
  const lines = [
    `Зачёт шага: ${how}; «Чисто» целиком в ${need === 1 ? 'одном варианте' : `${need} вариантах`} — сыграно ${done} из ${need}.`,
    `Освоен: то же в темпе не ниже ${BASE_BPM} BPM в ${MASTERY_DAYS} разных дня${memory ? ', в виде «По памяти»' : ''}.`,
  ];
  if (!variantCounts) lines.unshift('Этот вариант шагу не засчитается — выбери вариант шага.');
  return lines.join(' ');
}
