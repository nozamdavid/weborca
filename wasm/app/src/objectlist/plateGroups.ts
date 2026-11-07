import type { ObjectTreeNode } from './types';

interface PlateLike { index: number; instances: Array<{ objectId: number; instanceId: number }> }
interface ObjectLike { id: number; instances: Array<{ id: number }> }

/** Each group holds its actual instances, including partially unassigned objects. */
export function instancesInGroup(objects: ObjectLike[], plates: PlateLike[], plateIndex: number | null): Map<number, number[]> {
  const result = new Map<number, number[]>();
  const assigned = new Set(plates.flatMap((p) => p.instances.map((i) => i.instanceId)));
  for (const object of objects) {
    const ids = plateIndex === null
      ? object.instances.filter((i) => !assigned.has(i.id)).map((i) => i.id)
      : (plates.find((p) => p.index === plateIndex)?.instances ?? []).filter((i) => i.objectId === object.id).map((i) => i.instanceId);
    if (ids.length) result.set(object.id, ids);
  }
  return result;
}

/** Move beside the group neighbour in the one global order; all memberships remain visible. */
export function stepTargetIndex(objects: ObjectTreeNode[], groupIds: number[], objectId: number, step: -1 | 1): number | null {
  const ids = objects.filter((o) => groupIds.includes(o.id)).map((o) => o.id);
  const neighbour = ids[ids.indexOf(objectId) + step];
  if (neighbour === undefined || !ids.includes(objectId)) return null;
  const order = objects.map((o) => o.id).filter((id) => id !== objectId);
  return order.indexOf(neighbour) + (step === 1 ? 1 : 0);
}
