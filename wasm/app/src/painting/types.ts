export type PaintTarget = 'support' | 'seam';
export type SupportPaintMode = 'enforce' | 'block' | 'erase';
export type SupportFacetState = 'none' | 'enforcer' | 'blocker';

export interface FacetAnnotation {
  facetId: number;
  state: SupportFacetState;
  type: number;
}

export interface SupportPaintingData {
  objectId: number;
  volumeId: number;
  triangleCount: number;
  hasCustomSupports?: boolean;
  hasCustomSeam?: boolean;
  hasCustomSeams?: boolean;
  enforcers: number[];
  blockers: number[];
  facets?: FacetAnnotation[];
  statistics?: {
    enforcersCount: number;
    blockersCount: number;
    totalPainted: number;
  };
}

export interface VolumeInfo {
  id: number;
  name: string;
  type: string;
  extruder?: number;
}
