import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, action, output, ready, enter, edit, state, start, openGroup, openHistory, raw, seedDatabase, literalV7 } from './browser-context.mjs';

export const nativeChecks = [];
const check = (name, scope, run) => nativeChecks.push({ name, scope, run });

check('native-p12-rhythm-retry-commits-project-while-profile-write-still-fails', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await enter(page);
  await page.locator('[data-theme-choice="light"]').click();
  await root(page).locator('[data-rhythm-mode="rhythm"]').click();
  await openGroup(page, '.rhythm-library');
  await action(page, 'new-project').click();
  const rows = output(page, 'projects');
  const selected = rows.locator('[data-rhythm-open-project][aria-pressed="true"]');
  await selected.waitFor();
  const previous = await selected.getAttribute('data-rhythm-open-project');
  const before = await raw(page);
  assert.equal(before.profile.theme, 'light');
  assert.equal(before.activeRhythmProjectId, previous);

  await page.evaluate(() => {
    const fault = window.p12RhythmFault = { profile: true, rhythm: true, profileAborts: 0, rhythmAborts: 0, projectPuts: 0 };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args), transaction = this.transaction;
      if (transaction.db.name !== 'bass-study') return request;
      if (this.name === 'rhythmProjects' && fault.rhythm) request.addEventListener('success', () => { fault.projectPuts++; });
      if (this.name === 'preferences' && args[1] === 'rhythm-selection' && fault.rhythm) request.addEventListener('success', () => {
        fault.rhythmAborts++;
        transaction.abort();
      });
      if (this.name === 'profile' && fault.profile) request.addEventListener('success', () => {
        fault.profileAborts++;
        transaction.abort();
      });
      return request;
    };
  });
  await page.locator('[data-theme-choice="dark"]').click();
  const retry = page.locator('#retry-save');
  await retry.waitFor();
  await action(page, 'new-project').click();
  await page.waitForFunction(() => document.querySelector('[data-rhythm-library-error="true"]'));
  assert.equal(await action(page, 'new-project').isDisabled(), true);
  assert.deepEqual(await raw(page), before);

  await page.evaluate(() => { window.p12RhythmFault.rhythm = false; });
  await retry.click();
  await page.waitForFunction(previous => {
    const button = document.querySelector('[data-rhythm-open-project][aria-pressed="true"]');
    return button && button.dataset.rhythmOpenProject !== previous && !document.querySelector('[data-rhythm-action="new-project"]').disabled;
  }, previous);
  const committed = await raw(page), next = await selected.getAttribute('data-rhythm-open-project');
  assert.equal(committed.activeRhythmProjectId, next);
  assert.equal(committed.rhythmProjects.length, 2);
  assert.equal(committed.profile.theme, 'light');
  assert.equal(await retry.isVisible(), true);
  assert.deepEqual(await page.evaluate(() => {
    const { profileAborts, rhythmAborts, projectPuts } = window.p12RhythmFault;
    return { profileAborts, rhythmAborts, projectPuts };
  }), { profileAborts: 2, rhythmAborts: 1, projectPuts: 1 });

  await rows.locator(`[data-rhythm-open-project="${previous}"]`).click();
  await selected.and(rows.locator(`[data-rhythm-open-project="${previous}"]`)).waitFor();
  assert.equal((await raw(page)).activeRhythmProjectId, previous);
  assert.equal(await retry.isVisible(), true);
  await page.evaluate(() => { window.p12RhythmFault.profile = false; });
  await retry.click();
  await retry.waitFor({ state: 'hidden' });
  assert.equal((await raw(page)).profile.theme, 'dark');
  return { rhythmRollbackAfterProjectAndSelectionPut: true, selectedProjectAfterRetry: true, independentProfileError: true, libraryUsableBeforeProfileRecovery: true };
}));

check('native-p12-restore-and-retry-are-exclusive-and-post-commit-hydration-requires-reload', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await ready(page);
  await page.locator('[data-theme-choice="light"]').click();
  await openHistory(page);
  assert.equal((await raw(page)).profile.theme, 'light');
  const copy = JSON.parse(await readFile(new URL('../fixtures/v10-backup.json', import.meta.url), 'utf8'));
  copy.preferences.activeModule = 'input';
  copy.profile.theme = 'light';
  await page.locator('[data-history-file]').setInputFiles({ name: 'p12-post-commit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) });
  const preview = page.getByTestId('backup-preview');
  const confirm = page.locator('[data-history-action="confirm-restore"]');
  await preview.waitFor();
  await page.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
  await page.evaluate(() => {
    const probe = window.p12RestoreProbe = { profileAttempts: 0, restoredWrites: 0, attemptedRestoreDuringRetry: false, retryDisabledDuringRestore: false, mainInertDuringRestore: false, restoreCommitted: false, hydrationFailures: 0 };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args), transaction = this.transaction;
      if (transaction.db.name !== 'bass-study' || this.name !== 'profile') return request;
      request.addEventListener('success', () => {
        if (transaction.objectStoreNames.length > 1) {
          probe.restoredWrites++;
          const retry = document.querySelector('#retry-save');
          probe.retryDisabledDuringRestore = retry.disabled;
          probe.mainInertDuringRestore = document.querySelector('main').inert;
          // Synthetic dispatch deliberately bypasses the disabled DOM control.
          retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } else if (++probe.profileAttempts === 1) transaction.abort();
        else if (probe.profileAttempts === 2) {
          probe.attemptedRestoreDuringRetry = true;
          document.querySelector('[data-history-action="confirm-restore"]').click();
        }
      });
      return request;
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      const tx = transaction.call(this, stores, mode, ...args);
      if (this.name === 'bass-study' && mode === 'readwrite' && tx.objectStoreNames.length > 1) {
        tx.addEventListener('complete', () => { probe.restoreCommitted = true; });
      }
      return tx;
    };
    const computedStyle = window.getComputedStyle;
    window.getComputedStyle = function (target, ...args) {
      if (target === document.documentElement && probe.restoreCommitted && !probe.hydrationFailures) {
        probe.hydrationFailures++;
        throw new Error('Fixture: post-commit theme hydration');
      }
      return computedStyle.call(this, target, ...args);
    };
  });

  await page.locator('[data-theme-choice="dark"]').click();
  const retry = page.locator('#retry-save');
  await retry.waitFor();
  await retry.click();
  const historyError = page.getByTestId('history-error');
  await historyError.filter({ hasText: 'Дождись завершения сохранения перед восстановлением.' }).waitFor();
  assert.equal(await preview.isVisible(), true);
  await retry.waitFor({ state: 'hidden' });
  assert.equal((await raw(page)).profile.theme, 'dark');
  assert.equal(await page.evaluate(() => window.p12RestoreProbe.restoredWrites), 0);

  await confirm.click();
  const reloadMessage = 'Данные восстановлены. Перезагрузи страницу, чтобы применить настройки.';
  await page.locator('#persistence-message').filter({ hasText: reloadMessage }).waitFor();
  await preview.waitFor({ state: 'detached' });
  await historyError.filter({ hasText: reloadMessage }).waitFor();
  assert.doesNotMatch(await page.getByTestId('history-save-status').innerText(), /изменения не подтверждены/);
  assert.equal(await confirm.count(), 0);
  assert.equal(await page.locator('main').getAttribute('aria-busy'), 'true');
  assert.deepEqual(await page.evaluate(() => window.p12RestoreProbe), {
    profileAttempts: 2, restoredWrites: 1, attemptedRestoreDuringRetry: true,
    retryDisabledDuringRestore: true, mainInertDuringRestore: true, restoreCommitted: true, hydrationFailures: 1,
  });
  const committed = await raw(page);
  assert.deepEqual(committed.profile, copy.profile);
  assert.deepEqual(committed.preferences, copy.preferences);
  await page.locator('#retry-tab').click();
  await ready(page);
  assert.equal(await page.locator('[data-app-module="input"]').getAttribute('aria-current'), 'page');
  assert.deepEqual(await raw(page), committed);
  return { restoreBlockedDuringRetry: true, retryBlockedDuringRestore: true, nativeCommitBeforeHydrationError: true, candidateConsumed: true, reloadUsesCommittedData: true };
}));

check('native-real-hidden-tab-pauses-until-explicit-resume', 'native', async ({ withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await enter(page);
  await start(page);
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.waitForFunction(() => document.hidden);
  await state(page, 'paused');
  await page.bringToFront();
  await page.waitForFunction(() => !document.hidden);
  await state(page, 'paused');
  await action(page, 'resume').click();
  await state(page, 'running');
  return { actualDocumentHidden: true, noAutomaticResume: true };
}));

check('native-upgrade-seven-to-ten-keeps-legacy-history-and-drafts', 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await seedDatabase(page, origin, literalV7);
  const before = await raw(page);
  assert.equal(before.version, 7);
  await page.goto(origin);
  await ready(page);
  const after = await raw(page);
  assert.deepEqual(after, {
    ...before, version: 10, stores: [...before.stores, 'rhythmProjects'].sort(),
    preferences: { ...before.preferences, rhythm: null },
    presets: before.presets.map(preset => ({ ...preset, preferences: { ...preset.preferences, rhythm: null } })),
  });
  await openHistory(page);
  const legacy = before.practiceDrafts.find(item => item.material.kind === 'harmony');
  assert.ok(legacy);
  await page.getByLabel('Черновики ручной практики', { exact: true }).selectOption(legacy.id);
  await page.locator('[data-history-action="save-manual"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-history-kind="manual"]').length >= 2);
  const saved = (await raw(page)).history.find(item => item.id.startsWith('manual-') && !before.history.some(old => old.id === item.id));
  assert.deepEqual(saved.result.material, legacy.material);
  assert.deepEqual(saved.result.context, legacy.context);
  assert.equal(saved.occurredAt, legacy.createdAt);
  await page.locator('#open-history').click();
  await enter(page);
  await edit(page, 'bpm', 113);
  await root(page).locator('[data-rhythm-mode="rhythm"]').click();
  await root(page).locator('[data-rhythm-step]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-rhythm-output="projects"] [data-rhythm-open-project]'));
  const projectBeforePreset = (await raw(page)).rhythmProjects[0];
  await page.locator('[data-app-module="foundation"]').click();
  await openHistory(page);
  await page.locator('[data-apply-preset="fixture-harmony-preset"]').click();
  await root(page).waitFor();
  assert.equal(await root(page).locator('[data-rhythm-mode="rhythm"]').getAttribute('aria-selected'), 'true');
  const afterPreset = await raw(page);
  assert.deepEqual(afterPreset.rhythmProjects, [projectBeforePreset]);
  assert.equal(afterPreset.activeRhythmProjectId, projectBeforePreset.id);
  assert.equal(afterPreset.preferences.rhythm.metronome.bpm, 113);
  return { version: after.version, historyPreserved: before.history.length, draftsPreserved: before.practiceDrafts.length, savedLegacyDuration: saved.result.durationMs, legacyPresetPreservesRhythm: true };
}));

function legacyRhythmSnapshot(version) {
  const project = (id, name, bars) => {
    const steps = Array.from({ length: bars * 16 }, (_, index) => index % 16 === Math.floor(index / 16) ? 1 : 0);
    const channels = [
      { id: 'kick', name: 'Бочка', sound: 'kick', volume: .8, muted: false, solo: false },
      { id: 'snare', name: 'Малый', sound: 'snare', volume: .65, muted: false, solo: false },
    ];
    return {
      id, name, createdAt: '2026-11-08T22:30:00.000Z', updatedAt: '2026-11-08T22:30:01.000Z',
      bpm: 107, swing: 53, swingMode: 'eighth',
      channels,
      patterns: [{ id: 'A', name, bars, lanes: channels.map(channel => ({ channelId: channel.id, steps, velocities: steps.map(step => step * .63) })) }],
      chain: [{ id: 'clip-1', patternId: 'A' }], activePatternId: 'A', scope: 'pattern', repeat: 'once', countIn: true, overlay: false,
    };
  };
  const selected = project(`v${version}-rhythm-selected`, `Выбранный проект из версии ${version}`, version === 8 ? 4 : 3);
  const rhythm = {
    view: 'rhythm', master: .76, metronome: {
      bpm: 117, bpmUnit: 'quarter', meter: { beats: 4, denominator: 4, groups: [4] }, accents: [2, 1, 1, 1],
      division: 1, substeps: [], swing: 50, swingMode: 'eighth', kit: 'wood', accentVolume: .8, clickVolume: .8, subdivisionVolume: .35,
      countIn: false, training: { silentEnabled: false, soundBars: 3, silentBars: 1, rampEnabled: false, stepBpm: 2, everyBars: 8, targetBpm: 120 },
    },
  };
  const material = { kind: 'rhythm', playback: { preferences: rhythm, project: selected } };
  const oldDraft = literalV7.practiceDrafts.find(item => item.material.kind === 'harmony');
  const oldHistory = literalV7.history.find(item => item.result.kind === 'manual');
  return {
    ...literalV7, schemaVersion: version, preferences: { ...literalV7.preferences, rhythm },
    presets: literalV7.presets.map(preset => ({ ...preset, preferences: { ...preset.preferences, rhythm: null } })),
    practiceDrafts: [...literalV7.practiceDrafts, { ...oldDraft, id: `v${version}-rhythm-draft`, context: null, material }],
    history: [...literalV7.history, { ...oldHistory, id: `v${version}-rhythm-history`, result: { ...oldHistory.result, context: null, material } }],
    rhythmProjects: [project(`v${version}-rhythm-first`, `Один такт из версии ${version}`, 1), selected], activeRhythmProjectId: selected.id,
  };
}

for (const version of [8, 9]) {
  check(`native-upgrade-v${version}-to-v10-keeps-rhythm-projects-and-practice`, 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
    const snapshot = legacyRhythmSnapshot(version);
    const selected = snapshot.rhythmProjects.find(project => project.id === snapshot.activeRhythmProjectId);
    const factory = { hit: 72, accent: 100 };
    const migrateProject = (project, defaultsFor = () => factory) => ({
      ...project, channels: project.channels.map(channel => ({ ...channel, velocityDefaults: defaultsFor(channel) })),
    });
    const migrateMaterial = material => material?.kind === 'rhythm'
      ? { ...material, playback: { ...material.playback, project: migrateProject(material.playback.project) } }
      : material;
    await seedDatabase(page, origin, snapshot);
    const before = await raw(page);
    assert.equal(before.version, version);
    assert.equal(before.activeRhythmProjectId, selected.id);
    assert.deepEqual(before.rhythmProjects, snapshot.rhythmProjects);

    if (version === 9) {
      await page.evaluate(() => {
        localStorage.setItem('bass-study.rhythm.new-hit-velocity', '68');
        localStorage.setItem('bass-study.rhythm.track-velocity:["kick","kick"]', '{"hit":59,"accent":81}');
        sessionStorage.setItem('p10-rhythm-upgrade-fault', 'pending');
      });
      await context.addInitScript(origin => {
        if (location.origin !== origin || sessionStorage.getItem('p10-rhythm-upgrade-fault') !== 'pending') return;
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          const request = put.apply(this, args);
          const transaction = this.transaction;
          if (this.name === 'rhythmProjects' && transaction.mode === 'versionchange' && transaction.db.name === 'bass-study' && transaction.db.version === 10) {
            request.addEventListener('success', () => {
              sessionStorage.setItem('p10-rhythm-upgrade-fault', 'aborted');
              transaction.abort();
            }, { once: true });
          }
          return request;
        };
      }, origin);
      await page.goto(origin);
      await ready(page);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('p10-rhythm-upgrade-fault')), 'aborted');
      assert.deepEqual(await raw(page), before);
    }

    await page.goto(origin);
    await ready(page);
    const after = await raw(page);
    const expectedProjects = before.rhythmProjects.map(project => migrateProject(project, channel => {
      if (version === 8) return factory;
      return channel.id === 'kick' && channel.sound === 'kick' ? { hit: 59, accent: 81 } : { hit: 68, accent: 100 };
    }));
    assert.deepEqual(after, {
      ...before, version: 10, rhythmProjects: expectedProjects,
      practiceDrafts: before.practiceDrafts.map(draft => ({ ...draft, material: migrateMaterial(draft.material) })),
      history: before.history.map(entry => entry.result.material?.kind === 'rhythm'
        ? { ...entry, result: { ...entry.result, material: migrateMaterial(entry.result.material) } }
        : entry),
    });
    await root(page).waitFor();
    assert.equal(await output(page, 'pattern-title').innerText(), selected.name);
    assert.equal(await output(page, 'bars').getByRole('button', { name: `Такт ${selected.patterns[0].bars}`, exact: true }).isVisible(), true);

    if (version === 9) {
      await page.evaluate(() => {
        localStorage.setItem('bass-study.rhythm.new-hit-velocity', '31');
        localStorage.removeItem('bass-study.rhythm.track-velocity:["kick","kick"]');
      });
      await page.reload();
      await ready(page);
      assert.deepEqual(await raw(page), after);
      await openHistory(page);
      await page.locator('[data-history-file]').setInputFiles({ name: 'legacy-v9-rhythm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) });
      await page.getByTestId('backup-preview').waitFor();
      await page.getByLabel('Понимаю, что текущие данные будут заменены', { exact: true }).check();
      await page.locator('[data-history-action="confirm-restore"]').click();
      await page.getByTestId('backup-preview').waitFor({ state: 'detached' });
      const imported = await raw(page);
      assert.equal(imported.activeRhythmProjectId, selected.id);
      assert.deepEqual(imported.rhythmProjects, before.rhythmProjects.map(project => migrateProject(project)));
      assert.deepEqual(imported.practiceDrafts, after.practiceDrafts);
      assert.deepEqual(imported.history, after.history);
    }

    return { fromVersion: version, version: after.version, activeRhythmProjectId: selected.id, projectsPreserved: after.rhythmProjects.length, historyAndDraftDefaults: factory,
      ...(version === 9 && { abortAfterPutRolledBack: true, nativeBrowserDefaultsSeededOnce: true, legacyJsonUsesFactoryDefaults: true }) };
  }));
}

check('native-upgrade-abort-after-successful-cursor-update-retains-version-seven', 'native', async ({ origin, withNativeBrowser }) => withNativeBrowser(async ({ page, context }) => {
  await seedDatabase(page, origin, literalV7);
  const before = await raw(page);
  await context.addInitScript(() => {
    const update = IDBCursorWithValue.prototype.update;
    window.__rhythmUpgradeWrites = 0;
    IDBCursorWithValue.prototype.update = function (...args) {
      const request = update.apply(this, args);
      const transaction = this.source.transaction;
      if (transaction?.db.name === 'bass-study' && transaction.db.version === 10) request.addEventListener('success', () => {
        window.__rhythmUpgradeWrites++;
        transaction.abort();
      });
      return request;
    };
  });
  await page.goto(origin);
  await ready(page);
  assert.equal(await page.evaluate(() => window.__rhythmUpgradeWrites), 1);
  assert.deepEqual(await raw(page), before);
  return { successfulCursorUpdate: 1, databaseVersionAfterAbort: 7 };
}));

check('native-project-restore-validates-chain-and-rolls-back-after-project-and-selection-put', 'native', async ({ fixtureOrigin, withNativeBrowser }) => withNativeBrowser(async ({ page }) => {
  await page.goto(`${fixtureOrigin}/tests/fixtures/storage.html`);
  await page.waitForFunction(() => window.p5?.ready);
  const result = await page.evaluate(async literal => {
    const { createDefaultRhythmProject } = await import('/src/rhythm/model.ts');
    const store = window.p5.store;
    await store.restore(JSON.stringify(literal), { confirmed: true });
    const first = createDefaultRhythmProject('rhythm-first', 'Первый');
    await store.saveRhythmProject(first);
    const confirmed = await store.readSnapshot();
    const second = createDefaultRhythmProject('rhythm-second', 'Второй');
    const candidate = { ...confirmed, rhythmProjects: [first, second], activeRhythmProjectId: second.id };
    const bad = structuredClone(candidate);
    bad.rhythmProjects[1].chain[0].patternId = 'H';
    let invalidCode, abortCode;
    try { await store.restore(JSON.stringify(bad), { confirmed: true }); } catch (error) { invalidCode = error.code; }
    const afterInvalid = await store.readSnapshot();
    const failAfterWrite = 2 + candidate.presets.length + candidate.history.length + candidate.practiceDrafts.length + candidate.rhythmProjects.length + 1;
    try { await store.restore(JSON.stringify(candidate), { confirmed: true, failAfterWrite }); } catch (error) { abortCode = error.code; }
    const transaction = store.getLastTransaction();
    const cached = await store.readSnapshot();
    const fresh = await store.readSnapshot({ fresh: true });
    return { confirmed, candidate, invalidCode, abortCode, failAfterWrite, transaction, sameCache: cached === confirmed && afterInvalid === confirmed, fresh };
  }, literalV7);
  assert.equal(result.invalidCode, 'INVALID_DATA');
  assert.equal(result.abortCode, 'INJECTED_ABORT');
  assert.equal(result.sameCache, true);
  assert.deepEqual(result.transaction, { successfulWrites: result.failAfterWrite, aborted: true });
  assert.deepEqual(result.fresh, result.confirmed);
  const persisted = await raw(page);
  assert.deepEqual(persisted.rhythmProjects, result.confirmed.rhythmProjects);
  assert.equal(persisted.activeRhythmProjectId, result.confirmed.activeRhythmProjectId);
  await page.evaluate(candidate => window.p5.store.restore(JSON.stringify(candidate), { confirmed: true }), result.candidate);
  const restored = await raw(page);
  assert.deepEqual(restored.rhythmProjects, result.candidate.rhythmProjects);
  assert.equal(restored.activeRhythmProjectId, result.candidate.activeRhythmProjectId);
  return { invalidChainRejected: true, successfulWritesBeforeAbort: result.failAfterWrite, retryCommitted: true };
}));
