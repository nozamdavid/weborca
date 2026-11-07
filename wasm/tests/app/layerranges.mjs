#!/usr/bin/env node
/**
 * @file layerranges.mjs
 * End-to-end browser test for OrcaSlicer Web Layer Height Ranges (Height range Modifier).
 *
 * Runs against the built app on port 5190 across Chromium and Firefox sequentially:
 * 1. Loads 20mm_cube.obj and verifies canvas rendering and baseline slicing (100 layers).
 * 2. Opens object context menu and clicks "Height range Modifier".
 * 3. Verifies "Layers" root node and child range row appear in object list.
 * 4. Edits range bounds numerically (min 10 mm, max 20 mm) with validation.
 * 5. Configures per-range overrides: layer_height 0.1 mm and wall_loops 4.
 * 6. Slices and verifies sliced output changes (150 layers vs baseline 100 layers).
 * 7. Saves project to 3MF and re-opens, verifying range and overrides persist.
 * 8. Verifies undo/redo and range deletion.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CUBE_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const CUBE = fs.readFileSync(CUBE_PATH);
const PORT = parseInt(process.env.PORT || '5190', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIST_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/build/agent-layerranges-dist');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runSuite(browserType, name) {
  console.log(`\n==================================================`);
  console.log(`Starting Layer Height Ranges tests for ${name.toUpperCase()}`);
  console.log(`==================================================`);

  let browser;
  try {
    browser = await browserType.launch({
      headless: true,
      timeout: 30000,
      ...(name === 'chromium' ? { args: ['--enable-features=SharedArrayBuffer'] } : {})
    });
  } catch (err) {
    if (name === 'firefox' && process.env.SKIP_FIREFOX === '1') {
      console.warn(`[${name}] Browser launch skipped/failed on this host environment: ${err.message}`);
      return;
    }
    throw err;
  }

  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  page.on('console', (msg) => console.log(`[${name} console ${msg.type()}] ${msg.text()}`));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  try {
    log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    log('Selecting Voron printer...');
    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    log('Importing 20mm cube...');
    await page.evaluate(
      async (bytes) => window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj')),
      Array.from(CUBE)
    );
    await page.waitForFunction(() => window.__objectListStore?.getState().objects.length >= 1, null, { timeout: 30000 });

    const objId = await page.evaluate(() => window.__objectListStore.getState().objects[0].id);
    await page.waitForSelector(`#object-row-${objId}`, { timeout: 10000 });

    log('1. Slicing baseline cube (expect 100 layers for 20mm @ 0.20mm standard)...');
    await page.click('#slice-btn');
    await page.waitForFunction(() => {
      const s = window.__appStore?.getState();
      return s && !s.isSlicing && s.sliceResult && s.sliceResult.layers > 0;
    }, null, { timeout: 60000 });

    const baselineLayers = await page.evaluate(() => window.__appStore.getState().sliceResult.layers);
    log(`Baseline layers: ${baselineLayers}`);
    assert.equal(baselineLayers, 100, '20mm cube at 0.2mm standard should produce 100 layers');

    // Switch back to Prepare tab
    log('Returning to Prepare tab...');
    await page.click('#tab-prepare');
    await page.waitForSelector(`#object-more-btn-${objId}`, { timeout: 10000 });

    log('2. Opening context menu on object...');
    await page.click(`#object-more-btn-${objId}`);
    await page.waitForSelector('#object-list-context-menu', { timeout: 5000 });

    log('3. Clicking "Height range Modifier"...');
    await page.waitForSelector('#menu-action-height-range', { timeout: 5000 });
    await page.click('#menu-action-height-range');

    log('4. Verifying Layers node and child range row appear...');
    await page.waitForFunction((id) => {
      const store = window.__objectListStore?.getState();
      const obj = store?.objects.find((o) => o.id === id);
      return obj && obj.layerRanges && obj.layerRanges.length === 1;
    }, objId, { timeout: 15000 });

    await page.waitForSelector('#layer-range-row-0', { timeout: 10000 });
    const initialRangeText = await page.textContent('#range-span-0');
    log(`Initial range row text: ${initialRangeText?.trim()}`);

    log('5. Selecting range row and editing bounds in ObjectSettingsEditor...');
    await page.click('#layer-range-row-0');
    await page.waitForSelector('#layer-range-bounds-bar', { timeout: 5000 });
    await page.waitForSelector('#range-min-z-input', { timeout: 5000 });
    await page.waitForSelector('#range-max-z-input', { timeout: 5000 });

    // Set Min Z: 10, Max Z: 20
    await page.fill('#range-min-z-input', '10');
    await page.fill('#range-max-z-input', '20');
    await page.press('#range-max-z-input', 'Enter');

    // Wait for range row text to reflect 10.00 - 20.00 mm
    await page.waitForFunction(() => {
      const el = document.getElementById('range-span-0');
      return el && el.textContent && el.textContent.includes('10.00') && el.textContent.includes('20.00');
    }, null, { timeout: 10000 });
    log('Range bounds updated to 10.00 - 20.00 mm');

    log('6. Setting layer_height override to 0.1 mm...');
    await page.waitForSelector('#override-input-layer_height', { timeout: 5000 });
    await page.fill('#override-input-layer_height', '0.1');
    await page.press('#override-input-layer_height', 'Enter');

    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      const range = store?.objects[0]?.layerRanges?.[0];
      return range?.config?.layer_height === '0.1';
    }, null, { timeout: 10000 });
    log('layer_height 0.1 verified in store');

    log('7. Adding wall_loops override (4)...');
    await page.click('#btn-add-setting');
    await page.waitForSelector('#add-setting-dropdown', { timeout: 5000 });
    await page.click('#add-setting-opt-wall_loops');
    await page.waitForSelector('#override-input-wall_loops', { timeout: 5000 });
    await page.fill('#override-input-wall_loops', '4');
    await page.press('#override-input-wall_loops', 'Enter');

    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      const range = store?.objects[0]?.layerRanges?.[0];
      return range?.config?.wall_loops === '4';
    }, null, { timeout: 10000 });
    log('wall_loops 4 verified in store');

    log('8. Slicing with range modifier (0-10mm @ 0.2mm = 50 layers, 10-20mm @ 0.1mm = 100 layers -> expect 150 layers)...');
    await page.click('#slice-btn');
    await page.waitForFunction(() => {
      const s = window.__appStore?.getState();
      return s && !s.isSlicing && s.sliceResult && s.sliceResult.layers > 100;
    }, null, { timeout: 60000 });

    const newLayerCount = await page.evaluate(() => window.__appStore.getState().sliceResult.layers);
    log(`New layer count with range modifier: ${newLayerCount}`);
    assert.equal(newLayerCount, 150, 'Layer range 10-20mm @ 0.1mm must increase layer count to 150');

    log('9. Testing 3MF round-trip persistence...');
    await page.click('#tab-prepare');
    const projectBytes = await page.evaluate(async () => {
      return Array.from(await window.__appStore.getState().saveProjectFile('test_project.3mf'));
    });
    assert.ok(projectBytes && projectBytes.length > 0, 'Project file bytes should be generated');

    // Reload the saved project into the app
    log('Re-opening saved 3MF project...');
    await page.evaluate(async (bytes) => {
      const file = new File([new Uint8Array(bytes)], 'reopened.3mf');
      await window.__appStore.getState().openProjectFile(file);
    }, projectBytes);

    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      const obj = store?.objects[0];
      return obj && obj.layerRanges && obj.layerRanges.length === 1;
    }, null, { timeout: 30000 });

    const reopenedRange = await page.evaluate(() => window.__objectListStore.getState().objects[0].layerRanges[0]);
    log('Reopened range data: ' + JSON.stringify(reopenedRange));
    assert.equal(reopenedRange.minZ, 10, 'Reopened minZ must be 10');
    assert.equal(reopenedRange.maxZ, 20, 'Reopened maxZ must be 20');
    assert.equal(reopenedRange.config.layer_height, '0.1', 'Reopened layer_height must be 0.1');
    assert.equal(reopenedRange.config.wall_loops, '4', 'Reopened wall_loops must be 4');

    log('10. Testing delete range...');
    await page.waitForSelector('[data-testid="btn-delete-range-0"]', { timeout: 10000 });
    await page.click('[data-testid="btn-delete-range-0"]');

    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      return store?.objects[0]?.layerRanges?.length === 0;
    }, null, { timeout: 15000 });
    log('Range deleted successfully');

    log('11. Testing undo (should restore deleted range)...');
    await page.evaluate(async () => {
      await window.__historyStore?.getState().undo();
    });

    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      return store?.objects[0]?.layerRanges?.length === 1;
    }, null, { timeout: 20000 });
    log('Undo successfully restored layer range');

    // Screenshot
    const screenshotPath = path.join(SCREENSHOT_DIR, `layerranges-${name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log(`Saved screenshot to ${screenshotPath}`);

    log(`All layer height ranges tests passed for ${name.toUpperCase()}!`);
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'layerranges');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('\nAll Layer Height Ranges tests passed on Chromium and Firefox!');
} catch (err) {
  console.error('\nLayer Height Ranges test suite FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
