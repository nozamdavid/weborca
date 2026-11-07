/**
 * MIT License
 * Portions ported from prusactl by trevin-lee (https://github.com/trevin-lee/prusactl)
 *
 * Prusa Connect cloud client integration for OrcaSlicer.
 *
 * Implements:
 *   - PKCE OAuth login with server-side password/OTP and manual callback fallback.
 *   - Bearer token authentication & automatic token refresh.
 *   - Live printer state polling (temperatures, job progress, filename, speeds).
 *   - Camera snapshot stream integration.
 *   - Real Prusa Connect file upload flow (team uploads -> raw PUT -> queue/start).
 *   - Job controls: Pause, Resume, Stop (Cancel print).
 *   - Backward-compatible legacy fallback for API-key mode.
 */
import { authHeaders, describeFetchFailure, httpUrl, sendWithProgress } from './gatewayUrl';
import { usePrinterConnectionStore } from './connectionStore';
import type {
  ConnectOptions,
  Heater,
  PhysicalPrinter,
  PrinterApi,
  PrinterFilamentSlot,
  PrinterRunState,
  PrinterState,
  UploadOptions,
  Webcam
} from './types';

export interface PrusaGatewayTarget {
  print_host?: string;
  cloud_region?: PhysicalPrinter['cloud_region'];
  cloud_account?: string;
}

/** Browser account session, independent of selecting or saving any printer. */
function retainPrusaConnectLogin(target: PrusaGatewayTarget | undefined, tokens: PrusaConnectTokens): void {
  usePrinterConnectionStore.getState().savePrusaSession({ host_type: 'prusaconnect',
    print_host: target?.print_host ?? 'connect.prusa3d.com',
    cloud_region: target?.cloud_region, cloud_account: target?.cloud_account,
    printhost_apikey: tokens.access_token, cloud_refresh_token: tokens.refresh_token });
}

export interface PrusaConnectTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expiry?: number;
}

export interface PrusaConnectUser {
  public_name?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  default_team_id: number;
  teams: Array<{ id: number; name: string }>;
}

export interface PrusaConnectPrinter {
  uuid: string;
  name: string;
  sn?: string;
  printer_type_name?: string;
  printer_model?: string;
  connect_state?: string;
  printer_state?: string;
  team_id?: number;
  is_online?: boolean;
}

const POLL_INTERVAL_ACTIVE_MS = 2500;
const POLL_INTERVAL_IDLE_MS = 10_000;
const MATERIALS_BUDGET_MS = 1500;

function gatewayPrefix(_target?: PrusaGatewayTarget): string {
  return '/_printer/prusa-connect';
}

/**
 * Initiates PKCE login by requesting authorizeUrl from the gateway.
 */
export async function startPrusaConnectLogin(target?: PrusaGatewayTarget): Promise<{
  authorizeUrl: string;
  state: string;
  verifier: string;
}> {
  const url = `${gatewayPrefix(target)}/auth/start`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to start Prusa Connect login (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

/**
 * Completes login by sending the pasted callback URL or code to the gateway for token exchange.
 */
export async function completePrusaConnectLogin(
  target: PrusaGatewayTarget | undefined,
  params: { pasted: string; state?: string; verifier?: string }
): Promise<PrusaConnectTokens> {
  const url = `${gatewayPrefix(target)}/auth/complete`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    let errMessage = `Error ${res.status}`;
    try {
      const errJson = await res.json();
      errMessage = errJson.error || errJson.message || errMessage;
    } catch {
      const text = await res.text().catch(() => '');
      if (text) errMessage = text;
    }
    throw new Error(errMessage);
  }
  const tokens = await res.json();
  retainPrusaConnectLogin(target, tokens);
  return tokens;
}

/** Credentials are sent only to the configured gateway, which submits to Account. */
export async function submitPrusaConnectLogin(
  target: PrusaGatewayTarget | undefined,
  state: string,
  input: { email: string; password: string } | { code: string }
): Promise<PrusaConnectTokens | { mfaRequired: true }> {
  const route = 'password' in input ? 'password' : 'otp';
  const res = await fetch(`${gatewayPrefix(target)}/auth/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, ...input })
  });
  if (!res.ok) throw new Error('Prusa Account sign-in failed. Check your password or code and start again. Social login, passkeys and CAPTCHA are unsupported.');
  const result = await res.json();
  if (!('mfaRequired' in result)) retainPrusaConnectLogin(target, result);
  return result;
}

export async function cancelPrusaConnectLogin(target: PrusaGatewayTarget | undefined, state: string): Promise<void> {
  if (!state) return;
  await fetch(`${gatewayPrefix(target)}/auth/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state })
  }).catch(() => {});
}

/**
 * Manually refreshes rotating tokens.
 */
export async function refreshPrusaConnectToken(
  target: PrusaGatewayTarget | undefined,
  refreshToken: string
): Promise<PrusaConnectTokens> {
  const url = `${gatewayPrefix(target)}/auth/refresh`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!res.ok) {
    throw new Error(`Failed to refresh token (${res.status})`);
  }
  return res.json();
}

/**
 * Fetches user profile and teams list.
 */
export async function fetchPrusaConnectUser(
  target: PrusaGatewayTarget | undefined,
  accessToken: string,
  refreshToken?: string
): Promise<PrusaConnectUser> {
  const url = `${gatewayPrefix(target)}/app/login`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`
  };
  if (refreshToken) headers['x-prusa-refresh-token'] = refreshToken;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch Prusa user (${res.status})`);
  }
  const data = await res.json();
  const u = data.user || {};
  const firstName = u.first_name || '';
  const lastName = u.last_name || '';
  const name = `${firstName} ${lastName}`.trim() || u.public_name || 'Prusa User';
  return {
    public_name: u.public_name,
    first_name: u.first_name,
    last_name: u.last_name,
    name,
    default_team_id: u.default_team_id || 0,
    teams: u.teams || []
  };
}

/**
 * Fetches list of printers associated with the user account.
 */
export async function fetchPrusaConnectPrinters(
  target: PrusaGatewayTarget | undefined,
  accessToken: string,
  refreshToken?: string
): Promise<PrusaConnectPrinter[]> {
  const url = `${gatewayPrefix(target)}/app/printers`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`
  };
  if (refreshToken) headers['x-prusa-refresh-token'] = refreshToken;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch Prusa printers (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data.printers) ? data.printers : [];
}

const PRUSA_CONNECT_STATE_MAP: Record<string, PrinterRunState> = {
  PRINTING: 'printing',
  PAUSED: 'paused',
  FINISHED: 'complete',
  STOPPED: 'ready',
  READY: 'ready',
  IDLE: 'ready',
  BUSY: 'printing',
  ATTENTION: 'error',
  ERROR: 'error',
  OFFLINE: 'offline',
  UNKNOWN: 'offline'
};

/** REST-reported material only; warehouse assignments/colors use a separate contract. */
function reportedFilamentSlots(tools: unknown): PrinterFilamentSlot[] | undefined {
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return undefined;
  const entries = Object.entries(tools).filter(([key, value]) =>
    /^[1-9]\d*(\.(0|[1-9]\d*))?$/.test(key) && key.split('.').every(part => Number.isSafeInteger(Number(part))) &&
    value !== null && typeof value === 'object' && !Array.isArray(value));
  if (Object.keys(tools).length && !entries.length) return undefined;
  // An enabled MMU's print head duplicates the material of its active feeder slot.
  const feeders = new Set(entries.filter(([key]) => key.includes('.')).map(([key]) => key.split('.')[0]));
  return entries.filter(([key]) => !feeders.has(key)).map(([key, tool]) => {
    const [head, feeder] = key.split('.').map(Number);
    const raw = (tool as Record<string, unknown>).material;
    const material = typeof raw === 'string' ? raw.trim() : '';
    return {
      id: `prusa-tool-${key}`,
      label: feeder === undefined ? `Tool ${head}` : `MMU slot ${key}`,
      // REST feeder suffix conversion is unverified; preserve its raw identity.
      ...(feeder === undefined ? { slotIndex: head - 1 } : {}),
      material: material === '---' ? '' : material,
      // '---' explicitly means no material recorded, not a physical sensor reading.
      presence: material === '---' ? 'empty' : material ? 'present' : 'unknown'
    };
  });
}

/** Validated gateway DTO; rich tool IDs never share REST identity. */
function assignedFilamentSlots(value: any): PrinterFilamentSlot[] | undefined {
  if (!value || !Array.isArray(value.tools) || value.tools.length > 256) return undefined;
  const ids = new Set<string>();
  for (const tool of value.tools) {
    if (!tool || typeof tool.id !== 'string' || !/^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$/.test(tool.id) ||
        tool.id.split('.').some((id: string) => !Number.isSafeInteger(Number(id)) || Number(id) >= Number.MAX_SAFE_INTEGER) || ids.has(tool.id) ||
        typeof tool.type !== 'string' || !/^[A-Z_]{1,64}$/.test(tool.type) ||
        (tool.type === 'FEEDER') !== tool.id.includes('.') ||
        !['present', 'empty', 'unknown'].includes(tool.presence) || typeof tool.material !== 'string' ||
        ['material', 'vendor', 'subtype', 'color'].some(key => tool[key] !== undefined &&
          (typeof tool[key] !== 'string' || tool[key].length > 256 || /[\x00-\x1f\x7f]/.test(tool[key]))) ||
        (tool.color !== undefined && !/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(tool.color)) ||
        (tool.presence !== 'present' && (tool.material || tool.vendor || tool.subtype || tool.color))) return undefined;
    ids.add(tool.id);
  }
  const feeders = new Set<string>(value.tools.filter((tool: any) => tool.type === 'FEEDER')
    .map((tool: any) => tool.id.split('.')[0]));
  return value.tools.filter((tool: any) => !feeders.has(tool.id)).map((tool: any) => ({
    id: `prusa-gql-tool-${tool.id}`,
    label: tool.type === 'FEEDER' ? `MMU slot ${tool.id}` : `Tool ${Number(tool.id) + 1}`,
    ...(tool.type === 'FEEDER' ? {} : { slotIndex: Number(tool.id) }),
    material: tool.material, presence: tool.presence,
    ...(tool.vendor === undefined ? {} : { vendor: tool.vendor }),
    ...(tool.subtype === undefined ? {} : { subtype: tool.subtype }),
    ...(tool.color === undefined ? {} : { color: tool.color })
  }));
}

export class PrusaConnectApi implements PrinterApi {
  private currentJobId?: number;

  constructor(private printer: PhysicalPrinter) {}

  private get gatewayBase(): string {
    return '';
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.printer.printhost_apikey) {
      headers['Authorization'] = `Bearer ${this.printer.printhost_apikey}`;
    }
    if (this.printer.cloud_refresh_token) {
      headers['x-prusa-refresh-token'] = this.printer.cloud_refresh_token;
    }
    return headers;
  }

  private handleUpdatedTokens(res: Response) {
    const newAccess = res.headers.get('x-prusa-access-token');
    const newRefresh = res.headers.get('x-prusa-refresh-token');
    if (newAccess) {
      const source = { ...this.printer };
      this.printer = { ...this.printer, printhost_apikey: newAccess,
        cloud_refresh_token: newRefresh || this.printer.cloud_refresh_token };
      try {
        usePrinterConnectionStore.getState().updateCloudTokens(source, newAccess, newRefresh || undefined);
      } catch {
        // ignore update failure in headless contexts
      }
    }
  }

  private async fetchJson<T>(subpath: string, options: { method?: string; body?: any; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
    const url = `${this.gatewayBase}${subpath.startsWith('/') ? subpath : '/' + subpath}`;
    const reqHeaders: Record<string, string> = {
      ...this.authHeaders(),
      ...(options.headers || {})
    };
    if (options.body !== undefined && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: options.method || 'GET',
        headers: reqHeaders,
        signal: options.signal,
        body: options.body !== undefined ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
      });
    } catch (e: any) {
      throw new Error(`Prusa Connect network request failed: ${e.message}`);
    }

    options.signal?.throwIfAborted();
    this.handleUpdatedTokens(res);

    if (!res.ok) {
      let errText = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errText = errJson.error || errJson.message || errText;
      } catch {
        const t = await res.text().catch(() => '');
        if (t) errText = t;
      }
      throw new Error(`Prusa Connect error (${res.status}): ${errText}`);
    }

    if (res.status === 204) return undefined as any;
    const result = await res.json();
    options.signal?.throwIfAborted();
    return result;
  }

  // ---------------------------------------------------------------------------
  // PrinterApi: test()
  // ---------------------------------------------------------------------------
  async test(): Promise<string> {
    // If no cloud_device_id, fallback to legacy API key check
    if (!this.printer.cloud_device_id) {
      return this.legacyTest();
    }

    const uuid = this.printer.cloud_device_id;
    const printer = await this.fetchJson<any>(`/_printer/prusa-connect/app/printers/${uuid}`);
    const name = printer.name || 'Prusa Printer';
    const model = printer.printer_type_name || printer.printer_model || 'MK4/XL/MINI';
    const state = printer.connect_state || printer.printer_state || 'READY';
    return `Connection to Prusa Connect is working: ${name} (${model}), state: ${state}.`;
  }

  // ---------------------------------------------------------------------------
  // PrinterApi: connect()
  // ---------------------------------------------------------------------------
  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void, options?: ConnectOptions): () => void {
    if (!this.printer.cloud_device_id) {
      return this.legacyConnect(onState, onError, options);
    }

    const uuid = this.printer.cloud_device_id;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingMaterials: AbortController | undefined;
    const monitor = new AbortController();

    const pollState = async () => {
      try {
        const signal = AbortSignal.any([monitor.signal, AbortSignal.timeout(15_000)]);
        const controller = new AbortController();
        pendingMaterials = controller;
        let budgetTimer: ReturnType<typeof setTimeout>;
        const budget = new Promise<null>(resolve => {
          controller.signal.addEventListener('abort', () => resolve(null), { once: true });
          budgetTimer = setTimeout(() => controller.abort(), MATERIALS_BUDGET_MS);
        });
        const materials = Promise.race([
          this.fetchJson<any>(`/_printer/prusa-connect/app/printers/${uuid}/materials`, { signal: AbortSignal.any([signal, controller.signal]) }).catch(() => null),
          budget
        ]).finally(() => {
          clearTimeout(budgetTimer);
          if (pendingMaterials === controller) pendingMaterials = undefined;
        });
        const [printer, camerasRes, materialsRes] = await Promise.all([
          this.fetchJson<any>(`/_printer/prusa-connect/app/printers/${uuid}`, { signal }),
          this.fetchJson<any>(`/_printer/prusa-connect/app/printers/${uuid}/cameras`, { signal }).catch(() => null),
          materials
        ]);

        if (stopped) return;

        const rawState = String(printer.connect_state || printer.printer_state || 'IDLE').toUpperCase();
        const runState: PrinterRunState = PRUSA_CONNECT_STATE_MAP[rawState] || 'ready';

        const heaters: Heater[] = [];
        if (printer.temp?.temp_nozzle != null) {
          heaters.push({
            id: 'nozzle',
            kind: 'extruder',
            label: 'Nozzle',
            current: Number(printer.temp.temp_nozzle),
            target: Number(printer.temp.target_nozzle ?? 0)
          });
        }
        if (printer.temp?.temp_bed != null) {
          heaters.push({
            id: 'bed',
            kind: 'bed',
            label: 'Bed',
            current: Number(printer.temp.temp_bed),
            target: Number(printer.temp.target_bed ?? 0)
          });
        }
        if (printer.chamber?.temp != null) {
          heaters.push({
            id: 'chamber',
            kind: 'chamber',
            label: 'Chamber',
            current: Number(printer.chamber.temp),
            target: Number(printer.chamber.target_temp ?? 0)
          });
        }

        let file: string | undefined;
        let progress: number | undefined;
        let elapsed: number | undefined;
        let remaining: number | undefined;

        if (printer.job_info) {
          const job = printer.job_info;
          if (job.progress != null && Number.isFinite(job.progress)) {
            progress = job.progress / 100;
          }
          file = job.display_name || (job.path ? String(job.path).replace(/^\//, '') : undefined);
          if (job.time_printing != null && Number.isFinite(job.time_printing)) {
            elapsed = Number(job.time_printing);
          }
          if (job.time_remaining != null && Number.isFinite(job.time_remaining)) {
            remaining = Number(job.time_remaining);
          }
        }

        let message: string | undefined;
        if (rawState === 'ATTENTION') {
          message = 'The printer needs attention';
        }
        if (printer.dialog_info?.text) {
          message = printer.dialog_info.text;
        }

        const webcams: Webcam[] = [];
        if (Array.isArray(camerasRes?.cameras) && camerasRes.cameras.length > 0) {
          for (const c of camerasRes.cameras) {
            const camId = c.id;
            const camName = c.name || 'Camera';
            const token = encodeURIComponent(this.printer.printhost_apikey || '');
            const snapUrl = `${this.gatewayBase}/_printer/prusa-connect/camera/snapshot?uuid=${encodeURIComponent(uuid)}&cam_id=${encodeURIComponent(camId)}&token=${token}`;
            webcams.push({
              name: camName,
              url: snapUrl,
              snapshot: true
            });
          }
        }

        onState({
          state: runState,
          message,
          heaters,
          fans: [],
          progress,
          file,
          elapsed,
          remaining,
          speedFactor: typeof printer.speed === 'number' ? printer.speed : undefined,
          flowFactor: typeof printer.flow === 'number' ? printer.flow : undefined,
          software: 'Prusa Connect',
          filamentSlots: assignedFilamentSlots(materialsRes) ?? reportedFilamentSlots(printer.tools),
          webcams: webcams.length > 0 ? webcams : undefined
        });
      } catch (err) {
        if (!stopped) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }

      if (!stopped) {
        const interval = options?.pollIntervalMs ?? (options?.isActive?.() === false ? POLL_INTERVAL_IDLE_MS : POLL_INTERVAL_ACTIVE_MS);
        timer = setTimeout(pollState, interval);
      }
    };

    pollState();

    return () => {
      stopped = true;
      pendingMaterials?.abort();
      monitor.abort();
      if (timer) clearTimeout(timer);
    };
  }

  // ---------------------------------------------------------------------------
  // PrinterApi: upload()
  // ---------------------------------------------------------------------------
  async upload({ filename, gcode, print, onProgress }: UploadOptions): Promise<void> {
    if (!this.printer.cloud_device_id) {
      return this.legacyUpload({ filename, gcode, print, onProgress });
    }

    const uuid = this.printer.cloud_device_id;
    const teamId = this.printer.cloud_team_id || '0';

    // 1. Resolve writable storage destination
    let destination = '/usb/';
    try {
      const storagesRes = await this.fetchJson<any>(`/_printer/prusa-connect/app/printers/${uuid}/storages`);
      if (Array.isArray(storagesRes?.storages)) {
        const usb = storagesRes.storages.find(
          (s: any) => !s.read_only && !s.corrupted && String(s.type).toUpperCase() === 'USB'
        );
        const anyValid = storagesRes.storages.find((s: any) => !s.read_only && !s.corrupted);
        const chosen = usb || anyValid;
        if (chosen) {
          const p = chosen.path || chosen.mountpoint || '/usb/';
          destination = p.replace(/\/+$/, '') + '/';
        }
      }
    } catch {
      // Default to /usb/
    }

    // 2. Register the upload
    const uploadReg = await this.fetchJson<any>(`/_printer/prusa-connect/app/users/teams/${teamId}/uploads`, {
      method: 'POST',
      body: {
        destination,
        filename,
        size: gcode.byteLength,
        printer_uuid: uuid
      }
    });

    const uploadId = uploadReg?.id;
    if (!uploadId) {
      throw new Error('Prusa Connect did not return an upload ID');
    }

    // 3. PUT raw file bytes
    const rawUrl = `${this.gatewayBase}/_printer/prusa-connect/app/teams/${teamId}/files/raw?upload_id=${encodeURIComponent(uploadId)}`;
    try {
      const rawResText = await sendWithProgress(
        'PUT',
        rawUrl,
        {
          ...this.authHeaders(),
          'Content-Type': 'text/x.gcode',
          'Upload-Size': String(gcode.byteLength)
        },
        new Blob([gcode as BlobPart]),
        onProgress
      );

      let fileData: any = {};
      try {
        fileData = JSON.parse(rawResText);
      } catch {
        // ignore parse error if empty
      }
      const hash = fileData.hash || uploadReg.hash;
      if (!hash) {
        throw new Error('Prusa Connect upload did not return a file hash');
      }

      // 4. Add to print queue (print immediately or append to queue)
      await this.fetchJson(`/_printer/prusa-connect/app/printers/${uuid}/queue`, {
        method: 'POST',
        body: {
          hash,
          team_id: Number(teamId),
          position: print ? 0 : -1,
          ...(print ? { set_ready: true } : {})
        }
      });
    } catch (uploadErr) {
      // Abort upload to free quota
      try {
        await this.fetchJson(`/_printer/prusa-connect/app/uploads/${encodeURIComponent(uploadId)}/abort`, {
          method: 'POST'
        });
      } catch {
        // ignore abort failure
      }
      throw uploadErr;
    }
  }

  // ---------------------------------------------------------------------------
  // Controls: pausePrint, resumePrint, cancelPrint
  // ---------------------------------------------------------------------------
  async pausePrint(): Promise<void> {
    if (!this.printer.cloud_device_id) return this.legacyPausePrint();
    const uuid = this.printer.cloud_device_id;
    await this.fetchJson(`/_printer/prusa-connect/app/printers/${uuid}/commands/sync`, {
      method: 'POST',
      body: { command: 'PAUSE_PRINT', kwargs: {} }
    });
  }

  async resumePrint(): Promise<void> {
    if (!this.printer.cloud_device_id) return this.legacyResumePrint();
    const uuid = this.printer.cloud_device_id;
    await this.fetchJson(`/_printer/prusa-connect/app/printers/${uuid}/commands/sync`, {
      method: 'POST',
      body: { command: 'RESUME_PRINT', kwargs: {} }
    });
  }

  async cancelPrint(): Promise<void> {
    if (!this.printer.cloud_device_id) return this.legacyCancelPrint();
    const uuid = this.printer.cloud_device_id;
    await this.fetchJson(`/_printer/prusa-connect/app/printers/${uuid}/commands/sync`, {
      method: 'POST',
      body: { command: 'STOP_PRINT', kwargs: {} }
    });
  }

  // ---------------------------------------------------------------------------
  // Backward-compatible legacy fallback for API-key mode
  // ---------------------------------------------------------------------------
  private async legacyVersion(signal?: AbortSignal): Promise<{ text: string; putUpload: boolean }> {
    let res: Response;
    try {
      res = await fetch(httpUrl(this.printer, '/api/version'), { headers: authHeaders(this.printer), signal });
    } catch (e: any) {
      if (signal?.aborted) throw e;
      throw new Error(await describeFetchFailure(this.printer, undefined, e));
    }
    if (!res.ok) throw new Error(await describeFetchFailure(this.printer, res));
    const version = await res.json();
    const text = String(version.text ?? '');
    if (!version.api || !/^(PrusaLink|OctoPrint)/.test(text)) {
      throw new Error(`Mismatched type of print host: ${text || 'unknown'}`);
    }
    return { text, putUpload: version.capabilities?.['upload-by-put'] === true };
  }

  private async legacyTest(): Promise<string> {
    const v = await this.legacyVersion();
    return `Connection to Prusa Connect is working (${v.text}).`;
  }

  private legacyConnect(onState: (state: PrinterState) => void, onError: (error: Error) => void, options?: ConnectOptions): () => void {
    let stopped = false;
    const monitor = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        await this.legacyVersion(AbortSignal.any([monitor.signal, AbortSignal.timeout(15_000)]));
        if (!stopped) {
          onState({
            state: 'ready',
            message: 'Prusa Connect does not report live status to slicers. Upload and print from here; follow the print in Prusa Connect.',
            heaters: [],
            fans: [],
            software: 'Prusa Connect'
          });
        }
      } catch (error) {
        if (!stopped) onError(error instanceof Error ? error : new Error(String(error)));
      }
      if (!stopped) timer = setTimeout(check, options?.pollIntervalMs ?? 60_000);
    };
    check();
    return () => {
      stopped = true;
      monitor.abort();
      if (timer) clearTimeout(timer);
    };
  }

  private async legacyUpload({ filename, gcode, print, onProgress }: UploadOptions): Promise<void> {
    const { putUpload } = await this.legacyVersion();
    const headers = authHeaders(this.printer);
    if (putUpload) {
      await sendWithProgress(
        'PUT',
        httpUrl(this.printer, `/api/v1/files/local/${encodeURIComponent(filename)}`),
        {
          ...headers,
          'Content-Type': 'text/x.gcode',
          Overwrite: '?1',
          ...(print ? { 'Print-After-Upload': '?1' } : {})
        },
        new Blob([gcode as BlobPart]),
        onProgress
      );
      return;
    }
    const form = new FormData();
    form.append('path', '');
    if (print) form.append('to_print', 'True');
    form.append('file', new Blob([gcode as BlobPart]), filename);
    await sendWithProgress('POST', httpUrl(this.printer, '/api/files/local'), headers, form, onProgress);
  }

  private async legacyPausePrint(): Promise<void> {
    // Legacy stub
  }

  private async legacyResumePrint(): Promise<void> {
    // Legacy stub
  }

  private async legacyCancelPrint(): Promise<void> {
    // Legacy stub
  }
}
