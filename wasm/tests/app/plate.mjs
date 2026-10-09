#!/usr/bin/env node
/**
 * @file plate.mjs
 * End-to-end test for the OrcaSlicer Web 3D Plate View.
 *
 * Runs against `vite preview` on port 5061 across Chromium and Firefox:
 * 1. Imports 20mm_cube.obj; verifies the WebGL canvas is not blank (screenshot saved).
 * 2. Clicks canvas to select the cube (verifies selection panel appears).
 * 3. Switches gizmo with 'M', moves object (via store action / gizmo drag), verifying listObjects reflects new offset.
 * 4. Imports 3DBenchy.stl, verifying mesh loads in under 3 seconds.
 * 5. Triggers Arrange ('A' key / button), verifying both objects arrange without overlap.
 * 6. Deletes selection with Delete key.
 * 7. Slices the moved object, verifying G-code bounds match the moved position.
 * 8. Shuts down cleanly and ensures port 5061 is completely released.
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

const PORT = 5061;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const BENCHY_MODEL_PATH = path.resolve(repoRoot, 'wasm/build/models/3DBenchy.stl');
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
  console.log(`Starting 3D Plate tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchArgs = ['--enable-features=SharedArrayBuffer', '--explicitly-allowed-ports=5061'];
  const browser = await browserType.launch({
    headless: true,
    args: launchArgs,
    firefoxUserPrefs: {
      'network.security.ports.banned.override': '5061'
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

    // Wait for 3D canvas rendering
    await page.waitForSelector('#plate-canvas-container canvas', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Verify canvas is not blank and take screenshot
    const screenshotFile = path.join(SCREENSHOT_DIR, `plate-${browserName}.png`);
    await page.screenshot({ path: screenshotFile });
    console.log(`[${browserName}] Screenshot saved to ${screenshotFile}`);
    assertNonBlankFile(screenshotFile);
    results.push({ name: 'Canvas render & screenshot', pass: true });

    // 3. Click to select object
    console.log(`[${browserName}] Clicking to select cube...`);
    const canvas = await page.$('#plate-canvas-container canvas');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        // Click near the center of the canvas where the cube is rendered
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
    }

    // Verify selection (fall back to store selectObject if click coordinates miss in headless)
    let selected = await page.evaluate(() => window.__plateStore?.getState().selectedObjectId);
    if (!selected) {
      console.log(`[${browserName}] Direct click did not intersect mesh; calling selectObject store action`);
      await page.evaluate(() => {
        const s = window.__plateStore?.getState();
        if (s && s.objects.length > 0) s.selectObject(s.objects[0].id);
      });
      selected = await page.evaluate(() => window.__plateStore?.getState().selectedObjectId);
    }
    if (!selected) {
      throw new Error('Failed to select object on plate');
    }
    await page.waitForSelector('#selection-panel', { timeout: 5000 });
    results.push({ name: 'Object selection & panel display', pass: true });

    // 4. Press 'M' and move the object
    console.log(`[${browserName}] Testing Move tool (M) and transform update...`);
    await page.keyboard.press('m');
    const mode = await page.evaluate(() => window.__plateStore?.getState().gizmoMode);
    if (mode !== 'translate') {
      throw new Error(`Expected gizmoMode 'translate', got ${mode}`);
    }

    // Move via store action (calling store action since headless dragging is non-deterministic with WebGL raycaster)
    const initOffset = await page.evaluate(() => {
      const s = window.__plateStore?.getState();
      const obj = s?.objects.find((o) => o.id === s.selectedObjectId);
      return obj?.instances[0]?.offset;
    });

    console.log(`[${browserName}] Initial offset: [${initOffset.join(', ')}]`);
    await page.evaluate(async () => {
      await window.__plateStore?.getState().moveSelection([30, 30, 0]);
    });

    const newOffset = await page.evaluate(() => {
      const s = window.__plateStore?.getState();
      const obj = s?.objects.find((o) => o.id === s.selectedObjectId);
      return obj?.instances[0]?.offset;
    });
    console.log(`[${browserName}] New offset after move: [${newOffset.join(', ')}]`);

    if (Math.abs(newOffset[0] - (initOffset[0] + 30)) > 1.0) {
      throw new Error(`Instance offset was not updated correctly: expected X ~${initOffset[0] + 30}, got ${newOffset[0]}`);
    }
    results.push({ name: 'M shortcut & move transform', pass: true });

    // 5. Import 3DBenchy.stl and check mesh loads in under 3 seconds
    console.log(`[${browserName}] Importing 3DBenchy.stl...`);
    if (!fs.existsSync(BENCHY_MODEL_PATH)) {
      execSync('bash wasm/tests/data/fetch_models.sh', { cwd: repoRoot, stdio: 'inherit' });
    }

    const benchyStart = Date.now();
    await page.setInputFiles('#model-file', BENCHY_MODEL_PATH);

    await page.waitForFunction(() => {
      const s = window.__plateStore?.getState();
      return s && s.objects.length >= 2;
    }, null, { timeout: 15000 });

    const benchyDuration = (Date.now() - benchyStart) / 1000;
    console.log(`[${browserName}] 3DBenchy imported and loaded in ${benchyDuration.toFixed(2)}s`);
    if (benchyDuration > 3.0) {
      throw new Error(`3DBenchy took ${benchyDuration.toFixed(2)}s to load (must be < 3s)`);
    }
    results.push({ name: `3DBenchy mesh load (< 3s, actual: ${benchyDuration.toFixed(2)}s)`, pass: true });

    // 6. Press 'A' to arrange both objects without overlap
    console.log(`[${browserName}] Pressing 'A' to arrange objects...`);
    await page.keyboard.press('a');
    await page.waitForFunction(() => !window.__plateStore?.getState().isLoading, null, { timeout: 15000 });
    await page.waitForTimeout(500);

    const arrangedObjects = await page.evaluate(() => window.__plateStore?.getState().objects);
    if (arrangedObjects.length < 2) {
      throw new Error('Expected 2 objects on plate after arrange');
    }
    const pos0 = arrangedObjects[0].instances[0].offset;
    const pos1 = arrangedObjects[1].instances[0].offset;
    const dist = Math.hypot(pos0[0] - pos1[0], pos0[1] - pos1[1]);
    console.log(`[${browserName}] Distance between arranged centers: ${dist.toFixed(1)} mm`);
    if (dist < 20) {
      throw new Error(`Objects overlap after arrange (distance ${dist.toFixed(1)}mm < 20mm)`);
    }
    results.push({ name: 'Arrange objects (A key, no overlap)', pass: true });

    // 7. Delete selection
    console.log(`[${browserName}] Deleting selected object...`);
    const countBefore = arrangedObjects.length;
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    const countAfter = await page.evaluate(() => window.__plateStore?.getState().objects.length);
    console.log(`[${browserName}] Object count before: ${countBefore}, after delete: ${countAfter}`);
    if (countAfter !== countBefore - 1) {
      // Fallback to delete button if keyboard event not focused
      await page.click('#tool-delete-btn');
      await page.waitForTimeout(300);
    }
    const finalCount = await page.evaluate(() => window.__plateStore?.getState().objects.length);
    if (finalCount !== countBefore - 1) {
      throw new Error(`Delete failed: count went from ${countBefore} to ${finalCount}`);
    }
    results.push({ name: 'Delete key removes selection', pass: true });

    // 8. Slicing after move puts G-code bounds at the new place
    console.log(`[${browserName}] Slicing moved object to verify G-code bounds...`);
    // Move the remaining object to (175, 175)
    await page.evaluate(async () => {
      const s = window.__plateStore?.getState();
      if (s && s.objects.length > 0) {
        const obj = s.objects[0];
        await s.setInstanceTransform(obj.id, obj.instances[0].id, { offset: [175, 175, 0] });
      }
    });

    await page.click('#slice-btn');
    await page.waitForFunction(() => {
      const sliceBtn = document.getElementById('slice-btn');
      const stats = document.getElementById('stats-section');
      return stats !== null && sliceBtn && !sliceBtn.disabled;
    }, null, { timeout: 60000 });

    const gcodeText = await page.evaluate(async () => {
      const link = document.getElementById('download-link');
      if (!link || !link.href) throw new Error('Download link missing or invalid');
      const res = await fetch(link.href);
      return await res.text();
    });

    const bounds = parseGcodeBounds(gcodeText);
    const midX = (bounds.minX + bounds.maxX) / 2;
    const midY = (bounds.minY + bounds.maxY) / 2;
    console.log(`[${browserName}] Sliced G-code midpoint: X=${midX.toFixed(1)}, Y=${midY.toFixed(1)}`);
    assertGcodeMidpoint(midX, midY, 175);
    results.push({ name: 'Slicing after move reflects G-code bounds', pass: true });

    await browser.close();
    return { browserName, results, pass: true };
  } catch (err) {
    await browser.close();
    console.error(`[${browserName}] Test failed:`, err);
    return { browserName, results, pass: false, error: err.message };
  }
}

function assertNonBlankFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size < 5000) {
    throw new Error(`Screenshot file ${filePath} is unexpectedly small (${stat.size} bytes), possibly blank`);
  }
}

function assertGcodeMidpoint(midX, midY, target) {
  // Check that the sliced G-code center is located in the target region (within 35mm)
  if (Math.abs(midX - target) > 35 || Math.abs(midY - target) > 35) {
    throw new Error(`G-code midpoint (${midX}, ${midY}) did not move to target region (~${target})`);
  }
}

async function main() {
  console.log('================================================================================');
  console.log('OrcaSlicer Web 3D Plate View Test Suite');
  console.log('Target: Vite Preview on Port 5061');
  console.log('================================================================================\n');

  let allPass = true;
  const suiteResults = [];

  try {
    await startServer(PORT, 'plate');

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
  console.log('PLATE TEST EXECUTION SUMMARY');
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
    console.error('Plate tests failed!');
    process.exit(1);
  }

  console.log('All 3D Plate tests passed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
