/**
 * @file layerRangeSync.ts
 * Serializes and syncs layer height ranges (layer_config_ranges) to/from the WASM engine.
 *
 * Slic3r stores layer height ranges on ModelObject::layer_config_ranges and persists
 * them to 3MF archives under Metadata/layer_config_ranges.xml.
 */

import { zipSync, unzipSync, strToU8 } from 'fflate';
import { getEngine } from '../engine/orcaEngine';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';
import type { ObjectTreeNode, LayerRangeTreeNode } from './types';

export function buildLayerConfigRangesXml(objects: ObjectTreeNode[]): string {
  let hasAny = false;
  const objectXmlParts: string[] = [];

  objects.forEach((obj, idx) => {
    if (!obj.layerRanges || obj.layerRanges.length === 0) return;
    hasAny = true;
    const rangesXml = obj.layerRanges
      .map((r) => {
        const config = { ...r.config };
        if (!config.layer_height) {
          config.layer_height = '0.2';
        }
        const optsXml = Object.entries(config)
          .map(([k, v]) => `   <option opt_key="${k}">${v}</option>`)
          .join('\n');
        return `  <range min_z="${r.minZ}" max_z="${r.maxZ}">\n${optsXml}\n  </range>`;
      })
      .join('\n');
    objectXmlParts.push(` <object id="${idx + 1}">\n${rangesXml}\n </object>`);
  });

  if (!hasAny) return '';

  return `<?xml version="1.0" encoding="utf-8"?>\n<objects>\n${objectXmlParts.join('\n')}\n</objects>\n`;
}

export async function syncLayerRangesToEngine(objects: ObjectTreeNode[]): Promise<void> {
  const engine = await getEngine();
  const tempPath = '/tmp/layer_ranges_sync.3mf';

  // 1. Export current project state to a temporary fast-compressed 3MF archive
  await engine.call('saveProject', { path: tempPath, compressionLevel: 1 });
  const zipBytes = await engine.readFile(tempPath);
  const unzipped = unzipSync(zipBytes);

  // 2. Generate and inject Metadata/layer_config_ranges.xml
  const xml = buildLayerConfigRangesXml(objects);
  const xmlKey = 'Metadata/layer_config_ranges.xml';

  if (xml) {
    unzipped[xmlKey] = strToU8(xml);
  } else {
    delete unzipped[xmlKey];
    delete unzipped['Metadata/Prusa_Slicer_layer_config_ranges.xml'];
  }

  // 3. Repack the archive and write back to VFS
  const newZip = zipSync(unzipped);
  await engine.writeFile(tempPath, newZip);

  // 4. Open the project back into the engine so ModelObject::layer_config_ranges is populated
  await engine.call('openProject', { path: tempPath });

  try {
    const currentConfig = useAppStore.getState().currentConfig;
    if (currentConfig && Object.keys(currentConfig).length > 0) {
      await engine.call('setOptions', { options: currentConfig });
    }
  } catch (_) {}

  // 5. Invalidate slice preview so UI knows slice state is stale
  try {
    useAppStore.getState().invalidateSlicePreview();
  } catch (_) {}
}

export function validateRangeBounds(
  minZ: number,
  maxZ: number,
  objectHeight: number,
  existingRanges: LayerRangeTreeNode[],
  ignoreIndex: number = -1
): { valid: boolean; error?: string } {
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return { valid: false, error: 'Heights must be valid numbers' };
  }
  if (minZ < 0) {
    return { valid: false, error: 'Start height cannot be negative' };
  }
  if (minZ >= maxZ) {
    return { valid: false, error: 'Start height must be less than end height' };
  }
  if (maxZ > objectHeight + 0.05) {
    return { valid: false, error: 'End height exceeds object height' };
  }
  if (maxZ - minZ < 0.01) {
    return { valid: false, error: 'Range span must be at least 0.01 mm' };
  }

  // Check overlap with other ranges
  for (let i = 0; i < existingRanges.length; i++) {
    if (i === ignoreIndex) continue;
    const other = existingRanges[i];
    // Two ranges [minA, maxA] and [minB, maxB] overlap if minA < maxB and maxA > minB
    if (minZ < other.maxZ - 1e-4 && maxZ > other.minZ + 1e-4) {
      return {
        valid: false,
        error: `Overlaps with existing range [${other.minZ.toFixed(2)}, ${other.maxZ.toFixed(2)}]`
      };
    }
  }

  return { valid: true };
}
