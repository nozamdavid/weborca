import test, { describe, before, after, beforeEach } from 'node:test';
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

describe('Engine setOptions batch atomic rollback & error categorization', () => {
  let core;

  before(async () => {
    const resJsonPath = path.join(bundleDir, 'resources.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
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

    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});
  });

  after(() => {
    if (core) core.dispose();
  });

  beforeEach(async () => {
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });
    await core.call('resetOptions', {});
  });

  test('persisted aliases normalize before filtering, with canonical precedence and atomic rollback', async () => {
    const aliases = { tpms_adaptive: 'distance_warp', tpms_interior_density: '25%', tpms_adaptive_gradient: 'quadratic',
      is_ixex: '1', ixex_carriage_width_x: '25', ixex_carriage_width_y: '30' };
    const normalized = await core.call('normalizeOptions', { options: aliases });
    assert.deepEqual(normalized.errors, []);
    assert.equal(normalized.options.adaptive_infill_mode, 'distance_warp');
    assert.equal(normalized.options.adaptive_infill_interior_density, '25%');
    assert.equal(normalized.options.adaptive_infill_gradient, 'quadratic');
    assert.equal(normalized.options.is_imex, '1');
    assert.equal(normalized.options.imex_nozzle_clearance_x, '25');
    assert.equal(normalized.options.imex_nozzle_clearance_y, '30');
    assert.ok(!Object.keys(normalized.options).some(key => /^(tpms|ixex|is_ixex)/.test(key)));
    assert.deepEqual((await core.call('setOptions', { options: aliases })).errors, []);
    assert.equal((await core.call('getConfig', {})).adaptive_infill_mode, 'distance_warp');
    const collision = { adaptive_infill_mode: 'disabled', tpms_adaptive: 'distance_warp',
      imex_nozzle_clearance_x: '42', ixex_carriage_width_x: 'bad' };
    assert.deepEqual((await core.call('setOptions', { options: collision })).errors, []);
    assert.equal((await core.call('getConfig', {})).adaptive_infill_mode, 'disabled');
    assert.equal((await core.call('getConfig', {})).imex_nozzle_clearance_x, '42');
    const before = await core.call('getConfig', {});
    const failed = await core.call('setOptions', { options: { ...aliases, layer_height: 'bad' } });
    assert.ok(failed.errors.some(error => error.key === 'layer_height' && error.fatal));
    assert.deepEqual(await core.call('getConfig', {}), before);
    const badNormalization = await core.call('normalizeOptions', { options: { ...aliases, layer_height: 'bad' } });
    assert.deepEqual(badNormalization.options, {});
    assert.ok(badNormalization.errors.some(error => error.fatal));
  });

  test('legacy arc booleans normalize for bulk edits and serialized reset projection', async () => {
    for (const [old, canonical] of [['0', 'disabled'], ['false', 'disabled'], ['1', 'enabled'], ['TRUE', 'enabled']]) {
      assert.deepEqual((await core.call('setOptions', { options: { enable_arc_fitting: old } })).errors, []);
      assert.equal((await core.call('getConfig', {})).enable_arc_fitting, canonical);
      assert.equal((await core.call('getOption', { key: 'enable_arc_fitting', serializedValue: old })).value, canonical);
    }
    // Explicit selectors survive normalization without adopting Default.
    const normalized = await core.call('normalizeOptions', { options: { inner_wall_filament: '2' } });
    assert.equal(normalized.options.inner_wall_filament_id, '2');
  });

  test('single invalid known option returns fatal error and rolls back without zeroing native config', async () => {
    const baseline = await core.call('getConfig', {});
    assert.strictEqual(baseline.layer_height, '0.2');

    // Setting invalid float for layer_height
    const res = await core.call('setOptions', {
      options: {
        layer_height: 'not_a_valid_float'
      }
    });

    assert.ok(res && Array.isArray(res.errors), 'setOptions must return errors array');
    const err = res.errors.find(e => e.key === 'layer_height');
    assert.ok(err, 'error must include layer_height');
    assert.strictEqual(err.fatal, true, 'error must be marked fatal');
    assert.strictEqual(err.code, 'invalid_value', 'error code must be invalid_value');

    // Prove native config was NOT zeroed or corrupted
    const current = await core.call('getConfig', {});
    assert.strictEqual(current.layer_height, '0.2', 'layer_height must roll back to 0.2 and not be 0 or corrupted');
  });

  test('numeric suffixes and non-finite values cannot commit a batch', async () => {
    const baseline = await core.call('getConfig', {});
    for (const value of ['0.28junk', 'nan', 'inf', '1e999']) {
      const result = await core.call('setOptions', { options: { layer_height: value, wall_loops: '4' } });
      assert.ok(result.errors.some(error => error.key === 'layer_height' && error.fatal), value);
      const config = await core.call('getConfig', {});
      assert.equal(config.layer_height, '0.2', value);
      assert.equal(config.wall_loops, baseline.wall_loops, value);
    }
  });

  test('filament composition rejects malformed values and ignores future keys', async () => {
    const baseline = await core.call('getConfig', {});
    for (const value of ['bad_int', '230junk']) {
      await assert.rejects(core.call('mergeFilamentPresets', {
        slots: [{ preset: 'Generic PLA @System', values: { nozzle_temperature: value } }]
      }), /nozzle_temperature/);
      assert.deepEqual(await core.call('getConfig', {}), baseline);
    }
    const merged = await core.call('mergeFilamentPresets', {
      slots: [{ preset: 'Generic PLA @System', values: { nozzle_temperature: '230', unknown_future_setting: 'true' } }]
    });
    assert.equal(merged.nozzle_temperature, '230');
    assert.equal(merged.unknown_future_setting, undefined);
  });

  test('mixed valid + invalid known option rolls back entire batch atomically', async () => {
    const baseline = await core.call('getConfig', {});
    assert.strictEqual(baseline.layer_height, '0.2');
    assert.strictEqual(baseline.initial_layer_print_height, '0.2');

    // Batch contains valid layer_height and invalid initial_layer_print_height
    const res = await core.call('setOptions', {
      options: {
        layer_height: '0.28',
        initial_layer_print_height: 'not_a_valid_float'
      }
    });

    assert.ok(res && Array.isArray(res.errors), 'setOptions must return errors array');
    const err = res.errors.find(e => e.key === 'initial_layer_print_height');
    assert.ok(err, 'error must include initial_layer_print_height');
    assert.strictEqual(err.fatal, true);
    assert.strictEqual(err.code, 'invalid_value');

    // Entire batch rolled back: layer_height was NOT committed to 0.28
    const current = await core.call('getConfig', {});
    assert.strictEqual(current.layer_height, '0.2', 'valid key in malformed batch must NOT commit');
    assert.strictEqual(current.initial_layer_print_height, '0.2', 'invalid key must NOT corrupt native state');
  });

  test('existing valid override preserved when subsequent batch has fatal error', async () => {
    // Stage 1: apply a valid override
    const step1 = await core.call('setOptions', {
      options: {
        layer_height: '0.28'
      }
    });
    assert.deepStrictEqual(step1.errors, []);
    const cfg1 = await core.call('getConfig', {});
    assert.strictEqual(cfg1.layer_height, '0.28');

    // Stage 2: submit batch with invalid option
    const step2 = await core.call('setOptions', {
      options: {
        initial_layer_print_height: 'bad_number'
      }
    });
    assert.ok(step2.errors.some(e => e.key === 'initial_layer_print_height' && e.fatal === true));

    // Pre-existing layer_height override must remain intact
    const cfg2 = await core.call('getConfig', {});
    assert.strictEqual(cfg2.layer_height, '0.28', 'existing override must be preserved on malformed batch');
    assert.strictEqual(cfg2.initial_layer_print_height, '0.2', 'failed key must not alter config');
  });

  test('mixed valid + unknown keys applies valid option and reports non-fatal unknown key', async () => {
    const res = await core.call('setOptions', {
      options: {
        layer_height: '0.3',
        unknown_future_setting: 'some_value'
      }
    });

    assert.ok(res && Array.isArray(res.errors));
    assert.strictEqual(res.errors.length, 1);
    const unkErr = res.errors[0];
    assert.strictEqual(unkErr.key, 'unknown_future_setting');
    assert.strictEqual(unkErr.fatal, false, 'unknown key error must be non-fatal');
    assert.strictEqual(unkErr.code, 'unknown_key', 'unknown key code must be unknown_key');

    // Valid key is committed
    const current = await core.call('getConfig', {});
    assert.strictEqual(current.layer_height, '0.3', 'valid key must apply when only unknown keys error');
    assert.strictEqual(current.unknown_future_setting, undefined, 'unknown key is not present in native config');
  });

  test('unsupported value type on known key is categorized fatal and rolls back', async () => {
    const res = await core.call('setOptions', {
      options: {
        layer_height: { complex: 'object' }
      }
    });

    assert.ok(res && Array.isArray(res.errors));
    const err = res.errors.find(e => e.key === 'layer_height');
    assert.ok(err);
    assert.strictEqual(err.fatal, true);
    assert.strictEqual(err.code, 'unsupported_type');

    const current = await core.call('getConfig', {});
    assert.strictEqual(current.layer_height, '0.2', 'layer_height unchanged');
  });
});
