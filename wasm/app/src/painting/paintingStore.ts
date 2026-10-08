import { create } from 'zustand';
import { getEngine } from '../engine/orcaEngine';
import { useAppStore } from '../store/appStore';
import { usePlateStore } from '../plate/plateStore';
import type {
  SupportPaintMode,
  SupportFacetState,
  SupportPaintingData,
  VolumeInfo
} from './types';

export interface PaintingStoreState {
  isPaintingActive: boolean;
  paintMode: SupportPaintMode;
  selectedObjectId: number | null;
  selectedVolumeId: number | null;
  volumes: VolumeInfo[];
  paintingData: SupportPaintingData | null;
  isLoading: boolean;
  error: string | null;

  // Stroke tracking & optimistic rollback
  strokeModifiedFacets: Map<number, SupportFacetState>;
  strokeBackupPaintingData: SupportPaintingData | null;

  // Actions
  startPainting: (objectId: number, volumeId?: number | null) => Promise<void>;
  stopPainting: () => void;
  setPaintMode: (mode: SupportPaintMode) => void;
  selectVolume: (volumeId: number) => Promise<void>;
  beginStroke: () => void;
  paintFacet: (facetId: number) => void;
  endStroke: () => Promise<void>;
  cancelStroke: () => void;
  clearVolume: () => Promise<void>;
  refreshPaintingData: (objectId: number, volumeId: number) => Promise<SupportPaintingData | null>;
  loadPaintingForObject: (objectId: number, volumeId?: number | null) => Promise<SupportPaintingData | null>;
}

export const usePaintingStore = create<PaintingStoreState>((set, get) => ({
  isPaintingActive: false,
  paintMode: 'enforce',
  selectedObjectId: null,
  selectedVolumeId: null,
  volumes: [],
  paintingData: null,
  isLoading: false,
  error: null,
  strokeModifiedFacets: new Map(),
  strokeBackupPaintingData: null,

  startPainting: async (objectId: number, volumeId?: number | null) => {
    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      if (typeof window !== 'undefined') {
        (window as any).__orcaEngine = engine;
      }

      // Query object tree to discover volumes for this object
      let treeRes: any;
      if (typeof (engine as any).getObjectTree === 'function') {
        treeRes = await (engine as any).getObjectTree();
      } else {
        treeRes = await engine.call('getObjectTree', {});
      }

      const objects = treeRes?.objects || [];
      const obj = objects.find((o: any) => o.id === objectId);
      const rawVolumes: any[] = obj?.volumes || [];

      // Filter for model parts
      const modelPartVolumes: VolumeInfo[] = rawVolumes
        .filter((v: any) => !v.type || v.type === 'part' || v.type === 'model_part')
        .map((v: any) => ({
          id: v.id,
          name: v.name || `Volume ${v.id}`,
          type: v.type || 'part',
          extruder: v.extruder ?? 0
        }));

      // 1. Check volume partition metadata on object mesh
      // Never assume volume zero; missing metadata must disable painting safely with clear reason!
      const meshData = await usePlateStore.getState().getMesh(objectId);
      const partitions = meshData?.volumes;

      if (!partitions || partitions.length === 0) {
        set({
          isPaintingActive: true,
          selectedObjectId: objectId,
          selectedVolumeId: null,
          volumes: modelPartVolumes.length > 0 ? modelPartVolumes : rawVolumes,
          paintingData: null,
          isLoading: false,
          error: 'Support painting is disabled: mesh volume metadata is missing from the engine.'
        });
        return;
      }

      // Choose target volume matching valid partitions - NEVER assume volume zero!
      let targetVolId: number | null = null;
      if (volumeId && partitions.some((p) => p.volumeId === volumeId)) {
        targetVolId = volumeId;
      } else if (modelPartVolumes.some((mv) => partitions.some((p) => p.volumeId === mv.id))) {
        const found = modelPartVolumes.find((mv) => partitions.some((p) => p.volumeId === mv.id));
        targetVolId = found ? found.id : null;
      } else if (partitions.length > 0) {
        targetVolId = partitions[0].volumeId;
      }

      if (targetVolId === null) {
        set({
          isPaintingActive: true,
          selectedObjectId: objectId,
          selectedVolumeId: null,
          volumes: modelPartVolumes,
          paintingData: null,
          isLoading: false,
          error: 'Support painting is disabled: no matching volume partition found.'
        });
        return;
      }

      // Query engine support painting
      const paintRes = await (engine as any).getSupportPainting(objectId, targetVolId);

      set({
        isPaintingActive: true,
        selectedObjectId: objectId,
        selectedVolumeId: targetVolId,
        volumes: modelPartVolumes.length > 0 ? modelPartVolumes : rawVolumes,
        paintingData: paintRes,
        isLoading: false,
        error: null,
        strokeModifiedFacets: new Map(),
        strokeBackupPaintingData: null
      });
    } catch (err: any) {
      console.error('[paintingStore] Failed to start painting:', err);
      set({
        isLoading: false,
        error: err.message || 'Failed to initialize support painting'
      });
    }
  },

  stopPainting: () => {
    const { strokeBackupPaintingData, paintingData } = get();
    set({
      isPaintingActive: false,
      paintingData: strokeBackupPaintingData || paintingData,
      strokeModifiedFacets: new Map(),
      strokeBackupPaintingData: null
    });
  },

  setPaintMode: (mode: SupportPaintMode) => {
    set({ paintMode: mode });
  },

  selectVolume: async (volumeId: number) => {
    const { selectedObjectId } = get();
    if (!selectedObjectId) return;

    try {
      set({ isLoading: true, error: null, selectedVolumeId: volumeId });

      const meshData = await usePlateStore.getState().getMesh(selectedObjectId);
      const partitions = meshData?.volumes;
      if (!partitions || !partitions.some((p) => p.volumeId === volumeId)) {
        set({
          isLoading: false,
          error: `Support painting is disabled for volume ${volumeId}: volume partition metadata missing.`
        });
        return;
      }

      const engine = await getEngine();
      const paintRes = await (engine as any).getSupportPainting(selectedObjectId, volumeId);
      set({
        paintingData: paintRes,
        isLoading: false,
        error: null,
        strokeModifiedFacets: new Map(),
        strokeBackupPaintingData: null
      });
    } catch (err: any) {
      console.error('[paintingStore] Failed to switch volume:', err);
      set({
        isLoading: false,
        error: err.message || 'Failed to query support painting for volume'
      });
    }
  },

  beginStroke: () => {
    const { paintingData } = get();
    set({
      strokeModifiedFacets: new Map(),
      strokeBackupPaintingData: paintingData
        ? {
            ...paintingData,
            enforcers: [...paintingData.enforcers],
            blockers: [...paintingData.blockers]
          }
        : null
    });
  },

  paintFacet: (facetId: number) => {
    const { paintMode, paintingData, strokeModifiedFacets, error, isPaintingActive } = get();
    if (!isPaintingActive || error || !paintingData || facetId < 0 || facetId >= paintingData.triangleCount) {
      return;
    }

    let backup = get().strokeBackupPaintingData;
    if (!backup) {
      backup = {
        ...paintingData,
        enforcers: [...paintingData.enforcers],
        blockers: [...paintingData.blockers]
      };
    }

    const targetState: SupportFacetState =
      paintMode === 'enforce' ? 'enforcer' : paintMode === 'block' ? 'blocker' : 'none';

    // Record in current stroke
    const nextStroke = new Map(strokeModifiedFacets);
    nextStroke.set(facetId, targetState);

    // Optimistically update paintingData for immediate overlay feedback
    const enforcersSet = new Set(paintingData.enforcers || []);
    const blockersSet = new Set(paintingData.blockers || []);

    if (targetState === 'enforcer') {
      enforcersSet.add(facetId);
      blockersSet.delete(facetId);
    } else if (targetState === 'blocker') {
      blockersSet.add(facetId);
      enforcersSet.delete(facetId);
    } else {
      enforcersSet.delete(facetId);
      blockersSet.delete(facetId);
    }

    const nextEnforcers = Array.from(enforcersSet);
    const nextBlockers = Array.from(blockersSet);

    set({
      strokeModifiedFacets: nextStroke,
      strokeBackupPaintingData: backup,
      paintingData: {
        ...paintingData,
        hasCustomSupports: nextEnforcers.length > 0 || nextBlockers.length > 0,
        enforcers: nextEnforcers,
        blockers: nextBlockers,
        statistics: {
          enforcersCount: nextEnforcers.length,
          blockersCount: nextBlockers.length,
          totalPainted: nextEnforcers.length + nextBlockers.length
        }
      }
    });
  },
  endStroke: async () => {
    const { selectedObjectId, selectedVolumeId, strokeModifiedFacets, strokeBackupPaintingData } = get();
    if (!selectedObjectId || !selectedVolumeId || strokeModifiedFacets.size === 0) {
      return;
    }

    // Snapshot stroke parameters and clear in-store stroke tracking immediately
    // to prevent racing with subsequent strokes or object switches
    const targetObjId = selectedObjectId;
    const targetVolId = selectedVolumeId;
    const facetsToCommit = new Map(strokeModifiedFacets);
    const backupToRestore = strokeBackupPaintingData;

    set({
      strokeModifiedFacets: new Map(),
      strokeBackupPaintingData: null
    });

    try {
      const engine = await getEngine();
      const enforcers: number[] = [];
      const blockers: number[] = [];
      const clear: number[] = [];

      for (const [facetId, state] of facetsToCommit.entries()) {
        if (state === 'enforcer') {
          enforcers.push(facetId);
        } else if (state === 'blocker') {
          blockers.push(facetId);
        } else {
          clear.push(facetId);
        }
      }

      await (engine as any).setSupportPainting({
        objectId: targetObjId,
        volumeId: targetVolId,
        enforcers,
        blockers,
        clear
      });

      // Synchronize exact readback from engine
      const freshData = await (engine as any).getSupportPainting(targetObjId, targetVolId);
      const current = get();
      if (current.selectedObjectId === targetObjId && current.selectedVolumeId === targetVolId) {
        if (current.strokeModifiedFacets.size === 0) {
          set({ paintingData: freshData });
        } else {
          // Merge any concurrent pending strokes on top of freshData
          const enf = new Set(freshData.enforcers || []);
          const blk = new Set(freshData.blockers || []);
          for (const [fId, st] of current.strokeModifiedFacets.entries()) {
            if (st === 'enforcer') { enf.add(fId); blk.delete(fId); }
            else if (st === 'blocker') { blk.add(fId); enf.delete(fId); }
            else { enf.delete(fId); blk.delete(fId); }
          }
          set({
            paintingData: {
              ...freshData,
              hasCustomSupports: enf.size > 0 || blk.size > 0,
              enforcers: Array.from(enf),
              blockers: Array.from(blk),
              statistics: {
                enforcersCount: enf.size,
                blockersCount: blk.size,
                totalPainted: enf.size + blk.size
              }
            }
          });
        }
      }

      // Invalidate stale slice preview on successful edits
      useAppStore.getState().invalidateSlicePreview();
    } catch (err: any) {
      console.error('[paintingStore] Failed to commit stroke:', err);
      // Revert optimistic changes by restoring backup
      const current = get();
      if (backupToRestore && current.selectedObjectId === targetObjId && current.selectedVolumeId === targetVolId) {
        set({
          paintingData: backupToRestore,
          strokeModifiedFacets: new Map(),
          strokeBackupPaintingData: null
        });
      }
      try {
        const engine = await getEngine();
        const fallback = await (engine as any).getSupportPainting(targetObjId, targetVolId);
        if (get().selectedObjectId === targetObjId && get().selectedVolumeId === targetVolId) {
          set({ paintingData: fallback });
        }
      } catch (_) {}
    }
  },

  cancelStroke: () => {
    const { strokeBackupPaintingData } = get();
    if (strokeBackupPaintingData) {
      set({
        paintingData: strokeBackupPaintingData,
        strokeModifiedFacets: new Map(),
        strokeBackupPaintingData: null
      });
    } else {
      set({ strokeModifiedFacets: new Map() });
    }
  },

  clearVolume: async () => {
    const { selectedObjectId, selectedVolumeId } = get();
    if (!selectedObjectId || !selectedVolumeId) return;

    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      await (engine as any).clearSupportPainting(selectedObjectId, selectedVolumeId);

      const freshData = await (engine as any).getSupportPainting(selectedObjectId, selectedVolumeId);
      set({
        paintingData: freshData,
        isLoading: false,
        strokeModifiedFacets: new Map(),
        strokeBackupPaintingData: null
      });

      // Invalidate stale slice preview on successful edits
      useAppStore.getState().invalidateSlicePreview();
    } catch (err: any) {
      console.error('[paintingStore] Failed to clear volume support painting:', err);
      set({
        isLoading: false,
        error: err.message || 'Failed to clear support painting'
      });
    }
  },

  refreshPaintingData: async (objectId: number, volumeId: number) => {
    try {
      const engine = await getEngine();
      const freshData = await (engine as any).getSupportPainting(objectId, volumeId);
      set({ paintingData: freshData });
      return freshData;
    } catch (err) {
      console.error('[paintingStore] Failed to refresh painting data:', err);
      return null;
    }
  },

  loadPaintingForObject: async (objectId: number, volumeId?: number | null) => {
    try {
      const engine = await getEngine();
      if (typeof volumeId === 'number') {
        const res = await (engine as any).getSupportPainting(objectId, volumeId);
        return res as SupportPaintingData;
      }

      const meshData = await usePlateStore.getState().getMesh(objectId);
      const partitions = meshData?.volumes;
      if (!partitions || partitions.length === 0) {
        return null;
      }
      const targetVolId = partitions[0].volumeId;
      const res = await (engine as any).getSupportPainting(objectId, targetVolId);
      return res as SupportPaintingData;
    } catch (err) {
      return null;
    }
  }
}));

if (typeof window !== 'undefined') {
  (window as any).__paintingStore = usePaintingStore;
}
