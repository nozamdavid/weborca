import { zipSync, strToU8 } from 'fflate';
import type { SliceResult } from '../engine/types';

export interface BatchOutput {
  plateIndex: number;
  name: string;
  gcode: Uint8Array;
  provenance: SliceResult['provenance'];
}

export function batchZip(outputs: BatchOutput[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  outputs.forEach((output, index) => {
    const safeName = output.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'plate';
    files[`${index + 1}-plate-${output.plateIndex + 1}-${safeName}.gcode`] = output.gcode;
  });
  files['provenance.json'] = strToU8(JSON.stringify(outputs.map(({ gcode, ...metadata }) => metadata), null, 2));
  return zipSync(files);
}
