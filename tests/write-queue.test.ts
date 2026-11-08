import { describe, expect, it } from 'vitest';
import { createWriteQueue } from '../src/app/write-queue';

describe('UI writes and explicit retry', () => {
  it('a newer confirmed profile write retires an old retry captured behind another failed key', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let aCalls = 0;
    const stored: string[] = [];
    const queue = createWriteQueue(() => {});
    await expect(queue.run(async () => { if (++aCalls === 1) throw new Error('first A'); await blocked; }, 'history:A')).rejects.toThrow('first A');
    let oldProfileCalls = 0;
    await expect(queue.run(async () => { if (++oldProfileCalls === 1) throw new Error('first profile'); stored.push('old light'); }, 'profile')).rejects.toThrow('first profile');
    const retry = queue.retry();
    const newer = queue.run(async () => { stored.push('new dark'); }, 'profile');
    release(); await newer; await retry; await queue.flush();
    expect(stored).toEqual(['new dark']);
    expect(oldProfileCalls).toBe(1);
    expect(queue.failureCount).toBe(0);
  });

  it('a confirmed deletion retires a failed old put without hiding its error before commit', async () => {
    const states: { pending: number; failures: readonly string[] }[] = [];
    const queue = createWriteQueue(state => states.push(state));
    const stored: string[] = [];
    await expect(queue.run(async () => { throw new Error('old put'); }, 'history:1')).rejects.toThrow('old put');
    queue.supersede('history:1');
    expect(queue.failureCount).toBe(1);
    await queue.run(async () => { stored.push('delete'); }, 'history:1');
    await queue.retry();
    expect(stored).toEqual(['delete']);
    expect(states.at(-1)).toEqual({ pending: 0, failures: [] });
  });

  it('a captured old retry cannot run after supersede and a failed delete remains retryable', async () => {
    const queue = createWriteQueue(() => {});
    let oldCalls = 0, deleteCalls = 0;
    await expect(queue.run(async () => { oldCalls++; throw new Error('put'); }, 'history:1')).rejects.toThrow();
    const retry = queue.retry();
    queue.supersede('history:1');
    await retry;
    await expect(queue.run(async () => { if (++deleteCalls === 1) throw new Error('delete'); }, 'history:1')).rejects.toThrow('delete');
    await queue.retry();
    expect(oldCalls).toBe(1);
    expect(deleteCalls).toBe(2);
    expect(queue.failureCount).toBe(0);
  });
  it('flush waits for writes enqueued by an earlier completion', async () => {
    const stored: number[] = [];
    const queue = createWriteQueue(() => {});
    const first = queue.run(async () => { stored.push(1); });
    void first.then(() => queue.run(async () => { stored.push(2); }));
    await queue.flush();
    expect(stored).toEqual([1, 2]);
  });

  it('a failed history write remains visible after an unrelated settings save and can retry', async () => {
    let hasSpace = false;
    const stored: string[] = [];
    const states: { pending: number; failures: readonly string[] }[] = [];
    const queue = createWriteQueue(state => states.push(state));
    await expect(queue.run(async () => { if (!hasSpace) throw new Error('quota'); stored.push('history'); }, 'history:1')).rejects.toThrow('quota');
    await queue.run(async () => { stored.push('preferences'); }, 'preferences');
    await queue.flush();
    expect(states.at(-1)).toEqual({ pending: 0, failures: ['quota'] });
    await queue.retry(); // Another refusal must remain retryable, not capture a stale guard.
    expect(states.at(-1)).toEqual({ pending: 0, failures: ['quota'] });
    hasSpace = true;
    await queue.retry();
    expect(stored).toEqual(['preferences', 'history']);
    expect(states.at(-1)).toEqual({ pending: 0, failures: [] });
  });

  it('a successful newer settings write supersedes a failed older settings write', async () => {
    const stored: number[] = [];
    const queue = createWriteQueue(() => {});
    await expect(queue.run(async () => { throw new Error('blocked'); }, 'preferences')).rejects.toThrow('blocked');
    await queue.run(async () => { stored.push(100); }, 'preferences');
    await queue.flush();
    await queue.retry();
    expect(stored).toEqual([100]);
    expect(queue.failureCount).toBe(0);
  });
});
