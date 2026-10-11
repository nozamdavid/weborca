/**
 * @file previewStore.ts
 * Zustand state store for G-code preview controls, sliders, and legend.
 */

import { create } from 'zustand';
import type { PreviewStatistics, LegendData, PreviewViewType } from './types';
import * as previewModule from './orcaPreviewModule';

export const PREVIEW_VIEW_TYPE_STORAGE_KEY = 'orcaslicer_preview_view_type_v1';
const VIEW_TYPES: readonly PreviewViewType[] = [
  'FeatureType', 'Speed', 'ActualSpeed', 'Acceleration', 'Jerk', 'Height', 'Width',
  'VolumetricFlowRate', 'ActualVolumetricFlowRate', 'LayerTimeLinear', 'LayerTimeLogarithmic',
  'FanSpeed', 'Temperature', 'PressureAdvance', 'Tool', 'ColorPrint', 'Summary'
];

function loadStoredViewType(): PreviewViewType {
  try {
    const value = window.localStorage.getItem(PREVIEW_VIEW_TYPE_STORAGE_KEY);
    if (VIEW_TYPES.includes(value as PreviewViewType)) return value as PreviewViewType;
  } catch { /* Preview still works when browser storage is unavailable. */ }
  return 'FeatureType';
}

export interface PreviewStoreState {
  isInitialized: boolean;
  isLoading: boolean;
  stats: PreviewStatistics | null;
  layersCount: number;
  layersZs: number[];
  minLayer: number;
  maxLayer: number;
  minMove: number;
  maxMove: number;
  currentMove: number;
  viewType: PreviewViewType;
  legend: LegendData;
  showStatsPanel: boolean;
  showGcodeWindow: boolean;

  setInitialized: (val: boolean) => void;
  loadGcodeBytes: (data: Uint8Array | ArrayBuffer | string, name?: string) => Promise<PreviewStatistics>;
  setLayerRangeAction: (min: number, max: number) => void;
  setMoveAction: (move: number) => void;
  setViewTypeAction: (viewType: PreviewViewType) => void;
  toggleExtrusionRoleAction: (roleId: number) => void;
  toggleOptionAction: (optId: number) => void;
  resetLayersAction: () => void;
  resetCameraAction: () => void;
  toggleStatsPanelAction: () => void;
  toggleGcodeWindowAction: () => void;
  setShowGcodeWindowAction: (val: boolean) => void;
}

export const usePreviewStore = create<PreviewStoreState>((set, get) => ({
  isInitialized: false,
  isLoading: false,
  stats: null,
  layersCount: 0,
  layersZs: [],
  minLayer: 0,
  maxLayer: 0,
  minMove: 0,
  maxMove: 0,
  currentMove: 0,
  viewType: loadStoredViewType(),
  legend: { viewType: 'FeatureType', title: 'Line Type', type: 'features', items: [], options: [] },
  showStatsPanel: true,
  showGcodeWindow: false,

  setInitialized: (val: boolean) => {
    if (val) previewModule.setViewType(get().viewType);
    set({ isInitialized: val, ...(val ? { legend: previewModule.getLegendData() } : {}) });
  },

  loadGcodeBytes: async (data, name = 'print.gcode') => {
    set({ isLoading: true });
    try {
      const stats = previewModule.loadGcode(data, name);
      // Loading G-code can reset the native viewer's color scheme.
      previewModule.setViewType(get().viewType);
      const zs = previewModule.getLayersZs();
      const moveRange = previewModule.getMoveRange();
      const legend = previewModule.getLegendData();

      const layers = stats.layers;
      set({
        stats,
        layersCount: layers,
        layersZs: zs,
        minLayer: 0,
        maxLayer: Math.max(0, layers - 1),
        minMove: moveRange.min,
        maxMove: moveRange.max,
        currentMove: moveRange.max,
        legend,
        isLoading: false
      });

      previewModule.render();
      return stats;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  setLayerRangeAction: (min: number, max: number) => {
    const { layersCount } = get();
    const clMin = Math.max(0, Math.min(min, layersCount - 1));
    const clMax = Math.max(clMin, Math.min(max, layersCount - 1));

    previewModule.setLayerRange(clMin, clMax);
    const moveRange = previewModule.getMoveRange();

    set({
      minLayer: clMin,
      maxLayer: clMax,
      minMove: moveRange.min,
      maxMove: moveRange.max,
      currentMove: moveRange.max
    });

    previewModule.render();
  },

  setMoveAction: (move: number) => {
    const { minMove, maxMove } = get();
    const clMove = Math.max(minMove, Math.min(move, maxMove));
    previewModule.setMove(clMove);
    set({ currentMove: clMove });
    previewModule.render();
  },

  setViewTypeAction: (viewType: PreviewViewType) => {
    if (!VIEW_TYPES.includes(viewType) || viewType === get().viewType) return;
    try { window.localStorage.setItem(PREVIEW_VIEW_TYPE_STORAGE_KEY, viewType); }
    catch { /* Keep the selection for this session even if persistence is unavailable. */ }
    previewModule.setViewType(viewType);
    const legend = previewModule.getLegendData();
    set({ viewType, legend });
    previewModule.render();
  },

  toggleExtrusionRoleAction: (roleId: number) => {
    previewModule.toggleExtrusionRole(roleId);
    const legend = previewModule.getLegendData();
    set({ legend });
    previewModule.render();
  },

  toggleOptionAction: (optId: number) => {
    previewModule.toggleOption(optId);
    const legend = previewModule.getLegendData();
    set({ legend });
    previewModule.render();
  },

  resetLayersAction: () => {
    const { layersCount } = get();
    const max = Math.max(0, layersCount - 1);
    previewModule.setLayerRange(0, max);
    const moveRange = previewModule.getMoveRange();
    set({
      minLayer: 0,
      maxLayer: max,
      minMove: moveRange.min,
      maxMove: moveRange.max,
      currentMove: moveRange.max
    });
    previewModule.render();
  },

  resetCameraAction: () => {
    previewModule.resetCamera();
    previewModule.render();
  },

  toggleStatsPanelAction: () => {
    set((state) => ({ showStatsPanel: !state.showStatsPanel }));
  },

  toggleGcodeWindowAction: () => {
    set((state) => ({ showGcodeWindow: !state.showGcodeWindow }));
  },

  setShowGcodeWindowAction: (val: boolean) => {
    set({ showGcodeWindow: val });
  }
}));

(window as any).__previewStore = usePreviewStore;
