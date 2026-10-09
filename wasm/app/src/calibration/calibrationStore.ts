/**
 * @file calibrationStore.ts
 * Zustand state store for Flow Rate Calibration dialog and calculator.
 */

import { create } from 'zustand';
import { useAppStore } from '../store/appStore';
import { usePlateStore } from '../plate/plateStore';
import { useHistoryStore } from '../history';
import {
  calculateNewFlowRatio,
  isValidFlowRatio,
  isValidModifier,
  runFlowRateCalibration
} from './flowRateCalibration';
import type { CalibrationState, FlowRatePass, InfillPattern } from './types';

export const useCalibrationStore = create<CalibrationState>((set, get) => ({
  isOpen: false,
  activeTab: 'generator',
  selectedPass: 1,
  selectedPattern: 'archimedeanchords',
  showConfirmReplace: false,
  isCalibrating: false,
  statusMessage: null,
  errorMessage: null,

  calculatorModifier: '',
  customOldFlow: '',
  calculatedNewFlow: null,
  calculatorMessage: null,

  openDialog: () => {
    // Refresh current flow ratio from app store
    const currentConfig = useAppStore.getState().currentConfig;
    const currentFlowStr = currentConfig['filament_flow_ratio'] || '1.0';
    const currentFlow = parseFloat(currentFlowStr) || 1.0;

    set({
      isOpen: true,
      activeTab: 'generator',
      showConfirmReplace: false,
      statusMessage: null,
      errorMessage: null,
      calculatorMessage: null,
      customOldFlow: isValidFlowRatio(currentFlow) ? currentFlow : 1.0,
      calculatedNewFlow: null,
      calculatorModifier: ''
    });
  },

  closeDialog: () => {
    set({
      isOpen: false,
      showConfirmReplace: false,
      statusMessage: null,
      errorMessage: null,
      calculatorMessage: null
    });
  },

  setActiveTab: (tab: 'generator' | 'calculator') => set({ activeTab: tab, errorMessage: null }),

  setSelectedPass: (pass: FlowRatePass) => set({ selectedPass: pass }),

  setSelectedPattern: (pattern: InfillPattern) => set({ selectedPattern: pattern }),

  setCalculatorModifier: (val: number | '') => {
    set({ calculatorModifier: val });
    // Automatically re-calculate if valid finite positive inputs
    if (typeof val === 'number') {
      const { customOldFlow } = get();
      const currentConfig = useAppStore.getState().currentConfig;
      const baseFlow =
        typeof customOldFlow === 'number'
          ? customOldFlow
          : parseFloat(currentConfig['filament_flow_ratio'] || '1.0') || 1.0;

      if (isValidFlowRatio(baseFlow) && isValidModifier(val)) {
        const newFlow = calculateNewFlowRatio(baseFlow, val);
        set({
          calculatedNewFlow: isValidFlowRatio(newFlow) ? newFlow : null,
          errorMessage: null
        });
      } else {
        set({ calculatedNewFlow: null });
      }
    } else {
      set({ calculatedNewFlow: null });
    }
  },

  setCustomOldFlow: (val: number | '') => {
    set({ customOldFlow: val });
    const { calculatorModifier } = get();
    if (typeof val === 'number' && typeof calculatorModifier === 'number') {
      if (isValidFlowRatio(val) && isValidModifier(calculatorModifier)) {
        const newFlow = calculateNewFlowRatio(val, calculatorModifier);
        set({
          calculatedNewFlow: isValidFlowRatio(newFlow) ? newFlow : null,
          errorMessage: null
        });
      } else {
        set({ calculatedNewFlow: null });
      }
    } else {
      set({ calculatedNewFlow: null });
    }
  },

  calculate: () => {
    const { calculatorModifier, customOldFlow } = get();
    const currentConfig = useAppStore.getState().currentConfig;
    const baseFlow =
      typeof customOldFlow === 'number'
        ? customOldFlow
        : parseFloat(currentConfig['filament_flow_ratio'] || '1.0') || 1.0;

    if (!isValidFlowRatio(baseFlow)) {
      set({ calculatedNewFlow: null, errorMessage: 'Flow ratio must be a finite positive number.' });
      return;
    }
    if (typeof calculatorModifier !== 'number' || !isValidModifier(calculatorModifier)) {
      set({
        calculatedNewFlow: null,
        errorMessage: 'Please enter a valid modifier percentage between -50% and +50%.'
      });
      return;
    }

    const newFlow = calculateNewFlowRatio(baseFlow, calculatorModifier);
    if (!isValidFlowRatio(newFlow)) {
      set({ calculatedNewFlow: null, errorMessage: 'Calculated flow ratio must be a finite positive number.' });
      return;
    }

    set({ calculatedNewFlow: newFlow, errorMessage: null });
  },

  applyCalculatedFlow: async () => {
    const { calculatedNewFlow } = get();
    if (calculatedNewFlow === null || !isValidFlowRatio(calculatedNewFlow)) {
      set({ errorMessage: 'Cannot apply invalid flow ratio. Please enter valid parameters.' });
      return;
    }

    const appStore = useAppStore.getState();
    const newFlowStr = calculatedNewFlow.toFixed(4);

    try {
      // 1. Apply to active session filament config
      await appStore.applyOptionChange('filament_flow_ratio', newFlowStr, 'filament');

      const activeUserPresetName = appStore.activeUserPreset.filament;
      if (activeUserPresetName) {
        // User preset: update it safely
        await appStore.saveCurrentUserPreset('filament', activeUserPresetName);
        set({
          calculatorMessage: `Applied flow ratio ${newFlowStr} to user preset "${activeUserPresetName}".`,
          errorMessage: null
        });
      } else {
        // System preset: NEVER mutate system presets
        set({
          calculatorMessage: `Applied flow ratio ${newFlowStr} to active session. System preset "${appStore.selectedFilament}" is protected and remains unaltered.`,
          errorMessage: null
        });
      }
    } catch (err: any) {
      set({
        errorMessage: `Failed to apply flow ratio: ${err.message || String(err)}`
      });
    }
  },

  startCalibration: async () => {
    // Guard overlapping generation and ongoing project tasks using existing busy patterns
    const { isCalibrating } = get();
    const appState = useAppStore.getState();
    const histState = useHistoryStore.getState();
    if (isCalibrating || appState.isSlicing || histState.isRestoring) {
      return;
    }

    const plateObjects = usePlateStore.getState().objects;
    if (plateObjects.length > 0) {
      // Current project exists on plate -> require explicit user confirmation
      set({ showConfirmReplace: true, statusMessage: null, errorMessage: null });
      return;
    }

    await executeCalibrationInternal(get, set);
  },

  confirmReplaceAndStart: async () => {
    // Guard overlapping generation
    const { isCalibrating } = get();
    const appState = useAppStore.getState();
    const histState = useHistoryStore.getState();
    if (isCalibrating || appState.isSlicing || histState.isRestoring) {
      return;
    }

    set({ showConfirmReplace: false });
    await executeCalibrationInternal(get, set);
  },

  cancelConfirmReplace: () => {
    set({
      showConfirmReplace: false,
      statusMessage: 'Calibration cancelled. Current project preserved.'
    });
  }
}));

async function executeCalibrationInternal(
  get: () => CalibrationState,
  set: (partial: Partial<CalibrationState>) => void
): Promise<void> {
  const { selectedPass, selectedPattern } = get();
  set({ isCalibrating: true, statusMessage: `Generating Flow Rate Pass ${selectedPass}...`, errorMessage: null });

  try {
    const items = await runFlowRateCalibration(selectedPass, selectedPattern);
    set({
      isCalibrating: false,
      isOpen: false,
      statusMessage: `Flow Rate Pass ${selectedPass} loaded successfully with ${items.length} chips.`
    });
  } catch (err: any) {
    set({
      isCalibrating: false,
      errorMessage: `Failed to generate calibration: ${err.message || String(err)}`,
      statusMessage: null
    });
  }
}

// Register global window accessor for testing
if (typeof window !== 'undefined') {
  (window as any).__calibrationStore = useCalibrationStore;
}
