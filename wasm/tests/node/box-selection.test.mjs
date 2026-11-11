import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../app/node_modules/three/build/three.module.js';
import { addBoxSelection, boxSelection, selectionRect } from '../../app/src/plate/boxSelection.ts';

test('additive union retains primary and existing instances without toggling duplicates', () => {
  const a = { objectId: 1, instanceId: 0 }, b = { objectId: 1, instanceId: 1 };
  assert.deepEqual(addBoxSelection([a], [a, b, b]), [a, b]);
  assert.deepEqual(addBoxSelection([a], []), [a]);
});

const viewport = { left: 100, top: 70, width: 800, height: 600 };
const rect = selectionRect({ x: 480, y: 350 }, { x: 520, y: 390 });
function mesh(id, instance, x = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  m.position.set(x, 0, z);
  m.userData = { objectId: id, instanceId: instance };
  return m;
}
test('reverse drags normalize in client CSS coordinates independently of DPR', () => {
  assert.deepEqual(selectionRect({ x: 520, y: 390 }, { x: 480, y: 350 }), rect);
  const camera = new THREE.PerspectiveCamera(60, 800 / 600, 1, 100);
  camera.position.z = 10;
  for (const dpr of [1, 2, 3]) {
    globalThis.devicePixelRatio = dpr;
    assert.deepEqual(boxSelection([mesh(1, 0)], camera, viewport, rect), [{ objectId: 1, instanceId: 0 }]);
  }
});
for (const kind of ['perspective', 'orthographic']) test(`${kind}: triangle crossing box, near/far/behind/outside exclusion and instance dedupe`, () => {
  const camera = kind === 'perspective' ? new THREE.PerspectiveCamera(60, 800 / 600, 1, 100) : new THREE.OrthographicCamera(-8, 8, 6, -6, 1, 100);
  camera.position.z = 10;
  const meshes = [mesh(1, 0), mesh(1, 0), mesh(1, 1), mesh(2, 0, 100), mesh(3, 0, 0, 20), mesh(4, 0, 0, -200), mesh(5, 0, 0, 9.5)];
  assert.deepEqual(boxSelection(meshes, camera, viewport, rect), [{ objectId: 1, instanceId: 0 }, { objectId: 1, instanceId: 1 }]);
  assert.deepEqual(boxSelection([mesh(1, 0)], camera, viewport, { left: 100, top: 70, right: 120, bottom: 90 }), []);
});
