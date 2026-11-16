/**
 * Чистая логика экрана игры: виды, переходы между сегментами, конфигурация звука, тексты
 * прогресса и предложения после самооценки. Без DOM, звука и базы.
 */
import type { ChordTrack, PlaybackConfig } from '../../audio/plan';
import { barChords, type ConceptId, type ExerciseNote, type ExercisePlan, type ExerciseSpec } from '../../exercises';
import { chordVoicing } from '../../music/voicing';
import { barStepRange, buildTimeline, type RhythmPatternId, type Timeline } from '../../exercises/rhythm';
import { grooveHits, presetSwing, type RhythmPresetId } from '../../rhythm/model';
import { formatPosition } from './board';
import type { PlayState } from './port';
import type { TabEvent } from './tab';

export type PlayView = 'board' | 'both' | 'tab' | 'memory';
export type Assessment = 'clean' | 'errors' | 'slow';

/** Лестница подсказок (D-050): у каждого вида своя опора — карта грифа, TAB с картой, только TAB, только пульс. */
export const PLAY_VIEWS: readonly { readonly id: PlayView; readonly label: string; readonly hint: string }[] = Object.freeze([
  { id: 'board', label: 'Гриф', hint: 'Крупный гриф с картой формы, без TAB' },
  { id: 'both', label: 'Таб + гриф', hint: 'TAB двух тактов и гриф с картой' },
  { id: 'tab', label: 'Таб', hint: 'Крупный TAB; на мини-грифе только тоники' },
  { id: 'memory', label: 'По памяти', hint: 'Без нот: пульс, такт, старт и финиш' },
]);

export { ACCOMPANIMENT_CHOICES, COUNT_IN_CHOICES, METRONOME_CHOICES, REFERENCE_MODES } from '../sound-options';
export type { AccompanimentChoice, MetronomeChoice, ReferenceMode } from '../sound-options';
import type { AccompanimentChoice, MetronomeChoice, ReferenceMode } from '../sound-options';

/** Короткие подписи чипов понятий в шапке экрана игры. */
export const CONCEPT_LABELS: Readonly<Record<ConceptId, string>> = Object.freeze({
  'finger-per-fret': 'Палец на лад', 'position-shift': 'Смена позиции', semitone: 'Полутон', octave: 'Октава', unison: 'Унисон',
  degrees: 'Ступени', pentatonic: 'Пентатоника', 'relative-keys': 'Параллельные тональности', 'scale-formula': 'Формула гаммы',
  'shared-notes': 'Общие ноты', 'form-system': 'Система форм', triad: 'Трезвучие', fifth: 'Квинта', sequence: 'Секвенция',
  third: 'Терция', transposition: 'Транспонирование', 'circle-of-fifths': 'Квинтовый круг',
  'seventh-chord': 'Септаккорд', inversion: 'Обращение', progression: 'Последовательность', blues: 'Блюз', 'right-hand': 'Правая рука',
});

export const BPM_MIN = 40;
export const BPM_MAX = 220;
export const BPM_STEP = 4;
/** Лестница: +4 BPM каждые 2 прохода до цели. */
export const LADDER_REPEATS = 2;
export const REFERENCE_VOLUME = 0.65;
export const QUIET_VOLUME = 0.25;

export const isPlayView = (value: unknown): value is PlayView => PLAY_VIEWS.some(view => view.id === value);
export const clampBpm = (bpm: number) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));
export const nextView = (view: PlayView): PlayView | null => {
  const index = PLAY_VIEWS.findIndex(item => item.id === view);
  return index >= 0 && index < PLAY_VIEWS.length - 1 ? PLAY_VIEWS[index + 1].id : null;
};
export const viewLabel = (view: PlayView) => PLAY_VIEWS.find(item => item.id === view)!.label;

/** Русское согласование: 1 лад, 2 лада, 5 ладов. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10, mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export interface Junction {
  /** Индекс первой ноты нового сегмента. */
  readonly index: number;
  readonly from: ExerciseNote;
  readonly to: ExerciseNote;
  /** Смещение по ладам (to − from). */
  readonly shift: number;
}

/** Стыки сегментов в порядке плана. */
export function junctions(plan: Pick<ExercisePlan, 'notes'>): Junction[] {
  const result: Junction[] = [];
  for (let index = 1; index < plan.notes.length; index++) {
    const from = plan.notes[index - 1], to = plan.notes[index];
    if (from.segment !== to.segment) result.push({ index, from, to, shift: to.fret - from.fret });
  }
  return result;
}

/** Ближайший впереди стык (по текущей ноте); после последнего — снова первый. */
export function upcomingJunction(list: readonly Junction[], noteIndex: number | null): Junction | null {
  if (!list.length) return null;
  const at = noteIndex ?? -1;
  return list.find(junction => junction.index > at) ?? list[0];
}

const finger = (note: ExerciseNote) => note.finger === null ? '' : ` (палец ${note.finger})`;

/** «сдвиг на 2 лада», «сдвиг вниз на 3 лада», «без сдвига». */
export function shiftText(shift: number): string {
  if (shift === 0) return 'без сдвига';
  const size = Math.abs(shift);
  return `сдвиг${shift < 0 ? ' вниз' : ''} на ${size} ${plural(size, 'лад', 'лада', 'ладов')}`;
}

/** «G/7 (палец 3) → сдвиг на 2 лада → G/9 (палец 3)». На другой струне сдвиг не пишется. */
export function junctionText(junction: Junction): string {
  const from = `${formatPosition(junction.from.id)}${finger(junction.from)}`;
  const to = `${formatPosition(junction.to.id)}${finger(junction.to)}`;
  return junction.from.string === junction.to.string ? `${from} → ${shiftText(junction.shift)} → ${to}` : `${from} → ${to}`;
}

/** Петля в тактах вокруг стыка: такт, где кончается сегмент, и такт, где начинается следующий. */
export function loopAround(timeline: Pick<Timeline, 'steps'>, junction: Pick<Junction, 'index'>): { fromBar: number; toBar: number } {
  const barOf = (note: number) => timeline.steps.find(step => step.note === note && !step.echo)?.bar ?? 0;
  const fromBar = barOf(junction.index - 1);
  return { fromBar, toBar: Math.max(fromBar, barOf(junction.index)) + 1 };
}

export interface PlaySettings {
  readonly bpm: number;
  /** Цель темпа: лестница идёт до неё; по умолчанию — цель освоения шага. */
  readonly targetBpm: number;
  readonly countInBars: 0 | 1 | 2;
  readonly loop: boolean;
  readonly ladder: boolean;
  /** Петля в тактах [fromBar, toBar). */
  readonly range: { readonly fromBar: number; readonly toBar: number } | null;
  readonly rhythm: RhythmPatternId;
  readonly echo: boolean;
  readonly groove: RhythmPresetId | null;
  readonly reference: ReferenceMode;
  readonly metronome: MetronomeChoice;
  /** Громкость клика и подложки, 0–1. */
  readonly click: number;
  readonly grooveVolume: number;
  /** Аккорды такта под линию (общая настройка звука, на зачёт шага не влияет) и их громкость. */
  readonly accompaniment: AccompanimentChoice;
  readonly accompanimentVolume: number;
}

export const DEFAULT_PLAY_SETTINGS: PlaySettings = Object.freeze({
  bpm: 72, targetBpm: 96, countInBars: 1, loop: true, ladder: false, range: null, rhythm: 'eighths', echo: false, groove: null,
  reference: 'auto', metronome: 'beats', click: 0.45, grooveVolume: 0.6, accompaniment: 'off', accompanimentVolume: 0.5,
});

/* ---------- Подход (D-050): проходы до оценки ---------- */

/** Как играли подход: ритм, эхо и подложка. */
export interface ApproachPractice { readonly rhythm: RhythmPatternId; readonly echo: boolean; readonly groove: RhythmPresetId | null }

/** Итог подхода до оценки: живёт через перезапуски (петля, новый старт), пока подход не оценён. */
export interface ApproachTally {
  readonly passes: number;
  readonly lastBpm: number;
  /** Активное время по аудиочасам, включая недоигранные проходы. */
  readonly activeMs: number;
  /** Подсказка последних двух проходов: 3 — «Гриф» … 0 — «По памяти». */
  readonly hints: readonly number[];
  readonly wholePass: boolean;
  readonly practice: ApproachPractice;
}

/** Неполный первый проход оценивается, если сыграно хотя бы столько; короче — не записывается. */
export const PARTIAL_PASS_MIN_MS = 5000;

const samePlayPractice = (a: ApproachPractice, b: ApproachPractice) => a.rhythm === b.rhythm && a.echo === b.echo && a.groove === b.groove;

/**
 * Начало запуска: неоценённый подход с тем же «как играть» продолжается (проходы и время складываются,
 * проход целиком — только если и новый запуск без петли); иначе начинается новый. `lost` — прежний
 * подход с проходами или временем пропал без оценки.
 */
export function continueApproach(previous: ApproachTally | null, next: { readonly bpm: number; readonly wholePass: boolean; readonly practice: ApproachPractice }): { tally: ApproachTally; lost: boolean } {
  if (previous && samePlayPractice(previous.practice, next.practice)) return { tally: { ...previous, wholePass: previous.wholePass && next.wholePass }, lost: false };
  return {
    tally: { passes: 0, lastBpm: next.bpm, activeMs: 0, hints: [], wholePass: next.wholePass, practice: next.practice },
    lost: !!previous && (previous.passes > 0 || previous.activeMs >= PARTIAL_PASS_MIN_MS),
  };
}

/**
 * Остановка: недоигранное время прохода добавляется к подходу. Без завершённых проходов подход оценивается
 * как неполный проход (не целиком), если сыграно не меньше `PARTIAL_PASS_MIN_MS`; иначе оценки нет.
 */
export function stopApproach(tally: ApproachTally, partialMs: number, partialHint: number): ApproachTally | null {
  const activeMs = tally.activeMs + Math.max(0, Math.round(partialMs));
  if (tally.passes > 0) return { ...tally, activeMs };
  if (activeMs < PARTIAL_PASS_MIN_MS) return null;
  return { ...tally, activeMs, hints: [partialHint], wholePass: false };
}

/** Лестница возможна, если цель выше текущего темпа. */
export const ladderAvailable = (settings: Pick<PlaySettings, 'bpm' | 'targetBpm'>) => clampBpm(settings.targetBpm) > clampBpm(settings.bpm);

/** Шкала прохода по настройкам ритма; «эхо» и рисунок меняют шкалу. */
export const timelineFor = (plan: ExercisePlan, settings: Pick<PlaySettings, 'rhythm' | 'echo'>) => buildTimeline(plan, { pattern: settings.rhythm, echo: settings.echo });

/** События TAB и строки ритма по шагам шкалы. */
export function tabEvents(plan: Pick<ExercisePlan, 'notes'>, timeline: Pick<Timeline, 'steps'>): TabEvent[] {
  const ROWS = ['G', 'D', 'A', 'E'] as const;
  return timeline.steps.map((step, index) => {
    const note = step.note === null ? null : plan.notes[step.note];
    return { index, bar: step.bar, beatInBar: step.beatInBar, durationBeats: step.grids / 4, echo: step.echo, tie: step.tie,
      tab: note ? { row: ROWS.indexOf(note.string), string: note.string, fret: note.fret } : null };
  });
}

/** Громкости шин по виду: эталон «авто» молчит в «По памяти»; «эхо» включает эталон, иначе повторять нечего. */
export function volumesFor(settings: Pick<PlaySettings, 'reference' | 'echo' | 'click' | 'grooveVolume' | 'metronome' | 'accompanimentVolume'>, view: PlayView) {
  const reference = settings.echo ? 'on' : settings.reference;
  const bass = reference === 'on' ? REFERENCE_VOLUME : reference === 'quiet' ? QUIET_VOLUME : reference === 'off' ? 0 : view === 'memory' ? 0 : REFERENCE_VOLUME;
  return { bass, click: settings.click, groove: settings.grooveVolume, chords: settings.accompanimentVolume };
}

/** Эталон слышен при этих настройках и виде. */
export const referenceAudible = (settings: Parameters<typeof volumesFor>[0], view: PlayView) => volumesFor(settings, view).bass > 0;

const METRONOME_CONFIG: Readonly<Record<MetronomeChoice, NonNullable<PlaybackConfig['metronome']>>> = {
  beats: { enabled: true, subdivision: 'quarter', mode: 'all' },
  eighths: { enabled: true, subdivision: 'eighth', mode: 'all' },
  'two-four': { enabled: true, subdivision: 'quarter', mode: 'two-four' },
  gap: { enabled: true, subdivision: 'quarter', mode: 'gap-2-2' },
  off: { enabled: false, subdivision: 'quarter', mode: 'all' },
};

/**
 * Аккорды по тактам прохода для аккомпанемента (B6): у «эха» аккорд повторяемого такта; петля берёт свои такты.
 * `null` — режим выключен или у материала нет аккордов по тактам.
 */
export function chordTrack(spec: ExerciseSpec, timeline: Pick<Timeline, 'bars' | 'echo'>, range: PlaySettings['range'], mode: AccompanimentChoice): ChordTrack | null {
  if (mode === 'off') return null;
  const chords = barChords(spec);
  if (!chords) return null;
  const scale = timeline.echo ? 2 : 1;
  const from = range?.fromBar ?? 0, to = range?.toBar ?? timeline.bars;
  const bars = Array.from({ length: Math.max(0, to - from) }, (_, offset) => {
    const chord = chords[Math.floor((from + offset) / scale)] ?? null;
    return chord ? chordVoicing(chord) : null;
  });
  return bars.length ? { mode, bars } : null;
}
/** У материала есть аккорды по тактам: без них управление аккордами недоступно. */
export const hasChords = (spec: ExerciseSpec): boolean => barChords(spec) !== null;

/** Конфигурация звука: шкала шагов, петля по тактам, метроном, отсчёт, свинг, подложка и аккорды. */
export function playbackConfig(plan: Pick<ExercisePlan, 'positions' | 'spec'>, timeline: Timeline, settings: PlaySettings): PlaybackConfig {
  const bpm = clampBpm(settings.bpm);
  const range = settings.range ? barStepRange(timeline, settings.range.fromBar, settings.range.toBar) : null;
  return {
    notes: plan.positions,
    steps: timeline.steps.map(step => ({ note: step.note, grids: step.grids, audible: step.audible, tie: step.tie })),
    ...(range ? { range } : {}),
    bpm,
    countInBars: settings.countInBars,
    repeat: settings.ladder && ladderAvailable(settings) ? { kind: 'ladder', start: bpm, end: clampBpm(settings.targetBpm), step: BPM_STEP, repeatsPerTempo: LADDER_REPEATS }
      : settings.loop ? 'infinite' : 'once',
    metronome: METRONOME_CONFIG[settings.metronome],
    swing: settings.groove ? presetSwing(settings.groove) : timeline.swing,
    groove: settings.groove ? grooveHits(settings.groove) : null,
    chords: chordTrack(plan.spec, timeline, settings.range, settings.accompaniment),
  };
}

/**
 * «Сначала услышь» (R-026): один проход того, что будет играться (вся шкала или петля), в текущем темпе
 * и ритме, без отсчёта, клика, подложки и эха; громкость эталона хост включает на время прослушивания.
 */
export function listenConfig(plan: ExercisePlan, settings: PlaySettings): PlaybackConfig {
  const timeline = timelineFor(plan, { rhythm: settings.rhythm, echo: false });
  // У «эха» такты удвоены: петля переводится в такты шкалы без эха.
  const scale = settings.echo ? 2 : 1;
  const range = settings.range ? barStepRange(timeline, Math.floor(settings.range.fromBar / scale), Math.ceil(settings.range.toBar / scale)) : null;
  return {
    notes: plan.positions,
    steps: timeline.steps.map(step => ({ note: step.note, grids: step.grids, audible: true, tie: step.tie })),
    ...(range ? { range } : {}),
    bpm: clampBpm(settings.bpm),
    countInBars: 0,
    repeat: 'once',
    metronome: { enabled: false, subdivision: 'quarter', mode: 'all' },
    swing: settings.groove ? presetSwing(settings.groove) : timeline.swing,
  };
}

export const loopText = (range: PlaySettings['range']) => !range ? '' : range.toBar - range.fromBar === 1 ? `такт ${range.fromBar + 1}` : `такты ${range.fromBar + 1}–${range.toBar}`;

/** Строка прогресса во время эталона: «Звучит эталон · нота N из M». */
export function listenProgressText(noteIndex: number | null, total: number, range: PlaySettings['range'] = null): string {
  const loop = range ? ` · петля: ${loopText(range)}` : '';
  return `Звучит эталон · нота ${noteIndex === null ? 0 : noteIndex + 1} из ${total}${loop}`;
}

/** Строка прогресса «Нота N из M · проход K». */
export function progressText(state: Pick<PlayState, 'status' | 'passIndex' | 'totalPasses' | 'pauseReason'>, noteIndex: number | null, total: number,
  extra: { readonly fromStart?: boolean; readonly range?: PlaySettings['range'] } = {}): string {
  const loop = extra.range ? ` · петля: ${loopText(extra.range)}` : '';
  const passes = state.totalPasses !== null && state.totalPasses > 1 ? ` из ${state.totalPasses}` : '';
  const pass = ` · проход ${state.passIndex + 1}${passes}`;
  switch (state.status) {
    case 'stopped': return `Нота 0 из ${total}${extra.fromStart ? ' · с начала' : ''}${loop}`;
    case 'counting': return `Отсчёт · нота 0 из ${total}${loop}`;
    case 'finished': return `Нота ${noteIndex === null ? total : noteIndex + 1} из ${total} · проход завершён${loop}`;
    case 'paused': {
      const why = state.pauseReason === 'hidden' ? 'пауза: вкладка скрыта' : state.pauseReason === 'manual' || !state.pauseReason ? 'пауза' : 'пауза: сбой звука';
      return `Нота ${noteIndex === null ? 0 : noteIndex + 1} из ${total}${pass}${loop} · ${why}`;
    }
    default: return `Нота ${noteIndex === null ? 0 : noteIndex + 1} из ${total}${pass}${loop}`;
  }
}

export type SuggestionAction =
  | { readonly kind: 'bpm'; readonly bpm: number; readonly label: string }
  | { readonly kind: 'loop'; readonly range: PlaySettings['range']; readonly label: string }
  | { readonly kind: 'view'; readonly view: PlayView; readonly label: string };

export interface Suggestion { readonly text: string; readonly actions: readonly SuggestionAction[] }

/** Предложение следующего шага после самооценки. Вид переключает только пользователь — кнопкой. */
export function suggestion(assessment: Assessment, context: { bpm: number; view: PlayView; plan: Pick<ExercisePlan, 'notes'>; timeline: Pick<Timeline, 'steps'> }): Suggestion {
  const bpm = clampBpm(context.bpm);
  if (assessment === 'clean') {
    const faster = Math.min(BPM_MAX, bpm + BPM_STEP);
    const view = nextView(context.view);
    const actions: SuggestionAction[] = [];
    if (faster > bpm) actions.push({ kind: 'bpm', bpm: faster, label: `Темп ${faster}` });
    if (view) actions.push({ kind: 'view', view, label: `Вид «${viewLabel(view)}» →` });
    const text = faster > bpm ? `Дальше: темп ${faster}${view ? ' или следующий вид' : ''}.` : view ? 'Дальше: следующий вид.' : 'Темп максимальный — попробуй следующее упражнение.';
    return { text, actions };
  }
  if (assessment === 'errors') {
    const first = junctions(context.plan)[0];
    if (first) {
      const range = loopAround(context.timeline, first);
      return {
        text: `Оставь ${bpm}; включи петлю на ${loopText(range)} — переход ${formatPosition(first.from.id)} → ${formatPosition(first.to.id)} — или кликни трудный такт в TAB.`,
        actions: [{ kind: 'loop', range, label: `Петля: ${loopText(range)}` }],
      };
    }
    return { text: `Оставь ${bpm}; выбери трудный такт кликом по TAB или клавишей L.`, actions: [] };
  }
  const slower = Math.max(BPM_MIN, bpm - BPM_STEP);
  return slower < bpm
    ? { text: `Попробуй ${slower} BPM, отсчёт оставлен.`, actions: [{ kind: 'bpm', bpm: slower, label: `Темп ${slower}` }] }
    : { text: 'Темп минимальный — сыграй по кругу ещё раз.', actions: [] };
}
