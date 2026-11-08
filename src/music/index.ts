/** Pure musical calculations. This module has no DOM, audio or storage dependencies. */
export type StringId = 'E' | 'A' | 'D' | 'G';
export type StructureId =
  | 'major'
  | 'natural-minor'
  | 'major-pentatonic'
  | 'minor-pentatonic'
  | 'major-triad'
  | 'minor-triad';
export type LabelMode = 'notes' | 'degrees' | 'hidden';
export type NoteLetter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface BassString {
  readonly id: StringId;
  readonly number: number;
  readonly openMidi: number;
}

export interface StructureDefinition {
  readonly id: StructureId;
  readonly name: string;
  readonly intervals: readonly number[];
  /** Degrees refer to the major scale, not to the ordinal within a pentatonic. */
  readonly degrees: readonly string[];
}

export interface NoteSpelling {
  readonly letter: NoteLetter;
  readonly accidental: number;
  readonly pitchClass: number;
  readonly name: string;
}

export interface StructureNote extends NoteSpelling {
  readonly degree: string;
  readonly semitones: number;
}

export interface MusicalStructure {
  readonly root: string;
  readonly rootPitchClass: number;
  readonly id: StructureId;
  readonly name: string;
  readonly formula: string;
  readonly notes: readonly StructureNote[];
}

export interface Position {
  readonly id: string;
  readonly string: StringId;
  readonly fret: number;
  readonly midi: number;
  readonly pitchClass: number;
  /** Canonical chromatic name, without octave; context is added separately. */
  readonly naturalName: string;
  readonly frequency: number;
}

export interface PositionFilter {
  readonly strings: readonly StringId[];
  readonly fretMin: number;
  readonly fretMax: number;
}

export interface AnnotatedPosition extends Position {
  readonly inStructure: boolean;
  readonly isRoot: boolean;
  readonly noteName: string;
  readonly degree: string | null;
}

export const BASS_STRINGS: readonly BassString[] = Object.freeze([
  Object.freeze({ id: 'E' as const, number: 4, openMidi: 28 }),
  Object.freeze({ id: 'A' as const, number: 3, openMidi: 33 }),
  Object.freeze({ id: 'D' as const, number: 2, openMidi: 38 }),
  Object.freeze({ id: 'G' as const, number: 1, openMidi: 43 }),
]);

const definitions: StructureDefinition[] = [
  { id: 'major', name: 'Мажор', intervals: [0, 2, 4, 5, 7, 9, 11], degrees: ['1', '2', '3', '4', '5', '6', '7'] },
  { id: 'natural-minor', name: 'Натуральный минор', intervals: [0, 2, 3, 5, 7, 8, 10], degrees: ['1', '2', 'b3', '4', '5', 'b6', 'b7'] },
  { id: 'major-pentatonic', name: 'Мажорная пентатоника', intervals: [0, 2, 4, 7, 9], degrees: ['1', '2', '3', '5', '6'] },
  { id: 'minor-pentatonic', name: 'Минорная пентатоника', intervals: [0, 3, 5, 7, 10], degrees: ['1', 'b3', '4', '5', 'b7'] },
  { id: 'major-triad', name: 'Мажорное трезвучие', intervals: [0, 4, 7], degrees: ['1', '3', '5'] },
  { id: 'minor-triad', name: 'Минорное трезвучие', intervals: [0, 3, 7], degrees: ['1', 'b3', '5'] },
];

export const STRUCTURES: readonly StructureDefinition[] = Object.freeze(definitions.map(definition => Object.freeze({
  ...definition,
  intervals: Object.freeze([...definition.intervals]),
  degrees: Object.freeze([...definition.degrees]),
})));

const LETTERS: readonly NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PITCH: Readonly<Record<NoteLetter, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHROMATIC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;
const modulo12 = (value: number) => ((value % 12) + 12) % 12;

function assertInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label}: требуется целое число от ${min} до ${max}.`);
  }
}

function assertMidi(midi: number): void {
  assertInteger(midi, 0, 127, 'MIDI-высота');
}

function spellingName(letter: NoteLetter, accidental: number): string {
  return letter + (accidental > 0 ? '♯'.repeat(accidental) : '♭'.repeat(-accidental));
}

export function pitchClass(midi: number): number {
  assertMidi(midi);
  return modulo12(midi);
}

export function midiToFrequency(midi: number): number {
  assertMidi(midi);
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Parses a pitch-class name, not a scientific note with an octave suffix. */
export function parseNote(input: string): NoteSpelling {
  if (typeof input !== 'string') throw new TypeError('Название ноты должно быть строкой.');
  const normalized = input.trim()
    .replaceAll('♯', '#').replaceAll('♭', 'b')
    .replaceAll('𝄪', '##').replaceAll('𝄫', 'bb')
    .replaceAll('x', '##');
  const match = /^([A-Ga-g])(#+|b+|♮)?$/.exec(normalized);
  if (!match) throw new RangeError('Некорректная нота: используйте A–G и знаки ♯ или ♭ без номера октавы.');
  const letter = match[1].toUpperCase() as NoteLetter;
  const marks = match[2] === '♮' ? '' : (match[2] ?? '');
  const accidental = marks.startsWith('#') ? marks.length : -marks.length;
  return Object.freeze({
    letter,
    accidental: accidental || 0,
    pitchClass: modulo12(NATURAL_PITCH[letter] + accidental),
    name: spellingName(letter, accidental),
  });
}

/** Gives the octave of the spelling: MIDI 36 may be C2 or B♯1, not B♯2. */
export function formatMidi(midi: number, name?: string): string {
  assertMidi(midi);
  const spelling = parseNote(name ?? CHROMATIC_NAMES[modulo12(midi)]);
  if (spelling.pitchClass !== modulo12(midi)) {
    throw new RangeError('Написание ноты не соответствует звучащей MIDI-высоте.');
  }
  const octave = (midi - NATURAL_PITCH[spelling.letter] - spelling.accidental) / 12 - 1;
  return `${spelling.name}${octave}`;
}

export function createStructure(root: string, id: StructureId): MusicalStructure {
  const tonic = parseNote(root);
  const definition = STRUCTURES.find(candidate => candidate.id === id);
  if (!definition) throw new RangeError('Неизвестная гамма или трезвучие.');
  const tonicLetter = LETTERS.indexOf(tonic.letter);
  const notes = definition.intervals.map((semitones, index): StructureNote => {
    const degree = definition.degrees[index];
    const degreeNumber = Number(degree.replace(/^[b#]+/, ''));
    const letterOffset = tonicLetter + degreeNumber - 1;
    const letter = LETTERS[letterOffset % LETTERS.length];
    const target = modulo12(tonic.pitchClass + semitones);
    // Calculate the diatonic distance before altering it. This preserves both
    // the interval's letter and the tonic's spelling, including double signs.
    const naturalInterval = NATURAL_PITCH[letter] + 12 * Math.floor(letterOffset / LETTERS.length) - NATURAL_PITCH[tonic.letter];
    const accidental = tonic.accidental + semitones - naturalInterval;
    return Object.freeze({
      letter,
      accidental,
      pitchClass: target,
      name: spellingName(letter, accidental),
      degree,
      semitones,
    });
  });
  return Object.freeze({
    root: tonic.name,
    rootPitchClass: tonic.pitchClass,
    id: definition.id,
    name: definition.name,
    formula: definition.degrees.map(degree => degree.replaceAll('b', '♭').replaceAll('#', '♯')).join(' – '),
    notes: Object.freeze(notes),
  });
}

export function getPosition(string: StringId, fret: number): Position {
  const bassString = BASS_STRINGS.find(candidate => candidate.id === string);
  if (!bassString) throw new RangeError('Неизвестная струна: доступны E, A, D, G.');
  assertInteger(fret, 0, 24, 'Лад');
  const midi = bassString.openMidi + fret;
  return Object.freeze({
    id: `${string}:${fret}`,
    string,
    fret,
    midi,
    pitchClass: modulo12(midi),
    naturalName: CHROMATIC_NAMES[modulo12(midi)],
    frequency: midiToFrequency(midi),
  });
}

/** Uses canonical E→A→D→G order independently of the order of filter values. */
export function getPositions(filter: PositionFilter): readonly Position[] {
  if (!filter || typeof filter !== 'object') throw new TypeError('Нужны настройки диапазона грифа.');
  assertInteger(filter.fretMin, 0, 24, 'Первый лад');
  assertInteger(filter.fretMax, 0, 24, 'Последний лад');
  if (filter.fretMin > filter.fretMax) throw new RangeError('Первый лад не может быть больше последнего.');
  if (!Array.isArray(filter.strings)) throw new TypeError('Струны должны быть массивом E, A, D, G.');
  const selected = new Set(filter.strings);
  if (selected.size !== filter.strings.length) throw new RangeError('Струны в фильтре не должны повторяться.');
  for (const string of selected) {
    if (!BASS_STRINGS.some(candidate => candidate.id === string)) throw new RangeError('Неизвестная струна в фильтре.');
  }
  return Object.freeze(BASS_STRINGS.filter(string => selected.has(string.id)).flatMap(string =>
    Array.from({ length: filter.fretMax - filter.fretMin + 1 }, (_, index) => getPosition(string.id, filter.fretMin + index)),
  ));
}

export function annotatePositions(positions: readonly Position[], structure: MusicalStructure): readonly AnnotatedPosition[] {
  const notesByClass = new Map(structure.notes.map(note => [note.pitchClass, note]));
  return Object.freeze(positions.map(position => {
    const note = notesByClass.get(position.pitchClass);
    return Object.freeze({
      ...position,
      inStructure: note !== undefined,
      isRoot: position.pitchClass === structure.rootPitchClass,
      noteName: note?.name ?? position.naturalName,
      degree: note?.degree ?? null,
    });
  }));
}
