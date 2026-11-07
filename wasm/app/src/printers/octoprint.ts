import { authHeaders, describeFetchFailure, httpUrl, sendWithProgress } from './gatewayUrl';
import type { ConnectOptions, Heater, PhysicalPrinter, PrinterApi, PrinterRunState, PrinterState, UploadOptions } from './types';

const POLL_MS = 2000;
const IDLE_POLL_MS = 15_000;

/** Polls `read()` until stopped; errors are reported but polling continues, so the dashboard recovers by itself. */
function poll(read: (signal: AbortSignal) => Promise<PrinterState>, onState: (s: PrinterState) => void, onError: (e: Error) => void, options?: ConnectOptions): () => void {
  let stopped = false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const state = await read(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (!stopped) onState(state);
    } catch (error) {
      if (!stopped) onError(error instanceof Error ? error : new Error(String(error)));
    }
    if (!stopped) timer = setTimeout(tick, options?.pollIntervalMs ?? (options?.isActive?.() === false ? IDLE_POLL_MS : POLL_MS));
  };
  tick();
  return () => {
    stopped = true;
    controller.abort();
    clearTimeout(timer);
  };
}

async function sendJson(printer: PhysicalPrinter, method: string, path: string, body?: any, headers = authHeaders(printer)): Promise<any> {
  let res: Response;
  try {
    res = await fetch(httpUrl(printer, path), {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw new Error(await describeFetchFailure(printer, undefined, error));
  }
  if (!res.ok) throw new Error(await describeFetchFailure(printer, res));
  if (res.status === 204) return undefined;
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text;
  }
}

async function getJson(printer: PhysicalPrinter, path: string, headers = authHeaders(printer), signal?: AbortSignal): Promise<any> {
  let res: Response;
  try {
    signal?.throwIfAborted();
    res = await fetch(httpUrl(printer, path), { headers, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(await describeFetchFailure(printer, undefined, error));
  }
  if (!res.ok) throw new Error(await describeFetchFailure(printer, res));
  return res.json();
}

export class OctoPrintApi implements PrinterApi {
  constructor(private printer: PhysicalPrinter) {}

  async test(): Promise<string> {
    const version = await getJson(this.printer, '/api/version');
    return `OctoPrint ${version.server ?? version.text ?? ''}`.trim();
  }

  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void, options?: ConnectOptions): () => void {
    return poll(async signal => {
      const [printer, job] = await Promise.all([
        getJson(this.printer, '/api/printer', undefined, signal).catch((e: Error) => (/409/.test(e.message) ? undefined : Promise.reject(e))),
        getJson(this.printer, '/api/job', undefined, signal)
      ]);
      if (!printer) return { state: 'offline', message: 'OctoPrint is not connected to the printer', heaters: [], fans: [] } as PrinterState;
      const flags = printer.state?.flags ?? {};
      const state: PrinterRunState = flags.error || flags.closedOrError ? 'error' : flags.paused || flags.pausing ? 'paused'
        : flags.printing || flags.cancelling ? 'printing' : job.state === 'Operational' && job.progress?.completion === 100 ? 'complete' : 'ready';
      const heaters: Heater[] = Object.entries(printer.temperature ?? {})
        .filter(([name, t]: [string, any]) => name !== 'history' && typeof t?.actual === 'number')
        .map(([name, t]: [string, any]) => ({
          id: name, current: t.actual, target: t.target ?? 0,
          kind: name === 'bed' ? 'bed' : name === 'chamber' ? 'chamber' : 'extruder',
          label: name === 'bed' ? 'Bed' : name === 'chamber' ? 'Chamber' : /^tool0$/.test(name) ? 'Nozzle' : `Tool ${name.replace('tool', '')}`
        }));
      const active = state !== 'ready';
      return {
        state, message: printer.state?.text, heaters, fans: [],
        progress: active && job.progress?.completion != null ? job.progress.completion / 100 : undefined,
        file: active ? job.job?.file?.name ?? undefined : undefined,
        elapsed: active ? job.progress?.printTime ?? undefined : undefined,
        remaining: active ? job.progress?.printTimeLeft ?? undefined : undefined,
        software: 'OctoPrint'
      };
    }, onState, onError, options);
  }

  async upload({ filename, gcode, print, onProgress }: UploadOptions): Promise<void> {
    const form = new FormData();
    form.append('select', 'true');
    if (print) form.append('print', 'true');
    form.append('file', new Blob([gcode as BlobPart]), filename);
    await sendWithProgress('POST', httpUrl(this.printer, '/api/files/local'), authHeaders(this.printer), form, onProgress);
  }

  async home(axes?: Array<'x' | 'y' | 'z'>): Promise<void> {
    const list = axes && axes.length > 0 ? axes : ['x', 'y', 'z'];
    await sendJson(this.printer, 'POST', '/api/printer/printhead', { command: 'home', axes: list });
  }

  async jog(axis: 'x' | 'y' | 'z', distance: number, speed?: number): Promise<void> {
    const body: Record<string, any> = { command: 'jog', [axis]: distance, absolute: false };
    if (speed != null) body.speed = speed;
    await sendJson(this.printer, 'POST', '/api/printer/printhead', body);
  }

  async extrude(amount: number, speed?: number): Promise<void> {
    const body: Record<string, any> = { command: 'extrude', amount };
    if (speed != null) body.speed = speed;
    await sendJson(this.printer, 'POST', '/api/printer/tool', body);
  }

  async setTemperature(heater: 'extruder' | 'bed' | 'chamber', target: number, tool?: number): Promise<void> {
    const t = Math.round(target);
    if (heater === 'bed') {
      await sendJson(this.printer, 'POST', '/api/printer/bed', { command: 'target', target: t });
    } else if (heater === 'chamber') {
      await sendJson(this.printer, 'POST', '/api/printer/chamber', { command: 'target', target: t });
    } else {
      const toolName = tool != null ? `tool${tool}` : 'tool0';
      await sendJson(this.printer, 'POST', '/api/printer/tool', { command: 'target', targets: { [toolName]: t } });
    }
  }

  async setFanSpeed(speed: number, _fanIndex?: number): Promise<void> {
    const s = Math.round(Math.max(0, Math.min(1, speed)) * 255);
    await sendJson(this.printer, 'POST', '/api/printer/command', { command: `M106 S${s}` });
  }

  async setPrintSpeed(speedPercent: number): Promise<void> {
    const s = Math.round(Math.max(10, Math.min(500, speedPercent)));
    await sendJson(this.printer, 'POST', '/api/printer/printhead', { command: 'feedrate', factor: s });
  }

  async pausePrint(): Promise<void> {
    await sendJson(this.printer, 'POST', '/api/job', { command: 'pause', action: 'pause' });
  }

  async resumePrint(): Promise<void> {
    await sendJson(this.printer, 'POST', '/api/job', { command: 'pause', action: 'resume' });
  }

  async cancelPrint(): Promise<void> {
    await sendJson(this.printer, 'POST', '/api/job', { command: 'cancel' });
  }
}

/** PrusaLink's own API (/api/v1). */
export class PrusaLinkApi implements PrinterApi {
  private currentJobId?: number;
  constructor(private printer: PhysicalPrinter) {}

  async test(): Promise<string> {
    const version = await getJson(this.printer, '/api/version');
    return `PrusaLink ${version.server ?? version.api ?? ''} ${version.text ?? ''}`.replace(/\s+/g, ' ').trim();
  }

  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void, options?: ConnectOptions): () => void {
    return poll(async signal => {
      const status = await getJson(this.printer, '/api/v1/status', undefined, signal);
      if (status.job?.id != null) this.currentJobId = status.job.id;
      const p = status.printer ?? {};
      const states: Record<string, PrinterRunState> = {
        PRINTING: 'printing', BUSY: 'printing', PAUSED: 'paused', ATTENTION: 'error', ERROR: 'error', FINISHED: 'complete'
      };
      const state = states[p.state] ?? 'ready';
      const heaters: Heater[] = [];
      if (p.temp_nozzle != null) heaters.push({ id: 'nozzle', kind: 'extruder', label: 'Nozzle', current: p.temp_nozzle, target: p.target_nozzle ?? 0 });
      if (p.temp_bed != null) heaters.push({ id: 'bed', kind: 'bed', label: 'Bed', current: p.temp_bed, target: p.target_bed ?? 0 });
      let file: string | undefined;
      if (status.job && (state === 'printing' || state === 'paused')) {
        const job = await getJson(this.printer, '/api/v1/job', undefined, signal).catch(() => undefined);
        file = job?.file?.display_name ?? job?.file?.name;
      }
      return {
        state, message: p.state === 'ATTENTION' ? 'The printer needs attention' : undefined, heaters, fans: [],
        progress: status.job?.progress != null ? status.job.progress / 100 : undefined,
        elapsed: status.job?.time_printing, remaining: status.job?.time_remaining, file,
        speedFactor: p.speed, flowFactor: p.flow,
        position: p.axis_z != null ? { x: p.axis_x ?? 0, y: p.axis_y ?? 0, z: p.axis_z } : undefined,
        software: 'PrusaLink'
      };
    }, onState, onError, options);
  }

  async upload({ filename, gcode, print, onProgress }: UploadOptions): Promise<void> {
    const storages = await getJson(this.printer, '/api/v1/storage').catch(() => undefined);
    const storage = (storages?.storage_list as any[] | undefined)?.find((s) => s.available && !s.read_only);
    const name = (storage?.path ?? '/usb/').replace(/\//g, '') || 'usb';
    await sendWithProgress(
      'PUT',
      httpUrl(this.printer, `/api/v1/files/${name}/${encodeURIComponent(filename)}`),
      { ...authHeaders(this.printer), 'Content-Type': 'application/octet-stream', 'Print-After-Upload': print ? '?1' : '?0', Overwrite: '?1' },
      new Blob([gcode as BlobPart]),
      onProgress
    );
  }

  private async getJobId(): Promise<number> {
    if (this.currentJobId != null) return this.currentJobId;
    const status = await getJson(this.printer, '/api/v1/status');
    if (status.job?.id != null) {
      this.currentJobId = status.job.id;
      return status.job.id;
    }
    const job = await getJson(this.printer, '/api/v1/job').catch(() => undefined);
    if (job?.id != null) {
      this.currentJobId = job.id;
      return job.id;
    }
    throw new Error('No active job');
  }

  async pausePrint(): Promise<void> {
    const id = await this.getJobId();
    await sendJson(this.printer, 'PUT', `/api/v1/job/${id}/pause`);
  }

  async resumePrint(): Promise<void> {
    const id = await this.getJobId();
    await sendJson(this.printer, 'PUT', `/api/v1/job/${id}/resume`);
  }

  async cancelPrint(): Promise<void> {
    const id = await this.getJobId();
    await sendJson(this.printer, 'DELETE', `/api/v1/job/${id}`);
  }
}

export const PRUSA_CONNECT_HOST = 'https://connect.prusa3d.com';
export { PrusaConnectApi } from './prusaConnect';
