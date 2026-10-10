/**
 * @file types.ts
 * Type definitions for the G-code preview viewer and controls.
 */

export interface LegendItem {
  id: number;
  name: string;
  color: string;
  visible: boolean;
  timeS?: number;
  percent?: number;
}

export interface LegendOption {
  id: number;
  name: string;
  color: string;
  visible: boolean;
}

export interface LegendRange {
  color: string;
  value: number;
}

export interface LegendData {
  viewType: string;
  title: string;
  type: 'features' | 'range' | 'tool';
  items?: LegendItem[];
  ranges?: LegendRange[];
  options?: LegendOption[];
}

export interface SliceFeatureStat {
  name: string;
  timeS: number;
  percent: number;
}

export interface PreviewStatistics {
  layers: number;
  moves: number;
  timeS: number;
  filamentMm: number;
  filamentG: number;
  travelDistance?: number;
  travelMoves?: number;
  features: SliceFeatureStat[];
  error?: string;
}

export type PreviewViewType =
  | 'FeatureType'
  | 'Speed'
  | 'ActualSpeed'
  | 'Acceleration'
  | 'Jerk'
  | 'Height'
  | 'Width'
  | 'VolumetricFlowRate'
  | 'ActualVolumetricFlowRate'
  | 'LayerTimeLinear'
  | 'LayerTimeLogarithmic'
  | 'FanSpeed'
  | 'Temperature'
  | 'PressureAdvance'
  | 'Tool'
  | 'ColorPrint'
  | 'Summary';
