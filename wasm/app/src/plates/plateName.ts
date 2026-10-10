export const DEFAULT_PLATE_TITLE = 'Untitled plate';

/** A plate without a name of its own (the engine leaves it empty or numbers it) shows as "Untitled plate". */
export function plateTitle(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  return !trimmed || /^Plate \d+$/.test(trimmed) ? DEFAULT_PLATE_TITLE : trimmed;
}
