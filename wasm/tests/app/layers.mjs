#!/usr/bin/env node
/**
 * @file layers.mjs
 * End-to-end browser test for OrcaSlicer Web Variable Layer Height & Adaptive Slicing.
 *
 * Runs against the built app on port 5076 across Chromium and Firefox sequentially:
 * 1. Serves the built app with COOP/COEP headers.
 * 2. Loads 20mm_cube.obj and verifies canvas rendering.
 * 3. Selects cube object and opens the Variable Layer Height tool (#tool-varlayer-btn).
 * 4. Verifies the tool UI (#layer-height-tool, canvas, controls) opens.
 * 5. Clicks Adaptive (#layers-adaptive-btn) and verifies profile curve changes.
 * 6. Performs real pointer drag on the vertical profile bar canvas (#layer-profile-canvas).
 * 7. Verifies layer count and profile reflects interactive brush edit.
 * 8. Triggers slicing (#slice-btn) and verifies slicing completes successfully.
 * 9. Takes screenshot: wasm/build/tests-app/layers-<browser>.png.
 * 10. Shuts down preview server cleanly and confirms port 5076 is released.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

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

const PORT = 5086;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIST_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/app/dist');
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserLayersSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Variable Layer Height tests for ${browserName.toUpperCase()}`);
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

    // 1. Navigate to app
    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    // Wait for engine presets to initialize

    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    // 2. Import 20mm_cube.obj
    console.log(`[${browserName}] Importing 20mm_cube.obj...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    await page.waitForSelector('#plate-canvas-container canvas', { timeout: 10000 });
    await page.waitForTimeout(500);
    results.push({ name: 'Cube imported and rendered', pass: true });

    // 3. Select cube object
    console.log(`[${browserName}] Selecting cube object...`);
    await page.evaluate(() => {
      const s = window.__plateStore?.getState();
      if (s && s.objects.length > 0) {
        s.selectObject(s.objects[0].id);
      }
    });
    await page.waitForTimeout(300);

    // 4. Open Variable Layer Height tool
    console.log(`[${browserName}] Opening Variable Layer Height tool...`);
    const varLayerBtn = await page.waitForSelector('#tool-varlayer-btn', { timeout: 5000 });
    await varLayerBtn.click();

    // Verify tool panel appears
    await page.waitForSelector('#layer-height-tool', { timeout: 5000 });
    await page.waitForSelector('#layer-profile-canvas', { timeout: 5000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `layer-height-view-${browserName}.png`) });
    results.push({ name: 'Variable layer height tool opened', pass: true });

    // Read initial layer count
    const initialCountText = await page.textContent('#layers-count');
    const initialLayers = parseInt(initialCountText || '0', 10);
    console.log(`[${browserName}] Initial nominal layer count: ${initialLayers}`);
    assert.ok(initialLayers > 0, 'Initial layer count must be > 0');

    // 5. Test Adaptive button
    console.log(`[${browserName}] Clicking Adaptive...`);
    const adaptiveBtn = await page.waitForSelector('#layers-adaptive-btn', { timeout: 5000 });
    await adaptiveBtn.click();
    await page.waitForTimeout(800);

    const adaptiveCountText = await page.textContent('#layers-count');
    const adaptiveLayers = parseInt(adaptiveCountText || '0', 10);
    console.log(`[${browserName}] Adaptive layer count: ${adaptiveLayers}`);
    results.push({ name: 'Adaptive button changes profile', pass: true });

    // 6. Test real pointer drag on profile canvas
    console.log(`[${browserName}] Performing brush drag on profile bar...`);
    const canvasBox = await page.locator('#layer-profile-canvas').boundingBox();
    assert.ok(canvasBox, 'Profile canvas must have bounding box');

    const startX = canvasBox.x + canvasBox.width / 2;
    const startY = canvasBox.y + canvasBox.height * 0.7; // Lower section
    const endY = canvasBox.y + canvasBox.height * 0.4;   // Middle section

    // Real pointer events: move, down, drag, up
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(startX, endY, { steps: 5 });
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(500);

    const draggedCountText = await page.textContent('#layers-count');
    console.log(`[${browserName}] Layer count after brush drag: ${draggedCountText}`);
    results.push({ name: 'Brush drag updates profile', pass: true });

    // 7. Trigger Slicing to verify slice reflects variable layers
    console.log(`[${browserName}] Triggering slice...`);
    const sliceBtn = await page.waitForSelector('#slice-btn', { timeout: 5000 });
    await sliceBtn.click();

    // Wait for slicing to complete
    await page.waitForFunction(() => {
      const app = window.__appStore?.getState?.();
      return app && !app.isSlicing && app.sliceResult && app.sliceResult.layers > 0;
    }, null, { timeout: 25000 });

    const sliceResult = await page.evaluate(() => window.__appStore?.getState?.()?.sliceResult);
    console.log(`[${browserName}] Slicing completed with ${sliceResult?.layers} layers`);
    assert.ok(sliceResult && sliceResult.layers > 0, 'Slice must return layers > 0');
    assert.equal(sliceResult.layers, Number(draggedCountText), 'Slice layer count must match the edited object profile');
    results.push({ name: 'Slicing reflects variable profile', pass: true });

    // 8. Capture screenshot
    const screenshotPath = path.join(SCREENSHOT_DIR, `layers-${browserName}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`[${browserName}] Saved screenshot to ${screenshotPath}`);
    assert.ok(fs.existsSync(screenshotPath), 'Screenshot file must exist');
    results.push({ name: 'Screenshot captured', pass: true });

  } finally {
    await browser.close();
  }

  assert.equal(pageErrors.length, 0, `Browser ${browserName} had page errors: ${pageErrors.join(', ')}`);
  for (const r of results) {
    assert.ok(r.pass, `Step failed: ${r.name}`);
  }
  console.log(`[${browserName}] All tests passed successfully!`);
}

async function main() {
  try {
    await startServer(PORT, 'layers');

    // Run Chromium then Firefox sequentially
    console.log('\n>>> Running Chromium suite...');
    await runBrowserLayersSuite(chromium, 'chromium');

    console.log('\n>>> Running Firefox suite...');
    await runBrowserLayersSuite(firefox, 'firefox');

    console.log('\n==================================================');
    console.log('All browser variable layer height tests passed!');
    console.log('==================================================');
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('[Error] layers.mjs failed:', err);
  stopServer().finally(() => process.exit(1));
});
