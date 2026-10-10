/**
 * @file types.ts
 * Type definitions for object-editing operations ported from desktop OrcaSlicer.
 */

export interface AutoOrientRotation {
  objectId: number;
  instanceId: number;
  matrix: number[][];
}

export interface AutoOrientResult {
  success: boolean;
  rotations: AutoOrientRotation[];
  error?: string;
}

export interface PlanarFacetCluster {
  normal: [number, number, number];
  center: [number, number, number];
  area: number;
  outline: Array<[number, number, number]>;
}

export interface GetPlanarFacetsResult {
  success: boolean;
  clusters: PlanarFacetCluster[];
  error?: string;
}

export interface PlaceOnFaceParams {
  objectId: number;
  facetIndex: number;
  instanceId?: number;
}

export interface PlaceOnFaceResult {
  success: boolean;
  error?: string;
}

export interface SplitObjectResult {
  success: boolean;
  newObjectIds?: number[];
  error?: string;
}

export interface SplitVolumeResult {
  success: boolean;
  newVolumeIds?: number[];
  error?: string;
}

export interface SimplifyVolumeParams {
  objectId: number;
  volumeId: number;
  targetTriangleCount?: number;
  ratio?: number;
  maxError?: number;
  keepPainting?: boolean;
}

export interface SimplifyVolumeResult {
  success: boolean;
  triangleCountBefore?: number;
  triangleCountAfter?: number;
  maxError?: number;
  error?: string;
}

export type MeshBooleanMode = 'union' | 'difference' | 'intersection';

export interface MeshBooleanParams {
  mode: MeshBooleanMode;
  targetObjectId: number;
  toolObjectIds: number[];
  keepTools?: boolean;
}

export interface MeshBooleanResult {
  success: boolean;
  objectId?: number;
  volumeId?: number;
  error?: string;
}

export interface AddSvgParams {
  svgText: string;
  depth?: number;
  useSurface?: boolean;
  volumeType?: string;
  objectId?: number;
  position?: [number, number, number];
  name?: string;
}

export interface AddSvgResult {
  success?: boolean;
  objectId?: number;
  volumeId?: number;
  error?: string;
}

export interface UpdateSvgParams {
  objectId: number;
  volumeId: number;
  svgText?: string;
  depth?: number;
  useSurface?: boolean;
  name?: string;
}

export interface GetSvgResult {
  success?: boolean;
  svgText: string;
  depth: number;
  useSurface: boolean;
  error?: string;
}

export interface BrimEarPoint {
  position: [number, number, number];
  radius: number;
}

export interface SetBrimEarsParams {
  objectId: number;
  points: BrimEarPoint[];
}

export interface GetBrimEarsResult {
  objectId: number;
  points: BrimEarPoint[];
  error?: string;
}
