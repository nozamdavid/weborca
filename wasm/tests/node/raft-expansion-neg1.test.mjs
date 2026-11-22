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

const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');

describe('raft_first_layer_expansion == -1 normalization', () => {
  let core;

  before(async () => {
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
    await core.call('loadVendors');
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj'));
    await core.loadModel('20mm_cube.obj', cubeBytes);
    await core.call('arrange');
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  for (const val of ['-1', '-1.0']) {
    test(`setOption("raft_first_layer_expansion", "${val}") normalizes to 0 and slices without validation error`, async () => {
      await core.call('resetOptions');
      const setRes = await core.call('setOption', {
        key: 'raft_first_layer_expansion',
        value: val
      });
      assert.equal(setRes.success, true, `setOption("${val}") should succeed: ${JSON.stringify(setRes)}`);

      const config = await core.call('getConfig');
      assert.equal(config.raft_first_layer_expansion, '0');

      const sliceRes = await core.call('slice', {
        outPath: `/out/raft_neg1_${val.replace('.', '_')}.gcode`,
        threads: 4
      });
      assert.equal(sliceRes.layers, 100);
    });
  }

  test('setOption("raft_first_layer_expansion", "-2") still fails validation', async () => {
    await core.call('resetOptions');
    const setRes = await core.call('setOption', {
      key: 'raft_first_layer_expansion',
      value: '-2'
    });
    if (setRes.success) {
      await assert.rejects(
        core.call('slice', { outPath: '/out/raft_neg2.gcode', threads: 4 }),
        /Config validation failed/
      );
    } else {
      assert.equal(setRes.success, false);
    }
  });
});
