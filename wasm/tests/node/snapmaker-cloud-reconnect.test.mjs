import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

test('Snapmaker return restores monitoring and failure preserves the last successful display', async () => {
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};
globalThis.window = { localStorage, location: { href: 'https://fixture.invalid/' } };
class Socket {
  static all = [];
  constructor() { Socket.all.push(this); }
  send() {}
  close() {}
}
globalThis.WebSocket = Socket;
globalThis.fetch = async url => new Response(JSON.stringify(url.endsWith('/account')
  ? { code: 200, data: { id: 'fixture-account' } }
  : { code: 0, data: [{ deviceId: 'D', name: 'Synthetic printer' }] }));
const bundled = await build({
  stdin: {
    contents: "export * from './src/printers/session'; export {usePrinterConnectionStore} from './src/printers/connectionStore';",
    resolveDir: new URL('../../app', import.meta.url).pathname
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'locale', setup(builder) {
    builder.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'locale', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const translate=s=>s;' }));
  } }],
  banner: { js: `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(new URL('../../app/package.json', import.meta.url).href)});` }
});
const { startPrinterSession, reconnectPrinterSession, usePrinterConnectionStore: store } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const printer = {
  id: 'fixture', name: 'Fixture', host_type: 'snapmaker-cloud', print_host: 'id.snapmaker.com',
  cloud_region: 'global', cloud_account: 'fixture@example.invalid', printhost_apikey: 'access',
  cloud_refresh_token: 'refresh', cloud_device_id: 'D', use_gateway: true
};
store.setState({ printers: [printer], selectedPrinterId: printer.id, snapmakerSessions: [], deviceTabActive: true });
startPrinterSession();
await new Promise(resolve => setImmediate(resolve));
assert.equal(Socket.all.length, 1);
const socket = Socket.all[0];
socket.onopen();
socket.onmessage({ data: JSON.stringify({ type: 'snapshot', objects: { print_stats: { state: 'printing' } } }) });
assert.equal(store.getState().status, 'online');
socket.onclose({});
assert.equal(store.getState().status, 'error');
assert.equal(store.getState().liveState, null);
assert.equal(store.getState().cachedState.state, 'printing');
store.getState().selectPrinter(printer.id);
store.getState().setDeviceTabActive(false);
store.getState().setDeviceTabActive(true);
store.getState().savePrinter({ ...printer });
assert.match(await store.getState().activeApi.test(), /verified/);
await new Promise(resolve => setImmediate(resolve));
assert.equal(Socket.all.length, 2);
assert.equal(store.getState().status, 'connecting');
assert.equal(typeof reconnectPrinterSession, 'function', 'the failed session needs an explicit retry action');
reconnectPrinterSession();
assert.equal(store.getState().status, 'connecting');
assert.equal(store.getState().liveState, null);
reconnectPrinterSession(); // A second click during setup must not create another connection.
await new Promise(resolve => setImmediate(resolve));
assert.equal(Socket.all.length, 2);
const retried = Socket.all[1];
retried.onopen();
retried.onmessage({ data: JSON.stringify({ type: 'snapshot', objects: { print_stats: { state: 'printing' }, heater_bed: { temperature: 45, target: 60 } } }) });
assert.equal(store.getState().status, 'online');
assert.equal(store.getState().liveState.heaters[0].current, 45);
reconnectPrinterSession(); // Healthy sessions do not reconnect.
await new Promise(resolve => setImmediate(resolve));
assert.equal(Socket.all.length, 2);
store.getState().selectPrinter('absent');
});
