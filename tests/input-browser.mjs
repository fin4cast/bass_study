import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runInputBrowserChecks } from './helpers/input-browser-harness.mjs';
import { markFullOnly, FULL_ONLY } from './helpers/browser-case.mjs';

const checks = [];
const check = (name, scope, run, options = {}) => checks.push({ name, scope, run, ...options });
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) < tolerance, `Expected ${expected} ± ${tolerance}, got ${actual}`);
const snap = page => page.evaluate(() => window.p7input.monitor.getSnapshot());
const calls = page => page.evaluate(() => window.__inputObservations.calls.length);
const liveTracks = page => page.evaluate(() => window.__inputObservations.streams.flatMap(stream => stream.getTracks()).filter(track => track.readyState === 'live').length);
const action = (page, name) => page.locator(`[data-input-action="${name}"]`);
async function fixtureAction(page, name) {
  await page.locator(`#${name}`).click();
  await page.waitForFunction(name => window.p7input.action?.name === name && window.p7input.action.done, name);
  return page.evaluate(() => window.p7input.action.error);
}
async function allow(context, origin) { await context.grantPermissions(['microphone'], { origin }); }
async function startFixture(page, context, fixtureOrigin) {
  await allow(context, fixtureOrigin); assert.equal(await fixtureAction(page, 'start'), null);
  await page.waitForFunction(() => window.p7input.monitor.getSnapshot().state === 'running' && window.p7input.monitor.getSnapshot().pitch !== null);
}
async function ready(page) { await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert); const free = page.locator('[data-intro="free"]'); if (await free.isVisible()) await free.click(); }
async function openInput(page) { await ready(page); await page.locator('[data-app-module="input"]').click(); await page.getByTestId('input-status').waitFor(); }
async function stateIs(page, state) { await page.waitForFunction(state => document.querySelector('#input-mount')?.dataset.inputState === state, state); }
async function connectUi(page, context, origin) { await allow(context, origin); await action(page, 'connect').click(); await stateIs(page, 'running'); await page.waitForFunction(() => document.querySelector('[data-testid="input-note"]').textContent !== '—'); }
async function openHistory(page) { const drawer = page.locator('.history-drawer'); if (!await drawer.evaluate(element => element.open)) await page.locator('#open-history').click(); await page.getByLabel('Название пресета', { exact: true }).waitFor(); }
async function saved(page) { await page.waitForFunction(() => document.querySelector('[data-testid="history-save-status"]')?.dataset.status === 'saved'); }
async function exportUi(page) { await openHistory(page); const downloading = page.waitForEvent('download'); await page.locator('[data-history-action="export"]').click(); const download = await downloading; return JSON.parse(await readFile(await download.path(), 'utf8')); }

check('native-enumeration-does-not-request-permission-or-start-capture', 'api', async ({ page }) => {
  const permissionBefore = await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state);
  const devices = await page.evaluate(() => window.p7input.monitor.listDevices());
  assert.ok(devices.every(device => typeof device.id === 'string' && typeof device.label === 'string'));
  assert.equal(await calls(page), 0); assert.equal(await liveTracks(page), 0); assert.equal((await snap(page)).state, 'stopped');
  const permissionAfter = await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state);
  assert.equal(permissionAfter, permissionBefore); return { devices, permissionBefore, permissionAfter, getUserMediaCalls: 0 };
});

check('native-A1-capture-reports-actual-settings-and-silent-analysis-branches', 'api', async ({ page, context, fixtureOrigin }) => {
  await startFixture(page, context, fixtureOrigin); await page.waitForFunction(() => window.p7input.monitor.getSnapshot().pitch?.voiced);
  const state = await snap(page); near(state.pitch.hz, 55, .35); assert.equal(state.pitch.nearestMidi, 33);
  assert.equal(state.requested.channelCount.ideal, 1); assert.equal(state.requested.echoCancellation, false); assert.equal(state.requested.autoGainControl, false); assert.equal(state.requested.noiseSuppression, false);
  const nativeSettings = await page.evaluate(() => window.__inputObservations.streams[0].getAudioTracks()[0].getSettings()); assert.deepEqual(state.settings, nativeSettings);
  near(state.pitch.windowMs, 8192 / state.context.sampleRate * 1000, .0001); assert.ok(state.context.sampleRate >= 8000); // частота общего контекста — частота устройства, без принуждения
  const destinationEdges = await page.evaluate(() => window.__inputObservations.connections.filter(edge => edge.destination === 'AudioDestinationNode'));
  assert.ok(destinationEdges.length > 0); assert.ok(destinationEdges.every(edge => edge.source === 'GainNode' && edge.gain === 0));
  assert.equal(await calls(page), 1); assert.equal(state.trackCount, 1); await fixtureAction(page, 'stop'); assert.equal(await liveTracks(page), 0);
  return { state, nativeSettings, destinationEdges, capture: 'Chromium fake WAV only; permission explicitly granted to fixture origin' };
});

check('native-low-E1-WAV-keeps-sounding-octave', 'api', async ({ page, context, fixtureOrigin }) => {
  await startFixture(page, context, fixtureOrigin); await page.waitForFunction(() => window.p7input.monitor.getSnapshot().pitch?.voiced);
  const state = await snap(page); near(state.pitch.hz, 41.2034446141, .35); assert.equal(state.pitch.nearestMidi, 28); await fixtureAction(page, 'stop'); return state.pitch;
}, { signal: 'low-e' });

check('native-dominant-harmonic-WAV-retains-fundamental-or-refuses-ambiguity', 'api', async ({ page, context, fixtureOrigin }) => {
  await startFixture(page, context, fixtureOrigin); await delay(350); const state = await snap(page);
  if (state.pitch.voiced) { near(state.pitch.hz, 41.2034446141, .5); assert.equal(state.pitch.nearestMidi, 28); }
  else { assert.equal(state.pitch.reason, 'uncertain'); assert.ok(state.pitch.confidence < .5); }
  await fixtureAction(page, 'stop'); return state.pitch;
}, { signal: 'harmonics' });

check('native-noise-WAV-is-not-invented-as-a-bass-note', 'api', async ({ page, context, fixtureOrigin }) => {
  await startFixture(page, context, fixtureOrigin); await delay(250); const state = await snap(page); assert.equal(state.pitch.voiced, false); assert.equal(state.pitch.hz, null); assert.ok(state.pitch.confidence < .5); await fixtureAction(page, 'stop'); return state.pitch;
}, { signal: 'noise' });

check('native-500Hz-WAV-is-refused-outside-diagnostic-range', 'api', async ({ page, context, fixtureOrigin }) => {
  await startFixture(page, context, fixtureOrigin); await delay(250); const state = await snap(page); assert.equal(state.pitch.voiced, false); assert.equal(state.pitch.reason, 'out-of-range'); await fixtureAction(page, 'stop'); return state.pitch;
}, { signal: 'out-of-range' });

check('native-clipped-WAV-has-real-peak-and-clipping-flag', 'api', async ({ page, context, fixtureOrigin }) => {
  await startFixture(page, context, fixtureOrigin); await page.waitForFunction(() => window.p7input.monitor.getSnapshot().level.clipping);
  const state = await snap(page); assert.ok(state.level.peak >= .999); assert.ok(state.level.clippedSamples > 0); await fixtureAction(page, 'stop'); return state.level;
}, { signal: 'clipping' });

check('native-three-restarts-stop-and-dispose-release-every-acquired-track', 'api', async ({ page, context, fixtureOrigin }) => {
  await allow(context, fixtureOrigin); const runs = [];
  for (let i = 0; i < 3; i++) { assert.equal(await fixtureAction(page, 'start'), null); await page.waitForFunction(() => window.p7input.monitor.getSnapshot().state === 'running'); assert.equal(await liveTracks(page), 1); await fixtureAction(page, 'stop'); assert.equal(await liveTracks(page), 0); runs.push(await snap(page)); }
  await fixtureAction(page, 'dispose'); assert.equal((await snap(page)).state, 'disposed'); assert.equal(await liveTracks(page), 0); assert.equal(await calls(page), 3); return { runs, calls: 3, liveTracksAfterDispose: 0 };
});

check('native-unavailable-exact-device-fails-without-auto-retry', 'api', async ({ page, context, fixtureOrigin }) => {
  await allow(context, fixtureOrigin); await page.evaluate(() => { window.p7input.options = { deviceId: 'bass-study-missing-device' }; });
  const error = await fixtureAction(page, 'start'); assert.equal(error.code, 'DEVICE_CONSTRAINT'); const state = await snap(page); assert.equal(state.state, 'error'); assert.equal(state.trackCount, 0); await delay(250); assert.equal(await calls(page), 1); return { error, state, autoRetry: false };
});

check('ui-mount-navigation-refresh-and-reload-never-start-capture', 'ui', async ({ page }) => {
  await ready(page); assert.equal(await calls(page), 0); await openInput(page); await action(page, 'refresh').click(); await delay(200); assert.equal(await calls(page), 0); assert.equal(await liveTracks(page), 0);
  assert.match(await page.getByTestId('input-device-help').innerText(), /разрешения|выбери|Выбери|пока нет/); await page.reload(); await ready(page); assert.equal(await calls(page), 0); assert.equal(await liveTracks(page), 0); return { mountCaptureCalls: 0, refreshCaptureCalls: 0, reloadCaptureCalls: 0 };
});

check('ui-first-open-and-return-do-not-claim-the-visible-section-is-closed', 'ui', async ({ page }) => {
  await openInput(page);
  assert.ok(await page.getByTestId('input-notice').isHidden());
  assert.match(await page.getByTestId('input-status').innerText(), /Вход не подключён/);
  assert.ok(!/Раздел закрыт/.test(await page.locator('#input-mount').innerText()));
  await page.locator('[data-app-module="tracks"]').click();
  await openInput(page);
  assert.ok(await page.getByTestId('input-notice').isHidden());
  assert.equal(await calls(page), 0); assert.equal(await liveTracks(page), 0);
  return { firstOpenNoticeHidden: true, returnedNoticeHidden: true, captureCalls: 0 };
});

check('ui-explicit-connect-displays-Hz-note-confidence-and-separate-track-context-settings', 'ui', async ({ page, context, origin }) => {
  await openInput(page); await connectUi(page, context, origin); assert.equal(await page.getByTestId('input-note').innerText(), 'A1'); near(Number((await page.getByTestId('input-hz').innerText()).replace(',', '.')), 55, .4);
  await page.locator('.input-diagnostics').evaluate(element => { element.open = true; });
  await page.locator('.input-level-card .input-card-explainer > summary').click();
  await page.locator('.input-pitch-card .input-card-explainer > summary').click();
  assert.match(await page.getByTestId('input-context').innerText(), /Частота AudioContext/); const windowText = await page.getByTestId('input-window').innerText(); const [, rateText, msText] = windowText.match(/8192 отсчёта \/ ([\d\s  ]+) Гц = ([\d,]+) мс/) ?? []; assert.ok(rateText, windowText); assert.equal(msText, (8192 / Number(rateText.replace(/\D/g, '')) * 1000).toFixed(2).replace('.', ',')); assert.match(await page.locator('.input-diagnostics').innerText(), /не измеряют сквозную задержку/); assert.match(await page.locator('.input-confidence').innerText(), /Эвристика/); assert.match(await page.locator('.input-card-help').last().innerText(), /не является вероятностью/);
  const levelHelp = await page.locator('.input-level-card .input-card-help').innerText();
  assert.match(levelHelp, /RMS — среднеквадратичный уровень сигнала за окно/);
  assert.match(levelHelp, /пик — его кратковременный максимум/);
  assert.match(levelHelp, /dBFS отсчитывает уровень от цифрового предела 0 dBFS: отрицательные значения ниже предела/);
  const track = await page.evaluate(() => window.__inputObservations.streams[0].getAudioTracks()[0].getSettings()); const rows = await page.getByTestId('input-settings').innerText(); for (const key of ['sampleRate', 'channelCount']) if (track[key] !== undefined) assert.match(rows, new RegExp(String(track[key])));
  await action(page, 'stop').click(); assert.equal(await liveTracks(page), 0); return { trackSettings: track, hz: 55, soundingNote: 'A1', levelHelp, getUserMediaCalls: await calls(page), latencyMeasured: false };
});

check('ui-denied-native-permission-is-visible-and-not-automatically-retried', 'ui', async ({ page, context, origin }) => {
  await openInput(page); const cdp = await context.newCDPSession(page); const { targetInfo } = await cdp.send('Target.getTargetInfo'); await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin, browserContextId: targetInfo.browserContextId });
  await action(page, 'connect').click(); await stateIs(page, 'error'); assert.match(await page.getByTestId('input-error').innerText(), /не разрешил/); await delay(300); assert.equal(await calls(page), 1); assert.equal(await liveTracks(page), 0); return { permission: 'native CDP denied on isolated origin', calls: 1, tracks: 0 };
});

check('ui-cancel-pending-native-acquisition-reaps-late-returned-tracks', 'ui', async ({ page, context, origin }) => {
  await openInput(page); await allow(context, origin); await page.evaluate(() => { window.__inputObservations.delayMs = 450; }); await action(page, 'connect').click(); await stateIs(page, 'starting'); await action(page, 'stop').click(); await stateIs(page, 'stopped');
  // Ждём по событиям, а не по времени: настоящий getUserMedia на fake-устройстве под нагрузкой отвечает за 0,1–2 с.
  await page.waitForFunction(() => window.__inputObservations.streams.length === 1, undefined, { timeout: 10000 });
  await page.waitForFunction(() => window.__inputObservations.streams[0].getTracks().every(track => track.readyState === 'ended'), undefined, { timeout: 3000 });
  assert.equal(await liveTracks(page), 0); assert.equal(await calls(page), 1); await delay(100); await stateIs(page, 'stopped'); return { nativeAcquisitionDelayedOnlyByObserver: true, cancelledState: 'stopped', lateTracksReleased: true };
});

check('ui-device-selection-stops-current-input-and-requires-new-connect', 'ui', async ({ page, context, origin }) => {
  await openInput(page); await connectUi(page, context, origin); await action(page, 'refresh').click();
  const picker = page.locator('[data-input-setting="deviceId"]'); await page.waitForFunction(() => document.querySelector('[data-input-setting=deviceId]').options.length > 1); const selected = await picker.locator('option').evaluateAll(elements => elements.find(element => element.value)?.value); assert.ok(selected); await picker.selectOption(selected); await stateIs(page, 'stopped'); assert.equal(await liveTracks(page), 0); await delay(250); assert.equal(await calls(page), 1); assert.match(await page.getByTestId('input-notice').innerText(), /снова нажми/); await saved(page); return { selectedDeviceId: selected, stoppedTracks: true, automaticReconnect: false };
});

check('ui-native-track-ended-event-releases-input-and-shows-explanation', 'ui', async ({ page, context, origin }) => {
  await openInput(page); await connectUi(page, context, origin); await page.evaluate(() => window.__inputObservations.streams[0].getAudioTracks()[0].dispatchEvent(new Event('ended'))); await stateIs(page, 'error'); assert.equal(await liveTracks(page), 0); assert.match(await page.getByTestId('input-error').innerText(), /отключён|завершён/); await delay(200); assert.equal(await calls(page), 1); return { method: 'Controlled ended event on native fake MediaStreamTrack; no physical unplug claim', released: true, automaticReconnect: false };
});

check('ui-device-preferences-preset-reload-and-schema-five-restore-never-capture', 'ui', async ({ page, context, origin }) => {
  await openInput(page); await allow(context, origin); await action(page, 'refresh').click(); const picker = page.locator('[data-input-setting="deviceId"]'); await page.waitForFunction(() => document.querySelector('[data-input-setting=deviceId]').options.length > 1); const selected = await picker.locator('option').evaluateAll(elements => elements.find(element => element.value)?.value); await picker.selectOption(selected); await saved(page);
  await openHistory(page); await page.getByLabel('Название пресета', { exact: true }).fill('USB диагностический вход'); await page.locator('[data-history-action="save-preset"]').click(); await page.locator('[data-apply-preset]').first().waitFor(); await picker.selectOption(''); await saved(page); await page.locator('[data-apply-preset]').first().click(); await saved(page); assert.equal(await picker.inputValue(), selected); assert.equal(await calls(page), 0);
  const before = await exportUi(page); assert.equal(before.schemaVersion, 11); assert.equal(before.preferences.input.deviceId, selected); assert.equal(before.presets[0].preferences.input.deviceId, selected); assert.equal(before.history.length, 0);
  await page.reload(); await ready(page); assert.equal(await picker.inputValue(), selected); assert.equal(await calls(page), 0);
  await openHistory(page); await page.locator('[data-history-file]').setInputFiles({ name: 'input-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(before)) }); await page.getByTestId('backup-preview').waitFor(); assert.equal(await calls(page), 0); await page.getByRole('checkbox', { name: 'Понимаю, что текущие данные будут заменены', exact: true }).check(); await page.locator('[data-history-action="confirm-restore"]').click(); await page.getByTestId('backup-preview').waitFor({ state: 'detached' }); assert.equal(await calls(page), 0); assert.equal(await liveTracks(page), 0); assert.deepEqual(await exportUi(page), before); return { schemaVersion: before.schemaVersion, selectedDeviceId: selected, exactRoundtrip: true, captureCallsDuringPresetReloadRestore: 0, historyEntries: 0 };
});

check('ui-retirement-releases-writer-only-after-late-acquired-input-tracks-ended', 'ui', async ({ page, context, origin }) => {
  await openInput(page); await allow(context, origin);
  const next = await context.newPage(); await next.goto(origin);
  await next.waitForFunction(() => document.querySelector('main')?.inert && !document.querySelector('#retry-tab')?.hidden);
  await page.bringToFront();
  // Настоящая fake-дорожка уже захвачена, но её выдача задержана: подключение ещё в состоянии «starting».
  await page.evaluate(() => { window.__inputObservations.delayMs = 1000; });
  await action(page, 'connect').click(); await stateIs(page, 'starting');
  await page.waitForFunction(() => window.__inputObservations.streams.length === 1);
  // Документ остаётся живым, вызывается только слушатель завершения страницы (как в release-browser).
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  // waitForFunction не дожидается Promise из предиката, поэтому опрос Web Locks идёт отсюда.
  const writerHeld = () => next.evaluate(async () => (await navigator.locks.query()).held.some(lock => lock.name === 'bass-study:writer'));
  const deadline = Date.now() + 6000; while (await writerHeld()) { assert.ok(Date.now() < deadline, 'writer lease was not released after retirement'); await delay(5); }
  const atRelease = await page.evaluate(() => window.__inputObservations.streams.flatMap(stream => stream.getTracks()).map(track => track.readyState));
  assert.deepEqual(atRelease, ['ended'], 'writer lease was released while the acquired input track was still live');
  await next.close();
  return { tracksAtWriterRelease: atRelease, getUserMediaCalls: await calls(page) };
});

check('ui-module-leave-stops-native-tracks-and-return-does-not-auto-connect', 'ui', async ({ page, context, origin }) => {
  await openInput(page); await connectUi(page, context, origin); await page.locator('[data-app-module="foundation"]').click(); assert.equal(await liveTracks(page), 0); await page.locator('[data-app-module="input"]').click(); await stateIs(page, 'stopped'); await delay(250); assert.equal(await calls(page), 1); return { liveTracksAfterExit: 0, noAutoConnectOnReturn: true };
});

check('ui-noise-uncertainty-layout-and-non-grading-labels-are-visible', 'ui', async ({ page, context, origin, resultDir }) => {
  await openInput(page); await allow(context, origin); await action(page, 'connect').click(); await stateIs(page, 'running'); await page.waitForFunction(() => /периодичности|неоднозначна/.test(document.querySelector('[data-testid=input-uncertainty]').textContent)); assert.equal(await page.getByTestId('input-note').innerText(), '—'); assert.equal(await page.getByTestId('input-hz').innerText(), '—'); assert.match(await page.locator('.input-intro').innerText(), /не оценивает игру/);
  const sizes = []; for (const width of [1366, 800, 390]) { await page.setViewportSize({ width, height: 1000 }); await delay(100); const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert.equal(size.document, width); sizes.push(size); }
  await page.locator('.input-diagnostics').evaluate(element => { element.open = true; }); await page.screenshot({ path: join(resultDir, 'p7-input-narrow.png'), fullPage: true }); await action(page, 'stop').click(); return { sizes, uncertainWithoutInventedNote: true, screenshot: 'test-results/p7-input-narrow.png', automaticGrading: false };
}, { signal: 'noise' });

check('native-real-hidden-tab-stops-all-tracks-and-return-needs-explicit-connect', 'native', async ({ withNativeBrowser, origin }) => withNativeBrowser(async ({ page, context }) => {
  await openInput(page); await connectUi(page, context, origin); const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront(); await page.waitForFunction(() => document.hidden && document.querySelector('#input-mount').dataset.inputState === 'stopped', undefined, { polling: 100 }); assert.equal(await liveTracks(page), 0); await page.bringToFront(); await page.waitForFunction(() => !document.hidden); await delay(250); assert.equal(await calls(page), 1); await action(page, 'connect').click(); await stateIs(page, 'running'); assert.equal(await calls(page), 2); await action(page, 'stop').click(); assert.equal(await liveTracks(page), 0); return { actualDocumentHidden: true, method: 'Isolated Edge/CDP noDefaults:true with native fake WAV device; real tab activation', stoppedTracks: true, explicitReconnectRequired: true };
}));

markFullOnly(checks, [
  'native-real-hidden-tab-stops-all-tracks-and-return-needs-explicit-connect',
], FULL_ONLY.hiddenTab);
markFullOnly(checks, [
  'native-low-E1-WAV-keeps-sounding-octave',
  'native-dominant-harmonic-WAV-retains-fundamental-or-refuses-ambiguity',
  'native-500Hz-WAV-is-refused-outside-diagnostic-range',
  'native-clipped-WAV-has-real-peak-and-clipping-flag',
  'native-three-restarts-stop-and-dispose-release-every-acquired-track',
  'native-unavailable-exact-device-fails-without-auto-retry',
  'ui-first-open-and-return-do-not-claim-the-visible-section-is-closed',
  'ui-device-selection-stops-current-input-and-requires-new-connect',
  'ui-native-track-ended-event-releases-input-and-shows-explanation',
  'ui-device-preferences-preset-reload-and-schema-five-restore-never-capture',
  'ui-module-leave-stops-native-tracks-and-return-does-not-auto-connect',
  'ui-noise-uncertainty-layout-and-non-grading-labels-are-visible',
], FULL_ONLY.smoke);
await runInputBrowserChecks(checks);
