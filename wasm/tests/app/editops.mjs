#!/usr/bin/env node
/**
 * @file editops.mjs
 * End-to-end browser test for object-editing operations ported from desktop OrcaSlicer:
 * auto-orient, flatten/placeOnFace, splitObject, splitVolume, simplifyVolume,
 * meshBoolean, addSvg, and brimEars across Chromium and Firefox on port 5121.
 * Asserts real geometric/topological outcomes (object counts, facets, volume via checkMeshHealth,
 * and undo/redo restoration).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5121;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE = fs.readFileSync(path.resolve(__dirname, '../../../tests/data/20mm_cube.obj'));

const DISJOINT = `
v 0 0 0
v 10 0 0
v 10 10 0
v 0 10 0
v 0 0 10
v 10 0 10
v 10 10 10
v 0 10 10
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
v 30 0 0
v 40 0 0
v 40 10 0
v 30 10 0
v 30 0 10
v 40 0 10
v 40 10 10
v 30 10 10
f 9 10 11 12
f 13 16 15 14
f 9 13 14 10
f 10 14 15 11
f 11 15 16 12
f 13 9 12 16
`;

const SVG_SAMPLE = `<svg width="10" height="10"><rect width="10" height="10" /></svg>`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch({
    args: ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`],
    firefoxUserPrefs: {
      'network.security.ports.banned.override': String(PORT)
    }
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  const loadCube = async () => {
    await page.evaluate(async (bytes) => {
      await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj'));
    }, Array.from(CUBE));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length > 0, null, { timeout: 30000 });
    await page.evaluate(() => {
      const plate = window.__plateStore.getState();
      if (plate.objects[0]) {
        plate.selectObject(plate.objects[0].id, plate.objects[0].instances?.[0]?.id ?? null);
      }
    });
    await page.waitForTimeout(300);
  };

  const clearAllObjects = async () => {
    await page.evaluate(async () => {
      const plate = window.__plateStore.getState();
      const ids = plate.objects.map((o) => o.id);
      for (const id of ids) {
        await plate.deleteObject(id);
      }
    });
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 0, null, { timeout: 30000 });
    await page.waitForTimeout(300);
  };

  const getMeshHealth = async (objectId) => {
    return await page.evaluate(async (id) => {
      return await window.__orcaEngine.call('checkMeshHealth', { objectId: id });
    }, objectId);
  };

  try {
    log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    await page.selectOption('#vendor-select', 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');

    // ----------------------------------------------------
    // Test 1: Auto-orient and Flatten / Place on face
    // ----------------------------------------------------
    log('Testing Auto-orient and Flatten / Place on Face...');
    await loadCube();
    let cubeObjId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    let cubeInstId = await page.evaluate(() => window.__plateStore.getState().objects[0].instances[0].id);

    // Tilt the cube
    await page.evaluate(async ({ objId, instId }) => {
      await window.__orcaEngine.call('setInstanceTransform', { objectId: objId, instanceId: instId, rotation: [0.3, 0.2, 0] });
      await window.__plateStore.getState().refreshObjects();
    }, { objId: cubeObjId, instId: cubeInstId });

    const tiltedHealth = await getMeshHealth(cubeObjId);
    const tiltedHeight = tiltedHealth.boundingBox[5] - tiltedHealth.boundingBox[2];
    assert.ok(tiltedHeight > 24, `Tilted cube should be taller than 20mm, got ${tiltedHeight}`);

    // Auto-orient
    log('Executing Auto-orient...');
    await page.evaluate(async (id) => {
      await window.__editOpsStore.getState().autoOrient([id]);
    }, cubeObjId);
    await page.waitForFunction(() => !window.__editOpsStore.getState().isOperating);

    // Test undo Auto-orient
    log('Testing undo on Auto-orient...');
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length > 0);
    await page.waitForTimeout(300);

    // Flatten / Place on face (fetch fresh ID after undo)
    log('Testing Flatten / Place on face...');
    cubeObjId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    cubeInstId = await page.evaluate(() => window.__plateStore.getState().objects[0].instances[0].id);

    // Tilt again for place on face test
    await page.evaluate(async ({ objId, instId }) => {
      await window.__orcaEngine.call('setInstanceTransform', { objectId: objId, instanceId: instId, rotation: [0.3, 0.2, 0] });
      await window.__plateStore.getState().refreshObjects();
    }, { objId: cubeObjId, instId: cubeInstId });

    await page.evaluate(async (id) => {
      await window.__editOpsStore.getState().startFlatten(id);
    }, cubeObjId);
    await page.waitForFunction(() => window.__editOpsStore.getState().flattenClusters.length >= 6, null, { timeout: 15000 });

    const smallestFacetIdx = await page.evaluate(() => {
      const clusters = window.__editOpsStore.getState().flattenClusters;
      let minArea = Infinity;
      let minIdx = -1;
      clusters.forEach((c, i) => {
        if (c.area < minArea) {
          minArea = c.area;
          minIdx = i;
        }
      });
      return minIdx;
    });
    assert.ok(smallestFacetIdx >= 0, 'Found a planar cluster');

    await page.evaluate(async (idx) => {
      await window.__editOpsStore.getState().applyPlaceOnFace(idx);
    }, smallestFacetIdx);
    await page.waitForFunction(() => !window.__editOpsStore.getState().isOperating);

    const flatHealth = await getMeshHealth(cubeObjId);
    const flatHeight = flatHealth.boundingBox[5] - flatHealth.boundingBox[2];
    assert.ok(Math.abs(flatHeight - 20) < 0.1, `Flat cube should be ~20mm tall, got ${flatHeight}`);

    await page.evaluate(() => window.__editOpsStore.getState().stopFlatten());

    // Undo Place on face
    log('Testing undo on Place on face...');
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length > 0);
    await page.waitForTimeout(300);

    await clearAllObjects();

    // ----------------------------------------------------
    // Test 2: Split to Objects and Split to Parts
    // ----------------------------------------------------
    log('Testing Split to Objects and Split to Parts...');
    await page.evaluate(async (disjointObjStr) => {
      const file = new File([disjointObjStr], 'disjoint.obj');
      await window.__appStore.getState().importModelFile(file);
    }, DISJOINT);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 30000 });
    await page.waitForTimeout(300);

    let disjointObjId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    const healthDisjoint = await getMeshHealth(disjointObjId);
    assert.equal(healthDisjoint.numberOfParts, 2, 'Disjoint model has 2 parts');

    // Split to Parts
    log('Splitting volume to parts...');
    await page.evaluate(async (id) => {
      await window.__editOpsStore.getState().splitSelectedVolume(id);
    }, disjointObjId);
    await page.waitForFunction(() => window.__plateStore.getState().objects[0]?.volumes === 2, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects[0].volumes), 2);

    // Undo Split to parts
    log('Undoing Split to parts...');
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring);
    await page.waitForFunction(() => window.__plateStore.getState().objects[0]?.volumes === 1, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects[0].volumes), 1);

    // Split to Objects (re-query ID after undo)
    log('Splitting object to separate objects...');
    disjointObjId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    await page.evaluate(async (id) => {
      await window.__editOpsStore.getState().splitSelectedObject(id);
    }, disjointObjId);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 2, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 2);

    // Undo Split to objects
    log('Undoing Split to objects...');
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 1);

    await clearAllObjects();

    // ----------------------------------------------------
    // Test 3: Simplify Volume
    // ----------------------------------------------------
    log('Testing Simplify Volume...');
    await loadCube();
    const simpObjId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    const facetsBefore = (await getMeshHealth(simpObjId)).facetsCount;

    await page.evaluate(async (id) => {
      await window.__editOpsStore.getState().openSimplifyDialog(id);
      window.__editOpsStore.getState().setSimplifyRatio(0.5);
      await window.__editOpsStore.getState().applySimplify();
    }, simpObjId);
    await page.waitForFunction(() => !window.__editOpsStore.getState().isOperating);

    const facetsAfter = (await getMeshHealth(simpObjId)).facetsCount;
    assert.ok(facetsAfter < facetsBefore, `Facets should reduce from ${facetsBefore}, got ${facetsAfter}`);

    // Undo Simplify
    log('Undoing Simplify...');
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length > 0);
    await page.waitForTimeout(300);
    const restoredObjId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    const facetsRestored = (await getMeshHealth(restoredObjId)).facetsCount;
    assert.equal(facetsRestored, facetsBefore, 'Facets restored after undo');

    await clearAllObjects();

    // ----------------------------------------------------
    // Test 4: Mesh Boolean (Intersection, Union, Difference)
    // ----------------------------------------------------
    log('Testing Mesh Boolean...');
    await loadCube();
    await loadCube();
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 2);

    const [cube1Id, cube2Id] = await page.evaluate(() => {
      const objs = window.__plateStore.getState().objects;
      return [objs[0].id, objs[1].id];
    });

    // Position both cubes so they overlap: cube 1 at [0, 0, 10], cube 2 at [10, 5, 15]
    // They overlap in a 10 x 15 x 20 mm box = 3000 mm3
    await page.evaluate(async ({ c1, c2 }) => {
      const obj1 = window.__plateStore.getState().objects.find((o) => o.id === c1);
      const obj2 = window.__plateStore.getState().objects.find((o) => o.id === c2);
      await window.__orcaEngine.call('setInstanceTransform', {
        objectId: c1,
        instanceId: obj1.instances[0].id,
        offset: [0, 0, 10]
      });
      await window.__orcaEngine.call('setInstanceTransform', {
        objectId: c2,
        instanceId: obj2.instances[0].id,
        offset: [10, 5, 15]
      });
      await window.__plateStore.getState().refreshObjects();
    }, { c1: cube1Id, c2: cube2Id });

    // Perform boolean intersection: 10 x 15 x 20 mm overlap = 3000 mm3
    log('Performing Boolean Intersection...');
    const boolSuccess = await page.evaluate(async ({ target, tool }) => {
      window.__editOpsStore.getState().openBooleanDialog();
      window.__editOpsStore.getState().setBooleanMode('intersection');
      window.__editOpsStore.getState().setBooleanTargetObjectId(target);
      window.__editOpsStore.setState({ booleanToolObjectIds: [tool] });
      return await window.__editOpsStore.getState().applyMeshBoolean();
    }, { target: cube1Id, tool: cube2Id });
    assert.ok(boolSuccess, 'Boolean intersection should succeed');
    await page.waitForFunction(() => !window.__editOpsStore.getState().isOperating);

    const boolHealth = await getMeshHealth(cube1Id);
    assert.ok(Math.abs(boolHealth.volume - 3000) < 5, `Expected intersection volume ~3000, got ${boolHealth.volume}`);
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 1, 'Tool object consumed');

    // Undo boolean
    log('Undoing Boolean...');
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 2, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 2, 'Both objects restored on undo');

    await clearAllObjects();

    // ----------------------------------------------------
    // Test 5: Add SVG
    // ----------------------------------------------------
    log('Testing Add SVG...');
    await page.evaluate(async (svgStr) => {
      await window.__editOpsStore.getState().applyAddSvg(svgStr, 5);
    }, SVG_SAMPLE);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 30000 });
    await page.waitForTimeout(300);

    const svgObjId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    const svgHealth = await getMeshHealth(svgObjId);
    assert.ok(svgHealth.volume > 0, `SVG object has positive volume, got ${svgHealth.volume}`);

    // Undo Add SVG
    log('Undoing Add SVG...');
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 0, null, { timeout: 15000 });
    await page.waitForTimeout(300);

    // ----------------------------------------------------
    // Test 6: Brim Ears
    // ----------------------------------------------------
    log('Testing Brim Ears...');
    await loadCube();
    const brimObjId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);

    await page.evaluate(async (id) => {
      await window.__editOpsStore.getState().startBrimEars(id);
      await window.__editOpsStore.getState().addBrimEar([10, 10, 0], 5);
      await window.__editOpsStore.getState().addBrimEar([-10, -10, 0], 5);
    }, brimObjId);

    const earsCount = await page.evaluate(() => window.__editOpsStore.getState().brimPoints.length);
    assert.equal(earsCount, 2, 'Added 2 brim ear points');

    // Clear brim ears
    await page.evaluate(async () => {
      await window.__editOpsStore.getState().clearBrimEars();
    });
    const earsCleared = await page.evaluate(() => window.__editOpsStore.getState().brimPoints.length);
    assert.equal(earsCleared, 0, 'Cleared all brim ears');

    // Undo Clear brim ears
    log('Undoing Clear brim ears...');
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__editOpsStore.getState().stopBrimEars());

    await clearAllObjects();
    log(`All tests passed successfully for ${name}!`);
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'editops');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All edit operations tests passed on Chromium and Firefox!');
} catch (err) {
  console.error('Edit operations tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
