import { createStructure, getPositions, annotatePositions } from '../../src/music';
import { startQuiz, submitAnswer, nextQuestion, type QuizMode } from '../../src/training';
import { createStudyStore, emptySnapshot, makeScreenHistory, validateSnapshot, parseBackup, MAX_BACKUP_BYTES, type StudySnapshot } from '../../src/storage';
import { mountHistory } from '../../src/ui/history';

const params = new URL(location.href).searchParams;
const mode = params.get('afterFix') === 'true' ? 'production64MiBAfterFix' : params.get('candidate') === 'true' ? 'candidate64MiBCompactExport' : 'baseline10MiBPrettyExport';
const samples: Array<{ name: string; durationMs: number; maxHeartbeatDelayMs: number; longTasks: number; longestTaskMs: number }> = [];
const tasks: PerformanceEntry[] = [];
const observer = new PerformanceObserver(list => tasks.push(...list.getEntries()));
if (PerformanceObserver.supportedEntryTypes.includes('longtask')) observer.observe({ entryTypes: ['longtask'] });
async function measure<T>(name: string, action: () => T | Promise<T>): Promise<T> {
  let last = performance.now(); let maxDelay = 0;
  const interval = setInterval(() => { const now = performance.now(); maxDelay = Math.max(maxDelay, now - last - 16); last = now; }, 16);
  const started = performance.now();
  try {
    const result = await action();
    const ended = performance.now();
    await new Promise(resolve => setTimeout(resolve, 20));
    const matching = tasks.filter(task => task.startTime < ended && task.startTime + task.duration > started);
    samples.push({ name, durationMs: ended - started, maxHeartbeatDelayMs: maxDelay, longTasks: matching.length, longestTaskMs: Math.max(0, ...matching.map(task => task.duration)) });
    return result;
  } finally { clearInterval(interval); }
}
const structure = createStructure('A', 'minor-pentatonic');
const positions = annotatePositions(getPositions({ strings: ['E', 'A', 'D', 'G'], fretMin: 0, fretMax: 12 }), structure);
const modes: QuizMode[] = ['name-note', 'find-note', 'find-degree', 'find-pitch', 'find-interval'];
function generate(): StudySnapshot {
  const history = [];
  for (let index = 0; index < 1460; index++) {
    let session = startQuiz({ positions, structure, mode: modes[index % modes.length], seed: index + 1, intervalDegree: '#4' }, 20);
    for (let q = 0; q < 20; q++) {
      const question = session.currentQuestion;
      const wrong = question.mode === 'name-note' ? (question.target.pitchClass + 1) % 12 : positions.find(position => !question.expectedPositionIds.includes(position.id))!.id;
      session = submitAnswer(session, wrong, 450);
      session = submitAnswer(session, question.mode === 'name-note' ? question.target.pitchClass : question.expectedPositionIds[0], 900);
      session = nextQuestion(session);
    }
    const entry = makeScreenHistory(session, { id: `synthetic-year-${String(index).padStart(4, '0')}`,
      occurredAt: new Date(Date.UTC(2025, 10, 9, 9) + index * 6 * 3600000).toISOString(), timeZone: 'Europe/Moscow' });
    if (!entry) throw new Error('Synthetic session unexpectedly empty.');
    history.push(entry);
  }
  return { ...emptySnapshot(), history };
}

async function run() {
  const snapshot = await measure('generate-valid-screen-sessions', generate);
  const validated = await measure('validateSnapshot-full-year', () => validateSnapshot(snapshot));
  const compact = await measure('stringify-compact', () => JSON.stringify(validated));
  const pretty = await measure('stringify-pretty', () => JSON.stringify(validated, null, 2));
  const sizes = { compactBytes: new TextEncoder().encode(compact).byteLength, prettyBytes: new TextEncoder().encode(pretty).byteLength };
  const checks: Record<string, unknown> = { mode, synthetic: true, sessions: validated.history.length, questions: validated.history.reduce((sum, entry) => sum + (entry.result.kind === 'screen' ? entry.result.questions.length : 0), 0), attemptsPerQuestion: 2, positionsPerSession: 52, maxBackupBytes: MAX_BACKUP_BYTES, sizes };
  const store = createStudyStore();
  await store.open();
  if (mode.startsWith('baseline')) {
    let rejected = false;
    try { parseBackup(compact); }
    catch (error) { rejected = true; checks.currentCapRejection = error instanceof Error ? error.message : String(error); checks.currentCapErrorCode = error && typeof error === 'object' && 'code' in error ? error.code : null; }
    if (!rejected) throw new Error('The baseline unexpectedly accepted a >10MiB copy.');
    checks.currentCapPreservedEmptyDatabase = (await store.readSnapshot()).history.length === 0;
  } else {
    const preview = await measure('previewImport-parse-and-validate', () => store.previewImport(compact));
    checks.previewCount = preview.history;
    const restore = await measure('restore-production-api-parse-validate-atomic-IDB', () => store.restore(compact, { confirmed: true }));
    checks.restore = restore;
    checks.restoreTransaction = store.getLastTransaction();
    const read = await measure('readSnapshot-native-IDB-and-full-validation', () => store.readSnapshot({ fresh: true }));
    if (params.get('afterFix') === 'true') {
      checks.cacheReadIdentity = await measure('readSnapshot-cached-identity', () => store.readSnapshot()) === read;
      try { await store.restore(JSON.stringify(emptySnapshot()), { confirmed: true, failAfterWrite: 1 }); }
      catch (error) { checks.failedRestoreErrorCode = error && typeof error === 'object' && 'code' in error ? error.code : null; }
      checks.failedRestoreCacheUnchanged = await store.readSnapshot() === read;
    }
    checks.restoredHistoryCount = read.history.length;
    checks.firstQuestion = read.history[0]?.result.kind === 'screen' ? read.history[0].result.questions[0] : null;
    checks.lastId = read.history.at(-1)?.id;
    const exported = await measure(params.get('afterFix') === 'true' ? 'exportBackup-production-api-cached-read-stringify' : 'exportBackup-production-api-full-read-validation-stringify', () => store.exportBackup());
    checks.exportBytes = new TextEncoder().encode(exported).byteLength;
    checks.exportCompact = !exported.includes('\n');
    checks.exportByteForByteEqual = exported === compact;
    checks.restoredQuestions = read.history.reduce((sum, entry) => sum + (entry.result.kind === 'screen' ? entry.result.questions.length : 0), 0);
    checks.restoredAttempts = read.history.reduce((sum, entry) => sum + (entry.result.kind === 'screen' ? entry.result.questions.reduce((n, question) => n + question.attempts, 0) : 0), 0);
    await measure('savePreferences-own-store', () => store.savePreferences({ ...read.preferences, player: { ...read.preferences.player, bpm: 83 } }));
    await measure('addHistory-single-session-upsert', () => store.addHistory(read.history[0]));
    await measure('readSnapshot-after-single-answer-write', () => store.readSnapshot());
    const container = document.getElementById('history')!;
    const practiceDraft = () => ({ context: { scope: 'structure' as const, root: 'A', structureId: 'minor-pentatonic' as const, positionIds: positions.map(position => position.id) }, durationMs: 0, comfortableBpm: 80 });
    const options: Parameters<typeof mountHistory>[1] = { getPreferences: () => read.preferences, applyPreferences: () => undefined,
      readConfirmed: store.readSnapshot, prepareImport: store.prepareImport, savePreset: store.savePreset, deletePreset: store.deletePreset, deleteHistory: store.deleteHistory,
      saveManual: async entry => { await store.addHistory(entry); }, waitForWrites: async () => undefined,
      exportConfirmed: async () => ({ json: await store.exportBackup(), incomplete: false }),
      restoreBackup: async (candidate, onCommitted) => { const { snapshot } = await store.restorePrepared(candidate); onCommitted(); return snapshot; },
      peekPracticeDraft: practiceDraft, capturePracticeDraft: practiceDraft,
      onRepeatErrors: () => undefined, isPersistent: () => true };
    const history = mountHistory(container, { ...options, readConfirmed: async () => read });
    await measure('actual-history-UI-refresh-from-already-validated-cache', () => history.refresh());
    checks.renderedEntries = container.querySelectorAll('[data-history-entry]').length;
    checks.renderedElementCount = container.querySelectorAll('*').length;
    history.dispose();
    const full = mountHistory(container, options);
    await measure(params.get('afterFix') === 'true' ? 'actual-history-UI-refresh-default-cached-read-drawer-closed' : 'actual-history-UI-refresh-native-read-full-validation', () => full.refresh());
    if (params.get('afterFix') === 'true') {
      const entry = read.history[0];
      await measure('single-answer-write-and-actual-UI-commit-drawer-closed', async () => { await store.addHistory(entry); full.commitEntry(entry); });
      const drawer = container.querySelector<HTMLDetailsElement>('details')!;
      await measure('actual-history-drawer-opening-and-first-render', async () => {
        const toggled = new Promise(resolve => drawer.addEventListener('toggle', resolve, { once: true }));
        drawer.open = true; await toggled;
      });
      checks.openRenderedEntries = container.querySelectorAll('[data-history-entry]').length;
      await measure('single-answer-write-and-actual-UI-commit-drawer-open', async () => { await store.addHistory(entry); full.commitEntry(entry); });
    }
    full.dispose();
    await store.close();
    const reopened = createStudyStore();
    await reopened.open();
    const reread = await measure('new-adapter-reopen-read-full-validation', () => reopened.readSnapshot());
    checks.reopenedCount = reread.history.length;
    await reopened.close();
  }
  await store.close(); observer.disconnect();
  return { checks, samples, navigator: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency }, endedAt: new Date().toISOString() };
}
(window as unknown as { p7Scale: { run: typeof run } }).p7Scale = { run };
