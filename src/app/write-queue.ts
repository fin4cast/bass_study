/** Serializes UI writes and keeps failed operations available for explicit retry. */
export function createWriteQueue(onChange: (state: { pending: number; failures: readonly string[] }) => void) {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  let serial = 0;
  const failures = new Map<string, { operation: () => Promise<unknown>; message: string }>();
  const notify = () => onChange({ pending, failures: [...failures.values()].map(item => item.message) });

  function run<T>(operation: () => Promise<T>, key = `operation-${++serial}`): Promise<T> {
    pending++;
    notify();
    const result = tail.then(operation);
    tail = result.then(() => { failures.delete(key); }, failure => {
      failures.set(key, { operation, message: failure instanceof Error ? failure.message : String(failure) });
    }).then(() => { pending--; notify(); });
    return result;
  }

  return {
    run,
    async flush() { while (pending) await tail; },
    async retry() {
      const failed = [...failures.entries()];
      for (const [key, item] of failed) { try { await run(item.operation, key); } catch { /* State remains visible and export stays available. */ } }
      await tail;
    },
    clearFailures() { failures.clear(); notify(); },
    get failureCount() { return failures.size; },
  };
}
