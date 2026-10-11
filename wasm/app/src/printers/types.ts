export type HostType = 'moonraker' | 'octoprint' | 'prusalink' | 'prusaconnect' | 'bambu' | 'bambu-cloud' | 'creality-cloud' | 'flashforge';

export const HOST_TYPE_LABELS: Record<HostType, string> = {
  moonraker: 'Klipper (Moonraker)',
  prusalink: 'PrusaLink',
  prusaconnect: 'Prusa Connect (cloud)',
  octoprint: 'OctoPrint',
  bambu: 'Bambu Lab (LAN mode)',
  'bambu-cloud': 'Bambu Cloud',
  'creality-cloud': 'Creality Cloud',
  flashforge: 'Flashforge'
};

/** A printer preset plus how to reach the machine, like desktop's physical printer. */
export interface PhysicalPrinter {
  id: string;
  name: string;
  /** Name of the printer preset this machine uses. */
  preset?: string;
  /** Brand of that preset, so it can be selected again after a refresh. */
  vendor?: string;
  /** Prepare tab filament presets and colors, stored per physical device. */
  filamentPresets?: string[];
  filamentColors?: string[];
  host_type: HostType;
  /** Hostname, IP or URL of the API (`print_host`). */
  print_host: string;
  /** Address of the printer's own web UI (`print_host_webui`). Defaults to `print_host`. */
  print_host_webui?: string;
  /** API key, or the Bambu access code. */
  printhost_apikey?: string;
  /** PrusaLink / HTTP digest credentials. */
  printhost_user?: string;
  printhost_password?: string;
  /** Cloud login email, separate from the account's MQTT username or user ID. */
  cloud_account?: string;
  cloud_region?: 'global' | 'china';
  /** Cloud telemetry identifier, separate from the printer's device name/serial. */
  cloud_device_id?: string;
  /** Bambu device serial number. */
  serial?: string;
  /** Go through the app server's printer gateway. Needed unless the printer allows this origin. */
  use_gateway: boolean;
  /** Address of the gateway program on the user's computer. When set, requests go there instead of to the app server. */
  local_gateway?: string;
}

export type PrinterRunState = 'offline' | 'ready' | 'printing' | 'paused' | 'complete' | 'error' | 'unknown';

export interface Heater {
  id: string;
  label: string;
  kind: 'extruder' | 'bed' | 'chamber' | 'other';
  current: number;
  target: number;
}

export interface Fan {
  id: string;
  label: string;
  /** 0 to 1 */
  speed: number;
}

export interface Webcam {
  name: string;
  /** Absolute or gateway URL of an MJPEG stream or snapshot, ready for an <img>. */
  url: string;
  snapshot?: boolean;
}

export interface PrinterFile {
  name: string;
  size?: number;
  modified?: number;
}

export interface PrinterFilament {
  id: string;
  label: string;
  material: string;
  color?: string;
  presetId?: string;
  /** Physical tool index, when the printer reports a sparse tool map. */
  slotIndex?: number;
}

export interface PrinterState {
  state: PrinterRunState;
  message?: string;
  heaters: Heater[];
  fans: Fan[];
  /** 0 to 1 */
  progress?: number;
  file?: string;
  elapsed?: number;
  remaining?: number;
  layer?: { current: number; total?: number };
  /** Percent */
  speedFactor?: number;
  flowFactor?: number;
  position?: { x: number; y: number; z: number };
  /** The active tool/extruder on multi-tool machines. */
  activeTool?: string;
  /** Loaded slots reported by the printer. Never inferred from heater count. */
  filaments?: PrinterFilament[];
  software?: string;
  webcams?: Webcam[];
  files?: PrinterFile[];
}

export interface UploadOptions {
  filename: string;
  gcode: Uint8Array;
  print: boolean;
  onProgress?: (fraction: number) => void;
}

export interface ConnectOptions {
  /** Polling drivers slow down while this returns false (the Device tab is not showing). */
  isActive?: () => boolean;
}

export interface PrinterApi {
  /** Starts reading the printer's state. Returns a function that stops it. */
  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void, options?: ConnectOptions): () => void;
  /** One-off check used by the dialog's Test button; resolves with a short description of the printer. */
  test(): Promise<string>;
  upload(options: UploadOptions): Promise<void>;
}
