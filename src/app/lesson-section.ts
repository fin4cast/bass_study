/**
 * Координатор раздела «Занятие» (P13-02, D-043): подэкраны «главная» (`mountLesson`), «игра» (`mountPlay`),
 * «Проверь себя» (`mountCheck`) и страница справочника (`mountReference`). Модули экранов не знают хранилища:
 * план, вид упражнения и записи истории уходят владельцу через колбэки, чистая логика — в `lesson-flow.ts`.
 */
import '../ui/play/play.css';
import { buildExercise, createExerciseSpec, type ConceptId, type ExerciseSpec, type ExerciseTemplateId } from '../exercises';
import { conceptForExerciseConcept } from '../practice/concepts';
import { builtinLibrary, type UserExercise } from '../practice/library';
import { selectStep, type CheckSpec, type DayPlan, type PlanStepContent } from '../practice/plan';
import type { Difficulty, PracticeRecord } from '../practice/results';
import type { AppPreferences, HistoryEntry, HistoryMetadata } from '../storage';
import { mountCheck } from '../ui/check/view';
import { mountLesson } from '../ui/lesson/view';
import { stepTitle } from '../ui/lesson/model';
import { createEnginePort, type PlaybackPort } from '../ui/play/port';
import { mountPlay, type PlayHandle, type RateEvent } from '../ui/play/view';
import { mountReference } from '../ui/reference/view';
import {
  addToPlan, bpmForExercise, checkEntry, exerciseKey, hasPlayed, nextPlanStep, planAfterCheck, planAfterRating, planForToday,
  playRatingEntry, plannedProgressIds, rememberView, repeatContent, specForKey, stepPosition, todayKey, viewForExercise,
} from './lesson-flow';

export type LessonScreen = 'home' | 'play' | 'check' | 'reference';

export interface LessonSectionOptions {
  readonly preferences: () => AppPreferences;
  /** Изменение настроек; `false` — вкладка сейчас не может записать (изменение не принято). */
  readonly savePreferences: (patch: Partial<AppPreferences>) => boolean;
  readonly records: () => readonly PracticeRecord[];
  readonly history: () => readonly HistoryEntry[];
  readonly userExercises: () => readonly UserExercise[];
  /** Запись в историю через очередь; закоммиченная запись возвращается владельцу отдельно. */
  readonly saveHistory: (entry: HistoryEntry) => void;
  /** Своё упражнение; бросает ошибку, если вкладка не может записать. */
  readonly saveExercise: (spec: ExerciseSpec, name: string) => void;
  readonly claimAudio: (owner: 'play' | 'check' | 'reference') => boolean;
  readonly forgetAudio: (owner: 'play' | 'check' | 'reference') => void;
  /** Панель справочника поверх экрана; `onClose` — после закрытия и возврата фокуса. */
  readonly openReferencePanel: (conceptId: string, returnFocus: HTMLElement | null, from: string, onClose: () => void) => void;
  readonly onMastered: (id: string, value: boolean) => void;
  readonly onOpenSection: (section: 'rhythm' | 'songs') => void;
  readonly onScreenChange: (screen: LessonScreen) => void;
  readonly onFailure: (message: string) => void;
}

function metadata(kind: 'exercise' | 'check'): HistoryMetadata {
  return { id: `${kind}-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);

export function createLessonSection(container: HTMLElement, options: LessonSectionOptions) {
  container.innerHTML = `
    <div class="lesson-screen" data-lesson-screen="home"></div>
    <div class="lesson-screen" data-lesson-screen="play" hidden></div>
    <div class="lesson-screen" data-lesson-screen="check" hidden></div>
    <div class="lesson-screen" data-lesson-screen="reference" hidden></div>`;
  const host = (screen: LessonScreen) => container.querySelector<HTMLElement>(`[data-lesson-screen="${screen}"]`)!;
  const playHost = host('play');

  let screen: LessonScreen = 'home';
  let visible = !container.hidden;
  let homeStale = true;
  let disposed = false;
  let play: { handle: PlayHandle; port: PlaybackPort; spec: ExerciseSpec; key: string; stepId: string | null } | null = null;
  let check: { spec: CheckSpec; stepId: string | null } | null = null;

  const today = () => todayKey();
  const records = () => options.records();
  const user = () => options.userExercises();
  const lessonPreferences = () => options.preferences().lesson;
  /** План на сегодня: сохранённый или выведенный для нового дня. */
  const currentPlan = () => planForToday(lessonPreferences().plan, today(), records().length === 0);
  function savePlan(plan: DayPlan) {
    return options.savePreferences({ lesson: { ...lessonPreferences(), plan } });
  }
  /** Выведенный план нового дня сохраняется, чтобы отметки шагов не зависели от появления первых записей. */
  function ensurePlan() {
    const plan = currentPlan();
    if (JSON.stringify(plan) !== JSON.stringify(lessonPreferences().plan)) savePlan(plan);
    return plan;
  }

  const home = mountLesson(host('home'), {
    onPlay(content, stepId) { open(content, stepId); },
    onPlanChange(plan) {
      if (!savePlan(plan)) throw new Error('План не сохранён: эта вкладка сейчас не может записывать.');
      renderHome();
    },
    onTabChange(tab) { options.savePreferences({ lesson: { ...lessonPreferences(), tab } }); },
    onPlayFromChange(root) {
      if (!options.savePreferences({ lesson: { ...lessonPreferences(), playFrom: root } })) throw new Error('Выбор не сохранён: эта вкладка сейчас не может записывать.');
      renderHome();
    },
    onOpenConcept(id) { openConcept(id); },
    onSaveExercise(spec, name) { options.saveExercise(spec, name); },
  });

  const checkView = mountCheck(host('check'), {
    onFinish(summary, answers) {
      if (!check) return;
      try {
        const entry = checkEntry({ spec: check.spec, userExercises: user(), activeMs: summary.activeMs, answers }, metadata('check'));
        if (entry) options.saveHistory(entry);
      } catch (failure) { options.onFailure(`Итог проверки не сохранён: ${message(failure)}`); }
    },
    onBack() { showHome(); },
    onNextStep() {
      const stepId = check?.stepId ?? null;
      if (stepId) {
        const plan = planAfterCheck(currentPlan(), stepId);
        savePlan(plan);
        const next = nextPlanStep(plan);
        if (next) { open(next.content, next.stepId); return; }
      }
      showHome();
    },
    onBeforeListen: () => options.claimAudio('check'),
  });
  checkView.setVisible(false);

  const reference = mountReference(host('reference'), {
    mastered: options.preferences().reference.mastered,
    onMastered: options.onMastered,
    onPlayTemplate: templateId => openTemplate(templateId),
    onOpenSection: options.onOpenSection,
    onBeforeListen: () => options.claimAudio('reference'),
    onListenEnd: () => options.forgetAudio('reference'),
    backLabel: '← Занятие',
    onBack: () => showHome(),
  });
  reference.setVisible(false);

  function homeState() {
    const prefs = options.preferences();
    return { plan: ensurePlan(), records: records(), userExercises: user(), firstRun: records().length === 0, playFrom: prefs.lesson.playFrom, tab: prefs.lesson.tab };
  }
  function renderHome() {
    if (disposed) return;
    if (!visible || screen !== 'home') { homeStale = true; return; }
    homeStale = false;
    home.update(homeState());
  }

  function setScreen(next: LessonScreen) {
    const previous = screen;
    if (previous === 'check' && next !== 'check') { checkView.stop(); options.forgetAudio('check'); }
    if (previous === 'play' && next !== 'play') disposePlay();
    screen = next;
    home.setVisible(next === 'home');
    playHost.hidden = next !== 'play';
    checkView.setVisible(visible && next === 'check');
    reference.setVisible(next === 'reference');
    options.onScreenChange(next);
    if (next === 'home') renderHome();
    window.scrollTo({ top: 0 });
  }

  function disposePlay() {
    if (!play) return;
    const { handle, port } = play;
    play = null;
    handle.dispose();
    port.dispose();
    options.forgetAudio('play');
  }

  function showHome() { setScreen('home'); }

  /** Шаг плана, открытый из плана, становится текущим. */
  function selectFromPlan(stepId: string | null) {
    if (!stepId) return;
    const plan = currentPlan();
    const step = plan.steps.find(candidate => candidate.id === stepId);
    if (!step || step.status !== 'pending') return;
    savePlan(selectStep(plan, stepId));
  }

  function open(content: PlanStepContent, stepId: string | null, bpm?: number) {
    selectFromPlan(stepId);
    if (content.kind === 'exercise') openPlay(content.spec, stepId, bpm);
    else openCheck(content.spec, stepId);
  }

  function stepLabel(stepId: string | null) {
    const position = stepPosition(currentPlan(), stepId);
    return position ? `шаг ${position.index} из ${position.total}` : null;
  }

  function openPlay(spec: ExerciseSpec, stepId: string | null, bpmOverride?: number) {
    let exercise;
    try { exercise = buildExercise(spec); }
    catch (failure) { options.onFailure(`Упражнение не открылось: ${message(failure)}`); return; }
    const prefs = options.preferences();
    const key = exerciseKey(spec, user());
    const played = hasPlayed(key, records());
    const view = viewForExercise(key, played, prefs.lesson, prefs.play);
    const bpm = bpmOverride ?? bpmForExercise(key, records(), prefs.play.bpm);
    const label = stepLabel(stepId);
    if (screen !== 'play') setScreen('play');
    else disposePlay();
    const port = createEnginePort();
    const handle = mountPlay(playHost, {
      port, initialView: view, bpm, countIn: prefs.play.countIn, labels: prefs.play.labels,
      backLabel: label ? `← Занятие · ${label}` : '← Занятие',
      onBack: showHome,
      onBeforeStart: () => options.claimAudio('play'),
      onRate: event => rate(event),
      onViewChange(next) {
        const lesson = lessonPreferences();
        options.savePreferences({ lesson: { ...lesson, viewByExercise: rememberView(lesson.viewByExercise, key, next) } });
      },
      onConcept: id => openConceptPanel(id),
    });
    handle.setExercise(exercise, spec);
    play = { handle, port, spec, key, stepId };
    if (!visible) handle.setVisible(false);
    const heading = playHost.querySelector<HTMLElement>('h1');
    if (heading && visible) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }

  function rate(event: RateEvent) {
    const current = play;
    if (!current) return;
    try {
      options.saveHistory(playRatingEntry({ spec: current.spec, userExercises: user(), view: current.handle.getView(), assessment: event.assessment, bpm: event.bpm, activeMs: event.activeMs }, metadata('exercise')));
    } catch (failure) { options.onFailure(`Самооценка не сохранена: ${message(failure)}`); return; }
    if (current.stepId) {
      const plan = currentPlan();
      const next = planAfterRating(plan, current.stepId, event.assessment);
      if (next !== plan) savePlan(next);
    }
  }

  function openConceptPanel(id: ConceptId) {
    const concept = conceptForExerciseConcept(id);
    if (!concept || !play) return;
    const returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    play.handle.setVisible(false);
    options.openReferencePanel(concept.id, returnFocus, `из экрана игры · «${concept.title}»`, () => {
      if (!disposed && screen === 'play' && visible) play?.handle.setVisible(true);
    });
  }

  function openCheck(spec: CheckSpec, stepId: string | null) {
    const plan = currentPlan();
    const position = stepPosition(plan, stepId);
    let nextLabel = 'Вернёмся в «Сегодня».';
    if (position && stepId) {
      const after = nextPlanStep(planAfterCheck(plan, stepId));
      const afterPosition = after ? stepPosition(plan, after.stepId) : null;
      nextLabel = after && afterPosition
        ? `Дальше: шаг ${afterPosition.index} из ${afterPosition.total} — ${stepTitle(after.content, user())}.`
        : `Шаг ${position.index} из ${position.total} — последний: вернёмся в «Сегодня».`;
    }
    check = { spec, stepId };
    setScreen('check');
    checkView.start(spec, { backLabel: position ? `план на сегодня, шаг ${position.index} из ${position.total}` : undefined, nextLabel });
  }

  function openConcept(id: string) {
    setScreen('reference');
    reference.open(id);
  }

  function openTemplate(templateId: ExerciseTemplateId) {
    const spec = builtinLibrary(lessonPreferences().playFrom).find(item => item.spec.templateId === templateId)?.spec ?? createExerciseSpec(templateId);
    openPlay(spec, null);
  }

  return {
    get screen() { return screen; },
    /** Новые записи, упражнения или настройки: главная перерисуется сейчас или при следующем показе. */
    refresh() { renderHome(); },
    setVisible(next: boolean) {
      if (disposed || next === visible) return;
      visible = next;
      container.hidden = !next;
      if (!next) reference.stopListening();
      play?.handle.setVisible(next && screen === 'play');
      checkView.setVisible(next && screen === 'check');
      if (next && screen === 'home' && homeStale) renderHome();
    },
    pausePlay() { play?.handle.pause(); },
    stopPlay() { play?.handle.stop(); },
    stopCheck() { checkView.stop(); },
    stopReference() { reference.stopListening(); },
    /** Открыть упражнение по ключу (из «Прогресса»); `bpm` — темп строки прогресса. */
    openExercise(key: string, bpm: number | null) {
      const prefs = options.preferences();
      const spec = specForKey(key, { records: records(), history: options.history(), userExercises: user(), playFrom: prefs.lesson.playFrom });
      if (!spec) { options.onFailure('Упражнение не найдено в библиотеке.'); return; }
      openPlay(spec, null, bpm ?? undefined);
    },
    openTemplate,
    openConcept,
    showHome,
    /** «Повторить» / «В план» из «Прогресса». */
    addToPlan(target: Difficulty | string) {
      const prefs = options.preferences();
      const key = typeof target === 'string' ? target : target.exerciseKey;
      const content = repeatContent(target, specForKey(key, { records: records(), history: options.history(), userExercises: user(), playFrom: prefs.lesson.playFrom }));
      if (!content) { options.onFailure('Упражнение не найдено в библиотеке.'); return false; }
      try {
        const plan = currentPlan();
        const next = addToPlan(plan, content, user());
        if (next !== plan && !savePlan(next)) return false;
        renderHome();
        return true;
      } catch (failure) { options.onFailure(message(failure)); return false; }
    },
    plan: currentPlan,
    plannedProgressIds: () => plannedProgressIds(currentPlan(), records(), user()),
    updateMastered(mastered: readonly string[]) { reference.update({ mastered }); },
    /** Восстановление или применение настроек: подэкраны закрываются, главная строится заново. */
    reset() {
      if (screen === 'check') checkView.stop();
      check = null;
      disposePlay();
      reference.update({ mastered: options.preferences().reference.mastered });
      setScreen('home');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposePlay();
      checkView.dispose();
      reference.dispose();
      home.dispose();
      container.innerHTML = '';
    },
  };
}
