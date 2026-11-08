import { MUSIC_BANK_LIMITS, normalizeMusicBankRelativePath, MusicBankValidationError } from './model';

/** Только оперативная память страницы. File и каталог не входят в настройки/JSON. */
export interface MusicBankCatalogEntry {
  readonly id: string; readonly name: string; readonly relativePath: string | null;
  readonly size: number; readonly lastModified: number; readonly file: File;
}
/** Без чтения и разбора всех партитур; расширение служит подсказкой, не фильтром. */
export function createMusicBankCatalog(files: Iterable<File>): readonly MusicBankCatalogEntry[] {
  const paths = new Set<string>();
  const entries = [...files].map((file, index) => {
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MUSIC_BANK_LIMITS.maxFileBytes) throw new MusicBankValidationError(`Файл «${file.name}»: размер вне допустимого диапазона.`);
    const relativePath = file.webkitRelativePath ? normalizeMusicBankRelativePath(file.webkitRelativePath) : null;
    const identity = relativePath ?? file.name;
    if (paths.has(identity)) throw new MusicBankValidationError(`В каталоге повторяется путь «${identity}».`);
    paths.add(identity);
    return Object.freeze({ id: `music-bank-file-${index}`, name: file.name, relativePath, size: file.size, lastModified: file.lastModified, file });
  });
  return Object.freeze(entries);
}
export function searchMusicBankCatalog(entries: readonly MusicBankCatalogEntry[], query: string): readonly MusicBankCatalogEntry[] {
  const words = query.trim().toLocaleLowerCase('ru-RU').split(/\s+/u).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter(entry => { const text = `${entry.name}\n${entry.relativePath ?? ''}`.toLocaleLowerCase('ru-RU'); return words.every(word => text.includes(word)); });
}
