import { mountFoundation } from '../ui/foundation';
import { mountHistory } from '../ui/history';
import { mountEar } from '../ui/ear';
import { mountRhythm, type RhythmLibrary, type RhythmLibraryOperation } from '../ui/rhythm';
import { DEFAULT_RHYTHM_PREFERENCES } from '../rhythm/model';
import { mountStudio } from '../ui/studio';
import { mountInput } from '../ui/input';
import { mountRoute, type RouteStep } from '../ui/route';
import { mountIntroduction } from '../ui/introduction';
import { onPageVisibility } from '../ui/page-visibility';
import { createRouteMaterial, type RouteSession } from '../route';
import { createStudyStore, createMemoryStudyStore, exportRawDatabase, describeSkippedRecords, DEFAULT_PROFILE, type AppPreferences, type HistoryCommit, type GlobalProfile, type StudySnapshot } from '../storage';
import { renderAppShell } from './app-shell';
import { createWriteQueue } from './write-queue';
import { mountShell } from './shell';
import { APP_SECTIONS, type AppSection } from './page-frame';
import { createPageLayout } from './page-layout';
import { createPersistencePhase } from './persistence-phase';
import { createPersistenceStatus } from './persistence-status';
import { createPreferences } from './preferences';
import { createSessionHistory } from './session-history';
import { createThemeController } from './theme';
import { createPracticeDrafts } from './practice-drafts';
import { createPracticeContext, rhythmPracticeBinding } from './practice-context';
import { createSectionAudio, type AppSections } from './sections';
import { acquireWriterLease } from './writer-lock';

/**
 * Координатор: право записи и хранилище, применение настроек, навигация между разделами и связь разделов
 * с очередью записи, черновиками и историей. Разметка оболочки — `app-shell.ts`, статус сохранения —
 * `persistence-status.ts`, привязка черновика к часам — `practice-context.ts`, звук разделов — `sections.ts`.
 */
export function mountApplication(app: HTMLElement, installed: readonly AppSection[] = APP_SECTIONS) {
  const available = installed.filter(id => id !== 'route' || (installed.includes('foundation') && installed.includes('ear')));
  const fallback = available.includes('foundation') ? 'foundation' : available[0];
  if (!fallback) throw new Error('Нужен хотя бы один раздел тренажёра.');
  const resolveSection = (id: AppSection) => available.includes(id) ? id : fallback;
  const lifetime = new AbortController();
  const listen = { signal: lifetime.signal };
  app.innerHTML = renderAppShell(fallback, available);

  const byId = <T extends HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  const sections: AppSections = {};
  let history: ReturnType<typeof mountHistory> | undefined;
  let profile: GlobalProfile = DEFAULT_PROFILE;
  let activeModule = fallback;
  let routeNavigation = false;
  const preferences = createPreferences();
  let confirmedRhythm: RhythmLibrary = { projects: [], activeId: null };
  let store: ReturnType<typeof createStudyStore> | ReturnType<typeof createMemoryStudyStore> = createStudyStore();
  let persistent = true;
  let applyingPreferences = true;
  let retiring = false;
  let retirement: Promise<void> | undefined;
  let retryingWrites: Promise<boolean> | undefined;
  let writerLease: Awaited<ReturnType<typeof acquireWriterLease>> | undefined;
  const main = app.querySelector<HTMLElement>('main')!;
  const appShell = app.querySelector<HTMLElement>('.app-shell')!;
  const layout = createPageLayout(appShell, app.querySelector<HTMLElement>('.app-content')!, byId('route-session-mount'));
  const phase = createPersistencePhase(() => Boolean(writerLease?.acquired), () => {
    main.inert = !phase.writable;
    main.setAttribute('aria-busy', String(main.inert));
    enableHeader(phase.writable);
    byId<HTMLButtonElement>('retry-save').disabled = !phase.exclusiveReady;
  });
  const audio = createSectionAudio(sections, {
    canStartAny: () => !retiring && !applyingPreferences && !main.inert && !document.hidden && Boolean(writerLease?.acquired),
    activeModule: () => activeModule,
    introductionOpen: () => !byId('onboarding-mount').hidden,
  });
  const status = createPersistenceStatus(app, {
    isSuspended: () => retiring || phase.phase === 'reload',
    isPersistent: () => persistent,
    hasDraftChanges: () => drafts.hasPendingChanges(),
    publish: (message, kind) => history?.setSaveStatus(message, kind),
  });
  const showPersistenceStatus = status.show;
  const writes = createWriteQueue(value => status.setWriteState(value));
  byId('open-storage-details').addEventListener('click', status.toggleDetails, listen);
  const theme = createThemeController({ onChange(value) { setProfile({ ...profile, theme: value }); } });
  function setProfile(value: GlobalProfile) {
    if (retiring || !writerLease?.acquired || main.inert || applyingPreferences) return;
    profile = structuredClone(value);
    const confirmed = structuredClone(value);
    void writes.run(() => store.saveProfile(confirmed), 'profile', writes.supersede('profile'), () => {
      if (persistent) theme.confirmPreference(confirmed.theme);
    }).catch(() => {});
  }
  function enableHeader(enabled: boolean) { appShell.querySelectorAll<HTMLButtonElement>('.site-header button').forEach(button => { button.disabled = !enabled; }); }
  appShell.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(button => button.addEventListener('click', () => { const value = button.dataset.themeChoice; if (value === 'light' || value === 'dark') theme.setPreference(value); }, listen));
  const drafts = createPracticeDrafts({ getStore: () => store, write: (operation, key) => writes.run(operation, key), supersede: key => writes.supersede(key), resolveSuperseded: key => writes.resolveSuperseded(key),
    onCommit() { history?.updatePracticeContext(); showPersistenceStatus(); }, onEntry(entry, linkedRoute) { publishHistoryCommit({ entry, linkedRoute }); },
    onChange() { history?.updatePracticeContext(); showPersistenceStatus(); },
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
  function leaveRoute() { drafts.capture(); sections.route?.stop(); sections.foundation?.clearRouteContext(); sections.ear?.clearRouteContext(); syncPracticeBinding(); }

  function applyRhythmLibrary(snapshot: StudySnapshot) {
    confirmedRhythm = { projects: snapshot.rhythmProjects, activeId: snapshot.activeRhythmProjectId };
    sections.rhythm?.applyLibrary(confirmedRhythm);
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
      void history?.refresh();
    });
  }

  function retryWrites(key?: string) {
    if (!phase.exclusiveReady) return Promise.resolve(false);
    retryingWrites = phase.retry(() => writes.retry(key));
    return retryingWrites;
  }

  function publishHistoryCommit(commit: HistoryCommit) {
    if (retiring) return;
    history?.commitEntry(commit.entry);
    if (commit.linkedRoute) history?.commitEntry(commit.linkedRoute);
  }

  function saveHistoryEntry(entry: HistoryCommit['entry']) {
    const snapshotGeneration = phase.generation;
    const key = `history:${entry.id}`;
    void writes.run(() => store.addHistory(entry), key, writes.supersede(key), commit => {
      if (snapshotGeneration === phase.generation) publishHistoryCommit(commit);
    }).catch(() => {});
  }

  function getPreferences() { return preferences.value; }

  function noteSkippedRecords() {
    status.setSkippedIssue(describeSkippedRecords(store.skippedRecords()));
  }

  function savePreferences(patch: Partial<AppPreferences>) {
    if (retiring || applyingPreferences || routeNavigation || !phase.writable) return;
    try {
      if (!preferences.update(patch) && !status.preferenceIssue) return;
      status.setPreferenceIssue('');
      const generation = writes.supersede('preferences');
      const value = preferences.value;
      void writes.run(() => store.savePreferences(value), 'preferences', generation).catch(() => {});
    } catch (failure) {
      status.setPreferenceIssue(`Настройки ещё не сохранены: ${failure instanceof Error ? failure.message : String(failure)}`);
      showPersistenceStatus();
    }
  }

  const sessions = createSessionHistory({
    canPublish: () => !retiring && phase.phase !== 'reload',
    save: saveHistoryEntry,
    failure: message => history?.setSaveStatus(message, 'error'),
    finishScreen: () => sections.foundation?.finishSession('Активный результат удаляется'),
    finishEar: () => sections.ear?.finishCurrentSession('Активный результат удаляется'),
    finishRoute: id => { if (sections.route?.getSession()?.id === id) sections.route.stop(); },
  });

  function updateModuleVisibility() {
    shell.setActivePage(activeModule);
    for (const [id, screen] of screens) screen.setVisible(id === activeModule);
  }

  function switchModule(next: AppPreferences['activeModule']) {
    if (!available.includes(next)) return;
    if (next === activeModule) {
      if (!routeNavigation) savePreferences({ activeModule: next });
      return;
    }
    drafts.capture(); audio.end('introduction', 'section');
    if (!routeNavigation) { sections.route?.pause(); sections.foundation?.clearRouteContext(); sections.ear?.clearRouteContext(); }
    if (activeModule === 'foundation') { sections.foundation?.finishSession('Занятие остановлено при смене раздела'); audio.end('sequence', 'section'); }
    if (activeModule === 'ear') sections.ear?.finishCurrentSession('Слуховое занятие остановлено при смене раздела');
    audio.forget();
    activeModule = next;
    updateModuleVisibility();
    history?.updatePracticeContext();
    syncPracticeBinding();
    if (!routeNavigation) savePreferences({ activeModule: next });
  }

  function openRouteStep(step: RouteStep, session: RouteSession | null, initial: boolean) {
    if (!session) { drafts.capture(); sections.foundation?.clearRouteContext(); sections.ear?.clearRouteContext(); switchModule(step === 'ear' ? 'ear' : 'foundation'); if (step !== 'ear') sections.foundation?.openRouteStep(step, null, null, false); syncPracticeBinding(); return; }
    const material = session.material ?? createRouteMaterial();
    drafts.capture();
    routeNavigation = true;
    try {
      sections.foundation?.applyRouteMaterial(material);
      switchModule(step === 'ear' ? 'ear' : 'foundation');
      if (step === 'ear') sections.ear?.startRouteContext(material, { routeId: session.id, step }, false);
      else sections.foundation?.openRouteStep(step, session, material, initial);
    }
    finally { routeNavigation = false; }
    updateModuleVisibility(); syncPracticeBinding(); savePreferences({ ...sections.foundation?.getPreferences(), activeModule });
    const heading = step === 'ear' ? sections.ear?.routeFocus() : sections.foundation?.routeFocus(step);
    if (heading) { heading.tabIndex = -1; layout.reveal(heading, 'start'); }
  }

  function applyPreferences(snapshot: AppPreferences, source: 'preset' | 'restore' = 'restore') {
    const value = preferences.hydrate(snapshot, source);
    drafts.capture();
    applyingPreferences = true;
    try {
      sections.route?.stop(); sections.foundation?.clearRouteContext(); sections.ear?.clearRouteContext();
      status.setPreferenceIssue('');
      sections.foundation?.finishSession('Занятие остановлено перед применением настроек');
      sections.ear?.finishCurrentSession('Слуховое занятие остановлено перед применением настроек');
      audio.endAll('settings');
      activeModule = resolveSection(value.activeModule);
      sections.foundation?.applyPreferences(value);
      sections.ear?.applyPreferences(value.ear);
      if (source !== 'preset' || value.rhythm) {
        sections.rhythm?.applyPreferences(value.rhythm ?? DEFAULT_RHYTHM_PREFERENCES);
        if (source === 'preset' && sections.rhythm) preferences.update({ rhythm: sections.rhythm.getPreferences() });
      }
      sections.studio?.applyPreferences(value);
      sections.input?.applyPreferences(value.input);
      updateModuleVisibility();
    } finally { applyingPreferences = false; syncPracticeBinding(); }
  }

  if (available.includes('foundation')) sections.foundation = mountFoundation(byId('foundation-mount'), {
    getPlayerFallback: () => preferences.value.player,
    onPreferencesChange: value => savePreferences(value),
    onBeforeMaterialChange() { drafts.capture(); leaveRoute(); audio.end('introduction', 'section'); },
    onBeforeModeChange() { drafts.capture(); audio.end('introduction', 'section'); },
    onContextChange() { syncPracticeBinding(); history?.updatePracticeContext(); },
    onRouteExit: leaveRoute,
    capturePractice() { drafts.capture(); status.showIfDraftChanged(); },
    getRouteSession: () => sections.route?.getSession(),
    onBeforeStart() { if (!audio.claim('sequence')) return false; syncPracticeBinding(); return true; },
    onPlaybackStopped() { void drafts.flush().catch(() => {}); },
    onSessionChanged: sessions.screen,
    onSessionFinished(session) { sessions.screen(session); sessions.closeQuiz('screen'); },
    getOuterBottomSpace: () => parseFloat(getComputedStyle(appShell).marginBottom),
    reveal: layout.reveal,
  });
  if (available.includes('ear')) sections.ear = mountEar(byId('ear-mount'), {
    onPreferencesChange: () => { if (sections.ear) savePreferences({ ear: sections.ear.getPreferences() }); },
    onSessionChanged: sessions.ear,
    onSessionFinished() { sessions.closeQuiz('ear'); },
    onBeforeListen: () => audio.claim('ear'),
  });
  sections.ear?.setVisible(false);
  if (available.includes('harmony')) sections.rhythm = mountRhythm(byId('harmony-mount'), {
    onPreferencesChange: () => { if (sections.rhythm) savePreferences({ rhythm: sections.rhythm.getPreferences() }); },
    onLibraryChange: changeRhythmLibrary,
    onLibraryRetry: () => retryWrites('rhythm-library'),
    onBeforeStart: () => audio.claim('rhythm'),
    onPracticeEnd(practice) {
      drafts.captureClosed(rhythmPracticeBinding(practice));
      void drafts.flush().catch(() => {});
    },
    onPracticeChange: syncPracticeBinding,
  });
  sections.rhythm?.setVisible(false);
  if (available.includes('tracks')) sections.studio = mountStudio(byId('tracks-mount'), {
    observeHeight: layout.observeHeight,
    beforePlay: view => audio.claim(view === 'audio' ? 'tracks' : 'scores'),
    onLeaveView: view => audio.forget(view === 'audio' ? 'tracks' : 'scores'),
    onPreferencesChange: savePreferences,
  });
  if (available.includes('input')) sections.input = mountInput(byId('input-mount'), {
    onPrefsChange: () => { if (sections.input) savePreferences({ input: sections.input.getPreferences() }); },
    onBeforeStart: () => audio.claim('input'),
  });
  sections.input?.setVisible(false);
  if (available.includes('route')) sections.route = mountRoute(byId('route-mount'), byId('route-session-mount'), {
    onBeforeStart() { drafts.capture(); sections.foundation?.finishSession(); sections.ear?.finishCurrentSession(); sections.foundation?.clearRouteContext(); sections.ear?.clearRouteContext(); },
    getFreeMaterial: () => sections.foundation!.getFreeMaterial(),
    onGo: openRouteStep,
    onDismissBar: () => shell.focusActivePage(),
    onPause() { audio.endAll('route'); },
    onSessionChanged: sessions.route,
    onSessionFinished() { sections.foundation?.clearRouteContext(); sections.ear?.clearRouteContext(); syncPracticeBinding(); },
  });
  byId('open-introduction').hidden = !sections.foundation;
  if (sections.foundation) sections.introduction = mountIntroduction(byId('onboarding-mount'), { onChoice(choice, completed) { setProfile({ ...profile, onboarding: { version: 1, choice, completed } }); },
    onMaterial() {
      drafts.capture(); leaveRoute(); switchModule('foundation');
      sections.foundation?.finishSession(); sections.foundation?.stop(); sections.foundation?.introduction();
      savePreferences({ ...sections.foundation?.getPreferences(), activeModule });
    },
    onPosition(id) { sections.foundation?.selectPosition(id); },
    onBeforeListen: () => audio.claim('introduction'),
    onClose() { audio.forget('introduction'); shell.syncAuxiliary(); },
  });
  function requireWritable() {
    if (!phase.writable) throw new Error('Эта вкладка сейчас не может сохранить изменения.');
  }
  history = mountHistory(byId('history-mount'), {
    readConfirmed: options => {
      if (retiring) throw new Error('Страница закрывается.');
      return store.readSnapshot(options).then(snapshot => { noteSkippedRecords(); return snapshot; });
    },
    exportRaw: () => exportRawDatabase(),
    getSkippedRecords: () => store.skippedRecords(),
    prepareImport: value => store.prepareImport(value),
    async savePreset(value) { requireWritable(); await writes.run(() => store.savePreset(value), `preset:${value.id}`); },
    async saveManual(value) { requireWritable(); await writes.run(() => store.addHistory(value), `history:${value.id}`, undefined, publishHistoryCommit); },
    getPreferences,
    reveal: layout.reveal,
    applyPreferences: async (value, source) => {
      requireWritable();
      await flushAll();
      requireWritable();
      applyPreferences(value, source);
      const next = getPreferences();
      await writes.run(() => store.savePreferences(next), 'preferences', writes.supersede('preferences'));
    },
    waitForWrites: writes.flush,
    async exportConfirmed() {
      requireWritable();
      let incomplete = false;
      try { await flushAll(); } catch { incomplete = true; }
      requireWritable();
      incomplete ||= writes.failureCount > 0 || drafts.hasPendingChanges() || status.preferenceIssue !== '';
      return { json: await store.exportBackup(), incomplete };
    },
    isPersistent: () => persistent,
    peekPracticeDraft: () => practice.view(drafts.peek()),
    capturePracticeDraft: force => { syncPracticeBinding(); return practice.view(drafts.current(force)); },
    getPracticeDrafts: () => drafts.all().map(value => practice.view(value)),
    editPracticeDraft: (id, note, bpm) => practice.view(drafts.edit(id, note, bpm)),
    savePracticeDraft: async (id, note, bpm) => { requireWritable(); await drafts.save(id, note, bpm); },
    deletePracticeDraft: async id => { requireWritable(); if (drafts.current()?.id === id) { sections.foundation?.stop(); sections.rhythm?.stop(); } drafts.capture(); await drafts.remove(id); },
    async deleteHistory(id) { requireWritable(); sessions.markDeleted(id); const generation = writes.supersede(`history:${id}`); await writes.run(() => store.deleteHistory(id), `history:${id}`, generation); },
    async deletePreset(id) { requireWritable(); const generation = writes.supersede(`preset:${id}`); await writes.run(() => store.deletePreset(id), `preset:${id}`, generation); },
    onRepeatErrors: sections.foundation ? (ids, context) => {
      drafts.capture(); leaveRoute(); switchModule('foundation');
      sections.foundation?.finishSession(); sections.foundation?.stop(); sections.foundation?.repeatErrors(ids, context);
      savePreferences({ ...sections.foundation?.getPreferences(), activeModule });
    } : undefined,
    async restoreBackup(candidate, onCommitted) {
      phase.beginRestore();
      let reload = false;
      try {
        sections.route?.stop();
        audio.endAll('restore');
        sections.ear?.finishCurrentSession('Слуховое занятие остановлено перед восстановлением');
        sections.foundation?.finishSession('Занятие остановлено перед восстановлением');
        await flushAll();
        if (retiring) throw new Error('Страница закрывается; восстановление не начато.');
        if (writes.failureCount) throw new Error('Текущие изменения не сохранены. Повтори сохранение перед восстановлением.');
        const { snapshot } = await store.restorePrepared(candidate);
        phase.committedRestore();
        reload = true;
        onCommitted();
        if (retiring) return snapshot;
        writes.clearFailures();
        sessions.reset();
        drafts.reload(snapshot.practiceDrafts); practice.reset();
        applyRhythmLibrary(snapshot);
        profile = snapshot.profile; theme.setPreference(profile.theme, { notify: false }); if (persistent) theme.confirmPreference(profile.theme);
        applyPreferences(snapshot.preferences);
        reload = false;
        return snapshot;
      } catch (failure) {
        if (!reload) throw failure;
        console.error('Не удалось применить восстановленный снимок.', failure);
        const message = 'Данные восстановлены. Перезагрузи страницу, чтобы применить настройки.';
        status.showBanner(message, { retryTab: true });
        throw new Error(message, { cause: failure });
      } finally { phase.finishRestore(reload); }
    },
  });
  byId('retry-save').addEventListener('click', () => {
    void retryWrites().then(retried => { if (retried && phase.writable) return history?.refresh(); }).catch(() => {});
  }, listen);
  byId('retry-tab').addEventListener('click', () => location.reload(), listen);
  const screens = new Map<AppSection, { setVisible(visible: boolean): void; dispose(): void | Promise<void> }>();
  if (sections.foundation) screens.set('foundation', sections.foundation);
  if (sections.ear) screens.set('ear', sections.ear);
  if (sections.rhythm) screens.set('harmony', sections.rhythm);
  if (sections.studio) screens.set('tracks', sections.studio);
  if (sections.input) screens.set('input', sections.input);

  const shell = mountShell(appShell, {
    reveal: layout.reveal,
    history: byId('history-mount'), introduction: byId('onboarding-mount'),
    openIntroduction: () => sections.introduction?.open(),
    stopIntroduction: () => audio.end('introduction', 'section'),
    navigate: switchModule,
  });

  async function initialize() {
    writerLease = await acquireWriterLease();
    if (retiring) { writerLease.release(); return; }
    if (!writerLease.acquired) {
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
      status.setStartupIssue(`Исходная база не сброшена: ${failure instanceof Error ? failure.message : String(failure)}`);
      snapshot = await store.readSnapshot();
      console.warn('Локальная база не открылась; исходные данные не сброшены.', failure);
    }
    if (retiring) return;
    noteSkippedRecords();
    profile = snapshot.profile; theme.setPreference(profile.theme, { notify: false }); if (persistent) theme.confirmPreference(profile.theme);
    drafts.reload(snapshot.practiceDrafts); practice.reset();
    applyRhythmLibrary(snapshot);
    applyPreferences(snapshot.preferences);
    writes.clearFailures();
    await history?.refresh();
    if (retiring) return;
    phase.ready();
    // Start with the practice screen; introduction is an explicit navigation action.
  }
  void initialize().catch(failure => {
    status.showBanner(`Не удалось подготовить страницу: ${failure instanceof Error ? failure.message : String(failure)}`, { error: true });
  });
  function retire() {
    if (retirement) return retirement;
    main.inert = true;
    enableHeader(false);
    shell.dispose(); layout.dispose();
    const shouldCheckpoint = phase.phase !== 'reload' && phase.phase !== 'restoring';
    if (shouldCheckpoint) {
      sections.route?.stop();
      audio.endAll('retire');
      drafts.bind(null);
    }
    retiring = true;
    phase.retire();
    lifetime.abort();
    // Синхронная часть dispose каждого экрана выполняется здесь; асинхронная (например, остановка аудиовхода) завершается до закрытия хранилища и освобождения права записи.
    const disposals = Promise.allSettled([...screens.values()].map(screen => screen.dispose()));
    sections.route?.dispose(); sections.introduction?.dispose(); history?.dispose();
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
