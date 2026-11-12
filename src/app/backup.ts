/**
 * Резервная копия в «Настройках» (D-042): распознавание версии файла до полной проверки и скачивание JSON.
 * Полная проверка и замена — у хранилища (`prepareImport` → `restorePrepared`).
 */

/** Версия данных копии тренажёра, если файл похож на неё; `undefined` — не копия или не JSON. */
export function backupVersion(json: string): number | undefined {
  let value: unknown;
  try { value = JSON.parse(json); } catch { return undefined; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return raw.format === 'bass-study-backup' && Number.isInteger(raw.schemaVersion) ? raw.schemaVersion as number : undefined;
}

/** Имя файла копии по локальной дате: `bass-study-backup-2026-11-12.json`. */
export function backupFileName(prefix: string, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${prefix}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Скачивание JSON через временную ссылку; ссылка освобождается после старта загрузки. */
export function downloadJson(json: string, prefix: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backupFileName(prefix);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
