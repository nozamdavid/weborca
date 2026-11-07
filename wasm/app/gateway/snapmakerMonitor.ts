/** Experimental, connection-scoped historical Snapmaker MQTT monitor. No account/session persistence.
 * Contract: docs/snapmaker-cloud-mqtt.md (pinned first-party client, not current Control internals).
 * Only authenticated fixed-API bootstrap can select a broker; callers never supply transport settings.
 */
import * as https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { Duplex, Transform } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity, connect as tlsConnect } from 'node:tls';
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import mqtt from 'mqtt';
import type { IClientOptions, MqttClient } from 'mqtt';
import { WebSocket, WebSocketServer } from 'ws';
import { configFromEnv } from './policy.ts';
import type { GatewayConfig } from './policy.ts';

export const SNAPMAKER_MONITOR_PATH = '/_printer/snapmaker-cloud/monitor';
const MAX_FRAME = 16 * 1024;
const MAX_UPSTREAM = 256 * 1024;
const MAX_SESSIONS = 16;
const RPC_TIMEOUT = 10_000;
const INITIAL_TIMEOUT = 30_000;
const QUERY_INTERVAL = 15_000;
const SERIAL = /^[A-Za-z0-9_-]{1,128}$/;
const CLIENT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const API_HOST = 'id.snapmaker.com';
const AUTH_CODES = new Set([401, 110002, 110003, 110004]);
const MESSAGES = {
  auth: 'Snapmaker authentication or device authorization was rejected.',
  unsupported: 'The Snapmaker monitoring configuration is unsupported.',
  upstream: 'Snapmaker monitoring could not reach the upstream service.',
  timeout: 'Snapmaker monitoring did not become ready in time.',
  stale: 'Snapmaker monitoring data is no longer fresh.'
} as const;
type ErrorCode = keyof typeof MESSAGES;
type Phase = 'device-list' | 'monitoring-credential' | 'dns' | 'broker-connection' | 'subscription' |
  'objects-list' | 'objects-subscribe' | 'subscribe-filter' | 'objects-query';
type Reason = 'http' | 'business' | 'malformed-response' | 'response-limit' | 'network' | 'dns-not-found' |
  'dns-temporary' | 'connection-refused' | 'connection-reset' | 'tls-certificate' | 'tls-protocol' |
  'mqtt-rejected' | 'subscription-rejected' | 'rpc-error' | 'timeout' | 'closed' | 'invalid-response' |
  'broker-host' | 'broker-port' | 'client-identity' | 'credential-invalid' | 'subscribe-topics' |
  'publish-topics' | 'device-response' | 'device-identity' | 'broker-address' | 'client-in-use' | 'object-response';
type Diagnostic = { phase: Phase; reason: Reason; code?: number };
const safeCode = (value: unknown): number | undefined => typeof value === 'number' &&
  Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : undefined;
function diagnostic(phase: Phase, reason: Reason, value?: unknown): Diagnostic {
  const code = safeCode(value);
  return { phase, reason, ...(code !== undefined ? { code } : {}) };
}
// Never forward messages, stacks or arbitrary Node identifiers across the socket.
function networkDiagnostic(phase: Phase, error: unknown): Diagnostic {
  const code = object(error) ? error.code : undefined;
  const reasons: Record<string, Reason> = {
    ENOTFOUND: 'dns-not-found', EAI_AGAIN: 'dns-temporary', ECONNREFUSED: 'connection-refused',
    ECONNRESET: 'connection-reset', ETIMEDOUT: 'timeout',
    CERT_HAS_EXPIRED: 'tls-certificate', CERT_NOT_YET_VALID: 'tls-certificate',
    ERR_TLS_CERT_ALTNAME_INVALID: 'tls-certificate', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls-certificate',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'tls-certificate', DEPTH_ZERO_SELF_SIGNED_CERT: 'tls-certificate',
    SELF_SIGNED_CERT_IN_CHAIN: 'tls-certificate', ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE: 'tls-protocol',
    ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION: 'tls-protocol'
  };
  if (phase === 'broker-connection' && typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255)
    return diagnostic(phase, 'mqtt-rejected', code);
  return diagnostic(phase, typeof code === 'string' && Object.hasOwn(reasons, code) ? reasons[code] : 'network');
}
class MonitorError extends Error {
  code: ErrorCode;
  diagnostic?: Diagnostic;
  constructor(code: ErrorCode, detail?: Diagnostic) { super(MESSAGES[code]); this.code = code; this.diagnostic = detail; }
}

// Noncredential ownership only. A returned client ID must remain unchanged; concurrent CONNECTs
// with that ID would evict each other. This lock covers all monitors in this process, not other apps.
const owners = new Set<string>();
let active = 0;

// Fixed first-party embedded Amazon Root CA 1; never accept bootstrap/browser CA material.
export const SNAPMAKER_ROOT_CA = `
-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF
ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6
b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJv
b3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXj
ca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM
9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qw
IFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6
VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L
93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQm
jgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUA
A4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDI
U5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUs
N+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vv
o/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU
5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpy
rqXRfboQnoZsG4q5WTP468SQvvG5
-----END CERTIFICATE-----
`;

// Reject special-use IPv4; accept IPv6 only in global unicast and exclude special-use ranges.
const excluded = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3]
] as const) excluded.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  excluded.addSubnet(address, prefix, 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
export function snapmakerPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !excluded.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !excluded.check(address, 'ipv6');
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function identity(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
}

function abortableLookup(resolve: () => Promise<string[]>, signal: AbortSignal): Promise<string[]> {
  return new Promise((accept, reject) => {
    const cancel = () => reject(new MonitorError('timeout'));
    if (signal.aborted) return cancel();
    signal.addEventListener('abort', cancel, { once: true });
    void resolve().then(accept, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
function alias(data: Record<string, unknown>, primary: string, fallback: string): unknown {
  return data[primary] !== undefined && data[primary] !== null && data[primary] !== '' ? data[primary] : data[fallback];
}

/** Actual bQW normalization uses parts[1] as key and retains the entire suffix value.
 * Accept exact known suffixes, including issued directional config/data forms;
 * full serial-prefixed topics and wildcards are not suffixes.
 * Requiring the used entries avoids guessed fallback topics, including the broken null/config path.
 */
function topicMap(value: unknown, allowed: string[], required: string[], reason: 'subscribe-topics' | 'publish-topics'): Record<string, string> {
  if (!Array.isArray(value) || value.length > 16) throw new MonitorError('unsupported', diagnostic('monitoring-credential', reason));
  const result: Record<string, string> = Object.create(null);
  for (const topic of value) {
    if (typeof topic !== 'string' || !allowed.some(name => topic === '/' + name)) throw new MonitorError('unsupported', diagnostic('monitoring-credential', reason));
    result[topic.split('/')[1]] = topic;
  }
  if (required.some(key => !result[key])) throw new MonitorError('unsupported', diagnostic('monitoring-credential', reason));
  return result;
}

export function parseSnapmakerBootstrap(value: unknown, serial: string) {
  if (!object(value)) throw new MonitorError('unsupported', diagnostic('monitoring-credential', 'invalid-response'));
  if (!SERIAL.test(serial)) throw new MonitorError('unsupported', diagnostic('device-list', 'device-identity'));
  const endpoint = alias(value, 'endpoint', 'ip');
  // An authenticated API response is the tenant authority. Limit dynamic destinations to the
  // AWS IoT data endpoint grammar (including the issued non-ATS form), not arbitrary
  // AWS hosts/services or bare IPs. Both forms still require strict fixed-root TLS below.
  if (typeof endpoint !== 'string' || endpoint.length > 253 ||
      !/^[a-z0-9]{6,64}(?:-ats)?\.iot\.[a-z]{2}-(?:[a-z]+-)?[a-z]+-\d\.amazonaws\.com$/.test(endpoint)) {
    throw new MonitorError('unsupported', diagnostic('monitoring-credential', 'broker-host'));
  }
  const port = value.port === undefined || value.port === null || value.port === '' ? 8883 : value.port;
  // 8883 is the source default and standard MQTT mTLS port; no evidence justifies 443/ALPN or others.
  if (port !== 8883 && port !== '8883') throw new MonitorError('unsupported', diagnostic('monitoring-credential', 'broker-port'));
  const clientId = alias(value, 'clientId', 'clientid');
  const cert = alias(value, 'cert', 'secretId');
  const key = alias(value, 'key', 'secretKey');
  if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) throw new MonitorError('unsupported', diagnostic('monitoring-credential', 'client-identity'));
  if (typeof cert !== 'string' || cert.length > 32 * 1024 ||
      typeof key !== 'string' || key.length > 32 * 1024) throw new MonitorError('unsupported', diagnostic('monitoring-credential', 'credential-invalid'));
  try {
    const certificate = new X509Certificate(cert);
    if (!certificate.checkPrivateKey(createPrivateKey(key)) ||
        Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw Error();
  } catch { throw new MonitorError('unsupported', diagnostic('monitoring-credential', 'credential-invalid')); }
  if (value.topics !== undefined && value.topics !== null && !object(value.topics)) throw new MonitorError('unsupported', diagnostic('monitoring-credential', 'invalid-response'));
  const topics = object(value.topics) ? value.topics : {};
  const sub = topicMap(topics.subscribe ?? value.subscribeTopics,
    ['response', 'status', 'notification', 'config', 'config/response', 'data', 'data/response', 'error'],
    ['response', 'status', 'notification', 'config'], 'subscribe-topics');
  const pub = topicMap(topics.publish ?? value.publishTopics,
    ['request', 'config', 'config/request', 'data', 'data/request'], ['request'], 'publish-topics');
  return { endpoint, port: 8883, clientId, cert, key, request: serial + pub.request,
    response: serial + sub.response, status: serial + sub.status, notification: serial + sub.notification,
    config: serial + sub.config + '/' + clientId };
}

/** Fixed URL, no redirects/cookies/ambient headers; only this connection's bearer and abort signal. */
async function apiRequest(path: '/api/user/device/list' | '/api/user/device/getMqttCert' | '/api/user/device/checkAuth',
  token: string, signal: AbortSignal, binding?: { deviceId: string; certId: string; sn: string }): Promise<unknown> {
  const phase: Phase = path.endsWith('/list') ? 'device-list' : 'monitoring-credential';
  const failure = (reason: Reason, code?: unknown) => new MonitorError('upstream', diagnostic(phase, reason, code));
  return new Promise((resolve, reject) => {
    const body = path.endsWith('/list') ? JSON.stringify({ name: null, mac: null, sn: null, productName: null, productCode: null, pageIndex: null, pageRows: null }) : undefined;
    const requestPath = path === '/api/user/device/checkAuth' ? path + '?' + new URLSearchParams(binding) : path;
    const req = https.request({ hostname: API_HOST, port: 443, method: body ? 'POST' : 'GET', path: requestPath,
      rejectUnauthorized: true, signal, headers: { authorization: 'Bearer ' + token, accept: 'application/json',
        'x-custom-site': 'WebOrca', os: 'WebOrca', 'device-type': 'WebOrca',
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) }
    }, res => {
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('error', error => reject(new MonitorError('upstream', networkDiagnostic(phase, error))));
      res.on('aborted', () => reject(failure('network')));
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_UPSTREAM) { reject(failure('response-limit')); res.destroy(); req.destroy(); }
        else chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) return reject(new MonitorError('auth', diagnostic(phase, 'http', res.statusCode)));
        if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) return reject(failure('http', res.statusCode));
        try {
          const envelope: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!object(envelope)) throw failure('malformed-response');
          const code = typeof envelope.code === 'string' && /^-?(0|[1-9][0-9]{0,9})$/.test(envelope.code)
            ? Number(envelope.code) : envelope.code;
          if (AUTH_CODES.has(Number(envelope.code))) throw new MonitorError('auth', diagnostic(phase, 'business', code));
          if (![0, 200, '0', '200'].includes(envelope.code as number)) throw failure('business', code);
          resolve(envelope.data);
        } catch (error) { reject(error instanceof MonitorError ? error : failure('malformed-response')); }
      });
    });
    req.on('error', error => reject(error instanceof MonitorError ? error : new MonitorError('upstream', networkDiagnostic(phase, error))));
    req.setTimeout(RPC_TIMEOUT, () => req.destroy(new MonitorError('upstream', diagnostic(phase, 'timeout'))));
    req.end(body);
  });
}

const FIELDS: Record<string, string[]> = {
  print_stats: ['filename', 'state', 'total_duration', 'print_duration', 'filament_used', 'message', 'info'],
  display_status: ['progress', 'message'], virtual_sdcard: ['progress', 'is_active'],
  heater_bed: ['temperature', 'target'],
  print_task_config: ['filament_vendor', 'filament_type', 'filament_sub_type', 'filament_exist', 'filament_color_rgba', 'filament_color']
};
const EXTRUDER_FIELDS = ['temperature', 'target', 'power', 'can_extrude', 'pressure_advance', 'smooth_time',
  'state', 'nozzle_diameter', 'nozzle_volume_type', 'extruder_index'];
type Objects = Record<string, Record<string, unknown>>;

export interface SnapmakerMonitorOptions extends GatewayConfig {
  /** Required in hosted mode. Local mode requires an explicit same-origin authority, loopback by default. */
  snapmakerMonitorOrigin?: string;
  /** Synthetic transport seams only; never set from browser input or environment. */
  snapmakerMonitorTest?: {
    lookup?: (host: string) => Promise<string[]>;
    connect?: (options: IClientOptions) => MqttClient;
    initialMs?: number;
    rpcMs?: number;
    queryMs?: number;
  };
}

/** Check MQTT remaining-length headers before mqtt-packet can buffer a large body. */
function boundedConnect(options: IClientOptions): MqttClient {
  return new mqtt.MqttClient(() => {
    const endpoint = options.servername!;
    const socket = tlsConnect({ host: options.host, port: options.port!, servername: endpoint,
      rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: SNAPMAKER_ROOT_CA,
      cert: options.cert, key: options.key,
      checkServerIdentity: (_host, cert) => checkServerIdentity(endpoint, cert) });
    let header = true;
    let length = 0;
    let multiplier = 1;
    let remaining = 0;
    let windowStart = Date.now();
    let packets = 0;
    let bytes = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      try {
        if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); packets = 0; bytes = 0; }
        if ((bytes += chunk.length) > 1024 * 1024) throw new MonitorError('upstream');
        for (const byte of chunk) {
          if (remaining) { remaining--; continue; }
          if (header) {
            // QoS 2 is outside our QoS 1 subscriptions. Reject before MQTT.js can
            // retain an incomplete delivery in its incoming store.
            if (++packets > 100 || ((byte >> 4) === 3 && (byte & 6) === 4)) throw new MonitorError('upstream');
            header = false; length = 0; multiplier = 1; continue;
          }
          length += (byte & 127) * multiplier;
          if (length > MAX_UPSTREAM || ((byte & 128) && multiplier >= 128 ** 3)) throw new MonitorError('upstream');
          if (byte & 128) { multiplier *= 128; continue; }
          remaining = length;
          header = true;
        }
        callback(null, chunk);
      } catch { callback(new MonitorError('upstream')); }
    } });
    const stream = new Duplex({
      read() { limit.resume(); },
      write(chunk, encoding, callback) { socket.write(chunk, encoding, callback); },
      final(callback) { socket.end(callback); },
      destroy(error, callback) { socket.destroy(); limit.destroy(); callback(error); }
    });
    limit.on('data', chunk => { if (!stream.push(chunk)) limit.pause(); });
    limit.on('end', () => stream.push(null));
    limit.on('error', error => stream.destroy(error));
    socket.on('error', error => stream.destroy(error));
    socket.on('close', () => stream.destroy());
    socket.pipe(limit);
    return stream;
  }, options);
}

function validOrigin(req: IncomingMessage, expected?: string): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !req.headers.host ||
      (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin')) return false;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.host !== req.headers.host || !['https:', 'http:'].includes(url.protocol)) return false;
    if (expected) return origin === expected;
    // Local gateway default: do not trust arbitrary Host+Origin pairs (DNS rebinding).
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

export function createSnapmakerMonitor(options: SnapmakerMonitorOptions = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    if (!(req.url ?? '').startsWith('/_printer/snapmaker-cloud/')) return false;
    const reject = (status: number) => {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`);
      return true;
    };
    const cloud = options.cloud ?? configFromEnv().cloud ?? '';
    if (!cloud.split(',').some(id => id.trim().toLowerCase() === 'snapmaker-cloud') || !validOrigin(req, options.snapmakerMonitorOrigin)) return reject(403);
    if (req.url !== SNAPMAKER_MONITOR_PATH || req.method !== 'GET' || req.headers['sec-websocket-protocol'] ||
        req.headers.authorization || req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) return reject(404);
    if (active >= MAX_SESSIONS) return reject(503);
    wss.handleUpgrade(req, socket, head, client => {
      active++;
      runMonitor(client, options);
    });
    return true;
  }
  return { handleUpgrade };
}

function runMonitor(client: WebSocket, options: SnapmakerMonitorOptions) {
  const abort = new AbortController();
  let stopped = false;
  let started = false;
  let ready = false;
  let phase: Phase | undefined;
  let broker: MqttClient | undefined;
  let owner = '';
  let id = 0;
  let fields: Record<string, string[]> = Object.create(null);
  let snapshot: Objects = Object.create(null);
  let queued: Objects[] = [];
  let queuedBytes = 0;
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; responded: boolean }>();
  const send = (frame: object) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > MAX_UPSTREAM) { cleanup(); client.terminate(); return; }
    client.send(JSON.stringify(frame));
  };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    active--;
    abort.abort();
    clearTimeout(initialTimer);
    clearInterval(heartbeat);
    clearTimeout(queryTimer);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new MonitorError('upstream')); }
    pending.clear();
    queued = [];
    queuedBytes = 0;
    snapshot = Object.create(null);
    fields = Object.create(null);
    const transport = broker;
    broker = undefined;
    if (transport) {
      // Keep ownership until the live transport has actually been destroyed.
      transport.end(true);
      transport.stream?.destroy();
      delete transport.options.cert;
      delete transport.options.key;
    }
    if (owner) { owners.delete(owner); owner = ''; }
  };
  const stop = (code?: ErrorCode, detail?: Diagnostic) => {
    if (stopped) return;
    if (code) send({ type: 'error', code, message: MESSAGES[code], ...(detail ? { diagnostic: detail } : {}) });
    send({ type: 'connection', state: 'disconnected' });
    cleanup();
    client.close(code ? 1008 : 1000);
    closeTimer = setTimeout(() => client.terminate(), 1000);
    closeTimer.unref();
  };
  const initialTimer = setTimeout(() => stop('timeout', phase ? diagnostic(phase, 'timeout') : undefined), options.snapmakerMonitorTest?.initialMs ?? INITIAL_TIMEOUT);
  let alive = true;
  const heartbeat = setInterval(() => {
    if (!alive) return stop('stale');
    alive = false;
    if (client.readyState === WebSocket.OPEN) client.ping();
  }, 20_000);
  client.on('pong', () => { alive = true; });
  client.on('close', () => { cleanup(); clearTimeout(closeTimer); });
  client.on('error', () => stop('upstream'));

  const filtered = (value: unknown, detail?: Diagnostic): Objects => {
    if (!object(value)) throw new MonitorError('upstream', detail);
    const result: Objects = Object.create(null);
    for (const [name, names] of Object.entries(fields)) {
      const source = value[name];
      if (source === undefined) continue;
      if (name === 'print_task_config' && (source === null || source === false ||
          (Array.isArray(source) && source.length === 0))) {
        result[name] = Object.fromEntries(names.map(field => [field, null]));
        continue;
      }
      if (!object(source)) throw new MonitorError('upstream', detail);
      const item: Record<string, unknown> = Object.create(null);
      for (const name of names) if (Object.hasOwn(source, name)) item[name] = source[name];
      if (Object.keys(item).length) result[name] = item;
    }
    return result;
  };
  const merge = (objects: Objects) => {
    for (const [name, item] of Object.entries(objects)) snapshot[name] = { ...snapshot[name], ...item };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_UPSTREAM) throw new MonitorError('upstream');
  };

  async function connect(token: string, deviceId: string) {
    let config: ReturnType<typeof parseSnapmakerBootstrap> | undefined;
    const failed = (error: unknown) => stop(error instanceof MonitorError ? error.code : 'upstream',
      error instanceof MonitorError ? error.diagnostic
        : phase ? networkDiagnostic(phase, error) : undefined);
    try {
      phase = 'device-list';
      const devices = await apiRequest('/api/user/device/list', token, abort.signal);
      if (stopped) return;
      if (!Array.isArray(devices) || devices.length > 1000) throw new MonitorError('unsupported', diagnostic('device-list', 'device-response'));
      const selected = devices.filter(device => object(device) && identity(device.deviceId) === deviceId);
      if (selected.length !== 1 || !object(selected[0]) || !SERIAL.test(identity(selected[0].sn))) throw new MonitorError('auth', diagnostic('device-list', 'device-identity'));
      const serial = identity(selected[0].sn);
      if (devices.filter(device => object(device) && identity(device.sn) === serial).length !== 1) throw new MonitorError('unsupported', diagnostic('device-list', 'device-identity'));
      phase = 'monitoring-credential';
      const bootstrap = await apiRequest('/api/user/device/getMqttCert', token, abort.signal);
      if (stopped) return;
      config = parseSnapmakerBootstrap(bootstrap, serial);
      // Historical WAN bootstrap authorizes this device with the unchanged issued client ID.
      // Reuse the credential phase; only the success envelope matters, never response data.
      try {
        await apiRequest('/api/user/device/checkAuth', token, abort.signal,
          { deviceId: identity(selected[0].deviceId), certId: config.clientId, sn: serial });
      } finally { token = ''; }
      if (stopped) return;
      const endpoint = config.endpoint;
      const resolver = options.snapmakerMonitorTest?.lookup ?? (async (host: string) => (await lookup(host, { all: true })).map(item => item.address));
      phase = 'dns';
      const addresses = await abortableLookup(() => resolver(endpoint), abort.signal);
      if (stopped) return;
      if (!addresses.length || addresses.length > 16 || addresses.some(address => !snapmakerPublicAddress(address))) throw new MonitorError('unsupported', diagnostic('dns', 'broker-address'));
      owner = createHash('sha256').update(config.endpoint + '\0' + config.clientId).digest('hex');
      if (owners.has(owner)) { owner = ''; throw new MonitorError('unsupported', diagnostic('broker-connection', 'client-in-use')); }
      owners.add(owner);
      phase = 'broker-connection';
      broker = (options.snapmakerMonitorTest?.connect ?? boundedConnect)({
        protocol: 'mqtts', host: addresses[0], port: config.port, servername: endpoint,
        rejectUnauthorized: true, ca: SNAPMAKER_ROOT_CA,
        cert: config.cert, key: config.key, clientId: config.clientId,
        clean: false, keepalive: 30, reconnectPeriod: 0, connectTimeout: RPC_TIMEOUT,
        resubscribe: false, queueQoSZero: false, protocolVersion: 4
      });
      const topics = { request: config.request, response: config.response, status: config.status,
        notification: config.notification, config: config.config };
      config = undefined;
      const rpc = (method: string, rpcPhase: Phase, params?: object): Promise<unknown> => new Promise((resolve, reject) => {
        phase = rpcPhase;
        if (stopped || !broker || pending.size || id >= 1_000_000) return reject(new MonitorError('upstream'));
        const requestId = ++id;
        let acknowledged = false;
        let responseReady = false;
        let result: unknown;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new MonitorError(ready ? 'stale' : 'timeout', diagnostic(rpcPhase, 'timeout')));
        }, options.snapmakerMonitorTest?.rpcMs ?? RPC_TIMEOUT);
        const complete = () => {
          if (!acknowledged || !responseReady || stopped) return;
          clearTimeout(timer);
          pending.delete(requestId);
          resolve(result);
        };
        pending.set(requestId, { timer, responded: false,
          resolve: value => { result = value; responseReady = true; complete(); },
          reject: error => { clearTimeout(timer); pending.delete(requestId); reject(error); }
        });
        broker.publish(topics.request, JSON.stringify({ jsonrpc: '2.0', id: requestId, method, ...(params ? { params } : {}) }), { qos: 1, retain: false }, error => {
          if (stopped || !pending.has(requestId)) return;
          if (error) return failed(error);
          acknowledged = true;
          complete();
        });
      });
      const query = async () => {
        const result = await rpc('printer.objects.query', 'objects-query', { objects: fields });
        if (stopped) return;
        if (!object(result)) throw new MonitorError('upstream', diagnostic('objects-query', 'object-response'));
        const objects = filtered(result.status, diagnostic('objects-query', 'object-response'));
        if (!Object.keys(objects).length) throw new MonitorError(ready ? 'stale' : 'unsupported', diagnostic('objects-query', 'object-response'));
        if (!ready) {
          snapshot = objects;
          for (const delta of queued) merge(delta);
          queued = [];
          queuedBytes = 0;
          ready = true;
          clearTimeout(initialTimer);
          send({ type: 'snapshot', objects: snapshot });
        } else {
          merge(objects);
          send({ type: 'delta', objects });
        }
        if (!stopped) queryTimer = setTimeout(() => void query().catch(failed), options.snapmakerMonitorTest?.queryMs ?? QUERY_INTERVAL);
      };
      broker.on('error', failed);
      broker.on('close', () => ready ? stop() : stop('upstream', phase ? diagnostic(phase, 'closed') : undefined));
      broker.on('message', (topic, payload, packet) => {
        if (stopped) return;
        try {
          if (payload.length > MAX_UPSTREAM) throw new MonitorError('upstream');
          if (![topics.response, topics.status, topics.notification].includes(topic) || packet.retain) return;
          const value: unknown = JSON.parse(payload.toString('utf8'));
          if (!object(value) || value.jsonrpc !== '2.0') return;
          if (Object.hasOwn(value, 'id')) {
            if (topic !== topics.response || typeof value.id !== 'number' || !Number.isSafeInteger(value.id)) return;
            const entry = pending.get(value.id);
            if (!entry || entry.responded) return;
            entry.responded = true;
            if (Object.hasOwn(value, 'error')) {
              if (object(value.error) && value.error.code === -32601 && (id === 2 || id === 3)) entry.resolve(null);
              else entry.reject(new MonitorError('upstream', phase ? diagnostic(phase, 'rpc-error', object(value.error) ? value.error.code : undefined) : undefined));
            } else entry.resolve(value.result);
          } else if (value.method === 'notify_status_update' && Array.isArray(value.params) && value.params.length === 2 &&
              typeof value.params[1] === 'number' && Number.isFinite(value.params[1])) {
            const objects = filtered(value.params[0]);
            if (!Object.keys(objects).length) return;
            if (!ready) {
              queuedBytes += Buffer.byteLength(JSON.stringify(objects));
              if (queued.length >= 32 || queuedBytes > MAX_UPSTREAM) throw new MonitorError('upstream');
              queued.push(objects);
            } else { merge(objects); send({ type: 'delta', objects }); }
          }
        } catch (error) { failed(error); }
      });
      broker.once('connect', () => {
        void (async () => {
          phase = 'subscription';
          for (const topic of [topics.status, topics.response, topics.notification, topics.config]) {
            if (stopped || !broker) return;
            await new Promise<void>((resolve, reject) => broker!.subscribe(topic, { qos: 1 }, (error, granted) => {
              if (error || !granted?.length || granted.some(item => item.qos !== 1)) reject(new MonitorError('upstream',
                diagnostic('subscription', 'subscription-rejected', granted?.find(item => item.qos !== 1)?.qos)));
              else resolve();
            }));
          }
          const listed = await rpc('printer.objects.list', 'objects-list');
          if (!object(listed) || !Array.isArray(listed.objects) || listed.objects.length > 256 || listed.objects.some(name => typeof name !== 'string')) throw new MonitorError('unsupported', diagnostic('objects-list', 'object-response'));
          for (const name of new Set(listed.objects as string[])) {
            if (Object.hasOwn(FIELDS, name)) fields[name] = FIELDS[name];
            else if (/^extruder(?:[0-9]{1,2})?$/.test(name)) fields[name] = EXTRUDER_FIELDS;
          }
          if (!Object.keys(fields).length || Object.keys(fields).length > 20) throw new MonitorError('unsupported', diagnostic('objects-list', 'object-response'));
          await rpc('printer.objects.subscribe', 'objects-subscribe', { objects: fields });
          await rpc('printer.objects.setSubscribeFilter', 'subscribe-filter', { objects: fields, sn: serial });
          await query();
        })().catch(failed);
      });
    } catch (error) { if (!stopped) failed(error); }
    finally { token = ''; config = undefined; }
  }

  client.on('message', (data, binary) => {
    if (stopped) return;
    if (started || binary || data.toString().length > MAX_FRAME) return stop('unsupported');
    started = true;
    try {
      const value: unknown = JSON.parse(data.toString());
      if (!object(value) || Object.keys(value).length !== 3 || value.type !== 'connect' ||
          typeof value.accessToken !== 'string' || value.accessToken.length > 8192 ||
          !/^[A-Za-z0-9._~+\/-]+=*$/.test(value.accessToken) ||
          typeof value.deviceId !== 'string' || !SERIAL.test(value.deviceId)) return stop('auth');
      send({ type: 'connection', state: 'connecting' });
      void connect(value.accessToken, value.deviceId);
    } catch { stop('unsupported'); }
  });
}
