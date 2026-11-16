/**
 * Тождество материала упражнения (D-049). Ключ встроенного упражнения учитывает параметры: форма A и форма B,
 * Am и Em — разные материалы со своим прогрессом, видом и местом в плане. Чистый модуль без интерфейса.
 */
import { getExerciseTemplate, type ExerciseSpec } from '../exercises';
import type { UserExercise } from './library';

/** Каноничная строка значения параметра: знаки альтерации латиницей, только `[A-Za-z0-9_-]`. */
function token(value: unknown): string {
  if (Array.isArray(value)) return value.map(token).join('-');
  return String(value).replaceAll('♯', 's').replaceAll('#', 's').replaceAll('♭', 'b').replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Идентификатор материала: шаблон и значения параметров в порядке параметров шаблона по умолчанию,
 * например `pentatonic-form.A.minor-pentatonic.penta-b`. Одинаковые описания дают один идентификатор.
 */
export function materialId(spec: ExerciseSpec): string {
  // Фрагмент песни: файл (первые 16 знаков SHA-256), партия и такты — снимок нот в ключ не входит (D-050).
  if (spec.templateId === 'song-fragment') {
    const { sha256, trackIndex, fromBar, toBar } = spec.params.source;
    return `song-fragment.${sha256.slice(0, 16)}.${trackIndex}.${fromBar}-${toBar}`;
  }
  // «Своя линия»: состав тактов входит в ключ хешем, чтобы ключ не зависел от числа тактов и укладывался в предел (B5.5).
  if (spec.templateId === 'line') {
    const { root, mode, position, bars } = spec.params;
    return ['line', token(root), mode, position, fnv1a64(lineBarsText(bars))].join('.');
  }
  const params = spec.params as Readonly<Record<string, unknown>>;
  const order = Object.keys(getExerciseTemplate(spec.templateId).defaults);
  return [spec.templateId, ...order.map(key => token(params[key]))].join('.');
}

const LINE_CHORD_CODES: Readonly<Record<string, string>> = { 'major-triad': 'M', 'minor-triad': 'm', 'dominant-seventh': '7', 'minor-seventh': 'm7', 'major-seventh': 'M7' };
/** Каноническая строка состава тактов: такты через точку, такт — `<step><код>_<рисунок>_<ритм>`; в полях нет `_` и `.`, строка инъективна. */
export function lineBarsText(bars: readonly { readonly step: number; readonly chord: string; readonly pattern: string; readonly rhythm: string }[]): string {
  return bars.map(bar => `${bar.step}${LINE_CHORD_CODES[bar.chord]}_${bar.pattern}_${bar.rhythm}`).join('.');
}
/** FNV-1a, 64 бита, по байтам UTF-8; шестнадцатеричная запись из 16 знаков. */
export function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, '0');
}

export const sameSpec = (a: ExerciseSpec, b: ExerciseSpec): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Ключ упражнения в библиотеке и результатах: `user:<id>` для своего описания, иначе `builtin:<материал>`. */
export function exerciseKey(spec: ExerciseSpec, userExercises: readonly UserExercise[] = []): string {
  const own = userExercises.find(exercise => sameSpec(exercise.spec, spec));
  return own ? `user:${own.id}` : `builtin:${materialId(spec)}`;
}

/** Шаблон встроенного ключа (`builtin:<шаблон>.<…>`) или null для своего упражнения. */
export function builtinTemplateOf(key: string): string | null {
  return key.startsWith('builtin:') ? key.slice('builtin:'.length).split('.')[0] : null;
}
