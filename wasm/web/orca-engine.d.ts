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

  arrange(): Promise<Record<string, never>>;

  slice(options?: SliceOptions): Promise<SliceResult>;

  dispose(): void;
}

export default OrcaEngine;
