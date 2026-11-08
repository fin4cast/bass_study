import {
  MAX_BACKUP_BYTES, StudyStorageError, emptySnapshot, parseBackup, validateHistoryEntry,
  validatePreferences, validatePreset,
  type AppPreferences, type HistoryEntry, type Preset, type StudySnapshot,
} from './model';

/** Volatile fallback, chosen explicitly by the application after initial IndexedDB failure. */
export function createMemoryStudyStore() {
  let snapshot: StudySnapshot = emptySnapshot();
  let queue: Promise<void> = Promise.resolve();
  function enqueue<T>(operation: () => T): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  function remove(kind: 'presets' | 'history', id: string) {
    if (typeof id !== 'string' || !id.trim() || id.length > 160) throw new StudyStorageError('INVALID_DATA', 'Некорректный ID удаляемой записи.');
    snapshot = Object.freeze({ ...snapshot, [kind]: Object.freeze(snapshot[kind].filter(item => item.id !== id)) });
  }
  function remember(kind: 'presets' | 'history', value: Preset | HistoryEntry) {
    snapshot = Object.freeze({ ...snapshot, [kind]: Object.freeze([...snapshot[kind].filter(item => item.id !== value.id), value].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) });
  }
  function previewImport(json: string) {
    const imported = parseBackup(json);
    return { snapshot: imported, presets: imported.presets.length, history: imported.history.length, requiresConfirmation: true as const, replacement: 'full' as const };
  }
  return {
    open: () => enqueue(() => ({ name: 'bass-study-memory', version: 2 })),
    readSnapshot: (_options: { fresh?: boolean } = {}) => enqueue(() => snapshot),
    async savePreferences(preferences: AppPreferences) {
      const validated = validatePreferences(preferences);
      return enqueue(() => { snapshot = Object.freeze({ ...snapshot, preferences: validated }); });
    },
    async savePreset(preset: Preset) {
      const validated = validatePreset(preset);
      return enqueue(() => remember('presets', validated));
    },
    deletePreset: (id: string) => enqueue(() => remove('presets', id)),
    async addHistory(entry: HistoryEntry) {
      const validated = validateHistoryEntry(entry);
      return enqueue(() => remember('history', validated));
    },
    deleteHistory: (id: string) => enqueue(() => remove('history', id)),
    exportBackup: () => enqueue(() => {
      const json = JSON.stringify(snapshot);
      if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new StudyStorageError('BACKUP_TOO_LARGE', 'Копия превышает предел 64 МиБ. Для такого объёма нужен расширенный формат архива.');
      return json;
    }),
    previewImport,
    async restore(json: string, options: { confirmed: boolean; failAfterWrite?: number }) {
      const { snapshot: imported } = previewImport(json);
      if (!options?.confirmed) return { status: 'cancelled' as const };
      if (options.failAfterWrite !== undefined) throw new StudyStorageError('UNSUPPORTED_OPERATION', 'Тест транзакционного отказа доступен только для IndexedDB.');
      return enqueue(() => {
        snapshot = imported;
        return { status: 'restored' as const, presets: snapshot.presets.length, history: snapshot.history.length };
      });
    },
    // Closing the adapter does not pretend that volatile data became persistent.
    close: () => enqueue(() => undefined),
  };
}
