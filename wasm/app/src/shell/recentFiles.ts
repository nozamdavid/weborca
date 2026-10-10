/**
 * @file recentFiles.ts
 * Manages recent files with localStorage persistence (capped at 10) and optional IndexedDB byte caching.
 */

import { showToast } from './toastStore';

export interface RecentFileItem {
  name: string;
  date: number;
  type: 'project' | 'model' | 'gcode';
  size?: number;
}

const STORAGE_KEY = 'orca_recent_files';
const DB_NAME = 'orca_recent_files_db';
const STORE_NAME = 'files';
const MAX_RECENT = 10;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'name' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

export function getRecentFiles(): RecentFileItem[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch (_) {
    return [];
  }
}

export async function storeRecentFile(
  name: string,
  bytes: Uint8Array | ArrayBuffer,
  type: 'project' | 'model' | 'gcode'
): Promise<void> {
  const current = getRecentFiles();
  const filtered = current.filter((item) => item.name !== name);
  const size = bytes instanceof Uint8Array ? bytes.byteLength : (bytes as ArrayBuffer).byteLength;
  const newItem: RecentFileItem = { name, date: Date.now(), type, size };
  const updated = [newItem, ...filtered].slice(0, MAX_RECENT);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (_) {}

  // Store bytes in IndexedDB
  try {
    const db = await openDb();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const dataBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      store.put({ name, bytes: dataBytes, date: Date.now() });

      // Clean up records not in updated list
      const activeNames = new Set(updated.map((u) => u.name));
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          if (!activeNames.has(cursor.key as string)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
    }
  } catch (_) {
    // Non-fatal if IndexedDB storage fails
  }
}

export async function getRecentFileBytes(name: string): Promise<Uint8Array | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(name);
      req.onsuccess = () => {
        if (req.result && req.result.bytes) {
          resolve(req.result.bytes instanceof Uint8Array ? req.result.bytes : new Uint8Array(req.result.bytes));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

export async function openRecentFile(
  item: RecentFileItem,
  fallbackPicker?: (fileName: string) => void
): Promise<void> {
  const bytes = await getRecentFileBytes(item.name);
  if (!bytes) {
    showToast(`Cached data not found for ${item.name}. Please select the file to open.`, 'info');
    if (fallbackPicker) {
      fallbackPicker(item.name);
    }
    return;
  }

  const { useAppStore } = await import('../store/appStore');
  const file = new File([bytes as any], item.name);

  if (item.type === 'project' || item.name.toLowerCase().endsWith('.3mf')) {
    await useAppStore.getState().openProjectFile(file);
  } else if (item.type === 'gcode' || item.name.toLowerCase().endsWith('.gcode')) {
    await useAppStore.getState().openGcodeFile(file);
  } else {
    await useAppStore.getState().importModelFile(file);
  }
}
