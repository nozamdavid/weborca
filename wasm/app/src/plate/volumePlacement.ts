import * as THREE from 'three';
import { usePlateStore } from './plateStore';
import { usePlatesStore } from '../plates/platesStore';
import { getEngine } from '../engine/orcaEngine';
import type { PlateInstance, ViewerVolume } from './types';

const matrix = (transform: PlateInstance) => new THREE.Matrix4().compose(
  new THREE.Vector3(...transform.offset),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation, 'ZYX')),
  new THREE.Vector3(...transform.scale.map((s, i) => s * (transform.mirror?.[i] ?? 1)) as [number, number, number]),
);
const bounds = (volume: ViewerVolume) => volume.localBounds ? new THREE.Box3(
  new THREE.Vector3(...volume.localBounds.min), new THREE.Vector3(...volume.localBounds.max),
) : new THREE.Box3();

/** Front is -Y and right is +X, matching the bed labels and front camera. */
export async function placeAddedVolume(objectId: number, volumeId: number): Promise<void> {
  const store = usePlateStore.getState();
  const plates = usePlatesStore.getState();
  const plate = plates.plates.find(p => p.index === plates.activePlateIndex);
  const origin = plate?.origin ?? [0, 0, 0];
  const object = store.objects.find(o => o.id === objectId);
  const instance = object?.instances.find(i => i.id === store.selectedInstanceId) ?? object?.instances[0];
  if (!instance) return;
  const engine = await getEngine();
  const volume = await engine.call('getVolume', { objectId, volumeId }) as ViewerVolume;
  if (!volume.localBounds) return;
  const parent = matrix(instance);
  const worldBounds = bounds(volume).applyMatrix4(parent.clone().multiply(matrix(volume)));
  const size = worldBounds.getSize(new THREE.Vector3());
  const polygon = store.bedConfig.points.map(([x, y]) => [x + origin[0], y + origin[1]]);
  const minX = Math.min(...polygon.map(p => p[0])), maxX = Math.max(...polygon.map(p => p[0]));
  const minY = Math.min(...polygon.map(p => p[1])), maxY = Math.max(...polygon.map(p => p[1]));
  const inside = (x: number, y: number) => {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  };
  const occupied: THREE.Box3[] = [];
  const tree = await engine.call('getObjectTree', {});
  for (const obj of store.objects) {
    const parts: ViewerVolume[] = [];
    for (const item of tree.objects.find((node: any) => node.id === obj.id)?.volumes ?? []) {
      parts.push(await engine.call('getVolume', { objectId: obj.id, volumeId: item.id }));
    }
    for (const inst of obj.instances) for (const part of parts) {
      if (obj.id === objectId && part.volumeId === volumeId) continue;
      occupied.push(bounds(part).applyMatrix4(matrix(inst).multiply(matrix(part))));
    }
  }
  const margin = 5;
  let fallback: THREE.Vector3 | null = null;
  let anchor: THREE.Vector3 | null = null;
  // Search in rows from the front-right corner, keeping the full transformed footprint on the bed.
  for (let y = minY + margin; y + size.y <= maxY - margin && !anchor; y += Math.max(5, size.y + margin)) {
    for (let x = maxX - margin - size.x; x >= minX + margin; x -= Math.max(5, size.x + margin)) {
      const corners = [[x - margin, y - margin], [x + size.x + margin, y - margin], [x + size.x + margin, y + size.y + margin], [x - margin, y + size.y + margin]];
      if (!corners.every(([cx, cy]) => inside(cx + 1e-6, cy + 1e-6))) continue;
      // A concave boundary crossing the footprint also makes the candidate invalid.
      if (polygon.some(([px, py]) => px > x - margin && px < x + size.x + margin && py > y - margin && py < y + size.y + margin)) continue;
      const candidate = new THREE.Vector3(x, y, origin[2]);
      fallback ??= candidate;
      const box = new THREE.Box3(candidate.clone(), candidate.clone().add(size)).expandByScalar(margin / 2);
      if (!occupied.some(other => box.intersectsBox(other))) { anchor = candidate; break; }
    }
  }
  anchor ??= fallback;
  if (!anchor) return; // An oversized part retains its real dimensions.
  const delta = anchor.sub(worldBounds.min).applyMatrix3(new THREE.Matrix3().setFromMatrix4(parent).invert());
  const offset = new THREE.Vector3(...volume.offset).add(delta).toArray();
  await engine.call('setVolumeTransform', { objectId, volumeId, offset });
}
