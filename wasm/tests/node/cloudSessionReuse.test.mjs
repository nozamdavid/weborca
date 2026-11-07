import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

let client;
let directory;
let clientUrl;
const storage = new Map();
const prusa = { id: 'fixture', name: 'Edited name', host_type: 'prusaconnect', print_host: 'connect.prusa3d.com',
  use_gateway: true, printhost_apikey: 'fixture-access', cloud_refresh_token: 'fixture-refresh', cloud_device_id: 'device' };
const response = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const validate = (printer = prusa, signal = new AbortController().signal) => client.validateCloudSession(printer, signal);

before(async () => {
  // In-memory synthetic storage only. Never read a browser profile or credential file.
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.window = { localStorage: globalThis.localStorage, matchMedia: () => ({ matches: false }) };
  const result = await build({ stdin: { contents: `export * from './src/printers/cloudSessionReuse';
    export { usePrinterConnectionStore } from './src/printers/connectionStore';
    export { PrusaConnectApi } from './src/printers/prusaConnect';
    export { submitPrusaConnectLogin, completePrusaConnectLogin } from './src/printers/prusaConnect';
    export { PrusaConnectLogin } from './src/printers/PrusaConnectLogin';
    export { CrealityCloudLogin } from './src/printers/CrealityCloudLogin';
    export { renderToStaticMarkup } from 'react-dom/server';
    export { createElement } from 'react';`, resolveDir: new URL('../../app', import.meta.url).pathname },
    bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.css': 'empty' },
    plugins: [{ name: 'static-login-controls', setup(build) {
      // SSR needs only labels and native controls, not locale loading or the portal-based select menu.
      build.onResolve({ filter: /\/(i18n|MobileSelect|useMobile)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'i18n'
        ? 'export const translate = key => key; export const useTranslation = () => ({ t: key => key });'
        : args.path === 'useMobile' ? 'export const useMobile = () => false;'
        : `import React from 'react'; export const MobileSelect = ({ onValueChange, ...props }) => React.createElement('select', { ...props, onChange() {} });`,
        resolveDir: new URL('../../app', import.meta.url).pathname }));
    } }],
    banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(new URL('../../app/package.json', import.meta.url).href)});` } });
  directory = await mkdtemp(join(tmpdir(), 'orca-session-reuse-'));
  const compiled = join(directory, 'client.mjs');
  await writeFile(compiled, result.outputFiles[0].text);
  clientUrl = pathToFileURL(compiled).href;
  client = await import(clientUrl);
});
after(async () => { delete globalThis.localStorage; delete globalThis.window; if (directory) await rm(directory, { recursive: true, force: true }); });
beforeEach(() => {
  storage.clear();
  client.usePrinterConnectionStore.setState({ printers: [], selectedPrinterId: null, prusaSessions: [] });
});

test('Prusa login without selecting or saving a printer survives browser reload', async t => {
  t.mock.method(globalThis, 'fetch', async url => response(url.endsWith('/auth/password')
    ? { access_token: 'login-access', refresh_token: 'login-refresh' }
    : url.endsWith('/login') ? { user: { public_name: 'Fixture account' } }
    : { printers: [{ uuid: 'device', name: 'Fixture printer' }] }));
  await client.submitPrusaConnectLogin(undefined, 'synthetic-state', { email: 'fixture@example.invalid', password: 'synthetic-password' });
  const persisted = storage.get('orca-printers');
  const fresh = await import(`${clientUrl}?login-reload`);
  const store = fresh.usePrinterConnectionStore;
  const source = fresh.savedCloudSession({ ...prusa, printhost_apikey: undefined, cloud_refresh_token: undefined }, store.getState().printers);
  assert.ok(source, 'fresh client must find the browser-saved login before any Printer Save');
  const session = await fresh.validateCloudSession(source, new AbortController().signal);
  const html = fresh.renderToStaticMarkup(fresh.createElement(fresh.PrusaConnectLogin, { initialSession: session.data, onSelectPrinter() {} }));
  assert.ok(html.includes('Fixture printer'));
  assert.ok(!html.includes('type="password"'));
  assert.deepEqual(store.getState().printers, []);
  assert.equal(store.getState().selectedPrinterId, null);
  assert.ok(!persisted.includes('synthetic-password'));
  assert.ok(!persisted.includes('synthetic-state'));
});

test('manual token exchange persists before profile failure and excludes login secrets', async t => {
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/auth/complete')
    ? response({ access_token: 'manual-access', refresh_token: 'manual-refresh', expires_in: 100, password: 'must-not-persist' })
    : response({}, 503));
  await client.completePrusaConnectLogin({ local_gateway: 'https://fixture.invalid' },
    { pasted: 'synthetic-callback', state: 'synthetic-state', verifier: 'synthetic-verifier' });
  const store = client.usePrinterConnectionStore;
  const draft = { ...prusa, local_gateway: 'https://fixture.invalid', printhost_apikey: undefined };
  const source = client.savedCloudSession(draft, []);
  assert.equal(source.printhost_apikey, 'manual-access');
  await assert.rejects(validate(source));
  assert.equal(client.savedCloudSession(draft, []).printhost_apikey, 'manual-access');
  const serialized = storage.get('orca-printers');
  for (const secret of ['must-not-persist', 'synthetic-callback', 'synthetic-state', 'synthetic-verifier', 'expires_in'])
    assert.ok(!serialized.includes(secret));
  assert.deepEqual(store.getState().printers, []);
  assert.equal(store.getState().selectedPrinterId, null);
});

test('cached account restores the same unsaved draft device after switching hosts', async t => {
  const store = client.usePrinterConnectionStore;
  store.getState().savePrusaSession({ ...prusa, printhost_apikey: 'cached-access', cloud_refresh_token: 'cached-refresh' });
  const returning = { ...prusa, printhost_apikey: undefined, cloud_refresh_token: undefined,
    cloud_device_id: undefined, serial: undefined, cloud_team_id: undefined };
  const source = client.savedCloudSession(returning, [{ ...prusa, cloud_team_id: '42' }]);
  assert.equal(source.printhost_apikey, 'cached-access', 'latest account tokens take precedence over draft tokens');
  t.mock.method(globalThis, 'fetch', async url => response(url.endsWith('/login') ? { user: {} } :
    { printers: [{ uuid: 'device', name: 'Chosen device', team_id: 42 }] }));
  const restored = client.applyCloudSession(returning, await validate(source));
  assert.equal(restored.cloud_device_id, 'device');
  assert.equal(restored.cloud_team_id, '42');
  assert.equal(restored.id, returning.id);
  assert.equal(restored.name, returning.name);
  assert.deepEqual(store.getState().printers, []);
  assert.equal(store.getState().selectedPrinterId, null);
  const unrelated = client.savedCloudSession(returning, [{ ...prusa, id: 'another-printer' }]);
  assert.equal(unrelated.cloud_device_id, undefined, 'another connection must not supply a device selection');
});

test('independent account rotation survives timeout and reload; rejection stops reuse', async t => {
  const store = client.usePrinterConnectionStore;
  store.getState().savePrusaSession(prusa);
  const source = client.savedCloudSession({ ...prusa, printhost_apikey: undefined }, []);
  const timeout = new AbortController();
  const timeoutMock = t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/login')) return response({ user: {} }, 200,
      { 'x-prusa-access-token': 'independent-rotated', 'x-prusa-refresh-token': 'independent-refresh' });
    timeout.abort(new DOMException('Synthetic timeout', 'TimeoutError'));
    throw timeout.signal.reason;
  });
  await assert.rejects(validate(source), { name: 'TimeoutError' });
  const persisted = storage.get('orca-printers');
  store.setState({ prusaSessions: [] });
  storage.set('orca-printers', persisted);
  await store.persist.rehydrate();
  const reloaded = client.savedCloudSession({ ...prusa, printhost_apikey: undefined }, []);
  assert.equal(reloaded.cloud_refresh_token, 'independent-refresh');
  timeoutMock.mock.restore();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.ok(options.headers.Authorization === 'Bearer independent-rotated');
    return response({}, 403);
  });
  await assert.rejects(validate(reloaded), error => client.rejectedCloudSession(error));
  assert.equal(client.savedCloudSession({ ...prusa, printhost_apikey: undefined }, []), undefined);
  assert.deepEqual(store.getState().printers, []);
  assert.equal(store.getState().selectedPrinterId, null);
});

test('independent sessions isolate exact scopes/accounts and replace only the same account', () => {
  const store = client.usePrinterConnectionStore;
  store.getState().savePrusaSession({ ...prusa, cloud_account: 'A' });
  store.getState().savePrusaSession({ ...prusa, cloud_account: 'B', printhost_apikey: 'b' });
  store.getState().savePrusaSession({ ...prusa, cloud_account: 'A', printhost_apikey: 'new-a' });
  assert.equal(store.getState().prusaSessions.length, 2);
  const blank = { ...prusa, printhost_apikey: undefined, cloud_account: 'A' };
  assert.equal(client.savedCloudSession(blank, []).printhost_apikey, 'new-a');
  for (const changed of [{ host_type: 'bambu-cloud' }, { print_host: 'other.invalid' }, { cloud_region: 'china' },
{ cloud_account: 'C' }])
    assert.equal(client.savedCloudSession({ ...blank, ...changed }, []), undefined);
});

for (const mode of ['headers', 'explicit-refresh']) {
  test(`${mode}: rotation is persisted before the printer list completes or the caller closes`, async t => {
    const store = client.usePrinterConnectionStore;
    store.setState({ printers: [prusa], selectedPrinterId: 'unchanged' });
    store.getState().savePrusaSession(prusa);
    const source = client.savedCloudSession({ ...prusa, printhost_apikey: undefined }, [prusa]);
    let releaseList;
    let started;
    const listStarted = new Promise(resolve => { started = resolve; });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url.endsWith('/auth/refresh')) return response({ access_token: 'immediate-access', refresh_token: 'immediate-refresh' });
      if (url.endsWith('/login')) {
        if (mode === 'explicit-refresh' && options.headers.Authorization === 'Bearer fixture-access') return response({}, 401);
        return response({ user: {} }, 200, mode === 'headers'
          ? { 'x-prusa-access-token': 'immediate-access', 'x-prusa-refresh-token': 'immediate-refresh' } : {});
      }
      return new Promise(resolve => { releaseList = resolve; started(); });
    });
    const controller = new AbortController();
    const pending = validate(source, controller.signal);
    await listStarted;
    const persisted = JSON.parse(storage.get('orca-printers')).state;
    assert.equal(persisted.prusaSessions[0].cloud_refresh_token, 'immediate-refresh');
    assert.equal(persisted.printers[0].cloud_refresh_token, 'immediate-refresh');
    assert.equal(persisted.selectedPrinterId, 'unchanged');
    // Reload/close before the list resolves must retain credentials already accepted.
    controller.abort();
    releaseList(response({ printers: [] }));
    await assert.rejects(pending, { name: 'AbortError' });
    const fresh = await import(`${clientUrl}?pending-rotation-${mode}`);
    const restored = fresh.savedCloudSession({ ...prusa, printhost_apikey: undefined }, fresh.usePrinterConnectionStore.getState().printers);
    assert.equal(restored.cloud_refresh_token, 'immediate-refresh');
  });
}

test('independent cache ignores canceled and superseded validation including stale rejection', async t => {
  const store = client.usePrinterConnectionStore;
  for (const mode of ['canceled', 'rejected', 'rotated', 'unchanged']) {
    store.setState({ prusaSessions: [] });
    store.getState().savePrusaSession(prusa);
    const source = client.savedCloudSession({ ...prusa, printhost_apikey: undefined }, []);
    let finish;
    t.mock.method(globalThis, 'fetch', url => url.endsWith('/login')
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response({ printers: [] })));
    const controller = new AbortController();
    const pending = client.validateCloudSession(source, controller.signal, () => assert.fail('stale validation must not publish credentials'));
    if (mode === 'canceled') controller.abort();
    store.getState().savePrusaSession({ ...prusa, printhost_apikey: 'newer', cloud_refresh_token: 'newer-refresh' });
    finish(response({ user: {} }, mode === 'rejected' ? 403 : 200,
      mode === 'unchanged' ? {} : { 'x-prusa-access-token': 'stale' }));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(store.getState().prusaSessions[0].printhost_apikey, 'newer');
    assert.equal(store.getState().prusaSessions[0].cloud_refresh_token, 'newer-refresh');
  }
});

test('version 1 saved printers rehydrate without account sessions and still refresh', async t => {
  const store = client.usePrinterConnectionStore;
  storage.set('orca-printers', JSON.stringify({ version: 1, state: { printers: [prusa], selectedPrinterId: prusa.id } }));
  await store.persist.rehydrate();
  assert.deepEqual(store.getState().prusaSessions, []);
  const source = client.savedCloudSession({ ...prusa, printhost_apikey: undefined }, store.getState().printers);
  t.mock.method(globalThis, 'fetch', async url => response(url.endsWith('/login') ? { user: {} } : { printers: [] }, 200,
    { 'x-prusa-access-token': 'legacy-rotated' }));
  await validate(source);
  assert.equal(store.getState().printers[0].printhost_apikey, 'legacy-rotated');
  assert.equal(store.getState().selectedPrinterId, prusa.id);
});

test('independent account and saved printer share rotations without changing selection', async t => {
  const store = client.usePrinterConnectionStore;
  store.getState().savePrusaSession(prusa);
  store.getState().savePrinter(prusa);
  const source = client.savedCloudSession({ ...prusa, printhost_apikey: undefined }, store.getState().printers);
  t.mock.method(globalThis, 'fetch', async () => response({}, 200,
    { 'x-prusa-access-token': 'api-rotated', 'x-prusa-refresh-token': 'api-refresh' }));
  await new client.PrusaConnectApi({ ...source, cloud_device_id: 'device' }).test();
  assert.equal(store.getState().prusaSessions[0].cloud_refresh_token, 'api-refresh');
  assert.equal(store.getState().printers[0].cloud_refresh_token, 'api-refresh');
  const persisted = storage.get('orca-printers');
  store.setState({ printers: [], selectedPrinterId: null, prusaSessions: [] });
  storage.set('orca-printers', persisted);
  await store.persist.rehydrate();
  assert.equal(store.getState().selectedPrinterId, prusa.id);
  assert.equal(client.savedCloudSession({ ...prusa, printhost_apikey: undefined }, store.getState().printers).printhost_apikey, 'api-rotated');
});

test('saved valid Prusa token populates choices without password login and preserves draft identity', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return response(url.endsWith('/login') ? { user: { public_name: 'Fixture account' } } :
      { printers: [{ uuid: 'device', name: 'Fixture printer' }] });
  });
  const session = await validate();
  const html = client.renderToStaticMarkup(client.createElement(client.PrusaConnectLogin, { initialSession: session.data, onSelectPrinter() {} }));
  assert.ok(html.includes('Fixture printer'));
  assert.ok(!html.includes('type="password"'));
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => !r.options.method && r.options.signal));
  const draft = client.applyCloudSession(prusa, session);
  assert.equal(draft.id, prusa.id);
  assert.equal(draft.name, prusa.name);
  assert.equal(draft.cloud_device_id, 'device');
  const cached = client.applyCloudSession({ ...prusa, cloud_device_id: undefined, cloud_team_id: undefined },
    { ...session, credentials: { ...prusa, cloud_team_id: '42' } });
  assert.equal(cached.cloud_device_id, 'device');
  assert.equal(cached.cloud_team_id, '42');
});

test('missing/rejected token offers login; network/server failures retain credentials for retry', async t => {
  assert.equal(client.savedCloudSession({ ...prusa, printhost_apikey: undefined }, []), undefined);
  const html = client.renderToStaticMarkup(client.createElement(client.PrusaConnectLogin, { onSelectPrinter() {} }));
  assert.ok(html.includes('type="password"'));
  const store = client.usePrinterConnectionStore;
  store.setState({ printers: [prusa], selectedPrinterId: 'other' });
  for (const status of [401, 403, 500]) {
    store.setState({ printers: [{ ...prusa, cloud_refresh_token: undefined }] });
    t.mock.method(globalThis, 'fetch', async () => response({}, status));
    await assert.rejects(validate({ ...prusa, cloud_refresh_token: undefined }), error => {
      assert.equal(client.rejectedCloudSession(error), status !== 500);
      return true;
    });
    assert.equal(store.getState().printers[0].printhost_apikey, status === 500 ? 'fixture-access' : undefined);
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Synthetic offline'); });
  await assert.rejects(validate(), error => !client.rejectedCloudSession(error));
});

test('Prusa refresh stays browser-side, does not save drafts or change selected printer', async t => {
  const store = client.usePrinterConnectionStore;
  const requests = [];
  const fixtureFetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/auth/refresh')) return response({ access_token: 'replacement', refresh_token: 'replacement-refresh' });
    if (options.headers.Authorization === 'Bearer fixture-access') return response({}, 401);
    return response(url.endsWith('/login') ? { user: { name: 'Fixture' } } : { printers: [] });
  };
  t.mock.method(globalThis, 'fetch', fixtureFetch);
  store.setState({ printers: [], selectedPrinterId: 'other' });
  const session = await validate();
  assert.equal(session.data.tokens.access_token, 'replacement');
  assert.deepEqual(store.getState().printers, []);
  store.setState({ printers: [prusa] });
  await validate();
  assert.equal(store.getState().printers[0].printhost_apikey, 'replacement');
  assert.equal(store.getState().selectedPrinterId, 'other');
  assert.equal(requests.filter(r => r.url.endsWith('/auth/refresh')).length, 2);
  // The pre-existing PrinterApi refresh header path must also never insert a draft.
  store.setState({ printers: [] });
  t.mock.method(globalThis, 'fetch', async () => response({}, 200, { 'x-prusa-access-token': 'header-replacement' }));
  await new client.PrusaConnectApi({ ...prusa }).test();
  assert.deepEqual(store.getState().printers, []);
  assert.equal(store.getState().selectedPrinterId, 'other');
  store.setState({ printers: [{ ...prusa }] });
  await new client.PrusaConnectApi(store.getState().printers[0]).test();
  assert.equal(store.getState().printers[0].printhost_apikey, 'header-replacement', 'shared saved record is updated through the store');
  assert.equal(store.getState().selectedPrinterId, 'other');
});

test('rotated Prusa credentials survive later device errors; rejected refresh requires sign-in', async t => {
  const store = client.usePrinterConnectionStore;
  store.setState({ printers: [prusa], selectedPrinterId: 'other' });
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/login')
    ? response({ user: {} }, 200, { 'x-prusa-access-token': 'rotated', 'x-prusa-refresh-token': 'rotated-refresh' })
    : response({}, 503));
  await assert.rejects(validate(), error => !client.rejectedCloudSession(error));
  assert.equal(store.getState().printers[0].cloud_refresh_token, 'rotated-refresh');
  assert.equal(store.getState().selectedPrinterId, 'other');
  store.setState({ printers: [] });
  let draftTokens;
  await assert.rejects(client.validateCloudSession(prusa, new AbortController().signal, tokens => { draftTokens = tokens; }));
  assert.equal(draftTokens.refresh_token, 'rotated-refresh', 'unsaved draft keeps rotated credentials for a retry');
  assert.deepEqual(store.getState().printers, []);
  t.mock.method(globalThis, 'fetch', async url => response({}, url.endsWith('/auth/refresh') ? 400 : 401));
  await assert.rejects(validate(), error => client.rejectedCloudSession(error));
});

test('provider, region and account matching is deterministic and prefers current credentials', () => {
  const blank = { ...prusa, id: 'new', printhost_apikey: undefined };
  const first = { ...prusa, id: 'a' };
  assert.equal(client.savedCloudSession(blank, [{ ...prusa, id: 'z' }, first]).id, 'a');
  assert.equal(client.savedCloudSession(prusa, [first]), prusa);
  for (const changed of [{ host_type: 'bambu-cloud' }, { print_host: 'other.invalid' }, { cloud_region: 'china' },
{ cloud_account: 'another-account' }])
    assert.equal(client.savedCloudSession({ ...blank, ...changed }, [prusa]), undefined);
});

test('Prusa rotation survives device-list timeout while the caller remains active', async t => {
  const store = client.usePrinterConnectionStore;
  store.setState({ printers: [prusa], selectedPrinterId: 'other' });
  const timeout = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/login')) return response({ user: {} }, 200,
      { 'x-prusa-access-token': 'rotated', 'x-prusa-refresh-token': 'rotated-refresh' });
    timeout.abort(new DOMException('Synthetic timeout', 'TimeoutError'));
    throw timeout.signal.reason;
  });
  let draftTokens;
  await assert.rejects(client.validateCloudSession(prusa, new AbortController().signal,
    tokens => { draftTokens = tokens; }), { name: 'TimeoutError' });
  assert.equal(store.getState().printers[0].cloud_refresh_token, 'rotated-refresh');
  assert.equal(draftTokens.refresh_token, 'rotated-refresh');
  assert.equal(store.getState().selectedPrinterId, 'other');
});

test('Creality validates later device pages before preserving or clearing the saved selection', async t => {
  const printer = { ...prusa, host_type: 'creality-cloud', print_host: 'api.crealitycloud.com',
    printhost_user: 'fixture-user', serial: 'DN51', cloud_device_id: 'TB51' };
  const pages = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { page } = JSON.parse(options.body);
    pages.push(page);
    const list = page === 1 ? Array.from({ length: 50 }, (_, i) =>
      ({ type: 1, deviceName: `DN${i}`, tbId: `TB${i}` })) : [{ type: 1, deviceName: 'DN51', tbId: 'TB51' }];
    return response({ code: 0, result: { totalCount: 51, list } });
  });
  const session = await validate(printer);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(session.data.length, 51);
  assert.equal(client.applyCloudSession(printer, session).cloud_device_id, 'TB51');
  assert.equal(client.applyCloudSession(printer, session).serial, 'DN51');
  t.mock.method(globalThis, 'fetch', async () => response({ code: 0, result: { totalCount: 1001, list: [] } }));
  await assert.rejects(validate(printer), error => !client.rejectedCloudSession(error));
});

test('Bambu/Creality use bounded existing device APIs and hydrate authenticated choices', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return response(url.endsWith('/preference') ? { uid: 123 } : url.endsWith('/bind') ?
      { devices: [{ dev_id: 'SER123', name: 'Fixture Bambu' }] } :
      { code: 0, result: { list: [{ type: 1, deviceName: 'DN123', tbId: 'TB123', aliasName: 'Fixture Creality' }] } });
  });
  const bambu = await validate({ ...prusa, host_type: 'bambu-cloud', print_host: 'us.mqtt.bambulab.com', serial: 'SER123' });
  assert.equal(bambu.data.username, 'u_123');
  assert.equal(client.applyCloudSession({ ...prusa, serial: 'SER123' }, bambu).serial, 'SER123');
  const creality = await validate({ ...prusa, host_type: 'creality-cloud', print_host: 'api.crealitycloud.cn', cloud_region: 'china',
    printhost_user: '123', local_gateway: 'http://fixture.invalid' });
  assert.ok(requests.at(-1).url.startsWith('/_printer/creality-cloud/china/api/'));
  const html = client.renderToStaticMarkup(client.createElement(client.CrealityCloudLogin, {
    initialSession: { session: { token: 'fixture-access', userId: '123' }, devices: creality.data }, onSelectDevice() {} }));
  assert.ok(html.includes('Fixture Creality'));
  assert.ok(!html.includes('type="password"'));
  assert.ok(requests.every(r => r.options.signal));
  const count = requests.length;
  await assert.rejects(validate({ ...prusa, host_type: 'bambu-cloud', print_host: 'cn.mqtt.bambulab.com' }), /unavailable/);
  assert.equal(requests.length, count, 'China Bambu credentials never reach global API');
});

test('stale async validation is discarded after switch/close, including rotating token writes', async t => {
  const store = client.usePrinterConnectionStore;
  store.setState({ printers: [prusa], selectedPrinterId: 'other' });
  let finish;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = validate(prusa, controller.signal);
  controller.abort();
  finish(response({ user: {} }, 200, { 'x-prusa-access-token': 'stale-token' }));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(store.getState().printers[0].printhost_apikey, prusa.printhost_apikey);
  assert.equal(store.getState().selectedPrinterId, 'other');
});

const snapmaker = { ...prusa, host_type: 'snapmaker-cloud', print_host: 'id.snapmaker.com', cloud_region: 'global', cloud_account: 'fixture@example.invalid' };
test('Snapmaker login before selection survives reload and list failure with isolated scope', async t => {
  // Login is exercised through the same cache action as the client; exact exchange is in snapmaker-cloud-client.test.mjs.
  const store=client.usePrinterConnectionStore;
  store.setState({snapmakerSessions:[]});
  store.getState().saveSnapmakerSession(snapmaker);
  const persisted=storage.get('orca-printers');
  const fresh=await import(`${clientUrl}?snapmaker-before-save`);
  const draft={...snapmaker,printhost_apikey:undefined,cloud_refresh_token:undefined};
  const source=fresh.savedCloudSession(draft,[]);
  assert.equal(source.printhost_apikey,snapmaker.printhost_apikey);
  t.mock.method(globalThis,'fetch',async url=>url.endsWith('/account')?response({code:200,data:{id:'A'}}):response({},503));
  await assert.rejects(fresh.validateCloudSession(source,new AbortController().signal));
  assert.equal(fresh.savedCloudSession(draft,[]).cloud_refresh_token,snapmaker.cloud_refresh_token);
  assert.deepEqual(fresh.usePrinterConnectionStore.getState().printers,[]);
  assert.ok(!persisted.includes('Edited name'));
  for(const changed of [{host_type:'prusaconnect'},{print_host:'api.snapmaker.com'},{cloud_region:'china'},{cloud_account:'other'}])
    assert.equal(fresh.savedCloudSession({...draft,...changed},[]),undefined);
});

test('Snapmaker refresh persists before pending list; cancellation and complete list protect selection',async t=>{
  const store=client.usePrinterConnectionStore;store.setState({snapmakerSessions:[]});store.getState().saveSnapmakerSession(snapmaker);
  let finish,started;const waiting=new Promise(r=>started=r);
  t.mock.method(globalThis,'fetch',async(url,o)=>{
    if(url.endsWith('/auth/refresh'))return response({code:200,data:{access_token:'snap-rotated',refresh_token:'snap-renewed'}});
    if(o.headers.Authorization===`Bearer ${snapmaker.printhost_apikey}`)return response({},401);
    if(url.endsWith('/account'))return response({code:200,data:{id:'A'}});
    return new Promise(r=>{finish=r;started();});
  });
  const controller=new AbortController();const pending=validate(snapmaker,controller.signal);await waiting;
  assert.equal(JSON.parse(storage.get('orca-printers')).state.snapmakerSessions[0].cloud_refresh_token,'snap-renewed');
  controller.abort();finish(response({code:0,data:[]}));await assert.rejects(pending,{name:'AbortError'});
  const source=client.savedCloudSession({...snapmaker,printhost_apikey:undefined},[]);
  t.mock.method(globalThis,'fetch',async url=>response(url.endsWith('/account')?{code:200,data:{id:'A'}}:{code:0,data:[{deviceId:'device',name:'Fixture',sn:'SN'}]}));
  const session=await validate(source);
  assert.equal(client.applyCloudSession({...snapmaker,cloud_device_id:undefined},session).cloud_device_id,'device');
  assert.equal(client.applyCloudSession({...snapmaker,cloud_device_id:'missing'},session).cloud_device_id,undefined);
  // A replacement session while an old account response is pending must defeat late auth rejection.
  let late;t.mock.method(globalThis,'fetch',()=>new Promise(r=>late=r));const stale=validate(source);
  store.getState().saveSnapmakerSession({...source,printhost_apikey:'newest'});late(response({},401));
  await assert.rejects(stale,{name:'AbortError'});assert.equal(store.getState().snapmakerSessions[0].printhost_apikey,'newest');
});

test('Snapmaker host switch restores the unsaved device and keeps only allowlisted account cache fields',async t=>{
  const store=client.usePrinterConnectionStore;
  const unsaved={...snapmaker,id:'unsaved-draft',name:'Edited draft',cloud_device_id:'D',serial:'SN',
    printhost_password:'synthetic-password',cookie:'synthetic-cookie',code:'synthetic-code',devices:[{deviceId:'secret-device'}]};
  store.setState({printers:[],snapmakerSessions:[],selectedPrinterId:null});
  store.getState().saveSnapmakerSession(unsaved);
  const cache=JSON.parse(storage.get('orca-printers')).state.snapmakerSessions[0];
  assert.deepEqual(Object.keys(cache).sort(),['host_type','print_host','cloud_region','cloud_account','printhost_apikey','cloud_refresh_token'].sort());
  const switchedBack={...snapmaker,id:'unsaved-draft',name:'Edited draft',printhost_apikey:undefined,cloud_refresh_token:undefined,
    cloud_account:undefined,cloud_device_id:undefined,serial:undefined};
  const source=client.savedCloudSession(switchedBack,[unsaved]);
  t.mock.method(globalThis,'fetch',async url=>response(url.endsWith('/account')?{code:200,data:{id:'A'}}:{code:200,data:[{deviceId:'D',name:'Fixture',sn:'SN'}]}));
  const restored=client.applyCloudSession(switchedBack,await validate(source));
  assert.equal(restored.cloud_device_id,'D');assert.equal(restored.serial,'SN');
  assert.equal(restored.id,'unsaved-draft');assert.equal(restored.name,'Edited draft');
  assert.deepEqual(store.getState().printers,[]);assert.equal(store.getState().selectedPrinterId,null);
});
