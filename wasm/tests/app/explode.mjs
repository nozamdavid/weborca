#!/usr/bin/env node
/** Browser test of the explode view: slider moves scene meshes radially apart without affecting store/engine transforms. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5141', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  const addCube = async (targetCount) => {
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction(
      (n) => window.__plateStore?.getState().objects.length === n,
      targetCount,
      { timeout: 120000 }
    );
    await page.waitForTimeout(500);
  };

  const getMeshPositions = () => page.evaluate(() => {
    const scene = window.__plateScene;
    const meshes = [...scene.objectMeshes.values()];
    return meshes.map((m) => ({ x: m.position.x, y: m.position.y, z: m.position.z }));
  });

  const getStoreOffsets = () => page.evaluate(() => {
    return window.__plateStore.getState().objects.map((o) => [...o.instances[0].offset]);
  });

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.selectOption('#vendor-select', 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.waitForTimeout(2000);

    log('add two cubes');
    await addCube(1);
    await page.evaluate(() => {
      const s = window.__plateStore.getState();
      return s.setInstanceTransform(s.objects[0].id, s.objects[0].instances[0].id, { offset: [110, 150, 0] });
    });
    await addCube(2);
    await page.evaluate(() => {
      const s = window.__plateStore.getState();
      return s.setInstanceTransform(s.objects[1].id, s.objects[1].instances[0].id, { offset: [190, 150, 0] });
    });
    await page.waitForTimeout(1000);

    const initialMeshes = await getMeshPositions();
    const initialOffsets = await getStoreOffsets();
    assert.equal(initialMeshes.length, 2, 'Should have 2 meshes in scene');
    const initialDist = Math.hypot(
      initialMeshes[0].x - initialMeshes[1].x,
      initialMeshes[0].y - initialMeshes[1].y,
      initialMeshes[0].z - initialMeshes[1].z
    );

    log('open explode panel');
    if ((await page.locator('#tool-explode-btn').count()) > 0) {
      await page.click('#tool-explode-btn');
    } else {
      await page.click('button:has-text("View")');
      await page.click('#menu-view-explode');
    }
    await page.waitForSelector('#explode-panel');

    log('set slider to 50% and verify meshes moved apart while store offsets are unchanged');
    await page.locator('#explode-slider').fill('50');
    await page.waitForTimeout(500);

    const explodedMeshes = await getMeshPositions();
    const explodedOffsets = await getStoreOffsets();
    const explodedDist = Math.hypot(
      explodedMeshes[0].x - explodedMeshes[1].x,
      explodedMeshes[0].y - explodedMeshes[1].y,
      explodedMeshes[0].z - explodedMeshes[1].z
    );

    assert.ok(
      explodedDist > initialDist + 20,
      `Meshes should have moved apart: initial ${initialDist}, exploded ${explodedDist}`
    );
    assert.deepEqual(explodedOffsets, initialOffsets, 'Store object offsets must remain unchanged');

    log('close panel and assert positions are restored');
    await page.click('#explode-close');
    await page.waitForSelector('#explode-panel', { state: 'detached' });
    await page.waitForTimeout(500);

    const restoredMeshes = await getMeshPositions();
    const restoredDist = Math.hypot(
      restoredMeshes[0].x - restoredMeshes[1].x,
      restoredMeshes[0].y - restoredMeshes[1].y,
      restoredMeshes[0].z - restoredMeshes[1].z
    );
    assert.ok(
      Math.abs(restoredDist - initialDist) < 0.01,
      `Mesh distance should be restored: initial ${initialDist}, restored ${restoredDist}`
    );
    for (let i = 0; i < 2; i++) {
      assert.ok(Math.abs(restoredMeshes[i].x - initialMeshes[i].x) < 0.01);
      assert.ok(Math.abs(restoredMeshes[i].y - initialMeshes[i].y) < 0.01);
      assert.ok(Math.abs(restoredMeshes[i].z - initialMeshes[i].z) < 0.01);
    }

    log('all explode checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'explode');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All explode tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Explode tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
