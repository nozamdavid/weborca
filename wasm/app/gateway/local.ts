/**
 * Local gateway: the printer gateway as a small program the user runs on their own computer, for when the app is
 * hosted somewhere that cannot reach the printers (a VPS, a static host). The app, served over https, talks to it
 * on `http://127.0.0.1:<port>`, which browsers treat as a secure origin, so there is no mixed-content blocking.
 *
 *   node orca-gateway.mjs --allow-origin https://slicer.example.com [--port 5199] [--readonly] [--proxy private|host,...]
 *
 * It exposes the same `/_printer/...` routes as the app server's gateway, plus
 *
 *   GET  /_gw/status                       { enabled, kind: 'local', mode, readOnly }
 *   POST /_gw/ui-session {url}             { label, url }  where the printer's web UI is served
 *   GET  /_gw/discover                     newline-delimited JSON, one printer per line, then {"done":true}
 *
 * and serves each registered printer web UI at the root of its own origin, `http://<label>.localhost:<port>/`
 * (browsers resolve `*.localhost` to the loopback), so Mainsail, Fluidd and the like need no path rewriting.
 *
 * Because any web page could otherwise reach the user's printers through this port, requests must come from an
 * origin in the allow list, the Host header must be a loopback name (DNS rebinding), and UI hosts are
 * unguessable capabilities that may only be opened from an allowed origin.
 */
import { randomBytes } from 'node:crypto';
import * as http from 'node:http';
import type { Duplex } from 'node:stream';
import { discoverPrinters } from './discover.ts';
import type { DiscoverOptions } from './discover.ts';
import { createGateway } from '../printerGateway.ts';
import type { GatewayOptions } from '../printerGateway.ts';
import { GatewayError, cloudHosts, configFromEnv, resolveTarget } from './policy.ts';

export interface LocalGatewayOptions extends GatewayOptions {
  /** Origins of the app that may use the gateway, e.g. `https://slicer.example.com`. */
  allowedOrigins: string[];
  /** TCP port; 0 picks a free one. */
  port?: number;
  /** Overrides what discovery scans (tests). */
  discover?: DiscoverOptions;
}

interface UiSession {
  scheme: 'http' | 'https';
  hostPort: string;
  basePath: string;
  expires: number;
}

const SESSION_TTL_MS = 12 * 3600_000;
const MAX_SESSIONS = 50;
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\]|[a-z0-9-]+\.localhost)(?::\d+)?$/i;
const UI_HOST = /^(u[0-9a-f]{16})\.localhost(?::\d+)?$/i;

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    throw new Error(`Not a valid origin: ${origin}`);
  }
}

function originOf(value: string | undefined): string | undefined {
  try {
    return value ? new URL(value).origin : undefined;
  } catch {
    return undefined;
  }
}

function send(res: http.ServerResponse, status: number, body: string, headers: http.OutgoingHttpHeaders = {}) {
  if (res.headersSent) return res.destroy();
  // CORP lets the isolated app (and its frames) show the refusal instead of a blocked-by-COEP error.
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cross-origin-resource-policy': 'cross-origin', ...headers });
  res.end(body);
}

export async function startLocalGateway(options: LocalGatewayOptions) {
  const allowed = new Set(options.allowedOrigins.map(normalizeOrigin));
  if (allowed.size === 0) throw new Error('At least one allowed origin is required (--allow-origin https://your-app).');
  const env = configFromEnv();
  // Unlike the app server's gateway this one is on by default: starting it is the user's decision.
  const gatewayOptions: GatewayOptions = { ...options, proxy: options.proxy ?? env.proxy ?? 'private', readOnly: options.readOnly ?? env.readOnly, cloud: options.cloud ?? env.cloud };
  const config = gatewayOptions;
  const gateway = createGateway(gatewayOptions);
  const sessions = new Map<string, UiSession>();
  let port = 0;

  const ownOrigin = () => `http://127.0.0.1:${port}`;
  const sweep = () => {
    const now = Date.now();
    for (const [label, session] of sessions) if (session.expires < now) sessions.delete(label);
  };

  /** The app origin that makes this request, from what the browser sets and a page cannot forge. */
  const callerOrigin = (req: http.IncomingMessage) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string') return origin;
    // Plain image and iframe loads carry no Origin, but the Referer (an origin by default).
    return originOf(req.headers.referer);
  };

  const corsHeaders = (origin: string): http.OutgoingHttpHeaders => ({
    'access-control-allow-origin': origin,
    'access-control-allow-private-network': 'true',
    'access-control-expose-headers': '*',
    vary: 'Origin',
    'cross-origin-resource-policy': 'cross-origin'
  });

  function uiSessionOf(req: http.IncomingMessage): UiSession | undefined {
    const label = UI_HOST.exec(String(req.headers.host ?? ''))?.[1]?.toLowerCase();
    const session = label ? sessions.get(label) : undefined;
    return session && session.expires >= Date.now() ? session : undefined;
  }

  /** Opening a UI host from another site (not through the app) is refused: the label alone is not enough. */
  function uiCallerAllowed(req: http.IncomingMessage): boolean {
    const site = req.headers['sec-fetch-site'];
    if (site === 'same-origin') return true; // the framed UI loading its own assets
    const origin = callerOrigin(req);
    if (origin) return allowed.has(origin) || origin === `http://${req.headers.host}`;
    return site === undefined; // an old browser that sends neither header: the unguessable label has to do
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const host = String(req.headers.host ?? '');
    if (!LOOPBACK_HOST.test(host)) return send(res, 403, 'Unexpected Host header.');
    const url = req.url ?? '/';

    const session = uiSessionOf(req);
    if (UI_HOST.test(host)) {
      if (!session) return send(res, 404, 'This printer UI session has expired. Reopen the printer in the app.');
      if (!uiCallerAllowed(req)) return send(res, 403, 'This printer UI can only be opened from the app.');
      return gateway.proxyRequest(req, res, session.scheme, session.hostPort, session.basePath + url, { ui: true, ownOrigin: `http://${host}` });
    }

    const origin = callerOrigin(req);
    if (!origin || !allowed.has(origin)) {
      return send(res, 403, origin
        ? `This gateway does not accept requests from ${origin}. Start it with --allow-origin ${origin}.`
        : 'Requests must come from the app (no Origin or Referer).');
    }
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': String(req.headers['access-control-request-headers'] ?? '*'),
        'access-control-max-age': '600'
      });
      return res.end();
    }
    for (const [name, value] of Object.entries(cors)) res.setHeader(name, value as string);

    if (url === '/_gw/status') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ...gateway.status(), kind: 'local' }));
    }
    if (url === '/_gw/discover' && req.method === 'GET') {
      const abort = new AbortController();
      res.on('close', () => abort.abort());
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
      await discoverPrinters({ ...options.discover, signal: abort.signal }, (printer) => res.write(`${JSON.stringify(printer)}\n`));
      return res.end('{"done":true}\n');
    }
    if (url === '/_gw/ui-session' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) throw new GatewayError(413, 'Request too large.');
      }
      let target: URL;
      try {
        const address = String(JSON.parse(body).url ?? '').trim();
        target = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `http://${address}`);
      } catch {
        throw new GatewayError(400, 'Expected {"url": "<printer web UI address>"}.');
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new GatewayError(400, 'Unsupported address.');
      const scheme = target.protocol === 'https:' ? 'https' : 'http';
      if (cloudHosts({ ...config, ...gatewayOptions }).has(target.hostname.toLowerCase())) throw new GatewayError(403, 'Cloud services cannot be framed; open them in a new tab.');
      // Refuses addresses outside the allowed network up front, with a readable reason.
      await resolveTarget(target.host, scheme === 'https' ? 443 : 80, { ...config, ...gatewayOptions }, options.resolver);
      sweep();
      if (sessions.size >= MAX_SESSIONS) throw new GatewayError(429, 'Too many open printer UIs.');
      const label = `u${randomBytes(8).toString('hex')}`;
      const basePath = target.pathname.replace(/\/+$/, '');
      sessions.set(label, { scheme, hostPort: target.host, basePath, expires: Date.now() + SESSION_TTL_MS });
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ label, url: `http://${label}.localhost:${port}/` }));
    }
    if (!(await gateway.handleRequest(req, res))) send(res, 404, 'Unknown gateway route', cors);
  }

  async function handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    const host = String(req.headers.host ?? '');
    const refuse = (status: number, message: string) => {
      socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? 'Error'}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}`);
    };
    if (!LOOPBACK_HOST.test(host)) return refuse(403, 'Unexpected Host header.');
    if (UI_HOST.test(host)) {
      const session = uiSessionOf(req);
      if (!session) return refuse(404, 'This printer UI session has expired.');
      // Websockets of the framed UI come from its own origin.
      if (originOf(req.headers.origin as string | undefined) !== `http://${host}`) return refuse(403, 'Websockets of a printer UI must come from the UI itself.');
      try {
        return await gateway.relayUpgrade(req, socket, head, session.scheme === 'https' ? 'wss' : 'ws', session.hostPort, session.basePath + (req.url ?? '/'));
      } catch (err) {
        return refuse(err instanceof GatewayError ? err.status : 502, err instanceof Error ? err.message : String(err));
      }
    }
    const origin = callerOrigin(req);
    if (!origin || !allowed.has(origin)) return refuse(403, 'Origin not allowed.');
    if (!(await gateway.handleUpgrade(req, socket, head))) refuse(404, 'Unknown gateway route');
  }

  const servers: http.Server[] = [];
  const listen = (address: string, wantedPort: number) => new Promise<http.Server>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((err) => send(res, err instanceof GatewayError ? err.status : 502, err instanceof Error ? err.message : String(err)));
    });
    server.on('upgrade', (req, socket, head) => void handleUpgrade(req, socket, head));
    server.once('error', reject);
    server.listen(wantedPort, address, () => resolve(server));
  });

  const primary = await listen('127.0.0.1', options.port ?? 0);
  servers.push(primary);
  port = (primary.address() as { port: number }).port;
  try {
    servers.push(await listen('::1', port)); // `localhost` may resolve to the IPv6 loopback
  } catch {
    // no IPv6 loopback
  }
  return {
    port,
    origin: ownOrigin(),
    sessions,
    close: () => Promise.all(servers.map((server) => new Promise<void>((done) => {
      server.closeAllConnections?.();
      server.close(() => done());
    }))).then(() => undefined)
  };
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

const HELP = `OrcaSlicer Web local gateway

Usage: orca-gateway --allow-origin <app origin> [options]

  --allow-origin <origin>  Origin of the app that may use the gateway, e.g. https://slicer.example.com.
                           Repeat for several. Also read from ORCA_GATEWAY_ORIGINS (comma separated).
  --port <n>               Port to listen on (default 5199), loopback only.
  --proxy <private|list>   Printers it may reach: "private" (default) is private/loopback/tailnet
                           addresses, or a comma list of hosts.
  --cloud <services>       Cloud bridges (comma list): prusa-connect, bambu-cloud, creality-cloud.
                           Also read from ORCA_PRINTER_CLOUD.
  --readonly               Refuse everything that could change a printer.
  --help                   Show this help.
`;

export async function main(argv: string[]) {
  const origins = (process.env.ORCA_GATEWAY_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let port = 5199;
  let proxy: string | undefined;
  let cloud = process.env.ORCA_PRINTER_CLOUD?.trim() || undefined;
  let readOnly = process.env.ORCA_PRINTER_PROXY_READONLY === '1';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return console.log(HELP);
    else if (arg === '--allow-origin') origins.push(argv[++i] ?? '');
    else if (arg === '--port') port = parseInt(argv[++i] ?? '', 10);
    else if (arg === '--proxy') proxy = argv[++i];
    else if (arg === '--cloud') cloud = argv[++i];
    else if (arg === '--readonly') readOnly = true;
    else {
      console.error(`Unknown argument: ${arg}\n\n${HELP}`);
      process.exitCode = 2;
      return;
    }
  }
  if (origins.length === 0 || !Number.isInteger(port)) {
    console.error(`${HELP}\nError: --allow-origin is required.`);
    process.exitCode = 2;
    return;
  }
  const gateway = await startLocalGateway({ allowedOrigins: origins, port, proxy, readOnly, cloud });
  console.log(`Local gateway listening on ${gateway.origin}`);
  console.log(`  allowed origins: ${origins.join(', ')}`);
  console.log(`  printers: ${proxy ?? 'private networks'}${cloud ? `, cloud: ${cloud}` : ''}${readOnly ? ', read-only' : ''}`);
  console.log('In the app, add a printer, choose "Gateway on this computer" and enter this address.');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
