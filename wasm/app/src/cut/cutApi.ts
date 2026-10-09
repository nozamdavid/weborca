/**
 * @file cutApi.ts
 * Typed client module for Planar Cutting and Cut-Connectors engine operations.
 * Communicates with the OrcaSlicer WebAssembly engine via engine.call().
 */

import { getEngine } from '../engine/orcaEngine';
import type {
  CutObjectParams,
  CutWithConnectorsParams,
  CutResult
} from './types';

async function ensureInstanceOnBed(engine: any, objectId: number): Promise<void> {
  try {
    const store = typeof window !== 'undefined' ? (window as any).__plateStore?.getState() : null;
    const instId = store?.objects.find((o: any) => o.id === objectId)?.instances?.[0]?.id;
    if (instId != null) {
      if (typeof engine.setInstanceTransform === 'function') {
        await engine.setInstanceTransform({ objectId, instanceId: instId });
      } else {
        await engine.call('setInstanceTransform', { objectId, instanceId: instId });
      }
    }
  } catch (_) {}
}

/**
 * Cuts an object along a planar surface without connectors.
 */
export async function cutObject(params: CutObjectParams): Promise<CutResult> {
  const engine = await getEngine();
  await ensureInstanceOnBed(engine, params.objectId);
  if (typeof (engine as any).cutObject === 'function') {
    const res = await (engine as any).cutObject(params);
    return {
      fitValidated: false,
      ...res
    } as CutResult;
  }
  const res = await engine.call('cutObject', params);
  return {
    fitValidated: false,
    ...res
  } as CutResult;
}

/**
 * Cuts an object along a planar surface embedding procedural connectors
 * (plugs, dowels, or snaps) into the resulting halves.
 */
export async function cutObjectWithConnectors(
  params: CutWithConnectorsParams
): Promise<CutResult> {
  const engine = await getEngine();
  await ensureInstanceOnBed(engine, params.objectId);
  if (typeof (engine as any).cutObjectWithConnectors === 'function') {
    const res = await (engine as any).cutObjectWithConnectors(params);
    return {
      fitValidated: false,
      ...res
    } as CutResult;
  }
  const res = await engine.call('cutObjectWithConnectors', params);
  return {
    fitValidated: false,
    ...res
  } as CutResult;
}
