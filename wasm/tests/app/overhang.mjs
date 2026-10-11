#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5169);
const cube = fs.readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url));
async function run(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Shader')) errors.push(message.text()); });
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(bytes => window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj')), [...cube]);
    const pixels = async (enabled, above, rotated = false, onBed = false, tilt = 0) => page.evaluate(({ enabled, above, rotated, onBed, tilt }) => {
      const scene = window.__plateScene;
      const mesh = [...scene.objectMeshes.values()][0];
      mesh.position.set(0, 0, onBed ? 0 : 40);
      mesh.rotation.set(tilt, rotated ? Math.PI : 0, 0);
      mesh.updateMatrixWorld(true);
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      const center = bounds.getCenter(mesh.position.clone());
      scene.bedGroup.visible = false;
      scene.extraBedsGroup.visible = false;
      scene.buildVolumeHelper.visible = false;
      scene.transformControls.detach();
      scene.camera.position.set(center.x, center.y - (tilt ? 5 : 70), center.z + (above ? 60 : -60));
      scene.orbitControls.target.copy(center);
      scene.orbitControls.update();
      window.__prefsStore.getState().setDisplayPref('showOverhang', enabled);
      scene.renderer.render(scene.scene, scene.camera);
      const gl = scene.renderer.getContext();
      const image = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, image);
      let red = 0;
      for (let i = 0; i < image.length; i += 4) if (image[i] > 100 && image[i] > image[i + 1] * 1.5 && image[i] > image[i + 2] * 1.5) red++;
      return red;
    }, { enabled, above, rotated, onBed, tilt });
    assert.equal(await pixels(false, false), 0, 'disabled highlight preserves filament colours');
    assert.ok(await pixels(true, false) > 100, 'raised downward faces are highlighted');
    assert.equal(await pixels(true, true), 0, 'upward faces are not highlighted');
    assert.equal(await pixels(true, true, true), 0, 'rotation uses world face normals');
    assert.equal(await pixels(true, false, false, true), 0, 'faces resting on the bed are excluded');
    assert.equal(await pixels(false, false), 0, 'disabling restores the filament colours');
    await page.evaluate(() => [...window.__plateScene.objectMeshes.values()][0].geometry.setDrawRange(0, 6));
    assert.ok(await pixels(true, false, false, false, Math.PI / 6) > 100, 'a downward face at 30 degrees is highlighted');
    assert.equal(await pixels(true, false, false, false, Math.PI / 3), 0, 'a downward face at 60 degrees is excluded');
    assert.deepEqual(errors, [], 'no shader compilation or browser errors');
    console.log(`[${name}] overhang rendering and rotated normals passed`);
  } finally { await browser.close(); }
}
await startServer(port, 'overhang');
try { await run(chromium, 'chromium'); await run(firefox, 'firefox'); }
catch (error) { console.error(error); process.exitCode = 1; }
finally { await stopServer(port); }
