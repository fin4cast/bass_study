import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runStorageBrowserChecks } from './helpers/storage-browser-harness.mjs';

const checks = [];
const check = (name, run, options = {}) => checks.push({ name, run, ...options });
// Native assertions bypass the adapter cache; cache behaviour has separate cases.
const snapshot = page => page.evaluate(() => window.p5.store.readSnapshot({ fresh: true }));
const seed = page => page.evaluate(() => window.p5.seed());
const backup = page => page.evaluate(() => window.p5.store.exportBackup());

check('native-v6-draft-drain-aborts-after-real-history-put-and-retries-once', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const store = window.p5.store, draft = window.p5.draft();
    await store.saveProfile({ theme: 'dark', onboarding: { version: 1, choice: 'free', completed: false } });
    await store.upsertPracticeDraft(draft);
    const before = await store.readSnapshot();
    const input = { draftId: draft.id, historyId: 'native-drain', expectedRecordedThroughMs: 0, throughMs: 1200, editRevision: 1, comfortableBpm: 64, note: draft.note, occurredAt: draft.createdAt, timeZone: draft.timeZone };
    let failure;
    try { await store.drainDraft({ ...input, failAfterWrite: 1 }); } catch (error) { failure = { code: error.code, message: error.message }; }
    const transaction = store.getLastTransaction(), cached = await store.readSnapshot(), fresh = await store.readSnapshot({ fresh: true });
    const rawDb = await new Promise((resolve, reject) => { const request = indexedDB.open('bass-study'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    let raw;
    try {
      const tx = rawDb.transaction(['history', 'practiceDrafts', 'profile'], 'readonly');
      const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      const get = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [history, practiceDrafts, profile] = await Promise.all([get(tx.objectStore('history').getAll()), get(tx.objectStore('practiceDrafts').getAll()), get(tx.objectStore('profile').get('current'))]);
      await done; raw = { history, practiceDrafts, profile };
    } finally { rawDb.close(); }
    await store.drainDraft(input);
    await store.upsertPracticeDraft({ ...draft, totalReferenceMs: 1800 });
    await store.updateDraftText(draft.id, { editRevision: 2, note: 'Остаток', comfortableBpm: 70, updatedAt: draft.updatedAt });
    await store.drainDraft(input);
    const after = await store.readSnapshot(), afterFresh = await store.readSnapshot({ fresh: true });
    const json = await store.exportBackup(); await store.restore(json, { confirmed: true });
    return { failure, transaction, before, unchangedCachedReference: before === cached, cached, fresh, raw, after, afterFresh, restored: await store.readSnapshot({ fresh: true }) };
  });
  assert.equal(evidence.failure?.code, 'INJECTED_ABORT'); assert.deepEqual(evidence.transaction, { successfulWrites: 1, aborted: true });
  assert.equal(evidence.unchangedCachedReference, true); assert.deepEqual(evidence.cached, evidence.before); assert.deepEqual(evidence.fresh, evidence.before);
  assert.deepEqual(evidence.raw, { history: [], practiceDrafts: evidence.before.practiceDrafts, profile: evidence.before.profile });
  assert.equal(evidence.after.history.length, 1); assert.equal(evidence.after.history[0].result.durationMs, 1200);
  assert.deepEqual(evidence.after.practiceDrafts[0], { ...evidence.before.practiceDrafts[0], totalReferenceMs: 1800, recordedThroughMs: 1200, note: 'Остаток', editRevision: 2, comfortableBpm: 70 });
  assert.deepEqual(evidence.afterFresh, evidence.after); assert.deepEqual(evidence.restored, evidence.after);
  return evidence;
});

check('native-indexeddb-schema-preferences-presets-and-distinct-results', async ({ page }) => {
  const empty = await snapshot(page); assert.equal(empty.schemaVersion, 6); assert.deepEqual(empty.presets, []); assert.deepEqual(empty.history, []);
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
  assert.deepEqual(schema, { name: 'bass-study', version: 6, stores: ['history', 'practiceDrafts', 'preferences', 'presets', 'profile'] });
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
    await Promise.all(pending); return window.p5.store.readSnapshot({ fresh: true });
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
    return window.p5.store.readSnapshot({ fresh: true });
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
    const current = await window.p5.store.readSnapshot({ fresh: true }); const clone = () => structuredClone(current);
    const mutations = [
      ['broken-json', '{broken', 'INVALID_BACKUP'],
      ['unknown-format', JSON.stringify({ ...clone(), format: 'another-app' }), 'UNSUPPORTED_FORMAT'],
      ['future-version', JSON.stringify({ ...clone(), schemaVersion: 7 }), 'UNSUPPORTED_VERSION'],
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
    results.push({ name: 'cancel', result: cancelled, unchanged: JSON.stringify(await window.p5.store.readSnapshot({ fresh: true })) === JSON.stringify(current) });
    for (const [name, json, expected] of mutations) {
      let failure = null;
      try { await window.p5.store.restore(json, { confirmed: true }); } catch (error) { failure = { code: error.code, message: error.message }; }
      results.push({ name, expected, failure, unchanged: JSON.stringify(await window.p5.store.readSnapshot({ fresh: true })) === JSON.stringify(current) });
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
    const cachedBefore = await window.p5.store.readSnapshot(); const rawBefore = await window.p5.readRaw();
    const replacement = window.p5.emptySnapshot(); let failure = null;
    try { await window.p5.store.restore(JSON.stringify(replacement), { confirmed: true, failAfterWrite: 1 }); }
    catch (error) { failure = { code: error.code, message: error.message }; }
    const transaction = window.p5.store.getLastTransaction();
    const cachedAfter = await window.p5.store.readSnapshot(); const freshAfter = await window.p5.store.readSnapshot({ fresh: true });
    return { failure, transaction, cacheReferenceUnchanged: cachedAfter === cachedBefore, after: cachedAfter, freshAfter, rawBefore, rawAfter: await window.p5.readRaw() };
  });
  assert.equal(outcome.failure?.code, 'INJECTED_ABORT'); assert.deepEqual(outcome.transaction, { successfulWrites: 1, aborted: true });
  assert.equal(outcome.cacheReferenceUnchanged, true); assert.deepEqual(outcome.after, before); assert.deepEqual(outcome.freshAfter, before); assert.deepEqual(outcome.rawAfter, outcome.rawBefore);
  await page.reload(); await page.waitForFunction(() => window.p5?.ready); assert.deepEqual(await snapshot(page), before);
  return outcome;
});

check('native-real-browser-quota-refusal-preserves-last-confirmed-commit-and-recovers', async ({ page, cdp, fixtureOrigin }) => {
  const initial = await snapshot(page);
  const quotaBefore = await cdp.send('Storage.getUsageAndQuota', { origin: fixtureOrigin }); let outcome;
  try {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: fixtureOrigin, quotaSize: 1 });
    const quotaDuring = await cdp.send('Storage.getUsageAndQuota', { origin: fixtureOrigin });
    outcome = await page.evaluate(async () => {
      const store = window.p5.store;
      const startedAt = performance.now();
      let baseline = await store.readSnapshot({ fresh: true }), rawBaseline = await window.p5.readRaw();
      const priorCommittedIds = []; let state = 0x6d2b79f5;
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-';
      const note = () => { let value = ''; for (let index = 0; index < 2000; index++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; value += alphabet[(state >>> 0) & 63]; } return value; };
      for (let index = 0; index < 64; index++) {
        const entry = window.p5.manual('quota-native-' + index, note());
        try { await store.addHistory(entry); }
        catch (error) {
          const transaction = store.getLastTransaction(); const after = await store.readSnapshot();
          return { failure: { code: error.code, message: error.message }, failedEntry: entry, attempts: index + 1, boundedAt: 64, interAttemptDelayMs: 550, elapsedMs: Math.round(performance.now() - startedAt), priorCommittedIds,
            baseline, rawBaseline, transaction, cacheReferenceUnchanged: after === baseline, after,
            freshAfter: await store.readSnapshot({ fresh: true }), rawAfter: await window.p5.readRaw() };
        }
        // A permitted write is a real confirmed commit, never called rollback.
        // Refresh and independent raw reads establish the next failure baseline.
        priorCommittedIds.push(entry.id);
        baseline = await store.readSnapshot({ fresh: true }); rawBaseline = await window.p5.readRaw();
        // Observe actual enforcement over separate user-like writes; this is
        // not a claim that the browser applies a quota override immediately.
        if (index < 63) await new Promise(resolve => setTimeout(resolve, 550));
      }
      return { failure: null, attempts: 64, boundedAt: 64, interAttemptDelayMs: 550, elapsedMs: Math.round(performance.now() - startedAt), priorCommittedIds, baseline, rawBaseline, transaction: store.getLastTransaction() };
    });
    assert.equal(outcome.failure?.code, 'QUOTA', 'Observed native quota refusal after bounded delayed writes: ' + JSON.stringify({ quotaBefore, quotaDuring, attempts: outcome.attempts, elapsedMs: outcome.elapsedMs, transaction: outcome.transaction }));
    assert.equal(outcome.cacheReferenceUnchanged, true); assert.deepEqual(outcome.after, outcome.baseline); assert.deepEqual(outcome.freshAfter, outcome.baseline); assert.deepEqual(outcome.rawAfter, outcome.rawBaseline);
    assert.equal(outcome.baseline.history.length, initial.history.length + outcome.priorCommittedIds.length);
    outcome.quotaDuring = quotaDuring;
  } finally { await cdp.send('Storage.overrideQuotaForOrigin', { origin: fixtureOrigin }); }
  await page.evaluate(entry => window.p5.store.addHistory(entry), outcome.failedEntry);
  const recovered = await snapshot(page);
  assert.equal(recovered.history.length, outcome.baseline.history.length + 1);
  assert.equal(recovered.history.filter(entry => entry.id === outcome.failedEntry.id).length, 1);
  for (const entry of outcome.baseline.history) assert.deepEqual(recovered.history.find(value => value.id === entry.id), entry);
  return { initialRecords: initial.history.length, quotaBefore, ...outcome, recoveredIds: recovered.history.map(item => item.id),
    priorCommitsPreserved: true, retriedFailedIdOnce: true, noPhysicalDiskFill: true, abortAfterSuccessfulPutVerifiedSeparately: true };
});

check('native-full-browser-process-restart-keeps-original-history-date', async ({ freshPage, closeContext, fixtureUrl }) => {
  const first = await freshPage(fixtureUrl, false, 'restart-profile'); let expected;
  try { await seed(first.page); expected = await first.page.evaluate(async () => { await window.p5.store.upsertPracticeDraft(window.p5.draft()); await window.p5.store.saveProfile({ theme: 'dark', onboarding: { version: 1, choice: 'guided', completed: true } }); return window.p5.store.readSnapshot(); }); await first.page.evaluate(() => window.p5.store.close()); }
  finally { await closeContext(first.context); }
  const reopened = await freshPage(fixtureUrl, false, 'restart-profile');
  try {
    const actual = await snapshot(reopened.page); assert.deepEqual(actual, expected);
    assert.equal(actual.history[0].localDate, '2026-11-09'); return { restartedWholeBrowser: true, actual };
  } finally { await closeContext(reopened.context); }
}, { scope: 'persistent' });

check('native-cache-explicit-fresh-read-sees-external-writer-and-reopen', async ({ page }) => {
  await seed(page);
  const evidence = await page.evaluate(async () => {
    const store = window.p5.store; const first = await store.readSnapshot(); const second = await store.readSnapshot();
    const other = window.p5.createStore();
    try { await other.savePreferences({ ...first.preferences, player: { ...first.preferences.player, bpm: 109 } }); }
    finally { await other.close(); }
    const known = await store.readSnapshot(); const refreshed = await store.readSnapshot({ fresh: true }); const cachedRefreshed = await store.readSnapshot();
    await store.close(); const reopened = await store.readSnapshot();
    return { sameCachedReference: first === second, externalWriteDoesNotPretendAutoSync: known === first,
      cacheIsFrozen: Object.isFrozen(first) && Object.isFrozen(first.preferences) && Object.isFrozen(first.history),
      knownBpm: known.preferences.player.bpm, refreshedBpm: refreshed.preferences.player.bpm,
      freshBecomesCached: refreshed === cachedRefreshed, refreshed, reopened, raw: await window.p5.readRaw() };
  });
  assert.equal(evidence.sameCachedReference, true); assert.equal(evidence.cacheIsFrozen, true); assert.equal(evidence.externalWriteDoesNotPretendAutoSync, true);
  assert.equal(evidence.knownBpm, 96); assert.equal(evidence.refreshedBpm, 109); assert.equal(evidence.freshBecomesCached, true);
  assert.deepEqual(evidence.reopened, evidence.refreshed); assert.deepEqual(evidence.raw.preferences, evidence.refreshed.preferences);
  return evidence;
});

check('native-successful-commits-update-cache-without-full-read-and-match-fresh-database', async ({ page }) => {
  await seed(page);
  const operations = await page.evaluate(async () => {
    const store = window.p5.store; const prototype = IDBObjectStore.prototype; const originals = {}; const counts = { get: 0, getAll: 0, openCursor: 0 };
    for (const name of Object.keys(counts)) { originals[name] = prototype[name]; prototype[name] = function (...args) { counts[name]++; return originals[name].apply(this, args); }; }
    const rows = [];
    async function verify(name, operation) {
      const before = await store.readSnapshot(); for (const key of Object.keys(counts)) counts[key] = 0;
      await operation(); const cached = await store.readSnapshot(); const callsBeforeFresh = { ...counts };
      const fresh = await store.readSnapshot({ fresh: true });
      rows.push({ name, callsBeforeFresh, explicitFreshCalls: { ...counts }, referenceChanged: cached !== before,
        frozen: Object.isFrozen(cached), cacheMatchesFresh: JSON.stringify(cached) === JSON.stringify(fresh),
        presets: fresh.presets.length, history: fresh.history.length, bpm: fresh.preferences.player.bpm });
    }
    try {
      const preferences = (await store.readSnapshot()).preferences;
      await verify('savePreferences', () => store.savePreferences({ ...preferences, player: { ...preferences.player, bpm: 108 } }));
      await verify('savePreset', () => store.savePreset({ id: 'cache-preset', name: 'Кеш после commit', createdAt: '2026-11-08T09:00:00.000Z', preferences }));
      await verify('addHistory', () => store.addHistory(window.p5.manual('cache-history')));
      await verify('deletePreset', () => store.deletePreset('fixture-preset-b'));
      await verify('deleteHistory', () => store.deleteHistory('fixture-screen'));
      await verify('restore', () => store.restore(JSON.stringify(window.p5.emptySnapshot()), { confirmed: true }));
      return rows;
    } finally { for (const [name, original] of Object.entries(originals)) prototype[name] = original; }
  });
  for (const operation of operations) {
    assert.deepEqual(operation.callsBeforeFresh, { get: 0, getAll: 0, openCursor: 0 }, operation.name);
    assert.ok(operation.explicitFreshCalls.getAll >= 2, operation.name); assert.equal(operation.referenceChanged, true, operation.name);
    assert.equal(operation.frozen, true); assert.equal(operation.cacheMatchesFresh, true, operation.name);
  }
  assert.equal(operations[0].bpm, 108); assert.equal(operations[1].presets, 3); assert.equal(operations[2].history, 3);
  assert.equal(operations[3].presets, 2); assert.equal(operations[4].history, 2); assert.equal(operations[5].history, 0); assert.equal(operations[5].presets, 0);
  return { observer: 'Native IDB read-method wrappers only count calls and always invoke the originals; no returned data or failures are replaced.', operations };
});

check('native-unexpected-database-close-invalidates-cache-after-isolated-browser-clear', async ({ page, cdp, fixtureOrigin }) => {
  const before = await seed(page); assert.equal(before.history.length, 2);
  await page.evaluate(async () => {
    window.p5.beforeUnexpectedClose = await window.p5.store.readSnapshot(); window.p5.observedDatabaseClose = false;
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.addEventListener('close', () => { window.p5.observedDatabaseClose = true; }); resolve(); };
    });
  });
  // This origin belongs solely to the runner's clean, isolated fixture context.
  await cdp.send('Storage.clearDataForOrigin', { origin: fixtureOrigin, storageTypes: 'indexeddb' });
  await page.waitForFunction(() => window.p5.observedDatabaseClose === true);
  const cleared = await page.evaluate(async () => {
    const current = await window.p5.store.readSnapshot();
    return { cacheWasInvalidated: current !== window.p5.beforeUnexpectedClose, current, fresh: await window.p5.store.readSnapshot({ fresh: true }), raw: await window.p5.readRaw() };
  });
  assert.equal(cleared.cacheWasInvalidated, true); assert.deepEqual(cleared.current.history, []); assert.deepEqual(cleared.current.presets, []);
  assert.deepEqual(cleared.current, cleared.fresh); assert.deepEqual(cleared.raw.history, []);
  await page.evaluate(() => window.p5.store.addHistory(window.p5.manual('after-unexpected-close')));
  const recovered = await snapshot(page); assert.deepEqual(recovered.history.map(entry => entry.id), ['after-unexpected-close']);
  return { clearedOnlyIsolatedOrigin: fixtureOrigin, observedRealDatabaseClose: true, cleared, recoveredIds: recovered.history.map(entry => entry.id) };
});

// Product scenarios follow the visible storage controls; no product test API is used.

const historyAction = (page, name) => page.locator(`[data-history-action="${name}"]`);
async function uiReady(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert);
  const free = page.locator('[data-intro="free"]'); if (await free.isVisible()) await free.click();
}
async function revealControl(locator) {
  const parents = locator.locator('xpath=ancestor::details');
  for (let index = 0; index < await parents.count(); index++) { const details = parents.nth(index); if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click(); }
}
async function openHistory(page) {
  await uiReady(page);
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
  await uiReady(page); await revealControl(page.getByLabel('Первый лад', { exact: true }));
  await page.getByLabel('Тоника', { exact: true }).selectOption('C');
  await page.getByLabel('Структура', { exact: true }).selectOption('major');
  const minimum = page.getByLabel('Первый лад', { exact: true }), maximum = page.getByLabel('Последний лад', { exact: true });
  await maximum.fill('24'); await maximum.press('Tab'); await minimum.fill('0'); await minimum.press('Tab'); await maximum.fill(String(last)); await maximum.press('Tab');
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
  const exported = await uiBackup(page); assert.equal(exported.schemaVersion, 6); assert.equal(exported.presets.length, 1);
  assert.deepEqual(exported.preferences.study, { root: 'C', structureId: 'major', labelMode: 'degrees', strings: ['E'], fretMin: 0, fretMax: 3, box: null, showFingers: false });
  assert.equal(exported.preferences.player.bpm, 96); assert.equal(exported.preferences.player.countIn, false);
  await page.reload(); await openHistory(page);
  assert.equal(await page.getByLabel('Тоника', { exact: true }).inputValue(), 'C'); assert.equal(await page.getByLabel('Последний лад', { exact: true }).inputValue(), '3');
  assert.equal(await page.getByLabel('Темп, BPM', { exact: true }).inputValue(), '96');
  assert.deepEqual((await uiBackup(page)).presets, exported.presets);
  await page.getByLabel('Тоника', { exact: true }).selectOption('G'); await uiSaved(page);
  await page.getByTestId('preset-list').getByRole('button', { name: 'Применить', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Тоника"]')?.value === 'C');
  const deletion = page.getByRole('button', { name: 'Удалить пресет Мой нижний участок', exact: true });
  await deletion.click(); const dialog = page.getByRole('dialog'); await dialog.waitFor(); assert.match(await dialog.innerText(), /Мой нижний участок/);
  await page.keyboard.press('Escape'); assert.equal(await page.getByTestId('preset-list').getByText('Мой нижний участок', { exact: true }).count(), 1);
  await deletion.click(); await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click(); assert.equal((await uiBackup(page)).presets.length, 1);
  await deletion.click(); await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.getByTestId('preset-list').getByText('Мой нижний участок', { exact: true }).waitFor({ state: 'detached' });
  assert.equal((await uiBackup(page)).presets.length, 0);
  return { exportedPreferences: exported.preferences, survivedReload: true, presetAppliedAndDeleted: true, escapeAndCancelPreservedPreset: true };
}, { scope: 'ui' });

check('ui-finger-display-setting-survives-preset-reload-and-backup-restore', async ({ page }) => {
  await uiReady(page); await page.locator('#show-fingers').check();
  await openHistory(page); await page.getByLabel('Название пресета', { exact: true }).fill('Форма с пальцами'); await historyAction(page, 'save-preset').click();
  await page.getByTestId('preset-list').getByText('Форма с пальцами', { exact: true }).waitFor();
  const expected = await uiBackup(page); assert.equal(expected.preferences.study.showFingers, true); assert.equal(expected.preferences.study.box.shapeId, 'penta-a');
  await page.locator('#show-fingers').uncheck(); await uiSaved(page); assert.equal((await uiBackup(page)).preferences.study.showFingers, false);
  await page.getByTestId('preset-list').getByRole('button', { name: 'Применить', exact: true }).click(); assert.ok(await page.locator('#show-fingers').isChecked());
  await page.reload(); await openHistory(page); assert.ok(await page.locator('#show-fingers').isChecked()); assert.deepEqual(await uiBackup(page), expected);
  await page.locator('#show-fingers').uncheck(); await uiSaved(page); await confirmImport(page, expected);
  assert.ok(await page.locator('#show-fingers').isChecked()); assert.deepEqual(await uiBackup(page), expected);
  return { initialBox: expected.preferences.study.box, displayStoredIndependently: true, presetAndReloadAndRestore: true };
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

check('ui-restore-after-nonzero-practice-does-not-add-old-clock-to-imported-draft', async ({ page }) => {
  await uiRange(page, 0); await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  await page.getByLabel('Материал последовательности', { exact: true }).selectOption('chromatic');
  await page.getByLabel('Повтор', { exact: true }).selectOption('infinite'); await page.getByLabel('Отсчёт перед стартом', { exact: true }).uncheck();
  async function playFor(milliseconds) {
    await page.locator('[data-player-action="start"]').click();
    await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.playerState === 'running' && document.querySelector('#player-mount')?.dataset.currentPosition === 'E:0');
    await delay(milliseconds); await page.locator('[data-player-action="stop"]').click();
  }
  await playFor(650); const exported = await uiBackup(page);
  const oldDraft = exported.practiceDrafts.find(draft => draft.totalReferenceMs > 0); assert.ok(oldDraft); assert.equal(exported.history.length, 0);
  assert.equal(exported.profile.onboarding.choice, 'free');
  await playFor(750); const later = await uiBackup(page);
  assert.ok(later.practiceDrafts.find(draft => draft.id === oldDraft.id).totalReferenceMs >= oldDraft.totalReferenceMs + 500);
  await confirmImport(page, exported); const restored = await uiBackup(page); assert.deepEqual(restored, exported);
  assert.equal(await page.locator('#player-mount').getAttribute('data-player-state'), 'stopped');
  await page.reload(); await openHistory(page); assert.deepEqual(await uiBackup(page), exported);
  return { exportedReferenceMs: oldDraft.totalReferenceMs, laterReferenceMs: later.practiceDrafts.find(draft => draft.id === oldDraft.id).totalReferenceMs,
    importedSnapshotUnchanged: true, staleAudioClockNotAdded: true, nativeUiRestoreAndReload: true };
}, { scope: 'ui' });

check('ui-invalid-import-shows-error-and-preserves-valid-data', async ({ page, fixtureUrl }) => {
  const incoming = await fixtureBackup(page, fixtureUrl); await confirmImport(page, incoming); const before = await uiBackup(page);
  const mutations = [
    ['broken.json', '{broken'],
    ['future.json', JSON.stringify({ ...incoming, schemaVersion: 7 })],
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
  await revealControl(page.getByLabel('Материал заданий', { exact: true })); await page.getByLabel('Материал заданий', { exact: true }).selectOption('chromatic');
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

check('ui-lazy-history-opens-current-own-commits-and-partial-upsert-keeps-one-id', async ({ page }) => {
  await uiRange(page, 0); await page.getByRole('button', { name: 'Задания', exact: true }).click();
  await page.getByLabel('Тип задания', { exact: true }).selectOption('name-note'); await revealControl(page.getByLabel('Материал заданий', { exact: true })); await page.getByLabel('Материал заданий', { exact: true }).selectOption('chromatic');
  await page.getByLabel('Количество вопросов', { exact: true }).fill('1'); await page.getByLabel('Количество вопросов', { exact: true }).press('Tab');
  assert.equal(await page.locator('.history-drawer').evaluate(element => element.open), false);
  await page.locator('[data-training-action="start"]').click(); await page.locator('[data-choice="pc:5"]').click(); await uiSaved(page);
  await openHistory(page); const initial = await uiBackup(page); assert.equal(initial.history.length, 1);
  const id = initial.history[0].id; assert.equal(initial.history[0].result.questions[0].outcome, 'interrupted');
  assert.equal(await page.locator(`[data-history-entry="${id}"]`).count(), 1);
  await page.locator('.history-drawer > summary').click();
  await page.locator('[data-choice="pc:4"]').click(); await page.locator('[data-training-action="next"]').click(); await uiSaved(page);
  await openHistory(page); const completed = await uiBackup(page);
  assert.equal(completed.history.length, 1); assert.equal(completed.history[0].id, id); assert.equal(completed.history[0].result.questions[0].outcome, 'corrected');
  assert.equal(completed.history[0].result.questions[0].errors, 1); assert.equal(completed.history[0].result.questions[0].independentCorrect, false);
  assert.equal(await page.locator(`[data-history-entry="${id}"]`).count(), 1); assert.match(await page.locator(`[data-history-entry="${id}"]`).innerText(), /ошибок 1/);
  await page.locator('.history-drawer > summary').click(); await page.getByLabel('Тоника', { exact: true }).selectOption('G'); await uiSaved(page);
  await openHistory(page); assert.equal(await page.locator(`[data-history-entry="${id}"]`).count(), 1);
  const afterPreference = await uiBackup(page); assert.deepEqual(afterPreference.history, completed.history);
  return { sameSessionHistoryId: id, initiallyClosed: true, partialOutcome: 'interrupted', completedOutcome: 'corrected', historyCount: completed.history.length, latestOwnCommitsVisibleOnOpen: true };
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
  let message, failedName, confirmedBeforeFailure = []; let attempts = 0;
  try {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 1 });
    // Real IDB may have a preallocated credit after initial profile/preferences.
    // Bound the UI attempts; each successful card is a confirmed native commit.
    for (let index = 0; index < 1024; index++) {
      const name = 'Переполнение ' + index + ' ' + 'Н'.repeat(54); attempts++;
      const beforeIds = await page.getByTestId('preset-list').locator('[data-preset-id]').evaluateAll(nodes => nodes.map(node => node.dataset.presetId).sort());
      await page.getByLabel('Название пресета', { exact: true }).fill(name); await historyAction(page, 'save-preset').click();
      await page.waitForFunction(name => {
        const error = document.querySelector('[data-testid="history-error"]');
        return !!(error && error.getClientRects().length) || [...document.querySelectorAll('[data-preset-id] strong')].some(node => node.textContent === name);
      }, name);
      if (await page.getByTestId('history-error').isVisible()) {
        message = await page.getByTestId('history-error').innerText(); failedName = name; confirmedBeforeFailure = beforeIds;
        const afterIds = await page.getByTestId('preset-list').locator('[data-preset-id]').evaluateAll(nodes => nodes.map(node => node.dataset.presetId).sort());
        assert.deepEqual(afterIds, beforeIds, 'A refused native put must not add or remove a confirmed preset'); break;
      }
    }
    assert.ok(failedName, '1024 real UI saves must exhaust preallocated credit under a 1-byte origin quota');
    assert.match(message, /места|Сохранение не выполнено/);
    assert.match(await page.locator('#persistence-message').innerText(), /места|ошиб|подтвержд|сохранени/i);
  } finally { await cdp.send('Storage.overrideQuotaForOrigin', { origin }); }
  await page.locator('#retry-save').click(); await page.getByTestId('preset-list').getByText(failedName, { exact: true }).waitFor();
  const recovered = await uiBackup(page);
  assert.equal(recovered.presets.length, confirmedBeforeFailure.length + 1);
  for (const id of confirmedBeforeFailure) assert.ok(recovered.presets.some(preset => preset.id === id));
  assert.equal(recovered.presets.filter(preset => preset.name === failedName).length, 1); assert.deepEqual(recovered.history, before.history);
  return { actualNativeQuotaError: message, attempts, boundedAt: 1024, confirmedBeforeFailure, retriedAfterQuotaReset: true, recoveredPreset: failedName };
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
