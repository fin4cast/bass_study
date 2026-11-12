/**
 * SVG-табулатура экрана игры (VIS-11 r2) по событиям `createNotationPlan`: чистая разметка.
 * Четыре линии G-D-A-E, номера ладов, тактовые черты, счёт «1 и 2 и», курсор текущей ноты
 * (контур и полупрозрачная заливка по классам `play.css`), затемнение сыгранного.
 */
import type { NotationEvent } from '../../notation';
import { escapeHtml } from '../html';

export type TabEvent = Pick<NotationEvent, 'index' | 'tab' | 'bar' | 'beatInBar' | 'durationBeats'>;

export interface TabRenderOptions {
  readonly events: readonly TabEvent[];
  /** Индекс текущего события во всём списке; −1 или null — курсора нет. */
  readonly current?: number | null;
  /** Первое показанное событие. */
  readonly from?: number;
  /** Число показанных событий (по умолчанию — до конца). */
  readonly count?: number;
  /** Число столбцов; больше `count`, если последний такт неполный. */
  readonly slots?: number;
  readonly width?: number;
  readonly lineGap?: number;
  readonly fontSize?: number;
  readonly showCount?: boolean;
  readonly dimPlayed?: boolean;
  readonly label?: string;
}

const STRINGS = ['G', 'D', 'A', 'E'] as const;
const NS = 'http://www.w3.org/2000/svg';
const round = (value: number) => Math.round(value * 100) / 100;

/** Подпись счёта над нотой: доля «1»…«4», восьмая между долями — «и», шестнадцатые — «е»/«а». */
export function countLabel(beatInBar: number): string {
  const fraction = Math.round((beatInBar % 1) * 4) / 4;
  if (fraction === 0) return String(Math.floor(beatInBar) + 1);
  if (fraction === 0.5) return 'и';
  return fraction === 0.25 ? 'е' : 'а';
}

/** Сколько событий длительности `durationBeats` помещается в такт 4/4. */
export const slotsPerBar = (durationBeats: number) => Math.max(1, Math.round(4 / durationBeats));

/** Диапазон событий такта `bar`: {from, count}; пустой такт — count 0. */
export function barRange(events: readonly TabEvent[], bar: number): { from: number; count: number } {
  const from = events.findIndex(event => event.bar === bar);
  if (from < 0) return { from: 0, count: 0 };
  let count = 0;
  while (from + count < events.length && events[from + count].bar === bar) count++;
  return { from, count };
}

/** Страница из `barsPerPage` тактов, содержащая такт `bar`: события и число столбцов. */
export function pageRange(events: readonly TabEvent[], bar: number, barsPerPage: number) {
  const totalBars = events.length ? events[events.length - 1].bar + 1 : 0;
  const firstBar = Math.floor(Math.max(0, bar) / barsPerPage) * barsPerPage;
  const lastBar = Math.min(totalBars - 1, firstBar + barsPerPage - 1);
  const from = events.findIndex(event => event.bar === firstBar);
  const after = events.findIndex(event => event.bar > lastBar);
  const perBar = slotsPerBar(events[0]?.durationBeats ?? 0.5);
  return {
    firstBar, lastBar, totalBars,
    from: Math.max(0, from), count: (after < 0 ? events.length : after) - Math.max(0, from),
    slots: Math.max(1, lastBar - firstBar + 1) * perBar,
  };
}

export function tabGeometry(options: Pick<TabRenderOptions, 'width' | 'lineGap' | 'showCount'>) {
  const width = options.width ?? 1000;
  const lineGap = options.lineGap ?? 18;
  const top = options.showCount === false ? 12 : 24;
  return { width, lineGap, top, height: round(top + lineGap * 3 + 14 + Math.max(8, lineGap * 0.4)) };
}

export function renderTab(options: TabRenderOptions): string {
  const events = options.events;
  const from = Math.max(0, options.from ?? 0);
  const shown = events.slice(from, options.count === undefined ? undefined : from + options.count);
  const slots = Math.max(1, options.slots ?? shown.length);
  const current = options.current ?? -1;
  const fontSize = options.fontSize ?? 16;
  const showCount = options.showCount !== false;
  const { width, lineGap, top, height } = tabGeometry(options);
  const left = 30, right = 12;
  const slot = (width - left - right) / slots;
  const bottom = top + lineGap * 3;
  const parts: string[] = [];
  STRINGS.forEach((string, row) => {
    const ly = top + row * lineGap;
    parts.push(`<line class="pl-tab-line" x1="${left}" x2="${width - right}" y1="${ly}" y2="${ly}"/>`);
    parts.push(`<text class="pl-tab-string" x="6" y="${ly + 4}">${string}</text>`);
  });
  parts.push(`<line class="pl-tab-edge" x1="${left}" x2="${left}" y1="${top}" y2="${bottom}"/>`);
  let previousBar = shown[0]?.bar ?? 0;
  shown.forEach((event, i) => {
    const cx = round(left + slot * (i + 0.5));
    if (i > 0 && event.bar !== previousBar) {
      const bx = round(left + slot * i);
      parts.push(`<line class="pl-tab-bar" data-bar-line="${event.bar}" x1="${bx}" x2="${bx}" y1="${top}" y2="${bottom}"/>`);
    }
    previousBar = event.bar;
    const isCurrent = event.index === current;
    const isPlayed = options.dimPlayed === true && current >= 0 && event.index < current;
    if (isCurrent) {
      parts.push(`<rect class="pl-tab-cursor" x="${round(cx - slot * 0.42)}" y="${round(top - lineGap * 0.6)}" width="${round(slot * 0.84)}" height="${round(lineGap * 4.2)}" rx="6"/>`);
    }
    const ly = top + event.tab.row * lineGap;
    const label = String(event.tab.fret);
    const w = label.length * fontSize * 0.62 + 6;
    if (!isCurrent) parts.push(`<rect class="pl-tab-gap" x="${round(cx - w / 2)}" y="${round(ly - fontSize * 0.62)}" width="${round(w)}" height="${round(fontSize * 1.24)}"/>`);
    const classes = ['pl-tab-fret', isCurrent && 'is-current', isPlayed && 'is-played'].filter(Boolean).join(' ');
    parts.push(`<text class="${classes}" data-index="${event.index}" data-string="${event.tab.string}" x="${cx}" y="${round(ly + fontSize * 0.36)}" text-anchor="middle" font-size="${fontSize}">${label}</text>`);
    if (showCount) parts.push(`<text class="pl-tab-count" x="${cx}" y="12" text-anchor="middle">${countLabel(event.beatInBar)}</text>`);
  });
  const endX = round(left + slot * Math.max(shown.length, slots));
  parts.push(`<line class="pl-tab-edge" x1="${Math.min(endX, width - right)}" x2="${Math.min(endX, width - right)}" y1="${top}" y2="${bottom}"/>`);
  const label = options.label ?? 'Табулатура';
  return `<svg xmlns="${NS}" class="pl-tab-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(label)}">${parts.join('')}</svg>`;
}
