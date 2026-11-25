import { spawn } from 'node:child_process';
// Decode and fit even when the CDN ignores its transform (notably JFIF).
function normalize(body) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/convert', ['-limit', 'memory', '64MiB', '-limit', 'map', '128MiB', '-limit', 'disk', '128MiB', '-limit', 'time', '10', '-[0]', '-auto-orient', '-thumbnail', '300x300>', '-strip', 'webp:-']);
    const chunks = []; let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) child.kill('SIGKILL'); else chunks.push(chunk); });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Invalid raster')); });
    child.stdin.on('error', () => {}); child.stdin.end(body);
  });
}
// Public MakerWorld and Printables catalog images only; no caller headers or credentials are forwarded.
export function thumbnailUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.search) throw new Error('Invalid thumbnail');
  const makerworld = url.hostname === 'makerworld.bblmw.com' &&
    /^\/makerworld\/model\/[A-Za-z0-9_-]+\/design\/[A-Za-z0-9_-]+\.(png|jpe?g|jfif|gif|webp)$/i.test(url.pathname);
  const printables = url.hostname === 'media.printables.com' &&
    /^\/media\/prints\/.+\.(png|jpe?g|jfif|gif|webp)$/i.test(url.pathname) &&
    !url.pathname.split('/').includes('..') && !/%2e/i.test(url.pathname);
  if (!makerworld && !printables) throw new Error('Invalid thumbnail');
  return url.href;
}
export function createThumbnailHandler(fetchImage = fetch) {
  const cache = new Map();
  let bytes = 0, active = 0;
  const waiting = [];
  const limit = 24 * 1024 * 1024, budget = 64 * 1024 * 1024;
  return async (req, res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); return res.end(); }
    let url;
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      if ([...params.keys()].join() !== 'url') throw new Error();
      url = thumbnailUrl(params.get('url'));
    } catch { res.writeHead(400); return res.end('Invalid thumbnail'); }
    let entry = cache.get(url);
    if (entry && entry.expires <= Date.now()) { bytes -= entry.body.length; cache.delete(url); entry = undefined; }
    if (!entry) {
      if (active >= 4) {
        if (waiting.length >= 24) { res.writeHead(503); return res.end(); }
        await new Promise(resolve => waiting.push(resolve));
      } else active++;
      try {
        const fetchUrl = new URL(url).hostname === 'makerworld.bblmw.com'
          ? url + '?x-oss-process=image/resize,m_lfit,w_300,h_300/format,webp'
          : url;
        const response = await fetchImage(fetchUrl, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000) });
        let type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (response.status !== 200 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'binary/octet-stream', 'application/octet-stream'].includes(type) || Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error(); }
        const reader = response.body.getReader(), chunks = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) throw new Error();
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        let body = Buffer.concat(chunks);
        // The CDN sometimes labels PNG bytes image/jpeg. Serve the actual raster type.
        type = body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : body[0] === 255 && body[1] === 216 && body[2] === 255 ? 'image/jpeg' : /^GIF8[79]a$/.test(body.toString('ascii', 0, 6)) ? 'image/gif' : body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : undefined;
        if (!type) throw new Error();
        body = await normalize(body);
        type = 'image/webp';
        entry = { body, type, expires: Date.now() + 300000 };
        while (cache.size >= 64 || bytes + body.length > budget) { const key = cache.keys().next().value; bytes -= cache.get(key).body.length; cache.delete(key); }
        cache.set(url, entry); bytes += body.length;
      } catch { res.writeHead(502); return res.end('Thumbnail unavailable'); }
      finally { const next = waiting.shift(); if (next) next(); else active--; }
    }
    res.writeHead(200, { 'Content-Type': entry.type, 'Content-Length': entry.body.length, 'Cache-Control': 'public, max-age=300' });
    res.end(entry.body);
  };
}
