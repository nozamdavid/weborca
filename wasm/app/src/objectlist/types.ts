export type VolumeType = 'part' | 'negative' | 'modifier' | 'support_blocker' | 'support_enforcer';

export type PrimitiveShape = 'cube' | 'cylinder' | 'sphere' | 'cone' | 'disc' | 'torus' | 'slab';

export interface VolumeTreeNode {
  id: number;
  name: string;
  type: VolumeType;
  extruder: number;
  config: Record<string, string>;
  overrides: string[];
}

export interface LayerRangeTreeNode {
  minZ: number;
  maxZ: number;
  config: Record<string, string>;
  overrides: string[];
}

export interface ObjectTreeNode {
  id: number;
  name: string;
  instances: { id: number }[];
  volumes: VolumeTreeNode[];
  layerRanges: LayerRangeTreeNode[];
  config: Record<string, string>;
  overrides: string[];
}

export interface ObjectTreeData {
  objects: ObjectTreeNode[];
}

export interface AddVolumeParams {
  objectId: number;
  type: VolumeType;
  shape: PrimitiveShape;
  size?: number[] | number;
  offset?: number[];
  name?: string;
}
