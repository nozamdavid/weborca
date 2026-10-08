/**
 * Type declarations for OrcaSlicer WebAssembly page API.
 */

export interface CreateEngineOptions {
  workerUrl?: string;
  moduleUrl?: string;
  profilesUrl?: string;
  threads?: number;
}

export interface VendorSummary {
  name: string;
  printers: number;
  processes: number;
  filaments: number;
}

export interface LoadVendorsResult {
  vendors: VendorSummary[];
}

export interface PresetItem {
  name: string;
  vendor: string;
  isSystem: boolean;
  isCompatible: boolean;
  inherits: string;
}

export interface ListPresetsOptions {
  compatibleOnly?: boolean;
}

export interface SelectPresetsOptions {
  printer: string;
  process: string;
  filaments: string | string[];
}

export interface SelectedPresetsResult {
  printer: string;
  process: string;
  filaments: string[];
}

export interface OptionError {
  key: string;
  error: string;
}

export interface SetOptionsResult {
  errors: OptionError[];
}

export interface ModelObjectInfo {
  name: string;
  instances: number;
  volumes: number;
  size: [number, number, number];
}

export interface LoadModelResult {
  objects: ModelObjectInfo[];
}

export interface ProgressNotification {
  jobId: number;
  percent?: number;
  text?: string;
}

export interface SliceOptions {
  onProgress?: (progress: ProgressNotification) => void;
  signal?: AbortSignal;
  threads?: number;
  outPath?: string;
  plateIndex?: number;
}

export interface SliceResult {
  gcode: Uint8Array;
  gcodePath: string;
  gcodeBytes: number;
  layers: number;
  printTimeS: number;
  filamentMm: number;
  filamentG: number;
  warnings: string[];
}

export interface ConfigOptionDef {
  type: string;
  label?: string;
  fullLabel?: string;
  category?: string;
  tooltip?: string;
  sidetext?: string;
  mode: 'simple' | 'advanced' | 'expert' | 'develop';
  min?: number;
  max?: number;
  default?: string;
  enumValues?: string[];
  enumLabels?: string[];
  nullable?: boolean;
  readonly?: boolean;
  multiline?: boolean;
  guiType?: string;
  guiFlags?: string;
}

export interface FieldState {
  enabled: boolean;
  visible: boolean;
  label?: string;
}

export interface RuleFix {
  key: string;
  value: string;
  reason: string;
}

export interface EvaluateRulesResult {
  fields: Record<string, FieldState>;
  fixes: RuleFix[];
  messages: string[];
  context: any;
}

export interface PlateInstanceRef {
  objectId: number;
  instanceId: number;
  objectIndex: number;
  instanceIndex: number;
}

export interface PlateInfo {
  index: number;
  name: string;
  locked: boolean;
  origin: [number, number, number];
  size: [number, number, number];
  instances: PlateInstanceRef[];
  config: Record<string, string>;
  filamentMaps?: Record<string, string>;
}

export class OrcaEngine {
  protected constructor(worker: Worker, options: CreateEngineOptions);

  static create(options?: CreateEngineOptions): Promise<OrcaEngine>;

  call(method: string, args?: any, options?: any): Promise<any>;

  loadVendors(names?: string[]): Promise<LoadVendorsResult>;

  listPresets(
    kind: 'printer' | 'process' | 'filament',
    options?: ListPresetsOptions
  ): Promise<PresetItem[]>;

  selectPresets(selection: SelectPresetsOptions): Promise<SelectedPresetsResult>;

  getConfig(): Promise<Record<string, string>>;

  getConfigDef(keys?: string[]): Promise<Record<string, ConfigOptionDef>>;

  evaluateRules(options?: {
    kind: 'print' | 'printer' | 'filament' | 'sla_print' | 'sla_material';
    filamentIndex?: number;
  }): Promise<EvaluateRulesResult>;

  setOptions(options: Record<string, string>): Promise<SetOptionsResult>;

  resetOptions(): Promise<Record<string, never>>;

  loadModel(fileName: string, bytes: Uint8Array | ArrayBuffer): Promise<LoadModelResult>;

  addModel(fileName: string, bytes: Uint8Array | ArrayBuffer): Promise<LoadModelResult>;

  listObjects(): Promise<Array<any>>;

  getMesh(objectId: number): Promise<{ path: string; vertexCount: number; triangleCount: number; buffer: Uint8Array }>;

  setInstanceTransform(params: {
    objectId: number;
    instanceId: number;
    offset?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number] | number;
  }): Promise<Record<string, never>>;

  deleteObject(objectId: number): Promise<Record<string, never>>;

  duplicateInstance(objectId: number, instanceId: number): Promise<{ instanceId: number; id: number }>;

  arrange(options?: { useBed?: boolean }): Promise<Record<string, never>>;

  getObjectTree(): Promise<{ objects: Array<any> }>;

  addVolume(params: {
    objectId: number;
    type: string;
    shape: string;
    size?: number[] | number;
    offset?: number[];
    name?: string;
  }): Promise<{ volumeId: number; id: number; name: string }>;

  deleteVolume(objectId: number, volumeId: number): Promise<Record<string, never>>;

  renameObject(objectId: number, name: string): Promise<Record<string, never>>;

  renameVolume(objectId: number, volumeId: number, name: string): Promise<Record<string, never>>;

  setObjectConfig(params: {
    objectId: number;
    volumeId?: number;
    options: Record<string, string>;
  }): Promise<{ errors: Array<{ key: string; error: string }> }>;

  resetObjectConfig(params: {
    objectId: number;
    volumeId?: number;
    keys?: string[];
  }): Promise<Record<string, never>>;

  setVolumeExtruder(objectId: number, volumeId: number, extruder: number): Promise<Record<string, never>>;

  listPlates(): Promise<Array<PlateInfo>>;

  addPlate(params?: { name?: string; config?: Record<string, string> }): Promise<Array<PlateInfo>>;

  deletePlate(plateIndex: number, deleteObjects?: boolean): Promise<Array<PlateInfo>>;

  setPlateConfig(params: {
    plateIndex: number;
    config?: Record<string, string>;
    name?: string;
    locked?: boolean;
  }): Promise<Record<string, never>>;

  slice(options?: SliceOptions): Promise<SliceResult>;

  dispose(): void;
}

export default OrcaEngine;
