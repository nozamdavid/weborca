#!/usr/bin/env node
/**
 * @file history-capacity.mjs
 * Browser regression test for OrcaSlicer Web Model Editing Undo/Redo Capacity.
 */

import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = 5216;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserHistoryCapacitySuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting History Capacity tests for ${browserName.toUpperCase()}`);
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

    page.on("console", msg => console.log(`[${browserName} console] ${msg.text()}`));
    page.on('pageerror', (err) => {
      console.error(`[${browserName}] Page error:`, err);
      pageErrors.push(err.message);
    });

    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    // Wait for engine presets to initialize

    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    console.log(`[${browserName}] Importing 20mm_cube.obj...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1 && window.__orcaEngine !== undefined;
    }, null, { timeout: 15000 });

    await page.waitForSelector('#plate-canvas-container canvas', { timeout: 10000 });
    await page.waitForTimeout(500);

    const initEngineObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    // Select object
    let objectId = await page.evaluate(() => {
      const s = window.__plateStore?.getState();
      if (s && s.objects.length > 0) {
        s.selectObject(s.objects[0].id);
        return s.objects[0].id;
      }
      return null;
    });
    assert.ok(objectId, "Object ID must be valid");

    const initOffset = initEngineObjs[0].instances[0].offset;
    console.log(`[${browserName}] Initial offset: [${initOffset.join(', ')}]`);

    // 1. Repeated 25~30 transform commits
    const TOTAL_STEPS = 26;
    console.log(`[${browserName}] Performing ${TOTAL_STEPS} sequential transforms...`);
    for (let i = 1; i <= TOTAL_STEPS; i++) {
       await page.evaluate(async () => {
         await window.__plateStore.getState().moveSelection([10, 0, 0]);
       });
       await page.waitForTimeout(150);
    }
    
    // 2. Assert all retained slotIds / filePaths unique
    const { retainedSlots, currentOffset } = await page.evaluate(async () => {
       const hState = window.__historyStore.getState();
       const items = [...hState.past, hState.currentSnapshot];
       const slots = items.filter(s => s && s.slotId !== undefined).map(s => s.slotId);
       
       const objs = await window.__orcaEngine.listObjects();
       return {
         retainedSlots: slots,
         currentOffset: objs[0].instances[0].offset
       };
    });

    console.log(`[${browserName}] Retained slots: ${retainedSlots.join(', ')}`);
    assert.ok(retainedSlots.length > 0 && retainedSlots.length <= 20, 'Retained slots count must be within 1 and 20');
    const uniqueSlots = new Set(retainedSlots);
    assert.equal(uniqueSlots.size, retainedSlots.length, 'All retained slots must be unique, preventing allocator collision');

    // Verify current expected position
    const expectedCurrentX = initOffset[0] + 10 * TOTAL_STEPS;
    assert.ok(
      Math.abs(currentOffset[0] - expectedCurrentX) < 0.1, 
      `Current geometry mismatch. Expected X: ${expectedCurrentX}, got ${currentOffset[0]}`
    );
    console.log(`[${browserName}] Current geometry verified: X=${currentOffset[0].toFixed(2)}`);

    // 3. Undo past snapshots to check each expected position
    // Max retained snapshots is 20 (including current), so 19 undos possible.
    const UNDO_STEPS = 10;
    console.log(`[${browserName}] Undoing ${UNDO_STEPS} times...`);
    for (let i = 0; i < UNDO_STEPS; i++) {
        await page.click('#tool-undo-btn');
        await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
        await page.waitForTimeout(150);
    }
    
    const undoneOffset = await page.evaluate(async () => {
        const objs = await window.__orcaEngine.listObjects();
        return objs[0].instances[0].offset;
    });

    const expectedIntermediateX = initOffset[0] + 10 * (TOTAL_STEPS - UNDO_STEPS);
    assert.ok(
      Math.abs(undoneOffset[0] - expectedIntermediateX) < 0.1, 
      `Geometry after ${UNDO_STEPS} undos mismatch. Expected X: ${expectedIntermediateX}, got ${undoneOffset[0]}`
    );
    console.log(`[${browserName}] Intermediate geometry verified: X=${undoneOffset[0].toFixed(2)}`);

    // 4. Edit after Undo (creates new branch, clears future stack)
    console.log(`[${browserName}] Performing edit-after-undo to branch...`);
    await page.evaluate(async () => {
       await window.__plateStore.getState().moveSelection([0, 20, 0]);
    });
    await page.waitForTimeout(300);

    const branchedOffset = await page.evaluate(async () => {
        const objs = await window.__orcaEngine.listObjects();
        return objs[0].instances[0].offset;
    });

    assert.ok(Math.abs(branchedOffset[0] - expectedIntermediateX) < 0.1, 'Branched X should be identical to intermediate');
    assert.ok(Math.abs(branchedOffset[1] - (initOffset[1] + 20)) < 0.1, 'Branched Y should be +20');
    console.log(`[${browserName}] Branched geometry verified: X=${branchedOffset[0].toFixed(2)}, Y=${branchedOffset[1].toFixed(2)}`);

    // 5. Assert redo discarded (future stack cleared)
    const canRedoAfterBranch = await page.evaluate(() => window.__historyStore.getState().canRedo);
    assert.equal(canRedoAfterBranch, false, 'canRedo must be false after branching');
    const futureLength = await page.evaluate(() => window.__historyStore.getState().future.length);
    assert.equal(futureLength, 0, 'Future stack must be empty after branching');

    // 6. Assert Undo restores exact expected prior geometry
    console.log(`[${browserName}] Undoing the new branch edit...`);
    await page.click('#tool-undo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(150);

    const restoredOffset = await page.evaluate(async () => {
        const objs = await window.__orcaEngine.listObjects();
        return objs[0].instances[0].offset;
    });

    assert.ok(Math.abs(restoredOffset[0] - expectedIntermediateX) < 0.1, 'Undo new branch X should restore');
    assert.ok(Math.abs(restoredOffset[1] - initOffset[1]) < 0.1, 'Undo new branch Y should restore');
    console.log(`[${browserName}] Pre-branch geometry successfully restored`);

    // 7. Assert new branch Redo is correct
    console.log(`[${browserName}] Redoing the new branch edit...`);
    await page.click('#tool-redo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(150);

    const reRedoneOffset = await page.evaluate(async () => {
        const objs = await window.__orcaEngine.listObjects();
        return objs[0].instances[0].offset;
    });

    assert.ok(Math.abs(reRedoneOffset[0] - expectedIntermediateX) < 0.1, 'Redo new branch X should match branched geometry');
    assert.ok(Math.abs(reRedoneOffset[1] - (initOffset[1] + 20)) < 0.1, 'Redo new branch Y should match branched geometry');
    console.log(`[${browserName}] Branch redo geometry verified`);

    results.push({ name: 'History Capacity and Branching Check', pass: true });
    console.log(`\nAll checks passed for ${browserName}!`);
  } finally {
    await browser.close();
  }

  assert.equal(pageErrors.length, 0, `Page errors encountered during ${browserName} test: ${pageErrors.join('; ')}`);
  return results;
}

async function startServerWithRetry(port, name, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await startServer(port, name, { frozenDist: process.env.HISTORY_FROZEN_DIST === '1' });
      return; // Success
    } catch (e) {
      if (e.message.includes('older than the source files')) {
        console.warn(`[Server] Build freshness race detected (attempt ${i + 1}/${maxRetries}). Retrying in 2 seconds...`);
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw e;
      }
    }
  }
  throw new Error(`Failed to start server after ${maxRetries} retries due to freshness check.`);
}

async function main() {
  try {
    await startServerWithRetry(PORT, 'history-capacity');

    console.log('\nRunning Chromium suite...');
    const chromResults = await runBrowserHistoryCapacitySuite(chromium, 'chromium');

    console.log('\nRunning Firefox suite...');
    const ffResults = await runBrowserHistoryCapacitySuite(firefox, 'firefox');

    console.log('\n==================================================');
    console.log('SUMMARY OF RESULTS');
    console.log('==================================================');
    for (const r of chromResults) {
      console.log(`  [Chromium] ${r.name}: PASS`);
    }
    for (const r of ffResults) {
      console.log(`  [Firefox]  ${r.name}: PASS`);
    }
    console.log('\nAll history capacity checks PASSED across Chromium and Firefox.');
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nTest failed with error:', err);
  process.exit(1);
});
