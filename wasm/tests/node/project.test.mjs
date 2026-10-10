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

describe('Orca WASM Engine Project Operations Test Suite', () => {
  let core;

  before(async () => {
    fs.mkdirSync(scratchDir, { recursive: true });

    const resJsonPath = path.join(bundleDir, 'resources.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');
    const bblJsonPath = path.join(bundleDir, 'profiles', 'BBL.json');

    if (!fs.existsSync(resJsonPath) || !fs.existsSync(voronJsonPath) || !fs.existsSync(orcaFilJsonPath) || !fs.existsSync(bblJsonPath)) {
      const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
      execFileSync(process.execPath, [packScript, repoRoot, bundleDir, 'Voron', 'OrcaFilamentLibrary', 'BBL'], {
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
    await core.addVendorBundle(JSON.parse(fs.readFileSync(bblJsonPath, 'utf8')));

    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    // Write OrcaBadge.3mf and 20mm_cube.obj into MEMFS
    const badgeBytes = fs.readFileSync(path.join(repoRoot, 'resources', 'handy_models', 'OrcaBadge.3mf'));
    core.writeFile('/models/OrcaBadge.3mf', badgeBytes);

    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj'));
    core.writeFile('/models/cube.obj', cubeBytes);
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('openProject on OrcaBadge.3mf returns objects, extruders, and plates', async () => {
    const res = await core.call('openProject', { path: '/models/OrcaBadge.3mf' });
    assert.ok(res, 'openProject must return a result');
    assert.ok(Array.isArray(res.objects), 'result must have objects array');
    assert.equal(res.objects.length, 3, 'OrcaBadge.3mf must have 3 objects');

    // Extruder assignments:
    // Object 0 (Horizontal): extruder 1
    // Object 1 (Vertical): extruder 2
    // Object 2 (Logo): extruder 2
    const extruders = res.objects.map((o) => o.extruder);
    assert.deepEqual(extruders, [1, 2, 2], 'Extruder assignments must be [1, 2, 2]');

    // Plates
    assert.ok(Array.isArray(res.plates), 'result must have plates array');
    assert.ok(res.plates.length >= 1, 'must have at least 1 plate');
    const plate0 = res.plates[0];
    assert.equal(plate0.index, 0, 'Plate index must be 0');
    assert.ok(Array.isArray(plate0.filamentMaps), 'plate must have filamentMaps');
    assert.deepEqual(plate0.filamentMaps, [1, 2, 3, 4], 'Plate filamentMaps must be [1, 2, 3, 4]');
    assert.ok(plate0.instances.length >= 3, 'Plate must reference at least 3 instances');
  });

  test('slicing after openProject on OrcaBadge.3mf succeeds', async () => {
    const sliceRes = await core.call('slice', {
      outPath: '/out/badge.gcode',
      threads: 4
    });
    assert.ok(sliceRes, 'slice must return a result');
    assert.ok(sliceRes.layers > 0, 'slice must produce at least 1 layer');
    assert.ok(sliceRes.gcodeBytes > 0, 'slice must produce gcode bytes');
  });

  test('saveProject then openProject round-trips object count, transforms, per-object config and selected presets', async () => {
    // Select specific presets
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    // Open OrcaBadge
    const open1 = await core.call('openProject', { path: '/models/OrcaBadge.3mf' });

    // Save project
    const saveRes = await core.call('saveProject', { path: '/out/roundtrip.3mf' });
    assert.ok(saveRes, 'saveProject must succeed');

    // Re-open saved project
    const open2 = await core.call('openProject', { path: '/out/roundtrip.3mf' });
    assert.equal(open2.objects.length, open1.objects.length, 'Object counts must match');
    assert.deepEqual(open2.selectedPresets, open1.selectedPresets, 'Selected presets must match');

    for (let i = 0; i < open1.objects.length; i++) {
      const o1 = open1.objects[i];
      const o2 = open2.objects[i];
      assert.equal(o2.name, o1.name, `Object ${i} name must match`);
      assert.equal(o2.instances, o1.instances, `Object ${i} instance count must match`);

      // Compare transforms
      assert.equal(o2.instancesDetail.length, o1.instancesDetail.length);
      for (let j = 0; j < o1.instancesDetail.length; j++) {
        const inst1 = o1.instancesDetail[j];
        const inst2 = o2.instancesDetail[j];
        for (let k = 0; k < 3; k++) {
          assert.ok(
            Math.abs(inst1.offset[k] - inst2.offset[k]) < 1e-3,
            `Offset mismatch at obj ${i} inst ${j} axis ${k}`
          );
        }
      }
    }

    // Verify per-object config was preserved
    assert.ok(open2.objects[0].config, 'Per-object config must be present');
    assert.equal(open2.objects[0].config.extruder, '1');
  });

  test('loadModel with .3mf path loads geometry correctly', async () => {
    const res = await core.call('loadModel', { path: '/models/OrcaBadge.3mf' });
    assert.ok(res, 'loadModel must succeed on .3mf');
    assert.ok(Array.isArray(res.objects), 'result must have objects array');
    assert.equal(res.objects.length, 3, 'OrcaBadge.3mf geometry must load 3 objects');
  });

  test('loadModel with .obj still works unchanged', async () => {
    const res = await core.call('loadModel', { path: '/models/cube.obj' });
    assert.ok(res, 'loadModel must succeed on .obj');
    assert.equal(res.objects.length, 1, 'cube.obj must load 1 object');
    assert.equal(res.objects[0].name, 'cube.obj');
  });
  test('global project overrides, notes and embedded bed artwork survive 3MF import', async () => {
    await core.call('selectPresets', { printer: 'Voron 2.4 300 0.4 nozzle', process: '0.20mm Standard @Voron', filaments: ['Generic PLA @System'] });
    const options = {
      notes: 'Project notes survive refresh', wall_loops: '7',
      bed_custom_texture: 'data:image/svg+xml;base64,PHN2Zy8+',
      bed_custom_model: 'data:application/octet-stream;base64,dGVzdA=='
    };
    await core.call('setOptions', { options });
    await core.call('saveProject', { path: '/out/overrides.3mf' });
    await core.call('setOptions', { options: { notes: '', wall_loops: '3', bed_custom_texture: '', bed_custom_model: '' } });
    await core.call('openProject', { path: '/out/overrides.3mf' });
    const config = await core.call('getConfig', {});
    for (const [key, value] of Object.entries(options)) assert.equal(config[key], value, key + ' must survive project import');
  });

});
