import { describe, expect, it } from 'vitest';
import v7 from './fixtures/v7-backup.json?raw';
import { createDefaultRhythmProject, DEFAULT_RHYTHM_PREFERENCES, validateRhythmProject } from '../src/rhythm/model';
import { createMemoryStudyStore, emptySnapshot, parseBackup, validateHistoryEntry, validatePracticeDraft, validateSnapshot, type PracticeDraft } from '../src/storage';

const createdAt = '2026-11-08T22:31:00.000Z';

function project(id = 'fixture-rhythm') {
  const base = createDefaultRhythmProject(id, 'Мой ритм', createdAt);
  const first = base.patterns[0];
  const second = { ...first, id: 'B', name: 'Сбивка', lanes: first.lanes.map(lane => ({ ...lane, steps: lane.steps.map((step, index) => index === 0 ? 2 : step), velocities: lane.velocities.map((velocity, index) => index === 0 ? 1 : velocity) })) };
  return validateRhythmProject({ ...base, bpm: 133, swing: 56, patterns: [first, second], activePatternId: second.id, scope: 'chain', chain: [
    { id: 'clip-a', patternId: first.id }, { id: 'clip-b', patternId: second.id }, { id: 'clip-c', patternId: first.id },
  ], channels: base.channels.map((channel, index) => index === 0 ? { ...channel, muted: true, volume: .25 } : channel) });
}

describe('схема 8 и целые проекты ритма', () => {
  it('переносит буквальную v7 с прежним материалом, профилем и медиа', () => {
    const previous = JSON.parse(v7);
    const snapshot = parseBackup(v7);
    expect(snapshot).toMatchObject({ schemaVersion: 8, rhythmProjects: [], activeRhythmProjectId: null });
    expect(snapshot.preferences).toEqual({ ...previous.preferences, rhythm: null });
    expect(snapshot.presets).toEqual(previous.presets.map((preset: any) => ({ ...preset, preferences: { ...preset.preferences, rhythm: null } })));
    expect(snapshot.history).toEqual(previous.history);
    expect(snapshot.practiceDrafts).toEqual(previous.practiceDrafts);
    expect(snapshot.profile).toEqual(previous.profile);
    expect(() => parseBackup(JSON.stringify({ ...previous, rhythmProjects: [] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...previous, preferences: { ...previous.preferences, rhythm: null } }))).toThrow();
  });

  it('сохраняет библиотеку, порядок клипов и активный ID, включая полную замену копией', async () => {
    const store = createMemoryStudyStore();
    const first = project('rhythm-z');
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
    expect(parseBackup(json)).toEqual(saved);
    expect(Object.isFrozen(saved.rhythmProjects[1].patterns[1].lanes[0].velocities)).toBe(true);
    const target = createMemoryStudyStore();
    await target.restore(json, { confirmed: true });
    expect(await target.readSnapshot()).toEqual(saved);
    await target.deleteRhythmProject(second.id);
    expect((await target.readSnapshot()).activeRhythmProjectId).toBe(first.id);
    await target.deleteRhythmProject(first.id);
    expect(await target.readSnapshot()).toMatchObject({ rhythmProjects: [], activeRhythmProjectId: null });

    expect(store.previewImport(v7)).toMatchObject({ sourceSchemaVersion: 7, rhythmProjects: 0 });
    await store.restore(v7, { confirmed: false });
    expect(await store.readSnapshot()).toBe(saved);
    await store.restore(v7, { confirmed: true });
    expect(await store.readSnapshot()).toEqual(parseBackup(v7));
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

  it('сохраняет ручную отметку с неизменяемым снимком ритма независимо от библиотеки', async () => {
    const value = project();
    const draft: PracticeDraft = {
      id: 'draft-rhythm', createdAt, updatedAt: createdAt, timeZone: 'Europe/Moscow', localDate: '2026-11-09',
      context: null, material: { kind: 'rhythm', playback: { preferences: { ...DEFAULT_RHYTHM_PREFERENCES, view: 'rhythm' }, project: value } }, routeRef: null,
      totalReferenceMs: 3500, recordedThroughMs: 500, suggestedBpm: 30, comfortableBpm: 240, note: 'Цепочка, две сбивки', editRevision: 2,
    };
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
    const legacy = parseBackup(v7).practiceDrafts[0];
    expect(() => validatePracticeDraft({ ...legacy, context: null })).toThrow();
    expect(() => validatePracticeDraft({ ...draft, context: legacy.context })).toThrow();
    expect(() => validatePracticeDraft({ ...draft, comfortableBpm: 241 })).toThrow();
    expect(() => validateHistoryEntry({ ...result.entry, routeRef: { routeId: 'route', step: 'sequence' } })).toThrow();
  });
});
