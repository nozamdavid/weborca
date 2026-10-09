/**
 * @file types.ts
 * Type definitions for offline Flow Rate Calibration (Pass 1 and Pass 2).
 */

export type FlowRatePass = 1 | 2;

export type InfillPattern = 'archimedeanchords' | 'monotonic';

export interface FlowRateModifierItem {
  objectId: number;
  name: string;
  modifier: number;
  flowRatio: number;
}

export interface FlowRateScalingResult {
  nozzleDiameter: number;
  layerHeight: number;
  firstLayerHeight: number;
  xyScale: number;
  sx: number;
  sy: number;
  sz: number;
  totalHeight: number;
}

export interface FlowRateSpeedsResult {
  internalSolidInfillSpeed: number;
  topSurfaceSpeed: number;
  maxSpeed: number;
  volumetricFlowPerMm: number;
}

export interface CalibrationState {
  isOpen: boolean;
  activeTab: 'generator' | 'calculator';
  selectedPass: FlowRatePass;
  selectedPattern: InfillPattern;
  showConfirmReplace: boolean;
  isCalibrating: boolean;
  statusMessage: string | null;
  errorMessage: string | null;

  // Calculator / evaluation state
  calculatorModifier: number | '';
  customOldFlow: number | '';
  calculatedNewFlow: number | null;
  calculatorMessage: string | null;

  // Actions
  openDialog: () => void;
  closeDialog: () => void;
  setActiveTab: (tab: 'generator' | 'calculator') => void;
  setSelectedPass: (pass: FlowRatePass) => void;
  setSelectedPattern: (pattern: InfillPattern) => void;
  setCalculatorModifier: (val: number | '') => void;
  setCustomOldFlow: (val: number | '') => void;
  calculate: () => void;
  applyCalculatedFlow: () => Promise<void>;
  startCalibration: () => Promise<void>;
  confirmReplaceAndStart: () => Promise<void>;
  cancelConfirmReplace: () => void;
}
