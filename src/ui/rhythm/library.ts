import type { RhythmProject } from '../../rhythm/model';

export type RhythmLibraryOperation = { readonly kind: 'save'; readonly project: RhythmProject }
  | { readonly kind: 'select'; readonly id: string | null } | { readonly kind: 'delete'; readonly id: string };
export interface RhythmLibrary { readonly projects: readonly RhythmProject[]; readonly activeId: string | null }

interface RhythmLibraryOptions {
  readonly write?: (operation: RhythmLibraryOperation, onCommit: (library: RhythmLibrary) => void) => Promise<void>;
  readonly retry?: () => Promise<boolean>;
  readonly onStateChange: () => void;
  readonly onSelection: (project: RhythmProject | undefined, saveLinkedTempo: boolean) => void;
  readonly onNotice: (message: string) => void;
  readonly onFailure: (error: unknown) => void;
}

export function createRhythmLibrary(options: RhythmLibraryOptions) {
  let confirmed: RhythmLibrary = { projects: [], activeId: null };
  let revision = 0, disposed = false, pending = false, locked = false;
  let failed: { kind: RhythmLibraryOperation['kind']; locksEditor: boolean } | null = null;

  function setPending(next: boolean, locksEditor = false) {
    pending = next;
    locked = locksEditor;
    options.onStateChange();
  }

  function select(saveLinkedTempo: boolean) {
    options.onSelection(confirmed.projects.find(project => project.id === confirmed.activeId), saveLinkedTempo);
  }

  async function write(operation: RhythmLibraryOperation, replace = false, notice?: string) {
    if (disposed || !options.write) return;
    const expected = ++revision;
    const locksEditor = replace || operation.kind !== 'save';
    let committed = false;
    failed = null;
    setPending(true, locksEditor);
    try {
      await options.write(operation, next => {
        if (disposed || expected !== revision || committed) return;
        committed = true;
        failed = null;
        confirmed = next;
        setPending(false);
        if (replace) select(true);
        if (notice) options.onNotice(notice);
      });
    } catch (failure) {
      if (disposed || expected !== revision || committed) return;
      failed = { kind: operation.kind, locksEditor };
      setPending(false);
      options.onFailure(failure);
    }
  }

  return {
    get projects() { return confirmed.projects; },
    get revision() { return revision; },
    get pending() { return pending; },
    get locked() { return locked; },
    get failedKind() { return failed?.kind ?? null; },
    write,
    async retry() {
      if (disposed || pending || !failed || !options.retry) return;
      const expected = revision;
      setPending(true, failed.locksEditor);
      try { await options.retry(); }
      finally { if (!disposed && expected === revision && failed) setPending(false); }
    },
    apply(next: RhythmLibrary) {
      if (disposed) return;
      ++revision;
      failed = null;
      confirmed = next;
      setPending(false);
      select(false);
    },
    dispose() { disposed = true; ++revision; },
  };
}
