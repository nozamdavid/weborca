/**
 * Local gateway (wasm/app/gateway/local.ts): the printer gateway as a program on the user's computer. Checks who may
 * use it (origin allow list, loopback Host), CORS and private-network preflight, the proxy routes, and the printer
 * web UI served at the root of its own `<label>.localhost` origin. Everything runs against a mock printer on 127.0.0.1.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { startLocalGateway } from '../../app/gateway/local.ts';
import { close, listen } from './lib/gatewayHarness.mjs';

const APP = 'https://slicer.example.com';

function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function connect(port, headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket`, { headers });
    ws.on('message', (data) => { resolve({ opened: true, message: data.toString() }); ws.close(); });
    ws.on('unexpected-response', (_req, res) => resolve({ opened: false, status: res.statusCode }));
    ws.on('error', () => resolve({ opened: false }));
  });
}

describe('local gateway', () => {
  let printer, printerPort, gateway, readOnlyGateway;
  const printerRequests = [];

  before(async () => {
    printer = http.createServer((req, res) => {
      printerRequests.push(`${req.method} ${req.url}`);
      res.setHeader('x-frame-options', 'DENY');
      res.setHeader('content-security-policy', "default-src 'none'");
      if (req.url.endsWith('/redirect')) { res.statusCode = 302; res.setHeader('location', `http://127.0.0.1:${printerPort}/ui/`); return res.end(); }
      res.setHeader('content-type', 'text/html');
      res.end(req.url === '/server/info' ? '{"ok":true}' : `<html>${req.method} ${req.url}</html>`);
    });
    const wss = new WebSocketServer({ server: printer }) // the UI address adds a base path, so any path;
    wss.on('connection', (socket) => socket.send('hello'));
    printerPort = await listen(printer);
    gateway = await startLocalGateway({ allowedOrigins: [APP], port: 0 });
    readOnlyGateway = await startLocalGateway({ allowedOrigins: [APP], port: 0, readOnly: true });
  });
  after(async () => {
    await gateway.close();
    await readOnlyGateway.close();
    await close(printer);
  });

  const asApp = (extra = {}) => ({ origin: APP, ...extra });

  test('needs at least one allowed origin', async () => {
    await assert.rejects(startLocalGateway({ allowedOrigins: [] }), /allowed origin/i);
  });

  test('only answers loopback Host names', async () => {
    const res = await request(gateway.port, '/_gw/status', { headers: asApp({ host: 'evil.example.com' }) });
    assert.equal(res.status, 403);
  });

  test('only serves the allowed origins', async () => {
    assert.equal((await request(gateway.port, '/_gw/status')).status, 403, 'no Origin or Referer');
    const other = await request(gateway.port, '/_gw/status', { headers: { origin: 'https://evil.example.com' } });
    assert.equal(other.status, 403);
    assert.match(other.body, /--allow-origin https:\/\/evil\.example\.com/);

    const ok = await request(gateway.port, '/_gw/status', { headers: asApp() });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { enabled: true, mode: 'private', readOnly: false, kind: 'local' });
    assert.equal(ok.headers['access-control-allow-origin'], APP);
    assert.equal(ok.headers['cross-origin-resource-policy'], 'cross-origin', 'the cross-origin isolated app may load it');
  });

  test('answers CORS and private network preflights for the app only', async () => {
    const preflight = await request(gateway.port, '/_printer/http/127.0.0.1:1/x', {
      method: 'OPTIONS',
      headers: asApp({ 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-orca-auth, content-type', 'access-control-request-private-network': 'true' })
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], APP);
    assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
    assert.equal(preflight.headers['access-control-allow-headers'], 'x-orca-auth, content-type');
    const refused = await request(gateway.port, '/_gw/status', { method: 'OPTIONS', headers: { origin: 'https://evil.example.com' } });
    assert.equal(refused.status, 403);
  });

  test('proxies API requests, also those that carry only a Referer (images)', async () => {
    const api = await request(gateway.port, `/_printer/http/127.0.0.1:${printerPort}/server/info`, { headers: asApp() });
    assert.equal(api.status, 200);
    assert.equal(api.body, '{"ok":true}');
    const image = await request(gateway.port, `/_printer/http/127.0.0.1:${printerPort}/server/info`, { headers: { referer: `${APP}/app/` } });
    assert.equal(image.status, 200);
  });

  test('refuses public printers', async () => {
    const res = await request(gateway.port, '/_gw/ui-session', { method: 'POST', headers: asApp(), body: JSON.stringify({ url: 'http://8.8.8.8/' }) });
    assert.equal(res.status, 403);
  });

  describe('printer web UI host', () => {
    let session;
    before(async () => {
      const res = await request(gateway.port, '/_gw/ui-session', { method: 'POST', headers: asApp(), body: JSON.stringify({ url: `http://127.0.0.1:${printerPort}/ui` }) });
      assert.equal(res.status, 200);
      session = JSON.parse(res.body);
    });
    const uiHost = () => `${session.label}.localhost:${gateway.port}`;

    test('is handed out as an unguessable <label>.localhost origin', () => {
      assert.match(session.label, /^u[0-9a-f]{16}$/);
      assert.equal(session.url, `http://${uiHost()}/`);
    });

    test('serves the printer at the root, ready to be framed by the isolated app', async () => {
      printerRequests.length = 0;
      const res = await request(gateway.port, '/assets/app.js?v=1', {
        headers: { host: uiHost(), referer: `${APP}/`, 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.body, '<html>GET /ui/assets/app.js?v=1</html>', 'the UI address base path is prepended');
      assert.equal(res.headers['x-frame-options'], undefined);
      assert.equal(res.headers['content-security-policy'], undefined);
      assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp');
      assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
    });

    test('lets the framed UI load its own assets', async () => {
      const res = await request(gateway.port, '/x', { headers: { host: uiHost(), 'sec-fetch-site': 'same-origin' } });
      assert.equal(res.status, 200);
    });

    test('points redirects of the printer back at itself', async () => {
      const res = await request(gateway.port, '/redirect', { headers: { host: uiHost(), 'sec-fetch-site': 'same-origin' } });
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, `http://${uiHost()}/ui/`);
    });

    test('cannot be opened from another site, nor once unknown', async () => {
      const foreign = await request(gateway.port, '/', { headers: { host: uiHost(), referer: 'https://evil.example.com/', 'sec-fetch-site': 'cross-site' } });
      assert.equal(foreign.status, 403);
      const unknown = await request(gateway.port, '/', { headers: { host: `u${'0'.repeat(16)}.localhost:${gateway.port}`, referer: `${APP}/` } });
      assert.equal(unknown.status, 404);
    });

    test('relays the websocket of the UI, from the UI only', async () => {
      assert.deepEqual(await connect(gateway.port, { host: uiHost(), origin: `http://${uiHost()}` }), { opened: true, message: 'hello' });
      const foreign = await connect(gateway.port, { host: uiHost(), origin: 'https://evil.example.com' });
      assert.equal(foreign.opened, false);
    });

    test('relays the API websocket for the app only', async () => {
      const ws = (origin) => new Promise((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${gateway.port}/_printer/ws/127.0.0.1:${printerPort}/websocket`, { headers: { origin } });
        socket.on('message', (data) => { resolve({ opened: true, message: data.toString() }); socket.close(); });
        socket.on('unexpected-response', (_req, res) => resolve({ opened: false, status: res.statusCode }));
        socket.on('error', () => resolve({ opened: false }));
      });
      assert.deepEqual(await ws(APP), { opened: true, message: 'hello' });
      assert.equal((await ws('https://evil.example.com')).opened, false);
    });
  });

  test('read-only mode applies to the app routes and to the printer UI', async () => {
    const api = await request(readOnlyGateway.port, `/_printer/http/127.0.0.1:${printerPort}/printer/gcode/script`, { method: 'POST', headers: asApp(), body: 'M104 S200' });
    assert.equal(api.status, 403);
    const created = await request(readOnlyGateway.port, '/_gw/ui-session', { method: 'POST', headers: asApp(), body: JSON.stringify({ url: `http://127.0.0.1:${printerPort}/` }) });
    const { label } = JSON.parse(created.body);
    printerRequests.length = 0;
    const ui = await request(readOnlyGateway.port, '/printer/emergency_stop', { method: 'POST', headers: { host: `${label}.localhost:${readOnlyGateway.port}`, 'sec-fetch-site': 'same-origin' } });
    assert.equal(ui.status, 403);
    assert.deepEqual(printerRequests, [], 'nothing reached the printer');
    const read = await request(readOnlyGateway.port, '/server/info', { headers: { host: `${label}.localhost:${readOnlyGateway.port}`, 'sec-fetch-site': 'same-origin' } });
    assert.equal(read.status, 200);
  });
});
