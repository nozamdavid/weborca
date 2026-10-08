import { create } from 'zustand';
import { getEngine } from '../engine/orcaEngine';
import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../history';
import type { PlateObject, MeshBufferData, BedConfig, GizmoMode } from './types';

export function parseMeshBuffer(bytes: Uint8Array): MeshBufferData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== 0x4D455348) {
    throw new Error(`Invalid mesh binary magic: 0x${magic.toString(16)}`);
  }
  const vertexCount = view.getUint32(4, true);
  const triangleCount = view.getUint32(8, true);
  const headerOffset = 16;
  const posBytes = vertexCount * 3 * 4;
  const idxBytes = triangleCount * 3 * 4;

  const posSlice = bytes.buffer.slice(
    bytes.byteOffset + headerOffset,
    bytes.byteOffset + headerOffset + posBytes
  );
  const idxSlice = bytes.buffer.slice(
    bytes.byteOffset + headerOffset + posBytes,
    bytes.byteOffset + headerOffset + posBytes + idxBytes
  );

  const positions = new Float32Array(posSlice);
  const indices = new Uint32Array(idxSlice);

  return { vertexCount, triangleCount, positions, indices };
}

export interface PlateStoreState {
  objects: PlateObject[];
  selectedObjectId: number | null;
  selectedInstanceId: number | null;
  gizmoMode: GizmoMode;
  bedConfig: BedConfig;
  isLoading: boolean;
  meshCache: Map<number, MeshBufferData>;

  // Actions
  initBedConfig: (printableArea?: string, printableHeight?: string) => void;
  refreshObjects: () => Promise<PlateObject[]>;
  selectObject: (objectId: number | null, instanceId?: number | null) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  getMesh: (objectId: number) => Promise<MeshBufferData>;
  setInstanceTransform: (
    objectId: number,
    instanceId: number,
    transform: {
      offset?: [number, number, number];
      rotation?: [number, number, number];
      scale?: [number, number, number];
    }
  ) => Promise<void>;
  moveSelection: (delta: [number, number, number]) => Promise<void>;
  rotateSelection: (euler: [number, number, number]) => Promise<void>;
  scaleSelection: (scale: [number, number, number]) => Promise<void>;
  deleteSelected: () => Promise<void>;
  deleteObject: (objectId: number) => Promise<void>;
  duplicateSelected: () => Promise<void>;
  arrange: (useBed?: boolean) => Promise<void>;
  importFile: (file: File) => Promise<void>;
}

export const usePlateStore = create<PlateStoreState>((set, get) => ({
  objects: [],
  selectedObjectId: null,
  selectedInstanceId: null,
  gizmoMode: 'translate',
  bedConfig: {
    points: [
      [0, 0],
      [300, 0],
      [300, 300],
      [0, 300]
    ],
    width: 300,
    depth: 300,
    height: 300,
    center: [150, 150]
  },
  isLoading: false,
  meshCache: new Map(),

  initBedConfig: (printableArea?: string, printableHeight?: string) => {
    let points: [number, number][] = [
      [0, 0],
      [300, 0],
      [300, 300],
      [0, 300]
    ];
    let height = 300;

    if (printableHeight) {
      const parsedH = parseFloat(printableHeight);
      if (!isNaN(parsedH) && parsedH > 0) height = parsedH;
    }

    if (printableArea) {
      // printable_area format: "0x0,300x0,300x300,0x300"
      const pairs = printableArea.split(',').map((s) => s.trim());
      const parsedPoints: [number, number][] = [];
      for (const pair of pairs) {
        const [xStr, yStr] = pair.split('x');
        if (xStr !== undefined && yStr !== undefined) {
          const x = parseFloat(xStr);
          const y = parseFloat(yStr);
          if (!isNaN(x) && !isNaN(y)) {
            parsedPoints.push([x, y]);
          }
        }
      }
      if (parsedPoints.length >= 3) {
        points = parsedPoints;
      }
    }

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const width = maxX - minX;
    const depth = maxY - minY;
    const center: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];

    set({ bedConfig: { points, width, depth, height, center } });
  },

  refreshObjects: async () => {
    try {
      const engine = await getEngine();
      let objs: PlateObject[];
      if (typeof (engine as any).listObjects === 'function') {
        objs = await (engine as any).listObjects();
      } else {
        objs = await engine.call('listObjects', {});
      }

      set({ objects: objs });

      // Update selection if previously selected object was removed
      const { selectedObjectId } = get();
      if (selectedObjectId !== null && !objs.some((o) => o.id === selectedObjectId)) {
        set({ selectedObjectId: null, selectedInstanceId: null });
      }

      // Sync with appStore
      useAppStore.setState({
        modelObjects: objs.map((o) => ({
          id: o.id,
          name: o.name,
          instances: o.instances.length,
          volumes: o.volumes,
          size: o.size
        }))
      });

      return objs;
    } catch (err) {
      console.error('[plateStore] Failed to refresh objects:', err);
      return [];
    }
  },

  selectObject: (objectId: number | null, instanceId?: number | null) => {
    if (objectId === null) {
      set({ selectedObjectId: null, selectedInstanceId: null });
      return;
    }

    const { objects } = get();
    const obj = objects.find((o) => o.id === objectId);
    if (!obj) {
      set({ selectedObjectId: null, selectedInstanceId: null });
      return;
    }

    const instId = instanceId ?? obj.instances[0]?.id ?? null;
    set({ selectedObjectId: objectId, selectedInstanceId: instId });
  },

  setGizmoMode: (mode: GizmoMode) => {
    set({ gizmoMode: mode });
  },

  getMesh: async (objectId: number): Promise<MeshBufferData> => {
    const { meshCache } = get();
    if (meshCache.has(objectId)) {
      return meshCache.get(objectId)!;
    }

    const engine = await getEngine();
    let res: any;
    if (typeof (engine as any).getMesh === 'function') {
      res = await (engine as any).getMesh(objectId);
    } else {
      res = await engine.call('getMesh', { objectId });
    }

    let buffer: Uint8Array;
    if (res.buffer instanceof Uint8Array) {
      buffer = res.buffer;
    } else if (res.buffer instanceof ArrayBuffer) {
      buffer = new Uint8Array(res.buffer);
    } else if (typeof (engine as any).readFile === 'function') {
      buffer = (engine as any).readFile(res.path);
    } else {
      throw new Error('Unable to read binary mesh buffer from engine');
    }

    const parsed = parseMeshBuffer(buffer);
    if (res && res.volumes) {
      parsed.volumes = res.volumes;
    }
    meshCache.set(objectId, parsed);
    set({ meshCache: new Map(meshCache) });
    return parsed;
  },

  setInstanceTransform: async (objectId, instanceId, transform) => {
    const engine = await getEngine();
    if (typeof (engine as any).setInstanceTransform === 'function') {
      await (engine as any).setInstanceTransform({ objectId, instanceId, ...transform });
    } else {
      await engine.call('setInstanceTransform', { objectId, instanceId, ...transform });
    }
    await get().refreshObjects();
    try {
      await useHistoryStore.getState().commitTransaction('Transform object');
    } catch (_) {}
  },

  moveSelection: async (delta: [number, number, number]) => {
    const { objects, selectedObjectId, selectedInstanceId } = get();
    if (selectedObjectId === null || selectedInstanceId === null) return;
    const obj = objects.find((o) => o.id === selectedObjectId);
    const inst = obj?.instances.find((i) => i.id === selectedInstanceId);
    if (!inst) return;

    const newOffset: [number, number, number] = [
      inst.offset[0] + delta[0],
      inst.offset[1] + delta[1],
      inst.offset[2] + delta[2]
    ];

    await get().setInstanceTransform(selectedObjectId, selectedInstanceId, { offset: newOffset });
  },

  rotateSelection: async (euler: [number, number, number]) => {
    const { selectedObjectId, selectedInstanceId } = get();
    if (selectedObjectId === null || selectedInstanceId === null) return;
    await get().setInstanceTransform(selectedObjectId, selectedInstanceId, { rotation: euler });
  },

  scaleSelection: async (scale: [number, number, number]) => {
    const { selectedObjectId, selectedInstanceId } = get();
    if (selectedObjectId === null || selectedInstanceId === null) return;
    await get().setInstanceTransform(selectedObjectId, selectedInstanceId, { scale });
  },

  deleteSelected: async () => {
    const { selectedObjectId } = get();
    if (selectedObjectId === null) return;
    await get().deleteObject(selectedObjectId);
  },

  deleteObject: async (objectId: number) => {
    const engine = await getEngine();
    if (typeof (engine as any).deleteObject === 'function') {
      await (engine as any).deleteObject(objectId);
    } else {
      await engine.call('deleteObject', { objectId });
    }

    const { meshCache } = get();
    meshCache.delete(objectId);
    set({ meshCache: new Map(meshCache) });

    await get().refreshObjects();
    try {
      await useHistoryStore.getState().commitTransaction('Delete object');
    } catch (_) {}
  },

  duplicateSelected: async () => {
    const { selectedObjectId, selectedInstanceId } = get();
    if (selectedObjectId === null || selectedInstanceId === null) return;
    const engine = await getEngine();
    if (typeof (engine as any).duplicateInstance === 'function') {
      await (engine as any).duplicateInstance(selectedObjectId, selectedInstanceId);
    } else {
      await engine.call('duplicateInstance', { objectId: selectedObjectId, instanceId: selectedInstanceId });
    }
    await get().refreshObjects();
    try {
      await useHistoryStore.getState().commitTransaction('Duplicate instance');
    } catch (_) {}
  },

  arrange: async (useBed = false) => {
    set({ isLoading: true });
    try {
      const engine = await getEngine();
      if (typeof (engine as any).arrange === 'function') {
        await (engine as any).arrange({ useBed });
      } else {
        await engine.call('arrange', { useBed });
      }
      await get().refreshObjects();
      try {
        await useHistoryStore.getState().commitTransaction('Arrange objects');
      } catch (_) {}
    } finally {
      set({ isLoading: false });
    }
  },

  importFile: async (file: File) => {
    set({ isLoading: true });
    try {
      const engine = await getEngine();
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (typeof (engine as any).addModel === 'function') {
        await (engine as any).addModel(file.name, bytes);
      } else if (typeof (engine as any).loadModel === 'function' && get().objects.length === 0) {
        await (engine as any).loadModel(file.name, bytes);
      } else {
        await engine.call('addModel', { fileName: file.name, bytes });
      }

      await get().arrange();
      await get().refreshObjects();

      useAppStore.setState({
        modelFile: { name: file.name, size: file.size }
      });
      try {
        await useHistoryStore.getState().commitTransaction(`Import ${file.name}`);
      } catch (_) {}
    } catch (err) {
      console.error('[plateStore] Failed to import model file:', err);
      throw err;
    } finally {
      set({ isLoading: false });
    }
  }
}));

// Expose on window for easy headless / Playwright test access
if (typeof window !== 'undefined') {
  (window as any).__plateStore = usePlateStore;
}
