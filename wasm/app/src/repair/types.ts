/**
 * @file types.ts
 * Types for OrcaSlicer Web mesh health diagnostics and local CGAL repair operations.
 */

export interface MeshVolumeHealth {
  volumeId: number;
  volumeIndex: number;
  name: string;
  isManifold: boolean;
  openEdges: number;
  facetsCount: number;
  numberOfParts: number;
  degenerateFacets: number;
  facetsReversed: number;
  edgesFixed: number;
  facetsRemoved: number;
  backwardsEdges?: number;
  volume: number;
  boundingBox?: [number, number, number, number, number, number];
}

export interface MeshHealthResult {
  success: boolean;
  objectId: number;
  isManifold: boolean;
  openEdges: number;
  facetsCount: number;
  numberOfParts: number;
  degenerateFacets: number;
  facetsReversed: number;
  edgesFixed: number;
  facetsRemoved: number;
  backwardsEdges?: number;
  volume: number;
  boundingBox?: [number, number, number, number, number, number];
  volumes: MeshVolumeHealth[];
  error?: string;
}

export interface RepairObjectParams {
  objectId: number;
  id?: number;
  volumeId?: number;
  volumeIndex?: number;
  keepPainting?: boolean;
  splitParts?: boolean;
}

export interface RepairObjectResult {
  success: boolean;
  wasRepaired: boolean;
  objectId: number;
  isManifold?: boolean;
  openEdgesBefore?: number;
  openEdgesAfter?: number;
  degenerateFacetsBefore?: number;
  degenerateFacetsAfter?: number;
  degenerateFacetsFixed?: number;
  edgesFixed?: number;
  facetsRemoved?: number;
  facetsReversed?: number;
  facetsBefore?: number;
  facetsAfter?: number;
  volumeBefore?: number;
  volumeAfter?: number;
  numberOfPartsBefore?: number;
  numberOfPartsAfter?: number;
  volumes?: MeshVolumeHealth[];
  error?: string;
}
