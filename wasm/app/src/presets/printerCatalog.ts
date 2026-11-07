import { create } from 'zustand';
import type { VendorInfo } from '../engine/types';

/** Discovery only. The current printer's vendor bundle has its own dependency/cache. */
export const usePrinterCatalog = create<{
  vendors: VendorInfo[]; loading: boolean; error: boolean;
}>(() => ({ vendors: [], loading: false, error: false }));
let pending: Promise<VendorInfo[]> | undefined;

export function loadPrinterCatalog(): Promise<VendorInfo[]> {
  if (pending) return pending;
  usePrinterCatalog.setState({ loading: true, error: false });
  pending = fetch('/profiles/index.json').then(async response => {
    if (!response.ok) throw new Error('Printer catalog unavailable');
    const vendors = (await response.json() as VendorInfo[]).filter(v => v.name !== 'OrcaFilamentLibrary');
    usePrinterCatalog.setState({ vendors, loading: false });
    return vendors;
  }).catch(error => {
    pending = undefined;
    usePrinterCatalog.setState({ loading: false, error: true });
    throw error;
  });
  return pending;
}
