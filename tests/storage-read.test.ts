import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/backup.json?raw';
import { DEFAULT_PREFERENCES, describeSkippedRecords, parseBackup, readStoredSnapshot, validateHistoryEntry, validateSnapshot, type StoredRecords } from '../src/storage';

const backup = JSON.parse(fixture);
const records = (patch: Partial<StoredRecords> = {}): StoredRecords => ({
  preferences: backup.preferences, profile: backup.profile, activeRhythmProjectId: backup.activeRhythmProjectId,
  exercises: backup.exercises, history: backup.history, practiceDrafts: backup.practiceDrafts, rhythmProjects: backup.rhythmProjects, ...patch,
});

describe('чтение собственной базы', () => {
  it('на корректных записях даёт тот же снимок, что полная проверка', () => {
    const { snapshot, skipped } = readStoredSnapshot(records());
    expect(skipped).toEqual([]);
    expect(snapshot).toEqual(validateSnapshot(backup));
    // В базе лежат записи, уже прошедшие полную проверку. Кеш после записи и свежее чтение
    // должны давать байт-в-байт одинаковый экспорт, включая порядок полей.
    const canonical = validateSnapshot(backup);
    const reread = readStoredSnapshot({ preferences: canonical.preferences, profile: canonical.profile, activeRhythmProjectId: canonical.activeRhythmProjectId,
      exercises: canonical.exercises, history: canonical.history, practiceDrafts: canonical.practiceDrafts, rhythmProjects: canonical.rhythmProjects }).snapshot;
    expect(JSON.stringify(reread)).toBe(JSON.stringify(canonical));
    expect(new Set(snapshot.history.map(entry => entry.result.kind))).toEqual(new Set(['screen', 'manual', 'ear', 'route', 'check']));
    expect(snapshot.exercises.map(exercise => exercise.id)).toEqual(['fixture-penta']);
  });

  it('пропускает одну повреждённую запись, а остальные данные читает', () => {
    const broken = { id: 'broken-entry', occurredAt: 'вчера' };
    const { snapshot, skipped } = readStoredSnapshot(records({ history: [...backup.history, broken] }));
    expect(snapshot.history.map(entry => entry.id)).toEqual(backup.history.map((entry: { id: string }) => entry.id).sort());
    expect(skipped).toEqual([{ store: 'history', id: 'broken-entry', reason: expect.any(String) }]);
    expect(describeSkippedRecords(skipped)).toMatch(/Не прочитано повреждённых записей: 1 \(история — 1\)/);
  });

  it('заменяет повреждённые настройки умолчаниями и сообщает об этом', () => {
    const { snapshot, skipped } = readStoredSnapshot(records({ preferences: { ...backup.preferences, activeModule: 'unknown' } }));
    expect(snapshot.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(skipped.map(record => record.store)).toEqual(['preferences']);
  });

  it('сбрасывает выбор отсутствующего проекта ритма, не теряя библиотеку', () => {
    const { snapshot } = readStoredSnapshot(records({ activeRhythmProjectId: 'missing-project' }));
    expect(snapshot.activeRhythmProjectId).toBeNull();
    expect(snapshot.rhythmProjects).toHaveLength(backup.rhythmProjects.length);
  });

  it('повторяет ответы только при импорте', () => {
    const screen = structuredClone(backup.history.find((entry: { result: { kind: string } }) => entry.result.kind === 'screen'));
    screen.result.questions[0].errors += 1;
    expect(() => validateHistoryEntry(screen)).toThrow(/не соответствует реальным попыткам/);
    expect(() => parseBackup(JSON.stringify({ ...backup, history: [screen] }))).toThrow();
    expect(readStoredSnapshot(records({ history: [screen] })).skipped).toEqual([]);
  });
});

describe('импорт копии', () => {
  it('не перекодирует весь файл: размер уже проверен по File.size', () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    try {
      parseBackup(JSON.stringify(backup));
      expect(encode).not.toHaveBeenCalled();
    } finally { encode.mockRestore(); }
  });
});
