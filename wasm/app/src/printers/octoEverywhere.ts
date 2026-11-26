import type { ConnectOptions, PhysicalPrinter, PrinterApi, PrinterState, UploadOptions } from './types';
import { isOctoEverywhereConnection, normalizeOctoEverywhereCameras, normalizeOctoEverywhereStatus, octoEverywhereCapabilities } from './octoEverywhereMapping';
import type { OctoEverywhereCameraList, OctoEverywhereConfig, OctoEverywhereConnection, OctoEverywhereFile, OctoEverywhereFileDetails,
  OctoEverywhereGadget, OctoEverywhereInfo, OctoEverywhereLiveLink, OctoEverywhereLiveOptions,
  OctoEverywherePauseOptions, OctoEverywhereRecovery, OctoEverywhereStartOptions,
  OctoEverywhereStatus, OctoEverywhereWebhook } from './octoEverywhereTypes';
export * from './octoEverywhereTypes';
export * from './octoEverywhereMapping';
export * from './octoEverywherePortal';

const ROOT = '/_octoeverywhere';
const TARGET_HEADER = 'X-OctoEverywhere-Target';
const AUTH_HEADER = 'X-OctoEverywhere-Auth';
const APP_TOKEN_HEADER = 'X-OctoEverywhere-App-Token';
const CONNECTION_ID_HEADER = 'X-OctoEverywhere-Connection-Id';
const MAX_BYTES_HEADER = 'X-OctoEverywhere-Max-Bytes';
const STREAM_SECONDS_HEADER = 'X-OctoEverywhere-Stream-Seconds';
const MAX_STREAM_BUFFER_BYTES = 16 * 1024 * 1024;
const abortError = () => new DOMException('OctoEverywhere operation cancelled.', 'AbortError');
const recoveryFor = (code: number): OctoEverywhereRecovery =>
  [401, 410, 603, 604, 606].includes(code) ? 'reconnect' : code === 605 ? 'supporter' : [610, 754].includes(code) ? 'update-plugin' :
    code === 788 ? 'unsupported' : [607, 608, 609, 787].includes(code) ? 'limit' : [600, 602, 429, 503].includes(code) ? 'wait' : 'check-printer';

export class OctoEverywhereError extends Error {
  readonly recovery: OctoEverywhereRecovery;
  constructor(readonly code: number, readonly httpStatus?: number, readonly upstreamRedirect = false) {
    const recovery = recoveryFor(code);
    const specificMessages: Record<number, string> = {
      601: 'Printer is offline or not connected to OctoEverywhere.',
      785: 'OctoEverywhere plugin is not connected to the printer.',
      789: 'OctoEverywhere plugin needs valid authentication for the printer.'
    };
    const messages: Record<OctoEverywhereRecovery, string> = {
      reconnect: 'Reconnect this printer to OctoEverywhere.', supporter: 'OctoEverywhere Supporter Perks are required.',
      'update-plugin': 'Update the OctoEverywhere plugin.', unsupported: 'This OctoEverywhere operation is unsupported.',
      limit: 'An OctoEverywhere transfer, stream, or client limit was reached.', wait: 'OctoEverywhere is temporarily unavailable. Try again later.',
      'check-printer': `OctoEverywhere could not complete the operation (code ${code}). Check the printer connection.`
    };
    super(upstreamRedirect ? 'OctoEverywhere returned an unexpected redirect. Check the connection and try again.' : specificMessages[code] ?? messages[recovery]);
    this.name = 'OctoEverywhereError'; this.recovery = recovery;
  }
}

function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `Basic ${btoa(binary)}`;
}

/** Never surface upstream errors, which may echo URLs, request bodies or credentials. */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(`${ROOT}${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const upstreamRedirect = response.status === 502 && body?.reason === 'upstream_redirect';
      throw new OctoEverywhereError(typeof body?.code === 'number' ? body.code : response.status, response.status, upstreamRedirect);
    }
    return response;
  } catch (error) {
    if (init.signal?.aborted) throw abortError();
    if (error instanceof OctoEverywhereError) throw error;
    throw new OctoEverywhereError(600);
  }
}

function jsonInit(method: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): RequestInit {
  return { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal };
}

async function json<T>(response: Response, plugin = false): Promise<T> {
  const value = await response.json().catch(() => { throw new OctoEverywhereError(600); });
  if (plugin) {
    if (value?.Status !== 200) throw new OctoEverywhereError(typeof value?.Status === 'number' ? value.Status : 600);
    return value.Result as T;
  }
  return value as T;
}

export async function getOctoEverywhereConfig(signal?: AbortSignal): Promise<OctoEverywhereConfig> {
  return json(await request('/config', { signal }));
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.byteLength === 0) return b;
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function findJpegMarker(bytes: Uint8Array, secondByte: number, from = 0): number {
  for (let i = from; i < bytes.byteLength - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === secondByte) return i;
  }
  return -1;
}

function parsePartContentLength(headerBytes: Uint8Array): number | undefined {
  const n = headerBytes.byteLength;
  if (n < 4) return undefined;
  const endsWithCrLf = headerBytes[n - 4] === 13 && headerBytes[n - 3] === 10 && headerBytes[n - 2] === 13 && headerBytes[n - 1] === 10;
  const endsWithLf = headerBytes[n - 2] === 10 && headerBytes[n - 1] === 10;
  if (!endsWithCrLf && !endsWithLf) return undefined;
  const headerText = new TextDecoder().decode(headerBytes);
  const matches = [...headerText.matchAll(/(?:^|\r?\n)content-length\s*:\s*(\d+)\s*(?=\r?\n|$)/gi)];
  const match = matches.at(-1);
  if (!match) return undefined;
  const len = Number(match[1]);
  return Number.isSafeInteger(len) && len >= 2 && len <= MAX_STREAM_BUFFER_BYTES ? len : undefined;
}

function isJsonErrorEnvelope(value: unknown): value is { Status: number } {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Number.isInteger((value as { Status?: unknown }).Status) &&
    (value as { Status: number }).Status >= 400 &&
    Object.keys(value).every(key => ['Status', 'Error', 'Result'].includes(key));
}

// Guidance applies per App Connection, even if two UI consumers create adapters.
const gadgetReservations = new Map<string, { next: number; disabledPrint?: string }>();
export class OctoEverywhereApi implements PrinterApi {
  private readonly controller = new AbortController();
  private readonly connection: OctoEverywhereConnection;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private streamTimer?: ReturnType<typeof setTimeout>;
  private streamController?: AbortController;
  private monitoring = false;
  private info?: OctoEverywhereInfo;
  private infoReadAt = 0;
  private latest?: PrinterState;
  private printKey = '';
  private unsupportedFiles = false;

  constructor(private readonly printer: PhysicalPrinter) {
    const connection = printer.octoeverywhere?.connection;
    if (!isOctoEverywhereConnection(connection)) throw new OctoEverywhereError(603);
    this.connection = connection;
  }

  get capabilities() {
    const caps = this.latest?.octoeverywhere?.capabilities ?? octoEverywhereCapabilities(this.printer.host_type);
    return this.unsupportedFiles ? { ...caps, files: false, rawGcodeUpload: false, rawGcodeStart: false } : caps;
  }
  get remoteState() { return this.latest?.octoeverywhere; }

  private checkAlive() { if (this.controller.signal.aborted) throw abortError(); }

  private async parse<T>(response: Response, plugin = false): Promise<T> {
    try { return await json<T>(response, plugin); }
    finally { this.checkAlive(); }
  }

  private printerHeaders(extra?: Record<string, string>): Record<string, string> {
    const auth = this.connection.auth;
    const authHeader = auth.type === 'bearer'
      ? `Bearer ${auth.token}`
      : auth.type === 'basic'
        ? encodeBasicAuth(auth.username, auth.password)
        : undefined;
    return {
      ...extra,
      [TARGET_HEADER]: this.connection.url,
      ...(authHeader ? { [AUTH_HEADER]: authHeader } : {})
    };
  }

  private appHeaders(includeConnectionId = false, extra?: Record<string, string>): Record<string, string> {
    return {
      ...extra,
      [APP_TOKEN_HEADER]: this.connection.appApiToken,
      ...(includeConnectionId ? { [CONNECTION_ID_HEADER]: this.connection.connectionId } : {})
    };
  }

  private async printerCall(command: string, init: RequestInit = {}): Promise<Response> {
    this.checkAlive();
    const response = await request(`/plugin/${command}`, {
      ...init,
      signal: init.signal ?? this.controller.signal,
      headers: this.printerHeaders(init.headers as Record<string, string> | undefined)
    });
    this.checkAlive();
    return response;
  }

  private async appCall(path: string, init: RequestInit = {}, includeConnectionId = false): Promise<Response> {
    this.checkAlive();
    const response = await request(path, {
      ...init,
      signal: init.signal ?? this.controller.signal,
      headers: this.appHeaders(includeConnectionId, init.headers as Record<string, string> | undefined)
    });
    this.checkAlive();
    return response;
  }

  private async plugin<T>(command: string, body?: unknown, method = 'GET'): Promise<T> {
    return this.parse(await this.printerCall(command, jsonInit(method, body)), true);
  }

  async getInfo(signal?: AbortSignal): Promise<OctoEverywhereInfo> {
    const info = await this.parse<OctoEverywhereInfo>(await this.appCall('/info', { signal }));
    if (signal?.aborted) throw abortError();
    this.checkAlive(); this.info = info; this.infoReadAt = Date.now(); return info;
  }

  async readStatus(): Promise<PrinterState> {
    let result: OctoEverywhereStatus;
    try {
      result = await this.plugin<OctoEverywhereStatus>('status?IncludeMaterialSystem=true');
    } catch (error) {
      if (error instanceof OctoEverywhereError && error.upstreamRedirect && this.info?.IsOnline === false) {
        // Retry should recheck connectivity after the printer comes back.
        this.infoReadAt = 0;
        throw new OctoEverywhereError(601);
      }
      throw error;
    }
    this.checkAlive();
    this.printKey = result.OctoEverywhereStatus?.MostRecentPrintIdStr ?? `${result.OctoEverywhereStatus?.PrintStartTimeSec ?? ''}:${result.JobStatus?.CurrentPrint?.FileName ?? ''}`;
    this.latest = normalizeOctoEverywhereStatus(result, this.printer.host_type, this.info);
    if (this.unsupportedFiles) this.latest.octoeverywhere!.capabilities = this.capabilities;
    return this.latest;
  }

  async test(): Promise<string> {
    await this.getInfo(); const state = await this.readStatus();
    if (state.state === 'offline') throw new OctoEverywhereError(601);
    return this.info?.PrinterName ?? this.connection.printerName;
  }

  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void, options: ConnectOptions = {}): () => void {
    this.checkAlive();
    if (this.monitoring) throw new Error('OctoEverywhere monitoring is already active.');
    this.monitoring = true;
    let stopped = false;
    const poll = async () => {
      try {
        if (stopped) return;
        if (!this.info || Date.now() - this.infoReadAt >= 60000) await this.getInfo();
        if (stopped) return;
        const state = await this.readStatus();
        if (stopped) return;
        if (options.isActive?.() !== false && state.state === 'printing') {
          // Gadget failure must not discard otherwise valid printer telemetry.
          try { const gadget = await this.getGadget(true); if (gadget) state.octoeverywhere!.gadget = gadget; }
          catch (error) { if (this.controller.signal.aborted) throw error; }
        }
        this.checkAlive(); if (!stopped) onState(state);
      } catch (error) {
        if (!stopped && !this.controller.signal.aborted) {
          const failure = error instanceof OctoEverywhereError ? error : new OctoEverywhereError(600);
          this.latest = { state: failure.code === 601 ? 'offline' : 'unknown', heaters: [], fans: [], octoeverywhere: {
            capabilities: octoEverywhereCapabilities(this.printer.host_type), health: failure.code === 601 ? 'offline' : 'error',
            errorCode: failure.code, recovery: failure.recovery, info: this.info, cameras: [] } };
          onError(failure);
        }
      }
      if (!stopped && !this.controller.signal.aborted) this.pollTimer = setTimeout(() => void poll(), options.pollIntervalMs ?? (options.isActive?.() === false ? 15000 : 3000));
    };
    void poll();
    return () => { stopped = true; this.monitoring = false; clearTimeout(this.pollTimer); };
  }

  dispose(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort(); clearTimeout(this.pollTimer); this.stopCameraStream();
  }

  private require(feature: 'home' | 'jog' | 'extrude' | 'temps' | 'lights' | 'start') {
    if (!this.capabilities[feature]) throw new OctoEverywhereError(788);
  }

  async home(axes?: Array<'x' | 'y' | 'z'>): Promise<void> {
    this.require('home'); if (axes && (axes.length !== 3 || !['x', 'y', 'z'].every(a => axes.includes(a as 'x' | 'y' | 'z')))) throw new OctoEverywhereError(788);
    await this.plugin('home', undefined, 'POST');
  }

  async jog(axis: 'x' | 'y' | 'z', distance: number, speed?: number): Promise<void> {
    this.require('jog'); if (!['x', 'y', 'z'].includes(axis) || !Number.isFinite(distance) || speed !== undefined) throw new OctoEverywhereError(788);
    await this.plugin('move-axis', { Axis: axis.toUpperCase(), DistanceMm: distance }, 'POST');
  }

  async extrude(amount: number, speed?: number): Promise<void> { return this.extrudeTool(0, amount, speed); }

  async extrudeTool(tool: number, amount: number, speed?: number): Promise<void> {
    this.require('extrude'); if (!Number.isInteger(tool) || tool < 0 || !Number.isFinite(amount) || speed !== undefined) throw new OctoEverywhereError(788);
    await this.plugin('extrude', { Extruder: tool, DistanceMm: amount }, 'POST');
  }

  async setTemperature(heater: 'extruder' | 'bed' | 'chamber', target: number, tool = 0): Promise<void> {
    this.require('temps');
    if (!Number.isFinite(target) || target < 0 || target > (heater === 'extruder' ? 260 : 75) || !Number.isInteger(tool) || tool < 0) throw new OctoEverywhereError(400);
    await this.plugin('set-temp', heater === 'extruder' ? { ToolC: target, ToolNumber: tool } : heater === 'bed' ? { BedC: target } : { ChamberC: target }, 'POST');
  }

  async setLight(name: string, on: boolean): Promise<void> {
    this.require('lights'); if (!this.latest?.octoeverywhere?.lights?.some(light => light.Name === name)) throw new OctoEverywhereError(788);
    await this.plugin('set-light', { Name: name, On: on }, 'POST');
  }

  async pausePrint(options: OctoEverywherePauseOptions = {}): Promise<void> {
    if (this.latest?.state !== 'printing') throw new OctoEverywhereError(786);
    await this.plugin('pause', { SuppressNotification: false, ...options }, 'POST');
  }

  async resumePrint(): Promise<void> {
    if (this.latest?.state !== 'paused') throw new OctoEverywhereError(786);
    await this.plugin('resume', undefined, 'POST');
  }

  async cancelPrint(): Promise<void> {
    if (!['printing', 'paused'].includes(this.latest?.state ?? '')) throw new OctoEverywhereError(786);
    await this.plugin('cancel', undefined, 'POST');
  }

  private filePath(path: string, operation: 'list' | 'upload' | 'download' | 'delete' | 'details'): string {
    if (this.unsupportedFiles || !this.capabilities.fileRoots[operation].includes(path.split('/')[0]) ||
        path.includes('\\') || path.includes('?') || path.includes('#') || path.split('/').some(v => v === '.' || v === '..' || !v) || /[\u0000-\u001f]/.test(path)) throw new OctoEverywhereError(788);
    return encodeURIComponent(path);
  }

  private async fileCommand<T>(command: string, body?: unknown, method = 'GET'): Promise<T> {
    try { return await this.plugin<T>(command, body, method); }
    catch (error) { if (error instanceof OctoEverywhereError && error.code === 788) this.unsupportedFiles = true; throw error; }
  }

  async listFiles(root?: string): Promise<OctoEverywhereFile[]> {
    if (!this.capabilities.files) throw new OctoEverywhereError(788);
    const query = root ? `?root=${this.filePath(root, 'list')}` : '';
    return (await this.fileCommand<{ Root: OctoEverywhereFile[] }>(`files/list${query}`)).Root;
  }

  async getFileDetails(path: string): Promise<OctoEverywhereFileDetails> {
    return this.fileCommand(`files/details?path=${this.filePath(path, 'details')}`);
  }

  private uploadWithProgress(command: string, headers: Record<string, string>, bytes: Uint8Array, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<Response> {
    this.checkAlive();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      if (signal.aborted) { reject(abortError()); return; }
      const cleanup = () => {
        signal.removeEventListener('abort', abort);
        xhr.upload.onprogress = xhr.upload.onload = null;
        xhr.onload = xhr.onerror = xhr.onabort = null;
      };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const abort = () => { xhr.abort(); fail(abortError()); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        xhr.open('PUT', `${ROOT}/plugin/${command}`);
        for (const [name, value] of Object.entries(this.printerHeaders(headers))) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = event => {
          if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
        };
        // The browser finished sending, but the plugin has yet to confirm the upload.
        xhr.upload.onload = () => onProgress(1);
        xhr.onerror = () => fail(new OctoEverywhereError(600));
        xhr.onabort = () => fail(abortError());
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            let body;
            try { body = JSON.parse(xhr.responseText); } catch { /* Keep diagnostics sanitized. */ }
            fail(new OctoEverywhereError(typeof body?.code === 'number' ? body.code : xhr.status,
              xhr.status, xhr.status === 502 && body?.reason === 'upstream_redirect'));
            return;
          }
          const response = new Response(xhr.responseText);
          cleanup(); resolve(response);
        };
        xhr.send(bytes as XMLHttpRequestBodyInit);
      } catch { fail(new OctoEverywhereError(600)); }
    });
  }

  async uploadFile(path: string, bytes: Uint8Array, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<{ VirtualPath: string; PlatformPath: string; SizeBytes?: number }> {
    const uploadSignal = signal ? AbortSignal.any([this.controller.signal, signal]) : this.controller.signal;
    if (uploadSignal.aborted) throw abortError();
    const encoded = this.filePath(path, 'upload');
    if (!this.info) await this.getInfo(uploadSignal);
    const limit = this.info?.PrinterLimits?.MaxUploadFileSizeBytes;
    if (typeof limit === 'number' && limit >= 0 && bytes.byteLength > limit) throw new OctoEverywhereError(608);
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) headers[MAX_BYTES_HEADER] = String(limit);
    try {
      const command = `files/upload?path=${encoded}`;
      const useProgress = onProgress && typeof window !== 'undefined' && typeof XMLHttpRequest !== 'undefined';
      const response = useProgress
        ? await this.uploadWithProgress(command, headers, bytes, onProgress, uploadSignal)
        : await this.printerCall(command, { method: 'PUT', headers, body: bytes as BodyInit, signal: uploadSignal });
      const result = await this.parse<{ VirtualPath: string; PlatformPath: string; SizeBytes?: number }>(response, true);
      if (uploadSignal.aborted) throw abortError();
      if (!useProgress) onProgress?.(1);
      return result;
    } catch (error) { if (error instanceof OctoEverywhereError && error.code === 788) this.unsupportedFiles = true; throw error; }
  }

  async upload(options: UploadOptions): Promise<void> {
    // Reject before upload when the requested combined workflow is incompatible.
    if (options.print && !this.latest) await this.readStatus();
    if (options.print && !this.capabilities.rawGcodeStart) throw new OctoEverywhereError(788);
    if (options.filename.includes('/') || options.filename.includes('\\') || !/\.(gcode|gco|g)$/i.test(options.filename)) throw new OctoEverywhereError(400);
    const result = await this.uploadFile(`gcode/${options.filename}`, options.gcode, options.onProgress);
    if (options.print) await this.startFile(result.VirtualPath);
  }

  async deleteFile(path: string): Promise<void> {
    await this.fileCommand(`files/delete?path=${this.filePath(path, 'delete')}`, undefined, 'POST');
  }

  async downloadFile(path: string): Promise<Blob> {
    const encoded = this.filePath(path, 'download');
    if (!this.info) await this.getInfo();
    const limit = this.info?.PrinterLimits?.MaxDownloadFileSizeBytes;
    const headers: Record<string, string> = {};
    if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) headers[MAX_BYTES_HEADER] = String(limit);
    const response = await this.printerCall(`files/download?path=${encoded}`, { headers });
    const declared = Number(response.headers.get('content-length'));
    if (typeof limit === 'number' && limit >= 0 && declared > limit) { await response.body?.cancel(); throw new OctoEverywhereError(607); }
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      const abort = () => { void reader.cancel(); };
      this.controller.signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          this.checkAlive(); const { value, done } = await reader.read(); this.checkAlive(); if (done) break;
          size += value.byteLength;
          if (typeof limit === 'number' && limit >= 0 && size > limit) { await reader.cancel(); throw new OctoEverywhereError(607); }
          chunks.push(value);
        }
      } finally { this.controller.signal.removeEventListener('abort', abort); reader.releaseLock(); }
    }
    const blob = new Blob(chunks as BlobPart[], { type: response.headers.get('content-type') ?? 'application/octet-stream' });
    if (blob.type.includes('application/json') && blob.size <= 2 * 1024 * 1024) {
      const value = await blob.text().then(text => { try { return JSON.parse(text); } catch { return undefined; } });
      if (isJsonErrorEnvelope(value)) throw new OctoEverywhereError(value.Status);
    }
    return blob;
  }

  async startFile(path: string, options: OctoEverywhereStartOptions = {}): Promise<void> {
    if (!this.latest) await this.readStatus();
    this.require('start');
    if (!path.startsWith('gcode/') || path.split('/').some(v => !v || v === '..' || v === '.') || /[\\?#\u0000-\u001f]/.test(path)) throw new OctoEverywhereError(400);
    const bambu = this.printer.host_type === 'bambu' || this.printer.host_type === 'bambu-cloud';
    if (bambu && !/\.3mf$/i.test(path)) throw new OctoEverywhereError(788);
    if (options.Plate !== undefined && (!Number.isInteger(options.Plate) || options.Plate < 1) ||
        options.AmsMapping?.some(n => !Number.isInteger(n)) || options.Storage !== undefined && this.printer.host_type !== 'prusalink') throw new OctoEverywhereError(400);
    if (!bambu && Object.keys(options).some(k => k !== 'Storage')) throw new OctoEverywhereError(788);
    await this.plugin('start', { Path: path, ...options }, 'POST');
  }

  async listCameras() {
    return normalizeOctoEverywhereCameras(await this.plugin<OctoEverywhereCameraList>('webcam/list'));
  }

  async getSnapshot(index = 0): Promise<{ url: string; revoke: () => void }> {
    if (!Number.isInteger(index) || index < 0) throw new OctoEverywhereError(400);
    this.checkAlive();
    const response = await this.printerCall(`webcam/snapshot?index=${index}`, { signal: this.controller.signal });
    const blob = await response.blob();
    this.checkAlive();
    if (blob.type.includes('application/json') && blob.size <= 2 * 1024 * 1024) {
      const value = await blob.text().then(text => { try { return JSON.parse(text); } catch { return undefined; } });
      this.checkAlive();
      if (isJsonErrorEnvelope(value)) throw new OctoEverywhereError(value.Status);
      if (value && typeof value === 'object') {
        const record = value as { Status?: unknown; code?: unknown };
        if (typeof record.Status === 'number' && record.Status !== 200) throw new OctoEverywhereError(record.Status);
        if (typeof record.code === 'number') throw new OctoEverywhereError(record.code);
        throw new OctoEverywhereError(600);
      }
    }
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }

  /** At most one stream per adapter; expiry clears the image. A user must explicitly reconnect. */
  async openCameraStream(
    index: number,
    onFrame: (url: string, revoke: () => void) => void,
    onClose: () => void,
    onError?: (error: Error) => void
  ): Promise<{ maxDurationSeconds: number; close: () => void }> {
    if (!Number.isInteger(index) || index < 0) throw new OctoEverywhereError(400);
    this.checkAlive();
    this.stopCameraStream();

    const guard = new AbortController();
    this.streamController = guard;
    const onDispose = () => guard.abort();
    this.controller.signal.addEventListener('abort', onDispose, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    let closeNotified = false;
    const notifyClose = () => {
      if (closeNotified) return;
      closeNotified = true;
      onClose();
    };
    const close = () => {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      this.controller.signal.removeEventListener('abort', onDispose);
      if (this.streamController === guard) {
        this.streamController = undefined;
        this.streamTimer = undefined;
      }
      if (!guard.signal.aborted) guard.abort();
      if (started) notifyClose();
    };
    guard.signal.addEventListener('abort', close, { once: true });

    try {
      if (!this.info) await this.getInfo();
      this.checkAlive();
      if (guard.signal.aborted) throw abortError();
      const limit = this.info?.PrinterLimits?.MaxSingleWebcamStreamLengthSeconds;
      // Unknown limits get a conservative local bound, never an assumed plan entitlement.
      const duration = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.min(limit, 300) : 20;

      timer = setTimeout(close, duration * 1000);
      this.streamTimer = timer;

      const response = await this.printerCall(`webcam/stream?index=${index}`, {
        signal: guard.signal,
        headers: { [STREAM_SECONDS_HEADER]: String(duration) }
      });
      if (guard.signal.aborted) throw abortError();

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (contentType.includes('application/json')) {
        await this.parse(response, true);
        throw new OctoEverywhereError(600);
      }

      started = true;

      void (async () => {
        const reader = response.body?.getReader();
        const abortReader = () => { void reader?.cancel().catch(() => undefined); };
        guard.signal.addEventListener('abort', abortReader, { once: true });
        try {
          if (!reader) {
            if (contentType.startsWith('image/')) {
              const blob = await response.blob();
              if (!guard.signal.aborted && blob.size > 0) {
                const url = URL.createObjectURL(blob);
                onFrame(url, () => URL.revokeObjectURL(url));
              }
            }
            return;
          }

          if (contentType.startsWith('image/')) {
            const chunks: Uint8Array[] = [];
            let total = 0;
            while (!guard.signal.aborted) {
              const { value, done } = await reader.read();
              if (done) break;
              total += value.byteLength;
              if (total > MAX_STREAM_BUFFER_BYTES) throw new OctoEverywhereError(607);
              chunks.push(value);
            }
            if (!guard.signal.aborted && total > 0) {
              const mime = contentType.split(';')[0].trim() || 'image/jpeg';
              const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: mime }));
              onFrame(url, () => URL.revokeObjectURL(url));
            }
            return;
          }

          let buffer: Uint8Array = new Uint8Array(0);
          while (!guard.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            if (buffer.byteLength + value.byteLength > MAX_STREAM_BUFFER_BYTES) {
              throw new OctoEverywhereError(607);
            }
            buffer = concatBytes(buffer, value);

            while (!guard.signal.aborted) {
              const soi = findJpegMarker(buffer, 0xd8);
              if (soi < 0) break;
              const contentLength = parsePartContentLength(buffer.subarray(0, soi));
              if (contentLength !== undefined) {
                if (buffer.byteLength < soi + contentLength) break;
                const frame = buffer.slice(soi, soi + contentLength);
                buffer = buffer.slice(soi + contentLength);
                const url = URL.createObjectURL(new Blob([frame as BlobPart], { type: 'image/jpeg' }));
                onFrame(url, () => URL.revokeObjectURL(url));
                continue;
              }
              const eoi = findJpegMarker(buffer, 0xd9, soi + 2);
              if (eoi < 0) break;
              const frame = buffer.slice(soi, eoi + 2);
              buffer = buffer.slice(eoi + 2);
              const url = URL.createObjectURL(new Blob([frame as BlobPart], { type: 'image/jpeg' }));
              onFrame(url, () => URL.revokeObjectURL(url));
            }
          }
        } catch (error) {
          if (!guard.signal.aborted) {
            onError?.(error instanceof Error ? error : new OctoEverywhereError(600));
          }
        } finally {
          guard.signal.removeEventListener('abort', abortReader);
          if (reader) { try { reader.releaseLock(); } catch { /* already released */ } }
          close();
        }
      })();

      return { maxDurationSeconds: duration, close };
    } catch (error) {
      close();
      throw error;
    }
  }

  stopCameraStream(): void {
    this.streamController?.abort();
    this.streamController = undefined;
    clearTimeout(this.streamTimer);
    this.streamTimer = undefined;
  }

  async getGadget(active: boolean): Promise<OctoEverywhereGadget | undefined> {
    this.checkAlive(); if (!active || this.latest?.state !== 'printing') return;
    const key = this.connection.connectionId;
    const reservation = gadgetReservations.get(key);
    if (reservation && (Date.now() < reservation.next || reservation.disabledPrint === this.printKey)) return;
    // Bound bookkeeping without evicting a connection still inside its throttle interval.
    for (const [id, r] of gadgetReservations) if (r.next < Date.now() - 86400000) gadgetReservations.delete(id);
    if (!reservation && gadgetReservations.size >= 128) return;
    const current = { next: Date.now() + 10000, disabledPrint: undefined as string | undefined };
    gadgetReservations.set(key, current);
    const gadget = await this.parse<OctoEverywhereGadget>(await this.appCall('/gadget', jsonInit('POST', {}), true));
    if (gadget.State === 0) current.next = Date.now() + 60000;
    if (gadget.State === 1) current.disabledPrint = this.printKey;
    return gadget;
  }

  async createLiveLink(options: OctoEverywhereLiveOptions = {}): Promise<OctoEverywhereLiveLink> {
    if (options.ExpirationHours !== undefined && (!Number.isFinite(options.ExpirationHours) || options.ExpirationHours < 1 || options.ExpirationHours > 17520)) throw new OctoEverywhereError(400);
    return this.parse(await this.appCall('/live-link', jsonInit('POST', options)));
  }

  async setNotificationWebhook(options: OctoEverywhereWebhook): Promise<void> {
    try {
      const url = new URL(options.WebhookUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
    } catch { throw new OctoEverywhereError(400); }
    if (options.InclusiveEventTypesFilter?.some(v => !Number.isInteger(v) || v < 0)) throw new OctoEverywhereError(400);
    await this.appCall('/notifications', jsonInit('POST', options));
  }

  async deleteNotificationWebhook(): Promise<void> { await this.appCall('/notifications', { method: 'DELETE' }); }

  /** Opaque provider callback result; no response schema is documented. */
  async testNotificationWebhook(): Promise<unknown> { return this.parse(await this.appCall('/notifications/test', { method: 'POST' })); }
}
