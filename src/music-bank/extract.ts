/**
 * Фрагмент басовой партии из партитуры alphaTab → снимок для упражнения «Фрагмент песни» (P14-04, D-050).
 * Граница с alphaTab остаётся в `src/music-bank`: модуль читает уже загруженную партитуру по структурным
 * полям (типы ниже — подмножество модели alphaTab) и отдаёт простые данные. Неподдерживаемое не исправляется
 * молча: отказ называет такт и причину.
 */
import { keyFromSignature } from '../music/chords';
import { formatMidi } from '../music';
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
  /** Партия ниже E1 (Drop D, 5 струн) перенесена на октаву вверх целиком. */
  readonly octaveUp: boolean;
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

/** Самая высокая нота 4-струнного баса: G2 на 24-м ладу. */
const HIGHEST = 43 + 24;
const LOWEST = 28;
const noteName = (midi: number) => { try { return formatMidi(midi); } catch { return `MIDI ${midi}`; } };

/**
 * Позиция ноты на E–A–D–G 0–24. При стандартном строе без переноса — та же струна, что в партитуре; иначе (другой
 * строй, каподастр, 5–6 струн, перенос на октаву) — ближайшая по ладу к предыдущей ноте, при равенстве — нижняя струна.
 */
function placeNote(midi: number, keepString: boolean, note: NoteLike, previousFret: number, bar: number): [SongEvent[0], number] {
  const candidates = OPEN.map(([string, open]) => ({ string, fret: midi - open })).filter(item => item.fret >= 0 && item.fret <= 24);
  if (!candidates.length) refuse(bar, `нота ${noteName(midi)} вне 4-струнного баса E–A–D–G (лады 0–24).`);
  if (keepString) {
    // alphaTab нумерует струны с 1 от самой низкой.
    const own = OPEN[note.string - 1];
    if (own && midi - own[1] === note.fret && note.fret >= 0 && note.fret <= 24) return [own[0], note.fret];
  }
  candidates.sort((a, b) => Math.abs(a.fret - previousFret) - Math.abs(b.fret - previousFret) || OPEN.findIndex(item => item[0] === a.string) - OPEN.findIndex(item => item[0] === b.string));
  return [candidates[0].string, candidates[0].fret];
}

/** Первый и последний по времени аккорды такта в любой партии (или `null`). */
function chordsOfBar(score: ScoreLike, index: number): { first: string | null; last: string | null } {
  let first: { at: number; name: string } | null = null;
  let last: { at: number; name: string } | null = null;
  for (const track of score.tracks) for (const staff of track.staves) for (const voice of staff.bars[index]?.voices ?? []) {
    for (const beat of voice.beats) {
      const name = beat.chord?.name?.trim().slice(0, 16);
      if (!name) continue;
      if (!first || beat.playbackStart < first.at) first = { at: beat.playbackStart, name };
      if (!last || beat.playbackStart >= last.at) last = { at: beat.playbackStart, name };
    }
  }
  return { first: first?.name ?? null, last: last?.name ?? null };
}

/** Ноты партии в такте до раскладки: начало, длина, нижняя нота аккорда (или пауза), лига. */
interface RawEvent { readonly start: number; readonly length: number; readonly note: NoteLike | null }

function readBar(staff: StaffLike, index: number, number: number): RawEvent[] {
  const events: RawEvent[] = [];
  for (const beat of staff.bars[index]?.voices[0]?.beats ?? []) {
    if (beat.graceType !== 0) continue;
    if (beat.hasTuplet) refuse(number, 'триоли и другие туплеты не поддерживаются.');
    const start = beat.playbackStart / SIXTEENTH, length = beat.playbackDuration / SIXTEENTH;
    if (!Number.isInteger(start) || !Number.isInteger(length) || length < 1) refuse(number, 'длительность короче шестнадцатой или не на сетке шестнадцатых.');
    const lowest = beat.isRest ? null : [...beat.notes].sort((a, b) => a.realValue - b.realValue)[0] ?? null;
    events.push({ start, length, note: lowest });
  }
  return events;
}

/**
 * Такты `fromBar…toBar` (с 1, включительно) партии `trackIndex`: ноты, паузы и длительности в шестнадцатых,
 * аккорд такта (первый в такте из любой партии, без подписи — последний до него), темп и тональность.
 * Связанные ноты сливаются, через тактовую черту — продолжение лиги; из аккорда и двойной ноты берётся нижняя;
 * форшлаги отбрасываются; приёмы (бенды, слайды, ghost) не передаются. Партия ниже E1 (Drop D, 5 струн)
 * переносится на октаву вверх целиком, если вся помещается на гриф.
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
  const raw: RawEvent[][] = [];
  for (let index = fromBar - 1; index < toBar; index++) {
    const master = score.masterBars[index];
    if (master.timeSignatureNumerator !== 4 || master.timeSignatureDenominator !== 4) refuse(index + 1, `размер ${master.timeSignatureNumerator}/${master.timeSignatureDenominator}, поддерживается только 4/4.`);
    raw.push(readBar(staff, index, index + 1));
  }
  // Октава: ниже E1 — весь фрагмент на октаву вверх, если он целиком помещается; иначе отказ с нотой.
  const pitched = raw.flatMap((bar, offset) => bar.filter(event => event.note).map(event => ({ midi: event.note!.realValue, bar: fromBar + offset })));
  const lowest = pitched.reduce<typeof pitched[number] | null>((low, item) => (!low || item.midi < low.midi ? item : low), null);
  const highest = pitched.reduce<typeof pitched[number] | null>((high, item) => (!high || item.midi > high.midi ? item : high), null);
  let shift = 0;
  if (lowest && lowest.midi < LOWEST) {
    if (highest!.midi + 12 > HIGHEST) refuse(lowest.bar, `нота ${noteName(lowest.midi)} ниже E1, а октавой выше не помещается нота ${noteName(highest!.midi)}.`);
    shift = 12;
  }
  if (highest && highest.midi + shift > HIGHEST) refuse(highest.bar, `нота ${noteName(highest.midi)} вне 4-струнного баса E–A–D–G (лады 0–24).`);
  const keepString = shift === 0 && staff.tuning.length === 4 && staff.tuning.every((value, index) => value === STANDARD_TUNING[index]);

  // Аккорд до фрагмента — для тактов без подписи в начале.
  let chord: string | null = null;
  for (let index = fromBar - 2; index >= 0 && chord === null; index--) chord = chordsOfBar(score, index).last;
  const bars: SongBar[] = [];
  let previousFret = 5;
  let total = 0;
  raw.forEach((source, offset) => {
    const number = fromBar + offset;
    type Mutable = [SongEvent[0], number | null, number, number] | [SongEvent[0], number, 0, number, 1];
    const events: Mutable[] = [];
    let at = 0;
    for (const event of source) {
      if (event.start > at) { events.push([null, null, at, event.start - at]); at = event.start; }
      if (event.start < at) continue;
      const end = Math.min(16, event.start + event.length);
      const previous = events[events.length - 1];
      const lastOfBefore = offset > 0 ? bars[offset - 1].events.at(-1) : undefined;
      if (event.note?.isTieDestination && previous && previous[0] !== null) previous[3] += end - event.start;
      else if (event.note?.isTieDestination && !previous && lastOfBefore && lastOfBefore[0] !== null && lastOfBefore[1] !== null) {
        // Лига через тактовую черту: позиция начала лиги, без новой раскладки.
        events.push([lastOfBefore[0], lastOfBefore[1], 0, end - event.start, 1]);
      } else if (!event.note) events.push([null, null, event.start, end - event.start]);
      else {
        const [string, fret] = placeNote(event.note.realValue + shift, keepString, event.note, previousFret, number);
        previousFret = fret;
        events.push([string, fret, event.start, end - event.start]);
      }
      at = end;
    }
    if (at < 16) events.push([null, null, at, 16 - at]);
    total += events.length;
    // Аккорд такта — первый подписанный в нём (смена внутри такта такт не делит); без подписи — звучащий с прошлых
    // тактов; в следующие такты переносится последний.
    const own = chordsOfBar(score, number - 1);
    bars.push({ chord: own.first ?? chord, events: events.map(event => Object.freeze([...event]) as unknown as SongEvent) });
    chord = own.last ?? chord;
  });
  if (total > 512) throw new RangeError('Фрагмент слишком плотный: больше 512 событий.');
  if (!bars.some(bar => bar.events.some(event => event[0] !== null))) throw new RangeError('В выбранных тактах этой партии нет нот.');
  // Знаки при ключе 0 (C / Am) — значение по умолчанию в GP: тональность считается неизвестной.
  const first = staff.bars[fromBar - 1];
  const key = first?.keySignature === undefined || first.keySignature === 0 ? null : keyFromSignature(first.keySignature, first.keySignatureType === 1);
  return { bpm: Math.round(Math.min(220, Math.max(40, bpm))), key, bars, octaveUp: shift === 12 };
}

/** Описание упражнения «Фрагмент песни» из извлечённых тактов: строгая проверка `exercise-v1`. */
export function fragmentSpec(fragment: Pick<SongFragment, 'bpm' | 'key' | 'bars'> & Partial<Pick<SongFragment, 'octaveUp'>>, source: SongSource, title: string): ExerciseSpec {
  // Перенос на октаву виден в названии упражнения — снимок не хранит отдельного поля.
  const mark = ' · октавой выше';
  const named = fragment.octaveUp && !title.includes(mark) ? `${title.slice(0, 80 - mark.length)}${mark}` : title.slice(0, 80);
  return validateExerciseSpec({ version: 'exercise-v1', templateId: 'song-fragment',
    params: { title: named, source, bpm: fragment.bpm, key: fragment.key, bars: fragment.bars } });
}
