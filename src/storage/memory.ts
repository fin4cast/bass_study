import {
  STUDY_SCHEMA_VERSION, StudyStorageError, emptySnapshot, validateHistoryEntry, validatePreferences, validatePreset,
  validateProfile, validatePracticeDraft, mergePracticeDraft, applyDraftDrain,
  type SkippedRecord, type AppPreferences, type HistoryEntry, type Preset, type StudySnapshot, type GlobalProfile, type PracticeDraft, type DrainDraftRequest,
} from './model';
import { createImportPreparation, type PreparedStudyImport } from './prepared-import';
import { createHistoryLinks, type HistoryCommit } from './history-links';
import { validateRhythmLibraryChange, type RhythmLibraryChange } from './rhythm-library';
import { backupJson, validateRecordId, withRecord, withRhythmChange, withoutRecord, type RecordKind } from './snapshot-ops';

/** Volatile fallback, chosen explicitly by the application after initial IndexedDB failure. */
export function createMemoryStudyStore() {
  const imports = createImportPreparation();
  let snapshot: StudySnapshot = emptySnapshot();
  let historyLinks = createHistoryLinks(snapshot.history);
  let queue: Promise<void> = Promise.resolve();
  function enqueue<T>(operation: () => T): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  function remove(kind: RecordKind, id: string) {
    snapshot = withoutRecord(snapshot, kind, validateRecordId(id));
    if (kind === 'history') historyLinks.remove(id);
  }
  function rememberHistory(commit: HistoryCommit) {
    for (const entry of [commit.entry, commit.linkedRoute]) {
      if (!entry) continue;
      historyLinks.remember(entry);
      snapshot = withRecord(snapshot, 'history', entry);
    }
  }
  function restorePrepared(candidate: PreparedStudyImport) {
    return enqueue(() => {
      snapshot = imports.snapshot(candidate);
      historyLinks = createHistoryLinks(snapshot.history);
      imports.consume(candidate);
      return { status: 'restored' as const, presets: snapshot.presets.length, history: snapshot.history.length, snapshot };
    });
  }
  return {
    open: () => enqueue(() => ({ name: 'bass-study-memory', version: STUDY_SCHEMA_VERSION })),
    readSnapshot: (_options: { fresh?: boolean } = {}) => enqueue(() => snapshot),
    skippedRecords: (): readonly SkippedRecord[] => [],
    async saveProfile(profile: GlobalProfile) { const validated = validateProfile(profile); return enqueue(() => { snapshot = Object.freeze({ ...snapshot, profile: validated }); }); },
    async upsertPracticeDraft(draft: PracticeDraft) {
      const validated = validatePracticeDraft(draft);
      return enqueue(() => {
        const merged = mergePracticeDraft(snapshot.practiceDrafts.find(item => item.id === validated.id), validated);
        snapshot = withRecord(snapshot, 'practiceDrafts', merged);
        return merged;
      });
    },
    deletePracticeDraft: (id: string) => enqueue(() => remove('practiceDrafts', id)),
    drainDraft: (request: DrainDraftRequest) => enqueue(() => {
      const current = snapshot.practiceDrafts.find(item => item.id === request.draftId);
      if (!current) throw new StudyStorageError('MISSING_DRAFT', 'Черновик отсутствует.');
      const result = applyDraftDrain(current, request, snapshot.history.find(item => item.id === request.historyId));
      const commit = historyLinks.plan(result.entry);
      rememberHistory(commit);
      snapshot = withRecord(snapshot, 'practiceDrafts', result.draft);
      return { ...result, ...commit };
    }),
    async savePreferences(preferences: AppPreferences) {
      const validated = validatePreferences(preferences);
      return enqueue(() => { snapshot = Object.freeze({ ...snapshot, preferences: validated }); });
    },
    async savePreset(preset: Preset) {
      const validated = validatePreset(preset);
      return enqueue(() => { snapshot = withRecord(snapshot, 'presets', validated); });
    },
    deletePreset: (id: string) => enqueue(() => remove('presets', id)),
    async addHistory(entry: HistoryEntry) {
      const validated = validateHistoryEntry(entry);
      return enqueue(() => { const commit = historyLinks.plan(validated); rememberHistory(commit); return commit; });
    },
    deleteHistory: (id: string) => enqueue(() => remove('history', id)),
    async changeRhythmLibrary(change: RhythmLibraryChange) {
      const validated = validateRhythmLibraryChange(change);
      return enqueue(() => {
        const next = withRhythmChange(snapshot, validated);
        snapshot = next.snapshot;
        return Object.freeze({ change: validated, activeId: next.activeId });
      });
    },
    exportBackup: () => enqueue(() => backupJson(snapshot, 'Копия превышает предел 64 МиБ. Для такого объёма нужен расширенный формат архива.')),
    prepareImport: imports.prepare,
    restorePrepared,
    // Closing the adapter does not pretend that volatile data became persistent.
    close: () => enqueue(imports.clear),
  };
}
