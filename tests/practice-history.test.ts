import { describe, expect, it } from 'vitest';
import backupJson from './fixtures/backup.json?raw';
import { createExerciseSpec } from '../src/exercises';
import { practiceRecords } from '../src/practice/history';
import { exerciseProgress, checkProgress, minutesByDay, difficulties } from '../src/practice/results';
import { createManualPracticeResult } from '../src/training/results';
import { makeCheckHistory, makeManualHistory, parseBackup } from '../src/storage';

const spec = createExerciseSpec('arpeggio-1358');
const play = (id: string, occurredAt: string, assessment: 'clean' | 'errors' | 'slow', bpm: number) => makeManualHistory(createManualPracticeResult({
  context: null, comfortableBpm: bpm, durationMs: 60000, note: '', assessment,
  material: { kind: 'exercise', key: 'user:arp', title: 'Моё арпеджио', spec, view: 'board', wholePass: true },
}), { id, occurredAt, timeZone: 'Europe/Moscow' });

describe('записи «Прогресса» из истории', () => {
  it('проход упражнения → PlayRecord, «Проверь себя» → CheckRecord, ручная отметка ритма → ManualRecord; прочие записи пропускаются', () => {
    const history = parseBackup(backupJson).history;
    const records = practiceRecords(history);
    expect(records).toEqual([
      { kind: 'check', id: 'fixture-check-history', exerciseKey: 'builtin:pentatonic-form.A.minor-pentatonic.penta-b', title: 'Форма пентатоники вверх-вниз', spec: createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' }), checkKind: 'name-degree', ear: false, activeMs: 95000, localDate: '2026-11-09', occurredAt: '2026-11-08T22:45:00.000Z',
        answers: history.find(entry => entry.result.kind === 'check')!.result.kind === 'check' ? (history.find(entry => entry.result.kind === 'check')!.result as { answers: unknown }).answers : [] },
      { kind: 'play', id: 'fixture-exercise-history', exerciseKey: 'user:fixture-penta', title: 'Am пентатоника, форма B', spec: createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' }), assessment: 'clean',
        bpm: 84, activeMs: 180000, localDate: '2026-11-09', occurredAt: '2026-11-08T22:40:00.000Z', view: 'both', wholePass: true },
      { kind: 'manual', id: 'fixture-rhythm-history', area: 'rhythm', title: 'Ритм-секция · Триольный грув · Основной грув · 117 BPM', bpm: 117, activeMs: 600,
        note: 'Отметка ритма', localDate: '2026-11-09', occurredAt: '2026-11-08T22:35:00.000Z' },
    ]);
    expect(history.length).toBeGreaterThan(records.length);
    expect(Object.isFrozen(records)).toBe(true);
    expect(practiceRecords([])).toEqual([]);
  });

  it('агрегаты «Прогресса» читают локальную дату и темп прохода из истории', () => {
    const history = [
      play('p1', '2026-11-08T20:30:00.000Z', 'clean', 80),
      play('p2', '2026-11-08T21:30:00.000Z', 'errors', 92),
      play('p3', '2026-11-09T09:00:00.000Z', 'errors', 92),
      makeCheckHistory({ exerciseKey: 'user:arp', title: 'Моё арпеджио', activeMs: 120000, spec: { version: 'check-v1', exercise: spec, kind: 'find-degree', count: 3, ear: false },
        answers: [{ degree: '3', outcome: 'revealed', errors: 1 }, { degree: '5', outcome: 'correct', errors: 0 }, { degree: '1', outcome: 'correct', errors: 0 }] }, { id: 'c1', occurredAt: '2026-11-09T10:00:00.000Z', timeZone: 'Europe/Moscow' })!,
    ];
    const records = practiceRecords(history);
    expect(exerciseProgress(records)).toEqual([expect.objectContaining({ exerciseKey: 'user:arp', passes: 3, bestCleanBpm: 80, firstBpm: 80, last: { localDate: '2026-11-09', bpm: 92, assessment: 'errors' } })]);
    expect(checkProgress(records)).toEqual([expect.objectContaining({ checks: 1, last: { localDate: '2026-11-09', independent: 2, total: 3 } })]);
    // 23:30 по Москве — ещё 8 ноября, 00:30 — уже 9-е: дата берётся из исходного пояса записи.
    expect(records.map(record => record.localDate)).toEqual(['2026-11-08', '2026-11-09', '2026-11-09', '2026-11-09']);
    expect([...minutesByDay(records, 'play')]).toEqual([['2026-11-08', 1], ['2026-11-09', 2]]);
    expect([...minutesByDay(records, 'check')]).toEqual([['2026-11-09', 2]]);
    expect(difficulties(records).map(item => item.kind).sort()).toEqual(['degree', 'errors']);
  });
});
