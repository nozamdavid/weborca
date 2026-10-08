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

describe('Orca WASM Mesh Health & Repair Test Suite', () => {
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

    // Write test geometries into MEMFS
    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj'));
    core.writeFile('/models/cube.obj', cubeBytes);

    const brokenBytes = fs.readFileSync(path.join(repoRoot, 'wasm', 'tests', 'fixtures', 'broken_cube.stl'));
    core.writeFile('/models/broken_cube.stl', brokenBytes);
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('getMeshHealth reports healthy manifold metrics on closed 20mm cube', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    assert.ok(tree.objects.length > 0, 'Object tree must contain at least 1 object');
    const objId = tree.objects[tree.objects.length - 1].id;

    const health = await core.call('getMeshHealth', { objectId: objId });
    assert.equal(health.success, true, 'getMeshHealth should return success');
    assert.equal(health.objectId, objId, 'health objectId must match queried objectId');
    assert.equal(health.isManifold, true, 'watertight cube must be manifold');
    assert.equal(health.openEdges, 0, 'watertight cube must have 0 open edges');
    assert.equal(health.degenerateFacets, 0, 'watertight cube must have 0 degenerate facets');
    assert.ok(health.volume > 7900 && health.volume < 8100, `volume ~ 8000 mm^3, got: ${health.volume}`);
    assert.ok(Array.isArray(health.volumes), 'volumes breakdown must be an array');
    assert.equal(health.volumes.length, 1, 'must have 1 volume');
    assert.equal(health.volumes[0].isManifold, true);
    assert.equal(health.volumes[0].openEdges, 0);
  });

  test('getMeshHealth detects non-manifold boundary hole on broken_cube', async () => {
    await core.call('loadModel', { path: '/models/broken_cube.stl' });
    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[tree.objects.length - 1].id;

    const health = await core.call('getMeshHealth', { objectId: objId });
    assert.equal(health.success, true);
    assert.equal(health.isManifold, false, 'broken cube with missing face must not be manifold');
    assert.ok(health.openEdges > 0, `openEdges must be > 0, got: ${health.openEdges}`);
    assert.equal(health.facetsCount, 11, 'broken cube has 11 facets before repair');
  });

  test('repairObject repairs boundary holes and achieves manifold closure', async () => {
    await core.call('loadModel', { path: '/models/broken_cube.stl' });
    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[tree.objects.length - 1].id;

    const healthBefore = await core.call('getMeshHealth', { objectId: objId });
    assert.equal(healthBefore.isManifold, false);
    const openEdgesBefore = healthBefore.openEdges;

    const repairRes = await core.call('repairObject', {
      objectId: objId,
      keepPainting: true
    });

    assert.equal(repairRes.success, true, 'repairObject must succeed');
    assert.equal(repairRes.wasRepaired, true, 'wasRepaired must be true');
    assert.equal(repairRes.openEdgesBefore, openEdgesBefore);
    assert.equal(repairRes.openEdgesAfter, 0, 'openEdgesAfter must be 0');
    assert.equal(repairRes.isManifold, true, 'mesh must be manifold after repair');
    assert.ok(repairRes.facetsAfter >= 12, 'facets count after filling hole must be >= 12');

    // Verify subsequent getMeshHealth check also reflects the repaired state
    const healthAfter = await core.call('getMeshHealth', { objectId: objId });
    assert.equal(healthAfter.isManifold, true);
    assert.equal(healthAfter.openEdges, 0);
    healthBefore.boundingBox.forEach((value, i) => {
      assert.ok(Math.abs(value - healthAfter.boundingBox[i]) < 0.01);
    });
  });

  test('volumeId repair returns the replacement ID and preserves or clears painting explicitly', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const { objects: [obj] } = await core.call('getObjectTree', {});
    await core.call('setSupportPainting', {
      objectId: obj.id, volumeId: obj.volumes[0].id,
      facets: [{ facetId: 0, state: 'enforcer' }]
    });
    const result = await core.call('repairObject', {
      objectId: obj.id, volumeId: obj.volumes[0].id, keepPainting: true
    });
    assert.equal(result.success, true);
    const newId = result.volumes[0].volumeId;
    assert.notEqual(newId, obj.volumes[0].id);
    const paint = await core.call('getSupportPainting', { objectId: obj.id, volumeId: newId });
    assert.ok(paint.enforcers.length > 0, 'paint must survive topology remapping');
    const cleared = await core.call('repairObject', { objectId: obj.id, volumeId: newId, keepPainting: false });
    assert.equal(cleared.success, true);
    const after = await core.call('getSupportPainting', {
      objectId: obj.id, volumeId: cleared.volumes[0].volumeId
    });
    assert.equal(after.hasCustomSupports, false);
  });

  test('repaired object survives 3MF project roundtrip and slices cleanly without geometry loss', async () => {
    await core.call('loadModel', { path: '/models/broken_cube.stl' });
    const { objects: [obj] } = await core.call('getObjectTree', {});

    const repairRes = await core.call('repairObject', {
      objectId: obj.id,
      keepPainting: true
    });
    assert.equal(repairRes.success, true);
    assert.equal(repairRes.openEdgesAfter, 0);
    assert.equal(repairRes.isManifold, true);

    // Actual slicing evidence: repaired mesh slices cleanly to G-code
    const sliceRes = await core.call('slice', { outPath: '/out/repaired_cube.gcode', threads: 4 });
    assert.ok(sliceRes, 'slice must return a result');
    assert.ok(sliceRes.layers > 0, 'repaired object must produce layers');
    assert.ok(sliceRes.gcodeBytes > 0, 'repaired object must produce gcode bytes');

    // 3MF roundtrip: saveProject and re-open to expose whether geometry is preserved
    const saveRes = await core.call('saveProject', { path: '/out/repaired_roundtrip.3mf' });
    assert.ok(saveRes, 'saveProject must succeed');

    const openRes = await core.call('openProject', { path: '/out/repaired_roundtrip.3mf' });
    assert.ok(openRes.objects.length >= 1, 'reloaded project must retain the repaired object');
    const reloadedId = openRes.objects[0].id;

    // Verify reloaded mesh maintains manifold closure with 0 open edges
    const healthReloaded = await core.call('getMeshHealth', { objectId: reloadedId });
    assert.equal(healthReloaded.isManifold, true, 'reloaded repaired object must remain manifold');
    assert.equal(healthReloaded.openEdges, 0, 'reloaded repaired object must have 0 open edges');
    assert.equal(healthReloaded.degenerateFacets, 0, 'reloaded repaired object must have 0 degenerate facets');
  });

  test('unsupported splitting leaves tree and mesh unchanged', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const before = await core.call('getObjectTree', {});
    const objectId = before.objects[0].id;
    const mesh = await core.call('getMesh', { objectId });
    const bytes = Uint8Array.from(core.readFile(mesh.path));
    await assert.rejects(core.call('repairObject', { objectId, splitParts: true }), /splitParts/);
    assert.deepEqual(await core.call('getObjectTree', {}), before);
    const after = await core.call('getMesh', { objectId });
    assert.deepEqual(Uint8Array.from(core.readFile(after.path)), bytes);
  });

  test('repairObject leaves model untouched when non-existent objectId is provided', async () => {
    const invalidId = 999999;
    await assert.rejects(
      async () => {
        await core.call('repairObject', { objectId: invalidId });
      },
      /Object not found/
    );
  });
});
