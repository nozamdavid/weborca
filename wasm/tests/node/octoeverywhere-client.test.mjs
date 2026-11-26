import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

let client;
const connection = { connectionId: 'synthetic-client', url: 'https://synthetic.octoeverywhere.com/', appApiToken: 'synthetic-app-secret',
  auth: { type: 'bearer', token: 'synthetic-relay-secret' }, printerName: 'Fixture', userFacingUrl: 'https://octoeverywhere.com/view/Fixture' };
const printer = (host_type = 'moonraker', c = connection) => ({ id: 'fixture', name: 'Fixture', host_type,
  print_host: '192.0.2.1', printhost_apikey: 'unrelated-native-secret', cloud_refresh_token: 'unrelated-cloud-secret', use_gateway: true,
  octoeverywhere: { mode: 'remote', connection: c } });
const status = { Features: 63, PlatformVersion: 'fixture-1', JobStatus: { State: 'printing', Lights: [{ Name: 'chamber', On: true }],
  CurrentPrint: { Progress: 42.5, DurationSec: 3600, TimeLeftSec: 4800, FileName: 'example-print', CurrentLayer: 62, TotalLayers: 145,
    Temps: { BedActual: 60.1, BedTarget: 60, HotendActual: 219.8, HotendTarget: 220, ChamberActual: null, ChamberTarget: 0 } },
  MaterialSystem: { Capabilities: { SupportsMultiMaterial: true, SupportsMultiTool: true, SupportsSourceRouting: true },
    Sources: [{ Id: 'source-b', Index: 0, Position: 0, UnitId: 'unit-b', PrintMappingValue: 7,
      Material: { Type: 'PLA', ColorHex: 'FF6600', RemainingPercent: 0 } }, { Id: 'external', Index: 1, IsEmpty: false }, { Id: 'empty', Index: 2, IsEmpty: true }],
    Tools: [{ Id: 'tool-z', Index: 9, IsActive: true, ActualCelsius: 219.8, TargetCelsius: 220 }, { Id: 'tool-a', Index: 0, IsPresent: false }],
    Units: [{ Id: 'unit-b', Index: 2, IsDrying: false, HumidityPercent: 0 }], Routes: [{ SourceId: 'source-b', ToolId: 'tool-z', State: 'loaded' }] } },
  OctoEverywhereStatus: { MostRecentPrintIdStr: 'synthetic-print' },
  ListWebcams: { DefaultIndex: 1, Webcams: [{ Name: 'Fixture camera', Enabled: true, FlipH: true, FlipV: false, Rotation: 90,
    SnapshotUrl: 'http://192.0.2.2/private-camera', StreamUrl: '/webcam?action=stream' }] } };
const info = { PrinterName: 'Fixture', IsOnline: true, PrinterLimits: { MaxUploadFileSizeBytes: 4, MaxDownloadFileSizeBytes: 4, MaxSingleWebcamStreamLengthSeconds: 1 } };
const response = (v, statusCode = 200, headers = {}) => new Response(v === undefined ? null : JSON.stringify(v), { status: statusCode, headers: { 'content-type': 'application/json', ...headers } });
const envelope = v => response({ Status: 200, Result: v });

before(async () => {
  const adapterNames = ['BambuApi', 'BambuCloudApi', 'CrealityCloudApi', 'SnapmakerCloudApi', 'FlashforgeApi', 'MoonrakerApi', 'OctoPrintApi', 'PrusaConnectApi', 'PrusaLinkApi'];
  const bundle = await build({ stdin: { contents: `export * from './src/printers/octoEverywhere'; export { createPrinterApi } from './src/printers/api';`,
    resolveDir: new URL('../../app', import.meta.url).pathname }, bundle: true, platform: 'browser', format: 'esm', write: false,
    plugins: [{ name: 'local-dispatch-fixtures', setup(b) {
      b.onResolve({ filter: /^\.\/(bambu|bambuCloud|crealityCloud|snapmakerCloud|flashforge|moonraker|octoprint)$/ }, args => ({ path: args.path, namespace: 'local-fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'local-fixture' }, () => ({ contents: adapterNames.map(n => `export class ${n} { constructor(printer) { this.kind='${n}'; this.printer=printer; } }`).join('\n') }));
    } }] });
  client = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
});

function mockGateway(t, route = () => envelope({}), overrides = {}) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/info')) return response(overrides.info ?? info);
    if (url.includes('/plugin/status')) return envelope(overrides.status ?? status);
    return route(url, init);
  });
  return requests;
}
const make = (t, p = printer()) => { const api = new client.OctoEverywhereApi(p); t.after(() => api.dispose()); return api; };

function installPortalEnvironment(t) {
  const store = new Map();
  const storage = {
    get length() { return store.size; },
    key(i) { return [...store.keys()][i] ?? null; },
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); }
  };
  const channels = new Map();
  class MockBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      for (const peer of channels.get(this.name) ?? []) {
        if (peer !== this && typeof peer.onmessage === 'function') peer.onmessage({ data });
      }
    }
    close() { channels.get(this.name)?.delete(this); }
  }
  const listeners = new Map();
  const mockWindow = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatchEvent(event) {
      for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event);
    }
  };
  const prevStorage = globalThis.localStorage;
  const prevBC = globalThis.BroadcastChannel;
  const prevWindow = globalThis.window;
  globalThis.localStorage = storage;
  globalThis.BroadcastChannel = MockBroadcastChannel;
  globalThis.window = mockWindow;
  t.after(() => {
    if (prevStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevStorage;
    if (prevBC === undefined) delete globalThis.BroadcastChannel; else globalThis.BroadcastChannel = prevBC;
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  });
  return { storage, store, mockWindow, listeners };
}

test('documented status maps percent, timing, null temperatures and independent topology IDs', () => {
  const state = client.normalizeOctoEverywhereStatus(status, 'moonraker', info);
  assert.equal(state.progress, .425); assert.equal(state.elapsed, 3600); assert.equal(state.remaining, 4800);
  assert.deepEqual(state.layer, { current: 62, total: 145 }); assert.equal(state.activeTool, 'tool-z');
  assert.equal(state.heaters.length, 2); assert.equal(state.heaters[1].id, 'tool-z');
  assert.equal(state.octoeverywhere.temperatures.ChamberActual, null);
  assert.equal(state.filaments, undefined);
  assert.deepEqual(state.filamentSlots.map(s => s.presence), ['unknown', 'present', 'empty']);
  assert.equal(state.filamentSlots[0].color, '#FF6600'); assert.equal(state.filamentSlots[0].slotIndex, undefined);
  assert.deepEqual(state.octoeverywhere.materialSystem, status.JobStatus.MaterialSystem);
  assert.equal(state.octoeverywhere.materialSystem.Sources[0].PrintMappingValue, 7);
  assert.deepEqual(state.octoeverywhere.cameras, [{ index: 0, name: 'Fixture camera', enabled: true, flipH: true, flipV: false, rotation: 90 }]);
  assert.equal(JSON.stringify(state).includes('private-camera'), false);
  const unknown = client.normalizeOctoEverywhereStatus({ JobStatus: { CurrentPrint: { Progress: null, Temps: { BedActual: 0 } }, MaterialSystem: null } }, 'moonraker');
  assert.equal(unknown.progress, undefined); assert.deepEqual(unknown.heaters, []); assert.equal(unknown.filamentSlots, undefined);
  assert.equal(unknown.octoeverywhere.materialSystem, null);
  assert.equal(client.normalizeOctoEverywhereStatus({}, 'octoprint').octoeverywhere.materialSystem, undefined);
  assert.equal(client.normalizeOctoEverywhereStatus(status, 'moonraker', { IsOnline: false }).state, 'offline');
});

test('capabilities begin conservative, use feature bits and exclude common fan/speed and unsupported files', () => {
  assert.equal(client.octoEverywhereCapabilities('moonraker').home, false);
  for (const [bit, key] of [[1,'lights'],[2,'jog'],[4,'home'],[8,'extrude'],[16,'temps'],[32,'start']]) {
    const c = client.octoEverywhereCapabilities('moonraker', bit); assert.equal(c[key], true); assert.equal(c.fan, false); assert.equal(c.speed, false);
  }
  assert.equal(client.octoEverywhereCapabilities('prusalink', 32).files, false);
  assert.equal(client.octoEverywhereCapabilities('snapmaker-cloud', 63).files, false);
  const bambu = client.octoEverywhereCapabilities('bambu', 33);
  assert.equal(bambu.rawGcodeStart, false); assert.match(bambu.sendReason, /3MF/);
  const native = { ...printer(), octoeverywhere: { mode: 'local', connection } };
  assert.equal(client.getEffectivePrinterCapabilities(native).fan, true);
  assert.equal(client.getEffectivePrinterCapabilities(printer()).fan, false);
});

test('factory preserves native selection and saved host; only valid explicit remote links dispatch remotely', () => {
  const p = printer(); const original = structuredClone(p);
  assert.ok(client.createPrinterApi(p) instanceof client.OctoEverywhereApi); assert.deepEqual(p, original);
  for (const octoeverywhere of [undefined, { mode: 'local', connection }]) {
    assert.equal(client.createPrinterApi({ ...p, octoeverywhere }).kind, 'MoonrakerApi');
  }
  for (const octoeverywhere of [{ mode: 'remote' }, { mode: 'remote', connection: { ...connection, url: 'https://evil.example/' } }]) {
    assert.throws(() => client.createPrinterApi({ ...p, octoeverywhere }), error => error.code === 603);
    assert.equal(client.getEffectivePrinterCapabilities({ ...p, octoeverywhere }).fan, false);
  }
  for (const url of ['https://nested.synthetic.octoeverywhere.com/', 'https://synthetic.octoeverywhere.com/?token=x', 'http://synthetic.octoeverywhere.com/', 'https://x:secret@synthetic.octoeverywhere.com/']) {
    assert.equal(client.isOctoEverywhereConnection({ ...connection, url }), false);
  }
  assert.equal(client.safeOctoEverywhereUserUrl('https://octoeverywhere.com/view/Fixture?token=secret'), undefined);
  assert.equal(client.isOctoEverywhereConnection({ ...connection, auth: { type: 'basic', username: 'fixture', password: 'synthetic' } }), true);
  assert.equal(client.isOctoEverywhereConnection({ ...connection, auth: { type: 'none' } }), true);
});

test('user-facing URL validation accepts portal subdomains, root fallback and safe view paths while rejecting unsafe inputs', () => {
  for (const [input, expected] of [
    ['https://my-printer.octoeverywhere.com/', 'https://my-printer.octoeverywhere.com/'],
    ['https://my-printer.octoeverywhere.com', 'https://my-printer.octoeverywhere.com/'],
    ['https://octoeverywhere.com/', 'https://octoeverywhere.com/'],
    ['https://octoeverywhere.com/view/My%20Printer', 'https://octoeverywhere.com/view/My%20Printer'],
  ]) {
    assert.equal(client.safeOctoEverywhereUserUrl(input), expected);
    assert.equal(client.isOctoEverywhereConnection({ ...connection, userFacingUrl: input }), true);
  }
  for (const bad of [
    'https://a.b.octoeverywhere.com/',
    'https://my-printer.octoeverywhere.com/view/My%20Printer',
    'https://octoeverywhere.com/view/Fixture?token=secret',
    'https://my-printer.octoeverywhere.com/?token=secret',
    'https://octoeverywhere.com/#fragment',
    'https://octoeverywhere.com:8443/',
    'https://user:secret@octoeverywhere.com/',
    'https://user@my-printer.octoeverywhere.com/',
    'http://octoeverywhere.com/',
    'http://my-printer.octoeverywhere.com/',
    'https://evil.example/',
    'https://octoeverywhere.com/view/a%2Fb',
    'https://octoeverywhere.com/view/a%5Cb',
    'https://octoeverywhere.com/view/a%252Fb',
    'https://octoeverywhere.com/view/user%40host',
    'https://octoeverywhere.com/view/a%3Fb',
    'https://octoeverywhere.com/view/a%23b',
    'https://octoeverywhere.com/view/a%00b',
    'https://octoeverywhere.com/view/.',
    'https://octoeverywhere.com/view/..',
    'https://octoeverywhere.com/view/%2e%2e',
    'https://octoeverywhere.com/view/a/b',
  ]) {
    assert.equal(client.safeOctoEverywhereUserUrl(bad), undefined, `expected reject for ${bad}`);
    assert.equal(client.isOctoEverywhereConnection({ ...connection, userFacingUrl: bad }), false, `expected connection reject for ${bad}`);
  }
});

test('config fetches /_octoeverywhere/config with safe same-origin options', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return response({ enabled: true, appId: 'weborca', portalAvailable: true });
  });
  const cfg = await client.getOctoEverywhereConfig();
  assert.deepEqual(cfg, { enabled: true, appId: 'weborca', portalAvailable: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/_octoeverywhere/config');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
});

test('stateless routes send strict per-request headers and never create sessions or tickets', async t => {
  const calls = mockGateway(t, url => url.endsWith('/gadget') ? response({ State: 0 }) : response({ ok: true }));
  const api = make(t);
  await Promise.all([api.getInfo(), api.readStatus()]);
  assert.equal(calls.some(c => c.url.includes('/sessions') || c.url.includes('/ticket')), false);

  const infoCall = calls.find(c => c.url === '/_octoeverywhere/info');
  assert.equal(infoCall.init.headers['X-OctoEverywhere-App-Token'], 'synthetic-app-secret');
  assert.equal(infoCall.init.headers['X-OctoEverywhere-Target'], undefined);
  assert.equal(infoCall.init.headers['X-OctoEverywhere-Auth'], undefined);
  assert.equal(infoCall.init.headers['X-OctoEverywhere-Connection-Id'], undefined);

  const statusCall = calls.find(c => c.url.startsWith('/_octoeverywhere/plugin/status'));
  assert.equal(statusCall.init.headers['X-OctoEverywhere-Target'], 'https://synthetic.octoeverywhere.com/');
  assert.equal(statusCall.init.headers['X-OctoEverywhere-Auth'], 'Bearer synthetic-relay-secret');
  assert.equal(statusCall.init.headers['X-OctoEverywhere-App-Token'], undefined);
  assert.equal(statusCall.init.headers['X-OctoEverywhere-Connection-Id'], undefined);

  const basicApi = make(t, printer('moonraker', { ...connection, auth: { type: 'basic', username: 'alice', password: 'pw' } }));
  await basicApi.readStatus();
  assert.equal(calls.at(-1).init.headers['X-OctoEverywhere-Auth'], `Basic ${Buffer.from('alice:pw').toString('base64')}`);

  const noneApi = make(t, printer('moonraker', { ...connection, auth: { type: 'none' } }));
  await noneApi.readStatus();
  assert.equal('X-OctoEverywhere-Auth' in calls.at(-1).init.headers, false);
  assert.equal(calls.at(-1).init.headers['X-OctoEverywhere-Target'], 'https://synthetic.octoeverywhere.com/');
});

test('portal flow generates nonce, sweeps expired entries, handles one-time callbacks and delivers via BroadcastChannel', async t => {
  const { storage, store } = installPortalEnvironment(t);
  store.set('orca.oe.portal.stale', JSON.stringify({ expiresAt: Date.now() - 1 }));
  store.set('orca.oe.portal.result.stale', JSON.stringify({ expiresAt: Date.now() - 1, result: { status: 'failed', error: 'old' } }));
  store.set('orca.oe.portal.active', JSON.stringify({ expiresAt: Date.now() + 60_000 }));
  store.set('unrelated.key', 'keep-me');

  const flow = client.createPortalFlow('weborca', { origin: 'https://weborca.example', printerId: 'p1', requestOctoPrintApiKey: true });
  assert.match(flow.flowId, /^[\w-]{32}$/);
  assert.equal(store.has('orca.oe.portal.stale'), false);
  assert.equal(store.has('orca.oe.portal.result.stale'), false);
  assert.equal(store.has('orca.oe.portal.active'), true);
  assert.equal(store.get('unrelated.key'), 'keep-me');

  const portal = new URL(flow.portalUrl);
  assert.equal(portal.origin + portal.pathname, 'https://octoeverywhere.com/appportal/v1/');
  assert.equal(portal.searchParams.get('appid'), 'weborca');
  assert.equal(portal.searchParams.get('printerId'), 'p1');
  assert.equal(portal.searchParams.get('octoPrintApiKeyAppName'), 'WebOrca');
  const returnUrl = portal.searchParams.get('returnUrl');
  assert.equal(returnUrl, `https://weborca.example/octoeverywhere/callback/${flow.flowId}`);
  assert.equal(returnUrl.includes('?'), false);

  const received = [];
  const dispose = client.listenPortalFlow(flow, r => received.push(r));
  t.after(dispose);

  const callback = new URL(returnUrl);
  callback.searchParams.set('SUCCESS', 'True');
  callback.searchParams.set('id', 'conn-1');
  callback.searchParams.set('url', 'https://my-printer.octoeverywhere.com');
  callback.searchParams.set('appApiToken', 'app-tok');
  callback.searchParams.set('authbasichttpuser', 'bob');
  callback.searchParams.set('authbasichttppassword', 'secret-pw');
  callback.searchParams.set('printerName', 'My Printer #1');
  callback.searchParams.set('userPrinterAccessUrl', 'https://My Printer #1.octoeverywhere.com');
  callback.searchParams.set('octoPrintApiKey', 'native-key');
  callback.searchParams.set('printerLastKnownLocalIp', '192.168.1.50');

  assert.deepEqual(client.completePortalCallback(callback.href), { status: 'complete' });
  assert.equal(storage.getItem(`orca.oe.portal.${flow.flowId}`), null);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    status: 'complete',
    connection: {
      connectionId: 'conn-1',
      url: 'https://my-printer.octoeverywhere.com/',
      appApiToken: 'app-tok',
      auth: { type: 'basic', username: 'bob', password: 'secret-pw' },
      printerName: 'My Printer #1',
      userFacingUrl: 'https://octoeverywhere.com/',
      nativeApiKey: 'native-key',
      lastKnownLocalIp: '192.168.1.50'
    }
  });
  assert.equal(storage.getItem(`orca.oe.portal.result.${flow.flowId}`), null);

  // Replay is strictly ignored.
  assert.deepEqual(client.completePortalCallback(callback.href), { status: 'ignored' });
  assert.equal(received.length, 1);
});

test('portal callback supports none auth, storage fallback, cancellation, expiry, and rejects unsafe or conflicting inputs', async t => {
  const { storage, store, mockWindow } = installPortalEnvironment(t);
  delete globalThis.BroadcastChannel;

  // Unsolicited or expired flow -> ignored.
  assert.deepEqual(client.completePortalCallback('https://weborca.example/octoeverywhere/callback/unknown?success=true'), { status: 'ignored' });
  const expiredFlow = client.createPortalFlow('weborca', { origin: 'https://weborca.example' });
  store.set(`orca.oe.portal.${expiredFlow.flowId}`, JSON.stringify({ expiresAt: Date.now() - 1 }));
  assert.deepEqual(client.completePortalCallback(`https://weborca.example/octoeverywhere/callback/${expiredFlow.flowId}?success=true`), { status: 'ignored' });

  // None auth + storage event fallback delivery.
  const f1 = client.createPortalFlow('weborca', { origin: 'https://weborca.example' });
  const delivered = [];
  const d1 = client.listenPortalFlow(f1, r => delivered.push(r));
  t.after(d1);
  const cb1 = new URL(`https://weborca.example/octoeverywhere/callback/${f1.flowId}`);
  cb1.searchParams.set('success', 'true');
  cb1.searchParams.set('id', 'c1');
  cb1.searchParams.set('url', 'https://p1.octoeverywhere.com/');
  cb1.searchParams.set('appApiToken', 't1');
  cb1.searchParams.set('printername', 'my_printer.v1');
  cb1.searchParams.set('userPrinterAccessUrl', 'https://my_printer.v1.octoeverywhere.com/');
  assert.deepEqual(client.completePortalCallback(cb1.href), { status: 'complete' });
  assert.equal(delivered.length, 0);
  mockWindow.dispatchEvent({ type: 'storage', key: `orca.oe.portal.result.${f1.flowId}`, newValue: storage.getItem(`orca.oe.portal.result.${f1.flowId}`) });
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].connection.auth, { type: 'none' });
  assert.equal(delivered[0].connection.userFacingUrl, 'https://octoeverywhere.com/');
  assert.equal(storage.getItem(`orca.oe.portal.result.${f1.flowId}`), null);

  // Immediate consumption on subscribe + cancelPortalFlow.
  const f2 = client.createPortalFlow('weborca', { origin: 'https://weborca.example' });
  const cb2 = new URL(cb1.href.replace(f1.flowId, f2.flowId));
  cb2.searchParams.set('authBearerToken', 'bearer-tok');
  cb2.searchParams.set('userPrinterAccessUrl', 'https://octoeverywhere.com/view/My%20Printer');
  assert.deepEqual(client.completePortalCallback(cb2.href), { status: 'complete' });
  const immediate = [];
  const d2 = client.listenPortalFlow(f2, r => immediate.push(r));
  d2();
  assert.equal(immediate.length, 1);
  assert.equal(immediate[0].connection.auth.token, 'bearer-tok');
  assert.equal(immediate[0].connection.userFacingUrl, 'https://octoeverywhere.com/view/My%20Printer');
  assert.equal(storage.getItem(`orca.oe.portal.result.${f2.flowId}`), null);

  // Partial basic auth, duplicate/conflicting params, mismatched/credentialed/nested user URLs fail.
  for (const mutate of [
    u => u.searchParams.delete('authBasicHttpPassword'),
    u => { u.searchParams.append('id', 'c2'); },
    u => { u.searchParams.set('PrinterName', 'Different'); },
    u => { u.searchParams.set('userPrinterAccessUrl', 'https://evil.example/'); },
    u => { u.searchParams.set('userPrinterAccessUrl', 'https://user:pass@octoeverywhere.com/'); },
    u => { u.searchParams.set('userPrinterAccessUrl', 'https://a.b.octoeverywhere.com/'); },
    u => { u.searchParams.set('success', 'false'); }
  ]) {
    const f = client.createPortalFlow('weborca', { origin: 'https://weborca.example' });
    const bad = new URL(`https://weborca.example/octoeverywhere/callback/${f.flowId}`);
    bad.searchParams.set('success', 'true');
    bad.searchParams.set('id', 'c1');
    bad.searchParams.set('url', 'https://p1.octoeverywhere.com/');
    bad.searchParams.set('appApiToken', 't1');
    bad.searchParams.set('authBasicHttpUser', 'alice');
    bad.searchParams.set('authBasicHttpPassword', 'pw');
    bad.searchParams.set('printername', 'Fixture');
    mutate(bad);
    assert.deepEqual(client.completePortalCallback(bad.href), { status: 'failed' });
    client.cancelPortalFlow(f.flowId);
    assert.equal(storage.getItem(`orca.oe.portal.${f.flowId}`), null);
    assert.equal(storage.getItem(`orca.oe.portal.result.${f.flowId}`), null);
  }

  // Expiry timer fires failed result and cleans up.
  const fExp = client.createPortalFlow('weborca', { origin: 'https://weborca.example' });
  const expResults = [];
  const dExp = client.listenPortalFlow({ ...fExp, expiresAt: Date.now() + 25 }, r => expResults.push(r));
  t.after(dExp);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(expResults.length, 1);
  assert.equal(expResults[0].status, 'failed');
  assert.equal(storage.getItem(`orca.oe.portal.${fExp.flowId}`), null);
});

test('disposal aborts in-flight operations and suppresses delayed JSON results and progress', async t => {
  let finish, reached; const ready = new Promise(resolve => { reached = resolve; });
  mockGateway(t, () => ({ ok: true, json: () => { reached(); return new Promise(resolve => { finish = resolve; }); } }));
  const api = make(t); let progress = 0;
  const pending = api.upload({ filename: 'fixture.gcode', gcode: new Uint8Array([1]), print: false, onProgress: () => progress++ });
  await ready; api.dispose(); finish({ Status: 200, Result: { VirtualPath: 'gcode/fixture.gcode', PlatformPath: 'fixture.gcode' } });
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(progress, 0);
  await assert.rejects(api.getInfo(), { name: 'AbortError' });
});

test('HTTP errors do not auto-retry reads or mutations and sanitize secrets', async t => {
  let reads = 0, mutations = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('/status')) { reads++; return reads === 1 ? envelope(status) : response({ error: 'expired' }, 410); }
    if (url.endsWith('/home')) { mutations++; return response({ error: 'expired' }, 410); }
    return { ok: false, status: 604, json: async () => ({ error: 'synthetic-secret https://secret.invalid/' }) };
  });
  const api = make(t);
  await api.readStatus();
  await assert.rejects(api.readStatus(), e => e.code === 410);
  assert.equal(reads, 2);
  await assert.rejects(api.home(), e => e.code === 410);
  assert.equal(mutations, 1);
  await assert.rejects(api.getInfo(), e => e.code === 604 && e.recovery === 'reconnect' && !e.message.includes('secret'));
});

test('plugin Status errors and service errors are safe and retain actionable recovery', async t => {
  const api = make(t);
  for (const [code, recovery] of [[788,'unsupported'],[787,'limit'],[605,'supporter'],[602,'wait'],[610,'update-plugin'],[754,'update-plugin'],[606,'reconnect'],[608,'limit']]) {
    mockGateway(t, () => response({ Status: code, Error: 'synthetic-secret https://secret.invalid' }));
    await api.readStatus(); await assert.rejects(api.setLight('chamber', true), e => e.code === code && e.recovery === recovery && !e.message.includes('synthetic-secret'));
  }
  const cases = [
    [601, 'check-printer', 'Printer is offline or not connected to OctoEverywhere.'],
    [606, 'reconnect', 'Reconnect this printer to OctoEverywhere.'],
    [754, 'update-plugin', 'Update the OctoEverywhere plugin.'],
    [785, 'check-printer', 'OctoEverywhere plugin is not connected to the printer.'],
    [789, 'check-printer', 'OctoEverywhere plugin needs valid authentication for the printer.'],
    [502, 'check-printer', 'OctoEverywhere could not complete the operation (code 502). Check the printer connection.']
  ];
  for (const [code, recovery, expectedMessage] of cases) {
    const err = new client.OctoEverywhereError(code);
    assert.equal(err.code, code);
    assert.equal(err.recovery, recovery);
    assert.equal(err.message, expectedMessage);
    assert.equal(err.message.includes('secret'), false);
  }
});

test('controls gate on runtime features/state and send only exact common payloads and temperature ranges', async t => {
  const calls = mockGateway(t); const api = make(t);
  await assert.rejects(api.home(), e => e.code === 788); await api.readStatus();
  await api.home(); await api.jog('z', -5); await api.extrudeTool(2, 10); await api.setLight('chamber', false);
  await api.setTemperature('bed', 75); await api.setTemperature('chamber', 0); await api.setTemperature('extruder', 260, 2);
  await api.pausePrint(); await api.cancelPrint();
  await assert.rejects(api.setTemperature('bed', 76)); await assert.rejects(api.setTemperature('extruder', 261));
  await assert.rejects(api.home(['x'])); await assert.rejects(api.jog('x', 1, 10)); await assert.rejects(api.resumePrint());
  assert.equal(api.setFanSpeed, undefined); assert.equal(api.setPrintSpeed, undefined);
  const bodies = Object.fromEntries(calls.filter(c => c.init.method === 'POST' && c.url.includes('/plugin/')).map(c => [c.url.split('/').at(-1), c.init.body && JSON.parse(c.init.body)]));
  assert.deepEqual(bodies['move-axis'], { Axis: 'Z', DistanceMm: -5 }); assert.deepEqual(bodies.extrude, { Extruder: 2, DistanceMm: 10 });
  assert.deepEqual(bodies['set-light'], { Name: 'chamber', On: false }); assert.deepEqual(bodies['set-temp'], { ToolC: 260, ToolNumber: 2 });
  assert.deepEqual(bodies.pause, { SuppressNotification: false });
});

test('file list/details preserve VirtualPath, raw PUT includes X-OctoEverywhere-Max-Bytes and respects limits', async t => {
  const file = { Type: 'file', Name: 'fixture.gcode', VirtualPath: 'gcode/sub/fixture.gcode', PlatformPath: 'sub/fixture.gcode', SizeBytes: 3 };
  const calls = mockGateway(t, (url) => {
    if (url.includes('files/list')) return envelope({ Root: [{ Type: 'folder', Name: 'gcode', VirtualPath: 'gcode', Children: [file] }] });
    if (url.includes('files/details')) return envelope({ ...file, FileName: file.Name });
    if (url.includes('files/upload')) return envelope({ VirtualPath: file.VirtualPath, PlatformPath: file.PlatformPath, SizeBytes: 3 });
    return envelope({});
  });
  const api = make(t); const files = await api.listFiles('gcode'); assert.deepEqual(files[0].Children[0], file);
  assert.equal((await api.getFileDetails(file.VirtualPath)).VirtualPath, file.VirtualPath);
  const bytes = new Uint8Array([1, 2, 3]); await api.uploadFile(file.VirtualPath, bytes);
  const put = calls.find(c => c.init.method === 'PUT');
  assert.equal(put.init.body, bytes);
  assert.equal(put.init.headers['X-OctoEverywhere-Max-Bytes'], '4');
  assert.match(put.url, /files\/upload\?path=gcode%2Fsub%2Ffixture.gcode$/);
  assert.equal(calls.some(c => c.url.endsWith('/start')), false);
  await assert.rejects(api.uploadFile(file.VirtualPath, new Uint8Array(5)), e => e.code === 608);
  await api.startFile(file.VirtualPath); await api.deleteFile(file.VirtualPath);
  assert.deepEqual(JSON.parse(calls.find(c => c.url.endsWith('/start')).init.body), { Path: file.VirtualPath });
  assert.equal(calls.find(c => c.url.includes('/files/delete')).init.method, 'POST');
  await assert.rejects(api.uploadFile('logs/test.log', bytes)); await assert.rejects(api.deleteFile('logs/test.log'));
  await assert.rejects(api.getFileDetails('gcode/../test.gcode'));
});

test('new upload-and-print adapter queries runtime status then starts returned path once; mutations never retry', async t => {
  const calls = mockGateway(t, url => url.includes('/files/upload') ? envelope({ VirtualPath: 'gcode/returned.gcode', PlatformPath: 'returned.gcode' }) : envelope({}));
  const api = make(t); let progress;
  await api.upload({ filename: 'fixture.gcode', gcode: new Uint8Array([1]), print: true, onProgress: p => { progress = p; } });
  assert.equal(progress, 1); assert.deepEqual(JSON.parse(calls.find(c => c.url.endsWith('/start')).init.body), { Path: 'gcode/returned.gcode' });
  assert.equal(calls.filter(c => c.init.method === 'PUT').length, 1);
  await assert.rejects(api.upload({ filename: 'pretend.3mf', gcode: new Uint8Array([1]), print: false }));
});

test('Bambu start options are explicit, raw G-code cannot become a 3MF project, PrusaLink files stay unsupported', async t => {
  const calls = mockGateway(t); const api = make(t, printer('bambu')); await api.readStatus();
  await assert.rejects(api.upload({ filename: 'fixture.gcode', gcode: new Uint8Array([1]), print: true }), e => e.code === 788);
  await assert.rejects(api.startFile('gcode/fixture.gcode'), e => e.code === 788);
  const options = { Plate: 2, UseAms: true, AmsMapping: [7, -1], FlowCali: false, Timelapse: true, BedLeveling: true, VibrationCali: false, LayerInspect: true };
  await api.startFile('gcode/existing.3mf', options);
  assert.deepEqual(JSON.parse(calls.find(c => c.url.endsWith('/start')).init.body), { Path: 'gcode/existing.3mf', ...options });
  assert.equal(calls.some(c => c.init.method === 'PUT'), false);
  const prusa = make(t, printer('prusalink')); await assert.rejects(prusa.listFiles());
  await prusa.startFile('gcode/existing.gcode', { Storage: 'usb' });
  assert.deepEqual(JSON.parse(calls.filter(c => c.url.endsWith('/start')).at(-1).init.body), { Path: 'gcode/existing.gcode', Storage: 'usb' });
});

test('unsupported installed files disable subsequent file calls', async t => {
  const calls = mockGateway(t, () => response({ Status: 788 })); const api = make(t);
  await assert.rejects(api.listFiles()); assert.equal(api.capabilities.files, false);
  const count = calls.length; await assert.rejects(api.listFiles()); assert.equal(calls.length, count);
});

test('downloads enforce declared and streamed byte limits, send X-OctoEverywhere-Max-Bytes and inspect plugin errors', async t => {
  let mode = 'good';
  const calls = mockGateway(t, () => mode === 'error' ? response({ Status: 788, Error: 'synthetic-secret' }) :
    new Response(new Uint8Array(mode === 'good' ? [1,2,3] : [1,2,3,4,5]), { headers: { 'content-type': 'application/octet-stream', ...(mode === 'declared' ? { 'content-length': '5' } : {}) } }));
  const api = make(t); assert.equal((await api.downloadFile('gcode/a.gcode')).size, 3);
  assert.equal(calls.find(c => c.url.includes('files/download')).init.headers['X-OctoEverywhere-Max-Bytes'], '4');
  for (mode of ['declared','streamed']) await assert.rejects(api.downloadFile('gcode/a.gcode'), e => e.code === 607);
  mode = 'error'; await assert.rejects(api.downloadFile('gcode/a.gcode'), e => e.code === 607);
});

test('JSON downloads preserve file bytes and only reject bounded error envelopes', async t => {
  let bytes = '{ "Status": 200, "value": 12345678901234567890 }\n';
  mockGateway(t, () => new Response(bytes, { headers: { 'content-type': 'application/json' } }),
    { info: { ...info, PrinterLimits: { MaxDownloadFileSizeBytes: 1000 } } });
  const api = make(t);
  assert.equal(await (await api.downloadFile('gcode/config.json')).text(), bytes);
  bytes = '{"Status":788,"Error":"unavailable"}';
  await assert.rejects(api.downloadFile('gcode/config.json'), e => e.code === 788);
});

test('pending downloads abort on disconnect', async t => {
  let cancelled = false, reached; const started = new Promise(resolve => { reached = resolve; });
  mockGateway(t, () => new Response(new ReadableStream({ pull() { reached(); return new Promise(() => {}); }, cancel() { cancelled = true; } })));
  const api = make(t); const pending = api.downloadFile('gcode/a.gcode'); await started;
  await new Promise(resolve => setImmediate(resolve)); api.dispose();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(cancelled, true);
});

test('stateless getSnapshot fetches image blob with printer headers, creates/revokes URL and rejects JSON error envelopes', async t => {
  const revoked = [];
  let seq = 0;
  t.mock.method(URL, 'createObjectURL', blob => `blob:snapshot-${++seq}-${blob.size}`);
  t.mock.method(URL, 'revokeObjectURL', url => { revoked.push(url); });

  let mode = 'image';
  const calls = mockGateway(t, url => {
    if (url.endsWith('webcam/list')) return envelope(status.ListWebcams);
    if (mode === 'error') return response({ Status: 785, Error: 'not connected' });
    return new Response(new Uint8Array([0xff, 0xd8, 0xaa, 0xff, 0xd9]), { headers: { 'content-type': 'image/jpeg' } });
  });

  const api = make(t);
  assert.equal((await api.listCameras())[0].rotation, 90);
  const snap = await api.getSnapshot(0);
  assert.equal(snap.url, 'blob:snapshot-1-5');
  snap.revoke();
  assert.deepEqual(revoked, ['blob:snapshot-1-5']);

  const snapCall = calls.find(c => c.url === '/_octoeverywhere/plugin/webcam/snapshot?index=0');
  assert.equal(snapCall.init.headers['X-OctoEverywhere-Target'], 'https://synthetic.octoeverywhere.com/');
  assert.equal(snapCall.init.headers['X-OctoEverywhere-Auth'], 'Bearer synthetic-relay-secret');
  assert.equal(snapCall.init.headers['X-OctoEverywhere-App-Token'], undefined);

  mode = 'error';
  await assert.rejects(api.getSnapshot(0), e => e.code === 785);
});

test('stateless openCameraStream parses split MJPEG frames, handles single image, enforces limits and cleans up on close/dispose', async t => {
  const revoked = [];
  const createdBlobs = [];
  t.mock.method(URL, 'createObjectURL', blob => {
    const id = `blob:frame-${createdBlobs.length + 1}`;
    createdBlobs.push({ id, blob });
    return id;
  });
  t.mock.method(URL, 'revokeObjectURL', url => { revoked.push(url); });

  const frame1 = new Uint8Array([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]);
  const frame2 = new Uint8Array([0xff, 0xd8, 0x33, 0x44, 0x55, 0xff, 0xd9]);
  const enc = new TextEncoder();
  const part1Head = enc.encode('--frame\r\nContent-Type: image/jpeg\r\n\r\n');
  const part2Head = enc.encode('\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 7\r\n\r\n');
  const full = new Uint8Array(part1Head.length + frame1.length + part2Head.length + frame2.length);
  full.set(part1Head, 0);
  full.set(frame1, part1Head.length);
  full.set(part2Head, part1Head.length + frame1.length);
  full.set(frame2, part1Head.length + frame1.length + part2Head.length);

  // Split directly inside SOI (0xFF | 0xD8) and EOI (0xFF | 0xD9) of frame1, plus multi-frame boundary.
  const split1 = part1Head.length + 1;
  const split2 = part1Head.length + frame1.length - 1;
  const chunks = [full.slice(0, split1), full.slice(split1, split2), full.slice(split2)];

  let streamMode = 'mjpeg';
  const calls = mockGateway(t, () => {
    if (streamMode === 'mjpeg') {
      return new Response(new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        }
      }), { headers: { 'content-type': 'multipart/x-mixed-replace; boundary=frame' } });
    }
    if (streamMode === 'single') {
      return new Response(frame1, { headers: { 'content-type': 'image/jpeg' } });
    }
    if (streamMode === 'hanging') {
      return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'multipart/x-mixed-replace; boundary=frame' } });
    }
    return new Response(new ReadableStream({
      pull() { return Promise.reject(new Error('network drop')); }
    }), { headers: { 'content-type': 'multipart/x-mixed-replace; boundary=frame' } });
  });

  const api = make(t);
  const frames = [];
  let closed = 0;
  let errors = [];
  const s1 = await api.openCameraStream(0, (url, revoke) => frames.push({ url, revoke }), () => closed++, e => errors.push(e));
  assert.equal(s1.maxDurationSeconds, 1);
  const streamCall = calls.find(c => c.url === '/_octoeverywhere/plugin/webcam/stream?index=0');
  assert.equal(streamCall.init.headers['X-OctoEverywhere-Stream-Seconds'], '1');
  assert.equal(streamCall.init.headers['X-OctoEverywhere-Target'], 'https://synthetic.octoeverywhere.com/');
  assert.equal(streamCall.init.headers['X-OctoEverywhere-App-Token'], undefined);

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(frames.length, 2);
  assert.equal(closed, 1);
  assert.equal(errors.length, 0);
  assert.deepEqual(new Uint8Array(await createdBlobs[0].blob.arrayBuffer()), frame1);
  assert.deepEqual(new Uint8Array(await createdBlobs[1].blob.arrayBuffer()), frame2);
  frames.forEach(f => f.revoke());
  assert.deepEqual(revoked, ['blob:frame-1', 'blob:frame-2']);

  // Single image/... response emits once and closes cleanly.
  streamMode = 'single';
  const singleFrames = [];
  let singleClosed = 0;
  await api.openCameraStream(0, (url, revoke) => { singleFrames.push(url); revoke(); }, () => singleClosed++);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(singleFrames.length, 1);
  assert.equal(singleClosed, 1);

  // Hanging stream honors MaxSingleWebcamStreamLengthSeconds timer, stale close handle, and dispose abort.
  streamMode = 'hanging';
  let hangClosed = 0;
  const h1 = await api.openCameraStream(0, () => {}, () => hangClosed++);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal(hangClosed, 1);
  h1.close();
  assert.equal(hangClosed, 1);

  const h2 = await api.openCameraStream(0, () => {}, () => hangClosed++);
  h1.close();
  assert.equal(hangClosed, 1, 'stale handle must not close replacement stream');
  api.dispose();
  assert.equal(hangClosed, 2);
  h2.close();
  assert.equal(hangClosed, 2);

  // Unexpected stream error invokes onError and onClose once.
  streamMode = 'error';
  const apiErr = make(t);
  let errClosed = 0;
  const errList = [];
  await apiErr.openCameraStream(0, () => {}, () => errClosed++, e => errList.push(e));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(errList.length, 1);
  assert.equal(errClosed, 1);

  // Unknown limit defaults to 20s and large limit caps at 300s.
  streamMode = 'hanging';
  mockGateway(t, () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'multipart/x-mixed-replace; boundary=frame' } }),
    { info: { ...info, PrinterLimits: { MaxSingleWebcamStreamLengthSeconds: 86400 } } });
  const bounded = make(t);
  assert.equal((await bounded.openCameraStream(0, () => {}, () => {})).maxDurationSeconds, 300, 'matches five-minute ceiling');
  bounded.dispose();

  mockGateway(t, () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'multipart/x-mixed-replace; boundary=frame' } }),
    { info: { PrinterName: 'Fixture', IsOnline: true } });
  const unknownLimit = make(t);
  assert.equal((await unknownLimit.openCameraStream(0, () => {}, () => {})).maxDurationSeconds, 20);
  unknownLimit.dispose();
});

test('Gadget only polls while active and printing, throttles across adapters, skips disabled print and sends X-OctoEverywhere-Connection-Id', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const calls = mockGateway(t, () => response({ State: 1 }));
  const c = { ...connection, connectionId: 'gadget-fixture' }; const api = make(t, printer('moonraker', c));
  assert.equal(await api.getGadget(true), undefined); await api.readStatus(); assert.equal(await api.getGadget(false), undefined);
  assert.equal((await api.getGadget(true)).State, 1); assert.equal(await api.getGadget(true), undefined);
  const second = make(t, printer('moonraker', c)); await second.readStatus(); assert.equal(await second.getGadget(true), undefined);
  now += 10001; assert.equal(await second.getGadget(true), undefined);
  const gadgetCalls = calls.filter(call => call.url.endsWith('/gadget'));
  assert.equal(gadgetCalls.length, 1);
  assert.equal(gadgetCalls[0].init.body, '{}');
  assert.equal(gadgetCalls[0].init.headers['X-OctoEverywhere-App-Token'], 'synthetic-app-secret');
  assert.equal(gadgetCalls[0].init.headers['X-OctoEverywhere-Connection-Id'], 'gadget-fixture');
  assert.equal(gadgetCalls[0].init.headers['X-OctoEverywhere-Auth'], undefined);
  assert.equal(gadgetCalls[0].init.headers['X-OctoEverywhere-Target'], undefined);
});

test('active Gadget polls are spaced by at least ten seconds and idle/hidden calls never poll', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const calls = mockGateway(t, () => response({ State: 3, Status: 'Looking Good', StatusColor: 'g', Rating: 8 }));
  const api = make(t, printer('moonraker', { ...connection, connectionId: 'active-gadget-fixture' }));
  await api.readStatus(); await api.getGadget(true); now += 9999;
  assert.equal(await api.getGadget(true), undefined); now++;
  assert.equal((await api.getGadget(true)).Rating, 8); now += 10000;
  assert.equal(await api.getGadget(false), undefined);
  assert.equal(calls.filter(c => c.url.endsWith('/gadget')).length, 2);
});

test('upload progress reports gateway bytes before confirmation and dispose aborts XHR', async t => {
  installPortalEnvironment(t);
  const requests = mockGateway(t);
  const previousXHR = globalThis.XMLHttpRequest;
  const uploads = [];
  class MockXHR {
    upload = {};
    headers = {};
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(bytes) { this.bytes = bytes; uploads.push(this); }
    abort() { this.aborted = true; this.onabort?.(); }
    finish(body, status = 200) { this.status = status; this.responseText = JSON.stringify(body); this.onload(); }
  }
  globalThis.XMLHttpRequest = MockXHR;
  t.after(() => {
    if (previousXHR === undefined) delete globalThis.XMLHttpRequest; else globalThis.XMLHttpRequest = previousXHR;
  });
  const api = make(t);
  await api.getInfo();
  const progress = [];
  let confirmed = false;
  const pending = api.upload({ filename: 'a.gcode', gcode: new Uint8Array([1, 2, 3, 4]), onProgress: p => progress.push(p) })
    .then(() => { confirmed = true; });
  const xhr = uploads[0];
  assert.equal(xhr.method, 'PUT');
  assert.equal(xhr.url, '/_octoeverywhere/plugin/files/upload?path=gcode%2Fa.gcode');
  assert.equal(xhr.headers['X-OctoEverywhere-Auth'], 'Bearer synthetic-relay-secret');
  assert.equal(xhr.headers['X-OctoEverywhere-Max-Bytes'], '4');
  assert.equal(xhr.headers['X-OctoEverywhere-App-Token'], undefined);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 2, total: 4 });
  xhr.upload.onload();
  await Promise.resolve();
  assert.deepEqual(progress, [.5, 1]);
  assert.equal(confirmed, false);
  xhr.finish({ Status: 200, Result: { VirtualPath: 'gcode/a.gcode', PlatformPath: '/a.gcode' } });
  await pending;
  assert.equal(confirmed, true);
  assert.equal(xhr.upload.onprogress, null);

  for (const [body, httpStatus, code] of [
    [{ Status: 788, Error: 'synthetic-relay-secret' }, 200, 788],
    [{ reason: 'upstream_redirect' }, 502, 502]
  ]) {
    const errorApi = make(t);
    await errorApi.getInfo();
    const rejected = errorApi.uploadFile('gcode/a.gcode', new Uint8Array([1]), () => {});
    uploads.at(-1).finish(body, httpStatus);
    await assert.rejects(rejected, e => e.code === code && !e.message.includes('synthetic-relay-secret') &&
      (httpStatus !== 502 || e.upstreamRedirect));
  }
  const cancelled = api.uploadFile('gcode/a.gcode', new Uint8Array([1]), () => {});
  const aborted = uploads.at(-1);
  api.dispose();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.upload.onprogress, null);
  assert.equal(requests.filter(c => c.init.method === 'PUT').length, 0);
});

test('upload fallback emits final progress only after a successful response', async t => {
  let succeed = true;
  mockGateway(t, () => succeed ? envelope({ VirtualPath: 'gcode/a.gcode' }) : response({}, 401));
  const api = make(t), progress = [];
  await api.uploadFile('gcode/a.gcode', new Uint8Array([1]), p => progress.push(p));
  assert.deepEqual(progress, [1]);
  succeed = false;
  await assert.rejects(api.uploadFile('gcode/a.gcode', new Uint8Array([1]), p => progress.push(p)));
  assert.deepEqual(progress, [1]);
});

test('upload HTTP rejection is never replayed', async t => {
  const calls = mockGateway(t, () => response({}, 401)); const api = make(t);
  await assert.rejects(api.uploadFile('gcode/fixture.gcode', new Uint8Array([1])), e => e.httpStatus === 401);
  assert.equal(calls.filter(c => c.init.method === 'PUT').length, 1);
});

test('explicit extras use exact gateway payloads, methods and strict App-Token headers', async t => {
  const calls = mockGateway(t, url => url.endsWith('/live-link') ? response({ LiveId: 'fixture', Url: 'https://octoeverywhere.com/live/fixture', ShortUrl: 'https://oe.ink/l/fixture' }) : response({ status: 200 }));
  const api = make(t);
  assert.equal((await api.createLiveLink({ ExpirationHours: 24, EndWhenCurrentPrintIsComplete: false })).LiveId, 'fixture');
  const webhook = { WebhookUrl: 'https://fixture.example/callback', InclusiveEventTypesFilter: [1, 2, 3, 7] };
  await api.setNotificationWebhook(webhook); await api.deleteNotificationWebhook(); await api.testNotificationWebhook();
  await assert.rejects(api.createLiveLink({ ExpirationHours: 0 })); await assert.rejects(api.setNotificationWebhook({ WebhookUrl: 'http://fixture.example/callback' }));
  const extras = calls.filter(c => /\/(live-link|notifications|notifications\/test)$/.test(c.url));
  assert.deepEqual(extras.map(c => c.init.method), ['POST','POST','DELETE','POST']);
  assert.deepEqual(JSON.parse(extras[0].init.body), { ExpirationHours: 24, EndWhenCurrentPrintIsComplete: false });
  assert.deepEqual(JSON.parse(extras[1].init.body), webhook);
  assert.ok(extras.every(c =>
    c.init.headers['X-OctoEverywhere-App-Token'] === 'synthetic-app-secret' &&
    c.init.headers['X-OctoEverywhere-Auth'] === undefined &&
    c.init.headers['X-OctoEverywhere-Target'] === undefined &&
    !c.init.body?.includes('synthetic-app-secret') && !c.url.includes('secret')));
});

test('Device monitor distinguishes a refused relay redirect from a confirmed offline printer', async t => {
  let online = false;
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/info')
    ? response({ ...info, IsOnline: online })
    : response({ reason: 'upstream_redirect' }, 502));

  async function connectionError() {
    const api = make(t);
    try {
      return await new Promise((resolve, reject) => api.connect(() => reject(new Error('Unexpected state')), resolve));
    } finally { api.dispose(); }
  }

  const offline = await connectionError();
  assert.equal(offline.code, 601);
  assert.match(offline.message, /Printer is offline/);
  online = true;
  const redirect = await connectionError();
  assert.equal(redirect.code, 502);
  assert.match(redirect.message, /unexpected redirect/);
});

test('monitor disposer aborts polling and suppresses late state callbacks', async t => {
  let resolveStatus, reached; const ready = new Promise(resolve => { reached = resolve; });
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/info')) return response(info);
    if (url.includes('/status')) { reached(); return new Promise(resolve => { resolveStatus = resolve; }); }
    return response(undefined, 204);
  });
  const api = make(t); const states = [], errors = []; const stop = api.connect(s => states.push(s), e => errors.push(e));
  await ready; stop(); resolveStatus(envelope(status)); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(states, []); assert.deepEqual(errors, []);
});

test('per-upload cancellation aborts info discovery without disposing the shared adapter', async t => {
  const api = make(t);
  const controller = new AbortController();
  let infoSignal;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (url.endsWith('/info')) {
      infoSignal = init.signal;
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
    return envelope(status);
  });
  const pending = api.uploadFile('gcode/cancel.gcode', new Uint8Array([71]), undefined, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(infoSignal.aborted, true);
  assert.ok(await api.readStatus());
});
