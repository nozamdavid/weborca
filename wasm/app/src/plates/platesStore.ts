import { create } from 'zustand';
import { getEngine, slice } from '../engine/orcaEngine';
import { useAppStore } from '../store/appStore';
import type { ProgressNotification, SliceResult } from '../engine/types';
import { plateTitle } from './plateName';
import type { PlateInfo } from './types';

export interface PlatesStoreState {
  plates: PlateInfo[];
  activePlateIndex: number;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchPlates: () => Promise<PlateInfo[]>;
  setActivePlate: (index: number) => void;
  addPlate: (name?: string, config?: Record<string, string>) => Promise<PlateInfo[]>;
  deletePlate: (index: number, deleteObjects?: boolean) => Promise<PlateInfo[]>;
  setPlateConfig: (
    index: number,
    config: Record<string, string>,
    name?: string,
    locked?: boolean
  ) => Promise<void>;
  slicePlate: (plateIndex: number) => Promise<void>;
  sliceAll: () => Promise<void>;
}

export const usePlatesStore = create<PlatesStoreState>((set, get) => ({
  plates: [
    {
      index: 0,
      name: plateTitle('', 0),
      locked: false,
      origin: [0, 0, 0],
      size: [256, 256, 256],
      instances: [],
      config: {}
    }
  ],
  activePlateIndex: 0,
  isLoading: false,
  error: null,

  fetchPlates: async () => {
    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      const platesRaw: any = await engine.call('listPlates', {});
      const plates: PlateInfo[] = Array.isArray(platesRaw)
        ? platesRaw.map((p) => ({
            index: p.index ?? 0,
            name: plateTitle(p.name, p.index ?? 0),
            locked: !!p.locked,
            origin: p.origin || [0, 0, 0],
            size: p.size || [256, 256, 256],
            instances: (p.instances || []).map((i: any) => ({
              objectId: i.objectId,
              instanceId: i.instanceId,
              objectIndex: i.objectIndex,
              instanceIndex: i.instanceIndex
            })),
            config: p.config || {},
            filamentMaps: p.filamentMaps
          }))
        : [];

      set({
        plates: plates.length > 0 ? plates : get().plates,
        isLoading: false
      });

      // If active plate index is beyond plates length, reset to 0
      const { activePlateIndex } = get();
      if (activePlateIndex >= plates.length) {
        set({ activePlateIndex: 0 });
      }

      return plates;
    } catch (err: any) {
      console.warn('[platesStore] Failed to fetch plates:', err);
      set({ isLoading: false, error: err.message || String(err) });
      return get().plates;
    }
  },

  setActivePlate: (index: number) => {
    const { plates } = get();
    if (index >= 0 && index < plates.length) {
      set({ activePlateIndex: index });
    }
  },

  addPlate: async (name?: string, config?: Record<string, string>) => {
    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      const payload: any = {};
      if (name) payload.name = name;
      if (config) payload.config = config;

      await engine.call('addPlate', payload);
      const plates = await get().fetchPlates();
      set({ activePlateIndex: plates.length - 1, isLoading: false });
      return plates;
    } catch (err: any) {
      console.error('[platesStore] Failed to add plate:', err);
      set({ isLoading: false, error: err.message || String(err) });
      return get().plates;
    }
  },

  deletePlate: async (index: number, deleteObjects = false) => {
    try {
      set({ isLoading: true, error: null });
      const engine = await getEngine();
      await engine.call('deletePlate', { plateIndex: index, deleteObjects });
      const plates = await get().fetchPlates();

      let nextActive = get().activePlateIndex;
      if (nextActive >= plates.length) {
        nextActive = Math.max(0, plates.length - 1);
      }
      set({ activePlateIndex: nextActive, isLoading: false });
      return plates;
    } catch (err: any) {
      console.error('[platesStore] Failed to delete plate:', err);
      set({ isLoading: false, error: err.message || String(err) });
      return get().plates;
    }
  },

  setPlateConfig: async (
    index: number,
    config: Record<string, string>,
    name?: string,
    locked?: boolean
  ) => {
    try {
      const engine = await getEngine();
      // The engine creates its first plate when the plates are first listed; renaming that one needs it to exist.
      await engine.call('listPlates', {});
      const payload: any = { plateIndex: index, config };
      if (name !== undefined) payload.name = name;
      if (locked !== undefined) payload.locked = locked;

      await engine.call('setPlateConfig', payload);
      await get().fetchPlates();
    } catch (err: any) {
      console.error('[platesStore] Failed to set plate config:', err);
      set({ error: err.message || String(err) });
    }
  },

  slicePlate: async (plateIndex: number) => {
    const appState = useAppStore.getState();
    if (appState.isSlicing) return;

    const abortController = new AbortController();
    useAppStore.setState({
      isSlicing: true,
      slicePercent: 0,
      sliceStatusText: `Slicing Plate ${plateIndex + 1}...`,
      sliceResult: null,
      engineError: null,
      abortController
    });

    try {
      const threads = Math.min(
        typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4,
        8
      );

      const result: SliceResult = await slice({
        plateIndex,
        threads,
        signal: abortController.signal,
        onProgress: (prog: ProgressNotification) => {
          const pct = Math.max(0, Math.min(100, prog.percent ?? 0));
          useAppStore.setState({
            slicePercent: pct,
            sliceStatusText: prog.text ? `Slicing Plate ${plateIndex + 1}: ${prog.text} (${pct}%)` : `Slicing Plate ${plateIndex + 1} (${pct}%)`
          });
        }
      });

      const { gcodeUrl: oldUrl } = useAppStore.getState();
      if (oldUrl) URL.revokeObjectURL(oldUrl);

      const blob = new Blob([result.gcode as unknown as BlobPart], { type: 'text/plain;charset=utf-8' });
      const gcodeUrl = URL.createObjectURL(blob);

      useAppStore.setState({
        isSlicing: false,
        slicePercent: 100,
        sliceStatusText: `Plate ${plateIndex + 1} slicing complete!`,
        sliceResult: result,
        gcodeUrl,
        abortController: null
      });
    } catch (err: any) {
      const isCanceled = err.name === 'AbortError' || err.canceled || err.message === 'canceled';
      useAppStore.setState({
        isSlicing: false,
        abortController: null,
        sliceStatusText: isCanceled ? 'Slicing canceled' : 'Slicing failed',
        engineError: isCanceled ? null : `Slicing error: ${err.message || String(err)}`
      });
    }
  },

  sliceAll: async () => {
    const { plates, slicePlate } = get();
    for (let i = 0; i < plates.length; i++) {
      await slicePlate(i);
    }
  }
}));

if (typeof window !== 'undefined') {
  (window as any).__platesStore = usePlatesStore;
}
