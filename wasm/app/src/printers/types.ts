export type HostType = 'moonraker' | 'octoprint' | 'prusalink' | 'bambu';

export const HOST_TYPE_LABELS: Record<HostType, string> = {
  moonraker: 'Klipper (Moonraker)',
  prusalink: 'PrusaLink',
  octoprint: 'OctoPrint',
  bambu: 'Bambu Lab (LAN mode)'
};

/** A printer preset plus how to reach the machine, like desktop's physical printer. */
export interface PhysicalPrinter {
  id: string;
  name: string;
  /** Name of the printer preset this machine uses. */
  preset?: string;
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
  /** Bambu device serial number. */
  serial?: string;
  /** Go through the app server's printer gateway. Needed unless the printer allows this origin. */
  use_gateway: boolean;
  /** Address of the gateway program on the user's computer. When set, requests go there instead of to the app server. */
  local_gateway?: string;
}

export type PrinterRunState = 'offline' | 'ready' | 'printing' | 'paused' | 'complete' | 'error';

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
