import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { OrcaEngine } from '../../web/orca-engine.js';

test('canceling actual create initialization terminates its worker; retry owns a fresh worker', async () => {
  const workers = [];
  const original = globalThis.Worker;
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(message) { this.request = message; }
    terminate() { this.terminated = true; }
  };
  try {
    const controller = new AbortController();
    const pending = OrcaEngine.create({ workerUrl: 'http://localhost/worker.js', signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, /disposed/);
    assert.equal(workers[0].terminated, true);
    const progress = [];
    const retry = OrcaEngine.create({ workerUrl: 'http://localhost/worker.js', onProgress: p => progress.push(p) });
    const worker = workers[1];
    worker.onmessage({ data: { id: worker.request.id, progress: { phase: 'downloading', loaded: 42 } } });
    worker.onmessage({ data: { id: worker.request.id, ok: true, result: {} } });
    const engine = await retry;
    assert.equal(progress[0].loaded, 42);
    engine.dispose();
    assert.equal(worker.terminated, true);
  } finally { globalThis.Worker = original; }
});

test('failed create initialization disposes the failed worker', async () => {
  const original = globalThis.Worker;
  let worker;
  globalThis.Worker = class {
    constructor() { worker = this; }
    postMessage(message) { queueMicrotask(() => this.onmessage({ data: { id: message.id, ok: false, error: 'download failed' } })); }
    terminate() { this.terminated = true; }
  };
  try {
    await assert.rejects(OrcaEngine.create({ workerUrl: 'http://localhost/worker.js' }), /download failed/);
    assert.equal(worker.terminated, true);
  } finally { globalThis.Worker = original; }
});

test('catalog is absent at import, deduplicates discovery and caches success; failure can retry', async () => {
  const result = await build({ entryPoints: [new URL('../../app/src/presets/printerCatalog.ts', import.meta.url).pathname], bundle: true, write: false, format: 'iife', globalName: 'catalog' });
  let requests = 0, fail = true;
  const context = vm.createContext({ console, fetch: async () => { requests++; return { ok: !fail, json: async () => [{ name: 'Voron', bytes: 1 }, { name: 'OrcaFilamentLibrary', bytes: 2 }] }; } });
  vm.runInContext(result.outputFiles[0].text, context);
  assert.equal(requests, 0);
  const { loadPrinterCatalog, usePrinterCatalog } = context.catalog;
  const first = loadPrinterCatalog();
  assert.strictEqual(first, loadPrinterCatalog());
  await assert.rejects(first, /unavailable/);
  assert.equal(usePrinterCatalog.getState().error, true);
  fail = false;
  const retry = loadPrinterCatalog();
  assert.equal((await retry).length, 1);
  assert.strictEqual(retry, loadPrinterCatalog());
  assert.equal(requests, 2);
  assert.equal(usePrinterCatalog.getState().error, false);
});

test('engine status shows byte percent only with a total and keeps cached/init phases distinct', async () => {
  const result = await build({ entryPoints: [new URL('../../app/src/components/EngineLoadingIndicator.tsx', import.meta.url).pathname],
    bundle: true, write: false, format: 'iife', globalName: 'indicator', plugins: [{ name: 'status-state', setup(builder) {
      builder.onResolve({ filter: /(?:store\/appStore|\/i18n)$/ }, args => ({ path: args.path, namespace: 'status-state' }));
      builder.onLoad({ filter: /.*/, namespace: 'status-state' }, args => ({ contents: args.path.endsWith('i18n')
        ? 'export const useTranslation = () => ({ t: key => key });'
        : 'export const useAppStore = selector => selector(globalThis.state);' }));
    } }] });
  const state = { isIsolated: true, isEngineReady: false, engineLoad: {}, engineError: null };
  const context = vm.createContext({ state, console });
  vm.runInContext(result.outputFiles[0].text, context);
  const label = progress => {
    state.engineLoad = progress;
    return context.indicator.EngineLoadingIndicator().props.children[0].props.children[0];
  };
  assert.match(label({ phase: 'downloading', loaded: 3, total: 8 }), /37%/);
  assert.doesNotMatch(label({ phase: 'downloading', loaded: 3 }), /%/);
  assert.match(label({ phase: 'checking' }), /Checking engine cache/);
  assert.match(label({ phase: 'cached' }), /Loading cached engine/);
  assert.match(label({ phase: 'initializing' }), /Initializing engine/);
});
