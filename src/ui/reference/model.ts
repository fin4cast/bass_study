/**
 * «Справочник» (VIS-12 r1, A+B): чистые построители разметки карточки понятия без DOM.
 * Ступени (♭3), римские цифры аккордов (vi) и номера пальцев получают разные классы и вид (R-027).
 * Любой текст из данных проходит через `escapeHtml` до вставки в разметку.
 */
import { escapeHtml } from '../html';
import { getExerciseTemplate, type ExerciseTemplateId } from '../../exercises';
import { CATEGORY_TITLES } from '../../practice/library';
import {
  REFERENCE_CONCEPTS, REFERENCE_LEVELS, parseConceptText,
  type ConceptBoard, type ConceptPosition, type ConceptRole, type ReferenceConcept, type ReferenceLens, type ReferenceLevel, type ReferenceSection,
} from '../../practice/concepts';

export const SEARCH_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg>';
export const LENS_LABELS: Readonly<Record<ReferenceLens, string>> = Object.freeze({ notes: 'Ноты', intervals: 'Интервалы', degrees: 'Ступени', 'chord-tones': 'Тоны аккорда' });
export const PART_TITLES = Object.freeze({ degree: 'ступень', roman: 'римская цифра — аккорд на ступени', finger: 'палец' });
export const SECTION_NOTES: Readonly<Record<ReferenceSection, string>> = Object.freeze({ rhythm: 'вне каталога · раздел «Ритм»', songs: 'вне каталога · раздел «Песни»' });

/** Разметка текста карточки: позиции, ступени, римские цифры, пальцы и выделение. */
export function conceptTextHtml(text: string): string {
  return parseConceptText(text).map(part => {
    switch (part.kind) {
      case 'text': return escapeHtml(part.text);
      case 'strong': return `<b>${escapeHtml(part.text)}</b>`;
      case 'degree': return `<span class="rf-deg" title="${PART_TITLES.degree}">${escapeHtml(part.text)}</span>`;
      case 'roman': return `<span class="rf-roman" title="${PART_TITLES.roman}">${escapeHtml(part.text)}</span>`;
      case 'finger': return `<span class="rf-finger" title="${PART_TITLES.finger}">${escapeHtml(part.text)}</span>`;
      case 'position': {
        const position = `<span class="rf-pos" title="${escapeHtml(`струна ${part.string}, лад ${part.fret}`)}">${escapeHtml(`${part.string}/${part.fret}`)}</span>`;
        return part.label ? `${position} <span class="rf-pitch">${escapeHtml(part.label)}</span>` : position;
      }
    }
  }).join('');
}

/** Текст без разметки — для ARIA и поиска по подписи. */
export function conceptPlainText(text: string): string {
  return parseConceptText(text).map(part => (part.kind === 'position' ? `${part.string}/${part.fret}${part.label ? ` ${part.label}` : ''}` : part.text)).join('');
}

/* ---------- Мини-гриф ---------- */

export const BOARD_STRINGS = ['G', 'D', 'A', 'E'] as const;
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_INLAYS = [12, 24];

/** Подпись кружка в выбранной линзе. В «Нотах» номер октавы — только если карточка его показывает. */
export function positionLabel(position: ConceptPosition, lens: ReferenceLens, showOctave: boolean): string {
  const note = showOctave ? position.label : position.label.replace(/-?\d+$/, '');
  if (lens === 'intervals') return position.interval ?? note;
  if (lens === 'degrees' || lens === 'chord-tones') return position.degree ?? note;
  return note;
}

export const ROLE_CLASS: Readonly<Record<ConceptRole, string>> = Object.freeze({ root: 'is-root', target: 'is-target', plain: 'is-plain', shared: 'is-shared' });

export function availableLens(board: ConceptBoard, lens: ReferenceLens | undefined): ReferenceLens {
  return lens && board.lenses.includes(lens) ? lens : board.defaultLens;
}

/** SVG мини-грифа: струны G–D–A–E сверху вниз, лады fretMin…fretMax, кружки по ролям, пальцы маленькой цифрой. */
export function boardSvg(board: ConceptBoard, lens: ReferenceLens, title: string): string {
  const span = board.fretMax - board.fretMin + 1;
  if (!Number.isInteger(span) || span < 1 || span > 25) throw new RangeError('Мини-гриф: некорректный диапазон ладов.');
  const marker = span > 9 ? 50 : 38;
  const width = 44 + span * 64;
  const left = 34, right = 14, top = 26, rowGap = marker * 1.32;
  const height = Math.round(top + marker * 0.45 + rowGap * 3 + marker * 0.5 + 12);
  const cell = (width - left - right) / span;
  const r = marker / 2;
  const fx = (fret: number) => +(left + (fret - board.fretMin + 0.5) * cell).toFixed(1);
  const sy = (string: string) => +(top + marker * 0.45 + BOARD_STRINGS.indexOf(string as typeof BOARD_STRINGS[number]) * rowGap).toFixed(1);
  const parts: string[] = [];
  for (let fret = board.fretMin; fret <= board.fretMax; fret++) parts.push(`<text class="rf-b-fret" x="${fx(fret)}" y="15" text-anchor="middle">${fret}</text>`);
  for (let fret = board.fretMin; fret <= board.fretMax + 1; fret++) {
    const x = +(left + (fret - board.fretMin) * cell).toFixed(1);
    const nut = fret === 1 && board.fretMin === 0;
    parts.push(`<line class="${nut ? 'rf-b-nut' : 'rf-b-fretline'}" x1="${x}" x2="${x}" y1="${+(sy('G') - r * 0.7).toFixed(1)}" y2="${+(sy('E') + r * 0.7).toFixed(1)}"/>`);
  }
  for (const fret of INLAYS) if (fret >= board.fretMin && fret <= board.fretMax) parts.push(`<circle class="rf-b-inlay" cx="${fx(fret)}" cy="${(sy('D') + sy('A')) / 2}" r="4"/>`);
  for (const fret of DOUBLE_INLAYS) if (fret >= board.fretMin && fret <= board.fretMax) parts.push(`<circle class="rf-b-inlay" cx="${fx(fret)}" cy="${(sy('G') + sy('D')) / 2}" r="4"/><circle class="rf-b-inlay" cx="${fx(fret)}" cy="${(sy('A') + sy('E')) / 2}" r="4"/>`);
  for (const string of BOARD_STRINGS) {
    parts.push(`<text class="rf-b-string-name" x="12" y="${sy(string) + 5}">${string}</text>`);
    parts.push(`<line class="rf-b-string rf-b-string-${string}" x1="${left}" x2="${width - right}" y1="${sy(string)}" y2="${sy(string)}"/>`);
  }
  const names: string[] = [];
  for (const position of board.positions) {
    const [string, fretText] = position.id.split(':');
    const fret = Number(fretText);
    if (!BOARD_STRINGS.includes(string as typeof BOARD_STRINGS[number]) || fret < board.fretMin || fret > board.fretMax) continue;
    const cx = fx(fret), cy = sy(string);
    const role = position.role ?? 'plain';
    const label = positionLabel(position, lens, board.showOctave);
    names.push(`${string}/${fret} ${label}`);
    parts.push(`<g class="rf-b-note ${ROLE_CLASS[role]}">`);
    parts.push(`<circle class="rf-b-dot" cx="${cx}" cy="${cy}" r="${r}"/>`);
    if (role === 'shared' && position.degree === '1') parts.push(`<circle class="rf-b-ring" cx="${cx}" cy="${cy}" r="${r - 2.5}"/>`);
    parts.push(`<text class="rf-b-label" x="${cx}" y="${+(cy + marker * 0.14).toFixed(1)}" text-anchor="middle" font-size="${Math.round(marker * (label.length > 2 ? 0.32 : 0.39))}">${escapeHtml(label)}</text>`);
    if (board.showFingers && position.finger) parts.push(`<text class="rf-b-finger" x="${+(cx + r * 0.8).toFixed(1)}" y="${+(cy - r * 0.62).toFixed(1)}" text-anchor="middle" font-size="${Math.max(11, Math.round(marker * 0.27))}">${position.finger}</text>`);
    parts.push('</g>');
  }
  const aria = `${title}: мини-гриф, лады ${board.fretMin}–${board.fretMax}; ${LENS_LABELS[lens].toLowerCase()}: ${names.join(', ')}`;
  return `<svg class="rf-board-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(aria)}">${parts.join('')}</svg>`;
}

/* ---------- Список понятий по уровням ---------- */

export interface LevelGroup {
  readonly level: ReferenceLevel;
  readonly mark: string;
  readonly title: string;
  readonly total: number;
  readonly mastered: number;
  readonly items: readonly { readonly concept: ReferenceConcept; readonly alias: boolean }[];
}
export function levelGroups(concepts: readonly ReferenceConcept[], mastered: ReadonlySet<string>): readonly LevelGroup[] {
  const shown = new Set(concepts.map(concept => concept.id));
  return Object.freeze(REFERENCE_LEVELS.map(level => {
    const own = REFERENCE_CONCEPTS.filter(concept => concept.level === level.id);
    const items = [
      ...own.filter(concept => shown.has(concept.id)).map(concept => ({ concept, alias: false })),
      ...REFERENCE_CONCEPTS.filter(concept => concept.alsoLevels?.includes(level.id) && shown.has(concept.id)).map(concept => ({ concept, alias: true })),
    ];
    return Object.freeze({ level: level.id, mark: level.mark, title: level.title, total: own.length, mastered: own.filter(concept => mastered.has(concept.id)).length, items: Object.freeze(items) });
  }).filter(group => group.items.length));
}
export const levelInfo = (level: ReferenceLevel) => REFERENCE_LEVELS.find(item => item.id === level)!;
/** «Уровень 2 · Ступени и гаммы» или «Ритм · параллельно». */
export function levelLabel(level: ReferenceLevel) {
  const info = levelInfo(level);
  return typeof level === 'number' ? `Уровень ${info.mark} · ${info.title}` : info.title;
}

/** Связанные упражнения каталога R-026 с разделом библиотеки. */
export function relatedExercises(ids: readonly ExerciseTemplateId[]) {
  return Object.freeze(ids.map(id => {
    const template = getExerciseTemplate(id);
    return Object.freeze({ id, title: template.title, category: CATEGORY_TITLES[template.category] });
  }));
}

export type { ConceptBoard, ReferenceConcept, ReferenceLens, ReferenceLevel };
