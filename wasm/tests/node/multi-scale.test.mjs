import test from 'node:test';
import assert from 'node:assert/strict';
import { groupScaleEntries, localScaleFactors, selectedScaleInstances } from '../../app/src/plate/multiScale.ts';

const instance = (id, x, scale = [1, 1, 1], rotation = [0, 0, 0]) => ({ id, offset: [x, 0, 0], scale, rotation, mirror: [-1, 1, 1] });
const objects = [{ id: 1, instances: [instance(10, 0), instance(11, 20), instance(12, 80)] },
  { id: 2, instances: [instance(20, 40, [2, 3, 4])] }];
const refs = [{ objectId: 1, instanceId: 10 }, { objectId: 1, instanceId: 11 }, { objectId: 2, instanceId: 20 }];
const mesh = async () => ({ positions: new Float32Array([-1, -1, 0, 1, 1, 2]) });

test('group uniform scale changes two objects and selected same-object copies around shared pivot', async () => {
  const before = structuredClone(objects);
  const entries = await groupScaleEntries(objects, refs, [2, 2, 2], mesh);
  assert.deepEqual(entries.map(e => e.scale), [[2, 2, 2], [2, 2, 2], [4, 6, 8]]);
  assert.equal(entries[1].offset[0] - entries[0].offset[0], 40);
  assert.equal(entries[2].offset[0] - entries[1].offset[0], 40);
  assert.equal(entries.length, 3);
  assert.deepEqual(objects, before); // unselected copy and original rotation/mirror remain untouched
  assert.ok(entries.every(e => !('rotation' in e) && !('mirror' in e)));
});
test('world-axis factors preserve other dimensions and map through quarter-turn rotation', async () => {
  const rotated = { ...objects[0], instances: [instance(10, 0, [1, 2, 3], [0, 0, Math.PI / 2])] };
  const entries = await groupScaleEntries([rotated, objects[1]], [refs[0], refs[2]], [2, 1, 1], mesh);
  assert.deepEqual(entries[0].scale, [1, 4, 3]);
  assert.deepEqual(entries[1].scale, [4, 3, 4]);
});
test('arbitrary rotation accepts uniform scale and rejects unsupported shear', async () => {
  const i = instance(10, 0, [1, 2, 3], [0.2, 0.4, 0.7]);
  assert.ok(localScaleFactors(i, [2, 2, 2]).every(v => Math.abs(v - 2) < 1e-10));
  assert.equal(localScaleFactors(i, [2, 1, 1]), null);
  await assert.rejects(groupScaleEntries([{ id: 1, instances: [i] }], [refs[0]], [2, 1, 1], mesh), /shear/);
});
test('stale references and repeated references cannot change another copy', async () => {
  const selection = [...refs, refs[0], { objectId: 1, instanceId: 999 }, { objectId: 999, instanceId: 10 }];
  assert.equal(selectedScaleInstances(objects, selection).length, 3);
  assert.equal((await groupScaleEntries(objects, selection, [2, 2, 2], mesh)).length, 3);
});
test('zero, negative and nonfinite factors reject before loading meshes', async () => {
  for (const v of [0, -1, Infinity, NaN]) await assert.rejects(groupScaleEntries(objects, refs, [v, 1, 1], () => assert.fail('must not load')), /Invalid scale/);
});

test('real store batches selected instances with one history commit and invalidation', async () => {
  const { build } = await import('../../app/node_modules/esbuild/lib/main.js');
  const calls = [], commits = [], invalidations = [];
  const app = { invalidateSlicePreview: () => invalidations.push(1) };
  globalThis.__multiScaleTest = { app, history: { commitTransaction: async label => commits.push(label) },
    engine: { call: async (op, args) => calls.push({ op, args }) } };
  const result = await build({ entryPoints: [new URL('../../app/src/plate/plateStore.ts', import.meta.url).pathname],
    bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'engine-boundaries', setup(b) {
      b.onResolve({ filter: /(?:engine\/orcaEngine|store\/appStore|\/history|plates\/platesStore)$/ }, args => ({ path: args.path, namespace: 'boundary' }));
      b.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({ contents: path.includes('orcaEngine')
        ? 'export const getEngine=async()=>globalThis.__multiScaleTest.engine; export const addModel=()=>{};'
        : path.includes('appStore') ? 'export const useAppStore={getState:()=>globalThis.__multiScaleTest.app,setState:()=>{}};'
        : path.endsWith('/history') ? 'export const useHistoryStore={getState:()=>globalThis.__multiScaleTest.history};'
        : 'export const usePlatesStore={getState:()=>({fetchPlates:async()=>{}})};' }));
    } }] });
  const { usePlateStore: store } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const refreshObjects = store.getState().refreshObjects;
  const seed = () => store.setState({ objects: structuredClone(objects), selectedObjectId: 1, selectedInstanceId: 10,
    extraSelection: [refs[1], refs[2]], getMesh: mesh, refreshObjects: async () => store.getState().objects });
  seed();
  await store.getState().scaleSelection([2, 2, 2]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(c => [c.args.objectId, c.args.instanceId]), [[1, 10], [1, 11], [2, 20]]);
  assert.deepEqual(commits, ['Transform objects']);
  assert.equal(invalidations.length, 1);
  assert.equal(store.getState().isLoading, false);
  for (const factor of [0, -1, NaN, Infinity]) await store.getState().scaleSelection([factor, 1, 1]);
  assert.equal(calls.length, 3);
  seed();
  store.setState({ getMesh: async () => { store.setState({ objects: [] }); return mesh(); } });
  await store.getState().scaleSelection([2, 2, 2]);
  assert.equal(calls.length, 3, 'removal while loading aborts batch');
  for (const mode of ['translate', 'rotate', 'scale']) {
    const select = () => {
      seed();
      store.setState({ gizmoMode: mode });
    };
    select();
    store.getState().selectObject(2, 20);
    assert.equal(store.getState().gizmoMode, mode, 'valid selection retains tool');
    store.getState().selectObject(null);
    assert.equal(store.getState().gizmoMode, null, 'explicit deselection clears tool');
    select();
    store.getState().toggleSelect(1, 10);
    assert.equal(store.getState().gizmoMode, mode, 'primary promotion retains tool');
    store.getState().toggleSelect(1, 11);
    assert.equal(store.getState().gizmoMode, mode, 'remaining selection retains tool');
    store.getState().toggleSelect(2, 20);
    assert.equal(store.getState().gizmoMode, null, 'final toggle clears tool');
    select();
    store.getState().selectObject(999);
    assert.equal(store.getState().gizmoMode, null, 'invalid selection clears tool');
    select();
    store.getState().selectObject(1, 999);
    assert.equal(store.getState().gizmoMode, null, 'invalid instance clears tool');
    select();
    globalThis.__multiScaleTest.engine.listObjects = async () => [structuredClone(objects[1])];
    await refreshObjects();
    assert.equal(store.getState().selectedInstanceId, 20, 'refresh promotes surviving instance');
    assert.equal(store.getState().gizmoMode, mode);
    globalThis.__multiScaleTest.engine.listObjects = async () => [{ ...objects[1], instances: [] }];
    await refreshObjects();
    assert.equal(store.getState().selectedObjectId, null);
    assert.equal(store.getState().gizmoMode, null, 'removed final instance clears tool');
    select();
    store.setState({ objects: [] });
    store.getState().selectAll();
    assert.equal(store.getState().gizmoMode, null, 'empty select-all clears tool');
  }
  delete globalThis.__multiScaleTest;
});
