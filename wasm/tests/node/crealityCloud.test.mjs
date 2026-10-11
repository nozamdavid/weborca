import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import http from 'node:http';
import { close, listen } from './lib/gatewayHarness.mjs';
import {
  handleCrealityCloudRequest,
  isExactCfsQueryPayload
} from '../../app/gateway/crealityCloud.ts';
import {
  CrealityCloudApi,
  createCrealityAuthHeaders,
  createCrealityDeviceHeaders,
  fetchCrealityCloudDevices,
  isCrealityQrExpired,
  loginCrealityCloudPassword,
  normalizeCloudTimeseries,
  normalizeFilamentColor,
  normalizeQrExpireTimeMs,
  parseCfsInventory,
  pollCrealityCloudQr,
  requestCrealityCloudQr
} from '../../app/src/printers/crealityCloud.ts';

describe('Creality Cloud Integration & Security Gateway', () => {
  let mockUpstreamServer;
  let mockUpstreamPort;
  let gatewayServer;
  let gatewayPort;

  // Track upstream calls
  let qrPollCount = 0;
  let upstreamRequests = [];

  before(async () => {
    // 1. Setup mock upstream Creality Cloud server
    mockUpstreamServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const url = req.url || '';
        upstreamRequests.push({ method: req.method, url, headers: req.headers, body });
        const parsedBody = body ? JSON.parse(body) : {};

        // Auth: Password login
        if (req.method === 'POST' && url === '/api/account/loginV2') {
          if (parsedBody.account === 'valid@user.com' && parsedBody.password === 'secret123') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              code: 0,
              msg: 'ok',
              result: { token: 'tok_test_abc123', userId: 'uid_987654' }
            }));
          } else if (parsedBody.account === 'empty@user.com') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              code: 0,
              msg: 'ok',
              result: { token: '', userId: '' } // Missing credentials in success result
            }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              code: -1,
              msg: 'Incorrect account or password.',
              result: null
            }));
          }
          return;
        }

        // Auth: QR login request (returns realistic epoch seconds)
        if (req.method === 'POST' && url === '/api/cxy/account/v2/qrLogin') {
          const nowSeconds = Math.round(Date.now() / 1000);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            msg: 'ok',
            result: {
              identical: 'ident_qr_sample_uuid',
              expireTime: nowSeconds + 180 // Epoch seconds per CloudAPI.js & Login.qml
            }
          }));
          return;
        }

        // Auth: QR query poll
        if (req.method === 'POST' && url === '/api/cxy/account/v2/qrQuery') {
          qrPollCount++;
          if (parsedBody.identical === 'ident_expired') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              code: 1002,
              msg: 'QR code has expired',
              result: { state: 4 }
            }));
          } else if (parsedBody.identical === 'ident_missing_creds') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              code: 0,
              result: { state: 3, token: '', userId: '' } // Empty token & userId
            }));
          } else if (qrPollCount === 1) {
            // First poll: waiting for user to scan
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              code: 0,
              result: { state: 1 } // state 1 = waiting
            }));
          } else {
            // Subsequent poll: confirmed with valid token and userId
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              code: 0,
              result: {
                state: 3,
                token: 'tok_qr_success_token',
                userId: 'uid_qr_user'
              }
            }));
          }
          return;
        }

        // API: Get devices
        if (req.method === 'POST' && url === '/api/rest/print/cluster/devices/getDevices') {
          if (req.headers['__cxy_token_'] === 'tok_expired_code4') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 4, msg: 'token invalid' }));
            return;
          }
          if (req.headers['__cxy_token_'] !== 'tok_test_abc123') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 401, msg: 'Unauthorized token' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            result: {
              totalCount: 3,
              list: [
                {
                  type: 1, // supported printer
                  deviceName: 'DN_K1_MAX_001',
                  tbId: 'tb_k1_max',
                  aliasName: 'My K1 Max',
                  model: 'CR-K1 Max',
                  deviceState: 0, // idle
                  idleState: 0,
                  multicolor: 1,
                  printInfo: { modelName: 'benchy.gcode', printProgress: 0 }
                },
                {
                  type: 9, // supported printer
                  deviceName: 'DN_K2_PLUS_002',
                  tbId: 'tb_k2_plus',
                  aliasName: 'Creality K2 Plus',
                  model: 'K2 Plus',
                  deviceState: -1, // offline
                  multicolor: 1
                },
                {
                  type: 5, // unsupported type (e.g. scanner or laser) -> must be filtered out
                  deviceName: 'DN_SCANNER_003',
                  tbId: 'tb_scanner',
                  aliasName: 'CR-Scan Ferret',
                  model: 'Ferret',
                  deviceState: 0
                }
              ]
            }
          }));
          return;
        }

        // API: Poll state
        if (req.method === 'POST' && url === '/api/rest/print/cluster/devices/pollState') {
          if (req.headers['__cxy_token_'] === 'tok_code4') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 4, msg: 'token expired' }));
            return;
          }
          if (req.headers['__cxy_token_'] === 'tok_missing_dev') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0, result: [] })); // Device missing
            return;
          }
          if (req.headers['__cxy_token_'] === 'tok_percent_1') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              code: 0,
              result: [
                {
                  deviceName: 'DN_K1_MAX_001',
                  deviceState: 1,
                  printInfo: { printProgress: 1 } // 1% progress -> must map to 0.01!
                }
              ]
            }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            result: [
              {
                deviceName: 'DN_K1_MAX_001',
                deviceState: 1, // 1 = Printing
                idleState: 1,
                multicolor: 1,
                printInfo: {
                  modelName: 'cube_calibration.gcode',
                  printProgress: 45,
                  printLeftTime: 1200
                },
                iotTelemetry: [
                  { key: 'layer', value: 85 },
                  { key: 'printLeftTime', value: 1200 }
                ]
              }
            ]
          }));
          return;
        }

        // API: Timeseries (current temps)
        if (req.method === 'GET' && url.startsWith('/api/rest/iotrouter/tb_k1_max/values/timeseries')) {
          if (req.headers['__cxy_token_'] === 'tok_telemetry_fail') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 401, error: 'Unauthorized' }));
            return;
          }
          if (req.headers['__cxy_token_'] === 'tok_nonnumeric') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              code: 0,
              result: {
                nozzleTemp: [{ value: null }],
                bedTemp: [{ value: 'Infinity' }],
                boxTemp: [{ value: false }]
              }
            }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            result: {
              nozzleTemp: [{ value: 215.5 }],
              bedTemp: [{ value: 60.0 }],
              boxTemp: [{ value: 38.2 }],
              curFeedratePct: [{ value: 100 }]
            }
          }));
          return;
        }

        // API: Attributes (target temps, fans, TotalLayer)
        if (req.method === 'GET' && url.startsWith('/api/rest/iotrouter/plugins/telemetry/tb_k1_max/values/attributes')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            result: [
              { key: 'nozzleTemp2', value: 220 },
              { key: 'bedTemp2', value: 60 },
              { key: 'boxTemp2', value: 40 },
              { key: 'modelFanPct', value: 80 },
              { key: 'caseFanPct', value: 50 },
              { key: 'auxiliaryFanPct', value: 0 },
              { key: 'TotalLayer', value: 250 },
              { key: 'cfsInsert', value: 1 }
            ]
          }));
          return;
        }

        // API: CFS RPC (twoway)
        if (req.method === 'POST' && url === '/api/rest/iotrouter/rpc/twoway/tb_k1_max') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            result: {
              cfsList: [
                {
                  humidity: 25,
                  portList: [
                    {
                      // Port 1: loaded PLA, color with 9-char hex #AARRGGBB
                      cId: 'mat_1',
                      rfidState: 1,
                      filamentType: 'PLA',
                      filamentsColor: '#FF112233'
                    },
                    {
                      // Port 2: empty/unavailable (rfidState: 0) -> must skip
                      cId: 'mat_2',
                      rfidState: 0,
                      filamentType: 'PETG',
                      filamentsColor: '#FF445566'
                    },
                    {
                      // Port 3: absent filamentType -> must skip
                      cId: 'mat_3',
                      rfidState: 1,
                      filamentType: '',
                      filamentsColor: '#FF778899'
                    }
                  ]
                }
              ],
              rackFilament: {
                // External spool rack
                cId: 'rack_mat',
                rfidState: 1,
                filamentType: 'TPU',
                filamentsColor: '#FFAABBCC'
              }
            }
          }));
          return;
        }

        // Default 404
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    mockUpstreamPort = await listen(mockUpstreamServer);

    // 2. Setup gateway server with handleCrealityCloudRequest handler
    gatewayServer = http.createServer(async (req, res) => {
      const url = req.url || '';
      // Pass dependency injection test override to route to local mockUpstreamServer
      const handled = await handleCrealityCloudRequest(req, res, url, {
        cloud: 'creality-cloud',
        crealityCloud: {
          authHost: '127.0.0.1',
          authPort: mockUpstreamPort,
          authProtocol: 'http',
          apiHost: '127.0.0.1',
          apiPort: mockUpstreamPort,
          apiProtocol: 'http',
          rejectUnauthorized: false
        }
      });
      if (!handled && !res.headersSent) {
        res.writeHead(404);
        res.end('Gateway route not handled');
      }
    });

    gatewayPort = await listen(gatewayServer);
  });

  after(async () => {
    if (gatewayServer) await close(gatewayServer);
    if (mockUpstreamServer) await close(mockUpstreamServer);
  });

  test('Gateway Opt-in: Rejects requests when cloud opt-in is missing', async () => {
    let rejected = false;
    const req = {
      method: 'POST',
      url: '/_printer/creality-cloud/global/auth/api/account/loginV2'
    };
    const res = {
      headersSent: false,
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(msg) {
        rejected = true;
        assert.equal(this.statusCode, 403);
        assert.match(String(msg), /not enabled/i);
      },
      destroy() {}
    };

    const handled = await handleCrealityCloudRequest(req, res, req.url, {
      cloud: 'bambu-cloud' // missing 'creality-cloud'
    });
    assert.equal(handled, false);
    assert.equal(rejected, true);
  });

  test('Gateway Security: Rejects control/upload endpoints and methods', async () => {
    const gatewayBase = `http://127.0.0.1:${gatewayPort}`;

    // 1. One-way control RPC
    const res1 = await fetch(`${gatewayBase}/_printer/creality-cloud/global/api/api/rest/iotrouter/rpc/oneway/tb_k1_max`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'set', params: { led: 1 } })
    });
    assert.equal(res1.status, 403);
    const text1 = await res1.text();
    assert.match(text1, /not in allowlist/i);

    // 2. Print task dispatch
    const res2 = await fetch(`${gatewayBase}/_printer/creality-cloud/global/api/api/rest/print/cluster/addSingleTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskName: 'test' })
    });
    assert.equal(res2.status, 403);

    // 3. Device deletion/mutation
    const res3 = await fetch(`${gatewayBase}/_printer/creality-cloud/global/api/api/rest/print/cluster/devices/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: '123' })
    });
    assert.equal(res3.status, 403);
  });

  test('Gateway Security: Strict validation of CFS RPC payload', async () => {
    const gatewayBase = `http://127.0.0.1:${gatewayPort}`;
    const cfsUrl = `${gatewayBase}/_printer/creality-cloud/global/api/api/rest/iotrouter/rpc/twoway/tb_k1_max`;

    // 1. Valid exact payload
    assert.equal(isExactCfsQueryPayload({ method: 'get', params: { cfsList: 1 } }), true);
    const resValid = await fetch(cfsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'get', params: { cfsList: 1 } })
    });
    assert.equal(resValid.status, 200);

    // 2. Extra keys in params rejected
    assert.equal(isExactCfsQueryPayload({ method: 'get', params: { cfsList: 1, printObjects: 1 } }), false);
    const resExtra = await fetch(cfsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'get', params: { cfsList: 1, printObjects: 1 } })
    });
    assert.equal(resExtra.status, 403);

    // 3. Alternative method rejected (set command)
    assert.equal(isExactCfsQueryPayload({ method: 'set', params: { led: 1 } }), false);
    const resSet = await fetch(cfsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'set', params: { led: 1 } })
    });
    assert.equal(resSet.status, 403);

    // 4. Malformed JSON rejected with 400
    const resMalformed = await fetch(cfsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json '
    });
    assert.equal(resMalformed.status, 400);
  });

  test('Auth Headers vs Device Headers separation', () => {
    const authHeaders = createCrealityAuthHeaders({ userId: 'u1', token: 't1' });
    assert.equal(authHeaders['__CXY_PLATFORM_'], '14', 'Auth headers must use platform 14 per CloudAPI.js');
    assert.equal(authHeaders['__CXY_OS_LANG_'], '0', 'Auth headers must use OS_LANG 0 per CloudAPI.js');
    assert.ok(authHeaders['__CXY_DUID_'], 'Auth headers must include DUID');
    assert.equal(authHeaders['__CXY_UID_'], 'u1');
    assert.equal(authHeaders['__CXY_TOKEN_'], 't1');

    const devHeaders = createCrealityDeviceHeaders({ userId: 'u2', token: 't2' });
    assert.equal(devHeaders['__CXY_PLATFORM_'], '11', 'Device headers must use platform 11 per BZCDzYbb.js');
    assert.equal(devHeaders['__CXY_BRAND_'], 'creality');
    assert.equal(devHeaders['__CXY_APP_CH_'], 'creality');
    assert.equal(devHeaders['__cxy_uid_'], 'u2');
    assert.equal(devHeaders['__cxy_token_'], 't2');
  });

  test('Auth: Password login success, failure, and missing credentials rejection', async () => {
    const target = {
      local_gateway: `http://127.0.0.1:${gatewayPort}`,
      use_gateway: true,
      region: 'global'
    };

    // Rejection on bad password
    await assert.rejects(
      () => loginCrealityCloudPassword('valid@user.com', 'wrongpassword', target),
      /incorrect account or password/i
    );

    // Rejection on response missing token/userId
    await assert.rejects(
      () => loginCrealityCloudPassword('empty@user.com', 'pwd', target),
      /missing or empty userId or token/i
    );

    // Success on valid credentials
    const session = await loginCrealityCloudPassword('valid@user.com', 'secret123', target);
    assert.equal(session.token, 'tok_test_abc123');
    assert.equal(session.userId, 'uid_987654');
  });

  test('Auth: QR login request, polling, epoch seconds expiry, and empty creds rejection', async () => {
    const target = {
      local_gateway: `http://127.0.0.1:${gatewayPort}`,
      use_gateway: true,
      region: 'global'
    };

    // 1. Request QR login - realistic epoch seconds fixture check
    const qr = await requestCrealityCloudQr(target);
    assert.equal(qr.identical, 'ident_qr_sample_uuid');
    const nowSec = Math.round(Date.now() / 1000);
    // Raw expireTime is in epoch seconds (e.g. ~1.7e9), expireTimeMs in milliseconds (~1.7e12)
    assert.ok(qr.expireTime >= nowSec && qr.expireTime < 1e11, 'expireTime must be epoch seconds');
    assert.ok(qr.expireTimeMs > Date.now(), 'expireTimeMs must be epoch milliseconds');
    assert.equal(qr.qrUrl, 'https://share.creality.com/scan-code?i=ident_qr_sample_uuid');

    // Test expiry helper
    assert.equal(isCrealityQrExpired(nowSec + 100), false);
    assert.equal(isCrealityQrExpired(nowSec - 10), true);

    // 2. Poll pending (state 1) -> returns null
    qrPollCount = 0;
    const poll1 = await pollCrealityCloudQr(qr.identical, target);
    assert.equal(poll1, null);

    // 3. Poll confirmed (state 3) -> returns token and userId
    const poll2 = await pollCrealityCloudQr(qr.identical, target);
    assert.ok(poll2);
    assert.equal(poll2.token, 'tok_qr_success_token');
    assert.equal(poll2.userId, 'uid_qr_user');

    // 4. Poll confirmed but missing token/userId -> must reject
    await assert.rejects(
      () => pollCrealityCloudQr('ident_missing_creds', target),
      /missing or empty userId or token/i
    );

    // 5. Poll expired -> throws meaningful expiration error
    await assert.rejects(
      () => pollCrealityCloudQr('ident_expired', target),
      /expired/i
    );
  });

  test('Devices: Enumeration, type filtering, pagination, and session expiration', async () => {
    const target = {
      local_gateway: `http://127.0.0.1:${gatewayPort}`,
      use_gateway: true,
      region: 'global',
      token: 'tok_test_abc123',
      userId: 'uid_987654'
    };

    const { totalCount, list } = await fetchCrealityCloudDevices(target, 1, 20);
    assert.equal(totalCount, 3);
    // Unsupported type 5 is filtered out; only type 1 and type 9 remain (length 2)
    assert.equal(list.length, 2);

    const dev1 = list[0];
    assert.equal(dev1.dn, 'DN_K1_MAX_001');
    assert.equal(dev1.tbId, 'tb_k1_max');
    assert.equal(dev1.model, 'K1 Max');
    assert.equal(dev1.name, 'My K1 Max');
    assert.equal(dev1.online, true);
    assert.equal(dev1.state, 0);
    assert.equal(dev1.multicolor, true);

    const dev2 = list[1];
    assert.equal(dev2.dn, 'DN_K2_PLUS_002');
    assert.equal(dev2.online, false); // deviceState -1
    assert.equal(dev2.state, -1);

    // Session expired (code 4) must reject
    await assert.rejects(
      () => fetchCrealityCloudDevices({ ...target, token: 'tok_expired_code4' }),
      /session expired \(code 4\)/i
    );
  });

  test('Telemetry: Timeseries normalization, color conversion, and nonnumeric handling', () => {
    // Normalization handles array of keyed objects
    const arrayInput = [
      { key: 'nozzleTemp', value: 200 },
      { key: 'bedTemp', value: 55 }
    ];
    const normArray = normalizeCloudTimeseries(arrayInput);
    assert.equal(normArray['nozzleTemp'][0].value, 200);
    assert.equal(normArray['bedTemp'][0].value, 55);

    // Normalization handles sample dictionary
    const dictInput = {
      boxTemp: [{ value: 35 }]
    };
    const normDict = normalizeCloudTimeseries(dictInput);
    assert.equal(normDict['boxTemp'][0].value, 35);

    // Color conversion: #AARRGGBB (9 chars) -> #RRGGBB (7 chars)
    assert.equal(normalizeFilamentColor('#FF112233'), '#112233');
    assert.equal(normalizeFilamentColor('#112233'), '#112233');
    assert.equal(normalizeFilamentColor('invalid'), undefined);
    assert.equal(normalizeFilamentColor('#garbag'), undefined);
    assert.equal(normalizeFilamentColor('#FFzzzzzz'), undefined);
    assert.equal(normalizeFilamentColor('#f09'), '#f09');
  });

  test('CFS: Inventory parsing with empty/unavailable skipping and rackFilament', () => {
    const cfsRaw = {
      cfsList: [
        {
          portList: [
            { rfidState: 1, filamentType: 'PLA', filamentsColor: '#FF00AAFF' }, // loaded
            { rfidState: 0, filamentType: 'PETG', filamentsColor: '#FF112233' }, // empty/unavailable -> skipped
            { rfidState: 1, filamentType: '', filamentsColor: '#FF223344' }      // empty material -> skipped
          ]
        }
      ],
      rackFilament: {
        filamentType: 'TPU',
        filamentsColor: '#FFFF0000'
      }
    };

    const filaments = parseCfsInventory(cfsRaw);
    assert.equal(filaments.length, 2);
    // Port 1 loaded
    assert.equal(filaments[0].id, 'cfs-1-1');
    assert.equal(filaments[0].material, 'PLA');
    assert.equal(filaments[0].color, '#00AAFF');
    // External rack spool
    assert.equal(filaments[1].id, 'rack-1');
    assert.equal(filaments[1].material, 'TPU');
    assert.equal(filaments[1].color, '#FF0000');

    // Malformed / empty payloads handled gracefully
    assert.deepEqual(parseCfsInventory(null), []);
    assert.deepEqual(parseCfsInventory({}), []);
    assert.deepEqual(parseCfsInventory({ cfsList: 'malformed' }), []);
  });

  test('PrinterApi: CrealityCloudApi polling, state aggregation, percent scaling, and cleanup', async () => {
    const printer = {
      id: 'test-printer-id',
      name: 'Test K1 Max',
      host_type: 'creality-cloud',
      print_host: 'api.crealitycloud.com',
      cloud_region: 'global',
      printhost_user: 'uid_987654',
      printhost_apikey: 'tok_test_abc123',
      serial: 'DN_K1_MAX_001',
      cloud_device_id: 'tb_k1_max',
      use_gateway: true,
      local_gateway: `http://127.0.0.1:${gatewayPort}`
    };

    const api = new CrealityCloudApi(printer);

    // 1. Connection test
    const testDesc = await api.test();
    assert.match(testDesc, /DN_K1_MAX_001.*connected/i);

    // 2. Upload rejected in read-only mode
    await assert.rejects(
      () => api.upload({ filename: 'test.gcode', gcode: new Uint8Array(), print: true }),
      /read-only/i
    );

    // 3. Connect and verify polled state aggregation
    let stateReceived = null;
    const stop = api.connect(
      (state) => {
        stateReceived = state;
      },
      (err) => {
        assert.fail(`Unexpected connect error: ${err.message}`);
      }
    );

    // Wait for the initial poll to complete
    for (let i = 0; i < 20; i++) {
      if (stateReceived) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(stateReceived, 'State must be emitted on poll');
    assert.equal(stateReceived.state, 'printing');
    assert.equal(stateReceived.message, 'Printing');
    assert.equal(stateReceived.progress, 0.45); // 45% -> 0.45
    assert.deepEqual(stateReceived.layer, { current: 85, total: 250 });
    assert.equal(stateReceived.remaining, 1200);

    // Verify heaters
    const nozzle = stateReceived.heaters.find((h) => h.kind === 'extruder');
    assert.ok(nozzle);
    assert.equal(nozzle.current, 215.5);
    assert.equal(nozzle.target, 220);

    const bed = stateReceived.heaters.find((h) => h.kind === 'bed');
    assert.ok(bed);
    assert.equal(bed.current, 60);
    assert.equal(bed.target, 60);

    // Verify fans
    const partFan = stateReceived.fans.find((f) => f.id === 'part');
    assert.ok(partFan);
    assert.equal(partFan.speed, 0.8);

    // Verify CFS filaments
    assert.ok(stateReceived.filaments && stateReceived.filaments.length === 2);
    assert.equal(stateReceived.filaments[0].material, 'PLA');
    assert.equal(stateReceived.filaments[0].color, '#112233');

    // 4. Teardown lifecycle check: calling stop() cancels polling and timer
    stop();
    const snapCount = upstreamRequests.length;
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(upstreamRequests.length, snapCount, 'No requests should be sent after stop() is called');
  });

  test('PrinterApi: Percentage scaling (1 => 0.01) and finiteNumber nonnumeric handling', async () => {
    const printer = {
      id: 'test-printer-prog1',
      name: 'Test K1 Max Prog 1',
      host_type: 'creality-cloud',
      print_host: 'api.crealitycloud.com',
      cloud_region: 'global',
      printhost_user: 'uid_987654',
      printhost_apikey: 'tok_percent_1',
      serial: 'DN_K1_MAX_001',
      cloud_device_id: 'tb_k1_max',
      use_gateway: true,
      local_gateway: `http://127.0.0.1:${gatewayPort}`
    };

    const api = new CrealityCloudApi(printer);
    let stateReceived = null;
    const stop = api.connect(
      (state) => { stateReceived = state; },
      (err) => { assert.fail(`Unexpected connect error: ${err.message}`); }
    );

    for (let i = 0; i < 20; i++) {
      if (stateReceived) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    stop();

    assert.ok(stateReceived);
    // 1% progress MUST map to 0.01, NOT 1.0!
    assert.equal(stateReceived.progress, 0.01);

    // Verify nonnumeric temperatures (null, Infinity, boolean) are skipped via finiteNumber
    const printerNonnumeric = {
      id: 'test-printer-nonnumeric',
      name: 'Test K1 Max Nonnumeric',
      host_type: 'creality-cloud',
      print_host: 'api.crealitycloud.com',
      cloud_region: 'global',
      printhost_user: 'uid_987654',
      printhost_apikey: 'tok_nonnumeric',
      serial: 'DN_K1_MAX_001',
      cloud_device_id: 'tb_k1_max',
      use_gateway: true,
      local_gateway: `http://127.0.0.1:${gatewayPort}`
    };
    const apiNonnumeric = new CrealityCloudApi(printerNonnumeric);
    let stateNonnumeric = null;
    const stopNonnumeric = apiNonnumeric.connect(
      (state) => { stateNonnumeric = state; },
      (err) => { assert.fail(`Unexpected error: ${err.message}`); }
    );
    for (let i = 0; i < 20; i++) {
      if (stateNonnumeric) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    stopNonnumeric();
    assert.ok(stateNonnumeric);
    // Verify none of the heaters have NaN or invalid numbers
    for (const h of stateNonnumeric.heaters) {
      assert.ok(Number.isFinite(h.current));
      assert.ok(Number.isFinite(h.target));
    }
  });

  test('PrinterApi: Error handling for session expiration (code 4) and missing device', async () => {
    // 1. Session expiration (code 4)
    const printerCode4 = {
      id: 'test-code4',
      name: 'Test Code 4',
      host_type: 'creality-cloud',
      print_host: 'api.crealitycloud.com',
      printhost_user: 'uid_987654',
      printhost_apikey: 'tok_code4',
      serial: 'DN_K1_MAX_001',
      cloud_device_id: 'tb_k1_max',
      use_gateway: true,
      local_gateway: `http://127.0.0.1:${gatewayPort}`
    };
    const apiCode4 = new CrealityCloudApi(printerCode4);
    await assert.rejects(() => apiCode4.test(), /session expired \(code 4\)/i);

    // 2. Missing device from pollState
    const printerMissing = {
      id: 'test-missing',
      name: 'Test Missing Dev',
      host_type: 'creality-cloud',
      print_host: 'api.crealitycloud.com',
      printhost_user: 'uid_987654',
      printhost_apikey: 'tok_missing_dev',
      serial: 'DN_UNKNOWN_DEVICE',
      cloud_device_id: 'tb_k1_max',
      use_gateway: true,
      local_gateway: `http://127.0.0.1:${gatewayPort}`
    };
    const apiMissing = new CrealityCloudApi(printerMissing);
    await assert.rejects(() => apiMissing.test(), /device .* not found in pollState response/i);

    // 3. Telemetry auth error rejection (not silently swallowed)
    const printerTelemFail = {
      id: 'test-telem-fail',
      name: 'Test Telem Fail',
      host_type: 'creality-cloud',
      print_host: 'api.crealitycloud.com',
      printhost_user: 'uid_987654',
      printhost_apikey: 'tok_telemetry_fail',
      serial: 'DN_K1_MAX_001',
      cloud_device_id: 'tb_k1_max',
      use_gateway: true,
      local_gateway: `http://127.0.0.1:${gatewayPort}`
    };
    const apiTelemFail = new CrealityCloudApi(printerTelemFail);
    let telemError = null;
    const stopTelem = apiTelemFail.connect(
      () => {},
      (err) => { telemError = err; }
    );
    for (let i = 0; i < 20; i++) {
      if (telemError) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    stopTelem();
    // Must NOT silently swallow telemetry auth rejection!
    assert.ok(telemError, 'Telemetry auth failure must trigger onError');
    assert.match(telemError.message, /auth rejected/i);
  });
});
