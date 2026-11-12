import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sections = {
  foundation: ['foundation', 'fretboard', 'player', 'training', 'notation', 'study-details'],
  ear: ['ear'],
  harmony: ['rhythm', 'rhythm/library', 'rhythm/view', 'rhythm/instrument-art'],
  tracks: ['studio', 'music-bank', 'tracks'],
  input: ['input'],
  route: ['route'],
  auxiliary: ['history', 'introduction'],
};

describe('границы экранов', () => {
  it('импортирует представления разделов только из своего раздела', () => {
    const owners = new Map();
    for (const [section, files] of Object.entries(sections)) {
      for (const name of files) owners.set(`src/ui/${name}`, section);
    }
    const violations = [];
    for (const [file, owner] of owners) {
      const source = readFileSync(new URL(`../${file}.ts`, import.meta.url), 'utf8');
      for (const [, dependency] of source.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
        const resolved = posix.join(posix.dirname(file), dependency.replace(/\.ts$/, ''));
        const dependencyOwner = owners.get(resolved);
        if (dependencyOwner && dependencyOwner !== owner) violations.push(`${file} → ${resolved}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('единое экранирование', () => {
  it('в src нет локальных копий экранирования вне src/ui/html.ts', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const files = [];
    const walk = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) files.push(relative(root, path).split(/[\\/]/).join('/'));
      }
    };
    walk(root);
    const copies = files.filter(file => file !== 'ui/html.ts' && /'&amp;'|"&amp;"|replace\(\/\[&<>/.test(readFileSync(join(root, file), 'utf8')));
    expect(copies).toEqual([]);
  });
});
