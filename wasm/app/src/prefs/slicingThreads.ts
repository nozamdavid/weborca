export type SlicingThreadsPreference = 'auto' | 1 | 2 | 4 | 8 | 16;

export function sanitizeSlicingThreads(value: unknown): SlicingThreadsPreference {
  return value === 1 || value === 2 || value === 4 || value === 8 || value === 16
    ? value
    : 'auto';
}

export function resolveSlicingThreads(
  preference: unknown,
  hardwareConcurrency: unknown = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined
): number {
  const hardware = typeof hardwareConcurrency === 'number' && Number.isInteger(hardwareConcurrency) && hardwareConcurrency >= 1
    ? hardwareConcurrency
    : 4;
  const requested = sanitizeSlicingThreads(preference);
  return Math.max(1, Math.min(hardware, requested === 'auto' ? 8 : requested, 16));
}
