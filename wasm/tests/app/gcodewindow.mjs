#!/usr/bin/env node
/**
 * @file gcodewindow.mjs
 * End-to-end Playwright test suite for OrcaSlicer Web G-code Viewer Text Window.
 *
 * Runs against `vite preview` on port 5140 across Chromium and Firefox:
 * 1. Selects Voron presets, imports 20mm_cube.obj, slices.
 * 2. Verifies preview screen loads with toolpaths.
 * 3. Verifies G-code window toggle button is present on toolbar and window is initially hidden.
 * 4. Opens G-code window via toolbar button.
 * 5. Verifies G-code window panel mounts with header, line numbers, and syntax highlighting.
 * 6. Asserts highlighted line changes when scrubbing move slider.
 * 7. Asserts highlighted line changes when scrubbing layer slider.
 * 8. Tests collapse / expand toggle on panel header.
 * 9. Tests close button and 'C' keyboard shortcut toggle.
 * 10. Captures screenshot to wasm/build/tests-app/gcodewindow-<browser>.png.
 * 11. Ensures port 5140 is cleanly released.
 */

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
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
  playwright = await import(path.resolve(repoRoot, 'wasm/tests/node_modules/playwright/index.mjs'));
}
const { chromium, firefox } = playwright;

const PORT = 5140;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Running G-code Window Test Suite for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const browser = await browserType.launch({
    headless: true,
    args: ['--enable-features=SharedArrayBuffer']
  });

  const pageErrors = [];
  const results = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error(`[${browserName}] Page error:`, err);
      pageErrors.push(err.message);
    });

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[OrcaPreview]') || text.includes('Error') || text.includes('error') || text.includes('Loaded G-code')) {
        console.log(`[${browserName} console] ${text}`);
      }
    });

    // 1. Page Load
    console.log(`[${browserName}] Step 1: Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    if (!isIsolated) {
      throw new Error(`crossOriginIsolated is false on ${browserName}`);
    }
    results.push({ name: 'Page Load & Cross-Origin Isolation', pass: true });

    // 2. Select Voron Presets
    console.log(`[${browserName}] Step 2: Selecting Voron presets...`);
    await selectAddedPrinter(page, 'Voron');

    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    await page.waitForFunction(() => {
      const proc = document.getElementById('process-select');
      const fil = document.getElementById('filament-select');
      return (
        proc && !proc.disabled && Array.from(proc.options).some((o) => o.value === '0.20mm Standard @Voron') &&
        fil && !fil.disabled && Array.from(fil.options).some((o) => o.value === 'Generic PLA @System')
      );
    }, null, { timeout: 15000 });
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.selectOption('#filament-select', 'Generic PLA @System');

    // 3. Import 20mm_cube.obj and Slice
    console.log(`[${browserName}] Step 3: Importing 20mm_cube.obj and slicing...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 15000 });

    await page.click('#slice-btn');

    // 4. Wait for Slicing Completion & Switch to Preview Screen
    console.log(`[${browserName}] Step 4: Waiting for slice completion & Preview switch...`);
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#canvas');
      const previewStats = window.previewStats;
      return canvas !== null && previewStats && previewStats.layers > 0;
    }, null, { timeout: 60000 });

    const stats = await page.evaluate(() => window.previewStats);
    console.log(`[${browserName}] Preview loaded with ${stats.layers} layers`);
    results.push({ name: 'Model Slice & Auto-Switch to Preview', pass: true });

    // Stats panel sits in the lower right, clear of the view buttons and the cube.
    await page.waitForSelector('.slice-stats-panel', { timeout: 15000 });
    const layout = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
      return { panel: r('.slice-stats-panel'), cube: r('#view-cube'), buttons: r('.view-buttons'), vh: window.innerHeight };
    });
    const hit = (a, b) => b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    if (layout.panel.bottom < layout.vh * 0.75 || layout.panel.top < 150 || hit(layout.panel, layout.cube) || hit(layout.panel, layout.buttons)) {
      throw new Error('Stats panel not in lower right: ' + JSON.stringify(layout));
    }
    results.push({ name: 'Stats Panel Bottom Right', pass: true });

    // 5. Verify G-code Window Toggle Button on Toolbar
    console.log(`[${browserName}] Step 5: Checking G-code window toolbar toggle button...`);
    const toggleBtn = page.locator('#btn-toggle-gcode-window');
    await toggleBtn.waitFor({ state: 'visible', timeout: 5000 });
    results.push({ name: 'Toolbar G-code Window Toggle Button Mounted', pass: true });

    // 6. Verify G-code Window Initially Hidden
    const gcodeWinBefore = await page.$('#gcode-window');
    if (gcodeWinBefore !== null) {
      throw new Error('G-code window should be closed by default');
    }
    results.push({ name: 'G-code Window Initially Hidden', pass: true });

    // 7. Open G-code Window
    console.log(`[${browserName}] Step 7: Opening G-code window via toolbar button...`);
    await toggleBtn.click();
    const gcodeWin = page.locator('#gcode-window');
    await gcodeWin.waitFor({ state: 'visible', timeout: 5000 });

    // Verify header and lines container are present
    const header = page.locator('#gcode-window-header');
    await header.waitFor({ state: 'visible', timeout: 5000 });
    const linesContainer = page.locator('#gcode-lines-container');
    await linesContainer.waitFor({ state: 'visible', timeout: 5000 });

    // Check highlighted line is rendered
    const highlightedLine = page.locator('#gcode-current-line');
    await highlightedLine.waitFor({ state: 'visible', timeout: 5000 });
    const initialLineStr = await highlightedLine.getAttribute('data-line-number');
    const initialLine = parseInt(initialLineStr || '0', 10);
    console.log(`[${browserName}] Initial highlighted G-code line: #${initialLine}`);
    if (initialLine <= 0) {
      throw new Error(`Invalid initial highlighted line number: ${initialLineStr}`);
    }
    results.push({ name: 'Open G-code Window & Initial Line Highlighted', pass: true });

    // 8. Move Move Slider & Assert Highlighted Line Changes
    console.log(`[${browserName}] Step 8: Moving move slider and asserting highlighted line changes...`);
    await page.evaluate(() => {
      const store = window.__previewStore.getState();
      store.setMoveAction(store.minMove);
    });
    await page.waitForTimeout(100);

    const lineAfterMoveStr = await highlightedLine.getAttribute('data-line-number');
    const lineAfterMove = parseInt(lineAfterMoveStr || '0', 10);
    console.log(`[${browserName}] Highlighted line after move slider to min: #${lineAfterMove} (was #${initialLine})`);
    if (lineAfterMove === initialLine) {
      throw new Error(`Highlighted line did not change after move slider change! Still #${initialLine}`);
    }
    results.push({ name: 'Move Slider Scrub Updates Highlighted Line', pass: true });

    // 9. Move Layer Slider & Assert Highlighted Line Changes
    console.log(`[${browserName}] Step 9: Moving layer slider and asserting highlighted line changes...`);
    await page.evaluate(() => {
      const store = window.__previewStore.getState();
      // Change to layer 50 (index 49)
      store.setLayerRangeAction(0, 49);
    });
    await page.waitForTimeout(100);

    const lineAfterLayerStr = await highlightedLine.getAttribute('data-line-number');
    const lineAfterLayer = parseInt(lineAfterLayerStr || '0', 10);
    console.log(`[${browserName}] Highlighted line after layer slider change (layer 50): #${lineAfterLayer}`);
    if (lineAfterLayer === lineAfterMove || lineAfterLayer === initialLine) {
      throw new Error(`Highlighted line did not change after layer slider change! Was #${lineAfterMove}, now #${lineAfterLayer}`);
    }
    results.push({ name: 'Layer Slider Scrub Updates Highlighted Line', pass: true });

    // Source mapping comes from native path vertices, rather than a proportion of layer lines.
    for (const fraction of [0.1, 0.4, 0.8]) {
      await page.evaluate((fraction) => {
        const store = window.__previewStore.getState();
        store.setMoveAction(Math.floor(store.minMove + (store.maxMove - store.minMove) * fraction));
      }, fraction);
      await page.waitForTimeout(50);
      const mapped = await page.evaluate(() => {
        const move = window.__previewStore.getState().currentMove;
        const nativeLine = window.preview.getMoveGcodeLine(move);
        const row = document.querySelector('#gcode-current-line');
        const source = new TextDecoder().decode(window.__appStore.getState().sliceResult.gcode).split('\n')[nativeLine - 1]?.replace(/\r$/, '');
        const displayedSource = [...row.querySelectorAll('span')].slice(1).map((span) => span.textContent).join(' ').trim();
        return { nativeLine, shownLine: Number(row.dataset.lineNumber), source: source?.length > 55 ? source.slice(0, 52) + '...' : source, displayedSource };
      });
      if (mapped.nativeLine !== mapped.shownLine || mapped.source?.trim().replace(/\s+/g, ' ') !== mapped.displayedSource.replace(/\s+/g, ' ')) {
        throw new Error(`G-code source mapping mismatch: ${JSON.stringify(mapped)}`);
      }
    }
    results.push({ name: 'Exact Native Move-to-Source-Line Mapping', pass: true });

    // 10. Test Collapse and Expand Buttons
    console.log(`[${browserName}] Step 10: Testing collapse and expand buttons...`);
    const collapseBtn = page.locator('#btn-collapse-gcode-window');
    await collapseBtn.click();
    await page.waitForTimeout(50);
    const containerCollapsed = await page.$('#gcode-lines-container');
    if (containerCollapsed !== null) {
      throw new Error('G-code lines container should not be mounted when collapsed');
    }

    await collapseBtn.click();
    await page.waitForTimeout(50);
    const containerExpanded = await page.$('#gcode-lines-container');
    if (containerExpanded === null) {
      throw new Error('G-code lines container should be restored when expanded');
    }
    results.push({ name: 'Collapse / Expand Toggle', pass: true });

    // 11. Test Close Button & Keyboard Shortcut 'C'
    console.log(`[${browserName}] Step 11: Testing close button and 'C' keyboard shortcut...`);
    const closeBtn = page.locator('#btn-close-gcode-window');
    await closeBtn.click();
    await page.waitForTimeout(50);
    const windowClosed = await page.$('#gcode-window');
    if (windowClosed !== null) {
      throw new Error('G-code window should be closed after clicking close button');
    }

    // Reopen using 'c' shortcut
    await page.keyboard.press('c');
    await page.waitForTimeout(50);
    const windowReopened = await page.$('#gcode-window');
    if (windowReopened === null) {
      throw new Error('G-code window should reopen after pressing \"c\" shortcut');
    }

    // Close again using 'c' shortcut
    await page.keyboard.press('c');
    await page.waitForTimeout(50);
    const windowClosedAgain = await page.$('#gcode-window');
    if (windowClosedAgain !== null) {
      throw new Error('G-code window should close after pressing \"c\" shortcut again');
    }

    // Reopen for screenshot
    await toggleBtn.click();
    await page.waitForSelector('#gcode-window', { timeout: 3000 });
    results.push({ name: 'Close Button & Keyboard Shortcut \"C\" Toggle', pass: true });

    // 12. Capture Screenshot
    const screenshotPath = path.resolve(SCREENSHOT_DIR, `gcodewindow-${browserName}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`[${browserName}] Saved screenshot to ${screenshotPath}`);

    if (pageErrors.length > 0) {
      throw new Error(`Encountered page errors: ${pageErrors.join('; ')}`);
    }

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
  console.log('OrcaSlicer Web G-code Viewer Text Window Test Suite');
  console.log(`Target: Vite Preview on Port ${PORT}`);
  console.log('================================================================================\n');

  let allPass = true;
  const suiteResults = [];

  try {
    await startServer(PORT, 'gcodewindow');

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

  console.log('\n================================================================================');
  console.log('G-CODE WINDOW TEST EXECUTION SUMMARY');
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
    console.error('G-code window tests failed!');
    process.exit(1);
  }

  console.log('All G-code window tests passed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
