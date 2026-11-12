import {
  MAX_BACKUP_BYTES, STUDY_SCHEMA_VERSION, StudyStorageError, previewImport, validateHistoryEntry, validatePreferences, validatePreset,
  validateProfile, validatePracticeDraft, mergePracticeDraft, applyDraftDrain,
  validateRhythmProjectId, validateStoredRhythmProject, readStoredSnapshot,
  type SkippedRecord, type AppPreferences, type HistoryEntry, type Preset, type StudySnapshot, type GlobalProfile, type PracticeDraft, type DrainDraftRequest,
} from './model';
import type { RhythmProject } from '../rhythm/model';
import { createImportPreparation, type PreparedStudyImport } from './prepared-import';
import { createHistoryLinks, isRouteEntry, type HistoryCommit } from './history-links';
import { validateRhythmLibraryChange, type RhythmLibraryChange, type RhythmLibraryCommit } from './rhythm-library';

export * from './model';
export type { PreparedStudyImport } from './prepared-import';
export type { HistoryCommit } from './history-links';
export type { RhythmLibraryChange, RhythmLibraryCommit } from './rhythm-library';
export { createMemoryStudyStore } from './memory';
export const STUDY_DB_NAME = 'bass-study';
export const STUDY_DB_VERSION = STUDY_SCHEMA_VERSION;
const STORES = ['preferences', 'presets', 'history', 'profile', 'practiceDrafts', 'rhythmProjects'] as const;
const RHYTHM_SELECTION_KEY = 'rhythm-selection';

function storageError(error: unknown): StudyStorageError {
  if (error instanceof StudyStorageError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'QuotaExceededError') return new StudyStorageError('QUOTA', 'Недостаточно места в браузере. Сохранение не выполнено; освободите место или экспортируйте текущие данные.');
  if (name === 'VersionError') return new StudyStorageError('UNSUPPORTED_DATABASE_VERSION', 'База создана более новой версией приложения. Данные не сброшены.');
  return new StudyStorageError('STORAGE_FAILURE', `Не удалось выполнить операцию с локальной базой${name ? ` (${name})` : ''}. Данные не следует считать сохранёнными.`);
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

function snapshotRequests(transaction: IDBTransaction) {
  const preferences = transaction.objectStore('preferences');
  return {
    preferences: preferences.get('current'),
    presets: transaction.objectStore('presets').getAll(),
    history: transaction.objectStore('history').getAll(),
    profile: transaction.objectStore('profile').get('current'),
    practiceDrafts: transaction.objectStore('practiceDrafts').getAll(),
    rhythmProjects: transaction.objectStore('rhythmProjects').getAll(),
    activeRhythmProjectId: preferences.get(RHYTHM_SELECTION_KEY),
  };
}

function storedRecords(requests: ReturnType<typeof snapshotRequests>) {
  return { preferences: requests.preferences.result, profile: requests.profile.result, activeRhythmProjectId: requests.activeRhythmProjectId.result,
    presets: requests.presets.result, history: requests.history.result, practiceDrafts: requests.practiceDrafts.result, rhythmProjects: requests.rhythmProjects.result };
}

/**
 * Dumps every object store of the database as it is, without validation or upgrade.
 * Works when the application cannot read the data, including a newer database version.
 */
export async function exportRawDatabase(name = STUDY_DB_NAME): Promise<string> {
  if (!globalThis.indexedDB) throw new StudyStorageError('UNAVAILABLE', 'Браузерное хранилище недоступно.');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    // Opening without a version never upgrades an existing database; a missing one must not be created.
    request.onupgradeneeded = () => request.transaction!.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StudyStorageError('MISSING_DATABASE', 'Локальная база не найдена.'));
  });
  try {
    const names = [...db.objectStoreNames];
    const stores: Record<string, { key: IDBValidKey; value: unknown }[]> = {};
    if (names.length) {
      const transaction = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(storageError(transaction.error)); });
      const reads = names.map(store => Promise.all([requestValue(transaction.objectStore(store).getAllKeys()), requestValue(transaction.objectStore(store).getAll())]));
      const values = await Promise.all(reads);
      await done;
      names.forEach((store, index) => { const [keys, records] = values[index]; stores[store] = keys.map((key, item) => ({ key, value: records[item] })); });
    }
    return JSON.stringify({ format: 'bass-study-raw-indexeddb', database: db.name, version: db.version, exportedAt: new Date().toISOString(), stores });
  } finally { db.close(); }
}

/** Native IndexedDB adapter. Each ordinary write only touches its own store. */
export function createStudyStore() {
  const imports = createImportPreparation();
  let database: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let lastTransaction = { successfulWrites: 0, aborted: false };
  let cachedSnapshot: StudySnapshot | null = null;
  let skippedRecords: readonly SkippedRecord[] = [];
  let historyLinks: ReturnType<typeof createHistoryLinks> | null = null;

  function installSnapshot(snapshot: StudySnapshot | null) {
    cachedSnapshot = snapshot;
    historyLinks = snapshot ? createHistoryLinks(snapshot.history) : null;
  }

  function rememberRecord(kind: 'presets' | 'history' | 'practiceDrafts', value: Preset | HistoryEntry | PracticeDraft) {
    if (!cachedSnapshot || !database) return;
    const records = [...cachedSnapshot[kind].filter(item => item.id !== value.id), value].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    cachedSnapshot = Object.freeze({ ...cachedSnapshot, [kind]: Object.freeze(records) });
  }

  function rememberHistory(commit: HistoryCommit) {
    for (const entry of [commit.entry, commit.linkedRoute]) {
      if (!entry) continue;
      historyLinks?.remember(entry);
      rememberRecord('history', entry);
    }
  }

  async function getDatabase(): Promise<IDBDatabase> {
    if (database) return database;
    if (opening) return opening;
    if (!globalThis.indexedDB) throw new StudyStorageError('UNAVAILABLE', 'Браузерное хранилище недоступно. Занятия можно продолжить в памяти, но история не сохранится.');
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      let rejected = false;
      const request = indexedDB.open(STUDY_DB_NAME, STUDY_DB_VERSION);
      request.onupgradeneeded = () => {
        // No data migration: any older database starts empty (one user, data are not valuable yet).
        const db = request.result;
        for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
        db.createObjectStore('preferences'); db.createObjectStore('profile');
        for (const name of ['presets', 'history', 'practiceDrafts', 'rhythmProjects']) db.createObjectStore(name, { keyPath: 'id' });
      };
      request.onerror = () => { rejected = true; reject(storageError(request.error)); };
      request.onblocked = () => { rejected = true; reject(new StudyStorageError('BLOCKED', 'Открытие базы заблокировано другой вкладкой. Закройте другие вкладки bass_study и повторите операцию.')); };
      request.onsuccess = () => {
        if (rejected) { request.result.close(); return; }
        database = request.result;
        const connection = database;
        const invalidate = () => { if (database === connection) { database = null; installSnapshot(null); } };
        connection.onversionchange = () => { connection.close(); invalidate(); };
        connection.onclose = invalidate;
        resolve(database);
      };
    });
    try { return await opening; } finally { opening = null; }
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation).catch(error => { throw storageError(error); });
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function completion(transaction: IDBTransaction, writing = false, injected: () => boolean = () => false): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => {
        if (writing) lastTransaction.aborted = true;
        reject(injected() ? new StudyStorageError('INJECTED_ABORT', 'Тестовая ошибка после успешной записи: вся транзакция отменена.') : storageError(transaction.error));
      };
      transaction.onerror = () => { /* The transaction abort is the final failure. */ };
    });
  }

  async function read(fresh = false): Promise<StudySnapshot> {
    const db = await getDatabase();
    if (!fresh && cachedSnapshot) return cachedSnapshot;
    // A failed fresh validation must never leave an older snapshot appearing current.
    if (fresh) installSnapshot(null);
    const transaction = db.transaction([...STORES], 'readonly');
    const done = completion(transaction);
    const requests = snapshotRequests(transaction);
    await Promise.all([requestValue(requests.activeRhythmProjectId), done]);
    const { snapshot, skipped } = readStoredSnapshot(storedRecords(requests));
    if (database === db) { installSnapshot(snapshot); skippedRecords = skipped; }
    return snapshot;
  }

  async function write(name: typeof STORES[number], value: unknown, key?: IDBValidKey): Promise<void> {
    const db = await getDatabase();
    const transaction = db.transaction(name, 'readwrite');
    lastTransaction = { successfulWrites: 0, aborted: false };
    const done = completion(transaction, true);
    const store = transaction.objectStore(name);
    const request = key === undefined ? store.put(value) : store.put(value, key);
    request.addEventListener('success', () => { lastTransaction.successfulWrites++; });
    await done;
  }

  async function remove(name: 'presets' | 'history' | 'practiceDrafts', id: string): Promise<void> {
    if (typeof id !== 'string' || !id.trim() || id.length > 160) throw new StudyStorageError('INVALID_DATA', 'Некорректный ID удаляемой записи.');
    const db = await getDatabase();
    const transaction = db.transaction(name, 'readwrite');
    lastTransaction = { successfulWrites: 0, aborted: false };
    const done = completion(transaction, true);
    transaction.objectStore(name).delete(id).addEventListener('success', () => { lastTransaction.successfulWrites++; });
    await done;
    if (database !== db) return;
    if (name === 'history') historyLinks?.remove(id);
    if (cachedSnapshot) cachedSnapshot = Object.freeze({ ...cachedSnapshot, [name]: Object.freeze(cachedSnapshot[name].filter(item => item.id !== id)) });
  }

  async function mutateRhythmProjects(change: RhythmLibraryChange): Promise<RhythmLibraryCommit> {
    const db = await getDatabase();
    const transaction = db.transaction(['preferences', 'rhythmProjects'], 'readwrite');
    lastTransaction = { successfulWrites: 0, aborted: false };
    const done = completion(transaction, true);
    const preferences = transaction.objectStore('preferences');
    const projects = transaction.objectStore('rhythmProjects');
    const observe = (request: IDBRequest) => request.addEventListener('success', () => { lastTransaction.successfulWrites++; });
    let activeRhythmProjectId: string | null;
    try {
      switch (change.kind) {
        case 'save':
          activeRhythmProjectId = change.project.id;
          observe(projects.put(change.project));
          observe(preferences.put(activeRhythmProjectId, RHYTHM_SELECTION_KEY));
          break;
        case 'select':
          activeRhythmProjectId = change.id;
          if (change.id === null) observe(preferences.delete(RHYTHM_SELECTION_KEY));
          else {
            if (await requestValue(projects.getKey(change.id)) === undefined) throw new StudyStorageError('MISSING_RHYTHM_PROJECT', 'Проект ритма отсутствует.');
            observe(preferences.put(change.id, RHYTHM_SELECTION_KEY));
          }
          break;
        case 'delete': {
          const selection = await requestValue<unknown>(preferences.get(RHYTHM_SELECTION_KEY));
          activeRhythmProjectId = selection == null ? null : validateRhythmProjectId(selection);
          observe(projects.delete(change.id));
          if (change.id === activeRhythmProjectId) {
            observe(preferences.delete(RHYTHM_SELECTION_KEY));
            activeRhythmProjectId = null;
          }
          break;
        }
      }
      await done;
    } catch (failure) {
      try { transaction.abort(); } catch { /* Already closed by IndexedDB. */ }
      await done.catch(() => {});
      throw storageError(failure);
    }
    const receipt = Object.freeze({ change, activeId: activeRhythmProjectId });
    if (!cachedSnapshot || database !== db) return receipt;
    let rhythmProjects = cachedSnapshot.rhythmProjects;
    if (change.kind === 'delete') rhythmProjects = Object.freeze(rhythmProjects.filter(project => project.id !== change.id));
    if (change.kind === 'save') {
      rhythmProjects = Object.freeze([...rhythmProjects.filter(project => project.id !== change.project.id), change.project].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    if (activeRhythmProjectId !== null && !rhythmProjects.some(project => project.id === activeRhythmProjectId)) {
      installSnapshot(null);
      return receipt;
    }
    cachedSnapshot = Object.freeze({ ...cachedSnapshot, rhythmProjects, activeRhythmProjectId });
    return receipt;
  }

  async function addHistory(entry: HistoryEntry): Promise<HistoryCommit> {
    if (!historyLinks && (isRouteEntry(entry) || entry.routeRef)) await read();
    const db = await getDatabase();
    const commit = historyLinks?.plan(entry) ?? { entry };
    const transaction = db.transaction('history', 'readwrite');
    lastTransaction = { successfulWrites: 0, aborted: false };
    const done = completion(transaction, true);
    try {
      const history = transaction.objectStore('history');
      history.put(commit.entry).addEventListener('success', () => { lastTransaction.successfulWrites++; });
      if (commit.linkedRoute) history.put(commit.linkedRoute).addEventListener('success', () => { lastTransaction.successfulWrites++; });
      await done;
      if (database === db) rememberHistory(commit);
      return commit;
    } catch (failure) { try { transaction.abort(); } catch { /* already completed */ } await done.catch(() => {}); throw failure; }
  }

  async function mutateDraft(id: string, update: (current: PracticeDraft | undefined) => PracticeDraft): Promise<PracticeDraft> {
    const db = await getDatabase();
    const transaction = db.transaction('practiceDrafts', 'readwrite');
    lastTransaction = { successfulWrites: 0, aborted: false };
    const done = completion(transaction, true);
    try {
      const store = transaction.objectStore('practiceDrafts');
      const raw = await requestValue<unknown>(store.get(id));
      const draft = update(raw === undefined ? undefined : validatePracticeDraft(raw));
      store.put(draft).addEventListener('success', () => { lastTransaction.successfulWrites++; });
      await done;
      if (database === db) rememberRecord('practiceDrafts', draft);
      return draft;
    } catch (failure) { try { transaction.abort(); } catch { /* already completed */ } await done.catch(() => {}); throw failure; }
  }

  async function drainDraft(request: DrainDraftRequest) {
    if (!historyLinks) await read();
    const db = await getDatabase();
    const transaction = db.transaction(['history', 'practiceDrafts'], 'readwrite');
    lastTransaction = { successfulWrites: 0, aborted: false };
    let injectedAbort = false;
    const done = completion(transaction, true, () => injectedAbort);
    try {
      const history = transaction.objectStore('history'), drafts = transaction.objectStore('practiceDrafts');
      const [rawDraft, existing] = await Promise.all([requestValue<unknown>(drafts.get(request.draftId)), requestValue<HistoryEntry | undefined>(history.get(request.historyId))]);
      if (!rawDraft) throw new StudyStorageError('MISSING_DRAFT', 'Черновик уже удалён или отсутствует.');
      const result = applyDraftDrain(validatePracticeDraft(rawDraft), request, existing);
      const commit = historyLinks?.plan(result.entry) ?? { entry: result.entry };
      const writes = existing ? [] : [history.add(result.entry), drafts.put(result.draft)];
      if (commit.linkedRoute) writes.push(history.put(commit.linkedRoute));
      for (const write of writes) write.addEventListener('success', () => {
        lastTransaction.successfulWrites++;
        if (lastTransaction.successfulWrites === request.failAfterWrite) { injectedAbort = true; transaction.abort(); }
      });
      await done;
      if (database === db) { rememberHistory(commit); rememberRecord('practiceDrafts', result.draft); }
      return { ...result, ...commit };
    } catch (failure) { try { transaction.abort(); } catch { /* already completed */ } await done.catch(() => {}); throw failure; }
  }

  function restorePrepared(candidate: PreparedStudyImport, options: { failAfterWrite?: number } = {}) {
    const failAfterWrite = options.failAfterWrite;
    return enqueue(async () => {
      const snapshot = imports.snapshot(candidate);
      const totalWrites = 2 + snapshot.presets.length + snapshot.history.length + snapshot.practiceDrafts.length + snapshot.rhythmProjects.length + Number(snapshot.activeRhythmProjectId !== null);
      if (failAfterWrite !== undefined && (!Number.isInteger(failAfterWrite) || failAfterWrite < 1 || failAfterWrite > totalWrites)) {
        throw new StudyStorageError('INVALID_DATA', 'Некорректная точка тестового отказа транзакции.');
      }
      const db = await getDatabase();
      const transaction = db.transaction([...STORES], 'readwrite');
      lastTransaction = { successfulWrites: 0, aborted: false };
      let injectedAbort = false;
      const done = completion(transaction, true, () => injectedAbort);
      try {
        STORES.forEach(name => transaction.objectStore(name).clear());
        const writes: IDBRequest[] = [transaction.objectStore('preferences').put(snapshot.preferences, 'current'), transaction.objectStore('profile').put(snapshot.profile, 'current')];
        snapshot.presets.forEach(preset => writes.push(transaction.objectStore('presets').put(preset)));
        snapshot.history.forEach(entry => writes.push(transaction.objectStore('history').put(entry)));
        snapshot.practiceDrafts.forEach(draft => writes.push(transaction.objectStore('practiceDrafts').put(draft)));
        snapshot.rhythmProjects.forEach(project => writes.push(transaction.objectStore('rhythmProjects').put(project)));
        if (snapshot.activeRhythmProjectId !== null) writes.push(transaction.objectStore('preferences').put(snapshot.activeRhythmProjectId, RHYTHM_SELECTION_KEY));
        writes.forEach(request => request.addEventListener('success', () => {
          lastTransaction.successfulWrites++;
          if (lastTransaction.successfulWrites === failAfterWrite) { injectedAbort = true; transaction.abort(); }
        }));
        await done;
      } catch (failure) {
        try { transaction.abort(); } catch { /* already completed */ }
        await done.catch(() => {});
        throw failure;
      }
      if (database === db) { installSnapshot(snapshot); skippedRecords = []; }
      imports.consume(candidate);
      return { status: 'restored' as const, presets: snapshot.presets.length, history: snapshot.history.length, snapshot };
    });
  }

  return {
    open: () => enqueue(async () => { const db = await getDatabase(); return { name: db.name, version: db.version }; }),
    /** The application holds the writer lease. Use fresh for explicit external-change checks. */
    readSnapshot: (options: { fresh?: boolean } = {}) => enqueue(() => read(options.fresh === true)),
    /** Records skipped by the last read of the database; they remain stored and appear in the raw export. */
    skippedRecords: () => skippedRecords,
    async saveProfile(profile: GlobalProfile) { const validated = validateProfile(profile); return enqueue(async () => { await write('profile', validated, 'current'); if (cachedSnapshot && database) cachedSnapshot = Object.freeze({ ...cachedSnapshot, profile: validated }); }); },
    async upsertPracticeDraft(draft: PracticeDraft) { const validated = validatePracticeDraft(draft); return enqueue(() => mutateDraft(validated.id, current => mergePracticeDraft(current, validated))); },
    updateDraftProgress: (id: string, totalReferenceMs: number, suggestedBpm: number, updatedAt: string) => enqueue(() => mutateDraft(id, current => { if (!current) throw new StudyStorageError('MISSING_DRAFT', 'Черновик отсутствует.'); return validatePracticeDraft({ ...current, totalReferenceMs: Math.max(current.totalReferenceMs, totalReferenceMs), suggestedBpm, updatedAt }); })),
    updateDraftText: (id: string, change: Pick<PracticeDraft, 'editRevision' | 'note' | 'comfortableBpm' | 'updatedAt'>) => enqueue(() => mutateDraft(id, current => { if (!current) throw new StudyStorageError('MISSING_DRAFT', 'Черновик отсутствует.'); return change.editRevision > current.editRevision ? validatePracticeDraft({ ...current, ...change }) : current; })),
    deletePracticeDraft: (id: string) => enqueue(() => remove('practiceDrafts', id)),
    drainDraft: (request: DrainDraftRequest) => enqueue(() => drainDraft(request)),
    async savePreferences(preferences: AppPreferences) {
      const validated = validatePreferences(preferences);
      return enqueue(async () => {
        await write('preferences', validated, 'current');
        if (cachedSnapshot && database) cachedSnapshot = Object.freeze({ ...cachedSnapshot, preferences: validated });
      });
    },
    async savePreset(preset: Preset) { const validated = validatePreset(preset); return enqueue(async () => { await write('presets', validated); rememberRecord('presets', validated); }); },
    deletePreset: (id: string) => enqueue(() => remove('presets', id)),
    async addHistory(entry: HistoryEntry) { const validated = validateHistoryEntry(entry); return enqueue(() => addHistory(validated)); },
    deleteHistory: (id: string) => enqueue(() => remove('history', id)),
    async changeRhythmLibrary(change: RhythmLibraryChange) { const validated = validateRhythmLibraryChange(change); return enqueue(() => mutateRhythmProjects(validated)); },
    async saveRhythmProject(project: RhythmProject) {
      const validated = validateStoredRhythmProject(project);
      return enqueue(async () => { await mutateRhythmProjects({ kind: 'save', project: validated }); return validated; });
    },
    async selectRhythmProject(id: string | null) {
      const validated = id === null ? null : validateRhythmProjectId(id);
      await enqueue(() => mutateRhythmProjects({ kind: 'select', id: validated }));
    },
    async deleteRhythmProject(id: string) {
      const validated = validateRhythmProjectId(id);
      await enqueue(() => mutateRhythmProjects({ kind: 'delete', id: validated }));
    },
    exportBackup: () => enqueue(async () => {
      const json = JSON.stringify(await read());
      if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new StudyStorageError('BACKUP_TOO_LARGE', 'Копия превышает предел 64 МиБ. Данные в базе сохранены; для такого объёма нужен расширенный формат архива.');
      return json;
    }),
    previewImport,
    prepareImport: imports.prepare,
    restorePrepared,
    async restore(json: string, options: { confirmed: boolean; failAfterWrite?: number }) {
      const candidate = imports.prepare(json);
      if (!options?.confirmed) return { status: 'cancelled' as const };
      const { status, presets, history } = await restorePrepared(candidate, options);
      return { status, presets, history };
    },
    close: () => enqueue(async () => { imports.clear(); database?.close(); database = null; installSnapshot(null); }),
    getLastTransaction() { return { ...lastTransaction }; },
  };
}
