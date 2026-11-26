import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { transform } from '../../app/node_modules/esbuild/lib/main.js';
import { readFileSync } from 'node:fs';

test('import offer uses the configured per-volume boundary and skips inspection when disabled', async () => {
  const source = readFileSync(new URL('../../app/src/editops/editOpsStore.ts', import.meta.url), 'utf8');
  const action = 'const offer = async' + source.split('  offerImportSimplification: async')[1].split('\n  chooseImportedMesh:')[0].replace(/,\s*$/, '') + ';';
  const { code } = await transform(action, { loader: 'ts' });
  let threshold = 250000, calls = 0;
  const state = { activeDialog: null, importedMeshes: [], chooseImportedMesh: () => {} };
  const env = {
    usePrefsStore: { getState: () => ({ general: { importSimplifyThreshold: threshold } }) },
    useHistoryStore: { getState: () => ({ isRestoring: false }) },
    get: () => state, set: patch => Object.assign(state, patch),
    modules: async name => {
      if (name.includes('orcaEngine')) return { getEngine: async () => ({ call: async () => {
        calls++;
        return { objects: [{ id: 1, name: 'part', volumes: [{ id: 249999 }, { id: 250000 }, { id: 250001 }] }] };
      } }) };
      if (name.includes('repairApi')) return { getMeshHealth: async (_, id) => ({ facetsCount: id }) };
      if (name.includes('appStore')) return { useAppStore: { getState: () => ({ isSlicing: false }) } };
      throw new Error(name);
    }
  };
  const offer = Function('env', `with(env) { ${code.replaceAll('import(', 'modules(')}; return offer; }`)(env);
  await offer([1]);
  assert.deepEqual(state.importedMeshes.map(m => m.volumeId), [250000, 250001]);
  state.importedMeshes = [];
  threshold = 250001;
  await offer([1]);
  assert.deepEqual(state.importedMeshes.map(m => m.volumeId), [250001]);
  const before = calls;
  threshold = 0;
  state.importedMeshes = [];
  await offer([1]);
  assert.equal(calls, before, 'disabled prompt does not inspect meshes');
  assert.deepEqual(state.importedMeshes, []);
});

test('denied storage getter allows preference defaults and in-memory edits', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', message => warnings.push(message));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.defineProperty({}, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }) });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  const result = await build({ entryPoints: ['wasm/app/src/prefs/prefsStore.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
  const { usePrefsStore } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  assert.equal(usePrefsStore.getState().display.theme, 'dark');
  usePrefsStore.getState().setDisplayPref('theme', 'light');
  assert.equal(usePrefsStore.getState().display.theme, 'light');
  assert.equal(warnings.length, 2);
});
