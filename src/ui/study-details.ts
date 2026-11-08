import { formatMidi, type AnnotatedPosition, type MusicalStructure, type StringId } from '../music';
import type { BoxInstance } from '../music/boxes';

const STRINGS: readonly StringId[] = ['G', 'D', 'A', 'E'];
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const pretty = (value: string) => value.replaceAll('b', '♭').replaceAll('#', '♯');

export interface StudyDetailsOptions {
  readonly positions: readonly AnnotatedPosition[];
  readonly selectedId: string | null;
  readonly structure: MusicalStructure;
  readonly box: BoxInstance | null;
}

export function studyAnchor(options: StudyDetailsOptions): AnnotatedPosition | undefined {
  return options.box?.positions.find(note => note.isRoot)
    ?? options.positions.filter(note => note.isRoot).sort((a, b) => a.midi - b.midi)[0];
}

export function intervalName(delta: number): string {
  const distance = Math.abs(delta);
  const names = ['Прима', 'Малая секунда', 'Большая секунда', 'Малая терция', 'Большая терция', 'Кварта', 'Тритон', 'Квинта', 'Малая секста', 'Большая секста', 'Малая септима', 'Большая септима'];
  const name = distance === 0 ? 'Та же высота' : distance === 12 ? 'Октава' : distance % 12 === 0 ? `${distance / 12} октавы`
    : names[distance % 12] + (distance > 24 ? ` через ${Math.floor(distance / 12)} октавы` : distance > 12 ? ' через октаву' : '');
  return name + (delta < 0 ? ' вниз' : '');
}

export function renderStudySelection(options: StudyDetailsOptions, technicalOpen: boolean): string {
  const selected = options.positions.find(note => note.id === options.selectedId);
  if (!selected) return '<div class="selection-card selection-empty"><h2>Пока нет позиции</h2><p>Включи струну, чтобы продолжить исследование. Все четыре строки остаются на месте.</p></div>';
  const name = formatMidi(selected.midi, selected.noteName);
  return `<div class="selection-card"><div class="selected-note"><h2>${escape(name)}</h2><div><strong class="selection-kind${selected.isRoot ? ' is-root' : selected.inStructure ? '' : ' outside'}">${selected.isRoot ? 'Тоника' : selected.inStructure ? `Ступень ${escape(pretty(selected.degree ?? ''))}` : 'Вне структуры'}</strong><span>Струна ${selected.string} · ${selected.fret === 0 ? 'открытая' : `лад ${selected.fret}`}${options.box?.fingers[selected.id] ? ` · палец ${options.box.fingers[selected.id]}` : ''}</span></div><div class="selection-coordinate"><strong>${selected.string}</strong><span>/</span><strong>${selected.fret}</strong></div></div><details class="learning-help note-technical"${technicalOpen ? ' open' : ''}><summary>Технические сведения</summary><dl class="note-facts"><div><dt>Звучащая высота</dt><dd>${escape(name)}</dd></div><div><dt>MIDI</dt><dd>${selected.midi}</dd></div><div><dt>Частота</dt><dd>${selected.frequency.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Гц</dd></div></dl></details></div>`;
}

export function renderStudyInterval(options: StudyDetailsOptions): string {
  const selected = options.positions.find(note => note.id === options.selectedId);
  if (!selected) return '';
  const anchor = studyAnchor(options);
  if (!anchor) return `<p class="settings-hint">В выбранной области нет тоники для соединителя. Ступень отсчитывается от ${escape(options.structure.root)}.</p>`;
  const delta = selected.midi - anchor.midi;
  const third = options.structure.notes.find(note => note.degree.endsWith('3'))?.semitones;
  const targets = [[third, 'Терция'], [7, 'Квинта'], [12, 'Октава']] as const;
  const ids = new Set(options.box?.referencePositionIds ?? []);
  return `<div class="study-interval"><div><span class="interval-label">Интервал от тоники</span><strong>${escape(formatMidi(anchor.midi, anchor.noteName))} → ${escape(formatMidi(selected.midi, selected.noteName))}</strong><small>${escape(intervalName(delta))} · ${delta > 0 ? '+' : ''}${delta} полутонов</small></div><div class="segmented" aria-label="Посмотреть интервал">${targets.map(([semitones, label]) => {
    const candidates = options.positions.filter(note => semitones !== undefined && note.midi === anchor.midi + semitones);
    const target = candidates.find(note => ids.has(note.id)) ?? candidates[0];
    return `<button type="button" data-interval-target="${target?.id ?? ''}" aria-pressed="${Boolean(target && target.id === selected.id)}"${target ? '' : ' disabled'}>${label}</button>`;
  }).join('')}</div></div>`;
}

export function renderStudyConnections(options: StudyDetailsOptions, open: boolean): string {
  const selected = options.positions.find(note => note.id === options.selectedId);
  if (!selected) return '';
  const same = options.positions.filter(note => note.id !== selected.id && note.midi === selected.midi);
  const octaves = options.positions.filter(note => note.pitchClass === selected.pitchClass && note.midi !== selected.midi);
  const buttons = (notes: readonly AnnotatedPosition[], kind: string) => [...notes].sort((a, b) => a.midi - b.midi || STRINGS.indexOf(a.string) - STRINGS.indexOf(b.string)).map(note => `<button class="connection-button" type="button" data-connect="${note.id}" data-connection-kind="${kind}"><strong>${escape(formatMidi(note.midi, note.noteName))}</strong><span>${note.string} · ${note.fret === 0 ? 'откр.' : `${note.fret} лад`}</span><span aria-hidden="true">↗</span></button>`).join('');
  return `<details class="learning-help study-connections"${open ? ' open' : ''}><summary>Та же нота на грифе</summary><div class="connection-columns"><div class="connection-group"><h3>Та же высота <span>${same.length}</span></h3><div class="connection-buttons">${buttons(same, 'same') || '<p class="no-connections">В выбранной области других позиций нет.</p>'}</div></div><div class="connection-group"><h3>Другие октавы <span>${octaves.length}</span></h3><div class="connection-buttons">${buttons(octaves, 'octave') || '<p class="no-connections">Другие октавы вне выбранной области.</p>'}</div></div></div></details>`;
}
