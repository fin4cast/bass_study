import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runReleaseBrowserChecks } from './helpers/release-browser-harness.mjs';
import { markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';

const checks = [];
const check = (name, run, options = {}) => checks.push({ name, run, ...options });
const historyAction = (page, name) => page.locator(`[data-history-action="${name}"]`);
const quizAction = (page, name) => page.locator(`[data-training-action="${name}"]`);
const OPEN_MIDI = { E: 28, A: 33, D: 38, G: 43 };
const midiForId = id => { const [string, fret] = id.split(':'); return OPEN_MIDI[string] + Number(fret); };

async function ready(page, keyboard = false) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert);
  const free = page.locator('[data-intro="free"]');
  if (await free.isVisible()) { if (keyboard) await keyboardActivate(page, free); else await free.click(); }
}
async function revealControl(locator, keyboard = false) {
  const page = locator.page();
  if (await locator.locator('xpath=ancestor::*[@id="study-settings"]').count() && !await page.locator('#study-settings').isVisible()) {
    const toggle = page.locator('#toggle-study-settings');
    if (keyboard) await keyboardActivate(page, toggle); else await toggle.click();
  }
  const parents = locator.locator('xpath=ancestor::details');
  for (let index = 0; index < await parents.count(); index++) {
    const details = parents.nth(index);
    if (!await details.evaluate(element => element.open)) { const summary = details.locator(':scope > summary'); if (keyboard) await keyboardActivate(locator.page(), summary); else await summary.click(); }
  }
}
async function saved(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="history-save-status"]')?.dataset.status === 'saved');
}
async function openHistory(page) {
  await ready(page); const drawer = page.locator('.history-drawer');
  if (!await drawer.evaluate(element => element.open)) await page.locator('#open-history').click();
  await page.getByLabel('Название пресета', { exact: true }).waitFor();
}
async function exportUi(page) {
  await openHistory(page); const downloading = page.waitForEvent('download'); await historyAction(page, 'export').click();
  const download = await downloading; return JSON.parse(await readFile(await download.path(), 'utf8'));
}
async function scope(page, { root = 'C', structure = 'major', first = 0, last = 0, strings = ['E'] } = {}) {
  await ready(page); await revealControl(page.getByLabel('Первый лад', { exact: true })); await page.getByLabel('Тоника', { exact: true }).selectOption(root); await page.getByLabel('Структура', { exact: true }).selectOption(structure);
  const min = page.getByLabel('Первый лад', { exact: true }); const max = page.getByLabel('Последний лад', { exact: true });
  await max.fill('24'); await max.press('Tab'); await min.fill(String(first)); await min.press('Tab'); await max.fill(String(last)); await max.press('Tab');
  for (const string of ['E', 'A', 'D', 'G']) await page.getByRole('checkbox', { name: `Струна ${string}`, exact: true }).setChecked(strings.includes(string));
}
async function quiz(page, mode, { count = 1, material = 'chromatic' } = {}) {
  await page.getByRole('button', { name: 'Задания', exact: true }).click(); await page.getByLabel('Тип задания', { exact: true }).selectOption(mode);
  await revealControl(page.getByLabel('Материал заданий', { exact: true })); const scopeField = page.getByLabel('Материал заданий', { exact: true }); if (await scopeField.isEnabled()) await scopeField.selectOption(material);
  await page.getByLabel('Количество вопросов', { exact: true }).fill(String(count)); await page.getByLabel('Количество вопросов', { exact: true }).press('Tab');
}
function scientificMidi(text) {
  const match = /\b([A-G])([♯♭#b]*)(-?\d+)\b/u.exec(text); assert.ok(match, `No visible scientific height in ${text}`);
  const naturals = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const alteration = [...match[2]].reduce((value, mark) => value + (mark === '#' || mark === '♯' ? 1 : -1), 0);
  return 12 * (Number(match[3]) + 1) + naturals[match[1]] + alteration;
}

const CURRENT_STORES = ['history', 'practiceDrafts', 'preferences', 'presets', 'profile', 'rhythmProjects'];
const literalCopy = async () => JSON.parse(await readFile(new URL('./fixtures/backup.json', import.meta.url), 'utf8'));

for (const version of [1, 10]) {
  check(`genuine-v${version}-indexeddb-upgrades-to-v11-by-recreating-empty-stores`, async ({ page }) => {
    const seeded = await page.evaluate(version => window.p6.seedOld(version), version);
    assert.equal(seeded.raw.version, version); assert.deepEqual(Object.keys(seeded.raw.stores), [...seeded.stores].sort());
    for (const name of seeded.stores) assert.ok(seeded.raw.stores[name].length > 0, `Old ${name} store must hold real data before the upgrade`);
    const open = () => page.evaluate(async () => {
      const store = await window.p6.loadCurrent(); await store.open();
      const snapshot = await store.readSnapshot({ fresh: true }); const skipped = store.skippedRecords(); await store.close();
      return { snapshot, empty: window.p6.empty, skipped, raw: await window.p6.rawRead() };
    });
    const upgraded = await open();
    assert.deepEqual(upgraded.snapshot, upgraded.empty); assert.equal(upgraded.snapshot.schemaVersion, 11); assert.deepEqual(upgraded.skipped, []);
    assert.deepEqual(upgraded.raw, { version: 11, stores: Object.fromEntries(CURRENT_STORES.map(name => [name, []])) });
    await page.reload(); await page.waitForFunction(() => window.p6?.ready);
    const reopened = await open(); assert.deepEqual(reopened, upgraded, 'A second open must not upgrade again or recreate data');
    return { seededVersion: version, seededStores: Object.fromEntries(Object.entries(seeded.raw.stores).map(([name, records]) => [name, records.length])), raw: upgraded.raw, snapshotIsEmptyDefault: true, reopenedWithoutSecondUpgrade: true };
  });
}

check('old-version-copy-is-refused-before-preview-and-leaves-native-database-unchanged', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const literal = await window.p6.readBackup(); const store = await window.p6.loadCurrent();
    await store.restorePrepared(store.prepareImport(JSON.stringify(literal)));
    const before = await store.readSnapshot({ fresh: true }), rawBefore = await window.p6.rawRead();
    const attempts = [];
    for (const schemaVersion of [1, 10]) {
      const json = JSON.stringify({ ...literal, schemaVersion }); let preview = null, restore = null;
      try { window.p6.previewImport(json); } catch (error) { preview = { code: error.code, message: error.message }; }
      try { await store.restorePrepared(store.prepareImport(json)); } catch (error) { restore = { code: error.code, message: error.message }; }
      attempts.push({ schemaVersion, preview, restore });
    }
    const after = await store.readSnapshot({ fresh: true }), rawAfter = await window.p6.rawRead();
    return { literalVersion: literal.schemaVersion, historyCount: literal.history.length, before, rawBefore, attempts, after, rawAfter };
  });
  assert.equal(result.literalVersion, 11); assert.equal(result.rawBefore.version, 11); assert.equal(result.rawBefore.stores.history.length, result.historyCount);
  for (const attempt of result.attempts) {
    assert.equal(attempt.preview?.code, 'UNSUPPORTED_VERSION', `preview v${attempt.schemaVersion}`); assert.equal(attempt.restore?.code, 'UNSUPPORTED_VERSION', `restore v${attempt.schemaVersion}`);
    assert.match(attempt.restore.message, /не поддерживается.*не изменены/);
  }
  assert.deepEqual(result.after, result.before); assert.deepEqual(result.rawAfter, result.rawBefore);
  return { attempts: result.attempts, nativeDatabaseUnchanged: true, cachedAndFreshUnchanged: true };
});

// Seeds the product origin while a JSON resource of that origin is open: the product does not start and holds neither IDB nor the writer lock.
async function seedOldProductDatabase(page, origin, literal, version = 10) {
  const response = await page.goto(`${origin}/vendor/music-bank/patch-manifest.json`);
  assert.equal(response.status(), 200, 'Needs the current product build with its local vendor manifest'); assert.equal(await page.locator('#history-mount').count(), 0);
  return page.evaluate(async ({ literal, version, origin }) => {
    if (location.origin !== origin) throw new Error('Deletion is allowed only on the isolated test origin');
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('bass-study'); request.onsuccess = resolve;
      request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Test origin database deletion blocked'));
    });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study', version);
      request.onupgradeneeded = () => {
        const db = request.result; const transaction = request.transaction;
        db.createObjectStore('preferences').put(literal.preferences, 'current'); db.createObjectStore('profile').put({ ...literal.profile, theme: 'dark' }, 'current');
        transaction.objectStore('preferences').put(literal.activeRhythmProjectId, 'rhythm-selection');
        for (const name of ['presets', 'history', 'practiceDrafts', 'rhythmProjects']) db.createObjectStore(name, { keyPath: 'id' });
        transaction.objectStore('presets').put({ id: 'old-preset', name: 'Старый пресет', createdAt: '2026-11-08T22:30:00.000Z', preferences: literal.preferences });
        for (const name of ['history', 'practiceDrafts', 'rhythmProjects']) for (const item of literal[name]) transaction.objectStore(name).put(item);
      };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    db.close();
  }, { literal, version, origin });
}
// Independent readonly count of every store; it does not import the product adapter.
/** waitForFunction не дожидается Promise из предиката, поэтому освобождение Web Lock опрашивается из Node. */
async function waitWriterReleased(page, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (await page.evaluate(async () => (await navigator.locks.query()).held.some(lock => lock.name === 'bass-study:writer'))) {
    assert.ok(Date.now() < deadline, 'bass-study:writer is still held');
    await delay(10);
  }
}
async function rawCounts(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Readonly reader must not create a missing database')); };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    try {
      const names = [...db.objectStoreNames].sort(); const transaction = db.transaction(names, 'readonly');
      const value = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const counts = await Promise.all(names.map(name => value(transaction.objectStore(name).count())));
      const profile = await value(transaction.objectStore('profile').get('current'));
      return { version: db.version, counts: Object.fromEntries(names.map((name, index) => [name, counts[index]])), theme: profile?.theme ?? null };
    } finally { db.close(); }
  });
}

check('product-opens-real-v10-database-as-empty-persistent-v11-and-rejects-old-copy', async ({ page, origin }) => {
  const literal = await literalCopy(); assert.equal(literal.schemaVersion, 11);
  await seedOldProductDatabase(page, origin, literal);
  const seeded = await rawCounts(page);
  assert.deepEqual(seeded, { version: 10, counts: { history: literal.history.length, practiceDrafts: literal.practiceDrafts.length, preferences: 2, presets: 1, profile: 1, rhythmProjects: literal.rhythmProjects.length }, theme: 'dark' });
  await page.goto(origin); await ready(page);
  const upgraded = await rawCounts(page);
  assert.equal(upgraded.version, 11); assert.deepEqual(Object.keys(upgraded.counts), CURRENT_STORES);
  for (const name of ['history', 'presets', 'practiceDrafts', 'rhythmProjects']) assert.equal(upgraded.counts[name], 0, `${name} must start empty after the upgrade`);
  assert.notEqual(upgraded.theme, 'dark', 'The old profile must not survive the upgrade');
  const surface = await page.evaluate(() => ({ storageDetailsHidden: document.querySelector('#open-storage-details')?.hidden, localStatus: document.querySelector('#local-save-status')?.textContent, testApi: ['p5', 'p6'].filter(name => name in window) }));
  assert.deepEqual(surface, { storageDetailsHidden: true, localStatus: 'Локально · сохранено', testApi: [] }, 'The upgraded product must persist natively, not in page memory');
  const empty = await exportUi(page);
  assert.equal(empty.schemaVersion, 11); assert.deepEqual([empty.presets, empty.history, empty.practiceDrafts, empty.rhythmProjects, empty.activeRhythmProjectId], [[], [], [], [], null]);
  await page.getByLabel('Тоника', { exact: true }).selectOption('F'); await saved(page);
  await page.reload(); await ready(page); assert.equal(await page.getByLabel('Тоника', { exact: true }).inputValue(), 'F', 'A setting written after the upgrade must survive reload');
  const before = await exportUi(page); assert.equal(before.preferences.study.root, 'F');
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles({ name: 'old-v10.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...literal, schemaVersion: 10 })) });
  await page.getByTestId('history-error').waitFor({ state: 'visible' });
  const error = await page.getByTestId('history-error').innerText(); assert.match(error, /не поддерживается/);
  assert.equal(await page.getByTestId('backup-preview').count(), 0);
  assert.deepEqual(await exportUi(page), before, 'A refused old copy must not change confirmed data');
  assert.equal((await rawCounts(page)).version, 11);
  return { seeded, upgraded, surface, persistedAfterUpgrade: 'F', oldCopyError: error };
}, { scope: 'ui' });
check('exact-height-mode-shows-A1-and-accepts-only-current-height', async ({ page }) => {
  await scope(page, { first: 5, last: 5 }); await quiz(page, 'find-pitch'); await quizAction(page, 'start').click();
  assert.match(await page.getByTestId('quiz-prompt').innerText(), /A1/); await page.locator('[data-answer-position="E:5"]').click(); assert.match(await page.getByTestId('quiz-feedback').innerText(), /Верно.*A1/);
  await scope(page, { first: 0, last: 12, strings: ['E', 'A'] }); await quiz(page, 'find-pitch'); await quizAction(page, 'start').click();
  const prompt = await page.getByTestId('quiz-prompt').innerText(); const targetMidi = scientificMidi(prompt);
  const ids = await page.getByTestId('quiz-answer-board').locator('[data-answer-position]').evaluateAll(nodes => nodes.map(node => node.dataset.answerPosition));
  const correct = ids.filter(id => midiForId(id) === targetMidi); assert.ok(correct.length);
  const octaveWrong = ids.find(id => midiForId(id) !== targetMidi && midiForId(id) % 12 === targetMidi % 12);
  const wrong = octaveWrong ?? ids.find(id => midiForId(id) !== targetMidi); assert.ok(wrong);
  await page.locator(`[data-answer-position="${wrong}"]`).click(); assert.match(await page.getByTestId('quiz-feedback').innerText(), /не подходит|октава/);
  await page.locator(`[data-answer-position="${correct[0]}"]`).click(); assert.match(await page.getByTestId('quiz-feedback').innerText(), /Верно/);
  await quizAction(page, 'next').click(); const output = await exportUi(page);
  const stored = output.history.find(entry => entry.result.mode === 'find-pitch' && entry.result.questions.some(question => question.errors === 1));
  assert.equal(stored.result.questions[0].targetMidi, targetMidi); assert.equal(stored.result.questions[0].independentCorrect, false);
  const firstA1 = output.history.find(entry => entry.result.mode === 'find-pitch' && entry.result.questions.some(question => question.targetMidi === 33 && question.errors === 0));
  assert.ok(firstA1, 'The earlier exact A1 result must remain in history');
  const historyEntry = page.locator(`[data-history-entry="${firstA1.id}"]`);
  await historyEntry.locator('.history-question-details > summary').click();
  assert.match(await historyEntry.locator('.history-question-details strong').innerText(), /\bA1\b/, 'History must retain the octave in the visible exact-height target');
  return { prompt, targetMidi, acceptedPositions: correct, rejected: wrong, rejectedDifferentOctave: Boolean(octaveWrong), historyRetainsScientificA1: true };
}, { scope: 'ui' });

check('chromatic-interval-mode-accepts-sharp-four-and-flat-five-by-height', async ({ page }) => {
  await scope(page, { first: 0, last: 3 }); await quiz(page, 'find-interval');
  const material = page.getByLabel('Материал заданий', { exact: true }); assert.ok(await material.isDisabled()); assert.equal(await material.inputValue(), 'chromatic');
  await page.getByRole('combobox', { name: 'Интервал от тоники', exact: true }).selectOption('#4'); await quizAction(page, 'start').click();
  assert.match(await page.getByTestId('quiz-prompt').innerText(), /♯4.*C/);
  await page.locator('[data-answer-position="E:1"]').click(); assert.match(await page.getByTestId('quiz-feedback').innerText(), /не подходит/);
  await page.locator('[data-answer-position="E:2"]').click(); assert.match(await page.getByTestId('quiz-feedback').innerText(), /Верно.*F♯/);
  await page.getByRole('combobox', { name: 'Интервал от тоники', exact: true }).selectOption('b5'); await quizAction(page, 'start').click();
  assert.match(await page.getByTestId('quiz-prompt').innerText(), /♭5.*C/); await page.locator('[data-answer-position="E:2"]').click(); assert.match(await page.getByTestId('quiz-feedback').innerText(), /Верно.*G♭/);
  await scope(page, { first: 0, last: 0 }); await page.getByRole('combobox', { name: 'Интервал от тоники', exact: true }).selectOption('#4'); await quizAction(page, 'start').click();
  assert.equal(await page.getByTestId('quiz-question').count(), 0); assert.match(await page.getByTestId('training-error').innerText(), /отсутствует|диапазон|интервал/i);
  return { sharpFourPosition: 'E:2', flatFivePosition: 'E:2', scope: 'chromatic', impossibleIntervalExplained: true };
}, { scope: 'ui' });

check('revealed-interval-svg-and-feedback-use-contextual-enharmonic-names', async ({ page }) => {
  const cases = [{ root: 'C', fret: 2, interval: 'b5', name: 'G♭', rejectedName: 'F♯' }, { root: 'A', fret: 11, interval: '#4', name: 'D♯', rejectedName: 'E♭' }];
  const evidence = [];
  for (const example of cases) {
    await scope(page, { root: example.root, first: example.fret, last: example.fret }); await quiz(page, 'find-interval');
    await page.getByRole('combobox', { name: 'Интервал от тоники', exact: true }).selectOption(example.interval); await quizAction(page, 'start').click();
    const position = page.locator(`[data-answer-position="E:${example.fret}"]`); assert.equal(await position.locator('text').count(), 0);
    await quizAction(page, 'hint').click(); assert.deepEqual(await position.locator('text').allTextContents(), [example.name]);
    const feedback = await page.getByTestId('quiz-feedback').innerText(); assert.ok(feedback.includes(example.name)); assert.ok(!feedback.includes(example.rejectedName));
    evidence.push({ ...example, feedback });
  }
  return evidence;
}, { scope: 'ui' });

check('inactive-invalid-tempo-ladder-does-not-block-ordinary-play-or-canonical-preferences', async ({ page }) => {
  await scope(page); await page.getByRole('button', { name: 'Последовательности', exact: true }).click(); await page.getByLabel('Материал последовательности', { exact: true }).selectOption('chromatic');
  await page.locator('#player-mount').getByLabel('Повтор', { exact: true }).selectOption('ladder'); await page.getByLabel('Начальный темп', { exact: true }).fill('200'); await page.getByLabel('Целевой темп', { exact: true }).fill('80'); await page.getByLabel('Целевой темп', { exact: true }).press('Tab');
  await page.locator('[data-player-action="start"]').click(); assert.match(await page.getByTestId('player-error').innerText(), /не меньше начального/);
  const player = page.locator('#player-mount');
  const bpm = player.getByLabel('Темп, BPM', { exact: true });
  await player.getByLabel('Повтор', { exact: true }).selectOption('once'); await bpm.fill('96'); await bpm.press('Tab');
  assert.ok(await page.getByTestId('player-error').isHidden()); await page.locator('[data-player-action="start"]').click();
  await page.waitForFunction(() => ['running', 'finishing', 'finished'].includes(document.querySelector('#player-mount')?.dataset.playerState));
  await page.locator('[data-player-action="stop"]').click(); await openHistory(page); await page.getByLabel('Название пресета', { exact: true }).fill('Обычный темп после ошибки лестницы'); await historyAction(page, 'save-preset').click();
  await page.getByTestId('preset-list').getByText('Обычный темп после ошибки лестницы', { exact: true }).waitFor(); const exported = await exportUi(page);
  assert.equal(exported.preferences.player.repeat, 'once'); assert.equal(exported.preferences.player.bpm, 96); assert.equal(exported.preferences.player.ladderStart, 60); assert.equal(exported.preferences.player.ladderEnd, 100);
  assert.deepEqual(exported.presets[0].preferences.player, exported.preferences.player);
  return { rejectedActiveLadder: [200, 80], ordinaryPlaybackAccepted: true, canonicalPlayer: exported.preferences.player };
}, { scope: 'ui' });

check('changing-active-quiz-count-archives-original-attempt-and-new-session-focuses-summary', async ({ page }) => {
  await scope(page); await quiz(page, 'name-note'); await quizAction(page, 'start').click(); await page.locator('[data-choice="pc:5"]').click();
  const count = page.getByLabel('Количество вопросов', { exact: true }); await count.fill('2'); await count.press('Tab');
  assert.equal(await page.getByTestId('quiz-question').count(), 0); await page.getByTestId('quiz-summary').waitFor();
  const before = await exportUi(page); assert.equal(before.history.length, 1); const original = before.history[0];
  assert.equal(original.result.plannedCount, 1); assert.equal(original.result.questions[0].outcome, 'interrupted'); assert.equal(original.result.questions[0].errors, 1);
  assert.equal(await page.getByLabel('Количество вопросов', { exact: true }).inputValue(), '2'); await quizAction(page, 'start').click();
  for (let index = 0; index < 2; index++) { await page.locator('[data-choice="pc:4"]').click(); await quizAction(page, 'next').click(); }
  await page.getByTestId('quiz-summary').waitFor(); assert.equal(await page.getByTestId('quiz-summary').locator('[data-result="completed"]').innerText(), '2');
  assert.equal(await page.getByTestId('quiz-summary').locator('h3').evaluate(element => element === document.activeElement), true, 'User completion must focus the new summary');
  const after = await exportUi(page); assert.equal(after.history.length, 2); assert.deepEqual(after.history.find(entry => entry.id === original.id), original);
  const next = after.history.find(entry => entry.id !== original.id); assert.equal(next.result.plannedCount, 2); assert.equal(next.result.questions.length, 2);
  return { oldPlannedCount: 1, oldErrorsPreserved: 1, newPlannedCount: 2, separateIds: [original.id, next.id], summaryFocusedOnCompletion: true };
}, { scope: 'ui' });

check('manual-draft-keeps-old-material-and-merges-new-runs-without-double-counting', async ({ page }) => {
  await scope(page); await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  await page.getByLabel('Материал последовательности', { exact: true }).selectOption('chromatic'); await page.locator('#player-mount').getByLabel('Повтор', { exact: true }).selectOption('infinite');
  const bpm = page.locator('#player-mount').getByLabel('Темп, BPM', { exact: true });
  await bpm.fill('120'); await bpm.press('Tab'); await page.getByLabel('Отсчёт перед стартом', { exact: true }).uncheck();
  async function playFor(milliseconds) { await page.locator('[data-player-action="start"]').click(); await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.playerState === 'running' && document.querySelector('#player-mount')?.dataset.currentPosition === 'E:0'); await delay(milliseconds); await page.locator('[data-player-action="stop"]').click(); }
  await playFor(650); await openHistory(page);
  await page.getByLabel('Название пресета', { exact: true }).fill('Тот же материал C'); await historyAction(page, 'save-preset').click(); await page.getByTestId('preset-list').getByText('Тот же материал C', { exact: true }).waitFor();
  const oldText = 'Заметка к прежнему материалу C.';
  await page.getByLabel('Заметка к практике', { exact: true }).fill(oldText); await page.getByLabel('Комфортный темп', { exact: true }).fill('72');
  const withDraft = await exportUi(page); const originalDraft = withDraft.practiceDrafts.find(item => item.note === oldText); assert.ok(originalDraft); assert.equal(withDraft.history.length, 0);
  await page.locator('[data-app-module="tracks"]').click();
  assert.equal(await page.locator('#open-history').getAttribute('aria-expanded'), 'false');
  await openHistory(page);
  assert.equal(await page.getByLabel('Заметка к практике', { exact: true }).inputValue(), oldText); assert.ok(await historyAction(page, 'use-current-draft').isDisabled());
  await page.locator('[data-app-module="foundation"]').click();
  assert.equal(await page.locator('#open-history').getAttribute('aria-expanded'), 'false');
  await page.getByLabel('Тоника', { exact: true }).selectOption('G'); await openHistory(page); await historyAction(page, 'refresh-draft').click();
  assert.match(await page.getByTestId('manual-context-notice').innerText(), /прежнему материалу/); assert.match(await page.getByTestId('manual-material').innerText(), /C ·/);
  await historyAction(page, 'save-manual').click(); await page.getByTestId('history-list').locator('[data-history-kind="manual"]').waitFor();
  const first = await exportUi(page), oldEntry = first.history.find(entry => entry.result.note === oldText);
  assert.ok(oldEntry); assert.equal(oldEntry.result.context.root, 'C'); assert.deepEqual(oldEntry.result.context.positionIds, ['E:0']); assert.equal(oldEntry.result.comfortableBpm, 72); assert.equal(oldEntry.result.material.kind, 'sequence');
  assert.ok(oldEntry.result.durationMs >= 500 && oldEntry.result.durationMs < 1300); assert.equal(first.practiceDrafts.find(item => item.id === originalDraft.id).recordedThroughMs, oldEntry.result.durationMs);
  await page.getByTestId('preset-list').getByRole('button', { name: 'Применить', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[aria-label="Тоника"]')?.value === 'C');
  await playFor(1400); await historyAction(page, 'refresh-draft').click();
  const newText = 'Новый остаток того же материала C.';
  await page.getByLabel('Заметка к практике', { exact: true }).fill(newText); await page.getByLabel('Комфортный темп', { exact: true }).fill('84'); await historyAction(page, 'save-manual').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-history-kind="manual"]').length === 2);
  const after = await exportUi(page), newEntry = after.history.find(entry => entry.result.note === newText); assert.ok(newEntry); assert.equal(newEntry.result.comfortableBpm, 84); assert.ok(newEntry.result.durationMs >= 1300);
  const accumulated = after.practiceDrafts.find(item => item.id === originalDraft.id); assert.ok(accumulated); assert.equal(accumulated.recordedThroughMs, oldEntry.result.durationMs + newEntry.result.durationMs); assert.equal(accumulated.totalReferenceMs, accumulated.recordedThroughMs);
  assert.deepEqual(after.history.find(entry => entry.id === oldEntry.id), oldEntry);
  return { originalDraftId: originalDraft.id, oldEntry, newEntry, mergedSameMaterial: true, differentCurrentContextDidNotReassignOldNote: true };
}, { scope: 'ui' });

check('manual-practice-before-input-survives-reload-without-becoming-history', async ({ page }) => {
  await scope(page); await page.getByRole('button', { name: 'Последовательности', exact: true }).click(); await page.getByLabel('Материал последовательности', { exact: true }).selectOption('chromatic');
  await page.locator('#player-mount').getByLabel('Повтор', { exact: true }).selectOption('infinite'); await page.getByLabel('Отсчёт перед стартом', { exact: true }).uncheck();
  await page.locator('[data-player-action="start"]').click(); await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.currentPosition === 'E:0'); await delay(650); await page.locator('[data-player-action="stop"]').click();
  const before = await exportUi(page); assert.equal(before.history.length, 0); const draft = before.practiceDrafts.find(item => item.totalReferenceMs > 0); assert.ok(draft);
  await page.reload(); await ready(page); const reopened = await exportUi(page); assert.deepEqual(reopened.practiceDrafts, before.practiceDrafts); assert.equal(reopened.history.length, 0);
  await page.getByLabel('Заметка к практике', { exact: true }).fill('Сохранено после перезапуска'); await historyAction(page, 'save-manual').click(); await saved(page);
  const after = await exportUi(page); assert.equal(after.history.length, 1); assert.equal(after.history[0].result.durationMs, draft.totalReferenceMs); assert.equal(after.history[0].result.material.kind, 'sequence');
  return { survivedWithoutManualInput: true, historyCreatedOnlyBySave: true, draftId: draft.id, measuredMs: draft.totalReferenceMs };
}, { scope: 'ui' });

check('partial-wrong-answer-survives-reload-without-finish-and-new-session-is-separate', async ({ page }) => {
  await scope(page); await quiz(page, 'name-note'); await quizAction(page, 'start').click(); await page.locator('[data-choice="pc:5"]').click(); await saved(page);
  // No Finish, Next, mode switch, export or other session-ending action occurs.
  await page.reload(); await ready(page); const first = await exportUi(page);
  assert.equal(first.history.length, 1); const original = first.history[0]; const question = original.result.questions[0];
  assert.equal(question.outcome, 'interrupted'); assert.equal(question.errors, 1); assert.equal(question.skipped, false); assert.equal(question.independentCorrect, false);
  assert.equal(question.answerEvents.length, 1); assert.equal(question.answerEvents[0].correct, false); assert.match(await page.getByTestId('history-list').innerText(), /Не завершено/);
  await quizAction(page, 'start').click(); await page.locator('[data-choice="pc:4"]').click(); await quizAction(page, 'next').click(); await saved(page);
  const second = await exportUi(page); assert.equal(second.history.length, 2); assert.deepEqual(second.history.find(entry => entry.id === original.id), original);
  return { preservedOriginal: original, separateHistoryIds: second.history.map(entry => entry.id) };
}, { scope: 'ui' });

check('invalid-quiz-count-does-not-break-history-and-short-boards-stay-bounded', async ({ page, resultDir }) => {
  await scope(page, { first: 0, last: 0 }); await quiz(page, 'name-note');
  const count = page.getByLabel('Количество вопросов', { exact: true });
  const rejected = [];
  for (const value of ['99', '']) {
    await count.fill(value); await count.press('Tab');
    await openHistory(page); assert.ok(await page.getByTestId('manual-unavailable').isVisible());
    assert.ok(await page.getByLabel('Комфортный темп', { exact: true }).isHidden());
    await quizAction(page, 'start').click(); assert.equal(await page.getByTestId('quiz-question').count(), 0);
    const error = await page.getByTestId('training-error').innerText(); assert.match(error, /1.*30|число|вопрос/i); rejected.push({ value, error });
  }
  await count.fill('1'); await count.press('Tab'); await quizAction(page, 'start').click(); await page.getByTestId('quiz-question').waitFor();
  const board = page.getByTestId('quiz-answer-board'); const desktop = await board.boundingBox();
  assert.ok(desktop && desktop.height > 0 && desktop.height < 500, `A one-fret answer board must not stretch vertically: ${JSON.stringify(desktop)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await board.boundingBox(); assert.ok(narrow && narrow.height < 500);
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth,
    scrollContainers: [...document.querySelectorAll('*')].filter(element => element.scrollWidth > element.clientWidth + 2 && ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)).map(element => ({ className: element.className.baseVal ?? element.className, width: element.clientWidth, content: element.scrollWidth })) }));
  assert.ok(dimensions.page <= dimensions.viewport + 2, `Narrow page overflow escaped the board container: ${JSON.stringify(dimensions)}`);
  await page.screenshot({ path: join(resultDir, 'p6-short-quiz-narrow.png'), fullPage: true });
  await page.locator('[data-choice="pc:4"]').click(); assert.match(await page.getByTestId('quiz-feedback').innerText(), /Верно/);
  return { rejected, recoveredCount: 1, desktop, narrow, dimensions, screenshot: 'test-results/p6-short-quiz-narrow.png' };
}, { scope: 'ui' });

async function tabTo(page, locator, limit = 160) {
  for (let index = 0; index < limit; index++) {
    if (await locator.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Could not reach ${await locator.getAttribute('aria-label') ?? await locator.innerText()} with Tab`);
}
async function keyboardText(page, locator, value) {
  await revealControl(locator, true); await tabTo(page, locator); await page.keyboard.press('Control+A'); await page.keyboard.type(String(value)); await page.keyboard.press('Tab');
}
async function keyboardSelect(page, locator, index) {
  await revealControl(locator, true);
  if (await locator.evaluate(element => element.classList.contains('select-picker-native'))) {
    const trigger = locator.locator('..').locator('.select-picker-trigger');
    await tabTo(page, trigger); await page.keyboard.press('Enter'); await page.keyboard.press('Home');
    for (let step = 0; step < index; step++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
  } else {
    await tabTo(page, locator); await page.keyboard.press('Home'); for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
  }
}
async function keyboardActivate(page, locator) { await tabTo(page, locator); await page.keyboard.press('Enter'); }
async function keyboardExport(page) {
  const downloading = page.waitForEvent('download'); await keyboardActivate(page, historyAction(page, 'export')); const download = await downloading;
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

check('keyboard-only-full-practice-survives-browser-reopen-at-stable-origin', async ({ freshPage, closeContext, restartServer, origin, resultDir }) => {
  const first = await freshPage(origin, false, 'keyboard-release-profile'); let expected;
  try {
    const page = first.page; await ready(page, true);
    await keyboardSelect(page, page.getByLabel('Тоника', { exact: true }), 0);
    await keyboardSelect(page, page.getByLabel('Структура', { exact: true }), 0);
    await keyboardSelect(page, page.getByLabel('Учебная форма', { exact: true }), 0);
    await keyboardText(page, page.getByLabel('Первый лад', { exact: true }), 0);
    await keyboardText(page, page.getByLabel('Последний лад', { exact: true }), 0);
    for (const string of ['A', 'D', 'G']) {
      const checkbox = page.getByRole('checkbox', { name: `Струна ${string}`, exact: true });
      if (await checkbox.isChecked()) { await tabTo(page, checkbox); await page.keyboard.press('Space'); }
    }
    assert.deepEqual(await page.locator('.string-switch input:checked').evaluateAll(nodes => nodes.map(node => node.value)), ['E'], 'Keyboard setup must leave exactly the E string');
    await keyboardActivate(page, page.getByRole('button', { name: 'Задания', exact: true }));
    await keyboardSelect(page, page.getByLabel('Материал заданий', { exact: true }), 1);
    await keyboardText(page, page.getByLabel('Количество вопросов', { exact: true }), 1);
    await keyboardActivate(page, quizAction(page, 'start')); await page.getByTestId('quiz-question').waitFor();
    assert.match(await page.getByTestId('quiz-prompt').innerText(), /струна E, лад 0/, 'The independent visible question must match E/0 before choosing E');
    await keyboardActivate(page, page.locator('[data-choice="pc:4"]')); await keyboardActivate(page, quizAction(page, 'next')); await saved(page);
    await keyboardActivate(page, page.getByRole('button', { name: 'Последовательности', exact: true }));
    await keyboardSelect(page, page.getByLabel('Материал последовательности', { exact: true }), 1);
    await keyboardSelect(page, page.getByLabel('Длительность нот', { exact: true }), 0);
    await keyboardSelect(page, page.locator('#player-mount').getByLabel('Повтор', { exact: true }), 1);
    await tabTo(page, page.getByLabel('Отсчёт перед стартом', { exact: true })); await page.keyboard.press('Space');
    await keyboardActivate(page, page.locator('[data-player-action="start"]'));
    await page.waitForFunction(() => document.querySelector('#player-mount')?.dataset.currentPosition === 'E:0');
    await delay(900); await keyboardActivate(page, page.locator('[data-player-action="stop"]'));
    await keyboardActivate(page, page.locator('#open-history'));
    await keyboardText(page, page.getByLabel('Комфортный темп', { exact: true }), 76);
    await keyboardText(page, page.getByLabel('Заметка к практике', { exact: true }), 'Полный сценарий только клавиатурой.');
    await keyboardActivate(page, historyAction(page, 'save-manual')); await saved(page);
    expected = await keyboardExport(page); assert.equal(expected.history.length, 2);
    const screen = expected.history.find(entry => entry.result.kind === 'screen'); const manual = expected.history.find(entry => entry.result.kind === 'manual');
    assert.equal(screen.result.questions[0].independentCorrect, true); assert.equal(manual.result.comfortableBpm, 76); assert.ok(manual.result.durationMs > 0);
    assert.deepEqual(expected.preferences.study.strings, ['E']); assert.equal(expected.preferences.study.fretMax, 0);
    await page.screenshot({ path: join(resultDir, 'p6-keyboard-practice.png'), fullPage: true });
  } finally { await closeContext(first.context); }
  const staticServerRestart = await restartServer(); const reopened = await freshPage(origin, false, 'keyboard-release-profile');
  try {
    await ready(reopened.page); const restored = await exportUi(reopened.page); assert.deepEqual(restored, expected);
    assert.equal(await reopened.page.getByLabel('Последний лад', { exact: true }).inputValue(), '0');
    return { allScenarioActionsByKeyboard: true, wholeBrowserRestart: true, staticServerRestart, serverRestart: staticServerRestart, stableOrigin: origin, restored, screenshot: 'test-results/p6-keyboard-practice.png' };
  } finally { await closeContext(reopened.context); }
}, { scope: 'persistent' });

check('actual-web-lock-prevents-second-writer-and-hands-off-after-close', async ({ page, context, origin }) => {
  await ready(page); await page.getByLabel('Тоника', { exact: true }).selectOption('F'); await saved(page); await openHistory(page);
  await page.getByLabel('Заметка к практике', { exact: true }).fill('Одна ведущая вкладка'); await historyAction(page, 'save-manual').click(); await saved(page);
  const before = await exportUi(page); const second = await context.newPage(); await second.goto(origin);
  await second.waitForFunction(() => document.querySelector('main')?.inert && !document.querySelector('#retry-tab')?.hidden);
  assert.match(await second.locator('#persistence-message').innerText(), /друг.*вклад|открыт.*вклад/i);
  assert.equal(await second.locator('[data-theme-choice]').count(), 2);
  for (const choice of ['light', 'dark']) assert.ok(await second.locator(`[data-theme-choice="${choice}"]`).isDisabled(), 'A blocked second writer cannot change the global theme');
  assert.ok(await second.locator('#open-introduction').isDisabled(), 'A blocked second writer cannot persist an onboarding choice');
  assert.deepEqual((await exportUi(page)).profile, before.profile, 'Opening the blocked tab must leave the confirmed owner profile unchanged');
  const locks = await page.evaluate(async () => (await navigator.locks.query()).held.map(lock => lock.name)); assert.ok(locks.includes('bass-study:writer'));
  await page.close(); await second.locator('#retry-tab').click(); await ready(second); const after = await exportUi(second);
  for (const choice of ['light', 'dark']) assert.ok(await second.locator(`[data-theme-choice="${choice}"]`).isEnabled());
  assert.ok(await second.locator('#open-introduction').isEnabled());
  assert.deepEqual(after, before); assert.equal(await second.getByLabel('Тоника', { exact: true }).inputValue(), 'F');
  return { nativeHeldLocks: locks, blockedSecondWriter: true, blockedGlobalProfileControls: true, confirmedOwnerProfileUnchanged: true, explicitReloadAfterRelease: true, preservedHistoryIds: after.history.map(entry => entry.id) };
}, { scope: 'ui' });

check('p12-sequence-retirement-saves-pending-note-before-next-writer', async ({ page, context, origin }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  await page.locator('#player-mount').getByLabel('Повтор', { exact: true }).selectOption('infinite');
  await page.getByLabel('Отсчёт перед стартом', { exact: true }).uncheck();
  await page.locator('[data-player-action="start"]').click();
  await page.waitForFunction(() => {
    const player = document.querySelector('#player-mount');
    return player?.dataset.playerState === 'running' && player.dataset.playerPhase === 'practice' && !!player.dataset.currentPosition;
  });
  await delay(300);
  await page.locator('[data-player-action="stop"]').click();
  const before = await exportUi(page);
  const draft = before.practiceDrafts.find(value => value.material.kind === 'sequence' && value.totalReferenceMs > 0);
  assert.ok(draft);
  assert.equal(draft.note, '');

  const next = await context.newPage();
  await next.goto(origin);
  await next.waitForFunction(() => document.querySelector('main')?.inert && !document.querySelector('#retry-tab')?.hidden);
  await page.bringToFront();
  await page.getByLabel('Заметка к практике', { exact: true }).focus();
  const note = 'Черновик перед закрытием';
  await page.evaluate(note => {
    const editor = document.querySelector('[data-history-field="manualNote"]');
    editor.value = note;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: note }));
    // Keep the real document alive for IndexedDB while invoking its retirement listener before debounce.
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  }, note);
  await waitWriterReleased(next);
  await next.locator('#retry-tab').click();
  await ready(next);
  const after = await exportUi(next);
  const savedDraft = after.practiceDrafts.find(value => value.id === draft.id);
  assert.ok(savedDraft, 'The next writer must read the original draft from IndexedDB');
  const { updatedAt: _updatedAt, ...expected } = draft;
  assert.deepEqual(savedDraft, { ...expected, note, editRevision: draft.editRevision + 1, updatedAt: savedDraft.updatedAt });
  return { controlledPagehide: true, nextNativeWriter: true, draftId: draft.id, durationMs: draft.totalReferenceMs, pendingNotePersisted: true };
}, { scope: 'ui' });

check('local-production-server-refuses-busy-port-without-moving-origin', async ({ origin, refuseOccupiedServer }) => {
  const refusal = await refuseOccupiedServer();
  assert.equal((await fetch(origin)).status, 200);
  return { refused: true, refusal, originalOriginStillResponds: origin };
}, { scope: 'ui' });

markFullOnly(checks, [
  'keyboard-only-full-practice-survives-browser-reopen-at-stable-origin',
], FULL_ONLY.separateProcess);
markFullOnly(checks, [
  'genuine-v10-indexeddb-upgrades-to-v11-by-recreating-empty-stores',
  'product-opens-real-v10-database-as-empty-persistent-v11-and-rejects-old-copy',
  'chromatic-interval-mode-accepts-sharp-four-and-flat-five-by-height',
  'revealed-interval-svg-and-feedback-use-contextual-enharmonic-names',
  'inactive-invalid-tempo-ladder-does-not-block-ordinary-play-or-canonical-preferences',
  'changing-active-quiz-count-archives-original-attempt-and-new-session-focuses-summary',
  'manual-draft-keeps-old-material-and-merges-new-runs-without-double-counting',
  'invalid-quiz-count-does-not-break-history-and-short-boards-stay-bounded',
  'p12-sequence-retirement-saves-pending-note-before-next-writer',
], FULL_ONLY.smoke);
await runReleaseBrowserChecks(checks);
