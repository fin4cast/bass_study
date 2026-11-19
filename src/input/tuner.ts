/**
 * Тюнер (R-020, D-052): диагностическая высота `estimatePitch`, показанная относительно открытых струн E1–A1–D2–G2.
 * Чистая модель без DOM и звука: шаг принимает оценку кадра и время, возвращает новое состояние.
 * Это не оценка игры и не заявление о точности: настоящий бас и интерфейс ещё не проверялись.
 */
import type { PitchEstimate } from './pitch';

export type TunerString = 'E' | 'A' | 'D' | 'G';
/** Открытые струны строя: MIDI 28, 33, 38, 43. */
export const TUNER_STRINGS: readonly { readonly string: TunerString; readonly midi: number; readonly name: string }[] = Object.freeze([
  { string: 'E', midi: 28, name: 'E1' }, { string: 'A', midi: 33, name: 'A1' }, { string: 'D', midi: 38, name: 'D2' }, { string: 'G', midi: 43, name: 'G2' },
]);

export const TUNER = Object.freeze({
  /** Медиана по стольким последним озвученным кадрам. */
  window: 5,
  /** «В строю», когда отклонение не больше этого дольше `holdMs`. */
  inTuneCents: 5,
  holdMs: 500,
  /** Выход из «в строю» — при отклонении больше этого (гистерезис). */
  outCents: 8,
  /** Дальше этого от ближайшей открытой струны — сыграна не открытая струна. */
  farCents: 100,
  /** Столько неозвученных кадров подряд (≈ по 100 мс) — «нет сигнала». */
  silentFrames: 5,
});

/** `close` — отклонение уже в пределах 5 центов, но ещё не держится 0,5 с. */
export type TunerVerdict = 'low' | 'high' | 'close' | 'in-tune' | 'far';
export interface TunerReading {
  readonly string: TunerString;
  readonly target: string;
  readonly hz: number;
  /** Отклонение от открытой струны в центах (медиана); знак: + выше, − ниже. */
  readonly cents: number;
  readonly verdict: TunerVerdict;
}
export interface TunerState {
  /** Последние озвученные высоты в долях MIDI. */
  readonly recent: readonly number[];
  readonly silent: number;
  readonly reading: TunerReading | null;
  /** Когда отклонение впервые стало не больше `inTuneCents` подряд; `null` — нет. */
  readonly closeSince: number | null;
  /** Струны, побывавшие «в строю», пока открыто окно. */
  readonly tuned: readonly TunerString[];
}

export const createTunerState = (): TunerState => Object.freeze({ recent: [], silent: 0, reading: null, closeSince: null, tuned: [] });

const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440);
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Ближайшая открытая струна и отклонение от неё в центах. */
export function nearestString(midi: number) {
  const best = TUNER_STRINGS.reduce((a, b) => (Math.abs(b.midi - midi) < Math.abs(a.midi - midi) ? b : a));
  return { ...best, cents: (midi - best.midi) * 100 };
}

/**
 * Следующее состояние по оценке кадра. Неозвученный кадр не сдвигает показание; после `silentFrames` таких кадров
 * подряд показание снимается («нет сигнала»). «В строю» — отклонение не больше 5 центов дольше 0,5 с; выход — больше 8.
 */
export function tunerStep(state: TunerState, estimate: PitchEstimate | null, now: number): TunerState {
  if (!estimate?.voiced) {
    const silent = state.silent + 1;
    if (silent < TUNER.silentFrames) return Object.freeze({ ...state, silent });
    return Object.freeze({ ...state, recent: [], silent, reading: null, closeSince: null });
  }
  const recent = [...state.recent, midiOf(estimate.hz)].slice(-TUNER.window);
  const midi = median(recent);
  const near = nearestString(midi);
  // Струна сменилась — прежнее время близости не считается.
  const sameString = state.reading?.string === near.string;
  const wasInTune = sameString && state.reading?.verdict === 'in-tune';
  const close = Math.abs(near.cents) <= TUNER.inTuneCents;
  const closeSince = close ? (sameString && state.closeSince !== null ? state.closeSince : now) : null;
  let verdict: TunerVerdict;
  if (Math.abs(near.cents) > TUNER.farCents) verdict = 'far';
  else if (wasInTune && Math.abs(near.cents) <= TUNER.outCents) verdict = 'in-tune';
  else if (closeSince !== null && now - closeSince >= TUNER.holdMs) verdict = 'in-tune';
  else if (closeSince !== null) verdict = 'close';
  else verdict = near.cents < 0 ? 'low' : 'high';
  const tuned = verdict === 'in-tune' && !state.tuned.includes(near.string) ? [...state.tuned, near.string] : state.tuned;
  return Object.freeze({
    recent, silent: 0, closeSince, tuned,
    reading: Object.freeze({ string: near.string, target: near.name, hz: 440 * 2 ** ((midi - 69) / 12), cents: near.cents, verdict }),
  });
}

/** Подсказка словами: что сделать с колком. */
export function tunerHint(reading: TunerReading | null): string {
  if (!reading) return 'Нет сигнала: сыграй одну открытую струну и дай ей звучать.';
  if (reading.verdict === 'far') return `Далеко от открытой струны ${reading.target}: сыграй открытую струну без прижатого лада.`;
  if (reading.verdict === 'in-tune') return `${reading.target} в строю.`;
  if (reading.verdict === 'close') return `${reading.target} почти в строю — держи ноту.`;
  return reading.verdict === 'low' ? `${reading.target} ниже — подтяни.` : `${reading.target} выше — отпусти.`;
}
