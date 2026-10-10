import { bambuFtpUrl, bambuMqttUrl, sendWithProgress } from './gatewayUrl';
import type { PrinterFilament, Heater, PhysicalPrinter, PrinterApi, PrinterRunState, PrinterState, UploadOptions } from './types';

const CONNECT_TIMEOUT_MS = 12_000;

// Bambu's speed levels (spd_lvl): silent, standard, sport, ludicrous.
const SPEED_PERCENT = [0, 50, 100, 124, 166];

const STATES: Record<string, PrinterRunState> = {
  IDLE: 'ready', PREPARE: 'printing', RUNNING: 'printing', PAUSE: 'paused', FINISH: 'complete', FAILED: 'error'
};

/** Fans are reported as a "0".."15" string. */
const fan = (value: unknown) => Math.min(1, Math.max(0, Number(value) / 15));

/** AMS reports use RGBA hex; slicer colors use RGB. Empty trays have no material type. */
export function deriveBambuFilaments(print: Record<string, any>): PrinterFilament[] {
  const slots: PrinterFilament[] = [];
  const add = (tray: any, id: string, label: string) => {
    if (!tray || typeof tray.tray_type !== 'string' || !tray.tray_type.trim()) return;
    const hex = String(tray.tray_color || '').replace(/^#/, '');
    slots.push({ id, label, material: tray.tray_type, presetId: tray.tray_info_idx,
      color: /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex) ? `#${hex.slice(0, 6)}` : undefined });
  };
  for (const unit of print.ams?.ams ?? []) {
    for (const tray of unit.tray ?? []) add(tray, `ams:${unit.id}:${tray.id}`, `AMS ${Number(unit.id) + 1} / ${Number(tray.id) + 1}`);
  }
  if (Array.isArray(print.vir_slot)) {
    for (const tray of print.vir_slot) add(tray, `external:${tray.id}`, `External spool ${tray.id}`);
  } else add(print.vt_tray, 'external:254', 'External spool');
  return slots;
}

/** Status pushes can omit unchanged AMS units or trays. Retain their last reported fields. */
export function mergeBambuReport(previous: Record<string, any>, update: Record<string, any>): Record<string, any> {
  const result = { ...previous };
  for (const [key, value] of Object.entries(update)) {
    if (Array.isArray(value) && value.every((item) => item && typeof item === 'object' && item.id != null)) {
      const old = Array.isArray(previous[key]) ? previous[key] : [];
      result[key] = old.map((item: any) => ({ ...item }));
      for (const item of value) {
        const index = result[key].findIndex((oldItem: any) => String(oldItem.id) === String(item.id));
        if (index < 0) result[key].push(item);
        else result[key][index] = mergeBambuReport(result[key][index], item);
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeBambuReport(previous[key] ?? {}, value);
    } else result[key] = value;
  }
  return result;
}

export function deriveBambuState(print: Record<string, any>): PrinterState {
  const state = STATES[print.gcode_state] ?? 'ready';
  const heaters: Heater[] = [];
  if (print.nozzle_temper != null) heaters.push({ id: 'nozzle', kind: 'extruder', label: 'Nozzle', current: print.nozzle_temper, target: print.nozzle_target_temper ?? 0 });
  if (print.bed_temper != null) heaters.push({ id: 'bed', kind: 'bed', label: 'Bed', current: print.bed_temper, target: print.bed_target_temper ?? 0 });
  if (print.chamber_temper != null) heaters.push({ id: 'chamber', kind: 'chamber', label: 'Chamber', current: print.chamber_temper, target: 0 });
  const fans = ([['cooling_fan_speed', 'Part cooling'], ['big_fan1_speed', 'Auxiliary'], ['big_fan2_speed', 'Chamber'], ['heatbreak_fan_speed', 'Hotend']] as const)
    .filter(([key]) => print[key] != null)
    .map(([key, label]) => ({ id: key, label, speed: fan(print[key]) }));
  const active = state === 'printing' || state === 'paused' || state === 'complete';
  return {
    state,
    message: print.print_error ? `Printer error ${print.print_error}` : undefined,
    heaters, fans,
    progress: active && print.mc_percent != null ? print.mc_percent / 100 : undefined,
    file: active ? print.subtask_name || print.gcode_file || undefined : undefined,
    remaining: active && print.mc_remaining_time != null ? print.mc_remaining_time * 60 : undefined,
    layer: active && print.layer_num != null ? { current: print.layer_num, total: print.total_layer_num || undefined } : undefined,
    speedFactor: SPEED_PERCENT[print.spd_lvl] || undefined,
    software: 'Bambu Lab',
    filaments: deriveBambuFilaments(print)
  };
}

/**
 * Bambu Lab in LAN mode. The browser talks to the gateway's MQTT bridge over a websocket; the first frame
 * carries the serial number and access code (see printerGateway.ts).
 */
export class BambuApi implements PrinterApi {
  constructor(private printer: PhysicalPrinter) {}

  private open(onMessage: (message: any) => void, onClose: (reason?: string) => void): { socket: WebSocket; send: (payload: object) => void } {
    if (!this.printer.use_gateway) throw new Error('Bambu Lab printers need the app server gateway: they speak MQTT and FTPS, which browsers cannot.');
    const socket = new WebSocket(bambuMqttUrl(this.printer));
    socket.onopen = () => socket.send(JSON.stringify({ type: 'connect', serial: this.printer.serial, accessCode: this.printer.printhost_apikey }));
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        /* ignore */
      }
    };
    socket.onclose = () => onClose();
    return { socket, send: (payload) => socket.send(JSON.stringify({ type: 'publish', payload })) };
  }

  test(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => done(new Error('The printer did not answer. Check the IP address, access code and that LAN mode is on.')), CONNECT_TIMEOUT_MS);
      let connected = false;
      const bridge = this.open((m) => {
        if (m.type === 'connected') connected = true;
        else if (m.type === 'error') done(new Error(m.message));
        else if (m.type === 'report' && connected) done(undefined, m.payload);
      }, () => done(new Error('Connection closed')));
      function done(error?: Error, report?: any) {
        clearTimeout(timeout);
        bridge.socket.onclose = null;
        bridge.socket.close();
        if (error) reject(error);
        else resolve(`Bambu Lab ${report?.info?.module?.[0]?.project_name ?? report?.print?.machine_name ?? 'printer'} connected`);
      }
    });
  }

  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void): () => void {
    let stopped = false;
    let socket: WebSocket | undefined;
    let print: Record<string, any> = {};
    try {
      socket = this.open(
        (m) => {
          if (m.type === 'report' && m.payload?.print) {
            print = mergeBambuReport(print, m.payload.print);
            onState(deriveBambuState(print));
          } else if (m.type === 'error' || m.orca_gateway_error) {
            onError(new Error(m.message ?? m.orca_gateway_error));
          }
        },
        () => !stopped && onError(new Error('Connection to the printer was lost.'))
      ).socket;
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
    return () => {
      stopped = true;
      socket?.close();
    };
  }

  /** Sends one command over a short-lived bridge connection. */
  private command(payload: object): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('The printer did not accept the command in time.')), CONNECT_TIMEOUT_MS);
      const bridge = this.open((m) => {
        if (m.type === 'connected') {
          bridge.send(payload);
          setTimeout(() => finish(), 500); // let the broker take it before closing
        } else if (m.type === 'error') finish(new Error(m.message));
      }, () => finish(new Error('Connection closed')));
      function finish(error?: Error) {
        clearTimeout(timeout);
        bridge.socket.onclose = null;
        bridge.socket.close();
        error ? reject(error) : resolve();
      }
    });
  }

  async upload({ filename, gcode, print, onProgress }: UploadOptions): Promise<void> {
    await sendWithProgress(
      'POST',
      bambuFtpUrl(this.printer),
      { 'x-bambu-filename': encodeURIComponent(filename), 'x-bambu-access-code': this.printer.printhost_apikey ?? '', 'content-type': 'application/octet-stream' },
      new Blob([gcode as BlobPart]),
      onProgress
    );
    // Plain G-code is started from the SD card; .gcode.3mf projects use the project_file command instead.
    if (print) await this.command({ print: { sequence_id: '0', command: 'gcode_file', param: `/sdcard/${filename}` } });
  }
}
