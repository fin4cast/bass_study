import {
  STUDY_SCHEMA_VERSION, StudyStorageError, validateHistoryEntry, validatePreferences, validateStoredExercise,
  validateProfile, validatePracticeDraft, mergePracticeDraft, applyDraftDrain,
  validateRhythmProjectId, readStoredSnapshot,
  type SkippedRecord, type AppPreferences, type HistoryEntry, type UserExercise, type StudySnapshot, type GlobalProfile, type PracticeDraft, type DrainDraftRequest,
} from './model';
import { backupJson, validateRecordId, withRecord, withRhythmChange, withoutRecord, type RecordKind, type RecordValue } from './snapshot-ops';
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
/** Хранилища в порядке создания при upgrade. */
const STORES = ['preferences', 'profile', 'exercises', 'history', 'practiceDrafts', 'rhythmProjects'] as const;
const KEYED_STORES = new Set<string>(['preferences', 'profile']);
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
    exercises: transaction.objectStore('exercises').getAll(),
    history: transaction.objectStore('history').getAll(),
    profile: transaction.objectStore('profile').get('current'),
    practiceDrafts: transaction.objectStore('practiceDrafts').getAll(),
    rhythmProjects: transaction.objectStore('rhythmProjects').getAll(),
    activeRhythmProjectId: preferences.get(RHYTHM_SELECTION_KEY),
  };
}

function storedRecords(requests: ReturnType<typeof snapshotRequests>) {
  return { preferences: requests.preferences.result, profile: requests.profile.result, activeRhythmProjectId: requests.activeRhythmProjectId.result,
    exercises: requests.exercises.result, history: requests.history.result, practiceDrafts: requests.practiceDrafts.result, rhythmProjects: requests.rhythmProjects.result };
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

/** Test fixtures observe each successful write here and may abort the transaction after it; the product passes nothing. */
export interface StudyStoreOptions { readonly observeWrite?: (request: IDBRequest, transaction: IDBTransaction) => void }

/** Native IndexedDB adapter. Each ordinary write only touches its own store. */
export function createStudyStore(options: StudyStoreOptions = {}) {
  const imports = createImportPreparation();
  let database: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let cachedSnapshot: StudySnapshot | null = null;
  let skippedRecords: readonly SkippedRecord[] = [];
  let historyLinks: ReturnType<typeof createHistoryLinks> | null = null;

  function installSnapshot(snapshot: StudySnapshot | null) {
    cachedSnapshot = snapshot;
    historyLinks = snapshot ? createHistoryLinks(snapshot.history) : null;
  }

  function rememberRecord(kind: RecordKind, value: RecordValue) {
    if (cachedSnapshot && database) cachedSnapshot = withRecord(cachedSnapshot, kind, value);
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
        for (const name of STORES) db.createObjectStore(name, KEYED_STORES.has(name) ? undefined : { keyPath: 'id' });
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

  function completion(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(storageError(transaction.error));
      transaction.onerror = () => { /* The transaction abort is the final failure. */ };
    });
  }

  /** Every write request goes through here so fixtures can observe it. */
  function written<T extends IDBRequest>(request: T, transaction: IDBTransaction): T {
    options.observeWrite?.(request, transaction);
    return request;
  }

  async function rollback(transaction: IDBTransaction, done: Promise<void>, failure: unknown): Promise<never> {
    try { transaction.abort(); } catch { /* Already finished by IndexedDB. */ }
    await done.catch(() => {});
    throw storageError(failure);
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
    const done = completion(transaction);
    const store = transaction.objectStore(name);
    written(key === undefined ? store.put(value) : store.put(value, key), transaction);
    await done;
  }

  async function remove(name: RecordKind, id: string): Promise<void> {
    validateRecordId(id);
    const db = await getDatabase();
    const transaction = db.transaction(name, 'readwrite');
    const done = completion(transaction);
    written(transaction.objectStore(name).delete(id), transaction);
    await done;
    if (database !== db) return;
    if (name === 'history') historyLinks?.remove(id);
    if (cachedSnapshot) cachedSnapshot = withoutRecord(cachedSnapshot, name, id);
  }

  async function mutateRhythmProjects(change: RhythmLibraryChange): Promise<RhythmLibraryCommit> {
    const db = await getDatabase();
    const transaction = db.transaction(['preferences', 'rhythmProjects'], 'readwrite');
    const done = completion(transaction);
    const preferences = transaction.objectStore('preferences');
    const projects = transaction.objectStore('rhythmProjects');
    let activeRhythmProjectId: string | null;
    try {
      switch (change.kind) {
        case 'save':
          activeRhythmProjectId = change.project.id;
          written(projects.put(change.project), transaction);
          written(preferences.put(activeRhythmProjectId, RHYTHM_SELECTION_KEY), transaction);
          break;
        case 'select':
          activeRhythmProjectId = change.id;
          if (change.id === null) written(preferences.delete(RHYTHM_SELECTION_KEY), transaction);
          else {
            if (await requestValue(projects.getKey(change.id)) === undefined) throw new StudyStorageError('MISSING_RHYTHM_PROJECT', 'Проект ритма отсутствует.');
            written(preferences.put(change.id, RHYTHM_SELECTION_KEY), transaction);
          }
          break;
        case 'delete': {
          const selection = await requestValue<unknown>(preferences.get(RHYTHM_SELECTION_KEY));
          activeRhythmProjectId = selection == null ? null : validateRhythmProjectId(selection);
          written(projects.delete(change.id), transaction);
          if (change.id === activeRhythmProjectId) {
            written(preferences.delete(RHYTHM_SELECTION_KEY), transaction);
            activeRhythmProjectId = null;
          }
          break;
        }
      }
      await done;
    } catch (failure) { return rollback(transaction, done, failure); }
    const receipt = Object.freeze({ change, activeId: activeRhythmProjectId });
    if (!cachedSnapshot || database !== db) return receipt;
    // The database decides the selection; the shared rule only updates the project list.
    const rhythmProjects = change.kind === 'select' ? cachedSnapshot.rhythmProjects : withRhythmChange(cachedSnapshot, change).snapshot.rhythmProjects;
    if (activeRhythmProjectId !== null && !rhythmProjects.some(project => project.id === activeRhythmProjectId)) { installSnapshot(null); return receipt; }
    cachedSnapshot = Object.freeze({ ...cachedSnapshot, rhythmProjects, activeRhythmProjectId });
    return receipt;
  }

  async function addHistory(entry: HistoryEntry): Promise<HistoryCommit> {
    if (!historyLinks && (isRouteEntry(entry) || entry.routeRef)) await read();
    const db = await getDatabase();
    const commit = historyLinks?.plan(entry) ?? { entry };
    const transaction = db.transaction('history', 'readwrite');
    const done = completion(transaction);
    try {
      const history = transaction.objectStore('history');
      written(history.put(commit.entry), transaction);
      if (commit.linkedRoute) written(history.put(commit.linkedRoute), transaction);
      await done;
    } catch (failure) { return rollback(transaction, done, failure); }
    if (database === db) rememberHistory(commit);
    return commit;
  }

  async function mutateDraft(id: string, update: (current: PracticeDraft | undefined) => PracticeDraft): Promise<PracticeDraft> {
    const db = await getDatabase();
    const transaction = db.transaction('practiceDrafts', 'readwrite');
    const done = completion(transaction);
    let draft: PracticeDraft;
    try {
      const store = transaction.objectStore('practiceDrafts');
      const raw = await requestValue<unknown>(store.get(id));
      draft = update(raw === undefined ? undefined : validatePracticeDraft(raw));
      written(store.put(draft), transaction);
      await done;
    } catch (failure) { return rollback(transaction, done, failure); }
    if (database === db) rememberRecord('practiceDrafts', draft);
    return draft;
  }

  async function drainDraft(request: DrainDraftRequest) {
    if (!historyLinks) await read();
    const db = await getDatabase();
    const transaction = db.transaction(['history', 'practiceDrafts'], 'readwrite');
    const done = completion(transaction);
    try {
      const history = transaction.objectStore('history'), drafts = transaction.objectStore('practiceDrafts');
      const [rawDraft, existing] = await Promise.all([requestValue<unknown>(drafts.get(request.draftId)), requestValue<HistoryEntry | undefined>(history.get(request.historyId))]);
      if (!rawDraft) throw new StudyStorageError('MISSING_DRAFT', 'Черновик уже удалён или отсутствует.');
      const result = applyDraftDrain(validatePracticeDraft(rawDraft), request, existing);
      const commit = historyLinks?.plan(result.entry) ?? { entry: result.entry };
      if (!existing) { written(history.add(result.entry), transaction); written(drafts.put(result.draft), transaction); }
      if (commit.linkedRoute) written(history.put(commit.linkedRoute), transaction);
      await done;
      if (database === db) { rememberHistory(commit); rememberRecord('practiceDrafts', result.draft); }
      return { ...result, ...commit };
    } catch (failure) { return rollback(transaction, done, failure); }
  }

  function restorePrepared(candidate: PreparedStudyImport) {
    return enqueue(async () => {
      const snapshot = imports.snapshot(candidate);
      const db = await getDatabase();
      const transaction = db.transaction([...STORES], 'readwrite');
      const done = completion(transaction);
      try {
        STORES.forEach(name => transaction.objectStore(name).clear());
        const put = (name: typeof STORES[number], value: unknown, key?: IDBValidKey) => {
          const store = transaction.objectStore(name);
          written(key === undefined ? store.put(value) : store.put(value, key), transaction);
        };
        put('preferences', snapshot.preferences, 'current');
        put('profile', snapshot.profile, 'current');
        snapshot.exercises.forEach(exercise => put('exercises', exercise));
        snapshot.history.forEach(entry => put('history', entry));
        snapshot.practiceDrafts.forEach(draft => put('practiceDrafts', draft));
        snapshot.rhythmProjects.forEach(project => put('rhythmProjects', project));
        if (snapshot.activeRhythmProjectId !== null) put('preferences', snapshot.activeRhythmProjectId, RHYTHM_SELECTION_KEY);
        await done;
      } catch (failure) { return rollback(transaction, done, failure); }
      if (database === db) { installSnapshot(snapshot); skippedRecords = []; }
      imports.consume(candidate);
      return { status: 'restored' as const, exercises: snapshot.exercises.length, history: snapshot.history.length, snapshot };
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
    deletePracticeDraft: (id: string) => enqueue(() => remove('practiceDrafts', id)),
    drainDraft: (request: DrainDraftRequest) => enqueue(() => drainDraft(request)),
    async savePreferences(preferences: AppPreferences) {
      const validated = validatePreferences(preferences);
      return enqueue(async () => {
        await write('preferences', validated, 'current');
        if (cachedSnapshot && database) cachedSnapshot = Object.freeze({ ...cachedSnapshot, preferences: validated });
      });
    },
    async saveExercise(exercise: UserExercise) {
      const validated = validateStoredExercise(exercise);
      return enqueue(async () => { await write('exercises', validated); rememberRecord('exercises', validated); });
    },
    deleteExercise: (id: string) => enqueue(() => remove('exercises', id)),
    async addHistory(entry: HistoryEntry) { const validated = validateHistoryEntry(entry); return enqueue(() => addHistory(validated)); },
    deleteHistory: (id: string) => enqueue(() => remove('history', id)),
    async changeRhythmLibrary(change: RhythmLibraryChange) { const validated = validateRhythmLibraryChange(change); return enqueue(() => mutateRhythmProjects(validated)); },
    exportBackup: () => enqueue(async () => backupJson(await read(), 'Копия превышает предел 64 МиБ. Данные в базе сохранены; для такого объёма нужен расширенный формат архива.')),
    prepareImport: imports.prepare,
    restorePrepared,
    close: () => enqueue(async () => { imports.clear(); database?.close(); database = null; installSnapshot(null); }),
  };
}
