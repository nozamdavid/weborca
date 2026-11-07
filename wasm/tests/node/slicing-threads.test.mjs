import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

// Bundle the actual preference store and resolver, as other app-source Node tests do.
const bundle = await build({
  stdin: {
    contents: "export * from './prefsStore'; export * from './slicingThreads';",
    resolveDir: new URL('../../app/src/prefs/', import.meta.url).pathname,
    loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', write: false
});
const require = createRequire(import.meta.url);
function loadPreferences() {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test('preview lighting defaults on and persists independently of quality', () => {
  const previousWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = { localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  } };
  try {
    const { usePrefsStore, PREFS_STORAGE_KEY } = loadPreferences();
    assert.equal(usePrefsStore.getState().display.previewLighting, true);
    assert.equal(usePrefsStore.getState().display.previewShowFps, false);
    storage.set(PREFS_STORAGE_KEY, JSON.stringify({ display: { previewLowQuality: true } }));
    assert.equal(loadPreferences().usePrefsStore.getState().display.previewLighting, true, 'older preferences retain current appearance');
    assert.equal(loadPreferences().usePrefsStore.getState().display.previewShowFps, false, 'older preferences keep the counter off');
    usePrefsStore.getState().setDisplayPref('previewShowFps', true);
    usePrefsStore.getState().setDisplayPref('previewLighting', false);
    usePrefsStore.getState().setDisplayPref('previewLowQuality', true);
    const reloaded = loadPreferences().usePrefsStore.getState();
    assert.equal(reloaded.display.previewLighting, false);
    assert.equal(reloaded.display.previewLowQuality, true);
    assert.equal(reloaded.display.previewShowFps, true);
    reloaded.setDisplayPref('previewLowQuality', false);
    assert.equal(loadPreferences().usePrefsStore.getState().display.previewLighting, false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test('slicing thread selection and preference persistence stay valid across reloads', () => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hardwareConcurrency: undefined } });
  const storage = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  } };
  try {
    const { resolveSlicingThreads, sanitizeSlicingThreads, usePrefsStore, PREFS_STORAGE_KEY } = loadPreferences();
    assert.equal(usePrefsStore.getState().general.slicingThreads, 'auto');
    assert.equal(resolveSlicingThreads('auto', 32), 8);
    assert.equal(resolveSlicingThreads(16, 32), 16);
    assert.equal(resolveSlicingThreads(16, 8), 8);
    assert.equal(resolveSlicingThreads(16, 1), 1);
    for (const hardware of [undefined, NaN, 0, -1, 1.5]) {
      assert.equal(resolveSlicingThreads('auto', hardware), 4);
    }
    for (const value of [undefined, NaN, 1.5, -1, 0, 32, '16', 'unknown']) {
      assert.equal(sanitizeSlicingThreads(value), 'auto');
      storage.set(PREFS_STORAGE_KEY, JSON.stringify({ general: { slicingThreads: value, language: 'es' } }));
      const reloaded = loadPreferences().usePrefsStore.getState();
      assert.equal(reloaded.general.slicingThreads, 'auto');
      assert.equal(reloaded.general.language, 'es', 'existing preferences survive the merge');
    }
    usePrefsStore.getState().setGeneralPref('slicingThreads', 16);
    assert.equal(JSON.parse(storage.get(PREFS_STORAGE_KEY)).general.slicingThreads, 16);
    const reloaded = loadPreferences().usePrefsStore.getState();
    assert.equal(reloaded.general.slicingThreads, 16);
    assert.equal(resolveSlicingThreads(reloaded.general.slicingThreads, 8), 8, 'lower hardware after reload is respected');
    usePrefsStore.getState().setGeneralPref('slicingThreads', NaN);
    assert.equal(loadPreferences().usePrefsStore.getState().general.slicingThreads, 'auto');
    reloaded.resetDefaults();
    assert.equal(loadPreferences().usePrefsStore.getState().general.slicingThreads, 'auto');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});
