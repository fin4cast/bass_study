/**
 * Клетки тонов аккорда и выбор позиции тоники (R-028, дополнение B0.1–B0.2). Чистые вычисления без зависимости
 * от каталога упражнений: рисунок такта превращается в позиции на грифе от тоники аккорда.
 * Позиция `closed` строится прежним кодом по компактным формам; здесь — `low` (нижняя) и `open` (открытые струны).
 */
import { getPosition, parseNote, type StringId, type StructureId } from '../music';

export type Tone = '1' | '3' | 'b3' | '4' | '5' | 'b5' | '6' | 'b7' | '7' | '8';
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
  '1': { dString: 0, dFret: 0, finger: 1 }, b3: { dString: 0, dFret: 3, finger: 4 }, '4': { dString: 1, dFret: 0, finger: 1 }, '5': { dString: 1, dFret: 2, finger: 3 }, b5: { dString: 1, dFret: 1, finger: 2 },
  b7: { dString: 2, dFret: 0, finger: 1 }, '8': { dString: 2, dFret: 2, finger: 3 },
};

/** Мажорное семейство — трезвучие и септаккорды от большой терции; минорное — от малой. */
export const chordFamily = (structureId: StructureId): ChordFamily =>
  structureId === 'minor-triad' || structureId === 'minor-seventh' || structureId === 'diminished-triad' || structureId === 'half-diminished-seventh' ? 'minor' : 'major';
const isSeventh = (structureId: StructureId) => structureId === 'dominant-seventh' || structureId === 'major-seventh' || structureId === 'minor-seventh';

const isDiminished = (structureId: StructureId) => structureId === 'diminished-triad' || structureId === 'half-diminished-seventh';

/**
 * Допустим ли рисунок такта для вида аккорда (B2.1): буги — только мажорное трезвучие и доминантсептаккорд;
 * `r5b78` и `r56` — любой аккорд, кроме уменьшённых.
 */
export function patternFits(pattern: string, structureId: StructureId): boolean {
  if (pattern === 'boogie') return structureId === 'major-triad' || structureId === 'dominant-seventh';
  if (pattern === 'r5b78' || pattern === 'r56') return !isDiminished(structureId);
  return true;
}

/** Рисунки такта в форме E (восемь нот) по B2.1; подход — отдельно, он заменяет последнюю ноту. */
export function barTones(pattern: string, structureId: StructureId): readonly Tone[] {
  const family = chordFamily(structureId);
  const third: Tone = family === 'major' ? '3' : 'b3';
  const fifth: Tone = structureId === 'diminished-triad' ? 'b5' : '5';
  const seventh: Tone = structureId === 'major-seventh' ? '7' : 'b7';
  switch (pattern) {
    // Проходящие (`roots-passing`) стоят в хвосте, ноты формы — тоники (B2.3): тоны аккорда для выбора позиции не нужны.
    case 'roots': case 'roots-approach': case 'roots-passing': return ['1', '1', '1', '1', '1', '1', '1', '1'];
    case 'root-fifth': return ['1', '1', fifth, fifth, '1', '1', fifth, fifth];
    case 'octaves': return ['1', '8', '1', '8', '1', '8', '1', '8'];
    case 'boogie': return ['1', '3', '5', '6', 'b7', '6', '5', '3'];
    case 'r5b78': return ['1', '1', '5', '5', seventh, seventh, '8', '8'];
    case 'r56': { const sixth: Tone = family === 'major' ? '6' : 'b7'; return ['1', '1', '5', '5', sixth, sixth, '5', '5']; }
    default: // arpeggio, approach
      return isSeventh(structureId) ? ['1', third, fifth, seventh, '8', seventh, fifth, third] : ['1', third, fifth, third, '1', third, fifth, third];
  }
}

const SCALE_DEGREES = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'] as const;
const OPEN_MIDI: Readonly<Record<StringId, number>> = { E: 28, A: 33, D: 38, G: 43 };

export interface PassingNote { readonly string: StringId; readonly fret: number; readonly name: string; readonly degree: string }

/**
 * Проходящие ноты хвоста такта (B2.3, `roots-passing`): до двух нот гаммы строго между тоникой такта и тоникой следующего
 * такта, в порядке движения; если их больше двух — две последние (ближайшие к следующей тонике). Позиция — на струне
 * следующей тоники; лад меньше порога (1 в `closed`, 0 в `low`) — на струне E. Ступень — от тоники своего аккорда.
 * `scale` — ноты гаммы тональности с написанием; пустой список — хвоста нет, такт играется тониками.
 */
export function passingNotes(
  scale: readonly { readonly name: string; readonly pitchClass: number }[], chordRootPitchClass: number,
  fromMidi: number, toMidi: number, nextTonic: Tonic, low: boolean,
): PassingNote[] {
  const lo = Math.min(fromMidi, toMidi), hi = Math.max(fromMidi, toMidi);
  const between: number[] = [];
  for (let midi = lo + 1; midi < hi; midi++) if (scale.some(note => note.pitchClass === midi % 12)) between.push(midi);
  if (toMidi < fromMidi) between.reverse();
  return between.slice(-2).map(midi => {
    let string = nextTonic.string, fret = midi - OPEN_MIDI[string];
    if (fret < (low ? 0 : 1)) { string = 'E'; fret = midi - OPEN_MIDI.E; }
    if (fret < (low ? 0 : 1) || fret > 24) throw new RangeError('Проходящая нота не помещается на ладах грифа.');
    return { string, fret, name: scale.find(note => note.pitchClass === midi % 12)!.name, degree: SCALE_DEGREES[(((midi - chordRootPitchClass) % 12) + 12) % 12] };
  });
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const NATURAL_PITCH: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Название ноты: буква по номеру (по кругу), знак — чтобы получился нужный класс высоты. */
function spell(letterIndex: number, pitchClass: number): string {
  const letter = LETTERS[((letterIndex % 7) + 7) % 7];
  let accidental = ((((pitchClass - NATURAL_PITCH[letter]) % 12) + 12) % 12);
  if (accidental > 6) accidental -= 12;
  return `${letter}${accidental > 0 ? '♯'.repeat(accidental) : '♭'.repeat(-accidental)}`;
}

/** Название ноты по номеру буквы (C = 0, по кругу) и классу высоты; двойные знаки допустимы (A♭ + малая секунда = B♭♭). */
export const spellNote = spell;
export const letterIndex = (letter: string): number => LETTERS.indexOf(letter as (typeof LETTERS)[number]);

/**
 * Написание подхода (B2.3): буква на одну ниже буквы целевой тоники, знак — чтобы получился полутон.
 * К A — G♯, к D — C♯, к C — B, к F — E, к B♭ — A. Подход сверху (тоника на открытой струне, B0.1) — следующая буква с бемолем: к A — B♭, к E — F.
 */
export function approachName(targetRoot: string, above = false): string {
  const target = parseNote(targetRoot);
  return above ? spell(LETTERS.indexOf(target.letter) + 1, target.pitchClass + 1) : spell(LETTERS.indexOf(target.letter) - 1, target.pitchClass - 1);
}

/** Тон вне структуры аккорда пишется по ступени от его тоники (B0.2): 4 — IV, 6 — VI мажора, ♭7 — ♭VII. */
const OUTSIDE_STEPS: Readonly<Partial<Record<Tone, readonly [number, number]>>> = { '4': [3, 5], '6': [5, 9], b7: [6, 10] };
export function toneName(chordRoot: string, tone: Tone): string | null {
  const steps = OUTSIDE_STEPS[tone];
  if (!steps) return null;
  const root = parseNote(chordRoot);
  return spell(LETTERS.indexOf(root.letter) + steps[0], root.pitchClass + steps[1]);
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
