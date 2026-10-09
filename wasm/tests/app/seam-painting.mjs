#!/usr/bin/env node
/**
 * @file seam-painting.mjs
 * End-to-end browser test for OrcaSlicer Web Seam Face Painting and Target Isolation.
 *
 * Runs against isolated build on port 5073 across Chromium and Firefox sequentially:
 * 1. Loads 20mm_cube.obj and verifies canvas rendering.
 * 2. Selects object & volume, opens Face Painting mode.
 * 3. Switches target to Seam and verifies initial clean readback.
 * 4. Actual canvas pointer paints seam enforcer, blocker, and erase modes.
 * 5. Clears seam volume annotations.
 * 6. Target isolation: verifies switching between Support and Seam does not mix annotations, pending strokes, or overlays.
 * 7. Transformed second volume mapping: verifies exact local-to-merged facet index mapping on second volume.
 * 8. 3MF persistence: verifies both seam and support annotations survive project save/reopen round-trip.
 * 9. Race isolation & stroke cancellation: delayed old-target RPC race during target switch & stroke cancellation.
 * 10. Cleanly shuts down preview server and confirms port 5073 is freed.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { paintingChecks } from './painting-checks.mjs';
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

const PORT = 5073;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ISOLATED_BUILD_DIR = process.env.APP_TEST_DIST
  ? path.resolve(repoRoot, process.env.APP_TEST_DIST)
  : path.resolve(repoRoot, 'wasm/build/ui-seam-dist');
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserSeamPaintSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Seam Painting tests for ${browserName.toUpperCase()}`);
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

    // 1. Navigate to isolated app
    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    // Wait for engine presets to initialize
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
    console.log(`[${browserName}] Importing 20mm_cube.obj...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    await page.waitForSelector('#plate-canvas-container canvas', { timeout: 10000 });
    await page.waitForTimeout(500);

    const screenshotFile = path.join(SCREENSHOT_DIR, `seam-paint-${browserName}-init.png`);
    await page.screenshot({ path: screenshotFile });
    results.push({ name: 'Cube imported and rendered', pass: true });

    await paintingChecks(page, 'seam', results);
    assert.equal(pageErrors.length, 0, pageErrors.join('; '));
    await browser.close();
    return { browserName, results, pass: true };
  } catch (err) {
    await browser.close();
    console.error(`[${browserName}] Test failed:`, err);
    return { browserName, results, pass: false, error: err.message };
  }
}

async function main() {
  console.log('================================================================================');
  console.log('OrcaSlicer Web Seam Face Painting Test Suite');
  console.log('Target: Vite Preview on Port 5073');
  console.log('================================================================================\n');

  let allPass = true;
  const suiteResults = [];

  try {
    await startServer(PORT, 'seam-painting');

    for (const [bType, bName] of [
      [chromium, 'chromium'],
      [firefox, 'firefox']
    ]) {
      const res = await runBrowserSeamPaintSuite(bType, bName);
      suiteResults.push(res);
      if (!res.pass) {
        allPass = false;
      }
    }
  } finally {
    await stopServer(PORT);
  }

  console.log('\n================================================================================');
  console.log('SEAM PAINTING TEST EXECUTION SUMMARY');
  console.log('================================================================================');
  for (const { browserName, results, pass, error } of suiteResults) {
    console.log(`\nBrowser: ${browserName.toUpperCase()} [${pass ? 'PASS' : 'FAIL'}]`);
    for (const r of results) {
      console.log(`  - ${r.name.padEnd(65)}: ${r.pass ? 'PASS' : 'FAIL'}`);
    }
    if (error) {
      console.log(`  * ERROR: ${error}`);
    }
  }
  console.log('\n================================================================================');

  if (!allPass) {
    console.error('Seam Painting tests failed!');
    process.exit(1);
  }

  console.log('All Seam Painting tests passed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled suite error:', err);
  process.exit(1);
});
