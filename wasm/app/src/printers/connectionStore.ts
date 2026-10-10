import { create } from 'zustand';

/** Live state of the selected physical printer's connection, shown as a status dot in the sidebar. */
export type PrinterConnectionStatus = 'none' | 'connecting' | 'online' | 'error';

interface PrinterConnectionState {
  status: PrinterConnectionStatus;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export const usePrinterConnectionStore = create<PrinterConnectionState>((set) => ({
  status: 'none',
  dialogOpen: false,
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false })
}));
