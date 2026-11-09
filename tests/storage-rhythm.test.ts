import { describe, expect, it } from 'vitest';
import v7 from './fixtures/v7-backup.json?raw';
import { createDefaultRhythmProject, DEFAULT_RHYTHM_PREFERENCES, validateRhythmProject, type RhythmPatternBars, type RhythmProject } from '../src/rhythm/model';
import { createMemoryStudyStore, emptySnapshot, parseBackup, validateHistoryEntry, validatePracticeDraft, validateSnapshot, type PracticeDraft } from '../src/storage';

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

function rhythmDraft(value: RhythmProject): PracticeDraft {
  return {
    id: 'rhythm-draft', createdAt, updatedAt: createdAt, timeZone: 'Europe/Moscow', localDate: '2026-11-09',
    context: null, material: { kind: 'rhythm', playback: { preferences: { ...DEFAULT_RHYTHM_PREFERENCES, view: 'rhythm' }, project: value } }, routeRef: null,
    totalReferenceMs: 3500, recordedThroughMs: 500, suggestedBpm: 30, comfortableBpm: 240, note: 'Цепочка, две сбивки', editRevision: 2,
  };
}

function rhythmHistory(draft: PracticeDraft) {
  return {
    id: 'saved-rhythm-entry', occurredAt: createdAt, timeZone: draft.timeZone, localDate: draft.localDate, routeRef: null,
    result: { kind: 'manual', source: 'self-report', context: null, material: draft.material,
      comfortableBpm: draft.comfortableBpm, durationMs: draft.recordedThroughMs, note: draft.note },
  };
}

describe('схема 9 и целые проекты ритма', () => {
  it('переносит буквальную v7 с прежним материалом, профилем и медиа', () => {
    const previous = JSON.parse(v7);
    const snapshot = parseBackup(v7);
    expect(snapshot).toMatchObject({ schemaVersion: 9, rhythmProjects: [], activeRhythmProjectId: null });
    expect(snapshot.preferences).toEqual({ ...previous.preferences, rhythm: null });
    expect(snapshot.presets).toEqual(previous.presets.map((preset: any) => ({ ...preset, preferences: { ...preset.preferences, rhythm: null } })));
    expect(snapshot.history).toEqual(previous.history);
    expect(snapshot.practiceDrafts).toEqual(previous.practiceDrafts);
    expect(snapshot.profile).toEqual(previous.profile);
    expect(() => parseBackup(JSON.stringify({ ...previous, rhythmProjects: [] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...previous, preferences: { ...previous.preferences, rhythm: null } }))).toThrow();
  });

  it('переносит v8 с паттернами 1/2/4, выбранным проектом и снимками ручной практики', () => {
    const previous = parseBackup(v7);
    const two = project('rhythm-a', 2);
    const four = project('rhythm-b', 4);
    const rhythm = { ...DEFAULT_RHYTHM_PREFERENCES, view: 'rhythm' };
    const legacy = {
      ...previous, schemaVersion: 8,
      preferences: { ...previous.preferences, activeModule: 'harmony', rhythm },
      presets: previous.presets.map(preset => ({ ...preset, preferences: { ...preset.preferences, rhythm } })),
      history: [...previous.history, rhythmHistory(rhythmDraft(four))],
      practiceDrafts: [...previous.practiceDrafts, rhythmDraft(two)],
      rhythmProjects: [two, four], activeRhythmProjectId: four.id,
    };
    const expected = {
      ...legacy, schemaVersion: 9,
      history: [...legacy.history].sort((left, right) => left.id.localeCompare(right.id, 'en')),
    };
    const json = JSON.stringify(legacy);
    expect(parseBackup(json)).toEqual(expected);
    expect(createMemoryStudyStore().previewImport(json)).toMatchObject({ sourceSchemaVersion: 8, rhythmProjects: 2, snapshot: expected });
  });

  it('отклоняет трёхтактовый паттерн в библиотеке, истории или черновике копии v8', () => {
    const three = project('rhythm-three', 3);
    const draft = rhythmDraft(three);
    const legacy = { ...emptySnapshot(), schemaVersion: 8 };
    for (const extra of [
      { rhythmProjects: [three], activeRhythmProjectId: three.id },
      { history: [rhythmHistory(draft)] },
      { practiceDrafts: [draft] },
    ]) {
      expect(() => parseBackup(JSON.stringify({ ...legacy, ...extra }))).toThrow(/трёхтактовые/i);
    }
  });

  it('сохраняет трёхтактовый паттерн, порядок клипов и активный ID при полной замене копией', async () => {
    const store = createMemoryStudyStore();
    const first = project('rhythm-z', 3);
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
    expect(JSON.parse(json).schemaVersion).toBe(9);
    expect(exported).toEqual(saved);
    const pattern = exported.rhythmProjects[1].patterns[1];
    expect(pattern.bars).toBe(3);
    expect(pattern.lanes[0].steps).toHaveLength(48);
    expect(pattern.lanes[0].steps[47]).toBe(2);
    expect(pattern.lanes[0].velocities).toHaveLength(48);
    expect(pattern.lanes[0].velocities[47]).toBe(.37);
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

  it('сохраняет ручную отметку с неизменяемым снимком трёхтактового ритма независимо от библиотеки', async () => {
    const value = project('fixture-rhythm', 3);
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
    const legacy = parseBackup(v7).practiceDrafts[0];
    expect(() => validatePracticeDraft({ ...legacy, context: null })).toThrow();
    expect(() => validatePracticeDraft({ ...draft, context: legacy.context })).toThrow();
    expect(() => validatePracticeDraft({ ...draft, comfortableBpm: 241 })).toThrow();
    expect(() => validateHistoryEntry({ ...result.entry, routeRef: { routeId: 'route', step: 'sequence' } })).toThrow();
  });
});
