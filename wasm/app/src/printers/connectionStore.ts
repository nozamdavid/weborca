import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PhysicalPrinter, PrinterState } from './types';

export type PrinterConnectionStatus = 'none' | 'connecting' | 'online' | 'error';

interface PrinterConnectionState {
  /** Connection of the selected printer, shown as a dot next to the printer preset. */
  status: PrinterConnectionStatus;
  error?: string;
  liveState: PrinterState | null;
  deviceTabActive: boolean;

  printers: PhysicalPrinter[];
  selectedPrinterId: string | null;

  dialogOpen: boolean;
  /** Printer being edited in the dialog; null adds a new one. */
  editingId: string | null;
  sendDialogOpen: boolean;

  openDialog: (editId?: string | null) => void;
  closeDialog: () => void;
  openSendDialog: () => void;
  closeSendDialog: () => void;
  setDeviceTabActive: (active: boolean) => void;

  /** Adds or replaces a printer and selects it. */
  savePrinter: (printer: PhysicalPrinter) => void;
  deletePrinter: (id: string) => void;
  selectPrinter: (id: string) => void;
}

export const usePrinterConnectionStore = create<PrinterConnectionState>()(
  persist(
    (set) => ({
      status: 'none',
      liveState: null,
      deviceTabActive: false,
      printers: [],
      selectedPrinterId: null,
      dialogOpen: false,
      editingId: null,
      sendDialogOpen: false,

      openDialog: (editId = null) => set({ dialogOpen: true, editingId: editId }),
      closeDialog: () => set({ dialogOpen: false }),
      openSendDialog: () => set({ sendDialogOpen: true }),
      closeSendDialog: () => set({ sendDialogOpen: false }),
      setDeviceTabActive: (deviceTabActive) => set({ deviceTabActive }),

      savePrinter: (printer) =>
        set((s) => ({
          printers: s.printers.some((p) => p.id === printer.id) ? s.printers.map((p) => (p.id === printer.id ? printer : p)) : [...s.printers, printer],
          selectedPrinterId: printer.id
        })),
      deletePrinter: (id) =>
        set((s) => {
          const printers = s.printers.filter((p) => p.id !== id);
          return { printers, selectedPrinterId: s.selectedPrinterId === id ? printers[0]?.id ?? null : s.selectedPrinterId };
        }),
      selectPrinter: (selectedPrinterId) => set({ selectedPrinterId })
    }),
    {
      name: 'orca-printers',
      version: 1,
      // API keys and passwords stay in this browser's storage; nothing else is persisted.
      partialize: (s) => ({ printers: s.printers, selectedPrinterId: s.selectedPrinterId })
    }
  )
);

if (typeof window !== 'undefined') {
  (window as unknown as { __printerStore: typeof usePrinterConnectionStore }).__printerStore = usePrinterConnectionStore;
}
