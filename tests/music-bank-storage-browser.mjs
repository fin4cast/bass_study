import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runTracksBrowserChecks } from './helpers/tracks-browser-harness.mjs';

const literal = JSON.parse(await readFile(fileURLToPath(new URL('./fixtures/backup.json', import.meta.url)), 'utf8'));
const checks = [];
const check = (name, run) => checks.push({ name, scope: 'native', run });
const storeNames = ['preferences', 'presets', 'history', 'profile', 'practiceDrafts'];
// Current copy with a dark profile and one preset, so profile and preset changes are observable.
const current = {
  ...literal, profile: { ...literal.profile, theme: 'dark' },
  presets: [{ id: 'fixture-preset-a', name: 'Нижняя струна', createdAt: '2026-11-08T22:30:00.000Z', preferences: literal.preferences }],
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
function rawSnapshot(snapshot, version = 11) {
  const hasRhythm = version >= 8;
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
async function seedNativeV10(page, origin) {
  // JSON-ресурс того же origin не запускает приложение и освобождает его IDB/lock.
  const response = await page.goto(`${origin}/vendor/music-bank/patch-manifest.json`);
  assert.equal(response.status(), 200, 'Нужна текущая product build с локальным vendor manifest');
  assert.match(response.headers()['content-type'], /application\/json/);
  assert.equal(await page.locator('#history-mount').count(), 0);
  // Старая база создаётся без продуктового кода: шесть хранилищ версии 10 с непустыми записями.
  return page.evaluate(async ({ snapshot, origin }) => {
    if (location.origin !== origin) throw new Error('Очистка допустима только на изолированном тестовом origin');
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('bass-study'); request.onsuccess = resolve;
      request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Test origin DB deletion blocked'));
    });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study', 10);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('preferences'); db.createObjectStore('profile');
        for (const name of ['presets', 'history', 'practiceDrafts', 'rhythmProjects']) db.createObjectStore(name, { keyPath: 'id' });
        const tx = request.transaction;
        tx.objectStore('preferences').put(snapshot.preferences, 'current'); tx.objectStore('preferences').put(snapshot.activeRhythmProjectId, 'rhythm-selection');
        tx.objectStore('profile').put(snapshot.profile, 'current');
        for (const key of ['presets', 'history', 'practiceDrafts', 'rhythmProjects']) for (const record of snapshot[key]) tx.objectStore(key).put(record);
      };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    const evidence = { version: db.version, stores: [...db.objectStoreNames] }; db.close(); return evidence;
  }, { snapshot: current, origin });
}
async function fixture(page, fixtureOrigin) {
  await page.goto(`${fixtureOrigin}/tests/fixtures/storage.html`);
  await page.waitForFunction(() => window.p5?.ready);
}

check('native-real-v10-database-upgrades-to-empty-v11-and-product-persists', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  const seeded = await seedNativeV10(page, origin);
  const before = await raw(page);
  assert.deepEqual(before, rawSnapshot(current, 10));
  await readyProduct(page, origin);
  const upgraded = await raw(page);
  assert.equal(upgraded.version, 11); assert.deepEqual(upgraded.stores, rawSnapshot(current).stores);
  assert.deepEqual([upgraded.presets, upgraded.history, upgraded.practiceDrafts, upgraded.rhythmProjects, upgraded.activeRhythmProjectId], [[], [], [], [], null]);
  assert.notEqual(upgraded.profile?.theme, 'dark', 'Старый профиль не переносится');
  assert.notDeepEqual(upgraded.preferences, current.preferences, 'Старые настройки не переносятся');
  const surface = await page.evaluate(() => ({ persistence: document.querySelector('#persistence-message')?.textContent,
    storageDetailsHidden: document.querySelector('#open-storage-details')?.hidden, testApi: ['p5', 'p6', 'p7tracks', 'bankProbe'].filter(name => name in window) }));
  assert.match(surface.persistence, /Сохранено локально/); assert.equal(surface.storageDetailsHidden, true); assert.deepEqual(surface.testApi, []);
  await page.reload();
  await page.waitForFunction(() => /Сохранено локально/.test(document.querySelector('#persistence-message')?.textContent ?? ''));
  assert.deepEqual(await raw(page), upgraded);
  return { seeded, before: { version: before.version, history: before.history.length, presets: before.presets.length, practiceDrafts: before.practiceDrafts.length, rhythmProjects: before.rhythmProjects.length }, upgraded, surface, reloadPreserved: true, nativeUpgrade: '10→11 empty', reader: 'separate readonly IDB' };
}));

check('native-v10-upgrade-abort-after-recreating-stores-keeps-old-database-and-memory-mode', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await seedNativeV10(page, origin); const before = await raw(page);
  await context.addInitScript(() => {
    const observation = window.__musicBankUpgradeAbort = { deletedStores: [], createdStores: [], abortIssued: false, databaseVersion: null };
    const { createObjectStore, deleteObjectStore } = IDBDatabase.prototype;
    const upgrading = db => db.name === 'bass-study' && db.version === 11;
    IDBDatabase.prototype.deleteObjectStore = function (name) {
      deleteObjectStore.call(this, name); if (upgrading(this)) observation.deletedStores.push(name);
    };
    IDBDatabase.prototype.createObjectStore = function (...args) {
      const store = createObjectStore.apply(this, args);
      if (upgrading(this)) {
        observation.createdStores.push(args[0]);
        // Последнее хранилище создано: прежние уже удалены, затем вся versionchange-транзакция отменяется.
        if (args[0] === 'rhythmProjects' && !observation.abortIssued) { observation.abortIssued = true; observation.databaseVersion = this.version; store.transaction.abort(); }
      }
      return store;
    };
  });
  await readyProduct(page, origin);
  const observation = await page.evaluate(() => window.__musicBankUpgradeAbort);
  assert.equal(observation.abortIssued, true); assert.equal(observation.databaseVersion, 11);
  assert.deepEqual([...observation.deletedStores].sort(), before.stores); assert.deepEqual([...observation.createdStores].sort(), before.stores);
  const after = await raw(page);
  assert.deepEqual(after, before); assert.deepEqual(after, rawSnapshot(current, 10));
  const persistence = await page.locator('#persistence-message').innerText(); assert.match(persistence, /Только в памяти/);
  return { observation, before: { version: before.version, history: before.history.length }, after: { version: after.version, history: after.history.length }, persistence, nativeVersionStayed: 10, storesRecreatedBeforeAbort: true };
}));

check('native-v11-cache-fresh-and-independent-raw-distinguish-external-commit-and-invalid-snapshot', async ({ fixtureOrigin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
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
    const knownBeforeInvalidFresh = await store.readSnapshot();
    // A damaged record is skipped and reported; the rest of the database stays readable.
    const invalidFresh = await store.readSnapshot({ fresh: true }), skipped = store.skippedRecords().map(record => record.store);
    const rawInvalid = await window.p5.readRaw();
    await store.restore(JSON.stringify(before), { confirmed: true }); const recovered = await store.readSnapshot({ fresh: true });
    return { before, cached, sameCachedReference: before === cached, cachedFrozen: Object.isFrozen(cached.preferences.musicBank.tracks[0]), rawExternal, fresh,
      knownBeforeInvalidFresh, sameKnownReference: fresh === knownBeforeInvalidFresh, invalidFresh, skipped, rawInvalid, recovered, skippedAfterRestore: store.skippedRecords().length };
  }, { snapshot: current, bank: metadataBank });
  assert.equal(evidence.sameCachedReference, true); assert.equal(evidence.cachedFrozen, true); assert.equal(evidence.cached.preferences.musicBank.speed, .75);
  assert.equal(evidence.rawExternal.preferences.musicBank.speed, 1.5); assert.equal(evidence.fresh.preferences.musicBank.speed, 1.5);
  assert.equal(evidence.sameKnownReference, true); assert.deepEqual(evidence.skipped, ['preferences']); assert.equal(evidence.skippedAfterRestore, 0);
  assert.deepEqual(evidence.invalidFresh.history, evidence.before.history); assert.equal(evidence.invalidFresh.preferences.musicBank, null);
  assert.equal(evidence.rawInvalid.preferences.musicBank.tracks[1].index, 0); assert.deepEqual(evidence.recovered, evidence.before);
  assert.deepEqual(await raw(page), rawSnapshot(evidence.recovered));
  return { ...evidence, observationScope: 'isolated storage fixture; real IndexedDB, external writer is deliberate test-only mutation' };
}));

check('native-v11-invalid-copy-preview-cancel-and-abort-after-successful-put-preserve-confirmed-snapshot', async ({ fixtureOrigin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
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
  }, { snapshot: current, bank: metadataBank });
  assert.equal(evidence.preview.requiresConfirmation, true); assert.equal(evidence.preview.profile.theme, 'light'); assert.equal(evidence.before.profile.theme, 'dark');
  assert.equal(evidence.unchangedAfterPreview, true); assert.equal(evidence.unchangedAfterCancel, true); assert.equal(evidence.cancellation.status, 'cancelled');
  assert.ok(evidence.failures.every(failure => failure?.code === 'INVALID_DATA'));
  assert.deepEqual(evidence.afterInvalid, evidence.before); assert.deepEqual(evidence.rawAfterInvalid, evidence.rawBefore);
  assert.equal(evidence.abortFailure?.code, 'INJECTED_ABORT'); assert.deepEqual(evidence.transaction, { successfulWrites: 1, aborted: true });
  assert.equal(evidence.unchangedCachedAfterAbort, true); assert.deepEqual(evidence.rawAfterAbort, evidence.rawBefore);
  assert.deepEqual(evidence.exportedAfterAbort, evidence.before); assert.deepEqual(evidence.freshAfterAbort, evidence.before);
  assert.equal(evidence.recovered.profile.theme, 'light'); assert.deepEqual(evidence.recovered.preferences.musicBank, metadataBank);
  assert.deepEqual(evidence.recovered.history, current.history); assert.deepEqual(evidence.recovered.practiceDrafts, current.practiceDrafts);
  assert.deepEqual(await raw(page), rawSnapshot(evidence.recovered));
  return evidence;
}));

checks.push({ name: 'product-skips-one-damaged-record-keeps-database-and-offers-raw-export', scope: 'ui', async run({ page }) {
  const current = JSON.parse(await readFile(fileURLToPath(new URL('./fixtures/backup.json', import.meta.url)), 'utf8'));
  const valid = current.history.find(entry => entry.result.kind === 'screen');
  const ready = () => page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main?.getAttribute('aria-busy') === 'false' && !main.inert && /Не прочитано|Сохранено локально|Только в памяти/.test(document.querySelector('#persistence-message')?.textContent ?? '');
  }, undefined, { timeout: 20000 });
  await ready();
  // Separate connection of the test: the product never writes a damaged record itself.
  await page.evaluate(async records => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('bass-study'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise((resolve, reject) => { const tx = db.transaction('history', 'readwrite'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); records.forEach(record => tx.objectStore('history').put(record)); }); }
    finally { db.close(); }
  }, [valid, { id: 'broken-entry', occurredAt: 'вчера' }]);
  await page.context().addInitScript(() => {
    // Init scripts also run in frames without StorageManager; only the product page is observed.
    if (!navigator.storage?.persist) return;
    const persist = navigator.storage.persist.bind(navigator.storage);
    window.__persistRequests = 0;
    navigator.storage.persist = () => { window.__persistRequests++; return persist(); };
  });
  await page.reload();
  await ready();
  const persistence = await page.locator('#persistence-message').innerText();
  assert.match(persistence, /Не прочитано повреждённых записей: 1 \(история — 1\)/);
  assert.doesNotMatch(persistence, /Только в памяти/);
  assert.equal(await page.evaluate(() => window.__persistRequests), 1, 'База просит браузер не вытеснять данные');
  await page.locator('#open-history').click(); await page.locator('[data-history-action="export-raw"]').waitFor();
  assert.match(await page.locator('[data-history-count]').innerText(), /^1 записей/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-history-action="export-raw"]').click()]);
  const dump = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(dump.format, 'bass-study-raw-indexeddb');
  assert.deepEqual(dump.stores.history.map(record => record.key).sort(), ['broken-entry', valid.id].sort());
  return { persistence, rawStores: Object.keys(dump.stores), rawVersion: dump.version };
} });

await runTracksBrowserChecks(checks, {
  scope: 'Schema 11: true native v10→11 upgrade to empty stores and its rollback, cached/fresh/independent raw IDB, metadata-only music bank strict restore. No memory substitute, no product test API, no audio/hardware claims.',
  reportFile: 'p10-music-bank-storage-edge.json',
});
