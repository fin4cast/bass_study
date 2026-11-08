import {
  BASS_STRINGS, annotatePositions, createStructure, getPosition, getPositions,
  type AnnotatedPosition, type MusicalStructure, type Position,
} from '../music';

export type ChordQuality = 'major' | 'minor';
export interface HarmonyPreferences {
  readonly bpm: number; readonly countIn: boolean; readonly repeat: 'once' | 'infinite';
  readonly bassVolume: number; readonly padVolume: number; readonly clickVolume: number;
  readonly bassMuted: boolean; readonly padMuted: boolean; readonly clickMuted: boolean;
}
export interface HarmonyChord { readonly root: string; readonly quality: ChordQuality }
export interface HarmonyConfig { readonly chords?: readonly HarmonyChord[]; readonly positions?: readonly Position[]; readonly bpm?: number }
export interface HarmonyChordPlan extends HarmonyChord {
  readonly index: number; readonly startBeat: number; readonly bassRootMidi: number; readonly structure: MusicalStructure;
}
export interface HarmonyEvent {
  readonly id: string; readonly source: 'bass' | 'pad' | 'click'; readonly beat: number; readonly durationBeats: number;
  readonly atSeconds: number; readonly durationSeconds: number; readonly midi: number | null; readonly chordIndex: number;
  readonly degree: string | null; readonly spelling: string | null; readonly position: AnnotatedPosition | null; readonly accent: boolean;
}
export interface HarmonyPlan {
  readonly bpm: number; readonly meter: '4/4'; readonly totalBeats: 16; readonly durationSeconds: number; readonly name: string;
  readonly chords: readonly HarmonyChordPlan[]; readonly events: readonly HarmonyEvent[];
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
export const DEFAULT_HARMONY_PREFERENCES: HarmonyPreferences = immutable({ bpm: 80, countIn: true, repeat: 'once', bassVolume: 70, padVolume: 45, clickVolume: 50, bassMuted: false, padMuted: false, clickMuted: false });
export const DEFAULT_PROGRESSION: readonly HarmonyChord[] = immutable([
  { root: 'C', quality: 'major' }, { root: 'F', quality: 'major' }, { root: 'G', quality: 'major' }, { root: 'C', quality: 'major' },
]);

function normalizePositions(input: readonly Position[]): readonly Position[] {
  if (!Array.isArray(input)) throw new TypeError('Позиции сопровождения должны быть массивом.');
  const unique = new Map<string, Position>();
  for (const position of input) {
    if (!position || typeof position !== 'object') throw new RangeError('Некорректная позиция сопровождения.');
    const actual = getPosition(position.string, position.fret);
    if (actual.id !== position.id || actual.midi !== position.midi || actual.pitchClass !== position.pitchClass) throw new RangeError('Позиция не соответствует стандартному строю E–A–D–G.');
    unique.set(actual.id, actual);
  }
  if (!unique.size) throw new RangeError('Нет доступных позиций для басового рисунка. Выбери струны и диапазон ладов.');
  return [...unique.values()].sort((a, b) => a.midi - b.midi
    || BASS_STRINGS.findIndex(string => string.id === a.string) - BASS_STRINGS.findIndex(string => string.id === b.string)
    || a.fret - b.fret);
}

/** One four-bar cycle. Playback, looping, mix controls and actual audio time belong to the audio adapter. */
export function createHarmonyPlan(config: HarmonyConfig = {}): HarmonyPlan {
  const bpm = config.bpm ?? 80;
  if (!Number.isInteger(bpm) || bpm < 40 || bpm > 220) throw new RangeError('Темп сопровождения должен быть целым от 40 до 220 BPM.');
  const input = config.chords ?? DEFAULT_PROGRESSION;
  if (!Array.isArray(input) || input.length !== 4) throw new RangeError('Для сопровождения нужны ровно четыре аккорда, по одному на такт.');
  const positions = normalizePositions(config.positions ?? getPositions({ strings: ['E', 'A', 'D', 'G'], fretMin: 0, fretMax: 12 }));
  const positionByMidi = new Map<number, Position>();
  positions.forEach(position => { if (!positionByMidi.has(position.midi)) positionByMidi.set(position.midi, position); });
  const beatSeconds = 60 / bpm;
  const events: HarmonyEvent[] = [];
  const chords = input.map((chord, index): HarmonyChordPlan => {
    if (!chord || typeof chord !== 'object' || (chord.quality !== 'major' && chord.quality !== 'minor')) throw new RangeError('Каждый аккорд должен быть мажорным или минорным трезвучием.');
    const structure = createStructure(chord.root, chord.quality === 'major' ? 'major-triad' : 'minor-triad');
    const rootPosition = positions.find(position => position.pitchClass === structure.rootPitchClass
      && structure.notes.every(note => positionByMidi.has(position.midi + note.semitones)));
    if (!rootPosition) throw new RangeError(`Такт ${index + 1}: трезвучие ${structure.root}${chord.quality === 'minor' ? 'm' : ''} не помещается в выбранные струны и лады. Нужны тоника, её терция и квинта выше по высоте. Измени диапазон.`);
    const startBeat = index * 4;
    const bassPattern = [0, 1, 2, 1];
    bassPattern.forEach((noteIndex, beatOffset) => {
      const note = structure.notes[noteIndex];
      const midi = rootPosition.midi + note.semitones;
      const selected = positionByMidi.get(midi)!;
      const position = annotatePositions([selected], structure)[0];
      events.push({ id: `bar-${index}:bass-${beatOffset}`, source: 'bass', beat: startBeat + beatOffset, durationBeats: 1,
        atSeconds: (startBeat + beatOffset) * beatSeconds, durationSeconds: beatSeconds, midi, chordIndex: index,
        degree: note.degree, spelling: note.name, position, accent: false });
    });
    structure.notes.forEach((note, noteIndex) => {
      events.push({ id: `bar-${index}:pad-${noteIndex}`, source: 'pad', beat: startBeat, durationBeats: 4,
        atSeconds: startBeat * beatSeconds, durationSeconds: 4 * beatSeconds, midi: 48 + structure.rootPitchClass + note.semitones,
        chordIndex: index, degree: note.degree, spelling: note.name, position: null, accent: false });
    });
    for (let beatOffset = 0; beatOffset < 4; beatOffset++) {
      events.push({ id: `bar-${index}:click-${beatOffset}`, source: 'click', beat: startBeat + beatOffset, durationBeats: 1,
        atSeconds: (startBeat + beatOffset) * beatSeconds, durationSeconds: beatSeconds, midi: null, chordIndex: index,
        degree: null, spelling: null, position: null, accent: beatOffset === 0 });
    }
    return { index, root: structure.root, quality: chord.quality, startBeat, bassRootMidi: rootPosition.midi, structure };
  });
  const priority = { bass: 0, pad: 1, click: 2 };
  events.sort((a, b) => a.beat - b.beat || priority[a.source] - priority[b.source]);
  return immutable({ bpm, meter: '4/4', totalBeats: 16, durationSeconds: 16 * beatSeconds,
    name: chords.map(chord => `${chord.root}${chord.quality === 'minor' ? 'm' : ''}`).join(' – '), chords, events });
}
