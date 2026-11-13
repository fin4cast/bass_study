import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runReleaseBrowserChecks } from './helpers/release-browser-harness.mjs';
import { browserCases, markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';
import {
  answerChoice, answerNameNoteCorrectly, checkHost, checkProgress, currentSection, exportDownload, exportUi, go, nameNoteQuestion, openDrafts,
  openFormCheck, openSettingsPane, playRhythm, previewCopy, progressPage, rawSnapshot, ready, rhythmBpm, settingsDialog, settingsPage, untilAudioPlayed, waitRaw, withoutSection,
} from './helpers/data-ui.mjs';

// Сценарии выпуска в оболочке P13: «Проверь себя» по форме атласа вместо вкладки «Задания», «Ритм» как источник часов
// ручной практики вместо проигрывателя последовательностей, «Прогресс» и «Настройки → Данные» вместо панели истории.
const checks = [];
const check = (name, run, options = {}) => checks.push({ name, run, ...options });
const OPEN_MIDI = { E: 28, A: 33, D: 38, G: 43 };
const midiForId = id => { const [string, fret] = id.split(':'); return OPEN_MIDI[string] + Number(fret); };
const cells = page => checkHost(page).locator('[data-cell]').evaluateAll(nodes => nodes.map(node => node.dataset.cell));
const feedback = page => checkHost(page).locator('[data-ck-feedback]').innerText();
function scientificMidi(text) {
  const match = /\b([A-G])([♯♭#b]*)(-?\d+)\b/u.exec(text); assert.ok(match, `No visible scientific height in ${text}`);
  const naturals = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const alteration = [...match[2]].reduce((value, mark) => value + (mark === '#' || mark === '♯' ? 1 : -1), 0);
  return 12 * (Number(match[3]) + 1) + naturals[match[1]] + alteration;
}
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Схема 11 (P13): «Упражнения» заменили пресеты. Списки хранилищ отсортированы, как их читает независимый raw-читатель.
const CURRENT_STORES = ['exercises', 'history', 'practiceDrafts', 'preferences', 'profile', 'rhythmProjects'];
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
  assert.equal(response.status(), 200, 'Needs the current product build with its local vendor manifest'); assert.equal(await page.locator('.site-header').count(), 0);
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
  for (const name of ['exercises', 'history', 'practiceDrafts', 'rhythmProjects']) assert.equal(upgraded.counts[name], 0, `${name} must start empty after the upgrade`);
  assert.equal(Object.hasOwn(upgraded.counts, 'presets'), false, 'The removed presets store must not survive the upgrade');
  assert.notEqual(upgraded.theme, 'dark', 'The old profile must not survive the upgrade');
  const surface = await page.evaluate(() => ({ storageDetailsHidden: document.querySelector('#open-storage-details')?.hidden, testApi: ['p5', 'p6'].filter(name => name in window) }));
  assert.deepEqual(surface, { storageDetailsHidden: true, testApi: [] }, 'The upgraded product must persist natively, not in page memory');
  const empty = await exportUi(page, { stay: true });
  assert.equal(empty.schemaVersion, 11); assert.deepEqual([empty.exercises, empty.history, empty.practiceDrafts, empty.rhythmProjects, empty.activeRhythmProjectId], [[], [], [], [], null]);
  assert.match(await settingsPage(page).locator('[data-save-detail]').innerText(), /^Сохранено/);
  const lesson = await openSettingsPane(page, 'lesson');
  await lesson.locator('[data-switch="countIn"]').click();
  await waitRaw(page, db => db.preferences?.play.countIn === false, 'отсчёт выключен');
  await page.reload(); await ready(page);
  assert.equal(await settingsPage(page).locator('[data-switch="countIn"]').getAttribute('aria-checked'), 'false', 'A setting written after the upgrade must survive reload');
  const before = await exportUi(page, { stay: true }); assert.equal(before.preferences.play.countIn, false);
  const refused = await previewCopy(page, { ...literal, schemaVersion: 10 }, 'old-v10.json');
  assert.equal(refused.rejected, true);
  assert.equal(await refused.dialog.locator('h2').innerText(), 'Эта копия не подходит');
  const error = await refused.dialog.innerText(); assert.match(error, /версии данных 10.*сейчас версия 11/s); assert.match(error, /Ничего не изменилось/);
  await refused.dialog.locator('[data-dlg="close"]').click();
  assert.deepEqual(await exportUi(page, { stay: true }), before, 'A refused old copy must not change confirmed data');
  assert.equal((await rawCounts(page)).version, 11);
  return { seeded, upgraded, surface, persistedAfterUpgrade: { countIn: false }, oldCopyError: error.replace(/\s+/g, ' ') };
}, { scope: 'ui' });

check('check-find-pitch-accepts-only-current-height-and-stores-target-midi', async ({ page }) => {
  await ready(page);
  await openFormCheck(page, 'find-pitch');
  // «Все ноты участка»: на участке формы у высоты вопроса есть позиции другой октавы.
  await checkHost(page).locator('[data-act="toggle-scope"]').click();
  assert.equal(await checkHost(page).locator('[data-act="toggle-scope"]').getAttribute('aria-pressed'), 'true');
  const title = await checkHost(page).locator('[data-ck-title]').innerText();
  assert.match(await checkHost(page).locator('.ck-ask .ck-sub').innerText(), /другая октава не подходит/);
  const targetMidi = scientificMidi(title);
  // Доска шире участка: клетки вне участка тоже кликабельны и получают отказ «вне материала». Участок формы A
  // ля-минорной пентатоники по независимому расчёту (R-014) — лады 5–8 на всех струнах.
  assert.match(await checkHost(page).innerText(), /Am · минорная пентатоника · форма A/);
  const ids = (await cells(page)).filter(id => { const fret = Number(id.split(':')[1]); return fret >= 5 && fret <= 8; });
  const correct = ids.filter(id => midiForId(id) === targetMidi); assert.ok(correct.length, `${title}: ${ids.join(' ')}`);
  const octaveWrong = ids.find(id => midiForId(id) !== targetMidi && midiForId(id) % 12 === targetMidi % 12);
  const wrong = octaveWrong ?? ids.find(id => midiForId(id) !== targetMidi); assert.ok(wrong);
  await checkHost(page).locator(`[data-cell="${wrong}"]`).click();
  const refusal = await feedback(page);
  if (octaveWrong) assert.match(refusal, /та же нота, другая октава/); else assert.match(refusal, /не /);
  await checkHost(page).locator(`[data-cell="${correct[0]}"]`).click();
  assert.match(await feedback(page), /^Верно, с исправлением/);
  const saved = await waitRaw(page, db => db.history.some(entry => entry.result.mode === 'find-pitch' && entry.result.questions[0]?.outcome === 'corrected'), 'ответ «Найди высоту»');
  const stored = saved.history.find(entry => entry.result.mode === 'find-pitch');
  assert.equal(stored.result.questions[0].targetMidi, targetMidi); assert.equal(stored.result.questions[0].independentCorrect, false);
  assert.equal(stored.result.context.scope, 'chromatic');
  return { title, targetMidi, acceptedPositions: correct, rejected: wrong, rejectedDifferentOctave: Boolean(octaveWrong), refusal };
}, { scope: 'ui' });

/** Позиции интервала от тоники по высоте: независимый расчёт по строю E–A–D–G. */
const intervalPositions = (ids, root, semitones) => ids.filter(id => ((midiForId(id) - NATURAL_PC[root]) % 12 + 12) % 12 === semitones).sort();

check('check-find-interval-accepts-sharp-four-and-flat-five-by-height', async ({ page }) => {
  await ready(page);
  await openFormCheck(page, 'find-interval');
  const host = checkHost(page);
  assert.equal(await host.locator('[data-act="toggle-scope"]').count(), 0, 'The interval always uses every note of the area');
  const evidence = [];
  for (const [interval, name] of [['#4', 'D♯'], ['b5', 'E♭']]) {
    await host.locator('[data-interval]').selectOption(interval);
    await page.waitForFunction(value => document.querySelector('[data-lesson-screen="check"] [data-interval]')?.value === value, interval);
    const title = await host.locator('[data-ck-title]').innerText();
    assert.equal(title, `Найди ${interval.replace('#', '♯').replace('b', '♭')} от A`);
    const ids = await cells(page);
    const answers = intervalPositions(ids, 'A', 6);
    const wrong = ids.find(id => !answers.includes(id));
    assert.ok(answers.length && wrong);
    await host.locator(`[data-cell="${wrong}"]`).click();
    assert.doesNotMatch(await feedback(page), /^Верно/);
    await host.locator(`[data-cell="${answers[0]}"]`).click();
    const accepted = await feedback(page);
    assert.match(accepted, /^Верно/); assert.ok(accepted.includes(name), `${accepted} names ${name}`);
    evidence.push({ interval, answers, rejected: wrong, accepted });
    await host.locator('[data-act="finish"]').click(); await host.locator('[data-ck-summary]').waitFor();
    await host.locator('[data-act="again"]').click(); await host.locator('[data-ck-title]').waitFor();
  }
  return { root: 'A', area: 'форма A, лады 5–8', evidence };
}, { scope: 'ui' });

check('revealed-interval-feedback-and-board-use-contextual-enharmonic-names', async ({ page }) => {
  await ready(page);
  await openFormCheck(page, 'find-interval');
  const host = checkHost(page);
  const evidence = [];
  for (const { interval, name, rejectedName } of [{ interval: '#4', name: 'D♯', rejectedName: 'E♭' }, { interval: 'b5', name: 'E♭', rejectedName: 'D♯' }]) {
    await host.locator('[data-interval]').selectOption(interval);
    await page.waitForFunction(value => document.querySelector('[data-lesson-screen="check"] [data-interval]')?.value === value, interval);
    const ids = await cells(page);
    const answers = intervalPositions(ids, 'A', 6);
    assert.equal(await host.locator('[data-cell].is-shown').count(), 0, 'Nothing is shown before the reveal');
    await host.locator('[data-act="reveal"]').click();
    const text = await feedback(page);
    assert.ok(text.includes(name) && !text.includes(rejectedName), text);
    assert.match(text, /^Ответ показан:/);
    const shown = (await host.locator('[data-cell].is-shown').evaluateAll(nodes => nodes.map(node => node.dataset.cell))).sort();
    assert.deepEqual(shown, answers, 'Shown cells are exactly the independently computed heights');
    evidence.push({ interval, name, shown, feedback: text });
    await host.locator('[data-act="finish"]').click(); await host.locator('[data-ck-summary]').waitFor();
    await host.locator('[data-act="again"]').click(); await host.locator('[data-ck-title]').waitFor();
  }
  return evidence;
}, { scope: 'ui' });

check('finishing-active-check-archives-original-attempt-and-new-series-focuses-summary', async ({ page }) => {
  await ready(page);
  const host = await openFormCheck(page, 'name-note');
  const first = await nameNoteQuestion(page);
  await answerChoice(page, first.wrong);
  await host.locator('[data-act="finish"]').click(); await host.locator('[data-ck-summary]').waitFor();
  assert.match(await host.locator('.ck-list').innerText(), /^1\s+Нота [EADG]\/\d+\s+—\s+Без ответа\s+ошибок: 1/);
  // Открытый вопрос с ошибкой, закрытый «Завершить серию», хранится как прерванный, с ошибкой и без верного ответа.
  const before = await waitRaw(page, db => db.history.length === 1 && db.history[0].result.questions[0]?.errors === 1, 'досрочно завершённая серия');
  const original = before.history[0];
  assert.equal(original.result.plannedCount, 6); assert.equal(original.result.questions[0].outcome, 'interrupted'); assert.equal(original.result.questions[0].independentCorrect, false);
  await host.locator('[data-act="again"]').click(); await host.locator('[data-ck-title]').waitFor();
  assert.equal(await checkProgress(page), 'Вопрос 1 из 6');
  for (let index = 0; index < 6; index++) await answerNameNoteCorrectly(page);
  await host.locator('[data-ck-summary]').waitFor();
  assert.ok(await host.locator('[data-ck-summary]').evaluate(summary => summary.contains(document.activeElement)), 'User completion must focus the new summary');
  const after = await waitRaw(page, db => db.history.length === 2 && db.history.some(entry => entry.id !== original.id && entry.result.questions.length === 6 && entry.result.questions.every(question => question.outcome === 'correct')), 'новая серия');
  assert.deepEqual(after.history.find(entry => entry.id === original.id), original, 'The archived attempt is unchanged');
  const next = after.history.find(entry => entry.id !== original.id); assert.equal(next.result.plannedCount, 6);
  return { originalOutcomes: original.result.questions.map(question => question.outcome), oldErrorsPreserved: 1, newPlannedCount: 6, separateIds: [original.id, next.id], summaryFocusedOnCompletion: true };
}, { scope: 'ui' });

check('manual-draft-keeps-old-material-and-merges-new-runs-without-double-counting', async ({ page }) => {
  await ready(page);
  await rhythmBpm(page, 120);
  await playRhythm(page, 650);
  const oldText = 'Заметка к прежнему материалу 120.';
  let box = await openDrafts(page);
  const original = (await rawSnapshot(page)).practiceDrafts.find(item => item.material.kind === 'rhythm');
  assert.ok(original && original.totalReferenceMs > 0);
  const card = box.locator(`[data-draft="${original.id}"]`);
  await card.locator('[data-draft-field="note"]').fill(oldText); await card.locator('[data-draft-field="bpm"]').fill('72');
  await waitRaw(page, db => db.practiceDrafts.find(item => item.id === original.id)?.note === oldText, 'заметка черновика');
  // Другой темп метронома — другой материал: прежняя заметка не переходит к новому черновику.
  await rhythmBpm(page, 100);
  await playRhythm(page, 400);
  box = await openDrafts(page);
  const withTwo = await rawSnapshot(page);
  const other = withTwo.practiceDrafts.find(item => item.material.kind === 'rhythm' && item.id !== original.id);
  assert.ok(other, 'A different tempo starts a separate draft'); assert.equal(other.note, '');
  assert.equal(await box.locator('[data-draft]').count(), 2);
  assert.equal(await box.locator(`[data-draft="${original.id}"] [data-draft-field="note"]`).inputValue(), oldText);
  await box.locator(`[data-draft="${original.id}"] [data-draft-save]`).click();
  const first = await waitRaw(page, db => db.history.length === 1, 'отметка прежнего материала');
  const oldEntry = first.history[0];
  assert.equal(oldEntry.result.note, oldText); assert.equal(oldEntry.result.comfortableBpm, 72); assert.equal(oldEntry.result.material.kind, 'rhythm');
  assert.deepEqual(oldEntry.result.material, original.material, 'The note stays with the material it was written for');
  assert.ok(oldEntry.result.durationMs >= 500 && oldEntry.result.durationMs < 1300, `${oldEntry.result.durationMs}`);
  assert.equal(first.practiceDrafts.find(item => item.id === original.id).recordedThroughMs, oldEntry.result.durationMs);
  // Возврат к тому же материалу: время копится в прежнем черновике, записанное не учитывается дважды.
  await rhythmBpm(page, 120);
  await playRhythm(page, 1400);
  box = await openDrafts(page);
  const newText = 'Новый остаток того же материала 120.';
  const again = box.locator(`[data-draft="${original.id}"]`);
  await again.locator('[data-draft-field="note"]').fill(newText); await again.locator('[data-draft-field="bpm"]').fill('84');
  await again.locator('[data-draft-save]').click();
  const after = await waitRaw(page, db => db.history.length === 2, 'вторая отметка того же материала');
  const newEntry = after.history.find(entry => entry.result.note === newText);
  assert.ok(newEntry); assert.equal(newEntry.result.comfortableBpm, 84); assert.ok(newEntry.result.durationMs >= 1300, `${newEntry.result.durationMs}`);
  const accumulated = after.practiceDrafts.find(item => item.id === original.id);
  assert.equal(accumulated.recordedThroughMs, oldEntry.result.durationMs + newEntry.result.durationMs); assert.equal(accumulated.totalReferenceMs, accumulated.recordedThroughMs);
  assert.deepEqual(after.history.find(entry => entry.id === oldEntry.id), oldEntry);
  assert.ok(after.practiceDrafts.some(item => item.id === other.id && item.totalReferenceMs > 0 && item.recordedThroughMs === 0), 'The other material keeps its own unsaved time');
  return { originalDraftId: original.id, oldEntry: { durationMs: oldEntry.result.durationMs, bpm: 72 }, newEntry: { durationMs: newEntry.result.durationMs, bpm: 84 }, mergedSameMaterial: true, otherMaterialSeparate: other.id };
}, { scope: 'ui' });

check('manual-practice-before-input-survives-reload-without-becoming-history', async ({ page }) => {
  await ready(page);
  await playRhythm(page, 650);
  const before = await rawSnapshot(page); assert.equal(before.history.length, 0);
  const draft = before.practiceDrafts.find(item => item.totalReferenceMs > 0); assert.ok(draft);
  await page.reload(); await ready(page);
  const reopened = await rawSnapshot(page); assert.deepEqual(reopened.practiceDrafts, before.practiceDrafts); assert.equal(reopened.history.length, 0);
  const box = await openDrafts(page);
  await box.locator(`[data-draft="${draft.id}"] [data-draft-field="note"]`).fill('Сохранено после перезапуска');
  await box.locator(`[data-draft="${draft.id}"] [data-draft-save]`).click();
  const after = await waitRaw(page, db => db.history.length === 1, 'отметка после перезапуска');
  assert.equal(after.history[0].result.durationMs, draft.totalReferenceMs); assert.equal(after.history[0].result.material.kind, 'rhythm');
  assert.equal((await exportUi(page)).history.length, 1, 'The UI copy contains the saved mark');
  return { survivedWithoutManualInput: true, historyCreatedOnlyBySave: true, draftId: draft.id, measuredMs: draft.totalReferenceMs };
}, { scope: 'ui' });

check('partial-wrong-answer-survives-reload-without-finish-and-new-session-is-separate', async ({ page }) => {
  await ready(page);
  await openFormCheck(page, 'name-note');
  const question = await nameNoteQuestion(page);
  await answerChoice(page, question.wrong);
  await waitRaw(page, db => db.history.length === 1, 'запись после ошибки');
  // No Finish, Next, kind switch, export or other session-ending action occurs.
  await page.reload(); await ready(page);
  const first = await rawSnapshot(page);
  assert.equal(first.history.length, 1); const original = first.history[0]; const stored = original.result.questions[0];
  assert.equal(stored.outcome, 'interrupted'); assert.equal(stored.errors, 1); assert.equal(stored.skipped, false); assert.equal(stored.independentCorrect, false);
  assert.equal(stored.answerEvents.length, 1); assert.equal(stored.answerEvents[0].correct, false); assert.equal(stored.targetPositionId, question.positionId);
  await openFormCheck(page, 'name-note');
  await answerNameNoteCorrectly(page);
  const second = await waitRaw(page, db => db.history.length === 2, 'новая серия');
  assert.deepEqual(second.history.find(entry => entry.id === original.id), original);
  return { preservedOriginal: { id: original.id, outcome: stored.outcome, errors: stored.errors }, separateHistoryIds: second.history.map(entry => entry.id) };
}, { scope: 'ui' });

check('check-board-stays-bounded-at-narrow-width', async ({ page, resultDir }) => {
  await ready(page);
  await openFormCheck(page, 'find-note');
  const board = checkHost(page).locator('.ck-wrap svg').first();
  const desktop = await board.boundingBox();
  assert.ok(desktop && desktop.height > 0 && desktop.height < 500, `The answer board must not stretch vertically: ${JSON.stringify(desktop)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await board.boundingBox(); assert.ok(narrow && narrow.height < 500);
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth,
    scrollContainers: [...document.querySelectorAll('*')].filter(element => element.scrollWidth > element.clientWidth + 2 && ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)).map(element => ({ className: element.className.baseVal ?? element.className, width: element.clientWidth, content: element.scrollWidth })) }));
  assert.ok(dimensions.page <= dimensions.viewport + 2, `Narrow page overflow escaped the board container: ${JSON.stringify(dimensions)}`);
  await page.screenshot({ path: join(resultDir, 'p6-check-board-narrow.png'), fullPage: true });
  const title = await checkHost(page).locator('[data-ck-title]').innerText();
  const target = /^Найди ([A-G][♯♭]?)$/.exec(title)?.[1]; assert.ok(target, title);
  const pc = (NATURAL_PC[target[0]] + (target.includes('♯') ? 1 : target.includes('♭') ? -1 : 0) + 12) % 12;
  // Ячейки «Найди ноту» по нотам материала: подходит любая позиция ноты, видимая в материале.
  const material = await checkHost(page).evaluate(host => {
    const all = [...host.querySelectorAll('[data-cell]')].map(cell => ({ id: cell.dataset.cell, rect: cell.getBoundingClientRect() }));
    return [...host.querySelectorAll('.ck-wrap svg .mb-ghost')].map(ghost => { const box = ghost.getBoundingClientRect(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
      return all.find(({ rect }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)?.id; });
  });
  const candidates = (material.every(Boolean) && material.length ? material : await cells(page)).filter(id => midiForId(id) % 12 === pc);
  assert.ok(candidates.length, `${target} есть в материале`);
  await checkHost(page).locator(`[data-cell="${candidates[0]}"]`).click();
  assert.match(await feedback(page), /^Верно/);
  return { desktop, narrow, dimensions, target, answered: candidates[0], screenshot: 'test-results/p6-check-board-narrow.png' };
}, { scope: 'ui' });

async function tabTo(page, locator, limit = 200) {
  for (let index = 0; index < limit; index++) {
    if (await locator.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Could not reach ${await locator.getAttribute('aria-label') ?? await locator.innerText()} with Tab`);
}
async function keyboardActivate(page, locator) { await tabTo(page, locator); await page.keyboard.press('Enter'); }
async function keyboardText(page, locator, value) { await tabTo(page, locator); await page.keyboard.press('Control+A'); await page.keyboard.type(String(value)); await page.keyboard.press('Tab'); }
async function keyboardSection(page, section) {
  await keyboardActivate(page, page.locator(`.site-header [data-app-module="${section}"]`));
  await page.waitForFunction(id => document.querySelector(`.site-header [data-app-module="${id}"]`)?.getAttribute('aria-current') === 'page', section);
}

check('keyboard-only-full-practice-survives-browser-reopen-at-stable-origin', async ({ freshPage, closeContext, restartServer, origin, resultDir }) => {
  const first = await freshPage(origin, false, 'keyboard-release-profile'); let expected;
  try {
    const page = first.page; await ready(page);
    await keyboardSection(page, 'foundation');
    await keyboardActivate(page, page.locator('#atlas-check'));
    const host = checkHost(page); await page.locator('[data-lesson-screen="check"]:not([hidden]) [data-ck-title]').waitFor();
    // Смена вида вопроса начинает новую серию и перерисовывает выбор, поэтому к нему возвращаемся Tab перед каждым шагом.
    const kind = host.locator('[data-kind]');
    const kinds = await kind.evaluate(select => [...select.options].map(option => option.value));
    for (let step = 0; step < kinds.length && await kind.inputValue() !== 'name-note'; step++) {
      const previous = await kind.inputValue();
      await tabTo(page, kind); await page.keyboard.press('ArrowDown');
      await page.waitForFunction(value => document.querySelector('[data-lesson-screen="check"] [data-kind]')?.value !== value, previous);
    }
    assert.equal(await kind.inputValue(), 'name-note');
    const question = await nameNoteQuestion(page);
    await keyboardActivate(page, host.locator(`[data-choice="${question.choice}"]`));
    assert.match(await feedback(page), /^Верно, с первой попытки/, 'The independent visible question must match the chosen note');
    await keyboardActivate(page, host.locator('[data-act="finish"]')); await host.locator('[data-ck-summary]').waitFor();
    await keyboardSection(page, 'harmony');
    await keyboardActivate(page, page.locator('[data-rhythm-action="start"]'));
    await page.waitForFunction(() => document.querySelector('.rhythm-view')?.dataset.rhythmState === 'running');
    await untilAudioPlayed(page, 900);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.rhythm-view')?.dataset.rhythmState === 'stopped');
    await keyboardSection(page, 'progress');
    const card = progressPage(page).locator('[data-draft]').first(); await card.waitFor();
    await keyboardText(page, card.locator('[data-draft-field="bpm"]'), 76);
    await keyboardText(page, card.locator('[data-draft-field="note"]'), 'Полный сценарий только клавиатурой.');
    await keyboardActivate(page, card.locator('[data-draft-save]'));
    await waitRaw(page, db => db.history.length === 2, 'две записи');
    await keyboardSection(page, 'settings');
    // Разделы «Настроек» — вертикальные вкладки с перемещением стрелками (фокус только у выбранной).
    await tabTo(page, settingsPage(page).locator('[data-section][aria-selected="true"]'));
    for (let step = 0; step < 5 && await settingsPage(page).locator('[data-section="data"]').getAttribute('aria-selected') !== 'true'; step++) await page.keyboard.press('ArrowDown');
    assert.equal(await settingsPage(page).locator('[data-section="data"]').getAttribute('aria-selected'), 'true');
    await keyboardActivate(page, settingsPage(page).locator('[data-dialog-open="download"]'));
    const exportButton = settingsDialog(page).locator('[data-dlg="export"]');
    await page.waitForFunction(() => document.activeElement?.matches('[data-page-frame="settings"] dialog [data-dlg="export"]'));
    const downloading = page.waitForEvent('download'); await page.keyboard.press('Enter');
    expected = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
    assert.equal(await exportButton.count(), 0);
    assert.equal(expected.history.length, 2);
    const screen = expected.history.find(entry => entry.result.kind === 'screen'); const manual = expected.history.find(entry => entry.result.kind === 'manual');
    assert.equal(screen.result.questions[0].independentCorrect, true); assert.equal(screen.result.questions[0].targetPositionId, question.positionId);
    assert.equal(manual.result.comfortableBpm, 76); assert.ok(manual.result.durationMs > 0); assert.equal(manual.result.material.kind, 'rhythm');
    assert.equal(expected.preferences.activeModule, 'settings');
    await page.screenshot({ path: join(resultDir, 'p6-keyboard-practice.png'), fullPage: true });
  } finally { await closeContext(first.context); }
  const staticServerRestart = await restartServer(); const reopened = await freshPage(origin, false, 'keyboard-release-profile');
  try {
    await ready(reopened.page); assert.equal(await currentSection(reopened.page), 'settings');
    const restored = await exportUi(reopened.page); assert.deepEqual(restored, expected);
    return { allScenarioActionsByKeyboard: true, wholeBrowserRestart: true, staticServerRestart, serverRestart: staticServerRestart, stableOrigin: origin, restoredHistory: restored.history.map(entry => entry.result.kind), screenshot: 'test-results/p6-keyboard-practice.png' };
  } finally { await closeContext(reopened.context); }
}, { scope: 'persistent' });

check('actual-web-lock-prevents-second-writer-and-hands-off-after-close', async ({ page, context, origin }) => {
  await ready(page);
  const lesson = await openSettingsPane(page, 'lesson');
  await lesson.locator('[data-switch="countIn"]').click();
  await openFormCheck(page, 'name-note'); await answerNameNoteCorrectly(page);
  await waitRaw(page, db => db.history.length === 1 && db.preferences.play.countIn === false, 'запись первой вкладки');
  const before = await exportUi(page, { stay: true });
  const second = await context.newPage(); await second.goto(origin);
  await second.waitForFunction(() => document.querySelector('main')?.inert && !document.querySelector('#retry-tab')?.hidden);
  assert.match(await second.locator('#persistence-message').innerText(), /друг.*вклад|открыт.*вклад/i);
  // Тема меняется в шапке и в «Настройках»: кнопки шапки выключены, «Настройки» внутри инертного main.
  const headerThemes = second.locator('.site-header [data-theme-choice]');
  assert.equal(await headerThemes.count(), 2);
  for (const button of await headerThemes.all()) assert.ok(await button.isDisabled(), 'A blocked second writer cannot change the global theme');
  assert.ok(await second.locator('main [data-theme-choice]').evaluateAll(nodes => nodes.length === 2 && nodes.every(node => node.closest('[inert]'))), 'Settings theme cards are unreachable in the blocked tab');
  for (const button of await second.locator('.site-header [data-app-module]').all()) assert.ok(await button.isDisabled(), 'The blocked tab cannot navigate to an editable section');
  assert.deepEqual((await rawSnapshot(page)).profile, (await rawSnapshot(second)).profile, 'Both tabs read the same confirmed profile');
  assert.deepEqual(await exportUi(page, { stay: true }), before, 'Opening the blocked tab must leave the confirmed owner data unchanged');
  const locks = await page.evaluate(async () => (await navigator.locks.query()).held.map(lock => lock.name)); assert.ok(locks.includes('bass-study:writer'));
  await page.close(); await second.locator('#retry-tab').click(); await ready(second);
  assert.equal(await currentSection(second), 'settings');
  for (const button of await second.locator('.site-header [data-theme-choice]').all()) assert.ok(await button.isEnabled());
  assert.equal(await second.locator('main').evaluate(element => element.inert), false);
  const after = await exportUi(second, { stay: true });
  assert.deepEqual(after, before);
  assert.equal(await settingsPage(second).locator('[data-switch="countIn"]').getAttribute('aria-checked'), 'false');
  return { nativeHeldLocks: locks, blockedSecondWriter: true, blockedGlobalProfileControls: true, confirmedOwnerDataUnchanged: true, explicitReloadAfterRelease: true, preservedHistoryIds: after.history.map(entry => entry.id) };
}, { scope: 'ui' });

check('p12-rhythm-draft-retirement-saves-pending-note-before-next-writer', async ({ page, context, origin }) => {
  await ready(page);
  await playRhythm(page, 300);
  const box = await openDrafts(page);
  const before = await rawSnapshot(page);
  const draft = before.practiceDrafts.find(value => value.material.kind === 'rhythm' && value.totalReferenceMs > 0);
  assert.ok(draft); assert.equal(draft.note, '');
  const next = await context.newPage();
  await next.goto(origin);
  await next.waitForFunction(() => document.querySelector('main')?.inert && !document.querySelector('#retry-tab')?.hidden);
  await page.bringToFront();
  await box.locator(`[data-draft="${draft.id}"] [data-draft-field="note"]`).focus();
  const note = 'Черновик перед закрытием';
  await page.evaluate(({ id, note }) => {
    const editor = document.querySelector(`[data-draft="${id}"] [data-draft-field="note"]`);
    editor.value = note;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: note }));
    // Keep the real document alive for IndexedDB while invoking its retirement listener before debounce.
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  }, { id: draft.id, note });
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
  'check-find-interval-accepts-sharp-four-and-flat-five-by-height',
  'revealed-interval-feedback-and-board-use-contextual-enharmonic-names',
  'finishing-active-check-archives-original-attempt-and-new-series-focuses-summary',
  'manual-draft-keeps-old-material-and-merges-new-runs-without-double-counting',
  'check-board-stays-bounded-at-narrow-width',
  'p12-rhythm-draft-retirement-saves-pending-note-before-next-writer',
], FULL_ONLY.smoke);
await runReleaseBrowserChecks(browserCases(checks).checks);
