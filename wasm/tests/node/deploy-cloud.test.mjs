import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
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
const origin = 'https://weborca.noz.am:5070';
const secret = 'a'.repeat(64);
const other = 'b'.repeat(64);

async function fixture(env = {}, bundle = true) {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-hosted-cloud-'));
  writeFileSync(path.join(root, 'index.html'), '<title>static spa</title>');
  if (bundle) buildSync({ entryPoints: [path.join(app, 'gateway/orcaCloud.ts')], outfile: path.join(root, 'orca-cloud-bridge.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20' });
  // No external traffic: the child uses this mock for every upstream request.
  const mock = `
    let exchanges = 0, refreshes = 0;
    globalThis.fetch = async (value, init) => {
      const url = String(value);
      const body = init.body && JSON.parse(init.body);
      if (url === 'https://auth.orcaslicer.com/auth/v1/token?grant_type=pkce') {
        if (body.auth_code !== 'mock-code' || !/^[\\w-]{43}$/.test(body.code_verifier) || init.headers.Authorization) throw Error('invalid exchange');
        exchanges++;
        return Response.json({ access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 1, user: { id: 'mock-account' } });
      }
      if (url === 'https://auth.orcaslicer.com/auth/v1/token?grant_type=refresh_token') {
        if (body.refresh_token !== 'mock-refresh' || ++refreshes !== 1) throw Error('invalid rotation');
        return Response.json({ access_token: 'mock-rotated', refresh_token: 'mock-refresh-rotated', expires_in: 3600, user: { id: 'mock-account' } });
      }
      if (url === 'https://api.orcaslicer.com/api/v1/sync/pull' && init.method === 'GET' && init.headers.Authorization === 'Bearer mock-rotated') {
        return Response.json({ exchanges, refreshes, upserts: [], deleted: [] });
      }
      throw Error('Unexpected upstream request');
    };`;
  const port = await new Promise(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mock)}`, server], {
    env: { PATH: process.env.PATH, PORT: String(port), ORCA_BIND: '127.0.0.1', ORCA_ROOT: root, ORCA_PUBLIC_ORIGIN: origin, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  const ready = new Promise(resolve => {
    child.stdout.on('data', data => { if (String(data).includes('listening')) resolve(true); });
    child.once('exit', () => resolve(false));
  });
  const listening = await ready;
  return {
    listening, stderr: () => stderr,
    call(route, { method = 'GET', body, headers = {} } = {}) {
      return new Promise((resolve, reject) => {
        const requestHeaders = {
          Host: 'weborca.noz.am:5070', Origin: origin, 'x-orca-cloud': '1', 'x-orca-cloud-session': secret, ...headers
        };
        for (const key of Object.keys(requestHeaders)) if (requestHeaders[key] === undefined) delete requestHeaders[key];
        const req = http.request({ host: '127.0.0.1', port, path: route, method, headers: requestHeaders }, res => {
          let text = '';
          res.on('data', data => { text += data; });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
        });
        req.on('error', reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    },
    async close() { if (listening) child.kill('SIGTERM'); await exited; rmSync(root, { recursive: true, force: true }); }
  };
}

test('hosted cloud requires opt-in and a packaged bundle; static routes retain their behavior', async () => {
  const disabled = await fixture({}, false);
  try {
    for (const method of ['GET', 'POST', 'HEAD']) {
      const response = await disabled.call('/_orca-cloud/status', { method });
      assert.equal(response.status, 403);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    assert.equal((await disabled.call('/_orca-cloud/unknown')).status, 403);
    assert.match((await disabled.call('/settings-page')).text, /static spa/);
    assert.equal((await disabled.call('/settings-page', { method: 'POST' })).status, 405);
    assert.equal((await disabled.call('/healthz', { headers: { Host: 'evil.example' } })).status, 421);
  } finally { await disabled.close(); }
  for (const env of [{ ORCA_CLOUD_ENABLED: '1' }, { ORCA_CLOUD_ENABLED: '1', ORCA_PUBLIC_ORIGIN: 'https://weborca.noz.am/path' }]) {
    const missing = await fixture(env, false);
    try {
      assert.equal(missing.listening, false);
      assert.match(missing.stderr(), /packaged orca-cloud-bridge|canonical ORCA_PUBLIC_ORIGIN/);
    } finally { await missing.close(); }
  }
});

test('hosted native callback flow validates callers, isolates sessions and refreshes using mocked upstream only', async () => {
  const f = await fixture({ ORCA_CLOUD_ENABLED: '1' });
  const post = (route, body, headers) => f.call(`/_orca-cloud/${route}`, { method: 'POST', body, headers });
  try {
    const status = await f.call('/_orca-cloud/status');
    assert.equal(status.status, 200);
    assert.equal(status.json().callback, 'http://localhost:41172/callback');
    assert.equal(status.json().callbackConfirmed, false);
    assert.equal(status.json().presetWrites, false);
    assert.equal(status.headers['cache-control'], 'no-store');
    assert.equal(status.headers['cross-origin-embedder-policy'], 'require-corp');
    for (const headers of [
      { Origin: 'https://evil.example' }, { 'x-orca-cloud': '' }, { 'x-orca-cloud-session': '' },
      { Origin: '', 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'cross-site' },
      { Host: 'localhost' }, { Host: 'weborca.noz.am:5071' }
    ]) assert.ok([401, 403].includes((await f.call('/_orca-cloud/status', { headers })).status));
    const nativeGet = { Origin: undefined, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };
    assert.equal((await f.call('/_orca-cloud/status', { headers: nativeGet })).status, 200);
    assert.equal((await f.call('/_orca-cloud/status', { headers: { Origin: undefined } })).status, 403);
    assert.equal((await f.call('/_orca-cloud/status', { headers: { ...nativeGet, 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await f.call('/_orca-cloud/status', { headers: { ...nativeGet, 'sec-fetch-mode': 'navigate' } })).status, 403);
    assert.equal((await post('begin', { provider: 'google' }, nativeGet)).status, 403);
    assert.equal((await f.call('/_orca-cloud/unknown')).status, 404);
    assert.equal((await f.call('/orca-cloud-bridge.mjs')).status, 404);
    const begin = await post('begin', { provider: 'google' });
    assert.equal(begin.status, 200);
    const authorize = new URL(begin.json().url);
    assert.equal(authorize.origin, 'https://auth.orcaslicer.com');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    const returned = new URL(authorize.searchParams.get('redirect_to'));
    assert.equal(returned.origin + returned.pathname, 'http://localhost:41172/callback');
    assert.match(returned.searchParams.get('orca_state'), /^[a-f0-9]{32}$/);
    returned.searchParams.set('code', 'mock-code');
    const bad = [returned.href.replace('localhost', '127.0.0.1'), returned.href + '&state=duplicate', returned.href + '&code=duplicate', returned.href + '#fragment', 'malformed'];
    for (const callbackUrl of bad) assert.equal((await post('complete', { callbackUrl })).status, 400);
    assert.equal((await post('complete', { callbackUrl: returned.href }, { 'x-orca-cloud-session': other })).status, 400);
    const complete = await post('complete', { callbackUrl: returned.href });
    assert.equal(complete.status, 200);
    assert.equal(complete.json().accountId, 'mock-account');
    assert.ok(!/mock-access|mock-refresh|code_verifier/.test(complete.text));
    assert.equal((await post('complete', { callbackUrl: returned.href })).status, 400);
    const api = { accountId: 'mock-account', method: 'GET', path: '/api/v1/sync/pull' };
    assert.equal((await post('api', api, { 'x-orca-cloud-session': other })).status, 401);
    const pulls = await Promise.all([post('api', api), post('api', api)]);
    for (const pull of pulls) {
      assert.equal(pull.status, 200);
      assert.deepEqual(pull.json().data, { exchanges: 1, refreshes: 1, upserts: [], deleted: [] });
    }
    assert.equal((await post('api', { ...api, method: 'POST', path: '/api/v1/sync/push' })).status, 403);
    assert.ok(!f.stderr());
  } finally { await f.close(); }
});

test('production packaging requires the restricted standalone cloud bundle', () => {
  assert.match(readFileSync(path.join(app, 'vite.config.ts'), 'utf8'), /outfile: path.join\(distDir, 'orca-cloud-bridge.mjs'\)/);
  assert.match(readFileSync(new URL('../../deploy/Dockerfile', import.meta.url), 'utf8'), /'orca-cloud-bridge.mjs'/);
});
