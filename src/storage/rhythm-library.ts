import type { RhythmProject } from '../rhythm/model';
import { validateRhythmProjectId, validateStoredRhythmProject } from './model';

export type RhythmLibraryChange = { readonly kind: 'save'; readonly project: RhythmProject }
  | { readonly kind: 'select'; readonly id: string | null }
  | { readonly kind: 'delete'; readonly id: string };

export interface RhythmLibraryCommit {
  readonly change: RhythmLibraryChange;
  readonly activeId: string | null;
}

export function validateRhythmLibraryChange(change: RhythmLibraryChange): RhythmLibraryChange {
  switch (change.kind) {
    case 'save': return Object.freeze({ kind: 'save', project: validateStoredRhythmProject(change.project) });
    case 'select': return Object.freeze({ kind: 'select', id: change.id === null ? null : validateRhythmProjectId(change.id) });
    case 'delete': return Object.freeze({ kind: 'delete', id: validateRhythmProjectId(change.id) });
  }
}
