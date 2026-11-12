// Задания R-006 и последовательности после P13-08 («Гриф» — атлас): мостики «Сыграть эту форму» и «Проверь себя
// по этой форме», виды вопросов «Проверь себя», шаблоны последовательностей на экране игры и «Повторить» из «Прогресса».
// Ступени «Проверь себя» по шагу плана и экран игры по плану проверяет `p13-browser.mjs`; здесь — виды R-006 и мостики.
import assert from 'node:assert/strict';
import { markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';
import {
  answerLeakScan, answerPhrase, assertNoLeak, atlasMaterial, atlasRange, bridgeToCheck, bridgeToPlay, byPosition, checkHost,
  chooseKind, chromaticArea, disclose, feedbackText, finishSeries, materialPositions, midiOf, navigate, openApp, openAtlas, pitchClass,
  playScene, positionClass, positionMidi, progressLabel, questionSub, questionTitle, readDb, runTrainingBrowserChecks, screenEntries,
  section, semitonesOf, summaryTiles, waitDb,
} from './helpers/training-browser-harness.mjs';

const checks = [];
const check = (name, run) => checks.push({ name, scope: 'ui', run });

// Независимый материал формы A минорной пентатоники от A (лады 5–8): ноты A C D E G на строе E–A–D–G.
const A_MINOR_FORM_A = ['E:5', 'E:8', 'A:5', 'A:7', 'D:5', 'D:7', 'G:5', 'G:7'];
const ascendingByPitch = ids => [...ids].sort((a, b) => positionMidi(a) - positionMidi(b) || byPosition(a, b));
const host = page => checkHost(page);
const cell = (page, id) => host(page).locator(`[data-cell="${id}"]`);
const next = page => host(page).locator('[data-act="next"]').click();

/**
 * Маршрут по TAB экрана игры: вид «TAB» показывает страницу из двух тактов и следующую страницу; позиции — по номеру
 * события (`data-index`), номер струны и лада — из подписи TAB.
 */
async function tabRoute(page) {
  await playScene(page).locator('[data-view="tab"]').click();
  await playScene(page).locator('[data-view="tab"][aria-pressed="true"]').waitFor();
  const events = await playScene(page).evaluate(scene => [...scene.querySelectorAll('[data-tab="tab"] text.pl-tab-fret, [data-tab="tab-next"] text.pl-tab-fret')]
    .map(text => ({ index: Number(text.dataset.index), id: `${text.dataset.string}:${text.textContent}` })));
  return [...new Map(events.map(event => [event.index, event])).values()].sort((a, b) => a.index - b.index);
}
/** Вопрос «Найди …»: искомое из текста вопроса, ответы — независимый расчёт по видимым контурам материала. */
async function findQuestion(page, positions) {
  const title = (await questionTitle(page)).trim();
  const note = /^Найди (?:все )?([A-G][♯♭#b]?)(?:\s|$)/.exec(title)?.[1];
  assert.ok(note, `Вопрос не распознан: ${title}`);
  const answers = positions.filter(id => positionClass(id) === pitchClass(note)).sort(byPosition);
  const wrong = positions.filter(id => !answers.includes(id));
  assert.ok(answers.length > 0, `В материале ${positions.join(' ')} нет ${note}`);
  return { title, note, answers, wrong };
}
/** Вопрос «Назови ноту»: отмеченная позиция из текста вопроса, верная карточка — по классу высоты. */
async function nameQuestion(page) {
  const sub = await questionSub(page);
  const position = /Отмеченная позиция — ([EADG])\/(\d+)\./.exec(sub);
  assert.ok(position, `Вопрос не распознан: ${sub}`);
  const id = `${position[1]}:${position[2]}`;
  const labels = await host(page).locator('[data-choice] strong').allInnerTexts();
  const matches = labels.map((label, index) => [label, index]).filter(([label]) => pitchClass(label) === positionClass(id));
  assert.equal(matches.length, 1, `Ровно одна карточка класса высоты ${id}: ${labels.join(' ')}`);
  const index = matches[0][1];
  return { id, labels, index, wrong: labels.findIndex((_, i) => i !== index) };
}
async function answerNameQuestion(page, { wrongFirst = false } = {}) {
  const question = await nameQuestion(page);
  if (wrongFirst) await host(page).locator(`[data-choice="${question.wrong}"]`).click();
  await host(page).locator(`[data-choice="${question.index}"]`).click();
  return question;
}

check('atlas-bridges-open-exact-form-on-play-and-check-screens-and-return-to-atlas', async ({ page, origin }) => {
  await openApp(page, origin);
  await openAtlas(page);
  assert.match(await page.locator('#box-select option:checked').innerText(), /^Форма A/);
  assert.equal(await page.locator('#atlas-bridge-note').innerText(), '', 'Нижний экземпляр формы — без пояснения');

  await bridgeToPlay(page);
  assert.equal(await playScene(page).locator('[data-title]').innerText(), 'Форма пентатоники вверх-вниз');
  assert.equal(await playScene(page).locator('[data-back]').innerText(), '← Гриф');
  const route = await tabRoute(page);
  const up = ascendingByPitch(A_MINOR_FORM_A);
  // Вверх по высоте формы и обратно; верх и нижняя тоника не повторяются, чтобы проход по кругу шёл без двойных нот.
  assert.deepEqual(route.map(item => item.id), [...up, ...up.slice(1, -1).reverse()], 'Вверх по форме и обратно — независимый порядок высот');
  assert.match(await playScene(page).locator('[data-sub]').innerText(), new RegExp(`^${route.length} восьм`), 'На TAB весь проход упражнения');
  assert.deepEqual(route.map(item => item.index), route.map((_, index) => index));
  await playScene(page).locator('[data-back]').click();
  assert.equal(await section(page), 'foundation');
  assert.equal(await page.locator('[data-lesson-screen="play"]').isHidden(), true);
  assert.match(await page.locator('#box-select option:checked').innerText(), /^Форма A/, 'Возврат не меняет форму атласа');

  await bridgeToCheck(page);
  assert.equal(await host(page).locator('h1').innerText(), 'Проверь себя: найди ступень на грифе');
  assert.equal(await host(page).locator('[data-act="back"]').innerText(), '← Гриф');
  assert.deepEqual(await materialPositions(page), [...A_MINOR_FORM_A].sort(byPosition), 'Контуры — точные позиции формы');
  const kinds = await host(page).locator('select[data-kind] option').evaluateAll(options => options.map(option => [option.value, option.textContent]));
  assert.deepEqual(kinds, [['find-degree', 'Найди ступень'], ['name-degree', 'Назови ступень'], ['find-note', 'Найди ноту'], ['find-all', 'Найди все позиции'],
    ['name-note', 'Назови ноту'], ['find-pitch', 'Найди высоту'], ['find-interval', 'Найди интервал']]);
  await host(page).locator('[data-act="back"]').click();
  assert.equal(await section(page), 'foundation');
  assert.equal(screenEntries(await readDb(page)).length, 0, 'Открытая без ответа серия не пишет запись');
  return { playRoute: route.map(item => item.id), checkMaterial: A_MINOR_FORM_A, kinds: kinds.map(([id]) => id) };
});

check('find-note-first-answer-correction-reveal-skip-keyboard-and-one-screen-record', async ({ page, origin }) => {
  await openApp(page, origin); await openAtlas(page); await bridgeToCheck(page);
  await chooseKind(page, 'find-note');
  assert.equal(await host(page).locator('h1').innerText(), 'Проверь себя: найди ноту');
  const positions = await materialPositions(page);
  const asked = [];

  // 1 — самостоятельно с первой попытки.
  let question = await findQuestion(page, positions);
  let scan = await answerLeakScan(page); assertNoLeak(scan, 'board');
  await cell(page, question.answers[0]).click();
  let feedback = await feedbackText(page);
  assert.match(feedback, /^Верно, с первой попытки\./);
  assert.ok(!scan.html.includes(answerPhrase(feedback)), 'Фразы ответа не было в документе до ответа');
  asked.push({ ...question, outcome: 'first' }); await next(page);

  // 2 — ошибка, затем исправление: первая попытка остаётся ошибкой.
  question = await findQuestion(page, positions);
  scan = await answerLeakScan(page); assertNoLeak(scan, 'board');
  await cell(page, question.wrong[0]).click();
  assert.match(await feedbackText(page), new RegExp(`^${question.wrong[0].replace(':', '/')} — это [A-G][♯♭]?, не ${question.note}\\.`));
  assert.deepEqual((await answerLeakScan(page)).problems, [], 'Ошибка не раскрывает ответ');
  await cell(page, question.wrong[0]).click();
  assert.match(await feedbackText(page), /уже проверена — это не ответ/, 'Повтор ошибки не считается второй ошибкой');
  await cell(page, question.answers[0]).click();
  assert.match(await feedbackText(page), /^Верно, с исправлением \(ошибок: 1\)\./);
  asked.push({ ...question, outcome: 'corrected' }); await next(page);

  // 3 — показ: подсвечены ровно независимо вычисленные позиции.
  question = await findQuestion(page, positions);
  scan = await answerLeakScan(page); assertNoLeak(scan, 'board');
  await host(page).locator('[data-act="reveal"]').click();
  feedback = await feedbackText(page);
  assert.match(feedback, /^Ответ показан: .* В итоге — «показано», не самостоятельно\.$/);
  assert.ok(!scan.html.includes(answerPhrase(feedback)));
  assert.deepEqual((await host(page).locator('[data-cell].is-shown').evaluateAll(cells => cells.map(item => item.dataset.cell))).sort(byPosition), question.answers);
  asked.push({ ...question, outcome: 'revealed' }); await next(page);

  // 4 — пропуск сразу ведёт дальше.
  asked.push({ ...await findQuestion(page, positions), outcome: 'skipped' });
  await host(page).locator('[data-act="skip"]').click();
  assert.equal(await progressLabel(page), 'Вопрос 5 из 6');

  // 5 — ответ клавиатурой: фокус на позиции, Enter.
  question = await findQuestion(page, positions);
  await cell(page, question.answers[0]).focus();
  await page.keyboard.press('Enter');
  assert.match(await feedbackText(page), /^Верно, с первой попытки\./);
  asked.push({ ...question, outcome: 'keyboard' });
  await page.keyboard.press('Enter');
  assert.equal(await progressLabel(page), 'Вопрос 6 из 6', 'Enter после ответа ведёт к следующему вопросу');

  // 6 — досрочное завершение: вопрос без ответа.
  await finishSeries(page);
  assert.deepEqual(await summaryTiles(page), { self: 2, fix: 1, err: 1, shown: 1, skip: 1, none: 1 });
  assert.equal(await host(page).locator('[data-act="next-step"]').innerText(), 'Вернуться к грифу →');

  // Незаданный шестой вопрос без попыток в запись не входит: сохраняются закрытые и начатые вопросы.
  const db = await waitDb(page, db => screenEntries(db).some(entry => entry.result.questions.length === 5), 'экранная запись серии');
  const entries = screenEntries(db);
  assert.equal(entries.length, 1, 'Одна запись на серию');
  const { result } = entries[0];
  assert.equal(result.mode, 'find-note'); assert.equal(result.plannedCount, 6);
  assert.equal(result.context.root, 'A'); assert.equal(result.context.structureId, 'minor-pentatonic');
  assert.deepEqual([...result.context.positionIds].sort(byPosition), positions, 'Контекст записи — материал формы');
  assert.deepEqual(result.questions.map(item => item.independentCorrect), [true, false, false, false, true]);
  assert.deepEqual(result.questions.map(item => item.errors), [0, 1, 0, 0, 0]);
  assert.deepEqual(result.questions.map(item => item.hintUsed), [false, false, true, false, false]);
  assert.deepEqual(result.questions.map(item => item.skipped), [false, false, false, true, false]);
  assert.deepEqual(result.questions.map(item => item.corrected), [false, true, false, false, false]);
  assert.deepEqual(result.questions.slice(0, 5).map(item => pitchClass(item.target.name)), asked.map(item => pitchClass(item.note)), 'Сохранённые цели совпадают с вопросами');
  await host(page).locator('[data-act="next-step"]').click();
  assert.equal(await section(page), 'foundation');
  return { asked: asked.map(({ note, answers, outcome }) => ({ note, answers, outcome })), stored: result.questions.map(({ outcome, errors, independentCorrect }) => ({ outcome, errors, independentCorrect })) };
});

check('name-note-cards-hide-answer-accept-pitch-class-by-click-or-digit', async ({ page, origin }) => {
  await openApp(page, origin); await openAtlas(page); await bridgeToCheck(page);
  await chooseKind(page, 'name-note');
  assert.equal(await host(page).locator('h1').innerText(), 'Проверь себя: назови ноту');
  let question = await nameQuestion(page);
  let scan = await answerLeakScan(page); assertNoLeak(scan, 'cards');
  assert.equal(question.labels.length, 12, 'Двенадцать классов высоты');
  await host(page).locator(`[data-choice="${question.wrong}"]`).click();
  assert.match(await feedbackText(page), new RegExp(`^Не ${question.labels[question.wrong]}\\.`));
  assert.equal(await host(page).locator(`[data-choice="${question.wrong}"]`).getAttribute('aria-disabled'), 'true');
  assert.deepEqual((await answerLeakScan(page)).problems, []);
  await host(page).locator(`[data-choice="${question.index}"]`).click();
  const feedback = await feedbackText(page);
  assert.match(feedback, /^Верно, с исправлением \(ошибок: 1\)\./);
  assert.ok(!scan.html.includes(answerPhrase(feedback)));
  const first = question; await next(page);

  // Ответ цифрой — только если карточка в первых девяти; иначе кликом.
  question = await nameQuestion(page);
  scan = await answerLeakScan(page); assertNoLeak(scan, 'cards');
  if (question.index < 9) await page.keyboard.press(`Digit${question.index + 1}`);
  else await host(page).locator(`[data-choice="${question.index}"]`).click();
  assert.match(await feedbackText(page), /^Верно, с первой попытки\./);
  assert.match(await host(page).locator(`[data-choice="${question.index}"]`).getAttribute('class'), /is-right/);
  await finishSeries(page);
  const db = await waitDb(page, db => screenEntries(db).some(entry => entry.result.mode === 'name-note' && entry.result.questions.length === 2), 'запись «Назови ноту»');
  const stored = screenEntries(db)[0].result.questions;
  assert.deepEqual(stored.slice(0, 2).map(item => [item.targetPositionId, item.errors, item.independentCorrect]), [[first.id, 1, false], [question.id, 0, true]]);
  return { first: { position: first.id, label: first.labels[first.index] }, second: { position: question.id, label: question.labels[question.index], digit: question.index < 9 } };
});

check('find-all-ignores-duplicate-selection-and-needs-every-independent-position', async ({ page, origin }) => {
  await openApp(page, origin); await openAtlas(page); await bridgeToCheck(page);
  await chooseKind(page, 'find-all');
  const positions = await materialPositions(page);
  let question = null;
  for (let attempt = 0; attempt < 6 && !question; attempt++) {
    const candidate = await findQuestion(page, positions);
    const count = Number(/— их (\d+)$/.exec(candidate.title)?.[1]);
    assert.equal(count, candidate.answers.length, `«${candidate.title}»: число позиций совпадает с независимым расчётом`);
    if (count >= 2) question = candidate;
    else await host(page).locator('[data-act="skip"]').click();
  }
  assert.ok(question, 'В серии нашёлся вопрос минимум с двумя позициями');
  const scan = await answerLeakScan(page); assertNoLeak(scan, 'board');
  await cell(page, question.answers[0]).click();
  assert.match(await feedbackText(page), new RegExp(`^${question.answers[0].replace(':', '/')} — верно\\.`));
  await cell(page, question.answers[0]).click();
  assert.match(await feedbackText(page), /уже отмечена/);
  assert.match(await cell(page, question.answers[0]).getAttribute('aria-label'), / — найдено$/);
  for (const id of question.answers.slice(1)) await cell(page, id).click();
  assert.match(await feedbackText(page), /^Верно, с первой попытки\./, 'Повтор найденной позиции — не ошибка');
  const index = Number(/^Вопрос (\d+)/.exec(await progressLabel(page))[1]) - 1;
  await finishSeries(page);
  const db = await waitDb(page, db => screenEntries(db).some(entry => entry.result.mode === 'find-all'), 'запись «Найди все позиции»');
  const stored = screenEntries(db)[0].result.questions[index];
  assert.equal(stored.errors, 0); assert.equal(stored.independentCorrect, true);
  assert.deepEqual([...stored.selectedPositionIds].sort(byPosition), question.answers, 'Дубликат не добавлен к выбранным позициям');
  return { note: question.note, answers: question.answers, duplicateIgnored: true };
});

check('find-pitch-rejects-same-note-in-another-octave-and-interval-uses-whole-area', async ({ page, origin }) => {
  await openApp(page, origin); await openAtlas(page); await bridgeToCheck(page);
  await chooseKind(page, 'find-pitch');
  const positions = await materialPositions(page);
  let octave = null;
  for (let attempt = 0; attempt < 6 && !octave; attempt++) {
    const title = (await questionTitle(page)).trim();
    const pitch = /^Найди ([A-G][♯♭]?-?\d)$/.exec(title)?.[1];
    assert.ok(pitch, `Вопрос не распознан: ${title}`);
    const midi = midiOf(pitch);
    const answers = positions.filter(id => positionMidi(id) === midi);
    const other = positions.filter(id => positionMidi(id) % 12 === midi % 12 && positionMidi(id) !== midi);
    assert.ok(answers.length > 0, `${pitch} нет в материале ${positions.join(' ')}`);
    if (!other.length) { await host(page).locator('[data-act="skip"]').click(); continue; }
    await cell(page, other[0]).click();
    assert.match(await feedbackText(page), /та же нота, другая октава/);
    await cell(page, answers[0]).click();
    assert.match(await feedbackText(page), /^Верно, с исправлением \(ошибок: 1\)\./);
    octave = { pitch, answers, otherOctave: other[0] };
  }
  assert.ok(octave, 'В серии нашлась высота с другой октавой в материале');
  await finishSeries(page);

  // Новая серия после итога: интервал от тоники по всему участку, включая ноты вне структуры.
  await chooseKind(page, 'find-interval');
  assert.equal(await host(page).locator('select[data-interval]').inputValue(), '#4');
  const title = (await questionTitle(page)).trim();
  const [, degree, root] = /^Найди (\S+) от ([A-G][♯♭]?)$/.exec(title) ?? [];
  assert.ok(degree && root, `Вопрос не распознан: ${title}`);
  const area = chromaticArea(positions);
  const answers = area.filter(id => (positionMidi(id) - pitchClass(root) + 120) % 12 === semitonesOf(degree));
  assert.ok(answers.length > 0 && answers.every(id => !positions.includes(id)), `♯4 от A вне структуры: ${answers.join(' ')}`);
  const scan = await answerLeakScan(page); assertNoLeak(scan, 'board');
  await cell(page, positions[0]).click();
  assert.match(await feedbackText(page), new RegExp(`нужен ${degree}\\. Считай полутоны от тоники\\.`));
  await cell(page, answers[0]).click();
  assert.match(await feedbackText(page), /^Верно, с исправлением \(ошибок: 1\)\./);
  await finishSeries(page);
  const db = await waitDb(page, db => screenEntries(db).length === 2, 'две экранные записи');
  const interval = screenEntries(db).find(entry => entry.result.mode === 'find-interval');
  assert.equal(interval.result.context.scope, 'chromatic');
  assert.deepEqual([...interval.result.context.positionIds].sort(byPosition), area, 'Участок интервала — все ноты участка формы');
  return { octave, interval: { degree, root, answers, area: area.length } };
});

check('kind-change-restarts-before-first-answer-locks-after-and-new-form-keeps-each-series-context', async ({ page, origin }) => {
  await openApp(page, origin); await openAtlas(page); await bridgeToCheck(page);
  const kind = host(page).locator('select[data-kind]');
  await chooseKind(page, 'find-note');
  await chooseKind(page, 'name-note');
  assert.equal(screenEntries(await readDb(page)).length, 0, 'Смена вида до ответа не пишет запись');
  const first = await nameQuestion(page);
  await host(page).locator(`[data-choice="${first.wrong}"]`).click();
  assert.equal(await kind.isDisabled(), true, 'После первого ответа вид вопроса закрыт');
  await host(page).locator('[data-act="back"]').click();
  assert.equal(await section(page), 'foundation');
  const closed = await waitDb(page, db => screenEntries(db).length === 1, 'закрытая серия');
  const original = screenEntries(closed)[0];
  assert.equal(original.result.context.root, 'A');
  assert.equal(original.result.questions[0].targetPositionId, first.id);
  assert.equal(original.result.questions[0].outcome, 'interrupted');
  assert.equal(original.result.questions[0].errors, 1);

  // Другая тональность в атласе: форма переходит к ближайшей, новая серия — со своим контекстом.
  await atlasMaterial(page, 'C', 'minor-pentatonic');
  assert.match(await page.locator('#box-select option:checked').innerText(), /^Форма A/);
  await bridgeToCheck(page);
  await chooseKind(page, 'name-note');
  const second = await answerNameQuestion(page);
  await host(page).locator('[data-act="back"]').click();
  const db = await waitDb(page, db => screenEntries(db).length === 2, 'вторая серия');
  const entries = screenEntries(db);
  const before = entries.find(entry => entry.id === original.id);
  const after = entries.find(entry => entry.id !== original.id);
  assert.deepEqual(before, original, 'Прежняя запись не смешана с новой серией');
  assert.equal(after.result.context.root, 'C'); assert.equal(after.result.questions[0].targetPositionId, second.id);
  assert.ok(after.result.context.positionIds.every(id => [0, 3, 5, 7, 10].includes(positionClass(id))), 'Материал новой серии — до-минорная пентатоника');
  return { original: { root: 'A', position: first.id }, next: { root: 'C', position: second.id } };
});

check('check-material-is-the-full-form-regardless-of-display-window-or-invalid-range', async ({ page, origin }) => {
  await openApp(page, origin); await openAtlas(page);
  const form = [...A_MINOR_FORM_A].sort(byPosition);
  await atlasRange(page, 0, 3);
  assert.equal(await page.locator('#show-whole-form').isVisible(), true, 'Форма вне окна показа');
  await bridgeToCheck(page);
  assert.deepEqual(await materialPositions(page), form, 'Окно 0–3 не обрезает материал проверки');
  await host(page).locator('[data-act="back"]').click();

  await disclose(page, '#area-settings');
  await page.getByLabel('Первый лад', { exact: true }).fill('9');
  assert.equal(await page.getByTestId('range-error').isVisible(), true);
  assert.equal(await page.locator('[data-position]').count(), 0, 'Неверное окно не показывает прежние позиции');
  await bridgeToCheck(page);
  assert.deepEqual(await materialPositions(page), form, 'Неверное окно не подставляет прежнее окно: материал — точная форма');
  await host(page).locator('[data-act="back"]').click();

  await page.getByLabel('Учебная форма', { exact: true }).selectOption('');
  assert.equal(await page.getByRole('button', { name: 'Проверь себя по этой форме', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Сыграть эту форму', exact: true }).isDisabled(), true);
  assert.match(await page.locator('#atlas-bridge-note').innerText(), /Выбери учебную форму/);
  return { form, window: [0, 3], invalidRange: [9, 3], freeRangeDisablesBridges: true };
});

check('repeat-errors-from-progress-asks-only-error-positions-in-original-context', async ({ page, origin }) => {
  await openApp(page, origin); await openAtlas(page); await bridgeToCheck(page);
  await chooseKind(page, 'name-note');
  const answered = [];
  for (let index = 0; index < 6; index++) {
    answered.push(await answerNameQuestion(page, { wrongFirst: index === 0 }));
    await next(page);
  }
  await checkHost(page).locator('[data-ck-summary]:not([hidden])').waitFor();
  assert.deepEqual(await summaryTiles(page), { self: 5, fix: 1, err: 1, shown: 0, skip: 0 });
  const errorPosition = answered[0].id;
  const saved = await waitDb(page, db => screenEntries(db).some(entry => entry.result.questions.length === 6 && entry.result.questions.every(item => item.outcome !== 'interrupted')), 'завершённая серия');
  const originalId = screenEntries(saved)[0].id;

  await navigate(page, 'progress');
  const repeat = page.locator('[data-repeat-errors]:visible').first();
  await repeat.waitFor();
  await repeat.click();
  assert.equal(await section(page), 'lesson');
  await page.locator('[data-lesson-screen="check"]:not([hidden]) [data-ck-title]').waitFor();
  assert.equal(await host(page).locator('h1').innerText(), 'Проверь себя: повтор ошибок');
  const sub = await host(page).locator('.ck-title-row .ck-sub').innerText();
  assert.match(sub, /^повтор ошибок · Am · минорная пентатоника · 1 позиция/);
  assert.equal(await host(page).locator('[data-act="back"]').innerText(), '← Прогресс');
  assert.equal(await host(page).locator('select[data-kind]').isDisabled(), true, 'Повтор задаёт вид «Назови ноту»');
  const asked = [];
  for (let index = 0; index < 3; index++) {
    const question = await nameQuestion(page);
    asked.push(question.id);
    await host(page).locator(`[data-choice="${question.index}"]`).click();
    await next(page);
  }
  assert.deepEqual(asked, [errorPosition, errorPosition, errorPosition], 'Вопросы только по ошибочной позиции');
  await host(page).locator('[data-act="back"]').click();
  assert.equal(await section(page), 'progress');
  const db = await waitDb(page, db => screenEntries(db).length === 2, 'запись повтора');
  const review = screenEntries(db).find(entry => entry.id !== originalId);
  assert.equal(review.result.mode, 'name-note');
  assert.equal(review.result.context.root, 'A'); assert.equal(review.result.context.structureId, 'minor-pentatonic');
  assert.deepEqual(review.result.context.positionIds, [errorPosition]);
  assert.deepEqual(review.result.questions.slice(0, 3).map(item => item.targetPositionId), asked);
  return { errorPosition, reviewSub: sub, asked, reviewRecord: review.id };
});

check('sequence-templates-on-play-screen-follow-independent-routes', async ({ page, origin }) => {
  await openApp(page, origin);
  const home = page.locator('[data-lesson-screen="home"]');
  const play = async title => {
    await home.getByRole('tab', { name: /^Библиотека/ }).click();
    await home.getByRole('button', { name: `Играть: ${title}`, exact: true }).click();
    await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene [data-title]').waitFor();
    assert.equal(await playScene(page).locator('[data-title]').innerText(), title);
    return tabRoute(page);
  };
  const chromatic = await play('Хроматика 1-2-3-4 в позиции');
  assert.deepEqual(chromatic.map(item => item.id), ['E', 'A', 'D', 'G'].flatMap(string => [5, 6, 7, 8].map(fret => `${string}:${fret}`)));
  assert.equal(await playScene(page).locator('[data-back]').innerText(), '← Занятие');
  await playScene(page).locator('[data-back]').click();

  const groups = await play('Группы по три');
  const up = ascendingByPitch(A_MINOR_FORM_A);
  const expected = up.slice(0, -2).flatMap((_, index) => up.slice(index, index + 3));
  assert.ok(groups.length >= 12, `На первой странице TAB видно ${groups.length} нот`);
  assert.deepEqual(groups.map(item => item.id), expected.slice(0, groups.length), 'Группы по три: n, n+1, n+2 по высоте формы');
  return { chromatic: chromatic.map(item => item.id), groups: groups.map(item => item.id) };
});

markFullOnly(checks, [
  'name-note-cards-hide-answer-accept-pitch-class-by-click-or-digit',
  'find-all-ignores-duplicate-selection-and-needs-every-independent-position',
  'find-pitch-rejects-same-note-in-another-octave-and-interval-uses-whole-area',
  'check-material-is-the-full-form-regardless-of-display-window-or-invalid-range',
  'sequence-templates-on-play-screen-follow-independent-routes',
], FULL_ONLY.smoke);
await runTrainingBrowserChecks(checks);
