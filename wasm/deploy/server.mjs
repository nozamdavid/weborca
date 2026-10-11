/** Static staging server; printer connections use the separately run local gateway. */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const allowedHosts = new Set([process.env.ORCA_HOST || 'weborca.noz.am', 'localhost', '127.0.0.1', '[::1]']);
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
const server = http.createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    const host = new URL(`http://${req.headers.host || ''}`).hostname;
    if (!allowedHosts.has(host)) return reply(res, 421, 'Unexpected host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/healthz') return reply(res, 200, 'ok');
    if (pathname.includes('\0') || pathname.includes('\\')) return reply(res, 400, 'Invalid path');
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) return reply(res, 403, 'Invalid path');
    let info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) {
      if (assetRoute.test(pathname) || path.extname(pathname)) return reply(res, 404, 'Not found');
      file = path.join(root, 'index.html');
      info = await stat(file);
    }
    res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    res.setHeader('Last-Modified', info.mtime.toUTCString());
    if (pathname.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    reply(res, error instanceof URIError || error instanceof TypeError ? 400 : 500, 'Could not serve request');
  }
});
server.listen(8080, '0.0.0.0', () => console.log('WebOrca staging listening on :8080'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
