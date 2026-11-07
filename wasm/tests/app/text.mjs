/**
 * @file text.mjs
 * End-to-end browser integration tests for 3D Text & Emboss tool in OrcaSlicer Web.
 * Exercises panel interactions, font selection, parameter adjustments, live emboss,
 * history undo/redo (mesh buffer/triangle count check), uncommitted live-edit rollback,
 * and font reselect UI elements.
 */

import { chromium, firefox } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const PORT = parseInt(process.env.PORT || '5173', 10);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const DIST_DIR = process.env.APP_TEST_DIST || path.resolve(REPO_ROOT, 'wasm/build/ui-final-dist');
const CYLINDER_MODEL_PATH = path.join(os.tmpdir(), 'orca-text-test-cylinder.obj');
if (!fs.existsSync(CYLINDER_MODEL_PATH)) {
  const R = 40, H = 60, N = 96;
  let obj = 'v 0 0 0\nv 0 0 ' + H + '\n';
  for (let i = 0; i < N; i++) { const a = i / N * 2 * Math.PI; obj += `v ${Math.cos(a) * R} ${Math.sin(a) * R} 0\nv ${Math.cos(a) * R} ${Math.sin(a) * R} ${H}\n`; }
  for (let i = 0; i < N; i++) { const j = (i + 1) % N, b1 = 3 + 2 * i, t1 = 4 + 2 * i, b2 = 3 + 2 * j, t2 = 4 + 2 * j; obj += `f ${b1} ${b2} ${t2}\nf ${b1} ${t2} ${t1}\nf 1 ${b2} ${b1}\nf 2 ${t1} ${t2}\n`; }
  fs.writeFileSync(CYLINDER_MODEL_PATH, obj);
}

const SCREENSHOT_DIR = path.join(REPO_ROOT, 'wasm/tests/app/screenshots');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserTextSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Running 3D Text Test Suite on [${browserName}]`);
  console.log(`==================================================\n`);

  const browser = await browserType.launch({
    headless: true,
    args: ['--enable-webgl', '--no-sandbox']
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = [];
  const pageErrors = [];

  try {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('Failed to load resource') &&
          !text.includes('404') &&
          !text.includes('favicon')
        ) {
          pageErrors.push(`[Console Error] ${text}`);
        }
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    // 1. Navigate to app
    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    // Wait for engine presets to initialize

    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    // 2. Import 20mm_cube.obj
    console.log(`[${browserName}] Importing cylinder.obj...`);
    await page.setInputFiles('#model-file', CYLINDER_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    await page.waitForSelector('#plate-canvas-container canvas', { timeout: 10000 });
    await page.waitForTimeout(500);

    const initialObj = await page.evaluate(() => {
      const store = window.__plateStore?.getState();
      const obj = store.objects[0];
      return { id: obj.id, volumes: obj.volumes };
    });
    console.log(`[${browserName}] Initial object:`, initialObj);
    assert.equal(initialObj.volumes, 1, 'Cube should initially have 1 volume');
    results.push({ name: 'Cube imported with 1 volume', pass: true });

    // 3. Select object
    await page.evaluate((id) => {
      window.__plateStore?.getState().selectObject(id);
    }, initialObj.id);
    await page.waitForTimeout(200);

    // 4. Open Text Tool via toolbar button
    console.log(`[${browserName}] Opening 3D Text tool...`);
    const textToolBtn = await page.waitForSelector('#tool-text-btn', { timeout: 5000 });
    await textToolBtn.click();

    // Verify panel appeared
    await page.waitForSelector('#text-emboss-panel', { timeout: 5000 });
    results.push({ name: 'Text panel opened via toolbar button', pass: true });

    // 5. Fill text and font
    console.log(`[${browserName}] Configuring text string and font...`);
    const textInput = await page.waitForSelector('#text-input', { timeout: 5000 });
    await page.fill('#text-input', 'OrcaText');

    // Verify font selector has options and select DejaVu Sans
    const fontSelect = await page.waitForSelector('#font-select', { timeout: 5000 });
    await fontSelect.selectOption('dejavu-sans');

    // Adjust size and depth
    await page.evaluate(() => {
      const ts = window.__textStore?.getState();
      if (ts) {
        ts.setSize(6.0);
        ts.setDepth(1.5);
      }
    });
    
    // Check useSurface toggle
    const useSurfaceCheckbox = await page.waitForSelector('#use-surface-checkbox', { timeout: 5000 });
    const isChecked = await useSurfaceCheckbox.isChecked();
    assert.equal(isChecked, false, 'useSurface should default to false');
    
    // Toggle on
    await page.check('#use-surface-checkbox');
    assert.equal(await useSurfaceCheckbox.isChecked(), true, 'useSurface toggle should be checked');
    await page.waitForTimeout(200);

    // 6. Add Text to Object
    console.log(`[${browserName}] Clicking Add Text...`);
    const addBtn = await page.waitForSelector('#add-text-btn', { timeout: 5000 });
    await addBtn.click();

    // Wait for volume count to increase to 2 in plate store
    await page.waitForFunction((objId) => {
      const store = window.__plateStore?.getState();
      const obj = store?.objects.find((o) => o.id === objId);
      return obj && obj.volumes >= 2;
    }, initialObj.id, { timeout: 15000 });

    // Wait for tree in object list store to reflect the new text volume
    await page.waitForFunction((objId) => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects.find((o) => o.id === objId);
      return obj && obj.volumes.length >= 2;
    }, initialObj.id, { timeout: 15000 });

    const afterAdd = await page.evaluate((objId) => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects.find((o) => o.id === objId);
      return { volumes: obj ? obj.volumes.map((v) => ({ id: v.id, name: v.name, type: v.type })) : []
      };
    }, initialObj.id);

    console.log(`[${browserName}] Object tree volumes after addText:`, afterAdd.volumes);
    assert.equal(afterAdd.volumes.length, 2, 'Object tree must now have 2 volumes');
    const textVol = afterAdd.volumes.find((v) => v.name === 'OrcaText');
    assert.ok(textVol, 'Must find volume named OrcaText');
    results.push({ name: 'Text volume successfully added to object', pass: true });

    // Record initial mesh buffer complexity (triangle count)
    const meshInitial = await page.evaluate(async (objId) => {
      const store = window.__plateStore?.getState();
      const m = await store?.getMesh(objId);
      return { triangleCount: m?.triangleCount, vertexCount: m?.vertexCount };
    }, initialObj.id);
    assert.ok(meshInitial.triangleCount > 0, 'Initial object mesh must have triangles');

    
    const curvedTriangleCount = await page.evaluate(async ({objId, textVolId}) => {
      const store = window.__plateStore?.getState();
      const m = await store?.getMesh(objId);
      const mVol = m.volumes.find(v => v.volumeId === textVolId);
      return mVol ? mVol.facetCount : 0;
    }, { objId: initialObj.id, textVolId: textVol.id });
    
    // Toggle useSurface OFF
    console.log('[' + browserName + '] Toggling Use surface OFF...');
    await page.uncheck('#use-surface-checkbox');
    // Wait for debounce and engine response
    await page.waitForTimeout(1000);
    await page.waitForFunction(() => !window.__textStore?.getState()?.isLoading, null, { timeout: 10000 });
    
    const flatTriangleCount = await page.evaluate(async ({objId, textVolId}) => {
      const store = window.__plateStore?.getState();
      const m = await store?.getMesh(objId);
      const mVol = m.volumes.find(v => v.volumeId === textVolId);
      return mVol ? mVol.facetCount : 0;
    }, { objId: initialObj.id, textVolId: textVol.id });
    
    console.log('[' + browserName + '] Curved triangles:', curvedTriangleCount);
    console.log('[' + browserName + '] Flat triangles:', flatTriangleCount);
    
    assert.ok(curvedTriangleCount !== flatTriangleCount, 'Curved and flat volumes must differ in triangle count');

    // Undo
    console.log('[' + browserName + '] Undoing Use surface toggle...');
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(500);
    
    const undoTriangleCount = await page.evaluate(async ({objId, textVolId}) => {
      const store = window.__plateStore?.getState();
      const m = await store?.getMesh(objId);
      const mVol = m.volumes.find(v => v.volumeId === textVolId);
      return mVol ? mVol.facetCount : 0;
    }, { objId: initialObj.id, textVolId: textVol.id });
    assert.ok(undoTriangleCount > 0, 'Undo should restore a mesh');


    // Redo
    console.log('[' + browserName + '] Redoing Use surface toggle...');
    await page.keyboard.press('Control+Shift+Z');
    await page.waitForTimeout(500);
    
    const redoTriangleCount = await page.evaluate(async ({objId, textVolId}) => {
      const store = window.__plateStore?.getState();
      const m = await store?.getMesh(objId);
      const mVol = m.volumes.find(v => v.volumeId === textVolId);
      return mVol ? mVol.facetCount : 0;
    }, { objId: initialObj.id, textVolId: textVol.id });
    assert.ok(redoTriangleCount > 0, 'Redo should restore a mesh');


    // 7. Edit 3D Text: update text string and rotation
    console.log(`[${browserName}] Editing text volume in-place...`);
    await page.evaluate(async (data) => {
      await window.__textStore?.getState().openForEdit(data.objId, data.volId);
    }, { objId: initialObj.id, volId: textVol.id });

    await page.waitForFunction(() => {
      const ts = window.__textStore?.getState();
      return ts && ts.targetVolumeId !== null && !ts.isLoading;
    }, null, { timeout: 5000 });

    // Change text string to "OrcaEdit"
    await page.fill('#text-input', 'OrcaEdit');

    // Update rotation via store action
    await page.evaluate(() => {
      window.__textStore?.getState().setRotation(45);
    });
    await page.waitForTimeout(300);

    // Click Update Mesh
    const updateBtn = await page.waitForSelector('#update-text-btn', { timeout: 5000 });
    await updateBtn.click();
    await page.waitForTimeout(1000);

    // Verify volume name changed to OrcaEdit
    const afterUpdate = await page.evaluate((objId) => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects.find((o) => o.id === objId);
      return obj ? obj.volumes.map((v) => ({ id: v.id, name: v.name })) : [];
    }, initialObj.id);

    console.log(`[${browserName}] Volumes after updateText:`, afterUpdate);
    const updatedVol = afterUpdate.find((v) => v.name === 'OrcaEdit');
    assert.ok(updatedVol, 'Updated volume named OrcaEdit must exist');
    results.push({ name: 'Text volume updated with new text string and rotation', pass: true });

    // Record updated mesh buffer complexity
    const meshUpdated = await page.evaluate(async (objId) => {
      const store = window.__plateStore?.getState();
      const m = await store?.getMesh(objId);
      return { triangleCount: m?.triangleCount, vertexCount: m?.vertexCount };
    }, initialObj.id);
    assert.notEqual(
      meshUpdated.triangleCount,
      meshInitial.triangleCount,
      'Mesh triangleCount must differ between OrcaText and rotated OrcaEdit'
    );

    // 8. Test History: Undo / Redo with actual mesh buffer verification
    console.log(`[${browserName}] Testing History Undo/Redo with mesh buffer verification...`);
    const undoBtn = await page.waitForSelector('#undo-btn', { timeout: 5000 });
    assert.ok(!(await undoBtn.isDisabled()), 'Undo button must be enabled');

    await undoBtn.click();
    await page.waitForTimeout(1000);

    // Verify after undo: volume name should be OrcaText and mesh complexity restored
    const afterUndo = await page.evaluate(() => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects[0];
      return obj ? obj.volumes.map((v) => ({ id: v.id, name: v.name })) : [];
    });

    console.log(`[${browserName}] Volumes after Undo:`, afterUndo);
    const undoneVol = afterUndo.find((v) => v.name === 'OrcaText');
    assert.ok(undoneVol, 'Volume must be reverted back to OrcaText on undo');

    const currentObjIdAfterUndo = await page.evaluate(() => window.__plateStore?.getState().objects[0]?.id);
    const meshUndone = await page.evaluate(async (objId) => {
      const store = window.__plateStore?.getState();
      const m = await store?.getMesh(objId);
      return { triangleCount: m?.triangleCount, vertexCount: m?.vertexCount };
    }, currentObjIdAfterUndo);
    assert.equal(
      meshUndone.triangleCount,
      meshInitial.triangleCount,
      'History undo must restore original mesh buffer complexity'
    );
    results.push({ name: 'History undo restored initial text configuration and mesh buffer', pass: true });

    // Test Redo with mesh buffer verification
    const redoBtn = await page.waitForSelector('#redo-btn', { timeout: 5000 });
    assert.ok(!(await redoBtn.isDisabled()), 'Redo button must be enabled after undo');

    await redoBtn.click();
    await page.waitForTimeout(1000);

    const afterRedo = await page.evaluate(() => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects[0];
      return obj ? obj.volumes.map((v) => ({ id: v.id, name: v.name })) : [];
    });

    console.log(`[${browserName}] Volumes after Redo:`, afterRedo);
    const redoneVol = afterRedo.find((v) => v.name === 'OrcaEdit');
    assert.ok(redoneVol, 'Volume must be restored to OrcaEdit on redo');

    const currentObjIdAfterRedo = await page.evaluate(() => window.__plateStore?.getState().objects[0]?.id);
    const meshRedone = await page.evaluate(async (objId) => {
      const store = window.__plateStore?.getState();
      const m = await store?.getMesh(objId);
      return { triangleCount: m?.triangleCount, vertexCount: m?.vertexCount };
    }, currentObjIdAfterRedo);
    assert.equal(
      meshRedone.triangleCount,
      meshUpdated.triangleCount,
      'History redo must restore edited mesh buffer complexity'
    );
    results.push({ name: 'History redo restored edited text configuration and mesh buffer', pass: true });

    // 9. Test uncommitted live-edit rollback on panel close
    console.log(`[${browserName}] Testing uncommitted live-edit rollback on panel close...`);
    await page.evaluate(async (data) => {
      await window.__textStore?.getState().openForEdit(data.objId, data.volId);
    }, { objId: currentObjIdAfterRedo, volId: redoneVol.id });

    await page.waitForFunction(() => {
      const ts = window.__textStore?.getState();
      return ts && ts.targetVolumeId !== null && !ts.isLoading;
    }, null, { timeout: 5000 });

    // Change text input without clicking Update Mesh (triggers debounced update)
    await page.fill('#text-input', 'UncommittedRollback');
    await page.waitForTimeout(600);

    const liveTree = await page.evaluate((objId) => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects.find((o) => o.id === objId);
      return obj ? obj.volumes.map((v) => ({ id: v.id, name: v.name })) : [];
    }, currentObjIdAfterRedo);
    const liveVol = liveTree.find((v) => v.name === 'UncommittedRollback');
    assert.ok(liveVol, 'Live uncommitted update must reflect in model before close');

    // Close panel without committing: must roll back to committed state (OrcaEdit)
    const closeBtn = await page.waitForSelector('#close-text-btn', { timeout: 5000 });
    await closeBtn.click();
    await page.waitForFunction(() => {
      return document.getElementById('text-emboss-panel') === null;
    }, null, { timeout: 5000 });

    const afterRollback = await page.evaluate((objId) => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects.find((o) => o.id === objId);
      return obj ? obj.volumes.map((v) => ({ id: v.id, name: v.name })) : [];
    }, currentObjIdAfterRedo);
    const rolledBackVol = afterRollback.find((v) => v.name === 'OrcaEdit');
    assert.ok(rolledBackVol, 'Uncommitted live edit must roll back to committed OrcaEdit on panel close');
    results.push({ name: 'Uncommitted live edit rolls back on panel close', pass: true });

    // 10. Verify custom font upload and font reselect UI elements
    console.log(`[${browserName}] Verifying font reselect and custom upload elements...`);
    await textToolBtn.click();
    await page.waitForSelector('#text-emboss-panel', { timeout: 5000 });

    const fileInput = await page.waitForSelector('#custom-font-file-input', { state: 'attached', timeout: 5000 });
    assert.ok(fileInput, 'Custom font file input must exist');

    // Trigger font reselect state
    await page.evaluate(() => {
      window.__textStore?.setState({ fontMissingName: 'TestCrossSessionFont', selectedFont: null });
    });
    await page.waitForSelector('#font-reselect-banner', { timeout: 5000 });
    const reselectBtn = await page.waitForSelector('#reselect-font-btn', { timeout: 5000 });
    assert.ok(reselectBtn, 'Reselect font button must appear when custom font is unavailable');

    await page.evaluate(() => {
      window.__textStore?.setState({ fontMissingName: null, error: null });
    });

    const finalCloseBtn = await page.waitForSelector('#close-text-btn', { timeout: 5000 });
    await finalCloseBtn.click();
    await page.waitForFunction(() => {
      return document.getElementById('text-emboss-panel') === null;
    }, null, { timeout: 5000 });
    results.push({ name: 'Font reselect UI banner and upload elements verified', pass: true });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `text-tool-view-${browserName}.png`) });

    await context.close();
    await browser.close();

    console.log(`\n[${browserName}] All tests passed!`);
    for (const r of results) {
      console.log(`  ✓ ${r.name}`);
    }

    assert.equal(pageErrors.length, 0, `Page errors occurred: ${pageErrors.join(', ')}`);
  } catch (err) {
    await browser.close();
    throw err;
  }
}

async function main() {
  try {
    await startServer(PORT, 'text');

    // Run Chromium suite
    await runBrowserTextSuite(chromium, 'chromium');

    // Run Firefox suite
    await runBrowserTextSuite(firefox, 'firefox');

    console.log(`\n==================================================`);
    console.log(`All 3D Text Browser Suites Passed on Chromium & Firefox!`);
    console.log(`==================================================\n`);
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
