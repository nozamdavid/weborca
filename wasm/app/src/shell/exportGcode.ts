import { useAppStore } from '../store/appStore';
import { usePrefsStore } from '../prefs/prefsStore';
import { usePlatesStore } from '../plates/platesStore';
import { showToast } from './toastStore';
import { buildExportGcodeFileName } from './exportName';

/** Downloads the sliced G-code using filename_format or fallback. */
export function exportGcode(): void {
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

  const url = URL.createObjectURL(new Blob([sliceResult.gcode as BlobPart], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported G-code: ${name}`, 'success');
}
