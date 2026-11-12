import { describe, expect, it } from 'vitest';
import current from './fixtures/backup.json?raw';
import { createDefaultRhythmProject, DEFAULT_RHYTHM_PREFERENCES, validateRhythmProject, type RhythmPatternBars, type RhythmProject } from '../src/rhythm/model';
import { STUDY_SCHEMA_VERSION, createMemoryStudyStore, emptySnapshot, parseBackup, validateHistoryEntry, validatePracticeDraft, validateSnapshot } from '../src/storage';

const createdAt = '2026-11-08T22:31:00.000Z';

function project(id = 'fixture-rhythm', secondBars: RhythmPatternBars = 1) {
  const base = createDefaultRhythmProject(id, 'Мой ритм', createdAt);
  const first = base.patterns[0];
  const length = secondBars * 16;
  const second = { ...first, id: 'B', name: 'Сбивка', bars: secondBars, lanes: first.lanes.map(lane => {
    const steps = Array.from({ length }, (_, index) => lane.steps[index % 16]);
    const velocities = Array.from({ length }, (_, index) => lane.velocities[index % 16]);
    steps[0] = 2;
    velocities[0] = 1;
    if (secondBars > 1) {
      steps[length - 1] = 2;
      velocities[length - 1] = .37;
    }
    return { ...lane, steps, velocities };
  }) };
  return validateRhythmProject({ ...base, bpm: 133, swing: 56, patterns: [first, second], activePatternId: second.id, scope: 'chain', chain: [
    { id: 'clip-a', patternId: first.id }, { id: 'clip-b', patternId: second.id }, { id: 'clip-c', patternId: first.id },
  ], channels: base.channels.map((channel, index) => index === 0 ? { ...channel, muted: true, volume: .25 } : channel) });
}

function rhythmDraft<Project>(value: Project) {
  return {
    id: 'rhythm-draft', createdAt, updatedAt: createdAt, timeZone: 'Europe/Moscow', localDate: '2026-11-09',
    context: null, material: { kind: 'rhythm' as const, playback: { preferences: { ...DEFAULT_RHYTHM_PREFERENCES, view: 'rhythm' as const }, project: value } }, routeRef: null,
    totalReferenceMs: 3500, recordedThroughMs: 500, suggestedBpm: 30, comfortableBpm: 240, note: 'Цепочка, две сбивки', editRevision: 2,
  };
}

function rhythmHistory(draft: ReturnType<typeof rhythmDraft>) {
  return {
    id: 'saved-rhythm-entry', occurredAt: createdAt, timeZone: draft.timeZone, localDate: draft.localDate, routeRef: null,
    result: { kind: 'manual', source: 'self-report', context: null, material: draft.material,
      comfortableBpm: draft.comfortableBpm, durationMs: draft.recordedThroughMs, note: draft.note },
  };
}

describe('целые проекты ритма', () => {
  it('сохраняет силу для каждой дорожки, трёхтактовый паттерн и порядок клипов при полной замене копией', async () => {
    const store = createMemoryStudyStore();
    const seed = project('rhythm-z', 3);
    const [kick, snare, ...rest] = seed.channels;
    const first = { ...seed, channels: [
      { ...kick, velocityDefaults: { hit: 19, accent: 78 } },
      { ...snare, velocityDefaults: { hit: 100, accent: 1 } },
      ...rest,
    ] };
    const second = project('rhythm-a');
    await store.saveRhythmProject(first);
    await store.saveRhythmProject(second);
    const beforeMissing = await store.readSnapshot();
    expect(beforeMissing).toMatchObject({ rhythmProjects: [second, first], activeRhythmProjectId: second.id });
    await expect(store.selectRhythmProject('missing')).rejects.toMatchObject({ code: 'MISSING_RHYTHM_PROJECT' });
    expect(await store.readSnapshot()).toBe(beforeMissing);
    await store.selectRhythmProject(first.id);
    const saved = await store.readSnapshot();
    const json = await store.exportBackup();
    const exported = parseBackup(json);
    expect(JSON.parse(json).schemaVersion).toBe(STUDY_SCHEMA_VERSION);
    expect(exported).toEqual(saved);
    const pattern = exported.rhythmProjects[1].patterns[1];
    expect(pattern.bars).toBe(3);
    expect(pattern.lanes[0].steps).toHaveLength(48);
    expect(pattern.lanes[0].steps[47]).toBe(2);
    expect(pattern.lanes[0].velocities).toHaveLength(48);
    expect(pattern.lanes[0].velocities[47]).toBe(.37);
    expect(exported.rhythmProjects[1].channels.slice(0, 2).map(channel => channel.velocityDefaults)).toEqual([{ hit: 19, accent: 78 }, { hit: 100, accent: 1 }]);
    expect(Object.isFrozen(saved.rhythmProjects[1].channels[0].velocityDefaults)).toBe(true);
    expect(Object.isFrozen(saved.rhythmProjects[1].patterns[1].lanes[0].velocities)).toBe(true);
    const target = createMemoryStudyStore();
    await target.restore(json, { confirmed: true });
    expect(await target.readSnapshot()).toEqual(saved);
    await target.deleteRhythmProject(second.id);
    expect((await target.readSnapshot()).activeRhythmProjectId).toBe(first.id);
    await target.deleteRhythmProject(first.id);
    expect(await target.readSnapshot()).toMatchObject({ rhythmProjects: [], activeRhythmProjectId: null });

    expect(store.previewImport(current)).toMatchObject({ rhythmProjects: 1 });
    await store.restore(current, { confirmed: false });
    expect(await store.readSnapshot()).toBe(saved);
    await store.restore(current, { confirmed: true });
    expect(await store.readSnapshot()).toEqual(parseBackup(current));
  });

  it('отклоняет неполные и недопустимые значения силы без замены текущей копии', async () => {
    const value = project();
    const [first, ...rest] = value.channels;
    const store = createMemoryStudyStore();
    await store.saveRhythmProject(value);
    const before = await store.readSnapshot();
    const malformed = [undefined, null, { hit: 72 }, { accent: 100 }, { hit: 0, accent: 100 },
      { hit: 72, accent: 101 }, { hit: 72.5, accent: 100 }, { hit: '72', accent: 100 }, { hit: 72, accent: 100, unknown: 1 }];
    for (const velocityDefaults of malformed) {
      const broken = { ...value, channels: [{ ...first, velocityDefaults }, ...rest] };
      const json = JSON.stringify({ ...before, rhythmProjects: [broken] });
      expect(() => parseBackup(json)).toThrow();
      await expect(store.restore(json, { confirmed: true })).rejects.toMatchObject({ code: 'INVALID_DATA' });
      expect(await store.readSnapshot()).toBe(before);
    }
  });

  it('отклоняет целый снимок и сохраняет подтверждённое состояние при повреждении библиотеки', async () => {
    const value = project();
    const snapshot = { ...emptySnapshot(), rhythmProjects: [value], activeRhythmProjectId: value.id };
    const store = createMemoryStudyStore();
    await store.saveRhythmProject(value);
    const before = await store.readSnapshot();
    for (const bad of [
      { ...snapshot, activeRhythmProjectId: 'missing' },
      { ...snapshot, rhythmProjects: [value, value] },
      { ...snapshot, rhythmProjects: [{ ...value, running: true }] },
      { ...snapshot, rhythmProjects: [{ ...value, chain: [{ id: 'bad', patternId: 'H' }] }] },
      { ...snapshot, preferences: { ...snapshot.preferences, rhythm: { ...DEFAULT_RHYTHM_PREFERENCES, activeRhythmProjectId: value.id } } },
    ]) {
      expect(() => validateSnapshot(bad)).toThrow();
      await expect(store.restore(JSON.stringify(bad), { confirmed: true })).rejects.toThrow();
      expect(await store.readSnapshot()).toBe(before);
    }
  });

  it('сохраняет ручную отметку с неизменяемым снимком трёхтактового ритма независимо от библиотеки', async () => {
    const seed = project('fixture-rhythm', 3);
    const [kick, ...rest] = seed.channels;
    const value = { ...seed, channels: [{ ...kick, velocityDefaults: { hit: 56, accent: 99 } }, ...rest] };
    const draft = rhythmDraft(value);
    const store = createMemoryStudyStore();
    await store.saveRhythmProject(value);
    await store.upsertPracticeDraft(draft);
    await store.deleteRhythmProject(value.id);
    const result = await store.drainDraft({ draftId: draft.id, historyId: 'entry-rhythm', expectedRecordedThroughMs: 500, throughMs: 3500, editRevision: 2,
      comfortableBpm: 240, note: draft.note, occurredAt: createdAt, timeZone: draft.timeZone });
    expect(result.entry.result).toMatchObject({ kind: 'manual', source: 'self-report', context: null, material: draft.material, durationMs: 3000, comfortableBpm: 240 });
    expect(result.draft.recordedThroughMs).toBe(3500);
    const snapshot = parseBackup(await store.exportBackup());
    expect(snapshot.rhythmProjects).toEqual([]);
    expect(snapshot.history).toEqual([result.entry]);
    expect(snapshot.practiceDrafts).toEqual([result.draft]);
    const screen = parseBackup(current).history.find(entry => entry.result.kind === 'screen')!.result;
    const area = screen.kind === 'screen' ? screen.context : null;
    expect(area).not.toBeNull();
    expect(() => validatePracticeDraft({ ...draft, context: area })).toThrow();
    expect(() => validatePracticeDraft({ ...draft, comfortableBpm: 241 })).toThrow();
    expect(() => validateHistoryEntry({ ...result.entry, routeRef: { routeId: 'route', step: 'sequence' } })).toThrow();
  });
});
