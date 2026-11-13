import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  answerChoice, answerNameNoteCorrectly, cancelCopy, checkHost, checkProgress, currentSection, draftCard, exportDownload, exportUi, go, nameNoteQuestion,
  openData, openDrafts, openFormCheck, openSettingsPane, playRhythm, previewCopy, progressPage, rawSnapshot, ready, replaceCopy, restoreCopy,
  rhythmRoot, rhythmState, rhythmWait, settingsDialog, settingsPage, waitRaw, withoutSection,
} from './helpers/data-ui.mjs';
import { runStorageBrowserChecks } from './helpers/storage-browser-harness.mjs';
import { p12CompositionChecks } from './helpers/p12-composition-cases.mjs';
import { browserCases, markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';

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
    window.p5.faults.arm(1);
    try { await store.drainDraft(input); } catch (error) { failure = { code: error.code, message: error.message }; }
    const transaction = window.p5.faults.last(), cached = await store.readSnapshot(), fresh = await store.readSnapshot({ fresh: true });
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
    const current = (await store.readSnapshot()).practiceDrafts.find(value => value.id === draft.id);
    await store.upsertPracticeDraft({ ...current, editRevision: 2, note: 'Остаток', comfortableBpm: 70 });
    await store.drainDraft(input);
    const after = await store.readSnapshot(), afterFresh = await store.readSnapshot({ fresh: true });
    const json = await store.exportBackup(); await store.restorePrepared(store.prepareImport(json));
    return { failure, transaction, before, unchangedCachedReference: before === cached, cached, fresh, raw, after, afterFresh, restored: await store.readSnapshot({ fresh: true }) };
  });
  assert.equal(evidence.failure?.code, 'STORAGE_FAILURE'); assert.deepEqual(evidence.transaction, { successfulWrites: 1, aborted: true });
  assert.equal(evidence.unchangedCachedReference, true); assert.deepEqual(evidence.cached, evidence.before); assert.deepEqual(evidence.fresh, evidence.before);
  assert.deepEqual(evidence.raw, { history: [], practiceDrafts: evidence.before.practiceDrafts, profile: evidence.before.profile });
  assert.equal(evidence.after.history.length, 1); assert.equal(evidence.after.history[0].result.durationMs, 1200);
  assert.deepEqual(evidence.after.practiceDrafts[0], { ...evidence.before.practiceDrafts[0], totalReferenceMs: 1800, recordedThroughMs: 1200, note: 'Остаток', editRevision: 2, comfortableBpm: 70 });
  assert.deepEqual(evidence.afterFresh, evidence.after); assert.deepEqual(evidence.restored, evidence.after);
  return evidence;
});

check('native-route-link-rollback-retry-old-parent-and-delete', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const { store, route, screen, readRaw } = window.p5;
    const parent = route('history-a');
    const other = route('history-b');
    const first = { ...screen('first-linked-screen'), routeRef: { routeId: parent.result.id, step: 'fretboard' } };
    const second = { ...screen('second-linked-screen'), routeRef: first.routeRef };
    const delayed = { ...screen('screen-before-parent'), routeRef: { routeId: 'session-history-c', step: 'fretboard' } };
    await store.addHistory(parent);
    const cachedBefore = await store.readSnapshot(), rawBefore = await readRaw();
    const put = IDBObjectStore.prototype.put;
    async function abortAfterPut(entry) {
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (this.name === 'history' && args[0]?.id === entry.id) {
          const transaction = this.transaction;
          request.addEventListener('success', () => transaction.abort());
        }
        return request;
      };
      try { await store.addHistory(entry); return null; }
      catch (error) { return { code: error.code, ...window.p5.faults.last() }; }
      finally { IDBObjectStore.prototype.put = put; }
    }
    const firstAbort = await abortAfterPut(first);
    const unchanged = (await store.readSnapshot()) === cachedBefore;
    const rawAfterAbort = await readRaw();
    await store.addHistory(other);
    const receipt = await store.addHistory(first);
    const checkpoint = await store.addHistory(route('history-a', 4200));
    await store.deleteHistory(first.id);
    const afterChildDeletion = await store.readSnapshot();
    const secondAbort = await abortAfterPut(second);
    await store.deleteHistory(parent.id);
    const retryAfterDelete = await store.addHistory(second);
    const delayedParentAbort = await abortAfterPut(route('history-c'));
    await store.addHistory(delayed);
    await store.addHistory(route('history-c'));
    const final = await store.readSnapshot();
    return { firstAbort, secondAbort, delayedParentAbort, unchanged, rawBefore, rawAfterAbort, receipt, checkpoint, afterChildDeletion,
      retryAfterDelete, final, raw: await readRaw(), exported: JSON.parse(await store.exportBackup()) };
  });
  for (const aborted of [evidence.firstAbort, evidence.secondAbort, evidence.delayedParentAbort]) {
    assert.deepEqual(aborted, { code: 'STORAGE_FAILURE', successfulWrites: 1, aborted: true });
  }
  assert.equal(evidence.unchanged, true);
  assert.deepEqual(evidence.rawAfterAbort, evidence.rawBefore);
  const expected = [{ id: 'first-linked-screen', kind: 'screen', step: 'fretboard' }];
  assert.equal(evidence.receipt.linkedRoute.id, 'history-a');
  assert.deepEqual(evidence.receipt.linkedRoute.result.sessionLinks, expected);
  assert.deepEqual(evidence.checkpoint.entry.result.sessionLinks, expected);
  assert.deepEqual(evidence.afterChildDeletion.history.find(entry => entry.id === 'history-a').result.sessionLinks, expected);
  assert.ok(!evidence.afterChildDeletion.history.some(entry => entry.id === 'first-linked-screen'));
  assert.equal(evidence.retryAfterDelete.linkedRoute, undefined);
  assert.deepEqual(evidence.retryAfterDelete.entry.routeRef, { routeId: 'session-history-a', step: 'fretboard' });
  assert.ok(!evidence.final.history.some(entry => entry.id === 'history-a'));
  assert.deepEqual(evidence.final.history.find(entry => entry.id === 'history-b').result.sessionLinks, []);
  assert.deepEqual(evidence.final.history.find(entry => entry.id === 'history-c').result.sessionLinks, [{ id: 'screen-before-parent', kind: 'screen', step: 'fretboard' }]);
  assert.deepEqual(evidence.raw.history, evidence.final.history);
  assert.deepEqual(evidence.exported, evidence.final);
  return { abortAfterSuccessfulPut: true, oldParentOnly: true, checkpointKeepsLink: true, deletedParentNeverRecreated: true, delayedParentLinked: true };
});

check('native-route-manual-drain-rolls-back-child-draft-and-parent', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const { store, route, draft, readRaw } = window.p5;
    const parent = route('manual-parent');
    const value = { ...draft(), routeRef: { routeId: parent.result.id, step: 'sequence' } };
    await store.addHistory(parent);
    await store.upsertPracticeDraft(value);
    const before = await store.readSnapshot();
    const input = { draftId: value.id, historyId: 'manual-drain-route', expectedRecordedThroughMs: 0, throughMs: value.totalReferenceMs, editRevision: value.editRevision,
      comfortableBpm: value.comfortableBpm, note: value.note, occurredAt: value.createdAt, timeZone: value.timeZone };
    let aborted;
    window.p5.faults.arm(2);
    try { await store.drainDraft(input); }
    catch (error) { aborted = { code: error.code, ...window.p5.faults.last() }; }
    const unchanged = before === await store.readSnapshot();
    const rawAfterAbort = await readRaw();
    const put = IDBObjectStore.prototype.put;
    let abortedAfterParent;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === 'history' && args[0]?.id === parent.id) {
        const transaction = this.transaction;
        request.addEventListener('success', () => transaction.abort());
      }
      return request;
    };
    try { await store.drainDraft(input); }
    catch (error) { abortedAfterParent = { code: error.code, ...window.p5.faults.last() }; }
    finally { IDBObjectStore.prototype.put = put; }
    const unchangedAfterParent = before === await store.readSnapshot();
    const rawAfterParentAbort = await readRaw();
    await store.addHistory(route('new-manual-parent'));
    const committed = await store.drainDraft(input);
    const repeated = await store.drainDraft(input);
    return { aborted, unchanged, before, rawAfterAbort, abortedAfterParent, unchangedAfterParent, rawAfterParentAbort, committed, repeated, after: await store.readSnapshot(), raw: await readRaw() };
  });
  assert.deepEqual(evidence.aborted, { code: 'STORAGE_FAILURE', successfulWrites: 2, aborted: true });
  assert.equal(evidence.unchanged, true);
  assert.deepEqual(evidence.rawAfterAbort.history, evidence.before.history);
  assert.deepEqual(evidence.rawAfterAbort.practiceDrafts, evidence.before.practiceDrafts);
  assert.deepEqual(evidence.abortedAfterParent, { code: 'STORAGE_FAILURE', successfulWrites: 3, aborted: true });
  assert.equal(evidence.unchangedAfterParent, true);
  assert.deepEqual(evidence.rawAfterParentAbort, evidence.rawAfterAbort);
  assert.deepEqual(evidence.committed.linkedRoute.result.sessionLinks, [{ id: 'manual-drain-route', kind: 'manual', step: 'sequence' }]);
  assert.equal(evidence.repeated.linkedRoute, undefined);
  assert.deepEqual(evidence.repeated.entry, evidence.committed.entry);
  assert.equal(evidence.after.history.filter(entry => entry.result.kind === 'manual').length, 1);
  assert.equal(evidence.committed.entry.result.durationMs, 1200);
  assert.equal(evidence.after.practiceDrafts[0].recordedThroughMs, 1200);
  assert.deepEqual(evidence.after.history.find(entry => entry.id === 'new-manual-parent').result.sessionLinks, []);
  assert.deepEqual(evidence.raw.history, evidence.after.history);
  assert.deepEqual(evidence.raw.practiceDrafts, evidence.after.practiceDrafts);
  return { abortAfterTwoAndThreeSuccessfulWrites: true, sameIdOnRetry: true, originalParentOnly: true, oneTimeDebit: true };
});

check('native-indexeddb-schema-preferences-exercises-and-distinct-results', async ({ page }) => {
  const empty = await snapshot(page); assert.equal(empty.schemaVersion, 11); assert.deepEqual(empty.exercises, []); assert.deepEqual(empty.history, []);
  assert.deepEqual(empty.rhythmProjects, []); assert.equal(empty.activeRhythmProjectId, null);
  const state = await seed(page);
  assert.equal(state.format, 'bass-study-backup'); assert.equal(state.preferences.play.bpm, 96);
  assert.deepEqual(state.exercises.map(item => item.name), ['Нижняя форма', 'Вторая форма']);
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
  assert.deepEqual(schema, { name: 'bass-study', version: 11, stores: ['exercises', 'history', 'practiceDrafts', 'preferences', 'profile', 'rhythmProjects'] });
  return { schema, state };
});

check('native-preferences-queue-preserves-concurrent-history-and-exercises', async ({ page }) => {
  await seed(page);
  const state = await page.evaluate(async () => {
    const preferences = (await window.p5.store.readSnapshot()).preferences;
    const pending = [];
    for (let index = 0; index < 8; index++) {
      pending.push(window.p5.store.savePreferences({ ...preferences, play: { ...preferences.play, bpm: 100 + index } }));
      pending.push(window.p5.store.addHistory(window.p5.manual(`concurrent-${index}`)));
    }
    await Promise.all(pending); return window.p5.store.readSnapshot({ fresh: true });
  });
  assert.equal(state.preferences.play.bpm, 107); assert.equal(state.exercises.length, 2); assert.equal(state.history.length, 10);
  assert.deepEqual(state.history.filter(item => item.id.startsWith('fixture-')).map(item => item.id), ['fixture-manual', 'fixture-screen']);
  await page.reload(); await page.waitForFunction(() => window.p5?.ready); assert.deepEqual(await snapshot(page), state);
  return state;
});

check('native-history-upsert-and-deletes-touch-only-requested-records', async ({ page }) => {
  const before = await seed(page);
  const after = await page.evaluate(async () => {
    await window.p5.store.addHistory(window.p5.manual('fixture-manual', 'Обновлённая заметка.'));
    await window.p5.store.deleteExercise('fixture-exercise-b');
    await window.p5.store.deleteHistory('fixture-screen');
    return window.p5.store.readSnapshot({ fresh: true });
  });
  assert.equal(after.history.length, 1); assert.equal(after.history[0].result.note, 'Обновлённая заметка.');
  assert.deepEqual(after.exercises.map(item => item.id), ['fixture-exercise-a']); assert.deepEqual(after.preferences, before.preferences);
  return after;
});

check('native-export-clean-context-restore-full-replacement', async ({ page, freshPage, closeContext, fixtureUrl }) => {
  const expected = await seed(page); const json = await backup(page); assert.deepEqual(JSON.parse(json), expected);
  const clean = await freshPage(fixtureUrl);
  try {
    assert.deepEqual((await snapshot(clean.page)).history, []);
    const preview = await clean.page.evaluate(json => window.p5.previewImport(json), json);
    assert.deepEqual({ exercises: preview.exercises, history: preview.history, replacement: preview.replacement, requiresConfirmation: preview.requiresConfirmation }, { exercises: 2, history: 2, replacement: 'full', requiresConfirmation: true });
    await clean.page.evaluate(async json => { const { store } = window.p5; await store.restorePrepared(store.prepareImport(json)); }, json);
    assert.deepEqual(await snapshot(clean.page), expected);
    await clean.page.evaluate(() => window.p5.store.addHistory(window.p5.manual('remove-on-replacement')));
    await clean.page.evaluate(async json => { const { store } = window.p5; await store.restorePrepared(store.prepareImport(json)); }, json);
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
      ['previous-version', JSON.stringify({ ...clone(), schemaVersion: 10 }), 'UNSUPPORTED_VERSION'],
      ['future-version', JSON.stringify({ ...clone(), schemaVersion: 12 }), 'UNSUPPORTED_VERSION'],
      ['wrong-bpm-type', (() => { const value = clone(); value.preferences.play.bpm = '96'; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['duplicate-exercises', (() => { const value = clone(); value.exercises.push(value.exercises[0]); return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['exercise-extra-field', (() => { const value = clone(); value.exercises[0].preferences = {}; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['legacy-presets-field', (() => { const value = clone(); value.presets = []; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['exercise-pass-without-assessment', (() => { const value = clone(); value.history.push({ ...window.p5.exercisePass(), result: { ...window.p5.exercisePass().result, assessment: null } }); return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['check-foreign-degree', (() => { const value = clone(); const entry = structuredClone(window.p5.check()); entry.result.answers[0].degree = '3'; value.history.push(entry); return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['duplicate-history', (() => { const value = clone(); value.history.push(value.history[0]); return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['dishonest-screen-score', (() => { const value = clone(); value.history.find(entry => entry.result.kind === 'screen').result.questions[0].independentCorrect = true; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['corrupt-context-position', (() => { const value = clone(); value.history[0].result.context.positionIds = ['E:25']; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['mismatched-local-date', (() => { const value = clone(); value.history[0].localDate = '2026-11-08'; return JSON.stringify(value); })(), 'INVALID_DATA'],
      ['manual-fake-accuracy', (() => { const value = clone(); value.history[0].result.accuracy = 100; return JSON.stringify(value); })(), 'INVALID_DATA'],
    ];
    const results = [];
    // Cancel = the copy is prepared for preview and never committed.
    const prepared = window.p5.store.prepareImport(JSON.stringify(window.p5.emptySnapshot()));
    const cancelled = { requiresConfirmation: prepared.requiresConfirmation, replacement: prepared.replacement, exercises: prepared.exercises, history: prepared.history };
    results.push({ name: 'cancel', result: cancelled, unchanged: JSON.stringify(await window.p5.store.readSnapshot({ fresh: true })) === JSON.stringify(current) });
    for (const [name, json, expected] of mutations) {
      let failure = null;
      try { await window.p5.store.restorePrepared(window.p5.store.prepareImport(json)); } catch (error) { failure = { code: error.code, message: error.message }; }
      results.push({ name, expected, failure, unchanged: JSON.stringify(await window.p5.store.readSnapshot({ fresh: true })) === JSON.stringify(current) });
    }
    return results;
  });
  assert.deepEqual(results[0].result, { requiresConfirmation: true, replacement: 'full', exercises: 0, history: 0 });
  for (const result of results) { assert.equal(result.unchanged, true, result.name); if (result.expected) assert.equal(result.failure?.code, result.expected, result.name); }
  assert.deepEqual(await snapshot(page), before); return results;
});

check('native-abort-after-successful-put-rolls-back-clears-and-all-stores', async ({ page }) => {
  const before = await seed(page);
  const outcome = await page.evaluate(async () => {
    const cachedBefore = await window.p5.store.readSnapshot(); const rawBefore = await window.p5.readRaw();
    const replacement = window.p5.emptySnapshot(); let failure = null;
    window.p5.faults.arm(1);
    try { await window.p5.store.restorePrepared(window.p5.store.prepareImport(JSON.stringify(replacement))); }
    catch (error) { failure = { code: error.code, message: error.message }; }
    const transaction = window.p5.faults.last();
    const cachedAfter = await window.p5.store.readSnapshot(); const freshAfter = await window.p5.store.readSnapshot({ fresh: true });
    return { failure, transaction, cacheReferenceUnchanged: cachedAfter === cachedBefore, after: cachedAfter, freshAfter, rawBefore, rawAfter: await window.p5.readRaw() };
  });
  assert.equal(outcome.failure?.code, 'STORAGE_FAILURE'); assert.deepEqual(outcome.transaction, { successfulWrites: 1, aborted: true });
  assert.equal(outcome.cacheReferenceUnchanged, true); assert.deepEqual(outcome.after, before); assert.deepEqual(outcome.freshAfter, before); assert.deepEqual(outcome.rawAfter, outcome.rawBefore);
  await page.reload(); await page.waitForFunction(() => window.p5?.ready); assert.deepEqual(await snapshot(page), before);
  return outcome;
});

check('native-prepared-copy-is-parsed-once-and-retries-the-same-candidate-after-abort', async ({ page }) => {
  await seed(page);
  const literal = await readFile(new URL('./fixtures/backup.json', import.meta.url), 'utf8');
  const evidence = await page.evaluate(async json => {
    const { store, readRaw, createStore, faults } = window.p5;
    const before = await store.readSnapshot(), rawBefore = await readRaw();
    const parse = JSON.parse;
    let parses = 0;
    JSON.parse = function (value, ...args) { if (value === json) parses++; return parse.call(this, value, ...args); };
    try {
      const candidate = store.prepareImport(json);
      const rawAfterPreview = await readRaw();
      let foreign, failure, consumed;
      try { await createStore().restorePrepared(candidate); } catch (error) { foreign = error.code; }
      faults.arm(2);
      try { await store.restorePrepared(candidate); } catch (error) { failure = error.code; }
      const transaction = faults.last();
      const afterAbort = await store.readSnapshot(), rawAfterAbort = await readRaw();
      const restored = await store.restorePrepared(candidate);
      const publishedCandidate = restored.snapshot === candidate.snapshot && await store.readSnapshot() === restored.snapshot;
      try { await store.restorePrepared(candidate); } catch (error) { consumed = error.code; }
      await store.close();
      const reopened = await store.readSnapshot({ fresh: true });
      return { parses, foreign, failure, consumed, transaction, publishedCandidate, cachedUnchanged: before === afterAbort,
        rawBefore, rawAfterPreview, rawAfterAbort, reopened };
    } finally { JSON.parse = parse; }
  }, literal);
  assert.equal(evidence.parses, 1);
  assert.equal(evidence.foreign, 'INVALID_BACKUP'); assert.equal(evidence.consumed, 'INVALID_BACKUP');
  assert.equal(evidence.failure, 'STORAGE_FAILURE'); assert.deepEqual(evidence.transaction, { successfulWrites: 2, aborted: true });
  assert.equal(evidence.cachedUnchanged, true); assert.equal(evidence.publishedCandidate, true);
  assert.deepEqual(evidence.rawAfterPreview, evidence.rawBefore); assert.deepEqual(evidence.rawAfterAbort, evidence.rawBefore);
  assert.deepEqual(evidence.reopened, JSON.parse(literal));
  return { parses: evidence.parses, abortAfter: evidence.transaction.successfulWrites, sameCandidateRetried: true, currentSchemaReopened: true };
});

check('native-draft-checkpoint-attempts-other-records-after-abort-and-retries-the-failure', async ({ page }) => {
  const evidence = await page.evaluate(async () => {
    const { createPracticeDrafts } = await import('/src/app/practice-drafts.ts');
    const { createWriteQueue } = await import('/src/app/write-queue.ts');
    const { store, draft, readRaw } = window.p5;
    const first = draft('a'), second = draft('b');
    await store.upsertPracticeDraft(first); await store.upsertPracticeDraft(second);
    const queue = createWriteQueue(() => {});
    const drafts = createPracticeDrafts({ getStore: () => store, write: queue.run, onCommit() {}, onEntry() {} });
    drafts.reload((await store.readSnapshot()).practiceDrafts);
    drafts.edit('a', 'Пока не сохранено', 65); drafts.edit('b', 'Другая запись сохранилась', 66);
    const originalPut = IDBObjectStore.prototype.put;
    let successfulThenAborted = 0;
    IDBObjectStore.prototype.put = function (...args) {
      const request = originalPut.apply(this, args);
      const transaction = this.transaction;
      if (this.name === 'practiceDrafts' && args[0].id === 'a') request.addEventListener('success', () => { successfulThenAborted++; transaction.abort(); });
      return request;
    };
    try {
      let failure;
      try { await drafts.flush(); } catch (error) { failure = error.code; }
      await queue.flush();
      const failuresAfterFlush = queue.failureCount, exported = JSON.parse(await store.exportBackup()).practiceDrafts, raw = (await readRaw()).practiceDrafts;
      IDBObjectStore.prototype.put = originalPut;
      await queue.retry();
      const afterRetry = (await readRaw()).practiceDrafts;
      return { failure, failuresAfterFlush, successfulThenAborted, exported, raw, afterRetry, failuresAfterRetry: queue.failureCount };
    } finally { IDBObjectStore.prototype.put = originalPut; drafts.dispose(); }
  });
  assert.equal(evidence.failure, 'STORAGE_FAILURE'); assert.equal(evidence.successfulThenAborted, 1);
  assert.equal(evidence.failuresAfterFlush, 1); assert.deepEqual(evidence.exported, evidence.raw);
  assert.deepEqual(evidence.raw.map(draft => draft.note), ['Нативный черновик', 'Другая запись сохранилась']);
  assert.deepEqual(evidence.afterRetry.map(draft => draft.note), ['Пока не сохранено', 'Другая запись сохранилась']);
  assert.equal(evidence.failuresAfterRetry, 0);
  return evidence;
});

check('native-project-save-abort-rolls-back-project-and-selection-after-both-puts', async ({ page }) => {
  await seed(page);
  const evidence = await page.evaluate(async () => {
    const { createDefaultRhythmProject } = await import('/src/rhythm/model.ts');
    const store = window.p5.store;
    const date = '2026-11-08T22:30:00.000Z';
    const previous = createDefaultRhythmProject('previous-rhythm', 'Прежний ритм', date);
    const candidate = createDefaultRhythmProject('candidate-rhythm', 'Новый ритм', date);
    await store.changeRhythmLibrary({ kind: 'save', project: previous });
    const before = await store.readSnapshot(), rawBefore = await window.p5.readRaw();
    const observation = { projectPut: 0, selectionPut: 0, aborted: false };
    const prototype = IDBObjectStore.prototype, originalPut = prototype.put;
    prototype.put = function (...args) {
      const request = originalPut.apply(this, args);
      if (this.transaction.db.name !== 'bass-study') return request;
      if (this.name === 'rhythmProjects' && args[0]?.id === candidate.id) {
        request.addEventListener('success', () => { observation.projectPut++; });
      }
      if (this.name === 'preferences' && args[0] === candidate.id && args[1] === 'rhythm-selection') {
        request.addEventListener('success', () => {
          observation.selectionPut++;
          this.transaction.abort();
          observation.aborted = true;
        });
      }
      return request;
    };
    let failure;
    const change = { kind: 'save', project: candidate };
    try { await store.changeRhythmLibrary(change); }
    catch (error) { failure = { code: error.code, message: error.message }; }
    finally { prototype.put = originalPut; }
    const transaction = window.p5.faults.last();
    const cached = await store.readSnapshot(), rawAfter = await window.p5.readRaw(), fresh = await store.readSnapshot({ fresh: true });
    const receipt = await store.changeRhythmLibrary(change);
    const retried = await store.readSnapshot(), rawRetried = await window.p5.readRaw(), freshRetried = await store.readSnapshot({ fresh: true });
    return { before, rawBefore, failure, observation, transaction, sameCachedReference: before === cached, rawAfter, fresh, receipt, retried, rawRetried, freshRetried };
  });
  assert.equal(evidence.failure?.code, 'STORAGE_FAILURE');
  assert.deepEqual(evidence.observation, { projectPut: 1, selectionPut: 1, aborted: true });
  assert.deepEqual(evidence.transaction, { successfulWrites: 2, aborted: true });
  assert.equal(evidence.sameCachedReference, true);
  assert.deepEqual(evidence.rawAfter, evidence.rawBefore);
  assert.deepEqual(evidence.fresh, evidence.before);
  assert.equal(evidence.retried.activeRhythmProjectId, 'candidate-rhythm');
  assert.deepEqual(evidence.receipt, { change: { kind: 'save', project: evidence.retried.rhythmProjects[0] }, activeId: 'candidate-rhythm' });
  assert.deepEqual(evidence.retried.rhythmProjects.map(project => project.id), ['candidate-rhythm', 'previous-rhythm']);
  assert.deepEqual(evidence.retried, evidence.freshRetried);
  assert.equal(evidence.rawRetried.activeRhythmProjectId, evidence.retried.activeRhythmProjectId);
  assert.deepEqual(evidence.rawRetried.rhythmProjects, evidence.retried.rhythmProjects);
  return evidence;
});

check('native-exercise-and-check-writes-abort-after-put-then-export-restore-roundtrip', async ({ page, freshPage, closeContext, fixtureUrl }) => {
  const before = await seed(page);
  const evidence = await page.evaluate(async () => {
    const { store, faults, readRaw, exercise, exercisePass, check } = window.p5;
    const cachedBefore = await store.readSnapshot(), rawBefore = await readRaw();
    const failures = {};
    // Отказ после уже успешного put: кеш и база остаются прежними, повтор записывает ровно одну запись.
    faults.arm(1);
    try { await store.saveExercise(exercise('aborted-exercise', 'Отменённое упражнение')); } catch (error) { failures.exercise = { code: error.code, ...faults.last() }; }
    const afterExercise = { sameCache: await store.readSnapshot() === cachedBefore, raw: await readRaw(), fresh: await store.readSnapshot({ fresh: true }) };
    const cachedAgain = await store.readSnapshot();
    faults.arm(1);
    try { await store.addHistory(check('aborted-check')); } catch (error) { failures.check = { code: error.code, ...faults.last() }; }
    const afterCheck = { sameCache: await store.readSnapshot() === cachedAgain, raw: await readRaw() };
    // Строгий отказ до записи: лишнее поле и чужая ступень не доходят до базы.
    const refusals = [];
    for (const write of [
      () => store.saveExercise({ ...exercise('extra-field'), preferences: {} }),
      () => store.addHistory({ ...check('foreign-degree'), result: { ...check('foreign-degree').result, answers: [{ degree: '3', outcome: 'correct', errors: 0 }] } }),
      () => store.addHistory({ ...exercisePass('no-assessment'), result: { ...exercisePass('no-assessment').result, assessment: null } }),
    ]) { try { await write(); refusals.push(null); } catch (error) { refusals.push(error.code); } }
    const afterRefusals = await readRaw();
    await store.saveExercise(exercise('aborted-exercise', 'Отменённое упражнение'));
    await store.addHistory(check('aborted-check'));
    await store.addHistory(exercisePass('fixture-exercise-pass', 'slow'));
    const cached = await store.readSnapshot(), fresh = await store.readSnapshot({ fresh: true });
    return { failures, rawBefore, afterExercise, afterCheck, refusals, afterRefusals, cachedMatchesFresh: JSON.stringify(cached) === JSON.stringify(fresh), fresh, json: await store.exportBackup() };
  });
  assert.deepEqual(evidence.failures, { exercise: { code: 'STORAGE_FAILURE', successfulWrites: 1, aborted: true }, check: { code: 'STORAGE_FAILURE', successfulWrites: 1, aborted: true } });
  assert.equal(evidence.afterExercise.sameCache, true); assert.deepEqual(evidence.afterExercise.raw, evidence.rawBefore); assert.deepEqual(evidence.afterExercise.fresh, before);
  assert.equal(evidence.afterCheck.sameCache, true); assert.deepEqual(evidence.afterCheck.raw, evidence.rawBefore);
  assert.deepEqual(evidence.refusals, ['INVALID_DATA', 'INVALID_DATA', 'INVALID_DATA']); assert.deepEqual(evidence.afterRefusals, evidence.rawBefore);
  assert.equal(evidence.cachedMatchesFresh, true);
  assert.deepEqual(evidence.fresh.exercises.map(item => item.id), ['aborted-exercise', 'fixture-exercise-a', 'fixture-exercise-b']);
  const check = evidence.fresh.history.find(entry => entry.result.kind === 'check');
  assert.equal(check.id, 'aborted-check'); assert.equal(check.result.source, 'screen-check'); assert.equal(check.result.answers.length, 3);
  const pass = evidence.fresh.history.find(entry => entry.id === 'fixture-exercise-pass');
  assert.equal(pass.result.assessment, 'slow'); assert.equal(pass.result.material.kind, 'exercise'); assert.equal(pass.result.context, null);
  assert.ok(evidence.fresh.history.filter(entry => entry.result.kind === 'manual' && entry.result.material.kind !== 'exercise').every(entry => entry.result.assessment === null));
  const clean = await freshPage(fixtureUrl);
  try {
    await clean.page.evaluate(async json => { const { store } = window.p5; await store.restorePrepared(store.prepareImport(json)); }, evidence.json);
    const restored = await snapshot(clean.page);
    assert.deepEqual(restored, evidence.fresh); assert.equal(JSON.stringify(restored), evidence.json);
    const raw = await clean.page.evaluate(() => window.p5.readRaw());
    assert.deepEqual(raw.exercises, restored.exercises); assert.deepEqual(raw.history, restored.history);
  } finally { await closeContext(clean.context); }
  return { failures: evidence.failures, refusals: evidence.refusals, exercises: evidence.fresh.exercises.length, history: evidence.fresh.history.map(entry => entry.result.kind), restoredInCleanContext: true };
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
          const transaction = window.p5.faults.last(); const after = await store.readSnapshot();
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
      return { failure: null, attempts: 64, boundedAt: 64, interAttemptDelayMs: 550, elapsedMs: Math.round(performance.now() - startedAt), priorCommittedIds, baseline, rawBaseline, transaction: window.p5.faults.last() };
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
    try { await other.savePreferences({ ...first.preferences, play: { ...first.preferences.play, bpm: 109 } }); }
    finally { await other.close(); }
    const known = await store.readSnapshot(); const refreshed = await store.readSnapshot({ fresh: true }); const cachedRefreshed = await store.readSnapshot();
    await store.close(); const reopened = await store.readSnapshot();
    return { sameCachedReference: first === second, externalWriteDoesNotPretendAutoSync: known === first,
      cacheIsFrozen: Object.isFrozen(first) && Object.isFrozen(first.preferences) && Object.isFrozen(first.history),
      knownBpm: known.preferences.play.bpm, refreshedBpm: refreshed.preferences.play.bpm,
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
        exercises: fresh.exercises.length, history: fresh.history.length, bpm: fresh.preferences.play.bpm });
    }
    try {
      const preferences = (await store.readSnapshot()).preferences;
      await verify('savePreferences', () => store.savePreferences({ ...preferences, play: { ...preferences.play, bpm: 108 } }));
      await verify('saveExercise', () => store.saveExercise(window.p5.exercise('cache-exercise', 'Кеш после commit')));
      await verify('addHistory', () => store.addHistory(window.p5.manual('cache-history')));
      await verify('deleteExercise', () => store.deleteExercise('fixture-exercise-b'));
      await verify('deleteHistory', () => store.deleteHistory('fixture-screen'));
      await verify('restore', () => store.restorePrepared(store.prepareImport(JSON.stringify(window.p5.emptySnapshot()))));
      return rows;
    } finally { for (const [name, original] of Object.entries(originals)) prototype[name] = original; }
  });
  for (const operation of operations) {
    assert.deepEqual(operation.callsBeforeFresh, { get: 0, getAll: 0, openCursor: 0 }, operation.name);
    assert.ok(operation.explicitFreshCalls.getAll >= 2, operation.name); assert.equal(operation.referenceChanged, true, operation.name);
    assert.equal(operation.frozen, true); assert.equal(operation.cacheMatchesFresh, true, operation.name);
  }
  assert.equal(operations[0].bpm, 108); assert.equal(operations[1].exercises, 3); assert.equal(operations[2].history, 3);
  assert.equal(operations[3].exercises, 2); assert.equal(operations[4].history, 2); assert.equal(operations[5].history, 0); assert.equal(operations[5].exercises, 0);
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
  assert.equal(cleared.cacheWasInvalidated, true); assert.deepEqual(cleared.current.history, []); assert.deepEqual(cleared.current.exercises, []);
  assert.deepEqual(cleared.current, cleared.fresh); assert.deepEqual(cleared.raw.history, []);
  await page.evaluate(() => window.p5.store.addHistory(window.p5.manual('after-unexpected-close')));
  const recovered = await snapshot(page); assert.deepEqual(recovered.history.map(entry => entry.id), ['after-unexpected-close']);
  return { clearedOnlyIsolatedOrigin: fixtureOrigin, observedRealDatabaseClose: true, cleared, recoveredIds: recovered.history.map(entry => entry.id) };
});

// Product scenarios follow the visible storage controls of the P13 shell; no product test API is used.
// Copy and restore live in «Настройки → Данные», drafts, history and error review in «Прогресс»,
// screen tasks in «Проверь себя» (opened from the «Гриф» atlas), manual practice clocks in «Ритм».

async function fixtureBackup(page, fixtureUrl) {
  const tab = await page.context().newPage();
  try { await tab.goto(fixtureUrl); await tab.waitForFunction(() => window.p5?.ready); return await tab.evaluate(() => window.p5.seedSnapshot()); }
  finally { await tab.close(); await page.bringToFront(); }
}
async function fixtureValue(page, fixtureUrl, expression) {
  const tab = await page.context().newPage();
  try { await tab.goto(fixtureUrl); await tab.waitForFunction(() => window.p5?.ready); return await tab.evaluate(expression); }
  finally { await tab.close(); await page.bringToFront(); }
}
/** Копия, которую «Настройки» скачивают без изменения: раздел меню уже `settings`. */
const inSettings = copy => ({ ...copy, preferences: { ...copy.preferences, activeModule: 'settings' } });
async function confirmImport(page, value) { await restoreCopy(page, value); }
checks.push(...p12CompositionChecks({ confirmImport, rawSnapshot, ready }));

check('ui-settings-reload-and-download-export', async ({ page }) => {
  await ready(page);
  const settings = await openSettingsPane(page, 'lesson');
  const countIn = settings.locator('[data-switch="countIn"]');
  assert.equal(await countIn.getAttribute('aria-checked'), 'true');
  await countIn.click(); assert.equal(await countIn.getAttribute('aria-checked'), 'false');
  await settings.getByRole('button', { name: /^Быстрее на/ }).click();
  const bpm = Number(await settings.locator('[data-bpm-out]').innerText()); assert.ok(bpm > 72);
  await settings.locator('[data-set="labels"][data-value="degrees"]').click();
  await go(page, 'foundation'); await page.locator('[data-label-mode="degrees"]').click();
  const exported = await exportUi(page);
  assert.equal(exported.schemaVersion, 11); assert.deepEqual(exported.exercises, []);
  assert.deepEqual(exported.preferences.play, { ...exported.preferences.play, countIn: false, bpm, labels: 'degree' });
  assert.equal(exported.preferences.study.labelMode, 'degrees');
  const raw = await rawSnapshot(page);
  assert.equal(raw.profile, undefined, 'Nothing has written the profile yet; the copy carries the default profile');
  assert.deepEqual(withoutSection({ ...raw, profile: exported.profile }), withoutSection(exported), 'Downloaded copy equals the confirmed native database');
  await page.reload(); await ready(page);
  assert.equal(await currentSection(page), 'foundation', 'The section chosen last survives reload');
  assert.equal(await page.locator('[data-label-mode="degrees"]').getAttribute('aria-pressed'), 'true');
  const reopened = await openSettingsPane(page, 'lesson');
  assert.equal(await reopened.locator('[data-switch="countIn"]').getAttribute('aria-checked'), 'false');
  assert.equal(await reopened.locator('[data-bpm-out]').innerText(), String(bpm));
  assert.equal(await reopened.locator('[data-set="labels"][data-value="degrees"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(withoutSection(await exportUi(page)), withoutSection(exported));
  return { exportedPlay: exported.preferences.play, labelMode: exported.preferences.study.labelMode, survivedReload: true };
}, { scope: 'ui' });

check('ui-finger-display-setting-survives-reload-and-backup-restore', async ({ page }) => {
  await ready(page); await go(page, 'foundation');
  const fingers = page.locator('#show-fingers');
  if (!await page.locator('#study-settings').isVisible()) await page.locator('#toggle-study-settings').click();
  if (!await page.locator('#display-settings').evaluate(element => element.open)) await page.locator('#display-settings > summary').click();
  await fingers.check();
  await waitRaw(page, db => db.preferences?.study.showFingers === true, 'номера пальцев');
  const expected = inSettings(await exportUi(page));
  assert.equal(expected.preferences.study.showFingers, true); assert.equal(expected.preferences.study.box.shapeId, 'penta-a');
  await page.reload(); await ready(page); await go(page, 'foundation');
  if (!await page.locator('#study-settings').isVisible()) await page.locator('#toggle-study-settings').click();
  if (!await page.locator('#display-settings').evaluate(element => element.open)) await page.locator('#display-settings > summary').click();
  assert.ok(await fingers.isChecked());
  await fingers.uncheck(); await waitRaw(page, db => db.preferences?.study.showFingers === false, 'пальцы выключены');
  await confirmImport(page, expected);
  assert.deepEqual(await rawSnapshot(page), expected, 'Restored copy replaces the native database');
  await go(page, 'foundation');
  if (!await page.locator('#study-settings').isVisible()) await page.locator('#toggle-study-settings').click();
  if (!await page.locator('#display-settings').evaluate(element => element.open)) await page.locator('#display-settings > summary').click();
  assert.ok(await fingers.isChecked(), 'Restored setting is applied to the visible atlas');
  return { initialBox: expected.preferences.study.box, displayStoredIndependently: true, reloadAndRestore: true };
}, { scope: 'ui' });

check('ui-user-text-in-history-stays-text-not-markup', async ({ page, fixtureUrl }) => {
  await ready(page);
  const markup = '<img src=x onerror="window.__u1=2">';
  const incoming = inSettings(await fixtureBackup(page, fixtureUrl));
  incoming.history = incoming.history.map(entry => entry.result.kind === 'manual' ? { ...entry, result: { ...entry.result, note: `Заметка ${markup}` } } : entry);
  const filename = `${markup}.json`;
  const preview = await previewCopy(page, incoming, filename);
  assert.equal(preview.rejected, false);
  assert.ok((await preview.dialog.innerText()).includes(filename), 'The file name is shown literally');
  assert.equal(await preview.dialog.locator('img').count(), 0);
  await replaceCopy(page, preview);
  await go(page, 'progress');
  await progressPage(page).locator('[data-tab="calendar"]').click();
  const day = progressPage(page).locator('[data-day="2026-11-09"]');
  if (await day.count()) await day.click();
  const note = progressPage(page).locator('.pg-entry-note');
  await note.first().waitFor();
  assert.ok((await note.first().innerText()).includes(markup), 'The history note is shown literally');
  const injected = await page.evaluate(() => ({ images: document.querySelectorAll('[data-page-frame="progress"] img, [data-page-frame="settings"] img, dialog img').length, flag: window.__u1 ?? null }));
  assert.deepEqual(injected, { images: 0, flag: null });
  return { importFilenameIsText: true, historyNoteIsText: true, injected };
}, { scope: 'ui' });

check('ui-import-preview-cancel-confirm-and-full-replacement', async ({ page, fixtureUrl }) => {
  await ready(page);
  const incoming = inSettings(await fixtureBackup(page, fixtureUrl));
  const before = await rawSnapshot(page);
  const preview = await previewCopy(page, incoming, 'fixture-copy.json');
  const rows = await preview.dialog.locator('table.st-cmp tbody tr').evaluateAll(list => list.map(row => [...row.children].map(cell => cell.textContent.trim())));
  assert.deepEqual(rows.find(row => row[0] === 'История занятий'), ['История занятий', '2', '0']);
  assert.deepEqual(rows.find(row => row[0] === 'Свои упражнения'), ['Свои упражнения', '2', '0']);
  assert.match(await preview.dialog.innerText(), /Предпросмотр ничего не изменил/);
  assert.deepEqual(withoutSection(await rawSnapshot(page)), withoutSection(before), 'Preview leaves the native database unchanged');
  await cancelCopy(page, preview);
  assert.equal(await settingsDialog(page).evaluate(element => element.open), false);
  assert.deepEqual(withoutSection(await rawSnapshot(page)), withoutSection(before), 'Cancel leaves the native database unchanged');
  const confirmed = await previewCopy(page, incoming, 'fixture-copy.json');
  assert.equal((await replaceCopy(page, confirmed)).step, 'done');
  assert.deepEqual(await rawSnapshot(page), incoming, 'Confirmed restore replaces every store');
  const restored = await exportUi(page); assert.deepEqual(restored, incoming, 'The UI copy downloads the restored data');
  await go(page, 'progress'); assert.equal(await progressPage(page).locator('.pg-empty').count(), 0, '«Прогресс» shows restored history');
  await page.reload(); await ready(page);
  assert.equal(await currentSection(page), 'progress');
  assert.deepEqual(withoutSection(await rawSnapshot(page)), withoutSection(incoming));
  return { previewRows: rows, previewDidNotWrite: true, cancelled: true, survivedReload: true };
}, { scope: 'ui' });

check('ui-draft-abort-still-downloads-confirmed-bytes-and-offers-retry', async ({ page, fixtureUrl }) => {
  await ready(page);
  const incoming = inSettings(await fixtureBackup(page, fixtureUrl));
  incoming.practiceDrafts = [await fixtureValue(page, fixtureUrl, () => window.p5.draft('storage-draft'))];
  await confirmImport(page, incoming);
  const box = await openDrafts(page);
  const note = draftCard(page, 'storage-draft').locator('[data-draft-field="note"]');
  await note.fill('Подтверждённая заметка');
  await waitRaw(page, db => db.practiceDrafts[0]?.note === 'Подтверждённая заметка', 'заметка черновика');
  const confirmed = await exportDownload(page, { stay: true });
  assert.equal(confirmed.copy.practiceDrafts[0].note, 'Подтверждённая заметка');
  assert.match(confirmed.notice, /^Копия скачана/); assert.doesNotMatch(confirmed.notice, /только сохранённые/);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.storageProbe = { abortedAfterPut: 0, restore() { IDBObjectStore.prototype.put = put; } };
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args), transaction = this.transaction;
      if (this.name === 'practiceDrafts' && args[0].note === 'Изменение после отказа') request.addEventListener('success', () => {
        window.storageProbe.abortedAfterPut++; transaction.abort();
      });
      return request;
    };
  });
  let refused;
  try {
    await go(page, 'progress');
    await note.fill('Изменение после отказа');
    refused = await exportDownload(page, { stay: true });
    assert.ok(refused.bytes.equals(confirmed.bytes), 'Only confirmed bytes are exported after the aborted put');
    assert.match(refused.notice, /вошли только сохранённые данные/);
    assert.ok(await page.evaluate(() => window.storageProbe.abortedAfterPut) > 0);
    const banner = settingsPage(page).locator('[data-banners] [role="alert"]');
    await banner.waitFor(); assert.match(await banner.innerText(), /Не сохранилось/);
    assert.equal((await rawSnapshot(page)).practiceDrafts[0].note, 'Подтверждённая заметка', 'The aborted put left the confirmed draft');
  } finally { await page.evaluate(() => window.storageProbe.restore()); }
  // Диагностика редкого сбоя: кнопка повтора отсоединялась 7 с подряд. Считаем перерисовки баннеров до нажатия.
  await page.evaluate(() => {
    const box = document.querySelector('[data-page-frame="settings"] [data-banners]');
    window.bannerRenders = []; new MutationObserver(() => window.bannerRenders.push(`${Math.round(performance.now())}: ${box.textContent.slice(0, 80)}`)).observe(box, { childList: true });
  });
  await settingsPage(page).locator('[data-retry]').click().catch(async failure => {
    const renders = await page.evaluate(() => ({ count: window.bannerRenders.length, last: window.bannerRenders.slice(-4), status: document.getElementById('local-save-status')?.textContent }));
    throw new Error(`DIAG ${JSON.stringify(renders)} ${failure.message}`);
  });
  await settingsPage(page).locator('[data-banners] [role="alert"]').waitFor({ state: 'detached' });
  const recovered = await exportDownload(page, { stay: true });
  assert.equal(recovered.copy.practiceDrafts[0].note, 'Изменение после отказа');
  assert.doesNotMatch(recovered.notice, /только сохранённые/);
  await go(page, 'progress'); assert.equal(await box.isVisible(), true);
  return { confirmedBytesPreserved: true, refusedNotice: refused.notice, retryRecoveredNote: true };
}, { scope: 'ui' });

check('ui-restore-waits-for-successful-preliminary-writes-and-retries-after-save-repair', async ({ page }) => {
  await ready(page);
  const original = await exportUi(page, { stay: true });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.restoreProfileWrites = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args), transaction = this.transaction;
      if (this.name === 'profile') request.addEventListener('success', () => transaction.abort());
      return request;
    };
  });
  const look = await openSettingsPane(page, 'look');
  await look.locator('[data-theme-choice="dark"]').click();
  const banner = settingsPage(page).locator('[data-banners] [role="alert"]');
  await banner.waitFor();
  const before = await rawSnapshot(page);
  const preview = await previewCopy(page, original);
  const failed = await replaceCopy(page, preview);
  assert.deepEqual(failed, { step: 'failed', text: 'Текущие изменения не сохранены. Повтори сохранение перед восстановлением. Сохранённое осталось прежним.' });
  assert.deepEqual(await rawSnapshot(page), before, 'Refused restore keeps the confirmed data');
  await page.evaluate(() => window.restoreProfileWrites());
  await preview.dialog.locator('[data-dlg="close"]').click();
  await openData(page);
  await settingsPage(page).locator('[data-retry]').click();
  await banner.waitFor({ state: 'detached' });
  assert.equal((await rawSnapshot(page)).profile.theme, 'dark');
  await restoreCopy(page, original);
  assert.deepEqual(await rawSnapshot(page), original);
  return { restoreBlockedOnFailedProfileWrite: true, refusal: failed.text, retriedAfterSaveRepair: true };
}, { scope: 'ui' });

check('ui-preview-and-cancel-leave-active-practice-and-native-data-untouched', async ({ page }) => {
  // Isolate the action from the independent five-second automatic checkpoint.
  await page.addInitScript(() => {
    const interval = window.setInterval;
    window.setInterval = function (callback, ms, ...args) {
      return interval.call(this, ms === 5000 ? () => {} : callback, ms, ...args);
    };
  });
  await page.reload(); await ready(page);
  const previous = await exportUi(page, { stay: true });
  await go(page, 'harmony');
  await rhythmRoot(page).locator('[data-rhythm-action="start"]').click(); await rhythmWait(page, 'running');
  await delay(300);
  const preview = await previewCopy(page, previous);
  assert.equal(await rhythmState(page), 'paused', 'Leaving «Ритм» pauses the practice instead of ending it');
  const before = await rawSnapshot(page);
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    window.storagePreviewWrites = 0;
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      if (mode === 'readwrite') window.storagePreviewWrites++;
      return transaction.call(this, stores, mode, ...args);
    };
  });
  await preview.dialog.locator('[data-dlg="back"]').click();
  const again = await previewCopy(page, previous);
  await cancelCopy(page, again);
  assert.equal(await page.evaluate(() => window.storagePreviewWrites), 0);
  assert.deepEqual(await rawSnapshot(page), before);
  await go(page, 'harmony');
  assert.equal(await rhythmState(page), 'paused', 'The paused practice is still there after preview and cancel');
  await rhythmRoot(page).locator('[data-rhythm-action="resume"]').click(); await rhythmWait(page, 'running');
  await rhythmRoot(page).locator('[data-rhythm-action="stop"]').click(); await rhythmWait(page, 'stopped');
  return { activePracticePreserved: 'paused', attributableReadwriteTransactions: 0 };
}, { scope: 'ui' });

check('ui-restore-after-nonzero-practice-does-not-add-old-clock-to-imported-draft', async ({ page }) => {
  await ready(page);
  await playRhythm(page, 650);
  const exported = inSettings(await exportUi(page));
  const oldDraft = exported.practiceDrafts.find(draft => draft.material.kind === 'rhythm' && draft.totalReferenceMs > 0);
  assert.ok(oldDraft); assert.equal(exported.history.length, 0);
  assert.equal(exported.profile.onboarding.choice, null, 'Starting practice must not silently record an onboarding choice');
  await playRhythm(page, 750);
  const later = await rawSnapshot(page);
  const grown = later.practiceDrafts.find(draft => draft.id === oldDraft.id);
  assert.ok(grown.totalReferenceMs >= oldDraft.totalReferenceMs + 500, `${grown.totalReferenceMs} after ${oldDraft.totalReferenceMs}`);
  await confirmImport(page, exported);
  assert.deepEqual(await rawSnapshot(page), exported);
  await go(page, 'harmony'); assert.equal(await rhythmState(page), 'stopped');
  await page.reload(); await ready(page);
  assert.deepEqual(withoutSection(await rawSnapshot(page)), withoutSection(exported));
  return { exportedReferenceMs: oldDraft.totalReferenceMs, laterReferenceMs: grown.totalReferenceMs,
    importedSnapshotUnchanged: true, staleAudioClockNotAdded: true, nativeUiRestoreAndReload: true };
}, { scope: 'ui' });

check('ui-invalid-import-shows-error-and-preserves-valid-data', async ({ page, fixtureUrl }) => {
  await ready(page);
  const incoming = inSettings(await fixtureBackup(page, fixtureUrl)); await confirmImport(page, incoming);
  const before = await rawSnapshot(page);
  const mutations = [
    ['broken.json', '{broken', 'Это не копия тренажёра'],
    ['previous.json', JSON.stringify({ ...incoming, schemaVersion: 10 }), 'Эта копия не подходит'],
    ['future.json', JSON.stringify({ ...incoming, schemaVersion: 12 }), 'Эта копия не подходит'],
    ['corrupt.json', (() => { const value = structuredClone(incoming); value.history.find(entry => entry.result.kind === 'screen').result.questions[0].errors = 0; return JSON.stringify(value); })(), 'Это не копия тренажёра'],
  ];
  const errors = [];
  for (const [name, json, title] of mutations) {
    const preview = await previewCopy(page, json, name);
    assert.equal(preview.rejected, true, name);
    assert.equal(await preview.dialog.locator('h2').innerText(), title, name);
    const text = await preview.dialog.innerText();
    assert.match(text, /Ничего не изменилось/); assert.ok(text.includes(name));
    errors.push({ name, title, text: text.replace(/\s+/g, ' ').slice(0, 300) });
    await cancelCopy(page, preview);
    assert.deepEqual(await rawSnapshot(page), before, name);
  }
  return { errors, retainedHistory: before.history.length };
}, { scope: 'ui' });

check('ui-completed-screen-result-is-saved-once-and-survives-preference-changes', async ({ page }) => {
  await ready(page);
  const host = await openFormCheck(page, 'name-note');
  assert.equal(await checkProgress(page), 'Вопрос 1 из 6');
  const first = await nameNoteQuestion(page);
  await answerChoice(page, first.wrong); await answerChoice(page, first.choice);
  assert.match(await host.locator('[data-ck-feedback]').innerText(), /^Верно, с исправлением \(ошибок: 1\)/);
  await host.locator('[data-act="next"]').click();
  for (let index = 1; index < 6; index++) await answerNameNoteCorrectly(page);
  await host.locator('[data-ck-summary]').waitFor();
  const saved = await waitRaw(page, db => db.history.length === 1 && db.history[0].result.questions.length === 6 && db.history[0].result.questions.every(question => question.outcome !== 'interrupted'), 'законченная серия');
  const entry = saved.history[0];
  assert.equal(entry.result.kind, 'screen'); assert.equal(entry.result.source, 'screen-input'); assert.equal(entry.result.mode, 'name-note');
  assert.equal(entry.result.questions[0].targetPositionId, first.positionId);
  assert.equal(entry.result.questions[0].errors, 1); assert.equal(entry.result.questions[0].corrected, true); assert.equal(entry.result.questions[0].independentCorrect, false);
  assert.deepEqual(entry.result.questions.slice(1).map(question => question.independentCorrect), [true, true, true, true, true]);
  const settings = await openSettingsPane(page, 'lesson');
  await settings.getByRole('button', { name: /^Медленнее на/ }).click();
  await go(page, 'foundation'); await page.locator('[data-label-mode="degrees"]').click();
  await waitRaw(page, db => db.preferences.study.labelMode === 'degrees', 'подписи ступенями');
  const changed = await exportUi(page); assert.deepEqual(changed.history, saved.history);
  await page.reload(); await ready(page); assert.deepEqual((await rawSnapshot(page)).history, saved.history);
  return { entry: { id: entry.id, mode: entry.result.mode, first: entry.result.questions[0].outcome, context: entry.result.context }, savedOnce: true, preferenceChangePreservedHistory: true };
}, { scope: 'ui' });

check('ui-lazy-progress-stays-unbuilt-while-hidden-and-partial-upsert-keeps-one-id', async ({ page }) => {
  await ready(page);
  await go(page, 'progress'); await go(page, 'lesson');
  await page.evaluate(() => {
    window.progressMutations = 0;
    new MutationObserver(list => { window.progressMutations += list.length; }).observe(document.querySelector('#progress-mount'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] });
  });
  const host = await openFormCheck(page, 'name-note');
  const first = await nameNoteQuestion(page);
  await answerChoice(page, first.wrong);
  const initial = await waitRaw(page, db => db.history.length === 1, 'запись после первого ответа');
  const id = initial.history[0].id;
  assert.equal(initial.history[0].result.questions[0].outcome, 'interrupted'); assert.equal(initial.history[0].result.questions[0].errors, 1);
  await answerChoice(page, first.choice); await host.locator('[data-act="next"]').click();
  await answerNameNoteCorrectly(page);
  const partial = await waitRaw(page, db => db.history[0]?.result.questions[1]?.outcome === 'correct', 'второй ответ');
  assert.equal(partial.history.length, 1); assert.equal(partial.history[0].id, id, 'Upsert keeps the session ID');
  assert.equal(partial.history[0].result.questions[0].outcome, 'corrected'); assert.equal(partial.history[0].result.questions[0].independentCorrect, false);
  assert.equal(await page.evaluate(() => window.progressMutations), 0, 'Hidden «Прогресс» does not rebuild after each answer');
  await host.locator('[data-act="finish"]').click(); await host.locator('[data-ck-summary]').waitFor();
  const finished = await waitRaw(page, db => db.history[0]?.result.questions.length >= 2 && db.history[0].result.questions.every(question => question.outcome !== 'interrupted'), 'досрочное завершение');
  assert.equal(finished.history.length, 1); assert.equal(finished.history[0].id, id);
  assert.deepEqual(finished.history[0].result.questions.map(question => question.outcome).slice(0, 2), ['corrected', 'correct']);
  assert.equal(await page.evaluate(() => window.progressMutations), 0, 'Finishing the series does not build hidden «Прогресс» either');
  await go(page, 'progress');
  const review = progressPage(page).locator('[data-repeat-errors]').first();
  await review.waitFor();
  assert.match(await review.getAttribute('aria-label'), /^Повторить в «Проверь себя»/);
  const mutationsOnOpen = await page.evaluate(() => window.progressMutations);
  assert.ok(mutationsOnOpen > 0, 'Opening «Прогресс» renders the latest own commits');
  return { sameSessionHistoryId: id, hiddenProgressMutations: 0, mutationsOnOpen, outcomes: finished.history[0].result.questions.map(question => question.outcome) };
}, { scope: 'ui' });

check('ui-manual-practice-has-self-report-source-and-consumes-duration', async ({ page }) => {
  await ready(page);
  await playRhythm(page, 700);
  const box = await openDrafts(page);
  const card = box.locator('[data-draft]').first();
  assert.match(await card.innerText(), /Ручная отметка · Ритм/);
  await card.locator('[data-draft-field="bpm"]').fill('72');
  await card.locator('[data-draft-field="note"]').fill('Играю вместе с эталоном; это моя оценка.');
  await card.locator('[data-draft-save]').click();
  await box.waitFor({ state: 'hidden' });
  const first = await waitRaw(page, db => db.history.length === 1, 'ручная отметка');
  const entry = first.history[0];
  assert.equal(entry.result.kind, 'manual'); assert.equal(entry.result.source, 'self-report'); assert.equal(entry.result.comfortableBpm, 72);
  assert.equal(entry.result.material.kind, 'rhythm'); assert.equal(entry.result.context, null);
  assert.ok(entry.result.durationMs > 0 && entry.result.durationMs < 3000, `${entry.result.durationMs}`);
  assert.ok(!Object.hasOwn(entry.result, 'accuracy'));
  const draft = first.practiceDrafts.find(item => item.material.kind === 'rhythm');
  assert.equal(draft.recordedThroughMs, entry.result.durationMs); assert.equal(draft.totalReferenceMs, draft.recordedThroughMs, 'Saved time is consumed');
  assert.match(await progressPage(page).locator('.pg-note').innerText(), /ставишь ты/);
  await playRhythm(page, 400);
  const card2 = (await openDrafts(page)).locator('[data-draft]').first();
  await card2.locator('[data-draft-save]').click();
  await box.waitFor({ state: 'hidden' });
  const second = await waitRaw(page, db => db.history.length === 2, 'вторая отметка');
  const extra = second.history.find(item => item.id !== entry.id);
  const total = second.practiceDrafts.find(item => item.id === draft.id);
  assert.ok(extra.result.durationMs > 0 && extra.result.durationMs < 2000);
  assert.equal(total.recordedThroughMs, entry.result.durationMs + extra.result.durationMs, 'No double-counted duration');
  await page.reload(); await ready(page); assert.equal((await rawSnapshot(page)).history.length, 2);
  return { first: { durationMs: entry.result.durationMs, bpm: entry.result.comfortableBpm, title: entry.result.material.kind }, second: extra.result.durationMs, recordedThroughMs: total.recordedThroughMs };
}, { scope: 'ui' });

check('ui-history-filters-and-exact-error-review-subset-preserve-original-context', async ({ page, fixtureUrl, resultDir }) => {
  await ready(page);
  const incoming = inSettings(await fixtureBackup(page, fixtureUrl)); await confirmImport(page, incoming);
  await go(page, 'progress');
  const progress = progressPage(page);
  const review = progress.locator('[data-repeat-errors]').first();
  await progress.locator('[data-source="play"]').click();
  assert.equal(await progress.locator('[data-repeat-errors]').count(), 0, 'The screen-task review is not a play source');
  await progress.locator('[data-source="check"]').click(); await review.waitFor();
  await progress.locator('[data-source="all"]').click(); await review.waitFor();
  const original = incoming.history.find(entry => entry.result.kind === 'screen');
  const expectedId = original.result.questions[0].targetPositionId;
  await review.click();
  const host = checkHost(page);
  await page.locator('[data-lesson-screen="check"]:not([hidden]) [data-ck-title]').waitFor();
  assert.equal(await currentSection(page), 'lesson');
  assert.equal(await host.locator('h1').innerText(), 'Проверь себя: повтор ошибок');
  assert.ok(await host.locator('[data-kind]').isDisabled(), 'The review fixes the question kind');
  const question = await nameNoteQuestion(page);
  assert.equal(question.positionId, expectedId, 'Only the original wrong position is asked');
  await answerChoice(page, question.choice);
  const after = await waitRaw(page, db => db.history.length === 3, 'запись повтора');
  assert.deepEqual(after.history.find(entry => entry.id === original.id), original, 'The original record is unchanged');
  const repeat = after.history.find(entry => !incoming.history.some(item => item.id === entry.id));
  assert.deepEqual({ root: repeat.result.context.root, structureId: repeat.result.context.structureId, positionIds: repeat.result.context.positionIds },
    { root: original.result.context.root, structureId: original.result.context.structureId, positionIds: [expectedId] });
  await page.screenshot({ path: join(resultDir, 'p5-history-desktop.png'), fullPage: true });
  return { expectedId, originalContext: original.result.context, repeatContext: repeat.result.context, screenshot: 'test-results/p5-history-desktop.png' };
}, { scope: 'ui' });

check('ui-unavailable-indexeddb-falls-back-to-explicit-memory-and-export', async ({ page }) => {
  await ready(page);
  const details = page.getByRole('button', { name: 'Без сохранения · подробнее', exact: true });
  assert.equal(await details.isVisible(), true); assert.equal(await details.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#persistence-banner').isVisible(), false);
  await details.click(); assert.equal(await details.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#persistence-banner').isVisible(), true);
  const reason = await page.locator('#persistence-message').innerText();
  assert.match(reason, /памяти|не сохран/); assert.match(reason, /Браузерное хранилище недоступно/);
  const host = await openFormCheck(page, 'name-note');
  const first = await nameNoteQuestion(page); await answerChoice(page, first.choice);
  assert.match(await host.locator('[data-ck-feedback]').innerText(), /^Верно/);
  const exported = await exportUi(page); assert.equal(exported.history.length, 1); assert.equal(exported.history[0].result.source, 'screen-input');
  await page.reload(); await ready(page); assert.equal(await details.isVisible(), true); assert.equal(await details.getAttribute('aria-expanded'), 'false');
  assert.equal((await exportUi(page)).history.length, 0);
  return { explicitlyMemoryOnly: true, detailsOpenedByVisibleButton: true, reason, exportedRecords: exported.history.length, reloadClearedTemporaryHistory: true, nativePersistenceClaimed: false };
}, { scope: 'ui', memory: true });

markFullOnly(checks, [
  'native-full-browser-process-restart-keeps-original-history-date',
], FULL_ONLY.separateProcess);
markFullOnly(checks, [
  'composition-without-progress-retains-unavailable-schema11-data',
  'composition-without-tracks-retains-unavailable-schema11-data',
  'ui-finger-display-setting-survives-reload-and-backup-restore',
  'ui-draft-abort-still-downloads-confirmed-bytes-and-offers-retry',
  'ui-restore-waits-for-successful-preliminary-writes-and-retries-after-save-repair',
  'ui-preview-and-cancel-leave-active-practice-and-native-data-untouched',
  'ui-restore-after-nonzero-practice-does-not-add-old-clock-to-imported-draft',
  'ui-completed-screen-result-is-saved-once-and-survives-preference-changes',
  'ui-lazy-progress-stays-unbuilt-while-hidden-and-partial-upsert-keeps-one-id',
  'ui-manual-practice-has-self-report-source-and-consumes-duration',
  'ui-history-filters-and-exact-error-review-subset-preserve-original-context',
], FULL_ONLY.smoke);
await runStorageBrowserChecks(browserCases(checks).checks);
