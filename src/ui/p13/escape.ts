/**
 * Временная копия общего экранирования для новых экранов P13 до слияния этапа 5 уборки.
 * Сигнатура совпадает с `escapeHtml` из `src/ui/html.ts` соседней ветки; при подключении (фаза B)
 * этот файл удаляется, а импорты переводятся на общий модуль.
 */
export function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
