/**
 * Чистая логика экрана игры: виды, переходы между сегментами, конфигурация звука, тексты
 * прогресса и предложения после самооценки. Без DOM, звука и базы.
 */
import type { PlaybackConfig } from '../../audio/plan';
import type { ConceptId, ExerciseNote, ExercisePlan } from '../../exercises';
import { formatPosition } from './board';
import type { PlayState } from './port';

export type PlayView = 'board' | 'both' | 'tab' | 'memory';
export type Assessment = 'clean' | 'errors' | 'slow';

export const PLAY_VIEWS: readonly { readonly id: PlayView; readonly label: string }[] = Object.freeze([
  { id: 'board', label: 'Гриф крупно' },
  { id: 'both', label: 'Таб + гриф' },
  { id: 'tab', label: 'Таб крупно' },
  { id: 'memory', label: 'По памяти' },
]);

/** Короткие подписи чипов понятий в шапке экрана игры. */
export const CONCEPT_LABELS: Readonly<Record<ConceptId, string>> = Object.freeze({
  'finger-per-fret': 'Палец на лад', 'position-shift': 'Смена позиции', semitone: 'Полутон', octave: 'Октава', unison: 'Унисон',
  degrees: 'Ступени', pentatonic: 'Пентатоника', 'relative-keys': 'Параллельные тональности', 'scale-formula': 'Формула гаммы',
  'shared-notes': 'Общие ноты', 'form-system': 'Система форм', triad: 'Трезвучие', fifth: 'Квинта', sequence: 'Секвенция',
  third: 'Терция', transposition: 'Транспонирование', 'circle-of-fifths': 'Квинтовый круг',
  'seventh-chord': 'Септаккорд', inversion: 'Обращение', progression: 'Последовательность', blues: 'Блюз',
});

export const BPM_MIN = 40;
export const BPM_MAX = 220;
export const BPM_STEP = 4;
export const LADDER_SPAN = 24;

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

/** Фрагмент для петли вокруг стыка: по `radius` нот с каждой стороны. */
export function loopAround(plan: Pick<ExercisePlan, 'notes'> & Partial<Pick<ExercisePlan, 'overlap'>>, junction: Junction, radius = 4): { from: number; toExclusive: number } {
  // Паук и последовательность (overlap: none): петля — два целых сегмента вокруг перехода (такт до и такт после), а не середина такта.
  if (plan.overlap === 'none') {
    const before = plan.notes[junction.index - 1]?.segment ?? 0;
    const after = plan.notes[junction.index]?.segment ?? before;
    const from = plan.notes.findIndex(note => note.segment === before);
    let toExclusive = plan.notes.length;
    for (let index = junction.index; index < plan.notes.length; index++) if (plan.notes[index].segment !== after) { toExclusive = index; break; }
    return { from: Math.max(0, from), toExclusive };
  }
  return { from: Math.max(0, junction.index - radius), toExclusive: Math.min(plan.notes.length, junction.index + radius) };
}

export interface PlaySettings {
  readonly bpm: number;
  readonly countIn: boolean;
  readonly loop: boolean;
  readonly ladder: boolean;
  readonly range: { readonly from: number; readonly toExclusive: number } | null;
}

export const ladderEnd = (bpm: number) => Math.min(BPM_MAX, clampBpm(bpm) + LADDER_SPAN);

/** Конфигурация звука по плану и настройкам транспорта: восьмые, клик четвертями. */
export function playbackConfig(plan: Pick<ExercisePlan, 'positions'>, settings: PlaySettings): PlaybackConfig {
  const bpm = clampBpm(settings.bpm);
  return {
    notes: plan.positions,
    ...(settings.range ? { range: { ...settings.range } } : {}),
    duration: 'eighth',
    bpm,
    countIn: settings.countIn,
    repeat: settings.ladder ? { kind: 'ladder', start: bpm, end: ladderEnd(bpm), step: BPM_STEP, repeatsPerTempo: 1 }
      : settings.loop ? 'infinite' : 'once',
    metronome: { enabled: true, subdivision: 'quarter', mode: 'all' },
  };
}

/**
 * «Сначала услышь» (R-026): один проход того, что сейчас будет играться, — всё упражнение или
 * выбранная петля, восьмыми в текущем темпе. Без отсчёта, без клика и без повтора: это эталон
 * партии, а не игра; отсчёт и метроном начинаются вместе с игрой.
 */
export function listenConfig(plan: Pick<ExercisePlan, 'positions'>, settings: Pick<PlaySettings, 'bpm' | 'range'>): PlaybackConfig {
  return {
    notes: plan.positions,
    ...(settings.range ? { range: { ...settings.range } } : {}),
    duration: 'eighth',
    bpm: clampBpm(settings.bpm),
    countIn: false,
    repeat: 'once',
    metronome: { enabled: false, subdivision: 'quarter', mode: 'all' },
  };
}

/** Строка прогресса во время эталона: «Звучит эталон · нота N из M». */
export function listenProgressText(noteIndex: number | null, total: number, range: PlaySettings['range'] = null): string {
  const loop = range ? ` · петля ${range.from + 1}–${range.toExclusive}` : '';
  return `Звучит эталон · нота ${noteIndex === null ? 0 : noteIndex + 1} из ${total}${loop}`;
}

/** Строка прогресса «Нота N из M · проход K». */
export function progressText(state: Pick<PlayState, 'status' | 'passIndex' | 'totalPasses' | 'pauseReason'>, noteIndex: number | null, total: number,
  extra: { readonly fromStart?: boolean; readonly range?: PlaySettings['range'] } = {}): string {
  const loop = extra.range ? ` · петля ${extra.range.from + 1}–${extra.range.toExclusive}` : '';
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
export function suggestion(assessment: Assessment, context: { bpm: number; view: PlayView; plan: Pick<ExercisePlan, 'notes'> }): Suggestion {
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
      const range = loopAround(context.plan, first);
      return {
        text: `Оставь ${bpm}; включи петлю на ноты ${range.from + 1}–${range.toExclusive} — переход ${formatPosition(first.from.id)} → ${formatPosition(first.to.id)}.`,
        actions: [{ kind: 'loop', range, label: `Петля ${range.from + 1}–${range.toExclusive}` }],
      };
    }
    return { text: `Оставь ${bpm} и сыграй ещё раз по кругу.`, actions: [{ kind: 'loop', range: null, label: 'По кругу' }] };
  }
  const slower = Math.max(BPM_MIN, bpm - BPM_STEP);
  return slower < bpm
    ? { text: `Попробуй ${slower} BPM, отсчёт оставлен.`, actions: [{ kind: 'bpm', bpm: slower, label: `Темп ${slower}` }] }
    : { text: 'Темп минимальный — сыграй по кругу ещё раз.', actions: [] };
}
