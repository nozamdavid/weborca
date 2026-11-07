import type { PhysicalPrinter, PrinterFilamentSlot, PrinterState } from './types';

const KEY = 'orca-printer-display-v1';
const MAX_BYTES = 256_000;
type Snapshot = { scope: string; receivedAt: number; state: PrinterState };
type Entries = Record<string, Snapshot>;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | undefined => typeof v === 'string' && v.length <= 256 && !/[\x00-\x1f]/.test(v) ? v : undefined;
const number = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9 ? v : undefined;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v.slice(0, 64) : [];

/** Explicit display-only allowlist. Never store transport objects, URLs, files lists or credentials. */
export function displaySnapshot(value: unknown): PrinterState | null {
  if (!record(value) || !['offline', 'ready', 'printing', 'paused', 'complete', 'error', 'unknown'].includes(value.state as string) ||
      !Array.isArray(value.heaters) || !Array.isArray(value.fans)) return null;
  const state: PrinterState = {
    state: value.state as PrinterState['state'],
    heaters: list(value.heaters).flatMap(h => record(h) && text(h.id) !== undefined && text(h.label) !== undefined &&
      ['extruder', 'bed', 'chamber', 'other'].includes(h.kind as string) && number(h.current) !== undefined && number(h.target) !== undefined
      ? [{ id: h.id as string, label: h.label as string, kind: h.kind as 'bed', current: h.current as number,
          target: h.target as number, toolIndex: number(h.toolIndex) }] : []),
    fans: list(value.fans).flatMap(f => record(f) && text(f.id) !== undefined && text(f.label) !== undefined && number(f.speed) !== undefined
      ? [{ id: f.id as string, label: f.label as string, speed: Math.max(0, Math.min(1, f.speed as number)) }] : [])
  };
  for (const key of ['progress', 'elapsed', 'remaining', 'speedFactor', 'flowFactor'] as const) {
    const n = number(value[key]); if (n !== undefined) state[key] = n;
  }
  // Only plain display text; credential-bearing file URLs must never enter the cache.
  for (const key of ['file', 'activeTool', 'software'] as const) {
    const t = text(value[key]); if (t !== undefined && !/[:/?#@]/.test(t)) state[key] = t;
  }
  if (record(value.layer) && number(value.layer.current) !== undefined)
    state.layer = { current: value.layer.current as number, total: number(value.layer.total) };
  if (record(value.position) && ['x', 'y', 'z'].every(axis => number((value.position as Record<string, unknown>)[axis]) !== undefined))
    state.position = { x: value.position.x as number, y: value.position.y as number, z: value.position.z as number };
  for (const key of ['filaments', 'filamentSlots'] as const) {
    if (!Array.isArray(value[key])) continue;
    const slots = list(value[key]).flatMap(f => {
      if (!record(f) || text(f.id) === undefined || text(f.label) === undefined || text(f.material) === undefined) return [];
      return [{ id: f.id as string, label: f.label as string, material: f.material as string,
        vendor: text(f.vendor), subtype: text(f.subtype),
        color: typeof f.color === 'string' && /^#[0-9a-f]{6,8}$/i.test(f.color) ? f.color : undefined,
        slotIndex: number(f.slotIndex), presence: ['present', 'empty', 'unknown'].includes(f.presence as string) ? f.presence : 'unknown' } as PrinterFilamentSlot];
    });
    state[key] = slots;
  }
  return state;
}

/** Scope excludes rotating credentials. Hash addresses so embedded URL credentials cannot be persisted. */
export function displayScope(p: PhysicalPrinter): string {
  const scope = JSON.stringify([p.id, p.host_type, p.print_host,
    p.cloud_region ?? 'global', p.cloud_account ?? '', p.printhost_user ?? '', p.cloud_device_id ?? '', p.serial ?? '', p.cloud_team_id ?? '', signedOut(p),
    p.octoeverywhere?.mode ?? '', p.octoeverywhere?.connection?.printerId ?? '', p.octoeverywhere?.connection?.connectionId ?? '']);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < scope.length; i++) { a = Math.imul(a ^ scope.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ scope.charCodeAt(i); }
  return `${a >>> 0}-${b >>> 0}`;
}
function signedOut(p: PhysicalPrinter): boolean {
  return ['snapmaker-cloud', 'prusaconnect', 'bambu-cloud', 'creality-cloud'].includes(p.host_type) && !p.printhost_apikey;
}
function read(): Entries {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > MAX_BYTES) return Object.create(null);
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed)) return Object.create(null);
    const result: Entries = Object.create(null);
    for (const [id, v] of Object.entries(parsed).slice(0, 64)) {
      if (id.length > 256 || !record(v) || !/^[0-9]+-[0-9]+$/.test(String(v.scope)) ||
          typeof v.receivedAt !== 'number' || !Number.isSafeInteger(v.receivedAt) || v.receivedAt <= 0 || v.receivedAt > Date.now()) continue;
      const state = displaySnapshot(v.state);
      if (state) result[id] = { scope: v.scope as string, receivedAt: v.receivedAt, state };
    }
    return result;
  } catch { return Object.create(null); }
}
function write(entries: Entries) {
  try {
    let raw = JSON.stringify(entries);
    const oldest = Object.keys(entries).sort((a, b) => entries[a].receivedAt - entries[b].receivedAt);
    while (raw.length > MAX_BYTES && oldest.length > 1) {
      delete entries[oldest.shift()!];
      raw = JSON.stringify(entries);
    }
    if (raw.length <= MAX_BYTES) localStorage.setItem(KEY, raw);
  }
  catch { /* Storage may be disabled or full; live monitoring remains usable. */ }
}
export function restoreDisplay(printers: PhysicalPrinter[], selected?: PhysicalPrinter): Snapshot | null {
  const entries = read();
  let changed = false;
  for (const id of Object.keys(entries)) {
    const p = printers.find(p => p.id === id);
    if (!p || signedOut(p) || entries[id].scope !== displayScope(p)) { delete entries[id]; changed = true; }
  }
  if (changed) write(entries);
  return selected ? entries[selected.id] ?? null : null;
}
export function saveDisplay(p: PhysicalPrinter, state: PrinterState, receivedAt: number): PrinterState | null {
  const display = displaySnapshot(state);
  if (!display || signedOut(p)) return null;
  const entries = read();
  if (!entries[p.id] && Object.keys(entries).length >= 64) {
    const oldest = Object.keys(entries).sort((a, b) => entries[a].receivedAt - entries[b].receivedAt)[0];
    delete entries[oldest];
  }
  entries[p.id] = { scope: displayScope(p), state: display, receivedAt };
  write(entries);
  return display;
}
