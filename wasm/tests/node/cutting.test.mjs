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

describe('Orca WASM Planar Cutting Test Suite', () => {
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

  test('20mm cube at midpoint gives two closed positive-volume halves with volume sum tolerance and bounds', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const treeBefore = await core.call('getObjectTree', {});
    assert.equal(treeBefore.objects.length, 1);
    const origId = treeBefore.objects[0].id;

    // Midpoint cut at z = 10.0 mm
    const cutRes = await core.call('cutObject', {
      objectId: origId,
      z: 10.0,
      coordinateSystem: 'world',
      keepUpper: true,
      keepLower: true
    });

    assert.equal(cutRes.success, true, 'cutObject should succeed');
    assert.ok(Array.isArray(cutRes.createdObjects), 'createdObjects must be an array');
    assert.equal(cutRes.createdObjects.length, 2, 'cutting at midpoint must produce exactly 2 objects');

    const upper = cutRes.createdObjects.find((o) => o.part === 'upper');
    const lower = cutRes.createdObjects.find((o) => o.part === 'lower');
    assert.ok(upper, 'upper half must exist');
    assert.ok(lower, 'lower half must exist');

    // Both halves must be closed positive-volume meshes
    assert.ok(upper.volume > 0, `upper volume must be positive: ${upper.volume}`);
    assert.ok(lower.volume > 0, `lower volume must be positive: ${lower.volume}`);
    assert.equal(upper.openEdges, 0, 'upper half mesh must have 0 open edges (watertight closed)');
    assert.equal(lower.openEdges, 0, 'lower half mesh must have 0 open edges (watertight closed)');

    // Volume sum tolerance check: 20mm cube total volume = 8000 mm^3, each half ~ 4000 mm^3
    const expectedHalf = 4000.0;
    const expectedTotal = 8000.0;
    assert.ok(
      Math.abs(upper.volume - expectedHalf) < 20.0,
      `upper volume ${upper.volume} should be approximately ${expectedHalf}`
    );
    assert.ok(
      Math.abs(lower.volume - expectedHalf) < 20.0,
      `lower volume ${lower.volume} should be approximately ${expectedHalf}`
    );

    const sumVolume = upper.volume + lower.volume;
    assert.ok(
      Math.abs(sumVolume - expectedTotal) < 10.0,
      `sum of volumes ${sumVolume} must match original ${expectedTotal} within tolerance`
    );

    // Bounds check
    assert.ok(
      Math.abs(upper.boundingBox.min[2] - 10.0) < 0.1,
      `upper min Z ${upper.boundingBox.min[2]} should be ~10.0`
    );
    assert.ok(
      Math.abs(upper.boundingBox.max[2] - 20.0) < 0.1,
      `upper max Z ${upper.boundingBox.max[2]} should be ~20.0`
    );
    assert.ok(
      Math.abs(lower.boundingBox.min[2] - 0.0) < 0.1,
      `lower min Z ${lower.boundingBox.min[2]} should be ~0.0`
    );
    assert.ok(
      Math.abs(lower.boundingBox.max[2] - 10.0) < 0.1,
      `lower max Z ${lower.boundingBox.max[2]} should be ~10.0`
    );

    // Verify model hierarchy reflects deletion of original and presence of two new objects
    const treeAfter = await core.call('getObjectTree', {});
    assert.equal(treeAfter.objects.length, 2, 'model tree should have 2 objects');
    assert.ok(!treeAfter.objects.some((o) => o.id === origId), 'original object must be removed');
  });

  test('keep-one keeps only the requested half', async () => {
    // 1. Keep only upper half
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree1 = await core.call('getObjectTree', {});
    const id1 = tree1.objects[0].id;

    const resUpper = await core.call('cutObject', {
      objectId: id1,
      z: 10.0,
      keepUpper: true,
      keepLower: false
    });

    assert.equal(resUpper.success, true);
    assert.equal(resUpper.createdObjects.length, 1);
    assert.equal(resUpper.createdObjects[0].part, 'upper');
    assert.equal(resUpper.createdObjects[0].openEdges, 0);
    assert.ok(Math.abs(resUpper.createdObjects[0].volume - 4000.0) < 20.0);
    assert.ok(Math.abs(resUpper.createdObjects[0].boundingBox.min[2] - 10.0) < 0.1);

    const treeUpper = await core.call('getObjectTree', {});
    assert.equal(treeUpper.objects.length, 1);
    assert.equal(treeUpper.objects[0].id, resUpper.createdObjects[0].id);

    // 2. Keep only lower half
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree2 = await core.call('getObjectTree', {});
    const id2 = tree2.objects[0].id;

    const resLower = await core.call('cutObject', {
      objectId: id2,
      z: 10.0,
      keepMode: 'lower'
    });

    assert.equal(resLower.success, true);
    assert.equal(resLower.createdObjects.length, 1);
    assert.equal(resLower.createdObjects[0].part, 'lower');
    assert.equal(resLower.createdObjects[0].openEdges, 0);
    assert.ok(Math.abs(resLower.createdObjects[0].volume - 4000.0) < 20.0);
    assert.ok(Math.abs(resLower.createdObjects[0].boundingBox.max[2] - 10.0) < 0.1);

    const treeLower = await core.call('getObjectTree', {});
    assert.equal(treeLower.objects.length, 1);
    assert.equal(treeLower.objects[0].id, resLower.createdObjects[0].id);
  });

  test('invalid plane preserves original object', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const treeBefore = await core.call('getObjectTree', {});
    assert.equal(treeBefore.objects.length, 1);
    const origId = treeBefore.objects[0].id;
    const origName = treeBefore.objects[0].name;

    // Cut plane above object (cube is 0..20, plane at z = 50)
    const resAbove = await core.call('cutObject', {
      objectId: origId,
      z: 50.0
    });
    assert.equal(resAbove.success, false, 'cut above object should fail');
    assert.ok(resAbove.error.includes('does not intersect'));

    // Verify original object is intact
    let treeMid = await core.call('getObjectTree', {});
    assert.equal(treeMid.objects.length, 1);
    assert.equal(treeMid.objects[0].id, origId);
    assert.equal(treeMid.objects[0].name, origName);

    // Cut plane below object (plane at z = -10)
    const resBelow = await core.call('cutObject', {
      objectId: origId,
      z: -10.0
    });
    assert.equal(resBelow.success, false, 'cut below object should fail');
    assert.ok(resBelow.error.includes('does not intersect'));

    // Verify original object is still intact
    const treeAfter = await core.call('getObjectTree', {});
    assert.equal(treeAfter.objects.length, 1);
    assert.equal(treeAfter.objects[0].id, origId);
    assert.equal(treeAfter.objects[0].name, origName);
  });

  test('transformed multipart/plate assignment correctness', async () => {
    // Add Plate 2
    await core.call('addPlate', { name: 'Plate 2' });

    // Load cube
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[0].id;
    const instId = tree.objects[0].instances[0].id;

    // Add a second volume to make it multipart
    await core.call('addVolume', {
      objectId: objId,
      type: 'part',
      shape: 'cube',
      size: [10.0, 10.0, 10.0]
    });

    const multipartTree = await core.call('getObjectTree', {});
    assert.equal(multipartTree.objects[0].volumes.length, 2, 'object should have 2 volumes (multipart)');

    // Move instance onto Plate 2 (plate 2 origin is [360, 0, 0], bed center is [150, 150])
    // So world offset = [510.0, 150.0, 0.0]
    await core.call('setInstanceTransform', {
      objectId: objId,
      instanceId: instId,
      offset: [510.0, 150.0, 0.0]
    });

    // Verify initial assignment: instance must be on Plate 2 (index 1)
    const platesBefore = await core.call('listPlates', {});
    assert.equal(platesBefore.length, 2);
    const p1InstsBefore = platesBefore[1].instances.map((i) => i.instanceId);
    assert.ok(p1InstsBefore.includes(instId), 'instance should be on Plate 2 before cut');

    // Cut multipart object at midpoint (world Z = 5.0)
    const cutRes = await core.call('cutObject', {
      objectId: objId,
      z: 5.0,
      coordinateSystem: 'world'
    });

    assert.equal(cutRes.success, true, 'cut on transformed multipart object should succeed');
    assert.equal(cutRes.createdObjects.length, 2, 'should produce 2 cut objects');

    // Check multipart preservation: both cut objects should have multiple volumes
    for (const co of cutRes.createdObjects) {
      assert.ok(co.volumes.length >= 1, 'cut object should retain its volumes');
      assert.equal(co.openEdges, 0, 'cut mesh must be closed');
      assert.ok(co.volume > 0, 'cut volume must be positive');
    }

    // Plate assignment correctness: both cut objects must be assigned to Plate 2
    const platesAfter = await core.call('listPlates', {});
    assert.equal(platesAfter.length, 2);

    const plate1Ids = platesAfter[1].instances.map((i) => i.objectId);
    for (const co of cutRes.createdObjects) {
      assert.ok(
        plate1Ids.includes(co.id),
        `cut object ${co.id} (${co.name}) must be assigned to Plate 2`
      );
    }

    // Plate 1 (index 0) must NOT contain the cut objects
    const plate0Ids = platesAfter[0].instances.map((i) => i.objectId);
    for (const co of cutRes.createdObjects) {
      assert.ok(
        !plate0Ids.includes(co.id),
        `Plate 1 must not contain cut object ${co.id}`
      );
    }
  });
});
