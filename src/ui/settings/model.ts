/**
 * «Настройки» (VIS-09 r1, утверждён вариант B «Разделы»): чистая модель без DOM.
 * Состояние приходит от приложения; модуль только описывает его словами и готовит следующие значения.
 */

export type ThemeChoice = 'light' | 'dark';
export type PlayView = 'board' | 'tabBoard' | 'tab' | 'memory';
export type BoardLabels = 'notes' | 'degrees' | 'fingers';
export interface PlayDefaults {
  /** С какого вида открываются упражнения. */
  readonly view: PlayView;
  /** Вид для нового упражнения; `null` — тот же, что `view`. */
  readonly newExerciseView: PlayView | null;
  readonly countIn: boolean;
  readonly labels: BoardLabels;
  /** Темп нового упражнения, четверти в минуту. */
  readonly bpm: number;
}
export type SaveStatus = 'saved' | 'saving' | { readonly error: string };
export type WriterState = 'owner' | 'other-tab';
export interface BackupCounts {
  readonly history: number;
  /** Свои упражнения; до P13-04 могут отсутствовать. */
  readonly exercises?: number;
  readonly rhythm: number;
  readonly drafts: number;
}
export interface SettingsState {
  readonly theme: ThemeChoice;
  readonly playDefaults: PlayDefaults;
  readonly saveStatus: SaveStatus;
  readonly writer: WriterState;
  /** Версия приложения, например `1.4.0`. */
  readonly version: string;
  /** Версия данных (схема хранения). */
  readonly dataVersion: number;
  /** Что сейчас сохранено — для состава копии. */
  readonly counts?: BackupCounts;
  /** Короткая сводка аудиовхода для списка разделов, например «Подключён». */
  readonly inputSummary?: string;
}

/** Предпросмотр копии: ничего не меняет. `payload` возвращается приложению в `onConfirmRestore` без изменений. */
export interface BackupPreview<Payload = unknown> {
  readonly kind: 'preview';
  readonly fileName: string;
  readonly sizeBytes?: number;
  /** Когда сделана копия, ISO-время. */
  readonly createdAt?: string | null;
  readonly counts: BackupCounts;
  readonly current: BackupCounts;
  readonly payload?: Payload;
}
export type BackupRejectionReason = 'version' | 'invalid' | 'too-large' | 'read';
export interface BackupRejection {
  readonly kind: 'error';
  readonly reason: BackupRejectionReason;
  readonly fileName?: string;
  readonly fileVersion?: number | null;
  readonly message?: string;
}
/** `null` — файл не выбран (окно выбора закрыто). */
export type BackupChoice = BackupPreview | BackupRejection | null;

export type SectionId = 'look' | 'lesson' | 'data' | 'input' | 'about';
export interface SectionInfo { readonly id: SectionId; readonly title: string; readonly short: string; readonly lead: string }
export const SECTIONS: readonly SectionInfo[] = Object.freeze(([
  { id: 'look', title: 'Оформление', short: 'Оформление', lead: 'Как выглядит тренажёр.' },
  { id: 'lesson', title: 'Занятие', short: 'Занятие', lead: 'С чего начинается каждое упражнение. Внутри упражнения всё можно поменять.' },
  { id: 'data', title: 'Данные и резервная копия', short: 'Данные', lead: 'Твои занятия хранятся только здесь. Копия — способ их не потерять.' },
  { id: 'input', title: 'Аудиовход', short: 'Аудиовход', lead: 'Проверка: доходит ли звук баса до компьютера.' },
  { id: 'about', title: 'О приложении', short: 'О приложении', lead: 'Версия, документация и лицензии.' },
] satisfies SectionInfo[]).map(section => Object.freeze(section)));

export const VIEW_LABELS: Readonly<Record<PlayView, string>> = Object.freeze({ board: 'Гриф крупно', tabBoard: 'Таб + гриф', tab: 'Таб крупно', memory: 'По памяти' });
export const LABEL_LABELS: Readonly<Record<BoardLabels, string>> = Object.freeze({ notes: 'Ноты', degrees: 'Ступени', fingers: 'Пальцы' });
export const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = Object.freeze({ light: 'Светлая', dark: 'Тёмная' });
export const BPM_MIN = 40;
export const BPM_MAX = 200;
export const BPM_STEP = 4;

export type SaveKind = 'ok' | 'saving' | 'error' | 'other';
export function saveKind(state: Pick<SettingsState, 'saveStatus' | 'writer'>): SaveKind {
  if (state.writer === 'other-tab') return 'other';
  if (typeof state.saveStatus === 'object') return 'error';
  return state.saveStatus === 'saving' ? 'saving' : 'ok';
}
export const SAVE_TEXT: Readonly<Record<SaveKind, string>> = Object.freeze({ ok: 'Сохранено', saving: 'Сохраняем…', error: 'Не сохранено', other: 'Только просмотр' });
export const SAVE_DETAIL: Readonly<Record<SaveKind, string>> = Object.freeze({
  ok: 'Сохранено: изменения записываются сразу.',
  saving: 'Сохраняем…',
  error: 'Последнее изменение не записано — см. сообщение вверху.',
  other: 'Сейчас данные записывает другая вкладка.',
});
export const errorText = (status: SaveStatus) => (typeof status === 'object' ? status.error : '');

export const clampBpm = (bpm: number) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(Number.isFinite(bpm) ? bpm : BPM_MIN)));
export function stepBpm(defaults: PlayDefaults, delta: number): PlayDefaults {
  return Object.freeze({ ...defaults, bpm: clampBpm(defaults.bpm + delta) });
}
export function withDefaults(defaults: PlayDefaults, patch: Partial<PlayDefaults>): PlayDefaults {
  const next = { ...defaults, ...patch };
  if (!(next.view in VIEW_LABELS)) throw new RangeError('Неизвестный вид экрана игры.');
  if (next.newExerciseView !== null && !(next.newExerciseView in VIEW_LABELS)) throw new RangeError('Неизвестный вид нового упражнения.');
  if (!(next.labels in LABEL_LABELS)) throw new RangeError('Неизвестные подписи на грифе.');
  return Object.freeze({ ...next, countIn: Boolean(next.countIn), bpm: clampBpm(next.bpm) });
}

/** Краткая сводка под названием каждого раздела в списке слева. */
export function sectionSummaries(state: SettingsState): Readonly<Record<SectionId, string>> {
  const defaults = state.playDefaults;
  return Object.freeze({
    look: THEME_LABELS[state.theme],
    lesson: `${VIEW_LABELS[defaults.view]} · отсчёт ${defaults.countIn ? '4' : 'выкл'}`,
    data: SAVE_TEXT[saveKind(state)],
    input: state.inputSummary?.trim() || 'Проверка сигнала',
    about: `Версия ${state.version}`,
  });
}

export function plural(count: number, one: string, few: string, many: string) {
  const mod10 = Math.abs(count) % 10, mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Строки состава копии (без разметки). */
export function countLines(counts: BackupCounts | undefined): readonly string[] {
  if (!counts) return Object.freeze(['настройки и тема', 'история занятий', 'ритм-проекты', 'незаконченная практика']);
  return Object.freeze([
    'настройки и тема',
    `история занятий — ${counts.history} ${plural(counts.history, 'запись', 'записи', 'записей')}`,
    ...(counts.exercises === undefined ? [] : [`свои упражнения — ${counts.exercises}`]),
    `ритм-проекты — ${counts.rhythm}`,
    `незаконченная практика — ${counts.drafts}`,
  ]);
}

/** Сравнение «в копии / сейчас» для предпросмотра и сколько записей истории пропадёт при замене. */
export function compareCounts(copy: BackupCounts, current: BackupCounts) {
  const rows: { label: string; copy: string; now: string }[] = [
    { label: 'История занятий', copy: String(copy.history), now: String(current.history) },
  ];
  if (copy.exercises !== undefined || current.exercises !== undefined) rows.push({ label: 'Свои упражнения', copy: String(copy.exercises ?? 0), now: String(current.exercises ?? 0) });
  rows.push(
    { label: 'Ритм-проекты', copy: String(copy.rhythm), now: String(current.rhythm) },
    { label: 'Незаконченная практика', copy: String(copy.drafts), now: String(current.drafts) },
    { label: 'Настройки и тема', copy: 'есть', now: 'есть' },
  );
  return Object.freeze({ rows: Object.freeze(rows.map(row => Object.freeze(row))), lostHistory: Math.max(0, current.history - copy.history) });
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
}
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** Дата копии по местному времени: «10 ноября 2026». */
export function formatCopyDate(iso: string | null | undefined) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Честный отказ: почему копия не подходит. Старые версии данных не загружаются (D-042). */
export function rejectionText(rejection: BackupRejection, dataVersion: number) {
  const file = rejection.fileName ? `«${rejection.fileName}»` : 'Эта копия';
  if (rejection.reason === 'version') return Object.freeze({
    title: 'Эта копия не подходит',
    text: `${file} сделана для ${rejection.fileVersion ? `версии данных ${rejection.fileVersion}` : 'другой версии данных'}, а сейчас версия ${dataVersion}.`,
    note: 'Старые копии не загружаются: когда меняется устройство данных, сохранённое начинается заново. Подойдёт копия, скачанная в этой версии.',
  });
  if (rejection.reason === 'too-large') return Object.freeze({ title: 'Файл слишком большой', text: `${file} больше допустимого размера копии.`, note: rejection.message ?? '' });
  if (rejection.reason === 'read') return Object.freeze({ title: 'Файл не прочитался', text: `${file} не удалось прочитать.`, note: rejection.message ?? '' });
  return Object.freeze({ title: 'Это не копия тренажёра', text: `${file} повреждена или сделана не этим приложением.`, note: rejection.message ?? '' });
}
