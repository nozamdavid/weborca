import { create } from 'zustand';

export interface WizardStore {
  open: boolean;
  /** The printers the wizard last finished with; the sidebar offers these (plus the selected one) for their brand. */
  addedPrinters: string[];
  addedFilaments: string[];
  setAddedFilaments: (filaments: string[]) => void;
  setAddedPrinters: (printers: string[]) => void;
  step: 1 | 2 | 3;
  selectedVendor: string;
  selectedPrinters: string[];
  selectedFilaments: string[];
  setOpen: (open: boolean) => void;
  setStep: (step: 1 | 2 | 3) => void;
  setSelectedVendor: (vendor: string) => void;
  setSelectedPrinters: (printers: string[]) => void;
  togglePrinter: (printer: string) => void;
  setSelectedFilaments: (filaments: string[]) => void;
  toggleFilament: (filament: string) => void;
  selectAllFilaments: (filaments: string[]) => void;
  selectNoneFilaments: () => void;
  reset: () => void;
}

function loadSavedChoices(): { printers: string[]; filaments: string[] } {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('orca.wizard');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          printers: Array.isArray(parsed.printers) ? parsed.printers : [],
          filaments: Array.isArray(parsed.filaments) ? parsed.filaments : []
        };
      }
    }
  } catch (_) {}
  return { printers: [], filaments: [] };
}

export const useWizardStore = create<WizardStore>((set) => ({
  open: false,
  addedPrinters: loadSavedChoices().printers,
  addedFilaments: loadSavedChoices().filaments,
  setAddedFilaments: (addedFilaments) => set({ addedFilaments }),
  setAddedPrinters: (addedPrinters) => set({ addedPrinters }),
  step: 1,
  selectedVendor: 'Voron',
  selectedPrinters: [],
  selectedFilaments: [],

  setOpen: (open) =>
    set((state) => {
      if (open && !state.open) {
        const saved = loadSavedChoices();
        return {
          open: true,
          step: 1,
          selectedPrinters: saved.printers.length > 0 ? saved.printers : state.selectedPrinters,
          selectedFilaments: saved.filaments.length > 0 ? saved.filaments : state.selectedFilaments
        };
      }
      return { open };
    }),

  setStep: (step) => set({ step }),

  setSelectedVendor: (selectedVendor) => set({ selectedVendor }),

  setSelectedPrinters: (selectedPrinters) => set({ selectedPrinters }),

  togglePrinter: (printer) =>
    set((state) => {
      const exists = state.selectedPrinters.includes(printer);
      return {
        selectedPrinters: exists
          ? state.selectedPrinters.filter((p) => p !== printer)
          : [...state.selectedPrinters, printer]
      };
    }),

  setSelectedFilaments: (selectedFilaments) => set({ selectedFilaments }),

  toggleFilament: (filament) =>
    set((state) => {
      const exists = state.selectedFilaments.includes(filament);
      return {
        selectedFilaments: exists
          ? state.selectedFilaments.filter((f) => f !== filament)
          : [...state.selectedFilaments, filament]
      };
    }),

  selectAllFilaments: (filaments) =>
    set((state) => {
      const setNames = new Set([...state.selectedFilaments, ...filaments]);
      return { selectedFilaments: Array.from(setNames) };
    }),

  selectNoneFilaments: () => set({ selectedFilaments: [] }),

  reset: () =>
    set({
      step: 1,
      selectedPrinters: [],
      selectedFilaments: []
    })
}));
