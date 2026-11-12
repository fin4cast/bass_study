import { mountFoundation } from '../ui/foundation';
import { mountRhythm, type RhythmLibrary, type RhythmLibraryOperation } from '../ui/rhythm';
import { DEFAULT_RHYTHM_PREFERENCES } from '../rhythm/model';
import { mountStudio } from '../ui/studio';
import { mountInput } from '../ui/input';
import { mountProgress, type ProgressView } from '../ui/progress/view';
import { mountSettings, type SettingsView } from '../ui/settings/view';
import type { BackupChoice, BackupCounts, SaveStatus, SectionId, SettingsState } from '../ui/settings/model';
import { mountReferencePanel } from '../ui/reference/panel';
import { onPageVisibility } from '../ui/page-visibility';
import type { ExerciseSpec } from '../exercises';
import { practiceRecords } from '../practice/history';
import { validateUserExercise, type UserExercise } from '../practice/library';
import type { PracticeRecord } from '../practice/results';
import {
  createStudyStore, createMemoryStudyStore, describeSkippedRecords, DEFAULT_PROFILE, MAX_BACKUP_BYTES, STUDY_SCHEMA_VERSION, StudyStorageError,
  type AppPreferences, type GlobalProfile, type HistoryCommit, type HistoryEntry, type PreparedStudyImport, type StudySnapshot,
} from '../storage';
import { version as APP_VERSION } from '../../package.json';
import { renderAppShell } from './app-shell';
import { backupVersion, downloadJson } from './backup';
import { createWriteQueue } from './write-queue';
import { mountShell } from './shell';
import { APP_SECTIONS, workspaceLayout, type AppSection } from './page-frame';
import { createPageLayout } from './page-layout';
import { createPersistencePhase } from './persistence-phase';
import { createPersistenceStatus } from './persistence-status';
import { createPreferences } from './preferences';
import { createSessionHistory } from './session-history';
import { createThemeController } from './theme';
import { createPracticeDrafts } from './practice-drafts';
import { createPracticeContext, rhythmPracticeBinding } from './practice-context';
import { createSectionAudio, type AppSections } from './sections';
import { createLessonSection } from './lesson-section';
import { describeProgressRow, fromPlayDefaults, toPlayDefaults } from './lesson-flow';
import { acquireWriterLease } from './writer-lock';

const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);

/**
 * Координатор: право записи и хранилище, применение настроек, навигация между разделами и связь разделов
 * с очередью записи, черновиками и историей. Разметка оболочки — `app-shell.ts`, статус сохранения —
 * `persistence-status.ts`, привязка черновика к часам — `practice-context.ts`, звук разделов — `sections.ts`,
 * раздел «Занятие» — `lesson-section.ts`.
 */
export function mountApplication(app: HTMLElement, installed: readonly AppSection[] = APP_SECTIONS) {
  const available = APP_SECTIONS.filter(id => installed.includes(id));
  const fallback = available.includes('lesson') ? 'lesson' : available[0];
  if (!fallback) throw new Error('Нужен хотя бы один раздел тренажёра.');
  const resolveSection = (id: AppPreferences['activeModule']) => available.includes(id) ? id : fallback;
  const lifetime = new AbortController();
  const listen = { signal: lifetime.signal };
  app.innerHTML = renderAppShell(fallback, available);

  const byId = <T extends HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  const sections: AppSections = {};
  let progressView: ProgressView | undefined;
  let progressStale = true;
  let settingsView: SettingsView | undefined;
  let settingsSection: SectionId = 'look';
  let saveStatus: SaveStatus = 'saved';
  let profile: GlobalProfile = DEFAULT_PROFILE;
  let activeModule: AppSection = fallback;
  const preferences = createPreferences();
  let confirmedRhythm: RhythmLibrary = { projects: [], activeId: null };
  /** Подтверждённая история и свои упражнения: из снимка при старте, дальше — только закоммиченные записи. */
  let historyEntries: HistoryEntry[] = [];
  let records: readonly PracticeRecord[] = [];
  let userExercises: readonly UserExercise[] = [];
  let store: ReturnType<typeof createStudyStore> | ReturnType<typeof createMemoryStudyStore> = createStudyStore();
  let persistent = true;
  let applyingPreferences = true;
  let retiring = false;
  let retirement: Promise<void> | undefined;
  let retryingWrites: Promise<boolean> | undefined;
  let writerLease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  let panelClosed: (() => void) | null = null;
  const main = app.querySelector<HTMLElement>('main')!;
  const appShell = app.querySelector<HTMLElement>('.app-shell')!;
  const layout = createPageLayout(app.querySelector<HTMLElement>('.app-content')!);
  const phase = createPersistencePhase(() => Boolean(writerLease?.acquired), () => {
    main.inert = !phase.writable;
    main.setAttribute('aria-busy', String(main.inert));
    enableHeader(phase.writable);
    byId<HTMLButtonElement>('retry-save').disabled = !phase.exclusiveReady;
    refreshSettings();
  });
  const audio = createSectionAudio(sections, {
    canStartAny: () => !retiring && !applyingPreferences && !main.inert && !document.hidden && Boolean(writerLease?.acquired),
    activeModule: () => activeModule,
  });
  const status = createPersistenceStatus(app, {
    isSuspended: () => retiring || phase.phase === 'reload',
    isPersistent: () => persistent,
    hasDraftChanges: () => drafts.hasPendingChanges(),
    publish(text, kind) {
      // Только память страницы — тоже несохранённое: «Настройки» говорят об этом прямо.
      saveStatus = kind === 'error' || kind === 'memory' ? { error: text } : kind === 'saving' ? 'saving' : 'saved';
      refreshSettings();
    },
  });
  const showPersistenceStatus = status.show;
  const writes = createWriteQueue(value => status.setWriteState(value));
  byId('open-storage-details').addEventListener('click', status.toggleDetails, listen);
  const theme = createThemeController({ onChange(value) { setProfile({ ...profile, theme: value }); refreshSettings(); } });
  function setProfile(value: GlobalProfile) {
    if (retiring || !writerLease?.acquired || main.inert || applyingPreferences) return;
    profile = structuredClone(value);
    const confirmed = structuredClone(value);
    void writes.run(() => store.saveProfile(confirmed), 'profile', writes.supersede('profile'), () => {
      if (persistent) theme.confirmPreference(confirmed.theme);
    }).catch(() => {});
  }
  function enableHeader(enabled: boolean) { appShell.querySelectorAll<HTMLButtonElement>('.site-header button').forEach(button => { button.disabled = !enabled; }); }
  appShell.querySelectorAll<HTMLButtonElement>('.site-header [data-theme-choice]').forEach(button => button.addEventListener('click', () => { const value = button.dataset.themeChoice; if (value === 'light' || value === 'dark') theme.setPreference(value); }, listen));
  const drafts = createPracticeDrafts({ getStore: () => store, write: (operation, key) => writes.run(operation, key), supersede: key => writes.supersede(key), resolveSuperseded: key => writes.resolveSuperseded(key),
    onCommit() { showPersistenceStatus(); refreshSettings(); }, onEntry(entry, linkedRoute) { publishHistoryCommit({ entry, linkedRoute }); },
    onChange() { showPersistenceStatus(); },
  });
  const practice = createPracticeContext({
    drafts,
    isSuspended: () => retiring || applyingPreferences,
    activeModule: () => activeModule,
    foundation: () => sections.foundation,
    rhythm: () => sections.rhythm,
  });
  const syncPracticeBinding = practice.sync;
  async function flushAll() { try { await drafts.flush(); } finally { await writes.flush(); } }

  function applyRhythmLibrary(snapshot: StudySnapshot) {
    confirmedRhythm = { projects: snapshot.rhythmProjects, activeId: snapshot.activeRhythmProjectId };
    sections.rhythm?.applyLibrary(confirmedRhythm);
  }

  function applyStudyData(snapshot: StudySnapshot) {
    historyEntries = [...snapshot.history];
    records = practiceRecords(historyEntries);
    userExercises = snapshot.exercises;
  }

  async function changeRhythmLibrary(operation: RhythmLibraryOperation, onCommit: (library: RhythmLibrary) => void) {
    if (!phase.writable) throw new Error('Эта вкладка не может сохранить проект ритма.');
    const key = 'rhythm-library';
    const generation = writes.supersede(key);
    const snapshotGeneration = phase.generation;
    const command = structuredClone(operation);
    await writes.run(() => store.changeRhythmLibrary(command), key, generation, ({ change, activeId }) => {
      if (snapshotGeneration !== phase.generation || retiring) return;
      let projects = confirmedRhythm.projects;
      if (change.kind === 'save') {
        projects = projects.some(item => item.id === change.project.id)
          ? projects.map(item => item.id === change.project.id ? change.project : item)
          : [...projects, change.project];
      } else if (change.kind === 'delete') projects = projects.filter(item => item.id !== change.id);
      confirmedRhythm = { projects, activeId };
      onCommit(confirmedRhythm);
      refreshSettings();
    });
  }

  function retryWrites(key?: string) {
    if (!phase.exclusiveReady) return Promise.resolve(false);
    retryingWrites = phase.retry(() => writes.retry(key));
    return retryingWrites;
  }

  /** Закоммиченная запись истории попадает в «Сегодня», «Прогресс» и счётчики копии. */
  function publishHistoryCommit(commit: HistoryCommit) {
    if (retiring) return;
    for (const entry of [commit.entry, commit.linkedRoute]) {
      if (!entry) continue;
      const index = historyEntries.findIndex(item => item.id === entry.id);
      if (index === -1) historyEntries.push(entry); else historyEntries[index] = entry;
    }
    records = practiceRecords(historyEntries);
    sections.lesson?.refresh();
    refreshProgress();
    refreshSettings();
  }

  function saveHistoryEntry(entry: HistoryEntry) {
    const snapshotGeneration = phase.generation;
    const key = `history:${entry.id}`;
    void writes.run(() => store.addHistory(entry), key, writes.supersede(key), commit => {
      if (snapshotGeneration === phase.generation) publishHistoryCommit(commit);
    }).catch(() => {});
  }

  function saveExercise(spec: ExerciseSpec, name: string) {
    if (retiring || !phase.writable) throw new Error('Упражнение не сохранено: эта вкладка сейчас не может записывать.');
    const exercise = validateUserExercise({ version: 'user-exercise-v1', id: `own-${crypto.randomUUID()}`, name, spec, createdAt: new Date().toISOString() });
    const snapshotGeneration = phase.generation;
    void writes.run(() => store.saveExercise(exercise), `exercise:${exercise.id}`, undefined, () => {
      if (snapshotGeneration !== phase.generation || retiring) return;
      userExercises = [...userExercises, exercise];
      sections.lesson?.refresh();
      refreshSettings();
    }).catch(() => {});
  }

  function reportFailure(text: string) {
    console.error(text);
    status.showBanner(text, { error: true });
  }

  function noteSkippedRecords() {
    status.setSkippedIssue(describeSkippedRecords(store.skippedRecords()));
  }

  /** Изменение настроек; `false` — вкладка сейчас не может записать и изменение не принято. */
  function savePreferences(patch: Partial<AppPreferences>): boolean {
    if (retiring || applyingPreferences || !phase.writable) return false;
    try {
      if (!preferences.update(patch) && !status.preferenceIssue) return true;
      status.setPreferenceIssue('');
      const generation = writes.supersede('preferences');
      const value = preferences.value;
      void writes.run(() => store.savePreferences(value), 'preferences', generation).catch(() => {});
      return true;
    } catch (failure) {
      status.setPreferenceIssue(`Настройки ещё не сохранены: ${message(failure)}`);
      showPersistenceStatus();
      return false;
    }
  }

  const sessions = createSessionHistory({
    canPublish: () => !retiring && phase.phase !== 'reload',
    save: saveHistoryEntry,
    failure: reportFailure,
  });

  function layoutOf(section: AppSection) {
    return section === 'lesson' && sections.lesson?.screen === 'play' ? 'bounded' : workspaceLayout(section);
  }

  function updateInputVisibility() {
    sections.input?.setVisible(activeModule === 'settings' && settingsSection === 'input');
  }

  function updateModuleVisibility() {
    shell.setActivePage(activeModule, layoutOf(activeModule));
    for (const [id, screen] of screens) screen.setVisible(id === activeModule);
    updateInputVisibility();
    if (activeModule === 'progress' && progressStale) refreshProgress();
    if (activeModule === 'settings') refreshSettings();
  }

  function switchModule(next: AppSection) {
    if (!available.includes(next)) return;
    if (next === activeModule) { savePreferences({ activeModule: next }); return; }
    drafts.capture();
    if (activeModule === 'foundation') { sections.foundation?.finishSession('Занятие остановлено при смене раздела'); audio.end('sequence', 'section'); }
    if (activeModule === 'lesson') { audio.end('play', 'section'); audio.end('check', 'section'); }
    if (activeModule === 'settings') audio.end('input', 'section');
    audio.forget();
    activeModule = next;
    updateModuleVisibility();
    syncPracticeBinding();
    savePreferences({ activeModule: next });
  }

  function applyPreferences(snapshot: AppPreferences) {
    const value = preferences.hydrate(snapshot, 'restore');
    drafts.capture();
    applyingPreferences = true;
    try {
      status.setPreferenceIssue('');
      sections.foundation?.finishSession('Занятие остановлено перед применением настроек');
      audio.endAll('settings');
      activeModule = resolveSection(value.activeModule);
      sections.foundation?.applyPreferences(value);
      sections.rhythm?.applyPreferences(value.rhythm ?? DEFAULT_RHYTHM_PREFERENCES);
      sections.studio?.applyPreferences(value);
      sections.input?.applyPreferences(value.input);
      sections.lesson?.reset();
      referencePanel.update({ mastered: value.reference.mastered });
      mountProgressView();
      updateModuleVisibility();
    } finally { applyingPreferences = false; syncPracticeBinding(); }
  }

  /* ---------- Справочник: панель поверх экрана ---------- */
  function setMastered(id: string, value: boolean) {
    const current = preferences.value.reference.mastered;
    const mastered = value ? [...new Set([...current, id])] : current.filter(item => item !== id);
    if (!savePreferences({ reference: { mastered } })) reportFailure('Отметка «освоено» не сохранена: эта вкладка сейчас не может записывать.');
    const confirmed = preferences.value.reference.mastered;
    referencePanel.update({ mastered: confirmed });
    sections.lesson?.updateMastered(confirmed);
  }
  const referencePanel = mountReferencePanel(app, {
    mastered: [],
    footnote: 'Игра на паузе под панелью',
    onMastered: setMastered,
    onPlayTemplate(templateId) { referencePanel.close(); switchModule('lesson'); sections.lesson?.openTemplate(templateId); },
    onOpenSection(section) { referencePanel.close(); switchModule(section === 'rhythm' ? 'harmony' : 'tracks'); },
    onOpenFull(id) { switchModule('lesson'); sections.lesson?.openConcept(id); },
    onClose() { const closed = panelClosed; panelClosed = null; closed?.(); },
  });

  /* ---------- Разделы ---------- */
  if (available.includes('lesson')) sections.lesson = createLessonSection(byId('lesson-mount'), {
    preferences: () => preferences.value,
    savePreferences,
    records: () => records,
    history: () => historyEntries,
    userExercises: () => userExercises,
    saveHistory: saveHistoryEntry,
    saveExercise,
    claimAudio: owner => audio.claim(owner),
    forgetAudio: owner => audio.forget(owner),
    openReferencePanel(conceptId, returnFocus, from, onClose) {
      panelClosed = onClose;
      referencePanel.open(conceptId, returnFocus, from);
    },
    onMastered: setMastered,
    onOpenSection: section => switchModule(section === 'rhythm' ? 'harmony' : 'tracks'),
    onScreenChange() { if (activeModule === 'lesson') shell.setLayout(layoutOf('lesson')); },
    onFailure: reportFailure,
  });
  if (available.includes('foundation')) sections.foundation = mountFoundation(byId('foundation-mount'), {
    getPlayerFallback: () => preferences.value.player,
    onPreferencesChange: value => { savePreferences(value); },
    onBeforeMaterialChange() { drafts.capture(); },
    onBeforeModeChange() { drafts.capture(); },
    onContextChange() { syncPracticeBinding(); },
    onRouteExit() { drafts.capture(); syncPracticeBinding(); },
    capturePractice() { drafts.capture(); status.showIfDraftChanged(); },
    getRouteSession: () => null,
    onBeforeStart() { if (!audio.claim('sequence')) return false; syncPracticeBinding(); return true; },
    onPlaybackStopped() { void drafts.flush().catch(() => {}); },
    onSessionChanged: sessions.screen,
    onSessionFinished: sessions.screen,
    getOuterBottomSpace: () => parseFloat(getComputedStyle(appShell).marginBottom),
    reveal: layout.reveal,
  });
  if (available.includes('harmony')) sections.rhythm = mountRhythm(byId('harmony-mount'), {
    onPreferencesChange: () => { if (sections.rhythm) savePreferences({ rhythm: sections.rhythm.getPreferences() }); },
    onLibraryChange: changeRhythmLibrary,
    onLibraryRetry: () => retryWrites('rhythm-library'),
    onBeforeStart: () => audio.claim('rhythm'),
    onPracticeEnd(value) {
      drafts.captureClosed(rhythmPracticeBinding(value));
      void drafts.flush().catch(() => {});
    },
    onPracticeChange: syncPracticeBinding,
    // «Темп занятия» (D-046) — `play.bpm`: «Ритм» предлагает его и обновляет правкой темпа метронома.
    lessonTempo: () => preferences.value.play.bpm,
    onLessonTempo: bpm => { savePreferences({ play: { ...preferences.value.play, bpm } }); },
  });
  sections.rhythm?.setVisible(false);
  if (available.includes('tracks')) sections.studio = mountStudio(byId('tracks-mount'), {
    observeHeight: layout.observeHeight,
    beforePlay: view => audio.claim(view === 'audio' ? 'tracks' : 'scores'),
    onLeaveView: view => audio.forget(view === 'audio' ? 'tracks' : 'scores'),
    onPreferencesChange: value => { savePreferences(value); },
  });

  /* ---------- «Прогресс» ---------- */
  function refreshProgress() {
    if (!progressView) return;
    if (activeModule !== 'progress') { progressStale = true; return; }
    progressStale = false;
    progressView.update({ records, plan: sections.lesson?.plannedProgressIds() ?? [] });
  }
  /** Вкладка и источник приходят из настроек только при монтировании, поэтому после восстановления экран монтируется заново. */
  function mountProgressView() {
    if (!available.includes('progress')) return;
    progressView?.dispose();
    const lesson = preferences.value.lesson;
    progressView = mountProgress(byId('progress-mount'), {
      records, plan: sections.lesson?.plannedProgressIds() ?? [],
      initialTab: lesson.progressTab, initialSource: lesson.progressSource,
      describe: row => describeProgressRow(row, historyEntries),
      onRepeat(target) { if (!sections.lesson?.addToPlan(target)) { progressStale = true; refreshProgress(); } },
      onPlay(key, bpm) { switchModule('lesson'); sections.lesson?.openExercise(key, bpm); },
      onGoToLesson() { switchModule('lesson'); sections.lesson?.showHome(); },
      onTabChange: tab => { savePreferences({ lesson: { ...preferences.value.lesson, progressTab: tab } }); },
      onSourceChange: source => { savePreferences({ lesson: { ...preferences.value.lesson, progressSource: source } }); },
    });
    progressStale = false;
    progressView.setVisible(activeModule === 'progress');
    screens.set('progress', progressView);
  }

  /* ---------- «Настройки» ---------- */
  function requireWritable() {
    if (!phase.writable) throw new Error('Эта вкладка сейчас не может сохранить изменения.');
  }
  function currentCounts(): BackupCounts {
    return { history: historyEntries.length, exercises: userExercises.length, rhythm: confirmedRhythm.projects.length, drafts: drafts.all().length };
  }
  function settingsState(): SettingsState {
    return {
      theme: theme.getResolvedTheme(),
      playDefaults: toPlayDefaults(preferences.value.play),
      saveStatus,
      writer: writerLease && !writerLease.acquired ? 'other-tab' : 'owner',
      version: APP_VERSION,
      dataVersion: STUDY_SCHEMA_VERSION,
      counts: currentCounts(),
    };
  }
  function refreshSettings() {
    if (!settingsView || activeModule !== 'settings' || retiring) return;
    settingsView.update(settingsState());
  }
  /** Копия ждёт очередь записи; несохранённое в неё не попадает, и об этом сказано прямо. */
  async function exportBackup() {
    requireWritable();
    let incomplete = false;
    try { await flushAll(); } catch { incomplete = true; }
    requireWritable();
    incomplete ||= writes.failureCount > 0 || drafts.hasPendingChanges() || status.preferenceIssue !== '';
    downloadJson(await store.exportBackup(), 'bass-study-backup');
    if (incomplete) return { notice: 'Копия скачана, но в неё вошли только сохранённые данные. Повтори сохранение и скачай копию заново.' };
  }
  async function readBackupFile(file: File): Promise<BackupChoice> {
    if (file.size > MAX_BACKUP_BYTES) return { kind: 'error', reason: 'too-large', fileName: file.name, message: `Копия должна быть не больше ${MAX_BACKUP_BYTES / 1024 / 1024} МиБ.` };
    const json = await file.text();
    const fileVersion = backupVersion(json);
    if (fileVersion !== undefined && fileVersion !== STUDY_SCHEMA_VERSION) return { kind: 'error', reason: 'version', fileName: file.name, fileVersion };
    let candidate: PreparedStudyImport;
    try { candidate = store.prepareImport(json); }
    catch (failure) {
      if (failure instanceof StudyStorageError && failure.code === 'UNSUPPORTED_VERSION') return { kind: 'error', reason: 'version', fileName: file.name, fileVersion: fileVersion ?? null };
      return { kind: 'error', reason: 'invalid', fileName: file.name, message: message(failure) };
    }
    return {
      kind: 'preview', fileName: file.name, sizeBytes: file.size, createdAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      counts: { history: candidate.history, exercises: candidate.exercises, rhythm: candidate.rhythmProjects, drafts: candidate.snapshot.practiceDrafts.length },
      current: currentCounts(), payload: candidate,
    };
  }
  /** Окно выбора файла открывается синхронно в обработчике нажатия; предпросмотр ничего не меняет. */
  function chooseBackup(): Promise<BackupChoice> {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        readBackupFile(file).then(resolve, failure => resolve({ kind: 'error', reason: 'read', fileName: file.name, message: message(failure) }));
      }, { once: true });
      input.click();
    });
  }
  async function restoreBackup(candidate: PreparedStudyImport) {
    phase.beginRestore();
    let reload = false;
    try {
      audio.endAll('restore');
      sections.foundation?.finishSession('Занятие остановлено перед восстановлением');
      await flushAll();
      if (retiring) throw new Error('Страница закрывается; восстановление не начато.');
      if (writes.failureCount) throw new Error('Текущие изменения не сохранены. Повтори сохранение перед восстановлением.');
      const { snapshot } = await store.restorePrepared(candidate);
      phase.committedRestore();
      reload = true;
      if (retiring) return snapshot;
      writes.clearFailures();
      sessions.reset();
      drafts.reload(snapshot.practiceDrafts); practice.reset();
      applyRhythmLibrary(snapshot);
      applyStudyData(snapshot);
      profile = snapshot.profile; theme.setPreference(profile.theme, { notify: false }); if (persistent) theme.confirmPreference(profile.theme);
      applyPreferences(snapshot.preferences);
      reload = false;
      return snapshot;
    } catch (failure) {
      if (!reload) throw failure;
      console.error('Не удалось применить восстановленный снимок.', failure);
      const text = 'Данные восстановлены. Перезагрузи страницу, чтобы применить настройки.';
      status.showBanner(text, { retryTab: true });
      throw new Error(text, { cause: failure });
    } finally { phase.finishRestore(reload); }
  }
  if (available.includes('settings')) {
    settingsView = mountSettings(byId('settings-mount'), {
      state: settingsState(),
      onTheme: value => theme.setPreference(value),
      onPlayDefaults(next) {
        if (!savePreferences({ play: fromPlayDefaults(next) })) reportFailure('Умолчания занятия не сохранены: эта вкладка сейчас не может записывать.');
        refreshSettings();
      },
      onExport: exportBackup,
      onChooseBackup: chooseBackup,
      async onConfirmRestore(preview) {
        try { requireWritable(); await restoreBackup(preview.payload as PreparedStudyImport); }
        catch (failure) { return { error: message(failure) }; }
        finally { refreshSettings(); }
      },
      onRetrySave() { void retryWrites().catch(() => {}); },
      onRecheckWriter: () => location.reload(),
      onSectionChange(section) { settingsSection = section; updateInputVisibility(); },
    });
    sections.input = mountInput(settingsView.inputMount, {
      onPrefsChange: () => { if (sections.input) savePreferences({ input: sections.input.getPreferences() }); },
      onBeforeStart: () => audio.claim('input'),
    });
    sections.input.setVisible(false);
  }

  byId('retry-save').addEventListener('click', () => { void retryWrites().catch(() => {}); }, listen);
  byId('retry-tab').addEventListener('click', () => location.reload(), listen);
  const screens = new Map<AppSection, { setVisible(visible: boolean): void; dispose(): void | Promise<void> }>();
  if (sections.lesson) screens.set('lesson', sections.lesson);
  if (sections.foundation) screens.set('foundation', sections.foundation);
  if (sections.rhythm) screens.set('harmony', sections.rhythm);
  if (sections.studio) screens.set('tracks', sections.studio);
  if (settingsView) screens.set('settings', settingsView);
  mountProgressView();

  const shell = mountShell(appShell, { navigate: switchModule });

  async function initialize() {
    writerLease = await acquireWriterLease();
    if (retiring) { writerLease.release(); return; }
    if (!writerLease.acquired) {
      refreshSettings();
      status.showBanner('Занятие уже открыто в другой вкладке. Закрой её и нажми «Проверить снова».', { retryTab: true });
      return;
    }
    let snapshot;
    try {
      await store.open(); if (retiring) return;
      // Ask the browser not to evict the database under storage pressure; the answer does not change behaviour.
      void navigator.storage?.persist?.().catch(() => false);
      snapshot = await store.readSnapshot();
    }
    catch (failure) {
      if (retiring) return;
      await store.close().catch(() => {});
      if (retiring) return;
      store = createMemoryStudyStore();
      persistent = false;
      status.setStartupIssue(`Исходная база не сброшена: ${message(failure)}`);
      snapshot = await store.readSnapshot();
      console.warn('Локальная база не открылась; исходные данные не сброшены.', failure);
    }
    if (retiring) return;
    noteSkippedRecords();
    profile = snapshot.profile; theme.setPreference(profile.theme, { notify: false }); if (persistent) theme.confirmPreference(profile.theme);
    drafts.reload(snapshot.practiceDrafts); practice.reset();
    applyRhythmLibrary(snapshot);
    applyStudyData(snapshot);
    applyPreferences(snapshot.preferences);
    writes.clearFailures();
    if (retiring) return;
    phase.ready();
    showPersistenceStatus();
    // План нового дня сохраняется при первом показе «Занятия» после получения права записи.
    sections.lesson?.refresh();
    refreshSettings();
  }
  void initialize().catch(failure => {
    status.showBanner(`Не удалось подготовить страницу: ${message(failure)}`, { error: true });
  });
  function retire() {
    if (retirement) return retirement;
    main.inert = true;
    enableHeader(false);
    shell.dispose(); layout.dispose();
    const shouldCheckpoint = phase.phase !== 'reload' && phase.phase !== 'restoring';
    if (shouldCheckpoint) {
      audio.endAll('retire');
      drafts.bind(null);
    }
    retiring = true;
    phase.retire();
    lifetime.abort();
    // Синхронная часть dispose каждого экрана выполняется здесь; асинхронная (например, остановка аудиовхода) завершается до закрытия хранилища и освобождения права записи.
    const disposals = Promise.allSettled([...screens.values(), ...(sections.input ? [sections.input] : [])].map(screen => screen.dispose()));
    referencePanel.dispose();
    clearInterval(draftCheckpoint);
    retirement = (async () => {
      try { await retryingWrites; if (shouldCheckpoint) await flushAll(); else await writes.flush(); }
      finally {
        try { await disposals; await store.close(); }
        finally { drafts.dispose(); theme.dispose(); writerLease?.release(); }
      }
    })();
    return retirement;
  }
  window.addEventListener('pagehide', event => {
    if (event.persisted) window.addEventListener('pageshow', () => location.reload(), { once: true });
    void retire().catch(() => {});
  }, listen);
  const draftCheckpoint = setInterval(() => { if (!retiring && !main.inert) void drafts.flush().catch(() => {}); }, 5000);
  onPageVisibility(lifetime.signal, () => {
    if (!retiring) { audio.forget(); void drafts.flush().catch(() => {}); }
  });
  return { dispose: retire };
}
