import { create } from 'zustand';
import { SurfaceFeature, MeasurementResult, SnapMode } from './types';

interface MeasureState {
  snapMode: SnapMode;
  feature1: SurfaceFeature | null;
  feature2: SurfaceFeature | null;
  hoveredFeature: SurfaceFeature | null;
  result: MeasurementResult | null;
  error: string | null;
  resetGeneration: number;
  setSnapMode: (mode: SnapMode) => void;
  setFeature1: (feat: SurfaceFeature | null) => void;
  setFeature2: (feat: SurfaceFeature | null) => void;
  setHoveredFeature: (feat: SurfaceFeature | null) => void;
  setResult: (res: MeasurementResult | null) => void;
  setError: (err: string | null) => void;
  resetSelection: () => void;
  resetAll: () => void;
}

export const useMeasureStore = create<MeasureState>((set) => ({
  snapMode: 'auto',
  feature1: null,
  feature2: null,
  hoveredFeature: null,
  result: null,
  error: null,
  resetGeneration: 0,

  setSnapMode: (mode) => set({ snapMode: mode }),
  setFeature1: (feat) => set({ feature1: feat }),
  setFeature2: (feat) => set({ feature2: feat }),
  setHoveredFeature: (feat) => set({ hoveredFeature: feat }),
  setResult: (res) => set({ result: res }),
  setError: (err) => set({ error: err }),

  resetSelection: () =>
    set((state) => ({
      feature1: null,
      feature2: null,
      hoveredFeature: null,
      result: null,
      error: null,
      resetGeneration: state.resetGeneration + 1,
    })),

  resetAll: () =>
    set((state) => ({
      snapMode: 'auto',
      feature1: null,
      feature2: null,
      hoveredFeature: null,
      result: null,
      error: null,
      resetGeneration: state.resetGeneration + 1,
    })),
}));

if (typeof window !== 'undefined') {
  (window as any).__measureStore = useMeasureStore;
}
