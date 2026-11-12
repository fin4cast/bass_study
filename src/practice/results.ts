/**
 * Результаты занятия для «Прогресса» (R-011, R-026, VIS-08).
 * Самооценка игры и экранные ответы «Проверь себя» — разные источники; агрегаты их никогда не смешивают.
 * Чистый модуль: записи приходят из истории, хранение — забота приложения.
 */
import type { ExerciseSpec } from '../exercises';

export type Assessment = 'clean' | 'errors' | 'slow';
export const ASSESSMENT_LABELS: Readonly<Record<Assessment, string>> = Object.freeze({ clean: 'Чисто', errors: 'С ошибками', slow: 'Не успевал' });

export interface PlayRecord {
  readonly kind: 'play';
  readonly exerciseKey: string;
  readonly title: string;
  readonly spec: ExerciseSpec;
  readonly assessment: Assessment;
  /** Темп прохода, четверти в минуту. */
  readonly bpm: number;
  readonly activeMs: number;
  readonly localDate: string;
  readonly occurredAt: string;
}
export type CheckOutcome = 'correct' | 'corrected' | 'revealed' | 'skipped' | 'unanswered';
export interface CheckRecord {
  readonly kind: 'check';
  readonly exerciseKey: string;
  readonly title: string;
  readonly activeMs: number;
  readonly localDate: string;
  readonly occurredAt: string;
  /** Ступень вопроса (например, «b7») и исход; ошибки — число неверных ответов до верного. */
  readonly answers: readonly { readonly degree: string; readonly outcome: CheckOutcome; readonly errors: number }[];
}
export type PracticeRecord = PlayRecord | CheckRecord;
export type SourceFilter = 'play' | 'check' | 'all';

export interface ExerciseProgress {
  readonly exerciseKey: string;
  readonly title: string;
  readonly passes: number;
  /** Лучший комфортный темп — самый быстрый проход с отметкой «Чисто»; без «Чисто» — null. */
  readonly bestCleanBpm: number | null;
  readonly firstBpm: number;
  readonly series: readonly { readonly localDate: string; readonly bpm: number; readonly assessment: Assessment }[];
  readonly last: { readonly localDate: string; readonly bpm: number; readonly assessment: Assessment };
}
export interface CheckProgress {
  readonly exerciseKey: string;
  readonly title: string;
  readonly checks: number;
  readonly last: { readonly localDate: string; readonly independent: number; readonly total: number };
}
export type Difficulty =
  | { readonly kind: 'errors'; readonly exerciseKey: string; readonly title: string; readonly count: number; readonly dates: readonly string[] }
  | { readonly kind: 'slow'; readonly exerciseKey: string; readonly title: string; readonly bpm: number; readonly bestCleanBpm: number | null; readonly dates: readonly string[] }
  | { readonly kind: 'degree'; readonly exerciseKey: string; readonly title: string; readonly degree: string; readonly count: number; readonly dates: readonly string[] };

const chronological = <T extends { occurredAt: string }>(records: readonly T[]) => [...records].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
const unique = (values: readonly string[]) => [...new Set(values)];

export function exerciseProgress(records: readonly PracticeRecord[]): readonly ExerciseProgress[] {
  const plays = chronological(records.filter((record): record is PlayRecord => record.kind === 'play'));
  const groups = new Map<string, PlayRecord[]>();
  for (const record of plays) groups.set(record.exerciseKey, [...(groups.get(record.exerciseKey) ?? []), record]);
  return Object.freeze([...groups.values()].map(group => {
    const clean = group.filter(record => record.assessment === 'clean').map(record => record.bpm);
    const last = group.at(-1)!;
    return Object.freeze({
      exerciseKey: last.exerciseKey, title: last.title, passes: group.length,
      bestCleanBpm: clean.length ? Math.max(...clean) : null, firstBpm: group[0].bpm,
      series: Object.freeze(group.map(record => Object.freeze({ localDate: record.localDate, bpm: record.bpm, assessment: record.assessment }))),
      last: Object.freeze({ localDate: last.localDate, bpm: last.bpm, assessment: last.assessment }),
    });
  }).sort((a, b) => b.last.localDate.localeCompare(a.last.localDate) || a.title.localeCompare(b.title, 'ru')));
}

export function checkProgress(records: readonly PracticeRecord[]): readonly CheckProgress[] {
  const checks = chronological(records.filter((record): record is CheckRecord => record.kind === 'check'));
  const groups = new Map<string, CheckRecord[]>();
  for (const record of checks) groups.set(record.exerciseKey, [...(groups.get(record.exerciseKey) ?? []), record]);
  return Object.freeze([...groups.values()].map(group => {
    const last = group.at(-1)!;
    return Object.freeze({
      exerciseKey: last.exerciseKey, title: last.title, checks: group.length,
      last: Object.freeze({ localDate: last.localDate, independent: last.answers.filter(answer => answer.outcome === 'correct').length, total: last.answers.length }),
    });
  }));
}

/**
 * Трудные места (VIS-08):
 * - упражнение с двумя и более отметками «С ошибками»;
 * - «Не успевал» на темпе выше лучшего «Чисто» (или без «Чисто» вообще);
 * - ступень, на которой в «Проверь себя» было две и более ошибки, показа или пропуска.
 */
export function difficulties(records: readonly PracticeRecord[]): readonly Difficulty[] {
  const result: Difficulty[] = [];
  const progress = new Map(exerciseProgress(records).map(item => [item.exerciseKey, item]));
  const plays = chronological(records.filter((record): record is PlayRecord => record.kind === 'play'));
  const byKey = new Map<string, PlayRecord[]>();
  for (const record of plays) byKey.set(record.exerciseKey, [...(byKey.get(record.exerciseKey) ?? []), record]);
  for (const [key, group] of byKey) {
    const errors = group.filter(record => record.assessment === 'errors');
    if (errors.length >= 2) result.push({ kind: 'errors', exerciseKey: key, title: group[0].title, count: errors.length, dates: unique(errors.map(record => record.localDate)) });
    const best = progress.get(key)!.bestCleanBpm;
    const slow = group.filter(record => record.assessment === 'slow' && (best === null || record.bpm > best));
    if (slow.length) result.push({ kind: 'slow', exerciseKey: key, title: group[0].title, bpm: Math.min(...slow.map(record => record.bpm)), bestCleanBpm: best, dates: unique(slow.map(record => record.localDate)) });
  }
  const misses = new Map<string, { exerciseKey: string; title: string; degree: string; count: number; dates: string[] }>();
  for (const record of chronological(records.filter((item): item is CheckRecord => item.kind === 'check'))) {
    for (const answer of record.answers) {
      const missed = answer.errors + (answer.outcome === 'revealed' || answer.outcome === 'skipped' ? 1 : 0);
      if (!missed) continue;
      const id = `${record.exerciseKey}|${answer.degree}`;
      const entry = misses.get(id) ?? { exerciseKey: record.exerciseKey, title: record.title, degree: answer.degree, count: 0, dates: [] };
      entry.count += missed; entry.dates.push(record.localDate); misses.set(id, entry);
    }
  }
  for (const entry of misses.values()) if (entry.count >= 2) result.push({ kind: 'degree', ...entry, dates: unique(entry.dates) });
  return Object.freeze(result.map(item => Object.freeze(item)));
}

/** Активные минуты по локальным датам для выбранного источника. */
export function minutesByDay(records: readonly PracticeRecord[], source: SourceFilter = 'all'): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const record of records) {
    if (source !== 'all' && record.kind !== source) continue;
    totals.set(record.localDate, (totals.get(record.localDate) ?? 0) + record.activeMs);
  }
  return new Map([...totals].sort(([a], [b]) => a.localeCompare(b)).map(([date, ms]) => [date, Math.round(ms / 60000)]));
}

/** Ключи упражнений, по которым есть самооценка игры («в работе» в библиотеке). */
export const playedKeys = (records: readonly PracticeRecord[]) => new Set(records.filter(record => record.kind === 'play').map(record => record.exerciseKey));
