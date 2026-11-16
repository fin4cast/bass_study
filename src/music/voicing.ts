/**
 * Голоса аккомпанемента аккордами (R-028, B6): каждый тон аккорда берётся в единственной высоте окна G3–F♯4
 * (MIDI 55–66, ровно двенадцать полутонов), поэтому обращение получается само и голоса соседних аккордов
 * движутся минимально. Чистые вычисления без звука.
 */
import { createStructure, parseNote, type StructureId } from './index';

export const VOICING_MIN_MIDI = 55;
export const VOICING_MAX_MIDI = 66;

/**
 * Высоты голосов аккорда по возрастанию. Аккорд с распознанной структурой — все тоны структуры (трезвучие или
 * септаккорд); без структуры («E5», «sus») — тоника и квинта.
 */
export function chordVoicing(chord: { readonly root: string; readonly structureId: StructureId | null }): readonly number[] {
  const root = parseNote(chord.root).pitchClass;
  const classes = chord.structureId ? createStructure(chord.root, chord.structureId).notes.map(note => note.pitchClass) : [root, (root + 7) % 12];
  const midis = classes.map(pitchClass => VOICING_MIN_MIDI + ((((pitchClass - VOICING_MIN_MIDI) % 12) + 12) % 12));
  return [...new Set(midis)].sort((a, b) => a - b);
}
