import { create } from 'zustand';
import { getEngine } from '../engine/orcaEngine';
import { useAppStore } from '../store/appStore';
import { usePlateStore } from '../plate/plateStore';
import { useHistoryStore } from '../history';
import type {
  PaintTarget,
  SupportPaintMode,
  SupportFacetState,
  SupportPaintingData,
  VolumeInfo
} from './types';

export interface PaintingStoreState {
  isPaintingActive: boolean;
  paintTarget: PaintTarget;
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
  setPaintTarget: (target: PaintTarget) => Promise<void>;
  setPaintMode: (mode: SupportPaintMode) => void;
  selectVolume: (volumeId: number) => Promise<void>;
  beginStroke: () => void;
  paintFacet: (facetId: number) => void;
  endStroke: () => Promise<void>;
  cancelStroke: () => void;
  clearVolume: () => Promise<void>;
  refreshPaintingData: (objectId: number, volumeId: number) => Promise<SupportPaintingData | null>;
  loadPaintingForObject: (objectId: number, volumeId?: number | null, target?: PaintTarget) => Promise<SupportPaintingData | null>;
}

let paintingSessionSeq = 0;

export const usePaintingStore = create<PaintingStoreState>((set, get) => ({
  isPaintingActive: false,
  paintTarget: 'support',
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
    const sessionId = ++paintingSessionSeq;
    try {
      set({ isLoading: true, error: null, selectedObjectId: objectId });
      const engine = await getEngine();
      if (sessionId !== paintingSessionSeq) return;
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
      if (sessionId !== paintingSessionSeq) return;
      const partitions = meshData?.volumes;

      const { paintTarget } = get();
      const targetLabel = paintTarget === 'seam' ? 'Seam' : 'Support';

      const currentPlateObjId = usePlateStore.getState().selectedObjectId;
      if (currentPlateObjId !== objectId && currentPlateObjId !== null) {
        // Selection switched away during async fetch
        return;
      }

      if (!partitions || partitions.length === 0) {
        if (sessionId !== paintingSessionSeq) return;
        set({
          isPaintingActive: true,
          selectedObjectId: objectId,
          selectedVolumeId: null,
          volumes: modelPartVolumes.length > 0 ? modelPartVolumes : rawVolumes,
          paintingData: null,
          isLoading: false,
          error: `${targetLabel} painting is disabled: mesh volume metadata is missing from the engine.`
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
        if (sessionId !== paintingSessionSeq) return;
        set({
          isPaintingActive: true,
          selectedObjectId: objectId,
          selectedVolumeId: null,
          volumes: modelPartVolumes,
          paintingData: null,
          isLoading: false,
          error: `${targetLabel} painting is disabled: no matching volume partition found.`
        });
        return;
      }

      // Query engine painting for active target
      const paintRes = paintTarget === 'seam'
        ? await (engine as any).getSeamPainting(objectId, targetVolId)
        : await (engine as any).getSupportPainting(objectId, targetVolId);

      if (sessionId !== paintingSessionSeq) return;
      // Guard against stale async write if target or object selection changed during await
      const activeObjId = usePlateStore.getState().selectedObjectId;
      if (
        get().paintTarget === paintTarget &&
        (activeObjId === objectId || activeObjId === null)
      ) {
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
      }
    } catch (err: any) {
      if (sessionId !== paintingSessionSeq) return;
      console.error('[paintingStore] Failed to start painting:', err);
      set({
        isLoading: false,
        error: err.message || 'Failed to initialize painting'
      });
    }
  },

  stopPainting: () => {
    paintingSessionSeq++;
    const { strokeBackupPaintingData, paintingData, selectedObjectId } = get();
    if (typeof window !== 'undefined' && (window as any).__plateScene) {
      if (typeof (window as any).__plateScene.clearAllOverlays === 'function') {
        (window as any).__plateScene.clearAllOverlays(selectedObjectId ?? undefined);
      }
      if (typeof (window as any).__plateScene.cancelStroke === 'function') {
        (window as any).__plateScene.cancelStroke();
      }
    }
    set({
      isPaintingActive: false,
      selectedObjectId: null,
      selectedVolumeId: null,
      paintingData: strokeBackupPaintingData || paintingData,
      isLoading: false,
      strokeModifiedFacets: new Map(),
      strokeBackupPaintingData: null
    });
  },

  setPaintTarget: async (target: PaintTarget) => {
    const current = get();
    if (current.paintTarget === target) return;

    // Discard any active/pending stroke immediately
    get().cancelStroke();

    // Clear overlays in 3D scene immediately so old target's overlay does not persist
    if (typeof window !== 'undefined' && (window as any).__plateScene) {
      if (typeof (window as any).__plateScene.clearAllOverlays === 'function') {
        (window as any).__plateScene.clearAllOverlays(current.selectedObjectId ?? undefined);
      }
      if (typeof (window as any).__plateScene.cancelStroke === 'function') {
        (window as any).__plateScene.cancelStroke();
      }
    }

    const { selectedObjectId, selectedVolumeId } = get();
    set({
      paintTarget: target,
      paintingData: null,
      strokeModifiedFacets: new Map(),
      strokeBackupPaintingData: null
    });

    if (!selectedObjectId || selectedVolumeId === null) return;

    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      const paintRes = target === 'seam'
        ? await (engine as any).getSeamPainting(selectedObjectId, selectedVolumeId)
        : await (engine as any).getSupportPainting(selectedObjectId, selectedVolumeId);

      // Verify user didn't switch targets, objects, or volumes while waiting for response
      if (
        get().paintTarget === target &&
        get().selectedObjectId === selectedObjectId &&
        get().selectedVolumeId === selectedVolumeId
      ) {
        set({
          paintingData: paintRes,
          isLoading: false,
          error: null,
          strokeModifiedFacets: new Map(),
          strokeBackupPaintingData: null
        });
      }
    } catch (err: any) {
      console.error('[paintingStore] Failed to switch paint target:', err);
      if (
        get().paintTarget === target &&
        get().selectedObjectId === selectedObjectId &&
        get().selectedVolumeId === selectedVolumeId
      ) {
        set({
          isLoading: false,
          error: err.message || `Failed to query ${target} painting for volume`
        });
      }
    }
  },

  setPaintMode: (mode: SupportPaintMode) => {
    set({ paintMode: mode });
  },

  selectVolume: async (volumeId: number) => {
    const { selectedObjectId, paintTarget } = get();
    if (!selectedObjectId) return;

    // Discard any active/pending stroke immediately
    get().cancelStroke();

    // Clear overlays in 3D scene immediately
    if (typeof window !== 'undefined' && (window as any).__plateScene) {
      if (typeof (window as any).__plateScene.clearAllOverlays === 'function') {
        (window as any).__plateScene.clearAllOverlays(selectedObjectId);
      }
      if (typeof (window as any).__plateScene.cancelStroke === 'function') {
        (window as any).__plateScene.cancelStroke();
      }
    }

    try {
      set({ isLoading: true, error: null, selectedVolumeId: volumeId, paintingData: null });

      const meshData = await usePlateStore.getState().getMesh(selectedObjectId);
      const partitions = meshData?.volumes;
      const targetLabel = paintTarget === 'seam' ? 'Seam' : 'Support';
      if (!partitions || !partitions.some((p) => p.volumeId === volumeId)) {
        if (
          get().selectedObjectId === selectedObjectId &&
          get().selectedVolumeId === volumeId &&
          get().paintTarget === paintTarget
        ) {
          set({
            isLoading: false,
            error: `${targetLabel} painting is disabled for volume ${volumeId}: volume partition metadata missing.`
          });
        }
        return;
      }

      const engine = await getEngine();
      const paintRes = paintTarget === 'seam'
        ? await (engine as any).getSeamPainting(selectedObjectId, volumeId)
        : await (engine as any).getSupportPainting(selectedObjectId, volumeId);

      // Guard against stale async write if target, object or volume changed during await
      if (
        get().selectedObjectId === selectedObjectId &&
        get().selectedVolumeId === volumeId &&
        get().paintTarget === paintTarget
      ) {
        set({
          paintingData: paintRes,
          isLoading: false,
          error: null,
          strokeModifiedFacets: new Map(),
          strokeBackupPaintingData: null
        });
      }
    } catch (err: any) {
      console.error('[paintingStore] Failed to switch volume:', err);
      if (
        get().selectedObjectId === selectedObjectId &&
        get().selectedVolumeId === volumeId &&
        get().paintTarget === paintTarget
      ) {
        set({
          isLoading: false,
          error: err.message || `Failed to query ${paintTarget} painting for volume`
        });
      }
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
    const { paintMode, paintTarget, paintingData, strokeModifiedFacets, error, isPaintingActive } = get();
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
    const hasAny = nextEnforcers.length > 0 || nextBlockers.length > 0;

    set({
      strokeModifiedFacets: nextStroke,
      strokeBackupPaintingData: backup,
      paintingData: {
        ...paintingData,
        hasCustomSupports: paintTarget === 'support' ? hasAny : (paintingData.hasCustomSupports ?? false),
        hasCustomSeam: paintTarget === 'seam' ? hasAny : (paintingData.hasCustomSeam ?? false),
        hasCustomSeams: paintTarget === 'seam' ? hasAny : (paintingData.hasCustomSeams ?? false),
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
    const { selectedObjectId, selectedVolumeId, paintTarget, strokeModifiedFacets, strokeBackupPaintingData } = get();
    if (!selectedObjectId || !selectedVolumeId || strokeModifiedFacets.size === 0) {
      return;
    }

    // Snapshot stroke parameters and clear in-store stroke tracking immediately
    // to prevent racing with subsequent strokes or object/target switches
    const strokeTarget = paintTarget;
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

      if (strokeTarget === 'seam') {
        await (engine as any).setSeamPainting({
          objectId: targetObjId,
          volumeId: targetVolId,
          enforcers,
          blockers,
          clear
        });
      } else {
        await (engine as any).setSupportPainting({
          objectId: targetObjId,
          volumeId: targetVolId,
          enforcers,
          blockers,
          clear
        });
      }

      // Synchronize exact readback from engine
      const freshData = strokeTarget === 'seam'
        ? await (engine as any).getSeamPainting(targetObjId, targetVolId)
        : await (engine as any).getSupportPainting(targetObjId, targetVolId);

      const current = get();
      if (
        current.paintTarget === strokeTarget &&
        current.selectedObjectId === targetObjId &&
        current.selectedVolumeId === targetVolId
      ) {
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
          const hasAny = enf.size > 0 || blk.size > 0;
          set({
            paintingData: {
              ...freshData,
              hasCustomSupports: strokeTarget === 'support' ? hasAny : freshData.hasCustomSupports,
              hasCustomSeam: strokeTarget === 'seam' ? hasAny : freshData.hasCustomSeam,
              hasCustomSeams: strokeTarget === 'seam' ? hasAny : freshData.hasCustomSeams,
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

      // Commit to history transaction
      try {
        await useHistoryStore.getState().commitTransaction(`${strokeTarget === 'seam' ? 'Seam' : 'Support'} paint stroke`);
      } catch (_) {}
    } catch (err: any) {
      console.error('[paintingStore] Failed to commit stroke:', err);
      // Revert optimistic changes by restoring backup
      const current = get();
      if (
        backupToRestore &&
        current.paintTarget === strokeTarget &&
        current.selectedObjectId === targetObjId &&
        current.selectedVolumeId === targetVolId
      ) {
        set({
          paintingData: backupToRestore,
          strokeModifiedFacets: new Map(),
          strokeBackupPaintingData: null
        });
      }
      try {
        const engine = await getEngine();
        const fallback = strokeTarget === 'seam'
          ? await (engine as any).getSeamPainting(targetObjId, targetVolId)
          : await (engine as any).getSupportPainting(targetObjId, targetVolId);
        if (
          get().paintTarget === strokeTarget &&
          get().selectedObjectId === targetObjId &&
          get().selectedVolumeId === targetVolId
        ) {
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
    if (typeof window !== 'undefined' && (window as any).__plateScene) {
      if (typeof (window as any).__plateScene.cancelStroke === 'function') {
        (window as any).__plateScene.cancelStroke();
      }
    }
  },

  clearVolume: async () => {
    const { selectedObjectId, selectedVolumeId, paintTarget } = get();
    if (!selectedObjectId || !selectedVolumeId) return;

    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      if (paintTarget === 'seam') {
        await (engine as any).clearSeamPainting(selectedObjectId, selectedVolumeId);
        const freshData = await (engine as any).getSeamPainting(selectedObjectId, selectedVolumeId);
        if (
          get().paintTarget === 'seam' &&
          get().selectedObjectId === selectedObjectId &&
          get().selectedVolumeId === selectedVolumeId
        ) {
          set({
            paintingData: freshData,
            isLoading: false,
            strokeModifiedFacets: new Map(),
            strokeBackupPaintingData: null
          });
        }
      } else {
        await (engine as any).clearSupportPainting(selectedObjectId, selectedVolumeId);
        const freshData = await (engine as any).getSupportPainting(selectedObjectId, selectedVolumeId);
        if (
          get().paintTarget === 'support' &&
          get().selectedObjectId === selectedObjectId &&
          get().selectedVolumeId === selectedVolumeId
        ) {
          set({
            paintingData: freshData,
            isLoading: false,
            strokeModifiedFacets: new Map(),
            strokeBackupPaintingData: null
          });
        }
      }

      // Invalidate stale slice preview on successful edits
      useAppStore.getState().invalidateSlicePreview();

      // Commit to history transaction
      try {
        await useHistoryStore.getState().commitTransaction(`Clear ${paintTarget} painting`);
      } catch (_) {}
    } catch (err: any) {
      console.error('[paintingStore] Failed to clear volume painting:', err);
      if (
        get().paintTarget === paintTarget &&
        get().selectedObjectId === selectedObjectId &&
        get().selectedVolumeId === selectedVolumeId
      ) {
        set({
          isLoading: false,
          error: err.message || `Failed to clear ${paintTarget} painting`
        });
      }
    }
  },

  refreshPaintingData: async (objectId: number, volumeId: number) => {
    try {
      const { paintTarget } = get();
      const engine = await getEngine();
      const freshData = paintTarget === 'seam'
        ? await (engine as any).getSeamPainting(objectId, volumeId)
        : await (engine as any).getSupportPainting(objectId, volumeId);
      if (
        get().paintTarget === paintTarget &&
        get().selectedObjectId === objectId &&
        get().selectedVolumeId === volumeId
      ) {
        set({ paintingData: freshData });
      }
      return freshData;
    } catch (err) {
      console.error('[paintingStore] Failed to refresh painting data:', err);
      return null;
    }
  },

  loadPaintingForObject: async (objectId: number, volumeId?: number | null, target?: PaintTarget) => {
    try {
      const actualTarget = target || get().paintTarget;
      const engine = await getEngine();
      if (typeof volumeId === 'number') {
        const res = actualTarget === 'seam'
          ? await (engine as any).getSeamPainting(objectId, volumeId)
          : await (engine as any).getSupportPainting(objectId, volumeId);
        return res as SupportPaintingData;
      }

      const meshData = await usePlateStore.getState().getMesh(objectId);
      const partitions = meshData?.volumes;
      if (!partitions || partitions.length === 0) {
        return null;
      }
      const targetVolId = partitions[0].volumeId;
      const res = actualTarget === 'seam'
        ? await (engine as any).getSeamPainting(objectId, targetVolId)
        : await (engine as any).getSupportPainting(objectId, targetVolId);
      return res as SupportPaintingData;
    } catch (err) {
      return null;
    }
  }
}));

if (typeof window !== 'undefined') {
  (window as any).__paintingStore = usePaintingStore;
}
