/**
 * Autosave and crash recovery: while the plate has objects and something changed, the project is written to
 * IndexedDB every minute. On the next start the app offers to restore it; saving the project or emptying the plate
 * removes it.
 */
import { getEngine } from '../engine/orcaEngine';
import { usePrefsStore } from '../prefs/prefsStore';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';

const DB_NAME = 'orca_autosave_db';
const STORE = 'autosave';
const KEY = 'latest';
export const AUTOSAVE_INTERVAL_MS = 60_000;
const VFS_PATH = '/out/autosave.3mf';

export interface AutosaveRecord {
  savedAt: number;
  objects: number;
  bytes: Uint8Array;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
    tx.oncomplete = () => db.close();
  });
}

export const readAutosave = () => withStore<AutosaveRecord | undefined>('readonly', (s) => s.get(KEY)).then((r) => r ?? undefined);
export const clearAutosave = () => withStore('readwrite', (s) => s.delete(KEY)).then(() => undefined);

export async function writeAutosave(): Promise<boolean> {
  const objects = usePlateStore.getState().objects.length;
  if (objects === 0) return false;
  const engine = await getEngine();
  await engine.call('saveProject', { path: VFS_PATH });
  const bytes = await engine.readFile(VFS_PATH);
  await withStore('readwrite', (s) => s.put({ savedAt: Date.now(), objects, bytes } satisfies AutosaveRecord, KEY));
  return true;
}

/** Starts the timer; returns a stop function. Skips ticks when nothing changed since the last save. */
export function startAutosave(intervalMs = AUTOSAVE_INTERVAL_MS): () => void {
  let dirty = false;
  const markDirty = () => { dirty = true; };
  const unsubscribePlate = usePlateStore.subscribe((state, previous) => {
    if (state.objects !== previous.objects) markDirty();
    if (state.objects.length === 0 && previous.objects.length > 0) void clearAutosave();
  });
  const unsubscribeApp = useAppStore.subscribe((state, previous) => {
    if (state.currentConfig !== previous.currentConfig) markDirty();
  });
  const timer = setInterval(() => {
    if (!dirty || !usePrefsStore.getState().general.autosave || useAppStore.getState().isSlicing) return;
    dirty = false;
    void writeAutosave().catch((err) => { dirty = true; console.warn('[autosave] failed:', err); });
  }, intervalMs);
  return () => {
    clearInterval(timer);
    unsubscribePlate();
    unsubscribeApp();
  };
}

// Test hook, like the other stores exposed on window.
if (typeof window !== 'undefined') (window as any).__autosave = { writeAutosave, readAutosave, clearAutosave };
