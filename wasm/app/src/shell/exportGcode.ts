import { useAppStore } from '../store/appStore';

/** Downloads the sliced G-code as <model name>.gcode. */
export function exportGcode(): void {
  const { sliceResult, modelFile } = useAppStore.getState();
  if (!sliceResult?.gcode) return;
  const name = modelFile ? `${modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name}.gcode` : 'print.gcode';
  const url = URL.createObjectURL(new Blob([sliceResult.gcode as BlobPart], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
