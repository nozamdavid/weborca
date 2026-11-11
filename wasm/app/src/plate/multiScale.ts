import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { PlateInstance, PlateObject, MeshBufferData } from './types';

type Vec3 = [number, number, number];
type Ref = { objectId: number; instanceId: number };
export function selectedScaleInstances(objects: PlateObject[], refs: Ref[]) {
  const seen = new Set<string>();
  return refs.flatMap(ref => {
    const key = `${ref.objectId}:${ref.instanceId}`;
    const instance = objects.find(o => o.id === ref.objectId)?.instances.find(i => i.id === ref.instanceId);
    if (!instance || seen.has(key)) return [];
    seen.add(key);
    return [{ ...ref, instance }];
  });
}

export function scaleBounds(instance: PlateInstance, mesh: MeshBufferData) {
  const matrix = new Matrix4().compose(new Vector3(...instance.offset),
    new Quaternion().setFromEuler(new Euler(...instance.rotation, 'ZYX')),
    new Vector3(...instance.scale.map((s, i) => s * (instance.mirror?.[i] ?? 1)) as Vec3));
  const bounds = new Box3(), point = new Vector3();
  for (let i = 0; i < mesh.positions.length; i += 3) bounds.expandByPoint(point.fromArray(mesh.positions, i).applyMatrix4(matrix));
  return bounds;
}

/** World-axis stretch is representable without shear only when rotated local axes
 * are eigenvectors of the requested stretch. Uniform stretch always qualifies. */
export function localScaleFactors(instance: PlateInstance, factors: Vec3): Vec3 | null {
  const rotation = new Matrix4().makeRotationFromEuler(new Euler(...instance.rotation, 'ZYX'));
  const result: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const v = new Vector3().setFromMatrixColumn(rotation, axis);
    const stretched = v.clone().multiply(new Vector3(...factors));
    const factor = v.dot(stretched);
    if (stretched.addScaledVector(v, -factor).length() > 1e-7) return null;
    result.push(factor);
  }
  return result as Vec3;
}

export async function groupScaleEntries(objects: PlateObject[], refs: Ref[], factors: Vec3,
  getMesh: (id: number) => Promise<MeshBufferData>) {
  if (factors.some(v => !Number.isFinite(v) || v <= 0)) throw Error('Invalid scale');
  const selected = selectedScaleInstances(objects, refs);
  const bounds = new Box3();
  const prepared = await Promise.all(selected.map(async ref => {
    const local = localScaleFactors(ref.instance, factors);
    if (!local) throw Error('Nonuniform world scaling would shear this selection');
    const box = scaleBounds(ref.instance, await getMesh(ref.objectId));
    bounds.union(box);
    return { ...ref, local };
  }));
  if (bounds.isEmpty()) return [];
  const pivot = bounds.getCenter(new Vector3());
  pivot.z = bounds.min.z;
  return prepared.map(({ objectId, instanceId, instance, local }) => ({ objectId, instanceId,
    offset: instance.offset.map((v, i) => pivot.getComponent(i) + (v - pivot.getComponent(i)) * factors[i]) as Vec3,
    scale: instance.scale.map((v, i) => v * local[i]) as Vec3 }));
}
