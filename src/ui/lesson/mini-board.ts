/**
 * Мини-гриф экранов «Занятие» и «Проверь себя»: чистая SVG-разметка по каркасу макета VIS-10 r2.
 * Цвета задаются классами (`lesson.css`) на токенах `--board-*`, поэтому гриф одинаков в обеих темах.
 * Модуль не обращается к DOM; его можно объединить с доской экрана игры позже.
 */
import { escapeHtml } from '../html';

export type BoardNoteKind = 'root' | 'a' | 'b' | 'shared' | 'plain' | 'ghost' | 'target';
export interface BoardNote {
  /** Позиция `струна:лад`. */
  readonly id: string;
  readonly label?: string;
  readonly kind: BoardNoteKind;
  readonly finger?: number | null;
  /** Тоника поверх другой роли: золотое кольцо. */
  readonly root?: boolean;
}
export interface BoardOptions {
  readonly fretMin: number;
  readonly fretMax: number;
  readonly notes?: readonly BoardNote[];
  /** Отмеченная позиция (вопрос или текущая нота). */
  readonly current?: string | null;
  readonly width?: number;
  readonly marker?: number;
  readonly labels?: boolean;
  readonly ariaLabel?: string;
  /** Декоративный гриф: скрыт от чтения с экрана, смысл передаётся текстом рядом. */
  readonly decorative?: boolean;
}

export const BOARD_STRINGS = ['G', 'D', 'A', 'E'] as const;
const STRING_WIDTH: Readonly<Record<string, number>> = { G: 1.4, D: 1.9, A: 2.4, E: 3 };

/** Геометрия грифа: общая для SVG и слоя кнопок ответа «На грифе». */
export function boardGeometry(options: Pick<BoardOptions, 'fretMin' | 'fretMax' | 'width' | 'marker' | 'labels'>) {
  const { fretMin, fretMax } = options;
  if (!Number.isInteger(fretMin) || !Number.isInteger(fretMax) || fretMin < 0 || fretMax > 24 || fretMin > fretMax) throw new RangeError('Окно грифа: лады от 0 до 24.');
  const width = options.width ?? 1000;
  const marker = options.marker ?? 46;
  const labels = options.labels ?? true;
  const left = 34, right = 14, top = labels ? 26 : 10, rowGap = marker * 1.32;
  const height = top + marker * .45 + rowGap * 3 + marker * .5 + 12;
  const cell = (width - left - right) / (fretMax - fretMin + 1);
  return {
    width, height, marker, left, right, top, rowGap, cell, fretMin, fretMax, labels,
    x: (fret: number) => left + (fret - fretMin + .5) * cell,
    y: (string: string) => top + marker * .45 + BOARD_STRINGS.indexOf(string as typeof BOARD_STRINGS[number]) * rowGap,
  };
}

const n = (value: number) => Math.round(value * 100) / 100;

export function boardSvg(options: BoardOptions): string {
  const geo = boardGeometry(options);
  const { fretMin, fretMax, width, height, marker, left, right, x, y } = geo;
  const r = marker / 2;
  const parts: string[] = [];
  if (geo.labels) for (let fret = fretMin; fret <= fretMax; fret++) parts.push(`<text class="mb-fret" x="${n(x(fret))}" y="15" text-anchor="middle">${fret}</text>`);
  for (let fret = fretMin; fret <= fretMax + 1; fret++) {
    const lx = left + (fret - fretMin) * geo.cell;
    const nut = fret === 1 && fretMin === 0;
    parts.push(`<line class="${nut ? 'mb-nut' : 'mb-wire'}" x1="${n(lx)}" x2="${n(lx)}" y1="${n(y('G') - r * .7)}" y2="${n(y('E') + r * .7)}"/>`);
  }
  for (const fret of [3, 5, 7, 9, 15, 17, 19, 21]) if (fret >= fretMin && fret <= fretMax) parts.push(`<circle class="mb-inlay" cx="${n(x(fret))}" cy="${n((y('D') + y('A')) / 2)}" r="4"/>`);
  for (const fret of [12, 24]) if (fret >= fretMin && fret <= fretMax) parts.push(`<circle class="mb-inlay" cx="${n(x(fret))}" cy="${n((y('G') + y('D')) / 2)}" r="4"/>`, `<circle class="mb-inlay" cx="${n(x(fret))}" cy="${n((y('A') + y('E')) / 2)}" r="4"/>`);
  for (const string of BOARD_STRINGS) {
    if (geo.labels) parts.push(`<text class="mb-string-name" x="12" y="${n(y(string) + 5)}">${string}</text>`);
    parts.push(`<line class="mb-string" x1="${left}" x2="${n(width - right)}" y1="${n(y(string))}" y2="${n(y(string))}" stroke-width="${STRING_WIDTH[string]}"/>`);
  }
  for (const note of options.notes ?? []) {
    const match = /^([EADG]):(\d{1,2})$/.exec(note.id);
    if (!match) continue;
    const fret = Number(match[2]);
    if (fret < fretMin || fret > fretMax) continue;
    const cx = n(x(fret)), cy = n(y(match[1]));
    const current = note.id === options.current;
    if (current) parts.push(`<circle class="mb-current-ring" cx="${cx}" cy="${cy}" r="${n(r + 6)}"/>`);
    parts.push(`<circle class="mb-note mb-${note.kind}${current ? ' is-current' : ''}" cx="${cx}" cy="${cy}" r="${n(r)}"/>`);
    if (note.root && note.kind !== 'root') parts.push(`<circle class="mb-root-ring" cx="${cx}" cy="${cy}" r="${n(r - 2.5)}"/>`);
    if (note.label) parts.push(`<text class="mb-label mb-label-${note.kind}${current ? ' is-current' : ''}" x="${cx}" y="${n(cy + marker * .14)}" text-anchor="middle" font-size="${Math.round(marker * .39)}">${escapeHtml(note.label)}</text>`);
    if (note.finger) parts.push(`<text class="mb-finger" x="${n(cx + r * .78)}" y="${n(cy - r * .62)}" text-anchor="middle" font-size="${Math.max(10, Math.round(marker * .25))}">${escapeHtml(note.finger)}</text>`);
  }
  // Текущая метка рисуется и без собственной ноты в списке (вопрос «Назови ступень» на пустом месте).
  if (options.current && !(options.notes ?? []).some(note => note.id === options.current)) {
    const match = /^([EADG]):(\d{1,2})$/.exec(options.current);
    if (match && Number(match[2]) >= fretMin && Number(match[2]) <= fretMax) {
      const cx = n(x(Number(match[2]))), cy = n(y(match[1]));
      parts.push(`<circle class="mb-current-ring" cx="${cx}" cy="${cy}" r="${n(r + 6)}"/><circle class="mb-note mb-plain is-current" cx="${cx}" cy="${cy}" r="${n(r)}"/>`);
    }
  }
  const label = options.ariaLabel ?? `Гриф, лады ${fretMin}–${fretMax}`;
  const semantics = options.decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${escapeHtml(label)}"`;
  return `<svg class="mini-board" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" ${semantics}>${parts.join('')}</svg>`;
}

/** Окно ладов вокруг позиций: на лад шире с краёв, не меньше `minSpan` ладов. */
export function boardWindow(frets: readonly number[], minSpan = 6, pad = 1) {
  if (!frets.length) return { fretMin: 0, fretMax: minSpan - 1 };
  let fretMin = Math.max(0, Math.min(...frets) - pad);
  let fretMax = Math.min(24, Math.max(...frets) + pad);
  while (fretMax - fretMin + 1 < minSpan) {
    if (fretMax < 24) fretMax++;
    if (fretMax - fretMin + 1 < minSpan && fretMin > 0) fretMin--;
  }
  return { fretMin, fretMax };
}
