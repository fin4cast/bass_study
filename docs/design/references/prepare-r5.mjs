import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const modelOnly = process.argv.slice(2).includes('--model-only');
if (process.argv.slice(2).some(argument => argument !== '--model-only')) {
  throw new Error('Использование: node docs/design/references/prepare-r5.mjs [--model-only]');
}

const base = new URL('./', import.meta.url);
const repository = new URL('../../../', base);
const resolve = name => new URL(name, base);
let view;
if (!modelOnly) {
  try {
    view = await readFile(resolve('fretboard-r5.view.html'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Не найден docs/design/references/fretboard-r5.view.html. Сначала подготовь экран; для отдельной сборки музыкальной модели используй --model-only.');
    }
    throw error;
  }
  if (/<!doctype|<(?:html|head|body)(?:\s|>)/i.test(view)) {
    throw new Error('fretboard-r5.view.html должен быть фрагментом без doctype/html/head/body.');
  }
  if ((view.match(/\bid\s*=\s*["']studio-fretboard-r5["']/g) || []).length !== 1) {
    throw new Error('fretboard-r5.view.html должен содержать ровно один корень id="studio-fretboard-r5".');
  }
}

const output = await build({
  root: fileURLToPath(repository),
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    lib: {
      entry: fileURLToPath(resolve('fretboard-r5.model.ts')),
      formats: ['iife'],
      name: 'BassReferenceMusic',
    },
    target: 'es2022',
    minify: true,
    write: false,
    emptyOutDir: false,
    copyPublicDir: false,
  },
});
const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => result.output).filter(item => item.type === 'chunk');
if (chunks.length !== 1 || !chunks[0].isEntry || chunks[0].imports.length || chunks[0].dynamicImports.length) {
  throw new Error('Ожидался один автономный IIFE без внешних импортов.');
}
const code = chunks[0].code;
const hash = data => createHash('sha256').update(data).digest('hex');
const inputs = {};
for (const path of ['src/music/index.ts', 'src/music/boxes.ts']) {
  inputs[path] = hash(await readFile(new URL(path, repository)));
}
let gitHead = null;
try {
  gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(repository), encoding: 'utf8', windowsHide: true }).trim();
} catch { /* Content hashes also identify the source outside a Git checkout. */ }

await writeFile(resolve('fretboard-r5.model.js'), code);
await writeFile(resolve('fretboard-r5.model.json'), JSON.stringify({
  format: 'bass-study-reference-model',
  revision: 'r5',
  gitHead,
  inputs,
  entrySha256: hash(await readFile(resolve('fretboard-r5.model.ts'))),
  bundleSha256: hash(code),
  global: 'BassReferenceMusic',
  target: 'es2022',
  scope: 'Pure src/music modules only; no app, audio, storage or dist writes.',
}, null, 2) + '\n');

if (modelOnly) {
  console.log('Собрана музыкальная модель r5: fretboard-r5.model.js и SHA-256 входных файлов. Приложение и dist не изменялись.');
} else {
  const inlineCode = code.replace(/<\/script/gi, '<\\/script');
  await writeFile(resolve('fretboard-r5.fragment.html'), `<script>\n${inlineCode}\n</script>\n${view}`);
  console.log('Собран docs/design/references/fretboard-r5.fragment.html из музыкальной модели и view. r1–r4 не изменялись.');
}
