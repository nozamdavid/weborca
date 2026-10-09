/**
 * @file repairApi.ts
 * Typed client for mesh health diagnosis and repair operations via engine.call().
 * Mirrors wasm/app/src/layers/layersClient.ts.
 */

import { getEngine } from '../engine/orcaEngine';
import type {
  MeshHealthResult,
  RepairObjectParams,
  RepairObjectResult
} from './types';

/**
 * Queries the mesh topology and manifold health of an object or volume.
 * Pure inspection query; non-mutating.
 */
export async function getMeshHealth(
  objectId: number,
  volumeId?: number,
  volumeIndex?: number
): Promise<MeshHealthResult> {
  const engine = await getEngine();
  const params: Record<string, unknown> = { objectId };
  if (volumeId !== undefined) params.volumeId = volumeId;
  if (volumeIndex !== undefined) params.volumeIndex = volumeIndex;

  if (typeof (engine as any).getMeshHealth === 'function') {
    return (await (engine as any).getMeshHealth(params)) as MeshHealthResult;
  }
  return (await engine.call('getMeshHealth', params)) as MeshHealthResult;
}

/**
 * Performs CGAL-based combinatorial mesh repair on the target object.
 * Preserves model volume transforms, configs, and facet paint annotations.
 * Note: splitParts is explicitly rejected upstream to avoid deleting unrelated volumes.
 */
export async function repairObject(
  params: RepairObjectParams
): Promise<RepairObjectResult> {
  if (params.splitParts === true) {
    throw new Error('splitParts is not supported: upstream split may delete unrelated volumes');
  }
  const engine = await getEngine();
  if (typeof (engine as any).repairObject === 'function') {
    return (await (engine as any).repairObject(params)) as RepairObjectResult;
  }
  return (await engine.call('repairObject', params)) as RepairObjectResult;
}
