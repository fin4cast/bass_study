/** P1-only IndexedDB feasibility probe. This is not the product's data format. */
export const STORAGE_PROBE_DB_NAME = 'bass-study-p1-storage';
export const STORAGE_PROBE_DB_VERSION = 1;
export const BUILTIN_EXERCISE_IDS = ['p1-note-find', 'p1-sequence-up'] as const;

type StringName = 'E' | 'A' | 'D' | 'G';
type BuiltinId = (typeof BUILTIN_EXERCISE_IDS)[number];

export interface ProbeSettings {
  instrument: 'bass-4-eadg';
  bpm: number;
  fretMin: number;
  fretMax: number;
  labelMode: 'notes' | 'degrees' | 'hidden';
}

export interface ProbePreset {
  id: string;
  title: string;
  builtinExerciseId: BuiltinId;
  strings: StringName[];
  fretMin: number;
  fretMax: number;
  rootPitchClass: number;
}

interface HistoryBase {
  id: string;
  presetId: string | null;
  occurredAt: string;
  timeZone: string;
  localDate: string;
}

export type ProbeHistory =
  | (HistoryBase & { kind: 'screen'; attempts: number; correct: number })
  | (HistoryBase & { kind: 'manual'; comfortableBpm: number; note: string });

export interface ProbeSnapshot {
  schemaVersion: 1;
  settings: ProbeSettings;
  presets: ProbePreset[];
  history: ProbeHistory[];
}

/** Fixed synthetic fixtures; no personal practice data is used in P1. */
export const SAMPLE_SNAPSHOT: ProbeSnapshot = {
  schemaVersion: 1,
  settings: {
    instrument: 'bass-4-eadg', bpm: 80, fretMin: 0, fretMax: 12, labelMode: 'notes',
  },
  presets: [
    {
      id: 'synthetic-notes', title: 'Синтетическая проверка нот',
      builtinExerciseId: 'p1-note-find', strings: ['E', 'A'],
      fretMin: 0, fretMax: 5, rootPitchClass: 9,
    },
    {
      id: 'synthetic-sequence', title: 'Синтетическая последовательность',
      builtinExerciseId: 'p1-sequence-up', strings: ['D', 'G'],
      fretMin: 0, fretMax: 12, rootPitchClass: 0,
    },
  ],
  history: [
    {
      id: 'synthetic-screen', presetId: 'synthetic-notes',
      occurredAt: '2026-11-08T09:00:00.000Z', timeZone: 'Europe/Moscow',
      localDate: '2026-11-08', kind: 'screen', attempts: 10, correct: 8,
    },
    {
      id: 'synthetic-manual', presetId: 'synthetic-sequence',
      occurredAt: '2026-11-08T09:05:00.000Z', timeZone: 'Europe/Moscow',
      localDate: '2026-11-08', kind: 'manual', comfortableBpm: 72,
      note: 'Синтетическая ручная отметка; не измерение игры.',
    },
  ],
};

export class StorageProbeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'StorageProbeError';
  }
}

type RecordValue = Record<string, unknown>;
const STORE_NAMES = ['settings', 'presets', 'history'] as const;
const MAX_IMPORT_LENGTH = 1_048_576;

function invalid(message: string): never {
  throw new StorageProbeError('INVALID_BACKUP', message);
}

function object(value: unknown, name: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${name} must be an object`);
  }
  return value as RecordValue;
}

function keys(value: RecordValue, expected: string[], name: string): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    invalid(`${name} has missing or unexpected fields`);
  }
}

function text(value: unknown, name: string, limit = 160): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
    invalid(`${name} must be a nonempty string of at most ${limit} characters`);
  }
}

function integer(value: unknown, min: number, max: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid(`${name} must be an integer in ${min}..${max}`);
  }
}

function range(value: RecordValue, name: string): void {
  integer(value.fretMin, 0, 24, `${name}.fretMin`);
  integer(value.fretMax, 0, 24, `${name}.fretMax`);
  if (value.fretMin > value.fretMax) invalid(`${name} has an inverted fret range`);
}

function array(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > 10_000) invalid(`${name} must be a bounded array`);
}

function validateSnapshot(value: unknown): ProbeSnapshot {
  const snapshot = object(value, 'backup');
  keys(snapshot, ['schemaVersion', 'settings', 'presets', 'history'], 'backup');
  if (snapshot.schemaVersion !== 1) {
    throw new StorageProbeError('UNSUPPORTED_VERSION', 'Only schemaVersion 1 is supported by this probe');
  }
  const settings = object(snapshot.settings, 'settings');
  keys(settings, ['instrument', 'bpm', 'fretMin', 'fretMax', 'labelMode'], 'settings');
  if (settings.instrument !== 'bass-4-eadg') invalid('Unsupported instrument');
  integer(settings.bpm, 40, 220, 'settings.bpm');
  range(settings, 'settings');
  if (!['notes', 'degrees', 'hidden'].includes(settings.labelMode as string)) {
    invalid('Unsupported labelMode');
  }

  array(snapshot.presets, 'presets');
  array(snapshot.history, 'history');
  const presetIds = new Set<string>();
  for (const candidate of snapshot.presets) {
    const preset = object(candidate, 'preset');
    keys(preset, ['id', 'title', 'builtinExerciseId', 'strings', 'fretMin', 'fretMax', 'rootPitchClass'], 'preset');
    text(preset.id, 'preset.id');
    text(preset.title, 'preset.title');
    if (presetIds.has(preset.id)) invalid('Duplicate preset ID');
    presetIds.add(preset.id);
    if (!BUILTIN_EXERCISE_IDS.includes(preset.builtinExerciseId as BuiltinId)) {
      invalid('Unknown built-in exercise reference');
    }
    array(preset.strings, 'preset.strings');
    if (preset.strings.length === 0 || preset.strings.length > 4
      || new Set(preset.strings).size !== preset.strings.length
      || preset.strings.some(item => typeof item !== 'string' || !['E', 'A', 'D', 'G'].includes(item))) {
      invalid('preset.strings must contain distinct E/A/D/G strings');
    }
    range(preset, 'preset');
    integer(preset.rootPitchClass, 0, 11, 'preset.rootPitchClass');
  }

  const historyIds = new Set<string>();
  for (const candidate of snapshot.history) {
    const item = object(candidate, 'history item');
    const base = ['id', 'presetId', 'occurredAt', 'timeZone', 'localDate', 'kind'];
    if (item.kind === 'screen') {
      keys(item, [...base, 'attempts', 'correct'], 'screen history item');
      integer(item.attempts, 0, 1_000_000, 'history.attempts');
      integer(item.correct, 0, item.attempts as number, 'history.correct');
    } else if (item.kind === 'manual') {
      keys(item, [...base, 'comfortableBpm', 'note'], 'manual history item');
      integer(item.comfortableBpm, 40, 220, 'history.comfortableBpm');
      text(item.note, 'history.note', 2_000);
    } else invalid('History must be explicitly screen or manual');
    text(item.id, 'history.id');
    if (historyIds.has(item.id)) invalid('Duplicate history ID');
    historyIds.add(item.id);
    if (item.presetId !== null && (typeof item.presetId !== 'string' || !presetIds.has(item.presetId))) {
      invalid('Unknown history preset reference');
    }
    text(item.occurredAt, 'history.occurredAt');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.occurredAt)
      || !Number.isFinite(Date.parse(item.occurredAt))
      || new Date(item.occurredAt).toISOString() !== item.occurredAt) {
      invalid('history.occurredAt must be a valid canonical UTC timestamp');
    }
    text(item.timeZone, 'history.timeZone');
    text(item.localDate, 'history.localDate');
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: item.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(item.occurredAt));
    } catch {
      invalid('Invalid history time zone');
    }
    const part = (type: string) => parts.find(entry => entry.type === type)?.value;
    if (`${part('year')}-${part('month')}-${part('day')}` !== item.localDate) {
      invalid('history.localDate does not match its original timestamp and time zone');
    }
  }

  // JSON round-trip provides a detached plain-data copy after all validation.
  return JSON.parse(JSON.stringify(value)) as ProbeSnapshot;
}

function parseBackup(json: string): ProbeSnapshot {
  if (typeof json !== 'string' || json.length > MAX_IMPORT_LENGTH) invalid('Backup is not a bounded JSON string');
  let value: unknown;
  try { value = JSON.parse(json); } catch { invalid('Malformed JSON'); }
  return validateSnapshot(value);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new StorageProbeError('IDB_REQUEST', 'Request failed'));
  });
}

export function createStorageProbe() {
  let database: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  let lastTransaction = { successfulWrites: 0, aborted: false };

  async function getDatabase(): Promise<IDBDatabase> {
    if (database) return database;
    if (opening) return opening;
    if (!globalThis.indexedDB) throw new StorageProbeError('IDB_UNAVAILABLE', 'IndexedDB is unavailable');
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(STORAGE_PROBE_DB_NAME, STORAGE_PROBE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('settings');
        db.createObjectStore('presets', { keyPath: 'id' });
        db.createObjectStore('history', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error ?? new StorageProbeError('IDB_OPEN', 'Could not open database'));
      request.onblocked = () => reject(new StorageProbeError('IDB_BLOCKED', 'Database upgrade blocked by another connection'));
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => { database?.close(); database = null; };
        resolve(database);
      };
    });
    try { return await opening; } finally { opening = null; }
  }

  function completion(transaction: IDBTransaction, injected: () => boolean = () => false): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => {
        lastTransaction.aborted = true;
        reject(injected()
          ? new StorageProbeError('INJECTED_ABORT', 'Transaction aborted after a successful write for rollback testing')
          : transaction.error ?? new StorageProbeError('IDB_ABORT', 'Transaction aborted'));
      };
      // The abort event reports transaction failure, including request failures.
      transaction.onerror = () => {};
    });
  }

  async function replace(snapshot: ProbeSnapshot, failAfterWrite?: number): Promise<void> {
    const totalWrites = 1 + snapshot.presets.length + snapshot.history.length;
    if (failAfterWrite !== undefined) integer(failAfterWrite, 1, totalWrites, 'failAfterWrite');
    const db = await getDatabase();
    const transaction = db.transaction([...STORE_NAMES], 'readwrite');
    lastTransaction = { successfulWrites: 0, aborted: false };
    let injectionTriggered = false;
    const done = completion(transaction, () => injectionTriggered);
    for (const name of STORE_NAMES) transaction.objectStore(name).clear();
    const writes: IDBRequest[] = [transaction.objectStore('settings').put(snapshot.settings, 'current')];
    for (const preset of snapshot.presets) writes.push(transaction.objectStore('presets').put(preset));
    for (const item of snapshot.history) writes.push(transaction.objectStore('history').put(item));
    for (const request of writes) request.addEventListener('success', () => {
      lastTransaction.successfulWrites += 1;
      if (lastTransaction.successfulWrites === failAfterWrite) {
        injectionTriggered = true;
        transaction.abort();
      }
    });
    await done;
  }

  async function read(): Promise<ProbeSnapshot | null> {
    const db = await getDatabase();
    const transaction = db.transaction([...STORE_NAMES], 'readonly');
    const done = completion(transaction);
    const [settings, presets, history] = await Promise.all([
      requestResult<ProbeSettings | undefined>(transaction.objectStore('settings').get('current')),
      requestResult<ProbePreset[]>(transaction.objectStore('presets').getAll()),
      requestResult<ProbeHistory[]>(transaction.objectStore('history').getAll()),
      done,
    ]);
    if (!settings) {
      if (presets.length || history.length) throw new StorageProbeError('IDB_INCOMPLETE', 'Settings missing from stored snapshot');
      return null;
    }
    return validateSnapshot({ schemaVersion: 1, settings, presets, history });
  }

  return {
    async open() {
      const db = await getDatabase();
      return { name: db.name, version: db.version };
    },
    async seed(snapshot: ProbeSnapshot = SAMPLE_SNAPSHOT) {
      const validated = validateSnapshot(snapshot);
      await replace(validated);
      return read();
    },
    read,
    async exportBackup() {
      const snapshot = await read();
      if (!snapshot) throw new StorageProbeError('NO_DATA', 'No snapshot to export');
      return JSON.stringify(snapshot, null, 2);
    },
    previewImport(json: string) {
      const snapshot = parseBackup(json);
      return {
        schemaVersion: snapshot.schemaVersion,
        presets: snapshot.presets.length,
        history: snapshot.history.length,
        replacement: 'full' as const,
        requiresConfirmation: true,
        snapshot,
      };
    },
    async restore(json: string, options: { confirmed: boolean; failAfterWrite?: number }) {
      const snapshot = parseBackup(json);
      if (!options?.confirmed) return { status: 'cancelled' as const };
      await replace(snapshot, options.failAfterWrite);
      return { status: 'restored' as const, presets: snapshot.presets.length, history: snapshot.history.length };
    },
    async clear() {
      const db = await getDatabase();
      const transaction = db.transaction([...STORE_NAMES], 'readwrite');
      const done = completion(transaction);
      for (const name of STORE_NAMES) transaction.objectStore(name).clear();
      await done;
    },
    close() { database?.close(); database = null; },
    getLastTransaction() { return { ...lastTransaction }; },
  };
}
