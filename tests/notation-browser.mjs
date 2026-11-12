import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runNotationBrowserChecks } from './helpers/notation-browser-harness.mjs';
import { markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';

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

// Экран игры (P13-03/P13-08): нотная запись приложения — SVG-TAB по плану `createNotationPlan`; нотный стан VexFlow
// проверяется изолированной fixture выше. Курсор TAB, текущая нота на грифе и текст прогресса — одна общая позиция.
const playScene = page => page.locator('[data-lesson-screen="play"] .pl-scene');
const playStatus = (page, status, timeout = 10000) => page.waitForFunction(value => document.querySelector('[data-lesson-screen="play"] .pl-scene')?.dataset.status === value, status, { timeout });
async function openLibraryExercise(page, title, view) {
  await page.waitForFunction(() => document.querySelector('[data-lesson-screen="home"] .ls-plan, [data-lesson-screen="home"] .ls-hero'), null, { timeout: 20000 });
  const home = page.locator('[data-lesson-screen="home"]');
  await home.getByRole('tab', { name: /^Библиотека/ }).click();
  await home.getByRole('button', { name: `Играть: ${title}`, exact: true }).click();
  await playScene(page).locator('[data-title]').waitFor();
  assert.equal(await playScene(page).locator('[data-title]').innerText(), title);
  await playScene(page).locator(`[data-view="${view}"]`).click();
  await playScene(page).locator(`[data-view="${view}"][aria-pressed="true"]`).waitFor();
}
/** Снимки по кадрам: номер из текста прогресса, курсор TAB и текущая позиция на грифе вида «TAB и гриф». */
async function playSamples(page, milliseconds) {
  return page.evaluate(async ms => {
    const rows = [], started = performance.now();
    const scene = document.querySelector('[data-lesson-screen="play"] .pl-scene');
    while (performance.now() - started < ms) {
      const match = /Нота (\d+) из (\d+)/.exec(scene.querySelector('[data-progress-text]').textContent);
      const tab = [...scene.querySelectorAll('[data-tab="both"] .pl-tab-fret.is-current')].map(text => ({ index: Number(text.dataset.index), id: `${text.dataset.string}:${text.textContent}` }));
      rows.push({ status: scene.dataset.status, note: match ? Number(match[1]) : null, tab, cursors: scene.querySelectorAll('[data-tab="both"] .pl-tab-cursor').length,
        board: [...scene.querySelectorAll('[data-board="both"] .pl-note.is-current')].map(group => group.dataset.position) });
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return rows;
  }, milliseconds);
}

check('built-app-play-tab-frets-count-labels-and-bar-lines-follow-the-exercise', 'ui', async ({ page }) => {
  await openLibraryExercise(page, 'Хроматика 1-2-3-4 в позиции', 'both');
  const tab = await playScene(page).locator('[data-tab="both"] svg').evaluate(svg => ({
    label: svg.getAttribute('aria-label'),
    frets: [...svg.querySelectorAll('.pl-tab-fret')].map(text => ({ index: Number(text.dataset.index), string: text.dataset.string, fret: Number(text.textContent) })),
    counts: [...svg.querySelectorAll('.pl-tab-count')].map(text => text.textContent),
    bars: [...svg.querySelectorAll('[data-bar-line]')].map(line => Number(line.dataset.barLine)),
    strings: [...svg.querySelectorAll('.pl-tab-string')].map(text => text.textContent),
    cursors: svg.querySelectorAll('.pl-tab-cursor').length,
  }));
  // Независимо: пальцы 1-2-3-4 на ладах 5–8 по струнам E, A, D, G — шестнадцать восьмых, два такта 4/4.
  const expected = ['E', 'A', 'D', 'G'].flatMap(string => [5, 6, 7, 8].map(fret => ({ string, fret })));
  assert.deepEqual(tab.frets.map(({ string, fret }) => ({ string, fret })), expected);
  assert.deepEqual(tab.frets.map(item => item.index), expected.map((_, index) => index));
  assert.deepEqual(tab.counts, Array.from({ length: 2 }, () => ['1', 'и', '2', 'и', '3', 'и', '4', 'и']).flat());
  assert.deepEqual(tab.bars, [1]); assert.deepEqual(tab.strings, ['G', 'D', 'A', 'E']);
  assert.equal(tab.cursors, 0, 'До старта курсора нет'); assert.equal(tab.label, 'Табулатура, такты 1–2');
  assert.match(await playScene(page).locator('[data-sub]').innerText(), /^16 восьмых · 2 такта/);
  return tab;
});

check('built-app-play-one-shared-cursor-for-tab-board-and-progress-with-repeated-positions', 'ui', async ({ page }) => {
  await openLibraryExercise(page, 'Группы по три', 'both');
  assert.equal(await playScene(page).locator('[data-flag="countIn"]').getAttribute('aria-pressed'), 'true');
  await playScene(page).locator('[data-play]').click();
  await playStatus(page, 'counting');
  const counting = await playSamples(page, 300);
  assert.ok(counting.filter(row => row.status === 'counting').every(row => !row.tab.length && !row.cursors && !row.board.length), 'В отсчёте нет курсора нот');
  await playStatus(page, 'playing');
  const rows = (await playSamples(page, 2600)).filter(row => row.status === 'playing' && row.note);
  assert.ok(rows.length > 20, `Снимков игры: ${rows.length}`);
  for (const row of rows) {
    assert.equal(row.tab.length, 1, JSON.stringify(row)); assert.equal(row.cursors, 1);
    assert.equal(row.tab[0].index, row.note - 1, `TAB и прогресс: ${JSON.stringify(row)}`);
    assert.deepEqual(row.board, [row.tab[0].id], `Гриф и TAB: ${JSON.stringify(row)}`);
  }
  const indices = [...new Set(rows.map(row => row.tab[0].index))];
  assert.ok(indices.length >= 4, `Курсор прошёл ноты ${indices.join(',')}`);
  const byIndex = new Map(rows.map(row => [row.tab[0].index, row.tab[0].id]));
  // Группы по три повторяют позиции (n+1, n+2 в следующей группе): курсор — по номеру события, а не по позиции.
  assert.ok(byIndex.has(1) && byIndex.has(3), `Курсор прошёл события 1 и 3: ${indices.join(',')}`);
  assert.equal(byIndex.get(1), byIndex.get(3), 'Повторная позиция — отдельное событие TAB');
  await page.keyboard.press('Space');
  await playStatus(page, 'paused');
  const paused = await playSamples(page, 400);
  assert.equal(new Set(paused.map(row => row.tab[0]?.index)).size, 1, 'Пауза держит курсор на месте');
  await page.keyboard.press('Escape');
  await playStatus(page, 'stopped');
  const stopped = await playSamples(page, 200);
  assert.ok(stopped.every(row => !row.tab.length && !row.board.length), 'После «С начала» курсора нет');
  return { indices, repeated: { index1: byIndex.get(1), index3: byIndex.get(3) }, pausedAt: paused[0].tab[0]?.index };
});

check('built-dist-serves-exact-code-and-two-font-license-notices-locally', 'ui', async ({ page, root, origin }) => {
  const results = [];
  for (const name of ['vexflow-LICENSE.txt', 'Bravura-LICENSE.txt', 'Academico-LICENSE.txt']) {
    const expected = await readFile(join(root, 'public/licenses', name), 'utf8');
    const response = await page.request.get(`${origin}/licenses/${name}`); assert.equal(response.status(), 200);
    const actual = await response.text(); assert.equal(actual, expected); assert.match(actual, name.startsWith('vexflow') ? /Permission is hereby granted, free of charge/ : /SIL OPEN FONT LICENSE Version 1.1/);
    results.push({ name, bytes: Buffer.byteLength(actual) });
  }
  return { licenses: results };
});

markFullOnly(checks, [
  'real-audio-clock-fragment-cursor-count-in-pause-stop-with-one-player',
], FULL_ONLY.liveAudio);
markFullOnly(checks, [
  'all-100-positions-high-G5-ledgers-stay-in-real-SVG-bounds',
  'mobile-390-and-200-percent-scroll-stay-inside-page',
  'built-app-play-one-shared-cursor-for-tab-board-and-progress-with-repeated-positions',
], FULL_ONLY.smoke);
await runNotationBrowserChecks(checks);
