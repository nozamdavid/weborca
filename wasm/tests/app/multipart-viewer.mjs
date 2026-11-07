#!/usr/bin/env node
// Real-engine regression: sidebar part selection must leave the parent instance unchanged.
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';
import { startServer, stopServer } from './lib/dist.mjs';

const base = process.env.APP_TEST_BASE_URL || 'http://127.0.0.1:5331';
const output = process.env.APP_TEST_OUTPUT;
const failures = [];
const check = (name, actual, expected) => {
  try { assert.deepEqual(actual, expected, name); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message}`); }
};
if (!process.env.APP_TEST_BASE_URL) await startServer(5331, 'multipart-viewer');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(base).origin && !/^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud|orca-cloud)(\/|$)/.test(url.pathname)
      ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => console.log('PAGE ERROR', error.stack));
  page.on('console', message => { if (message.type() === 'error') console.log('BROWSER ERROR', message.text()); });
  await page.goto(base);
  await selectAddedPrinter(page, 'Voron');
  await page.setInputFiles('#model-file', path.resolve('tests/data/20mm_cube.obj'));
  await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
  await page.evaluate(async () => {
    const engine = window.__orcaEngine;
    const object = (await engine.listObjects())[0];
    await engine.setInstanceTransform({ objectId: object.id, instanceId: object.instances[0].id, offset: [150, 150, 10] });
    await engine.addVolume({ objectId: object.id, type: 'part', shape: 'cube', size: 12, offset: [35, 0, 0], name: 'Fixture second part' });
    // Round-trip a valid public-only assembled project fixture through the maintained native API.
    await engine.call('saveProject', { path: '/out/multipart-fixture.3mf' });
    await engine.call('openProject', { path: '/out/multipart-fixture.3mf' });
    await window.__plateStore.getState().refreshObjects();
    await window.__objectListStore.getState().refreshTree();
    const obj = window.__plateStore.getState().objects[0];
    window.__plateStore.getState().selectObject(obj.id, obj.instances[0].id);
    await window.__historyStore.getState().commitTransaction('Multipart fixture');
  });
  const fixture = await page.evaluate(async () => {
    const object = (await window.__orcaEngine.listObjects())[0];
    const tree = (await window.__orcaEngine.getObjectTree()).objects[0];
    return { objectId: object.id, instance: object.instances[0], volumeId: tree.volumes[1].id, siblingId: tree.volumes[0].id,
      volume: await window.__orcaEngine.call('getVolume', { objectId: object.id, volumeId: tree.volumes[1].id }) };
  });
  const read = () => page.evaluate(async () => (await window.__orcaEngine.listObjects())[0].instances[0]);
  const readVolume = (id = fixture.volumeId) => page.evaluate(async ({ objectId, volumeId }) => window.__orcaEngine.call('getVolume', { objectId, volumeId }), { objectId: fixture.objectId, volumeId: id });
  const sibling = await readVolume(fixture.siblingId);
  check('imported assembly keeps native part offsets', [sibling.offset, fixture.volume.offset], [[0, 0, 0], [35, 0, 0]]);
  const transport = await page.evaluate(async ({ objectId }) => {
    const engine = window.__orcaEngine;
    const before = await engine.getMesh(objectId);
    const added = await engine.addVolume({ objectId, type: 'negative', shape: 'cube', size: 10, offset: [0, 35, 0] });
    const viewer = await engine.call('getMesh', { objectId, forViewer: true });
    const pathBytes = await engine.readFile(viewer.path);
    const after = await engine.getMesh(objectId);
    const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const parsed = new DataView(viewer.buffer.buffer, viewer.buffer.byteOffset, viewer.buffer.byteLength);
    const part = viewer.volumes.find(v => v.volumeId === added.volumeId);
    await engine.deleteVolume(objectId, added.volumeId);
    return { path: viewer.path, metadata: !!part && part.type === 'negative' && part.vertexCount > 0 && part.facetCount > 0 && Array.isArray(part.offset),
      ownedBytes: viewer.buffer instanceof Uint8Array && equal(viewer.buffer, pathBytes) && parsed.getUint32(0, true) === 0x4d455348,
      defaultUnchanged: before.path === after.path && JSON.stringify(before.volumes) === JSON.stringify(after.volumes) && equal(before.buffer, after.buffer),
      vertices: parsed.getUint32(4, true), facets: parsed.getUint32(8, true) };
  }, fixture);
  console.log('ACTUAL WORKER TRANSPORT', JSON.stringify(transport));
  check('Worker carries non-model viewer metadata', transport.metadata, true);
  check('Worker transferred raw bytes match path reader after later requests', transport.ownedBytes, true);
  check('default baked normal geometry contract unchanged', transport.defaultUnchanged, true);
  const remap = async () => {
    const ids = await page.evaluate(async () => {
      const object = (await window.__orcaEngine.listObjects())[0];
      const tree = (await window.__orcaEngine.getObjectTree()).objects[0];
      return { objectId: object.id, instanceId: object.instances[0].id, volumeId: tree.volumes.find(v => v.name === 'Fixture second part').id, siblingId: tree.volumes[0].id };
    });
    Object.assign(fixture, { objectId: ids.objectId, volumeId: ids.volumeId, siblingId: ids.siblingId });
    fixture.instance.id = ids.instanceId;
    Object.assign(sibling, { objectId: ids.objectId, volumeId: ids.siblingId });
  };
  const restore = () => page.evaluate(async ({ objectId, instance }) => {
    await window.__orcaEngine.setInstanceTransform({ objectId, instanceId: instance.id, ...instance });
    await window.__plateStore.getState().refreshObjects();
  }, fixture);
  const selectPart = async () => {
    const row = page.locator(`[data-testid="volume-row-${fixture.volumeId}"]`).first();
    if (!await row.isVisible()) await page.locator(`[data-testid="object-row-${fixture.objectId}"]`).first().locator('button').first().click();
    await row.click();
    await page.waitForFunction(id => window.__objectListStore.getState().selectedVolumeId === id, fixture.volumeId);
  };
  console.log('BASELINE', JSON.stringify(fixture));
  if (process.env.MULTIPART_WORKER_PROBE === '1') {
    const negativeId = await page.evaluate(async objectId => window.__objectListStore.getState().addVolume({ objectId, type: 'negative', shape: 'cube', size: 12 }), fixture.objectId);
    await page.waitForFunction(id => [...window.__plateScene.volumeMeshes.values()].some(m => m.userData.volumeId === id), negativeId);
    await selectPart();
    await page.click('#view-iso');
    await page.waitForTimeout(300);
    const probe = await page.evaluate(async ({ objectId, volumeId }) => {
      const engine = window.__orcaEngine;
      const volume = await engine.call('getVolume', { objectId, volumeId });
      const viewer = await engine.call('getMesh', { objectId, forViewer: true });
      const ordinary = await engine.getMesh(objectId);
      return { volume, viewer: { path: viewer.path, volumes: viewer.volumes }, ordinary: { path: ordinary.path, volumes: ordinary.volumes } };
    }, fixture);
    console.log('WORKER PROBE', JSON.stringify(probe));
    if (output) for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.screenshot({ path: path.join(output, `live-worker-${theme}.png`) });
    }
    assert.ok(probe.viewer.volumes.every(v => Array.isArray(v.offset)), 'browser worker must preserve forViewer metadata');
    check('live Worker includes negative partition', probe.viewer.volumes.some(v => v.volumeId === negativeId && v.type === 'negative'), true);
    check('live ordinary mesh excludes negative', probe.ordinary.volumes.some(v => v.volumeId === negativeId), false);
    check('live native volume nodes render with negative opacity and selected part', await page.evaluate(({ negativeId, partId }) => {
      const s = window.__plateScene, nodes = [...s.volumeMeshes.values()];
      const negative = nodes.find(n => n.userData.volumeId === negativeId), part = nodes.find(n => n.userData.volumeId === partId);
      const pixels = new Uint8Array(4);
      // Read in the render turn, before WebGL discards the drawing buffer.
      s.renderer.render(s.scene, s.camera);
      const gl = s.renderer.getContext(); gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { negativeVisible: negative.visible, opacity: negative.material.opacity, partVisible: part.visible, selected: part.material.emissive.getHex() !== 0, drawn: pixels[3] > 0 };
    }, { negativeId, partId: fixture.volumeId }), { negativeVisible: true, opacity: 0.35, partVisible: true, selected: true, drawn: true });
    assert.equal(failures.length, 0, failures.join('; '));
  } else {
  await selectPart();
  await page.click('#tool-move-btn');
  await page.waitForFunction(() => document.querySelector('#nt-pos-x')?.value === '35');
  await page.locator('#nt-pos-x').fill('45');
  await page.locator('#nt-pos-x').press('Enter');
  await page.waitForTimeout(500);
  console.log('NUMERIC MOVE native', JSON.stringify(await read()));
  check('selected part numeric Move preserves parent', await read(), fixture.instance);
  check('numeric Move changes native part', (await readVolume()).offset, [45, 0, 0]);
  check('numeric Move preserves native sibling', await readVolume(fixture.siblingId), sibling);
  await page.click('#tool-undo-btn');
  await page.waitForTimeout(600);
  await remap();
  check('UI Undo restores part', (await readVolume()).offset, fixture.volume.offset);
  await page.click('#tool-redo-btn');
  await page.waitForTimeout(600);
  await remap();
  check('UI Redo restores part edit', (await readVolume()).offset, [45, 0, 0]);
  check('UI Redo keeps selected part identity', await page.evaluate(() => window.__objectListStore.getState().selectedVolumeId), fixture.volumeId);
  await restore();
  await selectPart();
  await page.click('#tool-rotate-btn');
  await page.locator('#nt-rot-z').fill('30');
  await page.locator('#nt-rot-z').press('Enter');
  await page.waitForTimeout(500);
  console.log('NUMERIC ROTATE native', JSON.stringify(await read()));
  check('selected part numeric Rotate preserves parent', await read(), fixture.instance);
  check('numeric Rotate changes native part radians', Math.abs((await readVolume()).rotation[2] - Math.PI / 6) < 1e-9, true);
  await restore();
  await selectPart();
  await page.click('#tool-move-btn');
  console.log('ATTACH STATE', await page.evaluate(() => {
    const s = window.__plateScene;
    return { selected: [s.selectedObjectId, s.selectedInstanceId, s.selectedVolumeId], keys: [...s.volumeMeshes.keys()], mode: s.gizmoMode, painting: s.isPaintingActive, measure: s.measureActive, explode: s.explodeActive, cut: s.cutPreview.active, extra: [...s.extraKeys], store: [window.__plateStore.getState().selectedObjectId, window.__plateStore.getState().selectedInstanceId] };
  }));
  await page.waitForFunction(id => window.__plateScene.transformControls.object?.userData.volumeId === id, fixture.volumeId);
  const target = await page.evaluate(() => {
    const scene = window.__plateScene;
    return { ...scene.transformControls.object.userData };
  });
  console.log('GIZMO TARGET', JSON.stringify(target));
  check('Move gizmo attaches selected volume', target.volumeId, fixture.volumeId);
  const dragHandle = async (mode, axis) => {
    const candidates = await page.evaluate(({ mode, axis }) => {
      const scene = window.__plateScene, control = scene.transformControls;
      const rect = scene.renderer.domElement.getBoundingClientRect();
      const project = v => { v.project(scene.camera); return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2 }; };
      const points = [];
      for (const handle of control._gizmo.gizmo[mode].children) {
        if (handle.name !== axis || !handle.visible || !handle.geometry?.attributes.position) continue;
        const attr = handle.geometry.attributes.position;
        for (let i = 0; i < attr.count; i += Math.max(1, Math.floor(attr.count / 24))) {
          points.push(project(control.object.position.clone().fromBufferAttribute(attr, i).applyMatrix4(handle.matrixWorld)));
        }
      }
      control.object.updateWorldMatrix(true, false);
      return { points, center: project(control.object.position.clone().setFromMatrixPosition(control.object.matrixWorld)) };
    }, { mode, axis });
    let point;
    for (const candidate of candidates.points) {
      if (candidate.x < 400 || candidate.x > 1260 || candidate.y < 80 || candidate.y > 760) continue;
      await page.mouse.move(candidate.x, candidate.y);
      if (await page.evaluate(axis => window.__plateScene.transformControls.axis === axis, axis)) { point = candidate; break; }
    }
    assert.ok(point, `actual ${mode} ${axis} handle found`);
    await page.mouse.down();
    if (mode === 'translate') await page.mouse.move(point.x + 24, point.y, { steps: 10 });
    else {
      const dx = point.x - candidates.center.x, dy = point.y - candidates.center.y, angle = 0.4;
      await page.mouse.move(candidates.center.x + dx * Math.cos(angle) - dy * Math.sin(angle), candidates.center.y + dx * Math.sin(angle) + dy * Math.cos(angle), { steps: 10 });
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
  };
  await page.click('#view-top');
  await page.waitForTimeout(300);
  const beforeHandle = await readVolume();
  await dragHandle('translate', 'X');
  check('actual Move handle changes native part', JSON.stringify((await readVolume()).offset) !== JSON.stringify(beforeHandle.offset), true);
  check('actual Move handle preserves parent', await read(), fixture.instance);
  await page.click('#tool-rotate-btn');
  await page.waitForTimeout(200);
  const beforeRotateHandle = await readVolume();
  await dragHandle('rotate', 'Z');
  check('actual Rotate handle changes native part', JSON.stringify((await readVolume()).rotation) !== JSON.stringify(beforeRotateHandle.rotation), true);
  check('actual Rotate handle preserves volume pivot', (await readVolume()).offset, beforeRotateHandle.offset);
  check('actual Rotate handle preserves parent and sibling', [await read(), await readVolume(fixture.siblingId)], [fixture.instance, sibling]);
  // Disable handles so this exercises body dragging independently of the gizmo.
  await page.click('#tool-rotate-btn');
  await page.waitForFunction(() => window.__plateStore.getState().gizmoMode === null);
  await page.click('#view-top');
  await page.waitForTimeout(600);
  const partPoint = () => page.evaluate(({ objectId, instance, volumeId }) => {
    const scene = window.__plateScene, mesh = scene.volumeMeshes.get(`${objectId}_${instance.id}_${volumeId}`);
    mesh.updateWorldMatrix(true, false);
    const v = mesh.geometry.boundingBox.getCenter(mesh.position.clone()).applyMatrix4(mesh.matrixWorld).project(scene.camera);
    const rect = scene.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2 };
  }, fixture);
  const beforeDrag = await readVolume();
  const point = await partPoint();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 24, point.y + 12, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log('BODY DRAG native', JSON.stringify(await read()));
  check('selected part body drag preserves parent', await read(), fixture.instance);
  check('body drag changes native part', JSON.stringify((await readVolume()).offset) !== JSON.stringify(beforeDrag.offset), true);
  check('body drag preserves sibling', await readVolume(fixture.siblingId), sibling);
  await restore();
  const api = await page.evaluate(async ({ objectId, volumeId }) => {
    const result = {};
    for (const op of ['getVolume', 'setVolumeTransform']) {
      try { await window.__orcaEngine.call(op, { objectId, volumeId }); result[op] = 'supported'; }
      catch (error) { result[op] = error.message; }
    }
    const added = await window.__orcaEngine.addVolume({ objectId, type: 'negative', shape: 'cube', size: 10, offset: [0, 35, 0] });
    const mesh = await window.__orcaEngine.call('getMesh', { objectId, forViewer: true });
    await window.__plateStore.getState().refreshObjects();
    await window.__objectListStore.getState().refreshTree();
    result.negative = { id: added.volumeId, partitions: mesh.volumes };
    return result;
  }, fixture);
  console.log('NATIVE API', JSON.stringify(api));
  check('native volume transform readback available', api.getVolume, 'supported');
  check('native volume transform mutation available', api.setVolumeTransform, 'supported');
  check('negative included in viewer mesh', api.negative.partitions.some(p => p.volumeId === api.negative.id), true);
  await page.evaluate(async ({ objectId, instance }) => {
    await window.__orcaEngine.setInstanceTransform({ objectId, instanceId: instance.id, rotation: [0, 0, 0.6], scale: [1.3, 0.8, 1.2], mirror: [-1, 1, 1] });
    await window.__plateStore.getState().refreshObjects();
  }, fixture);
  await selectPart();
  const transformedParent = await read(), transformedPart = await readVolume();
  await page.click('#view-top');
  await page.waitForTimeout(300);
  const transformedPoint = await partPoint();
  await page.mouse.move(transformedPoint.x, transformedPoint.y);
  await page.mouse.down();
  await page.evaluate(() => {
    const s = window.__plateScene, drag = s.planeDrag, node = drag.target;
    const origin = node.position.clone(), inverse = node.normalMatrix.clone().setFromMatrix4(node.parent.matrixWorld).invert();
    // CDP rounds screen coordinates; predict from the actual trusted pointer event.
    const predict = event => {
      const delta = s.pointerRay(event).ray.intersectPlane(drag.plane, drag.start.clone()).sub(drag.start);
      delta.z = 0;
      window.__expectedMultipartOffset = origin.clone().add(delta.applyMatrix3(inverse)).toArray();
    };
    s.renderer.domElement.addEventListener('pointermove', predict, true);
    s.renderer.domElement.addEventListener('pointerup', () => s.renderer.domElement.removeEventListener('pointermove', predict, true), { once: true });
  });
  await page.mouse.move(transformedPoint.x + 25, transformedPoint.y + 10, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const expectedOffset = await page.evaluate(() => window.__expectedMultipartOffset);
  const draggedPart = await readVolume();
  console.log('INVERSE PARENT', JSON.stringify({ actual: draggedPart.offset, expected: expectedOffset, point: transformedPoint }));
  check('rotated scaled mirrored parent body drag preserves parent', await read(), transformedParent);
  check('transformed parent drag changes part offset', JSON.stringify(draggedPart.offset) !== JSON.stringify(transformedPart.offset), true);
  check('transformed parent drag uses precise inverse parent conversion', draggedPart.offset.every((v, i) => Math.abs(v - expectedOffset[i]) < 1e-8), true);
  check('translation preserves exact native linear components', [draggedPart.rotation, draggedPart.scale, draggedPart.mirror], [transformedPart.rotation, transformedPart.scale, transformedPart.mirror]);
  check('transformed parent drag preserves sibling', await readVolume(fixture.siblingId), sibling);
  await page.click('#tool-move-btn');
  await page.waitForTimeout(250);
  const transformedMove = await readVolume();
  await dragHandle('translate', 'X');
  check('Move handle under transformed parent changes native part', JSON.stringify((await readVolume()).offset) !== JSON.stringify(transformedMove.offset), true);
  check('Move under transformed parent preserves parent and sibling', [await read(), await readVolume(fixture.siblingId)], [transformedParent, sibling]);
  await page.locator('#nt-pos-x').fill(String((await readVolume()).offset[0] + 2));
  await page.locator('#nt-pos-x').press('Enter');
  await page.waitForTimeout(400);
  check('numeric Move under transformed parent preserves parent and sibling', [await read(), await readVolume(fixture.siblingId)], [transformedParent, sibling]);
  await page.click('#tool-rotate-btn');
  await page.waitForTimeout(250);
  const transformedRotate = await readVolume();
  await dragHandle('rotate', 'Z');
  const rotated = await readVolume();
  check('Rotate handle under transformed parent changes native part', JSON.stringify(rotated.rotation) !== JSON.stringify(transformedRotate.rotation), true);
  check('Rotate under transformed parent keeps native volume pivot', rotated.offset, transformedRotate.offset);
  check('Rotate under transformed parent preserves parent and sibling', [await read(), await readVolume(fixture.siblingId)], [transformedParent, sibling]);
  await page.locator('#nt-rot-z').fill('25');
  await page.locator('#nt-rot-z').press('Enter');
  await page.waitForTimeout(400);
  check('numeric Rotate under transformed parent changes only part', Math.abs((await readVolume()).rotation[2] - 25 * Math.PI / 180) < 1e-9, true);
  check('numeric Rotate under transformed parent preserves parent and sibling', [await read(), await readVolume(fixture.siblingId)], [transformedParent, sibling]);
  await page.click('#tool-rotate-btn');
  await restore();

  const added = [];
  for (const type of ['part', 'negative', 'modifier', 'support_blocker', 'support_enforcer']) {
    const parentBeforeAdd = await read(), siblingBeforeAdd = await readVolume(fixture.siblingId);
    const id = await page.evaluate(async ({ objectId, type }) => window.__objectListStore.getState().addVolume({ objectId, type, shape: 'cube', size: 12 }), { objectId: fixture.objectId, type });
    await page.waitForFunction(id => [...window.__plateScene.volumeMeshes.values()].some(m => m.userData.volumeId === id), id);
    const placement = await page.evaluate(id => {
      const scene = window.__plateScene, node = [...scene.volumeMeshes.values()].find(m => m.userData.volumeId === id);
      node.updateWorldMatrix(true, false);
      const box = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
      return { min: box.min.toArray(), max: box.max.toArray(), selected: window.__objectListStore.getState().selectedVolumeId,
        material: { opacity: node.material.opacity, transparent: node.material.transparent, depthWrite: node.material.depthWrite, side: node.material.side }, bed: window.__plateStore.getState().bedConfig };
    }, id);
    console.log('PLACEMENT', type, JSON.stringify(placement));
    check(`${type} added selected`, placement.selected, id);
    check(`${type} creation preserves parent and sibling`, [await read(), await readVolume(fixture.siblingId)], [parentBeforeAdd, siblingBeforeAdd]);
    check(`${type} world bounds front-right grounded`, placement.min[0] > placement.bed.center[0] && placement.max[1] < placement.bed.center[1] && Math.abs(placement.min[2]) < 1e-6 && placement.max[0] <= Math.max(...placement.bed.points.map(p => p[0])) - 5 + 1e-6, true);
    if (type !== 'part') check(`${type} translucent double sided`, placement.material, { opacity: 0.35, transparent: true, depthWrite: false, side: 2 });
    added.push({ id, placement });
  }
  check('repeated volumes avoid exact stacks', new Set(added.map(a => JSON.stringify(a.placement.min))).size, added.length);
  await page.evaluate(() => {
    const scene = window.__plateScene;
    window.__multipartGeometry = [...scene.volumeMeshes.values()].map(m => m.geometry);
    scene.setVolumeColors(new Map([[window.__plateStore.getState().objects[0].id, new Map([...scene.volumeMeshes.values()].map(m => [m.userData.volumeId, '#ec5b32']))]]));
  });
  check('colour changes reuse geometry and preserve negative opacity', await page.evaluate(() => {
    const meshes = [...window.__plateScene.volumeMeshes.values()];
    return meshes.every((m, i) => m.geometry === window.__multipartGeometry[i] && (m.userData.type === 'part' || m.material.opacity === 0.35));
  }), true);
  await page.evaluate(async () => window.__appStore.getState().setSlotColor(0, '#EC5B32'));
  await page.waitForFunction(() => [...window.__plateScene.volumeMeshes.values()].filter(m => m.userData.type === 'part').every(m => m.material.color.getHexString() === 'ec5b32'));
  check('filament colour selection updates normal material and keeps type opacity', await page.evaluate(() => [...window.__plateScene.volumeMeshes.values()].every(m => m.material.opacity === (m.userData.type === 'part' ? 1 : 0.35))), true);
  await selectPart();
  check('only selected part highlighted', await page.evaluate(id => [...window.__plateScene.volumeMeshes.values()].every(m => (m.material.emissive.getHex() !== 0) === (m.userData.volumeId === id)), fixture.volumeId), true);
  const copyId = await page.evaluate(async ({ objectId, instance }) => {
    const e = window.__orcaEngine;
    const copy = await e.call('duplicateInstance', { objectId, instanceId: instance.id });
    await e.setInstanceTransform({ objectId, instanceId: copy.instanceId, offset: [110, 210, 10], rotation: [0.1, 0.2, -0.4], scale: [0.7, 1.1, 0.9], mirror: [1, -1, 1] });
    await window.__plateStore.getState().refreshObjects();
    return copy.instanceId;
  }, fixture);
  await page.waitForFunction(id => [...window.__plateScene.volumeMeshes.values()].some(m => m.userData.instanceId === id), copyId);
  const parentsBeforeShared = await page.evaluate(async () => (await window.__orcaEngine.listObjects())[0].instances);
  await page.click('#tool-move-btn');
  const sharedBefore = await readVolume();
  await page.locator('#nt-pos-x').fill(String(sharedBefore.offset[0] + 3));
  await page.locator('#nt-pos-x').press('Enter');
  await page.waitForTimeout(500);
  const shared = await readVolume();
  check('volume edit leaves all native parent copies unchanged', await page.evaluate(async () => (await window.__orcaEngine.listObjects())[0].instances), parentsBeforeShared);
  check('shared volume edit updates both rendered copies', await page.evaluate(({ id, offset }) => {
    const nodes = [...window.__plateScene.volumeMeshes.values()].filter(m => m.userData.volumeId === id);
    return nodes.length === 2 && nodes.every(m => m.position.toArray().every((v, i) => Math.abs(v - offset[i]) < 1e-8));
  }, { id: fixture.volumeId, offset: shared.offset }), true);
  await page.click('#tool-move-btn');
  // Selecting the object row must restore whole-assembly body movement.
  await page.locator(`[data-testid="object-row-${fixture.objectId}"]`).first().click();
  await page.waitForFunction(() => window.__objectListStore.getState().selectedVolumeId === null);
  await page.click('#view-top');
  await page.waitForTimeout(350);
  const wholeBefore = await read(), partBeforeWhole = await readVolume();
  const wholePoint = await partPoint();
  await page.mouse.move(wholePoint.x, wholePoint.y);
  await page.mouse.down();
  await page.mouse.move(wholePoint.x + 22, wholePoint.y + 10, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  check('whole-object body movement changes selected parent', JSON.stringify((await read()).offset) !== JSON.stringify(wholeBefore.offset), true);
  check('whole-object body movement preserves volume transforms', await readVolume(), partBeforeWhole);
  check('whole-object movement preserves other parent copy', await page.evaluate(async id => (await window.__orcaEngine.listObjects())[0].instances.find(i => i.id === id), copyId), parentsBeforeShared.find(i => i.id === copyId));
  await restore();
  await selectPart();
  if (output) for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.click('#view-iso');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, `multipart-${theme}.png`) });
  }
  const savedPart = await readVolume();
  const savedParents = await page.evaluate(async () => (await window.__orcaEngine.listObjects())[0].instances.map(({ id, ...transform }) => transform));
  const autosave = await page.evaluate(async () => {
    await window.__autosave.writeAutosave();
    const record = await window.__autosave.readAutosave();
    return record?.bytes ? Array.from(record.bytes) : null;
  });
  check('autosave stores native project bytes after volume edits', autosave?.length > 0, true);
  await page.evaluate(async () => {
    await window.__orcaEngine.call('saveProject', { path: '/out/multipart-edited.3mf' });
    await window.__orcaEngine.call('openProject', { path: '/out/multipart-edited.3mf' });
    window.__plateStore.setState({ meshCache: new Map() });
    await window.__plateStore.getState().refreshObjects();
    await window.__objectListStore.getState().refreshTree();
  });
  await remap();
  const reopened = await readVolume();
  check('saved edited project preserves part transforms', ['offset', 'rotation', 'scale', 'mirror'].every(key => reopened[key].every((v, i) => Math.abs(v - savedPart[key][i]) < 1e-6)), true);
  check('saved project preserves all parent transforms', await page.evaluate(async parents => (await window.__orcaEngine.listObjects())[0].instances.map(({ id, ...transform }) => transform).every((transform, j) => ['offset', 'rotation', 'scale', 'mirror'].every(key => transform[key].every((v, i) => Math.abs(v - parents[j][key][i]) < 1e-6))), savedParents), true);
  await page.evaluate(async bytes => {
    await window.__orcaEngine.writeFile('/out/multipart-autosave.3mf', new Uint8Array(bytes));
    await window.__orcaEngine.call('openProject', { path: '/out/multipart-autosave.3mf' });
    window.__plateStore.setState({ meshCache: new Map() });
    await window.__plateStore.getState().refreshObjects();
    await window.__objectListStore.getState().refreshTree();
  }, autosave);
  await remap();
  const recovered = await readVolume();
  check('native autosave recovery preserves edited part transforms', ['offset', 'rotation', 'scale', 'mirror'].every(key => recovered[key].every((v, i) => Math.abs(v - savedPart[key][i]) < 1e-6)), true);

  // Native second plate supplies the offset; the custom polygon is real printer config.
  const custom = await page.evaluate(async ({ objectId, instance }) => {
    const e = window.__orcaEngine, app = window.__appStore.getState();
    window.__originalArea = app.currentConfig.printable_area;
    await app.applyOptionChange('printable_area', '20x30,270x30,290x90,260x270,20x270', 'printer');
    await window.__platesStore.getState().addPlate('Multipart offset plate');
    const p = window.__platesStore.getState().plates[1];
    await e.setInstanceTransform({ objectId, instanceId: instance.id, offset: [p.origin[0] + 150, p.origin[1] + 150, 15], rotation: [0.15, -0.2, 0.6], scale: [1.3, 0.8, 1.2], mirror: [-1, 1, 1] });
    await window.__plateStore.getState().refreshObjects();
    window.__platesStore.getState().setActivePlate(1);
    window.__plateStore.getState().selectObject(objectId, instance.id);
    return { origin: p.origin, bed: window.__plateStore.getState().bedConfig };
  }, fixture);
  check('custom plate has actual nonzero native origin', custom.origin.some(v => v !== 0), true);
  const customParent = await read(), customSibling = await readVolume(fixture.siblingId);
  for (let i = 0; i < 2; i++) {
    const id = await page.evaluate(async objectId => window.__objectListStore.getState().addVolume({ objectId, type: 'negative', shape: 'cube', size: 12 }), fixture.objectId);
    await page.waitForFunction(id => [...window.__plateScene.volumeMeshes.values()].some(m => m.userData.volumeId === id), id);
    const placement = await page.evaluate(({ id, origin }) => {
      const scene = window.__plateScene, n = [...scene.volumeMeshes.values()].find(m => m.userData.volumeId === id && m.userData.instanceId === window.__plateStore.getState().selectedInstanceId);
      n.updateWorldMatrix(true, false);
      const box = n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld);
      const polygon = window.__plateStore.getState().bedConfig.points;
      const inside = (x, y) => {
        let yes = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const a = polygon[i], b = polygon[j];
          if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
        }
        return yes;
      };
      const corners = [box.min.x - origin[0] - 4.99, box.max.x - origin[0] + 4.99].flatMap(x => [box.min.y - origin[1] - 4.99, box.max.y - origin[1] + 4.99].map(y => [x, y]));
      return { min: box.min.toArray(), max: box.max.toArray(), inside: corners.every(([x, y]) => inside(x, y)) };
    }, { id, origin: custom.origin });
    console.log('CUSTOM PLACEMENT', JSON.stringify(placement));
    check(`custom offset polygon placement ${i} full transformed footprint inside with margin`, placement.inside, true);
    check(`custom offset polygon placement ${i} front-right grounded`, placement.min[0] > custom.origin[0] + custom.bed.center[0] && placement.max[1] < custom.origin[1] + custom.bed.center[1] && Math.abs(placement.min[2] - custom.origin[2]) < 1e-6, true);
    check(`custom placement ${i} preserves transformed parent and sibling`, [await read(), await readVolume(fixture.siblingId)], [customParent, customSibling]);
  }
  // Observe real dispose events when the UI removes a volume.
  const disposable = await page.evaluate(async objectId => window.__objectListStore.getState().addVolume({ objectId, type: 'modifier', shape: 'cube', size: 8 }), fixture.objectId);
  await page.waitForFunction(id => [...window.__plateScene.volumeMeshes.values()].filter(m => m.userData.volumeId === id).length === 2, disposable);
  await page.evaluate(id => {
    window.__disposedVolumes = { geometry: 0, material: 0 };
    for (const n of window.__plateScene.volumeMeshes.values()) if (n.userData.volumeId === id) {
      n.geometry.addEventListener('dispose', () => window.__disposedVolumes.geometry++);
      n.material.addEventListener('dispose', () => window.__disposedVolumes.material++);
    }
  }, disposable);
  await page.evaluate(async ({ objectId, id }) => window.__objectListStore.getState().deleteVolume(objectId, id), { objectId: fixture.objectId, id: disposable });
  await page.waitForFunction(id => ![...window.__plateScene.volumeMeshes.values()].some(m => m.userData.volumeId === id), disposable);
  check('removal disposes each copy volume buffers and material', await page.evaluate(() => window.__disposedVolumes), { geometry: 2, material: 2 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await page.evaluate(() => {
    window.__trustedMultipartTouches = [];
    document.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') window.__trustedMultipartTouches.push(e.isTrusted); }, true);
  });
  const phoneBefore = await page.evaluate(async () => ({ instances: (await window.__orcaEngine.listObjects())[0].instances, volumes: await Promise.all((await window.__orcaEngine.getObjectTree()).objects[0].volumes.map(v => window.__orcaEngine.call('getVolume', { objectId: window.__plateStore.getState().objects[0].id, volumeId: v.id }))) }));
  const camera = () => page.evaluate(() => { const s = window.__plateScene; return { rotation: s.camera.quaternion.toArray(), target: s.orbitControls.target.toArray(), distance: s.camera.position.distanceTo(s.orbitControls.target), zoom: s.camera.zoom }; });
  const canvas = await page.locator('.plate-view canvas').first().boundingBox();
  const p = { x: canvas.x + canvas.width * 0.45, y: canvas.y + canvas.height * 0.5 };
  const touch = async (type, points) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ ...p, radiusX: 1, radiusY: 1, force: 1 })) }); };
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    let a = { ...p, id: 1 }, b = { x: p.x + 70, y: p.y, id: 2 };
    const before = await camera();
    await touch('touchStart', [a]);
    a = { ...a, x: a.x + 20, y: a.y + 12 }; await touch('touchMove', [a]);
    await page.waitForTimeout(450);
    check(`phone ${theme} one finger orbits`, JSON.stringify((await camera()).rotation) !== JSON.stringify(before.rotation), true);
    const orbit = await camera();
    await touch('touchStart', [a, b]);
    a = { ...a, x: a.x - 15 }; b = { ...b, x: b.x + 15 }; await touch('touchMove', [a, b]);
    await page.waitForTimeout(450);
    const pinch = await camera();
    check(`phone ${theme} pinch zooms`, Math.abs(pinch.distance - orbit.distance) > 0.1 || Math.abs(pinch.zoom - orbit.zoom) > 0.01, true);
    a = { ...a, x: a.x + 15, y: a.y + 14 }; b = { ...b, x: b.x + 15, y: b.y + 14 }; await touch('touchMove', [a, b]);
    await page.waitForTimeout(450);
    check(`phone ${theme} two fingers pan`, JSON.stringify((await camera()).target) !== JSON.stringify(pinch.target), true);
    await touch('touchEnd', []);
    if (output) await page.screenshot({ path: path.join(output, `multipart-phone-${theme}.png`) });
  }
  check('phone trusted gestures leave all native instances and volumes unchanged', await page.evaluate(async () => ({ instances: (await window.__orcaEngine.listObjects())[0].instances, volumes: await Promise.all((await window.__orcaEngine.getObjectTree()).objects[0].volumes.map(v => window.__orcaEngine.call('getVolume', { objectId: window.__plateStore.getState().objects[0].id, volumeId: v.id }))) })), phoneBefore);
  check('phone gesture input is trusted browser touch', await page.evaluate(() => window.__trustedMultipartTouches.length > 0 && window.__trustedMultipartTouches.every(Boolean)), true);
  await cdp.detach();
  await page.setViewportSize({ width: 1280, height: 800 });
  if (output) for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: path.join(output, `live-dev-${theme}-baseline.png`) });
  }
  assert.equal(failures.length, 0, failures.join('; '));
  }
} finally {
  await browser.close();
  if (!process.env.APP_TEST_BASE_URL) await stopServer(5331);
}
