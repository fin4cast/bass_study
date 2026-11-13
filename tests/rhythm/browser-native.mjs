import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { root, action, output, ready, enter, edit, state, start, openGroup, previewCopy, openDrafts, raw, seedDatabase, currentCopy } from './browser-context.mjs';

export const nativeChecks = [];
const check = (name, scope, run) => nativeChecks.push({ name, scope, run });

check('native-p12-rhythm-retry-commits-project-while-profile-write-still-fails', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await enter(page);
  await page.locator('.site-header [data-theme-choice="light"]').click();
  await root(page).locator('[data-rhythm-mode="rhythm"]').click();
  await openGroup(page, '.rhythm-library');
  await action(page, 'new-project').click();
  const rows = output(page, 'projects');
  const selected = rows.locator('[data-rhythm-open-project][aria-pressed="true"]');
  await selected.waitFor();
  const previous = await selected.getAttribute('data-rhythm-open-project');
  const before = await raw(page);
  assert.equal(before.profile.theme, 'light');
  assert.equal(before.activeRhythmProjectId, previous);

  await page.evaluate(() => {
    const fault = window.p12RhythmFault = { profile: true, rhythm: true, profileAborts: 0, rhythmAborts: 0, projectPuts: 0 };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args), transaction = this.transaction;
      if (transaction.db.name !== 'bass-study') return request;
      if (this.name === 'rhythmProjects' && fault.rhythm) request.addEventListener('success', () => { fault.projectPuts++; });
      if (this.name === 'preferences' && args[1] === 'rhythm-selection' && fault.rhythm) request.addEventListener('success', () => {
        fault.rhythmAborts++;
        transaction.abort();
      });
      if (this.name === 'profile' && fault.profile) request.addEventListener('success', () => {
        fault.profileAborts++;
        transaction.abort();
      });
      return request;
    };
  });
  await page.locator('.site-header [data-theme-choice="dark"]').click();
  const retry = page.locator('#retry-save');
  await retry.waitFor();
  await action(page, 'new-project').click();
  await page.waitForFunction(() => document.querySelector('[data-rhythm-library-error="true"]'));
  assert.equal(await action(page, 'new-project').isDisabled(), true);
  assert.deepEqual(await raw(page), before);

  await page.evaluate(() => { window.p12RhythmFault.rhythm = false; });
  await retry.click();
  await page.waitForFunction(previous => {
    const button = document.querySelector('[data-rhythm-open-project][aria-pressed="true"]');
    return button && button.dataset.rhythmOpenProject !== previous && !document.querySelector('[data-rhythm-action="new-project"]').disabled;
  }, previous);
  const committed = await raw(page), next = await selected.getAttribute('data-rhythm-open-project');
  assert.equal(committed.activeRhythmProjectId, next);
  assert.equal(committed.rhythmProjects.length, 2);
  assert.equal(committed.profile.theme, 'light');
  assert.equal(await retry.isVisible(), true);
  assert.deepEqual(await page.evaluate(() => {
    const { profileAborts, rhythmAborts, projectPuts } = window.p12RhythmFault;
    return { profileAborts, rhythmAborts, projectPuts };
  }), { profileAborts: 2, rhythmAborts: 1, projectPuts: 1 });

  await rows.locator(`[data-rhythm-open-project="${previous}"]`).click();
  await selected.and(rows.locator(`[data-rhythm-open-project="${previous}"]`)).waitFor();
  assert.equal((await raw(page)).activeRhythmProjectId, previous);
  assert.equal(await retry.isVisible(), true);
  await page.evaluate(() => { window.p12RhythmFault.profile = false; });
  await retry.click();
  await retry.waitFor({ state: 'hidden' });
  assert.equal((await raw(page)).profile.theme, 'dark');
  return { rhythmRollbackAfterProjectAndSelectionPut: true, selectedProjectAfterRetry: true, independentProfileError: true, libraryUsableBeforeProfileRecovery: true };
}));

check('native-p12-restore-and-retry-are-exclusive-and-post-commit-hydration-requires-reload', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await ready(page);
  await page.locator('.site-header [data-theme-choice="light"]').click();
  for (let attempt = 0; attempt < 40 && (await raw(page)).profile?.theme !== 'light'; attempt++) await delay(50);
  assert.equal((await raw(page)).profile.theme, 'light');
  const copy = JSON.parse(await readFile(new URL('../fixtures/backup.json', import.meta.url), 'utf8'));
  // Раздел, отличный от стартового «Занятия» и от «Настроек», где идёт восстановление: после перезагрузки виден сохранённый.
  copy.preferences.activeModule = 'progress';
  copy.profile.theme = 'light';
  await page.evaluate(() => {
    const probe = window.p12RestoreProbe = { profileAttempts: 0, restoredWrites: 0, attemptedRestoreDuringRetry: false, retryDisabledDuringRestore: false, mainInertDuringRestore: false, restoreCommitted: false, hydrationFailures: 0 };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args), transaction = this.transaction;
      if (transaction.db.name !== 'bass-study' || this.name !== 'profile') return request;
      request.addEventListener('success', () => {
        if (transaction.objectStoreNames.length > 1) {
          probe.restoredWrites++;
          const retry = document.querySelector('#retry-save');
          probe.retryDisabledDuringRestore = retry.disabled;
          probe.mainInertDuringRestore = document.querySelector('main').inert;
          // Synthetic dispatch deliberately bypasses the disabled DOM control.
          retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } else if (++probe.profileAttempts === 1) transaction.abort();
        else if (probe.profileAttempts === 2) {
          probe.attemptedRestoreDuringRetry = true;
          document.querySelector('[data-page-frame="settings"] [data-dlg="replace"]').click();
        }
      });
      return request;
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      const tx = transaction.call(this, stores, mode, ...args);
      if (this.name === 'bass-study' && mode === 'readwrite' && tx.objectStoreNames.length > 1) {
        tx.addEventListener('complete', () => { probe.restoreCommitted = true; });
      }
      return tx;
    };
    const computedStyle = window.getComputedStyle;
    window.getComputedStyle = function (target, ...args) {
      if (target === document.documentElement && probe.restoreCommitted && !probe.hydrationFailures) {
        probe.hydrationFailures++;
        throw new Error('Fixture: post-commit theme hydration');
      }
      return computedStyle.call(this, target, ...args);
    };
  });

  await page.locator('.site-header [data-theme-choice="dark"]').click();
  const retry = page.locator('#retry-save');
  await retry.waitFor();
  const { dialog } = await previewCopy(page, copy, 'p12-post-commit.json');
  await dialog.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
  // Модальный диалог копии делает остальную страницу inert: повтор сохранения, идущий одновременно
  // с подтверждённой заменой, моделируется событием на настоящей кнопке баннера.
  await retry.dispatchEvent('click');
  await dialog.getByRole('alert').filter({ hasText: 'Дождись завершения сохранения перед восстановлением.' }).waitFor();
  await retry.waitFor({ state: 'hidden' });
  assert.equal((await raw(page)).profile.theme, 'dark');
  assert.equal(await page.evaluate(() => window.p12RestoreProbe.restoredWrites), 0);

  // Отказ ничего не меняет; тот же файл выбирается заново и заменяет данные после подтверждения.
  await dialog.locator('[data-dlg="back"]').click();
  const chooser = page.waitForEvent('filechooser');
  await dialog.locator('[data-dlg="choose"]').click();
  await (await chooser).setFiles({ name: 'p12-post-commit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) });
  await dialog.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
  await dialog.locator('[data-dlg="replace"]').click();
  const reloadMessage = 'Данные восстановлены. Перезагрузи страницу, чтобы применить настройки.';
  await page.locator('#persistence-message').filter({ hasText: reloadMessage }).waitFor();
  // Страница стала inert до перезагрузки: диалог закрыт, чтобы не перехватывать указатель у «Проверить снова».
  await page.waitForFunction(() => !document.querySelector('[data-page-frame="settings"] dialog[data-dialog]')?.open);
  assert.equal(await dialog.locator('[data-dlg="replace"]').count(), 0);
  assert.equal(await page.locator('main').getAttribute('aria-busy'), 'true');
  assert.deepEqual(await page.evaluate(() => window.p12RestoreProbe), {
    profileAttempts: 2, restoredWrites: 1, attemptedRestoreDuringRetry: true,
    retryDisabledDuringRestore: true, mainInertDuringRestore: true, restoreCommitted: true, hydrationFailures: 1,
  });
  const committed = await raw(page);
  assert.deepEqual(committed.profile, copy.profile);
  assert.deepEqual(committed.preferences, copy.preferences);
  await page.locator('#retry-tab').click();
  await ready(page);
  assert.equal(await page.locator('.site-header [data-app-module="progress"]').getAttribute('aria-current'), 'page');
  assert.deepEqual(await raw(page), committed);
  return { restoreBlockedDuringRetry: true, retryBlockedDuringRestore: true, nativeCommitBeforeHydrationError: true, candidateConsumed: true, reloadUsesCommittedData: true };
}));

check('native-real-hidden-tab-pauses-until-explicit-resume', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await enter(page);
  await start(page);
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.waitForFunction(() => document.hidden, undefined, { polling: 100 });
  await page.waitForFunction(() => document.querySelector('.rhythm-view')?.dataset.rhythmState === 'paused', undefined, { polling: 100 });
  await page.bringToFront();
  await page.waitForFunction(() => !document.hidden);
  await state(page, 'paused');
  await action(page, 'resume').click();
  await state(page, 'running');
  return { actualDocumentHidden: true, noAutomaticResume: true };
}));

// Current-schema database written without product code: a non-rhythm fretboard sequence draft.
function sequenceDraftSnapshot() {
  const sequenceDraft = {
    id: 'fixture-sequence-draft', createdAt: '2026-11-08T22:30:00.000Z', updatedAt: '2026-11-08T22:30:01.000Z', timeZone: 'Europe/Moscow', localDate: '2026-11-09',
    context: { scope: 'structure', root: 'C', structureId: 'major', positionIds: ['E:8', 'A:7', 'A:10', 'D:10'], box: null },
    material: { kind: 'sequence', pattern: 'ascending', routePositionIds: ['E:8', 'A:7', 'A:10', 'D:10'], duration: 'quarter', fragment: { from: 0, toExclusive: 4 }, box: null }, routeRef: null,
    totalReferenceMs: 2345, recordedThroughMs: 700, suggestedBpm: 113, comfortableBpm: 97, note: 'Сохранённый черновик последовательности грифа', editRevision: 3,
  };
  return {
    ...currentCopy, profile: { theme: 'dark', onboarding: { version: 1, choice: 'guided', completed: true } },
    preferences: { ...currentCopy.preferences, rhythm: null },
    practiceDrafts: [...currentCopy.practiceDrafts, sequenceDraft], rhythmProjects: [], activeRhythmProjectId: null,
  };
}

check('native-current-database-saves-fretboard-sequence-draft', 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await seedDatabase(page, origin, sequenceDraftSnapshot());
  const before = await raw(page);
  assert.equal(before.version, 11);
  await page.goto(origin);
  await ready(page);
  assert.deepEqual(await raw(page), before, 'Opening a current database must not rewrite it');
  const draft = before.practiceDrafts.find(item => item.id === 'fixture-sequence-draft');
  assert.ok(draft);
  // Сохранённый черновик последовательности «Грифа» остаётся в «Прогрессе → Не сохранено» и после P13-08.
  const drafts = await openDrafts(page);
  const card = drafts.locator(`[data-draft="${draft.id}"]`);
  await card.locator('[data-draft-save]').click();
  const deadline = Date.now() + 6000;
  while ((await raw(page)).history.length <= before.history.length) { assert.ok(Date.now() < deadline, 'Manual note from the draft was not committed'); await delay(25); }
  const saved = (await raw(page)).history.find(item => item.id.startsWith('manual-') && !before.history.some(old => old.id === item.id));
  assert.deepEqual(saved.result.material, draft.material);
  assert.deepEqual(saved.result.context, draft.context);
  assert.equal(saved.occurredAt, draft.createdAt);
  assert.deepEqual((await raw(page)).exercises, before.exercises, 'Saving a draft leaves user exercises untouched');
  return { version: before.version, history: before.history.length, drafts: before.practiceDrafts.length, savedDraftDuration: saved.result.durationMs };
}));

check('native-project-restore-validates-chain-and-rolls-back-after-project-and-selection-put', 'native', async ({ fixtureOrigin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await page.goto(`${fixtureOrigin}/tests/fixtures/storage.html`);
  await page.waitForFunction(() => window.p5?.ready);
  const result = await page.evaluate(async literal => {
    const { createDefaultRhythmProject } = await import('/src/rhythm/model.ts');
    const { store, faults } = window.p5;
    await store.restorePrepared(store.prepareImport(JSON.stringify(literal)));
    const first = createDefaultRhythmProject('rhythm-first', 'Первый');
    await store.changeRhythmLibrary({ kind: 'save', project: first });
    const confirmed = await store.readSnapshot();
    const second = createDefaultRhythmProject('rhythm-second', 'Второй');
    const candidate = { ...confirmed, rhythmProjects: [first, second], activeRhythmProjectId: second.id };
    const bad = structuredClone(candidate);
    bad.rhythmProjects[1].chain[0].patternId = 'H';
    let invalidCode, abortCode;
    try { await store.restorePrepared(store.prepareImport(JSON.stringify(bad))); } catch (error) { invalidCode = error.code; }
    const afterInvalid = await store.readSnapshot();
    // Abort right after the last put: every project and the selection were already written successfully.
    const failAfterWrite = 2 + candidate.exercises.length + candidate.history.length + candidate.practiceDrafts.length + candidate.rhythmProjects.length + 1;
    faults.arm(failAfterWrite);
    try { await store.restorePrepared(store.prepareImport(JSON.stringify(candidate))); } catch (error) { abortCode = error.code; }
    const transaction = faults.last();
    const cached = await store.readSnapshot();
    const fresh = await store.readSnapshot({ fresh: true });
    return { confirmed, candidate, invalidCode, abortCode, failAfterWrite, transaction, sameCache: cached === confirmed && afterInvalid === confirmed, fresh };
  }, currentCopy);
  assert.equal(result.invalidCode, 'INVALID_DATA');
  assert.equal(result.abortCode, 'STORAGE_FAILURE');
  assert.equal(result.sameCache, true);
  assert.deepEqual(result.transaction, { successfulWrites: result.failAfterWrite, aborted: true });
  assert.deepEqual(result.fresh, result.confirmed);
  const persisted = await raw(page);
  assert.deepEqual(persisted.rhythmProjects, result.confirmed.rhythmProjects);
  assert.equal(persisted.activeRhythmProjectId, result.confirmed.activeRhythmProjectId);
  await page.evaluate(async candidate => { const { store } = window.p5; await store.restorePrepared(store.prepareImport(JSON.stringify(candidate))); }, result.candidate);
  const restored = await raw(page);
  assert.deepEqual(restored.rhythmProjects, result.candidate.rhythmProjects);
  assert.equal(restored.activeRhythmProjectId, result.candidate.activeRhythmProjectId);
  return { invalidChainRejected: true, successfulWritesBeforeAbort: result.failAfterWrite, retryCommitted: true };
}));
