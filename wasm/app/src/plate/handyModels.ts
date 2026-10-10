import { decodeDracoToStlBuffer } from '../calibration/dracoDecoder';

/** Ready-made example models shipped with the app (resources/handy_models), shown under "Add Handy models". */
export const HANDY_MODELS = [
  { label: 'Orca Cube', file: 'OrcaCube_v2.drc' },
  { label: 'Orca Tolerance Test', file: 'OrcaToleranceTest.drc' },
  { label: '3DBenchy', file: '3DBenchy.drc' },
  { label: 'Autodesk FDM Test', file: 'ksr_fdmtest_v4.drc' },
  { label: 'Voron Cube', file: 'Voron_Design_Cube_v7.drc' },
  { label: 'Stanford Bunny', file: 'Stanford_Bunny.drc' },
  { label: 'Orca String Hell', file: 'Orca_stringhell.drc' }
] as const;

export async function loadHandyModel(model: (typeof HANDY_MODELS)[number]): Promise<File> {
  const res = await fetch(`/resources/handy_models/${model.file}`);
  if (!res.ok) throw new Error(`Could not load ${model.label} (${res.status}).`);
  const stl = await decodeDracoToStlBuffer(await res.arrayBuffer());
  return new File([stl], `${model.label}.stl`, { type: 'model/stl' });
}
