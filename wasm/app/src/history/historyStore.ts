/**
 * @file historyStore.ts
 * Zustand state store providing serialized Undo/Redo transaction management
 * for OrcaSlicer Web.
 */

import { create } from 'zustand';
import { getEngine, getConfig, selectPresets, evaluateRules } from '../engine/orcaEngine';
import { usePlateStore } from '../plate/plateStore';
import { useObjectListStore } from '../objectlist/objectListStore';
import { usePaintingStore } from '../painting/paintingStore';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import type { PlateObject } from '../plate/types';
import type {
  HistorySnapshot,
  HistoryStoreState,
  HistorySelection,
  HistoryPaintState,
  HistoryPlateState,
  HistorySettingsState
} from './types';

const MAX_SLOTS = 20;
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB bound
let nextSnapshotSeq = 0;

// Set of available slot indices [0 .. MAX_SLOTS - 1] for MEMFS 3MF storage
const availableSlots = new Set<number>(Array.from({ length: MAX_SLOTS }, (_, i) => i));

function allocateSlot(): number {
  if (availableSlots.size > 0) {
    const slot = availableSlots.values().next().value as number;
    availableSlots.delete(slot);
    return slot;
  }
  throw new Error('No free history snapshot slot');
}

function releaseSlot(slot: number | undefined): void {
  if (slot !== undefined && slot >= 0 && slot < MAX_SLOTS) {
    availableSlots.add(slot);
  }
}

function estimateMeshBytes(): number {
  const meshCache = usePlateStore.getState().meshCache;
  let total = 0;
  for (const mesh of meshCache.values()) {
    if (mesh.positions) total += mesh.positions.byteLength;
    if (mesh.indices) total += mesh.indices.byteLength;
  }
  // Realistic estimation: compressed 3MF zip is ~45% of uncompressed buffers + zip overhead
  return Math.max(16 * 1024, Math.round(total * 0.45) + 32 * 1024);
}

// Single mutex lock ensuring serialized transaction boundary
let lockPromise = Promise.resolve<any>(undefined);

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lockPromise.then(fn, fn);
  lockPromise = next.then(
    () => {},
    () => {}
  );
  return next;
}

export function capturePlateState(): HistoryPlateState {
  const platesStore = usePlatesStore.getState();
  return {
    plates: platesStore.plates.map((p) => ({
      index: p.index,
      name: p.name,
      locked: !!p.locked,
      config: { ...p.config },
      filamentMaps: p.filamentMaps ? [...p.filamentMaps] : undefined
    })),
    activePlateIndex: platesStore.activePlateIndex
  };
}

function captureSettingsState(): HistorySettingsState {
  const app = useAppStore.getState();
  // Effective overrides include saved web preset values, which the native
  // engine cannot recover by selecting their system parent alone.
  const options: Record<string, string> = {
    ...app.processOverrides, ...app.filamentOverrides, ...app.printerOverrides
  };
  for (const name of app.selectedFilaments) {
    const saved = app.userPresets.find(preset => preset.kind === 'filament' && preset.name === name);
    for (const key of Object.keys(saved?.values || {})) {
      if (app.currentConfig[key] !== undefined) options[key] = app.currentConfig[key];
    }
  }
  for (const [key, value] of Object.entries(app.currentConfig)) {
    if (value !== app.presetConfig[key]) {
      options[key] = value;
    }
  }

  return {
    vendor: app.selectedVendor,
    printer: app.selectedPrinter,
    process: app.selectedProcess,
    filaments: [...app.selectedFilaments],
    activeUserPreset: {
      process: app.activeUserPreset.process,
      filament: app.activeUserPreset.filament,
      printer: app.activeUserPreset.printer
    },
    processOverrides: { ...app.processOverrides },
    filamentOverrides: { ...app.filamentOverrides },
    printerOverrides: { ...app.printerOverrides },
    presetConfig: { ...app.presetConfig },
    currentConfig: { ...app.currentConfig },
    options
  };
}

function restoreSelectionSafely(snap: HistorySnapshot, objects: PlateObject[]): void {
  const plateStore = usePlateStore.getState();
  const objStore = useObjectListStore.getState();

  if (objects.length === 0) {
    plateStore.selectObject(null, null);
    objStore.selectItem(null, null);
    return;
  }

  if (!snap.selection) {
    plateStore.selectObject(objects[0].id, objects[0].instances[0]?.id ?? null);
    objStore.selectItem(objects[0].id, null);
    return;
  }

  // 1. Try matching by object name
  const selObjName = snap.selection.objectName;
  let matchedObj = selObjName
    ? objects.find((o) => o.name === selObjName)
    : undefined;

  // 2. Fallback to index if name match failed
  if (
    !matchedObj &&
    typeof snap.selection.objectIndex === 'number' &&
    objects[snap.selection.objectIndex]
  ) {
    matchedObj = objects[snap.selection.objectIndex];
  }

  // 3. Fallback to first object
  if (!matchedObj) {
    matchedObj = objects[0];
  }

  const instId =
    typeof snap.selection.instanceIndex === 'number' &&
    matchedObj.instances[snap.selection.instanceIndex]
      ? matchedObj.instances[snap.selection.instanceIndex].id
      : (matchedObj.instances[0]?.id ?? null);

  plateStore.selectObject(matchedObj.id, instId);
  objStore.selectItem(matchedObj.id, snap.selection.volumeId ?? null);
}

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  past: [],
  future: [],
  currentSnapshot: null,
  isRestoring: false,
  canUndo: false,
  canRedo: false,
  maxSnapshots: MAX_SLOTS,
  maxBytes: MAX_BYTES,
  totalRetainedBytes: 0,

  initHistory: async () => {
    return withLock(async () => {
      // Clear and release any prior slots
      const { past, future, currentSnapshot } = get();
      for (const snap of past) releaseSlot(snap.slotId);
      for (const snap of future) releaseSlot(snap.slotId);
      if (currentSnapshot) releaseSlot(currentSnapshot.slotId);

      availableSlots.clear();
      for (let i = 0; i < MAX_SLOTS; i++) {
        availableSlots.add(i);
      }

      // Capture actual current settings and plates, not fabricated default state
      const plateState = capturePlateState();
      const settings = captureSettingsState();

      const initialSnap: HistorySnapshot = {
        id: `snap_init_${Date.now()}`,
        description: 'Initial state',
        timestamp: Date.now(),
        isEmpty: true,
        byteSize: 1024,
        selection: null,
        paintState: null,
        modelFileName: null,
        plateState,
        settings
      };

      set({
        past: [],
        future: [],
        currentSnapshot: initialSnap,
        isRestoring: false,
        canUndo: false,
        canRedo: false,
        totalRetainedBytes: 1024
      });
    });
  },

  commitTransaction: async (description: string) => {
    return withLock(async () => {
      const { isRestoring, currentSnapshot, past, future, maxSnapshots, maxBytes } = get();

      // Never record transactions during restore or active slice
      if (isRestoring || useAppStore.getState().isSlicing) {
        return;
      }

      useAppStore.getState().invalidateSlicePreview();

      const engine = await getEngine();
      if (typeof window !== 'undefined') {
        (window as any).__orcaEngine = engine;
      }
      const plateObjects = usePlateStore.getState().objects;
      const isEmpty = plateObjects.length === 0;

      // Reclaim discarded redo and the oldest history before writing a file.
      // A live snapshot's slot must never be reused while its metadata remains.
      for (const snap of future) releaseSlot(snap.slotId);
      const nextFuture: HistorySnapshot[] = [];
      const nextPast = currentSnapshot ? [...past, currentSnapshot] : [...past];
      while (!isEmpty && availableSlots.size === 0 && nextPast.length > 0) {
        releaseSlot(nextPast.shift()?.slotId);
      }

      let slotId: number | undefined;
      let filePath: string | undefined;
      let byteSize = 1024;

      if (!isEmpty) {
        try {
          slotId = allocateSlot();
          filePath = `/out/undo_slot_${slotId}.3mf`;
          await engine.call('saveProject', { path: filePath });
          byteSize = estimateMeshBytes();
        } catch (err: any) {
          console.warn('[historyStore] Failed to save project snapshot:', err);
          if (slotId !== undefined) {
            releaseSlot(slotId);
          }
          // Do not record an invalid snapshot without geometry file.
          // Maintain slot consistency: future slots were released so future must be cleared.
          const retainedBytes = nextPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0);
          set({
            past: nextPast,
            future: nextFuture,
            currentSnapshot: null,
            canUndo: nextPast.length > 0,
            canRedo: false,
            totalRetainedBytes: retainedBytes
          });
          // Some editing actions catch their own errors, so surface a failed
          // history write here as well as rejecting the transaction.
          useAppStore.setState({ engineError: `Could not save Undo snapshot: ${err instanceof Error ? err.message : String(err)}` });
          throw err;
        }
      }

      // Capture selection
      const selObjId = usePlateStore.getState().selectedObjectId;
      const selInstId = usePlateStore.getState().selectedInstanceId;
      const selVolId = useObjectListStore.getState().selectedVolumeId;
      let selection: HistorySelection | null = null;

      if (selObjId !== null && plateObjects.length > 0) {
        const objIdx = plateObjects.findIndex((o) => o.id === selObjId);
        const obj = objIdx >= 0 ? plateObjects[objIdx] : null;
        if (obj) {
          const instIdx = selInstId !== null ? obj.instances.findIndex((i) => i.id === selInstId) : 0;
          selection = {
            objectName: obj.name,
            objectIndex: objIdx,
            instanceIndex: instIdx >= 0 ? instIdx : 0,
            volumeId: selVolId ?? undefined
          };
        }
      }

      // Capture painting state
      const paintStateObj = usePaintingStore.getState();
      const paintState: HistoryPaintState | null = paintStateObj.isPaintingActive
        ? {
            isPaintingActive: true,
            paintTarget: paintStateObj.paintTarget,
            selectedVolumeId: paintStateObj.selectedVolumeId
          }
        : null;

      const plateState = capturePlateState();
      const settings = captureSettingsState();

      const newSnapshot: HistorySnapshot = {
        id: `snap_${++nextSnapshotSeq}_${Date.now()}`,
        description,
        timestamp: Date.now(),
        isEmpty,
        filePath,
        slotId,
        byteSize,
        selection,
        paintState,
        modelFileName: useAppStore.getState().modelFile?.name || null,
        plateState,
        settings
      };

      // Enforce bounds by count & total bytes
      let totalBytes = (newSnapshot.byteSize || 1024) + nextPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0);
      while ((nextPast.length >= maxSnapshots || totalBytes > maxBytes) && nextPast.length > 1) {
        const evicted = nextPast.shift();
        if (evicted) {
          releaseSlot(evicted.slotId);
          totalBytes -= evicted.byteSize || 1024;
        }
      }

      set({
        past: nextPast,
        future: nextFuture,
        currentSnapshot: newSnapshot,
        canUndo: nextPast.length > 0,
        canRedo: false,
        totalRetainedBytes: totalBytes
      });
    });
  },

  undo: async () => {
    return withLock(async () => {
      const { past, future, currentSnapshot, isRestoring } = get();
      if (past.length === 0 || isRestoring || useAppStore.getState().isSlicing) {
        return false;
      }

      set({ isRestoring: true });

      try {
        // Invalidate stale slice preview immediately
        useAppStore.getState().invalidateSlicePreview();

        // Discard any in-progress painting strokes
        usePaintingStore.getState().cancelStroke();
        usePaintingStore.getState().stopPainting();

        const targetSnap = past[past.length - 1];
        const nextPast = past.slice(0, past.length - 1);
        const nextFuture = currentSnapshot ? [currentSnapshot, ...future] : [...future];

        await restoreSnapshotInternal(targetSnap);

        const totalBytes =
          (targetSnap.byteSize || 1024) +
          nextPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0) +
          nextFuture.reduce((sum, s) => sum + (s.byteSize || 1024), 0);

        set({
          past: nextPast,
          future: nextFuture,
          currentSnapshot: targetSnap,
          isRestoring: false,
          canUndo: nextPast.length > 0,
          canRedo: nextFuture.length > 0,
          totalRetainedBytes: totalBytes
        });

        return true;
      } catch (err: any) {
        console.error('[historyStore] Failed to undo:', err);
        set({ isRestoring: false });
        return false;
      }
    });
  },

  redo: async () => {
    return withLock(async () => {
      const { past, future, currentSnapshot, isRestoring } = get();
      if (future.length === 0 || isRestoring || useAppStore.getState().isSlicing) {
        return false;
      }

      set({ isRestoring: true });

      try {
        // Invalidate stale slice preview immediately
        useAppStore.getState().invalidateSlicePreview();

        // Discard any in-progress painting strokes
        usePaintingStore.getState().cancelStroke();
        usePaintingStore.getState().stopPainting();

        const targetSnap = future[0];
        const nextFuture = future.slice(1);
        const nextPast = currentSnapshot ? [...past, currentSnapshot] : [...past];

        await restoreSnapshotInternal(targetSnap);

        const totalBytes =
          (targetSnap.byteSize || 1024) +
          nextPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0) +
          nextFuture.reduce((sum, s) => sum + (s.byteSize || 1024), 0);

        set({
          past: nextPast,
          future: nextFuture,
          currentSnapshot: targetSnap,
          isRestoring: false,
          canUndo: nextPast.length > 0,
          canRedo: nextFuture.length > 0,
          totalRetainedBytes: totalBytes
        });

        return true;
      } catch (err: any) {
        console.error('[historyStore] Failed to redo:', err);
        set({ isRestoring: false });
        return false;
      }
    });
  },

  clearHistory: () => {
    const { past, future, currentSnapshot } = get();
    for (const snap of past) releaseSlot(snap.slotId);
    for (const snap of future) releaseSlot(snap.slotId);
    if (currentSnapshot) releaseSlot(currentSnapshot.slotId);
    set({
      past: [],
      future: [],
      currentSnapshot: null,
      canUndo: false,
      canRedo: false,
      totalRetainedBytes: 0
    });
  }
}));

export async function restorePlatesOnEmptyCanvas(engine: any, plateState?: HistoryPlateState): Promise<void> {
  const targetPlates = plateState?.plates && plateState.plates.length > 0
    ? plateState.plates
    : [{ index: 0, name: 'Plate 1', locked: false, config: {} }];
  const targetActiveIndex = plateState?.activePlateIndex ?? 0;

  try {
    // 1. Add temporary plate so we can delete all prior plates down to 1
    // (PlateOps throws if deleting the only plate).
    await engine.call('addPlate', { name: '__history_tmp__' });

    let platesRaw: any = await engine.call('listPlates', {});
    let currentCount = Array.isArray(platesRaw) ? platesRaw.length : 1;

    // Delete all older plates
    while (currentCount > 1) {
      await engine.call('deletePlate', { plateIndex: 0, deleteObjects: false });
      currentCount--;
    }

    // Now plate 0 is fresh. Configure it with targetPlates[0]
    const p0 = targetPlates[0];
    await engine.call('setPlateConfig', {
      plateIndex: 0,
      name: p0.name,
      locked: !!p0.locked,
      config: p0.config || {}
    });

    // Add any remaining target plates
    for (let i = 1; i < targetPlates.length; i++) {
      const p = targetPlates[i];
      await engine.call('addPlate', {
        name: p.name,
        config: p.config || {}
      });
      if (p.locked) {
        await engine.call('setPlateConfig', {
          plateIndex: i,
          locked: true
        });
      }
    }

    await usePlatesStore.getState().fetchPlates();
    usePlatesStore.getState().setActivePlate(Math.min(targetActiveIndex, targetPlates.length - 1));
  } catch (err) {
    throw err;
  }
}

async function restoreSettingsOnEmptyCanvas(engine: any, settings?: HistorySettingsState): Promise<void> {
  if (!settings) return;

  try {
    const app = useAppStore.getState();
    const needPresetSelect =
      (settings.printer && settings.printer !== app.selectedPrinter) ||
      (settings.process && settings.process !== app.selectedProcess) ||
      (settings.filaments && JSON.stringify(settings.filaments) !== JSON.stringify(app.selectedFilaments));

    if (needPresetSelect && settings.printer && settings.process) {
      const systemName = (kind: 'printer' | 'process' | 'filament', name: string) =>
        app.userPresets.find(preset => preset.kind === kind && preset.name === name)?.inherits || name;
      await selectPresets({
        printer: systemName('printer', settings.printer),
        process: systemName('process', settings.process),
        filaments: (settings.filaments.length > 0 ? settings.filaments : app.selectedFilaments)
          .map(name => systemName('filament', name))
      });
    }

    // Reset native option overrides
    await engine.call('resetOptions', {});

    // Reapply modified options from snapshot
    if (settings.options && Object.keys(settings.options).length > 0) {
      await engine.call('setOptions', { options: settings.options });
    }

    const effectiveConfig = await getConfig();

    const userName = (kind: 'printer' | 'process' | 'filament', name: string) =>
      app.userPresets.some((p) => p.kind === kind && p.name === name) ? name : null;

    const filaments = settings.filaments && settings.filaments.length > 0
      ? settings.filaments
      : app.selectedFilaments;
    const printer = settings.printer || app.selectedPrinter;
    const process = settings.process || app.selectedProcess;

    useAppStore.setState({
      currentConfig: effectiveConfig,
      presetConfig: settings.presetConfig || effectiveConfig,
      selectedVendor: settings.vendor || app.selectedVendor,
      selectedPrinter: printer,
      selectedProcess: process,
      selectedFilaments: [...filaments],
      selectedFilament: filaments[0] || app.selectedFilament,
      activeUserPreset: {
        printer: settings.activeUserPreset?.printer ?? userName('printer', printer),
        process: settings.activeUserPreset?.process ?? userName('process', process),
        filament: settings.activeUserPreset?.filament ?? userName('filament', filaments[0] || app.selectedFilament)
      },
      processOverrides: { ...(settings.processOverrides || {}) },
      filamentOverrides: { ...(settings.filamentOverrides || {}) },
      printerOverrides: { ...(settings.printerOverrides || {}) }
    });

    try {
      const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: useAppStore.getState().activeFilamentSlot || 0 });
      if (rulesRes) {
        useAppStore.setState((s) => ({
          rulesState: {
            fields: { ...s.rulesState.fields, ...rulesRes.fields },
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        }));
      }
    } catch (_) {}
  } catch (err) {
    throw err;
  }
}

async function restoreSnapshotInternal(snap: HistorySnapshot): Promise<void> {
  const engine = await getEngine();

  // Clear mesh cache in plate store since C++ object IDs will be re-assigned
  usePlateStore.setState({ meshCache: new Map() });

  if (snap.isEmpty) {
    // Delete all current objects in engine
    let currentObjs: any[] = [];
    try {
      if (typeof (engine as any).listObjects === 'function') {
        currentObjs = await (engine as any).listObjects();
      } else {
        currentObjs = await engine.call('listObjects', {});
      }
    } catch (_) {}

    for (const obj of currentObjs) {
      try {
        if (typeof (engine as any).deleteObject === 'function') {
          await (engine as any).deleteObject(obj.id);
        } else {
          await engine.call('deleteObject', { objectId: obj.id });
        }
      } catch (_) {}
    }

    usePlateStore.setState({ objects: [], selectedObjectId: null, selectedInstanceId: null });
    useObjectListStore.setState({ objects: [], selectedObjectId: null, selectedVolumeId: null });
    useAppStore.setState({ modelFile: null, modelObjects: null });

    // Empty projects have no 3MF geometry, so restore their captured metadata.
    await restorePlatesOnEmptyCanvas(engine, snap.plateState);
    await restoreSettingsOnEmptyCanvas(engine, snap.settings);
  } else if (snap.filePath) {
    // Restore from saved 3MF project
    const openRes = await engine.call('openProject', { path: snap.filePath });

    // openProject resets native config and clears options_override.
    // Reapply modified options from snapshot to ensure native options_override matches.
    if (snap.settings?.options && Object.keys(snap.settings.options).length > 0) {
      await engine.call('setOptions', { options: snap.settings.options });
    }

    const effectiveConfig = await getConfig();
    const state = useAppStore.getState();

    const userName = (kind: 'printer' | 'process' | 'filament', name: string) =>
      state.userPresets.some((p) => p.kind === kind && p.name === name) ? name : null;

    if (snap.settings) {
      const settings = snap.settings;
      const filaments = (settings.filaments && settings.filaments.length > 0)
        ? settings.filaments
        : (openRes?.selectedPresets?.filaments || state.selectedFilaments);
      const printer = settings.printer || openRes?.selectedPresets?.printer || state.selectedPrinter;
      const process = settings.process || openRes?.selectedPresets?.process || state.selectedProcess;

      useAppStore.setState({
        currentConfig: effectiveConfig,
        presetConfig: settings.presetConfig || state.presetConfig,
        selectedVendor: settings.vendor || state.selectedVendor,
        selectedPrinter: printer,
        selectedProcess: process,
        selectedFilaments: Array.isArray(filaments) ? [...filaments] : [filaments],
        selectedFilament: Array.isArray(filaments) ? (filaments[0] || state.selectedFilament) : filaments,
        activeUserPreset: {
          printer: settings.activeUserPreset?.printer ?? userName('printer', printer),
          process: settings.activeUserPreset?.process ?? userName('process', process),
          filament: settings.activeUserPreset?.filament ?? userName('filament', Array.isArray(filaments) ? filaments[0] : filaments)
        },
        processOverrides: { ...(settings.processOverrides || {}) },
        filamentOverrides: { ...(settings.filamentOverrides || {}) },
        printerOverrides: { ...(settings.printerOverrides || {}) }
      });
    } else {
      // Fallback if older snapshot has no settings
      useAppStore.setState({ currentConfig: effectiveConfig });
    }

    try {
      const rulesRes = await evaluateRules({ kind: 'print', filamentIndex: useAppStore.getState().activeFilamentSlot || 0 });
      if (rulesRes) {
        useAppStore.setState((s) => ({
          rulesState: {
            fields: { ...s.rulesState.fields, ...rulesRes.fields },
            fixes: rulesRes.fixes || [],
            messages: rulesRes.messages || []
          }
        }));
      }
    } catch (_) {}
  } else {
    throw new Error(`Snapshot ${snap.id} has no valid geometry file to restore`);
  }

  // Refresh plate store & object list store from engine
  const refreshedObjects = await usePlateStore.getState().refreshObjects();
  await useObjectListStore.getState().refreshTree();

  try {
    await usePlatesStore.getState().fetchPlates();
  } catch (_) {}

  // Restore activePlateIndex if captured
  if (snap.plateState?.activePlateIndex !== undefined) {
    usePlatesStore.getState().setActivePlate(snap.plateState.activePlateIndex);
  }

  // Update appStore modelFile if restored
  if (!snap.isEmpty) {
    if (snap.modelFileName) {
      useAppStore.setState({
        modelFile: { name: snap.modelFileName, size: snap.byteSize }
      });
    }
  }

  // Safe selection restoration
  restoreSelectionSafely(snap, refreshedObjects);

  // Restore painting mode if it was active
  if (snap.paintState?.isPaintingActive && refreshedObjects.length > 0) {
    const targetName = snap.selection?.objectName;
    const targetObj = targetName
      ? refreshedObjects.find((o) => o.name === targetName)
      : refreshedObjects[0];

    if (targetObj) {
      try {
        await usePaintingStore.getState().startPainting(targetObj.id, snap.paintState.selectedVolumeId);
        if (snap.paintState.paintTarget) {
          await usePaintingStore.getState().setPaintTarget(snap.paintState.paintTarget);
        }
      } catch (err) {
        console.warn('[historyStore] Failed to restore painting mode:', err);
      }
    }
  } else {
    usePaintingStore.getState().stopPainting();
  }
}

// Global debug exposure for tests
if (typeof window !== 'undefined') {
  (window as any).__historyStore = useHistoryStore;
  getEngine().then((eng) => {
    (window as any).__orcaEngine = eng;
  }).catch(() => {});
}
