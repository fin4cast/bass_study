/**
 * Оценка объёма PCM до decodeAudioData по заголовку файла. Без декодирования и без DOM.
 * decodeAudioData отдаёт Float32 на частоте контекста, поэтому оценка = кадры после
 * пересчёта частоты × каналы × 4 байта. Это логический объём буферов, а не пиковая память
 * браузера: исходные байты и временные копии декодера сюда не входят.
 * WAV: точно по fmt/data (с учётом обрезанного файла). MP3: по Xing/Info/VBRI, иначе по
 * битрейту первого кадра (CBR). Неизвестная структура даёт null: тогда остаётся проверка после декодирования.
 */
export const PCM_PROBE_BYTES = 256 * 1024;

export interface PcmEstimate {
  readonly format: 'wav' | 'mp3';
  readonly method: 'wav-header' | 'mp3-xing' | 'mp3-vbri' | 'mp3-cbr';
  readonly sourceFrames: number; readonly sourceSampleRate: number; readonly channels: number;
  readonly decodedFrames: number; readonly bytes: number;
}
export interface PcmProbe {
  /** Полный размер файла в байтах. */
  readonly fileSize: number;
  /** Смещение `bytes` от начала файла: 0 либо конец ID3v2, если тег не поместился в первый фрагмент. */
  readonly offset?: number;
  /** Частота контекста, в которую декодирует браузер. */
  readonly targetSampleRate: number;
}

const ascii = (bytes: Uint8Array, at: number, text: string) => [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));
const u16 = (bytes: Uint8Array, at: number) => bytes[at] | bytes[at + 1] << 8;
const u32 = (bytes: Uint8Array, at: number) => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
const u32be = (bytes: Uint8Array, at: number) => (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;

/** Полная длина тега ID3v2 в начале `bytes` (заголовок, данные и footer) либо 0. */
export function id3v2Length(bytes: Uint8Array): number {
  if (bytes.length < 10 || !ascii(bytes, 0, 'ID3') || [6, 7, 8, 9].some(index => bytes[index] & 0x80)) return 0;
  const size = bytes[6] << 21 | bytes[7] << 14 | bytes[8] << 7 | bytes[9];
  return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}

function result(format: PcmEstimate['format'], method: PcmEstimate['method'], sourceFrames: number, sourceSampleRate: number, channels: number, target: number): PcmEstimate {
  const decodedFrames = Math.ceil(sourceFrames * target / sourceSampleRate);
  return Object.freeze({ format, method, sourceFrames, sourceSampleRate, channels, decodedFrames, bytes: decodedFrames * channels * 4 });
}

function estimateWav(bytes: Uint8Array, fileSize: number, offset: number, target: number): PcmEstimate | null {
  let fmt: { format: number; channels: number; sampleRate: number; blockAlign: number } | null = null;
  let factFrames: number | null = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = u32(bytes, at + 4); const body = at + 8;
    if (ascii(bytes, at, 'fmt ') && body + 16 <= bytes.length) {
      const format = u16(bytes, body);
      fmt = { format: format === 0xfffe && body + 26 <= bytes.length ? u16(bytes, body + 24) : format,
        channels: u16(bytes, body + 2), sampleRate: u32(bytes, body + 4), blockAlign: u16(bytes, body + 12) };
    } else if (ascii(bytes, at, 'fact') && body + 4 <= bytes.length) factFrames = u32(bytes, body);
    else if (ascii(bytes, at, 'data')) {
      if (!fmt || fmt.channels < 1 || fmt.sampleRate < 1 || fmt.blockAlign < 1) return null;
      // Размер 0/0xFFFFFFFF (потоковая запись) или больше файла: считаем по фактически оставшимся байтам.
      const available = Math.max(0, fileSize - (offset + body));
      const dataSize = size === 0 || size === 0xffffffff ? available : Math.min(size, available);
      // Линейный PCM (1) и float (3): кадр = blockAlign. Для сжатых форматов нужен fact.
      const frames = fmt.format === 1 || fmt.format === 3 ? Math.floor(dataSize / fmt.blockAlign) : factFrames;
      return frames === null ? null : result('wav', 'wav-header', frames, fmt.sampleRate, fmt.channels, target);
    }
    if (size > 0xfffffff0) return null;
    at = body + size + (size & 1);
  }
  return null;
}

const MPEG_BITRATES: Readonly<Record<string, readonly number[]>> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MPEG_RATES: Readonly<Record<number, readonly number[]>> = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };
interface MpegFrame { readonly version: 1 | 2 | 2.5; readonly layer: 1 | 2 | 3; readonly bitrate: number; readonly sampleRate: number; readonly channels: number; readonly length: number; readonly samples: number }
function mpegFrame(bytes: Uint8Array, at: number): MpegFrame | null {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = bytes[at + 1] >> 3 & 3, layerBits = bytes[at + 1] >> 1 & 3;
  const bitrateIndex = bytes[at + 2] >> 4, rateIndex = bytes[at + 2] >> 2 & 3, padding = bytes[at + 2] >> 1 & 1;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const bitrate = MPEG_BITRATES[version === 1 ? `1-${layer}` : layer === 1 ? '2-1' : '2-2'][bitrateIndex] * 1000;
  const sampleRate = MPEG_RATES[version][rateIndex];
  const samples = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
  const length = layer === 1 ? (Math.floor(12 * bitrate / sampleRate) + padding) * 4 : Math.floor(samples / 8 * bitrate / sampleRate) + padding;
  return { version, layer, bitrate, sampleRate, channels: (bytes[at + 3] >> 6) === 3 ? 1 : 2, length, samples };
}

function estimateMp3(bytes: Uint8Array, fileSize: number, offset: number, target: number): PcmEstimate | null {
  const start = offset === 0 ? id3v2Length(bytes) : 0;
  const limit = Math.min(bytes.length - 4, start + 64 * 1024);
  for (let at = start; at < limit; at++) {
    const frame = mpegFrame(bytes, at);
    if (!frame) continue;
    // Ложный синхрослово в мусоре: следующий кадр должен иметь тот же формат.
    const next = mpegFrame(bytes, at + frame.length);
    if (at + frame.length + 4 <= bytes.length && (!next || next.version !== frame.version || next.layer !== frame.layer || next.sampleRate !== frame.sampleRate)) continue;
    const side = frame.layer !== 3 ? 0 : frame.version === 1 ? (frame.channels === 1 ? 17 : 32) : (frame.channels === 1 ? 9 : 17);
    const xing = at + 4 + side;
    if (xing + 12 <= bytes.length && (ascii(bytes, xing, 'Xing') || ascii(bytes, xing, 'Info')) && u32be(bytes, xing + 4) & 1) {
      return result('mp3', 'mp3-xing', u32be(bytes, xing + 8) * frame.samples, frame.sampleRate, frame.channels, target);
    }
    const vbri = at + 36;
    if (vbri + 18 <= bytes.length && ascii(bytes, vbri, 'VBRI')) {
      return result('mp3', 'mp3-vbri', u32be(bytes, vbri + 14) * frame.samples, frame.sampleRate, frame.channels, target);
    }
    // CBR: длительность по битрейту первого кадра для всех оставшихся байтов (теги в конце завышают оценку — в безопасную сторону).
    const audioBytes = Math.max(0, fileSize - (offset + at));
    return result('mp3', 'mp3-cbr', Math.ceil(audioBytes * 8 / frame.bitrate * frame.sampleRate), frame.sampleRate, frame.channels, target);
  }
  return null;
}

/** Оценивает PCM после decodeAudioData по началу файла; null — структура не распознана. */
export function estimateDecodedPcm(bytes: Uint8Array, probe: PcmProbe): PcmEstimate | null {
  const offset = probe.offset ?? 0;
  if (!Number.isFinite(probe.fileSize) || probe.fileSize < 1 || !Number.isInteger(offset) || offset < 0 || !(probe.targetSampleRate > 0)) throw new RangeError('Некорректные параметры оценки PCM.');
  if (offset === 0 && bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return estimateWav(bytes, probe.fileSize, 0, probe.targetSampleRate);
  return estimateMp3(bytes, probe.fileSize, offset, probe.targetSampleRate);
}
