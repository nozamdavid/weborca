/**
 * @file flowRateCalibration.ts
 * Core logic for offline Flow Rate Calibration (Pass 1 and Pass 2).
 * Mirrors desktop OrcaSlicer's adjust_settings_for_flowrate_calib in src/slic3r/GUI/Plater.cpp
 * and generate_max_speed_parameter_value in src/slic3r/Utils/CalibUtils.cpp.
 */

import {
  loadModel,
  getObjectTree,
  setObjectConfig,
  setOptions,
  getConfig,
  setInstanceTransform,
  getEngine
} from '../engine/orcaEngine';
import { usePlateStore } from '../plate/plateStore';
import { useObjectListStore } from '../objectlist/objectListStore';
import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../history';
import type { HistorySnapshot } from '../history/types';
import type {
  FlowRatePass,
  InfillPattern,
  FlowRateModifierItem,
  FlowRateScalingResult,
  FlowRateSpeedsResult
} from './types';

/**
 * Checks whether a snapshot represents a valid retained history state.
 * Empty snapshots are valid with no slot. Nonempty snapshots require an allocated slot and filePath.
 */
function isValidHistorySnapshot(snap: HistorySnapshot | null | undefined): boolean {
  if (!snap) return false;
  if (snap.isEmpty) return true;
  return (
    typeof snap.filePath === 'string' &&
    snap.filePath.length > 0 &&
    typeof snap.slotId === 'number' &&
    snap.slotId >= 0
  );
}

/**
 * Extracts flowrate modifier from object name.
 * Upstream 3MF format:
 * Pass 1: flowrate_0, flowrate_5, flowrate_10, flowrate_15, flowrate_20,
 *         flowrate_m5, flowrate_m10, flowrate_m15, flowrate_m20
 * Pass 2: flowrate_0, flowrate_m1, flowrate_m2, ..., flowrate_m9
 * Note: 'm' indicates negative modifier (e.g. flowrate_m10 -> -10).
 */
export function parseFlowModifier(name: string): number | null {
  if (!name || !name.startsWith('flowrate_')) return null;
  let numStr = name.substring('flowrate_'.length);
  if (numStr.startsWith('m')) {
    numStr = '-' + numStr.substring(1);
  }
  const val = parseFloat(numStr);
  return isNaN(val) ? null : val;
}

/**
 * Validates that flow ratio is a finite positive number.
 */
export function isValidFlowRatio(flow: any): boolean {
  return typeof flow === 'number' && Number.isFinite(flow) && flow > 0;
}

/**
 * Validates that modifier percentage is a finite number in [-50, 50].
 */
export function isValidModifier(mod: any): boolean {
  return typeof mod === 'number' && Number.isFinite(mod) && mod >= -50 && mod <= 50;
}

/**
 * Calculates new flow ratio from old flow ratio and chip modifier percentage:
 * Formula: oldFlow * (100 + modifier) / 100
 */
export function calculateNewFlowRatio(oldFlow: number, modifier: number): number {
  const result = (oldFlow * (100 + modifier)) / 100;
  return Math.round(result * 10000) / 10000;
}

/**
 * Computes model scaling mirroring native adjust_settings_for_flowrate_calib():
 * - layer_height = nozzle_diameter / 2.0
 * - first_layer_height = max(current_initial_layer_height, layer_height)
 * - xyScale = nozzle_diameter / 0.6; sx = sy = xyScale > 1.2 ? xyScale : 1.0 (enlarge only)
 * - zscale = (first_layer_height + 9 * layer_height) / 2.0 (target exactly 10 layers)
 */
export function calculateFlowRateScaling(
  nozzleDiameter: number = 0.4,
  currentFirstLayerHeight?: number
): FlowRateScalingResult {
  const layerHeight = nozzleDiameter / 2.0;
  const preservedFirst =
    typeof currentFirstLayerHeight === 'number' &&
    Number.isFinite(currentFirstLayerHeight) &&
    currentFirstLayerHeight > 0
      ? Math.max(currentFirstLayerHeight, layerHeight)
      : layerHeight;
  const xyScale = nozzleDiameter / 0.6;
  const sx = xyScale > 1.2 ? xyScale : 1.0;
  const sy = xyScale > 1.2 ? xyScale : 1.0;
  const totalHeight = preservedFirst + 9 * layerHeight;
  const sz = totalHeight / 2.0;

  return {
    nozzleDiameter,
    layerHeight,
    firstLayerHeight: preservedFirst,
    xyScale,
    sx,
    sy,
    sz,
    totalHeight
  };
}

/**
 * Computes speed overrides mirroring native generate_max_speed_parameter_value():
 * - Flow::mm3_per_mm() = layer_height * (line_width - layer_height * (1 - 0.25 * PI))
 * - max_speed = filament_max_volumetric_speed / (flow.mm3_per_mm() * (pass == 1 ? 1.2 : 1.0))
 * - speed_value = floor(min(configured_speed, max_speed))
 */
export function calculateFlowRateSpeeds(
  config: Record<string, string>,
  pass: FlowRatePass,
  nozzleDiameter: number = 0.4,
  layerHeight: number = 0.2
): FlowRateSpeedsResult {
  let lineWidth = 1.125 * nozzleDiameter;
  const lwVal = config['line_width'];
  if (lwVal) {
    if (lwVal.includes('%')) {
      const pct = parseFloat(lwVal);
      if (Number.isFinite(pct) && pct > 0) {
        lineWidth = (pct / 100) * nozzleDiameter;
      }
    } else {
      const absVal = parseFloat(lwVal);
      if (Number.isFinite(absVal) && absVal > 0) {
        lineWidth = absVal;
      }
    }
  }

  const volumetricFlowPerMm = layerHeight * (lineWidth - layerHeight * (1.0 - 0.25 * Math.PI));
  const maxVolSpeed = parseFloat(config['filament_max_volumetric_speed'] || '15') || 15;
  const flowMultiplier = pass === 1 ? 1.2 : 1.0;
  const maxSpeed = volumetricFlowPerMm > 0 ? maxVolSpeed / (volumetricFlowPerMm * flowMultiplier) : 1e9;

  const configuredInternalSpeed = parseFloat(config['internal_solid_infill_speed'] || '200') || 200;
  const configuredTopSpeed = parseFloat(config['top_surface_speed'] || '150') || 150;

  const internalSolidInfillSpeed = Math.floor(Math.min(configuredInternalSpeed, maxSpeed));
  const topSurfaceSpeed = Math.floor(Math.min(configuredTopSpeed, maxSpeed));

  return {
    internalSolidInfillSpeed,
    topSurfaceSpeed,
    maxSpeed,
    volumetricFlowPerMm
  };
}

/**
 * Builds per-object configuration overrides mirroring native
 * adjust_settings_for_flowrate_calib() in src/slic3r/GUI/Plater.cpp.
 */
export function getFlowRateObjectConfig(
  modifier: number,
  nozzleDiameter: number = 0.4,
  pattern: InfillPattern = 'archimedeanchords',
  speeds?: { internalSolidInfillSpeed: number; topSurfaceSpeed: number }
): Record<string, string> {
  const flowRatio = (1.0 + modifier / 100.0).toFixed(4);
  const lineWidth = (nozzleDiameter * 1.2).toFixed(2);

  const cfg: Record<string, string> = {
    wall_loops: '1',
    only_one_wall_top: '1',
    thick_internal_bridges: '0',
    enable_extra_bridge_layer: 'disabled',
    internal_bridge_density: '100%',
    sparse_infill_density: '35%',
    min_width_top_surface: '100%',
    bottom_shell_layers: '2',
    top_shell_layers: '5',
    top_shell_thickness: '0',
    bottom_shell_thickness: '0',
    detect_thin_wall: '1',
    filter_out_gap_fill: '0',
    sparse_infill_pattern: 'rectilinear',
    top_surface_line_width: lineWidth,
    internal_solid_infill_line_width: lineWidth,
    top_surface_pattern: pattern,
    top_solid_infill_flow_ratio: '1',
    infill_direction: '45',
    solid_infill_direction: '135',
    center_of_surface_pattern: 'each_surface',
    separated_infills: '0',
    align_infill_direction_to_model: '1',
    ironing_type: 'no ironing',
    seam_slope_type: 'none',
    gap_fill_target: 'nowhere',
    calib_flowrate_topinfill_special_order: '1',
    top_surface_fill_order: 'default',
    print_flow_ratio: flowRatio
  };

  if (speeds) {
    cfg.internal_solid_infill_speed = speeds.internalSolidInfillSpeed.toString();
    cfg.top_surface_speed = speeds.topSurfaceSpeed.toString();
  }

  return cfg;
}

/**
 * Builds print and printer configuration overrides mirroring native
 * adjust_settings_for_flowrate_calib(), preserving first layer height max(current, nozzle/2).
 */
export function getFlowRatePrintConfig(
  nozzleDiameter: number = 0.4,
  firstLayerHeight?: number
): Record<string, string> {
  const layerHeight = nozzleDiameter / 2.0;
  const preservedFirst =
    typeof firstLayerHeight === 'number' &&
    Number.isFinite(firstLayerHeight) &&
    firstLayerHeight > 0
      ? Math.max(firstLayerHeight, layerHeight)
      : layerHeight;

  return {
    max_volumetric_extrusion_rate_slope: '0',
    layer_height: layerHeight.toString(),
    alternate_extra_wall: '0',
    initial_layer_print_height: preservedFirst.toString(),
    reduce_crossing_wall: '1',
    enable_wrapping_detection: '0',
    resonance_avoidance: '0'
  };
}

/**
 * Loads calibration 3MF asset.
 * Fetches from /calibration/flowrate-test-pass<N>.3mf, or uses provided custom buffer.
 */
export async function loadCalibrationAsset(
  pass: FlowRatePass,
  customBuffer?: ArrayBuffer
): Promise<ArrayBuffer> {
  if (customBuffer) {
    return customBuffer;
  }
  const assetUrl = `/calibration/flowrate-test-pass${pass}.3mf`;
  const res = await fetch(assetUrl);
  if (!res.ok) {
    throw new Error(`Failed to load calibration asset ${assetUrl}: ${res.statusText}`);
  }
  return await res.arrayBuffer();
}

/**
 * Executes flow rate calibration setup:
 * 1. Snapshots current project to history store so Undo will roll back.
 * 2. Checks pre-calibration snapshot validity: fail-closed before replacing any nonempty project.
 * 3. Loads calibration 3MF model.
 * 4. Applies native scaling (enlarging XY for large nozzles, Z to firstLayer+9*layerHeight).
 * 5. Applies native per-object modifiers, configs, and computed speed overrides.
 * 6. Applies print/printer config adjustments and updates appStore currentConfig.
 * 7. Commits calibration snapshot to history store.
 * 8. On ANY failure during or after loadModel, performs complete rollback to pre-calibration state.
 */
export async function runFlowRateCalibration(
  pass: FlowRatePass,
  pattern: InfillPattern = 'archimedeanchords',
  customBuffer?: ArrayBuffer
): Promise<FlowRateModifierItem[]> {
  const historyStore = useHistoryStore.getState();
  const appStore = useAppStore.getState();
  const plateStore = usePlateStore.getState();

  // Snapshot pre-calibration state for rollback on failure
  const prevCurrentSnapshot = historyStore.currentSnapshot;
  const prevConfig = { ...appStore.currentConfig };
  const prevProcessOverrides = { ...appStore.processOverrides };
  const prevModelFile = appStore.modelFile;
  const prevModelObjects = appStore.modelObjects;

  const isNonEmpty = plateStore.objects.length > 0;

  // 1. Commit pre-calibration transaction to history for undo rollback
  await historyStore.commitTransaction('Before Flow Rate Calibration');
  const preCalibSnapshot = useHistoryStore.getState().currentSnapshot;

  // Fail-closed check before replacing any nonempty project:
  // Require successful current snapshot filePath (and appropriate snapshot state),
  // otherwise show error and leave project untouched.
  if (isNonEmpty) {
    const isSnapshotValid =
      isValidHistorySnapshot(preCalibSnapshot) &&
      preCalibSnapshot?.isEmpty === false;

    if (!isSnapshotValid) {
      // Revert historyStore to valid retained state, discarding failed snapshot with freed/invalid slot
      // Do not reintroduce history entries whose slot files were evicted
      const currentHist = useHistoryStore.getState();
      const validPast = currentHist.past
        .slice(0, -1)
        .filter(isValidHistorySnapshot);

      const targetSnapshot =
        isValidHistorySnapshot(prevCurrentSnapshot)
          ? prevCurrentSnapshot
          : (validPast.length > 0 ? validPast[validPast.length - 1] : null);

      const finalPast = validPast.filter((s) => s.id !== targetSnapshot?.id);
      const totalBytes =
        (targetSnapshot?.byteSize || 1024) +
        finalPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0);

      useHistoryStore.setState({
        past: finalPast,
        currentSnapshot: targetSnapshot,
        canUndo: finalPast.length > 0,
        canRedo: false,
        totalRetainedBytes: totalBytes
      });

      throw new Error('Failed to create project snapshot backup before calibration. Current project preserved.');
    }
  }

  try {
    // 2. Fetch calibration asset
    const buffer = await loadCalibrationAsset(pass, customBuffer);
    const fileName = `flowrate-test-pass${pass}.3mf`;

    // 3. Load 3MF model into engine (replaces current plate)
    const loadRes = await loadModel(fileName, new Uint8Array(buffer));

    // 4. Update appStore model metadata
    useAppStore.setState({
      modelFile: { name: fileName, size: buffer.byteLength },
      modelObjects: loadRes.objects,
      sliceResult: null,
      gcodeUrl: null
    });

    // 5. Query object tree from engine
    const tree = await getObjectTree();
    const objects = tree.objects || [];

    // 6. Read current configuration
    const currentConfig = useAppStore.getState().currentConfig;
    const nozzleDiamStr = currentConfig['nozzle_diameter'] || '0.4';
    const nozzleDiameter = parseFloat(nozzleDiamStr) || 0.4;
    const currentFirstLayerStr = currentConfig['initial_layer_print_height'];
    const currentFirstLayer = currentFirstLayerStr ? parseFloat(currentFirstLayerStr) : undefined;

    // Compute scaling and speeds mirroring native desktop OrcaSlicer
    const scaling = calculateFlowRateScaling(nozzleDiameter, currentFirstLayer);
    const speeds = calculateFlowRateSpeeds(currentConfig, pass, nozzleDiameter, scaling.layerHeight);

    // 7. Apply scaling to all chip instances
    for (const obj of objects) {
      if (obj.instances && Array.isArray(obj.instances)) {
        for (const inst of obj.instances) {
          await setInstanceTransform({
            objectId: obj.id,
            instanceId: inst.id,
            scale: [scaling.sx, scaling.sy, scaling.sz]
          });
        }
      }
    }

    // 8. Apply per-object calibration modifiers, settings, and speeds
    const modifierItems: FlowRateModifierItem[] = [];
    for (const obj of objects) {
      const mod = parseFlowModifier(obj.name);
      if (mod !== null) {
        const objConfig = getFlowRateObjectConfig(mod, nozzleDiameter, pattern, speeds);
        await setObjectConfig({
          objectId: obj.id,
          options: objConfig
        });
        modifierItems.push({
          objectId: obj.id,
          name: obj.name,
          modifier: mod,
          flowRatio: 1.0 + mod / 100.0
        });
      }
    }

    // 9. Apply print & printer overrides
    const printConfig = getFlowRatePrintConfig(nozzleDiameter, currentFirstLayer);
    await setOptions(printConfig);

    // 10. Sync appStore currentConfig so it does NOT remain stale after direct setOptions
    const effectiveConfig = await getConfig();
    useAppStore.setState((s) => ({
      currentConfig: effectiveConfig,
      processOverrides: {
        ...s.processOverrides,
        ...printConfig
      }
    }));

    // 11. Refresh plateStore so objects, transforms & config overrides are updated on plate
    await plateStore.refreshObjects();

    // 12. Commit post-calibration transaction to history
    await historyStore.commitTransaction(`Flow Rate Calibration - Pass ${pass}`);

    return modifierItems;
  } catch (err: any) {
    console.error('[flowRateCalibration] Calibration setup failed, rolling back:', err);
    // Complete rollback to pre-calibration state
    try {
      // 1. Restore engine model from preCalibSnapshot
      try {
        const engine = await getEngine();
        if (preCalibSnapshot) {
          if (preCalibSnapshot.isEmpty) {
            let currentObjs: any[] = [];
            try {
              currentObjs = await engine.listObjects();
            } catch (_) {}
            for (const obj of currentObjs) {
              try {
                await engine.deleteObject(obj.id);
              } catch (_) {}
            }
            usePlateStore.setState({ objects: [], selectedObjectId: null, selectedInstanceId: null });
            useObjectListStore.setState({ objects: [], selectedObjectId: null, selectedVolumeId: null });
            useAppStore.setState({ modelFile: null, modelObjects: null });
          } else if (preCalibSnapshot.filePath) {
            await engine.call('openProject', { path: preCalibSnapshot.filePath });
          }
        }
      } catch (engineModelErr) {
        console.warn('[flowRateCalibration] Failed to restore engine model during rollback:', engineModelErr);
      }

      // 2. Restore engine options and sync app currentConfig
      let restoredEffectiveConfig = prevConfig;
      try {
        await setOptions(prevConfig);
        restoredEffectiveConfig = await getConfig();
      } catch (optErr) {
        console.warn('[flowRateCalibration] Failed to restore engine options during rollback:', optErr);
      }

      // 3. Always restore appStore config and processOverrides on late failure
      useAppStore.setState({
        currentConfig: restoredEffectiveConfig,
        processOverrides: prevProcessOverrides,
        modelFile: prevModelFile,
        modelObjects: prevModelObjects,
        sliceResult: null,
        gcodeUrl: null
      });

      // 4. Refresh plate objects and object list
      try {
        await plateStore.refreshObjects();
        await useObjectListStore.getState().refreshTree();
      } catch (refreshErr) {
        console.warn('[flowRateCalibration] Failed to refresh UI stores during rollback:', refreshErr);
      }

      // 5. Only restore valid retained state in history store without referring to freed/evicted slots
      const currentHist = useHistoryStore.getState();
      const allCandidatePast = currentHist.past.filter(isValidHistorySnapshot);

      const targetSnapshot =
        isValidHistorySnapshot(preCalibSnapshot)
          ? preCalibSnapshot
          : (isValidHistorySnapshot(prevCurrentSnapshot)
              ? prevCurrentSnapshot
              : (allCandidatePast.length > 0 ? allCandidatePast[allCandidatePast.length - 1] : null));

      const finalPast = allCandidatePast.filter((s) => s.id !== targetSnapshot?.id);
      const totalBytes =
        (targetSnapshot?.byteSize || 1024) +
        finalPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0);

      useHistoryStore.setState({
        past: finalPast,
        currentSnapshot: targetSnapshot,
        canUndo: finalPast.length > 0,
        canRedo: false,
        totalRetainedBytes: totalBytes
      });
    } catch (rollbackErr) {
      console.error('[flowRateCalibration] Rollback failed:', rollbackErr);
    }

    // Re-throw so caller knows generation failed
    throw err;
  }
}
