import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runTrainingBrowserChecks } from './helpers/training-browser-harness.mjs';

const checks = [];
const check = (name, run) => checks.push({ name, run: async context => {
  const free = context.page.locator('[data-intro="free"]'); if (await free.count() && await free.isVisible()) await free.click();
  return run(context);
} });
const normalize = value => value.replaceAll('♭', 'b').replaceAll('♯', '#');
const action = (page, name) => page.locator(`[data-training-action="${name}"]`);
const answerAt = (page, id) => page.getByTestId('quiz-answer-board').locator(`[data-answer-position="${id}"]`);
const feedback = page => page.getByTestId('quiz-feedback');
async function studySettings(page) { if (!await page.locator('#study-settings').isVisible()) await page.locator('#toggle-study-settings').click(); }
async function disclose(page, selector) {
  const details = page.locator(selector);
  if (await details.locator('xpath=ancestor::*[@id="study-settings"]').count()) await studySettings(page);
  if (await details.count() && !await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
}

async function range(page, first, last) {
  await disclose(page, '#area-settings');
  const min = page.getByLabel('Первый лад', { exact: true });
  const max = page.getByLabel('Последний лад', { exact: true });
  await max.fill('24'); await max.press('Tab');
  await min.fill(String(first)); await min.press('Tab');
  await max.fill(String(last)); await max.press('Tab');
}

async function strings(page, enabled) {
  await disclose(page, '#area-settings');
  for (const string of ['E', 'A', 'D', 'G']) {
    await page.getByRole('checkbox', { name: `Струна ${string}`, exact: true }).setChecked(enabled.includes(string));
  }
}

async function configure(page, {
  mode = 'name-note', count = 1, scope = 'structure', first = 0, last = 0,
  enabled = ['E'], tonic = 'A', structure = 'minor-pentatonic',
} = {}) {
  await studySettings(page);
  await page.getByLabel('Тоника', { exact: true }).selectOption(tonic);
  await page.getByLabel('Структура', { exact: true }).selectOption(structure);
  await range(page, first, last);
  await strings(page, enabled);
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  await page.getByLabel('Тип задания', { exact: true }).selectOption(mode);
  await disclose(page, '[data-training-details="quiz"]');
  const scopeSelect = page.getByLabel('Материал заданий', { exact: true });
  if (mode !== 'find-degree' && mode !== 'find-interval') await scopeSelect.selectOption(scope);
  const countInput = page.getByLabel('Количество вопросов', { exact: true });
  await countInput.fill(String(count));
  await countInput.press('Tab');
}

async function start(page) {
  await action(page, 'start').click();
  await page.getByTestId('quiz-question').waitFor({ state: 'visible' });
}

async function finishQuestion(page) {
  await action(page, 'next').click();
  await page.getByTestId('quiz-summary').waitFor({ state: 'visible' });
}

async function summary(page) {
  const panel = page.getByTestId('quiz-summary');
  const result = {};
  for (const key of ['independentCorrect', 'corrected', 'errors', 'hints', 'skipped']) {
    result[key] = Number(await panel.locator(`[data-result="${key}"]`).innerText());
  }
  const text = await panel.innerText();
  const match = /Завершено\s+(\d+)\s+из\s+(\d+)/i.exec(text);
  assert.ok(match, `Summary has no visible completion count: ${text}`);
  result.completed = Number(match[1]);
  result.total = Number(match[2]);
  assert.match(text, /экран|проверки знаний/i);
  assert.match(text, /не оценка|не.*игр/i);
  return result;
}

function expectSummary(actual, expected) {
  assert.deepEqual(actual, { independentCorrect: 0, corrected: 0, errors: 0, hints: 0, skipped: 0, completed: 1, total: 1, ...expected });
}

check('six-quiz-modes-and-default-session-length', async ({ page }) => {
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  assert.deepEqual(await page.getByLabel('Тип задания', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['name-note', 'find-note', 'find-all', 'find-degree', 'find-pitch', 'find-interval']);
  assert.equal(await page.getByLabel('Количество вопросов', { exact: true }).inputValue(), '10');
  assert.match(await page.getByTestId('training-content').innerText(), /на экране|экран/i);
  assert.equal(await page.getByTestId('quiz-question').count(), 0);
  return { modes: 6, defaultCount: 10, startsExplicitly: true };
});

check('name-note-first-correct-answer-is-independent', async ({ page }) => {
  await configure(page);
  await start(page);
  assert.match(await page.getByTestId('quiz-prompt').innerText(), /струна E, лад 0/);
  assert.equal(await answerAt(page, 'E:0').getAttribute('role'), null, 'Marked position is a question, not the answer control in name-note mode');
  assert.equal(await page.locator('[data-choice]').count(), 12);
  await page.getByRole('button', { name: 'E', exact: true }).click();
  assert.match(await feedback(page).innerText(), /Верно/);
  await finishQuestion(page);
  const value = await summary(page);
  expectSummary(value, { independentCorrect: 1 });
  return value;
});

check('wrong-position-then-correction-keeps-first-attempt-error', async ({ page }) => {
  await configure(page, { mode: 'find-note', last: 1 });
  await start(page);
  assert.equal((await page.getByTestId('quiz-target').innerText()).trim(), 'E');
  await answerAt(page, 'E:1').click();
  assert.match(await feedback(page).innerText(), /не подходит/);
  assert.equal(await action(page, 'next').count(), 0);
  await answerAt(page, 'E:0').click();
  assert.match(await feedback(page).innerText(), /Верно/);
  await finishQuestion(page);
  const value = await summary(page);
  expectSummary(value, { corrected: 1, errors: 1 });
  return value;
});

check('shown-answer-is-not-independent-correct', async ({ page }) => {
  await configure(page, { mode: 'find-note' });
  await start(page);
  await action(page, 'hint').click();
  assert.match(await feedback(page).innerText(), /Ответ: E/);
  assert.match(await feedback(page).innerText(), /не считается самостоятельным/);
  assert.equal(await action(page, 'hint').isDisabled(), true);
  await finishQuestion(page);
  const value = await summary(page);
  expectSummary(value, { hints: 1 });
  return value;
});

check('skipped-question-is-counted-separately', async ({ page }) => {
  await configure(page, { mode: 'find-note' });
  await start(page);
  await action(page, 'skip').click();
  assert.match(await feedback(page).innerText(), /пропущено/i);
  await finishQuestion(page);
  const value = await summary(page);
  expectSummary(value, { skipped: 1 });
  return value;
});

check('find-all-uses-visible-target-and-ignores-duplicate-selection', async ({ page }) => {
  await configure(page, { mode: 'find-all', scope: 'chromatic', last: 24 });
  await start(page);
  const target = normalize((await page.getByTestId('quiz-target').innerText()).trim());
  const classes = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  assert.ok(Object.hasOwn(classes, target), `Unknown visible target ${target}`);
  // Independent E-string pitch-class reference, including two complete octaves.
  const reference = [4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4];
  const expected = reference.flatMap((pitch, fret) => pitch === classes[target] ? [`E:${fret}`] : []);
  assert.ok(expected.length >= 2);
  await answerAt(page, expected[0]).click();
  const partial = await page.locator('.quiz-rule').innerText();
  assert.match(partial, new RegExp(`Найдено 1 из ${expected.length}`));
  await answerAt(page, expected[0]).click();
  assert.match(await feedback(page).innerText(), /уже найдена/);
  assert.equal(await page.locator('.quiz-rule').innerText(), partial);
  for (const id of expected.slice(1)) await answerAt(page, id).click();
  assert.match(await feedback(page).innerText(), /Все позиции найдены/);
  await finishQuestion(page);
  const value = await summary(page);
  expectSummary(value, { independentCorrect: 1 });
  return { visibleTarget: target, expectedPositions: expected, duplicateIgnored: true, summary: value };
});

check('degree-question-uses-tonic-and-structure-context', async ({ page }) => {
  await configure(page, { mode: 'find-degree', tonic: 'C', structure: 'major' });
  assert.equal(await page.getByLabel('Материал заданий', { exact: true }).inputValue(), 'structure');
  assert.equal(await page.getByLabel('Материал заданий', { exact: true }).isDisabled(), true);
  await start(page);
  assert.match(await page.getByTestId('quiz-prompt').innerText(), /ступень 3 от C/);
  assert.equal(await page.getByTestId('quiz-target').count(), 0, 'Degree question does not expose its note name as a target badge');
  await answerAt(page, 'E:0').click();
  await finishQuestion(page);
  const value = await summary(page);
  expectSummary(value, { independentCorrect: 1 });
  return { degree: '3', tonic: 'C', position: 'E:0', summary: value };
});

check('empty-string-filter-does-not-create-impossible-question', async ({ page }) => {
  await configure(page, { mode: 'find-note', enabled: [] });
  await action(page, 'start').click();
  assert.equal(await page.getByTestId('quiz-question').count(), 0);
  assert.equal(await page.getByTestId('training-error').isVisible(), true);
  assert.match(await page.getByTestId('training-error').innerText(), /нет подходящих нот|област/i);
  return { questionsCreated: 0, errorExplainsScope: true };
});

check('empty-structure-intersection-explains-how-to-recover', async ({ page }) => {
  await configure(page, { mode: 'find-note', first: 1, last: 1 });
  await action(page, 'start').click();
  assert.equal(await page.getByTestId('quiz-question').count(), 0);
  assert.match(await page.getByTestId('training-error').innerText(), /нет подходящих нот|струны|структур/i);
  await page.getByLabel('Материал заданий', { exact: true }).selectOption('chromatic');
  await start(page);
  assert.equal((await page.getByTestId('quiz-target').innerText()).trim(), 'F');
  await answerAt(page, 'E:1').click();
  await finishQuestion(page);
  expectSummary(await summary(page), { independentCorrect: 1 });
  return { excludedFInMinorPentatonic: true, chromaticScopeRecovered: 'F' };
});

check('invalid-range-ends-session-and-cannot-use-stale-valid-context', async ({ page }) => {
  await configure(page, { mode: 'find-note' });
  await start(page);
  const min = page.getByLabel('Первый лад', { exact: true });
  await min.fill('1'); await min.press('Tab');
  assert.equal(await page.getByTestId('range-error').isVisible(), true);
  assert.equal(await page.getByTestId('quiz-question').count(), 0);
  await action(page, 'start').click();
  assert.equal(await page.getByTestId('training-error').isVisible(), true);
  assert.equal(await page.getByTestId('quiz-question').count(), 0);
  await min.fill('0'); await min.press('Tab');
  await start(page);
  assert.equal((await page.getByTestId('quiz-target').innerText()).trim(), 'E');
  return { invalidInputCannotReuseOldContext: true, recoveredTarget: 'E' };
});

check('configuration-change-ends-old-session-without-mixing-contexts', async ({ page }) => {
  await configure(page, { mode: 'find-note' });
  await start(page);
  await page.getByLabel('Тоника', { exact: true }).selectOption('E');
  assert.equal(await page.getByTestId('quiz-question').count(), 0);
  assert.match(await page.getByTestId('training-content').innerText(), /Параметры изменились/);
  const previous = await summary(page);
  expectSummary(previous, { completed: 0 });
  await start(page);
  assert.equal((await page.getByTestId('quiz-target').innerText()).trim(), 'E');
  await answerAt(page, 'E:0').click();
  await finishQuestion(page);
  const value = await summary(page);
  expectSummary(value, { independentCorrect: 1 });
  return { oldCompleted: 0, newContextIndependent: true, summary: value };
});

check('study-map-is-hidden-during-quiz-and-mode-change-ends-session', async ({ page }) => {
  await configure(page, { mode: 'find-note' });
  await start(page);
  assert.equal(await page.getByTestId('fretboard').isVisible(), false);
  assert.equal(await page.locator('.structure-summary').isVisible(), false);
  assert.equal(await page.locator('.selection-section').isVisible(), false);
  const exposed = await page.getByTestId('quiz-answer-board').locator('[data-answer-position]').evaluateAll(nodes => nodes.map(node => ({
    label: node.getAttribute('aria-label'), name: node.getAttribute('data-note-name'), midi: node.getAttribute('data-midi'),
  })));
  for (const item of exposed) {
    assert.equal(item.name, null);
    assert.equal(item.midi, null);
    assert.doesNotMatch(item.label, /MIDI|Гц|[A-G][♯♭]?-?\d/i);
  }
  await page.getByRole('button', { name: 'Изучение', exact: true }).click();
  assert.equal(await page.getByTestId('fretboard').isVisible(), true);
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  assert.equal(await page.getByTestId('quiz-question').count(), 0);
  const value = await summary(page);
  expectSummary(value, { completed: 0 });
  assert.equal(await action(page, 'next').count(), 0);
  return { studyHiddenWhileAnswering: true, noAnswerMetadataInBoard: true, oldSessionCompleted: 0, summary: value };
});

check('keyboard-can-answer-the-quiz-without-study-selection', async ({ page }) => {
  await configure(page, { mode: 'find-note' });
  await start(page);
  const position = answerAt(page, 'E:0');
  await position.focus();
  await page.keyboard.press('Enter');
  assert.match(await feedback(page).innerText(), /Верно/);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-training-action')), 'next');
  await page.keyboard.press('Enter');
  const value = await summary(page);
  expectSummary(value, { independentCorrect: 1 });
  return { answerPosition: 'E:0', nextFocusedAfterAnswer: true, summary: value };
});

check('question-progress-and-final-summary-archive-each-result-once', async ({ page }) => {
  await configure(page, { mode: 'find-note', count: 2 });
  await start(page);
  assert.match(await page.locator('.quiz-progress').innerText(), /Вопрос 1 из 2/);
  await answerAt(page, 'E:0').click();
  await action(page, 'next').click();
  assert.match(await page.locator('.quiz-progress').innerText(), /Вопрос 2 из 2/);
  await action(page, 'skip').click();
  await finishQuestion(page);
  const value = await summary(page);
  expectSummary(value, { independentCorrect: 1, skipped: 1, completed: 2, total: 2 });
  return value;
});

check('four-sequence-patterns-match-independent-position-routes', async ({ page }) => {
  await range(page, 0, 3);
  await strings(page, ['E']);
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  await page.getByLabel('Материал последовательности', { exact: true }).selectOption('chromatic');
  const fixtures = [
    ['ascending', ['E:0', 'E:1', 'E:2', 'E:3']],
    ['descending', ['E:3', 'E:2', 'E:1', 'E:0']],
    ['round-trip', ['E:0', 'E:1', 'E:2', 'E:3', 'E:2', 'E:1']],
    ['groups-of-three', ['E:0', 'E:1', 'E:2', 'E:1', 'E:2', 'E:3']],
  ];
  for (const [pattern, expected] of fixtures) {
    await page.getByLabel('Порядок последовательности', { exact: true }).selectOption(pattern);
    const actual = await page.getByTestId('sequence-route').locator('[data-sequence-position]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-sequence-position')));
    assert.deepEqual(actual, expected, pattern);
  }
  return { fixtures: fixtures.map(([pattern, route]) => ({ pattern, route })) };
});

check('sequence-deduplicates-height-and-uses-stable-string-priority', async ({ page }) => {
  await studySettings(page); await page.getByLabel('Тоника', { exact: true }).selectOption('C');
  await page.getByLabel('Структура', { exact: true }).selectOption('major');
  await range(page, 0, 5);
  await strings(page, ['E', 'A']);
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  const actual = await page.getByTestId('sequence-route').locator('[data-sequence-position]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-sequence-position')));
  const expected = ['E:0', 'E:1', 'E:3', 'E:5', 'A:2', 'A:3', 'A:5'];
  assert.deepEqual(actual, expected);
  assert.ok(!actual.includes('A:0'), 'A1 uses E:5 once rather than duplicating the equal A:0 height');
  assert.equal(await page.getByTestId('sequence-count').innerText(), '7 нот');
  return { expectedRoute: expected, equalHeightExcluded: 'A:0' };
});

check('insufficient-sequence-explains-restriction-without-placeholder-player', async ({ page }) => {
  await range(page, 0, 0);
  await strings(page, ['E']);
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  await page.getByLabel('Порядок последовательности', { exact: true }).selectOption('groups-of-three');
  assert.equal(await page.getByTestId('sequence-error').isVisible(), true);
  assert.equal(await page.getByTestId('sequence-route').count(), 0);
  assert.equal(await page.getByRole('button', { name: /Играть|Воспроизвести|Слушать/ }).count(), 0);
  return { insufficientGroupsReported: true, audioControlsNotClaimed: true };
});

async function selectCompactC(page) {
  await disclose(page, '#area-settings');
  await page.getByLabel('Тоника', { exact: true }).selectOption('C');
  await page.getByLabel('Структура', { exact: true }).selectOption('major-triad');
  const box = page.getByLabel('Учебная форма', { exact: true });
  const value = await box.locator('option').evaluateAll(nodes => nodes.find(node => /Тоника C · лад 8 · E$/.test(node.textContent))?.value);
  assert.ok(value, 'The public catalogue must explicitly name tonic C and fret8'); await box.selectOption(value);
}

check('selected-form-controls-exact-question-and-sequence-positions', async ({ page }) => {
  await selectCompactC(page);
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  await page.getByLabel('Тип задания', { exact: true }).selectOption('find-note');
  assert.ok(await page.getByLabel('Материал заданий', { exact: true }).isDisabled());
  await start(page);
  const ids = await page.getByTestId('quiz-answer-board').locator('[data-answer-position]').evaluateAll(nodes => nodes.map(node => node.dataset.answerPosition));
  assert.deepEqual([...ids].sort(), ['A:10', 'A:7', 'D:10', 'E:8']);
  assert.deepEqual(await page.getByTestId('quiz-answer-board').locator('.answer-string-name').allTextContents(), ['G', 'D', 'A', 'E']);
  const names = { C: 'E:8', E: 'A:7', G: 'A:10' };
  const prompt = await page.getByTestId('quiz-prompt').innerText(); const target = /Найдите ноту ([A-G])/.exec(prompt)?.[1]; assert.ok(names[target]);
  await answerAt(page, names[target]).click(); assert.match(await feedback(page).innerText(), /Верно/);
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  const route = await page.getByTestId('sequence-route').locator('[data-sequence-position]').evaluateAll(nodes => nodes.map(node => node.dataset.sequencePosition));
  assert.deepEqual(route, ['E:8', 'A:7', 'A:10', 'D:10']);
  assert.ok(await page.getByLabel('Материал последовательности', { exact: true }).isDisabled());
  return { questionPositions: ids, sequencePositions: route, answerChosenFromVisiblePrompt: target };
});

check('answer-board-keeps-four-lettered-strings-when-only-E-is-available', async ({ page }) => {
  await configure(page, { mode: 'find-note' }); await start(page);
  assert.deepEqual(await page.getByTestId('quiz-answer-board').locator('.answer-string-name').allTextContents(), ['G', 'D', 'A', 'E']);
  const ids = await page.getByTestId('quiz-answer-board').locator('[data-answer-position]').evaluateAll(nodes => nodes.map(node => node.dataset.answerPosition));
  assert.deepEqual(ids, ['E:0']);
  return { visibleStrings: ['G', 'D', 'A', 'E'], enabledPositions: ids, unusedRowsEmpty: true };
});

check('interval-explicitly-uses-full-chromatic-range-and-keeps-spelling', async ({ page }) => {
  await selectCompactC(page); await page.getByRole('button', { name: 'Задания', exact: true }).click();
  await page.getByLabel('Тип задания', { exact: true }).selectOption('find-interval');
  await disclose(page, '[data-training-details="quiz"]');
  await page.getByRole('combobox', { name: 'Интервал от тоники', exact: true }).selectOption('b5');
  assert.match(await page.getByTestId('training-content').innerText(), /хроматические позиции|бокса временно отключены/);
  await start(page); const ids = await page.getByTestId('quiz-answer-board').locator('[data-answer-position]').evaluateAll(nodes => nodes.map(node => node.dataset.answerPosition));
  assert.ok(ids.includes('A:9') && ids.length > 4, 'F-sharp/G-flat A9 is outside the exact triad form but inside the chromatic rectangle');
  await action(page, 'hint').click(); assert.match(await feedback(page).innerText(), /G♭/);
  assert.equal(await answerAt(page, 'A:9').locator('text').textContent(), 'G♭');
  return { fullRangeCount: ids.length, shownName: 'G♭', outsideFormPosition: 'A:9' };
});

check('advanced-and-route-disclosures-keep-user-state-through-renders', async ({ page }) => {
  await configure(page, { mode: 'find-note' });
  const advanced = page.locator('[data-training-details="quiz"]'); assert.ok(await advanced.evaluate(element => element.open));
  await page.getByLabel('Тип задания', { exact: true }).selectOption('find-pitch'); assert.ok(await advanced.evaluate(element => element.open));
  await start(page); await advanced.locator('summary').click(); assert.equal(await advanced.evaluate(element => element.open), false);
  await action(page, 'hint').click(); assert.equal(await advanced.evaluate(element => element.open), false);
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  const route = page.locator('[data-training-details="sequence"]'); assert.equal(await route.evaluate(element => element.open), false);
  await route.locator('summary').click(); await page.getByLabel('Порядок последовательности', { exact: true }).selectOption('descending');
  assert.equal(await route.evaluate(element => element.open), true);
  return { advancedPreservedOpenThenClosed: true, routePreviewPreservedOpen: true };
});

check('training-loads-locally-without-runtime-errors', async ({ page, resultDir, externalRequests, pageErrors }) => {
  await configure(page, { mode: 'find-all', scope: 'chromatic', last: 12 });
  await start(page);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: join(resultDir, 'p3-quiz-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Последовательности', exact: true }).click();
  await page.screenshot({ path: join(resultDir, 'p3-sequence-desktop.png'), fullPage: true });
  assert.deepEqual(pageErrors, []);
  return { externalApplicationRequests: 0, pageErrors: [], screenshots: ['p3-quiz-desktop.png', 'p3-sequence-desktop.png'] };
});

await runTrainingBrowserChecks(checks);
