import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const modulePath = process.env.ORCA_ENGINE_MODULE
  ? path.resolve(process.env.ORCA_ENGINE_MODULE)
  : path.join(
      repoRoot,
      'wasm',
      'build',
      'orca-wasm64',
      'wasm',
      'engine',
      'orca_engine.mjs'
    );

const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');
const scratchDir = path.join(bundleDir, 'scratch');

function countExtrusions(gcodeText) {
  let count = 0;
  for (const line of gcodeText.split('\n')) {
    if (line.startsWith('G1 ') && / E[0-9.]+/.test(line)) {
      count++;
    }
  }
  return count;
}

describe('Orca WASM Engine Object List & Modifiers Test Suite', () => {
  let core;

  before(async () => {
    fs.mkdirSync(scratchDir, { recursive: true });

    const resJsonPath = path.join(bundleDir, 'resources.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');

    if (!fs.existsSync(resJsonPath) || !fs.existsSync(voronJsonPath) || !fs.existsSync(orcaFilJsonPath)) {
      const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
      execFileSync(process.execPath, [packScript, repoRoot, bundleDir, 'Voron', 'OrcaFilamentLibrary'], {
        stdio: 'inherit'
      });
    }

    const mod = await import(modulePath);
    const moduleFactory = mod.createOrcaEngine || mod.default;

    core = await createEngineCore({
      moduleFactory,
      threads: 4
    });

    await core.addVendorBundle(JSON.parse(fs.readFileSync(resJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(voronJsonPath, 'utf8')));

    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    // Write 20mm test cube into MEMFS
    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj'));
    core.writeFile('/models/cube.obj', cubeBytes);
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('getObjectTree lists a loaded cube with its volume and instances', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});

    assert.ok(tree && Array.isArray(tree.objects), 'getObjectTree must return objects array');
    assert.equal(tree.objects.length, 1, 'tree should have exactly 1 object');

    const obj = tree.objects[0];
    assert.ok(obj.id > 0, 'object must have a valid positive ID');
    assert.ok(obj.name.includes('cube'), `object name "${obj.name}" should contain cube`);
    assert.equal(obj.instances.length, 1, 'object should have 1 instance');
    assert.equal(obj.volumes.length, 1, 'object should have 1 volume');

    const vol = obj.volumes[0];
    assert.ok(vol.id > 0, 'volume must have a valid positive ID');
    assert.equal(vol.type, 'part', 'initial volume type must be part');
    assert.equal(vol.extruder, 0, 'initial volume extruder should be 0 (default)');
  });

  test('renameObject and renameVolume update hierarchy names', async () => {
    const tree1 = await core.call('getObjectTree', {});
    const objId = tree1.objects[0].id;
    const volId = tree1.objects[0].volumes[0].id;

    await core.call('renameObject', { objectId: objId, name: 'RenamedCube' });
    await core.call('renameVolume', { objectId: objId, volumeId: volId, name: 'RenamedPart' });

    const tree2 = await core.call('getObjectTree', {});
    assert.equal(tree2.objects[0].name, 'RenamedCube');
    assert.equal(tree2.objects[0].volumes[0].name, 'RenamedPart');
  });

  test('setObjectConfig validates scopes: rejects invalid scope keys and unknown keys', async () => {
    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[0].id;
    const volId = tree.objects[0].volumes[0].id;

    // Unknown key at object scope
    const res1 = await core.call('setObjectConfig', {
      objectId: objId,
      options: { nonexistent_key_xyz: '123' }
    });
    assert.ok(res1.errors.length > 0, 'should return error for unknown key');
    assert.equal(res1.errors[0].key, 'nonexistent_key_xyz');

    // PrintObjectConfig-only key (e.g. layer_height) attempted at volume scope
    const res2 = await core.call('setObjectConfig', {
      objectId: objId,
      volumeId: volId,
      options: { layer_height: '0.15' }
    });
    assert.ok(res2.errors.length > 0, 'volume scope must reject layer_height (object-only)');
    assert.equal(res2.errors[0].key, 'layer_height');

    // Valid PrintRegionConfig key at volume scope
    const res3 = await core.call('setObjectConfig', {
      objectId: objId,
      volumeId: volId,
      options: { wall_loops: '4' }
    });
    assert.equal(res3.errors.length, 0, 'volume scope should accept wall_loops');
  });

  test('resetObjectConfig removes overrides', async () => {
    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[0].id;
    const volId = tree.objects[0].volumes[0].id;

    // Set override on object
    await core.call('setObjectConfig', {
      objectId: objId,
      options: { wall_loops: '5' }
    });

    let treeAfterSet = await core.call('getObjectTree', {});
    assert.equal(treeAfterSet.objects[0].config.wall_loops, '5');

    // Reset with specific keys
    await core.call('resetObjectConfig', {
      objectId: objId,
      keys: ['wall_loops']
    });

    let treeAfterReset = await core.call('getObjectTree', {});
    assert.equal(treeAfterReset.objects[0].config.wall_loops, undefined);

    // Reset volume
    await core.call('resetObjectConfig', {
      objectId: objId,
      volumeId: volId
    });
    treeAfterReset = await core.call('getObjectTree', {});
    assert.equal(treeAfterReset.objects[0].volumes[0].config.wall_loops, undefined);
  });

  test('addVolume adds modifier and slicing with different sparse_infill_density changes G-code', async () => {
    // Reload a clean cube
    await core.call('loadModel', { path: '/models/cube.obj' });
    await core.call('arrange', {});

    const baseSlice = await core.call('slice', { outPath: '/out/base.gcode' });
    const baseBytes = core.readFile('/out/base.gcode');
    const baseGcode = new TextDecoder().decode(baseBytes);
    const baseExtrusions = countExtrusions(baseGcode);

    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[0].id;

    // Add a cube modifier overlapping the model center
    const addModRes = await core.call('addVolume', {
      objectId: objId,
      type: 'modifier',
      shape: 'cube',
      size: [15, 15, 15]
    });
    assert.ok(addModRes.volumeId > 0, 'modifier must receive a valid volumeId');

    // Set 80% sparse infill density on the modifier
    const cfgRes = await core.call('setObjectConfig', {
      objectId: objId,
      volumeId: addModRes.volumeId,
      options: { sparse_infill_density: '80%' }
    });
    assert.equal(cfgRes.errors.length, 0, 'setting modifier infill density should succeed without errors');

    const modSlice = await core.call('slice', { outPath: '/out/mod.gcode' });
    const modBytes = core.readFile('/out/mod.gcode');
    const modGcode = new TextDecoder().decode(modBytes);
    const modExtrusions = countExtrusions(modGcode);

    // Modifer with 80% infill must change G-code and increase extrusion
    assert.notEqual(modGcode, baseGcode, 'G-code with 80% infill modifier must differ from baseline');
    assert.ok(modSlice.filamentMm > baseSlice.filamentMm, '80% infill modifier must consume more filament mm');
    assert.ok(modExtrusions > baseExtrusions, '80% infill modifier must produce more extrusion moves');

    // Delete modifier
    await core.call('deleteVolume', { objectId: objId, volumeId: addModRes.volumeId });
    const treeAfterDel = await core.call('getObjectTree', {});
    assert.equal(treeAfterDel.objects[0].volumes.length, 1, 'modifier volume should be removed');
  });

  test('negative volume removes material (fewer extrusion moves)', async () => {
    // Baseline clean slice
    await core.call('loadModel', { path: '/models/cube.obj' });
    await core.call('arrange', {});

    const baseSlice = await core.call('slice', { outPath: '/out/base_neg.gcode' });
    const baseBytes = core.readFile('/out/base_neg.gcode');
    const baseGcode = new TextDecoder().decode(baseBytes);
    const baseExtrusions = countExtrusions(baseGcode);

    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[0].id;

    // Add a negative volume cutting off the top half of the cube
    const addNegRes = await core.call('addVolume', {
      objectId: objId,
      type: 'negative',
      shape: 'cube',
      size: [25, 25, 12],
      offset: [10, 10, 15]
    });
    assert.ok(addNegRes.volumeId > 0, 'negative volume must receive a valid volumeId');

    const negSlice = await core.call('slice', { outPath: '/out/neg.gcode' });
    const negBytes = core.readFile('/out/neg.gcode');
    const negGcode = new TextDecoder().decode(negBytes);
    const negExtrusions = countExtrusions(negGcode);

    // Negative volume cuts out material -> fewer extrusion moves and less filament
    assert.notEqual(negGcode, baseGcode, 'G-code with negative part must differ from baseline');
    assert.ok(negSlice.filamentMm < baseSlice.filamentMm, 'negative volume must use less filament');
    assert.ok(negExtrusions < baseExtrusions, 'negative volume must have fewer extrusion moves');
  });

  test('setVolumeExtruder updates volume extruder', async () => {
    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[0].id;
    const volId = tree.objects[0].volumes[0].id;

    await core.call('setVolumeExtruder', {
      objectId: objId,
      volumeId: volId,
      extruder: 2
    });

    const tree2 = await core.call('getObjectTree', {});
    assert.equal(tree2.objects[0].volumes[0].extruder, 2);

    // Reset to 0 (default/inherited)
    await core.call('setVolumeExtruder', {
      objectId: objId,
      volumeId: volId,
      extruder: 0
    });

    const tree3 = await core.call('getObjectTree', {});
    assert.equal(tree3.objects[0].volumes[0].extruder, 0);
  });
  test('reordering parts preserves IDs, settings and all desktop primitive shapes', async () => {
    const objectId = (await core.call('getObjectTree', {})).objects[0].id;
    const ids = [];
    for (const shape of ['disc', 'torus', 'slab']) {
      const result = await core.call('addVolume', { objectId, type: 'part', shape, size: [10, 10, 10] });
      ids.push(result.volumeId);
    }
    const volumeId = ids[2];
    await core.call('renameVolume', { objectId, volumeId, name: 'Reordered slab' });
    await core.call('setVolumeExtruder', { objectId, volumeId, extruder: 2 });
    const before = (await core.call('getObjectTree', {})).objects[0].volumes;
    await core.call('moveVolume', { objectId, volumeId, toIndex: 0 });
    const after = (await core.call('getObjectTree', {})).objects[0].volumes;
    assert.deepEqual(after[0], before.find(v => v.id === volumeId));
    assert.deepEqual(after.slice(1), before.filter(v => v.id !== volumeId));
    for (const id of ids) await core.call('deleteVolume', { objectId, volumeId: id });
  });

  test('native STL export excludes modifiers and preserves mirrored instance bounds', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const object = (await core.call('listObjects', {}))[0];
    await core.call('addVolume', { objectId: object.id, type: 'modifier', shape: 'cube', size: [50, 50, 50] });
    await core.call('setInstanceTransform', { objectId: object.id, instanceId: object.instances[0].id, offset: [35, 50, 0], scale: [2, 1, 1] });
    await core.call('mirrorInstance', { objectId: object.id, instanceId: object.instances[0].id, axis: 0 });
    const before = await core.call('listObjects', {});
    await core.call('exportModel', { path: '/out/native.stl', format: 'stl' });
    const bytes = core.readFile('/out/native.stl');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(80, true), 12, 'modifier must not be exported');
    const bounds = [[], [], []];
    for (let face = 0; face < 12; face++)
      for (let vertex = 0; vertex < 3; vertex++)
        for (let axis = 0; axis < 3; axis++) bounds[axis].push(view.getFloat32(84 + face * 50 + 12 + vertex * 12 + axis * 4, true));
    assert.deepEqual(bounds.map(values => Math.max(...values) - Math.min(...values)), [40, 20, 20]);
    assert.deepEqual(bounds.slice(0, 2).map(values => (Math.max(...values) + Math.min(...values)) / 2), [15, 60]);
    assert.deepEqual(await core.call('listObjects', {}), before, 'export is read-only');
    await core.call('exportModel', { path: '/out/generic.3mf', format: '3mf' });
    const generic = core.readFile('/out/generic.3mf');
    assert.ok(generic.byteLength > 100);
    await core.call('openProject', { path: '/out/generic.3mf' });
    assert.equal((await core.call('listObjects', {})).length, 1, 'generic 3MF opens as geometry');
  });
  test('placing an imported group preserves existing objects and places it on the requested plate', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const original = (await core.call('listObjects'))[0];
    await core.call('setInstanceTransform', { objectId: original.id, instanceId: original.instances[0].id, offset: [50, 65, 10] });
    const before = (await core.call('listObjects'))[0];
    const added = await core.call('addModel', { path: '/models/cube.obj' });
    await core.call('placeObjects', { objectIds: added.objects.map(o => o.id), plateIndex: 0 });
    const objects = await core.call('listObjects');
    assert.deepEqual(objects.find(o => o.id === original.id), before);
    const placed = objects.find(o => o.id === added.objects[0].id);
    assert.equal(placed.instances[0].offset[0], 150);
    assert.equal(placed.instances[0].offset[1], 150);
    assert.equal(placed.instances[0].offset[2], 10);
    await assert.rejects(core.call('placeObjects', { objectIds: [placed.id], plateIndex: 100 }), /Invalid plate/);
  });

  test('clipboard snapshots selected instances and retains settings after cut and deletion', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const original = (await core.call('listObjects'))[0];
    await core.call('setObjectConfig', { objectId: original.id, options: { layer_height: '0.12' } });
    await core.call('duplicateInstance', { objectId: original.id, instanceId: original.instances[0].id });
    await core.call('copySelection', { instances: [{ objectId: original.id, instanceId: original.instances[0].id }], cut: true });
    assert.equal((await core.call('listObjects'))[0].instances.length, 1);
    await core.call('deleteObject', { objectId: original.id });
    const first = await core.call('pasteSelection', { offset: [10, 20, 0] });
    const second = await core.call('pasteSelection');
    assert.notEqual(first.objectIds[0], second.objectIds[0]);
    const objects = await core.call('listObjects');
    assert.equal(objects.length, 2);
    assert.ok(objects.every(o => o.instances.length === 1));
    const tree = await core.call('getObjectTree');
    assert.equal(tree.objects.find(o => o.id === first.objectIds[0]).config.layer_height, '0.12');
  });

  test('deleting selected instances retains siblings and the independent clipboard', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const original = (await core.call('listObjects'))[0];
    await core.call('duplicateInstance', { objectId: original.id, instanceId: original.instances[0].id });
    const refs = (await core.call('listObjects'))[0].instances.map(instance => ({ objectId: original.id, instanceId: instance.id }));
    await core.call('copySelection', { instances: [refs[0]] });
    await assert.rejects(core.call('deleteInstances', { instances: [refs[0], { objectId: original.id, instanceId: 999999999 }] }), /instance not found/);
    assert.equal((await core.call('listObjects'))[0].instances.length, 2, 'invalid selections must not partially delete');
    await core.call('deleteInstances', { instances: [refs[1], refs[1]] });
    assert.deepEqual((await core.call('listObjects'))[0].instances.map(instance => instance.id), [refs[0].instanceId]);
    await core.call('deleteInstances', { instances: [refs[0]] });
    assert.equal((await core.call('listObjects')).length, 0);
    await core.call('pasteSelection');
    assert.equal((await core.call('listObjects'))[0].instances.length, 1, 'Delete must preserve the earlier clipboard');
  });

  test('indexed option edits retain sibling slots and project native serialized values', async () => {
    await core.call('selectPresets', { printer: 'Voron 2.4 300 0.4 nozzle', process: '0.20mm Standard @Voron', filaments: ['Generic PLA @System', 'Generic PLA @System'] });
    await core.call('setOptions', { options: { nozzle_temperature: '210,240', filament_retraction_length: '1,2,3,4' } });
    assert.equal((await core.call('setOption', { key: 'nozzle_temperature', value: '245', filamentIndex: 1 })).success, true);
    assert.equal((await core.call('getConfig')).nozzle_temperature, '210,245');
    assert.deepEqual(await core.call('getOption', { key: 'nozzle_temperature', filamentIndex: 1 }), { value: '245' });
    assert.deepEqual(await core.call('getOption', { key: 'nozzle_temperature', filamentIndex: 1, serializedValue: '210,240' }), { value: '240' });
    const text = 'M900 K0.05\n; comment with "quotes"';
    await core.call('setOption', { key: 'filament_start_gcode', value: text, filamentIndex: 1 });
    assert.equal((await core.call('getOption', { key: 'filament_start_gcode', filamentIndex: 1 })).value, text);
    assert.equal((await core.call('getOption', { key: 'filament_retraction_length', filamentIndex: 1, layoutIndex: 1 })).value, '4');
    await core.call('setOption', { key: 'filament_retraction_length', value: '9', filamentIndex: 1, layoutIndex: 1 });
    assert.equal((await core.call('getConfig')).filament_retraction_length, '1,2,3,9');
    const before = await core.call('getConfig');
    for (const value of ['invalid', '240junk', '240.5', '2147483648', '', '240,', '240,241']) {
      assert.equal((await core.call('setOption', { key: 'nozzle_temperature', value, filamentIndex: 0 })).success, false, value);
    }
    for (const value of ['NaN', 'Infinity', '1.2junk']) {
      assert.equal((await core.call('setOption', { key: 'filament_retraction_length', value, filamentIndex: 0, layoutIndex: 0 })).success, false, value);
    }
    for (const op of ['getOption', 'setOption']) {
      for (const filamentIndex of [-1, 2, 1.5]) await assert.rejects(core.call(op, { key: 'nozzle_temperature', value: '250', filamentIndex }), /Invalid filament index/);
      await assert.rejects(core.call(op, { key: 'nozzle_temperature', value: '250', filamentIndex: 0, layoutIndex: 1.5 }), /Invalid layout index/);
      await assert.rejects(core.call(op, { key: 'layer_height', value: '0.2', filamentIndex: 1 }), /Not a filament key/);
    }
    for (const filamentIndex of [-1, 2, 1.5]) {
      await assert.rejects(core.call('resetOptions', { overrides: { nozzle_temperature: '240' }, filamentIndex }), /Invalid filament index/);
      await assert.rejects(core.call('resetOptions', { key: 'nozzle_temperature', filamentIndex }), /Invalid filament index/);
    }
    await assert.rejects(core.call('resetOptions', { overrides: { nozzle_temperature: '240' }, filamentIndex: null }), /Invalid filament index/);
    await assert.rejects(core.call('resetOptions', { key: 'nozzle_temperature', filamentIndex: 0, layoutIndex: 1.5 }), /Invalid layout index/);
    await assert.rejects(core.call('resetOptions', { key: 'nozzle_temperature', filamentIndex: 0, layoutIndex: 99 }), /Invalid layout index/);
    await assert.rejects(core.call('getOption', { key: 'nozzle_temperature', serializedValue: 'invalid' }), /Invalid serialized/);
    assert.deepEqual(await core.call('getConfig'), before, 'rejected edits must preserve configuration');
  });

  test('literal scalar text preserves newlines, backslashes and quotes through native serialization', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const notes = 'First line\nC:\\new\\test; "quoted"';
    assert.equal((await core.call('setOption', { key: 'notes', value: notes })).success, true);
    assert.equal((await core.call('getOption', { key: 'notes' })).value, notes);
    const serialized = (await core.call('getConfig')).notes;
    assert.equal((await core.call('getOption', { key: 'notes', serializedValue: serialized })).value, notes);
    await core.call('saveProject', { path: '/out/literal-notes.3mf' });
    fs.writeFileSync(path.join(scratchDir, 'literal-notes.3mf'), core.readFile('/out/literal-notes.3mf'));
    await core.call('setOption', { key: 'notes', value: 'Other notes' });
    await core.call('openProject', { path: '/out/literal-notes.3mf' });
    assert.equal((await core.call('getOption', { key: 'notes' })).value, notes);
  });

  test('desktop filament merge preserves independent slot values and 3MF overrides', async () => {
    await core.call('selectPresets', { printer: 'Voron 2.4 300 0.4 nozzle', process: '0.20mm Standard @Voron', filaments: ['Generic PLA @System', 'Generic PLA @System'] });
    const before = await core.call('getConfig');
    const slots = [
      { preset: 'Generic PLA @System', values: { nozzle_temperature: '210', filament_type: 'PLA', filament_colour: '#FF0000' } },
      { preset: 'Generic PLA @System', values: { nozzle_temperature: '240', filament_type: 'PETG', filament_colour: '#00FF00' } }
    ];
    const merged = await core.call('mergeFilamentPresets', { slots });
    assert.equal(merged.nozzle_temperature, '210,240');
    assert.equal(merged.filament_type, 'PLA;PETG');
    assert.equal(merged.filament_colour, '#FF0000;#00FF00');
    assert.deepEqual(await core.call('getConfig'), before, 'merging must not change active presets');
    await assert.rejects(core.call('mergeFilamentPresets', { slots: [{ preset: 'Generic PLA @System', values: { layer_height: '0.3' } }] }), /Not a filament option/);
    await core.call('setOptions', { options: merged });
    const slot0 = await core.call('getConfig', { filamentIndex: 0, keys: ['nozzle_temperature', 'filament_type', 'filament_colour'] });
    const slot1 = await core.call('getConfig', { filamentIndex: 1, keys: ['nozzle_temperature', 'filament_type', 'filament_colour'] });
    assert.deepEqual(slot0, { nozzle_temperature: '210', filament_type: 'PLA', filament_colour: '#FF0000' });
    assert.deepEqual(slot1, { nozzle_temperature: '240', filament_type: 'PETG', filament_colour: '#00FF00' });
    await assert.rejects(core.call('getConfig', { filamentIndex: 2 }), /Invalid filament index/);
    await core.call('saveProject', { path: '/out/filament-slots.3mf' });
    await core.call('openProject', { path: '/out/filament-slots.3mf' });
    const restored = await core.call('getConfig');
    assert.equal(restored.nozzle_temperature, '210,240');
    assert.equal(restored.filament_type, 'PLA;PETG');

    // Single slot override merges with per-slot native defaults
    const singleOverrideSlots = [
      { preset: 'Generic PLA @System', values: {} },
      { preset: 'Generic PLA @System', values: { nozzle_temperature: '250' } }
    ];
    const singleOverrideMerged = await core.call('mergeFilamentPresets', { slots: singleOverrideSlots });
    assert.equal(singleOverrideMerged.nozzle_temperature, '210,250');

    // Valid resetOptions with per-slot overrides computes remaining overrides correctly
    const remaining = await core.call('resetOptions', {
      overrides: { nozzle_temperature: '210,240', filament_colour: '#FF0000;#00FF00' },
      filamentIndex: 1
    });
    assert.ok(remaining.filamentOverrides !== undefined);
    const savedBaseline = await core.call('resetOptions', {
      filamentIndex: 1,
      overrides: { nozzle_temperature: '211,240', flush_volumes_matrix: '0,500,350,0' },
      baseline: { nozzle_temperature: '220,237' }
    });
    assert.equal(savedBaseline.filamentOverrides.nozzle_temperature, '211,237');
    assert.equal(savedBaseline.filamentOverrides.flush_volumes_matrix, '0,500,350,0');
  });

});
