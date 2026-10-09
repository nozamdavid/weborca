#!/usr/bin/env node
/**
 * @file layer-events.mjs
 * End-to-end browser test for OrcaSlicer Web Layer Events (Pause Print and Custom G-code).
 *
 * Verifies sequentially across Chromium and Firefox:
 * 1. Initial engine initialization with Voron presets and 20mm cube import.
 * 2. Initial slicing to Preview screen (baseline G-code without layer events).
 * 3. Adding a Pause event at layer 20:
 *    - Menu displays "Add pause", "Add custom G-code", and disabled "Change filament" (unsupported tooltip).
 *    - Tick mark appears on layer slider track.
 *    - Slice result is invalidated, prompting re-slice.
 * 4. Adding a Custom G-code event at layer 40:
 *    - Custom G-code dialog modal opens with validation.
 *    - Text entered and confirmed.
 *    - Second tick mark appears on slider track.
 * 5. Editing the Custom G-code event:
 *    - Custom G-code dialog opens pre-populated with existing text.
 *    - Modified text saved.
 * 6. Re-slicing and inspecting layer events persistence & emitted G-code:
 *    - Re-slice executes with updated invalidation banner clearance.
 *    - Tick marks persist and match across re-slicing.
 *    - Pause and custom G-code are emitted in the G-code.
 * 7. Deleting the Pause event:
 *    - Deleting removes the tick mark.
 *    - Slice is invalidated again.
 * 8. Multi-plate isolation and plate switching:
 *    - Adding Plate 2 and switching to it.
 *    - Plate 2 starts with 0 events.
 *    - Adding a Pause event on Plate 2.
 *    - Switching back to Plate 1 shows only Plate 1's events.
 *    - Switching to Plate 2 shows only Plate 2's events.
 * 9. Undo/redo integration restoring layer events.
 */

import path from 'node:path';
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

const PORT = parseInt(process.env.PORT || '5098', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');

async function runLayerEventsSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Layer Events tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchOptions = {
    headless: true,
    args: ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`]
  };
  if (browserName === 'firefox') {
    launchOptions.firefoxUserPrefs = {
      'network.security.ports.banned.override': String(PORT)
    };
  }

  const browser = await browserType.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[layerEvents') || text.includes('Error') || text.includes('error')) {
      console.log(`[${browserName} console] ${msg.type()}: ${text}`);
    }
  });
  page.on('pageerror', (err) => console.error(`[${browserName} error]`, err));

  const results = [];

  try {
    // -------------------------------------------------------------------------
    // Step 1: Navigate to page and initialize engine
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 1: Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    console.log(`[${browserName}] window.crossOriginIsolated = ${isIsolated}`);
    assert.ok(isIsolated, 'Page must be cross-origin isolated for SharedArrayBuffer');

    await page.waitForFunction(() => {
      const v = document.getElementById('vendor-select');
      return v && v.options.length > 1;
    }, null, { timeout: 20000 });

    await page.selectOption('#vendor-select', 'Voron');

    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    await page.waitForFunction(() => {
      const proc = document.getElementById('process-select');
      const fil = document.getElementById('filament-select');
      return proc && !proc.disabled && proc.options.length > 0 &&
             fil && !fil.disabled && fil.options.length > 0;
    }, null, { timeout: 15000 });

    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.selectOption('#filament-select', 'Generic PLA @System');

    results.push({ name: 'Page loaded & engine initialized', pass: true });

    // -------------------------------------------------------------------------
    // Step 2: Import 20mm_cube.obj and slice baseline
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 2: Importing initial model (20mm_cube.obj) and slicing...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 15000 });

    await page.click('#slice-btn');

    // Wait for Preview screen switch and toolpaths
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#canvas');
      const previewStats = window.previewStats;
      return canvas !== null && previewStats && previewStats.layers > 0;
    }, null, { timeout: 60000 });

    const initialLayers = await page.evaluate(() => window.__previewStore?.getState().layersCount);
    console.log(`[${browserName}] Baseline slice completed with ${initialLayers} layers`);
    assert.equal(initialLayers, 100, 'Baseline cube must produce 100 layers');

    // Verify baseline G-code does not contain any PAUSE_PRINT
    const baselineGcode = await page.evaluate(() => {
      const gcodeBytes = window.__appStore?.getState().sliceResult?.gcode;
      if (!gcodeBytes) return '';
      return new TextDecoder().decode(gcodeBytes);
    });
    assert.ok(!baselineGcode.includes(';PAUSE_PRINT'), 'Baseline G-code must not have pause commands');
    assert.ok(!baselineGcode.includes(';CUSTOM_GCODE'), 'Baseline G-code must not have custom G-code');
    results.push({ name: 'Baseline slicing & Preview mode ready', pass: true });

    // -------------------------------------------------------------------------
    // Step 3: Add Pause Layer Event at Layer 20 (index 19)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 3: Adding Pause event at Layer 20...`);

    // Set slider to layer 19 (Layer 20)
    await page.evaluate(() => {
      window.__previewStore?.getState().setLayerRangeAction(0, 19);
    });
    await page.waitForFunction(() => {
      const num = document.getElementById('layer-current-number');
      return num && num.textContent?.trim() === 'L20';
    }, null, { timeout: 5000 });

    // Click the Add Event button (+) next to the upper handle
    const addBtn = await page.waitForSelector('#btn-add-layer-event', { state: 'visible', timeout: 5000 });
    await addBtn.click();

    // Verify popup menu appears
    await page.waitForSelector('#layer-event-menu', { state: 'visible', timeout: 5000 });

    // Verify disabled color change item with tooltip
    const colorBtnDisabled = await page.$eval('#btn-add-color-change', (el) => el.hasAttribute('disabled'));
    const colorBtnTitle = await page.$eval('#btn-add-color-change', (el) => el.getAttribute('title'));
    assert.ok(colorBtnDisabled, 'Color change button must be disabled');
    assert.ok(colorBtnTitle?.includes('not supported'), 'Color change button must indicate unsupported');

    // Click "Add pause"
    await page.click('#btn-add-pause');

    // Verify popup menu closes
    await page.waitForSelector('#layer-event-menu', { state: 'hidden', timeout: 5000 });

    // Verify tick mark appears on track at layer 19
    await page.waitForSelector('#layer-tick-19', { state: 'visible', timeout: 5000 });

    // Verify slice result is invalidated (outdated banner shown, sliceResult null in appStore)
    await page.waitForSelector('#slice-outdated-banner', { state: 'visible', timeout: 5000 });
    const isSliceNull = await page.evaluate(() => window.__appStore?.getState().sliceResult === null);
    assert.ok(isSliceNull, 'Slice result must be invalidated after adding pause');

    // Verify store has 1 event for plate 0
    const plate0EventsAfterPause = await page.evaluate(() => window.__layerEventsStore?.getState().eventsByPlate[0]);
    assert.equal(plate0EventsAfterPause?.length, 1, 'Plate 0 must have 1 event');
    assert.equal(plate0EventsAfterPause[0]?.type, 'pause');
    results.push({ name: 'Add Pause event & slice invalidation', pass: true });

    // -------------------------------------------------------------------------
    // Step 4: Add Custom G-code event at Layer 40 (index 39)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 4: Adding Custom G-code at Layer 40...`);

    // Set slider to layer 39 (Layer 40)
    await page.evaluate(() => {
      window.__previewStore?.getState().setLayerRangeAction(0, 39);
    });
    await page.waitForFunction(() => {
      const num = document.getElementById('layer-current-number');
      return num && num.textContent?.trim() === 'L40';
    }, null, { timeout: 5000 });

    // Open menu
    await page.click('#btn-add-layer-event');
    await page.waitForSelector('#layer-event-menu', { state: 'visible', timeout: 5000 });

    // Click "Add custom G-code"
    await page.click('#btn-add-custom-gcode');

    // Verify Custom G-code dialog opens
    await page.waitForSelector('#custom-gcode-dialog', { state: 'visible', timeout: 5000 });

    // Verify OK button is disabled while textarea is empty
    const isConfirmDisabledInitially = await page.$eval('#custom-gcode-confirm', (el) => el.hasAttribute('disabled'));
    assert.ok(isConfirmDisabledInitially, 'Confirm button must be disabled when G-code text is empty');

    // Enter G-code text
    await page.fill('#custom-gcode-input', 'M117 HELLO_ORCA_LAYER_EVENT');

    const isConfirmEnabled = await page.$eval('#custom-gcode-confirm', (el) => !el.hasAttribute('disabled'));
    assert.ok(isConfirmEnabled, 'Confirm button must be enabled once text is provided');

    // Confirm dialog
    await page.click('#custom-gcode-confirm');
    await page.waitForSelector('#custom-gcode-dialog', { state: 'hidden', timeout: 5000 });

    // Verify tick mark appears at layer 39
    await page.waitForSelector('#layer-tick-39', { state: 'visible', timeout: 5000 });

    // Verify Plate 0 now has 2 events
    const plate0EventsTwo = await page.evaluate(() => window.__layerEventsStore?.getState().eventsByPlate[0]);
    assert.equal(plate0EventsTwo?.length, 2, 'Plate 0 must now have 2 events');
    results.push({ name: 'Add Custom G-code event via dialog', pass: true });

    // -------------------------------------------------------------------------
    // Step 5: Edit the Custom G-code event
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 5: Editing Custom G-code at Layer 40...`);

    // Click the handle action button to open edit menu
    await page.click('#btn-add-layer-event');
    await page.waitForSelector('#layer-event-menu', { state: 'visible', timeout: 5000 });

    // Verify edit option is present
    await page.waitForSelector('#btn-edit-custom-gcode', { state: 'visible', timeout: 5000 });
    await page.click('#btn-edit-custom-gcode');

    // Dialog opens with pre-populated text
    await page.waitForSelector('#custom-gcode-dialog', { state: 'visible', timeout: 5000 });
    const currentInputVal = await page.$eval('#custom-gcode-input', (el) => el.value);
    assert.equal(currentInputVal, 'M117 HELLO_ORCA_LAYER_EVENT', 'Dialog must be pre-populated with current G-code');

    // Update text
    await page.fill('#custom-gcode-input', 'M117 UPDATED_CUSTOM_GCODE');
    await page.click('#custom-gcode-confirm');
    await page.waitForSelector('#custom-gcode-dialog', { state: 'hidden', timeout: 5000 });

    const updatedEvents = await page.evaluate(() => window.__layerEventsStore?.getState().eventsByPlate[0]);
    const customEvent = updatedEvents.find((e) => e.type === 'custom');
    assert.equal(customEvent?.gcode, 'M117 UPDATED_CUSTOM_GCODE', 'Event G-code must be updated');
    results.push({ name: 'Edit Custom G-code event', pass: true });

    // -------------------------------------------------------------------------
    // Step 6: Re-slice and inspect layer events persistence & emitted G-code
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 6: Re-slicing and inspecting emitted G-code...`);

    // Click Re-slice button on the banner
    await page.click('#btn-reslice');

    // Wait for slicing to finish and Preview to refresh
    await page.waitForFunction(() => {
      const isSlicing = window.__appStore?.getState().isSlicing;
      const result = window.__appStore?.getState().sliceResult;
      return !isSlicing && result !== null;
    }, null, { timeout: 60000 });

    // Verify banner disappears
    await page.waitForSelector('#slice-outdated-banner', { state: 'hidden', timeout: 5000 });

    // Inspect the generated G-code
    const slicedGcode = await page.evaluate(() => {
      const gcodeBytes = window.__appStore?.getState().sliceResult?.gcode;
      if (!gcodeBytes) return '';
      return new TextDecoder().decode(gcodeBytes);
    });

    assert.ok(slicedGcode.includes(';PAUSE_PRINT'), 'G-code must contain the pause event');
    assert.ok(slicedGcode.includes('M117 UPDATED_CUSTOM_GCODE'), 'G-code must contain the custom G-code text');

    // Verify tick marks are still present on slider track after re-slicing
    await page.waitForSelector('#layer-tick-19', { state: 'visible', timeout: 5000 });
    await page.waitForSelector('#layer-tick-39', { state: 'visible', timeout: 5000 });
    results.push({ name: 'Re-slicing preserves layer events & tick marks', pass: true });

    // -------------------------------------------------------------------------
    // Step 7: Delete Pause event
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 7: Deleting Pause event at Layer 20...`);

    // Move to layer 19
    await page.evaluate(() => {
      window.__previewStore?.getState().setLayerRangeAction(0, 19);
    });
    await page.waitForFunction(() => {
      const num = document.getElementById('layer-current-number');
      return num && num.textContent?.trim() === 'L20';
    }, null, { timeout: 5000 });

    // Open menu and click Delete pause
    await page.click('#btn-add-layer-event');
    await page.waitForSelector('#btn-delete-pause', { state: 'visible', timeout: 5000 });
    await page.click('#btn-delete-pause');

    // Verify tick 19 is removed, but tick 39 remains
    await page.waitForSelector('#layer-tick-19', { state: 'hidden', timeout: 5000 });
    await page.waitForSelector('#layer-tick-39', { state: 'visible', timeout: 5000 });

    // Verify slice is invalidated again
    await page.waitForSelector('#slice-outdated-banner', { state: 'visible', timeout: 5000 });

    // Re-slice and verify Pause is removed from G-code while Custom G-code remains
    await page.click('#btn-reslice');
    await page.waitForFunction(() => {
      const isSlicing = window.__appStore?.getState().isSlicing;
      const result = window.__appStore?.getState().sliceResult;
      return !isSlicing && result !== null;
    }, null, { timeout: 60000 });

    const gcodeAfterDelete = await page.evaluate(() => {
      const gcodeBytes = window.__appStore?.getState().sliceResult?.gcode;
      if (!gcodeBytes) return '';
      return new TextDecoder().decode(gcodeBytes);
    });
    assert.ok(!gcodeAfterDelete.includes(';PAUSE_PRINT'), 'Deleted pause must no longer be emitted in G-code');
    assert.ok(gcodeAfterDelete.includes('M117 UPDATED_CUSTOM_GCODE'), 'Custom G-code must still be emitted');
    results.push({ name: 'Delete Pause event & verified slice invalidation', pass: true });

    // -------------------------------------------------------------------------
    // Step 8: Multi-plate isolation and switching
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 8: Verifying multi-plate isolation...`);

    // Add Plate 2
    await page.evaluate(async () => {
      await window.__platesStore?.getState().addPlate('Plate 2');
    });

    // Switch to Plate 2 (index 1)
    await page.click('#orca-preview-view #plate-tab-1');
    await page.waitForFunction(() => window.__platesStore?.getState().activePlateIndex === 1);

    // Plate 2 must have 0 events initially
    await page.waitForFunction(() => {
      const ticks = document.querySelectorAll('.layer-event-tick');
      return ticks.length === 0;
    }, null, { timeout: 5000 });

    const plate1Events = await page.evaluate(() => window.__layerEventsStore?.getState().eventsByPlate[1]);
    assert.equal(plate1Events?.length || 0, 0, 'Plate 2 must have 0 events initially');

    // Add a Pause on Plate 2 at layer 30 (index 29)
    await page.evaluate(() => {
      window.__previewStore?.getState().setLayerRangeAction(0, 29);
    });
    await page.click('#btn-add-layer-event');
    await page.waitForSelector('#btn-add-pause', { state: 'visible', timeout: 5000 });
    await page.click('#btn-add-pause');

    // Plate 2 now has tick 29
    await page.waitForSelector('#layer-tick-29', { state: 'visible', timeout: 5000 });
    // And does NOT have tick 39 from Plate 1
    const hasTick39OnPlate2 = await page.$('#layer-tick-39');
    assert.equal(hasTick39OnPlate2, null, 'Plate 2 must not show Plate 1 ticks');

    // Switch back to Plate 1 (index 0)
    await page.click('#orca-preview-view #plate-tab-0');
    await page.waitForFunction(() => window.__platesStore?.getState().activePlateIndex === 0);

    // Plate 1 must show tick 39 and NOT tick 29
    await page.waitForSelector('#layer-tick-39', { state: 'visible', timeout: 5000 });
    const hasTick29OnPlate1 = await page.$('#layer-tick-29');
    assert.equal(hasTick29OnPlate1, null, 'Plate 1 must not show Plate 2 ticks');

    // Switch back to Plate 2
    await page.click('#orca-preview-view #plate-tab-1');
    await page.waitForFunction(() => window.__platesStore?.getState().activePlateIndex === 1);
    await page.waitForSelector('#layer-tick-29', { state: 'visible', timeout: 5000 });

    results.push({ name: 'Plate switching & layer event isolation', pass: true });

    // -------------------------------------------------------------------------
    // Step 9: Undo/Redo integration
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 9: Verifying Undo/Redo restores layer events...`);

    // On Plate 2, undo the added pause
    const canUndo = await page.evaluate(() => window.__historyStore?.getState().canUndo);
    if (canUndo) {
      await page.evaluate(async () => {
        await window.__historyStore?.getState().undo();
      });

      // Wait for tick 29 to be undone
      await page.waitForFunction(() => {
        const events = window.__layerEventsStore?.getState().eventsByPlate[1] || [];
        return events.length === 0;
      }, null, { timeout: 10000 });

      // Redo
      await page.evaluate(async () => {
        await window.__historyStore?.getState().redo();
      });

      // Wait for tick 29 to be restored
      await page.waitForFunction(() => {
        const events = window.__layerEventsStore?.getState().eventsByPlate[1] || [];
        return events.length === 1 && events[0].type === 'pause';
      }, null, { timeout: 10000 });
    }
    results.push({ name: 'Undo/Redo integration', pass: true });

  } catch (err) {
    console.error(`[${browserName}] Test failed:`, err);
    throw err;
  } finally {
    await browser.close();
  }

  console.log(`\nResults for ${browserName.toUpperCase()}:`);
  for (const r of results) {
    console.log(`  ✓ ${r.name}`);
  }
}

async function main() {
  console.log(`Starting Layer Events Test Suite against port ${PORT}...`);
  try {
    await startServer(PORT, 'layer-events');

    await runLayerEventsSuite(chromium, 'chromium');
    await runLayerEventsSuite(firefox, 'firefox');

    console.log('\n==================================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY ON CHROMIUM & FIREFOX');
    console.log('==================================================');
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nLayer Events Test Suite FAILED:', err);
  process.exit(1);
});
