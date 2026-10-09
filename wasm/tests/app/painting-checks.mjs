import assert from 'node:assert/strict';

export async function readPaint(page, layer, objectId, volumeId) {
  return page.evaluate(async ({ layer, objectId, volumeId }) => {
    const state = window.__paintToolsStore.getState();
    return window.__orcaEngine.call(layer === 'seam' ? 'getSeamPainting' : 'getSupportPainting', {
      objectId: objectId ?? state.selectedObjectId, volumeId: volumeId ?? state.selectedVolumeId
    });
  }, { layer, objectId, volumeId });
}

export async function paintPoint(page, point, mode = 'enforce') {
  const previous = await page.evaluate(() => window.__historyStore.getState().currentSnapshot?.id);
  await pointerStroke(page, point, mode);
  await page.waitForFunction((id) => window.__historyStore.getState().currentSnapshot?.id !== id, previous);
}

async function pointerStroke(page, point, mode) {
  assert.ok(point, 'A visible facet must be available');
  if (mode === 'erase') await page.keyboard.down('Shift');
  const button = mode === 'block' ? 'right' : 'left';
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button });
  await page.mouse.move(point.x + 1, point.y + 1);
  await page.mouse.up({ button });
  if (mode === 'erase') await page.keyboard.up('Shift');
}

// Choose a centroid whose nearest intersection is that exact local facet. This
// avoids assuming the rear side of a transformed object is visible to the camera.
export async function visibleFacets(page) {
  return page.evaluate(() => {
    const state = window.__paintToolsStore.getState();
    const scene = window.__plateScene;
    const partition = scene.getMeshVolumes(state.selectedObjectId).find((v) => v.volumeId === state.selectedVolumeId);
    const canvas = scene.renderer.domElement;
    const points = [];
    for (let facet = 0; facet < partition.facetCount; facet++) {
      const point = scene.getFacetScreenCoordinates(state.selectedObjectId, facet, true, state.selectedVolumeId);
      const target = point && document.elementFromPoint(point.x, point.y);
      if (target !== canvas) continue;
      const hit = scene.raycastSelectedMesh({ clientX: point.x, clientY: point.y });
      if (hit?.faceIndex === facet) points.push({ ...point, facet });
    }
    return points;
  });
}

async function overlayFacets(page) {
  return page.evaluate(() => {
    const mesh = window.__plateScene.getSelectedMesh();
    const overlay = mesh?.getObjectByName('__paint_overlay_container__');
    return overlay?.children.reduce((count, child) => count + (child.geometry?.index?.count ?? 0) / 3, 0) ?? 0;
  });
}

async function waitOverlay(page, count) {
  await page.waitForFunction((count) => {
    const overlay = window.__plateScene.getSelectedMesh()?.getObjectByName('__paint_overlay_container__');
    return (overlay?.children.reduce((n, child) => n + (child.geometry?.index?.count ?? 0) / 3, 0) ?? 0) === count;
  }, count);
}

export async function paintingChecks(page, primaryLayer, results) {
  let objectId = await page.evaluate(() => {
    const plate = window.__plateStore.getState();
    plate.selectObject(plate.objects[0].id);
    return plate.objects[0].id;
  });
  await page.waitForSelector('#selection-panel');
  await page.click('#tool-paint-btn');
  await page.waitForSelector('#paint-tools-panel');
  assert.equal(await page.textContent('#paint-tools-title'), 'Painting Tools');
  await page.click(`#paint-layer-${primaryLayer}`);
  await page.click('#paint-tool-triangle');
  await page.uncheck('#triangle-splitting-checkbox');
  const volumeId = await page.evaluate(() => window.__paintToolsStore.getState().selectedVolumeId);
  const metadata = await page.evaluate((id) => window.__plateScene.getMeshVolumes(id), objectId);
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].firstFacet, 0);
  assert.equal(metadata[0].facetCount, 12);
  const initial = await readPaint(page, primaryLayer);
  assert.equal(initial.triangleCount, 12);
  assert.deepEqual(initial.enforcers, []);
  assert.deepEqual(initial.blockers, []);

  const points = await visibleFacets(page);
  assert.ok(points.length >= 2, 'Two distinct nearest-visible facets are required');
  const [first, second] = points;
  await paintPoint(page, first);
  const enforced = await readPaint(page, primaryLayer);
  assert.deepEqual(enforced.enforcers, [first.facet], 'Real pointer paints exactly the nearest visible facet');
  assert.equal(enforced[primaryLayer === 'seam' ? 'hasCustomSeam' : 'hasCustomSupports'], true);
  await waitOverlay(page, 1);
  assert.equal(await overlayFacets(page), 1, 'Rendered overlay contains the painted triangle');
  await paintPoint(page, first, 'erase');
  assert.deepEqual((await readPaint(page, primaryLayer)).enforcers, [], 'Shift-left erases the painted facet');
  await waitOverlay(page, 0);
  await paintPoint(page, second, 'block');
  assert.deepEqual((await readPaint(page, primaryLayer)).blockers, [second.facet], 'Right pointer paints blocker');
  await page.click('#paint-erase-all-btn');
  await page.waitForFunction(() => !window.__paintToolsStore.getState().isLoading);
  const cleared = await readPaint(page, primaryLayer);
  assert.deepEqual(cleared.enforcers, []);
  assert.deepEqual(cleared.blockers, []);
  assert.equal(cleared[primaryLayer === 'seam' ? 'hasCustomSeam' : 'hasCustomSupports'], false);
  results.push({ name: 'Nearest-visible pointer, erase, blocker, rendered overlay and clear', pass: true });

  // Distinct annotations in both categories survive target switches and 3MF.
  await page.click('#paint-layer-support');
  await paintPoint(page, first);
  const supportBefore = await readPaint(page, 'support');
  await page.click('#paint-layer-seam');
  await paintPoint(page, second, 'block');
  const seamBefore = await readPaint(page, 'seam');
  assert.deepEqual(await readPaint(page, 'support'), supportBefore, 'Seam editing cannot modify support');
  await page.click('#paint-layer-support');
  await waitOverlay(page, 1);
  assert.deepEqual(await readPaint(page, 'seam'), seamBefore, 'Target switching cannot modify seam');
  await page.click('#paint-done-btn');
  await page.waitForSelector('#paint-tools-panel', { state: 'detached' });
  assert.equal(await page.evaluate(() => window.__paintToolsStore.getState().isActive), false);

  const beforeCamera = await page.evaluate(() => window.__plateScene.camera.position.toArray());
  const box = await page.locator('#plate-canvas-container canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 4 + 60, box.y + box.height / 4 + 60);
  await page.mouse.up();
  await page.waitForFunction((before) => window.__plateScene.camera.position.toArray().some((n, i) => Math.abs(n - before[i]) > 0.1), beforeCamera);
  results.push({ name: 'Target isolation and exit restores orbit navigation', pass: true });

  const secondVolume = await page.evaluate(async (objectId) => {
    const added = await window.__orcaEngine.call('addVolume', { objectId, type: 'model_part', shape: 'cube', size: 20, offset: [30, 0, 0] });
    const plate = window.__plateStore.getState();
    plate.meshCache.clear();
    await plate.refreshObjects();
    plate.selectObject(objectId);
    return added.volumeId;
  }, objectId);
  assert.ok(secondVolume);
  await page.waitForFunction((id) => window.__plateScene.getMeshVolumes(id)?.length === 2, objectId);
  const partitions = await page.evaluate((id) => window.__plateScene.getMeshVolumes(id), objectId);
  assert.deepEqual(partitions.map((p) => [p.firstFacet, p.facetCount]), [[0, 12], [12, 12]]);
  await page.click('#tool-paint-btn');
  await page.waitForSelector('#paint-tools-panel');
  await page.click(`#paint-layer-${primaryLayer}`);
  await page.selectOption('#paint-volume-select', String(secondVolume));
  await page.waitForFunction((id) => window.__plateScene.paintingVolumeId === id, secondVolume);
  const v2Points = await visibleFacets(page);
  assert.ok(v2Points.length > 0);
  await paintPoint(page, v2Points[0]);
  const v2Paint = await readPaint(page, primaryLayer);
  assert.deepEqual(v2Paint.enforcers, [v2Points[0].facet], 'Second-volume stroke uses local facet index');
  assert.deepEqual(await readPaint(page, 'seam', objectId, volumeId), seamBefore, 'Second-volume stroke preserves first-volume seam');
  assert.deepEqual(await readPaint(page, 'support', objectId, volumeId), supportBefore, 'Second-volume stroke preserves first-volume support');
  await waitOverlay(page, 1);
  const overlayAligned = await page.evaluate(({ facet, secondVolume }) => {
    const scene = window.__plateScene;
    const mesh = scene.getSelectedMesh();
    const part = scene.getMeshVolumes(mesh.userData.objectId).find((p) => p.volumeId === secondVolume);
    const base = mesh.geometry;
    const overlay = mesh.getObjectByName('__paint_overlay_container__').children[0].geometry;
    const vertex = (geometry, index) => {
      const i = geometry.index.array[index] * 3;
      return Array.from(geometry.attributes.position.array.slice(i, i + 3));
    };
    const expected = [0, 1, 2].map((i) => vertex(base, (part.firstFacet + facet) * 3 + i));
    const actual = [0, 1, 2].map((i) => vertex(overlay, i));
    return expected.every((v) => actual.some((w) => v.every((n, i) => Math.abs(n - w[i]) < 0.001)));
  }, { facet: v2Points[0].facet, secondVolume });
  results.push({ name: 'Transformed second-volume local facet mapping and annotation isolation', pass: true });

  await page.click('#paint-done-btn');
  const reopened = await page.evaluate(async () => {
    const engine = window.__orcaEngine;
    await engine.call('saveProject', { path: '/out/painting_regression.3mf' });
    await engine.call('openProject', { path: '/out/painting_regression.3mf' });
    const tree = await engine.call('getObjectTree', {});
    const object = tree.objects[0];
    const plate = window.__plateStore.getState();
    plate.meshCache.clear();
    await plate.refreshObjects();
    plate.selectObject(object.id);
    return { objectId: object.id, volumes: object.volumes.map((v) => v.id) };
  });
  objectId = reopened.objectId;
  for (const [layer, volume, expected] of [['support', reopened.volumes[0], supportBefore], ['seam', reopened.volumes[0], seamBefore], [primaryLayer, reopened.volumes[1], v2Paint]]) {
    const actual = await readPaint(page, layer, objectId, volume);
    assert.deepEqual(actual.enforcers, expected.enforcers, '3MF preserves exact enforcers per volume/category');
    assert.deepEqual(actual.blockers, expected.blockers, '3MF preserves exact blockers per volume/category');
  }
  results.push({ name: '3MF round-trip retains both categories and both volumes', pass: true });

  const geometryUpdated = await page.evaluate(async (objectId) => {
    const plate = window.__plateStore.getState();
    const mesh = await plate.getMesh(objectId);
    const positions = new Float32Array(mesh.positions);
    positions[0] += 5;
    plate.meshCache.set(objectId, { ...mesh, positions });
    await window.__plateScene.setObjects(plate.objects);
    const actual = window.__plateScene.getSelectedMesh().geometry.attributes.position.array[0];
    plate.meshCache.set(objectId, mesh);
    await window.__plateScene.setObjects(plate.objects);
    return Math.abs(actual - positions[0]) < 0.0001;
  }, objectId);
  assert.ok(geometryUpdated, 'Same-size mesh updates must refresh geometry');
  await paintingRaces(page, objectId, reopened.volumes);
  results.push({ name: 'Async stop/target/volume races, cancellation and failed RPC rollback', pass: true });
  // Check the captured geometry after the independent persistence/race checks,
  // so an engine coordinate-contract failure does not hide their results.
  assert.ok(overlayAligned, 'Offset volume overlay vertices must align with merged object-space facet vertices');
  results.push({ name: 'Transformed second-volume overlay alignment', pass: true });
}

async function paintingRaces(page, objectId, volumes) {
  // Delay the real new start boundary (mesh resolution), including its error path.
  const startRaces = await page.evaluate(async ({ objectId, volumes }) => {
    const store = window.__paintToolsStore;
    const plate = window.__plateStore;
    const original = plate.getState().getMesh;
    let release;
    let entered;
    const enteredPromise = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    plate.setState({ getMesh: async (...args) => { entered(); await gate; return original(...args); } });
    try {
      const pending = store.getState().startPainting(objectId);
      await enteredPromise;
      store.getState().stopPainting();
      release();
      await pending;
      const stopped = store.getState();
      const stopSafe = !stopped.isActive && stopped.selectedObjectId === null && stopped.selectedVolumeId === null && !stopped.isLoading && stopped.error === null;
      plate.setState({ getMesh: async () => { store.getState().stopPainting(); throw new Error('Stale mesh failure'); } });
      await store.getState().startPainting(objectId);
      const errorSafe = !store.getState().isActive && store.getState().error === null && !store.getState().isLoading;
      let releaseFirst;
      let calls = 0;
      const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
      plate.setState({ getMesh: async (...args) => { if (++calls === 1) await firstGate; return original(...args); } });
      const first = store.getState().startPainting(objectId, volumes[0]);
      await store.getState().startPainting(objectId, volumes[1]);
      releaseFirst();
      await first;
      const latestWins = store.getState().selectedVolumeId === volumes[1];
      store.getState().stopPainting();
      return { stopSafe, errorSafe, latestWins };
    } finally { plate.setState({ getMesh: original }); }
  }, { objectId, volumes });
  assert.deepEqual(startRaces, { stopSafe: true, errorSafe: true, latestWins: true });
  await page.waitForSelector('#paint-tools-panel', { state: 'detached' });
  await page.click('#tool-paint-btn');
  await page.waitForSelector('#paint-tools-panel');
  await page.click('#paint-tool-triangle');
  await page.uncheck('#triangle-splitting-checkbox');

  // An old support clear and readback cannot overwrite current seam overlay.
  const clearRace = await page.evaluate(async () => {
    const engine = window.__orcaEngine;
    const store = window.__paintToolsStore;
    const original = engine.call;
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const entry = new Promise((resolve) => { entered = resolve; });
    let delayed = false;
    engine.call = async function (op, args) {
      if (op === 'clearPaint' && args.layer === 'support') { delayed = true; entered(); await gate; }
      return original.call(this, op, args);
    };
    try {
      const clear = store.getState().clearCurrentPaint();
      await entry;
      store.getState().setLayer('seam');
      release();
      await clear;
      return { delayed, layer: store.getState().layer, loading: store.getState().isLoading };
    } finally { engine.call = original; }
  });
  assert.deepEqual(clearRace, { delayed: true, layer: 'seam', loading: false });
  const seam = await readPaint(page, 'seam');
  assert.ok(seam.blockers.length > 0, 'Seam annotations survive delayed support clear');
  await waitOverlay(page, seam.enforcers.length + seam.blockers.length);

  // Hold the collector's baseline read, then switch target before it can mutate.
  const points = await visibleFacets(page);
  const point = points.find((p) => !seam.enforcers.includes(p.facet) && !seam.blockers.includes(p.facet));
  assert.ok(point, 'Cancellation needs an unpainted visible facet');
  await page.evaluate(() => {
    const engine = window.__orcaEngine;
    const original = engine.call;
    window.__paintTestOriginalCall = original;
    window.__paintTestEntered = false;
    const gate = new Promise((resolve) => { window.__paintTestRelease = resolve; });
    engine.call = async function (op, args) {
      if (op === 'getPaintData' && !window.__paintTestEntered) { window.__paintTestEntered = true; await gate; }
      return original.call(this, op, args);
    };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__paintTestEntered);
  await page.evaluate(() => window.__paintToolsStore.getState().setLayer('support'));
  await page.mouse.up();
  await page.evaluate(() => { window.__paintTestRelease(); window.__orcaEngine.call = window.__paintTestOriginalCall; });
  // A subsequent completed stroke drains the serialized collector queue.
  await paintPoint(page, point);
  const support = await readPaint(page, 'support');
  assert.deepEqual(support.enforcers, [point.facet], 'Only the explicit new-target stroke is applied');
  assert.deepEqual(await readPaint(page, 'seam'), seam, 'Cancelled pending seam stroke never commits');

  await page.click('#paint-layer-seam');
  const historyBefore = await page.evaluate(() => window.__historyStore.getState().currentSnapshot.id);
  await page.evaluate(() => {
    const engine = window.__orcaEngine;
    window.__paintTestOriginalCall = engine.call;
    window.__paintTestFailed = false;
    engine.call = async function (op, args) {
      if (op === 'paintStroke') { window.__paintTestFailed = true; throw new Error('Simulated paint RPC failure'); }
      return window.__paintTestOriginalCall.call(this, op, args);
    };
  });
  await pointerStroke(page, point, 'enforce');
  await page.waitForFunction(() => window.__paintTestFailed && window.__paintToolsStore.getState().error?.includes('Simulated'));
  await page.evaluate(() => { window.__orcaEngine.call = window.__paintTestOriginalCall; });
  assert.deepEqual(await readPaint(page, 'seam'), seam, 'Failed stroke preserves complete baseline annotations');
  assert.equal(await page.evaluate(() => window.__historyStore.getState().currentSnapshot.id), historyBefore, 'Failed stroke creates no history entry');
  await waitOverlay(page, seam.enforcers.length + seam.blockers.length);
  await page.evaluate(() => window.__plateStore.getState().selectObject(null));
  await page.waitForSelector('#paint-tools-panel', { state: 'detached' });
  assert.equal(await page.evaluate(() => window.__paintToolsStore.getState().isActive), false);
}
