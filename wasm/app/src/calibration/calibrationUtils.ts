import { getEngine, getConfig } from '../engine/orcaEngine';
import { useAppStore } from '../store/appStore';
import { decodeDracoToStlBuffer } from './dracoDecoder';
import { withCalibrationProjectSafety } from './calibrationRunner';
import { usePlateStore } from '../plate/plateStore';
import { useObjectListStore } from '../objectlist/objectListStore';

export async function processDrcFiles(drcUrls: Record<string, string>): Promise<Record<string, string>> {
  const engine = await getEngine();
  const meshes: Record<string, string> = {};

  for (const [name, url] of Object.entries(drcUrls)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${name} from ${url}`);
    const drcBuffer = await res.arrayBuffer();
    const stlBuffer = await decodeDracoToStlBuffer(drcBuffer);
    
    const memfsPath = `/MEMFS/${name.replace('.drc', '.stl')}`;
    await engine.writeFile(memfsPath, new Uint8Array(stlBuffer));
    meshes[name] = memfsPath;
  }
  
  return meshes;
}

export async function runOtherCalibration(
  calibrationName: string,
  options: Record<string, unknown>,
  drcUrls: Record<string, string>
) {
  return withCalibrationProjectSafety(`Calibration: ${calibrationName}`, async () => {
    const engine = await getEngine();
    const meshes = await processDrcFiles(drcUrls);
    
    const res = await engine.call('setupCalibration', {
      ...options,
      meshes
    });
    if (res === false || res?.ok === false) {
      throw new Error("setupCalibration returned false");
    }
    
    // setupCalibration edits the engine's options like desktop edits the presets; mirror them in the app.
    const before = useAppStore.getState().currentConfig;
    const effective = await getConfig();
    const changed = Object.fromEntries(Object.entries(effective).filter(([k, v]) => before[k] !== v));
    useAppStore.setState((s) => ({
      currentConfig: effective,
      processOverrides: { ...s.processOverrides, ...changed }
    }));

    await usePlateStore.getState().refreshObjects();
    await useObjectListStore.getState().refreshTree();
  });
}
