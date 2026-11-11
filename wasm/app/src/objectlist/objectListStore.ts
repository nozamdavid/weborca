import { create } from 'zustand';
import { getEngine } from '../engine/orcaEngine';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../history';
import type { ObjectTreeNode, AddVolumeParams, VolumeType, LayerRangeTreeNode } from './types';
import { placeAddedVolume } from '../plate/volumePlacement';
import { syncLayerRangesToEngine, validateRangeBounds } from './layerRangeSync';


async function refreshVolumeGeometry(objectId: number) {
  const plate = usePlateStore.getState();
  const cache = new Map(plate.meshCache);
  const viewerCache = new Map(plate.viewerMeshCache);
  cache.delete(objectId);
  viewerCache.delete(objectId);
  usePlateStore.setState({ meshCache: cache, viewerMeshCache: viewerCache });
  await plate.refreshObjects();
  useAppStore.getState().invalidateSlicePreview();
}

export interface ObjectListState {
  objects: ObjectTreeNode[];
  selectedObjectId: number | null;
  selectedVolumeId: number | null;
  selectedRangeIndex: number | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  refreshTree: () => Promise<ObjectTreeNode[]>;
  selectItem: (objectId: number | null, volumeId?: number | null, rangeIndex?: number | null) => void;
  addVolume: (params: AddVolumeParams) => Promise<number>;
  deleteVolume: (objectId: number, volumeId: number) => Promise<void>;
  deleteObject: (objectId: number) => Promise<void>;
  renameObject: (objectId: number, name: string) => Promise<void>;
  moveVolume: (objectId: number, volumeId: number, toIndex: number) => Promise<void>;
  moveObject: (objectId: number, toIndex: number) => Promise<void>;
  renameVolume: (objectId: number, volumeId: number, name: string) => Promise<void>;
  setObjectConfig: (
    objectId: number,
    volumeId: number | null,
    options: Record<string, string>
  ) => Promise<{ errors: Array<{ key: string; error: string }> }>;
  resetObjectConfig: (
    objectId: number,
    volumeId: number | null,
    keys?: string[]
  ) => Promise<void>;
  setVolumeExtruder: (
    objectId: number,
    volumeId: number,
    extruder: number
  ) => Promise<void>;
  setVolumeType: (
    objectId: number,
    volumeId: number,
    type: VolumeType
  ) => Promise<void>;

  setObjectExtruder: (
    objectId: number,
    extruder: number
  ) => Promise<void>;

  // Layer range actions
  addLayerRange: (objectId: number, minZ?: number, maxZ?: number) => Promise<void>;
  deleteLayerRange: (objectId: number, rangeIndex: number) => Promise<void>;
  deleteAllLayerRanges: (objectId: number) => Promise<void>;
  editLayerRange: (objectId: number, rangeIndex: number, newMinZ: number, newMaxZ: number) => Promise<void>;
  setLayerRangeConfig: (
    objectId: number,
    rangeIndex: number,
    options: Record<string, string>
  ) => Promise<{ errors: Array<{ key: string; error: string }> }>;
  resetLayerRangeConfig: (
    objectId: number,
    rangeIndex: number,
    keys?: string[]
  ) => Promise<void>;
}

export const useObjectListStore = create<ObjectListState>((set, get) => ({
  objects: [],
  selectedObjectId: null,
  selectedVolumeId: null,
  selectedRangeIndex: null,
  isLoading: false,
  error: null,

  refreshTree: async () => {
    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      let res: any;
      if (typeof (engine as any).getObjectTree === 'function') {
        res = await (engine as any).getObjectTree();
      } else {
        res = await engine.call('getObjectTree', {});
      }
      const objects: ObjectTreeNode[] = res?.objects || [];
      set({ objects, isLoading: false });

      // Auto-select first object if nothing selected
      const currentSelected = get().selectedObjectId;
      if (currentSelected === null && objects.length > 0) {
        set({ selectedObjectId: objects[0].id, selectedVolumeId: null, selectedRangeIndex: null });
      } else if (currentSelected !== null && !objects.some((o) => o.id === currentSelected)) {
        set({
          selectedObjectId: objects.length > 0 ? objects[0].id : null,
          selectedVolumeId: null,
          selectedRangeIndex: null
        });
      }

      return objects;
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to get object tree' });
      return [];
    }
  },

  selectItem: (objectId: number | null, volumeId: number | null = null, rangeIndex: number | null = null) => {
    set({ selectedObjectId: objectId, selectedVolumeId: volumeId, selectedRangeIndex: rangeIndex });
    if (objectId !== null) {
      const plateStore = usePlateStore.getState();
      if (plateStore.selectedObjectId !== objectId) {
        plateStore.selectObject(objectId);
      }
    }
  },

  addVolume: async (params: AddVolumeParams) => {
    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      let res: any;
      if (typeof (engine as any).addVolume === 'function') {
        res = await (engine as any).addVolume(params);
      } else {
        res = await engine.call('addVolume', params);
      }
      const volumeId = res.volumeId || res.id;
      // Imports bypass this creation action and retain their assembly geometry.
      if (params.offset === undefined) await placeAddedVolume(params.objectId, volumeId);
      await refreshVolumeGeometry(params.objectId);
      await get().refreshTree();
      // Select newly added volume
      set({ selectedObjectId: params.objectId, selectedVolumeId: volumeId, selectedRangeIndex: null });
      try {
        await useHistoryStore.getState().commitTransaction('Add volume');
      } catch (_) {}
      return volumeId;
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to add volume' });
      throw err;
    }
  },

  deleteVolume: async (objectId: number, volumeId: number) => {
    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      if (typeof (engine as any).deleteVolume === 'function') {
        await (engine as any).deleteVolume(objectId, volumeId);
      } else {
        await engine.call('deleteVolume', { objectId, volumeId });
      }
      await refreshVolumeGeometry(objectId);
      if (get().selectedVolumeId === volumeId) {
        set({ selectedVolumeId: null });
      }
      await get().refreshTree();
      try {
        await useHistoryStore.getState().commitTransaction('Delete volume');
      } catch (_) {}
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to delete volume' });
      throw err;
    }
  },

  deleteObject: async (objectId: number) => {
    try {
      set({ isLoading: true, error: null });
      const plateStore = usePlateStore.getState();
      await plateStore.deleteObject(objectId);
      if (get().selectedObjectId === objectId) {
        set({ selectedObjectId: null, selectedVolumeId: null, selectedRangeIndex: null });
      }
      await get().refreshTree();
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to delete object' });
      throw err;
    }
  },

  moveVolume: async (objectId: number, volumeId: number, toIndex: number) => {
    const engine = await getEngine();
    await engine.call("moveVolume", { objectId, volumeId, toIndex });
    await refreshVolumeGeometry(objectId);
    await get().refreshTree();
    try {
      await useHistoryStore.getState().commitTransaction("Reorder volume");
    } catch (_) {}
  },
  moveObject: async (objectId: number, toIndex: number) => {
    const engine = await getEngine();
    await engine.call('moveObject', { objectId, toIndex });
    await usePlateStore.getState().refreshObjects();
    await get().refreshTree();
    try {
      await useHistoryStore.getState().commitTransaction('Reorder objects');
    } catch (_) {}
  },

  renameObject: async (objectId: number, name: string) => {
    try {
      const engine = await getEngine();
      if (typeof (engine as any).renameObject === 'function') {
        await (engine as any).renameObject(objectId, name);
      } else {
        await engine.call('renameObject', { objectId, name });
      }
      await usePlateStore.getState().refreshObjects(true);
      await get().refreshTree();
      try {
        await useHistoryStore.getState().commitTransaction('Rename object');
      } catch (_) {}
    } catch (err: any) {
      set({ error: err.message || 'Failed to rename object' });
      throw err;
    }
  },

  renameVolume: async (objectId: number, volumeId: number, name: string) => {
    try {
      const engine = await getEngine();
      if (typeof (engine as any).renameVolume === 'function') {
        await (engine as any).renameVolume(objectId, volumeId, name);
      } else {
        await engine.call('renameVolume', { objectId, volumeId, name });
      }
      await get().refreshTree();
      try {
        await useHistoryStore.getState().commitTransaction('Rename volume');
      } catch (_) {}
    } catch (err: any) {
      set({ error: err.message || 'Failed to rename volume' });
      throw err;
    }
  },

  setObjectConfig: async (
    objectId: number,
    volumeId: number | null,
    options: Record<string, string>
  ) => {
    try {
      if (options.extruder !== undefined) {
        const extNum = parseInt(options.extruder, 10) || 0;
        if (volumeId !== null) {
          await get().setVolumeExtruder(objectId, volumeId, extNum);
        } else {
          await get().setObjectExtruder(objectId, extNum);
        }
        const remainingKeys = Object.keys(options).filter((k) => k !== 'extruder');
        if (remainingKeys.length === 0) {
          return { errors: [] };
        }
        const remainingOptions: Record<string, string> = {};
        for (const k of remainingKeys) {
          remainingOptions[k] = options[k];
        }
        options = remainingOptions;
      }

      const engine = await getEngine();
      const payload: any = { objectId, options };
      if (volumeId !== null) {
        payload.volumeId = volumeId;
      }
      let res: any;
      if (typeof (engine as any).setObjectConfig === 'function') {
        res = await (engine as any).setObjectConfig(payload);
      } else {
        res = await engine.call('setObjectConfig', payload);
      }
      await get().refreshTree();
      try {
        await useHistoryStore.getState().commitTransaction('Set object config');
      } catch (_) {}
      return res || { errors: [] };
    } catch (err: any) {
      set({ error: err.message || 'Failed to set config' });
      throw err;
    }
  },

  resetObjectConfig: async (
    objectId: number,
    volumeId: number | null,
    keys?: string[]
  ) => {
    try {
      if (keys && keys.includes('extruder')) {
        if (volumeId !== null) {
          await get().setVolumeExtruder(objectId, volumeId, 0);
        } else {
          await get().setObjectExtruder(objectId, 0);
        }
        keys = keys.filter((k) => k !== 'extruder');
        if (keys.length === 0) {
          return;
        }
      } else if (!keys) {
        if (volumeId !== null) {
          await get().setVolumeExtruder(objectId, volumeId, 0);
        } else {
          await get().setObjectExtruder(objectId, 0);
        }
      }

      const engine = await getEngine();
      const payload: any = { objectId };
      if (volumeId !== null) {
        payload.volumeId = volumeId;
      }
      if (keys && keys.length > 0) {
        payload.keys = keys;
      }
      if (typeof (engine as any).resetObjectConfig === 'function') {
        await (engine as any).resetObjectConfig(payload);
      } else {
        await engine.call('resetObjectConfig', payload);
      }
      await get().refreshTree();
      try {
        await useHistoryStore.getState().commitTransaction('Reset object config');
      } catch (_) {}
    } catch (err: any) {
      set({ error: err.message || 'Failed to reset config' });
      throw err;
    }
  },

  setVolumeExtruder: async (
    objectId: number,
    volumeId: number,
    extruder: number
  ) => {
    try {
      const engine = await getEngine();
      if (typeof (engine as any).setVolumeExtruder === 'function') {
        await (engine as any).setVolumeExtruder(objectId, volumeId, extruder);
      } else {
        await engine.call('setVolumeExtruder', { objectId, volumeId, extruder });
      }
      await get().refreshTree();
      try {
        await useHistoryStore.getState().commitTransaction('Set volume extruder');
      } catch (_) {}
    } catch (err: any) {
      set({ error: err.message || 'Failed to set volume extruder' });
      throw err;
    }
  },

  setVolumeType: async (
    objectId: number,
    volumeId: number,
    type: VolumeType
  ) => {
    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      if (typeof (engine as any).setVolumeType === 'function') {
        await (engine as any).setVolumeType({ objectId, volumeId, type });
      } else {
        await engine.call('setVolumeType', { objectId, volumeId, type });
      }
      await refreshVolumeGeometry(objectId);
      await get().refreshTree();
      get().selectItem(objectId, volumeId);
      try {
        await useHistoryStore.getState().commitTransaction('Change part type');
      } catch (_) {}
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to set volume type' });
      throw err;
    }
  },

  setObjectExtruder: async (
    objectId: number,
    extruder: number
  ) => {
    try {
      const { objects } = get();
      const obj = objects.find((o) => o.id === objectId);
      const engine = await getEngine();
      if (obj && obj.volumes && obj.volumes.length > 0) {
        for (const vol of obj.volumes) {
          if (typeof (engine as any).setVolumeExtruder === 'function') {
            await (engine as any).setVolumeExtruder(objectId, vol.id, extruder);
          } else {
            await engine.call('setVolumeExtruder', { objectId, volumeId: vol.id, extruder });
          }
        }
      }
      await get().refreshTree();
      try {
        await useHistoryStore.getState().commitTransaction('Set object extruder');
      } catch (_) {}
    } catch (err: any) {
      set({ error: err.message || 'Failed to set object extruder' });
      throw err;
    }
  },

  addLayerRange: async (objectId: number, minZ?: number, maxZ?: number) => {
    try {
      set({ error: null });
      const { objects } = get();
      const objIndex = objects.findIndex((o) => o.id === objectId);
      if (objIndex === -1) throw new Error('Object not found');

      const targetObj = objects[objIndex];
      const existingRanges = [...(targetObj.layerRanges || [])].sort((a, b) => a.minZ - b.minZ);

      // Determine object height
      const plateObj = usePlateStore.getState().objects.find((o) => o.id === objectId);
      const objHeight = plateObj?.size?.[2] || 20.0;

      let newMinZ = minZ;
      let newMaxZ = maxZ;

      if (newMinZ === undefined || newMaxZ === undefined) {
        if (existingRanges.length === 0) {
          newMinZ = 0;
          newMaxZ = Math.min(2.0, objHeight);
        } else {
          // Look for gaps between ranges
          let gapFound = false;
          let candidateMin = 0;
          for (const r of existingRanges) {
            if (r.minZ - candidateMin >= 0.05) {
              newMinZ = candidateMin;
              newMaxZ = Math.min(r.minZ, candidateMin + 2.0);
              gapFound = true;
              break;
            }
            candidateMin = Math.max(candidateMin, r.maxZ);
          }
          if (!gapFound) {
            const lastMax = existingRanges[existingRanges.length - 1].maxZ;
            if (lastMax < objHeight - 0.01) {
              newMinZ = lastMax;
              newMaxZ = Math.min(lastMax + 2.0, objHeight);
            } else {
              const lastRange = existingRanges[existingRanges.length - 1];
              const span = lastRange.maxZ - lastRange.minZ;
              const mid = Number((lastRange.minZ + span / 2).toFixed(2));
              lastRange.maxZ = mid;
              newMinZ = mid;
              newMaxZ = Number((mid + span / 2).toFixed(2));
            }
          }
        }
      }

      newMinZ = Number(newMinZ!.toFixed(2));
      newMaxZ = Number(newMaxZ!.toFixed(2));

      const validation = validateRangeBounds(newMinZ, newMaxZ, objHeight, existingRanges);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid layer range bounds');
      }

      const defaultLayerHeight = useAppStore.getState().currentConfig['layer_height'] || '0.2';
      const newRange: LayerRangeTreeNode = {
        minZ: newMinZ,
        maxZ: newMaxZ,
        config: { layer_height: defaultLayerHeight },
        overrides: ['layer_height']
      };

      const updatedRanges = [...existingRanges, newRange].sort((a, b) => a.minZ - b.minZ);
      const newRangeIndex = updatedRanges.findIndex((r) => r.minZ === newMinZ && r.maxZ === newMaxZ);

      const updatedObjects = objects.map((o, idx) =>
        idx === objIndex ? { ...o, layerRanges: updatedRanges } : o
      );

      set({ objects: updatedObjects, isLoading: false });
      get().selectItem(objectId, null, newRangeIndex >= 0 ? newRangeIndex : 0);
      try {
        await useHistoryStore.getState().commitTransaction('Add layer range');
      } catch (_) {}
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to add layer range' });
      throw err;
    }
  },

  deleteLayerRange: async (objectId: number, rangeIndex: number) => {
    try {
      set({ error: null });
      const { objects } = get();
      const objIndex = objects.findIndex((o) => o.id === objectId);
      if (objIndex === -1) throw new Error('Object not found');

      const targetObj = objects[objIndex];
      const updatedRanges = [...(targetObj.layerRanges || [])];
      updatedRanges.splice(rangeIndex, 1);

      const updatedObjects = objects.map((o, idx) =>
        idx === objIndex ? { ...o, layerRanges: updatedRanges } : o
      );

      const nextRangeIdx = updatedRanges.length > 0 ? Math.min(rangeIndex, updatedRanges.length - 1) : null;
      set({ objects: updatedObjects, isLoading: false });
      get().selectItem(objectId, null, nextRangeIdx);
      try {
        await useHistoryStore.getState().commitTransaction('Delete layer range');
      } catch (_) {}
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to delete layer range' });
      throw err;
    }
  },

  deleteAllLayerRanges: async (objectId: number) => {
    try {
      set({ error: null });
      const { objects } = get();
      const objIndex = objects.findIndex((o) => o.id === objectId);
      if (objIndex === -1) throw new Error('Object not found');

      const updatedObjects = objects.map((o, idx) =>
        idx === objIndex ? { ...o, layerRanges: [] } : o
      );

      set({ objects: updatedObjects, isLoading: false });
      get().selectItem(objectId, null, null);
      try {
        await useHistoryStore.getState().commitTransaction('Clear layer ranges');
      } catch (_) {}
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to clear layer ranges' });
      throw err;
    }
  },

  editLayerRange: async (objectId: number, rangeIndex: number, newMinZ: number, newMaxZ: number) => {
    try {
      set({ error: null });
      const { objects } = get();
      const objIndex = objects.findIndex((o) => o.id === objectId);
      if (objIndex === -1) throw new Error('Object not found');

      const targetObj = objects[objIndex];
      const existingRanges = [...(targetObj.layerRanges || [])];
      if (!existingRanges[rangeIndex]) throw new Error('Range not found');

      const plateObj = usePlateStore.getState().objects.find((o) => o.id === objectId);
      const objHeight = plateObj?.size?.[2] || 20.0;

      const validation = validateRangeBounds(newMinZ, newMaxZ, objHeight, existingRanges, rangeIndex);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid layer range bounds');
      }

      const currentConfig = { ...existingRanges[rangeIndex].config };
      const currentOverrides = [...existingRanges[rangeIndex].overrides];

      existingRanges[rangeIndex] = {
        minZ: Number(newMinZ.toFixed(2)),
        maxZ: Number(newMaxZ.toFixed(2)),
        config: currentConfig,
        overrides: currentOverrides
      };

      const sortedRanges = [...existingRanges].sort((a, b) => a.minZ - b.minZ);
      const newIdx = sortedRanges.findIndex(
        (r) => r.minZ === Number(newMinZ.toFixed(2)) && r.maxZ === Number(newMaxZ.toFixed(2))
      );

      const updatedObjects = objects.map((o, idx) =>
        idx === objIndex ? { ...o, layerRanges: sortedRanges } : o
      );

      set({ objects: updatedObjects, isLoading: false });
      get().selectItem(objectId, null, newIdx >= 0 ? newIdx : 0);
      try {
        await useHistoryStore.getState().commitTransaction('Edit layer range');
      } catch (_) {}
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to edit layer range' });
      throw err;
    }
  },

  setLayerRangeConfig: async (objectId: number, rangeIndex: number, options: Record<string, string>) => {
    try {
      set({ error: null });
      const { objects } = get();
      const objIndex = objects.findIndex((o) => o.id === objectId);
      if (objIndex === -1) throw new Error('Object not found');

      const targetObj = objects[objIndex];
      const ranges = [...(targetObj.layerRanges || [])];
      if (!ranges[rangeIndex]) throw new Error('Range not found');

      const updatedConfig = { ...ranges[rangeIndex].config, ...options };
      const updatedOverrides = Object.keys(updatedConfig);

      ranges[rangeIndex] = {
        ...ranges[rangeIndex],
        config: updatedConfig,
        overrides: updatedOverrides
      };

      const updatedObjects = objects.map((o, idx) =>
        idx === objIndex ? { ...o, layerRanges: ranges } : o
      );

      set({ objects: updatedObjects, isLoading: false });
      get().selectItem(objectId, null, rangeIndex);
      try {
        await useHistoryStore.getState().commitTransaction('Set layer range config');
      } catch (_) {}
      return { errors: [] };
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to set layer range config' });
      throw err;
    }
  },

  resetLayerRangeConfig: async (objectId: number, rangeIndex: number, keys?: string[]) => {
    try {
      set({ error: null });
      const { objects } = get();
      const objIndex = objects.findIndex((o) => o.id === objectId);
      if (objIndex === -1) throw new Error('Object not found');

      const targetObj = objects[objIndex];
      const ranges = [...(targetObj.layerRanges || [])];
      if (!ranges[rangeIndex]) throw new Error('Range not found');

      const defaultLayerHeight = useAppStore.getState().currentConfig['layer_height'] || '0.2';
      let updatedConfig = { ...ranges[rangeIndex].config };

      if (keys && keys.length > 0) {
        for (const k of keys) {
          if (k === 'layer_height') {
            updatedConfig['layer_height'] = defaultLayerHeight;
          } else {
            delete updatedConfig[k];
          }
        }
      } else {
        updatedConfig = { layer_height: defaultLayerHeight };
      }

      const updatedOverrides = Object.keys(updatedConfig);
      ranges[rangeIndex] = {
        ...ranges[rangeIndex],
        config: updatedConfig,
        overrides: updatedOverrides
      };

      const updatedObjects = objects.map((o, idx) =>
        idx === objIndex ? { ...o, layerRanges: ranges } : o
      );

      set({ objects: updatedObjects, isLoading: false });
      get().selectItem(objectId, null, rangeIndex);
      try {
        await useHistoryStore.getState().commitTransaction('Reset layer range config');
      } catch (_) {}
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to reset layer range config' });
      throw err;
    }
  }
}));

// Expose on window for tests / debug
if (typeof window !== 'undefined') {
  (window as any).__objectListStore = useObjectListStore;
}

// Sync selection from plate store
// plateStore, history and this store import each other, so plateStore may still be initializing when this
// module runs. Subscribing in a microtask makes the link independent of the import order.
queueMicrotask(() => {
  usePlateStore.subscribe((state) => {
    const current = useObjectListStore.getState();
    if (state.selectedObjectId !== current.selectedObjectId) {
      useObjectListStore.setState({
        selectedObjectId: state.selectedObjectId,
        selectedVolumeId: null,
        selectedRangeIndex: null
      });
    }
  });
});
