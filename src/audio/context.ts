/**
 * Один AudioContext для всех собственных звуковых адаптеров приложения. Частота отсчётов —
 * та, что выбрал браузер для устройства вывода: принудительная частота мешает подключать
 * аудиовход в браузерах, которые не пересчитывают MediaStream между частотами.
 * Адаптеры не закрывают общий контекст; каждый включает его сам из действия пользователя
 * через resumeAudio(), а координатор звука останавливает часы, когда владельца больше нет.
 */
let shared: AudioContext | null = null;
let suspendTimer: ReturnType<typeof setTimeout> | null = null;

/** Пауза перед остановкой часов: короткие хвосты и окна анализаторов успевают дойти до тишины. */
const IDLE_SUSPEND_MS = 250;

export function audioContext(): AudioContext {
  if (!shared || shared.state === 'closed') shared = new AudioContext({ latencyHint: 'interactive' });
  return shared;
}

function cancelSuspend() {
  if (suspendTimer !== null) clearTimeout(suspendTimer);
  suspendTimer = null;
}

/** Включает часы контекста; отменяет ещё не выполненную остановку после ухода владельца. */
export function resumeAudio(context: AudioContext = audioContext()): Promise<void> {
  cancelSuspend();
  return context.resume();
}

/** Владельца звука нет: часы останавливаются, если до этого никто не вызвал resumeAudio(). */
export function suspendAudioWhenIdle(): void {
  cancelSuspend();
  const context = shared;
  if (!context) return;
  suspendTimer = setTimeout(() => {
    suspendTimer = null;
    if (shared === context && context.state === 'running') void context.suspend().catch(() => undefined);
  }, IDLE_SUSPEND_MS);
}
