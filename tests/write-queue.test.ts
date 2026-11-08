import { describe, expect, it } from 'vitest';
import { createWriteQueue } from '../src/app/write-queue';

describe('UI writes and explicit retry', () => {
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
