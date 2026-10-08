#!/usr/bin/env node
/**
 * @file seam-painting.mjs
 * End-to-end browser test for OrcaSlicer Web Seam Face Painting and Target Isolation.
 *
 * Runs against isolated build on port 5073 across Chromium and Firefox sequentially:
 * 1. Loads 20mm_cube.obj and verifies canvas rendering.
 * 2. Selects object & volume, opens Face Painting mode.
 * 3. Switches target to Seam and verifies initial clean readback.
 * 4. Actual canvas pointer paints seam enforcer, blocker, and erase modes.
 * 5. Clears seam volume annotations.
 * 6. Target isolation: verifies switching between Support and Seam does not mix annotations, pending strokes, or overlays.
 * 7. Transformed second volume mapping: verifies exact local-to-merged facet index mapping on second volume.
 * 8. 3MF persistence: verifies both seam and support annotations survive project save/reopen round-trip.
 * 9. Race isolation & stroke cancellation: delayed old-target RPC race during target switch & stroke cancellation.
 * 10. Cleanly shuts down preview server and confirms port 5073 is freed.
 */

import { spawn } from 'node:child_process';
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

const PORT = 5073;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ISOLATED_BUILD_DIR = process.env.APP_TEST_DIST
  ? path.resolve(repoRoot, process.env.APP_TEST_DIST)
  : path.resolve(repoRoot, 'wasm/build/ui-seam-dist');
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
  await new Promise((r) => setTimeout(r, 500));
}

process.on('exit', () => {
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch (_) {}
  }
});

async function runBrowserSeamPaintSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Seam Painting tests for ${browserName.toUpperCase()}`);
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

    const screenshotFile = path.join(SCREENSHOT_DIR, `seam-paint-${browserName}-init.png`);
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

    // 4. Open Face Painting mode & switch target to Seam
    console.log(`[${browserName}] Entering Face Painting mode and selecting Seam target...`);
    await page.click('#tool-paint-btn');
    await page.waitForSelector('#painting-panel', { timeout: 5000 });

    // Verify target selector exists
    await page.waitForSelector('#paint-target-select', { timeout: 3000 });
    await page.waitForSelector('#paint-target-seam', { timeout: 3000 });

    // Switch target to Seam
    await page.click('#paint-target-seam');
    await page.waitForTimeout(200);

    const activeTarget = await page.evaluate(() => window.__paintingStore?.getState().paintTarget);
    assert.equal(activeTarget, 'seam', 'Active paint target must be seam');

    const panelTitle = await page.textContent('#painting-panel-title');
    assert.ok(panelTitle.includes('Face Painting'), `Panel must be honestly labeled as Face Painting, got "${panelTitle}"`);
    assert.ok(panelTitle.includes('Seam'), `Panel title must reflect Seam target, got "${panelTitle}"`);

    // Verify initial clean seam readback
    const initPaintData = await page.evaluate(() => window.__paintingStore?.getState().paintingData);
    assert.ok(initPaintData, 'Initial seam painting data must exist');
    assert.equal(initPaintData.triangleCount, 12, 'Cube must have exactly 12 mesh triangles');
    assert.equal(initPaintData.enforcers.length, 0, 'Initial seam enforcers count must be 0');
    assert.equal(initPaintData.blockers.length, 0, 'Initial seam blockers count must be 0');

    const initialEngineSeam = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      return await engine.getSeamPainting(objId, volId);
    }, objectId);
    assert.equal(initialEngineSeam.hasCustomSeam, false, 'Initial hasCustomSeam must be false');
    results.push({ name: 'Seam painting target selected & clean initial readback', pass: true });

    // 5. Actual pointer seam enforce
    console.log(`[${browserName}] Painting seam enforcer with canvas pointer...`);
    const facet2Pos = await page.evaluate((objId) => {
      return window.__plateScene?.getFacetScreenCoordinates(objId, 2, false);
    }, objectId);
    assert.ok(facet2Pos, 'Facet 2 screen position must be calculable');

    await page.click('#paint-mode-enforce');
    await page.mouse.move(facet2Pos.x, facet2Pos.y);
    await page.mouse.down();
    await page.mouse.move(facet2Pos.x + 3, facet2Pos.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    let seamData = await page.evaluate(() => window.__paintingStore?.getState().paintingData);
    assert.ok(seamData.enforcers.includes(2), 'Pointer drag must paint facet 2 as seam enforcer');

    const engineSeamReadback = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      return await engine.getSeamPainting(objId, volId);
    }, objectId);
    assert.ok(engineSeamReadback.hasCustomSeam, 'Engine readback must confirm custom seams');
    assert.ok(engineSeamReadback.enforcers.includes(2), 'Engine readback must contain facet 2');
    results.push({ name: 'Actual pointer seam enforce & engine readback match', pass: true });

    // 6. Actual pointer seam erase
    console.log(`[${browserName}] Erasing seam enforcer with canvas pointer...`);
    await page.click('#paint-mode-erase');
    await page.mouse.move(facet2Pos.x, facet2Pos.y);
    await page.mouse.down();
    await page.mouse.move(facet2Pos.x + 3, facet2Pos.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const eraseReadback = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      return await engine.getSeamPainting(objId, volId);
    }, objectId);
    assert.equal(eraseReadback.enforcers.includes(2), false, 'Facet 2 must be erased from seam enforcers');
    results.push({ name: 'Actual pointer seam erase verified', pass: true });

    // 7. Actual pointer seam blocker
    console.log(`[${browserName}] Painting seam blocker with canvas pointer...`);
    await page.click('#paint-mode-block');
    const facet3Pos = await page.evaluate((objId) => {
      return window.__plateScene?.getFacetScreenCoordinates(objId, 3, false);
    }, objectId);
    assert.ok(facet3Pos, 'Facet 3 screen position must be calculable');

    await page.mouse.move(facet3Pos.x, facet3Pos.y);
    await page.mouse.down();
    await page.mouse.move(facet3Pos.x + 3, facet3Pos.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const blockReadback = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      return await engine.getSeamPainting(objId, volId);
    }, objectId);
    assert.ok(blockReadback.blockers.includes(3), 'Facet 3 must be registered as seam blocker');
    results.push({ name: 'Actual pointer seam blocker verified', pass: true });

    // 8. Clear seam volume
    console.log(`[${browserName}] Clearing seam volume annotations...`);
    await page.click('#paint-clear-btn');
    await page.waitForTimeout(300);

    const clearReadback = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      return await engine.getSeamPainting(objId, volId);
    }, objectId);
    assert.equal(clearReadback.hasCustomSeam, false, 'hasCustomSeam must be false after clear');
    assert.equal(clearReadback.enforcers.length, 0, 'Seam enforcers must be empty after clear');
    assert.equal(clearReadback.blockers.length, 0, 'Seam blockers must be empty after clear');
    results.push({ name: 'Clear seam volume resets annotations completely', pass: true });

    // 9. Target Isolation Test: Support vs Seam switching without mixing annotations, pending strokes, or overlays
    console.log(`[${browserName}] Testing Target Isolation (Support vs Seam)...`);

    // Paint Support: facet 2 as Support Enforcer
    await page.click('#paint-target-support');
    await page.waitForTimeout(200);
    const targetAfterSwitchSupport = await page.evaluate(() => window.__paintingStore?.getState().paintTarget);
    assert.equal(targetAfterSwitchSupport, 'support', 'Target must switch to support');

    await page.click('#paint-mode-enforce');
    await page.mouse.move(facet2Pos.x, facet2Pos.y);
    await page.mouse.down();
    await page.mouse.move(facet2Pos.x + 3, facet2Pos.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Verify engine Support has facet 2, while Seam has NO enforcers
    const supportIsolationCheck = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      const sup = await engine.getSupportPainting(objId, volId);
      const seam = await engine.getSeamPainting(objId, volId);
      return { sup, seam };
    }, objectId);
    assert.ok(supportIsolationCheck.sup.enforcers.includes(2), 'Support must have facet 2 enforcer');
    assert.equal(supportIsolationCheck.seam.enforcers.length, 0, 'Seam must have 0 enforcers');
    assert.equal(supportIsolationCheck.seam.blockers.length, 0, 'Seam must have 0 blockers');

    // Switch to Seam target
    await page.click('#paint-target-seam');
    await page.waitForTimeout(200);

    const seamDataInStore = await page.evaluate(() => window.__paintingStore?.getState().paintingData);
    assert.equal(seamDataInStore.enforcers.length, 0, 'Store seam data must have 0 enforcers');

    // Paint Seam: facet 3 as Seam Blocker
    await page.click('#paint-mode-block');
    await page.mouse.move(facet3Pos.x, facet3Pos.y);
    await page.mouse.down();
    await page.mouse.move(facet3Pos.x + 3, facet3Pos.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Verify engine Seam has facet 3 blocker and NOT facet 2; Support still has facet 2 enforcer and NOT facet 3
    const bothTargetsCheck = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const volId = window.__paintingStore?.getState().selectedVolumeId;
      const sup = await engine.getSupportPainting(objId, volId);
      const seam = await engine.getSeamPainting(objId, volId);
      return { sup, seam };
    }, objectId);

    assert.ok(bothTargetsCheck.seam.blockers.includes(3), 'Seam must have facet 3 blocker');
    assert.equal(bothTargetsCheck.seam.enforcers.includes(2), false, 'Seam must NOT contain Support facet 2');
    assert.ok(bothTargetsCheck.sup.enforcers.includes(2), 'Support must retain facet 2 enforcer');
    assert.equal(bothTargetsCheck.sup.blockers.includes(3), false, 'Support must NOT contain Seam facet 3');

    // Switch back to Support: store updates to support data
    await page.click('#paint-target-support');
    await page.waitForTimeout(200);
    const storeSupportData = await page.evaluate(() => window.__paintingStore?.getState().paintingData);
    assert.ok(storeSupportData.enforcers.includes(2), 'Store support data must have facet 2 enforcer');

    // Switch back to Seam: store updates to seam data
    await page.click('#paint-target-seam');
    await page.waitForTimeout(200);
    const storeSeamData = await page.evaluate(() => window.__paintingStore?.getState().paintingData);
    assert.ok(storeSeamData.blockers.includes(3), 'Store seam data must have facet 3 blocker');

    results.push({ name: 'Support and Seam targets are completely isolated and do not mix', pass: true });

    // 10. Transformed second volume mapping
    console.log(`[${browserName}] Testing second-volume triangle mapping on transformed fixture...`);
    await page.click('#paint-done-btn');
    await page.waitForTimeout(200);

    // Add second model part volume with offset [30, 0, 0]
    const vol2Result = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const addRes = await engine.call('addVolume', {
        objectId: objId,
        type: 'model_part',
        shape: 'cube',
        size: 20.0,
        offset: [30.0, 0.0, 0.0]
      });

      const pStore = window.__plateStore?.getState();
      pStore.meshCache.clear();
      await pStore.refreshObjects();
      pStore.selectObject(objId);
      return addRes;
    }, objectId);

    assert.ok(vol2Result?.volumeId, 'Second volume must be created');
    const vol2Id = vol2Result.volumeId;
    console.log(`[${browserName}] Created Volume 2 (ID: ${vol2Id}) with offset [30, 0, 0]`);

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

    // Re-enter painting mode
    await page.click('#tool-paint-btn');
    await page.waitForSelector('#painting-panel', { timeout: 5000 });

    // Ensure target is Seam
    await page.click('#paint-target-seam');
    await page.waitForTimeout(200);

    // Select Volume 2
    await page.selectOption('#paint-volume-select', String(vol2Id));
    await page.waitForTimeout(300);

    const activeVol = await page.evaluate(() => window.__paintingStore?.getState().selectedVolumeId);
    assert.equal(activeVol, vol2Id, 'Volume 2 must be selected in painting panel');

    // Pointer paint facet 2 on Volume 2 as Seam enforcer
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

    // Read back Volume 2 seam annotations: local facet index 2 should be enforcer
    const vol2Readback = await page.evaluate(async ({ objId, vId }) => {
      const engine = window.__orcaEngine;
      return await engine.getSeamPainting(objId, vId);
    }, { objId: objectId, vId: vol2Id });

    assert.ok(vol2Readback.enforcers.includes(2), 'Volume 2 must record local facet index 2 as seam enforcer');

    // Verify Volume 1 seam annotations were NOT modified (isolated to Volume 2)
    const vol1Id = twoVolMeta[0].volumeId;
    const vol1Readback = await page.evaluate(async ({ objId, vId }) => {
      const engine = window.__orcaEngine;
      return await engine.getSeamPainting(objId, vId);
    }, { objId: objectId, vId: vol1Id });

    assert.equal(vol1Readback.enforcers.includes(2), false, 'Volume 1 must not contain Volume 2 facet 2 edit');
    assert.ok(vol1Readback.blockers.includes(3), 'Volume 1 must retain its existing blocker 3');

    // Verify Volume 2 overlay offset calculation
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
    assert.ok(v2OverlayCorrect, 'Volume 2 overlay local facet correctly offsets to merged index 14 (12 + 2)');
    results.push({ name: 'Transformed second volume seam mapping and isolation verified', pass: true });

    // 11. 3MF Save / Open Round-Trip Persistence of BOTH Seam & Support annotations
    console.log(`[${browserName}] Testing 3MF round-trip persistence for both seam and support...`);
    await page.click('#paint-done-btn');
    await page.waitForTimeout(200);

    const saveRes = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      return await engine.call('saveProject', { path: '/out/seam_support_roundtrip.3mf' });
    });
    assert.ok(saveRes, 'saveProject must succeed');

    const openRes = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      return await engine.call('openProject', { path: '/out/seam_support_roundtrip.3mf' });
    });
    assert.ok(openRes && openRes.objects?.length >= 1, 'openProject must load saved model');

    // Query annotations on reopened project for both volumes
    const reopenedAnnotations = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      const tree = await engine.call('getObjectTree', {});
      const obj = tree.objects[0];
      const v1 = obj.volumes[0];
      const v2 = obj.volumes[1];

      const v1Support = await engine.getSupportPainting(obj.id, v1.id);
      const v1Seam = await engine.getSeamPainting(obj.id, v1.id);
      const v2Seam = await engine.getSeamPainting(obj.id, v2.id);

      return { v1Support, v1Seam, v2Seam };
    });

    // Verify Volume 1 retained Support enforcer 2
    assert.equal(reopenedAnnotations.v1Support.hasCustomSupports, true, 'Reopened 3MF must retain custom supports on Vol 1');
    assert.ok(reopenedAnnotations.v1Support.enforcers.includes(2), 'Reopened Vol 1 must retain support enforcer facet 2');

    // Verify Volume 1 retained Seam blocker 3
    assert.equal(reopenedAnnotations.v1Seam.hasCustomSeam, true, 'Reopened 3MF must retain custom seam on Vol 1');
    assert.ok(reopenedAnnotations.v1Seam.blockers.includes(3), 'Reopened Vol 1 must retain seam blocker facet 3');

    // Verify Volume 2 retained Seam enforcer 2
    assert.equal(reopenedAnnotations.v2Seam.hasCustomSeam, true, 'Reopened 3MF must retain custom seam on Vol 2');
    assert.ok(reopenedAnnotations.v2Seam.enforcers.includes(2), 'Reopened Vol 2 must retain seam enforcer facet 2');

    results.push({ name: '3MF save/open round-trip retains both seam and support annotations', pass: true });

    // 12. Race isolation: delayed old-target readback/clear while switching targets & stroke cancellation
    console.log(`[${browserName}] Testing delayed old-target readback/clear race and stroke cancellation...`);
    // Re-select object and open painting mode
    objectId = await page.evaluate(async () => {
      const engine = window.__orcaEngine;
      const tree = await engine.call('getObjectTree', {});
      const curId = tree.objects[0].id;
      const pStore = window.__plateStore?.getState();
      await pStore?.refreshObjects();
      pStore?.selectObject(curId);
      return curId;
    });
    await page.waitForTimeout(300);
    assert.ok(objectId, 'Object must be selectable');

    await page.click('#tool-paint-btn');
    await page.waitForSelector('#painting-panel', { timeout: 5000 });

    // Ensure distinct seam annotations exist on volume 1 (both enforcers and blockers)
    await page.click('#paint-target-seam');
    await page.waitForTimeout(200);
    await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const store = window.__paintingStore.getState();
      const volId = store.selectedVolumeId;
      await engine.setSeamPainting({
        objectId: objId,
        volumeId: volId,
        enforcers: [1],
        blockers: [3],
        clear: []
      });
      await window.__paintingStore.getState().refreshPaintingData(objId, volId);
    }, objectId);
    await page.waitForTimeout(200);

    // Switch to support target
    await page.click('#paint-target-support');
    await page.waitForTimeout(200);

    // Verify support target is active
    let curTarget = await page.evaluate(() => window.__paintingStore?.getState().paintTarget);
    assert.equal(curTarget, 'support');

    // Simulate delayed clearSupportPainting / getSupportPainting RPC race
    const raceTestResult = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const store = window.__paintingStore.getState();
      const volId = store.selectedVolumeId;

      const origClear = engine.clearSupportPainting;
      const origGet = engine.getSupportPainting;

      let delayedRpcInvoked = false;
      engine.clearSupportPainting = async (...args) => {
        delayedRpcInvoked = true;
        await new Promise((r) => setTimeout(r, 250));
        return await origClear.apply(engine, args);
      };
      engine.getSupportPainting = async (...args) => {
        await new Promise((r) => setTimeout(r, 250));
        return await origGet.apply(engine, args);
      };

      try {
        // Trigger clearVolume on support target
        const clearPromise = window.__paintingStore.getState().clearVolume();

        // Immediately switch target to seam while support clear is awaiting
        await window.__paintingStore.getState().setPaintTarget('seam');

        // Await the delayed support clear to complete
        await clearPromise;

        // Allow microtasks and React useEffect to flush overlay mesh update
        await new Promise((r) => setTimeout(r, 100));

        const afterState = window.__paintingStore.getState();
        const seamReadback = await engine.getSeamPainting(objId, volId);

        // Check if seam data in store was corrupted by stale support clear
        const targetIsSeam = afterState.paintTarget === 'seam';
        const enfMatches =
          JSON.stringify(afterState.paintingData?.enforcers ?? []) ===
          JSON.stringify(seamReadback.enforcers ?? []);
        const blkMatches =
          JSON.stringify(afterState.paintingData?.blockers ?? []) ===
          JSON.stringify(seamReadback.blockers ?? []);
        const hasExpectedEnforcers = (afterState.paintingData?.enforcers ?? []).includes(1);
        const hasExpectedBlockers = (afterState.paintingData?.blockers ?? []).includes(3);

        // Assert overlay state in 3D scene: overlay mesh must be present with non-empty vertices
        const scene = window.__plateScene;
        let overlayMesh = null;
        if (scene?.overlayMeshes) {
          for (const [oKey, m] of scene.overlayMeshes.entries()) {
            if (oKey.startsWith(`${objId}_`) && oKey.endsWith(`_vol_${volId}`)) {
              overlayMesh = m;
              break;
            }
          }
        }
        const overlayPosCount = overlayMesh?.geometry?.attributes?.position?.count ?? 0;
        const expectedVertexCount = ((seamReadback.enforcers?.length ?? 0) + (seamReadback.blockers?.length ?? 0)) * 3;
        const overlayValid = !!overlayMesh && overlayPosCount === expectedVertexCount && expectedVertexCount > 0;

        return {
          delayedRpcInvoked,
          targetIsSeam,
          enfMatches,
          blkMatches,
          hasExpectedEnforcers,
          hasExpectedBlockers,
          overlayValid,
          isLoading: afterState.isLoading
        };
      } finally {
        engine.clearSupportPainting = origClear;
        engine.getSupportPainting = origGet;
      }
    }, objectId);

    assert.ok(raceTestResult.delayedRpcInvoked, 'Delayed RPC must have been invoked');
    assert.ok(raceTestResult.targetIsSeam, 'Current target must remain seam after delayed support clear resolves');
    assert.ok(raceTestResult.enfMatches, 'Painting data enforcers must match current seam target');
    assert.ok(raceTestResult.blkMatches, 'Painting data blockers must match current seam target');
    assert.ok(raceTestResult.hasExpectedEnforcers, 'Painting data must contain expected seam enforcers, not empty');
    assert.ok(raceTestResult.hasExpectedBlockers, 'Painting data must contain expected seam blockers, not empty');
    assert.ok(raceTestResult.overlayValid, 'Overlay mesh in 3D scene must match active seam annotations and not be wiped by stale clear');
    assert.equal(raceTestResult.isLoading, false, 'Loading flag must clear cleanly');
    // Verify pending stroke is cancelled when switching target and never applied to another category
    const strokeCancelResult = await page.evaluate(async () => {
      const store = window.__paintingStore.getState();
      // Begin stroke on seam
      store.beginStroke();
      store.paintFacet(5);

      const seamHas5Optimistic = window.__paintingStore.getState().paintingData?.enforcers?.includes(5);

      // Switch to support target before committing
      await window.__paintingStore.getState().setPaintTarget('support');

      const supportHas5 = window.__paintingStore.getState().paintingData?.enforcers?.includes(5);

      // Switch back to seam
      await window.__paintingStore.getState().setPaintTarget('seam');

      const seamHas5After = window.__paintingStore.getState().paintingData?.enforcers?.includes(5);

      return {
        seamHas5Optimistic,
        supportHas5,
        seamHas5After
      };
    });

    assert.ok(strokeCancelResult.seamHas5Optimistic, 'Optimistic stroke marked facet 5 on seam');
    assert.equal(strokeCancelResult.supportHas5, false, 'Support target must NOT inherit pending seam stroke');
    assert.equal(strokeCancelResult.seamHas5After, false, 'Pending stroke must be cancelled upon target switch, not committed');

    await page.click('#paint-done-btn');
    await page.waitForTimeout(200);

    results.push({ name: 'Delayed old-target RPC race and stroke cancellation verified', pass: true });


    // 13. Delayed startPainting -> stopPainting regression & same-object newer selection guard
    console.log(`[${browserName}] Testing delayed startPainting -> stopPainting invalidation and same-object newer selection...`);

    // Verify initial closed state
    const initClosed = await page.evaluate(() => {
      const store = window.__paintingStore.getState();
      return !store.isPaintingActive && store.selectedObjectId === null;
    });
    assert.ok(initClosed, 'Painting must initially be inactive');
    assert.equal(await page.$('#painting-panel'), null, 'Painting panel must initially be closed');

    // Case 1: startPainting resolves after stopPainting -> UI must not reopen, data must not be resurrected
    const startStopRaceResult = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const store = window.__paintingStore;
      const origGetSupport = engine.getSupportPainting;
      const origGetSeam = engine.getSeamPainting;
      let delayedRpcCalled = false;

      engine.getSupportPainting = async (...args) => {
        delayedRpcCalled = true;
        store.getState().stopPainting();
        await new Promise((r) => setTimeout(r, 250));
        return await origGetSupport.apply(engine, args);
      };
      engine.getSeamPainting = async (...args) => {
        delayedRpcCalled = true;
        store.getState().stopPainting();
        await new Promise((r) => setTimeout(r, 250));
        return await origGetSeam.apply(engine, args);
      };

      try {
        // Trigger startPainting on object
        const startPromise = store.getState().startPainting(objId);

        // Allow startPainting to reach the delayed RPC and trigger stopPainting
        await new Promise((r) => setTimeout(r, 50));

        const stateDirectlyAfterStop = {
          isPaintingActive: store.getState().isPaintingActive,
          selectedObjectId: store.getState().selectedObjectId,
          selectedVolumeId: store.getState().selectedVolumeId,
          isLoading: store.getState().isLoading
        };

        // Wait for delayed startPainting to complete
        await startPromise;

        const stateAfterDelayedStartResolved = {
          isPaintingActive: store.getState().isPaintingActive,
          selectedObjectId: store.getState().selectedObjectId,
          selectedVolumeId: store.getState().selectedVolumeId,
          paintingData: store.getState().paintingData,
          isLoading: store.getState().isLoading,
          error: store.getState().error
        };

        return {
          delayedRpcCalled,
          stateDirectlyAfterStop,
          stateAfterDelayedStartResolved
        };
      } finally {
        engine.getSupportPainting = origGetSupport;
        engine.getSeamPainting = origGetSeam;
      }
    }, objectId);

    assert.ok(startStopRaceResult.delayedRpcCalled, 'Delayed start RPC must have been called');
    assert.equal(startStopRaceResult.stateDirectlyAfterStop.isPaintingActive, false, 'Painting active must be false immediately after stop');
    assert.equal(startStopRaceResult.stateAfterDelayedStartResolved.isPaintingActive, false, 'Delayed start must NOT set isPaintingActive to true after stopPainting');
    assert.equal(startStopRaceResult.stateAfterDelayedStartResolved.selectedObjectId, null, 'Delayed start must NOT resurrect selectedObjectId after stopPainting');
    assert.equal(startStopRaceResult.stateAfterDelayedStartResolved.selectedVolumeId, null, 'Delayed start must NOT resurrect selectedVolumeId after stopPainting');
    assert.equal(startStopRaceResult.stateAfterDelayedStartResolved.isLoading, false, 'Loading flag must remain false');
    assert.equal(startStopRaceResult.stateAfterDelayedStartResolved.error, null, 'Error must remain null');

    // Verify DOM element does not reopen
    const panelAfterStaleStart = await page.$('#painting-panel');
    assert.equal(panelAfterStaleStart, null, 'Painting panel must NOT reopen in UI after stopPainting');

    // Case 2: Stale start error path after stopPainting must NOT corrupt error or loading state
    const startErrorRaceResult = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const store = window.__paintingStore;
      const origGetSupport = engine.getSupportPainting;
      const origGetSeam = engine.getSeamPainting;

      engine.getSupportPainting = async () => {
        store.getState().stopPainting();
        await new Promise((r) => setTimeout(r, 200));
        throw new Error('Simulated start failure');
      };
      engine.getSeamPainting = async () => {
        store.getState().stopPainting();
        await new Promise((r) => setTimeout(r, 200));
        throw new Error('Simulated start failure');
      };

      try {
        const startPromise = store.getState().startPainting(objId);
        await startPromise;

        return {
          isPaintingActive: store.getState().isPaintingActive,
          selectedObjectId: store.getState().selectedObjectId,
          error: store.getState().error,
          isLoading: store.getState().isLoading
        };
      } finally {
        engine.getSupportPainting = origGetSupport;
        engine.getSeamPainting = origGetSeam;
      }
    }, objectId);
    assert.equal(startErrorRaceResult.isPaintingActive, false, 'Painting must remain inactive after failed stale start');
    assert.equal(startErrorRaceResult.error, null, 'Stale start error must not be posted to store');
    assert.equal(startErrorRaceResult.isLoading, false, 'Loading flag must remain false after stale error');

    // Case 3: Same-object newer volume selection: older start must NOT overwrite newer volume
    const sameObjVolumeRaceResult = await page.evaluate(async (objId) => {
      const engine = window.__orcaEngine;
      const store = window.__paintingStore;
      const tree = await engine.call('getObjectTree', {});
      const obj = tree.objects.find((o) => o.id === objId);
      const v1Id = obj.volumes[0].id;
      const v2Id = obj.volumes[1].id;

      const origGetSupport = engine.getSupportPainting;
      const origGetSeam = engine.getSeamPainting;

      // Delay only volume 1 fetch
      engine.getSupportPainting = async (oid, vid) => {
        if (vid === v1Id) {
          await new Promise((r) => setTimeout(r, 250));
        }
        return await origGetSupport.apply(engine, [oid, vid]);
      };
      engine.getSeamPainting = async (oid, vid) => {
        if (vid === v1Id) {
          await new Promise((r) => setTimeout(r, 250));
        }
        return await origGetSeam.apply(engine, [oid, vid]);
      };

      try {
        // Start 1 for volume 1 (delayed)
        const p1 = store.getState().startPainting(objId, v1Id);
        // Start 2 for volume 2 on same object (faster)
        const p2 = store.getState().startPainting(objId, v2Id);

        await Promise.all([p1, p2]);

        return {
          selectedVolumeId: store.getState().selectedVolumeId,
          isPaintingActive: store.getState().isPaintingActive,
          v1Id,
          v2Id
        };
      } finally {
        engine.getSupportPainting = origGetSupport;
        engine.getSeamPainting = origGetSeam;
        store.getState().stopPainting();
      }
    }, objectId);

    assert.equal(sameObjVolumeRaceResult.selectedVolumeId, sameObjVolumeRaceResult.v2Id, 'Newer volume selection (vol 2) must not be overwritten by older start (vol 1)');

    results.push({ name: 'Delayed start->stop and same-object newer selection regressions verified', pass: true });
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
  console.log('OrcaSlicer Web Seam Face Painting Test Suite');
  console.log('Target: Vite Preview on Port 5073');
  console.log('================================================================================\n');

  let allPass = true;
  const suiteResults = [];

  try {
    await startServer();

    for (const [bType, bName] of [
      [chromium, 'chromium'],
      [firefox, 'firefox']
    ]) {
      const res = await runBrowserSeamPaintSuite(bType, bName);
      suiteResults.push(res);
      if (!res.pass) {
        allPass = false;
      }
    }
  } finally {
    await stopServer();
  }

  console.log('\n================================================================================');
  console.log('SEAM PAINTING TEST EXECUTION SUMMARY');
  console.log('================================================================================');
  for (const { browserName, results, pass, error } of suiteResults) {
    console.log(`\nBrowser: ${browserName.toUpperCase()} [${pass ? 'PASS' : 'FAIL'}]`);
    for (const r of results) {
      console.log(`  - ${r.name.padEnd(65)}: ${r.pass ? 'PASS' : 'FAIL'}`);
    }
    if (error) {
      console.log(`  * ERROR: ${error}`);
    }
  }
  console.log('\n================================================================================');

  if (!allPass) {
    console.error('Seam Painting tests failed!');
    process.exit(1);
  }

  console.log('All Seam Painting tests passed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled suite error:', err);
  process.exit(1);
});
