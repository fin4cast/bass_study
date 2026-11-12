import { mountFoundation } from '../ui/foundation';
import { mountHistory } from '../ui/history';
import { mountEar } from '../ui/ear';
import { mountRhythm, type RhythmLibrary, type RhythmLibraryOperation } from '../ui/rhythm';
import { DEFAULT_RHYTHM_PREFERENCES } from '../rhythm/model';
import type { RhythmPracticeClock } from '../audio/rhythm';
import { mountStudio } from '../ui/studio';
import { mountInput } from '../ui/input';
import { mountRoute, type RouteStep } from '../ui/route';
import { createWriteQueue } from './write-queue';
import { createAudioOwner } from './audio-owner';
import { mountShell } from './shell';
import { APP_SECTIONS, renderPageHeader, renderPrimaryNavigation, type AppSection } from './page-frame';
import { createPageLayout } from './page-layout';
import { createPersistencePhase } from './persistence-phase';
import { createPreferences } from './preferences';
import { createSessionHistory } from './session-history';
import { createThemeController } from './theme';
import { createPracticeDrafts, type PracticeBinding } from './practice-drafts';
import { mountIntroduction } from '../ui/introduction';
import { createRouteMaterial, type RouteSession } from '../route';
import { acquireWriterLease } from './writer-lock';
import { createStudyStore, createMemoryStudyStore, exportRawDatabase, describeSkippedRecords, DEFAULT_PREFERENCES, DEFAULT_PROFILE, type AppPreferences, type HistoryCommit, type GlobalProfile, type PracticeDraft, type StudySnapshot } from '../storage';
import { rhythmPracticeLabel, type RhythmPracticeMaterial } from '../training/results';
export function mountApplication(app: HTMLElement, installed: readonly AppSection[] = APP_SECTIONS) {
  const available = installed.filter(id => id !== 'route' || (installed.includes('foundation') && installed.includes('ear')));
  const fallback = available.includes('foundation') ? 'foundation' : available[0];
  if (!fallback) throw new Error('Нужен хотя бы один раздел тренажёра.');
  const resolveSection = (id: AppSection) => available.includes(id) ? id : fallback;
  const lifetime = new AbortController();
  const listen = { signal: lifetime.signal };
  const genericPage = (section: AppSection, id: string, descriptionText: string) => `<section data-page-frame="${section}" class="page-frame-inset" hidden>${renderPageHeader(section, { descriptionText })}<div id="${id}"></div></section>`;
  const pageMarkup: Record<AppSection, string> = {
    foundation: '<div id="foundation-mount" data-page-frame="foundation" hidden></div>',
    ear: genericPage('ear', 'ear-mount', 'Сравни тонику и целевой звук, затем выбери ступень.'),
    harmony: '<section id="harmony-mount" data-page-frame="harmony" aria-label="Метроном и ритм" hidden></section>',
    tracks: '<section id="tracks-mount" data-page-frame="tracks" aria-label="Табулатура и ноты" hidden></section>',
    input: genericPage('input', 'input-mount', 'Проверь уровень и частоту сигнала.'),
    route: genericPage('route', 'route-mount', 'Гриф, слух и практика на одном музыкальном материале.'),
  };

  app.innerHTML = `
    <div class="app-shell" data-section="${fallback}" data-auxiliary="none">
      <header class="site-header">
        <a class="brand" href="#" aria-label="bass.study — к началу страницы"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>bass<span class="brand-dot">.</span>study</a>
        ${renderPrimaryNavigation(fallback, available)}
        <div class="nav-secondary">
          <button type="button" id="open-history" class="text-button" aria-expanded="false" disabled>Мои занятия</button>
          <button type="button" id="open-introduction" class="text-button" disabled>Введение</button>
        </div>
        <div class="sidebar-art" aria-hidden="true"><img src="${import.meta.env.BASE_URL}images/bass-headstock.webp" alt="" width="568" height="1788" draggable="false"></div>
        <div class="nav-bottom">
          <div class="theme-control"><span>Тема</span><div class="segmented" role="group" aria-label="Тема оформления"><button type="button" data-theme-choice="light" aria-pressed="false" disabled>Светлая</button><button type="button" data-theme-choice="dark" aria-pressed="false" disabled>Тёмная</button></div></div>
          <span class="local-badge"><span aria-hidden="true"></span><span id="local-save-status" role="status">Локальный тренажёр</span><button type="button" id="open-storage-details" class="text-button" aria-controls="persistence-banner" aria-expanded="false" hidden>Без сохранения · подробнее</button></span>
        </div>
      </header>

      <div class="app-content">
      <div id="persistence-banner" class="persistence-banner" role="status"><span id="persistence-message">Читаем локальные настройки…</span><button type="button" class="secondary-button button-compact" id="retry-save" hidden>Повторить сохранение</button><button type="button" class="secondary-button button-compact" id="retry-tab" hidden>Проверить снова</button></div>
      <main inert aria-busy="true">
        <section id="onboarding-mount" aria-label="Введение" hidden></section>

        <div id="route-session-mount"></div>
        ${available.map(id => pageMarkup[id]).join('')}
        <section id="history-mount" aria-label="История и настройки" hidden></section>
      </main>
      </div>
    </div>
  `;

  const byId = <T extends HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  let foundation: ReturnType<typeof mountFoundation> | undefined;
  let history: ReturnType<typeof mountHistory> | undefined;
  let ear: ReturnType<typeof mountEar> | undefined;
  let rhythm: ReturnType<typeof mountRhythm> | undefined;
  let studio: ReturnType<typeof mountStudio> | undefined;
  let inputMonitor: ReturnType<typeof mountInput> | undefined;
  let route: ReturnType<typeof mountRoute> | undefined;
  let introduction: ReturnType<typeof mountIntroduction> | undefined;
  let profile: GlobalProfile = DEFAULT_PROFILE;
  let bindingKey = '';
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
  let startupIssue = '';
  let preferenceIssue = '';
  let skippedIssue = '';
  let writeState: { pending: number; failures: readonly string[] } = { pending: 0, failures: [] };
  let getDraftPending = () => false;
  let draftStatusDirty = false;
  const main = app.querySelector<HTMLElement>('main')!;
  const appShell = app.querySelector<HTMLElement>('.app-shell')!;
  const layout = createPageLayout(appShell, app.querySelector<HTMLElement>('.app-content')!, byId('route-session-mount'));
  const phase = createPersistencePhase(() => Boolean(writerLease?.acquired), () => {
    main.inert = !phase.writable;
    main.setAttribute('aria-busy', String(main.inert));
    enableHeader(phase.writable);
    byId<HTMLButtonElement>('retry-save').disabled = !phase.exclusiveReady;
  });
  const audio = createAudioOwner({
    canStart(owner) {
      if (retiring || applyingPreferences || main.inert || document.hidden || !writerLease?.acquired) return false;
      switch (owner) {
        case 'sequence': return activeModule === 'foundation' && foundation?.mode === 'sequence' && foundation.rangeIsValid();
        case 'ear': return activeModule === 'ear';
        case 'rhythm': return activeModule === 'harmony';
        case 'tracks': return activeModule === 'tracks' && studio?.view === 'audio';
        case 'scores': return activeModule === 'tracks' && studio?.view === 'scores';
        case 'input': return activeModule === 'input';
        case 'introduction': return !byId('onboarding-mount').hidden;
      }
    },
    participants: {
      sequence: () => foundation?.stop(),
      ear: reason => reason === 'retire' ? ear?.stop('Страница закрывается') : ear?.pauseListening(reason === 'route' ? 'Активный таймер приостановлен.' : undefined),
      rhythm: reason => reason === 'owner' || reason === 'route' ? rhythm?.pause('audio-owner') : reason === 'section' ? rhythm?.pause('module') : rhythm?.stop(),
      tracks: () => studio?.stop('audio'),
      scores: () => studio?.stop('scores'),
      input: () => inputMonitor?.stop(),
      introduction: () => introduction?.stop(),
    },
    cancelScorePreparation: () => studio?.cancelScorePreparation(),
  });
  function showPersistenceStatus() {
    if (retiring || phase.phase === 'reload') return;
    const { pending, failures } = writeState;
    const dirty = getDraftPending(); draftStatusDirty = dirty;
    const message = failures.length ? `Не сохранено операций: ${failures.length}. ${failures[0]} Экспорт содержит только подтверждённые записи.` : preferenceIssue || skippedIssue || (pending ? 'Сохранение…' : dirty ? 'Черновик ожидает автосохранения…' : persistent ? 'Сохранено локально в этом браузере' : `Только в памяти страницы. Экспортируй копию перед закрытием. ${startupIssue}`);
    const error = failures.length > 0 || preferenceIssue !== '' || skippedIssue !== '';
    const memoryDetails = byId('open-storage-details');
    memoryDetails.hidden = persistent;
    byId('local-save-status').hidden = !persistent && !error;
    byId('persistence-message').textContent = message;
    byId('persistence-banner').classList.toggle('has-error', error);
    byId('persistence-banner').hidden = !error && (persistent || memoryDetails.getAttribute('aria-expanded') !== 'true');
    byId('local-save-status').textContent = error ? 'Ошибка сохранения' : pending ? 'Сохранение…' : dirty ? 'Черновик занятия' : persistent ? 'Локально · сохранено' : 'Только в памяти';
    byId('retry-save').hidden = failures.length === 0;
    history?.setSaveStatus(message, error ? 'error' : pending || dirty ? 'saving' : persistent ? 'saved' : 'memory');
  }
  const writes = createWriteQueue(value => { writeState = value; showPersistenceStatus(); });
  byId('open-storage-details').addEventListener('click', () => { const button = byId('open-storage-details'); button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true')); showPersistenceStatus(); }, listen);
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
  getDraftPending = () => drafts.hasPendingChanges();
  function rhythmPracticeBinding(practice: RhythmPracticeClock, readClock: PracticeBinding['readClock'] = () => practice): PracticeBinding {
    const material: RhythmPracticeMaterial = { kind: 'rhythm', playback: practice.playback };
    return { context: null, material, routeRef: null, label: rhythmPracticeLabel(material), readClock };
  }
  function syncPracticeBinding() {
    if (retiring || applyingPreferences) return;
    let next: PracticeBinding | null = null;
    let runtimeKey: string | undefined;
    if (activeModule === 'harmony') {
      const practice = rhythm?.getPractice();
      if (practice) {
        runtimeKey = practice.runtimeContextKey;
        next = rhythmPracticeBinding(practice, () => {
          const live = rhythm?.getPractice();
          return live?.runtimeContextKey === practice.runtimeContextKey ? live : practice;
        });
      }
    } else if (activeModule === 'foundation') {
      next = foundation?.practiceBinding() ?? null;
    }
    const key = runtimeKey ?? (next ? JSON.stringify({ context: next.context, material: next.material, routeRef: next.routeRef }) : '');
    if (key !== bindingKey) { drafts.bind(next); bindingKey = key; void drafts.flush().catch(() => {}); }
  }
  function draftView(value: PracticeDraft | null) {
    if (!value && activeModule === 'harmony') return { context: null, durationMs: 0, comfortableBpm: rhythm?.getPreferences().metronome.bpm ?? 92, note: '', label: 'Метроном и ритм', available: false };
    return value ? { id: value.id, createdAt: value.createdAt, timeZone: value.timeZone, context: value.context, material: value.material, routeRef: value.routeRef, durationMs: value.totalReferenceMs - value.recordedThroughMs, comfortableBpm: value.comfortableBpm, note: value.note,
      label: value.material.kind === 'rhythm' ? rhythmPracticeLabel(value.material) : value.material.kind === 'sequence' ? 'Последовательность на грифе' : 'Изучение грифа', available: true }
      : foundation?.getPracticeFallback() ?? { context: null, durationMs: 0, comfortableBpm: DEFAULT_PREFERENCES.player.bpm, note: '', label: 'Изучение грифа', available: false };
  }
  async function flushAll() { try { await drafts.flush(); } finally { await writes.flush(); } }
  function leaveRoute() { drafts.capture(); route?.stop(); foundation?.clearRouteContext(); ear?.clearRouteContext(); syncPracticeBinding(); }

  function applyRhythmLibrary(snapshot: StudySnapshot) {
    confirmedRhythm = { projects: snapshot.rhythmProjects, activeId: snapshot.activeRhythmProjectId };
    rhythm?.applyLibrary(confirmedRhythm);
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
    skippedIssue = describeSkippedRecords(store.skippedRecords());
    showPersistenceStatus();
  }

  function savePreferences(patch: Partial<AppPreferences>) {
    if (retiring || applyingPreferences || routeNavigation || !phase.writable) return;
    try {
      if (!preferences.update(patch) && !preferenceIssue) return;
      preferenceIssue = '';
      const generation = writes.supersede('preferences');
      const value = preferences.value;
      void writes.run(() => store.savePreferences(value), 'preferences', generation).catch(() => {});
    } catch (failure) {
      preferenceIssue = `Настройки ещё не сохранены: ${failure instanceof Error ? failure.message : String(failure)}`;
      showPersistenceStatus();
    }
  }

  const sessions = createSessionHistory({
    canPublish: () => !retiring && phase.phase !== 'reload',
    save: saveHistoryEntry,
    failure: message => history?.setSaveStatus(message, 'error'),
    finishScreen: () => foundation?.finishSession('Активный результат удаляется'),
    finishEar: () => ear?.finishCurrentSession('Активный результат удаляется'),
    finishRoute: id => { if (route?.getSession()?.id === id) route.stop(); },
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
    if (!routeNavigation) { route?.pause(); foundation?.clearRouteContext(); ear?.clearRouteContext(); }
    if (activeModule === 'foundation') { foundation?.finishSession('Занятие остановлено при смене раздела'); audio.end('sequence', 'section'); }
    if (activeModule === 'ear') ear?.finishCurrentSession('Слуховое занятие остановлено при смене раздела');
    audio.forget();
    activeModule = next;
    updateModuleVisibility();
    history?.updatePracticeContext();
    syncPracticeBinding();
    if (!routeNavigation) savePreferences({ activeModule: next });
  }

  function openRouteStep(step: RouteStep, session: RouteSession | null, initial: boolean) {
    if (!session) { drafts.capture(); foundation?.clearRouteContext(); ear?.clearRouteContext(); switchModule(step === 'ear' ? 'ear' : 'foundation'); if (step !== 'ear') foundation?.openRouteStep(step, null, null, false); syncPracticeBinding(); return; }
    const material = session.material ?? createRouteMaterial();
    drafts.capture();
    routeNavigation = true;
    try {
      foundation?.applyRouteMaterial(material);
      switchModule(step === 'ear' ? 'ear' : 'foundation');
      if (step === 'ear') ear?.startRouteContext(material, { routeId: session.id, step }, false);
      else foundation?.openRouteStep(step, session, material, initial);
    }
    finally { routeNavigation = false; }
    updateModuleVisibility(); syncPracticeBinding(); savePreferences({ ...foundation?.getPreferences(), activeModule });
    const heading = step === 'ear' ? ear?.routeFocus() : foundation?.routeFocus(step);
    if (heading) { heading.tabIndex = -1; layout.reveal(heading, 'start'); }
  }

  function applyPreferences(snapshot: AppPreferences, source: 'preset' | 'restore' = 'restore') {
    const value = preferences.hydrate(snapshot, source);
    drafts.capture();
    applyingPreferences = true;
    try {
      route?.stop(); foundation?.clearRouteContext(); ear?.clearRouteContext();
      preferenceIssue = '';
      foundation?.finishSession('Занятие остановлено перед применением настроек');
      ear?.finishCurrentSession('Слуховое занятие остановлено перед применением настроек');
      audio.endAll('settings');
      activeModule = resolveSection(value.activeModule);
      foundation?.applyPreferences(value);
      ear?.applyPreferences(value.ear);
      if (source !== 'preset' || value.rhythm) {
        rhythm?.applyPreferences(value.rhythm ?? DEFAULT_RHYTHM_PREFERENCES);
        if (source === 'preset' && rhythm) preferences.update({ rhythm: rhythm.getPreferences() });
      }
      studio?.applyPreferences(value);
      inputMonitor?.applyPreferences(value.input);
      updateModuleVisibility();
    } finally { applyingPreferences = false; syncPracticeBinding(); }
  }

  if (available.includes('foundation')) foundation = mountFoundation(byId('foundation-mount'), {
    getPlayerFallback: () => preferences.value.player,
    onPreferencesChange: value => savePreferences(value),
    onBeforeMaterialChange() { drafts.capture(); leaveRoute(); audio.end('introduction', 'section'); },
    onBeforeModeChange() { drafts.capture(); audio.end('introduction', 'section'); },
    onContextChange() { syncPracticeBinding(); history?.updatePracticeContext(); },
    onRouteExit: leaveRoute,
    capturePractice() { drafts.capture(); if (getDraftPending() !== draftStatusDirty) showPersistenceStatus(); },
    getRouteSession: () => route?.getSession(),
    onBeforeStart() { if (!audio.claim('sequence')) return false; syncPracticeBinding(); return true; },
    onPlaybackStopped() { void drafts.flush().catch(() => {}); },
    onSessionChanged: sessions.screen,
    onSessionFinished(session) { sessions.screen(session); sessions.closeQuiz('screen'); },
    getOuterBottomSpace: () => parseFloat(getComputedStyle(appShell).marginBottom),
    reveal: layout.reveal,
  });
  if (available.includes('ear')) ear = mountEar(byId('ear-mount'), {
    onPreferencesChange: () => { if (ear) savePreferences({ ear: ear.getPreferences() }); },
    onSessionChanged: sessions.ear,
    onSessionFinished() { sessions.closeQuiz('ear'); },
    onBeforeListen: () => audio.claim('ear'),
  });
  ear?.setVisible(false);
  if (available.includes('harmony')) rhythm = mountRhythm(byId('harmony-mount'), {
    onPreferencesChange: () => { if (rhythm) savePreferences({ rhythm: rhythm.getPreferences() }); },
    onLibraryChange: changeRhythmLibrary,
    onLibraryRetry: () => retryWrites('rhythm-library'),
    onBeforeStart: () => audio.claim('rhythm'),
    onPracticeEnd(practice) {
      drafts.captureClosed(rhythmPracticeBinding(practice));
      void drafts.flush().catch(() => {});
    },
    onPracticeChange: syncPracticeBinding,
  });
  rhythm?.setVisible(false);
  if (available.includes('tracks')) studio = mountStudio(byId('tracks-mount'), {
    observeHeight: layout.observeHeight,
    beforePlay: view => audio.claim(view === 'audio' ? 'tracks' : 'scores'),
    onLeaveView: view => audio.forget(view === 'audio' ? 'tracks' : 'scores'),
    onPreferencesChange: savePreferences,
  });
  if (available.includes('input')) inputMonitor = mountInput(byId('input-mount'), {
    onPrefsChange: () => { if (inputMonitor) savePreferences({ input: inputMonitor.getPreferences() }); },
    onBeforeStart: () => audio.claim('input'),
  });
  inputMonitor?.setVisible(false);
  if (available.includes('route')) route = mountRoute(byId('route-mount'), byId('route-session-mount'), {
    onBeforeStart() { drafts.capture(); foundation?.finishSession(); ear?.finishCurrentSession(); foundation?.clearRouteContext(); ear?.clearRouteContext(); },
    getFreeMaterial: () => foundation!.getFreeMaterial(),
    onGo: openRouteStep,
    onDismissBar: () => shell.focusActivePage(),
    onPause() { audio.endAll('route'); },
    onSessionChanged: sessions.route,
    onSessionFinished() { foundation?.clearRouteContext(); ear?.clearRouteContext(); syncPracticeBinding(); },
  });
  byId('open-introduction').hidden = !foundation;
  if (foundation) introduction = mountIntroduction(byId('onboarding-mount'), { onChoice(choice, completed) { setProfile({ ...profile, onboarding: { version: 1, choice, completed } }); },
    onMaterial() {
      drafts.capture(); leaveRoute(); switchModule('foundation');
      foundation?.finishSession(); foundation?.stop(); foundation?.introduction();
      savePreferences({ ...foundation?.getPreferences(), activeModule });
    },
    onPosition(id) { foundation?.selectPosition(id); },
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
      incomplete ||= writes.failureCount > 0 || drafts.hasPendingChanges() || preferenceIssue !== '';
      return { json: await store.exportBackup(), incomplete };
    },
    isPersistent: () => persistent,
    peekPracticeDraft: () => draftView(drafts.peek()),
    capturePracticeDraft: force => { syncPracticeBinding(); return draftView(drafts.current(force)); },
    getPracticeDrafts: () => drafts.all().map(value => draftView(value)),
    editPracticeDraft: (id, note, bpm) => draftView(drafts.edit(id, note, bpm)),
    savePracticeDraft: async (id, note, bpm) => { requireWritable(); await drafts.save(id, note, bpm); },
    deletePracticeDraft: async id => { requireWritable(); if (drafts.current()?.id === id) { foundation?.stop(); rhythm?.stop(); } drafts.capture(); await drafts.remove(id); },
    async deleteHistory(id) { requireWritable(); sessions.markDeleted(id); const generation = writes.supersede(`history:${id}`); await writes.run(() => store.deleteHistory(id), `history:${id}`, generation); },
    async deletePreset(id) { requireWritable(); const generation = writes.supersede(`preset:${id}`); await writes.run(() => store.deletePreset(id), `preset:${id}`, generation); },
    onRepeatErrors: foundation ? (ids, context) => {
      drafts.capture(); leaveRoute(); switchModule('foundation');
      foundation?.finishSession(); foundation?.stop(); foundation?.repeatErrors(ids, context);
      savePreferences({ ...foundation?.getPreferences(), activeModule });
    } : undefined,
    async restoreBackup(candidate, onCommitted) {
      phase.beginRestore();
      let reload = false;
      try {
        route?.stop();
        audio.endAll('restore');
        ear?.finishCurrentSession('Слуховое занятие остановлено перед восстановлением');
        foundation?.finishSession('Занятие остановлено перед восстановлением');
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
        drafts.reload(snapshot.practiceDrafts); bindingKey = '';
        applyRhythmLibrary(snapshot);
        profile = snapshot.profile; theme.setPreference(profile.theme, { notify: false }); if (persistent) theme.confirmPreference(profile.theme);
        applyPreferences(snapshot.preferences);
        reload = false;
        return snapshot;
      } catch (failure) {
        if (!reload) throw failure;
        console.error('Не удалось применить восстановленный снимок.', failure);
        const message = 'Данные восстановлены. Перезагрузи страницу, чтобы применить настройки.';
        showReload(message);
        throw new Error(message, { cause: failure });
      } finally { phase.finishRestore(reload); }
    },
  });
  function showReload(message: string) {
    byId('persistence-banner').hidden = false;
    byId('persistence-message').textContent = message;
    byId('retry-tab').hidden = false;
  }
  byId('retry-save').addEventListener('click', () => {
    void retryWrites().then(retried => { if (retried && phase.writable) return history?.refresh(); }).catch(() => {});
  }, listen);
  byId('retry-tab').addEventListener('click', () => location.reload(), listen);
  const screens = new Map<AppSection, { setVisible(visible: boolean): void; dispose(): void }>();
  if (foundation) screens.set('foundation', foundation);
  if (ear) screens.set('ear', ear);
  if (rhythm) screens.set('harmony', rhythm);
  if (studio) screens.set('tracks', studio);
  if (inputMonitor) screens.set('input', inputMonitor);

  const shell = mountShell(appShell, {
    reveal: layout.reveal,
    history: byId('history-mount'), introduction: byId('onboarding-mount'),
    openIntroduction: () => introduction?.open(),
    stopIntroduction: () => audio.end('introduction', 'section'),
    navigate: switchModule,
  });

  async function initialize() {
    writerLease = await acquireWriterLease();
    if (retiring) { writerLease.release(); return; }
    if (!writerLease.acquired) {
      byId('persistence-banner').hidden = false;
      byId('persistence-message').textContent = 'Занятие уже открыто в другой вкладке. Закрой её и нажми «Проверить снова».';
      byId('retry-tab').hidden = false;
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
      startupIssue = `Исходная база не сброшена: ${failure instanceof Error ? failure.message : String(failure)}`;
      snapshot = await store.readSnapshot();
      console.warn('Локальная база не открылась; исходные данные не сброшены.', failure);
    }
    if (retiring) return;
    noteSkippedRecords();
    profile = snapshot.profile; theme.setPreference(profile.theme, { notify: false }); if (persistent) theme.confirmPreference(profile.theme);
    drafts.reload(snapshot.practiceDrafts); bindingKey = '';
    applyRhythmLibrary(snapshot);
    applyPreferences(snapshot.preferences);
    writes.clearFailures();
    await history?.refresh();
    if (retiring) return;
    phase.ready();
    // Start with the practice screen; introduction is an explicit navigation action.
  }
  void initialize().catch(failure => {
    byId('persistence-banner').hidden = false;
    byId('persistence-message').textContent = `Не удалось подготовить страницу: ${failure instanceof Error ? failure.message : String(failure)}`;
    byId('persistence-banner').classList.add('has-error');
  });
  function retire() {
    if (retirement) return retirement;
    main.inert = true;
    enableHeader(false);
    shell.dispose(); layout.dispose();
    const shouldCheckpoint = phase.phase !== 'reload' && phase.phase !== 'restoring';
    if (shouldCheckpoint) {
      route?.stop();
      audio.endAll('retire');
      drafts.bind(null);
    }
    retiring = true;
    phase.retire();
    lifetime.abort();
    for (const screen of screens.values()) screen.dispose();
    route?.dispose(); introduction?.dispose(); history?.dispose();
    clearInterval(draftCheckpoint);
    retirement = (async () => {
      try { await retryingWrites; if (shouldCheckpoint) await flushAll(); else await writes.flush(); }
      finally {
        try { await store.close(); }
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !retiring) { audio.forget(); void drafts.flush().catch(() => {}); }
  }, listen);
  return { dispose: retire };
}
