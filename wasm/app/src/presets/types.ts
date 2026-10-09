export type PresetKind = 'process' | 'filament' | 'printer';

export interface UserPreset {
  name: string;
  kind: PresetKind;
  inherits: string;
  values: Record<string, string>;
}

export type ConflictStrategy = 'overwrite' | 'rename' | 'skip';

export interface PresetBundle {
  format: 'orcaslicer-web-preset-bundle';
  version: 1;
  exportedAt: string;
  generator?: string;
  description?: string;
  presets: UserPreset[];
}

export interface ImportBundleResult {
  success: boolean;
  message: string;
  allPresets: UserPreset[];
  importedCount: number;
  skippedCount: number;
  renamedCount: number;
  overwrittenCount: number;
  renamedItems: Array<{ original: string; newName: string; kind: PresetKind }>;
}
