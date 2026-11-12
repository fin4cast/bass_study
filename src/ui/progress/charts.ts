/**
 * Графики «Прогресса»: чистые построители inline SVG без библиотек.
 * Цвета задаются классами (`pg-m-*`, `pg-b-*`, `pg-g-*`) и токенами темы в progress.css.
 * Отметки различаются формой: «Чисто» — круг, «С ошибками» — ромб, «Не успевал» — крест.
 */
import { escapeHtml } from '../html';
import {
  MARK_LABELS, OUTCOME_LABELS, OUTCOME_ORDER, addDays, daysBetween, formatShortDate, weekdayOf,
  type Assessment, type CheckRow, type CheckTally, type PlayRow, type ProgressRow,
} from './model';

export interface Period { readonly start: string; readonly end: string; readonly days: number }
export interface DateTick { readonly date: string; readonly label: string; readonly anchor: 'start' | 'middle' | 'end' }

const round = (value: number) => Math.round(value * 10) / 10;

/** Подписи общей оси дат: начало, понедельники между ними (не теснее ~15 % ширины), конец («сегодня»). */
export function dateTicks(period: Period, today: string, maxTicks = 5): readonly DateTick[] {
  if (maxTicks < 2) throw new RangeError('На оси дат нужны хотя бы начало и конец.');
  const label = (date: string) => (date === today ? 'сегодня' : formatShortDate(date));
  const ticks: DateTick[] = [{ date: period.start, label: label(period.start), anchor: 'start' }];
  if (period.days > 0) {
    const gap = Math.max(1, Math.ceil(period.days * 0.15));
    const mondays: string[] = [];
    for (let offset = 1; offset < period.days; offset++) {
      const date = addDays(period.start, offset);
      if (weekdayOf(date) === 1 && offset >= gap && period.days - offset >= gap) mondays.push(date);
    }
    const stride = Math.max(1, Math.ceil(mondays.length / (maxTicks - 2)));
    mondays.filter((_, index) => index % stride === 0).forEach(date => ticks.push({ date, label: label(date), anchor: 'middle' }));
    ticks.push({ date: period.end, label: label(period.end), anchor: 'end' });
  }
  return Object.freeze(ticks.map(tick => Object.freeze(tick)));
}

/** Шкала темпа крупного графика: шаг 4 или 8 BPM, границы с запасом и кратные шагу. */
export function tempoScale(values: readonly number[]) {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new RangeError('Для шкалы темпа нужны числа.');
  const min = Math.min(...values), max = Math.max(...values);
  const step = max - min > 24 ? 8 : 4;
  const lo = Math.floor((min - 2) / step) * step;
  const hi = Math.max(lo + step, Math.ceil((max + 2) / step) * step);
  const ticks: number[] = [];
  for (let value = lo; value <= hi; value += step) ticks.push(value);
  return Object.freeze({ lo, hi, step, ticks: Object.freeze(ticks) });
}

/** Абсцисса даты на общей оси; повторные записи одного дня сдвигаются вправо на `sameDayShift`. */
export function placeByDate<T extends { readonly localDate: string }>(items: readonly T[], period: Period, x0: number, x1: number, sameDayShift: number) {
  const seen = new Map<string, number>();
  return items.map(item => {
    const index = seen.get(item.localDate) ?? 0;
    seen.set(item.localDate, index + 1);
    const ratio = period.days > 0 ? Math.min(1, Math.max(0, daysBetween(period.start, item.localDate) / period.days)) : 1;
    return { item, x: round(x0 + ratio * (x1 - x0) + index * sameDayShift) };
  });
}

export function markerSvg(assessment: Assessment, x: number, y: number, size = 4) {
  if (assessment === 'clean') return `<circle class="pg-m-clean" cx="${x}" cy="${y}" r="${size}"/>`;
  if (assessment === 'errors') return `<path class="pg-m-errors" d="M${x} ${round(y - size - 1)}L${round(x + size + 1)} ${y}L${x} ${round(y + size + 1)}L${round(x - size - 1)} ${y}Z"/>`;
  return `<path class="pg-m-slow" d="M${round(x - size)} ${round(y - size)}L${round(x + size)} ${round(y + size)}M${round(x + size)} ${round(y - size)}L${round(x - size)} ${round(y + size)}"/>`;
}
export const markIcon = (assessment: Assessment) => `<svg class="pg-icon" viewBox="-6 -6 12 12" aria-hidden="true" focusable="false">${markerSvg(assessment, 0, 0, 4)}</svg>`;
export const checkIcon = () => '<svg class="pg-icon" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect class="pg-b-check" x="1" y="1" width="8" height="8"/></svg>';
export const outcomeIcon = (group: keyof typeof OUTCOME_LABELS) => `<svg class="pg-icon" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect class="pg-b-${group}" width="10" height="10"/></svg>`;

/** Текстовая замена мини-графика для чтения с экрана. */
export function sparkText(row: ProgressRow) {
  if (row.kind === 'check') return `Самостоятельно по датам: ${row.passes.map(pass => `${formatShortDate(pass.localDate)} — ${pass.tally.self} из ${pass.tally.total}`).join('; ')}`;
  return `Темп по датам: ${row.passes.map(pass => `${formatShortDate(pass.localDate)} — ${pass.bpm}, ${MARK_LABELS[pass.assessment]}`).join('; ')}`;
}

/** Мини-график строки: общая ось X — весь период, Y — собственный диапазон упражнения с подписями min/max. */
export function sparkSvg(row: ProgressRow, period: Period, width = 180, height = 44) {
  const x0 = 30, x1 = width - 6, y0 = 7, y1 = height - 7;
  const parts: string[] = [];
  if (row.kind === 'check') {
    const top = Math.max(...row.passes.map(pass => pass.tally.total), 1);
    parts.push(`<line class="pg-g-axis" x1="${x0}" x2="${x1}" y1="${y1 + 0.5}" y2="${y1 + 0.5}"/>`, `<text class="pg-g-text" x="${x0 - 6}" y="${y0 + 8}" text-anchor="end">${top}</text>`);
    for (const { item, x } of placeByDate(row.passes, period, x0, x1 - 12, 10)) {
      const unit = (y1 - y0) / top;
      let y = y1;
      for (const group of OUTCOME_ORDER) {
        const count = item.tally[group];
        if (!count) continue;
        y -= unit * count;
        parts.push(`<rect class="pg-b-${group}" x="${round(x - 4)}" y="${round(y)}" width="8" height="${round(Math.max(0.5, unit * count - 0.5))}"/>`);
      }
    }
    return `<svg class="pg-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
  }
  const bpms = row.passes.map(pass => pass.bpm);
  const lo = Math.min(...bpms), hi = Math.max(...bpms);
  const y = (bpm: number) => (hi === lo ? (y0 + y1) / 2 : y1 - ((bpm - lo) / (hi - lo)) * (y1 - y0));
  parts.push(`<line class="pg-g-grid" x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}"/>`, `<line class="pg-g-grid" x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}"/>`);
  parts.push(`<text class="pg-g-text" x="${x0 - 5}" y="${round((hi === lo ? (y0 + y1) / 2 : y0) + 4)}" text-anchor="end">${hi}</text>`);
  if (hi !== lo) parts.push(`<text class="pg-g-text" x="${x0 - 5}" y="${y1 + 4}" text-anchor="end">${lo}</text>`);
  const points = placeByDate(row.passes, period, x0 + 4, x1 - 4, 6).map(({ item, x }) => ({ item, x, y: round(y(item.bpm)) }));
  if (points.length > 1) parts.push(`<polyline class="pg-g-path" points="${points.map(point => `${point.x},${point.y}`).join(' ')}"/>`);
  for (const point of points) parts.push(markerSvg(point.item.assessment, point.x, point.y, 3.5));
  return `<svg class="pg-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
}

/** Крупный график темпа: подписанные оси «BPM ♩» и даты, отметка «лучший N». */
export function tempoChartSvg(row: PlayRow, period: Period, today: string, width: number) {
  const w = Math.max(280, Math.round(width));
  const h = 176, x0 = 46, x1 = w - 18, y0 = 26, y1 = h - 28;
  const scale = tempoScale(row.passes.map(pass => pass.bpm));
  const y = (bpm: number) => round(y1 - ((bpm - scale.lo) / (scale.hi - scale.lo)) * (y1 - y0));
  const parts = [`<text class="pg-g-text" x="4" y="14">BPM ♩</text>`];
  for (const value of scale.ticks) parts.push(`<line class="pg-g-grid" x1="${x0}" x2="${x1}" y1="${y(value)}" y2="${y(value)}"/>`, `<text class="pg-g-text" x="${x0 - 8}" y="${y(value) + 4}" text-anchor="end">${value}</text>`);
  parts.push(`<line class="pg-g-axis" x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}"/>`);
  for (const tick of dateTicks(period, today)) {
    const [{ x }] = placeByDate([{ localDate: tick.date }], period, x0, x1, 0);
    parts.push(`<line class="pg-g-axis" x1="${x}" x2="${x}" y1="${y1}" y2="${y1 + 4}"/>`, `<text class="pg-g-text" x="${x}" y="${y1 + 18}" text-anchor="${tick.anchor}">${escapeHtml(tick.label)}</text>`);
  }
  const points = placeByDate(row.passes, period, x0 + 6, x1 - 6, 8).map(({ item, x }) => ({ item, x, y: y(item.bpm) }));
  if (points.length > 1) parts.push(`<polyline class="pg-g-path" points="${points.map(point => `${point.x},${point.y}`).join(' ')}"/>`);
  for (const point of points) parts.push(markerSvg(point.item.assessment, point.x, point.y, 5));
  const best = points.filter(point => point.item.assessment === 'clean' && point.item.bpm === row.bestCleanBpm).at(-1);
  if (best) parts.push(`<text class="pg-g-ink" x="${round(Math.min(Math.max(best.x, x0 + 30), x1 - 30))}" y="${round(Math.max(12, best.y - 10))}" text-anchor="middle">лучший ${row.bestCleanBpm}</text>`);
  return `<svg class="pg-chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(sparkText(row))}">${parts.join('')}</svg>`;
}

/** Полоса исходов одной проверки (ширина пропорциональна числу ответов). */
export function tallyStack(tally: CheckTally) {
  return `<span class="pg-stack" aria-hidden="true">${OUTCOME_ORDER.filter(group => tally[group]).map(group => `<i class="pg-b-${group}" style="flex:${tally[group]}"></i>`).join('')}</span>`;
}

export type { CheckRow, PlayRow };
