import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export function p12CompositionChecks({ confirmImport, uiBackup }) {
  const cases = [
    { omitted: 'input', unavailable: ['input'], storedSection: 'input' },
    { omitted: 'ear', unavailable: ['ear', 'route'], storedSection: 'route' },
  ];
  return cases.map(({ omitted, unavailable, storedSection }) => ({
    name: `composition-without-${omitted}-retains-unavailable-schema10-data`,
    scope: 'composition',
    composition: omitted,
    async run({ page }) {
      const incoming = JSON.parse(await readFile(new URL('../fixtures/v10-backup.json', import.meta.url), 'utf8'));
      incoming.preferences.activeModule = storedSection;
      incoming.preferences.input.deviceId = 'fixture-input-device';
      incoming.preferences.ear = { root: 'C', quality: 'major', count: 13, bpm: 110 };
      await confirmImport(page, incoming);

      const current = page.locator('.module-navigation [aria-current="page"]');
      assert.equal(await current.getAttribute('data-app-module'), 'foundation');
      for (const section of unavailable) {
        assert.equal(await page.locator(`[data-app-module="${section}"]`).count(), 0);
        assert.equal(await page.locator(`[data-page-frame="${section}"]`).count(), 0);
      }
      if (unavailable.includes('route')) assert.equal(await page.locator('#route-session-mount > *').count(), 0);
      assert.deepEqual(await uiBackup(page), incoming);

      await page.locator('[data-label-mode="degrees"]').click();
      const edited = structuredClone(incoming);
      edited.preferences.study.labelMode = 'degrees';
      assert.deepEqual(await uiBackup(page), edited, 'Changing the visible feature must retain the complete restored copy');
      await page.reload();
      await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
      assert.equal(await current.getAttribute('data-app-module'), 'foundation');
      assert.equal(await page.locator('[data-label-mode="degrees"]').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await uiBackup(page), edited, 'A native reload must keep unavailable data and the unrelated edit');
      await current.click();
      edited.preferences.activeModule = 'foundation';
      assert.deepEqual(await uiBackup(page), edited, 'Explicitly choosing the displayed fallback saves its ID');
      return { unavailable, fallback: 'foundation', storedSection, preservedHistory: edited.history.length, preservedRhythmProjects: edited.rhythmProjects.length, unrelatedEdit: 'study.labelMode', nativeReload: true, explicitFallbackSaved: true };
    },
  }));
}
