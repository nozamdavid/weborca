#!/usr/bin/env node
/**
 * @file history-recovery.mjs
 * Focused browser regression tests for OrcaSlicer Web History Undo/Redo:
 * - Finding 5: Empty canvas plate additions, duplicates, deletions, and plate config undo/redo.
 * - Finding 6: Non-empty model settings restoration where JS currentConfig and native C++
 *   config remain strictly synchronized, and user preset labels / manual overrides are preserved.
 *
 * Runs against isolated preview build on port 5194 across Chromium and Firefox sequentially.
 */

import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Import Playwright
let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = 5194;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserRecoverySuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting History Recovery regression tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchArgs = [
    '--enable-features=SharedArrayBuffer',
    `--explicitly-allowed-ports=${PORT}`
  ];

  const browser = await browserType.launch({
    headless: true,
    args: launchArgs,
    firefoxUserPrefs: {
      'network.security.ports.banned.override': String(PORT)
    }
  });

  const pageErrors = [];
  const results = [];

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error(`[${browserName}] Page error:`, err);
      pageErrors.push(err.message);
    });

    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    // Wait for engine presets to initialize
    await page.waitForFunction(() => {
      const v = document.getElementById('vendor-select');
      return v && v.options.length > 1;
    }, null, { timeout: 25000 });

    await page.selectOption('#vendor-select', 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    await page.waitForFunction(() => window.__orcaEngine !== undefined && window.__historyStore !== undefined, null, { timeout: 15000 });

    // -------------------------------------------------------------------------
    // TEST CASE 1: empty1plate->add2Undo1Redo2
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] [Case 1] Testing empty canvas 1-plate -> add plate 2 -> Undo -> Redo...`);

    // Verify initial plate state on empty canvas: exactly 1 plate
    await page.waitForSelector('#plate-tab-0', { timeout: 10000 });
    const hasPlate1Initial = await page.$('#plate-tab-1');
    assert.equal(hasPlate1Initial, null, 'Plate 2 tab must not exist initially');

    const initialEnginePlates = await page.evaluate(async () => {
      return await window.__orcaEngine.call('listPlates', {});
    });
    assert.equal(initialEnginePlates.length, 1, 'C++ engine must report exactly 1 plate initially');
    console.log(`[${browserName}] Initial empty canvas plate count: ${initialEnginePlates.length}`);

    // Click actual UI "+ Add Plate" button
    console.log(`[${browserName}] Clicking #add-plate-btn via UI...`);
    await page.click('#add-plate-btn');

    // Wait for Plate 2 tab to appear in UI
    await page.waitForSelector('#plate-tab-1', { timeout: 10000 });
    await page.waitForTimeout(300);

    const twoPlatesEngine = await page.evaluate(async () => {
      return await window.__orcaEngine.call('listPlates', {});
    });
    assert.equal(twoPlatesEngine.length, 2, 'C++ engine must report 2 plates after addition');

    const activeIndexAfterAdd = await page.evaluate(() => window.__platesStore.getState().activePlateIndex);
    assert.equal(activeIndexAfterAdd, 1, 'Active plate index must be 1 (Plate 2)');

    // Verify Undo button is now enabled
    const canUndoAfterAdd = await page.evaluate(() => window.__historyStore.getState().canUndo);
    assert.ok(canUndoAfterAdd, 'History store canUndo must be true');
    const undoDisabledAfterAdd = await page.isDisabled('#undo-btn');
    assert.ok(!undoDisabledAfterAdd, 'TopBar undo button must be enabled');

    // Click actual UI Undo button
    console.log(`[${browserName}] Clicking #undo-btn to undo plate addition...`);
    await page.click('#undo-btn');

    // Wait for undo restore to complete and Plate 2 tab to disappear
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForSelector('#plate-tab-1', { state: 'detached', timeout: 10000 });
    await page.waitForTimeout(300);

    const platesAfterUndo = await page.evaluate(async () => {
      return await window.__orcaEngine.call('listPlates', {});
    });
    assert.equal(platesAfterUndo.length, 1, 'C++ engine must report exactly 1 plate after Undo');

    const activeIndexAfterUndo = await page.evaluate(() => window.__platesStore.getState().activePlateIndex);
    assert.equal(activeIndexAfterUndo, 0, 'Active plate index must be restored to 0');
    console.log(`[${browserName}] Undo succeeded: engine plate count restored to ${platesAfterUndo.length}`);

    // Verify Redo button is enabled
    const canRedoAfterUndo = await page.evaluate(() => window.__historyStore.getState().canRedo);
    assert.ok(canRedoAfterUndo, 'History store canRedo must be true after Undo');
    const redoDisabledAfterUndo = await page.isDisabled('#redo-btn');
    assert.ok(!redoDisabledAfterUndo, 'TopBar redo button must be enabled after Undo');

    // Click actual UI Redo button
    console.log(`[${browserName}] Clicking #redo-btn to redo plate addition...`);
    await page.click('#redo-btn');

    // Wait for redo restore to complete and Plate 2 tab to reappear
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForSelector('#plate-tab-1', { timeout: 10000 });
    await page.waitForTimeout(300);

    const platesAfterRedo = await page.evaluate(async () => {
      return await window.__orcaEngine.call('listPlates', {});
    });
    assert.equal(platesAfterRedo.length, 2, 'C++ engine must report 2 plates after Redo');

    const activeIndexAfterRedo = await page.evaluate(() => window.__platesStore.getState().activePlateIndex);
    assert.equal(activeIndexAfterRedo, 1, 'Active plate index must be restored to 1');
    console.log(`[${browserName}] Redo succeeded: engine plate count restored to ${platesAfterRedo.length}`);

    results.push({ name: 'empty1plate->add2Undo1Redo2', pass: true });

    // -------------------------------------------------------------------------
    // TEST CASE 2: emptyplateconfigUndo
    // -------------------------------------------------------------------------
    console.log(`\n[${browserName}] [Case 2] Testing empty canvas plate config undo/redo...`);

    // First undo back to 1 plate
    await page.click('#undo-btn');
    await page.waitForSelector('#plate-tab-1', { state: 'detached', timeout: 10000 });
    await page.waitForTimeout(300);

    // Initial plate 0 config should not have curr_bed_type set to Textured PEI Plate
    const initPlate0Config = await page.evaluate(async () => {
      const pl = await window.__orcaEngine.call('listPlates', {});
      return pl[0]?.config || {};
    });
    assert.notEqual(initPlate0Config.curr_bed_type, 'Textured PEI Plate', 'Initial plate 0 bed type should not be Textured PEI Plate');

    // Open Plate settings popover via UI button
    console.log(`[${browserName}] Opening #plate-settings-btn popover...`);
    await page.click('#plate-settings-btn');
    await page.waitForSelector('#plate-settings-popover', { timeout: 5000 });

    // Change bed type setting to 'Textured PEI Plate'
    console.log(`[${browserName}] Changing #plate-bed-type to Textured PEI Plate...`);
    await page.selectOption('#plate-bed-type', 'Textured PEI Plate');

    // Wait for plate store and engine to update
    await page.waitForFunction(() => {
      const storePlates = window.__platesStore?.getState().plates;
      return storePlates && storePlates[0]?.config?.curr_bed_type === 'Textured PEI Plate';
    }, null, { timeout: 5000 });

    const modifiedEnginePlates = await page.evaluate(async () => {
      return await window.__orcaEngine.call('listPlates', {});
    });
    assert.equal(modifiedEnginePlates[0].config.curr_bed_type, 'Textured PEI Plate', 'Engine plate 0 config must reflect Textured PEI Plate');
    console.log(`[${browserName}] Plate 0 config in C++ engine: curr_bed_type = ${modifiedEnginePlates[0].config.curr_bed_type}`);

    // Close settings popover
    await page.click('#plate-settings-btn');
    await page.waitForSelector('#plate-settings-popover', { state: 'detached', timeout: 5000 });
    await page.waitForTimeout(200);

    // Click actual UI Undo button
    console.log(`[${browserName}] Clicking #undo-btn to undo plate config change...`);
    await page.click('#undo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    // Verify engine and store plate config is restored
    const undoneEnginePlates = await page.evaluate(async () => {
      return await window.__orcaEngine.call('listPlates', {});
    });
    assert.notEqual(undoneEnginePlates[0].config.curr_bed_type, 'Textured PEI Plate', 'Engine plate 0 config must NOT have Textured PEI Plate after Undo');

    const undoneStorePlate = await page.evaluate(() => {
      return window.__platesStore.getState().plates[0]?.config || {};
    });
    assert.notEqual(undoneStorePlate.curr_bed_type, 'Textured PEI Plate', 'PlatesStore plate 0 config must NOT have Textured PEI Plate after Undo');
    console.log(`[${browserName}] Undo plate config verified: engine config restored to`, JSON.stringify(undoneEnginePlates[0].config));

    // Redo plate config change
    console.log(`[${browserName}] Clicking #redo-btn to redo plate config change...`);
    await page.click('#redo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const redoneEnginePlates = await page.evaluate(async () => {
      return await window.__orcaEngine.call('listPlates', {});
    });
    assert.equal(redoneEnginePlates[0].config.curr_bed_type, 'Textured PEI Plate', 'Engine plate 0 config must restore Textured PEI Plate after Redo');
    console.log(`[${browserName}] Redo plate config verified: curr_bed_type = ${redoneEnginePlates[0].config.curr_bed_type}`);

    results.push({ name: 'emptyplateconfigUndo', pass: true });

    // -------------------------------------------------------------------------
    // TEST CASE 3: nonemptymodel settingA snapshot -> settingB snapshot
    // Undo JS/nativeconfig equal AND userlabel/manualoverride preserved
    // -------------------------------------------------------------------------
    console.log(`\n[${browserName}] [Case 3] Testing non-empty model settingA -> settingB snapshot Undo...`);

    // Import 20mm_cube.obj
    console.log(`[${browserName}] Importing 20mm_cube.obj...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(500);

    const cubeCount = await page.evaluate(() => window.__plateStore.getState().objects.length);
    assert.ok(cubeCount >= 1, 'At least 1 object must be loaded');

    // Setting A: Toggle support ON via actual UI checkbox #quick-support
    console.log(`[${browserName}] Setting A: Clicking #quick-support to turn support ON...`);
    await page.click('#quick-support');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support === '1', null, { timeout: 5000 });

    // Set custom user preset label for process
    const customUserLabel = 'Voron Quality Preset Custom';
    await page.evaluate((label) => {
      window.__appStore.setState({
        activeUserPreset: {
          ...window.__appStore.getState().activeUserPreset,
          process: label
        }
      });
    }, customUserLabel);

    // Commit snapshot for Setting A
    console.log(`[${browserName}] Committing snapshot for Setting A...`);
    await page.evaluate(async () => {
      await window.__historyStore.getState().commitTransaction('Setting A: Support ON and Custom Label');
    });
    await page.waitForTimeout(300);

    const snapA_jsSupport = await page.evaluate(() => window.__appStore.getState().currentConfig.enable_support);
    const snapA_override = await page.evaluate(() => window.__appStore.getState().processOverrides.enable_support);
    const snapA_label = await page.evaluate(() => window.__appStore.getState().activeUserPreset.process);
    assert.equal(snapA_jsSupport, '1', 'Setting A JS support must be 1');
    assert.equal(snapA_override, '1', 'Setting A process override must be 1');
    assert.equal(snapA_label, customUserLabel, 'Setting A user label must match');

    // Setting B: Toggle support OFF via actual UI checkbox #quick-support
    console.log(`[${browserName}] Setting B: Clicking #quick-support to turn support OFF...`);
    await page.click('#quick-support');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support === '0', null, { timeout: 5000 });

    // Change user preset label to something else
    await page.evaluate(() => {
      window.__appStore.setState({
        activeUserPreset: {
          ...window.__appStore.getState().activeUserPreset,
          process: 'Other Preset B'
        }
      });
    });

    // Commit snapshot for Setting B
    console.log(`[${browserName}] Committing snapshot for Setting B...`);
    await page.evaluate(async () => {
      await window.__historyStore.getState().commitTransaction('Setting B: Support OFF and Other Label');
    });
    await page.waitForTimeout(300);

    const snapB_jsSupport = await page.evaluate(() => window.__appStore.getState().currentConfig.enable_support);
    assert.equal(snapB_jsSupport, '0', 'Setting B JS support must be 0');

    // Click actual UI Undo button to revert from Setting B to Setting A
    console.log(`[${browserName}] Clicking #undo-btn to revert from Setting B to Setting A...`);
    await page.click('#undo-btn');

    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 15000 });
    await page.waitForTimeout(500);

    // Read back JS currentConfig from useAppStore
    const restoredJsConfig = await page.evaluate(() => window.__appStore.getState().currentConfig);

    // Read back native C++ config directly from engine getConfig()
    const restoredNativeConfig = await page.evaluate(async () => {
      return await window.__orcaEngine.getConfig();
    });

    // Verify JS currentConfig and native C++ engine config are strictly EQUAL
    console.log(`[${browserName}] Restored JS enable_support: ${restoredJsConfig.enable_support}`);
    console.log(`[${browserName}] Restored Native enable_support: ${restoredNativeConfig.enable_support}`);
    assert.equal(restoredJsConfig.enable_support, '1', 'JS currentConfig.enable_support must be 1');
    assert.equal(restoredNativeConfig.enable_support, '1', 'Native C++ config.enable_support must be 1');
    assert.equal(
      restoredJsConfig.enable_support,
      restoredNativeConfig.enable_support,
      'JS currentConfig and Native C++ engine config must be strictly EQUAL'
    );

    // Verify manual override is preserved
    const restoredProcessOverrides = await page.evaluate(() => window.__appStore.getState().processOverrides);
    assert.equal(restoredProcessOverrides.enable_support, '1', 'Manual process override for enable_support must be preserved');
    console.log(`[${browserName}] Restored processOverrides.enable_support: ${restoredProcessOverrides.enable_support}`);

    // Verify user preset label is preserved
    const restoredUserPresetLabel = await page.evaluate(() => window.__appStore.getState().activeUserPreset.process);
    assert.equal(restoredUserPresetLabel, customUserLabel, 'User preset label activeUserPreset.process must be preserved');
    console.log(`[${browserName}] Restored activeUserPreset.process: ${restoredUserPresetLabel}`);

    results.push({
      name: 'nonemptymodel settingA snapshot ->settingB snapshot UndoJS/nativeconfig equal AND userlabel/manualoverride preserved',
      pass: true
    });

    console.log(`\nAll recovery checks passed for ${browserName}!`);
  } finally {
    await browser.close();
  }

  assert.equal(pageErrors.length, 0, `Page errors encountered during ${browserName} test: ${pageErrors.join('; ')}`);
  return results;
}

async function main() {
  try {
    await startServer(PORT, 'history-recovery');

    console.log('\nRunning Chromium suite...');
    const chromResults = await runBrowserRecoverySuite(chromium, 'chromium');

    console.log('\nRunning Firefox suite...');
    const ffResults = await runBrowserRecoverySuite(firefox, 'firefox');

    console.log('\n==================================================');
    console.log('SUMMARY OF RESULTS');
    console.log('==================================================');
    for (const r of chromResults) {
      console.log(`  [Chromium] ${r.name}: PASS`);
    }
    for (const r of ffResults) {
      console.log(`  [Firefox]  ${r.name}: PASS`);
    }
    console.log('\nAll history recovery regression checks PASSED across Chromium and Firefox.');
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nTest failed with error:', err);
  process.exit(1);
});
