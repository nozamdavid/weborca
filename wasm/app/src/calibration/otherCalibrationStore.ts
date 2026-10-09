import { create } from 'zustand';

type CalibrationType = 'pa_line' | 'pa_pattern' | 'pa_tower' | 'temp' | 'max_vol' | 'vfa' | 'retraction' | null;

interface OtherCalibrationState {
  calibrationMenuOpen: boolean;
  activeCalibration: CalibrationType;
  openMenu: () => void;
  closeMenu: () => void;
  openDialog: (type: CalibrationType) => void;
  closeDialog: () => void;
}

export const useOtherCalibrationStore = create<OtherCalibrationState>((set) => ({
  calibrationMenuOpen: false,
  activeCalibration: null,
  openMenu: () => set({ calibrationMenuOpen: true }),
  closeMenu: () => set({ calibrationMenuOpen: false }),
  openDialog: (type) => set({ activeCalibration: type, calibrationMenuOpen: false }),
  closeDialog: () => set({ activeCalibration: null }),
}));
