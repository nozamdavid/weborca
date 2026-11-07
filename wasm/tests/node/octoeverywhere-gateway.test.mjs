import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { WebSocket, WebSocketServer } from '../../app/node_modules/ws/wrapper.mjs';
import { createOctoEverywhereGateway } from '../../app/gateway/octoEverywhere.ts';

const BASE = '/_octoeverywhere';
const connection = {
  connectionId: 'synthetic-connection', url: 'https://fixture.octoeverywhere.com/',
  appApiToken: 'synthetic-app-secret', auth: { type: 'bearer', token: 'synthetic-relay-secret' },
  printerName: 'Synthetic printer', userFacingUrl: 'https://octoeverywhere.com/view/synthetic',
  nativeApiKey: 'synthetic-native-secret'
};
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
async function fixture(options = {}) {
  let time = 1_000_000;
  const calls = [], wsCalls = [];
  let reply = (_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"Status":200,"Result":{}}'); };
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.setHeader('set-cookie', 'private=fixture');
    reply(req, res);
  });
  const upstreamPort = await listen(upstream);
  const wsServer = new WebSocketServer({ server: upstream });
  wsServer.on('connection', (ws, req) => {
    wsCalls.push({ path: req.url, headers: req.headers });
    ws.on('message', (data, binary) => ws.send(data, { binary }));
  });
  const server = http.createServer((req, res) => void gateway.handle(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }));
  const port = await listen(server), origin = `http://127.0.0.1:${port}`;
  const transport = (settings, callback) => {
    calls.push({ target: settings.hostname, pin: settings.lookup, headers: settings.headers });
    return http.request({ ...settings, hostname: '127.0.0.1', port: upstreamPort, lookup: undefined }, callback);
  };
  class SyntheticSocket extends WebSocket {
    constructor(url, protocols, settings) {
      wsCalls.push({ target: url, headers: settings.headers });
      super(`ws://127.0.0.1:${upstreamPort}${new URL(url).pathname}`, protocols, { ...settings, lookup: undefined });
    }
  }
  const gateway = createOctoEverywhereGateway({ enabled: true, appId: 'fixture-assigned-id', publicOrigin: origin,
    request: transport, webSocket: SyntheticSocket, resolver: async () => [{ address: '8.8.8.8', family: 4 }], now: () => time, ...options });
  server.on('upgrade', (req, socket, head) => void gateway.handleUpgrade(req, socket, head));
  async function request(path, { method = 'GET', body, headers = {}, browser = true } = {}) {
    return await new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      const req = http.request(origin + BASE + path, { method, headers: {
        ...(browser ? { origin, 'sec-fetch-site': 'same-origin' } : {}),
        ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}), ...headers
      } }, res => {
        const chunks = []; res.on('data', b => chunks.push(b));
        res.on('error', reject);
        res.on('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, bytes, text: bytes.toString(), json: () => JSON.parse(bytes.toString()) }); });
      });
      req.on('error', reject); req.end(bytes);
    });
  }
  async function session(c = connection) {
    const response = await request('/sessions', { method: 'POST', body: { connection: c } });
    assert.equal(response.status, 200, response.text);
    const value = response.json();
    return { ...value, path: '/sessions/' + value.sessionId,
      headers: { 'X-OctoEverywhere-Session': value.sessionToken } };
  }
  return { request, session, origin, calls, wsCalls, gateway, server, upstream, wsServer,
    setReply: fn => { reply = fn; }, advance: ms => { time += ms; },
    async close() {
      gateway.close();
      for (const ws of wsServer.clients) ws.terminate();
      wsServer.close(); server.closeAllConnections(); upstream.closeAllConnections();
      await Promise.all([new Promise(done => server.close(done)), new Promise(done => upstream.close(done))]);
    } };
}
function safe(response) {
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(response.headers['set-cookie'], undefined);
}

test('disabled/missing App ID, production ID and canonical origin configuration', async () => {
  const disabled = await fixture({ enabled: false });
  try {
    assert.deepEqual((await disabled.request('/config')).json(), { enabled: false, appId: 'fixture-assigned-id', portalAvailable: false });
    assert.equal((await disabled.request('/sessions', { method: 'POST', body: {} })).status, 403);
  } finally { await disabled.close(); }
  const missing = await fixture({ appId: undefined });
  try {
    assert.deepEqual((await missing.request('/config')).json(), { enabled: true, portalAvailable: false });
    const response = await missing.request('/portal/start', { method: 'POST', body: {} });
    assert.equal(response.status, 503); assert.match(response.text, /ORCA_OCTOEVERYWHERE_APP_ID/);
    await missing.session();
  } finally { await missing.close(); }
  assert.throws(() => createOctoEverywhereGateway({ enabled: true, publicOrigin: 'https://app.invalid/path' }));
  assert.throws(() => createOctoEverywhereGateway({ enabled: true, publicOrigin: 'https://app.invalid', appId: 'devtest' }));
});

test('portal external returnUrl correlation, one-time completion, failures, cancellation, replay and expiry', async () => {
  const f = await fixture();
  try {
    const start = async () => (await f.request('/portal/start', { method: 'POST', body: { printerId: 'synthetic-printer-id', requestOctoPrintApiKey: true } })).json();
    const flow = await start(), portal = new URL(flow.portalUrl), callback = new URL(portal.searchParams.get('returnUrl'));
    assert.equal(portal.origin, 'https://octoeverywhere.com');
    assert.equal(portal.searchParams.get('appid'), 'fixture-assigned-id');
    assert.equal(portal.searchParams.get('octoPrintApiKeyAppName'), 'WebOrca');
    assert.equal(callback.origin, f.origin);
    assert.equal(callback.searchParams.has('state'), false);
    assert.equal((await f.request('/portal/result/' + flow.flowId)).status, 401);
    const headers = { 'X-OctoEverywhere-Flow': flow.pollToken };
    assert.deepEqual((await f.request('/portal/result/' + flow.flowId, { headers })).json(), { status: 'pending' });
    const values = { success: 'true', id: connection.connectionId, url: connection.url, appApiToken: connection.appApiToken,
      authBearerToken: connection.auth.token, printername: connection.printerName,
      userPrinterAccessUrl: connection.userFacingUrl, octoPrintApiKey: connection.nativeApiKey };
    for (const [key, value] of Object.entries(values)) callback.searchParams.set(key, value);
    const callbackPath = callback.pathname.slice(BASE.length) + callback.search;
    const bad = callbackPath.replace(callback.searchParams.get('correlation'), 'wrong');
    assert.equal((await f.request(bad, { browser: false })).status, 403);
    const done = await f.request(callbackPath, { browser: false });
    assert.equal(done.status, 303); safe(done);
    assert.equal(done.headers.location, BASE + '/portal/complete');
    assert.equal(done.text.includes(connection.appApiToken), false);
    assert.equal((await f.request(callbackPath, { browser: false })).status, 403);
    const result = await f.request('/portal/result/' + flow.flowId, { headers }); safe(result);
    assert.deepEqual(result.json(), { status: 'complete', connection });
    assert.equal((await f.request('/portal/result/' + flow.flowId, { headers })).status, 401);
    const cancelled = await start();
    assert.equal((await f.request('/portal/result/' + cancelled.flowId, { method: 'DELETE', headers: { 'X-OctoEverywhere-Flow': cancelled.pollToken } })).status, 200);
    const cancelledUrl = new URL(new URL(cancelled.portalUrl).searchParams.get('returnUrl'));
    assert.equal((await f.request(cancelledUrl.pathname.slice(BASE.length) + cancelledUrl.search, { browser: false })).status, 403);
    const failed = await start(), failedUrl = new URL(new URL(failed.portalUrl).searchParams.get('returnUrl'));
    failedUrl.searchParams.set('success', 'false');
    await f.request(failedUrl.pathname.slice(BASE.length) + failedUrl.search, { browser: false });
    assert.equal((await f.request('/portal/result/' + failed.flowId, { headers: { 'X-OctoEverywhere-Flow': failed.pollToken } })).json().status, 'failed');
    const expired = await start(); f.advance(10 * 60_000);
    assert.equal((await f.request('/portal/result/' + expired.flowId, { headers: { 'X-OctoEverywhere-Flow': expired.pollToken } })).status, 401);
  } finally { await f.close(); }
});

test('same-origin, session isolation, exact plugin schema/methods and auth separation', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/config', { headers: { origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await f.request('/config', { headers: { host: 'evil.invalid' } })).status, 403);
    assert.equal((await f.request('/config', { browser: false })).status, 403);
    assert.equal((await f.request('/config', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    const s = await f.session(), other = await f.session();
    assert.equal((await f.request(s.path + '/plugin/status', { headers: other.headers })).status, 401);
    // Never forward ambient browser auth, cookies or the session capability.
    const response = await f.request(s.path + '/plugin/status?IncludeMaterialSystem=true', { headers: { ...s.headers, authorization: 'ambient-secret', cookie: 'ambient=secret' } });
    assert.equal(response.status, 200); safe(response);
    const upstream = f.calls.find(c => c.path);
    assert.equal(upstream.path, '/octoeverywhere-command-api/status?IncludeMaterialSystem=true');
    assert.equal(upstream.headers.authorization, 'Bearer ' + connection.auth.token);
    for (const key of ['cookie', 'apptoken', 'x-api-key', 'x-octoeverywhere-session']) assert.equal(upstream.headers[key], undefined);
    for (const [route, method, body] of [
      ['/plugin/unknown', 'GET'], ['/plugin/status', 'POST', {}], ['/plugin/status?url=https://evil.invalid', 'GET'],
      ['/plugin/status?IncludeMaterialSystem=true&IncludeMaterialSystem=false', 'GET'],
      ['/plugin/set-temp', 'POST', { BedC: 76 }], ['/plugin/set-temp', 'POST', { ToolC: 261 }],
      ['/plugin/move-axis', 'POST', { Axis: 'E', DistanceMm: 5 }], ['/plugin/start', 'POST', { Path: 'gcode/../bad' }],
      ['/plugin/set-light', 'POST', { Name: 'chamber', On: true, url: 'evil' }], ['/plugin/files/details', 'GET'],
      ['/plugin/files/download?path=gcode%2F..%2Fsecret', 'GET'], ['/plugin/files/delete?path=gcode/a.gcode', 'DELETE']
    ]) {
      const r = await f.request(s.path + route, { headers: s.headers, method, body });
      assert.equal(r.status, 400, route + ' ' + r.text);
    }
    for (const [route, body] of [
      ['pause', { SmartPause: true, ZLiftMm: 5 }], ['resume', {}], ['cancel', {}], ['home', {}],
      ['set-light', { Name: 'chamber', On: true }], ['move-axis', { Axis: 'Z', DistanceMm: -5 }],
      ['extrude', { Extruder: 0, DistanceMm: 10 }], ['set-temp', { ToolC: 260, BedC: 75, ChamberC: 0 }],
      ['start', { Path: 'gcode/synthetic.3mf', Plate: 2, UseAms: true, AmsMapping: [0, 1], FlowCali: false }]
    ]) assert.equal((await f.request(s.path + '/plugin/' + route, { method: 'POST', body, headers: s.headers })).status, 200, route);
    await f.request(s.path + '/info', { headers: s.headers });
    const info = f.calls.filter(c => c.path).at(-1);
    assert.equal(info.path, '/api/appconnection/info'); assert.equal(info.headers.apptoken, connection.appApiToken);
    assert.equal(info.headers.authorization, undefined); assert.equal(info.headers['x-api-key'], undefined);
    assert.equal((await f.request(s.path + '/native/api/printer', { headers: s.headers })).status, 200);
    assert.equal(f.calls.filter(c => c.path).at(-1).headers['x-api-key'], connection.nativeApiKey);
    assert.equal((await f.request(s.path + '/native/api/printer', { headers: { ...s.headers, authorization: 'native-bearer' } })).status, 400);
    const basic = await f.session({ ...connection, auth: { type: 'basic', username: 'synthetic-user', password: 'synthetic-password' } });
    await f.request(basic.path + '/plugin/status', { headers: basic.headers });
    assert.equal(f.calls.filter(c => c.path).at(-1).headers.authorization, 'Basic ' + Buffer.from('synthetic-user:synthetic-password').toString('base64'));
  } finally { await f.close(); }
});

test('target validation, DNS pinning, redirect refusal, native routes and redacted errors', async () => {
  const f = await fixture();
  try {
    for (const url of ['https://example.com/', 'https://a.b.octoeverywhere.com/', 'http://fixture.octoeverywhere.com/',
      'https://fixture.octoeverywhere.com/secret', 'https://fixture.octoeverywhere.com/?key=secret',
      'https://user:pass@fixture.octoeverywhere.com/', 'https://fixture.octoeverywhere.com:123/']) {
      assert.equal((await f.request('/sessions', { method: 'POST', body: { connection: { ...connection, url } } })).status, 400, url);
    }
    const encodedName = 'https://octoeverywhere.com/view/My%20Printer';
    assert.equal((await f.request('/sessions', { method: 'POST', body: { connection: { ...connection, userFacingUrl: encodedName } } })).status, 200);
    for (const userFacingUrl of ['https://octoeverywhere.com/view/Bad%00Name', 'https://octoeverywhere.com/view/Bad%2FName',
      'https://octoeverywhere.com/view/Bad%5CName', 'https://octoeverywhere.com/view/Bad%252FName',
      'https://octoeverywhere.com/view/Bad%40Name', 'https://octoeverywhere.com/view/Bad%ZZName',
      'https://octoeverywhere.com/view/My%20Printer?token=secret', 'https://evil.invalid/view/My%20Printer']) {
      assert.equal((await f.request('/sessions', { method: 'POST', body: { connection: { ...connection, userFacingUrl } } })).status, 400, userFacingUrl);
    }
    const s = await f.session();
    for (const route of ['/native/http://evil.invalid', '/native/api/../secret', '/native/server/files/upload?url=evil',
      '/native/printer/gcode/script?script=M112', '/native/api/printer?redirect=evil', '/native/api/connection', '/native/webcam/']) {
      assert.equal((await f.request(s.path + route, { headers: s.headers })).status >= 400, true, route);
    }
    f.setReply((_req, res) => { res.writeHead(302, { location: 'https://evil.invalid/?token=secret' }); res.end(); });
    const redirected = await f.request(s.path + '/plugin/status', { headers: s.headers });
    assert.equal(redirected.status, 502); assert.equal(redirected.headers.location, undefined);
    f.setReply((_req, res) => { res.writeHead(604); res.end(connection.appApiToken); });
    const revoked = await f.request(s.path + '/info', { headers: s.headers });
    assert.equal(revoked.status, 604); assert.equal(revoked.json().code, 604); assert.equal(revoked.text.includes(connection.appApiToken), false);
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ Status: 788, Error: connection.auth.token })); });
    const plugin = await f.request(s.path + '/plugin/status', { headers: s.headers });
    assert.equal(plugin.status, 200); assert.deepEqual(plugin.json(), { Status: 788, Error: '[redacted]' });
    const pin = f.calls.find(c => c.pin);
    await new Promise(resolve => pin.pin('ignored-name', {}, (_error, address, family) => { assert.equal(address, '8.8.8.8'); assert.equal(family, 4); resolve(); }));
    await new Promise(resolve => pin.pin('ignored-name', { all: true }, (_error, addresses) => { assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]); resolve(); }));
  } finally { await f.close(); }
  for (const address of ['127.0.0.1', '192.168.1.2', '0.0.0.0', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::']) {
    const blocked = await fixture({ resolver: async () => [{ address, family: address.includes(':') ? 6 : 4 }] });
    try {
      const s = await blocked.session();
      assert.equal((await blocked.request(s.path + '/plugin/status', { headers: s.headers })).status, 403, address);
      assert.equal(blocked.calls.length, 0);
    } finally { await blocked.close(); }
  }
});

test('raw upload/download, account transfer limits, camera tickets and session cleanup', async () => {
  const f = await fixture();
  try {
    const s = await f.session();
    const payload = Buffer.from([0, 1, 2, 255, 10]);
    assert.equal((await f.request(s.path + '/plugin/files/upload?path=gcode/synthetic.gcode', { method: 'PUT', headers: s.headers, body: payload })).status, 200);
    const upload = f.calls.filter(c => c.path).at(-1);
    assert.equal(upload.method, 'PUT'); assert.deepEqual(upload.body, payload);
    assert.equal(f.calls.some(c => c.path?.endsWith('/start')), false);
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/octet-stream'); res.end(payload); });
    const download = await f.request(s.path + '/plugin/files/download?path=gcode/synthetic.gcode', { headers: s.headers });
    assert.deepEqual(download.bytes, payload); safe(download);
    f.setReply((_req, res) => { res.setHeader('content-type', 'image/jpeg'); res.end(payload); });
    const mint = async body => (await f.request(s.path + '/ticket', { method: 'POST', headers: s.headers, body })).json();
    const ticket = await mint({ kind: 'snapshot', index: 2 });
    assert.ok(ticket.url.startsWith(BASE + '/tickets/')); assert.equal(ticket.url.includes(connection.auth.token), false);
    const ticketPath = ticket.url.slice(BASE.length);
    assert.equal((await f.request(ticketPath, { headers: { origin: 'https://evil.invalid' } })).status, 403);
    const image = await f.request(ticketPath); assert.deepEqual(image.bytes, payload); safe(image);
    assert.equal(f.calls.filter(c => c.path).at(-1).path, '/octoeverywhere-command-api/webcam/snapshot?index=2');
    assert.equal((await f.request(ticketPath)).status, 401);
    const expiring = await mint({ kind: 'stream' }); f.advance(30_000);
    assert.equal((await f.request(expiring.url.slice(BASE.length))).status, 401);
    const disposable = await mint({ kind: 'snapshot' });
    await f.request(s.path, { method: 'DELETE', headers: s.headers });
    assert.equal((await f.request(disposable.url.slice(BASE.length))).status, 401);
    assert.equal((await f.request(s.path + '/plugin/status', { headers: s.headers })).status, 401);
    const limited = await f.session();
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ PrinterLimits: { MaxUploadFileSizeBytes: 3, MaxDownloadFileSizeBytes: 3, MaxSingleWebcamStreamLengthSeconds: 1 } })); });
    await f.request(limited.path + '/info', { headers: limited.headers });
    const tooLarge = await f.request(limited.path + '/plugin/files/upload?path=gcode/synthetic.gcode', { method: 'PUT', headers: limited.headers, body: payload });
    assert.equal(tooLarge.status, 413);
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/octet-stream'); res.end(payload); });
    await assert.rejects(f.request(limited.path + '/plugin/files/download?path=gcode/synthetic.gcode', { headers: limited.headers }));
    const expiringSession = await f.session(); f.advance(30 * 60_000);
    assert.equal((await f.request(expiringSession.path + '/plugin/status', { headers: expiringSession.headers })).status, 401);
  } finally { await f.close(); }
});

test('official Gadget, Live Link, webhook methods and bounded configuration schemas', async () => {
  const f = await fixture();
  try {
    const s = await f.session(), other = await f.session();
    const call = (suffix, body = {}, method = 'POST', session = s) => f.request(session.path + suffix, { method, headers: session.headers, body });
    assert.equal((await call('/gadget')).status, 200);
    assert.equal((await call('/gadget', {}, 'POST', other)).status, 429);
    f.advance(10_000); assert.equal((await call('/gadget')).status, 200);
    assert.equal((await call('/live-link', { ExpirationHours: 24, EndWhenCurrentPrintIsComplete: false })).status, 200);
    assert.equal((await call('/live-link', { ExpirationHours: 0 })).status, 400);
    assert.equal((await call('/live-link', { Title: 'invented' })).status, 400);
    const webhook = { WebhookUrl: 'https://callback.example.invalid/notify?fixture=synthetic', InclusiveEventTypesFilter: [1, 2, 7] };
    f.setReply((_req, res) => { res.setHeader('content-type', 'text/plain'); res.end('OK'); });
    assert.equal((await call('/notifications', webhook)).status, 200);
    assert.equal((await call('/notifications', {}, 'DELETE')).status, 200);
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
    assert.equal((await call('/notifications/test')).status, 200);
    const calls = f.calls.filter(c => c.path);
    assert.deepEqual(calls.map(c => [c.method, c.path]), [
      ['POST', '/api/gadget/GetStatusFromAppConnection'], ['POST', '/api/gadget/GetStatusFromAppConnection'],
      ['POST', '/api/live/createfromappconnection'], ['POST', '/api/appconnection/SetNotificationWebhook'],
      ['POST', '/api/appconnection/DeleteNotificationWebhook'], ['GET', '/api/appconnection/TestWebhook']
    ]);
    assert.deepEqual(JSON.parse(calls[3].body), webhook);
    for (const c of calls) { assert.equal(c.headers.apptoken, connection.appApiToken); assert.equal(c.headers.authorization, undefined); assert.equal(c.body.includes(connection.appApiToken), false); }
    for (const WebhookUrl of ['http://callback.example.invalid/', 'https://127.0.0.1/', 'https://user:pass@callback.example.invalid/']) assert.equal((await call('/notifications', { WebhookUrl })).status, 400);
  } finally { await f.close(); }
});

test('JSON file downloads retain exact bytes beyond the API JSON limit and obey file limits', async () => {
  const f = await fixture();
  try {
    const s = await f.session();
    let payload = Buffer.from('{ "number": 12345678901234567890, "text": "synthetic-app-secret" }\n');
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(payload); });
    const download = () => f.request(s.path + '/plugin/files/download?path=gcode/config.json', { headers: s.headers });
    assert.deepEqual((await download()).bytes, payload);
    payload = Buffer.from(JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }));
    assert.deepEqual((await download()).bytes, payload);
    payload = Buffer.from('{"Status":788,"Error":"synthetic-app-secret"}');
    assert.equal((await download()).json().Error, '[redacted]');
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"PrinterLimits":{"MaxDownloadFileSizeBytes":4}}'); });
    await f.request(s.path + '/info', { headers: s.headers });
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(payload); });
    await assert.rejects(download());
  } finally { await f.close(); }
});

test('closing a downstream mutation during DNS prevents upstream dispatch', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture({ resolver: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  try {
    const s = await f.session();
    const closed = new Promise(resolve => f.server.once('request', (_req, res) => res.once('close', resolve)));
    const req = http.request(f.origin + BASE + s.path + '/plugin/cancel', { method: 'POST', headers: { origin: f.origin, ...s.headers } });
    req.on('error', () => {}); req.end();
    await started; req.destroy(); await closed;
    release([{ address: '8.8.8.8', family: 4 }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('native WebSocket and MQTT WSS ticket infrastructure authenticates upstream, rejects misuse, closes on disposal', async () => {
  const f = await fixture();
  try {
    const s = await f.session();
    const ticket = async body => (await f.request(s.path + '/ticket', { method: 'POST', headers: s.headers, body })).json();
    for (const body of [{ kind: 'websocket', path: '/arbitrary' }, { kind: 'mqtt', path: '/websocket' }, { kind: 'snapshot', path: '/websocket' }]) {
      assert.equal((await f.request(s.path + '/ticket', { method: 'POST', headers: s.headers, body })).status, 400);
    }
    const native = await ticket({ kind: 'websocket', path: '/websocket' });
    assert.equal((await f.request(native.url.slice(BASE.length))).status, 401);
    const ws = new WebSocket(f.origin.replace('http:', 'ws:') + native.url, { origin: f.origin });
    await once(ws, 'open');
    ws.send('synthetic JSON-RPC'); assert.equal(String((await once(ws, 'message'))[0]), 'synthetic JSON-RPC');
    const upstream = f.wsCalls.find(c => c.target);
    assert.equal(upstream.target, 'wss://fixture.octoeverywhere.com/websocket');
    assert.equal(upstream.headers.Authorization, 'Bearer ' + connection.auth.token);
    assert.equal(upstream.headers['X-Api-Key'], connection.nativeApiKey);
    const mqttTicket = await ticket({ kind: 'mqtt' });
    const mqtt = new WebSocket(f.origin.replace('http:', 'ws:') + mqttTicket.url, ['mqtt'], { origin: f.origin });
    await once(mqtt, 'open');
    const bytes = Buffer.from([0x10, 2, 0, 4]); mqtt.send(bytes);
    assert.deepEqual((await once(mqtt, 'message'))[0], bytes);
    const mqttCall = f.wsCalls.find(c => c.target?.endsWith('/proxy/mqtt'));
    assert.equal(mqttCall.headers.Authorization, 'Bearer ' + connection.auth.token);
    assert.equal(mqttCall.headers['X-Api-Key'], undefined);
    const wsClosed = once(ws, 'close'), mqttClosed = once(mqtt, 'close');
    await f.request(s.path, { method: 'DELETE', headers: s.headers });
    await Promise.all([wsClosed, mqttClosed]);
    const replay = new WebSocket(f.origin.replace('http:', 'ws:') + native.url, { origin: f.origin });
    replay.on('error', () => {});
    const [, response] = await once(replay, 'unexpected-response'); response.destroy();
  } finally { await f.close(); }
});

test('active streams, tickets and transient sessions are bounded and expire with their credentials', async () => {
  const f = await fixture();
  try {
    const s = await f.session();
    f.setReply((_req, res) => { res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=fixture' }); res.write('--fixture\r\n'); });
    const streams = [];
    for (let i = 0; i < 8; i++) {
      const response = await new Promise((resolve, reject) => {
        const req = http.get(f.origin + BASE + s.path + '/plugin/webcam/stream', { headers: { origin: f.origin, ...s.headers } }, resolve);
        req.on('error', reject);
      });
      response.resume(); streams.push(response);
    }
    assert.equal((await f.request(s.path + '/plugin/status', { headers: s.headers })).status, 429);
    const closed = streams.map(stream => new Promise(resolve => stream.once('close', resolve)));
    f.advance(30 * 60_000);
    await f.request('/config'); // sweep closes every active response tied to the expired session
    await Promise.all(closed);
    const next = await f.session({ ...connection, userFacingUrl: 'https://octoeverywhere.com/view/My%20Printer' });
    for (let i = 0; i < 16; i++) assert.equal((await f.request(next.path + '/ticket', { method: 'POST', headers: next.headers, body: { kind: 'snapshot' } })).status, 200);
    assert.equal((await f.request(next.path + '/ticket', { method: 'POST', headers: next.headers, body: { kind: 'snapshot' } })).status, 429);
    f.advance(30_000);
    assert.equal((await f.request(next.path + '/ticket', { method: 'POST', headers: next.headers, body: { kind: 'snapshot' } })).status, 200);
    for (let i = 1; i < 128; i++) await f.session();
    assert.equal((await f.request('/sessions', { method: 'POST', body: { connection } })).status, 429);
    f.advance(30 * 60_000);
    await f.session();
  } finally { await f.close(); }
});

test('packaged hosted route stays optional, hides backend artifacts and preserves isolation and fail-closed gates', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-octoeverywhere-'));
  const { buildSync } = createRequire(new URL('../../app/package.json', import.meta.url))('esbuild');
  writeFileSync(path.join(root, 'index.html'), '<title>synthetic app</title>');
  async function start(env) {
    const probe = http.createServer(); const port = await listen(probe);
    await new Promise(resolve => probe.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [new URL('../../deploy/server.mjs', import.meta.url).pathname], {
      env: { PATH: process.env.PATH, ORCA_ROOT: root, ORCA_HOST: '127.0.0.1', ORCA_BIND: '127.0.0.1', PORT: String(port), ORCA_PUBLIC_ORIGIN: origin, ...env }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
    const exited = once(child, 'exit');
    const listening = await new Promise(resolve => {
      child.stdout.on('data', bytes => { if (String(bytes).includes('listening')) resolve(true); });
      child.once('exit', () => resolve(false));
    });
    return { listening, stderr: () => stderr, async stop() { if (child.exitCode === null) child.kill('SIGTERM'); await exited; },
      async call(route, method = 'GET', body) {
        return await new Promise((resolve, reject) => {
          const req = http.request(origin + route, { method, headers: { origin, 'content-type': 'application/json' } }, res => {
            let text = ''; res.on('data', bytes => { text += bytes; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
          });
          req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
        });
      } };
  }
  try {
    const disabled = await start({});
    try {
      assert.equal(disabled.listening, true, disabled.stderr());
      const config = await disabled.call(BASE + '/config');
      assert.deepEqual(config.json(), { enabled: false, portalAvailable: false });
      assert.equal(config.headers['cross-origin-embedder-policy'], 'require-corp');
      assert.equal(config.headers['cross-origin-opener-policy'], 'same-origin');
      assert.equal((await disabled.call(BASE + '/sessions', 'POST', {})).status, 403);
      assert.equal((await disabled.call('/_printer/api/job', 'POST', {})).status, 404);
    } finally { await disabled.stop(); }
    const missing = await start({ ORCA_OCTOEVERYWHERE_ENABLED: '1' });
    assert.equal(missing.listening, false); assert.match(missing.stderr(), /packaged octoeverywhere-bridge/); await missing.stop();
    buildSync({ entryPoints: [new URL('../../app/gateway/octoEverywhere.ts', import.meta.url).pathname],
      outfile: path.join(root, 'octoeverywhere-bridge.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20',
      external: ['bufferutil', 'utf-8-validate'],
      banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
    writeFileSync(path.join(root, 'octoeverywhere-bridge.mjs.br'), 'synthetic private artifact');
    const enabled = await start({ ORCA_OCTOEVERYWHERE_ENABLED: '1' });
    try {
      assert.equal(enabled.listening, true, enabled.stderr());
      assert.deepEqual((await enabled.call(BASE + '/config')).json(), { enabled: true, portalAvailable: false });
      assert.equal((await enabled.call(BASE + '/portal/start', 'POST', {})).status, 503);
      assert.equal((await enabled.call(BASE + '/sessions', 'POST', { connection })).status, 200);
      for (const artifact of ['/octoeverywhere-bridge.mjs', '/octoeverywhere-bridge.mjs.br', '/octoeverywhere-bridge.mjs.gz']) assert.equal((await enabled.call(artifact)).status, 404);
      assert.equal((await enabled.call('/_printer/api/job', 'POST', {})).status, 404);
    } finally { await enabled.stop(); }
    const badOrigin = await start({ ORCA_OCTOEVERYWHERE_ENABLED: '1', ORCA_PUBLIC_ORIGIN: 'https://app.invalid/path' });
    assert.equal(badOrigin.listening, false); assert.match(badOrigin.stderr(), /canonical ORCA_PUBLIC_ORIGIN/); await badOrigin.stop();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
