import {
  annotatePositions, formatMidi, getPosition, parseNote,
  type MusicalStructure, type NoteLetter, type NoteSpelling, type Position,
} from '../music';

export const INTERVAL_DEGREES = Object.freeze(['1', 'b2', '2', 'b3', '3', '4', '#4', 'b5', '5', 'b6', '6', 'b7', '7'] as const);
export type IntervalDegree = typeof INTERVAL_DEGREES[number];
export interface IntervalSpelling extends NoteSpelling { readonly degree: IntervalDegree; readonly semitones: number }
export interface ConstraintTarget {
  readonly scope: 'structure' | 'chromatic';
  readonly prompt: string;
  readonly target: { readonly pitchClass: number; readonly name: string; readonly degree: string | null };
  /** null means pitch-class matching. A number requires the exact sounding pitch. */
  readonly targetMidi: number | null;
  readonly expectedPositionIds: readonly string[];
}
export interface PitchTargetConfig {
  readonly positions: readonly Position[];
  readonly structure: MusicalStructure;
  readonly scope?: 'structure' | 'chromatic';
  readonly seed: number;
}

const LETTERS: readonly NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PITCH: Readonly<Record<NoteLetter, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const modulo12 = (value: number) => ((value % 12) + 12) % 12;

/** Keeps the interval's letter: C→#4 is F♯, while C→b5 is G♭. */
export function spellInterval(root: string, degree: IntervalDegree): IntervalSpelling {
  if (!INTERVAL_DEGREES.includes(degree)) throw new RangeError('Неизвестный интервал. Выберите значение из списка простых интервалов.');
  const tonic = parseNote(root);
  const degreeNumber = Number(degree.replace(/^[b#]/, ''));
  const alteration = degree.startsWith('b') ? -1 : degree.startsWith('#') ? 1 : 0;
  const semitones = MAJOR_INTERVALS[degreeNumber - 1] + alteration;
  const letterOffset = LETTERS.indexOf(tonic.letter) + degreeNumber - 1;
  const letter = LETTERS[letterOffset % 7];
  const naturalInterval = NATURAL_PITCH[letter] + 12 * Math.floor(letterOffset / 7) - NATURAL_PITCH[tonic.letter];
  const accidental = tonic.accidental + semitones - naturalInterval;
  const name = letter + (accidental > 0 ? '♯'.repeat(accidental) : '♭'.repeat(-accidental));
  return Object.freeze({ letter, accidental: accidental || 0, name, pitchClass: modulo12(tonic.pitchClass + semitones), degree, semitones });
}

function availablePositions(input: readonly Position[]): readonly Position[] {
  if (!Array.isArray(input)) throw new TypeError('Позиции должны быть массивом доступных позиций грифа.');
  const unique = new Map<string, Position>();
  for (const position of input) {
    if (!position || typeof position !== 'object') throw new RangeError('Некорректная позиция грифа.');
    const actual = getPosition(position.string, position.fret);
    if (position.id !== actual.id || position.midi !== actual.midi || position.pitchClass !== actual.pitchClass) throw new RangeError('Позиция не соответствует строю E–A–D–G.');
    unique.set(actual.id, actual);
  }
  return [...unique.values()];
}

function seededFraction(seed: number): number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed должен быть целым числом от 0 до 4294967295.');
  let state = seed || 0x9e3779b9;
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return (state >>> 0) / 0x100000000;
}

/** Samples existing unique MIDI heights rather than positions or an unconstrained range. */
export function createPitchTarget(config: PitchTargetConfig): ConstraintTarget & { readonly targetMidi: number } {
  const random = seededFraction(config.seed);
  const scope = config.scope ?? 'structure';
  if (scope !== 'structure' && scope !== 'chromatic') throw new RangeError('Неизвестная область поиска высоты.');
  const positions = annotatePositions(availablePositions(config.positions), config.structure).filter(position => scope === 'chromatic' || position.inStructure);
  const heights = [...new Set(positions.map(position => position.midi))].sort((a, b) => a - b);
  if (heights.length === 0) throw new RangeError('В выбранной области нет доступных высот. Измените струны, лады или область.');
  const targetMidi = heights[Math.floor(random * heights.length)];
  const matching = positions.filter(position => position.midi === targetMidi);
  const selected = matching[0];
  return Object.freeze({
    scope, targetMidi,
    prompt: `Найдите высоту ${formatMidi(targetMidi, selected.noteName)}. Подходит любая позиция этой высоты, но не другая октава.`,
    target: Object.freeze({ pitchClass: selected.pitchClass, name: selected.noteName, degree: selected.degree }),
    expectedPositionIds: Object.freeze(matching.map(position => position.id)),
  });
}

/** Intervals are pitch classes relative to the tonic; all supplied positions are eligible. */
export function createIntervalTarget(root: string, degree: IntervalDegree, positions: readonly Position[]): ConstraintTarget & { readonly scope: 'chromatic'; readonly targetMidi: null } {
  const tonic = parseNote(root);
  const interval = spellInterval(root, degree);
  const matching = availablePositions(positions).filter(position => position.pitchClass === interval.pitchClass);
  if (matching.length === 0) throw new RangeError(`Интервал ${degree.replaceAll('b', '♭').replaceAll('#', '♯')} от ${tonic.name} (${interval.name}) отсутствует в выбранных струнах и ладах. Измените диапазон или интервал.`);
  return Object.freeze({
    scope: 'chromatic', targetMidi: null,
    prompt: `Найдите интервал ${degree.replaceAll('b', '♭').replaceAll('#', '♯')} от ${tonic.name}. Подходит любая октава; область — все ноты.`,
    target: Object.freeze({ pitchClass: interval.pitchClass, name: interval.name, degree }),
    expectedPositionIds: Object.freeze(matching.map(position => position.id)),
  });
}
