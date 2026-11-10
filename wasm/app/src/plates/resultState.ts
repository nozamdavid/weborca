import type { SliceResult } from '../engine/types';

export function hasPlateOutput(result: SliceResult | null, index: number): boolean {
  return !!result?.gcode.length && result.plateIndex === index;
}
export function plateResultState(instances: number, resultPlate: number | undefined, index: number, hasResult: boolean) {
  return !instances ? 'Empty' : hasResult && resultPlate === index ? 'Current' : 'Needs slicing';
}
