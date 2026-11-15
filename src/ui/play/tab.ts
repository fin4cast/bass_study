/**
 * SVG-табулатура экрана игры (VIS-11 r2, D-050) по шагам шкалы прохода: чистая разметка.
 * Ноты стоят по времени (доли такта 4/4), под нотой — черта длительности, паузы видны, такты «эха»
 * подписаны; счёт «1 и 2 и» над каждым тактом совпадает с тем, что звучит. Такт можно выбрать для петли
 * (`data-bar`). Курсор текущего шага — контур и полупрозрачная заливка по классам `play.css`.
 */
import type { StringId } from '../../music';
import { escapeHtml } from '../html';

export interface TabEvent {
  /** Индекс шага шкалы. */
  readonly index: number;
  /** Позиция ноты; `null` — пауза. */
  readonly tab: { readonly row: number; readonly string: StringId; readonly fret: number } | null;
  readonly bar: number;
  /** Доля от начала такта (0…4, дробная). */
  readonly beatInBar: number;
  readonly durationBeats: number;
  /** Такт «эха»: эталон молчит. */
  readonly echo?: boolean;
}

export interface TabRenderOptions {
  readonly events: readonly TabEvent[];
  /** Индекс текущего шага во всём списке; −1 или null — курсора нет. */
  readonly current?: number | null;
  /** Первый показанный такт и число тактов. */
  readonly fromBar?: number;
  readonly bars?: number;
  readonly width?: number;
  readonly lineGap?: number;
  readonly fontSize?: number;
  readonly showCount?: boolean;
  readonly dimPlayed?: boolean;
  /** Такты петли (подсвечиваются). */
  readonly loop?: { readonly fromBar: number; readonly toBar: number } | null;
  /** Такты можно выбрать кликом для петли. */
  readonly selectable?: boolean;
  readonly label?: string;
}

const STRINGS = ['G', 'D', 'A', 'E'] as const;
const NS = 'http://www.w3.org/2000/svg';
const round = (value: number) => Math.round(value * 100) / 100;

/** Подпись счёта: доля «1»…«4», восьмая между долями — «и», шестнадцатые — «е»/«а». */
export function countLabel(beatInBar: number): string {
  const fraction = Math.round((beatInBar % 1) * 4) / 4;
  if (fraction === 0) return String(Math.floor(beatInBar) + 1);
  if (fraction === 0.5) return 'и';
  return fraction === 0.25 ? 'е' : 'а';
}

export const totalBars = (events: readonly TabEvent[]) => events.length ? events[events.length - 1].bar + 1 : 0;

/** Страница из `barsPerPage` тактов, содержащая такт `bar`. */
export function pageOf(events: readonly TabEvent[], bar: number, barsPerPage: number) {
  const total = totalBars(events);
  const firstBar = Math.floor(Math.max(0, bar) / barsPerPage) * barsPerPage;
  const lastBar = Math.max(firstBar, Math.min(total - 1, firstBar + barsPerPage - 1));
  return { firstBar, lastBar, totalBars: total, bars: lastBar - firstBar + 1 };
}

export function tabGeometry(options: Pick<TabRenderOptions, 'width' | 'lineGap' | 'showCount'>) {
  const width = options.width ?? 1000;
  const lineGap = options.lineGap ?? 18;
  const top = options.showCount === false ? 12 : 24;
  return { width, lineGap, top, height: round(top + lineGap * 3 + 18 + Math.max(8, lineGap * 0.4)) };
}

export function renderTab(options: TabRenderOptions): string {
  const fromBar = Math.max(0, options.fromBar ?? 0);
  const bars = Math.max(1, options.bars ?? Math.max(1, totalBars(options.events) - fromBar));
  const shown = options.events.filter(event => event.bar >= fromBar && event.bar < fromBar + bars);
  const current = options.current ?? -1;
  const fontSize = options.fontSize ?? 16;
  const showCount = options.showCount !== false;
  const { width, lineGap, top, height } = tabGeometry(options);
  const left = 30, right = 12;
  const span = width - left - right;
  const beats = bars * 4;
  const xAt = (bar: number, beat: number) => left + ((bar - fromBar) * 4 + beat) / beats * span;
  const slot = span / beats / 2;
  const bottom = top + lineGap * 3;
  const parts: string[] = [];
  for (let bar = fromBar; bar < fromBar + bars; bar++) {
    const x0 = round(xAt(bar, 0)), x1 = round(xAt(bar + 1, 0));
    const inLoop = options.loop && bar >= options.loop.fromBar && bar < options.loop.toBar;
    if (inLoop) parts.push(`<rect class="pl-tab-loop" x="${x0}" y="${round(top - lineGap * 0.7)}" width="${round(x1 - x0)}" height="${round(lineGap * 4.4)}"/>`);
    if (shown.some(event => event.bar === bar && event.echo)) {
      parts.push(`<rect class="pl-tab-echo" x="${x0}" y="${round(top - lineGap * 0.7)}" width="${round(x1 - x0)}" height="${round(lineGap * 4.4)}"/>`);
      parts.push(`<text class="pl-tab-echo-label" x="${round(x1 - 4)}" y="${round(bottom + 15)}" text-anchor="end">эхо — повтори</text>`);
    }
    if (showCount) for (let eighth = 0; eighth < 8; eighth++) {
      parts.push(`<text class="pl-tab-count" x="${round(xAt(bar, eighth / 2) + slot / 2)}" y="12" text-anchor="middle">${countLabel(eighth / 2)}</text>`);
    }
    if (bar > fromBar) parts.push(`<line class="pl-tab-bar" data-bar-line="${bar}" x1="${x0}" x2="${x0}" y1="${top}" y2="${bottom}"/>`);
  }
  STRINGS.forEach((string, row) => {
    const ly = top + row * lineGap;
    parts.push(`<line class="pl-tab-line" x1="${left}" x2="${width - right}" y1="${ly}" y2="${ly}"/>`);
    parts.push(`<text class="pl-tab-string" x="6" y="${ly + 4}">${string}</text>`);
  });
  parts.push(`<line class="pl-tab-edge" x1="${left}" x2="${left}" y1="${top}" y2="${bottom}"/>`);
  for (const event of shown) {
    const x = round(xAt(event.bar, event.beatInBar) + slot / 2);
    const end = round(xAt(event.bar, event.beatInBar + event.durationBeats) - 3);
    const isCurrent = event.index === current;
    const isPlayed = options.dimPlayed === true && current >= 0 && event.index < current;
    if (isCurrent) {
      parts.push(`<rect class="pl-tab-cursor" x="${round(x - slot * 0.84)}" y="${round(top - lineGap * 0.6)}" width="${round(Math.max(slot * 1.68, end - x + slot * 0.84))}" height="${round(lineGap * 4.2)}" rx="6"/>`);
    }
    if (!event.tab) {
      parts.push(`<text class="pl-tab-rest${isPlayed ? ' is-played' : ''}" data-index="${event.index}" x="${x}" y="${round(top + lineGap * 1.5 + fontSize * 0.36)}" text-anchor="middle" font-size="${round(fontSize * 0.9)}"><title>пауза</title>𝄽</text>`);
      continue;
    }
    const ly = top + event.tab.row * lineGap;
    const label = String(event.tab.fret);
    const w = label.length * fontSize * 0.62 + 6;
    if (!isCurrent) parts.push(`<rect class="pl-tab-gap" x="${round(x - w / 2)}" y="${round(ly - fontSize * 0.62)}" width="${round(w)}" height="${round(fontSize * 1.24)}"/>`);
    const classes = ['pl-tab-fret', isCurrent && 'is-current', isPlayed && 'is-played', event.echo && 'is-echo'].filter(Boolean).join(' ');
    parts.push(`<text class="${classes}" data-index="${event.index}" data-string="${event.tab.string}" x="${x}" y="${round(ly + fontSize * 0.36)}" text-anchor="middle" font-size="${fontSize}">${label}</text>`);
    // Черта длительности под станом: длинная нота видна как длинная.
    if (end - x > slot * 0.6) parts.push(`<line class="pl-tab-dur" x1="${round(x - slot * 0.4)}" x2="${end}" y1="${round(bottom + 7)}" y2="${round(bottom + 7)}"/>`);
    else parts.push(`<line class="pl-tab-dur" x1="${round(x - slot * 0.4)}" x2="${round(x + slot * 0.4)}" y1="${round(bottom + 7)}" y2="${round(bottom + 7)}"/>`);
  }
  const endX = round(width - right);
  parts.push(`<line class="pl-tab-edge" x1="${endX}" x2="${endX}" y1="${top}" y2="${bottom}"/>`);
  if (options.selectable) for (let bar = fromBar; bar < fromBar + bars; bar++) {
    const x0 = round(xAt(bar, 0)), x1 = round(xAt(bar + 1, 0));
    parts.push(`<rect class="pl-tab-hit" data-bar="${bar}" x="${x0}" y="0" width="${round(x1 - x0)}" height="${height}"><title>Такт ${bar + 1}: петля на этот такт (Shift — до этого такта)</title></rect>`);
  }
  const label = options.label ?? 'Табулатура';
  return `<svg xmlns="${NS}" class="pl-tab-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(label)}">${parts.join('')}</svg>`;
}

/**
 * Строка ритма такта без ладов (виды «Гриф» и «По памяти»): счёт, длительности нот блоками и паузы.
 */
export function renderRhythm(events: readonly TabEvent[], bar: number, current: number | null, width = 560): string {
  const left = 8, right = 8, top = 14, h = 14;
  const span = width - left - right;
  const x = (beat: number) => left + (beat / 4) * span;
  const height = top + h + 6;
  const parts: string[] = [];
  for (let eighth = 0; eighth < 8; eighth++) parts.push(`<text class="pl-rh-count" x="${round(x(eighth / 2) + span / 16)}" y="10" text-anchor="middle">${countLabel(eighth / 2)}</text>`);
  for (let beat = 0; beat <= 4; beat++) parts.push(`<line class="pl-rh-beat" x1="${round(x(beat))}" x2="${round(x(beat))}" y1="${top - 2}" y2="${top + h + 2}"/>`);
  for (const event of events.filter(item => item.bar === bar)) {
    const x0 = round(x(event.beatInBar) + 2), x1 = round(x(event.beatInBar + event.durationBeats) - 2);
    const cls = ['pl-rh-note', !event.tab && 'is-rest', event.index === current && 'is-current', event.echo && 'is-echo'].filter(Boolean).join(' ');
    parts.push(`<rect class="${cls}" x="${x0}" y="${top}" width="${round(Math.max(4, x1 - x0))}" height="${h}" rx="4"><title>${event.tab ? 'нота' : 'пауза'}</title></rect>`);
  }
  return `<svg xmlns="${NS}" class="pl-rh-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Ритм такта ${bar + 1}">${parts.join('')}</svg>`;
}
