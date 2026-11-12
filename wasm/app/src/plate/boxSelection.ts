import * as THREE from 'three';

export function addBoxSelection(current: { objectId: number; instanceId: number }[], hits: { objectId: number; instanceId: number }[]) {
  return [...new Map([...current, ...hits].map(ref => [`${ref.objectId}_${ref.instanceId}`, ref])).values()];
}

export function selectionRect(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

/** Clip actual triangles against the rectangle's bounded camera frustum. CSS pixels only. */
export function boxSelection(meshes: THREE.Mesh[], camera: THREE.Camera, viewport: { left: number; top: number; width: number; height: number }, rect: ReturnType<typeof selectionRect>) {
  if (viewport.width <= 0 || viewport.height <= 0) return [];
  camera.updateMatrixWorld();
  const l = Math.max(-1, (rect.left - viewport.left) / viewport.width * 2 - 1);
  const r = Math.min(1, (rect.right - viewport.left) / viewport.width * 2 - 1);
  const t = Math.min(1, 1 - (rect.top - viewport.top) / viewport.height * 2);
  const b = Math.max(-1, 1 - (rect.bottom - viewport.top) / viewport.height * 2);
  if (l >= r || b >= t) return [];
  const found = new Map<string, { objectId: number; instanceId: number }>();
  // The rectangle shrinks the projection's NDC cube; map it back to the full NDC cube so the
  // frustum extracted from rectProjection is exactly the rectangle's bounded camera frustum,
  // letting bounding-sphere rejection run against rect space before exact triangle clipping.
  const fullProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const hx = (r - l) / 2, cx = (r + l) / 2, hy = (t - b) / 2, cy = (t + b) / 2;
  const rectProjection = new THREE.Matrix4(
    1 / hx, 0, 0, -cx / hx,
    0, 1 / hy, 0, -cy / hy,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ).multiply(fullProjection);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(rectProjection);
  const planes = [(p: THREE.Vector4) => p.x - l * p.w, (p: THREE.Vector4) => r * p.w - p.x,
    (p: THREE.Vector4) => p.y - b * p.w, (p: THREE.Vector4) => t * p.w - p.y,
    (p: THREE.Vector4) => p.z + p.w, (p: THREE.Vector4) => p.w - p.z];
  for (const mesh of meshes) {
    const { objectId, instanceId } = mesh.userData;
    const key = `${objectId}_${instanceId}`;
    if (found.has(key)) continue;
    mesh.updateWorldMatrix(true, false);
    if (!frustum.intersectsObject(mesh)) continue;
    const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.index;
    if (!pos) continue;
    for (let i = 0; i + 2 < (index?.count ?? pos.count); i += 3) {
      let polygon = [0, 1, 2].map(j => {
        const k = index ? index.getX(i + j) : i + j;
        return new THREE.Vector4(pos.getX(k), pos.getY(k), pos.getZ(k), 1).applyMatrix4(matrix);
      });
      for (const distance of planes) {
        const clipped: THREE.Vector4[] = [];
        for (let j = 0; j < polygon.length; j++) {
          const a = polygon[j], c = polygon[(j + 1) % polygon.length];
          const da = distance(a), dc = distance(c);
          if (da >= 0) clipped.push(a);
          if ((da >= 0) !== (dc >= 0)) clipped.push(a.clone().lerp(c, da / (da - dc)));
        }
        polygon = clipped;
        if (!polygon.length) break;
      }
      if (polygon.length) { found.set(key, { objectId, instanceId }); break; }
    }
  }
  return [...found.values()];
}
