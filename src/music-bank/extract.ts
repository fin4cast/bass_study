/**
 * Фрагмент басовой партии из партитуры alphaTab → снимок для упражнения «Фрагмент песни» (P14-04, D-050).
 * Граница с alphaTab остаётся в `src/music-bank`: модуль читает уже загруженную партитуру по структурным
 * полям (типы ниже — подмножество модели alphaTab) и отдаёт простые данные. Неподдерживаемое не исправляется
 * молча: отказ называет такт и причину.
 */
import { keyFromSignature } from '../music/chords';
import { validateExerciseSpec, type ExerciseSpec, type SongBar, type SongEvent, type SongSource } from '../exercises';

/* ---------- Подмножество модели alphaTab ---------- */
export interface NoteLike { readonly realValue: number; readonly isTieDestination: boolean; readonly string: number; readonly fret: number }
export interface BeatLike {
  readonly isRest: boolean; readonly playbackStart: number; readonly playbackDuration: number; readonly hasTuplet: boolean;
  readonly graceType: number; readonly notes: readonly NoteLike[]; readonly chord?: { readonly name: string } | null;
}
export interface BarLike {
  readonly voices: readonly { readonly beats: readonly BeatLike[] }[];
  readonly keySignature?: number; readonly keySignatureType?: number;
}
export interface StaffLike { readonly isPercussion: boolean; readonly tuning: readonly number[]; readonly bars: readonly BarLike[] }
export interface TrackLike { readonly name: string; readonly staves: readonly StaffLike[] }
export interface MasterBarLike {
  readonly timeSignatureNumerator: number; readonly timeSignatureDenominator: number;
  readonly tempoAutomations?: readonly { readonly value: number }[];
}
export interface ScoreLike { readonly tempo: number; readonly masterBars: readonly MasterBarLike[]; readonly tracks: readonly TrackLike[] }

export interface SongFragment {
  readonly bpm: number;
  /** Тональность по знакам при ключе первого такта («A», «F♯m») или `null`. */
  readonly key: string | null;
  readonly bars: readonly SongBar[];
}

/** Тиков MIDI на четверть в alphaTab; шестнадцатая — 240. */
const QUARTER_TICKS = 960;
const SIXTEENTH = QUARTER_TICKS / 4;
export const MAX_FRAGMENT_BARS = 16;
/** Открытые струны баса E1 A1 D2 G2. */
const OPEN: readonly (readonly ['E' | 'A' | 'D' | 'G', number])[] = [['E', 28], ['A', 33], ['D', 38], ['G', 43]];
/** Стандартный строй 4-струнного баса в порядке alphaTab (от высокой струны к низкой). */
const STANDARD_TUNING = [43, 38, 33, 28];

const refuse = (bar: number, reason: string): never => { throw new RangeError(`Такт ${bar}: ${reason}`); };

/**
 * Позиция ноты на E–A–D–G 0–24. При стандартном строе — та же струна, что в партитуре; иначе (другой строй,
 * каподастр, 5–6 струн) — ближайшая по ладу к предыдущей ноте, при равенстве — нижняя струна.
 */
function placeNote(midi: number, staff: StaffLike, note: NoteLike, previousFret: number, bar: number): [SongEvent[0], number] {
  const candidates = OPEN.map(([string, open]) => ({ string, fret: midi - open })).filter(item => item.fret >= 0 && item.fret <= 24);
  if (!candidates.length) refuse(bar, `нота MIDI ${midi} вне 4-струнного баса E–A–D–G (лады 0–24).`);
  const standard = staff.tuning.length === 4 && staff.tuning.every((value, index) => value === STANDARD_TUNING[index]);
  if (standard) {
    // alphaTab нумерует струны с 1 от самой низкой.
    const own = OPEN[note.string - 1];
    if (own && midi - own[1] === note.fret && note.fret >= 0 && note.fret <= 24) return [own[0], note.fret];
  }
  candidates.sort((a, b) => Math.abs(a.fret - previousFret) - Math.abs(b.fret - previousFret) || OPEN.findIndex(item => item[0] === a.string) - OPEN.findIndex(item => item[0] === b.string));
  return [candidates[0].string, candidates[0].fret];
}

function chordOfBar(score: ScoreLike, index: number): string | null {
  for (const track of score.tracks) for (const staff of track.staves) for (const voice of staff.bars[index]?.voices ?? []) {
    for (const beat of voice.beats) { const name = beat.chord?.name?.trim(); if (name) return name.slice(0, 16); }
  }
  return null;
}

/**
 * Такты `fromBar…toBar` (с 1, включительно) партии `trackIndex`: ноты, паузы и длительности в шестнадцатых,
 * аккорд такта из любой партии, темп и тональность. Связанные ноты сливаются, из аккорда и двойной ноты
 * берётся нижняя, форшлаги отбрасываются, приёмы (бенды, слайды, ghost) не передаются.
 */
export function extractFragment(score: ScoreLike, trackIndex: number, fromBar: number, toBar: number): SongFragment {
  const track = score.tracks[trackIndex];
  if (!track) throw new RangeError('Партия не найдена.');
  const staff = track.staves.find(item => !item.isPercussion);
  if (!staff) throw new RangeError(`Партия «${track.name}» — ударные: фрагмент берётся из струнной партии.`);
  if (!Number.isInteger(fromBar) || !Number.isInteger(toBar) || fromBar < 1 || toBar < fromBar || toBar > score.masterBars.length) throw new RangeError('Выбери такты фрагмента в пределах песни.');
  if (toBar - fromBar + 1 > MAX_FRAGMENT_BARS) throw new RangeError(`Фрагмент — не больше ${MAX_FRAGMENT_BARS} тактов.`);
  // Темп: последняя смена темпа до начала фрагмента; внутри фрагмента темп не меняется.
  let bpm = score.tempo;
  score.masterBars.forEach((master, index) => {
    const value = master.tempoAutomations?.[0]?.value;
    if (value === undefined) return;
    if (index < fromBar) bpm = value;
    else if (index < toBar && index >= fromBar) refuse(index + 1, 'внутри фрагмента меняется темп — выбери такты до или после смены.');
  });
  const bars: SongBar[] = [];
  let previousFret = 5;
  let total = 0;
  for (let index = fromBar - 1; index < toBar; index++) {
    const number = index + 1;
    const master = score.masterBars[index];
    if (master.timeSignatureNumerator !== 4 || master.timeSignatureDenominator !== 4) refuse(number, `размер ${master.timeSignatureNumerator}/${master.timeSignatureDenominator}, поддерживается только 4/4.`);
    const beats = staff.bars[index]?.voices[0]?.beats ?? [];
    const events: [SongEvent[0], number | null, number, number][] = [];
    let at = 0;
    for (const beat of beats) {
      if (beat.graceType !== 0) continue;
      if (beat.hasTuplet) refuse(number, 'триоли и другие туплеты не поддерживаются.');
      const start = beat.playbackStart / SIXTEENTH, length = beat.playbackDuration / SIXTEENTH;
      if (!Number.isInteger(start) || !Number.isInteger(length) || length < 1) refuse(number, 'длительность короче шестнадцатой или не на сетке шестнадцатых.');
      if (start > at) { events.push([null, null, at, start - at]); at = start; }
      if (start < at) continue;
      const end = Math.min(16, start + length);
      const lowest = beat.isRest ? null : [...beat.notes].sort((a, b) => a.realValue - b.realValue)[0] ?? null;
      const previous = events[events.length - 1];
      if (lowest?.isTieDestination && previous && previous[0] !== null) previous[3] += end - start;
      else if (!lowest) events.push([null, null, start, end - start]);
      else {
        const [string, fret] = placeNote(lowest.realValue, staff, lowest, previousFret, number);
        previousFret = fret;
        events.push([string, fret, start, end - start]);
      }
      at = end;
    }
    if (at < 16) events.push([null, null, at, 16 - at]);
    total += events.length;
    bars.push({ chord: chordOfBar(score, index), events: events.map(event => Object.freeze([...event]) as unknown as SongEvent) });
  }
  if (total > 512) throw new RangeError('Фрагмент слишком плотный: больше 512 событий.');
  if (!bars.some(bar => bar.events.some(event => event[0] !== null))) throw new RangeError('В выбранных тактах этой партии нет нот.');
  const first = staff.bars[fromBar - 1];
  const key = first?.keySignature === undefined ? null : keyFromSignature(first.keySignature, first.keySignatureType === 1);
  return { bpm: Math.round(Math.min(220, Math.max(40, bpm))), key, bars };
}

/** Описание упражнения «Фрагмент песни» из извлечённых тактов: строгая проверка `exercise-v1`. */
export function fragmentSpec(fragment: SongFragment, source: SongSource, title: string): ExerciseSpec {
  return validateExerciseSpec({ version: 'exercise-v1', templateId: 'song-fragment',
    params: { title: title.slice(0, 80), source, bpm: fragment.bpm, key: fragment.key, bars: fragment.bars } });
}
