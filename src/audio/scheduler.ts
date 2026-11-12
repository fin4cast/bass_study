/**
 * Общая политика времени живых планировщиков (последовательности, метроном и ритм).
 * События ставятся в Web Audio на LOOKAHEAD вперёд по часам AudioContext; таймер основного
 * потока раз в INTERVAL_MS лишь досылает следующие. Опоздание таймера до ~0,29 с (фон, сборка
 * мусора, RDP) поглощается запасом без потерь. Если следующее событие уже должно было прозвучать
 * раньше чем LATE_MARGIN назад, сетка не сдвигается и не «догоняется»: проигрыватель встаёт
 * на паузу 'timing' ровно на этом событии. Остановленные браузером часы — пауза 'interrupted'.
 */
export const LOOKAHEAD = .3;
/** Запас от текущего времени до первого события после запуска или продолжения. */
export const LEAD = .035;
export const LATE_MARGIN = .006;
const INTERVAL_MS = 20;

export type ScheduleCheck = 'ready' | 'interrupted' | 'late';

/** Можно ли досылать события, начиная с nextAt; иначе — причина паузы. */
export function checkSchedule(context: BaseAudioContext, nextAt: number): ScheduleCheck {
  if (context.state !== 'running') return 'interrupted';
  return nextAt < context.currentTime - LATE_MARGIN ? 'late' : 'ready';
}

/** Граница досылки: всё, что начинается не позже неё, уже должно быть в Web Audio. */
export const scheduleHorizon = (context: BaseAudioContext) => context.currentTime + LOOKAHEAD;

/** Таймер досылки одного проигрывателя; повторный start() не создаёт второй таймер. */
export function createTicker(pump: () => void) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  return {
    start() { stop(); timer = setInterval(pump, INTERVAL_MS); },
    stop,
  };
}
