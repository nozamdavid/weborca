import type { ConnectOptions, PhysicalPrinter, PrinterApi, PrinterState, UploadOptions } from './types';
import { isOctoEverywhereConnection, normalizeOctoEverywhereCameras, normalizeOctoEverywhereStatus, octoEverywhereCapabilities } from './octoEverywhereMapping';
import type { OctoEverywhereCameraList, OctoEverywhereConfig, OctoEverywhereConnection, OctoEverywhereFile, OctoEverywhereFileDetails,
  OctoEverywhereFlow, OctoEverywhereGadget, OctoEverywhereInfo, OctoEverywhereLiveLink, OctoEverywhereLiveOptions,
  OctoEverywherePauseOptions, OctoEverywherePortalResult, OctoEverywhereRecovery, OctoEverywhereStartOptions,
  OctoEverywhereStatus, OctoEverywhereTicket, OctoEverywhereWebhook } from './octoEverywhereTypes';
export * from './octoEverywhereTypes';
export * from './octoEverywhereMapping';

const ROOT = '/_octoeverywhere';
const SESSION_HEADER = 'X-OctoEverywhere-Session';
const FLOW_HEADER = 'X-OctoEverywhere-Flow';
const abortError = () => new DOMException('OctoEverywhere operation cancelled.', 'AbortError');
const recoveryFor = (code: number): OctoEverywhereRecovery =>
  [401, 410, 603, 604].includes(code) ? 'reconnect' : code === 605 ? 'supporter' : code === 610 ? 'update-plugin' :
    code === 788 ? 'unsupported' : [607, 608, 609, 787].includes(code) ? 'limit' : [600, 602, 429, 503].includes(code) ? 'wait' : 'check-printer';
export class OctoEverywhereError extends Error {
  readonly recovery: OctoEverywhereRecovery;
  constructor(readonly code: number, readonly httpStatus?: number) {
    const recovery = recoveryFor(code);
    const messages: Record<OctoEverywhereRecovery, string> = {
      reconnect: 'Reconnect this printer to OctoEverywhere.', supporter: 'OctoEverywhere Supporter Perks are required.',
      'update-plugin': 'Update the OctoEverywhere plugin.', unsupported: 'This OctoEverywhere operation is unsupported.',
      limit: 'An OctoEverywhere transfer, stream, or client limit was reached.', wait: 'OctoEverywhere is temporarily unavailable. Try again later.',
      'check-printer': 'OctoEverywhere could not complete the operation. Check the printer connection.'
    };
    super(messages[recovery]); this.name = 'OctoEverywhereError'; this.recovery = recovery;
  }
}

/** Never surface upstream errors, which may echo URLs, request bodies or credentials. */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(`${ROOT}${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new OctoEverywhereError(typeof body.code === 'number' ? body.code : response.status, response.status);
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
export async function startOctoEverywherePortal(options: { printerId?: string; requestOctoPrintApiKey?: boolean } = {}, signal?: AbortSignal): Promise<OctoEverywhereFlow> {
  return json(await request('/portal/start', jsonInit('POST', options, signal)));
}
export async function getOctoEverywherePortalResult(flow: OctoEverywhereFlow, signal?: AbortSignal): Promise<OctoEverywherePortalResult> {
  const result = await json<OctoEverywherePortalResult>(await request(`/portal/result/${encodeURIComponent(flow.flowId)}`, { signal, headers: { [FLOW_HEADER]: flow.pollToken } }));
  if (result.status === 'complete' && !isOctoEverywhereConnection(result.connection)) throw new OctoEverywhereError(600);
  return result.status === 'failed' ? { status: 'failed', error: 'OctoEverywhere linking failed. Start a new connection.' } : result;
}
export async function cancelOctoEverywherePortal(flow: OctoEverywhereFlow, signal?: AbortSignal): Promise<void> {
  await request(`/portal/result/${encodeURIComponent(flow.flowId)}`, { method: 'DELETE', signal, headers: { [FLOW_HEADER]: flow.pollToken } });
}

type Session = { sessionId: string; sessionToken: string; expiresAt: number };
// Guidance applies per App Connection, even if two UI consumers create adapters.
const gadgetReservations = new Map<string, { next: number; disabledPrint?: string }>();
export class OctoEverywhereApi implements PrinterApi {
  private readonly controller = new AbortController();
  private readonly connection: OctoEverywhereConnection;
  private session?: Session;
  private pendingSession?: Promise<Session>;
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
    // Only the provider connection enters the session; native/cloud printer auth stays separate.
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
  private closeSession(session: Session) {
    return request(`/sessions/${encodeURIComponent(session.sessionId)}`, { method: 'DELETE', headers: { [SESSION_HEADER]: session.sessionToken }, keepalive: true }).catch(() => undefined);
  }
  private async ensureSession(): Promise<Session> {
    this.checkAlive();
    if (this.session && this.session.expiresAt > Date.now()) return this.session;
    if (this.pendingSession) return this.pendingSession;
    if (this.session) { void this.closeSession(this.session); this.session = undefined; }
    this.pendingSession = (async () => {
      const session = await json<Session>(await request('/sessions', jsonInit('POST', { connection: this.connection }, this.controller.signal)));
      if (!session?.sessionId || !session.sessionToken || !Number.isFinite(session.expiresAt)) throw new OctoEverywhereError(600);
      if (this.controller.signal.aborted) { void this.closeSession(session); throw abortError(); }
      this.session = session;
      return session;
    })();
    try { return await this.pendingSession; } finally { this.pendingSession = undefined; }
  }
  private async call(path: string, init: RequestInit = {}, safeRead = false): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.ensureSession();
      try {
        const response = await request(`/sessions/${encodeURIComponent(session.sessionId)}/${path}`, { ...init,
          signal: init.signal ?? this.controller.signal, headers: { ...init.headers, [SESSION_HEADER]: session.sessionToken } });
        this.checkAlive();
        return response;
      } catch (error) {
        this.checkAlive();
        // Only a gateway session rejection is retried, never provider auth or a mutation.
        if (safeRead && attempt === 0 && error instanceof OctoEverywhereError &&
            error.code === error.httpStatus && [401, 404, 410].includes(error.code)) {
          if (this.session === session) { this.session = undefined; void this.closeSession(session); }
          continue;
        }
        throw error;
      }
    }
  }
  private async plugin<T>(command: string, body?: unknown, method = 'GET'): Promise<T> {
    return this.parse(await this.call(`plugin/${command}`, jsonInit(method, body), method === 'GET'), true);
  }
  async getInfo(): Promise<OctoEverywhereInfo> {
    const info = await this.parse<OctoEverywhereInfo>(await this.call('info', {}, true));
    this.checkAlive(); this.info = info; this.infoReadAt = Date.now(); return info;
  }
  async readStatus(): Promise<PrinterState> {
    const result = await this.plugin<OctoEverywhereStatus>('status?IncludeMaterialSystem=true');
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
    const session = this.session; this.session = undefined;
    if (session) void this.closeSession(session);
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
  async uploadFile(path: string, bytes: Uint8Array): Promise<{ VirtualPath: string; PlatformPath: string; SizeBytes?: number }> {
    const encoded = this.filePath(path, 'upload');
    if (!this.info) await this.getInfo();
    const limit = this.info?.PrinterLimits?.MaxUploadFileSizeBytes;
    if (typeof limit === 'number' && limit >= 0 && bytes.byteLength > limit) throw new OctoEverywhereError(608);
    try {
      return await this.parse(await this.call(`plugin/files/upload?path=${encoded}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes as BodyInit }), true);
    } catch (error) { if (error instanceof OctoEverywhereError && error.code === 788) this.unsupportedFiles = true; throw error; }
  }
  async upload(options: UploadOptions): Promise<void> {
    // Reject before upload when the requested combined workflow is incompatible.
    if (options.print && !this.latest) await this.readStatus();
    if (options.print && !this.capabilities.rawGcodeStart) throw new OctoEverywhereError(788);
    if (options.filename.includes('/') || options.filename.includes('\\') || !/\.(gcode|gco|g)$/i.test(options.filename)) throw new OctoEverywhereError(400);
    const result = await this.uploadFile(`gcode/${options.filename}`, options.gcode);
    options.onProgress?.(1);
    if (options.print) await this.startFile(result.VirtualPath);
  }
  async deleteFile(path: string): Promise<void> {
    await this.fileCommand(`files/delete?path=${this.filePath(path, 'delete')}`, undefined, 'POST');
  }
  async downloadFile(path: string): Promise<Blob> {
    const encoded = this.filePath(path, 'download');
    if (!this.info) await this.getInfo();
    const response = await this.call(`plugin/files/download?path=${encoded}`, {}, true);
    const limit = this.info?.PrinterLimits?.MaxDownloadFileSizeBytes;
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
      if (value && Number.isInteger(value.Status) && value.Status >= 400 && Object.keys(value).every(key => ['Status', 'Error', 'Result'].includes(key))) throw new OctoEverywhereError(value.Status);
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
  async getTicket(kind: 'snapshot' | 'stream' | 'websocket' | 'mqtt', index?: number, path?: string): Promise<OctoEverywhereTicket> {
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) throw new OctoEverywhereError(400);
    const ticket = await this.parse<OctoEverywhereTicket>(await this.call('ticket', jsonInit('POST', { kind, ...(index === undefined ? {} : { index }), ...(path === undefined ? {} : { path }) })));
    // Ticket consumption is same-origin; the URL never includes provider credentials.
    const origin = globalThis.location?.origin ?? 'http://localhost';
    let url: URL;
    try { url = new URL(ticket.url, origin); } catch { throw new OctoEverywhereError(600); }
    const ticketOrigin = url.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
    if (ticketOrigin !== origin || !url.pathname.startsWith(`${ROOT}/`) || url.username || url.password || url.hash || !Number.isFinite(ticket.expiresAt)) throw new OctoEverywhereError(600);
    return ticket;
  }
  async getSnapshot(index = 0) { return this.getTicket('snapshot', index); }
  /** At most one stream per adapter; expiry clears the image. A user must explicitly reconnect. */
  async openCameraStream(index: number, onClose: () => void): Promise<{ url: string; expiresAt: number; maxDurationSeconds: number; close: () => void }> {
    this.stopCameraStream();
    const guard = new AbortController(); this.streamController = guard;
    if (!this.info) await this.getInfo();
    const limit = this.info?.PrinterLimits?.MaxSingleWebcamStreamLengthSeconds;
    // Unknown limits get a conservative local bound, never an assumed plan entitlement.
    const duration = typeof limit === 'number' && limit > 0 ? Math.min(limit, 300) : 20;
    const ticket = await this.getTicket('stream', index);
    this.checkAlive(); if (guard.signal.aborted) throw abortError();
    const close = () => { if (!guard.signal.aborted) guard.abort(); };
    this.streamController = guard;
    const timer = setTimeout(close, duration * 1000); this.streamTimer = timer;
    guard.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      if (this.streamController === guard) { this.streamController = undefined; this.streamTimer = undefined; }
    }, { once: true });
    // Disposal and replacement invoke onClose so callers remove the image src immediately.
    guard.signal.addEventListener('abort', onClose, { once: true });
    return { ...ticket, maxDurationSeconds: duration, close };
  }
  stopCameraStream(): void { this.streamController?.abort(); this.streamController = undefined; clearTimeout(this.streamTimer); }
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
    const gadget = await this.parse<OctoEverywhereGadget>(await this.call('gadget', jsonInit('POST', {})));
    if (gadget.State === 0) current.next = Date.now() + 60000;
    if (gadget.State === 1) current.disabledPrint = this.printKey;
    return gadget;
  }
  async createLiveLink(options: OctoEverywhereLiveOptions = {}): Promise<OctoEverywhereLiveLink> {
    if (options.ExpirationHours !== undefined && (!Number.isFinite(options.ExpirationHours) || options.ExpirationHours < 1 || options.ExpirationHours > 17520)) throw new OctoEverywhereError(400);
    return this.parse(await this.call('live-link', jsonInit('POST', options)));
  }
  async setNotificationWebhook(options: OctoEverywhereWebhook): Promise<void> {
    try {
      const url = new URL(options.WebhookUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
    } catch { throw new OctoEverywhereError(400); }
    if (options.InclusiveEventTypesFilter?.some(v => !Number.isInteger(v) || v < 0)) throw new OctoEverywhereError(400);
    await this.call('notifications', jsonInit('POST', options));
  }
  async deleteNotificationWebhook(): Promise<void> { await this.call('notifications', { method: 'DELETE' }); }
  /** Opaque provider callback result; no response schema is documented. */
  async testNotificationWebhook(): Promise<unknown> { return this.parse(await this.call('notifications/test', { method: 'POST' })); }
}
