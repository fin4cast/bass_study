/**
 * Раздел «Занятие» (VIS-10 r2, утверждён 2026-11-12): вкладки «Сегодня», «Библиотека», «Основы» и один план.
 * Экран не хранит данные: состояние приходит через `update(state)`, изменения уходят колбэками.
 * План меняется только по подтверждению владельца: после `onPlanChange` экран ждёт следующий `update`.
 */
import './mini-board.css';
import './lesson.css';
import type { ExerciseSpec } from '../../exercises';
import { getConcept, conceptBoard, parseConceptText, type ConceptBoard, type ConceptRole } from '../../practice/concepts';
import { PLAN_TEMPLATES, moveStep, plannedMinutes, removeStep, type DayPlan, type PlanStepContent } from '../../practice/plan';
import { bindPageTabs } from '../page-tabs';
import { escapeHtml as e } from '../html';
import { CONCEPT_LABELS, exercisePlan, materialLabel, STRUCTURE_LABELS } from './material';
import { boardSvg, boardWindow, type BoardNote } from './mini-board';
import {
  appendTemplate, basicsBadge, basicsCourse, contentMinutes, currentBasicsStep, DEFAULT_LIBRARY, exerciseBoard, heroModel,
  LIBRARY_CONCEPTS, LIBRARY_STRUCTURES, libraryItems, libraryModel, nextExerciseStep, pendingMatches, planRows, planStrip,
  recommendationCards, searchBasics, setStepMinutes, stepMaterial, stepTitle, togglePlanContent, toggleStepEar,
  type BasicsLevel, type BasicsStep, type LessonState, type LessonTab, type LibraryCategory, type LibraryControls,
} from './model';
import { CATEGORY_ORDER, CATEGORY_TITLES } from '../../practice/library';

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
  readonly state?: LessonState;
}

const TABS: readonly { key: LessonTab; label: string; hint: string }[] = [
  { key: 'today', label: 'Сегодня', hint: 'Сел с басом — вот что играть сейчас.' },
  { key: 'library', label: 'Библиотека', hint: 'Играй сразу или добавляй в план на сегодня.' },
  { key: 'basics', label: 'Основы', hint: 'Шаги по порядку: понятие → упражнение → проверка. Ничего не заблокировано.' },
];
const ROOTS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
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
  let saveDraft: { key: string; name: string } | null = null;
  let pendingNotice: string | null = null;
  let flashStep: string | null = null;
  let disposed = false;
  /** Ссылки кнопок на содержимое шага: описания упражнений не попадают в DOM. */
  let refs = new Map<string, PlanStepContent>();
  let refCount = 0;
  const ref = (content: PlanStepContent) => { const key = `c${++refCount}`; refs.set(key, content); return key; };

  container.classList.add('lesson-view');
  container.innerHTML = `
    <header class="ls-top">
      <h1>Занятие</h1>
      <div class="ls-tabs" role="tablist" aria-label="Занятие">${TABS.map(item => `<button type="button" role="tab" class="ls-tab" id="${id}-tab-${item.key}" aria-controls="${id}-panel-${item.key}" aria-selected="false" tabindex="-1">${e(item.label)}<small data-badge="${item.key}"></small></button>`).join('')}</div>
    </header>
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
    return `<button type="button" class="ls-btn${small ? ' ls-btn-s' : ''} ls-add" data-act="toggle-plan" data-ref="${ref(content)}" data-key="add:${e(keyOf(content))}" aria-pressed="${on}" aria-label="${e(`${on ? 'Убрать из плана' : 'Добавить в план'}: ${title}`)}">${on ? '✓ в плане' : e(label ?? `+ в план · ${contentMinutes(content)} мин`)}</button>`;
  };
  function keyOf(content: PlanStepContent) { return JSON.stringify(content).slice(0, 400); }

  /* ---------- Сегодня ---------- */

  function renderToday(current: LessonState) {
    const hero = heroModel(current);
    const rows = planRows(current.plan, current.records, current.userExercises);
    const total = plannedMinutes(current.plan);
    const done = rows.filter(row => row.status === 'done').reduce((sum, row) => sum + row.minutes, 0);
    const recs = recommendationCards(current.records, current.firstRun);
    const items = libraryItems(current.playFrom, current.userExercises);

    let heroMarkup: string;
    if (hero.mode === 'first-run') {
      const spec = hero.content?.kind === 'exercise' ? hero.content.spec : hero.content?.spec.exercise ?? null;
      heroMarkup = `<div><span class="ls-eyebrow">${e(hero.eyebrow)}</span><h2>${e(hero.title)}</h2><p class="ls-sub">${e(hero.meta)}</p></div>
        <div class="ls-actions"><button type="button" class="ls-btn ls-btn-primary ls-btn-big" data-act="basics-start" data-key="hero-basics">Начни с «Основ» →</button>${hero.content ? `<button type="button" class="ls-btn" data-act="play" data-ref="${ref(hero.content)}" data-step="${e(hero.stepId ?? '')}" data-key="hero-play">▶ Играть план</button>` : ''}</div>
        ${spec ? exerciseBoardMarkup(spec, 700, 28, spec.templateId === 'chromatic-position' ? 'finger' : 'name') : ''}`;
    } else if (hero.mode === 'empty') {
      heroMarkup = `<div><span class="ls-eyebrow">${e(hero.eyebrow)}</span><h2>${e(hero.title)}</h2><p class="ls-sub">${e(hero.meta)}</p></div>
        <div class="ls-actions">${Object.entries(PLAN_TEMPLATES).map(([key, template]) => `<button type="button" class="ls-btn${key === 'standard' ? ' ls-btn-primary' : ''}" data-act="template" data-template="${e(key)}" data-key="template-${e(key)}">${e(template.title)}</button>`).join('')}<button type="button" class="ls-btn" data-act="go-library" data-key="hero-library">Открыть библиотеку →</button></div>`;
    } else {
      const content = hero.content!;
      const spec = content.kind === 'exercise' ? content.spec : content.spec.exercise;
      heroMarkup = `<div class="ls-hero-top"><div><span class="ls-eyebrow">${e(hero.eyebrow)}</span><h2>${e(hero.title)}</h2><p class="ls-sub">${e(hero.meta)}</p></div>
          <div class="ls-chips">${hero.concepts.map(concept => `<span class="ls-chip ls-chip-concept">${e(concept)}</span>`).join('')}</div></div>
        <div class="ls-actions"><button type="button" class="ls-btn ls-btn-primary ls-btn-big" data-act="play" data-ref="${ref(content)}" data-step="${e(hero.stepId ?? '')}" data-key="hero-play">▶ ${content.kind === 'check' ? 'Проверь себя' : 'Играть'}</button>
          ${hero.stats.length ? `<div class="ls-stats">${hero.stats.map(stat => `<span><b>${e(stat.value)}</b>${e(stat.label)}</span>`).join('')}</div>` : '<div class="ls-stats"><span class="ls-sub">Отметку «Чисто / С ошибками / Не успевал» поставишь после прохода.</span></div>'}</div>
        ${exerciseBoardMarkup(spec, 700, 28)}`;
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
        </div></li>`).join('')}</ol>` : `<p class="ls-empty">План пуст — добавь упражнение из библиотеки или «Основ».</p><div class="ls-plan-tools">${Object.entries(PLAN_TEMPLATES).map(([key, template]) => `<button type="button" class="ls-btn ls-btn-s" data-act="template" data-template="${e(key)}" data-key="tpl-${e(key)}">Шаблон: ${e(template.title)}</button>`).join('')}</div>`}
      <div class="ls-plan-tools">${rows.length ? `<button type="button" class="ls-btn ls-btn-s" data-act="edit" data-key="edit" aria-pressed="${editing}">${editing ? 'Готово' : 'Изменить план'}</button>` : ''}<button type="button" class="ls-btn ls-btn-s" data-act="go-library" data-key="plan-library">+ из библиотеки</button></div>`;

    const recsMarkup = recs.map(card => {
      let action = '';
      if (card.content) action = addButton(card.content);
      else if (card.openBasics) action = `<button type="button" class="ls-btn ls-btn-s" data-act="basics-start" data-key="rec-basics">Открыть «Основы»</button>`;
      else if (card.conceptId) action = `<button type="button" class="ls-btn ls-btn-s" data-act="concept" data-concept="${e(card.conceptId)}" data-key="rec-concept:${e(card.id)}">Открыть понятие</button>`;
      return `<article class="ls-card ls-rec${card.concept ? ' is-concept' : ''}"><span class="ls-eyebrow">${e(card.eyebrow)}</span><h3>${e(card.title)}</h3><p>${e(card.reason)}</p>${action}</article>`;
    }).join('');

    regions.today.innerHTML = `<div class="ls-today-grid">
        <div class="ls-col"><section class="ls-card ls-hero" aria-label="Главное действие">${heroMarkup}</section>
          <section class="ls-recs" aria-label="Рекомендации">${recsMarkup}</section></div>
        <section class="ls-card ls-plan${editing ? ' is-editing' : ''}" aria-label="План на сегодня">${planMarkup}</section>
      </div>
      <section class="ls-card ls-libstrip" aria-label="Библиотека"><strong>Библиотека</strong><span class="ls-sub">${e(items.length)} ${plural(items.length, 'упражнение', 'упражнения', 'упражнений')} · ${CATEGORY_ORDER.length} категорий</span>
        <div class="ls-chips">${CATEGORY_ORDER.map(category => `<button type="button" class="ls-chip ls-chip-link" data-act="go-category" data-category="${e(category)}" data-key="cat-strip:${e(category)}">${e(CATEGORY_TITLES[category])}</button>`).join('')}</div>
        <button type="button" class="ls-btn" data-act="go-library" data-key="strip-library">Открыть библиотеку →</button></section>`;
  }

  /* ---------- Библиотека ---------- */

  function renderLibrary(current: LessonState) {
    const model = libraryModel(current, library);
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
      const data = exerciseBoard(card.content.kind === 'exercise' ? card.content.spec : card.content.spec.exercise, 'none');
      const saving = saveDraft?.key === card.key;
      const save = options.onSaveExercise && card.builtin ? (saving
        ? `<form class="ls-save" data-save="${e(card.key)}"><label class="ls-field">Название <input type="text" maxlength="80" required value="${e(saveDraft!.name)}" data-save-name data-key="save-name:${e(card.key)}"></label><button type="submit" class="ls-btn ls-btn-s ls-btn-primary">Сохранить</button><button type="button" class="ls-btn ls-btn-s" data-act="save-cancel" data-key="save-cancel">Отмена</button></form>`
        : '') : '';
      const saveButton = options.onSaveExercise && card.builtin && !saving ? `<button type="button" class="ls-mini ls-save-btn" data-act="save-start" data-card="${e(card.key)}" data-ref="${ref(card.content)}" data-key="save:${e(card.key)}" aria-label="${e(`Сохранить как своё: ${card.title}`)}" title="Сохранить как своё упражнение">☆</button>` : '';
      return `<article class="ls-card ls-lib-card${card.inPlan ? ' in-plan' : ''}${card.featured ? ' is-featured' : ''}">
        <div>${card.featured ? '<span class="ls-flag">Рекомендуем</span>' : ''}${card.builtin ? '' : '<span class="ls-flag ls-flag-own">Своё</span>'}<h3>${e(card.title)}</h3><p class="ls-meta">${e(card.category)} · ${e(card.material)}</p></div>
        ${board(data.notes, data.frets, { width: 300, marker: 17, labels: false, decorative: true })}
        <div class="ls-chips">${card.concepts.map(concept => `<span class="ls-chip ls-chip-concept">${e(concept)}</span>`).join('')}<span class="ls-chip">${e(card.minutes)} мин</span></div>
        <div class="ls-card-foot"><span class="ls-best">${card.bestBpm ? `лучший темп <b>${e(card.bestBpm)}</b>` : card.played ? 'в работе' : 'ещё не играл'}${card.playedToday ? ' · сегодня ✓' : ''}</span>
          <span class="ls-card-btns"><button type="button" class="ls-btn ls-btn-primary ls-btn-s" data-act="play" data-ref="${ref(card.content)}" data-key="lib-play:${e(card.key)}" aria-label="${e(`Играть: ${card.title}`)}">▶ Играть</button>${addButton(card.content, true, '+ в план')}${saveButton}</span></div>
        ${save}
      </article>`;
    }).join('') || '<div class="ls-none">Под эти фильтры ничего нет. Сбрось фильтры или выбери другую категорию.</div>';
    const bar = strip.count
      ? `<strong>План на сегодня · ${e(strip.count)} ${plural(strip.count, 'шаг', 'шага', 'шагов')} · ${e(strip.minutes)} мин</strong><span class="ls-bar-list">${strip.items.map(item => item.current ? `<b>▶ ${e(item.title)}</b>` : `${item.done ? '✓ ' : ''}${e(item.title)}`).join(' → ')}</span><span class="ls-bar-btns"><button type="button" class="ls-btn ls-btn-s" data-act="edit-today" data-key="bar-edit">Изменить в «Сегодня»</button><button type="button" class="ls-btn ls-btn-primary" data-act="play"${strip.current ? ` data-ref="${ref(strip.current.content)}" data-step="${e(strip.current.id)}"` : ' disabled'} data-key="bar-start">Начать →</button></span>`
      : `<strong>План пуст</strong><span class="ls-bar-list">Добавь упражнения кнопкой «+ в план» или сразу нажми «Играть».</span><span class="ls-bar-btns"><button type="button" class="ls-btn ls-btn-primary" disabled>Начать →</button></span>`;
    regions.library.innerHTML = `<div class="ls-lib-body">
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

  function renderBasics(current: LessonState) {
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
        <button type="button" class="ls-st-btn" data-act="basics-step" data-value="${e(item.key)}" data-key="st:${e(item.key)}" aria-current="${item.key === step.key ? 'step' : 'false'}"><small>${KIND_LABEL[item.kind]}${item.done ? ' ✓' : ''}</small><span>${e(item.title)}</span></button>
        ${canAdd ? `<button type="button" class="ls-mini ls-st-add" data-act="toggle-plan" data-ref="${ref(item.content!)}" data-key="st-add:${e(item.key)}" aria-pressed="${on}" aria-label="${e(`${on ? 'Убрать из плана' : 'Добавить в план'}: ${item.title}`)}" title="${on ? 'В плане «Сегодня» — нажми, чтобы убрать' : `В план «Сегодня» · ${contentMinutes(item.content!)} мин`}">${on ? '✓' : '+'}</button>` : ''}</li>`;
    }).join('');
    regions.basics.innerHTML = `<div class="ls-basics-grid">
        <section class="ls-card ls-path" aria-label="Путь уровней">
          <div class="ls-lanes"><div><div class="ls-lane-title">Гриф и теория</div><ol class="ls-lane">${levels.filter(item => item.lane === 'main').map(levelItem).join('')}</ol></div>
            <div class="ls-side"><div class="ls-lane-title">Параллельно</div><ol class="ls-lane is-side">${levels.filter(item => item.lane === 'side').map(levelItem).join('')}</ol></div></div>
          <p class="ls-path-note">Любой уровень можно открыть в любой момент. Отметки «Чисто / С ошибками / Не успевал» ставишь ты — приложение игру не оценивает.</p>
        </section>
        <div class="ls-basics-right">
          <section class="ls-card ls-level" aria-label="Шаги уровня"><div class="ls-level-head"><h2>${level.lane === 'main' ? `Уровень ${e(level.mark)} · ` : 'Параллельно · '}${e(level.title)}</h2><span class="ls-sub">${level.status === 'done' ? 'освоено' : firstRun ? `${e(level.total)} ${plural(level.total, 'шаг', 'шага', 'шагов')}` : `${e(level.doneCount)} из ${e(level.total)} шагов`}</span></div>
            <ol class="ls-strip">${strip}</ol></section>
          <section class="ls-card ls-focus" aria-label="Текущий шаг">${focusMarkup(level, step, firstRun)}</section>
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
    const index = level.steps.indexOf(step);
    const isCurrent = step === currentBasicsStep(level) && level.status === 'current';
    let primary = '';
    if (step.kind === 'check' && step.content) primary = `<button type="button" class="ls-btn ls-btn-primary ls-btn-big" data-act="play" data-ref="${ref(step.content)}" data-key="focus-primary">▶ Проверь себя <small>${e(stepMaterial(step.content))}</small></button>`;
    else if (step.kind === 'check') primary = `<button type="button" class="ls-btn ls-btn-primary ls-btn-big" data-act="concept" data-concept="${e(concept.id)}" data-key="focus-primary">Вопрос карточки «${e(concept.title)}» →</button>`;
    else if (exercise?.content) primary = `<button type="button" class="ls-btn ls-btn-primary ls-btn-big" data-act="play" data-ref="${ref(exercise.content)}" data-key="focus-primary">▶ ${step.kind === 'concept' ? 'Дальше: сыграть упражнение' : 'Играть упражнение'} <small>${e(exercise.title)} · ${e(stepMaterial(exercise.content))}</small></button>`;
    const secondary = [
      ownExercise?.content ? addButton(ownExercise.content) : '',
      step.kind !== 'check' && ownCheck?.content ? `<button type="button" class="ls-btn ls-btn-s" data-act="play" data-ref="${ref(ownCheck.content)}" data-key="focus-check">Проверь себя · ${contentMinutes(ownCheck.content)} мин</button>` : '',
      `<button type="button" class="ls-btn ls-btn-s" data-act="concept" data-concept="${e(concept.id)}" data-key="focus-concept">Открыть карточку</button>`,
    ].join('');
    const source = conceptBoard(concept);
    return `<div class="ls-focus-top"><span class="ls-eyebrow">${isCurrent ? (firstRun ? 'Первый шаг' : 'Твой текущий шаг') : 'Выбранный шаг'} · ${level.lane === 'main' ? `уровень ${e(level.mark)}` : e(level.title.toLowerCase())} · шаг ${e(index + 1)} из ${e(level.steps.length)}</span><span class="ls-chip ls-chip-concept">${e(KIND_LABEL[step.kind])} · ${e(concept.title)}</span></div>
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
      ? `<ul aria-label="Результаты поиска">${hits.map(hit => `<li><button type="button" data-act="${hit.kind === 'concept' ? 'search-concept' : 'play'}"${hit.kind === 'concept' ? ` data-value="${e(hit.stepKey!)}" data-level="${e(hit.levelKey!)}"` : ` data-ref="${ref(hit.content!)}"`}><span>${e(hit.title)}</span><small>${e(hit.hint)}</small></button></li>`).join('')}</ul>`
      : '<p>Ничего не нашлось — попробуй «пентатоника», «октава» или «доля».</p>';
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
      basics: state.firstRun ? 'ур. 0' : basicsBadge(levels),
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
        case 'toggle-plan': if (content) togglePlan(content); break;
        case 'edit': editing = !editing; render(); break;
        case 'edit-today': editing = true; selectTab('today'); render(); container.querySelector<HTMLElement>('[data-key="edit"]')?.focus(); break;
        case 'go-library': selectTab('library'); container.querySelector<HTMLElement>(`#${id}-panel-library`)?.focus({ preventScroll: true }); break;
        case 'go-category': library = { ...DEFAULT_LIBRARY, category: target.dataset.category as LibraryCategory }; selectTab('library'); render(); container.querySelector<HTMLElement>(`[data-key="cat:${library.category}"]`)?.focus(); break;
        case 'basics-start': {
          const levels = basicsCourse(state.records, state.userExercises);
          basicsLevel = levels[0].key; basicsStep = levels[0].steps[0]?.key ?? null;
          selectTab('basics'); render(); container.querySelector<HTMLElement>('[data-key="focus-primary"]')?.focus(); break;
        }
        case 'template': {
          const key = target.dataset.template as keyof typeof PLAN_TEMPLATES;
          if (!Object.hasOwn(PLAN_TEMPLATES, key)) break;
          changePlan(appendTemplate(state.plan, key, state.userExercises), `План собран: ${PLAN_TEMPLATES[key].title}`);
          break;
        }
        case 'ear': if (stepId) changePlan(toggleStepEar(state.plan, stepId), step?.content.kind === 'check' && !step.content.spec.ear ? 'Слух включён для шага проверки' : 'Слух выключен для шага проверки'); break;
        case 'minutes': if (step) changePlan(setStepMinutes(state.plan, step.id, step.minutes + Number(target.dataset.delta)), `${stepTitle(step.content, state.userExercises)}: ${step.minutes + Number(target.dataset.delta)} мин`); break;
        case 'move': if (step) { const next = moveStep(state.plan, step.id, Number(target.dataset.delta) as -1 | 1); if (next !== state.plan) changePlan(next, `${Number(target.dataset.delta) < 0 ? 'Выше' : 'Ниже'}: ${stepTitle(step.content, state.userExercises)}`); } break;
        case 'remove': if (step) changePlan(removeStep(state.plan, step.id), `Убрано из плана: ${stepTitle(step.content, state.userExercises)}`); break;
        case 'concept': if (target.dataset.concept) options.onOpenConcept(target.dataset.concept); break;
        case 'category': library = { ...library, category: target.dataset.value as LibraryCategory }; render(); break;
        case 'status': library = { ...library, status: target.dataset.value as LibraryControls['status'] }; render(); break;
        case 'concept-filter': library = { ...library, concept: library.concept === target.dataset.value ? null : target.dataset.value as LibraryControls['concept'] }; render(); break;
        case 'reset': library = { ...DEFAULT_LIBRARY, sort: library.sort }; render(); break;
        case 'save-start': if (content?.kind === 'exercise') { saveDraft = { key: target.dataset.card!, name: `${exercisePlan(content.spec).title} · ${materialLabel(content.spec)}`.slice(0, 80).trim() }; render(); container.querySelector<HTMLInputElement>('[data-save-name]')?.select(); } break;
        case 'save-cancel': { const key = saveDraft?.key; saveDraft = null; render(); if (key) container.querySelector<HTMLElement>(`[data-key="save:${CSS.escape(key)}"]`)?.focus(); break; }
        case 'level': basicsLevel = target.dataset.value ?? null; basicsStep = null; render(); break;
        case 'basics-step': basicsStep = target.dataset.value ?? null; render(); break;
        case 'search-concept': basicsLevel = target.dataset.level ?? null; basicsStep = target.dataset.value ?? null; searchInput.value = ''; renderSearch(); render(); container.querySelector<HTMLElement>('.ls-focus h2')?.scrollIntoView?.({ block: 'nearest' }); break;
      }
    } catch (failure) { toast(failure instanceof Error ? failure.message : String(failure)); }
  }, listen);

  container.addEventListener('change', event => {
    const control = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!control || !state) return;
    if (control.dataset.control === 'play-from') { options.onPlayFromChange(control.value || null); return; }
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
    const item = libraryItems(state.playFrom, state.userExercises).find(candidate => candidate.key === form.dataset.save);
    if (!name || !item) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    try {
      options.onSaveExercise(item.spec, name.slice(0, 80));
      saveDraft = null; toast(`Сохранено как своё упражнение: ${name.slice(0, 80)}`); render();
    } catch (failure) { toast(failure instanceof Error ? failure.message : String(failure)); }
  }, listen);

  container.addEventListener('input', event => {
    if (event.target === searchInput) { renderSearch(); return; }
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
