/**
 * Клетки тонов аккорда и выбор позиции тоники (R-028, дополнение B0.1–B0.2). Чистые вычисления без зависимости
 * от каталога упражнений: рисунок такта превращается в позиции на грифе от тоники аккорда.
 * Позиция `closed` строится прежним кодом по компактным формам; здесь — `low` (нижняя) и `open` (открытые струны).
 */
import { getPosition, type StringId, type StructureId } from '../music';

export type Tone = '1' | '3' | 'b3' | '5' | 'b5' | '6' | 'b7' | '7' | '8';
export type ChordFamily = 'major' | 'minor';

const STRINGS: readonly StringId[] = ['E', 'A', 'D', 'G'];
/** Клетка тона от тоники: на `dString` струн выше по звуку, на `dFret` ладов; палец при зажатом ладе. */
interface Cell { readonly dString: number; readonly dFret: number; readonly finger: number }

/** Таблица B0.2: мажорное семейство и минорное семейство. */
const MAJOR_CELLS: Readonly<Partial<Record<Tone, Cell>>> = {
  '1': { dString: 0, dFret: 0, finger: 2 }, '3': { dString: 1, dFret: -1, finger: 1 }, '5': { dString: 1, dFret: 2, finger: 4 },
  '6': { dString: 2, dFret: -1, finger: 1 }, b7: { dString: 2, dFret: 0, finger: 2 }, '7': { dString: 2, dFret: 1, finger: 3 }, '8': { dString: 2, dFret: 2, finger: 4 },
};
const MINOR_CELLS: Readonly<Partial<Record<Tone, Cell>>> = {
  '1': { dString: 0, dFret: 0, finger: 1 }, b3: { dString: 0, dFret: 3, finger: 4 }, '5': { dString: 1, dFret: 2, finger: 3 }, b5: { dString: 1, dFret: 1, finger: 2 },
  b7: { dString: 2, dFret: 0, finger: 1 }, '8': { dString: 2, dFret: 2, finger: 3 },
};

/** Мажорное семейство — трезвучие и септаккорды от большой терции; минорное — от малой. */
export const chordFamily = (structureId: StructureId): ChordFamily =>
  structureId === 'minor-triad' || structureId === 'minor-seventh' || structureId === 'diminished-triad' || structureId === 'half-diminished-seventh' ? 'minor' : 'major';
const isSeventh = (structureId: StructureId) => structureId === 'dominant-seventh' || structureId === 'major-seventh' || structureId === 'minor-seventh';

/** Рисунки такта в форме E (восемь нот) по B2.1; подход — отдельно, он заменяет последнюю ноту. */
export function barTones(pattern: string, structureId: StructureId): readonly Tone[] {
  const family = chordFamily(structureId);
  const third: Tone = family === 'major' ? '3' : 'b3';
  const seventh: Tone = structureId === 'major-seventh' ? '7' : 'b7';
  switch (pattern) {
    case 'roots': return ['1', '1', '1', '1', '1', '1', '1', '1'];
    case 'root-fifth': return ['1', '1', '5', '5', '1', '1', '5', '5'];
    case 'octaves': return ['1', '8', '1', '8', '1', '8', '1', '8'];
    case 'boogie': return ['1', '3', '5', '6', 'b7', '6', '5', '3'];
    default: // arpeggio, approach
      return isSeventh(structureId) ? ['1', third, '5', seventh, '8', seventh, '5', third] : ['1', third, '5', third, '1', third, '5', third];
  }
}

export interface Placed { readonly string: StringId; readonly fret: number; readonly tone: Tone; readonly finger: number | null }
export interface Tonic { readonly string: StringId; readonly fret: number }

/** Позиции тонов от тоники; `null`, если какая-либо нота выходит за гриф (струна выше G или лад вне 0–24). Нота на открытой струне — без пальца. */
export function placeTones(tonic: Tonic, tones: readonly Tone[], family: ChordFamily): Placed[] | null {
  const cells = family === 'major' ? MAJOR_CELLS : MINOR_CELLS;
  const base = STRINGS.indexOf(tonic.string);
  const placed: Placed[] = [];
  for (const tone of tones) {
    const cell = cells[tone];
    if (!cell) return null;
    const string = STRINGS[base + cell.dString];
    const fret = tonic.fret + cell.dFret;
    if (!string || fret < 0 || fret > 24) return null;
    placed.push({ string, fret, tone, finger: fret === 0 ? null : cell.finger });
  }
  return placed;
}

/**
 * Нижняя позиция (B0.1): для аккорда отдельно — самая низкая тоника на струне E или A (лад от 0), при которой все ноты
 * рисунка лежат на ладах 0–24. От предыдущего аккорда выбор не зависит.
 */
export function lowTonic(rootPitchClass: number, tones: readonly Tone[], family: ChordFamily): Tonic {
  const candidates: Tonic[] = [];
  for (const string of ['E', 'A'] as const) for (let fret = 0; fret <= 24; fret++) if (getPosition(string, fret).pitchClass === rootPitchClass) candidates.push({ string, fret });
  candidates.sort((a, b) => a.fret - b.fret || STRINGS.indexOf(a.string) - STRINGS.indexOf(b.string));
  const found = candidates.find(candidate => placeTones(candidate, tones, family));
  if (!found) throw new RangeError('Рисунок не помещается в нижней позиции этого аккорда.');
  return found;
}

/** Открытая струна с классом высоты тоники (E, A, D, G); `null`, если такой нет. */
export function openTonic(rootPitchClass: number): Tonic | null {
  const string = STRINGS.find(candidate => getPosition(candidate, 0).pitchClass === rootPitchClass);
  return string ? { string, fret: 0 } : null;
}

/** Лад подхода (B0.1, `low`): на лад ниже следующей тоники на её струне, лад 0 допустим; у открытой струны — на лад выше. */
export const approachFret = (next: Tonic): number => (next.fret >= 1 ? next.fret - 1 : next.fret + 1);
