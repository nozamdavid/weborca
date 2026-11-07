import type { ConnectOptions, PhysicalPrinter, PrinterApi, PrinterState, UploadOptions } from './types';
import { samePrusaScope, usePrinterConnectionStore } from './connectionStore';
import { translate } from '../i18n';
import { mergeSnapmakerObjects, parseSnapmakerFrame, snapmakerPrinterState, snapmakerMonitorError, SNAPMAKER_MONITOR_ERRORS, type SnapmakerObjects } from './snapmakerTelemetry';

export interface SnapmakerTokens { access_token: string; refresh_token: string }
export interface SnapmakerDevice { deviceId: string; name: string; sn?: string; online?: boolean | 0 | 1 }
export interface SnapmakerSession { tokens: SnapmakerTokens; user: { id: string }; devices: SnapmakerDevice[] }
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const identity = (v: unknown): string | undefined => text(v) ? v :
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : undefined;
const invalid = () => new Error('Invalid Snapmaker Cloud response. Retry when the service is available.');
const rejected = (e: unknown) => (e as { status?: number })?.status === 401;
const superseded = () => new DOMException('Session superseded', 'AbortError');

function prefix(p: PhysicalPrinter): string {
  if (p.host_type !== 'snapmaker-cloud' || p.print_host !== 'id.snapmaker.com' || (p.cloud_region ?? 'global') !== 'global')
    throw new Error('Unsupported Snapmaker Cloud scope.');
  return '/_printer/snapmaker-cloud';
}
export function parseSnapmakerTokens(value: unknown): SnapmakerTokens {
  const v = value as { code?: unknown; data?: Partial<SnapmakerTokens> };
  if (v?.code !== 200 || !text(v.data?.access_token) || !text(v.data?.refresh_token)) throw invalid();
  return { access_token: v.data.access_token, refresh_token: v.data.refresh_token };
}
export function parseSnapmakerDevices(value: unknown): SnapmakerDevice[] {
  const v = value as { code?: unknown; data?: unknown; page?: unknown };
  if (![0, 200].includes(v?.code as number) || !Array.isArray(v.data) || v.data.length > 1000) throw invalid();
  // The normalized endpoint requests the complete unfiltered list. Never clear a selection from a partial page.
  if (v.page != null) {
    const page = v.page as { total?: unknown; totalCount?: unknown; totalRows?: unknown; pages?: unknown; totalPages?: unknown };
    const total = page.total ?? page.totalCount ?? page.totalRows;
    const pages = page.pages ?? page.totalPages;
    if ((total !== undefined && (!Number.isSafeInteger(total) || (total as number) !== v.data.length)) ||
      (pages !== undefined && pages !== 1 && !(pages === 0 && v.data.length === 0)) ||
      (total === undefined && pages === undefined)) throw invalid();
  }
  const ids = new Set<string>();
  return v.data.map(item => {
    const deviceId = identity(item?.deviceId);
    if (!item || !deviceId || !text(item.name) || ids.has(deviceId) ||
      (item.sn !== undefined && !identity(item.sn)) ||
      (item.online !== undefined && ![0, 1, true, false].includes(item.online))) throw invalid();
    ids.add(deviceId);
    return { deviceId, name: item.name, sn: item.sn === undefined ? undefined : identity(item.sn), online: item.online };
  });
}
async function request(p: PhysicalPrinter, path: string, signal: AbortSignal, body?: object, token?: string): Promise<unknown> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const response = await fetch(`${prefix(p)}${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', signal: bounded,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  bounded.throwIfAborted();
  if (!response.ok) throw Object.assign(new Error('Snapmaker Cloud request failed. Retry or sign in again.'), { status: response.status });
  const value = await response.json();
  bounded.throwIfAborted();
  if ([401, 110002, 110003, 110004].includes(value?.code))
    throw Object.assign(new Error('Snapmaker Cloud session rejected. Sign in again.'), { status: 401 });
  return value;
}
export async function sendSnapmakerCode(p: PhysicalPrinter, account: string, signal: AbortSignal): Promise<void> {
  const value = await request(p, '/auth/send-code', signal, { account }) as { code?: unknown };
  if (value?.code !== 200) throw invalid();
}
export async function loginSnapmaker(p: PhysicalPrinter, email: string, secret: { password: string } | { code: string }, signal: AbortSignal): Promise<PhysicalPrinter> {
  email = email.trim();
  const tokens = parseSnapmakerTokens(await request(p, '/auth/token', signal,
    'password' in secret ? { email, password: secret.password } : { email, code: secret.code }));
  signal.throwIfAborted();
  const source = { ...p, cloud_region: 'global' as const, cloud_account: email, printhost_apikey: tokens.access_token,
    cloud_refresh_token: tokens.refresh_token, printhost_password: undefined, use_gateway: true };
  // Durable before profile/list requests, without storing the login secret or a device payload.
  usePrinterConnectionStore.getState().saveSnapmakerSession(source);
  return source;
}
const refreshing = new Map<string, Promise<SnapmakerTokens>>();
export async function readSnapmakerSession(source: PhysicalPrinter, signal: AbortSignal,
  onRefresh?: (tokens: SnapmakerTokens) => void): Promise<{ credentials: PhysicalPrinter; data: SnapmakerSession }> {
  let expected = { ...source };
  let refreshed = false;
  const store = usePrinterConnectionStore;
  const hadCache = store.getState().snapmakerSessions.some(p => samePrusaScope(p, source) && p.cloud_account === source.cloud_account);
  const assertCurrent = () => {
    signal.throwIfAborted();
    const cached = store.getState().snapmakerSessions.find(p => samePrusaScope(p, expected) && p.cloud_account === expected.cloud_account);
    if (hadCache && !cached) throw superseded();
    if (cached && (cached.printhost_apikey !== expected.printhost_apikey || cached.cloud_refresh_token !== expected.cloud_refresh_token)) throw superseded();
  };
  const authenticated = async (path: string, body?: object): Promise<unknown> => {
    assertCurrent();
    try {
      const result = await request(expected, path, signal, body, expected.printhost_apikey);
      assertCurrent();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      if (!rejected(error) || !expected.cloud_refresh_token || refreshed) throw error;
      const key = JSON.stringify([prefix(expected), expected.cloud_account, expected.printhost_apikey, expected.cloud_refresh_token]);
      let pending = refreshing.get(key);
      if (!pending) {
        assertCurrent();
        pending = (async () => {
          const tokens = parseSnapmakerTokens(await request(expected, '/auth/refresh', signal, { refresh_token: expected.cloud_refresh_token }));
          assertCurrent();
          if (!store.getState().rotateSnapmakerSession(expected, tokens.access_token, tokens.refresh_token)) throw superseded();
          return tokens;
        })();
        refreshing.set(key, pending);
        void pending.finally(() => { if (refreshing.get(key) === pending) refreshing.delete(key); }).catch(() => {});
      }
      const tokens = await pending;
      signal.throwIfAborted();
      refreshed = true;
      expected = { ...expected, printhost_apikey: tokens.access_token, cloud_refresh_token: tokens.refresh_token };
      assertCurrent();
      onRefresh?.(tokens);
      const result = await request(expected, path, signal, body, tokens.access_token);
      assertCurrent();
      return result;
    }
  };
  try {
    const account = await authenticated('/account') as { code?: unknown; data?: { id?: unknown } };
    if (account?.code !== 200 || !account.data?.id ||
      !['string', 'number'].includes(typeof account.data.id) || (typeof account.data.id === 'number' && !Number.isFinite(account.data.id))) throw invalid();
    const devices = parseSnapmakerDevices(await authenticated('/devices', {}));
    assertCurrent();
    return { credentials: expected, data: { tokens: { access_token: expected.printhost_apikey!, refresh_token: expected.cloud_refresh_token! },
      user: { id: String(account.data.id) }, devices } };
  } catch (error) {
    signal.throwIfAborted();
    assertCurrent();
    if (rejected(error)) store.getState().rejectSnapmakerSession(expected);
    throw error;
  }
}
export class SnapmakerCloudApi implements PrinterApi {
  private stopMonitor?: () => void;
  constructor(private printer: PhysicalPrinter) {}
  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void, _options?: ConnectOptions): () => void {
    this.stopMonitor?.();
    const controller = new AbortController();
    const store = usePrinterConnectionStore;
    const selected = store.getState().selectedPrinterId;
    let credentials = { ...this.printer };
    let validating = true;
    let hadCache = store.getState().snapmakerSessions.some(p => samePrusaScope(p, credentials) && p.cloud_account === credentials.cloud_account);
    let socket: WebSocket | undefined;
    let objects: SnapmakerObjects = Object.create(null);
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    const stop = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      clearTimeout(timer);
      unsubscribe();
      objects = Object.create(null);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        socket.close();
        socket = undefined;
      }
      if (this.stopMonitor === stop) this.stopMonitor = undefined;
    };
    const fail = (error: Error) => {
      if (controller.signal.aborted) return;
      stop();
      onError(error);
    };
    const current = () => {
      if (controller.signal.aborted) return false;
      const state = store.getState();
      const saved = state.printers.find(p => p.id === credentials.id);
      if (state.selectedPrinterId !== selected || (saved &&
        (!samePrusaScope(saved, credentials) || saved.cloud_account !== credentials.cloud_account || saved.cloud_device_id !== credentials.cloud_device_id))) {
        stop();
        return false;
      }
      if (!validating) {
        const cached = state.snapmakerSessions.find(p => samePrusaScope(p, credentials) && p.cloud_account === credentials.cloud_account);
        if ((hadCache && !cached) || [cached, saved].some(p => p &&
          (p.printhost_apikey !== credentials.printhost_apikey || p.cloud_refresh_token !== credentials.cloud_refresh_token))) {
          fail(new Error('Snapmaker session changed. Connect again to read live status.'));
          return false;
        }
      }
      return true;
    };
    this.stopMonitor = stop;
    unsubscribe = store.subscribe(() => { current(); });
    const deadline = (milliseconds: number, message: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (current()) fail(new Error(message)); }, milliseconds);
    };
    const start = async () => {
      try {
        if (!text(credentials.printhost_apikey)) throw new Error(SNAPMAKER_MONITOR_ERRORS.auth);
        const session = await readSnapmakerSession(credentials, controller.signal, tokens => {
          this.printer = { ...this.printer, printhost_apikey: tokens.access_token, cloud_refresh_token: tokens.refresh_token };
        });
        if (!current()) return;
        this.printer = credentials = session.credentials;
        validating = false;
        hadCache = store.getState().snapmakerSessions.some(p => samePrusaScope(p, credentials) && p.cloud_account === credentials.cloud_account);
        if (!current()) return;
        if (!session.data.devices.some(d => d.deviceId === credentials.cloud_device_id))
          throw new Error('Selected Snapmaker printer is no longer in the account. Select a bound printer again.');
        // Monitoring is always same-origin; account requests may still use the configured gateway.
        const url = new URL('/_printer/snapmaker-cloud/monitor', window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(url.href);
        // Backend startup is bounded at 30s; leave room for delivery, then require a
        // fresh query/delta within 30s (15s query interval plus 10s RPC deadline).
        deadline(35_000, SNAPMAKER_MONITOR_ERRORS.timeout);
        socket.onopen = () => {
          if (!current()) return;
          try { socket!.send(JSON.stringify({ type: 'connect', accessToken: credentials.printhost_apikey, deviceId: credentials.cloud_device_id })); }
          catch { fail(new Error(SNAPMAKER_MONITOR_ERRORS.upstream)); }
        };
        socket.onmessage = event => {
          if (!current()) return;
          try {
            const frame = parseSnapmakerFrame(event.data);
            if (frame.type === 'error') {
              fail(new Error(snapmakerMonitorError(frame)));
              return;
            }
            if (frame.type === 'connection') {
              if (frame.state === 'disconnected' || ready) fail(new Error(SNAPMAKER_MONITOR_ERRORS.stale));
              return;
            }
            if (frame.type === 'delta' && !ready) throw new Error('Snapmaker monitoring snapshot is missing. Reconnect to retry.');
            objects = frame.type === 'snapshot' ? frame.objects : mergeSnapmakerObjects(objects, frame.objects);
            ready = true;
            deadline(30_000, SNAPMAKER_MONITOR_ERRORS.stale);
            onState(snapmakerPrinterState(objects));
          } catch {
            fail(new Error('Invalid Snapmaker monitoring data. Reconnect to retry.'));
          }
        };
        socket.onerror = () => { if (current()) fail(new Error(SNAPMAKER_MONITOR_ERRORS.upstream)); };
        socket.onclose = () => { if (current()) fail(new Error(SNAPMAKER_MONITOR_ERRORS.stale)); };
      } catch (error) {
        if (!controller.signal.aborted) fail(error instanceof Error ? error : new Error('Snapmaker account check failed. Retry or sign in again.'));
      }
    };
    void start();
    return stop;
  }
  async test(): Promise<string> {
    const session = await readSnapmakerSession(this.printer, AbortSignal.timeout(15_000), tokens => {
      this.printer = { ...this.printer, printhost_apikey: tokens.access_token, cloud_refresh_token: tokens.refresh_token };
    });
    this.printer = session.credentials;
    if (!session.data.devices.some(d => d.deviceId === this.printer.cloud_device_id)) throw new Error('Choose a printer bound to the cloud account.');
    return translate('Snapmaker account and selected printer verified. Connect to read live status.');
  }
  async upload(_options: UploadOptions): Promise<void> { throw new Error('Snapmaker Cloud is monitor-only. Upload and printing are unavailable.'); }
}
