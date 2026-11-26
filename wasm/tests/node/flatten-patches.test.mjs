import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../app/node_modules/three/build/three.module.js';
import { createFlattenPatch, hoverFlattenPatch, pickFlattenPatch } from '../../app/src/plate/flattenPatches.ts';

test('dodecahedron candidates are filled inset rounded patches, with occluded rear picking and clear hover', () => {
  const geometry = new THREE.DodecahedronGeometry(10);
  const model = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const positions = geometry.getAttribute('position');
  const faces = new Map();
  for (let i = 0; i < positions.count; i += 3) {
    const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, i + j));
    const normal = triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0])).normalize();
    const key = normal.toArray().map(v => Math.abs(v) < 1e-4 ? '0' : v.toFixed(4)).join(',');
    const face = faces.get(key) ?? { normal, points: [] };
    for (const point of triangle) if (!face.points.some(p => p.distanceTo(point) < 1e-5)) face.points.push(point);
    faces.set(key, face);
  }
  assert.equal(faces.size, 12);
  const group = new THREE.Group();
  for (const { normal, points } of faces.values()) {
    const center = points.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
    const u = points[0].clone().sub(center).normalize(), v = normal.clone().cross(u);
    points.sort((a, b) => Math.atan2(a.clone().sub(center).dot(v), a.clone().sub(center).dot(u)) - Math.atan2(b.clone().sub(center).dot(v), b.clone().sub(center).dot(u)));
    const patch = createFlattenPatch(points.map(p => p.toArray()), new THREE.Matrix4());
    patch.userData.clusterIndex = group.children.length;
    group.add(patch);
    assert.equal(patch.isMesh, true);
    assert.ok(patch.geometry.getAttribute('position').count > 100);
    assert.equal(patch.material.depthTest, true);
    const p = patch.geometry.getAttribute('position');
    const radius = points[0].distanceTo(center);
    for (let i = 0; i < p.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(p, i);
      assert.ok(point.distanceTo(center) < radius * 0.91, 'inset stays away from object edges');
      assert.ok(Math.abs(point.clone().sub(center).dot(normal)) < 1e-5, 'patch lies on the original face');
    }
  }
  const face = [...faces.values()][0];
  const center = face.points.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / 5);
  const ray = new THREE.Raycaster(center.clone().addScaledVector(face.normal, 20), face.normal.clone().negate());
  assert.equal(pickFlattenPatch(ray, group, model), 0);
  const rearOnly = new THREE.Group();
  for (const patch of [...group.children].slice(1)) rearOnly.add(patch);
  assert.equal(pickFlattenPatch(ray, rearOnly, model), null, 'rear patches cannot be picked through model');
  hoverFlattenPatch(group, 0);
  assert.equal(group.children[0].material.opacity, 0.75);
  hoverFlattenPatch(group, null);
  assert.equal(group.children[0].material.opacity, 0.5);
});
