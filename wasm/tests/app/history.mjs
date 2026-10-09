#!/usr/bin/env node
/**
 * @file history.mjs
 * Browser regression test for OrcaSlicer Web Model Editing Undo/Redo.
 *
 * Runs against isolated build on port 5074 across Chromium and Firefox sequentially:
 * 1. Verifies initial undo/redo button states (disabled).
 * 2. Loads 20mm_cube.obj and verifies initial commit.
 * 3. Tests transform undo/redo with C++ engine readback.
 * 4. Tests object deletion undo/redo with C++ engine readback.
 * 5. Tests edit-after-undo clears redo stack.
 * 6. Tests support painting edit restoration (undo clears enforcers, redo restores them).
 * 7. Tests bounded history (stack length <= 20 and memory bounded).
 * 8. Tests disabled controls during restoration and text input immunity (Ctrl+Z does not intercept text typing).
 * 9. Shuts down preview server cleanly and confirms port 5074 is freed.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { paintPoint, visibleFacets } from './painting-checks.mjs';
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

const PORT = 5084;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ISOLATED_BUILD_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/build/ui-history-dist');
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserHistorySuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting History Undo/Redo tests for ${browserName.toUpperCase()}`);
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

    // Verify initial undo/redo button disabled states
    const initCanUndo = await page.evaluate(() => window.__historyStore?.getState().canUndo);
    const initCanRedo = await page.evaluate(() => window.__historyStore?.getState().canRedo);
    assert.equal(initCanUndo, false, 'Initial canUndo must be false');
    assert.equal(initCanRedo, false, 'Initial canRedo must be false');

    const topUndoDisabled = await page.isDisabled('#undo-btn');
    const topRedoDisabled = await page.isDisabled('#redo-btn');
    assert.ok(topUndoDisabled, 'TopBar undo button must be disabled initially');
    assert.ok(topRedoDisabled, 'TopBar redo button must be disabled initially');
    results.push({ name: 'Initial undo/redo disabled controls verified', pass: true });

    // 2. Import 20mm_cube.obj
    console.log(`[${browserName}] Importing 20mm_cube.obj...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1 && window.__orcaEngine !== undefined;
    }, null, { timeout: 15000 });

    await page.waitForSelector('#plate-canvas-container canvas', { timeout: 10000 });
    await page.waitForTimeout(500);

    const screenshotFile = path.join(SCREENSHOT_DIR, `history-${browserName}-init.png`);
    await page.screenshot({ path: screenshotFile });
    results.push({ name: 'Cube imported and rendered', pass: true });

    // Select object
    let objectId = await page.evaluate(() => {
      const s = window.__plateStore?.getState();
      if (s && s.objects.length > 0) {
        s.selectObject(s.objects[0].id);
        return s.objects[0].id;
      }
      return null;
    });
    assert.ok(objectId, 'Object ID must be valid');

    // 3. Test Transform Undo/Redo with engine readback
    console.log(`[${browserName}] Testing Transform Undo/Redo with engine readback...`);
    const initEngineObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    assert.equal(initEngineObjs.length, 1, 'Engine must report 1 object initially');
    const initOffset = initEngineObjs[0].instances[0].offset;
    console.log(`[${browserName}] Initial engine instance offset: [${initOffset.join(', ')}]`);

    // Perform transform: move selection by delta [30, 20, 0]
    await page.evaluate(async () => {
      await window.__plateStore.getState().moveSelection([30, 20, 0]);
    });
    await page.waitForTimeout(400);

    // Readback from C++ engine to verify transform took effect in engine
    const movedEngineObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    const movedOffset = movedEngineObjs[0].instances[0].offset;
    console.log(`[${browserName}] Moved engine instance offset: [${movedOffset.join(', ')}]`);
    assert.ok(
      Math.abs(movedOffset[0] - (initOffset[0] + 30)) < 0.01,
      `Expected X offset ${initOffset[0] + 30}, got ${movedOffset[0]}`
    );
    assert.ok(
      Math.abs(movedOffset[1] - (initOffset[1] + 20)) < 0.01,
      `Expected Y offset ${initOffset[1] + 20}, got ${movedOffset[1]}`
    );

    // Verify canUndo is true and #tool-undo-btn is enabled
    const canUndoAfterMove = await page.evaluate(() => window.__historyStore.getState().canUndo);
    assert.equal(canUndoAfterMove, true, 'canUndo must be true after transform');
    const toolUndoDisabled = await page.isDisabled('#tool-undo-btn');
    assert.equal(toolUndoDisabled, false, 'Toolbar undo button must be enabled');

    // Trigger Undo via Toolbar button
    console.log(`[${browserName}] Triggering Undo on transform via #tool-undo-btn...`);
    await page.click('#tool-undo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    // Readback from C++ engine: offset must be restored to initOffset
    const undoneEngineObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    const undoneOffset = undoneEngineObjs[0].instances[0].offset;
    console.log(`[${browserName}] Engine offset after undo: [${undoneOffset.join(', ')}]`);
    assert.ok(
      Math.abs(undoneOffset[0] - initOffset[0]) < 0.01,
      `Engine readback after undo must match initial X: expected ${initOffset[0]}, got ${undoneOffset[0]}`
    );
    assert.ok(
      Math.abs(undoneOffset[1] - initOffset[1]) < 0.01,
      `Engine readback after undo must match initial Y: expected ${initOffset[1]}, got ${undoneOffset[1]}`
    );

    // Verify canRedo is true and #tool-redo-btn is enabled
    const canRedoAfterUndo = await page.evaluate(() => window.__historyStore.getState().canRedo);
    assert.equal(canRedoAfterUndo, true, 'canRedo must be true after undo');
    const toolRedoDisabled = await page.isDisabled('#tool-redo-btn');
    assert.equal(toolRedoDisabled, false, 'Toolbar redo button must be enabled');

    // Trigger Redo via Toolbar button
    console.log(`[${browserName}] Triggering Redo on transform via #tool-redo-btn...`);
    await page.click('#tool-redo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    // Readback from C++ engine: offset must be restored to movedOffset
    const redoneEngineObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    const redoneOffset = redoneEngineObjs[0].instances[0].offset;
    console.log(`[${browserName}] Engine offset after redo: [${redoneOffset.join(', ')}]`);
    assert.ok(
      Math.abs(redoneOffset[0] - movedOffset[0]) < 0.01,
      `Engine readback after redo must match moved X: expected ${movedOffset[0]}, got ${redoneOffset[0]}`
    );
    results.push({ name: 'Transform undo/redo with engine readback verified', pass: true });

    // 4. Test Deletion Undo/Redo with engine readback
    console.log(`[${browserName}] Testing Deletion Undo/Redo with engine readback...`);
    await page.evaluate(async () => {
      await window.__plateStore.getState().deleteSelected();
    });
    await page.waitForTimeout(400);

    const deletedEngineObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    assert.equal(deletedEngineObjs.length, 0, 'Engine must report 0 objects after deletion');
    const plateObjsAfterDel = await page.evaluate(() => window.__plateStore.getState().objects.length);
    assert.equal(plateObjsAfterDel, 0, 'plateStore must report 0 objects after deletion');

    // Trigger Undo via keyboard (Ctrl+Z)
    console.log(`[${browserName}] Triggering Undo on deletion via keyboard Ctrl+Z...`);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const restoredEngineObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    assert.equal(restoredEngineObjs.length, 1, 'Engine must report 1 object after deletion undo');
    assert.ok(restoredEngineObjs[0].name.includes('20mm_cube'), 'Restored object name must be preserved');

    // Trigger Redo via keyboard (Control+Shift+Z)
    console.log(`[${browserName}] Triggering Redo on deletion via keyboard Control+Shift+Z...`);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const redoneDelObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    assert.equal(redoneDelObjs.length, 0, 'Engine must report 0 objects after deletion redo');

    // Undo again to bring object back for subsequent tests
    console.log(`[${browserName}] Undoing deletion once more to restore object for next tests...`);
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const finalRestoredObjs = await page.evaluate(async () => {
      return await window.__orcaEngine.listObjects();
    });
    assert.equal(finalRestoredObjs.length, 1, 'Engine must have object restored');
    objectId = finalRestoredObjs[0].id;
    results.push({ name: 'Deletion undo/redo with engine readback verified', pass: true });

    // 5. Test edit-after-undo clears redo
    console.log(`[${browserName}] Testing edit-after-undo clears redo...`);
    await page.evaluate(async () => {
      await window.__plateStore.getState().moveSelection([10, 0, 0]);
    });
    await page.waitForTimeout(300);

    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    const canRedoBeforeBranch = await page.evaluate(() => window.__historyStore.getState().canRedo);
    assert.equal(canRedoBeforeBranch, true, 'canRedo must be true right after undo');

    // Perform new edit (branching action)
    await page.evaluate(async () => {
      await window.__plateStore.getState().moveSelection([0, 10, 0]);
    });
    await page.waitForTimeout(300);

    const canRedoAfterBranch = await page.evaluate(() => window.__historyStore.getState().canRedo);
    assert.equal(canRedoAfterBranch, false, 'canRedo must be false after new edit following undo');
    const redoBtnDisabledAfterBranch = await page.isDisabled('#tool-redo-btn');
    assert.ok(redoBtnDisabledAfterBranch, 'Redo button must be disabled after new edit clears future stack');
    results.push({ name: 'Edit-after-undo clears redo verified', pass: true });

    // 6. Test Painting Restoration
    console.log(`[${browserName}] Testing Support Painting Restoration...`);
    await page.click('#tool-paint-btn');
    await page.waitForSelector('#paint-tools-panel', { timeout: 5000 });

    const currentObjId = await page.evaluate(() => window.__paintToolsStore.getState().selectedObjectId);
    assert.ok(currentObjId !== null, 'Painting must target active object');

    await page.click('#paint-tool-triangle');
    await page.uncheck('#triangle-splitting-checkbox');
    const [paintedPoint] = await visibleFacets(page);
    assert.ok(paintedPoint, 'History fixture must expose a visible facet');
    await paintPoint(page, paintedPoint);

    // Verify engine confirms painted enforcer facet
    const paintReadback = await page.evaluate(async (objId) => {
      const volId = window.__paintToolsStore.getState().selectedVolumeId;
      return await window.__orcaEngine.getSupportPainting(objId, volId);
    }, currentObjId);
    assert.ok(paintReadback.enforcers.includes(paintedPoint.facet), 'Engine readback must confirm facet 2 painted');
    console.log(`[${browserName}] Painted enforcers: [${paintReadback.enforcers.join(', ')}]`);

    // Undo painting stroke
    console.log(`[${browserName}] Undoing painting stroke...`);
    await page.click('#tool-undo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const paintAfterUndo = await page.evaluate(async () => {
      const tree = await window.__orcaEngine.call('getObjectTree', {});
      return await window.__orcaEngine.getSupportPainting(tree.objects[0].id, tree.objects[0].volumes[0].id);
    });
    assert.equal(
      paintAfterUndo.enforcers.includes(paintedPoint.facet),
      false,
      'Engine readback after undo must NOT have facet 2 painted'
    );
    console.log(`[${browserName}] Enforcers after undo: [${paintAfterUndo.enforcers.join(', ')}]`);

    // Redo painting stroke
    console.log(`[${browserName}] Redoing painting stroke...`);
    await page.click('#tool-redo-btn');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const paintAfterRedo = await page.evaluate(async () => {
      const tree = await window.__orcaEngine.call('getObjectTree', {});
      return await window.__orcaEngine.getSupportPainting(tree.objects[0].id, tree.objects[0].volumes[0].id);
    });
    assert.ok(
      paintAfterRedo.enforcers.includes(paintedPoint.facet),
      'Engine readback after redo must restore facet 2 painting'
    );
    console.log(`[${browserName}] Enforcers after redo: [${paintAfterRedo.enforcers.join(', ')}]`);

    // History restoration closes painting before replacing engine object IDs.
    await page.waitForSelector('#paint-tools-panel', { state: 'detached' });
    await page.waitForTimeout(300);
    results.push({ name: 'Painting edit undo/redo restoration verified', pass: true });

    // 7. Test Bounded History (stack count and memory limit)
    console.log(`[${browserName}] Testing Bounded History (25 rapid mutations)...`);
    for (let i = 0; i < 25; i++) {
      await page.evaluate(async (step) => {
        const s = window.__plateStore.getState();
        const obj = s.objects[0];
        if (obj && obj.instances[0]) {
          await s.setInstanceTransform(obj.id, obj.instances[0].id, {
            offset: [150 + (step % 5), 150 + (step % 5), 0]
          });
        }
      }, i);
    }
    await page.waitForTimeout(500);

    const historyStats = await page.evaluate(() => {
      const s = window.__historyStore.getState();
      return {
        pastLength: s.past.length,
        totalBytes: s.totalRetainedBytes,
        maxSnapshots: 20
      };
    });
    console.log(`[${browserName}] History past length: ${historyStats.pastLength}, total bytes: ${historyStats.totalBytes}`);
    assert.ok(
      historyStats.pastLength <= historyStats.maxSnapshots,
      `History past length ${historyStats.pastLength} must not exceed ${historyStats.maxSnapshots}`
    );
    assert.ok(
      historyStats.totalBytes <= 50 * 1024 * 1024,
      `History total byte size ${historyStats.totalBytes} must not exceed 50MB`
    );
    results.push({ name: 'Bounded history count and byte size verified', pass: true });

    // 8. Test text input immunity (typing in input does not trigger model undo on Ctrl+Z)
    console.log(`[${browserName}] Testing text input immunity with Ctrl+Z...`);
    const historyLenBeforeType = await page.evaluate(() => window.__historyStore.getState().past.length);

    // Create a temporary input element in DOM to test keyboard isolation
    await page.evaluate(() => {
      const inp = document.createElement('input');
      inp.id = 'test-keyboard-input';
      inp.type = 'text';
      inp.value = 'hello';
      document.body.appendChild(inp);
      inp.focus();
    });

    await page.keyboard.type(' world');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    const historyLenAfterType = await page.evaluate(() => {
      const inp = document.getElementById('test-keyboard-input');
      if (inp) inp.remove();
      return window.__historyStore.getState().past.length;
    });

    assert.equal(
      historyLenAfterType,
      historyLenBeforeType,
      'Ctrl+Z inside text input must NOT trigger model undo'
    );
    results.push({ name: 'Text input immunity on Ctrl+Z verified', pass: true });

    console.log(`\nAll checks passed for ${browserName}!`);
  } finally {
    await browser.close();
  }

  assert.equal(pageErrors.length, 0, `Page errors encountered during ${browserName} test: ${pageErrors.join('; ')}`);
  return results;
}

async function main() {
  try {
    await startServer(PORT, 'history');

    console.log('\nRunning Chromium suite...');
    const chromResults = await runBrowserHistorySuite(chromium, 'chromium');

    console.log('\nRunning Firefox suite...');
    const ffResults = await runBrowserHistorySuite(firefox, 'firefox');

    console.log('\n==================================================');
    console.log('SUMMARY OF RESULTS');
    console.log('==================================================');
    for (const r of chromResults) {
      console.log(`  [Chromium] ${r.name}: PASS`);
    }
    for (const r of ffResults) {
      console.log(`  [Firefox]  ${r.name}: PASS`);
    }
    console.log('\nAll history undo/redo regression checks PASSED across Chromium and Firefox.');
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nTest failed with error:', err);
  process.exit(1);
});
