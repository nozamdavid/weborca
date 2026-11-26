import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

const appDir = new URL('../../app', import.meta.url).pathname;
let directory;
let accountUrl;
let entryUrl;

const statusBody = (accountId = 'alice') => ({
  accountId, pending: false, outcome: accountId ? 'complete' : null, callback: null,
  callbackConfirmed: true, setup: 'configured', presetWrites: true,
});
const json = (value, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'content-type': 'application/json' } });
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

async function bundle(options, name) {
  const result = await build({ bundle: true, platform: 'node', format: 'esm', write: false, ...options });
  const compiled = join(directory, name);
  await writeFile(compiled, result.outputFiles[0].text);
  return pathToFileURL(compiled).href;
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-cloud-startup-'));
  accountUrl = await bundle({
    stdin: { contents: `export * from './src/orcaCloud/account'; export * from './src/presets/presetStorage';`, resolveDir: appDir, loader: 'ts' },
    loader: { '.css': 'empty' },
  }, 'account.mjs');

  // Exercise appEntry's real startup ordering and route handling with virtual
  // React/App/account modules. No browser or engine is involved.
  const fixtures = new Map([
    ['react', `const React = {
        StrictMode: Symbol('StrictMode'),
        createElement(type, props, ...children) { return { type, props: { ...props, children } }; }
      };
      export default React; export const StrictMode = React.StrictMode;`],
    ['react/jsx-runtime', `export const Fragment = Symbol('Fragment');
      export function jsx(type, props) { return { type, props }; }
      export const jsxs = jsx;`],
    ['react/jsx-dev-runtime', `export const Fragment = Symbol('Fragment');
      export function jsxDEV(type, props) { return { type, props }; }`],
    ['react-dom/client', `const root = {
        render(node) { globalThis.__startup.events.push('render'); globalThis.__startup.rendered = node; },
        unmount() { globalThis.__startup.events.push('unmount'); }
      };
      export function createRoot() { globalThis.__startup.events.push('createRoot'); return root; }
      export default { createRoot };`],
    ['./index.css', ''],
    ['./orcaCloud/account', `export function checkCloudSession(options) {
        const probe = globalThis.__startup;
        probe.events.push('check');
        probe.checks.push(options ?? {});
        return new Promise(() => {});
      }`],
    ['./App', `export default function App() { return null; }`],
    ['./orcaCloud/CloudCallback', `export function CloudCallback(props) { globalThis.__startup.callbackProps = props; return null; }`],
    ['./printers/OctoEverywhereCallback', `export function OctoEverywhereCallback() { return null; }`],
    ['./store/appStore', `const state = { isSlicing: false, isModelLoading: false, isSelectingPreset: false,
        pendingOptions: {}, sessionRecovery: 'idle', isEngineReady: false };
      export const useAppStore = { getState: () => state, setState() {} };
      export function stopAppStartup() { globalThis.__startup.events.push('stopAppStartup'); }`],
    ['./history', `export const useHistoryStore = { getState: () => ({ isRestoring: false }) };`],
    ['./shell/autosave', `export async function writeAutosave() {}
      export async function readAutosave() { return null; }`],
  ]);
  entryUrl = await bundle({
    entryPoints: [join(appDir, 'src/appEntry.tsx')],
    jsx: 'transform',
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'startup-fixtures',
      setup(build) {
        build.onResolve({ filter: /.*/ }, args => fixtures.has(args.path)
          ? { path: args.path, namespace: 'startup-fixture' } : undefined);
        build.onLoad({ filter: /.*/, namespace: 'startup-fixture' }, args => ({
          contents: fixtures.get(args.path), loader: args.path.endsWith('.css') ? 'empty' : 'js',
        }));
      },
    }],
  }, 'appEntry.mjs');

  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
    clear: () => storage.clear(),
  };
  globalThis.__storage = storage;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request: (_name, work) => work() } },
  });
  globalThis.location = { origin: 'https://app.example', href: 'https://app.example/', pathname: '/prepare' };
});

after(async () => {
  delete globalThis.localStorage;
  delete globalThis.__storage;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('startup renders before the optional cloud status request settles', async () => {
  const probe = { events: [], checks: [] };
  globalThis.__startup = probe;
  globalThis.window = {};
  globalThis.history = { replaceState() {} };
  globalThis.document = { getElementById: () => ({}) };
  globalThis.location = { origin: 'https://app.example', href: 'https://app.example/prepare', pathname: '/prepare' };
  const { start } = await import(`${entryUrl}?main`);
  const started = Date.now();
  const stop = await start();
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 1000, `startup must not wait for cloud status (${elapsed}ms)`);
  assert.deepEqual(probe.events.slice(0, 3), ['createRoot', 'render', 'check'], 'render precedes the cloud request');
  assert.equal(probe.checks.length, 1);
  assert.equal(probe.checks[0].timeoutMs, 8000);
  assert.ok(probe.checks[0].signal instanceof AbortSignal);

  await stop();
  assert.equal(probe.checks[0].signal.aborted, true, 'teardown cancels the startup check');
  assert.ok(probe.events.includes('unmount'));
});

test('OAuth callback startup keeps the callback route and skips the app cloud check', async () => {
  const probe = { events: [], checks: [], replace: [] };
  globalThis.__startup = probe;
  globalThis.window = { __orcaCloudCallback: 'https://app.example/orca-cloud/callback?code=synthetic' };
  globalThis.history = { replaceState: (...args) => probe.replace.push(args) };
  globalThis.document = { getElementById: () => ({}) };
  globalThis.location = { origin: 'https://app.example', href: 'https://app.example/orca-cloud/callback?code=secret', pathname: '/orca-cloud/callback' };
  const { start } = await import(`${entryUrl}?callback`);
  const stop = await start();

  assert.equal(probe.checks.length, 0, 'callback page must not start the app session check');
  assert.equal(probe.events.filter(event => event === 'render').length, 1);
  assert.equal(probe.rendered.type.name, 'CloudCallback');
  assert.equal(probe.rendered.props.callbackUrl, 'https://app.example/orca-cloud/callback?code=synthetic');
  assert.equal(globalThis.window.__orcaCloudCallback, undefined);
  assert.deepEqual(probe.replace[0], [null, '', '/orca-cloud/callback']);
  await stop();
  assert.ok(probe.events.includes('unmount'));
});

async function freshAccount(name) {
  globalThis.__storage.clear();
  return import(`${accountUrl}?${name}`);
}

test('delayed successful status activates the account and honours sync preference', async () => {
  const api = await freshAccount('success');
  globalThis.__storage.set('orca-cloud-auto:https://app.example:alice', '60');
  globalThis.fetch = async url => {
    assert.match(String(url), /\/_orca-cloud\/status$/);
    await tick(30);
    return json(statusBody());
  };

  const status = await api.checkCloudSession({ timeoutMs: 1000 });
  assert.equal(status.accountId, 'alice');
  assert.equal(api.useCloudAccount.getState().checking, false);
  assert.equal(api.useCloudAccount.getState().error, false);
  assert.equal(api.useCloudAccount.getState().automatic, true);
  assert.equal(api.useCloudAccount.getState().status.accountId, 'alice');
  const journal = JSON.parse(globalThis.__storage.get('orca_user_presets'));
  assert.equal(journal.cloud.activeAccount, 'alice');
});

test('stalled status times out, aborts the request and keeps unknown state safe', async () => {
  const api = await freshAccount('timeout');
  let aborted = false;
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      aborted = true;
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

  await assert.rejects(api.checkCloudSession({ timeoutMs: 20 }), /timed out/);
  assert.equal(aborted, true, 'timeout aborts the underlying request');
  const state = api.useCloudAccount.getState();
  assert.equal(state.checking, false);
  assert.equal(state.error, true);
  assert.equal(state.status, null);
  assert.equal(state.automatic, false);
  assert.equal(globalThis.__storage.has('orca_user_presets'), false);
});

test('a late response after timeout cannot publish status', async () => {
  const api = await freshAccount('late-timeout');
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = () => resolve(json(statusBody())); });

  await assert.rejects(api.checkCloudSession({ timeoutMs: 20 }), /timed out/);
  release();
  await tick(30);
  const state = api.useCloudAccount.getState();
  assert.equal(state.status, null);
  assert.equal(state.error, true);
  assert.equal(state.automatic, false);
  assert.equal(globalThis.__storage.has('orca_user_presets'), false);
});

test('caller cancellation stops waiting without reporting a connection error', async () => {
  const api = await freshAccount('cancel');
  const controller = new AbortController();
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });

  const pending = api.checkCloudSession({ signal: controller.signal, timeoutMs: 1000 });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, error => error.name === 'AbortError');
  const state = api.useCloudAccount.getState();
  assert.equal(state.checking, false);
  assert.equal(state.error, false);
  assert.equal(state.status, null);
});

test('a superseded late response yields to the newer check', async () => {
  const api = await freshAccount('supersede');
  const releases = [];
  globalThis.fetch = () => new Promise(resolve => { releases.push(resolve); });

  const first = api.checkCloudSession({ timeoutMs: 1000 }).catch(error => error);
  await tick();
  const second = api.checkCloudSession({ timeoutMs: 1000 });
  await tick();
  assert.equal(releases.length, 2, 'a newer explicit check bypasses a stalled request');

  releases[0](json(statusBody('stale-account')));
  await tick(5);
  assert.equal(releases.length, 2, 'superseded request releases the queue');
  releases[1](json(statusBody('current-account')));
  await second;

  const firstResult = await first;
  assert.equal(firstResult.name, 'AbortError');
  assert.equal(api.useCloudAccount.getState().status.accountId, 'current-account');
  assert.equal(api.useCloudAccount.getState().checking, false);
});

test('a check cancelled while queued does not leave checking stuck', async () => {
  const api = await freshAccount('queued-cancel');
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });

  const first = api.checkCloudSession({ timeoutMs: 1000 }).catch(() => {});
  await tick();
  assert.equal(api.useCloudAccount.getState().checking, true);
  const controller = new AbortController();
  controller.abort();
  const second = api.checkCloudSession({ signal: controller.signal, timeoutMs: 1000 }).catch(error => error);
  release(json(statusBody('stale-account')));
  const result = await second;
  await first;
  assert.equal(result.name, 'AbortError');
  assert.equal(api.useCloudAccount.getState().checking, false);
  assert.equal(api.useCloudAccount.getState().status, null);
});

test('unauthenticated status clears the active account and never enables automation', async () => {
  const api = await freshAccount('unauthenticated');
  globalThis.__storage.set('orca_user_presets', JSON.stringify({
    version: 2, updatedAt: 1, presets: [], cloud: { activeAccount: 'alice', accounts: { alice: { records: {} } } },
  }));
  globalThis.__storage.set('orca-cloud-auto:https://app.example:alice', '60');
  globalThis.fetch = async () => json(statusBody(null));

  const status = await api.checkCloudSession({ timeoutMs: 1000 });
  assert.equal(status.accountId, null);
  assert.equal(api.useCloudAccount.getState().automatic, false);
  assert.equal(api.useCloudAccount.getState().error, false);
  const journal = JSON.parse(globalThis.__storage.get('orca_user_presets'));
  assert.equal(journal.cloud.activeAccount, undefined);
});

test('failed status reports the error and leaves account state unknown', async () => {
  const api = await freshAccount('failure');
  globalThis.fetch = async () => json({ error: 'synthetic' }, 503);

  await assert.rejects(api.checkCloudSession({ timeoutMs: 1000 }), /Cloud connection failed/);
  const state = api.useCloudAccount.getState();
  assert.equal(state.checking, false);
  assert.equal(state.error, true);
  assert.equal(state.status, null);
  assert.equal(state.automatic, false);
});

test('passive focus shares explicit login result without canceling it', async () => {
  const api = await freshAccount('passive');
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const explicit = api.checkCloudSession({ timeoutMs: 1000 });
  await tick();
  const passive = api.checkCloudSession({ passive: true, timeoutMs: 1000 });
  release(json(statusBody()));
  assert.equal((await explicit).accountId, 'alice');
  assert.equal((await passive).accountId, 'alice');
});

test('verified account keeps enrolling edits during and after a failed passive recheck', async () => {
  const api = await freshAccount('offline-enrollment');
  globalThis.fetch = async () => json(statusBody('alice'));
  await api.checkCloudSession();
  globalThis.fetch = () => new Promise(() => {});
  const pending = api.checkCloudSession({ passive:true, timeoutMs:30 });
  const rejected = assert.rejects(pending, /timed out/);
  await api.saveUserPreset({ kind:'process', name:'During recheck', inherits:'', values:{} });
  await rejected;
  await api.saveUserPreset({ kind:'process', name:'Offline edit', inherits:'', values:{} });
  const stored = JSON.parse(globalThis.__storage.get('orca_user_presets'));
  assert.equal(stored.presets.length,2);
  assert.ok(stored.presets.every(preset => preset.cloudRef?.accountId === 'alice'));
  assert.equal(Object.keys(stored.cloud.accounts.alice.records).length,2);
});

test('bounded check settles behind unresolved check and checking recovers', async () => {
  const api = await freshAccount('hung');
  globalThis.fetch = () => new Promise(() => {});
  const first = api.checkCloudSession().catch(error => error);
  await tick();
  await assert.rejects(api.checkCloudSession({ timeoutMs: 20 }), /timed out/);
  await first;
  assert.equal(api.useCloudAccount.getState().checking, false);
});

for (const nextAccount of [null, 'bob']) test(`pending startup edits do not enroll stale alice before ${nextAccount}`, async () => {
  const api = await freshAccount(`edit-${nextAccount}`);
  globalThis.__storage.set('orca_user_presets', JSON.stringify({ version: 2, updatedAt: 1, presets: [],
    cloud: { activeAccount: 'alice', accounts: { alice: { records: {} } } } }));
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const check = api.checkCloudSession({ timeoutMs: 1000 });
  await tick();
  await api.saveUserPreset({ kind: 'process', name: 'Local edit', inherits: '', values: {} });
  release(json(statusBody(nextAccount)));
  await check;
  const stored = JSON.parse(globalThis.__storage.get('orca_user_presets'));
  assert.equal(stored.presets[0].cloudRef, undefined);
  assert.deepEqual(stored.cloud.accounts.alice.records, {});
});

for (const boundary of ['create', 'close']) for (const cancel of [false, true]) test(`activation waiting at durable ${boundary} cannot enroll after ${cancel ? 'abort' : 'deadline'}`, async () => {
  const api = await freshAccount(`durable-${boundary}-${cancel}`);
  let release;
  let writes = 0;
  let durable;
  navigator.storage = { getDirectory: async () => ({ getFileHandle: async (_file, { create }) => {
    if (!create) throw new Error('absent');
    return { createWritable: async () => {
      const activation = ++writes === 2;
      if (activation && boundary === 'create') await new Promise(resolve => { release = resolve; });
      let text;
      return { write: async value => { text = value; }, close: async () => {
        if (activation && boundary === 'close') await new Promise(resolve => { release = resolve; });
        durable = JSON.parse(text);
      }, abort: async () => {} };
    } };
  } }) };
  const controller = new AbortController();
  globalThis.fetch = async () => json(statusBody());
  const pending = api.checkCloudSession({ timeoutMs: cancel ? 1000 : 30, signal: controller.signal });
  const rejected = assert.rejects(pending, cancel ? { name: 'AbortError' } : /timed out/);
  while (!release) await tick(1);
  if (cancel) controller.abort();
  await rejected;
  release();
  await tick(20);
  assert.equal(JSON.parse(globalThis.__storage.get('orca_user_presets')).cloud.activeAccount, undefined);
  assert.equal(durable.cloud.activeAccount, undefined, 'OPFS must also retain the previous enrollment');
  assert.equal(api.useCloudAccount.getState().status, null);
  delete navigator.storage;
});
