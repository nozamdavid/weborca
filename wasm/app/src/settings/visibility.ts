import type { ConfigOptionDef, FieldState } from '../engine/types';
import type { LayoutLine, SettingsMode } from './types';

export function isModeVisible(mode: SettingsMode, optionMode = 'simple'): boolean {
  return mode === 'expert' || optionMode === 'simple' || (mode === 'advanced' && optionMode === 'advanced');
}

export function isLineVisible(line: LayoutLine, mode: SettingsMode, defs: Record<string, ConfigOptionDef>, fields: Record<string, FieldState>): boolean {
  const visible = (key: string, index?: number) =>
    isModeVisible(mode, defs[key]?.mode) && (fields[index === undefined ? key : `${key}#${index}`] ?? fields[key])?.visible !== false;
  if (line.type === 'line') return !!line.options?.some((key) => visible(key));
  if (line.type === 'custom') return !line.key || visible(line.key);
  return !!line.key && visible(line.key, line.index);
}
