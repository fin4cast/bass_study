import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runNotationBrowserChecks } from './helpers/notation-browser-harness.mjs';
import { markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';

// UI/UX собранного приложения в оболочке P13: «Занятие · Гриф · Ритм · Песни · Прогресс», «Настройки» внизу.
// Панелей «Мои занятия», «Введение» и маршрута больше нет: копия и восстановление — «Настройки → Данные»,
// черновики, ручные отметки и удаление записей — «Прогресс». Данные читаются только readonly-транзакцией IndexedDB.
const checks = [];
const check = (name, run) => checks.push({ name, scope: 'ui', run });
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert);
}
async function module(page, name) {
  await page.locator(`.site-header [data-app-module="${name}"]`).click();
  await page.waitForFunction(name => !document.querySelector(`[data-page-frame="${name}"]`)?.hidden, name);
}
async function settingsSection(page, section) {
  await module(page, 'settings');
  await page.locator(`[data-page-frame="settings"] [data-section="${section}"]`).click();
  await page.locator(`[data-page-frame="settings"] [data-pane="${section}"]`).waitFor();
}
/** «Настройки → Данные → Скачать копию (JSON)»: настоящий файл скачивания. */
async function exportUi(page) {
  await settingsSection(page, 'data');
  await page.locator('[data-page-frame="settings"] [data-dialog-open="download"]').click();
  const pending = page.waitForEvent('download'); await page.locator('[data-dialog] [data-dlg="export"]').click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}
async function chooseFile(page, name, text) {
  const choosing = page.waitForEvent('filechooser'); await page.locator('[data-dialog] [data-dlg="choose"]').click();
  await (await choosing).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}
/** «Настройки → Данные → Восстановить из копии…»: предпросмотр, подтверждение, замена одной операцией. */
async function restoreUi(page, copy) {
  await settingsSection(page, 'data');
  await page.locator('[data-page-frame="settings"] [data-dialog-open="restore"]').click();
  await chooseFile(page, 'uiux-copy.json', JSON.stringify(copy));
  await page.locator('[data-dialog] [data-dlg-confirm]').waitFor();
  assert.ok(await page.locator('[data-dialog] [data-dlg="replace"]').isDisabled());
  await page.locator('[data-dialog] [data-dlg-confirm]').check(); await page.locator('[data-dialog] [data-dlg="replace"]').click();
  // Восстановление применяет раздел из копии: если он не «Настройки», диалог закрывается вместе с разделом.
  await page.waitForFunction(() => { const dialog = document.querySelector('[data-page-frame="settings"] [data-dialog]'); return !dialog.open || /Данные восстановлены/.test(dialog.textContent); });
  const done = page.locator('[data-dialog] [data-dlg="close"]', { hasText: 'Готово' });
  if (await done.isVisible()) await done.click();
  await ready(page);
}
async function raw(page, store, key = null) {
  return page.evaluate(({ store, key }) => new Promise((resolve, reject) => {
    const opening = indexedDB.open('bass-study');
    opening.onerror = () => reject(opening.error);
    opening.onupgradeneeded = () => { opening.transaction.abort(); reject(new Error('Expected an existing native product database.')); };
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction(store, 'readonly');
      const request = key === null ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(key);
      let result; request.onsuccess = () => { result = request.result; }; request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(result); }; transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), { store, key });
}
async function waitRaw(page, store, predicate, timeout = 7000) {
  const started = Date.now(); let value;
  do { value = await raw(page, store); if (predicate(value)) return value; await delay(50); } while (Date.now() - started < timeout);
  assert.fail(`Native ${store} did not reach the expected state: ${JSON.stringify(value)}`);
}
/** Переключатель темы внизу меню оболочки. */
async function theme(page, choice) {
  await page.getByRole('group', { name: 'Тема оформления', exact: true }).locator(`[data-theme-choice="${choice}"]`).click();
  await page.waitForFunction(value => document.documentElement.dataset.themePreference === value, choice);
  // Wait for the existing border/background transition before reading colours.
  await delay(170);
}
async function studySettings(page) {
  if (!await page.locator('#study-settings').isVisible()) await page.locator('#toggle-study-settings').click();
}
async function studyDetails(page, selector) {
  await studySettings(page);
  const details = page.locator(selector);
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
}
async function area(page) { await studyDetails(page, '#area-settings'); }
async function display(page) { await studyDetails(page, '#display-settings'); }
async function assertFourStringsPerPart(page) {
  const parts = await page.locator('#fretboard-container svg.study-fretboard').evaluateAll(nodes => nodes.map(svg => ({ names: [...svg.querySelectorAll('.string-name')].map(node => node.textContent), strings: svg.querySelectorAll('.bass-string').length })));
  assert.ok(parts.length > 0, 'The selected display range must contain a board part');
  for (const part of parts) { assert.deepEqual(part.names, ['G', 'D', 'A', 'E']); assert.equal(part.strings, 4); }
}

/* ---------- Экран игры «Занятия» ---------- */
const playScene = page => page.locator('[data-lesson-screen="play"] .pl-scene');
const playStatus = page => playScene(page).getAttribute('data-status');
async function openPlay(page, title = 'Хроматика 1-2-3-4 в позиции') {
  await module(page, 'lesson');
  const home = page.locator('[data-lesson-screen="home"]');
  await home.getByRole('tab', { name: /^Сегодня/ }).click();
  await home.locator('.ls-plan').getByRole('button', { name: `Играть: ${title}`, exact: true }).click();
  await page.locator('[data-lesson-screen="play"]:not([hidden]) .pl-scene').waitFor();
}
async function startPlaying(page) {
  await playScene(page).locator('[data-play]').click();
  await page.waitForFunction(() => document.querySelector('[data-lesson-screen="play"] .pl-scene')?.dataset.status === 'playing', null, { timeout: 20000 });
}
async function stopPlaying(page) {
  await playScene(page).locator('[data-title]').focus(); await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-lesson-screen="play"] .pl-scene')?.dataset.status === 'stopped');
}

/** Source RGBs come from computed styles and are composited over actual ancestors. */
async function contrast(page, label) {
  const rows = await page.evaluate(() => {
    const rgb = value => { const parts = value.match(/[\d.]+/g)?.map(Number); if (!parts || parts.length < 3) throw new Error(`Unrecognized computed colour: ${value}`); return [parts[0], parts[1], parts[2], parts[3] ?? 1]; };
    const blend = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
    const luminance = values => values.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const ratio = (front, back) => { const first = luminance(front), second = luminance(back); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05); };
    const background = element => { const chain = []; for (let current = element; current; current = current.parentElement) chain.unshift(current); let result = rgb(getComputedStyle(document.documentElement).backgroundColor); for (const ancestor of chain) result = blend(rgb(getComputedStyle(ancestor).backgroundColor), result); return result; };
    const result = [];
    for (const element of document.querySelectorAll('main p, main span, main label, main summary, main button, main input:not([type=checkbox]):not([type=range]):not([type=file]), main select, main textarea, main h1, main h2, main h3, main h4, header button, header select')) {
      const style = getComputedStyle(element);
      if (!element.getClientRects().length || element.closest('[hidden],[aria-hidden="true"],:disabled,.sr-only') || style.visibility !== 'visible') continue;
      // Текст только для экранного диалога (обрезан до 1×1 px) не виден и в выборку контраста не входит.
      const box = element.getBoundingClientRect(); if (box.width <= 1 && box.height <= 1) continue;
      if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) && ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
      const text = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value || element.placeholder : element.textContent.trim();
      if (!text) continue;
      const paint = (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && !element.value && element.placeholder ? getComputedStyle(element, '::placeholder') : style;
      const bg = background(element), fg = rgb(paint.color);
      if (paint !== style) fg[3] *= Number(paint.opacity);
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) fg[3] *= Number(getComputedStyle(ancestor).opacity);
      result.push({ kind: 'text', text: text.slice(0, 90), selector: element.id || element.className || element.tagName, colour: paint.color, background: bg, ratio: ratio(blend(fg, bg), bg), threshold: 4.5 });
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) && Number.parseFloat(style.borderTopWidth) > 0) result.push({ kind: 'control-boundary', text: element.getAttribute('aria-label') || text.slice(0, 70), colour: style.borderTopColor, background: bg, ratio: ratio(rgb(style.borderTopColor), bg), threshold: 3 });
    }
    return result;
  });
  assert.ok(rows.length > 12, `${label}: too few actual visible text samples`);
  const failures = rows.filter(row => row.ratio + .01 < row.threshold);
  assert.deepEqual(failures, [], `${label}: computed contrast failures ${JSON.stringify(failures)}`);
  return { label, samples: rows.length, minimumTextRatio: Math.min(...rows.filter(row => row.kind === 'text').map(row => row.ratio)), nonText: rows.filter(row => row.kind !== 'text').length };
}

check('themes-preserve-running-play-focus-and-authoritative-profile', async ({ page }) => {
  await ready(page); await openPlay(page);
  const chooser = page.getByRole('group', { name: 'Тема оформления', exact: true });
  assert.deepEqual(await chooser.locator('button').evaluateAll(buttons => buttons.map(button => button.dataset.themeChoice)), ['light', 'dark']);
  await startPlaying(page);
  const contexts = await page.evaluate(() => window.__notationAudioContexts.length);
  const evidence = [];
  for (const choice of ['dark', 'light']) {
    const button = chooser.locator(`[data-theme-choice="${choice}"]`); await button.focus(); await theme(page, choice);
    assert.equal(await playStatus(page), 'playing', 'Смена темы не прерывает игру');
    assert.equal(await page.evaluate(() => window.__notationAudioContexts.length), contexts);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.themeChoice), choice);
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await chooser.locator('[aria-pressed="true"]').count(), 1);
    evidence.push({ choice, resolved: await page.locator('html').getAttribute('data-theme') });
  }
  for (const colorScheme of ['dark', 'light']) { await page.emulateMedia({ colorScheme }); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'An explicit light preference must ignore system colour-scheme changes'); }
  await stopPlaying(page); await theme(page, 'dark');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('bass-study-theme-v1') || 'null')?.preference === 'dark');
  assert.equal((await raw(page, 'profile', 'current')).theme, 'dark');
  const before = await exportUi(page); assert.equal(before.profile.theme, 'dark');
  await theme(page, 'light');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.reload(); await ready(page); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  return { evidence, audioContextsUnchanged: contexts, exportedTheme: before.profile.theme };
});

check('imported-system-profile-survives-binary-chooser-and-corrupt-first-frame-cache', async ({ page, context }) => {
  await ready(page); await theme(page, 'light');
  const incoming = await exportUi(page); incoming.profile.theme = 'system';
  await restoreUi(page, incoming); await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('bass-study-theme-v1') || 'null')?.preference === 'system');
  await context.addInitScript(() => {
    localStorage.setItem('bass-study-theme-v1', '{broken-json');
    requestAnimationFrame(() => { window.__uiuxFirstThemeFrame = { preference: document.documentElement.dataset.themePreference, resolved: document.documentElement.dataset.theme, background: getComputedStyle(document.documentElement).backgroundColor }; });
  });
  await page.reload(); await ready(page); await page.waitForFunction(() => !!window.__uiuxFirstThemeFrame);
  const first = await page.evaluate(() => window.__uiuxFirstThemeFrame);
  assert.equal(first.preference, 'system'); assert.equal(first.resolved, 'dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal((await raw(page, 'profile', 'current')).theme, 'system');
  const chooser = page.getByRole('group', { name: 'Тема оформления', exact: true });
  assert.equal(await chooser.locator('button').count(), 2);
  assert.equal(await chooser.locator('[data-theme-choice="dark"]').getAttribute('aria-pressed'), 'true');
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await chooser.locator('[data-theme-choice="light"]').getAttribute('aria-pressed'), 'true');
  assert.equal((await raw(page, 'profile', 'current')).theme, 'system', 'Resolving the imported profile must not rewrite it');
  await theme(page, 'dark'); await waitRaw(page, 'profile', profiles => profiles.some(profile => profile.theme === 'dark'));
  assert.equal((await raw(page, 'profile', 'current')).theme, 'dark');
  return { first, legacySystemImportedThroughRealBackup: true, systemPreservedUntilExplicitChoice: true, binaryChoices: ['light', 'dark'], method: 'Real JSON preview/confirmation in «Настройки → Данные» and native readonly IndexedDB; real first requestAnimationFrame after reload, browser colour-scheme media emulation, not an OS setting change.' };
});

check('default-box-exact-positions-feed-check-material-and-compact-forms-keep-four-strings', async ({ page, resultDir }) => {
  await ready(page); await module(page, 'foundation');
  const displayRange = async () => {
    await area(page);
    return [await page.getByLabel('Первый лад', { exact: true }).inputValue(), await page.getByLabel('Последний лад', { exact: true }).inputValue()];
  };
  assert.deepEqual(await displayRange(), ['0', '12']);
  const expected = ['A:5', 'A:7', 'D:5', 'D:7', 'E:5', 'E:8', 'G:5', 'G:7'];
  assert.deepEqual(await page.locator('#fretboard-container .in-box').evaluateAll(nodes => nodes.map(node => node.dataset.position).sort()), expected);
  // «Проверь себя по этой форме»: материал вопроса — те же точные позиции формы (контуры над ячейками грифа).
  await page.locator('#atlas-check').click();
  const host = page.locator('[data-lesson-screen="check"]');
  await host.locator('[data-ck-title]').waitFor();
  const material = await host.evaluate(element => {
    const cells = [...element.querySelectorAll('[data-cell]')].map(cell => ({ id: cell.dataset.cell, rect: cell.getBoundingClientRect() }));
    return [...element.querySelectorAll('.ck-wrap svg .mb-ghost')].map(ghost => {
      const box = ghost.getBoundingClientRect(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
      return cells.filter(({ rect }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom).map(cell => cell.id);
    });
  });
  assert.ok(material.every(ids => ids.length === 1), JSON.stringify(material));
  assert.deepEqual(material.map(([id]) => id).sort(), expected, 'Материал проверки — точные позиции формы атласа');
  await host.locator('[data-act="back"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-page-frame="foundation"]').hidden);
  await studySettings(page);
  await page.getByLabel('Структура', { exact: true }).selectOption('major-pentatonic');
  assert.match(await page.locator('#box-select option:checked').innerText(), /^Форма B/);
  await page.getByLabel('Тоника', { exact: true }).selectOption('C'); await page.getByLabel('Структура', { exact: true }).selectOption('major-triad');
  const compact = [];
  for (const [string, fret, emptyString] of [['E', 8, 'G'], ['A', 3, 'E']]) {
    const option = await page.locator('#box-select option').evaluateAll((options, { string, fret }) => options.find(option => option.textContent.trim() === `Тоника C · лад ${fret} · ${string}`)?.value, { string, fret });
    assert.notEqual(option, undefined); await page.locator('#box-select').selectOption(option);
    assert.deepEqual(await displayRange(), ['0', '12'], 'Material and form selection must preserve the independent display window');
    await assertFourStringsPerPart(page);
    assert.equal(await page.locator(`#fretboard-container [data-position^="${emptyString}:"]`).count(), 0);
    compact.push({ rootString: string, rootFret: fret, emptyString, visibleStringNames: ['G', 'D', 'A', 'E'] });
  }
  await display(page); await page.locator('#show-fingers').check();
  assert.equal(await page.locator('.finger-label').count(), 4);
  await waitRaw(page, 'preferences', values => values.some(value => value.study?.showFingers === true));
  await page.reload(); await ready(page); await display(page);
  assert.ok(await page.locator('#show-fingers').isChecked());
  assert.equal(await page.locator('.finger-label').count(), 4);
  await assertFourStringsPerPart(page);
  await page.locator('#show-fingers').uncheck();
  await page.getByLabel('Тоника', { exact: true }).selectOption('G'); await page.getByLabel('Структура', { exact: true }).selectOption('major');
  await page.locator('#box-select').selectOption({ label: 'Тоника G · лад 3 · E' });
  await page.setViewportSize({ width: 1366, height: 768 });
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    await assertFourStringsPerPart(page);
    assert.equal(await page.locator('#fretboard-container [data-position^="G:"]').count(), 0);
    await page.screenshot({ path: join(resultDir, `p8-user-four-strings-${choice}.png`), fullPage: true });
  }
  return { defaultExactIds: expected, checkMaterial: expected, majorPentatonicStartsWithB: true, compact, fingerPreferenceSurvivesReload: true, userExample: { root: 'G', structure: 'major', option: 'Тоника G · лад 3 · E', strings: ['G', 'D', 'A', 'E'], emptyString: 'G', screenshots: ['p8-user-four-strings-light.png', 'p8-user-four-strings-dark.png'] } };
});

async function rhythmDraft(page) {
  await module(page, 'harmony');
  await page.locator('[data-rhythm-action="start"]:visible').click();
  // Черновик создаётся только после накопленного времени практики: ждём вторую проигранную долю, а не фиксированное время.
  await page.waitForFunction(() => { const view = document.querySelector('.rhythm-view'); return view?.dataset.rhythmPhase === 'practice' && (Number(view.dataset.rhythmBar) > 1 || Number(view.dataset.rhythmBeat) >= 2); });
  await page.locator('[data-rhythm-action="pause"]:visible').click();
  await module(page, 'progress');
  await page.locator('[data-page-frame="progress"] [data-tab="exercises"]').click();
  const card = page.locator('[data-page-frame="progress"] [data-drafts] [data-draft]').first();
  await card.waitFor();
  return card;
}

check('progress-draft-note-autosaves-through-invalid-BPM-reload-save-and-confirmed-deletion', async ({ page }) => {
  await ready(page); await module(page, 'harmony');
  await page.locator('[data-rhythm-setting="bpm"]:visible').fill('80'); await page.locator('[data-rhythm-setting="bpm"]:visible').press('Tab');
  let card = await rhythmDraft(page);
  const note = card.locator('[data-draft-field="note"]'), bpm = card.locator('[data-draft-field="bpm"]');
  await note.fill('Сохранить эту заметку после reload'); await bpm.fill('');
  assert.equal(await bpm.getAttribute('aria-invalid'), 'true');
  await note.fill('Сохранить эту заметку после reload, даже при пустом BPM');
  const drafts = await waitRaw(page, 'practiceDrafts', values => values.some(draft => draft.note.endsWith('пустом BPM')));
  assert.equal(drafts.find(draft => draft.note.endsWith('пустом BPM')).comfortableBpm, 80, 'Пустой темп не затирает сохранённый');
  // Сохранение с пустым темпом не пишет запись: ошибка у поля темпа, фокус на нём.
  await card.locator('[data-draft-save]').click();
  await page.waitForFunction(() => document.activeElement?.dataset.draftField === 'bpm');
  assert.match(await card.locator('[data-draft-error]').innerText(), /Укажи темп/);
  assert.equal((await raw(page, 'history')).length, 0);
  await page.reload(); await ready(page); await module(page, 'progress');
  card = page.locator('[data-page-frame="progress"] [data-drafts] [data-draft]').first();
  assert.equal(await card.locator('[data-draft-field="note"]').inputValue(), 'Сохранить эту заметку после reload, даже при пустом BPM');
  await card.locator('[data-draft-field="bpm"]').fill('90');
  await card.locator('[data-draft-save]').dblclick({ delay: 10 });
  const entries = await waitRaw(page, 'history', values => values.some(entry => entry.result.kind === 'manual'));
  await delay(300);
  const manual = (await raw(page, 'history')).filter(entry => entry.result.kind === 'manual');
  assert.equal(manual.length, 1, 'Двойное нажатие сохраняет одну отметку');
  assert.equal(manual[0].result.material.kind, 'rhythm'); assert.equal(manual[0].result.comfortableBpm, 90);
  const frame = page.locator('[data-page-frame="progress"]');
  await frame.locator('[data-tab="calendar"]').click(); await frame.locator('[data-source="all"]').click();
  const entry = frame.locator('[data-day-card] .pg-entry.is-manual');
  assert.match(await entry.innerText(), /Ручная отметка · Ритм/);
  await entry.locator('[data-delete]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click(); assert.equal((await raw(page, 'history')).length, 1);
  await frame.locator('[data-day-card] .pg-entry.is-manual [data-delete]').click(); await page.getByRole('dialog').getByRole('button', { name: 'Удалить запись', exact: true }).click();
  await waitRaw(page, 'history', values => values.length === 0);
  card = await rhythmDraft(page);
  await card.locator('[data-draft-field="note"]').fill('Удалить только этот черновик');
  await waitRaw(page, 'practiceDrafts', values => values.some(draft => draft.note === 'Удалить только этот черновик'));
  await card.locator('[data-draft-delete]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal((await raw(page, 'practiceDrafts')).length, 1);
  await card.locator('[data-draft-delete]').click(); await page.getByRole('dialog').getByRole('button', { name: 'Удалить черновик', exact: true }).click();
  await waitRaw(page, 'practiceDrafts', values => values.length === 0);
  return { invalidBpmDidNotBlockNote: true, invalidBpmSaveFocusedField: true, restoredNote: true, oneManualEntry: true, materialPreserved: 'rhythm', deletionRequiredConfirmation: true, entries: entries.length };
});

check('sections-errors-and-empty-states-have-computed-light-and-dark-contrast', async ({ page, context, origin }) => {
  await ready(page); const evidence = [];
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    await module(page, 'lesson'); evidence.push(await contrast(page, `${choice}:lesson-today`));
    await module(page, 'foundation'); evidence.push(await contrast(page, `${choice}:fretboard-atlas`));
    await page.locator('#atlas-check').click(); await page.locator('[data-lesson-screen="check"] [data-ck-title]').waitFor();
    evidence.push(await contrast(page, `${choice}:check-question`));
    await page.locator('[data-lesson-screen="check"] [data-act="back"]').click();
    await module(page, 'harmony'); await page.locator('[data-rhythm-setting="bpm"]:visible').fill('300'); await page.locator('[data-rhythm-setting="bpm"]:visible').press('Tab'); await page.locator('[data-rhythm-output="error"]:visible').waitFor(); evidence.push(await contrast(page, `${choice}:rhythm-error`)); await page.locator('[data-rhythm-setting="bpm"]:visible').fill('80'); await page.locator('[data-rhythm-setting="bpm"]:visible').press('Tab');
    await module(page, 'tracks'); evidence.push(await contrast(page, `${choice}:tracks-empty`));
    await module(page, 'progress'); evidence.push(await contrast(page, `${choice}:progress-empty`));
    await settingsSection(page, 'data'); evidence.push(await contrast(page, `${choice}:settings-data`));
    await settingsSection(page, 'input'); evidence.push(await contrast(page, `${choice}:input-disconnected`));
    const cdp = await context.newCDPSession(page), { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin, browserContextId: targetInfo.browserContextId });
    await page.locator('[data-input-action="connect"]').click(); await page.getByTestId('input-error').waitFor(); evidence.push(await contrast(page, `${choice}:input-denied`)); await cdp.detach();
  }
  return { evidence, method: 'Computed RGB and actual ancestor backgrounds with alpha/opacity composition; sampled visible text >=4.5:1 and control boundaries >=3:1. Native permission denied before capture. Not a full WCAG certification.' };
});

check('meaningful-SVG-labels-fingers-focus-and-play-TAB-have-actual-contrast', async ({ page }) => {
  await ready(page); await module(page, 'foundation'); await studySettings(page); await page.getByLabel('Тоника', { exact: true }).selectOption('C'); await page.getByLabel('Структура', { exact: true }).selectOption('major');
  const compactE8 = await page.locator('#box-select option').evaluateAll(options => options.find(option => option.textContent.trim() === 'Тоника C · лад 8 · E')?.value);
  assert.notEqual(compactE8, undefined); await page.locator('#box-select').selectOption(compactE8);
  await display(page); await page.locator('#show-fingers').check();
  const evidence = [];
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    for (const mode of ['notes', 'degrees']) {
      await page.locator(`[data-label-mode="${mode}"]`).click();
      // Quiet positions outside the form gain a visible note label when chosen.
      await page.locator('#fretboard-container [data-position="E:9"]').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight');
      const rows = await page.evaluate(() => {
        const rgb = value => { const a = value.match(/[\d.]+/g)?.map(Number); if (!a || a.length < 3) throw new Error(`Expected computed SVG RGB: ${value}`); return a.slice(0, 3); };
        const lum = values => values.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
        const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
        const boardStops = element => {
          const stops = [...element.closest('svg').querySelectorAll('linearGradient stop')].map(stop => rgb(getComputedStyle(stop).stopColor));
          if (!stops.length) throw new Error('Expected actual gradient stops for each visible board part.');
          return stops;
        };
        const commonOpacity = element => { let opacity = 1; for (let parent = element; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity); return opacity; };
        const composite = (fg, bg, opacity) => fg.map((channel, index) => channel * opacity + bg[index] * (1 - opacity));
        const result = [];
        for (const text of document.querySelectorAll('#fretboard-container [data-position-label], #fretboard-container .finger-label')) {
          const position = text.closest('[data-position]'), marker = position.querySelector(text.classList.contains('finger-label') ? '.finger-background' : '.note-marker');
          const stops = boardStops(text);
          const fill = rgb(getComputedStyle(text).fill), bg = rgb(getComputedStyle(marker).fill), opacity = commonOpacity(text);
          result.push({ kind: text.classList.contains('finger-label') ? 'finger' : position.classList.contains('root-position') ? 'root-label' : position.classList.contains('outside-box') ? 'outside-label' : 'normal-label', text: text.textContent, position: position.dataset.position, opacity, ratio: Math.min(...stops.map(stop => ratio(composite(fill, stop, opacity), composite(bg, stop, commonOpacity(marker))))), threshold: 4.5 });
        }
        const active = document.activeElement, ring = active?.querySelector?.('.position-focus');
        if (!ring || Number(getComputedStyle(ring).opacity) === 0) throw new Error('A visible keyboard focus ring is required.');
        const stroke = rgb(getComputedStyle(ring).stroke); result.push({ kind: 'board-focus', ratio: Math.min(...boardStops(ring).map(stop => ratio(stroke, stop))), threshold: 3 });
        return result;
      });
      assert.ok(rows.some(row => row.kind === 'outside-label')); assert.ok(rows.some(row => row.kind === 'finger')); assert.ok(rows.some(row => row.kind === 'root-label'));
      assert.deepEqual(rows.filter(row => row.ratio + .01 < row.threshold), [], JSON.stringify({ choice, mode, rows }));
      evidence.push({ choice, mode, boardSamples: rows.length, minimumRatio: Math.min(...rows.map(row => row.ratio)), outsideLabels: rows.filter(row => row.kind === 'outside-label') });
    }
  }
  // TAB экрана игры (вид «TAB крупно»): цифры ладов на бумаге и под курсором, маски цифр, контур курсора.
  await openPlay(page);
  await playScene(page).locator('button[data-view="tab"]').click();
  await startPlaying(page);
  await page.waitForSelector('[data-lesson-screen="play"] .pl-tab-fret.is-current');
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    const tab = await page.evaluate(() => {
      const rgb = value => { const a = value.match(/[\d.]+/g)?.map(Number); if (!a || a.length < 3) throw new Error(`Expected computed RGB: ${value}`); return [a[0], a[1], a[2], a[3] ?? 1]; };
      const blend = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
      const lum = values => values.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
      const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
      const svg = [...document.querySelectorAll('[data-lesson-screen="play"] .pl-tab-svg')].find(node => node.querySelector('.pl-tab-fret.is-current') && node.getClientRects().length);
      const background = element => { const chain = []; for (let current = element; current; current = current.parentElement) chain.unshift(current); let result = rgb(getComputedStyle(document.documentElement).backgroundColor); for (const ancestor of chain) result = blend(rgb(getComputedStyle(ancestor).backgroundColor), result); return result; };
      const paper = background(svg);
      const cursor = svg.querySelector('.pl-tab-cursor'), cursorStyle = getComputedStyle(cursor);
      const cursorFill = blend([...rgb(cursorStyle.fill).slice(0, 3), Number(cursorStyle.fillOpacity)], paper);
      const glyphs = [...svg.querySelectorAll('.pl-tab-fret:not(.is-played)')].map(text => {
        const fill = rgb(getComputedStyle(text).fill), current = text.classList.contains('is-current');
        return { glyph: text.textContent, current, ratio: current ? Math.min(ratio(fill, paper), ratio(fill, cursorFill)) : ratio(fill, paper) };
      });
      const masks = [...svg.querySelectorAll('.pl-tab-gap')].map(rect => blend(rgb(getComputedStyle(rect).fill), paper).map(Math.round));
      return { paper: paper.map(Math.round), glyphs, masks, cursorRatio: Math.min(ratio(rgb(cursorStyle.stroke), paper), ratio(rgb(cursorStyle.stroke), cursorFill)) };
    });
    assert.ok(tab.glyphs.length >= 4 && tab.glyphs.some(glyph => glyph.current), JSON.stringify(tab));
    assert.deepEqual(tab.glyphs.filter(glyph => glyph.ratio + .01 < 4.5), [], JSON.stringify({ choice, tab }));
    for (const mask of tab.masks) assert.deepEqual(mask, tab.paper, 'Маска цифры совпадает с бумагой TAB');
    assert.ok(tab.cursorRatio >= 3, JSON.stringify({ choice, cursorRatio: tab.cursorRatio }));
    evidence.push({ choice, tabGlyphs: tab.glyphs.length, minimumGlyphRatio: Math.min(...tab.glyphs.map(glyph => glyph.ratio)), masks: tab.masks.length, cursorRatio: tab.cursorRatio });
  }
  await stopPlaying(page);
  return { evidence, method: 'Actual computed SVG fills/strokes/gradient stops, circle/finger backgrounds and parent opacity; running play-screen TAB cursor and digit masks over the real card background. No inverse filters or source-hex-only audit.' };
});

// Esc закрывает диалог сразу, а событие `close` приходит отдельной задачей. Повторное открытие до него
// (Enter сразу после Esc) не должно очищаться запоздавшим `close`: иначе диалог открыт, но пуст.
check('settings-dialog-reopened-before-late-close-event-keeps-its-content', async ({ page }) => {
  await ready(page);
  await settingsSection(page, 'data');
  const opener = page.locator('[data-page-frame="settings"] [data-dialog-open="restore"]');
  await opener.click();
  await page.locator('[data-dialog] [data-dlg="choose"]').waitFor();
  const reopened = await page.evaluate(async () => {
    const dialog = document.querySelector('[data-page-frame="settings"] [data-dialog]');
    dialog.close();
    document.querySelector('[data-page-frame="settings"] [data-dialog-open="restore"]').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    return { open: dialog.open, choose: Boolean(dialog.querySelector('[data-dlg="choose"]')), text: dialog.textContent.trim().slice(0, 60) };
  });
  assert.deepEqual({ open: reopened.open, choose: reopened.choose }, { open: true, choose: true }, JSON.stringify(reopened));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.dataset.dialogOpen === 'restore');
  return reopened;
});

check('settings-dialogs-and-progress-deletion-keep-keyboard-focus', async ({ page }) => {
  await ready(page);
  // Ожидание фокуса с диагностикой: в CI сбой был только тайм-аутом, без состояния диалога.
  const focusOn = (attribute, value) => page.waitForFunction(([name, expected]) => document.activeElement?.dataset[name] === expected, [attribute, value]).catch(async failure => {
    const state = await page.evaluate(() => { const dialog = document.querySelector('[data-page-frame="settings"] [data-dialog]'); return { active: document.activeElement?.outerHTML.slice(0, 100), dialogOpen: dialog?.open, dialogText: dialog?.textContent.trim().slice(0, 80), hasFocus: document.hasFocus() }; });
    throw new Error(`DIAG фокус ${attribute}=${value}: ${JSON.stringify(state)} ${failure.message}`);
  });
  // «Настройки → Данные»: диалоги открываются клавиатурой, Esc и «Закрыть» возвращают фокус на кнопку открытия.
  await settingsSection(page, 'data');
  const opener = page.locator('[data-page-frame="settings"] [data-dialog-open="restore"]');
  await opener.focus(); await page.keyboard.press('Enter');
  await focusOn('dlg', 'choose');
  await page.keyboard.press('Escape');
  await focusOn('dialogOpen', 'restore');
  await page.keyboard.press('Enter');
  await chooseFile(page, 'broken.json', '{broken');
  await page.locator('[data-dialog] [data-dlg="close"]', { hasText: 'Закрыть' }).waitFor();
  const rejection = await page.locator('[data-dialog]').innerText();
  assert.match(rejection, /Ничего не изменилось/);
  await page.locator('[data-dialog] [data-dlg="close"]').focus(); await page.keyboard.press('Enter');
  await focusOn('dialogOpen', 'restore');
  const download = page.locator('[data-page-frame="settings"] [data-dialog-open="download"]');
  await download.focus(); await page.keyboard.press('Enter');
  await focusOn('dlg', 'export');
  await page.keyboard.press('Escape');
  await focusOn('dialogOpen', 'download');
  // «Прогресс»: отмена удаления возвращает фокус на кнопку, удаление переводит его на соседнюю запись.
  await restoreUi(page, JSON.parse(await readFile(new URL('./fixtures/backup.json', import.meta.url), 'utf8')));
  const before = (await raw(page, 'history')).length;
  await module(page, 'progress');
  const frame = page.locator('[data-page-frame="progress"]');
  await frame.locator('[data-tab="calendar"]').click(); await frame.locator('[data-source="all"]').click();
  const deletes = frame.locator('[data-day-card] [data-delete]');
  assert.ok(await deletes.count() >= 2, 'В дне фикстуры несколько записей');
  const [first, second] = await deletes.evaluateAll(list => list.slice(0, 2).map(button => button.dataset.delete));
  await deletes.first().focus(); await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(id => document.activeElement?.dataset.delete === id, first);
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить запись', exact: true }).click();
  await waitRaw(page, 'history', values => values.length === before - 1 && !values.some(entry => entry.id === first));
  await page.waitForFunction(id => document.activeElement?.dataset.delete === id, second);
  return { restoreDialog: 'Esc/Закрыть → opener', rejection: rejection.slice(0, 160), downloadDialog: 'Esc → opener', deleted: first, focusMovedTo: second, historyBefore: before };
});

check('laptop-widths-show-board-by-500px-and-narrow-layout-uses-local-scroll', async ({ page, resultDir, cdp }) => {
  await ready(page); const evidence = [];
  for (const width of [1366, 1024, 640]) {
    await page.setViewportSize({ width, height: 768 }); await theme(page, width === 1024 ? 'dark' : 'light');
    await module(page, 'foundation');
    const geometry = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth, boardY: document.querySelector('#fretboard-container').getBoundingClientRect().top + scrollY }));
    assert.ok(geometry.page <= width + 2, JSON.stringify(geometry)); if (width >= 1024) assert.ok(geometry.boardY <= 500, JSON.stringify(geometry));
    await page.screenshot({ path: join(resultDir, `p8-uiux-${width}.png`), fullPage: true }); evidence.push(geometry);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  const zoom = await page.evaluate(() => ({ scale: visualViewport.scale, viewportWidth: visualViewport.width, layoutWidth: innerWidth, pageWidth: document.documentElement.scrollWidth }));
  assert.ok(zoom.scale >= 1.99); await page.screenshot({ path: join(resultDir, 'p8-uiux-cdp-scale-200.png') });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  return { evidence, zoom, zoomMethod: 'Actual CDP page scale (visual viewport/pinch zoom), not CSS zoom and not a claim about Edge desktop menu zoom.' };
});

markFullOnly(checks, [
  'themes-preserve-running-play-focus-and-authoritative-profile',
  'imported-system-profile-survives-binary-chooser-and-corrupt-first-frame-cache',
  'meaningful-SVG-labels-fingers-focus-and-play-TAB-have-actual-contrast',
  // 11–15 с: два прогона ритма до черновика; копия, восстановление и удаление в быстром наборе — settings-dialogs….
  'progress-draft-note-autosaves-through-invalid-BPM-reload-save-and-confirmed-deletion',
], FULL_ONLY.smoke);
await runNotationBrowserChecks(checks, { reportName: 'p8-uiux-edge.json', scope: 'P8/P13 actual product UI in the P13 shell: themes and first frame, exact atlas boxes feeding «Проверь себя», Progress drafts and manual marks, confirmations, Settings backup dialogs and keyboard focus, sampled computed contrast (sections, board, play-screen TAB), laptop widths and CDP page scale. Native IndexedDB is only read, media access is denied before capture, no physical bass/latency assessment.' });
