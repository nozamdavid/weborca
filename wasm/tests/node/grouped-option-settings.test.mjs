import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createEngineCore } from '../../web/engine-core.js';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const modulePath = path.resolve(process.env.ORCA_ENGINE_MODULE ||
  path.join(repoRoot, 'wasm/build/orca-step-runtime/wasm/engine/orca_engine.mjs'));
const key = 'extruder_printable_area';
const first = '0x0,100x0,100x100,0x100';
const second = '100x0,200x0,200x100,100x100';
const edited = '110.5x0,200x0,200x100,110.5x100';
let core;

before(async () => {
  const mod = await import(modulePath);
  core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 2 });
  for (const bundle of ['resources.json', 'profiles/OrcaFilamentLibrary.json', 'profiles/Voron.json']) {
    await core.addVendorBundle(JSON.parse(fs.readFileSync(path.join(repoRoot, 'wasm/build/tests-node', bundle), 'utf8')));
  }
  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
  await core.call('loadVendors', {});
  await core.call('selectPresets', {
    printer: 'Voron 2.4 300 0.4 nozzle',
    process: '0.20mm Standard @Voron',
    filaments: ['Generic PLA @System']
  });
});

after(() => core?.dispose());

test('grouped coordinates roundtrip through native writes and group edits', async () => {
  assert.equal((await core.call('getConfigDef', { keys: [key] }))[key].type, 'pointsGroups');
  const result = await core.call('setOption', { key, value: `${first}#${second}` });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal((await core.call('getConfig', {}))[key], `${first}#${second}`);
  assert.equal((await core.call('getOption', { key, layoutIndex: 1 })).value, second);

  assert.equal((await core.call('setOption', { key, value: edited, layoutIndex: 1 })).success, true);
  assert.equal((await core.call('getConfig', {}))[key], `${first}#${edited}`);
  assert.equal((await core.call('getOption', { key, layoutIndex: 0 })).value, first);

  const baseline = await core.call('getConfig', {});
  const invalidCell = await core.call('setOption', { key, value: `${second}#${first}`, layoutIndex: 1 });
  assert.equal(invalidCell.success, false);
  assert.match(invalidCell.error, /Expected one option value/);
  assert.deepEqual(await core.call('getConfig', {}), baseline);

  // Printer groups use layoutIndex, not a filament slot projection.
  await assert.rejects(core.call('setOption', { key, value: first, filamentIndex: 0 }), /Not a filament key/);
  await assert.rejects(core.call('setOption', { key, value: first, layoutIndex: 2 }), /Invalid layout index/);
  assert.deepEqual(await core.call('getConfig', {}), baseline);

  const batch = await core.call('setOptions', { options: { [key]: `${second}#${first}` } });
  assert.deepEqual(batch.errors, []);
  assert.equal((await core.call('getConfig', {}))[key], `${second}#${first}`);
  const batchBaseline = await core.call('getConfig', {});
  const invalidBatch = await core.call('setOptions', { options: { [key]: {}, layer_height: '0.28' } });
  assert.ok(invalidBatch.errors.some(error => error.key === key && error.code === 'unsupported_type' && error.fatal));
  assert.deepEqual(await core.call('getConfig', {}), batchBaseline);
});
