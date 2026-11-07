import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import { EventEmitter, once } from 'node:events';
import { syncBuiltinESMExports, createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { X509Certificate, generateKeyPairSync } from 'node:crypto';
import { WebSocket } from 'ws';
import { Aedes } from 'aedes';
import { parseSnapmakerBootstrap, snapmakerPublicAddress, SNAPMAKER_ROOT_CA } from '../../app/gateway/snapmakerMonitor.ts';
import { createHostedPrinterCloudBridge } from '../../app/gateway/hostedPrinterCloud.ts';
import { startGateway, listen, close } from './lib/gatewayHarness.mjs';

const route = '/_printer/snapmaker-cloud/monitor';
const serial = 'SYNTHETIC_U1';
const endpoint = 'synthetic123-ats.iot.us-east-1.amazonaws.com';
// Generate a disposable fixture identity entirely through stdout; no credential files.
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const cert = execFileSync('sh', ['-c', 'cat | openssl req -x509 -key /dev/stdin -days 1 -subj /CN=synthetic.invalid'],
  { input: key, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
const bootstrap = () => ({ endpoint, port: 8883, clientId: 'synthetic-issued-client', cert, key,
  ca: 'untrusted CA ignored', topics: { publish: ['/request', '/config'], subscribe: ['/status', '/response', '/notification', '/config'] } });
const devices = [{ deviceId: 'device-1', sn: serial }, { deviceId: 'device-2', sn: 'OTHER_U1' }];
const checkAuthPath = clientId => '/api/user/device/checkAuth?' + new URLSearchParams({ deviceId: 'device-1', certId: clientId, sn: serial });

function bounded(promise, message = 'Fixture deadline exceeded') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), 2500); })]).finally(() => clearTimeout(timer));
}
function inbox(ws) {
  const frames = [];
  const waiters = [];
  ws.on('message', data => {
    frames.push(JSON.parse(data.toString()));
    for (const wake of waiters.splice(0)) wake();
  });
  return { frames, async wait(predicate) {
    while (!frames.some(predicate)) await bounded(new Promise(resolve => waiters.push(resolve)), `Waiting for ${predicate}; received ${JSON.stringify(frames)}`);
    return frames.find(predicate);
  } };
}
class Broker extends EventEmitter {
  constructor(options, fixture) {
    super();
    this.options = options;
    this.fixture = fixture;
    this.subscriptions = [];
    this.calls = [];
    this.ended = false;
    this.stream = { destroy: () => { this.destroyed = true; } };
    queueMicrotask(() => this.fixture.brokerError ? this.emit('error', this.fixture.brokerError) : this.emit('connect'));
  }
  subscribe(topic, options, callback) {
    this.subscriptions.push([topic, options.qos]);
    queueMicrotask(() => callback(null, [{ topic, qos: this.fixture.denied ? 128 : 1 }]));
  }
  publish(topic, payload, options, callback) {
    const rpc = JSON.parse(payload);
    this.calls.push({ topic, ...rpc, options });
    if (!this.fixture.holdAck) callback(null);
    if (this.fixture.holdRpc === rpc.method) return;
    if (this.fixture.rpcError?.method === rpc.method) {
      queueMicrotask(() => this.message(serial + '/response', { jsonrpc: '2.0', id: rpc.id, error: this.fixture.rpcError }));
      return;
    }
    const result = Object.hasOwn(this.fixture.rpcResults ?? {}, rpc.method) ? this.fixture.rpcResults[rpc.method]
      : rpc.method === 'printer.objects.list' ? { objects: ['print_stats', 'display_status', 'virtual_sdcard', 'heater_bed', 'extruder', 'extruder1', 'print_task_config', 'dangerous'] }
      : rpc.method === 'printer.objects.query' ? { status: { heater_bed: { temperature: 45, target: 60, forbidden: 'hidden' }, extruder1: { temperature: 200 }, print_task_config: { private: true } } } : {};
    queueMicrotask(() => this.message(serial + '/response', this.fixture.unavailable && [2, 3].includes(rpc.id)
      ? { jsonrpc: '2.0', id: rpc.id, error: { code: -32601 } } : { jsonrpc: '2.0', id: rpc.id, result }));
  }
  message(topic, value, retain = false) { this.emit('message', topic, Buffer.from(JSON.stringify(value)), { retain }); }
  end() { this.ended = true; }
}
async function fixture(settings = {}) {
  const calls = [];
  const brokers = [];
  const sockets = [];
  const events = [];
  const f = { ...settings, calls, brokers, events };
  const api = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, path: req.url, headers: req.headers, body });
    events.push(new URL(req.url, 'http://fixture.invalid').pathname);
    if (req.url.startsWith('/api/user/device/checkAuth?')) {
      if (f.auth?.hold) { res.on('close', () => { f.authCancelled = true; }); return; }
      res.statusCode = f.auth?.status ?? 200;
      if (res.statusCode === 302) res.setHeader('location', 'https://evil.invalid');
      res.end(f.auth?.raw ?? JSON.stringify(f.auth?.envelope ?? { code: 200 }));
      return;
    }
    if (f.resetHttp) { req.socket.destroy(); return; }
    if (f.credentialRaw && req.url.endsWith('/getMqttCert')) { res.end(f.credentialRaw); return; }
    if (f.holdHttp) { res.on('close', () => { f.httpCancelled = true; }); return; }
    res.statusCode = f.status ?? 200;
    if (f.status === 302) res.setHeader('location', 'https://evil.invalid');
    res.end(f.raw ?? JSON.stringify({ code: f.code ?? 200, data: req.url.endsWith('/list') ? f.devices ?? devices : f.bootstrap ?? bootstrap() }));
  });
  const port = await listen(api);
  const original = https.request;
  https.request = (options, callback) => {
    assert.equal(options.hostname, 'id.snapmaker.com');
    assert.equal(options.port, 443);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.headers.authorization, 'Bearer fixture-access');
    assert.equal(options.headers.cookie, undefined);
    assert.ok(['/api/user/device/list', '/api/user/device/getMqttCert'].includes(options.path) ||
      options.path === checkAuthPath((f.bootstrap ?? bootstrap()).clientId));
    return http.request({ ...options, hostname: '127.0.0.1', port }, callback);
  };
  syncBuiltinESMExports();
  const testOptions = {
    lookup: async host => { events.push('dns'); assert.equal(host, endpoint); return f.addresses ?? ['8.8.8.8']; },
    connect: options => { events.push('broker'); const broker = new Broker(options, f); brokers.push(broker); return broker; },
    initialMs: 500, rpcMs: 200, queryMs: 60_000, ...settings.testOptions
  };
  const options = { cloud: settings.cloud ?? 'snapmaker-cloud', snapmakerMonitorTest: testOptions };
  let server;
  if (settings.hosted) {
    const bridge = createHostedPrinterCloudBridge(options.cloud, 'https://weborca.example');
    server = http.createServer();
    server.on('upgrade', (req, socket, head) => { if (!bridge.handleUpgrade(req, socket, head)) socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); });
    const gatewayPort = await listen(server);
    f.gateway = { port: gatewayPort, wsUrl: `ws://127.0.0.1:${gatewayPort}`, close: () => close(server) };
  } else f.gateway = await startGateway(options);
  f.open = async (connect = true, path = route, headers = {}) => {
    const ws = new WebSocket(f.gateway.wsUrl + path, { origin: `http://127.0.0.1:${f.gateway.port}`, ...headers });
    sockets.push(ws);
    const received = inbox(ws);
    await bounded(once(ws, 'open'));
    if (connect) ws.send(JSON.stringify({ type: 'connect', accessToken: 'fixture-access', deviceId: 'device-1' }));
    return { ws, ...received };
  };
  f.close = async () => {
    for (const ws of sockets) { ws.terminate(); }
    await new Promise(resolve => setImmediate(resolve));
    https.request = original;
    syncBuiltinESMExports();
    await f.gateway.close();
    api.closeAllConnections();
    await close(api);
  };
  return f;
}

test('bootstrap aliases and bQW suffix normalization preserve issued identity and reject unsafe targets/topics', () => {
  const normalized = parseSnapmakerBootstrap(bootstrap(), serial);
  assert.equal(normalized.config, serial + '/config/synthetic-issued-client');
  const flat = { ...bootstrap(), endpoint: '', ip: endpoint, clientId: '', clientid: 'unchanged', cert: '', secretId: cert, key: '', secretKey: key, topics: null,
    subscribeTopics: ['/response', '/status', '/notification', '/config', '/config'], publishTopics: ['/request'] };
  assert.equal(parseSnapmakerBootstrap(flat, serial).clientId, 'unchanged');
  for (const patch of [
    { endpoint: '127.0.0.1' }, { endpoint: 'evil.amazonaws.com' }, { endpoint: 'evil.iot.us-east-1.amazonaws.com' },
    { endpoint: endpoint + '.evil.invalid' }, { endpoint: 'mqtts://' + endpoint }, { endpoint: endpoint + ':8883' },
    { endpoint: endpoint + '/' }, { endpoint: endpoint.toUpperCase() }, { port: 443 }, { port: true }, { port: [] },
    { clientId: 'client/other' }, { cert: 'bad' }, { key: cert },
    ...['#', '/status/#', serial + '/status', 'OTHER_U1/response', '/config/other', 1].map(topic => ({ topics: { ...bootstrap().topics, subscribe: ['/response', '/status', '/notification', '/config', topic] } })),
    { topics: { subscribe: ['/response', '/status', '/notification'], publish: ['/request'] } },
    { topics: { ...bootstrap().topics, publish: [] } }
  ]) assert.throws(() => parseSnapmakerBootstrap({ ...bootstrap(), ...patch }, serial), /unsupported/);
  for (const address of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.169.254', '0.0.0.0', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:8.8.8.8', '2001:db8::1', '2002:808:808::1', 'fc00::1', 'fe80::1']) assert.equal(snapmakerPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '2606:4700:4700::1111']) assert.equal(snapmakerPublicAddress(address), true);
  assert.equal(new X509Certificate(SNAPMAKER_ROOT_CA).fingerprint256, '8E:CD:E6:88:4F:3D:87:B1:12:5B:A3:1A:C3:FC:B1:3D:70:16:DE:7F:57:CC:90:4F:E1:CB:97:C6:AE:98:19:6E');
});

test('provider-issued AWS IoT data endpoints accept the observed non-ATS hostname form', () => {
  // Redacted structural fixture: authenticated getMqttCert returned a bare non-ATS
  // AWS IoT data hostname on 8883; its public address passed strict Amazon Root CA 1 TLS.
  const legacyEndpoint = 'synthetic123.iot.us-east-1.amazonaws.com';
  assert.equal(parseSnapmakerBootstrap({ ...bootstrap(), endpoint: legacyEndpoint }, serial).endpoint, legacyEndpoint);
  for (const host of ['synthetic123.amazonaws.com', 'synthetic123.iot.us-east-1.amazonaws.com.evil.invalid',
    'mqtts://' + legacyEndpoint, legacyEndpoint + ':8883', legacyEndpoint + '/',
    'synthetic123.iot.us-east-1.amazonaws.com.cn', 'synthetic123.s3.us-east-1.amazonaws.com']) {
    assert.throws(() => parseSnapmakerBootstrap({ ...bootstrap(), endpoint: host }, serial), /unsupported/);
  }
});

test('issued directional config and data suffixes preserve bQW values and exact device binding', async () => {
  // Actual issued protocol shape, with synthetic account/device identities only.
  const issued = { ...bootstrap(), topics: {
    subscribe: ['/config/response', '/data/response', '/error', '/response', '/status', '/notification'],
    publish: ['/config/request', '/data/request', '/request']
  } };
  const parsed = parseSnapmakerBootstrap(issued, serial);
  assert.equal(parsed.config, serial + '/config/response/synthetic-issued-client');
  assert.equal(parsed.request, serial + '/request');
  const f = await fixture({ bootstrap: issued });
  try {
    const c = await f.open();
    assert.equal((await c.wait(v => v.type === 'snapshot' || v.type === 'error')).type, 'snapshot');
    assert.deepEqual(f.brokers[0].subscriptions, [
      [serial + '/status', 1], [serial + '/response', 1], [serial + '/notification', 1],
      [serial + '/config/response/synthetic-issued-client', 1]
    ]);
    assert.ok(f.brokers[0].calls.every(call => call.topic === serial + '/request'));
  } finally { await f.close(); }
  for (const name of ['response', 'status', 'notification', 'config']) {
    const topics = { ...issued.topics, subscribe: issued.topics.subscribe.filter(t => t.split('/')[1] !== name) };
    assert.throws(() => parseSnapmakerBootstrap({ ...issued, topics }, serial), /unsupported/);
  }
  for (const topic of ['/config/request', '/config/notification', '/config/response/other-client',
    'OTHER_U1/config/response', '/config/response/#', '/data/request', '/authResponse', '/unknown', 1, null,
    '/' + 'x'.repeat(1024)]) {
    assert.throws(() => parseSnapmakerBootstrap({ ...issued, topics: {
      ...issued.topics, subscribe: [...issued.topics.subscribe, topic]
    } }, serial), /unsupported/);
  }
  for (const topic of ['/config/response', '/data/response', '/request/#', 'OTHER_U1/request', '/authRequest']) {
    assert.throws(() => parseSnapmakerBootstrap({ ...issued, topics: {
      ...issued.topics, publish: [...issued.topics.publish, topic]
    } }, serial), /unsupported/);
  }
  for (const direction of ['subscribe', 'publish']) {
    assert.throws(() => parseSnapmakerBootstrap({ ...issued, topics: {
      ...issued.topics, [direction]: Array(17).fill(direction === 'subscribe' ? '/status' : '/request')
    } }, serial), /unsupported/);
    assert.throws(() => parseSnapmakerBootstrap({ ...issued, topics: { ...issued.topics, [direction]: {} } }, serial), /unsupported/);
  }
  assert.throws(() => parseSnapmakerBootstrap({ ...issued, topics: { ...issued.topics, publish: ['/config/request', '/data/request'] } }, serial), /unsupported/);
});

test('checkAuth GET binds the selected device and issued identity before DNS/broker, ignoring success data', async () => {
  const clientId = 'synthetic:issued-client';
  for (const envelope of [{ code: 0 }, { code: 200, data: false }, { code: '0', data: { endpoint: 'PRIVATE', clientId: 'replacement' } }, { code: '200', data: null }]) {
    const f = await fixture({ bootstrap: { ...bootstrap(), clientId }, auth: { envelope } });
    try {
      const c = await f.open();
      assert.equal((await c.wait(v => v.type === 'snapshot' || v.type === 'error')).type, 'snapshot');
      assert.deepEqual(f.events, ['/api/user/device/list', '/api/user/device/getMqttCert', '/api/user/device/checkAuth', 'dns', 'broker']);
      const call = f.calls[2];
      assert.equal(call.path, '/api/user/device/checkAuth?deviceId=device-1&certId=synthetic%3Aissued-client&sn=SYNTHETIC_U1');
      assert.equal(call.method, 'GET');
      assert.equal(call.body, '');
      assert.equal(call.headers.authorization, f.calls[0].headers.authorization);
      assert.equal(call.headers.authorization, f.calls[1].headers.authorization);
      assert.equal(f.brokers[0].options.clientId, clientId);
    } finally { await f.close(); }
  }
});

test('checkAuth rejects auth/business/HTTP/malformed/oversize responses before DNS or MQTT without leaking data', async () => {
  const cases = [
    [{ status: 401 }, 'auth', 'http', 401], [{ status: 403 }, 'auth', 'http', 403],
    [{ envelope: { code: 110003, message: 'PRIVATE' } }, 'auth', 'business', 110003],
    [{ envelope: { code: 12345, data: 'PRIVATE' } }, 'upstream', 'business', 12345],
    [{ status: 503 }, 'upstream', 'http', 503], [{ status: 302 }, 'upstream', 'http', 302],
    [{ raw: 'PRIVATE malformed' }, 'upstream', 'malformed-response'],
    [{ raw: 'null' }, 'upstream', 'malformed-response'],
    [{ raw: 'x'.repeat(256 * 1024 + 1) }, 'upstream', 'response-limit']
  ];
  for (const [auth, code, reason, numeric] of cases) {
    const f = await fixture({ auth });
    try {
      const c = await f.open();
      const error = await c.wait(v => v.type === 'snapshot' || v.type === 'error');
      assert.equal(error.code, code);
      assert.deepEqual(error.diagnostic, { phase: 'monitoring-credential', reason, ...(numeric === undefined ? {} : { code: numeric }) });
      assert.deepEqual(f.events, ['/api/user/device/list', '/api/user/device/getMqttCert', '/api/user/device/checkAuth']);
      assert.equal(f.brokers.length, 0);
      for (const secret of ['PRIVATE', serial, endpoint, cert, key, 'synthetic-issued-client', 'fixture-access', 'device-1', 'certId='])
        assert.ok(!JSON.stringify(c.frames).includes(secret));
    } finally { await f.close(); }
  }
});

test('checkAuth held request is aborted on timeout or disconnect before DNS or MQTT', async () => {
  for (const cancel of [false, true]) {
    const f = await fixture({ auth: { hold: true }, testOptions: { initialMs: 150 } });
    try {
      const c = await f.open();
      await bounded((async () => { while (f.calls.length < 3 && !f.brokers.length) await new Promise(resolve => setImmediate(resolve)); })());
      assert.equal(f.calls.length, 3);
      if (cancel) { c.ws.close(); await bounded(once(c.ws, 'close')); }
      else {
        const error = await c.wait(v => v.type === 'error');
        assert.equal(error.code, 'timeout');
        assert.deepEqual(error.diagnostic, { phase: 'monitoring-credential', reason: 'timeout' });
      }
      await bounded((async () => { while (!f.authCancelled) await new Promise(resolve => setImmediate(resolve)); })());
      assert.equal(f.events.includes('dns'), false);
      assert.equal(f.brokers.length, 0);
    } finally { await f.close(); }
  }
});

test('invalid credential binding stops before checkAuth and transport', async () => {
  const f = await fixture({ bootstrap: { ...bootstrap(), clientId: 'invalid/client' } });
  try {
    const c = await f.open();
    await c.wait(v => v.type === 'error');
    assert.deepEqual(f.events, ['/api/user/device/list', '/api/user/device/getMqttCert']);
    assert.equal(f.brokers.length, 0);
  } finally { await f.close(); }
});

test('HTTP 201 device list and monitoring credential responses reach snapshot', async () => {
  const f = await fixture({ status: 201 });
  try {
    const c = await f.open();
    const result = await c.wait(frame => frame.type === 'snapshot' || frame.type === 'error');
    assert.equal(result.type, 'snapshot', JSON.stringify(result));
    assert.deepEqual(result.objects, { heater_bed: { temperature: 45, target: 60 }, extruder1: { temperature: 200 } });
    assert.deepEqual(f.calls.map(call => call.path), ['/api/user/device/list', '/api/user/device/getMqttCert', checkAuthPath('synthetic-issued-client')]);
    assert.equal(f.brokers.length, 1);
  } finally { await f.close(); }
});

test('certificate validity rejection uses a fixed credential diagnostic', t => {
  const certificate = new X509Certificate(cert);
  for (const now of [Date.parse(certificate.validFrom) - 1, Date.parse(certificate.validTo)]) {
    t.mock.method(Date, 'now', () => now);
    assert.throws(() => parseSnapmakerBootstrap(bootstrap(), serial), error => {
      assert.equal(error.code, 'unsupported');
      assert.equal(error.message, 'The Snapmaker monitoring configuration is unsupported.');
      assert.deepEqual(error.diagnostic, { phase: 'monitoring-credential', reason: 'credential-invalid' });
      assert.deepEqual(Object.keys(error), ['code', 'diagnostic']);
      return true;
    });
    t.mock.restoreAll();
  }
});

test('HTTP success still requires valid JSON and business success before MQTT', async () => {
  for (const [settings, code, diagnostic] of [
    [{ status: 204 }, 'upstream', { phase: 'device-list', reason: 'malformed-response' }],
    [{ status: 201, raw: 'not json' }, 'upstream', { phase: 'device-list', reason: 'malformed-response' }],
    [{ status: 201, raw: '[]' }, 'upstream', { phase: 'device-list', reason: 'malformed-response' }],
    [{ status: 201, code: 12345 }, 'upstream', { phase: 'device-list', reason: 'business', code: 12345 }],
    [{ status: 201, code: 110003 }, 'auth', { phase: 'device-list', reason: 'business', code: 110003 }],
    ...[401, 403, 302, 503].map(status => [{ status }, status === 401 || status === 403 ? 'auth' : 'upstream',
      { phase: 'device-list', reason: 'http', code: status }])
  ]) {
    const f = await fixture(settings);
    try {
      const c = await f.open();
      const error = await c.wait(frame => frame.type === 'error');
      assert.equal(error.code, code);
      assert.deepEqual(error.diagnostic, diagnostic);
      assert.equal(f.calls.length, 1);
      assert.equal(f.brokers.length, 0);
    } finally { await f.close(); }
  }
});

test('upstream failures identify confirmed phase and bounded cause without upstream secrets', async () => {
  const secret = 'PRIVATE fixture-access serial cert token endpoint stack';
  for (const [settings, diagnostic] of [
    [{ status: 503, raw: secret }, { phase: 'device-list', reason: 'http', code: 503 }],
    [{ code: 12345 }, { phase: 'device-list', reason: 'business', code: 12345 }],
    [{ raw: secret }, { phase: 'device-list', reason: 'malformed-response' }],
    [{ raw: 'x'.repeat(256 * 1024 + 1) }, { phase: 'device-list', reason: 'response-limit' }],
    [{ resetHttp: true }, { phase: 'device-list', reason: 'connection-reset' }],
    [{ credentialRaw: secret }, { phase: 'monitoring-credential', reason: 'malformed-response' }],
    [{ credentialRaw: JSON.stringify({ code: 12345, message: secret }) }, { phase: 'monitoring-credential', reason: 'business', code: 12345 }],
    [{ testOptions: { lookup: async () => { throw Object.assign(Error(secret), { code: 'ENOTFOUND' }); } } }, { phase: 'dns', reason: 'dns-not-found' }],
    [{ brokerError: Object.assign(Error(secret), { code: 'CERT_HAS_EXPIRED' }) }, { phase: 'broker-connection', reason: 'tls-certificate' }],
    [{ brokerError: Object.assign(Error(secret), { code: 5 }) }, { phase: 'broker-connection', reason: 'mqtt-rejected', code: 5 }],
    [{ brokerError: Object.assign(Error(secret), { code: secret }) }, { phase: 'broker-connection', reason: 'network' }],
    [{ denied: true }, { phase: 'subscription', reason: 'subscription-rejected', code: 128 }],
    [{ rpcError: { method: 'printer.objects.query', code: -32000, message: secret, data: secret } }, { phase: 'objects-query', reason: 'rpc-error', code: -32000 }]
  ]) {
    const f = await fixture(settings);
    try {
      const c = await f.open();
      const error = await c.wait(frame => frame.type === 'error');
      assert.equal(error.code, 'upstream');
      assert.deepEqual(error.diagnostic, diagnostic);
      assert.ok(!JSON.stringify(c.frames).includes(secret));
      for (const privateValue of [serial, endpoint, cert, key, 'synthetic-issued-client', 'fixture-access'])
        assert.ok(!JSON.stringify(c.frames).includes(privateValue));
    } finally { await f.close(); }
  }
});

test('API and correlated RPC diagnostics bound numeric codes and identify each generated call', async () => {
  for (const code of [-2147483648, 2147483647, 2147483648, -2147483649, 1.5, 'PRIVATE', '2147483647', { message: 'PRIVATE' }]) {
    const f = await fixture({ code });
    try {
      const c = await f.open();
      const error = await c.wait(frame => frame.type === 'error');
      const safe = typeof code === 'number' && Number.isInteger(code) && code >= -2147483648 && code <= 2147483647
        ? code : code === '2147483647' ? 2147483647 : undefined;
      assert.deepEqual(error.diagnostic, { phase: 'device-list', reason: 'business', ...(safe !== undefined ? { code: safe } : {}) });
      assert.ok(!JSON.stringify(c.frames).includes('PRIVATE'));
    } finally { await f.close(); }
  }
  for (const [method, phase] of [['printer.objects.list', 'objects-list'], ['printer.objects.subscribe', 'objects-subscribe'],
    ['printer.objects.setSubscribeFilter', 'subscribe-filter'], ['printer.objects.query', 'objects-query']]) {
    const f = await fixture({ rpcError: { method, code: 'PRIVATE', message: 'PRIVATE', data: 'PRIVATE' } });
    try {
      const c = await f.open();
      const error = await c.wait(frame => frame.type === 'error');
      assert.deepEqual(error.diagnostic, { phase, reason: 'rpc-error' });
      assert.ok(!JSON.stringify(c.frames).includes('PRIVATE'));
      assert.equal(f.brokers[0].ended, true);
      assert.equal(f.brokers[0].options.key, undefined);
    } finally { await f.close(); }
  }
});

test('real MQTT transport reports TLS and CONNACK failures without raw error text', async () => {
  const original = tls.connect;
  const { Duplex } = await import('node:stream');
  for (const kind of ['tls', 'connack']) {
    tls.connect = () => {
      const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) {
        callback();
        if (kind === 'connack') queueMicrotask(() => socket.push(Buffer.from([0x20, 0x02, 0x00, 0x05])));
      } });
      if (kind === 'tls') queueMicrotask(() => socket.destroy(Object.assign(Error('PRIVATE certificate endpoint'), { code: 'CERT_HAS_EXPIRED' })));
      return socket;
    };
    syncBuiltinESMExports();
    const f = await fixture({ testOptions: { connect: undefined } });
    try {
      const c = await f.open();
      const error = await c.wait(frame => frame.type === 'error');
      assert.deepEqual(error.diagnostic, kind === 'tls'
        ? { phase: 'broker-connection', reason: 'tls-certificate' }
        : { phase: 'broker-connection', reason: 'mqtt-rejected', code: 5 });
      assert.ok(!JSON.stringify(c.frames).includes('PRIVATE'));
    } finally { await f.close(); tls.connect = original; syncBuiltinESMExports(); }
  }
});

test('fixed authenticated bootstrap, generated read RPCs, selected snapshot and sparse delta', async () => {
  const f = await fixture({ unavailable: true });
  try {
    const c = await f.open();
    const snapshot = await c.wait(frame => frame.type === 'snapshot');
    assert.deepEqual(snapshot.objects, { heater_bed: { temperature: 45, target: 60 }, extruder1: { temperature: 200 } });
    assert.deepEqual(f.calls.map(call => [call.method, call.path]), [['POST', '/api/user/device/list'], ['GET', '/api/user/device/getMqttCert'], ['GET', checkAuthPath('synthetic-issued-client')]]);
    assert.deepEqual(JSON.parse(f.calls[0].body), { name: null, mac: null, sn: null, productName: null, productCode: null, pageIndex: null, pageRows: null });
    const b = f.brokers[0];
    assert.deepEqual(b.subscriptions, ['status', 'response', 'notification', 'config/synthetic-issued-client'].map(topic => [serial + '/' + topic, 1]));
    assert.deepEqual(b.calls.map(call => call.method), ['printer.objects.list', 'printer.objects.subscribe', 'printer.objects.setSubscribeFilter', 'printer.objects.query']);
    assert.equal(b.calls[2].params.sn, serial);
    for (const call of b.calls) { assert.equal(call.topic, serial + '/request'); assert.deepEqual(call.options, { qos: 1, retain: false }); }
    assert.deepEqual(Object.keys(b.calls[3].params.objects), ['print_stats', 'display_status', 'virtual_sdcard', 'heater_bed', 'extruder', 'extruder1', 'print_task_config']);
    for (const call of b.calls.slice(1)) assert.deepEqual(call.params.objects.print_task_config,
      ['filament_vendor','filament_type','filament_sub_type','filament_exist','filament_color_rgba','filament_color']);
    assert.equal(b.options.host, '8.8.8.8');
    assert.equal(b.options.servername, endpoint);
    assert.equal(b.options.clientId, 'synthetic-issued-client');
    assert.equal(b.options.rejectUnauthorized, true);
    assert.equal(b.options.reconnectPeriod, 0);
    const update = { jsonrpc: '2.0', method: 'notify_status_update', params: [{ heater_bed: { temperature: 46, secret: 'hidden' }, dangerous: { hidden: true } }, 1] };
    b.message('OTHER_U1/status', update);
    b.message(serial + '/status', update, true);
    b.message(serial + '/status', update);
    assert.deepEqual((await c.wait(frame => frame.type === 'delta')).objects, { heater_bed: { temperature: 46 } });
    c.ws.close();
    await bounded(once(c.ws, 'close'));
    assert.equal(b.ended, true);
    assert.equal(b.destroyed, true);
    assert.equal(b.options.cert, undefined);
    assert.equal(b.options.key, undefined);
  } finally { await f.close(); }
});

test('advertised material fields and explicit clears cross the read-only gateway', async () => {
  const config={filament_vendor:['Example'],filament_type:['PLA'],filament_exist:[true],filament_color:[0],private:'hidden',extruders_used:[7]};
  const f=await fixture({rpcResults:{'printer.objects.query':{status:{print_task_config:config}}}});
  try {
    const c=await f.open();
    assert.deepEqual((await c.wait(v=>v.type==='snapshot')).objects.print_task_config,
      {filament_vendor:['Example'],filament_type:['PLA'],filament_exist:[true],filament_color:[0]});
    const previous=c.frames.length;
    f.brokers[0].message(serial+'/status',{jsonrpc:'2.0',method:'notify_status_update',params:[{print_task_config:{},heater_bed:{temperature:46}},1]});
    const unchanged=await c.wait(v=>c.frames.indexOf(v)>=previous && v.type==='delta');
    assert.equal(unchanged.objects.print_task_config,undefined);
    assert.equal(unchanged.objects.heater_bed.temperature,46);
    for (const clear of [null,false,[], {filament_type:[],filament_exist:[false],filament_color:null}]) {
      const count=c.frames.length;
      f.brokers[0].message(serial+'/status',{jsonrpc:'2.0',method:'notify_status_update',params:[{print_task_config:clear},1]});
      await c.wait(v=>c.frames.indexOf(v)>=count && v.type==='delta');
      const item=c.frames.at(-1).objects.print_task_config;
      if(clear===null || clear===false || Array.isArray(clear))assert.ok(Object.values(item).every(v=>v===null));
      else assert.deepEqual(item,clear);
    }
  } finally {await f.close();}
  const absent=await fixture({rpcResults:{'printer.objects.list':{objects:['heater_bed']}}});
  try {
    const c=await absent.open();await c.wait(v=>v.type==='snapshot');
    for(const call of absent.brokers[0].calls.slice(1)) assert.equal(call.params.objects.print_task_config,undefined);
  } finally {await absent.close();}
});

test('auth errors, selected-device binding, redirects and invalid bootstrap/DNS stop before dialing', async () => {
  for (const settings of [{ status: 401 }, { code: 110003 }, { status: 302 }, { raw: 'not json' },
    { devices: [] }, { devices: [{ deviceId: 'device-1', sn: 'other/serial' }] },
    { devices: [devices[0], devices[0]] }, { devices: [devices[0], { deviceId: 'duplicate', sn: serial }] },
    { bootstrap: { ...bootstrap(), endpoint: 'attacker.invalid' } },
    { bootstrap: { ...bootstrap(), topics: { publish: ['/request'], subscribe: ['OTHER_U1/response'] } } },
    { addresses: ['8.8.8.8', '127.0.0.1'] }, { addresses: [] }]) {
    const f = await fixture(settings);
    try {
      const c = await f.open();
      const error = await c.wait(frame => frame.type === 'error');
      assert.ok(['auth', 'unsupported', 'upstream'].includes(error.code));
      assert.ok(!JSON.stringify(c.frames).includes('fixture-access'));
      assert.equal(f.brokers.length, 0);
    } finally { await f.close(); }
  }
});

test('single initial frame, no browser publishing, cancel HTTP and bounded initial/RPC/freshness timeouts', async () => {
  for (const frame of [{ type: 'publish', payload: {} }, { type: 'connect', accessToken: 'fixture-access', deviceId: 'device-1', host: endpoint }, { type: 'connect', accessToken: '', deviceId: 'device-1' }]) {
    const f = await fixture();
    try {
      const c = await f.open(false);
      c.ws.send(JSON.stringify(frame));
      await c.wait(frame => frame.type === 'error');
      assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
  }
  for (const settings of [{ holdHttp: true }, { holdRpc: 'printer.objects.list' }, { testOptions: { initialMs: 50 }, skipConnect: true }]) {
    const f = await fixture(settings);
    try {
      const c = await f.open(!settings.skipConnect);
      assert.ok(['timeout', 'stale'].includes((await c.wait(frame => frame.type === 'error')).code));
      if (f.brokers[0]) assert.equal(f.brokers[0].ended, true);
    } finally { await f.close(); }
  }
  const f = await fixture({ testOptions: { queryMs: 20, rpcMs: 30 } });
  try {
    const c = await f.open();
    await c.wait(frame => frame.type === 'snapshot');
    f.holdRpc = 'printer.objects.query';
    assert.equal((await c.wait(frame => frame.type === 'error')).code, 'stale');
    assert.equal(f.brokers[0].ended, true);
  } finally { await f.close(); }
  const cancelled = await fixture({ holdHttp: true });
  try {
    const c = await cancelled.open();
    while (!cancelled.calls.length) await new Promise(resolve => setImmediate(resolve));
    c.ws.close();
    await once(c.ws, 'close');
    await bounded((async () => { while (!cancelled.httpCancelled) await new Promise(resolve => setImmediate(resolve)); })());
    assert.equal(cancelled.brokers.length, 0);
  } finally { await cancelled.close(); }
});

test('unsupported checks identify fixed categories at their rejection phase without configuration leakage', async t => {
  const privateValue = 'PRIVATE configuration value';
  const cases = [
    [{ devices: { value: privateValue } }, 'device-list', 'device-response'],
    [{ devices: Array(1001).fill(devices[0]) }, 'device-list', 'device-response'],
    [{ devices: [devices[0], devices[0]] }, 'device-list', 'device-identity', 'auth'],
    [{ devices: [] }, 'device-list', 'device-identity', 'auth'],
    [{ devices: [{ deviceId: 'device-1', sn: privateValue }] }, 'device-list', 'device-identity', 'auth'],
    [{ devices: [devices[0], { deviceId: 'duplicate', sn: serial }] }, 'device-list', 'device-identity'],
    [{ bootstrap: privateValue }, 'monitoring-credential', 'invalid-response'],
    ...[
      [{ endpoint: privateValue }, 'broker-host'], [{ port: 443 }, 'broker-port'],
      [{ clientId: privateValue }, 'client-identity'], [{ cert: privateValue }, 'credential-invalid'],
      [{ key: privateValue }, 'credential-invalid'], [{ key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) }, 'credential-invalid'],
      [{ topics: privateValue }, 'invalid-response'],
      [{ topics: { ...bootstrap().topics, subscribe: [privateValue] } }, 'subscribe-topics'],
      [{ topics: { ...bootstrap().topics, subscribe: ['/response', '/status', '/notification'] } }, 'subscribe-topics'],
      [{ topics: { ...bootstrap().topics, publish: [privateValue] } }, 'publish-topics'],
      [{ topics: { ...bootstrap().topics, publish: [] } }, 'publish-topics']
    ].map(([patch, reason]) => [{ bootstrap: { ...bootstrap(), ...patch } }, 'monitoring-credential', reason]),
    ...[[], ['8.8.8.8', '127.0.0.1'], Array(17).fill('8.8.8.8')].map(addresses => [{ addresses }, 'dns', 'broker-address']),
    ...[null, { objects: privateValue }, { objects: [privateValue, 1] }, { objects: Array(257).fill('heater_bed') },
      { objects: [privateValue] }, { objects: Array.from({ length: 21 }, (_, i) => 'extruder' + i) }]
      .map(result => [{ rpcResults: { 'printer.objects.list': result } }, 'objects-list', 'object-response']),
    ...[[null, 'upstream'], [{ status: privateValue }, 'upstream'],
      [{ status: { heater_bed: privateValue } }, 'upstream'], [{ status: {} }, 'unsupported']]
      .map(([result, code]) => [{ rpcResults: { 'printer.objects.query': result } }, 'objects-query', 'object-response', code])
  ];
  for (const [index, [settings, phase, reason, code = 'unsupported']] of cases.entries()) {
    await t.test(`${index}: ${phase}/${reason}`, async () => {
      const f = await fixture(settings);
      try {
        const c = await f.open();
        const error = await c.wait(frame => frame.type === 'error');
        assert.equal(error.code, code);
        assert.equal(error.message, code === 'auth' ? 'Snapmaker authentication or device authorization was rejected.'
          : code === 'upstream' ? 'Snapmaker monitoring could not reach the upstream service.' : 'The Snapmaker monitoring configuration is unsupported.');
        assert.deepEqual(error.diagnostic, { phase, reason });
        assert.deepEqual(Object.keys(error).sort(), ['code', 'diagnostic', 'message', 'type']);
        for (const secret of [privateValue, serial, endpoint, cert, key, 'synthetic-issued-client', 'fixture-access'])
          assert.ok(!JSON.stringify(c.frames).includes(secret));
      } finally { await f.close(); }
    });
  }
});

test('concurrent issued client ID cannot evict an existing WebOrca session; release permits fresh ownership', async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    await first.wait(frame => frame.type === 'snapshot');
    const second = await f.open();
    const rejected = await second.wait(frame => frame.type === 'error');
    assert.equal(rejected.code, 'unsupported');
    assert.deepEqual(rejected.diagnostic, { phase: 'broker-connection', reason: 'client-in-use' });
    for (const secret of [serial, endpoint, cert, key, 'synthetic-issued-client', 'fixture-access'])
      assert.ok(!JSON.stringify(second.frames).includes(secret));
    assert.equal(f.brokers.length, 1);
    first.ws.send(JSON.stringify({ type: 'publish' }));
    await bounded(once(first.ws, 'close'));
    const third = await f.open();
    await third.wait(frame => frame.type === 'snapshot');
    assert.equal(f.brokers.length, 2);
  } finally { await f.close(); }
});

test('RPC replies without PUBACK cannot advance or retain outgoing publishes indefinitely', async () => {
  const f = await fixture({ holdAck: true, testOptions: { rpcMs: 30 } });
  try {
    const c = await f.open();
    assert.equal((await c.wait(frame => frame.type === 'error')).code, 'timeout');
    assert.equal(c.frames.some(frame => frame.type === 'snapshot'), false);
    assert.equal(f.brokers[0].calls.length, 1);
    assert.equal(f.brokers[0].ended, true);
    assert.equal(f.brokers[0].options.cert, undefined);
    assert.equal(f.brokers[0].options.key, undefined);
  } finally { await f.close(); }
});

test('separately bounded deltas cannot accumulate an unbounded snapshot', async () => {
  const f = await fixture();
  try {
    const c = await f.open();
    await c.wait(frame => frame.type === 'snapshot');
    const broker = f.brokers[0];
    for (const field of ['filename', 'message']) broker.message(serial + '/status', {
      jsonrpc: '2.0', method: 'notify_status_update', params: [{ print_stats: { [field]: 'x'.repeat(150_000) } }, 1]
    });
    assert.equal((await c.wait(frame => frame.type === 'error')).code, 'upstream');
    assert.equal(broker.ended, true);
  } finally { await f.close(); }
});

async function rejection(f, path, headers = {}) {
  return bounded(new Promise((resolve, reject) => {
    const values = { host: `127.0.0.1:${f.gateway.port}`, origin: `http://127.0.0.1:${f.gateway.port}`,
      connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
      'sec-websocket-key': 'c3ludGhldGljLWZpeHR1cmU=', ...headers.headers };
    if (Object.hasOwn(headers, 'origin')) values.origin = headers.origin;
    for (const key of Object.keys(values)) if (values[key] === undefined) delete values[key];
    const request = http.request({ host: '127.0.0.1', port: f.gateway.port, path, headers: values }, res => {
      res.resume(); resolve(res.statusCode);
    });
    request.on('error', reject);
    request.on('upgrade', (_response, socket) => { socket.destroy(); reject(Error('Unexpected upgrade for ' + path)); });
    request.end();
  }));
}
test('local and hosted upgrade gates reject unknown/raw/query routes, missing or mismatched Origin/Host and disabled provider', async () => {
  for (const hosted of [false, true]) {
    const f = await fixture({ hosted });
    try {
      for (const path of [route + '?accessToken=synthetic', route + '?', route + '/', '/_printer/snapmaker-cloud/%6donitor', '/_printer/snapmaker-cloud/control']) {
        assert.equal(await rejection(f, path, hosted ? { origin: 'https://weborca.example', headers: { host: 'weborca.example' } } : {}), 404);
      }
      for (const headers of [{ origin: undefined }, { origin: 'https://evil.invalid' },
        { origin: 'http://evil.invalid', headers: { host: 'evil.invalid', 'x-forwarded-host': '127.0.0.1' } },
        { headers: { 'sec-fetch-site': 'cross-site' } }, { headers: { host: '127.0.0.1:1' } }]) assert.equal(await rejection(f, route, headers), 403);
      assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
  }
  const disabled = await fixture({ cloud: 'bambu-cloud' });
  try { assert.equal(await rejection(disabled, route), 403); } finally { await disabled.close(); }
});

test('real MQTT transport pins TLS and rejects oversized, incomplete QoS 2 and excessive control packets', async () => {
  const aedes = await Aedes.createBroker();
  const tcp = net.createServer(aedes.handle);
  const port = await listen(tcp);
  const original = tls.connect;
  const tlsOptions = [];
  tls.connect = options => { tlsOptions.push(options); return net.connect({ host: '127.0.0.1', port }); };
  syncBuiltinESMExports();
  const f = await fixture({ testOptions: { connect: undefined, initialMs: 2000, rpcMs: 1000 } });
  const require = createRequire(new URL('../../app/package.json', import.meta.url));
  const packet = require('mqtt-packet');
  let connection;
  aedes.on('client', client => { connection = client; });
  aedes.on('publish', (message, client) => {
    if (!client || message.topic !== serial + '/request') return;
    const request = JSON.parse(message.payload.toString());
    const result = request.method.endsWith('.list') ? { objects: ['heater_bed'] }
      : request.method.endsWith('.query') ? { status: { heater_bed: { temperature: 40 } } } : {};
    aedes.publish({ topic: serial + '/response', payload: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result })), qos: 1, retain: false }, () => {});
  });
  try {
    const c = await f.open();
    await c.wait(frame => frame.type === 'snapshot');
    const options = tlsOptions[0];
    assert.equal(options.host, '8.8.8.8');
    assert.equal(options.servername, endpoint);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.minVersion, 'TLSv1.2');
    assert.equal(options.ca, SNAPMAKER_ROOT_CA);
    assert.ok(options.checkServerIdentity('ignored', { subjectaltname: 'DNS:evil.invalid', subject: {} }));
    // Verify the parser can handle fragmented ordinary packets first.
    const delta = packet.generate({ cmd: 'publish', topic: serial + '/status', qos: 0, payload: JSON.stringify({ jsonrpc: '2.0', method: 'notify_status_update', params: [{ heater_bed: { temperature: 41 } }, 1] }) });
    for (const byte of delta) connection.conn.write(Buffer.from([byte]));
    await c.wait(frame => frame.type === 'delta');
    // Each attack must close before parser storage or message delivery can accumulate data.
    const attacks = [
      Buffer.from([0x30, 0x80, 0x80, 0x40]), // Declares 1 MiB with no body.
      packet.generate({ cmd: 'publish', topic: serial + '/status', qos: 2, messageId: 7, payload: Buffer.alloc(128 * 1024) }),
      Buffer.alloc(202).map((_, index) => index % 2 === 0 ? 0xd0 : 0) // 101 PINGRESP packets.
    ];
    for (let i = 0; i < attacks.length; i++) {
      const current = i === 0 ? c : await f.open();
      if (i > 0) await current.wait(frame => frame.type === 'snapshot');
      connection.conn.write(attacks[i]);
      assert.equal((await current.wait(frame => frame.type === 'error')).code, 'upstream');
      await bounded(once(current.ws, 'close'));
    }
  } finally {
    tls.connect = original;
    syncBuiltinESMExports();
    await f.close();
    await new Promise(resolve => aedes.close(resolve));
    await close(tcp);
  }
});

test('packaged deployment server accepts only the exact configured same-origin monitor upgrade',
  { skip: !process.env.APP_TEST_PRINTER_CLOUD_BUNDLE }, async () => {
  for (const cloud of ['snapmaker-cloud', 'creality-cloud']) {
    const probe = net.createServer();
    const port = await listen(probe);
    await close(probe);
    const child = spawn(process.execPath, [new URL('../../deploy/server.mjs', import.meta.url).pathname], {
      env: { PATH: process.env.PATH, NODE_OPTIONS: '--max-old-space-size=1536', PORT: String(port),
        ORCA_BIND: '127.0.0.1', ORCA_ROOT: path.dirname(process.env.APP_TEST_PRINTER_CLOUD_BUNDLE),
        ORCA_PUBLIC_ORIGIN: 'https://weborca.example', ORCA_PRINTER_CLOUD: cloud },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const exited = once(child, 'exit');
    await bounded(new Promise((resolve, reject) => {
      child.stdout.on('data', data => { if (data.toString().includes('listening')) resolve(); });
      child.stderr.on('data', data => reject(Error(data.toString())));
      child.once('exit', () => reject(Error('Hosted server exited before listening')));
    }));
    const f = { gateway: { port, wsUrl: `ws://127.0.0.1:${port}` } };
    const headers = { origin: 'https://weborca.example', headers: { host: 'weborca.example' } };
    try {
      for (const target of [route + '?', route + '?accessToken=synthetic', route + '/', '/_printer/snapmaker-cloud/%6donitor', '/_printer/ws/localhost/', '/_printer/bambu-cloud/mqtt/example']) {
        assert.equal(await rejection(f, target, headers), 404);
      }
      for (const bad of [{ origin: undefined }, { origin: 'https://evil.invalid' }, { headers: { host: 'evil.invalid' } }, { ...headers, headers: { host: 'weborca.example', 'sec-fetch-site': 'cross-site' } }]) {
        assert.equal(await rejection(f, route, bad), 403);
      }
      if (cloud !== 'snapmaker-cloud') assert.equal(await rejection(f, route, headers), 403);
      else {
        const ws = new WebSocket(f.gateway.wsUrl + route, headers);
        const received = inbox(ws);
        await bounded(once(ws, 'open'));
        ws.send(JSON.stringify({ type: 'connect', accessToken: '', deviceId: 'device-1' }));
        assert.equal((await received.wait(frame => frame.type === 'error')).code, 'auth');
        await bounded(once(ws, 'close'));
      }
    } finally { child.kill('SIGTERM'); await bounded(exited); }
  }
});
