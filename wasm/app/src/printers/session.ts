import { createPrinterApi } from './api';
import { usePrinterConnectionStore } from './connectionStore';
import { displayScope, restoreDisplay, saveDisplay } from './stateCache';
import type { PhysicalPrinter, PrinterApi } from './types';

let stop: (() => void) | undefined;
let currentKey = '';
let currentScope = '';
let currentApi: PrinterApi | undefined;
let generation = 0;
let monitoring = false;
let failed = false;
let retry: ReturnType<typeof setTimeout> | undefined;
let refreshWait: ReturnType<typeof setTimeout> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let frameFocusCheck: ReturnType<typeof setTimeout> | undefined;
let started = false;
let syncing = false;
let resync = false;
let previousPrinters: PhysicalPrinter[] | undefined;
const store = usePrinterConnectionStore;
const refreshIntervalMs = 15_000;
const signedOut = (p: PhysicalPrinter) => ['snapmaker-cloud', 'prusaconnect', 'bambu-cloud', 'creality-cloud'].includes(p.host_type) && !p.printhost_apikey;
// Filament choices and display names do not restart the transport.
const connectionKey = (p?: PhysicalPrinter) => p ? JSON.stringify({ ...p, name: undefined, preset: undefined, vendor: undefined,
  filamentPresets: undefined, filamentColors: undefined, filamentTypes: undefined }) : '';

export function getCurrentPrinterApi(): PrinterApi | undefined { return currentApi; }

function active(): boolean {
  return store.getState().deviceTabActive && (typeof document === 'undefined' ||
    (!document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus())));
}
function watchFrameFocus() {
  const state = store.getState();
  if (typeof document === 'undefined' || document.hidden || !state.deviceTabActive || !state.selectedPrinterId ||
      document.activeElement?.tagName !== 'IFRAME') {
    clearTimeout(frameFocusCheck); frameFocusCheck = undefined;
    return;
  }
  // Cross-origin child windows do not forward their later focus events to us.
  // This checks only focus; all printer reads still stop while unfocused.
  if (frameFocusCheck === undefined) frameFocusCheck = setTimeout(() => {
    frameFocusCheck = undefined;
    sync();
  }, 100);
}
function stopMonitoring() {
  ++generation;
  monitoring = false;
  clearTimeout(retry); retry = undefined;
  clearTimeout(refreshWait); refreshWait = undefined;
  clearTimeout(deadline); deadline = undefined;
  const cleanup = stop; stop = undefined;
  cleanup?.();
}
function retryLater() {
  if (retry !== undefined || !active()) return;
  const s = store.getState();
  const p = s.printers.find(p => p.id === s.selectedPrinterId);
  if (!p || signedOut(p)) return;
  retry = setTimeout(() => { retry = undefined; failed = false; if (!currentApi) currentKey = ''; sync(); }, refreshIntervalMs);
}

/** Manual recovery shares the same single-monitor path as focus and timed recovery. */
export function reconnectPrinterSession() {
  if (store.getState().status !== 'error' || !active()) return;
  clearTimeout(retry); retry = undefined;
  failed = false;
  sync();
}

function syncOnce() {
  watchFrameFocus();
  const { printers, selectedPrinterId } = store.getState();
  const printer = printers.find(p => p.id === selectedPrinterId);
  const scope = printer ? displayScope(printer) : '';
  const key = connectionKey(printer);
  if (previousPrinters !== printers) {
    restoreDisplay(printers);
    previousPrinters = printers;
  }
  if (scope !== currentScope) {
    currentScope = scope;
    const cached = restoreDisplay(printers, printer);
    store.setState({ cachedState: cached?.state ?? null, lastRefreshedAt: cached?.receivedAt ?? null });
  }
  if (key !== currentKey) {
    stopMonitoring();
    failed = false;
    currentApi?.dispose?.();
    currentApi = undefined;
    currentKey = key;
    store.setState({ liveState: null, error: undefined, status: printer ? 'connecting' : 'none', activeApi: null });
    if (printer) {
      try { currentApi = createPrinterApi(printer); }
      catch {
        failed = true;
        store.setState({ status: 'error', error: 'Reconnect OctoEverywhere in printer settings, or choose Local.' });
        retryLater();
      }
      store.setState({ activeApi: currentApi ?? null });
    }
  }
  const paused = !active();
  if (store.getState().monitoringPaused !== paused) store.setState({ monitoringPaused: paused });
  if (paused || !printer) {
    if (monitoring || retry !== undefined || refreshWait !== undefined) stopMonitoring();
    if (store.getState().liveState !== null || store.getState().status !== 'none') store.setState({ liveState: null, status: 'none' });
    failed = false;
    return;
  }
  if (!currentApi || monitoring || failed || retry !== undefined) return;
  if (signedOut(printer)) {
    failed = true;
    store.setState({ liveState: null, status: 'error', error: 'Sign in again to read printer status.' });
    return;
  }
  const { lastRefreshedAt, status } = store.getState();
  const remaining = lastRefreshedAt === null ? 0 : refreshIntervalMs - (Date.now() - lastRefreshedAt);
  // A resumed session keeps its display snapshot until a fresh read is due.
  // Error recovery (including manual Retry) must still reconnect immediately.
  if (status !== 'error' && remaining > 0) {
    if (refreshWait === undefined) {
      const epoch = generation;
      refreshWait = setTimeout(() => {
        if (epoch !== generation) return;
        refreshWait = undefined;
        sync();
      }, remaining);
    }
    return;
  }
  clearTimeout(refreshWait); refreshWait = undefined;
  const api = currentApi;
  const epoch = ++generation;
  monitoring = true;
  store.setState({ liveState: null, status: 'connecting', error: undefined });
  const current = () => {
    const s = store.getState();
    return epoch === generation && currentApi === api && active() &&
      key === connectionKey(s.printers.find(p => p.id === s.selectedPrinterId));
  };
  if (!current()) { monitoring = false; resync = true; return; }
  const onError = (error: Error) => {
    if (!current()) return;
    stopMonitoring();
    failed = true;
    // Schedule before notifying subscribers: a store update may reenter sync().
    retryLater();
    store.setState({ liveState: null, status: 'error', error: error.message });
  };
  deadline = setTimeout(() => onError(new Error('Printer monitoring timed out. Retrying when active.')), 35_000);
  try {
    const cleanup = api.connect(liveState => {
      if (!current()) return;
      clearTimeout(deadline); deadline = undefined;
      const receivedAt = Date.now();
      const cachedState = saveDisplay(printer, liveState, receivedAt);
      store.setState({ liveState, ...(cachedState ? { cachedState, lastRefreshedAt: receivedAt } : {}), status: 'online', error: undefined });
    }, onError, { isActive: active, pollIntervalMs: refreshIntervalMs });
    if (current()) stop = cleanup;
    else cleanup(); // Handles synchronous failure or a reentrant selection change during connect().
  } catch (error) { onError(error instanceof Error ? error : new Error(String(error))); }
}
function sync() {
  if (syncing) { resync = true; return; }
  syncing = true;
  try {
    do { resync = false; syncOnce(); } while (resync);
  } finally { syncing = false; }
}

export function startPrinterSession() {
  if (started) return;
  started = true;
  store.subscribe(sync);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('blur', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', sync);
  }
  sync();
}
