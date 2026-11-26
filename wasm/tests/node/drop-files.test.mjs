import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

const { outputFiles } = await build({
  entryPoints: [new URL('../../app/src/plate/dropFiles.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'drop-dependencies', setup(builder) {
    builder.onResolve({ filter: /appStore|history|projectActions|toastStore/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const useAppStore = { getState: () => globalThis.dropFixture.app };
      export const useHistoryStore = { getState: () => ({ isRestoring: false }) };
      export const requestOpenProject = file => globalThis.dropFixture.open(file);
      export const showToast = message => globalThis.dropFixture.errors.push(message);
    ` }));
  } }],
});
const { importDroppedFiles } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const files = (...names) => names.map(name => ({ name }));
function fixture() {
  const calls = [];
  const state = { calls, errors: [], open: async file => { calls.push(`project:${file.name}`); return true; },
    app: { isEngineReady: true, isSlicing: false, isModelLoading: false, stepImportState: null,
      requestImportFile: async file => { calls.push(file.name); } } };
  globalThis.dropFixture = state;
  return state;
}

test('imports models in order, including 3MF geometry, and ignores unsupported files', async () => {
  const state = fixture();
  let release;
  state.app.requestImportFile = async file => {
    state.calls.push(file.name);
    if (file.name === 'first.step') await new Promise(resolve => { release = resolve; });
  };
  const pending = importDroppedFiles(files('first.step', 'notes.txt', 'second.3mf', 'last.STL'));
  assert.deepEqual(state.calls, ['first.step']);
  await importDroppedFiles(files('overlap.step'));
  assert.deepEqual(state.calls, ['first.step']);
  release();
  await pending;
  assert.deepEqual(state.calls, ['first.step', 'second.3mf', 'last.STL']);
});

test('a lone supported 3MF keeps project-open behavior', async () => {
  const state = fixture();
  await importDroppedFiles(files('notes.txt', 'project.3mf'));
  assert.deepEqual(state.calls, ['project:project.3mf']);
});

test('continues after loader-reported failure and releases guard after unexpected rejection', async () => {
  const state = fixture();
  state.app.requestImportFile = async file => {
    state.calls.push(file.name);
    state.app.engineError = 'Invalid model';
  };
  await importDroppedFiles(files('bad.stl', 'good.stl'));
  assert.deepEqual(state.calls, ['bad.stl', 'good.stl']);
  state.app.requestImportFile = async () => { throw new Error('unexpected'); };
  await importDroppedFiles(files('reject.stl'));
  assert.match(state.errors[0], /unexpected/);
  state.app.requestImportFile = async file => state.calls.push(file.name);
  await importDroppedFiles(files('retry.stl'));
  assert.equal(state.calls.at(-1), 'retry.stl');
});

test('ignores a drop while loading or a STEP dialog is already pending', async () => {
  const state = fixture();
  state.app.isModelLoading = true;
  await importDroppedFiles(files('busy.stl'));
  state.app.isModelLoading = false;
  state.app.stepImportState = { file: { name: 'pending.step' } };
  await importDroppedFiles(files('overwrite.step'));
  assert.deepEqual(state.calls, []);
});
