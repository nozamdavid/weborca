/**
 * @file layersStore.ts
 * Zustand store for Variable Layer Height & Adaptive Slicing.
 */

import { create } from 'zustand';
import {
  getLayerHeightProfile,
  adaptiveLayerHeights,
  smoothLayerHeights,
  adjustLayerHeights,
  resetLayerHeights
} from './layersClient';
import type {
  LayerHeightProfileData,
  LayerEditAction
} from './types';

export interface LayersStoreState {
  isLayersActive: boolean;
  selectedObjectId: number | null;
  profileData: LayerHeightProfileData | null;
  quality: number;
  radius: number;
  keepMin: boolean;
  bandWidth: number;
  delta: number;
  cursorZ: number | null;
  isLoading: boolean;
  error: string | null;

  startEditing: (objectId: number) => Promise<void>;
  stopEditing: () => void;
  setQuality: (quality: number) => void;
  setRadius: (radius: number) => void;
  setKeepMin: (keepMin: boolean) => void;
  setBandWidth: (bandWidth: number) => void;
  setDelta: (delta: number) => void;
  setCursorZ: (z: number | null) => void;
  applyAdaptive: (quality?: number) => Promise<void>;
  applySmooth: (radius?: number, keepMin?: boolean) => Promise<void>;
  applyAdjust: (
    z: number,
    action: LayerEditAction,
    delta?: number,
    bandWidth?: number
  ) => Promise<void>;
  applyReset: () => Promise<void>;
  reloadProfile: () => Promise<void>;
}

export const useLayersStore = create<LayersStoreState>((set, get) => ({
  isLayersActive: false,
  selectedObjectId: null,
  profileData: null,
  quality: 0.5,
  radius: 5,
  keepMin: false,
  bandWidth: 2.0,
  delta: 0.005,
  cursorZ: null,
  isLoading: false,
  error: null,

  startEditing: async (objectId: number) => {
    set({
      isLayersActive: true,
      selectedObjectId: objectId,
      isLoading: true,
      error: null
    });
    try {
      const data = await getLayerHeightProfile(objectId);
      set({ profileData: data, isLoading: false });
    } catch (err: any) {
      set({
        error: err?.message || 'Failed to load layer height profile',
        isLoading: false
      });
    }
  },

  stopEditing: () => {
    set({
      isLayersActive: false,
      selectedObjectId: null,
      profileData: null,
      cursorZ: null,
      error: null
    });
  },

  setQuality: (quality: number) => {
    set({ quality: Math.max(0.0, Math.min(1.0, quality)) });
  },

  setRadius: (radius: number) => {
    set({ radius: Math.max(1, Math.round(radius)) });
  },

  setKeepMin: (keepMin: boolean) => {
    set({ keepMin });
  },

  setBandWidth: (bandWidth: number) => {
    set({ bandWidth: Math.max(0.2, Math.min(20.0, bandWidth)) });
  },

  setDelta: (delta: number) => {
    set({ delta: Math.max(0.001, delta) });
  },

  setCursorZ: (z: number | null) => {
    set({ cursorZ: z });
  },

  applyAdaptive: async (quality?: number) => {
    const { selectedObjectId } = get();
    if (selectedObjectId === null) return;
    const q = quality !== undefined ? quality : get().quality;
    set({ isLoading: true, error: null });
    try {
      const res = await adaptiveLayerHeights({
        objectId: selectedObjectId,
        quality: q
      });
      const current = get().profileData;
      if (current) {
        set({
          profileData: {
            ...current,
            profile: res.profile,
            layerCount: res.layerCount,
            layers: res.layers,
            ranges: res.ranges,
            hasCustomProfile: true
          },
          isLoading: false
        });
      } else {
        await get().reloadProfile();
      }
    } catch (err: any) {
      set({
        error: err?.message || 'Failed to calculate adaptive layers',
        isLoading: false
      });
    }
  },

  applySmooth: async (radius?: number, keepMin?: boolean) => {
    const { selectedObjectId } = get();
    if (selectedObjectId === null) return;
    const r = radius !== undefined ? radius : get().radius;
    const km = keepMin !== undefined ? keepMin : get().keepMin;
    set({ isLoading: true, error: null });
    try {
      const res = await smoothLayerHeights({
        objectId: selectedObjectId,
        radius: r,
        keepMin: km
      });
      const current = get().profileData;
      if (current) {
        set({
          profileData: {
            ...current,
            profile: res.profile,
            layerCount: res.layerCount,
            layers: res.layers,
            ranges: res.ranges,
            hasCustomProfile: true
          },
          isLoading: false
        });
      } else {
        await get().reloadProfile();
      }
    } catch (err: any) {
      set({
        error: err?.message || 'Failed to smooth layer heights',
        isLoading: false
      });
    }
  },

  applyAdjust: async (
    z: number,
    action: LayerEditAction,
    delta?: number,
    bandWidth?: number
  ) => {
    const { selectedObjectId } = get();
    if (selectedObjectId === null) return;
    const d = delta !== undefined ? delta : get().delta;
    const bw = bandWidth !== undefined ? bandWidth : get().bandWidth;
    try {
      const res = await adjustLayerHeights({
        objectId: selectedObjectId,
        z,
        delta: d,
        bandWidth: bw,
        action
      });
      const current = get().profileData;
      if (current) {
        set({
          profileData: {
            ...current,
            profile: res.profile,
            layerCount: res.layerCount,
            layers: res.layers,
            ranges: res.ranges,
            hasCustomProfile: true
          }
        });
      }
    } catch (err: any) {
      set({ error: err?.message || 'Failed to adjust layer heights' });
    }
  },

  applyReset: async () => {
    const { selectedObjectId } = get();
    if (selectedObjectId === null) return;
    set({ isLoading: true, error: null });
    try {
      const res = await resetLayerHeights(selectedObjectId);
      const current = get().profileData;
      if (current) {
        set({
          profileData: {
            ...current,
            profile: res.profile,
            layerCount: res.layerCount,
            layers: res.layers,
            ranges: res.ranges,
            hasCustomProfile: false
          },
          isLoading: false
        });
      } else {
        await get().reloadProfile();
      }
    } catch (err: any) {
      set({
        error: err?.message || 'Failed to reset layer heights',
        isLoading: false
      });
    }
  },

  reloadProfile: async () => {
    const { selectedObjectId } = get();
    if (selectedObjectId === null) return;
    try {
      const data = await getLayerHeightProfile(selectedObjectId);
      set({ profileData: data, isLoading: false });
    } catch (err: any) {
      set({
        error: err?.message || 'Failed to reload profile',
        isLoading: false
      });
    }
  }
}));
