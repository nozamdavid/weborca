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
const benchyModelPath = path.join(repoRoot, 'wasm', 'build', 'models', '3DBenchy.stl');

function parseGcodeLayerZ(gcodeText) {
  const zHeights = [];
  const lines = gcodeText.split('\n');
  for (const line of lines) {
    // Look for layer change markers or Z moves
    const match = line.match(/^;AFTER_LAYER_CHANGE/i) || line.match(/^G1\s+Z([0-9.]+)/i);
    if (match) {
      const zMatch = line.match(/Z([0-9.]+)/);
      if (zMatch) {
        const z = parseFloat(zMatch[1]);
        if (zHeights.length === 0 || Math.abs(zHeights[zHeights.length - 1] - z) > 1e-4) {
          zHeights.push(z);
        }
      }
    }
  }
  return zHeights;
}

describe('Orca WASM Variable Layer Height & Adaptive Slicing Test Suite', () => {
  let core;
  let benchyObjId;

  before(async () => {
    fs.mkdirSync(scratchDir, { recursive: true });

    const resJsonPath = path.join(bundleDir, 'resources.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');

    if (
      !fs.existsSync(resJsonPath) ||
      !fs.existsSync(voronJsonPath) ||
      !fs.existsSync(orcaFilJsonPath)
    ) {
      const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
      execFileSync(
        process.execPath,
        [packScript, repoRoot, bundleDir, 'Voron', 'OrcaFilamentLibrary'],
        { stdio: 'inherit' }
      );
    }

    // Ensure 3DBenchy model exists
    if (!fs.existsSync(benchyModelPath)) {
      const fetchScript = path.join(repoRoot, 'wasm', 'tests', 'data', 'fetch_models.sh');
      execFileSync('bash', [fetchScript], { stdio: 'inherit' });
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

    // Write 3DBenchy into MEMFS
    const benchyBytes = fs.readFileSync(benchyModelPath);
    core.writeFile('/models/3DBenchy.stl', benchyBytes);

    const loadRes = await core.call('loadModel', { path: '/models/3DBenchy.stl' });
    assert.ok(loadRes, 'loadModel must succeed');

    const tree = await core.call('getObjectTree', {});
    assert.ok(tree.objects.length >= 1, 'At least 1 object loaded');
    benchyObjId = tree.objects[0].id;
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('getLayerHeightProfile returns nominal profile and nozzle limits', async () => {
    const res = await core.call('getLayerHeightProfile', { objectId: benchyObjId });
    assert.ok(res, 'getLayerHeightProfile must return result');
    assert.equal(res.objectId, benchyObjId);
    assert.equal(res.hasCustomProfile, false, 'Initial object should have no custom profile');
    assert.ok(Array.isArray(res.profile), 'profile must be an array');
    assert.ok(res.profile.length >= 4, 'profile must have at least 2 pairs');
    assert.ok(res.minLayerHeight > 0.05, `minLayerHeight (${res.minLayerHeight}) should be > 0.05`);
    assert.ok(res.maxLayerHeight < 0.4, `maxLayerHeight (${res.maxLayerHeight}) should be < 0.4`);
    assert.ok(Math.abs(res.nominalHeight - 0.20) < 1e-4, 'nominalHeight should be 0.20');
    assert.ok(res.objectHeight > 40 && res.objectHeight < 55, `3DBenchy height ~48mm (${res.objectHeight})`);
    assert.ok(res.layerCount > 200, `layerCount should be > 200 (${res.layerCount})`);
  });

  test('adaptiveLayerHeights computes varying layer heights bounded within min/max', async () => {
    const res = await core.call('adaptiveLayerHeights', {
      objectId: benchyObjId,
      quality: 0.5
    });

    assert.ok(res.success, 'adaptiveLayerHeights must return success');
    assert.ok(Array.isArray(res.profile), 'profile must be array');
    assert.ok(res.profile.length >= 4, 'profile must have pairs');

    const heights = [];
    for (let i = 1; i < res.profile.length; i += 2) {
      heights.push(res.profile[i]);
    }

    const minH = Math.min(...heights);
    const maxH = Math.max(...heights);

    assert.ok(
      minH >= res.minLayerHeight - 1e-4,
      `All adaptive layers must be >= minLayerHeight (${minH} >= ${res.minLayerHeight})`
    );
    assert.ok(
      maxH <= res.maxLayerHeight + 1e-4,
      `All adaptive layers must be <= maxLayerHeight (${maxH} <= ${res.maxLayerHeight})`
    );

    // Variation check: adaptive algorithm produces different layer heights
    assert.ok(
      maxH - minH > 0.05,
      `Adaptive profile must have variation across layers (maxH: ${maxH}, minH: ${minH})`
    );

    // Fixed 0.20mm nominal produces ~240 layers; adaptive should be different
    const fixedLayers = Math.round(48.0 / 0.20);
    assert.notEqual(
      res.layerCount,
      fixedLayers,
      `Adaptive layer count (${res.layerCount}) must differ from uniform 0.2mm (${fixedLayers})`
    );

    // Check hasCustomProfile is now true
    const checkProf = await core.call('getLayerHeightProfile', { objectId: benchyObjId });
    assert.equal(checkProf.hasCustomProfile, true);
  });

  test('slicing with adaptive profile reflects custom layer count and variable Z steps in G-code', async () => {
    const profRes = await core.call('getLayerHeightProfile', { objectId: benchyObjId });
    const expectedLayerCount = profRes.layerCount;

    // Keep the model inside the 300 mm Voron bed (loaded models start at the origin).
    const [benchy] = (await core.call('listObjects', {})).filter((o) => o.id === benchyObjId);
    await core.call('setInstanceTransform', { objectId: benchyObjId, instanceId: benchy.instances[0].id, offset: [150, 150, benchy.instances[0].offset[2]] });

    const sliceRes = await core.call('slice', {
      outPath: '/out/benchy_adaptive.gcode',
      threads: 4
    });

    assert.ok(sliceRes, 'slice must return result');
    assert.ok(sliceRes.layers > 0, 'layers must be > 0');
    // Total slice layers matches adaptive object layer count (within raft/rounding)
    assert.ok(
      Math.abs(sliceRes.layers - expectedLayerCount) <= 2,
      `Slice layer count (${sliceRes.layers}) should match adaptive layer count (${expectedLayerCount})`
    );

    const gcodeBytes = core.readFile('/out/benchy_adaptive.gcode');
    const gcodeText = Buffer.from(gcodeBytes).toString('utf8');
    const zHeights = parseGcodeLayerZ(gcodeText);

    assert.ok(zHeights.length > 50, 'G-code should have layer Z positions');

    // Compute delta Z steps between consecutive layers
    const zSteps = [];
    for (let i = 1; i < zHeights.length; i++) {
      const dz = zHeights[i] - zHeights[i - 1];
      if (dz > 0.05 && dz < 0.35) {
        zSteps.push(dz);
      }
    }

    const minDz = Math.min(...zSteps);
    const maxDz = Math.max(...zSteps);
    assert.ok(
      maxDz - minDz > 0.04,
      `G-code Z steps must vary according to adaptive profile (minDz: ${minDz}, maxDz: ${maxDz})`
    );
  });

  test('smoothLayerHeights reduces height variance while preserving bounds', async () => {
    const beforeProf = await core.call('getLayerHeightProfile', { objectId: benchyObjId });
    const beforeHeights = [];
    for (let i = 1; i < beforeProf.profile.length; i += 2) {
      beforeHeights.push(beforeProf.profile[i]);
    }

    // Measure variance before smoothing
    const meanBefore = beforeHeights.reduce((a, b) => a + b, 0) / beforeHeights.length;
    const varBefore =
      beforeHeights.reduce((a, b) => a + (b - meanBefore) ** 2, 0) / beforeHeights.length;

    const smoothRes = await core.call('smoothLayerHeights', {
      objectId: benchyObjId,
      radius: 5,
      keepMin: false
    });

    assert.ok(smoothRes.success, 'smoothLayerHeights must succeed');

    const afterHeights = [];
    for (let i = 1; i < smoothRes.profile.length; i += 2) {
      afterHeights.push(smoothRes.profile[i]);
    }

    const meanAfter = afterHeights.reduce((a, b) => a + b, 0) / afterHeights.length;
    const varAfter =
      afterHeights.reduce((a, b) => a + (b - meanAfter) ** 2, 0) / afterHeights.length;

    assert.ok(
      varAfter <= varBefore,
      `Variance after smoothing (${varAfter}) should be <= before (${varBefore})`
    );
  });

  test('adjustLayerHeights modifies layer thickness around specified Z', async () => {
    const targetZ = 15.0;
    const initialProf = await core.call('getLayerHeightProfile', { objectId: benchyObjId });

    // Find layer height near targetZ before adjust
    let initialH = 0.2;
    for (let i = 0; i + 1 < initialProf.profile.length; i += 2) {
      if (initialProf.profile[i] >= targetZ) {
        initialH = initialProf.profile[i + 1];
        break;
      }
    }

    // Apply adjust with increase
    const adjRes = await core.call('adjustLayerHeights', {
      objectId: benchyObjId,
      z: targetZ,
      delta: 0.04,
      bandWidth: 4.0,
      action: 'increase'
    });

    assert.ok(adjRes.success, 'adjustLayerHeights increase must succeed');

    let afterH = initialH;
    for (let i = 0; i + 1 < adjRes.profile.length; i += 2) {
      if (adjRes.profile[i] >= targetZ) {
        afterH = adjRes.profile[i + 1];
        break;
      }
    }

    assert.ok(
      afterH >= initialH,
      `Layer height near Z=${targetZ} should increase (${afterH} >= ${initialH})`
    );

    // Apply adjust with decrease
    const decRes = await core.call('adjustLayerHeights', {
      objectId: benchyObjId,
      z: targetZ,
      delta: 0.06,
      bandWidth: 4.0,
      action: 'decrease'
    });
    assert.ok(decRes.success, 'adjustLayerHeights decrease must succeed');
  });

  test('resetLayerHeights restores nominal profile', async () => {
    const res = await core.call('resetLayerHeights', { objectId: benchyObjId });
    assert.ok(res.success && res.cleared);

    const prof = await core.call('getLayerHeightProfile', { objectId: benchyObjId });
    assert.equal(prof.hasCustomProfile, false, 'hasCustomProfile should be false after reset');

    for (let i = 1; i < prof.profile.length; i += 2) {
      assert.ok(
        Math.abs(prof.profile[i] - prof.nominalHeight) < 1e-3,
        `Profile layers should equal nominal height ${prof.nominalHeight} after reset`
      );
    }
  });

  test('saveProject and openProject preserves custom layer height profile', async () => {
    // 1. Generate adaptive profile
    await core.call('adaptiveLayerHeights', {
      objectId: benchyObjId,
      quality: 0.7
    });

    const savedProf = await core.call('getLayerHeightProfile', { objectId: benchyObjId });
    assert.equal(savedProf.hasCustomProfile, true);

    // 2. Save project to 3MF
    const saveRes = await core.call('saveProject', { path: '/out/benchy_varlayer.3mf' });
    assert.ok(saveRes, 'saveProject must succeed');

    // 3. Clear/re-open project from saved 3MF
    const openRes = await core.call('openProject', { path: '/out/benchy_varlayer.3mf' });
    assert.ok(openRes && openRes.objects.length >= 1, 'openProject must load objects');

    const loadedObjId = openRes.objects[0].id;
    const loadedProf = await core.call('getLayerHeightProfile', { objectId: loadedObjId });

    assert.equal(loadedProf.hasCustomProfile, true, 'Loaded object must retain custom profile');
    assert.equal(
      loadedProf.layerCount,
      savedProf.layerCount,
      `Loaded layer count (${loadedProf.layerCount}) must match saved (${savedProf.layerCount})`
    );
    benchyObjId = loadedObjId;
  });

  test('cube adaptive and brush profiles agree with slicing', async () => {
    core.writeFile('/models/cube.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('loadModel', { path: '/models/cube.obj' });
    const oldTree = await core.call('getObjectTree', {});
    await core.call('deleteObject', { objectId: oldTree.objects[0].id });
    await core.call('addModel', { path: '/models/cube.obj' });
    await core.call('arrange', {});
    const tree = await core.call('getObjectTree', {});
    const objectId = tree.objects[0].id;
    const initial = await core.call('getLayerHeightProfile', { objectId });
    await core.call('adaptiveLayerHeights', { objectId, quality: 0.5 });
    const edited = await core.call('adjustLayerHeights', {
      objectId, z: 12, delta: 0.005, bandWidth: 2, action: 'increase'
    });
    const sliced = await core.call('slice', { outPath: '/out/cube_variable.gcode', threads: 4 });
    assert.equal(sliced.layers, edited.layerCount, 'Slice must use the edited cube profile');
    assert.equal(initial.objectHeight, 20, 'Profile height must cover the entire cube');
  });

  test('setLayerHeightProfile directly applies explicit profile', async () => {
    await core.call('loadModel', { path: '/models/3DBenchy.stl' });
    benchyObjId = (await core.call('getObjectTree', {})).objects[0].id;
    const testProfile = [
      0.0, 0.20,
      0.2, 0.20,
      10.0, 0.12,
      20.0, 0.24,
      30.0, 0.16,
      48.0, 0.20
    ];

    const setRes = await core.call('setLayerHeightProfile', {
      objectId: benchyObjId,
      profile: testProfile
    });

    assert.ok(setRes.success, 'setLayerHeightProfile must succeed');
    assert.ok(setRes.layerCount > 0, 'layerCount should be > 0');

    const prof = await core.call('getLayerHeightProfile', { objectId: benchyObjId });
    assert.equal(prof.hasCustomProfile, true);

    const layersData = await core.call('getObjectLayers', { objectId: benchyObjId });
    assert.ok(layersData.layerCount > 0, 'getObjectLayers must return valid layerCount');
    assert.ok(Array.isArray(layersData.layers), 'getObjectLayers must return layers array');
  });
});
