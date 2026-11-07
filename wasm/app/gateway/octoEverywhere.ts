/** Optional same-origin OctoEverywhere boundary. No disk credentials or arbitrary proxy targets. */
import { randomBytes, createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { Transform } from 'node:stream';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

const BASE = '/_octoeverywhere';
const JSON_LIMIT = 2 * 1024 * 1024;
const FILE_LIMIT = 5 * 1024 ** 3; // gateway ceiling, further restricted by current account info
const SESSION_MS = 30 * 60_000;
const FLOW_MS = 10 * 60_000;
const TICKET_MS = 30_000;
const STREAM_MS = 5 * 60_000;
type Json = Record<string, unknown>;
export interface OctoEverywhereConnection {
  connectionId: string; url: string; appApiToken: string;
  auth: { type: 'bearer'; token: string } | { type: 'basic'; username: string; password: string };
  printerName: string; userFacingUrl: string; printerId?: string; nativeApiKey?: string;
}
export interface OctoEverywhereOptions {
  enabled?: boolean; appId?: string; publicOrigin?: string;
  /** Synthetic transport seams. Never sourced from an HTTP request or environment. */
  resolver?: (host: string) => Promise<{ address: string; family: number }[]>;
  request?: typeof https.request;
  webSocket?: typeof WebSocket;
  now?: () => number;
}
class Failure extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function requireThat(condition: unknown, message = 'Invalid request.'): asserts condition {
  if (!condition) throw new Failure(400, message);
}
function object(value: unknown): Json {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Json;
}
function text(value: unknown, max = 4096): string {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value));
  return value;
}
function keys(body: Json, allowed: string[]) {
  requireThat(Object.keys(body).every(key => allowed.includes(key)));
}
function finite(value: unknown, min: number, max: number, integer = false) {
  requireThat(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)));
}
function bools(body: Json, fields: string[]) {
  for (const field of fields) if (body[field] !== undefined) requireThat(typeof body[field] === 'boolean');
}
function providerUrl(value: unknown, root: boolean): URL {
  const url = new URL(text(value));
  // Decode each name segment, never a whole path: encoded separators must not
  // create a second route or hide credentials/control characters in an Open link.
  const safeUserPath = url.pathname.split('/').every(segment => {
    const decoded = decodeURIComponent(segment);
    return !/[\x00-\x1f\x7f\\/@?#%]/.test(decoded) && decoded !== '.' && decoded !== '..';
  });
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
    (root ? /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.octoeverywhere\.com$/.test(url.hostname) && url.pathname === '/'
      : /^(?:[a-z0-9-]+\.)?octoeverywhere\.com$/.test(url.hostname) && safeUserPath), 'Invalid OctoEverywhere URL.');
  return url;
}
function connection(value: unknown): OctoEverywhereConnection {
  const c = object(value), a = object(c.auth);
  const auth: OctoEverywhereConnection['auth'] = a.type === 'bearer'
    ? { type: 'bearer', token: text(a.token) }
    : (requireThat(a.type === 'basic'), { type: 'basic', username: text(a.username, 512), password: text(a.password) });
  if (auth.type === 'basic') requireThat(!auth.username.includes(':'));
  return { connectionId: text(c.connectionId, 256), url: providerUrl(c.url, true).href,
    appApiToken: text(c.appApiToken), auth, printerName: text(c.printerName, 256),
    userFacingUrl: providerUrl(c.userFacingUrl, false).href,
    ...(c.printerId === undefined ? {} : { printerId: text(c.printerId, 256) }),
    ...(c.nativeApiKey === undefined ? {} : { nativeApiKey: text(c.nativeApiKey) }) };
}
const forbidden = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) forbidden.addSubnet(address, prefix, 'ipv4');
// IPv6 must be globally routable unicast; translation/tunnel ranges are refused as well.
for (const [address, prefix] of [['2001::', 32], ['2001:db8::', 32], ['2002::', 16]] as const) forbidden.addSubnet(address, prefix, 'ipv6');
function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !forbidden.check(address, 'ipv4')
    : family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !forbidden.check(address, 'ipv6');
}
function pinnedLookup(resolved: { address: string; family: number }) {
  return ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
    options.all ? callback(null, [resolved]) : callback(null, resolved.address, resolved.family)) as never;
}
function virtualPath(value: unknown) {
  const path = text(value, 2048);
  requireThat(/^(gcode|config|logs)(\/|$)/.test(path) && !/[%\\?#:@]/.test(path) && path.split('/').every(p => p && p !== '.' && p !== '..'));
}
async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new Failure(413, 'JSON body too large.');
    chunks.push(Buffer.from(chunk));
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
  catch (error) { if (error instanceof Failure) throw error; throw new Failure(400, 'Invalid JSON.'); }
}
function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
}
function limiter(max: number) {
  let bytes = 0;
  return new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    done(bytes > max ? new Failure(413, 'Transfer exceeds the allowed byte limit.') : null, chunk);
  } });
}
function plugin(command: string, method: string, query: URLSearchParams, body?: Json) {
  const reads = ['status', 'webcam/list', 'webcam/snapshot', 'webcam/stream', 'files/list', 'files/details', 'files/download'];
  const writes = ['pause', 'resume', 'cancel', 'start', 'set-light', 'move-axis', 'home', 'extrude', 'set-temp', 'files/delete'];
  requireThat((method === 'GET' && reads.includes(command)) || (method === 'POST' && writes.includes(command)) ||
    (method === 'PUT' && command === 'files/upload'), 'Plugin route or method is not allowed.');
  const allowed = command === 'status' ? ['IncludeMaterialSystem'] : command.startsWith('webcam/') && command !== 'webcam/list' ? ['index']
    : command === 'files/list' ? ['root', 'path'] : command.startsWith('files/') ? ['path'] : [];
  for (const [name, value] of query) {
    requireThat(allowed.includes(name) && query.getAll(name).length === 1);
    if (name === 'path') virtualPath(value);
    if (name === 'root') requireThat(['gcode', 'config', 'logs'].includes(value));
    if (name === 'index') requireThat(/^\d{1,4}$/.test(value));
    if (name === 'IncludeMaterialSystem') requireThat(['true', 'false'].includes(value));
  }
  if (command.startsWith('files/') && command !== 'files/list') requireThat(query.has('path'));
  if (!body) return;
  const fields: Record<string, string[]> = {
    pause: ['SmartPause', 'DisableHotend', 'DisableBed', 'ZLiftMm', 'RetractFilamentMm', 'SuppressNotification', 'ShowSmartPausePopup'],
    start: ['Path', 'Storage', 'Plate', 'UseAms', 'AmsMapping', 'FlowCali', 'Timelapse', 'BedLeveling', 'VibrationCali', 'LayerInspect'],
    'set-light': ['Name', 'On'], 'move-axis': ['Axis', 'DistanceMm'], extrude: ['Extruder', 'DistanceMm'],
    'set-temp': ['BedC', 'ChamberC', 'ToolC', 'ToolNumber']
  };
  keys(body, fields[command] ?? []);
  bools(body, ['SmartPause', 'DisableHotend', 'DisableBed', 'SuppressNotification', 'ShowSmartPausePopup', 'UseAms', 'FlowCali', 'Timelapse', 'BedLeveling', 'VibrationCali', 'LayerInspect', 'On']);
  for (const field of ['ZLiftMm', 'RetractFilamentMm']) if (body[field] !== undefined) finite(body[field], 0, 1000, true);
  if (command === 'start') {
    virtualPath(body.Path); requireThat(String(body.Path).startsWith('gcode/'));
    if (body.Storage !== undefined) requireThat(/^[\w-]{1,64}$/.test(text(body.Storage)));
    if (body.Plate !== undefined) finite(body.Plate, 1, 1000, true);
    if (body.AmsMapping !== undefined) { requireThat(Array.isArray(body.AmsMapping) && body.AmsMapping.length <= 256); for (const n of body.AmsMapping) finite(n, -1, 65535, true); }
  }
  if (command === 'set-light') { text(body.Name, 128); requireThat(typeof body.On === 'boolean'); }
  if (command === 'move-axis') { requireThat(['X', 'Y', 'Z'].includes(String(body.Axis))); finite(body.DistanceMm, -1000, 1000); }
  if (command === 'extrude') { finite(body.Extruder, 0, 255, true); finite(body.DistanceMm, -1000, 1000); }
  if (command === 'set-temp') {
    requireThat(['BedC', 'ChamberC', 'ToolC'].some(f => body[f] !== undefined));
    for (const f of ['BedC', 'ChamberC', 'ToolC']) if (body[f] !== undefined) finite(body[f], 0, f === 'ToolC' ? 260 : 75);
    if (body.ToolNumber !== undefined) finite(body.ToolNumber, 0, 255, true);
  }
}
/** Explicit API paths only. No web UI, general command console, URL fetchers, firmware or config writes. */
function native(path: string, method: string, query: URLSearchParams) {
  requireThat(!/[%\\:@]|\/\.\.?($|\/)|\/\//.test(path));
  const read = /^\/(?:api\/(?:version|printer(?:\/(?:tool|bed))?|job|files(?:\/local(?:\/[\w .-]+)*)?|plugin\/octoeverywhere)|server\/(?:info|temperature_store|files\/(?:list|metadata))|printer\/(?:info|objects\/(?:list|query))|api\/v1\/(?:info|status|job|files(?:\/(?:local|usb)(?:\/[\w .-]+)*)?))$/;
  const post = /^\/(?:api\/(?:job|printer\/(?:printhead|tool|bed)|files\/local(?:\/[\w .-]+)*)|printer\/print\/(?:start|pause|resume|cancel)|server\/files\/upload)$/;
  const put = /^\/api\/v1\/(?:job\/\d+\/(?:pause|resume|stop)|files\/(?:local|usb)\/[\w .-]+(?:\/[\w .-]+)*)$/;
  const remove = /^\/(?:api\/(?:files\/local|v1\/files\/(?:local|usb))\/[\w .-]+(?:\/[\w .-]+)*|server\/files\/delete_file)$/;
  requireThat((method === 'GET' && read.test(path)) || (method === 'POST' && post.test(path)) ||
    (method === 'PUT' && put.test(path)) || (method === 'DELETE' && remove.test(path)), 'Native route or method is not allowed.');
  const allowed = path === '/printer/objects/query' ? ['webhooks', 'virtual_sdcard', 'print_stats', 'display_status', 'extruder', 'heater_bed', 'temperature_fan', 'fan', 'gcode_move', 'toolhead', 'idle_timeout', 'pause_resume']
    : path === '/server/files/metadata' ? ['filename'] : path === '/server/files/list' ? ['root']
      : path === '/server/files/delete_file' ? ['path'] : path === '/printer/print/start' ? ['filename']
      : path === '/server/temperature_store' ? ['include_monitors']
        : /^\/api\/printer(?:\/(?:tool|bed))?$/.test(path) ? ['history', 'limit', 'exclude']
          : /^\/api\/files/.test(path) ? ['recursive'] : [];
  for (const [name, value] of query) {
    requireThat(allowed.includes(name) && query.getAll(name).length === 1 && value.length <= 2048 && !/[\x00-\x1f%\\:@]|(^|\/)\.\.?(\/|$)/.test(value));
  }
}
interface Session {
  token: string; c: OctoEverywhereConnection; expires: number; active: Set<() => void>;
  limits: { upload: number; download: number; stream: number };
}
interface Flow { token: string; expires: number; state: string; result?: Json }
interface Ticket { session: string; path: string; kind: string; expires: number }

export function createOctoEverywhereGateway(options: OctoEverywhereOptions = {}) {
  const enabled = options.enabled ?? process.env.ORCA_OCTOEVERYWHERE_ENABLED === '1';
  const appId = options.appId ?? process.env.ORCA_OCTOEVERYWHERE_APP_ID;
  if (appId !== undefined) requireThat(/^[\w-]{1,128}$/.test(appId) && appId.toLowerCase() !== 'devtest', 'Configure an assigned production OctoEverywhere App ID.');
  const originValue = options.publicOrigin ?? process.env.ORCA_PUBLIC_ORIGIN;
  let origin: URL | undefined;
  if (originValue) {
    origin = new URL(originValue);
    requireThat(originValue === origin.origin && !origin.username && !origin.password &&
      (origin.protocol === 'https:' || origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)), 'Configure a canonical ORCA_PUBLIC_ORIGIN.');
  }
  if (enabled && !origin) throw new Error('OctoEverywhere requires canonical ORCA_PUBLIC_ORIGIN.');
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Session>(), flows = new Map<string, Flow>(), tickets = new Map<string, Ticket>();
  const gadgetPolls = new Map<string, number>();
  const secret = () => randomBytes(32).toString('base64url');
  function destroy(id: string) {
    const s = sessions.get(id); sessions.delete(id);
    for (const [key, t] of tickets) if (t.session === id) tickets.delete(key);
    if (s) { for (const close of s.active) close(); s.active.clear(); }
  }
  function sweep() {
    for (const [id, s] of sessions) if (s.expires <= now()) destroy(id);
    for (const [id, f] of flows) if (f.expires <= now()) flows.delete(id);
    for (const [id, t] of tickets) if (t.expires <= now()) tickets.delete(id);
    for (const [id, time] of gadgetPolls) if (time + 10_000 <= now()) gadgetPolls.delete(id);
  }
  const timer = setInterval(sweep, 5000); timer.unref();
  function sameOrigin(req: IncomingMessage) {
    if (!origin || req.headers.host !== origin.host || (req.headers.origin !== undefined && req.headers.origin !== origin.origin) ||
      (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin')) throw new Failure(403, 'OctoEverywhere requires the configured app origin.');
    if (req.headers.origin !== origin.origin && req.headers['sec-fetch-site'] !== 'same-origin') throw new Failure(403, 'Same-origin request required.');
  }
  async function address(host: string) {
    const addresses = await (options.resolver ? options.resolver(host) : lookup(host, { all: true, verbatim: true }));
    if (!addresses.length || !addresses.every(a => publicAddress(a.address))) throw new Failure(403, 'Upstream DNS target refused.');
    return addresses[0];
  }
  function getSession(id: string, token: unknown) {
    const s = sessions.get(id);
    if (!s || s.expires <= now() || typeof token !== 'string' || token !== s.token) throw new Failure(401, 'OctoEverywhere session expired or unauthorized.');
    return s;
  }
  const auth = (s: Session) => s.c.auth.type === 'bearer' ? `Bearer ${s.c.auth.token}` : `Basic ${Buffer.from(`${s.c.auth.username}:${s.c.auth.password}`).toString('base64')}`;
  function scrub(value: unknown, s: Session): unknown {
    if (typeof value === 'string') {
      const secrets = [s.c.appApiToken, s.c.nativeApiKey, auth(s), ...(s.c.auth.type === 'bearer' ? [s.c.auth.token] : [s.c.auth.username, s.c.auth.password])];
      for (const v of secrets) if (v) for (const form of [v, encodeURIComponent(v)]) value = (value as string).split(form).join('[redacted]');
      return value;
    }
    if (Array.isArray(value)) return value.map(v => scrub(v, s));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, scrub(v, s)]));
    return value;
  }
  function reserve(s: Session) {
    let active = 0; for (const session of sessions.values()) active += session.active.size;
    if (s.active.size >= 8 || active >= 128) throw new Failure(429, 'Too many active OctoEverywhere requests.');
  }
  async function relay(req: IncomingMessage, res: ServerResponse, s: Session, path: string, app: boolean, method: string,
    body?: Json, raw = false, stream = false) {
    reserve(s);
    const target = new URL(app ? 'https://octoeverywhere.com' : s.c.url);
    const resolved = await new Promise<Awaited<ReturnType<typeof address>>>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); res.off('close', cancel); req.off('aborted', cancel); s.active.delete(cancel); };
      const cancel = () => { cleanup(); reject(new Failure(499, 'Request closed.')); };
      const timer = setTimeout(() => { cleanup(); reject(new Failure(504, 'Upstream DNS timed out.')); }, 15_000);
      timer.unref(); s.active.add(cancel); res.once('close', cancel); req.once('aborted', cancel);
      if (res.destroyed || req.aborted) return cancel();
      address(target.hostname).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
    if (res.destroyed || req.aborted) throw new Failure(499, 'Request closed.');
    if (s.expires <= now() || ![...sessions.values()].includes(s)) throw new Failure(401, 'OctoEverywhere session expired.');
    const headers: Record<string, string> = app ? { AppToken: s.c.appApiToken } : { Authorization: auth(s) };
    if (!app && !path.startsWith('/octoeverywhere-command-api/') && s.c.nativeApiKey) headers['X-Api-Key'] = s.c.nativeApiKey;
    if (body) headers['Content-Type'] = 'application/json';
    else if (raw && req.headers['content-type']) headers['Content-Type'] = text(req.headers['content-type'], 256);
    const fileUpload = path.startsWith('/octoeverywhere-command-api/files/upload?') || path.startsWith('/server/files/upload') || /^\/api\/(?:files\/local|v1\/files\/)/.test(path);
    const uploadLimit = Math.min(fileUpload ? FILE_LIMIT : JSON_LIMIT, s.limits.upload);
    if (raw && req.headers['content-length'] !== undefined) {
      const length = Number(req.headers['content-length']);
      requireThat(Number.isSafeInteger(length) && length >= 0);
      if (length > uploadLimit) throw new Failure(413, 'Upload exceeds the allowed byte limit.');
      headers['Content-Length'] = String(length);
    }
    reserve(s); // DNS is asynchronous; recheck capacity before attaching a transfer.
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return; finished = true;
        clearTimeout(deadline); s.active.delete(cancel); res.off('close', cancel); req.off('aborted', cancel);
        if (raw) { req.unpipe(); req.resume(); }
        if (error) { upstream.destroy(); reject(error instanceof Failure ? error : new Failure(502, 'OctoEverywhere upstream request failed.')); } else resolve();
      };
      const upstream = (options.request ?? https.request)({ hostname: target.hostname, port: 443, servername: target.hostname,
        path, method, headers, agent: false,
        lookup: pinnedLookup(resolved), family: resolved.family
      }, response => {
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) { response.destroy(); return finish(new Failure(502, 'Upstream redirect refused.')); }
        if (status >= 400) {
          response.destroy(); send(res, status, { error: 'OctoEverywhere rejected the request.', code: status }); return finish();
        }
        if (app && ['/api/appconnection/SetNotificationWebhook', '/api/appconnection/DeleteNotificationWebhook'].includes(path)) {
          response.destroy(); send(res, status, { success: true }); return finish();
        }
        const type = String(response.headers['content-type'] ?? 'application/octet-stream');
        const json = /\bjson\b/.test(type);
        const file = !app && method === 'GET' && (path.startsWith('/octoeverywhere-command-api/files/download?') || /^attachment\b/i.test(String(response.headers['content-disposition'] ?? '')));
        if ((json && !file) || app) {
          const chunks: Buffer[] = []; let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > JSON_LIMIT) { response.destroy(); finish(new Failure(502, 'Upstream JSON exceeds gateway limit.')); }
            else chunks.push(Buffer.from(chunk));
          });
          response.on('end', () => {
            try {
              const rawText = Buffer.concat(chunks).toString();
              const result = rawText ? JSON.parse(rawText) : {};
              if (app && path === '/api/appconnection/info') {
                const limits = result.PrinterLimits;
                if (limits && typeof limits === 'object') {
                  if (Number.isSafeInteger(limits.MaxUploadFileSizeBytes) && limits.MaxUploadFileSizeBytes >= 0) s.limits.upload = Math.min(FILE_LIMIT, limits.MaxUploadFileSizeBytes);
                  if (Number.isSafeInteger(limits.MaxDownloadFileSizeBytes) && limits.MaxDownloadFileSizeBytes >= 0) s.limits.download = Math.min(FILE_LIMIT, limits.MaxDownloadFileSizeBytes);
                  if (Number.isFinite(limits.MaxSingleWebcamStreamLengthSeconds) && limits.MaxSingleWebcamStreamLengthSeconds > 0) s.limits.stream = Math.min(STREAM_MS, limits.MaxSingleWebcamStreamLengthSeconds * 1000);
                }
              }
              send(res, status, scrub(result, s)); finish();
            } catch { finish(new Failure(502, 'Invalid OctoEverywhere JSON response.')); }
          });
        } else {
          const cap = limiter(Math.min(FILE_LIMIT, s.limits.download));
          res.writeHead(status, { 'content-type': file && json ? 'application/json' : /^(?:image\/jpeg|multipart\/x-mixed-replace\b|application\/octet-stream)/i.test(type) ? type : 'application/octet-stream' });
          if (file && json) {
            // Inspect only bounded error envelopes; successful files retain their exact bytes.
            let chunks: Buffer[] = [], size = 0;
            const envelope = new Transform({
              transform(chunk, _encoding, callback) {
                size += chunk.length;
                if (size <= JSON_LIMIT) chunks.push(Buffer.from(chunk));
                else { for (const part of chunks) this.push(part); chunks = []; this.push(chunk); }
                callback();
              },
              flush(callback) {
                if (chunks.length) {
                  const bytes = Buffer.concat(chunks);
                  let value;
                  try { value = JSON.parse(bytes.toString()); } catch { /* File data is opaque. */ }
                  if (value && Number.isInteger(value.Status) && value.Status >= 400 && Object.keys(value).every(key => ['Status', 'Error', 'Result'].includes(key))) this.push(Buffer.from(JSON.stringify(scrub(value, s))));
                  else this.push(bytes);
                }
                callback();
              }
            });
            envelope.on('error', error => finish(error));
            response.pipe(cap).pipe(envelope).pipe(res);
          } else response.pipe(cap).pipe(res);
          cap.on('error', error => { response.destroy(); finish(error); });
          res.once('finish', () => finish());
        }
        response.on('error', error => finish(error));
        response.on('aborted', () => finish(new Failure(502, 'Upstream transfer interrupted.')));
      });
      const cancel = () => { upstream.destroy(); finish(new Failure(499, 'Request closed.')); };
      const deadline = setTimeout(() => { upstream.destroy(); finish(new Failure(504, 'OctoEverywhere request timed out.')); }, stream ? s.limits.stream : raw ? 5 * 60_000 : 30_000);
      deadline.unref(); s.active.add(cancel); res.once('close', cancel);
      upstream.on('error', error => finish(error));
      if (body) upstream.end(JSON.stringify(body));
      else if (raw) {
        const cap = limiter(uploadLimit); cap.on('error', error => finish(error));
        req.on('aborted', cancel); req.pipe(cap).pipe(upstream);
      } else upstream.end();
    });
  }
  function consume(id: string, operation: 'http' | 'upgrade') {
    const ticket = tickets.get(id);
    if (!ticket || ticket.expires <= now() || (['websocket', 'mqtt'].includes(ticket.kind) !== (operation === 'upgrade'))) throw new Failure(401, 'Ticket expired or invalid for this operation.');
    const s = sessions.get(ticket.session);
    if (!s || s.expires <= now()) throw new Failure(401, 'Ticket session expired.');
    tickets.delete(id); return { ticket, s };
  }
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!(req.url === BASE || req.url?.startsWith(BASE + '/'))) return false;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    try {
      sweep();
      requireThat(req.url.length <= 32768 && !/[\\\x00-\x20]/.test(req.url) &&
        !/%|\/\.\.?($|\/)/i.test(req.url.split('?')[0]));
      const url = new URL(req.url, 'http://localhost'), route = url.pathname.slice(BASE.length), method = req.method ?? '';
      if (route === '/portal/callback') {
        if (!enabled || method !== 'GET' || !origin || req.headers.host !== origin.host) throw new Failure(403, 'Portal callback refused.');
        const p = url.searchParams;
        for (const name of p.keys()) requireThat(p.getAll(name).length === 1);
        const id = p.get('flowId') ?? '', f = flows.get(id);
        if (!f || f.state !== p.get('correlation') || f.result || f.expires <= now()) throw new Failure(403, 'Unsolicited or replayed portal callback.');
        // Mark spent before parsing credentials; invalid completion cannot be retried or overwritten.
        f.result = { status: 'failed', error: 'OctoEverywhere authorization did not complete. Try linking again.' };
        if (p.get('success') === 'true') {
          try {
            requireThat(!(p.has('authBearerToken') && (p.has('authBasicHttpUser') || p.has('authBasicHttpPassword'))));
            const c = connection({ connectionId: p.get('id'), url: p.get('url'), appApiToken: p.get('appApiToken'),
              auth: p.has('authBearerToken') ? { type: 'bearer', token: p.get('authBearerToken') }
                : { type: 'basic', username: p.get('authBasicHttpUser'), password: p.get('authBasicHttpPassword') },
              printerName: p.get('printername'), userFacingUrl: p.get('userPrinterAccessUrl'),
              ...(p.has('octoPrintApiKey') ? { nativeApiKey: p.get('octoPrintApiKey') } : {}) });
            f.result = { status: 'complete', connection: c };
          } catch { /* Failed result above deliberately contains no callback values. */ }
        }
        res.writeHead(303, { Location: BASE + '/portal/complete' }); res.end(); return true;
      }
      if (route === '/portal/complete' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Return to WebOrca to finish connecting. You can close this tab.'); return true;
      }
      if (!enabled) {
        if (route === '/config' && method === 'GET') { send(res, 200, { enabled: false, ...(appId ? { appId } : {}), portalAvailable: false }); return true; }
        throw new Failure(403, 'OctoEverywhere gateway is disabled. Configure ORCA_OCTOEVERYWHERE_ENABLED=1.');
      }
      sameOrigin(req);
      if (route === '/config' && method === 'GET') { send(res, 200, { enabled, ...(appId ? { appId } : {}), portalAvailable: enabled && !!appId }); return true; }
      if (route === '/portal/start' && method === 'POST') {
        if (!appId) throw new Failure(503, 'Set ORCA_OCTOEVERYWHERE_APP_ID to an assigned production App ID to link a printer.');
        if (flows.size >= 128) throw new Failure(429, 'Too many pending authorization flows.');
        const body = await readJson(req); keys(body, ['printerId', 'requestOctoPrintApiKey']); bools(body, ['requestOctoPrintApiKey']);
        if (flows.size >= 128) throw new Failure(429, 'Too many pending authorization flows.');
        const id = secret(), pollToken = secret(), correlation = secret();
        const printerId = body.printerId === undefined ? undefined : text(body.printerId, 256);
        const callback = new URL(BASE + '/portal/callback', origin);
        callback.searchParams.set('flowId', id); callback.searchParams.set('correlation', correlation);
        const portal = new URL('https://octoeverywhere.com/appportal/v1/');
        portal.searchParams.set('appid', appId); portal.searchParams.set('returnUrl', callback.href);
        if (printerId) portal.searchParams.set('printerId', printerId);
        if (body.requestOctoPrintApiKey) portal.searchParams.set('octoPrintApiKeyAppName', 'WebOrca');
        flows.set(id, { token: pollToken, state: correlation, expires: now() + FLOW_MS });
        send(res, 200, { portalUrl: portal.href, flowId: id, pollToken }); return true;
      }
      const flowMatch = /^\/portal\/result\/([\w-]+)$/.exec(route);
      if (flowMatch && ['GET', 'DELETE'].includes(method)) {
        requireThat(!url.search);
        const f = flows.get(flowMatch[1]);
        if (!f || req.headers['x-octoeverywhere-flow'] !== f.token) throw new Failure(401, 'Authorization flow expired or unauthorized.');
        if (method === 'DELETE') { flows.delete(flowMatch[1]); send(res, 200, { status: 'cancelled' }); }
        else { const result = f.result ?? { status: 'pending' }; if (f.result) flows.delete(flowMatch[1]); send(res, 200, result); }
        return true;
      }
      if (route === '/sessions' && method === 'POST') {
        requireThat(!url.search);
        if (sessions.size >= 128) throw new Failure(429, 'Too many OctoEverywhere sessions.');
        const body = await readJson(req); keys(body, ['connection', 'nativeApiKey']);
        const c = connection(body.connection);
        if (sessions.size >= 128) throw new Failure(429, 'Too many OctoEverywhere sessions.');
        if (body.nativeApiKey !== undefined) c.nativeApiKey = text(body.nativeApiKey);
        const sessionId = secret(), sessionToken = secret(), expiresAt = now() + SESSION_MS;
        sessions.set(sessionId, { token: sessionToken, c, expires: expiresAt, active: new Set(), limits: { upload: FILE_LIMIT, download: FILE_LIMIT, stream: STREAM_MS } });
        send(res, 200, { sessionId, sessionToken, expiresAt }); return true;
      }
      const ticketMatch = /^\/tickets\/([\w-]+)$/.exec(route);
      if (ticketMatch && method === 'GET') {
        requireThat(!url.search); const { ticket, s } = consume(ticketMatch[1], 'http');
        await relay(req, res, s, ticket.path, false, 'GET', undefined, false, ticket.kind === 'stream'); return true;
      }
      const match = /^\/sessions\/([\w-]+)(?:\/(.*))?$/.exec(route);
      if (!match) throw new Failure(404, 'Unknown OctoEverywhere route.');
      const id = match[1], operation = match[2] ?? '', s = getSession(id, req.headers['x-octoeverywhere-session']);
      if (!operation && method === 'DELETE') { requireThat(!url.search); destroy(id); send(res, 200, { status: 'closed' }); return true; }
      if (operation.startsWith('plugin/')) {
        const command = operation.slice(7); plugin(command, method, url.searchParams);
        const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
        const body = method === 'POST' && hasBody ? await readJson(req) : undefined;
        plugin(command, method, url.searchParams, method === 'POST' ? body ?? {} : undefined);
        await relay(req, res, s, '/octoeverywhere-command-api/' + command + url.search, false, method, body, method === 'PUT', command === 'webcam/stream'); return true;
      }
      if (operation.startsWith('native/')) {
        const path = '/' + operation.slice(7); native(path, method, url.searchParams);
        // Native host Authorization cannot coexist with provider Authorization; no header passthrough workaround.
        requireThat(req.headers.authorization === undefined, 'Native Authorization is unsupported; use the common APIs.');
        await relay(req, res, s, path + url.search, false, method, undefined, !['GET', 'HEAD'].includes(method)); return true;
      }
      requireThat(!url.search);
      if (operation === 'ticket' && method === 'POST') {
        const body = await readJson(req); keys(body, ['kind', 'index', 'path']);
        requireThat(['snapshot', 'stream', 'websocket', 'mqtt'].includes(String(body.kind)));
        let path: string;
        if (body.kind === 'websocket') { requireThat(body.path === '/websocket' && body.index === undefined, 'Only the Moonraker /websocket native socket is supported.'); path = '/websocket'; }
        else if (body.kind === 'mqtt') { requireThat(body.path === undefined && body.index === undefined); path = '/octoeverywhere-command-api/proxy/mqtt'; }
        else { requireThat(body.path === undefined); if (body.index !== undefined) finite(body.index, 0, 9999, true); path = '/octoeverywhere-command-api/webcam/' + body.kind + (body.index === undefined ? '' : '?index=' + body.index); }
        let count = 0; for (const t of tickets.values()) if (t.session === id) count++;
        if (count >= 16 || tickets.size >= 1024) throw new Failure(429, 'Too many pending tickets.');
        const token = secret(), expiresAt = Math.min(s.expires, now() + TICKET_MS);
        tickets.set(token, { session: id, path, kind: String(body.kind), expires: expiresAt });
        send(res, 200, { url: BASE + '/tickets/' + token, expiresAt }); return true;
      }
      let path: string, upstreamMethod = method;
      const body = ['POST', 'DELETE'].includes(method) ? await readJson(req) : {};
      if (operation === 'info' && method === 'GET') { path = '/api/appconnection/info'; keys(body, []); }
      else if (operation === 'gadget' && method === 'POST') {
        keys(body, []);
        const key = createHash('sha256').update(s.c.connectionId + '\0' + s.c.appApiToken).digest('hex');
        if ((gadgetPolls.get(key) ?? -Infinity) + 10_000 > now()) throw new Failure(429, 'Gadget polling is limited to once per 10 seconds per connection.');
        if (gadgetPolls.size >= 1024) throw new Failure(429, 'Too many active Gadget connections.');
        gadgetPolls.set(key, now()); path = '/api/gadget/GetStatusFromAppConnection';
      } else if (operation === 'live-link' && method === 'POST') {
        keys(body, ['ExpirationHours', 'EndWhenCurrentPrintIsComplete']); bools(body, ['EndWhenCurrentPrintIsComplete']);
        if (body.ExpirationHours !== undefined) finite(body.ExpirationHours, 1, 17520);
        path = '/api/live/createfromappconnection';
      } else if (operation === 'notifications' && method === 'POST') {
        keys(body, ['WebhookUrl', 'InclusiveEventTypesFilter']);
        const callback = new URL(text(body.WebhookUrl));
        requireThat(callback.protocol === 'https:' && !callback.username && !callback.password && !callback.hash && !callback.port && !isIP(callback.hostname), 'A public HTTPS webhook URL is required.');
        await address(callback.hostname);
        if (body.InclusiveEventTypesFilter !== undefined) { requireThat(Array.isArray(body.InclusiveEventTypesFilter) && body.InclusiveEventTypesFilter.length <= 128); for (const n of body.InclusiveEventTypesFilter) finite(n, 0, 65535, true); }
        path = '/api/appconnection/SetNotificationWebhook';
      } else if (operation === 'notifications' && method === 'DELETE') { keys(body, []); path = '/api/appconnection/DeleteNotificationWebhook'; upstreamMethod = 'POST'; }
      else if (operation === 'notifications/test' && method === 'POST') { keys(body, []); path = '/api/appconnection/TestWebhook'; upstreamMethod = 'GET'; }
      else throw new Failure(404, 'Unknown OctoEverywhere route or method.');
      await relay(req, res, s, path, true, upstreamMethod, upstreamMethod === 'POST' ? body : undefined); return true;
    } catch (error) {
      send(res, error instanceof Failure ? error.status : 400, { error: error instanceof Failure ? error.message : 'Invalid OctoEverywhere request.' }); return true;
    }
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
    if (!req.url?.startsWith(BASE + '/')) return false;
    try {
      sweep(); sameOrigin(req);
      if (!enabled) throw new Failure(403, 'Gateway disabled.');
      const match = new RegExp('^' + BASE + '/tickets/([\\w-]+)$').exec(req.url);
      requireThat(match);
      const { ticket, s } = consume(match[1], 'upgrade'); reserve(s);
      const target = new URL(s.c.url), resolved = await address(target.hostname);
      if (!sessions.has(ticket.session) || s.expires <= now()) throw new Failure(401, 'Session expired.');
      reserve(s);
      const protocolHeader = req.headers['sec-websocket-protocol'];
      requireThat(protocolHeader === undefined || ticket.kind === 'mqtt' && protocolHeader === 'mqtt');
      const protocols = ticket.kind === 'mqtt' && protocolHeader === 'mqtt' ? ['mqtt'] : [];
      const upstream = new (options.webSocket ?? WebSocket)('wss://' + target.host + ticket.path, protocols, {
        headers: { Authorization: auth(s), ...(s.c.nativeApiKey && ticket.kind === 'websocket' ? { 'X-Api-Key': s.c.nativeApiKey } : {}) },
        followRedirects: false, handshakeTimeout: 15_000, perMessageDeflate: false, maxPayload: 1024 * 1024,
        lookup: pinnedLookup(resolved), family: resolved.family
      });
      let browser: WebSocket | undefined;
      const close = () => { clearTimeout(deadline); upstream.terminate(); browser?.terminate(); socket.destroy(); s.active.delete(close); };
      const deadline = setTimeout(close, Math.min(s.expires - now(), 5 * 60_000)); deadline.unref();
      s.active.add(close); socket.once('close', close);
      upstream.once('error', close); upstream.once('close', close);
      upstream.once('unexpected-response', (_request, response) => { response.destroy(); close(); });
      upstream.once('open', () => {
        if (!sessions.has(ticket.session) || socket.destroyed) return close();
        wss.handleUpgrade(req, socket, head, ws => {
          browser = ws;
          const forward = (from: WebSocket, to: WebSocket) => from.on('message', (data, binary) => {
            if (to.readyState !== WebSocket.OPEN || to.bufferedAmount > 2 * 1024 * 1024) return close();
            to.send(data, { binary }, error => { if (error) close(); });
          });
          forward(ws, upstream); forward(upstream, ws); ws.once('close', close); ws.once('error', close);
        });
      });
    } catch (error) {
      socket.end(`HTTP/1.1 ${error instanceof Failure ? error.status : 400} Rejected\r\nConnection: close\r\n\r\n`);
    }
    return true;
  }
  return { handle, handleUpgrade, close() { clearInterval(timer); for (const id of sessions.keys()) destroy(id); flows.clear(); tickets.clear(); gadgetPolls.clear(); wss.close(); } };
}
