import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { close, listen } from './lib/gatewayHarness.mjs';
import {
  newPKCE,
  buildAuthorizeUrl,
  codeFromCallback,
  parseJwtExpiry,
  isTrustedPrusaHost,
  validateConnectRoute,
  DEFAULT_PRUSA_CLIENT_ID,
  DEFAULT_PRUSA_REDIRECT_URI,
  DEFAULT_PRUSA_GRAPHQL_URL,
  handlePrusaConnectRequest
} from '../../app/gateway/prusaConnect.ts';

// Helper to make an HTTP request to gateway
function request(port, method, path, headers = {}, body = undefined) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const resBody = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: resBody,
            text: resBody.toString('utf8'),
            json: () => JSON.parse(resBody.toString('utf8'))
          });
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (body) {
      if (Buffer.isBuffer(body)) req.write(body);
      else req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

const materialPrinterId = '11111111-1111-4111-8111-111111111111';
const materialOrganizationId = '22222222-2222-4222-8222-222222222222';
const materialPath = `/_printer/prusa-connect/app/printers/${materialPrinterId}/materials`;
const materialResponse = (tools = []) => ({ data: { printer: { printer: {
  __typename: 'Printer', id: materialPrinterId, fff: { hasMmuEnabled: false, tools }
} } } });

async function materialsGateway(t, override = () => false) {
  const calls = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const call = { path: req.url, method: req.method, headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8') };
    calls.push(call);
    res.setHeader('content-type', 'application/json');
    if (override(call, res, calls)) return;
    if (req.url === '/app/printers') return res.end(JSON.stringify({ printers: [{ uuid: materialPrinterId, team_id: 7 }] }));
    if (req.url === '/app/users/teams/7') return res.end(JSON.stringify({ organization_id: materialOrganizationId }));
    if (req.url === '/fixed/graphql?configured=1') return res.end(JSON.stringify(materialResponse()));
    if (req.url === '/o/token/') return res.end(JSON.stringify({ access_token: 'rotated', refresh_token: 'next' }));
    res.statusCode = 404;
    res.end('{}');
  });
  const upstreamPort = await listen(upstream);
  const base = `http://127.0.0.1:${upstreamPort}`;
  let finish;
  const handled = new Promise(resolve => { finish = resolve; });
  let disconnect;
  const disconnected = new Promise(resolve => { disconnect = resolve; });
  const gateway = http.createServer((req, res) => {
    res.once('close', () => disconnect());
    return handlePrusaConnectRequest(req, res, req.url, {
      cloud: 'prusa-connect', prusaConnect: { accountUrl: base, connectUrl: base,
        graphqlUrl: `${base}/fixed/graphql?configured=1` }
    }).finally(() => finish());
  });
  const port = await listen(gateway);
  t.after(async () => { await close(gateway); await close(upstream); });
  return { calls, port, handled, disconnected, read: (headers = {}) => request(port, 'GET', materialPath, { authorization: 'Bearer original', ...headers }),
    request: (method, path, headers, body) => request(port, method, path, headers, body) };
}

test('fixed materials query derives membership and honors the complete configured GraphQL endpoint', async t => {
  const g = await materialsGateway(t);
  const response = await g.read();
  assert.equal(DEFAULT_PRUSA_GRAPHQL_URL, 'https://connect-api.prusa3d.com/graphql');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), { tools: [] });
  assert.deepEqual(g.calls.map(c => c.path), ['/app/printers', '/app/users/teams/7', '/fixed/graphql?configured=1']);
  const gql = g.calls[2];
  const body = JSON.parse(gql.body);
  assert.deepEqual(Object.keys(body).sort(), ['query', 'variables']);
  assert.deepEqual(body.variables, { organizationId: materialOrganizationId, printerId: materialPrinterId });
  assert.match(body.query, /^query GetPrinterFffTelemetry\(/);
  assert.match(body.query, /type \{ abbreviation \}/);
  assert.doesNotMatch(body.query, /mutation|warehouse|withMaterialDetails|weight/i);
  assert.equal(gql.headers['graphql-client-name'], 'connect-web');
  assert.equal(gql.headers.authorization, 'Bearer original');
  assert.equal(gql.headers.origin, undefined);
  assert.equal(gql.headers.cookie, undefined);
});

test('materials refuses browser query, body, methods, noncanonical and encoded paths; arbitrary GraphQL disabled', async t => {
  const g = await materialsGateway(t);
  for (const [method, path, headers, body] of [
    ['GET', `${materialPath}?organizationId=${materialOrganizationId}`],
    ['GET', `${materialPath}?`], ['GET', `${materialPath}?query=mutation&query=other`],
    ['GET', materialPath, { 'content-length': '2' }, '{}'],
    ['POST', materialPath, {}, '{"query":"mutation{}"}'], ['HEAD', materialPath],
    ['PUT', materialPath], ['DELETE', materialPath],
    ['GET', materialPath.replace('11111111-', '%31' + '1111111-')],
    ['GET', materialPath.replace('/app/', '//app/')],
    ['GET', materialPath.replace('/materials', '/%6daterials')],
    ['GET', materialPath.replace(materialPrinterId, 'not-a-uuid')],
    ['POST', '/_printer/prusa-connect/graphql', {}, '{"query":"mutation{}"}']
  ]) {
    const response = await g.request(method, path, { authorization: 'Bearer original', ...headers }, body);
    assert.ok(response.statusCode >= 400, `${method} ${path}`);
  }
  assert.equal((await g.request('GET', materialPath)).statusCode, 401);
  assert.equal(validateConnectRoute('POST', '/graphql').allowed, false);
  assert.deepEqual(g.calls, []);
});

test('materials refuses absent, duplicate or malformed membership and invalid organization before GraphQL', async t => {
  for (const value of [{}, { printers: [] }, { printers: [{ uuid: materialOrganizationId, team_id: 7 }] },
    { printers: [{ uuid: materialPrinterId, team_id: '7' }] },
    { printers: [{ uuid: materialPrinterId, team_id: 7 }, { uuid: materialPrinterId, team_id: 7 }] },
    { printers: [null] }, { organization_id: 'bad' }]) {
    const teamCase = 'organization_id' in value;
    const g = await materialsGateway(t, (call, res) => {
      if (call.path !== (teamCase ? '/app/users/teams/7' : '/app/printers')) return false;
      res.end(JSON.stringify(value)); return true;
    });
    assert.equal((await g.read()).statusCode, 502);
    assert.ok(g.calls.every(call => !call.path.startsWith('/fixed/')));
  }
});

test('materials bounds upstream errors, redirects, oversized and malformed or wrong-printer GraphQL', async t => {
  for (const failure of ['error', 'redirect', 'oversized', 'json', 'wrong-id', 'union', 'graphql-errors', 'missing-tools']) {
    const g = await materialsGateway(t, (call, res) => {
      if (!call.path.startsWith('/fixed/')) return false;
      if (failure === 'error') { res.statusCode = 500; res.end('private account error'); }
      if (failure === 'redirect') { res.statusCode = 302; res.setHeader('location', '/private'); res.end(); }
      if (failure === 'oversized') res.end('x'.repeat(1024 * 1024 + 1));
      if (failure === 'json') res.end('private malformed JSON');
      const response = materialResponse();
      if (failure === 'wrong-id') { response.data.printer.printer.id = materialOrganizationId; res.end(JSON.stringify(response)); }
      if (failure === 'union') { response.data.printer.printer = { __typename: 'ConnectError', message: 'private account error' }; res.end(JSON.stringify(response)); }
      if (failure === 'graphql-errors') { response.errors = [{ message: 'private' }]; res.end(JSON.stringify(response)); }
      if (failure === 'missing-tools') { delete response.data.printer.printer.fff.tools; res.end(JSON.stringify(response)); }
      return true;
    });
    const response = await g.read();
    assert.equal(response.statusCode, 502, failure);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), { error: 'Prusa material assignments unavailable' });
    assert.equal(g.calls.length, 3);
  }
});

test('materials refresh once and rerun membership; preserve rotation on downstream failure', async t => {
  for (const downstream of ['ok', 'membership', 'unauthorized']) {
    const g = await materialsGateway(t, (call, res) => {
      if (call.path.startsWith('/fixed/') && (call.headers.authorization === 'Bearer original' || downstream === 'unauthorized')) {
        res.statusCode = 401; res.end('private'); return true;
      }
      if (downstream === 'membership' && call.path === '/app/printers' && call.headers.authorization === 'Bearer rotated') {
        res.end('{"printers":[]}'); return true;
      }
      return false;
    });
    const response = await g.read({ 'x-prusa-refresh-token': 'refresh' });
    assert.equal(response.statusCode, downstream === 'ok' ? 200 : downstream === 'unauthorized' ? 401 : 502);
    assert.equal(response.headers['x-prusa-access-token'], 'rotated');
    assert.equal(response.headers['x-prusa-refresh-token'], 'next');
    assert.equal(g.calls.filter(c => c.path === '/o/token/').length, 1);
    assert.equal(g.calls.filter(c => c.path === '/app/printers').length, 2);
    const afterRefresh = g.calls.slice(4);
    assert.equal(afterRefresh[0].path, '/app/printers');
    assert.ok(afterRefresh.every(c => c.headers.authorization === 'Bearer rotated'));
  }
});

test('materials stops upstream reads when the client disconnects during refresh', async t => {
  let releaseRefresh, refreshStarted;
  const refreshing = new Promise(resolve => { refreshStarted = resolve; });
  const g = await materialsGateway(t, (call, res) => {
    if (call.path === '/app/printers' && call.headers.authorization === 'Bearer original') {
      res.statusCode = 401; res.end('{}'); return true;
    }
    if (call.path === '/o/token/') {
      releaseRefresh = () => res.end(JSON.stringify({ access_token: 'rotated', refresh_token: 'next' }));
      refreshStarted(); return true;
    }
    return false;
  });
  const client = http.get({ hostname: '127.0.0.1', port: g.port, path: materialPath,
    headers: { authorization: 'Bearer original', 'x-prusa-refresh-token': 'refresh' } });
  client.on('error', () => {});
  t.after(() => client.destroy());
  await refreshing;
  const closed = new Promise(resolve => client.once('close', resolve));
  client.destroy();
  await closed;
  await g.disconnected;
  releaseRefresh();
  await g.handled;
  assert.deepEqual(g.calls.map(call => call.path), ['/app/printers', '/o/token/']);
});

test('materials deadline bounds a stalled response; malformed tool arrays cannot become complete inventory', async t => {
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    originalTimeout(callback, delay === 30_000 ? 10 : delay, ...args));
  const stalled = await materialsGateway(t, (call, res) => {
    if (!call.path.startsWith('/fixed/')) return false;
    // A partial response with no end must hit the total deadline.
    res.write('{'); return true;
  });
  assert.equal((await stalled.read()).statusCode, 502);
  t.mock.restoreAll();
  for (const tools of [[null], [{ id: '00', type: 'EXTRUDER' }],
    [{ id: '2', type: 'EXTRUDER' }, { id: '2', type: 'EXTRUDER' }],
    [{ id: '0.1', type: 'EXTRUDER' }], [{ id: '9007199254740991', type: 'EXTRUDER' }],
    [{ id: '2', type: 'EXTRUDER', materialPackageInstance: { __typename: 'FFFToolMaterialPackageInstance', package: [] } }]]) {
    const g = await materialsGateway(t, (call, res) => {
      if (!call.path.startsWith('/fixed/')) return false;
      res.end(JSON.stringify(materialResponse(tools))); return true;
    });
    assert.equal((await g.read()).statusCode, 502);
  }
});

test('materials normalizes known, empty, unknown union states and only strict alpha-last hex colors', async t => {
  const assigned = (id, colorRgba, overrides = {}) => ({ id, type: id.includes('.') ? 'FEEDER' : 'EXTRUDER',
    materialPackageInstance: { __typename: 'FFFToolMaterialPackageInstance', uuid: materialOrganizationId,
      package: { material: { uuid: materialOrganizationId, name: 'Galaxy', abbreviation: 'Product',
        type: { abbreviation: 'PLA' }, brand: { name: 'Prusament' }, primaryColor: { colorRgba } } } }, ...overrides });
  const tools = [assigned('0', ' #12345678 '), assigned('2', 'abcdef'), assigned('0.4', 'red'),
    assigned('3', '#12345'), assigned('4', '##abcdef'),
    assigned('5', '', { materialPackageInstance: { __typename: 'ToolMaterialPackageInstanceEmpty', reason: 'source reason' } }),
    assigned('6', '', { materialPackageInstance: { __typename: 'ToolMaterialPackageInstanceUnknown' } }),
    assigned('7', '', { materialPackageInstance: null }),
    assigned('8', '', { materialPackageInstance: { __typename: 'FutureUnion' } })];
  const g = await materialsGateway(t, (call, res) => {
    if (!call.path.startsWith('/fixed/')) return false;
    res.end(JSON.stringify(materialResponse(tools))); return true;
  });
  const response = await g.read();
  assert.equal(response.statusCode, 200);
  const result = response.json().tools;
  assert.deepEqual(result[0], { id: '0', type: 'EXTRUDER', presence: 'present', material: 'PLA',
    vendor: 'Prusament', subtype: 'Galaxy', color: '#12345678' });
  assert.equal(result[1].color, '#abcdef');
  assert.ok(result.slice(2).every(tool => tool.color === undefined));
  assert.deepEqual(result.slice(5).map(tool => tool.presence), ['empty', 'unknown', 'unknown', 'unknown']);
  assert.doesNotMatch(response.text, /package|uuid|organization|reason|Galaxy.*Product/);
});

describe('Prusa Connect Gateway Bridge & PKCE Security', () => {
  let mockAccountServer;
  let mockConnectServer;
  let accountPort;
  let connectPort;
  let accountUrl;
  let connectUrl;

  let gatewayServer;
  let gatewayPort;

  // Track upstream calls
  let accountTokenCalls = [];
  let connectCalls = [];

  // Helper fake JWT
  const makeFakeJwt = (sub, expSeconds) => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + expSeconds })).toString('base64url');
    return `${header}.${payload}.sig`;
  };

  before(async () => {
    // 1. Mock Prusa Account server
    mockAccountServer = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString('utf8');

      if (req.method === 'POST' && req.url === '/o/token/') {
        const params = new URLSearchParams(rawBody);
        const grantType = params.get('grant_type');
        accountTokenCalls.push({ grantType, params: Object.fromEntries(params.entries()) });

        if (grantType === 'authorization_code') {
          const code = params.get('code');
          const verifier = params.get('code_verifier');
          const clientId = params.get('client_id');

          if (clientId === 'invalid_client_id') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Client is invalid' }));
          }

          if (code === 'auth_code_123' && verifier) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              access_token: makeFakeJwt('user_123', 300),
              refresh_token: 'refresh_tok_initial',
              expires_in: 300
            }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Code invalid or expired' }));
          }
        }

        if (grantType === 'refresh_token') {
          const refreshToken = params.get('refresh_token');
          if (refreshToken === 'refresh_tok_initial' || refreshToken === 'refresh_tok_for_401') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              access_token: makeFakeJwt('user_123', 600),
              refresh_token: 'refresh_tok_rotated',
              expires_in: 600
            }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token revoked' }));
          }
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
      }

      res.writeHead(404);
      res.end();
    });
    accountPort = await listen(mockAccountServer);
    accountUrl = `http://127.0.0.1:${accountPort}`;

    // 2. Mock Prusa Connect server
    mockConnectServer = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const urlPath = (req.url || '').split('?')[0];
      const auth = req.headers['authorization'];

      connectCalls.push({
        method: req.method,
        url: req.url,
        path: urlPath,
        auth,
        headers: req.headers,
        body: rawBody
      });

      // GET /app/login (whoami)
      if (req.method === 'GET' && urlPath === '/app/login') {
        if (!auth || !auth.startsWith('Bearer ')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ code: 'UNAUTHORIZED' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          user: {
            public_name: 'maker_john',
            first_name: 'John',
            last_name: 'Maker',
            default_team_id: 42,
            teams: [{ id: 42, name: 'Main Workshop' }]
          }
        }));
      }

      // GET /app/printers
      if (req.method === 'GET' && urlPath === '/app/printers') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          printers: [
            {
              uuid: 'prusa-mk4-uuid-001',
              name: 'Original Prusa MK4',
              sn: 'CZPX0123456789',
              printer_type_name: 'MK4',
              connect_state: 'READY',
              printer_state: 'READY',
              team_id: 42
            }
          ]
        }));
      }

      // GET /app/printers/prusa-mk4-uuid-001
      if (req.method === 'GET' && urlPath === '/app/printers/prusa-mk4-uuid-001') {
        if (auth === 'Bearer expired_token') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ code: 'TOKEN_EXPIRED' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          uuid: 'prusa-mk4-uuid-001',
          name: 'Original Prusa MK4',
          printer_type_name: 'MK4',
          connect_state: 'PRINTING',
          temp: { temp_nozzle: 215.5, target_nozzle: 215.0, temp_bed: 60.1, target_bed: 60.0 },
          chamber: { temp: 35.0, target_temp: 35.0 },
          speed: 100,
          flow: 100,
          job_info: {
            display_name: 'benchy.gcode',
            progress: 45.5,
            time_printing: 1200,
            time_remaining: 1500
          }
        }));
      }

      // GET /app/printers/prusa-mk4-uuid-001/storages
      if (req.method === 'GET' && urlPath === '/app/printers/prusa-mk4-uuid-001/storages') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          storages: [
            { path: '/usb/', mountpoint: '/usb', type: 'USB', read_only: false, corrupted: false }
          ]
        }));
      }

      // GET /app/printers/prusa-mk4-uuid-001/cameras
      if (req.method === 'GET' && urlPath === '/app/printers/prusa-mk4-uuid-001/cameras') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          cameras: [
            { id: 'cam-01', name: 'Nozzle Cam', token: 'cam_tok_99' }
          ]
        }));
      }

      // GET /app/cameras/cam-01/snapshots/last
      if (req.method === 'GET' && urlPath === '/app/cameras/cam-01/snapshots/last') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]));
      }

      // POST /app/users/teams/42/uploads
      if (req.method === 'POST' && urlPath === '/app/users/teams/42/uploads') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          id: 'upload_job_999',
          hash: 'file_hash_sha256_mock'
        }));
      }

      // PUT /app/teams/42/files/raw
      if (req.method === 'PUT' && urlPath === '/app/teams/42/files/raw') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          hash: 'file_hash_sha256_mock'
        }));
      }

      // POST /app/printers/prusa-mk4-uuid-001/queue
      if (req.method === 'POST' && urlPath === '/app/printers/prusa-mk4-uuid-001/queue') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, queued_id: 101 }));
      }

      // POST /app/printers/prusa-mk4-uuid-001/commands/sync
      if (req.method === 'POST' && urlPath === '/app/printers/prusa-mk4-uuid-001/commands/sync') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ command_id: 'cmd_123', state: 'SUCCESS' }));
      }

      // Route that simulates 401 on first token, 200 on refreshed token
      if (urlPath === '/app/printers/prusa-mk4-uuid-001/test-retry') {
        if (auth === 'Bearer expired_token') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ code: 'TOKEN_EXPIRED' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, note: 'retried_successfully' }));
      }

      res.writeHead(404);
      res.end();
    });
    connectPort = await listen(mockConnectServer);
    connectUrl = `http://127.0.0.1:${connectPort}`;

    // 3. Start Gateway Server configured with prusa-connect
    gatewayServer = http.createServer(async (req, res) => {
      const url = req.url || '';
      if (url.startsWith('/_printer/prusa-connect/')) {
        await handlePrusaConnectRequest(req, res, url, {
          cloud: 'prusa-connect',
          prusaConnect: {
            accountUrl,
            connectUrl,
            rejectUnauthorized: false
          }
        });
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    gatewayPort = await listen(gatewayServer);
  });

  after(async () => {
    await close(gatewayServer);
    await close(mockAccountServer);
    await close(mockConnectServer);
  });

  test('PKCE correctness: verifier entropy and S256 challenge generation', () => {
    const pkce = newPKCE();
    assert.ok(pkce.verifier.length >= 43, 'verifier has sufficient entropy');
    assert.ok(pkce.state.length >= 16, 'state has sufficient entropy');

    // Verify S256 challenge equals unpadded base64url(sha256(verifier))
    const expectedChallenge = createHash('sha256').update(pkce.verifier).digest('base64url');
    assert.equal(pkce.challenge, expectedChallenge, 'PKCE challenge matches sha256(verifier)');
    assert.equal(pkce.challenge.includes('='), false, 'challenge is unpadded base64url');
    assert.equal(pkce.verifier.includes('='), false, 'verifier is unpadded base64url');

    const authUrl = buildAuthorizeUrl('https://account.prusa3d.com', 'CLIENT_ID', 'https://connect.prusa3d.com/cb', pkce);
    const u = new URL(authUrl);
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('client_id'), 'CLIENT_ID');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('code_challenge'), pkce.challenge);
    assert.equal(u.searchParams.get('state'), pkce.state);
  });

  test('State validation requires a complete registered callback URL', () => {
    const state = 'valid_state_123';

    // 1. Full URL with matching state
    const fullUrl = `https://connect.prusa3d.com/login/auth-callback?code=test_code_abc&state=${state}`;
    assert.equal(codeFromCallback(fullUrl, state), 'test_code_abc');

    // 2. Query string alone is incomplete
    assert.throws(() => codeFromCallback(`?code=test_code_def&state=${state}`, state));

    // 3. Mismatching state throws error
    assert.throws(
      () => codeFromCallback(`https://connect.prusa3d.com/login/auth-callback?code=abc&state=wrong_state`, state),
      /wrong state parameter/i
    );

    // 4. Refused callback with error parameter
    assert.throws(
      () => codeFromCallback(`https://connect.prusa3d.com/login/auth-callback?error=access_denied&error_description=User+denied`, state),
      /sign-in was refused/i
    );

    // 5. Bare code cannot verify callback origin or state
    assert.throws(() => codeFromCallback('bare_code_456', state));

    // 6. Empty paste throws
    assert.throws(() => codeFromCallback('', state), /nothing was pasted/i);
  });

  test('Trusted host verification rejects SSRF and untrusted domains', () => {
    assert.ok(isTrustedPrusaHost('https://connect.prusa3d.com/app/printers'));
    assert.ok(isTrustedPrusaHost('https://account.prusa3d.com/o/token/'));
    assert.ok(isTrustedPrusaHost('https://camera.prusa3d.com/snapshot'));
    assert.ok(isTrustedPrusaHost('https://sub.prusa3d.com/'));

    // Insecure HTTP rejected
    assert.equal(isTrustedPrusaHost('http://connect.prusa3d.com/'), false);

    // Off-site / SSRF domains rejected
    assert.equal(isTrustedPrusaHost('https://evil.com/'), false);
    assert.equal(isTrustedPrusaHost('https://prusa3d.com.attacker.com/'), false);
    assert.equal(isTrustedPrusaHost('https://169.254.169.254/latest/meta-data/'), false);
    assert.equal(isTrustedPrusaHost('https://127.0.0.1:8080/'), false);

    // Allowed origins override (for test environment)
    assert.ok(isTrustedPrusaHost('http://127.0.0.1:9999/app', ['http://127.0.0.1:9999']));
  });

  test('Gateway Opt-in: Rejects request when cloud prusa-connect is not enabled', async () => {
    // Temporary server with no cloud opt-in
    const noOptInServer = http.createServer(async (req, res) => {
      await handlePrusaConnectRequest(req, res, req.url, { cloud: '' });
    });
    const port = await listen(noOptInServer);
    try {
      const res = await request(port, 'POST', '/_printer/prusa-connect/auth/start');
      assert.equal(res.statusCode, 403);
      assert.match(res.text, /not enabled/i);
    } finally {
      await close(noOptInServer);
    }
  });

  test('Auth start & complete: PKCE flow and code exchange', async () => {
    // 1. Start login flow
    const startRes = await request(gatewayPort, 'POST', '/_printer/prusa-connect/auth/start');
    assert.equal(startRes.statusCode, 200);
    const startData = startRes.json();
    assert.ok(startData.authorizeUrl.includes('code_challenge='));
    assert.ok(startData.state);
    assert.ok(startData.verifier);

    // 2. Complete login with pasted callback URL
    const callbackUrl = `https://connect.prusa3d.com/login/auth-callback?code=auth_code_123&state=${startData.state}`;
    const completeRes = await request(
      gatewayPort,
      'POST',
      '/_printer/prusa-connect/auth/complete',
      { 'content-type': 'application/json' },
      JSON.stringify({
        pasted: callbackUrl,
        state: startData.state,
        verifier: startData.verifier
      })
    );

    assert.equal(completeRes.statusCode, 200);
    const tokenData = completeRes.json();
    assert.ok(tokenData.access_token, 'returned access_token');
    assert.equal(tokenData.refresh_token, 'refresh_tok_initial');
    assert.ok(tokenData.expiry > Date.now(), 'calculated expiry');

    // Verify exchange call to mock Account server
    const lastExchange = accountTokenCalls.at(-1);
    assert.equal(lastExchange.grantType, 'authorization_code');
    assert.equal(lastExchange.params.code, 'auth_code_123');
    assert.equal(lastExchange.params.code_verifier, startData.verifier);
    assert.equal(lastExchange.params.redirect_uri, DEFAULT_PRUSA_REDIRECT_URI);
    const authorize = new URL(startData.authorizeUrl);
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorize.searchParams.get('code_challenge'), createHash('sha256').update(startData.verifier).digest('base64url'));
    const calls = accountTokenCalls.length;
    const replay = await request(gatewayPort, 'POST', '/_printer/prusa-connect/auth/complete',
      { 'content-type': 'application/json' }, { pasted: callbackUrl, state: startData.state, verifier: startData.verifier });
    assert.equal(replay.statusCode, 400);
    assert.equal(accountTokenCalls.length, calls, 'consumed attempt never reaches token endpoint');
  });

  test('Invalid callback capture is rejected before token exchange', async () => {
    const start = (await request(gatewayPort, 'POST', '/_printer/prusa-connect/auth/start')).json();
    const callback = `${DEFAULT_PRUSA_REDIRECT_URI}?code=auth_code_123&state=${start.state}`;
    const cases = [
      ['bare code', { pasted: 'auth_code_123' }],
      ['query only', { pasted: `?code=auth_code_123&state=${start.state}` }],
      ['missing callback state', { pasted: `${DEFAULT_PRUSA_REDIRECT_URI}?code=auth_code_123` }],
      ['empty callback state', { pasted: `${DEFAULT_PRUSA_REDIRECT_URI}?code=auth_code_123&state=` }],
      ['wrong callback state', { pasted: callback.replace(start.state, 'wrong') }],
      ['duplicate state', { pasted: `${callback}&state=${start.state}` }],
      ['missing code', { pasted: `${DEFAULT_PRUSA_REDIRECT_URI}?state=${start.state}` }],
      ['empty code', { pasted: callback.replace('auth_code_123', '') }],
      ['duplicate code', { pasted: `${callback}&code=other` }],
      ['wrong origin', { pasted: callback.replace('connect.prusa3d.com', 'example.invalid') }],
      ['wrong path', { pasted: callback.replace('auth-callback', 'other') }],
      ['userinfo', { pasted: callback.replace('https://', 'https://user@') }],
      ['fragment', { pasted: `${callback}#fragment` }],
      ['missing pending state', { state: undefined }],
      ['unknown attempt', { state: 'unknown', pasted: callback.replace(start.state, 'unknown') }],
      ['verifier override', { verifier: 'different_verifier' }]
    ];
    for (const [label, changes] of cases) {
      const calls = accountTokenCalls.length;
      const response = await request(gatewayPort, 'POST', '/_printer/prusa-connect/auth/complete',
        { 'content-type': 'application/json' },
        { pasted: callback, state: start.state, verifier: start.verifier, ...changes });
      assert.equal(response.statusCode, 400, label);
      assert.equal(accountTokenCalls.length, calls, `${label}: no token request`);
    }
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 16 * 60 * 1000;
      const calls = accountTokenCalls.length;
      const expired = await request(gatewayPort, 'POST', '/_printer/prusa-connect/auth/complete',
        { 'content-type': 'application/json' }, { pasted: callback, state: start.state, verifier: start.verifier });
      assert.equal(expired.statusCode, 400, 'expired attempt');
      assert.equal(accountTokenCalls.length, calls, 'expired attempt: no token request');
    } finally {
      Date.now = realNow;
    }
  });

  test('Mock-only configured callback propagates original redirect, PKCE and state', async () => {
    const redirectUri = 'http://localhost:8175/oauth-callback.html';
    const previousRedirect = process.env.PRUSA_REDIRECT_URI;
    let explicitRedirect;
    const configuredGateway = http.createServer(async (req, res) => {
      await handlePrusaConnectRequest(req, res, req.url, {
        cloud: 'prusa-connect',
        prusaConnect: { accountUrl, connectUrl, redirectUri: explicitRedirect }
      });
    });
    const port = await listen(configuredGateway);
    try {
      for (const explicit of [false, true]) {
        process.env.PRUSA_REDIRECT_URI = explicit ? 'https://example.invalid/unused' : redirectUri;
        explicitRedirect = explicit ? redirectUri : undefined;
        const start = await request(port, 'POST', '/_printer/prusa-connect/auth/start');
        assert.equal(start.statusCode, 200);
        const { authorizeUrl, state, verifier } = start.json();
        const authorize = new URL(authorizeUrl);
        assert.equal(authorize.origin, accountUrl);
        assert.equal(authorize.searchParams.get('redirect_uri'), redirectUri);
        assert.equal(authorize.searchParams.get('client_id'), DEFAULT_PRUSA_CLIENT_ID);
        assert.ok(state.length >= 16);
        assert.ok(verifier.length >= 43);
        assert.equal(authorize.searchParams.get('state'), state);
        assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(authorize.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));

        const complete = (callbackState) => request(
          port, 'POST', '/_printer/prusa-connect/auth/complete',
          { 'content-type': 'application/json' },
          JSON.stringify({ pasted: `${redirectUri}?code=auth_code_123&state=${callbackState}`, state })
        );
        const callsBefore = accountTokenCalls.length;
        const rejected = await complete('wrong_state');
        assert.equal(rejected.statusCode, 400);
        assert.match(rejected.text, /wrong state parameter/i);
        assert.equal(accountTokenCalls.length, callsBefore, 'state mismatch never reaches token endpoint');

        // Change configuration after start: exchange must retain the attempt's redirect.
        process.env.PRUSA_REDIRECT_URI = 'https://example.invalid/changed';
        explicitRedirect = 'https://example.invalid/changed';
        const accepted = await complete(state);
        assert.equal(accepted.statusCode, 200);
        assert.ok(accepted.json().access_token, 'mock exchange returns a synthetic token');
        assert.equal(accountTokenCalls.length, callsBefore + 1);
        const exchange = accountTokenCalls.at(-1);
        assert.equal(exchange.grantType, 'authorization_code');
        assert.equal(exchange.params.redirect_uri, redirectUri);
        assert.equal(exchange.params.code, 'auth_code_123');
        assert.equal(exchange.params.code_verifier, verifier);
        assert.equal(exchange.params.client_id, DEFAULT_PRUSA_CLIENT_ID);
      }
    } finally {
      if (previousRedirect === undefined) delete process.env.PRUSA_REDIRECT_URI;
      else process.env.PRUSA_REDIRECT_URI = previousRedirect;
      await close(configuredGateway);
    }
  });

  test('Auth refresh: Rotating refresh token exchange', async () => {
    const refreshRes = await request(
      gatewayPort,
      'POST',
      '/_printer/prusa-connect/auth/refresh',
      { 'content-type': 'application/json' },
      JSON.stringify({ refresh_token: 'refresh_tok_initial' })
    );

    assert.equal(refreshRes.statusCode, 200);
    const refreshed = refreshRes.json();
    assert.ok(refreshed.access_token);
    assert.equal(refreshed.refresh_token, 'refresh_tok_rotated');

    const lastRefresh = accountTokenCalls.at(-1);
    assert.equal(lastRefresh.grantType, 'refresh_token');
    assert.equal(lastRefresh.params.refresh_token, 'refresh_tok_initial');
  });

  test('Security: Allowlist rejects unauthorized endpoints and methods', async () => {
    // Disallowed endpoint
    const res1 = await request(gatewayPort, 'GET', '/_printer/prusa-connect/app/admin/users');
    assert.equal(res1.statusCode, 403);
    assert.match(res1.text, /not in allowlist/i);

    // Disallowed method on printers list
    const res2 = await request(gatewayPort, 'DELETE', '/_printer/prusa-connect/app/printers');
    assert.equal(res2.statusCode, 403);

    // Path traversal rejection
    const res3 = await request(gatewayPort, 'GET', '/_printer/prusa-connect/app/printers/../login');
    assert.equal(res3.statusCode, 400);
  });

  test('Security: Strict command validation permits only job control (pause, resume, stop)', async () => {
    // 1. Valid command: PAUSE_PRINT
    const resPause = await request(
      gatewayPort,
      'POST',
      '/_printer/prusa-connect/app/printers/prusa-mk4-uuid-001/commands/sync',
      { 'content-type': 'application/json' },
      JSON.stringify({ command: 'PAUSE_PRINT', kwargs: {} })
    );
    assert.equal(resPause.statusCode, 200);

    // 2. Valid command: RESUME_PRINT
    const resResume = await request(
      gatewayPort,
      'POST',
      '/_printer/prusa-connect/app/printers/prusa-mk4-uuid-001/commands/sync',
      { 'content-type': 'application/json' },
      JSON.stringify({ command: 'RESUME_PRINT', kwargs: {} })
    );
    assert.equal(resResume.statusCode, 200);

    // 3. Valid command: STOP_PRINT
    const resStop = await request(
      gatewayPort,
      'POST',
      '/_printer/prusa-connect/app/printers/prusa-mk4-uuid-001/commands/sync',
      { 'content-type': 'application/json' },
      JSON.stringify({ command: 'STOP_PRINT', kwargs: {} })
    );
    assert.equal(resStop.statusCode, 200);

    // 4. Invalid/dangerous command: RUN_GCODE or DROP
    const resInvalid = await request(
      gatewayPort,
      'POST',
      '/_printer/prusa-connect/app/printers/prusa-mk4-uuid-001/commands/sync',
      { 'content-type': 'application/json' },
      JSON.stringify({ command: 'RUN_GCODE', kwargs: { gcode: 'M112' } })
    );
    assert.equal(resInvalid.statusCode, 403);
    assert.match(resInvalid.text, /command not allowed/i);
  });

  test('Security: Body size limits reject oversized payloads', async () => {
    const hugeBody = JSON.stringify({ command: 'PAUSE_PRINT', padding: 'x'.repeat(70 * 1024) });
    const res = await request(
      gatewayPort,
      'POST',
      '/_printer/prusa-connect/app/printers/prusa-mk4-uuid-001/commands/sync',
      { 'content-type': 'application/json' },
      hugeBody
    );
    assert.equal(res.statusCode, 413);
    assert.match(res.text, /Payload Too Large/i);
  });

  test('401 -> refresh -> retry: Transparent retry when token expired', async () => {
    const res = await request(
      gatewayPort,
      'GET',
      '/_printer/prusa-connect/app/printers/prusa-mk4-uuid-001',
      {
        'authorization': 'Bearer expired_token',
        'x-prusa-refresh-token': 'refresh_tok_for_401'
      }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().name, 'Original Prusa MK4');

    // Verify response carried rotated tokens
    assert.ok(res.headers['x-prusa-access-token']);
    assert.equal(res.headers['x-prusa-refresh-token'], 'refresh_tok_rotated');
  });

  test('Proxying Connect calls: login, printer state, storages, upload flow, camera snapshot', async () => {
    // 1. GET /app/login
    const whoami = await request(
      gatewayPort,
      'GET',
      '/_printer/prusa-connect/app/login',
      { 'authorization': 'Bearer valid_tok' }
    );
    assert.equal(whoami.statusCode, 200);
    assert.equal(whoami.json().user.public_name, 'maker_john');

    // 2. GET /app/printers
    const printers = await request(
      gatewayPort,
      'GET',
      '/_printer/prusa-connect/app/printers',
      { 'authorization': 'Bearer valid_tok' }
    );
    assert.equal(printers.statusCode, 200);
    assert.equal(printers.json().printers[0].name, 'Original Prusa MK4');

    // 3. GET /app/printers/:uuid
    const detail = await request(
      gatewayPort,
      'GET',
      '/_printer/prusa-connect/app/printers/prusa-mk4-uuid-001',
      { 'authorization': 'Bearer valid_tok' }
    );
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().connect_state, 'PRINTING');
    assert.equal(detail.json().temp.temp_nozzle, 215.5);

    // 4. Upload registration: POST /app/users/teams/42/uploads
    const uploadReg = await request(
      gatewayPort,
      'POST',
      '/_printer/prusa-connect/app/users/teams/42/uploads',
      {
        'authorization': 'Bearer valid_tok',
        'content-type': 'application/json'
      },
      JSON.stringify({
        destination: '/usb/',
        filename: 'sample.gcode',
        size: 100,
        printer_uuid: 'prusa-mk4-uuid-001'
      })
    );
    assert.equal(uploadReg.statusCode, 200);
    assert.equal(uploadReg.json().id, 'upload_job_999');

    // 5. Upload raw file: PUT /app/teams/42/files/raw?upload_id=upload_job_999
    const uploadRaw = await request(
      gatewayPort,
      'PUT',
      '/_printer/prusa-connect/app/teams/42/files/raw?upload_id=upload_job_999',
      {
        'authorization': 'Bearer valid_tok',
        'content-type': 'text/x.gcode',
        'upload-size': '10'
      },
      Buffer.from('M104 S210\n')
    );
    assert.equal(uploadRaw.statusCode, 200);
    assert.equal(uploadRaw.json().hash, 'file_hash_sha256_mock');

    // 6. Camera snapshot: GET /_printer/prusa-connect/camera/snapshot
    const snap = await request(
      gatewayPort,
      'GET',
      '/_printer/prusa-connect/camera/snapshot?uuid=prusa-mk4-uuid-001&cam_id=cam-01&token=valid_tok'
    );
    assert.equal(snap.statusCode, 200);
    assert.equal(snap.headers['content-type'], 'image/jpeg');
    assert.ok(snap.body.length > 0);
  });
});

// Synthetic Account pages only. No real accounts, credentials or cloud endpoints.
describe('Automatic Account callback capture', () => {
  const password = 'fixture-secret-password';
  const otp = '654321';
  const email = 'fixture@example.invalid';
  const csrf = '<input type="hidden" name="csrfmiddlewaretoken" value="fixture-csrf">';
  const login = `<form method="post" action="/login/">${csrf}<input name="email" type="email"><input name="password" type="password"><button type="submit">Sign in</button></form>`;
  const codeForm = `<form method="post" action="/otp/">${csrf}<input name="otp_token"><button type="submit">Continue</button></form>`;

  for (const override of ['PRUSA_CONNECT_URL', 'PRUSA_ACCOUNT_URL']) {
    test(`${override} preserves TLS certificate verification before credentials are submitted`, async t => {
      const previous = Object.fromEntries(['PRUSA_CONNECT_URL', 'PRUSA_ACCOUNT_URL'].map(key => [key, process.env[key]]));
      t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      });
      delete process.env.PRUSA_CONNECT_URL;
      delete process.env.PRUSA_ACCOUNT_URL;
      process.env[override] = override === 'PRUSA_CONNECT_URL'
        ? 'https://connect.prusa3d.com' : 'https://account.prusa3d.com';
      const upstream = [];
      t.mock.method(https, 'request', options => {
        upstream.push(options);
        throw new Error('Synthetic TLS peer rejected');
      });
      syncBuiltinESMExports();
      t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
      const gateway = http.createServer((req, res) => handlePrusaConnectRequest(req, res, req.url, { cloud: 'prusa-connect' }));
      const port = await listen(gateway);
      t.after(() => close(gateway));
      const start = (await request(port, 'POST', '/_printer/prusa-connect/auth/start')).json();
      const response = await request(port, 'POST', '/_printer/prusa-connect/auth/password',
        { 'content-type': 'application/json' }, { state: start.state, email, password });
      assert.equal(response.statusCode, 400);
      assert.equal(upstream.length, 1);
      assert.equal(upstream[0].rejectUnauthorized, true, 'endpoint configuration must retain TLS peer authentication');
      assert.equal(upstream[0].method, 'GET', 'rejected peer receives no credential POST');
      assert.ok(!response.text.includes(password));
    });
  }

  async function fixture(t, mode = 'password') {
    const calls = [];
    let state, authorizeUrl, offerPosts = 0, authorized = false;
    const account = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString();
      const params = new URLSearchParams(body);
      calls.push({ path: req.url, method: req.method, params, cookie: req.headers.cookie });
      const redirect = location => { res.writeHead(302, { location }); res.end(); };
      const callback = () => `${DEFAULT_PRUSA_REDIRECT_URI}?code=fixture-code&state=${mode === 'wrong-state' ? 'wrong' : state}`;
      const page = html => { res.setHeader('content-type', 'text/html'); res.end(html); };
      if (req.url.startsWith('/o/authorize/')) {
        const url = new URL(req.url, 'http://fixture.invalid');
        state = url.searchParams.get('state');
        authorizeUrl = req.url;
        if (authorized) return redirect(callback());
        res.setHeader('set-cookie', 'csrftoken=fixture-cookie; Path=/; HttpOnly; SameSite=Lax');
        if (mode === 'untrusted-form') return page(login.replace('/login/', 'https://example.invalid/steal'));
        if (mode === 'multiple-forms') return page(login + login);
        if (mode === 'captcha') return page(login + '<div class="g-recaptcha"></div>');
        if (mode === 'oversized') return page('x'.repeat(512 * 1024 + 1));
        if (mode === 'loop') return redirect(authorizeUrl);
        return page(login + (mode === 'large-page' ? ' '.repeat(275000) : ''));
      }
      if (req.url === '/login/') {
        assert.equal(params.get('email'), email);
        assert.equal(params.get('password'), password);
        assert.equal(params.get('csrfmiddlewaretoken'), 'fixture-csrf');
        assert.equal(req.headers['x-csrftoken'], 'fixture-cookie');
        assert.match(req.headers.cookie, /csrftoken=fixture-cookie/);
        assert.equal(req.headers.origin, new URL(accountUrl).origin);
        if (mode === 'otp') return page(codeForm);
        if (mode === 'consent') return page(`<form method="post" action="/consent/">${csrf}<input type="hidden" name="client_id" value="${DEFAULT_PRUSA_CLIENT_ID}"><input type="hidden" name="redirect_uri" value="${DEFAULT_PRUSA_REDIRECT_URI}"><button name="allow" type="submit">Authorize</button></form>`);
        if (mode.startsWith('offer')) return redirect('/passkeys/offer/?next=%2Fo%2Fauthorize%2F');
        if (mode === 'external') return redirect('https://example.invalid/steal');
        if (mode === 'wrong-callback') return redirect('https://connect.prusa3d.com/wrong?code=fixture-code&state=' + state);
        if (mode === 'duplicate-state') return redirect(callback() + '&state=' + state);
        if (mode === 'duplicate-code') return redirect(callback() + '&code=other');
        if (mode === 'callback-fragment') return redirect(callback() + '#fragment');
        if (mode === 'callback-userinfo') return redirect(callback().replace('https://', 'https://user@'));
        if (mode === 'refused-secret') return redirect(callback() + '&error=' + password + '&error_description=' + otp);
        return redirect(callback());
      }
      if (req.url === '/otp/') {
        assert.equal(params.get('otp_token'), otp);
        assert.equal(params.get('csrfmiddlewaretoken'), 'fixture-csrf');
        assert.match(req.headers.cookie, /csrftoken=fixture-cookie/);
        return redirect(callback());
      }
      if (req.url === '/consent/') {
        assert.equal(params.get('allow'), 'Authorize');
        return redirect(callback());
      }
      if (req.url.startsWith('/passkeys/offer/')) {
        if (req.method === 'POST') {
          offerPosts++;
          assert.deepEqual([...params.keys()], ['csrfmiddlewaretoken']);
          authorized = true;
          if (mode === 'offer-repeat') return redirect(req.url);
          if (mode === 'offer-redirect') return redirect('/unexpected/');
          return redirect('/');
        }
        const action = mode === 'offer-query' ? '/passkeys/offer/?next=different' : mode === 'offer-rawpath' ? '/other/../passkeys/offer/?next=%2Fo%2Fauthorize%2F' : '';
        return page(`<form method="post" action="${action}">${csrf}<button type="submit">${mode === 'offer-button' ? 'Use passkey' : 'Not now'}</button>${mode === 'offer-extra' ? '<input name="extra">' : ''}</form>`);
      }
      if (req.url === '/') return page('<p>Account</p>');
      if (req.url === '/o/token/') {
        assert.equal(params.get('code'), 'fixture-code');
        if (mode === 'token-error') { res.statusCode = 400; return res.end(password + otp); }
        return res.end(JSON.stringify({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 300 }));
      }
      res.statusCode = 404;
      res.end();
    });
    const accountUrl = `http://127.0.0.1:${await listen(account)}`;
    t.after(() => close(account));
    const gateway = http.createServer((req, res) => handlePrusaConnectRequest(req, res, req.url, {
      cloud: 'prusa-connect', prusaConnect: { accountUrl }
    }));
    const port = await listen(gateway);
    t.after(() => close(gateway));
    const send = (route, input) => request(port, 'POST', '/_printer/prusa-connect/auth/' + route,
      { 'content-type': 'application/json' }, input);
    const start = (await send('start')).json();
    const submit = () => send('password', { state: start.state, email, password });
    return { send, start, submit, calls, offerPosts: () => offerPosts };
  }

  for (const mode of ['password', 'large-page', 'otp', 'offer', 'consent']) {
    test(`${mode}: callback captured before GET, original PKCE and registered redirect exchanged`, async t => {
      const f = await fixture(t, mode);
      let response = await f.submit();
      if (mode === 'otp') {
        assert.deepEqual(response.json(), { mfaRequired: true });
        assert.equal(f.calls.filter(c => c.path === '/o/token/').length, 0);
        response = await f.send('otp', { state: f.start.state, code: otp });
      }
      assert.equal(response.statusCode, 200, response.text);
      assert.equal(response.json().access_token, 'fixture-access');
      assert.ok(!response.text.includes(password) && !response.text.includes(otp));
      const exchange = f.calls.find(c => c.path === '/o/token/').params;
      assert.equal(exchange.get('code_verifier'), f.start.verifier);
      assert.equal(exchange.get('redirect_uri'), DEFAULT_PRUSA_REDIRECT_URI);
      assert.equal(exchange.get('client_id'), DEFAULT_PRUSA_CLIENT_ID);
      assert.equal(f.calls[0].path.includes(`state=${f.start.state}`), true);
      assert.equal(f.calls[0].cookie || '', '', 'isolated jar starts without browser or prior attempt cookies');
      assert.equal(f.calls.some(c => c.path.startsWith('/login/auth-callback')), false);
      assert.equal(f.offerPosts(), mode === 'offer' ? 1 : 0);
      assert.equal((await f.submit()).statusCode, 400, 'single-use attempt');
      if (mode === 'otp') assert.equal((await f.send('otp', { state: f.start.state, code: otp })).statusCode, 400);
    });
  }

  for (const mode of ['wrong-state', 'duplicate-state', 'duplicate-code', 'callback-fragment', 'callback-userinfo', 'wrong-callback', 'untrusted-form', 'multiple-forms', 'captcha',
    'oversized', 'external', 'loop', 'offer-query', 'offer-rawpath', 'offer-button', 'offer-extra', 'offer-repeat', 'offer-redirect', 'refused-secret', 'token-error']) {
    test(`${mode}: rejected with safe result and bounded upstream work`, async t => {
      const f = await fixture(t, mode);
      const logs = [];
      for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, (...args) => logs.push(args.join(' ')));
      const response = await f.submit();
      assert.ok(response.statusCode >= 400);
      assert.ok(!response.text.includes(password) && !response.text.includes(otp) && !response.text.includes('<form'));
      assert.ok(!logs.join('').includes(password) && !logs.join('').includes(otp));
      assert.equal(f.calls.filter(c => c.path === '/o/token/').length, mode === 'token-error' ? 1 : 0);
      assert.ok(f.calls.length <= 9);
      assert.ok(f.offerPosts() <= 1);
      assert.equal((await f.submit()).statusCode, 400, 'failed automatic attempt consumed');
    });
  }

  test('pending OTP is bound to the attempt and cancellation clears it', async t => {
    const f = await fixture(t, 'otp');
    assert.deepEqual((await f.submit()).json(), { mfaRequired: true });
    const count = f.calls.length;
    assert.equal((await f.send('otp', { state: 'unknown', code: otp })).statusCode, 400);
    assert.equal(f.calls.length, count);
    assert.equal((await f.send('cancel', { state: f.start.state })).statusCode, 200);
    assert.equal((await f.send('otp', { state: f.start.state, code: otp })).statusCode, 400);
    assert.equal(f.calls.length, count);
  });

  test('expired OTP never reaches Account', async t => {
    const f = await fixture(t, 'otp');
    assert.deepEqual((await f.submit()).json(), { mfaRequired: true });
    const count = f.calls.length;
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 6 * 60 * 1000;
      assert.equal((await f.send('otp', { state: f.start.state, code: otp })).statusCode, 400);
      assert.equal(f.calls.length, count);
    } finally { Date.now = realNow; }
  });

  test('concurrent password submissions cannot share an upstream attempt', async t => {
    const f = await fixture(t);
    const responses = await Promise.all([f.submit(), f.submit()]);
    assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 400]);
    assert.equal(f.calls.filter(c => c.path === '/login/').length, 1);
    assert.equal(f.calls.filter(c => c.path === '/o/token/').length, 1);
  });
});
