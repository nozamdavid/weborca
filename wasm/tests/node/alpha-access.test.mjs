import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { PassThrough } from 'node:stream';
import { createAlphaAccess } from '../../app/gateway/alphaAccess.ts';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { loadConfigFromFile } from '../../app/node_modules/vite/dist/node/index.js';

const PASSWORD = 'synthetic-test-password-never-a-default';
const ORIGIN = 'https://alpha.example';
function files() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-alpha-'));
  const root = path.join(tmp, 'web'); fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, 'assets'));
  fs.mkdirSync(path.join(root, 'alpha-public'));
  fs.mkdirSync(path.join(root, 'resources', 'handy_models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<title>PROTECTED_APP</title>');
  fs.writeFileSync(path.join(root, 'alpha-bootstrap.html'), '<title>PUBLIC_LOGIN</title>');
  fs.writeFileSync(path.join(root, 'assets/app.js'), 'PROTECTED_JS');
  fs.writeFileSync(path.join(root, 'engine-worker.js'), 'STATIC_WORKER');
  fs.writeFileSync(path.join(root, 'alpha-public/bootstrap.js'), 'PUBLIC_JS');
  fs.writeFileSync(path.join(root, 'resources/handy_models/OrcaBadge.3mf'), 'PACKAGED_MODEL');
  const file = path.join(tmp, 'state.json');
  const env = { ORCA_ALPHA_GATE_ENABLED: '1', ORCA_ALPHA_ADMIN_PASSWORD: PASSWORD,
    ORCA_ALPHA_DATA_FILE: file, ORCA_PUBLIC_ORIGIN: ORIGIN };
  return { tmp, root, file, env, clean: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}
function request(port, route, { method = 'GET', body, token, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, path: route, method,
      headers: { host: 'alpha.example', origin: ORIGIN, ...(data === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, text,
          json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject); req.end(data);
  });
}
async function fixture(t, enabled = true) {
  const f = files(); let time = Date.now();
  if (!enabled) f.env = {};
  let gate = createAlphaAccess({ env: f.env, webRoot: f.root, now: () => time });
  const server = http.createServer(async (req, res) => {
    if (await gate.guard(req, res)) return;
    if (req.url === '/_printer/snapmaker-cloud/synthetic-stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ready\n\n');
      return;
    }
    res.end('DOWNSTREAM');
  });
  const sockets = new WebSocketServer({ noServer: true });
  sockets.on('connection', socket => socket.on('message', data => socket.send(data)));
  server.on('upgrade', (req, socket, head) => {
    if (!gate.authorizeUpgrade(req, socket)) { socket.destroy(); return; }
    sockets.handleUpgrade(req, socket, head, client => sockets.emit('connection', client));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    gate.close?.();
    for (const socket of sockets.clients) socket.terminate();
    sockets.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); f.clean();
  });
  const call = (route, options) => request(server.address().port, route, options);
  return { ...f, call, port: server.address().port, advance: ms => { time += ms; }, restart: (env = f.env) => {
    gate.close?.();
    gate = createAlphaAccess({ env, webRoot: f.root, now: () => time });
  }, gate: () => gate };
}
function bounded(promise, message = 'Connection did not close') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), 1500);
  })]).finally(() => clearTimeout(timer));
}
async function connections(f, token) {
  const headers = { host: 'alpha.example', origin: ORIGIN,
    ...(token ? { cookie: `orca_alpha=${token}` } : {}), authorization: 'Bearer synthetic-provider-token' };
  const ws = new WebSocket(`ws://127.0.0.1:${f.port}/_printer/snapmaker-cloud/monitor`, { headers });
  const wsClosed = once(ws, 'close');
  await bounded(once(ws, 'open'), 'WebSocket did not open');
  const stream = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: f.port, path: '/_printer/snapmaker-cloud/synthetic-stream', headers }, res => {
      res.on('error', () => {}); // Expected aborted response when the gate destroys a stream.
      const closed = new Promise(resolve => res.once('close', resolve));
      res.once('data', () => resolve({ res, closed }));
    });
    req.on('error', reject);
  });
  return { ws, stream, closed: () => bounded(Promise.all([wsClosed, stream.closed])), async alive() {
    assert.equal(stream.res.destroyed, false);
    const echoed = once(ws, 'message'); ws.send('synthetic-traffic');
    assert.equal((await bounded(echoed, 'Other tester lost socket traffic'))[0].toString(), 'synthetic-traffic');
  } };
}
async function login(f) {
  const res = await f.call('/_alpha/admin/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(res.status, 200); return res.json().token;
}
async function invite(f, admin, labels = {}) {
  const res = await f.call('/_alpha/admin/invites', { method: 'POST', token: admin, body: labels });
  assert.equal(res.status, 201); return res.json();
}
async function validate(f, code) {
  return f.call('/_alpha/validate', { method: 'POST', body: { code } });
}

test('explicit admin launch grants only app access without invites and preserves durable tester state', async t => {
  const f = await fixture(t), admin = await login(f);
  const launch = token => f.call('/_alpha/admin/open-slicer', { method: 'POST', body: {}, token });
  assert.equal((await launch()).status, 401);
  assert.equal((await f.call('/engine/x.wasm', { token: admin })).status, 401);
  const created = await invite(f, admin);
  const tester = (await validate(f, created.code)).json().token;
  assert.equal((await launch(tester)).status, 401);
  assert.equal((await f.call('/_alpha/admin/open-slicer', { method: 'POST', body: {}, token: admin,
    headers: { origin: 'https://other.example' } })).status, 403);
  const before = fs.readFileSync(f.file, 'utf8');
  f.advance(1000);
  const opened = await launch(admin), app = opened.json().token;
  assert.equal(opened.status, 200);
  assert.match(opened.headers['set-cookie'][0], /orca_alpha=.*HttpOnly; SameSite=Strict; Path=\/;.*Secure/);
  assert.equal(Date.parse(opened.json().expiresAt) - Date.now() < 8 * 3600000 + 1000, true);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal((await f.call('/engine/x.wasm', { token: app })).status, 200);
  assert.equal((await f.call('/_alpha/session', { token: app })).status, 200);
  assert.equal((await launch(app)).status, 401);
  assert.equal((await f.call('/_alpha/admin/invites', { token: app })).status, 401);
  const active = await connections(f, app);
  await invite(f, admin); // Durable tester writes must not terminate admin app resources.
  await active.alive();
  await f.call('/_alpha/admin/logout', { method: 'POST', body: {}, token: admin });
  await active.closed();
  assert.equal((await f.call('/_alpha/session', { token: app })).status, 401);
  assert.equal((await f.call('/engine/x.wasm', { token: tester })).status, 200);
});

for (const action of ['app logout', 'expiry', 'password rotation']) test(`admin app access ends on ${action}`, async t => {
  const f = await fixture(t), admin = await login(f);
  const app = (await f.call('/_alpha/admin/open-slicer', { method: 'POST', body: {}, token: admin })).json().token;
  if (action === 'expiry') f.advance(8 * 3600000 - 150);
  const active = await connections(f, app);
  if (action === 'app logout') await f.call('/_alpha/logout', { method: 'POST', body: {}, token: app });
  else if (action === 'expiry') f.advance(151);
  else f.restart({ ...f.env, ORCA_ALPHA_ADMIN_PASSWORD: 'rotated-synthetic-password' });
  await active.closed();
  assert.equal((await f.call('/_alpha/session', { token: app })).status, 401);
  assert.equal((await f.call('/engine/x.wasm', { token: app })).status, 401);
  if (action === 'app logout') assert.equal((await f.call('/_alpha/admin/invites', { token: admin })).status, 200);
});

for (const action of ['logout', 'revoke', 'expiry']) test(`existing sockets and streams terminate on ${action} without closing another tester`, async t => {
  const f = await fixture(t), admin = await login(f);
  const first = await invite(f, admin), second = await invite(f, admin);
  const token = (await validate(f, first.code)).json().token;
  f.advance(1000);
  const otherToken = (await validate(f, second.code)).json().token;
  const siblingToken = (await validate(f, first.code)).json().token;
  if (action === 'expiry') f.advance(30 * 86400000 - 1200);
  const current = await connections(f, token), other = await connections(f, otherToken);
  const sibling = await connections(f, siblingToken);
  await current.alive(); await other.alive();
  if (action === 'logout') {
    assert.equal((await f.call('/_alpha/logout', { method: 'POST', body: {}, token })).status, 200);
  } else if (action === 'revoke') {
    assert.equal((await f.call(`/_alpha/admin/invites/${first.invite.id}`, {
      method: 'PATCH', token: admin, body: { revoked: true }
    })).status, 200);
  } else f.advance(201);
  await current.closed();
  await other.alive();
  if (action === 'revoke') await sibling.closed();
  else await sibling.alive();
  assert.equal((await f.call('/engine/x.wasm', { token })).status, 401);
});

test('disabled gate leaves connections alone; explicit gated shutdown closes owned lifetimes', async t => {
  const disabled = await fixture(t, false), open = await connections(disabled);
  disabled.gate().close();
  disabled.advance(31 * 86400000);
  await open.alive();
  const f = await fixture(t), admin = await login(f), created = await invite(f, admin);
  const token = (await validate(f, created.code)).json().token;
  const active = await connections(f, token);
  f.gate().close(); f.gate().close();
  await active.closed();
  assert.equal((await f.call('/engine/x.wasm', { token })).status, 503);
});

test('session deadline timers are unrefed, bounded, and cleared on resource finish/close and shutdown', async t => {
  const f = await fixture(t), admin = await login(f), created = await invite(f, admin);
  const token = (await validate(f, created.code)).json().token;
  const schedule = t.mock.method(globalThis, 'setTimeout');
  const clear = t.mock.method(globalThis, 'clearTimeout');
  const req = { headers: { host: 'alpha.example', origin: ORIGIN, cookie: `orca_alpha=${token}` } };
  const socket = new PassThrough();
  assert.equal(f.gate().authorizeUpgrade(req, socket), true);
  const timer = schedule.mock.calls.at(-1);
  assert.equal(timer.arguments[1], 2147483647);
  assert.equal(timer.result.hasRef(), false);
  socket.destroy(); await once(socket, 'close');
  assert.ok(clear.mock.calls.some(call => call.arguments[0] === timer.result));
  const resource = Object.assign(new PassThrough(), { writeHead() {}, setHeader() {} });
  assert.equal(f.gate().authorize(req, resource), true);
  const responseTimer = schedule.mock.calls.at(-1).result;
  resource.end(); await once(resource, 'finish');
  assert.ok(clear.mock.calls.some(call => call.arguments[0] === responseTimer));
  const active = new PassThrough();
  assert.equal(f.gate().authorizeUpgrade(req, active), true);
  const shutdownTimer = schedule.mock.calls.at(-1).result;
  f.gate().close();
  assert.equal(active.destroyed, true);
  assert.ok(clear.mock.calls.some(call => call.arguments[0] === shutdownTimer));
});

test('provider authorization is independent of the alpha cookie', async t => {
  const f = await fixture(t), admin = await login(f), created = await invite(f, admin);
  const token = (await validate(f, created.code)).json().token;
  const headers = { cookie: `orca_alpha=${token}`, authorization: 'Bearer synthetic-provider-token' };
  for (const route of ['/_printer/prusa-connect/app/login', '/_printer/bambu-cloud/devices', '/_printer/snapmaker-cloud/account']) {
    assert.equal((await f.call(route, { headers })).text, 'DOWNSTREAM');
    assert.equal((await f.call(route, { headers: { authorization: headers.authorization } })).status, 401);
  }
  for (const boundary of [{ origin: 'https://evil.example' }, { host: 'evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await f.call('/_printer/snapmaker-cloud/account', { headers: { ...headers, ...boundary } })).status, 403);
  }
  for (const boundary of [{ origin: 'https://evil.example' }, { origin: '' }, { host: 'evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const ws = new WebSocket(`ws://127.0.0.1:${f.port}/_printer/snapmaker-cloud/monitor`, {
      headers: { host: 'alpha.example', origin: ORIGIN, ...headers, ...boundary }
    });
    await assert.rejects(bounded(once(ws, 'open'), 'Cross-origin upgrade was not rejected'), /socket hang up/);
  }
  assert.equal((await f.call('/_alpha/session', { headers })).status, 401, 'alpha API must reject explicit invalid alpha bearer');
  await f.call(`/_alpha/admin/invites/${created.invite.id}`, { method: 'PATCH', token: admin, body: { revoked: true } });
  assert.equal((await f.call('/_printer/snapmaker-cloud/account', { headers })).status, 401);
});

test('invites track only successful validation, keep raw secrets out of state, and revoke sessions', async t => {
  const f = await fixture(t); const admin = await login(f);
  const created = await invite(f, admin, { email: 'tester@example.test', username: 'tester', note: 'internal' });
  assert.equal(created.code.length, 43);
  assert.equal(created.invite.useCount, 0); assert.equal(created.invite.usedAt, null);
  assert.equal((await validate(f, 'invalid')).status, 401);
  let list = (await f.call('/_alpha/admin/invites', { token: admin })).json().invites;
  assert.equal(list[0].usedAt, null); assert.equal(list[0].useCount, 0);
  const valid = await validate(f, created.code); assert.equal(valid.status, 200);
  const token = valid.json().token;
  assert.match(valid.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\//);
  assert.match(valid.headers['set-cookie'][0], /; Secure$/);
  assert.equal((await f.call('/engine/orca_engine.wasm', { token })).text, 'DOWNSTREAM');
  const restored = await f.call('/_alpha/session', { token });
  assert.equal(restored.json().valid, true);
  assert.ok(restored.headers['set-cookie'][0].startsWith(`orca_alpha=${token};`));
  assert.equal((await f.call('/web/engine-worker.js', { headers: { cookie: `orca_alpha=${token}` } })).status, 200);
  for (const route of ['/orca-cloud/callback?code=synthetic', '/octoeverywhere/callback/flow-1?success=true']) {
    assert.equal((await f.call(route, { headers: { cookie: restored.headers['set-cookie'][0].split(';')[0], accept: 'text/html' } })).text, 'DOWNSTREAM');
  }
  assert.equal((await f.call('/_alpha/admin/invites', { token })).status, 401);
  assert.equal((await f.call('/engine/x.wasm', { token: admin })).status, 401);
  f.advance(1000); await validate(f, created.code);
  list = (await f.call('/_alpha/admin/invites', { token: admin })).json().invites;
  assert.equal(list[0].useCount, 2); assert.notEqual(list[0].usedAt, list[0].lastUsedAt);
  assert.equal(Object.hasOwn(list[0], 'codeHash'), false);
  const persisted = fs.readFileSync(f.file, 'utf8');
  for (const secret of [created.code, token, admin, PASSWORD]) assert.equal(persisted.includes(secret), false);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  const updated = await f.call(`/_alpha/admin/invites/${created.invite.id}`, { method: 'PATCH', token: admin,
    body: { email: '', username: 'renamed', note: '', revoked: true } });
  assert.equal(updated.status, 200); assert.equal(updated.json().invite.username, 'renamed');
  assert.equal(updated.json().invite.email, '');
  assert.equal((await validate(f, created.code)).status, 401);
  assert.equal((await f.call('/_alpha/session', { token })).status, 401);
  await f.call(`/_alpha/admin/invites/${created.invite.id}`, { method: 'PATCH', token: admin, body: { revoked: false } });
  assert.equal((await f.call('/_alpha/session', { token })).status, 401);
  const fresh = (await validate(f, created.code)).json().token;
  assert.equal((await f.call('/_alpha/logout', { method: 'POST', body: {}, token: fresh })).status, 200);
  assert.equal((await f.call('/_alpha/session', { token: fresh })).status, 401);
  assert.equal((await f.call('/_alpha/admin/invites/missing', { method: 'PATCH', token: admin, body: {} })).status, 404);
});

test('spoofed local state/tokens never unlock protected assets, APIs or callbacks; bootstrap is isolated', async t => {
  const f = await fixture(t);
  for (const route of ['/assets/app.js', '/engine/x.wasm', '/engine-worker.js', '/orca_preview.wasm',
    '/_printer/status', '/_orca-cloud/config', '/_octoeverywhere/config', '/orca-cloud/callback?code=synthetic', '/app-config.json']) {
    assert.equal((await f.call(route, { token: 'A'.repeat(43), headers: { 'x-localstorage': 'authenticated' } })).status, 401, route);
  }
  const doc = await f.call('/orca-cloud/callback?code=synthetic', { headers: { accept: 'text/html' } });
  assert.equal(doc.status, 200); assert.match(doc.text, /PUBLIC_LOGIN/); assert.doesNotMatch(doc.text, /PROTECTED_APP/);
  assert.equal(doc.headers['cache-control'], 'no-store');
  assert.equal(doc.headers['cross-origin-embedder-policy'], 'require-corp');
  assert.equal((await f.call('/_alpha/admin')).text, '<title>PUBLIC_LOGIN</title>');
  assert.equal((await f.call('/alpha-public/bootstrap.js')).status, 200);
  assert.equal((await f.call('/alpha-public/%2e%2e%2fassets/app.js')).status, 401);
  assert.equal((await f.call('/_alpha/config')).json().enabled, true);
  assert.equal((await f.call('/healthz', { headers: { host: 'localhost' } })).status, 200);
  const octoDoc = await f.call('/octoeverywhere/callback/flow_1?success=true', { headers: { origin: 'https://octoeverywhere.com', 'sec-fetch-site': 'cross-site', accept: 'text/html' } });
  assert.equal(octoDoc.status, 200); assert.match(octoDoc.text, /PUBLIC_LOGIN/); assert.doesNotMatch(octoDoc.text, /PROTECTED_APP/);
  assert.equal((await f.call('/_octoeverywhere/config')).status, 401);
  assert.equal((await f.call('/_octoeverywhere/plugin/status')).status, 401);
  assert.equal((await f.call('/_alpha/admin/invites')).status, 401);
  const admin = await login(f); const created = await invite(f, admin);
  const token = (await validate(f, created.code)).json().token;
  assert.equal((await f.call('/_alpha/session', { token: 'B'.repeat(43), headers: { cookie: `orca_alpha=${token}` } })).status, 401);
  for (const route of ['/@fs/etc/passwd', '/gateway/alphaAccess.ts', '/.env.local']) {
    assert.equal((await f.call(route, { token })).status, 404);
  }
  fs.unlinkSync(path.join(f.root, 'alpha-bootstrap.html'));
  assert.equal((await f.call('/', { headers: { accept: 'text/html' } })).status, 503);
});

test('admin expiry, logout and restart/password rotation invalidate privilege; tester expiry persists', async t => {
  const f = await fixture(t); const admin = await login(f); const created = await invite(f, admin);
  const token = (await validate(f, created.code)).json().token;
  assert.equal((await f.call('/_alpha/admin/logout', { method: 'POST', body: {}, token: admin })).status, 200);
  assert.equal((await f.call('/_alpha/admin/invites', { token: admin })).status, 401);
  const second = await login(f); f.advance(8 * 3600000);
  assert.equal((await f.call('/_alpha/admin/invites', { token: second })).status, 401);
  const third = await login(f);
  f.restart({ ...f.env, ORCA_ALPHA_ADMIN_PASSWORD: 'different-synthetic-password' });
  assert.equal((await f.call('/_alpha/admin/invites', { token: third })).status, 401);
  assert.equal((await f.call('/_alpha/admin/login', { method: 'POST', body: { password: PASSWORD } })).status, 401);
  assert.equal((await f.call('/_alpha/session', { token })).status, 200);
  f.advance(30 * 86400000);
  assert.equal((await f.call('/_alpha/session', { token })).status, 401);
});

test('same origin, request bounds, strict labels and guess rate limits', async t => {
  const f = await fixture(t);
  for (const headers of [{ origin: 'https://evil.example' }, { host: 'evil.example' },
    { 'sec-fetch-site': 'cross-site' }, { origin: '' }]) {
    assert.equal((await f.call('/_alpha/admin/login', { method: 'POST', body: { password: PASSWORD }, headers })).status, 403);
  }
  assert.equal((await f.call('/_alpha/admin/login', { method: 'POST', raw: '[]' })).status, 400);
  assert.equal((await f.call('/_alpha/admin/login', { method: 'POST', raw: 'x'.repeat(5000) })).status, 413);
  assert.equal((await f.call('/_alpha/admin/login', { method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } })).status, 400);
  const admin = await login(f);
  for (const body of [{ email: 1 }, { note: 'a'.repeat(1001) }, { code: 'injected' }]) {
    assert.equal((await f.call('/_alpha/admin/invites', { method: 'POST', token: admin, body })).status, 400);
  }
  const good = await invite(f, admin);
  assert.equal((await f.call(`/_alpha/admin/invites/${good.invite.id}`, { method: 'PATCH', token: admin, body: { revoked: 'yes' } })).status, 400);
  for (let i = 0; i < 6; i++) assert.equal((await f.call('/_alpha/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  const limited = await f.call('/_alpha/admin/login', { method: 'POST', body: { password: PASSWORD }, headers: { 'x-forwarded-for': 'new-ip' } });
  assert.equal(limited.status, 429); assert.equal(limited.headers['retry-after'], '900');
  f.advance(900001); assert.equal((await f.call('/_alpha/admin/login', { method: 'POST', body: { password: PASSWORD } })).status, 200);
});

test('concurrent invite/validation commits survive restart without losing metadata or tokens', async t => {
  const f = await fixture(t); const admin = await login(f);
  const created = await Promise.all(Array.from({ length: 8 }, (_, i) => invite(f, admin, { username: `tester-${i}` })));
  const validated = await Promise.all(created.map(i => validate(f, i.code)));
  assert.ok(validated.every(res => res.status === 200));
  const before = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  assert.equal(before.invites.length, 8); assert.equal(before.sessions.length, 8);
  assert.ok(before.invites.every(i => i.useCount === 1 && i.usedAt && i.lastUsedAt));
  assert.deepEqual(fs.readdirSync(f.tmp).sort(), ['state.json', 'web']);
  f.restart();
  for (const res of validated) assert.equal((await f.call('/_alpha/session', { token: res.json().token })).status, 200);
  const newAdmin = await login(f);
  assert.equal((await f.call('/_alpha/admin/invites', { token: newAdmin })).json().invites.length, 8);
});

test('missing/invalid settings and corrupt state fail closed, including uncertain persistence', async t => {
  const f = files(); t.after(f.clean);
  for (const patch of [{ ORCA_ALPHA_ADMIN_PASSWORD: '' }, { ORCA_ALPHA_DATA_FILE: 'relative.json' },
    { ORCA_ALPHA_DATA_FILE: path.join(f.root, 'state.json') }, { ORCA_PUBLIC_ORIGIN: 'https://alpha.example/path' },
    { ORCA_PUBLIC_ORIGIN: 'http://example.test' }, { ORCA_ALPHA_GATE_ENABLED: 'true' }]) {
    assert.throws(() => createAlphaAccess({ webRoot: f.root, env: { ...f.env, ...patch } }));
  }
  assert.throws(() => createAlphaAccess({ webRoot: f.root, env: f.env, forbiddenDataRoots: [f.tmp] }), /outside web root/);
  fs.writeFileSync(f.file, '{corrupt');
  assert.throws(() => createAlphaAccess({ webRoot: f.root, env: f.env }), /corrupt/);
  fs.writeFileSync(f.file, JSON.stringify({ version: 1, invites: [{}], sessions: [] }));
  assert.throws(() => createAlphaAccess({ webRoot: f.root, env: f.env }), /corrupt/);
  fs.unlinkSync(f.file); fs.symlinkSync(path.join(f.root, 'index.html'), f.file);
  assert.throws(() => createAlphaAccess({ webRoot: f.root, env: f.env }), /symlink/);
  const live = await fixture(t); const admin = await login(live); const created = await invite(live, admin);
  const token = (await validate(live, created.code)).json().token;
  const active = await connections(live, token);
  fs.unlinkSync(live.file); fs.mkdirSync(live.file);
  assert.equal((await validate(live, created.code)).status, 503);
  await active.closed();
  assert.equal((await live.call('/_alpha/admin/invites', { token: admin })).status, 503);
  assert.equal((await live.call('/engine/x.wasm', { token: 'A'.repeat(43) })).status, 503);
});

async function production(t, enabled = true, syntheticProvider = false, guestSlicer = false) {
  const f = files();
  if (guestSlicer) f.env.ORCA_ALPHA_GUEST_SLICER_ENABLED = '1';
  if (syntheticProvider) {
    await build({ stdin: { contents: `
      import { WebSocketServer } from 'ws';
      export function createHostedPrinterCloudBridge() {
        const wss = new WebSocketServer({ noServer: true });
        return {
          handle(req, res) {
            if (req.url.endsWith('/synthetic-stream')) {
              res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: ready\\n\\n');
            } else res.end(req.headers.authorization || 'missing-provider-authorization');
            return true;
          },
          handleUpgrade(req, socket, head) {
            wss.handleUpgrade(req, socket, head, ws => ws.on('message', data => ws.send(data)));
            return true;
          }
        };
      }`, resolveDir: new URL('../../app/', import.meta.url).pathname },
      outfile: path.join(f.root, 'printer-cloud-bridge.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20',
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  }
  if (enabled) await build({ entryPoints: [new URL('../../app/gateway/alphaAccess.ts', import.meta.url).pathname],
    outfile: path.join(f.root, 'alpha-access.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20' });
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [new URL('../../deploy/server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, ...(enabled ? f.env : {}), PORT: String(port), ORCA_BIND: '127.0.0.1', ORCA_ROOT: f.root,
      ORCA_EXTRA_HOSTS: 'alpha.example', ...(syntheticProvider ? { ORCA_PRINTER_CLOUD: 'snapmaker-cloud', ORCA_PUBLIC_ORIGIN: ORIGIN } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const exited = once(child, 'exit');
  t.after(async () => { child.kill('SIGTERM'); await exited; f.clean(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server readiness timeout')), 10000);
    child.stdout.on('data', () => { if (output.includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', () => { clearTimeout(timer); reject(new Error(`Server failed: ${output}`)); });
  });
  return { ...f, port, call: (route, options) => request(port, route, options), output: () => output,
    shutdown: async () => { child.kill('SIGTERM'); await bounded(exited, 'Server shutdown waited on authenticated sockets'); } };
}

test('guest slicer is opt-in, exposes static runtime only and preserves the ordinary gate', async t => {
  const closed = await production(t);
  assert.match((await closed.call('/slicer', { headers: { accept: 'text/html' } })).text, /PUBLIC_LOGIN/);
  assert.equal((await closed.call('/engine-worker.js')).status, 401);
  const f = await production(t, true, false, true);
  const before = fs.readFileSync(f.file, 'utf8');
  assert.equal((await f.call('/_alpha/config')).json().guestSlicer, true);
  for (const route of ['/slicer', '/slicer/', '/slicer/preview', '/slicer/prepare']) {
    const response = await f.call(route, { headers: { accept: 'text/html' } });
    assert.match(response.text, /PROTECTED_APP/);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  for (const route of ['/assets/app.js', '/engine-worker.js', '/resources/handy_models/OrcaBadge.3mf']) {
    assert.equal((await f.call(route)).status, 200);
  }
  for (const route of ['/', '/prepare', '/preview', '/slicer/unknown']) {
    assert.match((await f.call(route, { headers: { accept: 'text/html' } })).text, /PUBLIC_LOGIN/);
  }
  for (const route of ['/_alpha/session', '/_alpha/admin/invites', '/_printer/status', '/_octoeverywhere/config', '/_orca-cloud/status', '/_gw/status', '/index.html', '/alpha-access.mjs']) {
    assert.equal((await f.call(route)).status, 401, route);
  }
  assert.equal((await f.call('/assets/app.js', { method: 'POST' })).status, 401);
  assert.equal((await f.call('/_printer/snapmaker-cloud/monitor', { headers: { connection: 'Upgrade', upgrade: 'websocket' } })).status, 401);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  const admin = await login(f);
  assert.equal((await f.call('/_alpha/admin/invites', { token: admin })).status, 200);
  const open = await production(t, false);
  assert.match((await open.call('/slicer')).text, /PROTECTED_APP/);
});

test('packaged server terminates existing synthetic provider traffic on logout/revocation and shutdown', async t => {
  const f = await production(t, true, true), admin = await login(f);
  const first = await invite(f, admin), second = await invite(f, admin);
  const token = (await validate(f, first.code)).json().token;
  const otherToken = (await validate(f, second.code)).json().token;
  const active = await connections(f, token), other = await connections(f, otherToken);
  assert.equal((await f.call('/_printer/snapmaker-cloud/account', { headers: {
    cookie: `orca_alpha=${token}`, authorization: 'Bearer synthetic-provider-token'
  } })).text, 'Bearer synthetic-provider-token');
  await f.call('/_alpha/logout', { method: 'POST', token, body: {} });
  await active.closed(); await other.alive();
  const freshToken = (await validate(f, first.code)).json().token;
  const fresh = await connections(f, freshToken);
  await f.call(`/_alpha/admin/invites/${first.invite.id}`, { method: 'PATCH', token: admin, body: { revoked: true } });
  await fresh.closed(); await other.alive();
  await f.shutdown(); await other.closed();
});

test('packaged server protects actual files, API/upgrade dispatch, callbacks and bridge modules', async t => {
  const f = await production(t); const admin = await login(f); const created = await invite(f, admin);
  const token = (await validate(f, created.code)).json().token;
  for (const route of ['/assets/app.js', '/engine-worker.js', '/_printer/status', '/_octoeverywhere/config']) {
    assert.equal((await f.call(route)).status, 401, route);
  }
  const asset = await f.call('/assets/app.js', { token });
  assert.equal(asset.status, 200); assert.equal(asset.text, 'PROTECTED_JS');
  assert.equal(asset.headers['cache-control'], 'no-store');
  assert.equal((await f.call('/alpha-access.mjs', { token })).status, 404);
  assert.equal((await f.call('/alpha-access.mjs.gz', { token })).status, 404);
  assert.equal((await f.call('/', { headers: { accept: 'text/html' } })).text, '<title>PUBLIC_LOGIN</title>');
  assert.match((await f.call('/orca-cloud/callback?code=synthetic', { headers: { accept: 'text/html' } })).text, /PUBLIC_LOGIN/);
  const restored = await f.call('/_alpha/session', { token });
  assert.match((await f.call('/orca-cloud/callback?code=synthetic', { headers: {
    accept: 'text/html', cookie: restored.headers['set-cookie'][0].split(';')[0]
  } })).text, /PROTECTED_APP/);
  for (const route of ['/_printer/snapmaker-cloud/monitor', '/_octoeverywhere/ws']) {
    const response = await f.call(route, { headers: { connection: 'Upgrade', upgrade: 'websocket' } });
    assert.equal(response.status, 401);
  }
  assert.equal((await f.call('/_printer/status', { token })).status, 403); // Existing disabled-provider behavior after gate.
  assert.equal(f.output().includes(PASSWORD), false); assert.equal(f.output().includes(created.code), false);
});

test('disabled server needs no alpha bundle/configuration and preserves static/off behavior', async t => {
  const f = await production(t, false);
  assert.equal((await f.call('/')).text, '<title>PROTECTED_APP</title>');
  assert.equal((await f.call('/assets/app.js')).text, 'PROTECTED_JS');
  assert.match((await f.call('/assets/app.js')).headers['cache-control'], /immutable/);
  assert.deepEqual((await f.call('/_alpha/config')).json(), { enabled: false });
  assert.equal((await f.call('/_alpha/admin/login', { method: 'POST', body: { password: PASSWORD } })).status, 403);
  assert.equal((await f.call('/_printer/status')).status, 403);
  assert.equal((await f.call('/healthz')).status, 200);
  assert.equal((await f.call('/')).headers['cross-origin-embedder-policy'], 'require-corp');
});

test('engine pair is version bound and revalidates only after alpha authorization', async t => {
  const f = await production(t), admin = await login(f);
  const token = (await f.call('/_alpha/admin/open-slicer', { method: 'POST', body: {}, token: admin })).json().token;
  fs.mkdirSync(path.join(f.root, 'engine'));
  fs.writeFileSync(path.join(f.root, 'engine/orca_engine.mjs'), 'export default 1');
  fs.writeFileSync(path.join(f.root, 'engine/orca_engine.wasm'), 'synthetic-engine');
  const module = await f.call('/engine/orca_engine.mjs', { token, method: 'HEAD' });
  const version = module.headers['x-orca-engine-version'];
  assert.match(version || '', /^[a-f0-9]{64}$/);
  const route = `/engine/orca_engine.wasm?v=${version}`;
  const cold = await f.call(route, { token });
  assert.equal(cold.headers['cache-control'], 'private, no-cache');
  assert.equal(cold.headers['x-orca-decoded-length'], '16');
  const headers = { 'if-none-match': cold.headers.etag };
  assert.equal((await f.call(route, { token, headers })).status, 304);
  assert.equal((await f.call(route, { headers })).status, 401);
  assert.equal((await f.call('/index.html', { token })).headers['cache-control'], 'no-store');
  assert.equal((await f.call('/_alpha/session', { token })).headers['cache-control'], 'no-store');
  // A loader-only release also invalidates the WASM cache key.
  fs.writeFileSync(path.join(f.root, 'engine/orca_engine.mjs'), 'export default 222');
  const next = await f.call('/engine/orca_engine.mjs', { token, method: 'HEAD' });
  assert.notEqual(next.headers['x-orca-engine-version'], version);
  assert.equal((await f.call(route, { token })).status, 409);
  await f.call('/_alpha/logout', { method: 'POST', body: {}, token });
  assert.equal((await f.call('/engine/orca_engine.mjs', { token, method: 'HEAD' })).status, 401);
});

test('Vite middleware runs before app/assets/providers and blocks upgrade dispatch before later listeners', async t => {
  const f = files(); t.after(f.clean);
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' },
    new URL('../../app/vite.config.ts', import.meta.url).pathname);
  const plugins = loaded.config.plugins.flat();
  const [coep, alpha] = plugins;
  assert.equal(coep.name, 'compatible-coep'); assert.equal(coep.enforce, 'pre');
  assert.equal(alpha.name, 'alpha-access'); assert.equal(alpha.enforce, 'pre');
  const stack = [];
  const upgrades = http.createServer((req, res) => stack[0](req, res, () => {
    if (req.url.endsWith('/synthetic-stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: ready\n\n');
    } else res.end('DEV_DOWNSTREAM');
  }));
  let providerCalls = 0;
  upgrades.on('upgrade', () => providerCalls++);
  const prior = Object.fromEntries(Object.keys(f.env).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, f.env);
    alpha.configureServer({ config: { root: f.root, build: { outDir: 'dist' } },
      middlewares: { use: fn => stack.push(fn) }, httpServer: upgrades });
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  upgrades.prependListener('upgrade', () => providerCalls++);
  let destroyed = false;
  upgrades.emit('upgrade', { headers: { host: 'alpha.example', origin: ORIGIN }, url: '/_octoeverywhere/ws' },
    { destroy: () => { destroyed = true; } });
  assert.equal(destroyed, true); assert.equal(providerCalls, 0);
  const server = upgrades;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  f.call = (route, options) => request(server.address().port, route, options);
  f.port = server.address().port;
  assert.equal((await f.call('/src/main.tsx')).status, 401);
  const admin = await login(f); const created = await invite(f, admin);
  const token = (await validate(f, created.code)).json().token;
  assert.equal((await f.call('/src/main.tsx', { token })).text, 'DEV_DOWNSTREAM');
  upgrades.emit('upgrade', { headers: { host: 'alpha.example', origin: ORIGIN, cookie: `orca_alpha=${token}` } },
    Object.assign(new EventEmitter(), { destroy() { this.emit('close'); } }));
  assert.equal(providerCalls, 2);
  const sockets = new WebSocketServer({ noServer: true });
  upgrades.on('upgrade', (req, socket, head) => {
    sockets.handleUpgrade(req, socket, head, ws => ws.on('message', data => ws.send(data)));
  });
  t.after(() => sockets.close());
  const active = await connections(f, token);
  const second = await invite(f, admin), otherToken = (await validate(f, second.code)).json().token;
  const other = await connections(f, otherToken);
  await f.call(`/_alpha/admin/invites/${created.invite.id}`, { method: 'PATCH', token: admin, body: { revoked: true } });
  await active.closed(); await other.alive();
  await bounded(new Promise(resolve => server.close(resolve)), 'Vite shutdown waited on authenticated sockets');
  await other.closed();
});

test('alpha.guard and alpha.handle preserve pre-set credentialless COEP and default to require-corp', async t => {
  const f = files();
  const gate = createAlphaAccess({ env: f.env, webRoot: f.root });
  const server = http.createServer(async (req, res) => {
    if (req.headers['x-preset-coep']) res.setHeader('Cross-Origin-Embedder-Policy', String(req.headers['x-preset-coep']));
    if (req.headers['x-handle-only'] === '1') {
      if (await gate.handle(req, res)) return;
      res.end('NOT_HANDLED');
      return;
    }
    if (await gate.guard(req, res)) return;
    res.end('DOWNSTREAM');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    gate.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); f.clean();
  });
  const call = (route, options) => request(server.address().port, route, options);
  const preset = { 'x-preset-coep': 'credentialless' };

  const cfgPreset = await call('/_alpha/config', { headers: { ...preset, 'x-handle-only': '1' } });
  assert.equal(cfgPreset.status, 200);
  assert.equal(cfgPreset.headers['cross-origin-embedder-policy'], 'credentialless');
  const cfgDefault = await call('/_alpha/config', { headers: { 'x-handle-only': '1' } });
  assert.equal(cfgDefault.status, 200);
  assert.equal(cfgDefault.headers['cross-origin-embedder-policy'], 'require-corp');

  const docPreset = await call('/', { headers: { ...preset, accept: 'text/html' } });
  assert.equal(docPreset.status, 200);
  assert.equal(docPreset.headers['cross-origin-embedder-policy'], 'credentialless');
  const docDefault = await call('/', { headers: { accept: 'text/html' } });
  assert.equal(docDefault.status, 200);
  assert.equal(docDefault.headers['cross-origin-embedder-policy'], 'require-corp');

  const errPreset = await call('/_octoeverywhere/config', { headers: preset });
  assert.equal(errPreset.status, 401);
  assert.equal(errPreset.headers['cross-origin-embedder-policy'], 'credentialless');
  const errDefault = await call('/_octoeverywhere/config');
  assert.equal(errDefault.status, 401);
  assert.equal(errDefault.headers['cross-origin-embedder-policy'], 'require-corp');

  const admin = (await call('/_alpha/admin/login', { method: 'POST', body: { password: PASSWORD }, headers: preset })).json().token;
  const app = (await call('/_alpha/admin/open-slicer', { method: 'POST', body: {}, token: admin, headers: preset })).json().token;
  const authedPreset = await call('/assets/app.js', { token: app, headers: preset });
  assert.equal(authedPreset.status, 200);
  assert.equal(authedPreset.headers['cross-origin-embedder-policy'], 'credentialless');
  const authedDefault = await call('/assets/app.js', { token: app });
  assert.equal(authedDefault.status, 200);
  assert.equal(authedDefault.headers['cross-origin-embedder-policy'], 'require-corp');
});
