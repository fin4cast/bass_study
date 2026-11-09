import { previewImport, StudyStorageError } from './model';

export type PreparedStudyImport = Readonly<ReturnType<typeof previewImport>>;

/** Only a fully validated candidate from this adapter can be committed. */
export function createImportPreparation() {
  let candidates = new WeakSet<PreparedStudyImport>();
  return {
    prepare(json: string): PreparedStudyImport {
      const candidate = Object.freeze(previewImport(json));
      candidates.add(candidate);
      return candidate;
    },
    snapshot(candidate: PreparedStudyImport) {
      if (!candidates.has(candidate)) throw new StudyStorageError('INVALID_BACKUP', 'Предпросмотр копии устарел. Выберите файл заново.');
      return candidate.snapshot;
    },
    consume(candidate: PreparedStudyImport) { candidates.delete(candidate); },
    clear() { candidates = new WeakSet(); },
  };
}
