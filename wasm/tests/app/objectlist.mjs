#!/usr/bin/env node
/**
 * @file objectlist.mjs
 * End-to-end Playwright test for OrcaSlicer Web Object List & Modifiers.
 * Runs against vite preview on port 5063 (Chromium then Firefox).
 */

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
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

function countInnerWallMoves(gcode) {
  let inInner = false;
  let moves = 0;
  for (const line of gcode.split(String.fromCharCode(10))) {
    if (line.startsWith(';TYPE:')) {
      inInner = line === ';TYPE:Inner wall';
    } else if (inInner && line.startsWith('G1 ') && line.includes(' E')) {
      moves++;
    }
  }
  return moves;
}
const PORT = 5063;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Object List tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchArgs = ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`];
  const browser = await browserType.launch({
    headless: true,
    args: launchArgs,
    firefoxUserPrefs: {
      'network.security.ports.banned.override': String(PORT)
    }
  });

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error(`[${browserName}] Page error:`, err);
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

    // 2. Import cube
    console.log(`[${browserName}] Importing cube model...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    // Wait for object list to show cube
    console.log(`[${browserName}] Waiting for object tree to display cube...`);
    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    const objId = await page.evaluate(() => window.__objectListStore?.getState().objects[0].id);
    await page.waitForSelector(`#object-row-${objId}`, { timeout: 10000 });
    console.log(`[${browserName}] Cube displayed in tree with id ${objId}`);

    // 3. Add a modifier from context menu
    console.log(`[${browserName}] Adding cube modifier from context menu...`);
    // Open context menu via the more button
    await page.click(`#object-more-btn-${objId}`);
    await page.waitForSelector('#object-list-context-menu', { timeout: 5000 });

    // Hover Add Modifier
    await page.hover('#menu-item-modifier');
    await page.waitForSelector('#menu-action-modifier-cube', { timeout: 5000 });
    // Click Cube
    await page.click('#menu-action-modifier-cube');

    // Wait for modifier volume to appear in store and tree
    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      const obj = store?.objects[0];
      return obj && obj.volumes.some((v) => v.type === 'modifier');
    }, null, { timeout: 10000 });

    const modVolId = await page.evaluate(() => {
      const store = window.__objectListStore?.getState();
      const mod = store?.objects[0].volumes.find((v) => v.type === 'modifier');
      return mod?.id;
    });
    console.log(`[${browserName}] Modifier added with volumeId ${modVolId}`);
    await page.waitForSelector(`#volume-row-${modVolId}`, { timeout: 5000 });

    // 4. Set per-object override (e.g. wall_loops 4) in the object settings editor
    console.log(`[${browserName}] Setting per-object override: wall_loops 4...`);
    // Select object
    await page.click(`#object-row-${objId}`);
    await page.waitForSelector('#object-settings-editor', { timeout: 5000 });

    // Click + Add Setting button
    await page.click('#btn-add-setting');
    await page.waitForSelector('#add-setting-dropdown', { timeout: 5000 });

    // Click wall_loops option
    await page.click('#add-setting-opt-wall_loops');

    // Verify row appears and change value to 4
    await page.waitForSelector('#override-input-wall_loops', { timeout: 5000 });
    await page.fill('#override-input-wall_loops', '4');

    // Verify value saved in store
    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      return store?.objects[0]?.config?.wall_loops === '4';
    }, null, { timeout: 5000 });
    console.log(`[${browserName}] Per-object override wall_loops 4 verified in store`);

        // 5. Slice and verify G-code reflects wall_loops 4
    console.log(`[${browserName}] Slicing with override...`);
    await page.click('#slice-btn');

    // Wait for slicing completion & stats
    await page.waitForFunction(() => {
      const stats = document.getElementById('stats-section');
      const sliceBtn = document.getElementById('slice-btn');
      return stats !== null && sliceBtn && !sliceBtn.disabled;
    }, null, { timeout: 60000 });

    // Download and verify G-code reflects wall_loops 4
    const gcodeText = await page.evaluate(async () => {
      const link = document.getElementById('download-link');
      if (link && link.href) {
        const res = await fetch(link.href);
        return await res.text();
      }
      return '';
    });

    if (!gcodeText) {
      throw new Error(`[${browserName}] Failed to retrieve sliced G-code`);
    }

        const innerMoves = countInnerWallMoves(gcodeText);
    console.log(`[${browserName}] Sliced G-code length: ${gcodeText.length}, inner wall moves: ${innerMoves} (baseline 3 loops = 800)`);
    if (innerMoves <= 800) {
      throw new Error(`[${browserName}] Sliced G-code does not reflect wall_loops 4 override (inner wall moves: ${innerMoves}, expected > 800)`);
    }

// 6. Delete modifier
    console.log(`[${browserName}] Deleting modifier...`);
    // Switch back to Prepare tab
    await page.click('#tab-prepare');
    await page.waitForSelector(`#volume-row-${modVolId}`, { timeout: 5000 });

    // Open context menu for modifier volume
    await page.click(`#volume-more-btn-${modVolId}`);
    await page.waitForSelector('#menu-action-delete-volume', { timeout: 5000 });
    await page.click('#menu-action-delete-volume');

    // Verify modifier volume deleted
    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      const obj = store?.objects[0];
      return obj && !obj.volumes.some((v) => v.type === 'modifier');
    }, null, { timeout: 10000 });
    console.log(`[${browserName}] Modifier successfully deleted`);


    // 6a. Test Lock Orientation
    console.log(`[${browserName}] Testing Lock Orientation...`);
    await page.click(`#object-more-btn-${objId}`);
    await page.waitForSelector('#menu-action-lock-orientation', { timeout: 5000 });
    await page.locator('#menu-action-lock-orientation').scrollIntoViewIfNeeded();
    await page.click('#menu-action-lock-orientation');

    // 6b. Test Move Object
    console.log(`[${browserName}] Testing Move Object...`);
    await page.evaluate(async () => {
        const store = window.__objectListStore.getState();
        await store.moveObject(store.objects[0].id, 0); // Self-move should work
    });

    // 6c. Test Plate Arrange Scope
    console.log(`[${browserName}] Testing Plate Arrange Scope...`);
    await page.evaluate(async () => {
        const pstore = window.__plateStore.getState();
        pstore.setArrangeSettings({ plateScope: 'current' });
        await pstore.arrange(true);
    });

// 7. Save screenshot
    const screenshotPath = path.join(SCREENSHOT_DIR, `objectlist-${browserName}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`[${browserName}] Screenshot saved to ${screenshotPath}`);

    if (!fs.existsSync(screenshotPath) || fs.statSync(screenshotPath).size === 0) {
      throw new Error(`Screenshot file is empty: ${screenshotPath}`);
    }

    console.log(`[${browserName}] Test suite passed successfully!`);
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    await startServer(PORT, 'objectlist');

    // Run Chromium first, then Firefox
    await runBrowserSuite(chromium, 'chromium');
    await runBrowserSuite(firefox, 'firefox');

    console.log(`\nAll Object List browser tests passed!`);
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('[Error] Test suite failed:', err);
  process.exit(1);
});
