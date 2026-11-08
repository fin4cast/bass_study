import type { AnnotatedPosition, MusicalStructure } from './index';

/** A sounding register of the chosen structure, including both tonic bounds. */
export interface OctaveSection {
  readonly fromMidi: number;
  readonly toMidi: number;
  readonly positions: readonly AnnotatedPosition[];
  readonly startsAtTonic: boolean;
  readonly completeMaterial: boolean;
  readonly completeVisible: boolean;
  readonly partiallyShown: boolean;
  readonly colorIndex: 0 | 1;
}

/**
 * Physical positions remain distinct; completeness is checked by sounding MIDI.
 * A boundary tonic can belong to two sections, but never creates one by itself.
 */
export function getOctaveSections(
  material: readonly AnnotatedPosition[],
  visible: readonly AnnotatedPosition[],
  structure: MusicalStructure,
): readonly OctaveSection[] {
  const source = material.filter(position => position.inStructure);
  if (!source.length || !visible.length) return [];
  const visibleIds = new Set(visible.map(position => position.id));
  const low = Math.min(...source.map(position => position.midi));
  const high = Math.max(...source.map(position => position.midi));
  const pc = structure.rootPitchClass;
  const first = pc + 12 * Math.floor((low - pc) / 12);
  const sections: OctaveSection[] = [];
  for (let fromMidi = first; fromMidi <= high; fromMidi += 12) {
    const toMidi = fromMidi + 12;
    const candidates = source.filter(position => position.midi >= fromMidi && position.midi <= toMidi);
    const pitches = new Set(candidates.map(position => position.midi));
    const positions = candidates.filter(position => visibleIds.has(position.id));
    const visiblePitches = new Set(positions.map(position => position.midi));
    const boundaryOnly = (values: ReadonlySet<number>) => values.size === 1 && (values.has(fromMidi) || values.has(toMidi));
    if (!positions.length || boundaryOnly(pitches) || boundaryOnly(visiblePitches)) continue;
    const required = [...structure.notes.map(note => fromMidi + note.semitones), toMidi];
    const completeMaterial = required.every(midi => pitches.has(midi));
    sections.push({
      fromMidi, toMidi, positions,
      startsAtTonic: pitches.has(fromMidi),
      completeMaterial,
      completeVisible: completeMaterial && required.every(midi => visiblePitches.has(midi)),
      partiallyShown: positions.length < candidates.length,
      colorIndex: (Math.floor(fromMidi / 12) % 2 + 2) % 2 as 0 | 1,
    });
  }
  return sections;
}
