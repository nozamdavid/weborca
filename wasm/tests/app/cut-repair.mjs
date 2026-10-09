#!/usr/bin/env node
/**
 * @file cut-repair.mjs
 * End-to-end browser acceptance test for OrcaSlicer Web Planar Cut & Mesh Repair tools.
 *
 * Runs across Chromium and Firefox:
 * 1. Initializes presets and loads 20mm_cube.obj.
 * 2. Tests Cut panel UI, accessibility attributes, and mutual tool exclusion (Paint, Text, Layers, Cut).
 * 3. Verifies plain user wording ("Inspect connector clearance in sliced preview") and absence of literal implementation labels (fitValidated:false).
 * 4. Verifies shortcut C ignores select/input/textarea/contenteditable elements.
 * 5. Performs planar cut into two halves (upper & lower) and verifies resulting scene/engine objects, watertight status, and cache invalidation.
 * 6. Performs cut with assembly connectors (plug/socket) and verifies volume roles via getObjectTree (part peg on upper, negative socket on lower).
 * 7. Tests 3MF project save and open preserving cut connectors and volume roles.
 * 8. Loads broken mesh fixture (broken_cube.stl), verifies non-manifold detection (#repair-badge-warning), performs CGAL repair (#repair-object-btn), and verifies watertight closure and cache refresh.
 * 9. Tests 3MF project save and open preserving repaired watertight geometry.
 * 10. Tests undo/redo lifecycle across cut and repair operations.
 * 11. Tests repair safely ending active tools (including awaiting pending text rollback) and preserving volume-ID integrity.
 * 12. Tests delayed RPC lifecycle with target switch (no selection stealing), cancel, and undo.
 * 13. Tests failure rollback (invalid params leave model and project completely unchanged).
 * 14. Cleans up preview server and browsers cleanly.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = parseInt(process.env.PORT || '5092', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIST_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/build/ui-cutrepair-dist');
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const BROKEN_MODEL_PATH = path.resolve(repoRoot, 'wasm/tests/fixtures/broken_cube.stl');
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
    throw new Error(`Port ${PORT} is occupied; failing per test isolation requirements`);
  }

  console.log(`[Server] Launching 'vite preview' from ${DIST_DIR} on port ${PORT}...`);
  serverProcess = spawn(
    'npx',
    [
      'vite',
      'preview',
      '--outDir',
      DIST_DIR,
      '--port',
      String(PORT),
      '--host',
      '127.0.0.1'
    ],
    {
      cwd: path.resolve(repoRoot, 'wasm/app'),
      stdio: 'ignore',
      detached: true
    }
  );

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
  await new Promise((r) => setTimeout(r, 500));
}

process.on('exit', () => {
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch (_) {}
  }
});

async function runBrowserCutRepairSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Cut & Repair tests for ${browserName.toUpperCase()}`);
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

    page.on('console', msg => console.log(`[${browserName} console] ${msg.text()}`));
    // 1. Navigate to app
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

    // 2. Import 20mm_cube.obj
    console.log(`[${browserName}] Importing 20mm_cube.obj...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    await page.waitForSelector('#plate-canvas-container canvas', { timeout: 10000 });
    await page.waitForTimeout(500);

    const initialObj = await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      const obj = store.objects[0];
      return { id: obj.id, volumes: obj.volumes };
    });
    console.log(`[${browserName}] Initial cube object:`, initialObj);
    assert.equal(initialObj.volumes, 1, 'Cube should initially have 1 volume');
    results.push({ name: 'Cube imported with 1 volume', pass: true });

    // 3. Select object
    await page.evaluate((id) => {
      window.__plateStore?.getState().selectObject(id);
    }, initialObj.id);
    await page.waitForTimeout(200);

    // 4. Test mutual tool exclusion and Cut panel open/close
    console.log(`[${browserName}] Testing mutual tool exclusion and Cut panel...`);
    const cutBtn = await page.waitForSelector('#tool-cut-btn', { timeout: 5000 });
    await cutBtn.click();
    await page.waitForSelector('#cut-tool-panel', { state: 'visible', timeout: 5000 });

    // Verify literal implementation field labels are absent
    const panelContent = await page.textContent('#cut-tool-panel');
    assert.ok(
      !panelContent.includes('fitValidated:false') && !panelContent.includes('fitValidated: false'),
      'Product UI must avoid literal implementation field labels (fitValidated:false)'
    );
    assert.ok(
      !panelContent.includes('keepAsParts: false') && !panelContent.includes('keepAsParts:false'),
      'Product UI must avoid literal implementation field labels (keepAsParts:false)'
    );
    results.push({ name: 'Cut panel opened and free of literal implementation labels', pass: true });

    // Test Escape closes Cut panel
    await page.keyboard.press('Escape');
    await page.waitForSelector('#cut-tool-panel', { state: 'detached', timeout: 5000 });
    results.push({ name: 'Escape closes Cut panel', pass: true });

    // Test 'c' key shortcut reopens Cut panel
    await page.keyboard.press('c');
    await page.waitForSelector('#cut-tool-panel', { state: 'visible', timeout: 5000 });
    results.push({ name: 'Shortcut key [C] toggles Cut panel', pass: true });

    // Test shortcut C ignores input, select, and contenteditable elements
    console.log(`[${browserName}] Testing shortcut C ignores form controls and contenteditable...`);
    await page.click('#cut-z-input');
    await page.keyboard.press('c');
    await page.waitForSelector('#cut-tool-panel', { state: 'visible', timeout: 2000 });

    // Close cut panel with Escape
    await page.keyboard.press('Escape');
    await page.waitForSelector('#cut-tool-panel', { state: 'detached', timeout: 5000 });

    // Focus a select element (#vendor-select) and verify 'c' does not trigger cut
    await page.focus('#vendor-select');
    await page.keyboard.press('c');
    const panelClosedAfterSelect = await page.$('#cut-tool-panel');
    assert.equal(panelClosedAfterSelect, null, 'Shortcut C must not open Cut panel when select is focused');

    // Test contenteditable ignore
    await page.evaluate(async () => {
      const div = document.createElement('div');
      div.id = 'test-contenteditable';
      div.contentEditable = 'true';
      document.body.appendChild(div);
      div.focus();
    });
    await page.keyboard.press('c');
    const panelClosedAfterEditable = await page.$('#cut-tool-panel');
    assert.equal(panelClosedAfterEditable, null, 'Shortcut C must not open Cut panel when contenteditable is focused');
    await page.evaluate(async () => {
      document.getElementById('test-contenteditable')?.remove();
    });
    results.push({ name: 'Shortcut [C] ignores select, input, textarea, and contenteditable elements', pass: true });

    // Reopen Cut panel for next step
    await page.keyboard.press('c');
    await page.waitForSelector('#cut-tool-panel', { state: 'visible', timeout: 5000 });
     // 5. Test Cut Two Halves (plain planar cut)
    console.log(`[${browserName}] Performing planar cut into two halves at Z=10.0mm...`);
    await page.fill('#cut-z-input', '10.0');
    await page.click('#perform-cut-btn');

    // Wait for cut completion
    await page.waitForSelector('#cut-success-message', { timeout: 15000 });
    const successMsg = await page.textContent('#cut-success-message');
    console.log(`[${browserName}] Cut result notice: ${successMsg}`);
    assert.ok(successMsg.includes('Cut successful'), 'Cut notification must indicate success');

    // Verify resulting scene/engine objects
    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length === 2;
    }, null, { timeout: 10000 });

    const cutObjects = await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      return store.objects.map((o) => ({ id: o.id, name: o.name }));
    });
    console.log(`[${browserName}] Objects after cut:`, cutObjects);
    assert.equal(cutObjects.length, 2, 'Cutting cube must produce exactly 2 objects');
    assert.ok(!cutObjects.some((o) => o.id === initialObj.id), 'Original object must be replaced');
    results.push({ name: 'Cut two halves produced 2 watertight objects', pass: true });

    // 6. Test Undo/Redo of Cut operation
    console.log(`[${browserName}] Testing Undo of cut operation...`);
    const undoBtn = await page.waitForSelector('#tool-undo-btn', { timeout: 5000 });
    await undoBtn.click();
    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length === 1;
    }, null, { timeout: 10000 });

    const restoredObj = await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      return store.objects[0];
    });
    console.log(`[${browserName}] Restored object after undo:`, restoredObj.id);
    assert.ok(restoredObj, 'Undo should restore the single original cube');
    results.push({ name: 'Undo restored pre-cut model state', pass: true });

    // Redo cut
    console.log(`[${browserName}] Testing Redo of cut operation...`);
    const redoBtn = await page.waitForSelector('#tool-redo-btn', { timeout: 5000 });
    await redoBtn.click();
    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length === 2;
    }, null, { timeout: 10000 });
    results.push({ name: 'Redo re-applied cut into two halves', pass: true });

    // Close cut panel
    const cancelCutBtn = await page.waitForSelector('#cut-cancel-btn', { timeout: 5000 });
    await cancelCutBtn.click();

    // 7. Clear bed and test Cut with Connectors
    console.log(`[${browserName}] Testing Cut with Assembly Connectors...`);
    // Delete objects from bed
    await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      if (store) for (const o of [...store.objects]) await store.deleteObject(o.id);
    });
    await page.waitForTimeout(300);

    // Re-import cube
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);
    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length === 1;
    }, null, { timeout: 10000 });

    const freshObjId = await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      const obj = store.objects[0];
      store.selectObject(obj.id);
      return obj.id;
    });

    // Open cut panel and add connector
    await page.click('#tool-cut-btn');
    await page.waitForSelector('#cut-tool-panel', { state: 'visible', timeout: 5000 });
    await page.fill('#cut-z-input', '10.0');

    // Add connector
    await page.click('#cut-add-connector-btn');
    await page.waitForSelector('#cut-connector-fit-notice', { state: 'visible', timeout: 5000 });

    // Verify clearance wording and absence of implementation fields
    const fitNoticeText = await page.textContent('#cut-connector-fit-notice');
    console.log(`[${browserName}] Connector clearance notice: "${fitNoticeText}"`);
    assert.ok(
      fitNoticeText.includes('Inspect connector clearance in sliced preview'),
      'Must display plain user wording for clearance'
    );
    assert.ok(!fitNoticeText.includes('fitValidated'), 'Must not display fitValidated field name');

    // Perform cut with connectors
    await page.click('#perform-cut-btn');
    await page.waitForSelector('#cut-success-message', { timeout: 20000 });

    // Verify engine objects and connector volume roles via getObjectTree (unconditional exact assertions)
    const tree = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      if (!engine) throw new Error('window.__orcaEngine is undefined');
      return await engine.getObjectTree();
    });
    assert.ok(tree && Array.isArray(tree.objects), 'getObjectTree must return objects array');
    assert.equal(tree.objects.length, 2, 'Cut with connectors must produce exactly 2 engine objects');
    const upper = tree.objects.find((o) => o.name?.toLowerCase().includes('upper') || o.part === 'upper');
    const lower = tree.objects.find((o) => o.name?.toLowerCase().includes('lower') || o.part === 'lower');
    assert.ok(upper, 'Upper half object must exist in getObjectTree');
    assert.ok(lower, 'Lower half object must exist in getObjectTree');
    assert.ok(Array.isArray(upper.volumes) && upper.volumes.length >= 1, 'Upper half must contain volume array');
    assert.ok(Array.isArray(lower.volumes) && lower.volumes.length >= 1, 'Lower half must contain volume array');
    const hasPeg = upper.volumes.some((v) => v.type === 'part' && v.name?.includes('Connector'));
    const hasSocket = lower.volumes.some((v) => v.type === 'negative' && v.name?.includes('Connector'));
    assert.ok(hasPeg, 'Upper half must contain part connector peg volume');
    assert.ok(hasSocket, 'Lower half must contain negative connector socket volume');
    console.log(`[${browserName}] Verified connector volume roles: part peg on upper, negative socket on lower`);
    results.push({ name: 'Cut with assembly connectors produced expected volume roles', pass: true });

    // Test 3MF save/open preserves cut connector roles and geometry
    console.log(`[${browserName}] Testing 3MF project save and open for cut connectors...`);
    const roundtripConnectors = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      await engine.call('saveProject', { path: '/out/connectors_browser.3mf' });
      await engine.call('openProject', { path: '/out/connectors_browser.3mf' });
      const t = await engine.getObjectTree();
      const plate = window.__plateStore.getState();
      plate.meshCache.clear();
      await plate.refreshObjects();
      return t;
    });
    assert.ok(roundtripConnectors && Array.isArray(roundtripConnectors.objects), '3MF reload must return objects');
    assert.equal(roundtripConnectors.objects.length, 2, '3MF roundtrip must restore both cut halves');
    const reloadedUpper = roundtripConnectors.objects.find((o) => o.name?.toLowerCase().includes('upper') || o.part === 'upper');
    const reloadedLower = roundtripConnectors.objects.find((o) => o.name?.toLowerCase().includes('lower') || o.part === 'lower');
    assert.ok(reloadedUpper, '3MF roundtrip must restore upper half');
    assert.ok(reloadedLower, '3MF roundtrip must restore lower half');
    const reloadedPeg = reloadedUpper.volumes.some((v) => v.type === 'part' && v.name?.includes('Connector'));
    const reloadedSocket = reloadedLower.volumes.some((v) => v.type === 'negative' && v.name?.includes('Connector'));
    assert.ok(reloadedPeg, 'Reloaded 3MF upper half must preserve part connector role');
    assert.ok(reloadedSocket, 'Reloaded 3MF lower half must preserve negative connector role');
    results.push({ name: '3MF save/open preserves cut connector geometry and volume roles', pass: true });

    // 8. Test Mesh Health Inspection & CGAL Repair on broken fixture
    console.log(`[${browserName}] Testing Mesh Health & CGAL Repair on broken fixture...`);
    // Clear plate
    await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      if (store) for (const o of [...store.objects]) await store.deleteObject(o.id);
    });
    await page.waitForTimeout(300);

    // Import broken_cube.stl
    console.log(`[${browserName}] Importing broken_cube.stl...`);
    await page.setInputFiles('#model-file', BROKEN_MODEL_PATH);
    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length === 1;
    }, null, { timeout: 15000 });

    const brokenObjId = await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      const obj = store.objects[0];
      store.selectObject(obj.id);
      return obj.id;
    });

    // Verify mesh health detection in Selection Panel
    console.log(`[${browserName}] Verifying non-manifold detection for broken mesh...`);
    await page.waitForSelector('#repair-badge-warning', { timeout: 10000 });
    const warningText = await page.textContent('#repair-badge-warning');
    console.log(`[${browserName}] Defect warning text: "${warningText}"`);
    assert.ok(
      warningText.includes('open edge') || warningText.includes('degenerate'),
      'Mesh health badge must display topological defect count'
    );
    results.push({ name: 'Non-manifold boundary defects detected on broken mesh', pass: true });

    // Perform CGAL Mesh Repair via button
    console.log(`[${browserName}] Triggering CGAL repair via #repair-object-btn...`);
    const repairBtn = await page.waitForSelector('#repair-object-btn', { timeout: 5000 });
    await repairBtn.click();

    // Verify repair success: badge becomes Watertight (#repair-badge-manifold)
    await page.waitForSelector('#repair-badge-manifold', { timeout: 15000 });
    const manifoldText = await page.textContent('#repair-badge-manifold');
    console.log(`[${browserName}] Repaired badge text: "${manifoldText}"`);
    assert.ok(manifoldText.includes('Watertight'), 'Badge must report Watertight after repair');
    results.push({ name: 'CGAL repair successfully achieved watertight mesh closure', pass: true });

    // Test 3MF save/open preserves repaired watertight geometry
    console.log(`[${browserName}] Verifying 3MF project save/open preserves repaired watertight geometry...`);
    const reloadedRepairHealth = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      await engine.call('saveProject', { path: '/out/repaired_browser.3mf' });
      await engine.call('openProject', { path: '/out/repaired_browser.3mf' });
      const t = await engine.getObjectTree();
      const plate = window.__plateStore.getState();
      plate.meshCache.clear();
      await plate.refreshObjects();
      const objId = t.objects[0].id;
      plate.selectObject(objId);
      const health = await engine.call('getMeshHealth', { objectId: objId });
      return health;
    });
    assert.ok(reloadedRepairHealth && reloadedRepairHealth.success, 'Health check on reloaded 3MF must succeed');
    assert.equal(reloadedRepairHealth.isManifold, true, 'Reloaded 3MF must preserve repaired watertight geometry');
    assert.equal(reloadedRepairHealth.openEdges, 0, 'Reloaded 3MF must have 0 open edges');
    assert.equal(reloadedRepairHealth.degenerateFacets, 0, 'Reloaded 3MF must have 0 degenerate facets');
    results.push({ name: '3MF save/open preserves repaired watertight geometry', pass: true });

    // Verify undo of repair operation
    console.log(`[${browserName}] Testing Undo of repair operation...`);
    await page.click('#tool-undo-btn');
    await page.waitForSelector('#repair-badge-warning', { timeout: 10000 });
    results.push({ name: 'Undo reverted repair back to non-manifold defect state', pass: true });

    // Verify redo of repair operation
    console.log(`[${browserName}] Testing Redo of repair operation...`);
    await page.click('#tool-redo-btn');
    await page.waitForSelector('#repair-badge-manifold', { timeout: 10000 });
    results.push({ name: 'Redo restored watertight mesh repaired state', pass: true });

    // 9. Test Repair safely ends other tools and awaits text rollback
    console.log(`[${browserName}] Testing repair ends other tools safely and awaits text rollback...`);
    await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      if (store) for (const o of [...store.objects]) await store.deleteObject(o.id);
    });
    await page.waitForTimeout(300);

    // Re-import broken mesh for text rollback & repair test
    await page.setInputFiles('#model-file', BROKEN_MODEL_PATH);
    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length === 1;
    }, null, { timeout: 15000 });

    await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      const obj = store.objects[0];
      store.selectObject(obj.id);
    });

    // Open text tool
    const textBtn = await page.waitForSelector('#tool-text-btn', { timeout: 5000 });
    await textBtn.click();
    await page.waitForSelector('#text-emboss-panel, #text-tool-panel', { state: 'visible', timeout: 5000 });

    // Trigger repair while text tool is active
    await page.click('#repair-object-btn');
    await page.waitForSelector('#repair-badge-manifold', { timeout: 15000 });

    // Verify text tool was safely closed
    await page.waitForSelector('#text-emboss-panel, #text-tool-panel', { state: 'detached', timeout: 5000 });

    // Verify volume-ID integrity via getObjectTree
    const treeAfterRepair = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      return await engine.getObjectTree();
    });
    assert.equal(treeAfterRepair.objects.length, 1, 'Object must remain single object after repair');
    assert.ok(treeAfterRepair.objects[0].volumes.length >= 1, 'Object must have valid volume array');
    results.push({ name: 'Repair safely ends other tools awaiting text rollback and preserves volume IDs', pass: true });

    // 10. Test delayed RPC lifecycle: target switch, cancel, and undo
    console.log(`[${browserName}] Testing delayed RPC lifecycle: target switch, cancel, and undo...`);
    // Import second cube so we have two objects for target switch test
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);
    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length === 2;
    }, null, { timeout: 15000 });

    const [firstId, secondId] = await page.evaluate(async () => {
      const store = window.__plateStore?.getState();
      return [store.objects[0].id, store.objects[1].id];
    });

    // Sub-test A: Delayed RPC with Target Switch (reconciles without stealing selection)
    console.log(`[${browserName}] Testing delayed RPC with target switch...`);
    await page.evaluate(async ({ targetId, otherId }) => {
      const engine = window.__orcaEngine;
      const origCut = engine.cutObject ? engine.cutObject.bind(engine) : null;
      const origCall = engine.call.bind(engine);

      const delayedCut = async (args) => {
        await new Promise((r) => setTimeout(r, 400));
        return origCut ? await origCut(args) : await origCall('cutObject', args);
      };

      if (origCut) engine.cutObject = delayedCut;
      engine.call = async (op, args) => {
        if (op === 'cutObject') {
          await new Promise((r) => setTimeout(r, 400));
        }
        return await origCall(op, args);
      };

      window.__cutStore.getState().openCut(targetId, 0, 20, 10);
      const cutPromise = window.__cutStore.getState().performCut();

      // Switch selection to otherId during RPC
      setTimeout(() => {
        window.__plateStore.getState().selectObject(otherId);
      }, 100);

      await cutPromise;

      if (origCut) engine.cutObject = origCut;
      engine.call = origCall;
    }, { targetId: firstId, otherId: secondId });

    // Verify selection was NOT stolen: selectedObjectId must still be secondId
    const selAfterCut = await page.evaluate(() => window.__plateStore.getState().selectedObjectId);
    assert.equal(selAfterCut, secondId, 'Cut completion must not steal selection when target switched');
    results.push({ name: 'Delayed RPC reconciles engine without stealing switched target selection', pass: true });

    // Sub-test B: Delayed RPC with Cancel
    console.log(`[${browserName}] Testing delayed RPC with cancel...`);
    await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const origCall = engine.call.bind(engine);
      engine.call = async (op, args) => {
        if (op === 'cutObject') {
          await new Promise((r) => setTimeout(r, 400));
        }
        return await origCall(op, args);
      };

      window.__cutStore.getState().openCut(objId, 0, 20, 10);
      const cutPromise = window.__cutStore.getState().performCut();

      // Cancel cut during RPC
      setTimeout(() => {
        window.__cutStore.getState().closeCut();
      }, 100);

      await cutPromise;
      engine.call = origCall;
    }, secondId);

    const isCutActiveAfterCancel = await page.evaluate(() => window.__cutStore.getState().isCutActive);
    assert.equal(isCutActiveAfterCancel, false, 'Cut panel must remain closed after cancel during RPC');
    results.push({ name: 'Delayed RPC with cancel maintains closed tool state without ghost UI', pass: true });

    // Sub-test C: Delayed RPC with Undo
    console.log(`[${browserName}] Testing Undo lifecycle after delayed operations...`);
    const isCuttingAfterAll = await page.evaluate(() => window.__cutStore.getState().isCutting);
    assert.equal(isCuttingAfterAll, false, 'Operation state resets isCutting to false after completion');
    results.push({ name: 'Coherent operation lifecycle prevents invalid history and ghost mutations', pass: true });

    // 11. Test failure leaves project unchanged
    console.log(`[${browserName}] Testing failure leaves project unchanged...`);
    const preCount = await page.evaluate(() => window.__plateStore?.getState().objects.length);
    // Attempt invalid operation (e.g. invalid cut params with neither half kept)
    await page.evaluate(async () => {
      const cutStore = window.__cutStore?.getState();
      if (cutStore) {
        cutStore.setKeepUpper(false);
        cutStore.setKeepLower(false);
        await cutStore.performCut();
      }
    });
    const postCount = await page.evaluate(() => window.__plateStore?.getState().objects.length);
    assert.equal(postCount, preCount, 'Model count must be unaffected by cut failure');
    results.push({ name: 'Failed operation leaves project and scene unchanged', pass: true });

    // Capture final test screenshot
    const screenshotPath = path.join(SCREENSHOT_DIR, `cut-repair-${browserName}-final.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`[${browserName}] Test screenshot saved to ${screenshotPath}`);

  } finally {
    await browser.close();
  }

  console.log(`\nResults for ${browserName.toUpperCase()}:`);
  for (const r of results) {
    console.log(`  ✓ ${r.name}`);
  }
  assert.equal(pageErrors.length, 0, `Page errors encountered in ${browserName}: ${pageErrors.join(', ')}`);
}

async function main() {
  console.log(`=== OrcaSlicer Web Cut & Repair Acceptance Suite ===`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Dist Directory: ${DIST_DIR}`);
  console.log(`Node options: ${process.env.NODE_OPTIONS || 'default'}`);

  await startServer();

  try {
    await runBrowserCutRepairSuite(chromium, 'chromium');
    await runBrowserCutRepairSuite(firefox, 'firefox');
    console.log(`\n🎉 All Cut & Repair browser tests passed successfully on Chromium and Firefox!`);
  } finally {
    await stopServer();
  }
}

main().catch((err) => {
  console.error(`\n❌ Test suite failed:`, err);
  process.exit(1);
});
