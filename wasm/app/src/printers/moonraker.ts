import { authHeaders, describeFetchFailure, httpUrl, parseHost, sendWithProgress, wsUrl } from './gatewayUrl';
import type { Fan, Heater, PhysicalPrinter, PrinterApi, PrinterFile, PrinterRunState, PrinterState, UploadOptions, Webcam } from './types';

type Status = Record<string, Record<string, any>>;

const RPC_TIMEOUT_MS = 10_000;
const RECONNECT_MS = [1000, 3000, 8000, 15000];

/** Objects worth subscribing to: everything that feeds the dashboard. */
const SUBSCRIBED = /^(webhooks|print_stats|virtual_sdcard|display_status|toolhead|gcode_move|idle_timeout|toolchanger|fan|heater_bed|extruder\d*|heater_generic .+|temperature_sensor .*chamber.*|temperature_fan .+|fan_generic .+|heater_fan .+|controller_fan .+)$/i;

const isChamberName = (name: string) => /chamber/i.test(name);
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function mergeStatus(into: Status, update: Status) {
  for (const [object, fields] of Object.entries(update)) into[object] = { ...into[object], ...fields };
}

function mapState(status: Status): { state: PrinterRunState; message?: string } {
  const webhooks = status.webhooks ?? {};
  if (webhooks.state === 'startup') return { state: 'offline', message: webhooks.state_message || 'Klipper is starting' };
  if (webhooks.state && webhooks.state !== 'ready') return { state: 'error', message: webhooks.state_message || `Klipper: ${webhooks.state}` };
  const printStats = status.print_stats ?? {};
  const message = printStats.message || status.display_status?.message || undefined;
  switch (printStats.state) {
    case 'printing': return { state: 'printing', message };
    case 'paused': return { state: 'paused', message };
    case 'complete': return { state: 'complete', message };
    case 'error': return { state: 'error', message: message || 'The print failed' };
    default: return { state: 'ready', message };
  }
}

/** Builds the dashboard state from the merged Klipper object model. */
export function deriveMoonrakerState(status: Status, extra: { webcams?: Webcam[]; files?: PrinterFile[]; software?: string }): PrinterState {
  const { state, message } = mapState(status);
  const printStats = status.print_stats ?? {};
  const active = state === 'printing' || state === 'paused' || state === 'complete';

  const extruders = Object.keys(status).filter((n) => /^extruder\d*$/.test(n)).sort((a, b) => (parseInt(a.slice(8)) || 0) - (parseInt(b.slice(8)) || 0));
  const heaters: Heater[] = extruders.map((name, i) => ({
    id: name, kind: 'extruder', label: extruders.length > 1 ? `Extruder ${i}` : 'Nozzle',
    current: status[name].temperature ?? 0, target: status[name].target ?? 0
  }));
  if (status.heater_bed) heaters.push({ id: 'heater_bed', kind: 'bed', label: 'Bed', current: status.heater_bed.temperature ?? 0, target: status.heater_bed.target ?? 0 });
  for (const [name, fields] of Object.entries(status)) {
    if (name.startsWith('heater_generic ')) {
      const label = titleCase(name.slice(15));
      heaters.push({ id: name, kind: isChamberName(name) ? 'chamber' : 'other', label, current: fields.temperature ?? 0, target: fields.target ?? 0 });
    } else if (name.startsWith('temperature_sensor ') && isChamberName(name)) {
      heaters.push({ id: name, kind: 'chamber', label: titleCase(name.slice(19)), current: fields.temperature ?? 0, target: 0 });
    }
  }

  const fans: Fan[] = [];
  for (const [name, fields] of Object.entries(status)) {
    if (typeof fields.speed !== 'number' || !/^(fan|fan_generic .+|heater_fan .+|controller_fan .+|temperature_fan .+)$/.test(name)) continue;
    fans.push({ id: name, speed: fields.speed, label: name === 'fan' ? 'Part cooling' : titleCase(name.replace(/^\w+ /, '')) });
  }

  const displayProgress = status.display_status?.progress ?? 0;
  const progress = active ? (displayProgress > 0 ? displayProgress : status.virtual_sdcard?.progress) : undefined;
  const elapsed = active ? printStats.print_duration : undefined;
  const info = printStats.info;
  const position = status.toolhead?.position;

  return {
    state,
    message,
    heaters,
    fans,
    progress,
    file: active ? printStats.filename || undefined : undefined,
    elapsed,
    remaining: state === 'printing' && progress && progress > 0.01 && elapsed ? elapsed / progress - elapsed : undefined,
    layer: info?.current_layer != null ? { current: info.current_layer, total: info.total_layer ?? undefined } : undefined,
    speedFactor: status.gcode_move?.speed_factor != null ? Math.round(status.gcode_move.speed_factor * 100) : undefined,
    flowFactor: status.gcode_move?.extrude_factor != null ? Math.round(status.gcode_move.extrude_factor * 100) : undefined,
    position: position ? { x: position[0], y: position[1], z: position[2] } : undefined,
    activeTool: status.toolchanger?.tool_number != null && status.toolchanger.tool_number >= 0
      ? `T${status.toolchanger.tool_number}` : status.toolhead?.extruder && extruders.length > 1 ? status.toolhead.extruder : undefined,
    software: extra.software,
    webcams: extra.webcams,
    files: extra.files
  };
}

/** Moonraker publishes camera URLs relative to the web server; route them through the same path as the API. */
function camUrl(printer: PhysicalPrinter, url: string): string {
  try {
    const { hostPort } = parseHost(printer.print_host);
    const absolute = new URL(url, `http://${hostPort}/`);
    return absolute.host === hostPort ? httpUrl(printer, absolute.pathname + absolute.search) : httpUrl({ ...printer, print_host: absolute.origin }, absolute.pathname + absolute.search);
  } catch {
    return url;
  }
}

export class MoonrakerApi implements PrinterApi {
  constructor(private printer: PhysicalPrinter) {}

  async test(): Promise<string> {
    const headers = authHeaders(this.printer);
    let info: any;
    let printerInfo: any;
    try {
      const res = await fetch(httpUrl(this.printer, '/server/info'), { headers });
      if (!res.ok) throw new Error(await describeFetchFailure(this.printer, res));
      info = (await res.json()).result;
      const pi = await fetch(httpUrl(this.printer, '/printer/info'), { headers });
      if (pi.ok) printerInfo = (await pi.json()).result;
    } catch (error) {
      throw new Error(error instanceof Error && error.message !== 'Failed to fetch' ? error.message : await describeFetchFailure(this.printer, undefined, error));
    }
    const host = printerInfo?.hostname ? ` on ${printerInfo.hostname}` : '';
    return `Moonraker ${info.moonraker_version ?? ''}${host}, Klipper ${info.klippy_state}`.replace(/\s+/g, ' ');
  }

  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void): () => void {
    let stopped = false;
    let ws: WebSocket | undefined;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      const status: Status = {};
      const extra: { webcams?: Webcam[]; files?: PrinterFile[]; software?: string } = {};
      const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
      let nextId = 1;
      const socket = (ws = new WebSocket(wsUrl(this.printer, '/websocket')));

      const call = (method: string, params?: object) =>
        new Promise<any>((resolve, reject) => {
          const id = nextId++;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`${method} timed out`));
          }, RPC_TIMEOUT_MS);
          pending.set(id, { resolve, reject, timer });
          socket.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
        });
      const publish = () => onState(deriveMoonrakerState(status, extra));

      socket.onopen = async () => {
        attempt = 0;
        try {
          await call('server.connection.identify', { client_name: 'OrcaSlicerWeb', version: '0.1.0', type: 'web', url: window.location.origin });
          const list = await call('printer.objects.list');
          const objects: Record<string, null> = {};
          for (const name of list.objects as string[]) if (SUBSCRIBED.test(name)) objects[name] = null;
          const subscribed = await call('printer.objects.subscribe', { objects });
          mergeStatus(status, subscribed.status);
          publish();

          const [webcams, files, info] = await Promise.allSettled([
            call('server.webcams.list'),
            call('server.files.list', { root: 'gcodes' }),
            call('printer.info')
          ]);
          if (webcams.status === 'fulfilled') {
            // An <img> can show MJPEG streams and snapshots; iframe and WebRTC cameras are left to the web UI pane.
            extra.webcams = (webcams.value.webcams as any[]).flatMap((w): Webcam[] => {
              const stream = /^mjpegstreamer/.test(w.service ?? '');
              const url = stream ? w.stream_url : w.service === 'iframe' ? undefined : w.snapshot_url;
              return w.enabled && url ? [{ name: w.name, url: camUrl(this.printer, url), snapshot: !stream }] : [];
            });
          }
          if (files.status === 'fulfilled') {
            extra.files = (files.value as any[]).sort((a, b) => b.modified - a.modified).slice(0, 10)
              .map((f) => ({ name: f.path, size: f.size, modified: f.modified * 1000 }));
          }
          if (info.status === 'fulfilled') extra.software = `Klipper ${info.value.software_version ?? ''}`.trim();
          publish();
        } catch (error) {
          onError(error instanceof Error ? error : new Error(String(error)));
        }
      };

      socket.onmessage = (event) => {
        let message: any;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.orca_gateway_error) return onError(new Error(message.orca_gateway_error));
        if (message.id != null && pending.has(message.id)) {
          const { resolve, reject, timer } = pending.get(message.id)!;
          clearTimeout(timer);
          pending.delete(message.id);
          message.error ? reject(new Error(message.error.message ?? 'Request failed')) : resolve(message.result);
        } else if (message.method === 'notify_status_update' && message.params?.[0]) {
          mergeStatus(status, message.params[0]);
          publish();
        } else if (message.method === 'notify_klippy_disconnected' || message.method === 'notify_klippy_shutdown') {
          onError(new Error('Klipper disconnected'));
        }
      };

      socket.onclose = () => {
        for (const { reject, timer } of pending.values()) {
          clearTimeout(timer);
          reject(new Error('Connection closed'));
        }
        if (stopped) return;
        onError(new Error('Connection to the printer was lost. Reconnecting...'));
        timer = setTimeout(open, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)]);
      };
    };

    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }

  async upload({ filename, gcode, print, onProgress }: UploadOptions): Promise<void> {
    const form = new FormData();
    form.append('root', 'gcodes');
    if (print) form.append('print', 'true');
    form.append('file', new Blob([gcode as BlobPart]), filename);
    await sendWithProgress('POST', httpUrl(this.printer, '/server/files/upload'), authHeaders(this.printer), form, onProgress);
  }
}
