import { bambuCloudApiUrl, bambuCloudMqttUrl } from './gatewayUrl';
import { deriveBambuState, mergeBambuReport } from './bambu';
import type { PhysicalPrinter, PrinterApi, PrinterState, ConnectOptions, UploadOptions } from './types';
import { usePrinterConnectionStore } from './connectionStore';
import { accountRequest } from './bambuAccount';

export interface BambuCloudDevice { dev_id: string; name: string }

export async function cloudJson(printer: PhysicalPrinter, path: string, init: RequestInit = {}): Promise<any> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const response = await fetch(bambuCloudApiUrl(printer, path), { ...init, signal, cache: 'no-store', redirect: 'error' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(`Cloud API answered ${response.status}.`), { status: response.status });
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid cloud API response.');
  return data;
}

export async function loginBambuCloud(printer: PhysicalPrinter, account: string, credentials: { password?: string; code?: string }, signal?: AbortSignal) {
  if (!account.trim() || (!credentials.password && !credentials.code)) throw new Error('Enter an account and password or verification code.');
  const login = await cloudJson(printer, '/v1/user-service/user/login', {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: account.trim(), ...(credentials.code ? { code: credentials.code } : { password: credentials.password }) })
  });
  if (login.loginType === 'verifyCode') throw new Error('Verification code required (check email).');
  if (typeof login.accessToken !== 'string' || !login.accessToken) throw new Error('No access token returned.');
  return fetchBambuCloudSession({ ...printer, printhost_apikey: login.accessToken,
    cloud_refresh_token: typeof login.refreshToken === 'string' ? login.refreshToken : undefined }, signal);
}

const renewals = new Map<string, Promise<{ accessToken: string; refreshToken: string }>>();

/** One renewal per credential pair; logout/replacement cannot be overwritten by a late response. */
async function accountJson(printer: PhysicalPrinter, path: string, signal?: AbortSignal): Promise<any> {
  if (printer.id === 'bambu-account') return accountRequest(path, signal);
  const wasSaved = usePrinterConnectionStore.getState().printers.some(p => p.id === printer.id);
  const read = async () => {
    const data = await cloudJson(printer, path, { signal, headers: { authorization: `Bearer ${printer.printhost_apikey}` } });
    signal?.throwIfAborted();
    if (wasSaved && !usePrinterConnectionStore.getState().printers.some(p => p.id === printer.id &&
      p.host_type === printer.host_type && p.print_host === printer.print_host && p.cloud_account === printer.cloud_account &&
      p.printhost_apikey === printer.printhost_apikey && p.cloud_refresh_token === printer.cloud_refresh_token))
      throw new DOMException('Session superseded', 'AbortError');
    return data;
  };
  try { return await read(); } catch (error) {
    if ((error as { status?: number }).status !== 401 || !printer.cloud_refresh_token) throw error;
    const original = { ...printer };
    const key = JSON.stringify([printer.printhost_apikey, printer.cloud_refresh_token]);
    let renewal = renewals.get(key);
    if (!renewal) {
      renewal = cloudJson(printer, '/v1/user-service/user/refreshtoken', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: printer.cloud_refresh_token })
      }).then(data => {
        if (typeof data.accessToken !== 'string' || !data.accessToken || typeof data.refreshToken !== 'string' || !data.refreshToken)
          throw new Error('Cloud renewal unavailable. Sign in again.');
        return { accessToken: data.accessToken, refreshToken: data.refreshToken };
      }).finally(() => renewals.delete(key));
      renewals.set(key, renewal);
    }
    const tokens = await renewal;
    signal?.throwIfAborted();
    const store = usePrinterConnectionStore.getState();
    const saved = store.printers.find(p => p.id === original.id);
    if (wasSaved && !saved) throw new DOMException('Session superseded', 'AbortError');
    if (saved && saved.printhost_apikey === tokens.accessToken && saved.cloud_refresh_token === tokens.refreshToken) {
      Object.assign(printer, { printhost_apikey: tokens.accessToken, cloud_refresh_token: tokens.refreshToken });
    } else {
      if (!store.updateCloudTokens(original, tokens.accessToken, tokens.refreshToken)) throw new DOMException('Session superseded', 'AbortError');
      Object.assign(printer, { printhost_apikey: tokens.accessToken, cloud_refresh_token: tokens.refreshToken });
    }
    return read();
  }
}

export async function fetchBambuCloudSession(printer: PhysicalPrinter, signal?: AbortSignal) {
  printer = { ...printer };
  const preference = await accountJson(printer, '/v1/design-user-service/my/preference', signal);
  if (!/^\d+$/.test(String(preference.uid ?? ''))) throw new Error('The cloud account did not return a valid user ID.');
  const bound = await accountJson(printer, '/v1/iot-service/api/user/bind', signal);
  if (!Array.isArray(bound.devices)) throw new Error('The cloud account did not return a device list.');
  const devices: BambuCloudDevice[] = bound.devices.filter((device: any) =>
    device && typeof device.dev_id === 'string' && /^[A-Za-z0-9_-]+$/.test(device.dev_id)
  ).map((device: any) => ({ dev_id: device.dev_id, name: typeof device.name === 'string' ? device.name : device.dev_id }));
  return { token: printer.printhost_apikey!, refreshToken: printer.cloud_refresh_token, username: `u_${preference.uid}`, devices };
}

/** Resolve JSON on the account API; the browser navigates to the CDN without a bearer. */
export async function makerWorldDownload(printer: PhysicalPrinter, designId: string, signal?: AbortSignal): Promise<string> {
  if (!/^[1-9]\d*$/.test(designId) || printer.host_type !== 'bambu-cloud' ||
    !['us.mqtt.bambulab.com', 'mqtt.bambu-lab.com'].includes(printer.print_host) || !printer.printhost_apikey)
    throw new Error('Sign in to a global Bambu Cloud account in printer settings.');
  printer = { ...printer };
  const design = await accountJson(printer, `/v1/design-service/design/${designId}`, signal);
  const id = String(design.defaultInstanceId || design.instances?.find((i: any) => i?.isDefault)?.id || design.instances?.[0]?.id || '');
  if (!/^[1-9]\d*$/.test(id)) throw new Error('No printable profile available.');
  const result = await accountJson(printer, `/v1/design-service/instance/${id}/f3mf?type=download`, signal);
  let url: URL;
  try { url = new URL(result.url); } catch { throw new Error('Invalid download response.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['makerworld.bblmw.com', 'model-file.bambulab.com'].includes(url.hostname)) throw new Error('Unsupported download host.');
  signal?.throwIfAborted();
  return url.href;
}

export async function makerWorldFile(printer: PhysicalPrinter, designId: string, signal?: AbortSignal): Promise<File> {
  const url = await makerWorldDownload(printer, designId, signal);
  const response = await fetch(bambuCloudApiUrl(printer, '/v1/design-service/model-bytes'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000),
    cache: 'no-store', redirect: 'error', credentials: 'omit'
  });
  if (!response.ok) throw new Error('Model transfer failed.');
  const blob = await response.blob();
  const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (blob.size > 100 * 1024 * 1024 || magic.join(',') !== '80,75,3,4') throw new Error('Invalid 3MF download.');
  return new File([blob], `MakerWorld-${designId}.3mf`, { type: 'model/3mf' });
}

export class BambuCloudApi implements PrinterApi {
  constructor(private printer: PhysicalPrinter) {}

  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void, _options?: ConnectOptions): () => void {
    let closed = false;
    let ws: WebSocket | undefined;
    let report: Record<string, any> = {};
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

    const tryConnect = () => {
      if (closed) return;
      try {
        const username = this.printer.printhost_user;
        const token = this.printer.printhost_apikey;
        const serial = this.printer.serial;

        if (!username || !token || !serial) {
          throw new Error('Cloud credentials (username, token) and printer serial are required.');
        }

        const brokerUrl = bambuCloudMqttUrl(this.printer, this.printer.print_host || 'us.mqtt.bambulab.com');
        report = {};
        const socket = new WebSocket(brokerUrl);
        ws = socket;
        handshakeTimer = setTimeout(() => {
          if (closed || ws !== socket) return;
          onError(new Error('Cloud MQTT did not answer in time.'));
          socket.close();
        }, 12_000);

        ws.onopen = () => {
          if (closed || ws !== socket) {
            socket.close();
            return;
          }
          socket.send(JSON.stringify({ type: 'connect', serial, username, token }));
        };

        ws.onmessage = (event) => {
          if (closed || ws !== socket) return;
          try {
            const msg = JSON.parse(event.data);
            if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
            if (msg.type === 'error') {
              onError(new Error(msg.message));
            } else if (msg.type === 'connected') {
              clearTimeout(handshakeTimer);
              // send get_version
              ws?.send(JSON.stringify({ type: 'publish', payload: { info: { sequence_id: '0', command: 'get_version' } } }));
              ws?.send(JSON.stringify({ type: 'publish', payload: { pushing: { sequence_id: '0', command: 'pushall' } } }));
            } else if (msg.type === 'report' && msg.payload) {
              const update = msg.payload.print;
              if (!update || typeof update !== 'object' || Array.isArray(update) ||
                  Object.keys(update).every(key => ['sequence_id', 'command', 'result', 'reason'].includes(key))) return;
              report = mergeBambuReport(report, update);
              const state = deriveBambuState(report);
              // Version/control replies cannot complete initial telemetry recovery.
              if (typeof report.gcode_state !== 'string' && state.heaters.length === 0) return;
              onState(state);
            }
          } catch {
            // ignore malformed reports
          }
        };

        ws.onclose = () => {
          if (ws !== socket) return;
          clearTimeout(handshakeTimer);
          if (!closed) {
            onError(new Error('Cloud MQTT disconnected. Reconnecting...'));
            clearTimeout(reconnectTimer);
            if (!closed) reconnectTimer = setTimeout(tryConnect, 3000);
          }
        };
        ws.onerror = () => {
          if (!closed && ws === socket) onError(new Error('Could not connect to cloud MQTT.'));
        };

      } catch (err) {
        if (!closed) onError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    tryConnect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(handshakeTimer);
      ws?.close();
    };
  }

  async test(): Promise<string> {
    const token = this.printer.printhost_apikey;
    const serial = this.printer.serial;

    if (!token || !serial) {
      throw new Error('Missing credentials or serial number for Bambu Cloud.');
    }

    try {
      const data = await cloudJson(this.printer, '/v1/iot-service/api/user/bind', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const device = Array.isArray(data.devices) ? data.devices.find((d: any) => d?.dev_id === serial) : undefined;
      if (!device) {
        throw new Error('Device not found or not bound to this account.');
      }
      return `Bambu Cloud configured (read-only). Connected to ${device.name || device.dev_id}.`;
    } catch (e) {
      throw new Error(`Cloud test failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async upload(_options: UploadOptions): Promise<void> {
    throw new Error('Cloud print is currently unsupported and read-only.');
  }
}
