import { MAX_BACKUP_BYTES, StudyStorageError, type HistoryEntry, type UserExercise, type StudySnapshot, type PracticeDraft } from './model';
import type { RhythmLibraryChange } from './rhythm-library';

/** Pure snapshot rules shared by the IndexedDB cache and the in-memory store. */
export type RecordKind = 'exercises' | 'history' | 'practiceDrafts';
export type RecordValue = UserExercise | HistoryEntry | PracticeDraft;

const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function validateRecordId(id: string): string {
  if (typeof id !== 'string' || !id.trim() || id.length > 160) throw new StudyStorageError('INVALID_DATA', 'Некорректный ID удаляемой записи.');
  return id;
}

export function withRecord(snapshot: StudySnapshot, kind: RecordKind, value: RecordValue): StudySnapshot {
  const records = [...(snapshot[kind] as readonly RecordValue[]).filter(item => item.id !== value.id), value].sort(byId);
  return Object.freeze({ ...snapshot, [kind]: Object.freeze(records) });
}

export function withoutRecord(snapshot: StudySnapshot, kind: RecordKind, id: string): StudySnapshot {
  return Object.freeze({ ...snapshot, [kind]: Object.freeze((snapshot[kind] as readonly RecordValue[]).filter(item => item.id !== id)) });
}

/** Applies a library change; `activeId` is the selection the change leaves behind. */
export function withRhythmChange(snapshot: StudySnapshot, change: RhythmLibraryChange): { snapshot: StudySnapshot; activeId: string | null } {
  let { rhythmProjects, activeRhythmProjectId } = snapshot;
  switch (change.kind) {
    case 'save':
      rhythmProjects = Object.freeze([...rhythmProjects.filter(item => item.id !== change.project.id), change.project].sort(byId));
      activeRhythmProjectId = change.project.id;
      break;
    case 'select':
      if (change.id !== null && !rhythmProjects.some(project => project.id === change.id)) throw new StudyStorageError('MISSING_RHYTHM_PROJECT', 'Проект ритма отсутствует.');
      activeRhythmProjectId = change.id;
      break;
    case 'delete':
      rhythmProjects = Object.freeze(rhythmProjects.filter(project => project.id !== change.id));
      if (activeRhythmProjectId === change.id) activeRhythmProjectId = null;
      break;
  }
  return { snapshot: Object.freeze({ ...snapshot, rhythmProjects, activeRhythmProjectId }), activeId: activeRhythmProjectId };
}

export function backupJson(snapshot: StudySnapshot, tooLargeMessage: string): string {
  const json = JSON.stringify(snapshot);
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new StudyStorageError('BACKUP_TOO_LARGE', tooLargeMessage);
  return json;
}
