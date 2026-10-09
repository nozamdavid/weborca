/**
 * @file types.ts
 * Types for OrcaSlicer Web advanced painting tools (brushes, fills, color and fuzzy skin).
 */

export type PaintLayer = 'support' | 'seam' | 'color' | 'fuzzy';

export type PaintTool =
  | 'circle'
  | 'sphere'
  | 'smart_fill'
  | 'bucket'
  | 'triangle'
  | 'height_range';

export type PaintState = string | number;

export interface PaintStrokePoint {
  hit: [number, number, number];
  facet: number;
}

export interface ClippingPlane {
  normal: [number, number, number];
  offset: number;
}

export interface PaintStrokeParams {
  objectId: number;
  instanceId: number;
  volumeId: number;
  layer: PaintLayer;
  tool: PaintTool;
  state: PaintState;
  radius: number;
  cameraPos: [number, number, number];
  points: PaintStrokePoint[];
  triangleSplitting?: boolean;
  overhangAngleDeg?: number;
  smartFillAngleDeg?: number;
  bucketPropagate?: boolean;
  clippingPlane?: ClippingPlane | null;
}

export interface PaintStrokeResult {
  changed: boolean;
  stats?: Record<string, number>;
}

export interface PaintOverlayState {
  state: string | number;
  firstTriangle: number;
  triangleCount: number;
}

export interface GetPaintOverlayParams {
  objectId: number;
  volumeId: number;
  layer: PaintLayer;
}

export interface GetPaintOverlayResult {
  path?: string;
  buffer?: ArrayBuffer | Uint8Array;
  states: PaintOverlayState[];
}

export interface ParsedPaintOverlay {
  vertexCount: number;
  triangleCount: number;
  positions: Float32Array;
  indices: Uint32Array;
  states: PaintOverlayState[];
}

export interface GetPaintDataParams {
  objectId: number;
  volumeId: number;
  layer: PaintLayer;
}

export interface GetPaintDataResult {
  data: string; // base64 serialized TriangleSplittingData
}

export interface SetPaintDataParams {
  objectId: number;
  volumeId: number;
  layer: PaintLayer;
  data: string;
}

export interface SetPaintDataResult {
  ok?: boolean;
}

export interface ClearPaintParams {
  objectId: number;
  volumeId: number;
  layer: PaintLayer;
  state?: PaintState;
}

export interface ClearPaintResult {
  ok?: boolean;
}

export interface StrokeSnapshot {
  objectId: number;
  volumeId: number;
  layer: PaintLayer;
  before: string;
  after: string;
}

export type OnStrokeCompleteHook = (snapshot: StrokeSnapshot) => void | Promise<void>;
