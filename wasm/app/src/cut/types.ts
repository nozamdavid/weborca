/**
 * @file types.ts
 * Type definitions for planar cut and cut-connectors operations in OrcaSlicer WASM.
 */

export type CutConnectorType = 'plug' | 'dowel' | 'snap';
export type CutConnectorStyle = 'prism' | 'frustum';
export type CutConnectorShape = 'triangle' | 'square' | 'hexagon' | 'circle';
export type KeepMode = 'both' | 'upper' | 'lower';
export type CoordinateSystem = 'world' | 'object';

export interface CutPlane {
  point: [number, number, number];
  normal: [number, number, number];
}

export interface CutConnectorAttrs {
  type?: CutConnectorType;
  style?: CutConnectorStyle;
  shape?: CutConnectorShape;
  depthRatio?: number;
  depth?: number;
  height?: number;
  size?: number;
  diameter?: number;
  radius?: number;
  rotationDeg?: number;
  rotation?: number;
  angle?: number;
  tolerance?: number;
  radiusTolerance?: number;
  heightTolerance?: number;
  targetHalf?: 'upper' | 'lower';
  plugHalf?: 'upper' | 'lower';
}

export interface CutConnectorDef {
  id?: string;
  pos: [number, number, number];
  attrs?: CutConnectorAttrs;
}

export interface CutObjectParams {
  objectId: number;
  id?: number;
  instanceIndex?: number;
  instanceId?: number;
  z?: number;
  plane?: CutPlane;
  coordinateSystem?: CoordinateSystem;
  keepUpper?: boolean;
  keepLower?: boolean;
  keepMode?: KeepMode;
  keepAsParts?: boolean;
  flipUpper?: boolean;
  flipLower?: boolean;
  placeOnCutUpper?: boolean;
  placeOnCutLower?: boolean;
  keepPaint?: boolean;
}

export interface CutWithConnectorsParams extends CutObjectParams {
  connectors?: CutConnectorDef[];
}

export interface CreatedVolumeInfo {
  id: number;
  name: string;
  type?: string;
  volume: number;
  openEdges: number;
  scalingFactor?: [number, number, number];
  offset?: [number, number, number];
  boundingBox?: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

export interface CreatedObjectInfo {
  id: number;
  name: string;
  part: 'upper' | 'lower' | 'parts' | 'dowel' | string;
  volume: number;
  volumeIsBooleanResult: false;
  openEdges: number;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  volumes: CreatedVolumeInfo[];
}

export interface CutResult {
  success: boolean;
  objectId?: number;
  connectorCount?: number;
  fitValidated: false;
  createdObjects?: CreatedObjectInfo[];
  error?: string;
}
