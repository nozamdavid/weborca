/**
 * @file types.ts
 * Types for the OrcaSlicer Web Variable Layer Height & Adaptive Slicing feature.
 */

export interface LayerRange {
  bottom: number;
  top: number;
  height: number;
}

export interface LayerHeightProfileData {
  objectId: number;
  profile: number[];
  minLayerHeight: number;
  maxLayerHeight: number;
  nominalHeight?: number;
  layerHeight: number;
  firstLayerHeight?: number;
  totalHeight?: number;
  objectHeight: number;
  hasCustomProfile: boolean;
  layerCount: number;
  layers: number[];
  ranges?: LayerRange[];
}

export interface ObjectLayersData {
  objectId: number;
  layerCount: number;
  layers: number[];
  ranges?: LayerRange[];
}

export type LayerEditAction = 'increase' | 'decrease' | 'smooth' | 'reduce';

export interface AdjustLayerHeightsParams {
  objectId: number;
  z: number;
  delta?: number;
  strength?: number;
  bandWidth?: number;
  band_width?: number;
  action?: LayerEditAction;
}

export interface SmoothLayerHeightsParams {
  objectId: number;
  radius?: number;
  keepMin?: boolean;
  keep_min?: boolean;
}

export interface AdaptiveLayerHeightsParams {
  objectId: number;
  quality?: number;
  qualityFactor?: number;
}

export interface LayerHeightOperationResult {
  success: boolean;
  objectId: number;
  profile: number[];
  layerCount: number;
  layers: number[];
  ranges?: LayerRange[];
  minLayerHeight?: number;
  maxLayerHeight?: number;
  cleared?: boolean;
}
