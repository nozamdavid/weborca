import type { UserPreset, PresetKind } from '../presets/types.ts';
import type { CloudProfile, CloudRecord } from './types.ts';
const kinds: Record<string, PresetKind> = { printer: 'printer', filament: 'filament', print: 'process' };
const metadata = new Set(['name', 'type', 'version', 'from', 'setting_id', 'filament_id', 'base_id', 'user_id', 'instantiation', 'inherits', 'include', 'is_custom_defined', 'url', 'description', 'created_time', 'updated_time', 'printer_settings_id', 'filament_settings_id', 'print_settings_id']);
const secretKey = /(?:password|access[_-]?code|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|credential|device[_-]?(?:id|ip)|printer[_-]?(?:ip|host)|print[_-]?host|ip_address|mqtt|authorization)/i;
export function checkPresetContent(content: Record<string, unknown>): void {
  if (!kinds[String(content.type)]) throw new Error('Unsupported cloud preset kind.');
  const check = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const addressField = key === 'print_host' || key === 'print_host_webui';
      let credentials = !addressField && secretKey.test(key);
      if (addressField && typeof item === 'string') {
        try {
          const address = new URL(item.includes('://') ? item : `http://${item}`);
          credentials = !!(address.username || address.password);
        } catch { /* Non-URL connection addresses retain their native representation. */ }
      }
      if (credentials) throw new Error('Preset contains device or account credentials. Remove them before cloud backup.');
      check(item);
    }
  };
  check(content);
}
export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid cloud revision.');
  return value;
}
export function decodeProfile(input: unknown): { profile: CloudProfile; preset: UserPreset } {
  const p = input as CloudProfile;
  if (!p || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name || !p.content || typeof p.content !== 'object' || Array.isArray(p.content)) throw new Error('Invalid cloud profile.');
  revision(p.updated_time);
  if (p.created_time !== undefined) revision(p.created_time);
  checkPresetContent(p.content);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(p.content)) {
    if (metadata.has(key)) continue;
    if (typeof value === 'string') values[key] = value;
    else if (Array.isArray(value) && value.every(v => ['string', 'number', 'boolean'].includes(typeof v))) values[key] = value.join(';');
    else if (typeof value === 'number' || typeof value === 'boolean') values[key] = String(value);
    // Unknown structured metadata stays in raw content rather than becoming an engine option.
  }
  return { profile: structuredClone(p), preset: { name: p.name, kind: kinds[String(p.content.type)], inherits: typeof p.content.inherits === 'string' ? p.content.inherits : '', values } };
}
export function encodeRecord(record: CloudRecord): Record<string, unknown> {
  const { preset, raw } = record;
  const content: Record<string, unknown> = { ...raw, name: record.serverName ?? preset.name, inherits: record.serverInherits ?? preset.inherits, type: preset.kind === 'process' ? 'print' : preset.kind };
  for (const [key, value] of Object.entries(preset.values)) {
    const original = raw[key];
    const serialized = Array.isArray(original) ? original.join(';') : String(original);
    if (!(key in raw) || serialized !== value) content[key] = value;
  }
  delete (content as Record<string, unknown>).updated_time;
  checkPresetContent(content);
  return content;
}
