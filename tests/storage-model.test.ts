import { describe, expect, it } from 'vitest';
import v1BackupJson from './fixtures/v1-backup.json?raw';
import { createMemoryStudyStore } from '../src/storage/memory';
import { annotatePositions, createStructure, getPosition } from '../src/music';
import { createManualPracticeResult, nextQuestion, revealAnswer, skipQuestion, startQuiz, submitAnswer, type QuizMode } from '../src/training';
import {
  DEFAULT_PREFERENCES, emptySnapshot, getHistorySummary, getReviewPositionIds, makeManualHistory, makeScreenHistory,
  originalLocalDate, parseBackup, validateHistoryEntry, validatePreferences, validatePreset, validateSnapshot,
  type HistoryEntry, type ScreenHistoryEntry,
} from '../src/storage/model';

const structure = createStructure('A', 'minor-pentatonic');
const positions = annotatePositions([getPosition('E', 0), getPosition('E', 12)], structure);
const context = { scope: 'structure' as const, root: 'A', structureId: 'minor-pentatonic' as const, positionIds: ['E:0', 'E:12'] };
const metadata = { id: 'synthetic-screen', occurredAt: '2026-11-08T09:00:00.000Z', timeZone: 'Europe/Moscow' };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function quiz(mode: QuizMode = 'name-note', count = 1) { return startQuiz({ positions, structure, mode, scope: 'structure', seed: 100 }, count); }
function completed() { return makeScreenHistory(nextQuestion(submitAnswer(quiz(), 'E', 350)), metadata)!; }
function manual() {
  return makeManualHistory(createManualPracticeResult({ context, comfortableBpm: 72, durationMs: 300000, note: 'Синтетическая самооценка.' }), { ...metadata, id: 'synthetic-manual' });
}

describe('явное временное хранилище', () => {
  it('сериализует соседние записи без потери истории и не раскрывает изменяемые ссылки', async () => {
    const store = createMemoryStudyStore();
    expect(await store.open()).toEqual({ name: 'bass-study-memory', version: 2 });
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
    expect(result.study).toMatchObject({ root: 'A', structureId: 'minor-pentatonic', strings: ['G', 'D', 'A', 'E'], fretMin: 0, fretMax: 12 });
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
    expect(() => validateSnapshot({ ...emptySnapshot(), schemaVersion: 3 })).toThrow();
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
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.preferences.training.intervalDegree).toBe('#4');
    expect(migrated.presets[0]?.preferences.training.intervalDegree).toBe('#4');
    const legacyScreen = old.history.find((entry: any) => entry.id === 'legacy-screen');
    const screen = migrated.history.find(entry => entry.id === 'legacy-screen') as ScreenHistoryEntry;
    expect(screen).toEqual({ ...legacyScreen, result: { ...legacyScreen.result, questions: legacyScreen.result.questions.map((question: any) => ({ ...question, targetMidi: null })) } });
    expect(migrated.history.find(entry => entry.id === 'legacy-manual')).toEqual(old.history.find((entry: any) => entry.id === 'legacy-manual'));
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
      (value: any) => { value.schemaVersion = 3; },
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
