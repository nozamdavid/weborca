import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const bundle = await build({ entryPoints: [new URL('../../app/src/plates/batchOutput.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports);
const { batchZip } = mod.exports;
test('two completed plates survive in distinct safe ZIP entries; partial archive preserves completed output', () => {
  const { unzipSync, strFromU8 } = require('fflate');
  const outputs = [0, 1].map(plateIndex => ({ plateIndex, name: '../../same', gcode: new TextEncoder().encode(`plate ${plateIndex}`), provenance: { printer: 'captured' } }));
  const full = unzipSync(batchZip(outputs));
  const names = Object.keys(full).filter(n => n.endsWith('.gcode'));
  assert.equal(names.length, 2);
  assert.ok(names.every(n => !n.includes('/') && !n.includes('..')));
  assert.deepEqual(names.map(n => strFromU8(full[n])), ['plate 0', 'plate 1']);
  const partial = unzipSync(batchZip(outputs.slice(0, 1)));
  assert.equal(strFromU8(partial[names[0]]), 'plate 0');
});

test('real sequential store retains two outputs, cancellation keeps first, invalidation discards batch', async () => {
  const result = await build({ entryPoints: [new URL('../../app/src/plates/platesStore.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'engine-boundary', setup(builder) {
      builder.onLoad({ filter: /\/engine\/orcaEngine\.ts$/ }, () => ({ contents: 'export const getEngine = async () => globalThis.batchEngine; export const slice = args => globalThis.batchSlice(args);' }));
      builder.onLoad({ filter: /\/store\/appStore\.ts$/ }, () => ({ contents: 'export const useAppStore = { getState: () => globalThis.batchApp, setState: patch => Object.assign(globalThis.batchApp, patch) };' }));
      builder.onLoad({ filter: /\/history\/index\.ts$/ }, () => ({ contents: 'export const useHistoryStore = {getState: () => ({isRestoring:false})};' }));
      builder.onLoad({ filter: /\/plate\/plateStore\.ts$/ }, () => ({ contents: 'export const usePlateStore = {};' }));
      builder.onLoad({ filter: /\/prefs\/prefsStore\.ts$/ }, () => ({ contents: 'export const usePrefsStore = {getState: () => ({general:{slicingThreads:1}})};' }));
    } }]
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
  const store = mod.exports.usePlatesStore;
  const plates = [0, 1].map(index => ({index, name:'same', instances:[{}], config:{layer_height:index === 0 ? '0.12' : '0.28'}}));
  globalThis.batchEngine = { call: async () => plates };
  globalThis.batchApp = { isEngineReady:true, modelFile:{name:'x'}, pendingOptions:{}, selectedPrinter:'P', selectedProcess:'Q', selectedFilaments:['F'], currentConfig:{nozzle_diameter:'0.4'} };
  let mode = 'success';
  globalThis.batchSlice = async ({plateIndex}) => {
    if (plateIndex === 1 && mode === 'cancel') throw new DOMException('canceled', 'AbortError');
    if (plateIndex === 1 && mode === 'fail') throw new Error('slice failed');
    if (plateIndex === 1 && mode === 'invalidate') store.getState().invalidateBatch();
    return {gcode:new Uint8Array([plateIndex + 1])};
  };
  try {
    await store.getState().sliceAll();
    assert.deepEqual(store.getState().batch.outputs.map(o => [...o.gcode]), [[1], [2]]);
    assert.equal(store.getState().batch.outputs[0].provenance.printer, 'P');
    assert.equal(globalThis.batchApp.sliceResult.plateIndex, 1);
    assert.deepEqual(store.getState().batch.outputs.map(o => o.provenance.config.layer_height), ['0.12', '0.28']);
    let releaseFetch;
    let reportFetch;
    const fetching = new Promise(resolve => { reportFetch = resolve; });
    globalThis.batchEngine.call = () => {
      reportFetch();
      return new Promise(resolve => { releaseFetch = resolve; });
    };
    const firstBatch = store.getState().sliceAll();
    await fetching;
    const owner = store.getState().batch;
    await store.getState().sliceAll();
    assert.equal(store.getState().batch, owner);
    releaseFetch(plates);
    await firstBatch;
    assert.deepEqual(store.getState().batch.outputs.map(o => [...o.gcode]), [[1], [2]]);
    globalThis.batchEngine.call = async () => plates;
    for (mode of ['cancel', 'fail']) {
      await store.getState().sliceAll();
      assert.equal(store.getState().batch.outputs.length, 1);
      assert.equal(store.getState().batch.total, 2);
      assert.equal(store.getState().batch.running, false);
    }
    mode = 'invalidate';
    await store.getState().sliceAll();
    assert.equal(store.getState().batch, null);
  } finally {
    delete globalThis.batchApp; delete globalThis.batchEngine; delete globalThis.batchSlice;
  }
});
