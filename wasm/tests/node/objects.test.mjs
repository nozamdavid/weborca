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

});
