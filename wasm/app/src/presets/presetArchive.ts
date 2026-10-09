/**
 * @file presetArchive.ts
 * Import and export module for native OrcaSlicer desktop preset archives (.orca_printer, .orca_filament, .zip)
 * and single presets (.json, .ini), with exact desktop compatibility:
 * - Desktop bundle_structure.json layout for printer and filament bundles
 * - Full legacy key & value migration matching PrintConfigDef::handle_legacy
 * - Atomic validation leaving state untouched on error
 * - Conflict resolution and system preset immutability preservation
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { UserPreset, PresetKind } from './types';
import { parsePreset } from '../engine/orcaEngine';
import { validatePresetBundle, BUNDLE_FORMAT, BUNDLE_BOUNDARY_NOTE } from './presetBundle';

export const SENSITIVE_PRINTER_KEYS = new Set([
  'print_host',
  'print_host_webui',
  'printhost_apikey',
  'printhost_cafile',
  'printhost_user',
  'printhost_password',
  'printhost_port'
]);



export const METADATA_KEYS = new Set([
  'name', 'type', 'from', 'version', 'setting_id', 'filament_id',
  'base_id', 'user_id', 'instantiation', 'inherits', 'include',
  'is_custom_defined', 'url', 'description', 'created_time', 'updated_time',
  'printer_settings_id', 'filament_settings_id', 'print_settings_id'
]);

/** Loads preset values through the engine (desktop's loader and legacy migration), minus metadata keys. */
async function loadPresetValues(format: 'json' | 'ini', text: string): Promise<Record<string, string>> {
  const { config } = await parsePreset(format, text);
  return Object.fromEntries(Object.entries(config).filter(([k]) => !METADATA_KEYS.has(k)));
}

const toIni = (values: Record<string, string>) =>
  Object.entries(values).map(([k, v]) => `${k} = ${v}`).join('\n');


/**
 * Parses a single desktop preset JSON string into a UserPreset.
 */
export async function parseSingleDesktopPresetJson(content: string, filenameHint = ''): Promise<UserPreset> {
  let obj: any;
  try {
    obj = JSON.parse(content);
  } catch (err: any) {
    throw new Error(`Malformed preset JSON: ${err.message || String(err)}`);
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Malformed preset JSON: root must be an object');
  }

  const nameCandidate = obj.name || obj.printer_settings_id || obj.filament_settings_id || obj.print_settings_id;
  const name = typeof nameCandidate === 'string' && nameCandidate.trim()
    ? nameCandidate.trim()
    : filenameHint.replace(/\.[^/.]+$/, '').trim();

  if (!name) {
    throw new Error('Preset JSON is missing required "name"');
  }

  // Determine kind
  let kind: PresetKind = 'process';
  const rawType = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';

  if (rawType === 'machine' || rawType === 'printer' || obj.printer_settings_id) {
    kind = 'printer';
  } else if (rawType === 'filament' || obj.filament_settings_id) {
    kind = 'filament';
  } else if (rawType === 'process' || rawType === 'print' || obj.print_settings_id) {
    kind = 'process';
  } else if (obj.nozzle_diameter || obj.printable_height || obj.printer_model) {
    kind = 'printer';
  } else if (obj.filament_flow_ratio || obj.filament_type || obj.nozzle_temperature) {
    kind = 'filament';
  }

  const inherits = typeof obj.inherits === 'string' ? obj.inherits.trim() : '';

  return {
    name,
    kind,
    inherits,
    values: await loadPresetValues('json', content)
  };
}

/**
 * Parses a desktop preset INI string into UserPreset array.
 */
export async function parseDesktopPresetIni(content: string, filenameHint = ''): Promise<UserPreset[]> {
  const lines = content.split(/\r?\n/);
  const defaultBaseName = filenameHint.replace(/\.[^/.]+$/, '').trim();

  interface Section {
    name: string;
    kind: PresetKind;
    inherits: string;
    rawValues: Record<string, string>;
  }

  const sections: Section[] = [];
  let currentSection: Section | null = null;
  const flatValues: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const header = sectionMatch[1].trim();
      let kind: PresetKind = 'process';
      let secName = defaultBaseName || header;

      if (header.startsWith('print:')) {
        kind = 'process';
        secName = header.substring('print:'.length).trim();
      } else if (header.startsWith('filament:')) {
        kind = 'filament';
        secName = header.substring('filament:'.length).trim();
      } else if (header.startsWith('printer:')) {
        kind = 'printer';
        secName = header.substring('printer:'.length).trim();
      } else if (header === 'presets') {
        continue;
      }

      currentSection = {
        name: secName,
        kind,
        inherits: '',
        rawValues: {}
      };
      sections.push(currentSection);
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();

    if (currentSection) {
      if (key === 'inherits') {
        currentSection.inherits = val;
      } else {
        currentSection.rawValues[key] = val;
      }
    } else {
      flatValues[key] = val;
    }
  }

  if (sections.length > 0) {
    return await Promise.all(sections.map(async (sec) => ({
      name: sec.name,
      kind: sec.kind,
      inherits: sec.inherits,
      values: await loadPresetValues('ini', toIni(sec.rawValues))
    })));
  }

  // Handle flat INI (single preset)
  let kind: PresetKind = 'process';
  let name = defaultBaseName;

  if (flatValues['printer_settings_id']) {
    kind = 'printer';
    name = flatValues['printer_settings_id'];
  } else if (flatValues['filament_settings_id']) {
    kind = 'filament';
    name = flatValues['filament_settings_id'];
  } else if (flatValues['print_settings_id']) {
    kind = 'process';
    name = flatValues['print_settings_id'];
  }

  if (!name) {
    name = 'Imported Preset';
  }

  return [
    {
      name,
      kind,
      inherits: flatValues['inherits'] || '',
      values: await loadPresetValues('ini', toIni(flatValues))
    }
  ];
}

/**
 * Extracts and parses presets from a native OrcaSlicer preset zip archive (.orca_printer, .orca_filament, .zip).
 */
export async function parseDesktopArchive(data: Uint8Array): Promise<{ presets: UserPreset[]; bundleStructure?: any }> {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(data);
  } catch (err: any) {
    throw new Error(`Malformed preset archive: invalid zip format (${err.message || String(err)})`);
  }

  const fileKeys = Object.keys(unzipped);
  if (fileKeys.length === 0) {
    throw new Error('Malformed preset archive: archive is empty');
  }

  let bundleStructure: any = null;
  const structureFile = fileKeys.find((k) => k.endsWith('bundle_structure.json'));
  if (structureFile) {
    try {
      const text = strFromU8(unzipped[structureFile]);
      bundleStructure = JSON.parse(text);
    } catch (_) {
      // Ignored if bundle structure json has issues, proceed to extract presets
    }
  }

  const presets: UserPreset[] = [];

  for (const filePath of fileKeys) {
    // Skip directories, OSX metadata, and bundle_structure.json
    if (
      filePath.endsWith('/') ||
      filePath.includes('__MACOSX/') ||
      filePath.endsWith('bundle_structure.json') ||
      filePath.endsWith('bundle_metadata.json')
    ) {
      continue;
    }

    const bytes = unzipped[filePath];
    if (!bytes || bytes.length === 0) continue;

    const baseName = filePath.split(/[\\/]/).pop() || filePath;

    if (filePath.toLowerCase().endsWith('.json')) {
      const text = strFromU8(bytes);
      const preset = await parseSingleDesktopPresetJson(text, baseName);
      presets.push(preset);
    } else if (filePath.toLowerCase().endsWith('.ini')) {
      const text = strFromU8(bytes);
      const inis = await parseDesktopPresetIni(text, baseName);
      presets.push(...inis);
    }
  }

  if (presets.length === 0) {
    throw new Error('Malformed preset archive: no valid preset files found');
  }

  return { presets, bundleStructure };
}

/**
 * Exports a printer preset bundle archive (.orca_printer) matching desktop OrcaSlicer layout.
 */
export function exportDesktopPrinterBundle(
  printerPreset: UserPreset,
  allUserPresets: UserPreset[],
  compatiblePresetNames?: Set<string> | string[]
): Uint8Array {
  const printerName = printerPreset.name;
  const timestamp = Date.now();
  const bundleId = `offline_${printerName}_${timestamp}`;

  const compatSet = compatiblePresetNames
    ? (compatiblePresetNames instanceof Set ? compatiblePresetNames : new Set(compatiblePresetNames))
    : null;

  const relatedFilaments = allUserPresets.filter(
    (p) => p.kind === 'filament' && (!compatSet || compatSet.has(p.name))
  );
  const relatedProcesses = allUserPresets.filter(
    (p) => p.kind === 'process' && (!compatSet || compatSet.has(p.name))
  );

  const bundleStructure = {
    version: '',
    bundle_id: bundleId,
    bundle_type: 'printer config bundle',
    printer_preset_name: printerName,
    printer_config: [`printer/${printerName}.json`],
    filament_config: relatedFilaments.map((f) => `filament/${f.name}.json`),
    process_config: relatedProcesses.map((p) => `process/${p.name}.json`)
  };

  // Safe printer values with print host keys erased
  const safePrinterValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(printerPreset.values)) {
    if (!SENSITIVE_PRINTER_KEYS.has(k)) {
      safePrinterValues[k] = v;
    }
  }

  const printerJson = {
    name: printerName,
    type: 'machine',
    from: 'User',
    inherits: printerPreset.inherits || '',
    version: '1.0.0.0',
    ...safePrinterValues
  };

  const zipFiles: Record<string, Uint8Array> = {
    'bundle_structure.json': strToU8(JSON.stringify(bundleStructure, null, 2)),
    [`printer/${printerName}.json`]: strToU8(JSON.stringify(printerJson, null, 2))
  };

  for (const fil of relatedFilaments) {
    const filJson = {
      name: fil.name,
      type: 'filament',
      from: 'User',
      inherits: fil.inherits || '',
      version: '1.0.0.0',
      ...fil.values
    };
    zipFiles[`filament/${fil.name}.json`] = strToU8(JSON.stringify(filJson, null, 2));
  }

  for (const proc of relatedProcesses) {
    const procJson = {
      name: proc.name,
      type: 'process',
      from: 'User',
      inherits: proc.inherits || '',
      version: '1.0.0.0',
      ...proc.values
    };
    zipFiles[`process/${proc.name}.json`] = strToU8(JSON.stringify(procJson, null, 2));
  }

  return zipSync(zipFiles);
}

/**
 * Exports a filament preset bundle archive (.orca_filament) matching desktop OrcaSlicer layout.
 */
export function exportDesktopFilamentBundle(
  filamentPreset: UserPreset,
  vendor = 'Custom'
): Uint8Array {
  const filamentName = filamentPreset.name;
  const timestamp = Date.now();
  const bundleId = `offline_${filamentName}_${timestamp}`;

  const filamentRelPath = `${vendor}/${filamentName}.json`;
  const bundleStructure = {
    version: '',
    bundle_id: bundleId,
    bundle_type: 'filament config bundle',
    filament_name: filamentName,
    printer_vendor: [
      {
        vendor,
        filament_path: [filamentRelPath]
      }
    ]
  };

  const filJson = {
    name: filamentName,
    type: 'filament',
    from: 'User',
    inherits: filamentPreset.inherits || '',
    version: '1.0.0.0',
    ...filamentPreset.values
  };

  return zipSync({
    'bundle_structure.json': strToU8(JSON.stringify(bundleStructure, null, 2)),
    [filamentRelPath]: strToU8(JSON.stringify(filJson, null, 2))
  });
}

/**
 * Exports a general presets ZIP archive containing all given user presets.
 */
export function exportDesktopPresetsZip(presets: UserPreset[]): Uint8Array {
  const zipFiles: Record<string, Uint8Array> = {};

  for (const p of presets) {
    const safeValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.values)) {
      if (p.kind === 'printer' && SENSITIVE_PRINTER_KEYS.has(k)) continue;
      safeValues[k] = v;
    }

    const typeStr = p.kind === 'printer' ? 'machine' : p.kind === 'filament' ? 'filament' : 'process';
    const jsonContent = {
      name: p.name,
      type: typeStr,
      from: 'User',
      inherits: p.inherits || '',
      version: '1.0.0.0',
      ...safeValues
    };
    zipFiles[`${p.name}.json`] = strToU8(JSON.stringify(jsonContent, null, 2));
  }

  return zipSync(zipFiles);
}

/**
 * Parses any preset bundle input (web JSON bundle, desktop .orca_printer / .orca_filament / .zip archive,
 * single preset .json, or single/multi-preset .ini).
 */
export async function parsePresetsFromUniversalInput(
  rawInput: unknown
): Promise<{ kind: 'web-bundle'; bundle: any } | { kind: 'parsed-presets'; presets: UserPreset[] }> {
  // 1. Check for binary zip buffer
  if (rawInput instanceof Uint8Array || rawInput instanceof ArrayBuffer) {
    const bytes = rawInput instanceof ArrayBuffer ? new Uint8Array(rawInput) : rawInput;
    const { presets } = await parseDesktopArchive(bytes);
    return { kind: 'parsed-presets', presets };
  }

  // 2. Check for base64-encoded zip or raw PK zip string
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      throw new Error('Preset input is empty.');
    }

    // Binary / Base64 zip detection
    if (trimmed.startsWith('PK\x03\x04') || trimmed.startsWith('UEsDB')) {
      let bytes: Uint8Array;
      if (trimmed.startsWith('UEsDB')) {
        const binStr = atob(trimmed);
        bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
      } else {
        bytes = strToU8(trimmed);
      }
      const { presets } = await parseDesktopArchive(bytes);
      return { kind: 'parsed-presets', presets };
    }

    // JSON string detection
    if (trimmed.startsWith('{') || (trimmed.startsWith('[') && !trimmed.match(/^\[[a-zA-Z0-9_]+:/))) {
      let parsed: any;
      let isJson = false;
      try {
        parsed = JSON.parse(trimmed);
        isJson = true;
      } catch (err: any) {
        if (trimmed.startsWith('{')) {
          throw new Error(`Malformed bundle JSON: ${err.message || String(err)}`);
        }
      }

      if (isJson) {
        // If it looks like a web bundle
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (parsed.format === BUNDLE_FORMAT) {
            const validated = validatePresetBundle(parsed);
            if (!validated.valid) {
              throw new Error(validated.error);
            }
            return { kind: 'web-bundle', bundle: validated.bundle };
          }

          // If it specifies an explicit unsupported format, enforce boundary error
          if (parsed.format) {
            throw new Error(`Unsupported bundle format "${parsed.format}". ${BUNDLE_BOUNDARY_NOTE}`);
          }

          // If it has version + presets (missing format identifier)
          if (parsed.version !== undefined && Array.isArray(parsed.presets)) {
            throw new Error(`Missing required bundle format identifier. ${BUNDLE_BOUNDARY_NOTE}`);
          }

          // If it's a single desktop preset JSON
          if (parsed.name || parsed.type || parsed.inherits || parsed.printer_settings_id || parsed.print_settings_id || parsed.filament_settings_id) {
            const single = await parseSingleDesktopPresetJson(trimmed);
            return { kind: 'parsed-presets', presets: [single] };
          }
        }

        // If array of presets
        if (Array.isArray(parsed)) {
          const presets = await Promise.all(parsed.map((item, idx) => parseSingleDesktopPresetJson(JSON.stringify(item), `preset_${idx}`)));
          return { kind: 'parsed-presets', presets };
        }
      }
    }

    // Try INI parsing
    if (trimmed.includes('=') || trimmed.startsWith('[') || trimmed.startsWith(';')) {
      const inis = await parseDesktopPresetIni(trimmed);
      if (inis.length > 0) {
        return { kind: 'parsed-presets', presets: inis };
      }
    }

    throw new Error('Unsupported preset format: expected JSON bundle, desktop archive (.orca_printer/.orca_filament/.zip), or INI file.');
  }

  // 3. Object input
  if (rawInput && typeof rawInput === 'object') {
    const obj = rawInput as Record<string, any>;
    if (obj.format === BUNDLE_FORMAT) {
      const validated = validatePresetBundle(obj);
      if (!validated.valid) throw new Error(validated.error);
      return { kind: 'web-bundle', bundle: validated.bundle };
    }
    if (obj.format) {
      throw new Error(`Unsupported bundle format "${obj.format}". ${BUNDLE_BOUNDARY_NOTE}`);
    }
    if (obj.version !== undefined && Array.isArray(obj.presets)) {
      throw new Error(`Missing required bundle format identifier. ${BUNDLE_BOUNDARY_NOTE}`);
    }
    if (obj.name || obj.type || obj.inherits) {
      const single = await parseSingleDesktopPresetJson(JSON.stringify(obj));
      return { kind: 'parsed-presets', presets: [single] };
    }
  }

  throw new Error('Invalid bundle input.');
}

/**
 * Downloads a binary Uint8Array archive in the browser.
 */
export function downloadBinaryArchive(data: Uint8Array, fileName: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') {
    return;
  }
  const blob = new Blob([data as unknown as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
