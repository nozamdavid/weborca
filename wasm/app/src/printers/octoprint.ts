import { authHeaders, describeFetchFailure, httpUrl, sendWithProgress } from './gatewayUrl';
import type { ConnectOptions, Heater, PhysicalPrinter, PrinterApi, PrinterRunState, PrinterState, UploadOptions } from './types';

const POLL_MS = 2000;
const IDLE_POLL_MS = 15_000;

/** Polls `read()` until stopped; errors are reported but polling continues, so the dashboard recovers by itself. */
function poll(read: () => Promise<PrinterState>, onState: (s: PrinterState) => void, onError: (e: Error) => void, options?: ConnectOptions): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const state = await read();
      if (!stopped) onState(state);
    } catch (error) {
      if (!stopped) onError(error instanceof Error ? error : new Error(String(error)));
    }
    if (!stopped) timer = setTimeout(tick, options?.isActive?.() === false ? IDLE_POLL_MS : POLL_MS);
  };
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

async function getJson(printer: PhysicalPrinter, path: string, headers = authHeaders(printer)): Promise<any> {
  let res: Response;
  try {
    res = await fetch(httpUrl(printer, path), { headers });
  } catch (error) {
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
    return poll(async () => {
      const [printer, job] = await Promise.all([
        getJson(this.printer, '/api/printer').catch((e: Error) => (/409/.test(e.message) ? undefined : Promise.reject(e))),
        getJson(this.printer, '/api/job')
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
}

/** PrusaLink's own API (/api/v1). */
export class PrusaLinkApi implements PrinterApi {
  constructor(private printer: PhysicalPrinter) {}

  async test(): Promise<string> {
    const version = await getJson(this.printer, '/api/version');
    return `PrusaLink ${version.server ?? version.api ?? ''} ${version.text ?? ''}`.replace(/\s+/g, ' ').trim();
  }

  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void, options?: ConnectOptions): () => void {
    return poll(async () => {
      const status = await getJson(this.printer, '/api/v1/status');
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
        const job = await getJson(this.printer, '/api/v1/job').catch(() => undefined);
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
}
