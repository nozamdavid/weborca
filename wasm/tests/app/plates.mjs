#!/usr/bin/env node
/**
 * @file plates.mjs
 * End-to-end test for OrcaSlicer Web Multiple Plates View.
 *
 * Runs against `vite preview` on port 5064 across Chromium and Firefox:
 * 1. Imports 20mm_cube.obj onto plate 1.
 * 2. Adds plate 2 via "+ Add Plate" button (or store action).
 * 3. Moves object to plate 2's grid coordinate space (origin [360, 0, 0]).
 * 4. Slices only plate 2 via Slice Plate 2 button.
 * 5. Verifies G-code coordinates are translated back to bed coordinate origin [0, 300] (not [360, 660]).
 * 6. Takes screenshot of multi-plate view.
 * 7. Cleanly shuts down server and releases port 5064.
 */

import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
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

const PORT = 5064;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function parseGcodeBounds(gcodeText) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const line of gcodeText.split('\n')) {
    if (!line.startsWith('G1 ')) continue;
    const xMatch = line.match(/X([0-9.]+)/);
    const yMatch = line.match(/Y([0-9.]+)/);
    if (xMatch) {
      const v = parseFloat(xMatch[1]);
      if (v < minX) minX = v;
      if (v > maxX) maxX = v;
    }
    if (yMatch) {
      const v = parseFloat(yMatch[1]);
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
  }
  return { minX, maxX, minY, maxY };
}

async function runBrowserSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Multiple Plates tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchArgs = ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`];
  const browser = await browserType.launch({
    headless: true,
    args: launchArgs,
    firefoxUserPrefs: {
      'network.security.ports.banned.override': String(PORT)
    }
  });

  const pageErrors = [];

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error(`[${browserName}] Page error:`, err);
      pageErrors.push(err.message);
    });

    // 1. Navigate to App
    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    // Wait for engine to initialize presets
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

    // 2. Import 20mm_cube.obj
    console.log(`[${browserName}] Importing cube model...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    // Wait for object to be listed in plateStore
    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    // Wait for plate selector bar
    await page.waitForSelector('#plate-selector-bar', { timeout: 10000 });
    console.log(`[${browserName}] Plate selector bar visible`);

    // 3. Click "+ Add Plate" button
    console.log(`[${browserName}] Adding Plate 2...`);
    await page.click('#add-plate-btn');

    await page.waitForFunction(() => {
      const ps = window.__platesStore?.getState();
      return ps && ps.plates.length >= 2;
    }, null, { timeout: 10000 });

    const plates = await page.evaluate(() => window.__platesStore.getState().plates);
    console.log(`[${browserName}] Total plates: ${plates.length}, Plate 2 origin: [${plates[1].origin.join(', ')}]`);

    // Verify Plate 2 origin on Voron 300 (width=300 -> stride_x = 360)
    if (plates[1].origin[0] !== 360) {
      throw new Error(`Expected Plate 2 origin X to be 360, got ${plates[1].origin[0]}`);
    }

    // 4. Move cube instance to plate 2 (origin 360 + 150 = 510)
    console.log(`[${browserName}] Moving cube to Plate 2 coordinates...`);
    await page.evaluate(async () => {
      const pStore = window.__plateStore.getState();
      const obj = pStore.objects[0];
      const inst = obj.instances[0];
      await pStore.setInstanceTransform(obj.id, inst.id, {
        offset: [510.0, 150.0, 10.0]
      });
      await window.__platesStore.getState().fetchPlates();
    });

    // Verify instance assignment to Plate 2
    await page.waitForFunction(() => {
      const ps = window.__platesStore?.getState();
      return ps && ps.plates[1]?.instances?.length >= 1;
    }, null, { timeout: 10000 });
    console.log(`[${browserName}] Cube successfully assigned to Plate 2`);

    // Switch active plate to Plate 2 tab
    await page.click('#plate-tab-1');

    // Each plate tab carries its number, and a double-click renames the plate (the title is kept in the project)
    assert.equal(await page.locator('#plate-number-0').innerText(), '1');
    assert.equal(await page.locator('#plate-number-1').innerText(), '2');
    await page.dblclick('#plate-tab-1');
    await page.fill('#plate-name-input-1', 'Benchy plate');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__platesStore.getState().plates[1]?.name === 'Benchy plate', null, { timeout: 10000 });
    assert.equal(await page.locator('#plate-name-1').innerText(), 'Benchy plate');
    // The active plate's number and title are printed on the bed
    const printed = await page.evaluate(() => window.__plateScene.plateLabelGroup.children.length);
    assert.equal(printed, 4, 'both plate numbers and titles are drawn');
    assert.equal(await page.evaluate(() => window.__plateScene.extraBedsGroup.children.length), 3, 'the second plate has its own bed beside the first');
    await page.dblclick('#plate-tab-1');
    await page.fill('#plate-name-input-1', '');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__platesStore.getState().plates[1]?.name === 'Untitled plate', null, { timeout: 10000 });
    assert.equal(await page.locator('#plate-name-1').innerText(), 'Untitled plate', 'an empty title is the default one');
    await page.dblclick('#plate-tab-1');
    await page.fill('#plate-name-input-1', 'Benchy plate');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__platesStore.getState().plates[1]?.name === 'Benchy plate', null, { timeout: 10000 });
    await page.click('#view-top');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `plates-titles-${browserName}.png`) });
    // Clicking a plate in the 3D view selects it, without moving the camera
    const screenOf = (index) => page.evaluate((i) => {
      const scene = window.__plateScene;
      const plate = window.__platesStore.getState().plates[i];
      const rect = scene.renderer.domElement.getBoundingClientRect();
      const v = scene.bedConfigCenterWorld(plate.origin).project(scene.camera);
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
    }, index);
    for (const [from, to] of [[1, 0], [0, 1]]) {
      await page.click(`#plate-tab-${from}`);
      const cameraBefore = await page.evaluate(() => window.__plateScene.camera.position.toArray().map(Math.round));
      const [x, y] = await screenOf(to);
      await page.mouse.click(x, y + 40); // off the objects, on the plate
      await page.waitForFunction((i) => window.__platesStore.getState().activePlateIndex === i, to, { timeout: 5000 });
      assert.deepEqual(await page.evaluate(() => window.__plateScene.camera.position.toArray().map(Math.round)), cameraBefore, 'the camera stays put');
    }
    console.log(`[${browserName}] Plate numbers and titles verified`);

    // Take screenshot of multi-plate setup
    const screenshotFile = path.join(SCREENSHOT_DIR, `plates-${browserName}.png`);
    await page.screenshot({ path: screenshotFile });
    console.log(`[${browserName}] Screenshot saved to ${screenshotFile}`);

    // 5. Slice only Plate 2
    console.log(`[${browserName}] Slicing Plate 2...`);
    await page.click('#slice-plate-btn');

    // Wait for slicing to finish
    await page.waitForFunction(() => {
      const app = window.__appStore?.getState?.() || window.useAppStore?.getState?.();
      const pStore = window.__platesStore?.getState?.();
      return (!app || !app.isSlicing) && (!pStore || !pStore.isLoading);
    }, null, { timeout: 25000 });

    // Download/retrieve sliced G-code
    const sliceResult = await page.evaluate(async () => {
      const gcodeUrl = window.__appStore?.getState?.()?.gcodeUrl;
      if (!gcodeUrl) return null;
      const resp = await fetch(gcodeUrl);
      const text = await resp.text();
      return text;
    });

    if (!sliceResult) {
      throw new Error('Slice result G-code was not produced or available in store');
    }

    const bounds = parseGcodeBounds(sliceResult);
    console.log(`[${browserName}] Plate 2 G-code bounds: X=[${bounds.minX.toFixed(1)}, ${bounds.maxX.toFixed(1)}], Y=[${bounds.minY.toFixed(1)}, ${bounds.maxY.toFixed(1)}]`);

    // Bed coordinate check: should be shifted back by plate origin [360, 0], placing the 20mm cube centered around ~150 mm (not 510 mm)
    if (bounds.minX > 200 || bounds.maxX > 200) {
      throw new Error(`Plate 2 G-code was not translated to bed coordinates! X range: [${bounds.minX}, ${bounds.maxX}]`);
    }

    console.log(`[${browserName}] Verified coordinates translated to bed origin [0, width]: PASS`);

    if (pageErrors.length > 0) {
      throw new Error(`Browser page errors encountered: ${pageErrors.join('; ')}`);
    }

    return true;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('================================================================================');
  console.log('OrcaSlicer Web Multiple Plates View Test Suite');
  console.log(`Target: Vite Preview on Port ${PORT}`);
  console.log('================================================================================\n');

  try {
    await startServer(PORT, 'plates');

    await runBrowserSuite(chromium, 'chromium');
    await runBrowserSuite(firefox, 'firefox');

    console.log('\n================================================================================');
    console.log('All Multiple Plates browser tests passed successfully on Chromium and Firefox!');
    console.log('================================================================================\n');
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nMultiple Plates test suite failed:', err);
  stopServer().finally(() => process.exit(1));
});
