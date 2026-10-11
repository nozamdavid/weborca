import { createPrinterApi } from './api';
import { usePrinterConnectionStore } from './connectionStore';

/**
 * Keeps one connection open to the selected printer for as long as it is selected, so the sidebar's status dot
 * and the Device tab share it. Polling drivers slow down while the Device tab is not showing.
 */
let stop: (() => void) | undefined;
let currentKey = '';

function sync() {
  const store = usePrinterConnectionStore;
  const { printers, selectedPrinterId } = store.getState();
  const printer = printers.find((p) => p.id === selectedPrinterId);
  // Saving slicer filament choices does not change the connection. Reconnecting here
  // clears live inventory and unmounts the sync dialog while it is still applying slots.
  const key = printer ? JSON.stringify({ ...printer, filamentPresets: undefined, filamentColors: undefined }) : '';
  if (key === currentKey) return;

  stop?.();
  stop = undefined;
  currentKey = key;
  store.setState({ liveState: null, error: undefined, status: printer ? 'connecting' : 'none' });
  if (!printer) return;

  const api = createPrinterApi(printer);
  stop = api.connect(
    (liveState) => store.setState({ liveState, status: 'online', error: undefined }),
    (error) => store.setState({ status: 'error', error: error.message }),
    { isActive: () => store.getState().deviceTabActive }
  );
}

export function startPrinterSession() {
  usePrinterConnectionStore.subscribe(sync);
  sync();
}
