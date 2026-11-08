import { formatMidi, type AnnotatedPosition, type LabelMode, type MusicalStructure, type StringId } from '../music';
import type { BoxInstance } from '../music/boxes';
import { getOctaveSections, type OctaveSection } from '../music/octaves';

export interface StudyFretboardOptions {
  readonly width: number;
  readonly positions: readonly AnnotatedPosition[];
  readonly structure: MusicalStructure;
  readonly fretMin: number;
  readonly fretMax: number;
  readonly selectedId: string | null;
  readonly activeId: string | null;
  readonly box: BoxInstance | null;
  readonly showFingers: boolean;
  readonly showOctaves: boolean;
  readonly showInterval: boolean;
  readonly sharedIds: ReadonlySet<string>;
  readonly labelMode: LabelMode;
}

const STRINGS: readonly StringId[] = ['G', 'D', 'A', 'E'];
const HEIGHT = 346;
const LEFT = 42;
const RIGHT = 30;
const y = (string: StringId) => 70 + STRINGS.indexOf(string) * 74;
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const noteName = (position: AnnotatedPosition) => formatMidi(position.midi, position.noteName);

function sections(options: StudyFretboardOptions): readonly OctaveSection[] {
  return options.showOctaves ? getOctaveSections(options.box?.positions ?? options.positions, options.positions, options.structure) : [];
}

function materialIds(options: StudyFretboardOptions): ReadonlySet<string> {
  return new Set(options.box?.referencePositionIds ?? options.positions.filter(position => position.inStructure).map(position => position.id));
}

function positionLabel(position: AnnotatedPosition): string {
  return `${noteName(position)}, струна ${position.string}, ${position.fret === 0 ? 'открытая струна, лад 0' : `лад ${position.fret}`}${position.isRoot ? ', тоника' : position.inStructure ? `, ступень ${position.degree}` : ', вне выбранной структуры'}`;
}

function renderUnderlays(groups: readonly OctaveSection[], from: number, to: number, x: (fret: number) => number, index: number): string {
  if (!groups.length) return '';
  const local = (group: OctaveSection) => group.positions.filter(position => position.fret >= from && position.fret <= to);
  const membership = new Map<string, OctaveSection[]>();
  for (const group of groups) for (const position of local(group)) membership.set(position.id, [...(membership.get(position.id) ?? []), group]);
  const shared = [...membership].filter(([, items]) => items.length > 1).map(([id, items]) => ({ position: items[0].positions.find(position => position.id === id)!, items }));
  const mask = `study-octave-mask-${index}`;
  let markup = `<defs><mask id="${mask}"><rect width="100%" height="100%" fill="white"/>${shared.map(({ position }) => `<circle cx="${x(position.fret)}" cy="${y(position.string)}" r="31" fill="black"/>`).join('')}</mask></defs><g mask="url(#${mask})">`;
  for (const group of groups) for (const string of STRINGS) {
    const row = local(group).filter(position => position.string === string);
    if (!row.length) continue;
    const xs = row.map(position => x(position.fret));
    const min = Math.min(...xs) - 30;
    const max = Math.max(...xs) + 30;
    markup += `<rect class="octave-underlay octave-tone-${group.colorIndex}" data-octave-underlay="${group.fromMidi}" x="${min}" y="${y(string) - 30}" width="${max - min}" height="60" rx="28"/>`;
  }
  markup += '</g>';
  for (const { position, items } of shared) {
    const cx = x(position.fret), cy = y(position.string), radius = 31;
    markup += `<path class="octave-boundary octave-tone-${items[0].colorIndex}" d="M ${cx} ${cy - radius} A ${radius} ${radius} 0 0 0 ${cx} ${cy + radius} Z"/><path class="octave-boundary octave-tone-${items[1].colorIndex}" d="M ${cx} ${cy - radius} A ${radius} ${radius} 0 0 1 ${cx} ${cy + radius} Z"/>`;
  }
  return `<g class="octave-underlays" aria-hidden="true" pointer-events="none">${markup}</g>`;
}

/** The legend describes sounding registers, rather than counting fingering shapes. */
export function renderOctaveLegend(options: StudyFretboardOptions): string {
  const groups = sections(options);
  if (!groups.length) return '';
  const shared = groups.slice(1).filter((group, index) => group.positions.some(position => position.midi === group.fromMidi) && groups[index].positions.some(position => position.midi === group.fromMidi));
  return `<div class="study-octave-legend" aria-label="Октавные участки">${groups.map(group => {
    const from = formatMidi(group.fromMidi, options.structure.root);
    const to = formatMidi(group.toMidi, options.structure.root);
    const last = group.positions.reduce((a, b) => a.midi > b.midi ? a : b);
    const label = group.startsAtTonic ? `От ${from}` : `До ${to}`;
    const status = group.completeVisible ? `Полный участок · до ${to}` : group.completeMaterial && group.partiallyShown ? 'Показан частично' : group.partiallyShown ? 'Фрагмент · показан частично' : `Фрагмент · до ${noteName(last)}`;
    return `<div class="study-octave-item octave-tone-${group.colorIndex}" data-octave-group="${group.fromMidi}" data-complete="${group.completeVisible}"><i class="study-octave-swatch" aria-hidden="true"></i><span><strong>${escape(label)}</strong><small>${escape(status)}</small></span></div>`;
  }).join('')}${shared.length ? `<p class="study-octave-description">${shared.map(group => escape(formatMidi(group.fromMidi, options.structure.root))).join(', ')} — общая тоника соседних участков.</p>` : ''}${!options.box ? '<p class="study-octave-description">Участки объединяют ноты по высоте звучания; аппликатура не задана.</p>' : ''}</div>`;
}

/** Pure markup; the application owns selection, keyboard handling and resizing. */
export function renderStudyFretboard(options: StudyFretboardOptions): string {
  const { fretMin, fretMax, positions, box } = options;
  if (!Number.isInteger(fretMin) || !Number.isInteger(fretMax) || fretMin < 0 || fretMax > 24 || fretMin > fretMax) return '';
  const width = Number.isFinite(options.width) && options.width > 0 ? Math.max(144, Math.floor(options.width)) : 640;
  const usable = width - LEFT - RIGHT;
  const ids = materialIds(options);
  const selected = positions.find(position => position.id === options.selectedId);
  const anchor = box?.positions.find(position => position.isRoot) ?? [...positions].filter(position => position.isRoot).sort((a, b) => a.midi - b.midi)[0];
  const activeNotes = positions.filter(position => ids.has(position.id) || position.id === options.selectedId);
  let minimumGap = Infinity;
  for (const string of STRINGS) {
    const row = activeNotes.filter(position => position.string === string).sort((a, b) => a.fret - b.fret);
    for (let index = 1; index < row.length; index++) minimumGap = Math.min(minimumGap, row[index].fret - row[index - 1].fret);
  }
  const capacity = Math.max(1, Math.floor(usable / (minimumGap === 1 ? 58 : 34)));
  const parts: { from: number; to: number }[] = [];
  for (let from = fretMin; from <= fretMax;) {
    const rows = Math.ceil((fretMax - from + 1) / capacity);
    let to = Math.min(fretMax, from + Math.ceil((fretMax - from + 1) / rows) - 1);
    if (box && to >= box.window.fretMin && to < box.window.fretMax && from <= box.window.fretMin) {
      if (box.window.fretMax - from + 1 <= capacity) to = Math.min(box.window.fretMax, fretMax);
      else if (from < box.window.fretMin) to = box.window.fretMin - 1;
    }
    parts.push({ from, to });
    from = to + 1;
  }
  const groups = sections(options);
  const empty = positions.length ? '' : '<div class="empty-state" data-testid="empty-state"><h3>Выбери хотя бы одну струну</h3><p>Четыре струны остаются на месте; ноты появятся на включённых струнах.</p></div>';
  return `${empty}<div class="study-fretboard-parts">${parts.map((part, index) => {
    const count = part.to - part.from + 1;
    const cell = usable / count;
    const x = (fret: number) => LEFT + (fret - part.from + .5) * cell;
    const frets = Array.from({ length: count }, (_, index) => part.from + index);
    const title = `study-board-title-${index}`, description = `study-board-description-${index}`, gradient = `study-board-grain-${index}`;
    let svg = `<svg class="fretboard study-fretboard" data-testid="fretboard" viewBox="0 0 ${width} ${HEIGHT}" width="${width}" height="${HEIGHT}" aria-labelledby="${title} ${description}"><title id="${title}">Гриф четырёхструнного баса · лады ${part.from}–${part.to}</title><desc id="${description}">Струны сверху вниз G, D, A, E. Выберите позицию мышью или перейдите стрелками и нажмите Enter. Лады от ${part.from} до ${part.to} включительно.</desc><defs><linearGradient id="${gradient}" x1="0" y1="0" x2="0" y2="1"><stop class="board-gradient-top" offset="0"/><stop class="board-gradient-bottom" offset="1"/></linearGradient></defs><rect class="board-surface" x="${LEFT}" y="43" width="${usable}" height="277" rx="3" fill="url(#${gradient})"/>`;
    svg += frets.map(fret => `${box && fret >= box.window.fretMin && fret <= box.window.fretMax ? `<rect class="form-fret-shade" x="${LEFT + (fret - part.from) * cell}" y="43" width="${cell}" height="277"/><line class="form-fret-cap" x1="${x(fret) - cell / 2}" x2="${x(fret) + cell / 2}" y1="43" y2="43"/>` : ''}<text class="fret-number" data-fret="${fret}" x="${x(fret)}" y="25" text-anchor="middle">${fret}</text><line class="fret-wire${fret === 0 ? ' nut-line' : ''}" x1="${x(fret) + cell / 2}" x2="${x(fret) + cell / 2}" y1="44" y2="319"/>${[3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(fret) ? `<circle class="fret-inlay" cx="${x(fret)}" cy="${fret % 12 === 0 ? 171 : 181}" r="4"/>${fret % 12 === 0 ? `<circle class="fret-inlay" cx="${x(fret)}" cy="191" r="4"/>` : ''}` : ''}`).join('');
    svg += renderUnderlays(groups, part.from, part.to, x, index);
    svg += STRINGS.map(string => `<text class="string-name" x="18" y="${y(string) + 5}" text-anchor="middle">${string}</text><line class="bass-string-shadow string-${string}" x1="${LEFT}" x2="${width - RIGHT}" y1="${y(string) + 1}" y2="${y(string) + 1}"/><line class="bass-string string-${string}" x1="${LEFT}" x2="${width - RIGHT}" y1="${y(string)}" y2="${y(string)}"/>`).join('');
    if (options.showInterval && selected && anchor && selected.id !== anchor.id && positions.some(position => position.id === anchor.id) && anchor.fret >= part.from && anchor.fret <= part.to && selected.fret >= part.from && selected.fret <= part.to) {
      const ax = x(anchor.fret), ay = y(anchor.string), tx = x(selected.fret), ty = y(selected.string), cy = Math.min(330, Math.max(ay, ty) + 30);
      svg += `<path class="study-interval-link" data-interval-link="true" d="M ${ax} ${ay} C ${ax} ${cy}, ${tx} ${cy}, ${tx} ${ty}" aria-hidden="true"/>`;
    }
    const localPositions = positions.filter(position => position.fret >= part.from && position.fret <= part.to);
    // Large notes own their entire visible disc, including the part extending
    // into a neighbouring quiet fret cell in a compact form.
    const isLarge = (position: AnnotatedPosition) => ids.has(position.id) || position.id === options.selectedId;
    localPositions.sort((a, b) => Number(isLarge(a)) - Number(isLarge(b)));
    svg += localPositions.map(position => {
      const isSelected = position.id === options.selectedId;
      const large = ids.has(position.id) || isSelected;
      const samePitch = selected?.midi === position.midi && !isSelected;
      const finger = options.showFingers ? box?.fingers[position.id] : undefined;
      const label = positionLabel(position) + (finger ? `, рекомендуемый палец ${finger}` : '');
      const isIntervalTarget = isSelected && !position.isRoot && options.showInterval && anchor && anchor.id !== position.id;
      const classes = ['position', position.inStructure ? 'in-structure' : 'outside-structure', large ? 'is-large' : 'is-quiet', ...(box ? [ids.has(position.id) ? 'in-box' : 'outside-box'] : []), ...(position.isRoot ? ['root-position'] : []), ...(isSelected ? ['selected-position'] : []), ...(isIntervalTarget ? ['is-interval-target'] : []), ...(samePitch ? ['same-pitch-position'] : []), ...(options.sharedIds.has(position.id) ? ['shared-box-position'] : [])];
      const text = options.labelMode === 'notes' ? position.noteName : position.degree?.replaceAll('b', '♭') ?? '—';
      const hitWidth = large ? Math.max(46, Math.min(58, cell)) : Math.min(34, cell);
      return `<g role="button" class="${classes.join(' ')}" data-position="${position.id}" data-note-name="${escape(position.noteName)}" data-midi="${position.midi}" data-root="${position.isRoot}" data-in-structure="${position.inStructure}" transform="translate(${x(position.fret)},${y(position.string)})" tabindex="${position.id === options.activeId ? 0 : -1}" aria-label="${escape(label)}" aria-pressed="${isSelected}"><title>${escape(positionLabel(position))}</title><rect class="position-hit" x="${-hitWidth / 2}" y="-31" width="${hitWidth}" height="62" rx="5"/><circle class="position-focus" r="30"/><circle class="position-selection" r="27"/><circle class="note-marker" r="${large ? 23 : 3}"/>${position.isRoot && large ? '<circle class="root-ring" r="17"/>' : ''}${options.labelMode !== 'hidden' && large ? `<text data-position-label text-anchor="middle" dy=".35em">${escape(text)}</text>` : ''}${finger ? `<rect class="finger-background" x="15" y="-31" width="17" height="17" rx="3"/><text class="finger-label" x="23.5" y="-18" text-anchor="middle">${finger}</text>` : ''}</g>`;
    }).join('');
    svg += '</svg>';
    return `<section class="study-fretboard-part" aria-label="Лады ${part.from}–${part.to}">${parts.length > 1 ? `<p class="study-board-part-caption">Лады ${part.from}–${part.to}${index ? ' · продолжение' : ''}</p>` : ''}${svg}</section>`;
  }).join('')}</div>`;
}
