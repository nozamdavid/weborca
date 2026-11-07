/** Presets and cloud journals commit together in one OPFS/localStorage envelope. */
import type { UserPreset, PresetKind } from './types.ts';
import type { PresetStorageEnvelope } from '../orcaCloud/types.ts';
import { journalLocalChanges } from '../orcaCloud/journal.ts';
const FILE = 'user_presets.json';
const KEY = 'orca_user_presets';
let queue = Promise.resolve();
async function lock<T>(work: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request('orca-user-presets', work);
    return await work();
  };
  const result = queue.then(run, run);
  queue = result.then(() => {}, () => {});
  return result;
}
async function handle(create: boolean): Promise<FileSystemFileHandle | null> {
  try { return await navigator.storage.getDirectory().then(root => root.getFileHandle(FILE, { create })); }
  catch { return null; }
}
function envelope(raw: string, timestamp = 0): PresetStorageEnvelope {
  const value = JSON.parse(raw);
  const state = Array.isArray(value) ? { presets: value, updatedAt: timestamp } : value;
  if (!Array.isArray(state.presets)) throw new Error('Invalid preset storage.');
  return { version: 2, updatedAt: state.updatedAt || timestamp, presets: state.presets, cloud: state.cloud ?? { accounts: {} } };
}
async function read(): Promise<PresetStorageEnvelope> {
  let opfs: PresetStorageEnvelope | undefined, fallback: PresetStorageEnvelope | undefined;
  try { const h = await handle(false); if (h) { const file = await h.getFile(); opfs = envelope(await file.text(), file.lastModified); } } catch { /* fallback */ }
  try { const raw = localStorage.getItem(KEY); if (raw) fallback = envelope(raw, Number(localStorage.getItem('orca_user_presets_ts')) || 0); } catch { /* OPFS */ }
  return fallback && (!opfs || fallback.updatedAt > opfs.updatedAt) ? fallback : opfs ?? fallback ?? { version: 2, updatedAt: 0, presets: [], cloud: { accounts: {} } };
}
async function write(state: PresetStorageEnvelope) {
  state.updatedAt = Math.max(Date.now(), state.updatedAt + 1);
  const text = JSON.stringify(state);
  let saved = false;
  try {
    const h = await handle(true);
    if (h) { const stream = await h.createWritable(); await stream.write(text); await stream.close(); saved = true; }
  } catch { /* use fallback; never publish a checkpoint after both writes fail */ }
  try { localStorage.setItem(KEY, text); saved = true; } catch { /* OPFS may have committed */ }
  if (!saved) throw new Error('Unable to save presets and cloud journal durably.');
}
export async function transactPresetStorage<T>(work: (state: PresetStorageEnvelope) => Promise<T> | T): Promise<T> {
  return lock(async () => {
    const state = await read();
    if (typeof navigator !== 'undefined' && !navigator.locks && (state.cloud.activeAccount || Object.keys(state.cloud.accounts).length)) {
      throw new Error('Cloud sync requires browser Web Locks. Use a supported HTTPS browser.');
    }
    const result = await work(state);
    if (typeof navigator !== 'undefined' && !navigator.locks && Object.keys(state.cloud.accounts).length) {
      throw new Error('Cloud sync requires browser Web Locks. Use a supported HTTPS browser.');
    }
    await write(state);
    return result;
  });
}
export async function loadUserPresets(): Promise<UserPreset[]> { return lock(async () => (await read()).presets); }
export async function persistUserPresets(presets: UserPreset[]): Promise<void> {
  await transactPresetStorage(state => journalLocalChanges(state, structuredClone(presets)));
}
export async function saveUserPreset(preset: UserPreset): Promise<UserPreset[]> {
  return transactPresetStorage(state => {
    const name = preset.name.trim();
    if (!name) throw new Error('Preset name cannot be empty');
    const next = structuredClone(state.presets);
    const i = next.findIndex(p => p.kind === preset.kind && p.name === name);
    const p = { ...preset, name, cloudRef: preset.cloudRef ?? next[i]?.cloudRef };
    if (i < 0) next.push(p); else next[i] = p;
    journalLocalChanges(state, next); return next;
  });
}
export async function deleteUserPreset(kind: PresetKind, name: string): Promise<UserPreset[]> {
  return transactPresetStorage(state => {
    if (state.presets.some(p => p.kind === kind && p.inherits === name)) throw new Error(`Cannot delete '${name}': other presets inherit from it.`);
    const next = state.presets.filter(p => p.kind !== kind || p.name !== name);
    journalLocalChanges(state, next); return next;
  });
}
export async function renameUserPreset(kind: PresetKind, oldName: string, newName: string): Promise<UserPreset[]> {
  return transactPresetStorage(state => {
    const name = newName.trim();
    if (!name) throw new Error('Preset name cannot be empty');
    if (state.presets.some(p => p.kind === kind && p.name === name && p.name !== oldName)) throw new Error(`Preset '${name}' already exists`);
    const next = structuredClone(state.presets);
    const p = next.find(p => p.kind === kind && p.name === oldName);
    if (!p) throw new Error(`User preset '${oldName}' not found`);
    p.name = name;
    for (const child of next) if (child.kind === kind && child.inherits === oldName) child.inherits = name;
    journalLocalChanges(state, next); return next;
  });
}
export async function duplicateUserPreset(kind: PresetKind, sourceName: string, newName: string): Promise<UserPreset[]> {
  return transactPresetStorage(state => {
    const name = newName.trim();
    if (!name || name === sourceName) throw new Error('Copying requires a distinct name');
    if (state.presets.some(p => p.kind === kind && p.name === name)) throw new Error(`Preset '${name}' already exists`);
    const source = state.presets.find(p => p.kind === kind && p.name === sourceName);
    if (!source) throw new Error(`Source user preset '${sourceName}' not found`);
    const next = [...state.presets, { name, kind, inherits: source.inherits, values: { ...source.values } }];
    journalLocalChanges(state, next); return next;
  });
}
export async function saveUserPresetsBatch(presets: UserPreset[]): Promise<UserPreset[]> {
  await persistUserPresets(presets); return presets;
}
