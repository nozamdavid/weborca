export interface PresetItem {
  name: string;
  vendor: string;
  isSystem: boolean;
  isCompatible: boolean;
  inherits: string;
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

/** STEP tessellation settings; ignored for mesh formats. */
export interface StepImportOptions {
  linearDeflection?: number;
  angleDeflection?: number;
}

export interface ProgressNotification {
  jobId: number;
  percent?: number;
  text?: string;
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

export interface VendorInfo {
  name: string;
  bytes: number;
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

export interface OptionError {
  key: string;
  error: string;
}

export interface SetOptionsResult {
  errors: OptionError[];
}
