import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'vite';

// Собирает модель VIS-10/VIS-11 r2 из чистых модулей продукта, сверяет материал
// с ручными контрольными примерами (R-014) и готовит фрагменты для render-lesson.mjs.
const modelOnly = process.argv.slice(2).includes('--model-only');
if (process.argv.slice(2).some(argument => argument !== '--model-only')) {
  throw new Error('Использование: node docs/design/references/prepare-lesson-r2.mjs [--model-only]');
}

const base = new URL('./', import.meta.url);
const repository = new URL('../../../', base);
const resolve = name => new URL(name, base);
// Экраны P13 на общем каркасе: занятие и игра (r2), «Проверь себя», «Прогресс», «Настройки», справочник (r1).
const VIEWS = ['lesson-r2-vis10', 'lesson-r2-vis11', 'p13-r1-vis02', 'p13-r1-vis08', 'p13-r1-vis09', 'p13-r1-vis12'];
const GLOBAL = 'BassLessonModel';

const output = await build({
  root: fileURLToPath(repository),
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    lib: { entry: fileURLToPath(resolve('lesson-r2.model.ts')), formats: ['iife'], name: GLOBAL },
    target: 'es2022', minify: true, write: false, emptyOutDir: false, copyPublicDir: false,
  },
});
const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => result.output).filter(item => item.type === 'chunk');
if (chunks.length !== 1 || !chunks[0].isEntry || chunks[0].imports.length || chunks[0].dynamicImports.length) {
  throw new Error('Ожидался один автономный IIFE без внешних импортов.');
}
const code = chunks[0].code;

// Контрольные примеры набраны вручную до запуска модели; расхождение останавливает сборку.
const EXPECTED = {
  ex1: 'E:5 E:8 A:5 A:7 D:5 D:7 G:5 G:7 G:9 G:7 D:10 D:7 A:10 A:7 E:10 E:8',
  ex1Names: 'A1 C2 D2 E2 G2 A2 C3 D3 E3 D3 C3 A2 G2 E2 D2 C2',
  ex1Shared: 'A:7 D:7 E:8 G:7',
  ex1FormA: 'E:5 E:8 A:5 A:7 D:5 D:7 G:5 G:7',
  ex1FormB: 'E:8 E:10 A:7 A:10 D:7 D:10 G:7 G:9',
  ex2: 'E:8 A:7 A:10 D:10 A:10 A:7',
  ex2Names: 'C2 E2 G2 C3 G2 E2',
  ex3: 'E:5 E:6 E:7 E:8 A:5 A:6 A:7 A:8 D:5 D:6 D:7 D:8 G:5 G:6 G:7 G:8',
  ex3Fingers: '1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4',
};
const sandbox = {};
vm.runInNewContext(`${code}\nthis.${GLOBAL} = ${GLOBAL};`, sandbox);
const material = sandbox[GLOBAL].buildLessonMaterial();
const actual = {
  ex1: material.ex1.notes.map(note => note.id).join(' '),
  ex1Names: material.ex1.notes.map(note => note.name).join(' '),
  ex1Shared: [...material.ex1.shared].sort().join(' '),
  ex1FormA: [...material.ex1.formA.ids].join(' '),
  ex1FormB: [...material.ex1.formB.ids].join(' '),
  ex2: material.ex2.notes.map(note => note.id).join(' '),
  ex2Names: material.ex2.notes.map(note => note.name).join(' '),
  ex3: material.ex3.notes.map(note => note.id).join(' '),
  ex3Fingers: material.ex3.fingers.join(' '),
};
const failures = Object.keys(EXPECTED).filter(key => EXPECTED[key] !== actual[key]);
if (failures.length) {
  for (const key of failures) console.error(`${key}\n  ожидалось: ${EXPECTED[key]}\n  получено:  ${actual[key]}`);
  throw new Error('Материал референса не совпал с контрольными примерами.');
}
console.log(`Контрольные примеры совпали: ${Object.keys(EXPECTED).length} проверок (EX-1, EX-2, EX-3).`);

const hash = data => createHash('sha256').update(data).digest('hex');
const inputs = {};
for (const path of ['src/music/index.ts', 'src/music/boxes.ts', 'src/training/index.ts', 'src/training/quiz-rules-v1.ts', 'src/notation/index.ts']) {
  inputs[path] = hash(await readFile(new URL(path, repository)));
}
let gitHead = null;
try {
  gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(repository), encoding: 'utf8', windowsHide: true }).trim();
} catch { /* Хеши содержимого определяют источник и вне Git. */ }

await writeFile(resolve('lesson-r2.model.js'), code);
await writeFile(resolve('lesson-r2.model.json'), JSON.stringify({
  format: 'bass-study-reference-model',
  revision: 'lesson-r2',
  gitHead,
  inputs,
  entrySha256: hash(await readFile(resolve('lesson-r2.model.ts'))),
  bundleSha256: hash(code),
  global: GLOBAL,
  target: 'es2022',
  controlExamples: EXPECTED,
  scope: 'Pure src/music, src/training and src/notation modules plus two reference-only helpers; no app, audio, storage or dist writes.',
}, null, 2) + '\n');

if (modelOnly) {
  console.log('Собрана модель lesson-r2: lesson-r2.model.js и манифест. Приложение и dist не изменялись.');
} else {
  const inlineCode = code.replace(/<\/script/gi, '<\\/script');
  const common = await readFile(resolve('lesson-r2.common.html'), 'utf8');
  for (const stem of VIEWS) {
    const viewUrl = resolve(`${stem}.view.html`);
    try { await access(viewUrl); } catch { console.log(`Пропущен ${stem}: нет view.`); continue; }
    const view = await readFile(viewUrl, 'utf8');
    if (/<!doctype|<(?:html|head|body)(?:\s|>)/i.test(view)) throw new Error(`${stem}.view.html должен быть фрагментом без doctype/html/head/body.`);
    if ((view.match(/\bid\s*=\s*["']studio-lesson["']/g) || []).length !== 1) throw new Error(`${stem}.view.html должен содержать ровно один корень id="studio-lesson".`);
    await writeFile(resolve(`${stem}.fragment.html`), `<script>\n${inlineCode}\n</script>\n${common}\n${view}`);
    console.log(`Собран ${stem}.fragment.html.`);
  }
}
