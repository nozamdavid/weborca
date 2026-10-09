/**
 * @file orcaEngine.ts
 * Engine client module wrapping OrcaEngine.create() for the web application.
 */

import { OrcaEngine } from '../../../web/orca-engine.js';
import type {
  ParsedPreset,
  LayerEvent,
  GetLayerEventsParams,
  GetLayerEventsResult,
  SetLayerEventsParams,
  SetLayerEventsResult,
  ClearLayerEventsParams,
  ClearLayerEventsResult
} from '../../../web/orca-engine.js';
import type {
  PresetItem,
  LoadModelResult,
  StepImportOptions,
  SliceResult,
  ProgressNotification,
  ConfigOptionDef,
  EvaluateRulesResult,
  SetOptionsResult
} from './types';

export type {
  LayerEvent,
  GetLayerEventsParams,
  GetLayerEventsResult,
  SetLayerEventsParams,
  SetLayerEventsResult,
  ClearLayerEventsParams,
  ClearLayerEventsResult
};

let engineInstance: OrcaEngine | null = null;
let initPromise: Promise<OrcaEngine> | null = null;

export async function getEngine(): Promise<OrcaEngine> {
  if (engineInstance) return engineInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const threads = Math.min(
        typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4,
        8
      );

      // Using /engine-worker.js, /engine/orca_engine.mjs, and /profiles/ which are
      // served directly via Vite middleware in dev and copied to dist/ in production.
      const engine = await OrcaEngine.create({
        workerUrl: '/engine-worker.js',
        moduleUrl: '/engine/orca_engine.mjs',
        profilesUrl: '/profiles/',
        threads
      });

      engineInstance = engine;
      return engine;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

export async function loadVendors(vendors: string[]): Promise<void> {
  const engine = await getEngine();
  await engine.loadVendors(vendors);
}

export async function listPresets(
  kind: 'printer' | 'process' | 'filament',
  options?: { compatibleOnly?: boolean }
): Promise<PresetItem[]> {
  const engine = await getEngine();
  const res = await engine.listPresets(kind, options);
  return res as PresetItem[];
}

export async function getCompatiblePresets(params: {
  printer: string;
  printerName?: string;
  printerOverrides?: Record<string, string>;
  userPresets?: Array<{
    name: string;
    kind: 'process' | 'filament';
    inherits: string;
    values?: Record<string, string>;
  }>;
}): Promise<{
  compatibleUserPresets: string[];
  compatibleProcesses: string[];
  compatibleFilaments: string[];
}> {
  const engine = await getEngine();
  return await engine.call('getCompatiblePresets', params);
}

export async function selectPresets(selection: {
  printer: string;
  process: string;
  filaments: string[];
}): Promise<void> {
  const engine = await getEngine();
  await engine.selectPresets(selection);
}

export async function getConfig(): Promise<Record<string, string>> {
  const engine = await getEngine();
  return await engine.getConfig();
}

export async function getConfigDef(keys?: string[]): Promise<Record<string, ConfigOptionDef>> {
  const engine = await getEngine();
  return (await engine.getConfigDef(keys)) as Record<string, ConfigOptionDef>;
}

export async function evaluateRules(options?: {
  kind: 'print' | 'printer' | 'filament' | 'sla_print' | 'sla_material';
  filamentIndex?: number;
}): Promise<EvaluateRulesResult> {
  const engine = await getEngine();
  return (await engine.evaluateRules(options)) as EvaluateRulesResult;
}

export async function parsePreset(format: 'json' | 'ini', text: string): Promise<ParsedPreset> {
  const engine = await getEngine();
  return await engine.parsePreset(format, text);
}

export async function setOptions(options: Record<string, string>): Promise<SetOptionsResult> {
  const engine = await getEngine();
  return (await engine.setOptions(options)) as SetOptionsResult;
}

export async function resetOptions(): Promise<void> {
  const engine = await getEngine();
  await engine.resetOptions();
}

export async function loadModel(fileName: string, bytes: Uint8Array | ArrayBuffer, options?: StepImportOptions): Promise<LoadModelResult> {
  const engine = await getEngine();
  const res = await engine.loadModel(fileName, bytes, options);
  return res as LoadModelResult;
}

export async function addModel(fileName: string, bytes: Uint8Array | ArrayBuffer, options?: StepImportOptions): Promise<LoadModelResult> {
  const engine = await getEngine();
  const res = await engine.addModel(fileName, bytes, options);
  return res as LoadModelResult;
}

export async function listObjects(): Promise<any[]> {
  const engine = await getEngine();
  return await engine.listObjects();
}

export async function getMesh(objectId: number): Promise<{ path: string; vertexCount: number; triangleCount: number; buffer: Uint8Array }> {
  const engine = await getEngine();
  return await engine.getMesh(objectId);
}

export async function setInstanceTransform(params: {
  objectId: number;
  instanceId: number;
  offset?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
}): Promise<void> {
  const engine = await getEngine();
  await engine.setInstanceTransform(params);
}

export async function deleteObject(objectId: number): Promise<void> {
  const engine = await getEngine();
  await engine.deleteObject(objectId);
}

export async function duplicateInstance(objectId: number, instanceId: number): Promise<{ instanceId: number; id: number }> {
  const engine = await getEngine();
  return await engine.duplicateInstance(objectId, instanceId);
}

export async function arrange(options?: { useBed?: boolean }): Promise<void> {
  const engine = await getEngine();
  await engine.arrange(options);
}

export async function getObjectTree(): Promise<{ objects: Array<any> }> {
  const engine = await getEngine();
  return await engine.getObjectTree();
}

export async function addVolume(params: {
  objectId: number;
  type: string;
  shape: string;
  size?: number[] | number;
  offset?: number[];
  name?: string;
}): Promise<{ volumeId: number; id: number; name: string }> {
  const engine = await getEngine();
  return await engine.addVolume(params);
}

export async function deleteVolume(objectId: number, volumeId: number): Promise<void> {
  const engine = await getEngine();
  await engine.deleteVolume(objectId, volumeId);
}

export async function renameObject(objectId: number, name: string): Promise<void> {
  const engine = await getEngine();
  await engine.renameObject(objectId, name);
}

export async function renameVolume(objectId: number, volumeId: number, name: string): Promise<void> {
  const engine = await getEngine();
  await engine.renameVolume(objectId, volumeId, name);
}

export async function setObjectConfig(params: {
  objectId: number;
  volumeId?: number;
  options: Record<string, string>;
}): Promise<{ errors: Array<{ key: string; error: string }> }> {
  const engine = await getEngine();
  return await engine.setObjectConfig(params);
}

export async function resetObjectConfig(params: {
  objectId: number;
  volumeId?: number;
  keys?: string[];
}): Promise<void> {
  const engine = await getEngine();
  await engine.resetObjectConfig(params);
}

export async function setVolumeExtruder(objectId: number, volumeId: number, extruder: number): Promise<void> {
  const engine = await getEngine();
  await engine.setVolumeExtruder(objectId, volumeId, extruder);
}

export async function listPlates(): Promise<any[]> {
  const engine = await getEngine();
  return await engine.listPlates();
}

export async function addPlate(params?: { name?: string; config?: Record<string, string> }): Promise<any[]> {
  const engine = await getEngine();
  return await engine.addPlate(params);
}

export async function deletePlate(plateIndex: number, deleteObjects?: boolean): Promise<any[]> {
  const engine = await getEngine();
  return await engine.deletePlate(plateIndex, deleteObjects);
}

export async function setPlateConfig(params: {
  plateIndex: number;
  config?: Record<string, string>;
  name?: string;
  locked?: boolean;
}): Promise<void> {
  const engine = await getEngine();
  await engine.setPlateConfig(params);
}

export async function getLayerEvents(params?: GetLayerEventsParams): Promise<GetLayerEventsResult> {
  const engine = await getEngine();
  return await engine.getLayerEvents(params);
}

export async function setLayerEvents(params: SetLayerEventsParams): Promise<SetLayerEventsResult> {
  const engine = await getEngine();
  return await engine.setLayerEvents(params);
}

export async function clearLayerEvents(params?: ClearLayerEventsParams): Promise<ClearLayerEventsResult> {
  const engine = await getEngine();
  return await engine.clearLayerEvents(params);
}

export async function slice(options?: {
  threads?: number;
  signal?: AbortSignal;
  onProgress?: (p: ProgressNotification) => void;
  plateIndex?: number;
  outPath?: string;
}): Promise<SliceResult> {
  const engine = await getEngine();
  const res = await engine.slice(options);
  return res as SliceResult;
}

export function disposeEngine(): void {
  if (engineInstance) {
    try {
      engineInstance.dispose();
    } catch (_) {}
    engineInstance = null;
    initPromise = null;
  }
}
