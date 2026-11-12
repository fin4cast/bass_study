/**
 * SVG-гриф экрана игры (VIS-11 r2): чистая разметка без DOM, звука и базы.
 * Строки сверху вниз G-D-A-E, окно ладов, маркеры ладов, текущая и следующая нота.
 * Цвета задаёт `play.css` по классам: сегмент 0 — `is-a`, сегмент 1 — `is-b`, позиция нескольких
 * сегментов — `is-shared`, тоника вне общей позиции — `is-root`, тоника на общей позиции — кольцо `pl-root-ring`.
 */
import type { StringId } from '../../music';
import type { ExerciseNote, ExercisePlan } from '../../exercises';
import { escapeHtml } from '../html';

export type BoardLabelMode = 'name' | 'degree' | 'finger' | 'none';
export type BoardNoteKind = 'root' | 'a' | 'b' | 'shared';

export interface BoardNote {
  /** Позиция `струна:лад`, как у `ExerciseNote.id`. */
  readonly id: string;
  readonly string: StringId;
  readonly fret: number;
  readonly label: string;
  readonly kind: BoardNoteKind;
  /** Тоника по подписи сегмента, которому принадлежит представитель позиции. */
  readonly root: boolean;
  readonly finger: number | null;
  readonly stretch: boolean;
  /** Сегменты плана, где встречается позиция (по возрастанию). */
  readonly segments: readonly number[];
}

export interface FretWindow { readonly fretMin: number; readonly fretMax: number }

export interface BoardRenderOptions {
  readonly notes: readonly BoardNote[];
  readonly fretMin: number;
  readonly fretMax: number;
  readonly current?: string | null;
  readonly next?: string | null;
  /** Ширина viewBox; SVG масштабируется стилями. */
  readonly width?: number;
  /** Диаметр маркера ноты в единицах viewBox. */
  readonly marker?: number;
  /** Номера ладов над грифом. */
  readonly fretLabels?: boolean;
}

export const BOARD_STRINGS: readonly StringId[] = ['G', 'D', 'A', 'E'];
const STRING_WIDTH: Readonly<Record<StringId, number>> = { G: 1.4, D: 1.9, A: 2.4, E: 3 };
const SINGLE_DOTS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_DOTS = [12, 24];
const NS = 'http://www.w3.org/2000/svg';

/** «A♭2» → «A♭»: на маркере грифа октава не пишется. */
export const pitchLetter = (name: string) => name.replace(/-?\d+$/, '');
/** «b3» → «♭3», «#4» → «♯4». */
export const formatDegree = (degree: string | null) => degree ? degree.replace(/b/g, '♭').replace(/#/g, '♯') : '';
/** Технический ID `E:5` → запись интерфейса `E/5`. */
export const formatPosition = (id: string) => id.replace(':', '/');

/**
 * Ноты доски из плана: каждая позиция один раз. Подпись, тоника и палец берутся из ноты сегмента,
 * который сейчас играют (`segment`); если позиции в нём нет — из первого появления в плане.
 */
export function boardNotesFromPlan(plan: Pick<ExercisePlan, 'notes'>, options: { labels?: BoardLabelMode; segment?: number } = {}): BoardNote[] {
  const labels = options.labels ?? 'name';
  const segment = options.segment ?? 0;
  const order: string[] = [];
  const byId = new Map<string, { first: ExerciseNote; own: ExerciseNote | null; segments: Set<number> }>();
  for (const note of plan.notes) {
    let entry = byId.get(note.id);
    if (!entry) { entry = { first: note, own: null, segments: new Set() }; byId.set(note.id, entry); order.push(note.id); }
    entry.segments.add(note.segment);
    if (note.segment === segment && !entry.own) entry.own = note;
  }
  return order.map(id => {
    const { first, own, segments } = byId.get(id)!;
    const note = own ?? first;
    const root = note.degree === '1';
    const sorted = [...segments].sort((a, b) => a - b);
    const kind: BoardNoteKind = sorted.length > 1 ? 'shared' : root ? 'root' : sorted[0] % 2 === 0 ? 'a' : 'b';
    const label = labels === 'degree' ? formatDegree(note.degree)
      : labels === 'finger' ? (note.finger === null ? '' : String(note.finger))
        : labels === 'none' ? '' : pitchLetter(note.name);
    return { id, string: note.string, fret: note.fret, label, kind, root, finger: note.finger, stretch: note.stretch, segments: sorted };
  });
}

/**
 * Окно ладов по нотам: min…max с запасом `pad`, не уже `minSpan` ладов, в пределах 0–24.
 * Недостающая ширина добавляется по очереди справа и слева.
 */
export function fretWindow(frets: readonly number[], options: { pad?: number; minSpan?: number } = {}): FretWindow {
  const pad = options.pad ?? 1;
  const minSpan = Math.min(25, Math.max(1, options.minSpan ?? 6));
  if (!frets.length) return { fretMin: 0, fretMax: minSpan - 1 };
  let fretMin = Math.max(0, Math.min(...frets) - pad);
  let fretMax = Math.min(24, Math.max(...frets) + pad);
  let right = true;
  while (fretMax - fretMin + 1 < minSpan) {
    if (right ? fretMax < 24 : fretMin === 0) fretMax++;
    else fretMin--;
    right = !right;
  }
  return { fretMin, fretMax };
}

/** Окно ладов плана упражнения. */
export const planFretWindow = (plan: Pick<ExercisePlan, 'notes'>, options?: { pad?: number; minSpan?: number }) =>
  fretWindow(plan.notes.map(note => note.fret), options);

const round = (value: number) => Math.round(value * 100) / 100;

/** Геометрия грифа; высота нужна разметке, чтобы задать пропорцию области. */
export function boardGeometry(options: Pick<BoardRenderOptions, 'width' | 'marker' | 'fretLabels'>) {
  const width = options.width ?? 1000;
  const marker = options.marker ?? 40;
  const top = options.fretLabels === false ? 10 : 26;
  const rowGap = marker * 1.32;
  const height = round(top + marker * 0.45 + rowGap * 3 + marker * 0.5 + 12);
  return { width, marker, top, rowGap, height };
}

export function renderBoard(options: BoardRenderOptions): string {
  const { fretMin, fretMax } = options;
  const { width, marker, top, rowGap, height } = boardGeometry(options);
  const labels = options.fretLabels !== false;
  const left = 34, right = 14;
  const cell = (width - left - right) / (fretMax - fretMin + 1);
  const x = (fret: number) => round(left + (fret - fretMin + 0.5) * cell);
  const y = (string: StringId) => round(top + marker * 0.45 + BOARD_STRINGS.indexOf(string) * rowGap);
  const r = marker / 2;
  const parts: string[] = [`<rect class="pl-neck" x="0" y="0" width="${width}" height="${height}" rx="12"/>`];
  if (labels) for (let fret = fretMin; fret <= fretMax; fret++) parts.push(`<text class="pl-fret-number" x="${x(fret)}" y="17" text-anchor="middle">${fret}</text>`);
  const lineTop = round(y('G') - r * 0.7), lineBottom = round(y('E') + r * 0.7);
  for (let fret = fretMin; fret <= fretMax + 1; fret++) {
    const lx = round(left + (fret - fretMin) * cell);
    const nut = fret === 1 && fretMin === 0;
    parts.push(`<line class="${nut ? 'pl-nut' : 'pl-fret-line'}" x1="${lx}" x2="${lx}" y1="${lineTop}" y2="${lineBottom}"/>`);
  }
  for (const fret of SINGLE_DOTS) if (fret >= fretMin && fret <= fretMax) parts.push(`<circle class="pl-inlay" cx="${x(fret)}" cy="${round((y('D') + y('A')) / 2)}" r="4"/>`);
  for (const fret of DOUBLE_DOTS) if (fret >= fretMin && fret <= fretMax) {
    parts.push(`<circle class="pl-inlay" cx="${x(fret)}" cy="${round((y('G') + y('D')) / 2)}" r="4"/>`, `<circle class="pl-inlay" cx="${x(fret)}" cy="${round((y('A') + y('E')) / 2)}" r="4"/>`);
  }
  for (const string of BOARD_STRINGS) {
    parts.push(`<text class="pl-string-name" x="12" y="${round(y(string) + 5)}">${string}</text>`);
    parts.push(`<line class="pl-string" x1="${left}" x2="${width - right}" y1="${y(string)}" y2="${y(string)}" stroke-width="${STRING_WIDTH[string]}"/>`);
  }
  for (const note of options.notes) {
    if (note.fret < fretMin || note.fret > fretMax) continue;
    const cx = x(note.fret), cy = y(note.string);
    const isCurrent = note.id === options.current;
    const isNext = !isCurrent && note.id === options.next;
    const classes = ['pl-note', `is-${note.kind}`, isCurrent && 'is-current', isNext && 'is-next', note.stretch && 'is-stretch'].filter(Boolean).join(' ');
    const group: string[] = [];
    if (isNext) group.push(`<circle class="pl-next-ring" cx="${cx}" cy="${cy}" r="${round(r + 5)}"/>`);
    if (isCurrent) group.push(`<circle class="pl-current-ring" cx="${cx}" cy="${cy}" r="${round(r + 7)}"/>`);
    group.push(`<circle class="pl-dot" cx="${cx}" cy="${cy}" r="${round(r)}"/>`);
    if (note.root && note.kind !== 'root') group.push(`<circle class="pl-root-ring" cx="${cx}" cy="${cy}" r="${round(r - 2.5)}"/>`);
    if (note.label) group.push(`<text class="pl-note-label" x="${cx}" y="${round(cy + marker * 0.14)}" text-anchor="middle" font-size="${Math.round(marker * 0.39)}">${escapeHtml(note.label)}</text>`);
    if (note.stretch) group.push(`<text class="pl-stretch-mark" x="${round(cx + r * 0.95)}" y="${round(cy + r + 2)}" text-anchor="middle" font-size="${Math.max(10, Math.round(marker * 0.3))}">↔</text>`);
    const title = `${formatPosition(note.id)}${note.stretch ? ', растяжка' : ''}${isCurrent ? ', сейчас' : isNext ? ', следующая' : ''}`;
    parts.push(`<g class="${classes}" data-position="${escapeHtml(note.id)}"><title>${escapeHtml(title)}</title>${group.join('')}</g>`);
  }
  const now = options.current ? `; сейчас ${formatPosition(options.current)}` : '';
  const next = options.next && options.next !== options.current ? `; дальше ${formatPosition(options.next)}` : '';
  const label = `Гриф, лады ${fretMin}–${fretMax}${now}${next}`;
  return `<svg xmlns="${NS}" class="pl-board-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(label)}">${parts.join('')}</svg>`;
}
