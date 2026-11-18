/**
 * Printer gateway: a same-origin bridge between the web app and printers on the user's network.
 *
 * A browser cannot talk to most printers directly: Moonraker only sends CORS headers for a short list of
 * origins and checks the Origin of websockets, an https page cannot call http printers, and Bambu Lab needs
 * raw MQTT/FTPS. The gateway runs inside the Vite dev/preview server and exposes:
 *
 *   GET  /_printer/status                         { enabled, mode, readOnly }
 *   ANY  /_printer/<http|https>/<host[:port]>/... streaming reverse proxy
 *   WS   /_printer/<ws|wss>/<host[:port]>/...     websocket relay
 *   WS   /_printer/bambu/mqtt/<host[:port]>       Bambu MQTT bridge (see handleBambuMqtt)
 *   POST /_printer/bambu/ftp/<host>               Bambu FTPS upload
 *
 * It is OFF unless ORCA_PRINTER_PROXY is set, and ORCA_PRINTER_PROXY_READONLY=1 refuses everything that could
 * change a printer. See gateway/policy.ts for the rules and PRINTERS.md for the security model.
 */
import { handleCrealityCloudRequest } from './gateway/crealityCloud.ts';
import type { CrealityCloudGatewayOptions } from './gateway/crealityCloud.ts';
import { handleSnapmakerCloudRequest } from './gateway/snapmakerCloud.ts';
import type { SnapmakerCloudGatewayOptions } from './gateway/snapmakerCloud.ts';
import { createSnapmakerMonitor } from './gateway/snapmakerMonitor.ts';
import type { SnapmakerMonitorOptions } from './gateway/snapmakerMonitor.ts';
import { handlePrusaConnectRequest } from './gateway/prusaConnect.ts';
import type { PrusaConnectGatewayOptions } from './gateway/prusaConnect.ts';
import { handleBambuCloudApi } from './gateway/bambuCloud.ts';
import type { BambuCloudGatewayOptions } from './gateway/bambuCloud.ts';
import * as ftp from 'basic-ftp';
import * as http from 'node:http';
import * as https from 'node:https';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Duplex } from 'node:stream';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CLOUD_SERVICES, GATEWAY_OFF_MESSAGE, GatewayError, bambuRequestAllowed, bambuRequestAllowedInReadOnly, checkRpcFrame, configFromEnv,
  digestAuthorization, httpAllowedInReadOnly, parseDigestChallenge, resolveTarget,
  isPrivateAddress
} from './gateway/policy.ts';
import type { DigestChallenge, GatewayConfig, Resolver, Target } from './gateway/policy.ts';

export interface GatewayOptions extends GatewayConfig, CrealityCloudGatewayOptions, PrusaConnectGatewayOptions, BambuCloudGatewayOptions, SnapmakerCloudGatewayOptions, SnapmakerMonitorOptions {
  /** Replaces DNS lookups (tests). */
  resolver?: Resolver;
  /** Where Bambu printers listen (tests point this at a local broker). */
  bambu?: { mqttPort?: number; mqttProtocol?: 'mqtt' | 'mqtts'; ftpPort?: number; ftpSecure?: boolean | 'implicit' };
}

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade'];
const NOT_FORWARDED = ['host', 'origin', 'referer', 'cookie', 'x-orca-auth', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-http-method-override', 'x-method-override', 'x-http-method'];
const UPSTREAM_IDLE_MS = 60_000;
const MAX_QUEUED_WS_FRAMES = 200;

const BAMBU_CLOUD_MQTT_HOSTS = new Set([
  'cn.mqtt.bambulab.com',
  'us.mqtt.bambulab.com',
  'mqtt.bambu-lab.com',
]);


function fail(res: http.ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(message);
}

function errorMessage(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === 'ECONNREFUSED') return 'The printer refused the connection.';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'The printer is unreachable.';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'The printer did not answer in time.';
  return message;
}

function hostHeader(target: Target, defaultPort: number): string {
  return target.port === defaultPort ? target.host : `${target.host}:${target.port}`;
}

function bracketed(address: string): string {
  return address.includes(':') ? `[${address}]` : address;
}

// ---------------------------------------------------------------------------------------------
// HTTP reverse proxy
// ---------------------------------------------------------------------------------------------

/** Digest credentials the client asked us to use (header `x-orca-auth: digest user:password`), with the nonce cache. */
const digestNonces = new Map<string, { challenge: DigestChallenge; count: number }>();

function parseDigestCredentials(header: string | string[] | undefined): { user: string; password: string } | undefined {
  const m = typeof header === 'string' ? /^digest\s+([^:]*):(.*)$/i.exec(header) : null;
  return m ? { user: m[1], password: m[2] } : undefined;
}

function upstreamRequest(
  scheme: 'http' | 'https', target: Target, method: string, path: string, headers: http.OutgoingHttpHeaders
): http.ClientRequest {
  const defaultPort = scheme === 'https' ? 443 : 80;
  const options: https.RequestOptions = {
    host: target.address,
    port: target.port,
    method,
    path,
    headers: { ...headers, host: hostHeader(target, defaultPort) },
    timeout: UPSTREAM_IDLE_MS
  };
  if (scheme === 'https') {
    // Printers use self-signed certificates; the target is already restricted by the address policy.
    options.rejectUnauthorized = false;
    if (!target.host.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(target.host)) options.servername = target.host;
    return https.request(options);
  }
  return http.request(options);
}

/** Fetches the Digest challenge of a printer with a throwaway GET. */
function fetchDigestChallenge(scheme: 'http' | 'https', target: Target): Promise<DigestChallenge | undefined> {
  return new Promise((resolve) => {
    const probe = upstreamRequest(scheme, target, 'GET', '/api/version', {});
    probe.on('response', (res) => {
      res.resume();
      resolve(parseDigestChallenge(res.headers['www-authenticate']));
    });
    probe.on('error', () => resolve(undefined));
    probe.on('timeout', () => probe.destroy());
    probe.end();
  });
}

async function digestHeader(
  scheme: 'http' | 'https', target: Target, creds: { user: string; password: string }, method: string, path: string
): Promise<string | undefined> {
  const key = `${scheme}://${target.hostPort}`;
  let entry = digestNonces.get(key);
  if (!entry) {
    const challenge = await fetchDigestChallenge(scheme, target);
    if (!challenge) return undefined;
    entry = { challenge, count: 0 };
    digestNonces.set(key, entry);
  }
  entry.count += 1;
  return digestAuthorization(entry.challenge, creds.user, creds.password, method, path, entry.count);
}

/** How the response of a proxied printer is adjusted for the browser that asked. */
export interface ProxyMode {
  /** The printer's own web UI, shown in an iframe of the (cross-origin isolated) app: drop framing headers, opt in to COEP. */
  ui?: boolean;
  /** The origin the gateway answers on, to point redirects of the printer back at it. */
  ownOrigin?: string;
}

/** Validate the browser's two-part FormData while spooling, before connecting upstream. */
async function readUpload(req: http.IncomingMessage, config: GatewayConfig) {
  const limit = config.uploadMaxBytes ?? 1024 ** 3;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8 * 1024 ** 3) {
    throw new GatewayError(503, 'Upload byte limit must be an integer from 1 to 8589934592.');
  }
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    req.resume();
    throw new GatewayError(413, 'Upload exceeds the configured byte limit.');
  }
  const type = req.headers['content-type'];
  const match = typeof type === 'string' ? /^multipart\/form-data;\s*boundary=(?:"([A-Za-z0-9_-]{1,70})"|([A-Za-z0-9_-]{1,70}))$/i.exec(type) : null;
  const invalid = () => { throw new GatewayError(400, 'Invalid plain-upload multipart body.'); };
  const refused = () => { throw new GatewayError(403, 'Read-only mode: only a plain G-code upload is allowed.'); };
  if (!match || req.headers['content-encoding'] || req.headers.trailer) return invalid();
  const boundary = match![1] ?? match![2];
  const first = Buffer.from(`--${boundary}\r\n`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  let pending: Buffer = Buffer.alloc(0);
  let state: string = 'first';
  let field = '';
  let root: Buffer = Buffer.alloc(0);
  const fields = new Set<string>();
  let bytes = 0;
  const value = (data: Buffer) => {
    if (field === 'root') {
      if (root.length + data.length > 6) return refused();
      root = Buffer.concat([root, data]);
    }
  };
  const inspect = (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (true) {
      if (state === 'first') {
        if (pending.length < first.length) return;
        if (!pending.subarray(0, first.length).equals(first)) return invalid();
        pending = pending.subarray(first.length);
        state = 'headers';
      } else if (state === 'headers') {
        const end = pending.indexOf('\r\n\r\n');
        if (end < 0) { if (pending.length > 4096) invalid(); return; }
        if (end > 4096) return invalid();
        const header = pending.subarray(0, end).toString('utf8');
        const disposition = /^Content-Disposition: form-data; name="([^"\r\n]+)"(?:; filename="([^"\r\n]*)")?(?:\r\nContent-Type: application\/octet-stream)?$/i.exec(header);
        if (!disposition) return invalid();
        const [, name, filename] = disposition!;
        if (fields.has(name) || !['root', 'file'].includes(name)) return refused();
        if (name === 'root' ? filename !== undefined : !filename || Buffer.byteLength(filename) > 255 || !/^[^/\\%\x00-\x1f\x7f]+\.gcode$/i.test(filename) || filename === '..gcode') return refused();
        fields.add(name);
        field = name;
        pending = pending.subarray(end + 4);
        state = 'body';
      } else if (state === 'body') {
        const end = pending.indexOf(separator);
        if (end < 0) {
          const count = Math.max(0, pending.length - separator.length);
          value(pending.subarray(0, count));
          pending = Buffer.from(pending.subarray(count));
          return;
        }
        value(pending.subarray(0, end));
        if (field === 'root' && !root.equals(Buffer.from('gcodes'))) return refused();
        pending = pending.subarray(end + separator.length);
        state = 'suffix';
      } else if (state === 'suffix') {
        if (pending.length < 2) return;
        const suffix = pending.subarray(0, 2).toString('ascii');
        if (suffix !== '--' && suffix !== '\r\n') return invalid();
        pending = pending.subarray(2);
        state = suffix === '--' ? 'end' : 'headers';
      } else {
        if (pending.length > 2 || !Buffer.from('\r\n').subarray(0, pending.length).equals(pending)) return invalid();
        return;
      }
    }
  };
  const directory = await mkdtemp(join(tmpdir(), 'orca-upload-'));
  const path = join(directory, 'body');
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const file = await open(path, 'wx', 0o600);
    const timeout = () => req.destroy(new Error('Upload body timed out.'));
    req.setTimeout(60_000, timeout);
    try {
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > limit) throw new GatewayError(413, 'Upload exceeds the configured byte limit.');
        inspect(chunk);
        await file.writeFile(chunk);
      }
      if (state !== 'end' || (pending.length !== 0 && pending.length !== 2)) invalid();
      if (fields.size !== 2 || !root.equals(Buffer.from('gcodes'))) refused();
    } finally {
      req.setTimeout(0);
      req.off('timeout', timeout);
      await file.close();
    }
    return { path, bytes, cleanup };
  } catch (err) {
    req.resume();
    await cleanup();
    throw err;
  }
}

async function handleProxy(
  req: http.IncomingMessage, res: http.ServerResponse, scheme: 'http' | 'https', hostPort: string, path: string,
  options: GatewayOptions, mode: ProxyMode = {}
) {
  const config = { ...configFromEnv(), ...options };
  const target = await resolveTarget(hostPort, scheme === 'https' ? 443 : 80, config, options.resolver);
  const method = req.method ?? 'GET';
  const override = req.headers['x-http-method-override'] ?? req.headers['x-method-override'] ?? req.headers['x-http-method'];
  const effectiveMethod = (typeof override === 'string' ? override : Array.isArray(override) ? override[0] : method).trim();
  let uploadBody: Awaited<ReturnType<typeof readUpload>> | undefined;
  if (config.readOnly && (!httpAllowedInReadOnly(method, path) || !httpAllowedInReadOnly(effectiveMethod, path))) {
    if (!config.allowUpload || method !== 'POST' || path !== '/server/files/upload' || override !== undefined || !config.proxy || !isPrivateAddress(target.address)) {
      throw new GatewayError(403, 'Read-only mode: this request could change the printer.');
    }
    uploadBody = await readUpload(req, config);
  }

  try {
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.includes(name) && !NOT_FORWARDED.includes(name)) headers[name] = value;
    }
    if (uploadBody) {
      delete headers['transfer-encoding'];
      headers['content-length'] = uploadBody.bytes;
      delete headers.expect;
    }
    const creds = parseDigestCredentials(req.headers['x-orca-auth']);
    if (creds) {
      const authorization = await digestHeader(scheme, target, creds, method, path);
      if (authorization) headers.authorization = authorization;
    }

    const upstream = upstreamRequest(scheme, target, method, path, headers);
    upstream.on('response', (up) => {
      // A rejected Digest nonce is probably stale: drop it so the next request asks for a new challenge.
      if (up.statusCode === 401 && creds) digestNonces.delete(`${scheme}://${target.hostPort}`);
      const out: http.OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(up.headers)) {
        if (!HOP_BY_HOP.includes(name) && name !== 'set-cookie') out[name] = value;
      }
      if (mode.ui) {
        delete out['x-frame-options'];
        delete out['content-security-policy'];
        delete out['content-security-policy-report-only'];
        out['cross-origin-embedder-policy'] = 'require-corp';
        out['cross-origin-resource-policy'] = 'cross-origin';
        if (typeof out.location === 'string' && mode.ownOrigin) out.location = out.location.replace(`${scheme}://${hostPort}`, mode.ownOrigin);
      }
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
      up.on('error', () => res.destroy());
    });
    upstream.on('timeout', () => upstream.destroy(new Error('The printer did not answer in time.')));
    upstream.on('error', (err) => fail(res, 502, errorMessage(err)));
    res.on('close', () => upstream.destroy());
    if (uploadBody) await pipeline(createReadStream(uploadBody.path), upstream);
    else req.pipe(upstream);

  } finally {
    await uploadBody?.cleanup();
  }
}

// ---------------------------------------------------------------------------------------------
// Websocket relay (Moonraker, OctoPrint push, ...)
// ---------------------------------------------------------------------------------------------

function relayWebSocket(
  wss: WebSocketServer, req: http.IncomingMessage, socket: Duplex, head: Buffer, scheme: 'ws' | 'wss', target: Target, path: string,
  readOnly: boolean
) {
  wss.handleUpgrade(req, socket, head, (client) => {
    const defaultPort = scheme === 'wss' ? 443 : 80;
    const upstream = new WebSocket(`${scheme}://${bracketed(target.address)}:${target.port}${path}`, {
      headers: { host: hostHeader(target, defaultPort) },
      rejectUnauthorized: false,
      handshakeTimeout: 15_000
    });
    const queued: Array<{ data: Buffer; isBinary: boolean }> = [];

    const closeBoth = (reason: string) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ orca_gateway_error: reason }));
      client.close(1011, reason.slice(0, 120));
      upstream.terminate();
    };

    client.on('message', (data, isBinary) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
      if (readOnly) {
        const verdict = isBinary ? { forward: false, replies: [] } : checkRpcFrame(frame.toString('utf8'));
        for (const reply of verdict.replies) client.send(reply);
        if (!verdict.forward) return;
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(frame, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING && queued.length < MAX_QUEUED_WS_FRAMES) queued.push({ data: frame, isBinary });
    });
    upstream.on('open', () => {
      for (const { data, isBinary } of queued.splice(0)) upstream.send(data, { binary: isBinary });
    });
    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstream.on('error', (err) => closeBoth(errorMessage(err)));
    upstream.on('close', () => client.close());
    client.on('close', () => upstream.terminate());
    client.on('error', () => upstream.terminate());
  });
}

// ---------------------------------------------------------------------------------------------
// Bambu Lab LAN mode
// ---------------------------------------------------------------------------------------------

const SERIAL = /^[A-Za-z0-9]{6,32}$/;

/**
 * MQTT bridge. The client opens the websocket, then sends `{type:'connect', serial, accessCode}`.
 * The bridge answers `{type:'connected'}`, forwards printer reports as `{type:'report', payload}` and
 * publishes `{type:'publish', payload}` to device/<serial>/request. Clients cannot choose topics.
 */
function handleBambuMqtt(wss: WebSocketServer, req: http.IncomingMessage, socket: Duplex, head: Buffer, target: Target, options: GatewayOptions) {
  const readOnly = !!{ ...configFromEnv(), ...options }.readOnly;
  wss.handleUpgrade(req, socket, head, (client) => {
    let broker: MqttClient | undefined;
    let serial = '';
    const send = (message: object) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(message));
    const authTimeout = setTimeout(() => client.close(1008, 'No connect message'), 10_000);

    client.on('message', (data) => {
      let message: { type?: string; serial?: string; accessCode?: string; payload?: unknown };
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message.type === 'connect' && !broker) {
        clearTimeout(authTimeout);
        if (!message.serial || !SERIAL.test(message.serial) || !message.accessCode) {
          send({ type: 'error', message: 'A serial number and access code are required.' });
          client.close(1008);
          return;
        }
        serial = message.serial;
        const protocol = options.bambu?.mqttProtocol ?? (target.port === 8883 ? 'mqtts' : 'mqtt');
        const port = options.bambu?.mqttPort ?? target.port;
        broker = mqtt.connect({
          protocol,
          host: target.address,
          port,
          username: 'bblp',
          password: message.accessCode,
          rejectUnauthorized: false,
          clientId: `orca_web_${Math.random().toString(16).slice(2, 10)}`,
          reconnectPeriod: 0,
          connectTimeout: 10_000
        });
        broker.on('connect', () => {
          broker!.subscribe(`device/${serial}/report`, (err) => {
            if (err) return send({ type: 'error', message: err.message });
            send({ type: 'connected' });
            // Ask for a full status report; both requests are read-only.
            broker!.publish(`device/${serial}/request`, JSON.stringify({ info: { sequence_id: '0', command: 'get_version' } }));
            broker!.publish(`device/${serial}/request`, JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }));
          });
        });
        broker.on('message', (_topic, payload) => {
          try {
            send({ type: 'report', payload: JSON.parse(payload.toString()) });
          } catch {
            /* ignore malformed reports */
          }
        });
        broker.on('error', (err) => {
          send({ type: 'error', message: errorMessage(err) });
          client.close(1011);
        });
        broker.on('close', () => client.close());
      } else if (message.type === 'publish' && broker?.connected) {
        if (readOnly && !bambuRequestAllowedInReadOnly(message.payload)) {
          send({ type: 'error', message: 'Refused by the printer gateway in read-only mode' });
          return;
        }
        if (!bambuRequestAllowed(message.payload)) {
          send({ type: 'error', message: 'Refused: command not allowed by gateway policy' });
          return;
        }
        broker.publish(`device/${serial}/request`, JSON.stringify(message.payload));
      }
    });
    const cleanup = () => {
      clearTimeout(authTimeout);
      broker?.end(true);
    };
    client.on('close', cleanup);
    client.on('error', cleanup);
  });
}

const FTP_NAME = /^[\w .()+-]+\.(gcode|3mf)$/i;

async function handleBambuFtp(req: http.IncomingMessage, res: http.ServerResponse, hostPort: string, options: GatewayOptions) {
  const config = { ...configFromEnv(), ...options };
  const target = await resolveTarget(hostPort, 990, config, options.resolver);
  if (req.method !== 'POST') throw new GatewayError(405, 'POST only');
  if (config.readOnly) throw new GatewayError(403, 'Read-only mode: uploads are refused.');
  const name = decodeURIComponent(String(req.headers['x-bambu-filename'] ?? ''));
  const accessCode = String(req.headers['x-bambu-access-code'] ?? '');
  if (!FTP_NAME.test(name)) throw new GatewayError(400, 'The file name must be a plain .gcode or .3mf name.');
  if (!accessCode) throw new GatewayError(400, 'The access code is required.');

  const client = new ftp.Client(60_000);
  try {
    await client.access({
      host: target.address,
      port: options.bambu?.ftpPort ?? 990,
      user: 'bblp',
      password: accessCode,
      secure: options.bambu?.ftpSecure ?? 'implicit',
      secureOptions: { rejectUnauthorized: false }
    });
    await client.uploadFrom(req, name);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    throw new GatewayError(502, `FTP upload failed: ${errorMessage(err)}`);
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------------------------


function handleBambuCloudMqtt(wss: WebSocketServer, req: http.IncomingMessage, socket: Duplex, head: Buffer, brokerHost: string, options: GatewayOptions) {
  if (!(options.cloud ?? configFromEnv().cloud ?? '').split(',').map(value => value.trim()).includes('bambu-cloud')) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\nBambu Cloud is not enabled on this gateway.');
    return;
  }
  if (!BAMBU_CLOUD_MQTT_HOSTS.has(brokerHost)) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\nInvalid cloud MQTT broker');
    return;
  }

  wss.handleUpgrade(req, socket, head, (client) => {
    let broker: MqttClient | undefined;
    let serial = '';
    const send = (message: object) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(message));
    const authTimeout = setTimeout(() => client.close(1008, 'No connect message'), 10_000);

    client.on('message', (data) => {
      let message: { type?: string; serial?: string; username?: string; token?: string; payload?: unknown };
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;

      if (message.type === 'connect' && !broker) {
        clearTimeout(authTimeout);
        if (typeof message.serial !== 'string' || !/^[A-Za-z0-9_-]+$/.test(message.serial) ||
            typeof message.username !== 'string' || !message.username || typeof message.token !== 'string' || !message.token) {
          send({ type: 'error', message: 'Serial, username, and token required for cloud MQTT.' });
          client.close(1008);
          return;
        }
        serial = message.serial;
        broker = mqtt.connect({
          protocol: options.bambuCloud?.mqttProtocol ?? 'mqtts',
          host: options.bambuCloud?.mqttHost ?? brokerHost,
          port: options.bambuCloud?.mqttPort ?? 8883,
          username: message.username,
          password: message.token,
          rejectUnauthorized: options.bambuCloud?.mqttRejectUnauthorized ?? true,
          clientId: `orca_web_${Math.random().toString(16).slice(2, 10)}`,
          reconnectPeriod: 0,
          connectTimeout: 10_000
        });

        broker.on('connect', () => {
          broker!.subscribe(`device/${serial}/report`, (err) => {
            if (err) return send({ type: 'error', message: err.message });
            send({ type: 'connected' });
          });
        });

        broker.on('message', (_topic, payload) => {
          try {
            send({ type: 'report', payload: JSON.parse(payload.toString()) });
          } catch {
            /* ignore */
          }
        });

        broker.on('error', (err) => {
          send({ type: 'error', message: errorMessage(err) });
        });
        broker.on('close', () => client.close());
      } else if (message.type === 'publish' && broker) {
        if (!bambuRequestAllowedInReadOnly(message.payload)) {
          send({ type: 'error', message: 'Refused in read-only mode.' });
        } else {
          broker.publish(`device/${serial}/request`, JSON.stringify(message.payload));
        }
      }
    });

    client.on('close', () => { clearTimeout(authTimeout); broker?.end(true); });
  });
}

const ROUTE = /^\/_printer\/(http|https|ws|wss)\/([^/]+)(\/.*)?$/;
const BAMBU_ROUTE = /^\/_printer\/bambu\/(mqtt|ftp)\/([^/?]+)/;
const BAMBU_CLOUD_ROUTE = /^\/_printer\/bambu-cloud\/(api|mqtt)\/([^?]+)/;

/** The gateway's request handlers, independent of the server that hosts them (Vite plugin or the local gateway). */
export function createGateway(options: GatewayOptions = {}) {
  const sockets = new WebSocketServer({ noServer: true });
  const snapmakerMonitor = createSnapmakerMonitor(options);

  function status() {
    const config = { ...configFromEnv(), ...options };
    const cloud = (config.cloud ?? '').split(',').map((s) => s.trim()).filter((id) => id in CLOUD_SERVICES);
    const enabled = !!config.proxy || cloud.length > 0;
    return {
      enabled,
      mode: config.proxy === 'private' ? 'private' : config.proxy ? 'list' : cloud.length > 0 ? 'cloud' : 'off',
      readOnly: !!config.readOnly,
      cloud,
      message: enabled ? undefined : GATEWAY_OFF_MESSAGE
    };
  }

  /** Handles `/_printer/...`; resolves false for other URLs. Errors become an HTTP error response. */
  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const url = req.url ?? '';
    if (!url.startsWith('/_printer/')) return false;
    try {
      if (url === '/_printer/status') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(status()));
        return true;
      }
      if (url.startsWith('/_printer/creality-cloud/')) {
        await handleCrealityCloudRequest(req, res, url, options);
        return true;
      }
      if (url.startsWith('/_printer/snapmaker-cloud/')) {
        await handleSnapmakerCloudRequest(req, res, url, options);
        return true;
      }
      if (url.startsWith('/_printer/prusa-connect/')) {
        await handlePrusaConnectRequest(req, res, url, options);
        return true;
      }
      const bambu = BAMBU_ROUTE.exec(url);
      if (bambu?.[1] === 'ftp') {
        await handleBambuFtp(req, res, bambu[2], options);
        return true;
      }
      const cloud = BAMBU_CLOUD_ROUTE.exec(url);
      if (cloud?.[1] === 'api') {
        await handleBambuCloudApi(req, res, '/' + cloud[2] + new URL(url, 'http://localhost').search, options);
        return true;
      }
      const match = ROUTE.exec(url);
      if (match && (match[1] === 'http' || match[1] === 'https')) {
        await handleProxy(req, res, match[1], match[2], match[3] ?? '/', options);
        return true;
      }
      throw new GatewayError(404, 'Unknown printer gateway route');
    } catch (err) {
      fail(res, err instanceof GatewayError ? err.status : 502, err instanceof Error ? err.message : String(err));
      return true;
    }
  }

  /** Proxies one request to a printer for a caller that already resolved scheme, host and path (the local gateway's UI hosts). */
  function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse, scheme: 'http' | 'https', hostPort: string, path: string, mode: ProxyMode) {
    return handleProxy(req, res, scheme, hostPort, path, options, mode).catch((err) => {
      fail(res, err instanceof GatewayError ? err.status : 502, err instanceof Error ? err.message : String(err));
    });
  }

  /** Relays a websocket upgrade to a printer for a caller that already resolved the target. */
  async function relayUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, scheme: 'ws' | 'wss', hostPort: string, path: string) {
    const config = { ...configFromEnv(), ...options };
    const target = await resolveTarget(hostPort, scheme === 'wss' ? 443 : 80, config, options.resolver);
    relayWebSocket(sockets, req, socket, head, scheme, target, path, !!config.readOnly);
  }

  /** Handles a websocket upgrade of `/_printer/...`; resolves false for other URLs. */
  async function handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
    const url = req.url ?? '';
    if (!url.startsWith('/_printer/')) return false;
    const refuse = (statusCode: number, message: string) => {
      socket.end(`HTTP/1.1 ${statusCode} ${http.STATUS_CODES[statusCode] ?? 'Error'}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}`);
    };
    try {
      const config = { ...configFromEnv(), ...options };
      if (snapmakerMonitor.handleUpgrade(req, socket, head)) return true;
      if (url.startsWith('/_printer/creality-cloud/')) {
        refuse(400, 'Creality Cloud monitoring uses HTTP requests.');
        return true;
      }
      if (url.startsWith('/_printer/prusa-connect/')) {
        refuse(400, 'Prusa Connect uses HTTP requests.');
        return true;
      }
      const bambu = BAMBU_ROUTE.exec(url);
      if (bambu?.[1] === 'mqtt') {
        const target = await resolveTarget(bambu[2], 8883, config, options.resolver);
        handleBambuMqtt(sockets, req, socket, head, target, options);
        return true;
      }
      const cloud = BAMBU_CLOUD_ROUTE.exec(url);
      if (cloud?.[1] === 'mqtt') {
        handleBambuCloudMqtt(sockets, req, socket, head, cloud[2], options);
        return true;
      }
      const match = ROUTE.exec(url);
      if (match && (match[1] === 'ws' || match[1] === 'wss')) {
        await relayUpgrade(req, socket, head, match[1], match[2], match[3] ?? '/');
        return true;
      }
      refuse(404, 'Unknown printer gateway route');
    } catch (err) {
      refuse(err instanceof GatewayError ? err.status : 502, err instanceof Error ? err.message : String(err));
    }
    return true;
  }

  return { status, handleRequest, handleUpgrade, proxyRequest, relayUpgrade };
}

export function printerGatewayPlugin(options: GatewayOptions = {}): Plugin {
  const gateway = createGateway(options);
  const attached = new WeakSet<object>();

  function attach(server: ViteDevServer | PreviewServer) {
    server.middlewares.use(async (req, res, next) => {
      if (!(await gateway.handleRequest(req, res))) next();
    });
    if (server.httpServer && !attached.has(server.httpServer)) {
      attached.add(server.httpServer);
      // Anything else (Vite's own HMR upgrades) is left to the other listeners.
      server.httpServer.on('upgrade', (req, socket, head) => void gateway.handleUpgrade(req, socket, head));
    }
  }

  return {
    name: 'printer-gateway',
    configureServer: attach,
    configurePreviewServer: attach
  };
}
