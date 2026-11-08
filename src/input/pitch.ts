/**
 * Experimental monophonic diagnostic, not an instrument-performance score.
 * Based on squared difference / cumulative mean normalization / first threshold
 * trough / raw-difference parabolic refinement from de Cheveigné & Kawahara,
 * YIN (JASA 111, 2002), DOI 10.1121/1.1458024:
 * https://www.audiolabs-erlangen.de/content/05_fau/professor/00_mueller/02_teaching/2024s-sarntal/01_group_F0/2002_CheveigneK_YIN_JASA.pdf
 *
 * Project additions: four-sample averaging, transient refusal and an explicit
 * dominant-harmonic ambiguity guard. This is not the complete YIN implementation
 * or its published evaluation. Box averaging is not a general anti-alias filter.
 * Confidence is a conservative detection heuristic based on periodicity,
 * not a calibrated probability. Refused frames have confidence below0.5.
 * 8192 samples span 170.67ms at48k /185.76ms at44.1k; this is window duration,
 * not measured input latency. Physical bass/interface/noise tests remain required.
 */
export const PITCH_DIAGNOSTIC = Object.freeze({ frameSize: 8192, minHz: 35, maxHz: 350, minRms: 0.003, threshold: 0.1, downsampleFactor: 4 });
export type UnvoicedReason = 'silence' | 'noise' | 'uncertain' | 'out-of-range';
interface DiagnosticBase {
  readonly confidence: number; readonly rms: number; readonly acRms: number;
  readonly windowMs: number; readonly downsampleFactor: 4;
}
export type PitchEstimate = DiagnosticBase & (
  { readonly voiced: true; readonly hz: number; readonly nearestMidi: number; readonly cents: number; readonly reason: null }
  | { readonly voiced: false; readonly hz: null; readonly nearestMidi: null; readonly cents: null; readonly reason: UnvoicedReason }
);

interface Trough { readonly tau: number; readonly score: number }
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
function interpolatedOffset(values: Float64Array, index: number): number {
  const denominator = values[index - 1] - 2 * values[index] + values[index + 1];
  return Math.abs(denominator) < 1e-20 ? 0 : Math.max(-1, Math.min(1, 0.5 * (values[index - 1] - values[index + 1]) / denominator));
}

/** Call on one complete 8192-sample mono PCM frame, using the actual context rate. */
export function estimatePitch(samples: Float32Array | Float64Array | readonly number[], sampleRate: number): PitchEstimate {
  if (!(samples instanceof Float32Array || samples instanceof Float64Array || Array.isArray(samples)) || samples.length !== PITCH_DIAGNOSTIC.frameSize) throw new RangeError('Для диагностики нужен полный монофонический кадр из 8192 отсчётов PCM.');
  if (sampleRate !== 44100 && sampleRate !== 48000) throw new RangeError('Диагностика пока проверена только для частоты 44100 или 48000 Гц.');
  let sum = 0; let squareSum = 0;
  for (const value of samples) { if (!Number.isFinite(value)) throw new TypeError('PCM должен содержать только конечные числа.'); sum += value; squareSum += value * value; }
  if (!Number.isFinite(sum) || !Number.isFinite(squareSum)) throw new RangeError('Амплитуда PCM выходит за вычислимый диапазон.');
  const mean = sum / samples.length;
  const rms = Math.sqrt(squareSum / samples.length);
  const centered = new Float64Array(samples.length);
  let acSquare = 0; let peak = 0;
  const quarters = [0, 0, 0, 0];
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] - mean; centered[i] = value; acSquare += value * value; peak = Math.max(peak, Math.abs(value));
    quarters[Math.floor(i / 2048)] += value * value;
  }
  const acRms = Math.sqrt(acSquare / samples.length);
  const base = { rms, acRms, windowMs: samples.length / sampleRate * 1000, downsampleFactor: 4 as const };
  const reject = (reason: UnvoicedReason, periodicity = 0): PitchEstimate => Object.freeze({ ...base, voiced: false, hz: null, nearestMidi: null, cents: null, confidence: Math.min(0.49, clamp01(periodicity)), reason });
  if (acRms < PITCH_DIAGNOSTIC.minRms) return reject('silence');
  // A single impulse / attack-only frame must not become an invented bass note.
  const energyRatio = Math.max(...quarters) / Math.max(1e-15, Math.min(...quarters));
  if (peak / acRms > 8 || energyRatio > 36) return reject('uncertain');

  const rate = sampleRate / 4;
  const reduced = new Float64Array(samples.length / 4);
  for (let i = 0; i < reduced.length; i++) reduced[i] = (centered[i * 4] + centered[i * 4 + 1] + centered[i * 4 + 2] + centered[i * 4 + 3]) / 4;
  // Wider guard search lets definite 30Hz/500Hz tones be refused, rather than
  // forcing a supported-range subharmonic. Outside20..1000Hz is not diagnosed.
  const minTau = Math.max(2, Math.floor(rate / 1000));
  const maxTau = Math.ceil(rate / 20);
  const width = reduced.length - maxTau - 1;
  const difference = new Float64Array(maxTau + 1);
  const normalized = new Float64Array(maxTau + 1);
  normalized[0] = 1;
  let cumulative = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let value = 0;
    for (let index = 0; index < width; index++) { const delta = reduced[index] - reduced[index + tau]; value += delta * delta; }
    difference[tau] = value; cumulative += value;
    normalized[tau] = cumulative > 1e-20 ? value * tau / cumulative : 1;
  }
  const troughs: Trough[] = [];
  for (let tau = minTau; tau < maxTau; tau++) if (normalized[tau] <= normalized[tau - 1] && normalized[tau] < normalized[tau + 1]) {
    const offset = interpolatedOffset(normalized, tau);
    const score = Math.max(0, normalized[tau] - 0.25 * (normalized[tau - 1] - normalized[tau + 1]) * offset);
    troughs.push({ tau, score });
  }
  let selected = troughs.find(trough => trough.score < PITCH_DIAGNOSTIC.threshold);
  if (!selected) {
    const best = Math.min(1, ...troughs.map(trough => trough.score));
    return reject(best < 0.3 ? 'uncertain' : 'noise', 1 - best);
  }
  // A materially deeper trough near twice/three-times the first candidate can
  // expose a dominant second harmonic. Near the numerical/noise floor, refuse
  // that ambiguity instead of asserting a fundamental. PureE2 is not halved.
  for (const multiple of [2, 3]) {
    const reference = selected;
    const alternate = troughs.find(trough => Math.abs(trough.tau - reference.tau * multiple) <= Math.max(2, reference.tau * 0.02)
      && trough.score < reference.score * 0.2);
    if (!alternate) continue;
    const improvement = reference.score - alternate.score;
    if (improvement > 0.003) { selected = alternate; break; }
    if (improvement > 0.0003) return reject('uncertain', 1 - selected.score);
  }
  const lag = selected.tau + interpolatedOffset(difference, selected.tau);
  const hz = rate / lag;
  if (!Number.isFinite(hz) || hz < PITCH_DIAGNOSTIC.minHz || hz > PITCH_DIAGNOSTIC.maxHz) return reject('out-of-range', 1 - selected.score);
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearestMidi = Math.round(midi);
  return Object.freeze({ ...base, voiced: true, hz, nearestMidi, cents: (midi - nearestMidi) * 100, confidence: clamp01(1 - selected.score), reason: null });
}
