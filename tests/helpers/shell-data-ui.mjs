// Действия оболочки P13 через видимый интерфейс: меню разделов, «Настройки → Данные» (копия и восстановление)
// и «Прогресс → Не сохранено» (черновики ручной практики). Тестового API продукта нет: только DOM, скачивание
// и настоящий выбор файла.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Переход в раздел через меню оболочки P13 (`.site-header`). */
export async function go(page, section) {
  const button = page.locator(`.site-header [data-app-module="${section}"]`);
  await button.click();
  await page.waitForFunction(id => document.querySelector(`.site-header [data-app-module="${id}"]`)?.getAttribute('aria-current') === 'page', section);
}
export const currentSection = page => page.locator('.site-header [aria-current="page"]').getAttribute('data-app-module');
const settingsPage = page => page.locator('[data-page-frame="settings"]');
const settingsDialog = page => settingsPage(page).locator('dialog[data-dialog]');
/** «Настройки → Данные»: раздел настроек с копией и восстановлением. */
export async function openData(page) {
  if (await currentSection(page) !== 'settings') await go(page, 'settings');
  const tab = settingsPage(page).locator('[data-section="data"]');
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  await settingsPage(page).locator('[data-pane="data"]').waitFor();
  return settingsPage(page);
}
/** Возврат в прежний раздел после действия в «Настройках». */
async function back(page, section) {
  if (section && section !== await currentSection(page)) await go(page, section);
}
/**
 * Настоящая резервная копия через «Настройки → Данные → Скачать копию»: экспорт дожидается очереди записи.
 * После скачивания возвращает в раздел, из которого пришли.
 */
export async function exported(page) {
  const from = await currentSection(page);
  const settings = await openData(page);
  await settings.locator('[data-dialog-open="download"]').click();
  const dialog = settingsDialog(page);
  const download = page.waitForEvent('download');
  await dialog.locator('[data-dlg="export"]').click();
  const copy = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  await page.waitForFunction(() => !document.querySelector('[data-page-frame="settings"] dialog[data-dialog]')?.open);
  await back(page, from);
  return copy;
}
/**
 * Предпросмотр копии в «Настройках → Данные → Восстановить из копии…». Ничего не меняет.
 * Возвращает диалог на шаге предпросмотра (или отказа) и раздел, из которого пришли.
 */
export async function previewCopy(page, snapshot, name = 'study-copy.json') {
  const from = await currentSection(page);
  const settings = await openData(page);
  await settings.locator('[data-dialog-open="restore"]').click();
  const dialog = settingsDialog(page);
  const chooser = page.waitForEvent('filechooser');
  await dialog.locator('[data-dlg="choose"]').click();
  const json = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) });
  await dialog.locator('[data-dlg-confirm], [data-dlg="back"]').first().waitFor();
  return { dialog, from };
}
/** Закрывает диалог копии без замены и возвращает в прежний раздел. */
export async function cancelCopy(page, { dialog, from }) {
  await dialog.locator('[data-dlg="close"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-page-frame="settings"] dialog[data-dialog]')?.open);
  await back(page, from);
}
/** Подтверждённая замена данных из предпросмотра; ждёт шаг «Данные восстановлены». */
export async function confirmCopy(page, { dialog, from }, { returnBack = true } = {}) {
  const replace = dialog.locator('[data-dlg="replace"]');
  assert.equal(await replace.isDisabled(), true, 'Замена недоступна без подтверждения');
  await dialog.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
  await replace.click();
  // Успех: шаг «Данные восстановлены» либо, если копия открыла другой раздел, закрытый вместе с «Настройками» диалог.
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[data-page-frame="settings"] dialog[data-dialog]');
    return !dialog?.open || dialog.querySelector('h2')?.textContent === 'Данные восстановлены';
  }, undefined, { timeout: 15000 });
  if (await dialog.evaluate(node => node.open)) await dialog.locator('[data-dlg="close"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-page-frame="settings"] dialog[data-dialog]')?.open);
  assert.equal(await page.locator('main').getAttribute('aria-busy'), 'false', 'Восстановление завершилось без перезагрузки');
  if (returnBack) await back(page, from);
}
export async function restoreCopy(page, snapshot, name) {
  await confirmCopy(page, await previewCopy(page, snapshot, name));
}
/** «Прогресс → Не сохранено»: карточки черновиков ручной практики. */
export async function openDrafts(page) {
  if (await currentSection(page) !== 'progress') await go(page, 'progress');
  const box = page.locator('[data-page-frame="progress"] [data-drafts]');
  await box.waitFor();
  return box;
}
