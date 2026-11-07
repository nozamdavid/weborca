import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import http from 'node:http';
import { createOrcaCloudBridge, apiPath, callbackUrl, PUBLIC_KEY } from '../../app/gateway/orcaCloud.ts';
import { cloudHosts, resolveTarget, httpAllowedInReadOnly } from '../../app/gateway/policy.ts';
import { createGateway } from '../../app/printerGateway.ts';
import { listen, close } from './lib/gatewayHarness.mjs';
import { createOrcaCloudClient } from '../../app/src/orcaCloud/client.ts';
const origin = 'https://slicer.example';
const identity = { origin, credential: randomBytes(32).toString("hex") };
const callback = `${origin}/orca-cloud/callback`;
const tokens = (account = 'alice', expires = 3600, suffix = '') => new Response(JSON.stringify({ access_token: `access${suffix}`, refresh_token: `refresh${suffix}`, expires_in: expires, user: { id: account } }));

// Exercise the shared backend handlers without the removed standalone gateway program.
async function startTestGateway(options) {
  const bridge = createOrcaCloudBridge({ ...options.orcaCloud, enabled: true });
  const printers = createGateway(options);
  const server = http.createServer(async (req, res) => {
    const caller = req.headers.origin;
    if (!options.allowedOrigins.includes(caller)) { res.statusCode = 403; res.end(); return; }
    if (await bridge.handle(req, res, caller)) return;
    if (await printers.handleRequest(req, res)) return;
    res.statusCode = 404; res.end();
  });
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${port}`, close: () => { server.closeAllConnections(); return close(server); } };
}
test('same-Origin browser identities isolate OAuth, API and logout; shared tabs serialize refresh', async () => {
  let refreshes = 0, apiCalls = 0;
  let logoutUrl;
  const gateway = await startTestGateway({ allowedOrigins: [origin, 'https://other.example'], proxy: '', cloud: 'orca-cloud', orcaCloud: {
    callback, presetWrites: true, fetch: async url => {
      if (String(url).includes('pkce')) return tokens('alice', 1);
      if (String(url).includes('refresh_token')) {
        refreshes++; await new Promise(resolve => setTimeout(resolve, 5)); return tokens('alice', 3600, '-rotated');
      }
      if (String(url).includes('logout')) {
        logoutUrl = String(url);
        return new Response(null, { status: 204 });
      }
      apiCalls++; return new Response(null, { status: 304 });
    }
  } });
  const a = randomBytes(32).toString('hex'), b = randomBytes(32).toString('hex');
  const call = (secret, path, body, appOrigin = origin) => fetch(`${gateway.origin}/_orca-cloud/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: appOrigin, 'x-orca-cloud': '1',
      ...(secret === undefined ? {} : { 'x-orca-cloud-session': secret }), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  try {
    const flow = await (await call(a, 'begin', { provider: 'google' })).json();
    const returned = new URL(new URL(flow.url).searchParams.get('redirect_to')); returned.searchParams.set('code', 'private-code');
    assert.equal((await call(b, 'complete', { callbackUrl: returned.href })).status, 400);
    assert.equal((await call(a, 'complete', { callbackUrl: returned.href })).status, 200);
    assert.equal((await (await call(b, 'status')).json()).accountId, null);
    assert.equal((await call(b, 'complete', { callbackUrl: returned.href })).status, 400);
    const api = { accountId: 'alice', method: 'GET', path: '/api/v1/sync/pull' };
    assert.equal((await call(b, 'api', api)).status, 401);
    assert.equal((await call(b, 'api', { ...api, method: 'POST', path: '/api/v1/sync/push', body: { id: 'id', name: 'name', content: { type: 'print' } } })).status, 401);
    const bFlow = await (await call(b, 'begin', { provider: 'google' })).json();
    const bReturned = new URL(new URL(bFlow.url).searchParams.get('redirect_to')); bReturned.searchParams.set('code', 'private-b-code');
    assert.equal((await call(b, 'complete', { callbackUrl: bReturned.href })).status, 200);
    await call(b, 'logout', {});
    assert.equal(logoutUrl, 'https://auth.orcaslicer.com/auth/v1/logout?scope=local');
    assert.equal((await (await call(a, 'status')).json()).accountId, 'alice');
    assert.equal((await (await call(a, 'status', undefined, 'https://other.example')).json()).accountId, null);
    assert.deepEqual((await Promise.all([call(a, 'api', api), call(a, 'api', api)])).map(r => r.status), [200, 200]);
    assert.equal(refreshes, 1); assert.equal(apiCalls, 2);
    assert.equal((await call(a, 'api', { ...api, accountId: 'bob' })).status, 401);
    assert.equal((await call(a, 'complete', { callbackUrl: returned.href })).status, 400);
    for (const secret of [undefined, '', 'short', 'g'.repeat(64)]) assert.equal((await call(secret, 'status')).status, 401);
    const status = JSON.stringify(await (await call(a, 'status')).json());
    assert.ok(!status.includes(a) && !status.includes('access') && !status.includes('refresh'));
  } finally { await gateway.close(); }
});
async function login(bridge, provider = 'google') {
  const begin = await bridge.begin(identity, provider);
  const redirect = new URL(new URL(begin.url).searchParams.get('redirect_to'));
  redirect.searchParams.set('code', 'private-code');
  await bridge.complete(identity, redirect.href);
  return redirect.href;
}

test('browser client initializes concurrent tabs safely, persists reloads and separates profiles', async () => {
  const profile = () => {
    const values = new Map();
    let queue = Promise.resolve();
    return { crypto: webcrypto, storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); }
    }, locks: { request: (_key, work) => {
      const result = queue.then(async () => { await new Promise(resolve => setTimeout(resolve, 1)); return work(); });
      queue = result.then(() => {}, () => {}); return result;
    } } };
  };
  const gateway = await startTestGateway({ allowedOrigins: [origin], proxy: '', cloud: 'orca-cloud', orcaCloud: { callback, fetch: async () => tokens() } });
  const request = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
  const environment = profile();
  const tab = () => createOrcaCloudClient(gateway.origin, request, environment);
  try {
    const a = tab(), otherTab = tab();
    await Promise.all([a.status(), otherTab.status()]);
    const flow = await a.begin('google');
    assert.equal((await otherTab.status()).pending, true);
    const returned = new URL(new URL(flow.url).searchParams.get('redirect_to')); returned.searchParams.set('code', 'private-code');
    await otherTab.complete(returned.href);
    assert.equal((await a.status()).accountId, 'alice');
    assert.equal((await tab().status()).accountId, 'alice'); // New client after reload.
    const separate = createOrcaCloudClient(gateway.origin, request, profile());
    assert.equal((await separate.status()).accountId, null);
    await separate.logout();
    assert.equal((await a.status()).accountId, 'alice');
    await a.logout();
    assert.equal((await otherTab.status()).accountId, null);
    await assert.rejects(createOrcaCloudClient(gateway.origin, request, { ...environment, locks: undefined }).status(), /Web Locks/);
    await assert.rejects(createOrcaCloudClient(gateway.origin, request, { ...environment, storage: { getItem() { throw new Error('storage denied'); } } }).status(), /browser storage/);
  } finally { await gateway.close(); }
});

test('official provider URL, S256, exact callback, expiring one-use state; no tokens exposed', async () => {
  let clock = 1000;
  const calls = [];
  const bridge = createOrcaCloudBridge({ enabled: true, callback, now: () => clock, fetch: async (url, init) => { calls.push({ url: String(url), init }); return tokens(); } });
  assert.equal(bridge.status(identity).setup, 'callback-allowlist-unverified');
  for (const provider of ['google', 'apple', 'github']) {
    const begin = await bridge.begin(identity, provider);
    const auth = new URL(begin.url);
    assert.equal(auth.origin, 'https://auth.orcaslicer.com');
    assert.equal(auth.pathname, '/auth/v1/authorize');
    assert.equal(auth.searchParams.get('provider'), provider);
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    const returned = new URL(auth.searchParams.get('redirect_to'));
    assert.match(returned.searchParams.get('orca_state'), /^[a-f0-9]{32}$/);
    returned.searchParams.set('code', 'private-code');
    const wrong = new URL(returned); wrong.pathname = '/wrong';
    await assert.rejects(bridge.complete(identity, wrong.href), /does not match/);
    const wrongState = new URL(returned); wrongState.searchParams.set('orca_state', 'wrong');
    await assert.rejects(bridge.complete(identity, wrongState.href), /does not match/);
    const status = provider === 'google' ? await bridge.completeLoopback(returned.href) : await bridge.complete(identity, returned.href);
    assert.equal(status.accountId, 'alice');
    assert.ok(!JSON.stringify(status).includes('access'));
    const call = calls.at(-1);
    assert.equal(call.url, 'https://auth.orcaslicer.com/auth/v1/token?grant_type=pkce');
    assert.equal(call.init.headers.apikey, PUBLIC_KEY);
    assert.equal(call.init.headers.Authorization, undefined);
    assert.equal(call.init.redirect, 'error');
    const body = JSON.parse(call.init.body);
    assert.match(body.code_verifier, /^[\w-]{43}$/);
    assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), auth.searchParams.get('code_challenge'));
    await assert.rejects(bridge.complete(identity, returned.href), /does not match/);
    await assert.rejects(bridge.completeLoopback(returned.href), /No pending/);
    await bridge.logout(identity);
  }
  const begin = await bridge.begin(identity, 'google');
  const expired = new URL(new URL(begin.url).searchParams.get('redirect_to')); expired.searchParams.set('code', 'expired');
  const before = calls.length; clock += 300001;
  await assert.rejects(bridge.complete(identity, expired.href), /unexpired/);
  assert.equal(calls.length, before);
  await assert.rejects(bridge.begin(identity, 'password'), /Unsupported/);
  assert.throws(() => callbackUrl('http://evil.example/callback'));
  assert.throws(() => callbackUrl(`${callback}?foo=1`));
});

test('serialized rotation across callers; transient refresh retains session, rejection clears it', async () => {
  let mode = 'ok', refreshes = 0;
  const calls = [];
  const bridge = createOrcaCloudBridge({ enabled: true, callback, fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('grant_type=pkce')) return tokens('alice', 1);
    if (String(url).includes('grant_type=refresh_token')) {
      refreshes++;
      assert.equal(JSON.parse(init.body).refresh_token, 'refresh');
      if (mode === 'network') throw new Error('private-token');
      if (mode === 'transient') return new Response('', { status: 503 });
      if (mode === 'reject') return new Response('', { status: 400 });
      await new Promise(resolve => setTimeout(resolve, 5)); return tokens('alice', 3600, '-rotated');
    }
    assert.equal(init.headers.apikey, undefined);
    assert.equal(init.headers.Authorization, 'Bearer access-rotated');
    return new Response(null, { status: 304 });
  } });
  await login(bridge);
  mode = 'network'; await assert.rejects(bridge.api(identity, 'alice', 'GET', '/api/v1/sync/pull'), /temporarily/);
  assert.equal(bridge.status(identity).accountId, 'alice');
  mode = 'transient'; await assert.rejects(bridge.api(identity, 'alice', 'GET', '/api/v1/sync/pull'), /temporarily/);
  assert.equal(bridge.status(identity).accountId, 'alice');
  mode = 'ok';
  await Promise.all([bridge.api(identity, 'alice', 'GET', '/api/v1/sync/pull'), bridge.api(identity, 'alice', 'GET', '/api/v1/sync/pull?cursor=9')]);
  assert.equal(refreshes, 3); // only one successful rotation for concurrent calls
  await assert.rejects(bridge.api(identity, 'bob', 'GET', '/api/v1/sync/pull'), /account changed/);
  await bridge.logout(identity);
  await login(bridge); mode = 'reject';
  await assert.rejects(bridge.api(identity, 'alice', 'GET', '/api/v1/sync/pull'), /expired/);
  assert.equal(bridge.status(identity).accountId, null);
});

test('API 401 retries once using rotated tokens; logout clears locally during network failure', async () => {
  let apiCalls = 0, refreshes = 0;
  const bridge = createOrcaCloudBridge({ enabled: true, callback, fetch: async (url) => {
    if (String(url).includes('pkce')) return tokens();
    if (String(url).includes('refresh_token')) { refreshes++; return tokens('alice', 3600, '2'); }
    if (String(url).includes('logout')) throw new Error('secret');
    return new Response(null, { status: ++apiCalls === 1 ? 401 : 304 });
  } });
  await login(bridge);
  assert.equal((await bridge.api(identity, 'alice', 'GET', '/api/v1/sync/pull')).status, 304);
  assert.equal(refreshes, 1); assert.equal(apiCalls, 2);
  await bridge.logout(identity); assert.equal(bridge.status(identity).accountId, null);
});

test('fixed destinations, methods, queries, credential exclusion, 1 MiB and independent writes', async () => {
  for (const [method, path] of [
    ['GET', 'https://evil.example/api/v1/sync/pull'], ['GET', '//evil.example/api/v1/sync/pull'],
    ['GET', '/api/v1/printers'], ['POST', '/api/v1/sync/pull'], ['GET', '/api/v1/sync/pull?cursor=1&cursor=2'],
    ['GET', '/api/v1/sync/pull?url=https://evil.example'], ['GET', '/api/v1/sync/pull#bad'],
    ['DELETE', '/api/v1/sync/delete?resource=printers&id=x'], ['POST', '/api/v1/sync/force-push?force=true']
  ]) assert.throws(() => apiPath(method, path, true));
  assert.throws(() => apiPath('POST', '/api/v1/sync/push', false));
  const calls = [];
  const bridge = createOrcaCloudBridge({ enabled: true, callback, presetWrites: true, fetch: async (url, init) => {
    calls.push(String(url)); return String(url).includes('pkce') ? tokens() : new Response('{"updated_time":2}');
  } });
  await login(bridge);
  const body = { id: 'id', name: 'name', content: { type: 'printer', value: 'x'.repeat(1_048_576) } };
  await assert.rejects(bridge.api(identity, 'alice', 'POST', '/api/v1/sync/push', body), /1 MiB/);
  await assert.rejects(bridge.api(identity, 'alice', 'POST', '/api/v1/sync/push', { ...body, content: { type: 'printer', access_code: 'secret' } }), /credential/);
  await assert.rejects(bridge.api(identity, 'alice', 'POST', '/api/v1/sync/push', { ...body, content: { type: 'printer', print_host_webui: 'http://user:pass@192.168.1.100' } }), /credential/);
  assert.equal(calls.length, 1);
  await bridge.api(identity, 'alice', 'POST', '/api/v1/sync/push', { ...body, content: { type: 'print', layer_height: '0.2' } });
  await bridge.api(identity, 'alice', 'POST', '/api/v1/sync/push', { ...body, content: { type: 'printer', print_host: 'http://192.168.1.100', print_host_webui: 'http://192.168.1.100/ui', host_type: 'flashforge' } });
  assert.equal(calls.at(-1), 'https://api.orcaslicer.com/api/v1/sync/push');
  assert.equal(cloudHosts({ cloud: 'orca-cloud' }).size, 0);
  await assert.rejects(resolveTarget('api.orcaslicer.com', 443, { cloud: 'orca-cloud' }, async () => ['203.0.113.1']));
  assert.equal(httpAllowedInReadOnly('POST', '/printer/print/start'), false);
});

test('backend opt-in routes enforce Origin/header and expose no generic cloud proxy', async () => {
  const gateway = await startTestGateway({ allowedOrigins: [origin], proxy: '', readOnly: true, cloud: 'orca-cloud', orcaCloud: { callback, presetWrites: true, fetch: async () => { throw new Error('unexpected traffic'); } } });
  try {
    const request = (path, headers = {}) => fetch(`${gateway.origin}${path}`, { headers: { Origin: origin, "x-orca-cloud-session": identity.credential, ...headers } });
    assert.equal((await request('/_orca-cloud/status')).status, 403);
    const status = await request('/_orca-cloud/status', { 'x-orca-cloud': '1' });
    assert.equal(status.status, 200); assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.equal((await status.json()).presetWrites, true);
    assert.equal((await fetch(`${gateway.origin}/_orca-cloud/status`, { headers: { Origin: 'https://evil.example', 'x-orca-cloud': '1' } })).status, 403);
    const printer = await request('/_printer/status'); assert.equal((await printer.json()).readOnly, true);
    const refused = await request('/_orca-cloud/status?destination=evil', { 'x-orca-cloud': '1' }); assert.equal(refused.status, 404);
  } finally { await gateway.close(); }
});
