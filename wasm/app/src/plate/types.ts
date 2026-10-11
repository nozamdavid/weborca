export interface PlateInstance {
  id: number;
  offset: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  /** -1 on an axis the instance is mirrored along, with the rotation and scale above. */
  mirror?: [number, number, number];
}

export interface PlateObject {
  id: number;
  name: string;
  volumes: number;
  instances: PlateInstance[];
  size: [number, number, number];
}

export interface MeshVolumePartition {
  volumeId: number;
  firstFacet: number;
  facetCount: number;
}

export interface MeshBufferData {
  vertexCount: number;
  triangleCount: number;
  positions: Float32Array;
  indices: Uint32Array;
  volumes?: MeshVolumePartition[];
}

export interface BedConfig {
  points: [number, number][];
  width: number;
  depth: number;
  height: number;
  center: [number, number];
}

export type GizmoMode = 'translate' | 'rotate' | 'scale' | null;
