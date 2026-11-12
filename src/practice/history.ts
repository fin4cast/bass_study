/**
 * Записи «Прогресса» из истории занятий (R-011, R-026).
 * Самооценка прохода упражнения становится PlayRecord, итог «Проверь себя» — CheckRecord;
 * прочие записи (прежние задания, слух, маршрут, ручные отметки без упражнения) в «Прогресс» не попадают.
 * Чистый модуль: история уже проверена на границе хранилища.
 */
import type { HistoryEntry } from '../storage/model';
import type { CheckRecord, PlayRecord, PracticeRecord } from './results';

export function practiceRecords(history: readonly HistoryEntry[]): readonly PracticeRecord[] {
  const records: PracticeRecord[] = [];
  for (const entry of history) {
    const { result } = entry;
    if (result.kind === 'manual' && result.material.kind === 'exercise' && result.assessment !== null) {
      const play: PlayRecord = {
        kind: 'play', exerciseKey: result.material.key, title: result.material.title, spec: result.material.spec,
        assessment: result.assessment, bpm: result.comfortableBpm, activeMs: result.durationMs,
        localDate: entry.localDate, occurredAt: entry.occurredAt,
      };
      records.push(Object.freeze(play));
    } else if (result.kind === 'check') {
      const check: CheckRecord = {
        kind: 'check', exerciseKey: result.exerciseKey, title: result.title, activeMs: result.activeMs,
        localDate: entry.localDate, occurredAt: entry.occurredAt, answers: result.answers,
      };
      records.push(Object.freeze(check));
    }
  }
  return Object.freeze(records);
}
