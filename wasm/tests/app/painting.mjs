#!/usr/bin/env node
/**
 * @file painting.mjs
 * End-to-end browser test for OrcaSlicer Web Support Face Painting.
 *
 * Runs against isolated build on port 5072 across Chromium and Firefox sequentially:
 * 1. Loads 20mm_cube.obj and verifies canvas rendering.
 * 2. Selects object & volume, opens Support Face Painting mode.
 * 3. Actual canvas pointer paints visible triangle across mesh.
 * 4. Verifies engine readback (enforcers/blockers) and Three.js colored annotation overlay.
 * 5. Tests mode switching (enforce, block, erase) and volume clear.
 * 6. Exits painting mode and verifies camera navigation (orbit controls) is restored.
 * 7. Verifies saved/reopened 3MF project retains custom support annotations.
 * 8. Second-volume triangle mapping on a transformed two-volume fixture with canvas pointers.
 * 9. Shuts down preview server cleanly and confirms port 5072 is freed.
 */

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { paintingChecks } from './painting-checks.mjs';
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

const PORT = 5072;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ISOLATED_BUILD_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/build/ui-paint-dist');
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserPaintSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Support Painting tests for ${browserName.toUpperCase()}`);
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

    const screenshotFile = path.join(SCREENSHOT_DIR, `paint-${browserName}-init.png`);
    await page.screenshot({ path: screenshotFile });
    results.push({ name: 'Cube imported and rendered', pass: true });

    await paintingChecks(page, 'support', results);
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
  console.log('OrcaSlicer Web Support Face Painting Test Suite');
  console.log('Target: Vite Preview on Port 5072');
  console.log('================================================================================\n');

  let allPass = true;
  const suiteResults = [];

  try {
    await startServer(PORT, 'painting');

    for (const [bType, bName] of [
      [chromium, 'chromium'],
      [firefox, 'firefox']
    ]) {
      const res = await runBrowserPaintSuite(bType, bName);
      suiteResults.push(res);
      if (!res.pass) {
        allPass = false;
      }
    }
  } finally {
    await stopServer(PORT);
  }

  console.log('\n================================================================================');
  console.log('SUPPORT PAINTING TEST EXECUTION SUMMARY');
  console.log('================================================================================');
  for (const { browserName, results, pass, error } of suiteResults) {
    console.log(`\nBrowser: ${browserName.toUpperCase()} [${pass ? 'PASS' : 'FAIL'}]`);
    for (const r of results) {
      console.log(`  - ${r.name.padEnd(55)}: ${r.pass ? 'PASS' : 'FAIL'}`);
    }
    if (error) {
      console.log(`  * ERROR: ${error}`);
    }
  }
  console.log('\n================================================================================');

  if (!allPass) {
    console.error('Support Painting tests failed!');
    process.exit(1);
  }

  console.log('All Support Painting tests passed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled suite error:', err);
  process.exit(1);
});
