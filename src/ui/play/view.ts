/**
 * Экран игры VIS-11 r2 (R-026, D-050): один транспорт, четыре вида от подсказки к памяти, шкала прохода
 * с ритмом и паузами, панель «Звук и ритм», оценка подхода, петля по тактам, таймер шага плана.
 * Подсветка идёт по состоянию порта на аудиочасах (requestAnimationFrame), а не по таймеру страницы.
 * Модуль самостоятелен: не пишет в хранилище и не знает меню; запоминание настроек и запись самооценки —
 * у хоста через `onSettingsChange`, `onViewChange` и `onRate`.
 */
import type { ConceptId, ExercisePlan, ExerciseSpec } from '../../exercises';
import { rhythmPattern, rhythmPatternsFor, type RhythmPatternId, type Timeline } from '../../exercises/rhythm';
import { conceptForExerciseConcept, parseConceptText, type ReferenceConcept } from '../../practice/concepts';
import { GROOVE_PRESETS, presetName, type RhythmPresetId } from '../../rhythm/model';
import { allowsSceneKey, allowsTransportShortcut } from '../transport-shortcut';
import { onPageVisibility } from '../page-visibility';
import { escapeHtml } from '../html';
import { boardGeometry, boardNotesFromPlan, formatDegree, formatPosition, pitchLetter, planFretWindow, renderBoard, type BoardLabelMode } from './board';
import {
  BPM_MAX, BPM_MIN, BPM_STEP, CONCEPT_LABELS, COUNT_IN_CHOICES, DEFAULT_PLAY_SETTINGS, METRONOME_CHOICES, PLAY_VIEWS, REFERENCE_MODES,
  clampBpm, continueApproach, isPlayView, junctionText, stopApproach, junctions, ladderAvailable, listenConfig, listenProgressText, loopText, playbackConfig, plural,
  progressText, referenceAudible, shiftText, suggestion, tabEvents, timelineFor, upcomingJunction, volumesFor,
  type ApproachTally, type Assessment, type Junction, type MetronomeChoice, type PlaySettings, type PlayView, type ReferenceMode, type SuggestionAction,
} from './model';
import { createEnginePort, type PlayState, type PlaybackPort } from './port';
import { pageOf, renderRhythm, renderTab, tabGeometry, totalBars, type TabEvent } from './tab';

export type { PlayView, Assessment, PlaySettings } from './model';

/** Как играли подход: ритм, эхо и подложка — часть материала освоения (D-050). */
export interface PracticeOptions { readonly rhythm: RhythmPatternId; readonly echo: boolean; readonly groove: RhythmPresetId | null }

export interface RateEvent {
  readonly assessment: Assessment;
  /** Темп последнего завершённого прохода подхода. */
  readonly bpm: number;
  readonly passIndex: number;
  /** Число завершённых проходов подхода; 0 — неполный первый проход (не целиком, шаг не закрывает, темп не задаёт). */
  readonly passes: number;
  /** Активное время подхода по аудиочасам: без отсчёта и пауз. */
  readonly activeMs: number;
  /** Самый подсказывающий вид последних двух проходов: «По памяти» — только если оба прошли в нём. */
  readonly passView: PlayView;
  /** Проход целиком: без петли-фрагмента. */
  readonly wholePass: boolean;
  readonly practice: PracticeOptions;
}

const HINT_VIEWS: readonly PlayView[] = ['memory', 'tab', 'both', 'board'];
const HINT_RANK: Readonly<Record<PlayView, number>> = { memory: 0, tab: 1, both: 2, board: 3 };

export interface MountPlayOptions {
  /** Порт звука; по умолчанию — `createEnginePort()`, который экран освобождает сам. */
  readonly port?: PlaybackPort;
  readonly initialView?: PlayView;
  /** Начальные настройки экрана (темп, цель, звук, ритм); недостающее — умолчания. */
  readonly settings?: Partial<PlaySettings>;
  readonly bpm?: number;
  /** Отсчёт перед стартом; по умолчанию 1 такт. */
  readonly countIn?: boolean;
  /** Подписи на грифе при открытии; по умолчанию — ноты. */
  readonly labels?: Exclude<BoardLabelMode, 'none'>;
  /** Подпись кнопки возврата, например «← Занятие · шаг 2 из 4». */
  readonly backLabel?: string;
  readonly onBack?: () => void;
  readonly onRate?: (event: RateEvent) => void;
  /** Владелец звука разрешает старт или продолжение; `false` — звук не начинается. */
  readonly onBeforeStart?: () => boolean;
  readonly onViewChange?: (view: PlayView) => void;
  /**
   * Настройки экрана изменены пользователем; `changed` — что именно (темп — только по событиям темпа:
   * остановка, ±, стрелки, поле), чтобы хост не перезаписывал запомненное тем, что не менялось.
   */
  readonly onSettingsChange?: (settings: PlaySettings, labels: Exclude<BoardLabelMode, 'none'>, changed: readonly (keyof PlaySettings | 'labels')[]) => void;
  /** «Как играть» шага цели: другое «как играть» видно у таймера — такой подход в цель не засчитается. */
  readonly requiredPractice?: { readonly rhythm: RhythmPatternId; readonly echo: boolean; readonly groove: string | null } | null;
  /**
   * «Сначала услышь»: экран сам проигрывает эталон тем же портом (один проход без отсчёта и клика,
   * без самооценки); старт разрешает `onBeforeStart`. Обработчик лишь сообщает хосту о начале эталона.
   */
  readonly onListen?: () => void;
  /** Понятие упражнения (`ConceptId`): чип в шапке или «Открыть в справочнике». */
  readonly onConcept?: (id: ConceptId) => void;
  /** «Следующий шаг плана →» после оценки подхода. */
  readonly onNextStep?: () => void;
  /** «Отметить шаг выполненным» после оценки «С ошибками» или «Не успевал». */
  readonly onCompleteStep?: () => void;
}

/** Шаг плана, к которому относится экран: плановое время и уже сыгранное сегодня (для таймера). */
export interface PlanStepInfo {
  readonly plannedMs: number;
  readonly doneMs: number;
  /** Есть ли следующий шаг плана. */
  readonly hasNext: boolean;
  /** Шаг уже отмечен выполненным. */
  readonly done: boolean;
}

export interface PlayHandle {
  /** Новое упражнение: игра останавливается, петля и самооценка сбрасываются. */
  setExercise(plan: ExercisePlan, spec?: ExerciseSpec, settings?: Partial<PlaySettings>): void;
  setView(view: PlayView): void;
  getView(): PlayView;
  getSettings(): PlaySettings;
  setPlanStep(info: PlanStepInfo | null): void;
  /** Экран скрыт хостом: игра ставится на паузу, клавиши не обрабатываются. Продолжение — только действием. */
  setVisible(visible: boolean): void;
  /** Пауза по требованию хоста (другой владелец звука, уход из раздела); продолжение — только действием. */
  pause(): void;
  stop(): void;
  dispose(): void;
}

const LABEL_MODES: readonly { readonly id: Exclude<BoardLabelMode, 'none'>; readonly label: string }[] = [
  { id: 'name', label: 'Ноты' }, { id: 'degree', label: 'Ступени' }, { id: 'finger', label: 'Пальцы' }, { id: 'pluck', label: 'Пр. рука' },
];
const ASSESSMENTS: readonly { readonly id: Assessment; readonly label: string; readonly key: string; readonly code: string }[] = [
  { id: 'clean', label: 'Чисто', key: 'Z', code: 'KeyZ' }, { id: 'errors', label: 'С ошибками', key: 'X', code: 'KeyX' }, { id: 'slow', label: 'Не успевал', key: 'C', code: 'KeyC' },
];
const ACTIVE = new Set<PlayState['status']>(['counting', 'playing']);
const BARS_PER_PAGE = 2;

const segButtons = <T extends string | number>(name: string, items: readonly { id: T; label: string }[]) =>
  items.map(item => `<button type="button" data-${name}="${escapeHtml(item.id)}" aria-pressed="false">${escapeHtml(item.label)}</button>`).join('');

const TEMPLATE = `
<section class="pl-scene" data-status="stopped" aria-label="Экран игры">
  <header class="pl-head">
    <div class="pl-head-copy">
      <button type="button" class="pl-back" data-back></button>
      <div class="pl-title-row"><h1 class="pl-title" data-title></h1><span class="pl-sub" data-sub></span><span class="pl-chips" data-chips></span></div>
    </div>
    <div class="pl-head-tools">
      <button type="button" class="text-button pl-listen" data-listen aria-pressed="false" title="Эталон звучит до игры: один проход без отсчёта; пробел или Esc — остановить">♪ Сначала услышь</button>
      <div class="pl-seg" role="group" aria-label="Подписи на грифе" data-labels>${LABEL_MODES.map(mode => `<button type="button" data-label="${escapeHtml(mode.id)}" aria-pressed="false">${escapeHtml(mode.label)}</button>`).join('')}</div>
    </div>
  </header>
  <div class="pl-views"><span class="pl-views-caption">Вид · от подсказки к памяти</span><div class="pl-seg pl-seg-views" role="group" aria-label="Вид экрана игры">${PLAY_VIEWS.map((view, index) => `<button type="button" data-view="${escapeHtml(view.id)}" aria-pressed="false" aria-keyshortcuts="${index + 1}" title="${escapeHtml(view.hint)}"><i>${index + 1}</i>${escapeHtml(view.label)}</button>`).join('')}</div></div>
  <div class="pl-stage">
    <div class="pl-area" data-area="board">
      <div class="pl-strip">
        <div class="pl-now"><span data-now-caption>Сейчас</span><strong data-now>—</strong><span data-now-detail></span></div>
        <div class="pl-rhythm"><header><span>Ритм такта</span><span data-bar-label="board"></span></header><div class="pl-fit" data-rhythm="board"></div></div>
      </div>
      <div class="pl-fit pl-board" data-board="board"></div>
      <div class="pl-row" data-slot="board"></div>
    </div>
    <div class="pl-area" data-area="both">
      <div class="pl-tabcard"><header><span>TAB · бас E–A–D–G · клик по такту — петля</span><span data-bar-label="both"></span></header><div class="pl-fit" data-tab="both"></div></div>
      <div class="pl-fit pl-board" data-board="both"></div>
      <div class="pl-row" data-slot="both"></div>
    </div>
    <div class="pl-area" data-area="tab">
      <div class="pl-cgrid">
        <div class="pl-cmain">
          <div class="pl-cbar"><span data-bar-label="tab"></span><span>клик по такту — петля · L — петля на текущий такт</span></div>
          <div class="pl-tabcard pl-tab-big"><div class="pl-fit" data-tab="tab"></div></div>
          <div class="pl-tabcard pl-tab-next"><div class="pl-fit" data-tab="tab-next"></div></div>
          <div class="pl-row" data-slot="tab-main"></div>
        </div>
        <aside class="pl-cside"><span class="pl-cside-caption" data-anchors-caption>Опоры: тоники</span><div class="pl-fit pl-board pl-board-mini" data-board="tab"></div><div class="pl-cside-row" data-slot="tab-side"></div></aside>
      </div>
    </div>
    <div class="pl-area" data-area="memory">
      <div class="pl-pulse" aria-hidden="true">${[1, 2, 3, 4].map(beat => `<i data-pulse="${beat}">${beat}</i>`).join('')}</div>
      <div class="pl-mbox">
        <div class="pl-mcell"><span>Старт</span><strong data-mem-start></strong><span data-mem-start-detail></span></div>
        <div class="pl-mcell"><span data-mem-bar-caption>Сейчас</span><strong data-mem-bar>—</strong><span data-mem-detail></span></div>
        <div class="pl-mcell"><span data-mem-junction-caption>Переход</span><strong data-mem-junction></strong><span data-mem-junction-detail></span></div>
      </div>
      <div class="pl-rhythm"><header><span>Ритм такта</span><span data-bar-label="memory"></span></header><div class="pl-fit" data-rhythm="memory"></div></div>
      <div class="pl-row" data-slot="memory"></div>
    </div>
  </div>
  <div class="pl-transport" data-transport>
    <div class="pl-panel" data-panel hidden role="group" aria-label="Звук и ритм">
      <div class="pl-panel-grid">
        <div class="pl-field"><span>Эталонный бас</span><div class="pl-seg" role="group" aria-label="Эталонный бас">${segButtons('reference', REFERENCE_MODES)}</div><small data-reference-note></small></div>
        <div class="pl-field"><span>Метроном</span><div class="pl-seg" role="group" aria-label="Метроном">${segButtons('metronome', METRONOME_CHOICES)}</div></div>
        <label class="pl-field"><span>Громкость клика</span><input type="range" min="0" max="100" step="5" data-volume="click" aria-label="Громкость клика"></label>
        <label class="pl-field"><span>Подложка</span><select data-groove aria-label="Подложка"><option value="">Без подложки</option>${GROOVE_PRESETS.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(presetName(id))}</option>`).join('')}</select></label>
        <label class="pl-field"><span>Громкость подложки</span><input type="range" min="0" max="100" step="5" data-volume="groove" aria-label="Громкость подложки"></label>
        <div class="pl-field"><span>Отсчёт</span><div class="pl-seg" role="group" aria-label="Отсчёт">${COUNT_IN_CHOICES.map(item => `<button type="button" data-countin-bars="${item.bars}" aria-pressed="false">${escapeHtml(item.label)}</button>`).join('')}</div></div>
        <label class="pl-field"><span>Ритм</span><select data-rhythm-select aria-label="Ритмический рисунок"></select><small data-rhythm-note></small></label>
        <div class="pl-field"><span>Эхо</span><button type="button" class="pl-toggle" data-flag="echo" aria-pressed="false" title="Такт звучит эталоном, следующий — тишина для повтора">Услышь — повтори</button></div>
      </div>
      <p class="pl-panel-note">Громкости и эталон меняются сразу, ритм, отсчёт, метроном и подложка — со следующего старта. M — открыть или закрыть панель.</p>
    </div>
    <div class="pl-countin" data-countin hidden><small>Отсчёт</small><span data-countin-value></span></div>
    <button type="button" class="primary-button pl-play" data-play aria-keyshortcuts="Space"><span data-play-label>▶ Играть</span><kbd>Пробел</kbd></button>
    <button type="button" class="secondary-button pl-restart" data-restart aria-keyshortcuts="Escape" title="Вернуться к первой ноте; следующий старт — с отсчётом">⏮ С начала<kbd>Esc</kbd></button>
    <div class="pl-bpm" role="group" aria-label="Темп">
      <button type="button" class="pl-icon-btn" data-bpm-step="-${BPM_STEP}" aria-label="Медленнее на ${BPM_STEP} BPM">−</button>
      <input class="pl-bpm-input" type="number" inputmode="numeric" min="${BPM_MIN}" max="${BPM_MAX}" step="1" data-bpm aria-label="Темп, BPM (←/→ ±1, Shift ±5)">
      <button type="button" class="pl-icon-btn" data-bpm-step="${BPM_STEP}" aria-label="Быстрее на ${BPM_STEP} BPM">+</button>
      <small>BPM ♩<br><span data-rhythm-caption>восьмые</span></small>
    </div>
    <label class="pl-target" title="Цель темпа: лестница идёт до неё">цель <input type="number" inputmode="numeric" min="${BPM_MIN}" max="${BPM_MAX}" step="1" data-target aria-label="Цель темпа, BPM"></label>
    <button type="button" class="pl-toggle" data-flag="loop" aria-pressed="true">⟲ По кругу</button>
    <button type="button" class="pl-toggle" data-flag="ladder" aria-pressed="false">↗ <span data-ladder-label></span></button>
    <button type="button" class="pl-toggle pl-range-chip" data-clear-range aria-pressed="true" hidden></button>
    <button type="button" class="pl-toggle pl-sound" data-panel-toggle aria-expanded="false" aria-keyshortcuts="M" title="Звук и ритм (M)"><span data-sound-summary></span> ▾</button>
    <button type="button" class="secondary-button button-compact" data-rate-open hidden>Оценить подход</button>
    <div class="pl-progress">
      <div class="pl-meter" aria-hidden="true"><i data-meter></i></div>
      <small data-progress-text></small>
      <small class="pl-timer" data-timer hidden></small>
      <small class="pl-pending" data-pending hidden>новые настройки — со следующего старта</small>
      <small class="pl-approach-note" data-approach-note hidden></small>
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
  rateEl.setAttribute('aria-label', 'Самооценка подхода');
  // После оценки мышью фокус — на группе: Enter открывает следующий шаг, пробел начинает игру.
  rateEl.tabIndex = -1;
  rateEl.innerHTML = `<strong data-rate-title></strong><span>Как прошло?</span>${ASSESSMENTS.map(item => `<button type="button" class="secondary-button button-compact" data-rate="${escapeHtml(item.id)}" aria-pressed="false" aria-keyshortcuts="${item.key}">${escapeHtml(item.label)}<kbd aria-hidden="true">${item.key}</kbd></button>`).join('')}<span class="pl-suggest" data-suggest aria-live="polite"></span><span class="pl-next-actions" data-next-actions></span><button type="button" class="text-button button-compact pl-rate-close" data-rate-close aria-label="Скрыть самооценку">✕</button>`;

  /* ---------- Состояние ---------- */
  let plan: ExercisePlan | null = null;
  let junctionList: Junction[] = [];
  let concept: { id: ConceptId; card: ReferenceConcept } | null = null;
  let view: PlayView = isPlayView(options.initialView) ? options.initialView : 'both';
  let labels: Exclude<BoardLabelMode, 'none'> = options.labels ?? 'name';
  const initial = (extra: Partial<PlaySettings> = {}): PlaySettings => {
    const merged = { ...DEFAULT_PLAY_SETTINGS, ...(options.countIn === false ? { countInBars: 0 as const } : {}), ...(options.bpm ? { bpm: options.bpm } : {}), ...options.settings, ...extra };
    return { ...merged, bpm: clampBpm(merged.bpm), targetBpm: clampBpm(merged.targetBpm), range: null };
  };
  let settings: PlaySettings = initial();
  let runSettings: PlaySettings | null = null;
  let timeline: Timeline | null = null;
  let runTimeline: Timeline | null = null;
  let events: TabEvent[] = [];
  let state: PlayState = port.state();
  let shownStep: number | null = null;
  let fromStart = false;
  let visible = true;
  let disposed = false;
  let raf = 0;
  let busy = false;
  let errorText = '';
  let panelOpen = false;
  let planStep: PlanStepInfo | null = null;
  // «Сначала услышь»: эталон звучит тем же портом, но это не запуск игры — проходы и самооценка не считаются.
  let listening = false;
  let listenNote = '';
  // Запуск: проходы порта считаются с 0 на каждом старте — индекс последнего засчитанного прохода, время и темп
  // текущего (ещё не завершённого) прохода.
  let lastPass = 0;
  let runPassIndex = -1;
  let passBpm = settings.bpm;
  let passMs = 0;
  // Подход: проходы, время и виды до оценки — живут через перезапуски (петля, новый старт).
  let approach: { passes: number; lastBpm: number; activeMs: number; hints: number[]; wholePass: boolean; practice: PracticeOptions } | null = null;
  let previous: { status: PlayState['status']; audioTime: number } | null = null;
  let pendingRate: Omit<RateEvent, 'assessment'> | null = null;
  /** Итог подхода, предложенного к оценке: без оценки он продолжается при следующем старте. */
  let pendingTally: ApproachTally | null = null;
  /** Короткая строка у транспорта: подход не записан, проход не доигран. */
  let approachNote = '';
  /** Подсказка за текущий проход: от «Гриф» (3) до «По памяти» (0). */
  let passHint = 0;
  let rated: { assessment: Assessment; bpm: number } | null = null;
  let sceneKey = '';
  let srKey = '';

  const runActive = () => runSettings !== null;
  /** Игра запущена и не закончена: эталон в это время не включается, чтобы не потерять проход. */
  const gameActive = () => runActive() && (state.status === 'counting' || state.status === 'playing' || state.status === 'paused');
  /** Шкала, по которой сейчас идёт или пойдёт игра. */
  const shownTimeline = () => (runActive() ? runTimeline : timeline);
  const shownEvents = () => runActive() && runTimeline && plan ? tabEvents(plan, runTimeline) : events;
  // Продолжение лиги — не новая нота: не считается в «Нота N из M» и не бывает «следующей».
  const noteSteps = (line: Timeline | null) => line?.steps.filter(step => step.note !== null && !step.tie).length ?? 0;
  const practiceOf = (source: PlaySettings): PracticeOptions => ({ rhythm: timelineFor(plan!, source).pattern, echo: source.echo, groove: source.groove });
  const labelAvailable = (mode: Exclude<BoardLabelMode, 'none'>) => !plan || mode === 'name'
    || (mode === 'degree' ? plan.notes.some(note => note.degree) : mode === 'pluck' ? plan.notes.some(note => note.pluck) : plan.notes.some(note => note.finger !== null));
  const effectiveLabels = (): Exclude<BoardLabelMode, 'none'> => labelAvailable(labels) ? labels : 'name';

  /* ---------- Шапка и понятие ---------- */
  function renderHeader() {
    const back = at<HTMLButtonElement>('[data-back]');
    back.textContent = options.backLabel ?? '← Занятие';
    back.hidden = !options.onBack;
    at('[data-title]').textContent = plan?.title ?? 'Упражнение не выбрано';
    renderSub();
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
    renderLabels();
  }
  function renderSub() {
    const line = shownTimeline();
    const n = noteSteps(line);
    const pattern = plan?.timing ? 'ритм партитуры' : line ? rhythmPattern(line.pattern).label.toLowerCase() : '';
    at('[data-sub]').textContent = plan && line ? `${n} ${plural(n, 'нота', 'ноты', 'нот')} · ${pattern} · ${line.bars} ${plural(line.bars, 'такт', 'такта', 'тактов')}${line.echo ? ' · эхо' : ''}` : '';
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
    else {
      const part = plan?.spec.templateId === 'progression' ? 'Такты' : 'Сегменты';
      items.push({ cls: 'is-a', text: `${part} 1, 3, 5…` }, { cls: 'is-b', text: `${part} 2, 4…` });
    }
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
    if (runActive()) passHint = Math.max(passHint, HINT_RANK[view]);
    scene.dataset.view = view;
    all<HTMLButtonElement>('button[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    at('[data-labels]').hidden = !(view === 'board' || view === 'both');
    placeBlocks();
    applyVolumes();
    sceneKey = '';
    renderScene();
    renderPanel();
    if (changed) renderSuggestion();
    if (changed && notify) options.onViewChange?.(view);
  }

  function renderLabels() {
    all<HTMLButtonElement>('button[data-label]').forEach(button => {
      const mode = button.dataset.label as Exclude<BoardLabelMode, 'none'>;
      const available = labelAvailable(mode);
      button.disabled = !available;
      button.title = available ? (mode === 'pluck' ? 'Пальцы правой руки: i — указательный, m — средний' : '') : mode === 'degree' ? 'У этого упражнения нет тоники — ступеней нет'
        : mode === 'pluck' ? 'Правая рука подписана только в упражнениях на переход между струнами' : 'Аппликатура этого упражнения зависит от контекста — пальцы не подписаны';
      button.setAttribute('aria-pressed', String(mode === effectiveLabels()));
    });
  }
  function setLabels(mode: Exclude<BoardLabelMode, 'none'>) {
    if (!labelAvailable(mode)) return;
    labels = mode;
    renderLabels();
    sceneKey = '';
    renderScene();
    notifySettings(['labels']);
  }

  /* ---------- Звук ---------- */
  /** Громкости по текущему виду: «авто» глушит эталон в «По памяти» сразу, без перезапуска. */
  function applyVolumes() {
    if (listening) return;
    try { port.setVolumes(volumesFor(settings, view)); } catch { /* порт освобождён */ }
  }
  function notifySettings(changed: readonly (keyof PlaySettings | 'labels')[]) { options.onSettingsChange?.(settings, labels, changed); }
  function changeSettings(patch: Partial<PlaySettings>, persist = true) {
    settings = { ...settings, ...patch };
    if (plan && ('rhythm' in patch || 'echo' in patch)) {
      timeline = timelineFor(plan, settings);
      events = tabEvents(plan, timeline);
      if (settings.range && settings.range.toBar > timeline.bars) settings = { ...settings, range: null };
      sceneKey = '';
    }
    applyVolumes();
    if (persist) notifySettings(Object.keys(patch) as (keyof PlaySettings)[]);
    renderSub();
    update();
  }

  /* ---------- Сцена ---------- */
  function currentStep(): number | null {
    if (state.status === 'playing' || state.status === 'paused') return shownStep;
    return null;
  }
  function noteOfStep(step: number | null): number | null {
    const line = shownTimeline();
    if (step === null || !line) return null;
    for (let index = step; index >= 0; index--) { const note = line.steps[index]?.note; if (note !== null && note !== undefined) return note; }
    return null;
  }
  /** Следующий шаг с нотой после `step` (по кругу при повторе); null — нечего играть. */
  function nextNoteStep(step: number | null): number | null {
    const line = shownTimeline();
    if (!line) return null;
    const range = (runSettings ?? settings).range;
    const inRange = (index: number) => !range || (line.steps[index].bar >= range.fromBar && line.steps[index].bar < range.toBar);
    const candidates = line.steps.map((item, index) => ({ item, index })).filter(({ item, index }) => item.note !== null && !item.tie && inRange(index));
    if (!candidates.length) return null;
    if (step === null) return candidates[0].index;
    const after = candidates.find(({ index }) => index > step);
    const repeating = runSettings ? runSettings.ladder || runSettings.loop : settings.ladder || settings.loop;
    return after?.index ?? (repeating ? candidates[0].index : null);
  }
  function fill(element: HTMLElement, svg: string, width: number, height: number) {
    element.innerHTML = svg;
    element.style.aspectRatio = `${width} / ${height}`;
  }

  function renderScene() {
    const line = shownTimeline();
    if (!plan || !line) {
      all('[data-board], [data-tab], [data-rhythm]').forEach(element => element.replaceChildren());
      return;
    }
    const step = currentStep();
    const nextStep = nextNoteStep(step);
    const current = noteOfStep(step);
    const next = nextStep === null ? null : line.steps[nextStep].note;
    const range = (runSettings ?? settings).range;
    const key = [view, effectiveLabels(), step, nextStep, state.status, plan.title, line.bars, line.pattern, range?.fromBar, range?.toBar].join('|');
    if (key === sceneKey) return;
    sceneKey = key;
    const tabList = shownEvents();
    const focusStep = step ?? nextStep ?? 0;
    const focusNote = plan.notes[current ?? next ?? 0];
    const segment = focusNote.segment;
    const currentId = current === null ? null : plan.notes[current].id;
    const nextId = next === null ? null : plan.notes[next].id;
    const bars = totalBars(tabList) || 1;
    const bar = line.steps[focusStep]?.bar ?? 0;
    const segmentLabel = plan.segments[segment]?.label ?? '';
    const echoBar = line.steps[focusStep]?.echo ?? false;
    // Правая рука: палец текущей и следующей ноты по их шагу (на одной позиции он меняется).
    const pluckOf = new Map<string, string>();
    if (next !== null && plan.notes[next].pluck) pluckOf.set(plan.notes[next].id, plan.notes[next].pluck!);
    if (current !== null && plan.notes[current].pluck) pluckOf.set(plan.notes[current].id, plan.notes[current].pluck!);
    // Опоры мини-грифа «Таб»: тоники; у упражнения без тоники — старт и финиш.
    const hasRoots = plan.notes.some(note => note.degree === '1');
    const endIds = new Set<string>();
    if (!hasRoots) {
      const noteStepIds = line.steps.filter(item => item.note !== null && !item.echo).map(item => plan!.notes[item.note!].id);
      if (noteStepIds.length) { endIds.add(noteStepIds[0]); endIds.add(noteStepIds[noteStepIds.length - 1]); }
    }
    const boardFor = (mode: BoardLabelMode, pad: number, width: number, marker: number, fretLabels = true, anchorsOnly = false) => {
      const window = planFretWindow(plan!, { pad, minSpan: 6 });
      const geometry = boardGeometry({ width, marker, fretLabels });
      const notes = boardNotesFromPlan(plan!, { labels: mode, segment, pluckOf }).filter(note => !anchorsOnly || (hasRoots ? note.root : endIds.has(note.id)));
      return { svg: renderBoard({ notes, ...window, current: anchorsOnly ? null : currentId, next: anchorsOnly ? null : nextId, width, marker, fretLabels }), width, height: geometry.height };
    };
    const tabFor = (fromBar: number, count: number, width: number, lineGap: number, fontSize: number, extra: { showCount?: boolean; dimPlayed?: boolean; cursor?: boolean; label?: string; selectable?: boolean } = {}) => {
      const geometry = tabGeometry({ width, lineGap, showCount: extra.showCount });
      return { svg: renderTab({ events: tabList, current: extra.cursor === false ? -1 : step, fromBar, bars: count, width, lineGap, fontSize, loop: range, ...extra }), width, height: geometry.height };
    };
    const put = (selector: string, result: { svg: string; width: number; height: number }) => fill(at(selector), result.svg, result.width, result.height);
    const putRhythm = (selector: string) => { const svg = renderRhythm(tabList, bar, step); fill(at(selector), svg, 560, 34); };
    const barLabel = `такт ${bar + 1} из ${bars}${echoBar ? ' · эхо — повтори' : ` · ${segmentLabel}`}`;

    if (view === 'board') {
      putRhythm('[data-rhythm="board"]');
      at('[data-bar-label="board"]').textContent = barLabel;
      at('[data-now-caption]').textContent = current === null ? 'Старт' : 'Сейчас';
      at('[data-now]').textContent = pitchLetter(focusNote.name);
      at('[data-now-detail]').textContent = [formatPosition(focusNote.id), focusNote.degree ? `ступень ${formatDegree(focusNote.degree)}` : '', focusNote.pluck ? `пр. рука ${focusNote.pluck}` : ''].filter(Boolean).join(' · ');
      put('[data-board="board"]', boardFor(effectiveLabels(), 2, 1000, 46));
    } else if (view === 'both') {
      const page = pageOf(tabList, bar, BARS_PER_PAGE);
      put('[data-tab="both"]', tabFor(page.firstBar, page.bars, 1000, 18, 17, { selectable: true, label: `Табулатура, такты ${page.firstBar + 1}–${page.lastBar + 1}` }));
      const pageSegments = [...new Set(line.steps.filter(item => item.bar >= page.firstBar && item.bar <= page.lastBar && item.note !== null).map(item => plan!.notes[item.note!].segment))]
        .map(index => plan!.segments[index]?.label).filter(Boolean);
      const prefix = page.totalBars > BARS_PER_PAGE ? `такты ${page.firstBar + 1}–${page.lastBar + 1} из ${page.totalBars} · ` : '';
      at('[data-bar-label="both"]').textContent = prefix + pageSegments.join(' → ');
      put('[data-board="both"]', boardFor(effectiveLabels(), 2, 1000, 40));
    } else if (view === 'tab') {
      put('[data-tab="tab"]', tabFor(bar, 1, 760, 34, 28, { dimPlayed: true, selectable: true, label: `Табулатура крупно, такт ${bar + 1}` }));
      const following = (bar + 1) % bars;
      put('[data-tab="tab-next"]', tabFor(following, 1, 760, 14, 13, { showCount: false, cursor: false, label: `Следующий такт ${following + 1}` }));
      at('[data-bar-label="tab"]').textContent = `Т${barLabel.slice(1)} · ниже — следующий`;
      at('[data-anchors-caption]').textContent = hasRoots ? 'Опоры: тоники' : 'Опоры: старт и финиш';
      put('[data-board="tab"]', boardFor('name', 1, 280, 22, true, true));
    } else {
      putRhythm('[data-rhythm="memory"]');
      at('[data-bar-label="memory"]').textContent = barLabel;
      const startStep = nextNoteStep(null);
      const start = plan.notes[startStep === null ? 0 : line.steps[startStep].note!];
      at('[data-mem-start]').textContent = formatPosition(start.id);
      at('[data-mem-start-detail]').textContent = [start.name, start.finger === null ? '' : `палец ${start.finger}`, plan.segments[start.segment]?.label].filter(Boolean).join(' · ');
      at('[data-mem-bar]').textContent = current === null ? '—' : `такт ${bar + 1} из ${bars}`;
      const countBars = (runSettings ?? settings).countInBars;
      at('[data-mem-detail]').textContent = current !== null ? (echoBar ? 'эхо — повтори такт' : segmentLabel)
        : state.status === 'counting' ? 'отсчёт' : countBars ? `старт с отсчётом ${countBars === 1 ? '1 такт' : '2 такта'}` : 'старт без отсчёта';
    }
    renderJunction(current);
  }

  function renderPulse() {
    const playing = state.status === 'playing';
    all<HTMLElement>('[data-pulse]').forEach(dot => dot.classList.toggle('is-on', playing && Number(dot.dataset.pulse) === state.beat));
  }

  function renderJunction(current: number | null) {
    if (!plan) return;
    const junction = upcomingJunction(junctionList, current);
    shiftEl.hidden = !junction;
    if (junction) {
      shiftEl.querySelector('[data-shift-text]')!.textContent = junctionText(junction);
      const tail = plan.segments[junction.to.segment]?.label;
      shiftEl.querySelector('[data-shift-tail]')!.textContent = tail ? `дальше: ${tail}` : '';
      // «По памяти» — без позиций: куда переходим (сегмент) и как (сдвиг, палец), но не лады.
      at('[data-mem-junction-caption]').textContent = 'Переход';
      at('[data-mem-junction]').textContent = tail ? `дальше: ${tail}` : junction.from.string === junction.to.string ? shiftText(junction.shift) : 'на другую струну';
      at('[data-mem-junction-detail]').textContent = [tail && junction.from.string === junction.to.string ? shiftText(junction.shift) : '', junction.to.finger === null ? '' : `палец ${junction.to.finger}`].filter(Boolean).join(' · ');
    } else {
      const line = shownTimeline();
      const lastNote = line ? [...line.steps].reverse().find(item => item.note !== null)?.note ?? 0 : 0;
      const last = plan.notes[lastNote];
      at('[data-mem-junction-caption]').textContent = 'Финиш';
      at('[data-mem-junction]').textContent = formatPosition(last.id);
      at('[data-mem-junction-detail]').textContent = [last.name, last.degree === '1' ? 'тоника' : ''].filter(Boolean).join(' · ');
    }
  }

  /* ---------- Панель «Звук и ритм» ---------- */
  function soundSummary() {
    const reference = settings.echo ? 'эхо' : settings.reference === 'auto' ? (referenceAudible(settings, view) ? 'эталон вкл' : 'эталон выкл') : `эталон ${REFERENCE_MODES.find(item => item.id === settings.reference)!.label.toLowerCase()}`;
    const metronome = METRONOME_CHOICES.find(item => item.id === settings.metronome)!.short;
    const count = settings.countInBars ? `отсчёт ${settings.countInBars}` : 'без отсчёта';
    return [reference, metronome, count, settings.groove ? presetName(settings.groove).toLowerCase() : ''].filter(Boolean).join(' · ');
  }
  function renderPanel() {
    const panel = at('[data-panel]');
    panel.hidden = !panelOpen;
    at('[data-panel-toggle]').setAttribute('aria-expanded', String(panelOpen));
    setText(at('[data-sound-summary]'), soundSummary());
    all<HTMLButtonElement>('[data-reference]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.reference === settings.reference)));
    all<HTMLButtonElement>('[data-metronome]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.metronome === settings.metronome)));
    all<HTMLButtonElement>('[data-countin-bars]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.countinBars) === settings.countInBars)));
    at('[data-flag="echo"]').setAttribute('aria-pressed', String(settings.echo));
    setText(at('[data-reference-note]'), settings.echo ? 'Эхо: эталон звучит в первом такте пары.' : settings.reference === 'auto' ? (referenceAudible(settings, view) ? 'Эталон звучит; в «По памяти» он выключится — без подсказки звуком.' : 'Эталон выключен: «По памяти» — без подсказки звуком.') : '');
    const click = at<HTMLInputElement>('[data-volume="click"]');
    if (document.activeElement !== click) click.value = String(Math.round(settings.click * 100));
    const groove = at<HTMLInputElement>('[data-volume="groove"]');
    if (document.activeElement !== groove) groove.value = String(Math.round(settings.grooveVolume * 100));
    groove.disabled = !settings.groove;
    at<HTMLSelectElement>('[data-groove]').value = settings.groove ?? '';
    const select = at<HTMLSelectElement>('[data-rhythm-select]');
    const allowed = plan ? rhythmPatternsFor(plan) : [];
    const key = allowed.join(',');
    if (select.dataset.options !== key) {
      select.dataset.options = key;
      select.innerHTML = allowed.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(rhythmPattern(id).label)}</option>`).join('');
    }
    const line = timeline;
    select.value = line?.pattern ?? settings.rhythm;
    setText(at('[data-rhythm-note]'), plan?.timing ? 'Ритм из партитуры.' : plan?.spec.templateId === 'progression' ? 'Такт — аккорд: только восьмые или шаффл.' : settings.groove ? 'Свинг — от подложки.' : '');
    setText(at('[data-rhythm-caption]'), plan?.timing ? 'ритм партитуры' : line ? rhythmPattern(line.pattern).label.toLowerCase() : 'восьмые');
  }

  /* ---------- Транспорт ---------- */
  function formatTime(ms: number) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function renderTransport() {
    scene.dataset.status = listening ? 'listening' : state.status;
    const playLabel = listening ? '■ Стоп эталона' : state.status === 'playing' || state.status === 'counting' ? '❚❚ Пауза' : state.status === 'paused' ? '▶ Продолжить' : '▶ Играть';
    setText(at('[data-play-label]'), playLabel);
    at<HTMLButtonElement>('[data-play]').disabled = !plan;
    const listenButton = at<HTMLButtonElement>('[data-listen]');
    listenButton.setAttribute('aria-pressed', String(listening));
    listenButton.disabled = !plan || (!listening && gameActive());
    setText(listenButton, listening ? '■ Стоп эталона' : '♪ Сначала услышь');
    const countIn = at('[data-countin]');
    countIn.hidden = state.status !== 'counting' || state.countBeat === null;
    setText(at('[data-countin-value]'), state.countBeat === null ? '' : String(state.countBeat));
    const ladderRunning = !!runSettings?.ladder && state.status !== 'stopped' && state.status !== 'finished';
    const bpm = ladderRunning ? Math.round(state.bpm) : settings.bpm;
    const input = at<HTMLInputElement>('[data-bpm]');
    if (document.activeElement !== input) input.value = String(bpm);
    input.disabled = ladderRunning;
    all<HTMLButtonElement>('[data-bpm-step]').forEach(button => {
      const step = Number(button.dataset.bpmStep);
      button.disabled = ladderRunning || (step < 0 ? settings.bpm <= BPM_MIN : settings.bpm >= BPM_MAX);
    });
    const target = at<HTMLInputElement>('[data-target]');
    if (document.activeElement !== target) target.value = String(settings.targetBpm);
    at('[data-flag="loop"]').setAttribute('aria-pressed', String(settings.loop));
    const ladder = at<HTMLButtonElement>('[data-flag="ladder"]');
    ladder.setAttribute('aria-pressed', String(settings.ladder && ladderAvailable(settings)));
    ladder.disabled = !ladderAvailable(settings) && !settings.ladder;
    ladder.title = ladderAvailable(settings) ? `Лестница: +${BPM_STEP} BPM каждые 2 прохода до цели ${settings.targetBpm}` : 'Темп уже не ниже цели — подними цель';
    setText(at('[data-ladder-label]'), ladderAvailable(settings) ? `Лестница ${settings.bpm} → ${settings.targetBpm}` : 'Лестница: цель достигнута');
    const chip = at<HTMLButtonElement>('[data-clear-range]');
    chip.hidden = !settings.range;
    if (settings.range) {
      setText(chip, `Петля: ${loopText(settings.range)} ✕`);
      chip.setAttribute('aria-label', `Снять петлю: ${loopText(settings.range)}`);
    }
    at<HTMLButtonElement>('[data-rate-open]').hidden = !(approach && approach.passes > 0 && state.status === 'paused' && rateEl.hidden);
    const line = shownTimeline();
    const step = currentStep();
    const total = noteSteps(line);
    const ordinal = step === null || !line ? null : line.steps.slice(0, step + 1).filter(item => item.note !== null && !item.tie).length - 1;
    const meter = ordinal === null ? (state.status === 'finished' ? total : 0) : ordinal + 1;
    at('[data-meter]').style.width = `${total ? (meter / total) * 100 : 0}%`;
    const shownRange = (runSettings ?? settings).range;
    const progress = listening ? listenProgressText(ordinal, total, shownRange) : progressText(state, state.status === 'finished' ? null : ordinal, total, { fromStart, range: shownRange });
    setText(at('[data-progress-text]'), listenNote && !listening && state.status === 'stopped' ? `${listenNote} · ${progress}` : progress);
    const timer = at('[data-timer]');
    timer.hidden = !planStep;
    if (planStep) {
      // Сыгранное сегодня (история) + идущий подход + ещё не оценённый подход.
      const done = planStep.doneMs + (approach?.activeMs ?? 0) + passMs + (pendingRate && !rated ? pendingRate.activeMs : 0);
      setText(timer, `шаг: ${formatTime(done)} из ${Math.round(planStep.plannedMs / 60000)} мин${done >= planStep.plannedMs ? ' — время шага вышло, оцени подход' : ''}`);
      timer.classList.toggle('is-over', done >= planStep.plannedMs);
    }
    at('[data-pending]').hidden = !runActive() || !differsForNextStart(runSettings!, settings) || state.status === 'stopped' || state.status === 'finished';
    const noteEl = at('[data-approach-note]');
    const noteText = approachNote || requiredPracticeNote() || (runActive() && (runSettings!.loop || runSettings!.ladder) && (state.status === 'playing' || state.status === 'counting') ? 'Esc — остановить и оценить подход.' : '');
    noteEl.hidden = !noteText;
    setText(noteEl, noteText);
    const error = at('[data-error]');
    error.hidden = !errorText;
    setText(error, errorText);
    renderPulse();
    // Живая область текущей ноты: объявляется смена ноты или состояния.
    const noteIndex = noteOfStep(step);
    const note = noteIndex === null || !plan ? null : plan.notes[noteIndex];
    const announce = listening ? 'Звучит эталон' : listenNote && state.status === 'stopped' ? listenNote
      : state.status === 'counting' ? '' : note && ordinal !== null ? `Нота ${ordinal + 1} из ${total}: ${note.name}, ${formatPosition(note.id)}${state.status === 'paused' ? ', пауза' : ''}` : state.status === 'finished' ? 'Проход завершён' : '';
    const key = listening ? 'listening' : `${state.status}|${ordinal}|${listenNote}`;
    if (key !== srKey) { srKey = key; setText(at('[data-sr]'), announce); }
  }
  /** Шаг цели засчитывается только своим «как играть»: другое — видно у таймера. */
  let practiceMemo: { key: string; plan: ExercisePlan; value: PracticeOptions } | null = null;
  function requiredPracticeNote() {
    const required = options.requiredPractice;
    // Подложка «как играть» хранится строкой (`GROOVE_IDS`) — это пресеты «Ритма».
    if (!required || !plan) return '';
    // Шкала строится только при смене ритма, эха или подложки, а не в каждом кадре.
    const memoKey = `${settings.rhythm}|${settings.echo}|${settings.groove}`;
    if (!practiceMemo || practiceMemo.key !== memoKey || practiceMemo.plan !== plan) practiceMemo = { key: memoKey, plan, value: practiceOf(settings) };
    const current = practiceMemo.value;
    if (current.rhythm === required.rhythm && current.echo === required.echo && current.groove === required.groove) return '';
    const how = [rhythmPattern(required.rhythm).label.toLowerCase(), required.echo ? 'эхо' : '', required.groove ? `под ${presetName(required.groove as RhythmPresetId).toLowerCase()}` : 'без подложки'].filter(Boolean).join(', ');
    return `Шаг цели — ${how}; подход по-другому в цель не засчитается.`;
  }
  function setText(element: Element, text: string) { if (element.textContent !== text) element.textContent = text; }
  function differsForNextStart(running: PlaySettings, next: PlaySettings) {
    return running.countInBars !== next.countInBars || running.loop !== next.loop || running.ladder !== next.ladder
      || running.range?.fromBar !== next.range?.fromBar || running.range?.toBar !== next.range?.toBar
      || running.rhythm !== next.rhythm || running.echo !== next.echo || running.groove !== next.groove || running.metronome !== next.metronome
      || (running.ladder && (running.bpm !== next.bpm || running.targetBpm !== next.targetBpm));
  }

  /* ---------- Проходы, подход и самооценка ---------- */
  function observe(nextState: PlayState) {
    if (runActive() && approach) {
      if (nextState.status === 'playing' && previous?.status === 'playing') passMs += Math.max(0, nextState.audioTime - previous.audioTime) * 1000;
      if ((nextState.status === 'playing' || nextState.status === 'paused') && nextState.passIndex > lastPass) {
        completePass(lastPass);
        lastPass = nextState.passIndex;
      }
      if (nextState.status === 'playing' && nextState.passIndex === lastPass) passBpm = nextState.bpm;
      if (nextState.status === 'finished') {
        completePass(Math.max(lastPass, nextState.passIndex));
        runSettings = null;
        offerRate();
      }
    }
    if (nextState.step !== null) shownStep = nextState.step;
    if (nextState.status === 'stopped' || nextState.status === 'counting') shownStep = null;
    previous = { status: nextState.status, audioTime: nextState.audioTime };
    state = nextState;
  }
  /** Проход завершён: запоминается в подходе, панель оценки не открывается — подход оценивается целиком. */
  function completePass(passIndex: number) {
    if (!approach || passIndex < runPassIndex + 1) return;
    approach.passes += 1;
    runPassIndex = passIndex;
    approachNote = '';
    approach.lastBpm = Math.round(passBpm);
    approach.activeMs += Math.round(passMs);
    approach.hints = [...approach.hints, passHint].slice(-2);
    passMs = 0;
    passHint = HINT_RANK[view];
  }
  /** Оценка подхода предлагается после остановки, конца прохода без повтора или конца лестницы. */
  function offerRate() {
    if (!approach || !plan) return;
    // Недоигранное время прохода — в подход; без завершённых проходов — неполный проход или ничего.
    const played = approach.activeMs + passMs;
    const tally = stopApproach(approach, passMs, passHint);
    passMs = 0;
    if (!tally) {
      if (played > 0) approachNote = 'Проход не доигран — не записан: оценка — после целого прохода или от 5 секунд игры.';
      approach = null;
      return;
    }
    pendingTally = tally;
    pendingRate = {
      bpm: tally.passes ? tally.lastBpm : Math.round(passBpm), passIndex: runPassIndex, passes: tally.passes, activeMs: tally.activeMs,
      passView: HINT_VIEWS[Math.max(...tally.hints)], wholePass: tally.wholePass, practice: tally.practice,
    };
    approach = null;
    rated = null;
    approachNote = '';
    rateEl.hidden = false;
    scene.classList.add('is-rated');
    const passes = pendingRate.passes;
    rateEl.querySelector('[data-rate-title]')!.textContent = passes
      ? `Подход: ${passes} ${plural(passes, 'проход', 'прохода', 'проходов')} · ${pendingRate.bpm} BPM.`
      : `Подход: неполный проход · ${pendingRate.bpm} BPM.`;
    rateEl.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach(button => { button.disabled = false; button.setAttribute('aria-pressed', 'false'); });
    rateEl.querySelector('[data-suggest]')!.replaceChildren();
    const actions = rateEl.querySelector<HTMLElement>('[data-next-actions]')!;
    actions.replaceChildren();
    delete actions.dataset.acts;
  }
  function closeRate() {
    rateEl.hidden = true;
    scene.classList.remove('is-rated');
    pendingRate = null;
    pendingTally = null;
  }
  /**
   * Подход нового запуска: идущий (петля во время игры) или неоценённый (новый старт после остановки, продолжение
   * после «Оценить подход» на паузе) продолжается при том же «как играть».
   */
  function carryApproach(next: PlaySettings) {
    const running: ApproachTally | null = approach ? { ...approach, activeMs: approach.activeMs + Math.round(passMs) } : null;
    const previousTally = running ?? (pendingTally && !rated ? pendingTally : null);
    const { tally, lost } = continueApproach(previousTally, { bpm: next.bpm, wholePass: !next.range, practice: practiceOf(next) });
    approach = { ...tally, hints: [...tally.hints] };
    passMs = 0;
    approachNote = lost ? 'Прошлый подход не оценён и не записан: «как играть» изменилось.' : '';
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
    renderNextActions();
  }
  /** После оценки: следующий шаг плана (Enter), ещё подход, отметить шаг выполненным. */
  function renderNextActions() {
    const box = rateEl.querySelector<HTMLElement>('[data-next-actions]')!;
    if (!rated) { box.replaceChildren(); delete box.dataset.acts; return; }
    const button = (label: string, act: string, primary = false) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `${primary ? 'primary-button' : 'secondary-button'} button-compact`;
      element.dataset.after = act;
      element.textContent = label;
      return element;
    };
    const acts = [planStep && options.onNextStep && planStep.hasNext ? 'next' : '', 'again',
      planStep && !planStep.done && rated.assessment !== 'clean' && options.onCompleteStep ? 'complete' : ''].filter(Boolean).join(' ');
    // Тот же набор — кнопки не пересоздаются, фокус на них не теряется (обновление таймера после записи).
    if (box.dataset.acts === acts && box.childElementCount) return;
    box.dataset.acts = acts;
    const items: HTMLElement[] = [];
    if (planStep && options.onNextStep && planStep.hasNext) {
      const next = button('Следующий шаг плана →', 'next', true);
      next.setAttribute('aria-keyshortcuts', 'Enter');
      items.push(next);
    }
    items.push(button('Ещё подход', 'again'));
    if (planStep && !planStep.done && rated.assessment !== 'clean' && options.onCompleteStep) items.push(button('Отметить шаг выполненным', 'complete'));
    box.replaceChildren(...items);
  }
  /** Предложение пересчитывается при смене вида: «следующий вид» всегда от текущего. */
  function renderSuggestion() {
    if (!rated || !plan || !timeline) return;
    const advice = suggestion(rated.assessment, { bpm: rated.bpm, view, plan, timeline });
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
    setRange(action.range);
  }
  function setRange(range: PlaySettings['range']) {
    settings = { ...settings, range, loop: range ? true : settings.loop, ladder: range ? false : settings.ladder };
    sceneKey = '';
    if (runActive() && state.status !== 'stopped' && state.status !== 'finished') void begin(true);
    else update();
  }
  /** Петля на такт: повторный выбор того же такта снимает петлю; Shift продлевает до выбранного такта. */
  function loopBar(bar: number, extend: boolean) {
    const line = shownTimeline();
    if (!line || bar < 0 || bar >= line.bars) return;
    const current = settings.range;
    if (!extend && current && current.fromBar === bar && current.toBar === bar + 1) { setRange(null); return; }
    if (extend && current) setRange({ fromBar: Math.min(current.fromBar, bar), toBar: Math.max(current.toBar, bar + 1) });
    else setRange({ fromBar: bar, toBar: bar + 1 });
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

  /** Хост не разрешил звук: ничего не начинается, причина видна у транспорта. */
  function allowed() {
    if (!options.onBeforeStart || options.onBeforeStart()) return true;
    errorText = 'Звук сейчас не запускается: вкладка не активна или звук занят другим разделом.';
    update();
    return false;
  }
  async function begin(restart = false) {
    if (!plan || disposed || !timeline) return;
    errorText = ''; listenNote = '';
    if (!allowed()) return;
    if (listening) { listening = false; restart = true; }
    const config = playbackConfig(plan, timeline, settings);
    if (restart) observe(port.state());
    carryApproach(settings);
    runSettings = { ...settings };
    runTimeline = timeline;
    lastPass = 0; runPassIndex = -1; passMs = 0; passBpm = settings.bpm; previous = null; fromStart = false; shownStep = null; passHint = HINT_RANK[view];
    closeRate();
    busy = true;
    applyVolumes();
    const run = restart ? port.restart(config) : port.start(config);
    update();
    try { await run; }
    catch (failure) {
      errorText = `Звук не запустился: ${message(failure)}`;
      runSettings = null; approach = null;
      try { port.stop(); } catch { /* исходная ошибка остаётся видимой */ }
    } finally { busy = false; update(); }
  }
  function toggle() {
    if (!plan || disposed) return;
    if (listening) { stopListen('Эталон остановлен'); return; }
    const status = port.state().status;
    if (status === 'counting' || status === 'playing') port.pause('manual');
    else if (status === 'paused') {
      errorText = '';
      if (!allowed()) return;
      // «Оценить подход» на паузе без оценки: продолжение возвращает подход; после оценки начинается новый.
      if (!approach && runSettings) {
        const continued = !!pendingTally && !rated;
        carryApproach(runSettings);
        // После оценки начинается новый подход: оборванный проход доигрывается, но целым проходом не считается.
        if (!continued) runPassIndex = lastPass;
        closeRate();
      }
      busy = true;
      port.resume().catch(failure => { errorText = `Звук не продолжился: ${message(failure)}`; }).finally(() => { busy = false; update(); });
    } else void begin();
    update();
  }
  /** Esc: к началу; завершённые проходы подхода предлагаются к оценке, темп запоминается. */
  function toStart() {
    if (disposed) return;
    if (listening) { stopListen('Эталон остановлен'); return; }
    listenNote = '';
    observe(port.state());
    // Темп запоминается остановкой запуска; Esc без запуска (например, после оценки) не затирает темп оценки.
    const stoppedRun = runSettings !== null || approach !== null;
    try { port.stop(); } catch (failure) { errorText = message(failure); }
    runSettings = null;
    fromStart = true;
    shownStep = null;
    offerRate();
    approach = null;
    if (stoppedRun) notifySettings(['bpm']);
    update();
  }
  /* ---------- «Сначала услышь» ---------- */
  async function listen() {
    if (!plan || disposed) return;
    if (listening) { stopListen('Эталон остановлен'); return; }
    if (gameActive()) return;
    errorText = ''; listenNote = '';
    if (!allowed()) return;
    listening = true;
    runSettings = null; fromStart = false; shownStep = null; approach = null;
    busy = true;
    // Эталон слышен всегда, даже если в игре он выключен.
    try { port.setVolumes({ bass: 0.65 }); } catch { /* порт освобождён */ }
    const run = port.restart(listenConfig(plan, settings));
    options.onListen?.();
    update();
    try { await run; }
    catch (failure) {
      errorText = `Эталон не прозвучал: ${message(failure)}`;
      listening = false;
      applyVolumes();
      try { port.stop(); } catch { /* исходная ошибка остаётся видимой */ }
    } finally { busy = false; update(); }
  }
  /** Эталон закончился или остановлен: порт возвращается к первой ноте, проход не засчитывается. */
  function endListen(note: string) {
    listening = false;
    listenNote = note;
    try { port.stop(); } catch (failure) { errorText = message(failure); }
    applyVolumes();
    shownStep = null;
    observe(port.state());
  }
  function stopListen(note: string) {
    endListen(note);
    update();
  }

  function setFlag(flag: 'loop' | 'ladder' | 'echo') {
    if (flag === 'echo') { changeSettings({ echo: !settings.echo, range: null }); return; }
    const on = !settings[flag];
    if (flag === 'loop') settings = { ...settings, loop: on, ladder: on ? false : settings.ladder };
    else settings = { ...settings, ladder: on && ladderAvailable(settings), loop: on ? false : settings.loop };
    update();
  }

  /* ---------- Цикл кадра ---------- */
  function update() {
    if (disposed) return;
    observe(port.state());
    // Конец эталона — по состоянию проигрывателя на аудиочасах (finishAt), а не по последней запланированной ноте.
    if (listening && !busy && state.status !== 'playing') endListen(state.status === 'finished' ? 'Эталон прозвучал — теперь сыграй сам' : 'Эталон остановлен');
    renderScene();
    renderTransport();
    renderPanel();
    if (!raf && visible && (busy || ACTIVE.has(state.status))) raf = requestAnimationFrame(frame);
  }
  function frame() { raf = 0; update(); }
  function pauseHidden() {
    if (listening) { endListen('Эталон остановлен: вкладка скрывалась'); return; }
    const status = port.state().status;
    if (status === 'counting' || status === 'playing') port.pause('hidden');
  }

  /* ---------- События ---------- */
  scene.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const bar = target?.closest<SVGElement>('[data-bar]');
    if (bar && scene.contains(bar)) { loopBar(Number(bar.dataset.bar), event instanceof MouseEvent && event.shiftKey); return; }
    const button = target?.closest<HTMLButtonElement>('button');
    if (!button || !scene.contains(button) || button.disabled) return;
    const data = button.dataset;
    if (data.view) setView(data.view as PlayView);
    else if (data.label) setLabels(data.label as Exclude<BoardLabelMode, 'none'>);
    else if (data.play !== undefined) toggle();
    else if (data.restart !== undefined) toStart();
    else if (data.bpmStep) { applyBpm(settings.bpm + Number(data.bpmStep)); notifySettings(['bpm']); }
    else if (data.flag) setFlag(data.flag as 'loop' | 'ladder' | 'echo');
    else if (data.clearRange !== undefined) setRange(null);
    else if (data.panelToggle !== undefined) { panelOpen = !panelOpen; renderPanel(); }
    else if (data.reference) changeSettings({ reference: data.reference as ReferenceMode });
    else if (data.metronome) changeSettings({ metronome: data.metronome as MetronomeChoice });
    else if (data.countinBars !== undefined) changeSettings({ countInBars: Number(data.countinBars) as 0 | 1 | 2 });
    else if (data.rate) { rate(data.rate as Assessment); rateEl.focus({ preventScroll: true }); }
    else if (data.rateOpen !== undefined) offerRateNow();
    else if (data.rateClose !== undefined) closeRate();
    else if (data.after === 'next') options.onNextStep?.();
    else if (data.after === 'again') { closeRate(); at<HTMLButtonElement>('[data-play]').focus(); }
    else if (data.after === 'complete') { options.onCompleteStep?.(); button.disabled = true; }
    else if (data.back !== undefined) options.onBack?.();
    else if (data.listen !== undefined) void listen();
    else if (data.concept) options.onConcept?.(data.concept as ConceptId);
    else if (data.conceptOpen !== undefined && concept) options.onConcept?.(concept.id);
  }, { signal });

  /** «Оценить подход» на паузе: подход завершается, игра остаётся на паузе. */
  function offerRateNow() {
    observe(port.state());
    offerRate();
    update();
  }

  scene.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.bpm !== undefined) { applyBpm(Number(target.value) || settings.bpm); notifySettings(['bpm']); return; }
    if (target instanceof HTMLInputElement && target.dataset.target !== undefined) { changeSettings({ targetBpm: clampBpm(Number(target.value) || settings.targetBpm) }); return; }
    if (target instanceof HTMLSelectElement && target.dataset.groove !== undefined) { changeSettings({ groove: (target.value || null) as RhythmPresetId | null }); return; }
    if (target instanceof HTMLSelectElement && target.dataset.rhythmSelect !== undefined) { changeSettings({ rhythm: target.value as RhythmPatternId, range: null }); return; }
    if (target instanceof HTMLInputElement && target.dataset.volume) changeSettings(target.dataset.volume === 'click' ? { click: Number(target.value) / 100 } : { grooveVolume: Number(target.value) / 100 });
  }, { signal });
  scene.addEventListener('input', event => {
    const target = event.target;
    // Громкость слышна сразу, пока ползунок движется; сохранение — по `change`.
    if (target instanceof HTMLInputElement && target.dataset.volume) {
      settings = target.dataset.volume === 'click' ? { ...settings, click: Number(target.value) / 100 } : { ...settings, grooveVolume: Number(target.value) / 100 };
      applyVolumes();
    }
  }, { signal });

  document.addEventListener('keydown', event => {
    if (disposed || !visible || !plan) return;
    const escape = event.key === 'Escape';
    const space = event.code === 'Space' || event.key === ' ';
    const digit = /^Digit[1-4]$/.test(event.code) ? Number(event.code.slice(5)) : 0;
    if (digit) {
      if (!allowsSceneKey(event, scene)) return;
      event.preventDefault();
      setView(PLAY_VIEWS[digit - 1].id);
      return;
    }
    const assessment = ASSESSMENTS.find(item => item.code === event.code);
    if (assessment && !rateEl.hidden && pendingRate && !rated) {
      if (!allowsSceneKey(event, scene)) return;
      event.preventDefault(); rate(assessment.id);
      // Фокус на кнопке сцены забрал бы Enter («Следующий шаг»): он переходит на группу оценки.
      if (document.activeElement instanceof HTMLButtonElement && scene.contains(document.activeElement) && !rateEl.contains(document.activeElement)) rateEl.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Enter' && rated && planStep?.hasNext && options.onNextStep && !rateEl.hidden) {
      if (!allowsTransportShortcut(event, scene)) return;
      event.preventDefault(); options.onNextStep(); return;
    }
    if (event.code === 'KeyL' || event.code === 'KeyM' || event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      const arrows = event.code === 'ArrowLeft' || event.code === 'ArrowRight';
      // Shift+стрелка — ±5 BPM: модификатор разрешён только стрелкам.
      if (!allowsSceneKey(event, scene, { shift: arrows })) return;
      event.preventDefault();
      if (event.code === 'KeyM') { panelOpen = !panelOpen; renderPanel(); return; }
      if (event.code === 'KeyL') {
        const line = shownTimeline();
        const step = currentStep() ?? nextNoteStep(null);
        if (line && step !== null) loopBar(line.steps[step].bar, false);
        return;
      }
      const delta = (event.code === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 5 : 1);
      if (!(runSettings?.ladder && gameActive())) { applyBpm(settings.bpm + delta); notifySettings(['bpm']); }
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

  onPageVisibility(signal, () => { pauseHidden(); update(); });

  /* ---------- Запуск ---------- */
  setView(view, false);
  renderLabels();
  renderHeader();
  update();

  return {
    setExercise(nextPlan, _spec, nextSettings) {
      if (disposed) return;
      try { port.stop(); } catch { /* порт уже остановлен */ }
      plan = nextPlan;
      listening = false; listenNote = '';
      if (nextSettings) settings = initial(nextSettings);
      settings = { ...settings, range: null };
      timeline = timelineFor(nextPlan, settings);
      events = tabEvents(nextPlan, timeline);
      junctionList = junctions(nextPlan);
      runSettings = null; runTimeline = null; approach = null; fromStart = false; shownStep = null; errorText = ''; sceneKey = ''; approachNote = '';
      closeRate();
      applyVolumes();
      renderHeader();
      update();
    },
    setView(next) { if (!disposed) setView(next); },
    getView: () => view,
    getSettings: () => settings,
    setPlanStep(info) { planStep = info; renderNextActions(); if (!disposed) renderTransport(); },
    setVisible(next) {
      if (disposed || next === visible) return;
      visible = next;
      if (!visible) { pauseHidden(); if (raf) cancelAnimationFrame(raf); raf = 0; observe(port.state()); renderTransport(); }
      else update();
    },
    pause() {
      if (disposed) return;
      if (listening) { stopListen('Эталон остановлен'); return; }
      const status = port.state().status;
      if (status === 'counting' || status === 'playing') port.pause('manual');
      update();
    },
    stop() {
      if (disposed) return;
      try { port.stop(); } catch { /* порт уже остановлен */ }
      listening = false;
      runSettings = null; approach = null; fromStart = false; shownStep = null;
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
