import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

describe('Engine getPresetConfig', () => {
  let core;

  before(async () => {
    const resJsonPath = path.join(bundleDir, 'resources.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
    const bblJsonPath = path.join(bundleDir, 'profiles', 'BBL.json');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');

    const mod = await import(modulePath);
    const moduleFactory = mod.createOrcaEngine || mod.default;

    core = await createEngineCore({
      moduleFactory,
      threads: 4
    });

    if (fs.existsSync(resJsonPath)) await core.addVendorBundle(JSON.parse(fs.readFileSync(resJsonPath, 'utf8')));
    if (fs.existsSync(orcaFilJsonPath)) await core.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilJsonPath, 'utf8')));
    if (fs.existsSync(voronJsonPath)) await core.addVendorBundle(JSON.parse(fs.readFileSync(voronJsonPath, 'utf8')));
    if (fs.existsSync(bblJsonPath)) await core.addVendorBundle(JSON.parse(fs.readFileSync(bblJsonPath, 'utf8')));

    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('returns one preset without selecting it', async () => {
    const before = await core.call('getConfig', {});
    const a = await core.call('getPresetConfig', { kind: 'process', name: '0.20mm Standard @Voron' });
    const b = await core.call('getPresetConfig', { kind: 'process', name: '0.12mm Fine @Voron' });
    assert.equal(a.layer_height, '0.2');
    assert.equal(b.layer_height, '0.12');
    assert.notEqual(a.layer_height, b.layer_height);
    assert.deepEqual(await core.call('getConfig', {}), before);
  });

  test('unknown names and kinds are errors', async () => {
    await assert.rejects(core.call('getPresetConfig', { kind: 'process', name: 'No such preset' }), /Unknown process preset/);
    await assert.rejects(core.call('getPresetConfig', { kind: 'nope', name: 'x' }), /Unknown preset kind/);
  });
});
