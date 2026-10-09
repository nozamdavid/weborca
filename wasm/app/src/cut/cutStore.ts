/**
 * @file cutStore.ts
 * Zustand state store for Planar Cutting and Cut Connectors tool panel.
 */

import { create } from 'zustand';
import { cutObject, cutObjectWithConnectors } from './cutApi';
import type {
  CutConnectorAttrs,
  CutConnectorDef,
  CutPlane,
  CutResult,
  KeepMode,
  CoordinateSystem
} from './types';

let operationSeq = 0;

export interface CutStoreState {
  isCutActive: boolean;
  selectedObjectId: number | null;
  z: number;
  zMin: number;
  zMax: number;
  coordinateSystem: CoordinateSystem;
  keepUpper: boolean;
  keepLower: boolean;
  keepAsParts: boolean;
  placeOnCutUpper: boolean;
  placeOnCutLower: boolean;
  flipUpper: boolean;
  flipLower: boolean;
  flipPlane: boolean;
  keepPaint: boolean;

  connectors: CutConnectorDef[];
  selectedConnectorIndex: number | null;
  defaultAttrs: CutConnectorAttrs;

  isCutting: boolean;
  lastResult: CutResult | null;
  error: string | null;

  // Actions
  openCut: (objectId: number, zMin?: number, zMax?: number, initialZ?: number) => void;
  closeCut: () => void;
  setZ: (z: number) => void;
  setKeepUpper: (keep: boolean) => void;
  setKeepLower: (keep: boolean) => void;
  setKeepMode: (mode: KeepMode) => void;
  setKeepAsParts: (asParts: boolean) => void;
  setPlaceOnCutUpper: (val: boolean) => void;
  setPlaceOnCutLower: (val: boolean) => void;
  setFlipUpper: (val: boolean) => void;
  setFlipLower: (val: boolean) => void;
  toggleFlipPlane: () => void;
  setKeepPaint: (val: boolean) => void;

  addConnector: (pos?: [number, number, number], attrs?: Partial<CutConnectorAttrs>) => void;
  removeConnector: (index: number) => void;
  updateConnector: (index: number, patch: Partial<CutConnectorDef>) => void;
  updateConnectorAttrs: (index: number, patch: Partial<CutConnectorAttrs>) => void;
  updateDefaultAttrs: (patch: Partial<CutConnectorAttrs>) => void;
  clearConnectors: () => void;
  selectConnector: (index: number | null) => void;

  performCut: () => Promise<CutResult | null>;
}

export const useCutStore = create<CutStoreState>((set, get) => ({
  isCutActive: false,
  selectedObjectId: null,
  z: 10.0,
  zMin: 0.0,
  zMax: 50.0,
  coordinateSystem: 'world',
  keepUpper: true,
  keepLower: true,
  keepAsParts: false,
  placeOnCutUpper: false,
  placeOnCutLower: false,
  flipUpper: false,
  flipLower: false,
  flipPlane: false,
  keepPaint: true,

  connectors: [],
  selectedConnectorIndex: null,
  defaultAttrs: {
    type: 'plug',
    style: 'prism',
    shape: 'circle',
    size: 3.0,
    depthRatio: 4.0,
    rotationDeg: 0.0,
    tolerance: 0.1,
    targetHalf: 'upper'
  },

  isCutting: false,
  lastResult: null,
  error: null,

  openCut: (objectId: number, zMin = 0.0, zMax = 50.0, initialZ) => {
    operationSeq++;
    const defaultZ = initialZ ?? (zMin + zMax) / 2.0;
    set({
      isCutActive: true,
      selectedObjectId: objectId,
      z: defaultZ,
      zMin,
      zMax,
      keepUpper: true,
      keepLower: true,
      keepAsParts: false,
      connectors: [],
      selectedConnectorIndex: null,
      lastResult: null,
      error: null
    });
    // Asynchronously ensure instance rests on print bed so world coordinates match
    void (async () => {
      try {
        const { usePlateStore } = await import('../plate/plateStore');
        const plateStore = usePlateStore.getState();
        const obj = plateStore.objects.find((o) => o.id === objectId);
        if (obj && obj.instances.length > 0) {
          const inst = obj.instances[0];
          const { getEngine } = await import('../engine/orcaEngine');
          const eng = await getEngine();
          if (typeof (eng as any).setInstanceTransform === 'function') {
            await (eng as any).setInstanceTransform({ objectId, instanceId: inst.id });
          } else {
            await eng.call('setInstanceTransform', { objectId, instanceId: inst.id });
          }
        }
      } catch (_) {}
    })();
  },

  closeCut: () => {
    operationSeq++;
    set({
      isCutActive: false,
      selectedObjectId: null,
      connectors: [],
      selectedConnectorIndex: null,
      isCutting: false,
      error: null
    });
  },

  setZ: (z: number) => {
    set((state) => {
      // Synchronize existing connectors to the new cut plane height
      const updatedConnectors = state.connectors.map((c) => ({
        ...c,
        pos: [c.pos[0], c.pos[1], z] as [number, number, number]
      }));
      return { z, connectors: updatedConnectors };
    });
  },

  setKeepUpper: (keepUpper: boolean) => {
    const { connectors } = get();
    if (connectors.length > 0 && !keepUpper) {
      set({ error: 'Connectors require keeping both upper and lower halves' });
      return;
    }
    set({ keepUpper, error: null });
  },

  setKeepLower: (keepLower: boolean) => {
    const { connectors } = get();
    if (connectors.length > 0 && !keepLower) {
      set({ error: 'Connectors require keeping both upper and lower halves' });
      return;
    }
    set({ keepLower, error: null });
  },

  setKeepMode: (mode: KeepMode) => {
    const { connectors } = get();
    if (connectors.length > 0 && mode !== 'both') {
      set({ error: 'Connectors require keeping both halves' });
      return;
    }
    if (mode === 'upper') {
      set({ keepUpper: true, keepLower: false, error: null });
    } else if (mode === 'lower') {
      set({ keepUpper: false, keepLower: true, error: null });
    } else {
      set({ keepUpper: true, keepLower: true, error: null });
    }
  },

  setKeepAsParts: (keepAsParts: boolean) => {
    const { connectors } = get();
    if (connectors.length > 0 && keepAsParts) {
      set({ error: 'Connectors require keeping both halves as separate objects' });
      return;
    }
    set({ keepAsParts, error: null });
  },

  setPlaceOnCutUpper: (placeOnCutUpper: boolean) => set({ placeOnCutUpper }),

  setPlaceOnCutLower: (placeOnCutLower: boolean) => set({ placeOnCutLower }),

  setFlipUpper: (flipUpper: boolean) => set({ flipUpper }),

  setFlipLower: (flipLower: boolean) => set({ flipLower }),

  toggleFlipPlane: () => set((state) => ({ flipPlane: !state.flipPlane })),

  setKeepPaint: (keepPaint: boolean) => set({ keepPaint }),

  addConnector: (pos, attrs) => {
    const state = get();
    const currentZ = state.z;
    const instOffset = (typeof window !== "undefined" && (window as any).__plateStore)?.getState()?.objects?.find((o: any) => o.id === state.selectedObjectId)?.instances?.[0]?.offset;
    const connectorPos: [number, number, number] = pos ?? (instOffset ? [instOffset[0], instOffset[1], currentZ] : [0.0, 0.0, currentZ]);

    const mergedAttrs: CutConnectorAttrs = {
      ...state.defaultAttrs,
      ...(attrs ?? {})
    };

    // Snap connectors strictly require prism style, circle shape, and lower targetHalf
    if (mergedAttrs.type === 'snap') {
      mergedAttrs.style = 'prism';
      mergedAttrs.shape = 'circle';
      mergedAttrs.targetHalf = 'lower';
    }

    const newDef: CutConnectorDef = {
      id: `conn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      pos: connectorPos,
      attrs: mergedAttrs
    };

    // Adding connectors enforces keeping both halves as separate objects
    set((s) => ({
      connectors: [...s.connectors, newDef],
      selectedConnectorIndex: s.connectors.length,
      keepUpper: true,
      keepLower: true,
      keepAsParts: false,
      error: null
    }));
  },

  removeConnector: (index: number) => {
    set((state) => {
      const updated = state.connectors.filter((_, i) => i !== index);
      let nextSelected: number | null = state.selectedConnectorIndex;
      if (nextSelected !== null) {
        if (nextSelected === index) {
          nextSelected = updated.length > 0 ? Math.min(index, updated.length - 1) : null;
        } else if (nextSelected > index) {
          nextSelected -= 1;
        }
      }
      return {
        connectors: updated,
        selectedConnectorIndex: nextSelected
      };
    });
  },

  updateConnector: (index: number, patch: Partial<CutConnectorDef>) => {
    set((state) => {
      if (index < 0 || index >= state.connectors.length) return state;
      const updated = [...state.connectors];
      const existing = updated[index];
      const mergedAttrs: CutConnectorAttrs = {
        ...existing.attrs,
        ...(patch.attrs ?? {})
      };
      if (mergedAttrs.type === 'snap') {
        mergedAttrs.style = 'prism';
        mergedAttrs.shape = 'circle';
        mergedAttrs.targetHalf = 'lower';
      }
      updated[index] = {
        ...existing,
        ...patch,
        attrs: mergedAttrs
      };
      return { connectors: updated };
    });
  },

  updateConnectorAttrs: (index: number, patch: Partial<CutConnectorAttrs>) => {
    set((state) => {
      if (index < 0 || index >= state.connectors.length) return state;
      const updated = [...state.connectors];
      const mergedAttrs: CutConnectorAttrs = {
        ...updated[index].attrs,
        ...patch
      };
      if (mergedAttrs.type === 'snap') {
        mergedAttrs.style = 'prism';
        mergedAttrs.shape = 'circle';
        mergedAttrs.targetHalf = 'lower';
      }
      updated[index] = {
        ...updated[index],
        attrs: mergedAttrs
      };
      return { connectors: updated };
    });
  },

  updateDefaultAttrs: (patch: Partial<CutConnectorAttrs>) => {
    set((state) => {
      const next: CutConnectorAttrs = {
        ...state.defaultAttrs,
        ...patch
      };
      if (next.type === 'snap') {
        next.style = 'prism';
        next.shape = 'circle';
        next.targetHalf = 'lower';
      }
      return { defaultAttrs: next };
    });
  },

  clearConnectors: () => set({ connectors: [], selectedConnectorIndex: null }),

  selectConnector: (index: number | null) => set({ selectedConnectorIndex: index }),

  performCut: async () => {
    // 1. History restore safety guard & serialize/block conflicting destructive actions
    try {
      const { useHistoryStore } = await import('../history/historyStore');
      if (useHistoryStore.getState().isRestoring) return null;
    } catch (_) {}

    if (get().isCutting) return null;
    try {
      const { useRepairStore } = await import('../repair/repairStore');
      if (useRepairStore.getState().isRepairing) return null;
    } catch (_) {}

    const state = get();
    if (!state.selectedObjectId) {
      set({ error: 'No object selected for cut' });
      return null;
    }

    // Safely end text tool to avoid uncommitted text mutations
    try {
      const { useTextStore } = await import('../text');
      await useTextStore.getState().close();
    } catch (_) {}

    const hasConnectors = state.connectors.length > 0;

    // Validate keep modes and halves
    if (hasConnectors) {
      if (state.keepAsParts) {
        set({ error: 'Connectors require keeping both halves as separate objects' });
        return null;
      }
      if (!state.keepUpper || !state.keepLower) {
        set({ error: 'Connectors require keeping both upper and lower halves' });
        return null;
      }
      for (const conn of state.connectors) {
        const t = conn.attrs?.type || 'plug';
        if (t === 'snap') {
          const st = conn.attrs?.style || 'prism';
          const sh = conn.attrs?.shape || 'circle';
          const th = conn.attrs?.targetHalf || 'lower';
          if (st !== 'prism' || sh !== 'circle' || th !== 'lower') {
            set({ error: 'Snap connector requires prism style, circle shape, and lower targetHalf' });
            return null;
          }
        }
      }
    } else {
      if (!state.keepUpper && !state.keepLower) {
        set({ error: 'At least one half must be kept' });
        return null;
      }
    }

    const opId = ++operationSeq;
    const targetObjId = state.selectedObjectId;
    set({ isCutting: true, error: null });

    try {
      // Ensure target instance rests on print bed so world Z aligns with plate height
      try {
        const { usePlateStore } = await import('../plate/plateStore');
        const plateStore = usePlateStore.getState();
        const obj = plateStore.objects.find((o) => o.id === targetObjId);
        if (obj && obj.instances.length > 0) {
          const inst = obj.instances[0];
          const { getEngine } = await import('../engine/orcaEngine');
          const eng = await getEngine();
          if (typeof (eng as any).setInstanceTransform === 'function') {
            await (eng as any).setInstanceTransform({ objectId: targetObjId, instanceId: inst.id });
          } else {
            await eng.call('setInstanceTransform', { objectId: targetObjId, instanceId: inst.id });
          }
        }
      } catch (_) {}

      let plane: CutPlane | undefined;
      if (state.flipPlane) {
        plane = {
          point: [0.0, 0.0, state.z],
          normal: [0.0, 0.0, -1.0]
        };
      }

      const baseParams = {
        objectId: targetObjId,
        z: plane ? undefined : state.z,
        plane,
        coordinateSystem: state.coordinateSystem,
        keepUpper: state.keepUpper,
        keepLower: state.keepLower,
        keepAsParts: state.keepAsParts,
        placeOnCutUpper: state.placeOnCutUpper,
        placeOnCutLower: state.placeOnCutLower,
        flipUpper: state.flipUpper,
        flipLower: state.flipLower,
        keepPaint: state.keepPaint
      };

      // Ensure connector coordinates are exactly on the cut plane
      const connectorsOnPlane: CutConnectorDef[] = state.connectors.map((c) => ({
        ...c,
        pos: [c.pos[0], c.pos[1], state.z] as [number, number, number]
      }));

      let result: CutResult;
      if (hasConnectors) {
        result = await cutObjectWithConnectors({
          ...baseParams,
          connectors: connectorsOnPlane
        });
      } else {
        result = await cutObject(baseParams);
      }

      if (!result.success) {
        // Atomic failure: model and scene remain completely untouched
        set({
          isCutting: false,
          error: result.error ?? 'Cut failed',
          lastResult: result
        });
        return result;
      }

      // Success mutation: Original targetObjId was replaced upstream by new objects
      // 1. Invalidate meshCache in plate store for deleted object
      let newObjects: any[] = [];
      try {
        const { usePlateStore } = await import('../plate/plateStore');
        const plateStore = usePlateStore.getState();
        plateStore.meshCache.delete(targetObjId);
        usePlateStore.setState({ meshCache: new Map(plateStore.meshCache) });

        newObjects = await plateStore.refreshObjects();

        // Check selection: reconcile without stealing
        const currentSelected = plateStore.selectedObjectId;
        const isTargetStillSelected = currentSelected === targetObjId || currentSelected === null;
        const firstCreated = result.createdObjects?.[0];

        if (isTargetStillSelected) {
          if (firstCreated) {
            const matchingObj = newObjects.find((o) => o.id === firstCreated.id);
            const firstInstId = matchingObj?.instances[0]?.id ?? null;
            plateStore.selectObject(firstCreated.id, firstInstId);

            const { useObjectListStore } = await import('../objectlist/objectListStore');
            useObjectListStore.getState().selectItem(firstCreated.id, null);
          } else {
            plateStore.selectObject(null, null);
          }
        }
        // If currentSelected !== targetObjId && currentSelected !== null:
        // User switched target during cut RPC. Keep currentSelected, do not steal selection!
      } catch (_) {}

      // 2. Refresh object tree in object list store
      try {
        const { useObjectListStore } = await import('../objectlist/objectListStore');
        await useObjectListStore.getState().refreshTree();
      } catch (_) {}

      // 3. Commit transaction to history store if not restoring and created objects exist in engine
      try {
        const { useHistoryStore } = await import('../history/historyStore');
        const isRestoring = useHistoryStore.getState().isRestoring;
        if (!isRestoring) {
          const createdStillPresent = result.createdObjects?.every((co) =>
            newObjects.some((no) => no.id === co.id)
          );
          if (createdStillPresent) {
            await useHistoryStore.getState().commitTransaction(
              hasConnectors ? 'Cut object with connectors' : 'Cut object'
            );
          }
        }
      } catch (_) {}

      if (opId === operationSeq && get().isCutActive) {
        set({
          isCutting: false,
          lastResult: result,
          selectedObjectId: result.createdObjects?.[0]?.id ?? null,
          error: null
        });
      } else {
        set({ isCutting: false });
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ isCutting: false, error: msg });
      return null;
    }
  }
}));

if (typeof window !== 'undefined') {
  (window as any).__cutStore = useCutStore;
}
