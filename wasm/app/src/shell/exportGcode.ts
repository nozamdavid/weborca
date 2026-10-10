import { useAppStore } from '../store/appStore';
import { usePrefsStore } from '../prefs/prefsStore';
import { usePlatesStore } from '../plates/platesStore';
import { showToast } from './toastStore';
import { buildExportGcodeFileName } from './exportName';

/** Downloads the sliced G-code using filename_format or fallback. */
function preparedExport(): { name: string; gcode: Uint8Array } | undefined {
  const {
    sliceResult,
    modelFile,
    currentConfig,
    presetConfig,
    selectedPrinter,
    selectedProcess,
    selectedFilament,
    selectedFilaments
  } = useAppStore.getState();

  if (!sliceResult?.gcode) {
    showToast('No sliced G-code to export. Please slice the plate first.', 'error');
    return;
  }

  const useProjectNameForExport = usePrefsStore.getState().general.useProjectNameForExport;
  const activePlateIndex = usePlatesStore.getState().activePlateIndex;

  const name = buildExportGcodeFileName({
    modelFileName: modelFile?.name,
    currentConfig,
    presetConfig,
    selectedPrinter,
    selectedProcess,
    selectedFilament,
    selectedFilaments,
    printTimeS: sliceResult.printTimeS,
    plateIndex: activePlateIndex,
    useProjectNameForExport
  });

  return { name, gcode: sliceResult.gcode };
}

export function exportGcode(): void {
  const prepared = preparedExport();
  if (!prepared) return;
  const { name, gcode } = prepared;
  const url = URL.createObjectURL(new Blob([gcode as BlobPart], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported G-code: ${name}`, 'success');
}

/** The browser's file picker lets the user choose an SD card, USB drive or another writable folder. */
export async function exportGcodeToFile(): Promise<void> {
  const prepared = preparedExport();
  if (!prepared) return;
  const picker = (window as unknown as { showSaveFilePicker?: (options: object) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (!picker) {
    showToast('This browser cannot choose a drive directly. Choose the removable drive in your browser download dialog.', 'info');
    exportGcode();
    return;
  }
  try {
    const handle = await picker({ suggestedName: prepared.name, types: [{ description: 'G-code', accept: { 'text/plain': ['.gcode'] } }] });
    const writable = await handle.createWritable();
    await writable.write(new Blob([prepared.gcode as BlobPart], { type: 'text/plain' }));
    await writable.close();
    showToast(`Saved G-code: ${prepared.name}`, 'success');
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) showToast(`Could not save G-code: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}
