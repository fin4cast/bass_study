// Общие действия раннера заданий R-006 после P13-08: атлас «Гриф» с мостиками, «Проверь себя» с видами вопросов,
// экран игры с шаблонами последовательностей и «Повторить» из «Прогресса». Тестового API в продукте нет: сценарии
// действуют через DOM, клавиатуру и указатель; данные читаются readonly-транзакцией нативной IndexedDB.
// Правильные ответы считаются независимо: полутоны на строе E–A–D–G, а не из модели сессии.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runP13BrowserChecks } from './p13-browser-harness.mjs';

export function runTrainingBrowserChecks(checks) {
  return runP13BrowserChecks(checks, {
    reportFile: 'p3-edge.json',
    scope: 'P13-08 R-006 tasks after the atlas split in the built product: atlas bridges to the play screen and «Проверь себя», question kinds find-note, find-all, name-note, find-pitch, find-interval, sequence templates on the play screen, session context and «Повторить» from «Прогресс». No audio, physical bass or durable-storage failure acceptance (P5 owns those).',
  });
}

/* ---------- Оболочка ---------- */

export async function ready(page) {
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main && !main.inert && main.getAttribute('aria-busy') === 'false' && document.querySelector('[data-lesson-screen="home"] .ls-plan, [data-lesson-screen="home"] .ls-hero');
  }, null, { timeout: 20000 });
}
export async function openApp(page, origin) { await page.goto(origin); await ready(page); }
export const section = page => page.locator('.site-header [aria-current="page"]').getAttribute('data-app-module');
export async function assertEventually(read, expected, what, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let actual;
  while (JSON.stringify(actual = await read()) !== JSON.stringify(expected)) {
    if (Date.now() > deadline) throw new Error(`${what}: ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`);
    await delay(50);
  }
  return actual;
}
export async function navigate(page, id) {
  await page.locator(`.site-header [data-app-module="${id}"]`).click();
  await assertEventually(() => section(page), id, `раздел ${id}`);
}
export async function openAtlas(page) {
  await navigate(page, 'foundation');
  await page.locator('[data-position]').first().waitFor();
}
export async function studySettings(page) {
  if (!await page.locator('#study-settings').isVisible()) await page.locator('#toggle-study-settings').click();
}
export async function disclose(page, selector) {
  await studySettings(page);
  const details = page.locator(selector);
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
}
export async function atlasRange(page, first, last) {
  await disclose(page, '#area-settings');
  const min = page.getByLabel('Первый лад', { exact: true }), max = page.getByLabel('Последний лад', { exact: true });
  await max.fill('24'); await min.fill(String(first)); await max.fill(String(last));
}
export async function atlasMaterial(page, root, structure, form) {
  await studySettings(page);
  await page.locator('#root-note').selectOption(root);
  await page.locator('#structure').selectOption(structure);
  if (form !== undefined) await page.locator('#box-select').selectOption({ label: form });
}

/* ---------- Мостики и экраны «Занятия» ---------- */

export const checkHost = page => page.locator('[data-lesson-screen="check"]');
export const playScene = page => page.locator('[data-lesson-screen="play"] .pl-scene');
export async function bridgeToCheck(page) {
  await page.getByRole('button', { name: 'Проверь себя по этой форме', exact: true }).click();
  await page.locator('[data-lesson-screen="check"]:not([hidden]) [data-ck-title]').waitFor();
  await assertEventually(() => section(page), 'lesson', 'мостик ведёт в «Занятие»');
}
export async function bridgeToPlay(page) {
  await page.getByRole('button', { name: 'Сыграть эту форму', exact: true }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene [data-title]').waitFor();
  await assertEventually(() => section(page), 'lesson', 'мостик ведёт в «Занятие»');
}
/** Вид вопроса меняется только до первого ответа серии: новая серия с первым вопросом. */
export async function chooseKind(page, kind) {
  const select = checkHost(page).locator('select[data-kind]');
  await select.selectOption(kind);
  await assertEventually(() => select.inputValue(), kind, 'вид вопроса');
  assert.match(await progressLabel(page), /^Вопрос 1 из \d+$/);
}
export const progressLabel = page => checkHost(page).locator('.ck-progress strong').innerText();
export const feedbackText = page => checkHost(page).locator('[data-ck-feedback]').innerText();
export const questionTitle = page => checkHost(page).locator('[data-ck-title]').innerText();
export const questionSub = page => checkHost(page).locator('.ck-ask .ck-sub').innerText();
export async function finishSeries(page) {
  await checkHost(page).locator('[data-act="finish"]').click();
  await checkHost(page).locator('[data-ck-summary]:not([hidden])').waitFor();
}
export async function summaryTiles(page) {
  return checkHost(page).locator('[data-ck-summary] .ck-tile').evaluateAll(list => Object.fromEntries(list.map(tile => [[...tile.classList].find(token => token.startsWith('ck-st-')).slice(6), Number(tile.querySelector('strong').textContent)])));
}

/**
 * Позиции материала — контуры формы на грифе ответа; ячейка под контуром определяется геометрией страницы.
 * Это видимые до ответа контуры без подписей, а не данные ответа.
 */
export async function materialPositions(page) {
  const material = await checkHost(page).evaluate(host => {
    const cells = [...host.querySelectorAll('[data-cell]')].map(cell => ({ id: cell.dataset.cell, rect: cell.getBoundingClientRect() }));
    return [...host.querySelectorAll('.ck-wrap svg .mb-ghost')].map(ghost => {
      const box = ghost.getBoundingClientRect(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
      return cells.filter(({ rect }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom).map(cell => cell.id);
    });
  });
  assert.ok(material.length > 0 && material.every(ids => ids.length === 1), `Контуры не совпали с ячейками: ${JSON.stringify(material)}`);
  return material.map(([id]) => id).sort(byPosition);
}
/** Весь участок материала: струны материала, лады от первого до последнего (интервал и «все ноты участка»). */
export function chromaticArea(positions) {
  const strings = STRING_ORDER.filter(string => positions.some(id => id.startsWith(`${string}:`)));
  const frets = positions.map(id => Number(id.split(':')[1]));
  const area = [];
  for (const string of strings) for (let fret = Math.min(...frets); fret <= Math.max(...frets); fret++) area.push(`${string}:${fret}`);
  return area.sort(byPosition);
}

/* ---------- Независимый оракул ---------- */

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTAL = { '♯': 1, '#': 1, '♭': -1, b: -1, '': 0 };
const OPEN = { E: 28, A: 33, D: 38, G: 43 };
const STRING_ORDER = ['E', 'A', 'D', 'G'];
export const byPosition = (a, b) => STRING_ORDER.indexOf(a[0]) - STRING_ORDER.indexOf(b[0]) || Number(a.split(':')[1]) - Number(b.split(':')[1]);
/** Класс высоты по написанию ноты (первый вариант, если подпись вида «C♯/D♭»). */
export function pitchClass(name) {
  const match = /^([A-G])(♯|#|♭|b)?/.exec(name.trim().split('/')[0]);
  assert.ok(match, `Нераспознанная нота ${name}`);
  return (LETTER[match[1]] + ACCIDENTAL[match[2] ?? ''] + 12) % 12;
}
/** MIDI по написанию с октавой (октава по букве): C4 = 60, E1 = 28 — открытая E. */
export function midiOf(name) {
  const match = /^([A-G])(♯|#|♭|b)?(-?\d)$/.exec(name.trim());
  assert.ok(match, `Нераспознанная высота ${name}`);
  return (Number(match[3]) + 1) * 12 + LETTER[match[1]] + ACCIDENTAL[match[2] ?? ''];
}
export const positionMidi = id => OPEN[id.split(':')[0]] + Number(id.split(':')[1]);
export const positionClass = id => positionMidi(id) % 12;
const SEMITONES = { '1': 0, '♭2': 1, '2': 2, '♭3': 3, '3': 4, '4': 5, '♯4': 6, '♭5': 6, '5': 7, '♯5': 8, '♭6': 8, '6': 9, '♭7': 10, '7': 11 };
export function semitonesOf(degree) {
  const value = SEMITONES[degree.trim().replace(/b/g, '♭').replace(/#/g, '♯')];
  assert.ok(value !== undefined, `Нераспознанный интервал ${degree}`);
  return value;
}

/* ---------- Без утечки ответа ---------- */

/**
 * До ответа в вопросе, кнопках и отзыве нет классов и атрибутов результата, а ячейки грифа и кнопки ответа
 * неразличимы, кроме своей позиции и подписи. Правильный ответ не попадает в DOM и ARIA.
 */
export async function answerLeakScan(page) {
  return checkHost(page).evaluate(host => {
    const scope = [host.querySelector('[data-ck-question]'), host.querySelector('[data-ck-buttons]'), host.querySelector('[data-ck-feedback]')];
    const problems = [];
    for (const element of scope.flatMap(root => [root, ...root.querySelectorAll('*')])) {
      for (const token of element.classList) if (/^(is-right|is-shown|is-found|is-final|is-correct|ck-st-)/.test(token)) problems.push(`class ${token} on ${element.tagName}`);
      for (const name of element.getAttributeNames()) if (/answer|correct|expected|target|degree|solution|midi/i.test(name)) problems.push(`attribute ${name}`);
      const label = element.getAttribute('aria-label') ?? '';
      if (/(?<![а-яё])верно|показанный ответ/i.test(label) || (element.hasAttribute('data-cell') && / — (ответ|найдено)$/.test(label))) problems.push(`aria-label ${label}`);
    }
    const variants = list => new Set(list.map(element => {
      const clone = element.cloneNode(true);
      for (const name of ['data-cell', 'data-key', 'data-choice', 'aria-label', 'aria-keyshortcuts', 'style', 'tabindex']) clone.removeAttribute(name);
      clone.querySelectorAll('strong, kbd, small').forEach(node => { node.textContent = ''; });
      return clone.outerHTML;
    })).size;
    const svg = host.querySelector('[data-ck-question] svg');
    return {
      problems,
      choiceVariants: variants([...host.querySelectorAll('[data-choice]')]),
      choiceLabels: [...host.querySelectorAll('[data-choice]')].map(choice => choice.getAttribute('aria-label')),
      cellVariants: variants([...host.querySelectorAll('[data-cell]')]),
      cellLabels: [...host.querySelectorAll('[data-cell]')].map(cell => cell.getAttribute('aria-label')),
      svgTexts: [...new Set([...svg.querySelectorAll('text')].map(node => node.getAttribute('class')))],
      html: document.documentElement.outerHTML,
    };
  });
}
export function assertNoLeak(scan, mode) {
  assert.deepEqual(scan.problems, [], 'Признаки ответа в DOM/ARIA до ответа');
  assert.deepEqual(scan.svgTexts.filter(name => !['mb-fret', 'mb-string-name'].includes(name)), [], 'На грифе вопроса нет подписей нот');
  if (mode === 'cards') {
    assert.ok(scan.choiceVariants <= 2, `Кнопки ответа отличаются не только подписью и клавишей: ${scan.choiceVariants}`);
    for (const label of scan.choiceLabels) assert.match(label, /^[^,]+(, клавиша \d)?$/);
  } else {
    assert.equal(scan.cellVariants, 1, 'Ячейки грифа отличаются не только позицией');
    for (const label of scan.cellLabels) assert.match(label, /^Струна [EADG], лад \d+$/);
  }
}
/** Фраза ответа из отзыва после закрытия вопроса; до ответа её нет в документе. */
export function answerPhrase(feedback) {
  const match = /^(?:Верно[^.]*\.\s*|Ответ показан:\s*)(.+?)(?:\s*В итоге.*)?$/.exec(feedback.trim());
  assert.ok(match, `Отзыв без ответа: ${feedback}`);
  return match[1];
}

/* ---------- Данные ---------- */

/** Readonly-чтение нативной IndexedDB приложения: без продуктового API и без создания базы. */
export async function readDb(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('База приложения ещё не создана')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = db.transaction(['preferences', 'history'], 'readonly');
      const done = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
      const get = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [preferences, history] = await Promise.all([get(transaction.objectStore('preferences').get('current')), get(transaction.objectStore('history').getAll())]);
      await done;
      return { version: db.version, preferences, history };
    } finally { db.close(); }
  });
}
export async function waitDb(page, predicate, what, timeout = 10000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const db = await readDb(page);
    if (predicate(db)) return db;
    if (Date.now() > deadline) throw new Error(`IndexedDB: не дождались «${what}»: ${JSON.stringify(db).slice(0, 2000)}`);
    await delay(100);
  }
}
export const screenEntries = db => db.history.filter(entry => entry.result?.kind === 'screen');
