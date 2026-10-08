export interface PlateInstanceRef {
  objectId: number;
  instanceId: number;
  objectIndex?: number;
  instanceIndex?: number;
}

export interface PlateInfo {
  index: number;
  name: string;
  locked: boolean;
  origin: [number, number, number];
  size: [number, number, number];
  instances: PlateInstanceRef[];
  config: Record<string, string>;
  filamentMaps?: number[];
}

export interface AddPlateOptions {
  name?: string;
  config?: Record<string, string>;
}

export interface DeletePlateOptions {
  plateIndex: number;
  deleteObjects?: boolean;
}

export interface SetPlateConfigOptions {
  plateIndex: number;
  name?: string;
  locked?: boolean;
  config?: Record<string, string>;
}
