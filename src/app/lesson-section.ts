/**
 * Координатор раздела «Занятие» (P13-02, D-043): подэкраны «главная» (`mountLesson`), «игра» (`mountPlay`),
 * «Проверь себя» (`mountCheck`) и страница справочника (`mountReference`). Модули экранов не знают хранилища:
 * план, вид упражнения и записи истории уходят владельцу через колбэки, чистая логика — в `lesson-flow.ts`.
 */
import '../ui/play/play.css';
import { buildExercise, createExerciseSpec, type ConceptId, type ExerciseSpec, type ExerciseTemplateId } from '../exercises';
import type { PracticeOptions } from '../exercises/rhythm';
import { conceptForExerciseConcept } from '../practice/concepts';
import { builtinLibrary, type UserExercise } from '../practice/library';
import { selectStep, type CheckSpec, type DayPlan, type PlanStepContent } from '../practice/plan';
import type { Difficulty, PracticeRecord } from '../practice/results';
import type { AppPreferences, HistoryEntry, HistoryMetadata } from '../storage';
import type { QuestionContext, QuizSession } from '../training';
import { reviewMaterial } from '../ui/check/session';
import { mountCheck } from '../ui/check/view';
import { mountLesson } from '../ui/lesson/view';
import { PROGRAM } from '../practice/program-data';
import { checkFacts, composeDay, dayPlanSteps, evaluateProgram, lineFacts, playContent, playFacts, stepRefs, stepRuleText, stepStatus, type Block, type PlayStep, type ProgramFacts, type SessionMinutes } from '../practice/program';
import { materialId } from '../practice/material';
import { stepTitle } from '../ui/lesson/model';
import { createEnginePort, type PlaybackPort } from '../ui/play/port';
import { mountPlay, type PlayHandle, type RateEvent } from '../ui/play/view';
import { mountReference } from '../ui/reference/view';
import { openTuner, type TunerHandle } from '../ui/tuner';
import {
  addToPlan, bpmAfterRating, checkEntry, exerciseKey, exerciseSettingsPatch, hasPlayed, nextPlanStep, planAfterCheck, planAfterNext, planAfterSkipChange, planAfterRating, planForToday, planStepInfo, stepAfter, variantChange,
  checkForKey, playRatingEntry, playSettingsFor, plannedProgressIds, rememberExerciseSettings, repeatContent, specForKey, stepPosition, todayKey, viewForExercise,
} from './lesson-flow';

export type LessonScreen = 'home' | 'play' | 'check' | 'reference';
/** Раздел, откуда открыт экран игры или «Проверь себя»: возврат ведёт туда, а не на главную «Занятия». */
export type LessonOrigin = 'foundation' | 'progress' | 'songs';
const ORIGIN_LABELS: Readonly<Record<LessonOrigin, string>> = { foundation: '← Гриф', progress: '← Прогресс', songs: '← Песни' };
const ORIGIN_NEXT: Readonly<Record<LessonOrigin, string>> = { foundation: 'Вернуться к грифу →', progress: 'Вернуться в «Прогресс» →', songs: 'Вернуться в «Песни» →' };

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
  readonly claimAudio: (owner: 'play' | 'check' | 'reference' | 'input') => boolean;
  readonly forgetAudio: (owner: 'play' | 'check' | 'reference' | 'input') => void;
  /** Сохранённый аудиовход «Настроек»: с него начинает тюнер. */
  readonly inputDevice?: () => string;
  /** Панель справочника поверх экрана; `onClose` — после закрытия и возврата фокуса. */
  readonly openReferencePanel: (conceptId: string, returnFocus: HTMLElement | null, from: string, onClose: () => void) => void;
  readonly onMastered: (id: string, value: boolean) => void;
  readonly onOpenSection: (section: 'rhythm' | 'songs') => void;
  readonly onScreenChange: (screen: LessonScreen) => void;
  readonly onFailure: (message: string) => void;
  /** Экранные задания R-006 из «Проверь себя» (ноты, все позиции, высота, интервал, повтор ошибок): одна запись на серию. */
  readonly saveScreen?: (session: QuizSession) => void;
  /** Возврат в раздел, откуда открыт экран игры или «Проверь себя». */
  readonly onReturn?: (section: LessonOrigin) => void;
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
  /** `keys` — все варианты материала, открытые на этом экране: таймер шага не обнуляется при смене лада (P18-04). */
  let play: { handle: PlayHandle; port: PlaybackPort; spec: ExerciseSpec; key: string; keys: readonly string[]; stepId: string | null; planDate: string | null; practice: PracticeOptions | null; program: { step: PlayStep; block: Block } | null } | null = null;
  let check: { spec: CheckSpec | null; stepId: string | null; planDate: string | null; origin: LessonOrigin | null } | null = null;
  /** Окно тюнера (R-020, D-052): открыто поверх «Занятия», вход — владелец звука `input`. */
  let tuner: TunerHandle | null = null;
  function openTunerWindow() {
    if (tuner?.isOpen || disposed) return;
    tuner = openTuner({
      deviceId: options.inputDevice?.() ?? '',
      onBeforeStart: () => options.claimAudio('input'),
      onClosed() { tuner = null; options.forgetAudio('input'); },
    });
  }

  const today = () => todayKey();
  const records = () => options.records();
  const user = () => options.userExercises();
  const lessonPreferences = () => options.preferences().lesson;
  /** План на сегодня: сохранённый или выведенный для нового дня. */
  /** Шаги программы на сегодня при выбранной длине занятия (R-028, D-052). */
  const composeSteps = (facts: ProgramFacts = programFacts(), minutes: SessionMinutes = lessonPreferences().sessionMinutes) => dayPlanSteps(composeDay(PROGRAM, facts, { minutes }));
  const currentPlan = () => planForToday(lessonPreferences().plan, today(), () => composeSteps());
  function savePlan(plan: DayPlan) {
    return options.savePreferences({ lesson: { ...lessonPreferences(), plan } });
  }
  /** Отметка шага по действию ученика: отказ записи показывается, а не теряется молча. */
  function savePlanStep(plan: DayPlan) {
    if (!savePlan(plan)) options.onFailure('План дня не сохранён: эта вкладка сейчас не может записывать.');
  }
  /** План дня, в котором открыт шаг: после полуночи он уже другой, и открытый шаг ему не принадлежит. */
  function planOf(planDate: string | null): DayPlan | null {
    const plan = currentPlan();
    return planDate !== null && plan.localDate === planDate ? plan : null;
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
    onBasicsViewChange(basicsView) { options.savePreferences({ lesson: { ...lessonPreferences(), basicsView } }); },
    onPlayStep(stepId, variant) { openProgramStep(stepId, variant); },
    onTuner() { openTunerWindow(); },
    onSkipBlock(blockId, skipped) {
      const lesson = lessonPreferences();
      const list = skipped ? [...lesson.skipped.filter(id => id !== blockId), blockId] : lesson.skipped.filter(id => id !== blockId);
      // Отметки меняют текущие шаги линий: невыполненный план дня собирается заново вместе с ними (R-028, «Первый запуск»).
      const plan = planAfterSkipChange(lesson.plan, today(), () => composeSteps(programFacts(new Set(list))));
      if (!options.savePreferences({ lesson: { ...lesson, skipped: list, plan } })) throw new Error('Отметка не сохранена: эта вкладка сейчас не может записывать.');
      renderHome();
    },
    onSessionMinutes(minutes) {
      const lesson = lessonPreferences();
      // До первого сделанного шага план дня собирается заново под новую длину; потом длина действует со следующего дня.
      const plan = planAfterSkipChange(lesson.plan, today(), () => composeSteps(programFacts(), minutes));
      if (!options.savePreferences({ lesson: { ...lesson, sessionMinutes: minutes, plan } })) throw new Error('Длина занятия не сохранена: эта вкладка сейчас не может записывать.');
      renderHome();
    },
  });

  const checkView = mountCheck(host('check'), {
    onFinish(summary, answers, played) {
      if (!check?.spec) return;
      try {
        // Серия идёт под тем видом вопросов и слухом, что сыграны: смена вида на экране не засчитывается шагу другого описания.
        const entry = checkEntry({ spec: { ...check.spec, kind: played.kind, ear: played.ear }, userExercises: user(), activeMs: summary.activeMs, answers }, metadata('check'));
        if (entry) options.saveHistory(entry);
      } catch (failure) { options.onFailure(`Итог проверки не сохранён: ${message(failure)}`); }
    },
    onScreen: session => options.saveScreen?.(session),
    onBack() { leave(check?.origin ?? null); },
    onNextStep() {
      if (check?.origin) { leave(check.origin); return; }
      const stepId = check?.stepId ?? null;
      const stored = planOf(check?.planDate ?? null);
      if (stepId && stored) {
        const plan = planAfterCheck(stored, stepId);
        savePlanStep(plan);
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
    // Тюнер открывается поверх «Занятия» на месте; «Ритм» и «Песни» — другие разделы.
    onOpenSection: section => (section === 'tuner' ? openTunerWindow() : options.onOpenSection(section)),
    onBeforeListen: () => options.claimAudio('reference'),
    onListenEnd: () => options.forgetAudio('reference'),
    backLabel: '← Занятие',
    onBack: () => showHome(),
  });
  reference.setVisible(false);

  /** Факты программы по истории и отметкам «Уже умею» (статусы нигде не хранятся). */
  function programFacts(skipped: ReadonlySet<string> = new Set(lessonPreferences().skipped)): ProgramFacts {
    const all = records();
    return { plays: playFacts(all), checks: checkFacts(all), lines: lineFacts(all), skippedBlocks: skipped, today: today() };
  }
  function homeState() {
    const prefs = options.preferences();
    return {
      plan: ensurePlan(), records: records(), userExercises: user(), firstRun: records().length === 0, playFrom: prefs.lesson.playFrom, tab: prefs.lesson.tab,
      basicsView: prefs.lesson.basicsView, program: PROGRAM, programState: evaluateProgram(PROGRAM, programFacts()), skipped: prefs.lesson.skipped,
      sessionMinutes: prefs.lesson.sessionMinutes,
    };
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
  /** Назад: в раздел, откуда открыт экран, иначе на главную «Занятия». Экран закрывается в любом случае. */
  function leave(origin: LessonOrigin | null) {
    showHome();
    if (origin) options.onReturn?.(origin);
  }

  /** Шаг плана, открытый из плана, становится текущим. */
  function selectFromPlan(stepId: string | null) {
    if (!stepId) return;
    const plan = currentPlan();
    const step = plan.steps.find(candidate => candidate.id === stepId);
    if (!step || step.status !== 'pending') return;
    savePlan(selectStep(plan, stepId));
  }

  /** Шаг программы, с которым связан шаг плана: темп открытия — базовый, под заданием виден зачёт (R-028). */
  function programOf(stepId: string | null): { step: PlayStep; block: Block } | null {
    const linked = stepId ? currentPlan().steps.find(item => item.id === stepId)?.programStep : undefined;
    const ref = linked ? stepRefs(PROGRAM).find(item => item.step.id === linked) : undefined;
    return ref && ref.step.kind === 'play' ? { step: ref.step, block: ref.block } : null;
  }

  function open(content: PlanStepContent, stepId: string | null, bpm?: number) {
    selectFromPlan(stepId);
    if (content.kind === 'exercise') openPlay(content.spec, stepId, bpm, null, content.practice ?? null, programOf(stepId));
    else openCheck(content.spec, stepId);
  }

  function stepLabel(stepId: string | null) {
    const position = stepPosition(currentPlan(), stepId);
    return position ? `шаг ${position.index} из ${position.total}` : null;
  }

  /** «▶ Играть» у шага пути: вариант шага со своим «как играть» и базовым темпом; проверка — серия из шести вопросов. */
  function openProgramStep(stepId: string, variant: number) {
    const ref = stepRefs(PROGRAM).find(item => item.step.id === stepId);
    if (!ref) return;
    if (ref.step.kind === 'play') openPlay(playContent(ref.step, variant).spec, null, undefined, null, ref.step.practice, { step: ref.step, block: ref.block });
    else if (ref.step.kind === 'check') openCheck(ref.step.check, null);
  }

  function openPlay(spec: ExerciseSpec, stepId: string | null, bpmOverride?: number, origin: LessonOrigin | null = null, practice: PracticeOptions | null = null, program: { step: PlayStep; block: Block } | null = null) {
    let exercise;
    try { exercise = buildExercise(spec); }
    catch (failure) { options.onFailure(`Упражнение не открылось: ${message(failure)}`); return; }
    const prefs = options.preferences();
    const key = exerciseKey(spec, user());
    const played = hasPlayed(key, records());
    const view = viewForExercise(key, played, prefs.lesson, prefs.play);
    const settings = playSettingsFor(spec, key, { lesson: prefs.lesson, play: prefs.play, records: records(), practice, bpm: bpmOverride, baseBpm: program !== null });
    const label = stepLabel(stepId);
    if (screen !== 'play') setScreen('play');
    else disposePlay();
    const port = createEnginePort();
    const handle = mountPlay(playHost, {
      port, initialView: view, settings, labels: prefs.play.labels, requiredPractice: practice,
      backLabel: origin ? ORIGIN_LABELS[origin] : label ? `← Занятие · ${label}` : '← Занятие',
      onBack: () => leave(origin),
      onBeforeStart: () => options.claimAudio('play'),
      onRate: event => rate(event),
      // Материал экрана может смениться (P18-04): ключ берётся из текущего состояния, а не из открытия.
      onViewChange(next) {
        const lesson = lessonPreferences();
        options.savePreferences({ lesson: { ...lesson, exerciseSettings: rememberExerciseSettings(lesson.exerciseSettings, play?.key ?? key, { view: next }) } });
      },
      // Свои упражнения варианта не меняют: смена параметра дала бы материал вне сохранённого.
      onVariantChange: key.startsWith('user:') ? undefined : (param, value) => {
        const current = play;
        if (!current) return { ok: false, error: 'Экран игры закрыт.' };
        const prefs = options.preferences();
        const change = variantChange(current.spec, param, value, { lesson: prefs.lesson, play: prefs.play, records: records(), userExercises: user(), practice, baseBpm: program !== null });
        if (!change.ok) return change;
        // Состояние меняется здесь, после того как экран оценил или отбросил прежний подход.
        play = { ...current, spec: change.spec, key: change.key, keys: current.keys.includes(change.key) ? current.keys : [...current.keys, change.key] };
        refreshPlanStep();
        return { ok: true, plan: program?.step.task ? { ...change.plan, task: program.step.task } : change.plan, settings: change.settings, view: change.view };
      },
      // Темп, цель, ритм и подложка — упражнения (только то, что менялось); эталон, метроном, громкости, отсчёт
      // и подписи — общие умолчания. «Как играть» шага цели — свойство шага: ритм и подложка не запоминаются.
      onSettingsChange(next, labels, changed) {
        const prefs = options.preferences();
        options.savePreferences({
          lesson: { ...prefs.lesson, exerciseSettings: rememberExerciseSettings(prefs.lesson.exerciseSettings, play?.key ?? key, exerciseSettingsPatch(next, changed, practice !== null)) },
          // «Пр. рука» есть не у всех упражнений — умолчанием подписей не становится.
          play: { ...prefs.play, countInBars: next.countInBars, reference: next.reference, metronome: next.metronome, click: next.click, grooveVolume: next.grooveVolume, accompaniment: next.accompaniment, accompanimentVolume: next.accompanimentVolume, labels: labels === 'pluck' ? prefs.play.labels : labels },
        });
      },
      onConcept: id => openConceptPanel(id),
      onNextStep: () => nextFromPlay(),
      onSkipStep: () => skipFromPlay(),
      onCompleteStep: () => {
        const current = play;
        const stored = current ? planOf(current.planDate) : null;
        if (!current?.stepId || !stored) return;
        savePlanStep(planAfterNext(stored, current.stepId));
        refreshPlanStep();
      },
    });
    handle.setExercise(program?.step.task ? { ...exercise, task: program.step.task } : exercise, spec);
    play = { handle, port, spec, key, keys: [key], stepId, planDate: stepId ? currentPlan().localDate : null, practice, program };
    refreshPlanStep();
    if (!visible) handle.setVisible(false);
    const heading = playHost.querySelector<HTMLElement>('h1');
    if (heading && visible) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }

  function rate(event: RateEvent) {
    const current = play;
    if (!current) return;
    try {
      options.saveHistory(playRatingEntry({ spec: current.spec, userExercises: user(), view: event.passView, wholePass: event.wholePass, assessment: event.assessment, bpm: event.bpm, activeMs: event.activeMs, practice: event.practice }, metadata('exercise')));
    } catch (failure) { options.onFailure(`Самооценка не сохранена: ${message(failure)}`); return; }
    // Неполный проход (0 проходов) записывает время, но не закрывает шаг и не задаёт темп следующего открытия.
    if (event.passes === 0) { refreshPlanStep(); return; }
    const lesson = lessonPreferences();
    options.savePreferences({ lesson: { ...lesson, exerciseSettings: rememberExerciseSettings(lesson.exerciseSettings, current.key, { bpm: bpmAfterRating(event.assessment, event.bpm) }) } });
    const stored = current.stepId ? planOf(current.planDate) : null;
    if (current.stepId && stored) {
      const next = planAfterRating(stored, current.stepId, event.assessment);
      if (next !== stored) savePlanStep(next);
    }
    refreshPlanStep();
  }

  /** Таймер шага и кнопки «Следующий шаг» / «Отметить выполненным» на экране игры. */
  function refreshRule() {
    const current = play;
    if (!current?.program) return;
    const { step, block } = current.program;
    const status = stepStatus(step, block, programFacts());
    const counts = step.variants.some(variant => materialId(variant) === materialId(current.spec));
    current.handle.setRule(status ? stepRuleText(step, status, counts) : null);
  }

  function refreshPlanStep() {
    if (!play) return;
    refreshRule();
    play.handle.setPlanStep(planStepInfo(currentPlan(), planOf(play.planDate) ? play.stepId : null, play.keys, records()));
  }

  /** «Следующий шаг →» в шапке без оценки: шаг остаётся невыполненным, открывается следующий невыполненный. */
  function skipFromPlay() {
    const current = play;
    const stored = current?.stepId ? planOf(current.planDate) : null;
    const next = stored ? stepAfter(stored, current!.stepId) : null;
    if (next) open(next.content, next.stepId);
  }

  /** «Следующий шаг плана →»: текущий шаг выполнен, открывается следующий невыполненный шаг. */
  function nextFromPlay() {
    const current = play;
    if (!current?.stepId) return;
    const stored = planOf(current.planDate);
    if (!stored) { leave(null); return; }
    const plan = planAfterNext(stored, current.stepId);
    if (plan !== stored) savePlanStep(plan);
    const next = nextPlanStep(plan);
    if (next) open(next.content, next.stepId);
    else leave(null);
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
    let nextLabel = 'Вернёмся в «Занятие».';
    if (position && stepId) {
      const after = nextPlanStep(planAfterCheck(plan, stepId));
      const afterPosition = after ? stepPosition(plan, after.stepId) : null;
      nextLabel = after && afterPosition
        ? `Дальше: шаг ${afterPosition.index} из ${afterPosition.total} — ${stepTitle(after.content, user())}.`
        : `Шаг ${position.index} из ${position.total} — последний: вернёмся в «Сегодня».`;
    }
    check = { spec, stepId, planDate: stepId ? plan.localDate : null, origin: null };
    setScreen('check');
    checkView.start(spec, { backLabel: position ? `план на сегодня, шаг ${position.index} из ${position.total}` : undefined, nextLabel });
  }

  /** «Проверь себя» из другого раздела: без шага плана, возврат — в исходный раздел. */
  function openCheckFrom(spec: CheckSpec, origin: LessonOrigin) {
    // Начатая серия закрывается со своим описанием до смены текущей проверки.
    if (screen === 'check') checkView.stop();
    check = { spec, stepId: null, planDate: null, origin };
    setScreen('check');
    checkView.start(spec, { backText: ORIGIN_LABELS[origin], nextText: ORIGIN_NEXT[origin] });
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
    refresh() { renderHome(); refreshPlanStep(); },
    setVisible(next: boolean) {
      if (disposed || next === visible) return;
      visible = next;
      container.hidden = !next;
      if (!next) { reference.stopListening(); tuner?.close(); }
      play?.handle.setVisible(next && screen === 'play');
      checkView.setVisible(next && screen === 'check');
      if (next && screen === 'home' && homeStale) renderHome();
    },
    pausePlay() { play?.handle.pause(); },
    stopPlay() { play?.handle.stop(); },
    stopCheck() { checkView.stop(); },
    stopReference() { reference.stopListening(); },
    /** Тюнер открыт: владелец `input` может звучать в «Занятии». */
    get tunerOpen() { return Boolean(tuner?.isOpen); },
    openTuner() { openTunerWindow(); },
    stopTuner() { tuner?.stop('Звук занял другой раздел: вход отключён. Для нового подключения нажми «Подключить».'); },
    /** Открыть упражнение по ключу (из «Прогресса»); `bpm` — темп строки прогресса. */
    openExercise(key: string, bpm: number | null) {
      if (key.startsWith('check:')) {
        // Строка проверки в «Прогрессе»: «Проверить снова» открывает ту же проверку по описанию из записи.
        const again = checkForKey(key, options.history());
        if (!again) { options.onFailure('Проверка не найдена в истории.'); return; }
        openCheckFrom(again, 'progress');
        return;
      }
      const prefs = options.preferences();
      const spec = specForKey(key, { records: records(), history: options.history(), userExercises: user(), playFrom: prefs.lesson.playFrom });
      if (!spec) { options.onFailure('Упражнение не найдено в библиотеке.'); return; }
      openPlay(spec, null, bpm ?? undefined);
    },
    openTemplate,
    openConcept,
    showHome,
    /** «Сыграть эту форму» из «Грифа»: экран игры по описанию упражнения; возврат — в «Гриф». */
    playExercise(spec: ExerciseSpec, origin: LessonOrigin = 'foundation') { openPlay(spec, null, undefined, origin); },
    /** «Проверь себя по этой форме» из «Грифа»: проверка по материалу упражнения; возврат — в «Гриф». */
    checkExercise(spec: CheckSpec, origin: LessonOrigin = 'foundation') { openCheckFrom(spec, origin); },
    /**
     * «Повторить ошибки» прежних заданий на грифе (R-011): «Проверь себя» в режиме повтора — «Назови ноту» только
     * по этим позициям в исходной тональности и структуре; результат — экранное задание в истории.
     * Неверные позиции или контекст — RangeError, экран не меняется.
     */
    repeatErrors(positionIds: readonly string[], context: Pick<QuestionContext, 'root' | 'structureId'>, origin: LessonOrigin = 'progress') {
      reviewMaterial(positionIds, context);
      if (screen === 'check') checkView.stop();
      check = { spec: null, stepId: null, planDate: null, origin };
      setScreen('check');
      checkView.startReview(positionIds, context, { backText: ORIGIN_LABELS[origin], nextText: ORIGIN_NEXT[origin] });
    },
    /** «Повторить» / «В план» из «Прогресса». */
    addToPlan(target: Difficulty | string) {
      const prefs = options.preferences();
      const key = typeof target === 'string' ? target : target.exerciseKey;
      const again = typeof target === 'string' && target.startsWith('check:') ? checkForKey(target, options.history()) : null;
      const content = again ? { kind: 'check' as const, spec: again } : repeatContent(target, specForKey(key, { records: records(), history: options.history(), userExercises: user(), playFrom: prefs.lesson.playFrom }));
      if (!content) { options.onFailure(again === null && key.startsWith('check:') ? 'Проверка не найдена в истории.' : 'Упражнение не найдено в библиотеке.'); return false; }
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
      tuner?.close();
      check = null;
      disposePlay();
      reference.update({ mastered: options.preferences().reference.mastered });
      setScreen('home');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      tuner?.close();
      disposePlay();
      checkView.dispose();
      reference.dispose();
      home.dispose();
      container.innerHTML = '';
    },
  };
}
