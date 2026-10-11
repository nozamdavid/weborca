/** Native model export preserves volume transforms, mirrored instances and modifier semantics. */
import { zipSync } from 'fflate';
import { getEngine } from '../engine/orcaEngine';
import { usePlateStore } from '../plate/plateStore';
import { usePlatesStore } from '../plates/platesStore';
import { useAppStore } from '../store/appStore';
import { sanitizeFileName } from './exportName';
import { showToast } from './toastStore';

type ModelFormat = 'stl' | 'drc' | '3mf';

function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function modelBytes(format: ModelFormat, selection: { objectId?: number; plateIndex?: number }): Promise<Uint8Array> {
  const engine = await getEngine();
  const path = `/out/model_export.${format === 'drc' ? 'stl' : format}`;
  await engine.call('exportModel', { path, format: format === 'drc' ? 'stl' : format, ...selection });
  const bytes = new Uint8Array(await engine.readFile(path));
  if (format !== 'drc') return bytes;
  const { encodeStlToDraco } = await import('./dracoEncoder');
  return encodeStlToDraco(bytes);
}

export async function exportModels(format: ModelFormat, separate = false, activePlateOnly = false): Promise<void> {
  try {
    const objects = usePlateStore.getState().objects;
    if (objects.length === 0) throw new Error('No objects to export');
    const base = sanitizeFileName(useAppStore.getState().modelFile?.name.replace(/\.[^.]+$/, '') || 'models');
    if (separate) {
      const files: Record<string, Uint8Array> = {};
      for (const [index, object] of objects.entries()) {
        if (!object.instances.length) continue;
        // Index prefixes keep objects with identical names distinct in the archive.
        const name = `${index + 1}_${sanitizeFileName(object.name.replace(/\.[^.]+$/, '') || 'object')}.${format}`;
        files[name] = await modelBytes(format, { objectId: object.id });
      }
      download(zipSync(files), `${base}_${format}_objects.zip`);
    } else {
      const selection = activePlateOnly ? { plateIndex: usePlatesStore.getState().activePlateIndex } : {};
      download(await modelBytes(format, selection), `${base}${activePlateOnly ? '_plate' : ''}.${format}`);
    }
    showToast(`Exported ${format.toUpperCase()} models`, 'success');
  } catch (error) {
    showToast(`Model export failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

export const exportPlateAsStl = (): Promise<void> => exportModels('stl', false, true);
