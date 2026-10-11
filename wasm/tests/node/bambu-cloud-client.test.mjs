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
  const bundle = await build({ entryPoints: [new URL('../../app/src/printers/bambuCloud.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false });
  const filename = join(directory, 'client.mjs');
  await writeFile(filename, bundle.outputFiles[0].text);
  client = await import(pathToFileURL(filename));
});
after(async () => rm(directory, { recursive: true, force: true }));

test('login uses email and exactly one credential, validates UID and bound devices', async t => {
  const requests = [];
  let response = { accessToken: 'fixture-token' };
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
