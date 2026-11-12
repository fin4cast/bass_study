import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import type { CheckRecord, PlayRecord, PracticeRecord } from '../src/practice/results';
import {
  addDays, calendarWeeks, checkTally, datePeriod, dayRecords, defaultDay, describeDifficulty, difficultyViews, formatActive, formatLongDate,
  formatShortDate, intensityLevel, joinDates, mondayOf, plural, progressRows, tallyText, weekRangeLabel, weekSummary,
} from '../src/ui/progress/model';
import { dateTicks, markerSvg, placeByDate, sparkSvg, sparkText, tempoChartSvg, tempoScale } from '../src/ui/progress/charts';

const spec = createExerciseSpec('connect-forms');
let clock = 0;
const play = (localDate: string, exerciseKey: string, bpm: number, assessment: PlayRecord['assessment'], minutes = 5, title = exerciseKey): PlayRecord => ({
  kind: 'play', exerciseKey, title, spec, assessment, bpm, activeMs: minutes * 60_000, localDate, occurredAt: `${localDate}T10:00:${String(clock++ % 60).padStart(2, '0')}.000Z`,
});
const check = (localDate: string, exerciseKey: string, answers: CheckRecord['answers'], minutes = 4, title = exerciseKey): CheckRecord => ({
  kind: 'check', exerciseKey, title, answers, activeMs: minutes * 60_000, localDate, occurredAt: `${localDate}T12:00:${String(clock++ % 60).padStart(2, '0')}.000Z`,
});
const TODAY = '2026-11-12';
const records: PracticeRecord[] = [
  play('2026-10-22', 'builtin:connect-forms', 60, 'clean', 6, 'Связка соседних форм'),
  play('2026-11-04', 'builtin:connect-forms', 72, 'errors', 8, 'Связка соседних форм'),
  play('2026-11-10', 'builtin:connect-forms', 76, 'errors', 7, 'Связка соседних форм'),
  play('2026-11-11', 'builtin:connect-forms', 76, 'clean', 7, 'Связка соседних форм'),
  play('2026-11-03', 'builtin:chromatic-position', 84, 'clean', 4, 'Хроматика'),
  play('2026-11-03', 'builtin:chromatic-position', 88, 'slow', 3, 'Хроматика'),
  check('2026-10-28', 'check:penta-b', [{ degree: 'b7', outcome: 'corrected', errors: 1 }, { degree: '1', outcome: 'correct', errors: 0 }, { degree: '4', outcome: 'revealed', errors: 0 }], 4, 'Ступени формы B'),
  check('2026-11-06', 'check:penta-b', [{ degree: 'b7', outcome: 'corrected', errors: 1 }, { degree: '1', outcome: 'correct', errors: 0 }, { degree: '5', outcome: 'skipped', errors: 0 }], 4, 'Ступени формы B'),
];

describe('даты «Прогресса»', () => {
  it('считает дни в UTC и выводит русские подписи', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(mondayOf('2026-11-12')).toBe('2026-11-09');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(formatShortDate('2026-11-04')).toBe('4 ноя');
    expect(formatLongDate('2026-11-11')).toBe('ср, 11 ноября');
    expect(weekRangeLabel('2026-11-09')).toBe('9–15 ноя');
    expect(weekRangeLabel('2026-10-26')).toBe('26 окт – 1 ноя');
    expect(joinDates(['2026-11-10', '2026-11-04'])).toBe('4 и 10 ноя');
    expect(joinDates(['2026-10-28', '2026-11-06', '2026-11-08'])).toBe('28 окт, 6 и 8 ноя');
    expect(() => addDays('2026-13-01', 1)).toThrow();
  });
  it('склоняет числительные и не показывает нули минут', () => {
    expect([1, 2, 5, 11, 21, 22, 112].map(n => plural(n, 'день', 'дня', 'дней'))).toEqual(['день', 'дня', 'дней', 'дней', 'день', 'дня', 'дней']);
    expect(formatActive(20_000)).toBe('меньше минуты');
    expect(formatActive(7 * 60_000)).toBe('7 мин');
  });
});

describe('строки упражнений', () => {
  it('не смешивает источники и берёт лучший темп только из «Чисто»', () => {
    const all = progressRows(records, 'all');
    expect(all.map(row => row.key)).toEqual(['builtin:connect-forms', 'check:penta-b', 'builtin:chromatic-position']);
    const link = all.find(row => row.key === 'builtin:connect-forms');
    expect(link).toMatchObject({ kind: 'play', bestCleanBpm: 76, firstBpm: 60 });
    expect(link?.kind === 'play' && link.passes.map(pass => pass.bpm)).toEqual([60, 72, 76, 76]);
    expect(progressRows(records, 'play').every(row => row.kind === 'play')).toBe(true);
    expect(progressRows(records, 'check').map(row => row.kind)).toEqual(['check']);
    expect(progressRows([], 'all')).toEqual([]);
  });
  it('раскладывает ответы проверки по исходам без слияния с игрой', () => {
    const row = progressRows(records, 'check')[0];
    expect(row.kind).toBe('check');
    if (row.kind !== 'check') return;
    expect(row.last.tally).toMatchObject({ self: 1, fixed: 1, shown: 0, skipped: 1, total: 3 });
    expect(row.last.missed).toEqual(['♭7', '5']);
    expect(tallyText(row.last.tally)).toBe('самостоятельно 1 · с исправлением 1 · пропущено 1');
    expect(checkTally(check(TODAY, 'x', [{ degree: '1', outcome: 'unanswered', errors: 0 }])).unanswered).toBe(1);
  });
});

describe('трудные места', () => {
  it('формулирует конкретно и фильтрует по источнику', () => {
    const views = difficultyViews(records, 'all');
    expect(views.map(view => view.title)).toEqual([
      'Связка соседних форм — с ошибками',
      'Темп 88 в «Хроматика» — не успевал',
      'Ступень ♭7 в «Ступени формы B»',
    ]);
    expect(views[0].detail).toBe('2 отметки «С ошибками» · 4 и 10 ноя');
    expect(views[1].detail).toBe('«Не успевал» · 3 ноя · чисто — 84');
    expect(views[2].detail).toBe('2 ошибки или подсказки в ответах · 28 окт и 6 ноя');
    expect(difficultyViews(records, 'check').map(view => view.source)).toEqual(['check']);
    expect(difficultyViews(records, 'play').every(view => view.source === 'play')).toBe(true);
    expect(new Set(views.map(view => view.id)).size).toBe(views.length);
    expect(describeDifficulty({ kind: 'slow', exerciseKey: 'k', title: 'Гамма', bpm: 90, bestCleanBpm: null, dates: [TODAY] }).detail).toContain('«Чисто» ещё не было');
  });
});

describe('неделя и календарь', () => {
  it('считает активные минуты недели и прошлой недели', () => {
    const week = weekSummary(records, TODAY, 'all');
    expect(week.label).toBe('9–15 ноя');
    expect(week.days.map(day => day.minutes)).toEqual([0, 7, 7, 0, 0, 0, 0]);
    expect(week.days.filter(day => day.future).map(day => day.date)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
    expect(week).toMatchObject({ minutes: 14, activeDays: 2, inProgress: true, previous: { minutes: 19, activeDays: 3 } });
    expect(weekSummary(records, TODAY, 'check').minutes).toBe(0);
  });
  it('строит 4 недели × 7 дней с будущими днями и днями до первой записи', () => {
    const weeks = calendarWeeks(records, TODAY, 'all');
    expect(weeks).toHaveLength(4);
    expect(weeks.map(week => week.monday)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect(weeks.every(week => week.days.length === 7)).toBe(true);
    expect(weeks[0].days.slice(0, 3).map(day => day.state)).toEqual(['before', 'before', 'before']);
    expect(weeks[0].days[3]).toMatchObject({ date: '2026-10-22', state: 'past', minutes: 6, kinds: ['play'] });
    expect(weeks[3].days[3].state).toBe('today');
    expect(weeks[3].days[4]).toMatchObject({ state: 'future', minutes: 0, level: 0 });
    expect(weeks[2].days.find(day => day.date === '2026-11-06')?.kinds).toEqual(['check']);
    expect(weeks[2].minutes).toBe(7 + 8 + 4);
    expect(calendarWeeks(records, TODAY, 'check')[2].days.find(day => day.date === '2026-11-04')?.minutes).toBe(0);
    expect(() => calendarWeeks(records, TODAY, 'all', 0)).toThrow();
  });
  it('уровни заливки относительны и без нулевого дня', () => {
    expect([0, 1, 5, 10, 15, 20].map(minutes => intensityLevel(minutes, 20))).toEqual([0, 1, 1, 2, 3, 4]);
    expect(intensityLevel(5, 0)).toBe(0);
  });
  it('выбирает начальный день и записи дня по источнику', () => {
    expect(defaultDay(records, TODAY)).toBe('2026-11-11');
    expect(defaultDay([], TODAY)).toBe(TODAY);
    const day = dayRecords(records, '2026-11-03', 'all');
    expect(day.records.map(record => record.kind === 'play' && record.assessment)).toEqual(['clean', 'slow']);
    expect(day.minutes).toBe(7);
    expect(dayRecords(records, '2026-11-03', 'check')).toMatchObject({ hidden: 2, minutes: 0 });
  });
});

describe('графики', () => {
  const period = datePeriod(records, TODAY);
  it('общая ось дат от первой записи до сегодня, не короче недели', () => {
    expect(period).toEqual({ start: '2026-10-22', end: TODAY, days: 21 });
    expect(datePeriod([], TODAY)).toEqual({ start: '2026-11-06', end: TODAY, days: 6 });
    const ticks = dateTicks(period, TODAY);
    expect(ticks[0]).toMatchObject({ date: '2026-10-22', anchor: 'start', label: '22 окт' });
    expect(ticks.at(-1)).toMatchObject({ date: TODAY, anchor: 'end', label: 'сегодня' });
    expect(ticks.slice(1, -1).map(tick => tick.date)).toEqual(['2026-10-26', '2026-11-02']);
    expect(ticks.length).toBeLessThanOrEqual(5);
  });
  it('шкала темпа кратна шагу и охватывает все значения', () => {
    expect(tempoScale([60, 76])).toMatchObject({ lo: 56, hi: 80, step: 4 });
    expect(tempoScale([60, 100])).toMatchObject({ lo: 56, hi: 104, step: 8 });
    const flat = tempoScale([72]);
    expect(flat.hi).toBeGreaterThan(flat.lo);
    expect(() => tempoScale([])).toThrow();
  });
  it('размещает записи по дате и разводит записи одного дня', () => {
    const placed = placeByDate([{ localDate: '2026-10-22' }, { localDate: TODAY }, { localDate: TODAY }], period, 0, 210, 6);
    expect(placed.map(point => point.x)).toEqual([0, 210, 216]);
  });
  it('отметки различаются формой, графики подписаны', () => {
    expect(markerSvg('clean', 0, 0)).toMatch(/^<circle class="pg-m-clean"/);
    expect(markerSvg('errors', 0, 0)).toMatch(/^<path class="pg-m-errors" d="M0 -5L5 0/);
    expect(markerSvg('slow', 0, 0)).toMatch(/^<path class="pg-m-slow"/);
    const row = progressRows(records, 'play')[0];
    expect(row.kind).toBe('play');
    if (row.kind !== 'play') return;
    const spark = sparkSvg(row, period);
    expect(spark).toContain('aria-hidden="true"');
    expect(spark).toContain('>76<');
    expect(spark).toContain('>60<');
    expect(sparkText(row)).toBe('Темп по датам: 22 окт — 60, Чисто; 4 ноя — 72, С ошибками; 10 ноя — 76, С ошибками; 11 ноя — 76, Чисто');
    const chart = tempoChartSvg(row, period, TODAY, 600);
    expect(chart).toContain('role="img"');
    expect(chart).toContain('BPM ♩');
    expect(chart).toContain('сегодня');
    expect(chart).toContain('лучший 76');
  });
  it('мини-график проверки — столбцы исходов, без темпа', () => {
    const row = progressRows(records, 'check')[0];
    const spark = sparkSvg(row, period);
    expect(spark).toContain('pg-b-self');
    expect(spark).toContain('pg-b-fixed');
    expect(spark).toContain('pg-b-skipped');
    expect(spark).not.toContain('pg-m-clean');
    expect(sparkText(row)).toBe('Самостоятельно по датам: 28 окт — 1 из 3; 6 ноя — 1 из 3');
  });
});
