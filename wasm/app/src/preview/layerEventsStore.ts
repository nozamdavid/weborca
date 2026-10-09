/**
 * @file layerEventsStore.ts
 * Zustand state store managing per-plate layer events (pause and custom G-code)
 * for OrcaSlicer Web preview screen.
 */

import { create } from 'zustand';
import {
  getLayerEvents,
  setLayerEvents,
  clearLayerEvents,
  type LayerEvent
} from '../engine/orcaEngine';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import { useHistoryStore } from '../history';

export interface CustomGcodeDialogState {
  isOpen: boolean;
  plateIndex: number;
  printZ: number;
  layer: number;
  initialGcode: string;
  isEditing: boolean;
}

export interface LayerEventsStoreState {
  eventsByPlate: Record<number, LayerEvent[]>;
  isLoading: boolean;
  error: string | null;
  dialogState: CustomGcodeDialogState | null;

  // Actions
  loadEventsForPlate: (plateIndex: number) => Promise<LayerEvent[]>;
  addPause: (plateIndex: number, printZ: number, message?: string) => Promise<void>;
  saveCustomGcode: (plateIndex: number, printZ: number, gcode: string) => Promise<void>;
  deleteEvent: (plateIndex: number, printZ: number) => Promise<void>;
  openCustomGcodeDialog: (
    plateIndex: number,
    printZ: number,
    layer: number,
    initialGcode?: string,
    isEditing?: boolean
  ) => void;
  closeCustomGcodeDialog: () => void;
}

export function findLayerForZ(z: number, layersZs: number[]): number {
  if (!layersZs || layersZs.length === 0) return 0;
  let bestIdx = 0;
  let bestDiff = Math.abs(layersZs[0] - z);
  for (let i = 1; i < layersZs.length; i++) {
    const diff = Math.abs(layersZs[i] - z);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function getZForLayer(layer: number, layersZs: number[]): number {
  if (layersZs && layersZs[layer] !== undefined) {
    return Number(layersZs[layer].toFixed(4));
  }
  return Number(((layer + 1) * 0.2).toFixed(4));
}

export const useLayerEventsStore = create<LayerEventsStoreState>((set, get) => ({
  eventsByPlate: {},
  isLoading: false,
  error: null,
  dialogState: null,

  loadEventsForPlate: async (plateIndex: number) => {
    try {
      set({ isLoading: true, error: null });
      const res = await getLayerEvents({ plateIndex });
      const events = res.events || [];
      set((state) => ({
        eventsByPlate: {
          ...state.eventsByPlate,
          [plateIndex]: events
        },
        isLoading: false
      }));
      return events;
    } catch (err: any) {
      console.warn(`[layerEventsStore] Failed to load events for plate ${plateIndex}:`, err);
      set({ isLoading: false, error: err.message || String(err) });
      return [];
    }
  },

  addPause: async (plateIndex: number, printZ: number, message = '') => {
    try {
      set({ isLoading: true, error: null });
      const currentList = get().eventsByPlate[plateIndex] || [];
      // Remove any duplicate event at same printZ (native engine allows at most 1 event per layer Z)
      const filtered = currentList.filter(
        (e) => Math.abs(e.printZ - printZ) >= 1e-4
      );
      const newEvent: LayerEvent = {
        printZ,
        type: 'pause',
        message: message || 'Pause print'
      };
      const updated = [...filtered, newEvent].sort((a, b) => a.printZ - b.printZ);

      const res = await setLayerEvents({ plateIndex, events: updated });
      set((state) => ({
        eventsByPlate: {
          ...state.eventsByPlate,
          [plateIndex]: res.events || updated
        },
        isLoading: false
      }));

      // Invalidate slice preview to prompt re-slice (desktop Orca behavior)
      useAppStore.getState().invalidateSlicePreview();

      // Integrate with undo/redo transaction if available
      try {
        const history = useHistoryStore.getState();
        if (history && !history.isRestoring) {
          await history.commitTransaction(`Add pause at ${printZ.toFixed(2)}mm`);
        }
      } catch (_) {}
    } catch (err: any) {
      console.error('[layerEventsStore] Failed to add pause event:', err);
      set({ isLoading: false, error: err.message || String(err) });
      throw err;
    }
  },

  saveCustomGcode: async (plateIndex: number, printZ: number, gcode: string) => {
    try {
      set({ isLoading: true, error: null });
      const currentList = get().eventsByPlate[plateIndex] || [];
      const filtered = currentList.filter(
        (e) => Math.abs(e.printZ - printZ) >= 1e-4
      );
      const newEvent: LayerEvent = {
        printZ,
        type: 'custom',
        gcode: gcode.trim()
      };
      const updated = [...filtered, newEvent].sort((a, b) => a.printZ - b.printZ);

      const res = await setLayerEvents({ plateIndex, events: updated });
      set((state) => ({
        eventsByPlate: {
          ...state.eventsByPlate,
          [plateIndex]: res.events || updated
        },
        isLoading: false,
        dialogState: null
      }));

      // Invalidate slice preview to prompt re-slice
      useAppStore.getState().invalidateSlicePreview();

      // Integrate with undo/redo transaction
      try {
        const history = useHistoryStore.getState();
        if (history && !history.isRestoring) {
          await history.commitTransaction(`Custom G-code at ${printZ.toFixed(2)}mm`);
        }
      } catch (_) {}
    } catch (err: any) {
      console.error('[layerEventsStore] Failed to save custom G-code event:', err);
      set({ isLoading: false, error: err.message || String(err) });
      throw err;
    }
  },

  deleteEvent: async (plateIndex: number, printZ: number) => {
    try {
      set({ isLoading: true, error: null });
      const currentList = get().eventsByPlate[plateIndex] || [];
      const updated = currentList.filter(
        (e) => Math.abs(e.printZ - printZ) >= 1e-4
      );

      if (updated.length === 0) {
        await clearLayerEvents({ plateIndex });
      } else {
        await setLayerEvents({ plateIndex, events: updated });
      }

      set((state) => ({
        eventsByPlate: {
          ...state.eventsByPlate,
          [plateIndex]: updated
        },
        isLoading: false
      }));

      // Invalidate slice preview
      useAppStore.getState().invalidateSlicePreview();

      // Undo/redo transaction
      try {
        const history = useHistoryStore.getState();
        if (history && !history.isRestoring) {
          await history.commitTransaction(`Delete layer event at ${printZ.toFixed(2)}mm`);
        }
      } catch (_) {}
    } catch (err: any) {
      console.error('[layerEventsStore] Failed to delete layer event:', err);
      set({ isLoading: false, error: err.message || String(err) });
      throw err;
    }
  },

  openCustomGcodeDialog: (
    plateIndex: number,
    printZ: number,
    layer: number,
    initialGcode = '',
    isEditing = false
  ) => {
    set({
      dialogState: {
        isOpen: true,
        plateIndex,
        printZ,
        layer,
        initialGcode,
        isEditing
      }
    });
  },

  closeCustomGcodeDialog: () => {
    set({ dialogState: null });
  }
}));

// Expose on window for tests
if (typeof window !== 'undefined') {
  (window as any).__layerEventsStore = useLayerEventsStore;

  // React to plate changes in usePlatesStore
  usePlatesStore.subscribe((state, prevState) => {
    if (state.activePlateIndex !== prevState.activePlateIndex) {
      useLayerEventsStore.getState().loadEventsForPlate(state.activePlateIndex);
    }
  });

  // React to undo/redo restores in useHistoryStore
  useHistoryStore.subscribe(async (state, prevState) => {
    if (prevState.isRestoring && !state.isRestoring) {
      useLayerEventsStore.setState({ eventsByPlate: {} });
      const plates = usePlatesStore.getState().plates;
      for (const p of plates) {
        await useLayerEventsStore.getState().loadEventsForPlate(p.index);
      }
    }
  });
}
