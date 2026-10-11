import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = 5277;
async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const instance = () => page.evaluate(() => window.__plateStore.getState().objects[0].instances[0]);
  const point = () => page.evaluate(() => {
    const scene = window.__plateScene, mesh = [...scene.objectMeshes.values()][0];
    mesh.geometry.computeBoundingBox(); const box = mesh.geometry.boundingBox;
    const v = box.min.clone().lerp(box.max, .2); v.z = box.max.z;
    v.applyMatrix4(mesh.matrixWorld).project(scene.camera);
    const r = scene.renderer.domElement.getBoundingClientRect();
    return { x: r.x + (v.x + 1) * r.width / 2, y: r.y + (1 - v.y) * r.height / 2 };
  });
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.mouse.click(900, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive'); await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateScene?.objectMeshes.size === 1);
    await page.click('#view-top');
    await page.evaluate(() => { const camera = window.__plateScene.camera; camera.zoom = 3; camera.updateProjectionMatrix(); });
    await page.waitForTimeout(500);
    const body = await point();
    await page.mouse.click(body.x, body.y);
    await page.waitForFunction(() => window.__plateStore.getState().selectedObjectId !== null);
    assert.equal(await page.evaluate(() => window.__plateStore.getState().gizmoMode), null, 'selection does not activate Move');
    assert.equal(await page.evaluate(() => window.__plateScene.transformControls.object === undefined), true);
    await page.waitForFunction(() => window.__plateScene.selectionOutline.visible);
    assert.equal(await page.evaluate(() => window.__plateScene.selectionOutline.geometry.getAttribute('instanceStart').count), 24, 'selection has short corner segments');
    assert.equal(await page.evaluate(() => [...window.__plateScene.objectMeshes.values()].includes(window.__plateScene.selectionOutline)), false, 'corners are outside printable objects');
    assert.equal(await page.evaluate(() => window.__plateScene.selectedMaterial.emissive.getHex()), 0, 'selection preserves filament colors');
    await page.keyboard.press('m');
    await page.waitForFunction(() => window.__plateScene.transformControls.object !== undefined);
    assert.equal(await page.evaluate(() => window.__plateStore.getState().gizmoMode), 'translate');
    await page.click('#tool-move-btn');
    await page.waitForFunction(() => window.__plateScene.transformControls.object === undefined);
    assert.equal(await page.evaluate(() => window.__plateScene.selectionOutline.visible), true, 'turning Move off keeps the outline');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__plateScene.selectionOutline.visible);
    await page.mouse.click(body.x, body.y);
    await page.waitForFunction(() => window.__plateScene.selectionOutline.visible);
    assert.equal(await page.evaluate(() => window.__plateStore.getState().gizmoMode), null, 'reselection remains neutral');
    for (const mode of [null, 'rotate', 'scale', 'translate']) {
      console.log(`${browserType.name()}: testing ${mode}`);
      await page.evaluate(mode => window.__plateStore.getState().setGizmoMode(mode), mode);
      await page.waitForTimeout(100);
      const before = await instance(); const p = await point();
      const camera = await page.evaluate(() => window.__plateScene.camera.position.toArray());
      await page.mouse.move(p.x, p.y);
      assert.equal(await page.evaluate(() => window.__plateScene.transformControls.axis), null, 'drag starts on the body, away from tool handles');
      await page.mouse.down();
      await page.mouse.move(p.x + 55, p.y + 35, { steps: 10 }); await page.mouse.up();
      await page.waitForFunction(offset => Math.hypot(...window.__plateStore.getState().objects[0].instances[0].offset.slice(0, 2).map((v, i) => v - offset[i])) > 1, before.offset, {timeout: 10000});
      const after = await instance();
      assert.equal(after.offset[2], before.offset[2], `${mode}: height is unchanged`);
      assert.deepEqual(after.rotation, before.rotation); assert.deepEqual(after.scale, before.scale);
      const afterCamera = await page.evaluate(() => window.__plateScene.camera.position.toArray());
      assert.ok(Math.hypot(...afterCamera.map((v, i) => v - camera[i])) < 1e-6, 'body drag does not orbit');
      await page.evaluate(() => window.__historyStore.getState().undo());
      assert.deepEqual((await instance()).offset, before.offset, `${mode}: undo restores position`);
      await page.waitForTimeout(150); // Allow the restored mesh and gizmo matrices to render.
    }
    // Cancel an in-progress drag: restore the visual position without persisting a transform.
    const before = await instance(); const p = await point();
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 40, p.y + 20, { steps: 5 });
    await page.evaluate(() => {
      const s = window.__plateScene;
      s.renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId: s.planeDrag.pointerId, bubbles: true }));
    });
    await page.mouse.up();
    assert.deepEqual((await instance()).offset, before.offset, 'cancel does not move the stored model');
    assert.equal(await page.evaluate(() => window.__plateScene.orbitControls.enabled), true);
    // Dragging empty space still orbits.
    const camera = await page.evaluate(() => window.__plateScene.camera.position.toArray());
    await page.mouse.move(1100, 200); await page.mouse.down(); await page.mouse.move(1160, 240, { steps: 5 }); await page.mouse.up();
    assert.notDeepEqual(await page.evaluate(() => window.__plateScene.camera.position.toArray()), camera);
    // A selected group moves by one shared XY delta, in one undo transaction.
    await page.mouse.click(1100, 100, { button: 'right' });
    await page.hover('#plate-menu-primitive'); await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 2);
    await page.evaluate(async () => {
      const s = window.__plateStore.getState(), obj = s.objects[1];
      s.selectObject(obj.id, obj.instances[0].id);
      await s.moveSelection([65, 0, 0]);
    });
    await page.click('#view-top');
    await page.keyboard.press('Control+a');
    await page.evaluate(() => window.__plateStore.getState().setGizmoMode('rotate'));
    await page.waitForTimeout(200);
    const group = await page.evaluate(() => window.__plateStore.getState().objects.map(o => o.instances[0].offset));
    const start = await point();
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 45, start.y + 25, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(old => Math.abs(window.__plateStore.getState().objects[0].instances[0].offset[0] - old[0][0]) > 1, group);
    const moved = await page.evaluate(() => window.__plateStore.getState().objects.map(o => o.instances[0].offset));
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs((moved[0][axis] - group[0][axis]) - (moved[1][axis] - group[1][axis])) < 1e-6);
    await page.evaluate(() => window.__historyStore.getState().undo());
    assert.deepEqual(await page.evaluate(() => window.__plateStore.getState().objects.map(o => o.instances[0].offset)), group);
    // Large models need visible corner strokes and clearance, rather than fixed 8 mm ticks.
    await page.evaluate(() => {
      const state = window.__plateStore.getState(), obj = state.objects[0];
      state.selectObject(obj.id, obj.instances[0].id);
      const scene = window.__plateScene;
      scene.objectMeshes.get(`${obj.id}_${obj.instances[0].id}`).scale.setScalar(10);
    });
    await page.waitForFunction(() => {
      const geometry = window.__plateScene.selectionOutline.geometry;
      return Math.abs(geometry.getAttribute('instanceEnd').getX(0) - geometry.getAttribute('instanceStart').getX(0)) > 30;
    });
    const printableParts = await page.evaluate(() => window.__objectListStore.getState().objects.map(o => o.volumes.length));
    await page.evaluate(async () => {
      const app = window.__appStore.getState();
      const bytes = await app.saveProjectFile('selection-corners.3mf');
      await app.openProjectFile(new File([bytes], 'selection-corners.3mf'));
    });
    assert.deepEqual(await page.evaluate(() => window.__objectListStore.getState().objects.map(o => o.volumes.length)), printableParts, 'exporting with selection corners adds no printable objects or parts');
    console.log(`${browserType.name()}: body drag in all transform modes, XY constraint, undo, cancel, empty-space orbit and group movement pass`);
  } finally { await browser.close(); }
}
await startServer(port, 'object-plane-drag');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
