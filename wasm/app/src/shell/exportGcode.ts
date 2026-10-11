import { useAppStore } from '../store/appStore';
import { usePrefsStore } from '../prefs/prefsStore';
import { usePlatesStore } from '../plates/platesStore';
import { showToast } from './toastStore';
import { buildExportGcodeFileName } from './exportName';
import { getOrBuildGcodeWithThumbnails } from './gcodeThumbnails';

/**
 * Prepares the sliced G-code payload with embedded OrcaSlicer thumbnails and computed export name.
 * Caches the payload so that download, save, and upload use the exact same byte payload.
 */
function exportSource(plateIndex?: number) {
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

  const targetPlateIndex = plateIndex ?? usePlatesStore.getState().activePlateIndex;

  if (!sliceResult?.gcode || sliceResult.plateIndex !== targetPlateIndex) {
    showToast('No sliced G-code to export. Please slice the plate first.', 'error');
    return;
  }

  const useProjectNameForExport = usePrefsStore.getState().general.useProjectNameForExport;

  const name = buildExportGcodeFileName({
    modelFileName: modelFile?.name,
    currentConfig,
    presetConfig,
    selectedPrinter,
    selectedProcess,
    selectedFilament,
    selectedFilaments,
    printTimeS: sliceResult.printTimeS,
    plateIndex: sliceResult.plateIndex ?? targetPlateIndex,
    useProjectNameForExport
  });

  return { name, sliceResult, targetPlateIndex, currentConfig };
}

/** Reject a result invalidated or replaced while its thumbnails were being rendered. */
async function prepareSource(source: NonNullable<ReturnType<typeof exportSource>>) {
  await usePlatesStore.getState().fetchPlates();
  const gcode = await getOrBuildGcodeWithThumbnails(source.sliceResult.gcode, {
    plateIndex: source.targetPlateIndex, currentConfig: source.currentConfig
  });
  if (useAppStore.getState().sliceResult !== source.sliceResult ||
      usePlatesStore.getState().activePlateIndex !== source.targetPlateIndex) {
    showToast('The sliced result changed. Please export the current plate again.', 'info');
    return;
  }
  return { name: source.name, gcode };
}

/** Shared payload for downloads, drive saves and printer uploads. */
export async function getExportGcodePayload(plateIndex?: number): Promise<{ name: string; gcode: Uint8Array } | undefined> {
  const source = exportSource(plateIndex);
  return source ? prepareSource(source) : undefined;
}

export async function exportGcode(plateIndexOrEvent?: number | unknown): Promise<void> {
  const plateIndex = typeof plateIndexOrEvent === 'number' ? plateIndexOrEvent : undefined;
  const prepared = await getExportGcodePayload(plateIndex);
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
export async function exportGcodeToFile(plateIndexOrEvent?: number | unknown): Promise<void> {
  const plateIndex = typeof plateIndexOrEvent === 'number' ? plateIndexOrEvent : undefined;
  const source = exportSource(plateIndex);
  if (!source) return;
  const picker = (window as unknown as { showSaveFilePicker?: (options: object) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (!picker) {
    showToast('This browser cannot choose a drive directly. Choose the removable drive in your browser download dialog.', 'info');
    await exportGcode(plateIndex);
    return;
  }
  try {
    // Open the picker within the click's user activation, before any asynchronous rendering.
    const handle = await picker({ suggestedName: source.name, types: [{ description: 'G-code', accept: { 'text/plain': ['.gcode'] } }] });
    const prepared = await prepareSource(source);
    if (!prepared) return;
    const writable = await handle.createWritable();
    await writable.write(new Blob([prepared.gcode as BlobPart], { type: 'text/plain' }));
    await writable.close();
    showToast(`Saved G-code: ${prepared.name}`, 'success');
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) showToast(`Could not save G-code: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}
