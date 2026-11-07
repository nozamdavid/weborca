import type { ConfigOptionDef, FieldState } from '../engine/types';
import type { SettingsLayout } from '../settings/types';

export const DEFAULT_MOBILE_STEPS = 'layer_height,wall_loops,sparse_infill_density,sparse_infill_pattern,enable_support,support_type';
const aliases: Record<string, string> = { infill_pct: 'sparse_infill_density', infill_pattern: 'sparse_infill_pattern' };

export function parseMobileSteps(value: string) {
  return [...new Set(value.split(',').map(key => key.trim()).filter(Boolean).map(key => aliases[key] ?? key))];
}

export type SettingKind = 'print' | 'filament' | 'printer';
export function settingKind(key: string, layout: SettingsLayout | null): SettingKind | undefined {
  return layout?.tabs.find(tab => tab.pages.some(page => page.groups.some(group =>
    group.lines.some(line => line.key === key || line.options?.includes(key)))))?.id ?? 'print';
}

export const vectorTypes: Record<string, string> = {
  floats: 'float', ints: 'int', strings: 'string', percents: 'percent',
  floatsOrPercents: 'floatOrPercent', bools: 'bool', enums: 'enum'
};

export const geometryTypes = ['point', 'point3', 'points', 'pointsGroups', 'intsGroups'];
export const geometryFormats: Record<string, string> = {
  point: 'X,Y', point3: 'X,Y,Z', points: 'XxY,XxY',
  pointsGroups: 'XxY,XxY#XxY,XxY', intsGroups: '1,2#3,4'
};

// ConfigOptionPoints/Groups accept malformed coordinates as zero. Validate before
// handing the exact serialization to the native editor, without rounding values.
export function validGeometry(type: string, value: string) {
  const number = (text: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim()) && Number.isFinite(Number(text));
  const point = (text: string, separator: string, count: number) => {
    const coordinates = text.split(separator);
    return coordinates.length === count && coordinates.every(number);
  };
  if (type === 'point' || type === 'point3') return point(value, ',', type === 'point' ? 2 : 3);
  if (value === '') return true; // Empty exclusion areas and groups are valid.
  return value.split(type.endsWith('Groups') ? '#' : '\u0000').every(group =>
    group === '' || group.split(',').every(cell => type === 'intsGroups'
      ? /^-?\d+$/.test(cell.trim()) && Number.isSafeInteger(Number(cell)) && Number(cell) >= -2147483648 && Number(cell) <= 2147483647
      : point(cell, 'x', 2)));
}

export function classifySetting(def: ConfigOptionDef | undefined, _kind?: SettingKind, field?: FieldState, key?: string) {
  if (!def) return { widget: 'skip', reason: 'Unknown setting key' };
  if (def.readonly) return { widget: 'skip', reason: 'Read-only setting' };
  const type = vectorTypes[def.type] ?? def.type;
  if (!geometryTypes.includes(type) && !['float', 'int', 'string', 'percent', 'floatOrPercent', 'bool', 'enum'].includes(type)) {
    return { widget: 'skip', reason: 'Unsupported setting type: {{type}}' };
  }
  if (field?.visible === false) return { widget: 'skip', reason: 'Unavailable for the current printer or settings' };
  // Native rules disable the desktop's geometry summary field, whose dedicated
  // editor is replaced by our validated editor. Visibility still gates context.
  if (geometryTypes.includes(type)) return { widget: 'textarea', reason: undefined };
  // This desktop summary also has a dedicated editor; retain its visibility rule.
  if (key === 'extruder_printable_height') return { widget: 'text', reason: undefined };
  if (field?.enabled === false) return { widget: 'skip', reason: 'Disabled by the current settings' };
  if (type === 'enum' && !def.enumValues?.length) return { widget: 'skip', reason: 'No available enum choices' };
  if (def.nullable && type === 'bool') return { widget: 'select', reason: undefined };
  if (def.nullable && ['float', 'int', 'percent', 'floatOrPercent'].includes(type)) return { widget: 'text', reason: undefined };
  return { widget: type === 'bool' ? 'checkbox' : type === 'enum' ? 'select' : def.multiline ? 'textarea' :
    type === 'float' || type === 'int' ? 'number' : 'text', reason: undefined };
}
