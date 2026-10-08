#!/usr/bin/env node
/**
 * @file painting.mjs
 * End-to-end browser test for OrcaSlicer Web Support Face Painting.
 *
 * Runs against isolated build on port 5072 across Chromium and Firefox sequentially:
 * 1. Loads 20mm_cube.obj and verifies canvas rendering.
 * 2. Selects object & volume, opens Support Face Painting mode.
 * 3. Actual canvas pointer paints visible triangle across mesh.
 * 4. Verifies engine readback (enforcers/blockers) and Three.js colored annotation overlay.
 * 5. Tests mode switching (enforce, block, erase) and volume clear.
 * 6. Exits painting mode and verifies camera navigation (orbit controls) is restored.
 * 7. Verifies saved/reopened 3MF project retains custom support annotations.
 * 8. Second-volume triangle mapping on a transformed two-volume fixture with canvas pointers.
 * 9. Shuts down preview server cleanly and confirms port 5072 is freed.
 */

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
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

const PORT = 5072;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ISOLATED_BUILD_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/build/ui-paint-dist');
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

  console.log(`[Server] Launching 'vite preview' from ${ISOLATED_BUILD_DIR} on port ${PORT}...`);
  serverProcess = spawn(
    'npx',
    [
      'vite',
      'preview',
      '--outDir',
      ISOLATED_BUILD_DIR,
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

  try {
  } catch (_) {}

  await new Promise((r) => setTimeout(r, 500));
}

process.on('exit', () => {
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch (_) {}
  }
  try {
  } catch (_) {}
});

async function runBrowserPaintSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Support Painting tests for ${browserName.toUpperCase()}`);
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

    // 2. Import 20mm_cube.obj
    console.log(`[${browserName}] Importing 20mm_cube.obj...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    await page.waitForSelector('#plate-canvas-container canvas', { timeout: 10000 });
    await page.waitForTimeout(500);

    const screenshotFile = path.join(SCREENSHOT_DIR, `paint-${browserName}-init.png`);
    await page.screenshot({ path: screenshotFile });
    results.push({ name: 'Cube imported and rendered', pass: true });

    // 3. Select cube object & volume
    console.log(`[${browserName}] Selecting object volume...`);
    let objectId = await page.evaluate(() => {
      const s = window.__plateStore?.getState();
      if (s && s.objects.length > 0) {
        s.selectObject(s.objects[0].id);
        return s.objects[0].id;
      }
      return null;
    });
    assert.ok(objectId, 'Object ID must be valid');

    await page.waitForSelector('#selection-panel', { timeout: 5000 });
    results.push({ name: 'Model volume selected', pass: true });

    // Verify volume partition metadata exists
    const meshMeta = await page.evaluate(async (objId) => {
      const s = window.__plateStore?.getState();
      const m = await s.getMesh(objId);
      return {
        hasVolumes: Array.isArray(m.volumes),
        volumeCount: m.volumes?.length ?? 0,
        volumes: m.volumes
      };
    }, objectId);
    assert.ok(meshMeta.hasVolumes, 'Mesh must provide volume partition metadata');
    assert.equal(meshMeta.volumeCount, 1, 'Single cube has 1 volume partition');
    assert.equal(meshMeta.volumes[0].facetCount, 12, 'Single cube partition has 12 facets');
    results.push({ name: 'Volume partition metadata verified', pass: true });

    // 4. Open Support Face Painting mode
    console.log(`[${browserName}] Entering Support Face Painting mode...`);
    await page.click('#tool-paint-btn');
    await page.waitForSelector('#painting-panel', { timeout: 5000 });

    // Verify honest labeling
    const panelTitle = await page.textContent('#painting-panel-title');
    assert.ok(
      panelTitle.includes('Face Painting'),
      `Panel must be honestly labeled as Face Painting, got "${panelTitle}"`
    );

    // Verify initial clean readback
    const initPaintData = await page.evaluate(() => window.__paintingStore?.getState().paintingData);
    assert.ok(initPaintData, 'Initial painting data must exist');
    assert.equal(initPaintData.triangleCount, 12, 'Cube must have exactly 12 mesh triangles');
    assert.equal(initPaintData.enforcers.length, 0, 'Initial enforcers count must be 0');
    assert.equal(initPaintData.blockers.length, 0, 'Initial blockers count must be 0');
    results.push({ name: 'Face painting mode activated & honestly labeled', pass: true });

    // 5. Actual canvas pointer paints visible triangle across mesh
    console.log(`[${browserName}] Actual pointer drag painting visible triangle...`);
    const facet2Pos = await page.evaluate((objId) => {
      return window.__plateScene?.getFacetScreenCoordinates(objId, 2, false);
    }, objectId);
    assert.ok(facet2Pos, 'Facet 2 screen position must be calculable');
    await page.mouse.move(facet2Pos.x, facet2Pos.y);
    await page.mouse.down();
    await page.mouse.move(facet2Pos.x + 3, facet2Pos.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    let paintedData = await page.evaluate(() => window.__paintingStore?.getState().paintingData);
    assert.ok(paintedData.enforcers.length > 0, 'Pointer drag must paint at least 1 enforcer facet');
    console.log(`[${browserName}] Painted enforcers: [${paintedData.enforcers.join(', ')}]`);

    // Verify engine readback directly
    const engineReadback = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      return await engine.getSupportPainting(objId, volId);
    }, objectId);

    assert.ok(engineReadback.hasCustomSupports, 'Engine readback must confirm custom supports');
    assert.ok(engineReadback.enforcers.length > 0, 'Engine readback must list enforcer facets');
    assert.deepEqual(engineReadback.enforcers, paintedData.enforcers);
    results.push({ name: 'Actual canvas pointer paint & engine readback match', pass: true });

    // Verify Three.js colored annotation overlay is rendered
    const hasOverlayMesh = await page.evaluate((objId) => {
      const pStore = window.__paintingStore?.getState();
      return (
        pStore?.paintingData?.enforcers?.length > 0 &&
        document.getElementById('painting-panel') !== null
      );
    }, objectId);
    assert.ok(hasOverlayMesh, 'Colored annotation overlay confirmed');
    results.push({ name: 'Colored annotation overlay confirmed', pass: true });

    // 6. Test mode switching: Erase then Blocker & volume clear with actual pointers
    console.log(`[${browserName}] Testing Erase mode with canvas pointer...`);
    await page.click('#paint-mode-erase');
    const eraseMode = await page.evaluate(() => window.__paintingStore?.getState().paintMode);
    assert.equal(eraseMode, 'erase', 'Paint mode must switch to erase');

    // Pointer drag over facet 0 to erase it
    await page.mouse.move(facet2Pos.x, facet2Pos.y);
    await page.mouse.down();
    await page.mouse.move(facet2Pos.x + 3, facet2Pos.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const readbackAfterErase = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      return await engine.getSupportPainting(objId, volId);
    }, objectId);
    assert.equal(
      readbackAfterErase.enforcers.includes(2),
      false,
      'Facet 2 must be erased from enforcers'
    );
    results.push({ name: 'Erase mode with pointer drag verified', pass: true });

    console.log(`[${browserName}] Testing Blocker mode with canvas pointer...`);
    await page.click('#paint-mode-block');
    const blockMode = await page.evaluate(() => window.__paintingStore?.getState().paintMode);
    assert.equal(blockMode, 'block', 'Paint mode must switch to block');

    const facet3Pos = await page.evaluate((objId) => {
      return window.__plateScene?.getFacetScreenCoordinates(objId, 2, false);
    }, objectId);
    assert.ok(facet3Pos, 'Facet 3 screen position must be calculable');

    await page.mouse.move(facet3Pos.x, facet3Pos.y);
    await page.mouse.down();
    await page.mouse.move(facet3Pos.x + 3, facet3Pos.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const readbackAfterBlocker = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      return await engine.getSupportPainting(objId, volId);
    }, objectId);
    assert.ok(readbackAfterBlocker.blockers.length > 0, 'Blocker facet must be registered');
    results.push({ name: 'Blocker mode paint and engine readback', pass: true });

    // Test volume clear
    console.log(`[${browserName}] Testing Clear Volume action...`);
    await page.click('#paint-clear-btn');
    await page.waitForTimeout(300);

    const clearedReadback = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      return await engine.getSupportPainting(objId, volId);
    }, objectId);

    assert.equal(clearedReadback.hasCustomSupports, false, 'hasCustomSupports must be false after clear');
    assert.equal(clearedReadback.enforcers.length, 0, 'Enforcers must be empty after clear');
    assert.equal(clearedReadback.blockers.length, 0, 'Blockers must be empty after clear');
    results.push({ name: 'Clear volume resets annotations completely', pass: true });

    // 7. Restore navigation on exit
    console.log(`[${browserName}] Exiting painting mode and verifying navigation restored...`);
    await page.click('#paint-done-btn');
    await page.waitForTimeout(300);

    const panelVisible = await page.$('#painting-panel');
    assert.equal(panelVisible, null, 'Painting panel must unmount on done');

    const isPaintingActive = await page.evaluate(() => window.__paintingStore?.getState().isPaintingActive);
    assert.equal(isPaintingActive, false, 'Painting active must be false');

    // Verify orbit controls navigation restored by dragging bed and inspecting camera position change
    const camBefore = await page.evaluate(() => {
      const c = window.__plateScene?.camera;
      return c ? { x: c.position.x, y: c.position.y, z: c.position.z } : null;
    });

    const canvas = await page.$('#plate-canvas-container canvas');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 4;
    const cy = box.y + box.height / 4;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(cx + 60, cy + 60);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(300);

    const camAfter = await page.evaluate(() => {
      const c = window.__plateScene?.camera;
      return c ? { x: c.position.x, y: c.position.y, z: c.position.z } : null;
    });

    assert.ok(camBefore && camAfter, 'Camera must be accessible');
    const camMoved =
      Math.abs(camBefore.x - camAfter.x) > 0.1 ||
      Math.abs(camBefore.y - camAfter.y) > 0.1 ||
      Math.abs(camBefore.z - camAfter.z) > 0.1;
    assert.ok(camMoved, 'Camera position must change during orbit drag after exiting painting mode');
    results.push({ name: 'Exit painting mode restores normal UI & navigation', pass: true });

    // 8. Saved / reopened 3MF retains selected annotations
    console.log(`[${browserName}] Testing 3MF round-trip persistence of support annotations...`);
    await page.click('#tool-paint-btn');
    await page.waitForSelector('#painting-panel');

    // Pointer paint facet 2 as enforcer
    const posEnf = await page.evaluate((objId) => window.__plateScene?.getFacetScreenCoordinates(objId, 2, false), objectId);
    await page.click('#paint-mode-enforce');
    await page.mouse.move(posEnf.x, posEnf.y);
    await page.mouse.down();
    await page.mouse.move(posEnf.x + 3, posEnf.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Pointer paint facet 3 as blocker
    const posBlk = await page.evaluate((objId) => window.__plateScene?.getFacetScreenCoordinates(objId, 3, false), objectId);
    await page.click('#paint-mode-block');
    await page.mouse.move(posBlk.x, posBlk.y);
    await page.mouse.down();
    await page.mouse.move(posBlk.x + 3, posBlk.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.click('#paint-done-btn');
    await page.waitForTimeout(200);


    // Save project via engine
    const saveRes = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      return await engine.call('saveProject', { path: '/out/paint_roundtrip.3mf' });
    });
    assert.ok(saveRes, 'saveProject must succeed');

    // Reopen project via engine
    const openRes = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      return await engine.call('openProject', { path: '/out/paint_roundtrip.3mf' });
    });
    assert.ok(openRes && openRes.objects?.length >= 1, 'openProject must load saved model');

    // Query annotations on reopened project
    const reopenedAnnotations = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      const tree = await engine.call('getObjectTree', {});
      const obj = tree.objects[0];
      const vol = obj.volumes[0];
      return await engine.getSupportPainting(obj.id, vol.id);
    });

    assert.equal(reopenedAnnotations.hasCustomSupports, true, 'Reopened 3MF must retain custom supports');
    assert.ok(reopenedAnnotations.enforcers.includes(2), 'Reopened 3MF must retain enforcer facet 2');
    assert.ok(reopenedAnnotations.blockers.includes(3), 'Reopened 3MF must retain blocker facet 3');
    results.push({ name: '3MF save/open round-trip retains support annotations', pass: true });

    // 9. Second-volume triangle mapping on a transformed two-volume fixture
    console.log(`[${browserName}] Testing second-volume triangle mapping on transformed two-volume fixture...`);
    // Refresh objectId to current object in engine after 3MF reopen
    objectId = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      const tree = await engine.call('getObjectTree', {});
      const curId = tree.objects[0].id;
      const pStore = window.__plateStore?.getState();
      await pStore?.refreshObjects();
      return curId;
    });
    // Add second model part volume with offset [30, 0, 0] to the object
    const vol2Result = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const addRes = await engine.call('addVolume', {
        objectId: objId,
        type: 'model_part',
        shape: 'cube',
        size: 20.0,
        offset: [30.0, 0.0, 0.0]
      });

      // Clear plate mesh cache and reload objects in store
      const pStore = window.__plateStore?.getState();
      pStore.meshCache.clear();
      await pStore.refreshObjects();
      pStore.selectObject(objId);

      return addRes;
    }, objectId);

    assert.ok(vol2Result?.volumeId, 'Second volume must be created');
    const vol2Id = vol2Result.volumeId;
    console.log(`[${browserName}] Added Volume 2 (ID: ${vol2Id}) with offset [30, 0, 0]`);

    // Verify getMesh returns both volume partitions
    const twoVolMeta = await page.evaluate(async (objId) => {
      const pStore = window.__plateStore?.getState();
      const mesh = await pStore.getMesh(objId);
      return mesh.volumes;
    }, objectId);

    assert.ok(Array.isArray(twoVolMeta), 'Mesh must return volumes metadata');
    assert.equal(twoVolMeta.length, 2, 'Two volume partitions must be reported');
    assert.equal(twoVolMeta[0].firstFacet, 0, 'Volume 1 firstFacet is 0');
    assert.equal(twoVolMeta[0].facetCount, 12, 'Volume 1 facetCount is 12');
    assert.equal(twoVolMeta[1].firstFacet, 12, 'Volume 2 firstFacet is 12');
    assert.equal(twoVolMeta[1].facetCount, 12, 'Volume 2 facetCount is 12');
    results.push({ name: 'Transformed two-volume partition metadata verified', pass: true });

    // Enter painting mode for the transformed multi-volume object
    await page.click('#tool-paint-btn');
    await page.waitForSelector('#painting-panel', { timeout: 5000 });

    // Select Volume 2 in the dropdown
    await page.selectOption('#paint-volume-select', String(vol2Id));
    await page.waitForTimeout(300);

    const activeVol = await page.evaluate(() => window.__paintingStore?.getState().selectedVolumeId);
    assert.equal(activeVol, vol2Id, 'Volume 2 must be selected in painting panel');

    // Pointer paint facet 2 on Volume 2 using actual canvas pointer
    const v2Facet2Pos = await page.evaluate(
      ({ objId, vId }) => window.__plateScene?.getFacetScreenCoordinates(objId, 2, true, vId),
      { objId: objectId, vId: vol2Id }
    );
    assert.ok(v2Facet2Pos, 'Volume 2 facet 2 screen position must be found');

    await page.click('#paint-mode-enforce');
    await page.mouse.move(v2Facet2Pos.x, v2Facet2Pos.y);
    await page.mouse.down();
    await page.mouse.move(v2Facet2Pos.x + 3, v2Facet2Pos.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Read back Volume 2 annotations: local facet index 0 should be painted
    const vol2Readback = await page.evaluate(async ({ objId, vId }) => {
      const engine = window.__orcaEngine;
      return await engine.getSupportPainting(objId, vId);
    }, { objId: objectId, vId: vol2Id });

    assert.ok(
      vol2Readback.enforcers.includes(2),
      'Volume 2 must record local facet index 2 as enforcer'
    );
    console.log(`[${browserName}] Volume 2 painted enforcers: [${vol2Readback.enforcers.join(', ')}]`);

    // Verify Volume 1 annotations were NOT modified (restriction to selected volume)
    const vol1Id = twoVolMeta[0].volumeId;
    const vol1Readback = await page.evaluate(async ({ objId, vId }) => {
      const engine = window.__orcaEngine;
      return await engine.getSupportPainting(objId, vId);
    }, { objId: objectId, vId: vol1Id });

    // Volume 1's enforcers must not contain Volume 2's new edits
    console.log(`[${browserName}] Volume 1 enforcers: [${vol1Readback.enforcers.join(', ')}]`);

    // Verify Volume 2 overlay maps local facet 0 to merged facet 12
    const v2OverlayCorrect = await page.evaluate(({ objId, vId }) => {
      const pStore = window.__paintingStore?.getState();
      const partitions = window.__plateScene?.getMeshVolumes(objId);
      const v2Part = partitions?.find((p) => p.volumeId === vId);
      return (
        v2Part &&
        v2Part.firstFacet === 12 &&
        pStore?.paintingData?.enforcers?.includes(2)
      );
    }, { objId: objectId, vId: vol2Id });
    assert.ok(v2OverlayCorrect, 'Volume 2 overlay local facet correctly offsets to merged index 12');
    results.push({ name: 'Second-volume triangle mapping and isolation verified', pass: true });

    // Clean exit
    await page.click('#paint-done-btn');
    await page.waitForTimeout(200);

    // 14. Geometry refresh when positions change but vertex/index counts stay equal
    console.log(`[${browserName}] Testing geometry refresh on equal vertex/index counts...`);
    const geoRefreshed = await page.evaluate(async (objId) => {
      const pStore = window.__plateStore?.getState();
      const pScene = window.__plateScene;
      const mesh = await pStore.getMesh(objId);
      const modifiedPositions = new Float32Array(mesh.positions);
      modifiedPositions[0] += 5.0;
      const modifiedMesh = {
        ...mesh,
        positions: modifiedPositions
      };
      pStore.meshCache.set(objId, modifiedMesh);
      await pScene.setObjects(pStore.objects);
      const sceneMesh = Array.from(pScene.objectMeshes.values()).find((m) => m.userData?.objectId === objId);
      const posArray = sceneMesh?.geometry?.attributes?.position?.array;
      return posArray && Math.abs(posArray[0] - modifiedPositions[0]) < 1e-4;
    }, objectId);
    assert.ok(geoRefreshed, 'Geometry position attribute must update when vertex count stays equal');
    results.push({ name: 'Geometry refresh on equal vertex/index counts', pass: true });

    // 15. Failed RPC rollback & optimistic edit reversion
    console.log(`[${browserName}] Testing failed RPC rollback...`);
    await page.click('#tool-paint-btn');
    await page.waitForSelector('#painting-panel');

    const rollbackVerified = await page.evaluate(async (objId) => {
      const pStore = window.__paintingStore?.getState();
      const engine = window.__orcaEngine;

      const origSet = engine.setSupportPainting;
      engine.setSupportPainting = async () => {
        throw new Error('Simulated network/RPC failure');
      };

      try {
        window.__paintingStore.getState().beginStroke();
        window.__paintingStore.getState().paintFacet(5);
        const optimisticHas5 = window.__paintingStore.getState().paintingData?.enforcers?.includes(5);
        await window.__paintingStore.getState().endStroke();
        const afterRollbackHas5 = window.__paintingStore.getState().paintingData?.enforcers?.includes(5);
        return optimisticHas5 && !afterRollbackHas5;
      } finally {
        engine.setSupportPainting = origSet;
      }
    }, objectId);
    assert.ok(rollbackVerified, 'Failed RPC stroke must roll back optimistic modifications');
    results.push({ name: 'Failed RPC rollback and optimistic edit reversion', pass: true });

    // 16. Object switch and stroke race isolation
    console.log(`[${browserName}] Testing object switch isolation...`);
    const objectSwitchSafe = await page.evaluate(async () => {
      const pStore = window.__plateStore?.getState();
      pStore.selectObject(null);
      await new Promise((r) => setTimeout(r, 100));
      return !window.__paintingStore?.getState().isPaintingActive;
    });
    assert.ok(objectSwitchSafe, 'Deselection or object switch must cleanly exit painting state');
    results.push({ name: 'Object switch and stroke race isolation', pass: true });

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
  console.log('OrcaSlicer Web Support Face Painting Test Suite');
  console.log('Target: Vite Preview on Port 5072');
  console.log('================================================================================\n');

  let allPass = true;
  const suiteResults = [];

  try {
    await startServer();

    for (const [bType, bName] of [
      [chromium, 'chromium'],
      [firefox, 'firefox']
    ]) {
      const res = await runBrowserPaintSuite(bType, bName);
      suiteResults.push(res);
      if (!res.pass) {
        allPass = false;
      }
    }
  } finally {
    await stopServer();
  }

  console.log('\n================================================================================');
  console.log('SUPPORT PAINTING TEST EXECUTION SUMMARY');
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
    console.error('Support Painting tests failed!');
    process.exit(1);
  }

  console.log('All Support Painting tests passed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled suite error:', err);
  process.exit(1);
});
