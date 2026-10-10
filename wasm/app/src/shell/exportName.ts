/**
 * @file exportName.ts
 * Pure helpers for expanding G-code export filename templates and sanitising names for file systems.
 */

export interface ExportNameVars {
  input_filename_base?: string;
  input_filename?: string;
  printer_model?: string;
  printer?: string;
  print_preset?: string;
  process?: string;
  process_preset?: string;
  filament_type?: string | string[];
  'filament_type[0]'?: string;
  'filament_type[initial_tool]'?: string;
  layer_height?: string | number;
  print_time?: string | number;
  plate?: string | number;
  plate_name?: string;
  timestamp?: string;
  initial_tool?: number;
  [key: string]: any;
}

export interface BuildExportGcodeFileNameOptions {
  modelFileName?: string | null;
  currentConfig?: Record<string, string>;
  presetConfig?: Record<string, string>;
  selectedPrinter?: string;
  selectedProcess?: string;
  selectedFilament?: string;
  selectedFilaments?: string[];
  printTimeS?: number;
  plateIndex?: number;
  plateName?: string;
  useProjectNameForExport?: boolean;
}

/** Formats a timestamp as YYYYMMDD-HHMMSS (matching desktop OrcaSlicer / PrusaSlicer). */
export function getDefaultTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${MM}${dd}-${HH}${mm}${ss}`;
}

/**
 * Formats print time in seconds for filename tags, matching desktop short_time (e.g. '1h23m', '45m', '30s').
 */
export function formatPrintTimeTag(seconds: number): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '0s';
  const totalSeconds = Math.floor(seconds);
  let days = Math.floor(totalSeconds / 86400);
  let rem = totalSeconds % 86400;
  let hours = Math.floor(rem / 3600);
  rem = rem % 3600;
  let minutes = Math.floor(rem / 60);
  const secs = rem % 60;

  // Round to full minutes when days + hours > 0 and secs >= 30 (matching desktop OrcaSlicer short_time)
  if (days + hours > 0 && secs >= 30) {
    minutes++;
    if (minutes === 60) {
      minutes = 0;
      hours++;
      if (hours === 24) {
        hours = 0;
        days++;
      }
    }
  }

  if (days > 0) {
    return `${days}d${hours}h${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }
  if (minutes > 0) {
    return secs > 0 ? `${minutes}m${secs}s` : `${minutes}m`;
  }
  return `${secs}s`;
}

/**
 * Sanitises a string for file systems:
 * strips / \ : * ? " < > | and control characters (0x00-0x1F, 0x7F-0x9F),
 * trims whitespace, and falls back to 'plate' if empty.
 */
export function sanitizeFileName(name: string): string {
  if (!name || typeof name !== 'string') return 'plate';
  const stripped = name.replace(/[/\\:*?"<>|\x00-\x1f\x7f-\x9f]/g, '').trim();
  if (stripped.length === 0 || stripped === '.' || stripped === '..') {
    return 'plate';
  }
  return stripped;
}

/**
 * Expands a filename format template supporting OrcaSlicer placeholders and sanitises the result.
 * Placeholders supported: {input_filename_base}, {printer_model}, {print_preset},
 * {filament_type[0]}, {layer_height}, {print_time} (e.g. '1h23m'), {plate}, {timestamp}.
 */
export function expandFileName(format?: string | null, vars: ExportNameVars = {}): string {
  if (!format || typeof format !== 'string') {
    return 'plate';
  }

  const expanded = format.replace(/\{([^{}]+)\}|\[([^\[\]]+)\]/g, (match, p1, p2) => {
    const rawKey = (p1 || p2 || '').trim();
    if (!rawKey) return match;

    // Check direct match in vars
    if (vars[rawKey] !== undefined && vars[rawKey] !== null) {
      if (rawKey === 'print_time' && typeof vars[rawKey] === 'number') {
        return formatPrintTimeTag(vars[rawKey]);
      }
      return String(vars[rawKey]);
    }

    switch (rawKey) {
      case 'input_filename_base': {
        const val =
          vars.input_filename_base ??
          (vars.input_filename ? String(vars.input_filename).replace(/\.[^/.]+$/, '') : '');
        return val ? String(val) : '';
      }
      case 'printer_model': {
        const val = vars.printer_model ?? vars.printer ?? '';
        return val ? String(val) : '';
      }
      case 'print_preset': {
        const val = vars.print_preset ?? vars.process ?? vars.process_preset ?? '';
        return val ? String(val) : '';
      }
      case 'layer_height': {
        const val = vars.layer_height ?? '';
        return val !== '' && val !== undefined ? String(val) : '';
      }
      case 'print_time': {
        if (typeof vars.print_time === 'number') {
          return formatPrintTimeTag(vars.print_time);
        }
        return vars.print_time ? String(vars.print_time) : '';
      }
      case 'plate': {
        return vars.plate !== undefined && vars.plate !== null ? String(vars.plate) : '';
      }
      case 'plate_name': {
        return vars.plate_name ?? (vars.plate !== undefined ? String(vars.plate) : '');
      }
      case 'timestamp': {
        if (vars.timestamp !== undefined && vars.timestamp !== null) {
          return String(vars.timestamp);
        }
        return getDefaultTimestamp();
      }
      default: {
        // Handle array index access like filament_type[0] or filament_type[initial_tool]
        const arrayMatch = rawKey.match(/^([a-zA-Z0-9_]+)\[([a-zA-Z0-9_]+)\]$/);
        if (arrayMatch) {
          const [, arrName, idxToken] = arrayMatch;
          let target = vars[arrName];
          if (typeof target === 'string' && target.includes(';')) {
            target = target.split(';').map((s: string) => s.trim());
          }
          if (Array.isArray(target)) {
            const idx =
              idxToken === 'initial_tool'
                ? (typeof vars.initial_tool === 'number' ? vars.initial_tool : 0)
                : parseInt(idxToken, 10);
            const val = !isNaN(idx) ? target[idx] : undefined;
            return val !== undefined && val !== null ? String(val) : '';
          } else if (
            target !== undefined &&
            target !== null &&
            (idxToken === '0' || idxToken === 'initial_tool')
          ) {
            return String(target);
          }
        }
        return '';
      }
    }
  });

  return sanitizeFileName(expanded);
}

/**
 * Builds the output G-code filename using the print preset's 'filename_format' option
 * if set, otherwise keeping the current web app naming behaviour.
 */
export function buildExportGcodeFileName(options: BuildExportGcodeFileNameOptions = {}): string {
  const {
    modelFileName,
    currentConfig = {},
    presetConfig = {},
    selectedPrinter = '',
    selectedProcess = '',
    selectedFilament = '',
    selectedFilaments = [],
    printTimeS = 0,
    plateIndex = 0,
    plateName = '',
    useProjectNameForExport = false
  } = options;

  const defaultBase = modelFileName
    ? (modelFileName.substring(0, modelFileName.lastIndexOf('.')) || modelFileName)
    : 'print';

  // If preference "Use the project name for exported files" is enabled, export with the project name
  if (useProjectNameForExport) {
    const cleanBase = sanitizeFileName(defaultBase);
    return `${cleanBase}.gcode`;
  }

  // Look for filename_format in currentConfig or presetConfig
  const format = (currentConfig['filename_format'] || presetConfig['filename_format'] || '').trim();

  // If no filename_format is configured, preserve current behaviour
  if (!format) {
    return modelFileName ? `${defaultBase}.gcode` : 'print.gcode';
  }

  // Determine filament types
  const filamentTypeStr = currentConfig['filament_type'] || presetConfig['filament_type'] || '';
  let filamentTypes: string[] = [];
  if (filamentTypeStr) {
    filamentTypes = filamentTypeStr.split(';').map((s) => s.trim());
  } else if (selectedFilaments.length > 0) {
    filamentTypes = selectedFilaments.map((f) => {
      const match = f.match(/^(?:Generic|Bambu|Prusament)?\s*([A-Za-z0-9+-]+)/i);
      return match ? match[1] : f;
    });
  } else if (selectedFilament) {
    const match = selectedFilament.match(/^(?:Generic|Bambu|Prusament)?\s*([A-Za-z0-9+-]+)/i);
    filamentTypes = [match ? match[1] : selectedFilament];
  } else {
    filamentTypes = ['PLA'];
  }

  const plateStr = plateName || String(plateIndex + 1);

  const vars: ExportNameVars = {
    ...presetConfig,
    ...currentConfig,
    input_filename_base: defaultBase,
    printer_model: selectedPrinter,
    print_preset: selectedProcess,
    filament_type: filamentTypes,
    'filament_type[0]': filamentTypes[0] || 'PLA',
    'filament_type[initial_tool]': filamentTypes[0] || 'PLA',
    layer_height: currentConfig['layer_height'] || presetConfig['layer_height'] || '0.2',
    print_time: printTimeS,
    plate: plateStr
  };

  let result = expandFileName(format, vars);
  if (!result.toLowerCase().endsWith('.gcode')) {
    result = `${result}.gcode`;
  }
  return result;
}
