/**
 * @file types.ts
 * Types for OrcaSlicer Web History / Undo-Redo system.
 */

export interface HistorySelection {
  objectName?: string;
  objectIndex?: number;
  instanceIndex?: number;
  volumeId?: number;
}

export interface HistoryPaintState {
  isPaintingActive: boolean;
  paintTarget: 'support' | 'seam';
  selectedVolumeId: number | null;
}

export interface HistoryPlateInfo {
  index: number;
  name: string;
  locked: boolean;
  config: Record<string, string>;
  filamentMaps?: number[];
}

export interface HistoryPlateState {
  plates: HistoryPlateInfo[];
  activePlateIndex: number;
}

export interface HistorySettingsState {
  vendor: string;
  printer: string;
  process: string;
  filaments: string[];
  activeUserPreset: {
    process: string | null;
    filament: string | null;
    printer: string | null;
  };
  processOverrides: Record<string, string>;
  filamentOverrides: Record<string, string>;
  printerOverrides: Record<string, string>;
  presetConfig: Record<string, string>;
  currentConfig: Record<string, string>;
  options?: Record<string, string>;
}

export interface HistorySnapshot {
  id: string;
  description: string;
  timestamp: number;
  isEmpty: boolean;
  filePath?: string; // Path in MEMFS, e.g. /out/undo_slot_0.3mf
  slotId?: number;
  byteSize: number;
  selection: HistorySelection | null;
  paintState: HistoryPaintState | null;
  modelFileName: string | null;
  plateState?: HistoryPlateState;
  settings?: HistorySettingsState;
}

export interface HistoryStoreState {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  currentSnapshot: HistorySnapshot | null;
  isRestoring: boolean;
  canUndo: boolean;
  canRedo: boolean;
  maxSnapshots: number;
  maxBytes: number;
  totalRetainedBytes: number;

  // Actions
  initHistory: () => Promise<void>;
  commitTransaction: (description: string) => Promise<void>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  clearHistory: () => Promise<void>;
}
