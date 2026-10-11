import { bambuCloudApiUrl, bambuCloudMqttUrl } from './gatewayUrl';
import { deriveBambuState, mergeBambuReport } from './bambu';
import type { PhysicalPrinter, PrinterApi, PrinterState, ConnectOptions, UploadOptions } from './types';

export interface BambuCloudDevice { dev_id: string; name: string }

async function cloudJson(printer: PhysicalPrinter, path: string, init: RequestInit = {}): Promise<any> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const response = await fetch(bambuCloudApiUrl(printer, path), { ...init, signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.message || `Cloud API answered ${response.status}.`);
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
  const headers = { authorization: `Bearer ${login.accessToken}` };
  const preference = await cloudJson(printer, '/v1/design-user-service/my/preference', { headers, signal });
  if (!/^\d+$/.test(String(preference.uid ?? ''))) throw new Error('The cloud account did not return a valid user ID.');
  const bound = await cloudJson(printer, '/v1/iot-service/api/user/bind', { headers, signal });
  if (!Array.isArray(bound.devices)) throw new Error('The cloud account did not return a device list.');
  const devices: BambuCloudDevice[] = bound.devices.filter((device: any) =>
    device && typeof device.dev_id === 'string' && /^[A-Za-z0-9_-]+$/.test(device.dev_id)
  ).map((device: any) => ({ dev_id: device.dev_id, name: typeof device.name === 'string' ? device.name : device.dev_id }));
  return { token: login.accessToken as string, username: `u_${preference.uid}`, devices };
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
              const update = msg.payload.print ?? msg.payload;
              report = mergeBambuReport(report, update);
              const state = deriveBambuState(report);
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
            reconnectTimer = setTimeout(tryConnect, 3000);
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
