/** Переносимые настройки выбранной партитуры. Исходный File и PCM здесь запрещены. */
export interface MusicBankFile {
  readonly name: string; readonly size: number; readonly sha256: string; readonly relativePath: string | null;
  readonly title: string; readonly artist: string; readonly trackCount: number; readonly barCount: number;
}
export interface MusicBankTrackPreferences {
  readonly index: number; readonly name: string; readonly visible: boolean; readonly audible: boolean;
  readonly solo: boolean; readonly volume: number;
}
export interface MusicBankPreferences {
  readonly version: 1; readonly file: MusicBankFile | null; readonly tracks: readonly MusicBankTrackPreferences[];
  readonly speed: number; readonly master: number; readonly notation: { readonly staff: boolean; readonly tab: boolean };
  readonly follow: boolean; readonly mixerOpen: boolean;
  readonly range: { readonly fromBar: number; readonly toBar: number } | null; readonly loop: boolean;
}
export const MUSIC_BANK_LIMITS = Object.freeze({ maxFileBytes: 67_108_864, maxTracks: 512, maxBars: 100_000, maxPathLength: 4096 });
export class MusicBankValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'MusicBankValidationError'; }
}
function invalid(message: string): never { throw new MusicBankValidationError(message); }
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label}: нужен обычный объект данных.`);
  const data = value as Record<string, unknown>, own = Reflect.ownKeys(data);
  if (own.length !== keys.length || keys.some(key => !Object.hasOwn(data, key)) || own.some(key => typeof key !== 'string' || !keys.includes(key))
    || Object.values(Object.getOwnPropertyDescriptors(data)).some(d => !Object.hasOwn(d, 'value'))) invalid(`${label}: отсутствуют обязательные поля или присутствуют неизвестные JSON-поля.`);
  return data;
}
function string(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u001f\u007f]/u.test(value)) invalid(`${label}: некорректная строка.`);
  return value;
}
function number(value: unknown, min: number, max: number, label: string, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) invalid(`${label}: число вне допустимого диапазона.`);
  return value;
}
function flag(value: unknown, label: string): boolean { if (typeof value !== 'boolean') invalid(`${label}: требуется true или false.`); return value; }
function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MUSIC_BANK_LIMITS.maxTracks || Object.getPrototypeOf(value) !== Array.prototype) invalid('Микшер: некорректный массив партий.');
  const own = Reflect.ownKeys(value);
  if (own.length !== value.length + 1 || own.some(key => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')))) invalid('Микшер: нужен плотный JSON-массив без дополнительных полей.');
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fileName(value: unknown): string {
  const name = string(value, 'Имя файла', 1024);
  if (/[\\/:]/u.test(name) || name === '.' || name === '..') invalid('Имя файла не должно содержать путь.');
  return name;
}
function relativePath(value: unknown): string {
  const path = string(value, 'Относительный путь', MUSIC_BANK_LIMITS.maxPathLength);
  if (/[\\:]/u.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) invalid('Нужен относительный путь без переходов к родительской папке.');
  return path;
}
/** Только для входа каталога; валидатор снимка требует уже нормализованный путь. */
export function normalizeMusicBankRelativePath(value: string): string {
  if (typeof value !== 'string') invalid('Относительный путь должен быть строкой.');
  return relativePath(value.replaceAll('\\', '/'));
}
export function validateMusicBankFile(value: unknown): MusicBankFile {
  const data = record(value, ['name', 'size', 'sha256', 'relativePath', 'title', 'artist', 'trackCount', 'barCount'], 'Файл раздела «Табулатура и ноты»');
  const name = fileName(data.name), path = data.relativePath === null ? null : relativePath(data.relativePath);
  if (path !== null && path.split('/').at(-1) !== name) invalid('Имя файла не соответствует относительному пути.');
  const sha256 = string(data.sha256, 'SHA-256', 64);
  if (!/^[a-f0-9]{64}$/u.test(sha256)) invalid('SHA-256 должен содержать 64 строчных шестнадцатеричных символа.');
  return freeze({ name, size: number(data.size, 1, MUSIC_BANK_LIMITS.maxFileBytes, 'Размер файла'), sha256, relativePath: path,
    title: string(data.title, 'Название песни', 2048, true), artist: string(data.artist, 'Исполнитель', 2048, true),
    trackCount: number(data.trackCount, 1, MUSIC_BANK_LIMITS.maxTracks, 'Число партий'), barCount: number(data.barCount, 1, MUSIC_BANK_LIMITS.maxBars, 'Число тактов') });
}
export function validateMusicBankPreferences(value: unknown): MusicBankPreferences {
  const data = record(value, ['version', 'file', 'tracks', 'speed', 'master', 'notation', 'follow', 'mixerOpen', 'range', 'loop'], 'Настройки раздела «Табулатура и ноты»');
  if (data.version !== 1) invalid('Неизвестная версия настроек раздела «Табулатура и ноты».');
  const file = data.file === null ? null : validateMusicBankFile(data.file);
  const tracks = list(data.tracks).map((value, index) => {
    const track = record(value, ['index', 'name', 'visible', 'audible', 'solo', 'volume'], 'Партия раздела «Табулатура и ноты»');
    if (number(track.index, 0, MUSIC_BANK_LIMITS.maxTracks - 1, 'Индекс партии') !== index) invalid('Индексы партий должны идти последовательно с нуля без повторений.');
    return { index, name: string(track.name, 'Имя партии', 1024, true), visible: flag(track.visible, 'Видимость партии'), audible: flag(track.audible, 'Звучание партии'), solo: flag(track.solo, 'Solo партии'), volume: number(track.volume, 0, 1.5, 'Громкость партии', false) };
  });
  if (tracks.length !== (file?.trackCount ?? 0)) invalid('Микшер не соответствует числу партий выбранного файла.');
  const notation = record(data.notation, ['staff', 'tab'], 'Ноты и TAB');
  const range = data.range === null ? null : (() => {
    const clip = record(data.range, ['fromBar', 'toBar'], 'Фрагмент раздела «Табулатура и ноты»');
    if (!file) invalid('Фрагмент требует выбранный файл.');
    const fromBar = number(clip.fromBar, 1, file.barCount, 'Первый такт'), toBar = number(clip.toBar, 1, file.barCount, 'Последний такт');
    if (fromBar > toBar) invalid('Начало фрагмента позже конца.');
    return { fromBar, toBar };
  })();
  const loop = flag(data.loop, 'Повтор раздела «Табулатура и ноты»');
  if (!file && loop) invalid('Повтор требует выбранный файл.');
  return freeze({ version: 1, file, tracks, speed: number(data.speed, .25, 2, 'Скорость раздела «Табулатура и ноты»', false), master: number(data.master, 0, 1, 'Общая громкость раздела «Табулатура и ноты»', false),
    notation: { staff: flag(notation.staff, 'Показывать ноты'), tab: flag(notation.tab, 'Показывать TAB') }, follow: flag(data.follow, 'Следовать за музыкой'), mixerOpen: flag(data.mixerOpen, 'Микшер открыт'), range, loop });
}
export const DEFAULT_MUSIC_BANK_PREFERENCES = validateMusicBankPreferences({ version: 1, file: null, tracks: [], speed: 1, master: .7, notation: { staff: true, tab: true }, follow: true, mixerOpen: true, range: null, loop: false });

/**
 * WebCrypto хеширует ровно байты представления (byteOffset…byteLength), поэтому копия файла
 * в памяти не нужна. Тип исключает SharedArrayBuffer, который digest не принимает.
 */
export async function musicBankSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
/** Повторная привязка проверяет байты; переименование исходника допускается. */
export async function bindMusicBankFile(file: Pick<File, 'size' | 'arrayBuffer'>, expected: MusicBankFile): Promise<Uint8Array> {
  const descriptor = validateMusicBankFile(expected);
  if (file.size !== descriptor.size) invalid('Размер выбранного файла не совпадает с сохранённой партитурой.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== descriptor.size || await musicBankSha256(bytes) !== descriptor.sha256) invalid('Содержимое выбранного файла не совпадает с сохранённой партитурой (SHA-256).');
  return bytes;
}
