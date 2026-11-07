// STEP import against the OCCT-free main engine.
//
// STEP files are tessellated by the standalone module (wasm/step, built by
// wasm/scripts/build_step_module.sh) and handed to the engine as a packed mesh
// through the loadStepMesh op, which is what the app does in its STEP worker.
// The engine under test has no STEP reader (SLIC3R_WITH_OCCT=OFF).

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
  : path.join(repoRoot, 'wasm', 'build', 'orca-wasm64', 'wasm', 'engine', 'orca_engine.mjs');

const stepModulePath = process.env.ORCA_STEP_MODULE
  ? path.resolve(process.env.ORCA_STEP_MODULE)
  : path.join(repoRoot, 'wasm', 'build', 'step-module', 'step_tessellate.mjs');

const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');
const scratchDir = path.join(bundleDir, 'scratch');

const LINEAR_DEFLECTION = 0.003;
const ANGLE_DEFLECTION = 0.5;

describe('Orca WASM STEP Import & Slicing Suite', () => {
  let core;
  let stepModule;

  // Same call sequence as wasm/web/step-worker.js. Returns the packed mesh or throws the module's error.
  function tessellate(bytes, linear = LINEAR_DEFLECTION, angle = ANGLE_DEFLECTION) {
    stepModule.FS.writeFile('/in.step', new Uint8Array(bytes));
    const error = stepModule.step_tessellate_to_file('/in.step', linear, angle, false, '/out.bin');
    if (error) throw new Error(error);
    return stepModule.FS.readFile('/out.bin');
  }

  function fixtureBytes(name) {
    const fixturePath = path.join(repoRoot, 'tests', 'data', name);
    assert.ok(fs.existsSync(fixturePath), `Fixture must exist: ${fixturePath}`);
    return fs.readFileSync(fixturePath);
  }

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

    for (const required of [modulePath, stepModulePath]) {
      if (!fs.existsSync(required)) {
        throw new Error(`Required module does not exist: ${required}`);
      }
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

    stepModule = await (await import(stepModulePath)).default();
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('STEP fixture with UTF-8 part names loads with valid objects and finite positive bounds', async () => {
    const packed = tessellate(fixtureBytes('utf8_part_names.step'));

    const loadRes = await core.loadStepMesh('utf8_part_names.step', packed, { replace: true });
    assert.ok(loadRes && Array.isArray(loadRes.objects), 'loadStepMesh must return objects array');
    assert.equal(loadRes.objects.length, 1, 'A STEP file becomes one object');
    assert.equal(loadRes.objects[0].name, 'utf8_part_names.step', 'Object is named after the STEP file');

    for (const obj of loadRes.objects) {
      assert.ok(obj.volumes > 0, `Object ${obj.id} must have non-empty volumes`);
      assert.ok(Array.isArray(obj.size) && obj.size.length === 3, 'Object size must be a 3D vector');
      for (const dim of obj.size) {
        assert.ok(Number.isFinite(dim), `Dimension ${dim} must be finite`);
        assert.ok(dim > 0, `Dimension ${dim} must be strictly positive`);
      }
    }

    const tree = await core.call('getObjectTree', {});
    assert.ok(tree && Array.isArray(tree.objects) && tree.objects.length >= 1, 'Object tree must return objects');
    const volumes = tree.objects[0].volumes;
    assert.equal(volumes.length, 3, 'Object must contain 3 volumes');
    const volumeNames = volumes.map(v => v.name);
    assert.ok(volumeNames.includes('pièce'), 'Volume names must preserve UTF-8 part name pièce');
    assert.ok(volumeNames.includes('Gehäuse'), 'Volume names must preserve UTF-8 part name Gehäuse');
    assert.ok(volumeNames.includes('bracket'), 'Volume names must preserve ASCII part name bracket');
  });

  test('STEP fixture with security classification loads and slices producing non-empty G-code', async () => {
    const packed = tessellate(fixtureBytes('security_classification.step'));

    const loadRes = await core.loadStepMesh('security_classification.step', packed, { replace: true });
    assert.ok(loadRes && Array.isArray(loadRes.objects), 'loadStepMesh must return objects array');
    assert.ok(loadRes.objects.length > 0, 'Loaded model must contain at least one object');

    const obj = loadRes.objects[0];
    assert.ok(obj.volumes > 0, 'Object must have at least one volume');
    assert.ok(Array.isArray(obj.size) && obj.size.length === 3, 'Object size must be 3D vector');
    for (const dim of obj.size) {
      assert.ok(Number.isFinite(dim) && dim > 0, `Dimension ${dim} must be finite positive`);
    }

    // Configure slicing presets
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    await core.call('arrange', {});

    const sliceRes = await core.slice({
      outPath: '/out/security_classification.gcode',
      threads: 4
    });

    assert.ok(sliceRes, 'slice must return result');
    assert.ok(typeof sliceRes.layers === 'number' && sliceRes.layers > 0, `layer count (${sliceRes.layers}) must be > 0`);
    assert.ok(sliceRes.gcode && sliceRes.gcode.length > 0, 'output G-code must be non-empty');
  });

  test('loadStepMesh appends by default and replaces with replace: true', async () => {
    const packed = tessellate(fixtureBytes('security_classification.step'));
    await core.loadStepMesh('first.step', packed, { replace: true });
    const single = await core.call('listObjects', {});
    assert.equal(single.length, 1, 'replace: true leaves only the imported object');

    const added = await core.loadStepMesh('second.step', packed);
    assert.equal(added.objects.length, 1);
    assert.equal(added.objects[0].name, 'second.step');
    const two = await core.call('listObjects', {});
    assert.equal(two.length, 2, 'append keeps the existing object');
    assert.ok(two.every(o => o.instances.length > 0), 'Every object has an instance');

    await core.loadStepMesh('third.step', packed, { replace: true });
    const replaced = await core.call('listObjects', {});
    assert.equal(replaced.length, 1, 'replace: true discards the previous objects');

    assert.throws(() => core.readFile('/models/third.step.stm'), 'The packed hand-off file is removed after import');
  });

  test('Malformed STEP input is rejected cleanly without corrupting engine state', async () => {
    const validBytes = fixtureBytes('security_classification.step');
    await core.loadStepMesh('baseline.step', tessellate(validBytes), { replace: true });

    const beforeObjects = await core.call('listObjects', {});
    assert.ok(Array.isArray(beforeObjects) && beforeObjects.length > 0, 'Baseline objects must exist');

    // The STEP module rejects a malformed STEP payload; nothing reaches the engine.
    const malformedBytes = Buffer.from('ISO-10303-21;\nHEADER;\nCORRUPT_PAYLOAD_GARBAGE;\nENDSEC;\nDATA;\nEND-ISO-10303-21;');
    assert.throws(() => tessellate(malformedBytes), (err) => {
      assert.ok(err instanceof Error, 'Rejection should produce an Error');
      return true;
    }, 'Malformed STEP must be rejected by the module');
    // The module stays usable after a rejected file.
    assert.ok(tessellate(validBytes).length > 8, 'Module still tessellates after a malformed file');

    // The engine rejects damaged packed meshes in both replace modes and keeps its model.
    const good = Buffer.from(tessellate(validBytes));
    const badMagic = Buffer.from(good);
    badMagic.write('XXXX', 0, 'latin1');
    const badIndex = Buffer.from(good);
    {
      // The last u32 of the file is the final triangle index; point it past the vertex count.
      badIndex.writeUInt32LE(0xfffffff0, badIndex.length - 4);
    }
    const damaged = {
      'bad magic': badMagic,
      'truncated': good.subarray(0, good.length - 7),
      'trailing bytes': Buffer.concat([good, Buffer.from([1, 2, 3])]),
      'index out of range': badIndex,
      'empty': Buffer.alloc(0),
      'no solids': Buffer.from([0x53, 0x54, 0x4d, 0x31, 0, 0, 0, 0])
    };
    for (const [label, bytes] of Object.entries(damaged)) {
      for (const replace of [true, false]) {
        await assert.rejects(
          core.loadStepMesh('damaged.step', bytes, { replace }),
          (err) => {
            assert.ok(err instanceof Error, 'Rejection should produce an Error');
            assert.match(err.message, /STEP mesh|no valid shape/i);
            return true;
          },
          `${label} packed mesh (replace=${replace}) must reject`
        );
        const after = await core.call('listObjects', {});
        assert.deepEqual(after, beforeObjects, `Objects must remain intact after rejected ${label} import (replace=${replace})`);
      }
    }

    // Verify engine remains responsive and unaffected
    const config = await core.call('getConfig', {});
    assert.ok(config && typeof config === 'object', 'getConfig must succeed after rejected load');

    // The OCCT-free engine refuses STEP files given directly, with a readable error.
    for (const op of ['loadModel', 'addModel']) {
      core.writeFile('/models/direct.step', validBytes);
      await assert.rejects(
        core.call(op, { path: '/models/direct.step' }),
        (err) => {
          assert.match(err.message, /STEP format is not supported in this build/);
          return true;
        },
        `${op} of a STEP file must explain that the engine has no STEP reader`
      );
      assert.deepEqual(await core.call('listObjects', {}), beforeObjects, `Objects must remain intact after rejected ${op}`);
    }
  });

  test('STEP deflection options reject non-positive and non-finite values while keeping project intact', async () => {
    const validBytes = fixtureBytes('security_classification.step');
    await core.loadStepMesh('baseline_deflection.step', tessellate(validBytes), { replace: true });

    const baselineObjects = await core.call('listObjects', {});
    assert.ok(Array.isArray(baselineObjects) && baselineObjects.length > 0, 'Baseline objects must exist');

    // Deflection bounds are enforced by the STEP module now; the engine never sees a rejected import.
    const invalidDeflections = [
      [0, ANGLE_DEFLECTION],
      [-0.01, ANGLE_DEFLECTION],
      [Number.NaN, ANGLE_DEFLECTION],
      [Number.POSITIVE_INFINITY, ANGLE_DEFLECTION],
      [LINEAR_DEFLECTION, 0],
      [LINEAR_DEFLECTION, -0.5],
      [LINEAR_DEFLECTION, Number.NaN],
      [LINEAR_DEFLECTION, Number.NEGATIVE_INFINITY]
    ];

    for (const [linear, angle] of invalidDeflections) {
      assert.throws(
        () => tessellate(validBytes, linear, angle),
        (err) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /(linear_deflection|angle_deflection) must be a positive finite number/);
          return true;
        },
        `tessellate with deflections ${linear}/${angle} must reject`
      );
      assert.deepEqual(await core.call('listObjects', {}), baselineObjects,
        `Project objects must remain intact after rejected deflections ${linear}/${angle}`);
    }

    // Verify valid custom deflection values succeed
    const validCustomRes = await core.loadStepMesh('custom_deflection.step', tessellate(validBytes, 0.005, 0.4), { replace: true });
    assert.ok(validCustomRes && Array.isArray(validCustomRes.objects) && validCustomRes.objects.length > 0);
  });
});
