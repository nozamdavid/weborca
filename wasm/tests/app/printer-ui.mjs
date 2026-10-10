#!/usr/bin/env node
/**
 * Browser test of the gateway's web UI proxy, Chromium then Firefox. A mock printer UI that, like Mainsail, uses
 * root-absolute paths (`/assets/...`, `/server/info`, `ws://host/websocket`, a script added at run time) is opened
 * through `/_printer/ui/http/<host>/` and must work as if it lived at the root of its own origin.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium, firefox } from 'playwright';
import { WebSocketServer } from 'ws';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5125', 10);

// The app server (vite preview) inherits this and turns its printer gateway on for private addresses.
process.env.ORCA_PRINTER_PROXY = 'private';

const FILES = {
  '/ui/': ['text/html', `<!doctype html><html><head><title>Mock UI</title><link rel="stylesheet" href="/assets/app.css"></head>
<body><div id="out">loading</div><img id="img" src="/assets/pic.svg"><script src="/assets/app.js"></script></body></html>`],
  '/assets/app.css': ['text/css', `#out { color: rgb(1, 2, 3); } body { background: url(/assets/pic.svg); }`],
  '/assets/pic.svg': ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>'],
  '/assets/dyn.js': ['text/javascript', 'window.__dynamic = true;'],
  '/server/info': ['application/json', JSON.stringify({ result: { klippy_state: 'ready' } })],
  '/printer/info': ['application/json', JSON.stringify({ result: { state: 'ready' } })],
  '/assets/app.js': ['text/javascript', `(async () => {
  const info = await (await fetch('/server/info')).json();
  const xhr = await new Promise((resolve) => { const x = new XMLHttpRequest(); x.open('GET', '/printer/info'); x.onload = () => resolve(JSON.parse(x.responseText)); x.send(); });
  const s = document.createElement('script'); s.src = '/assets/dyn.js'; document.head.appendChild(s);
  const ws = new WebSocket('ws://' + location.host + '/websocket');
  ws.onmessage = (e) => {
    document.getElementById('out').textContent = JSON.stringify({ klippy: info.result.klippy_state, xhr: xhr.result.state, ws: e.data, path: location.pathname });
  };
})();`]
};

function startMockUi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const file = FILES[req.url.split('?')[0]];
    if (!file) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', file[0]);
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', "default-src 'none'");
    res.end(file[1]);
  });
  const wss = new WebSocketServer({ server, path: '/websocket' });
  wss.on('connection', (socket) => socket.send('hello'));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    requests,
    close: () => new Promise((done) => { wss.close(); server.closeAllConnections?.(); server.close(done); })
  })));
}

async function runSuite(browserType, name, mock) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  try {
    const base = `/_printer/ui/http/127.0.0.1:${mock.port}`;

    log('a request without a trailing slash is redirected so relative URLs keep working');
    const redirect = await page.request.get(`http://127.0.0.1:${PORT}${base}`, { maxRedirects: 0 });
    assert.equal(redirect.status(), 308);
    assert.equal(redirect.headers().location, `${base}/`);

    log('the UI loads through the prefix and behaves as if it were at the root');
    await page.goto(`http://127.0.0.1:${PORT}${base}/ui/`);
    await page.waitForFunction(() => document.getElementById('out')?.textContent?.startsWith('{'), null, { timeout: 15000 });
    const out = JSON.parse(await page.locator('#out').innerText());
    assert.deepEqual(out, { klippy: 'ready', xhr: 'ready', ws: 'hello', path: '/ui/' }, 'fetch, XHR and the websocket reach the printer and the page sees a root-relative path');
    assert.equal(await page.evaluate(() => window.__dynamic), true, 'a script added at run time with a root-absolute src loads');
    assert.equal(await page.locator('#out').evaluate((el) => getComputedStyle(el).color), 'rgb(1, 2, 3)', 'the stylesheet applies');
    assert.ok(await page.locator('#img').evaluate((img) => img.naturalWidth > 0), 'root-absolute images load');
    assert.match(await page.evaluate(() => getComputedStyle(document.body).backgroundImage), /_printer\/ui\/http\/127\.0\.0\.1:\d+\/assets\/pic\.svg/, 'url(/...) in CSS is rewritten');

    log('every request reached the printer under its own path');
    for (const path of ['/ui/', '/assets/app.css', '/assets/app.js', '/assets/dyn.js', '/server/info', '/printer/info', '/assets/pic.svg']) {
      assert.ok(mock.requests.includes(path), `the printer saw ${path}`);
    }
    mock.requests.length = 0;

    log('the framing headers of the printer are dropped so the app can embed the UI');
    const framed = await page.request.get(`http://127.0.0.1:${PORT}${base}/ui/`);
    assert.equal(framed.headers()['x-frame-options'], undefined);
    assert.equal(framed.headers()['content-security-policy'], undefined);
    assert.equal(framed.headers()['cross-origin-embedder-policy'], 'require-corp');

    log('all checks passed');
  } finally {
    await browser.close();
  }
}

const mock = await startMockUi();
await startServer(PORT, 'printer-ui');
try {
  await runSuite(chromium, 'chromium', mock);
  await runSuite(firefox, 'firefox', mock);
  console.log('All printer UI proxy tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Printer UI proxy tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
  await mock.close();
}
