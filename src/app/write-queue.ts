/** Serializes UI writes and keeps failed operations available for explicit retry. */
export function createWriteQueue(onChange: (state: { pending: number; failures: readonly string[] }) => void) {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  let serial = 0;
  const generations = new Map<string, number>();
  const failures = new Map<string, { operation: () => Promise<unknown>; message: string; generation: number }>();
  const notify = () => onChange({ pending, failures: [...failures.values()].map(item => item.message) });

  function schedule<T>(operation: () => Promise<T>, key: string, generation: number, retryOperation: () => Promise<unknown> = operation): Promise<T> {
    pending++;
    notify();
    const result = tail.then(() => {
      if (generation !== (generations.get(key) ?? 0)) throw new SupersededWriteError();
      return operation();
    });
    tail = result.then(() => {
      if (generation === (generations.get(key) ?? 0)) failures.delete(key);
    }, failure => {
      if (!(failure instanceof SupersededWriteError) && generation === (generations.get(key) ?? 0)) failures.set(key, { operation: retryOperation, generation, message: failure instanceof Error ? failure.message : String(failure) });
    }).then(() => { pending--; notify(); });
    return result;
  }
  function run<T>(operation: () => Promise<T>, key = `operation-${++serial}`, generation = generations.get(key) ?? 0): Promise<T> {
    return schedule(operation, key, generation);
  }

  return {
    run,
    /** Retires stale puts/retries. Keep their visible error until the replacement commits. */
    supersede(key: string) { const generation = (generations.get(key) ?? 0) + 1; generations.set(key, generation); return generation; },
    /** A successful explicit replacement may also retire an obsolete command key. */
    resolveSuperseded(key: string) { const failure = failures.get(key); if (failure && failure.generation !== (generations.get(key) ?? 0)) { failures.delete(key); notify(); } },
    generation: (key: string) => generations.get(key) ?? 0,
    isCurrent: (key: string, generation: number) => generation === (generations.get(key) ?? 0),
    async flush() { while (pending) await tail; },
    async retry() {
      const failed = [...failures.entries()];
      for (const [key, item] of failed) {
        if (failures.get(key) !== item || item.generation !== (generations.get(key) ?? 0)) continue;
        try {
          await schedule(async () => {
            // A newer command may commit while this retry waits behind tail.
            // Cancellation must not clear a newer failure for the same key.
            if (failures.get(key) !== item) throw new SupersededWriteError();
            return item.operation();
          }, key, item.generation, item.operation);
        } catch { /* State remains visible and export stays available. */ }
      }
      await tail;
    },
    clearFailures() { failures.clear(); notify(); },
    get failureCount() { return failures.size; },
  };
}

/** Internal cancellation: a later explicit command owns this record now. */
export class SupersededWriteError extends Error {
  constructor() { super('Операция заменена более новым действием.'); this.name = 'SupersededWriteError'; }
}
