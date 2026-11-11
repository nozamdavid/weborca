import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

const instance = (id) => ({ id, offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
const object = (id, name, instanceIds) => ({ id, name, volumes: 1, instances: instanceIds.map(instance), size: [10, 10, 10] });
const treeObject = (id, name, instanceIds, volumeIds = []) => ({
  id,
  name,
  instances: instanceIds.map((instanceId) => ({ id: instanceId })),
  volumes: volumeIds.map((volumeId) => ({ id: volumeId, name: `volume ${volumeId}`, type: 'part', extruder: 0, config: {}, overrides: [] })),
  layerRanges: [],
  config: {},
  overrides: []
});

async function loadHistorySelection() {
  const result = await build({
    stdin: {
      contents: `
        export { captureSelection, restoreSelectionSafely, capturePaintState, resolvePaintVolumeId } from './historyStore.ts';
        export { usePlateStore } from '../plate/plateStore.ts';
        export { useObjectListStore } from '../objectlist/objectListStore.ts';
      `,
      resolveDir: new URL('../../app/src/history', import.meta.url).pathname,
      loader: 'ts'
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [{
      name: 'history-boundaries',
      setup(build) {
        build.onResolve({ filter: /(?:engine\/(?:orcaEngine|stepModule)|store\/appStore|painting\/paintingStore|plates\/platesStore|(?:^|\/)history)$/ }, (args) => ({ path: args.path, namespace: 'boundary' }));
        build.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.includes('orcaEngine')) {
            return { loader: 'js', contents: 'export const getEngine=async()=>globalThis.__historySelection.engine; export const getConfig=async()=>({}); export const selectPresets=async()=>{}; export const evaluateRules=async()=>null; export const addModel=async()=>{}; export const slice=async()=>null;' };
          }
          if (path.includes('stepModule')) {
            return { loader: 'js', contents: 'export const isStepFileName=()=>false;' };
          }
          if (path.includes('appStore')) {
            return { loader: 'js', contents: 'export const useAppStore={getState:()=>globalThis.__historySelection.app,setState:()=>{}};' };
          }
          if (path.includes('paintingStore')) {
            return { loader: 'js', contents: 'export const usePaintingStore={getState:()=>({isPaintingActive:false,cancelStroke(){},stopPainting(){},startPainting:async()=>{},setPaintTarget:async()=>{},...globalThis.__historySelection.paint})};' };
          }
          if (path.includes('platesStore')) {
            return { loader: 'js', contents: 'export const usePlatesStore={getState:()=>({plates:[],activePlateIndex:0,fetchPlates:async()=>{},setActivePlate(){}})};' };
          }
          return { loader: 'js', contents: 'export const useHistoryStore={getState:()=>({commitTransaction:async()=>{}})};' };
        });
      }
    }]
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('painting volume identity survives new IDs independently of object-list volume selection', async () => {
  globalThis.__historySelection = { engine: {}, app: {}, paint: { isPaintingActive:true, selectedObjectId:10, selectedVolumeId:71, paintTarget:'seam' } };
  try {
    const { capturePaintState, resolvePaintVolumeId, useObjectListStore } = await loadHistorySelection();
    useObjectListStore.setState({ objects:[treeObject(10,'Part',[100],[70,71])], selectedVolumeId:70 });
    const saved=capturePaintState();
    assert.equal(saved.volumeIndex,1);
    useObjectListStore.setState({ objects:[treeObject(90,'Part',[900],[700,710])], selectedVolumeId:700 });
    assert.equal(resolvePaintVolumeId(saved,90),710);
    assert.equal(resolvePaintVolumeId({...saved,volumeIndex:undefined},90),null,'unknown legacy volume does not select the object-list volume');
  } finally { delete globalThis.__historySelection; }
});

test('history selection capture and restore preserve ordered instance identity across recreated IDs', async () => {
  globalThis.__historySelection = { engine: {}, app: {} };
  const { captureSelection, restoreSelectionSafely, usePlateStore, useObjectListStore } = await loadHistorySelection();
  const plate = usePlateStore;
  const tree = useObjectListStore;

  const seed = (objects, primary, extras, selectedVolumeId = null, treeObjects = []) => {
    plate.setState({
      objects,
      selectedObjectId: primary?.objectId ?? null,
      selectedInstanceId: primary?.instanceId ?? null,
      extraSelection: extras,
      gizmoMode: 'translate'
    });
    tree.setState({ objects: treeObjects, selectedObjectId: primary?.objectId ?? null, selectedVolumeId });
  };

  const before = [
    object(10, 'Part', [100, 101]),
    object(20, 'Part', [200])
  ];
  // Duplicate names: captured indices must win over the first name match.
  seed(before, { objectId: 20, instanceId: 200 }, [{ objectId: 10, instanceId: 101 }, { objectId: 10, instanceId: 100 }],
    null, [treeObject(10, 'Part', [100, 101]), treeObject(20, 'Part', [200])]);
  const captured = captureSelection(before);
  assert.deepEqual(captured.instances, [
    { objectName: 'Part', objectIndex: 1, instanceIndex: 0 },
    { objectName: 'Part', objectIndex: 0, instanceIndex: 1 },
    { objectName: 'Part', objectIndex: 0, instanceIndex: 0 }
  ]);

  // Native 3MF restore reallocates every object and instance ID.
  const recreated = [
    object(900, 'Part', [910, 911]),
    object(920, 'Part', [930])
  ];
  plate.setState({ objects: recreated, selectedObjectId: null, selectedInstanceId: null, extraSelection: [] });
  tree.setState({ objects: [treeObject(900, 'Part', [910, 911]), treeObject(920, 'Part', [930])], selectedVolumeId: null });
  const restored = restoreSelectionSafely({ id: 's1', selection: captured }, recreated);

  assert.deepEqual(restored, { primary: { objectId: 920, instanceId: 930 }, extras: [{ objectId: 900, instanceId: 911 }, { objectId: 900, instanceId: 910 }], volumeId: null });
  assert.equal(plate.getState().selectedObjectId, 920);
  assert.equal(plate.getState().selectedInstanceId, 930);
  assert.deepEqual(plate.getState().extraSelection, [{ objectId: 900, instanceId: 911 }, { objectId: 900, instanceId: 910 }]);

  delete globalThis.__historySelection;
});

test('history selection skips removed members without selecting unrelated objects', async () => {
  globalThis.__historySelection = { engine: {}, app: {} };
  const { restoreSelectionSafely, usePlateStore, useObjectListStore } = await loadHistorySelection();
  const plate = usePlateStore;
  const tree = useObjectListStore;

  // Captured primary was object index 1 with two instances; only the first object survives.
  const current = [object(900, 'First', [910, 911])];
  plate.setState({ objects: current, selectedObjectId: null, selectedInstanceId: null, extraSelection: [], gizmoMode: 'rotate' });
  tree.setState({ objects: [treeObject(900, 'First', [910, 911])], selectedVolumeId: null });
  const selection = {
    objectName: 'Second',
    objectIndex: 1,
    instanceIndex: 0,
    instances: [
      { objectName: 'Second', objectIndex: 1, instanceIndex: 0 },
      { objectName: 'First', objectIndex: 0, instanceIndex: 1 },
      { objectName: 'First', objectIndex: 0, instanceIndex: 5 }
    ]
  };
  const restored = restoreSelectionSafely({ id: 's2', selection }, current);
  assert.deepEqual(restored, { primary: { objectId: 900, instanceId: 911 }, extras: [], volumeId: null });
  assert.equal(plate.getState().selectedInstanceId, 911);
  assert.equal(plate.getState().gizmoMode, 'rotate', 'valid promoted selection retains the tool');

  // Nothing survives: clear the selection and the transform tool.
  const removed = { instances: [
    { objectName: 'Second', objectIndex: 1, instanceIndex: 0 },
    { objectName: 'First', objectIndex: 0, instanceIndex: 5 }
  ] };
  plate.setState({ gizmoMode: 'scale' });
  assert.equal(restoreSelectionSafely({ id: 's3', selection: removed }, current), null);
  assert.equal(plate.getState().selectedObjectId, null);
  assert.equal(plate.getState().extraSelection.length, 0);
  assert.equal(plate.getState().gizmoMode, null);
  assert.equal(tree.getState().selectedObjectId, null);

  // A stale index that now names another object falls back to the captured object name.
  const reordered = [object(800, 'Second', [810]), object(900, 'First', [910])];
  plate.setState({ objects: reordered, selectedObjectId: null, selectedInstanceId: null, extraSelection: [] });
  tree.setState({ objects: [treeObject(800, 'Second', [810]), treeObject(900, 'First', [910])], selectedVolumeId: null });
  const moved = { instances: [{ objectName: 'Second', objectIndex: 1, instanceIndex: 0 }] };
  assert.deepEqual(restoreSelectionSafely({ id: 's3b', selection: moved }, reordered).primary, { objectId: 800, instanceId: 810 });

  delete globalThis.__historySelection;
});

test('history selection keeps old snapshots compatible and restores a valid volume', async () => {
  globalThis.__historySelection = { engine: {}, app: {} };
  const { restoreSelectionSafely, usePlateStore, useObjectListStore } = await loadHistorySelection();
  const plate = usePlateStore;
  const tree = useObjectListStore;

  const current = [object(900, 'Part', [910]), object(920, 'Part', [930, 931])];
  plate.setState({ objects: current, selectedObjectId: null, selectedInstanceId: null, extraSelection: [] });
  tree.setState({
    objects: [treeObject(900, 'Part', [910], [70]), treeObject(920, 'Part', [930, 931], [77, 78])],
    selectedVolumeId: null
  });

  // Old snapshots carry only the primary fields; the validated index beats the duplicate name.
  const legacy = { objectName: 'Part', objectIndex: 1, instanceIndex: 1, volumeId: 999, volumeIndex: 1 };
  const restored = restoreSelectionSafely({ id: 's4', selection: legacy }, current);
  assert.deepEqual(restored, { primary: { objectId: 920, instanceId: 931 }, extras: [], volumeId: 78 });
  assert.equal(plate.getState().selectedObjectId, 920);
  assert.equal(tree.getState().selectedVolumeId, 78);

  // An invalid volume index falls back to the captured volume ID when it still exists.
  const fallback = { objectName: 'Part', objectIndex: 1, instanceIndex: 0, volumeId: 77, volumeIndex: 9 };
  assert.equal(restoreSelectionSafely({ id: 's5', selection: fallback }, current).volumeId, 77);

  // Empty selection clears instead of choosing the first object.
  plate.setState({ gizmoMode: 'translate' });
  assert.equal(restoreSelectionSafely({ id: 's6', selection: null }, current), null);
  assert.equal(plate.getState().selectedObjectId, null);
  assert.equal(plate.getState().gizmoMode, null);
  assert.equal(tree.getState().selectedVolumeId, null);

  delete globalThis.__historySelection;
});

test('history selection capture records the primary volume and ignores duplicate refs', async () => {
  globalThis.__historySelection = { engine: {}, app: {} };
  const { captureSelection, usePlateStore, useObjectListStore } = await loadHistorySelection();
  const objects = [object(900, 'Part', [910, 911])];
  usePlateStore.setState({ objects, selectedObjectId: 900, selectedInstanceId: 911, extraSelection: [{ objectId: 900, instanceId: 911 }, { objectId: 900, instanceId: 910 }, { objectId: 999, instanceId: 1 }] });
  useObjectListStore.setState({ objects: [treeObject(900, 'Part', [910, 911], [70, 78])], selectedVolumeId: 78 });

  const captured = captureSelection(objects);
  assert.deepEqual(captured.instances, [
    { objectName: 'Part', objectIndex: 0, instanceIndex: 1 },
    { objectName: 'Part', objectIndex: 0, instanceIndex: 0 }
  ]);
  assert.equal(captured.volumeIndex, 1);
  assert.equal(captured.volumeId, 78);
  assert.equal(captured.instanceIndex, 1);
  assert.equal(captureSelection([]), null);

  delete globalThis.__historySelection;
});
