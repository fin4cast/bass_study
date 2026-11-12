/**
 * Экран игры VIS-11 r2 (R-026): один транспорт, четыре вида от подсказки к памяти, самооценка после прохода.
 * Подсветка идёт по состоянию порта на аудиочасах (requestAnimationFrame), а не по таймеру страницы.
 * Модуль самостоятелен: не пишет в хранилище и не знает меню; запоминание вида и запись самооценки —
 * у хоста через `onViewChange` и `onRate`.
 */
import type { ConceptId, ExercisePlan, ExerciseSpec } from '../../exercises';
import { createNotationPlan, type NotationEvent } from '../../notation';
import { conceptForExerciseConcept, parseConceptText, type ReferenceConcept } from '../../practice/concepts';
import { allowsTransportShortcut } from '../transport-shortcut';
import { escapeHtml } from '../p13/escape';
import { boardGeometry, boardNotesFromPlan, formatDegree, formatPosition, pitchLetter, planFretWindow, renderBoard, type BoardLabelMode } from './board';
import {
  BPM_MAX, BPM_MIN, BPM_STEP, CONCEPT_LABELS, PLAY_VIEWS, clampBpm, isPlayView, junctionText, junctions, ladderEnd, playbackConfig, plural,
  progressText, shiftText, suggestion, upcomingJunction, type Assessment, type Junction, type PlaySettings, type PlayView, type SuggestionAction,
} from './model';
import { createEnginePort, type PlayState, type PlaybackPort } from './port';
import { barRange, pageRange, renderTab, slotsPerBar, tabGeometry } from './tab';

export type { PlayView, Assessment } from './model';

export interface RateEvent {
  readonly assessment: Assessment;
  readonly bpm: number;
  readonly passIndex: number;
  /** Активное время прохода по аудиочасам: без отсчёта и пауз. */
  readonly activeMs: number;
}

export interface MountPlayOptions {
  /** Порт звука; по умолчанию — `createEnginePort()`, который экран освобождает сам. */
  readonly port?: PlaybackPort;
  readonly initialView?: PlayView;
  readonly bpm?: number;
  /** Подпись кнопки возврата, например «← Занятие · шаг 2 из 4». */
  readonly backLabel?: string;
  readonly onBack?: () => void;
  readonly onRate?: (event: RateEvent) => void;
  readonly onViewChange?: (view: PlayView) => void;
  /** «Сначала услышь»: эталон до игры. Без обработчика кнопка скрыта. */
  readonly onListen?: () => void;
  /** Понятие упражнения (`ConceptId`): чип в шапке или «Открыть в справочнике». */
  readonly onConcept?: (id: ConceptId) => void;
}

export interface PlayHandle {
  /** Новое упражнение: игра останавливается, петля и самооценка сбрасываются. */
  setExercise(plan: ExercisePlan, spec?: ExerciseSpec): void;
  setView(view: PlayView): void;
  getView(): PlayView;
  /** Экран скрыт хостом: игра ставится на паузу, клавиши не обрабатываются. Продолжение — только действием. */
  setVisible(visible: boolean): void;
  stop(): void;
  dispose(): void;
}

const LABEL_MODES: readonly { readonly id: BoardLabelMode; readonly label: string }[] = [
  { id: 'name', label: 'Ноты' }, { id: 'degree', label: 'Ступени' }, { id: 'finger', label: 'Пальцы' },
];
const ASSESSMENTS: readonly { readonly id: Assessment; readonly label: string }[] = [
  { id: 'clean', label: 'Чисто' }, { id: 'errors', label: 'С ошибками' }, { id: 'slow', label: 'Не успевал' },
];
const ACTIVE = new Set<PlayState['status']>(['counting', 'playing']);
const BARS_PER_PAGE = 2;

const TEMPLATE = `
<section class="pl-scene" data-status="stopped" aria-label="Экран игры">
  <header class="pl-head">
    <div class="pl-head-copy">
      <button type="button" class="pl-back" data-back></button>
      <div class="pl-title-row"><h1 class="pl-title" data-title></h1><span class="pl-sub" data-sub></span><span class="pl-chips" data-chips></span></div>
    </div>
    <div class="pl-head-tools">
      <button type="button" class="text-button pl-listen" data-listen title="Слух как опция: эталон звучит до игры">♪ Сначала услышь</button>
      <div class="pl-seg" role="group" aria-label="Подписи на грифе" data-labels>${LABEL_MODES.map(mode => `<button type="button" data-label="${escapeHtml(mode.id)}" aria-pressed="false">${escapeHtml(mode.label)}</button>`).join('')}</div>
    </div>
  </header>
  <div class="pl-views"><span class="pl-views-caption">Вид · от подсказки к памяти</span><div class="pl-seg pl-seg-views" role="group" aria-label="Вид экрана игры">${PLAY_VIEWS.map((view, index) => `<button type="button" data-view="${escapeHtml(view.id)}" aria-pressed="false" aria-keyshortcuts="${index + 1}"><i>${index + 1}</i>${escapeHtml(view.label)}</button>`).join('')}</div></div>
  <div class="pl-stage">
    <div class="pl-area" data-area="board">
      <div class="pl-strip">
        <div class="pl-now"><span data-now-caption>Сейчас</span><strong data-now>—</strong><span data-now-detail></span></div>
        <div class="pl-tabcard"><header><span>TAB · текущий такт</span><span data-bar-label="board"></span></header><div class="pl-fit" data-tab="board"></div></div>
      </div>
      <div class="pl-fit pl-board" data-board="board"></div>
      <div class="pl-row" data-slot="board"></div>
    </div>
    <div class="pl-area" data-area="both">
      <div class="pl-tabcard"><header><span>TAB · бас E–A–D–G</span><span data-bar-label="both"></span></header><div class="pl-fit" data-tab="both"></div></div>
      <div class="pl-fit pl-board" data-board="both"></div>
      <div class="pl-row" data-slot="both"></div>
    </div>
    <div class="pl-area" data-area="tab">
      <div class="pl-cgrid">
        <div class="pl-cmain">
          <div class="pl-cbar"><span data-bar-label="tab"></span><span>счёт: 1 и 2 и 3 и 4 и</span></div>
          <div class="pl-tabcard pl-tab-big"><div class="pl-fit" data-tab="tab"></div></div>
          <div class="pl-tabcard pl-tab-next"><div class="pl-fit" data-tab="tab-next"></div></div>
          <div class="pl-row" data-slot="tab-main"></div>
        </div>
        <aside class="pl-cside"><div class="pl-fit pl-board pl-board-mini" data-board="tab"></div><div class="pl-cside-row" data-slot="tab-side"></div></aside>
      </div>
    </div>
    <div class="pl-area" data-area="memory">
      <div class="pl-mbox">
        <div class="pl-mcell"><span>Старт</span><strong data-mem-start></strong><span data-mem-start-detail></span></div>
        <div class="pl-mcell"><span>Сейчас</span><strong data-mem-bar>—</strong><span data-mem-detail></span></div>
        <div class="pl-mcell"><span data-mem-junction-caption>Переход</span><strong data-mem-junction></strong><span data-mem-junction-detail></span></div>
      </div>
      <div class="pl-row" data-slot="memory"></div>
    </div>
  </div>
  <div class="pl-transport" data-transport>
    <div class="pl-countin" data-countin hidden><small>Отсчёт</small><span data-countin-value></span></div>
    <button type="button" class="primary-button pl-play" data-play aria-keyshortcuts="Space"><span data-play-label>▶ Играть</span><kbd>Пробел</kbd></button>
    <button type="button" class="secondary-button pl-restart" data-restart aria-keyshortcuts="Escape" title="Вернуться к первой ноте; следующий старт — с отсчётом">⏮ С начала<kbd>Esc</kbd></button>
    <div class="pl-bpm" role="group" aria-label="Темп">
      <button type="button" class="pl-icon-btn" data-bpm-step="-${BPM_STEP}" aria-label="Медленнее на ${BPM_STEP} BPM">−</button>
      <output data-bpm></output>
      <button type="button" class="pl-icon-btn" data-bpm-step="${BPM_STEP}" aria-label="Быстрее на ${BPM_STEP} BPM">+</button>
      <small>BPM ♩<br>играем восьмыми</small>
    </div>
    <button type="button" class="pl-toggle" data-flag="countIn" aria-pressed="true">Отсчёт 4</button>
    <button type="button" class="pl-toggle" data-flag="loop" aria-pressed="true">⟲ По кругу</button>
    <button type="button" class="pl-toggle" data-flag="ladder" aria-pressed="false" title="Лестница темпа: +${BPM_STEP} BPM за проход">↗ <span data-ladder-label></span></button>
    <button type="button" class="pl-toggle pl-range-chip" data-clear-range aria-pressed="true" hidden></button>
    <div class="pl-progress">
      <div class="pl-meter" aria-hidden="true"><i data-meter></i></div>
      <small data-progress-text></small>
      <small class="pl-pending" data-pending hidden>новые настройки — со следующего старта</small>
      <small class="pl-error" data-error role="alert" hidden></small>
    </div>
    <p class="pl-sr" data-sr aria-live="polite"></p>
  </div>
</section>`;

export function mountPlay(container: HTMLElement, options: MountPlayOptions = {}): PlayHandle {
  const ownPort = !options.port;
  const port = options.port ?? createEnginePort();
  const controller = new AbortController();
  const { signal } = controller;
  container.innerHTML = TEMPLATE;
  const scene = container.querySelector<HTMLElement>('.pl-scene')!;
  const at = <T extends Element = HTMLElement>(selector: string) => scene.querySelector<T>(selector)!;
  const all = <T extends Element = HTMLElement>(selector: string) => [...scene.querySelectorAll<T>(selector)];

  /* ---------- Переносимые блоки: переход, легенда, понятие, самооценка ---------- */
  const shiftEl = document.createElement('div');
  shiftEl.className = 'pl-shift';
  shiftEl.innerHTML = '<span>Переход</span><b data-shift-text></b><span class="pl-shift-tail" data-shift-tail></span>';
  const legendEl = document.createElement('div');
  legendEl.className = 'pl-legend';
  const conceptEl = document.createElement('details');
  conceptEl.className = 'pl-concept';
  conceptEl.innerHTML = '<summary><span aria-hidden="true">ⓘ</span><span data-concept-title></span></summary><p data-concept-text></p><button type="button" class="text-button button-compact" data-concept-open>Открыть в справочнике →</button>';
  const rateEl = document.createElement('div');
  rateEl.className = 'pl-rate';
  rateEl.hidden = true;
  rateEl.setAttribute('role', 'group');
  rateEl.setAttribute('aria-label', 'Самооценка прохода');
  rateEl.innerHTML = `<strong data-rate-title></strong><span>Как прошло?</span>${ASSESSMENTS.map(item => `<button type="button" class="secondary-button button-compact" data-rate="${escapeHtml(item.id)}" aria-pressed="false">${escapeHtml(item.label)}</button>`).join('')}<span class="pl-suggest" data-suggest aria-live="polite"></span><button type="button" class="text-button button-compact pl-rate-close" data-rate-close aria-label="Скрыть самооценку">✕</button>`;

  /* ---------- Состояние ---------- */
  let plan: ExercisePlan | null = null;
  let events: readonly NotationEvent[] = [];
  let junctionList: Junction[] = [];
  let concept: { id: ConceptId; card: ReferenceConcept } | null = null;
  let view: PlayView = isPlayView(options.initialView) ? options.initialView : 'both';
  let labels: BoardLabelMode = 'name';
  let settings: PlaySettings = { bpm: clampBpm(options.bpm ?? 72), countIn: true, loop: true, ladder: false, range: null };
  let runSettings: PlaySettings | null = null;
  let state: PlayState = port.state();
  let shownIndex: number | null = null;
  let fromStart = false;
  let visible = true;
  let disposed = false;
  let raf = 0;
  let busy = false;
  let errorText = '';
  // Проходы текущего запуска.
  let lastPass = 0;
  let completedPass = -1;
  let passBpm = settings.bpm;
  let activeMs = 0;
  let previous: { status: PlayState['status']; audioTime: number } | null = null;
  let pendingRate: { passIndex: number; bpm: number; activeMs: number } | null = null;
  let rated: { assessment: Assessment; bpm: number } | null = null;
  let sceneKey = '';
  let srKey = '';

  const runActive = () => runSettings !== null;
  const total = () => plan?.notes.length ?? 0;
  const range = () => settings.range ?? { from: 0, toExclusive: total() };
  const activeRange = () => (runSettings ?? settings).range ?? { from: 0, toExclusive: total() };

  /* ---------- Шапка и понятие ---------- */
  function renderHeader() {
    const back = at<HTMLButtonElement>('[data-back]');
    back.textContent = options.backLabel ?? '← Занятие';
    back.hidden = !options.onBack;
    at('[data-listen]').hidden = !options.onListen;
    at('[data-title]').textContent = plan?.title ?? 'Упражнение не выбрано';
    const bars = events.length ? events[events.length - 1].bar + 1 : 0;
    at('[data-sub]').textContent = plan ? `${total()} ${plural(total(), 'восьмая', 'восьмых', 'восьмых')} · ${bars} ${plural(bars, 'такт', 'такта', 'тактов')}` : '';
    const chips = at('[data-chips]');
    chips.replaceChildren(...(plan?.concepts ?? []).map(id => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pl-chip';
      chip.dataset.concept = id;
      chip.textContent = CONCEPT_LABELS[id];
      chip.title = conceptForExerciseConcept(id)?.summary ?? '';
      if (!options.onConcept) chip.disabled = true;
      return chip;
    }));
    concept = null;
    for (const id of plan?.concepts ?? []) {
      const card = conceptForExerciseConcept(id);
      if (card) { concept = { id, card }; break; }
    }
    conceptEl.hidden = !concept;
    if (concept) {
      conceptEl.open = false;
      conceptEl.querySelector('[data-concept-title]')!.textContent = `Почему: ${concept.card.title.toLowerCase()}`;
      const why = concept.card.full?.why ?? concept.card.brief?.why ?? '';
      const paragraph = conceptEl.querySelector<HTMLElement>('[data-concept-text]')!;
      paragraph.replaceChildren(...conceptNodes(`${concept.card.summary} ${why}`.trim()));
      conceptEl.querySelector<HTMLElement>('[data-concept-open]')!.hidden = !options.onConcept;
    }
    renderLegend();
  }

  function conceptNodes(text: string): Node[] {
    return parseConceptText(text).map(part => {
      if (part.kind === 'text') return document.createTextNode(part.text);
      const node = document.createElement(part.kind === 'strong' ? 'b' : 'span');
      if (part.kind === 'strong') node.textContent = part.text;
      else if (part.kind === 'position') { node.className = 'pl-pos'; node.textContent = `${formatPosition(part.positionId)}${part.label ? ` · ${part.label}` : ''}`; }
      else if (part.kind === 'finger') { node.className = 'pl-finger'; node.textContent = `палец ${part.text}`; }
      else { node.className = `pl-${part.kind}`; node.textContent = part.text; }
      return node;
    });
  }

  function renderLegend() {
    const items: { cls: string; text: string }[] = [];
    if (plan?.notes.some(note => note.degree === '1')) items.push({ cls: 'is-root', text: 'Тоника (на общей позиции — кольцо)' });
    const segments = plan?.segments ?? [];
    if (segments.length <= 2) segments.forEach((segment, index) => items.push({ cls: index % 2 ? 'is-b' : 'is-a', text: segment.label }));
    else items.push({ cls: 'is-a', text: 'Сегменты 1, 3, 5…' }, { cls: 'is-b', text: 'Сегменты 2, 4…' });
    if (plan && boardNotesFromPlan(plan).some(note => note.kind === 'shared')) items.push({ cls: 'is-shared', text: 'Общие позиции' });
    items.push({ cls: 'is-next', text: 'Следующая нота' });
    legendEl.replaceChildren(...items.map(item => {
      const span = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.className = `pl-swatch ${item.cls}`;
      span.append(swatch, item.text);
      return span;
    }));
  }

  /* ---------- Вид и раскладка блоков ---------- */
  function placeBlocks() {
    const slot = (name: string) => at(`[data-slot="${name}"]`);
    if (view === 'board') slot('board').replaceChildren(shiftEl, conceptEl, rateEl);
    else if (view === 'both') slot('both').replaceChildren(legendEl, conceptEl, rateEl);
    else if (view === 'tab') { slot('tab-main').replaceChildren(rateEl); slot('tab-side').replaceChildren(shiftEl, conceptEl); }
    else slot('memory').replaceChildren(conceptEl, rateEl);
    shiftEl.classList.toggle('is-compact', view === 'tab');
  }

  function setView(next: PlayView, notify = true) {
    if (!isPlayView(next)) return;
    const changed = next !== view;
    view = next;
    scene.dataset.view = view;
    all<HTMLButtonElement>('button[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    at('[data-labels]').hidden = !(view === 'board' || view === 'both');
    placeBlocks();
    sceneKey = '';
    renderScene();
    if (changed) renderSuggestion();
    if (changed && notify) options.onViewChange?.(view);
  }

  function setLabels(mode: BoardLabelMode) {
    labels = mode;
    all<HTMLButtonElement>('button[data-label]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.label === mode)));
    sceneKey = '';
    renderScene();
  }

  /* ---------- Сцена ---------- */
  function currentIndex(): number | null {
    if (state.status === 'playing' || state.status === 'paused') return shownIndex;
    return null;
  }
  function nextIndex(current: number | null): number | null {
    const { from, toExclusive } = activeRange();
    if (!plan || from >= toExclusive) return null;
    if (current === null) return from;
    if (current + 1 < toExclusive) return current + 1;
    const repeating = runSettings ? runSettings.ladder || runSettings.loop : settings.ladder || settings.loop;
    return repeating ? from : null;
  }
  function fill(element: HTMLElement, svg: string, width: number, height: number) {
    element.innerHTML = svg;
    element.style.aspectRatio = `${width} / ${height}`;
  }

  function renderScene() {
    if (!plan) {
      all('[data-board], [data-tab]').forEach(element => element.replaceChildren());
      return;
    }
    const current = currentIndex();
    const next = nextIndex(current);
    const key = [view, labels, current, next, state.status, plan.title, settings.range?.from, settings.range?.toExclusive].join('|');
    if (key === sceneKey) return;
    sceneKey = key;
    const focus = current ?? next ?? 0;
    const focusNote = plan.notes[focus];
    const segment = focusNote.segment;
    const currentId = current === null ? null : plan.notes[current].id;
    const nextId = next === null ? null : plan.notes[next].id;
    const bars = events.length ? events[events.length - 1].bar + 1 : 1;
    const bar = events[focus]?.bar ?? 0;
    const segmentLabel = plan.segments[segment]?.label ?? '';
    const perBar = slotsPerBar(events[0]?.durationBeats ?? 0.5);
    const boardFor = (mode: BoardLabelMode, pad: number, width: number, marker: number, fretLabels = true) => {
      const window = planFretWindow(plan!, { pad, minSpan: 6 });
      const geometry = boardGeometry({ width, marker, fretLabels });
      return { svg: renderBoard({ notes: boardNotesFromPlan(plan!, { labels: mode, segment }), ...window, current: currentId, next: nextId, width, marker, fretLabels }), width, height: geometry.height };
    };
    const tabFor = (bounds: { from: number; count: number; slots: number }, width: number, lineGap: number, fontSize: number, extra: { showCount?: boolean; dimPlayed?: boolean; cursor?: boolean; label?: string } = {}) => {
      const geometry = tabGeometry({ width, lineGap, showCount: extra.showCount });
      return { svg: renderTab({ events, current: extra.cursor === false ? -1 : current, ...bounds, width, lineGap, fontSize, ...extra }), width, height: geometry.height };
    };
    const put = (selector: string, result: { svg: string; width: number; height: number }) => fill(at(selector), result.svg, result.width, result.height);
    const barLabel = `такт ${bar + 1} из ${bars} · ${segmentLabel}`;

    if (view === 'board') {
      const { from, count } = barRange(events, bar);
      put('[data-tab="board"]', tabFor({ from, count, slots: perBar }, 900, 15, 15, { label: `Табулатура, такт ${bar + 1}` }));
      at('[data-bar-label="board"]').textContent = barLabel;
      at('[data-now-caption]').textContent = current === null ? 'Старт' : 'Сейчас';
      at('[data-now]').textContent = pitchLetter(focusNote.name);
      at('[data-now-detail]').textContent = [formatPosition(focusNote.id), focusNote.degree ? `ступень ${formatDegree(focusNote.degree)}` : ''].filter(Boolean).join(' · ');
      put('[data-board="board"]', boardFor(labels, 2, 1000, 44));
    } else if (view === 'both') {
      const page = pageRange(events, bar, BARS_PER_PAGE);
      put('[data-tab="both"]', tabFor(page, 1000, 18, 17, { label: `Табулатура, такты ${page.firstBar + 1}–${page.lastBar + 1}` }));
      const pageSegments = [...new Set(plan.notes.slice(page.from, page.from + page.count).map(note => note.segment))].map(index => plan!.segments[index]?.label).filter(Boolean);
      const prefix = page.totalBars > BARS_PER_PAGE ? `такты ${page.firstBar + 1}–${page.lastBar + 1} из ${page.totalBars} · ` : '';
      at('[data-bar-label="both"]').textContent = prefix + pageSegments.join(' → ');
      put('[data-board="both"]', boardFor(labels, 2, 1000, 40));
    } else if (view === 'tab') {
      const { from, count } = barRange(events, bar);
      put('[data-tab="tab"]', tabFor({ from, count, slots: perBar }, 760, 34, 28, { dimPlayed: true, label: `Табулатура крупно, такт ${bar + 1}` }));
      const following = (bar + 1) % bars;
      const nextBar = barRange(events, following);
      put('[data-tab="tab-next"]', tabFor({ ...nextBar, slots: perBar }, 760, 14, 13, { showCount: false, cursor: false, label: `Следующий такт ${following + 1}` }));
      at('[data-bar-label="tab"]').textContent = `Т${barLabel.slice(1)} · ниже — следующий`;
      put('[data-board="tab"]', boardFor('none', 1, 280, 22));
    } else {
      const start = plan.notes[range().from];
      at('[data-mem-start]').textContent = formatPosition(start.id);
      at('[data-mem-start-detail]').textContent = [start.name, start.finger === null ? '' : `палец ${start.finger}`, plan.segments[start.segment]?.label].filter(Boolean).join(' · ');
      at('[data-mem-bar]').textContent = current === null ? '—' : `такт ${bar + 1}`;
      at('[data-mem-detail]').textContent = current !== null ? segmentLabel : state.status === 'counting' ? 'отсчёт 4 доли' : (runSettings ?? settings).countIn ? 'старт с отсчётом 4 доли' : 'старт без отсчёта';
    }
    renderJunction(current);
  }

  function renderJunction(current: number | null) {
    if (!plan) return;
    const junction = upcomingJunction(junctionList, current);
    shiftEl.hidden = !junction;
    if (junction) {
      shiftEl.querySelector('[data-shift-text]')!.textContent = junctionText(junction);
      const tail = plan.segments[junction.to.segment]?.label;
      shiftEl.querySelector('[data-shift-tail]')!.textContent = tail ? `дальше: ${tail}` : '';
      at('[data-mem-junction-caption]').textContent = 'Переход';
      at('[data-mem-junction]').textContent = `${formatPosition(junction.from.id)} → ${formatPosition(junction.to.id)}`;
      at('[data-mem-junction-detail]').textContent = [shiftText(junction.shift), junction.to.finger === null ? '' : `палец ${junction.to.finger}`].filter(Boolean).join(' · ');
    } else {
      const last = plan.notes[range().toExclusive - 1] ?? plan.notes[plan.notes.length - 1];
      at('[data-mem-junction-caption]').textContent = 'Финиш';
      at('[data-mem-junction]').textContent = formatPosition(last.id);
      at('[data-mem-junction-detail]').textContent = last.name;
    }
  }

  /* ---------- Транспорт ---------- */
  function renderTransport() {
    scene.dataset.status = state.status;
    const playLabel = state.status === 'playing' || state.status === 'counting' ? '❚❚ Пауза' : state.status === 'paused' ? '▶ Продолжить' : '▶ Играть';
    setText(at('[data-play-label]'), playLabel);
    at<HTMLButtonElement>('[data-play]').disabled = !plan;
    const countIn = at('[data-countin]');
    countIn.hidden = state.status !== 'counting' || state.countBeat === null;
    setText(at('[data-countin-value]'), state.countBeat === null ? '' : String(state.countBeat));
    const ladderRunning = !!runSettings?.ladder && state.status !== 'stopped' && state.status !== 'finished';
    const bpm = ladderRunning ? Math.round(state.bpm) : settings.bpm;
    setText(at('[data-bpm]'), String(bpm));
    all<HTMLButtonElement>('[data-bpm-step]').forEach(button => {
      const step = Number(button.dataset.bpmStep);
      button.disabled = ladderRunning || (step < 0 ? settings.bpm <= BPM_MIN : settings.bpm >= BPM_MAX);
    });
    for (const flag of ['countIn', 'loop', 'ladder'] as const) at(`[data-flag="${flag}"]`).setAttribute('aria-pressed', String(settings[flag]));
    setText(at('[data-ladder-label]'), `Лестница ${settings.bpm} → ${ladderEnd(settings.bpm)}, +${BPM_STEP}`);
    const chip = at<HTMLButtonElement>('[data-clear-range]');
    chip.hidden = !settings.range;
    if (settings.range) {
      setText(chip, `Петля ${settings.range.from + 1}–${settings.range.toExclusive} ✕`);
      chip.setAttribute('aria-label', `Снять петлю на ноты ${settings.range.from + 1}–${settings.range.toExclusive}`);
    }
    const index = currentIndex();
    const n = total();
    const meter = index === null ? (state.status === 'finished' ? n : 0) : index + 1;
    at('[data-meter]').style.width = `${n ? (meter / n) * 100 : 0}%`;
    setText(at('[data-progress-text]'), progressText(state, state.status === 'finished' ? null : index, n, { fromStart, range: activeRange().from === 0 && activeRange().toExclusive === n ? null : activeRange() }));
    at('[data-pending]').hidden = !runActive() || !differsForNextStart(runSettings!, settings) || state.status === 'stopped' || state.status === 'finished';
    const error = at('[data-error]');
    error.hidden = !errorText;
    setText(error, errorText);
    // Живая область текущей ноты: объявляется смена ноты или состояния.
    const note = index === null || !plan ? null : plan.notes[index];
    const announce = state.status === 'counting' ? '' : note ? `Нота ${index! + 1} из ${n}: ${note.name}, ${formatPosition(note.id)}${state.status === 'paused' ? ', пауза' : ''}` : state.status === 'finished' ? 'Проход завершён' : '';
    const key = `${state.status}|${index}`;
    if (key !== srKey) { srKey = key; setText(at('[data-sr]'), announce); }
  }
  function setText(element: Element, text: string) { if (element.textContent !== text) element.textContent = text; }
  function differsForNextStart(running: PlaySettings, next: PlaySettings) {
    return running.countIn !== next.countIn || running.loop !== next.loop || running.ladder !== next.ladder
      || running.range?.from !== next.range?.from || running.range?.toExclusive !== next.range?.toExclusive
      || (running.ladder && running.bpm !== next.bpm);
  }

  /* ---------- Проходы и самооценка ---------- */
  function observe(nextState: PlayState) {
    if (runActive()) {
      if (nextState.status === 'playing' && previous?.status === 'playing') activeMs += Math.max(0, nextState.audioTime - previous.audioTime) * 1000;
      if ((nextState.status === 'playing' || nextState.status === 'paused') && nextState.passIndex > lastPass) {
        completePass(lastPass);
        lastPass = nextState.passIndex;
      }
      if (nextState.status === 'playing' && nextState.passIndex === lastPass) passBpm = nextState.bpm;
      if (nextState.status === 'finished') {
        completePass(Math.max(lastPass, nextState.passIndex));
        runSettings = null;
      }
    }
    if (nextState.noteIndex !== null) shownIndex = nextState.noteIndex;
    if (nextState.status === 'stopped' || nextState.status === 'counting') shownIndex = null;
    previous = { status: nextState.status, audioTime: nextState.audioTime };
    state = nextState;
  }
  function completePass(passIndex: number) {
    if (passIndex <= completedPass) return;
    completedPass = passIndex;
    pendingRate = { passIndex, bpm: Math.round(passBpm), activeMs: Math.round(activeMs) };
    activeMs = 0;
    openRate();
  }
  function openRate() {
    if (!pendingRate) return;
    rated = null;
    rateEl.hidden = false;
    scene.classList.add('is-rated');
    rateEl.querySelector('[data-rate-title]')!.textContent = `Проход ${pendingRate.passIndex + 1} завершён.`;
    rateEl.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach(button => { button.disabled = false; button.setAttribute('aria-pressed', 'false'); });
    rateEl.querySelector('[data-suggest]')!.replaceChildren();
  }
  function closeRate() {
    rateEl.hidden = true;
    scene.classList.remove('is-rated');
    pendingRate = null;
  }
  function rate(assessment: Assessment) {
    if (!pendingRate || !plan || rated) return;
    rated = { assessment, bpm: pendingRate.bpm };
    const event: RateEvent = { assessment, ...pendingRate };
    rateEl.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach(button => {
      const chosen = button.dataset.rate === assessment;
      button.setAttribute('aria-pressed', String(chosen));
      button.disabled = !chosen;
    });
    renderSuggestion();
    options.onRate?.(event);
  }
  /** Предложение пересчитывается при смене вида: «следующий вид» всегда от текущего. */
  function renderSuggestion() {
    if (!rated || !plan) return;
    const advice = suggestion(rated.assessment, { bpm: rated.bpm, view, plan });
    const box = rateEl.querySelector<HTMLElement>('[data-suggest]')!;
    const text = document.createElement('span');
    text.textContent = advice.text;
    box.replaceChildren(text, ...advice.actions.map(action => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button button-compact';
      button.textContent = action.label;
      button.addEventListener('click', () => applySuggestion(action), { signal });
      return button;
    }));
  }
  function applySuggestion(action: SuggestionAction) {
    if (action.kind === 'view') { setView(action.view); return; }
    if (action.kind === 'bpm') { applyBpm(action.bpm); return; }
    settings = { ...settings, range: action.range, loop: true, ladder: false };
    if (runActive() && state.status !== 'stopped' && state.status !== 'finished') void begin(true);
    else update();
  }

  /* ---------- Действия ---------- */
  function applyBpm(value: number) {
    const bpm = clampBpm(value);
    settings = { ...settings, bpm };
    const live = runActive() && !runSettings!.ladder && (state.status === 'playing' || state.status === 'counting' || state.status === 'paused');
    if (live) {
      try { port.setBpm(bpm); runSettings = { ...runSettings!, bpm }; } catch (failure) { errorText = message(failure); }
    }
    update();
  }
  const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);

  async function begin(restart = false) {
    if (!plan || disposed) return;
    errorText = '';
    const config = playbackConfig(plan, settings);
    runSettings = { ...settings };
    lastPass = 0; completedPass = -1; activeMs = 0; passBpm = settings.bpm; previous = null; fromStart = false; shownIndex = null;
    busy = true;
    const run = restart ? port.restart(config) : port.start(config);
    update();
    try { await run; }
    catch (failure) {
      errorText = `Звук не запустился: ${message(failure)}`;
      runSettings = null;
      try { port.stop(); } catch { /* исходная ошибка остаётся видимой */ }
    } finally { busy = false; update(); }
  }
  function toggle() {
    if (!plan || disposed) return;
    const status = port.state().status;
    if (status === 'counting' || status === 'playing') port.pause('manual');
    else if (status === 'paused') {
      errorText = '';
      busy = true;
      port.resume().catch(failure => { errorText = `Звук не продолжился: ${message(failure)}`; }).finally(() => { busy = false; update(); });
    } else void begin();
    update();
  }
  function toStart() {
    if (disposed) return;
    try { port.stop(); } catch (failure) { errorText = message(failure); }
    runSettings = null;
    fromStart = true;
    shownIndex = null;
    update();
  }
  function setFlag(flag: 'countIn' | 'loop' | 'ladder') {
    const on = !settings[flag];
    if (flag === 'loop') settings = { ...settings, loop: on, ladder: on ? false : settings.ladder };
    else if (flag === 'ladder') settings = { ...settings, ladder: on, loop: on ? false : settings.loop };
    else settings = { ...settings, countIn: on };
    update();
  }

  /* ---------- Цикл кадра ---------- */
  function update() {
    if (disposed) return;
    observe(port.state());
    renderScene();
    renderTransport();
    if (!raf && visible && (busy || ACTIVE.has(state.status))) raf = requestAnimationFrame(frame);
  }
  function frame() { raf = 0; update(); }
  function pauseHidden() {
    const status = port.state().status;
    if (status === 'counting' || status === 'playing') port.pause('hidden');
  }

  /* ---------- События ---------- */
  scene.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('button');
    if (!button || !scene.contains(button) || button.disabled) return;
    const data = button.dataset;
    if (data.view) setView(data.view as PlayView);
    else if (data.label) setLabels(data.label as BoardLabelMode);
    else if (data.play !== undefined) toggle();
    else if (data.restart !== undefined) toStart();
    else if (data.bpmStep) applyBpm(settings.bpm + Number(data.bpmStep));
    else if (data.flag) setFlag(data.flag as 'countIn' | 'loop' | 'ladder');
    else if (data.clearRange !== undefined) { settings = { ...settings, range: null }; sceneKey = ''; update(); }
    else if (data.rate) rate(data.rate as Assessment);
    else if (data.rateClose !== undefined) closeRate();
    else if (data.back !== undefined) options.onBack?.();
    else if (data.listen !== undefined) options.onListen?.();
    else if (data.concept) options.onConcept?.(data.concept as ConceptId);
    else if (data.conceptOpen !== undefined && concept) options.onConcept?.(concept.id);
  }, { signal });

  document.addEventListener('keydown', event => {
    if (disposed || !visible || !plan) return;
    const escape = event.key === 'Escape';
    const space = event.code === 'Space' || event.key === ' ';
    const digit = /^Digit[1-4]$/.test(event.code) ? Number(event.code.slice(5)) : 0;
    if (digit) {
      if (!allowsTransportShortcut(event, scene)) return;
      event.preventDefault();
      setView(PLAY_VIEWS[digit - 1].id);
      return;
    }
    if (!escape && !space) return;
    // Esc на собственной кнопке экрана тоже возвращает к началу: у кнопки нет своего действия на Esc.
    const ownButton = escape && event.target instanceof HTMLButtonElement && scene.contains(event.target)
      && !event.defaultPrevented && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
      && !document.querySelector('dialog[open]');
    if (!ownButton && !allowsTransportShortcut(event, scene)) return;
    event.preventDefault();
    if (escape) toStart(); else toggle();
  }, { signal });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { pauseHidden(); update(); }
  }, { signal });

  /* ---------- Запуск ---------- */
  setView(view, false);
  setLabels('name');
  renderHeader();
  update();

  return {
    setExercise(nextPlan) {
      if (disposed) return;
      try { port.stop(); } catch { /* порт уже остановлен */ }
      plan = nextPlan;
      events = createNotationPlan({ positions: nextPlan.positions, duration: 'eighth' }).events;
      junctionList = junctions(nextPlan);
      settings = { ...settings, range: null };
      runSettings = null; fromStart = false; shownIndex = null; errorText = ''; sceneKey = '';
      closeRate();
      renderHeader();
      update();
    },
    setView(next) { if (!disposed) setView(next); },
    getView: () => view,
    setVisible(next) {
      if (disposed || next === visible) return;
      visible = next;
      if (!visible) { pauseHidden(); if (raf) cancelAnimationFrame(raf); raf = 0; observe(port.state()); renderTransport(); }
      else update();
    },
    stop() {
      if (disposed) return;
      try { port.stop(); } catch { /* порт уже остановлен */ }
      runSettings = null; fromStart = false; shownIndex = null;
      update();
    },
    dispose() {
      if (disposed) return;
      try { port.stop(); } catch { /* порт уже остановлен */ }
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      controller.abort();
      if (ownPort) port.dispose();
      container.replaceChildren();
    },
  };
}
