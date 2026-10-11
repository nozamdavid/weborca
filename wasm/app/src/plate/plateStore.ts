import { usePlatesStore } from '../plates/platesStore';
import { create } from 'zustand';
import { getEngine } from '../engine/orcaEngine';
import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../history';
import type { PlateObject, MeshBufferData, BedConfig, GizmoMode } from './types';
import type { StepImportOptions } from '../engine/types';

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

const PASTE_OFFSET_MM = 20;
let clipboardWork: Promise<void> = Promise.resolve();

/** Arrange options; an empty spacing uses the distance from the print settings. */
export interface ArrangeSettings {
  spacing: number | null;
  allowRotations: boolean;
  plateScope?: 'all' | 'current';
}
const ARRANGE_KEY = 'orca.arrange';
function loadArrangeSettings(): ArrangeSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARRANGE_KEY) ?? '{}');
    return { spacing: typeof parsed.spacing === 'number' ? parsed.spacing : null, allowRotations: parsed.allowRotations === true };
  } catch {
    return { spacing: null, allowRotations: false };
  }
}

export interface InstanceRef {
  objectId: number;
  instanceId: number;
}
type InstanceTransform = {
  offset?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
};

export interface PlateStoreState {
  objects: PlateObject[];
  selectedObjectId: number | null;
  selectedInstanceId: number | null;
  /** Further selected instances besides the primary one (Shift/Ctrl-click, Select all). */
  extraSelection: InstanceRef[];
  /** Instance references marking the independent native clipboard snapshot. */
  clipboard: InstanceRef[];
  clipboardOrigin: [number, number, number];
  gizmoMode: GizmoMode;
  measureActive: boolean;
  measurePoints: Array<[number, number, number]>;
  setMeasureActive: (active: boolean) => void;
  setMeasurePoints: (points: Array<[number, number, number]>) => void;
  explodeActive: boolean;
  explodeFactor: number;
  setExplodeActive: (active: boolean) => void;
  setExplodeFactor: (factor: number) => void;
  bedConfig: BedConfig;
  isLoading: boolean;
  meshCache: Map<number, MeshBufferData>;

  lockedOrientations: number[];
  toggleOrientationLock: (instanceId: number) => void;
  isOrientationLocked: (instanceId: number) => boolean;
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
  toggleSelect: (objectId: number, instanceId: number) => void;
  selectAll: () => void;
  copySelected: (cut?: boolean) => Promise<void>;
  cutSelected: () => Promise<void>;
  pasteClipboard: () => Promise<void>;
  mirrorSelected: (axis: 0 | 1 | 2) => Promise<void>;
  deleteAll: () => Promise<void>;
  deleteObjects: (objectIds: number[]) => Promise<void>;
  duplicateRefs: (refs: InstanceRef[]) => Promise<void>;
  setInstanceTransforms: (entries: ({ objectId: number; instanceId: number } & InstanceTransform)[]) => Promise<void>;
  moveSelection: (delta: [number, number, number]) => Promise<void>;
  rotateSelection: (euler: [number, number, number]) => Promise<void>;
  scaleSelection: (scale: [number, number, number]) => Promise<void>;
  deleteSelected: () => Promise<void>;
  deleteObject: (objectId: number) => Promise<void>;
  duplicateSelected: () => Promise<void>;
  arrange: (useBed?: boolean) => Promise<void>;
  arrangeSettings: ArrangeSettings;
  setArrangeSettings: (settings: Partial<ArrangeSettings>) => void;
  arrangeDialogOpen: boolean;
  setArrangeDialogOpen: (open: boolean) => void;
  importFile: (file: File, options?: StepImportOptions) => Promise<void>;
}

export const usePlateStore = create<PlateStoreState>((set, get) => ({
  lockedOrientations: [],
  toggleOrientationLock: (instanceId: number) => set((state) => ({
    lockedOrientations: state.lockedOrientations.includes(instanceId)
      ? state.lockedOrientations.filter(id => id !== instanceId)
      : [...state.lockedOrientations, instanceId]
  })),
  isOrientationLocked: (instanceId: number) => get().lockedOrientations.includes(instanceId),
  objects: [],
  selectedObjectId: null,
  selectedInstanceId: null,
  extraSelection: [],
  clipboard: [],
  clipboardOrigin: [0, 0, 0],
  arrangeSettings: loadArrangeSettings(),
  arrangeDialogOpen: false,
  setArrangeDialogOpen: (open) => set({ arrangeDialogOpen: open }),
  setArrangeSettings: (settings) => {
    const next = { ...get().arrangeSettings, ...settings };
    set({ arrangeSettings: next });
    try { localStorage.setItem(ARRANGE_KEY, JSON.stringify(next)); } catch (_) {}
  },
  gizmoMode: null,
  measureActive: false,
  measurePoints: [],
  explodeActive: false,
  explodeFactor: 0,
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
      const exists = (r: InstanceRef) => objs.some((o) => o.id === r.objectId && o.instances.some((i) => i.id === r.instanceId));
      set((st) => ({ extraSelection: st.extraSelection.filter(exists) }));

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
      set({ selectedObjectId: null, selectedInstanceId: null, extraSelection: [] });
      return;
    }

    const { objects } = get();
    const obj = objects.find((o) => o.id === objectId);
    if (!obj) {
      set({ selectedObjectId: null, selectedInstanceId: null, extraSelection: [] });
      return;
    }

    const instId = instanceId ?? obj.instances[0]?.id ?? null;
    set({ selectedObjectId: objectId, selectedInstanceId: instId, extraSelection: [] });
  },

  toggleSelect: (objectId, instanceId) => {
    const { selectedObjectId, selectedInstanceId, extraSelection } = get();
    const same = (r: InstanceRef) => r.objectId === objectId && r.instanceId === instanceId;
    if (selectedObjectId === null || selectedInstanceId === null) {
      set({ selectedObjectId: objectId, selectedInstanceId: instanceId, extraSelection: [] });
    } else if (selectedObjectId === objectId && selectedInstanceId === instanceId) {
      // Unselecting the primary hands the role to the next one.
      const [next, ...rest] = extraSelection;
      set({ selectedObjectId: next?.objectId ?? null, selectedInstanceId: next?.instanceId ?? null, extraSelection: rest });
    } else if (extraSelection.some(same)) {
      set({ extraSelection: extraSelection.filter((r) => !same(r)) });
    } else {
      set({ extraSelection: [...extraSelection, { objectId, instanceId }] });
    }
  },

  selectAll: () => {
    const refs = get().objects.flatMap((o) => o.instances.map((i) => ({ objectId: o.id, instanceId: i.id })));
    const [first, ...rest] = refs;
    set({ selectedObjectId: first?.objectId ?? null, selectedInstanceId: first?.instanceId ?? null, extraSelection: rest });
  },

  copySelected: async (cut = false) => {
    const { selectedObjectId, selectedInstanceId, extraSelection } = get();
    if (selectedObjectId === null || selectedInstanceId === null) return;
    const refs = [{ objectId: selectedObjectId, instanceId: selectedInstanceId }, ...extraSelection];
    const plates = usePlatesStore.getState();
    const origin = plates.plates[plates.activePlateIndex]?.origin ?? [0, 0, 0];
    clipboardWork = (async () => {
      const engine = await getEngine();
      await engine.call('copySelection', { instances: refs, cut });
      set({ clipboard: refs, clipboardOrigin: [...origin] as [number, number, number] });
      if (cut) {
        await get().refreshObjects();
        await useHistoryStore.getState().commitTransaction('Cut objects');
      }
    })();
    await clipboardWork;
  },

  cutSelected: async () => get().copySelected(true),

  pasteClipboard: async () => {
    await clipboardWork;
    if (!get().clipboard.length) return;
    const engine = await getEngine();
    const plates = usePlatesStore.getState();
    const origin = plates.plates[plates.activePlateIndex]?.origin ?? [0, 0, 0];
    const copiedOrigin = get().clipboardOrigin;
    const offset = origin.map((value, index) => value - copiedOrigin[index] + (index < 2 ? PASTE_OFFSET_MM : 0));
    const result = await engine.call('pasteSelection', { offset }) as { objectIds: number[] };
    const after = await get().refreshObjects();
    const [first, ...rest] = result.objectIds.flatMap((id) => after.find((o) => o.id === id)?.instances.map((i) => ({ objectId: id, instanceId: i.id })) ?? []);
    if (first) set({ selectedObjectId: first.objectId, selectedInstanceId: first.instanceId, extraSelection: rest });
    await useHistoryStore.getState().commitTransaction(result.objectIds.length > 1 ? 'Paste objects' : 'Paste object');
  },

  mirrorSelected: async (axis) => {
    const { selectedObjectId, selectedInstanceId, extraSelection } = get();
    if (selectedObjectId === null || selectedInstanceId === null) return;
    const engine = await getEngine();
    for (const { objectId, instanceId } of [{ objectId: selectedObjectId, instanceId: selectedInstanceId }, ...extraSelection]) {
      await engine.call('mirrorInstance', { objectId, instanceId, axis });
    }
    await get().refreshObjects();
    try {
      await useHistoryStore.getState().commitTransaction(`Mirror ${'XYZ'[axis]}`);
    } catch (_) {}
  },

  deleteAll: async () => {
    await get().deleteObjects(get().objects.map((o) => o.id));
  },

  setInstanceTransforms: async (entries) => {
    if (entries.length === 0) return;
    const engine = await getEngine();
    for (const { objectId, instanceId, ...transform } of entries) {
      await engine.call('setInstanceTransform', { objectId, instanceId, ...transform });
    }
    await get().refreshObjects();
    try {
      await useHistoryStore.getState().commitTransaction('Transform objects');
    } catch (_) {}
  },

  setMeasureActive: (active) => set({ measureActive: active, measurePoints: [], ...(active ? { explodeActive: false } : {}) }),
  setMeasurePoints: (points) => set({ measurePoints: points }),
  setExplodeActive: (active) => set({ explodeActive: active, ...(active ? { measureActive: false } : { explodeFactor: 0 }) }),
  setExplodeFactor: (factor) => set({ explodeFactor: factor }),

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
    const { objects, selectedObjectId, selectedInstanceId, extraSelection } = get();
    if (selectedObjectId === null || selectedInstanceId === null) return;
    const refs = [{ objectId: selectedObjectId, instanceId: selectedInstanceId }, ...extraSelection];
    const entries = refs.flatMap((r) => {
      const inst = objects.find((o) => o.id === r.objectId)?.instances.find((i) => i.id === r.instanceId);
      return inst ? [{ ...r, offset: [inst.offset[0] + delta[0], inst.offset[1] + delta[1], inst.offset[2] + delta[2]] as [number, number, number] }] : [];
    });
    await get().setInstanceTransforms(entries);
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
    const { selectedObjectId, selectedInstanceId, extraSelection } = get();
    if (selectedObjectId === null || selectedInstanceId === null) return;
    const engine = await getEngine();
    await engine.call('deleteInstances', {
      instances: [{ objectId: selectedObjectId, instanceId: selectedInstanceId }, ...extraSelection]
    });
    await get().refreshObjects();
    await useHistoryStore.getState().commitTransaction('Delete selected instances');
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
    const { selectedObjectId, selectedInstanceId, extraSelection } = get();
    if (selectedObjectId === null || selectedInstanceId === null) return;
    await get().duplicateRefs([{ objectId: selectedObjectId, instanceId: selectedInstanceId }, ...extraSelection]);
  },

  duplicateRefs: async (refs) => {
    const engine = await getEngine();
    for (const { objectId, instanceId } of refs) {
      await engine.call('duplicateInstance', { objectId, instanceId });
    }
    await get().refreshObjects();
    try {
      await useHistoryStore.getState().commitTransaction(refs.length > 1 ? 'Duplicate instances' : 'Duplicate instance');
    } catch (_) {}
  },

  deleteObjects: async (objectIds) => {
    const ids = [...new Set(objectIds)];
    if (ids.length === 0) return;
    const engine = await getEngine();
    const { meshCache } = get();
    for (const objectId of ids) {
      await engine.call('deleteObject', { objectId });
      meshCache.delete(objectId);
    }
    set({ meshCache: new Map(meshCache) });
    await get().refreshObjects();
    try {
      await useHistoryStore.getState().commitTransaction(ids.length > 1 ? 'Delete objects' : 'Delete object');
    } catch (_) {}
  },

  arrange: async (useBed = false) => {
    set({ isLoading: true });
    try {
      const engine = await getEngine();
      const { spacing, allowRotations } = get().arrangeSettings;
      const args: any = { useBed, ...(spacing !== null ? { spacing } : {}), allowRotations, lockedOrientations: get().lockedOrientations };
      const { plateScope } = get().arrangeSettings;
      if (plateScope === 'current') {
        const activePlate = usePlatesStore.getState().activePlateIndex;
        if (activePlate >= 0) args.plateIndex = activePlate;
      }
      const plates = usePlatesStore.getState();
      const targets = useBed && plateScope !== 'current'
        ? (await plates.fetchPlates()).map((plate) => plate.index)
        : [args.plateIndex];
      for (const plateIndex of targets) {
        const options = { ...args, ...(plateIndex !== undefined ? { plateIndex } : {}) };
        if (typeof (engine as any).arrange === 'function') {
          await (engine as any).arrange(options);
        } else {
          await engine.call('arrange', options);
        }
      }
      await get().refreshObjects();
      try {
        await useHistoryStore.getState().commitTransaction('Arrange objects');
      } catch (_) {}
    } finally {
      set({ isLoading: false });
    }
  },

  importFile: async (file: File, options?: StepImportOptions) => {
    set({ isLoading: true });
    try {
      const engine = await getEngine();
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (typeof (engine as any).addModel === 'function') {
        await (engine as any).addModel(file.name, bytes, options);
      } else if (typeof (engine as any).loadModel === 'function' && get().objects.length === 0) {
        await (engine as any).loadModel(file.name, bytes, options);
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
