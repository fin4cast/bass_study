import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPracticeDrafts, type PracticeBinding } from '../src/app/practice-drafts';
import { createWriteQueue } from '../src/app/write-queue';
import { createMemoryStudyStore, type DrainDraftRequest, type PracticeDraft } from '../src/storage';
import { DEFAULT_RHYTHM_PREFERENCES, createDefaultRhythmProject } from '../src/rhythm/model';

const area = { root: 'C', structureId: 'major-triad' as const, scope: 'structure' as const, positionIds: ['E:8', 'A:7', 'A:10', 'D:10'] };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(wrap?: (store: ReturnType<typeof createMemoryStudyStore>) => Pick<ReturnType<typeof createMemoryStudyStore>, 'upsertPracticeDraft' | 'deletePracticeDraft' | 'drainDraft'>) {
  const store = createMemoryStudyStore(), queue = createWriteQueue(() => {}), api = wrap?.(store) ?? store;
  let date = new Date('2026-11-08T12:00:00.000Z');
  const clock = { durationMs: 0, comfortableBpm: 60, runtimeContextKey: 'sequence:first' };
  const committed: PracticeDraft[] = [], entries: string[] = [];
  const manager = createPracticeDrafts({ getStore: () => api, write: (operation, key) => queue.run(operation, key), supersede: key => queue.supersede(key), resolveSuperseded: key => queue.resolveSuperseded(key),
    onCommit: value => committed.push(value), onEntry: value => entries.push(value.id), now: () => date });
  const binding: PracticeBinding = { context: area, material: { kind: 'sequence', pattern: 'ascending', routePositionIds: area.positionIds, duration: 'quarter', fragment: { from: 0, toExclusive: 4 }, box: null }, routeRef: null, label: 'Последовательность', readClock: () => ({ ...clock }) };
  manager.bind(binding);
  return { store, queue, manager, clock, binding, committed, entries, date: (value: string) => { date = new Date(value); } };
}
afterEach(() => vi.useRealTimers());

describe('durable practice draft coordinator', () => {
  it('creates no blank draft on binding; manual fretboard input is durable and remains ungraded', async () => {
    const f = fixture(); expect(f.manager.current()).toBeNull(); expect(f.manager.all()).toEqual([]);
    f.manager.bind({ ...f.binding, material: { kind: 'fretboard', box: null }, label: 'Изучение грифа' });
    expect(f.manager.current()).toBeNull();
    const value = f.manager.edit(null, 'Изучил терцию', 60); await f.manager.flush();
    expect((await f.store.readSnapshot()).practiceDrafts).toEqual([value]); expect((await f.store.readSnapshot()).history).toEqual([]);
    f.manager.dispose();
  });

  it('captures actual clock deltas before material/runtime changes and preserves both contexts', async () => {
    const f = fixture(); f.clock.durationMs = 400; const first = f.manager.current()!;
    f.clock.durationMs = 700; f.manager.bind(null);
    f.clock.durationMs = 0; f.clock.runtimeContextKey = 'sequence:second';
    f.manager.bind({ ...f.binding, material: { kind: 'sequence', pattern: 'descending', routePositionIds: area.positionIds, duration: 'eighth', fragment: { from: 0, toExclusive: 4 }, box: null } });
    expect(f.manager.current()).toBeNull(); f.clock.durationMs = 250; const second = f.manager.current()!;
    await f.manager.flush(); const data = await f.store.readSnapshot();
    expect(data.practiceDrafts.find(item => item.id === first.id)?.totalReferenceMs).toBe(700);
    expect(data.practiceDrafts.find(item => item.id === second.id)).toMatchObject({ totalReferenceMs: 250, material: { kind: 'sequence', pattern: 'descending' } });
    expect(data.history).toEqual([]); f.manager.dispose();
  });

  it('reads the bound draft without sampling the clock and indexes a new local day separately', () => {
    const f = fixture();
    const readClock = vi.fn(f.binding.readClock);
    f.manager.bind({ ...f.binding, readClock });
    f.clock.durationMs = 400;
    const first = f.manager.current()!;
    const reads = readClock.mock.calls.length;
    f.clock.durationMs = 900;
    expect(f.manager.peek()).toEqual(first);
    expect(readClock).toHaveBeenCalledTimes(reads);
    f.date('2026-11-09T12:00:00.000Z');
    const second = f.manager.current()!;
    expect(second.id).not.toBe(first.id);
    expect(second.localDate).not.toBe(first.localDate);
    expect(second.totalReferenceMs).toBe(500);
    expect(f.manager.get(first.id)?.totalReferenceMs).toBe(400);
    f.manager.dispose();
  });

  it('manual Save only persists its chosen draft even when another checkpoint fails', async () => {
    const attempted: string[] = [];
    let badId = '';
    const f = fixture(store => ({ ...store, upsertPracticeDraft: async draft => {
      attempted.push(draft.id);
      if (draft.id === badId) throw new Error('unrelated checkpoint');
      return store.upsertPracticeDraft(draft);
    } }));
    f.clock.durationMs = 400; badId = f.manager.current()!.id;
    f.date('2026-11-09T12:00:00.000Z'); f.clock.durationMs = 900;
    const chosen = f.manager.current()!;
    await f.manager.save(chosen.id, 'Сохранено отдельно', 64);
    expect(attempted).toEqual([chosen.id]);
    await expect(f.manager.flush()).rejects.toThrow('unrelated checkpoint');
    expect((await f.store.readSnapshot()).history[0].result).toMatchObject({ durationMs: 500, note: 'Сохранено отдельно' });
    expect(f.manager.hasPendingChanges()).toBe(true);
    f.manager.dispose();
  });

  it('retains each closed rhythm epoch even if a live read crosses two edits', async () => {
    const f = fixture();
    const project = createDefaultRhythmProject();
    const binding = (bpm: number, epoch: string, durationMs: number): PracticeBinding => ({
      context: null, routeRef: null, label: 'Ритм-секция',
      material: { kind: 'rhythm', playback: { preferences: { ...DEFAULT_RHYTHM_PREFERENCES, view: 'rhythm' }, project: { ...project, bpm } } },
      readClock: () => ({ runtimeContextKey: epoch, durationMs, comfortableBpm: bpm }),
    });
    const initial = binding(120, 'rhythm:1:1', 0);
    let advance = false;
    f.manager.bind({ ...initial, readClock() {
      if (advance) {
        advance = false;
        f.manager.captureClosed(binding(120, 'rhythm:1:1', 930));
        f.manager.captureClosed(binding(130, 'rhythm:1:2', 70));
      }
      return initial.readClock();
    } });
    advance = true;
    f.manager.capture();
    f.manager.captureClosed(binding(120, 'rhythm:1:1', 930));
    f.manager.bind(binding(140, 'rhythm:1:3', 200));
    await f.manager.flush();
    const { practiceDrafts } = await f.store.readSnapshot();
    expect(practiceDrafts.map(draft => [draft.comfortableBpm, draft.totalReferenceMs]).sort()).toEqual([[120, 930], [130, 70], [140, 200]]);
    f.manager.dispose();
  });

  it('does not merge practice across a local calendar day and preserves the original date', async () => {
    const f = fixture(); const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // These instants are safely on distinct local days in every supported IANA zone.
    f.date('2026-11-08T12:00:00.000Z'); f.clock.durationMs = 500; const first = f.manager.current()!;
    f.date('2026-11-10T12:00:00.000Z'); f.clock.durationMs = 800; const second = f.manager.current()!;
    expect(second.id).not.toBe(first.id); expect(second.totalReferenceMs).toBe(300); expect(first.timeZone).toBe(zone);
    await f.manager.flush(); const before = await f.store.readSnapshot();
    const reopened = createMemoryStudyStore(); await reopened.restorePrepared(reopened.prepareImport(await f.store.exportBackup()));
    expect(await reopened.readSnapshot()).toEqual(before); f.manager.dispose();
  });

  it('debounces text for 300ms and never writes a history result before Save', async () => {
    vi.useFakeTimers(); const f = fixture(); const value = f.manager.edit(null, 'Раз', 60);
    expect(f.manager.hasPendingChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(200); f.manager.edit(value.id, 'Два', 62);
    await vi.advanceTimersByTimeAsync(299); expect((await f.store.readSnapshot()).practiceDrafts).toEqual([]); expect(f.manager.hasPendingChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(1); await f.queue.flush();
    expect((await f.store.readSnapshot()).practiceDrafts[0]).toMatchObject({ note: 'Два', comfortableBpm: 62, editRevision: 2 });
    expect(f.manager.hasPendingChanges()).toBe(false);
    expect((await f.store.readSnapshot()).history).toEqual([]); f.manager.dispose();
  });

  it('Save preserves newer text/time and late checkpoints cannot restore consumed milliseconds', async () => {
    const gate = deferred(), entered = deferred();
    const f = fixture(store => ({ ...store, drainDraft: async request => { entered.resolve(); await gate.promise; return store.drainDraft(request); } }));
    f.clock.durationMs = 1000; const first = f.manager.current()!; f.manager.edit(first.id, 'До сохранения', 64);
    const saving = f.manager.save(first.id, 'До сохранения', 64); await entered.promise;
    f.clock.durationMs = 1500; f.manager.capture(); f.manager.edit(first.id, 'Новая заметка', 72);
    expect(f.manager.hasPendingChanges()).toBe(true);
    const lateCheckpoint = f.manager.flush(); gate.resolve(); await saving; await lateCheckpoint;
    const snapshot = await f.store.readSnapshot();
    expect(snapshot.history).toHaveLength(1); expect(snapshot.history[0].result).toMatchObject({ durationMs: 1000, note: 'До сохранения' });
    expect(snapshot.practiceDrafts[0]).toMatchObject({ totalReferenceMs: 1500, recordedThroughMs: 1000, note: 'Новая заметка', comfortableBpm: 72 });
    expect(f.manager.get(first.id)).toMatchObject({ totalReferenceMs: 1500, recordedThroughMs: 1000, note: 'Новая заметка' });
    expect(f.manager.hasPendingChanges()).toBe(false);
    f.manager.dispose();
  });

  it('failed Save retries its stable request once; fresh text and remaining time stay available', async () => {
    let calls = 0; const requests: DrainDraftRequest[] = [];
    const f = fixture(store => ({ ...store, drainDraft: async request => { requests.push(structuredClone(request)); if (++calls === 1) throw new Error('quota'); return store.drainDraft(request); } }));
    f.clock.durationMs = 1000; const first = f.manager.current()!;
    await expect(f.manager.save(first.id, 'Исходный текст', 64)).rejects.toThrow('quota');
    f.clock.durationMs = 1700; f.manager.capture(); f.manager.edit(first.id, 'Остаток', 76); await f.manager.flush();
    await f.queue.retry();
    expect(requests[1]).toEqual(requests[0]); expect((await f.store.readSnapshot()).history).toHaveLength(1);
    expect(f.manager.get(first.id)).toMatchObject({ totalReferenceMs: 1700, recordedThroughMs: 1000, note: 'Остаток' }); expect(f.queue.failureCount).toBe(0);
    await f.manager.save(first.id, 'Остаток', 76); expect((await f.store.readSnapshot()).history).toHaveLength(2);
    expect((await f.store.readSnapshot()).history.map(entry => entry.result.kind === 'manual' ? entry.result.durationMs : -1).sort((a, b) => a - b)).toEqual([700, 1000]);
    f.manager.dispose();
  });

  it('reload clears the binding and suppresses callbacks from an already running old persistence', async () => {
    const entered = deferred(), gate = deferred();
    const f = fixture(store => ({ ...store, upsertPracticeDraft: async value => { entered.resolve(); await gate.promise; return store.upsertPracticeDraft(value); } }));
    f.clock.durationMs = 300; f.manager.capture(); const pending = f.manager.flush(); await entered.promise;
    f.manager.reload([]); expect(f.manager.current(true)).toBeNull(); gate.resolve(); await pending;
    expect(f.manager.all()).toEqual([]); expect(f.committed).toEqual([]); f.manager.dispose();
  });

  it('confirmed discard supersedes failed puts and the retry cannot resurrect the row', async () => {
    let calls = 0;
    const f = fixture(store => ({ ...store, upsertPracticeDraft: async value => { if (++calls === 1) throw new Error('put failed'); return store.upsertPracticeDraft(value); } }));
    f.clock.durationMs = 200; const first = f.manager.current()!;
    await expect(f.manager.flush()).rejects.toThrow('put failed'); await f.manager.remove(first.id); await f.queue.retry();
    expect(calls).toBe(1); expect((await f.store.readSnapshot()).practiceDrafts).toEqual([]); expect(f.manager.all()).toEqual([]); expect(f.queue.failureCount).toBe(0);
    f.manager.dispose();
  });

  it('a failed delete performs local cleanup on queue retry and retires a failed Save command too', async () => {
    let deletes = 0;
    const f = fixture(store => ({ ...store, deletePracticeDraft: async id => { if (++deletes === 1) throw new Error('delete failed'); return store.deletePracticeDraft(id); }, drainDraft: async () => { throw new Error('save failed'); } }));
    f.clock.durationMs = 200; const first = f.manager.current()!;
    await expect(f.manager.save(first.id, 'Черновик', 64)).rejects.toThrow('save failed');
    await expect(f.manager.remove(first.id)).rejects.toThrow('delete failed'); expect(f.manager.all()).toHaveLength(1);
    await f.queue.retry(); expect((await f.store.readSnapshot()).history).toEqual([]); expect((await f.store.readSnapshot()).practiceDrafts).toEqual([]);
    expect(f.manager.all()).toEqual([]); expect(f.queue.failureCount).toBe(0); f.manager.dispose();
  });
});
