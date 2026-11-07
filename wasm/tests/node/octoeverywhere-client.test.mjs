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
const response = (v, status = 200, headers = {}) => new Response(v === undefined ? null : JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
const envelope = v => response({ Status: 200, Result: v });
const session = id => ({ sessionId: `s${id}`, sessionToken: `synthetic-session-${id}`, expiresAt: Date.now() + 60000 });

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
  const requests = []; let sessions = 0;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    requests.push({ url, init });
    if (url === '/_octoeverywhere/sessions') { sessions++; return response(overrides.session?.(sessions) ?? session(sessions)); }
    if (init.method === 'DELETE' && /\/sessions\/[^/]+$/.test(url)) return response(undefined, 204);
    if (url.endsWith('/info')) return response(overrides.info ?? info);
    if (url.includes('/plugin/status')) return envelope(overrides.status ?? status);
    return route(url, init);
  });
  return requests;
}
const make = (t, p = printer()) => { const api = new client.OctoEverywhereApi(p); t.after(() => api.dispose()); return api; };

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
});

test('portal configuration, result and cancellation use exact routes, headers and no ambient auth', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init });
    if (url.endsWith('/config')) return response({ enabled: true, portalAvailable: false });
    if (url.endsWith('/portal/start')) return response({ portalUrl: 'https://octoeverywhere.com/portal', flowId: 'flow', pollToken: 'synthetic-poll' });
    if (init.method === 'DELETE') return response(undefined, 204);
    return response({ status: 'complete', connection });
  });
  assert.equal((await client.getOctoEverywhereConfig()).portalAvailable, false);
  const flow = await client.startOctoEverywherePortal({ printerId: 'fixture', requestOctoPrintApiKey: true });
  const result = await client.getOctoEverywherePortalResult(flow); assert.deepEqual(result.connection, connection);
  await client.cancelOctoEverywherePortal(flow);
  assert.deepEqual(JSON.parse(calls[1].init.body), { printerId: 'fixture', requestOctoPrintApiKey: true });
  assert.equal(calls[2].url, '/_octoeverywhere/portal/result/flow'); assert.equal(calls[2].init.headers['X-OctoEverywhere-Flow'], 'synthetic-poll');
  assert.equal(calls[3].init.method, 'DELETE');
  assert.ok(calls.every(c => c.init.credentials === 'same-origin' && c.init.cache === 'no-store' && !c.url.includes('secret')));
});

test('sessions are lazy and coalesced, auth separated, and disposal destroys and aborts operations', async t => {
  const calls = mockGateway(t); const api = make(t);
  assert.equal(calls.length, 0); await Promise.all([api.getInfo(), api.readStatus()]);
  const creates = calls.filter(c => c.url.endsWith('/sessions')); assert.equal(creates.length, 1);
  assert.deepEqual(JSON.parse(creates[0].init.body), { connection });
  assert.ok(!creates[0].init.body.includes('unrelated'));
  const op = calls.find(c => c.url.includes('/plugin/status')); assert.equal(op.init.headers['X-OctoEverywhere-Session'], 'synthetic-session-1');
  api.dispose(); assert.equal(op.init.signal.aborted, true);
  assert.equal(calls.filter(c => c.init.method === 'DELETE').length, 1);
  await assert.rejects(api.getInfo(), { name: 'AbortError' }); api.dispose();
});

test('pending session completion after disposal is cleaned up without publishing or issuing commands', async t => {
  let release; const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init });
    if (url.endsWith('/sessions')) return new Promise(resolve => { release = resolve; });
    return response(undefined, 204);
  });
  const api = make(t); const pending = api.getInfo(); api.dispose(); release(response(session(1)));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls.length, 2); assert.equal(calls[1].init.method, 'DELETE');
});

test('disposal during a delayed JSON body suppresses completed upload results and progress', async t => {
  let finish, reached; const ready = new Promise(resolve => { reached = resolve; });
  mockGateway(t, () => ({ ok: true, json: () => { reached(); return new Promise(resolve => { finish = resolve; }); } }));
  const api = make(t); let progress = 0;
  const pending = api.upload({ filename: 'fixture.gcode', gcode: new Uint8Array([1]), print: false, onProgress: () => progress++ });
  await ready; api.dispose(); finish({ Status: 200, Result: { VirtualPath: 'gcode/fixture.gcode', PlatformPath: 'fixture.gcode' } });
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(progress, 0);
});

test('safe reads recover once from gateway expiration, never replay commands or provider revocation', async t => {
  let sessions = 0, reads = 0, mutations = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/sessions')) return response(session(++sessions));
    if (init.method === 'DELETE') return response(undefined, 204);
    if (url.includes('/status')) { if (++reads === 1) return response({ error: 'expired' }, 410); return envelope(status); }
    if (url.endsWith('/home')) { mutations++; return response({ error: 'expired' }, 410); }
    return { ok: false, status: 604, json: async () => ({ error: 'synthetic-secret https://secret.invalid/' }) };
  });
  const api = make(t); await api.readStatus(); assert.equal(reads, 2); assert.equal(sessions, 2);
  await assert.rejects(api.home(), e => e.code === 410); assert.equal(mutations, 1);
  await assert.rejects(api.getInfo(), e => e.code === 604 && e.recovery === 'reconnect' && !e.message.includes('secret'));
  assert.equal(sessions, 2);
});

test('safe read retry is bounded at one even when replacement session also expires', async t => {
  let reads = 0, sessions = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/sessions')) return response(session(++sessions));
    if (init.method === 'DELETE') return response(undefined, 204);
    reads++; return response({}, 401);
  });
  const api = make(t); await assert.rejects(api.readStatus()); assert.equal(reads, 2); assert.equal(sessions, 2);
});

test('plugin Status errors and service errors are safe and retain actionable recovery', async t => {
  const api = make(t);
  for (const [code, recovery] of [[788,'unsupported'],[787,'limit'],[605,'supporter'],[602,'wait'],[610,'update-plugin'],[608,'limit']]) {
    mockGateway(t, () => response({ Status: code, Error: 'synthetic-secret https://secret.invalid' }));
    await api.readStatus(); await assert.rejects(api.setLight('chamber', true), e => e.code === code && e.recovery === recovery && !e.message.includes('synthetic-secret'));
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

test('file list/details preserve VirtualPath, raw PUT is separate from start/delete and respects limits', async t => {
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
  const put = calls.find(c => c.init.method === 'PUT'); assert.equal(put.init.body, bytes); assert.match(put.url, /files\/upload\?path=gcode%2Fsub%2Ffixture.gcode$/);
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

test('downloads enforce declared and streamed byte limits and inspect plugin errors', async t => {
  let mode = 'good';
  mockGateway(t, () => mode === 'error' ? response({ Status: 788, Error: 'synthetic-secret' }) :
    new Response(new Uint8Array(mode === 'good' ? [1,2,3] : [1,2,3,4,5]), { headers: { 'content-type': 'application/octet-stream', ...(mode === 'declared' ? { 'content-length': '5' } : {}) } }));
  const api = make(t); assert.equal((await api.downloadFile('gcode/a.gcode')).size, 3);
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
  // Let download attach its abort handler before disposal.
  await new Promise(resolve => setImmediate(resolve)); api.dispose();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(cancelled, true);
});

test('camera tickets use returned same-origin URLs with transforms and bounded explicit stream reconnect', async t => {
  const calls = mockGateway(t, url => url.endsWith('webcam/list') ? envelope(status.ListWebcams) : response({ url: '/_octoeverywhere/tickets/opaque', expiresAt: Date.now() + 10000 }));
  const api = make(t); assert.equal((await api.listCameras())[0].rotation, 90);
  const snapshot = await api.getSnapshot(0); assert.equal(snapshot.url, '/_octoeverywhere/tickets/opaque');
  let closed = 0; const stream = await api.openCameraStream(0, () => closed++); assert.equal(stream.maxDurationSeconds, 1);
  const ticketCalls = calls.filter(c => c.url.endsWith('/ticket'));
  assert.deepEqual(ticketCalls.map(c => JSON.parse(c.init.body)), [{ kind: 'snapshot', index: 0 }, { kind: 'stream', index: 0 }]);
  await new Promise(resolve => setTimeout(resolve, 1050)); assert.equal(closed, 1);
  assert.equal(calls.filter(c => c.url.endsWith('/ticket')).length, 2);
  stream.close(); assert.equal(closed, 1);
  const next = await api.openCameraStream(0, () => closed++);
  stream.close(); assert.equal(closed, 1, 'a stale handle must not close the replacement');
  api.dispose(); assert.equal(closed, 2); next.close(); assert.equal(closed, 2);
  mockGateway(t, () => response({ url: '/_octoeverywhere/tickets/ceiling', expiresAt: Date.now() + 10000 }),
    { info: { ...info, PrinterLimits: { MaxSingleWebcamStreamLengthSeconds: 86400 } } });
  const bounded = make(t);
  assert.equal((await bounded.openCameraStream(0, () => {})).maxDurationSeconds, 300, 'matches the gateway five-minute ceiling');
  bounded.dispose();
});

test('Gadget only polls while active and printing, throttles across adapters and skips disabled current print', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const calls = mockGateway(t, () => response({ State: 1 }));
  const c = { ...connection, connectionId: 'gadget-fixture' }; const api = make(t, printer('moonraker', c));
  assert.equal(await api.getGadget(true), undefined); await api.readStatus(); assert.equal(await api.getGadget(false), undefined);
  assert.equal((await api.getGadget(true)).State, 1); assert.equal(await api.getGadget(true), undefined);
  const second = make(t, printer('moonraker', c)); await second.readStatus(); assert.equal(await second.getGadget(true), undefined);
  now += 10001; assert.equal(await second.getGadget(true), undefined);
  assert.equal(calls.filter(c => c.url.endsWith('/gadget')).length, 1);
  assert.equal(calls.find(c => c.url.endsWith('/gadget')).init.body, '{}');
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

test('upload HTTP session rejection is never replayed', async t => {
  const calls = mockGateway(t, () => response({}, 401)); const api = make(t);
  await assert.rejects(api.uploadFile('gcode/fixture.gcode', new Uint8Array([1])), e => e.httpStatus === 401);
  assert.equal(calls.filter(c => c.init.method === 'PUT').length, 1);
  assert.equal(calls.filter(c => c.url.endsWith('/sessions')).length, 1);
});

test('explicit extras use exact gateway payloads and methods with provider auth retained server-side', async t => {
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
  assert.ok(extras.every(c => !c.init.body?.includes('synthetic-app-secret') && !c.url.includes('secret')));
});

test('monitor disposer aborts polling and suppresses late state callbacks', async t => {
  let resolveStatus, reached; const ready = new Promise(resolve => { reached = resolve; });
  const calls = mockGateway(t);
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/sessions')) return response(session(1));
    if (url.endsWith('/info')) return response(info);
    if (url.includes('/status')) { reached(); return new Promise(resolve => { resolveStatus = resolve; }); }
    return response(undefined, 204);
  });
  const api = make(t); const states = [], errors = []; const stop = api.connect(s => states.push(s), e => errors.push(e));
  await ready; stop(); resolveStatus(envelope(status)); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(states, []); assert.deepEqual(errors, []);
});
