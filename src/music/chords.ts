/**
 * Фрагмент песни как упражнение (P14-04, D-050): разбор имени аккорда и ступень ноты относительно аккорда
 * или тональности. Чистый модуль: без alphaTab, DOM и базы.
 */
import { parseNote, type StructureId } from './index';

export interface ChordInfo { readonly root: string; readonly structureId: StructureId | null; readonly name: string }

/** Качество аккорда по суффиксу; длинные суффиксы проверяются раньше. */
const QUALITIES: readonly (readonly [RegExp, StructureId | null])[] = [
  [/^(m7b5|m7♭5|min7b5|ø7?)/, 'half-diminished-seventh'],
  [/^(maj7|ma7|M7|Δ7?|j7)/, 'major-seventh'],
  [/^(m7|min7|-7)/, 'minor-seventh'],
  [/^(dim7?|°7?|o7?)/, 'diminished-triad'],
  [/^(7|9|11|13)/, 'dominant-seventh'],
  [/^(m|min|-)(?!aj)/, 'minor-triad'],
  [/^(5)/, null],
  [/^(sus)/, null],
  [/^(maj|M|)/, 'major-triad'],
];

/** «Am7», «F#m7b5», «C/E» → тоника и структура; не распознано — `null`. Слеш-бас не меняет тонику аккорда. */
export function parseChord(name: string | null | undefined): ChordInfo | null {
  const text = (name ?? '').trim().split('/')[0].replace(/\s+/g, '');
  const match = /^([A-Ga-g])([#b♯♭]?)(.*)$/.exec(text);
  if (!match) return null;
  let root: string;
  try { root = parseNote(`${match[1].toUpperCase()}${match[2]}`).name; } catch { return null; }
  const rest = match[3];
  for (const [pattern, structureId] of QUALITIES) if (pattern.test(rest)) return { root, structureId, name: (name ?? '').trim() };
  return { root, structureId: null, name: (name ?? '').trim() };
}

const DEGREES = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'] as const;

/** Ступень высоты относительно тоники: «1», «b3», «5»… (по полутонам). */
export function degreeFrom(root: string, midi: number): string {
  return DEGREES[((midi - parseNote(root).pitchClass) % 12 + 12) % 12];
}

/** Тональность по знакам при ключе: число диезов (+) или бемолей (−) и лад. */
export function keyFromSignature(accidentals: number, minor: boolean): string | null {
  if (!Number.isInteger(accidentals) || accidentals < -7 || accidentals > 7) return null;
  const major = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'][accidentals + 7];
  const relative = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'][accidentals + 7];
  return minor ? `${relative}m` : major;
}
