import { describe, expect, it } from 'vitest';
import { estimatePitch, PITCH_DIAGNOSTIC } from '../src/input/pitch';

function tone(hz: number, sampleRate = 48000, components: readonly [number, number][] = [[1, 0.5]], phase = 0.3) {
  return Float32Array.from({ length: 8192 }, (_, index) => components.reduce((sum, [harmonic, amplitude]) => sum + amplitude * Math.sin(2 * Math.PI * hz * harmonic * index / sampleRate + phase), 0));
}
function noise(seed = 12345) {
  let state = seed;
  return Float32Array.from({ length: 8192 }, () => { state = (1664525 * state + 1013904223) >>> 0; return (state / 0x100000000 - 0.5) * 0.5; });
}
const opens = [[28, 41.20344461410875], [33, 55], [38, 73.41619197935188], [43, 97.99885899543733]] as const;

describe('экспериментальная диагностика синтетического монофонического PCM', () => {
  it.each([44100, 48000])('%sГц: все открытые струны и ±25центов без подсказки ожидаемой ноты', sampleRate => {
    for (const [midi, hz] of opens) for (const cents of [-25, 0, 25]) {
      const result = estimatePitch(tone(hz * 2 ** (cents / 1200), sampleRate), sampleRate);
      expect(result.voiced, JSON.stringify({ midi, cents, result })).toBe(true);
      if (!result.voiced) continue;
      expect(result.nearestMidi).toBe(midi);
      expect(Math.abs(result.cents - cents)).toBeLessThan(1.5);
      expect(result.confidence).toBeGreaterThan(0.98);
      expect(result.rms).toBeGreaterThan(0.3);
    }
  });

  it('чистый E2 не понижается до E1, даже если низкая октава входит в диапазон', () => {
    const e1 = estimatePitch(tone(41.20344461410875), 48000);
    const e2 = estimatePitch(tone(82.4068892282175), 48000);
    expect(e1).toMatchObject({ voiced: true, nearestMidi: 28 });
    expect(e2).toMatchObject({ voiced: true, nearestMidi: 40 });
    if (e1.voiced && e2.voiced) expect(e2.hz / e1.hz).toBeCloseTo(2, 3);
  });

  it('чистые тоны разных фаз не делятся на два; значения близко к пределам остаются оценками', () => {
    for (const hz of [35.1, 41.20344461410875, 82.4068892282175, 349.9]) for (const phase of [0, 0.8, 1.9, 3.5, 5.4]) {
      const result = estimatePitch(tone(hz, 48000, [[1, 0.5]], phase), 48000);
      expect(result.voiced, JSON.stringify({ hz, phase, result })).toBe(true);
      if (result.voiced) expect(Math.abs(1200 * Math.log2(result.hz / hz))).toBeLessThan(2);
    }
  });

  it.each([44100, 48000])('доминирующая вторая гармоника с более слабой основной/третьей, %sГц', sampleRate => {
    for (const [midi, hz] of opens) {
      const result = estimatePitch(tone(hz, sampleRate, [[1, 0.07], [2, 0.7], [3, 0.06]]), sampleRate);
      expect(result.voiced, JSON.stringify({ midi, result })).toBe(true);
      if (result.voiced) { expect(result.nearestMidi).toBe(midi); expect(Math.abs(result.cents)).toBeLessThan(2); }
    }
  });

  it('почти неразличимая слабая основная не превращается в уверенную оценку', () => {
    const result = estimatePitch(tone(55, 48000, [[1, 0.01], [2, 0.8], [3, 0.01]]), 48000);
    expect(result).toMatchObject({ voiced: false, reason: 'uncertain', hz: null, nearestMidi: null, cents: null });
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('тишина, DC и ограниченный белый шум не получают вымышленную F0', () => {
    expect(estimatePitch(new Float32Array(8192), 48000)).toMatchObject({ voiced: false, reason: 'silence', rms: 0 });
    expect(estimatePitch(new Float32Array(8192).fill(0.2), 48000)).toMatchObject({ voiced: false, reason: 'silence' });
    const result = estimatePitch(noise(), 48000);
    expect(result).toMatchObject({ voiced: false, reason: 'noise', hz: null });
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('импульс и атака без устойчивого продолжения отвергаются; установившийся тон анализируется отдельно', () => {
    const impulse = new Float32Array(8192); impulse[10] = 1;
    expect(estimatePitch(impulse, 48000)).toMatchObject({ voiced: false, reason: 'uncertain' });
    const attack = tone(55); attack.fill(0, 1024);
    expect(estimatePitch(attack, 48000)).toMatchObject({ voiced: false, reason: 'uncertain' });
    expect(estimatePitch(tone(55), 48000)).toMatchObject({ voiced: true, nearestMidi: 33 });
  });

  it('известные тоны вне поддерживаемого диапазона не притягиваются к его нотам', () => {
    for (const hz of [25, 30, 400, 500, 800]) expect(estimatePitch(tone(hz), 48000), String(hz)).toMatchObject({ voiced: false, reason: 'out-of-range', hz: null });
  });

  it('сообщает длительность окна, не выдаёт её за аппаратную задержку и не изменяет PCM', () => {
    const samples = tone(55); const before = [...samples];
    const result = estimatePitch(samples, 48000);
    expect(result.windowMs).toBeCloseTo(170.6666667, 5);
    expect(result.downsampleFactor).toBe(4);
    expect([...samples]).toEqual(before);
    expect(result).not.toHaveProperty('latencyMs');
    expect(result).not.toHaveProperty('string');
    expect(result).not.toHaveProperty('correct');
    expect(Object.isFrozen(result)).toBe(true);
    expect(PITCH_DIAGNOSTIC).toMatchObject({ minHz: 35, maxHz: 350, frameSize: 8192 });
  });

  it('проверяет размер, тип, конечность отсчётов и фактическую sampleRate', () => {
    expect(() => estimatePitch(new Float32Array(4096), 48000)).toThrow(/8192/);
    expect(() => estimatePitch(tone(55), 96000)).toThrow(/44100 или 48000/);
    const bad = tone(55); bad[0] = NaN;
    expect(() => estimatePitch(bad, 48000)).toThrow(/конечные/);
    expect(() => estimatePitch(new Float64Array(8192).fill(1e200), 48000)).toThrow(/Амплитуда/);
    expect(() => estimatePitch(new Int16Array(8192) as unknown as Float32Array, 48000)).toThrow();
  });

  it('измеряет вычисление 100 кадров на текущем Node без утверждения об аудиозадержке', () => {
    const samples = tone(55);
    for (let i = 0; i < 10; i++) estimatePitch(samples, 48000);
    const started = performance.now();
    for (let i = 0; i < 100; i++) expect(estimatePitch(samples, 48000).voiced).toBe(true);
    const elapsedMs = performance.now() - started;
    console.info(JSON.stringify({ synthetic: true, measurement: '100 frames on this test Node, not device latency', totalMs: elapsedMs, meanMs: elapsedMs / 100 }));
    expect(Number.isFinite(elapsedMs)).toBe(true);
  });
});
