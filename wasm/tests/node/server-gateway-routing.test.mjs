import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

// Run real URL builders and persistence against synthetic browser state, without network I/O.
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
globalThis.window = { location: new URL('https://app.example/'), matchMedia: () => ({ matches: false }) };
const result = await build({ stdin: { contents: `export * from './src/printers/gatewayUrl';
  export { crealityCloudGatewayUrl } from './src/printers/crealityCloud';
  export { startPrusaConnectLogin } from './src/printers/prusaConnect';
  export { sendSnapmakerCode } from './src/printers/snapmakerCloud';
  export { cloudScope } from './src/printers/cloudSessionReuse';
  export { usePrinterConnectionStore, samePrusaScope } from './src/printers/connectionStore';`,
  resolveDir: new URL('../../app', import.meta.url).pathname }, bundle: true, write: false,
  platform: 'node', format: 'esm', plugins: [{ name: 'locale-stub', setup(build) {
    build.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const translate = key => key;' }));
  } }] });
const client = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const printer = { id: 'saved', name: 'Keep me', host_type: 'moonraker', print_host: '192.168.1.2',
  use_gateway: true, printhost_apikey: 'synthetic-token', cloud_refresh_token: 'synthetic-refresh',
  filamentPresets: ['PLA'], octoeverywhere: { mode: 'local', connectionId: 'preserve' } };

test('legacy gateway URLs cannot redirect HTTP, MQTT, FTP, cloud auth or status away from the app', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => { calls.push(String(url)); return Response.json({ code: 200 }); };
  try {
    for (const use_gateway of [true, false]) for (const local_gateway of ['http://127.0.0.1:5199', 'https://evil.example/base/', '//evil.example', 'not a URL']) {
      const p = { ...printer, local_gateway, use_gateway };
      assert.equal(client.httpUrl(p, '/api'), '/_printer/http/192.168.1.2/api');
      assert.equal(client.wsUrl(p, '/websocket'), 'wss://app.example/_printer/ws/192.168.1.2/websocket');
      assert.equal(client.bambuMqttUrl(p), 'wss://app.example/_printer/bambu/mqtt/192.168.1.2');
      assert.equal(client.bambuCloudMqttUrl(p, 'broker.example'), 'wss://app.example/_printer/bambu-cloud/mqtt/broker.example');
      assert.equal(client.bambuFtpUrl(p), '/_printer/bambu/ftp/192.168.1.2');
      assert.equal(client.bambuCloudApiUrl(p, '/devices'), '/_printer/bambu-cloud/api/devices');
      assert.equal(client.crealityCloudGatewayUrl(p, 'auth', '/login'), '/_printer/creality-cloud/global/auth/login');
      await client.fetchGatewayStatus(local_gateway);
      await client.startPrusaConnectLogin(p);
      await client.sendSnapmakerCode({ ...p, host_type: 'snapmaker-cloud', print_host: 'id.snapmaker.com' }, 'synthetic@example.test', new AbortController().signal);
    }
    assert.ok(calls.length > 0);
    assert.ok(calls.every(url => url.startsWith('/_printer/')), calls.join('\n'));
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy configuration hydration preserves settings and account tokens while discarding gateway addresses', async () => {
  for (const version of [0, 1, 2]) {
    const legacy = { ...printer, local_gateway: 'https://evil.example', use_gateway: false };
    values.set('orca-printers', JSON.stringify({ version, state: { printers: [legacy], selectedPrinterId: legacy.id,
      prusaSessions: [{ ...legacy, host_type: 'prusaconnect' }], snapmakerSessions: [{ ...legacy, host_type: 'snapmaker-cloud' }] } }));
    await client.usePrinterConnectionStore.persist.rehydrate();
    const state = client.usePrinterConnectionStore.getState();
    for (const record of [...state.printers, ...state.prusaSessions, ...state.snapmakerSessions]) {
      assert.equal(Object.hasOwn(record, 'local_gateway'), false);
      assert.equal(record.printhost_apikey, printer.printhost_apikey);
      assert.equal(record.cloud_refresh_token, printer.cloud_refresh_token);
    }
    assert.deepEqual(state.printers[0], printer);
    assert.equal(state.selectedPrinterId, printer.id);
    assert.equal(client.cloudScope(legacy), client.cloudScope(printer));
    assert.equal(client.samePrusaScope(legacy, printer), true);
  }
});

test('a missing backend is reported without suggesting a local program', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>static hosting</html>', { headers: { 'content-type': 'text/html' } });
  try {
    assert.equal(await client.fetchGatewayStatus(), undefined);
    assert.match(await client.describeFetchFailure(printer), /server has no printer gateway/i);
  } finally { globalThis.fetch = originalFetch; }
});
