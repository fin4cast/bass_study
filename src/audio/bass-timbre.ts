/**
 * Общий тембр синтетического баса для слуха (cue) и последовательностей (engine).
 * Чистый синус до E1 = 41 Гц почти не воспроизводится маленькими динамиками; пила несёт
 * гармоники 2f, 3f… (уровни 1/k), а lowpass с отслеживанием высоты убирает резкий верх.
 * Слышимость на конкретных динамиках и качество тембра PCM-проверкой не доказываются.
 */
export const BASS_TIMBRE = Object.freeze({ waveform: 'sawtooth' as const, filterQ: Math.SQRT1_2, minCutoffHz: 600, maxCutoffHz: 2400, cutoffHarmonic: 10 });

/** Частота среза lowpass: около десятой гармоники, в пределах 600–2400 Гц. */
export function bassLowpassHz(fundamentalHz: number): number {
  if (!Number.isFinite(fundamentalHz) || fundamentalHz <= 0) throw new RangeError('Частота баса должна быть положительной.');
  return Math.min(BASS_TIMBRE.maxCutoffHz, Math.max(BASS_TIMBRE.minCutoffHz, fundamentalHz * BASS_TIMBRE.cutoffHarmonic));
}
