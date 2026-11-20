import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PhysicalPrinter, PrinterApi, PrinterState } from './types';

export type PrinterConnectionStatus = 'none' | 'connecting' | 'online' | 'error';

export type PrusaAccountSession = Pick<PhysicalPrinter, 'host_type' | 'print_host' |
  'cloud_region' | 'cloud_account' | 'printhost_apikey' | 'cloud_refresh_token'>;

export function samePrusaScope(a: PrusaAccountSession, b: PrusaAccountSession): boolean {
  return a.host_type === b.host_type && a.print_host === b.print_host &&
    (a.cloud_region ?? 'global') === (b.cloud_region ?? 'global');
}

/** Discard obsolete transport addresses without discarding printer or account settings. */
function serverConnection<T extends object>(record: T): T {
  const cleaned = { ...record } as T & { local_gateway?: unknown; use_gateway?: boolean };
  delete cleaned.local_gateway;
  if ('use_gateway' in cleaned) cleaned.use_gateway = true;
  return cleaned;
}

function savedConnections(value: unknown): Partial<PrinterConnectionState> {
  const state = value as Partial<PrinterConnectionState> | undefined;
  return { printers: (state?.printers ?? []).map(serverConnection),
    prusaSessions: (state?.prusaSessions ?? []).map(serverConnection),
    snapmakerSessions: (state?.snapmakerSessions ?? []).map(serverConnection),
    selectedPrinterId: state?.selectedPrinterId ?? null };
}

const sameTokens = (a: PrusaAccountSession, b: PrusaAccountSession) =>
  a.printhost_apikey === b.printhost_apikey && a.cloud_refresh_token === b.cloud_refresh_token;

interface PrinterConnectionState {
  /** Connection of the selected printer, shown as a dot next to the printer preset. */
  status: PrinterConnectionStatus;
  error?: string;
  liveState: PrinterState | null;
  /** Display only: never use this snapshot for controls, upload or filament sync. */
  cachedState: PrinterState | null;
  lastRefreshedAt: number | null;
  monitoringPaused: boolean;
  activeApi: PrinterApi | null;
  deviceTabActive: boolean;

  printers: PhysicalPrinter[];
  prusaSessions: PrusaAccountSession[];
  snapmakerSessions: PrusaAccountSession[];
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
  savePrusaSession: (source: PrusaAccountSession) => void;
  saveSnapmakerSession: (source: PrusaAccountSession) => void;
  rotateSnapmakerSession: (source: PhysicalPrinter, access: string, refresh: string) => boolean;
  rejectSnapmakerSession: (source: PhysicalPrinter) => void;
  rejectPrusaSession: (source: PhysicalPrinter) => void;
  updateCloudTokens: (source: PhysicalPrinter, access: string, refresh?: string) => boolean;
  deletePrinter: (id: string) => void;
  selectPrinter: (id: string) => void;
  saveFilaments: (id: string, presets: string[], colors: string[], types?: string[]) => void;
}

export const usePrinterConnectionStore = create<PrinterConnectionState>()(
  persist(
    (set) => ({
      status: 'none',
      liveState: null,
      cachedState: null,
      lastRefreshedAt: null,
      monitoringPaused: true,
      activeApi: null,
      deviceTabActive: false,
      printers: [],
      prusaSessions: [],
      snapmakerSessions: [],
      selectedPrinterId: null,
      dialogOpen: false,
      editingId: null,
      sendDialogOpen: false,

      openDialog: (editId = null) => set({ dialogOpen: true, editingId: editId }),
      closeDialog: () => set({ dialogOpen: false }),
      openSendDialog: () => set({ sendDialogOpen: true }),
      closeSendDialog: () => set({ sendDialogOpen: false }),
      setDeviceTabActive: (deviceTabActive) => set({ deviceTabActive }),

      savePrinter: (source) => {
        const printer = serverConnection(source);
        set((s) => ({
          printers: s.printers.some((p) => p.id === printer.id) ? s.printers.map((p) => (p.id === printer.id ? printer : p)) : [...s.printers, printer],
          selectedPrinterId: printer.id
        }));
      },
      savePrusaSession: (source) => set(s => {
        // Explicit allowlist: never persist password, OTP, PKCE, cookies or printer/device data here.
        const { host_type, print_host, cloud_region, cloud_account, printhost_apikey, cloud_refresh_token } = source;
        if (host_type !== 'prusaconnect' || !printhost_apikey) return {};
        const session = { host_type, print_host, cloud_region, cloud_account, printhost_apikey, cloud_refresh_token };
        return { prusaSessions: [session, ...s.prusaSessions.filter(p => !samePrusaScope(p, source) ||
          (p.cloud_account !== cloud_account && !sameTokens(p, source)))] };
      }),
      saveSnapmakerSession: source => set(s => {
        const { host_type, print_host, cloud_account, printhost_apikey, cloud_refresh_token } = source;
        if (host_type !== 'snapmaker-cloud' || print_host !== 'id.snapmaker.com' ||
          (source.cloud_region ?? 'global') !== 'global' || !printhost_apikey || !cloud_refresh_token) return {};
        const session = { host_type, print_host, cloud_region: 'global' as const,
          cloud_account, printhost_apikey, cloud_refresh_token };
        return { snapmakerSessions: [session, ...s.snapmakerSessions.filter(p =>
          !samePrusaScope(p, source) || p.cloud_account !== cloud_account)] };
      }),
      rotateSnapmakerSession: (source, access, refresh) => {
        let current = true;
        set(s => {
          const matches = (p: PrusaAccountSession) => samePrusaScope(p, source) && p.cloud_account === source.cloud_account;
          const cached = s.snapmakerSessions.filter(matches);
          const records = cached.length ? cached : s.printers.filter(matches);
          if (records.some(p => !sameTokens(p, source))) { current = false; return {}; }
          const update = <T extends PrusaAccountSession>(p: T): T => matches(p) && sameTokens(p, source)
            ? { ...p, printhost_apikey: access, cloud_refresh_token: refresh } : p;
          return { snapmakerSessions: s.snapmakerSessions.map(update), printers: s.printers.map(update) };
        });
        return current;
      },
      rejectSnapmakerSession: source => set(s => ({
        snapmakerSessions: s.snapmakerSessions.filter(p => !samePrusaScope(p, source) || p.cloud_account !== source.cloud_account || !sameTokens(p, source)),
        printers: s.printers.map(p => samePrusaScope(p, source) && p.cloud_account === source.cloud_account && sameTokens(p, source)
          ? { ...p, printhost_apikey: undefined, cloud_refresh_token: undefined } : p)
      })),
      rejectPrusaSession: source => set(s => ({
        prusaSessions: s.prusaSessions.filter(p => !samePrusaScope(p, source) || !sameTokens(p, source)),
        printers: s.printers.map(p => samePrusaScope(p, source) && sameTokens(p, source)
          ? { ...p, printhost_apikey: undefined, cloud_refresh_token: undefined } : p)
      })),
      updateCloudTokens: (source, access, refresh) => {
        let current = true;
        set((s) => {
          const cached = s.prusaSessions.filter(p => samePrusaScope(p, source) && p.cloud_account === source.cloud_account);
          const saved = s.printers.find(p => p.id === source.id && samePrusaScope(p, source) && p.cloud_account === source.cloud_account);
          if (source.host_type === 'bambu-cloud' && s.printers.some(p => p.id === source.id) && (!saved || !sameTokens(saved, source))) {
            current = false;
            return {};
          }
          if (source.host_type === 'prusaconnect' &&
            ((source.id === 'prusa-account-session' && !s.prusaSessions.some(p => samePrusaScope(p, source) && sameTokens(p, source))) ||
              (cached.length > 0 && !cached.some(p => sameTokens(p, source))) || (saved && !sameTokens(saved, source)))) {
            current = false;
            return {};
          }
          return {
            prusaSessions: s.prusaSessions.map(p => samePrusaScope(p, source) && sameTokens(p, source)
              ? { ...p, printhost_apikey: access, cloud_refresh_token: refresh ?? p.cloud_refresh_token } : p),
            printers: s.printers.map((p) => (source.host_type === 'prusaconnect'
              ? samePrusaScope(p, source) && p.cloud_account === source.cloud_account && sameTokens(p, source)
              : p.id === source.id && p.host_type === source.host_type && p.print_host === source.print_host &&
                p.cloud_region === source.cloud_region &&
                p.cloud_account === source.cloud_account && sameTokens(p, source))
              ? { ...p, printhost_apikey: access, cloud_refresh_token: refresh ?? p.cloud_refresh_token } : p)
          };
        });
        return current;
      },
      deletePrinter: (id) =>
        set((s) => {
          const printers = s.printers.filter((p) => p.id !== id);
          return { printers, selectedPrinterId: s.selectedPrinterId === id ? printers[0]?.id ?? null : s.selectedPrinterId };
        }),
      selectPrinter: (selectedPrinterId) => set({ selectedPrinterId }),
      saveFilaments: (id, filamentPresets, filamentColors, filamentTypes) => set((s) => ({
        printers: s.printers.map((p) => p.id === id ? { ...p, filamentPresets, filamentColors, ...(filamentTypes ? { filamentTypes } : {}) } : p)
      }))
    }),
    {
      name: 'orca-printers',
      storage: createJSONStorage(() => ({
        getItem: name => { try { return localStorage.getItem(name); } catch { return null; } },
        setItem: (name, value) => { try { localStorage.setItem(name, value); } catch { /* Disabled storage or quota. */ } },
        removeItem: name => { try { localStorage.removeItem(name); } catch { /* Disabled storage. */ } }
      })),
      version: 2,
      migrate: savedConnections,
      merge: (persisted, current) => ({ ...current, ...savedConnections(persisted) }),
      // Saved connections and account tokens stay in this browser's storage.
      partialize: (s) => ({ printers: s.printers, selectedPrinterId: s.selectedPrinterId, prusaSessions: s.prusaSessions, snapmakerSessions: s.snapmakerSessions })
    }
  )
);

if (typeof window !== 'undefined') {
  (window as unknown as { __printerStore: typeof usePrinterConnectionStore }).__printerStore = usePrinterConnectionStore;
}
