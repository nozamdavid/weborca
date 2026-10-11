/** Packages current project geometry and generated plate G-code in a 3MF archive. */
import { unzipSync, zipSync } from 'fflate';
import { getEngine } from '../engine/orcaEngine';
import type { SliceResult } from '../engine/types';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import { sanitizeFileName } from './exportName';
import { showToast } from './toastStore';
import { getOrBuildGcodeWithThumbnails } from './gcodeThumbnails';

async function downloadSlicedPackage(results: SliceResult[], allPlates = false): Promise<void> {
  const engine = await getEngine();
  const path = '/out/plate_sliced_export.3mf';
  await engine.call('saveProject', { path });
  const files = unzipSync(new Uint8Array(await engine.readFile(path)));
  for (const name of Object.keys(files)) {
    if (/^Metadata\/plate_\d+\.gcode$/.test(name)) delete files[name];
  }
  for (const result of results) {
    const pIdx = result.plateIndex ?? 0;
    const finalGcode = await getOrBuildGcodeWithThumbnails(result.gcode, {
      plateIndex: pIdx,
      currentConfig: useAppStore.getState().currentConfig
    });
    files[`Metadata/plate_${pIdx + 1}.gcode`] = finalGcode as any;
  }
  const modelName = useAppStore.getState().modelFile?.name;
  const base = sanitizeFileName(modelName?.replace(/\.[^.]+$/, '') || 'plate');
  const name = `${base}${allPlates ? '_all_plates' : ''}.gcode.3mf`;
  const bytes = zipSync(files);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported plate sliced file: ${name}`, 'success');
}

export async function exportPlateSlicedFile(): Promise<void> {
  const { sliceResult } = useAppStore.getState();
  if (!sliceResult?.gcode || sliceResult.plateIndex !== usePlatesStore.getState().activePlateIndex) {
    showToast('No sliced result to export. Please slice the plate first.', 'error');
    return;
  }
  try {
    await downloadSlicedPackage([sliceResult]);
  } catch (error) {
    showToast(`Failed to export plate sliced file: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

/** Slice each occupied plate before exporting, so no stale cached G-code enters the package. */
export async function exportAllPlateSlicedFiles(): Promise<void> {
  const app = useAppStore.getState();
  if (app.isSlicing || app.isModelLoading || !app.isEngineReady) return;
  useAppStore.setState({ isModelLoading: true });
  try {
    const plates = await usePlatesStore.getState().fetchPlates();
    const results: SliceResult[] = [];
    for (const plate of plates) {
      if (!plate.instances.length) continue;
      if (!await usePlatesStore.getState().slicePlate(plate.index)) return;
      const result = useAppStore.getState().sliceResult;
      if (!result?.gcode || result.plateIndex !== plate.index) throw new Error('Missing sliced plate result');
      results.push(result);
    }
    if (!results.length) throw new Error('No occupied plates to export');
    await downloadSlicedPackage(results, true);
  } catch (error) {
    showToast(`Failed to export sliced plates: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    useAppStore.setState({ isModelLoading: false });
  }
}
