import { describe, expect, it } from 'vitest';
import v1BackupJson from './fixtures/v1-backup.json?raw';
import v2BackupJson from './fixtures/v2-backup.json?raw';
import v3BackupJson from './fixtures/v3-backup.json?raw';
import v4BackupJson from './fixtures/v4-backup.json?raw';
import { createTracksManifest } from '../src/tracks';
import { beginEarListen, completeEarListen, revealEarAnswer, skipEarQuestion, startEarSession, submitEarAnswer } from '../src/ear';
import { advanceRouteSession, nextRouteStep, pauseRouteSession, resumeRouteSession, startRouteSession, stopRouteSession } from '../src/route';
import { createMemoryStudyStore } from '../src/storage/memory';
import { annotatePositions, createStructure, getPosition } from '../src/music';
import { createManualPracticeResult, nextQuestion, revealAnswer, skipQuestion, startQuiz, submitAnswer, type QuizMode } from '../src/training';
import {
  DEFAULT_PREFERENCES, MAX_BACKUP_BYTES, emptySnapshot, getHistorySummary, getReviewPositionIds, makeEarHistory, makeRouteHistory, makeManualHistory, makeScreenHistory,
  originalLocalDate, parseBackup, validateHistoryEntry, validatePreferences, validatePreset, validateSnapshot,
  type HistoryEntry, type ScreenHistoryEntry,
} from '../src/storage/model';

const structure = createStructure('A', 'minor-pentatonic');
const positions = annotatePositions([getPosition('E', 0), getPosition('E', 12)], structure);
const context = { scope: 'structure' as const, root: 'A', structureId: 'minor-pentatonic' as const, positionIds: ['E:0', 'E:12'] };
const metadata = { id: 'synthetic-screen', occurredAt: '2026-11-08T09:00:00.000Z', timeZone: 'Europe/Moscow' };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function v6Preferences(value: any) { return { ...value, study: { ...value.study, box: null, showFingers: false }, training: { ...value.training, questionPolicy: 'random-v1' } }; }
function expectedLegacyEntry(entry: any) {
 const result = entry.result.kind === 'manual' ? { ...entry.result, material: { kind: 'legacy-unknown' } }
 : entry.result.kind === 'screen' ? { ...entry.result, questionPolicy: 'random-v1' }
 : entry.result.kind === 'route' ? { ...entry.result, material: null, sessionLinks: [] }
 : { ...entry.result, context: { ...entry.result.context, referenceMidi: entry.result.questions[0].question.referenceMidi } };
 return { ...entry, result, routeRef: null };
}


describe('schema5: переносимые метаданные дорожек и выбор входа без аудиоданных', () => {
  it('мигрирует буквальную v4 с сохранением всех четырёх источников и пресетов', () => {
    const original = JSON.parse(v4BackupJson);
    const migrated = parseBackup(v4BackupJson);
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.history).toEqual(original.history.map(expectedLegacyEntry));
    expect(migrated.preferences).toEqual(v6Preferences({ ...original.preferences, tracks: null, input: { deviceId: '' } }));
    expect(migrated.presets).toEqual(original.presets.map((preset: any) => ({ ...preset, preferences: v6Preferences({ ...preset.preferences, tracks: null, input: { deviceId: '' } }) })));
    expect(parseBackup(JSON.stringify(migrated))).toEqual(migrated);
  });
  it('переносит cues, SHA и mixer, сохраняя выбранный вход только как ID', () => {
    const tracks = createTracksManifest({ id: 'local-set', tracks: [{ id: 'stem-1', name: 'bass.wav', size: 40044, lastModified: 1234, sha256: 'a'.repeat(64), decoded: { duration: 1, frames: 20000, sampleRate: 20000, channels: 1 }, volume: .65, muted: true }] });
    const preferences = validatePreferences({ ...DEFAULT_PREFERENCES, activeModule: 'tracks', tracks: { ...tracks, clip: { from: .1, to: .9 }, loop: true, rate: .75 }, input: { deviceId: 'opaque-device-id' } });
    const snapshot = validateSnapshot({ ...emptySnapshot(), preferences });
    expect(parseBackup(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.preferences.tracks?.tracks[0].sha256).toBe('a'.repeat(64));
    expect(validatePreferences({ ...preferences, activeModule: 'input' }).input.deviceId).toBe('opaque-device-id');
    for (const mutate of [(value: any) => { value.tracks.tracks[0].pcm = [0, 1]; }, (value: any) => { value.input.stream = {}; }, (value: any) => { value.input.deviceId = 'x'.repeat(2049); }, (value: any) => { value.tracks.clip.to = .1; }]) {
      const bad = clone(preferences); mutate(bad); expect(() => validatePreferences(bad)).toThrow();
    }
  });
  it('не маскирует поля/разделы новой версии под v4 и отклоняет будущую v7', () => {
    const original = JSON.parse(v4BackupJson);
    const extra = clone(original); extra.preferences.tracks = null;
    expect(() => parseBackup(JSON.stringify(extra))).toThrow(/неизвестные/);
    const newModule = clone(original); newModule.preferences.activeModule = 'input';
    expect(() => parseBackup(JSON.stringify(newModule))).toThrow(/Раздел версии 4/);
    expect(() => parseBackup(JSON.stringify({ ...emptySnapshot(), schemaVersion: 7 }))).toThrow(/версия/);
  });
});
function quiz(mode: QuizMode = 'name-note', count = 1) { return startQuiz({ positions, structure, mode, scope: 'structure', seed: 100 }, count); }
function completed() { return makeScreenHistory(nextQuestion(submitAnswer(quiz(), 'E', 350)), metadata)!; }
function manual() {
  return makeManualHistory(createManualPracticeResult({ context, comfortableBpm: 72, durationMs: 300000, note: 'Синтетическая самооценка.' }), { ...metadata, id: 'synthetic-manual' });
}

function earSession() { return startEarSession({ root: 'A', quality: 'minor', count: 2, seed: 10000 }); }
function earHeard() { return completeEarListen(beginEarListen(earSession(), 0, 120), 1500); }

describe('schema4: настройки сопровождения и буквальная проверенная копияv3', () => {
  it('мигрирует все4источника истории без изменения событий/времён/целей и добавляет harmony и пустые настройки дорожек/входа', () => {
    const original = JSON.parse(v3BackupJson);
    const before = JSON.stringify(original);
    const migrated = parseBackup(v3BackupJson);
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.preferences).toEqual(v6Preferences({ ...original.preferences, tracks: null, input: { deviceId: '' }, harmony: { bpm: 80, countIn: true, repeat: 'once', bassVolume: 70, padVolume: 45, clickVolume: 50, bassMuted: false, padMuted: false, clickMuted: false } }));
    expect(migrated.history).toEqual(original.history.map(expectedLegacyEntry));
    expect(new Set(migrated.history.map(entry => entry.result.kind))).toEqual(new Set(['screen', 'manual', 'ear', 'route']));
    expect(migrated.presets).toEqual(original.presets.map((preset: any) => ({ ...preset, preferences: v6Preferences({ ...preset.preferences, tracks: null, input: { deviceId: '' }, harmony: DEFAULT_PREFERENCES.harmony }) })));
    expect(parseBackup(JSON.stringify(migrated))).toEqual(migrated);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('валидирует независимые целочисленные громкости, mute, отсчёт и once/infinite', () => {
    const preferences = validatePreferences({ ...DEFAULT_PREFERENCES, activeModule: 'harmony', harmony: { bpm: 220, countIn: false, repeat: 'infinite', bassVolume: 0, padVolume: 100, clickVolume: 35, bassMuted: true, padMuted: false, clickMuted: true } });
    expect(preferences).toMatchObject({ activeModule: 'harmony', harmony: { bpm: 220, countIn: false, repeat: 'infinite', bassVolume: 0, padVolume: 100, clickVolume: 35, bassMuted: true, padMuted: false, clickMuted: true } });
    for (const change of [
      (value: any) => { value.harmony.bpm = 39; }, (value: any) => { value.harmony.bpm = 80.5; },
      (value: any) => { value.harmony.padVolume = 45.5; }, (value: any) => { value.harmony.clickVolume = 101; },
      (value: any) => { value.harmony.bassMuted = 1; }, (value: any) => { value.harmony.repeat = 'ladder'; },
    ]) { const malformed = clone(preferences); change(malformed); expect(() => validatePreferences(malformed)).toThrow(); }
  });

  it('не принимает новые поля подстарой версией и неизвестную будущую7', () => {
    const original = JSON.parse(v3BackupJson);
    expect(() => parseBackup(JSON.stringify({ ...original, schemaVersion: 7 }))).toThrow(/версия/);
    const withNewField = clone(original); withNewField.preferences.harmony = DEFAULT_PREFERENCES.harmony;
    expect(() => parseBackup(JSON.stringify(withNewField))).toThrow(/неизвестные/);
    const withNewModule = clone(original); withNewModule.preferences.activeModule = 'harmony';
    expect(() => parseBackup(JSON.stringify(withNewModule))).toThrow(/Раздел версии 3/);
  });
});

describe('schema3: маршрут учитывает только активное время', () => {
  it('не пишет нулевой снимок и отделяет время маршрута от точности', () => {
    const initial = startRouteSession({ id: 'synthetic-route' });
    expect(makeRouteHistory(initial, metadata)).toBeNull();
    const entry = makeRouteHistory(advanceRouteSession(initial, 35000), { ...metadata, id: 'route-entry' })!;
    expect(entry.result).toMatchObject({ kind: 'route', source: 'active-timer', actualStepMs: [35000, 0, 0], totalPlannedMs: 600000, status: 'running' });
    expect(getHistorySummary([completed(), manual(), entry])).toMatchObject({ questions: 1, independentCorrect: 1, manualSessions: 1, routeSessions: 1, routeActiveMs: 35000 });
    expect(getReviewPositionIds([entry])).toEqual([]);
    expect(entry.result).not.toHaveProperty('accuracy');
  });

  it('паузы и ожидание следующего шага не увеличивают активные минуты', () => {
    let route = advanceRouteSession(startRouteSession({ id: 'paused-route' }), 60000);
    route = pauseRouteSession(route, 60000, 'hidden');
    route = advanceRouteSession(route, 160000);
    route = resumeRouteSession(route, 160000);
    route = advanceRouteSession(route, 280000);
    expect(route.status).toBe('between');
    route = advanceRouteSession(route, 500000);
    route = nextRouteStep(route, 500000);
    route = advanceRouteSession(route, 520000);
    const entry = makeRouteHistory(route, metadata)!;
    expect(entry.result.actualStepMs).toEqual([180000, 20000, 0]);
    expect(getHistorySummary([entry]).routeActiveMs).toBe(200000);
    expect(validateHistoryEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });

  it('раннее завершение хранит фактическое время без выдуманного полного занятия', () => {
    const stopped = stopRouteSession(startRouteSession({ id: 'early-route' }), 35000);
    const entry = makeRouteHistory(stopped, metadata)!;
    expect(entry.result).toMatchObject({ finishReason: 'stopped', status: 'finished', actualStepMs: [35000, 0, 0] });
    expect(getHistorySummary([entry]).routeActiveMs).toBe(35000);
  });

  it('отвергает изменение времени, статуса, границ или происхождения маршрута', () => {
    const good = makeRouteHistory(advanceRouteSession(startRouteSession({ id: 'forged-route' }), 200000), metadata)!;
    for (const change of [
      (value: any) => { value.result.actualStepMs[0] = 600000; },
      (value: any) => { value.result.plannedStepMs[0] = 600000; },
      (value: any) => { value.result.status = 'finished'; value.result.finishReason = 'completed'; },
      (value: any) => { value.result.events.find((event: any) => event.type === 'boundary').atMs = 200000; },
      (value: any) => { value.result.source = 'automatic-bass-score'; },
      (value: any) => { value.result.asOfMs = -1; },
    ]) { const invalid = clone(good); change(invalid); expect(() => validateHistoryEntry(invalid)).toThrow(); }
  });
});

describe('schema3: слуховое происхождение и перенос настоящих v2 данных', () => {
  it('добавляет настройки раздела/слуха ко всем v2 пресетам, сохраняя исходную историю точно', () => {
    const original = JSON.parse(v2BackupJson);
    const migrated = parseBackup(v2BackupJson);
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.preferences).toEqual(v6Preferences({ ...original.preferences, activeModule: 'foundation', ear: { root: 'A', quality: 'minor', count: 10, bpm: 80 }, tracks: null, input: { deviceId: '' }, harmony: DEFAULT_PREFERENCES.harmony }));
    expect(migrated.history).toEqual(original.history.map(expectedLegacyEntry));
    expect(migrated.presets).toEqual(original.presets.map((preset: any) => ({ ...preset, preferences: v6Preferences({ ...preset.preferences, activeModule: 'foundation', ear: { root: 'A', quality: 'minor', count: 10, bpm: 80 }, tracks: null, input: { deviceId: '' }, harmony: DEFAULT_PREFERENCES.harmony }) })));
    expect(parseBackup(JSON.stringify(migrated))).toEqual(migrated);
    const bad = JSON.parse(v2BackupJson); bad.preferences.activeModule = 'ear';
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/неизвестные/);
    expect(() => parseBackup(JSON.stringify({ ...original, schemaVersion: 7 }))).toThrow(/версия/);
  });

  it('проверяет обязательные настройки слухового раздела', () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ activeModule: 'foundation', ear: { root: 'A', quality: 'minor', count: 10, bpm: 80 } });
    for (const change of [
      (value: any) => { value.activeModule = 'other'; }, (value: any) => { value.ear.bpm = 121; },
      (value: any) => { value.ear.count = 21; }, (value: any) => { value.ear.quality = 'diminished'; },
      (value: any) => { value.ear.root = 'H'; },
    ]) { const input = clone(DEFAULT_PREFERENCES); change(input); expect(() => validatePreferences(input)).toThrow(); }
  });

  it('пустая сессия не создаёт запись; реальное начатое слушание остаётся interrupted', () => {
    expect(makeEarHistory(earSession(), metadata)).toBeNull();
    const entry = makeEarHistory(beginEarListen(earSession(), 0, 120), metadata)!;
    expect(entry.result).toMatchObject({ kind: 'ear', source: 'audio-choice', plannedCount: 2, context: { root: 'A', quality: 'minor' } });
    expect(entry.result.questions[0]).toMatchObject({ outcome: 'interrupted', listensStarted: 1, listensCompleted: 0, attempts: 0, firstResponseMs: null, independentCorrect: false, corrected: false, skipped: false, closedAtMs: null });
    expect(entry.result.questions[0]?.listenEvents[0]).toMatchObject({ type: 'start', bpm: 120, order: 1 });
    expect(getHistorySummary([entry])).toMatchObject({ questions: 0, screenSessions: 0, earSessions: 1, earQuestions: 1, earCompletedQuestions: 0, earInterrupted: 1 });
  });

  it('не смешивает слух, экран и самооценку; повтор ошибок не выдумывает позиции слухового задания', () => {
    const heard = earHeard();
    const entry = makeEarHistory(submitEarAnswer(heard, heard.currentQuestion.targetDegree, 1750), { ...metadata, id: 'ear-history' })!;
    expect(entry.result.questions[0]).toMatchObject({ firstResponseMs: 250, independentCorrect: true, listensCompleted: 1 });
    expect(getHistorySummary([completed(), manual(), entry])).toMatchObject({ screenSessions: 1, questions: 1, independentCorrect: 1, manualSessions: 1, earSessions: 1, earQuestions: 1, earIndependentCorrect: 1 });
    expect(getReviewPositionIds([entry])).toEqual([]);
  });

  it('восстанавливает порядок ответа и replay при одинаковых timestamps и фактический BPM120', () => {
    let session = earHeard();
    const target = session.currentQuestion.targetDegree;
    const wrong = session.currentQuestion.choices.find(choice => choice.id !== target)!.id;
    session = submitEarAnswer(session, wrong, 1500);
    session = beginEarListen(session, 1500, 120);
    session = completeEarListen(session, 3000);
    session = submitEarAnswer(session, target, 3000);
    const entry = makeEarHistory(session, metadata)!;
    expect(entry.result.questions[0]).toMatchObject({ outcome: 'corrected', firstResponseMs: 0, errors: 1, listensCompleted: 2, replayCount: 1 });
    expect(entry.result.questions[0]?.listenEvents.map(event => event.order)).toEqual([1, 2, 4, 5]);
    expect(entry.result.questions[0]?.answerEvents.map(event => event.order)).toEqual([3, 6]);
    expect(validateHistoryEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });

  it('показ и пропуск не повышают самостоятельность, незавершённая ошибка не получает fakecompletion', () => {
    const initial = earHeard();
    const wrong = initial.currentQuestion.choices.find(choice => choice.id !== initial.currentQuestion.targetDegree)!.id;
    const interrupted = makeEarHistory(submitEarAnswer(initial, wrong, 1600), metadata)!;
    expect(interrupted.result.questions[0]).toMatchObject({ outcome: 'interrupted', errors: 1, attempts: 1, independentCorrect: false, corrected: false });
    const revealed = makeEarHistory(revealEarAnswer(initial, 1800), metadata)!;
    const skipped = makeEarHistory(skipEarQuestion(earSession(), 20), metadata)!;
    expect(revealed.result.questions[0]).toMatchObject({ outcome: 'revealed', hintUsed: true, independentCorrect: false });
    expect(skipped.result.questions[0]).toMatchObject({ outcome: 'skipped', skipped: true, firstResponseMs: null });
  });

  it('отвергает forged counters, listening speed, event order и неправильную музыкальную цель', () => {
    const initial = earHeard();
    const good = makeEarHistory(submitEarAnswer(initial, initial.currentQuestion.targetDegree, 1700), metadata)!;
    for (const change of [
      (value: any) => { value.result.questions[0].listensCompleted = 2; },
      (value: any) => { value.result.questions[0].firstResponseMs = NaN; },
      (value: any) => { value.result.questions[0].listenEvents[0].bpm = 60; },
      (value: any) => { value.result.questions[0].answerEvents[0].order = 2; },
      (value: any) => { value.result.questions[0].question.targetMidi += 12; },
      (value: any) => { value.result.questions[0].question.targetName = 'wrong'; },
      (value: any) => { value.result.source = 'microphone'; },
      (value: any) => { value.result.seed += 1; },
    ]) { const invalid = clone(good); change(invalid); expect(() => validateHistoryEntry(invalid)).toThrow(); }
  });
});

describe('явное временное хранилище', () => {
  it('возвращает immutable снимок без повторной проверки всей истории; смена настроек сохраняет историю по ссылке', async () => {
    const store = createMemoryStudyStore();
    await store.addHistory(completed());
    const before = await store.readSnapshot();
    expect(await store.readSnapshot()).toBe(before);
    expect(await store.readSnapshot({ fresh: true })).toBe(before);
    await store.savePreferences({ ...before.preferences, player: { ...before.preferences.player, bpm: 86 } });
    const after = await store.readSnapshot();
    expect(after).not.toBe(before);
    expect(after.history).toBe(before.history);
    expect(after.history[0]).toBe(before.history[0]);
    expect(before.preferences.player.bpm).toBe(80);
    expect(Object.isFrozen(after)).toBe(true);
    const copy = await store.exportBackup();
    expect(copy).toBe(JSON.stringify(after));
    expect(MAX_BACKUP_BYTES).toBe(64 * 1024 * 1024);
    expect(parseBackup(copy)).toEqual(after);
  });

  it('отказ валидации и отмена восстановления не меняют опубликованный снимок', async () => {
    const store = createMemoryStudyStore();
    await store.addHistory(completed());
    const before = await store.readSnapshot();
    await expect(store.savePreferences({ ...before.preferences, player: { ...before.preferences.player, bpm: -1 } })).rejects.toMatchObject({ code: 'INVALID_DATA' });
    await expect(store.restore('{broken', { confirmed: true })).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
    await store.restore(JSON.stringify(emptySnapshot()), { confirmed: false });
    expect(await store.readSnapshot()).toBe(before);
    const firstEntry = before.history[0];
    await store.addHistory(manual());
    const after = await store.readSnapshot();
    expect(after.history.find(item => item.id === firstEntry.id)).toBe(firstEntry);
    expect(before.history).toHaveLength(1);
  });

  it('сериализует соседние записи без потери истории и не раскрывает изменяемые ссылки', async () => {
    const store = createMemoryStudyStore();
    expect(await store.open()).toEqual({ name: 'bass-study-memory', version: 6 });
    const preferences = { ...DEFAULT_PREFERENCES, player: { ...DEFAULT_PREFERENCES.player, bpm: 99 } };
    await Promise.all([store.addHistory(completed()), store.savePreferences(preferences), store.addHistory(manual())]);
    const snapshot = await store.readSnapshot();
    expect(snapshot.history.map(item => item.id)).toEqual(['synthetic-manual', 'synthetic-screen']);
    expect(snapshot.preferences.player.bpm).toBe(99);
    expect(Object.isFrozen(snapshot.history)).toBe(true);
    await store.addHistory(completed());
    expect((await store.readSnapshot()).history).toHaveLength(2);
  });

  it('экспортирует валидную копию и заменяет данные только после подтверждения', async () => {
    const store = createMemoryStudyStore();
    await store.addHistory(manual());
    const backup = await store.exportBackup();
    expect(parseBackup(backup).history[0]?.result.kind).toBe('manual');
    const empty = JSON.stringify(emptySnapshot());
    expect(store.previewImport(empty)).toMatchObject({ history: 0, presets: 0, replacement: 'full', requiresConfirmation: true });
    expect(await store.restore(empty, { confirmed: false })).toEqual({ status: 'cancelled' });
    expect((await store.readSnapshot()).history).toHaveLength(1);
    expect(await store.restore(empty, { confirmed: true })).toEqual({ status: 'restored', history: 0, presets: 0 });
    expect((await store.readSnapshot()).history).toHaveLength(0);
    await store.restore(backup, { confirmed: true });
    await store.close();
    await store.open();
    expect((await store.readSnapshot()).history).toHaveLength(1);
    expect((await createMemoryStudyStore().readSnapshot()).history).toHaveLength(0);
  });

  it('отказ не подменяется успехом, последующие операции продолжаются', async () => {
    const store = createMemoryStudyStore();
    await store.addHistory(manual());
    await expect(store.restore(JSON.stringify(emptySnapshot()), { confirmed: true, failAfterWrite: 1 })).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    await expect(store.deleteHistory('')).rejects.toMatchObject({ code: 'INVALID_DATA' });
    await expect(store.restore('{broken', { confirmed: true })).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
    expect((await store.readSnapshot()).history).toHaveLength(1);
    await store.deleteHistory('synthetic-manual');
    expect((await store.readSnapshot()).history).toHaveLength(0);
  });
});

describe('обычные JSON-значения без побочных эффектов', () => {
  it('не читает accessor происхождения результата или элемента массива', () => {
    let calls = 0;
    const record = clone(manual());
    Object.defineProperty(record.result, 'kind', { enumerable: true, get() { calls++; return 'manual'; } });
    expect(() => validateHistoryEntry(record)).toThrow();
    const snapshot = clone(emptySnapshot());
    const list: unknown[] = [];
    Object.defineProperty(list, '0', { enumerable: true, get() { calls++; return record; } });
    expect(() => validateSnapshot({ ...snapshot, history: list })).toThrow();
    expect(calls).toBe(0);
  });

  it('отклоняет разреженные массивы и посторонние свойства', () => {
    expect(() => validateSnapshot({ ...emptySnapshot(), history: new Array(1) })).toThrow();
    const list = Object.assign([], { extra: true });
    expect(() => validateSnapshot({ ...emptySnapshot(), presets: list })).toThrow();
  });

  it('обычная база не теряет читаемость после 1000 пресетов', () => {
    const presets = Array.from({ length: 1001 }, (_, i) => ({ id: `preset-${i}`, name: `Настройка ${i}`, createdAt: metadata.occurredAt, preferences: DEFAULT_PREFERENCES }));
    expect(validateSnapshot({ ...emptySnapshot(), presets }).presets).toHaveLength(1001);
  });
});

describe('настройки и пресеты', () => {
  it('defaults соответствуют реальным экранным настройкам и полному фрагменту', () => {
    const result = validatePreferences(DEFAULT_PREFERENCES);
    expect(result.study).toMatchObject({ root: 'A', structureId: 'minor-pentatonic', strings: ['G', 'D', 'A', 'E'], fretMin: 0, fretMax: 12, box: { shapeId: 'penta-a', anchorFret: 5 } });
    expect(result.training).toMatchObject({ mode: 'study', quizMode: 'name-note', count: 10, pattern: 'ascending', reviewPositionIds: [] });
    expect(result.player).toMatchObject({ bpm: 80, duration: 'eighth', repeat: 'once', from: null, to: null, ladderStart: 60, ladderEnd: 100, bassVolume: 70, clickVolume: 50 });
    expect(result).not.toBe(DEFAULT_PREFERENCES);
  });

  it('сохраняет диапазон фрагмента отдельно от длины будущего маршрута', () => {
    const input = clone(DEFAULT_PREFERENCES);
    const result = validatePreferences({ ...input, player: { ...input.player, from: 3, to: 90 } });
    expect(result.player.from).toBe(3);
    expect(result.player.to).toBe(90);
  });

  it.each([
    ['струны', (x: any) => { x.study.strings = ['E', 'E']; }],
    ['структура', (x: any) => { x.study.structureId = 'made-up'; }],
    ['тоника UI', (x: any) => { x.study.root = 'H'; }],
    ['диапазон', (x: any) => { x.study.fretMin = 20; x.study.fretMax = 4; }],
    ['режим', (x: any) => { x.training.mode = 'made-up'; }],
    ['порядок', (x: any) => { x.training.pattern = 'random-pattern'; }],
    ['ступень/область', (x: any) => { x.training.quizMode = 'find-degree'; x.training.scope = 'chromatic'; }],
    ['повтор ошибки', (x: any) => { x.training.reviewPositionIds = ['B:0']; }],
    ['темп', (x: any) => { x.player.bpm = 221; }],
    ['фрагмент', (x: any) => { x.player.from = 3; x.player.to = 2; }],
    ['лестница', (x: any) => { x.player.ladderEnd = 40; }],
    ['громкость', (x: any) => { x.player.clickVolume = 101; }],
    ['подразделение', (x: any) => { x.player.subdivision = 'triplet'; }],
  ])('отклоняет неверное поле %s', (_name, change) => {
    const input = clone(DEFAULT_PREFERENCES); change(input);
    expect(() => validatePreferences(input)).toThrow();
  });

  it('проверяет собственные plain-JSON поля без вызова accessor', () => {
    const input = clone(DEFAULT_PREFERENCES);
    let getterCalled = false;
    Object.defineProperty(input.study, 'root', { enumerable: true, get() { getterCalled = true; return 'A'; } });
    expect(() => validatePreferences(input)).toThrow(/JSON/);
    expect(getterCalled).toBe(false);
    const polluted = JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
    Object.defineProperty(polluted.study, '__proto__', { value: { polluted: true }, enumerable: true });
    expect(() => validatePreferences(polluted)).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('валидирует пресет без привязки истории к удаляемому пресету', () => {
    const preset = validatePreset({ id: 'preset-one', name: '  Мой диапазон  ', createdAt: metadata.occurredAt, preferences: DEFAULT_PREFERENCES });
    expect(preset.name).toBe('Мой диапазон');
    expect(() => validatePreset({ ...preset, createdAt: '2026-02-30T00:00:00.000Z' })).toThrow();
    expect(() => validatePreset({ ...preset, name: ' ' })).toThrow();
  });
});

describe('история реальных экранных действий', () => {
  it('пустая сессия не создаёт фиктивную запись', () => {
    expect(makeScreenHistory(quiz(), metadata)).toBe(null);
  });

  it('сохраняет контекст один раз, цель вопроса и самостоятельный ответ', () => {
    const entry = completed();
    expect(entry.result).toMatchObject({ kind: 'screen', source: 'screen-input', plannedCount: 1, mode: 'name-note' });
    expect(entry.result.questions[0]).toMatchObject({ outcome: 'correct', independentCorrect: true, firstAnswer: 'E', firstResponseMs: 350 });
    expect(entry.result.questions[0].targetPositionId).toBeTruthy();
    expect(entry.result.questions[0]).not.toHaveProperty('context');
    expect(entry.localDate).toBe('2026-11-08');
  });

  it('ошибка и исправление не превращаются в самостоятельное прохождение', () => {
    let session = submitAnswer(quiz(), 'F', 100);
    session = submitAnswer(session, 'E', 500);
    const entry = makeScreenHistory(session, metadata)!;
    expect(entry.result.questions[0]).toMatchObject({ outcome: 'corrected', errors: 1, independentCorrect: false, corrected: true });
    expect(getReviewPositionIds([entry])).toEqual([entry.result.questions[0].targetPositionId]);
  });

  it('показ и пропуск хранятся отдельно от ответов', () => {
    const shown = makeScreenHistory(revealAnswer(quiz(), 700), metadata)!;
    const skipped = makeScreenHistory(skipQuestion(quiz(), 800), { ...metadata, id: 'skipped' })!;
    expect(shown.result.questions[0]).toMatchObject({ outcome: 'revealed', hintUsed: true, firstAnswer: null, firstResponseMs: null, independentCorrect: false });
    expect(skipped.result.questions[0]).toMatchObject({ outcome: 'skipped', skipped: true, firstResponseMs: null, independentCorrect: false });
    expect(getHistorySummary([shown, skipped])).toMatchObject({ hints: 1, skipped: 1, independentCorrect: 0, completedQuestions: 2 });
  });

  it('прерванный вопрос с ошибкой остаётся прерванным, без fake skip/completion', () => {
    const entry = makeScreenHistory(submitAnswer(quiz('find-note'), 'A:0', 250), metadata)!;
    expect(entry.result.questions[0]).toMatchObject({ outcome: 'interrupted', errors: 1, completionMs: null, skipped: false, independentCorrect: false });
    expect(getHistorySummary([entry])).toMatchObject({ interrupted: 1, completedQuestions: 0, errors: 1 });
    expect(getReviewPositionIds([entry])).toEqual(['E:0', 'E:12']);
  });

  it('частичный find-all сохраняет реальные попытки, но не получает оценку correct', () => {
    const partial = submitAnswer(quiz('find-all'), 'E:0', 150);
    const entry = makeScreenHistory(partial, metadata)!;
    expect(entry.result.questions[0]).toMatchObject({ outcome: 'interrupted', attempts: 1, firstAttemptCorrect: true, independentCorrect: false, selectedPositionIds: ['E:0'] });
    expect(getReviewPositionIds([entry])).toEqual(['E:0', 'E:12']);
  });

  it('найденный полный набор и повторный клик не завышают число попыток', () => {
    let session = submitAnswer(quiz('find-all'), 'E:0', 100);
    session = submitAnswer(session, 'E:0', 120);
    session = submitAnswer(session, 'E:12', 300);
    const entry = makeScreenHistory(session, metadata)!;
    expect(entry.result.questions[0]).toMatchObject({ outcome: 'correct', attempts: 2, independentCorrect: true, completionMs: 300 });
    expect(getReviewPositionIds([entry])).toEqual([]);
  });

  it('не дублирует последний результат уже завершённой сессии', () => {
    const session = nextQuestion(submitAnswer(quiz(), 'E', 250));
    expect(session.status).toBe('finished');
    expect(makeScreenHistory(session, metadata)!.result.questions).toHaveLength(1);
  });
});

describe('достоверность и переносимость копии', () => {
  it('сохраняет самооценку отдельным типом без accuracy или correct', () => {
    const entry = manual();
    expect(entry.result).toMatchObject({ kind: 'manual', source: 'self-report', comfortableBpm: 72, durationMs: 300000 });
    expect(entry.result).not.toHaveProperty('accuracy');
    expect(entry.result).not.toHaveProperty('independentCorrect');
    const summary = getHistorySummary([completed(), entry]);
    expect(summary).toMatchObject({ screenSessions: 1, manualSessions: 1, manualDurationMs: 300000, independentCorrect: 1 });
  });

  it('фиксирует исходный локальный календарный день, даже если он отличается от UTC', () => {
    const meta = { ...metadata, occurredAt: '2026-11-08T23:30:00.000Z' };
    const entry = makeManualHistory(manual().result, meta);
    expect(entry.localDate).toBe('2026-11-09');
    expect(originalLocalDate(meta.occurredAt, 'America/New_York')).toBe('2026-11-08');
    expect(() => validateHistoryEntry({ ...entry, localDate: '2026-11-08' })).toThrow(/Дата/);
    expect(() => validateHistoryEntry({ ...entry, timeZone: 'not-a-zone' })).toThrow(/часовой пояс/);
  });

  it('группирует скорость только при совпадающих типе и области', () => {
    const first = completed();
    const second = makeScreenHistory(submitAnswer(quiz('find-note'), 'E:0', 500), { ...metadata, id: 'find-note' })!;
    const summary = getHistorySummary([first, second]);
    expect(summary.groups).toHaveLength(2);
    expect(summary.groups.map(group => group.meanFirstResponseMs)).toEqual([350, 500]);
    expect(summary).not.toHaveProperty('meanFirstResponseMs');
  });

  it('экспортируемая версия проходит JSON roundtrip без изменения входа', () => {
    const snapshot = { ...emptySnapshot(), history: [completed(), manual()] };
    const before = JSON.stringify(snapshot);
    const restored = parseBackup(before);
    expect(restored.history.map(entry => entry.result.kind).sort()).toEqual(['manual', 'screen']);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(parseBackup(JSON.stringify(restored))).toEqual(restored);
  });

  it.each([
    ['исправленный счётчик', (x: any) => { x.result.questions[0].independentCorrect = false; }],
    ['число ошибок', (x: any) => { x.result.questions[0].errors = 2; }],
    ['подменённая попытка', (x: any) => { x.result.questions[0].answerEvents[0].correct = false; }],
    ['неверная цель', (x: any) => { x.result.questions[0].target.pitchClass = 9; }],
    ['чужая позиция', (x: any) => { x.result.questions[0].targetPositionId = 'A:0'; }],
    ['подменённый тип', (x: any) => { x.result.source = 'microphone'; }],
    ['неизвестная структура', (x: any) => { x.result.context.structureId = 'dorian'; }],
    ['пустая история', (x: any) => { x.result.questions = []; }],
  ])('отвергает недостоверное поле: %s', (_name, change) => {
    const bad = clone(completed()); change(bad);
    expect(() => validateHistoryEntry(bad)).toThrow();
  });

  it('отвергает лишние, повреждённые и дублированные записи до записи в базу', () => {
    expect(() => parseBackup('{broken')).toThrow();
    expect(() => validateSnapshot({ ...emptySnapshot(), format: 'other' })).toThrow();
    expect(() => validateSnapshot({ ...emptySnapshot(), schemaVersion: 7 })).toThrow();
    const entry: HistoryEntry = completed();
    expect(() => validateSnapshot({ ...emptySnapshot(), history: [entry, entry] })).toThrow(/повторяются/);
    const wrong: any = clone(manual()); wrong.result.accuracy = 100;
    expect(() => validateHistoryEntry(wrong)).toThrow(/неизвестные/);
    expect(() => validateHistoryEntry({ ...entry, occurredAt: '2026-02-30T00:00:00.000Z' })).toThrow();
  });
});

describe('schema2: точная высота, интервалы и миграция настоящей копии v1', () => {
  it('переносит старые данные, добавляя только новые семантические поля', () => {
    const old = JSON.parse(v1BackupJson);
    const inputBefore = JSON.stringify(old);
    const migrated = parseBackup(v1BackupJson);
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.preferences.training.intervalDegree).toBe('#4');
    expect(migrated.presets[0]?.preferences.training.intervalDegree).toBe('#4');
    const legacyScreen = old.history.find((entry: any) => entry.id === 'legacy-screen');
    const screen = migrated.history.find(entry => entry.id === 'legacy-screen') as ScreenHistoryEntry;
    expect(screen).toEqual(expectedLegacyEntry({ ...legacyScreen, result: { ...legacyScreen.result, questions: legacyScreen.result.questions.map((question: any) => ({ ...question, targetMidi: null })) } }));
    expect(migrated.history.find(entry => entry.id === 'legacy-manual')).toEqual(expectedLegacyEntry(old.history.find((entry: any) => entry.id === 'legacy-manual')));
    expect(screen.localDate).toBe('2026-11-07');
    expect(screen.result.questions[0]?.answerEvents).toEqual([{ answer: 'F', elapsedMs: 500, correct: false }, { answer: 'E', elapsedMs: 950, correct: true }]);
    expect(JSON.stringify(old)).toBe(inputBefore);
    expect(parseBackup(JSON.stringify(migrated))).toEqual(migrated);
  });

  it('не принимает повреждённую или ложно помеченную v1 и будущую версию', () => {
    for (const change of [
      (value: any) => { value.preferences.training.intervalDegree = '#4'; },
      (value: any) => { value.history[0].result.questions[0].targetMidi = null; },
      (value: any) => { value.history[0].result.questions[0].errors = 0; },
      (value: any) => { value.preferences.training.quizMode = 'find-pitch'; },
      (value: any) => { value.schemaVersion = 7; },
    ]) {
      const malformed = JSON.parse(v1BackupJson); change(malformed);
      expect(() => parseBackup(JSON.stringify(malformed))).toThrow();
    }
  });

  it('точная высота сохраняется и повтор ошибок ограничен той же высотой', () => {
    const available = annotatePositions([getPosition('E', 5), getPosition('A', 0), getPosition('A', 12)], structure);
    let session = startQuiz({ positions: available, structure, mode: 'find-pitch', seed: 1 }, 1);
    const midi = session.currentQuestion.targetMidi;
    // A1 or A2 may be selected by the session's derived seed; the other octave must fail.
    const wrong = midi === 33 ? 'A:12' : 'A:0';
    session = submitAnswer(session, wrong, 100);
    session = submitAnswer(session, session.currentQuestion.expectedPositionIds[0], 400);
    const entry = makeScreenHistory(session, metadata)!;
    expect(entry.result.questions[0]).toMatchObject({ targetMidi: midi, answerRule: 'exact-pitch', outcome: 'corrected', errors: 1 });
    expect(getReviewPositionIds([entry])).toEqual(midi === 33 ? ['E:5', 'A:0'] : ['A:12']);
    const bad: any = clone(entry); bad.result.questions[0].targetMidi = null;
    expect(() => validateHistoryEntry(bad)).toThrow(/высота/);
  });

  it('произвольный интервал проверяет контекстное имя, а не только класс', () => {
    const cMajor = createStructure('C', 'major');
    const available = annotatePositions([getPosition('E', 2), getPosition('E', 14)], cMajor);
    const session = submitAnswer(startQuiz({ positions: available, structure: cMajor, mode: 'find-interval', intervalDegree: '#4', seed: 1 }, 1), 'E:2', 200);
    const entry = makeScreenHistory(session, metadata)!;
    expect(entry.result).toMatchObject({ mode: 'find-interval', context: { scope: 'chromatic' } });
    expect(entry.result.questions[0]?.target).toEqual({ name: 'F♯', pitchClass: 6, degree: '#4' });
    const bad: any = clone(entry); bad.result.questions[0].target.name = 'G♭';
    expect(() => validateHistoryEntry(bad)).toThrow(/Написание/);
  });
});
