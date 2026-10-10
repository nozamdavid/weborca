#!/usr/bin/env node
/**
 * @file multifilament.mjs
 * End-to-end browser test for multi-filament support (Chromium then Firefox):
 * - Add a second filament slot
 * - Assert engine config has 2 filaments
 * - Assign an object to extruder 2
 * - Slice and assert G-code contains tool change (T1) and slice stats show two filaments
 * - Remove the slot again
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = 5123;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const CUBE = fs.readFileSync(CUBE_MODEL_PATH);

async function runSuite(browserType, name) {
  console.log(`\n==================================================`);
  console.log(`Starting Multi-filament tests for ${name.toUpperCase()}`);
  console.log(`==================================================`);

  const launchArgs = ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`];
  const browser = await browserType.launch({
    headless: true,
    args: launchArgs,
    firefoxUserPrefs: {
      'network.security.ports.banned.override': String(PORT)
    }
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  try {
    log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    log('Waiting for engine to be ready...');
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    log('Selecting printer Voron 2.4 and process...');
    await page.selectOption('#vendor-select', 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 20000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');

    log('Importing cube model...');
    await page.evaluate(async (bytes) => {
      await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj'));
    }, Array.from(CUBE));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__objectListStore?.getState()?.objects.length >= 1, null, { timeout: 30000 });

    // Initial state: 1 filament slot
    log('Verifying initial single filament slot...');
    await page.waitForSelector('#filament-select', { timeout: 10000 });
    const initSlots = await page.evaluate(() => window.__appStore.getState().selectedFilaments);
    assert.equal(initSlots.length, 1, 'initially exactly 1 filament slot');
    assert.equal(await page.locator('#filament-select-2').count(), 0, 'slot 2 does not exist yet');

    // 1. Add a second slot
    log('Adding a second filament slot (+ button)...');
    await page.click('#add-filament-btn');
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 2, null, { timeout: 15000 });
    await page.waitForSelector('#filament-select-2', { timeout: 10000 });
    log('Slot 2 created successfully (#filament-select-2 visible)');

    // 2. Assert the engine config has 2 filaments
    log('Asserting engine config has 2 filaments...');
    await page.waitForFunction(() => {
      const cfg = window.__appStore.getState().currentConfig;
      return (cfg['filament_colour'] || '').includes(';');
    }, null, { timeout: 15000 });
    const config = await page.evaluate(() => window.__appStore.getState().currentConfig);
    const filamentColours = config['filament_colour'] || '';
    assert.ok(filamentColours.includes(';'), `filament_colour should contain ';' for multiple slots: ${filamentColours}`);
    const selectedFilaments = await page.evaluate(() => window.__appStore.getState().selectedFilaments);
    assert.equal(selectedFilaments.length, 2, 'appStore selectedFilaments has 2 entries');

    // 3. Assign an object to extruder 2
    log('Assigning object to extruder 2...');
    const objId = await page.evaluate(() => window.__objectListStore.getState().objects[0].id);

    // Click more button and select extruder 2 from submenu
    await page.click(`#object-more-btn-${objId}`);
    await page.waitForSelector('#menu-item-extruder', { timeout: 10000 });
    await page.locator('#menu-item-extruder').scrollIntoViewIfNeeded();
    await page.hover('#menu-item-extruder');
    await page.waitForSelector('#menu-action-extruder-2', { timeout: 10000 });
    await page.click('#menu-action-extruder-2');

    // Verify badge updated to E2
    await page.waitForFunction(
      (id) => document.getElementById(`badge-extruder-object-${id}`)?.innerText.includes('E2'),
      objId,
      { timeout: 15000 }
    );
    const badgeText = await page.locator(`#badge-extruder-object-${objId}`).innerText();
    assert.ok(badgeText.includes('E2'), `extruder badge should show E2, got: ${badgeText}`);
    log('Object assigned to Extruder 2 and badge verified');

    // 4. Slice
    log('Triggering slice...');
    await page.waitForFunction(() => !document.getElementById('slice-btn')?.disabled, null, { timeout: 10000 });
    await page.click('#slice-btn');

    log('Waiting for slicing to complete...');
    await page.waitForFunction(() => {
      const s = window.__appStore.getState();
      return !s.isSlicing && s.sliceResult;
    }, null, { timeout: 180000 });

    const sliceResult = await page.evaluate(() => window.__appStore.getState().sliceResult);
    assert.ok(sliceResult, 'sliceResult must exist');
    log('Slicing completed successfully');

    // 5. Assert G-code contains tool change (T1)
    const gcodeText = await page.evaluate(() => new TextDecoder().decode(window.__appStore.getState().sliceResult.gcode));
    assert.ok(gcodeText.includes('T1'), 'G-code must contain tool change command T1');
    log('Verified G-code contains T1');

    // 6. Assert slice stats show two filaments
    log('Verifying slice stats panel displays two filaments...');
    await page.waitForSelector('#stat-filaments-section', { timeout: 10000 });
    await page.waitForSelector('#stat-filament-slot-1', { timeout: 5000 });
    await page.waitForSelector('#stat-filament-slot-2', { timeout: 5000 });
    const slot2Text = await page.locator('#stat-filament-slot-2').innerText();
    assert.ok(slot2Text.includes('#2'), `slot 2 stats should contain #2, got: ${slot2Text}`);
    log('Verified slice stats show two filaments');

    // 7. Remove the slot again
    log('Switching back to Prepare tab to remove slot...');
    await page.click('#tab-prepare');
    await page.waitForSelector('#remove-filament-btn', { timeout: 10000 });
    log('Removing second filament slot (− button)...');
    await page.click('#remove-filament-btn');
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 1, null, { timeout: 15000 });
    assert.equal(await page.locator('#filament-select-2').count(), 0, 'second slot removed');
    log('Slot 2 removed successfully');

    log(`All multi-filament checks passed for ${name}!`);
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'multifilament');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('\n==================================================');
  console.log('All multi-filament tests passed on Chromium and Firefox!');
  console.log('==================================================');
} catch (err) {
  console.error('Multi-filament tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
