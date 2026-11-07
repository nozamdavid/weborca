import { getEngine } from '../engine/orcaEngine';
import { SurfaceFeature, MeasurementResult, SnapMode } from './types';

export async function getMeasurementFeature(params: {
  objectId: number;
  volumeId?: number;
  instanceId?: number;
  facetIndex: number;
  position: [number, number, number];
  selection?: SnapMode;
}): Promise<{ success: boolean; feature?: SurfaceFeature; error?: string }> {
  try {
    const engine = await getEngine();
    const res = await engine.call('getMeasurementFeature', params);
    if (res && typeof res === 'object') {
      return res as { success: boolean; feature?: SurfaceFeature; error?: string };
    }
    return { success: false, error: 'Empty response from getMeasurementFeature' };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function measureFeatures(params: {
  first: SurfaceFeature;
  second?: SurfaceFeature | null;
}): Promise<MeasurementResult> {
  try {
    const engine = await getEngine();
    const res = await engine.call('measureFeatures', params);
    if (res && typeof res === 'object') {
      return res as MeasurementResult;
    }
    return { success: false, error: 'Empty response from measureFeatures' };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}
