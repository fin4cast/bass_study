import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../src', import.meta.url));
const files = [];
const walk = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(css|ts)$/.test(entry.name)) files.push(relative(root, path).split(/[\\/]/).join('/'));
  }
};
walk(root);
const read = file => readFileSync(join(root, file), 'utf8');

describe('тема оформления', () => {
  it('цвета темы переключаются только через [data-theme], без light-dark()', () => {
    expect(files.filter(file => file.endsWith('.css') && read(file).includes('light-dark('))).toEqual([]);
  });

  it('theme.css подключается один раз — ссылкой в index.html, а не импортом модуля', () => {
    expect(files.filter(file => file.endsWith('.ts') && /theme\.css['"]/.test(read(file)))).toEqual([]);
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(index.match(/<link rel="stylesheet" href="\/src\/theme\.css">/g)).toHaveLength(1);
  });

  it('правила rhythm.css используют токены, а hex-цвета есть только в определениях токенов', () => {
    const literal = read('ui/rhythm.css').split(/\r?\n/).filter(line => /#[0-9a-f]{3,8}\b/i.test(line) && !/^\s*--[\w-]+:\s*#[0-9a-f]{3,8};\s*$/i.test(line));
    expect(literal).toEqual([]);
  });

  it('кегли, радиусы и гарнитуры из шкалы берутся из токенов theme.css (D-047)', () => {
    // Значения шкалы читаются из theme.css: при смене токена страж не устаревает.
    const theme = read('theme.css').split(/^@media/m)[0];
    const scale = prefix => [...theme.matchAll(new RegExp(`--${prefix}-[a-z0-9-]+:\\s*(\\d+)px`, 'g'))].map(match => match[1]);
    // --text-page — роль заголовка страницы, не ступень шкалы текста: крупные цифры и вопрос могут совпасть с ним по размеру.
    const pageTitle = theme.match(/--text-page:\s*(\d+)px/)[1];
    const sizes = new RegExp(`font-size:\\s*(?:${scale('text').filter(size => size !== pageTitle).join('|')})px\\b`);
    const radii = new RegExp(`border-radius:\\s*(?:${scale('radius').join('|')})px\\s*[;}!]`);
    expect(scale('text').length).toBeGreaterThan(5);
    const styles = files.filter(file => file.endsWith('.css') && file !== 'theme.css');
    const offenders = styles.flatMap(file => read(file).split(/\r?\n/).flatMap((line, index) => {
      const problems = [];
      if (sizes.test(line)) problems.push('кегль из шкалы числом');
      if (radii.test(line)) problems.push('радиус из шкалы числом');
      if (/Segoe UI|Consolas|Cascadia/.test(line)) problems.push('гарнитура вне --font-ui/--font-mono');
      return problems.map(problem => `${file}:${index + 1} ${problem}`);
    }));
    expect(offenders).toEqual([]);
  });

  it('скрытый текст использует общий .sr-only', () => {
    expect(files.filter(file => read(file).includes('mb-sr-only'))).toEqual([]);
  });
});
