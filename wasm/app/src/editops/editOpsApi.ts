/**
 * @file editOpsApi.ts
 * Engine client wrappers for object-editing operations.
 */

import { getEngine } from '../engine/orcaEngine';
import type {
  AutoOrientResult,
  GetPlanarFacetsResult,
  PlaceOnFaceParams,
  PlaceOnFaceResult,
  SplitObjectResult,
  SplitVolumeResult,
  SimplifyVolumeParams,
  SimplifyVolumeResult,
  MeshBooleanParams,
  MeshBooleanResult,
  AddSvgParams,
  AddSvgResult,
  UpdateSvgParams,
  GetSvgResult,
  SetBrimEarsParams,
  GetBrimEarsResult
} from './types';

export async function autoOrient(objectIds: number[]): Promise<AutoOrientResult> {
  const engine = await getEngine();
  return (await engine.call('autoOrient', { objectIds })) as AutoOrientResult;
}

export async function getPlanarFacets(objectId: number, instanceId?: number | null): Promise<GetPlanarFacetsResult> {
  const engine = await getEngine();
  const params: Record<string, unknown> = { objectId };
  if (typeof instanceId === 'number') params.instanceId = instanceId;
  return (await engine.call('getPlanarFacets', params)) as GetPlanarFacetsResult;
}

export async function placeOnFace(params: PlaceOnFaceParams): Promise<PlaceOnFaceResult> {
  const engine = await getEngine();
  const p: Record<string, unknown> = {
    objectId: params.objectId,
    facetIndex: params.facetIndex
  };
  if (typeof params.instanceId === 'number') p.instanceId = params.instanceId;
  return (await engine.call('placeOnFace', p)) as PlaceOnFaceResult;
}

export async function splitObject(objectId: number): Promise<SplitObjectResult> {
  const engine = await getEngine();
  return (await engine.call('splitObject', { objectId })) as SplitObjectResult;
}

export async function splitVolume(objectId: number, volumeId: number): Promise<SplitVolumeResult> {
  const engine = await getEngine();
  return (await engine.call('splitVolume', { objectId, volumeId })) as SplitVolumeResult;
}

export async function simplifyVolume(params: SimplifyVolumeParams): Promise<SimplifyVolumeResult> {
  const engine = await getEngine();
  const p: Record<string, unknown> = {
    objectId: params.objectId,
    volumeId: params.volumeId
  };
  if (params.targetTriangleCount != null) p.targetTriangleCount = params.targetTriangleCount;
  if (params.ratio != null) p.ratio = params.ratio;
  if (params.maxError != null) p.maxError = params.maxError;
  if (params.keepPainting !== undefined) p.keepPainting = params.keepPainting;
  return (await engine.call('simplifyVolume', p)) as SimplifyVolumeResult;
}

export async function meshBoolean(params: MeshBooleanParams): Promise<MeshBooleanResult> {
  const engine = await getEngine();
  const p: Record<string, unknown> = {
    mode: params.mode,
    targetObjectId: params.targetObjectId,
    toolObjectIds: params.toolObjectIds
  };
  if (params.keepTools !== undefined) p.keepTools = params.keepTools;
  return (await engine.call('meshBoolean', p)) as MeshBooleanResult;
}

export async function addSvg(params: AddSvgParams): Promise<AddSvgResult> {
  const engine = await getEngine();
  const p: Record<string, unknown> = { svgText: params.svgText };
  if (params.depth != null) p.depth = params.depth;
  if (params.useSurface != null) p.useSurface = params.useSurface;
  if (params.volumeType != null) p.volumeType = params.volumeType;
  if (params.objectId != null) p.objectId = params.objectId;
  if (params.position != null) p.position = params.position;
  if (params.name != null) p.name = params.name;
  return (await engine.call('addSvg', p)) as AddSvgResult;
}

export async function updateSvg(params: UpdateSvgParams): Promise<AddSvgResult> {
  const engine = await getEngine();
  const p: Record<string, unknown> = {
    objectId: params.objectId,
    volumeId: params.volumeId
  };
  if (params.svgText != null) p.svgText = params.svgText;
  if (params.depth != null) p.depth = params.depth;
  if (params.useSurface != null) p.useSurface = params.useSurface;
  if (params.name != null) p.name = params.name;
  return (await engine.call('updateSvg', p)) as AddSvgResult;
}

export async function getSvg(objectId: number, volumeId: number): Promise<GetSvgResult> {
  const engine = await getEngine();
  return (await engine.call('getSvg', { objectId, volumeId })) as GetSvgResult;
}

export async function setBrimEars(params: SetBrimEarsParams): Promise<{ success: boolean; error?: string }> {
  const engine = await getEngine();
  return (await engine.call('setBrimEars', {
    objectId: params.objectId,
    points: params.points
  })) as { success: boolean; error?: string };
}

export async function getBrimEars(objectId: number): Promise<GetBrimEarsResult> {
  const engine = await getEngine();
  return (await engine.call('getBrimEars', { objectId })) as GetBrimEarsResult;
}

export async function clearBrimEars(objectId: number): Promise<{ success: boolean; error?: string }> {
  const engine = await getEngine();
  return (await engine.call('clearBrimEars', { objectId })) as { success: boolean; error?: string };
}
