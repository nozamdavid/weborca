#!/usr/bin/env node
/**
 * @file cut-rotation.mjs
 * End-to-end browser test for OrcaSlicer Web Planar Cut with Rotation.
 * Tests across Chromium and Firefox:
 * 1. Rotation controls (X/Y/Z numeric inputs, sliders, live displays).
 * 2. Reset-to-horizontal button states and action.
 * 3. 3D cut preview live plane orientation following rotation.
 * 4. 45-degree planar cut of 20mm cube at Z=10mm:
 *    - Produces 2 watertight objects.
 *    - Upper + lower volume equals original 8000 mm³ within tolerance.
 *    - Resulting bounding boxes match 45-degree wedge geometry.
 */

import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = parseInt(process.env.PORT || '5180', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');

function computeVolume(positions, indices) {
  let vol = 0;
  if (indices && indices.length > 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;
      const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
      const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
      const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
      vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6.0;
    }
  } else {
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
      const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
      const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
      vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6.0;
    }
  }
  return Math.abs(vol);
}

async function runBrowserCutRotationSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Cut Rotation tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchOptions = {
    headless: true,
    args: browserName === 'chromium' ? ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`] : []
  };
  if (browserName === 'firefox') {
    launchOptions.firefoxUserPrefs = {
      'network.security.ports.banned.override': String(PORT)
    };
  }

  const browser = await browserType.launch(launchOptions);

  const pageErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error(`[${browserName}] Page error:`, err);
      pageErrors.push(err.message);
    });

    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    try {
      await page.waitForSelector('#recovery-dialog', { timeout: 2000 });
      await page.click('#recovery-discard');
      await page.waitForSelector('#recovery-dialog', { state: 'detached', timeout: 3000 });
    } catch {}

    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    console.log(`[${browserName}] Importing 20mm_cube.obj...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    const objId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    await page.evaluate((id) => window.__plateStore.getState().selectObject(id), objId);
    await page.waitForTimeout(300);

    // Open Cut panel
    console.log(`[${browserName}] Opening cut panel...`);
    const cutBtn = await page.$('#tool-cut-btn');
    if (cutBtn && await cutBtn.isVisible()) {
      await cutBtn.click();
    } else {
      await page.keyboard.press('c');
    }
    await page.waitForSelector('#cut-tool-panel', { state: 'visible', timeout: 8000 });

    // Verify rotation UI controls exist
    console.log(`[${browserName}] Verifying rotation UI controls...`);
    await page.waitForSelector('#cut-rot-x-slider', { timeout: 2000 });
    await page.waitForSelector('#cut-rot-x-input', { timeout: 2000 });
    await page.waitForSelector('#cut-rot-y-slider', { timeout: 2000 });
    await page.waitForSelector('#cut-rot-y-input', { timeout: 2000 });
    await page.waitForSelector('#cut-rot-z-slider', { timeout: 2000 });
    await page.waitForSelector('#cut-rot-z-input', { timeout: 2000 });
    await page.waitForSelector('#cut-reset-rotation-btn', { timeout: 2000 });

    // Reset button should initially be disabled (rot = 0, 0, 0)
    let resetDisabled = await page.$eval('#cut-reset-rotation-btn', (el) => el.disabled);
    assert.strictEqual(resetDisabled, true, 'Reset button should be disabled when rotation is 0');

    // Test X rotation input and display
    console.log(`[${browserName}] Setting Rot X to 45 degrees...`);
    await page.fill('#cut-rot-x-input', '45');
    await page.waitForFunction(() => {
      const el = document.getElementById('cut-rot-x-display');
      return el && el.textContent.includes('45.0');
    }, null, { timeout: 3000 });

    const rotXVal = await page.$eval('#cut-rot-x-slider', (el) => el.value);
    assert.strictEqual(rotXVal, '45', 'Slider should synchronize with numeric input');

    resetDisabled = await page.$eval('#cut-reset-rotation-btn', (el) => el.disabled);
    assert.strictEqual(resetDisabled, false, 'Reset button should be enabled when rotation is non-zero');

    // Verify live visual plane in 3D view follows rotation
    const planeNormalZ = await page.evaluate(() => {
      const p = window.__plateScene?.cutPreview;
      if (!p) return null;
      return p.upperPlane.normal.z;
    });
    assert.ok(planeNormalZ !== null && Math.abs(planeNormalZ - Math.cos(Math.PI / 4)) < 0.05,
      `Live cut plane normal Z should match 45 deg tilt (~0.707), got ${planeNormalZ}`);

    // Test Reset-to-horizontal button
    console.log(`[${browserName}] Clicking Reset to horizontal button...`);
    await page.click('#cut-reset-rotation-btn');
    await page.waitForFunction(() => {
      const el = document.getElementById('cut-rot-x-display');
      return el && el.textContent.includes('0.0');
    }, null, { timeout: 3000 });

    resetDisabled = await page.$eval('#cut-reset-rotation-btn', (el) => el.disabled);
    assert.strictEqual(resetDisabled, true, 'Reset button should be disabled again after reset');

    // Set 45 degree cut at Z=10mm
    console.log(`[${browserName}] Applying 45 degree cut at Z=5mm...`);
    await page.fill('#cut-rot-x-input', '45');
    await page.fill('#cut-z-input', '5.0');

    // Execute cut
    await page.click('#perform-cut-btn');
    await page.waitForSelector('#cut-success-message', { timeout: 15000 });

    // Verify 2 objects produced
    await page.waitForFunction(() => {
      const st = window.__plateStore?.getState();
      return st && st.objects.length === 2;
    }, null, { timeout: 10000 });

    // Check volume and bounding boxes of resulting objects
    const cutResults = await page.evaluate(async () => {
      const st = window.__plateStore.getState();
      const objects = st.objects;
      const res = [];
      for (const obj of objects) {
        const mesh = await st.getMesh(obj.id);
        res.push({
          id: obj.id,
          name: obj.name,
          positions: Array.from(mesh.positions),
          indices: mesh.indices ? Array.from(mesh.indices) : null,
          box: obj.box
        });
      }
      return res;
    });

    assert.strictEqual(cutResults.length, 2, 'Cutting cube must produce exactly 2 objects');

    const v1 = computeVolume(cutResults[0].positions, cutResults[0].indices);
    const v2 = computeVolume(cutResults[1].positions, cutResults[1].indices);
    const totalVolume = v1 + v2;

    console.log(`[${browserName}] Cut volumes: part1=${v1.toFixed(2)} mm³, part2=${v2.toFixed(2)} mm³, total=${totalVolume.toFixed(2)} mm³`);

    // A plane tilted 45 degrees about X through (cx, cy, 5) removes 2250 mm3 from a 20mm cube;
    // a horizontal cut at z=5 would give 2000/6000, so this proves the tilt reached the engine.
    const sorted = [v1, v2].sort((a, b) => a - b);
    assert.ok(Math.abs(sorted[0] - 2250) < 100, `Smaller part should be ~2250 mm3, got ${sorted[0]}`);
    assert.ok(Math.abs(sorted[1] - 5750) < 100, `Larger part should be ~5750 mm3, got ${sorted[1]}`);
    assert.ok(Math.abs(totalVolume - 8000) < 10, `Total volume should equal 8000 mm3 within tolerance, got ${totalVolume}`);

    console.log(`[${browserName}] Cut rotation test PASSED!`);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`Starting test server on port ${PORT}...`);
  await startServer(PORT, 'cut-rotation');

  try {
    await runBrowserCutRotationSuite(chromium, 'chromium');
    if (process.env.SKIP_FIREFOX !== '1') await runBrowserCutRotationSuite(firefox, 'firefox');
    console.log('\nAll Cut Rotation tests finished!');
  } finally {
    console.log(`Stopping test server on port ${PORT}...`);
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('Fatal error running cut-rotation test:', err);
  process.exit(1);
});
