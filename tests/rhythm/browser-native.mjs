import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, action, output, ready, enter, edit, state, start, openGroup, openHistory, raw, seedDatabase, currentCopy } from './browser-context.mjs';

export const nativeChecks = [];
const check = (name, scope, run) => nativeChecks.push({ name, scope, run });

check('native-p12-rhythm-retry-commits-project-while-profile-write-still-fails', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await enter(page);
  await page.locator('[data-theme-choice="light"]').click();
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
  await page.locator('[data-theme-choice="dark"]').click();
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
  await page.locator('[data-theme-choice="light"]').click();
  await openHistory(page);
  assert.equal((await raw(page)).profile.theme, 'light');
  const copy = JSON.parse(await readFile(new URL('../fixtures/backup.json', import.meta.url), 'utf8'));
  copy.preferences.activeModule = 'input';
  copy.profile.theme = 'light';
  await page.locator('[data-history-file]').setInputFiles({ name: 'p12-post-commit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) });
  const preview = page.getByTestId('backup-preview');
  const confirm = page.locator('[data-history-action="confirm-restore"]');
  await preview.waitFor();
  await page.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
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
          document.querySelector('[data-history-action="confirm-restore"]').click();
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

  await page.locator('[data-theme-choice="dark"]').click();
  const retry = page.locator('#retry-save');
  await retry.waitFor();
  await retry.click();
  const historyError = page.getByTestId('history-error');
  await historyError.filter({ hasText: 'Дождись завершения сохранения перед восстановлением.' }).waitFor();
  assert.equal(await preview.isVisible(), true);
  await retry.waitFor({ state: 'hidden' });
  assert.equal((await raw(page)).profile.theme, 'dark');
  assert.equal(await page.evaluate(() => window.p12RestoreProbe.restoredWrites), 0);

  await confirm.click();
  const reloadMessage = 'Данные восстановлены. Перезагрузи страницу, чтобы применить настройки.';
  await page.locator('#persistence-message').filter({ hasText: reloadMessage }).waitFor();
  await preview.waitFor({ state: 'detached' });
  await historyError.filter({ hasText: reloadMessage }).waitFor();
  assert.doesNotMatch(await page.getByTestId('history-save-status').innerText(), /изменения не подтверждены/);
  assert.equal(await confirm.count(), 0);
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
  assert.equal(await page.locator('[data-app-module="input"]').getAttribute('aria-current'), 'page');
  assert.deepEqual(await raw(page), committed);
  return { restoreBlockedDuringRetry: true, retryBlockedDuringRestore: true, nativeCommitBeforeHydrationError: true, candidateConsumed: true, reloadUsesCommittedData: true };
}));

check('native-real-hidden-tab-pauses-until-explicit-resume', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await enter(page);
  await start(page);
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.waitForFunction(() => document.hidden);
  await state(page, 'paused');
  await page.bringToFront();
  await page.waitForFunction(() => !document.hidden);
  await state(page, 'paused');
  await action(page, 'resume').click();
  await state(page, 'running');
  return { actualDocumentHidden: true, noAutomaticResume: true };
}));

// Current-schema database written without product code: an older harmony draft and a preset without rhythm settings.
function harmonyDraftSnapshot() {
  const harmonyDraft = {
    id: 'fixture-harmony-draft', createdAt: '2026-11-08T22:30:00.000Z', updatedAt: '2026-11-08T22:30:01.000Z', timeZone: 'Europe/Moscow', localDate: '2026-11-09',
    context: { scope: 'structure', root: 'C', structureId: 'major', positionIds: ['E:8', 'A:7', 'A:10', 'D:10'], box: null },
    material: { kind: 'harmony', patternId: 'CFGC-1-3-5-3-v1' }, routeRef: null,
    totalReferenceMs: 2345, recordedThroughMs: 700, suggestedBpm: 113, comfortableBpm: 97, note: 'Сохранённый черновик прежнего аккомпанемента', editRevision: 3,
  };
  return {
    ...currentCopy, profile: { theme: 'dark', onboarding: { version: 1, choice: 'guided', completed: true } },
    preferences: { ...currentCopy.preferences, rhythm: null },
    presets: [{ id: 'fixture-harmony-preset', name: 'Аккомпанемент без ритма', createdAt: '2026-11-08T22:30:00.000Z', preferences: { ...currentCopy.preferences, activeModule: 'harmony', rhythm: null } }],
    practiceDrafts: [...currentCopy.practiceDrafts, harmonyDraft], rhythmProjects: [], activeRhythmProjectId: null,
  };
}

check('native-current-database-saves-harmony-draft-and-rhythmless-preset-keeps-projects', 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await seedDatabase(page, origin, harmonyDraftSnapshot());
  const before = await raw(page);
  assert.equal(before.version, 11);
  await page.goto(origin);
  await ready(page);
  assert.deepEqual(await raw(page), before, 'Opening a current database must not rewrite it');
  await openHistory(page);
  const draft = before.practiceDrafts.find(item => item.material.kind === 'harmony');
  assert.ok(draft);
  await page.getByLabel('Черновики ручной практики', { exact: true }).selectOption(draft.id);
  await page.locator('[data-history-action="save-manual"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-history-kind="manual"]').length >= 2);
  const saved = (await raw(page)).history.find(item => item.id.startsWith('manual-') && !before.history.some(old => old.id === item.id));
  assert.deepEqual(saved.result.material, draft.material);
  assert.deepEqual(saved.result.context, draft.context);
  assert.equal(saved.occurredAt, draft.createdAt);
  await page.locator('#open-history').click();
  await enter(page);
  await edit(page, 'bpm', 113);
  await root(page).locator('[data-rhythm-mode="rhythm"]').click();
  await root(page).locator('[data-rhythm-step]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-rhythm-output="projects"] [data-rhythm-open-project]'));
  const projectBeforePreset = (await raw(page)).rhythmProjects[0];
  await page.locator('[data-app-module="foundation"]').click();
  await openHistory(page);
  await page.locator('[data-apply-preset="fixture-harmony-preset"]').click();
  await root(page).waitFor();
  assert.equal(await root(page).locator('[data-rhythm-mode="rhythm"]').getAttribute('aria-selected'), 'true');
  const afterPreset = await raw(page);
  assert.deepEqual(afterPreset.rhythmProjects, [projectBeforePreset]);
  assert.equal(afterPreset.activeRhythmProjectId, projectBeforePreset.id);
  assert.equal(afterPreset.preferences.rhythm.metronome.bpm, 113);
  return { version: before.version, history: before.history.length, drafts: before.practiceDrafts.length, savedDraftDuration: saved.result.durationMs, rhythmlessPresetPreservesRhythm: true };
}));

check('native-project-restore-validates-chain-and-rolls-back-after-project-and-selection-put', 'native', async ({ fixtureOrigin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await page.goto(`${fixtureOrigin}/tests/fixtures/storage.html`);
  await page.waitForFunction(() => window.p5?.ready);
  const result = await page.evaluate(async literal => {
    const { createDefaultRhythmProject } = await import('/src/rhythm/model.ts');
    const store = window.p5.store;
    await store.restore(JSON.stringify(literal), { confirmed: true });
    const first = createDefaultRhythmProject('rhythm-first', 'Первый');
    await store.saveRhythmProject(first);
    const confirmed = await store.readSnapshot();
    const second = createDefaultRhythmProject('rhythm-second', 'Второй');
    const candidate = { ...confirmed, rhythmProjects: [first, second], activeRhythmProjectId: second.id };
    const bad = structuredClone(candidate);
    bad.rhythmProjects[1].chain[0].patternId = 'H';
    let invalidCode, abortCode;
    try { await store.restore(JSON.stringify(bad), { confirmed: true }); } catch (error) { invalidCode = error.code; }
    const afterInvalid = await store.readSnapshot();
    const failAfterWrite = 2 + candidate.presets.length + candidate.history.length + candidate.practiceDrafts.length + candidate.rhythmProjects.length + 1;
    try { await store.restore(JSON.stringify(candidate), { confirmed: true, failAfterWrite }); } catch (error) { abortCode = error.code; }
    const transaction = store.getLastTransaction();
    const cached = await store.readSnapshot();
    const fresh = await store.readSnapshot({ fresh: true });
    return { confirmed, candidate, invalidCode, abortCode, failAfterWrite, transaction, sameCache: cached === confirmed && afterInvalid === confirmed, fresh };
  }, currentCopy);
  assert.equal(result.invalidCode, 'INVALID_DATA');
  assert.equal(result.abortCode, 'INJECTED_ABORT');
  assert.equal(result.sameCache, true);
  assert.deepEqual(result.transaction, { successfulWrites: result.failAfterWrite, aborted: true });
  assert.deepEqual(result.fresh, result.confirmed);
  const persisted = await raw(page);
  assert.deepEqual(persisted.rhythmProjects, result.confirmed.rhythmProjects);
  assert.equal(persisted.activeRhythmProjectId, result.confirmed.activeRhythmProjectId);
  await page.evaluate(candidate => window.p5.store.restore(JSON.stringify(candidate), { confirmed: true }), result.candidate);
  const restored = await raw(page);
  assert.deepEqual(restored.rhythmProjects, result.candidate.rhythmProjects);
  assert.equal(restored.activeRhythmProjectId, result.candidate.activeRhythmProjectId);
  return { invalidChainRejected: true, successfulWritesBeforeAbort: result.failAfterWrite, retryCommitted: true };
}));
