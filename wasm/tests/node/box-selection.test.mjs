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

for (const kind of ['perspective', 'orthographic']) test(`${kind}: dense rectangle miss reads no triangle vertices`, () => {
  const camera = kind === 'perspective' ? new THREE.PerspectiveCamera(60, 800 / 600, 1, 100) : new THREE.OrthographicCamera(-8,8,6,-6,1,100);
  camera.position.z = 10;
  const dense = new THREE.Mesh(new THREE.PlaneGeometry(1,1,200,200));
  dense.position.x = 3;
  dense.userData = { objectId:1, instanceId:0 };
  dense.geometry.computeBoundingSphere();
  const position = dense.geometry.getAttribute('position');
  let reads = 0;
  const getX = position.getX.bind(position);
  position.getX = index => { reads++; return getX(index); };
  const started = performance.now();
  assert.deepEqual(boxSelection([dense],camera,viewport,{left:200,top:350,right:205,bottom:355}),[]);
  assert.equal(reads,0,'bounded frustum rejects the mesh before its 80,000 triangles');
  assert.deepEqual(boxSelection([dense],camera,viewport,{left:500,top:350,right:500,bottom:390}),[]);
  console.log(JSON.stringify({ camera:kind, triangles:80000, vertexReads:reads, elapsedMs:performance.now()-started }));
});
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
