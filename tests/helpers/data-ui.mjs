// Общие действия раннеров данных (storage, release) в оболочке P13: меню, «Настройки → Данные» (копия, восстановление),
// «Прогресс → Не сохранено», «Проверь себя» по форме атласа, «Ритм» как источник часов ручной практики.
// Тестового API продукта нет: только DOM, клавиатура, скачивание/выбор файла и readonly-чтение нативной IndexedDB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function ready(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert, null, { timeout: 15000 });
}
export const currentSection = page => page.locator('.site-header [aria-current="page"]').getAttribute('data-app-module');
/** Переход в раздел через меню оболочки. */
export async function go(page, section) {
  await page.locator(`.site-header [data-app-module="${section}"]`).click();
  await page.waitForFunction(id => document.querySelector(`.site-header [data-app-module="${id}"]`)?.getAttribute('aria-current') === 'page', section);
}
async function back(page, section) { if (section && section !== await currentSection(page)) await go(page, section); }

/* ---------- «Настройки → Данные» ---------- */

export const settingsPage = page => page.locator('[data-page-frame="settings"]');
export const settingsDialog = page => settingsPage(page).locator('dialog[data-dialog]');
const dialogClosed = page => page.waitForFunction(() => !document.querySelector('[data-page-frame="settings"] dialog[data-dialog]')?.open);
export async function openSettingsPane(page, pane) {
  if (await currentSection(page) !== 'settings') await go(page, 'settings');
  const tab = settingsPage(page).locator(`[data-section="${pane}"]`);
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  await settingsPage(page).locator(`[data-pane="${pane}"]`).waitFor();
  return settingsPage(page);
}
export const openData = page => openSettingsPane(page, 'data');
/** Текст последнего уведомления «Настроек» (role=status). */
export const settingsToast = page => settingsPage(page).locator('[data-toast]').innerText();

/**
 * «Скачать копию (JSON)» через диалог «Настроек»: экспорт дожидается очереди записи. Возвращает разобранную копию,
 * её байты и уведомление; затем возвращает в прежний раздел. Переход в «Настройки» сохраняет `activeModule: settings`.
 */
export async function exportDownload(page, { stay = false } = {}) {
  const from = await currentSection(page);
  const settings = await openData(page);
  await settings.locator('[data-dialog-open="download"]').click();
  const download = page.waitForEvent('download');
  await settingsDialog(page).locator('[data-dlg="export"]').click();
  const file = await download;
  assert.match(file.suggestedFilename(), /^bass-study-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const bytes = await readFile(await file.path());
  await dialogClosed(page);
  const notice = await settingsToast(page);
  if (!stay) await back(page, from);
  return { copy: JSON.parse(bytes.toString('utf8')), bytes, notice };
}
export async function exportUi(page, options) { return (await exportDownload(page, options)).copy; }

/** Выбор файла копии в диалоге восстановления; возвращает диалог на шаге предпросмотра или отказа. Ничего не меняет. */
export async function previewCopy(page, snapshot, name = 'study-copy.json') {
  const from = await currentSection(page);
  const settings = await openData(page);
  const dialog = settingsDialog(page);
  if (!await dialog.evaluate(element => element.open)) await settings.locator('[data-dialog-open="restore"]').click();
  else if (await dialog.locator('[data-dlg="back"]').count()) await dialog.locator('[data-dlg="back"]').click();
  const chooser = page.waitForEvent('filechooser');
  await dialog.locator('[data-dlg="choose"]').click();
  const json = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) });
  await dialog.locator('[data-dlg-confirm], [data-dlg="back"]').first().waitFor();
  return { dialog, from, rejected: await dialog.locator('[data-dlg-confirm]').count() === 0 };
}
export async function cancelCopy(page, { dialog, from }) {
  await dialog.locator('[data-dlg="close"]').click();
  await dialogClosed(page);
  await back(page, from);
}
/** Подтверждение замены: без флажка кнопка недоступна. Возвращает шаг после замены: `done` или `failed` с текстом. */
export async function replaceCopy(page, { dialog }) {
  const replace = dialog.locator('[data-dlg="replace"]');
  assert.equal(await replace.isDisabled(), true, 'Замена недоступна без подтверждения');
  await dialog.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
  await replace.click();
  // Восстановление применяет раздел из копии; скрытые «Настройки» закрывают диалог сами.
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-page-frame="settings"] dialog[data-dialog]');
    return !element?.open || /Данные восстановлены|Замена не прошла/.test(element.querySelector('h2')?.textContent ?? '');
  }, null, { timeout: 15000 });
  if (!await dialog.evaluate(element => element.open)) return { step: 'done', closedBySectionChange: true };
  const heading = await dialog.locator('h2').innerText();
  if (heading === 'Замена не прошла') return { step: 'failed', text: await dialog.locator('[role="alert"]').innerText() };
  await dialog.locator('[data-dlg="close"]').click();
  await dialogClosed(page);
  return { step: 'done', closedBySectionChange: false };
}
export async function restoreCopy(page, snapshot, name) {
  const preview = await previewCopy(page, snapshot, name);
  assert.equal(preview.rejected, false, 'Копия должна пройти предпросмотр');
  const result = await replaceCopy(page, preview);
  assert.equal(result.step, 'done', result.text);
  await ready(page);
  return result;
}

/* ---------- Нативная IndexedDB (readonly) ---------- */

/** Весь подтверждённый снимок из нативной базы readonly-транзакцией, в форме резервной копии. */
export async function rawSnapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Readonly reader encountered a missing database')); };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = db.transaction([...db.objectStoreNames], 'readonly');
      const done = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
      const get = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [preferences, activeRhythmProjectId, profile, exercises, history, practiceDrafts, rhythmProjects] = await Promise.all([
        get(transaction.objectStore('preferences').get('current')), get(transaction.objectStore('preferences').get('rhythm-selection')),
        get(transaction.objectStore('profile').get('current')), get(transaction.objectStore('exercises').getAll()), get(transaction.objectStore('history').getAll()),
        get(transaction.objectStore('practiceDrafts').getAll()), get(transaction.objectStore('rhythmProjects').getAll()),
      ]);
      await done;
      return { format: 'bass-study-backup', schemaVersion: db.version, preferences, profile, practiceDrafts, exercises, history, rhythmProjects, activeRhythmProjectId: activeRhythmProjectId ?? null };
    } finally { db.close(); }
  });
}
/** Опрос readonly-чтением до выполнения условия: подтверждённая запись, а не состояние экрана. */
export async function waitRaw(page, predicate, what, timeout = 10000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const snapshot = await rawSnapshot(page);
    if (predicate(snapshot)) return snapshot;
    if (Date.now() > deadline) throw new Error(`IndexedDB: не дождались «${what}»: ${JSON.stringify(snapshot).slice(0, 1500)}`);
    await delay(100);
  }
}
/** Копия без раздела меню: раздел сохраняется при каждом переходе, в том числе к «Настройкам» ради скачивания. */
export const withoutSection = copy => ({ ...copy, preferences: { ...copy.preferences, activeModule: null } });

/* ---------- «Ритм»: часы ручной практики ---------- */

export const rhythmRoot = page => page.getByTestId('rhythm-view');
export const rhythmState = page => page.evaluate(() => document.querySelector('.rhythm-view')?.dataset.rhythmState);
export async function rhythmWait(page, state) {
  await page.waitForFunction(value => document.querySelector('.rhythm-view')?.dataset.rhythmState === value, state);
}
/** Метроном «Ритма» звучит заданное время по часам страницы; черновик ручной практики создаёт приложение. */
export async function playRhythm(page, milliseconds) {
  if (await currentSection(page) !== 'harmony') await go(page, 'harmony');
  await rhythmRoot(page).locator('[data-rhythm-action="start"]').click();
  await rhythmWait(page, 'running');
  await delay(milliseconds);
  await rhythmRoot(page).locator('[data-rhythm-action="stop"]').click();
  await rhythmWait(page, 'stopped');
}
/** Темп метронома полем «Ритма» (другой темп — другой материал черновика). */
export async function rhythmBpm(page, bpm) {
  if (await currentSection(page) !== 'harmony') await go(page, 'harmony');
  const field = rhythmRoot(page).locator('[data-rhythm-setting="bpm"]:visible');
  await field.fill(String(bpm)); await field.press('Tab');
}

/* ---------- «Прогресс» ---------- */

export const progressPage = page => page.locator('[data-page-frame="progress"]');
export async function openDrafts(page) {
  if (await currentSection(page) !== 'progress') await go(page, 'progress');
  const box = progressPage(page).locator('[data-drafts]');
  await box.waitFor();
  return box;
}
export const draftCard = (page, id) => progressPage(page).locator(`[data-draft="${id}"]`);

/* ---------- «Проверь себя» по форме атласа ---------- */

export const checkHost = page => page.locator('[data-lesson-screen="check"]');
/** «Гриф → Проверь себя по этой форме» и выбор вида вопроса. */
export async function openFormCheck(page, kind) {
  await go(page, 'foundation');
  await page.locator('#atlas-check').click();
  await page.locator('[data-lesson-screen="check"]:not([hidden]) [data-ck-title]').waitFor();
  if (kind) {
    await checkHost(page).locator('[data-kind]').selectOption(kind);
    await page.waitForFunction(value => document.querySelector('[data-lesson-screen="check"] [data-kind]')?.value === value, kind);
  }
  return checkHost(page);
}
const OPEN_PITCH = { E: 4, A: 9, D: 2, G: 7 };
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const pitchClassOf = label => {
  const match = /^([A-G])([♯♭#b]*)/.exec(label.trim());
  assert.ok(match, `Не нота: ${label}`);
  return (NATURAL[match[1]] + [...match[2]].reduce((sum, mark) => sum + (mark === '♯' || mark === '#' ? 1 : -1), 0) + 12) % 12;
};
/**
 * Вопрос «Назови ноту»: отмеченная позиция из текста вопроса, правильный ответ — независимый расчёт по строю E–A–D–G,
 * индекс кнопки — по её видимой подписи.
 */
export async function nameNoteQuestion(page) {
  const host = checkHost(page);
  const sub = await host.locator('.ck-ask .ck-sub').innerText();
  const match = /Отмеченная позиция — ([EADG])\/(\d+)\./.exec(sub);
  assert.ok(match, `Вопрос «Назови ноту» не распознан: ${sub}`);
  const pitch = (OPEN_PITCH[match[1]] + Number(match[2])) % 12;
  const labels = await host.locator('[data-choice] strong').allInnerTexts();
  const choices = await host.locator('[data-choice]').evaluateAll(nodes => nodes.map(node => node.dataset.choice));
  const index = labels.findIndex(label => pitchClassOf(label) === pitch);
  assert.ok(index >= 0, `Нет кнопки для высоты ${pitch}: ${labels.join(' ')}`);
  const wrong = labels.findIndex(label => pitchClassOf(label) !== pitch);
  return { positionId: `${match[1]}:${match[2]}`, pitch, choice: choices[index], wrong: choices[wrong], label: labels[index] };
}
export const answerChoice = (page, choice) => checkHost(page).locator(`[data-choice="${choice}"]`).click();
export const checkProgress = page => checkHost(page).locator('.ck-progress strong').innerText();
/** Отвечает на текущий вопрос «Назови ноту» верно и переходит дальше; на последнем — ждёт итог. */
export async function answerNameNoteCorrectly(page) {
  const question = await nameNoteQuestion(page);
  await answerChoice(page, question.choice);
  const host = checkHost(page);
  assert.match(await host.locator('[data-ck-feedback]').innerText(), /^Верно/);
  const next = host.locator('[data-act="next"]');
  if (await next.count()) await next.click();
  return question;
}
