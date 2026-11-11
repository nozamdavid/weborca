/**
 * @file historyStore.ts
 * Zustand state store providing serialized Undo/Redo transaction management
 * for OrcaSlicer Web.
 */

import { create } from 'zustand';
import { effectivePreset } from '../presets/effectivePreset';
import { getEngine, getConfig, selectPresets, evaluateRules } from '../engine/orcaEngine';
import { usePlateStore } from '../plate/plateStore';
import { useObjectListStore } from '../objectlist/objectListStore';
import { usePaintingStore } from '../painting/paintingStore';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import type { PlateObject } from '../plate/types';
import type { InstanceRef } from '../plate/plateStore';
import type {
  HistoryInstanceSelection,
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
// Failed truncations remain owned here and cannot be reused until cleanup succeeds.
const retiredSlots = new Set<number>();

function allocateSlot(): number {
  if (availableSlots.size > 0) {
    const slot = availableSlots.values().next().value as number;
    availableSlots.delete(slot);
    return slot;
  }
  throw new Error('No free history snapshot slot');
}

async function releaseSlot(slot: number | undefined, engine: Awaited<ReturnType<typeof getEngine>>): Promise<boolean> {
  if (slot === undefined || !Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) return true;
  availableSlots.delete(slot);
  retiredSlots.add(slot);

  // Remove references before truncation, including when only part of a cleanup succeeds.
  useHistoryStore.setState((state) => {
    const past = state.past.filter((snap) => snap.slotId !== slot);
    const future = state.future.filter((snap) => snap.slotId !== slot);
    const currentSnapshot = state.currentSnapshot?.slotId === slot ? null : state.currentSnapshot;
    const retained = [...past, ...future, ...(currentSnapshot ? [currentSnapshot] : [])];
    return {
      past, future, currentSnapshot,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      totalRetainedBytes: retained.reduce((sum, snap) => sum + (snap.byteSize || 1024), 0)
    };
  });
  try {
    // These are the only files history owns. Empty writes release MEMFS backing storage.
    await engine.writeFile(`/out/undo_slot_${slot}.3mf`, new Uint8Array());
  } catch (err) {
    console.warn(`[historyStore] Failed to release Undo slot ${slot}:`, err);
    return false;
  }
  retiredSlots.delete(slot);
  availableSlots.add(slot);
  return true;
}

async function releaseSnapshots(snapshots: Array<HistorySnapshot | null>): Promise<void> {
  const slots = new Set(retiredSlots);
  for (const snap of snapshots) if (snap?.slotId !== undefined) slots.add(snap.slotId);
  if (slots.size === 0) return;
  const engine = await getEngine();
  for (const slot of slots) await releaseSlot(slot, engine);
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

function captureInstanceIdentities(objects: PlateObject[]): HistoryInstanceSelection[] {
  const { selectedObjectId, selectedInstanceId, extraSelection } = usePlateStore.getState();
  if (selectedObjectId === null || selectedInstanceId === null) return [];

  const seen = new Set<string>();
  const identities: HistoryInstanceSelection[] = [];
  for (const ref of [{ objectId: selectedObjectId, instanceId: selectedInstanceId }, ...extraSelection]) {
    const objectIndex = objects.findIndex((o) => o.id === ref.objectId);
    if (objectIndex < 0) continue;
    const obj = objects[objectIndex];
    const instanceIndex = obj.instances.findIndex((i) => i.id === ref.instanceId);
    if (instanceIndex < 0) continue;
    const key = `${objectIndex}:${instanceIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    identities.push({ objectName: obj.name, objectIndex, instanceIndex });
  }
  return identities;
}

export function captureSelection(objects: PlateObject[]): HistorySelection | null {
  const identities = captureInstanceIdentities(objects);
  if (identities.length === 0) return null;

  const primary = identities[0];
  const obj = objects[primary.objectIndex as number];
  const { selectedVolumeId, objects: tree } = useObjectListStore.getState();
  const volumes = tree.find(item => item.id === obj.id)?.volumes ?? [];
  const volumeIndex = selectedVolumeId === null ? -1 : volumes.findIndex(v => v.id === selectedVolumeId);

  return {
    objectName: primary.objectName,
    objectIndex: primary.objectIndex,
    instanceIndex: primary.instanceIndex,
    volumeId: selectedVolumeId ?? undefined,
    volumeIndex: volumeIndex >= 0 ? volumeIndex : undefined,
    instances: identities
  };
}

function resolveObjectIdentity(identity: HistoryInstanceSelection, objects: PlateObject[]): PlateObject | undefined {
  const index = identity.objectIndex;
  const indexed = typeof index === 'number' && Number.isInteger(index) && index >= 0 ? objects[index] : undefined;
  if (indexed && (identity.objectName === undefined || indexed.name === identity.objectName)) {
    return indexed;
  }
  return identity.objectName !== undefined
    ? objects.find((o) => o.name === identity.objectName)
    : undefined;
}

function resolveInstanceRefs(selection: HistorySelection, objects: PlateObject[]): InstanceRef[] {
  const identities = selection.instances?.length
    ? selection.instances
    : [{
        objectName: selection.objectName,
        objectIndex: selection.objectIndex,
        instanceIndex: selection.instanceIndex
      }];

  const seen = new Set<string>();
  const refs: InstanceRef[] = [];
  for (const identity of identities) {
    const obj = resolveObjectIdentity(identity, objects);
    const instanceIndex = identity.instanceIndex;
    if (!obj || typeof instanceIndex !== 'number' || !Number.isInteger(instanceIndex)) continue;
    const instance = obj.instances[instanceIndex];
    if (!instance) continue;
    const key = `${obj.id}:${instance.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ objectId: obj.id, instanceId: instance.id });
  }
  return refs;
}

function resolveVolumeId(selection: HistorySelection, objectId: number): number | null {
  const volumes = useObjectListStore.getState().objects.find(obj => obj.id === objectId)?.volumes ?? [];
  if (typeof selection.volumeIndex === 'number' && Number.isInteger(selection.volumeIndex)) {
    const volume = volumes[selection.volumeIndex];
    if (volume) return volume.id;
  }
  return typeof selection.volumeId === 'number'
    ? volumes.find(v => v.id === selection.volumeId)?.id ?? null
    : null;
}

export function capturePaintState(): HistoryPaintState | null {
  const paint = usePaintingStore.getState();
  if (!paint.isPaintingActive) return null;
  const volumes = useObjectListStore.getState().objects.find(obj => obj.id === paint.selectedObjectId)?.volumes ?? [];
  const index = volumes.findIndex(volume => volume.id === paint.selectedVolumeId);
  return { isPaintingActive: true, paintTarget: paint.paintTarget, selectedVolumeId: paint.selectedVolumeId,
    volumeIndex: index >= 0 ? index : undefined };
}

export function resolvePaintVolumeId(paint: HistoryPaintState, objectId: number): number | null {
  return resolveVolumeId({ volumeIndex: paint.volumeIndex, volumeId: paint.selectedVolumeId ?? undefined }, objectId);
}

export interface RestoredHistorySelection {
  primary: InstanceRef;
  extras: InstanceRef[];
  volumeId: number | null;
}

export function restoreSelectionSafely(snap: HistorySnapshot, objects: PlateObject[]): RestoredHistorySelection | null {
  const plateStore = usePlateStore.getState();
  const objStore = useObjectListStore.getState();
  const refs = snap.selection ? resolveInstanceRefs(snap.selection, objects) : [];

  if (refs.length === 0) {
    plateStore.selectObject(null, null);
    objStore.selectItem(null, null);
    return null;
  }

  const [primary, ...extras] = refs;
  plateStore.selectObject(primary.objectId, primary.instanceId);
  for (const extra of extras) plateStore.toggleSelect(extra.objectId, extra.instanceId);

  const volumeId = resolveVolumeId(snap.selection as HistorySelection, primary.objectId);
  objStore.selectItem(primary.objectId, volumeId);
  return { primary, extras, volumeId };
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
      await releaseSnapshots([...past, ...future, currentSnapshot]);

      availableSlots.clear();
      for (let i = 0; i < MAX_SLOTS; i++) {
        if (!retiredSlots.has(i)) availableSlots.add(i);
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
      for (const snap of future) await releaseSlot(snap.slotId, engine);
      const nextFuture: HistorySnapshot[] = [];
      const nextPast = currentSnapshot ? [...past, currentSnapshot] : [...past];
      while (!isEmpty && availableSlots.size === 0 && nextPast.length > 0) {
        if (!await releaseSlot(nextPast.shift()?.slotId, engine)) break;
      }

      let slotId: number | undefined;
      let filePath: string | undefined;
      let byteSize = 1024;

      if (!isEmpty) {
        try {
          slotId = allocateSlot();
          filePath = `/out/undo_slot_${slotId}.3mf`;
          // Undo snapshots use fast compression; explicit project exports keep the default.
          await engine.call('saveProject', { path: filePath, compressionLevel: 2 });
          byteSize = estimateMeshBytes();
        } catch (err: any) {
          console.warn('[historyStore] Failed to save project snapshot:', err);
          if (slotId !== undefined) {
            await releaseSlot(slotId, engine);
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

      // Capture the primary and extra selection by snapshot identity.
      const selection = captureSelection(plateObjects);

      // Capture painting state
      const paintState = capturePaintState();

      const plateState = capturePlateState();
      const settings = captureSettingsState();
      const layerRanges = useObjectListStore.getState().objects.map((o, idx) => ({
        objectIndex: idx,
        ranges: o.layerRanges || []
      })).filter((x) => x.ranges.length > 0);

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
        settings,
        layerRanges
      };

      // Enforce bounds by count & total bytes
      let totalBytes = (newSnapshot.byteSize || 1024) + nextPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0);
      while ((nextPast.length >= maxSnapshots || totalBytes > maxBytes) && nextPast.length > 1) {
        const evicted = nextPast.shift();
        if (evicted) {
          await releaseSlot(evicted.slotId, engine);
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
    return withLock(async () => {
      const { past, future, currentSnapshot } = get();
      await releaseSnapshots([...past, ...future, currentSnapshot]);
      set({
        past: [],
        future: [],
        currentSnapshot: null,
        canUndo: false,
        canRedo: false,
        totalRetainedBytes: 0
      });
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
        effectivePreset(kind, name, app.userPresets).preset;
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
  if (snap.layerRanges) {
    const listStore = useObjectListStore.getState();
    const updated = listStore.objects.map((o, idx) => {
      const match = snap.layerRanges?.find((lr) => lr.objectIndex === idx);
      return { ...o, layerRanges: match ? match.ranges : [] };
    });
    useObjectListStore.setState({ objects: updated });
  }

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
  const restoredSelection = restoreSelectionSafely(snap, refreshedObjects);

  // Restore painting mode if it was active
  if (snap.paintState?.isPaintingActive && restoredSelection) {
    const targetObj = refreshedObjects.find((o) => o.id === restoredSelection.primary.objectId);

    if (targetObj) {
      try {
        await usePaintingStore.getState().startPainting(targetObj.id, resolvePaintVolumeId(snap.paintState, targetObj.id));
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
