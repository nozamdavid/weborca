/** Static staging server with explicitly enabled, restricted cloud bridges. */
import http from 'node:http';
import { embedderPolicy } from './coep.mjs';
import { createThumbnailHandler } from './model-thumbnail.mjs';
const modelThumbnail = createThumbnailHandler();
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { brotliCompress, constants as zc, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(process.env.ORCA_ROOT || fileURLToPath(new URL('./dist/', import.meta.url)));
const allowedHosts = new Set([process.env.ORCA_HOST || 'weborca.noz.am', ...(process.env.ORCA_EXTRA_HOSTS || '').split(',').filter(Boolean), 'localhost', '127.0.0.1', '[::1]']);
const port = Number(process.env.PORT || 8080);
const coep = process.env.ORCA_COEP || 'require-corp';
if (!['require-corp', 'credentialless'].includes(coep)) throw new Error('Invalid ORCA_COEP');
const bindAddress = process.env.ORCA_BIND || '0.0.0.0';
let cloud;
let printerCloud;
let octoEverywhere;
let alpha;
if (process.env.ORCA_ALPHA_GATE_ENABLED && !['0', '1'].includes(process.env.ORCA_ALPHA_GATE_ENABLED)) {
  throw new Error('ORCA_ALPHA_GATE_ENABLED must be 0 or 1');
}
if (process.env.ORCA_ALPHA_GATE_ENABLED === '1') {
  let bridge;
  try { bridge = await import(pathToFileURL(path.join(root, 'alpha-access.mjs')).href); }
  catch { throw new Error('Alpha is enabled but its packaged alpha-access.mjs could not be loaded from ORCA_ROOT.'); }
  alpha = bridge.createAlphaAccess({ webRoot: root });
}
const printerServices = (process.env.ORCA_PRINTER_CLOUD || '').split(',').map(id => id.trim().toLowerCase())
  .filter(id => id === 'prusa-connect' || id === 'creality-cloud' || id === 'bambu-cloud' || id === 'snapmaker-cloud');
let publicOrigin;
if (process.env.ORCA_CLOUD_ENABLED === '1' || printerServices.length > 0 || process.env.ORCA_OCTOEVERYWHERE_ENABLED === '1' || alpha) {
  try {
    publicOrigin = new URL(process.env.ORCA_PUBLIC_ORIGIN);
    if (publicOrigin.href !== `${publicOrigin.origin}/` || publicOrigin.username || publicOrigin.password ||
        !(publicOrigin.protocol === 'https:' || (publicOrigin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(publicOrigin.hostname)))) {
      throw new Error();
    }
  } catch { throw new Error('Cloud bridges require a canonical ORCA_PUBLIC_ORIGIN (HTTPS or HTTP loopback).'); }
  allowedHosts.add(publicOrigin.hostname);
}
if (process.env.ORCA_OCTOEVERYWHERE_ENABLED === '1') {
  let bridge;
  try { bridge = await import(pathToFileURL(path.join(root, 'octoeverywhere-bridge.mjs')).href); }
  catch { throw new Error('OctoEverywhere is enabled but its packaged octoeverywhere-bridge.mjs could not be loaded from ORCA_ROOT.'); }
  octoEverywhere = bridge.createOctoEverywhereGateway({ enabled: true, publicOrigin: publicOrigin.origin });
}
if (printerServices.length > 0) {
  let bridge;
  try { bridge = await import(pathToFileURL(path.join(root, 'printer-cloud-bridge.mjs')).href); }
  catch { throw new Error('Printer Cloud is enabled but its packaged printer-cloud-bridge.mjs could not be loaded from ORCA_ROOT.'); }
  printerCloud = bridge.createHostedPrinterCloudBridge(printerServices.join(','), publicOrigin.origin);
}
if (process.env.ORCA_CLOUD_ENABLED === '1') {
  let bridge;
  try { bridge = await import(pathToFileURL(path.join(root, 'orca-cloud-bridge.mjs')).href); }
  catch { throw new Error('Orca Cloud is enabled but its packaged orca-cloud-bridge.mjs could not be loaded from ORCA_ROOT.'); }
  const callback = process.env.ORCA_CLOUD_CALLBACK || 'http://localhost:41172/callback';
  bridge.callbackUrl(callback);
  cloud = bridge.createOrcaCloudBridge({
    enabled: true, callback,
    callbackConfirmed: process.env.ORCA_CLOUD_CALLBACK_CONFIRMED === '1',
    presetWrites: process.env.ORCA_CLOUD_PRESET_WRITES === '1'
  });
}
const compressible = new Set(['.html', '.js', '.mjs', '.css', '.wasm', '.json', '.svg', '.txt']);
const brotli = promisify(brotliCompress);
const gz = promisify(gzip);
// Compressed once per file version and kept in memory: the engine is 30 MB, so compressing per request would be far too slow.
const compressed = new Map();
let enginePair;
// Bind the loader and binary together, including loader-only releases. Hash by
// stream once per file version; deployment roots are immutable.
async function engineVersion() {
  const files = ['orca_engine.mjs', 'orca_engine.wasm'].map(name => path.join(root, 'engine', name));
  const infos = await Promise.all(files.map(file => stat(file)));
  const key = infos.map(info => `${info.size}:${info.mtimeMs}:${info.ctimeMs}`).join('|');
  if (enginePair?.key !== key) {
    const version = (async () => {
      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(path.basename(file));
        for await (const chunk of createReadStream(file)) hash.update(chunk);
      }
      return hash.digest('hex');
    })();
    enginePair = { key, version };
    version.catch(() => { if (enginePair?.version === version) enginePair = undefined; });
  }
  return enginePair.version;
}
function compressedBody(file, info, encoding) {
  const key = `${file}|${info.size}|${info.mtimeMs}|${encoding}`;
  let entry = compressed.get(key);
  if (!entry) {
    entry = readFile(file).then((raw) => encoding === 'br'
      ? brotli(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 9, [zc.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      : gz(raw, { level: 9 }));
    entry.catch(() => compressed.delete(key));
    for (const old of compressed.keys()) if (old.startsWith(`${file}|`)) compressed.delete(old);
    compressed.set(key, entry);
  }
  return entry;
}
function pickEncoding(header = '') {
  const accepted = header.split(',').map((part) => part.trim().split(';')[0]);
  return accepted.includes('br') ? 'br' : accepted.includes('gzip') ? 'gzip' : undefined;
}
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const assetRoute = /^\/(?:assets|engine|preview|profiles|resources|settings|web|_printer|_gw)(?:\/|$)/;
function reply(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function validateCloudOrigin(req) {
  // Bind to the configured public authority, including port; ignore forwarded headers.
  if (req.headers.host !== publicOrigin.host ||
      (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') ||
      (req.headers.origin !== undefined && req.headers.origin !== publicOrigin.origin)) return false;
  // Browser GET fetches may omit Origin only with strict same-origin metadata.
  if (req.headers.origin === undefined && req.method === 'GET' &&
      req.headers['sec-fetch-site'] === 'same-origin' &&
      ['cors', 'same-origin'].includes(req.headers['sec-fetch-mode']) && req.headers['sec-fetch-dest'] === 'empty') {
    req.headers.origin = publicOrigin.origin;
  }
  return req.headers.origin === publicOrigin.origin;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', embedderPolicy(coep, req.headers['user-agent']));
  res.setHeader('Vary', 'User-Agent, Accept-Encoding');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    const host = new URL(`http://${req.headers.host || ''}`).hostname;
    if (!allowedHosts.has(host)) return reply(res, 421, 'Unexpected host');
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (alpha) {
      if (await alpha.guard(req, res)) return;
    } else if (pathname === '/_alpha' || pathname.startsWith('/_alpha/')) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      const config = pathname === '/_alpha/config' && req.method === 'GET';
      res.writeHead(config ? 200 : 403);
      return res.end(JSON.stringify(config ? { enabled: false } : { error: 'Alpha gate is disabled' }));
    }
    if (pathname === '/_octoeverywhere' || pathname.startsWith('/_octoeverywhere/')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (!octoEverywhere) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(pathname === '/_octoeverywhere/config' && req.method === 'GET' ? 200 : 403);
        return res.end(JSON.stringify(pathname === '/_octoeverywhere/config' && req.method === 'GET'
          ? { enabled: false, portalAvailable: false } : { error: 'OctoEverywhere gateway is disabled.' }));
      }
      if (await octoEverywhere.handle(req, res)) return;
      return reply(res, 404, 'Unknown OctoEverywhere route.');
    }
    if (pathname === '/_orca-cloud' || pathname.startsWith('/_orca-cloud/')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (!cloud) return reply(res, 403, 'Orca Cloud bridge is disabled.');
      if (!validateCloudOrigin(req)) {
        return reply(res, 403, 'Orca Cloud requires the configured app origin.');
      }
      if (await cloud.handle(req, res, publicOrigin.origin)) return;
      return reply(res, 404, 'Unknown Orca Cloud route.');
    }
    if (pathname === '/_printer' || pathname.startsWith('/_printer/') || pathname === '/_gw' || pathname.startsWith('/_gw/')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (pathname !== '/_printer/status' && !pathname.startsWith('/_printer/prusa-connect/') && !pathname.startsWith('/_printer/creality-cloud/') && !pathname.startsWith('/_printer/bambu-cloud/api/') && !pathname.startsWith('/_printer/snapmaker-cloud/')) {
        return reply(res, 404, 'Unknown printer cloud route.');
      }
      if (!printerCloud) return reply(res, 403, 'Printer Cloud bridge is disabled.');
      if (!validateCloudOrigin(req)) return reply(res, 403, 'Printer Cloud requires the configured app origin.');
      await printerCloud.handle(req, res, pathname);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');
    if (pathname === '/orca-cloud/callback' || pathname === '/octoeverywhere/callback' || pathname.startsWith('/octoeverywhere/callback/')) {
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
    }
    if (pathname === '/_model-thumbnail' || pathname === '/_model-thumbnail/v300') return await modelThumbnail(req, res);
    if (pathname === '/healthz') return reply(res, 200, 'ok');
    if (pathname === '/app-config.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({
        mobileSliceSteps: process.env.MOBILE_SLICE_STEPS ?? 'layer_height,wall_loops,sparse_infill_density,sparse_infill_pattern,enable_support,support_type'
      }));
    }
    if (pathname.includes('\0') || pathname.includes('\\')) return reply(res, 400, 'Invalid path');
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) return reply(res, 403, 'Invalid path');
    if (/^(?:alpha-access|orca-cloud-bridge|printer-cloud-bridge|octoeverywhere-bridge|orca-gateway)\.mjs(?:\.|$)/.test(path.basename(file))) return reply(res, 404, 'Not found');
    let info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) {
      const previewTab = pathname === '/preview' || pathname === '/preview/';
      if ((assetRoute.test(pathname) && !previewTab) || path.extname(pathname)) return reply(res, 404, 'Not found');
      file = path.join(root, 'index.html');
      info = await stat(file);
    }
    res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Last-Modified', info.mtime.toUTCString());
    let pairVersion;
    if (/^\/engine\/orca_engine\.(?:mjs|wasm)$/.test(pathname)) {
      const version = pairVersion = await engineVersion();
      const requestedVersion = new URL(req.url, 'http://localhost').searchParams.get('v');
      if (requestedVersion && requestedVersion !== version) return reply(res, 409, 'Engine release changed; reload to retry');
      // The alpha guard above must run even for HEAD and conditional requests.
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('X-Orca-Engine-Version', version);
      res.setHeader('X-Orca-Decoded-Length', info.size);
    }
    if (pathname.startsWith('/assets/') && !alpha) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Validators let a reload revalidate cheaply instead of re-downloading the 30 MB engine.
    const etag = pairVersion ? `W/"${pairVersion}"` : `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    res.setHeader('ETag', etag);
    const noneMatch = req.headers['if-none-match'];
    const unchanged = noneMatch ? noneMatch.split(',').some((tag) => tag.trim() === etag || tag.trim() === '*')
      : !pairVersion && req.headers['if-modified-since'] && Date.parse(req.headers['if-modified-since']) >= Math.floor(info.mtimeMs / 1000) * 1000;
    if (unchanged) { res.statusCode = 304; return res.end(); }
    const encoding = info.size > 1024 && compressible.has(path.extname(file).toLowerCase()) ? pickEncoding(req.headers['accept-encoding']) : undefined;
    // Vary is already set before validators, including hashed worker 304s.
    if (encoding) {
      // Files compressed at build time (precompress.mjs) are streamed as they are; anything else is compressed here once.
      const ext = encoding === 'br' ? '.br' : '.gz';
      const pre = await stat(file + ext).catch(() => undefined);
      if (pre?.isFile() && pre.mtimeMs >= info.mtimeMs) {
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Content-Length', pre.size);
        if (req.method === 'HEAD') return res.end();
        return void createReadStream(file + ext).on('error', () => res.destroy()).pipe(res);
      }
      const body = await compressedBody(file, info, encoding);
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', body.length);
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    res.setHeader('Content-Length', info.size);
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    reply(res, error instanceof URIError || error instanceof TypeError ? 400 : 500, 'Could not serve request');
  }
});
server.on('upgrade', (req, socket, head) => {
  if (alpha && !alpha.authorizeUpgrade(req, socket)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  if (req.url?.startsWith('/_octoeverywhere/')) {
    if (!octoEverywhere) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    void Promise.resolve(octoEverywhere.handleUpgrade(req, socket, head)).then(handled => {
      if (!handled && !socket.destroyed) socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    }, () => { if (!socket.destroyed) socket.destroy(); });
    return;
  }
  // Exact raw route only: no decoded paths, query credentials, generic proxy or other provider upgrades.
  if (req.url !== '/_printer/snapmaker-cloud/monitor') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  if (!printerCloud || !publicOrigin || req.headers.origin !== publicOrigin.origin || !validateCloudOrigin(req)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  if (!printerCloud.handleUpgrade(req, socket, head)) socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
});
server.listen(port, bindAddress, () => console.log(`WebOrca staging listening on ${bindAddress}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  alpha?.close();
  octoEverywhere?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
