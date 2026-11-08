import type { AnnotatedPosition } from '../music';

export type NoteDuration = 'quarter' | 'eighth' | 'sixteenth';
export type MetronomeMode = 'all' | 'two-four' | 'gap-2-2';
export type RepeatMode = 'once' | 'infinite' | {
  readonly kind: 'ladder';
  readonly start: number;
  readonly end: number;
  readonly step: number;
  readonly repeatsPerTempo: number;
};

export interface PlaybackConfig {
  readonly notes: readonly AnnotatedPosition[];
  readonly range?: { readonly from: number; readonly toExclusive: number };
  readonly duration?: NoteDuration;
  readonly bpm?: number;
  readonly countIn?: boolean;
  readonly repeat?: RepeatMode;
  readonly metronome?: {
    readonly enabled?: boolean;
    readonly subdivision?: NoteDuration;
    readonly mode?: MetronomeMode;
  };
}

export interface PlaybackPlan {
  readonly notes: readonly AnnotatedPosition[];
  readonly range: { readonly from: number; readonly toExclusive: number };
  readonly duration: NoteDuration;
  readonly noteGrids: number;
  readonly countInGrids: number;
  readonly passGrids: number;
  readonly bpm: number;
  readonly repeat: RepeatMode;
  readonly passBpms: readonly number[] | null;
  readonly totalPasses: number | null;
  readonly finishGrid: number | null;
  readonly metronome: {
    readonly enabled: boolean;
    readonly subdivision: NoteDuration;
    readonly mode: MetronomeMode;
  };
}

export interface GridEvent {
  readonly grid: number;
  readonly phase: 'count-in' | 'practice';
  readonly finish: boolean;
  readonly passIndex: number;
  readonly loopBoundary: boolean;
  readonly noteIndex: number | null;
  readonly note: AnnotatedPosition | null;
  readonly beat: number;
  readonly bar: number;
  readonly bpm: number;
  readonly click: { readonly audible: boolean; readonly accent: boolean; readonly countIn: boolean } | null;
}

export const DURATION_GRIDS: Readonly<Record<NoteDuration, number>> = Object.freeze({ quarter: 4, eighth: 2, sixteenth: 1 });

export function validateBpm(value: number): void {
  if (!Number.isFinite(value) || value < 40 || value > 220) throw new RangeError('Темп должен быть от 40 до 220 BPM.');
}

function duration(value: unknown, fallback: NoteDuration): NoteDuration {
  if (value === undefined) return fallback;
  if (value !== 'quarter' && value !== 'eighth' && value !== 'sixteenth') throw new RangeError('Выберите четверти, восьмые или шестнадцатые.');
  return value;
}

export function buildTempoLadder(start: number, end: number, step: number, repeatsPerTempo: number): readonly number[] {
  validateBpm(start);
  validateBpm(end);
  if (end < start) throw new RangeError('Конечный темп лестницы не может быть ниже начального.');
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('Шаг лестницы должен быть положительным.');
  if (!Number.isInteger(repeatsPerTempo) || repeatsPerTempo < 1 || repeatsPerTempo > 100) throw new RangeError('Число повторов на темп должно быть целым от 1 до 100.');
  // Avoid an unbounded allocation for fractional steps approaching zero.
  if (Math.ceil((end - start) / step) + 1 > 1000) throw new RangeError('Слишком много ступеней темпа: увеличьте шаг лестницы.');
  const result: number[] = [];
  let bpm = start;
  while (true) {
    result.push(...Array.from({ length: repeatsPerTempo }, () => bpm));
    if (bpm === end) break;
    bpm = Math.min(end, bpm + step);
  }
  return Object.freeze(result);
}

export function createPlaybackPlan(config: PlaybackConfig): PlaybackPlan {
  if (!Array.isArray(config.notes) || config.notes.length === 0) throw new RangeError('Сначала выберите последовательность хотя бы из одной ноты.');
  if (config.notes.some(note => !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127 || !Number.isFinite(note.frequency) || note.frequency <= 0)) {
    throw new RangeError('Последовательность содержит некорректную звучащую высоту.');
  }
  const range = config.range ?? { from: 0, toExclusive: config.notes.length };
  if (!Number.isInteger(range.from) || !Number.isInteger(range.toExclusive) || range.from < 0 || range.toExclusive > config.notes.length || range.from >= range.toExclusive) {
    throw new RangeError('Фрагмент A–B должен содержать ноты: A включается, B задаётся следующей за последней нотой границей.');
  }
  const noteDuration = duration(config.duration, 'eighth');
  const subdivision = duration(config.metronome?.subdivision, 'quarter');
  const bpm = config.bpm ?? 80;
  validateBpm(bpm);
  const repeat = config.repeat ?? 'once';
  let passBpms: readonly number[] | null;
  if (repeat === 'once') passBpms = Object.freeze([bpm]);
  else if (repeat === 'infinite') passBpms = null;
  else if (repeat && typeof repeat === 'object' && repeat.kind === 'ladder') {
    passBpms = buildTempoLadder(repeat.start, repeat.end, repeat.step, repeat.repeatsPerTempo);
  } else throw new RangeError('Неизвестный режим повторения.');
  const mode = config.metronome?.mode ?? 'all';
  if (mode !== 'all' && mode !== 'two-four' && mode !== 'gap-2-2') throw new RangeError('Неизвестный режим метронома.');
  if (config.countIn !== undefined && typeof config.countIn !== 'boolean') throw new TypeError('Отсчёт должен быть включён или выключен.');
  if (config.metronome?.enabled !== undefined && typeof config.metronome.enabled !== 'boolean') throw new TypeError('Метроном должен быть включён или выключен.');
  const countInGrids = config.countIn === false ? 0 : 16;
  const passGrids = (range.toExclusive - range.from) * DURATION_GRIDS[noteDuration];
  const totalPasses = passBpms?.length ?? null;
  return Object.freeze({
    notes: Object.freeze(config.notes.map(note => Object.freeze({ ...note }))),
    range: Object.freeze({ ...range }),
    duration: noteDuration,
    noteGrids: DURATION_GRIDS[noteDuration],
    countInGrids, passGrids,
    bpm: passBpms?.[0] ?? bpm,
    repeat: typeof repeat === 'object' ? Object.freeze({ ...repeat }) : repeat,
    passBpms, totalPasses,
    finishGrid: totalPasses === null ? null : countInGrids + passGrids * totalPasses,
    metronome: Object.freeze({ enabled: config.metronome?.enabled ?? true, subdivision, mode }),
  });
}

/** Maps a monotonic sixteenth-note grid to music without resetting global 4/4. */
export function eventAtGrid(plan: PlaybackPlan, grid: number): GridEvent {
  if (!Number.isInteger(grid) || grid < 0) throw new RangeError('Индекс музыкальной сетки должен быть неотрицательным целым.');
  if (grid < plan.countInGrids) {
    return { grid, phase: 'count-in', finish: false, passIndex: 0, loopBoundary: false,
      noteIndex: null, note: null, beat: Math.floor(grid / 4) + 1, bar: 0, bpm: plan.bpm,
      click: grid % 4 === 0 ? { audible: true, accent: grid === 0, countIn: true } : null };
  }
  const practiceGrid = grid - plan.countInGrids;
  const passIndex = Math.floor(practiceGrid / plan.passGrids);
  const inPass = practiceGrid % plan.passGrids;
  const beat = Math.floor(practiceGrid / 4) % 4 + 1;
  const bar = Math.floor(practiceGrid / 16);
  const bpm = plan.passBpms?.[Math.min(passIndex, plan.passBpms.length - 1)] ?? plan.bpm;
  if (plan.finishGrid !== null && grid >= plan.finishGrid) {
    return { grid, phase: 'practice', finish: true, passIndex, loopBoundary: false,
      noteIndex: null, note: null, beat, bar, bpm, click: null };
  }
  const noteIndex = plan.range.from + Math.floor(inPass / plan.noteGrids);
  const note = inPass % plan.noteGrids === 0 ? plan.notes[noteIndex] : null;
  let click: GridEvent['click'] = null;
  if (plan.metronome.enabled) {
    const twoFour = plan.metronome.mode === 'two-four';
    const spacing = twoFour ? 4 : DURATION_GRIDS[plan.metronome.subdivision];
    if (practiceGrid % spacing === 0) {
      click = {
        audible: twoFour ? beat === 2 || beat === 4 : plan.metronome.mode !== 'gap-2-2' || bar % 4 < 2,
        accent: beat === 1 && practiceGrid % 4 === 0,
        countIn: false,
      };
    }
  }
  return { grid, phase: 'practice', finish: false, passIndex, loopBoundary: practiceGrid > 0 && inPass === 0,
    noteIndex, note, beat, bar, bpm, click };
}

/** Exact duration for an unchanged finite plan; live manual tempo uses audio callbacks instead. */
export function finiteDurationSeconds(plan: PlaybackPlan): number | null {
  if (!plan.passBpms) return null;
  return (plan.countInGrids / 4) * (60 / plan.bpm)
    + plan.passBpms.reduce((sum, bpm) => sum + (plan.passGrids / 4) * (60 / bpm), 0);
}
