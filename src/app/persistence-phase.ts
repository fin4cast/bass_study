type Phase = 'starting' | 'ready' | 'retrying' | 'restoring' | 'reload' | 'retiring';

export function createPersistencePhase(hasLease: () => boolean, onChange: () => void) {
  let phase: Phase = 'starting';
  let generation = 0;

  function enter(next: Phase) {
    phase = next;
    onChange();
  }

  return {
    get phase() { return phase; },
    get generation() { return generation; },
    get writable() { return hasLease() && (phase === 'ready' || phase === 'retrying'); },
    get exclusiveReady() { return hasLease() && phase === 'ready'; },
    ready() { if (phase === 'starting') enter('ready'); },
    retire() { enter('retiring'); },
    async retry(run: () => Promise<void>) {
      if (phase !== 'ready' || !hasLease()) return false;
      enter('retrying');
      try { await run(); return true; }
      finally { if ((phase as Phase) === 'retrying') enter('ready'); }
    },
    beginRestore() {
      if (phase !== 'ready' || !hasLease()) throw new Error('Дождись завершения сохранения перед восстановлением.');
      enter('restoring');
    },
    committedRestore() { generation++; },
    finishRestore(reload: boolean) {
      if (phase === 'restoring') enter(reload ? 'reload' : 'ready');
    },
  };
}
