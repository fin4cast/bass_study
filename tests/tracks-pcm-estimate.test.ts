import { describe, expect, it } from 'vitest';
import { TRACK_LIMITS } from '../src/tracks';
import { estimateDecodedPcm, id3v2Length } from '../src/tracks/pcm-estimate';

/** Только заголовок WAV; объём данных задаётся отдельно через fileSize, как у большого File. */
function wavHeader({ sampleRate = 44100, channels = 2, bits = 16, dataBytes = 0, format = 1, extra = [] as Uint8Array[] } = {}) {
  const blockAlign = channels * bits / 8;
  const chunks: number[] = [];
  const ascii = (text: string) => chunks.push(...[...text].map(char => char.charCodeAt(0)));
  const u16 = (value: number) => chunks.push(value & 255, value >> 8 & 255);
  const u32 = (value: number) => chunks.push(value & 255, value >> 8 & 255, value >> 16 & 255, value >>> 24 & 255);
  ascii('RIFF'); u32(0); ascii('WAVE');
  for (const chunk of extra) chunks.push(...chunk);
  ascii('fmt '); u32(16); u16(format); u16(channels); u32(sampleRate); u32(sampleRate * blockAlign); u16(blockAlign); u16(bits);
  ascii('data'); u32(dataBytes);
  return Uint8Array.from(chunks);
}
const list = (size: number) => Uint8Array.from([...'LIST'].map(char => char.charCodeAt(0)).concat([size & 255, size >> 8 & 255, 0, 0], Array(size + (size & 1)).fill(0)));

/** MPEG-1 Layer III кадр без padding; по желанию с Xing-заголовком. */
function mp3Frame({ bitrateIndex = 9, stereo = true, xingFrames = null as number | null } = {}) {
  const sampleRate = 44100, bitrate = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128][bitrateIndex] * 1000;
  const length = Math.floor(144 * bitrate / sampleRate);
  const frame = new Uint8Array(length);
  frame.set([0xff, 0xfb, bitrateIndex << 4, stereo ? 0x00 : 0xc0]);
  if (xingFrames !== null) {
    const at = 4 + (stereo ? 32 : 17);
    frame.set([...'Xing'].map(char => char.charCodeAt(0)), at);
    frame.set([0, 0, 0, 1, xingFrames >>> 24 & 255, xingFrames >> 16 & 255, xingFrames >> 8 & 255, xingFrames & 255], at + 4);
  }
  return frame;
}
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };

describe('оценка PCM до decodeAudioData', () => {
  it('WAV: кадры по data/blockAlign, пересчёт в частоту контекста, Float32 на канал', () => {
    const header = wavHeader({ sampleRate: 44100, channels: 2, bits: 16, dataBytes: 44100 * 4 * 10 });
    const estimate = estimateDecodedPcm(header, { fileSize: header.length + 44100 * 4 * 10, targetSampleRate: 48000 });
    expect(estimate).toMatchObject({ format: 'wav', method: 'wav-header', sourceFrames: 441000, channels: 2, decodedFrames: 480000, bytes: 480000 * 2 * 4 });
  });

  it('WAV: data после LIST, размер data больше файла и потоковый 0 ограничиваются фактическими байтами', () => {
    const header = wavHeader({ sampleRate: 48000, channels: 1, bits: 24, dataBytes: 3 * 1000, extra: [list(37)] });
    expect(estimateDecodedPcm(header, { fileSize: header.length + 3000, targetSampleRate: 48000 })?.decodedFrames).toBe(1000);
    const lying = wavHeader({ sampleRate: 48000, channels: 1, bits: 16, dataBytes: 0x7fffffff });
    expect(estimateDecodedPcm(lying, { fileSize: lying.length + 2000, targetSampleRate: 48000 })?.sourceFrames).toBe(1000);
    const streaming = wavHeader({ sampleRate: 48000, channels: 1, bits: 16, dataBytes: 0 });
    expect(estimateDecodedPcm(streaming, { fileSize: streaming.length + 2000, targetSampleRate: 48000 })?.sourceFrames).toBe(1000);
  });

  it('WAV 8 кГц 8 бит моно 22,5 МБ (< 64 МиБ исходника) превышает 512 МиБ PCM после пересчёта в 48 кГц', () => {
    const dataBytes = 22_500_000;
    const header = wavHeader({ sampleRate: 8000, channels: 1, bits: 8, dataBytes });
    const estimate = estimateDecodedPcm(header, { fileSize: header.length + dataBytes, targetSampleRate: 48000 })!;
    expect(header.length + dataBytes).toBeLessThan(TRACK_LIMITS.sourcePerFile);
    expect(estimate.decodedFrames).toBe(dataBytes * 6);
    expect(estimate.bytes).toBeGreaterThan(TRACK_LIMITS.decodedTotal);
  });

  it('MP3 CBR: длительность по битрейту; Xing: по числу кадров; ID3v2 пропускается', () => {
    const frame = mp3Frame({ bitrateIndex: 9 });
    const cbr = estimateDecodedPcm(concat(frame, frame, frame), { fileSize: 128_000 / 8 * 60, targetSampleRate: 48000 })!;
    expect(cbr).toMatchObject({ format: 'mp3', method: 'mp3-cbr', channels: 2, sourceSampleRate: 44100 });
    expect(cbr.decodedFrames / 48000).toBeCloseTo(60, 3);

    const xing = estimateDecodedPcm(concat(mp3Frame({ stereo: false, xingFrames: 1000 }), mp3Frame({ stereo: false })), { fileSize: 10_000_000, targetSampleRate: 48000 })!;
    expect(xing).toMatchObject({ method: 'mp3-xing', channels: 1, sourceFrames: 1_152_000 });

    const id3 = Uint8Array.from([...'ID3'].map(char => char.charCodeAt(0)).concat([4, 0, 0, 0, 0, 1, 0], Array(128).fill(0)));
    expect(id3v2Length(id3)).toBe(138);
    const tagged = estimateDecodedPcm(concat(id3, frame, frame), { fileSize: 138 + 128_000 / 8 * 30, targetSampleRate: 48000 })!;
    expect(tagged.decodedFrames / 48000).toBeCloseTo(30, 3);
    // Тег длиннее первого фрагмента: вызывающий передаёт фрагмент от конца тега.
    expect(estimateDecodedPcm(concat(frame, frame), { fileSize: 1_000_000 + 128_000 / 8 * 30, offset: 1_000_000, targetSampleRate: 48000 })!.decodedFrames / 48000).toBeCloseTo(30, 3);
  });

  it('нераспознанная структура не выдумывает оценку', () => {
    expect(estimateDecodedPcm(new Uint8Array(1024), { fileSize: 1024, targetSampleRate: 48000 })).toBeNull();
    expect(estimateDecodedPcm(wavHeader().slice(0, 30), { fileSize: 1_000_000, targetSampleRate: 48000 })).toBeNull();
    expect(estimateDecodedPcm(wavHeader({ format: 2 }), { fileSize: 1_000_000, targetSampleRate: 48000 })).toBeNull();
  });
});
