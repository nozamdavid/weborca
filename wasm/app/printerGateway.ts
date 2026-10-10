/**
 * Printer gateway: a same-origin bridge between the web app and printers on the user's network.
 *
 * A browser cannot talk to most printers directly: Moonraker only sends CORS headers for a short list of
 * origins and checks the Origin of websockets, an https page cannot call http printers, and Bambu Lab needs
 * raw MQTT/FTPS. The gateway runs inside the Vite dev/preview server and exposes:
 *
 *   GET  /_printer/status                         { enabled, mode, readOnly }
 *   ANY  /_printer/<http|https>/<host[:port]>/... streaming reverse proxy
 *   GET  /_printer/ui/<http|https>/<host[:port]>/... the printer's web UI with paths rewritten for embedding
 *   WS   /_printer/<ws|wss>/<host[:port]>/...     websocket relay
 *   WS   /_printer/bambu/mqtt/<host[:port]>       Bambu MQTT bridge (see handleBambuMqtt)
 *   POST /_printer/bambu/ftp/<host>               Bambu FTPS upload
 *
 * It is OFF unless ORCA_PRINTER_PROXY is set, and ORCA_PRINTER_PROXY_READONLY=1 refuses everything that could
 * change a printer. See gateway/policy.ts for the rules and PRINTERS.md for the security model.
 */
import * as ftp from 'basic-ftp';
import * as http from 'node:http';
import * as https from 'node:https';
import type { Duplex } from 'node:stream';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  GATEWAY_OFF_MESSAGE, GatewayError, bambuRequestAllowedInReadOnly, checkRpcFrame, configFromEnv,
  digestAuthorization, httpAllowedInReadOnly, parseDigestChallenge, resolveTarget
} from './gateway/policy.ts';
import type { DigestChallenge, GatewayConfig, Resolver, Target } from './gateway/policy.ts';
import { UI_ROUTE, rewriteCss, rewriteHtml, rewriteLocation } from './gateway/uiProxy.ts';

export interface GatewayOptions extends GatewayConfig {
  /** Replaces DNS lookups (tests). */
  resolver?: Resolver;
  /** Where Bambu printers listen (tests point this at a local broker). */
  bambu?: { mqttPort?: number; mqttProtocol?: 'mqtt' | 'mqtts'; ftpPort?: number; ftpSecure?: boolean | 'implicit' };
}

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade'];
const NOT_FORWARDED = ['host', 'origin', 'referer', 'cookie', 'x-orca-auth', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'];
const UPSTREAM_IDLE_MS = 60_000;
const MAX_REWRITTEN_BYTES = 8 * 1024 * 1024;
const MAX_QUEUED_WS_FRAMES = 200;

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

async function handleProxy(
  req: http.IncomingMessage, res: http.ServerResponse, scheme: 'http' | 'https', hostPort: string, path: string,
  options: GatewayOptions, ui = false
) {
  const config = { ...configFromEnv(), ...options };
  const target = await resolveTarget(hostPort, scheme === 'https' ? 443 : 80, config, options.resolver);
  const method = req.method ?? 'GET';
  if (config.readOnly && !httpAllowedInReadOnly(method, path)) {
    throw new GatewayError(403, 'Read-only mode: this request could change the printer.');
  }

  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.includes(name) && !NOT_FORWARDED.includes(name)) headers[name] = value;
  }
  if (ui) {
    // Pages are rewritten, so they must arrive uncompressed and unconditionally.
    headers['accept-encoding'] = 'identity';
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
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
    const status = up.statusCode ?? 502;
    if (ui) {
      // The page is shown in an iframe of this app, which is cross-origin isolated.
      delete out['x-frame-options'];
      delete out['content-security-policy'];
      delete out['content-security-policy-report-only'];
      out['cross-origin-embedder-policy'] = 'require-corp';
      out['cross-origin-resource-policy'] = 'same-origin';
      if (typeof out.location === 'string') out.location = rewriteLocation(out.location, scheme, hostPort);
      const type = String(up.headers['content-type'] ?? '');
      const rewrite = /^text\/html/i.test(type) ? 'html' : /^text\/css/i.test(type) ? 'css' : undefined;
      if (rewrite && status === 200) {
        const chunks: Buffer[] = [];
        let size = 0;
        up.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_REWRITTEN_BYTES) up.destroy(new Error('The printer page is too large to embed.'));
          else chunks.push(chunk);
        });
        up.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const body = Buffer.from(rewrite === 'html' ? rewriteHtml(text, scheme, hostPort) : rewriteCss(text, `/_printer/ui/${scheme}/${hostPort}`), 'utf8');
          delete out['content-length'];
          delete out.etag;
          out['content-length'] = String(body.length);
          res.writeHead(status, out);
          res.end(body);
        });
        up.on('error', (err) => fail(res, 502, errorMessage(err)));
        return;
      }
    }
    res.writeHead(status, out);
    up.pipe(res);
    up.on('error', () => res.destroy());
  });
  upstream.on('timeout', () => upstream.destroy(new Error('The printer did not answer in time.')));
  upstream.on('error', (err) => fail(res, 502, errorMessage(err)));
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
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
        broker = mqtt.connect({
          protocol: options.bambu?.mqttProtocol ?? 'mqtts',
          host: target.address,
          port: options.bambu?.mqttPort ?? 8883,
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

const ROUTE = /^\/_printer\/(http|https|ws|wss)\/([^/]+)(\/.*)?$/;
const BAMBU_ROUTE = /^\/_printer\/bambu\/(mqtt|ftp)\/([^/?]+)/;

export function printerGatewayPlugin(options: GatewayOptions = {}): Plugin {
  let wss: WebSocketServer | undefined;

  function attach(server: ViteDevServer | PreviewServer) {
    server.middlewares.use(async (req, res, next) => {
      const url = req.url ?? '';
      if (!url.startsWith('/_printer/')) return next();
      try {
        const config = { ...configFromEnv(), ...options };
        if (url === '/_printer/status') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            enabled: !!config.proxy,
            mode: config.proxy === 'private' ? 'private' : config.proxy ? 'list' : 'off',
            readOnly: !!config.readOnly,
            message: config.proxy ? undefined : GATEWAY_OFF_MESSAGE
          }));
          return;
        }
        const bambu = BAMBU_ROUTE.exec(url);
        if (bambu?.[1] === 'ftp') return await handleBambuFtp(req, res, bambu[2], options);
        const ui = UI_ROUTE.exec(url);
        if (ui) {
          // `/_printer/ui/http/host` without a slash would resolve relative URLs against /_printer/ui/http/.
          if (!ui[3]) {
            res.statusCode = 308;
            res.setHeader('location', `/_printer/ui/${ui[1]}/${ui[2]}/${ui[4] ?? ''}`);
            res.end();
            return;
          }
          return await handleProxy(req, res, ui[1] as 'http' | 'https', ui[2], ui[3] + (ui[4] ?? ''), options, true);
        }
        const match = ROUTE.exec(url);
        if (match && (match[1] === 'http' || match[1] === 'https')) {
          return await handleProxy(req, res, match[1], match[2], match[3] ?? '/', options);
        }
        throw new GatewayError(404, 'Unknown printer gateway route');
      } catch (err) {
        fail(res, err instanceof GatewayError ? err.status : 502, err instanceof Error ? err.message : String(err));
      }
    });

    if (!wss && server.httpServer) {
      const sockets = (wss = new WebSocketServer({ noServer: true }));
      server.httpServer.on('upgrade', async (req, socket, head) => {
        const url = req.url ?? '';
        if (!url.startsWith('/_printer/')) return; // Vite's own HMR upgrades
        const refuse = (status: number, message: string) => {
          socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? 'Error'}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}`);
        };
        try {
          const config = { ...configFromEnv(), ...options };
          const bambu = BAMBU_ROUTE.exec(url);
          if (bambu?.[1] === 'mqtt') {
            const target = await resolveTarget(bambu[2], 8883, config, options.resolver);
            return handleBambuMqtt(sockets, req, socket, head, target, options);
          }
          const match = ROUTE.exec(url);
          if (match && (match[1] === 'ws' || match[1] === 'wss')) {
            const target = await resolveTarget(match[2], match[1] === 'wss' ? 443 : 80, config, options.resolver);
            return relayWebSocket(sockets, req, socket, head, match[1], target, match[3] ?? '/', !!config.readOnly);
          }
          refuse(404, 'Unknown printer gateway route');
        } catch (err) {
          refuse(err instanceof GatewayError ? err.status : 502, err instanceof Error ? err.message : String(err));
        }
      });
    }
  }

  return {
    name: 'printer-gateway',
    configureServer: attach,
    configurePreviewServer: attach
  };
}
