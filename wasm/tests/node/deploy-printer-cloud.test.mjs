import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../../app/', import.meta.url));
const server = fileURLToPath(new URL('../../deploy/server.mjs', import.meta.url));
const { buildSync } = createRequire(path.join(app, 'package.json'))('esbuild');
const origin = 'https://server-1.barbel-hops.ts.net:5070';
const start = '/_printer/prusa-connect/auth/start';
const login = '/_printer/creality-cloud/global/auth/api/cxy/account/v2/loginV2';
const bambuLogin = '/_printer/bambu-cloud/api/v1/user-service/user/login';
const snapmakerLogin = '/_printer/snapmaker-cloud/auth/token';

async function fixture(env = {}, bundle = true, bambu = false, snapmaker = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-hosted-printer-cloud-'));
  writeFileSync(path.join(root, 'index.html'), '<title>static spa</title>');
  if (bundle && process.env.APP_TEST_PRINTER_CLOUD_BUNDLE) {
    copyFileSync(process.env.APP_TEST_PRINTER_CLOUD_BUNDLE, path.join(root, 'printer-cloud-bridge.mjs'));
  } else if (bundle) buildSync({ entryPoints: [path.join(app, 'gateway/hostedPrinterCloud.ts')], outfile: path.join(root, 'printer-cloud-bridge.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20' });
  for (const file of ['printer-cloud-bridge.mjs.br', 'printer-cloud-bridge.mjs.gz', 'orca-cloud-bridge.mjs', 'orca-cloud-bridge.mjs.br', 'orca-cloud-bridge.mjs.gz', 'orca-gateway.mjs', 'orca-gateway.mjs.br', 'orca-gateway.mjs.gz']) writeFileSync(path.join(root, file), 'private backend fixture');
  let upstreamCalls = 0;
  const upstream = http.createServer(async (req, res) => {
    upstreamCalls++;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, snapmaker ? '/api/oauth2/token' : bambu ? '/v1/user-service/user/login' : '/api/cxy/account/v2/loginV2');
    let body = '';
    for await (const chunk of req) body += chunk;
    if (snapmaker) {
      assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
      assert.match(body, /name="grant_type"\r\n\r\npassword\r\n/);
      assert.ok(!body.includes('synthetic-fixture-only'));
    } else assert.equal(body, bambu ? '{"account":"synthetic@example.invalid","password":"synthetic-fixture-only"}' : '{"fixture":true}');
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, snapmaker ? 'Basic bWFsbC1hcHA6MTIzNDU2' : undefined);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'fixture=private');
    res.end(snapmaker ? '{"code":200,"data":{"access_token":"synthetic","refresh_token":"synthetic-refresh"}}' : '{"mockLoginRoute":true}');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  // Intercept transport only: the actual packaged handler still validates/routes/forwards.
  // Every HTTPS request except this exact mock target fails; no cloud traffic is possible.
  const preload = `
    import http from 'node:http';
    import https from 'node:https';
    import { syncBuiltinESMExports } from 'node:module';
    https.request = (options, callback) => {
      if (options.hostname !== ${JSON.stringify(snapmaker ? 'api.snapmaker.com' : bambu ? 'api.bambulab.com' : 'api.crealitycloud.com')} || options.path !== ${JSON.stringify(snapmaker ? '/api/oauth2/token' : bambu ? '/v1/user-service/user/login' : '/api/cxy/account/v2/loginV2')}) throw Error('External traffic forbidden');
      return http.request({ ...options, hostname: '127.0.0.1', port: ${upstream.address().port} }, callback);
    };
    globalThis.fetch = () => { throw Error('External traffic forbidden'); };
    syncBuiltinESMExports();`;
  const port = await new Promise(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, server], {
    env: { PATH: process.env.PATH, PORT: String(port), ORCA_BIND: '127.0.0.1', ORCA_HOST: 'server-1.barbel-hops.ts.net', ORCA_ROOT: root, ORCA_PUBLIC_ORIGIN: origin, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const listening = await new Promise(resolve => {
    child.stdout.on('data', data => { if (String(data).includes('listening')) resolve(true); });
    child.once('exit', () => resolve(false));
  });
  return {
    listening, stderr: () => stderr, upstreamCalls: () => upstreamCalls,
    call(route, { method = 'GET', body, headers = {} } = {}) {
      return new Promise((resolve, reject) => {
        const requestHeaders = { Host: 'server-1.barbel-hops.ts.net:5070', Origin: origin, ...headers };
        for (const key of Object.keys(requestHeaders)) if (requestHeaders[key] === undefined) delete requestHeaders[key];
        const req = http.request({ host: '127.0.0.1', port, path: route, method, headers: requestHeaders }, res => {
          let text = '';
          res.on('data', data => { text += data; });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
        });
        req.on('error', reject);
        req.end(body);
      });
    },
    async close() {
      if (listening) child.kill('SIGTERM');
      await exited;
      await new Promise(resolve => upstream.close(resolve));
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test('real hosted server routes both cloud login POSTs with Orca Cloud independently disabled', async () => {
  const f = await fixture({ ORCA_PRINTER_CLOUD: 'prusa-connect,creality-cloud' });
  try {
    assert.equal(f.listening, true);
    const response = await f.call(start, { method: 'POST' });
    assert.equal(response.status, 200, 'Prusa auth/start must bypass the static 405 guard');
    const result = response.json();
    // Assert booleans so PKCE values never appear in assertion output.
    assert.ok(typeof result.state === 'string' && result.state.length > 0);
    assert.ok(typeof result.verifier === 'string' && result.verifier.length > 0);
    const authorize = new URL(result.authorizeUrl);
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(authorize.searchParams.get('code_challenge'));
    const creality = await f.call(login, { method: 'POST', body: '{"fixture":true}', headers: { 'Content-Type': 'application/json', Cookie: 'synthetic=1', Authorization: 'synthetic' } });
    assert.equal(creality.status, 200);
    assert.deepEqual(creality.json(), { mockLoginRoute: true });
    assert.equal(creality.headers['set-cookie'], undefined);
    assert.equal(f.upstreamCalls(), 1);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal((await f.call('/_orca-cloud/status')).status, 403);
    const status = await f.call('/_printer/status', { headers: { Origin: undefined, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' } });
    assert.equal(status.status, 200);
    assert.deepEqual(status.json(), { enabled: true, mode: 'cloud', readOnly: false, cloud: ['prusa-connect', 'creality-cloud'] });
    for (const headers of [
      { Host: 'server-1.barbel-hops.ts.net:5071' }, { Host: 'localhost:5070' },
      { Origin: 'https://evil.example' }, { Origin: undefined }, { Origin: '' },
      { Origin: 'https://server-1.barbel-hops.ts.net:5071' },
      { Host: 'localhost:5070', 'X-Forwarded-Host': 'server-1.barbel-hops.ts.net:5070', 'X-Forwarded-Proto': 'https' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: undefined, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' }
    ]) assert.equal((await f.call(start, { method: 'POST', headers })).status, 403);
    for (const headers of [{ Origin: undefined }, { Origin: undefined, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }]) {
      assert.equal((await f.call('/_printer/status', { headers })).status, 403);
    }
    assert.equal((await f.call('/_printer/creality-cloud/global/auth/api/forbidden', { method: 'POST' })).status, 403);
    assert.equal((await f.call(login, { method: 'POST', body: 'x'.repeat(65537) })).status, 413);
    assert.equal(f.upstreamCalls(), 1);
    for (const route of ['/_printer/http/127.0.0.1/api', '/_printer/discover', '/_printer/ws/127.0.0.1/', '/_printer/bambu-cloud/mqtt/example', '/_gw/status']) {
      for (const method of ['GET', 'POST']) assert.equal((await f.call(route, { method })).status, 404);
    }
    for (const file of ['printer-cloud-bridge.mjs', 'orca-cloud-bridge.mjs', 'orca-gateway.mjs']) {
      for (const suffix of ['', '.br', '.gz']) {
        for (const prefix of ['/', '/assets/..%2f']) assert.equal((await f.call(`${prefix}${file}${suffix}`)).status, 404);
      }
    }
  } finally { await f.close(); }
});

test('hosted Bambu login POST reaches the existing API handler with explicit opt-in', async () => {
  const f = await fixture({ ORCA_PRINTER_CLOUD: 'bambu-cloud' }, true, true);
  try {
    assert.equal(f.listening, true);
    const response = await f.call(bambuLogin, { method: 'POST', body: '{"account":"synthetic@example.invalid","password":"synthetic-fixture-only"}', headers: { 'Content-Type': 'application/json', Cookie: 'synthetic=1' } });
    assert.equal(response.status, 200, 'Bambu login must reach its allowlisted upstream instead of returning unknown printer cloud route');
    assert.deepEqual(response.json(), { mockLoginRoute: true });
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual((await f.call('/_printer/status')).json().cloud, ['bambu-cloud']);
    for (const headers of [
      { Host: 'server-1.barbel-hops.ts.net:5071' }, { Origin: 'https://evil.example' },
      { Origin: undefined }, { 'Sec-Fetch-Site': 'cross-site' },
      { Host: 'localhost:5070', 'X-Forwarded-Host': 'server-1.barbel-hops.ts.net:5070', 'X-Forwarded-Proto': 'https' }
    ]) assert.equal((await f.call(bambuLogin, { method: 'POST', headers })).status, 403);
    assert.equal((await f.call('/_printer/bambu-cloud/api/v1/forbidden', { method: 'POST' })).status, 403);
    assert.equal((await f.call('/_printer/bambu-cloud/mqtt/example', { method: 'POST' })).status, 404);
    assert.equal((await f.call(start, { method: 'POST' })).status, 403);
    assert.equal((await f.call(login, { method: 'POST' })).status, 403);
    assert.equal(f.upstreamCalls(), 1);
  } finally { await f.close(); }
  for (const cloud of ['', 'prusa-connect,creality-cloud']) {
    const disabled = await fixture({ ORCA_PRINTER_CLOUD: cloud });
    try {
      assert.equal((await disabled.call(bambuLogin, { method: 'POST' })).status, 403);
      assert.equal(disabled.upstreamCalls(), 0);
    } finally { await disabled.close(); }
  }
});

test('printer cloud opt-in fails closed per service and requires origin and packaged bridge', async () => {
  for (const env of [{}, { ORCA_PRINTER_CLOUD: 'unknown-cloud' }, { ORCA_PRINTER_CLOUD: 'prusa-connect' }, { ORCA_PRINTER_CLOUD: 'creality-cloud' }]) {
    const f = await fixture(env);
    try {
      if (!env.ORCA_PRINTER_CLOUD || env.ORCA_PRINTER_CLOUD === 'unknown-cloud') {
        assert.equal((await f.call(start, { method: 'POST' })).status, 403);
        assert.equal((await f.call('/_printer/status')).status, 403);
      } else if (env.ORCA_PRINTER_CLOUD === 'prusa-connect') {
        assert.equal((await f.call(login, { method: 'POST' })).status, 403);
      } else assert.equal((await f.call(start, { method: 'POST' })).status, 403);
      assert.equal(f.upstreamCalls(), 0);
    } finally { await f.close(); }
  }
  for (const cloud of ['prusa-connect', 'bambu-cloud']) {
    for (const env of [{}, { ORCA_PUBLIC_ORIGIN: '' }, { ORCA_PUBLIC_ORIGIN: origin + '/path' }]) {
      const f = await fixture({ ORCA_PRINTER_CLOUD: cloud, ...env }, false);
      try {
        assert.equal(f.listening, false);
        assert.match(f.stderr(), /canonical ORCA_PUBLIC_ORIGIN|packaged printer-cloud-bridge/);
      } finally { await f.close(); }
    }
  }
});

test('production packaging requires the restricted printer cloud bundle', () => {
  assert.match(readFileSync(path.join(app, 'vite.config.ts'), 'utf8'), /outfile: path.join\(distDir, 'printer-cloud-bridge.mjs'\)/);
  assert.match(readFileSync(new URL('../../deploy/Dockerfile', import.meta.url), 'utf8'), /'printer-cloud-bridge.mjs'/);
});

test('packaged automatic Prusa auth routes enforce pending state, cancellation and origin', async () => {
  const f = await fixture({ ORCA_PRINTER_CLOUD: 'prusa-connect' });
  try {
    const pending = (await f.call(start, { method: 'POST' })).json();
    for (const route of ['password', 'otp', 'cancel']) {
      const target = `/_printer/prusa-connect/auth/${route}`;
      assert.equal((await f.call(target, { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } })).status, 403);
      assert.equal((await f.call(target, { method: 'POST', body: '{}' })).status, 400);
    }
    const body = JSON.stringify({ state: pending.state });
    assert.equal((await f.call('/_printer/prusa-connect/auth/cancel', { method: 'POST', body })).status, 200);
    assert.equal((await f.call('/_printer/prusa-connect/auth/password', { method: 'POST', body })).status, 400);
    assert.equal(f.upstreamCalls(), 0);
  } finally { await f.close(); }
});

test('hosted Snapmaker opt-in reaches packaged gateway with origin and destination barriers', async () => {
  const f = await fixture({ ORCA_PRINTER_CLOUD: 'snapmaker-cloud' }, true, false, true);
  try {
    assert.equal(f.listening, true);
    const response = await f.call(snapmakerLogin, { method: 'POST', body: '{"email":"synthetic@example.invalid","password":"synthetic-fixture-only"}', headers: { 'Content-Type': 'application/json', Cookie: 'ambient=synthetic', Authorization: 'Bearer ambient' } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json(), { code: 200, data: { access_token: 'synthetic', refresh_token: 'synthetic-refresh' } });
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.headers.location, undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.deepEqual((await f.call('/_printer/status')).json().cloud, ['snapmaker-cloud']);
    assert.equal((await f.call('/_orca-cloud/status')).status, 403);
    for (const headers of [{ Origin: 'https://external.invalid' }, { Host: 'server-1.barbel-hops.ts.net:5071' }, { Origin: undefined }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await f.call(snapmakerLogin, { method: 'POST', headers })).status, 403);
    }
    for (const route of [snapmakerLogin + '?host=external.invalid', '/_printer/snapmaker-cloud/auth/%74oken', '/_printer/snapmaker-cloud/auth/../auth/token', '/_printer/snapmaker-cloud/control', '/_printer/snapmaker-cloud/user/device/bind']) {
      assert.equal((await f.call(route, { method: 'POST' })).status, 403);
    }
    for (const route of [start, login]) assert.equal((await f.call(route, { method: 'POST' })).status, 403);
    for (const route of ['/_printer/http/127.0.0.1/api', '/_printer/discover', '/_printer/ws/127.0.0.1/', '/_printer/bambu-cloud/mqtt/example', '/_gw/status']) {
      assert.equal((await f.call(route, { method: 'POST' })).status, 404);
    }
    assert.equal(f.upstreamCalls(), 1);
  } finally { await f.close(); }
  for (const cloud of ['', 'prusa-connect,creality-cloud,bambu-cloud']) {
    const disabled = await fixture({ ORCA_PRINTER_CLOUD: cloud });
    try {
      assert.equal((await disabled.call(snapmakerLogin, { method: 'POST' })).status, 403);
      assert.equal(disabled.upstreamCalls(), 0);
    } finally { await disabled.close(); }
  }
  for (const env of [{ ORCA_PUBLIC_ORIGIN: '' }, { ORCA_PUBLIC_ORIGIN: origin + '/path' }, {}]) {
    const missing = await fixture({ ORCA_PRINTER_CLOUD: 'snapmaker-cloud', ...env }, false);
    try {
      assert.equal(missing.listening, false);
      assert.match(missing.stderr(), /canonical ORCA_PUBLIC_ORIGIN|packaged printer-cloud-bridge/);
    } finally { await missing.close(); }
  }
});
