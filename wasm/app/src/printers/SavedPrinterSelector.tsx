import { MobileSelect } from '../mobile/MobileSelect';
import React from 'react';
import { useAppStore, resolveDeviceVendor, withPrinterProfileSelection } from '../store/appStore';
import { useWizardStore } from '../wizard';
import { usePrinterConnectionStore } from './connectionStore';
import { useTranslation } from '../i18n';

const ADD_PRINTER = '__add_printer__';
const vendorByPreset = new Map<string, string | undefined>();

async function vendorOf(preset: string) {
  if (!vendorByPreset.has(preset)) vendorByPreset.set(preset, await resolveDeviceVendor({ id: '', preset }));
  return vendorByPreset.get(preset);
}

/** Records a profile on a physical device. Only the device selected when the pick began is ever changed. */
export async function bindDeviceProfile(name: string, deviceId: string | null) {
  if (!deviceId) return;
  const before = useAppStore.getState();
  const isUser = before.userPresets.some((preset) => preset.kind === 'printer' && preset.name === name);
  // Resolve without updating a saved device before the final identity check.
  const vendor = isUser ? await vendorOf(name) : before.selectedVendor;
  const app = useAppStore.getState();
  const store = usePrinterConnectionStore.getState();
  if (!app.isEngineReady || app.isModelLoading || app.engineError || app.selectedPrinter !== name || store.selectedPrinterId !== deviceId) return;
  const device = store.printers.find((printer) => printer.id === deviceId);
  if (!device || !vendor) return;
  store.savePrinter({
    ...device, preset: name, vendor,
    filamentPresets: [...app.selectedFilaments],
    filamentColors: (app.currentConfig.filament_colour || '').split(';'),
    filamentTypes: (app.currentConfig.filament_type || '').split(';').map(t => t.trim()).slice(0, app.selectedFilaments.length)
  });
}

/** Selects a profile across brands, then binds it to the device that was selected when the pick began. */
async function selectProfile(name: string, isUser: boolean) {
  const deviceId = usePrinterConnectionStore.getState().selectedPrinterId;
  await withPrinterProfileSelection(async () => {
    const vendor = await vendorOf(name);
    const app = useAppStore.getState();
    if (vendor && vendor !== app.selectedVendor) await app.chooseVendor(vendor);
    if (isUser) await useAppStore.getState().selectUserPreset('printer', name);
    else await useAppStore.getState().choosePrinter(name);
    await bindDeviceProfile(name, deviceId);
  });
}

/** One dropdown of the printers added in the wizard and the user's own, ending in "Add printer...". */
export const SavedPrinterSelector: React.FC<{ onSelected?: () => void; disabled?: boolean; id?: string }> = ({ onSelected, disabled, id = 'printer-select' }) => {
  const { t } = useTranslation();
  const selectedPrinter = useAppStore((s) => s.selectedPrinter);
  const selectedVendor = useAppStore((s) => s.selectedVendor);
  const userPresets = useAppStore((s) => s.userPresets);
  const isSelecting = useAppStore((s) => s.isSelectingPreset);
  const addedPrinters = useWizardStore((s) => s.addedPrinters);

  const userPrinters = userPresets.filter((p) => p.kind === 'printer').map((p) => p.name);
  const isUserSelected = userPrinters.includes(selectedPrinter);
  const systemPrinters = [...new Set([...addedPrinters, ...(selectedPrinter && !isUserSelected ? [selectedPrinter] : [])])].filter((n) => !userPrinters.includes(n));

  const change = async (value: string) => {
    if (value === ADD_PRINTER) {
      useWizardStore.getState().setSelectedVendor(selectedVendor);
      useWizardStore.getState().setOpen(true);
      return;
    }
    if (useAppStore.getState().isSelectingPreset) return;
    const isUser = value.startsWith('user:');
    useAppStore.setState({ isSelectingPreset: true });
    try {
      await selectProfile(isUser ? value.substring(5) : value, isUser);
      onSelected?.();
    } finally {
      useAppStore.setState({ isSelectingPreset: false });
    }
  };

  return (
    <MobileSelect id={id} data-testid={id} aria-label={t('Printer')} value={isUserSelected ? `user:${selectedPrinter}` : selectedPrinter}
      disabled={disabled || isSelecting} onValueChange={(value) => void change(value)}>
      {!selectedPrinter && <option value="" disabled>{t('Select printer...')}</option>}
      {systemPrinters.map((name) => <option key={name} value={name}>{name}</option>)}
      {userPrinters.length > 0 && <optgroup label={t('User presets')}>{userPrinters.map((name) => <option key={name} value={`user:${name}`}>{name}</option>)}</optgroup>}
      <option value={ADD_PRINTER}>{t('Add printer...')}</option>
    </MobileSelect>
  );
};
