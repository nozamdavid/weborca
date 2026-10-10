/**
 * @file paintToolsStore.ts
 * Zustand state store for OrcaSlicer Web advanced painting tools.
 */

import { create } from 'zustand';
import { getConfig } from '../engine/orcaEngine';
import { clearPaint, getPaintData } from './paintToolsApi';
import { useHistoryStore } from '../history';
import { useAppStore } from '../store/appStore';
import { usePlateStore } from '../plate/plateStore';
import type { PaintLayer, PaintTool } from './types';

export const CURSOR_RADIUS_MIN = 0.4;
export const CURSOR_RADIUS_MAX = 8.0;
export const CURSOR_RADIUS_STEP = 0.2;

export const SMART_FILL_ANGLE_MIN = 0;
export const SMART_FILL_ANGLE_MAX = 90;
export const SMART_FILL_ANGLE_STEP = 1;

export const OVERHANG_ANGLE_MIN = 0;
export const OVERHANG_ANGLE_MAX = 90;
export const OVERHANG_ANGLE_STEP = 1;

export interface PaintToolsState {
  isActive: boolean;
  layer: PaintLayer;
  tool: PaintTool;
  cursorRadius: number;
  smartFillAngle: number;
  overhangAngle: number;
  overhangOnly: boolean;
  triangleSplitting: boolean;
  activeFilament: number; // 1-based (1..N)
  filamentColors: string[];
  selectedObjectId: number | null;
  selectedInstanceId: number | null;
  selectedVolumeId: number | null;
  isLoading: boolean;
  error: string | null;
  overlayStats: Record<string, number> | null;
  overlayRevision: number;

  // Actions
  setIsActive: (active: boolean) => void;
  setLayer: (layer: PaintLayer) => void;
  setTool: (tool: PaintTool) => void;
  setCursorRadius: (radius: number) => void;
  adjustCursorRadius: (delta: number) => void;
  setSmartFillAngle: (angle: number) => void;
  setOverhangAngle: (angle: number) => void;
  setOverhangOnly: (only: boolean) => void;
  setTriangleSplitting: (splitting: boolean) => void;
  setActiveFilament: (slot: number) => void;
  setFilamentColors: (colors: string[]) => void;
  loadFilamentColors: () => Promise<void>;
  startPainting: (objectId: number, volumeId?: number | null, instanceId?: number | null) => Promise<void>;
  stopPainting: () => void;
  clearCurrentPaint: () => Promise<void>;
  setSelectedVolume: (volumeId: number) => void;
}

let startRevision = 0;

export const usePaintToolsStore = create<PaintToolsState>((set, get) => ({
  isActive: false,
  layer: 'support',
  tool: 'circle',
  cursorRadius: 1.0,
  smartFillAngle: 30,
  overhangAngle: 40,
  overhangOnly: false,
  triangleSplitting: true,
  activeFilament: 1,
  filamentColors: ['#16417C', '#F5D130'],
  selectedObjectId: null,
  selectedInstanceId: null,
  selectedVolumeId: null,
  isLoading: false,
  error: null,
  overlayStats: null,
  overlayRevision: 0,

  setIsActive: (active: boolean) => set({ isActive: active }),

  setLayer: (layer: PaintLayer) => {
    ++startRevision;
    set({ layer, error: null, isLoading: false });
  },

  setTool: (tool: PaintTool) => set({ tool }),

  setCursorRadius: (radius: number) => {
    const clamped = Math.max(CURSOR_RADIUS_MIN, Math.min(CURSOR_RADIUS_MAX, Math.round(radius * 100) / 100));
    set({ cursorRadius: clamped });
  },

  adjustCursorRadius: (delta: number) => {
    const current = get().cursorRadius;
    const next = Math.max(CURSOR_RADIUS_MIN, Math.min(CURSOR_RADIUS_MAX, current + delta));
    set({ cursorRadius: Math.round(next * 100) / 100 });
  },

  setSmartFillAngle: (angle: number) => {
    const clamped = Math.max(SMART_FILL_ANGLE_MIN, Math.min(SMART_FILL_ANGLE_MAX, angle));
    set({ smartFillAngle: clamped });
  },

  setOverhangAngle: (angle: number) => {
    const clamped = Math.max(OVERHANG_ANGLE_MIN, Math.min(OVERHANG_ANGLE_MAX, angle));
    set({ overhangAngle: clamped });
  },

  setOverhangOnly: (only: boolean) => set({ overhangOnly: only }),

  setTriangleSplitting: (splitting: boolean) => set({ triangleSplitting: splitting }),

  setActiveFilament: (slot: number) => {
    const colors = get().filamentColors;
    const clamped = Math.max(1, Math.min(Math.max(colors.length, 1), slot));
    set({ activeFilament: clamped });
  },

  setFilamentColors: (colors: string[]) => set({ filamentColors: colors }),

  loadFilamentColors: async () => {
    try {
      let rawColors: string | undefined;
      try {
        const { useAppStore } = await import('../store/appStore');
        rawColors = useAppStore.getState().currentConfig['filament_colour'];
      } catch (_) {}

      if (!rawColors) {
        const config = await getConfig();
        rawColors = config['filament_colour'];
      }
      if (typeof rawColors === 'string' && rawColors.trim().length > 0) {
        const parsed = rawColors
          .split(';')
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        if (parsed.length > 0) {
          set({ filamentColors: parsed });
          return;
        }
      }
    } catch (_) {
      // Keep defaults
    }
  },

  startPainting: async (objectId: number, volumeId?: number | null, instanceId?: number | null) => {
    const revision = ++startRevision;
    const plate = usePlateStore.getState();
    let resolvedVolume: number | null;
    try {
      const mesh = await plate.getMesh(objectId);
      resolvedVolume = volumeId ?? mesh.volumes?.[0]?.volumeId ?? null;
    } catch (error) {
      if (revision === startRevision) set({ error: error instanceof Error ? error.message : 'Unable to load paintable mesh.' });
      return;
    }
    if (revision !== startRevision) return;
    const resolvedInstance = instanceId ?? plate.objects.find((object) => object.id === objectId)?.instances[0]?.id ?? null;
    set({
      isActive: true,
      selectedObjectId: objectId,
      selectedInstanceId: resolvedInstance,
      selectedVolumeId: resolvedVolume,
      error: resolvedVolume === null ? 'This object has no paintable mesh volume.' : null
    });
    await get().loadFilamentColors();
  },

  stopPainting: () => {
    ++startRevision;
    set({
      isActive: false,
      selectedObjectId: null,
      selectedInstanceId: null,
      selectedVolumeId: null,
      isLoading: false,
      error: null
    });
  },

  clearCurrentPaint: async () => {
    const { selectedObjectId, selectedVolumeId, layer } = get();
    if (selectedObjectId === null || selectedVolumeId === null) return;
    const revision = startRevision;

    try {
      set({ isLoading: true, error: null });
      const before = await getPaintData({ objectId: selectedObjectId, volumeId: selectedVolumeId, layer });
      await clearPaint({
        objectId: selectedObjectId,
        volumeId: selectedVolumeId,
        layer
      });
      const after = await getPaintData({ objectId: selectedObjectId, volumeId: selectedVolumeId, layer });
      if (revision === startRevision) set((state) => ({ isLoading: false, overlayStats: null, overlayRevision: state.overlayRevision + 1 }));
      if (before.data !== after.data) {
        useAppStore.getState().invalidateSlicePreview();
        await useHistoryStore.getState().commitTransaction(`Clear ${layer} painting`);
      }
    } catch (err: any) {
      if (revision === startRevision) set({ isLoading: false, error: err.message || 'Failed to clear painting' });
    }
  },

  setSelectedVolume: (volumeId: number) => {
    ++startRevision;
    set({ selectedVolumeId: volumeId, isLoading: false, error: null });
  }
}));

if (typeof window !== 'undefined') {
  (window as any).__paintToolsStore = usePaintToolsStore;
}
