import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { useGateway, restoreGlobals } from './lib/driverHarness.mjs';
import { close, listen, startGateway } from './lib/gatewayHarness.mjs';
import { CREALITY_CLOUD_HOSTS } from '../../app/gateway/crealityCloud.ts';
import { CrealityCloudApi, parseCfsFilamentSlots, parseCfsInventory, loginCrealityCloudPassword, requestCrealityCloudQr, pollCrealityCloudQr } from '../../app/src/printers/crealityCloud.ts';

// Owning contract: CrealityPrint c66cbc6b9d4759385cbec1aa94b9a2100bb21d71,
// resources/web/homepage/assets/2f55238f.js: baseHeaders, index$3, login, qr.
// resources/web/homepage/config.js: configRelease = configBeta (regional API hosts).
test('CrealityPrint auth contract: UI client through gateway, both regions and login modes', async () => {
  const requests = [];
  let qrScanned = false;
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    requests.push({ path: req.url, headers: req.headers, data });
    const h = req.headers;
    const commonValid = h['content-type'] === 'application/json'
      && h['__cxy_app_id_'] === 'creality_model'
      && h['__cxy_platform_'] === '11'
      && h['__cxy_brand_'] === 'creality' && h['__cxy_app_ch_'] === 'creality'
      && h['__cxy_app_ver_'] === '6.0.1.1375'
      && h['__cxy_os_lang_'] === '0' && !!h['__cxy_os_ver_']
      && Number(h['__cxy_timezone_']) === -new Date().getTimezoneOffset() * 60
      && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(h['__cxy_duid_'] ?? '')
      && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(h['__cxy_requestid_'] ?? '')
      && h['__cxy_uid_'] === '' && h['__cxy_token_'] === '';
    let result;
    if (req.url === '/api/cxy/account/v2/qrLogin' && JSON.stringify(data) === '{}') {
      result = { identical: 'synthetic-qr', expireTime: Math.floor(Date.now() / 1000) + 180 };
    } else if (req.url === '/api/cxy/account/v2/qrQuery' && JSON.stringify(data) === '{"identical":"synthetic-qr"}') {
      // Packaged QR component retains confirmUserInfo at state 2 for state 3.
      result = qrScanned ? { state: 3, token: 'synthetic-token' }
        : { state: 2, confirmUserInfo: { userId: 1234 } };
      qrScanned = !qrScanned;
    } else if (req.url === '/api/cxy/account/v2/loginV2'
      && Object.keys(data).sort().join() === 'account,password,type'
      && data.type === (data.account.includes('@') ? 2 : 1)
      && data.password === '  pąss&+字  ') {
      result = { token: 'synthetic-token', user_info: { userId: 1234 } };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(commonValid && result
      ? { code: 0, result }
      : { code: 1, msg: 'Invalid Parameter', reqId: 'synthetic-opaque' }));
  });
  const port = await listen(upstream);
  const gateway = await startGateway({ cloud: 'creality-cloud', crealityCloud: {
    authHost: '127.0.0.1', authPort: port, authProtocol: 'http'
  } });
  useGateway(gateway);
  try {
    for (const region of ['global', 'china']) {
      const target = { region, use_gateway: true, local_gateway: gateway.url };
      // The UI's default tab invokes these actual client functions.
      const qr = await requestCrealityCloudQr(target);
      assert.equal(qr.qrUrl, 'https://share.creality.com/scan-code?i=synthetic-qr');
      const confirmation = {};
      assert.equal(await pollCrealityCloudQr(qr.identical, target, undefined, confirmation), null);
      assert.deepEqual(await pollCrealityCloudQr(qr.identical, target, undefined, confirmation), { token: 'synthetic-token', userId: '1234' });
      for (const account of [' user@example.com ', '8613812345678']) {
        assert.deepEqual(await loginCrealityCloudPassword(account, '  pąss&+字  ', target), { token: 'synthetic-token', userId: '1234' });
      }
      // Preserve the upstream diagnostic, without exposing its opaque request ID.
      await assert.rejects(loginCrealityCloudPassword('user@example.com', 'bad', target), { message: 'Invalid Parameter' });
    }
    assert.equal(new Set(requests.map(r => r.headers['__cxy_duid_'])).size, 1, 'one client device identity across QR and password requests');
    assert.equal(new Set(requests.map(r => r.headers['__cxy_requestid_'])).size, requests.length);
    assert.deepEqual(CREALITY_CLOUD_HOSTS, {
      global: { auth: 'api.crealitycloud.com', api: 'api.crealitycloud.com' },
      china: { auth: 'api.crealitycloud.cn', api: 'api.crealitycloud.cn' }
    });
  } finally {
    restoreGlobals();
    await gateway.close();
    await close(upstream);
  }
});

// Source-derived fixtures, not captured account/hardware responses. Owning source:
// CrealityPrint b83100d320be8cddede57e0c2c5395d8c06ef7f4,
// resources/web/deviceMgr/assets/D-MKTaRJ.js: setCFSFromCxCloud,
// CFSFilamentItem, GetDeviceCFS, smartRack filamentDetected projection.
test('CFS inventory retains physical array positions and suppresses empty/unknown cached metadata', () => {
  const reported = { cfsList: [
    { portList: [
      { cId: 'material-key', rfidState: 2, filamentType: ' PLA ', filamentsColor: '#80112233' },
      null,
      { rfidState: 0, filamentType: 'STALE', filamentsColor: '#FF445566' },
      { filamentType: 'STALE', filamentsColor: '#FF778899' }
    ] },
    null,
    { portList: [{ rfidState: 1, filamentType: 'PETG', filamentsColor: '#abc' }] }
  ] };
  assert.deepEqual(parseCfsFilamentSlots(reported), [
    { id: 'cfs-1-1', label: 'CFS 1-1', presence: 'present', material: 'PLA', color: '#112233' },
    { id: 'cfs-1-3', label: 'CFS 1-3', presence: 'empty', material: '', color: undefined },
    { id: 'cfs-1-4', label: 'CFS 1-4', presence: 'unknown', material: '', color: undefined },
    { id: 'cfs-3-1', label: 'CFS 3-1', presence: 'present', material: 'PETG', color: '#abc' }
  ]);
  reported.cfsList[0].portList[0].cId = 'replacement-material';
  assert.equal(parseCfsFilamentSlots(reported)[0].id, 'cfs-1-1');
  const ports = [0, '0', 1, '1', 2, '2', 3, -1, null, '', false].map(rfidState => ({
    rfidState, filamentType: 'PLA', filamentsColor: '#123456'
  }));
  assert.deepEqual(parseCfsFilamentSlots({ cfsList: [{ portList: ports }] }).map(s => s.presence),
    ['empty', 'empty', 'present', 'present', 'present', 'present', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
  const colors = ['#00112233', '#112233', '#abc', '#1234', 'red', '#GG112233', 42, null];
  assert.deepEqual(parseCfsFilamentSlots({ cfsList: [{ portList: colors.map(filamentsColor => ({
    rfidState: 2, filamentsColor
  })) }] }).map(s => [s.presence, s.material, s.color]),
  colors.map((_, i) => ['present', '', ['#112233', '#112233', '#abc'][i]]));
});

test('external spool assignment and smart-rack detection have stable independent labels', () => {
  const rackFilament = { filamentType: 'TPU', filamentsColor: '#80445566', rfidState: 0 };
  // Ordinary rack state is hardcoded to 1 by the first-party consumer, not RFID.
  assert.deepEqual(parseCfsFilamentSlots({ rackFilament }), [
    { id: 'rack-1', label: 'External Spool', presence: 'present', material: 'TPU', color: '#445566' }
  ]);
  assert.deepEqual(parseCfsFilamentSlots({ rackFilament: { filamentsColor: '#FF445566' } }), [
    { id: 'rack-1', label: 'External Spool', presence: 'unknown', material: '', color: undefined }
  ]);
  for (const detected of ['00', '01', '10', '11', undefined, 'bad']) {
    const slots = parseCfsFilamentSlots({ smartRackFilament: { ...rackFilament, filamentDetected: detected } });
    assert.deepEqual(slots.map(s => s.id), ['smart-rack-1', 'smart-rack-2']);
    assert.deepEqual(slots.map(s => s.label), ['External Spool 1', 'External Spool 2']);
    assert.deepEqual(slots.map(s => s.presence), /^[01]{2}$/.test(detected)
      ? [...detected].map(bit => bit === '1' ? 'present' : 'empty') : ['unknown', 'unknown']);
    for (const slot of slots) {
      assert.equal(slot.material, slot.presence === 'present' ? 'TPU' : '');
      assert.equal(slot.color, slot.presence === 'present' ? '#445566' : undefined);
    }
  }
  // The existing explicit Prepare sync projection remains separate and unchanged.
  assert.deepEqual(parseCfsInventory({ cfsList: [{ portList: [
    { rfidState: 0, filamentType: 'STALE' }, { rfidState: 1, filamentType: '' }
  ] }], rackFilament }), [
    { id: 'rack-1', label: 'External Spool', material: 'TPU', color: '#445566' }
  ]);
});

test('missing and malformed inventory is unavailable; a valid empty list reports zero assignments', () => {
  for (const value of [undefined, null, [], {}, { cfsList: 'bad' }, { cfsList: [{}] },
    { cfsList: [{ portList: [42] }] }, { rackFilament: [] }, { rackFilament: null }, { smartRackFilament: [] }]) {
    assert.equal(parseCfsFilamentSlots(value), undefined);
  }
  assert.deepEqual(parseCfsFilamentSlots({ cfsList: [] }), []);
});

test('polling publishes only successful read inventory without job or heater inference', async () => {
  const previousFetch = globalThis.fetch;
  const inventory = { cfsList: [{ portList: [{ rfidState: 2, filamentType: 'PLA', filamentsColor: '#FF112233' }] }] };
  try {
    for (const scenario of [
      { body: { code: 0, result: inventory }, expected: parseCfsFilamentSlots(inventory) },
      { body: { code: 200, result: { cfsList: [] } }, expected: [] },
      { body: { code: 1, result: inventory } },
      { body: { result: inventory } },
      { body: { code: 0, result: { cfsList: 'bad' } } },
      { body: { code: 0 } }, { body: 'invalid-json' },
      { status: 500 }, { fail: true }, { multicolor: false }
    ]) {
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/pollState')) return Response.json({ code: 0, result: [{
          deviceName: 'fixture-dn', deviceState: 1, multicolor: scenario.multicolor === false ? 0 : 1,
          printInfo: { modelName: 'PLA-job.gcode', filamentType: 'PETG', filamentsColor: '#FFFFFF' }
        }] });
        if (url.includes('/values/timeseries')) return Response.json({ code: 0, result: {
          nozzleTemp: [{ value: 210 }], bedTemp: [{ value: 60 }]
        } });
        if (url.includes('/values/attributes')) return Response.json({ code: 0, result: [] });
        assert.ok(url.endsWith('/rpc/twoway/fixture-tb'));
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { method: 'get', params: { cfsList: 1 } });
        if (scenario.fail) throw new Error('optional inventory fetch failed');
        return scenario.body === 'invalid-json' ? new Response('invalid-json')
          : Response.json(scenario.body ?? {}, { status: scenario.status ?? 200 });
      };
      let disconnect;
      try {
        const state = await new Promise((resolve, reject) => {
          disconnect = new CrealityCloudApi({ printhost_user: 'fixture-user', printhost_apikey: 'fixture-token',
            serial: 'fixture-dn', cloud_device_id: 'fixture-tb' }).connect(resolve, reject);
        });
        assert.deepEqual(state.filamentSlots, scenario.expected);
        assert.equal(state.heaters.length, 2);
        assert.equal(state.file, 'PLA-job.gcode');
        assert.equal(calls.length, scenario.multicolor === false ? 3 : 4);
        if (scenario.expected?.length) assert.equal(state.filaments[0].material, 'PLA');
        else assert.equal(state.filaments, undefined);
      } finally {
        disconnect?.();
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});
