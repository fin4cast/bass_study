import {
  DEFAULT_PREFERENCES, MAX_BACKUP_BYTES, StudyStorageError, parseBackup, validateHistoryEntry, validatePreferences, validatePreset, validateSnapshot,
  migrateV1Preferences, migrateV1Preset, migrateV1HistoryEntry,
  type AppPreferences, type HistoryEntry, type Preset, type StudySnapshot,
} from './model';

export * from './model';
export { createMemoryStudyStore } from './memory';
export const STUDY_DB_NAME = 'bass-study';
export const STUDY_DB_VERSION = 2;
const STORES = ['preferences', 'presets', 'history'] as const;

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

/** Native IndexedDB adapter. Each ordinary write only touches its own store. */
export function createStudyStore() {
  let database: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let lastTransaction = { successfulWrites: 0, aborted: false };
  let cachedSnapshot: StudySnapshot | null = null;

  function rememberRecord(kind: 'presets' | 'history', value: Preset | HistoryEntry) {
    if (!cachedSnapshot || !database) return;
    const records = [...cachedSnapshot[kind].filter(item => item.id !== value.id), value].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    cachedSnapshot = Object.freeze({ ...cachedSnapshot, [kind]: Object.freeze(records) });
  }

  async function getDatabase(): Promise<IDBDatabase> {
    if (database) return database;
    if (opening) return opening;
    if (!globalThis.indexedDB) throw new StudyStorageError('UNAVAILABLE', 'Браузерное хранилище недоступно. Занятия можно продолжить в памяти, но история не сохранится.');
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      let rejected = false;
      let migrationFailure: unknown;
      const request = indexedDB.open(STUDY_DB_NAME, STUDY_DB_VERSION);
      request.onupgradeneeded = event => {
        const db = request.result;
        if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences');
        if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
        if (event.oldVersion === 1) {
          const transaction = request.transaction!;
          const migrations = { preferences: migrateV1Preferences, presets: migrateV1Preset, history: migrateV1HistoryEntry };
          let aborted = false;
          for (const name of STORES) {
            const cursorRequest = transaction.objectStore(name).openCursor();
            cursorRequest.onsuccess = () => {
              if (aborted) return;
              const cursor = cursorRequest.result;
              if (!cursor) return;
              try { cursor.update(migrations[name](cursor.value)); cursor.continue(); }
              catch (error) { aborted = true; migrationFailure = error; transaction.abort(); }
            };
          }
        }
      };
      request.onerror = () => { rejected = true; reject(storageError(migrationFailure ?? request.error)); };
      request.onblocked = () => { rejected = true; reject(new StudyStorageError('BLOCKED', 'Открытие базы заблокировано другой вкладкой. Закройте другие вкладки bass_study и повторите операцию.')); };
      request.onsuccess = () => {
        if (rejected) { request.result.close(); return; }
        database = request.result;
        const connection = database;
        const invalidate = () => { if (database === connection) { database = null; cachedSnapshot = null; } };
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
    if (fresh) cachedSnapshot = null;
    const transaction = db.transaction([...STORES], 'readonly');
    const done = completion(transaction);
    const [preferences, presets, history] = await Promise.all([
      requestValue<unknown>(transaction.objectStore('preferences').get('current')),
      requestValue<unknown[]>(transaction.objectStore('presets').getAll()),
      requestValue<unknown[]>(transaction.objectStore('history').getAll()), done,
    ]);
    const snapshot = validateSnapshot({ format: 'bass-study-backup', schemaVersion: 2, preferences: preferences ?? DEFAULT_PREFERENCES, presets, history });
    if (database === db) cachedSnapshot = snapshot;
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

  async function remove(name: 'presets' | 'history', id: string): Promise<void> {
    if (typeof id !== 'string' || !id.trim() || id.length > 160) throw new StudyStorageError('INVALID_DATA', 'Некорректный ID удаляемой записи.');
    const db = await getDatabase();
    const transaction = db.transaction(name, 'readwrite');
    lastTransaction = { successfulWrites: 0, aborted: false };
    const done = completion(transaction, true);
    transaction.objectStore(name).delete(id).addEventListener('success', () => { lastTransaction.successfulWrites++; });
    await done;
    if (cachedSnapshot && database === db) cachedSnapshot = Object.freeze({ ...cachedSnapshot, [name]: Object.freeze(cachedSnapshot[name].filter(item => item.id !== id)) });
  }

  function previewImport(json: string) {
    const snapshot = parseBackup(json);
    return { snapshot, presets: snapshot.presets.length, history: snapshot.history.length, requiresConfirmation: true as const, replacement: 'full' as const };
  }

  return {
    open: () => enqueue(async () => { const db = await getDatabase(); return { name: db.name, version: db.version }; }),
    /** The application holds the writer lease. Use fresh for explicit external-change checks. */
    readSnapshot: (options: { fresh?: boolean } = {}) => enqueue(() => read(options.fresh === true)),
    async savePreferences(preferences: AppPreferences) {
      const validated = validatePreferences(preferences);
      return enqueue(async () => {
        await write('preferences', validated, 'current');
        if (cachedSnapshot && database) cachedSnapshot = Object.freeze({ ...cachedSnapshot, preferences: validated });
      });
    },
    async savePreset(preset: Preset) { const validated = validatePreset(preset); return enqueue(async () => { await write('presets', validated); rememberRecord('presets', validated); }); },
    deletePreset: (id: string) => enqueue(() => remove('presets', id)),
    async addHistory(entry: HistoryEntry) { const validated = validateHistoryEntry(entry); return enqueue(async () => { await write('history', validated); rememberRecord('history', validated); }); },
    deleteHistory: (id: string) => enqueue(() => remove('history', id)),
    exportBackup: () => enqueue(async () => {
      const json = JSON.stringify(await read());
      if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new StudyStorageError('BACKUP_TOO_LARGE', 'Копия превышает предел 64 МиБ. Данные в базе сохранены; для такого объёма нужен расширенный формат архива.');
      return json;
    }),
    previewImport,
    async restore(json: string, options: { confirmed: boolean; failAfterWrite?: number }) {
      const { snapshot } = previewImport(json);
      if (!options?.confirmed) return { status: 'cancelled' as const };
      const totalWrites = 1 + snapshot.presets.length + snapshot.history.length;
      if (options.failAfterWrite !== undefined && (!Number.isInteger(options.failAfterWrite) || options.failAfterWrite < 1 || options.failAfterWrite > totalWrites)) {
        throw new StudyStorageError('INVALID_DATA', 'Некорректная точка тестового отказа транзакции.');
      }
      return enqueue(async () => {
        const db = await getDatabase();
        const transaction = db.transaction([...STORES], 'readwrite');
        lastTransaction = { successfulWrites: 0, aborted: false };
        let injectedAbort = false;
        const done = completion(transaction, true, () => injectedAbort);
        STORES.forEach(name => transaction.objectStore(name).clear());
        const writes: IDBRequest[] = [transaction.objectStore('preferences').put(snapshot.preferences, 'current')];
        snapshot.presets.forEach(preset => writes.push(transaction.objectStore('presets').put(preset)));
        snapshot.history.forEach(entry => writes.push(transaction.objectStore('history').put(entry)));
        writes.forEach(request => request.addEventListener('success', () => {
          lastTransaction.successfulWrites++;
          if (lastTransaction.successfulWrites === options.failAfterWrite) { injectedAbort = true; transaction.abort(); }
        }));
        await done;
        if (database === db) cachedSnapshot = snapshot;
        return { status: 'restored' as const, presets: snapshot.presets.length, history: snapshot.history.length };
      });
    },
    close: () => enqueue(async () => { database?.close(); database = null; cachedSnapshot = null; }),
    getLastTransaction() { return { ...lastTransaction }; },
  };
}
