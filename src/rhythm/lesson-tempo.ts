import type { RhythmBpmUnit, RhythmPreferences } from './model';

/**
 * «Темп занятия» (P14-01, D-046) — одно хранимое значение `preferences.play.bpm`
 * («Темп нового упражнения» в «Настройках»), в четвертях ♩, 40–220 BPM, как на экране игры.
 * Упражнение с историей по-прежнему помнит свой темп; метроном «Ритма» делится темпом
 * с занятием только в четвертях и только на вкладке «Метроном»: темп грува принадлежит проекту.
 */
export const LESSON_TEMPO_MIN = 40;
export const LESSON_TEMPO_MAX = 220;

export function clampLessonTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) throw new RangeError('Темп занятия должен быть числом.');
  return Math.min(LESSON_TEMPO_MAX, Math.max(LESSON_TEMPO_MIN, Math.round(bpm)));
}

interface MetronomeTempoState {
  readonly view: RhythmPreferences['view'];
  readonly bpm: number;
  readonly bpmUnit: RhythmBpmUnit;
}

/** Делится ли текущий темп метронома с занятием: та же единица (♩) и вкладка «Метроном». */
export function sharesLessonTempo(metronome: MetronomeTempoState): boolean {
  return metronome.view === 'metronome' && metronome.bpmUnit === 'quarter';
}

/** Новый темп занятия после явной правки темпа метронома или `null`, если правка его не касается. */
export function lessonTempoAfterMetronomeEdit(metronome: MetronomeTempoState, lessonBpm: number | null): number | null {
  if (!sharesLessonTempo(metronome)) return null;
  const next = clampLessonTempo(metronome.bpm);
  return next === lessonBpm ? null : next;
}

/**
 * Темп занятия, который «Ритм» предлагает взять одной кнопкой, или `null`.
 * Предложение не меняет темп само и не появляется во время звучания или паузы.
 */
export function lessonTempoOffer(metronome: MetronomeTempoState & { readonly transportIdle: boolean }, lessonBpm: number | null): number | null {
  if (lessonBpm === null || !metronome.transportIdle || !sharesLessonTempo(metronome)) return null;
  const offer = clampLessonTempo(lessonBpm);
  // Метроном вне 40–220 уже соответствует занятию на границе диапазона: предлагать нечего.
  return offer === clampLessonTempo(metronome.bpm) ? null : offer;
}
