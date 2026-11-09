import { describe, expect, it } from 'vitest';
import v5Json from './fixtures/v5-backup.json?raw';
import { createMemoryStudyStore, DEFAULT_PROFILE, emptySnapshot, parseBackup, validateSnapshot, validateProfile, validatePracticeDraft, makeEarHistory, makeScreenHistory, type PracticeDraft } from '../src/storage';
import { createStructure, annotatePositions, getPosition } from '../src/music';
import { beginEarListen, completeEarListen, startEarSession, submitEarAnswer } from '../src/ear';
import { nextQuestion, startQuiz, submitAnswer } from '../src/training';
import { createBoxSelection, getBoxInstance } from '../src/music/boxes';
import { DEFAULT_PREFERENCES, validatePreferences, validateQuestionContext } from '../src/storage';
import { getHistorySummary, validateHistoryEntry } from '../src/storage';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const context = { root: 'C', structureId: 'major-triad' as const, scope: 'structure' as const, positionIds: ['E:8', 'A:7', 'A:10', 'D:10'] };
const draft = (): PracticeDraft => ({ id: 'draft-one', createdAt: '2026-11-08T22:30:00.000Z', updatedAt: '2026-11-08T22:30:01.000Z', timeZone: 'Europe/Moscow', localDate: '2026-11-09', context,
  material: { kind: 'sequence', pattern: 'ascending', routePositionIds: context.positionIds, duration: 'quarter', fragment: { from: 0, toExclusive: 4 }, box: null }, routeRef: null,
  totalReferenceMs: 1000, recordedThroughMs: 0, suggestedBpm: 60, comfortableBpm: 64, note: 'Первая заметка', editRevision: 1 });
const request = () => ({ draftId: 'draft-one', historyId: 'manual-one', expectedRecordedThroughMs: 0, throughMs: 1000, editRevision: 1, comfortableBpm: 64, note: 'Первая заметка', occurredAt: '2026-11-08T22:30:00.000Z', timeZone: 'Europe/Moscow' });

describe('schema6: truthful material, global profile and durable drafts', () => {
  it('adds metadata to literal v5 without changing any old events, IDs or timestamps', () => {
    const old = JSON.parse(v5Json), before = JSON.stringify(old);
    const next = parseBackup(v5Json);
    expect(next.schemaVersion).toBe(8); expect(next.profile).toEqual(DEFAULT_PROFILE); expect(next.practiceDrafts).toEqual([]);
    for (const entry of next.history) {
      const original = old.history.find((item: any) => item.id === entry.id);
      expect({ id: entry.id, occurredAt: entry.occurredAt, timeZone: entry.timeZone, localDate: entry.localDate }).toEqual({ id: original.id, occurredAt: original.occurredAt, timeZone: original.timeZone, localDate: original.localDate });
      expect(entry.routeRef).toBeNull();
      if (entry.result.kind === 'manual') { expect(entry.result.material).toEqual({ kind: 'legacy-unknown' }); expect(entry.result.context).toEqual(original.result.context); }
      if (entry.result.kind === 'screen') { expect(entry.result.questionPolicy).toBe('random-v1'); expect(entry.result.questions).toEqual(original.result.questions); }
      if (entry.result.kind === 'ear') { expect(entry.result.context.referenceMidi).toBe(original.result.questions[0].question.referenceMidi); expect(entry.result.questions).toEqual(original.result.questions); }
      if (entry.result.kind === 'route') { expect(entry.result.material).toBeNull(); expect(entry.result.sessionLinks).toEqual([]); expect(entry.result.events).toEqual(original.result.events); }
    }
    expect(JSON.stringify(old)).toBe(before); expect(parseBackup(JSON.stringify(next))).toEqual(next);
  });

  it('rejects pretending schema6 fields existed in schema5', () => {
    for (const mutate of [(v: any) => { v.profile = DEFAULT_PROFILE; }, (v: any) => { v.preferences.study.box = null; }, (v: any) => { v.history[0].routeRef = null; }, (v: any) => { v.history.find((e: any) => e.result.kind === 'screen').result.context.box = null; }]) {
      const invalid = JSON.parse(v5Json); mutate(invalid); expect(() => parseBackup(JSON.stringify(invalid))).toThrow();
    }
  });

  it('accepts canonical sharp box names but refuses rectangular expansion of stored box context', () => {
    const box = createBoxSelection({ root: 'F#', structureId: 'minor-pentatonic', shapeId: 'penta-a', anchorString: 'E', anchorFret: 2 });
    const instance = getBoxInstance(box);
    expect(validatePreferences({ ...DEFAULT_PREFERENCES, study: { ...DEFAULT_PREFERENCES.study, root: 'F#', box } }).study.box?.root).toBe('F♯');
    const context = { root: 'F♯', structureId: 'minor-pentatonic', scope: 'structure', box, positionIds: instance.referencePositionIds };
    expect(validateQuestionContext(context).positionIds).toEqual(instance.referencePositionIds);
    expect(() => validateQuestionContext({ ...context, positionIds: [...instance.referencePositionIds, 'E:0'] })).toThrow(/точное/);
  });

  it('persists finger display independently from box geometry and rejects nonboolean values', () => {
    const preferences = validatePreferences({ ...DEFAULT_PREFERENCES, study: { ...DEFAULT_PREFERENCES.study, showFingers: true } });
    const snapshot = validateSnapshot({ ...emptySnapshot(), preferences });
    expect(parseBackup(JSON.stringify(snapshot)).preferences.study.showFingers).toBe(true);
    expect(preferences.study.box).toEqual(DEFAULT_PREFERENCES.study.box);
    expect(() => validatePreferences({ ...preferences, study: { ...preferences.study, showFingers: 1 } })).toThrow();
    const legacy = JSON.parse(v5Json); legacy.preferences.study.showFingers = false;
    expect(() => parseBackup(JSON.stringify(legacy))).toThrow(/неизвестные/);
  });

  it('keeps interface profile outside presets, exports and restores confirmed drafts', async () => {
    const store = createMemoryStudyStore(); await store.saveProfile({ theme: 'dark', onboarding: { version: 1, choice: 'free', completed: false } });
    await store.upsertPracticeDraft(draft());
    const snapshot = await store.readSnapshot(); expect(snapshot.profile.theme).toBe('dark'); expect(snapshot.preferences).not.toHaveProperty('theme');
    const fresh = createMemoryStudyStore(); await fresh.restore(await store.exportBackup(), { confirmed: true }); expect(await fresh.readSnapshot()).toEqual(snapshot);
    expect(Object.isFrozen(snapshot.practiceDrafts[0].material)).toBe(true);
    for (const change of [{ ...DEFAULT_PROFILE, surprise: 1 }, { ...DEFAULT_PROFILE, theme: 'auto' }, { ...DEFAULT_PROFILE, onboarding: { version: 1, choice: null, completed: true } }]) expect(() => validateProfile(change)).toThrow();
  });

  it('drains once atomically; later progress and a newer note survive duplicate Save', async () => {
    const store = createMemoryStudyStore(); const original = draft(); await store.upsertPracticeDraft(original);
    const saved = await store.drainDraft(request()); expect(saved.entry.result.durationMs).toBe(1000); expect(saved.entry.result.material.kind).toBe('sequence');
    expect(saved.entry.localDate).toBe('2026-11-09'); expect(saved.draft.recordedThroughMs).toBe(1000); expect(saved.draft.note).toBe('');
    await store.upsertPracticeDraft({ ...original, totalReferenceMs: 1600 }); // stale editor snapshot after Save
    await store.updateDraftText(original.id, { editRevision: 2, note: 'Новый остаток', comfortableBpm: 70, updatedAt: original.updatedAt });
    await store.drainDraft(request()); const snapshot = await store.readSnapshot();
    expect(snapshot.history).toHaveLength(1); expect(snapshot.practiceDrafts[0]).toMatchObject({ totalReferenceMs: 1600, recordedThroughMs: 1000, editRevision: 2, note: 'Новый остаток' });
    await expect(store.drainDraft({ ...request(), historyId: 'duplicate-with-different-id' })).rejects.toMatchObject({ code: 'STALE_DRAFT' });
    expect((await store.readSnapshot()).history).toHaveLength(1);
  });

  it('does not clear newer text written while the Save snapshot was pending', async () => {
    const store = createMemoryStudyStore(); await store.upsertPracticeDraft(draft());
    await store.updateDraftText('draft-one', { editRevision: 2, note: 'Новая заметка', comfortableBpm: 72, updatedAt: draft().updatedAt });
    const saved = await store.drainDraft(request()); expect(saved.entry.result.note).toBe('Первая заметка'); expect(saved.draft.note).toBe('Новая заметка');
    const before = await store.readSnapshot(); await expect(store.drainDraft({ ...request(), note: 'Другой результат' })).rejects.toMatchObject({ code: 'SAVE_CONFLICT' }); expect(await store.readSnapshot()).toBe(before);
  });

  it('rejects malformed or falsely reassigned draft context before mutation', async () => {
    const store = createMemoryStudyStore(); await store.upsertPracticeDraft(draft()); const before = await store.readSnapshot();
    for (const mutate of [(v: any) => { v.totalReferenceMs = -1; }, (v: any) => { v.recordedThroughMs = 2000; }, (v: any) => { v.localDate = '2026-11-08'; }, (v: any) => { v.material.kind = 'legacy-unknown'; }, (v: any) => { v.material = { kind: 'fretboard', box: null }; }, (v: any) => { v.material.fragment.toExclusive = 99; }, (v: any) => { v.extra = true; }]) { const value = clone(draft()); mutate(value); expect(() => validatePracticeDraft(value)).toThrow(); }
    await expect(store.upsertPracticeDraft({ ...draft(), context: { ...context, root: 'D' } })).rejects.toThrow(/неизменяем/);
    expect(await store.readSnapshot()).toBe(before);
    expect(() => validateSnapshot({ ...before, practiceDrafts: [draft(), draft()] })).toThrow(/повторяются/);
  });

  it('preserves a nondefault exact ear reference and refuses a wrong octave', () => {
    let ear = startEarSession({ root: 'C', quality: 'major', referenceMidi: 48, count: 1, seed: 16 });
    ear = completeEarListen(beginEarListen(ear, 0, 120), 1500); ear = submitEarAnswer(ear, ear.currentQuestion.targetDegree, 1600);
    const entry = makeEarHistory(ear, { id: 'ear-48', occurredAt: draft().createdAt, timeZone: draft().timeZone })!;
    expect(entry.result.context.referenceMidi).toBe(48); expect(entry.result.questions[0].question.referenceMidi).toBe(48);
    const invalid: any = clone(entry); invalid.result.context.referenceMidi = 36;
    expect(() => validateSnapshot({ ...emptySnapshot(), history: [invalid] })).toThrow();
  });

  it('validates the deterministic six-question policy instead of replaying random targets', () => {
    const structure = createStructure('C', 'major-triad'), positions = annotatePositions(context.positionIds.map(id => { const [string, fret] = id.split(':'); return getPosition(string as 'E' | 'A' | 'D' | 'G', Number(fret)); }), structure);
    let session = startQuiz({ positions, structure, mode: 'find-note', scope: 'structure', questionPolicy: 'triad-6-v1', seed: 301 }, 6);
    for (let index = 0; index < 6; index++) session = nextQuestion(submitAnswer(session, session.currentQuestion.expectedPositionIds[0], 100));
    const entry = makeScreenHistory(session, { id: 'six', occurredAt: draft().createdAt, timeZone: draft().timeZone })!;
    expect(entry.result.questionPolicy).toBe('triad-6-v1'); expect(entry.result.questions).toHaveLength(6);
    const invalid: any = clone(entry); [invalid.result.questions[0], invalid.result.questions[1]] = [invalid.result.questions[1], invalid.result.questions[0]];
    expect(() => validateSnapshot({ ...emptySnapshot(), history: [invalid] })).toThrow();
  });

  it('compares interval latency only within the same saved interval conditions', () => {
    const structure = createStructure('C', 'major'), positions = annotatePositions([getPosition('E', 2), getPosition('E', 3)], structure);
    const interval = (degree: 'b5' | '5', elapsedMs: number, id: string) => {
      let session = startQuiz({ positions, structure, scope: 'chromatic', mode: 'find-interval', intervalDegree: degree, seed: 10 }, 1);
      session = nextQuestion(submitAnswer(session, session.currentQuestion.expectedPositionIds[0], elapsedMs));
      return makeScreenHistory(session, { id, occurredAt: draft().createdAt, timeZone: draft().timeZone })!;
    };
    const summary = getHistorySummary([interval('b5', 100, 'flat-five'), interval('5', 500, 'perfect-five')]);
    expect(summary.groups).toHaveLength(2);
    expect(summary.groups.map(group => ({ intervals: group.intervalDegrees, ms: group.meanFirstResponseMs }))).toEqual([{ intervals: ['b5'], ms: 100 }, { intervals: ['5'], ms: 500 }]);
    expect(summary.independentCorrect).toBe(2);
  });

  it('separates random and balanced policies in the same mode and physical area', () => {
    const structure = createStructure('C', 'major-triad'), positions = annotatePositions([getPosition('E', 8), getPosition('A', 7), getPosition('A', 10), getPosition('D', 10)], structure);
    const series = (questionPolicy: 'random-v1' | 'triad-6-v1', elapsedMs: number) => {
      let session = startQuiz({ positions, structure, scope: 'structure', mode: 'find-note', questionPolicy, seed: 301 }, 6);
      for (let index = 0; index < 6; index++) session = nextQuestion(submitAnswer(session, session.currentQuestion.expectedPositionIds[0], elapsedMs));
      return makeScreenHistory(session, { id: questionPolicy, occurredAt: draft().createdAt, timeZone: draft().timeZone })!;
    };
    const summary = getHistorySummary([series('random-v1', 100), series('triad-6-v1', 300)]);
    expect(summary.groups).toHaveLength(2);
    expect(summary.groups.map(group => [group.questionPolicy, group.meanFirstResponseMs, group.intervalDegrees])).toEqual([['random-v1', 100, []], ['triad-6-v1', 300, []]]);
    expect(summary.completedQuestions).toBe(12);
  });

  it('canonicalises position order and missing/null box for genuinely identical conditions', () => {
    const structure = createStructure('C', 'major-triad'), positions = annotatePositions([getPosition('E', 8), getPosition('A', 7), getPosition('A', 10)], structure);
    const session = nextQuestion(submitAnswer(startQuiz({ positions, structure, scope: 'structure', mode: 'find-note', seed: 91 }, 1), 'E:8', 100));
    // Answer the generated target if E/8 was not it; the stored series must
    // still be validated, including any real wrong/corrected attempt.
    const initial = session.status === 'active' ? nextQuestion(submitAnswer(session, session.currentQuestion.expectedPositionIds[0], 200)) : session;
    const first = makeScreenHistory(initial, { id: 'same-one', occurredAt: draft().createdAt, timeZone: draft().timeZone })!;
    const changed: any = clone(first); changed.id = 'same-two'; changed.result.context.positionIds.reverse(); changed.result.context.box = null;
    const second = validateHistoryEntry(changed);
    const summary = getHistorySummary([first, second]);
    expect(summary.groups).toHaveLength(1); expect(summary.groups[0].questions).toBe(2);
    expect(summary.groups[0].intervalDegrees).toEqual([]); expect(summary.groups[0].questionPolicy).toBe('random-v1');
  });
});
