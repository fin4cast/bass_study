import { describe, expect, it } from 'vitest';
import backup from './fixtures/backup.json?raw';
import { createMemoryStudyStore, parseBackup, type RouteHistoryEntry } from '../src/storage';
import { isRouteEntry } from '../src/storage/history-links';

const fixture = parseBackup(backup);
const route = fixture.history.find(isRouteEntry)!;
const ear = fixture.history.find(entry => entry.result.kind === 'ear')!;

describe('подтверждённые связи результатов маршрута', () => {
  it('записывает ссылку к исходному маршруту и сохраняет её при следующей записи таймера', async () => {
    const store = createMemoryStudyStore();
    const another: RouteHistoryEntry = { ...route, id: 'another-envelope', result: { ...route.result, id: 'another-timer' } };
    await store.addHistory(route);
    await store.addHistory(another);
    const result = { ...ear, routeRef: { routeId: route.result.id, step: 'ear' as const } };
    const expected = [{ id: result.id, kind: 'ear', step: 'ear' }];
    expect((await store.addHistory(result)).linkedRoute?.result.sessionLinks).toEqual(expected);
    expect((await store.addHistory(result)).linkedRoute).toBeUndefined();
    await store.addHistory(route);
    await store.deleteHistory(result.id);
    expect((await store.readSnapshot()).history).toEqual([another, { ...route, result: { ...route.result, sessionLinks: expected } }]);
  });

  it('читает прежние неоднозначные и оборванные связи без изменения копии', async () => {
    const store = createMemoryStudyStore();
    const savedRoute: RouteHistoryEntry = { ...route, result: { ...route.result, sessionLinks: [{ id: 'deleted-child', kind: 'screen', step: 'fretboard' }] } };
    const otherEnvelope = { ...route, id: 'another-envelope' };
    const orphan = { ...ear, routeRef: { routeId: 'missing-parent', step: 'ear' as const } };
    const history = [otherEnvelope, orphan, ...fixture.history.filter(entry => entry.id !== ear.id && entry.id !== route.id && entry.result.kind !== 'screen'), savedRoute];
    const candidate = store.prepareImport(JSON.stringify({ ...fixture, history }));
    const restored = await store.restorePrepared(candidate);
    expect(restored.snapshot).toBe(candidate.snapshot);
    expect(JSON.parse(await store.exportBackup())).toEqual(candidate.snapshot);
    expect(restored.snapshot.history).toEqual([...history].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const newResult = { ...ear, id: 'new-linked-ear', routeRef: { routeId: route.result.id, step: 'ear' as const } };
    expect((await store.addHistory(newResult)).linkedRoute).toBeUndefined();
    expect((await store.readSnapshot()).history.filter(isRouteEntry)).toEqual([otherEnvelope, savedRoute]);
  });

  it('возвращает выбор только после изменения библиотеки ритма', async () => {
    const store = createMemoryStudyStore();
    const project = fixture.rhythmProjects[0];
    const save = { kind: 'save', project } as const;
    await expect(store.changeRhythmLibrary(save)).resolves.toEqual({ change: save, activeId: project.id });
    const clear = { kind: 'select', id: null } as const;
    await expect(store.changeRhythmLibrary(clear)).resolves.toEqual({ change: clear, activeId: null });
    const select = { kind: 'select', id: project.id } as const;
    await expect(store.changeRhythmLibrary(select)).resolves.toEqual({ change: select, activeId: project.id });
    const remove = { kind: 'delete', id: project.id } as const;
    await expect(store.changeRhythmLibrary(remove)).resolves.toEqual({ change: remove, activeId: null });
    await expect(store.changeRhythmLibrary(select)).rejects.toMatchObject({ code: 'MISSING_RHYTHM_PROJECT' });
    expect((await store.readSnapshot()).rhythmProjects).toEqual([]);
  });
});
