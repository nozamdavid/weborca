import type { AppState } from '../store/appStore';

export function readinessAction(reason: string): 'printer' | 'process' | 'filament' | 'model' | null {
  switch (reason) {
    case 'Select a printer to slice.': return 'printer';
    case 'Select a process preset to slice.': return 'process';
    case 'Select a filament to slice.': return 'filament';
    case 'Add a model to slice.': return 'model';
    default: return null;
  }
}

/** Shared by every Slice button and both store entry points. */
export function slicePrerequisites(s: AppState, restoring: boolean): string {
  if (!s.isEngineReady) return s.engineError ? 'Engine unavailable. Check your connection and retry.' : s.engineLoad.phase === 'downloading' ? 'Downloading engine...' : 'Initializing engine...';
  if (!s.modelFile || /\.gcode$/i.test(s.modelFile.name)) return 'Add a model to slice.';
  if (s.isModelLoading || s.isSelectingPreset || restoring || Object.keys(s.pendingOptions).length > 0) return 'Wait for the current operation to finish.';
  if (s.isSlicing) return 'Slicing...';
  if (!s.selectedPrinter) return 'Select a printer to slice.';
  if (!s.selectedProcess) return 'Select a process preset to slice.';
  if (!(s.selectedFilaments?.length || s.selectedFilament)) return 'Select a filament to slice.';
  return '';
}
