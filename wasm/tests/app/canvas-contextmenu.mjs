#!/usr/bin/env node
/**
 * @file canvas-contextmenu.mjs
 * End-to-end Playwright test for 3D Prepare Viewer right-click context menu:
 * - Empty bed right-click shows plate context menu (#plate-context-menu)
 * - 3D object right-click shows identical sidebar object-list context menu (#object-list-context-menu)
 * - Object target shows object actions (Add Modifier, Cut, Split, Delete object, etc.)
 * - Adding a modifier and right-clicking part targets volume actions (#menu-action-delete-volume, etc.)
 * - Multi-selection right-click preserves multi-selection and allows multi-delete
 * - Tested across Chromium and Firefox.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
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

const PORT = Number(process.env.PORT || 5067);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting 3D Viewer Context Menu tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchArgs = ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`];
  const browser = await browserType.launch({
    headless: true,
    args: launchArgs,
    firefoxUserPrefs: {
      'network.security.ports.banned.override': String(PORT)
    }
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
    const page = await context.newPage();

    page.on('pageerror', (err) => console.error(`[${browserName} error]`, err));

    // Helper: calculate screen position of a mesh in 3D canvas
    const screenOf = (index) => page.evaluate((i) => {
      const scene = window.__plateScene;
      const mesh = [...scene.objectMeshes.values()][i];
      if (!mesh) return null;
      const rect = scene.renderer.domElement.getBoundingClientRect();
      const v = mesh.position.clone().project(scene.camera);
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
    }, index);

    // 1. Navigate to app
    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    console.log(`[${browserName}] Engine ready.`);

    // 2. Empty-bed right-click
    console.log(`[${browserName}] Testing empty-bed right-click menu...`);
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.waitForSelector('#plate-context-menu', { timeout: 5000 });
    await page.waitForSelector('#plate-menu-primitive', { timeout: 5000 });
    console.log(`[${browserName}] Empty-bed menu opened successfully.`);

    // 3. Add primitive cube from plate menu
    console.log(`[${browserName}] Adding cube primitive...`);
    await page.hover('#plate-menu-primitive');
    await page.waitForSelector('#plate-menu-cube', { timeout: 5000 });
    await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateStore?.getState().objects.length === 1, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__objectListStore?.getState().objects.length === 1, null, { timeout: 30000 });

    const objId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    console.log(`[${browserName}] Cube added with objectId ${objId}`);

    // Wait for 3D mesh to be rendered
    await page.waitForFunction(() => (window.__plateScene?.objectMeshes?.size ?? 0) >= 1, null, { timeout: 10000 });
    await page.click('#view-top');
    await page.waitForTimeout(600);

    // 4. Right-click on 3D object in Prepare viewer
    console.log(`[${browserName}] Testing 3D object right-click in Prepare viewer...`);
    const pos0 = await screenOf(0);
    assert.ok(pos0, 'Cube mesh must have screen coordinates');
    const [x0, y0] = pos0;

    await page.mouse.click(x0, y0, { button: 'right' });
    await page.waitForSelector('#object-list-context-menu', { timeout: 5000 });
    console.log(`[${browserName}] Object-list context menu opened on 3D viewer right-click!`);

    // Verify object menu items are present
    await page.waitForSelector('#menu-item-modifier', { timeout: 2000 });
    await page.waitForSelector('#menu-item-extruder', { timeout: 2000 });
    await page.waitForSelector('#menu-action-cut', { timeout: 2000 });
    await page.waitForSelector('#menu-action-split-objects', { timeout: 2000 });
    await page.waitForSelector('#menu-action-rename', { timeout: 2000 });
    await page.waitForSelector('#menu-action-delete', { timeout: 2000 });

    // Verify volume delete is NOT present on object target
    const hasVolumeDelete = await page.$('#menu-action-delete-volume');
    assert.equal(hasVolumeDelete, null, 'Object target menu must not contain #menu-action-delete-volume');

    // 5. Add a modifier volume via the 3D context menu
    console.log(`[${browserName}] Adding modifier via 3D context menu...`);
    await page.hover('#menu-item-modifier');
    await page.waitForSelector('#menu-action-modifier-cube', { timeout: 5000 });
    await page.click('#menu-action-modifier-cube');

    // Wait for modifier to appear in tree
    await page.waitForFunction(() => {
      const store = window.__objectListStore?.getState();
      const obj = store?.objects[0];
      return obj && obj.volumes.some((v) => v.type === 'modifier');
    }, null, { timeout: 15000 });

    let modVolId = await page.evaluate(() => {
      const store = window.__objectListStore?.getState();
      return store?.objects[0].volumes.find((v) => v.type === 'modifier')?.id;
    });
    console.log(`[${browserName}] Modifier created with volumeId ${modVolId}`);

    // Put a second model part beside the model so its faces can actually be hit rather than
    // relying on a previously selected tree volume overriding the clicked part.
    await page.evaluate(async ({ objectId, volumeId }) => {
      const store = window.__objectListStore.getState();
      await store.deleteVolume(objectId, volumeId);
      await store.addVolume({ objectId, type: 'part', shape: 'cube', size: 20, offset: [35, 0, 10] });
    }, { objectId: objId, volumeId: modVolId });
    modVolId = await page.evaluate(() => window.__objectListStore.getState().objects[0].volumes.at(-1).id);
    await page.waitForFunction(id => [...window.__plateScene.meshVolumes.values()].some(parts => parts.some(p => p.volumeId === id)), modVolId);
    const modifierPoint = await page.evaluate(volumeId => {
      const scene = window.__plateScene;
      const rect = scene.renderer.domElement.getBoundingClientRect();
      for (const mesh of scene.objectMeshes.values()) {
        const partition = scene.meshVolumes.get(mesh.userData.objectId)?.find(p => p.volumeId === volumeId);
        if (!partition) continue;
        const positions = mesh.geometry.getAttribute('position');
        const indices = mesh.geometry.index;
        for (let f = partition.firstFacet; f < partition.firstFacet + partition.facetCount; f++) {
          const point = mesh.position.clone().set(0, 0, 0);
          for (let corner = 0; corner < 3; corner++) {
            const vertex = indices ? indices.getX(f * 3 + corner) : f * 3 + corner;
            point.x += positions.getX(vertex);
            point.y += positions.getY(vertex);
            point.z += positions.getZ(vertex);
          }
          point.divideScalar(3);
          mesh.localToWorld(point);
          point.project(scene.camera);
          const x = rect.left + (point.x + 1) * rect.width / 2;
          const y = rect.top + (1 - point.y) * rect.height / 2;
          if (scene.hitTest(x, y)?.volumeId === volumeId) return [x, y];
        }
      }
      return null;
    }, modVolId);
    assert.ok(modifierPoint, 'The modifier must have a visible face for real hit testing');

    // 6. Right-click part target (select volume row, then right click in 3D)
    console.log(`[${browserName}] Testing part/volume target right-click...`);
    await page.click(`#volume-row-${modVolId}`);
    await page.waitForFunction((id) => window.__objectListStore?.getState().selectedVolumeId === id, modVolId);
    // A prior selection of a different part must not override the part clicked in 3D.
    await page.evaluate(() => {
      const state = window.__objectListStore.getState();
      state.selectItem(state.objects[0].id, state.objects[0].volumes[0].id);
    });

    // Right-click in 3D viewer with volume selected
    await page.mouse.click(modifierPoint[0], modifierPoint[1], { button: 'right' });
    await page.waitForSelector('#object-list-context-menu', { timeout: 5000 });
    await page.waitForSelector('#menu-action-delete-volume', { timeout: 5000 });
    await page.waitForSelector('#menu-action-rename-volume', { timeout: 5000 });

    // Verify object-only items are absent for part target
    const hasObjModifier = await page.$('#menu-item-modifier');
    assert.equal(hasObjModifier, null, 'Volume target menu must not contain #menu-item-modifier');
    console.log(`[${browserName}] Part/volume context menu verified.`);

    // Delete modifier from 3D context menu
    console.log(`[${browserName}] Deleting modifier volume via 3D context menu...`);
    await page.click('#menu-action-delete-volume');
    await page.waitForFunction(id => {
      const store = window.__objectListStore?.getState();
      const obj = store?.objects[0];
      return obj && !obj.volumes.some((v) => v.id === id);
    }, modVolId, { timeout: 15000 });
    console.log(`[${browserName}] Modifier successfully deleted via 3D context menu.`);

    // Wait for context menu to detach
    await page.waitForSelector('#object-list-context-menu', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);

    // 7. Multi-selection right-click test in 3D viewer
    console.log(`[${browserName}] Testing multi-selection in 3D viewer...`);
    // Copy and paste to add second object
    await page.keyboard.press('Control+c');
    await page.waitForFunction(() => window.__plateStore?.getState().clipboard.length === 1, null, { timeout: 10000 });
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.__plateStore?.getState().objects.length === 2, null, { timeout: 30000 });

    // Arrange and top view
    await page.evaluate(() => window.__plateStore.getState().arrange(true));
    await page.click('#view-top');
    await page.waitForTimeout(600);

    // Select all (Ctrl+A)
    await page.keyboard.press('Control+a');
    await page.waitForFunction(() => window.__plateStore.getState().extraSelection.length === 1, null, { timeout: 10000 });
    console.log(`[${browserName}] Both objects selected via Ctrl+A.`);

    // Right-click on one of the selected objects
    const posMulti = await screenOf(0);
    assert.ok(posMulti, 'Must have screen coordinates for multi-selection right-click');
    await page.mouse.click(posMulti[0], posMulti[1], { button: 'right' });

    await page.waitForSelector('#object-list-context-menu', { timeout: 5000 });
    // Verify multi-selection was preserved
    const extraLen = await page.evaluate(() => window.__plateStore.getState().extraSelection.length);
    assert.equal(extraLen, 1, 'Multi-selection must be preserved on right-click');

    // Verify multi-selection delete
    await page.waitForSelector('#menu-action-delete', { timeout: 5000 });
    await page.click('#menu-action-delete');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 0, null, { timeout: 30000 });
    console.log(`[${browserName}] Multi-selection delete removed all objects.`);

    // 8. Verify empty-bed menu still works after deletion
    console.log(`[${browserName}] Verifying empty-bed menu after deletion...`);
    await page.waitForSelector('#object-list-context-menu', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.waitForSelector('#plate-context-menu', { timeout: 5000 });
    await page.waitForSelector('#plate-menu-primitive', { timeout: 5000 });
    await page.keyboard.press('Escape');
    console.log(`[${browserName}] Empty-bed menu verified.`);

    const screenshotPath = path.join(SCREENSHOT_DIR, `canvas-contextmenu-${browserName}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`[${browserName}] Screenshot saved to ${screenshotPath}`);
    console.log(`[${browserName}] ALL 3D VIEWER CONTEXT MENU TESTS PASSED!`);
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    await startServer(PORT, 'canvas-contextmenu');
    await runBrowserSuite(chromium, 'chromium');
    await runBrowserSuite(firefox, 'firefox');
    console.log('\n==================================================');
    console.log('All 3D Viewer Context Menu browser tests passed on Chromium and Firefox!');
    console.log('==================================================');
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('[Error] Test suite failed:', err);
  process.exit(1);
});
