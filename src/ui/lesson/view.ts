/**
 * Раздел «Занятие» (VIS-10 r2, утверждён 2026-11-12): вкладки «Сегодня», «Библиотека», «Основы» и один план.
 * Экран не хранит данные: состояние приходит через `update(state)`, изменения уходят колбэками.
 * План меняется только по подтверждению владельца: после `onPlanChange` экран ждёт следующий `update`.
 */
import './mini-board.css';
import './lesson.css';
import { configureSpec, NOTE_CHOICES, templateOptions, type ExerciseSpec, type TemplateOption } from '../../exercises';
import { conceptForExerciseConcept, getConcept, conceptBoard, parseConceptText, type ConceptBoard, type ConceptRole } from '../../practice/concepts';
import { contentExerciseOf, moveStep, plannedMinutes, removeStep, type DayPlan, type PlanStepContent } from '../../practice/plan';
import { renderPageHeader } from '../../app/page-frame';
import { bindPageTabs } from '../page-tabs';
import { escapeHtml as e } from '../html';
import { CONCEPT_LABELS, exercisePlan, materialLabel, STRUCTURE_LABELS } from './material';
import { boardSvg, boardWindow, type BoardNote } from './mini-board';
import {
  basicsBadge, basicsCourse, basicsStepPosition, checkContent, contentMinutes, currentBasicsStep, DEFAULT_LIBRARY, exerciseBoard, heroModel,
  configuredItems, LIBRARY_CONCEPTS, LIBRARY_STRUCTURES, libraryItems, libraryModel, nextExerciseStep, pendingMatches, planRows, planStrip,
  searchBasics, setStepMinutes, stepMaterial, stepTitle, togglePlanContent, toggleStepEar, transposedLineContent,
  type BasicsLevel, type BasicsStep, type BasicsView, type LessonState, type LessonTab, type LibraryCategory, type LibraryControls,
} from './model';
import { CATEGORY_ORDER, CATEGORY_TITLES } from '../../practice/library';
import { currentLineStep, pathBadge, pathModel, stageLine, stageTransitions, type PathStep } from './path';
import {
  builderAddBar, builderKind, builderMarkup, builderMode, builderPattern, builderRemoveBar, builderRhythm, builderRoot, builderSpec, builderStep, builderVolume, initialBuilder, toggleBuilder, type BuilderState,
} from './line-builder';
import type { LineChord, ProgressionPattern } from '../../exercises';
import type { RhythmPatternId } from '../../exercises/rhythm';

export type { LessonState, LessonTab } from './model';

export interface LessonOptions {
  /** Открыть экран игры или проверки; `stepId` — шаг плана, если запуск из плана. */
  readonly onPlay: (content: PlanStepContent, stepId: string | null) => void;
  /** Новый проверенный план; экран покажет его после подтверждения через `update`. */
  readonly onPlanChange: (plan: DayPlan) => void;
  readonly onTabChange: (tab: LessonTab) => void;
  /** «Играть от» — тоника шаблонов без своего материала; `null` — материал шаблона по умолчанию. */
  readonly onPlayFromChange: (root: string | null) => void;
  /** Карточка понятия справочника R-027 по её идентификатору. */
  readonly onOpenConcept: (id: string) => void;
  readonly onSaveExercise?: (spec: ExerciseSpec, name: string) => void;
  /** «Путь | Знания» в «Основах»; выбор запоминается. */
  readonly onBasicsViewChange?: (view: BasicsView) => void;
  /** «▶ Играть» у шага программы: ID шага и индекс варианта. */
  readonly onPlayStep?: (stepId: string, variant: number) => void;
  /** «Уже умею» у блока: включить или снять отметку. */
  readonly onSkipBlock?: (blockId: string, skipped: boolean) => void;
  readonly state?: LessonState;
}

const TABS: readonly { key: LessonTab; label: string; hint: string }[] = [
  { key: 'today', label: 'Сегодня', hint: 'Сел с басом — вот что играть сейчас.' },
  { key: 'library', label: 'Библиотека', hint: 'Играй сразу или добавляй в план на сегодня.' },
  { key: 'basics', label: 'Основы', hint: 'Цели — шаги к навыку, уровни — теория по порядку. Ничего не заблокировано.' },
];
const ROOTS = NOTE_CHOICES;
/** Объём конструктора из атрибута кнопки: 1, 2 или 3. */
const volumeOf = (value: string | undefined): 1 | 2 | 3 => (value === '3' ? 3 : value === '2' ? 2 : 1);
const KIND_LABEL = { concept: 'понятие', exercise: 'упражнение', check: 'проверка' } as const;
const plural = (count: number, one: string, few: string, many: string) => {
  const a = count % 10, b = count % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};
const ROLE_KIND: Readonly<Record<ConceptRole, BoardNote['kind']>> = { root: 'root', target: 'b', shared: 'shared', plain: 'plain' };
let instances = 0;

export function mountLesson(container: HTMLElement, options: LessonOptions) {
  const id = `lesson-${++instances}`;
  const controller = new AbortController();
  const listen = { signal: controller.signal };
  let state: LessonState | null = options.state ?? null;
  let tab: LessonTab = state?.tab ?? 'today';
  let editing = false;
  let library: LibraryControls = DEFAULT_LIBRARY;
  let basicsLevel: string | null = null;
  let basicsStep: string | null = null;
  /** Вид «Основ» до подтверждения настройки и выбор на пути: этап и варианты шагов. */
  let basicsMode: BasicsView | null = null;
  let pathStage: number | null = null;
  const pathPicks = new Map<string, number>();
  let saveDraft: { key: string; name: string } | null = null;
  /** Конструктор «Своей линии» во вкладке «Библиотека». */
  let builder: BuilderState = initialBuilder();
  /** Выбранная тональность переноса у карточек своих линий (не хранится). */
  const transposeRoots = new Map<string, string>();
  /** Материал, настроенный на встроенных карточках библиотеки (по id карточки), и открытая строка настройки. */
  let cardSpecs = new Map<string, ExerciseSpec>();
  let configuring: string | null = null;
  let cardError: { card: string; param: string; message: string } | null = null;
  let pendingNotice: string | null = null;
  let flashStep: string | null = null;
  let disposed = false;
  /** Ссылки кнопок на содержимое шага: описания упражнений не попадают в DOM. */
  let refs = new Map<string, PlanStepContent>();
  let refCount = 0;
  const ref = (content: PlanStepContent) => { const key = `c${++refCount}`; refs.set(key, content); return key; };

  container.classList.add('lesson-view');
  container.innerHTML = `
    ${renderPageHeader('lesson', {
      id: `${id}-heading`,
      navigation: `<div class="workspace-tabs" role="tablist" aria-label="Занятие">${TABS.map(item => `<button type="button" role="tab" id="${id}-tab-${item.key}" aria-controls="${id}-panel-${item.key}" aria-selected="false" tabindex="-1">${e(item.label)}<small class="tab-badge" data-badge="${item.key}"></small></button>`).join('')}</div>`,
    })}
    ${TABS.map(item => `<div class="ls-panel" id="${id}-panel-${item.key}" role="tabpanel" aria-labelledby="${id}-tab-${item.key}" tabindex="-1" hidden>
      <div class="ls-ctx"><p class="ls-sub">${e(item.hint)}</p>${item.key === 'basics' ? `<div class="ls-search" data-search><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg><input type="search" placeholder="Найти упражнение или понятие" aria-label="Найти упражнение или понятие" autocomplete="off" data-search-input aria-controls="${id}-search-results" aria-expanded="false"><div class="ls-search-results" id="${id}-search-results" data-search-results hidden></div></div>` : ''}</div>
      <div class="ls-region" data-region="${item.key}"></div>
    </div>`).join('')}
    <p class="ls-toast" role="status" aria-live="polite" data-toast></p>`;

  const tabList = container.querySelector<HTMLElement>('[role="tablist"]')!;
  const regions = Object.fromEntries(TABS.map(item => [item.key, container.querySelector<HTMLElement>(`[data-region="${item.key}"]`)!])) as Record<LessonTab, HTMLElement>;
  const toastBox = container.querySelector<HTMLElement>('[data-toast]')!;
  const searchInput = container.querySelector<HTMLInputElement>('[data-search-input]')!;
  const searchResults = container.querySelector<HTMLElement>('[data-search-results]')!;
  let toastTimer: number | undefined;

  const tabs = bindPageTabs<LessonTab>(tabList, {
    keys: TABS.map(item => item.key), signal: controller.signal,
    select(key) { selectTab(key); },
  });

  function selectTab(key: LessonTab, notify = true) {
    const changed = key !== tab;
    tab = key;
    tabs.setSelected(key);
    if (changed) container.closest<HTMLElement>('main, [data-scroll]')?.scrollTo?.({ top: 0 });
    if (changed && notify) options.onTabChange(key);
  }

  function toast(text: string) {
    toastBox.textContent = text;
    toastBox.classList.add('is-on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastBox.classList.remove('is-on'), 2800);
  }

  function changePlan(next: DayPlan, notice: string) {
    try {
      pendingNotice = notice;
      options.onPlanChange(next);
    } catch (failure) {
      pendingNotice = null;
      toast(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function togglePlan(content: PlanStepContent) {
    if (!state) return;
    try {
      const result = togglePlanContent(state.plan, content, state.userExercises);
      const title = stepTitle(content, state.userExercises);
      if (result.action === 'added') flashStep = result.plan.steps.at(-1)!.id;
      changePlan(result.plan, result.action === 'added' ? `Добавлено в план «Сегодня»: ${title} · ${contentMinutes(content)} мин` : `Убрано из плана: ${title}`);
    } catch (failure) { toast(failure instanceof Error ? failure.message : String(failure)); }
  }

  const inPlan = (content: PlanStepContent) => !!state && pendingMatches(state.plan, content, state.userExercises).length > 0;

  /* ---------- Общие куски разметки ---------- */

  function board(notes: readonly BoardNote[], frets: readonly number[], options: { width: number; marker: number; labels?: boolean; minSpan?: number; aria?: string; decorative?: boolean }) {
    const window = boardWindow(frets, options.minSpan ?? 6);
    const span = window.fretMax - window.fretMin + 1;
    const cell = (options.width - 48) / span;
    const marker = Math.max(9, Math.min(options.marker, cell * .82));
    return `<div class="ls-board">${boardSvg({ ...window, notes, width: options.width, marker, labels: options.labels ?? true, ariaLabel: options.aria, decorative: options.decorative })}</div>`;
  }
  const legend = (items: readonly { kind: BoardNote['kind']; label: string }[]) =>
    `<div class="ls-legend">${items.map(item => `<span><i class="mb-swatch mb-swatch-${item.kind}" aria-hidden="true"></i>${e(item.label)}</span>`).join('')}</div>`;
  function exerciseBoardMarkup(spec: ExerciseSpec, width: number, marker: number, labels: 'name' | 'finger' = 'name') {
    const data = exerciseBoard(spec, labels);
    const plan = exercisePlan(spec);
    const aria = `Гриф: ${plan.title}, позиции ${[...new Set(plan.notes.map(note => note.id.replace(':', '/')))].join(', ')}`;
    return board(data.notes, data.frets, { width, marker, aria }) + legend(data.legend);
  }
  const addButton = (content: PlanStepContent, small = true, label?: string) => {
    const on = inPlan(content);
    const title = state ? stepTitle(content, state.userExercises) : '';
    return `<button type="button" class="secondary-button${small ? ' button-compact' : ''} ls-add" data-act="toggle-plan" data-ref="${ref(content)}" data-key="add:${e(keyOf(content))}" aria-pressed="${on}" aria-label="${e(`${on ? 'Убрать из плана' : 'Добавить в план'}: ${title}`)}">${on ? '✓ в плане' : e(label ?? `+ в план · ${contentMinutes(content)} мин`)}</button>`;
  };
  function keyOf(content: PlanStepContent) { return JSON.stringify(content).slice(0, 400); }

  /* ---------- Сегодня ---------- */

  function renderToday(current: LessonState) {
    const hero = heroModel(current);
    const stage = stageLine(current.programState);
    const lineStep = currentLineStep(current.programState);
    const transitions = stageTransitions(current.program, current.programState);
    const rows = planRows(current.plan, current.records, current.userExercises);
    const total = plannedMinutes(current.plan);
    const done = rows.filter(row => row.status === 'done').reduce((sum, row) => sum + row.minutes, 0);
    const items = libraryItems(current.playFrom, current.userExercises);

    let heroMarkup: string;
    if (hero.mode === 'first-run') {
      const content = hero.content!;
      heroMarkup = `<div><span class="ls-eyebrow">${e(hero.eyebrow)}</span><h2>${e(hero.title)}</h2><p class="ls-sub">${e(hero.meta)}</p></div>
        <div class="ls-actions"><button type="button" class="primary-button button-large" data-act="play" data-ref="${ref(content)}" data-step="${e(hero.stepId ?? '')}" data-key="hero-play">Начать</button>
          <button type="button" class="ls-link" data-act="go-path" data-key="hero-path">Уже умею: выбрать, с чего начать</button></div>`;
    } else if (hero.mode === 'empty') {
      heroMarkup = `<div><span class="ls-eyebrow">${e(hero.eyebrow)}</span><h2>${e(hero.title)}</h2><p class="ls-sub">${e(hero.meta)}</p></div>
        <div class="ls-actions"><button type="button" class="secondary-button" data-act="go-library" data-key="hero-library">Открыть библиотеку →</button></div>`;
    } else {
      const content = hero.content!;
      const spec = contentExerciseOf(content);
      heroMarkup = `<div class="ls-hero-top"><div><span class="ls-eyebrow">${e(hero.eyebrow)}</span><h2>${e(hero.title)}</h2><p class="ls-sub">${e(hero.meta)}</p></div>
          <div class="ls-chips">${hero.concepts.map(concept => `<span class="ls-chip ls-chip-concept">${e(concept)}</span>`).join('')}</div></div>
        <div class="ls-actions"><button type="button" class="primary-button button-large" data-act="play" data-ref="${ref(content)}" data-step="${e(hero.stepId ?? '')}" data-key="hero-play">▶ ${content.kind === 'check' ? 'Проверь себя' : 'Играть'}</button>
          ${hero.stats.length ? `<div class="ls-stats">${hero.stats.map(stat => `<span><b>${e(stat.value)}</b>${e(stat.label)}</span>`).join('')}</div>` : '<div class="ls-stats"><span class="ls-sub">Отметку «Чисто / С ошибками / Не успевал» поставишь после прохода.</span></div>'}</div>
        ${spec ? exerciseBoardMarkup(spec, 700, 28) : ''}`;
    }

    const planMarkup = `<div class="ls-plan-head"><h2>План на сегодня · ${e(total)} мин</h2><span class="ls-sub">${e(rows.length)} ${plural(rows.length, 'шаг', 'шага', 'шагов')}</span></div>
      ${done ? `<div><div class="ls-meter" aria-hidden="true"><i style="width:${Math.round(done / total * 100)}%"></i></div><span class="ls-tiny">Сыграно ${e(done)} из ${e(total)} мин</span></div>` : ''}
      ${rows.length ? `<ol class="ls-steps">${rows.map(row => `<li class="ls-step is-${row.status}${flashStep === row.id ? ' is-new' : ''}">
        <span class="ls-dot" aria-hidden="true">${row.status === 'done' ? '✓' : row.status === 'current' ? '▶' : e(row.index + 1)}</span>
        <div class="ls-step-body"><div class="ls-step-title">${e(row.title)}</div>
          <div class="ls-step-meta"><span>${e(row.meta)}</span>${row.status === 'done' ? `<span>· ${e(row.mark ?? 'выполнено')}</span>` : row.status === 'current' ? '<span>· сейчас</span>' : ''}${row.check ? `<button type="button" class="ls-opt" data-act="ear" data-step="${e(row.id)}" data-key="ear:${e(row.id)}" aria-pressed="${row.ear}"${row.earAvailable && row.status !== 'done' ? '' : ' disabled'} title="${row.earAvailable ? 'Опция: сначала прозвучат тоника и нота, потом отвечаешь ступенью' : 'Слух пока только для пентатоник и трезвучий'}">+ слух</button>` : ''}</div></div>
        <div class="ls-step-side"><span class="ls-min">${e(row.minutes)} мин</span>
          ${row.status !== 'done' && !editing ? `<button type="button" class="ls-mini" data-act="play-step" data-step="${e(row.id)}" data-key="play:${e(row.id)}" aria-label="${e(`${row.check ? 'Начать проверку' : 'Играть'}: ${row.title}`)}">▶</button>` : ''}
          ${editing ? `<span class="ls-edit">
            <button type="button" class="ls-mini" data-act="minutes" data-step="${e(row.id)}" data-delta="-1" data-key="min-:${e(row.id)}" aria-label="${e(`Меньше минут: ${row.title}`)}"${row.minutes <= 1 ? ' disabled' : ''}>−</button>
            <button type="button" class="ls-mini" data-act="minutes" data-step="${e(row.id)}" data-delta="1" data-key="min+:${e(row.id)}" aria-label="${e(`Больше минут: ${row.title}`)}"${row.minutes >= 60 ? ' disabled' : ''}>+</button>
            <button type="button" class="ls-mini" data-act="move" data-step="${e(row.id)}" data-delta="-1" data-key="up:${e(row.id)}" aria-label="${e(`Выше: ${row.title}`)}"${row.status === 'done' || row.first ? ' disabled' : ''}>↑</button>
            <button type="button" class="ls-mini" data-act="move" data-step="${e(row.id)}" data-delta="1" data-key="down:${e(row.id)}" aria-label="${e(`Ниже: ${row.title}`)}"${row.status === 'done' || row.last ? ' disabled' : ''}>↓</button>
            <button type="button" class="ls-mini" data-act="remove" data-step="${e(row.id)}" data-key="del:${e(row.id)}" aria-label="${e(`Убрать из плана: ${row.title}`)}">✕</button></span>` : ''}
        </div></li>`).join('')}</ol>` : `<p class="ls-empty">План пуст — добавь упражнение из библиотеки.</p>`}
      <div class="ls-plan-tools">${rows.length ? `<button type="button" class="secondary-button button-compact" data-act="edit" data-key="edit" aria-pressed="${editing}">${editing ? 'Готово' : 'Изменить план'}</button>` : ''}<button type="button" class="secondary-button button-compact" data-act="go-library" data-key="plan-library">+ из библиотеки</button></div>`;

    regions.today.innerHTML = `<div class="ls-today-grid">
        <div class="ls-col"><section class="ls-card ls-hero feature-panel" aria-label="Главное действие">${heroMarkup}</section>
          ${stage ? `<p class="ls-stage-line" data-stage-line>${e(stage)}</p>` : ''}
          ${transitions.map(text => `<p class="ls-stage-line" data-stage-transition>${e(text)}</p>`).join('')}
          ${lineStep && lineStep.volume ? `<p class="ls-stage-line" data-line-step><span>Своя линия: ${e(lineStep.title)}</span> <button type="button" class="secondary-button button-compact" data-act="path-build" data-step-id="${e(lineStep.id)}" data-volume="${lineStep.volume}" data-key="today-build" aria-label="${e(`Построить: ${lineStep.title}`)}">▶ Построить</button></p>` : ''}</div>
        <section class="ls-card ls-plan${editing ? ' is-editing' : ''}" aria-label="План на сегодня">${planMarkup}</section>
      </div>
      <section class="ls-card ls-libstrip" aria-label="Библиотека"><strong>Библиотека</strong><span class="ls-sub">${e(items.length)} ${plural(items.length, 'упражнение', 'упражнения', 'упражнений')} · ${CATEGORY_ORDER.length} категорий</span>
        <div class="ls-chips">${CATEGORY_ORDER.map(category => `<button type="button" class="ls-chip ls-chip-link" data-act="go-category" data-category="${e(category)}" data-key="cat-strip:${e(category)}">${e(CATEGORY_TITLES[category])}</button>`).join('')}</div>
        <button type="button" class="secondary-button" data-act="go-library" data-key="strip-library">Открыть библиотеку →</button></section>`;
  }

  /* ---------- Библиотека ---------- */

  /** Строка настройки встроенной карточки: статические списки параметров шаблона. */
  function configRow(cardId: string, spec: ExerciseSpec, configured: boolean) {
    const params = spec.params as Record<string, unknown>;
    const label = (option: TemplateOption, value: string | number) => option.param === 'structureId'
      ? STRUCTURE_LABELS[value as keyof typeof STRUCTURE_LABELS] ?? String(value)
      : option.values.find(item => item.value === value)?.label ?? String(value);
    const fields = templateOptions(spec.templateId).map(option => {
      const error = cardError?.card === cardId && cardError.param === option.param ? cardError.message : null;
      const errorId = `${id}-cfg-${cardId}-${option.param}-error`;
      const values = option.values.map(item => `<option value="${e(item.value)}"${String(params[option.param]) === String(item.value) ? ' selected' : ''}>${e(label(option, item.value))}</option>`).join('');
      return `<label class="ls-field">${e(option.label)} <select data-control="card-param" data-card="${e(cardId)}" data-param="${e(option.param)}" data-key="card-param:${e(cardId)}:${e(option.param)}"${error ? ` aria-invalid="true" aria-describedby="${e(errorId)}"` : ''}>${values}</select>${error ? `<small class="ls-field-error" id="${e(errorId)}">${e(error)}</small>` : ''}</label>`;
    }).join('');
    const reset = configured ? `<button type="button" class="ls-link" data-act="card-reset" data-card="${e(cardId)}" data-key="card-reset:${e(cardId)}">Сбросить</button>` : '';
    return `<div class="ls-config" id="${id}-cfg-${e(cardId)}" role="group" aria-label="Настройка упражнения">${fields}${reset}</div>`;
  }

  function renderLibrary(current: LessonState) {
    const model = libraryModel(current, library, cardSpecs);
    const strip = planStrip(current.plan, current.userExercises);
    const structureOptions = [`<option value="">любая</option>`, ...LIBRARY_STRUCTURES.map(structure => `<option value="${e(structure)}"${library.structureId === structure ? ' selected' : ''}>${e(STRUCTURE_LABELS[structure])}</option>`)].join('');
    const rootOptions = [`<option value="">как в шаблоне</option>`, ...ROOTS.map(root => `<option value="${e(root)}"${current.playFrom !== null && sameRoot(current.playFrom, root) ? ' selected' : ''}>${e(root)}</option>`)].join('');
    const filters = `<div class="ls-filters" role="group" aria-label="Фильтры библиотеки">
        <label class="ls-field" title="Тоника для шаблонов без своего материала; список не фильтрует">Играть от <select data-control="play-from" data-key="ctl-play-from">${rootOptions}</select></label>
        <label class="ls-field">Структура <select data-control="structure" data-key="ctl-structure">${structureOptions}</select></label>
        <div class="ls-seg" role="group" aria-label="Статус">${([['all', 'Все'], ['new', 'Не играл'], ['played', 'В работе']] as const).map(([value, label]) => `<button type="button" data-act="status" data-value="${value}" data-key="status:${value}" aria-pressed="${library.status === value}">${label}</button>`).join('')}</div>
        <label class="ls-field ls-end">Порядок <select data-control="sort" data-key="ctl-sort"><option value="recommended"${library.sort === 'recommended' ? ' selected' : ''}>сначала рекомендуемые</option><option value="played"${library.sort === 'played' ? ' selected' : ''}>сначала в работе</option><option value="catalogue"${library.sort === 'catalogue' ? ' selected' : ''}>по порядку каталога</option></select></label>
      </div>
      <div class="ls-filters"><div class="ls-field"><span>Понятие</span><div class="ls-chips">${LIBRARY_CONCEPTS.map(concept => `<button type="button" class="ls-chip ls-chip-filter" data-act="concept-filter" data-value="${e(concept)}" data-key="cf:${e(concept)}" aria-pressed="${library.concept === concept}">${e(CONCEPT_LABELS[concept])}</button>`).join('')}</div></div>
        <div class="ls-count ls-end"><span role="status">Показано ${e(model.cards.length)} из ${e(model.total)}</span><button type="button" class="ls-link" data-act="reset" data-key="reset">Сбросить</button></div></div>`;
    const cards = model.cards.map(card => {
      const data = exerciseBoard(contentExerciseOf(card.content)!, 'none');
      const saving = saveDraft?.key === card.id;
      const save = options.onSaveExercise && card.builtin ? (saving
        ? `<form class="ls-save" data-save="${e(card.id)}"><label class="ls-field">Название <input type="text" maxlength="80" required value="${e(saveDraft!.name)}" data-save-name data-key="save-name:${e(card.id)}"></label><button type="submit" class="primary-button button-compact">Сохранить</button><button type="button" class="secondary-button button-compact" data-act="save-cancel" data-key="save-cancel">Отмена</button></form>`
        : '') : '';
      const saveButton = options.onSaveExercise && card.builtin && !saving ? `<button type="button" class="ls-mini ls-save-btn" data-act="save-start" data-card="${e(card.id)}" data-ref="${ref(card.content)}" data-key="save:${e(card.id)}" aria-label="${e(`Сохранить как своё: ${card.title}`)}" title="Сохранить как своё упражнение">☆</button>` : '';
      // Своя линия: сыграть её в другой тональности без сохранения (B5.5); так шаг `h4-line` набирает тональности.
      const ownLine = !card.builtin && card.content.kind === 'exercise' && card.content.spec.templateId === 'line' ? card.content.spec : null;
      const transpose = ownLine
        ? `<div class="ls-transpose"><label class="ls-field">В тональности <select data-control="line-transpose" data-card="${e(card.id)}" data-key="lt:${e(card.id)}">${ROOTS.map(root => `<option value="${e(root)}"${root === (transposeRoots.get(card.id) ?? ownLine.params.root) ? ' selected' : ''}>${e(root)}</option>`).join('')}</select></label>
          <button type="button" class="secondary-button button-compact" data-act="play-transposed" data-card="${e(card.id)}" data-ref="${ref(card.content)}" data-key="lt-play:${e(card.id)}" aria-label="${e(`Сыграть в другой тональности: ${card.title}`)}">▶ В другой тональности</button></div>` : '';
      const open = configuring === card.id && card.builtin;
      const configureButton = card.builtin ? `<button type="button" class="ls-link ls-config-btn" data-act="configure" data-card="${e(card.id)}" data-key="cfg:${e(card.id)}" aria-expanded="${open}" aria-controls="${id}-cfg-${e(card.id)}">${card.configured ? 'Настроено' : 'Настроить'}</button>` : '';
      return `<article class="ls-card ls-lib-card${card.inPlan ? ' in-plan' : ''}${card.featured ? ' is-featured' : ''}">
        <div>${card.featured ? '<span class="ls-flag">Рекомендуем</span>' : ''}${card.builtin ? '' : '<span class="ls-flag ls-flag-own">Своё</span>'}<h3>${e(card.title)}</h3><p class="ls-meta">${e(card.category)} · ${e(card.material)}</p>${configureButton}</div>
        ${open && card.content.kind === 'exercise' ? configRow(card.id, card.content.spec, card.configured) : ''}
        ${board(data.notes, data.frets, { width: 300, marker: 17, labels: false, decorative: true })}
        ${transpose}
        <div class="ls-chips">${card.concepts.map(concept => `<span class="ls-chip ls-chip-concept">${e(concept)}</span>`).join('')}<span class="ls-chip">${e(card.minutes)} мин</span></div>
        <div class="ls-card-foot"><span class="ls-best">${card.bestBpm ? `лучший темп <b>${e(card.bestBpm)}</b>` : card.played ? 'в работе' : 'ещё не играл'}${card.playedToday ? ' · сегодня ✓' : ''}</span>
          <span class="ls-card-btns"><button type="button" class="primary-button button-compact" data-act="play" data-ref="${ref(card.content)}" data-key="lib-play:${e(card.id)}" aria-label="${e(`Играть: ${card.title}`)}">▶ Играть</button>${addButton(card.content, true, '+ в план')}${saveButton}</span></div>
        ${save}
      </article>`;
    }).join('') || '<div class="ls-none">Под эти фильтры ничего нет. Сбрось фильтры или выбери другую категорию.</div>';
    const bar = strip.count
      ? `<strong>План на сегодня · ${e(strip.count)} ${plural(strip.count, 'шаг', 'шага', 'шагов')} · ${e(strip.minutes)} мин</strong><span class="ls-bar-list">${strip.items.map(item => item.current ? `<b>▶ ${e(item.title)}</b>` : `${item.done ? '✓ ' : ''}${e(item.title)}`).join(' → ')}</span><span class="ls-bar-btns"><button type="button" class="secondary-button button-compact" data-act="edit-today" data-key="bar-edit">Изменить в «Сегодня»</button><button type="button" class="primary-button" data-act="play"${strip.current ? ` data-ref="${ref(strip.current.content)}" data-step="${e(strip.current.id)}"` : ' disabled'} data-key="bar-start">Начать →</button></span>`
      : `<strong>План пуст</strong><span class="ls-bar-list">Добавь упражнения кнопкой «+ в план» или сразу нажми «Играть».</span><span class="ls-bar-btns"><button type="button" class="primary-button" disabled>Начать →</button></span>`;
    regions.library.innerHTML = `${builderMarkup(builder, `${id}-builder-title`)}<div class="ls-lib-body">
        <nav class="ls-cats" aria-label="Категории">${model.categories.map(category => `<button type="button" class="ls-cat" data-act="category" data-value="${e(category.id)}" data-key="cat:${e(category.id)}" aria-pressed="${library.category === category.id}"><span>${e(category.title)}</span><small>${e(category.count)}</small></button>`).join('')}</nav>
        <div class="ls-lib-right">${filters}<div class="ls-grid">${cards}</div></div>
      </div>
      <section class="ls-planbar" aria-label="План на сегодня">${bar}</section>`;
  }

  /* ---------- Основы ---------- */

  function selectedLevel(levels: readonly BasicsLevel[]) {
    return levels.find(level => level.key === basicsLevel) ?? levels.find(level => level.status === 'current') ?? levels[0];
  }

  function conceptBoardMarkup(source: ConceptBoard) {
    const notes: BoardNote[] = source.positions.map(position => ({
      id: position.id, kind: ROLE_KIND[position.role ?? 'plain'],
      label: source.defaultLens === 'degrees' || source.defaultLens === 'chord-tones' ? position.degree ?? '' : source.defaultLens === 'intervals' ? position.interval ?? '' : source.showOctave ? position.label : position.label.replace(/-?\d+$/, ''),
      finger: source.showFingers ? position.finger ?? null : null,
    }));
    const frets = [source.fretMin, source.fretMax];
    return board(notes, frets, { width: 760, marker: 30, minSpan: source.fretMax - source.fretMin + 1, aria: `Гриф понятия: ${source.positions.map(position => `${position.id.replace(':', '/')} ${position.label}`).join(', ')}` })
      + legend(source.legend.map(item => ({ kind: ROLE_KIND[item.role], label: item.label })));
  }

  function conceptText(text: string) {
    return parseConceptText(text).map(part => {
      switch (part.kind) {
        case 'text': return e(part.text);
        case 'strong': return `<strong>${e(part.text)}</strong>`;
        case 'position': return `<span class="ls-pos">${e(`${part.string}/${part.fret}`)}${part.label ? ` <small>${e(part.label)}</small>` : ''}</span>`;
        case 'degree': return `<span class="ls-degree">${e(part.text)}</span>`;
        case 'roman': return `<span class="ls-roman">${e(part.text)}</span>`;
        case 'finger': return `<span class="ls-finger" title="палец">${e(part.text)}</span>`;
      }
    }).join('');
  }

  const basicsViewOf = (current: LessonState): BasicsView => basicsMode ?? current.basicsView;
  function setBasicsView(view: BasicsView) {
    if (state && basicsViewOf(state) === view) return;
    basicsMode = view;
    try { options.onBasicsViewChange?.(view); } catch (failure) { toast(failure instanceof Error ? failure.message : String(failure)); }
  }
  const basicsToggle = (view: BasicsView) => `<div class="ls-seg ls-basics-toggle" role="group" aria-label="Вид «Основ»">${([['path', 'Путь'], ['knowledge', 'Знания']] as const).map(([value, label]) => `<button type="button" data-act="basics-view" data-value="${value}" data-key="bv:${value}" aria-pressed="${view === value}">${label}</button>`).join('')}</div>`;

  /* ---------- Путь программы ---------- */

  function pathStepMarkup(step: PathStep) {
    const chips = step.variants.length > 1 ? `<div class="ls-vchips" role="group" aria-label="Варианты шага: ${e(step.title)}">${step.variants.map((variant, index) =>
      `<button type="button" class="ls-vchip${index === step.selected ? ' is-on' : ''}${variant.clean ? ' is-clean' : ''}" data-act="path-variant" data-step-id="${e(step.id)}" data-value="${index}" data-key="pv:${e(step.id)}:${index}" aria-pressed="${index === step.selected}">${e(variant.label)}${variant.clean ? ' ✓' : ''}</button>`).join('')}</div>`
      : step.variants.length === 1 ? `<span class="ls-sub ls-vone">${e(step.variants[0].label)}</span>` : '';
    const build = step.kind === 'line'
      ? `<button type="button" class="${step.current ? 'primary-button' : 'secondary-button'} button-compact" data-act="path-build" data-step-id="${e(step.id)}" data-volume="${step.builderVolume ?? 1}" data-key="path-build:${e(step.id)}" aria-label="${e(`Построить: ${step.title}`)}">▶ Построить</button>`
      : step.kind === 'song' ? `<button type="button" class="secondary-button button-compact" data-act="path-song" data-step-id="${e(step.id)}" data-key="path-song:${e(step.id)}" aria-label="${e(`Своя песня: ${step.title}`)}">Фрагменты из «Песен»</button>` : '';
    const play = step.kind === 'play' || step.kind === 'check'
      ? `<button type="button" class="${step.current ? 'primary-button' : 'secondary-button'} button-compact" data-act="path-play" data-step-id="${e(step.id)}" data-key="path-play:${e(step.id)}" aria-label="${e(`${step.kind === 'check' ? 'Проверь себя' : 'Играть'}: ${step.title}`)}">${step.kind === 'check' ? '▶ Проверь себя' : '▶ Играть'}</button>` : '';
    return `<li class="ls-pstep is-${step.state}${step.current ? ' is-current' : ''}" data-step-id="${e(step.id)}">
      <div class="ls-pstep-main"><b>${e(step.title)}</b><span class="ls-chip ls-chip-status" data-status="${e(step.state)}">${e(step.label)}</span>${step.review ? '<span class="ls-chip ls-chip-review">пора повторить</span>' : ''}${step.current ? '<span class="ls-chip ls-chip-concept">сейчас</span>' : ''}</div>
      <div class="ls-pstep-side">${chips}${play}${build}</div></li>`;
  }
  function renderPath(current: LessonState) {
    const stages = pathModel(current.program, current.programState, new Set(current.skipped), pathPicks);
    const stage = stages.find(item => item.number === pathStage) ?? stages[0];
    const tabs = stages.length > 1 ? `<div class="ls-seg ls-stage-tabs" role="group" aria-label="Этапы">${stages.map(item => `<button type="button" data-act="path-stage" data-value="${item.number}" data-key="ps:${item.number}" aria-pressed="${item.number === stage.number}">Этап ${item.number}</button>`).join('')}</div>` : '';
    const lines = stage.lines.map(line => `<section class="ls-pline${line.done ? ' is-done' : ''}" aria-label="${e(line.title)}"><div class="ls-pline-head"><h3>${e(line.title)}</h3><span class="ls-sub">${e(line.counts)}</span></div>
      ${line.blocks.map(block => `<article class="ls-pblock${block.skipped ? ' is-skipped' : ''}" data-block="${e(block.id)}">
        <header><h4>${e(block.title)}</h4><span class="ls-sub">${e(block.counts)}</span>
          <button type="button" class="ls-opt" data-act="path-skip" data-block="${e(block.id)}" data-key="skip:${e(block.id)}" aria-pressed="${block.skipped}" title="Отметить блок без игры; отметку можно снять">Уже умею</button></header>
        ${block.cards.length ? `<p class="ls-pcards">Сначала прочитай: ${block.cards.map(card => `<button type="button" class="ls-link" data-act="concept" data-concept="${e(card.id)}" data-key="pcard:${e(block.id)}:${e(card.id)}">${e(card.title)}</button>`).join(', ')}</p>` : ''}
        <ol class="ls-psteps">${block.steps.map(pathStepMarkup).join('')}</ol></article>`).join('')}</section>`).join('');
    regions.basics.innerHTML = `${basicsToggle('path')}<section class="ls-card ls-pathview" aria-label="Путь программы">
      <div class="ls-path-head"><h2>Этап ${e(stage.number)} · ${e(stage.title)}</h2><span class="ls-sub">${e(stage.counts)}</span>${tabs}</div>
      <p class="ls-path-note">Линии идут параллельно: у каждой свой текущий шаг. Любой шаг открывается сразу; отметки «Чисто / С ошибками / Не успевал» ставишь ты.</p>
      ${lines}</section>`;
  }

  function renderBasics(current: LessonState) {
    if (basicsViewOf(current) === 'path') renderPath(current); else renderKnowledge(current);
  }

  function renderKnowledge(current: LessonState) {
    const levels = basicsCourse(current.records, current.userExercises);
    const level = selectedLevel(levels);
    const step = level.steps.find(item => item.key === basicsStep) ?? currentBasicsStep(level);
    const firstRun = current.firstRun && !levels.some(item => item.doneCount > 0);
    const levelItem = (item: BasicsLevel) => {
      const sub = item.status === 'done' ? 'освоено' : item.status === 'current' ? (firstRun ? 'начни отсюда' : item.doneCount ? `${item.doneCount} из ${item.total} · в работе` : 'в работе') : item.doneCount ? `${item.doneCount} из ${item.total}` : 'можно открыть';
      return `<li class="ls-lvl is-${item.status}"><span class="ls-node" aria-hidden="true">${item.status === 'done' ? '✓' : e(item.mark)}</span>
        <button type="button" class="ls-lvl-btn" data-act="level" data-value="${e(item.key)}" data-key="lvl:${e(item.key)}" aria-pressed="${item.key === level.key}"><b>${e(item.title)}</b><span>${e(sub)}</span>${item.status === 'current' && item.doneCount && item.lane === 'main' ? `<span class="ls-meter" aria-hidden="true"><i style="width:${Math.round(item.doneCount / item.total * 100)}%"></i></span>` : ''}</button></li>`;
    };
    const strip = level.steps.map(item => {
      const canAdd = item.content !== null;
      const on = canAdd && inPlan(item.content!);
      return `<li class="ls-st k-${item.kind}${item.done ? ' is-done' : ''}${item.key === step.key ? ' is-current' : ''}${canAdd ? ' can-add' : ''}">
        <button type="button" class="ls-st-btn" data-act="basics-step" data-value="${e(item.key)}" data-key="st:${e(item.key)}" aria-current="${item.key === step.key ? 'step' : 'false'}"><small>${KIND_LABEL[item.kind]}${item.done ? ' ✓' : ''}</small><span>${e(item.title)}</span>${item.kind === 'exercise' && item.content ? `<em class="ls-st-mat">${e(stepMaterial(item.content))}</em>` : ''}</button>
        ${canAdd ? `<button type="button" class="ls-mini ls-st-add" data-act="toggle-plan" data-ref="${ref(item.content!)}" data-key="st-add:${e(item.key)}" aria-pressed="${on}" aria-label="${e(`${on ? 'Убрать из плана' : 'Добавить в план'}: ${item.title}`)}" title="${on ? 'В плане «Сегодня» — нажми, чтобы убрать' : `В план «Сегодня» · ${contentMinutes(item.content!)} мин`}">${on ? '✓' : '+'}</button>` : ''}</li>`;
    }).join('');
    regions.basics.innerHTML = `${basicsToggle('knowledge')}<div class="ls-basics-grid">
        <section class="ls-card ls-path" aria-label="Путь уровней">
          <div class="ls-lanes"><div><div class="ls-lane-title">Гриф и теория</div><ol class="ls-lane">${levels.filter(item => item.lane === 'main').map(levelItem).join('')}</ol></div>
            <div class="ls-side"><div class="ls-lane-title">Параллельно</div><ol class="ls-lane is-side">${levels.filter(item => item.lane === 'side').map(levelItem).join('')}</ol></div></div>
          <p class="ls-path-note">Любой уровень можно открыть в любой момент. Отметки «Чисто / С ошибками / Не успевал» ставишь ты — приложение игру не оценивает.</p>
        </section>
        <div class="ls-basics-right">
          <section class="ls-card ls-level" aria-label="Шаги уровня"><div class="ls-level-head"><h2>${level.lane === 'main' ? `Уровень ${e(level.mark)} · ` : 'Параллельно · '}${e(level.title)}</h2><span class="ls-sub">${level.status === 'done' ? 'освоено' : firstRun ? `${e(level.total)} ${plural(level.total, 'шаг', 'шага', 'шагов')}` : `${e(level.doneCount)} из ${e(level.total)} шагов`}</span></div>
            <ol class="ls-strip">${strip}</ol></section>
          <section class="ls-card ls-focus feature-panel" aria-label="Текущий шаг">${focusMarkup(level, step, firstRun)}</section>
        </div>
      </div>`;
  }

  function focusMarkup(level: BasicsLevel, step: BasicsStep, firstRun: boolean) {
    const concept = getConcept(step.conceptId)!;
    const card = concept.full ?? concept.brief!;
    const exercise = nextExerciseStep(level, step) ?? level.steps.find(item => item.conceptId === step.conceptId && item.kind === 'exercise') ?? null;
    const sibling = (kind: BasicsStep['kind']) => level.steps.find(item => item.conceptId === step.conceptId && item.kind === kind) ?? null;
    const ownExercise = sibling('exercise');
    const ownCheck = sibling('check');
    const isCurrent = step === currentBasicsStep(level) && level.status === 'current';
    let primary = '';
    if (step.kind === 'check' && step.content) primary = `<button type="button" class="primary-button button-large" data-act="play" data-ref="${ref(step.content)}" data-key="focus-primary">▶ Проверь себя <small>${e(stepMaterial(step.content))}</small></button>`;
    else if (step.kind === 'check') primary = `<button type="button" class="primary-button button-large" data-act="concept" data-concept="${e(concept.id)}" data-key="focus-primary">Вопрос карточки «${e(concept.title)}» →</button>`;
    else if (exercise?.content) primary = `<button type="button" class="primary-button button-large" data-act="play" data-ref="${ref(exercise.content)}" data-key="focus-primary">▶ ${step.kind === 'concept' ? 'Дальше: сыграть упражнение' : 'Играть упражнение'} <small>${e(exercise.title)} · ${e(stepMaterial(exercise.content))}</small></button>`;
    const secondary = [
      ownExercise?.content ? addButton(ownExercise.content) : '',
      step.kind !== 'check' && ownCheck?.content ? `<button type="button" class="secondary-button button-compact" data-act="play" data-ref="${ref(ownCheck.content)}" data-key="focus-check">Проверь себя · ${contentMinutes(ownCheck.content)} мин</button>` : '',
      `<button type="button" class="secondary-button button-compact" data-act="concept" data-concept="${e(concept.id)}" data-key="focus-concept">Открыть карточку</button>`,
    ].join('');
    const source = conceptBoard(concept);
    return `<div class="ls-focus-top"><span class="ls-eyebrow">${isCurrent ? (firstRun ? 'Первый шаг' : 'Твой текущий шаг') : 'Выбранный шаг'} · ${level.lane === 'main' ? `уровень ${e(level.mark)}` : e(level.title.toLowerCase())} · ${e(basicsStepPosition(level, step))}</span><span class="ls-chip ls-chip-concept">${e(KIND_LABEL[step.kind])} · ${e(concept.title)}</span></div>
      <h2>${e(concept.title)}</h2>
      <div class="ls-concept"><p>${conceptText(card.name)}</p><p class="ls-why"><b>Зачем басисту.</b> ${conceptText(card.why)}</p></div>
      <div class="ls-actions">${primary}${secondary}</div>
      ${source ? conceptBoardMarkup(source) : ''}
      ${card.play.text ? `<p class="ls-sub ls-play-text">${conceptText(card.play.text)}</p>` : ''}`;
  }

  function renderSearch() {
    if (!state) return;
    const query = searchInput.value;
    const hits = searchBasics(query, basicsCourse(state.records, state.userExercises), libraryItems(state.playFrom, state.userExercises));
    const open = query.trim().length > 0;
    searchInput.setAttribute('aria-expanded', String(open));
    searchResults.hidden = !open;
    if (!open) { searchResults.innerHTML = ''; return; }
    searchResults.innerHTML = hits.length
      ? `<ul aria-label="Результаты поиска">${hits.map(hit => {
        const attrs = hit.kind === 'concept' ? `data-act="search-concept" data-value="${e(hit.stepKey)}" data-level="${e(hit.levelKey)}"`
          : `data-act="play" data-ref="${ref(hit.content)}"`;
        return `<li><button type="button" ${attrs}><span>${e(hit.title)}</span><small>${e(hit.hint)}</small></button></li>`;
      }).join('')}</ul>`
      : '<p>Ничего не нашлось — попробуй «пентатоника», «гамма», «блюз» или «паук».</p>';
  }

  /* ---------- Отрисовка ---------- */

  function render() {
    if (disposed || !state) return;
    const active = document.activeElement instanceof HTMLElement && container.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active?.dataset.key ?? null;
    refs = new Map();
    refCount = 0;
    const levels = basicsCourse(state.records, state.userExercises);
    const badges: Record<LessonTab, string> = {
      today: `${plannedMinutes(state.plan)} мин`,
      library: String(libraryItems(state.playFrom, state.userExercises).length),
      basics: basicsViewOf(state) === 'path' ? pathBadge(state.programState) : state.firstRun ? 'ур. 0' : basicsBadge(levels),
    };
    for (const item of TABS) container.querySelector<HTMLElement>(`[data-badge="${item.key}"]`)!.textContent = badges[item.key];
    renderToday(state);
    renderLibrary(state);
    renderBasics(state);
    if (!searchResults.hidden) renderSearch();
    tabs.setSelected(tab);
    flashStep = null;
    if (focusKey) {
      const target = [...container.querySelectorAll<HTMLElement>('[data-key]')].find(element => element.dataset.key === focusKey && !element.closest('[hidden]'));
      (target && !(target as HTMLButtonElement).disabled ? target : null)?.focus({ preventScroll: true });
    }
  }

  /* ---------- События ---------- */

  container.addEventListener('click', event => {
    if (!state) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-act]') : null;
    if (!target || !container.contains(target) || (target as HTMLButtonElement).disabled) return;
    const content = target.dataset.ref ? refs.get(target.dataset.ref) ?? null : null;
    const stepId = target.dataset.step || null;
    const step = stepId ? state.plan.steps.find(item => item.id === stepId) : undefined;
    try {
      switch (target.dataset.act) {
        case 'play': if (content) options.onPlay(content, stepId); break;
        case 'play-step': if (step) options.onPlay(step.content, step.id); break;
        case 'play-transposed': {
          if (content?.kind !== 'exercise') break;
          const select = container.querySelector<HTMLSelectElement>(`[data-control="line-transpose"][data-card="${CSS.escape(target.dataset.card!)}"]`);
          options.onPlay(transposedLineContent(content.spec, select?.value ?? NOTE_CHOICES[0]), null);
          break;
        }
        case 'toggle-plan': if (content) togglePlan(content); break;
        case 'edit': editing = !editing; render(); break;
        case 'edit-today': editing = true; selectTab('today'); render(); container.querySelector<HTMLElement>('[data-key="edit"]')?.focus(); break;
        case 'go-library': selectTab('library'); container.querySelector<HTMLElement>(`#${id}-panel-library`)?.focus({ preventScroll: true }); break;
        case 'go-category': library = { ...DEFAULT_LIBRARY, category: target.dataset.category as LibraryCategory }; selectTab('library'); render(); container.querySelector<HTMLElement>(`[data-key="cat:${library.category}"]`)?.focus(); break;
        case 'ear': if (stepId) changePlan(toggleStepEar(state.plan, stepId), step?.content.kind === 'check' && !step.content.spec.ear ? 'Слух включён для шага проверки' : 'Слух выключен для шага проверки'); break;
        case 'minutes': if (step) changePlan(setStepMinutes(state.plan, step.id, step.minutes + Number(target.dataset.delta)), `${stepTitle(step.content, state.userExercises)}: ${step.minutes + Number(target.dataset.delta)} мин`); break;
        case 'move': if (step) { const next = moveStep(state.plan, step.id, Number(target.dataset.delta) as -1 | 1); if (next !== state.plan) changePlan(next, `${Number(target.dataset.delta) < 0 ? 'Выше' : 'Ниже'}: ${stepTitle(step.content, state.userExercises)}`); } break;
        case 'remove': if (step) changePlan(removeStep(state.plan, step.id), `Убрано из плана: ${stepTitle(step.content, state.userExercises)}`); break;
        case 'concept': if (target.dataset.concept) options.onOpenConcept(target.dataset.concept); break;
        case 'category': library = { ...library, category: target.dataset.value as LibraryCategory }; render(); break;
        case 'status': library = { ...library, status: target.dataset.value as LibraryControls['status'] }; render(); break;
        case 'concept-filter': library = { ...library, concept: library.concept === target.dataset.value ? null : target.dataset.value as LibraryControls['concept'] }; render(); break;
        case 'reset': library = { ...DEFAULT_LIBRARY, sort: library.sort }; render(); break;
        case 'configure': { const card = target.dataset.card!; configuring = configuring === card ? null : card; cardError = null; render(); break; }
        case 'card-reset': {
          const card = target.dataset.card!;
          cardSpecs = new Map(cardSpecs); cardSpecs.delete(card); cardError = null; render();
          container.querySelector<HTMLElement>(`[data-key="cfg:${CSS.escape(card)}"]`)?.focus(); break;
        }
        case 'save-start': if (content?.kind === 'exercise') { saveDraft = { key: target.dataset.card!, name: `${exercisePlan(content.spec).title} · ${materialLabel(content.spec)}`.slice(0, 80).trim() }; render(); container.querySelector<HTMLInputElement>('[data-save-name]')?.select(); } break;
        case 'save-cancel': { const key = saveDraft?.key; saveDraft = null; render(); if (key) container.querySelector<HTMLElement>(`[data-key="save:${CSS.escape(key)}"]`)?.focus(); break; }
        case 'basics-view': setBasicsView(target.dataset.value as BasicsView); basicsMode = target.dataset.value as BasicsView; render(); break;
        case 'go-path': setBasicsView('path'); basicsMode = 'path'; selectTab('basics'); render(); container.querySelector<HTMLElement>('[data-key^="path-play:"]')?.focus(); break;
        case 'path-stage': pathStage = Number(target.dataset.value); render(); break;
        case 'path-variant': pathPicks.set(target.dataset.stepId!, Number(target.dataset.value)); render(); break;
        case 'path-build': builder = builderVolume(toggleBuilder(builder, true), volumeOf(target.dataset.volume)); selectTab('library'); render(); container.querySelector<HTMLElement>('[data-key="builder-root"]')?.focus(); break;
        case 'path-song': toast('Фрагменты своих песен сохраняются в разделе «Песни»: выбери такты партии и нажми «Разучить как упражнение».'); break;
        case 'builder-toggle': builder = toggleBuilder(builder); render(); break;
        case 'builder-volume': builder = builderVolume(builder, volumeOf(target.dataset.value)); render(); break;
        case 'builder-add': builder = builderAddBar(builder); render(); break;
        case 'builder-remove': builder = builderRemoveBar(builder, Number(target.dataset.bar)); render(); break;
        case 'builder-play': try { options.onPlay({ kind: 'exercise', spec: builderSpec(builder) }, null); } catch (failure) { builder = { ...builder, error: failure instanceof Error ? failure.message : String(failure) }; render(); } break;
        case 'builder-save': {
          if (!options.onSaveExercise) break;
          const name = builder.name.trim();
          if (!name) { builder = { ...builder, error: 'Назови линию, чтобы сохранить её как своё упражнение.' }; render(); container.querySelector<HTMLElement>('[data-key="builder-name"]')?.focus(); break; }
          try { options.onSaveExercise(builderSpec(builder), name.slice(0, 80)); builder = { ...builder, name: '', error: '' }; toast(`Сохранено как своё упражнение: ${name.slice(0, 80)}`); render(); }
          catch (failure) { builder = { ...builder, error: failure instanceof Error ? failure.message : String(failure) }; render(); }
          break;
        }
        case 'path-play': {
          const id = target.dataset.stepId!;
          const stages = pathModel(state.program, state.programState, new Set(state.skipped), pathPicks);
          const found = stages.flatMap(item => item.lines.flatMap(line => line.blocks.flatMap(block => block.steps))).find(item => item.id === id);
          if (found) options.onPlayStep?.(id, found.selected);
          break;
        }
        case 'path-skip': {
          const block = target.dataset.block!;
          options.onSkipBlock?.(block, !state.skipped.includes(block));
          break;
        }
        case 'level': basicsLevel = target.dataset.value ?? null; basicsStep = null; render(); break;
        case 'basics-step': basicsStep = target.dataset.value ?? null; render(); break;
        case 'search-concept': setBasicsView('knowledge'); basicsLevel = target.dataset.level ?? null; basicsStep = target.dataset.value ?? null; searchInput.value = ''; renderSearch(); render(); container.querySelector<HTMLElement>('.ls-focus h2')?.scrollIntoView?.({ block: 'nearest' }); break;
      }
    } catch (failure) { toast(failure instanceof Error ? failure.message : String(failure)); }
  }, listen);

  /** Смена параметра на карточке: несовместимое сочетание подстраивается, иначе ошибка у поля и материал прежний. */
  function configureCard(current: LessonState, cardId: string, param: string, raw: string) {
    const item = configuredItems(current.playFrom, current.userExercises, cardSpecs).find(candidate => candidate.id === cardId && candidate.builtin);
    const option = item ? templateOptions(item.spec.templateId).find(candidate => candidate.param === param) : undefined;
    const value = option?.values.find(candidate => String(candidate.value) === raw)?.value;
    if (!item || value === undefined) return;
    try {
      cardSpecs = new Map(cardSpecs).set(cardId, configureSpec(item.spec, param, value));
      cardError = null;
    } catch (failure) {
      cardError = { card: cardId, param, message: failure instanceof Error ? failure.message : String(failure) };
    }
    render();
  }

  container.addEventListener('change', event => {
    const control = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!control || !state) return;
    if (control.dataset.control === 'play-from') { options.onPlayFromChange(control.value || null); return; }
    if (control.dataset.control === 'builder-root') { builder = builderRoot(builder, control.value); render(); return; }
    if (control.dataset.control === 'builder-mode') { builder = builderMode(builder, control.value === 'minor' ? 'minor' : 'major'); render(); return; }
    if (control.dataset.control === 'builder-step') { builder = builderStep(builder, Number(control.dataset.bar), Number(control.value)); render(); return; }
    if (control.dataset.control === 'builder-kind') { builder = builderKind(builder, Number(control.dataset.bar), control.value as LineChord); render(); return; }
    if (control.dataset.control === 'builder-rhythm') { builder = builderRhythm(builder, Number(control.dataset.bar), control.value as RhythmPatternId); render(); return; }
    if (control.dataset.control === 'builder-pattern') { builder = builderPattern(builder, Number(control.dataset.bar), control.value as ProgressionPattern); render(); return; }
    if (control.dataset.control === 'line-transpose') { transposeRoots.set(control.dataset.card!, control.value); return; }
    if (control.dataset.control === 'card-param') { configureCard(state, control.dataset.card!, control.dataset.param!, control.value); return; }
    if (control.dataset.control === 'structure') library = { ...library, structureId: (control.value || null) as LibraryControls['structureId'] };
    if (control.dataset.control === 'sort') library = { ...library, sort: control.value as LibraryControls['sort'] };
    render();
  }, listen);

  container.addEventListener('submit', event => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.dataset.save || !state || !options.onSaveExercise) return;
    event.preventDefault();
    const input = form.querySelector<HTMLInputElement>('[data-save-name]')!;
    const name = input.value.trim();
    const item = configuredItems(state.playFrom, state.userExercises, cardSpecs).find(candidate => candidate.id === form.dataset.save);
    if (!name || !item) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    try {
      options.onSaveExercise(item.spec, name.slice(0, 80));
      saveDraft = null; toast(`Сохранено как своё упражнение: ${name.slice(0, 80)}`); render();
    } catch (failure) { toast(failure instanceof Error ? failure.message : String(failure)); }
  }, listen);

  /** Enter в названии линии сохраняет её, как кнопка «Сохранить»: поле стоит вне формы. */
  container.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement) || event.target.dataset.builderName === undefined) return;
    event.preventDefault();
    builder = { ...builder, name: event.target.value };
    container.querySelector<HTMLButtonElement>('[data-act="builder-save"]')?.click();
  }, listen);
  container.addEventListener('input', event => {
    if (event.target === searchInput) { renderSearch(); return; }
    if (event.target instanceof HTMLInputElement && event.target.dataset.builderName !== undefined) { builder = { ...builder, name: event.target.value }; return; }
    if (event.target instanceof HTMLInputElement && event.target.dataset.saveName !== undefined && saveDraft) saveDraft = { ...saveDraft, name: event.target.value };
  }, listen);
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape' && searchInput.value) { event.preventDefault(); searchInput.value = ''; renderSearch(); }
    if (event.key === 'ArrowDown') { const first = searchResults.querySelector<HTMLElement>('button'); if (first) { event.preventDefault(); first.focus(); } }
  }, listen);
  document.addEventListener('click', event => {
    if (event.target instanceof Node && !container.querySelector('[data-search]')!.contains(event.target) && !searchResults.hidden) { searchResults.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); }
  }, listen);
  searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) renderSearch(); }, listen);

  if (state) render(); else regions.today.innerHTML = '<p class="ls-sub">Загружаем занятие…</p>';
  tabs.setSelected(tab);

  return {
    update(next: LessonState) {
      if (disposed) return;
      const planChanged = state !== null && JSON.stringify(state.plan) !== JSON.stringify(next.plan);
      state = next;
      if (next.tab !== tab) tab = next.tab;
      if (planChanged && pendingNotice) toast(pendingNotice);
      if (planChanged) pendingNotice = null;
      if (!next.plan.steps.length) editing = false;
      render();
    },
    setVisible(visible: boolean) { container.hidden = !visible; },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      window.clearTimeout(toastTimer);
      container.innerHTML = '';
      container.classList.remove('lesson-view');
    },
  };
}

function sameRoot(a: string, b: string) {
  const normalize = (value: string) => value.replace('♯', '#').replace('♭', 'b');
  return normalize(a) === normalize(b);
}
