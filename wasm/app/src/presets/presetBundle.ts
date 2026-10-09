/**
 * @file presetBundle.ts
 * User preset bundle import and export module for OrcaSlicer Web.
 *
 * Implements:
 * - Versioned web preset bundle format (format: "orcaslicer-web-preset-bundle", version: 1)
 * - Validation of imported bundles with atomic failure semantics (preserves existing presets on error)
 * - Conflict resolution strategies: 'overwrite' | 'rename' | 'skip'
 * - Strict preservation of immutable system presets
 * - Plain file format reporting for web JSON bundles vs desktop archives
 */

import type { UserPreset, PresetKind, PresetBundle, ConflictStrategy, ImportBundleResult } from './types';

export const BUNDLE_FORMAT = 'orcaslicer-web-preset-bundle' as const;
export const BUNDLE_VERSION = 1 as const;

export const BUNDLE_BOUNDARY_NOTE =
  'OrcaSlicer Web supports web preset bundles in JSON format (format: orcaslicer-web-preset-bundle, version: 1). Desktop .orca_bundle archives are not supported.';

/**
 * Creates a versioned preset bundle from user presets.
 */
export function exportPresetBundle(
  userPresets: UserPreset[],
  options?: {
    kinds?: PresetKind[];
    description?: string;
  }
): PresetBundle {
  let presetsToExport = [...userPresets];
  if (options?.kinds && options.kinds.length > 0) {
    const kindsSet = new Set(options.kinds);
    presetsToExport = presetsToExport.filter((p) => kindsSet.has(p.kind));
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    generator: 'OrcaSlicer Web',
    description: options?.description,
    presets: presetsToExport.map((p) => ({
      name: p.name,
      kind: p.kind,
      inherits: p.inherits,
      values: { ...p.values }
    }))
  };
}

/**
 * Serializes a PresetBundle to formatted JSON string.
 */
export function serializePresetBundle(bundle: PresetBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Validates a raw bundle (object or JSON string).
 * Returns normalized bundle or descriptive validation error without mutating any state.
 */
export function validatePresetBundle(
  raw: unknown
): { valid: true; bundle: PresetBundle } | { valid: false; error: string } {
  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { valid: false, error: 'Bundle input is empty.' };
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (err: any) {
      return { valid: false, error: `Malformed bundle JSON: ${err.message || String(err)}` };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'Malformed bundle: root payload must be a JSON object.' };
  }

  const obj = parsed as Record<string, any>;

  // Check format identifier
  if (obj.format !== BUNDLE_FORMAT) {
    return {
      valid: false,
      error: obj.format
        ? `Unsupported bundle format "${obj.format}". ${BUNDLE_BOUNDARY_NOTE}`
        : `Missing required bundle format identifier. ${BUNDLE_BOUNDARY_NOTE}`
    };
  }

  // Check version
  if (obj.version !== BUNDLE_VERSION) {
    return {
      valid: false,
      error: obj.version !== undefined
        ? `Unsupported bundle version "${obj.version}". Expected version ${BUNDLE_VERSION}.`
        : `Missing required bundle version. Expected version ${BUNDLE_VERSION}.`
    };
  }

  // Check presets array
  if (!Array.isArray(obj.presets)) {
    return { valid: false, error: 'Malformed bundle: "presets" property must be an array.' };
  }

  const validKinds: Set<PresetKind> = new Set(['process', 'filament', 'printer']);
  const normalizedPresets: UserPreset[] = [];

  for (let i = 0; i < obj.presets.length; i++) {
    const item = obj.presets[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, error: `Malformed preset at index ${i}: item must be an object.` };
    }

    if (typeof item.name !== 'string' || !item.name.trim()) {
      return { valid: false, error: `Malformed preset at index ${i}: "name" must be a non-empty string.` };
    }

    if (!validKinds.has(item.kind)) {
      return {
        valid: false,
        error: `Malformed preset "${item.name}": "kind" must be one of 'process', 'filament', or 'printer', got "${item.kind}".`
      };
    }

    if (typeof item.inherits !== 'string') {
      return {
        valid: false,
        error: `Malformed preset "${item.name}": "inherits" must be a string.`
      };
    }

    if (!item.values || typeof item.values !== 'object' || Array.isArray(item.values)) {
      return {
        valid: false,
        error: `Malformed preset "${item.name}": "values" must be a key-value mapping object.`
      };
    }

    const cleanValues: Record<string, string> = {};
    for (const [key, val] of Object.entries(item.values)) {
      if (typeof key !== 'string' || !key.trim()) {
        return { valid: false, error: `Malformed preset "${item.name}": invalid key in values.` };
      }
      if (typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') {
        return {
          valid: false,
          error: `Malformed preset "${item.name}": value for key "${key}" must be a scalar value.`
        };
      }
      cleanValues[key] = String(val);
    }

    normalizedPresets.push({
      name: item.name.trim(),
      kind: item.kind as PresetKind,
      inherits: item.inherits.trim(),
      values: cleanValues
    });
  }

  return {
    valid: true,
    bundle: {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      generator: typeof obj.generator === 'string' ? obj.generator : 'OrcaSlicer Web',
      description: typeof obj.description === 'string' ? obj.description : undefined,
      presets: normalizedPresets
    }
  };
}

/**
 * Resolves imported presets against existing user presets and system presets,
 * applying the selected conflict resolution strategy.
 * Preserves system presets under all conditions.
 * Remaps inheritance references when parent presets in the bundle are renamed.
 */
export function resolvePresetBundleImport(
  bundle: PresetBundle,
  existingUserPresets: UserPreset[],
  systemPresetNames: {
    process?: Iterable<string>;
    filament?: Iterable<string>;
    printer?: Iterable<string>;
  },
  strategy: ConflictStrategy = 'overwrite'
): ImportBundleResult {
  if (!['overwrite', 'rename', 'skip'].includes(strategy)) {
    throw new Error(`Invalid conflict strategy "${strategy}". Must be 'overwrite', 'rename', or 'skip'.`);
  }

  const sysSets: Record<PresetKind, Set<string>> = {
    process: new Set(systemPresetNames.process || []),
    filament: new Set(systemPresetNames.filament || []),
    printer: new Set(systemPresetNames.printer || [])
  };

  const currentPresets = [...existingUserPresets];
  const importedPresets: UserPreset[] = [];
  const bundleRenames = new Map<string, string>();
  let importedCount = 0;
  let overwrittenCount = 0;
  let renamedCount = 0;
  let skippedCount = 0;
  const renamedItems: Array<{ original: string; newName: string; kind: PresetKind }> = [];

  for (const preset of bundle.presets) {
    const isSystemCollision = sysSets[preset.kind].has(preset.name);
    const existingIndex = currentPresets.findIndex(
      (p) => p.kind === preset.kind && p.name === preset.name
    );

    // 1. Immutable system presets preservation
    if (isSystemCollision) {
      if (strategy === 'overwrite') {
        throw new Error(
          `Cannot overwrite immutable system preset "${preset.name}". System presets are read-only.`
        );
      } else if (strategy === 'skip') {
        skippedCount++;
        continue;
      } else if (strategy === 'rename') {
        let counter = 1;
        let candidateName = `${preset.name} (Custom)`;
        while (
          sysSets[preset.kind].has(candidateName) ||
          currentPresets.some((p) => p.kind === preset.kind && p.name === candidateName)
        ) {
          counter++;
          candidateName = `${preset.name} (Custom ${counter})`;
        }
        const importedPreset: UserPreset = {
          ...preset,
          name: candidateName
        };
        currentPresets.push(importedPreset);
        importedPresets.push(importedPreset);
        bundleRenames.set(`${preset.kind}:${preset.name}`, candidateName);
        renamedCount++;
        importedCount++;
        renamedItems.push({ original: preset.name, newName: candidateName, kind: preset.kind });
        continue;
      }
    }

    // 2. Existing user preset conflict handling
    if (existingIndex >= 0) {
      if (strategy === 'overwrite') {
        const importedPreset: UserPreset = { ...preset };
        currentPresets[existingIndex] = importedPreset;
        importedPresets.push(importedPreset);
        overwrittenCount++;
        importedCount++;
      } else if (strategy === 'skip') {
        skippedCount++;
      } else if (strategy === 'rename') {
        let counter = 1;
        let candidateName = `${preset.name} (Copy)`;
        while (
          sysSets[preset.kind].has(candidateName) ||
          currentPresets.some((p) => p.kind === preset.kind && p.name === candidateName)
        ) {
          counter++;
          candidateName = `${preset.name} (Copy ${counter})`;
        }
        const importedPreset: UserPreset = {
          ...preset,
          name: candidateName
        };
        currentPresets.push(importedPreset);
        importedPresets.push(importedPreset);
        bundleRenames.set(`${preset.kind}:${preset.name}`, candidateName);
        renamedCount++;
        importedCount++;
        renamedItems.push({ original: preset.name, newName: candidateName, kind: preset.kind });
      }
    } else {
      // 3. New preset without collision
      const importedPreset: UserPreset = { ...preset };
      currentPresets.push(importedPreset);
      importedPresets.push(importedPreset);
      importedCount++;
    }
  }

  // Remap inheritance references for imported presets if their parent preset in the bundle was renamed
  if (bundleRenames.size > 0) {
    for (const item of importedPresets) {
      const key = `${item.kind}:${item.inherits}`;
      if (bundleRenames.has(key)) {
        item.inherits = bundleRenames.get(key)!;
      }
    }
  }

  const parts: string[] = [];
  if (importedCount > 0) parts.push(`${importedCount} imported`);
  if (overwrittenCount > 0) parts.push(`${overwrittenCount} overwritten`);
  if (renamedCount > 0) parts.push(`${renamedCount} renamed`);
  if (skippedCount > 0) parts.push(`${skippedCount} skipped`);

  const message = parts.length > 0 ? `Bundle imported successfully: ${parts.join(', ')}.` : 'Bundle import completed with no changes.';

  return {
    success: true,
    message,
    allPresets: currentPresets,
    importedCount,
    skippedCount,
    renamedCount,
    overwrittenCount,
    renamedItems
  };
}

/**
 * Triggers browser download of preset bundle as JSON file.
 */
export function downloadPresetBundle(bundle: PresetBundle, fileName = 'orcaslicer_presets_bundle.json'): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') {
    return;
  }
  const json = serializePresetBundle(bundle);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
