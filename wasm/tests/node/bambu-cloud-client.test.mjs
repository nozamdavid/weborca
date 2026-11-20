import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

let client;
let directory;
const printer = { host_type: 'bambu-cloud', print_host: 'us.mqtt.bambulab.com', use_gateway: true,
  printhost_user: 'u_123', printhost_apikey: 'fixture-token', serial: 'SER123' };

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-cloud-client-'));
  const bundle = await build({ stdin: { contents: "export * from './bambuCloud'; export { usePrinterConnectionStore } from './connectionStore';",
    resolveDir: new URL('../../app/src/printers', import.meta.url).pathname, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false });
  const filename = join(directory, 'client.mjs');
  await writeFile(filename, bundle.outputFiles[0].text);
  client = await import(pathToFileURL(filename));
});
after(async () => rm(directory, { recursive: true, force: true }));

test('login uses email and exactly one credential, validates UID and bound devices', async t => {
  const requests = [];
  let response = { accessToken: 'fixture-token', refreshToken: 'fixture-refresh' };
  let preference = { uid: 123 };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, ...options });
    const data = url.endsWith('/login') ? response : url.endsWith('/preference') ? preference :
      { devices: [null, { dev_id: '../bad' }, { dev_id: 'SER123', name: 'Printer' }] };
    return new Response(JSON.stringify(data), { status: 200 });
  });
  const result = await client.loginBambuCloud(printer, ' user@example.com ', { code: '123456', password: 'unused' });
  assert.deepEqual(JSON.parse(requests[0].body), { account: 'user@example.com', code: '123456' });
  assert.equal(result.username, 'u_123');
  assert.equal(result.refreshToken, 'fixture-refresh');
  assert.deepEqual(result.devices, [{ dev_id: 'SER123', name: 'Printer' }]);
  assert.equal(requests[1].headers.authorization, 'Bearer fixture-token');
  assert.equal(printer.printhost_user, 'u_123', 'login does not overwrite the email or saved printer');

  response = { loginType: 'verifyCode' };
  requests.length = 0;
  await assert.rejects(client.loginBambuCloud(printer, 'user@example.com', { password: 'password' }), /Verification code/);
  assert.equal(requests.length, 1, 'challenge stops before querying preferences');
  response = { accessToken: 'fixture-token' };
  preference = {};
  await assert.rejects(client.loginBambuCloud(printer, 'user@example.com', { password: 'password' }), /valid user ID/);
});

test('MQTT merges reports, ignores malformed messages and stops reconnecting after cleanup', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [];
  class Socket {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.onclose?.(); }
    report(value) { this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }); }
  }
  globalThis.window = { location: { origin: 'http://fixture.invalid' } };
  t.after(() => { delete globalThis.window; });
  t.mock.property(globalThis, 'WebSocket', Socket);
  const states = [];
  const errors = [];
  const stop = new client.BambuCloudApi(printer).connect(state => states.push(state), error => errors.push(error));
  const socket = sockets[0];
  socket.onopen();
  assert.deepEqual(socket.sent[0], { type: 'connect', serial: 'SER123', username: 'u_123', token: 'fixture-token' });
  socket.report({ type: 'connected' });
  assert.deepEqual(socket.sent.slice(1).map(message => Object.keys(message.payload)[0]), ['info', 'pushing']);
  socket.report('null');
  socket.report('[]');
  socket.report('{');
  assert.equal(states.length, 0);
  socket.report({ type: 'report', payload: { print: { gcode_state: 'RUNNING', nozzle_temper: 210,
    ams: { ams: [{ id: 0, tray: [{ id: 0, tray_type: 'PLA', tray_color: 'FF0000FF' }] }] } } } });
  socket.report({ type: 'report', payload: { print: { nozzle_temper: 215 } } });
  assert.equal(states.at(-1).state, 'printing');
  assert.equal(states.at(-1).heaters[0].current, 215);
  assert.equal(states.at(-1).filaments[0].material, 'PLA');
  socket.close();
  assert.match(errors.at(-1).message, /disconnected/);
  t.mock.timers.tick(3000);
  assert.equal(sockets.length, 2);
  stop();
  t.mock.timers.tick(30000);
  assert.equal(sockets.length, 2, 'cleanup cancels both the handshake and reconnect timers');
});

test('MakerWorld resolves signed URL through account API without fetching CDN', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.includes('/design/123') ? { instances: [{ id: 456 }] } :
      { name: 'fixture.3mf', url: 'https://makerworld.bblmw.com/fixture.3mf?signature=mock' });
  });
  assert.equal(await client.makerWorldDownload(printer, '123'), 'https://makerworld.bblmw.com/fixture.3mf?signature=mock');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => r.url.startsWith('/_printer/') && r.options.redirect === 'error'));
  assert.ok(requests.every(r => r.options.headers.authorization === 'Bearer fixture-token'));
  await assert.rejects(client.makerWorldDownload(printer, '../123'), /Sign in/);
});

test('MakerWorld byte import posts signed destination privately and returns a 3MF File', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/model-bytes')) return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([80, 75]));
        controller.enqueue(new Uint8Array([3, 4, 0]));
        controller.close();
      }
    }), { headers: { 'content-length': '5' } });
    return Response.json(url.includes('/design/123') ? { defaultInstanceId: 456 } :
      { url: 'https://makerworld.bblmw.com/makerworld/model/US123/design/fixture.3mf?signature=mock' });
  });
  const progress = [];
  const file = await client.makerWorldFile(printer, '123', undefined, percent => progress.push(percent));
  assert.deepEqual(progress, [undefined, 0, 40, 100]);
  assert.equal(file.name, 'MakerWorld-123.3mf');
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [80, 75, 3, 4, 0]);
  const relay = requests[2];
  assert.ok(!relay.url.includes('signature'));
  assert.equal(relay.options.method, 'POST');
  assert.equal(relay.options.headers.authorization, undefined);
  assert.equal(relay.options.credentials, 'omit');
  assert.ok(JSON.parse(relay.options.body).url.includes('signature=mock'));
});

test('MakerWorld rejects unsafe signed URL hosts', async t => {
  for (const url of ['https://evil.test/file', 'http://makerworld.bblmw.com/file', 'https://user@makerworld.bblmw.com/file']) {
    t.mock.method(globalThis, 'fetch', async path => Response.json(path.includes('/design/123') ? { defaultInstanceId: 456 } : { url }));
    await assert.rejects(client.makerWorldDownload(printer, '123'), /Unsupported/);
  }
});

test('Bambu renewal uses refreshToken and retries once; failures remain bounded', async t => {
  let renewals = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/refreshtoken')) {
      renewals++;
      assert.deepEqual(JSON.parse(options.body), { refreshToken: 'mock-refresh' });
      return Response.json({ accessToken: 'mock-new', refreshToken: 'mock-rotated' });
    }
    if (options.headers.authorization !== 'Bearer mock-new') return new Response('{}', { status: 401 });
    return Response.json(url.endsWith('/preference') ? { uid: 123 } : { devices: [] });
  });
  const session = await client.fetchBambuCloudSession({ ...printer, cloud_refresh_token: 'mock-refresh' });
  assert.equal(session.token, 'mock-new');
  assert.equal(session.refreshToken, 'mock-rotated');
  assert.equal(renewals, 1);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  await assert.rejects(client.fetchBambuCloudSession({ ...printer, cloud_refresh_token: 'mock-refresh' }), /401/);
});

test('concurrent validation shares renewal and logout cannot restore credentials', async t => {
  const saved = { ...printer, id: 'saved-mock', cloud_refresh_token: 'mock-refresh' };
  const store = client.usePrinterConnectionStore;
  store.setState({ printers: [saved] });
  let finish;
  let renewals = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/refreshtoken')) {
      renewals++;
      await new Promise(resolve => { finish = resolve; });
      return Response.json({ accessToken: 'new-mock', refreshToken: 'new-refresh' });
    }
    if (options.headers.authorization !== 'Bearer new-mock') return new Response('{}', { status: 401 });
    return Response.json(url.endsWith('/preference') ? { uid: 123 } : { devices: [] });
  });
  const first = client.fetchBambuCloudSession(saved);
  const second = client.fetchBambuCloudSession(saved);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal(renewals, 1);
  finish();
  await Promise.all([first, second]);
  assert.equal(store.getState().printers[0].printhost_apikey, 'new-mock');
  store.setState({ printers: [saved] });
  finish = undefined;
  const pending = client.fetchBambuCloudSession(saved);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  store.setState({ printers: [{ ...saved, printhost_apikey: undefined, cloud_refresh_token: undefined }] });
  finish();
  await assert.rejects(pending, /superseded/);
  assert.equal(store.getState().printers[0].printhost_apikey, undefined);
  store.setState({ printers: [] });
});
