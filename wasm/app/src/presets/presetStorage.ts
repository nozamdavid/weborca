/**
 * @file presetStorage.ts
 * Persistence for user presets using OPFS (navigator.storage.getDirectory)
 * with transparent localStorage fallback and staleness reconciliation.
 */

import type { UserPreset, PresetKind } from './types';

const OPFS_FILE_NAME = 'user_presets.json';
const LOCAL_STORAGE_KEY = 'orca_user_presets';
const LOCAL_STORAGE_TS_KEY = 'orca_user_presets_ts';

interface StoredPresetEnvelope {
  version: number;
  updatedAt: number;
  presets: UserPreset[];
}

let storageLock = Promise.resolve();

function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = storageLock.then(fn, fn);
  storageLock = result.then(() => {}, () => {});
  return result;
}

async function getOpfsHandle(create = false): Promise<FileSystemFileHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getFileHandle(OPFS_FILE_NAME, { create });
  } catch (_) {
    return null;
  }
}

/**
 * Loads all user presets from OPFS or localStorage.
 * Reconciles timestamps to prevent stale OPFS data from resurrecting
 * over newer localStorage data if an OPFS write failed previously.
 */
export async function loadUserPresets(): Promise<UserPreset[]> {
  let opfsPresets: UserPreset[] | null = null;
  let opfsTimestamp = 0;

  // 1. Try OPFS
  try {
    const handle = await getOpfsHandle(false);
    if (handle) {
      const file = await handle.getFile();
      const text = await file.text();
      if (text.trim()) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          opfsPresets = parsed;
          opfsTimestamp = file.lastModified || 0;
        } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.presets)) {
          opfsPresets = parsed.presets;
          opfsTimestamp = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : (file.lastModified || 0);
        }
      }
    }
  } catch (err) {
    console.warn('[presetStorage] OPFS read failed:', err);
  }

  // 2. Read localStorage
  let localPresets: UserPreset[] | null = null;
  let localTimestamp = 0;
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      const rawTs = localStorage.getItem(LOCAL_STORAGE_TS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          localPresets = parsed;
          localTimestamp = rawTs ? Number(rawTs) : 0;
        } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.presets)) {
          localPresets = parsed.presets;
          localTimestamp = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : (rawTs ? Number(rawTs) : 0);
        }
      }
    } catch (err) {
      console.warn('[presetStorage] localStorage read failed:', err);
    }
  }

  // 3. Prevent resurrecting stale OPFS:
  // If localStorage has newer data than OPFS, choose localStorage
  if (localPresets && (!opfsPresets || localTimestamp > opfsTimestamp)) {
    // Attempt healing OPFS in background with serialized storage lock
    if (localTimestamp > opfsTimestamp) {
      withStorageLock(async () => {
        try {
          const handle = await getOpfsHandle(true);
          if (handle) {
            // Guard against timestamp conflict / race: verify OPFS hasn't been updated to >= localTimestamp
            let currentOpfsTs = 0;
            try {
              const file = await handle.getFile();
              const text = await file.text();
              if (text.trim()) {
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === 'object' && typeof parsed.updatedAt === 'number') {
                  currentOpfsTs = parsed.updatedAt;
                } else if (file.lastModified) {
                  currentOpfsTs = file.lastModified;
                }
              }
            } catch (_) {}

            if (currentOpfsTs < localTimestamp) {
              const writable = await handle.createWritable();
              const envelope: StoredPresetEnvelope = {
                version: 1,
                updatedAt: localTimestamp,
                presets: localPresets!
              };
              await writable.write(JSON.stringify(envelope, null, 2));
              await writable.close();
            }
          }
        } catch (_) {}
      });
    }
    return localPresets;
  }

  if (opfsPresets) {
    // Sync to localStorage copy
    if (typeof localStorage !== 'undefined') {
      try {
        const envelope: StoredPresetEnvelope = {
          version: 1,
          updatedAt: opfsTimestamp,
          presets: opfsPresets
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(envelope, null, 2));
        localStorage.setItem(LOCAL_STORAGE_TS_KEY, String(opfsTimestamp));
      } catch (_) {}
    }
    return opfsPresets;
  }

  if (localPresets) {
    return localPresets;
  }

  return [];
}

/**
 * Writes user presets to OPFS and localStorage.
 * Throws if both storage mechanisms fail. Retains fallback if one works.
 */
async function persistUserPresets(presets: UserPreset[]): Promise<void> {
  return withStorageLock(async () => {
    const timestamp = Date.now();
    let opfsSuccess = false;
    let opfsError: any = null;
    let localSuccess = false;
    let localError: any = null;

    // 1. Save to OPFS
    try {
      const handle = await getOpfsHandle(true);
      if (handle) {
        const writable = await handle.createWritable();
        const envelope: StoredPresetEnvelope = {
          version: 1,
          updatedAt: timestamp,
          presets
        };
        await writable.write(JSON.stringify(envelope, null, 2));
        await writable.close();
        opfsSuccess = true;
      } else {
        opfsError = new Error('OPFS handle unavailable');
      }
    } catch (err: any) {
      opfsError = err;
      console.warn('[presetStorage] OPFS write failed, relying on localStorage:', err);
    }

    // 2. Save to localStorage
    if (typeof localStorage !== 'undefined') {
      try {
        const envelope: StoredPresetEnvelope = {
          version: 1,
          updatedAt: timestamp,
          presets
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(envelope, null, 2));
        localStorage.setItem(LOCAL_STORAGE_TS_KEY, String(timestamp));
        localSuccess = true;
      } catch (err: any) {
        localError = err;
        console.warn('[presetStorage] localStorage write failed:', err);
      }
    } else {
      localError = new Error('localStorage unavailable');
    }

    if (!opfsSuccess && !localSuccess) {
      throw new Error(
        `Failed to persist presets to both OPFS (${opfsError?.message || 'failed'}) and localStorage (${localError?.message || 'failed'})`
      );
    }
  });
}

/**
 * Saves or updates a user preset.
 */
export async function saveUserPreset(preset: UserPreset): Promise<UserPreset[]> {
  const trimmedName = preset.name.trim();
  if (!trimmedName) {
    throw new Error('Preset name cannot be empty');
  }
  const existing = await loadUserPresets();
  const idx = existing.findIndex((p) => p.kind === preset.kind && p.name === trimmedName);
  const updatedPreset = { ...preset, name: trimmedName };
  if (idx >= 0) {
    existing[idx] = updatedPreset;
  } else {
    existing.push(updatedPreset);
  }
  await persistUserPresets(existing);
  return existing;
}

/**
 * Deletes a user preset.
 */
export async function deleteUserPreset(kind: PresetKind, name: string): Promise<UserPreset[]> {
  const existing = await loadUserPresets();
  const filtered = existing.filter((p) => !(p.kind === kind && p.name === name));
  await persistUserPresets(filtered);
  return filtered;
}

/**
 * Renames a user preset.
 */
export async function renameUserPreset(kind: PresetKind, oldName: string, newName: string): Promise<UserPreset[]> {
  const trimmedNewName = newName.trim();
  if (!trimmedNewName) {
    throw new Error('Preset name cannot be empty');
  }
  const existing = await loadUserPresets();
  const collision = existing.find((p) => p.kind === kind && p.name === trimmedNewName && p.name !== oldName);
  if (collision) {
    throw new Error(`Preset '${trimmedNewName}' already exists`);
  }
  const item = existing.find((p) => p.kind === kind && p.name === oldName);
  if (!item) {
    throw new Error(`User preset '${oldName}' not found`);
  }
  item.name = trimmedNewName;
  await persistUserPresets(existing);
  return existing;
}

/**
 * Duplicates a user preset.
 */
export async function duplicateUserPreset(kind: PresetKind, sourceName: string, newName: string): Promise<UserPreset[]> {
  const trimmedNewName = newName.trim();
  if (!trimmedNewName) {
    throw new Error('Preset name cannot be empty');
  }
  if (trimmedNewName === sourceName) {
    throw new Error('Copying requires a distinct name');
  }
  const existing = await loadUserPresets();
  const collision = existing.find((p) => p.kind === kind && p.name === trimmedNewName);
  if (collision) {
    throw new Error(`Preset '${trimmedNewName}' already exists`);
  }
  const source = existing.find((p) => p.kind === kind && p.name === sourceName);
  if (!source) {
    throw new Error(`Source user preset '${sourceName}' not found`);
  }
  const newPreset: UserPreset = {
    name: trimmedNewName,
    kind,
    inherits: source.inherits,
    values: { ...source.values }
  };
  existing.push(newPreset);
  await persistUserPresets(existing);
  return existing;
}
