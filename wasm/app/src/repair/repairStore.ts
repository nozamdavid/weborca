/**
 * @file repairStore.ts
 * Zustand store for managing mesh health inspection and CGAL mesh repair states.
 */

import { create } from 'zustand';
import { getMeshHealth, repairObject } from './repairApi';
import type { MeshHealthResult, RepairObjectResult } from './types';

let operationSeq = 0;

export interface RepairStoreState {
  selectedObjectId: number | null;
  health: MeshHealthResult | null;
  lastRepairResult: RepairObjectResult | null;
  isChecking: boolean;
  isRepairing: boolean;
  error: string | null;

  selectObject: (objectId: number | null) => Promise<void>;
  checkHealth: (objectId?: number) => Promise<MeshHealthResult | null>;
  repairSelected: (keepPainting?: boolean) => Promise<RepairObjectResult | null>;
  clearError: () => void;
  reset: () => void;
}

export const useRepairStore = create<RepairStoreState>((set, get) => ({
  selectedObjectId: null,
  health: null,
  lastRepairResult: null,
  isChecking: false,
  isRepairing: false,
  error: null,

  selectObject: async (objectId: number | null) => {
    const opId = ++operationSeq;
    set({
      selectedObjectId: objectId,
      health: null,
      lastRepairResult: null,
      error: null
    });

    if (objectId !== null) {
      await get().checkHealth(objectId);
      if (opId !== operationSeq || get().selectedObjectId !== objectId) {
        return;
      }
    }
  },

  checkHealth: async (objectId?: number) => {
    const targetId = objectId ?? get().selectedObjectId;
    if (targetId === null) return null;

    const opId = ++operationSeq;
    set({ isChecking: true, error: null });

    try {
      const result = await getMeshHealth(targetId);
      if (opId !== operationSeq || get().selectedObjectId !== targetId) {
        return result;
      }
      set({ health: result, isChecking: false });
      return result;
    } catch (err: any) {
      if (opId !== operationSeq || get().selectedObjectId !== targetId) {
        return null;
      }
      const msg = err?.message || 'Failed to check mesh health';
      set({ error: msg, isChecking: false });
      return null;
    }
  },

  repairSelected: async (keepPainting = true) => {
    // 1. History restore safety guard & serialize/block conflicting destructive actions
    try {
      const { useHistoryStore } = await import('../history/historyStore');
      if (useHistoryStore.getState().isRestoring) return null;
    } catch (_) {}

    if (get().isRepairing) return null;
    try {
      const { useCutStore } = await import('../cut/cutStore');
      if (useCutStore.getState().isCutting) return null;
    } catch (_) {}

    const targetId = get().selectedObjectId;
    if (targetId === null) {
      set({ error: 'No object selected for repair' });
      return null;
    }

    // Safely end other tools before destructive RPC, awaiting pending text rollback
    try {
      const { usePaintToolsStore } = await import('../paint-tools');
      usePaintToolsStore.getState().stopPainting();
    } catch (_) {}
    try {
      const { useLayersStore } = await import('../layers');
      useLayersStore.getState().stopEditing();
    } catch (_) {}
    try {
      const { useCutStore } = await import('../cut');
      useCutStore.getState().closeCut();
    } catch (_) {}
    try {
      const { useTextStore } = await import('../text');
      await useTextStore.getState().close();
    } catch (_) {}

    const opId = ++operationSeq;
    set({ isRepairing: true, error: null });

    try {
      // splitParts is strictly unsupported and rejected by upstream
      const result = await repairObject({
        objectId: targetId,
        keepPainting,
        splitParts: false
      });

      if (result.success) {
        // Atomic success mutation: Invalidate mesh cache in plate store for targetId
        let refreshedObjs: any[] = [];
        try {
          const { usePlateStore } = await import('../plate/plateStore');
          const plateStore = usePlateStore.getState();
          plateStore.meshCache.delete(targetId);
          usePlateStore.setState({ meshCache: new Map(plateStore.meshCache) });
          refreshedObjs = await plateStore.refreshObjects();

          // Selection reconciliation without stealing
          const currentSelected = plateStore.selectedObjectId;
          if (currentSelected === targetId || currentSelected === null) {
            plateStore.selectObject(targetId);
          }
        } catch (_) {}

        // Repaired volumes receive new IDs; refresh object list tree and preserve volume-ID integrity
        try {
          const { useObjectListStore } = await import('../objectlist/objectListStore');
          const objListStore = useObjectListStore.getState();
          const refreshedTree = await objListStore.refreshTree();

          // Preserve volume-ID integrity:
          const curVol = objListStore.selectedVolumeId;
          const curObj = objListStore.selectedObjectId;
          if (curObj === targetId && curVol !== null) {
            const targetNode = refreshedTree.find((o) => o.id === targetId);
            if (targetNode && targetNode.volumes.length > 0) {
              const isVolValid = targetNode.volumes.some((v) => v.id === curVol);
              if (!isVolValid) {
                const newVolId = result.volumes?.[0]?.volumeId ?? targetNode.volumes[0].id;
                objListStore.selectItem(targetId, newVolId);
              }
            }
          }
        } catch (_) {}

        // Commit transaction to serialized undo/redo history if engine wasn't rolled back
        try {
          const { useHistoryStore } = await import('../history/historyStore');
          const isRestoring = useHistoryStore.getState().isRestoring;
          if (!isRestoring) {
            const objectStillExists = refreshedObjs.some((o) => o.id === targetId);
            if (objectStillExists) {
              await useHistoryStore.getState().commitTransaction('Repair mesh');
            }
          }
        } catch (_) {}

        if (opId === operationSeq && get().selectedObjectId === targetId) {
          set({
            lastRepairResult: result,
            isRepairing: false
          });
          // Refresh mesh health metrics following repair
          await get().checkHealth(targetId);
        } else {
          set({ isRepairing: false });
        }
        return result;
      } else {
        // Atomic failure: model was left untouched in candidate engine copy
        const msg = result.error || 'Repair operation could not close mesh';
        if (opId === operationSeq && get().selectedObjectId === targetId) {
          set({
            error: msg,
            lastRepairResult: result,
            isRepairing: false
          });
        } else {
          set({ isRepairing: false });
        }
        return result;
      }
    } catch (err: any) {
      const msg = err?.message || 'Unexpected error during mesh repair';
      if (opId === operationSeq && get().selectedObjectId === targetId) {
        set({ error: msg, isRepairing: false });
      } else {
        set({ isRepairing: false });
      }
      return null;
    }
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    operationSeq++;
    set({
      selectedObjectId: null,
      health: null,
      lastRepairResult: null,
      isChecking: false,
      isRepairing: false,
      error: null
    });
  }
}));

if (typeof window !== 'undefined') {
  (window as any).__repairStore = useRepairStore;
}
