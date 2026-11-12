import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Русский текст UTF-8, прочитанный как Windows-1251 и сохранённый заново, превращается в нечитаемые пары символов.
// Характерные пары таких последовательностей в нормальном русском тексте не встречаются.
const MOJIBAKE = /Р[°µѕ±іЅ·ґ»Ђ-Џ]|С[ЃЂ-Џ‚ЏЊ]|вЂ/;
const root = fileURLToPath(new URL('..', import.meta.url));
const TEXT = new Set(['.ts', '.mjs', '.js', '.css', '.html', '.md', '.json']);

function collect(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'test-results', '.git', 'vendor', 'licenses'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path, files);
    else if (TEXT.has(extname(entry.name)) && !entry.name.endsWith('.model.js')) files.push(path);
  }
  return files;
}

describe('кодировка текстов', () => {
  it('в исходниках, тестах и документах нет «кракозябр» от двойной перекодировки', () => {
    const broken = ['src', 'tests', 'docs', 'scripts'].flatMap(folder => collect(join(root, folder)))
      .filter(file => !file.endsWith('text-encoding.test.mjs') && MOJIBAKE.test(readFileSync(file, 'utf8')))
      .map(file => relative(root, file));
    expect(broken).toEqual([]);
  });
});
