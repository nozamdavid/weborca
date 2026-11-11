/**
 * @file orcaEngine.ts
 * Engine client module wrapping OrcaEngine.create() for the web application.
 */

import { OrcaEngine } from '../../../web/orca-engine.js';
import { usePrefsStore } from '../prefs/prefsStore';
import { resolveSlicingThreads } from '../prefs/slicingThreads';
import { isStepFileName, tessellateStep } from './stepModule';
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
let initController: AbortController | null = null;
let generation = 0;
let suspended = false;
export type EngineLoadProgress = { phase: 'checking' | 'cached' | 'downloading' | 'initializing'; loaded?: number; total?: number };
let progressListener: ((progress: EngineLoadProgress) => void) | undefined;
export function onEngineLoadProgress(listener?: (progress: EngineLoadProgress) => void): void {
  progressListener = listener;
  if (listener) suspended = false;
}

export async function getEngine(): Promise<OrcaEngine> {
  if (suspended) throw new Error('Engine startup canceled');
  if (engineInstance) return engineInstance;
  if (initPromise) return initPromise;

  const current = generation;
  const controller = new AbortController();
  initController = controller;
  // User Timing separates cache access/transfer from worker/WASM runtime startup.
  // A cached binary still needs compilation, memory and native initialization.
  const mark = (stage: string) => {
    const name = `orca-engine:${stage}`;
    performance.clearMarks(name);
    performance.mark(name);
  };
  mark('start');
  let lastPhase = '';
  initPromise = (async () => {
    try {
      const threads = resolveSlicingThreads(usePrefsStore.getState().general.slicingThreads);

      // Using /engine-worker.js, /engine/orca_engine.mjs, and /profiles/ which are
      // served directly via Vite middleware in dev and copied to dist/ in production.
      const engine = await OrcaEngine.create({
        workerUrl: '/engine-worker.js',
        moduleUrl: '/engine/orca_engine.mjs',
        profilesUrl: '/profiles/',
        threads,
        signal: controller.signal,
        onProgress: progress => {
          if (current !== generation) return;
          if (progress.phase !== lastPhase) { mark(progress.phase); lastPhase = progress.phase; }
          progressListener?.(progress);
        }
      });
      if (current !== generation) { engine.dispose(); throw new Error('Engine startup canceled'); }
      engineInstance = engine;
      mark('runtime-ready');
      if (typeof window !== 'undefined') {
        (window as any).__orcaEngine = engine;
      }
      return engine;
    } catch (err) {
      if (current === generation) initPromise = null;
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
}): Promise<{ printer: string; process: string; filaments: string[] }> {
  const engine = await getEngine();
  return await engine.selectPresets(selection);
}

export async function getConfig(): Promise<Record<string, string>> {
  const engine = await getEngine();
  return await engine.getConfig();
}

export async function getPresetConfig(kind: 'printer' | 'process' | 'filament', name: string): Promise<Record<string, string>> {
  const engine = await getEngine();
  return await engine.call('getPresetConfig', { kind, name });
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
  const res = (await engine.setOptions(options)) as SetOptionsResult;
  const fatalErrors = res.errors?.filter(
    (e) => e.fatal === true || (e.code ? e.code !== 'unknown_key' : e.error !== 'Unknown option key')
  );
  if (fatalErrors && fatalErrors.length > 0) {
    const errorDetails = fatalErrors.map((e) => `${e.key}: ${e.error}`).join('; ');
    throw new Error(`Failed to apply options: ${errorDetails}`);
  }
  return res;
}

export async function resetOptions(args?: {
  key?: string;
  filamentIndex?: number;
  layoutIndex?: number;
  overrides?: Record<string, string>;
  baseline?: Record<string, string>;
  removeFilamentSlot?: boolean;
}): Promise<{ filamentOverrides?: Record<string, string> }> {
  const engine = await getEngine();
  return (await engine.call('resetOptions', args || {})) as { filamentOverrides?: Record<string, string> };
}

/**
 * STEP files are tessellated by the lazily loaded STEP module and handed to the
 * engine as a packed mesh; the engine itself has no STEP reader. A failure in
 * the module leaves the engine's project untouched.
 */
async function importStep(fileName: string, bytes: Uint8Array | ArrayBuffer, options: StepImportOptions | undefined, replace: boolean): Promise<LoadModelResult> {
  const engine = await getEngine();
  const packed = await tessellateStep(bytes, options);
  return (await engine.loadStepMesh(fileName, packed, { replace })) as LoadModelResult;
}

export async function loadModel(fileName: string, bytes: Uint8Array | ArrayBuffer, options?: StepImportOptions): Promise<LoadModelResult> {
  if (isStepFileName(fileName)) return await importStep(fileName, bytes, options, true);
  const engine = await getEngine();
  const res = await engine.loadModel(fileName, bytes, options);
  return res as LoadModelResult;
}

export async function addModel(fileName: string, bytes: Uint8Array | ArrayBuffer, options?: StepImportOptions): Promise<LoadModelResult> {
  if (isStepFileName(fileName)) return await importStep(fileName, bytes, options, false);
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

export async function mergeObjects(params: {
  instances?: Array<{ objectId: number; instanceId: number }>;
  objectIds?: number[];
  name?: string;
  plateIndex?: number;
}): Promise<{ objectId: number; id: number; instanceId: number; name: string; volumesCount: number }> {
  const engine = await getEngine();
  return await engine.call('mergeObjects', params);
}

export async function setVolumeType(params: {
  objectId: number;
  volumeId: number;
  type: string;
}): Promise<{ objectId: number; volumeId: number; type: string }> {
  const engine = await getEngine();
  return await engine.call('setVolumeType', params);
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

export async function readFile(path: string): Promise<Uint8Array> {
  const engine = await getEngine();
  return await engine.readFile(path);
}

export async function writeFile(path: string, bytes: Uint8Array | ArrayBuffer): Promise<void> {
  const engine = await getEngine();
  await engine.writeFile(path, bytes);
}

export async function saveProject(path: string = '/out/saved_project.3mf'): Promise<Uint8Array> {
  const engine = await getEngine();
  await engine.call('saveProject', { path });
  return await engine.readFile(path);
}

export async function openProject(fileName: string, bytes: Uint8Array | ArrayBuffer): Promise<any> {
  const engine = await getEngine();
  const path = "/models/" + fileName;
  await engine.writeFile(path, bytes);
  return await engine.call('openProject', { path });
}

export function disposeEngine(): void {
  generation++;
  suspended = true;
  initController?.abort();
  initController = null;
  initPromise = null;
  progressListener = undefined;
  if (typeof window !== 'undefined') delete (window as any).__orcaEngine;
  if (engineInstance) {
    try {
      engineInstance.dispose();
    } catch (_) {}
    engineInstance = null;
    initPromise = null;
  }
}

export async function setOption(args: {
  key: string;
  value: string;
  filamentIndex?: number;
  layoutIndex?: number;
}): Promise<void> {
  const engine = await getEngine();
  const res = (await engine.call('setOption', args)) as { success?: boolean; error?: string };
  if (res && res.success === false) {
    throw new Error(res.error || `Failed to set option '${args.key}'`);
  }
}

export async function getOption(args: {
  key: string;
  filamentIndex?: number;
  layoutIndex?: number;
  baseline?: boolean;
  serializedValue?: string;
}): Promise<{ value: string }> {
  const engine = await getEngine();
  return (await engine.call('getOption', args)) as { value: string };
}
