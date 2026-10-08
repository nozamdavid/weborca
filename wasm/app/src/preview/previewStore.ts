/**
 * @file previewStore.ts
 * Zustand state store for G-code preview controls, sliders, and legend.
 */

import { create } from 'zustand';
import type { PreviewStatistics, LegendData, PreviewViewType } from './types';
import * as previewModule from './orcaPreviewModule';

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
  viewType: 'FeatureType',
  legend: { viewType: 'FeatureType', title: 'Line Type', type: 'features', items: [], options: [] },
  showStatsPanel: true,

  setInitialized: (val: boolean) => set({ isInitialized: val }),

  loadGcodeBytes: async (data, name = 'print.gcode') => {
    set({ isLoading: true });
    try {
      const stats = previewModule.loadGcode(data, name);
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
  }
}));
