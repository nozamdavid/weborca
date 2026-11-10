export const quickSettings = [
  ['layer_height', 'Layer height', 'Thinner layers show finer detail.', 'M4 8h24M4 14h24M4 20h24M4 26h24'],
  ['sparse_infill_density', 'Infill', 'More infill adds internal structure.', 'M4 4h24v24H4zM4 12h24M4 20h24M12 4v24M20 4v24'],
  ['enable_support', 'Supports', 'Supports hold up overhanging parts.', 'M4 8h24M8 8v20M24 8v20M4 28h24'],
  ['brim_type', 'Adhesion', 'A brim adds contact around the model base.', 'M10 4h12v18H10zM6 25h20M3 29h26'],
] as const;
