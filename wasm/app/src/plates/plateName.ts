/** A plate without a name of its own is called "Plate N" after its number. */
export function plateTitle(name: string | undefined, index: number): string {
  return (name ?? '').trim() || `Plate ${index + 1}`;
}

export function isDefaultPlateName(name: string | undefined, index: number): boolean {
  return plateTitle(name, index) === `Plate ${index + 1}`;
}
