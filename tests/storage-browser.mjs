import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runStorageBrowserChecks } from './helpers/storage-browser-harness.mjs';

const checks = [];
const check = (name, run, options = {}) => checks.push({ name, run, ...options });
const snapshot = page => page.evaluate(() => window.p5.store.readSnapshot());
const seed = page => page.evaluate(() => window.p5.seed());
const backup = page => page.evaluate(() => window.p5.store.exportBackup());

check('native-indexeddb-schema-preferences-presets-and-distinct-results', async ({ page }) => {
  const empty = await snapshot(page); assert.equal(empty.schemaVersion, 1); assert.deepEqual(empty.presets, []); assert.deepEqual(empty.history, []);
  const state = await seed(page);
  assert.equal(state.format, 'bass-study-backup'); assert.equal(state.preferences.player.bpm, 96);
  assert.deepEqual(state.presets.map(item => item.name), ['Нижняя струна', 'Исходная область']);
  assert.deepEqual(state.history.map(item => item.result.kind), ['manual', 'screen']);
  const manual = state.history[0]; const screen = state.history[1];
  assert.equal(manual.result.source, 'self-report'); assert.equal(manual.result.comfortableBpm, 72); assert.equal(manual.result.durationMs, 300000);
  assert.ok(!Object.hasOwn(manual.result, 'accuracy')); assert.ok(!Object.hasOwn(manual.result, 'correct'));
  assert.equal(screen.result.source, 'screen-input'); assert.equal(screen.result.questions[0].independentCorrect, false); assert.equal(screen.result.questions[0].corrected, true); assert.equal(screen.result.questions[0].errors, 1);
  for (const entry of state.history) { assert.equal(entry.occurredAt, '2026-11-08T22:30:00.000Z'); assert.equal(entry.timeZone, 'Europe/Moscow'); assert.equal(entry.localDate, '2026-11-09'); }
  const schema = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('bass-study');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const result = { name: db.name, version: db.version, stores: [...db.objectStoreNames] }; db.close(); resolve(result); };
  }));
  assert.deepEqual(schema, { name: 'bass-study', version: 1, stores: ['history', 'preferences', 'presets'] });
  return { schema, state };
});

check('native-preferences-queue-preserves-concurrent-history-and-presets', async ({ page }) => {
  await seed(page);
  const state = await page.evaluate(async () => {
    const preferences = (await window.p5.store.readSnapshot()).preferences;
    const pending = [];
    for (let index = 0; index < 8; index++) {
      pending.push(window.p5.store.savePreferences({ ...preferences, player: { ...preferences.player, bpm: 100 + index } }));
      pending.push(window.p5.store.addHistory(window.p5.manual(`concurrent-${index}`)));
    }
    await Promise.all(pending); return window.p5.store.readSnapshot();
  });
  assert.equal(state.preferences.player.bpm, 107); assert.equal(state.presets.length, 2); assert.equal(state.history.length, 10);
  assert.deepEqual(state.history.filter(item => item.id.startsWith('fixture-')).map(item => item.id), ['fixture-manual', 'fixture-screen']);
  await page.reload(); await page.waitForFunction(() => window.p5?.ready); assert.deepEqual(await snapshot(page), state);
  return state;
});

check('native-history-upsert-and-deletes-touch-only-requested-records', async ({ page }) => {
  const before = await seed(page);
  const after = await page.evaluate(async () => {
    await window.p5.store.addHistory(window.p5.manual('fixture-manual', 'Обновлённая заметка.'));
    await window.p5.store.deletePreset('fixture-preset-b');
    await window.p5.store.deleteHistory('fixture-screen');
    return window.p5.store.readSnapshot();
  });
  assert.equal(after.history.length, 1); assert.equal(after.history[0].result.note, 'Обновлённая заметка.');
  assert.deepEqual(after.presets.map(item => item.id), ['fixture-preset-a']); assert.deepEqual(after.preferences, before.preferences);
  return after;
});

check('native-export-clean-context-restore-full-replacement', async ({ page, freshPage, closeContext, fixtureUrl }) => {
  const expected = await seed(page); const json = await backup(page); assert.deepEqual(JSON.parse(json), expected);
  const clean = await freshPage(fixtureUrl);
  try {
    assert.deepEqual((await snapshot(clean.page)).history, []);
    const preview = await clean.page.evaluate(json => window.p5.store.previewImport(json), json);
    assert.deepEqual({ presets: preview.presets, history: preview.history, replacement: preview.replacement, requiresConfirmation: preview.requiresConfirmation }, { presets: 2, history: 2, replacement: 'full', requiresConfirmation: true });
    await clean.page.evaluate(json => window.p5.store.restore(json, { confirmed: true }), json);
    assert.deepEqual(await snapshot(clean.page), expected);
    await clean.page.evaluate(() => window.p5.store.addHistory(window.p5.manual('remove-on-replacement')));
    await clean.page.evaluate(json => window.p5.store.restore(json, { confirmed: true }), json);
    assert.deepEqual(await snapshot(clean.page), expected);
    return { copiedBytes: Buffer.byteLength(json), cleanContextRestored: true, obsoleteRecordRemoved: true, preview };
  } finally { await closeContext(clean.context); }
});

check('native-cancel-and-validation-refusals-never-change-existing-data', async ({ page }) => {
  const before = await seed(page);
  const results = await page.evaluate(async () => {
    const current = JSON.parse(await window.p5.store.exportBackup()); const clone = () => structuredClone(current);
    const mutations = [
      ['broken-json', '{broken', 'INVALID_BACKUP'],
      ['unknown-format', JSON.stringify({ ...clone(), format: 'another-app' }), 'UNSUPPORTED_FORMAT'],
      ['future-version', JSON.stringify({ ...clone(), schemaVersion: 2 }), 'UNSUPPORTED_VERSION'],
      ['wrong-bpm-type', (() => { const value = clone(); value.preferences.player.bpm = '96'; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['duplicate-presets', (() => { const value = clone(); value.presets.push(value.presets[0]); return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['duplicate-history', (() => { const value = clone(); value.history.push(value.history[0]); return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['dishonest-screen-score', (() => { const value = clone(); value.history.find(entry => entry.result.kind === 'screen').result.questions[0].independentCorrect = true; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['corrupt-context-position', (() => { const value = clone(); value.history[0].result.context.positionIds = ['E:25']; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['mismatched-local-date', (() => { const value = clone(); value.history[0].localDate = '2026-11-08'; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['manual-fake-accuracy', (() => { const value = clone(); value.history[0].result.accuracy = 100; return JSON.stringify(value); })(), 'INVALID_DATA'],
    ];
    const results = [];
    const cancelled = await window.p5.store.restore(JSON.stringify(window.p5.emptySnapshot()), { confirmed: false });
    results.push({ name: 'cancel', result: cancelled, unchanged: JSON.stringify(await window.p5.store.readSnapshot()) === JSON.stringify(current) });
    for (const [name, json, expected] of mutations) {
      let failure = null;
      try { await window.p5.store.restore(json, { confirmed: true }); } catch (error) { failure = { code: error.code, message: error.message }; }
      results.push({ name, expected, failure, unchanged: JSON.stringify(await window.p5.store.readSnapshot()) === JSON.stringify(current) });
    }
    return results;
  });
  assert.deepEqual(results[0].result, { status: 'cancelled' });
  for (const result of results) { assert.equal(result.unchanged, true, result.name); if (result.expected) assert.equal(result.failure?.code, result.expected, result.name); }
  assert.deepEqual(await snapshot(page), before); return results;
});

check('native-abort-after-successful-put-rolls-back-clears-and-all-stores', async ({ page }) => {
  const before = await seed(page);
  const outcome = await page.evaluate(async () => {
    const replacement = window.p5.emptySnapshot(); let failure = null;
    try { await window.p5.store.restore(JSON.stringify(replacement), { confirmed: true, failAfterWrite: 1 }); }
    catch (error) { failure = { code: error.code, message: error.message }; }
    return { failure, transaction: window.p5.store.getLastTransaction(), after: await window.p5.store.readSnapshot() };
  });
  assert.equal(outcome.failure?.code, 'INJECTED_ABORT'); assert.deepEqual(outcome.transaction, { successfulWrites: 1, aborted: true });
  assert.deepEqual(outcome.after, before);
  await page.reload(); await page.waitForFunction(() => window.p5?.ready); assert.deepEqual(await snapshot(page), before);
  return outcome;
});

check('native-real-browser-quota-refusal-preserves-state-and-recovers', async ({ page, cdp, fixtureOrigin }) => {
  // A populated IDB may retain a small preallocated write credit despite a
  // lower origin quota. Use an opened, empty database so this exercises a real
  // browser refusal rather than assuming every tiny write must exceed it.
  // Atomic rollback with populated stores is independently checked above.
  const before = await snapshot(page);
  const quotaBefore = await cdp.send('Storage.getUsageAndQuota', { origin: fixtureOrigin }); let outcome;
  try {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: fixtureOrigin, quotaSize: 1 });
    const quotaDuring = await cdp.send('Storage.getUsageAndQuota', { origin: fixtureOrigin });
    outcome = await page.evaluate(async () => {
      let failure = null;
      try { await window.p5.store.addHistory(window.p5.manual('quota-must-not-save', 'Н'.repeat(2000))); }
      catch (error) { failure = { code: error.code, message: error.message }; }
      return { failure, transaction: window.p5.store.getLastTransaction(), after: await window.p5.store.readSnapshot() };
    });
    assert.equal(outcome.failure?.code, 'QUOTA', 'The actual native write must fail under the browser quota override');
    assert.equal(outcome.transaction.aborted, true); assert.deepEqual(outcome.after, before);
    outcome.quotaDuring = quotaDuring;
  } finally { await cdp.send('Storage.overrideQuotaForOrigin', { origin: fixtureOrigin }); }
  await page.evaluate(() => window.p5.store.addHistory(window.p5.manual('after-quota-reset')));
  const recovered = await snapshot(page); assert.equal(recovered.history.length, 1);
  return { baselineRecords: before.history.length, quotaBefore, ...outcome, recoveredIds: recovered.history.map(item => item.id), noPhysicalDiskFill: true, populatedRollbackVerifiedSeparately: true };
});

check('native-full-browser-process-restart-keeps-original-history-date', async ({ freshPage, closeContext, fixtureUrl }) => {
  const first = await freshPage(fixtureUrl, false, 'restart-profile'); let expected;
  try { expected = await seed(first.page); await first.page.evaluate(() => window.p5.store.close()); }
  finally { await closeContext(first.context); }
  const reopened = await freshPage(fixtureUrl, false, 'restart-profile');
  try {
    const actual = await snapshot(reopened.page); assert.deepEqual(actual, expected);
    assert.equal(actual.history[0].localDate, '2026-11-09'); return { restartedWholeBrowser: true, actual };
  } finally { await closeContext(reopened.context); }
}, { scope: 'persistent' });

// Product scenarios follow the visible storage controls; no product test API is used.

const historyAction = (page, name) => page.locator(`[data-history-action="${name}"]`);
async function openHistory(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
  const drawer = page.locator('.history-drawer');
  if (!await drawer.evaluate(element => element.open)) await drawer.locator('summary').first().click();
  await page.getByLabel('Название пресета', { exact: true }).waitFor({ state: 'visible' });
}
async function uiBackup(page) {
  await openHistory(page);
  const downloading = page.waitForEvent('download'); await historyAction(page, 'export').click();
  const download = await downloading; assert.match(download.suggestedFilename(), /^bass-study-backup-.*\.json$/);
  const path = await download.path(); assert.ok(path);
  return JSON.parse(await readFile(path, 'utf8'));
}
async function fixtureBackup(page, fixtureUrl) {
  const tab = await page.context().newPage();
  try { await tab.goto(fixtureUrl); await tab.waitForFunction(() => window.p5?.ready); return await tab.evaluate(() => window.p5.seedSnapshot()); }
  finally { await tab.close(); await page.bringToFront(); }
}
async function upload(page, value, name = 'study-copy.json') {
  await openHistory(page);
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) });
}
async function confirmImport(page, value) {
  await upload(page, value); await page.getByTestId('backup-preview').waitFor({ state: 'visible' });
  const confirmation = page.getByRole('checkbox', { name: 'Понимаю, что текущие данные будут заменены', exact: true });
  assert.ok(await historyAction(page, 'confirm-restore').isDisabled()); await confirmation.check(); await historyAction(page, 'confirm-restore').click();
  await page.getByTestId('backup-preview').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
}
async function uiRange(page, last = 3) {
  await page.getByLabel('Тоника', { exact: true }).selectOption('C');
  await page.getByLabel('Структура', { exact: true }).selectOption('major');
  const maximum = page.getByLabel('Последний лад', { exact: true }); await maximum.fill(String(last)); await maximum.press('Tab');
  for (const string of ['A', 'D', 'G']) await page.getByRole('checkbox', { name: `Струна ${string}`, exact: true }).uncheck();
}
async function uiSaved(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="history-save-status"]')?.dataset.status === 'saved');
}

check('ui-settings-reload-presets-apply-delete-and-download-export', async ({ page }) => {
  await uiRange(page);
  await page.getByRole('button', { name: 'Ступени', exact: true }).click();
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  await page.getByLabel('Материал последовательности', { exact: true }).selectOption('chromatic');
  await page.getByLabel('Темп, BPM', { exact: true }).fill('96'); await page.getByLabel('Темп, BPM', { exact: true }).press('Tab');
  await page.getByLabel('Отсчёт перед стартом', { exact: true }).uncheck();
  await openHistory(page); await page.getByLabel('Название пресета', { exact: true }).fill('Мой нижний участок'); await historyAction(page, 'save-preset').click();
  await page.getByTestId('preset-list').getByText('Мой нижний участок', { exact: true }).waitFor();
  const exported = await uiBackup(page); assert.equal(exported.schemaVersion, 1); assert.equal(exported.presets.length, 1);
  assert.deepEqual(exported.preferences.study, { root: 'C', structureId: 'major', labelMode: 'degrees', strings: ['E'], fretMin: 0, fretMax: 3 });
  assert.equal(exported.preferences.player.bpm, 96); assert.equal(exported.preferences.player.countIn, false);
  await page.reload(); await openHistory(page);
  assert.equal(await page.getByLabel('Тоника', { exact: true }).inputValue(), 'C'); assert.equal(await page.getByLabel('Последний лад', { exact: true }).inputValue(), '3');
  assert.equal(await page.getByLabel('Темп, BPM', { exact: true }).inputValue(), '96');
  assert.deepEqual((await uiBackup(page)).presets, exported.presets);
  await page.getByLabel('Тоника', { exact: true }).selectOption('G'); await uiSaved(page);
  await page.getByTestId('preset-list').getByRole('button', { name: 'Применить', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Тоника"]')?.value === 'C');
  await page.getByRole('button', { name: 'Удалить пресет Мой нижний участок', exact: true }).click();
  await page.getByTestId('preset-list').getByText('Мой нижний участок', { exact: true }).waitFor({ state: 'detached' });
  assert.equal((await uiBackup(page)).presets.length, 0);
  return { exportedPreferences: exported.preferences, survivedReload: true, presetAppliedAndDeleted: true };
}, { scope: 'ui' });

check('ui-import-preview-cancel-confirm-and-full-replacement', async ({ page, fixtureUrl }) => {
  const incoming = await fixtureBackup(page, fixtureUrl); await openHistory(page);
  await page.getByLabel('Название пресета', { exact: true }).fill('Устаревший пресет'); await historyAction(page, 'save-preset').click();
  await page.getByTestId('preset-list').getByText('Устаревший пресет', { exact: true }).waitFor(); const before = await uiBackup(page);
  await upload(page, incoming); await page.getByTestId('backup-preview').waitFor();
  assert.match(await page.getByTestId('backup-preview').innerText(), /2 пресетов.*2 записей истории/);
  assert.deepEqual(await uiBackup(page), before, 'Preview and export before confirmation must leave data unchanged');
  await historyAction(page, 'cancel-restore').click(); assert.equal(await page.getByTestId('backup-preview').count(), 0); assert.deepEqual(await uiBackup(page), before);
  await confirmImport(page, incoming); const restored = await uiBackup(page);
  assert.deepEqual(restored, incoming); assert.equal(await page.getByLabel('Тоника', { exact: true }).inputValue(), 'C');
  assert.equal(await page.getByTestId('history-list').locator('[data-history-entry]').count(), 2);
  assert.equal(await page.getByTestId('preset-list').getByText('Устаревший пресет', { exact: true }).count(), 0);
  await page.reload(); await openHistory(page); assert.deepEqual(await uiBackup(page), incoming);
  return { previewDidNotWrite: true, cancelled: true, restored, survivedReload: true };
}, { scope: 'ui' });

check('ui-invalid-import-shows-error-and-preserves-valid-data', async ({ page, fixtureUrl }) => {
  const incoming = await fixtureBackup(page, fixtureUrl); await confirmImport(page, incoming); const before = await uiBackup(page);
  const mutations = [
    ['broken.json', '{broken'],
    ['future.json', JSON.stringify({ ...incoming, schemaVersion: 2 })],
    ['corrupt.json', (() => { const value = structuredClone(incoming); value.history[1].result.questions[0].errors = 0; return JSON.stringify(value); })()],
  ];
  const errors = [];
  for (const [name, json] of mutations) {
    await upload(page, json, name); await page.getByTestId('history-error').waitFor({ state: 'visible' });
    errors.push(await page.getByTestId('history-error').innerText()); assert.equal(await page.getByTestId('backup-preview').count(), 0);
    assert.deepEqual(await uiBackup(page), before, name);
  }
  return { errors, retainedHistory: before.history.length };
}, { scope: 'ui' });

check('ui-completed-screen-result-is-saved-once-and-survives-preference-changes', async ({ page }) => {
  await uiRange(page, 0); await page.getByRole('button', { name: 'Задания', exact: true }).click();
  await page.getByLabel('Тип задания', { exact: true }).selectOption('name-note');
  await page.getByLabel('Материал заданий', { exact: true }).selectOption('chromatic');
  await page.getByLabel('Количество вопросов', { exact: true }).fill('1');
  await page.locator('[data-training-action="start"]').click(); await page.getByTestId('quiz-question').waitFor();
  assert.match(await page.getByTestId('quiz-prompt').innerText(), /струна E, лад 0/);
  await page.locator('[data-choice="pc:5"]').click(); await page.locator('[data-choice="pc:4"]').click();
  await page.locator('[data-training-action="next"]').click(); await page.getByTestId('quiz-summary').waitFor();
  await openHistory(page); await page.getByTestId('history-list').locator('[data-history-kind="screen"]').waitFor();
  const first = await uiBackup(page); assert.equal(first.history.length, 1);
  const entry = first.history[0]; assert.equal(entry.result.kind, 'screen'); assert.equal(entry.result.questions[0].errors, 1); assert.equal(entry.result.questions[0].corrected, true); assert.equal(entry.result.questions[0].independentCorrect, false);
  await page.getByLabel('Тоника', { exact: true }).selectOption('G'); await page.getByRole('button', { name: 'Изучение', exact: true }).click();
  const changed = await uiBackup(page); assert.deepEqual(changed.history, first.history);
  await page.reload(); await openHistory(page); assert.deepEqual((await uiBackup(page)).history, first.history);
  return { entry, savedOnce: true, preferenceChangePreservedHistory: true };
}, { scope: 'ui' });

check('ui-manual-practice-has-self-report-source-and-consumes-duration', async ({ page }) => {
  await uiRange(page, 0); await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  await page.getByLabel('Материал последовательности', { exact: true }).selectOption('chromatic');
  await page.getByLabel('Отсчёт перед стартом', { exact: true }).uncheck(); await page.getByLabel('Повтор', { exact: true }).selectOption('infinite');
  await page.locator('[data-player-action="start"]').click();
  await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.playerState === 'running' && document.querySelector('#player-mount')?.dataset.currentPosition);
  await delay(700); await page.locator('[data-player-action="stop"]').click();
  await openHistory(page); await page.getByLabel('Комфортный темп', { exact: true }).fill('72'); await page.getByLabel('Заметка к практике', { exact: true }).fill('Играю вместе с эталоном; это моя оценка.');
  await historyAction(page, 'save-manual').click(); await page.getByTestId('history-list').locator('[data-history-kind="manual"]').waitFor();
  const first = await uiBackup(page); const entry = first.history[0];
  assert.equal(entry.result.kind, 'manual'); assert.equal(entry.result.source, 'self-report'); assert.equal(entry.result.comfortableBpm, 72);
  assert.ok(entry.result.durationMs > 0 && entry.result.durationMs < 3000); assert.deepEqual(entry.result.context.positionIds, ['E:0']);
  assert.ok(!Object.hasOwn(entry.result, 'accuracy')); assert.match(await page.getByTestId('history-list').innerText(), /Самооценка, не измерение точности игры/);
  await historyAction(page, 'save-manual').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-history-kind="manual"]').length === 2);
  const second = await uiBackup(page); const extra = second.history.find(item => item.id !== entry.id); assert.equal(extra.result.durationMs, 0);
  await page.reload(); await openHistory(page); assert.equal((await uiBackup(page)).history.length, 2);
  return { first: entry, noDoubleCountedDuration: extra.result.durationMs };
}, { scope: 'ui' });

check('ui-history-filters-and-exact-error-review-subset-preserve-original-context', async ({ page, fixtureUrl, resultDir }) => {
  const incoming = await fixtureBackup(page, fixtureUrl); await confirmImport(page, incoming);
  await page.getByLabel('Тип записей истории', { exact: true }).selectOption('manual');
  assert.equal(await page.getByTestId('history-list').locator('[data-history-kind="manual"]').count(), 1); assert.equal(await page.getByTestId('history-list').locator('[data-history-kind="screen"]').count(), 0);
  await page.getByLabel('Тип записей истории', { exact: true }).selectOption('screen');
  assert.equal(await page.getByTestId('history-list').locator('[data-history-kind="screen"]').count(), 1);
  const original = incoming.history.find(entry => entry.result.kind === 'screen'); const expectedId = original.result.questions[0].targetPositionId;
  await historyAction(page, 'review-errors').click(); await page.getByTestId('review-banner').waitFor();
  assert.match(await page.getByTestId('review-banner').innerText(), /только 1 выбранных позиций/); assert.equal(await page.getByLabel('Тоника', { exact: true }).inputValue(), 'A');
  await page.locator('[data-training-action="start"]').click(); await page.getByTestId('quiz-question').waitFor();
  assert.deepEqual(await page.getByTestId('quiz-answer-board').locator('[data-answer-position]').evaluateAll(nodes => nodes.map(node => node.dataset.answerPosition)), [expectedId]);
  assert.match(await page.getByTestId('quiz-prompt').innerText(), new RegExp(`струна E, лад ${expectedId.split(':')[1]}`));
  await page.locator('[data-choice="pc:4"]').click();
  await page.getByRole('button', { name: 'Изучение', exact: true }).click();
  const after = await uiBackup(page); assert.ok(after.history.some(entry => entry.id === original.id));
  await page.screenshot({ path: join(resultDir, 'p5-history-desktop.png'), fullPage: true });
  return { expectedId, originalContext: original.result.context, screenshot: 'test-results/p5-history-desktop.png' };
}, { scope: 'ui' });

check('ui-real-quota-error-is-visible-and-retry-saves-after-reset', async ({ page, cdp, origin }) => {
  await openHistory(page); const before = await uiBackup(page);
  let message;
  try {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 1 });
    await page.getByLabel('Название пресета', { exact: true }).fill('Не должен сохраниться при переполнении'); await historyAction(page, 'save-preset').click();
    await page.getByTestId('history-error').waitFor({ state: 'visible' }); message = await page.getByTestId('history-error').innerText();
    assert.match(message, /места|Сохранение не выполнено/); assert.equal(await page.getByTestId('preset-list').locator('.preset-card').count(), 0);
    assert.match(await page.locator('#persistence-message').innerText(), /места|ошиб|подтвержд|сохранени/i);
  } finally { await cdp.send('Storage.overrideQuotaForOrigin', { origin }); }
  await page.locator('#retry-save').click();
  await page.getByTestId('preset-list').getByText('Не должен сохраниться при переполнении', { exact: true }).waitFor();
  const recovered = await uiBackup(page); assert.equal(recovered.presets.length, 1); assert.deepEqual(recovered.history, before.history);
  return { actualNativeQuotaError: message, retriedAfterQuotaReset: true, recoveredPreset: recovered.presets[0].name };
}, { scope: 'ui' });

check('ui-unavailable-indexeddb-falls-back-to-explicit-memory-and-export', async ({ page }) => {
  await openHistory(page); assert.match(await page.locator('#persistence-message').innerText(), /памяти|не сохран/);
  assert.match(await page.getByTestId('history-body').innerText(), /только в памяти.*не переживут закрытие/s);
  await page.getByLabel('Заметка к практике', { exact: true }).fill('Временная ручная отметка'); await historyAction(page, 'save-manual').click();
  await page.getByTestId('history-list').locator('[data-history-kind="manual"]').waitFor();
  const exported = await uiBackup(page); assert.equal(exported.history.length, 1); assert.equal(exported.history[0].result.source, 'self-report');
  await page.reload(); await openHistory(page); assert.equal((await uiBackup(page)).history.length, 0);
  return { explicitlyMemoryOnly: true, exportedRecords: exported.history.length, reloadClearedTemporaryHistory: true, nativePersistenceClaimed: false };
}, { scope: 'ui', memory: true });

await runStorageBrowserChecks(checks);
