import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runNotationBrowserChecks } from './helpers/notation-browser-harness.mjs';

const checks = [];
const check = (name, scope, run) => checks.push({ name, scope, run });
const near = (actual, expected, epsilon = 0.01) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected}`);
const note = (page, index, view = 'staff') => page.locator(`[data-notation-view="${view}"][data-notation-index="${index}"]`);
const load = (page, name, duration = 'quarter') => page.evaluate(({ name, duration }) => window.p7notation.load(name, duration), { name, duration });
async function action(page, name) {
  await page.locator(`#${name}`).click();
  await page.waitForFunction(name => window.p7notation.action?.name === name && window.p7notation.action.done, name);
  assert.equal((await page.evaluate(() => window.p7notation.action)).error, null);
}
async function geometry(page) {
  return page.evaluate(() => {
    const line = path => {
      const match = /^M\s*([-\d.]+)[ ,]+([-\d.]+)\s*L\s*([-\d.]+)[ ,]+([-\d.]+)$/.exec(path.getAttribute('d') ?? '');
      return match && Number(match[2]) === Number(match[4]) ? { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]) - Number(match[1]) } : null;
    };
    const svg = document.querySelector('.notation-svg');
    return { height: svg.viewBox.baseVal.height,
      lines: [...svg.querySelectorAll('path')].map(line).filter(Boolean),
      staff: [...svg.querySelectorAll('[data-notation-view="staff"]')].map(group => {
        const head = group.querySelector('.vf-notehead text'), box = group.getBBox();
        return { index: Number(group.dataset.notationIndex), label: group.getAttribute('aria-label'), written: group.dataset.written,
          x: Number(head.getAttribute('x')), y: Number(head.getAttribute('y')), bbox: { y: box.y, bottom: box.y + box.height },
          ledger: [...group.querySelectorAll('path')].map(line).filter(Boolean),
          // VexFlow5 emits modifier text directly in the note group, without an
          // accidental wrapper. Inspect the rendered SMuFL glyphs themselves.
          accidentals: [...group.querySelectorAll('text')].flatMap(text => [...text.textContent].map(character => character.codePointAt(0))).filter(code => code >= 0xe260 && code <= 0xe264),
          flags: [...group.querySelectorAll('.vf-flag text')].map(text => text.textContent.codePointAt(0)) };
      }),
      tab: [...svg.querySelectorAll('[data-notation-view="tab"]')].map(group => ({ label: group.getAttribute('aria-label'), position: group.dataset.notationPosition,
        text: group.querySelector('text')?.textContent, y: Number(group.querySelector('text')?.getAttribute('y')) })),
    };
  });
}

check('hidden-view-loads-neither-fonts-nor-audio-until-first-show', 'fixture', async ({ page }) => {
  const initial = await page.evaluate(async () => { await window.p7notation.view.refreshContext(); return { hidden: document.querySelector('#notation').hidden, svg: document.querySelectorAll('svg').length, plan: window.p7notation.view.getPlan(), fonts: [...document.fonts].length, audioContexts: window.__notationAudioContexts.length }; });
  assert.deepEqual(initial, { hidden: true, svg: 0, plan: null, fonts: 0, audioContexts: 0 });
  await load(page, 'basic');
  const shown = await page.evaluate(() => ({ hidden: document.querySelector('#notation').hidden, noteGroups: document.querySelectorAll('[data-notation-index]').length, fonts: [document.fonts.check('16px Bravura'), document.fonts.check('16px Academico')], audioContexts: window.__notationAudioContexts.length }));
  assert.deepEqual(shown, { hidden: false, noteGroups: 6, fonts: [true, true], audioContexts: 0 }); return { initial, shown };
});

check('actual-svg-E0-has-E2-ledger-and-E5-A0-share-staff-but-not-tab', 'fixture', async ({ page }) => {
  await load(page, 'basic'); const result = await geometry(page);
  assert.match(result.staff[0].label, /записано E2, звучит E1/);
  const staffLines = result.lines.filter(line => line.width > 150).map(line => line.y).sort((a, b) => a - b).slice(0, 5);
  // VexFlow aligns the one-pixel staff stroke to a half-pixel; ledger/notehead
  // coordinates retain the integral diatonic grid (E2 ten pixels below G2).
  assert.equal(staffLines.length, 5); near(result.staff[0].y, staffLines[4] - 0.5 + 10);
  assert.equal(result.staff[0].ledger.length, 1); near(result.staff[0].ledger[0].y, result.staff[0].y);
  assert.match(result.staff[1].label, /записано A2, звучит A1/); near(result.staff[1].y, result.staff[2].y);
  assert.deepEqual(result.tab.map(item => [item.position, item.text]), [['E:0', '0'], ['E:5', '5'], ['A:0', '0']]);
  near(result.tab[1].y - result.tab[2].y, 13); return result;
});

check('actual-svg-enharmonic-letters-and-bar-accidental-natural-reset', 'fixture', async ({ page }) => {
  await load(page, 'enharmonic'); const enharmonic = await geometry(page);
  assert.deepEqual(enharmonic.staff.map(item => item.written), ['B♯2', 'C♭3']); near(enharmonic.staff[0].y - enharmonic.staff[1].y, 5);
  // SMuFL standard accidentals: sharpE262, naturalE261, flatE260.
  assert.deepEqual(enharmonic.staff.map(item => item.accidentals), [[0xe262], [0xe260]]);
  await load(page, 'accidentals'); const resetting = await geometry(page);
  assert.deepEqual(resetting.staff.map(item => item.accidentals), [[0xe262], [], [0xe261], [], [0xe262]]);
  assert.match(await page.locator('.notation-count').innerText(), /5 нот · 2 такта/);
  return { enharmonic, resetting };
});

check('all-100-positions-high-G5-ledgers-stay-in-real-SVG-bounds', 'fixture', async ({ page, resultDir }) => {
  await load(page, 'extremes', 'sixteenth'); const result = await geometry(page);
  assert.equal(result.staff.length, 100); assert.equal(result.tab.length, 100);
  assert.match(result.staff[99].label, /записано G5, звучит G4/); assert.equal(result.staff[99].ledger.length, 6);
  assert.ok(result.staff.every(item => item.bbox.y >= 0 && item.bbox.bottom <= result.height), 'Glyph/focus bounds clip the SVG viewport.');
  await page.evaluate(() => window.p7notation.view.setActiveIndex(99));
  await page.screenshot({ path: join(resultDir, 'p7-notation-high-g5.png'), fullPage: true }); return { count: result.staff.length, first: result.staff[0], last: result.staff[99], height: result.height, screenshot: 'test-results/p7-notation-high-g5.png' };
});

check('three-duration-glyphs-correct-bar-layout-and-partial-voice-with-no-rests', 'fixture', async ({ page }) => {
  const results = [];
  for (const [duration, notesPerBar, bars, flag] of [['quarter', 4, 5, null], ['eighth', 8, 3, 0xe240], ['sixteenth', 16, 2, 0xe242]]) {
    await load(page, 'rhythm', duration); const result = await geometry(page);
    assert.equal(result.staff.length, 17); assert.equal(result.tab.length, 17);
    assert.deepEqual(result.staff[0].flags, flag === null ? [] : [flag]);
    assert.ok(result.staff[notesPerBar].x > result.staff[notesPerBar - 1].x);
    assert.match(await page.locator('.notation-count').innerText(), new RegExp(`17 нот · ${bars} такт`));
    assert.match(await page.locator('.notation-status').innerText(), /Последний такт неполный/);
    assert.equal(await page.locator('.vf-stavenote').count(), 17, 'A partial measure must not invent a trailing note/rest.');
    results.push({ duration, flags: result.staff[0].flags, firstNextBar: result.staff[notesPerBar], notes: 17, bars });
  }
  return results;
});

check('selection-keyboard-repeated-index-cursor-and-fingerprint-reuse', 'fixture', async ({ page }) => {
  await load(page, 'repeated');
  await note(page, 0).click(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('End'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  const selection = await page.evaluate(() => ({ selections: window.p7notation.selections, focus: document.activeElement.dataset.notationIndex }));
  assert.equal(selection.focus, '0'); assert.deepEqual(selection.selections.map(item => item.index), [0, 1, 3, 0, 0]);
  const cursor = await page.evaluate(async () => {
    const svg = document.querySelector('svg'); window.p7notation.view.setActiveIndex(2); await window.p7notation.view.refreshContext();
    return { sameSVG: svg === document.querySelector('svg'), active: [...document.querySelectorAll('.notation-note.is-playing')].map(group => [Number(group.dataset.notationIndex), group.dataset.notationPosition]) };
  });
  assert.deepEqual(cursor, { sameSVG: true, active: [[2, 'E:0'], [2, 'E:0']] }); return { selection, cursor };
});

check('mobile-390-and-200-percent-scroll-stay-inside-page', 'fixture', async ({ page, resultDir }) => {
  await page.setViewportSize({ width: 390, height: 900 }); await load(page, 'extremes', 'sixteenth');
  const before = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth, region: document.querySelector('.notation-scroll').getBoundingClientRect().width })); assert.ok(before.page <= before.width + 1);
  await page.screenshot({ path: join(resultDir, 'p7-notation-mobile.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; window.p7notation.view.setActiveIndex(99); });
  const zoom = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth, notes: document.querySelectorAll('[data-notation-view="staff"]').length, scrollLeft: document.querySelector('.notation-scroll').scrollLeft }));
  assert.ok(zoom.page <= zoom.width + 1); assert.equal(zoom.notes, 100); assert.ok(zoom.scrollLeft > 0);
  await page.screenshot({ path: join(resultDir, 'p7-notation-200-percent.png'), fullPage: true }); return { before, zoom };
});

check('real-audio-clock-fragment-cursor-count-in-pause-stop-with-one-player', 'fixture', async ({ page }) => {
  await load(page, 'chromatic', 'eighth');
  await page.evaluate(() => { window.p7notation.playback = { range: { from: 1, toExclusive: 3 }, countIn: true }; });
  await action(page, 'start');
  const countIn = await page.evaluate(() => ({ snapshot: window.p7notation.snapshot(), active: document.querySelectorAll('.notation-note.is-playing').length }));
  assert.equal(countIn.snapshot.phase, 'count-in'); assert.equal(countIn.active, 0);
  await page.waitForFunction(() => window.p7notation.snapshot()?.phase === 'practice', undefined, { timeout: 6000 });
  const rows = await page.evaluate(async () => {
    const rows = [], started = performance.now();
    while (performance.now() - started < 1100) {
      await new Promise(resolve => requestAnimationFrame(resolve)); const snapshot = window.p7notation.snapshot();
      const note = snapshot.trace.filter(item => item.type === 'note' && !item.cancelled && item.time <= snapshot.audioTime).at(-1);
      if (note && snapshot.audioTime - note.time > 0.04) rows.push({ index: snapshot.noteIndex, position: snapshot.positionId, rms: snapshot.output.rms, eventTime: note.time, audioTime: snapshot.audioTime,
        notation: [...document.querySelectorAll('.notation-note.is-playing')].map(group => [Number(group.dataset.notationIndex), group.dataset.notationPosition]) });
    }
    return { rows, contexts: window.__notationAudioContexts.length };
  });
  assert.equal(rows.contexts, 1); assert.ok(rows.rows.length > 10); assert.ok(rows.rows.some(row => row.rms > 0.001));
  assert.deepEqual([...new Set(rows.rows.map(row => row.index))].sort(), [1, 2]);
  for (const row of rows.rows) assert.deepEqual(row.notation, [[row.index, row.position], [row.index, row.position]]);
  await action(page, 'pause');
  // The fixture deliberately supplies its shared-player cursor from RAF. Wait
  // for that real render frame instead of racing the click's resolved promise.
  await page.waitForFunction(() => document.querySelectorAll('.notation-note.is-playing').length === 0, undefined, { polling: 'raf', timeout: 1500 });
  assert.equal(await page.locator('.notation-note.is-playing').count(), 0);
  await action(page, 'resume'); await page.waitForSelector('.notation-note.is-playing');
  await action(page, 'stop'); await page.waitForFunction(() => document.querySelectorAll('.notation-note.is-playing').length === 0, undefined, { polling: 'raf', timeout: 1500 }); assert.equal(await page.locator('.notation-note.is-playing').count(), 0);
  return { countIn: { phase: countIn.snapshot.phase, active: 0 }, ...rows };
});

async function setupApp(page, { pattern = 'ascending', countIn = false, duration = 'eighth' } = {}) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
  const free = page.locator('[data-intro="free"]'); if (await free.isVisible()) await free.click();
  const area = page.locator('#area-settings'); if (!await area.evaluate(element => element.open)) await area.locator(':scope > summary').click();
  await page.getByLabel('Тоника', { exact: true }).selectOption('C'); await page.getByLabel('Структура', { exact: true }).selectOption('major');
  await page.getByLabel('Первый лад', { exact: true }).fill('0'); await page.getByLabel('Первый лад', { exact: true }).press('Tab');
  await page.getByLabel('Последний лад', { exact: true }).fill('3'); await page.getByLabel('Последний лад', { exact: true }).press('Tab');
  for (const string of ['E', 'A', 'D', 'G']) await page.getByRole('checkbox', { name: `Струна ${string}`, exact: true }).setChecked(string === 'E');
  const contexts = await page.evaluate(() => window.__notationAudioContexts.length);
  await page.locator('[data-training-mode="sequence"]').click(); await page.getByLabel('Материал последовательности', { exact: true }).selectOption('chromatic');
  await page.getByLabel('Порядок последовательности', { exact: true }).selectOption(pattern);
  assert.ok(await page.locator('.fretboard-section').isVisible(), 'The sequence opens on its fretboard view.');
  assert.ok(await page.locator('#notation-mount').isHidden());
  await page.locator('[data-sequence-view="notation"]').click();
  await page.locator('#notation-mount [data-notation-index="0"]').first().waitFor();
  assert.equal(await page.evaluate(() => window.__notationAudioContexts.length), contexts, 'Showing notation created another audio context.');
  const bpm = page.locator('#player-mount').getByLabel('Темп, BPM', { exact: true });
  await page.getByLabel('Длительность нот', { exact: true }).selectOption(duration);
  await bpm.fill('120'); await bpm.press('Tab');
  await page.getByLabel('Отсчёт перед стартом', { exact: true }).setChecked(countIn); await page.locator('#player-mount').getByLabel('Повтор', { exact: true }).selectOption('infinite');
  return contexts;
}
async function appSamples(page, milliseconds = 1300) {
  return page.evaluate(async ms => {
    const rows = [], started = performance.now();
    while (performance.now() - started < ms) {
      const player = document.querySelector('#player-mount'), index = player.dataset.noteIndex, position = player.dataset.currentPosition;
      if (position) rows.push({ index: Number(index), position, board: [...document.querySelectorAll('#fretboard-container .position.is-playing')].map(group => group.dataset.position),
        route: [...document.querySelectorAll('.sequence-route li.is-playing')].map(item => Number(item.dataset.sequenceIndex)),
        notation: [...document.querySelectorAll('#notation-mount .notation-note.is-playing')].map(group => [Number(group.dataset.notationIndex), group.dataset.notationPosition]) });
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return rows;
  }, milliseconds);
}
function consistent(rows) {
  assert.ok(rows.length > 10);
  for (const row of rows) { assert.deepEqual(row.board, [row.position]); assert.deepEqual(row.route, [row.index]); assert.deepEqual(row.notation, [[row.index, row.position], [row.index, row.position]]); }
}
const appAction = (page, name) => page.locator(`[data-player-action="${name}"]`);

check('built-app-three-score-arrows-keep-focus-enter-and-return-are-explicit', 'ui', async ({ page }) => {
  await setupApp(page);
  await note(page, 0).focus();
  const rows = [];
  for (const expected of [1, 2, 3]) {
    await page.keyboard.press('ArrowRight');
    const actual = await page.evaluate(() => ({ index: document.activeElement?.dataset.notationIndex, inScore: !!document.activeElement?.closest('#notation-mount'), visible: !document.querySelector('#notation-mount').hidden, boardVisible: !document.querySelector('.fretboard-section').hidden }));
    assert.equal(actual.index, String(expected)); assert.equal(actual.inScore, true); assert.equal(actual.visible, true); assert.equal(actual.boardVisible, false); rows.push(actual);
  }
  await page.keyboard.press('Enter');
  assert.ok(await page.locator('.fretboard-section').isVisible());
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.position), 'E:3');
  await page.getByRole('button', { name: 'Вернуться к выбранной ноте в записи', exact: true }).click();
  assert.ok(await page.locator('#notation-mount').isVisible());
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.notationIndex), '3');
  return { rows, explicitBoardPosition: 'E:3', restoredScoreIndex: 3 };
});

check('built-app-one-shared-sequence-cursor-with-repeated-positions', 'ui', async ({ page, resultDir }) => {
  const initialContexts = await setupApp(page, { pattern: 'groups-of-three' });
  assert.deepEqual(await page.locator('.sequence-route li').evaluateAll(items => items.map(item => item.dataset.sequencePosition)), ['E:0', 'E:1', 'E:2', 'E:1', 'E:2', 'E:3']);
  await appAction(page, 'start').click(); await page.waitForSelector('#notation-mount .notation-note.is-playing');
  const rows = await appSamples(page, 1700); consistent(rows); assert.ok(new Set(rows.map(row => row.index)).size >= 5);
  assert.ok(await page.evaluate(() => window.__notationAudioContexts.length) <= initialContexts + 1);
  await page.screenshot({ path: join(resultDir, 'p7-notation-app-playing.png'), fullPage: true });
  await appAction(page, 'pause').click(); assert.equal(await page.locator('#notation-mount .notation-note.is-playing').count(), 0);
  await appAction(page, 'resume').click(); await page.waitForSelector('#notation-mount .notation-note.is-playing');
  await appAction(page, 'stop').click(); assert.equal(await page.locator('#notation-mount .notation-note.is-playing').count(), 0); return { rows, screenshot: 'test-results/p7-notation-app-playing.png' };
});

check('built-app-fragment-uses-absolute-indices-across-repeated-passes', 'ui', async ({ page }) => {
  await setupApp(page, { pattern: 'groups-of-three' });
  await page.getByLabel('Первая нота фрагмента', { exact: true }).fill('2'); await page.getByLabel('Последняя нота фрагмента', { exact: true }).fill('4');
  await appAction(page, 'start').click(); await page.waitForSelector('#notation-mount .notation-note.is-playing');
  assert.match(await page.getByTestId('notation-fragment').innerText(), /ноты 2–4.*обе границы включены.*счёт метронома продолжается/);
  assert.deepEqual(await page.locator('#notation-mount [data-notation-view="staff"].outside-fragment').evaluateAll(nodes => nodes.map(node => Number(node.dataset.notationIndex))), [0, 4, 5]);
  assert.equal(await note(page, 1).getAttribute('data-fragment-boundary'), 'start');
  assert.equal(await note(page, 3).getAttribute('data-fragment-boundary'), 'end');
  assert.match(await page.getByTestId('notation-playback').innerText(), /Звучащий такт.*доля.*повтор/);
  const rows = await appSamples(page, 1700); consistent(rows);
  assert.deepEqual([...new Set(rows.map(row => row.index))].sort(), [1, 2, 3]);
  await appAction(page, 'stop').click(); return { indices: [1, 2, 3], rows };
});

check('built-app-count-in-and-pulse-off-never-leak-notation-highlight', 'ui', async ({ page }) => {
  await setupApp(page, { countIn: true }); await appAction(page, 'start').click();
  await page.waitForFunction(() => document.querySelector('#player-mount').dataset.playerState === 'running');
  assert.equal(await page.locator('#player-mount').getAttribute('data-player-phase'), 'count-in'); assert.equal(await page.locator('#notation-mount .notation-note.is-playing').count(), 0);
  await appAction(page, 'pause').click(); assert.equal(await page.locator('#notation-mount .notation-note.is-playing').count(), 0);
  await appAction(page, 'resume').click(); await page.waitForSelector('#notation-mount .notation-note.is-playing', { timeout: 5000 });
  await appAction(page, 'stop').click();
  await page.getByLabel('Отсчёт перед стартом', { exact: true }).uncheck(); await page.getByLabel('Показывать пульс', { exact: true }).uncheck(); await appAction(page, 'start').click();
  await page.waitForFunction(() => document.querySelector('#player-mount').dataset.playerPhase === 'practice'); await delay(400);
  assert.equal(await page.locator('#notation-mount .notation-note.is-playing').count(), 0); await appAction(page, 'stop').click();
  return { noHighlightDuringCountInPauseOrPulseOff: true };
});

check('built-dist-serves-exact-code-and-two-font-license-notices-locally', 'ui', async ({ page, root, origin }) => {
  const results = [];
  for (const name of ['vexflow-LICENSE.txt', 'Bravura-LICENSE.txt', 'Academico-LICENSE.txt']) {
    const expected = await readFile(join(root, 'public/licenses', name), 'utf8');
    const response = await page.request.get(`${origin}/licenses/${name}`); assert.equal(response.status(), 200);
    const actual = await response.text(); assert.equal(actual, expected); assert.match(actual, name.startsWith('vexflow') ? /Permission is hereby granted, free of charge/ : /SIL OPEN FONT LICENSE Version 1.1/);
    results.push({ name, bytes: Buffer.byteLength(actual) });
  }
  await setupApp(page); assert.ok(await page.locator('#notation-mount .notation-svg').count());
  return { licenses: results, fonts: await page.evaluate(() => [document.fonts.check('16px Bravura'), document.fonts.check('16px Academico')]) };
});

await runNotationBrowserChecks(checks);
