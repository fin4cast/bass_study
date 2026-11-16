/**
 * Панель конструктора «Своя линия» (R-028, B5.4) во вкладке «Библиотека»: тональность и рисунок на каждый такт.
 * Чистая разметка и редьюсер без DOM и хранилища; состояние держит экран, действия уходят колбэками (`onPlay`, `onSaveExercise`).
 */
import { buildExercise, NOTE_CHOICES, type ExerciseSpec, type ProgressionPattern } from '../../exercises';
import { lineSpec, newLineDraft, patternsFor, setBarPattern, setLineRoot, VOLUME_TITLES, type LineDraft } from '../../practice/line-builder';
import { escapeHtml as e } from '../html';
import { PATTERN_LABELS } from './material';

export interface BuilderState {
  readonly open: boolean;
  readonly draft: LineDraft;
  readonly name: string;
  readonly error: string;
}

export const initialBuilder = (): BuilderState => ({ open: false, draft: newLineDraft(), name: '', error: '' });
export const toggleBuilder = (state: BuilderState, open = !state.open): BuilderState => ({ ...state, open, error: '' });
export const builderRoot = (state: BuilderState, root: string): BuilderState => ({ ...state, draft: setLineRoot(state.draft, root), error: '' });
export const builderPattern = (state: BuilderState, bar: number, pattern: ProgressionPattern): BuilderState => ({ ...state, draft: setBarPattern(state.draft, bar, pattern), error: '' });

/** Описание упражнения по состоянию панели; ошибка проверки шаблона уходит вызывающему. */
export const builderSpec = (state: BuilderState): ExerciseSpec => lineSpec(state.draft);

/** Подпись каждого такта: тоника и цифра аккорда («G · I»). */
export const builderLabels = (draft: LineDraft): readonly string[] => buildExercise(lineSpec(draft)).segments.map(segment => segment.label);

export function builderMarkup(state: BuilderState, titleId: string): string {
  const head = `<div class="ls-builder-head"><div><h3 id="${e(titleId)}">Своя линия</h3><p class="ls-sub">Собери линию из четырёх тактов (${e(VOLUME_TITLES[1])}): выбери тональность и рисунок каждого такта, сыграй её или сохрани.</p></div>
      <button type="button" class="secondary-button button-compact" data-act="builder-toggle" data-key="builder-toggle" aria-expanded="${state.open}">${state.open ? 'Свернуть' : 'Собрать линию'}</button></div>`;
  if (!state.open) return `<section class="ls-builder" aria-labelledby="${e(titleId)}">${head}</section>`;
  const labels = builderLabels(state.draft);
  const roots = NOTE_CHOICES.map(root => `<option value="${e(root)}"${root === state.draft.root ? ' selected' : ''}>${e(root)}</option>`).join('');
  const bars = state.draft.bars.map((bar, index) => `<li><span class="ls-bb-chord">${e(labels[index])}</span>
      <label class="ls-field"><span class="sr-only">Рисунок такта ${index + 1}</span><select data-control="builder-pattern" data-bar="${index}" data-key="builder-pattern:${index}">${
    patternsFor(1, bar.chord).map(pattern => `<option value="${e(pattern)}"${pattern === bar.pattern ? ' selected' : ''}>${e(PATTERN_LABELS[pattern] ?? pattern)}</option>`).join('')}</select></label></li>`).join('');
  return `<section class="ls-builder is-open" aria-labelledby="${e(titleId)}">${head}
    <div class="ls-builder-body">
      <label class="ls-field">Тональность <select data-control="builder-root" data-key="builder-root">${roots}</select></label>
      <ol class="ls-builder-bars" aria-label="Такты линии">${bars}</ol>
      ${state.error ? `<p class="ls-builder-error" role="alert">${e(state.error)}</p>` : ''}
      <div class="ls-builder-actions"><label class="ls-field">Название <input type="text" maxlength="80" data-builder-name data-key="builder-name" value="${e(state.name)}" placeholder="Моя линия"></label>
        <button type="button" class="primary-button button-compact" data-act="builder-play" data-key="builder-play">▶ Сыграть</button>
        <button type="button" class="secondary-button button-compact" data-act="builder-save" data-key="builder-save">Сохранить как своё упражнение</button></div>
    </div></section>`;
}
