import {
  DEFAULT_PREFERENCES, MAX_BACKUP_BYTES, StudyStorageError, parseBackup, validateHistoryEntry, validatePreferences, validatePreset, validateSnapshot,
  migrateV1Preferences, migrateV1Preset, migrateV1HistoryEntry,
  migrateV2Preferences, migrateV2Preset, migrateV2HistoryEntry,
  migrateV3Preferences, migrateV3Preset, migrateV3HistoryEntry,
  migrateV4Preferences, migrateV4Preset, migrateV4HistoryEntry,
  migrateV5Preferences, migrateV5Preset, migrateV5HistoryEntry,
  migrateV6Preferences, migrateV6Preset, migrateV6HistoryEntry,
  DEFAULT_PROFILE, validateProfile, validatePracticeDraft, mergePracticeDraft, applyDraftDrain,
  type AppPreferences, type HistoryEntry, type Preset, type StudySnapshot, type GlobalProfile, type PracticeDraft, type DrainDraftRequest,
} from './model';

export * from './model';
export { createMemoryStudyStore } from './memory';
export const STUDY_DB_NAME = 'bass-study';
export const STUDY_DB_VERSION = 7;
const STORES = ['preferences', 'presets', 'history', 'profile', 'practiceDrafts'] as const;

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

  function rememberRecord(kind: 'presets' | 'history' | 'practiceDrafts', value: Preset | HistoryEntry | PracticeDraft) {
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
        if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
        if (!db.objectStoreNames.contains('practiceDrafts')) db.createObjectStore('practiceDrafts', { keyPath: 'id' });
        if (event.oldVersion < 6) request.transaction!.objectStore('profile').put(DEFAULT_PROFILE, 'current');
        if (event.oldVersion >= 1 && event.oldVersion <= 6) {
          const transaction = request.transaction!;
          const migrations = event.oldVersion === 1
            ? { preferences: migrateV1Preferences, presets: migrateV1Preset, history: migrateV1HistoryEntry }
            : event.oldVersion === 2 ? { preferences: migrateV2Preferences, presets: migrateV2Preset, history: migrateV2HistoryEntry }
            : event.oldVersion === 3 ? { preferences: migrateV3Preferences, presets: migrateV3Preset, history: migrateV3HistoryEntry }
            : event.oldVersion === 4 ? { preferences: migrateV4Preferences, presets: migrateV4Preset, history: migrateV4HistoryEntry }
            : event.oldVersion === 5 ? { preferences: migrateV5Preferences, presets: migrateV5Preset, history: migrateV5HistoryEntry }
            : { preferences: migrateV6Preferences, presets: migrateV6Preset, history: migrateV6HistoryEntry };
          let aborted = false;
          for (const name of ['preferences', 'presets', 'history'] as const) {
            let recordNumber = 0;
            const cursorRequest = transaction.objectStore(name).openCursor();
            cursorRequest.onsuccess = () => {
              if (aborted) return;
              const cursor = cursorRequest.result;
              if (!cursor) return;
              recordNumber++;
              try { cursor.update(migrations[name](cursor.value)); cursor.continue(); }
              catch (error) {
                const record = name === 'preferences'
                  ? cursor.key === 'current' ? 'Текущие настройки (preferences/current)' : `Запись настроек №${recordNumber} (preferences)`
                  : name === 'presets' ? `Пресет №${recordNumber} (presets)` : `Запись истории №${recordNumber} (history)`;
                aborted = true;
                migrationFailure = error instanceof StudyStorageError ? new StudyStorageError(error.code, `${record}: ${error.message}`) : error;
                transaction.abort();
              }
            };
          }
          // Версия 6 уже владеет этими данными: проверить, не перезаписывая.
          if (event.oldVersion === 6) for (const name of ['profile', 'practiceDrafts'] as const) {
            const cursorRequest = transaction.objectStore(name).openCursor();
            cursorRequest.onsuccess = () => {
              if (aborted) return;
              const cursor = cursorRequest.result;
              if (!cursor) return;
              try { if (name === 'profile') validateProfile(cursor.value); else validatePracticeDraft(cursor.value); cursor.continue(); }
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
    const [preferences, presets, history, profile, practiceDrafts] = await Promise.all([
      requestValue<unknown>(transaction.objectStore('preferences').get('current')),
      requestValue<unknown[]>(transaction.objectStore('presets').getAll()),
      requestValue<unknown[]>(transaction.objectStore('history').getAll()),
      requestValue<unknown>(transaction.objectStore('profile').get('current')),
      requestValue<unknown[]>(transaction.objectStore('practiceDrafts').getAll()), done,
    ]);
    const snapshot = validateSnapshot({ format: 'bass-study-backup', schemaVersion: 7, preferences: preferences ?? DEFAULT_PREFERENCES, presets, history, profile: profile ?? DEFAULT_PROFILE, practiceDrafts });
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

  async function remove(name: 'presets' | 'history' | 'practiceDrafts', id: string): Promise<void> {
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
      if (!existing) {
        for (const write of [history.add(result.entry), drafts.put(result.draft)]) write.addEventListener('success', () => {
          lastTransaction.successfulWrites++;
          if (lastTransaction.successfulWrites === request.failAfterWrite) { injectedAbort = true; transaction.abort(); }
        });
      }
      await done;
      if (database === db) { rememberRecord('history', result.entry); rememberRecord('practiceDrafts', result.draft); }
      return result;
    } catch (failure) { try { transaction.abort(); } catch { /* already completed */ } await done.catch(() => {}); throw failure; }
  }

  return {
    open: () => enqueue(async () => { const db = await getDatabase(); return { name: db.name, version: db.version }; }),
    /** The application holds the writer lease. Use fresh for explicit external-change checks. */
    readSnapshot: (options: { fresh?: boolean } = {}) => enqueue(() => read(options.fresh === true)),
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
      const totalWrites = 2 + snapshot.presets.length + snapshot.history.length + snapshot.practiceDrafts.length;
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
        const writes: IDBRequest[] = [transaction.objectStore('preferences').put(snapshot.preferences, 'current'), transaction.objectStore('profile').put(snapshot.profile, 'current')];
        snapshot.presets.forEach(preset => writes.push(transaction.objectStore('presets').put(preset)));
        snapshot.history.forEach(entry => writes.push(transaction.objectStore('history').put(entry)));
        snapshot.practiceDrafts.forEach(draft => writes.push(transaction.objectStore('practiceDrafts').put(draft)));
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
