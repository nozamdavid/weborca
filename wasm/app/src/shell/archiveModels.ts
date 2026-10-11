import { unzip } from 'fflate';

export interface ArchivedModel { name: string; bytes: Uint8Array }
const MODEL_EXTENSION = /\.(stl|obj|3mf|amf|step|stp|svg)$/i;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_MODEL_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_MODELS = 200;

/** Extracts model files without writing archive paths into the engine filesystem. */
export async function readArchiveModels(bytes: Uint8Array): Promise<ArchivedModel[]> {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('ZIP archive exceeds 64 MB');
  let total = 0;
  let count = 0;
  let rejected = false;
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, { filter: (file) => {
      if (!MODEL_EXTENSION.test(file.name)) return false;
      if (file.name.split(/[\\/]/).includes('..') || file.name.includes('\0')) {
        rejected = true;
        return false;
      }
      total += file.originalSize;
      count++;
      if (!Number.isSafeInteger(file.originalSize) || file.originalSize > MAX_MODEL_BYTES || total > MAX_TOTAL_BYTES || count > MAX_MODELS) {
        rejected = true;
        return false;
      }
      return true;
    } }, (error, files) => error ? reject(error) : resolve(files));
  });
  if (rejected) throw new Error('ZIP contains unsafe paths or exceeds model import limits (200 models, 128 MB per model, 256 MB total)');
  const models = Object.entries(entries).map(([path, bytes]) => ({ name: path.split(/[\\/]/).pop()!, bytes }));
  if (!models.length) throw new Error('ZIP contains no supported model files');
  return models;
}
