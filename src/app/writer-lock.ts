/** A lease is held for the life of this tab; another tab must not overwrite its preferences. */
export function acquireWriterLease(): Promise<{ acquired: boolean; release: () => void }> {
  if (!navigator.locks) return Promise.reject(new Error('Для защиты данных нескольких вкладок нужен браузер с Web Locks. Используй актуальный Microsoft Edge.'));
  return new Promise((resolve, reject) => {
    let release = () => {};
    const held = new Promise<void>(done => { release = done; });
    void navigator.locks.request('bass-study:writer', { ifAvailable: true }, async lock => {
      resolve({ acquired: lock !== null, release });
      if (lock) await held;
    }).catch(reject);
  });
}
