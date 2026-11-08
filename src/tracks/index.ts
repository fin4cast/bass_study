/** Portable metadata and one shared source timeline. PCM/File/Blob never enter this model. */
export const TRACK_LIMITS = Object.freeze({ maxTracks: 4, sourcePerFile: 64 * 1024 ** 2, sourceTotal: 256 * 1024 ** 2, decodedTotal: 512 * 1024 ** 2, minClipSeconds: 0.05 });
export class TracksError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'TracksError'; } }
export interface DecodedTrackInfo { readonly duration: number; readonly frames: number; readonly sampleRate: number; readonly channels: number }
export interface TrackFileIdentity { readonly sha256: string; readonly size: number }
export interface TrackDescriptor extends TrackFileIdentity {
  readonly id: string; readonly name: string; readonly lastModified: number; readonly decoded: DecodedTrackInfo;
  readonly volume: number; readonly muted: boolean;
}
export interface TracksManifest {
  readonly format: 'bass-study-tracks'; readonly schemaVersion: 1; readonly id: string; readonly tracks: readonly TrackDescriptor[];
  readonly clip: { readonly from: number; readonly to: number }; readonly loop: boolean; readonly rate: number;
}
export interface TrackSegment {
  readonly trackId: string; readonly cycleIndex: number; readonly atSeconds: number; readonly offsetSeconds: number;
  readonly durationSeconds: number; readonly playDurationSeconds: number; readonly endAtSeconds: number;
}
type Data = Record<string, unknown>;
function fail(message: string, code = 'INVALID_DATA'): never { throw new TracksError(code, message); }
function object(value: unknown, keys: readonly string[]): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Нужен обычный объект манифеста дорожек.');
  const result = value as Data;
  if (Reflect.ownKeys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)) || Object.values(Object.getOwnPropertyDescriptors(result)).some(property => !Object.hasOwn(property, 'value'))) fail('В манифесте отсутствуют обязательные поля или есть неизвестные поля.');
  return result;
}
function number(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) fail(`${label}: число вне допустимого диапазона.`);
  return value;
}
function text(value: unknown, label: string, max = 160): string { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label}: некорректная строка.`); return value; }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') fail('Ожидалось логическое значение.'); return value; }
function hash(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) fail('Нужен SHA-256 содержимого файла.'); return value.toLowerCase(); }
function immutable<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(immutable); Object.freeze(value); } return value; }

export function decodedBytes(tracks: readonly TrackDescriptor[]): number { return tracks.reduce((sum, track) => sum + track.decoded.frames * track.decoded.channels * 4, 0); }
export function validateTracksManifest(value: unknown): TracksManifest {
  const data = object(value, ['format', 'schemaVersion', 'id', 'tracks', 'clip', 'loop', 'rate']);
  if (data.format !== 'bass-study-tracks' || data.schemaVersion !== 1) fail('Неподдерживаемый формат или версия манифеста дорожек.', 'UNSUPPORTED_FORMAT');
  if (!Array.isArray(data.tracks) || data.tracks.length < 1 || data.tracks.length > TRACK_LIMITS.maxTracks) fail('Выбери от одной до четырёх дорожек.');
  const trackItems = data.tracks;
  if (Object.getPrototypeOf(trackItems) !== Array.prototype || Reflect.ownKeys(trackItems).length !== trackItems.length + 1 || Object.getOwnPropertyNames(trackItems).some(key => key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= trackItems.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(trackItems, key)!, 'value')))) fail('Нужен плотный массив дорожек без дополнительных полей.');
  const tracks = trackItems.map((item): TrackDescriptor => {
    const track = object(item, ['id', 'name', 'size', 'lastModified', 'sha256', 'decoded', 'volume', 'muted']);
    const decoded = object(track.decoded, ['duration', 'frames', 'sampleRate', 'channels']);
    const frames = number(decoded.frames, 1, Number.MAX_SAFE_INTEGER, 'Число отсчётов', true);
    const sampleRate = number(decoded.sampleRate, 8000, 192000, 'Частота PCM', true);
    const duration = number(decoded.duration, 0, Number.MAX_SAFE_INTEGER, 'Длительность PCM');
    if (Math.abs(duration - frames / sampleRate) > 1e-8) fail('Длительность PCM не соответствует числу отсчётов и частоте.');
    const name = text(track.name, 'Имя файла', 255);
    if (!/\.(?:wav|mp3)$/i.test(name)) fail('Поддерживаются локальные файлы WAV и MP3.');
    return { id: text(track.id, 'ID дорожки'), name, size: number(track.size, 1, TRACK_LIMITS.sourcePerFile, 'Размер файла', true),
      lastModified: number(track.lastModified, 0, Number.MAX_SAFE_INTEGER, 'Дата изменения', true), sha256: hash(track.sha256),
      decoded: { duration, frames, sampleRate, channels: number(decoded.channels, 1, 8, 'Число каналов', true) },
      volume: number(track.volume, 0, 1, 'Громкость'), muted: boolean(track.muted) };
  });
  if (new Set(tracks.map(track => track.id)).size !== tracks.length) fail('ID дорожек не должны повторяться.');
  if (tracks.reduce((sum, track) => sum + track.size, 0) > TRACK_LIMITS.sourceTotal) fail('Суммарный размер исходных файлов превышает 256 МиБ.', 'SOURCE_LIMIT');
  if (decodedBytes(tracks) > TRACK_LIMITS.decodedTotal) fail('Декодированный набор превышает 512 МиБ PCM.', 'PCM_LIMIT');
  const clip = object(data.clip, ['from', 'to']);
  const duration = Math.max(...tracks.map(track => track.decoded.duration));
  const from = number(clip.from, 0, duration, 'Начало фрагмента');
  const to = number(clip.to, 0, duration, 'Конец фрагмента');
  if (to - from < TRACK_LIMITS.minClipSeconds - 1e-12) fail('Фрагмент должен длиться не менее 0,05 секунды и иметь начало раньше конца.');
  return immutable({ format: 'bass-study-tracks', schemaVersion: 1, id: text(data.id, 'ID набора'), tracks, clip: { from, to }, loop: boolean(data.loop), rate: number(data.rate, 0.5, 1.5, 'Скорость с изменением высоты') });
}

export function createTracksManifest(input: { readonly id: string; readonly tracks: readonly TrackDescriptor[] }): TracksManifest {
  return validateTracksManifest({ format: 'bass-study-tracks', schemaVersion: 1, ...input, clip: { from: 0, to: Math.max(...input.tracks.map(track => track.decoded.duration)) }, loop: false, rate: 1 });
}
export function setTracksPlayback(manifest: TracksManifest, changes: { readonly clip?: { readonly from: number; readonly to: number }; readonly loop?: boolean; readonly rate?: number }): TracksManifest {
  return validateTracksManifest({ ...manifest, ...changes });
}
export function setTrackMix(manifest: TracksManifest, id: string, changes: { readonly volume?: number; readonly muted?: boolean }): TracksManifest {
  if (!manifest.tracks.some(track => track.id === id)) fail('Неизвестная дорожка.');
  return validateTracksManifest({ ...manifest, tracks: manifest.tracks.map(track => track.id === id ? { ...track, ...changes } : track) });
}
export function assertFileMatches(track: TrackDescriptor, file: TrackFileIdentity): void {
  if (hash(file.sha256) !== track.sha256 || file.size !== track.size) fail('Файл не совпадает с сохранённой дорожкой по SHA-256 и размеру. Ожидаемый файл не заменён.', 'FILE_MISMATCH');
}

export function planTrackSegments(manifest: TracksManifest, options: { readonly startPosition?: number; readonly cycles?: number } = {}) {
  const start = number(options.startPosition ?? manifest.clip.from, manifest.clip.from, manifest.clip.to, 'Позиция старта');
  const cycles = number(options.cycles ?? 1, 1, 1000, 'Число общих циклов', true);
  const segments: TrackSegment[] = [];
  let cursor = 0;
  for (let cycleIndex = 0; cycleIndex < cycles; cycleIndex++) {
    const offset = cycleIndex === 0 ? start : manifest.clip.from;
    for (const track of manifest.tracks) {
      const durationSeconds = Math.min(manifest.clip.to, track.decoded.duration) - offset;
      if (durationSeconds <= 0) continue;
      const playDurationSeconds = durationSeconds / manifest.rate;
      segments.push({ trackId: track.id, cycleIndex, atSeconds: cursor, offsetSeconds: offset, durationSeconds, playDurationSeconds, endAtSeconds: cursor + playDurationSeconds });
    }
    cursor += (manifest.clip.to - offset) / manifest.rate;
  }
  return immutable({ segments, durationSeconds: cursor });
}

export function trackPositionAt(manifest: TracksManifest, elapsedSeconds: number, startPosition = manifest.clip.from) {
  number(elapsedSeconds, 0, Number.MAX_SAFE_INTEGER, 'Прошедшее время');
  number(startPosition, manifest.clip.from, manifest.clip.to, 'Начальная позиция');
  const sourceElapsed = elapsedSeconds * manifest.rate;
  const firstLength = manifest.clip.to - startPosition;
  if (sourceElapsed < firstLength) return Object.freeze({ position: startPosition + sourceElapsed, cycleIndex: 0, finished: false });
  if (!manifest.loop) return Object.freeze({ position: manifest.clip.to, cycleIndex: 0, finished: true });
  const length = manifest.clip.to - manifest.clip.from;
  const rest = sourceElapsed - firstLength;
  return Object.freeze({ position: manifest.clip.from + rest % length, cycleIndex: 1 + Math.floor(rest / length), finished: false });
}
