export type PresetKind = 'process' | 'filament' | 'printer';

export interface UserPreset {
  name: string;
  kind: PresetKind;
  inherits: string;
  values: Record<string, string>;
}
