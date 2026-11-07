// Rendered regressions: navbar wrapping, edge menus and large-text dialog actions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter, seedAddedPrinters } from './lib/printer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const shots = path.resolve(root, process.env.APP_TEST_OUTPUT ?? 'docs/superpowers/ui-layout-20261013/after');
fs.mkdirSync(shots, { recursive: true });
const matrix = [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844], [320, 568]];
const port = 5196;
let browser;
try {
  await startServer(port, 'ui-layout', { frozenDist: true });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === `http://127.0.0.1:${port}` && !/^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud)(\/|$)/.test(url.pathname) ? route.continue() : route.abort();
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const bounds = async selector => {
    await page.locator(selector).evaluate(async node => {
      const animations = (node.closest('.ds-dialog') ?? node).getAnimations({ subtree: true });
      await Promise.all(animations.filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
    const b = await page.locator(selector).boundingBox();
    const v = page.viewportSize();
    assert.ok(b && b.x >= -1 && b.y >= -1 && b.x + b.width <= v.width + 1 && b.y + b.height <= v.height + 1, `${selector} fits ${v.width}x${v.height}: ${JSON.stringify(b)}`);
    return b;
  };
  const shot = name => page.screenshot({ path: path.join(shots, `${name}.png`) });
  const clickTool = async selector => {
    if (!await page.locator(selector).isVisible()) await page.click('#tool-more-btn');
    await page.click(selector);
  };
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  await page.selectOption('#printer-select', '__add_printer__');
  await page.locator('#wizard-dialog').waitFor();
  for (const [width, height] of matrix) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300); // Crossing the phone breakpoint starts the sheet entrance animation.
    await bounds('.wizard-modal');
    await bounds('.wizard-footer');
    await shot(`wizard-${width}`);
  }
  await page.click('#wizard-close-x');
  await page.setViewportSize({ width: 1280, height: 800 });
  await selectAddedPrinter(page, 'Voron');
  await seedAddedPrinters(page, ['Voron 2.4 300 0.4 nozzle']);
  await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('autosave', false));
  const importCube = () => page.evaluate(async bytes => {
    await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'layout-cube.obj'));
    const plate = window.__plateStore.getState(), object = plate.objects[0];
    plate.selectObject(object.id, object.instances[0].id);
  }, Array.from(fs.readFileSync(path.join(root, 'tests/data/20mm_cube.obj'))));
  await importCube();

  await page.locator('#import-btn').focus();
  await page.evaluate(() => window.__prefsStore.getState().openDialog('display'));
  const dialog = page.locator('.preferences-dialog');
  assert.equal(await page.locator('#root').evaluate(node => node.inert), true, 'Dialog makes the shell inert');
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, 'Dialog moves focus inside');
  await dialog.locator('.close-btn').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#pref-close-btn').evaluate(node => node === document.activeElement), true, 'Shift+Tab stays in Dialog');
  await page.keyboard.press('Tab');
  assert.equal(await dialog.locator('.close-btn').evaluate(node => node === document.activeElement), true, 'Tab wraps in Dialog');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.locator('#root').evaluate(node => node.inert), false, 'Escape restores shell interaction');
  assert.equal(await page.locator('#import-btn').evaluate(node => node === document.activeElement), true, 'Dialog returns focus to its trigger');

  await page.evaluate(() => window.__prefsStore.getState().openDialog('display'));
  assert.deepEqual(await page.locator('#pref-font-scale option').evaluateAll(es => es.map(e => e.value)), ['100', '115', '130', '150']);
  for (const scale of [100, 115, 130, 150]) {
    await page.selectOption('#pref-font-scale', String(scale));
    await page.waitForFunction(scale => parseFloat(getComputedStyle(document.documentElement).fontSize) === 16 * scale / 100, scale);
  }
  await page.click('#pref-close-btn');
  await page.evaluate(() => window.__autosave.writeAutosave());
  await page.reload();
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.__prefsStore.getState().display.fontScale), 150, 'font preference persists across reload');
  await page.locator('#recovery-dialog').waitFor();
  for (const [width, height] of [[1280, 800], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await bounds('#recovery-dialog .modal-content');
    await page.locator('#recovery-discard').click({ trial: true });
    await page.locator('#recovery-restore').click({ trial: true });
    await shot(`recovery-${width}-font150`);
  }
  await page.click('#recovery-discard');
  await importCube();

  for (const scale of [100, 150]) for (const [width, height] of matrix) {
    await page.setViewportSize({ width, height });
    await page.evaluate(scale => {
      const prefs = window.__prefsStore.getState();
      prefs.setDisplayPref('fontScale', scale);
      prefs.setDisplayPref('theme', scale === 100 ? 'dark' : 'light');
    }, scale);
    if (width > 800) {
      const nav = await bounds('.topbar');
      const items = await page.locator('.topbar .menu-label,.topbar .tabs .tab,.topbar-right .icon-btn').evaluateAll(es => es.map(e => e.getBoundingClientRect().toJSON()));
      for (const b of items) assert.ok(b.bottom <= nav.y + nav.height + 1, 'navbar controls stay above content');
      const main = await page.locator('main').boundingBox();
      assert.ok(main.y >= nav.y + nav.height - 1, 'navbar does not cover sidebar');
      await shot(`prepare-${width}-font${scale}`);
      await page.getByRole('button', { name: 'View', exact: true }).click();
      await bounds('.menu-popup');
      await page.locator('.menu-popup > button').last().scrollIntoViewIfNeeded();
      await bounds('.menu-popup > button:last-child');
      await page.locator('.menu-popup > button').last().click({ trial: true });
      await shot(`view-menu-${width}-font${scale}`);
      await page.getByRole('button', { name: 'View', exact: true }).click();

      // Open the real root menu near both lower corners and click through its flyout.
      for (const x of [width - 8, Math.round(width * 0.4)]) {
        await page.mouse.click(x, height - 8, { button: 'right' });
        await bounds('#plate-context-menu');
        await page.locator('#plate-menu-primitive').hover();
        await bounds('#plate-submenu-primitive');
        await page.locator('#plate-menu-cube').click();
        await page.waitForFunction(() => !window.__appStore.getState().isModelLoading);
      }
      const id = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
      await page.locator(`#object-row-${id}`).evaluate((e, { width, height }) => e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: width - 8, clientY: height - 8 })), { width, height });
      await bounds('#object-list-context-menu');
      await page.locator('#menu-item-part').hover();
      await bounds('#submenu-part');
      await shot(`object-menu-edge-${width}-font${scale}`);
      await page.locator('#menu-action-part-cube').click();
      await page.waitForFunction(() => !window.__objectListStore.getState().isLoading);
      const volume = await page.evaluate(id => window.__objectListStore.getState().objects.find(o => o.id === id).volumes[0].id, id);
      await page.locator(`#volume-row-${volume}`).evaluate((e, { width, height }) => e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: width - 8, clientY: height - 8 })), { width, height });
      await bounds('#object-list-context-menu');
      await page.locator('#menu-item-extruder').hover();
      await bounds('#submenu-extruder');
      await page.locator('#menu-action-extruder-0').click();
    } else {
      assert.equal(await page.locator('#plate-toolbar').isVisible(), false, 'mobile keeps desktop toolbar hidden');
      await page.click('#mobile-choose-settings');
      await bounds('.mobile-flow');
      await bounds('.mobile-flow footer');
      await shot(`mobile-printer-${width}-font${scale}`);
      await page.click('#mobile-next');
      await page.click('#mobile-preset-mode');
      await page.click('#mobile-next');
      await bounds('.mobile-flow footer');
      await shot(`mobile-presets-${width}-font${scale}`);
      await page.click('#mobile-next');
      await bounds('#mobile-slice');
      await shot(`mobile-review-${width}-font${scale}`);
      await page.locator('.mobile-flow header button').click();
    }
    if (width === 320 && scale === 150) await importCube();
    await page.evaluate(() => window.__prefsStore.getState().openDialog('display'));
    await bounds('.preferences-dialog');
    await bounds('#pref-tab-display');
    await bounds('#pref-close-btn');
    assert.equal(await page.locator('.preferences-dialog').evaluate(e => e.scrollWidth > e.clientWidth + 1), false, 'Preferences has no horizontal clipping');
    await page.locator('#pref-close-btn').click({ trial: true });
    await shot(`preferences-${width}-font${scale}`);
    await page.click('#pref-close-btn');
    console.log(`PASS layout ${width}x${height} font ${scale}%`);
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.click('#add-plate-btn');
  await page.click('#add-plate-btn');
  await bounds('#plate-selector-bar');
  await page.locator('#slice-plate-btn').click({ trial: true });
  await page.click('#plate-tab-0');
  await shot('plate-groups-1024-font150');
  await page.evaluate(() => {
    const plate = window.__plateStore.getState(), object = plate.objects[0];
    plate.selectObject(object.id, object.instances[0].id);
    window.__prefsStore.getState().setDisplayPref('theme', 'dark');
  });
  for (const tool of ['#tool-move-btn', '#tool-rotate-btn', '#tool-scale-btn']) {
    await clickTool(tool);
    await bounds('#selection-panel');
    const selection = await page.locator('#selection-panel').boundingBox();
    const plateActions = await page.locator('#plate-selector-bar').boundingBox();
    assert.ok(selection.y + selection.height <= plateActions.y, 'transforms clear plate actions');
    const labelsFit = await page.locator('#numeric-transform > div').evaluateAll(rows => rows.every(row => {
      const label = row.querySelector('span'), input = row.querySelector('input,button');
      if (!label || !input) return true;
      const range = document.createRange(); range.selectNodeContents(label);
      return range.getBoundingClientRect().right <= input.getBoundingClientRect().left;
    }));
    assert.equal(labelsFit, true, 'large transform labels do not overlap numeric controls');
  }
  await shot('numeric-transform-1024-font150');
  await clickTool('#tool-cut-btn');
  await page.click('#cut-add-connector-btn');
  await bounds('#cut-tool-panel');
  assert.equal(await page.locator('#selection-panel').count(), 0, 'cut panel does not cover numeric transform actions');
  await page.locator('#perform-cut-btn').scrollIntoViewIfNeeded();
  await bounds('#perform-cut-btn');
  await page.locator('#perform-cut-btn').click({ trial: true });
  await shot('cut-connectors-1024-font150');
  await page.click('#close-cut-btn');
  await bounds('#selection-panel');
  for (const orientation of ['vertical', 'horizontal']) {
    await page.evaluate(orientation => {
      window.__prefsStore.getState().setDisplayPref('toolbarOrientation', orientation);
      window.__prefsStore.getState().setDisplayPref('theme', orientation === 'horizontal' ? 'light' : 'dark');
    }, orientation);
    for (const [tool, panel, close] of [
      ['#tool-cut-btn', '#cut-tool-panel', '#close-cut-btn'],
      ['#tool-text-btn', '#text-emboss-panel', '#close-text-btn'],
      ['#tool-measure-btn', '#measure-panel', '#measure-close'],
      ['#tool-explode-btn', '#explode-panel', '#explode-close'],
      ['#tool-paint-btn', '#paint-tools-panel', '#paint-done-btn']
    ]) {
      await clickTool(tool);
      const box = await bounds(panel);
      if (panel === '#paint-tools-panel') {
        for (const button of await page.getByRole('group', { name: 'Painting Tool' }).locator('button').all()) {
          const choice = await button.boundingBox();
          assert.ok(choice.x + choice.width <= box.x + box.width, 'painting choices do not clip at 150%');
          await button.click({ trial: true });
        }
      }
      const views = await page.locator('.view-buttons').boundingBox();
      assert.ok(box.y >= views.y + views.height, `${panel} clears camera controls`);
      if (orientation === 'horizontal') {
        const toolbar = await page.locator('#plate-toolbar').boundingBox();
        assert.ok(box.y >= toolbar.y + toolbar.height, `${panel} clears wrapped horizontal tools`);
      }
      await shot(`${panel.slice(1)}-${orientation}-1024-font150`);
      const plateBar = await bounds('#plate-selector-bar');
      const toolBounds = await bounds(panel);
      assert.ok(toolBounds.y + toolBounds.height <= plateBar.y, 'tool panel clears plate actions');
      await page.click(close);
    }
  }
  for (const theme of ['dark', 'light']) for (const [width, height] of [[1280, 800], [390, 844]]) for (const scale of [100, 150]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ theme, scale }) => {
      const prefs = window.__prefsStore.getState();
      prefs.setGeneralPref('language', 'es');
      prefs.setDisplayPref('theme', theme);
      prefs.setDisplayPref('fontScale', scale);
      prefs.openDialog('display');
    }, { theme, scale });
    await page.waitForTimeout(300);
    await bounds('.preferences-dialog');
    await bounds('#pref-close-btn');
    await shot(`dialog-${width}-es-${theme}-font${scale}`);
    await page.click('#pref-close-btn');
  }
  await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'en'));
  await page.setViewportSize({ width: 1280, height: 800 });
  const manageTrigger = page.getByTestId('manage-process-btn');
  await manageTrigger.focus();
  await manageTrigger.click();
  const manage = page.getByTestId('manage-presets-dialog');
  assert.equal(await manage.evaluate(node => node.contains(document.activeElement)), true, 'Manage Presets enters shared Dialog focus');
  await page.getByTestId('manage-preset-close-btn').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByTestId('manage-preset-done-btn').evaluate(node => node === document.activeElement), true, 'Manage Presets contains Tab');
  await bounds('.manage-presets-panel > .ds-dialog__foot');
  await page.keyboard.press('Escape');
  await manage.waitFor({ state: 'detached' });
  assert.equal(await manageTrigger.evaluate(node => node === document.activeElement), true, 'Manage Presets cancel returns focus');

  for (const theme of ['dark', 'light']) for (const [width, height] of [[1280, 800], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => {
      const prefs = window.__prefsStore.getState();
      prefs.setGeneralPref('language', 'es'); prefs.setDisplayPref('theme', theme); prefs.setDisplayPref('fontScale', 150);
      window.__appStore.getState().openManagePresetsDialog('process');
    }, theme);
    await bounds('.manage-presets-panel');
    await bounds('.manage-presets-panel > .ds-dialog__foot');
    await shot(`manage-${width}-es-${theme}-font150`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__calibrationStore.getState().openDialog());
    await bounds('.flow-rate-panel');
    await bounds('#calib-generate-btn');
    assert.equal(await page.locator('#calib-generate-btn').textContent().then(text => text.trim()), 'Generar placa de calibración');
    await page.locator('.flowrate-modal__div-36').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await bounds('.flow-rate-panel > .ds-dialog__foot');
    await shot(`flow-generator-${width}-es-${theme}-font150`);
    await page.evaluate(() => window.__calibrationStore.setState({ showConfirmReplace: true }));
    await bounds('#calib-confirm-cancel');
    await page.click('#calib-confirm-cancel');
    assert.equal(await page.locator('#calib-generate-btn').count(), 1, 'Flow confirmation cancellation preserves the generator branch');
    await page.getByTestId('calib-tab-calculator').click();
    await bounds('#calib-calc-apply');
    await bounds('.flow-rate-panel > .ds-dialog__foot');
    await shot(`flow-calculator-${width}-es-${theme}-font150`);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'en'));
  console.log('PASS shared Dialog focus/cancel for Manage Presets; pinned Flow generator, confirmation and calculator footers, Spanish at 1280/390 and 150%');
  await page.evaluate(() => window.__appStore.getState().startSlice());
  await page.waitForSelector('#canvas[data-preview-ready=true]', { timeout: 60000 });
  for (const [width, height] of matrix) {
    await page.setViewportSize({ width, height });
    await page.evaluate(width => window.__prefsStore.getState().setDisplayPref('theme', width > 800 ? 'dark' : 'light'), width);
    if (width <= 800) await page.waitForFunction(() => {
      const stats = document.querySelector('#mobile-preview-stats'), move = document.querySelector('#move-slider-container'), layer = document.querySelector('#layer-slider-container');
      if (!stats || !move || !layer) return false;
      const s = stats.getBoundingClientRect(), m = move.getBoundingClientRect(), l = layer.getBoundingClientRect();
      const reset = document.querySelector('#btn-reset-layers').getBoundingClientRect();
      const count = document.querySelector('#layer-total-count').getBoundingClientRect();
      return m.bottom <= s.top && l.bottom <= m.top && reset.bottom <= m.top && count.bottom <= m.top;
    }).catch(async error => {
      await shot(`preview-${width}-rail-failure`);
      console.log(await page.locator('#mobile-preview-stats,#move-slider-container,#layer-slider-container,#btn-reset-layers,#layer-total-count').evaluateAll(nodes => nodes.map(node => ({ id: node.id, bounds: node.getBoundingClientRect().toJSON() }))));
      throw error;
    });
    const layers = await bounds('#layer-slider-container');
    const moves = await bounds('#move-slider-container');
    if (width > 800) {
      if (!await page.locator('#gcode-window').count()) await page.click('#btn-toggle-gcode-window');
      const gcode = await bounds('#gcode-window');
      const stats = await bounds('.slice-stats-panel');
      assert.ok(gcode.y + gcode.height <= stats.y, 'G-code and statistics do not overlap');
      assert.ok(stats.x + stats.width <= layers.x, 'statistics clear layer rail');
      const plateBar = await bounds('#orca-preview-view #plate-selector-bar');
      assert.ok(stats.y + stats.height <= plateBar.y, 'statistics clear plate actions');
      await page.locator('#view-type-select').selectOption({ index: 1 });
      await bounds('#preview-legend-panel');
      await shot(`preview-${width}-font150`);
    } else {
      const stats = await bounds('#mobile-preview-stats');
      assert.ok(layers.y + layers.height <= moves.y, 'layer rail clears move rail');
      assert.ok(moves.y + moves.height <= stats.y, 'move rail clears measured mobile statistics');
      const reset = await bounds('#btn-reset-layers');
      const count = await bounds('#layer-total-count');
      assert.ok(reset.y + reset.height <= moves.y && count.y + count.height <= moves.y, `layer actions stay inside their rail at ${width}x${height}: ${JSON.stringify({reset, count, moves})}`);
      await page.locator('#btn-reset-layers').click({ trial: true });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#canvas'), rect = canvas.getBoundingClientRect();
        const dpr = window.__prefsStore.getState().display.previewLowQuality ? 1 : devicePixelRatio;
        return canvas.width === Math.floor(rect.width * dpr) && canvas.height === Math.floor(rect.height * dpr);
      });
      await page.locator('#mobile-download').click({ trial: true });
      await page.locator('#mobile-send').click({ trial: true });
      await shot(`preview-${width}-font150`);
    }
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.click('#tab-calibration');
  for (const [width, height] of [[1024, 768], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await bounds('#calibration-page');
    await page.locator('.calib-tile').last().scrollIntoViewIfNeeded();
    await bounds('#cal-cornering');
    await page.locator('#cal-cornering').click({ trial: true });
    await shot(`calibration-scrolled-${width}-font150`);
  }
  await page.evaluate(() => window.__prefsStore.getState().openDialog('display'));
  await page.click('#pref-reset-btn');
  assert.equal(await page.evaluate(() => window.__prefsStore.getState().display.fontScale), 100, 'Reset restores default size');
  await page.reload();
  await page.waitForFunction(() => window.__prefsStore?.getState().display.fontScale === 100);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '16px', 'reset is persistent');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS font choices, persistence and reset; root/object/part menu clickability; large-text cut actions');
} finally {
  await browser?.close();
  await stopServer(port);
}
