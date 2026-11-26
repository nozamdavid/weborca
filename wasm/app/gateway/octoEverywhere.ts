/** Optional stateless same-origin OctoEverywhere boundary. Zero stored credentials or arbitrary proxy targets. */
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { Transform } from 'node:stream';
import type { Duplex } from 'node:stream';

const BASE = '/_octoeverywhere';
const JSON_LIMIT = 2 * 1024 * 1024;
const FILE_LIMIT = 5 * 1024 ** 3;
const STREAM_MS = 5 * 60_000;
type Json = Record<string, unknown>;
export interface OctoEverywhereOptions {
  enabled?: boolean; appId?: string; publicOrigin?: string;
  /** Synthetic transport seams. Never sourced from an HTTP request or environment. */
  resolver?: (host: string) => Promise<{ address: string; family: number }[]>;
  request?: typeof https.request;
  now?: () => number;
}
class Failure extends Error {
  status: number;
  readonly reason?: 'upstream_redirect';
  constructor(status: number, message: string, reason?: 'upstream_redirect') {
    super(message);
    this.status = status;
    this.reason = reason;
  }
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
function parseIntHeader(value: unknown, min: number, max: number, message: string): number {
  const raw = text(value, 32);
  requireThat(/^\d+$/.test(raw), message);
  const parsed = Number(raw);
  requireThat(Number.isSafeInteger(parsed) && parsed >= min && parsed <= max, message);
  return parsed;
}
function parseAuthHeader(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const authHeader = text(value, 4096);
  requireThat(/^(?:Bearer [^\s\x00-\x1f\x7f]+|Basic [A-Za-z0-9+/=]+)$/.test(authHeader), 'Invalid OctoEverywhere auth header.');
  return authHeader;
}
function extractSecrets({ appToken, authHeader, nativeKey }: { appToken?: string; authHeader?: string; nativeKey?: string }): string[] {
  const out: string[] = [];
  const push = (value: string | undefined) => { if (value) out.push(value); };
  push(appToken);
  push(nativeKey);
  if (authHeader) {
    push(authHeader);
    if (authHeader.startsWith('Bearer ')) {
      push(authHeader.slice(7));
    } else if (authHeader.startsWith('Basic ')) {
      const encoded = authHeader.slice(6);
      push(encoded);
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      if (colon >= 0) {
        push(decoded.slice(0, colon));
        push(decoded.slice(colon + 1));
      } else {
        push(decoded);
      }
    }
  }
  return out;
}
function providerUrl(value: unknown, root: boolean): URL {
  const url = new URL(text(value));
  // Decode each name segment, never a whole path: encoded separators must not
  // create a second route or hide credentials/control characters in an Open link.
  const safeUserPath = url.pathname.split('/').every(segment => {
    const decoded = decodeURIComponent(segment);
    return !/[\x00-\x1f\x7f\\/@?#%]/.test(decoded) && decoded !== '.' && decoded !== '..';
  });
  const subHost = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.octoeverywhere\.com$/.test(url.hostname);
  const validUserUrl = (subHost && url.pathname === '/') ||
    (url.hostname === 'octoeverywhere.com' && (url.pathname === '/' || (/^\/view\/[^/]+\/?$/.test(url.pathname) && safeUserPath)));
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
    (root ? subHost && url.pathname === '/' : validUserUrl), 'Invalid OctoEverywhere URL.');
  return url;
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
function scrub(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const v of secrets) if (v) for (const form of [v, encodeURIComponent(v)]) out = out.split(form).join('[redacted]');
    return out;
  }
  if (Array.isArray(value)) return value.map(v => scrub(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, scrub(v, secrets)]));
  return value;
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
interface RelayContext {
  target: URL;
  app: boolean;
  appToken?: string;
  authHeader?: string;
  nativeKey?: string;
  secrets: string[];
  path: string;
  method: string;
  body?: Json;
  raw: boolean;
  stream: boolean;
  maxBytes: number;
  streamMs: number;
}

export function createOctoEverywhereGateway(options: OctoEverywhereOptions = {}) {
  const enabled = options.enabled ?? process.env.ORCA_OCTOEVERYWHERE_ENABLED === '1';
  const appId = 'appId' in options
    ? (options.appId || undefined)
    : process.env.ORCA_OCTOEVERYWHERE_APP_ID !== undefined
      ? (process.env.ORCA_OCTOEVERYWHERE_APP_ID || undefined)
      : 'weborca';
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
  const active = new Set<() => void>();
  const gadgetPolls = new Map<string, number>();
  function sweep() {
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
  function reserve() {
    if (active.size >= 128) throw new Failure(429, 'Too many active OctoEverywhere requests.');
  }
  async function relay(req: IncomingMessage, res: ServerResponse, ctx: RelayContext) {
    reserve();
    const route = ctx.path.split('?')[0];
    const authType = ctx.app ? 'app' : ctx.authHeader?.startsWith('Bearer ') ? 'bearer' : ctx.authHeader?.startsWith('Basic ') ? 'basic' : 'none';
    const safeContentType = (value: unknown) => typeof value === 'string' ? value.split(';')[0].trim().slice(0, 64) || null : null;
    const safeErrorCode = (error: unknown) => {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
    };
    const warnRelay = (details: { status?: number | null; pluginStatus?: number | null; contentType?: string | null; errorCode?: string | null; reason: string }) => {
      console.warn('[octoeverywhere] relay error', JSON.stringify({
        route,
        app: ctx.app,
        method: ctx.method,
        status: details.status ?? null,
        pluginStatus: details.pluginStatus ?? null,
        authType,
        contentType: details.contentType ?? null,
        errorCode: details.errorCode ?? null,
        reason: details.reason
      }));
    };
    const resolved = await new Promise<Awaited<ReturnType<typeof address>>>((resolve, reject) => {
      const cleanup = () => { clearTimeout(dnsTimer); res.off('close', cancel); req.off('aborted', cancel); active.delete(cancel); };
      const cancel = () => { cleanup(); reject(new Failure(499, 'Request closed.')); };
      const dnsTimer = setTimeout(() => { cleanup(); reject(new Failure(504, 'Upstream DNS timed out.')); }, 15_000);
      dnsTimer.unref(); active.add(cancel); res.once('close', cancel); req.once('aborted', cancel);
      if (res.destroyed || req.aborted) return cancel();
      address(ctx.target.hostname).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    }).catch(error => {
      if (!(error instanceof Failure && error.status === 499)) {
        warnRelay({ status: error instanceof Failure ? error.status : null, errorCode: safeErrorCode(error), reason: error instanceof Failure && error.status === 504 ? 'dns_timeout' : 'dns_error' });
      }
      throw error;
    });
    if (res.destroyed || req.aborted) throw new Failure(499, 'Request closed.');
    const headers: Record<string, string> = {
      'User-Agent': 'WebOrca/1.0',
      ...(ctx.app ? { AppToken: ctx.appToken! } : ctx.authHeader ? { Authorization: ctx.authHeader } : {})
    };
    if (!ctx.app && !ctx.path.startsWith('/octoeverywhere-command-api/') && ctx.nativeKey) headers['X-Api-Key'] = ctx.nativeKey;
    if (ctx.body) headers['Content-Type'] = 'application/json';
    else if (ctx.raw && req.headers['content-type']) headers['Content-Type'] = text(req.headers['content-type'], 256);
    const fileUpload = ctx.path.startsWith('/octoeverywhere-command-api/files/upload?') || ctx.path.startsWith('/server/files/upload') || /^\/api\/(?:files\/local|v1\/files\/)/.test(ctx.path);
    const uploadLimit = Math.min(fileUpload ? FILE_LIMIT : JSON_LIMIT, ctx.maxBytes);
    if (ctx.raw && req.headers['content-length'] !== undefined) {
      const length = Number(req.headers['content-length']);
      requireThat(Number.isSafeInteger(length) && length >= 0);
      if (length > uploadLimit) throw new Failure(413, 'Upload exceeds the allowed byte limit.');
      headers['Content-Length'] = String(length);
    }
    reserve(); // DNS is asynchronous; recheck capacity before attaching a transfer.
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      let upstreamResponse: IncomingMessage | undefined;
      const finish = (error?: Error) => {
        if (finished) return; finished = true;
        clearTimeout(deadline); active.delete(cancel); res.off('close', cancel); req.off('aborted', cancel);
        if (ctx.raw) { req.unpipe(); req.resume(); }
        if (error) { upstreamResponse?.destroy(); upstream.destroy(); reject(error instanceof Failure ? error : new Failure(502, 'OctoEverywhere upstream request failed.')); } else resolve();
      };
      const upstream = (options.request ?? https.request)({ hostname: ctx.target.hostname, port: 443, servername: ctx.target.hostname,
        path: ctx.path, method: ctx.method, headers, agent: false,
        lookup: pinnedLookup(resolved), family: resolved.family
      }, response => {
        upstreamResponse = response;
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          warnRelay({ status, contentType: safeContentType(response.headers['content-type']), reason: 'upstream_redirect' });
          response.destroy(); return finish(new Failure(502, 'Upstream redirect refused.', 'upstream_redirect'));
        }
        if (status >= 400) {
          warnRelay({ status, contentType: safeContentType(response.headers['content-type']), reason: 'upstream_http_error' });
          response.destroy(); send(res, status, { error: 'OctoEverywhere rejected the request.', code: status }); return finish();
        }
        if (ctx.app && ['/api/appconnection/SetNotificationWebhook', '/api/appconnection/DeleteNotificationWebhook'].includes(ctx.path)) {
          response.destroy(); send(res, status, { success: true }); return finish();
        }
        const type = String(response.headers['content-type'] ?? 'application/octet-stream');
        const json = /\bjson\b/.test(type);
        const file = !ctx.app && ctx.method === 'GET' && (ctx.path.startsWith('/octoeverywhere-command-api/files/download?') || /^attachment\b/i.test(String(response.headers['content-disposition'] ?? '')));
        if ((json && !file) || ctx.app) {
          const chunks: Buffer[] = []; let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > JSON_LIMIT) {
              if (!finished) warnRelay({ status, contentType: safeContentType(type), reason: 'json_too_large' });
              response.destroy(); finish(new Failure(502, 'Upstream JSON exceeds gateway limit.'));
            }
            else chunks.push(Buffer.from(chunk));
          });
          response.on('end', () => {
            try {
              const rawText = Buffer.concat(chunks).toString();
              const result = rawText ? JSON.parse(rawText) : {};
              let payload: unknown = result;
              if (result && typeof result === 'object' && !Array.isArray(result) && typeof result.Status === 'number') {
                if (result.Status >= 400) {
                  warnRelay({ status, pluginStatus: result.Status, contentType: safeContentType(type), reason: ctx.app ? 'app_api_status_error' : 'plugin_status_error' });
                  if (ctx.app) {
                    const httpStatus = Number.isInteger(result.Status) && result.Status <= 999 ? result.Status : 502;
                    send(res, httpStatus, { error: 'OctoEverywhere rejected the request.', code: result.Status });
                    finish();
                    return;
                  }
                } else if (ctx.app && result.Status === 200 && result.Result && typeof result.Result === 'object' && !Array.isArray(result.Result)) {
                  payload = result.Result as Json;
                }
              }
              send(res, status, scrub(payload, ctx.secrets)); finish();
            } catch {
              if (!finished) warnRelay({ status, contentType: safeContentType(type), reason: 'invalid_json' });
              finish(new Failure(502, 'Invalid OctoEverywhere JSON response.'));
            }
          });
        } else {
          const cap = limiter(Math.min(FILE_LIMIT, ctx.maxBytes));
          res.writeHead(status, { 'content-type': file && json ? 'application/json' : /^(?:image\/(?:jpeg|jpg|png|webp)|multipart\/x-mixed-replace\b|application\/octet-stream)/i.test(type) ? type : 'application/octet-stream' });
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
                  if (value && Number.isInteger(value.Status) && value.Status >= 400 && Object.keys(value).every(key => ['Status', 'Error', 'Result'].includes(key))) {
                    warnRelay({ status, pluginStatus: value.Status, contentType: safeContentType(type), reason: 'plugin_status_error' });
                    this.push(Buffer.from(JSON.stringify(scrub(value, ctx.secrets))));
                  } else this.push(bytes);
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
        response.on('error', error => {
          if (!finished) warnRelay({ status, contentType: safeContentType(response.headers['content-type']), errorCode: safeErrorCode(error), reason: 'response_error' });
          finish(error);
        });
        response.on('aborted', () => {
          if (!finished) warnRelay({ status, contentType: safeContentType(response.headers['content-type']), reason: 'response_aborted' });
          finish(new Failure(502, 'Upstream transfer interrupted.'));
        });
      });
      const cancel = () => finish(new Failure(499, 'Request closed.'));
      const deadline = setTimeout(() => {
        if (!finished) warnRelay({ status: 504, reason: 'upstream_timeout' });
        finish(new Failure(504, 'OctoEverywhere request timed out.'));
      }, ctx.stream ? ctx.streamMs : ctx.raw ? 5 * 60_000 : 30_000);
      deadline.unref(); active.add(cancel); res.once('close', cancel);
      upstream.on('error', error => {
        if (!finished) warnRelay({ errorCode: safeErrorCode(error), reason: 'upstream_error' });
        finish(error);
      });
      if (ctx.body) upstream.end(JSON.stringify(ctx.body));
      else if (ctx.raw) {
        const cap = limiter(uploadLimit); cap.on('error', error => finish(error));
        req.on('aborted', cancel); req.pipe(cap).pipe(upstream);
      } else upstream.end();
    });
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
      if (!enabled) {
        if (route === '/config' && method === 'GET') { send(res, 200, { enabled: false, ...(appId ? { appId } : {}), portalAvailable: false }); return true; }
        throw new Failure(403, 'OctoEverywhere gateway is disabled. Configure ORCA_OCTOEVERYWHERE_ENABLED=1.');
      }
      sameOrigin(req);
      if (route === '/config' && method === 'GET') { send(res, 200, { enabled, ...(appId ? { appId } : {}), portalAvailable: enabled && !!appId }); return true; }
      if (route.startsWith('/plugin/')) {
        const command = route.slice('/plugin/'.length);
        plugin(command, method, url.searchParams);
        const target = providerUrl(req.headers['x-octoeverywhere-target'], true);
        const authHeader = parseAuthHeader(req.headers['x-octoeverywhere-auth']);
        const streamMs = command === 'webcam/stream' && req.headers['x-octoeverywhere-stream-seconds'] !== undefined
          ? parseIntHeader(req.headers['x-octoeverywhere-stream-seconds'], 1, 300, 'Invalid stream duration.') * 1000
          : STREAM_MS;
        const maxBytes = (command === 'files/upload' || command === 'files/download') && req.headers['x-octoeverywhere-max-bytes'] !== undefined
          ? parseIntHeader(req.headers['x-octoeverywhere-max-bytes'], 0, FILE_LIMIT, 'Invalid byte limit.')
          : FILE_LIMIT;
        const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
        const body = method === 'POST' && hasBody ? await readJson(req) : undefined;
        plugin(command, method, url.searchParams, method === 'POST' ? body ?? {} : undefined);
        await relay(req, res, {
          target, app: false, authHeader, secrets: extractSecrets({ authHeader }),
          path: '/octoeverywhere-command-api/' + command + url.search,
          method, body, raw: method === 'PUT', stream: command === 'webcam/stream',
          maxBytes, streamMs
        });
        return true;
      }
      if (route.startsWith('/native/')) {
        const path = '/' + route.slice('/native/'.length);
        native(path, method, url.searchParams);
        // Native host Authorization cannot coexist with provider Authorization; no header passthrough workaround.
        requireThat(req.headers.authorization === undefined, 'Native Authorization is unsupported; use the common APIs.');
        const target = providerUrl(req.headers['x-octoeverywhere-target'], true);
        const authHeader = parseAuthHeader(req.headers['x-octoeverywhere-auth']);
        const nativeKey = req.headers['x-octoeverywhere-native-key'] === undefined
          ? undefined
          : text(req.headers['x-octoeverywhere-native-key'], 4096);
        await relay(req, res, {
          target, app: false, authHeader, nativeKey, secrets: extractSecrets({ authHeader, nativeKey }),
          path: path + url.search, method, raw: !['GET', 'HEAD'].includes(method),
          stream: false, maxBytes: FILE_LIMIT, streamMs: STREAM_MS
        });
        return true;
      }
      const isAppRoute =
        (route === '/info' && method === 'GET') ||
        (route === '/gadget' && method === 'POST') ||
        (route === '/live-link' && method === 'POST') ||
        (route === '/notifications' && (method === 'POST' || method === 'DELETE')) ||
        (route === '/notifications/test' && method === 'POST');
      if (!isAppRoute) throw new Failure(404, 'Unknown OctoEverywhere route or method.');
      requireThat(!url.search);
      const appToken = text(req.headers['x-octoeverywhere-app-token'], 4096);
      let path: string, upstreamMethod = method;
      const body = ['POST', 'DELETE'].includes(method) ? await readJson(req) : {};
      if (route === '/info') { path = '/api/appconnection/info'; keys(body, []); }
      else if (route === '/gadget') {
        keys(body, []);
        const connectionId = req.headers['x-octoeverywhere-connection-id'] === undefined
          ? ''
          : text(req.headers['x-octoeverywhere-connection-id'], 512);
        sweep();
        const key = createHash('sha256').update(connectionId + '\0' + appToken).digest('hex');
        if ((gadgetPolls.get(key) ?? -Infinity) + 10_000 > now()) throw new Failure(429, 'Gadget polling is limited to once per 10 seconds per connection.');
        if (gadgetPolls.size >= 1024) throw new Failure(429, 'Too many active Gadget connections.');
        gadgetPolls.set(key, now()); path = '/api/gadget/GetStatusFromAppConnection';
      } else if (route === '/live-link') {
        keys(body, ['ExpirationHours', 'EndWhenCurrentPrintIsComplete']); bools(body, ['EndWhenCurrentPrintIsComplete']);
        if (body.ExpirationHours !== undefined) finite(body.ExpirationHours, 1, 17520);
        path = '/api/live/createfromappconnection';
      } else if (route === '/notifications' && method === 'POST') {
        keys(body, ['WebhookUrl', 'InclusiveEventTypesFilter']);
        const callback = new URL(text(body.WebhookUrl));
        requireThat(callback.protocol === 'https:' && !callback.username && !callback.password && !callback.hash && !callback.port && !isIP(callback.hostname), 'A public HTTPS webhook URL is required.');
        await address(callback.hostname);
        if (body.InclusiveEventTypesFilter !== undefined) { requireThat(Array.isArray(body.InclusiveEventTypesFilter) && body.InclusiveEventTypesFilter.length <= 128); for (const n of body.InclusiveEventTypesFilter) finite(n, 0, 65535, true); }
        path = '/api/appconnection/SetNotificationWebhook';
      } else if (route === '/notifications' && method === 'DELETE') {
        keys(body, []); path = '/api/appconnection/DeleteNotificationWebhook'; upstreamMethod = 'POST';
      } else {
        keys(body, []); path = '/api/appconnection/TestWebhook'; upstreamMethod = 'GET';
      }
      await relay(req, res, {
        target: new URL('https://octoeverywhere.com'), app: true, appToken,
        secrets: extractSecrets({ appToken }),
        path, method: upstreamMethod, body: upstreamMethod === 'POST' ? body : undefined,
        raw: false, stream: false, maxBytes: FILE_LIMIT, streamMs: STREAM_MS
      });
      return true;
    } catch (error) {
      if (error instanceof Failure) {
        send(res, error.status, { error: error.message, ...(error.reason ? { reason: error.reason } : {}) });
      } else {
        send(res, 400, { error: 'Invalid OctoEverywhere request.' });
      }
      return true;
    }
  }
  async function handleUpgrade(_req?: IncomingMessage, _socket?: Duplex, _head?: Buffer): Promise<boolean> {
    return false;
  }
  return {
    handle,
    handleUpgrade,
    close() {
      clearInterval(timer);
      for (const cancel of [...active]) cancel();
      active.clear();
      gadgetPolls.clear();
    }
  };
}
