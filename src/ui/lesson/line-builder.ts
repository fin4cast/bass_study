/**
 * Панель конструктора «Своя линия» (R-028, B5.4) во вкладке «Библиотека»: тональность и рисунок на каждый такт;
 * в объёме 2 ещё лад, до восьми тактов, тоника и вид аккорда каждого такта.
 * Чистая разметка и редьюсер без DOM и хранилища; состояние держит экран, действия уходят колбэками (`onPlay`, `onSaveExercise`).
 */
import { buildExercise, NOTE_CHOICES, type ExerciseSpec, type LineChord, type LineMode, type ProgressionPattern } from '../../exercises';
import type { RhythmPatternId } from '../../exercises/rhythm';
import {
  addBar, chordsFor, LINE_RHYTHMS, lineSpec, maxBarsFor, newLineDraft, patternsFor, removeBar, setBarKind, setBarPattern, setBarRhythm, setBarStep, setLineMode, setLineRoot, stepChoices,
  VOLUME_TITLES, type LineDraft, type LineVolume,
} from '../../practice/line-builder';
import { escapeHtml as e } from '../html';
import { PATTERN_LABELS } from './material';

export interface BuilderState {
  readonly open: boolean;
  /** Объём конструктора: 1 — четыре такта I–IV–V–I, 2 — своя последовательность до восьми тактов, 3 — все рисунки, ритм на такт, до шестнадцати тактов. */
  readonly volume: LineVolume;
  readonly draft: LineDraft;
  readonly name: string;
  readonly error: string;
}

export const BUILDER_VOLUMES: readonly LineVolume[] = [1, 2, 3];
export const KIND_LABELS: Readonly<Record<string, string>> = { 'major-triad': 'мажор', 'minor-triad': 'минор', 'dominant-seventh': 'доминантсептаккорд (7)', 'minor-seventh': 'минорный септаккорд (m7)', 'major-seventh': 'большой септаккорд (maj7)' };
export const MODE_LABELS: Readonly<Record<LineMode, string>> = { major: 'мажор', minor: 'минор' };

export const initialBuilder = (): BuilderState => ({ open: false, volume: 1, draft: newLineDraft(), name: '', error: '' });
export const toggleBuilder = (state: BuilderState, open = !state.open): BuilderState => ({ ...state, open, error: '' });
export const builderRoot = (state: BuilderState, root: string): BuilderState => ({ ...state, draft: setLineRoot(state.draft, root), error: '' });
export const builderPattern = (state: BuilderState, bar: number, pattern: ProgressionPattern): BuilderState => ({ ...state, draft: setBarPattern(state.draft, bar, pattern), error: '' });
/** Смена объёма начинает с четырёх тактов I–IV–V–I в той же тональности. */
export const builderVolume = (state: BuilderState, volume: LineVolume): BuilderState => (volume === state.volume ? state : { ...state, volume, draft: newLineDraft(state.draft.root), error: '' });

/** Правка объёмов 2 и 3: ошибка границ (меньше двух тактов, больше восьми или шестнадцати) остаётся на панели, черновик не меняется. */
function edit(state: BuilderState, change: (draft: LineDraft) => LineDraft): BuilderState {
  try { return { ...state, draft: change(state.draft), error: '' }; }
  catch (failure) { return { ...state, error: failure instanceof Error ? failure.message : String(failure) }; }
}
export const builderMode = (state: BuilderState, mode: LineMode): BuilderState => edit(state, draft => setLineMode(draft, mode));
export const builderStep = (state: BuilderState, bar: number, step: number): BuilderState => edit(state, draft => setBarStep(draft, bar, step));
export const builderKind = (state: BuilderState, bar: number, chord: LineChord): BuilderState => edit(state, draft => setBarKind(draft, bar, chord, state.volume));
export const builderRhythm = (state: BuilderState, bar: number, rhythm: RhythmPatternId): BuilderState => edit(state, draft => setBarRhythm(draft, bar, rhythm));
export const builderAddBar = (state: BuilderState): BuilderState => edit(state, draft => addBar(draft, state.volume));
export const builderRemoveBar = (state: BuilderState, bar: number): BuilderState => edit(state, draft => removeBar(draft, bar));

/** Описание упражнения по состоянию панели; ошибка проверки шаблона уходит вызывающему. */
export const builderSpec = (state: BuilderState): ExerciseSpec => lineSpec(state.draft);

/** Подпись каждого такта: тоника и цифра аккорда («G · I»). */
export const builderLabels = (draft: LineDraft): readonly string[] => buildExercise(lineSpec(draft)).segments.map(segment => segment.label);

export function builderMarkup(state: BuilderState, titleId: string): string {
  const head = `<div class="ls-builder-head"><div><h3 id="${e(titleId)}">Своя линия</h3><p class="ls-sub">Собери линию (${e(VOLUME_TITLES[state.volume])}): выбери тональность и рисунок каждого такта, сыграй её или сохрани.</p></div>
      <button type="button" class="secondary-button button-compact" data-act="builder-toggle" data-key="builder-toggle" aria-expanded="${state.open}">${state.open ? 'Свернуть' : 'Собрать линию'}</button></div>`;
  if (!state.open) return `<section class="ls-builder" aria-labelledby="${e(titleId)}">${head}</section>`;
  const volume2 = state.volume >= 2;
  const volume3 = state.volume === 3;
  const labels = builderLabels(state.draft);
  const roots = NOTE_CHOICES.map(root => `<option value="${e(root)}"${root === state.draft.root ? ' selected' : ''}>${e(root)}</option>`).join('');
  const steps = stepChoices(state.draft.root);
  const volumes = `<div class="ls-seg" role="group" aria-label="Объём конструктора">${BUILDER_VOLUMES.map(volume => `<button type="button" data-act="builder-volume" data-value="${volume}" data-key="builder-volume:${volume}" aria-pressed="${state.volume === volume}">${volume === 1 ? 'Объём 1 · четыре такта' : volume === 2 ? 'Объём 2 · своя последовательность' : 'Объём 3 · все рисунки и ритм'}</button>`).join('')}</div>`;
  const bars = state.draft.bars.map((bar, index) => {
    const patterns = patternsFor(state.volume, bar.chord).map(pattern => `<option value="${e(pattern)}"${pattern === bar.pattern ? ' selected' : ''}>${e(PATTERN_LABELS[pattern] ?? pattern)}</option>`).join('');
    const chord = volume2
      ? `<label class="ls-field"><span class="sr-only">Тоника аккорда такта ${index + 1}</span><select data-control="builder-step" data-bar="${index}" data-key="builder-step:${index}">${
        steps.map(item => `<option value="${item.step}"${item.step === bar.step ? ' selected' : ''}>${e(item.name)}</option>`).join('')}</select></label>
        <label class="ls-field"><span class="sr-only">Вид аккорда такта ${index + 1}</span><select data-control="builder-kind" data-bar="${index}" data-key="builder-kind:${index}">${
        chordsFor(state.volume).map(kind => `<option value="${e(kind)}"${kind === bar.chord ? ' selected' : ''}>${e(KIND_LABELS[kind])}</option>`).join('')}</select></label>`
      : '';
    const rhythm = volume3
      ? `<label class="ls-field"><span class="sr-only">Ритм такта ${index + 1}</span><select data-control="builder-rhythm" data-bar="${index}" data-key="builder-rhythm:${index}">${
        LINE_RHYTHMS.map(item => `<option value="${e(item.id)}"${item.id === bar.rhythm ? ' selected' : ''}>${e(item.label)}</option>`).join('')}</select></label>`
      : '';
    const remove = volume2 ? `<button type="button" class="secondary-button button-compact" data-act="builder-remove" data-bar="${index}" data-key="builder-remove:${index}" aria-label="Убрать такт ${index + 1}">Убрать</button>` : '';
    return `<li><span class="ls-bb-chord">${e(labels[index])}</span>${chord}
      <label class="ls-field"><span class="sr-only">Рисунок такта ${index + 1}</span><select data-control="builder-pattern" data-bar="${index}" data-key="builder-pattern:${index}">${patterns}</select></label>${rhythm}${remove}</li>`;
  }).join('');
  const modeField = volume2
    ? `<label class="ls-field">Лад <select data-control="builder-mode" data-key="builder-mode">${(['major', 'minor'] as const).map(mode => `<option value="${mode}"${mode === state.draft.mode ? ' selected' : ''}>${e(MODE_LABELS[mode])}</option>`).join('')}</select></label>`
    : '';
  const addBarButton = volume2
    ? `<button type="button" class="secondary-button button-compact" data-act="builder-add" data-key="builder-add"${state.draft.bars.length >= maxBarsFor(state.volume) ? ' aria-disabled="true"' : ''}>Добавить такт</button>`
    : '';
  return `<section class="ls-builder is-open" aria-labelledby="${e(titleId)}">${head}
    <div class="ls-builder-body">
      ${volumes}
      <label class="ls-field">Тональность <select data-control="builder-root" data-key="builder-root">${roots}</select></label>${modeField}
      <ol class="ls-builder-bars" aria-label="Такты линии">${bars}</ol>${addBarButton}
      ${state.error ? `<p class="ls-builder-error" role="alert">${e(state.error)}</p>` : ''}
      <div class="ls-builder-actions"><label class="ls-field">Название <input type="text" maxlength="80" data-builder-name data-key="builder-name" value="${e(state.name)}" placeholder="Моя линия"></label>
        <button type="button" class="primary-button button-compact" data-act="builder-play" data-key="builder-play">▶ Сыграть</button>
        <button type="button" class="secondary-button button-compact" data-act="builder-save" data-key="builder-save">Сохранить как своё упражнение</button></div>
    </div></section>`;
}
