/**
 * «Прогресс» (VIS-08 r1, A+B): чистая модель представления без DOM.
 * Даты — локальные ключи YYYY-MM-DD; арифметика дней идёт в UTC, чтобы часовой пояс не сдвигал сетку.
 * Самооценка игры и экранные ответы «Проверь себя» не смешиваются: у каждой строки свой источник.
 */
import { builtinTemplateOf } from '../../practice/material';
import { EXERCISE_TEMPLATES } from '../../exercises';
import {
  ASSESSMENT_LABELS, difficulties, exerciseProgress, minutesByDay, recordSource,
  type Assessment, type CheckOutcome, type CheckRecord, type Difficulty, type ManualArea, type ManualRecord, type PlayRecord, type PracticeRecord, type SourceFilter,
} from '../../practice/results';
import type { FretboardReview } from '../../practice/history';

export const DAY_MS = 86_400_000;
const DATE_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const WEEK_HEADER = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export const isDateKey = (value: unknown): value is string => typeof value === 'string' && DATE_KEY.test(value);
function utc(key: string) {
  if (!isDateKey(key)) throw new RangeError(`Ожидается дата YYYY-MM-DD: ${String(key)}.`);
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}
const keyOf = (time: number) => new Date(time).toISOString().slice(0, 10);
export const addDays = (key: string, days: number) => keyOf(utc(key) + days * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);
export const weekdayOf = (key: string) => new Date(utc(key)).getUTCDay();
export const mondayOf = (key: string) => addDays(key, -((weekdayOf(key) + 6) % 7));
export const dayOfMonth = (key: string) => new Date(utc(key)).getUTCDate();

/** Локальная дата устройства (а не UTC): так же, как `localDate` записей. */
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatShortDate(key: string) {
  const date = new Date(utc(key));
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`;
}
export function formatLongDate(key: string) {
  const date = new Date(utc(key));
  return `${WEEKDAYS_SHORT[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS_GENITIVE[date.getUTCMonth()]}`;
}
/** «9–15 ноя» внутри месяца, «26 окт – 1 ноя» на стыке. */
export function weekRangeLabel(monday: string) {
  const sunday = addDays(monday, 6);
  const sameMonth = new Date(utc(monday)).getUTCMonth() === new Date(utc(sunday)).getUTCMonth();
  return sameMonth ? `${dayOfMonth(monday)}–${formatShortDate(sunday)}` : `${formatShortDate(monday)} – ${formatShortDate(sunday)}`;
}
/** Перечень дат: «4 и 10 ноя», «28 окт и 6 ноя», «3, 5 и 8 ноя». */
export function joinDates(keys: readonly string[]) {
  const sorted = [...new Set(keys)].sort();
  if (!sorted.length) return '';
  const parts = sorted.map((key, index) => {
    const next = sorted[index + 1];
    const sameMonthAsNext = next !== undefined && new Date(utc(key)).getUTCMonth() === new Date(utc(next)).getUTCMonth()
      && new Date(utc(key)).getUTCFullYear() === new Date(utc(next)).getUTCFullYear();
    return sameMonthAsNext ? String(dayOfMonth(key)) : formatShortDate(key);
  });
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} и ${parts.at(-1)}`;
}

export function plural(count: number, one: string, few: string, many: string) {
  const mod10 = Math.abs(count) % 10, mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
export const countWord = (count: number, one: string, few: string, many: string) => `${count} ${plural(count, one, few, many)}`;
/** Активное время одной записи: «7 мин»; меньше полуминуты — «меньше минуты». */
export function formatActive(ms: number) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? 'меньше минуты' : `${minutes} мин`;
}
/** Ступень проверки для экрана: `b7` → `♭7`. */
export const degreeLabel = (degree: string) => degree.replace(/^b/, '♭').replace(/^#/, '♯');

export const matchesSource = (record: PracticeRecord, source: SourceFilter) => source === 'all' || recordSource(record) === source;
const chronological = <T extends PracticeRecord>(records: readonly T[]) => [...records].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

/* ---------- Источники и исходы ---------- */

export const SOURCE_LABELS = Object.freeze({ play: 'Игра · самооценка', check: 'Проверь себя · экран' });
/** Подпись ручной отметки без упражнения: «Ручная отметка · Гриф». */
export const MANUAL_LABELS: Readonly<Record<ManualArea, string>> = Object.freeze({ fretboard: 'Ручная отметка · Гриф', rhythm: 'Ручная отметка · Ритм' });
export const SOURCE_FILTER_LABELS: Readonly<Record<SourceFilter, string>> = Object.freeze({ play: 'Игра (самооценка)', check: 'Проверь себя', all: 'Всё' });
export const MARK_LABELS: Readonly<Record<Assessment, string>> = ASSESSMENT_LABELS;
export type OutcomeGroup = 'self' | 'fixed' | 'shown' | 'skipped' | 'unanswered';
export const OUTCOME_ORDER: readonly OutcomeGroup[] = ['self', 'fixed', 'shown', 'skipped', 'unanswered'];
export const OUTCOME_GROUP: Readonly<Record<CheckOutcome, OutcomeGroup>> = Object.freeze({
  correct: 'self', corrected: 'fixed', revealed: 'shown', skipped: 'skipped', unanswered: 'unanswered',
});
export const OUTCOME_LABELS: Readonly<Record<OutcomeGroup, string>> = Object.freeze({
  self: 'самостоятельно', fixed: 'с исправлением', shown: 'показано', skipped: 'пропущено', unanswered: 'без ответа',
});
export type CheckTally = Readonly<Record<OutcomeGroup, number>> & { readonly total: number };

export function checkTally(record: CheckRecord): CheckTally {
  const tally: Record<OutcomeGroup, number> = { self: 0, fixed: 0, shown: 0, skipped: 0, unanswered: 0 };
  for (const answer of record.answers) tally[OUTCOME_GROUP[answer.outcome]]++;
  return Object.freeze({ ...tally, total: record.answers.length });
}
/** «самостоятельно 3 · с исправлением 2 · показано 1» — только ненулевые исходы. */
export const tallyText = (tally: CheckTally) => OUTCOME_ORDER.filter(group => tally[group]).map(group => `${OUTCOME_LABELS[group]} ${tally[group]}`).join(' · ');
/**
 * Ступени, где были ошибки, показ или пропуск. Вопросы «без ответа» (досрочное завершение, прерванный сигнал слуха)
 * не входят: их цель не была открыта и в «Прогрессе» не раскрывается (R-016), как и в `difficulties`.
 */
export const missedDegrees = (record: CheckRecord) =>
  [...new Set(record.answers.filter(answer => answer.errors > 0 || answer.outcome === 'corrected' || answer.outcome === 'revealed' || answer.outcome === 'skipped').map(answer => degreeLabel(answer.degree)))];

/* ---------- Строки упражнений (A) ---------- */

export interface PlayPass { readonly id: string; readonly localDate: string; readonly occurredAt: string; readonly bpm: number; readonly assessment: Assessment; readonly activeMs: number }
export interface PlayRow {
  readonly kind: 'play';
  readonly key: string;
  readonly title: string;
  readonly passes: readonly PlayPass[];
  readonly bestCleanBpm: number | null;
  readonly firstBpm: number;
  readonly last: PlayPass;
  readonly spec: PlayRecord['spec'];
}
export interface CheckPass { readonly id: string; readonly localDate: string; readonly occurredAt: string; readonly tally: CheckTally; readonly missed: readonly string[]; readonly activeMs: number }
export interface CheckRow {
  readonly kind: 'check';
  readonly key: string;
  readonly title: string;
  readonly passes: readonly CheckPass[];
  /** Лучший результат: больше всего самостоятельных ответов (при равенстве — более поздний). */
  readonly best: CheckTally;
  readonly last: CheckPass;
}
export type ProgressRow = PlayRow | CheckRow;

/** Строки «Упражнений» для источника: сначала недавние. Лучший темп берётся из `exerciseProgress` — одно определение. */
export function progressRows(records: readonly PracticeRecord[], source: SourceFilter): readonly ProgressRow[] {
  const rows: ProgressRow[] = [];
  if (source !== 'check') {
    const plays = chronological(records.filter((record): record is PlayRecord => record.kind === 'play'));
    for (const progress of exerciseProgress(plays)) {
      const group = plays.filter(record => record.exerciseKey === progress.exerciseKey);
      const passes = group.map(record => Object.freeze({ id: record.id, localDate: record.localDate, occurredAt: record.occurredAt, bpm: record.bpm, assessment: record.assessment, activeMs: record.activeMs }));
      rows.push(Object.freeze({
        kind: 'play', key: progress.exerciseKey, title: progress.title, passes: Object.freeze(passes),
        bestCleanBpm: progress.bestCleanBpm, firstBpm: progress.firstBpm, last: passes.at(-1)!, spec: group.at(-1)!.spec,
      }));
    }
  }
  if (source !== 'play') {
    const checks = chronological(records.filter((record): record is CheckRecord => record.kind === 'check'));
    const groups = new Map<string, CheckRecord[]>();
    for (const record of checks) groups.set(record.exerciseKey, [...(groups.get(record.exerciseKey) ?? []), record]);
    for (const [key, group] of groups) {
      const passes = group.map(record => Object.freeze({ id: record.id, localDate: record.localDate, occurredAt: record.occurredAt, tally: checkTally(record), missed: Object.freeze(missedDegrees(record)), activeMs: record.activeMs }));
      const best = passes.reduce((top, pass) => (pass.tally.self >= top.tally.self ? pass : top), passes[0]).tally;
      rows.push(Object.freeze({ kind: 'check', key, title: group.at(-1)!.title, passes: Object.freeze(passes), best, last: passes.at(-1)! }));
    }
  }
  return Object.freeze(rows.sort((a, b) => b.last.occurredAt.localeCompare(a.last.occurredAt) || a.title.localeCompare(b.title, 'ru')));
}

/**
 * Группа строк «Упражнений»: одно упражнение (встроенный шаблон) с раскрытием по материалу (D-049).
 * Свои упражнения и проверки разных видов не смешиваются со встроенными проходами.
 */
export interface ProgressGroup {
  readonly key: string;
  readonly title: string;
  readonly kind: ProgressRow['kind'];
  readonly rows: readonly ProgressRow[];
  /** Лучший темп «Чисто» среди материалов группы (только проходы). */
  readonly bestCleanBpm: number | null;
}

export function progressGroups(rows: readonly ProgressRow[]): readonly ProgressGroup[] {
  const groups = new Map<string, ProgressRow[]>();
  for (const row of rows) {
    const template = builtinTemplateOf(row.key);
    const key = template ? `${row.kind}:tpl:${template}` : `${row.kind}:${row.key}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Object.freeze([...groups].map(([key, group]) => {
    const template = builtinTemplateOf(group[0].key);
    const title = EXERCISE_TEMPLATES.find(item => item.id === template)?.title ?? group[0].title;
    const tempos = group.flatMap(row => row.kind === 'play' && row.bestCleanBpm !== null ? [row.bestCleanBpm] : []);
    return Object.freeze({ key, title, kind: group[0].kind, rows: Object.freeze(group), bestCleanBpm: tempos.length ? Math.max(...tempos) : null });
  }));
}

/* ---------- Трудные места ---------- */

export interface DifficultyView {
  readonly id: string;
  readonly source: 'play' | 'check';
  readonly title: string;
  readonly detail: string;
  readonly difficulty: Difficulty;
}
export const difficultyId = (difficulty: Difficulty) =>
  difficulty.kind === 'degree' ? `degree|${difficulty.exerciseKey}|${difficulty.degree}` : `${difficulty.kind}|${difficulty.exerciseKey}`;

export function describeDifficulty(difficulty: Difficulty): DifficultyView {
  const id = difficultyId(difficulty);
  if (difficulty.kind === 'errors') return Object.freeze({
    id, difficulty, source: 'play', title: `${difficulty.title} — с ошибками`,
    detail: `${countWord(difficulty.count, 'отметка', 'отметки', 'отметок')} «С ошибками» · ${joinDates(difficulty.dates)}`,
  });
  if (difficulty.kind === 'slow') return Object.freeze({
    id, difficulty, source: 'play', title: `Темп ${difficulty.bpm} в «${difficulty.title}» — не успевал`,
    detail: `«Не успевал» · ${joinDates(difficulty.dates)} · ${difficulty.bestCleanBpm === null ? '«Чисто» ещё не было' : `чисто — ${difficulty.bestCleanBpm}`}`,
  });
  return Object.freeze({
    id, difficulty, source: 'check', title: `Ступень ${degreeLabel(difficulty.degree)} в «${difficulty.title}»`,
    detail: `${countWord(difficulty.count, 'ошибка', 'ошибки', 'ошибок')} или подсказки в ответах · ${joinDates(difficulty.dates)}`,
  });
}
export const difficultyViews = (records: readonly PracticeRecord[], source: SourceFilter) =>
  Object.freeze(difficulties(records).map(describeDifficulty).filter(view => source === 'all' || view.source === source));

/** Карточка «Задания на грифе» в «Трудных местах»: экранные ответы, поэтому видна в «Проверь себя» и «Всё». */
export interface FretboardReviewView { readonly title: string; readonly detail: string; readonly reasons: string; readonly count: number }
export function describeFretboardReview(review: FretboardReview): FretboardReviewView {
  const count = review.positionIds.length;
  const { errors, hints, skipped } = review.reasons;
  const reasons = [errors && `ошибка — ${errors}`, hints && `показ ответа — ${hints}`, skipped && `пропуск — ${skipped}`].filter(Boolean).join(', ');
  return Object.freeze({
    count,
    title: `Задания на грифе: ${countWord(count, 'позиция', 'позиции', 'позиций')} с ошибками`,
    detail: `${review.material} · ${joinDates(review.dates)}`,
    reasons: reasons ? `В вопросах: ${reasons}.` : '',
  });
}
export const showsFretboardReview = (source: SourceFilter) => source !== 'play';

/* ---------- Не сохранено: черновики ручной практики ---------- */

/** Черновик для блока «Не сохранено»: время под звук, предложенный темп и заметка ещё не записаны в историю. */
export interface DraftView {
  readonly id: string;
  readonly area: ManualArea;
  readonly title: string;
  /** Несохранённое время под звук. */
  readonly activeMs: number;
  readonly bpm: number;
  readonly minBpm: number;
  readonly maxBpm: number;
  readonly note: string;
  readonly localDate: string;
  /** Черновик последнего занятия в «Ритме» (новых черновиков «Гриф» после P13-08 не создаёт). */
  readonly current: boolean;
  /** Ошибка последнего действия; видна до успешного повтора. */
  readonly error?: string;
}
/** Время черновика: «2 мин 05 с», меньше минуты — «45 с». */
export function formatDraftTime(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${String(seconds % 60).padStart(2, '0')} с`;
}
/** Темп из поля: целое число в границах; иначе `null`. */
export function parseTempo(text: string, min: number, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/* ---------- Неделя (A) и календарь (B) ---------- */

export interface WeekDay { readonly date: string; readonly weekday: string; readonly minutes: number; readonly future: boolean; readonly today: boolean }
export interface WeekSummary {
  readonly monday: string;
  readonly label: string;
  readonly days: readonly WeekDay[];
  readonly minutes: number;
  readonly activeDays: number;
  readonly previous: { readonly minutes: number; readonly activeDays: number };
  readonly inProgress: boolean;
}
export function weekSummary(records: readonly PracticeRecord[], today: string, source: SourceFilter): WeekSummary {
  const minutes = minutesByDay(records, source);
  const monday = mondayOf(today);
  const week = (start: string) => Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const total = (dates: readonly string[]) => ({
    minutes: dates.reduce((sum, date) => sum + (minutes.get(date) ?? 0), 0),
    activeDays: dates.filter(date => (minutes.get(date) ?? 0) > 0).length,
  });
  const dates = week(monday);
  const days = dates.map(date => Object.freeze({
    date, weekday: WEEKDAYS_SHORT[weekdayOf(date)], minutes: minutes.get(date) ?? 0, future: date > today, today: date === today,
  }));
  return Object.freeze({ monday, label: weekRangeLabel(monday), days: Object.freeze(days), ...total(dates), previous: Object.freeze(total(week(addDays(monday, -7)))), inProgress: today < addDays(monday, 6) });
}

export type DayState = 'past' | 'today' | 'future' | 'before';
export interface CalendarDay {
  readonly date: string;
  readonly day: number;
  readonly state: DayState;
  readonly minutes: number;
  readonly records: number;
  readonly kinds: readonly ('play' | 'check')[];
  /** Интенсивность заливки 0–4 относительно самого длинного дня сетки. */
  readonly level: 0 | 1 | 2 | 3 | 4;
}
export interface CalendarWeek { readonly monday: string; readonly label: string; readonly days: readonly CalendarDay[]; readonly minutes: number; readonly activeDays: number }

export const intensityLevel = (minutes: number, max: number): CalendarDay['level'] =>
  minutes <= 0 || max <= 0 ? 0 : (Math.min(4, Math.max(1, Math.ceil((minutes / max) * 4))) as CalendarDay['level']);

/** Сетка недель × 7 дней, последняя неделя — текущая. Дни до первой записи помечены `before`. */
export function calendarWeeks(records: readonly PracticeRecord[], today: string, source: SourceFilter, weeks = 4): readonly CalendarWeek[] {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) throw new RangeError('Календарь показывает от 1 до 12 недель.');
  const minutes = minutesByDay(records, source);
  const earliest = records.length ? records.map(record => record.localDate).sort()[0] : today;
  const lastMonday = mondayOf(today);
  const mondays = Array.from({ length: weeks }, (_, index) => addDays(lastMonday, (index - weeks + 1) * 7));
  const visible = records.filter(record => matchesSource(record, source));
  const byDate = new Map<string, PracticeRecord[]>();
  for (const record of visible) byDate.set(record.localDate, [...(byDate.get(record.localDate) ?? []), record]);
  const max = Math.max(0, ...mondays.flatMap(monday => Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    return date <= today ? minutes.get(date) ?? 0 : 0;
  })));
  return Object.freeze(mondays.map(monday => {
    const days = Array.from({ length: 7 }, (_, index): CalendarDay => {
      const date = addDays(monday, index);
      const state: DayState = date > today ? 'future' : date === today ? 'today' : date < earliest ? 'before' : 'past';
      const list = state === 'future' ? [] : byDate.get(date) ?? [];
      const value = state === 'future' ? 0 : minutes.get(date) ?? 0;
      const kinds = (['play', 'check'] as const).filter(kind => list.some(record => recordSource(record) === kind));
      return Object.freeze({ date, day: dayOfMonth(date), state, minutes: value, records: list.length, kinds: Object.freeze(kinds), level: intensityLevel(value, max) });
    });
    return Object.freeze({
      monday, label: weekRangeLabel(monday), days: Object.freeze(days),
      minutes: days.reduce((sum, day) => sum + day.minutes, 0), activeDays: days.filter(day => day.minutes > 0).length,
    });
  }));
}

/** День для начального выбора: сегодня, если в нём есть записи, иначе последний день с записями в сетке, иначе сегодня. */
export function defaultDay(records: readonly PracticeRecord[], today: string, weeks = 4) {
  const from = addDays(mondayOf(today), -(weeks - 1) * 7);
  const dates = records.map(record => record.localDate).filter(date => date >= from && date <= today).sort();
  return dates.at(-1) ?? today;
}

export function dayRecords(records: readonly PracticeRecord[], date: string, source: SourceFilter) {
  const all = chronological(records.filter(record => record.localDate === date));
  const shown = all.filter(record => matchesSource(record, source));
  return Object.freeze({ records: Object.freeze(shown), hidden: all.length - shown.length, minutes: minutesByDay(shown).get(date) ?? 0 });
}

/** Период общей оси дат: от первой видимой записи до сегодня, не короче недели. */
export function datePeriod(records: readonly PracticeRecord[], today: string) {
  const first = records.length ? records.map(record => record.localDate).sort()[0] : today;
  const start = daysBetween(first, today) < 6 ? addDays(today, -6) : first;
  return Object.freeze({ start, end: today, days: daysBetween(start, today) });
}

export { ASSESSMENT_LABELS };
export type { Assessment, Difficulty, ManualArea, ManualRecord, PracticeRecord, SourceFilter };
