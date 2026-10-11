#!/usr/bin/env node
/**
 * @file smoke.mjs
 * End-to-end smoke test for the OrcaSlicer Web React Application.
 *
 * Runs against `vite preview` on port 5058 across Chromium and Firefox:
 * 1. Verifies page loads, crossOriginIsolated is true, and no page errors occur.
 * 2. Selects Voron 2.4, 0.20mm Standard, Generic PLA, slices 20mm_cube.obj.
 *    Verifies progress, stats, and checks G-code hash against reference.
 * 3. Slices with Bambu Lab X1 Carbon 0.4 nozzle and Bambu PLA Basic, verifying 100 layers.
 * 4. Tests cancellation on 3DBenchy.stl, verifying cancellation ends in under 1 second.
 * 5. Saves application screenshot to wasm/build/tests-app/app.png.
 * 6. Shuts down preview server cleanly and confirms port 5058 is freed.
 */

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

// Import G-code hasher
const { hashGcode } = await import('../lib/gcode_hash.mjs');

const PORT = 5058;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REFERENCE_PATH = path.resolve(repoRoot, 'wasm/tests/parity/refs-portable/cube-voron.json');
const reference = JSON.parse(fs.readFileSync(REFERENCE_PATH, 'utf8'));
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const BENCHY_MODEL_PATH = path.resolve(repoRoot, 'wasm/build/models/3DBenchy.stl');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');
const SCREENSHOT_PATH = path.join(SCREENSHOT_DIR, 'app.png');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting smoke tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const browser = await browserType.launch({
    headless: true,
    args: ['--enable-features=SharedArrayBuffer']
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

    // -------------------------------------------------------------------------
    // Step 1: Page Load & Isolation Check
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 1: Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    console.log(`[${browserName}] window.crossOriginIsolated = ${isIsolated}`);
    if (!isIsolated) {
      throw new Error(`crossOriginIsolated is false on ${browserName}`);
    }

    if (pageErrors.length > 0) {
      throw new Error(`Encountered page errors on load: ${pageErrors.join('; ')}`);
    }
    results.push({ name: 'Page Load & Cross-Origin Isolation', pass: true });

    // -------------------------------------------------------------------------
    // Step 2: Voron Cube Slicing & G-Code Parity
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 2: Selecting Voron presets and slicing 20mm cube...`);

    // Wait for vendor selector to have options
    await page.waitForFunction(() => {
      const v = document.getElementById('vendor-select');
      return v && v.options.length > 1;
    }, null, { timeout: 15000 });

    await page.selectOption('#vendor-select', 'Voron');

    // Wait for printer select options
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });

    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    // Wait for process and filament options to be populated
    await page.waitForFunction(() => {
      const proc = document.getElementById('process-select');
      const fil = document.getElementById('filament-select');
      return proc && !proc.disabled && Array.from(proc.options).some((o) => o.value === '0.20mm Standard @Voron') &&
             fil && !fil.disabled && Array.from(fil.options).some((o) => o.value === 'Generic PLA @System');
    }, null, { timeout: 15000 });

    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.selectOption('#filament-select', 'Generic PLA @System');

    // Import 20mm_cube.obj
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    // Wait for Slice button to enable
    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 15000 });

    console.log(`[${browserName}] Slicing cube...`);
    await page.click('#slice-btn');

    // Verify progress bar appears
    await page.waitForSelector('#preview-slicing-overlay', { state: 'visible', timeout: 15000 });
    console.log(`[${browserName}] Progress bar active.`);

    // Wait for slicing completion & stats
    await page.waitForFunction(() => {
      const stats = document.getElementById('stats-section');
      const sliceBtn = document.getElementById('slice-btn');
      return stats !== null && sliceBtn && !sliceBtn.disabled;
    }, null, { timeout: 60000 });

    const voronLayers = await page.$eval('#stat-layers', (el) => el.textContent?.trim());
    const voronTime = await page.$eval('#stat-time', (el) => el.textContent?.trim());
    console.log(`[${browserName}] Voron slice complete. Layers: ${voronLayers}, Time: ${voronTime}`);

    // Take screenshot on Chromium for reporting
    if (browserName === 'chromium') {
      await page.screenshot({ path: SCREENSHOT_PATH });
      console.log(`[${browserName}] Screenshot saved to ${SCREENSHOT_PATH}`);
    }

    // Download and hash G-code
    const gcodeText = await page.evaluate(async () => {
      const link = document.getElementById('download-link');
      if (!link || !link.href) throw new Error('Download link missing or invalid');
      const res = await fetch(link.href);
      return await res.text();
    });

    const computedHash = hashGcode(gcodeText);
    const expectedHash = reference.normalizedSha256;
    console.log(`[${browserName}] G-Code Hash: ${computedHash}`);
    console.log(`[${browserName}] Expected Hash: ${expectedHash}`);

    if (computedHash !== expectedHash) {
      throw new Error(`Hash mismatch for Voron cube:\nGot:      ${computedHash}\nExpected: ${expectedHash}`);
    }
    results.push({ name: 'Voron Cube Parity Slice (SHA-256 match)', pass: true });

    // -------------------------------------------------------------------------
    await page.click("#tab-prepare"); await page.waitForSelector("#vendor-select", { state: "visible", timeout: 5000 });
    // Step 3: Bambu Lab X1 Carbon Slicing (100 Layers)
    // -------------------------------------------------------------------------
    await page.click("#tab-prepare"); await page.waitForSelector("#vendor-select", { state: "visible", timeout: 5000 });
    console.log(`[${browserName}] Step 3: Slicing with Bambu Lab X1 Carbon 0.4 nozzle...`);
    await page.selectOption('#vendor-select', 'BBL');

    // Wait for BBL printers
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Bambu Lab X1 Carbon 0.4 nozzle');
    }, null, { timeout: 15000 });

    await page.selectOption('#printer-select', 'Bambu Lab X1 Carbon 0.4 nozzle');

    // Wait for Bambu PLA Basic filament
    await page.waitForFunction(() => {
      const fil = document.getElementById('filament-select');
      return fil && !fil.disabled && Array.from(fil.options).some((o) => o.value.includes('Bambu PLA Basic'));
    }, null, { timeout: 15000 });

    const bblFilamentVal = await page.evaluate(() => {
      const fil = document.getElementById('filament-select');
      const opt = Array.from(fil.options).find((o) => o.value.includes('Bambu PLA Basic'));
      return opt ? opt.value : '';
    });
    await page.selectOption('#filament-select', bblFilamentVal);

    // Wait for slice button
    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 15000 });

    await page.click('#slice-btn');

    // Wait for slice completion
    await page.waitForFunction(() => {
      const sliceBtn = document.getElementById('slice-btn');
      const status = document.getElementById('status-text');
      return sliceBtn && !sliceBtn.disabled && status && status.textContent?.includes('complete');
    }, null, { timeout: 60000 });

    const bblLayers = parseInt(await page.$eval('#stat-layers', (el) => el.textContent?.trim() || '0'), 10);
    console.log(`[${browserName}] Bambu Lab slice completed with ${bblLayers} layers.`);
    if (bblLayers !== 100) {
      throw new Error(`Expected 100 layers for Bambu Lab X1 Carbon, got ${bblLayers}`);
    }
    results.push({ name: 'Bambu Lab X1 Carbon (100 Layers)', pass: true });

    // -------------------------------------------------------------------------
    // Step 4: Cancel Slicing on 3DBenchy.stl (< 1 s)
    // -------------------------------------------------------------------------
    await page.click("#tab-prepare");
    console.log(`[${browserName}] Step 4: Testing Cancel slicing on 3DBenchy.stl...`);
    if (!fs.existsSync(BENCHY_MODEL_PATH)) {
      console.log(`[${browserName}] Fetching 3DBenchy.stl...`);
      execSync('bash wasm/tests/data/fetch_models.sh', { cwd: repoRoot, stdio: 'inherit' });
    }

    await page.setInputFiles('#model-file', BENCHY_MODEL_PATH);

    // Wait for model load & arrangement to complete and slice button to be ready
    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 15000 });

    // Trigger slice
    await page.click('#slice-btn');

    // Slicing switches to Preview; its overlay exposes the visible Cancel control.
    await page.waitForSelector('#preview-cancel-btn', { state: 'visible', timeout: 5000 });

    const cancelStart = Date.now();
    await page.click('#preview-cancel-btn');

    // Wait for cancel to settle
    await page.waitForFunction(() => {
      const sliceBtn = document.getElementById('slice-btn');
      const state = window.__appStore.getState();
      return !document.getElementById('preview-slicing-overlay') && sliceBtn && !sliceBtn.disabled &&
        !state.isSlicing && state.sliceStatusText === 'Slicing canceled.' && state.engineError === null;
    }, null, { timeout: 5000, polling: 10 });

    const cancelDurationMs = Date.now() - cancelStart;
    console.log(`[${browserName}] Cancel resolved in ${cancelDurationMs} ms.`);

    if (cancelDurationMs > 1000) {
      throw new Error(`Cancel took ${cancelDurationMs} ms (must complete within 1000 ms)`);
    }
    results.push({ name: `Slice Cancellation (< 1 s, actual: ${cancelDurationMs}ms)`, pass: true });

    if (pageErrors.length > 0) {
      throw new Error(`Page errors occurred during test: ${pageErrors.join('; ')}`);
    }

    await browser.close();
    return { browserName, results, pass: true };
  } catch (err) {
    await browser.close();
    console.error(`[${browserName}] Failed:`, err);
    return { browserName, results, pass: false, error: err.message };
  }
}

async function main() {
  console.log('================================================================================');
  console.log('OrcaSlicer Web Smoke Test Suite');
  console.log('Target: Vite Preview on Port 5058');
  console.log('================================================================================\n');

  let allPass = true;
  const suiteResults = [];

  try {
    await startServer(PORT, 'smoke');

    for (const [bType, bName] of [[chromium, 'chromium'], [firefox, 'firefox']]) {
      const res = await runBrowserSuite(bType, bName);
      suiteResults.push(res);
      if (!res.pass) {
        allPass = false;
      }
    }
  } finally {
    await stopServer(PORT);
  }

  // Print final summary
  console.log('\n================================================================================');
  console.log('SMOKE TEST EXECUTION SUMMARY');
  console.log('================================================================================');
  for (const { browserName, results, pass, error } of suiteResults) {
    console.log(`\nBrowser: ${browserName.toUpperCase()} [${pass ? 'PASS' : 'FAIL'}]`);
    for (const r of results) {
      console.log(`  - ${r.name.padEnd(50)}: ${r.pass ? 'PASS' : 'FAIL'}`);
    }
    if (error) {
      console.log(`  * ERROR: ${error}`);
    }
  }
  console.log('\n================================================================================');

  if (!allPass) {
    console.error('Smoke tests failed!');
    process.exit(1);
  }

  console.log('All smoke tests passed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
