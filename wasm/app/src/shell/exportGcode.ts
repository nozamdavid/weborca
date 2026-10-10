import { useAppStore } from '../store/appStore';
import { showToast } from './toastStore';

/** Downloads the sliced G-code as <model name>.gcode. */
export function exportGcode(): void {
  const { sliceResult, modelFile } = useAppStore.getState();
  if (!sliceResult?.gcode) {
    showToast('No sliced G-code to export. Please slice the plate first.', 'error');
    return;
  }
  const name = modelFile
    ? `${modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name}.gcode`
    : 'print.gcode';
  const url = URL.createObjectURL(new Blob([sliceResult.gcode as BlobPart], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported G-code: ${name}`, 'success');
}
