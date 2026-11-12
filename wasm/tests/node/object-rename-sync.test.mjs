import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

test('real rename action republishes engine objects to the scene store before history', async () => {
  const result = await build({
    entryPoints: ['wasm/app/src/objectlist/objectListStore.ts'],
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'rename-boundaries', setup(build) {
      build.onResolve({ filter: /orcaEngine$|plateStore$|appStore$|\/history$|volumePlacement$|layerRangeSync$/ }, args => ({ path: args.path, namespace: 'boundary' }));
      build.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({ contents:
        path.endsWith('volumePlacement') ? 'export const placeAddedVolume = () => {};' :
        path.endsWith('layerRangeSync') ? 'export const syncLayerRangesToEngine = () => {}; export const validateRangeBounds = () => {};' :
        path.endsWith('orcaEngine') ? 'export const getEngine = async () => globalThis.renameFixture.engine;' :
        path.endsWith('plateStore') ? 'export const usePlateStore = { getState: () => globalThis.renameFixture.plate, subscribe() {} };' :
        path.endsWith('/history') ? 'export const useHistoryStore = { getState: () => globalThis.renameFixture.history };' :
        'export const useAppStore = { getState: () => ({}) };'
      }));
    } }],
  });
  const { useObjectListStore } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  try {
    for (const direct of [true, false]) {
      let engineName = 'Before';
      const instances = [{ id: 7 }, { id: 8 }];
      const plate = { objects: [{ id: 1, name: engineName, instances }], async refreshObjects(preserveGeometry) {
        assert.equal(preserveGeometry, true, 'rename preserves unchanged mesh buffers');
        this.objects = [{ id: 1, name: engineName, instances }];
      } };
      const rename = async (id, name) => { assert.equal(id, 1); engineName = name; };
      globalThis.renameFixture = { plate, engine: {
        ...(direct ? { renameObject: rename } : { call: async (method, args) => { assert.equal(method, 'renameObject'); await rename(args.objectId, args.name); } }),
        getObjectTree: async () => ({ objects: [{ id: 1, name: engineName }] }),
      }, history: { async commitTransaction() { assert.equal(plate.objects[0].name, engineName); } } };
      await useObjectListStore.getState().renameObject(1, 'After 日本語\nlong');
      assert.equal(plate.objects[0].name, 'After 日本語\nlong');
      assert.equal(plate.objects[0].instances, instances);
      assert.equal(useObjectListStore.getState().objects[0].name, plate.objects[0].name);
    }
  } finally { delete globalThis.renameFixture; }
});
