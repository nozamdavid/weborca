import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { readFile } from 'node:fs/promises';

// G-code import lifecycle across the real app store, preview store, viewer module
// and worker client. The Worker and the native preview runtime are deferred fakes:
// worker replies and file reads move only when the test drives them.
const appDir = new URL('../../app', import.meta.url).pathname;

const harness = `
    // Minimal browser environment for the real stores and viewer module.
    if (!globalThis.window) globalThis.window = globalThis;
    globalThis.requestAnimationFrame ??= () => 0;
    globalThis.cancelAnimationFrame ??= () => {};
    globalThis.__toasts = [];
    if (!globalThis.URL.createObjectURL) {
      globalThis.__blobUrlCount = 0;
      globalThis.URL.createObjectURL = () => 'blob:mock-' + (++globalThis.__blobUrlCount);
      globalThis.URL.revokeObjectURL = () => {};
    }
    export const installed = true;`;

const workerFixture = `
    export class FakeWorker {
      static instances = [];
      static created = 0;
      sent = []; terminated = 0;
      constructor() { FakeWorker.instances.push(this); FakeWorker.created++; }
      postMessage(message, transfer) { this.sent.push({ message, transfer }); }
      terminate() { this.terminated++; }
      reply(id, stats, packet) { this.onmessage?.({ data: { id, stats, packet: packet.buffer } }); }
      fail(id, message) { this.onmessage?.({ data: { id, error: message } }); }
      failWorker(message) { this.onerror?.({ message }); }
    }`;

const nativeFixture = `
    export const native = {
      nextStats: null, created: 0, loads: [], unlinked: [],
      files: new Map(),
      loadError: null,
      reset() {
        this.created = 0; this.loads = []; this.unlinked = [];
        this.files.clear(); this.loadError = null;
      },
      stats(layers) { return { layers, moves: layers * 10, timeS: 100, filamentMm: 1.2, filamentG: 1.0, features: [] }; }
    };
    export default async function createOrcaPreview() {
      native.created++;
      return {
        FS: {
          mkdirTree() {},
          writeFile(path, bytes) { native.files.set(path, Uint8Array.from(bytes)); },
          readFile(path) { const bytes = native.files.get(path); if (!bytes) throw new Error(path + ' absent'); return bytes; },
          unlink(path) { native.unlinked.push(path); native.files.delete(path); }
        },
        OrcaPreview: class OrcaPreview {
          calls = [];
          call(name, arg) { this.calls.push({ name, arg }); }
          setLightingEnabled(v) { this.call('setLightingEnabled', v); }
          init(selector) { this.call('init', selector); return true; }
          resize(w, h) { this.call('resize', [w, h]); }
          setLowQuality(v) { this.call('setLowQuality', v); }
          loadParsedGcode(path) {
            const bytes = native.files.get(path);
            native.loads.push({ path, bytes: bytes ? Uint8Array.from(bytes) : null });
            if (native.loadError) return JSON.stringify({ ...native.stats(1), error: native.loadError });
            return JSON.stringify(native.nextStats);
          }
          setToolColors(colors) { this.call('setToolColors', colors); }
          setBedPolygon(points) { this.call('setBedPolygon', points); }
          setViewType(viewType) { this.call('setViewType', viewType); }
          setLayerRange() {}
          setMove() {}
          setBed() {}
          setLightTheme() {}
          render() {}
          delete() { this.call('delete'); }
          clearGcode() { this.call('clearGcode'); }
          getLayersZs() { return JSON.stringify([0.2, 0.4]); }
          getMoveRange() { return JSON.stringify({ min: 0, max: 100 }); }
          getLegendData() { return JSON.stringify({ viewType: 'FeatureType', title: 'Line Type', type: 'features', items: [], options: [] }); }
          getLayersCount() { return 42; }
          getMovesCount() { return 420; }
        }
      };
    }`;

// Every app-store dependency outside the preview stack is a stub: the G-code import
// path touches only these names, and the engine module must never load.
const appStoreStubs = new Map([
  ['orcaEngine.ts', `
    export const getEngine = () => { throw new Error('engine stub'); };
    export const disposeEngine = () => {};
    export const onEngineLoadProgress = () => () => {};
    export const loadVendors = async () => [];
    export const listPresets = async () => [];
    export const getCompatiblePresets = async () => [];
    export const selectPresets = () => {};
    export const getConfig = () => ({});
    export const getConfigDef = () => null;
    export const evaluateRules = () => [];
    export const setOptions = async (get, defs, updates) => ({ ...updates });
    export const setOption = async (get, defs, update) => {};
    export const getOption = () => null;
    export const resetOptions = () => {};
    export const addModel = () => {};
    export const slice = async (opts) => globalThis.__sliceHook ? globalThis.__sliceHook(opts) : { gcode: new Uint8Array([1]), layers: 1, printTimeS: 1, filamentMm: 1, filamentG: 1, warnings: [] };`],
  ['ruleFixes.ts', `export const isNoRuleFix = () => false;`],
  ['slicingThreads.ts', `
    export const resolveSlicingThreads = () => 4;
    export const sanitizeSlicingThreads = (threads) => threads;`],
  ['effectivePreset.ts', `export const effectivePreset = () => ({});`],
  ['presetActions.ts', `
    export const saveCurrentUserPresetHelper = async () => {};
    export const duplicateUserPresetHelper = async () => {};
    export const deleteUserPresetHelper = async () => {};
    export const renameUserPresetHelper = async () => {};
    export const importUserPresetsHelper = async () => {};
    export const exportUserPresetsHelper = async () => {};
    export const exportDesktopArchiveHelper = async () => {};`],
  ['presetStorage.ts', `export const loadUserPresets = async () => [];`],
  ['printerCatalog.ts', `
    import { create } from 'zustand';
    export const usePrinterCatalog = create(() => ({ vendors: [] }));
    export const loadPrinterCatalog = async () => ({ vendors: [] });`],
  ['systemProfiles.ts', `export const findSystemProfileVendor = () => null; export const systemProfiles = [];`],
  ['connectionStore.ts', `
    import { create } from 'zustand';
    export const usePrinterConnectionStore = create(() => ({ printers: [], selectedPrinterId: null, saveFilaments() {} }));`],
  ['slicePrerequisites.ts', `export const slicePrerequisites = () => null;`],
  ['toastStore.ts', `export const showToast = (message, kind) => { globalThis.__toasts.push({ message, kind }); };`],
  ['recentFiles.ts', `export const storeRecentFile = async () => {};`],
  ['gcodeThumbnails.ts', `export const clearExportGcodeCache = () => {};`],
  ['plateStore.ts', `export const usePlateStore = { getState: () => ({ refreshObjects: async () => {} }) };`],
  ['index.ts', `
    export const useHistoryStore = { getState: () => ({ isRestoring: false }) };
    export const capturePlateState = () => ({});
    export const restorePlatesOnEmptyCanvas = async () => {};`],
  ['prefsStore.ts', `
    export const usePrefsStore = { getState: () => ({ general: { autosave: false, slicingThreads: 1 } }) };`],
  ['objectListStore.ts', `
    export const useObjectListStore = { getState: () => ({ objects: [] }) };`]
]);

const entry = `
    import 'harness';
    import { FakeWorker } from 'worker-fixture';
    globalThis.Worker = FakeWorker;
    export { useAppStore } from './src/store/appStore';
    export { usePreviewStore } from './src/preview/previewStore';
    export { usePlatesStore } from './src/plates/platesStore';
    export * as previewModule from './src/preview/orcaPreviewModule';
    import { native } from 'native-fixture';
    import { FakeWorker } from 'worker-fixture';
    export const fixture = { native, FakeWorker };`;

let bundleUrl;

before(async () => {
  const result = await build({
    stdin: { contents: entry, resolveDir: appDir, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' },
    plugins: [{
      name: 'preview-import-boundary',
      setup(b) {
        b.onLoad({ filter: /\/orcaPreviewModule\.ts$/ }, async args => ({
          contents: (await readFile(args.path, 'utf8')).replaceAll('import(/* @vite-ignore */ runtimeUrl)', "import('native-fixture')"),
          loader: 'ts'
        }));
        b.onResolve({ filter: /^harness$|^worker-fixture$|^native-fixture$|^\/(preview\/)?orca_preview\.(js|wasm)$/ },
          args => args.path === 'harness' || args.path === 'worker-fixture' || args.path === 'native-fixture'
            ? { path: args.path, namespace: 'fixture' }
            : { path: 'native-fixture', namespace: 'fixture' });
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          if (args.path === 'harness') return { contents: harness, loader: 'js', resolveDir: appDir };
          if (args.path === 'worker-fixture') return { contents: workerFixture, loader: 'js', resolveDir: appDir };
          return { contents: nativeFixture, loader: 'js', resolveDir: appDir };
        });
        b.onLoad({ filter: /\/(orcaEngine|ruleFixes|slicingThreads|effectivePreset|presetActions|presetStorage|printerCatalog|systemProfiles|connectionStore|slicePrerequisites|toastStore|recentFiles|gcodeThumbnails|plateStore|prefsStore|objectListStore)\.ts$|\/history\/index\.ts$/ }, (args) => {
          const base = args.path.slice(args.path.lastIndexOf('/') + 1);
          return appStoreStubs.has(base) ? { contents: appStoreStubs.get(base), loader: 'ts', resolveDir: appDir } : undefined;
        });
      }
    }]
  });
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const directory = await mkdtemp(join(tmpdir(), 'orca-preview-import-'));
  const file = join(directory, 'import-lifecycle.mjs');
  await writeFile(file, result.outputFiles[0].text);
  bundleUrl = pathToFileURL(file).href;
});

const stack = () => import(bundleUrl);
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const encode = (text) => new TextEncoder().encode(text);

/** Reply to the most recent request the fake worker actually received. */
let currentNative;
const fixtureNative = (worker, stats) => { currentNative.nextStats = stats; };
const respond = (worker, stats, packet) => {
  assert.ok(worker.sent.length, 'fake worker received a request');
  fixtureNative(worker, stats);
  worker.reply(worker.sent.at(-1).message.id, stats, packet);
};

/** Load G-code through the preview store, driving the deferred worker reply. */
const loadWithReply = async (usePreviewStore, fixture, bytes, name, layers) => {
  const load = usePreviewStore.getState().loadGcodeBytes(bytes, name);
  await settle();
  respond(fixture.FakeWorker.instances.at(-1), fixture.native.stats(layers), Uint8Array.from(bytes).reverse());
  return await load;
};

const freshState = async () => {
  const { useAppStore, usePreviewStore, usePlatesStore, previewModule, fixture } = await stack();
  await useAppStore.setState({ isEngineReady: true, isSlicing: false, sliceResult: null, gcodeUrl: null });
  usePreviewStore.setState({ stats: null, isLoading: false, layersCount: 0 });
  previewModule.disposePreview();
  fixture.native.reset();
  currentNative = fixture.native;
  return { useAppStore, usePreviewStore, usePlatesStore, previewModule, fixture };
};

const initRenderer = (previewModule) => previewModule.initPreview({ width: 8, height: 8, id: '' });

test('statistics arrive before the viewer exists; the same bytes then render from the same packet with exactly one parse', async () => {
  const { usePreviewStore, previewModule, fixture } = await freshState();
  const { native, FakeWorker } = fixture;
  const bytesA = encode('; one\nG1 X1\n');

  const first = await loadWithReply(usePreviewStore, fixture, bytesA, 'one.gcode', 7);
  assert.equal(first.layers, 7, 'worker statistics publish before any viewer exists');
  assert.equal(usePreviewStore.getState().stats.layers, 7);
  assert.equal(usePreviewStore.getState().isLoading, false);
  assert.equal(FakeWorker.created, 1, 'exactly one worker served the preparation');
  assert.equal(FakeWorker.instances[0].sent.length, 1);

  await initRenderer(previewModule);

  const second = await usePreviewStore.getState().loadGcodeBytes(bytesA, 'one.gcode');
  assert.equal(second.layers, 7, 'the renderer reports the prepared statistics');
  assert.equal(FakeWorker.created, 1, 'mounting reused the retained packet: no new worker');
  assert.equal(FakeWorker.instances[0].sent.length, 1, 'exactly one parse served both loads');
  assert.equal(native.loads.length, 1);
  assert.deepEqual([...native.loads[0].bytes], [...Uint8Array.from(bytesA).reverse()],
    'the renderer consumed the packet the worker returned');
  assert.ok(native.unlinked.some(path => path.endsWith('.packet')), 'the mount staging file was removed');
});

test('overlapping imports: B starts while A parses and B reads slowly; A cannot commit to renderer or stores', async () => {
  const { useAppStore, usePreviewStore, previewModule, fixture } = await freshState();
  const { native, FakeWorker } = fixture;
  const startCreated = FakeWorker.created;
  await initRenderer(previewModule);
  const bytesBase = encode('; base\nG1 X0\n');
  await loadWithReply(usePreviewStore, fixture, bytesBase, 'base.gcode', 7);
  assert.equal(native.loads.length, 1);

  // A: second import, its worker response withheld.
  const bytesA = encode('; overlapping A\nG1 X1\n');
  const promiseA = usePreviewStore.getState().loadGcodeBytes(bytesA, 'a.gcode');
  promiseA.catch(() => {});
  await settle();
  assert.equal(usePreviewStore.getState().isLoading, true, 'import A is awaiting its parse');

  // B: new import initiated through the real app store, file read held open.
  let releaseRead;
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  const fileB = { name: 'b.gcode', size: 2, arrayBuffer: () => readGate };
  const promiseB = useAppStore.getState().openGcodeFile(fileB);
  await settle();
  assert.equal(native.loads.length, 1, "B's initiation must not have loaded a renderer yet");

  // A's parse now resolves, late: after B's initiation.
  respond(FakeWorker.instances.at(-1), native.stats(77), Uint8Array.from([7, 7, 7]));
  await assert.rejects(promiseA, error => error.name === 'AbortError',
    'the superseded import must reject instead of committing');
  await settle();
  assert.equal(native.loads.length, 1, 'superseded result never reached the renderer');
  assert.equal(usePreviewStore.getState().stats.layers, 7, 'preview store keeps the last valid load');
  assert.equal(useAppStore.getState().sliceResult, null, 'app store publication stays blocked for A');

  // B proceeds after its delayed read.
  releaseRead(new ArrayBuffer(0));
  await settle();
  const bLoadParseCount = FakeWorker.instances.at(-1).sent.length;
  respond(FakeWorker.instances.at(-1), native.stats(5), Uint8Array.from([8, 8, 8]));
  await promiseB;
  await settle();
  assert.equal(native.loads.length, 2, 'B rendered exactly once');
  assert.deepEqual([...native.loads[1].bytes], [8, 8, 8], 'B rendered from its returned packet');
  assert.equal(usePreviewStore.getState().stats.layers, 5, 'B published its statistics');
  assert.equal(useAppStore.getState().sliceResult?.gcodePath, 'b.gcode', 'B published to the app store');
  assert.equal(bLoadParseCount, 1, 'B parsed once');
  assert.equal(FakeWorker.created - startCreated, 2, "B gets a fresh worker after cancellation");
});

test('a failing import keeps the previous valid output; no zero-statistics success is published', async () => {
  const { useAppStore, usePreviewStore, previewModule, fixture } = await freshState();
  const { native, FakeWorker } = fixture;
  const startCreated = FakeWorker.created;
  await initRenderer(previewModule);
  const bytesBase = encode('; base\nG1 X0\n');
  await loadWithReply(usePreviewStore, fixture, bytesBase, 'base.gcode', 7);
  const baseStats = usePreviewStore.getState().stats;
  const toasts = () => globalThis.__toasts;

  // Worker-side parse rejection.
  const failedFile = { name: 'bad.gcode', size: 2, arrayBuffer: async () => encode('; bad\n').buffer };
  const badImport = useAppStore.getState().openGcodeFile(failedFile);
  await settle();
  const worker = FakeWorker.instances.at(-1);
  worker.fail(worker.sent.at(-1).message.id, 'packet parser failed');
  await badImport;
  assert.match(toasts().at(-1).message, /packet parser failed/);
  assert.equal(toasts().at(-1).kind, 'error', 'parser failures surface as errors');
  assert.equal(useAppStore.getState().sliceResult?.gcodePath, undefined, 'failed import published nothing');
  assert.equal(usePreviewStore.getState().stats.layers, baseStats.layers, 'previous statistics survive');
  assert.ok(previewModule.isGcodeLoaded(bytesBase), 'previous output stays loaded');

  // Renderer-side native failure after a successful parse.
  native.loadError = 'native load rejected';
  const loadErrorImport = useAppStore.getState().openGcodeFile({ name: 'worse.gcode', size: 2, arrayBuffer: async () => encode('; worse\n').buffer });
  await settle();
  respond(FakeWorker.instances.at(-1), native.stats(9), Uint8Array.from([1]));
  await loadErrorImport;
  assert.match(toasts().at(-1).message, /native load rejected/);
  assert.equal(useAppStore.getState().sliceResult?.gcodePath, undefined, 'still nothing published');
  assert.equal(usePreviewStore.getState().stats.layers, baseStats.layers, 'zero statistics were never published');
  assert.ok(previewModule.isGcodeLoaded(bytesBase), 'previous loaded G-code preserved through the failed renderer load');
  native.loadError = null;
});

test('concurrent loadGcode for the same bytes shares one parse and skips redundant setViewType', async () => {
  const { previewModule, fixture } = await freshState();
  const { native, FakeWorker } = fixture;
  const instance = await initRenderer(previewModule);
  const bytes = encode('; shared\nG1 X1\n');

  const first = previewModule.loadGcode(bytes, 'shared.gcode');
  first.catch(() => {});
  const second = previewModule.loadGcode(bytes, 'shared.gcode');
  await settle();
  const worker = FakeWorker.instances.at(-1);
  assert.equal(worker.sent.length, 1, 'concurrent callers for identical bytes share one worker parse');

  respond(worker, native.stats(6), Uint8Array.from([4, 5]));
  await assert.rejects(first, error => error.name === 'AbortError');
  const stats = await second;
  assert.equal(stats.layers, 6);

  previewModule.setViewType('FeatureType');
  assert.equal(instance.calls.filter(c => c.name === 'setViewType').length, 0,
    'initial FeatureType matches native default and skips redundant setViewType');
  previewModule.setViewType('Speed');
  previewModule.setViewType('Speed');
  assert.deepEqual(instance.calls.filter(c => c.name === 'setViewType').map(c => c.arg), ['Speed'],
    'setViewType runs once when changing view type and skips repeated calls');
});

test('startSlice clears old preview state immediately and keeps or warms the preview worker', async () => {
  const { useAppStore, usePreviewStore, previewModule, fixture } = await freshState();
  const { FakeWorker } = fixture;
  const instance = await initRenderer(previewModule);
  await loadWithReply(usePreviewStore, fixture, encode('; old\nG1 X1\n'), 'old.gcode', 9);
  assert.equal(usePreviewStore.getState().layersCount, 9);
  const workerBefore = FakeWorker.instances.at(-1);
  const createdBefore = FakeWorker.created;

  let releaseSlice;
  globalThis.__sliceHook = () => new Promise(resolve => {
    releaseSlice = () => resolve({ gcode: encode('; new\nG1 X2\n'), layers: 4, printTimeS: 20, filamentMm: 10, filamentG: 1, warnings: [] });
  });
  try {
    const slicing = useAppStore.getState().startSlice();
    await settle();
    assert.equal(useAppStore.getState().isSlicing, true);
    assert.equal(usePreviewStore.getState().layersCount, 0, 'startSlice clears old layers immediately');
    assert.equal(usePreviewStore.getState().stats, null, 'startSlice clears old stats immediately');
    assert.ok(instance.calls.some(c => c.name === 'clearGcode'), 'startSlice clears the native viewer immediately');
    assert.equal(workerBefore.terminated, 0, 'idle warm worker stays alive across reslice');
    assert.equal(FakeWorker.created, createdBefore, 'no extra worker spawned when one is already warm');
    releaseSlice();
    await slicing;
  } finally {
    delete globalThis.__sliceHook;
  }
});

test('slicePlate clears old preview state immediately and keeps or warms the preview worker', async () => {
  const { useAppStore, usePreviewStore, usePlatesStore, previewModule, fixture } = await freshState();
  const { FakeWorker } = fixture;
  const instance = await initRenderer(previewModule);
  await loadWithReply(usePreviewStore, fixture, encode('; old\nG1 X1\n'), 'old.gcode', 9);
  assert.equal(usePreviewStore.getState().layersCount, 9);
  const workerBefore = FakeWorker.instances.at(-1);
  const createdBefore = FakeWorker.created;

  let releaseSlice;
  globalThis.__sliceHook = () => new Promise(resolve => {
    releaseSlice = () => resolve({ gcode: encode('; new\nG1 X2\n'), layers: 4, printTimeS: 20, filamentMm: 10, filamentG: 1, warnings: [] });
  });
  try {
    const slicing = usePlatesStore.getState().slicePlate(0);
    await settle();
    assert.equal(useAppStore.getState().isSlicing, true);
    assert.equal(usePreviewStore.getState().layersCount, 0, 'slicePlate clears old layers immediately');
    assert.equal(usePreviewStore.getState().stats, null, 'slicePlate clears old stats immediately');
    assert.ok(instance.calls.some(c => c.name === 'clearGcode'), 'slicePlate clears the native viewer immediately');
    assert.equal(workerBefore.terminated, 0, 'idle warm worker stays alive across reslice');
    assert.equal(FakeWorker.created, createdBefore, 'no extra worker spawned when one is already warm');
    releaseSlice();
    assert.equal(await slicing, true);
  } finally {
    delete globalThis.__sliceHook;
  }
});
