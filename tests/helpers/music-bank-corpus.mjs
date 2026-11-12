// Выборка партитур из личной коллекции для режима --corpus (нужен BASS_MUSIC_BANK_ROOT).
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

export const selection = JSON.parse(await readFile(new URL('../fixtures/music-bank-corpus-selection.json', import.meta.url), 'utf8'));
export const libraryRoot = resolve(process.env.BASS_MUSIC_BANK_ROOT || selection.libraryRoot);

export function samplePath(sample) {
  const path = resolve(libraryRoot, sample.relativePath);
  if (!path.startsWith(libraryRoot + sep)) throw new Error('Путь вне выбранной папки');
  return path;
}

export async function sampleBytes(sample) {
  const bytes = await readFile(samplePath(sample));
  if (bytes.length !== sample.bytes || createHash('sha256').update(bytes).digest('hex') !== sample.sha256) {
    throw new Error(`Изменился исходник: ${sample.id}`);
  }
  return bytes;
}
