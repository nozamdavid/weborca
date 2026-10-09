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
      'orca-step-runtime',
      'wasm',
      'engine',
      'orca_engine.mjs'
    );

const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');
const scratchDir = path.join(bundleDir, 'scratch');

describe('Orca WASM STEP Import & Slicing Suite', () => {
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

    if (!fs.existsSync(modulePath)) {
      throw new Error(`Target engine module does not exist: ${modulePath}`);
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
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('STEP fixture with UTF-8 part names loads with valid objects and finite positive bounds', async () => {
    const fixturePath = path.join(repoRoot, 'tests', 'data', 'utf8_part_names.step');
    assert.ok(fs.existsSync(fixturePath), `Fixture must exist: ${fixturePath}`);
    const fixtureBytes = fs.readFileSync(fixturePath);

    const loadRes = await core.loadModel('utf8_part_names.step', fixtureBytes);
    assert.ok(loadRes && Array.isArray(loadRes.objects), 'loadModel must return objects array');
    assert.ok(loadRes.objects.length > 0, 'Loaded model must contain at least one object');

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
    assert.ok(volumeNames.includes('pi\u00e8ce'), 'Volume names must preserve UTF-8 part name pièce');
    assert.ok(volumeNames.includes('Geh\u00e4use'), 'Volume names must preserve UTF-8 part name Gehäuse');
    assert.ok(volumeNames.includes('bracket'), 'Volume names must preserve ASCII part name bracket');
  });

  test('STEP fixture with security classification loads and slices producing non-empty G-code', async () => {
    const fixturePath = path.join(repoRoot, 'tests', 'data', 'security_classification.step');
    assert.ok(fs.existsSync(fixturePath), `Fixture must exist: ${fixturePath}`);
    const fixtureBytes = fs.readFileSync(fixturePath);

    const loadRes = await core.loadModel('security_classification.step', fixtureBytes);
    assert.ok(loadRes && Array.isArray(loadRes.objects), 'loadModel must return objects array');
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

  test('Malformed STEP input is rejected cleanly without corrupting engine state', async () => {
    // First load a known good object as baseline state
    const validPath = path.join(repoRoot, 'tests', 'data', 'security_classification.step');
    const validBytes = fs.readFileSync(validPath);
    const initialRes = await core.loadModel('baseline.step', validBytes);
    assert.ok(initialRes.objects.length > 0, 'Baseline object must load');

    const beforeObjects = await core.call('listObjects', {});
    assert.ok(Array.isArray(beforeObjects) && beforeObjects.length > 0, 'Baseline objects must exist');

    // Attempt to load malformed STEP payload
    const malformedBytes = Buffer.from('ISO-10303-21;\nHEADER;\nCORRUPT_PAYLOAD_GARBAGE;\nENDSEC;\nDATA;\nEND-ISO-10303-21;');
    await assert.rejects(
      core.loadModel('malformed.step', malformedBytes),
      (err) => {
        assert.ok(err instanceof Error, 'Rejection should produce an Error');
        return true;
      },
      'Malformed STEP load must reject'
    );

    // Verify engine remains responsive and unaffected
    const config = await core.call('getConfig', {});
    assert.ok(config && typeof config === 'object', 'getConfig must succeed after rejected load');

    // Verify original objects remain intact after failed loadModel
    const afterLoadFailObjects = await core.call('listObjects', {});
    assert.deepEqual(afterLoadFailObjects, beforeObjects, 'Original objects must remain intact after failed loadModel');

    // Also verify addModel with malformed file rejects and leaves objects intact
    await assert.rejects(
      core.call('addModel', { path: '/models/malformed.step' }),
      (err) => {
        assert.ok(err instanceof Error, 'Rejection should produce an Error');
        return true;
      },
      'Malformed STEP addModel must reject'
    );

    const afterAddFailObjects = await core.call('listObjects', {});
    assert.deepEqual(afterAddFailObjects, beforeObjects, 'Original objects must remain intact after failed addModel');
  });

  test('STEP deflection options reject non-positive and non-finite values while keeping project intact', async () => {
    const validPath = path.join(repoRoot, 'tests', 'data', 'security_classification.step');
    const validBytes = fs.readFileSync(validPath);
    await core.loadModel('baseline_deflection.step', validBytes);

    const baselineObjects = await core.call('listObjects', {});
    assert.ok(Array.isArray(baselineObjects) && baselineObjects.length > 0, 'Baseline objects must exist');

    const invalidOptions = [
      { linear_deflection: 0 },
      { linear_deflection: -0.01 },
      { linearDeflection: -1 },
      { linear_deflection: 'invalid' },
      { angle_deflection: 0 },
      { angle_deflection: -0.5 },
      { angleDeflection: -2 },
      { angle_deflection: 'invalid' }
    ];

    for (const opt of invalidOptions) {
      await assert.rejects(
        core.call('loadModel', { path: '/models/baseline_deflection.step', ...opt }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /(linear_deflection|angle_deflection) must be a positive finite number/);
          return true;
        },
        `loadModel with option ${JSON.stringify(opt)} must reject`
      );

      const afterLoad = await core.call('listObjects', {});
      assert.deepEqual(afterLoad, baselineObjects, `Project objects must remain intact after failed loadModel with ${JSON.stringify(opt)}`);

      await assert.rejects(
        core.call('addModel', { path: '/models/baseline_deflection.step', ...opt }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /(linear_deflection|angle_deflection) must be a positive finite number/);
          return true;
        },
        `addModel with option ${JSON.stringify(opt)} must reject`
      );

      const afterAdd = await core.call('listObjects', {});
      assert.deepEqual(afterAdd, baselineObjects, `Project objects must remain intact after failed addModel with ${JSON.stringify(opt)}`);
    }

    // Verify valid custom deflection values succeed
    const validCustomRes = await core.call('loadModel', {
      path: '/models/baseline_deflection.step',
      linear_deflection: 0.005,
      angle_deflection: 0.4
    });
    assert.ok(validCustomRes && Array.isArray(validCustomRes.objects) && validCustomRes.objects.length > 0);
  });
});
