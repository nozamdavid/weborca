import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';
import { unzipSync, strFromU8 } from '../../app/node_modules/fflate/esm/index.mjs';

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
const compareScript = path.join(repoRoot, 'wasm', 'spike', 'compare_gcode.sh');
const refCubeGcode = path.join(repoRoot, 'wasm', 'tests', 'parity', 'refs-macos-x86_64', 'cube-voron.gcode');

describe('Orca WASM Engine Node Test Suite', () => {
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
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('overlapping imports with the same filename retain geometry, names and config order', async () => {
    await core.call('loadVendors');
    await core.call('selectPresets', { printer: 'Voron 2.4 300 0.4 nozzle', process: '0.20mm Standard @Voron', filaments: ['Generic PLA @System'] });
    const source = fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj'), 'utf8');
    const larger = source.replace(/^v (.*)$/gm, (_, coords) => 'v ' + coords.split(' ').map(v => Number(v) * 2).join(' '));
    const blocker = core.call('getConfigDef');
    const first = core.loadModel('same.obj', source);
    const config = core.call('setOptions', { options: { layer_height: '0.3' } });
    const second = core.addModel('same.obj', larger);
    await blocker;
    assert.deepEqual((await first).objects[0].size, [20, 20, 20]);
    await config;
    await second;
    const objects = await core.call('listObjects');
    assert.deepEqual(objects.map(x => x.name), ['same.obj', 'same.obj']);
    assert.deepEqual(objects.map(x => x.size), [[20, 20, 20], [40, 40, 40]]);
    assert.equal((await core.call('getConfig')).layer_height, '0.3');
    await core.call('resetOptions');
  });

  test('owned import scratch is released on success and failure while caller files and saved geometry survive', async () => {
    await core.call('loadVendors');
    await core.call('selectPresets', { printer: 'Voron 2.4 300 0.4 nozzle', process: '0.20mm Standard @Voron', filaments: ['Generic PLA @System'] });
    const bytes = fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj'));
    const model = await core.loadModel('owned.obj', bytes);
    assert.equal(core.FS.analyzePath('/models/owned.obj').exists, false);
    assert.equal(model.objects[0].name, 'owned.obj');
    const mesh = await core.call('getMesh', { objectId: model.objects[0].id });
    assert.ok(core.readFile(mesh.path).length > 0);
    await core.call('saveProject', { path: '/out/owned.3mf' });
    const archive = unzipSync(core.readFile('/out/owned.3mf'));
    assert.match(strFromU8(archive['Metadata/model_settings.config']), /key="source_file" value="owned.obj"/);
    await core.loadModel('owned.obj', bytes); // Reimport supplies the selected source bytes again.
    await core.call('openProject', { path: '/out/owned.3mf' });
    const restored = await core.call('listObjects');
    assert.equal(restored[0].name, 'owned.obj');
    assert.deepEqual(restored[0].size, [20, 20, 20]);
    await assert.rejects(core.loadModel('broken.obj', 'invalid model'));
    assert.equal(core.FS.analyzePath('/models/broken.obj').exists, false);
    const callerBytes = new Uint8Array(Buffer.concat([bytes, Buffer.from('# caller-owned source\n')]));
    core.writeFile('/models/caller.obj', callerBytes);
    await core.loadModel('caller.obj', bytes);
    assert.deepEqual(core.readFile('/models/caller.obj'), callerBytes);
    await assert.rejects(core.loadModel('caller.obj', 'invalid model'));
    assert.deepEqual(core.readFile('/models/caller.obj'), callerBytes);
    await core.call('loadModel', { path: '/models/caller.obj' });
    assert.equal(core.FS.analyzePath('/models/caller.obj').exists, true);
  });

  test('aborting a queued slice preserves active native output and never creates the canceled output', async () => {
    await core.call('loadVendors');
    await core.call('selectPresets', { printer: 'Voron 2.4 300 0.4 nozzle', process: '0.20mm Standard @Voron', filaments: ['Generic PLA @System'] });
    await core.loadModel('queued-cube.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('arrange');
    const controller = new AbortController();
    const active = core.slice({ outPath: '/out/active-cube.gcode', threads: 1 });
    const queued = core.slice({ outPath: '/out/never-started.gcode', threads: 1, signal: controller.signal });
    const outcomes = Promise.allSettled([active, queued]);
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    const [a, b] = await outcomes;
    assert.equal(a.status, 'fulfilled');
    assert.equal(a.value.layers, 100);
    assert.ok(a.value.gcode.length > 0);
    assert.equal(b.status, 'rejected');
    assert.equal(b.reason.name, 'AbortError');
    assert.equal(core.FS.analyzePath('/out/never-started.gcode').exists, false);
  });

  test('overlapping slices preserve shared output G-code across intervening config changes', async () => {
    await core.call('loadVendors');
    await core.call('selectPresets', { printer: 'Voron 2.4 300 0.4 nozzle', process: '0.20mm Standard @Voron', filaments: ['Generic PLA @System'] });
    await core.loadModel('shared-output.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('arrange');
    const referenceA = await core.slice({ threads: 1 });
    const pendingA = core.slice({ threads: 1 });
    const config = core.call('setOptions', { options: { layer_height: '0.3' } });
    const pendingB = core.slice({ threads: 1 });
    const a = await pendingA;
    await config;
    const b = await pendingB;
    assert.equal(a.layers, 100);
    assert.equal(b.layers, 67);
    const referenceB = await core.slice({ threads: 1 });
    for (const [actualResult, expectedResult] of [[a, referenceA], [b, referenceB]]) {
      const expected = path.join(scratchDir, 'shared-output-expected.gcode');
      const actual = path.join(scratchDir, 'shared-output-actual.gcode');
      fs.writeFileSync(expected, expectedResult.gcode);
      fs.writeFileSync(actual, actualResult.gcode);
      execFileSync('bash', [compareScript, expected, actual], { stdio: 'inherit' });
    }
    await core.call('resetOptions');
  });

  test('loadVendors lists OrcaFilamentLibrary and Voron', async () => {
    const res = await core.call('loadVendors', {});
    assert.ok(res && Array.isArray(res.vendors), 'loadVendors should return vendors array');
    const names = res.vendors.map((v) => v.name);
    assert.ok(names.includes('OrcaFilamentLibrary'), 'vendors must include OrcaFilamentLibrary');
    assert.ok(names.includes('Voron'), 'vendors must include Voron');
  });

  test('listPresets: printers non-empty and compatible processes filtered', async () => {
    const printers = await core.call('listPresets', { kind: 'printer', compatibleOnly: false });
    assert.ok(Array.isArray(printers) && printers.length > 0, 'printers should be non-empty');
    assert.ok(
      printers.some((p) => p.name === 'Voron 2.4 300 0.4 nozzle'),
      'printers must include "Voron 2.4 300 0.4 nozzle"'
    );

    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    const processes = await core.call('listPresets', { kind: 'process', compatibleOnly: true });
    assert.ok(Array.isArray(processes) && processes.length > 0, 'compatible processes should not be empty');
    assert.ok(
      processes.some((p) => p.name === '0.20mm Standard @Voron'),
      'compatible processes must include "0.20mm Standard @Voron"'
    );
    assert.ok(
      processes.every((p) => p.isCompatible === true),
      'every returned process must have isCompatible === true'
    );
  });

  test('selectPresets with an unknown printer name rejects with an error naming it', async () => {
    const unknownPrinter = 'UnknownPrinterName_XYZ';
    await assert.rejects(
      core.call('selectPresets', {
        printer: unknownPrinter,
        process: '0.20mm Standard @Voron',
        filaments: ['Generic PLA @System']
      }),
      (err) => {
        assert.ok(
          err.message && err.message.includes(unknownPrinter),
          `error message "${err.message}" must name "${unknownPrinter}"`
        );
        return true;
      }
    );
  });

  test('getConfig after selecting Voron 2.4 300 0.4 nozzle / 0.20mm Standard @Voron / Generic PLA @System has layer_height "0.2"', async () => {
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });
    const config = await core.call('getConfig', {});
    assert.strictEqual(config.layer_height, '0.2');
  });

  test('setOptions: invalid/unknown keys error, valid override changes config and slice layer count, resetOptions restores', async () => {
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    // An unknown key and an invalid value each come back in errors
    const errRes = await core.call('setOptions', {
      options: {
        unknown_dummy_key_123: 'value',
        layer_height: 'invalid_non_numeric'
      }
    });
    assert.ok(errRes && Array.isArray(errRes.errors), 'setOptions must return errors array');
    const errKeys = errRes.errors.map((e) => e.key);
    assert.ok(errKeys.includes('unknown_dummy_key_123'), 'unknown key must be in errors');
    assert.ok(errKeys.includes('layer_height'), 'invalid value must be in errors');

    // A valid layer_height: "0.3" shows in getConfig
    const validRes = await core.call('setOptions', {
      options: { layer_height: '0.3' }
    });
    assert.deepStrictEqual(validRes.errors, []);

    const configWithOverride = await core.call('getConfig', {});
    assert.strictEqual(configWithOverride.layer_height, '0.3');

    // Slicing the cube then gives 67 layers (check actual count and assert < 100)
    const cubePath = path.join(repoRoot, 'tests', 'data', '20mm_cube.obj');
    const cubeBytes = fs.readFileSync(cubePath);
    await core.loadModel('20mm_cube.obj', cubeBytes);
    await core.call('arrange', {});

    const sliceRes03 = await core.call('slice', { outPath: '/out/plate_cube_03.gcode', threads: 4 });
    assert.strictEqual(sliceRes03.layers, 67, 'layer count with layer_height 0.3 should be 67');
    assert.ok(sliceRes03.layers < 100, 'layer count must be less than 100');

    // resetOptions restores "0.2"
    await core.call('resetOptions', {});
    const configRestored = await core.call('getConfig', {});
    assert.strictEqual(configRestored.layer_height, '0.2');
  });

  test('Slice the cube: compare with cube-voron.gcode via compare_gcode.sh', async () => {
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    const cubePath = path.join(repoRoot, 'tests', 'data', '20mm_cube.obj');
    const cubeBytes = fs.readFileSync(cubePath);
    await core.loadModel('20mm_cube.obj', cubeBytes);
    await core.call('arrange', {});

    const sliceResult = await core.call('slice', { outPath: '/out/plate_cube_default.gcode', threads: 4 });
    assert.strictEqual(sliceResult.layers, 100, 'default cube slice must have 100 layers');
    assert.ok(sliceResult.printTimeS > 0, 'printTimeS must be > 0');

    const outGcodeBytes = core.readFile('/out/plate_cube_default.gcode');
    const tmpGcodePath = path.join(scratchDir, 'p6_cube_test.gcode');
    fs.writeFileSync(tmpGcodePath, outGcodeBytes);

    execFileSync('bash', [compareScript, refCubeGcode, tmpGcodePath], { stdio: 'inherit' });
  });

  test('Cancel through an AbortSignal 300 ms into a Benchy slice, then slice cube again', async () => {
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    const benchyPath = path.join(repoRoot, 'wasm', 'build', 'models', '3DBenchy.stl');
    const benchyBytes = fs.readFileSync(benchyPath);
    await core.loadModel('3DBenchy.stl', benchyBytes);
    await core.call('arrange', {});

    const ac = new AbortController();
    const t0 = performance.now();
    const timer = setTimeout(() => {
      ac.abort();
    }, 300);

    let resolvedOrRejected = false;
    let wasCanceled = false;
    try {
      const res = await core.call(
        'slice',
        { outPath: '/out/plate_benchy_canceled.gcode', threads: 4 },
        { signal: ac.signal }
      );
      resolvedOrRejected = true;
      if (res && res.canceled) {
        wasCanceled = true;
      }
    } catch (err) {
      resolvedOrRejected = true;
      if (err.canceled || err.name === 'AbortError' || err.message?.includes('canceled')) {
        wasCanceled = true;
      }
    } finally {
      clearTimeout(timer);
    }

    const elapsedMs = performance.now() - t0;
    assert.ok(resolvedOrRejected, 'Benchy slice promise must resolve or reject');
    assert.ok(wasCanceled, 'Benchy slice must report canceled');
    assert.ok(elapsedMs < 1000, `Cancel must complete within 1 s (took ${elapsedMs} ms)`);

    // Slicing the cube again still compares exit 0
    const cubePath = path.join(repoRoot, 'tests', 'data', '20mm_cube.obj');
    const cubeBytes = fs.readFileSync(cubePath);
    await core.loadModel('20mm_cube.obj', cubeBytes);
    await core.call('arrange', {});

    const cubeRes = await core.call('slice', { outPath: '/out/plate_cube_after_cancel.gcode', threads: 4 });
    assert.strictEqual(cubeRes.layers, 100);

    const outGcodeBytes = core.readFile('/out/plate_cube_after_cancel.gcode');
    const tmpGcodePath = path.join(scratchDir, 'cube_after_cancel.gcode');
    fs.writeFileSync(tmpGcodePath, outGcodeBytes);

    execFileSync('bash', [compareScript, refCubeGcode, tmpGcodePath], { stdio: 'inherit' });
  });

  test('An unknown op rejects with an error', async () => {
    await assert.rejects(
      core.call('unknown_nonexistent_op', {}),
      (err) => {
        assert.ok(
          err.message && err.message.includes('Unknown operation'),
          `error message "${err.message}" should include "Unknown operation"`
        );
        return true;
      }
    );
  });
});
