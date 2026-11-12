import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Ждёт подтверждённую запись настроек readonly-чтением нативной IndexedDB (опрос из Node, без API продукта). */
async function waitPreferences(page, predicate, what) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const preferences = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const read = db.transaction('preferences', 'readonly').objectStore('preferences').get('current');
        read.onsuccess = () => { db.close(); resolve(read.result); };
        read.onerror = () => { db.close(); reject(read.error); };
      };
    }));
    if (predicate(preferences)) return;
    assert.ok(Date.now() < deadline, `IndexedDB: не дождались «${what}»`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/**
 * Неполная оболочка P13 (`tests/fixtures/application.html?omit=<раздел>`): данные раздела, которого в этой сборке нет,
 * сохраняются целиком, а показывается запасной раздел «Занятие». Копия восстанавливается через «Настройки → Данные»;
 * сравнение идёт readonly-чтением нативной IndexedDB, потому что переход к скачиванию сам сохранил бы раздел меню.
 */
export function p12CompositionChecks({ confirmImport, rawSnapshot, ready }) {
  const cases = [
    { omitted: 'progress', storedSection: 'progress' },
    { omitted: 'tracks', storedSection: 'tracks' },
  ];
  return cases.map(({ omitted, storedSection }) => ({
    name: `composition-without-${omitted}-retains-unavailable-schema11-data`,
    scope: 'composition',
    composition: omitted,
    async run({ page }) {
      await ready(page);
      assert.equal(await page.locator(`[data-app-module="${omitted}"]`).count(), 0);
      assert.equal(await page.locator(`[data-page-frame="${omitted}"]`).count(), 0);
      const incoming = JSON.parse(await readFile(new URL('../fixtures/backup.json', import.meta.url), 'utf8'));
      incoming.preferences.activeModule = storedSection;
      incoming.preferences.input.deviceId = 'fixture-input-device';
      incoming.preferences.reference = { mastered: ['semitone'] };
      incoming.preferences.lesson.tab = 'today';
      // План прошлого дня при открытии заменяется планом сегодняшнего; здесь проверяется сохранность, а не смена дня.
      incoming.preferences.lesson.plan.localDate = await page.evaluate(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; });
      await confirmImport(page, incoming);

      const current = page.locator('.module-navigation [aria-current="page"]');
      assert.equal(await current.getAttribute('data-app-module'), 'lesson', 'An unavailable stored section shows the fallback');
      assert.deepEqual(await rawSnapshot(page), incoming, 'Restore keeps the unavailable section and its data');

      const library = page.locator('[data-lesson-screen="home"]').getByRole('tab', { name: /^Библиотека/ });
      await library.click();
      const edited = structuredClone(incoming);
      edited.preferences.lesson.tab = 'library';
      await waitPreferences(page, value => value?.lesson.tab === 'library', 'вкладка «Библиотека»');
      assert.deepEqual(await rawSnapshot(page), edited, 'Changing the visible feature must retain the complete restored copy');
      await page.reload(); await ready(page);
      assert.equal(await current.getAttribute('data-app-module'), 'lesson');
      assert.equal(await library.getAttribute('aria-selected'), 'true');
      assert.deepEqual(await rawSnapshot(page), edited, 'A native reload must keep unavailable data and the unrelated edit');
      await current.click();
      edited.preferences.activeModule = 'lesson';
      await waitPreferences(page, value => value?.activeModule === 'lesson', 'выбран запасной раздел');
      assert.deepEqual(await rawSnapshot(page), edited, 'Explicitly choosing the displayed fallback saves its ID');
      return { omitted, storedSection, fallback: 'lesson', preservedHistory: edited.history.length, preservedRhythmProjects: edited.rhythmProjects.length, unrelatedEdit: 'lesson.tab', nativeReload: true, explicitFallbackSaved: true };
    },
  }));
}
