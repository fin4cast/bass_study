// Экраны P13 в собранном приложении: меню, «Занятие» (сегодня, библиотека, план), экран игры, «Проверь себя»,
// справочник (страница и панель), тема; «Прогресс» — только как место, где видна отметка прохода после перезагрузки.
// Сценарии действуют через DOM, клавиатуру и указатель; данные читаются readonly-транзакцией нативной IndexedDB.
// Правильные ответы «Проверь себя» считаются независимо: полутоны от тоники на строе E–A–D–G.
import assert from 'node:assert/strict';
import { seedPlan } from './helpers/seed-plan.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { browserCases, markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';
import { runP13BrowserChecks } from './helpers/p13-browser-harness.mjs';

const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });

/* ---------- Общие действия ---------- */

const SECTIONS = [
  ['lesson', 'Занятие'], ['foundation', 'Гриф'], ['harmony', 'Ритм'], ['tracks', 'Песни'], ['progress', 'Прогресс'], ['settings', 'Настройки'],
];
const FIRST_RUN_PLAN = ['Одна нота по всему грифу', 'Октавы: +2 струны, +2 лада', 'Хроматика 1-2-3-4 в позиции'];

async function ready(page) {
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main && !main.inert && main.getAttribute('aria-busy') === 'false' && document.querySelector('[data-lesson-screen="home"] .ls-plan, [data-lesson-screen="home"] .ls-hero');
  }, null, { timeout: 20000 });
}
async function openApp(page, origin) {
  await page.goto(origin);
  await ready(page);
}
const home = page => page.locator('[data-lesson-screen="home"]');
const playScene = page => page.locator('[data-lesson-screen="play"] .pl-scene');
const checkHost = page => page.locator('[data-lesson-screen="check"]');

async function lessonTab(page, label) {
  const tab = home(page).getByRole('tab', { name: new RegExp(`^${label}`) });
  await tab.click();
  await assertAttribute(tab, 'aria-selected', 'true');
}
async function assertAttribute(locator, name, value, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let actual;
  while ((actual = await locator.getAttribute(name)) !== value) {
    if (Date.now() > deadline) throw new Error(`${name}=${JSON.stringify(actual)}, ожидалось ${JSON.stringify(value)}`);
    await delay(50);
  }
}

/** Readonly-чтение нативной IndexedDB приложения: без продуктового API и без создания базы. */
async function readDb(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('База приложения ещё не создана')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = db.transaction(['preferences', 'profile', 'history'], 'readonly');
      const done = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
      const get = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [preferences, profile, history] = await Promise.all([
        get(transaction.objectStore('preferences').get('current')),
        get(transaction.objectStore('profile').get('current')),
        get(transaction.objectStore('history').getAll()),
      ]);
      await done;
      return { version: db.version, preferences, profile, history };
    } finally { db.close(); }
  });
}
/** Ждёт подтверждённую запись: опрос readonly-чтением, пока условие не выполнится. */
async function waitDb(page, predicate, what, timeout = 10000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const db = await readDb(page);
    if (predicate(db)) return db;
    if (Date.now() > deadline) throw new Error(`IndexedDB: не дождались «${what}»: ${JSON.stringify(db).slice(0, 2000)}`);
    await delay(100);
  }
}
const planTitles = page => home(page).locator('.ls-plan .ls-step-title').allInnerTexts();


/* ---------- Настройка карточки библиотеки ---------- */

check('library-card-configure-form-b-keeps-form-a-in-plan-and-star-saves-configured-material', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await waitDb(page, db => db.preferences?.lesson?.plan?.steps?.length === 0, 'пустой план первого запуска');
  await lessonTab(page, 'Библиотека');
  const card = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: 'Форма пентатоники вверх-вниз', exact: true }) });
  await card.locator('[data-act="toggle-plan"]').click();
  await assertAttribute(card.locator('[data-act="toggle-plan"]'), 'aria-pressed', 'true');
  await card.locator('[data-act="configure"]').click();
  const shape = card.locator('[data-control="card-param"][data-param="shapeId"]');
  // Пользователь меняет значение со списка в фокусе (клавиатурой или мышью).
  await shape.focus();
  await shape.selectOption('penta-b');
  // Фокус остаётся на списке после перерисовки.
  assert.ok(await card.locator('[data-control="card-param"][data-param="shapeId"]').evaluate(element => document.activeElement === element), 'Фокус на списке формы');
  await card.locator('[data-control="card-param"][data-param="root"]').selectOption('E');
  assert.match(await card.locator('.ls-meta').innerText(), /Em · минорная пентатоника · форма B/);
  assert.equal(await card.locator('[data-act="toggle-plan"]').getAttribute('aria-pressed'), 'false', 'Форма B — другой материал, форма A остаётся в плане');
  await card.locator('[data-act="toggle-plan"]').click();
  const plan = await waitDb(page, db => db.preferences.lesson.plan.steps.length === 2, 'обе формы в плане');
  const shapes = plan.preferences.lesson.plan.steps.filter(step => step.content.spec?.templateId === 'pentatonic-form').map(step => `${step.content.spec.params.root}:${step.content.spec.params.shapeId}`);
  assert.deepEqual(shapes, ['A:penta-a', 'E:penta-b']);
  await card.locator('[data-act="save-start"]').click();
  await card.locator('[data-save-name]').fill('Моя форма B');
  await card.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const own = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: 'Моя форма B', exact: true }) });
  await own.waitFor();
  assert.match(await own.locator('.ls-meta').innerText(), /Em · минорная пентатоника · форма B/, '☆ сохранил настроенный материал');
  assert.equal(await own.locator('[data-act="configure"]').count(), 0, 'Свои карточки не настраиваются');
  await card.locator('[data-act="card-reset"]').click();
  assert.match(await card.locator('.ls-meta').innerText(), /Am · минорная пентатоника · форма A/);
  return { shapes };
});

/* ---------- Экран игры ---------- */

async function openPlanStep(page, title) {
  await seedPlan(page);
  await home(page).locator('.ls-plan').getByRole('button', { name: `Играть: ${title}`, exact: true }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  assert.equal(await playScene(page).locator('[data-title]').innerText(), title);
}
async function playState(page) {
  return page.evaluate(() => {
    const scene = document.querySelector('[data-lesson-screen="play"] .pl-scene');
    const text = scene.querySelector('[data-progress-text]').textContent;
    const match = /Нота (\d+) из (\d+)/.exec(text);
    const countIn = scene.querySelector('[data-countin]');
    return {
      status: scene.dataset.status, view: scene.dataset.view, text, note: match ? Number(match[1]) : null, total: match ? Number(match[2]) : null,
      countIn: countIn.hidden ? null : scene.querySelector('[data-countin-value]').textContent,
      meter: parseFloat(scene.querySelector('[data-meter]').style.width) || 0,
      now: scene.querySelector('[data-now-detail]')?.textContent ?? '',
    };
  });
}
/** Состояние транспорта из DOM экрана игры; выражение страницы для ожиданий по состоянию. */
const READ_PLAY = `(() => {
  const scene = document.querySelector('[data-lesson-screen="play"] .pl-scene');
  if (!scene) return null;
  const text = scene.querySelector('[data-progress-text]').textContent;
  const match = /Нота (\\d+) из (\\d+)/.exec(text);
  return { status: scene.dataset.status, view: scene.dataset.view, text, note: match ? Number(match[1]) : null,
    countIn: scene.querySelector('[data-countin]').hidden ? null : scene.querySelector('[data-countin-value]').textContent };
})()`;
/** Ждёт состояние транспорта; опрос по интервалу, а не по кадрам: в скрытой вкладке кадры не идут. */
async function waitPlay(page, predicate, arg = null, timeout = 15000) {
  await page.waitForFunction(`(() => { const state = ${READ_PLAY}; return !!state && (${predicate.toString()})(state, ${JSON.stringify(arg)}); })()`, null, { timeout, polling: 50 });
  return playState(page);
}
/** Журнал состояния транспорта по изменениям DOM экрана игры (MutationObserver), с отметками времени страницы. */
async function startPlayLog(page) {
  await page.evaluate(() => {
    const scene = document.querySelector('[data-lesson-screen="play"] .pl-scene');
    const log = [];
    let last = '';
    const record = () => {
      const countIn = scene.querySelector('[data-countin]');
      const entry = { t: performance.now(), status: scene.dataset.status, view: scene.dataset.view, text: scene.querySelector('[data-progress-text]').textContent,
        countIn: countIn.hidden ? null : scene.querySelector('[data-countin-value]').textContent, now: scene.querySelector('[data-now-detail]')?.textContent ?? '' };
      const key = JSON.stringify({ ...entry, t: 0 });
      if (key !== last) { last = key; log.push(entry); }
    };
    record();
    new MutationObserver(record).observe(scene, { subtree: true, attributes: true, childList: true, characterData: true });
    window.__p13PlayLog = log;
  });
}
const playLog = (page, since = 0) => page.evaluate(since => window.__p13PlayLog.filter(entry => entry.t >= since), since);
const pageNow = page => page.evaluate(() => performance.now());
/** Клавиши транспорта действуют, когда фокус не на кнопке: фокус на заголовке экрана игры, как после открытия. */
async function focusPlayTitle(page) {
  await playScene(page).locator('[data-title]').focus();
}
async function startPlayback(page) {
  await playScene(page).locator('[data-play]').click();
  return waitPlay(page, state => state.status === 'playing' && state.note >= 1, null, 20000);
}

/* ---------- Независимый оракул ступеней ---------- */

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTAL = { '♯': 1, '#': 1, '♭': -1, b: -1 };
const OPEN = { E: 28, A: 33, D: 38, G: 43 };
const DEGREES = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
function pitchClass(name) {
  const match = /^([A-G])([♯#♭b]?)$/.exec(name.trim());
  assert.ok(match, `Нераспознанная тоника ${name}`);
  return (LETTER[match[1]] + (ACCIDENTAL[match[2]] ?? 0) + 12) % 12;
}
const positionMidi = (string, fret) => OPEN[string] + Number(fret);
const degreeOf = (root, string, fret) => DEGREES[(positionMidi(string, fret) - pitchClass(root) + 120) % 12];
const normalizeDegree = label => label.trim().replace(/b/g, '♭').replace(/#/g, '♯');
const frequencyOf = (string, fret) => 440 * 2 ** ((positionMidi(string, fret) - 69) / 12);

/**
 * Утечка правильного ответа до ответа: весь вопрос, кнопки и отзыв не должны содержать классов и атрибутов результата,
 * а кнопки ответа и ячейки грифа должны быть неразличимы, кроме своей подписи и позиции.
 */
async function answerLeakScan(page) {
  return checkHost(page).evaluate(host => {
    const scope = [host.querySelector('[data-ck-question]'), host.querySelector('[data-ck-buttons]'), host.querySelector('[data-ck-feedback]')];
    const problems = [];
    const elements = scope.flatMap(root => [root, ...root.querySelectorAll('*')]);
    for (const element of elements) {
      for (const token of element.classList) if (/^(is-right|is-shown|is-found|is-final|is-correct|ck-st-)/.test(token)) problems.push(`class ${token} on ${element.tagName}`);
      for (const name of element.getAttributeNames()) {
        if (/answer|correct|expected|target|degree|solution|midi/i.test(name)) problems.push(`attribute ${name}`);
        if (!/^(class|type|tabindex|style|role|aria-label|aria-hidden|aria-keyshortcuts|aria-disabled|focusable|xmlns|viewBox|x|y|x1|x2|y1|y2|cx|cy|r|width|height|stroke-width|text-anchor|data-cell|data-key|data-choice|data-act|data-ck-title|data-ck-question|data-ck-buttons|data-ck-feedback|data-tone|data-cue-step|aria-live|disabled)$/i.test(name)) problems.push(`unexpected attribute ${name}`);
      }
      const label = element.getAttribute('aria-label') ?? '';
      // Подписи результата: «, верно», «, показанный ответ» у кнопок; « — ответ», « — найдено» в конце подписи ячейки.
      if (/(?<![а-яё])верно|показанный ответ/i.test(label) || (element.hasAttribute('data-cell') && / — (ответ|найдено)$/.test(label))) problems.push(`aria-label ${label}`);
    }
    const normalized = list => list.map(element => {
      const clone = element.cloneNode(true);
      for (const name of ['data-cell', 'data-key', 'data-choice', 'aria-label', 'aria-keyshortcuts', 'style', 'tabindex']) clone.removeAttribute(name);
      clone.querySelectorAll('strong, kbd').forEach(node => { node.textContent = ''; });
      return clone.outerHTML;
    });
    const choices = [...host.querySelectorAll('[data-choice]')];
    const cells = [...host.querySelectorAll('[data-cell]')];
    const unique = list => [...new Set(normalized(list))];
    const svg = host.querySelector('[data-ck-question] svg');
    return {
      problems,
      choiceVariants: unique(choices).length,
      choiceLabels: choices.map(choice => choice.getAttribute('aria-label')),
      cellVariants: unique(cells).length,
      cellLabels: cells.map(cell => cell.getAttribute('aria-label')),
      noteClasses: [...new Set([...svg.querySelectorAll('circle.mb-note, .mb-current-ring')].map(node => node.getAttribute('class')))],
      svgTexts: [...new Set([...svg.querySelectorAll('text')].map(node => node.getAttribute('class')))],
      html: document.documentElement.outerHTML,
    };
  });
}
function assertNoLeak(scan, mode) {
  assert.deepEqual(scan.problems, [], 'Признаки ответа в DOM/ARIA до ответа');
  assert.deepEqual(scan.svgTexts.filter(name => !['mb-fret', 'mb-string-name'].includes(name)), [], 'На грифе вопроса нет подписей нот');
  if (mode === 'cards') {
    assert.equal(scan.choiceVariants, 1, 'Кнопки ступеней отличаются не только подписью');
    for (const label of scan.choiceLabels) assert.match(label, /^[^,]+, клавиша \d$/);
    assert.deepEqual(scan.noteClasses.sort(), ['mb-current-ring', 'mb-note mb-ghost', 'mb-note mb-ghost is-current'].sort(), 'На мини-грифе только контуры и отмеченная позиция вопроса');
  } else {
    assert.equal(scan.cellVariants, 1, 'Ячейки грифа отличаются не только позицией');
    for (const label of scan.cellLabels) assert.match(label, /^Струна [EADG], лад \d+$/);
    assert.deepEqual(scan.noteClasses, ['mb-note mb-ghost'], 'На грифе ответа только одинаковые контуры материала');
  }
}
/** Фраза ответа из отзыва после закрытия вопроса; её не было в документе до ответа. */
function answerPhrase(feedback) {
  const match = /^(?:Верно[^.]*\.\s*|Ответ показан:\s*)(.+?)(?:\s*В итоге.*)?$/.exec(feedback.trim());
  assert.ok(match, `Отзыв без ответа: ${feedback}`);
  return match[1];
}
async function feedbackText(page) { return checkHost(page).locator('[data-ck-feedback]').innerText(); }

async function cardsQuestion(page) {
  const title = await checkHost(page).locator('[data-ck-title]').innerText();
  const sub = await checkHost(page).locator('.ck-ask .ck-sub').innerText();
  const root = /Какая это ступень от ([A-G][♯♭]?)\?/.exec(title)?.[1];
  const position = /Отмеченная нота — ([EADG])\/(\d+)\./.exec(sub);
  assert.ok(root && position, `Вопрос не распознан: ${title} / ${sub}`);
  const expected = degreeOf(root, position[1], position[2]);
  const labels = (await checkHost(page).locator('[data-choice] strong').allInnerTexts()).map(normalizeDegree);
  const index = labels.indexOf(expected);
  assert.ok(index >= 0, `Независимый ответ ${expected} (${root}, ${position[1]}/${position[2]}) нет среди вариантов ${labels.join(' ')}`);
  return { root, position: `${position[1]}/${position[2]}`, expected, labels, index, wrong: labels.findIndex((_, i) => i !== index) };
}
const progressLabel = page => checkHost(page).locator('.ck-progress strong').innerText();

async function boardQuestion(page) {
  const title = await checkHost(page).locator('[data-ck-title]').innerText();
  const sub = await checkHost(page).locator('.ck-ask .ck-sub').innerText();
  const degree = /^Найди (?:тонику )?(\S+)$/.exec(title.trim())?.[1];
  const root = /Тоника — ([A-G][♯♭]?)\./.exec(sub)?.[1];
  assert.ok(degree && root, `Вопрос не распознан: ${title} / ${sub}`);
  // Позиции материала — контуры формы на грифе; ячейка под контуром определяется геометрией страницы.
  const material = await checkHost(page).evaluate(host => {
    const cells = [...host.querySelectorAll('[data-cell]')].map(cell => ({ id: cell.dataset.cell, rect: cell.getBoundingClientRect() }));
    return [...host.querySelectorAll('.ck-wrap svg .mb-ghost')].map(ghost => {
      const box = ghost.getBoundingClientRect(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
      return cells.filter(({ rect }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom).map(cell => cell.id);
    });
  });
  assert.ok(material.length > 0 && material.every(ids => ids.length === 1), `Контуры не совпали с ячейками: ${JSON.stringify(material)}`);
  const positions = material.map(([id]) => id);
  const target = normalizeDegree(degree);
  const answers = positions.filter(id => { const [string, fret] = id.split(':'); return degreeOf(root, string, fret) === target; }).sort();
  const wrong = positions.filter(id => !answers.includes(id));
  assert.ok(answers.length > 0, `В материале ${positions.join(' ')} нет ступени ${target} от ${root}`);
  return { root, target, positions, answers, wrong };
}

/* ---------- Оболочка ---------- */

check('shell-start-opens-lesson-and-menu-switches-six-sections-with-aria-current', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  const state = () => page.evaluate(() => ({
    current: [...document.querySelectorAll('.site-header [data-app-module]')].filter(button => button.getAttribute('aria-current') === 'page').map(button => button.dataset.appModule),
    visible: [...document.querySelectorAll('main [data-page-frame]')].filter(frame => !frame.hidden).map(frame => frame.dataset.pageFrame),
    order: [...document.querySelectorAll('.site-header [data-app-module]')].map(button => button.dataset.appModule),
  }));
  const start = await state();
  assert.deepEqual(start.current, ['lesson']);
  assert.deepEqual(start.visible, ['lesson']);
  assert.deepEqual(start.order, SECTIONS.map(([id]) => id), 'Пять разделов в меню и «Настройки» внизу');
  assert.equal(await home(page).locator('h1').innerText(), 'Занятие');
  const visited = [];
  for (const id of ['foundation', 'harmony', 'tracks', 'progress', 'settings', 'lesson']) {
    await page.locator(`.site-header [data-app-module="${id}"]`).click();
    await page.waitForFunction(id => !document.querySelector(`[data-page-frame="${id}"]`).hidden, id);
    const after = await state();
    assert.deepEqual(after.current, [id], `aria-current после перехода в ${id}`);
    assert.deepEqual(after.visible, [id], `видимая страница после перехода в ${id}`);
    visited.push(after);
  }
  const db = await waitDb(page, db => db.preferences?.activeModule === 'lesson', 'выбранный раздел сохранён');
  return { start, visited, savedActiveModule: db.preferences.activeModule };
});

check('shell-menu-names-and-navigation-label-are-readable-russian', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  const names = await page.locator('.site-header [data-app-module]').evaluateAll(buttons => buttons.map(button => [button.dataset.appModule, button.textContent.trim()]));
  const navigation = await page.locator('.module-navigation').getAttribute('aria-label');
  assert.deepEqual({ names, navigation }, { names: SECTIONS, navigation: 'Разделы тренажёра' }, 'Подписи меню должны быть читаемыми');
  for (const [id, title] of SECTIONS) await page.getByRole('button', { name: title, exact: true }).and(page.locator(`[data-app-module="${id}"]`)).waitFor();
  return { names, navigation };
});

/* ---------- «Сегодня» и план ---------- */

check('today-first-run-shows-empty-plan-with-library-hint-and-saves-it', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  const tab = home(page).getByRole('tab', { name: /^Сегодня/ });
  assert.equal(await tab.getAttribute('aria-selected'), 'true');
  assert.match(await home(page).locator('.ls-hero').innerText(), /План пуст[\s\S]*Открыть библиотеку/i);
  assert.equal(await home(page).locator('.ls-goal-choose, [data-act="goal-start"], [data-act="template"]').count(), 0, 'целей и шаблонов планов нет');
  assert.deepEqual(await planTitles(page), []);
  assert.match(await home(page).locator('.ls-plan h2').innerText(), /^План на сегодня · 0 мин$/);
  const db = await waitDb(page, db => db.preferences?.lesson?.plan?.steps?.length === 0, 'пустой план первого запуска');
  assert.equal(db.version, 15);
  assert.equal(db.preferences.lesson.basicsView, 'path');
  assert.deepEqual(db.preferences.lesson.skipped, []);
  return { plan: db.preferences.lesson.plan };
});

check('library-add-to-plan-appears-in-today-and-survives-reload', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await waitDb(page, db => db.preferences?.lesson?.plan?.steps?.length === 0, 'пустой план первого запуска');
  await lessonTab(page, 'Библиотека');
  const title = 'Смена позиции по струне';
  const card = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const add = card.locator('[data-act="toggle-plan"]');
  assert.equal(await add.getAttribute('aria-pressed'), 'false');
  await add.click();
  await assertAttribute(card.locator('[data-act="toggle-plan"]'), 'aria-pressed', 'true');
  assert.equal((await card.locator('[data-act="toggle-plan"]').innerText()).trim(), '✓ в плане');
  assert.match(await home(page).locator('[data-toast]').innerText(), new RegExp(`Добавлено в план «Сегодня»: ${title}`));
  assert.match(await home(page).locator('.ls-planbar').innerText(), new RegExp(`1 шаг[\\s\\S]*${title}`));
  await lessonTab(page, 'Сегодня');
  assert.deepEqual(await planTitles(page), [title]);
  const db = await waitDb(page, db => db.preferences?.lesson?.plan?.steps?.length === 1, 'шаг из библиотеки в плане');
  const added = db.preferences.lesson.plan.steps.at(-1);
  assert.equal(added.content.kind, 'exercise');
  assert.equal(added.status, 'current', 'первый шаг пустого плана становится текущим');
  await page.reload();
  await ready(page);
  await lessonTab(page, 'Сегодня');
  assert.deepEqual(await planTitles(page), [title], 'План после перезагрузки');
  const after = await readDb(page);
  assert.deepEqual(after.preferences.lesson.plan, db.preferences.lesson.plan, 'Перезагрузка не переписывает план');
  return { added: { id: added.id, templateId: added.content.spec.templateId, minutes: added.minutes }, afterReload: await planTitles(page) };
});

/* ---------- Экран игры ---------- */

check('play-count-in-note-progress-space-pause-resume-view-and-escape', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, 'Хроматика 1-2-3-4 в позиции');
  const initial = await playState(page);
  assert.equal(initial.status, 'stopped');
  assert.equal(initial.view, 'board', 'Новое упражнение открывается видом «Гриф»');
  assert.match(initial.text, /^Нота 0 из \d+$/);
  await startPlayLog(page);
  await playScene(page).locator('[data-play]').click();
  // Отсчёт — крупно и по долям 1…4.
  await waitPlay(page, state => state.countIn !== null);
  const countIn = await playScene(page).locator('[data-countin]').evaluate(box => {
    const rect = box.getBoundingClientRect(); const value = box.querySelector('[data-countin-value]');
    return { width: rect.width, height: rect.height, fontSize: parseFloat(getComputedStyle(value).fontSize), visible: rect.width > 0 && rect.height > 0 && getComputedStyle(box).visibility !== 'hidden' };
  });
  assert.ok(countIn.visible && countIn.fontSize >= 32, `Отсчёт виден крупно: ${JSON.stringify(countIn)}`);
  const first = await waitPlay(page, state => state.status === 'playing' && state.note >= 2, null, 20000);
  const growing = await waitPlay(page, (state, note) => state.status === 'playing' && state.note > note, first.note, 5000);
  assert.ok(growing.meter > first.meter || growing.note > first.note);
  const counted = (await playLog(page)).filter(entry => entry.countIn !== null).map(entry => entry.countIn);
  assert.deepEqual([...new Set(counted)], ['1', '2', '3', '4'], 'Отсчёт показывает доли по порядку');

  // Пробел — пауза: номер ноты стоит не меньше секунды.
  await focusPlayTitle(page);
  await page.keyboard.press('Space');
  const paused = await waitPlay(page, state => state.status === 'paused', null, 3000);
  assert.match(paused.text, /· пауза$/);
  const pausedAt = await pageNow(page);
  await delay(1200);
  const still = await playState(page);
  const pauseLog = await playLog(page, pausedAt);
  assert.equal(still.status, 'paused');
  assert.equal(still.note, paused.note, 'Номер ноты не меняется на паузе');
  assert.ok(pauseLog.every(entry => entry.status === 'paused' && entry.text === paused.text), `На паузе экран не меняется: ${JSON.stringify(pauseLog)}`);
  assert.ok((await pageNow(page)) - pausedAt >= 1000);

  // Пробел — продолжение без отсчёта, со следующей ноты.
  const resumedAt = await pageNow(page);
  await page.keyboard.press('Space');
  const resumed = await waitPlay(page, (state, note) => state.status === 'playing' && state.note > note, paused.note, 5000);
  const resumeLog = await playLog(page, resumedAt);
  assert.ok(resumeLog.every(entry => entry.status !== 'counting' && entry.countIn === null), `Продолжение без отсчёта: ${JSON.stringify(resumeLog)}`);
  const firstAfter = resumeLog.find(entry => entry.status === 'playing');
  assert.ok(Number(/Нота (\d+)/.exec(firstAfter.text)[1]) >= paused.note, 'Продолжение не начинается с первой ноты');

  // Смена вида не останавливает игру.
  const beforeView = await playState(page);
  await page.keyboard.press('Digit3');
  await waitPlay(page, state => state.view === 'tab', null, 3000);
  assert.equal(await playScene(page).locator('button[data-view="tab"]').getAttribute('aria-pressed'), 'true');
  const afterView = await waitPlay(page, (state, text) => state.status === 'playing' && state.text !== text, beforeView.text, 5000);
  assert.ok((await playLog(page, resumedAt)).every(entry => entry.status === 'playing'), 'Игра не прерывалась при смене вида');
  const remembered = await waitDb(page, db => Object.values(db.preferences?.lesson?.exerciseSettings ?? {}).some(item => item.view === 'tab'), 'вид упражнения запомнен');

  // Esc — к началу; следующий старт снова с отсчётом.
  await page.keyboard.press('Escape');
  const stopped = await waitPlay(page, state => state.status === 'stopped', null, 3000);
  assert.match(stopped.text, /^Нота 0 из \d+ · с начала$/);
  await page.keyboard.press('Space');
  const again = await waitPlay(page, state => state.status === 'counting' && state.countIn !== null, null, 5000);
  await page.keyboard.press('Escape');
  await waitPlay(page, state => state.status === 'stopped', null, 3000);
  return { initial, countIn, first, growing, paused, still, resumed, afterView, stopped, restartCountIn: again.countIn, exerciseSettings: remembered.preferences.lesson.exerciseSettings };
});

check('play-self-assessment-clean-is-saved-and-visible-in-progress-after-reload', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  const title = FIRST_RUN_PLAN[0];
  await openPlanStep(page, title);
  const loop = playScene(page).locator('[data-flag="loop"]');
  await loop.click();
  assert.equal(await loop.getAttribute('aria-pressed'), 'false');
  for (let index = 0; index < 12; index++) await playScene(page).getByRole('button', { name: /^Быстрее на/ }).click();
  assert.equal(await playScene(page).locator('[data-bpm]').inputValue(), '120');
  await playScene(page).locator('[data-play]').click();
  const rate = playScene(page).getByRole('group', { name: 'Самооценка подхода' });
  await rate.waitFor({ timeout: 20000 });
  const finished = await playState(page);
  assert.equal(finished.status, 'finished');
  assert.match(finished.text, /проход завершён/);
  assert.match(await rate.innerText(), /Подход: 1 проход · 120 BPM\.[\s\S]*Как прошло\?/);
  await rate.getByRole('button', { name: 'Чисто', exact: true }).click();
  assert.equal(await rate.getByRole('button', { name: 'Чисто', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.ok(await rate.getByRole('button', { name: 'С ошибками', exact: true }).isDisabled(), 'Одна отметка на проход');
  const db = await waitDb(page, db => db.history.some(entry => entry.result?.material?.kind === 'exercise' && entry.result.assessment === 'clean'), 'самооценка «Чисто» в истории');
  const entry = db.history.find(item => item.result?.material?.kind === 'exercise');
  assert.equal(db.history.length, 1);
  assert.equal(entry.result.material.title, title);
  assert.equal(entry.result.comfortableBpm, 120);
  assert.ok(entry.result.durationMs > 0, 'Активное время прохода по аудиочасам');
  const planned = await waitDb(page, db => db.preferences?.lesson?.plan?.steps?.[0]?.status === 'done', 'шаг плана отмечен');

  await page.reload();
  await ready(page);
  await lessonTab(page, 'Сегодня');
  assert.equal(await home(page).locator('.ls-plan .ls-step').first().getAttribute('class'), 'ls-step is-done');
  await page.locator('.site-header [data-app-module="progress"]').click();
  const progress = page.locator('[data-page-frame="progress"]');
  await progress.getByText(title).first().waitFor();
  assert.equal(await progress.locator('.pg-empty').count(), 0, '«Прогресс» не пуст после отметки');
  return { entry: { id: entry.id, title: entry.result.material.title, assessment: entry.result.assessment, bpm: entry.result.comfortableBpm, durationMs: entry.result.durationMs, view: entry.result.material.view },
    planStep: planned.preferences.lesson.plan.steps[0].status };
});

/* ---------- Экран игры D-050: звук и ритм, подход, петля, план ---------- */

check('play-sound-panel-chromatic-reference-metronome-count-in-rhythm-applied-and-remembered', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, 'Хроматика 1-2-3-4 в позиции');
  // «Гриф» — без TAB; у хроматики нет тоники — «Ступени» недоступны с пояснением.
  await playScene(page).locator('button[data-view="board"]').click();
  assert.equal(await playScene(page).locator('[data-area="board"] [data-tab]').count(), 0, 'В виде «Гриф» TAB нет');
  const degree = playScene(page).locator('button[data-label="degree"]');
  assert.equal(await degree.isDisabled(), true);
  assert.match(await degree.getAttribute('title'), /нет тоники/);
  await focusPlayTitle(page);
  await page.keyboard.press('KeyM');
  const panel = playScene(page).getByRole('group', { name: 'Звук и ритм' });
  await panel.waitFor();
  await panel.locator('[data-reference="off"]').click();
  await panel.locator('[data-metronome="two-four"]').click();
  await panel.locator('[data-countin-bars="2"]').click();
  await panel.locator('[data-rhythm-select]').selectOption('quarters');
  assert.match(await playScene(page).locator('[data-sound-summary]').innerText(), /эталон выкл · 2 и 4 · отсчёт 2/);
  assert.match(await playScene(page).locator('[data-sub]').innerText(), /четверти · 4 такта/);
  const saved = await waitDb(page, db => db.preferences?.play?.reference === 'off' && db.preferences.play.metronome === 'two-four' && db.preferences.play.countInBars === 2
    && Object.values(db.preferences.lesson.exerciseSettings ?? {}).some(item => item.rhythm === 'quarters'), 'звук и ритм запомнены');
  // Отсчёт идёт два такта.
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'counting', null, 5000);
  const counted = await page.evaluate(() => new Promise(resolve => {
    const scene = document.querySelector('[data-lesson-screen="play"] .pl-scene');
    let fours = 0, last = '';
    const timer = setInterval(() => {
      const value = scene.querySelector('[data-countin-value]').textContent;
      if (value !== last && value === '4') fours++;
      last = value;
      if (scene.dataset.status === 'playing') { clearInterval(timer); resolve(fours); }
    }, 10);
  }));
  assert.equal(counted, 2, 'Два такта отсчёта');
  await page.keyboard.press('Escape');
  // Повторное открытие — с тем же ритмом и звуком.
  await playScene(page).locator('[data-back]').click();
  await openPlanStep(page, 'Хроматика 1-2-3-4 в позиции');
  assert.match(await playScene(page).locator('[data-sound-summary]').innerText(), /эталон выкл · 2 и 4 · отсчёт 2/);
  assert.match(await playScene(page).locator('[data-sub]').innerText(), /четверти/);
  return { play: saved.preferences.play, settings: saved.preferences.lesson.exerciseSettings };
});

check('play-loop-approach-rated-once-after-stop-with-keys-and-loop-on-current-bar', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await lessonTab(page, 'Библиотека');
  const card = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: 'Форма пентатоники вверх-вниз', exact: true }) });
  await card.getByRole('button', { name: /^Играть/ }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  assert.equal(await playScene(page).locator('[data-flag="loop"]').getAttribute('aria-pressed'), 'true');
  await playScene(page).locator('[data-bpm]').fill('200'); await playScene(page).locator('[data-bpm]').press('Enter');
  await focusPlayTitle(page); await page.keyboard.press('Space');
  // Два прохода по кругу — панель оценки не всплывает на каждом круге.
  await waitPlay(page, state => state.status === 'playing' && /проход 3/.test(state.text), null, 30000);
  const rate = playScene(page).getByRole('group', { name: 'Самооценка подхода' });
  assert.equal(await rate.isVisible(), false, 'Во время петли оценка не мешает');
  // L — петля на текущий такт; игра перезапускается с петлёй.
  await page.keyboard.press('KeyL');
  await assertAttribute(playScene(page).locator('[data-clear-range]'), 'hidden', null);
  assert.match(await playScene(page).locator('[data-clear-range]').innerText(), /^Петля: такт \d ✕$/);
  await waitPlay(page, state => state.status === 'playing' && /проход 2/.test(state.text), null, 30000);
  // Esc — к началу и оценка подхода; X — «С ошибками».
  await page.keyboard.press('Escape');
  await rate.waitFor();
  // Петля не обнуляет подход: два прохода до L и один на петле.
  assert.match(await rate.innerText(), /Подход: 3 прохода · 200 BPM/);
  await page.keyboard.press('KeyX');
  const db = await waitDb(page, db => db.history.some(entry => entry.result?.assessment === 'errors'), '«С ошибками» в истории');
  const entry = db.history.find(item => item.result?.assessment === 'errors');
  assert.equal(entry.result.material.wholePass, false, 'Подход на петле — не целый проход');
  return { material: entry.result.material };
});

check('plan-step-timer-and-next-step-after-rating', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[0]);
  assert.match(await playScene(page).locator('[data-timer]').innerText(), /^шаг: 0:00 из 3 мин$/);
  await playScene(page).locator('[data-flag="loop"]').click();
  await playScene(page).locator('[data-bpm]').fill('200'); await playScene(page).locator('[data-bpm]').press('Enter');
  await focusPlayTitle(page); await page.keyboard.press('Space');
  const rate = playScene(page).getByRole('group', { name: 'Самооценка подхода' });
  await rate.waitFor({ timeout: 20000 });
  assert.match(await playScene(page).locator('[data-timer]').innerText(), /^шаг: 0:0[1-9] из 3 мин$/);
  await page.keyboard.press('KeyZ');
  const next = rate.getByRole('button', { name: 'Следующий шаг плана →' });
  await next.waitFor();
  await page.keyboard.press('Enter');
  await waitPlay(page, () => true, null, 5000);
  await page.waitForFunction(title => document.querySelector('[data-lesson-screen="play"] [data-title]')?.textContent === title, FIRST_RUN_PLAN[1]);
  const db = await waitDb(page, db => db.preferences.lesson.plan.steps[0].status === 'done', 'первый шаг выполнен');
  return { steps: db.preferences.lesson.plan.steps.map(step => step.status) };
});

check('play-right-hand-echo-and-shuffle-groove-on-string-crossing-and-memory-pulse', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await lessonTab(page, 'Библиотека');
  const card = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: 'Переход между струнами (правая рука)', exact: true }) });
  await card.locator('[data-act="configure"]').click();
  await card.locator('[data-param="pattern"]').selectOption('raking');
  await card.getByRole('button', { name: /^Играть/ }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  await playScene(page).locator('button[data-view="board"]').click();
  const pluck = playScene(page).locator('button[data-label="pluck"]');
  assert.equal(await pluck.isDisabled(), false);
  await pluck.click();
  const labels = await playScene(page).locator('[data-board="board"] .pl-note-label').allTextContents();
  assert.ok(labels.length && labels.every(label => label === 'i' || label === 'm'), `Подписи правой руки: ${labels}`);
  await playScene(page).locator('[data-panel-toggle]').click();
  const panel = playScene(page).getByRole('group', { name: 'Звук и ритм' });
  await panel.locator('[data-groove]').selectOption('shuffle');
  await panel.locator('[data-flag="echo"]').click();
  assert.match(await playScene(page).locator('[data-sub]').innerText(), /эхо/);
  assert.match(await playScene(page).locator('[data-sound-summary]').innerText(), /эхо · .* · шаффл/);
  await playScene(page).locator('button[data-view="memory"]').click();
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing', null, 10000);
  await page.waitForFunction(() => document.querySelector('[data-lesson-screen="play"] [data-pulse].is-on') !== null, null, { timeout: 5000 });
  assert.match(await playScene(page).locator('[data-mem-bar]').innerText(), /^такт \d+ из \d+$/);
  await page.keyboard.press('Escape');
  return { labels: [...new Set(labels)] };
});

/* ---------- P17-fix: клавиши после мыши, подход до оценки, таймер, темп, «как играть» шага ---------- */

const rateGroup = page => playScene(page).getByRole('group', { name: 'Самооценка подхода' });
async function setBpm(page, value) {
  await playScene(page).locator('[data-bpm]').fill(String(value));
  await playScene(page).locator('[data-bpm]').press('Enter');
}

check('play-keys-work-after-mouse-clicks-rating-view-panel-and-timer-counts-rated-approach', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[0]);
  await playScene(page).locator('[data-flag="loop"]').click();
  await setBpm(page, 200);
  // Старт мышью: фокус остаётся на «Играть», клавиши экрана всё равно работают.
  await playScene(page).locator('[data-play]').click();
  await rateGroup(page).waitFor({ timeout: 20000 });
  await page.keyboard.press('KeyZ');
  await waitDb(page, db => db.history.some(entry => entry.result?.assessment === 'clean'), 'Z после клика мышью — «Чисто» в истории');
  // Таймер шага после коммита учитывает оценённый подход.
  await page.waitForFunction(() => !/^шаг: 0:00 /.test(document.querySelector('[data-lesson-screen="play"] [data-timer]')?.textContent ?? ''), null, { timeout: 5000 });
  // «Ещё подход» мышью, затем 4 — вид «По памяти».
  await rateGroup(page).getByRole('button', { name: 'Ещё подход', exact: true }).click();
  await page.keyboard.press('Digit4');
  await assertAttribute(playScene(page).locator('button[data-view="memory"]'), 'aria-pressed', 'true');
  // «Звук и ритм» открыта мышью — M её закрывает.
  await playScene(page).locator('[data-panel-toggle]').click();
  await assertAttribute(playScene(page).locator('[data-panel-toggle]'), 'aria-expanded', 'true');
  await page.keyboard.press('KeyM');
  await assertAttribute(playScene(page).locator('[data-panel-toggle]'), 'aria-expanded', 'false');
  // Оценка мышью, затем Enter — следующий шаг плана.
  await playScene(page).locator('[data-play]').click();
  await rateGroup(page).waitFor({ timeout: 20000 });
  await rateGroup(page).getByRole('button', { name: 'С ошибками', exact: true }).click();
  await rateGroup(page).getByRole('button', { name: 'Следующий шаг плана →' }).waitFor();
  await page.keyboard.press('Enter');
  await page.waitForFunction(title => document.querySelector('[data-lesson-screen="play"] [data-title]')?.textContent === title, FIRST_RUN_PLAN[1]);
  return { ok: true };
});

check('play-approach-continues-until-rated-and-partial-first-pass-is-rated-not-whole', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[0]);
  await setBpm(page, 200);
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing' && /проход 2/.test(state.text), null, 30000);
  await page.keyboard.press('Escape');
  await rateGroup(page).waitFor();
  assert.match(await rateGroup(page).innerText(), /Подход: 1 проход · 200 BPM/);
  // Новый старт без оценки продолжает тот же подход.
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing' && /проход 2/.test(state.text), null, 30000);
  await page.keyboard.press('Escape');
  await rateGroup(page).waitFor();
  assert.match(await rateGroup(page).innerText(), /Подход: 2 прохода · 200 BPM/);
  await page.keyboard.press('KeyX');
  await waitDb(page, db => db.history.some(entry => entry.result?.assessment === 'errors'), 'подход из двух запусков записан');
  // Недоигранный первый проход (≥ 5 с) оценивается как неполный: не целиком, шаг плана не закрыт.
  // Хроматика на 40 BPM — проход 12 с, Esc на седьмой секунде.
  await playScene(page).locator('[data-back]').click();
  await openPlanStep(page, FIRST_RUN_PLAN[2]);
  await setBpm(page, 40);
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing', null, 10000);
  await page.waitForTimeout(6500);
  await page.keyboard.press('Escape');
  await rateGroup(page).waitFor();
  assert.match(await rateGroup(page).innerText(), /Подход: неполный проход · 40 BPM/);
  await page.keyboard.press('KeyZ');
  const db = await waitDb(page, db => db.history.some(entry => entry.result?.assessment === 'clean'), 'неполный проход записан');
  const partial = db.history.find(entry => entry.result?.assessment === 'clean');
  assert.equal(partial.result.material.wholePass, false);
  assert.ok(partial.result.durationMs >= 5000, `время неполного прохода: ${partial.result.durationMs}`);
  assert.notEqual(db.preferences.lesson.plan.steps[2].status, 'done', '«Чисто» за неполный проход не закрывает шаг плана');
  return { partial: { wholePass: partial.result.material.wholePass, durationMs: partial.result.durationMs } };
});

check('play-rate-on-pause-then-resume-keeps-counting-the-same-approach', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[0]);
  await setBpm(page, 200);
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing' && /проход 2/.test(state.text), null, 30000);
  await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'paused', null, 5000);
  await playScene(page).locator('[data-rate-open]').click();
  await rateGroup(page).waitFor();
  assert.match(await rateGroup(page).innerText(), /Подход: 1 проход/);
  // Без оценки игра продолжается тем же подходом.
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing' && /проход 3/.test(state.text), null, 30000);
  await page.keyboard.press('Escape');
  await rateGroup(page).waitFor();
  assert.match(await rateGroup(page).innerText(), /Подход: 2 прохода/);
  return { ok: true };
});

check('play-enter-after-key-rating-with-focus-on-play-button-opens-next-step', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[0]);
  await playScene(page).locator('[data-flag="loop"]').click();
  await setBpm(page, 200);
  await playScene(page).locator('[data-play]').click();
  await rateGroup(page).waitFor({ timeout: 20000 });
  // Фокус остался на «Играть»: Z оценивает, Enter — следующий шаг, а не новый проход.
  await page.keyboard.press('KeyZ');
  await rateGroup(page).getByRole('button', { name: 'Следующий шаг плана →' }).waitFor();
  await page.keyboard.press('Enter');
  await page.waitForFunction(title => document.querySelector('[data-lesson-screen="play"] [data-title]')?.textContent === title, FIRST_RUN_PLAN[1], { timeout: 5000 });
  return { ok: true };
});

check('play-rated-on-pause-then-resumed-does-not-count-the-cut-pass-as-whole', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[2]);
  await setBpm(page, 200);
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing' && /проход 2/.test(state.text), null, 30000);
  await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'paused', null, 5000);
  await playScene(page).locator('[data-rate-open]').click();
  await rateGroup(page).waitFor();
  await page.keyboard.press('KeyZ');
  await waitDb(page, db => db.history.length === 1, 'первый подход записан');
  // Продолжение после оценки: оборванный проход 2 доигрывается, но целым проходом нового подхода не считается.
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing' && /проход 3/.test(state.text), null, 30000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const text = await rateGroup(page).isVisible() ? await rateGroup(page).innerText() : '';
  assert.doesNotMatch(text, /Подход: 1 проход/, `Обрывок прохода не засчитан целым: ${text}`);
  return { text };
});

check('play-slow-rating-opens-next-time-4-bpm-lower-even-after-sound-change', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[0]);
  await setBpm(page, 120);
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await waitPlay(page, state => state.status === 'playing' && /проход 2/.test(state.text), null, 30000);
  await page.keyboard.press('Escape');
  await rateGroup(page).waitFor();
  await page.keyboard.press('KeyC');
  await waitDb(page, db => db.history.some(entry => entry.result?.assessment === 'slow'), '«Не успевал» в истории');
  // Повторный Esc без запуска и смена звука после оценки не затирают сниженный темп.
  await focusPlayTitle(page); await page.keyboard.press('Escape');
  await playScene(page).locator('[data-panel-toggle]').click();
  await playScene(page).getByRole('group', { name: 'Звук и ритм' }).locator('[data-metronome="two-four"]').click();
  await waitDb(page, db => db.preferences?.play?.metronome === 'two-four', 'метроном запомнен');
  await playScene(page).locator('[data-back]').click();
  await openPlanStep(page, FIRST_RUN_PLAN[0]);
  assert.equal(await playScene(page).locator('[data-bpm]').inputValue(), '116');
  return { bpm: 116 };
});

check('play-memory-junction-without-positions-tab-anchors-without-tonic-and-right-hand-of-current-note', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await lessonTab(page, 'Библиотека');
  const open = async title => {
    await lessonTab(page, 'Библиотека');
    const card = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await card.getByRole('button', { name: /^Играть/ }).click();
    await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  };
  // «По памяти»: переход — куда и как, без ладов.
  await open('Связка соседних форм');
  await playScene(page).locator('button[data-view="memory"]').click();
  const junction = await playScene(page).locator('[data-mem-junction]').innerText();
  assert.doesNotMatch(junction, /[EADG]\/\d+/, `В «По памяти» переход без позиций: ${junction}`);
  // «Таб» у хроматики (без тоники): опоры — старт и финиш, а не пустая рамка.
  await playScene(page).locator('[data-back]').click();
  await open('Хроматика 1-2-3-4 в позиции');
  await playScene(page).locator('button[data-view="tab"]').click();
  assert.equal(await playScene(page).locator('[data-anchors-caption]').innerText(), 'Опоры: старт и финиш');
  assert.equal(await playScene(page).locator('[data-board="tab"] [data-position]').count(), 2);
  // Правая рука: до старта подписана только стартовая нота — её пальцем.
  await playScene(page).locator('[data-back]').click();
  await open('Переход между струнами (правая рука)');
  await playScene(page).locator('button[data-view="board"]').click();
  await playScene(page).locator('button[data-label="pluck"]').click();
  const labels = await playScene(page).locator('[data-board="board"] .pl-note-label').allTextContents();
  assert.deepEqual(labels, ['i'], `Подпись правой руки — только у стартовой ноты: ${labels}`);
  assert.match(await playScene(page).locator('[data-now-detail]').innerText(), /пр\. рука i/);
  return { junction, labels };
});

/* ---------- «Проверь себя» ---------- */

async function basicsLevels(page) {
  await lessonTab(page, 'Основы');
}

async function openBasicsCheck(page, level, step) {
  await basicsLevels(page);
  await home(page).locator(`[data-act="level"][data-value="${level}"]`).click();
  await home(page).locator(`[data-act="basics-step"][data-value="${step}"]`).click();
  await home(page).locator('[data-key="focus-primary"]', { hasText: 'Проверь себя' }).click();
  await page.locator('[data-lesson-screen="check"]:not([hidden]) [data-ck-title]').waitFor();
}

check('check-cards-answer-hidden-then-error-correction-reveal-skip-and-summary-saved', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openBasicsCheck(page, '1', '1:fifth:check');
  assert.match(await checkHost(page).locator('h1').innerText(), /^Проверь себя: назови ступень$/);
  const host = checkHost(page);
  const questions = [];

  // 1 — самостоятельно с первой попытки.
  let question = await cardsQuestion(page);
  let scan = await answerLeakScan(page); assertNoLeak(scan, 'cards');
  await host.locator(`[data-choice="${question.index}"]`).click();
  let feedback = await feedbackText(page);
  assert.match(feedback, /^Верно, с первой попытки\./);
  assert.ok(!scan.html.includes(answerPhrase(feedback)), 'Фраза ответа отсутствовала в документе до ответа');
  assert.match(await host.locator(`[data-choice="${question.index}"]`).getAttribute('class'), /is-right/);
  questions.push({ ...question, outcome: 'correct', phrase: answerPhrase(feedback) });
  await host.locator('[data-act="next"]').click();

  // 2 — ошибка, затем исправление.
  question = await cardsQuestion(page);
  scan = await answerLeakScan(page); assertNoLeak(scan, 'cards');
  await host.locator(`[data-choice="${question.wrong}"]`).click();
  assert.match(await feedbackText(page), new RegExp(`^Не ${question.labels[question.wrong]}\\.`));
  assert.equal(await host.locator(`[data-choice="${question.wrong}"]`).getAttribute('aria-disabled'), 'true');
  assert.match(await host.locator(`[data-choice="${question.wrong}"]`).getAttribute('aria-label'), /неверно/);
  assert.equal(await host.locator('[data-act="next"]').count(), 0, 'После ошибки вопрос не закрыт');
  const afterError = await answerLeakScan(page);
  assert.deepEqual(afterError.problems, [], 'Ошибка не раскрывает правильный ответ');
  await host.locator(`[data-choice="${question.index}"]`).click();
  feedback = await feedbackText(page);
  assert.match(feedback, /^Верно, с исправлением \(ошибок: 1\)\./);
  assert.ok(!scan.html.includes(answerPhrase(feedback)));
  questions.push({ ...question, outcome: 'corrected', phrase: answerPhrase(feedback) });
  await host.locator('[data-act="next"]').click();

  // 3 — показ ответа.
  question = await cardsQuestion(page);
  scan = await answerLeakScan(page); assertNoLeak(scan, 'cards');
  await host.locator('[data-act="reveal"]').click();
  feedback = await feedbackText(page);
  assert.match(feedback, /^Ответ показан: .* В итоге — «показано», не самостоятельно\.$/);
  assert.ok(!scan.html.includes(answerPhrase(feedback)));
  assert.match(await host.locator(`[data-choice="${question.index}"]`).getAttribute('class'), /is-shown/, 'Показан независимо вычисленный ответ');
  questions.push({ ...question, outcome: 'revealed', phrase: answerPhrase(feedback) });
  await host.locator('[data-act="next"]').click();

  // 4 — пропуск сразу ведёт к следующему вопросу.
  question = await cardsQuestion(page);
  scan = await answerLeakScan(page); assertNoLeak(scan, 'cards');
  await host.locator('[data-act="skip"]').click();
  assert.equal(await progressLabel(page), 'Вопрос 5 из 6');
  questions.push({ ...question, outcome: 'skipped' });

  // 5 — досрочное завершение: 5 и 6 без ответа.
  scan = await answerLeakScan(page); assertNoLeak(scan, 'cards');
  await host.locator('[data-act="finish"]').click();
  const summary = host.locator('[data-ck-summary]');
  await summary.waitFor();
  assert.match(await summary.locator('h2').innerText(), /^Серия завершена досрочно: 4 из 6$/);
  const tiles = await summary.locator('.ck-tile').evaluateAll(list => Object.fromEntries(list.map(tile => [[...tile.classList].find(token => token.startsWith('ck-st-')).slice(6), Number(tile.querySelector('strong').textContent)])));
  assert.deepEqual(tiles, { self: 1, fix: 1, err: 1, shown: 1, skip: 1, none: 2 });
  const statuses = await summary.locator('.ck-list .ck-status').allInnerTexts();
  assert.deepEqual(statuses, ['Самостоятельно', 'С исправлением', 'Показано', 'Пропущено', 'Без ответа', 'Без ответа']);

  const db = await waitDb(page, db => db.history.some(entry => entry.result?.kind === 'check'), 'итог «Проверь себя» в истории');
  const entry = db.history.find(item => item.result?.kind === 'check');
  assert.equal(entry.result.source, 'screen-check');
  assert.deepEqual(entry.result.answers.map(answer => answer.outcome), ['correct', 'corrected', 'revealed', 'skipped', 'unanswered', 'unanswered']);
  assert.deepEqual(entry.result.answers.map(answer => answer.errors), [0, 1, 0, 0, 0, 0]);
  assert.deepEqual(entry.result.answers.slice(0, 4).map(answer => normalizeDegree(answer.degree)), questions.map(item => item.expected), 'Сохранённые ступени совпадают с независимым расчётом');
  return { questions: questions.map(({ root, position, expected, outcome, phrase }) => ({ root, position, expected, outcome, phrase })), tiles, statuses, history: { id: entry.id, title: entry.result.title, answers: entry.result.answers } };
});

check('check-board-answer-positions-hidden-then-correction-and-reveal-match-independent-oracle', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openBasicsCheck(page, '2', '2:pentatonic:check');
  assert.match(await checkHost(page).locator('h1').innerText(), /^Проверь себя: найди ступень на грифе$/);
  const host = checkHost(page);
  assert.equal(await host.locator('[data-act="toggle-contour"]').getAttribute('aria-pressed'), 'true');

  let question = await boardQuestion(page);
  let scan = await answerLeakScan(page); assertNoLeak(scan, 'board');
  assert.ok(question.wrong.length > 0);
  await host.locator(`[data-cell="${question.wrong[0]}"]`).click();
  const [string, fret] = question.wrong[0].split(':');
  assert.match(await feedbackText(page), new RegExp(`^${string}/${fret} — это ${degreeOf(question.root, string, fret)}, не ${question.target}\\.`), 'Отзыв об ошибке называет нажатую ступень');
  assert.match(await host.locator(`[data-cell="${question.wrong[0]}"]`).getAttribute('class'), /is-wrong/);
  await host.locator(`[data-cell="${question.answers[0]}"]`).click();
  let feedback = await feedbackText(page);
  assert.match(feedback, /^Верно, с исправлением \(ошибок: 1\)\./);
  assert.ok(!scan.html.includes(answerPhrase(feedback)), 'Фраза ответа отсутствовала в документе до ответа');
  const first = { ...question, phrase: answerPhrase(feedback) };
  await host.locator('[data-act="next"]').click();

  question = await boardQuestion(page);
  scan = await answerLeakScan(page); assertNoLeak(scan, 'board');
  await host.locator('[data-act="reveal"]').click();
  feedback = await feedbackText(page);
  assert.ok(!scan.html.includes(answerPhrase(feedback)));
  const shown = (await host.locator('[data-cell].is-shown').evaluateAll(cells => cells.map(cell => cell.dataset.cell))).sort();
  assert.deepEqual(shown, question.answers, 'Показанные позиции — ровно независимо вычисленные позиции ступени в материале');
  await host.locator('[data-act="finish"]').click();
  await host.locator('[data-ck-summary]').waitFor();
  const db = await waitDb(page, db => db.history.some(entry => entry.result?.kind === 'check'), 'итог «Проверь себя» в истории');
  const entry = db.history.find(item => item.result?.kind === 'check');
  assert.deepEqual(entry.result.answers.slice(0, 2).map(answer => [normalizeDegree(answer.degree), answer.outcome]), [[first.target, 'corrected'], [question.target, 'revealed']]);
  assert.equal(entry.result.spec.kind, 'find-degree');
  return { first: { root: first.root, target: first.target, answers: first.answers, wrong: first.wrong[0], phrase: first.phrase }, second: { target: question.target, answers: question.answers, shown }, answers: entry.result.answers };
});

/* ---------- Справочник ---------- */

check('reference-page-search-selects-card-and-back-returns-to-lesson', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await basicsLevels(page);
  const concept = await home(page).locator('.ls-focus h2').innerText();
  await home(page).locator('[data-key="focus-concept"]').click();
  const reference = page.locator('[data-lesson-screen="reference"]');
  await page.locator('[data-lesson-screen="reference"]:not([hidden]) .rf-card-head h2').waitFor();
  assert.equal(await reference.locator('.rf-card-head h2').innerText(), concept);
  assert.ok(await reference.locator('.rf-card-head h2').evaluate(heading => document.activeElement === heading), 'Фокус на заголовке карточки');
  assert.ok(await home(page).isHidden());
  const search = reference.getByRole('searchbox', { name: 'Поиск понятий' });
  await search.fill('кварта');
  const items = reference.locator('[data-concept]');
  const found = await items.allInnerTexts();
  assert.ok(found.length >= 1 && found.some(text => /^Кварта/.test(text.trim())), `Поиск нашёл кварту: ${found}`);
  await items.filter({ hasText: /^Кварта/ }).first().click();
  assert.equal(await reference.locator('.rf-card-head h2').innerText(), 'Кварта');
  assert.equal(await items.filter({ hasText: /^Кварта/ }).first().getAttribute('aria-current'), 'true');
  await search.fill('шмяк');
  assert.match(await reference.locator('.rf-empty').innerText(), /Ничего не нашлось по «шмяк»/);
  await search.fill('');
  assert.ok((await items.count()) > found.length, 'Пустой запрос возвращает весь список');
  await reference.getByRole('button', { name: '← Занятие' }).click();
  await page.locator('[data-lesson-screen="home"]:not([hidden])').waitFor();
  assert.ok(await reference.isHidden());
  return { opened: concept, found, total: await items.count() };
});

check('reference-panel-over-playing-screen-pauses-traps-tab-and-escape-returns-focus', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[0]);
  await startPlayback(page);
  const chip = playScene(page).locator('.pl-chip[data-concept="octave"]');
  await chip.click();
  const dialog = page.getByRole('dialog', { name: 'Справочник' });
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute('aria-modal'), 'true');
  assert.equal(await dialog.locator('.rf-card-head h2').innerText(), 'Октава');
  assert.match(await dialog.locator('[data-from]').innerText(), /из экрана игры · «Октава»/);
  const paused = await waitPlay(page, state => state.status === 'paused', null, 3000);
  assert.ok(await page.locator('main').evaluate(main => main.inert || main.closest('[inert]') !== null), 'Страница под панелью инертна');

  // Tab и Shift+Tab не выводят фокус из панели.
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  const visited = new Set();
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press('Tab');
    assert.ok(await inside(), `Tab ${index + 1} вывел фокус из панели`);
    visited.add(await page.evaluate(() => document.activeElement.outerHTML.slice(0, 60)));
  }
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press('Shift+Tab');
    assert.ok(await inside(), `Shift+Tab ${index + 1} вывел фокус из панели`);
  }
  // Переход внутри панели и возврат.
  await dialog.getByRole('searchbox', { name: 'Поиск по справочнику' }).fill('кварта');
  await dialog.locator('[data-hit]').filter({ hasText: /^Кварта/ }).first().click();
  assert.equal(await dialog.locator('.rf-card-head h2').innerText(), 'Кварта');
  await dialog.getByRole('button', { name: 'Назад к предыдущему понятию' }).click();
  assert.equal(await dialog.locator('.rf-card-head h2').innerText(), 'Октава');

  const closedAt = await pageNow(page);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await chip.evaluate(element => document.activeElement === element), 'Esc вернул фокус к термину');
  assert.ok(!await page.locator('main').evaluate(main => main.inert), 'Страница снова доступна');
  await startPlayLog(page);
  await delay(600);
  const after = await playState(page);
  assert.equal(after.status, 'paused', 'После панели игра стоит на паузе: Esc панели не сбрасывает игру и не продолжает её');
  assert.ok((await playLog(page, closedAt)).every(entry => entry.status === 'paused'));
  await playScene(page).locator('[data-play]').click();
  await waitPlay(page, state => state.status === 'playing', null, 5000);
  await playScene(page).locator('[data-restart]').click();
  return { paused, tabStops: visited.size, after };
});

/* ---------- Тема ---------- */

check('theme-light-dark-choice-persists-after-reload', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  const theme = () => page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    pressed: [...document.querySelectorAll('.site-header [data-theme-choice]')].filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.dataset.themeChoice),
    background: getComputedStyle(document.body).backgroundColor,
  }));
  const initial = await theme();
  assert.deepEqual([initial.theme, initial.pressed], ['light', ['light']]);
  const results = [initial];
  for (const choice of ['dark', 'light']) {
    await page.locator(`.site-header [data-theme-choice="${choice}"]`).click();
    const applied = await theme();
    assert.deepEqual([applied.theme, applied.pressed], [choice, [choice]]);
    assert.notEqual(applied.background, results.at(-1).background, 'Фон страницы меняется вместе с темой');
    await waitDb(page, db => db.profile?.theme === choice, `тема ${choice} в профиле`);
    await page.reload();
    await ready(page);
    const reloaded = await theme();
    assert.deepEqual([reloaded.theme, reloaded.pressed, reloaded.background], [choice, [choice], applied.background], `Тема ${choice} после перезагрузки`);
    results.push(reloaded);
  }
  return { results };
});

/* ---------- Полный набор: живой звук, настоящее скрытие вкладки, второе окно ---------- */

check('live-play-sounds-reached-notes-on-audio-clock-and-pause-cancels-scheduled-voices', 'live', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, 'Хроматика 1-2-3-4 в позиции');
  await startPlayLog(page);
  const bpm = Number(await playScene(page).locator('[data-bpm]').inputValue());
  await startPlayback(page);
  await page.waitForFunction(() => window.__p13Audio.levels().some(level => level.rms > 0.005), null, { timeout: 5000 });
  const playing = await waitPlay(page, state => state.status === 'playing' && state.note >= 4, null, 10000);
  await focusPlayTitle(page);
  // Пауза в момент, когда следующая нота уже отправлена в Web Audio на будущее (упреждение планировщика),
  // но ещё не наступила по аудиочасам: она должна быть отменена и не считаться прозвучавшей.
  const scheduledAhead = await page.waitForFunction(() => {
    const now = Math.max(...window.__p13Audio.levels().map(level => level.audioTime));
    const future = window.__p13Audio.voices().filter(voice => voice.type === 'sawtooth' && voice.startAt > now + 0.15 && voice.stops.length === 1);
    return future.length ? { now, future: future.map(voice => voice.startAt) } : false;
  }, null, { timeout: 5000, polling: 'raf' }).then(handle => handle.jsonValue());
  await page.keyboard.press('Space');
  const paused = await waitPlay(page, state => state.status === 'paused', null, 3000);
  await page.waitForFunction(() => window.__p13Audio.levels().every(level => level.rms < 0.0001), null, { timeout: 3000 });
  const atPause = await page.evaluate(() => ({ voices: window.__p13Audio.voices(), levels: window.__p13Audio.levels() }));

  // Позиции нот — из того, что показал экран («Сейчас» на виде «Гриф»); частота — из строя E–A–D–G.
  const shownPositions = new Map();
  for (const entry of await playLog(page)) {
    const note = /Нота (\d+)/.exec(entry.text)?.[1]; const position = /([EADG])\/(\d+)/.exec(entry.now);
    if ((entry.status === 'playing' || entry.status === 'paused') && note && position) shownPositions.set(Number(note), [position[1], Number(position[2])]);
  }
  const bass = atPause.voices.filter(voice => voice.type === 'sawtooth' && voice.startAt !== null).sort((a, b) => a.startAt - b.startAt);
  const clicks = atPause.voices.filter(voice => voice.type === 'triangle' && voice.startAt !== null).sort((a, b) => a.startAt - b.startAt);
  const pauseAudio = Math.min(...bass.flatMap(voice => voice.stops.slice(1).map(stop => stop.at)), ...clicks.flatMap(voice => voice.stops.slice(1).map(stop => stop.at)));
  assert.ok(Number.isFinite(pauseAudio), 'Пауза останавливает голоса на аудиочасах');
  const sounded = bass.filter(voice => voice.startAt <= pauseAudio + 1e-6);
  const cancelled = bass.filter(voice => voice.startAt > pauseAudio + 1e-6);
  // Запланированное, но не наступившее, остановлено до начала и не считается прозвучавшим.
  for (const voice of cancelled) assert.ok(voice.stops.some(stop => stop.at <= voice.startAt + 1e-9), `Будущая нота ${voice.id} не отменена: ${JSON.stringify(voice)}`);
  assert.equal(sounded.length, paused.note, `Прозвучавших нот столько, сколько показал экран: ${sounded.length} vs ${paused.note}`);
  assert.ok(cancelled.length >= 1 && scheduledAhead.future.every(at => cancelled.some(voice => Math.abs(voice.startAt - at) < 1e-9)), `Нота, запланированная до паузы, отменена: ${JSON.stringify({ scheduledAhead, cancelled })}`);
  sounded.forEach((voice, index) => {
    const position = shownPositions.get(index + 1);
    assert.ok(position, `Экран показывал позицию ноты ${index + 1}`);
    assert.ok(Math.abs(voice.frequency - frequencyOf(...position)) < 0.01, `Нота ${index + 1}: ${voice.frequency} Гц, позиция ${position.join('/')}`);
    if (index) assert.ok(Math.abs(voice.startAt - sounded[index - 1].startAt - 30 / bpm) < 0.002, 'Восьмые по аудиочасам');
  });
  const countInClicks = clicks.filter(voice => voice.startAt < sounded[0].startAt - 1e-6);
  assert.equal(countInClicks.length, 4, 'Отсчёт — четыре клика до первой ноты');
  assert.ok(Math.abs(sounded[0].startAt - countInClicks[0].startAt - 4 * 60 / bpm) < 0.002, 'Первая нота через четыре доли отсчёта');

  // Продолжение: следующая нота без отсчёта.
  const resumeAudio = Math.max(...atPause.levels.map(level => level.audioTime));
  await page.keyboard.press('Space');
  const resumed = await waitPlay(page, (state, note) => state.status === 'playing' && state.note > note, paused.note, 5000);
  const after = await page.evaluate(() => window.__p13Audio.voices());
  const next = after.filter(voice => voice.type === 'sawtooth' && voice.startAt !== null && voice.startAt > pauseAudio + 1e-6 && !voice.stops.some(stop => stop.at <= voice.startAt + 1e-9 && stop.observedAt <= voice.startAt))
    .sort((a, b) => a.startAt - b.startAt)[0];
  assert.ok(next, 'После продолжения прозвучала нота');
  const nextPosition = shownPositions.get(paused.note + 1) ?? await (async () => {
    for (const entry of await playLog(page)) { const note = /Нота (\d+)/.exec(entry.text)?.[1]; const position = /([EADG])\/(\d+)/.exec(entry.now); if (Number(note) === paused.note + 1 && position) return [position[1], Number(position[2])]; }
    return null;
  })();
  assert.ok(nextPosition && Math.abs(next.frequency - frequencyOf(...nextPosition)) < 0.01, `Продолжение со следующей ноты: ${next.frequency} Гц, ${nextPosition}`);
  assert.ok(next.startAt - next.startObservedAt < 60 / bpm, 'Продолжение без повторного отсчёта');
  assert.ok(next.startAt >= resumeAudio - 1e-6);
  await page.keyboard.press('Escape');
  await waitPlay(page, state => state.status === 'stopped', null, 3000);
  assert.ok(Math.abs(next.frequency - cancelled[0].frequency) < 0.01, 'После продолжения звучит та нота, что была отменена паузой');
  return { bpm, playing, scheduledAhead, cancelledVoices: cancelled.map(({ frequency, startAt, stops }) => ({ frequency, startAt, stops })), paused, pauseAudio, sounded: sounded.map(({ frequency, startAt }) => ({ frequency, startAt })), cancelled: cancelled.length, countIn: countInClicks.map(voice => voice.startAt), resumed, next: { frequency: next.frequency, startAt: next.startAt, observedAt: next.startObservedAt } };
});

check('native-real-hidden-tab-pauses-play-and-resumes-only-by-action', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, 'Хроматика 1-2-3-4 в позиции');
  await startPlayback(page);
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.waitForFunction(() => document.hidden, null, { timeout: 10000, polling: 100 });
  const hidden = await waitPlay(page, state => state.status === 'paused', null, 5000);
  assert.match(hidden.text, /пауза: вкладка скрыта$/);
  await page.bringToFront();
  await page.waitForFunction(() => !document.hidden, null, { timeout: 10000 });
  await startPlayLog(page);
  const shownAt = await pageNow(page);
  await delay(1000);
  const visible = await playState(page);
  assert.equal(visible.status, 'paused', 'Возврат во вкладку не продолжает игру сам');
  assert.ok((await playLog(page, shownAt)).every(entry => entry.status === 'paused'));
  await playScene(page).locator('[data-play]').click();
  const resumed = await waitPlay(page, (state, note) => state.status === 'playing' && state.note >= note, hidden.note, 5000);
  await other.close();
  return { actualDocumentHidden: true, hidden, visible, resumed };
}));

check('second-window-waits-for-writer-and-takes-over-after-first-closes', 'ui', async ({ page, origin, newPage }) => {
  await openApp(page, origin);
  const second = await newPage();
  await second.goto(origin);
  await second.waitForFunction(() => /уже открыто в другой вкладке/.test(document.querySelector('#persistence-message')?.textContent ?? ''), null, { timeout: 10000 });
  assert.ok(await second.locator('main').evaluate(main => main.inert), 'Второе окно не пишет и не принимает действий');
  assert.ok(await second.locator('.site-header [data-app-module="lesson"]').isDisabled());
  await page.close();
  await second.locator('#retry-tab').click();
  await ready(second);
  assert.ok(!await second.locator('main').evaluate(main => main.inert));
  return { secondWindowTookOver: true };
});

/** Проход в петле на 200 BPM, чтобы подход набрался быстро; панель оценки открывается после остановки. */
async function playOneLoopedPass(page) {
  const loop = playScene(page).locator('[data-flag="loop"]');
  if (await loop.getAttribute('aria-pressed') === 'true') await loop.click();
  await playScene(page).locator('[data-bpm]').fill('200'); await playScene(page).locator('[data-bpm]').press('Enter');
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await playScene(page).getByRole('group', { name: 'Самооценка подхода' }).waitFor({ timeout: 20000 });
}
const variantSelect = (page, param) => playScene(page).locator(`[data-variant="${param}"]`);
const selectedText = locator => locator.locator('option:checked').innerText();

check('play-variant-chromatic-fret-5-to-7-keeps-step-and-rates-the-new-material', 'ui', async ({ page, origin }) => {
  // P18-04: лад меняется на экране игры без возврата в библиотеку; история пишется на новый материал, шаг плана остаётся тем же.
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[2]);
  assert.equal(await selectedText(variantSelect(page, 'startFret')), '5');
  await variantSelect(page, 'startFret').selectOption({ label: '7' });
  assert.equal(await selectedText(variantSelect(page, 'startFret')), '7');
  assert.equal(await playScene(page).locator('[data-title]').innerText(), FIRST_RUN_PLAN[2], 'шаг плана тот же');
  await playScene(page).locator('[data-flag="loop"]').click();
  await playScene(page).locator('[data-bpm]').fill('200'); await playScene(page).locator('[data-bpm]').press('Enter');
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await playScene(page).getByRole('group', { name: 'Самооценка подхода' }).waitFor({ timeout: 20000 });
  await page.keyboard.press('KeyZ');
  const db = await waitDb(page, db => db.history.some(entry => entry.result?.assessment === 'clean'), '«Чисто» в истории');
  const entry = db.history.find(item => item.result?.assessment === 'clean');
  assert.match(entry.result.material.key, /^builtin:chromatic-position\.7/, 'проход записан на материал с 7-го лада');
  assert.equal(entry.result.material.spec.params.startFret, 7);
  assert.equal(db.preferences.lesson.plan.steps[2].status, 'done', 'оценка нового материала закрыла тот же шаг плана');
  return { key: entry.result.material.key };
});

/** Три строки задания видны во всех четырёх видах и вместе с остальным экраном помещаются в окно 1280×720 без прокрутки. */
async function assertTaskLinesFit(page, label) {
  await page.waitForFunction(() => document.querySelector('[data-lesson-screen="play"]:not([hidden]) [data-task="do"]')?.textContent);
  for (const view of ['board', 'both', 'tab', 'memory']) {
    await playScene(page).locator(`button[data-view="${view}"]`).click();
    const shown = await playScene(page).evaluate(scene => ['do', 'notice', 'clean'].map(line => {
      const node = scene.querySelector(`[data-task="${line}"]`);
      return { line, text: node.textContent, visible: node.getClientRects().length > 0 };
    }));
    for (const item of shown) assert.ok(item.text.length > 20 && item.visible, `${label} · ${view}: строка «${item.line}» не видна`);
    const size = await page.evaluate(() => ({ clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight,
      clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(size.scrollHeight <= size.clientHeight + 1 && size.scrollWidth <= size.clientWidth + 1, `${label} · ${view}: прокрутка ${JSON.stringify(size)}`);
  }
}
async function openLibraryPlay(page, title) {
  await lessonTab(page, 'Библиотека');
  const card = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card.getByRole('button', { name: /^Играть/ }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
}

check('play-task-lines-show-three-rows-in-all-views-and-fit-1280x720-on-the-longest-text', 'ui', async ({ page, origin }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, origin);
  await openLibraryPlay(page, 'Переход между струнами (правая рука)');
  await assertTaskLinesFit(page, 'Переход между струнами');
  const text = await playScene(page).locator('[data-task="do"]').innerText();
  assert.match(text, /открытые струны/i, 'строка относится к этому шаблону');
  return { text };
});

check('play-task-lines-fit-1280x720-for-every-library-template', 'ui', async ({ page, origin }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, origin);
  await lessonTab(page, 'Библиотека');
  const titles = await home(page).locator('.ls-lib-card h3, .ls-lib-card h2').allInnerTexts();
  assert.ok(titles.length >= 20, `в библиотеке ${titles.length} карточек`);
  for (const title of titles) {
    await openLibraryPlay(page, title.trim());
    await assertTaskLinesFit(page, title.trim());
    await playScene(page).locator('[data-back]').click();
  }
  return { templates: titles.length };
});

check('play-variant-unrated-approach-is-rated-first-or-dropped-explicitly-and-own-exercise-has-no-selectors', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[2]);
  const rate = playScene(page).getByRole('group', { name: 'Самооценка подхода' });
  // Идущий подход: смена варианта останавливает игру и сначала просит оценку прежнего материала.
  await playOneLoopedPass(page);
  await variantSelect(page, 'startFret').selectOption({ label: '9' });
  await rate.waitFor({ timeout: 10000 });
  assert.match(await playScene(page).locator('[data-variant-note]').innerText(), /После оценки вариант сменится: 9/);
  assert.equal(await selectedText(variantSelect(page, 'startFret')), '5', 'до оценки выбран прежний вариант');
  await rate.getByRole('button', { name: /^С ошибками/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-lesson-screen="play"] [data-variant="startFret"] option:checked')?.textContent === '9');
  let db = await waitDb(page, db => db.history.length === 1, 'подход записан');
  assert.match(db.history[0].result.material.key, /^builtin:chromatic-position\.5/, 'подход записан на прежний материал');
  assert.equal(db.preferences.lesson.plan.steps[2].status, 'current', '«С ошибками» шаг не закрывает');
  const timerText = await playScene(page).locator('[data-timer]').innerText();
  assert.match(timerText, /^шаг: 0:0[1-9] из \d+ мин$/, `таймер шага не обнулился: ${timerText}`);
  // «Сменить без оценки»: подход отброшен, в историю ничего не добавлено.
  await playOneLoopedPass(page);
  await variantSelect(page, 'startFret').selectOption({ label: '3' });
  await rate.waitFor({ timeout: 10000 });
  await rate.getByRole('button', { name: 'Сменить без оценки' }).click();
  await page.waitForFunction(() => document.querySelector('[data-lesson-screen="play"] [data-variant="startFret"] option:checked')?.textContent === '3');
  db = await readDb(page);
  assert.equal(db.history.length, 1, 'отброшенный подход не записан');
  // Закрытие панели оценки отменяет смену варианта.
  await playOneLoopedPass(page);
  await variantSelect(page, 'startFret').selectOption({ label: '4' });
  await rate.waitFor({ timeout: 10000 });
  await playScene(page).locator('[data-rate-close]').click();
  assert.equal(await selectedText(variantSelect(page, 'startFret')), '3', 'смена отменена');
  assert.equal(await playScene(page).locator('[data-variant-note]').isVisible(), false);
  // Свои упражнения варианта не меняют.
  await playScene(page).locator('[data-back]').click();
  await lessonTab(page, 'Библиотека');
  const card = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: 'Форма пентатоники вверх-вниз', exact: true }) });
  await card.locator('[data-act="save-start"]').click();
  await card.locator('[data-save-name]').fill('Моя форма');
  await card.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const own = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: 'Моя форма', exact: true }) });
  await own.getByRole('button', { name: /^Играть/ }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  assert.equal(await playScene(page).locator('[data-variant-box]').isVisible(), false, 'у своего упражнения переключателей варианта нет');
  return { history: db.history.length };
});

markFullOnly(checks, ['play-variant-unrated-approach-is-rated-first-or-dropped-explicitly-and-own-exercise-has-no-selectors'], FULL_ONLY.smoke);
markFullOnly(checks, ['play-task-lines-fit-1280x720-for-every-library-template'], FULL_ONLY.smoke);
markFullOnly(checks, ['native-real-hidden-tab-pauses-play-and-resumes-only-by-action'], FULL_ONLY.hiddenTab);
markFullOnly(checks, ['live-play-sounds-reached-notes-on-audio-clock-and-pause-cancels-scheduled-voices'], FULL_ONLY.liveAudio);
markFullOnly(checks, ['play-right-hand-echo-and-shuffle-groove-on-string-crossing-and-memory-pulse', 'play-approach-continues-until-rated-and-partial-first-pass-is-rated-not-whole',
  'play-rate-on-pause-then-resume-keeps-counting-the-same-approach', 'play-rated-on-pause-then-resumed-does-not-count-the-cut-pass-as-whole'], FULL_ONLY.smoke);
markFullOnly(checks, ['second-window-waits-for-writer-and-takes-over-after-first-closes'], 'несколько окон одного профиля: передача права записи после закрытия первого окна');

const selection = browserCases(checks);
await runP13BrowserChecks(selection.checks, { reportFile: selection.filtered ? 'p13-case-edge.json' : 'p13-edge.json' });
