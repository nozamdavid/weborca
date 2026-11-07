/**
 * @file editOpsStore.ts
 * Zustand store for object-editing operations, UI dialogs, tool modes,
 * and transaction commit integration with historyStore.
 */

import { create } from 'zustand';
import * as api from './editOpsApi';
import { usePlateStore } from '../plate/plateStore';
import { useHistoryStore } from '../history/historyStore';
import { useObjectListStore } from '../objectlist/objectListStore';
import type {
  PlanarFacetCluster,
  MeshBooleanMode,
  BrimEarPoint
} from './types';

export type ActiveEditTool = 'flatten' | 'brimears' | null;
export type ActiveEditDialog = 'boolean' | 'simplify' | 'svg' | null;

// An offer threshold, not an import limit. Small meshes need no extra decision.
export const IMPORT_SIMPLIFY_TRIANGLES = 100_000;
interface ImportedMesh {
  objectId: number;
  volumeId: number;
  name: string;
  triangleCount: number;
}

export interface EditOpsState {
  activeTool: ActiveEditTool;
  activeDialog: ActiveEditDialog;
  isOperating: boolean;
  error: string | null;

  // Flatten / Place on face
  flattenObjectId: number | null;
  flattenClusters: PlanarFacetCluster[];
  isLoadingClusters: boolean;

  // Mesh Boolean
  booleanMode: MeshBooleanMode;
  booleanTargetObjectId: number | null;
  booleanToolObjectIds: number[];
  booleanKeepTools: boolean;

  // Simplify
  simplifyObjectId: number | null;
  simplifyVolumeId: number | null;
  simplifyMethod: 'ratio' | 'target';
  simplifyRatio: number;
  simplifyTargetCount: number;
  simplifyKeepPainting: boolean;
  currentTriangleCount: number;
  importedMeshes: ImportedMesh[];

  // Brim Ears
  brimEarsObjectId: number | null;
  brimRadius: number;
  brimPoints: BrimEarPoint[];

  // SVG
  svgDepth: number;
  svgText: string;
  svgFileName: string;
  svgTargetObjectId: number | null;

  // Actions
  clearError: () => void;
  autoOrient: (objectIds?: number[]) => Promise<boolean>;

  startFlatten: (objectId?: number, instanceId?: number) => Promise<void>;
  applyPlaceOnFace: (facetIndex: number) => Promise<boolean>;
  stopFlatten: () => void;

  openBooleanDialog: () => void;
  closeBooleanDialog: () => void;
  setBooleanMode: (mode: MeshBooleanMode) => void;
  setBooleanTargetObjectId: (id: number) => void;
  toggleBooleanToolObjectId: (id: number) => void;
  setBooleanKeepTools: (keep: boolean) => void;
  applyMeshBoolean: () => Promise<boolean>;

  openSimplifyDialog: (objectId?: number, volumeId?: number) => Promise<void>;
  closeSimplifyDialog: () => void;
  offerImportSimplification: (objectIds: number[]) => Promise<void>;
  chooseImportedMesh: (objectId: number, volumeId: number) => void;
  keepImportedMesh: () => void;
  setSimplifyMethod: (method: 'ratio' | 'target') => void;
  setSimplifyRatio: (ratio: number) => void;
  setSimplifyTargetCount: (count: number) => void;
  setSimplifyKeepPainting: (keep: boolean) => void;
  applySimplify: () => Promise<boolean>;

  splitSelectedObject: (objectId?: number) => Promise<boolean>;
  splitSelectedVolume: (objectId?: number, volumeId?: number) => Promise<boolean>;

  startBrimEars: (objectId?: number) => Promise<void>;
  setBrimRadius: (radius: number) => void;
  addBrimEar: (position: [number, number, number], radius?: number) => Promise<boolean>;
  removeBrimEar: (index: number) => Promise<boolean>;
  clearBrimEars: () => Promise<boolean>;
  stopBrimEars: () => void;

  openSvgDialog: () => void;
  closeSvgDialog: () => void;
  setSvgData: (svgText: string, fileName: string) => void;
  setSvgDepth: (depth: number) => void;
  setSvgTargetObjectId: (id: number | null) => void;
  applyAddSvg: (svgText?: string, depth?: number, objectId?: number | null) => Promise<boolean>;
}

async function stopConflictingTools(): Promise<void> {
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
}

async function refreshAndCommit(
  description: string,
  invalidatedIds: number[] = [],
  reselectId?: number | null
): Promise<void> {
  const plateStore = usePlateStore.getState();

  if (invalidatedIds.length > 0) {
    for (const id of invalidatedIds) {
      plateStore.meshCache.delete(id);
    }
  } else {
    plateStore.meshCache.clear();
  }
  usePlateStore.setState({ meshCache: new Map(plateStore.meshCache) });

  const refreshedObjs = await plateStore.refreshObjects();

  if (reselectId !== undefined) {
    if (reselectId !== null) {
      const match = refreshedObjs.find((o) => o.id === reselectId);
      plateStore.selectObject(reselectId, match?.instances?.[0]?.id ?? null);
    } else {
      plateStore.selectObject(null, null);
    }
  }

  await useObjectListStore.getState().refreshTree();

  if (!useHistoryStore.getState().isRestoring) {
    await useHistoryStore.getState().commitTransaction(description);
  }
}

export const useEditOpsStore = create<EditOpsState>((set, get) => ({
  activeTool: null,
  activeDialog: null,
  isOperating: false,
  error: null,

  flattenObjectId: null,
  flattenClusters: [],
  isLoadingClusters: false,

  booleanMode: 'union',
  booleanTargetObjectId: null,
  booleanToolObjectIds: [],
  booleanKeepTools: false,

  simplifyObjectId: null,
  simplifyVolumeId: null,
  simplifyMethod: 'ratio',
  simplifyRatio: 0.5,
  simplifyTargetCount: 1000,
  simplifyKeepPainting: true,
  importedMeshes: [],
  currentTriangleCount: 0,

  brimEarsObjectId: null,
  brimRadius: 5.0,
  brimPoints: [],

  svgDepth: 2.0,
  svgText: '',
  svgFileName: '',
  svgTargetObjectId: null,

  clearError: () => set({ error: null }),

  autoOrient: async (objectIds?: number[]) => {
    try {
      if (useHistoryStore.getState().isRestoring) return false;
    } catch (_) {}

    if (get().isOperating) return false;

    let targetIds = objectIds ? objectIds.filter((id) => typeof id === 'number' && Number.isFinite(id)) : [];
    if (targetIds.length === 0) {
      const plate = usePlateStore.getState();
      const selId = plate.selectedObjectId;
      if (selId !== null) {
        targetIds = [selId];
      } else if (plate.objects.length === 1) {
        targetIds = [plate.objects[0].id];
        plate.selectObject(plate.objects[0].id, plate.objects[0].instances?.[0]?.id ?? null);
      }
    }

    if (!targetIds || targetIds.length === 0) {
      set({ error: 'No object selected for auto-orient' });
      return false;
    }

    await stopConflictingTools();
    set({ isOperating: true, error: null });

    try {
      const res = await api.autoOrient(targetIds);
      if (!res.success) {
        set({ isOperating: false, error: res.error ?? 'Auto-orient failed' });
        return false;
      }

      await refreshAndCommit('Auto-orient', targetIds, targetIds[0]);
      set({ isOperating: false });
      return true;
    } catch (err: any) {
      set({ isOperating: false, error: err?.message || 'Auto-orient failed' });
      return false;
    }
  },

  startFlatten: async (objectId?: number, instanceId?: number) => {
    let targetId = objectId;
    if (targetId === undefined) {
      const plate = usePlateStore.getState();
      targetId = plate.selectedObjectId ?? (plate.objects.length === 1 ? plate.objects[0].id : undefined);
    }
    if (targetId === undefined) return;

    let targetInst = typeof instanceId === 'number' ? instanceId : undefined;
    if (targetInst === undefined) {
      const inst = usePlateStore.getState().selectedInstanceId;
      targetInst = typeof inst === 'number' ? inst : undefined;
    }

    await stopConflictingTools();
    set({
      activeTool: 'flatten',
      flattenObjectId: targetId,
      flattenClusters: [],
      isLoadingClusters: true,
      error: null
    });

    try {
      const res = await api.getPlanarFacets(targetId, targetInst);
      const clusters = res.clusters ?? [];
      set({ flattenClusters: clusters, isLoadingClusters: false });

      if (typeof window !== 'undefined' && (window as any).__plateScene?.showFlattenClusters) {
        (window as any).__plateScene.showFlattenClusters(clusters);
      }
    } catch (err: any) {
      set({
        isLoadingClusters: false,
        error: err?.message || 'Failed to detect planar facets'
      });
    }
  },

  applyPlaceOnFace: async (facetIndex: number) => {
    const { flattenObjectId } = get();
    if (flattenObjectId === null) return false;

    set({ isOperating: true, error: null });

    try {
      const res = await api.placeOnFace({
        objectId: flattenObjectId,
        facetIndex
      });

      if (!res.success) {
        set({ isOperating: false, error: res.error ?? 'Place on face failed' });
        return false;
      }

      await refreshAndCommit('Place on face', [flattenObjectId], flattenObjectId);

      get().stopFlatten();
      set({ isOperating: false });
      return true;
    } catch (err: any) {
      set({ isOperating: false, error: err?.message || 'Place on face failed' });
      return false;
    }
  },

  stopFlatten: () => {
    if (typeof window !== 'undefined' && (window as any).__plateScene?.clearFlattenClusters) {
      (window as any).__plateScene.clearFlattenClusters();
    }
    set({
      activeTool: null,
      flattenObjectId: null,
      flattenClusters: [],
      isLoadingClusters: false
    });
  },

  openBooleanDialog: () => {
    const plate = usePlateStore.getState();
    const selId = plate.selectedObjectId;
    const allIds = plate.objects.map((o) => o.id);
    const targetId = selId ?? (allIds.length > 0 ? allIds[0] : null);
    const tools = targetId !== null ? allIds.filter((id) => id !== targetId) : [];

    set({
      activeDialog: 'boolean',
      booleanMode: 'union',
      booleanTargetObjectId: targetId,
      booleanToolObjectIds: tools,
      booleanKeepTools: false,
      error: null
    });
  },

  closeBooleanDialog: () => set({ activeDialog: null }),

  setBooleanMode: (mode) => set({ booleanMode: mode }),

  setBooleanTargetObjectId: (id) => {
    const plate = usePlateStore.getState();
    const allIds = plate.objects.map((o) => o.id);
    const tools = allIds.filter((oid) => oid !== id);
    set({
      booleanTargetObjectId: id,
      booleanToolObjectIds: tools
    });
  },

  toggleBooleanToolObjectId: (id) => {
    set((state) => {
      const exists = state.booleanToolObjectIds.includes(id);
      return {
        booleanToolObjectIds: exists
          ? state.booleanToolObjectIds.filter((tid) => tid !== id)
          : [...state.booleanToolObjectIds, id]
      };
    });
  },

  setBooleanKeepTools: (keep) => set({ booleanKeepTools: keep }),

  applyMeshBoolean: async () => {
    const { booleanMode, booleanTargetObjectId, booleanToolObjectIds, booleanKeepTools } = get();
    const validTools = booleanToolObjectIds.filter((id) => typeof id === 'number' && Number.isFinite(id));
    if (booleanTargetObjectId === null || validTools.length === 0) {
      set({ error: 'Please select a target and at least one tool object' });
      return false;
    }

    await stopConflictingTools();
    set({ isOperating: true, error: null });

    try {
      const res = await api.meshBoolean({
        mode: booleanMode,
        targetObjectId: booleanTargetObjectId,
        toolObjectIds: validTools,
        keepTools: booleanKeepTools
      });

      if (!res.success) {
        set({ isOperating: false, error: res.error ?? 'Mesh boolean failed' });
        return false;
      }

      const affectedIds = [booleanTargetObjectId, ...validTools];
      await refreshAndCommit('Mesh boolean', affectedIds, booleanTargetObjectId);

      set({ isOperating: false, activeDialog: null });
      return true;
    } catch (err: any) {
      set({ isOperating: false, error: err?.message || 'Mesh boolean failed' });
      return false;
    }
  },

  openSimplifyDialog: async (objectId?: number, volumeId?: number) => {
    const plate = usePlateStore.getState();

    const targetObjId = objectId ?? plate.selectedObjectId ?? (plate.objects.length === 1 ? plate.objects[0].id : null);
    if (targetObjId === null || targetObjId === undefined) return;

    let targetVolId = volumeId ?? useObjectListStore.getState().selectedVolumeId;
    if (targetVolId === null || targetVolId === undefined) {
      const treeObj = useObjectListStore.getState().objects.find((o) => o.id === targetObjId);
      if (treeObj && treeObj.volumes && treeObj.volumes.length > 0) {
        targetVolId = treeObj.volumes[0].id;
      } else {
        try {
          const { getEngine } = await import('../engine/orcaEngine');
          const engine = await getEngine();
          const treeRes = await engine.call('getObjectTree', {});
          const found = (treeRes?.objects as any[])?.find((o: any) => o.id === targetObjId);
          if (found && found.volumes?.[0]) {
            targetVolId = found.volumes[0].id;
          }
        } catch (_) {}
      }
    }

    let triangleCount = 0;
    try {
      const { getMeshHealth } = await import('../repair/repairApi');
      const health = await getMeshHealth(targetObjId, targetVolId ?? undefined);
      triangleCount = health.facetsCount ?? 0;
    } catch (_) {
      const cached = plate.meshCache.get(targetObjId);
      triangleCount = cached?.triangleCount ?? 0;
    }

    set({
      importedMeshes: [],
      activeDialog: 'simplify',
      simplifyObjectId: targetObjId,
      simplifyVolumeId: targetVolId ?? null,
      simplifyMethod: 'ratio',
      simplifyRatio: 0.5,
      simplifyTargetCount: Math.max(10, Math.floor(triangleCount / 2)),
      simplifyKeepPainting: true,
      currentTriangleCount: triangleCount,
      error: null
    });
  },

  closeSimplifyDialog: () => {
    if (!get().isOperating) set({ activeDialog: null, importedMeshes: [] });
  },

  offerImportSimplification: async (objectIds) => {
    try {
      const { getEngine } = await import('../engine/orcaEngine');
      const { getMeshHealth } = await import('../repair/repairApi');
      const engine = await getEngine();
      const tree = await engine.call('getObjectTree', {});
      const candidates: ImportedMesh[] = [];
      for (const object of (tree.objects ?? []) as import('../objectlist/types').ObjectTreeNode[]) {
        if (!objectIds.includes(object.id)) continue;
        for (const volume of object.volumes) {
          const health = await getMeshHealth(object.id, volume.id);
          if (health.facetsCount >= IMPORT_SIMPLIFY_TRIANGLES) {
            candidates.push({ objectId: object.id, volumeId: volume.id,
              name: object.volumes.length > 1 ? `${object.name} / ${volume.name}` : object.name,
              triangleCount: health.facetsCount });
          }
        }
      }
      const { useAppStore } = await import('../store/appStore');
      if (!candidates.length || useAppStore.getState().isSlicing || useHistoryStore.getState().isRestoring) return;
      const state = get();
      if (state.activeDialog && !state.importedMeshes.length) return;
      const pending = [...state.importedMeshes, ...candidates.filter(c => !state.importedMeshes.some(m => m.objectId === c.objectId && m.volumeId === c.volumeId))];
      set({ importedMeshes: pending });
      if (!state.importedMeshes.length) get().chooseImportedMesh(pending[0].objectId, pending[0].volumeId);
    } catch (error) {
      console.warn('[Import] Could not inspect meshes for simplification:', error);
    }
  },

  chooseImportedMesh: (objectId, volumeId) => {
    if (get().isOperating) return;
    const mesh = get().importedMeshes.find(m => m.objectId === objectId && m.volumeId === volumeId);
    if (!mesh) return;
    set({ activeDialog: 'simplify', simplifyObjectId: objectId, simplifyVolumeId: volumeId,
      currentTriangleCount: mesh.triangleCount, simplifyMethod: 'ratio', simplifyRatio: 0.5,
      simplifyTargetCount: Math.floor(mesh.triangleCount / 2), simplifyKeepPainting: true, error: null });
  },

  keepImportedMesh: () => {
    if (get().isOperating) return;
    const state = get();
    const pending = state.importedMeshes.filter(m => m.objectId !== state.simplifyObjectId || m.volumeId !== state.simplifyVolumeId);
    set({ importedMeshes: pending, activeDialog: null });
    if (pending.length) get().chooseImportedMesh(pending[0].objectId, pending[0].volumeId);
  },

  setSimplifyMethod: (method) => set({ simplifyMethod: method }),

  setSimplifyRatio: (ratio) => set({ simplifyRatio: ratio }),

  setSimplifyTargetCount: (count) => set({ simplifyTargetCount: count }),

  setSimplifyKeepPainting: (keep) => set({ simplifyKeepPainting: keep }),

  applySimplify: async () => {
    const {
      simplifyObjectId,
      simplifyVolumeId,
      simplifyMethod,
      simplifyRatio,
      simplifyTargetCount,
      simplifyKeepPainting
    } = get();

    if (simplifyObjectId === null || simplifyVolumeId === null) {
      set({ error: 'No volume selected for simplification' });
      return false;
    }

    await stopConflictingTools();
    set({ isOperating: true, error: null });

    try {
      const params: any = {
        objectId: simplifyObjectId,
        volumeId: simplifyVolumeId,
        keepPainting: simplifyKeepPainting
      };

      if (simplifyMethod === 'ratio') {
        params.ratio = simplifyRatio;
      } else {
        params.targetTriangleCount = simplifyTargetCount;
      }

      const res = await api.simplifyVolume(params);
      if (!res.success) {
        set({ isOperating: false, error: res.error ?? 'Simplification failed' });
        return false;
      }

      await refreshAndCommit('Simplify mesh', [simplifyObjectId], simplifyObjectId);
      set({ isOperating: false });
      get().keepImportedMesh();
      return true;
    } catch (err: any) {
      set({ isOperating: false, error: err?.message || 'Simplification failed' });
      return false;
    }
  },

  splitSelectedObject: async (objectId?: number) => {
    const plate = usePlateStore.getState();
    const targetId = objectId ?? plate.selectedObjectId ?? (plate.objects.length === 1 ? plate.objects[0].id : null);
    if (targetId === null || targetId === undefined) {
      set({ error: 'No object selected to split' });
      return false;
    }

    await stopConflictingTools();
    set({ isOperating: true, error: null });

    try {
      const res = await api.splitObject(targetId);
      if (!res.success) {
        set({ isOperating: false, error: res.error ?? 'Object could not be split' });
        return false;
      }

      const firstNewId = res.newObjectIds?.[0] ?? null;
      await refreshAndCommit('Split to objects', [targetId], firstNewId);
      set({ isOperating: false });
      return true;
    } catch (err: any) {
      set({ isOperating: false, error: err?.message || 'Failed to split object' });
      return false;
    }
  },

  splitSelectedVolume: async (objectId?: number, volumeId?: number) => {
    const plate = usePlateStore.getState();
    const targetObjId = objectId ?? plate.selectedObjectId ?? (plate.objects.length === 1 ? plate.objects[0].id : null);
    if (targetObjId === null || targetObjId === undefined) {
      set({ error: 'No object selected to split' });
      return false;
    }

    let targetVolId = volumeId ?? useObjectListStore.getState().selectedVolumeId;
    if (targetVolId === null || targetVolId === undefined) {
      const treeObj = useObjectListStore.getState().objects.find((o) => o.id === targetObjId);
      if (treeObj && treeObj.volumes && treeObj.volumes.length > 0) {
        targetVolId = treeObj.volumes[0].id;
      } else {
        try {
          const { getEngine } = await import('../engine/orcaEngine');
          const engine = await getEngine();
          const treeRes = await engine.call('getObjectTree', {});
          const found = (treeRes?.objects as any[])?.find((o: any) => o.id === targetObjId);
          if (found && found.volumes?.[0]) {
            targetVolId = found.volumes[0].id;
          }
        } catch (_) {}
      }
    }

    if (targetVolId === undefined || targetVolId === null) {
      set({ error: 'No volume found to split' });
      return false;
    }

    await stopConflictingTools();
    set({ isOperating: true, error: null });

    try {
      const res = await api.splitVolume(targetObjId, targetVolId);
      if (!res.success) {
        set({ isOperating: false, error: res.error ?? 'Volume could not be split' });
        return false;
      }

      await refreshAndCommit('Split to parts', [targetObjId], targetObjId);
      set({ isOperating: false });
      return true;
    } catch (err: any) {
      set({ isOperating: false, error: err?.message || 'Failed to split volume' });
      return false;
    }
  },

  startBrimEars: async (objectId?: number) => {
    const plate = usePlateStore.getState();
    const targetId = objectId ?? plate.selectedObjectId ?? (plate.objects.length === 1 ? plate.objects[0].id : null);
    if (targetId === null || targetId === undefined) return;

    await stopConflictingTools();
    set({
      activeTool: 'brimears',
      brimEarsObjectId: targetId,
      brimPoints: [],
      error: null
    });

    try {
      const res = await api.getBrimEars(targetId);
      const points = res.points ?? [];
      set({ brimPoints: points });
      if (typeof window !== 'undefined' && (window as any).__plateScene?.showBrimEars) {
        (window as any).__plateScene.showBrimEars(points);
      }
    } catch (err: any) {
      set({ error: err?.message || 'Failed to get brim ears' });
    }
  },

  setBrimRadius: (radius: number) => set({ brimRadius: radius }),

  addBrimEar: async (position: [number, number, number], radius?: number) => {
    const { brimEarsObjectId, brimPoints, brimRadius } = get();
    if (brimEarsObjectId === null) return false;

    const r = radius ?? brimRadius;
    const newPoints = [...brimPoints, { position, radius: r }];

    try {
      const res = await api.setBrimEars({ objectId: brimEarsObjectId, points: newPoints });
      if (!res.success) {
        set({ error: res.error ?? 'Failed to update brim ears' });
        return false;
      }

      set({ brimPoints: newPoints });
      if (typeof window !== 'undefined' && (window as any).__plateScene?.showBrimEars) {
        (window as any).__plateScene.showBrimEars(newPoints);
      }

      if (!useHistoryStore.getState().isRestoring) {
        await useHistoryStore.getState().commitTransaction('Add brim ear');
      }
      return true;
    } catch (err: any) {
      set({ error: err?.message || 'Failed to add brim ear' });
      return false;
    }
  },

  removeBrimEar: async (index: number) => {
    const { brimEarsObjectId, brimPoints } = get();
    if (brimEarsObjectId === null) return false;

    const newPoints = brimPoints.filter((_, i) => i !== index);

    try {
      const res = await api.setBrimEars({ objectId: brimEarsObjectId, points: newPoints });
      if (!res.success) {
        set({ error: res.error ?? 'Failed to update brim ears' });
        return false;
      }

      set({ brimPoints: newPoints });
      if (typeof window !== 'undefined' && (window as any).__plateScene?.showBrimEars) {
        (window as any).__plateScene.showBrimEars(newPoints);
      }

      if (!useHistoryStore.getState().isRestoring) {
        await useHistoryStore.getState().commitTransaction('Remove brim ear');
      }
      return true;
    } catch (err: any) {
      set({ error: err?.message || 'Failed to remove brim ear' });
      return false;
    }
  },

  clearBrimEars: async () => {
    const { brimEarsObjectId } = get();
    if (brimEarsObjectId === null) return false;

    try {
      const res = await api.clearBrimEars(brimEarsObjectId);
      if (!res.success) {
        set({ error: res.error ?? 'Failed to clear brim ears' });
        return false;
      }

      set({ brimPoints: [] });
      if (typeof window !== 'undefined' && (window as any).__plateScene?.showBrimEars) {
        (window as any).__plateScene.showBrimEars([]);
      }

      if (!useHistoryStore.getState().isRestoring) {
        await useHistoryStore.getState().commitTransaction('Clear brim ears');
      }
      return true;
    } catch (err: any) {
      set({ error: err?.message || 'Failed to clear brim ears' });
      return false;
    }
  },

  stopBrimEars: () => {
    if (typeof window !== 'undefined' && (window as any).__plateScene?.clearBrimEarsOverlay) {
      (window as any).__plateScene.clearBrimEarsOverlay();
    }
    set({
      activeTool: null,
      brimEarsObjectId: null,
      brimPoints: []
    });
  },

  openSvgDialog: () => {
    const selId = usePlateStore.getState().selectedObjectId;
    set({
      activeDialog: 'svg',
      svgDepth: 2.0,
      svgText: '',
      svgFileName: '',
      svgTargetObjectId: selId,
      error: null
    });
  },

  closeSvgDialog: () => set({ activeDialog: null }),

  setSvgData: (svgText, fileName) => set({ svgText, svgFileName: fileName }),

  setSvgDepth: (depth) => set({ svgDepth: depth }),

  setSvgTargetObjectId: (id) => set({ svgTargetObjectId: id }),

  applyAddSvg: async (svgTextParam?: string, depthParam?: number, objectIdParam?: number | null) => {
    const text = svgTextParam ?? get().svgText;
    const depth = depthParam ?? get().svgDepth;
    const targetObj = objectIdParam !== undefined ? objectIdParam : get().svgTargetObjectId;

    if (!text || text.trim().length === 0) {
      set({ error: 'Please choose an SVG file' });
      return false;
    }

    await stopConflictingTools();
    set({ isOperating: true, error: null });

    try {
      const params: any = {
        svgText: text,
        depth: depth,
        useSurface: false
      };
      if (targetObj !== null && targetObj !== undefined) {
        params.objectId = targetObj;
        params.volumeType = 'part';
      }

      const res = await api.addSvg(params);
      if (res.objectId === undefined) {
        set({ isOperating: false, error: res.error ?? 'Failed to add SVG' });
        return false;
      }

      await refreshAndCommit('Add SVG', [], res.objectId);
      set({ isOperating: false, activeDialog: null });
      return true;
    } catch (err: any) {
      set({ isOperating: false, error: err?.message || 'Failed to add SVG' });
      return false;
    }
  }
}));

if (typeof window !== 'undefined') {
  (window as any).__editOpsStore = useEditOpsStore;
}
