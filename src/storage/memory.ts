import {
  MAX_BACKUP_BYTES, STUDY_SCHEMA_VERSION, StudyStorageError, emptySnapshot, previewImport, validateHistoryEntry,
  validatePreferences, validatePreset,
  validateProfile, validatePracticeDraft, mergePracticeDraft, applyDraftDrain,
  validateRhythmProjectId, validateStoredRhythmProject,
  type AppPreferences, type HistoryEntry, type Preset, type StudySnapshot, type GlobalProfile, type PracticeDraft, type DrainDraftRequest,
} from './model';
import type { RhythmProject } from '../rhythm/model';

/** Volatile fallback, chosen explicitly by the application after initial IndexedDB failure. */
export function createMemoryStudyStore() {
  let snapshot: StudySnapshot = emptySnapshot();
  let queue: Promise<void> = Promise.resolve();
  function enqueue<T>(operation: () => T): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  function remove(kind: 'presets' | 'history' | 'practiceDrafts', id: string) {
    if (typeof id !== 'string' || !id.trim() || id.length > 160) throw new StudyStorageError('INVALID_DATA', 'Некорректный ID удаляемой записи.');
    snapshot = Object.freeze({ ...snapshot, [kind]: Object.freeze(snapshot[kind].filter(item => item.id !== id)) });
  }
  function remember(kind: 'presets' | 'history' | 'practiceDrafts', value: Preset | HistoryEntry | PracticeDraft) {
    snapshot = Object.freeze({ ...snapshot, [kind]: Object.freeze([...snapshot[kind].filter(item => item.id !== value.id), value].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) });
  }
  return {
    open: () => enqueue(() => ({ name: 'bass-study-memory', version: STUDY_SCHEMA_VERSION })),
    readSnapshot: (_options: { fresh?: boolean } = {}) => enqueue(() => snapshot),
    async saveProfile(profile: GlobalProfile) { const validated = validateProfile(profile); return enqueue(() => { snapshot = Object.freeze({ ...snapshot, profile: validated }); }); },
    async upsertPracticeDraft(draft: PracticeDraft) { const validated = validatePracticeDraft(draft); return enqueue(() => { const merged = mergePracticeDraft(snapshot.practiceDrafts.find(item => item.id === validated.id), validated); remember('practiceDrafts', merged); return merged; }); },
    updateDraftProgress: (id: string, totalReferenceMs: number, suggestedBpm: number, updatedAt: string) => enqueue(() => { const current = snapshot.practiceDrafts.find(item => item.id === id); if (!current) throw new StudyStorageError('MISSING_DRAFT', 'Черновик отсутствует.'); const draft = validatePracticeDraft({ ...current, totalReferenceMs: Math.max(current.totalReferenceMs, totalReferenceMs), suggestedBpm, updatedAt }); remember('practiceDrafts', draft); return draft; }),
    updateDraftText: (id: string, change: Pick<PracticeDraft, 'editRevision' | 'note' | 'comfortableBpm' | 'updatedAt'>) => enqueue(() => { const current = snapshot.practiceDrafts.find(item => item.id === id); if (!current) throw new StudyStorageError('MISSING_DRAFT', 'Черновик отсутствует.'); const draft = change.editRevision > current.editRevision ? validatePracticeDraft({ ...current, ...change }) : current; remember('practiceDrafts', draft); return draft; }),
    deletePracticeDraft: (id: string) => enqueue(() => remove('practiceDrafts', id)),
    drainDraft: (request: DrainDraftRequest) => enqueue(() => {
      if (request.failAfterWrite !== undefined) throw new StudyStorageError('UNSUPPORTED_OPERATION', 'Транзакционный отказ проверяется в IndexedDB.');
      const current = snapshot.practiceDrafts.find(item => item.id === request.draftId);
      if (!current) throw new StudyStorageError('MISSING_DRAFT', 'Черновик отсутствует.');
      const result = applyDraftDrain(current, request, snapshot.history.find(item => item.id === request.historyId));
      const history = [...snapshot.history.filter(item => item.id !== result.entry.id), result.entry].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const practiceDrafts = snapshot.practiceDrafts.map(item => item.id === result.draft.id ? result.draft : item);
      snapshot = Object.freeze({ ...snapshot, history: Object.freeze(history), practiceDrafts: Object.freeze(practiceDrafts) });
      return result;
    }),
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
    async saveRhythmProject(project: RhythmProject) {
      const validated = validateStoredRhythmProject(project);
      return enqueue(() => {
        const rhythmProjects = [...snapshot.rhythmProjects.filter(item => item.id !== validated.id), validated].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        snapshot = Object.freeze({ ...snapshot, rhythmProjects: Object.freeze(rhythmProjects), activeRhythmProjectId: validated.id });
        return validated;
      });
    },
    async selectRhythmProject(id: string | null) {
      const validated = id === null ? null : validateRhythmProjectId(id);
      return enqueue(() => {
        if (validated !== null && !snapshot.rhythmProjects.some(project => project.id === validated)) throw new StudyStorageError('MISSING_RHYTHM_PROJECT', 'Проект ритма отсутствует.');
        snapshot = Object.freeze({ ...snapshot, activeRhythmProjectId: validated });
      });
    },
    async deleteRhythmProject(id: string) {
      const validated = validateRhythmProjectId(id);
      return enqueue(() => {
        const rhythmProjects = Object.freeze(snapshot.rhythmProjects.filter(project => project.id !== validated));
        const activeRhythmProjectId = snapshot.activeRhythmProjectId === validated ? null : snapshot.activeRhythmProjectId;
        snapshot = Object.freeze({ ...snapshot, rhythmProjects, activeRhythmProjectId });
      });
    },
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
