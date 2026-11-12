import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runEarBrowserChecks } from './helpers/ear-browser-harness.mjs';
import { markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';

// Слух (R-016): fixture проверяет настоящий PCM и live-часы cue; продукт — «Проверь себя» с «+ слух» (P13-05).
const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });
const cueSnapshot = page => page.evaluate(() => window.p7ear.cue.getSnapshot());
const observation = page => page.evaluate(() => window.__earAudioObserved.read());
const near = (actual, expected, tolerance, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}, tolerance ${tolerance}`);

async function fixtureAction(page, name) {
  await page.locator(`#${name}`).click();
  await page.waitForFunction(name => window.p7ear.action?.name === name && window.p7ear.action.done, name);
  assert.equal((await page.evaluate(() => window.p7ear.action)).error, null);
}

for (const fixture of [
  { name: 'C-major-E', root: 'C', quality: 'major', expected: [65.40639132514966, 82.4068892282175], target: 'E' },
  { name: 'A-minor-C', root: 'A', quality: 'minor', expected: [110, 130.8127826502993], target: 'C' },
  { name: 'C-sharp-major-E-sharp', root: 'C#', quality: 'major', expected: [69.29565774421802, 87.30705785825097], target: 'E♯' },
]) check(`pcm-reference-rest-target-${fixture.name}`, 'api', async ({ page }) => {
  const result = await page.evaluate(({ root, quality }) => window.p7ear.render(root, quality), fixture);
  assert.equal(result.channels, 1); assert.equal(result.sampleRate, 44100); near(result.duration, 1.6, 0.0001, 'buffer duration');
  assert.equal(result.onsets.length, 2); near(result.onsets[0], 0, .02, 'reference onset'); near(result.onsets[1], 1, .02, 'target onset');
  near(result.referenceHz, fixture.expected[0], .1, 'reference frequency measured from PCM'); near(result.targetHz, fixture.expected[1], .1, 'target frequency measured from PCM');
  assert.ok(result.referenceRms > .1 && result.targetRms > .1); assert.equal(result.restRms, 0); assert.equal(result.tailRms, 0); assert.equal(result.question.targetName, fixture.target);
  return { expectedHz: fixture.expected, ...result };
});

check('pcm-cue-bass-timbre-has-second-and-third-harmonics', 'api', async ({ page }) => {
  // Чистый синус до E1 (41 Гц) почти не воспроизводится маленькими динамиками; слышимость дают гармоники 2f/3f.
  const results = [];
  for (const midi of [28, 36, 52]) {
    const result = await page.evaluate(midi => window.p7ear.spectrum(midi), midi);
    assert.ok(result.levels[0] > .02, `fundamental present for MIDI ${midi}: ${JSON.stringify(result)}`);
    assert.ok(result.ratios[0] >= .2 && result.ratios[1] >= .12, `2nd/3rd harmonics for MIDI ${midi}: ${JSON.stringify(result)}`);
    assert.ok(result.peak < .9, `headroom for MIDI ${midi}: ${result.peak}`); assert.equal(result.tailRms, 0, 'silence after the release');
    results.push(result);
  }
  return { method: 'renderCueOffline PCM, Hann-window correlation at k·f0; perceived timbre/speaker audibility not inferred', results };
});

check('live-user-gesture-real-signal-and-completion-follow-actual-cue-clock', 'api', async ({ page }) => {
  await fixtureAction(page, 'play'); const started = await cueSnapshot(page); assert.equal(started.state, 'playing'); assert.ok(started.audioTime < started.finishAt);
  await page.waitForFunction(() => window.__earAudioObserved.read().levels.some(level => level.rms > .02));
  const sounding = await observation(page); near(started.finishAt - started.startAt, 1.5, .000001);
  await page.waitForFunction(() => { const state = window.p7ear.cue.getSnapshot(); return state.state === 'playing' && state.audioTime > state.startAt + 1.2; });
  assert.equal(await page.evaluate(() => window.p7ear.completions.length), 0, 'Completion must not fire from a future scheduled note');
  await page.waitForFunction(() => window.p7ear.cue.getSnapshot().state === 'finished'); const finished = await cueSnapshot(page);
  const completions = await page.evaluate(() => window.p7ear.completions); assert.equal(completions.length, 1); assert.ok(completions[0].snapshot.audioTime >= started.finishAt); assert.ok(finished.audioTime >= started.finishAt);
  await delay(100); assert.ok((await observation(page)).levels.every(level => level.rms < .000001));
  return { started, sounding, finished, completions };
});

check('live-stop-in-rest-cancels-future-target-and-completion', 'api', async ({ page }) => {
  await fixtureAction(page, 'play'); const started = await cueSnapshot(page);
  await page.waitForFunction(() => { const state = window.p7ear.cue.getSnapshot(); return state.audioTime > state.startAt + .65 && state.audioTime < state.startAt + 1; });
  await fixtureAction(page, 'stop'); await delay(650); const stopped = await cueSnapshot(page); const signal = await observation(page);
  assert.equal(stopped.state, 'stopped'); assert.equal(await page.evaluate(() => window.p7ear.completions.length), 0); assert.ok(signal.levels.every(level => level.rms < .000001));
  assert.ok(signal.frequencies.some(event => event.time > started.startAt + .9), 'The target really was scheduled in advance before cancellation');
  return { started, stopped, signal, futureTargetCancelled: true };
});

check('live-three-restarts-do-not-complete-cancelled-cues', 'api', async ({ page }) => {
  const runs = [];
  for (let index = 0; index < 3; index++) { await fixtureAction(page, 'play'); runs.push(await cueSnapshot(page)); if (index < 2) { await delay(100); await fixtureAction(page, 'stop'); } }
  await page.waitForFunction(() => window.p7ear.cue.getSnapshot().state === 'finished'); const completions = await page.evaluate(() => window.p7ear.completions);
  assert.equal(new Set(runs.map(run => run.runId)).size, 3); assert.deepEqual(completions.map(event => event.runId), [runs[2].runId]); return { runs, completions };
});

/* ---------- «Проверь себя» с «+ слух» (P13): раздела «Слух» больше нет ---------- */
// Вход — мостик атласа «Проверь себя по этой форме» (по умолчанию A минорная пентатоника). Правильный ответ выводится
// только из наблюдаемых native-вызовов осциллятора (initScript теста): интервал между тоникой и целевым звуком.
// Это наблюдение AudioParam, а не PCM и не API ответа; PCM сигнала проверяют fixture-сценарии выше.

const checkHost = page => page.locator('[data-lesson-screen="check"]');
const DEGREES = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
const normalizeDegree = label => label.trim().replace(/b/g, '♭').replace(/#/g, '♯');
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert);
}
const navigate = (page, section) => page.locator(`.site-header [data-app-module="${section}"]`).click();
async function openEarCheck(page) {
  await ready(page);
  await navigate(page, 'foundation');
  await page.locator('#atlas-check').click();
  await page.locator('[data-lesson-screen="check"]:not([hidden]) [data-ck-title]').waitFor();
  const toggle = checkHost(page).locator('[data-act="toggle-ear"]');
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[data-lesson-screen="check"] [data-act="toggle-ear"]')?.getAttribute('aria-pressed') === 'true');
  await checkHost(page).locator('[data-act="listen"]').waitFor();
}
const choiceLabels = async page => (await checkHost(page).locator('[data-choice] strong').allInnerTexts()).map(normalizeDegree);
const locked = page => checkHost(page).locator('[data-choice]').evaluateAll(list => list.map(button => button.getAttribute('aria-disabled') === 'true'));
const cueText = page => checkHost(page).locator('.ck-cue small').innerText();
const progressLabel = page => checkHost(page).locator('.ck-progress strong').innerText();
async function silent(page, timeout = 3000) {
  await page.waitForFunction(() => window.__earAudioObserved.read().levels.every(level => level.rms < .000001), null, { timeout });
}
/** До ответа в вопросе нет признаков цели: ни атрибутов, ни классов результата; кнопки ступеней различаются только подписью. */
async function assertNoAnswerLeak(page) {
  const scan = await checkHost(page).evaluate(host => {
    const roots = [host.querySelector('[data-ck-question]'), host.querySelector('[data-ck-buttons]'), host.querySelector('[data-ck-feedback]')];
    const problems = [];
    for (const element of roots.flatMap(root => [root, ...root.querySelectorAll('*')])) {
      for (const token of element.classList) if (/^(is-right|is-shown|is-found|is-final|is-correct|ck-st-)/.test(token)) problems.push(`class ${token}`);
      for (const name of element.getAttributeNames()) if (/answer|correct|expected|target|degree|solution|midi|freq/i.test(name)) problems.push(`attribute ${name}`);
      const label = element.getAttribute('aria-label') ?? '';
      if (/(?<![а-яё])верно|показанный ответ/i.test(label)) problems.push(`aria-label ${label}`);
    }
    const shapes = new Set([...host.querySelectorAll('[data-choice]')].map(button => {
      const clone = button.cloneNode(true);
      for (const name of ['data-choice', 'data-key', 'aria-label', 'aria-keyshortcuts']) clone.removeAttribute(name);
      clone.querySelectorAll('strong, kbd').forEach(node => { node.textContent = ''; });
      return clone.outerHTML;
    }));
    return { problems, choiceVariants: shapes.size, cue: host.querySelector('.ck-steps')?.textContent ?? '' };
  });
  assert.deepEqual(scan.problems, [], 'Признаки цели в DOM/ARIA до ответа');
  assert.equal(scan.choiceVariants, 1, 'Кнопки ступеней отличаются не только подписью');
  assert.match(scan.cue, /Нота \?/);
  return scan;
}
/** Начало прослушивания: ответ — интервал между двумя наблюдаемыми частотами native-осцилляторов. */
async function beginListen(page) {
  await page.evaluate(() => window.__earAudioObserved.reset());
  await checkHost(page).locator('[data-act="listen"]').click();
  await page.waitForFunction(() => window.__earAudioObserved.read().frequencies.filter(event => event.frequency > 0).length >= 2);
  const frequencies = (await page.evaluate(() => window.__earAudioObserved.read())).frequencies.filter(event => event.frequency > 0).slice(-2);
  const semitones = Math.round(12 * Math.log2(frequencies[1].frequency / frequencies[0].frequency));
  const degree = DEGREES[((semitones % 12) + 12) % 12];
  const labels = await choiceLabels(page);
  const index = labels.indexOf(degree);
  assert.ok(index >= 0, `Ступень ${degree} (${semitones} пт) нет среди ${labels.join(' ')}: ${JSON.stringify(frequencies)}`);
  return { degree, semitones, index, wrong: labels.findIndex((_, i) => i !== index), frequencies };
}
async function fullListen(page) {
  const oracle = await beginListen(page);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-lesson-screen="check"] [data-choice]')].every(button => button.getAttribute('aria-disabled') !== 'true'), null, { timeout: 6000 });
  return oracle;
}
async function readNative(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('База приложения ещё не создана')); };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = db.transaction('history', 'readonly');
      const request = transaction.objectStore('history').getAll();
      const history = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return { version: db.version, history };
    } finally { db.close(); }
  });
}
async function waitCheckRecord(page, count = 1) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const db = await readNative(page);
    const records = db.history.filter(entry => entry.result?.kind === 'check');
    if (records.length >= count) return { ...db, records };
    assert.ok(Date.now() < deadline, `Запись «Проверь себя» не появилась: ${JSON.stringify(db.history).slice(0, 1000)}`);
    await delay(100);
  }
}
async function finishEarly(page) {
  await checkHost(page).locator('[data-act="finish"]').click();
  await checkHost(page).locator('[data-ck-summary]').waitFor();
  return checkHost(page).locator('[data-ck-summary] .ck-tile').evaluateAll(list => Object.fromEntries(list.map(tile => {
    const token = [...tile.classList].find(name => name.startsWith('ck-st-'));
    return [token ? token.slice(6) : tile.textContent.replace(/\d+/g, '').trim(), Number(tile.querySelector('strong').textContent)];
  })));
}

check('ui-check-ear-answers-locked-until-actual-cue-end-and-first-correct-is-independent', 'ui', async ({ page }) => {
  await openEarCheck(page);
  await assertNoAnswerLeak(page);
  assert.ok((await locked(page)).every(Boolean), 'До прослушивания ответы закрыты');
  // aria-disabled — не disabled: нажатие доходит до экрана и объясняет, почему ответ закрыт.
  await checkHost(page).locator('[data-choice="0"]').click({ force: true });
  assert.match(await checkHost(page).locator('[data-ck-feedback]').innerText(), /Сначала прослушай/);
  const oracle = await beginListen(page);
  assert.ok((await locked(page)).every(Boolean), 'Во время сигнала ответы закрыты');
  await delay(1050);
  assert.ok((await locked(page)).every(Boolean), 'Пока звучит целевая нота, ответы закрыты');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-lesson-screen="check"] [data-choice]')].every(button => button.getAttribute('aria-disabled') !== 'true'), null, { timeout: 6000 });
  await assertNoAnswerLeak(page);
  assert.match(await cueText(page), /Прослушано полностью: 1 · повторов: 0/);
  await checkHost(page).locator(`[data-choice="${oracle.index}"]`).click();
  assert.match(await checkHost(page).locator('[data-ck-feedback]').innerText(), /^Верно, с первой попытки\./);
  const tiles = await finishEarly(page);
  assert.equal(tiles.self, 1);
  const db = await waitCheckRecord(page);
  const answers = db.records[0].result.answers;
  assert.equal(answers.length, 6);
  assert.deepEqual({ ...answers[0], degree: normalizeDegree(answers[0].degree) }, { degree: oracle.degree, outcome: 'correct', errors: 0 });
  assert.ok(answers.slice(1).every(answer => answer.outcome === 'unanswered'));
  return { oracle, tiles, record: { id: db.records[0].id, title: db.records[0].result.title, answers }, databaseVersion: db.version };
});

check('ui-check-ear-replay-error-reveal-and-skip-stay-distinct-outcomes', 'ui', async ({ page }) => {
  await openEarCheck(page);
  // 1 — повтор прослушивания не ошибка и не показ.
  const first = await fullListen(page); const replay = await fullListen(page);
  assert.equal(replay.degree, first.degree);
  assert.match(await cueText(page), /Прослушано полностью: 2 · повторов: 1/);
  await checkHost(page).locator(`[data-choice="${first.index}"]`).click();
  assert.match(await checkHost(page).locator('[data-ck-feedback]').innerText(), /^Верно, с первой попытки\./);
  await checkHost(page).locator('[data-act="next"]').click();
  // 2 — ошибка, затем исправление; ошибка не раскрывает ответ.
  const second = await fullListen(page);
  await checkHost(page).locator(`[data-choice="${second.wrong}"]`).click();
  assert.equal(await checkHost(page).locator(`[data-choice="${second.wrong}"]`).getAttribute('aria-disabled'), 'true');
  assert.equal(await checkHost(page).locator('[data-act="next"]').count(), 0, 'После ошибки вопрос не закрыт');
  await assertNoAnswerLeak(page).catch(error => { if (!/различаются|отличаются/.test(error.message)) throw error; });
  await checkHost(page).locator(`[data-choice="${second.index}"]`).click();
  assert.match(await checkHost(page).locator('[data-ck-feedback]').innerText(), /^Верно, с исправлением \(ошибок: 1\)\./);
  await checkHost(page).locator('[data-act="next"]').click();
  // 3 — показ без прослушивания; 4 — пропуск.
  await checkHost(page).locator('[data-act="reveal"]').click();
  assert.match(await checkHost(page).locator('[data-ck-feedback]').innerText(), /^Ответ показан: .* «показано», не самостоятельно\.$/);
  await checkHost(page).locator('[data-act="next"]').click();
  await checkHost(page).locator('[data-act="skip"]').click();
  assert.equal(await progressLabel(page), 'Вопрос 5 из 6');
  const tiles = await finishEarly(page);
  assert.equal(tiles.self, 1); assert.equal(tiles.fix, 1); assert.equal(tiles.shown, 1); assert.equal(tiles.skip, 1); assert.equal(tiles.none, 2);
  assert.match(await checkHost(page).locator('[data-ck-summary]').innerText(), /Повторов прослушивания/);
  const db = await waitCheckRecord(page);
  const answers = db.records[0].result.answers;
  assert.deepEqual(answers.map(answer => answer.outcome), ['correct', 'corrected', 'revealed', 'skipped', 'unanswered', 'unanswered']);
  assert.deepEqual(answers.map(answer => answer.errors), [0, 1, 0, 0, 0, 0], 'Повтор прослушивания не стал ошибкой');
  assert.deepEqual(answers.slice(0, 2).map(answer => normalizeDegree(answer.degree)), [first.degree, second.degree]);
  return { first: first.degree, second: second.degree, tiles, answers };
});

check('ui-check-ear-stop-and-section-leave-cancel-cue-and-archive-hidden-target', 'ui', async ({ page }) => {
  await openEarCheck(page);
  // Остановка в середине сигнала: звук прекращается, завершения нет, нужен новый полный сигнал.
  await beginListen(page); await delay(200);
  await checkHost(page).locator('[data-act="stop-signal"]').click();
  await silent(page);
  await delay(1500);
  assert.ok((await locked(page)).every(Boolean), 'Остановленный сигнал не открывает ответы');
  assert.match(await cueText(page), /Ответы откроются после конца сигнала/);
  const oracle = await fullListen(page);
  assert.match(await cueText(page), /Прослушано полностью: 1 · повторов: 0 · остановлено: 1/);
  await checkHost(page).locator(`[data-choice="${oracle.index}"]`).click();
  await checkHost(page).locator('[data-act="next"]').click();
  // Уход из раздела во время сигнала: звук отменён, серия архивирована досрочно с прежним материалом.
  await beginListen(page);
  await navigate(page, 'foundation');
  await page.waitForFunction(() => !document.querySelector('[data-page-frame="foundation"]').hidden);
  await silent(page);
  const db = await waitCheckRecord(page);
  const answers = db.records[0].result.answers;
  assert.deepEqual(answers.map(answer => answer.outcome), ['correct', 'unanswered', 'unanswered', 'unanswered', 'unanswered', 'unanswered']);
  // В «Прогрессе» у прерванной записи цель не раскрыта: среди «трудных» нет ступеней вопросов без ответа (R-016).
  await navigate(page, 'progress');
  const frame = page.locator('[data-page-frame="progress"]');
  await frame.locator('[data-tab="calendar"]').click();
  const entry = frame.locator('[data-day-card] .pg-entry.is-check').first();
  await entry.waitFor();
  const text = await entry.innerText();
  assert.match(text, /самостоятельно 1/);
  assert.doesNotMatch(text, /трудные/, `Цели вопросов без ответа видны в «Прогрессе»: ${text}`);
  await frame.locator('[data-tab="exercises"]').click();
  const exercises = await frame.locator('[data-exercises]').textContent();
  assert.doesNotMatch(exercises, /трудные:/);
  return { oracle, archivedAnswers: answers, progressEntry: text };
});

check('native-hidden-tab-cancels-check-cue-and-requires-new-complete-listen', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await openEarCheck(page);
  await beginListen(page);
  const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
  await page.waitForFunction(() => document.hidden, undefined, { polling: 100 });
  await page.waitForFunction(() => /Вкладка скрывалась/.test(document.querySelector('[data-lesson-screen="check"] [data-ck-feedback]')?.textContent ?? '') || /остановлено: 1/.test(document.querySelector('[data-lesson-screen="check"] .ck-cue small')?.textContent ?? ''), undefined, { polling: 100 });
  await silent(page, 6000);
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden, undefined, { polling: 100 });
  await delay(1600);
  assert.ok((await locked(page)).every(Boolean), 'После возврата ответы закрыты до нового полного сигнала');
  const oracle = await fullListen(page);
  assert.match(await cueText(page), /Прослушано полностью: 1 · повторов: 0 · остановлено: 1/);
  await checkHost(page).locator(`[data-choice="${oracle.index}"]`).click();
  await finishEarly(page);
  const db = await waitCheckRecord(page);
  assert.deepEqual({ ...db.records[0].result.answers[0], degree: normalizeDegree(db.records[0].result.answers[0].degree) }, { degree: oracle.degree, outcome: 'correct', errors: 0 });
  await other.close();
  return { oracle, actualDocumentHidden: true, newFullListenRequired: true, databaseVersion: db.version, method: 'Separate Edge/CDP noDefaults:true, real tab activation; readonly native IndexedDB; no synthetic visibility event' };
}));

markFullOnly(checks, ['native-hidden-tab-cancels-check-cue-and-requires-new-complete-listen'], FULL_ONLY.hiddenTab);
markFullOnly(checks, [
  'live-user-gesture-real-signal-and-completion-follow-actual-cue-clock',
  'live-stop-in-rest-cancels-future-target-and-completion',
  'live-three-restarts-do-not-complete-cancelled-cues',
], FULL_ONLY.liveAudio);
markFullOnly(checks, [
  'pcm-reference-rest-target-A-minor-C',
  'pcm-reference-rest-target-C-sharp-major-E-sharp',
  'ui-check-ear-replay-error-reveal-and-skip-stay-distinct-outcomes',
], FULL_ONLY.smoke);
await runEarBrowserChecks(checks);
