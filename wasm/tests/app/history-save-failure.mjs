#!/usr/bin/env node
/**
 * @file history-save-failure.mjs
 * Browser regression test for OrcaSlicer Web History Undo/Redo failure handling.
 *
 * Verifies:
 * 1. Concrete failure audit: when saveProject throws an error during a commit,
 *    historyStore must NOT create an invalid nonempty HistorySnapshot with
 *    filePath/slotId undefined.
 * 2. Slot consistency: freed future slots and the failed allocation slot are
 *    never retained or referenced by stale future metadata.
 * 3. Geometry & Undo truthfulness: the retained old Undo snapshot correctly
 *    preserves previous valid geometry. Clicking Undo successfully restores
 *    the native C++ engine geometry.
 * 4. No fabricated Redo / native false-success: canRedo is false, calling redo()
 *    returns false, and no false-success is reported.
 * 5. Subsequent valid operations succeed normally with real 3MF engine writes.
 *
 * Runs against isolated preview build on port 5217 across Chromium and Firefox sequentially.
 */

import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
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

const PORT = 5217;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserHistorySaveFailureSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting History Save Failure tests for ${browserName.toUpperCase()}`);
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

    page.on('console', (msg) => console.log(`[${browserName} console] ${msg.text()}`));
    page.on('pageerror', (err) => {
      console.error(`[${browserName}] Page error:`, err);
      pageErrors.push(err.message);
    });

    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    // Wait for engine presets to initialize
    await page.waitForFunction(() => {
      const v = document.getElementById('vendor-select');
      return v && v.options.length > 1;
    }, null, { timeout: 25000 });

    await page.selectOption('#vendor-select', 'Voron');
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

    // Initial engine geometry
    const initEngineObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    assert.ok(initEngineObjs.length >= 1, 'Object must be listed in C++ engine');
    const initOffset = initEngineObjs[0].instances[0].offset;
    console.log(`[${browserName}] Initial offset: [${initOffset.join(', ')}]`);

    // Select object
    const objectId = await page.evaluate(() => {
      const s = window.__plateStore?.getState();
      if (s && s.objects.length > 0) {
        s.selectObject(s.objects[0].id);
        return s.objects[0].id;
      }
      return null;
    });
    assert.ok(objectId, 'Object ID must be valid');

    // Verify initial snapshot after import
    const initialSnapState = await page.evaluate(() => {
      const h = window.__historyStore.getState();
      return {
        canUndo: h.canUndo,
        canRedo: h.canRedo,
        pastLength: h.past.length,
        currentSlot: h.currentSnapshot?.slotId,
        currentFilePath: h.currentSnapshot?.filePath,
        currentIsEmpty: h.currentSnapshot?.isEmpty
      };
    });
    console.log(`[${browserName}] Initial snapshot state:`, JSON.stringify(initialSnapState));
    assert.equal(initialSnapState.currentIsEmpty, false, 'Imported model snapshot must not be empty');
    assert.ok(initialSnapState.currentFilePath !== undefined, 'Initial snapshot must have valid filePath');
    assert.ok(initialSnapState.currentSlot !== undefined, 'Initial snapshot must have valid slotId');

    // -------------------------------------------------------------------------
    // Step 1: Perform Move 1 (+10mm X) where saveProject succeeds
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] [Step 1] Performing successful Move 1 (+10mm X)...`);
    await page.evaluate(async () => {
      await window.__plateStore.getState().moveSelection([10, 0, 0]);
    });
    await page.waitForTimeout(300);

    const move1State = await page.evaluate(async () => {
      const objs = await window.__orcaEngine.listObjects();
      const h = window.__historyStore.getState();
      return {
        offset: objs[0].instances[0].offset,
        canUndo: h.canUndo,
        canRedo: h.canRedo,
        pastLength: h.past.length,
        currentSlot: h.currentSnapshot?.slotId,
        currentFilePath: h.currentSnapshot?.filePath
      };
    });

    const expectedMove1X = initOffset[0] + 10;
    assert.ok(
      Math.abs(move1State.offset[0] - expectedMove1X) < 0.1,
      `Move 1 geometry mismatch. Expected X: ${expectedMove1X}, got ${move1State.offset[0]}`
    );
    assert.equal(move1State.canUndo, true, 'canUndo must be true after Move 1');
    assert.equal(move1State.canRedo, false, 'canRedo must be false');
    assert.ok(move1State.currentSlot !== undefined, 'Move 1 must have valid slotId');
    assert.ok(move1State.currentFilePath !== undefined, 'Move 1 must have valid filePath');
    console.log(`[${browserName}] Move 1 verified: X=${move1State.offset[0].toFixed(2)}, slot=${move1State.currentSlot}`);

    // -------------------------------------------------------------------------
    // Step 2: Inject ONE deliberate saveProject failure on Move 2 (+10mm X)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] [Step 2] Injecting ONE deliberate saveProject throw on Move 2...`);
    await page.evaluate(() => {
      const engine = window.__orcaEngine;
      window.__injectedFailure = {
        fired: false,
        method: null,
        path: null
      };
      const origCall = engine.call.bind(engine);
      engine.call = async function (method, args) {
        if (method === 'saveProject' && !window.__injectedFailure.fired) {
          window.__injectedFailure.fired = true;
          window.__injectedFailure.method = method;
          window.__injectedFailure.path = args?.path;
          console.warn(`[InjectedFailure] Deliberately throwing error during saveProject for path: ${args?.path}`);
          throw new Error(`Injected deliberate disk failure during saveProject for ${args?.path}`);
        }
        return await origCall(method, args);
      };
    });

    // Execute Move 2
    await page.evaluate(async () => {
      await window.__plateStore.getState().moveSelection([10, 0, 0]);
    });
    await page.waitForTimeout(300);

    // Verify deliberate injection fired and inspect history state
    const afterFailureState = await page.evaluate(async () => {
      const objs = await window.__orcaEngine.listObjects();
      const h = window.__historyStore.getState();
      const items = [...h.past, h.currentSnapshot].filter(Boolean);
      const slots = items.filter((s) => s.slotId !== undefined).map((s) => s.slotId);

      // Check for any broken snapshot with missing filePath on nonempty snapshot
      const invalidSnapshots = items.filter((s) => !s.isEmpty && !s.filePath);

      return {
        injectionFired: window.__injectedFailure.fired,
        failedPath: window.__injectedFailure.path,
        engineOffset: objs[0].instances[0].offset,
        currentSnapshot: h.currentSnapshot,
        pastLength: h.past.length,
        futureLength: h.future.length,
        canUndo: h.canUndo,
        canRedo: h.canRedo,
        retainedSlots: slots,
        invalidSnapshotsCount: invalidSnapshots.length,
        topPastSlot: h.past[h.past.length - 1]?.slotId,
        topPastFilePath: h.past[h.past.length - 1]?.filePath
      };
    });

    console.log(`[${browserName}] Failure state inspection:`, {
      injectionFired: afterFailureState.injectionFired,
      failedPath: afterFailureState.failedPath,
      currentSnapshot: afterFailureState.currentSnapshot,
      pastLength: afterFailureState.pastLength,
      canUndo: afterFailureState.canUndo,
      canRedo: afterFailureState.canRedo,
      retainedSlots: afterFailureState.retainedSlots,
      invalidSnapshotsCount: afterFailureState.invalidSnapshotsCount
    });

    assert.equal(afterFailureState.injectionFired, true, 'Deliberate saveProject failure must have fired');
    await page.waitForSelector('#error-message');
    assert.match(await page.locator('#error-message').textContent(), /Could not save Undo snapshot:.*Injected deliberate disk failure/);
    const expectedFailedX = initOffset[0] + 20;
    assert.ok(
      Math.abs(afterFailureState.engineOffset[0] - expectedFailedX) < 0.1,
      `Engine offset should reflect native transform: expected ${expectedFailedX}, got ${afterFailureState.engineOffset[0]}`
    );

    // 1. Audit check: NO nonempty snapshot with undefined filePath/slotId created
    assert.equal(
      afterFailureState.invalidSnapshotsCount,
      0,
      'History must never contain a nonempty snapshot with undefined filePath or slotId'
    );
    assert.equal(
      afterFailureState.currentSnapshot,
      null,
      'currentSnapshot must be null when saveProject fails (never fabricated)'
    );

    // 2. Redo stack consistency: NO invalid redo fabricated
    assert.equal(afterFailureState.canRedo, false, 'canRedo must be false after failed save');
    assert.equal(afterFailureState.futureLength, 0, 'future stack must be empty');

    // Verify redo() call truthfully reports false (no native false-success)
    const redoAttemptResult = await page.evaluate(async () => {
      return await window.__historyStore.getState().redo();
    });
    assert.equal(redoAttemptResult, false, 'redo() must return false when no valid redo snapshot exists');

    // Verify DOM redo button is disabled
    const isRedoDisabled = await page.evaluate(() => {
      const btn = document.getElementById('tool-redo-btn');
      return btn ? btn.hasAttribute('disabled') || btn.getAttribute('data-can-redo') === 'false' : true;
    });
    assert.equal(isRedoDisabled, true, '#tool-redo-btn must be disabled in DOM');

    // 3. Undo stack consistency: retained old Undo snapshot is available
    assert.equal(afterFailureState.canUndo, true, 'canUndo must remain true to allow reverting to prior valid geometry');
    assert.ok(afterFailureState.pastLength >= 1, 'past stack must retain prior valid snapshots');
    assert.ok(afterFailureState.topPastFilePath !== undefined, 'Top of past must have valid filePath');
    assert.ok(afterFailureState.topPastSlot !== undefined, 'Top of past must have valid slotId');

    // Check slot uniqueness
    const uniqueSlots = new Set(afterFailureState.retainedSlots);
    assert.equal(
      uniqueSlots.size,
      afterFailureState.retainedSlots.length,
      'All retained slots must be unique and consistent'
    );

    // -------------------------------------------------------------------------
    // Step 3: Undo restores the retained old geometry (reverting failed move)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] [Step 3] Clicking Undo to restore retained old geometry...`);
    await page.click('#tool-undo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const undoneState = await page.evaluate(async () => {
      const objs = await window.__orcaEngine.listObjects();
      const h = window.__historyStore.getState();
      return {
        offset: objs[0].instances[0].offset,
        canUndo: h.canUndo,
        canRedo: h.canRedo,
        futureLength: h.future.length,
        currentSlot: h.currentSnapshot?.slotId,
        currentFilePath: h.currentSnapshot?.filePath
      };
    });

    console.log(`[${browserName}] Undone geometry: X=${undoneState.offset[0].toFixed(2)}, canRedo=${undoneState.canRedo}`);
    assert.ok(
      Math.abs(undoneState.offset[0] - expectedMove1X) < 0.1,
      `Undo must restore exact retained old geometry (Move 1). Expected X: ${expectedMove1X}, got ${undoneState.offset[0]}`
    );
    assert.equal(
      undoneState.canRedo,
      false,
      'canRedo must remain false (failed transaction must NOT be placed into future stack)'
    );
    assert.equal(undoneState.futureLength, 0, 'future stack must remain empty after undoing uncommitted edit');

    // -------------------------------------------------------------------------
    // Step 4: Subsequent valid edit (Move 3: +15mm Y) succeeds normally
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] [Step 4] Performing subsequent Move 3 (+15mm Y) which must succeed...`);
    await page.evaluate(async () => {
      await window.__plateStore.getState().moveSelection([0, 15, 0]);
    });
    await page.waitForTimeout(300);

    const move3State = await page.evaluate(async () => {
      const objs = await window.__orcaEngine.listObjects();
      const h = window.__historyStore.getState();
      return {
        offset: objs[0].instances[0].offset,
        canUndo: h.canUndo,
        canRedo: h.canRedo,
        currentSlot: h.currentSnapshot?.slotId,
        currentFilePath: h.currentSnapshot?.filePath
      };
    });

    const expectedMove3Y = initOffset[1] + 15;
    assert.ok(
      Math.abs(move3State.offset[0] - expectedMove1X) < 0.1,
      `Move 3 X should remain unchanged: ${expectedMove1X}`
    );
    assert.ok(
      Math.abs(move3State.offset[1] - expectedMove3Y) < 0.1,
      `Move 3 Y should be ${expectedMove3Y}, got ${move3State.offset[1]}`
    );
    assert.equal(move3State.canUndo, true, 'canUndo must be true');
    assert.equal(move3State.canRedo, false, 'canRedo must be false');
    assert.ok(move3State.currentSlot !== undefined, 'Move 3 snapshot must have valid slotId');
    assert.ok(move3State.currentFilePath !== undefined, 'Move 3 snapshot must have valid filePath');
    console.log(`[${browserName}] Move 3 verified: Y=${move3State.offset[1].toFixed(2)}, slot=${move3State.currentSlot}`);

    // Test Undo of Move 3
    console.log(`[${browserName}] Undoing Move 3...`);
    await page.click('#tool-undo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const postUndo3Offset = await page.evaluate(async () => {
      const objs = await window.__orcaEngine.listObjects();
      return objs[0].instances[0].offset;
    });
    assert.ok(
      Math.abs(postUndo3Offset[1] - initOffset[1]) < 0.1,
      `Undo Move 3 must restore Y back to ${initOffset[1]}, got ${postUndo3Offset[1]}`
    );

    // Test Redo of Move 3 (now valid because Move 3 was a successful save)
    console.log(`[${browserName}] Redoing Move 3...`);
    await page.click('#tool-redo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const postRedo3Offset = await page.evaluate(async () => {
      const objs = await window.__orcaEngine.listObjects();
      return objs[0].instances[0].offset;
    });
    assert.ok(
      Math.abs(postRedo3Offset[1] - expectedMove3Y) < 0.1,
      `Redo Move 3 must restore Y back to ${expectedMove3Y}, got ${postRedo3Offset[1]}`
    );
    console.log(`[${browserName}] Redo Move 3 successfully verified: Y=${postRedo3Offset[1].toFixed(2)}`);

    results.push({ name: 'History Save Failure and Recovery Check', pass: true });
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
      return;
    } catch (e) {
      if (e.message.includes('older than the source files')) {
        console.warn(`[Server] Build freshness race detected (attempt ${i + 1}/${maxRetries}). Retrying in 2 seconds...`);
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        throw e;
      }
    }
  }
  throw new Error(`Failed to start server after ${maxRetries} retries due to freshness check.`);
}

async function main() {
  try {
    await startServerWithRetry(PORT, 'history-save-failure');

    console.log('\nRunning Chromium suite...');
    const chromResults = await runBrowserHistorySaveFailureSuite(chromium, 'chromium');

    console.log('\nRunning Firefox suite...');
    const ffResults = await runBrowserHistorySaveFailureSuite(firefox, 'firefox');

    console.log('\n==================================================');
    console.log('SUMMARY OF RESULTS');
    console.log('==================================================');
    for (const r of chromResults) {
      console.log(`  [Chromium] ${r.name}: PASS`);
    }
    for (const r of ffResults) {
      console.log(`  [Firefox]  ${r.name}: PASS`);
    }
    console.log('\nAll history save failure checks PASSED across Chromium and Firefox.');
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nTest failed with error:', err);
  process.exit(1);
});
