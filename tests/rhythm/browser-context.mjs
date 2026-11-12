import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export { go, currentSection, openData, exported, previewCopy, cancelCopy, confirmCopy, restoreCopy, openDrafts } from '../helpers/shell-data-ui.mjs';
import { go } from '../helpers/shell-data-ui.mjs';

export const currentCopy = JSON.parse(await readFile(new URL('../fixtures/backup.json', import.meta.url), 'utf8'));

export const root = page => page.getByTestId('rhythm-view');
export const playingField = page => root(page).locator('.rhythm-playing-field:visible');
export const settingsToggle = page => root(page).locator('button[data-page-settings-toggle]');
export const settingsAside = page => root(page).locator('[data-rhythm-panel]:visible .rhythm-side-scroll');
export const action = (page, name) => root(page).locator(`[data-rhythm-action="${name}"]`);
export const setting = (page, name) => root(page).locator(`[data-rhythm-setting="${name}"]:visible`);
export const output = (page, name) => root(page).locator(`[data-rhythm-output="${name}"]`);
export const choice = (page, name, value) => root(page).locator(`[data-rhythm-choice="${name}"][data-rhythm-value="${value}"]`);
export const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
export const desktopDockHeightLimit = 184;

export async function assertSettings(page, open) {
  const toggle = settingsToggle(page), aside = settingsAside(page);
  const id = await aside.getAttribute('id');
  assert.ok(id);
  assert.equal(await toggle.getAttribute('aria-controls'), id);
  assert.equal(await toggle.getAttribute('aria-expanded'), String(open));
  assert.equal(await aside.isVisible(), open);
  return id;
}

export async function setSettings(page, open) {
  const toggle = settingsToggle(page);
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.press('Enter');
  return assertSettings(page, open);
}

export async function openGroup(page, selector) {
  const group = root(page).locator(selector);
  assert.equal(await group.evaluate(node => node.open), false);
  await group.locator(':scope > summary').press('Enter');
  assert.equal(await group.evaluate(node => node.open), true);
}

export async function meterFieldCoverage(page, count) {
  const coverage = await playingField(page).evaluate(field => {
    const rows = [];
    const groupBounds = [];
    const keyWidths = [];
    for (const group of field.querySelectorAll('.rhythm-beat-group')) {
      const bounds = group.getBoundingClientRect();
      const key = group.querySelector('.rhythm-beat').getBoundingClientRect();
      groupBounds.push(bounds);
      keyWidths.push(key.width / bounds.width);
      let row = rows.find(item => Math.abs(item.top - bounds.top) < 1);
      if (!row) { row = { top: bounds.top, left: bounds.left, right: bounds.right }; rows.push(row); }
      row.left = Math.min(row.left, bounds.left);
      row.right = Math.max(row.right, bounds.right);
    }
    const height = Math.max(...groupBounds.map(bounds => bounds.bottom)) - Math.min(...groupBounds.map(bounds => bounds.top));
    return {
      count: groupBounds.length,
      rows: rows.length,
      width: Math.min(...rows.map(row => (row.right - row.left) / field.clientWidth)),
      height: height / field.clientHeight,
      keyWidth: Math.min(...keyWidths),
    };
  });
  assert.equal(coverage.count, count);
  assert.ok(coverage.width >= .90 && coverage.height >= .80 && coverage.keyWidth >= .80, `Meter groups fill the field: ${JSON.stringify(coverage)}`);
  return coverage;
}

export async function ready(page) {
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('main').inert);
}
export async function enter(page) {
  await ready(page);
  await go(page, 'harmony');
  await root(page).waitFor();
}
export async function edit(page, name, value) {
  const field = setting(page, name);
  await field.fill(String(value));
  await field.press('Tab');
}
export async function state(page, expected) {
  await page.waitForFunction(value => document.querySelector('.rhythm-view')?.dataset.rhythmState === value, expected);
}
export async function start(page) {
  await action(page, 'start').click();
  await state(page, 'running');
}
export async function raw(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study');
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Readonly reader encountered a missing database')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const stores = [...db.objectStoreNames];
      const transaction = db.transaction(stores, 'readonly');
      const done = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
      const get = request => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const preferences = transaction.objectStore('preferences');
      const [current, exercises, history, profile, practiceDrafts, rhythmProjects, activeRhythmProjectId] = await Promise.all([
        get(preferences.get('current')),
        stores.includes('exercises') ? get(transaction.objectStore('exercises').getAll()) : [],
        get(transaction.objectStore('history').getAll()),
        get(transaction.objectStore('profile').get('current')),
        get(transaction.objectStore('practiceDrafts').getAll()),
        stores.includes('rhythmProjects') ? get(transaction.objectStore('rhythmProjects').getAll()) : [],
        get(preferences.get('rhythm-selection')),
      ]);
      await done;
      return { version: db.version, stores, preferences: current, exercises, history, profile, practiceDrafts, rhythmProjects, activeRhythmProjectId: activeRhythmProjectId ?? null };
    } finally { db.close(); }
  });
}
export async function seedDatabase(page, origin, snapshot) {
  const response = await page.goto(`${origin}/vendor/music-bank/patch-manifest.json`);
  assert.equal(response.status(), 200);
  assert.equal(await page.locator('.site-header').count(), 0);
  await page.evaluate(async ({ snapshot, origin }) => {
    if (location.origin !== origin) throw new Error('Unexpected test origin');
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('bass-study');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Isolated test database is still open'));
    });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bass-study', snapshot.schemaVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        // Порядок создания хранилищ схемы 11: preferences, profile, exercises, history, practiceDrafts, rhythmProjects.
        if (snapshot.schemaVersion !== 11) throw new Error('Only the current schema 11 layout is seeded here');
        const preferences = db.createObjectStore('preferences');
        preferences.put(snapshot.preferences, 'current');
        if (snapshot.activeRhythmProjectId) preferences.put(snapshot.activeRhythmProjectId, 'rhythm-selection');
        db.createObjectStore('profile').put(snapshot.profile, 'current');
        const stores = ['exercises', 'history', 'practiceDrafts', 'rhythmProjects'];
        for (const name of stores) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          for (const value of snapshot[name]) store.put(value);
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
  }, { snapshot, origin });
}

export async function observe(context) {
  await context.addInitScript(() => {
    const Original = window.AudioContext;
    const contexts = [];
    const analysers = [];
    window.AudioContext = new Proxy(Original, {
      construct(target, args) {
        const context = Reflect.construct(target, args);
        contexts.push(context);
        return context;
      },
    });
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...ports) {
      if (destination === this.context.destination) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        connect.call(this, analyser);
        analysers.push(analyser);
      }
      return connect.call(this, destination, ...ports);
    };
    window.__rhythmObservation = {
      count: () => contexts.length,
      // Аудиочасы страницы: после resume() устройство вывода может стартовать с задержкой, пока currentTime стоит.
      audioTime: () => Math.max(0, ...contexts.filter(context => context.state === 'running').map(context => context.currentTime)),
      async sample(ms) {
        const end = performance.now() + ms;
        let peak = 0;
        let samples = 0;
        while (performance.now() < end) {
          for (const analyser of analysers) {
            const data = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(data);
            for (const value of data) peak = Math.max(peak, Math.abs(value));
            samples += data.length;
          }
          await new Promise(resolve => setTimeout(resolve, 12));
        }
        return { peak, samples };
      },
    };
  });
}
export const sample = (page, ms = 550) => page.evaluate(ms => window.__rhythmObservation.sample(ms), ms);
export const audioTime = page => page.evaluate(() => window.__rhythmObservation.audioTime());
/** Ждёт по аудиочасам, а не по времени Node: звук и учёт практики идут по currentTime. */
export async function untilAudio(page, target, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (let now = await audioTime(page); now < target; now = await audioTime(page)) {
    assert.ok(Date.now() < deadline, `Audio clock stuck at ${now.toFixed(3)} s before ${target.toFixed(3)} s`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return audioTime(page);
}
