import { formatMidi, getPosition, parseNote, type AnnotatedPosition, type NoteLetter, type StringId } from '../music';

export type NotationDuration = 'quarter' | 'eighth' | 'sixteenth';
export interface NotationConfig { readonly positions: readonly AnnotatedPosition[]; readonly duration: NotationDuration }
export interface NotationEvent {
  readonly id: string; readonly index: number; readonly positionId: string;
  readonly soundingMidi: number; readonly writtenMidi: number; readonly spelling: string;
  readonly writtenName: string; readonly writtenOctave: number; readonly letter: NoteLetter; readonly accidental: number;
  readonly accidentalDisplay: string; readonly staffStep: number; readonly ledgerSteps: readonly number[];
  readonly tab: { readonly row: number; readonly string: StringId; readonly fret: number };
  readonly beat: number; readonly bar: number; readonly beatInBar: number; readonly durationBeats: number; readonly flagCount: number;
}
export interface NotationPlan {
  readonly clef: 'bass'; readonly meter: '4/4'; readonly transpositionSemitones: 12; readonly duration: NotationDuration;
  readonly totalBeats: number; readonly bars: number; readonly events: readonly NotationEvent[];
}

const LETTERS: readonly NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const TAB_ORDER: readonly StringId[] = ['G', 'D', 'A', 'E'];
const DURATIONS = { quarter: { beats: 1, flags: 0 }, eighth: { beats: 0.5, flags: 1 }, sixteenth: { beats: 0.25, flags: 2 } } as const;
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
function ledgerSteps(staffStep: number): number[] {
  const lines = [];
  for (let step = -2; step >= staffStep; step -= 2) lines.push(step);
  for (let step = 10; step <= staffStep; step += 2) lines.push(step);
  return lines;
}

/** Monophonic educational notation: sounding bass pitches stay unchanged; the written staff is one octave higher. */
export function createNotationPlan(config: NotationConfig): NotationPlan {
  if (!Array.isArray(config.positions)) throw new TypeError('Для нотной записи нужен массив позиций последовательности.');
  if (!Object.hasOwn(DURATIONS, config.duration)) throw new RangeError('Выберите четверти, восьмые или шестнадцатые.');
  const duration = DURATIONS[config.duration];
  const accidentalState = new Map<string, number>();
  let previousBar = -1;
  const events = config.positions.map((position, index): NotationEvent => {
    if (!position || typeof position !== 'object') throw new RangeError('Некорректная позиция для нотной записи.');
    const actual = getPosition(position.string, position.fret);
    if (actual.id !== position.id || actual.midi !== position.midi || actual.pitchClass !== position.pitchClass) throw new RangeError('Позиция нотной записи не соответствует строю E–A–D–G.');
    const spelling = parseNote(position.noteName);
    if (spelling.pitchClass !== actual.pitchClass) throw new RangeError('Контекстное написание ноты не соответствует звучащей высоте.');
    const writtenMidi = actual.midi + 12;
    const writtenName = formatMidi(writtenMidi, spelling.name);
    const writtenOctave = Number(writtenName.match(/(-?\d+)$/)![1]);
    // G2 is the bass staff's bottom line (0); A3 is its top line (8).
    const staffStep = writtenOctave * 7 + LETTERS.indexOf(spelling.letter) - (2 * 7 + LETTERS.indexOf('G'));
    const beat = index * duration.beats;
    const bar = Math.floor(beat / 4);
    if (bar !== previousBar) { accidentalState.clear(); previousBar = bar; }
    const accidentalKey = `${spelling.letter}:${writtenOctave}`;
    const previousAccidental = accidentalState.get(accidentalKey) ?? 0;
    const accidentalDisplay = previousAccidental === spelling.accidental ? ''
      : spelling.accidental === 0 ? '♮' : spelling.accidental > 0 ? '♯'.repeat(spelling.accidental) : '♭'.repeat(-spelling.accidental);
    accidentalState.set(accidentalKey, spelling.accidental);
    return { id: `notation-${index}-${actual.id}`, index, positionId: actual.id, soundingMidi: actual.midi, writtenMidi,
      spelling: spelling.name, writtenName, writtenOctave, letter: spelling.letter, accidental: spelling.accidental, accidentalDisplay,
      staffStep, ledgerSteps: ledgerSteps(staffStep), tab: { row: TAB_ORDER.indexOf(actual.string), string: actual.string, fret: actual.fret },
      beat, bar, beatInBar: beat % 4, durationBeats: duration.beats, flagCount: duration.flags };
  });
  const totalBeats = events.length * duration.beats;
  return immutable({ clef: 'bass', meter: '4/4', transpositionSemitones: 12, duration: config.duration, totalBeats, bars: Math.ceil(totalBeats / 4), events });
}
