/**
 * @file exportPlateSlicedFile.ts
 * Exports the active plate sliced file as a .gcode.3mf archive bundling models, presets and sliced G-code.
 */

import { unzipSync, zipSync, strToU8 } from 'fflate';
import { getEngine } from '../engine/orcaEngine';
import { useAppStore } from '../store/appStore';
import { showToast } from './toastStore';

export async function exportPlateSlicedFile(): Promise<void> {
  const { sliceResult, modelFile } = useAppStore.getState();
  if (!sliceResult?.gcode) {
    showToast('No sliced result to export. Please slice the plate first.', 'error');
    return;
  }

  try {
    const engine = await getEngine();
    const vfsPath = '/out/plate_sliced_export.3mf';
    await engine.call('saveProject', { path: vfsPath });
    const projectBytes = await engine.readFile(vfsPath);

    // Inject G-code into 3MF package using fflate
    const unzipped = unzipSync(new Uint8Array(projectBytes));
    const gcodeBytes: Uint8Array =
      sliceResult.gcode instanceof Uint8Array
        ? new Uint8Array(sliceResult.gcode)
        : strToU8(String(sliceResult.gcode));
    unzipped['Metadata/plate_1.gcode'] = gcodeBytes as any;

    const gcode3mfBytes = zipSync(unzipped);

    const baseName = modelFile?.name
      ? (modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name)
      : 'plate';
    const downloadName = `${baseName}.gcode.3mf`;

    const blob = new Blob([gcode3mfBytes as any], {
      type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast(`Exported plate sliced file: ${downloadName}`, 'success');
  } catch (err: any) {
    showToast(`Failed to export plate sliced file: ${err.message || String(err)}`, 'error');
  }
}
