export const DEFAULT_SLOT_COLORS = [
  '#16417C', '#58B957', '#F5D130', '#E53935',
  '#8E24AA', '#00ACC1', '#FB8C00', '#D81B60',
  '#3949AB', '#00897B', '#7CB342', '#C0CA33',
  '#FDD835', '#FFB300', '#F4511E', '#6D4C41',
] as const;

export function normalizeSlotColor(raw: string | undefined, idx: number): string {
  const trimmed = raw?.trim().replace(/^#/, '') ?? '';
  if (/^[0-9a-fA-F]{6}$/.test(trimmed) || /^[0-9a-fA-F]{8}$/.test(trimmed)) {
    return `#${trimmed.slice(0, 6).toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.toUpperCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return DEFAULT_SLOT_COLORS[idx % DEFAULT_SLOT_COLORS.length];
}
