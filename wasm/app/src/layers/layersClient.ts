/**
 * @file layersClient.ts
 * Typed client for variable layer height operations using engine.call().
 */

import { getEngine } from '../engine/orcaEngine';
import type {
  LayerHeightProfileData,
  ObjectLayersData,
  LayerHeightOperationResult,
  AdjustLayerHeightsParams,
  SmoothLayerHeightsParams,
  AdaptiveLayerHeightsParams
} from './types';

export async function getLayerHeightProfile(objectId: number): Promise<LayerHeightProfileData> {
  const engine = await getEngine();
  return (await engine.call('getLayerHeightProfile', { objectId })) as LayerHeightProfileData;
}

export async function setLayerHeightProfile(
  objectId: number,
  profile: number[]
): Promise<LayerHeightOperationResult> {
  const engine = await getEngine();
  return (await engine.call('setLayerHeightProfile', { objectId, profile })) as LayerHeightOperationResult;
}

export async function adaptiveLayerHeights(
  params: AdaptiveLayerHeightsParams
): Promise<LayerHeightOperationResult> {
  const engine = await getEngine();
  return (await engine.call('adaptiveLayerHeights', params)) as LayerHeightOperationResult;
}

export async function smoothLayerHeights(
  params: SmoothLayerHeightsParams
): Promise<LayerHeightOperationResult> {
  const engine = await getEngine();
  return (await engine.call('smoothLayerHeights', params)) as LayerHeightOperationResult;
}

export async function adjustLayerHeights(
  params: AdjustLayerHeightsParams
): Promise<LayerHeightOperationResult> {
  const engine = await getEngine();
  return (await engine.call('adjustLayerHeights', params)) as LayerHeightOperationResult;
}

export async function resetLayerHeights(objectId: number): Promise<LayerHeightOperationResult> {
  const engine = await getEngine();
  return (await engine.call('resetLayerHeights', { objectId })) as LayerHeightOperationResult;
}

export async function getObjectLayers(objectId: number): Promise<ObjectLayersData> {
  const engine = await getEngine();
  return (await engine.call('getObjectLayers', { objectId })) as ObjectLayersData;
}
