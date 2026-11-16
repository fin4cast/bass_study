/**
 * Подписи звука экрана игры (D-050): эталон, метроном и отсчёт. Одна таблица для панели «Звук и ритм»
 * экрана игры и для умолчаний в «Настройках», чтобы слова совпадали.
 */
export type ReferenceMode = 'auto' | 'on' | 'quiet' | 'off';
export const REFERENCE_MODES: readonly { readonly id: ReferenceMode; readonly label: string }[] = Object.freeze([
  { id: 'auto', label: 'Авто' }, { id: 'on', label: 'Вкл' }, { id: 'quiet', label: 'Тихо' }, { id: 'off', label: 'Выкл' },
]);
export type AccompanimentChoice = 'off' | 'hold' | 'beats';
/** Аккорды такта под линию (R-028, B6): «Держать» — один аккорд на такт, «Доли» — четыре коротких. */
export const ACCOMPANIMENT_CHOICES: readonly { readonly id: AccompanimentChoice; readonly label: string; readonly short: string }[] = Object.freeze([
  { id: 'off', label: 'Выкл', short: '' }, { id: 'hold', label: 'Держать', short: 'аккорды держать' }, { id: 'beats', label: 'Доли', short: 'аккорды по долям' },
]);
export type MetronomeChoice = 'beats' | 'eighths' | 'two-four' | 'gap' | 'off';
export const METRONOME_CHOICES: readonly { readonly id: MetronomeChoice; readonly label: string; readonly short: string }[] = Object.freeze([
  { id: 'beats', label: 'Доли', short: 'доли' },
  { id: 'eighths', label: 'Доли и «и»', short: 'восьмые' },
  { id: 'two-four', label: 'На 2 и 4', short: '2 и 4' },
  { id: 'gap', label: 'Такты тишины (2 + 2)', short: 'такты тишины' },
  { id: 'off', label: 'Выкл', short: 'без клика' },
]);
export const COUNT_IN_CHOICES: readonly { readonly bars: 0 | 1 | 2; readonly label: string }[] = Object.freeze([
  { bars: 0, label: 'Нет' }, { bars: 1, label: '1 такт' }, { bars: 2, label: '2 такта' },
]);
