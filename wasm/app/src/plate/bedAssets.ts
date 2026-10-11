import { systemProfiles } from '../presets/systemProfiles';

/** Resolve desktop's bed assets through the printer's preset ancestry. Custom URLs take precedence. */
export async function resolveBedAssets(vendor: string, printer: string, custom: { model?: string; texture?: string }): Promise<{ model?: string; texture?: string }> {
  const result = { ...custom };
  if (!vendor || !printer || (result.model && result.texture)) return result;
  const presets = await systemProfiles(vendor, 'machine');
  const visited = new Set<string>();
  let name = printer;
  let model = '';
  while (name && !visited.has(name)) {
    visited.add(name);
    const preset = presets.find((p) => p.name === name);
    if (!preset) break;
    model ||= preset.printer_model || '';
    for (const [key, field] of [['model', 'bed_model'], ['texture', 'bed_texture']] as const) {
      const file = preset[field];
      if (!result[key] && typeof file === 'string' && file) result[key] = `/profiles/assets/${encodeURIComponent(vendor)}/${file.split('/').map(encodeURIComponent).join('/')}`;
    }
    name = preset.inherits || '';
  }
  // Desktop stores the supplied bed artwork on the machine model, rather
  // than on its nozzle-specific presets or their configuration parents.
  const machine = presets.find((p) => p.name === model);
  for (const [key, field] of [['model', 'bed_model'], ['texture', 'bed_texture']] as const) {
    const file = machine?.[field];
    if (!result[key] && file) result[key] = `/profiles/assets/${encodeURIComponent(vendor)}/${file.split('/').map(encodeURIComponent).join('/')}`;
  }
  return result;
}
