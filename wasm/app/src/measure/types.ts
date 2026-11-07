export type SnapMode = 'auto' | 'plane' | 'edge' | 'circle' | 'point';

export interface SurfaceFeaturePoint {
  type: 'point';
  point: [number, number, number];
  raw?: {
    type: number;
    pt1: [number, number, number];
    pt2: [number, number, number];
    pt3?: [number, number, number] | null;
    value: number;
  };
}

export interface SurfaceFeatureEdge {
  type: 'edge';
  edge: {
    start: [number, number, number];
    end: [number, number, number];
    length: number;
  };
  extraPoint?: [number, number, number];
  raw?: {
    type: number;
    pt1: [number, number, number];
    pt2: [number, number, number];
    pt3?: [number, number, number] | null;
    value: number;
  };
}

export interface SurfaceFeatureCircle {
  type: 'circle';
  circle: {
    center: [number, number, number];
    normal: [number, number, number];
    radius: number;
    diameter: number;
  };
  raw?: {
    type: number;
    pt1: [number, number, number];
    pt2: [number, number, number];
    pt3?: [number, number, number] | null;
    value: number;
  };
}

export interface SurfaceFeaturePlane {
  type: 'plane';
  plane: {
    normal: [number, number, number];
    origin: [number, number, number];
    planeIndex: number;
    features?: SurfaceFeature[];
  };
  raw?: {
    type: number;
    pt1: [number, number, number];
    pt2: [number, number, number];
    pt3?: [number, number, number] | null;
    value: number;
  };
}

export type SurfaceFeature =
  | SurfaceFeaturePoint
  | SurfaceFeatureEdge
  | SurfaceFeatureCircle
  | SurfaceFeaturePlane;

export interface DistAndPoints {
  dist: number;
  from: [number, number, number];
  to: [number, number, number];
}

export interface AngleResult {
  rad: number;
  deg: number;
  center: [number, number, number];
  radius: number;
  coplanar: boolean;
  unit: string;
}

export interface MeasurementResult {
  success: boolean;
  error?: string;
  hasAnyData?: boolean;
  distanceStrict?: DistAndPoints | null;
  distanceInfinite?: DistAndPoints | null;
  distance?: number | null;
  distanceType?: 'strict' | 'infinite' | 'diameter' | 'length' | null;
  angle?: AngleResult | null;
  distanceXyz?: [number, number, number] | null;
  delta?: [number, number, number] | null;
  radius?: number;
  diameter?: number;
  length?: number;
  plane?: {
    normal: [number, number, number];
    origin: [number, number, number];
  };
  point?: [number, number, number];
}
