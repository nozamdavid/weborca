import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createOctoEverywhereGateway } from '../../app/gateway/octoEverywhere.ts';

const BASE = '/_octoeverywhere';
const TARGET = 'https://fixture.octoeverywhere.com/';
const APP_TOKEN = 'synthetic-app-secret';
const RELAY_TOKEN = 'synthetic-relay-secret';
const NATIVE_KEY = 'synthetic-native-secret';
const CONNECTION_ID = 'synthetic-connection';

const printerHeaders = (extra = {}) => ({
  'X-OctoEverywhere-Target': TARGET,
  'X-OctoEverywhere-Auth': `Bearer ${RELAY_TOKEN}`,
  ...extra
});
const nativeHeaders = (extra = {}) => ({
  ...printerHeaders(),
  'X-OctoEverywhere-Native-Key': NATIVE_KEY,
  ...extra
});
const appHeaders = (extra = {}) => ({
  'X-OctoEverywhere-App-Token': APP_TOKEN,
  ...extra
});

const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
async function fixture(options = {}) {
  let time = 1_000_000;
  const calls = [];
  let reply = (_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"Status":200,"Result":{}}'); };
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.setHeader('set-cookie', 'private=fixture');
    reply(req, res);
  });
  const upstreamPort = await listen(upstream);
  const server = http.createServer((req, res) => void gateway.handle(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }));
  const port = await listen(server), origin = `http://127.0.0.1:${port}`;
  const transport = (settings, callback) => {
    calls.push({ target: settings.hostname, pin: settings.lookup, headers: settings.headers });
    return http.request({ ...settings, hostname: '127.0.0.1', port: upstreamPort, lookup: undefined }, callback);
  };
  const { defaultAppId, ...gatewayOptions } = options;
  const gateway = createOctoEverywhereGateway({ enabled: true, ...(defaultAppId ? {} : { appId: 'fixture-assigned-id' }), publicOrigin: origin,
    request: transport, resolver: async () => [{ address: '8.8.8.8', family: 4 }], now: () => time, ...gatewayOptions });
  server.on('upgrade', (req, socket, head) => {
    void Promise.resolve(gateway.handleUpgrade(req, socket, head)).then(handled => {
      if (!handled && !socket.destroyed) socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    });
  });
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
  return { request, origin, port, calls, gateway, server, upstream,
    setReply: fn => { reply = fn; }, advance: ms => { time += ms; },
    async close() {
      gateway.close();
      server.closeAllConnections(); upstream.closeAllConnections();
      await Promise.all([new Promise(done => server.close(done)), new Promise(done => upstream.close(done))]);
    } };
}
function safe(response) {
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(response.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
  assert.equal(response.headers['set-cookie'], undefined);
}

test('disabled/missing App ID, default weborca ID, production ID and canonical origin configuration', async () => {
  const savedAppId = process.env.ORCA_OCTOEVERYWHERE_APP_ID;
  delete process.env.ORCA_OCTOEVERYWHERE_APP_ID;
  try {
    const defaulted = await fixture({ defaultAppId: true });
    try {
      assert.deepEqual((await defaulted.request('/config')).json(), { enabled: true, appId: 'weborca', portalAvailable: true });
    } finally { await defaulted.close(); }
    process.env.ORCA_OCTOEVERYWHERE_APP_ID = '';
    const emptyEnv = await fixture({ defaultAppId: true });
    try {
      assert.deepEqual((await emptyEnv.request('/config')).json(), { enabled: true, portalAvailable: false });
    } finally { await emptyEnv.close(); }
  } finally {
    if (savedAppId === undefined) delete process.env.ORCA_OCTOEVERYWHERE_APP_ID;
    else process.env.ORCA_OCTOEVERYWHERE_APP_ID = savedAppId;
  }
  const disabled = await fixture({ enabled: false });
  try {
    assert.deepEqual((await disabled.request('/config')).json(), { enabled: false, appId: 'fixture-assigned-id', portalAvailable: false });
    assert.equal((await disabled.request('/plugin/status', { headers: printerHeaders() })).status, 403);
    assert.equal((await disabled.request('/info', { headers: appHeaders() })).status, 403);
  } finally { await disabled.close(); }
  const missing = await fixture({ appId: undefined });
  try {
    assert.deepEqual((await missing.request('/config')).json(), { enabled: true, portalAvailable: false });
    assert.equal((await missing.request('/plugin/status', { headers: printerHeaders() })).status, 200);
  } finally { await missing.close(); }
  assert.throws(() => createOctoEverywhereGateway({ enabled: true, publicOrigin: 'https://app.invalid/path' }));
  assert.throws(() => createOctoEverywhereGateway({ enabled: true, publicOrigin: 'https://app.invalid', appId: 'devtest' }));
});

test('same-origin, stateless header validation, exact plugin schema/methods and auth separation', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/config', { headers: { origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await f.request('/config', { headers: { host: 'evil.invalid' } })).status, 403);
    assert.equal((await f.request('/config', { browser: false })).status, 403);
    assert.equal((await f.request('/config', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);

    // Removed stateful routes and upgrades are rejected.
    for (const [route, method] of [
      ['/sessions', 'POST'], ['/sessions/abc/plugin/status', 'GET'], ['/portal/start', 'POST'],
      ['/portal/callback/a/b', 'GET'], ['/portal/complete', 'GET'], ['/tickets/abc', 'GET']
    ]) {
      assert.equal((await f.request(route, { method })).status, 404, route);
    }
    assert.equal(await f.gateway.handleUpgrade(), false);

    // Missing/invalid target and auth headers.
    assert.equal((await f.request('/plugin/status')).status, 400);
    for (const badTarget of ['https://example.com/', 'https://a.b.octoeverywhere.com/', 'http://fixture.octoeverywhere.com/',
      'https://fixture.octoeverywhere.com/secret', 'https://fixture.octoeverywhere.com/?key=secret',
      'https://user:pass@fixture.octoeverywhere.com/', 'https://fixture.octoeverywhere.com:123/']) {
      assert.equal((await f.request('/plugin/status', { headers: printerHeaders({ 'X-OctoEverywhere-Target': badTarget }) })).status, 400, badTarget);
    }
    for (const badAuth of ['', 'Bearer', 'Bearer a b', 'Basic not*base64', 'Token abc', 'Digest foo']) {
      assert.equal((await f.request('/plugin/status', { headers: printerHeaders({ 'X-OctoEverywhere-Auth': badAuth }) })).status, 400, badAuth);
    }
    assert.equal((await f.request('/info')).status, 400);

    // Never forward ambient browser auth, cookies, AppToken or X-Api-Key on plugin routes.
    const response = await f.request('/plugin/status?IncludeMaterialSystem=true', {
      headers: printerHeaders({
        authorization: 'ambient-secret',
        cookie: 'ambient=secret',
        'X-OctoEverywhere-App-Token': APP_TOKEN,
        'X-OctoEverywhere-Native-Key': NATIVE_KEY
      })
    });
    assert.equal(response.status, 200); safe(response);
    const upstream = f.calls.find(c => c.path);
    assert.equal(upstream.path, '/octoeverywhere-command-api/status?IncludeMaterialSystem=true');
    assert.equal(upstream.headers.authorization, 'Bearer ' + RELAY_TOKEN);
    assert.equal(upstream.headers['user-agent'], 'WebOrca/1.0');
    for (const key of ['cookie', 'apptoken', 'x-api-key', 'x-octoeverywhere-target', 'x-octoeverywhere-auth', 'x-octoeverywhere-app-token', 'x-octoeverywhere-native-key']) {
      assert.equal(upstream.headers[key], undefined, key);
    }

    // Omitting X-OctoEverywhere-Auth omits Authorization ({ type: 'none' }).
    assert.equal((await f.request('/plugin/status', { headers: { 'X-OctoEverywhere-Target': TARGET } })).status, 200);
    assert.equal(f.calls.filter(c => c.path).at(-1).headers.authorization, undefined);

    // Basic auth header forwarding.
    const basicHeader = 'Basic ' + Buffer.from('synthetic-user:synthetic-password').toString('base64');
    assert.equal((await f.request('/plugin/status', { headers: printerHeaders({ 'X-OctoEverywhere-Auth': basicHeader }) })).status, 200);
    assert.equal(f.calls.filter(c => c.path).at(-1).headers.authorization, basicHeader);

    // Exact plugin schema & method allowlists.
    for (const [route, method, body] of [
      ['/plugin/unknown', 'GET'], ['/plugin/status', 'POST', {}], ['/plugin/status?url=https://evil.invalid', 'GET'],
      ['/plugin/status?IncludeMaterialSystem=true&IncludeMaterialSystem=false', 'GET'],
      ['/plugin/set-temp', 'POST', { BedC: 76 }], ['/plugin/set-temp', 'POST', { ToolC: 261 }],
      ['/plugin/move-axis', 'POST', { Axis: 'E', DistanceMm: 5 }], ['/plugin/start', 'POST', { Path: 'gcode/../bad' }],
      ['/plugin/set-light', 'POST', { Name: 'chamber', On: true, url: 'evil' }], ['/plugin/files/details', 'GET'],
      ['/plugin/files/download?path=gcode%2F..%2Fsecret', 'GET'], ['/plugin/files/delete?path=gcode/a.gcode', 'DELETE']
    ]) {
      const r = await f.request(route, { headers: printerHeaders(), method, body });
      assert.equal(r.status, 400, route + ' ' + r.text);
    }
    for (const [route, body] of [
      ['pause', { SmartPause: true, ZLiftMm: 5 }], ['resume', {}], ['cancel', {}], ['home', {}],
      ['set-light', { Name: 'chamber', On: true }], ['move-axis', { Axis: 'Z', DistanceMm: -5 }],
      ['extrude', { Extruder: 0, DistanceMm: 10 }], ['set-temp', { ToolC: 260, BedC: 75, ChamberC: 0 }],
      ['start', { Path: 'gcode/synthetic.3mf', Plate: 2, UseAms: true, AmsMapping: [0, 1], FlowCali: false }]
    ]) assert.equal((await f.request('/plugin/' + route, { method: 'POST', body, headers: printerHeaders() })).status, 200, route);

    // App API auth separation: only AppToken to octoeverywhere.com, never Authorization or X-Api-Key.
    await f.request('/info', { headers: appHeaders({ 'X-OctoEverywhere-Auth': `Bearer ${RELAY_TOKEN}`, 'X-OctoEverywhere-Native-Key': NATIVE_KEY, authorization: 'ambient', cookie: 'c=1' }) });
    const infoTarget = f.calls.filter(c => c.target).at(-1);
    assert.equal(infoTarget.target, 'octoeverywhere.com');
    const info = f.calls.filter(c => c.path).at(-1);
    assert.equal(info.path, '/api/appconnection/info');
    assert.equal(info.headers.apptoken, APP_TOKEN);
    assert.equal(info.headers.authorization, undefined);
    assert.equal(info.headers['x-api-key'], undefined);
    assert.equal(info.headers.cookie, undefined);

    // Native routes forward X-Api-Key and reject ambient Authorization.
    assert.equal((await f.request('/native/api/printer', { headers: nativeHeaders() })).status, 200);
    assert.equal(f.calls.filter(c => c.path).at(-1).headers['x-api-key'], NATIVE_KEY);
    assert.equal((await f.request('/native/api/printer', { headers: nativeHeaders({ authorization: 'native-bearer' }) })).status, 400);
  } finally { await f.close(); }
});

test('DNS pinning, private IP blocking, redirect refusal, native allowlists, 6xx forwarding and secret scrubbing', async () => {
  const f = await fixture();
  try {
    for (const route of ['/native/http://evil.invalid', '/native/api/../secret', '/native/server/files/upload?url=evil',
      '/native/printer/gcode/script?script=M112', '/native/api/printer?redirect=evil', '/native/api/connection', '/native/webcam/']) {
      assert.equal((await f.request(route, { headers: nativeHeaders() })).status >= 400, true, route);
    }
    f.setReply((_req, res) => { res.writeHead(302, { location: 'https://evil.invalid/?token=secret' }); res.end(); });
    const redirected = await f.request('/plugin/status', { headers: printerHeaders() });
    assert.equal(redirected.status, 502); assert.equal(redirected.headers.location, undefined);
    assert.equal(redirected.json().reason, 'upstream_redirect');
    assert.equal(redirected.text.includes('evil.invalid'), false);

    f.setReply((_req, res) => { res.writeHead(604); res.end(APP_TOKEN); });
    const revoked = await f.request('/info', { headers: appHeaders() });
    assert.equal(revoked.status, 604); assert.equal(revoked.json().code, 604); assert.equal(revoked.text.includes(APP_TOKEN), false);

    // Scrub bearer token, basic parts, native key and app token from responses without retaining them.
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ Status: 788, Error: `Bearer ${RELAY_TOKEN} / ${RELAY_TOKEN}` })); });
    const bearerScrub = await f.request('/plugin/status', { headers: printerHeaders() });
    assert.equal(bearerScrub.status, 200); assert.deepEqual(bearerScrub.json(), { Status: 788, Error: '[redacted] / [redacted]' });

    const basicB64 = Buffer.from('basic-user-secret:basic-pass-secret').toString('base64');
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ Status: 788, Error: `${basicB64} basic-user-secret basic-pass-secret` })); });
    const basicScrub = await f.request('/plugin/status', { headers: printerHeaders({ 'X-OctoEverywhere-Auth': `Basic ${basicB64}` }) });
    assert.equal(basicScrub.status, 200);
    assert.deepEqual(basicScrub.json(), { Status: 788, Error: '[redacted] [redacted] [redacted]' });

    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ Error: NATIVE_KEY })); });
    const nativeScrub = await f.request('/native/api/printer', { headers: nativeHeaders() });
    assert.equal(nativeScrub.status, 200); assert.deepEqual(nativeScrub.json(), { Error: '[redacted]' });

    const pin = f.calls.find(c => c.pin);
    await new Promise(resolve => pin.pin('ignored-name', {}, (_error, address, family) => { assert.equal(address, '8.8.8.8'); assert.equal(family, 4); resolve(); }));
    await new Promise(resolve => pin.pin('ignored-name', { all: true }, (_error, addresses) => { assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]); resolve(); }));
  } finally { await f.close(); }

  for (const address of ['127.0.0.1', '192.168.1.2', '0.0.0.0', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::']) {
    const blocked = await fixture({ resolver: async () => [{ address, family: address.includes(':') ? 6 : 4 }] });
    try {
      assert.equal((await blocked.request('/plugin/status', { headers: printerHeaders() })).status, 403, address);
      assert.equal(blocked.calls.length, 0);
    } finally { await blocked.close(); }
  }
});

test('raw upload/download, X-OctoEverywhere-Max-Bytes, JSON file downloads and PNG/JPEG snapshots', async () => {
  const f = await fixture();
  try {
    const payload = Buffer.from([0, 1, 2, 255, 10]);
    assert.equal((await f.request('/plugin/files/upload?path=gcode/synthetic.gcode', { method: 'PUT', headers: printerHeaders(), body: payload })).status, 200);
    const upload = f.calls.filter(c => c.path).at(-1);
    assert.equal(upload.method, 'PUT'); assert.deepEqual(upload.body, payload);
    assert.equal(f.calls.some(c => c.path?.endsWith('/start')), false);

    // X-OctoEverywhere-Max-Bytes validation and enforcement on upload and download.
    assert.equal((await f.request('/plugin/files/upload?path=gcode/synthetic.gcode', {
      method: 'PUT', headers: printerHeaders({ 'X-OctoEverywhere-Max-Bytes': '3' }), body: payload
    })).status, 413);
    assert.equal((await f.request('/plugin/files/upload?path=gcode/synthetic.gcode', {
      method: 'PUT', headers: printerHeaders({ 'X-OctoEverywhere-Max-Bytes': '-1' }), body: payload
    })).status, 400);
    assert.equal((await f.request('/plugin/files/upload?path=gcode/synthetic.gcode', {
      method: 'PUT', headers: printerHeaders({ 'X-OctoEverywhere-Max-Bytes': '5' }), body: payload
    })).status, 200);

    f.setReply((_req, res) => { res.setHeader('content-type', 'application/octet-stream'); res.end(payload); });
    const download = await f.request('/plugin/files/download?path=gcode/synthetic.gcode', { headers: printerHeaders() });
    assert.deepEqual(download.bytes, payload); safe(download);
    await assert.rejects(f.request('/plugin/files/download?path=gcode/synthetic.gcode', {
      headers: printerHeaders({ 'X-OctoEverywhere-Max-Bytes': '3' })
    }));

    // JSON file downloads retain exact bytes beyond API JSON limit, scrub error envelopes, and obey Max-Bytes.
    let jsonPayload = Buffer.from(`{ "number": 12345678901234567890, "text": "${RELAY_TOKEN}" }\n`);
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(jsonPayload); });
    const downloadJson = (extra = {}) => f.request('/plugin/files/download?path=gcode/config.json', { headers: printerHeaders(extra) });
    assert.deepEqual((await downloadJson()).bytes, jsonPayload);
    jsonPayload = Buffer.from(JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }));
    assert.deepEqual((await downloadJson()).bytes, jsonPayload);
    jsonPayload = Buffer.from(`{"Status":788,"Error":"${RELAY_TOKEN}"}`);
    assert.equal((await downloadJson()).json().Error, '[redacted]');
    await assert.rejects(downloadJson({ 'X-OctoEverywhere-Max-Bytes': '4' }));

    // JPEG & PNG webcam snapshots.
    f.setReply((_req, res) => { res.setHeader('content-type', 'image/jpeg'); res.end(payload); });
    const jpeg = await f.request('/plugin/webcam/snapshot?index=2', { headers: printerHeaders() });
    assert.equal(jpeg.status, 200); assert.equal(jpeg.headers['content-type'], 'image/jpeg');
    assert.deepEqual(jpeg.bytes, payload); safe(jpeg);
    assert.equal(f.calls.filter(c => c.path).at(-1).path, '/octoeverywhere-command-api/webcam/snapshot?index=2');

    f.setReply((_req, res) => { res.setHeader('content-type', 'image/png'); res.end(payload); });
    const png = await f.request('/plugin/webcam/snapshot?index=0', { headers: printerHeaders() });
    assert.equal(png.status, 200); assert.equal(png.headers['content-type'], 'image/png');
    assert.deepEqual(png.bytes, payload); safe(png);
  } finally { await f.close(); }
});

test('MJPEG streaming, X-OctoEverywhere-Stream-Seconds, concurrency cap and abort cleanup', async () => {
  const f = await fixture();
  try {
    // Invalid X-OctoEverywhere-Stream-Seconds rejected.
    for (const bad of ['0', '301', '-5', 'abc', '1.5']) {
      assert.equal((await f.request('/plugin/webcam/stream', { headers: printerHeaders({ 'X-OctoEverywhere-Stream-Seconds': bad }) })).status, 400, bad);
    }

    // Stream timeout enforces X-OctoEverywhere-Stream-Seconds=1.
    f.setReply((_req, res) => { res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=fixture' }); res.write('--fixture\r\n'); });
    const startedAt = Date.now();
    const timed = await new Promise((resolve, reject) => {
      const req = http.get(f.origin + BASE + '/plugin/webcam/stream', {
        headers: { origin: f.origin, 'sec-fetch-site': 'same-origin', ...printerHeaders({ 'X-OctoEverywhere-Stream-Seconds': '1' }) }
      }, res => {
        res.on('error', () => {});
        const chunks = [];
        res.on('data', b => chunks.push(b));
        res.once('close', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'], body: Buffer.concat(chunks).toString(), elapsed: Date.now() - startedAt }));
      });
      req.on('error', reject);
    });
    assert.equal(timed.status, 200);
    assert.equal(timed.contentType, 'multipart/x-mixed-replace; boundary=fixture');
    assert.equal(timed.body, '--fixture\r\n');
    assert.ok(timed.elapsed >= 800 && timed.elapsed < 5000, `expected ~1s stream timeout, got ${timed.elapsed}ms`);

    // Concurrency cap of 128 active transfers -> 129th gets 429, aborting frees slots.
    const streams = [];
    for (let i = 0; i < 128; i++) {
      const pair = await new Promise((resolve, reject) => {
        const req = http.get(f.origin + BASE + '/plugin/webcam/stream', {
          headers: { origin: f.origin, 'sec-fetch-site': 'same-origin', ...printerHeaders() }
        }, res => {
          res.on('error', () => {});
          res.resume();
          resolve({ req, res });
        });
        req.on('error', () => {});
      });
      streams.push(pair);
    }
    assert.equal((await f.request('/plugin/status', { headers: printerHeaders() })).status, 429);

    const closed = new Promise(resolve => streams[0].res.once('close', resolve));
    streams[0].req.destroy();
    await closed;
    await new Promise(resolve => setTimeout(resolve, 20));
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"Status":200,"Result":{}}'); });
    assert.equal((await f.request('/plugin/status', { headers: printerHeaders() })).status, 200);

    for (const { req } of streams.slice(1)) req.destroy();
  } finally { await f.close(); }
});

test('official Gadget 10s hashed throttle, Live Link, webhook methods and bounded schemas', async () => {
  const f = await fixture();
  try {
    const call = (suffix, body = {}, method = 'POST', extraHeaders = {}) =>
      f.request(suffix, { method, headers: appHeaders(extraHeaders), body });
    assert.equal((await call('/gadget', {}, 'POST', { 'X-OctoEverywhere-Connection-Id': CONNECTION_ID })).status, 200);
    assert.equal((await call('/gadget', {}, 'POST', { 'X-OctoEverywhere-Connection-Id': CONNECTION_ID })).status, 429);
    // Different connection ID is not blocked by first connection's throttle.
    assert.equal((await call('/gadget', {}, 'POST', { 'X-OctoEverywhere-Connection-Id': 'other-connection' })).status, 200);
    f.advance(10_000);
    assert.equal((await call('/gadget', {}, 'POST', { 'X-OctoEverywhere-Connection-Id': CONNECTION_ID })).status, 200);

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
      ['POST', '/api/gadget/GetStatusFromAppConnection'],
      ['POST', '/api/gadget/GetStatusFromAppConnection'],
      ['POST', '/api/gadget/GetStatusFromAppConnection'],
      ['POST', '/api/live/createfromappconnection'],
      ['POST', '/api/appconnection/SetNotificationWebhook'],
      ['POST', '/api/appconnection/DeleteNotificationWebhook'],
      ['GET', '/api/appconnection/TestWebhook']
    ]);
    assert.deepEqual(JSON.parse(calls[4].body), webhook);
    for (const c of calls) {
      assert.equal(c.headers.apptoken, APP_TOKEN);
      assert.equal(c.headers.authorization, undefined);
      assert.equal(c.body.includes(APP_TOKEN), false);
    }
    for (const WebhookUrl of ['http://callback.example.invalid/', 'https://127.0.0.1/', 'https://user:pass@callback.example.invalid/']) {
      assert.equal((await call('/notifications', { WebhookUrl })).status, 400);
    }
  } finally { await f.close(); }
});

test('closing a downstream mutation during DNS prevents upstream dispatch', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture({ resolver: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  try {
    const closed = new Promise(resolve => f.server.once('request', (_req, res) => res.once('close', resolve)));
    const req = http.request(f.origin + BASE + '/plugin/cancel', { method: 'POST', headers: { origin: f.origin, ...printerHeaders() } });
    req.on('error', () => {}); req.end();
    await started; req.destroy(); await closed;
    release([{ address: '8.8.8.8', family: 4 }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('App API unwraps { Status, Result } envelopes, maps status errors, preserves bare JSON and logs non-secret diagnostics', async () => {
  const f = await fixture();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const envelopedInfo = {
      Status: 200,
      Error: null,
      Result: {
        PrinterName: 'Enveloped Printer',
        IsOnline: true,
        PrinterLimits: { MaxUploadFileSizeBytes: 3, MaxDownloadFileSizeBytes: 3, MaxSingleWebcamStreamLengthSeconds: 5 }
      }
    };
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(envelopedInfo)); });
    const unwrapped = await f.request('/info', { headers: appHeaders() });
    assert.equal(unwrapped.status, 200);
    assert.deepEqual(unwrapped.json(), envelopedInfo.Result);

    // Bare JSON /info continues to work.
    const bareInfo = { PrinterName: 'Bare Printer', IsOnline: false, PrinterLimits: { MaxUploadFileSizeBytes: 16 } };
    f.setReply((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(bareInfo)); });
    const bare = await f.request('/info', { headers: appHeaders() });
    assert.equal(bare.status, 200);
    assert.deepEqual(bare.json(), bareInfo);

    // App API { Status: 605, Error: 'secret-value' } maps to HTTP 605 with scrubbed error and sanitized warning.
    warnings.length = 0;
    f.setReply((_req, res) => {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ Status: 605, Error: 'secret-value ' + APP_TOKEN, Result: null }));
    });
    const rejected = await f.request('/info', { headers: appHeaders() });
    assert.equal(rejected.status, 605);
    assert.deepEqual(rejected.json(), { error: 'OctoEverywhere rejected the request.', code: 605 });
    assert.equal(rejected.text.includes('secret-value'), false);
    assert.equal(rejected.text.includes(APP_TOKEN), false);
    assert.equal(warnings.length, 1);
    const meta = JSON.parse(warnings[0].slice(warnings[0].indexOf('{')));
    assert.equal(meta.route, '/api/appconnection/info');
    assert.equal(meta.app, true);
    assert.equal(meta.method, 'GET');
    assert.equal(meta.status, 200);
    assert.equal(meta.pluginStatus, 605);
    assert.equal(meta.authType, 'app');
    assert.equal(meta.contentType, 'application/json');
    for (const secret of ['secret-value', APP_TOKEN, RELAY_TOKEN, 'fixture.octoeverywhere.com']) {
      assert.equal(warnings[0].includes(secret), false, secret);
    }

    // Plugin JSON Status >= 400 preserves 200 scrubbed body and logs warning with query stripped.
    warnings.length = 0;
    f.setReply((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ Status: 785, Error: 'secret-value ' + RELAY_TOKEN }));
    });
    const pluginErr = await f.request('/plugin/status?IncludeMaterialSystem=true', { headers: printerHeaders() });
    assert.equal(pluginErr.status, 200);
    assert.deepEqual(pluginErr.json(), { Status: 785, Error: 'secret-value [redacted]' });
    assert.equal(warnings.length, 1);
    const pluginMeta = JSON.parse(warnings[0].slice(warnings[0].indexOf('{')));
    assert.equal(pluginMeta.route, '/octoeverywhere-command-api/status');
    assert.equal(pluginMeta.app, false);
    assert.equal(pluginMeta.pluginStatus, 785);
    assert.equal(pluginMeta.authType, 'bearer');
    assert.equal(warnings[0].includes('IncludeMaterialSystem'), false);
    assert.equal(warnings[0].includes('secret-value'), false);
    assert.equal(warnings[0].includes(RELAY_TOKEN), false);
  } finally {
    console.warn = origWarn;
    await f.close();
  }
});

test('packaged hosted route stays optional, hides backend artifacts, sets callback headers and rejects old stateful routes', async () => {
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
    return { listening, port, origin, stderr: () => stderr, async stop() { if (child.exitCode === null) child.kill('SIGTERM'); await exited; },
      async call(route, method = 'GET', body, extraHeaders = {}) {
        return await new Promise((resolve, reject) => {
          const req = http.request(origin + route, { method, headers: { origin, 'content-type': 'application/json', ...extraHeaders } }, res => {
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
      outfile: path.join(root, 'octoeverywhere-bridge.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20' });
    writeFileSync(path.join(root, 'octoeverywhere-bridge.mjs.br'), 'synthetic private artifact');
    const enabled = await start({ ORCA_OCTOEVERYWHERE_ENABLED: '1' });
    try {
      assert.equal(enabled.listening, true, enabled.stderr());
      assert.deepEqual((await enabled.call(BASE + '/config')).json(), { enabled: true, appId: 'weborca', portalAvailable: true });
      assert.equal((await enabled.call(BASE + '/sessions', 'POST', {})).status, 404);
      assert.equal((await enabled.call(BASE + '/portal/start', 'POST', {})).status, 404);
      const callbackSub = await enabled.call('/octoeverywhere/callback/test-flow?success=true');
      assert.equal(callbackSub.status, 200);
      assert.equal(callbackSub.headers['referrer-policy'], 'no-referrer');
      assert.equal(callbackSub.headers['cache-control'], 'no-store');
      const callbackRoot = await enabled.call('/octoeverywhere/callback');
      assert.equal(callbackRoot.status, 200);
      assert.equal(callbackRoot.headers['referrer-policy'], 'no-referrer');
      assert.equal(callbackRoot.headers['cache-control'], 'no-store');
      // Upgrade to /_octoeverywhere/* closes cleanly with 404.
      const upgradeStatus = await new Promise((resolve, reject) => {
        const req = http.request(enabled.origin + BASE + '/tickets/none', {
          headers: { origin: enabled.origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' }
        }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.end();
      });
      assert.equal(upgradeStatus, 404);
      for (const artifact of ['/octoeverywhere-bridge.mjs', '/octoeverywhere-bridge.mjs.br', '/octoeverywhere-bridge.mjs.gz']) assert.equal((await enabled.call(artifact)).status, 404);
      assert.equal((await enabled.call('/_printer/api/job', 'POST', {})).status, 404);
    } finally { await enabled.stop(); }
    const noAppId = await start({ ORCA_OCTOEVERYWHERE_ENABLED: '1', ORCA_OCTOEVERYWHERE_APP_ID: '' });
    try {
      assert.equal(noAppId.listening, true, noAppId.stderr());
      assert.deepEqual((await noAppId.call(BASE + '/config')).json(), { enabled: true, portalAvailable: false });
    } finally { await noAppId.stop(); }
    const badOrigin = await start({ ORCA_OCTOEVERYWHERE_ENABLED: '1', ORCA_PUBLIC_ORIGIN: 'https://app.invalid/path' });
    assert.equal(badOrigin.listening, false); assert.match(badOrigin.stderr(), /canonical ORCA_PUBLIC_ORIGIN/); await badOrigin.stop();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
