/**
 * Подписка на скрытие и возврат вкладки до отмены `signal`.
 * Обработчики выполняются в порядке регистрации: разделы ставят паузу раньше координатора,
 * который затем забывает владельца звука и сохраняет черновики.
 */
export function onPageVisibility(signal: AbortSignal, hidden: () => void, shown?: () => void): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hidden();
    else shown?.();
  }, { signal });
}
