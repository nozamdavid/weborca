/**
 * Autosave and crash recovery: model or settings changes are written to
 * IndexedDB on the configured interval. On the next start the app offers recovery.
 * Saving the project explicitly clears its backup.
 */
import { getEngine, getConfig, setOptions } from '../engine/orcaEngine';
import { usePrefsStore } from '../prefs/prefsStore';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';
import { useHistoryStore, capturePlateState, restorePlatesOnEmptyCanvas } from '../history';
import type { HistoryPlateState } from '../history';
import { usePlatesStore } from '../plates/platesStore';
import { isDefaultPlateName } from '../plates/plateName';
import { useAutosaveStatus } from './AutosaveStatus';
import { usePreviewStore } from '../preview/previewStore';

const DB_NAME = 'orca_autosave_db';
const STORE = 'autosave';
const KEY = 'latest';
export const AUTOSAVE_INTERVAL_MS = 60_000;
const VFS_PATH = '/out/autosave.3mf';
let backupGeneration = 0;
const clearListeners = new Set<() => void>();
let pendingWrite: Promise<boolean> | undefined;
let startupBaseline: string | undefined;
let ownsSessionBackup = false;

/** Capture hydrated preferences before readiness exposes project editing. */
export async function initializeAutosaveSession(): Promise<void> {
  // Auth re-entry retains the stores until backup succeeds. Replace their old
  // geometry/plates with this engine's scene before defining its empty baseline.
  await usePlateStore.getState().refreshObjects();
  startupBaseline = captureAutosaveBaseline();
  ownsSessionBackup = false;
}

export interface AutosaveRecord {
  savedAt: number;
  objects: number;
  bytes?: Uint8Array;
  plateState?: HistoryPlateState;
  setup?: {
    vendor: string; printer: string; process: string; filaments: string[]; options: Record<string, string>;
    presetConfig?: Record<string, string>;
    overrides?: { process: Record<string, string>; filament: Record<string, string>; printer: Record<string, string> };
  };
}

function hasPlateChanges(state: HistoryPlateState): boolean {
  return state.plates.length !== 1 || state.plates.some(plate =>
    plate.locked || !isDefaultPlateName(plate.name, plate.index) || Object.keys(plate.config).length > 0);
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

export const readAutosave = () => withStore<AutosaveRecord | undefined>('readonly', (s) => s.get(KEY)).then((r) => {
  if (r) useAutosaveStatus.setState({ savedAt: r.savedAt });
  return r ?? undefined;
});
export const clearAutosave = () => {
  // Invalidate an older writer before awaiting IndexedDB so it cannot recreate
  // a discarded project after New Project or an explicit save.
  backupGeneration++;
  useAutosaveStatus.setState({ savedAt: null, startedAt: 0 });
  for (const onClear of clearListeners) onClear();
  return withStore('readwrite', (s) => s.delete(KEY)).then(() => undefined);
};

/** Serialize exports; background writers recheck idle state when their turn arrives. */
export function writeAutosave(requireIdle = false): Promise<boolean> {
  const previous = pendingWrite;
  const generation = backupGeneration;
  const write = (async () => {
    if (previous) { try { await previous; } catch { /* Retry with the current project. */ } }
    if (generation !== backupGeneration) return false;
    if (requireIdle && !canFlushAutosave()) return false;
    return writeAutosaveRecord();
  })();
  pendingWrite = write;
  return write.finally(() => { if (pendingWrite === write) pendingWrite = undefined; });
}

async function writeAutosaveRecord(): Promise<boolean> {
  const generation = backupGeneration;
  const objects = usePlateStore.getState().objects.length;
  const app = useAppStore.getState();
  if (!app.isEngineReady || app.isSelectingPreset) return false;
  // Restored device/user presets are already durable preferences. Forced auth
  // cleanup uses this same writer, even when periodic autosave is disabled.
  if (objects === 0 && captureAutosaveBaseline() === startupBaseline) {
    // A return to the initial empty project must retire this session's geometry,
    // but an untouched engine must never delete an unanswered older recovery.
    if (ownsSessionBackup) await clearAutosave();
    return false;
  }
  const plateState = capturePlateState();
  const changedOptions = Object.fromEntries(Object.entries(app.currentConfig).filter(([key, value]) => value !== app.presetConfig[key]));
  const options = {
    ...app.processOverrides, ...app.filamentOverrides, ...app.printerOverrides,
    ...changedOptions
  };
  const hasUserPreset = Object.values(app.activeUserPreset).some(name => name !== null) ||
    app.selectedFilaments.some(name => app.userPresets.some(preset => preset.kind === 'filament' && preset.name === name));
  if (startupBaseline === undefined && objects === 0 && Object.keys(changedOptions).length === 0 && !hasUserPreset && !hasPlateChanges(plateState)) {
    await clearAutosave();
    return false;
  }
  const setup = {
    vendor: app.selectedVendor, printer: app.selectedPrinter, process: app.selectedProcess,
    filaments: [...app.selectedFilaments], options,
    presetConfig: { ...app.presetConfig },
    overrides: { process: { ...app.processOverrides }, filament: { ...app.filamentOverrides }, printer: { ...app.printerOverrides } }
  };
  useAutosaveStatus.setState({ saving: true, startedAt: Date.now() });
  try {
    let bytes: Uint8Array | undefined;
    if (objects > 0) {
      const engine = await getEngine();
      // Recovery backups favor quick saves over the smallest downloadable archive.
      await engine.call('saveProject', { path: VFS_PATH, compressionLevel: 2 });
      bytes = await engine.readFile(VFS_PATH);
    }
    if (generation !== backupGeneration) return false;
    const result = await withStore('readwrite', (s) => generation === backupGeneration
      ? s.put({ savedAt: Date.now(), objects, bytes, setup, plateState } satisfies AutosaveRecord, KEY)
      : s.get(KEY));
    if (generation !== backupGeneration) return false;
    if (result === undefined) throw new Error('Could not store the recovery backup');
    ownsSessionBackup = true;
    useAutosaveStatus.setState({ savedAt: Date.now() });
    return true;
  } finally {
    useAutosaveStatus.setState({ saving: false });
  }
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
    await setOptions(setup.options);
    const state = useAppStore.getState();
    const userName = (kind: 'printer' | 'process' | 'filament', name: string) =>
      state.userPresets.some(preset => preset.kind === kind && preset.name === name) ? name : null;
    // A desktop 3MF records native parent preset IDs. Keep the web user preset labels
    // from the backup without reselecting presets and replacing its recovered settings.
    const filaments = record.bytes && setup.filaments.length === state.selectedFilaments.length &&
      setup.filaments.every(name => userName('filament', name) || state.filaments.some(preset => preset.name === name))
      ? setup.filaments : state.selectedFilaments;
    const printer = record.bytes && userName('printer', setup.printer) ? setup.printer : state.selectedPrinter;
    const process = record.bytes && userName('process', setup.process) ? setup.process : state.selectedProcess;
    useAppStore.setState({
      currentConfig: await getConfig(), selectedPrinter: printer, selectedProcess: process,
      ...(setup.presetConfig ? { presetConfig: { ...setup.presetConfig } } : {}),
      selectedFilaments: [...filaments], selectedFilament: filaments[0] || state.selectedFilament,
      activeUserPreset: { printer: userName('printer', printer), process: userName('process', process), filament: userName('filament', filaments[0]) },
      ...(setup.overrides ? {
        processOverrides: { ...setup.overrides.process }, filamentOverrides: { ...setup.overrides.filament }, printerOverrides: { ...setup.overrides.printer }
      } : {})
    });
  }
  if (record.plateState) {
    if (!record.bytes) await restorePlatesOnEmptyCanvas(await getEngine(), record.plateState);
    else usePlatesStore.getState().setActivePlate(record.plateState.activePlateIndex);
  }
  const error = useAppStore.getState().engineError;
  if (error) throw new Error(error);
  ownsSessionBackup = true;
}

function normalizedPlates(state: HistoryPlateState): HistoryPlateState {
  return { plates: state.plates.map(plate => ({ ...plate, filamentMaps: plate.filamentMaps ?? [] })), activePlateIndex: state.activePlateIndex };
}

/** Retire only legacy empty backups whose recovered state is already hydrated. */
export function isRedundantAutosave(record: AutosaveRecord): boolean {
  return isRedundantAutosaveRecord(record, startupBaseline);
}

export function isRedundantAutosaveRecord(record: AutosaveRecord, baselineJson: string | undefined): boolean {
  if (baselineJson === undefined || record.objects !== 0 || record.bytes !== undefined ||
      !record.setup?.presetConfig || !Object.keys(record.setup.presetConfig).length || !record.plateState) return false;
  const baseline = JSON.parse(baselineJson);
  const setup = record.setup;
  const values = { ...setup.presetConfig, ...setup.overrides?.process,
    ...setup.overrides?.filament, ...setup.overrides?.printer, ...setup.options };
  return setup.vendor === baseline.vendor && setup.printer === baseline.printer && setup.process === baseline.process &&
    JSON.stringify(setup.filaments) === JSON.stringify(baseline.filaments) &&
    Object.entries(values).every(([key, value]) => value === baseline.config[key]) &&
    JSON.stringify(normalizedPlates(record.plateState)) === JSON.stringify(baseline.plates);
}

/** Startup device preferences are a baseline, rather than unsaved project edits. */
export function isAtStartupBaseline(): boolean {
  return startupBaseline !== undefined && captureAutosaveBaseline() === startupBaseline;
}

export function captureAutosaveBaseline(): string {
  const app = useAppStore.getState();
  return JSON.stringify({
    config: app.currentConfig,
    vendor: app.selectedVendor,
    printer: app.selectedPrinter, process: app.selectedProcess, filaments: app.selectedFilaments,
    objects: usePlateStore.getState().objects,
    // Native listPlates hydrates an absent map as []; both mean no mapping.
    plates: normalizedPlates(capturePlateState())
  });
}

function canFlushAutosave(): boolean {
  const app = useAppStore.getState();
  return usePrefsStore.getState().general.autosave && app.isEngineReady &&
    !app.isSlicing && !app.isModelLoading && !app.isSelectingPreset &&
    !Object.keys(app.pendingOptions).length && !useHistoryStore.getState().isRestoring;
}

/** Periodic edits plus prompt recovery checkpoints for imports and filament changes. */
export function startAutosave(intervalMs?: number, baseline = captureAutosaveBaseline()): () => void {
  let revision = 0;
  let savedRevision = 0;
  let saving = false;
  let urgentSave = false;
  let stopped = false;
  let checkpointRevision = 0;
  let guardingUnload = false;
  let completedFilaments = [...useAppStore.getState().selectedFilaments];
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    void flush();
    event.preventDefault();
    event.returnValue = '';
  };
  const syncUnloadGuard = () => {
    const needed = !stopped && usePrefsStore.getState().general.autosave &&
      checkpointRevision > savedRevision && !useHistoryStore.getState().isRestoring;
    if (needed === guardingUnload) return;
    guardingUnload = needed;
    if (needed) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
  };
  const flush = async () => {
    if (stopped || saving || revision === savedRevision || !canFlushAutosave()) return;
    const pending = revision;
    saving = true;
    urgentSave = false;
    try {
      const written = await writeAutosave(true);
      // A queued writer may have become busy or disabled before its turn.
      if (!written && !canFlushAutosave()) { urgentSave = true; return; }
      savedRevision = Math.max(savedRevision, pending);
    } catch (err) {
      console.warn('[autosave] failed:', err);
    } finally {
      saving = false;
      syncUnloadGuard();
      if (urgentSave) void flush();
    }
  };
  const markDirty = (checkpoint = false) => {
    revision++;
    if (checkpoint && usePrefsStore.getState().general.autosave && !useHistoryStore.getState().isRestoring) {
      checkpointRevision = revision;
      urgentSave = true;
      syncUnloadGuard();
    }
    if (savedRevision === 0 || checkpointRevision === revision) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void flush(), urgentSave ? 0 : 500);
    }
  };
  const onClear = () => {
    savedRevision = revision;
    urgentSave = false;
    clearTimeout(saveTimer);
    syncUnloadGuard();
  };
  clearListeners.add(onClear);
  const unsubscribePlate = usePlateStore.subscribe((state, previous) => {
    if (state.objects !== previous.objects) markDirty(state.objects.length > previous.objects.length);
    // Replace the geometry backup with the remaining settings immediately.
    if (state.objects.length === 0 && previous.objects.length > 0) {
      urgentSave = true;
      void flush();
    }
  });
  const unsubscribeApp = useAppStore.subscribe((state, previous) => {
    const configChanged = state.currentConfig !== previous.currentConfig;
    let filamentChanged = false;
    if (configChanged) {
      // System selection publishes its label before awaiting native config.
      // Checkpoint only the completed config publication, never that mixed state.
      filamentChanged = state.selectedFilaments.length !== completedFilaments.length ||
        state.selectedFilaments.some((name, slot) => name !== completedFilaments[slot]);
      if (filamentChanged) completedFilaments = [...state.selectedFilaments];
    }
    const imported = previous.isModelLoading && !state.isModelLoading && usePlateStore.getState().objects.length > 0;
    if (configChanged || imported) markDirty(filamentChanged || imported);
    if (urgentSave) void flush();
  });
  const unsubscribePlates = usePlatesStore.subscribe((state, previous) => {
    if (state.plates !== previous.plates || state.activePlateIndex !== previous.activePlateIndex) markDirty();
  });
  const unsubscribeHistory = useHistoryStore.subscribe((state, previous) => {
    if (state.currentSnapshot !== previous.currentSnapshot) markDirty();
    syncUnloadGuard();
    if (urgentSave) void flush();
  });
  const unsubscribePreview = usePreviewStore.subscribe((state, previous) => {
    if (state.viewType === previous.viewType || revision === savedRevision) return;
    // previewStore persists the choice synchronously; flush only pending project edits.
    urgentSave = true;
    void flush();
  });
  // Changes may arrive between engine readiness and the asynchronous recovery lookup finishing.
  if (captureAutosaveBaseline() !== baseline) markDirty();
  const period = () => intervalMs ?? Math.max(5, Math.min(3600, usePrefsStore.getState().general.autosaveIntervalSeconds || 60)) * 1000;
  let timer = setInterval(() => void flush(), period());
  const unsubscribePrefs = usePrefsStore.subscribe((state, previous) => {
    syncUnloadGuard();
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
    syncUnloadGuard();
    clearListeners.delete(onClear);
    clearInterval(timer);
    clearTimeout(saveTimer);
    unsubscribePlate(); unsubscribeApp(); unsubscribePlates(); unsubscribeHistory(); unsubscribePreview(); unsubscribePrefs();
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onPageHide);
  };
}

// Test hook, like the other stores exposed on window.
if (typeof window !== 'undefined') (window as any).__autosave = { writeAutosave, readAutosave, clearAutosave };
