// Экраны P13 в собранном приложении: меню, «Занятие» (сегодня, библиотека, план), экран игры, «Проверь себя»,
// справочник (страница и панель), тема; «Прогресс» — только как место, где видна отметка прохода после перезагрузки.
// Сценарии действуют через DOM, клавиатуру и указатель; данные читаются readonly-транзакцией нативной IndexedDB.
// Правильные ответы «Проверь себя» считаются независимо: полутоны от тоники на строе E–A–D–G.
import assert from 'node:assert/strict';
import { seedPlan } from './helpers/seed-plan.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { browserCases, markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';
import { runP13BrowserChecks } from './helpers/p13-browser-harness.mjs';
import { exportUi, go, restoreCopy } from './helpers/data-ui.mjs';

const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });

/* ---------- Общие действия ---------- */

const SECTIONS = [
  ['lesson', 'Занятие'], ['foundation', 'Гриф'], ['harmony', 'Ритм'], ['tracks', 'Песни'], ['progress', 'Прогресс'], ['settings', 'Настройки'],
];
/** Первое занятие, собранное программой (R-028): текущие шаги трёх линий этапа 1. */
const PROGRAM_DAY_ONE = ['Пульс на одной ноте', 'Ноты на струне', 'Игра по последовательности аккордов'];
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
  await waitDb(page, db => db.preferences?.lesson?.plan?.steps?.length === 3, 'занятие первого дня');
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
  const plan = await waitDb(page, db => db.preferences.lesson.plan.steps.length === 5, 'обе формы в плане');
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

check('today-first-day-is-composed-by-program-with-one-start-button', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  const tab = home(page).getByRole('tab', { name: /^Сегодня/ });
  assert.equal(await tab.getAttribute('aria-selected'), 'true');
  const hero = await home(page).locator('.ls-hero').innerText();
  assert.match(hero, /Первое занятие[\s\S]*Занятие 1[\s\S]*Начать[\s\S]*Уже умею: выбрать, с чего начать/i);
  assert.equal(await home(page).locator('.ls-hero [data-act="play"]').count(), 1, 'одна кнопка действия');
  assert.equal(await home(page).locator('.ls-goal-choose, [data-act="goal-start"], [data-act="template"], .ls-recs').count(), 0, 'целей, шаблонов и рекомендаций нет');
  assert.deepEqual(await planTitles(page), PROGRAM_DAY_ONE);
  assert.equal((await home(page).locator('[data-stage-line]').innerText()).trim(), 'Этап 1 · пройдено 0 · освоено 0');
  const db = await waitDb(page, db => db.preferences?.lesson?.plan?.steps?.length === 3, 'занятие первого дня');
  assert.equal(db.version, 16);
  assert.deepEqual(db.preferences.lesson.plan.steps.map(step => [step.id, step.programStep, step.status]), [
    ['d1', 't1-pulse.quarters', 'current'], ['d2', 'f1-ea5.naturals', 'pending'], ['d3', 'h1-open.quarters', 'pending'],
  ]);
  // Занятие 1 по таблице «Путь ученика» (R-028): пульс четвертями на открытой E, ноты струны E до 5-го лада, I–IV–V на открытых струнах в A.
  assert.deepEqual(db.preferences.lesson.plan.steps.map(step => step.content.spec.params), [
    { string: 'E', fret: 0, notes: 16 }, { string: 'E', fretMax: 5 }, { root: 'A', progression: 'I-IV-V', pattern: 'roots', position: 'open' },
  ]);
  assert.deepEqual(db.preferences.lesson.plan.steps.map(step => step.content.practice.rhythm), ['quarters', 'quarters', 'quarters']);
  // «Начать» открывает первый шаг занятия на базовом темпе, без выбора параметров.
  await home(page).locator('[data-key="hero-play"]').click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  assert.equal(await playScene(page).locator('[data-title]').innerText(), PROGRAM_DAY_ONE[0]);
  assert.equal(await playScene(page).locator('[data-bpm]').inputValue(), '60');
  await playScene(page).locator('[data-back]').click();
  // «Уже умею: выбрать, с чего начать» ведёт в путь «Основ».
  await home(page).locator('[data-act="go-path"]').click();
  assert.equal(await home(page).getByRole('tab', { name: /^Основы/ }).getAttribute('aria-selected'), 'true');
  await home(page).locator('.ls-pathview').waitFor();
  return { plan: db.preferences.lesson.plan.steps.map(step => step.programStep) };
});

check('today-start-runs-the-lesson-from-first-to-last-step-without-choosing-parameters', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await home(page).locator('[data-key="hero-play"]').click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  const titles = [];
  for (let index = 0; index < PROGRAM_DAY_ONE.length; index++) {
    titles.push(await playScene(page).locator('[data-title]').innerText());
    await playOneLoopedPass(page);
    await page.keyboard.press('KeyZ');
    if (index < PROGRAM_DAY_ONE.length - 1) {
      await playScene(page).getByRole('group', { name: 'Самооценка подхода' }).getByRole('button', { name: 'Следующий шаг плана →' }).waitFor();
      await page.keyboard.press('Enter');
      await page.waitForFunction(title => document.querySelector('[data-lesson-screen="play"] [data-title]')?.textContent === title, PROGRAM_DAY_ONE[index + 1]);
    }
  }
  assert.deepEqual(titles, PROGRAM_DAY_ONE);
  const db = await waitDb(page, db => db.preferences.lesson.plan.steps.slice(0, 2).every(step => step.status === 'done') && db.history.length >= 3, 'три прохода записаны');
  assert.equal(db.preferences.lesson.plan.steps[0].status, 'done');
  assert.ok(db.history.every(entry => entry.result?.assessment === 'clean'));
  return { steps: db.preferences.lesson.plan.steps.map(step => step.status) };
});

check('today-next-day-offers-next-variant-and-keeps-manual-steps-and-long-break-recalls', 'ui', async ({ page, origin }) => {
  await page.clock.setFixedTime(new Date('2026-11-16T10:00:00'));
  await openApp(page, origin);
  // Ручной шаг из библиотеки переносится на следующий день, шаги программы пересобираются.
  await lessonTab(page, 'Библиотека');
  const card = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: 'Смена позиции по струне', exact: true }) });
  await card.locator('[data-act="toggle-plan"]').click();
  await lessonTab(page, 'Сегодня');
  await home(page).locator('.ls-plan').getByRole('button', { name: 'Играть: ' + PROGRAM_DAY_ONE[0], exact: true }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  await playOneLoopedPass(page);
  await page.keyboard.press('KeyZ');
  await waitDb(page, db => db.history.length === 1, 'проход записан');
  assert.deepEqual((await readDb(page)).history[0].result.material.spec.params, { string: 'E', fret: 0, notes: 16 });
  await playScene(page).locator('[data-back]').click();
  await page.clock.setFixedTime(new Date('2026-11-17T10:00:00'));
  await page.reload(); await ready(page);
  let db = await waitDb(page, db => db.preferences.lesson.plan?.localDate === '2026-11-17', 'план нового дня');
  const first = db.preferences.lesson.plan.steps[0];
  assert.equal(first.programStep, 't1-pulse.quarters');
  assert.equal(first.content.spec.params.string, 'A', 'вариант подставлен: после «Чисто» в первом — второй');
  assert.deepEqual(db.preferences.lesson.plan.steps.map(step => step.programStep), ['t1-pulse.quarters', 'f1-ea5.naturals', 'h1-open.quarters', undefined]);
  assert.match((await home(page).locator('.ls-hero').innerText()), /Продолжить/i);
  // Перерыв больше 14 дней: «Вспомнить».
  await page.clock.setFixedTime(new Date('2026-12-20T10:00:00'));
  await page.reload(); await ready(page);
  db = await waitDb(page, db => db.preferences.lesson.plan?.localDate === '2026-12-20', 'план после перерыва');
  assert.deepEqual(db.preferences.lesson.plan.steps.filter(step => step.programStep).map(step => step.id), ['r1', 'r2', 'r3']);
  assert.match(await home(page).locator('.ls-hero').innerText(), /Вспомнить/i);
  return { recall: db.preferences.lesson.plan.steps.map(step => step.id) };
});

check('library-add-to-plan-appears-in-today-and-survives-reload', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await waitDb(page, db => db.preferences?.lesson?.plan?.steps?.length === 3, 'занятие первого дня');
  await lessonTab(page, 'Библиотека');
  const title = 'Смена позиции по струне';
  const card = home(page).locator('.ls-lib-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const add = card.locator('[data-act="toggle-plan"]');
  assert.equal(await add.getAttribute('aria-pressed'), 'false');
  await add.click();
  await assertAttribute(card.locator('[data-act="toggle-plan"]'), 'aria-pressed', 'true');
  assert.equal((await card.locator('[data-act="toggle-plan"]').innerText()).trim(), '✓ в плане');
  assert.match(await home(page).locator('[data-toast]').innerText(), new RegExp(`Добавлено в план «Сегодня»: ${title}`));
  assert.match(await home(page).locator('.ls-planbar').innerText(), new RegExp(`4 шага[\\s\\S]*${title}`));
  await lessonTab(page, 'Сегодня');
  assert.deepEqual(await planTitles(page), [...PROGRAM_DAY_ONE, title]);
  const db = await waitDb(page, db => db.preferences?.lesson?.plan?.steps?.length === 4, 'шаг из библиотеки в плане');
  const added = db.preferences.lesson.plan.steps.at(-1);
  assert.equal(added.content.kind, 'exercise');
  assert.equal(added.status, 'pending');
  assert.equal(added.programStep, undefined, 'шаг из библиотеки не связан с программой');
  await page.reload();
  await ready(page);
  await lessonTab(page, 'Сегодня');
  assert.deepEqual(await planTitles(page), [...PROGRAM_DAY_ONE, title], 'План после перезагрузки');
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

check('play-chords-panel-disabled-without-chords-and-remembered-with-progression', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  // Шаг 1 занятия — пульс на открытой струне: аккордов по тактам нет, управление недоступно с пояснением.
  await home(page).locator('.ls-plan').getByRole('button', { name: 'Играть: ' + PROGRAM_DAY_ONE[0], exact: true }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  await playScene(page).locator('[data-panel-toggle]').click();
  const panel = playScene(page).getByRole('group', { name: 'Звук и ритм' });
  assert.equal(await panel.locator('[data-accompaniment="hold"]').isDisabled(), true);
  assert.match(await panel.locator('[data-accompaniment-note]').innerText(), /Нет аккордов по тактам/);
  assert.equal(await panel.locator('[data-volume="chords"]').isDisabled(), true);
  await playScene(page).locator('[data-back]').click();
  // Шаг 3 — I–IV–V на открытых струнах: режим выбирается, виден в сводке, запоминается как общая настройка звука.
  await home(page).locator('.ls-plan').getByRole('button', { name: 'Играть: ' + PROGRAM_DAY_ONE[2], exact: true }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  await playScene(page).locator('[data-panel-toggle]').click();
  const chords = playScene(page).getByRole('group', { name: 'Звук и ритм' });
  assert.equal(await chords.locator('[data-accompaniment="hold"]').isDisabled(), false);
  assert.equal(await chords.locator('[data-volume="chords"]').isDisabled(), true, 'громкость недоступна при режиме «Выкл»');
  await chords.locator('[data-accompaniment="beats"]').click();
  assert.match(await playScene(page).locator('[data-sound-summary]').innerText(), /аккорды по долям/);
  assert.equal(await chords.locator('[data-volume="chords"]').isDisabled(), false);
  await chords.locator('[data-volume="chords"]').fill('80');
  await waitDb(page, db => db.preferences?.play?.accompaniment === 'beats' && db.preferences.play.accompanimentVolume === 0.8, 'аккорды запомнены');
  return { summary: await playScene(page).locator('[data-sound-summary]').innerText() };
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
  const toggle = home(page).locator('[data-act="basics-view"][data-value="knowledge"]');
  await toggle.click();
  await assertAttribute(toggle, 'aria-pressed', 'true');
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
  assert.deepEqual(entry.result.answers.slice(0, 4).map(answer => normalizeDegree(answer.target)), questions.map(item => item.expected), 'Сохранённые ступени совпадают с независимым расчётом');
  return { questions: questions.map(({ root, position, expected, outcome, phrase }) => ({ root, position, expected, outcome, phrase })), tiles, statuses, history: { id: entry.id, title: entry.result.title, answers: entry.result.answers } };
});

check('check-series-is-recorded-under-the-kind-actually-played-not-the-step-description', 'ui', async ({ page, origin }) => {
  // A9.5: серия засчитывается шагу только с его описанием; смена вида вопроса до первого ответа даёт запись другой проверки.
  await openApp(page, origin);
  await openBasicsCheck(page, '1', '1:fifth:check');
  const host = checkHost(page);
  assert.match(await host.locator('h1').innerText(), /^Проверь себя: назови ступень$/);
  await host.locator('[data-kind]').selectOption('find-degree');
  await host.locator('[data-act="finish"]').click();
  await host.locator('[data-ck-summary]').waitFor();
  const db = await waitDb(page, db => db.history.some(entry => entry.result?.kind === 'check'), 'итог проверки в истории');
  const entry = db.history.find(item => item.result?.kind === 'check');
  assert.equal(entry.result.check.kind, 'find-degree', 'в записи — сыгранный вид вопроса');
  assert.match(entry.result.exerciseKey, /^check:find-degree\./);
  return { key: entry.result.exerciseKey };
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
  assert.deepEqual(entry.result.answers.slice(0, 2).map(answer => [normalizeDegree(answer.target), answer.outcome]), [[first.target, 'corrected'], [question.target, 'revealed']]);
  assert.equal(entry.result.check.kind, 'find-degree');
  return { first: { root: first.root, target: first.target, answers: first.answers, wrong: first.wrong[0], phrase: first.phrase }, second: { target: question.target, answers: question.answers, shown }, answers: entry.result.answers };
});

/* ---------- Конструктор «Своя линия» (R-028, B5.4) ---------- */

check('library-line-builder-assembles-saves-as-own-exercise-and-plays-it', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await lessonTab(page, 'Библиотека');
  const builder = home(page).locator('.ls-builder');
  await builder.locator('[data-act="builder-toggle"]').click();
  assert.deepEqual(await builder.locator('.ls-bb-chord').allInnerTexts(), ['G · I', 'C · IV', 'D · V', 'G · I']);
  // Недопустимое не предлагается: в объёме 1 только тоники, тоника и квинта, октавы.
  assert.deepEqual(await builder.locator('[data-control="builder-pattern"]').first().locator('option').allInnerTexts(), ['тоники', 'тоника и квинта', 'октавы']);

  await builder.locator('[data-control="builder-root"]').selectOption('A');
  await builder.locator('[data-control="builder-pattern"][data-bar="1"]').selectOption('root-fifth');
  await builder.locator('[data-control="builder-pattern"][data-bar="2"]').selectOption('octaves');
  assert.deepEqual(await builder.locator('.ls-bb-chord').allInnerTexts(), ['A · I', 'D · IV', 'E · V', 'A · I']);

  // Сохранение требует название; ошибка видна и не теряет сборку.
  await builder.locator('[data-act="builder-save"]').click();
  assert.match(await builder.locator('[role="alert"]').innerText(), /Назови линию/);
  await builder.locator('[data-builder-name]').fill('Моя линия в A');
  await builder.locator('[data-builder-name]').press('Enter');
  await page.waitForFunction(() => /Сохранено как своё упражнение: Моя линия в A/.test(document.querySelector('[data-toast]')?.textContent ?? ''));
  await home(page).getByRole('button', { name: /^Свои/ }).click();
  assert.deepEqual(await home(page).locator('.ls-lib-card h3').allInnerTexts(), ['Моя линия в A']);

  // Объём 2: своя последовательность — тоника и вид аккорда такта, ещё один такт; рисунки объёма 2 включают «тоники с подходом».
  await builder.locator('[data-act="builder-volume"][data-value="2"]').click();
  assert.deepEqual(await builder.locator('.ls-bb-chord').allInnerTexts(), ['A · I', 'D · IV', 'E · V', 'A · I']);
  await builder.locator('[data-control="builder-step"][data-bar="1"]').selectOption({ label: 'F♯' });
  await builder.locator('[data-control="builder-kind"][data-bar="1"]').selectOption('minor-triad');
  await builder.locator('[data-act="builder-add"]').click();
  assert.deepEqual(await builder.locator('.ls-bb-chord').allInnerTexts(), ['A · I', 'F♯m · vi', 'E · V', 'A · I', 'A · I']);
  assert.ok((await builder.locator('[data-control="builder-pattern"][data-bar="1"]').locator('option').allInnerTexts()).includes('тоники с подходом'));
  await builder.locator('[data-control="builder-pattern"][data-bar="1"]').selectOption('roots-approach');
  // Объём 3: ритм на такт, виды m7 и maj7, «тоники с проходящими»; смена объёма начинает с I–IV–V–I в той же тональности.
  await builder.locator('[data-act="builder-volume"][data-value="3"]').click();
  assert.deepEqual(await builder.locator('.ls-bb-chord').allInnerTexts(), ['A · I', 'D · IV', 'E · V', 'A · I']);
  assert.equal(await builder.locator('[data-control="builder-rhythm"]').count(), 4);
  assert.ok((await builder.locator('[data-control="builder-kind"][data-bar="1"]').locator('option').allInnerTexts()).some(text => /maj7/.test(text)));
  await builder.locator('[data-control="builder-kind"][data-bar="1"]').selectOption('major-seventh');
  await builder.locator('[data-control="builder-rhythm"][data-bar="0"]').selectOption('quarter-rest');
  assert.ok((await builder.locator('[data-control="builder-pattern"][data-bar="2"]').locator('option').allInnerTexts()).includes('тоники с проходящими'));
  await builder.locator('[data-control="builder-pattern"][data-bar="2"]').selectOption('roots-passing');
  await builder.locator('[data-act="builder-add"]').click();
  assert.deepEqual(await builder.locator('.ls-bb-chord').allInnerTexts(), ['A · I', 'Dmaj7 · IVmaj7', 'E · V', 'A · I', 'A · I']);
  // «Сыграть» открывает экран игры с этой линией: 35 нот — такт с четвертной паузой даёт три атаки, остальные четыре по восемь.
  await home(page).locator('.ls-builder [data-act="builder-play"]').click();
  await playScene(page).locator('[data-title]').waitFor();
  assert.match(await playScene(page).innerText(), /Своя линия/);
  assert.match(await playScene(page).locator('[data-sub]').innerText(), /35 нот/);
  return { chords: ['A · I', 'Dmaj7 · IVmaj7', 'E · V', 'A · I', 'A · I'] };
});

/* ---------- Проверка по диапазону (R-028, A9) ---------- */

check('check-twelve-note-cards-answer-by-keys-0-minus-and-equals-after-digits', 'ui', async ({ page, origin }) => {
  // Карточки 10–12 в «Назови ноту» по всем нотам достижимы клавишами 0, «−» и «=».
  await openApp(page, origin);
  const copy = await exportUi(page);
  const today = await page.evaluate(() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
  const spec = { version: 'check-v2', kind: 'name-note', area: { type: 'range', strings: ['E', 'A'], fretMin: 0, fretMax: 12 }, subject: { type: 'notes', notes: 'all' }, count: 6, ear: false };
  copy.preferences.lesson.plan = { version: 'plan-v1', localDate: today, steps: [{ id: 'step-1', content: { kind: 'check', spec }, minutes: 3, status: 'current' }] };
  await restoreCopy(page, copy, 'twelve-cards.json');
  await go(page, 'lesson');
  await home(page).getByRole('tab', { name: /^Сегодня/ }).click();
  await home(page).locator('.ls-hero [data-act="play"]').click();
  const host = checkHost(page);
  await host.locator('[data-ck-title]').waitFor();
  assert.equal(await host.locator('[data-choice]').count(), 12);
  const handled = [];
  for (const [key, index] of [['Digit0', 9], ['Minus', 10], ['Equal', 11]]) {
    await page.keyboard.press(key);
    const card = host.locator(`[data-choice="${index}"]`);
    const state = await card.evaluate(node => ({ disabled: node.getAttribute('aria-disabled'), cls: node.className }));
    assert.ok(state.disabled === 'true' || /is-right|is-shown/.test(state.cls), `клавиша ${key} ответила карточкой ${index + 1}: ${JSON.stringify(state)}`);
    handled.push(index);
    if (await host.locator('[data-act="next"]').count() === 0) await host.locator('[data-act="reveal"]').click();
    await host.locator('[data-act="next"]').click();
  }
  return { handled };
});

check('check-range-chord-root-hatches-outside-cells-records-check-and-retry-keeps-question', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  // Шаг-проверка по диапазону попадает в план так же, как после восстановления копии: программа этапа 1 её добавит в P18-14.
  const copy = await exportUi(page);
  const today = await page.evaluate(() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
  const spec = { version: 'check-v2', kind: 'find-note', area: { type: 'range', strings: ['E', 'A'], fretMin: 0, fretMax: 12 }, subject: { type: 'chord-root', notes: 'natural' }, count: 6, ear: false };
  copy.preferences.lesson.plan = { version: 'plan-v1', localDate: today, steps: [{ id: 'step-1', content: { kind: 'check', spec }, minutes: 3, status: 'current' }] };
  await restoreCopy(page, copy, 'range-check.json');
  await go(page, 'lesson');
  await home(page).getByRole('tab', { name: /^Сегодня/ }).click();
  await home(page).locator('.ls-hero [data-act="play"]').click();
  const host = checkHost(page);
  await host.locator('[data-ck-title]').waitFor();
  assert.equal(await host.locator('h1').innerText(), 'Проверь себя: найди ноту');

  const ask = async () => {
    const title = (await host.locator('[data-ck-title]').innerText()).trim();
    const match = /^Найди тонику аккорда ([A-G])(m|7|)$/.exec(title);
    assert.ok(match, `Вопрос о тонике аккорда: ${title}`);
    return { title, chord: match[1] + match[2], pc: pitchClass(match[1]) };
  };
  const inside = () => host.locator('[data-cell]:not(.is-outside)').evaluateAll(list => list.map(cell => cell.dataset.cell));
  const classOf = id => { const [string, fret] = id.split(':'); return positionMidi(string, fret) % 12; };

  // Гриф показывает ровно лады 0–12; струны D и G вне диапазона вопроса — штриховка и подпись, ответ в них не принимается.
  const first = await ask();
  const scan = await answerLeakScan(page);
  assert.deepEqual(scan.problems, [], 'Признаки ответа в DOM/ARIA до ответа');
  assert.deepEqual(scan.svgTexts.filter(name => !['mb-fret', 'mb-string-name'].includes(name)), [], 'На грифе вопроса нет подписей нот');
  assert.equal(scan.cellLabels.length, 4 * 13);
  assert.equal(scan.cellLabels.filter(label => label.endsWith(' — вне диапазона вопроса')).length, 2 * 13);
  for (const label of scan.cellLabels) assert.match(label, /^Струна [EADG], лад \d+( — вне диапазона вопроса)?$/);
  assert.equal((await inside()).length, 2 * 13);
  assert.deepEqual([...new Set((await inside()).map(id => id[0]))].sort(), ['A', 'E'], 'Внутри диапазона только струны E и A');
  assert.ok(!scan.html.includes(`aria-label="Струна E, лад ${(await inside()).find(id => classOf(id) === first.pc)?.split(':')[1]} — ответ`), 'Позиция ответа не названа в документе');

  // aria-disabled не блокирует указатель: Playwright считает такую кнопку недоступной, поэтому нажатие вынужденное.
  await host.locator('[data-cell="D:5"]').click({ force: true });
  assert.match(await feedbackText(page), /вне диапазона вопроса/);
  assert.equal(await host.locator('.ck-cell.is-wrong').count(), 0, 'Клетка вне диапазона не засчитывается ошибкой');
  assert.equal((await ask()).title, first.title, 'Вопрос остался прежним');

  const wrong = (await inside()).find(id => classOf(id) !== first.pc);
  await host.locator(`[data-cell="${wrong}"]`).click();
  assert.equal(await host.locator(`[data-cell="${wrong}"]`).evaluate(cell => cell.classList.contains('is-wrong')), true);
  const right = (await inside()).find(id => classOf(id) === first.pc);
  await host.locator(`[data-cell="${right}"]`).click();
  assert.match(await feedbackText(page), /^Верно, с исправлением \(ошибок: 1\)\./);
  await host.locator('[data-act="next"]').click();

  for (let index = 1; index < 6; index++) {
    const question = await ask();
    const target = (await inside()).find(id => classOf(id) === question.pc);
    await host.locator(`[data-cell="${target}"]`).click();
    assert.match(await feedbackText(page), /^Верно, с первой попытки\./);
    await host.locator('[data-act="next"]').click();
  }
  await host.locator('[data-ck-summary]').waitFor();

  const db = await waitDb(page, db => db.history.some(entry => entry.result?.kind === 'check'), 'итог проверки по диапазону в истории');
  const entry = db.history.find(item => item.result?.kind === 'check');
  assert.equal(entry.result.exerciseKey, 'check:find-note.EA-0-12.chord-natural');
  assert.deepEqual(entry.result.check, spec);
  assert.equal(entry.result.answers.length, 6);
  assert.deepEqual(entry.result.answers[0], { target: first.chord, outcome: 'corrected', errors: 1 });
  assert.ok(entry.result.answers.slice(1).every(answer => answer.outcome === 'correct' && answer.errors === 0 && /^[A-G](m|7)?$/.test(answer.target)));

  // «Повторить трудные» показывает тот же вопрос, включая обозначение аккорда.
  await host.locator('[data-act="retry"]').click();
  await host.locator('[data-ck-title]').waitFor();
  assert.equal((await ask()).title, first.title);
  return { first: first.chord, answers: entry.result.answers };
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
  await variantSelect(page, 'startFret').focus();
  await variantSelect(page, 'startFret').selectOption({ label: '7' });
  assert.equal(await selectedText(variantSelect(page, 'startFret')), '7');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.variant), 'startFret', 'после смены варианта фокус остался на переключателе');
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

check('play-after-midnight-rating-does-not-close-a-step-of-the-new-days-plan', 'ui', async ({ page, origin }) => {
  // Шаг открыт в одном дне, оценка — после полуночи: у нового плана те же ID шагов, отметка «выполнено» ему не принадлежит.
  await page.addInitScript(() => {
    const Real = Date; let shift = 0;
    window.__dayShift = ms => { shift = ms; };
    globalThis.Date = class extends Real {
      constructor(...args) { if (args.length === 0) super(Real.now() + shift); else super(...args); }
      static now() { return Real.now() + shift; }
    };
  });
  await openApp(page, origin);
  await openPlanStep(page, FIRST_RUN_PLAN[2]);
  await page.evaluate(() => window.__dayShift(36 * 3600 * 1000));
  await playScene(page).locator('[data-flag="loop"]').click();
  await playScene(page).locator('[data-bpm]').fill('200'); await playScene(page).locator('[data-bpm]').press('Enter');
  await focusPlayTitle(page); await page.keyboard.press('Space');
  await playScene(page).getByRole('group', { name: 'Самооценка подхода' }).waitFor({ timeout: 20000 });
  await page.keyboard.press('KeyZ');
  const db = await waitDb(page, db => db.history.some(entry => entry.result?.assessment === 'clean'), '«Чисто» в истории');
  assert.ok(!db.preferences.lesson.plan.steps.some(step => step.status === 'done'), 'оценка после полуночи не закрыла шаг плана нового дня: ' + JSON.stringify(db.preferences.lesson.plan.steps.map(step => step.status)));
  return { statuses: db.preferences.lesson.plan.steps.map(step => step.status) };
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

/* ---------- «Основы»: путь программы (P18-05) ---------- */

const pathStep = (page, id) => home(page).locator(`.ls-pstep[data-step-id="${id}"]`);
const pathStatus = (page, id) => pathStep(page, id).locator('.ls-chip-status').innerText();

check('basics-path-opens-step-on-base-tempo-with-rule-and-rated-variant-shows-in-status', 'ui', async ({ page, origin }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, origin);
  await lessonTab(page, 'Основы');
  assert.equal(await home(page).locator('[data-act="basics-view"][data-value="path"]').getAttribute('aria-pressed'), 'true', 'по умолчанию — путь');
  assert.deepEqual(await home(page).locator('.ls-pline h3').allInnerTexts(), ['Техника', 'Гриф', 'Аккорды и линии']);
  assert.match(await home(page).locator('.ls-path-head .ls-sub').first().innerText(), /пройдено 0 · пропущено 0 · освоено 0 из 29/);
  assert.equal(await pathStatus(page, 't1-left.quarters'), 'не начат');
  // Текущие шаги трёх линий отмечены.
  assert.deepEqual(await home(page).locator('.ls-pstep.is-current').evaluateAll(items => items.map(item => item.dataset.stepId)), ['t1-pulse.quarters', 'f1-ea5.naturals', 'h1-open.quarters']);
  // Шаг открывается на базовом темпе 60, с «как играть» шага и правилом зачёта.
  await pathStep(page, 't1-left.quarters').getByRole('button', { name: /^Играть/ }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  assert.equal(await playScene(page).locator('[data-bpm]').inputValue(), '60');
  assert.match(await playScene(page).locator('[data-sub]').innerText(), /четверти/);
  const rule = await playScene(page).locator('[data-rule]').innerText();
  assert.match(rule, /Зачёт шага: четверти; «Чисто» целиком в 2 вариантах — сыграно 0 из 2/);
  assert.match(rule, /не ниже 60 BPM/);
  await assertTaskLinesFit(page, 'шаг пути с правилом зачёта');
  await playOneLoopedPass(page);
  await page.keyboard.press('KeyZ');
  const db = await waitDb(page, db => db.history.some(entry => entry.result?.assessment === 'clean'), '«Чисто» в истории');
  const entry = db.history.find(item => item.result?.assessment === 'clean');
  assert.match(entry.result.material.key, /^builtin:chromatic-position\.5\.1234\.up$/);
  assert.equal(entry.result.material.practice.rhythm, 'quarters');
  await page.waitForFunction(() => /сыграно 1 из 2/.test(document.querySelector('[data-lesson-screen="play"] [data-rule]')?.textContent ?? ''));
  await playScene(page).locator('[data-back]').click();
  await lessonTab(page, 'Основы');
  assert.equal(await pathStatus(page, 't1-left.quarters'), 'в работе');
  assert.deepEqual(await pathStep(page, 't1-left.quarters').locator('.ls-vchip').evaluateAll(chips => chips.map(chip => [chip.classList.contains('is-clean'), chip.classList.contains('is-on')])), [[true, false], [false, true], [false, false], [false, false], [false, false]]);
  assert.equal(await pathStatus(page, 't1-left.eighths'), 'не начат', 'другой ритм — другой шаг');
  return { key: entry.result.material.key };
});

check('basics-path-stage-3-tab-lists-blocks-and-opens-a-step-with-passing-notes', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await lessonTab(page, 'Основы');
  await home(page).locator('[data-act="path-stage"][data-value="3"]').click();
  assert.equal(await home(page).locator('.ls-path-head h2').innerText(), 'Этап 3 · Тоны аккорда и свои линии');
  assert.match(await home(page).locator('.ls-path-head .ls-sub').first().innerText(), /пройдено 0 · пропущено 0 · освоено 0 из 32/);
  assert.deepEqual(await home(page).locator('.ls-pblock').evaluateAll(blocks => blocks.map(block => block.dataset.block)),
    ['t3-sixteenths', 't3-spider', 'f3-major', 'f3-minor', 'f3-penta', 'h3-minor', 'h3-diatonic', 'h3-passing', 'h3-blues', 'h3-line']);
  // Шаг этапа 3 открывается на базовом темпе 60; первый вариант — нижняя позиция с проходящими нотами.
  await pathStep(page, 'h3-passing.i-iv-v').getByRole('button', { name: /^Играть/ }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  assert.equal(await playScene(page).locator('[data-bpm]').inputValue(), '60');
  assert.match(await playScene(page).innerText(), /проходящими/);
  assert.match(await playScene(page).locator('[data-rule]').innerText(), /Зачёт шага/);
  return { stage: 3 };
});

check('basics-path-already-know-marks-block-persists-and-is-removable', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await lessonTab(page, 'Основы');
  const skip = home(page).locator('[data-act="path-skip"][data-block="f1-ea5"]');
  await skip.click();
  await assertAttribute(home(page).locator('[data-act="path-skip"][data-block="f1-ea5"]'), 'aria-pressed', 'true');
  assert.equal(await pathStatus(page, 'f1-ea5.naturals'), 'пропущен');
  assert.match(await home(page).locator('.ls-pblock[data-block="f1-ea5"] header .ls-sub').innerText(), /пропущено 2/);
  let db = await waitDb(page, db => db.preferences.lesson.skipped?.includes('f1-ea5'), 'отметка сохранена');
  assert.deepEqual(db.preferences.lesson.skipped, ['f1-ea5']);
  assert.ok(!db.preferences.lesson.plan.steps.some(step => step.programStep?.startsWith('f1-ea5.')), 'план дня собран заново без пропущенного блока: ' + JSON.stringify(db.preferences.lesson.plan.steps.map(step => step.programStep)));
  await page.reload(); await ready(page);
  await lessonTab(page, 'Основы');
  assert.equal(await pathStatus(page, 'f1-ea5.name-note'), 'пропущен', 'отметка пережила перезагрузку');
  assert.equal(await home(page).locator('.ls-pstep.is-current').evaluateAll(items => items.map(item => item.dataset.stepId)).then(ids => ids.includes('f1-ea5.naturals')), false, 'линия «Гриф» ушла дальше блока');
  await home(page).locator('[data-act="path-skip"][data-block="f1-ea5"]').click();
  db = await waitDb(page, db => Array.isArray(db.preferences.lesson.skipped) && db.preferences.lesson.skipped.length === 0, 'отметка снята');
  assert.equal(await pathStatus(page, 'f1-ea5.naturals'), 'не начат');
  assert.ok((await readDb(page)).preferences.lesson.plan.steps.some(step => step.programStep === 'f1-ea5.naturals'), 'после снятия отметки блок вернулся в план дня');
  // «Знания» остаются: прежние уровни как справочная линия карточек.
  await home(page).locator('[data-act="basics-view"][data-value="knowledge"]').click();
  await home(page).locator('.ls-basics-grid').waitFor();
  assert.equal((await readDb(page)).preferences.lesson.basicsView, 'knowledge');
  return { skipped: db.preferences.lesson.skipped };
});

check('basics-path-two-variants-pass-the-step-and-two-days-master-it', 'ui', async ({ page, origin }) => {
  // «Пройден» — «Чисто» в двух вариантах; «освоен» — те же два варианта не ниже 60 BPM в два разных дня (часы страницы фиксируются).
  await page.clock.setFixedTime(new Date('2026-11-16T10:00:00'));
  await openApp(page, origin);
  const playVariant = async index => {
    await lessonTab(page, 'Основы');
    await pathStep(page, 't1-left.quarters').locator('.ls-vchip').nth(index).click();
    await pathStep(page, 't1-left.quarters').getByRole('button', { name: /^Играть/ }).click();
    await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
    await playOneLoopedPass(page);
    await page.keyboard.press('KeyZ');
    await waitDb(page, db => db.history.length >= playVariant.count + 1, 'проход записан');
    playVariant.count += 1;
    await playScene(page).locator('[data-back]').click();
  };
  playVariant.count = 0;
  await playVariant(0);
  await lessonTab(page, 'Основы');
  assert.equal(await pathStatus(page, 't1-left.quarters'), 'в работе');
  await playVariant(1);
  await lessonTab(page, 'Основы');
  assert.equal(await pathStatus(page, 't1-left.quarters'), 'пройден');
  assert.match(await home(page).locator('.ls-pblock[data-block="t1-left"] header .ls-sub').innerText(), /пройдено 1 · пропущено 0 · освоено 0 из 3/);
  await page.clock.setFixedTime(new Date('2026-11-17T10:00:00'));
  await page.reload(); await ready(page);
  await playVariant(0);
  await playVariant(1);
  await lessonTab(page, 'Основы');
  assert.match(await pathStatus(page, 't1-left.quarters'), /^освоен · \d+$/);
  assert.match(await home(page).locator('.ls-pblock[data-block="t1-left"] header .ls-sub').innerText(), /пройдено 1 · пропущено 0 · освоено 1 из 3/);
  return { status: await pathStatus(page, 't1-left.quarters') };
});

check('progress-shows-program-status-after-a-lesson-pass-and-reload', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await home(page).locator('[data-key="hero-play"]').click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
  await playOneLoopedPass(page);
  await page.keyboard.press('KeyZ');
  await waitDb(page, db => db.history.length === 1, 'проход записан');
  await page.reload(); await ready(page);
  await page.locator('.site-header [data-app-module="progress"]').click();
  const progress = page.locator('[data-page-frame="progress"]');
  const row = progress.locator('.pg-pstep[data-step-id="t1-pulse.quarters"]');
  await row.waitFor();
  assert.match(await progress.locator('.pg-stage-head').first().innerText(), /Этап 1 · Пульс и опора\s+пройдено 0 · пропущено 0 · освоено 0 из 29/);
  assert.equal(await row.locator('.pg-pstatus').innerText(), 'в работе');
  assert.match(await row.innerText(), /сыграно 1 из 4 · лучший чистый темп 200/);
  assert.equal(await progress.locator('.pg-pstep[data-step-id="h1-roots.eighths"] .pg-pstatus').innerText(), 'не начат');
  // Три этапа программы, в каждом по три линии.
  assert.deepEqual(await progress.locator('.pg-pline > summary b').allInnerTexts(), Array(3).fill(['Техника', 'Гриф', 'Аккорды и линии']).flat());
  return { status: await row.locator('.pg-pstatus').innerText() };
});

check('progress-program-line-collapsed-by-user-stays-collapsed-after-leaving-and-returning', 'ui', async ({ page, origin }) => {
  await openApp(page, origin);
  await page.locator('.site-header [data-app-module="progress"]').click();
  const progress = page.locator('[data-page-frame="progress"]');
  const line = progress.locator('.pg-pline').first();
  await line.waitFor();
  await line.locator('summary').click();
  assert.equal(await line.evaluate(details => details.open), false, 'линия свернулась');
  // Данные меняются в «Занятии» (отметка «Уже умею» у блока) — при возврате «Прогресс» перерисовывается заново.
  await page.locator('.site-header [data-app-module="lesson"]').click();
  await lessonTab(page, 'Основы');
  await home(page).locator('[data-act="path-skip"][data-block="f1-ea5"]').click();
  await waitDb(page, db => db.preferences.lesson.skipped?.includes('f1-ea5'), 'отметка сохранена');
  await page.locator('.site-header [data-app-module="progress"]').click();
  await progress.locator('.pg-pline').first().waitFor();
  assert.match(await progress.locator('.pg-pstep[data-step-id="f1-ea5.naturals"] .pg-pstatus').innerText(), /пропущен/, 'экран перерисован свежими данными');
  assert.equal(await progress.locator('.pg-pline').first().evaluate(details => details.open), false, 'свёрнутая линия не раскрылась при обновлении');
  assert.equal(await progress.locator('.pg-pline').nth(1).evaluate(details => details.open), true, 'остальные линии остались открытыми');
  return { collapsedKept: true };
});

markFullOnly(checks, ['basics-path-two-variants-pass-the-step-and-two-days-master-it', 'today-next-day-offers-next-variant-and-keeps-manual-steps-and-long-break-recalls',
  'today-start-runs-the-lesson-from-first-to-last-step-without-choosing-parameters'], FULL_ONLY.smoke);
markFullOnly(checks, ['play-variant-unrated-approach-is-rated-first-or-dropped-explicitly-and-own-exercise-has-no-selectors'], FULL_ONLY.smoke);
// Оценка прохода и сохранение в «Прогресс» после перезагрузки в быстром наборе проходит сценарий progress-shows-program-status-after-a-lesson-pass-and-reload;
// счёт, пауза и вид экрана игры — сценарии audio-browser `ui-play-*`.
markFullOnly(checks, ['play-self-assessment-clean-is-saved-and-visible-in-progress-after-reload', 'play-count-in-note-progress-space-pause-resume-view-and-escape'], FULL_ONLY.smoke);
// Экономия времени быстрого набора перед заходом C (P18): те же потоки оценки и перехода покрывают соседние сценарии.
markFullOnly(checks, ['play-keys-work-after-mouse-clicks-rating-view-panel-and-timer-counts-rated-approach', 'play-slow-rating-opens-next-time-4-bpm-lower-even-after-sound-change',
  'play-enter-after-key-rating-with-focus-on-play-button-opens-next-step', 'plan-step-timer-and-next-step-after-rating'], FULL_ONLY.smoke);
markFullOnly(checks, ['play-task-lines-fit-1280x720-for-every-library-template'], FULL_ONLY.smoke);
markFullOnly(checks, ['native-real-hidden-tab-pauses-play-and-resumes-only-by-action'], FULL_ONLY.hiddenTab);
markFullOnly(checks, ['live-play-sounds-reached-notes-on-audio-clock-and-pause-cancels-scheduled-voices'], FULL_ONLY.liveAudio);
markFullOnly(checks, ['play-right-hand-echo-and-shuffle-groove-on-string-crossing-and-memory-pulse', 'play-approach-continues-until-rated-and-partial-first-pass-is-rated-not-whole',
  'play-rate-on-pause-then-resume-keeps-counting-the-same-approach', 'play-rated-on-pause-then-resumed-does-not-count-the-cut-pass-as-whole'], FULL_ONLY.smoke);
markFullOnly(checks, ['second-window-waits-for-writer-and-takes-over-after-first-closes'], 'несколько окон одного профиля: передача права записи после закрытия первого окна');

const selection = browserCases(checks);
await runP13BrowserChecks(selection.checks, { reportFile: selection.filtered ? 'p13-case-edge.json' : 'p13-edge.json' });
