import assert from 'node:assert/strict';
import { join } from 'node:path';
import { root, playingField, settingsToggle, settingsAside, action, setting, output, near, desktopDockHeightLimit,
  assertSettings, setSettings, openGroup, meterFieldCoverage, ready, enter, state, start } from './browser-context.mjs';

export const layoutChecks = [];
const check = (name, scope, run) => layoutChecks.push({ name, scope, run });

// Быстрый набор проверяет типичный 1366×768 в обеих темах. Полный добавляет шесть других профилей; 1366×768 идёт в нём
// первым как эталон высоты дока и фейдера для профилей высотой от 1000 px.
const transportLayout = profiles => async ({ page, context, resultDir }) => {
  const samples = [];
  const settingsChecks = [];
  const lightDocks = new Map();
  const headingTypography = locator => locator.evaluate(heading => {
    const { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight } = getComputedStyle(heading);
    return { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight };
  });
  const frame = () => page.locator('.app-shell').evaluate(shell => {
    const measure = element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const sidebar = shell.querySelector(':scope > .site-header');
    return {
      shell: measure(shell),
      content: measure(shell.querySelector(':scope > .app-content')),
      sidebar: measure(sidebar),
      brand: measure(sidebar.querySelector('.brand')),
      navigation: measure(sidebar.querySelector('.module-navigation')),
      sidebarArt: measure(sidebar.querySelector('.sidebar-art')),
      themeControl: measure(sidebar.querySelector('.theme-control')),
    };
  });
  for (const theme of ['light', 'dark']) {
    let compactDock;
    for (const [width, height, deviceScaleFactor = 1] of profiles) {
      await page.setViewportSize({ width, height });
      const metrics = deviceScaleFactor !== 1 ? await context.newCDPSession(page) : null;
      if (metrics) await metrics.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
      await page.reload(); await ready(page);
      assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]), [width, height, deviceScaleFactor]);
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.locator('[data-app-module="foundation"]').click();
      await page.locator('#fretboard-container').waitFor();
      await page.evaluate(() => { window.scrollTo(0, 0); });
      const fretboardFrame = await frame();
      const fretboardHeading = page.locator('#structure-heading');
      const [fretboardTypography, fretboardHeadingBox, fretboardEndInset] = await Promise.all([
        headingTypography(fretboardHeading),
        fretboardHeading.boundingBox(),
        page.locator('.workspace-main').evaluate(workspace => parseFloat(getComputedStyle(workspace).paddingInlineEnd)),
      ]);
      assert.ok(fretboardHeadingBox);
      if (deviceScaleFactor === 1.25) await page.screenshot({ path: join(resultDir, `p10-rhythm-reference-fretboard-${theme}-2028x1000-dpr125.png`) });
      await enter(page);
      const startsOpen = width >= 1440 && height >= 700;
      const exerciseEditors = width === 1366 || width === 2048 || deviceScaleFactor === 1.25;
      const selectors = ['.rhythm-transport', '.rhythm-tempo', '.rhythm-dial-bank', '.rhythm-swing-dock:visible', '.rhythm-play-module', '.rhythm-mix-board', '.rhythm-master .rhythm-fader'];
      let metronomeLayout, metronomeField;
      for (const mode of ['metronome', 'rhythm']) {
        const tablist = root(page).getByRole('tablist');
        await tablist.locator(`[data-rhythm-mode="${mode}"]`).press('Enter');
        await assertSettings(page, startsOpen);
        const viewport = `${width}×${height} @${deviceScaleFactor}× ${theme} ${mode}`;
        const bounds = await action(page, 'start').boundingBox();
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height);
        const contentArea = root(page).locator('.rhythm-content');
        await contentArea.evaluate(node => { node.scrollTop = 0; });
        const content = await contentArea.boundingBox();
        const panelLocator = root(page).locator(`[data-rhythm-panel="${mode}"]`);
        const panel = await panelLocator.boundingBox();
        const dockBox = () => root(page).locator('.rhythm-transport').boundingBox();
        const dock = await dockBox();
        const mount = await root(page).boundingBox();
        const rhythmFrame = await frame();
        for (const section of Object.keys(fretboardFrame)) {
          for (const key of ['x', 'y', 'width', 'height']) {
            const actual = rhythmFrame[section][key], fretboard = fretboardFrame[section][key];
            assert.ok(Math.abs(actual - fretboard) <= 2, `Shared ${section} ${key} at ${viewport}: ${actual} vs fretboard ${fretboard}`);
          }
        }
        assert.ok(content && panel && dock && mount, viewport);
        const stageGap = dock.y - (content.y + content.height);
        assert.ok(stageGap >= -1 && stageGap <= 16, `Dock is ${stageGap}px below the workspace at ${viewport}`);
        assert.ok(dock.y + dock.height <= height, viewport);
        assert.ok(dock.height <= desktopDockHeightLimit, `Compact dock height ${dock.height}px at ${viewport}`);
        const dockKey = `${width}×${height} ${mode}`;
        if (theme === 'light') lightDocks.set(dockKey, dock);
        else for (const key of ['x', 'y', 'width', 'height']) near(dock[key], lightDocks.get(dockKey)[key], 1);
        const side = settingsAside(page);
        const settingsControls = mode === 'metronome'
          ? ['[data-rhythm-setting="beats"]', '[data-rhythm-choice="denominator"][data-rhythm-value="4"]', '[data-rhythm-division="1"]']
          : ['.rhythm-playback-settings [data-rhythm-repeat="once"]', '.rhythm-playback-settings [data-rhythm-setting="rhythmClick"]', '.rhythm-editor-pattern [data-rhythm-choice="bars"][data-rhythm-value="1"]'];
        for (const selector of settingsControls) {
          const control = side.locator(selector);
          assert.equal(await panelLocator.locator(selector).count(), 1, `Only one control ${selector} at ${viewport}`);
          assert.equal(await control.count(), 1, `Control ${selector} is in settings at ${viewport}`);
          assert.equal(await control.isVisible(), startsOpen, `Control ${selector} follows settings visibility at ${viewport}`);
        }
        const sideBox = startsOpen ? await side.boundingBox() : null;
        const previousBlock = await root(page).locator(mode === 'metronome' ? '.rhythm-pulse' : '.rhythm-constructor').boundingBox();
        const hasSide = Boolean(sideBox && sideBox.x >= previousBlock.x + previousBlock.width - 1);
        assert.equal(hasSide, startsOpen, `Settings initially sit to the right only in wide windows at ${viewport}`);
        if (hasSide) {
          near(sideBox.y, content.y, 2);
          near(sideBox.y + sideBox.height, content.y + content.height, 2);
        }
        const nextBlock = mode === 'metronome'
          ? sideBox
          : await panelLocator.locator(hasSide ? '.rhythm-groove-tools' : '.rhythm-groove-detail-scroll').boundingBox();
        const lastBlock = mode === 'metronome' ? await panelLocator.locator('.rhythm-metro-secondary').boundingBox() : nextBlock;
        assert.ok(lastBlock, viewport);
        const gap = dock.y - (lastBlock.y + lastBlock.height);
        assert.ok(gap >= -1, `The dock does not overlap the working controls at ${viewport}`);
        if (mode === 'rhythm') assert.ok(gap <= 24, `Dock is ${gap}px below the lower editor region at ${viewport}`);
        const contentSeparation = nextBlock && (mode === 'metronome'
          ? nextBlock.x - (previousBlock.x + previousBlock.width)
          : nextBlock.y - (previousBlock.y + previousBlock.height));
        if (contentSeparation !== null) assert.ok(contentSeparation >= -1 && contentSeparation <= 32, `Related blocks are ${contentSeparation}px apart at ${viewport}`);
        near(dock.x, content.x, 1);
        near(dock.width, content.width, 1);
        near(mount.x - rhythmFrame.content.x, fretboardHeadingBox.x - fretboardFrame.content.x, 1);
        near(rhythmFrame.content.x + rhythmFrame.content.width - mount.x - mount.width, fretboardEndInset, 1);
        const bottomInset = rhythmFrame.content.y + rhythmFrame.content.height - dock.y - dock.height;
        assert.ok(bottomInset >= -1 && bottomInset <= 24, `The shell ends ${bottomInset}px below the dock at ${viewport}`);
        const verifyFixedDock = async editor => {
          const openedDock = await dockBox();
          const openedFrame = await frame();
          const openedMaster = await root(page).locator('.rhythm-master .rhythm-fader').boundingBox();
          const openedInset = openedFrame.content.y + openedFrame.content.height - openedDock.y - openedDock.height;
          for (const key of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(openedDock[key] - dock[key]) <= 1, `Dock ${key} changed after opening ${editor} at ${viewport}`);
          }
          assert.ok(Math.abs(openedInset - bottomInset) <= 1, `Dock bottom inset changed after opening ${editor} at ${viewport}`);
          assert.ok(Math.abs(openedMaster.y - layout.at(-1).y) <= 1, `Master fader moved after opening ${editor} at ${viewport}`);
        };
        const header = root(page).locator('.rhythm-header');
        const heading = header.getByRole('heading', { level: 1, name: 'Метроном и ритм', exact: true });
        assert.deepEqual(await headingTypography(heading), fretboardTypography, `Heading typography matches the fretboard at ${viewport}`);
        const [headerBox, headingBox, toggleBox, tablistBox] = await Promise.all([
          header.boundingBox(), heading.boundingBox(), settingsToggle(page).boundingBox(), tablist.boundingBox(),
        ]);
        assert.ok(headingBox && toggleBox && tablistBox, viewport);
        near(headingBox.x, fretboardHeadingBox.x, 2);
        near(headingBox.y, fretboardHeadingBox.y, 2);
        assert.ok(toggleBox.x >= headingBox.x + headingBox.width - 1 && toggleBox.y < headingBox.y + headingBox.height && headingBox.y < toggleBox.y + toggleBox.height,
          `Heading and settings share the first row at ${viewport}`);
        assert.ok(tablistBox.y >= Math.max(headingBox.y + headingBox.height, toggleBox.y + toggleBox.height) - 1,
          `Tabs sit below the heading row at ${viewport}`);
        const tabStyles = await tablist.getByRole('tab').evaluateAll(tabs => tabs.map(tab => {
          const { backgroundColor, borderBottomWidth, borderBottomStyle, borderBottomColor } = getComputedStyle(tab);
          return { mode: tab.dataset.rhythmMode, selected: tab.getAttribute('aria-selected') === 'true', backgroundColor, borderBottomWidth, borderBottomStyle, borderBottomColor };
        }));
        assert.equal(tabStyles.length, 2);
        assert.deepEqual(tabStyles.filter(tab => tab.selected).map(tab => tab.mode), [mode]);
        const activeTab = tabStyles.find(tab => tab.selected), inactiveTab = tabStyles.find(tab => !tab.selected);
        assert.equal(activeTab.borderBottomStyle, 'solid');
        assert.ok(parseFloat(activeTab.borderBottomWidth) >= 2);
        assert.equal(inactiveTab.borderBottomColor, 'rgba(0, 0, 0, 0)');
        assert.notEqual(activeTab.borderBottomColor, inactiveTab.borderBottomColor);
        assert.equal(activeTab.backgroundColor, 'rgba(0, 0, 0, 0)');
        near(content.x, mount.x, 1);
        near(content.width, mount.width, 1);
        near(panel.x, content.x, 1);
        near(panel.width, await contentArea.evaluate(node => node.clientWidth), 1);
        near(headerBox.x, mount.x, 1);
        near(headerBox.width, mount.width, 1);
        const layout = await Promise.all(selectors.map(selector => root(page).locator(selector).boundingBox()));
        assert.ok(layout.every(Boolean));
        const faderHeight = layout.at(-1).height;
        if (width === 1366 && mode === 'metronome') compactDock = { height: dock.height, faderHeight };
        if (height >= 1000) {
          near(dock.height, compactDock.height, 1);
          near(faderHeight, compactDock.faderHeight, 1);
        }
        if (mode === 'metronome') metronomeLayout = layout;
        else layout.forEach((box, index) => {
          for (const dimension of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(box[dimension] - metronomeLayout[index][dimension]) < 1, `${width} ${theme} ${selectors[index]} ${dimension}`);
        });
        const field = await playingField(page).boundingBox();
        assert.ok(field && field.width > 0 && field.height > 0, viewport);
        const fieldInset = field.y - content.y;
        assert.ok(fieldInset >= -1 && fieldInset <= 64, `The playing field starts ${fieldInset}px into the workspace at ${viewport}`);
        const rackViewport = mode === 'rhythm' ? await panelLocator.locator('.rhythm-rack-scroll').boundingBox() : null;
        const visibleFieldWidth = Math.min(field.width, rackViewport?.width ?? field.width);
        if (mode === 'metronome') metronomeField = field;
        else {
          near(field.x, metronomeField.x, 1);
          near(field.y, metronomeField.y, 1);
          near(visibleFieldWidth, metronomeField.width, 1);
          near(field.height, metronomeField.height, 1);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const sample = { theme, width, height, deviceScaleFactor, mode, fretboardFrame, rhythmFrame, heading: headingBox, dock, gap, stageGap, contentSeparation, bottomInset, faderHeight, settingsInitiallyOpen: startsOpen, contrastField: { width: visibleFieldWidth, height: field.height } };
        samples.push(sample);
        if (width === 1366) await page.screenshot({ path: join(resultDir, `p10-rhythm-${mode}-${theme}.png`) });
        if (width === 2048) await page.screenshot({ path: join(resultDir, `p10-rhythm-${mode}-${theme}-2048x1000.png`) });
        if (width === 1890) await page.screenshot({ path: join(resultDir, `p10-rhythm-${mode}-${theme}-1890x1000.png`), fullPage: true });
        if (deviceScaleFactor === 1.25) await page.screenshot({ path: join(resultDir, `p10-rhythm-${mode}-${theme}-2028x1000-dpr125.png`) });
        if (mode === 'metronome') {
          const toolsGap = lastBlock.y - (field.y + field.height);
          assert.ok(toolsGap >= -1 && toolsGap <= 16, `Sound and training follow the pulse field at ${viewport}`);
          assert.ok(lastBlock.x >= field.x - 1 && lastBlock.x + lastBlock.width <= field.x + field.width + 1,
            `Sound and training stay in the main column at ${viewport}`);
          const detailsSelectors = ['.rhythm-sounds > details', '.rhythm-training'];
          for (const selector of detailsSelectors) {
            assert.equal(await panelLocator.locator(selector).evaluate(node => node.open), false, `${selector} is initially collapsed at ${viewport}`);
          }
          const defaultToolControls = [action(page, 'preview'), panelLocator.locator('.rhythm-training > summary')];
          const toolBounds = await Promise.all(defaultToolControls.map(control => control.boundingBox()));
          assert.ok(toolBounds.every(box => box && box.y >= lastBlock.y - 1 && box.y + box.height <= content.y + content.height + 1),
            `Default sound and training controls fit in the workspace at ${viewport}`);
          const toolsToDock = dock.y - Math.max(...toolBounds.map(box => box.y + box.height));
          assert.ok(toolsToDock >= -1, `Dock is below the actual sound and training controls at ${viewport}`);
          sample.metroTools = { fieldGap: toolsGap, dockGap: toolsToDock };
          const beatKeys = output(page, 'beats').locator('.rhythm-beat');
          const beats = await beatKeys.evaluateAll(keys => keys.map(key => key.getBoundingClientRect().toJSON()));
          assert.equal(beats.length, 4);
          assert.ok(beats[0].height > 0, `Visible accent keys at ${viewport}`);
          for (const [index, beat] of beats.entries()) {
            near(beat.y, beats[0].y, 1);
            near(beat.height, beats[0].height, 1);
            assert.ok(beat.left >= field.x - 1 && beat.right <= field.x + field.width + 1);
            if (index) assert.ok(beat.left >= beats[index - 1].right - 1);
          }
          sample.accentKeyHeight = beats[0].height;
          sample.meterCoverage = await meterFieldCoverage(page, 4);
          if (exerciseEditors) {
            await setSettings(page, true);
            await verifyFixedDock('the settings pane');
            for (const selector of detailsSelectors) {
              await openGroup(page, selector);
              await verifyFixedDock(selector);
              const details = panelLocator.locator(selector);
              await details.locator(':scope > summary').press('Enter');
              assert.equal(await details.evaluate(node => node.open), false);
              await verifyFixedDock(selector);
            }
            await setSettings(page, startsOpen);
            sample.editorsKeepDock = true;
          }
        } else {
          const grid = output(page, 'rack');
          const velocityDetails = panelLocator.locator('.rhythm-velocity');
          assert.equal(await velocityDetails.evaluate(node => node.open), false, `Velocity is initially collapsed at ${viewport}`);
          const patternHeader = root(page).locator('.rhythm-constructor .rhythm-deck-header');
          assert.equal(await patternHeader.locator('[data-rhythm-choice="bars"]').count(), 0);
          const headerBars = patternHeader.locator('[data-rhythm-output="bars"]');
          assert.equal(await headerBars.locator('[data-rhythm-bar="0"]').isVisible(), true);
          assert.equal(await headerBars.getByRole('button', { name: 'Добавить такт 2', exact: true }).isVisible(), true);
          const chainScope = root(page).locator('.rhythm-chain-heading [data-rhythm-scope="chain"]');
          assert.equal(await chainScope.isVisible(), true);
          assert.equal(await chainScope.evaluate(button => {
            const tape = button.closest('.rhythm-chain-card').querySelector('[data-rhythm-output="chain"]');
            return Boolean(button.compareDocumentPosition(tape) & Node.DOCUMENT_POSITION_FOLLOWING);
          }), true);
          const measureGrid = () => grid.locator('.rhythm-rack-row').evaluateAll(rows => rows.map(row => ({
            row: row.getBoundingClientRect().toJSON(),
            pads: [...row.querySelectorAll('[data-rhythm-step]')].map(key => key.getBoundingClientRect().toJSON()),
          })));
          const closedGrid = await measureGrid();
          assert.equal(closedGrid.length, 4);
          const firstPad = closedGrid[0].pads[0];
          assert.ok(firstPad.height > 0 && firstPad.height <= 36, `Compact step pads at ${viewport}`);
          if (visibleFieldWidth >= 900) assert.ok(firstPad.width > firstPad.height, `Rectangular step pads at ${viewport}`);
          assert.ok(rackViewport && closedGrid[0].pads.at(-1).right <= rackViewport.x + rackViewport.width + 1,
            `The full default rack fits horizontally at ${viewport}`);
          for (const { row, pads } of closedGrid) {
            assert.equal(pads.length, 16);
            near(row.height, closedGrid[0].row.height, 1);
            for (const [index, pad] of pads.entries()) {
              near(pad.y, pads[0].y, 1);
              near(pad.x, closedGrid[0].pads[index].x, 1);
              near(pad.width, firstPad.width, 1);
              near(pad.height, firstPad.height, 1);
              assert.ok(pad.top >= row.top - 1 && pad.bottom <= row.bottom + 1);
              if (index) assert.ok(pad.left >= pads[index - 1].right - 1);
            }
          }
          sample.stepPad = { width: firstPad.width, height: firstPad.height };
          assert.equal(await root(page).locator('.rhythm-rack-ruler .rhythm-rack-beat').count(), 4);
          const rack = await grid.boundingBox();
          const chain = await output(page, 'chain').boundingBox();
          assert.ok(rack && rack.y >= content.y - 1 && rack.y + rack.height <= content.y + content.height + 1, `All default grid rows fit at ${viewport}`);
          assert.ok(rack.height >= .85 * field.height, `The rack fills the playing field at ${viewport}`);
          const rackVerticalOverflow = await playingField(page).evaluate(node => node.scrollHeight - node.clientHeight);
          assert.ok(rackVerticalOverflow <= 1, `The four default rack rows are visible without vertical scrolling at ${viewport}`);
          assert.ok(chain && chain.y >= rack.y + rack.height - 1 && chain.y + chain.height <= content.y + content.height + 1, `The default chain fits below the grid at ${viewport}`);
          const lower = panelLocator.locator('.rhythm-groove-detail-scroll');
          const toolPane = nextBlock;
          const library = lower.locator('.rhythm-library');
          assert.equal(await library.evaluate(node => node.open), false, `The library is initially collapsed at ${viewport}`);
          const libraryBox = await library.locator(':scope > summary').boundingBox();
          assert.ok(libraryBox && libraryBox.y >= field.y + field.height - 1, `The library belongs below the playing field at ${viewport}`);
          assert.ok(toolPane && libraryBox.y + libraryBox.height <= Math.min(toolPane.y + toolPane.height, content.y + content.height) + 1,
            `The library entry fits completely in the default workspace at ${viewport}`);
          const chainClips = output(page, 'chain').locator('[data-rhythm-clip]');
          assert.equal(await chainClips.count(), 8);
          const tape = await chainClips.evaluateAll(clips => {
            const strip = clips[0].parentElement;
            const oldScroll = strip.scrollLeft;
            const bounds = strip.getBoundingClientRect();
            const fits = clip => {
              const { left, right } = clip.getBoundingClientRect();
              return left >= bounds.left - 1 && right <= bounds.right + 1;
            };
            strip.scrollLeft = 0;
            const allFit = clips.every(fits);
            const firstFits = fits(clips[0]);
            strip.scrollLeft = strip.scrollWidth;
            const lastFits = fits(clips.at(-1));
            const scrolled = strip.scrollLeft > 0;
            strip.scrollLeft = oldScroll;
            return { allFit, firstFits, lastFits, scrolled };
          });
          assert.ok(tape.firstFits && tape.lastFits && (tape.allFit || tape.scrolled), `Every default clip is reachable in the local tape at ${viewport}`);
          const names = root(page).locator('.rhythm-lane-name span, [data-rhythm-output="mixer"] .rhythm-channel-name');
          const clipped = await names.evaluateAll(elements => elements.flatMap(element => (
            element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1 ? [element.textContent] : []
          )));
          assert.deepEqual(clipped, [], `Standard instrument labels must fit at ${viewport}`);
          const unavailableClipLabels = await chainClips.evaluateAll((clips, allowOverflow) => clips.flatMap(clip => {
            const name = clip.querySelector('.rhythm-clip-name');
            if (name.scrollWidth <= name.clientWidth + 1) return [];
            return allowOverflow && clip.title === name.textContent && clip.getAttribute('aria-label')?.endsWith(name.textContent) ? [] : [name.textContent];
          }), tape.scrolled);
          assert.deepEqual(unavailableClipLabels, [], `Default clip labels fit or are available on the clipped button at ${viewport}`);
          await output(page, 'chain').scrollIntoViewIfNeeded();
          const sticky = await action(page, 'start').boundingBox();
          assert.ok(sticky && sticky.y >= 0 && sticky.y + sticky.height <= height);
          assert.ok(Math.abs(sticky.y - bounds.y) <= 1);
          if (exerciseEditors) {
            const verifyGrid = async () => {
              const measuredField = await playingField(page).boundingBox();
              for (const key of ['x', 'y', 'width', 'height']) near(measuredField[key], field[key], 1);
              const measuredGrid = await measureGrid();
              assert.equal(measuredGrid.length, closedGrid.length);
              for (const [index, { row, pads }] of measuredGrid.entries()) {
                const previous = closedGrid[index];
                for (const key of ['x', 'y', 'width', 'height']) near(row[key], previous.row[key], 1);
                assert.equal(pads.length, previous.pads.length);
                for (const [step, pad] of pads.entries()) {
                  for (const key of ['x', 'y', 'width', 'height']) near(pad[key], previous.pads[step][key], 1);
                }
              }
            };
            const verifyVelocityAlignment = async () => {
              const velocityCenters = await output(page, 'velocity').locator('[data-rhythm-velocity]').evaluateAll(inputs => inputs.map(input => {
                const { x, width } = input.getBoundingClientRect();
                return x + width / 2;
              }));
              assert.equal(velocityCenters.length, 16);
              for (const [index, center] of velocityCenters.entries()) {
                const pad = closedGrid[0].pads[index];
                near(center, pad.x + pad.width / 2, 1);
              }
            };
            await setSettings(page, true);
            await verifyGrid();
            await verifyFixedDock('the settings pane');
            const editors = ['.rhythm-velocity', '.rhythm-editor-bar', '.rhythm-editor-sounds', '.rhythm-library'];
            const toggleEditor = async (selector, expectedOpen) => {
              const details = panelLocator.locator(selector);
              await details.locator(':scope > summary').press('Enter');
              assert.equal(await details.evaluate(node => node.open), expectedOpen);
              await verifyGrid();
              await verifyFixedDock(selector);
            };
            for (const selector of editors) {
              await toggleEditor(selector, true);
              if (selector === '.rhythm-velocity') await verifyVelocityAlignment();
            }
            const panes = hasSide ? [lower.locator('.rhythm-groove-tools'), side] : [lower];
            const scrollDistances = [];
            for (const pane of panes) {
              const scrollLimit = await pane.evaluate(node => node.scrollHeight - node.clientHeight);
              if (scrollLimit <= 1) continue;
              await pane.hover();
              const before = await pane.evaluate(node => node.scrollTop);
              await page.mouse.wheel(0, before > scrollLimit / 2 ? -600 : 600);
              const element = await pane.elementHandle();
              await page.waitForFunction(({ element, before }) => Math.abs(element.scrollTop - before) > 1, { element, before }, { timeout: 3000 });
              const after = await pane.evaluate(node => node.scrollTop);
              scrollDistances.push(Math.abs(after - before));
              await verifyGrid();
              await verifyFixedDock('scrolling the open editors');
            }
            if (width === 1366) assert.ok(scrollDistances.length, 'The expanded settings genuinely scroll at 1366×768');
            for (const selector of editors.reverse()) await toggleEditor(selector, false);
            await setSettings(page, startsOpen);
            sample.editorsKeepGrid = true;
            sample.editorsKeepDock = true;
            sample.editorScrollDistances = scrollDistances;
          }
        }
      }
      if (exerciseEditors) {
        const toggle = settingsToggle(page);
        assert.equal(await toggle.and(root(page).getByRole('button', { name: 'Параметры', exact: true })).count(), 1);
        const grooveTab = root(page).getByRole('tab', { name: 'Ритм-секция', exact: true });
        const metroTab = root(page).getByRole('tab', { name: 'Метроном', exact: true });
        const grooveAside = await assertSettings(page, startsOpen);
        const initialAside = startsOpen ? await settingsAside(page).boundingBox() : null;
        const initialField = await playingField(page).boundingBox();
        const initialDock = await root(page).locator('.rhythm-transport').boundingBox();
        await toggle.press('Space');
        await assertSettings(page, !startsOpen);
        const resizedField = await playingField(page).boundingBox();
        const resizedDock = await root(page).locator('.rhythm-transport').boundingBox();
        near(resizedDock.y, initialDock.y, 1);
        near(resizedDock.height, initialDock.height, 1);
        for (const key of ['x', 'y', 'height']) near(resizedField[key], initialField[key], 1);
        if (startsOpen) {
          assert.ok(resizedField.width - initialField.width >= initialAside.width - 1,
            'Closing the right pane returns its width to the rhythm field');
          assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
        } else {
          near(resizedField.width, initialField.width, 1);
          assert.equal(await settingsAside(page).evaluate(node => document.activeElement === node), true);
          const inlineAside = await settingsAside(page).boundingBox();
          assert.ok(inlineAside && inlineAside.y >= resizedField.y + resizedField.height - 1, 'Opened settings stay below the playing field in a smaller window');
        }
        await grooveTab.press('ArrowLeft');
        const metroAside = await assertSettings(page, !startsOpen);
        assert.notEqual(metroAside, grooveAside);
        await setSettings(page, true);
        const metroOpenField = await playingField(page).boundingBox();
        await settingsAside(page).getByRole('button', { name: 'Свернуть', exact: true }).press('Enter');
        await assertSettings(page, false);
        assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
        const metroClosedField = await playingField(page).boundingBox();
        const grooveOpenField = startsOpen ? initialField : resizedField;
        const grooveClosedField = startsOpen ? resizedField : initialField;
        for (const key of ['width', 'height']) {
          near(metroOpenField[key], grooveOpenField[key], 1);
          near(metroClosedField[key], grooveClosedField[key], 1);
        }
        if (startsOpen) near(metroOpenField.y, metroClosedField.y, 1);
        await metroTab.press('ArrowRight');
        assert.equal(await assertSettings(page, false), grooveAside);
        await setSettings(page, startsOpen);
        settingsChecks.push({ theme, width, startsOpen, openField: { width: grooveOpenField.width, height: grooveOpenField.height }, closedField: { width: grooveClosedField.width, height: grooveClosedField.height }, sharedState: true, focusRestored: true });
      }
      if (metrics) {
        await metrics.send('Emulation.clearDeviceMetricsOverride');
        await metrics.detach();
      }
    }
  }
  return { samples, settingsChecks, shellAndNavigationMatchFretboard: true, controlsFitWorkspace: true, sharedHeadingTypography: true, underlinedTabs: true, playbackControlsGrouped: true, dockAlignedToWorkspace: true, dockMatchesAcrossTabs: true, dockMatchesAcrossThemes: true, contrastFieldAlignment: true, dockStableWhenEditorsOpen: true, defaultGridAndChainFit: true, allClipsReachable: true, instrumentNamesFit: true };
};
check('product-layout-keeps-transport-and-local-grid-in-two-themes-at-1366x768', 'ui', transportLayout([[1366, 768]]));
check('product-layout-keeps-transport-and-local-grid-in-two-themes-at-six-more-viewports', 'ui',
  transportLayout([[1366, 768], [1280, 720], [1440, 900], [1890, 1000], [2048, 1000], [1782, 1220], [2028, 1000, 1.25]]));

check('product-layout-keeps-local-grid-and-chain-scrollable-in-narrow-view', 'ui', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 720 });
  await enter(page);
  await root(page).getByRole('tab', { name: 'Ритм-секция', exact: true }).click();
  await assertSettings(page, false);
  const narrow = await root(page).locator('.rhythm-rack-scroll').evaluate(node => {
    const field = node.querySelector('.rhythm-playing-field');
    const scrollArea = field.scrollWidth > field.clientWidth + 1 ? field : node;
    scrollArea.scrollLeft = 80;
    return { rack: scrollArea.clientWidth, content: scrollArea.scrollWidth, offset: scrollArea.scrollLeft, page: document.documentElement.scrollWidth, viewport: innerWidth };
  });
  assert.ok(narrow.content > narrow.rack && narrow.offset > 0 && narrow.page <= narrow.viewport + 1, JSON.stringify(narrow));
  const tape = await output(page, 'chain').evaluate(node => {
    node.scrollLeft = 80;
    return node.scrollLeft;
  });
  assert.ok(tape > 0, 'The clip tape scrolls locally');
  const startKey = action(page, 'start');
  await startKey.scrollIntoViewIfNeeded();
  await startKey.focus();
  const startBox = await startKey.boundingBox();
  const mix = await root(page).locator('.rhythm-mix-module').boundingBox();
  assert.ok(startBox && startBox.y >= 0 && startBox.y + startBox.height <= 720 && mix.y >= startBox.y + startBox.height);
  return { narrow, clipTapeOffset: tape };
});

check('product-photo-panel-uses-local-images-and-keeps-shared-controls-compact', 'ui', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await enter(page);
  const origin = new URL(page.url()).origin;
  const dock = root(page).locator('.rhythm-transport');
  const photos = new Map();
  const samples = [];
  async function photo(locator, label, { pseudo = null, property = 'background-image' } = {}) {
    const paint = await locator.evaluate((node, { pseudo, property }) => getComputedStyle(node, pseudo).getPropertyValue(property), { pseudo, property });
    const match = /url\(\s*["']?([^"')]+)["']?\s*\)/u.exec(paint);
    assert.ok(match, `${label} has a photographic source: ${paint}`);
    const source = new URL(match[1].trim(), page.url());
    assert.equal(source.origin, origin, label);
    assert.match(source.pathname, /^\/images\/rhythm-panel\/[^/]+\.webp$/u, label);
    if (!photos.has(source.pathname)) {
      const decoded = await page.evaluate(async url => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, source.href);
      assert.ok(decoded.width >= 100 && decoded.height >= 50, `${label} has a usable local image`);
      photos.set(source.pathname, decoded);
    }
    return source.pathname;
  }
  async function assertDock(reference, context) {
    const box = await dock.boundingBox();
    assert.ok(box, context);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(box[key] - reference[key]) <= 1, `${context}: dock ${key} moved`);
    }
  }
  async function referenceLayout(mode, context) {
    const tempo = setting(page, 'bpm-slider').locator('..');
    const swing = setting(page, mode === 'metronome' ? 'metronomeSwing' : 'rhythm-swing').locator('..');
    const mixer = dock.getByRole('group', { name: 'Микшер', exact: true });
    const locators = {
      bpm: dock.locator('.rhythm-bpm-display'),
      slower: action(page, 'slower'),
      tap: action(page, 'tap'),
      faster: action(page, 'faster'),
      tempoCaption: tempo.locator('.rhythm-dial-label'),
      tempoDial: tempo.locator('.rhythm-dial-scale'),
      swingCaption: swing.locator('.rhythm-dial-label'),
      swingDial: swing.locator('.rhythm-dial-scale'),
      status: output(page, 'position'),
      start: action(page, 'start'),
      stop: action(page, 'stop'),
      count: dock.locator('.rhythm-count-in'),
      mixerTitle: mixer.getByRole('heading', { name: 'Микшер', exact: true }),
      faders: mixer.locator('.rhythm-mix-board'),
      master: setting(page, 'master'),
      tempoModule: dock.locator('.rhythm-tempo'),
      dialModule: dock.locator('.rhythm-dial-bank'),
      playModule: dock.locator('.rhythm-play-module'),
    };
    const bounds = Object.fromEntries(await Promise.all(Object.entries(locators).map(async ([key, locator]) => {
      const box = await locator.boundingBox();
      assert.ok(box, `${key} is visible at ${context}`);
      return [key, box];
    })));
    const { bpm, slower, tap, faster, tempoCaption, tempoDial, swingCaption, swingDial, status, start, stop, count, mixerTitle, faders } = bounds;
    const right = box => box.x + box.width;
    const above = (first, second, label) => {
      const gap = second.y - first.y - first.height;
      assert.ok(gap >= -1 && gap <= 13, `${label} at ${context} (gap ${gap}px)`);
    };
    above(bpm, slower, 'BPM display sits directly above the adjustment keys');
    near(slower.y, tap.y, 1);
    near(tap.y, faster.y, 1);
    near(slower.height, faster.height, 1);
    near(slower.height, tap.height, 1);
    near(slower.x, bpm.x, 2);
    near(right(faster), right(bpm), 2);
    assert.ok(right(slower) <= tap.x && right(tap) <= faster.x, `− / TAP / + are in reading order at ${context}`);

    above(tempoCaption, tempoDial, 'Tempo caption sits above its knob');
    above(swingCaption, swingDial, 'Swing caption sits above its knob');
    near(tempoCaption.y, swingCaption.y, 1);
    near(tempoDial.y, swingDial.y, 1);
    near(tempoDial.width, swingDial.width, 1);
    near(tempoDial.height, swingDial.height, 1);
    assert.ok(swingDial.x - right(tempoDial) >= -1 && swingDial.x - right(tempoDial) <= 18, `Adjacent dials at ${context}`);

    above(status, start, 'Transport status sits above Start and Stop');
    near(start.y, stop.y, 1);
    above(stop, count, 'Count-in sits below the transport keys');
    assert.ok(count.x >= bounds.playModule.x && right(count) <= right(bounds.playModule), `Count-in fits the transport module at ${context}`);
    above(mixerTitle, faders, 'Mixer heading sits above the faders');
    near(mixerTitle.x, faders.x, 12);
    assert.equal(await locators.master.getAttribute('type'), 'range');
    assert.equal(await locators.master.evaluate(node => getComputedStyle(node).writingMode), 'vertical-lr');
    const channels = await mixer.locator('.rhythm-mix-channels:visible > .rhythm-channel, .rhythm-master').evaluateAll(strips => strips.map(strip => {
      const measure = selector => strip.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null;
      const fader = strip.querySelector('.rhythm-fader');
      const name = strip.querySelector('.rhythm-channel-name');
      return {
        strip: strip.getBoundingClientRect().toJSON(),
        name: name.getBoundingClientRect().toJSON(), fader: fader.getBoundingClientRect().toJSON(), level: measure('output'),
        mute: measure('.rhythm-lane-mute'), solo: measure('.rhythm-lane-solo'),
        writingMode: getComputedStyle(fader).writingMode,
        nameFits: name.scrollWidth <= name.clientWidth + 1 && name.scrollHeight <= name.clientHeight + 1,
      };
    }));
    assert.equal(channels.length, mode === 'metronome' ? 4 : 5, context);
    const center = box => box.x + box.width / 2;
    const instrumentChannels = channels.slice(0, -1);
    for (const [index, channel] of channels.entries()) {
      const { strip, name, fader, level, mute, solo, writingMode, nameFits } = channel;
      assert.ok(strip.left >= faders.x - 1 && strip.right <= right(faders) + 1, `Every default strip fits in the mixer at ${context}`);
      assert.ok(nameFits, `The channel name fits its strip at ${context}`);
      assert.equal(writingMode, 'vertical-lr');
      near(center(name), center(fader), 1);
      near(center(level), center(fader), 1);
      near(fader.y, channels[0].fader.y, 1);
      near(fader.height, bounds.master.height, 1);
      assert.ok(name.bottom <= fader.top && fader.bottom <= level.top, `Mixer title, rail and level stay in reading order at ${context}`);
      if (index < instrumentChannels.length) {
        near(strip.width, channels[0].strip.width, 1);
        assert.ok(strip.width <= 155, `Channel pitch stays compact at ${context}`);
      }
      if (mode === 'rhythm' && index < instrumentChannels.length) {
        assert.ok(mute && solo && mute.right <= level.left && level.right <= solo.left, `Mute, level and solo share a strip at ${context}`);
        assert.ok(mute.height >= 20 && solo.height >= 20, `Mute and solo retain usable button height at ${context}`);
      }
    }
    return {
      tempoWidth: bounds.tempoModule.width,
      dialBankWidth: bounds.dialModule.width,
      playWidth: bounds.playModule.width,
      dialWidth: tempoDial.width,
      faderHeight: bounds.master.height,
      channelWidth: instrumentChannels[0].strip.width,
      master: channels.at(-1).strip,
    };
  }
  function assertSharedMixer(metronome, rhythm) {
    near(metronome.channelWidth, rhythm.channelWidth, 1);
    for (const key of ['x', 'y', 'width', 'height']) near(metronome.master[key], rhythm.master[key], 1);
  }

  for (const theme of ['light', 'dark']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    const before = await dock.boundingBox();
    assert.ok(before && before.height <= desktopDockHeightLimit && before.y + before.height <= 768, `Compact visible dock in ${theme}`);
    for (const [mode, bpm] of [['metronome', 113], ['rhythm', 127]]) {
      await root(page).getByRole('tablist').locator(`[data-rhythm-mode="${mode}"]`).press('Enter');
      await assertDock(before, `${theme} ${mode}`);
      const context = `${theme} ${mode}`;
      const count = root(page).getByRole('switch', { name: 'Отсчёт', exact: true });
      const exactTempo = root(page).getByRole('spinbutton', { name: 'Темп, BPM', exact: true });
      const bpmWindow = root(page).locator('.rhythm-bpm-display');
      assert.equal(await bpmWindow.getByRole('spinbutton', { name: 'Темп, BPM', exact: true }).count(), 1);
      const countBefore = await count.isChecked();
      await count.press('Space');
      assert.equal(await count.isChecked(), !countBefore);
      await state(page, 'stopped');
      await count.press('Space');
      await exactTempo.fill(String(bpm));
      await exactTempo.press('Tab');
      assert.equal(await exactTempo.inputValue(), String(bpm));
      assert.equal(await setting(page, 'bpm-slider').getAttribute('aria-valuetext'), `${bpm} BPM`);

      const glass = await photo(bpmWindow, `BPM glass at ${context}`);
      const knob = await photo(setting(page, 'bpm-slider').locator('..').locator('.rhythm-dial-face'), `Tempo dial at ${context}`);
      const fader = await photo(setting(page, 'master'), `Fader cap at ${context}`, { property: '--rhythm-photo-fader' });
      const startFace = await photo(action(page, 'start').locator('.rhythm-key-face'), `Start at ${context}`);
      const stopFace = await photo(action(page, 'stop').locator('.rhythm-key-face'), `Stop at ${context}`);
      const countFace = await photo(count.locator('..').locator('.rhythm-count-in-track'), `Count-in at ${context}`);
      const wood = await photo(dock, `Wood trim at ${context}`, { pseudo: '::after' });
      assert.equal(new Set([glass, knob, fader, startFace, stopFace, countFace, wood]).size, 7, context);
      await setSettings(page, true);
      await assertDock(before, `Settings open at ${context}`);
      if (mode === 'metronome') {
        await root(page).locator('[data-rhythm-division="2"]').click();
      } else {
        const overlay = setting(page, 'rhythmClick');
        const face = root(page).locator('.rhythm-overlay-switch-face');
        const off = await photo(face, `Overlay off in ${theme}`);
        await overlay.press('Space');
        assert.equal(await overlay.isChecked(), true);
        const on = await photo(face, `Overlay on in ${theme}`);
        assert.notEqual(on, off);
        await overlay.press('Space');
        assert.equal(await overlay.isChecked(), false);
        assert.equal(await count.isChecked(), countBefore);
      }
      await setSettings(page, false);
      await assertDock(before, `Settings closed at ${context}`);
      const reference = await referenceLayout(mode, context);
      const swing = setting(page, mode === 'metronome' ? 'metronomeSwing' : 'rhythm-swing');
      assert.equal(await photo(swing.locator('..').locator('.rhythm-dial-face'), `Swing dial at ${context}`), knob);
      if (mode === 'rhythm' && theme === 'dark') {
        await start(page);
        const pauseFace = await photo(action(page, 'pause').locator('.rhythm-key-face'), `Pause at ${context}`);
        assert.notEqual(pauseFace, startFace);
        await assertDock(before, `Playback at ${context}`);
        await action(page, 'stop').click();
      }
      samples.push({ theme, mode, dock: before, exactBpm: bpm, reference });
    }
    assertSharedMixer(samples.at(-2).reference, samples.at(-1).reference);
  }
  const wide = [];
  await page.setViewportSize({ width: 2048, height: 1000 });
  const wideDock = await dock.boundingBox();
  const wideWorkspace = await root(page).locator('.rhythm-content').boundingBox();
  assert.ok(wideDock && wideWorkspace && wideDock.height <= desktopDockHeightLimit);
  near(wideDock.x, wideWorkspace.x, 1);
  near(wideDock.width, wideWorkspace.width, 1);
  for (const mode of ['metronome', 'rhythm']) {
    await root(page).locator(`[data-rhythm-mode="${mode}"]`).press('Enter');
    await assertDock(wideDock, `2048×1000 ${mode}`);
    const reference = await referenceLayout(mode, `2048×1000 ${mode}`);
    const compact = samples.find(sample => sample.theme === 'dark' && sample.mode === mode);
    near(wideDock.height, compact.dock.height, 1);
    for (const key of ['dialWidth', 'faderHeight']) near(reference[key], compact.reference[key], 1);
    wide.push({ mode, dock: wideDock, reference });
  }
  assertSharedMixer(wide[0].reference, wide[1].reference);
  return { samples, wide, localPhotos: Object.fromEntries(photos), stableDock: true, independentCountSwitch: true };
});


check('product-photo-panel-keeps-controls-and-inline-settings-in-narrow-view', 'ui', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 720 });
  await enter(page);
  await page.locator('[data-theme-choice="dark"]').click();
  const dock = root(page).locator('.rhythm-transport');
  await root(page).locator('[data-rhythm-mode="metronome"]').press('Enter');
  await setSettings(page, true);
  await root(page).locator('[data-rhythm-division="1"]').click();
  await setSettings(page, false);
  const narrow = [];
  for (const width of [320, 500, 621]) {
    await page.setViewportSize({ width, height: 720 });
    const documentDock = () => dock.evaluate(node => {
      const { top, height } = node.getBoundingClientRect();
      return { top: top + window.scrollY, height };
    });
    let before, beforeField;
    for (const mode of ['metronome', 'rhythm']) {
      await root(page).locator(`[data-rhythm-mode="${mode}"]`).press('Enter');
      const workspace = root(page).locator('.rhythm-content');
      await workspace.evaluate(node => { node.scrollTop = 0; });
      const [field, stage] = await Promise.all([playingField(page).boundingBox(), workspace.boundingBox()]);
      assert.ok(field && stage && field.y >= stage.y - 1 && field.y + field.height <= stage.y + stage.height + 1,
        `The default field fits vertically at ${width}px in ${mode}`);
      const rackViewport = mode === 'rhythm' ? await root(page).locator('.rhythm-rack-scroll').boundingBox() : null;
      const fieldSize = { width: Math.min(field.width, rackViewport?.width ?? field.width), height: field.height };
      if (!beforeField) beforeField = fieldSize;
      else for (const key of ['width', 'height']) near(fieldSize[key], beforeField[key], 1);
      const box = await documentDock();
      if (!before) before = box;
      near(box.top, before.top, 1);
      near(box.height, before.height, 1);
      await setSettings(page, true);
      assert.deepEqual(await documentDock(), box);
      if (width === 500) {
        await settingsAside(page).getByRole('button', { name: 'Свернуть', exact: true }).press('Enter');
        await assertSettings(page, false);
      } else await setSettings(page, false);
      const [restoredField, restoredStage] = await Promise.all([playingField(page).boundingBox(), workspace.boundingBox()]);
      near(restoredField.y - restoredStage.y, field.y - stage.y, 1);
      assert.equal(await settingsToggle(page).evaluate(node => document.activeElement === node), true);
      assert.deepEqual(await documentDock(), box);
      const textFits = await dock.evaluate(node => {
        const inside = (child, parent) => {
          const outer = parent.getBoundingClientRect();
          const inner = child.getBoundingClientRect();
          return inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
        };
        const window = node.querySelector('.rhythm-bpm-display');
        return inside(window.querySelector('.rhythm-bpm-readout'), window)
          && [...node.querySelectorAll('.rhythm-play-buttons, .rhythm-count-in')].every(control => inside(control, node));
      });
      assert.ok(textFits, `Visible BPM and transport fit at ${width}px in ${mode}`);
    }
    if (width === 500) {
      await setSettings(page, true);
      await root(page).locator('[data-rhythm-mode="metronome"]').press('Enter');
      await assertSettings(page, true);
      const [switchedField, switchedStage] = await Promise.all([playingField(page).boundingBox(), root(page).locator('.rhythm-content').boundingBox()]);
      assert.ok(switchedField.y >= switchedStage.y - 1 && switchedField.y + switchedField.height <= switchedStage.y + switchedStage.height + 1,
        'Changing tabs with the inline settings open shows the new playing field');
      await setSettings(page, false);
    }
    narrow.push({ width, dock: before, contrastField: beforeField });
  }
  return { narrow };
});
