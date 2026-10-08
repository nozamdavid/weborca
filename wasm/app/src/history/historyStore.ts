/**
 * @file historyStore.ts
 * Zustand state store providing serialized Undo/Redo transaction management
 * for OrcaSlicer Web.
 */

import { create } from 'zustand';
import { getEngine } from '../engine/orcaEngine';
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
  HistoryPaintState
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
  // Fallback: rotate sequence
  return (nextSnapshotSeq % MAX_SLOTS);
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
      // Clear any prior slots
      availableSlots.clear();
      for (let i = 0; i < MAX_SLOTS; i++) {
        availableSlots.add(i);
      }

      const initialSnap: HistorySnapshot = {
        id: `snap_init_${Date.now()}`,
        description: 'Initial state',
        timestamp: Date.now(),
        isEmpty: true,
        byteSize: 1024,
        selection: null,
        paintState: null,
        modelFileName: null
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

      const engine = await getEngine();
      if (typeof window !== 'undefined') {
        (window as any).__orcaEngine = engine;
      }
      const plateObjects = usePlateStore.getState().objects;
      const isEmpty = plateObjects.length === 0;

      let slotId: number | undefined;
      let filePath: string | undefined;
      let byteSize = 1024;

      if (!isEmpty) {
        slotId = allocateSlot();
        filePath = `/out/undo_slot_${slotId}.3mf`;
        try {
          await engine.call('saveProject', { path: filePath });
          byteSize = estimateMeshBytes();
        } catch (err: any) {
          console.warn('[historyStore] Failed to save project snapshot:', err);
          releaseSlot(slotId);
          slotId = undefined;
          filePath = undefined;
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
        modelFileName: useAppStore.getState().modelFile?.name || null
      };

      // Push current snapshot onto past stack
      const nextPast = [...past];
      if (currentSnapshot) {
        nextPast.push(currentSnapshot);
      }

      // Free any redo slots since edit-after-undo invalidates redo
      for (const snap of future) {
        releaseSlot(snap.slotId);
      }
      const nextFuture: HistorySnapshot[] = [];

      // Enforce bounds by count & total bytes
      let totalBytes = (newSnapshot.byteSize || 1024) + nextPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0);
      while ((nextPast.length > maxSnapshots || totalBytes > maxBytes) && nextPast.length > 1) {
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
    const { past, future } = get();
    for (const snap of past) releaseSlot(snap.slotId);
    for (const snap of future) releaseSlot(snap.slotId);
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
  } else if (snap.filePath) {
    // Restore from saved 3MF project
    await engine.call('openProject', { path: snap.filePath });
  }

  // Refresh plate store & object list store from engine
  const refreshedObjects = await usePlateStore.getState().refreshObjects();
  await useObjectListStore.getState().refreshTree();

  try {
    await usePlatesStore.getState().fetchPlates();
  } catch (_) {}

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
