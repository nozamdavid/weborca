/**
 * Utility functions for resolving and serializing multi-slot and multi-nozzle configuration values.
 *
 * In OrcaSlicer:
 * - Scalar values are single numbers or strings (e.g. "220").
 * - Multi-filament values are comma-separated per slot (e.g. "220,245").
 * - Multi-extruder / variant values have multiple cells per slot (stride > 1),
 *   e.g. on a 5-toolhead printer with 1 filament: "220,220,220,220,220".
 *   With 2 filaments: "220,220,220,220,220,240,240,240,240,240".
 * - If a vector has fewer cells than slots, later slots inherit from the earlier cells.
 * - Missing/empty values fall back to preset values or default definitions.
 */

export interface ResolveSlotValueArgs {
  rawVal?: string;
  filamentSlot?: number;
  layoutIndex?: number;
  totalSlots?: number;
  extrudersCount?: number;
  defaultValue?: string;
}

export function resolveSlotValue({
  rawVal,
  filamentSlot = 0,
  layoutIndex,
  totalSlots = 1,
  extrudersCount = 1,
  defaultValue = ''
}: ResolveSlotValueArgs): string {
  if (rawVal === undefined || rawVal === null || rawVal.trim() === '') {
    return defaultValue;
  }

  const trimmed = rawVal.trim();
  if (trimmed === 'nil') {
    return defaultValue;
  }

  // Scalar string without commas
  if (!trimmed.includes(',')) {
    return trimmed;
  }

  const cells = trimmed.split(',').map((c) => c.trim());
  if (cells.length === 0) {
    return defaultValue;
  }
  if (cells.length === 1) {
    const single = cells[0];
    return single && single !== 'nil' ? single : defaultValue;
  }

  const effectiveTotalSlots = Math.max(1, totalSlots);
  let stride = 1;
  if (cells.length >= effectiveTotalSlots && cells.length % effectiveTotalSlots === 0) {
    stride = cells.length / effectiveTotalSlots;
  } else if (extrudersCount > 1 && cells.length >= extrudersCount) {
    stride = extrudersCount;
  }

  const slotStart = filamentSlot * stride;
  let slotCells: string[];
  if (slotStart < cells.length) {
    slotCells = cells.slice(slotStart, slotStart + stride);
  } else {
    // If fewer cells than slots, inherit from first slot or available cells
    slotCells = cells.slice(0, Math.min(stride, cells.length));
  }

  const cellIdx = layoutIndex !== undefined && layoutIndex >= 0 && layoutIndex < slotCells.length
    ? layoutIndex
    : 0;

  const resolved = slotCells[cellIdx];
  if (resolved === undefined || resolved === '' || resolved === 'nil') {
    return defaultValue;
  }
  return resolved;
}

/**
 * Extracts a single scalar string from a potentially comma-separated projected value.
 * Used for <input type="number"> controls which require a clean number string without commas.
 */
export function extractScalarCell(value: string | null | undefined, layoutIndex?: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'nil') return '';
  if (!trimmed.includes(',')) return trimmed;
  const cells = trimmed.split(',').map((c) => c.trim());
  const idx = layoutIndex !== undefined && layoutIndex >= 0 && layoutIndex < cells.length ? layoutIndex : 0;
  const cell = cells[idx];
  return cell !== undefined && cell !== '' && cell !== 'nil' ? cell : null;
}

/**
 * Calculate the vector stride (number of cells per filament slot) for a given config option.
 */
export function getOptionStride(
  rawVal: string | undefined,
  totalSlots: number = 1,
  extrudersCount: number = 1
): number {
  if (!rawVal || !rawVal.includes(',')) return 1;
  const cells = rawVal.split(',').map((c) => c.trim());
  const effectiveTotalSlots = Math.max(1, totalSlots);
  if (cells.length >= effectiveTotalSlots && cells.length % effectiveTotalSlots === 0) {
    return cells.length / effectiveTotalSlots;
  }
  if (extrudersCount > 1 && cells.length >= extrudersCount) {
    return extrudersCount;
  }
  return 1;
}
