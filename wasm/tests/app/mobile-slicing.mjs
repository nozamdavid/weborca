#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { coverMobileSettings, controlValue, controlOptions, selectControl } from './mobile-setting-coverage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const screenshots = path.join(root, 'wasm/build/tests-app/mobile');
const port = 5168;
const url = `http://127.0.0.1:${port}`;
process.env.MOBILE_SLICE_STEPS = 'enable_support,support_type,infill_pct,infill_pattern,unknown_mobile_key';
process.env.MOBILE_SECRET_TEST = 'must-not-be-exposed';
fs.mkdirSync(screenshots, { recursive: true });
const browserErrors = [];
let browser;
const isolatedPages = new WeakSet();

async function ready(page) {
  if (!isolatedPages.has(page)) {
    isolatedPages.add(page);
    await page.route('**/*', route => {
      const target = new URL(route.request().url());
      if (target.origin !== url || /^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud)(\/|$)/.test(target.pathname)) return route.abort();
      return route.fallback();
    });
  }
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 120000 });
  await page.evaluate(async () => {
    window.__prefsStore.getState().setGeneralPref('autosave', false);
    window.__prefsStore.getState().setGeneralPref('autoSliceAfterChange', false);
    await window.__appStore.getState().chooseVendor('Voron');
    await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
  });
  const recovery = page.locator('#recovery-discard');
  if (await recovery.isVisible()) await recovery.click();
}
async function importCube(page) {
  await page.setInputFiles('#mobile-import', path.join(root, 'tests/data/20mm_cube.obj'));
  await page.waitForFunction(() => window.__appStore.getState().modelFile && !window.__appStore.getState().isModelLoading, null, { timeout: 60000 });
}
async function openFlow(page, advanced = false, capture = true) {
  await page.click('#mobile-choose-settings');
  assert.equal(await page.locator('#mobile-printer-select').isVisible(), true);
  const width = page.viewportSize().width;
  const toast = await page.locator('#toast-container').boundingBox();
  const footer = await page.locator('.mobile-flow footer').boundingBox();
  if (toast) assert.ok(toast.y + toast.height <= footer.y, 'flow toast clears Back and Next');
  if (capture) await page.screenshot({ path: path.join(screenshots, `printer-${width}.png`) });
  await page.click('#mobile-next');
  await page.click(advanced ? '#mobile-advanced-mode' : '#mobile-preset-mode');
  await page.click('#mobile-next');
  if (capture) await page.screenshot({ path: path.join(screenshots, `preset-${width}.png`) });
  await page.click('#mobile-next');
  await page.waitForSelector(advanced ? '[data-mobile-key]' : '#mobile-slice');
  if (capture) await page.screenshot({ path: path.join(screenshots, `${advanced ? 'advanced' : 'review'}-${width}.png`) });
}
async function slice(page) {
  await page.click('#mobile-slice');
  await page.waitForSelector('[data-testid=slicing-warning]');
  assert.equal(await page.locator('[data-testid=slicing-warning]').isVisible(), true);
  assert.match(await page.title(), /Slicing.*don't leave this tab/);
  await page.screenshot({ path: path.join(screenshots, `slicing-${page.viewportSize().width}.png`) });
  await page.waitForFunction(() => window.__appStore.getState().sliceResult?.gcode && !window.__appStore.getState().isSlicing, null, { timeout: 120000 });
  await page.waitForSelector('#canvas[data-preview-ready=true]', { timeout: 60000 });
  await page.waitForSelector('#mobile-preview-stats');
  assert.equal(await page.locator('[data-testid=slicing-warning]').count(), 0);
}

async function addPrinter(page, width) {
  await page.click('#mobile-choose-settings');
  const before = await page.evaluate(() => ({ printer: window.__appStore.getState().selectedPrinter,
    devices: window.__printerStore.getState().printers }));
  await selectControl(page.locator('#mobile-printer-select'), '__add_printer__');
  await page.waitForSelector('#wizard-dialog');
  const box = await page.locator('.wizard-modal').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844, 'Add printer fits phone');
  await page.screenshot({ path: path.join(screenshots, `add-printer-${width}.png`) });
  await page.click('#wizard-close-x');
  assert.equal(await page.locator('#mobile-printer-select').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => ({ printer: window.__appStore.getState().selectedPrinter,
    devices: window.__printerStore.getState().printers })), before, 'closing wizard leaves profile/device unchanged');
  await selectControl(page.locator('#mobile-printer-select'), '__add_printer__');
  await page.waitForSelector('#wizard-dialog');
  await page.check('#wizard-custom-printer');
  await page.fill('#wizard-custom-name', `Mobile ${width}`);
  await page.click('#wizard-next-btn');
  await page.click('#wizard-next-btn');
  await page.click('#wizard-finish-btn');
  await page.waitForSelector('#wizard-dialog', { state: 'detached', timeout: 60000 });
  assert.equal(await controlValue(page.locator('#mobile-printer-select')), `user:Mobile ${width}`);
  await page.locator('.mobile-flow header button').click();
}
async function advancedFlow(page, width) {
  await page.getByRole('button', { name: 'Prepare', exact: true }).click();
  await openFlow(page, true);
  await page.check('#setting-input-enable_support');
  await page.waitForFunction(() => !Object.keys(window.__appStore.getState().pendingOptions).length);
  await page.click('#mobile-next');
  const support = page.locator('#setting-input-support_type');
  await support.waitFor();
  assert.equal(await support.isVisible(), true);
  const choice = (await controlOptions(support))[0];
  await selectControl(support, choice);
  await page.waitForFunction(() => !Object.keys(window.__appStore.getState().pendingOptions).length);
  await page.click('#mobile-back');
  await page.waitForSelector('#setting-input-enable_support');
  assert.equal(await page.isChecked('#setting-input-enable_support'), true, 'Back preserves entered support');
  await page.click('#mobile-next');
  await page.waitForSelector('#setting-input-support_type');
  await page.click('#mobile-next');
  await page.waitForSelector('#setting-input-sparse_infill_density');
  await page.fill('#setting-input-sparse_infill_density', '22%');
  await page.locator('#setting-input-sparse_infill_density').blur();
  await page.waitForFunction(() => window.__appStore.getState().currentConfig.sparse_infill_density === '22%');
  await page.screenshot({ path: path.join(screenshots, `settings-${width}.png`) });
  await page.click('#mobile-next');
  await page.waitForSelector('#setting-input-sparse_infill_pattern');
  assert.equal(await page.locator('#setting-input-sparse_infill_pattern').isVisible(), true);
  await page.click('#mobile-next');
  await page.waitForSelector('[data-mobile-key=unknown_mobile_key]');
  assert.match(await page.locator('[data-mobile-key]').innerText(), /Unknown setting key.*unknown_mobile_key/s);
  await page.click('#mobile-next');
  await page.waitForSelector('#mobile-slice');
  await page.screenshot({ path: path.join(screenshots, `advanced-review-${width}.png`) });
  await slice(page);
}

try {
  await startServer(port, 'mobile-slicing', { frozenDist: true });
  const config = await (await fetch(`${url}/app-config.json`)).json();
  assert.deepEqual(Object.keys(config), ['mobileSliceSteps'], 'Only whitelisted mobile config is exposed');
  assert.equal(config.mobileSliceSteps, process.env.MOBILE_SLICE_STEPS, 'preview runtime env overrides build fallback');
  browser = await chromium.launch({ headless: true });
  for (const width of process.env.MOBILE_COVERAGE_ONLY ? [] : [390, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, acceptDownloads: true });
    const page = await context.newPage();
    await ready(page);
    assert.equal(await page.locator('#mobile-choose-settings').count(), 0, 'initial mobile has no settings CTA');
    assert.equal(await page.locator('#plate-toolbar').isVisible(), false);
    await page.screenshot({ path: path.join(screenshots, `initial-${width}.png`) });
    await importCube(page);
    assert.equal(await page.locator('.sidebar').count(), 0);
    assert.equal(await page.locator('#plate-toolbar').isVisible(), false);
    await page.screenshot({ path: path.join(screenshots, `prepare-${width}.png`) });
    const toast = await page.locator('#toast-container').boundingBox();
    const importBar = await page.locator('.mobile-import-bar').boundingBox();
    if (toast) assert.ok(toast.y >= importBar.y + importBar.height || toast.y + toast.height <= importBar.y, 'import toast clears import actions');
    await addPrinter(page, width);
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('layer_height', '0.3', 'print'));
    await openFlow(page);
    assert.equal(await page.evaluate(() => Object.keys(window.__appStore.getState().processOverrides).length), 0, 'preset defaults clear overrides');
    assert.equal(await page.evaluate(() => {
      const s = window.__appStore.getState(); return s.currentConfig.layer_height === s.presetConfig.layer_height;
    }), true);
    await slice(page);
    await page.screenshot({ path: path.join(screenshots, `preview-${width}.png`) });
    assert.equal(await page.locator('[data-testid=preview-legend]').count(), 0);
    assert.equal(await page.locator('#btn-toggle-gcode-window').isVisible(), false);
    assert.match(await page.locator('#mobile-preview-stats').innerText(), /Filament cost/);
    assert.ok(await page.locator('.mobile-filament-swatch').count(), 'used filament has a palette swatch');
    const stats = await page.locator('#mobile-preview-stats').boundingBox();
    const moves = await page.locator('#move-slider-container').boundingBox();
    assert.ok(moves.y + moves.height <= stats.y, 'move controls clear bottom statistics');
    const canvas = await page.locator('#canvas').boundingBox();
    const layers = await page.locator('#layer-slider-container').boundingBox();
    assert.ok(canvas.x + canvas.width <= layers.x, 'toolpaths clear the layer rail');
    const previewToast = await page.locator('#toast-container').boundingBox();
    if (previewToast) assert.ok(previewToast.x + previewToast.width <= layers.x, 'preview toast clears layer controls');
    const downloadPromise = page.waitForEvent('download');
    await page.click('#mobile-download');
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.gcode$/);
    const payload = fs.readFileSync(await download.path(), 'utf8');
    assert.match(payload, /thumbnail begin/, 'existing thumbnail export path');
    await page.click('#mobile-send');
    const send = page.locator('#send-to-printer-dialog');
    await send.waitFor();
    const box = await send.locator(':scope > div').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'send portal fits narrow screen');
    assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < 2, 'send dialog centered');
    await page.screenshot({ path: path.join(screenshots, `send-${width}.png`) });
    await page.keyboard.press('Escape');
    await advancedFlow(page, width);
    if (width === 390) {
      await page.evaluate(async () => {
        window.__prefsStore.getState().setGeneralPref('autosave', true);
        await window.__autosave.writeAutosave();
        window.__prefsStore.getState().setGeneralPref('autosave', false);
      });
      await page.reload();
      await page.waitForSelector('#recovery-restore', { timeout: 120000 });
      await page.click('#recovery-restore');
      await page.waitForSelector('#recovery-dialog', { state: 'detached', timeout: 120000 });
      assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.sparse_infill_density), '22%', 'refresh recovery preserves advanced values');
      await page.getByRole('button', { name: 'Prepare', exact: true }).click();
      assert.equal(await page.locator('#mobile-choose-settings').isVisible(), true);
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/app-config.json', route => route.fulfill({ json: { mobileSliceSteps: 'extruder,flush_into_objects' } }));
  await ready(page);
  await importCube(page);
  await openFlow(page, true, false);
  const regressionFailures = [];
  if (!await page.locator('#mobile-part-target').count()) regressionFailures.push('Extruder assignment has no part picker');
  await page.click('#mobile-next');
  await page.waitForSelector('#setting-input-flush_into_objects');
  await page.evaluate(async () => {
    await window.__appStore.getState().applyOptionChange('enable_prime_tower', '1', 'print');
    await window.__appStore.getState().applyOptionChange('flush_into_objects', '1', 'print');
    const object = window.__objectListStore.getState().objects[0];
    await window.__objectListStore.getState().resetObjectConfig(object.id, null, ['flush_into_objects']);
  });
  assert.equal(await page.isChecked('#setting-input-flush_into_objects'), true, 'checkbox inherits global flush 1');
  const objectName = await page.evaluate(() => window.__objectListStore.getState().objects[0].name);
  await page.click('#mobile-next');
  await page.waitForSelector('#mobile-slice');
  const flushReview = page.locator('p').filter({ has: page.locator('code', { hasText: 'flush_into_objects' }) });
  if (!(await flushReview.innerText()).includes(`${objectName}: 1`)) regressionFailures.push('Review does not inherit global flush 1');
  await page.screenshot({ path: path.join(screenshots, 'flush-inherited-review-390.png') });
  await page.click('#mobile-back');
  await page.uncheck('#setting-input-flush_into_objects');
  await page.waitForFunction(() => window.__objectListStore.getState().objects[0].config.flush_into_objects === '0');
  await page.waitForFunction(() => !document.querySelector('#mobile-next').disabled);
  assert.equal(await page.evaluate(() => window.__objectListStore.getState().objects[0].config.flush_into_objects), '0');
  assert.equal(await page.isChecked('#setting-input-flush_into_objects'), false, 'explicit object 0 overrides global 1');
  await page.click('#mobile-next');
  await page.waitForSelector('#mobile-slice');
  assert.ok((await flushReview.innerText()).includes(`${objectName}: 0`), 'Review preserves explicit object 0');
  assert.deepEqual(regressionFailures, [], 'part picker and inherited flush regressions');
  await ready(page);
  const keys = await page.evaluate(() => Object.keys(window.__appStore.getState().configDefs).sort());
  await page.route('**/app-config.json', route => route.fulfill({ json: { mobileSliceSteps: keys.join(',') } }));
  await ready(page);
  await importCube(page);
  await openFlow(page, true, false);
  await page.evaluate(async () => {
    const s = window.__appStore.getState();
    await s.chooseFilament(s.selectedFilament, 1);
    // Geometry groups are visible only for two-extruder FFF configurations.
    await window.__appStore.getState().applyOptionChange('nozzle_diameter', '0.4,0.4', 'printer');
    await window.__appStore.getState().applyOptionChange('extruder_printable_height', '100,200', 'printer');
    // Keep another object/plate and an unrelated override for context checks.
    await window.__platesStore.getState().addPlate();
    window.__platesStore.getState().setActivePlate(0);
  });
  await importCube(page);
  await page.evaluate(async () => {
    const objects = await window.__objectListStore.getState().refreshTree();
    const volumeId = await window.__objectListStore.getState().addVolume({ objectId: objects[0].id, type: 'part', shape: 'cube', size: [10, 10, 10], offset: [30, 0, 0] });
    await window.__objectListStore.getState().setVolumeExtruder(objects[0].id, volumeId, objects[0].volumes[0].extruder);
    await window.__objectListStore.getState().setObjectConfig(objects[0].id, null, { layer_height: '0.2' });
    await window.__objectListStore.getState().setObjectConfig(objects[1].id, null, { wall_loops: '3' });
    const duplicate = await window.__orcaEngine.call('duplicateInstance', { objectId: objects[0].id, instanceId: objects[0].instances[0].id });
    const otherPlate = window.__platesStore.getState().plates[1];
    await window.__plateStore.getState().setInstanceTransform(objects[0].id, duplicate.instanceId,
      { offset: [otherPlate.origin[0] + 150, otherPlate.origin[1] + 150, 0] });
  });
  const coverage = await coverMobileSettings(page, keys);
  const vendorKeys = coverage.skipped.filter(item => item.category === 'vendor-context').map(item => item.key);
  if (vendorKeys.length) {
    await page.route('**/app-config.json', route => route.fulfill({ json: { mobileSliceSteps: vendorKeys.join(',') } }));
    await ready(page);
    await page.evaluate(() => window.__appStore.getState().chooseVendor('BBL'));
    await importCube(page);
    await openFlow(page, true, false);
    await page.evaluate(async () => {
      const s = window.__appStore.getState();
      await s.chooseFilament(s.selectedFilament, 1);
      await window.__appStore.getState().applyOptionChange('nozzle_diameter', '0.4,0.4', 'printer');
    });
    // These definitions were already counted in the Voron census. Replace
    // their skips with verification on the actual Bambu vendor profile.
    for (const item of coverage.skipped.filter(item => vendorKeys.includes(item.key))) coverage.types[item.type]--;
    coverage.widgets.skip -= vendorKeys.length;
    coverage.skipped = coverage.skipped.filter(item => !vendorKeys.includes(item.key));
    await coverMobileSettings(page, vendorKeys, coverage);
  }
  fs.writeFileSync(path.join(screenshots, 'setting-coverage.json'), JSON.stringify(coverage, null, 2));
  console.log('SETTING COVERAGE', JSON.stringify({ total: coverage.total, editable: coverage.editable, cells: coverage.cells,
    types: coverage.types, changed: coverage.changed, skipCounts: coverage.skipCounts, failures: coverage.failures }));
  await context.close();
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 844 } });
  await ready(desktop);
  assert.equal(await desktop.locator('.sidebar').isVisible(), true);
  assert.equal(await desktop.locator('#plate-toolbar').isVisible(), true);
  assert.equal(await desktop.locator('#mobile-choose-settings').count(), 0);
  await desktop.screenshot({ path: path.join(screenshots, 'desktop-1280.png') });
  await desktop.close();
  assert.deepEqual(browserErrors, []);
  assert.deepEqual(coverage.failures, [], 'Every editable setting must accept its UI change');
  assert.equal(new Set(coverage.changed.map(item => item.type)).size, Object.keys(coverage.editableTypes).length,
    'Every exposed editable native type has a changed UI write');
  console.log(process.env.MOBILE_COVERAGE_ONLY ? 'PASS mobile setting coverage and desktop smoke' :
    'PASS mobile preset/advanced flows at 390 and 768, runtime config, export/send, all settings and desktop smoke');
} finally {
  await browser?.close();
  await stopServer(port);
}
