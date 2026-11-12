import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runNotationBrowserChecks } from './helpers/notation-browser-harness.mjs';
import { markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';

const checks = [];
const check = (name, run) => checks.push({ name, scope: 'ui', run });
async function ready(page, free = true) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert);
  if (free && await page.locator('[data-intro="free"]').isVisible()) await page.locator('[data-intro="free"]').click();
}
async function module(page, name) { await page.locator(`[data-app-module="${name}"]`).click(); }
async function history(page) { const drawer = page.locator('.history-drawer'); if (!await drawer.evaluate(element => element.open)) await page.locator('#open-history').click(); await page.getByLabel('Название пресета', { exact: true }).waitFor(); }
async function exportUi(page) {
  await history(page); const pending = page.waitForEvent('download'); await page.locator('[data-history-action="export"]').click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
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
async function theme(page, choice) {
  await page.getByRole('group', { name: 'Тема оформления', exact: true }).locator(`[data-theme-choice="${choice}"]`).click();
  await page.waitForFunction(value => document.documentElement.dataset.themePreference === value, choice);
  // Wait for the existing border/background transition before reading colours.
  await delay(170);
}
async function restoreUi(page, copy, free = true) {
  await history(page);
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles({ name: 'theme-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) });
  await page.getByTestId('backup-preview').waitFor();
  assert.ok(await page.locator('[data-history-action="confirm-restore"]').isDisabled());
  await page.getByRole('checkbox', { name: 'Понимаю, что текущие данные будут заменены', exact: true }).check();
  await page.locator('[data-history-action="confirm-restore"]').click();
  await page.getByTestId('backup-preview').waitFor({ state: 'detached' }); await ready(page, free);
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
async function sequence(page) {
  await module(page, 'foundation'); await page.locator('[data-training-mode="sequence"]').click();
  await page.locator('#player-mount').getByLabel('Повтор', { exact: true }).selectOption('infinite');
  await page.getByLabel('Отсчёт перед стартом', { exact: true }).uncheck();
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
    for (const element of document.querySelectorAll('main p, main span, main label, main summary, main button, main input:not([type=checkbox]):not([type=range]):not([type=file]), main select, main textarea, main h2, main h3, main h4, header button, header select')) {
      const style = getComputedStyle(element);
      if (!element.getClientRects().length || element.closest('[hidden],[aria-hidden="true"],:disabled,.sr-only') || style.visibility !== 'visible') continue;
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
    const selected = document.querySelector('[data-app-module][aria-current="page"]');
    if (selected) { const style = getComputedStyle(selected), bg = background(selected); result.push({ kind: 'selected-boundary', text: selected.textContent, colour: style.borderTopColor, background: bg, ratio: ratio(rgb(style.borderTopColor), bg), threshold: 3 }); }
    return result;
  });
  assert.ok(rows.length > 12, `${label}: too few actual visible text samples`);
  const failures = rows.filter(row => row.ratio + .01 < row.threshold);
  assert.deepEqual(failures, [], `${label}: computed contrast failures ${JSON.stringify(failures)}`);
  return { label, samples: rows.length, minimumTextRatio: Math.min(...rows.filter(row => row.kind === 'text').map(row => row.ratio)), nonText: rows.filter(row => row.kind !== 'text') };
}

check('themes-preserve-running-sequence-focus-and-authoritative-profile', async ({ page }) => {
  await ready(page); await sequence(page);
  const chooser = page.getByRole('group', { name: 'Тема оформления', exact: true });
  assert.deepEqual(await chooser.locator('button').evaluateAll(buttons => buttons.map(button => button.dataset.themeChoice)), ['light', 'dark']);
  await page.locator('[data-player-action="start"]').click();
  await page.waitForFunction(() => document.querySelector('#player-mount').dataset.playerState === 'running');
  const contexts = await page.evaluate(() => window.__notationAudioContexts.length);
  const evidence = [];
  for (const choice of ['dark', 'light']) {
    const button = chooser.locator(`[data-theme-choice="${choice}"]`); await button.focus(); await theme(page, choice);
    assert.equal(await page.locator('#player-mount').getAttribute('data-player-state'), 'running');
    assert.equal(await page.evaluate(() => window.__notationAudioContexts.length), contexts);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.themeChoice), choice);
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await chooser.locator('[aria-pressed="true"]').count(), 1);
    evidence.push({ choice, resolved: await page.locator('html').getAttribute('data-theme') });
  }
  for (const colorScheme of ['dark', 'light']) { await page.emulateMedia({ colorScheme }); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'An explicit light preference must ignore system colour-scheme changes'); }
  await page.locator('[data-player-action="stop"]').click(); await theme(page, 'dark');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('bass-study-theme-v1') || 'null')?.preference === 'dark');
  assert.equal((await raw(page, 'profile', 'current')).theme, 'dark');
  const before = await exportUi(page); await page.getByLabel('Название пресета', { exact: true }).fill('Свет сохраняется глобально'); await page.locator('[data-history-action="save-preset"]').click();
  await page.getByText('Свет сохраняется глобально', { exact: true }).waitFor(); await theme(page, 'light');
  await page.locator('[data-apply-preset]').first().click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.reload(); await ready(page); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  return { evidence, audioContextsUnchanged: contexts, presetDoesNotChangeTheme: true, existingHistoryPreserved: before.history.length };
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
  return { first, legacySystemImportedThroughRealBackup: true, systemPreservedUntilExplicitChoice: true, binaryChoices: ['light', 'dark'], method: 'Real JSON preview/confirmation and native readonly IndexedDB; real first requestAnimationFrame after reload, browser colour-scheme media emulation, not an OS setting change.' };
});

check('guided-four-steps-do-not-create-graded-history-and-choice-survives-reload', async ({ page }) => {
  await ready(page, false);
  assert.equal(await page.locator('#onboarding-mount').isVisible(), false);
  await page.locator('#open-introduction').click();
  assert.ok(await page.locator('[data-intro="guided"]').isVisible());
  await page.locator('[data-intro="guided"]').click();
  assert.match(await page.locator('#onboarding-mount').innerText(), /Введение: 1 из 4/);
  await page.locator('[data-intro="next"]').click(); assert.match(await page.locator('#onboarding-mount').innerText(), /E\/8.*A\/7.*A\/10.*D\/10/);
  await page.locator('[data-intro="next"]').click();
  for (const position of ['E:8', 'A:7', 'A:10']) await page.locator(`[data-intro-position="${position}"]`).click();
  assert.match(await page.locator('[data-intro-found]').innerText(), /3 из 3/);
  await page.locator('[data-intro="next"]').click();
  for (const degree of ['1', '3', '5']) { await page.locator(`[data-intro-example="${degree}"]`).click(); await delay(100); }
  await page.locator('[data-intro="next"]').click();
  assert.ok(await page.locator('#onboarding-mount').isHidden());
  const copy = await exportUi(page); assert.equal(copy.history.length, 0); assert.deepEqual(copy.profile.onboarding, { version: 1, choice: 'guided', completed: true });
  await page.reload(); await ready(page, false); assert.ok(await page.locator('#onboarding-mount').isHidden());
  await page.getByRole('button', { name: 'Введение', exact: true }).click(); assert.ok(await page.locator('[data-intro="guided"]').isVisible());
  return { gradedHistoryEntries: 0, fourStepsCompleted: true, onboarding: copy.profile.onboarding, reopeningAvailable: true };
});

check('free-practice-choice-does-not-reopen-start-question-after-reload-or-restore', async ({ page, context, origin }) => {
  // Do not use ready()'s automatic free-choice helper: it would hide the regression.
  await ready(page, false);
  assert.equal(await page.locator('#onboarding-mount').isVisible(), false);
  // A fresh database has no profile record until the first explicit choice; reading uses the default.
  assert.equal((await raw(page, 'profile', 'current'))?.onboarding.choice ?? null, null, 'A quiet startup must not manufacture an onboarding choice');
  await page.locator('#open-introduction').click();
  assert.equal(await page.locator('[data-intro="free"]').isVisible(), true);
  await page.locator('[data-intro="free"]').click();
  await waitRaw(page, 'profile', profiles => profiles.some(profile => profile.onboarding.choice === 'free'));
  assert.equal(await page.locator('#onboarding-mount').isVisible(), false);
  const choice = { version: 1, choice: 'free', completed: false };
  const copy = await exportUi(page);
  assert.deepEqual(copy.profile.onboarding, choice);

  await theme(page, 'dark');
  await theme(page, 'light');
  await page.reload();
  await ready(page, false);
  assert.equal(await page.locator('#onboarding-mount').isVisible(), false);
  assert.deepEqual((await raw(page, 'profile', 'current')).onboarding, choice);

  await restoreUi(page, copy, false);
  assert.equal(await page.locator('#onboarding-mount').isVisible(), false);
  await page.reload();
  await ready(page, false);
  assert.equal(await page.locator('#onboarding-mount').isVisible(), false);
  assert.deepEqual((await raw(page, 'profile', 'current')).onboarding, choice);

  // A replacement page uses the same native profile, without the former writer.
  await page.close();
  const reopened = await context.newPage();
  const reopenedErrors = [];
  reopened.on('pageerror', error => reopenedErrors.push(error.message));
  await reopened.goto(origin);
  await ready(reopened, false);
  assert.equal(await reopened.locator('#onboarding-mount').isVisible(), false);
  assert.deepEqual((await raw(reopened, 'profile', 'current')).onboarding, choice);
  await reopened.locator('#open-introduction').click();
  assert.equal(await reopened.locator('[data-intro="guided"]').isVisible(), true);
  await reopened.locator('[data-intro="free"]').click();
  assert.equal(await reopened.locator('#onboarding-mount').isVisible(), false);
  assert.deepEqual(reopenedErrors, []);
  return { onboarding: choice, quietFirstStartWithoutProfileRewrite: true, nativeProfileRead: true, reloads: 2, backupRestore: true, replacementPage: true, reopeningOnlyByExplicitAction: true, reopenedErrors };
});

check('default-box-and-quiz-use-exact-positions-interval-explicitly-uses-chromatic-area', async ({ page, resultDir }) => {
  await ready(page);
  const displayRange = async () => {
    await area(page);
    return [await page.getByLabel('Первый лад', { exact: true }).inputValue(), await page.getByLabel('Последний лад', { exact: true }).inputValue()];
  };
  assert.deepEqual(await displayRange(), ['0', '12']);
  const expected = ['A:5', 'A:7', 'D:5', 'D:7', 'E:5', 'E:8', 'G:5', 'G:7'];
  assert.deepEqual(await page.locator('#fretboard-container .in-box').evaluateAll(nodes => nodes.map(node => node.dataset.position).sort()), expected);
  await page.locator('[data-training-mode="quiz"]').click(); await page.getByLabel('Тип задания', { exact: true }).selectOption('find-note');
  await page.locator('[data-training-action="start"]').click();
  assert.deepEqual(await page.locator('[data-answer-position]').evaluateAll(nodes => nodes.map(node => node.dataset.answerPosition).sort()), expected);
  await page.locator('[data-training-action="hint"]').click();
  let copy = await exportUi(page); const form = copy.history.find(entry => entry.result.kind === 'screen');
  assert.equal(form.result.context.box.shapeId, 'penta-a'); assert.deepEqual([...form.result.context.positionIds].sort(), expected);
  await page.getByLabel('Тип задания', { exact: true }).selectOption('find-interval');
  await page.locator('[data-training-action="start"]').click();
  assert.equal(await page.locator('[data-answer-position]').count(), 16);
  assert.match(await page.locator('.training-content').innerText(), /все хроматические позиции.*подсветка бокса временно отключены/);
  await page.locator('[data-training-action="hint"]').click(); copy = await exportUi(page);
  const interval = copy.history.find(entry => entry.result.kind === 'screen' && entry.result.mode === 'find-interval');
  assert.equal(interval.result.context.box ?? null, null); assert.equal(interval.result.context.scope, 'chromatic'); assert.equal(interval.result.context.positionIds.length, 16);
  await page.locator('[data-training-mode="study"]').click(); await page.getByLabel('Структура', { exact: true }).selectOption('major-pentatonic');
  assert.match(await page.locator('#box-select option:checked').innerText(), /^Форма B/);
  await page.getByLabel('Тоника', { exact: true }).selectOption('C'); await page.getByLabel('Структура', { exact: true }).selectOption('major-triad');
  const compact = [];
  for (const [string, fret, emptyString] of [['E', 8, 'G'], ['A', 3, 'E']]) {
    const option = await page.locator('#box-select option').evaluateAll((options, { string, fret }) => options.find(option => option.textContent.trim() === `Тоника C · лад ${fret} · ${string}`)?.value, { string, fret });
    assert.notEqual(option, undefined); await page.locator('#box-select').selectOption(option);
    assert.deepEqual(await displayRange(), ['0', '12'], 'Material and form selection must preserve the independent display window');
    await assertFourStringsPerPart(page);
    assert.equal(await page.locator(`#fretboard-container [data-position^="${emptyString}:"]`).count(), 0);
    assert.equal(await page.locator('#fretboard-container .string-caption').count(), 0);
    compact.push({ rootString: string, rootFret: fret, emptyString, visibleStringNames: ['G', 'D', 'A', 'E'] });
  }
  await display(page); await page.locator('#show-fingers').check();
  assert.equal(await page.locator('.finger-label').count(), 4);
  const fingers = await exportUi(page); assert.equal(fingers.preferences.study.showFingers, true);
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
    assert.equal(await page.locator('#fretboard-container .string-caption').count(), 0);
    await page.screenshot({ path: join(resultDir, `p8-user-four-strings-${choice}.png`), fullPage: true });
  }
  return { defaultExactIds: expected, chromaticIntervalArea: 16, majorPentatonicStartsWithB: true, compact, fingerPreferenceSurvivesReload: true, userExample: { root: 'G', structure: 'major', option: 'Тоника G · лад 3 · E', strings: ['G', 'D', 'A', 'E'], emptyString: 'G', screenshots: ['p8-user-four-strings-light.png', 'p8-user-four-strings-dark.png'] } };
});

check('draft-note-autosaves-through-invalid-BPM-reload-save-and-confirmed-deletion', async ({ page }) => {
  await ready(page); await module(page, 'harmony');
  await page.locator('[data-rhythm-setting="bpm"]:visible').fill('80'); await page.locator('[data-rhythm-setting="bpm"]:visible').press('Tab');
  await page.locator('[data-rhythm-action="start"]').click();
  // Черновик создаётся только после накопленного времени практики: ждём вторую проигранную долю, а не фиксированное время.
  await page.waitForFunction(() => { const view = document.querySelector('.rhythm-view'); return view?.dataset.rhythmPhase === 'practice' && (Number(view.dataset.rhythmBar) > 1 || Number(view.dataset.rhythmBeat) >= 2); });
  await page.locator('[data-rhythm-action="pause"]').click(); await history(page);
  const note = page.getByLabel('Заметка к практике', { exact: true });
  await note.fill('Сохранить эту заметку после reload'); await page.getByLabel('Комфортный темп', { exact: true }).fill('');
  await note.fill('Сохранить эту заметку после reload, даже при пустом BPM');
  const drafts = await waitRaw(page, 'practiceDrafts', values => values.some(draft => draft.note.endsWith('пустом BPM')));
  assert.equal(drafts.find(draft => draft.note.endsWith('пустом BPM')).comfortableBpm, 80);
  await page.reload(); await ready(page); await history(page);
  const picker = page.getByLabel('Черновики ручной практики', { exact: true });
  await picker.selectOption(await picker.locator('option').last().getAttribute('value'));
  assert.equal(await note.inputValue(), 'Сохранить эту заметку после reload, даже при пустом BPM');
  await page.getByLabel('Комфортный темп', { exact: true }).fill('90');
  await page.locator('[data-history-action="save-manual"]').dblclick({ delay: 10 });
  const entries = await waitRaw(page, 'history', values => values.some(entry => entry.result.kind === 'manual'));
  assert.equal(entries.filter(entry => entry.result.kind === 'manual').length, 1);
  assert.equal(entries[0].result.material.kind, 'rhythm'); assert.equal(entries[0].result.comfortableBpm, 90);
  assert.match(await page.locator('[data-history-kind="manual"]').innerText(), /Метроном/);
  await page.locator('[data-delete-history]').first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click(); assert.equal((await raw(page, 'history')).length, 1);
  await page.locator('[data-delete-history]').first().click(); await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await waitRaw(page, 'history', values => values.length === 0);
  await page.locator('.history-drawer > summary').click(); await module(page, 'harmony');
  await page.locator('[data-rhythm-action="start"]').click();
  // Черновик создаётся только после накопленного времени практики: ждём вторую проигранную долю, а не фиксированное время.
  await page.waitForFunction(() => { const view = document.querySelector('.rhythm-view'); return view?.dataset.rhythmPhase === 'practice' && (Number(view.dataset.rhythmBar) > 1 || Number(view.dataset.rhythmBeat) >= 2); });
  await page.locator('[data-rhythm-action="pause"]').click(); await history(page);
  await note.fill('Удалить только этот черновик'); await waitRaw(page, 'practiceDrafts', values => values.some(draft => draft.note === 'Удалить только этот черновик'));
  const drawer = page.locator('.history-drawer'); await drawer.locator(':scope > summary').click(); await history(page);
  await page.locator('[data-history-action="delete-draft"]').click(); await page.getByRole('dialog').getByRole('button', { name: 'Удалить черновик', exact: true }).click();
  await waitRaw(page, 'practiceDrafts', values => values.length === 0);
  return { invalidBpmDidNotBlockNote: true, restoredNote: true, oneManualEntry: true, materialPreserved: 'rhythm', deletionRequiredConfirmation: true };
});

check('six-modules-errors-and-empty-states-have-computed-light-and-dark-contrast', async ({ page, context, origin }) => {
  await ready(page); const evidence = [];
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    await module(page, 'foundation'); await page.locator('[data-training-mode="study"]').click(); evidence.push(await contrast(page, `${choice}:fretboard`));
    await page.locator('[data-training-mode="quiz"]').click();
    const quizDetails = page.locator('details:has([data-quiz-setting="count"])'); if (await quizDetails.count() && !await quizDetails.evaluate(element => element.open)) await quizDetails.locator(':scope > summary').click();
    await page.getByLabel('Количество вопросов', { exact: true }).fill('0'); await page.locator('[data-training-action="start"]').click(); evidence.push(await contrast(page, `${choice}:quiz-error`)); await page.getByLabel('Количество вопросов', { exact: true }).fill('10'); await page.getByLabel('Количество вопросов', { exact: true }).press('Tab');
    await module(page, 'ear'); await page.getByLabel('Слуховых вопросов', { exact: true }).fill('21'); await page.locator('[data-ear-action="start"]').click(); evidence.push(await contrast(page, `${choice}:ear-error`)); await page.getByLabel('Слуховых вопросов', { exact: true }).fill('10'); await page.getByLabel('Слуховых вопросов', { exact: true }).press('Tab');
    await module(page, 'route'); evidence.push(await contrast(page, `${choice}:route-ready`));
    await module(page, 'harmony'); await page.locator('[data-rhythm-setting="bpm"]:visible').fill('300'); await page.locator('[data-rhythm-setting="bpm"]:visible').press('Tab'); await page.locator('[data-rhythm-output="error"]').waitFor(); evidence.push(await contrast(page, `${choice}:rhythm-error`)); await page.locator('[data-rhythm-setting="bpm"]:visible').fill('80'); await page.locator('[data-rhythm-setting="bpm"]:visible').press('Tab');
    await module(page, 'tracks'); evidence.push(await contrast(page, `${choice}:tracks-empty`));
    await module(page, 'input'); evidence.push(await contrast(page, `${choice}:input-disconnected`));
    const cdp = await context.newCDPSession(page), { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin, browserContextId: targetInfo.browserContextId });
    await page.locator('[data-input-action="connect"]').click(); await page.getByTestId('input-error').waitFor(); evidence.push(await contrast(page, `${choice}:input-denied`)); await cdp.detach();
  }
  return { evidence, method: 'Computed RGB and actual ancestor backgrounds with alpha/opacity composition; sampled visible text >=4.5:1 and selected-module boundary >=3:1. Native permission denied before capture. Not a full WCAG certification.' };
});

check('meaningful-SVG-labels-fingers-focus-notation-and-TAB-masks-have-actual-contrast', async ({ page }) => {
  await ready(page); await studySettings(page); await page.getByLabel('Тоника', { exact: true }).selectOption('C'); await page.getByLabel('Структура', { exact: true }).selectOption('major');
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
  await sequence(page); await page.locator('[data-sequence-view="notation"]').click(); await page.locator('.notation-svg').waitFor();
  await page.getByLabel('Первая нота фрагмента', { exact: true }).fill('2'); await page.getByLabel('Первая нота фрагмента', { exact: true }).press('Tab');
  await page.getByLabel('Последняя нота фрагмента', { exact: true }).fill('4'); await page.getByLabel('Последняя нота фрагмента', { exact: true }).press('Tab');
  await page.locator('[data-player-action="start"]').click(); await page.waitForSelector('.notation-note.is-playing');
  for (const choice of ['light', 'dark']) {
    await theme(page, choice);
    const notation = await page.evaluate(() => {
      const rgb = value => { const a = value.match(/[\d.]+/g)?.map(Number); if (!a || a.length < 3) throw new Error(`Expected computed SVG RGB: ${value}`); return a.slice(0, 3); };
      const lum = values => values.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
      const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
      const paper = rgb(getComputedStyle(document.querySelector('.notation-scroll')).backgroundColor), cursor = document.querySelector('.notation-cursor'), cursorFill = rgb(getComputedStyle(cursor).fill), cursorStroke = rgb(getComputedStyle(cursor).stroke);
      const glyphs = [...document.querySelectorAll('.notation-svg text')].filter(text => text.textContent.trim()).map(text => {
        const fill = rgb(getComputedStyle(text).fill), playing = !!text.closest('.is-playing');
        return { glyph: text.textContent, playing, fill, ratio: playing ? Math.min(ratio(fill, paper), ratio(fill, cursorFill)) : ratio(fill, paper) };
      });
      const masks = [...document.querySelectorAll('.notation-note[data-notation-view="tab"] rect')].map(rect => ({ fill: rgb(getComputedStyle(rect).fill), stroke: getComputedStyle(rect).stroke }));
      return { paper, glyphs, masks, cursorRatio: Math.min(ratio(cursorStroke, paper), ratio(cursorStroke, cursorFill)), cursorOpacity: Number(getComputedStyle(cursor).opacity) };
    });
    assert.ok(notation.glyphs.length >= 16); assert.ok(notation.masks.length >= 8);
    assert.deepEqual(notation.glyphs.filter(glyph => glyph.ratio + .01 < 4.5), [], JSON.stringify({ choice, notation }));
    for (const mask of notation.masks) { assert.deepEqual(mask.fill, notation.paper); assert.equal(mask.stroke, 'none'); }
    assert.ok(notation.cursorRatio >= 3); assert.equal(notation.cursorOpacity, 1);
    evidence.push({ choice, notationGlyphs: notation.glyphs.length, minimumGlyphRatio: Math.min(...notation.glyphs.map(glyph => glyph.ratio)), masks: notation.masks.length, cursorRatio: notation.cursorRatio });
  }
  await page.locator('[data-player-action="stop"]').click();
  return { evidence, method: 'Actual computed SVG fills/strokes/gradient stops, circle/finger backgrounds and parent opacity; real running notation cursor and native VexFlow clearRect masks. No inverse filters or source-hex-only audit.' };
});

check('history-keyboard-focus-survives-four-rerender-actions-and-save-validation-error', async ({ page }) => {
  await ready(page); await module(page, 'foundation'); await page.locator('[data-training-mode="study"]').click(); await history(page);
  const note = page.getByLabel('Заметка к практике', { exact: true });
  for (let index = 0; index < 11; index++) {
    await note.fill(`Запись для проверки фокуса ${index + 1}`); await page.locator('[data-history-action="save-manual"]').click();
    await waitRaw(page, 'history', values => values.length === index + 1);
  }
  await page.locator('[data-history-action="show-more"]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'history-heading');
  await page.locator('[data-history-action="refresh-draft"]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.historyAction), 'refresh-draft');
  await note.fill('Черновик прежнего материала'); await page.locator('[data-training-mode="sequence"]').click();
  await page.locator('[data-history-action="use-current-draft"]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'manual-heading');
  const copy = await exportUi(page); await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles({ name: 'focus-preview.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) });
  await page.getByTestId('backup-preview').waitFor(); await page.locator('[data-history-action="cancel-restore"]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'backup-heading');
  await page.getByLabel('Название пресета', { exact: true }).fill(''); await page.locator('[data-history-action="save-preset"]').focus(); await page.keyboard.press('Enter');
  await page.getByTestId('history-error').waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'history-error');
  assert.match(await page.getByTestId('history-error').innerText(), /название/);
  const alertRect = await page.getByTestId('history-error').evaluate(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, viewport: innerHeight }; });
  assert.ok(alertRect.top >= 0 && alertRect.bottom <= alertRect.viewport, JSON.stringify(alertRect));
  await page.getByLabel('Комфортный темп', { exact: true }).fill(''); await page.locator('[data-history-action="save-manual"]').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-history-field') === 'manualBpm');
  const invalidRect = await page.getByLabel('Комфортный темп', { exact: true }).evaluate(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, invalid: element.getAttribute('aria-invalid') }; });
  assert.equal(invalidRect.invalid, 'true'); assert.ok(invalidRect.top >= 0 && invalidRect.bottom <= invalidRect.viewport, JSON.stringify(invalidRect));
  return { records: 11, showMore: 'history-heading', refreshDraft: 'same button', useCurrent: 'manual-heading', cancelRestore: 'backup-heading', validationFailure: 'focused visible alert/invalid field', alertRect, invalidRect };
});

check('history-disclosures-and-scroll-survive-draft-checkpoint-rerender', async ({ page }) => {
  await ready(page); await restoreUi(page, JSON.parse(await readFile(new URL('./fixtures/backup.json', import.meta.url), 'utf8')));
  await module(page, 'harmony'); await page.locator('[data-rhythm-action="start"]').click();
  await page.waitForFunction(() => document.querySelector('.rhythm-view')?.dataset.rhythmState === 'running');
  await history(page);
  const screen = page.locator('[data-history-kind="screen"]'), route = page.locator('[data-history-kind="route"]');
  const disclosures = [screen.locator('.history-question-details'), route.locator('.route-material-details'), page.locator('.history-context-groups')];
  for (const details of disclosures) { await details.locator(':scope > summary').click(); assert.ok(await details.evaluate(element => element.open)); }
  await screen.scrollIntoViewIfNeeded();
  // Обычный щелчок по тексту без фокуса уводит фокус из панели: так панель снова перерисовывается при сохранении черновика.
  await page.locator('#history-heading').click();
  const before = await page.evaluate(() => ({ scrollY, active: document.activeElement === document.body }));
  assert.ok(before.active, 'focus must leave the history body before the checkpoint');
  const marker = await screen.evaluate(element => { element.dataset.u4Probe = 'before'; return element.dataset.u4Probe; });
  const durationBefore = Object.fromEntries((await raw(page, 'practiceDrafts')).map(draft => [draft.id, draft.totalReferenceMs]));
  await waitRaw(page, 'practiceDrafts', values => values.some(draft => draft.totalReferenceMs > (durationBefore[draft.id] ?? 0)), 9000);
  await page.waitForFunction(() => !document.querySelector('[data-history-kind="screen"]')?.dataset.u4Probe, undefined, { timeout: 3000 });
  const after = await page.evaluate(() => ({ scrollY, open: [...document.querySelectorAll('.history-body details[open]')].map(element => element.className) }));
  for (const details of disclosures) assert.ok(await details.evaluate(element => element.open), `${await details.evaluate(element => element.className)} collapsed after draft checkpoint: ${JSON.stringify(after)}`);
  assert.ok(Math.abs(after.scrollY - before.scrollY) <= 1, `scroll moved: ${before.scrollY} → ${after.scrollY}`);
  await page.locator('[data-rhythm-action="pause"]').click();
  return { checkpointRerenderedPanel: marker === 'before', durationBefore, before, after };
});

check('laptop-widths-show-board-by-500px-and-narrow-layout-uses-local-scroll', async ({ page, resultDir, cdp }) => {
  await ready(page); const evidence = [];
  for (const width of [1366, 1024, 640]) {
    await page.setViewportSize({ width, height: 768 }); await theme(page, width === 1024 ? 'dark' : 'light');
    await module(page, 'foundation'); await page.locator('[data-training-mode="study"]').click();
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
  'themes-preserve-running-sequence-focus-and-authoritative-profile',
  'imported-system-profile-survives-binary-chooser-and-corrupt-first-frame-cache',
  'free-practice-choice-does-not-reopen-start-question-after-reload-or-restore',
  'meaningful-SVG-labels-fingers-focus-notation-and-TAB-masks-have-actual-contrast',
  // 11–15 с; сохранение ручных отметок с заметкой в быстром наборе проверяет history-keyboard-focus….
  'draft-note-autosaves-through-invalid-BPM-reload-save-and-confirmed-deletion',
], FULL_ONLY.smoke);
await runNotationBrowserChecks(checks, { reportName: 'p8-uiux-edge.json', scope: 'P8 actual product UI, themes and first frame, source contexts, guided introduction, exact boxes, persistent manual drafts, confirmation, sampled computed contrast, laptop widths and CDP page scale. Native IndexedDB is only read, media access is denied before capture, no physical bass/latency assessment.' });
