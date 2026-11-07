import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { detailedGcode } from '../lib/preview-performance-fixtures.mjs';
import { controlOptions, controlValue, selectControl } from './mobile-setting-coverage.mjs';

const port = 5341;
const origin = `http://127.0.0.1:${port}`;
const out = path.resolve(process.env.APP_TEST_OUTPUT || 'docs/superpowers/ui-followups-20261014/green');
fs.mkdirSync(out, { recursive: true });
let browser;
let failures = 0;
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
await startServer(port, 'followups', { frozenDist: true });
try {
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || /^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud)(\/|$)/.test(url.pathname)) return route.abort();
    if (url.pathname === '/app-config.json') return route.fulfill({ json: { mobileSliceSteps: 'sparse_infill_pattern' } });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ready = async (url = '/prepare') => {
    await page.goto(origin + url);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(() => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      window.__prefsStore.getState().setGeneralPref('autoSliceAfterChange', false);
    });
  };
  await ready();
  await page.evaluate(async () => {
    await window.__appStore.getState().chooseVendor('Voron');
    await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
  });
  await page.setInputFiles('#mobile-import', path.resolve('tests/data/20mm_cube.obj'));
  await page.waitForFunction(() => window.__appStore.getState().modelFile && !window.__appStore.getState().isModelLoading);
  await page.click('#mobile-choose-settings');
  await page.click('#mobile-next');
  await page.click('#mobile-advanced-mode'); await page.click('#mobile-next');
  await check('settings step dropdown lays out right chevron', async () => {
    const display = await page.locator('#mobile-process, #mobile-filament').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).display));
    await page.screenshot({ path: path.join(out, 'process-trigger-390.png') });
    assert.equal(display.length, 2);
    assert.ok(display.every(value => value.includes('flex')), `process/filament dropdown display was ${display}`);
  });
  await page.click('#mobile-next');
  await page.waitForSelector('#setting-input-sparse_infill_pattern');
  await check('enum arrow/fullscreen/native value', async () => {
    const trigger = page.locator('#setting-input-sparse_infill_pattern');
    const geometry = await trigger.evaluate(node => {
      const pseudo = getComputedStyle(node, '::after');
      const arrow = node.querySelector('.mobile-select-chevron');
      const box = arrow?.getBoundingClientRect();
      return { display: getComputedStyle(node).display, pseudo: { content: pseudo.content, display: pseudo.display, width: pseudo.width, height: pseudo.height, border: pseudo.borderRightWidth },
        arrow: box && { width: box.width, height: box.height, right: box.right, triggerRight: node.getBoundingClientRect().right } };
    });
    await page.screenshot({ path: path.join(out, 'enum-trigger-390.png') });
    console.log('arrow geometry', JSON.stringify(geometry));
    assert.ok(geometry.display.includes('flex'), 'dropdown must lay out its value and right chevron with flex');
    assert.ok(geometry.arrow?.width > 0 || (geometry.pseudo.content !== 'none' && parseFloat(geometry.pseudo.width) > 0 && parseFloat(geometry.pseudo.border) > 0));
    if (geometry.arrow) assert.ok(geometry.arrow.right < geometry.arrow.triggerRight && geometry.arrow.triggerRight - geometry.arrow.right < 30, 'chevron sits visibly inside right edge');
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('fontScale', 150));
    await page.waitForTimeout(100);
    if (geometry.arrow) {
      const bounds = await trigger.evaluate(node => {
        const arrow = node.querySelector('.mobile-select-chevron').getBoundingClientRect();
        const value = node.querySelector('.ds-dropdown__value').getBoundingClientRect();
        const trigger = node.getBoundingClientRect();
        return { arrow: { left: arrow.left, right: arrow.right, width: arrow.width }, valueRight: value.right, triggerRight: trigger.right };
      });
      assert.ok(bounds.arrow.width > 0 && bounds.arrow.left >= bounds.valueRight && bounds.arrow.right < bounds.triggerRight);
    }
    await page.screenshot({ path: path.join(out, 'enum-trigger-320-150.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('fontScale', 100));
    const current = await controlValue(trigger);
    const replacement = (await controlOptions(trigger)).find(value => value !== current);
    await trigger.click();
    assert.deepEqual(await page.locator('.mobile-selector').boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, 'enum-selector-390.png') });
    await page.keyboard.press('Escape');
    await selectControl(trigger, replacement);
    await page.waitForFunction(() => !Object.keys(window.__appStore.getState().pendingOptions).length);
    assert.equal(await page.evaluate(async () => (await window.__orcaEngine.call('getOption', { key: 'sparse_infill_pattern' })).value), replacement);
  });
  await page.locator('.mobile-flow').getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async () => {
    window.__prefsStore.getState().setGeneralPref('autosave', true);
    await window.__autosave.writeAutosave();
    window.__prefsStore.getState().setGeneralPref('autosave', false);
  });
  await ready('/preview');
  await page.locator('#recovery-dialog').waitFor();
  const config = await page.evaluate(() => window.__appStore.getState().currentConfig);
  const code = detailedGcode({ layers: 3, segments: 16, tools: 1, config });
  // Seed the retained sliced result at the recovery/app seam, without asking the
  // archive parser to manufacture G-code. Restore still runs through the real offer.
  await page.evaluate(text => {
    const bytes = new TextEncoder().encode(text);
    window.__appStore.setState({ sliceResult: { gcode: bytes, gcodePath: 'recovered.gcode', gcodeBytes: bytes.length, layers: 3, plateIndex: 0, warnings: [], printTimeS: 1, filamentMm: 1, filamentG: 1 } });
    const original = window.__appStore.getState().openProjectFile;
    window.__appStore.setState({ openProjectFile: async file => {
      const retained = window.__appStore.getState().sliceResult;
      await original(file);
      window.__appStore.setState({ sliceResult: retained });
    } });
  }, code);
  await check('successful recovery retains result and opens Prepare URL', async () => {
    await page.click('#recovery-restore');
    await page.locator('#recovery-dialog').waitFor({ state: 'detached' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, 'recovered-prepare-390.png') });
    assert.equal(new URL(page.url()).pathname, '/prepare');
    assert.equal(await page.locator('.prepare-page').isVisible(), true);
    assert.equal(await page.evaluate(() => new TextDecoder().decode(window.__appStore.getState().sliceResult.gcode)), code);
  });
  await check('later fresh slice automatically opens Preview', async () => {
    await page.evaluate(() => window.__appStore.getState().startSlice());
    await page.waitForFunction(() => !window.__appStore.getState().isSlicing);
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
    await page.waitForURL('**/preview');
    await page.waitForFunction(() => document.getElementById('canvas')?.dataset.previewReady === 'true');
  });
  await check('phone keeps Layer and removes Move at 390 and 320/150%', async () => {
    for (const [width, height, scale] of [[390, 844, 100], [320, 568, 150]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(scale => window.__prefsStore.getState().setDisplayPref('fontScale', scale), scale);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `preview-${width}-${scale}.png`) });
      assert.equal(await page.locator('#move-slider-container').count(), 0);
      assert.equal(await page.locator('#layer-slider-container').isVisible(), true);
      const rail = await page.locator('#layer-slider-container').boundingBox();
      const stats = await page.locator('#mobile-preview-stats').boundingBox();
      assert.ok(rail.y + rail.height <= stats.y, 'Layer clears statistics');
    }
  });
  await check('warning belongs to existing progress popup and lifecycle cleans up', async () => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      if (width === 1280) await page.locator('#move-slider-container').waitFor({ state: 'visible', timeout: 5000 });
      const title = await page.title();
      await page.evaluate(() => window.__appStore.setState({ isSlicing: true, sliceStatusText: 'Preparing fixture', slicePercent: 42 }));
      await page.waitForSelector('#preview-slicing-overlay');
      await page.screenshot({ path: path.join(out, `slicing-${width}.png`) });
      assert.equal(await page.locator('#preview-slicing-overlay [data-testid=slicing-warning]').innerText({ timeout: 1500 }), "Slicing (don't leave this tab)");
      assert.equal(await page.locator('nav [data-testid=slicing-warning], .topbar [data-testid=slicing-warning]').count(), 0);
      assert.equal(await page.locator('[data-testid=slicing-warning]').count(), 1);
      assert.equal(await page.title(), "Slicing (don't leave this tab)");
      assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true);
      await page.evaluate(() => window.__appStore.setState({ isSlicing: false }));
      await page.locator('#preview-slicing-overlay').waitFor({ state: 'detached' });
      assert.equal(await page.title(), title);
      assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), false);
    }
  });
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await stopServer(port); }
if (failures) process.exitCode = 1;
