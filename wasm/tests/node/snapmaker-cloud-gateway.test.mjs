import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { handleSnapmakerCloudRequest } from '../../app/gateway/snapmakerCloud.ts';
import { startGateway, listen, close } from './lib/gatewayHarness.mjs';

const prefix = '/_printer/snapmaker-cloud';
const account = 'fixture@example.invalid';
const password = 'synthetic-fixture-only';
const envelope = { code: 200, data: { access_token: 'fixture-access', refresh_token: 'fixture-refresh' }, message: 'ok' };

async function fixture(options = {}) {
  const calls = [];
  let respond = (_req, res) => res.end(JSON.stringify(envelope));
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, method: req.method, headers: req.headers, body });
    res.setHeader('set-cookie', 'synthetic=private');
    res.setHeader('location', 'https://external.invalid/?token=synthetic');
    respond(req, res);
  });
  const port = await listen(upstream);
  const gatewayOptions = { cloud: 'snapmaker-cloud', snapmakerCloud: {
    authHost: '127.0.0.1', authPort: port, authProtocol: 'http', apiHost: '127.0.0.1', apiPort: port, apiProtocol: 'http'
  }, ...options };
  const gateway = await startGateway(gatewayOptions);
  function request(route, { method = 'POST', body = method === 'GET' ? undefined : {}, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request({ hostname: '127.0.0.1', port: gateway.port, path: prefix + route, method,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload ?? ''), cookie: 'ambient=secret', authorization: 'Bearer fixture-access', ...headers } }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
        res.on('error', reject);
      });
      req.on('error', error => reject(new Error(`${method} ${route}: ${error.message}`)));
      req.end(payload);
    });
  }
  return { calls, request, gateway, port, respond: fn => { respond = fn; }, async close() {
    await gateway.close();
    upstream.closeAllConnections();
    await close(upstream);
  } };
}

function form(call) {
  const boundary = /boundary=(.+)$/.exec(call.headers['content-type'])[1];
  const fields = {};
  for (const part of call.body.split('--' + boundary).slice(1, -1)) {
    const match = /^\r\nContent-Disposition: form-data; name="([^"]+)"\r\n\r\n([\s\S]*)\r\n$/.exec(part);
    assert.ok(match);
    fields[match[1]] = match[2];
  }
  assert.equal(Number(call.headers['content-length']), Buffer.byteLength(call.body));
  return fields;
}

function safe(response) {
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.headers.location, undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
}

test('exact password/code/refresh/profile/device contracts preserve provider envelopes', async () => {
  const f = await fixture();
  try {
    for (const body of [{ email: account, password }, { email: account, code: '123456' }]) {
      const response = await f.request('/auth/token', { body });
      assert.equal(response.status, 200);
      assert.deepEqual(response.json(), envelope);
      safe(response);
    }
    assert.deepEqual(form(f.calls[0]), { scope: 'profile openid', username: account,
      password: createHash('sha256').update(account + '$sm-nonce@' + password).digest('hex'), grant_type: 'password' });
    assert.deepEqual(form(f.calls[1]), { scope: 'profile openid', email: account, grant_type: 'urn:ietf:params:oauth:grant-type:email', code: '123456' });
    assert.equal((await f.request('/auth/refresh', { body: { refresh_token: 'fixture-refresh' } })).status, 200);
    assert.deepEqual(form(f.calls[2]), { grant_type: 'refresh_token', refresh_token: 'fixture-refresh' });
    assert.equal((await f.request('/auth/send-code', { body: { account } })).status, 200);
    assert.deepEqual(JSON.parse(f.calls[3].body), { account, action: 'oauth' });
    assert.equal(f.calls[3].headers.authorization, undefined);
    const profile = { code: 200, data: { id: 'fixture-account', email: account } };
    f.respond((_req, res) => res.end(JSON.stringify(profile)));
    assert.deepEqual((await f.request('/account', { method: 'GET' })).json(), profile);
    for (const code of [0, 200]) {
      const devices = { code, data: [{ deviceId: 'fixture-device', name: 'Synthetic U1' }], page: null };
      f.respond((_req, res) => res.end(JSON.stringify(devices)));
      const response = await f.request('/devices');
      assert.deepEqual(response.json(), devices);
      safe(response);
    }
    assert.deepEqual(JSON.parse(f.calls[5].body), { name: null, mac: null, sn: null, productName: null, productCode: null, pageIndex: null, pageRows: null });
    assert.deepEqual(f.calls.map(call => call.path), ['/api/oauth2/token', '/api/oauth2/token', '/api/oauth2/token', '/api/common/accounts/sendVerificationCode', '/api/common/accounts/current', '/api/user/device/list', '/api/user/device/list']);
    for (const [index, call] of f.calls.entries()) {
      assert.equal(call.headers.cookie, undefined);
      assert.equal(call.headers['accept-language'], 'en-US,en;q=0.9');
      for (const name of ['x-custom-site', 'os', 'device-type']) assert.equal(call.headers[name], 'WebOrca');
      if (index < 3) assert.equal(call.headers.authorization, 'Basic bWFsbC1hcHA6MTIzNDU2');
      if (index > 3) assert.equal(call.headers.authorization, 'Bearer fixture-access');
    }
  } finally { await f.close(); }
});

test('opt-in and exact route/body/token boundaries reject before upstream traffic', async () => {
  for (const cloud of ['', 'creality-cloud']) {
    const f = await fixture({ cloud });
    try {
      assert.equal((await f.request('/auth/token', { body: { email: account, password } })).status, 403);
      assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
  }
  const f = await fixture();
  try {
    for (const route of ['/auth/token?x=1', '/auth/token?', '/global/auth/token', '/china/auth/token', '/control', '/upload', '/user/device/bind', '/https://external.invalid/', '/auth/%74oken', '/auth/../auth/token', '/auth/%2e%2e/auth/token', '/auth/%252e%252e/token']) {
      assert.equal((await f.request(route)).status, 403, route);
    }
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) assert.equal((await f.request('/auth/token', { method })).status, 403);
    for (const body of [{}, [], null, { email: account, password, code: '123456' }, { email: account, password, host: 'external.invalid' }, { email: account, password, region: 'china' }, { email: account, password: '' }, { email: account, password: 'x'.repeat(1025) }, { email: 'x'.repeat(255), password }, { email: account, code: 'x'.repeat(129) }, '{']) {
      assert.equal((await f.request('/auth/token', { body })).status, 400);
    }
    for (const [route, body] of [['/auth/send-code', { account, action: 'oauth' }], ['/auth/refresh', { refresh_token: 'x'.repeat(8193) }], ['/devices', { pageIndex: 1 }]]) assert.equal((await f.request(route, { body })).status, 400);
    assert.equal((await f.request('/devices', { headers: { authorization: 'Basic ambient' } })).status, 401);
    assert.equal((await f.request('/account', { method: 'GET', body: {} })).status, 400);
    assert.equal((await f.request('/devices', { headers: { authorization: 'Bearer ' + 'x'.repeat(8193) } })).status, 401);
    assert.equal((await f.request('/auth/token', { body: 'x'.repeat(65537) })).status, 413);
    assert.equal((await f.request('/auth/token', { body: { email: account, password }, headers: { 'content-type': 'text/plain' } })).status, 400);
    assert.equal(f.calls.length, 0);
    const status = await fetch(f.gateway.url + '/_printer/status');
    assert.deepEqual((await status.json()).cloud, ['snapmaker-cloud']);
    assert.equal((await fetch(f.gateway.url + '/_printer/https/api.snapmaker.com/api/oauth2/token')).status, 403);
    assert.equal((await fetch(f.gateway.url + '/_printer/https/id.snapmaker.com/api/user/device/list')).status, 403);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('auth rejection mapping preserves envelopes and transient failures; bounded response and redirects fail closed', async () => {
  const f = await fixture();
  try {
    for (const body of ['', 'Unauthorized', 'null', '[]']) {
      f.respond((_req, res) => { res.statusCode = 401; res.end(body); });
      const response = await f.request('/account', { method: 'GET' });
      assert.equal(response.status, 401, `HTTP 401 body ${JSON.stringify(body)}`);
      assert.equal(response.text, 'Snapmaker authentication rejected.');
      safe(response);
    }
    for (const code of [401, 110002, 110003, 110004, '110003', 500, 100001]) {
      const value = { code, message: 'synthetic failure' };
      f.respond((_req, res) => res.end(JSON.stringify(value)));
      const response = await f.request('/devices');
      assert.equal(response.status, [500, 100001].includes(code) ? 200 : 401);
      assert.deepEqual(response.json(), value);
    }
    f.respond((_req, res) => { res.statusCode = 503; res.end('{"code":503}'); });
    assert.equal((await f.request('/devices')).status, 503);
    f.respond((_req, res) => { res.statusCode = 302; res.end('{}'); });
    const redirect = await f.request('/devices');
    assert.equal(redirect.status, 502);
    safe(redirect);
    f.respond((_req, res) => res.end('x'.repeat(1024 * 1024 + 1)));
    assert.equal((await f.request('/devices')).status, 502);
    f.respond((_req, res) => { res.setHeader('content-length', '1000'); res.write('{}'); res.socket.destroy(); });
    assert.equal((await f.request('/devices')).status, 502);
    f.respond((_req, res) => res.end('not json'));
    assert.equal((await f.request('/devices')).status, 502);
  } finally { await f.close(); }
});

test('fixed HTTPS destinations and mandatory TLS verification ignore insecure environment/options', async () => {
  const transport = https.request;
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const calls = [];
  const upstream = http.createServer((_req, res) => res.end('{"code":200,"data":[]}'));
  const port = await listen(upstream);
  https.request = (options, callback) => {
    calls.push(options);
    return http.request({ ...options, hostname: '127.0.0.1', port }, callback);
  };
  syncBuiltinESMExports();
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const server = http.createServer((req, res) => void handleSnapmakerCloudRequest(req, res, req.url, { cloud: 'snapmaker-cloud', snapmakerCloud: { rejectUnauthorized: false } }));
  const gatewayPort = await listen(server);
  try {
    for (const route of ['/auth/send-code', '/devices']) {
      const response = await fetch(`http://127.0.0.1:${gatewayPort}${prefix}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic' }, body: JSON.stringify(route === '/devices' ? {} : { account }) });
      assert.equal(response.status, 200);
      await response.text();
    }
    assert.deepEqual(calls.map(call => [call.hostname, call.port, call.rejectUnauthorized]), [['api.snapmaker.com', 443, true], ['id.snapmaker.com', 443, true]]);
  } finally {
    https.request = transport;
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    server.closeAllConnections();
    await close(server);
    await close(upstream);
  }
});

test('15 second total deadline and downstream disconnect cancel pending upstream', { timeout: 22000 }, async () => {
  const f = await fixture();
  try {
    f.respond(() => {});
    const start = Date.now();
    assert.equal((await f.request('/devices')).status, 504);
    assert.ok(Date.now() - start >= 14500 && Date.now() - start < 20000);
    let cancelled;
    const aborted = new Promise(resolve => { cancelled = resolve; });
    f.respond((_req, res) => res.on('close', cancelled));
    const req = http.request({ hostname: '127.0.0.1', port: f.gateway.port, path: prefix + '/devices', method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-access' } });
    req.on('error', () => {});
    req.end('{}');
    const ready = Date.now();
    while (f.calls.length < 2 && Date.now() - ready < 1000) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.calls.length, 2);
    req.destroy();
    let timer;
    try { await Promise.race([aborted, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('upstream not cancelled')), 1000); })]); }
    finally { clearTimeout(timer); }
  } finally { await f.close(); }
});
