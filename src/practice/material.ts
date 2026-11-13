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
  const params = spec.params as Readonly<Record<string, unknown>>;
  const order = Object.keys(getExerciseTemplate(spec.templateId).defaults);
  return [spec.templateId, ...order.map(key => token(params[key]))].join('.');
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
