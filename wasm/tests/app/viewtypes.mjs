#!/usr/bin/env node
/**
 * @file viewtypes.mjs
 * End-to-end test suite for newly exposed Preview view types.
 *
 * Runs against `vite preview` on port 5144 across Chromium and Firefox:
 * 1. Selects Voron presets, imports 20mm_cube.obj, slices.
 * 2. Waits for automatic switch to Preview screen (default: FeatureType).
 * 3. Captures baseline canvas pixels for FeatureType view.
 * 4. Switches to each newly exposed view type:
 *    - ActualSpeed
 *    - Acceleration
 *    - Jerk
 *    - ActualVolumetricFlowRate
 *    - LayerTimeLogarithmic
 *    - PressureAdvance
 *    - ColorPrint
 *    - Summary
 * 5. Asserts the legend renders with non-empty range/items.
 * 6. Asserts the canvas renders and changes vs the default FeatureType view.
 * 7. Ensures port 5144 is cleanly released.
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

const PORT = 5144;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Newly exposed view types supported by libvgcode and now exposed in web preview
const NEW_VIEW_TYPES = [
  { id: 'ActualSpeed', name: 'Actual speed', kind: 'range', expectedTitle: 'Actual Speed (mm/s)' },
  { id: 'Acceleration', name: 'Acceleration', kind: 'range', expectedTitle: 'Acceleration (mm/s²)' },
  { id: 'Jerk', name: 'Jerk', kind: 'range', expectedTitle: 'Jerk (mm/s)' },
  { id: 'ActualVolumetricFlowRate', name: 'Actual flow rate', kind: 'range', expectedTitle: 'Actual Flow Rate (mm³/s)' },
  { id: 'LayerTimeLogarithmic', name: 'Layer time (log)', kind: 'range', expectedTitle: 'Layer Time (log)' },
  { id: 'PressureAdvance', name: 'Pressure advance', kind: 'range', expectedTitle: 'Pressure Advance' },
  { id: 'ColorPrint', name: 'Color print', kind: 'items', expectedTitle: 'Filament' },
  { id: 'Summary', name: 'Summary', kind: 'items', expectedTitle: 'Summary' }
];

async function runBrowserSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Running View Types Test Suite for ${browserName.toUpperCase()}`);
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
      return proc && !proc.disabled && Array.from(proc.options).some((o) => o.value.includes('0.20mm'));
    }, null, { timeout: 15000 });

    results.push({ name: 'Select Voron Preset', pass: true });

    // 3. Import 20mm_cube.obj and Slice
    console.log(`[${browserName}] Step 3: Importing 20mm_cube.obj and slicing...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled && !btn.textContent?.includes('Slicing');
    }, null, { timeout: 20000 });

    await page.click('#slice-btn');

    // 4. Wait for Slicing Completion & Switch to Preview Screen
    console.log(`[${browserName}] Step 4: Waiting for slice completion & Preview switch...`);
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#canvas');
      const previewStats = window.previewStats;
      return canvas !== null && previewStats && previewStats.layers > 0;
    }, null, { timeout: 60000 });

    const stats = await page.evaluate(() => window.previewStats);
    console.log(`[${browserName}] Preview loaded: ${stats.layers} layers, ${stats.moves} moves`);
    results.push({ name: 'Slicing & Auto-Switch to Preview', pass: true });

    // Verify all 17 view types exist in dropdown
    const selectOptions = await page.evaluate(() => {
      const sel = document.getElementById('view-type-select');
      return sel ? Array.from(sel.options).map((o) => ({ value: o.value, text: o.text })) : [];
    });
    console.log(`[${browserName}] Total view types in select dropdown: ${selectOptions.length}`);
    if (selectOptions.length < 17) {
      throw new Error(`Expected at least 17 view types in select dropdown, got ${selectOptions.length}`);
    }
    results.push({ name: 'Dropdown Exposes All 17 View Types', pass: true });

    // 5. Capture Baseline Canvas ImageData (FeatureType view)
    console.log(`[${browserName}] Step 5: Capturing baseline canvas image (FeatureType)...`);
    const baselineInfo = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas');
      if (!canvas) return null;
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx2 = c2.getContext('2d');
      ctx2.drawImage(canvas, 0, 0);
      const img = ctx2.getImageData(0, 0, c2.width, c2.height);
      const data = img.data;

      let nonBgCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (Math.abs(r - 30) > 8 || Math.abs(g - 30) > 8 || Math.abs(b - 36) > 8) {
          nonBgCount++;
        }
      }
      return { nonBgCount, width: canvas.width, height: canvas.height };
    });

    if (!baselineInfo || baselineInfo.nonBgCount === 0) {
      throw new Error('Default FeatureType canvas is empty or blank!');
    }
    console.log(`[${browserName}] Baseline canvas non-bg pixels: ${baselineInfo.nonBgCount}`);

    // Helper to get pixel diff between current canvas and FeatureType
    // We store the baseline pixel buffer in window.__baselinePixels
    await page.evaluate(() => {
      const canvas = document.querySelector('#canvas');
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx2 = c2.getContext('2d');
      ctx2.drawImage(canvas, 0, 0);
      window.__baselinePixels = ctx2.getImageData(0, 0, c2.width, c2.height).data;
    });

    // 6. Test each newly exposed view type
    for (const vt of NEW_VIEW_TYPES) {
      console.log(`\n[${browserName}] Testing view type: ${vt.id} (${vt.name})...`);

      // Switch view type
      await page.selectOption('#view-type-select', vt.id);

      // Wait for store viewType and legend to update
      await page.waitForFunction(
        (targetId) => {
          const store = window.__previewStore?.getState?.();
          return store && store.viewType === targetId;
        },
        vt.id,
        { timeout: 10000 }
      );

      // Small delay to ensure render call completed on WebGL context
      await page.waitForTimeout(200);

      // Inspect legend state and canvas diff
      const checkResult = await page.evaluate((target) => {
        const store = window.__previewStore?.getState?.();
        const legend = store?.legend || {};

        let hasData = false;
        let dataCount = 0;
        let details = {};

        if (target.kind === 'range') {
          hasData = Array.isArray(legend.ranges) && legend.ranges.length > 0;
          dataCount = legend.ranges ? legend.ranges.length : 0;
          details = {
            rangesCount: dataCount,
            firstVal: legend.ranges?.[0]?.value,
            lastVal: legend.ranges?.[legend.ranges.length - 1]?.value
          };
        } else {
          hasData = Array.isArray(legend.items) && legend.items.length > 0;
          dataCount = legend.items ? legend.items.length : 0;
          details = {
            itemsCount: dataCount,
            items: legend.items?.map((it) => it.name)
          };
        }

        // Compare canvas with baseline
        const canvas = document.querySelector('#canvas');
        const c2 = document.createElement('canvas');
        c2.width = canvas.width;
        c2.height = canvas.height;
        const ctx2 = c2.getContext('2d');
        ctx2.drawImage(canvas, 0, 0);
        const currData = ctx2.getImageData(0, 0, c2.width, c2.height).data;
        const baseData = window.__baselinePixels;

        let diffPixels = 0;
        let nonBgCount = 0;
        for (let i = 0; i < currData.length; i += 4) {
          const r = currData[i], g = currData[i + 1], b = currData[i + 2];
          if (Math.abs(r - 30) > 8 || Math.abs(g - 30) > 8 || Math.abs(b - 36) > 8) {
            nonBgCount++;
          }
          if (
            Math.abs(currData[i] - baseData[i]) > 8 ||
            Math.abs(currData[i + 1] - baseData[i + 1]) > 8 ||
            Math.abs(currData[i + 2] - baseData[i + 2]) > 8
          ) {
            diffPixels++;
          }
        }

        // Check DOM elements in legend
        const legendTitleEl = document.getElementById('legend-title');
        const legendTitle = legendTitleEl ? legendTitleEl.textContent?.trim() : '';
        const rangesListEl = document.getElementById('legend-ranges-list');
        const rangesDomCount = rangesListEl ? rangesListEl.children.length : 0;
        const itemRows = document.querySelectorAll('.legend-row:not(.option-row)');
        const itemsDomCount = itemRows.length;

        return {
          viewType: store?.viewType,
          legendTitle,
          legendType: legend.type,
          hasData,
          dataCount,
          details,
          nonBgCount,
          diffPixels,
          rangesDomCount,
          itemsDomCount
        };
      }, vt);

      console.log(`[${browserName}] ${vt.id} result:`, JSON.stringify(checkResult));

      // Assertions
      if (checkResult.viewType !== vt.id) {
        throw new Error(`Expected store.viewType === '${vt.id}', got '${checkResult.viewType}'`);
      }
      if (!checkResult.hasData || checkResult.dataCount === 0) {
        throw new Error(`Legend for '${vt.id}' has empty ${vt.kind}! Data count: ${checkResult.dataCount}`);
      }
      if (checkResult.nonBgCount === 0) {
        throw new Error(`Canvas is blank in '${vt.id}' view!`);
      }
      if (checkResult.diffPixels <= 500) {
        throw new Error(
          `Canvas did not change vs FeatureType in '${vt.id}' view! diffPixels: ${checkResult.diffPixels}`
        );
      }

      // Check DOM representation
      if (vt.kind === 'range' && checkResult.rangesDomCount === 0) {
        throw new Error(`DOM range elements missing for '${vt.id}'!`);
      }
      if (vt.kind === 'items' && checkResult.itemsDomCount === 0) {
        throw new Error(`DOM item elements missing for '${vt.id}'!`);
      }

      results.push({
        name: `View Type '${vt.id}': Non-Empty Legend (${checkResult.dataCount} ${vt.kind}) & Canvas Altered (${checkResult.diffPixels} px)`,
        pass: true
      });
    }

    // Switch back to FeatureType and verify it restores
    console.log(`\n[${browserName}] Restoring default view (FeatureType)...`);
    await page.selectOption('#view-type-select', 'FeatureType');
    await page.waitForFunction(() => {
      const store = window.__previewStore?.getState?.();
      return store && store.viewType === 'FeatureType';
    });
    results.push({ name: 'Restore FeatureType Default View', pass: true });

    // Save verification screenshot
    const screenshotPath = path.resolve(SCREENSHOT_DIR, `viewtypes-${browserName}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`[${browserName}] Saved viewtypes screenshot to ${screenshotPath}`);

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
  console.log('OrcaSlicer Web View Types Test Suite');
  console.log(`Target: Vite Preview on Port ${PORT}`);
  console.log('================================================================================\n');

  let allPass = true;
  const suiteResults = [];

  try {
    await startServer(PORT, 'viewtypes');

    for (const [bType, bName] of [
      [chromium, 'chromium'],
      [firefox, 'firefox']
    ]) {
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
  console.log('VIEW TYPES TEST EXECUTION SUMMARY');
  console.log('================================================================================');
  for (const { browserName, results, pass } of suiteResults) {
    console.log(`\nBrowser: ${browserName.toUpperCase()} [${pass ? 'PASS' : 'FAIL'}]`);
    for (const r of results) {
      console.log(`  - ${r.name.padEnd(70)}: ${r.pass ? 'PASS' : 'FAIL'}`);
    }
  }
  console.log('================================================================================');

  if (!allPass) {
    console.error('\nOne or more browser suites failed!');
    process.exit(1);
  }
  console.log('\nAll view types tests passed successfully!');
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
