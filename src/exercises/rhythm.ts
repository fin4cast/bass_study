/**
 * Шкала прохода упражнения (D-050): ноты плана ложатся на ритмический рисунок, проход завершается тоникой
 * и добивается паузой до целого такта, поэтому каждый проход начинается с «раз». Чистые вычисления:
 * шкалу читают звук (`PlaybackConfig.steps`), TAB, строка ритма и подсветка экрана игры.
 */
import type { BarForms, ExercisePlan } from './index';

export type RhythmPatternId =
  | 'eighths' | 'quarters' | 'sixteenths' | 'syncopation' | 'shuffle'
  | 'quarter-two-eighths' | 'note-rest' | 'quarter-rest' | 'eighth-rest' | 'tied-syncopation';

/** Ячейка рисунка (A2.1): нота, пауза или лига — продолжение предыдущей ноты без новой атаки. */
export interface RhythmCell {
  readonly kind: 'note' | 'rest' | 'tie';
  /** Длительность, шестнадцатые. */
  readonly grids: number;
}

export interface RhythmPattern {
  readonly id: RhythmPatternId;
  readonly label: string;
  /** Как играть рисунок словами счёта: подпись строки ритма на экране игры. */
  readonly hint: string;
  /** Ячейки по кругу; сумма длительностей — 1, 2, 4, 8 или 16 шестнадцатых (рисунок укладывается в такт целое число раз). */
  readonly cells: readonly RhythmCell[];
  /** Свинг слабой восьмой, % (50 — ровно). */
  readonly swing: number;
}

/** Запись ячеек как в требованиях: `n4` — нота в четверть, `r2` — пауза в восьмую, `t2` — лига в восьмую. */
const cellsOf = (notation: string): readonly RhythmCell[] => notation.split(' ').map(token => {
  const kind = ({ n: 'note', r: 'rest', t: 'tie' } as const)[token[0] as 'n' | 'r' | 't'];
  return Object.freeze({ kind, grids: Number(token.slice(1)) });
});

export const RHYTHM_PATTERNS: readonly RhythmPattern[] = Object.freeze(([
  { id: 'eighths', label: 'Восьмые', hint: 'две ноты на счёт: «1 и, 2 и…» — на щелчок и ровно между щелчками', cells: cellsOf('n2'), swing: 50 },
  { id: 'quarters', label: 'Четверти', hint: 'одна нота на каждый счёт «1, 2, 3, 4» — на каждый щелчок метронома', cells: cellsOf('n4'), swing: 50 },
  { id: 'sixteenths', label: 'Шестнадцатые', hint: 'четыре ноты на счёт: «1 е и а»', cells: cellsOf('n1'), swing: 50 },
  { id: 'syncopation', label: 'Синкопа 8–4–8', hint: 'восьмая, четверть, восьмая: средняя нота начинается между щелчками', cells: cellsOf('n2 n4 n2'), swing: 50 },
  { id: 'shuffle', label: 'Шаффл (свинг-восьмые)', hint: 'две ноты на счёт, первая длиннее второй: «та-а-та»', cells: cellsOf('n2'), swing: 66 },
  { id: 'quarter-two-eighths', label: 'Четверть и две восьмые', hint: 'на «1» одна нота, на «2» — две: «1, 2 и»', cells: cellsOf('n4 n2 n2'), swing: 50 },
  { id: 'note-rest', label: 'Нота — пауза', hint: 'нота на «1», на «2» тишина — заглуши струну', cells: cellsOf('n4 r4'), swing: 50 },
  { id: 'quarter-rest', label: 'С четвертной паузой', hint: 'ноты на «1, 2, 3», на «4» тишина', cells: cellsOf('n4 n4 n4 r4'), swing: 50 },
  { id: 'eighth-rest', label: 'С восьмой паузой', hint: 'нота на «1», на «2» тишина, нота на «и»', cells: cellsOf('n4 r2 n2'), swing: 50 },
  { id: 'tied-syncopation', label: 'Синкопа с лигой', hint: 'нота на «2 и» тянется через «3» — на «3» не щипай', cells: cellsOf('n4 n2 n2 t2 n2 n4'), swing: 50 },
] satisfies RhythmPattern[]).map(pattern => Object.freeze({ ...pattern, cells: Object.freeze([...pattern.cells]) })));

export const isRhythmPatternId = (value: unknown): value is RhythmPatternId => RHYTHM_PATTERNS.some(pattern => pattern.id === value);
export const rhythmPattern = (id: RhythmPatternId): RhythmPattern => RHYTHM_PATTERNS.find(pattern => pattern.id === id)!;

/**
 * Рисунки, доступные материалу (A2.5). У последовательности аккордов любой рисунок на сетке шестнадцатых: ноты такта
 * выбирает правило B3. У фрагмента песни ритм задан партитурой.
 */
export function rhythmPatternsFor(plan: Pick<ExercisePlan, 'spec'> & Partial<Pick<ExercisePlan, 'timing'>>): readonly RhythmPatternId[] {
  if (plan.timing) {
    // Фрагмент песни играет ритм партитуры; рифф — шаффл допустим, только если все события чётны по шестнадцатым (A2.5).
    const even = plan.spec.templateId !== 'song-fragment' && plan.timing.every(step => step.grids % 2 === 0);
    return even ? ['eighths', 'shuffle'] : ['eighths'];
  }
  // A8.1: граница длинных и коротких нот совпадает с тактовой чертой только при четвертях и восьмых.
  if (plan.spec.templateId === 'long-short') return ['eighths', 'quarters'];
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
  /** Продолжение ноты прошлого шага (лига через тактовую черту во фрагменте песни): без атаки и без своего номера. */
  readonly tie: boolean;
  /** Доля шага, которую звучит эталон (A3); `null` — обычная длительность. */
  readonly gate: number | null;
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

/**
 * Раскладка одного такта последовательности по рисунку (R-028, B3). Плотность: атаки только на долях — форма Q, иначе E;
 * атака в шестнадцатой p берёт Q[p/4] или E[⌊p/2⌋]; хвост заменяет последние атаки такта, но не первую; пауза и лига нот не берут.
 * Индексы нот — из `BarForms` (индексы нот плана).
 */
export function barLayout(pattern: RhythmPattern, forms: BarForms): { note: number | null; grids: number; tie: boolean }[] {
  const cycle = Array.from({ length: BAR / pattern.cells.reduce((sum, cell) => sum + cell.grids, 0) }, () => pattern.cells).flat();
  const attacks: number[] = [];
  let place = 0;
  for (const cell of cycle) { if (cell.kind === 'note') attacks.push(place); place += cell.grids; }
  const quarterForm = attacks.every(attack => attack % 4 === 0);
  const replaced = Math.min(forms.tail.length, attacks.length - 1);
  const tail = forms.tail.slice(forms.tail.length - replaced);
  const steps: { note: number | null; grids: number; tie: boolean }[] = [];
  let position = 0, attack = 0, held = -1;
  for (const cell of cycle) {
    if (cell.kind === 'note') {
      const fromTail = attack - (attacks.length - replaced);
      held = fromTail >= 0 ? tail[fromTail] : quarterForm ? forms.q[position / 4] : forms.e[Math.floor(position / 2)];
      steps.push({ note: held, grids: cell.grids, tie: false }); attack++;
    } else if (cell.kind === 'tie') steps.push({ note: held, grids: cell.grids, tie: true });
    else steps.push({ note: null, grids: cell.grids, tie: false });
    position += cell.grids;
  }
  return steps;
}

export function buildTimeline(plan: Pick<ExercisePlan, 'spec' | 'notes' | 'segments' | 'cadence'> & Partial<Pick<ExercisePlan, 'timing' | 'bars'>>, options: TimelineOptions = {}): Timeline {
  const allowed = rhythmPatternsFor(plan);
  const patternId = options.pattern && allowed.includes(options.pattern) ? options.pattern : allowed[0];
  const pattern = rhythmPattern(patternId);
  const raw: { note: number | null; grids: number; landing: boolean; tie: boolean }[] = [];
  let at = 0;
  const push = (note: number | null, grids: number, landing = false, tie = false) => { raw.push({ note, grids, landing, tie }); at += grids; };
  if (plan.timing) {
    // Ритм из партитуры: шаги фрагмента песни как есть, такты по 16 шестнадцатых.
    for (const step of plan.timing) push(step.note, step.grids, false, step.tie === true);
  } else if (plan.bars) {
    // Такт — аккорд (B3): один рисунок на все такты.
    for (const forms of plan.bars) for (const step of barLayout(pattern, forms)) push(step.note, step.grids, false, step.tie);
  } else {
    // A2.3: ячейки читаются по кругу; нота берёт следующую ноту очереди (плана, затем завершения тоникой),
    // лига — ту же ноту без атаки, пауза стоит только перед очередной нотой.
    const queue = plan.notes.map((_, index) => ({ note: index, landing: false }));
    const landing = plan.cadence === 'tonic' ? landingNote(plan, plan.notes.length - 1) : null;
    if (landing !== null) queue.push({ note: landing, landing: true });
    let next = 0, held = -1, cell = 0;
    const cells = pattern.cells;
    while (next < queue.length) {
      const item = cells[cell++ % cells.length];
      if (item.kind === 'note') { held = queue[next].note; push(held, item.grids, queue[next].landing); next++; }
      else if (item.kind === 'tie') push(held, item.grids, false, true);
      else push(null, item.grids);
    }
    // Лиги последней ноты — её продолжение, они принадлежат ей.
    while (cells[cell % cells.length].kind === 'tie') push(held, cells[cell++ % cells.length].grids, false, true);
    // Последний шаг тянется до доли, остаток такта — пауза.
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
      steps.push({ note: step.note, grids: step.grids, audible: !echo, start: bar * BAR + start, bar, beatInBar: start / 4, landing: step.landing, tie: step.tie, gate: step.note === null ? null : (plan.notes[step.note] as { gate?: number | null }).gate ?? null, echo });
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

/* ---------- Как играли материал (D-050) ---------- */

/** Ритм, эхо и подложка подхода: часть материала освоения — эхо или четверти не засчитываются за обычный шаг. */
export interface PracticeOptions {
  readonly rhythm: RhythmPatternId;
  readonly echo: boolean;
  /** Пресет подложки «Ритма» или `null`. */
  readonly groove: string | null;
}
export const DEFAULT_PRACTICE: PracticeOptions = Object.freeze({ rhythm: 'eighths', echo: false, groove: null });
export const GROOVE_IDS: readonly string[] = Object.freeze(['rock', 'funk', 'shuffle', 'blues', 'latin', 'disco']);
export const samePractice = (a: PracticeOptions, b: PracticeOptions) => a.rhythm === b.rhythm && a.echo === b.echo && a.groove === b.groove;

/** Строгая проверка: ровно поля rhythm, echo, groove с допустимыми значениями. */
export function validatePractice(value: unknown): PracticeOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new RangeError('Как играли: нужен объект.');
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== 3 || !['rhythm', 'echo', 'groove'].every(key => Object.hasOwn(raw, key))) throw new RangeError('Как играли: ожидаются поля rhythm, echo, groove.');
  if (!isRhythmPatternId(raw.rhythm)) throw new RangeError('Как играли: неизвестный ритмический рисунок.');
  if (typeof raw.echo !== 'boolean') throw new RangeError('Как играли: эхо — да или нет.');
  if (raw.groove !== null && (typeof raw.groove !== 'string' || !GROOVE_IDS.includes(raw.groove))) throw new RangeError('Как играли: неизвестная подложка.');
  return Object.freeze({ rhythm: raw.rhythm, echo: raw.echo, groove: raw.groove as string | null });
}
