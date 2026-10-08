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

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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

async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(BASE_URL, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let serverProcess = null;

async function startServer() {
  if (await isServerRunning()) {
    throw new Error(`Port ${PORT} is occupied by an unrelated server; failing per test isolation requirements`);
  }

  const previewArgs = ['vite', 'preview'];
  if (process.env.APP_TEST_DIST) {
    previewArgs.push('--outDir', process.env.APP_TEST_DIST);
  }
  previewArgs.push('--port', String(PORT), '--host', '127.0.0.1');

  console.log(`[Server] Launching 'vite preview' on port ${PORT}...`);
  serverProcess = spawn('npx', previewArgs, {
    cwd: path.resolve(repoRoot, 'wasm/app'),
    stdio: 'ignore',
    detached: true
  });

  const ready = await waitForServer();
  if (!ready) {
    throw new Error(`Server failed to respond on port ${PORT} within timeout`);
  }
  console.log(`[Server] Vite preview server ready at ${BASE_URL}`);
}

async function stopServer() {
  console.log(`[Server] Terminating server on port ${PORT}...`);
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGTERM');
    } catch (_) {
      try {
        process.kill(serverProcess.pid, 'SIGTERM');
      } catch (_) {}
    }
    serverProcess = null;
  }
  await new Promise((r) => setTimeout(r, 600));
}

process.on('exit', () => {
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch (_) {}
  }
});

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
    await startServer();

    await runBrowserSuite(chromium, 'chromium');
    await runBrowserSuite(firefox, 'firefox');

    console.log('\n================================================================================');
    console.log('All Multiple Plates browser tests passed successfully on Chromium and Firefox!');
    console.log('================================================================================\n');
  } finally {
    await stopServer();
  }
}

main().catch((err) => {
  console.error('\nMultiple Plates test suite failed:', err);
  stopServer().finally(() => process.exit(1));
});
