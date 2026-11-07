import type { PrinterFilamentSlot, PrinterRunState, PrinterState } from './types';

type ObjectFields = Record<string, unknown>;
export type SnapmakerObjects = Record<string, ObjectFields>;
export type SnapmakerFrame =
  | { type: 'snapshot' | 'delta'; objects: SnapmakerObjects }
  | { type: 'connection'; state: 'connecting' | 'disconnected' }
  | { type: 'error'; code: keyof typeof SNAPMAKER_MONITOR_ERRORS; diagnostic?: SnapmakerDiagnostic };

export const SNAPMAKER_MONITOR_ERRORS = {
  auth: 'Snapmaker authentication or device authorization was rejected.',
  unsupported: 'The Snapmaker monitoring configuration is unsupported.',
  upstream: 'Snapmaker monitoring could not reach the upstream service.',
  timeout: 'Snapmaker monitoring did not become ready in time.',
  stale: 'Snapmaker monitoring data is no longer fresh.'
} as const;
const STAGES = {
  'device-list': 'device list API', 'monitoring-credential': 'monitoring credential API', dns: 'broker DNS lookup',
  'broker-connection': 'broker TLS/MQTT connection', subscription: 'broker subscription',
  'objects-list': 'printer object list', 'objects-subscribe': 'printer object subscription',
  'subscribe-filter': 'printer subscription filter', 'objects-query': 'printer object query'
} as const;
const REASONS = {
  http: 'HTTP rejected', business: 'API rejected', 'malformed-response': 'invalid API response',
  'response-limit': 'response exceeded limit', network: 'network failure', 'dns-not-found': 'DNS name not found',
  'dns-temporary': 'temporary DNS failure', 'connection-refused': 'connection refused', 'connection-reset': 'connection reset',
  'tls-certificate': 'TLS certificate rejected', 'tls-protocol': 'TLS handshake rejected', 'mqtt-rejected': 'MQTT rejected',
  'subscription-rejected': 'subscription rejected', 'rpc-error': 'RPC rejected', timeout: 'timed out',
  closed: 'connection closed', 'invalid-response': 'invalid monitoring response',
  'broker-host': 'unsupported broker host', 'broker-port': 'unsupported broker port',
  'client-identity': 'invalid client identity', 'credential-invalid': 'invalid monitoring credential',
  'subscribe-topics': 'unsupported subscribe topics', 'publish-topics': 'unsupported publish topics',
  'device-response': 'invalid device list response', 'device-identity': 'selected device identity could not be verified',
  'broker-address': 'broker address failed public address policy', 'client-in-use': 'local monitoring session already uses this client identity',
  'object-response': 'unsupported printer object response'
} as const;
type SnapmakerDiagnostic = { phase: keyof typeof STAGES; reason: keyof typeof REASONS; code?: number };
function parseDiagnostic(value: unknown): SnapmakerDiagnostic | undefined {
  if (!object(value) || Object.keys(value).some(key => !['phase', 'reason', 'code'].includes(key)) ||
      typeof value.phase !== 'string' || !own(STAGES, value.phase) ||
      typeof value.reason !== 'string' || !own(REASONS, value.reason) ||
      (own(value, 'code') && (!number(value.code, -2147483648, 2147483647) || !Number.isInteger(value.code)))) return undefined;
  if (own(value, 'code')) {
    if (value.reason === 'http' && !number(value.code, 100, 599)) return undefined;
    if (['mqtt-rejected', 'subscription-rejected'].includes(value.reason) && !number(value.code, 0, 255)) return undefined;
    if (!['http', 'business', 'rpc-error', 'mqtt-rejected', 'subscription-rejected'].includes(value.reason)) return undefined;
  }
  return { phase: value.phase as keyof typeof STAGES, reason: value.reason as keyof typeof REASONS,
    ...(own(value, 'code') ? { code: value.code as number } : {}) };
}
export function snapmakerMonitorError(frame: Extract<SnapmakerFrame, { type: 'error' }>): string {
  const base = SNAPMAKER_MONITOR_ERRORS[frame.code];
  const detail = frame.diagnostic;
  return detail ? `${base} Stage: ${STAGES[detail.phase]}; ${REASONS[detail.reason]}${detail.code !== undefined ? ` (code ${detail.code})` : ''}.` : base;
}
const invalid = () => new Error('Invalid Snapmaker monitoring data. Reconnect to retry.');
const object = (v: unknown): v is ObjectFields => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);
const number = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

function fields(value: unknown, validators: Record<string, (v: unknown) => boolean>): ObjectFields {
  if (!object(value)) throw invalid();
  const result: ObjectFields = Object.create(null);
  for (const [key, valid] of Object.entries(validators)) {
    if (!own(value, key)) continue;
    if (value[key] !== null && !valid(value[key])) throw invalid();
    result[key] = value[key];
  }
  return result;
}
const string = (max: number) => (v: unknown) => typeof v === 'string' && v.length <= max && !v.includes('\0');
const duration = (v: unknown) => number(v, 0, 31_536_000);
const layer = (v: unknown) => number(v, 0, 10_000_000) && Number.isSafeInteger(v);
const layerFields = { current_layer: layer, total_layer: layer };
const materialFields = ['filament_vendor', 'filament_type', 'filament_sub_type', 'filament_exist', 'filament_color_rgba', 'filament_color'];
const toolIndex = (v: unknown): v is number => number(v, 0, 15) && Number.isInteger(v);

// Optional material failures clear that value, rather than terminating valid heater telemetry.
function materialConfig(value: unknown): ObjectFields {
  const result: ObjectFields = Object.create(null);
  if (!object(value)) {
    for (const key of materialFields) result[key] = null;
    return result;
  }
  for (const key of materialFields) {
    if (!own(value, key)) continue;
    const items = value[key];
    result[key] = Array.isArray(items) && items.length <= 16 ? items.map(item => {
      if (key === 'filament_exist') return typeof item === 'boolean' ? item : null;
      if (key === 'filament_color' && number(item, -2147483648, 4294967295) && Number.isInteger(item)) return item;
      return string(128)(item) ? item : null;
    }) : null;
  }
  return result;
}

/** Accept only bounded JSON text and copy known fields into maps with no prototype. */
export function parseSnapmakerFrame(data: unknown): SnapmakerFrame {
  if (typeof data !== 'string' || data.length > 256 * 1024 || new TextEncoder().encode(data).length > 256 * 1024) throw invalid();
  const frame: unknown = JSON.parse(data, (key, value) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw invalid();
    return value;
  });
  if (!object(frame)) throw invalid();
  if (frame.type === 'connection' && ['connecting', 'disconnected'].includes(frame.state as string))
    return { type: 'connection', state: frame.state as 'connecting' | 'disconnected' };
  if (frame.type === 'error' && typeof frame.code === 'string' && own(SNAPMAKER_MONITOR_ERRORS, frame.code)) {
    const diagnostic = parseDiagnostic(frame.diagnostic);
    return { type: 'error', code: frame.code as keyof typeof SNAPMAKER_MONITOR_ERRORS, ...(diagnostic ? { diagnostic } : {}) };
  }
  if ((frame.type !== 'snapshot' && frame.type !== 'delta') || !object(frame.objects) || Object.keys(frame.objects).length > 20) throw invalid();
  const objects: SnapmakerObjects = Object.create(null);
  for (const [name, value] of Object.entries(frame.objects)) {
    if (name === 'print_stats') {
      const item = fields(value, { state: string(128), filename: string(4096), print_duration: duration, total_duration: duration,
        info: v => object(v) });
      if (item.info != null) item.info = fields(item.info, layerFields);
      objects[name] = item;
    } else if (name === 'display_status' || name === 'virtual_sdcard') {
      objects[name] = fields(value, { progress: v => number(v, 0, 1) });
    } else if (name === 'print_task_config') {
      objects[name] = materialConfig(value);
    } else if (name === 'heater_bed' || /^extruder(?:[0-9]{1,2})?$/.test(name)) {
      objects[name] = fields(value, { temperature: v => number(v, -273.15, 1000), target: v => number(v, 0, 1000) });
      if (name !== 'heater_bed' && object(value) && own(value, 'extruder_index'))
        objects[name].extruder_index = toolIndex(value.extruder_index) ? value.extruder_index : null;
    } else throw invalid();
  }
  return { type: frame.type, objects };
}

export function mergeSnapmakerObjects(previous: SnapmakerObjects, delta: SnapmakerObjects): SnapmakerObjects {
  const merged: SnapmakerObjects = Object.assign(Object.create(null), previous);
  for (const [key, item] of Object.entries(delta)) {
    merged[key] = { ...previous[key], ...item };
    if (object(item.info)) merged[key].info = { ...(object(previous[key]?.info) ? previous[key].info : {}), ...item.info };
  }
  if (Object.keys(merged).length > 20) throw invalid();
  return merged;
}

const states: Record<string, PrinterRunState> = Object.assign(Object.create(null), {
  standby: 'ready', printing: 'printing', paused: 'paused', complete: 'complete', error: 'error'
});

function materialText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.toUpperCase() !== 'NONE' ? text : undefined;
}
function materialColor(preferred: unknown, legacy: unknown): string | undefined {
  const value = typeof preferred === 'string' ? preferred : legacy;
  if (typeof value === 'string') {
    const hex = value.trim().replace(/^#/, '');
    return /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex) ? `#${hex.slice(0, 6).toUpperCase()}` : undefined;
  }
  return typeof value === 'number' ? `#${(value >>> 0).toString(16).padStart(8, '0').slice(2).toUpperCase()}` : undefined;
}
function filamentSlots(objects: SnapmakerObjects): PrinterFilamentSlot[] | undefined {
  const config = objects.print_task_config;
  if (!config) return undefined;
  const arrays = ['filament_vendor', 'filament_type', 'filament_exist'].map(key => config[key]).filter(Array.isArray);
  if (!arrays.length) return undefined;
  const count = Math.max(...arrays.map(items => items.length));
  // Array positions are authoritative. Validate the explicit physical join without remapping
  // through heater enumeration or job maps; ambiguous joins expose no material identity.
  const joins = new Map<number, number[]>();
  const ambiguous = new Set<number>();
  for (const [name, item] of Object.entries(objects)) {
    if (!/^extruder(?:[0-9]{1,2})?$/.test(name)) continue;
    const ordinal = name === 'extruder' ? 0 : Number(name.slice(8));
    const index = own(item, 'extruder_index') ? item.extruder_index : ordinal;
    if (!toolIndex(index) || !toolIndex(ordinal)) { if (toolIndex(ordinal)) ambiguous.add(ordinal); continue; }
    joins.set(index, [...(joins.get(index) ?? []), ordinal]);
  }
  for (const [index, ordinals] of joins) if (ordinals.length > 1) {
    ambiguous.add(index);
    for (const ordinal of ordinals) ambiguous.add(ordinal);
  }
  const at = (key: string, index: number): unknown => Array.isArray(config[key]) ? config[key][index] : undefined;
  return Array.from({ length: count }, (_, slotIndex) => {
    const exists = at('filament_exist', slotIndex);
    const slot: PrinterFilamentSlot = { id: `snapmaker:tool:${slotIndex}`, slotIndex, label: `T${slotIndex}`, material: '',
      presence: exists === false ? 'empty' : exists === true && !ambiguous.has(slotIndex) ? 'present' : 'unknown' };
    if (slot.presence === 'empty' || ambiguous.has(slotIndex)) return slot;
    slot.material = materialText(at('filament_type', slotIndex)) ?? '';
    const vendor = materialText(at('filament_vendor', slotIndex));
    const subtype = materialText(at('filament_sub_type', slotIndex));
    const color = materialColor(at('filament_color_rgba', slotIndex), at('filament_color', slotIndex));
    if (vendor) slot.vendor = vendor;
    if (subtype) slot.subtype = subtype;
    if (color) slot.color = color;
    return slot;
  });
}
export function snapmakerPrinterState(objects: SnapmakerObjects): PrinterState {
  const stats = objects.print_stats;
  const info = object(stats?.info) ? stats.info : undefined;
  const current = info?.current_layer;
  const total = info?.total_layer;
  return {
    state: typeof stats?.state === 'string' ? states[stats.state] ?? 'unknown' : 'unknown',
    file: typeof stats?.filename === 'string' && stats.filename ? stats.filename : undefined,
    elapsed: typeof stats?.print_duration === 'number' ? stats.print_duration :
      typeof stats?.total_duration === 'number' ? stats.total_duration : undefined,
    progress: typeof objects.display_status?.progress === 'number' ? objects.display_status.progress :
      typeof objects.virtual_sdcard?.progress === 'number' ? objects.virtual_sdcard.progress : undefined,
    layer: typeof current === 'number' ? { current, total: typeof total === 'number' && total >= current ? total : undefined } : undefined,
    heaters: Object.entries(objects).flatMap(([id, item]) => {
      if ((id !== 'heater_bed' && !/^extruder(?:[0-9]{1,2})?$/.test(id)) ||
        typeof item.temperature !== 'number' || typeof item.target !== 'number') return [];
      const index = own(item, 'extruder_index') ? item.extruder_index : id === 'extruder' ? 0 :
        /^extruder(?:[1-9]|1[0-5])$/.test(id) ? Number(id.slice(8)) : undefined;
      return [{ id, label: id === 'heater_bed' ? 'Bed' : id === 'extruder' ? 'Extruder' : `Extruder ${id.slice(8)}`,
        ...(id !== 'heater_bed' && toolIndex(index) ? { toolIndex: index } : {}),
        kind: id === 'heater_bed' ? 'bed' as const : 'extruder' as const, current: item.temperature, target: item.target }];
    }),
    fans: [],
    filamentSlots: filamentSlots(objects)
  };
}
