// Cut face placement on real geometry (Chromium): a generated square tube with a hole and an overlapping
// second part, cut on its rotated and scaled second instance on plate 2. The engine's cut must put the
// connector sockets where the preview placed them. Screenshots go to wasm/build/tests-app/cut-section-*.png.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = 5282;
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../build/tests-app');
fs.mkdirSync(shots, { recursive: true });

// Square tube: outer 30 mm, hole 12 mm, 20 mm tall, faces counterclockwise seen from outside.
function tubeStl() {
  const outer = [[-15, -15], [15, -15], [15, 15], [-15, 15]];
  const inner = outer.map(([x, y]) => [x * 0.4, y * 0.4]);
  const facets = [];
  const quad = (a, b, c, d) => { facets.push([a, b, c], [a, c, d]); };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad([...outer[i], 0], [...outer[j], 0], [...outer[j], 20], [...outer[i], 20]);
    quad([...inner[j], 0], [...inner[i], 0], [...inner[i], 20], [...inner[j], 20]);
    quad([...outer[i], 20], [...outer[j], 20], [...inner[j], 20], [...inner[i], 20]);
    quad([...inner[i], 0], [...inner[j], 0], [...outer[j], 0], [...outer[i], 0]);
  }
  const body = facets.map((f) => `facet normal 0 0 0\nouter loop\n${f.map((v) => `vertex ${v.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n');
  return Buffer.from(`solid tube\n${body}\nendsolid tube\n`);
}

const Z = 10;

// World XY of a point given in the tube's own frame (relative to its footprint centre).
const world = (page, local) => page.evaluate(([lx, ly]) => {
  const p = window.__plateScene.cutPreview, m = p.target, c = m.userData.tubeCentre;
  const v = new (m.position.constructor)(c[0] + lx, c[1] + ly, c[2]).applyMatrix4(m.matrixWorld);
  return [v.x, v.y];
}, local);

const screen = (page, [x, y]) => page.evaluate(([x, y, z]) => {
  const s = window.__plateScene, v = new (s.camera.position.constructor)(x, y, z).project(s.camera), r = s.renderer.domElement.getBoundingClientRect();
  const sx = r.x + (v.x + 1) * r.width / 2, sy = r.y + (1 - v.y) * r.height / 2;
  if (document.elementFromPoint(sx, sy) !== s.renderer.domElement) throw new Error(`point ${x},${y} is covered`);
  return { x: sx, y: sy };
}, [x, y, Z]);

const loops = (page) => page.evaluate(() => (window.__cutStore.getState().section ?? []).map((loop) => {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const cross = loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
    area += cross / 2; cx += (loop[j][0] + loop[i][0]) * cross; cy += (loop[j][1] + loop[i][1]) * cross;
  }
  return { area, centre: [cx / (6 * area), cy / (6 * area)] };
}));

const packed = (page) => page.evaluate(async () => {
  const s = window.__plateStore.getState(), o = s.objects[0], mesh = await s.getMesh(o.id);
  let sum = 0; for (let i = 0; i < mesh.positions.length; i++) sum += mesh.positions[i] * ((i % 7) + 1);
  return { objects: s.objects.length, instances: o.instances.length, vertices: mesh.positions.length, sum: sum.toFixed(2) };
});

const near = (a, b, tolerance, label) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < tolerance, `${label}: ${a} vs ${b}`);

async function suite() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.setInputFiles('#model-file', { name: 'tube.stl', mimeType: 'model/stl', buffer: tubeStl() });
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1 && !window.__appStore.getState().isModelLoading, null, { timeout: 30000 });

    // A 10 mm cube part straddling the +X outer wall, then a second instance on plate 2, rotated and scaled.
    const ids = await page.evaluate(async () => {
      const plate = window.__plateStore.getState(), obj = plate.objects[0], mesh = await plate.getMesh(obj.id);
      const box = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
      for (let i = 0; i < mesh.positions.length; i++) { const a = i % 3; box[0][a] = Math.min(box[0][a], mesh.positions[i]); box[1][a] = Math.max(box[1][a], mesh.positions[i]); }
      const c = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
      await window.__objectListStore.getState().addVolume({ objectId: obj.id, type: 'part', shape: 'cube', size: [10, 10, 10], offset: [c[0] + 15, c[1], box[0][2] + 10] });
      plate.selectObject(obj.id, obj.instances[0].id);
      await plate.duplicateSelected();
      await window.__platesStore.getState().addPlate('Second plate');
      const origin = window.__platesStore.getState().plates[1].origin;
      const second = window.__plateStore.getState().objects[0].instances[1];
      await window.__plateStore.getState().setInstanceTransform(obj.id, second.id, { offset: [origin[0] + 150, origin[1] + 150, 0], rotation: [0, 0, 0.5], scale: [1.2, 0.8, 1.25] });
      await window.__platesStore.getState().fetchPlates();
      window.__plateStore.getState().selectObject(obj.id, second.id);
      return { object: obj.id, first: obj.instances[0].id, second: second.id, centre: [c[0], c[1], box[0][2]] };
    });
    const original = await packed(page);
    assert.equal(original.instances, 2);
    await page.evaluate(([{ centre }, Z]) => {
      const s = window.__plateScene, m = s.getSelectedMesh();
      m.userData.tubeCentre = centre;
      s.orbitControls.target.set(m.position.x, m.position.y, Z);
      s.camera.position.set(m.position.x + 15, m.position.y - 45, Z + 120);
      s.camera.lookAt(s.orbitControls.target); s.orbitControls.update();
    }, [ids, Z]);

    await page.click('#tool-cut-btn');
    await page.waitForSelector('#cut-tool-panel');
    await page.fill('#cut-z-input', String(Z));
    await page.waitForFunction((z) => window.__cutStore.getState().section?.length > 0 && window.__plateScene.cutPreview.plane.position.z === z, Z);
    assert.equal(await page.evaluate(() => window.__plateScene.cutPreview.target.userData.instanceId), ids.second, 'preview shows the selected instance');
    await page.evaluate(({ centre }) => { window.__plateScene.cutPreview.target.userData.tubeCentre = centre; }, ids);

    // Tube outline and cube square run counterclockwise, the hole clockwise, all scaled by 1.2 x 0.8.
    const section = await loops(page);
    const sorted = section.map((l) => +l.area.toFixed(1)).sort((a, b) => a - b);
    assert.deepEqual(sorted, [-138.2, 96, 864], 'cut face of tube, hole and overlapping cube on the scaled instance');
    near(section.find((l) => l.area < 0).centre, await world(page, [0, 0]), 0.05, 'hole centre follows the instance transform');
    await page.screenshot({ path: path.join(shots, 'cut-section-plane.png') });

    await page.click('#cut-connectors-mode-btn');
    await page.waitForFunction((z) => window.__plateScene.cutPreview.upperPlane.constant < -z, Z);
    const count = () => page.evaluate(() => window.__cutStore.getState().connectors.length);
    const clickLocal = async (local) => { const p = await world(page, local); const s = await screen(page, p); await page.mouse.click(s.x, s.y); return p; };

    // Default Add must use the selected cut face, even when its centre is a hole.
    await page.click('#cut-add-connector-btn');
    assert.equal(await count(), 1);
    assert.equal(await page.locator('[data-testid="cut-connector-row"][data-invalid]').count(), 0, '+ Add fits the selected section');
    assert.equal(await page.isDisabled('#perform-cut-btn'), false);
    const added = await page.evaluate(() => window.__cutStore.getState().connectors[0].pos);
    const selectedCentre = await world(page, [0, 0]);
    assert.ok(Math.hypot(added[0] - selectedCentre[0], added[1] - selectedCentre[1]) < 30, '+ Add stays on the selected instance on plate 2');
    await page.waitForFunction(() => window.__plateScene.cutPreview.markers.children.length > 0);
    const marker = await page.evaluate(() => {
      const m = window.__plateScene.cutPreview.markers.children[0];
      return [m.position.x, m.position.y];
    });
    near(marker, added, 0.01, '+ Add marker matches its valid world position');
    await page.screenshot({ path: path.join(shots, 'cut-section-default-add.png') });
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => window.__cutStore.getState().connectors.length === 0);

    // An oversized connector has no suitable face: report an error without adding anything.
    await page.evaluate(() => window.__cutStore.getState().updateDefaultAttrs({ size: 100 }));
    await page.click('#cut-add-connector-btn');
    await page.waitForSelector('#cut-error-message');
    assert.equal(await count(), 0, 'no room leaves the connector list unchanged');
    await page.evaluate(() => window.__cutStore.getState().updateDefaultAttrs({ size: 3 }));

    // Inside the hole there is no face: nothing is placed.
    await clickLocal([0, 0]);
    await page.waitForSelector('#cut-error-message');
    assert.equal(await count(), 0, 'a click in the hole places no connector');

    // On the tube wall, and where the cube overlaps the wall: both valid.
    const wall = await clickLocal([0, -10.5]);
    await page.waitForFunction(() => window.__cutStore.getState().connectors.length === 1);
    const seam = await clickLocal([14, 0]);
    await page.waitForFunction(() => window.__cutStore.getState().connectors.length === 2);
    const placed = await page.evaluate(() => window.__cutStore.getState().connectors.map((c) => c.pos));
    near(placed[0], wall, 0.3, 'wall connector sits where clicked');
    near(placed[1], seam, 0.3, 'overlap connector sits where clicked');
    assert.equal(await page.locator('[data-testid="cut-connector-row"][data-invalid]').count(), 0, 'connector across the overlap seam is valid');

    // Next to the hole the connector crosses the outline: flagged and blocking until deleted.
    await clickLocal([6.8, 3]);
    await page.waitForFunction(() => window.__cutStore.getState().connectors.length === 3);
    assert.equal(await page.getAttribute('[data-testid="cut-connector-row"]:nth-child(3)', 'data-invalid'), 'edge');
    assert.equal(await page.isDisabled('#perform-cut-btn'), true);
    await page.screenshot({ path: path.join(shots, 'cut-section-connectors.png') });
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => window.__cutStore.getState().connectors.length === 2);

    await page.click('#cut-add-connector-btn');
    assert.equal(await count(), 3, '+ Add finds room beside existing connectors');
    assert.equal(await page.locator('[data-testid="cut-connector-row"][data-invalid]').count(), 0);
    const defaultPlaced = await page.evaluate(() => window.__cutStore.getState().connectors[2].pos);

    // The engine cuts the selected instance at the same plane: sockets appear in the lower half where the markers were.
    await page.evaluate(() => {
      const engine = window.__orcaEngine, original = engine.cutObjectWithConnectors.bind(engine);
      engine.cutObjectWithConnectors = async (args) => {
        window.__sectionCutTarget = args.instanceId;
        try { return await original(args); } finally { engine.cutObjectWithConnectors = original; }
      };
    });
    await page.click('#perform-cut-btn');
    await page.waitForSelector('#cut-success-message', { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__sectionCutTarget), ids.second, 'native cut targets the selected second instance');
    // Connectors stay separate volumes, as on desktop; the engine reports their world bounds on the cut instance.
    const engineConnectors = await page.evaluate(() => window.__cutStore.getState().lastResult.createdObjects
      .flatMap((o) => o.volumes.filter((v) => v.name.startsWith('Connector')).map((v) => v.boundingBox)));
    for (const [label, p] of [['wall', placed[0]], ['overlap', placed[1]], ['default Add', defaultPlaced]]) {
      assert.ok(engineConnectors.some(({ min, max }) => Math.hypot((min[0] + max[0]) / 2 - p[0], (min[1] + max[1]) / 2 - p[1]) < 0.3 &&
        min[2] < Z + 0.5 && max[2] > Z - 0.5), `${label} connector is cut where previewed (${JSON.stringify(engineConnectors)})`);
    }
    await page.click('#cut-cancel-btn');
    const lower = await page.evaluate((z) => {
      const s = window.__plateScene;
      for (const m of s.objectMeshes.values()) {
        m.updateMatrixWorld(true);
        const box = new (s.selectionBounds.constructor)().setFromObject(m);
        if (Math.abs(box.max.z - z) < 0.05 && box.min.z < 0.05 && Math.abs(m.position.x - s.orbitControls.target.x) < 40) return true;
      }
      return false;
    }, Z);
    assert.ok(lower, 'lower half of the cut instance stays in place below the plane');

    await page.evaluate(() => window.__historyStore.getState().undo());
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
    assert.deepEqual(await packed(page), original, 'undo restores both instances and the uncut parts');

    // The engine composes rotations Z * Y * X and drops the instance on the bed; the scene must agree.
    const minZ = await page.evaluate(async () => {
      const plate = window.__plateStore.getState(), o = plate.objects[0], inst = o.instances[0];
      await plate.setInstanceTransform(o.id, inst.id, { rotation: [0.6, 0, 0.9] });
      const m = window.__plateScene.objectMeshes.get(`${o.id}_${inst.id}`); m.updateMatrixWorld(true);
      return new (window.__plateScene.selectionBounds.constructor)().setFromObject(m).min.z;
    });
    assert.ok(Math.abs(minZ) < 0.01, `multi-axis rotated instance rests on the bed in the scene (${minZ})`);
    assert.deepEqual(errors, []);
    console.log('cut face, hole, overlapping part and instance transform agree between preview and engine cut');
  } finally { await browser.close(); }
}

await startServer(port, 'cut-section');
try { await suite(); } finally { await stopServer(port); }
