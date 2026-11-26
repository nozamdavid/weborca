import * as THREE from 'three';

/** Convex face outline in mesh coordinates, as returned by getPlanarFacets. */
export function createFlattenPatch(outline: Array<[number, number, number]>, matrix: THREE.Matrix4): THREE.Mesh {
  const polygon = outline.map(p => new THREE.Vector3(...p).applyMatrix4(matrix));
  const center = polygon.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / polygon.length);
  polygon.forEach(p => p.lerp(center, 0.1));
  // Match GLGizmoFlatten's ten iterations of corner rounding.
  const k = 10, n = polygon.length;
  const points = Array.from({ length: 2 * k * n }, () => new THREE.Vector3());
  const neighbours = polygon.map((p, j) => {
    points[j * 2 * k].copy(p);
    return [(j * 2 * k - k + points.length) % points.length, j * 2 * k + k];
  });
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < n; j++) {
      if (i === 0) points[j * 2 * k + k].copy(points[j * 2 * k]).lerp(points[(j + 1) % n * 2 * k], 0.5);
      else {
        const r = 0.2 + 0.3 / (k - 1) * i;
        const [a, b] = neighbours[j];
        points[a].copy(points[a - 1]).lerp(points[j * 2 * k], r);
        points[b].copy(points[b + 1]).lerp(points[j * 2 * k], r);
      }
    }
    for (let j = 0; j < n; j++) {
      const [a, b] = neighbours[j];
      points[2 * k * j].multiplyScalar(0.8).addScaledVector(points[a], 0.1).addScaledVector(points[b], 0.1);
      neighbours[j][0]++; neighbours[j][1]--;
    }
  }
  const vertices: number[] = [];
  for (let i = 0; i < points.length; i++) vertices.push(...center.toArray(), ...points[i].toArray(), ...points[(i + 1) % points.length].toArray());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  // Keep model depth for rear-face occlusion; bias the coplanar patch to avoid flicker.
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0xf5eded, side: THREE.DoubleSide, depthTest: true, depthWrite: true,
    transparent: true, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
}

export function pickFlattenPatch(ray: THREE.Raycaster, patches: THREE.Group, model: THREE.Mesh): number | null {
  patches.updateMatrixWorld(true);
  model.updateWorldMatrix(true, false);
  const hit = ray.intersectObjects(patches.children, false)[0];
  if (!hit) return null;
  const surface = ray.intersectObject(model, false)[0];
  if (surface && surface.distance < hit.distance - 0.001) return null;
  return hit.object.userData.clusterIndex as number;
}

export function hoverFlattenPatch(group: THREE.Group, index: number | null): void {
  for (const child of group.children) {
    const material = (child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material;
    const hover = child.userData.clusterIndex === index;
    material.color.setHex(hover ? 0xffffff : 0xf5eded);
    material.opacity = hover ? 0.75 : 0.5;
  }
}
