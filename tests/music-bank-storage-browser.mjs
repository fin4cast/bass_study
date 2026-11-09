import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runTracksBrowserChecks } from './helpers/tracks-browser-harness.mjs';

const literalV6 = JSON.parse(await readFile(fileURLToPath(new URL('./fixtures/v6-backup.json', import.meta.url)), 'utf8'));
const checks = [];
const check = (name, run) => checks.push({ name, scope: 'native', run });
const storeNames = ['preferences', 'presets', 'history', 'profile', 'practiceDrafts'];
const expectedV8 = {
  ...literalV6, schemaVersion: 8, rhythmProjects: [], activeRhythmProjectId: null,
  preferences: { ...literalV6.preferences, musicBank: null, rhythm: null },
  presets: literalV6.presets.map(preset => ({ ...preset, preferences: { ...preset.preferences, musicBank: null, rhythm: null } })),
};
const metadataBank = {
  version: 1, file: { name: 'Нативный пример.gp4', relativePath: 'Банк/Нативный пример.gp4', size: 3, sha256: 'a'.repeat(64), title: 'Нативный пример', artist: 'Контрольный материал', trackCount: 2, barCount: 8 },
  tracks: [{ index: 0, name: 'Ударные A', visible: false, audible: true, solo: false, volume: .25 }, { index: 1, name: 'Ударные B', visible: true, audible: false, solo: true, volume: 1.5 }],
  speed: .75, master: .6, notation: { staff: false, tab: true }, follow: false, mixerOpen: true,
  range: { fromBar: 2, toBar: 6 }, loop: true,
};

// Независимое readonly-чтение; не импортирует продуктовый адаптер и не использует его кеш.
async function raw(page) {
  return page.evaluate(async names => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Readonly reader не должен создавать отсутствующую базу')); };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    try {
      const hasRhythm = db.objectStoreNames.contains('rhythmProjects');
      const transaction = db.transaction(hasRhythm ? [...names, 'rhythmProjects'] : names, 'readonly');
      const done = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
      const get = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [preferences, presets, history, profile, practiceDrafts, rhythmProjects, activeRhythmProjectId] = await Promise.all([
        get(transaction.objectStore('preferences').get('current')), get(transaction.objectStore('presets').getAll()),
        get(transaction.objectStore('history').getAll()), get(transaction.objectStore('profile').get('current')),
        get(transaction.objectStore('practiceDrafts').getAll()),
        hasRhythm ? get(transaction.objectStore('rhythmProjects').getAll()) : undefined,
        hasRhythm ? get(transaction.objectStore('preferences').get('rhythm-selection')) : undefined,
      ]);
      await done;
      return { version: db.version, stores: [...db.objectStoreNames], preferences, presets, history, profile, practiceDrafts,
        ...(hasRhythm ? { rhythmProjects, activeRhythmProjectId: activeRhythmProjectId ?? null } : {}) };
    } finally { db.close(); }
  }, storeNames);
}
function rawSnapshot(snapshot, version = 8) {
  const hasRhythm = version === 8;
  return { version, stores: [...storeNames, ...(hasRhythm ? ['rhythmProjects'] : [])].sort(), preferences: snapshot.preferences, presets: snapshot.presets, history: snapshot.history, profile: snapshot.profile, practiceDrafts: snapshot.practiceDrafts,
    ...(hasRhythm ? { rhythmProjects: snapshot.rhythmProjects, activeRhythmProjectId: snapshot.activeRhythmProjectId } : {}) };
}
async function readyProduct(page, origin) {
  await page.goto(origin);
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main?.getAttribute('aria-busy') === 'false' && !main.inert && /Сохранено локально|Только в памяти/.test(document.querySelector('#persistence-message')?.textContent ?? '');
  }, undefined, { timeout: 20000 });
}
async function seedNativeV6(page, origin) {
  // JSON-ресурс того же origin не запускает приложение и освобождает его IDB/lock.
  const response = await page.goto(`${origin}/vendor/music-bank/patch-manifest.json`);
  assert.equal(response.status(), 200, 'Нужна текущая product build с локальным vendor manifest');
  assert.match(response.headers()['content-type'], /application\/json/);
  assert.equal(await page.locator('#history-mount').count(), 0);
  return page.evaluate(async snapshot => {
    if (location.origin !== 'http://localhost:4173') throw new Error('Очистка допустима только на изолированном тестовом origin');
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('bass-study'); request.onsuccess = resolve;
      request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Test origin DB deletion blocked'));
    });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study', 6);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('preferences'); db.createObjectStore('presets', { keyPath: 'id' }); db.createObjectStore('history', { keyPath: 'id' });
        db.createObjectStore('profile'); db.createObjectStore('practiceDrafts', { keyPath: 'id' });
        const tx = request.transaction;
        tx.objectStore('preferences').put(snapshot.preferences, 'current'); tx.objectStore('profile').put(snapshot.profile, 'current');
        for (const key of ['presets', 'history', 'practiceDrafts']) for (const record of snapshot[key]) tx.objectStore(key).put(record);
      };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    const evidence = { version: db.version, stores: [...db.objectStoreNames] }; db.close(); return evidence;
  }, literalV6);
}
async function fixture(page, fixtureOrigin) {
  await page.goto(`${fixtureOrigin}/tests/fixtures/storage.html`);
  await page.waitForFunction(() => window.p5?.ready);
}

check('native-literal-v6-to-v8-preserves-dark-profile-drafts-and-all-history', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  const seeded = await seedNativeV6(page, origin);
  assert.deepEqual(await raw(page), rawSnapshot(literalV6, 6));
  await readyProduct(page, origin);
  const upgraded = await raw(page);
  assert.deepEqual(upgraded, rawSnapshot(expectedV8));
  const surface = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme,
    persistence: document.querySelector('#persistence-message')?.textContent, testApi: ['p5', 'p6', 'p7tracks', 'bankProbe'].filter(name => name in window) }));
  assert.equal(surface.theme, 'dark'); assert.match(surface.persistence, /Сохранено локально/); assert.deepEqual(surface.testApi, []);
  await page.reload();
  await page.waitForFunction(() => /Сохранено локально/.test(document.querySelector('#persistence-message')?.textContent ?? ''));
  assert.deepEqual(await raw(page), upgraded);
  return { seeded, upgraded, surface, reloadPreserved: true, nativeMigration: '6→8', reader: 'separate readonly IDB' };
}));

check('native-v6-upgrade-abort-after-successful-cursor-update-rolls-back-version-and-records', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await seedNativeV6(page, origin); const before = await raw(page);
  await context.addInitScript(() => {
    const observation = window.__musicBankUpgradeAbort = { successfulCursorUpdates: 0, abortIssued: false, databaseVersion: null, store: null };
    const nativeUpdate = IDBCursorWithValue.prototype.update;
    IDBCursorWithValue.prototype.update = function (...args) {
      const request = nativeUpdate.apply(this, args);
      const transaction = this.source.transaction ?? this.source.objectStore?.transaction;
      if (transaction?.db.name === 'bass-study' && transaction.db.version === 8) request.addEventListener('success', () => {
        observation.successfulCursorUpdates++;
        if (!observation.abortIssued) {
          observation.databaseVersion = transaction.db.version; observation.store = this.source.name;
          observation.abortIssued = true; transaction.abort();
        }
      });
      return request;
    };
  });
  await readyProduct(page, origin);
  const observation = await page.evaluate(() => window.__musicBankUpgradeAbort);
  assert.equal(observation.successfulCursorUpdates, 1); assert.equal(observation.abortIssued, true); assert.equal(observation.databaseVersion, 8);
  const after = await raw(page);
  assert.deepEqual(after, before); assert.deepEqual(after, rawSnapshot(literalV6, 6));
  const persistence = await page.locator('#persistence-message').innerText(); assert.match(persistence, /Только в памяти/);
  assert.equal(after.profile.theme, 'dark'); assert.deepEqual(after.practiceDrafts, literalV6.practiceDrafts);
  return { observation, before, after, persistence, nativeVersionStayed: 6, successfulPutBeforeAbort: true };
}));

check('native-v8-cache-fresh-and-independent-raw-distinguish-external-commit-and-invalid-snapshot', async ({ fixtureOrigin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await fixture(page, fixtureOrigin);
  const evidence = await page.evaluate(async ({ snapshot, bank }) => {
    const store = window.p5.store;
    await store.restore(JSON.stringify({ ...snapshot, preferences: { ...snapshot.preferences, musicBank: bank } }), { confirmed: true });
    const before = await store.readSnapshot();
    async function externalPreferences(preferences) {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('bass-study'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { await new Promise((resolve, reject) => { const tx = db.transaction('preferences', 'readwrite'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.objectStore('preferences').put(preferences, 'current'); }); }
      finally { db.close(); }
    }
    const external = { ...before.preferences, musicBank: { ...bank, speed: 1.5 } };
    await externalPreferences(external);
    const cached = await store.readSnapshot(), rawExternal = await window.p5.readRaw(), fresh = await store.readSnapshot({ fresh: true });
    const invalid = structuredClone(external); invalid.musicBank.tracks[1].index = 0;
    await externalPreferences(invalid);
    const knownBeforeInvalidFresh = await store.readSnapshot(); let freshFailure, ordinaryAfterFailure;
    try { await store.readSnapshot({ fresh: true }); } catch (error) { freshFailure = { code: error.code, message: error.message }; }
    try { await store.readSnapshot(); } catch (error) { ordinaryAfterFailure = { code: error.code, message: error.message }; }
    const rawInvalid = await window.p5.readRaw();
    await store.restore(JSON.stringify(before), { confirmed: true }); const recovered = await store.readSnapshot({ fresh: true });
    return { before, cached, sameCachedReference: before === cached, cachedFrozen: Object.isFrozen(cached.preferences.musicBank.tracks[0]), rawExternal, fresh,
      knownBeforeInvalidFresh, sameKnownReference: fresh === knownBeforeInvalidFresh, freshFailure, ordinaryAfterFailure, rawInvalid, recovered };
  }, { snapshot: expectedV8, bank: metadataBank });
  assert.equal(evidence.sameCachedReference, true); assert.equal(evidence.cachedFrozen, true); assert.equal(evidence.cached.preferences.musicBank.speed, .75);
  assert.equal(evidence.rawExternal.preferences.musicBank.speed, 1.5); assert.equal(evidence.fresh.preferences.musicBank.speed, 1.5);
  assert.equal(evidence.sameKnownReference, true); assert.equal(evidence.freshFailure?.code, 'INVALID_DATA'); assert.equal(evidence.ordinaryAfterFailure?.code, 'INVALID_DATA');
  assert.equal(evidence.rawInvalid.preferences.musicBank.tracks[1].index, 0); assert.deepEqual(evidence.recovered, evidence.before);
  assert.deepEqual(await raw(page), rawSnapshot(evidence.recovered));
  return { ...evidence, observationScope: 'isolated storage fixture; real IndexedDB, external writer is deliberate test-only mutation' };
}));

check('native-v8-invalid-copy-preview-cancel-and-abort-after-successful-put-preserve-confirmed-snapshot', async ({ fixtureOrigin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await fixture(page, fixtureOrigin);
  const evidence = await page.evaluate(async ({ snapshot, bank }) => {
    const store = window.p5.store; await store.restore(JSON.stringify(snapshot), { confirmed: true });
    const before = await store.readSnapshot(), rawBefore = await window.p5.readRaw();
    const candidate = { ...snapshot, preferences: { ...snapshot.preferences, musicBank: bank }, profile: { ...snapshot.profile, theme: 'light' } };
    const preview = store.previewImport(JSON.stringify(candidate));
    const afterPreview = await store.readSnapshot(); const cancellation = await store.restore(JSON.stringify(candidate), { confirmed: false });
    const afterCancel = await store.readSnapshot();
    const badCopies = [];
    const duplicate = structuredClone(candidate); duplicate.preferences.musicBank.tracks[1].index = 0; badCopies.push(duplicate);
    const hiddenPayload = structuredClone(candidate); hiddenPayload.preferences.activeModule = 'foundation'; hiddenPayload.preferences.musicBank.file.pcm = [0, 1]; badCopies.push(hiddenPayload);
    const badPreset = structuredClone(candidate); badPreset.presets[0].preferences.musicBank = { ...bank, fileHandle: {} }; badCopies.push(badPreset);
    const failures = [];
    for (const bad of badCopies) {
      try { await store.restore(JSON.stringify(bad), { confirmed: true }); failures.push(null); }
      catch (error) { failures.push({ code: error.code, message: error.message }); }
    }
    const afterInvalid = await store.readSnapshot(), rawAfterInvalid = await window.p5.readRaw();
    let abortFailure;
    try { await store.restore(JSON.stringify(candidate), { confirmed: true, failAfterWrite: 1 }); }
    catch (error) { abortFailure = { code: error.code, message: error.message }; }
    const transaction = store.getLastTransaction(), cached = await store.readSnapshot(), rawAfterAbort = await window.p5.readRaw();
    const exportedAfterAbort = JSON.parse(await store.exportBackup()), freshAfterAbort = await store.readSnapshot({ fresh: true });
    await store.restore(JSON.stringify(candidate), { confirmed: true });
    const recovered = await store.readSnapshot({ fresh: true });
    return { before, rawBefore, preview: { requiresConfirmation: preview.requiresConfirmation, profile: preview.snapshot.profile }, afterPreview, afterCancel,
      unchangedAfterPreview: before === afterPreview, unchangedAfterCancel: before === afterCancel, cancellation, failures, afterInvalid, rawAfterInvalid,
      abortFailure, transaction, unchangedCachedAfterAbort: before === cached, cached, rawAfterAbort, exportedAfterAbort, freshAfterAbort, recovered };
  }, { snapshot: expectedV8, bank: metadataBank });
  assert.equal(evidence.preview.requiresConfirmation, true); assert.equal(evidence.preview.profile.theme, 'light'); assert.equal(evidence.before.profile.theme, 'dark');
  assert.equal(evidence.unchangedAfterPreview, true); assert.equal(evidence.unchangedAfterCancel, true); assert.equal(evidence.cancellation.status, 'cancelled');
  assert.ok(evidence.failures.every(failure => failure?.code === 'INVALID_DATA'));
  assert.deepEqual(evidence.afterInvalid, evidence.before); assert.deepEqual(evidence.rawAfterInvalid, evidence.rawBefore);
  assert.equal(evidence.abortFailure?.code, 'INJECTED_ABORT'); assert.deepEqual(evidence.transaction, { successfulWrites: 1, aborted: true });
  assert.equal(evidence.unchangedCachedAfterAbort, true); assert.deepEqual(evidence.rawAfterAbort, evidence.rawBefore);
  assert.deepEqual(evidence.exportedAfterAbort, evidence.before); assert.deepEqual(evidence.freshAfterAbort, evidence.before);
  assert.equal(evidence.recovered.profile.theme, 'light'); assert.deepEqual(evidence.recovered.preferences.musicBank, metadataBank);
  assert.deepEqual(evidence.recovered.history, literalV6.history); assert.deepEqual(evidence.recovered.practiceDrafts, literalV6.practiceDrafts);
  assert.deepEqual(await raw(page), rawSnapshot(evidence.recovered));
  return evidence;
}));

await runTracksBrowserChecks(checks, {
  scope: 'P10 schema8: true native v6→8 migration/rollback, profile and draft preservation, cached/fresh/independent raw IDB, metadata-only music bank strict restore. No memory substitute, no product test API, no audio/hardware claims.',
  reportFile: 'p10-music-bank-storage-edge.json',
});
