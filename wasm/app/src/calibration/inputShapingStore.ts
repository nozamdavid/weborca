import { create } from 'zustand';

interface InputShapingState {
  isOpen: boolean;
  mode: 'freq' | 'damp' | 'cornering' | null;
  openDialog: (mode: 'freq' | 'damp' | 'cornering') => void;
  closeDialog: () => void;
}

export const useInputShapingStore = create<InputShapingState>((set) => ({
  isOpen: false,
  mode: null,
  openDialog: (mode) => set({ isOpen: true, mode }),
  closeDialog: () => set({ isOpen: false, mode: null }),
}));

// Expose on window for tests
if (typeof window !== 'undefined') {
  (window as any).__inputShapingStore = useInputShapingStore;
}
