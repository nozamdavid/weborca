import { decodeDracoToStlBuffer } from '../calibration/dracoDecoder';

/** Ready-made example models shipped with the app (resources/handy_models), shown under "Add Handy models". */
export const HANDY_MODELS = [
  { label: 'Orca Cube', files: ['OrcaCube_v2.drc', 'OrcaPlug_v2.drc'] },
  { label: 'OrcaSliced Combo', files: ['OrcaSliced.3mf', 'OrcaCube_v2.drc', 'OrcaPlug_v2.drc'] },
  { label: 'Orca Badge', files: ['OrcaBadge.3mf'] },
  { label: 'Orca Tolerance Test', files: ['OrcaToleranceTest.drc'] },
  { label: '3DBenchy', files: ['3DBenchy.drc'] },
  { label: 'Cali Cat', files: ['calicat.drc'] },
  { label: 'Autodesk FDM Test', files: ['ksr_fdmtest_v4.drc'] },
  { label: 'Voron Cube', files: ['Voron_Design_Cube_v7.drc'] },
  { label: 'Stanford Bunny', files: ['Stanford_Bunny.drc'] },
  { label: 'Orca String Hell', files: ['Orca_stringhell.drc'] }
] as const;

export async function loadHandyModel(model: (typeof HANDY_MODELS)[number]): Promise<File[]> {
  const files: File[] = [];
  for (const file of model.files) {
    const res = await fetch(`/resources/handy_models/${file}`);
    if (!res.ok) throw new Error(`Could not load ${file} for ${model.label} (${res.status}).`);

    const buffer = await res.arrayBuffer();
    if (file.endsWith('.drc')) {
      const stl = await decodeDracoToStlBuffer(buffer);
      files.push(new File([stl], file.replace(/\.drc$/, '.stl'), { type: 'model/stl' }));
    } else {
      files.push(new File([buffer], file, { type: file.endsWith('.3mf') ? 'application/vnd.ms-3mfdocument' : 'application/octet-stream' }));
    }
  }
  return files;
}
