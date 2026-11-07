// Cut workflow preview and selection-corner visibility in the real Prepare view (Chromium).
// Screenshots go to wasm/build/tests-app/cut-preview-*.png.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = 5281;
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../build/tests-app');
fs.mkdirSync(shots, { recursive: true });

// Renders one frame and checks every corner-bracket sample that no object hides is drawn white.
// Occlusion comes from a ray against each object's local bounds, exact for the box primitives used here.
const cornerCheck = () => {
  const s = window.__plateScene, outline = s.selectionOutline;
  s.renderer.render(s.scene, s.camera);
  const gl = s.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const V = s.camera.position.constructor, cam = s.camera.position.clone();
  const meshes = [...s.objectMeshes.values()].filter(m => m.visible);
  const occluded = (p, margin = 0) => meshes.some(m => {
    m.geometry.computeBoundingBox();
    const inv = m.matrixWorld.clone().invert(), o = cam.clone().applyMatrix4(inv), d = p.clone().applyMatrix4(inv).sub(o);
    const box = m.geometry.boundingBox.clone().expandByScalar(-margin); let t0 = 0, t1 = 0.999;
    for (const a of ['x', 'y', 'z']) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < box.min[a] || o[a] > box.max[a]) return false; continue; }
      let ta = (box.min[a] - o[a]) / d[a], tb = (box.max[a] - o[a]) / d[a]; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
    }
    return true;
  });
  const white = (p) => {
    const v = p.clone().project(s.camera);
    const x = Math.round((v.x + 1) / 2 * W), y = Math.round((v.y + 1) / 2 * H);
    if (x < 3 || y < 3 || x > W - 4 || y > H - 4) return null;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i = ((y + dy) * W + x + dx) * 4; if (px[i] > 200 && px[i + 1] > 200 && px[i + 2] > 200) return true;
    }
    return false;
  };
  if (!outline.visible) return { visible: false, missing: [], expected: 0, hidden: 0, leaked: [] };
  const start = outline.geometry.getAttribute('instanceStart'), end = outline.geometry.getAttribute('instanceEnd');
  const missing = [], behind = [], front = []; let expected = 0;
  for (let i = 0; i < start.count; i++) {
    const a = new V().fromBufferAttribute(start, i), b = new V().fromBufferAttribute(end, i);
    for (const t of [0.35, 0.7]) {
      const p = a.clone().lerp(b, t);
      if (occluded(p)) { if (occluded(p, 1)) behind.push([p, `${i}@${t}`]); continue; }
      const seen = white(p); if (seen === null) continue;
      expected++; if (!seen) missing.push(`${i}@${t}`);
    }
  }
  // Samples behind the object must not change when the brackets are hidden: depth keeps rear lines out.
  const pixel = (p) => { const v = p.clone().project(s.camera), x = Math.round((v.x + 1) / 2 * W), y = Math.round((v.y + 1) / 2 * H); return x < 0 || y < 0 || x >= W || y >= H ? -1 : (y * W + x) * 4; };
  outline.visible = false; s.renderer.render(s.scene, s.camera);
  const bare = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, bare); outline.visible = true;
  // Rear samples that project onto a visible bracket would differ for that reason alone.
  for (let i = 0; i < start.count; i++) for (let t = 0; t <= 1; t += 0.05) {
    const p = new V().fromBufferAttribute(start, i).lerp(new V().fromBufferAttribute(end, i), t);
    if (!occluded(p)) front.push(p.project(s.camera));
  }
  const clear = (p) => { const v = p.clone().project(s.camera); return front.every((f) => Math.hypot((f.x - v.x) * W / 2, (f.y - v.y) * H / 2) > 6); };
  const inside = behind.filter(([p]) => pixel(p) >= 0 && clear(p));
  const leaked = inside.filter(([p]) => { const i = pixel(p); return Math.abs(px[i] - bare[i]) + Math.abs(px[i + 1] - bare[i + 1]) + Math.abs(px[i + 2] - bare[i + 2]) > 24; }).map(([, id]) => id);
  return { visible: true, missing, expected, hidden: inside.length, leaked };
};

async function corners(page, label) {
  await page.waitForTimeout(80);
  const r = await page.evaluate(cornerCheck);
  assert.ok(r.visible, `${label}: corners shown`);
  assert.ok(r.expected >= 8, `${label}: enough unoccluded samples (${r.expected})`);
  assert.deepEqual(r.missing, [], `${label}: unoccluded corner samples are drawn`);
  assert.deepEqual(r.leaked, [], `${label}: corner samples behind the object stay hidden`);
  return r.hidden;
}

const orbit = (page, azimuth, elevation) => page.evaluate(([az, el]) => {
  const s = window.__plateScene, target = s.orbitControls.target, d = 160;
  s.camera.position.set(target.x + d * Math.cos(el) * Math.sin(az), target.y - d * Math.cos(el) * Math.cos(az), target.z + d * Math.sin(el));
  s.camera.lookAt(target); s.orbitControls.update();
}, [azimuth, elevation]);

async function cornerSuite(page) {
  await page.mouse.click(900, 300, { button: 'right' });
  await page.hover('#plate-menu-primitive'); await page.click('#plate-menu-cube');
  await page.waitForFunction(() => window.__plateScene?.objectMeshes.size === 1);
  // An untextured bed floor is opaque; textured beds can hide the problem through transparent texels.
  await page.evaluate(() => window.__plateScene.setBedAssets({}));
  const ids = await page.evaluate(() => { const o = window.__plateStore.getState().objects[0]; return [o.id, o.instances[0].id]; });
  await page.evaluate(([o, i]) => window.__plateStore.getState().selectObject(o, i), ids);
  await page.evaluate(() => { const s = window.__plateScene, m = [...s.objectMeshes.values()][0]; s.orbitControls.target.copy(m.position); });
  // Root cause control: drawn in the opaque pass, the brackets are painted over by the later bed floor.
  await orbit(page, 0.55, 0.55);
  await page.evaluate(() => { const m = window.__plateScene.selectionOutline.material; m.transparent = false; m.needsUpdate = true; });
  const opaque = await page.evaluate(cornerCheck);
  await page.evaluate(() => { const m = window.__plateScene.selectionOutline.material; m.transparent = true; m.needsUpdate = true; });
  assert.ok(opaque.missing.length > 0, `opaque-pass brackets lose samples to the bed floor (${opaque.missing.length}/${opaque.expected})`);
  let hidden = 0;
  for (let k = 0; k < 12; k++) {
    await orbit(page, k * 0.55, 0.25 + (k % 4) * 0.3);
    hidden += await corners(page, `orbit ${k}`);
  }
  assert.ok(hidden >= 12, `rear bracket samples behind the cube were checked (${hidden})`);
  for (let k = 0; k < 4; k++) {
    await page.evaluate(() => window.__plateStore.getState().selectObject(null, null));
    await page.evaluate(([o, i]) => window.__plateStore.getState().selectObject(o, i), ids);
    await orbit(page, 0.8 + k, 0.6);
    await corners(page, `reselect ${k}`);
  }
  await page.evaluate(() => window.__plateStore.getState().rotateSelection([0, 0, Math.PI / 6]));
  await page.evaluate(() => window.__plateStore.getState().scaleSelection([1.5, 1, 0.8]));
  await page.evaluate(() => window.__plateStore.getState().moveSelection([12, -8, 0]));
  await page.evaluate(() => { const s = window.__plateScene, m = [...s.objectMeshes.values()][0]; s.orbitControls.target.copy(m.position); });
  for (let k = 0; k < 6; k++) {
    await orbit(page, k * 1.1, 0.3 + (k % 3) * 0.35);
    await corners(page, `transformed ${k}`);
  }
  await page.evaluate(() => window.__plateScene.renderThumbnail({ width: 128, height: 128 }));
  await corners(page, 'after thumbnail');
  await page.evaluate(() => window.__plateScene.setCameraType('orthographic'));
  await orbit(page, 2.2, 0.5);
  await corners(page, 'orthographic');
  await page.evaluate(() => window.__plateScene.setCameraType('perspective'));
  await page.screenshot({ path: path.join(shots, 'cut-preview-corners.png') });
  console.log('selection corners stay drawn through orbit, reselection, transforms and thumbnails');
}

// Engine-side geometry and transform of the first object, the state a cancelled preview must leave alone.
const packed = (page) => page.evaluate(async () => {
  const s = window.__plateStore.getState(), o = s.objects[0], mesh = await s.getMesh(o.id);
  let sum = 0; for (let i = 0; i < mesh.positions.length; i++) sum += mesh.positions[i] * ((i % 7) + 1);
  // Undo reloads the project: instance ids change and transforms pick up float noise.
  const { id, ...instance } = o.instances[0];
  return { objects: s.objects.length, vertices: mesh.positions.length, sum: sum.toFixed(3), instance: JSON.stringify(instance, (k, v) => typeof v === 'number' ? +v.toFixed(5) : v) };
});

// Client coordinates of a world point, after checking that the canvas (not a panel) is under it.
const screen = (page, p) => page.evaluate((p) => {
  const s = window.__plateScene, v = new (s.camera.position.constructor)(...p).project(s.camera), r = s.renderer.domElement.getBoundingClientRect();
  const x = r.x + (v.x + 1) * r.width / 2, y = r.y + (1 - v.y) * r.height / 2;
  if (document.elementFromPoint(x, y) !== s.renderer.domElement) throw new Error(`point ${p} is covered at ${x},${y}`);
  return { x, y };
}, p);

const cutState = (page) => page.evaluate(() => {
  const c = window.__cutStore.getState(), loop = c.section?.[0] ?? [];
  const centroid = loop.reduce((a, p) => [a[0] + p[0] / loop.length, a[1] + p[1] / loop.length], [0, 0]);
  return { z: c.z, mode: c.connectorMode, connectors: c.connectors.map(k => ({ pos: k.pos, size: k.attrs.size })), selected: c.selectedConnectorIndex, error: c.error, loops: c.section?.length ?? 0, loop, centroid };
});

const openCut = async (page) => {
  await page.click('#tool-cut-btn');
  await page.waitForSelector('#cut-tool-panel');
  await page.waitForFunction(() => window.__cutStore.getState().section?.length > 0);
};

const thumbnail = (page) => page.evaluate(() => window.__plateScene.renderThumbnail({ width: 96, height: 96 }));

async function cutSuite(page) {
  const original = await packed(page);
  const objectId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
  const plainThumb = await thumbnail(page);
  await orbit(page, 0.5, 0.9);
  await openCut(page);

  // Plane mode: the plane follows the height input, the halves are tinted apart and clipped there.
  await page.fill('#cut-z-input', '8');
  await page.waitForFunction(() => window.__plateScene.cutPreview.plane.position.z === 8);
  const plane = await page.evaluate(() => {
    const p = window.__plateScene.cutPreview, mesh = window.__plateScene.getSelectedMesh();
    return { visible: p.group.visible, upper: p.upper.material.color.getHex(), lower: p.lower.material.color.getHex(),
      upperClip: p.upperPlane.constant, lowerClip: p.lowerPlane.constant, targetDrawn: mesh.material.visible };
  });
  assert.deepEqual(plane, { visible: true, upper: 0xffb27a, lower: 0x7ab8ff, upperClip: -8, lowerClip: 8, targetDrawn: false });
  let state = await cutState(page);
  assert.ok(state.loops >= 1 && state.loop.every(p => Number.isFinite(p[0])), 'cut face computed at the plane');
  await page.screenshot({ path: path.join(shots, 'cut-preview-plane.png') });

  // Connector mode: halves separate, clicking the lower cut face places a connector there.
  await page.click('#cut-connectors-mode-btn');
  await page.waitForFunction(() => window.__plateScene.cutPreview.upperPlane.constant < -8);
  const at = await screen(page, [...state.centroid, 8]);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => window.__cutStore.getState().connectors.length === 1);
  state = await cutState(page);
  assert.ok(Math.hypot(state.connectors[0].pos[0] - state.centroid[0], state.connectors[0].pos[1] - state.centroid[1]) < 1.5, 'connector sits where the face was clicked');
  assert.equal(state.selected, 0);
  assert.equal(await page.locator('[data-testid="cut-connector-row"][data-invalid]').count(), 0);
  await page.fill('#cut-connector-size-input', '5');
  await page.waitForFunction(() => window.__cutStore.getState().connectors[0].attrs.size === 5);
  await page.screenshot({ path: path.join(shots, 'cut-preview-connectors.png') });

  // A click off the cut faces places nothing and keeps the tool and selection.
  const away = await screen(page, [state.centroid[0] - 70, state.centroid[1] + 40, 0]);
  await page.mouse.click(away.x, away.y);
  await page.waitForSelector('#cut-error-message');
  state = await cutState(page);
  assert.equal(state.connectors.length, 1);
  assert.equal(await page.evaluate(() => window.__plateStore.getState().selectedObjectId), objectId);

  // A connector crossing the face edge is marked invalid and blocks the cut until it is removed.
  const corner = state.loop[0];
  const edge = [corner[0] + (state.centroid[0] - corner[0]) * 0.08, corner[1] + (state.centroid[1] - corner[1]) * 0.08, 8];
  const edgeAt = await screen(page, edge);
  await page.mouse.click(edgeAt.x, edgeAt.y);
  await page.waitForFunction(() => window.__cutStore.getState().connectors.length === 2);
  await page.waitForSelector('[data-testid="cut-connector-row"][data-invalid]');
  assert.equal(await page.isDisabled('#perform-cut-btn'), true);
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => window.__cutStore.getState().connectors.length === 1);
  assert.equal(await page.isDisabled('#perform-cut-btn'), false);

  // Editor-only: thumbnails and the engine model ignore the preview; Escape returns to the plane; Cancel restores.
  assert.equal(await thumbnail(page), plainThumb, 'thumbnail excludes plane and connector markers');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__cutStore.getState().connectorMode && window.__cutStore.getState().isCutActive);
  await page.click('#cut-cancel-btn');
  await page.waitForFunction(() => !window.__cutStore.getState().isCutActive);
  assert.equal(await page.evaluate(() => window.__plateScene.cutPreview.group.visible || !window.__plateScene.getSelectedMesh().material.visible), false);
  assert.deepEqual(await packed(page), original, 'cancel leaves the packed geometry and transform unchanged');
  assert.equal(await thumbnail(page), plainThumb);

  // Confirmed cut with one connector, then undo.
  await openCut(page);
  await page.fill('#cut-z-input', '8');
  await page.click('#cut-connectors-mode-btn');
  await page.waitForFunction(() => window.__plateScene.cutPreview.upperPlane.constant < -8);
  state = await cutState(page);
  const center = await screen(page, [...state.centroid, 8]);
  await page.mouse.click(center.x, center.y);
  await page.waitForFunction(() => window.__cutStore.getState().connectors.length === 1);
  await page.click('#perform-cut-btn');
  await page.waitForSelector('#cut-success-message', { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 2);
  assert.equal(await page.evaluate(() => window.__plateScene.cutPreview.group.visible), false);
  await page.click('#cut-cancel-btn');
  await page.evaluate(() => window.__historyStore.getState().undo());
  await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
  assert.deepEqual(await packed(page), original, 'undo restores the uncut object');

  // Corners survive the model replacement.
  const ids = await page.evaluate(() => { const o = window.__plateStore.getState().objects[0]; return [o.id, o.instances[0].id]; });
  await page.evaluate(([o, i]) => window.__plateStore.getState().selectObject(o, i), ids);
  await orbit(page, 1.3, 0.5);
  await corners(page, 'after cut undo');
  console.log('cut plane, connector placement, invalid clicks, cancel, confirmed cut and undo pass');
}

async function suite() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await cornerSuite(page);
    await cutSuite(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

await startServer(port, 'cut-preview');
try { await suite(); } finally { await stopServer(port); }
