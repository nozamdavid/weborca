/**
 * Autosave and crash recovery: while the plate has objects and something changed, the project is written to
 * IndexedDB on the configured interval. On the next start the app offers to restore it; saving the project or emptying the plate
 * removes it.
 */
import { getEngine, getConfig } from '../engine/orcaEngine';
import { usePrefsStore } from '../prefs/prefsStore';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../history';

const DB_NAME = 'orca_autosave_db';
const STORE = 'autosave';
const KEY = 'latest';
export const AUTOSAVE_INTERVAL_MS = 60_000;
const VFS_PATH = '/out/autosave.3mf';

export interface AutosaveRecord {
  savedAt: number;
  objects: number;
  bytes?: Uint8Array;
  setup?: { vendor: string; printer: string; process: string; filaments: string[]; options: Record<string, string> };
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
    let result: T | undefined;
    req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = tx.onabort = () => { db.close(); resolve(undefined); };
  });
}

export const readAutosave = () => withStore<AutosaveRecord | undefined>('readonly', (s) => s.get(KEY)).then((r) => r ?? undefined);
export const clearAutosave = () => withStore('readwrite', (s) => s.delete(KEY)).then(() => undefined);

export async function writeAutosave(): Promise<boolean> {
  const objects = usePlateStore.getState().objects.length;
  const app = useAppStore.getState();
  const options = Object.fromEntries(Object.entries(app.currentConfig).filter(([key, value]) => value !== app.presetConfig[key]));
  if (objects === 0 && Object.keys(options).length === 0) return false;
  const setup = { vendor: app.selectedVendor, printer: app.selectedPrinter, process: app.selectedProcess, filaments: [...app.selectedFilaments], options };
  let bytes: Uint8Array | undefined;
  if (objects > 0) {
    const engine = await getEngine();
    await engine.call('saveProject', { path: VFS_PATH });
    bytes = await engine.readFile(VFS_PATH);
  }
  const result = await withStore('readwrite', (s) => s.put({ savedAt: Date.now(), objects, bytes, setup } satisfies AutosaveRecord, KEY));
  if (result === undefined) throw new Error('Could not store the recovery backup');
  return true;
}

export async function restoreAutosave(record: AutosaveRecord): Promise<void> {
  const app = useAppStore.getState();
  if (record.bytes) {
    await app.openProjectFile(new File([record.bytes as BlobPart], 'Recovered project.3mf'));
  }
  if (record.setup) {
    const setup = record.setup;
    if (!record.bytes && setup.vendor) await app.chooseVendor(setup.vendor);
    const select = async (kind: 'printer' | 'process' | 'filament', name: string, slot = 0) => {
      const state = useAppStore.getState();
      if (state.userPresets.some((p) => p.kind === kind && p.name === name)) await state.selectUserPreset(kind, name, slot);
      else if (kind === 'printer') await state.choosePrinter(name);
      else if (kind === 'process') await state.chooseProcess(name);
      else await state.chooseFilament(name, slot);
    };
    if (!record.bytes) {
      if (setup.printer) await select('printer', setup.printer);
      if (setup.process) await select('process', setup.process);
      for (const [slot, name] of setup.filaments.entries()) await select('filament', name, slot);
    }
    // Older web exports omitted the desktop override-key metadata. The
    // explicit backup settings also recover those otherwise valid projects.
    const engine = await getEngine();
    const result = await engine.call('setOptions', { options: setup.options });
    if (result.errors?.length) throw new Error(result.errors.map((e: { key: string; error: string }) => `${e.key}: ${e.error}`).join('; '));
    useAppStore.setState({ currentConfig: await getConfig() });
  }
  const error = useAppStore.getState().engineError;
  if (error) throw new Error(error);
}

/** Writes completed changes on the configured interval, and flushes when the tab is hidden. */
export function startAutosave(intervalMs?: number): () => void {
  let revision = 0;
  let savedRevision = 0;
  let saving = false;
  let stopped = false;
  let firstSave: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    const app = useAppStore.getState();
    if (stopped || saving || revision === savedRevision || !usePrefsStore.getState().general.autosave ||
        app.isSlicing || app.isModelLoading || useHistoryStore.getState().isRestoring) return;
    const pending = revision;
    saving = true;
    try {
      if (await writeAutosave()) savedRevision = pending;
    } catch (err) {
      console.warn('[autosave] failed:', err);
    } finally { saving = false; }
  };
  const markDirty = () => {
    revision++;
    // Make the first recovery point promptly after adding a model, even with a long interval.
    if (savedRevision === 0) {
      clearTimeout(firstSave);
      firstSave = setTimeout(() => void flush(), 500);
    }
  };
  const unsubscribePlate = usePlateStore.subscribe((state, previous) => {
    if (state.objects !== previous.objects) markDirty();
    if (state.objects.length === 0 && previous.objects.length > 0) void clearAutosave();
  });
  const unsubscribeApp = useAppStore.subscribe((state, previous) => {
    if (state.currentConfig !== previous.currentConfig) markDirty();
  });
  const unsubscribeHistory = useHistoryStore.subscribe((state, previous) => {
    if (state.currentSnapshot !== previous.currentSnapshot) markDirty();
  });
  // Changes may arrive between engine readiness and the asynchronous recovery lookup finishing.
  const initialApp = useAppStore.getState();
  if (usePlateStore.getState().objects.length || Object.entries(initialApp.currentConfig).some(([key, value]) => value !== initialApp.presetConfig[key])) markDirty();
  const period = () => intervalMs ?? Math.max(5, Math.min(3600, usePrefsStore.getState().general.autosaveIntervalSeconds || 60)) * 1000;
  let timer = setInterval(() => void flush(), period());
  const unsubscribePrefs = usePrefsStore.subscribe((state, previous) => {
    if (state.general.autosaveIntervalSeconds !== previous.general.autosaveIntervalSeconds) {
      clearInterval(timer);
      timer = setInterval(() => void flush(), period());
    }
    if (state.general.autosave && !previous.general.autosave) { markDirty(); void flush(); }
  });
  const onHidden = () => { if (document.visibilityState === 'hidden') void flush(); };
  const onPageHide = () => void flush();
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(firstSave);
    unsubscribePlate(); unsubscribeApp(); unsubscribeHistory(); unsubscribePrefs();
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onPageHide);
  };
}

// Test hook, like the other stores exposed on window.
if (typeof window !== 'undefined') (window as any).__autosave = { writeAutosave, readAutosave, clearAutosave };
