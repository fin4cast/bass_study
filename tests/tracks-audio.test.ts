import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTracksPlayer } from '../src/audio/tracks';

type Call = readonly [string, ...number[]];
/** Подставной AudioParam: записывает только фактические вызовы автоматизации, без собственной модели звука. */
function parameter(initial = 1) {
  const calls: Call[] = [];
  return {
    calls, value: initial,
    setValueAtTime(value: number, time: number) { calls.push(['setValueAtTime', value, time]); },
    linearRampToValueAtTime(value: number, time: number) { calls.push(['linearRampToValueAtTime', value, time]); },
    setTargetAtTime(value: number, time: number, constant: number) { calls.push(['setTargetAtTime', value, time, constant]); },
    cancelScheduledValues(time: number) { calls.push(['cancelScheduledValues', time]); },
    cancelAndHoldAtTime(time: number) { calls.push(['cancelAndHoldAtTime', time]); },
  };
}
type Parameter = ReturnType<typeof parameter>;

/** WAV PCM 16 бит; заголовок соответствует данным. */
function wavBytes({ sampleRate = 48000, channels = 1, frames = 4800, bits = 16 } = {}) {
  const blockAlign = channels * bits / 8, data = frames * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + data));
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + data, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, bits, true);
  ascii(36, 'data'); view.setUint32(40, data, true);
  return new Uint8Array(view.buffer);
}

function stubContext(decode = vi.fn(async () => ({ duration: 2, length: 96000, sampleRate: 48000, numberOfChannels: 1 }))) {
  const gains: Parameter[] = [];
  const node = () => ({ connect() {}, disconnect() {} });
  const audio = {
    currentTime: 0, state: 'running', sampleRate: 48000, destination: node(),
    async resume() {}, async close() {},
    decodeAudioData: decode,
    createGain: () => { const gain = parameter(); gains.push(gain); return { ...node(), gain }; },
    createAnalyser: () => ({ ...node(), fftSize: 1024, getFloatTimeDomainData() {} }),
    createBufferSource: () => ({ ...node(), buffer: null, playbackRate: parameter(), onended: null, start() {}, stop() {} }),
  };
  vi.stubGlobal('AudioContext', class { constructor() { return audio; } });
  return { audio, gains, decode };
}

describe('громкость дорожек во время проигрывания', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('меняет громкость и mute плавным переходом от текущего значения, без ступеньки', async () => {
    vi.useFakeTimers();
    const { audio, gains } = stubContext();
    const player = createTracksPlayer();
    try {
      const manifest = await player.loadFiles([new File([wavBytes()], 'bass.wav', { type: 'audio/wav' })]);
      const trackId = manifest.tracks[0].id;
      await player.play();
      // gains[0] — master; затем шина дорожки.
      const bus = gains[1];
      audio.currentTime = 1.25;
      bus.calls.length = 0;
      player.setTrackMix(trackId, { volume: .2 });
      const ramp = bus.calls.filter(([name]) => name === 'linearRampToValueAtTime' || name === 'setTargetAtTime');
      expect(ramp, JSON.stringify(bus.calls)).toHaveLength(1);
      expect(ramp[0][1]).toBe(.2);
      if (ramp[0][0] === 'linearRampToValueAtTime') expect(ramp[0][2]).toBeGreaterThan(1.25);
      else expect(ramp[0][3]).toBeGreaterThan(0);
      // Мгновенная установка допустима только для удержания уже звучащего значения, не для новой цели.
      expect(bus.calls.filter(([name, value]) => name === 'setValueAtTime' && value === .2)).toEqual([]);
      expect(bus.calls.some(([name]) => name === 'cancelAndHoldAtTime' || name === 'cancelScheduledValues')).toBe(true);

      bus.calls.length = 0;
      audio.currentTime = 2;
      player.setTrackMix(trackId, { muted: true });
      const mute = bus.calls.filter(([name]) => name === 'linearRampToValueAtTime' || name === 'setTargetAtTime');
      expect(mute, JSON.stringify(bus.calls)).toHaveLength(1);
      expect(mute[0][1]).toBe(0);
      expect(bus.calls.filter(([name, value]) => name === 'setValueAtTime' && value === 0)).toEqual([]);
    } finally { await player.dispose(); }
  });
});
