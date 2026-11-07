import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const shots = path.join(root, 'wasm/build/tests-app/mobile-prepare-framing');
const port = Number(process.env.APP_TEST_PORT || 5297);
fs.mkdirSync(shots, { recursive: true });

// Check actual rendered bed vertices, including the public U1 model footprint.
async function fits(page, label, objects = false) {
  const bounds = await page.evaluate((objects) => {
    const s = window.__plateScene;
    s.scene.updateMatrixWorld(true);
    s.camera.updateMatrixWorld(true);
    const points = [];
    const meshes = objects ? [...s.objectMeshes.values()] : s.bedGroup.children.filter(m => m.isMesh);
    for (const m of meshes) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) points.push(s.camera.position.clone().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).project(s.camera));
    }
    return { count: points.length, x: Math.max(...points.map(p => Math.abs(p.x))), y: Math.max(...points.map(p => Math.abs(p.y))) };
  }, objects);
  console.log(label, bounds);
  assert.ok(bounds.count > 0 && bounds.x < 0.96 && bounds.y < 0.96, `${label}: geometry fits with margins (${JSON.stringify(bounds)})`);
}

await startServer(port, 'mobile-prepare-framing');
const browser = await chromium.launch();
try {
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: width === 768 ? 1024 : 844 } });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 120000 });
    await page.evaluate(async () => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      window.__prefsStore.getState().setGeneralPref('autoSliceAfterChange', false);
      await window.__appStore.getState().chooseVendor('Snapmaker');
      await window.__appStore.getState().choosePrinter('Snapmaker U1 (0.4 nozzle)');
    });
    await page.waitForFunction(() => window.__plateScene?.bedGroup.visible && window.__plateScene.bedModelPoints?.length > 4, null, { timeout: 60000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shots, `prepare-bed-${width}.png`) });
    await fits(page, `${width} initial bed`);
    await page.setInputFiles(width < 900 ? '#mobile-import' : '#model-file', path.join(root, 'tests/data/20mm_cube.obj'));
    await page.waitForFunction(() => window.__plateScene.objectMeshes.size === 1 && !window.__appStore.getState().isModelLoading);
    await fits(page, `${width} imported cube`, true);
    await page.screenshot({ path: path.join(shots, `prepare-${width}.png`) });
    await page.evaluate(() => {
      const s = window.__plateStore.getState(), o = s.objects[0];
      s.selectObject(o.id, o.instances[0].id);
    });
    await page.evaluate(() => window.__plateScene.setCameraView('Z'));
    await fits(page, `${width} object Fit`, true);
    await page.setViewportSize({ width: width === 390 ? 768 : 390, height: 1024 });
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__plateScene.setCameraView('BED'));
    await fits(page, `${width} resized bed Fit`);
    await page.evaluate(() => window.__plateScene.setCameraView('Z'));
    await fits(page, `${width} resized object Fit`, true);
    // Fit also updates the orthographic projection used by camera preferences.
    await page.evaluate(() => {
      window.__plateScene.setCameraType('orthographic');
      window.__plateScene.setCameraView('BED');
    });
    await fits(page, `${width} orthographic bed Fit`);
    await page.evaluate(() => {
      window.__plateScene.setCameraView('Z');
    });
    await fits(page, `${width} orthographic object Fit`, true);
    await page.evaluate(() => window.__plateScene.setCameraType('perspective'));
    // Real pointer orbit and wheel zoom must survive ordinary store updates.
    const canvas = await page.locator('.plate-view canvas').first().boundingBox();
    assert.ok(canvas);
    const camera = () => page.evaluate(() => {
      const s = window.__plateScene;
      return [...s.camera.position.toArray(), ...s.orbitControls.target.toArray(), s.camera.zoom];
    });
    const fitted = await camera();
    await page.mouse.move(canvas.x + 8, canvas.y + canvas.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 43, canvas.y + canvas.height * 0.7 + 20, { steps: 5 });
    await page.mouse.up();
    await page.mouse.wheel(0, -80);
    await page.waitForTimeout(1200);
    const before = await camera();
    assert.ok(Math.abs(before[0] - fitted[0]) > 0.1, `${width}: pointer gesture orbits the camera`);
    await page.evaluate(() => {
      const s = window.__plateStore.getState(), o = s.objects[0];
      s.selectObject(null, null);
      s.selectObject(o.id, o.instances[0].id);
      window.__prefsStore.getState().setDisplayPref('showGrid', false);
      window.__prefsStore.getState().setDisplayPref('showGrid', true);
    });
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('layer_height', '0.16'));
    await page.waitForTimeout(250);
    const after = await camera();
    assert.ok(after.every((v, i) => Math.abs(v - before[i]) < 0.01), `${width}: manual camera preserved (allow residual orbit damping)`);
    await page.close();
  }
  console.log('Prepare framing passes at 390, 768 and 1280px');
} finally {
  await browser.close();
  await stopServer(port);
}
