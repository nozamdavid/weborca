import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveSlotValue, extractScalarCell, getOptionStride } from '../../app/src/settings/slotValue.ts';
import { createEngineCore } from '../../web/engine-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const modulePath = process.env.ORCA_ENGINE_MODULE
  ? path.resolve(process.env.ORCA_ENGINE_MODULE)
  : path.join(
      repoRoot,
      'wasm',
      'build',
      'ui-settings-dist',
      'engine',
      'orca_engine.mjs'
    );

const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');

describe('Filament Temperature Slot & Vector Resolution', () => {
  test('single scalar rawVal resolves for any slot', () => {
    assert.equal(resolveSlotValue({ rawVal: '220', filamentSlot: 0 }), '220');
    assert.equal(resolveSlotValue({ rawVal: '220', filamentSlot: 1, totalSlots: 2 }), '220');
    assert.equal(resolveSlotValue({ rawVal: ' 215 ', filamentSlot: 0 }), '215');
  });

  test('multi-slot vector rawVal extracts correct slot value', () => {
    const rawVal = '220, 255, 230';
    assert.equal(resolveSlotValue({ rawVal, filamentSlot: 0, totalSlots: 3 }), '220');
    assert.equal(resolveSlotValue({ rawVal, filamentSlot: 1, totalSlots: 3 }), '255');
    assert.equal(resolveSlotValue({ rawVal, filamentSlot: 2, totalSlots: 3 }), '230');
  });

  test('missing or empty rawVal falls back to default value', () => {
    assert.equal(resolveSlotValue({ rawVal: '', filamentSlot: 0, defaultValue: '200' }), '200');
    assert.equal(resolveSlotValue({ rawVal: undefined, filamentSlot: 0, defaultValue: '35' }), '35');
    assert.equal(resolveSlotValue({ rawVal: '   ', filamentSlot: 1, defaultValue: '45' }), '45');
    assert.equal(resolveSlotValue({ rawVal: 'nil', filamentSlot: 0, defaultValue: '0' }), '0');
  });

  test('multi-extruder printer vector (stride > 1) extracts scalar number for slot', () => {
    // 5 extruders on 1 slot (e.g. Prusa XL 5T)
    const rawVal5 = '220,220,220,220,220';
    assert.equal(resolveSlotValue({ rawVal: rawVal5, filamentSlot: 0, totalSlots: 1, extrudersCount: 5 }), '220');

    // 5 extruders across 2 slots (10 values)
    const rawVal10 = '220,220,220,220,220, 245,245,245,245,245';
    assert.equal(resolveSlotValue({ rawVal: rawVal10, filamentSlot: 0, totalSlots: 2, extrudersCount: 5 }), '220');
    assert.equal(resolveSlotValue({ rawVal: rawVal10, filamentSlot: 1, totalSlots: 2, extrudersCount: 5 }), '245');

    // With specific layoutIndex
    assert.equal(resolveSlotValue({ rawVal: rawVal10, filamentSlot: 1, layoutIndex: 3, totalSlots: 2, extrudersCount: 5 }), '245');
  });

  test('extractScalarCell removes commas so <input type="number"> does not render blank', () => {
    assert.equal(extractScalarCell('220,220,220,220,220'), '220');
    assert.equal(extractScalarCell(' 245 , 250 '), '245');
    assert.equal(extractScalarCell('220'), '220');
    assert.equal(extractScalarCell(null), null);
    assert.equal(extractScalarCell(undefined), null);
    assert.equal(extractScalarCell(''), '');
    assert.equal(extractScalarCell('220,245,260', 1), '245');
  });

  test('getOptionStride calculates correct cell stride per slot', () => {
    assert.equal(getOptionStride('220', 1, 1), 1);
    assert.equal(getOptionStride('220,245', 2, 1), 1);
    assert.equal(getOptionStride('220,220,220,220,220', 1, 5), 5);
    assert.equal(getOptionStride('220,220,220,220,220,245,245,245,245,245', 2, 5), 5);
  });
});

describe('Filament Temperature Settings Engine Integration', () => {
  let core;

  test('prefill and edit temperature options across filament slots preserving sibling slots', async () => {
    const mod = await import(modulePath);
    core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 4 });

    for (const b of ['resources.json', 'profiles/OrcaFilamentLibrary.json', 'profiles/Voron.json']) {
      const p = path.join(bundleDir, b);
      if (fs.existsSync(p)) await core.addVendorBundle(JSON.parse(fs.readFileSync(p, 'utf8')));
    }

    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});

    // Select 2 filaments: Generic PLA in slot 0, Generic PETG in slot 1
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System', 'Generic PETG @System']
    });

    const cfg = await core.call('getConfig', {});
    // Verify vector formatting
    assert.ok(cfg.nozzle_temperature.includes(','), 'nozzle_temperature must be a vector for 2 slots');
    assert.ok(cfg.textured_plate_temp.includes(','), 'textured_plate_temp must be a vector for 2 slots');

    // Slot 0 resolution
    const slot0Noz = resolveSlotValue({ rawVal: cfg.nozzle_temperature, filamentSlot: 0, totalSlots: 2 });
    const slot0Bed = resolveSlotValue({ rawVal: cfg.textured_plate_temp, filamentSlot: 0, totalSlots: 2 });
    assert.equal(slot0Noz, '220', 'Slot 0 PLA nozzle temp should resolve to 220');
    assert.equal(slot0Bed, '55', 'Slot 0 PLA textured bed temp should resolve to 55');

    // Slot 1 resolution
    const slot1Noz = resolveSlotValue({ rawVal: cfg.nozzle_temperature, filamentSlot: 1, totalSlots: 2 });
    const slot1Bed = resolveSlotValue({ rawVal: cfg.textured_plate_temp, filamentSlot: 1, totalSlots: 2 });
    assert.equal(slot1Noz, '255', 'Slot 1 PETG nozzle temp should resolve to 255');
    assert.equal(slot1Bed, '80', 'Slot 1 PETG textured bed temp should resolve to 80');

    // Verify all temperature inputs resolve non-empty values
    const tempKeys = [
      'nozzle_temperature',
      'nozzle_temperature_initial_layer',
      'nozzle_temperature_range_low',
      'nozzle_temperature_range_high',
      'cool_plate_temp',
      'cool_plate_temp_initial_layer',
      'hot_plate_temp',
      'hot_plate_temp_initial_layer',
      'textured_plate_temp',
      'textured_plate_temp_initial_layer',
      'chamber_temperature',
      'idle_temperature',
      'temperature_vitrification'
    ];

    for (const key of tempKeys) {
      const val0 = resolveSlotValue({ rawVal: cfg[key], filamentSlot: 0, totalSlots: 2, defaultValue: '0' });
      const val1 = resolveSlotValue({ rawVal: cfg[key], filamentSlot: 1, totalSlots: 2, defaultValue: '0' });
      assert.ok(val0 !== '', `${key} slot 0 must not be empty`);
      assert.ok(!val0.includes(','), `${key} slot 0 must not contain commas`);
      assert.ok(val1 !== '', `${key} slot 1 must not be empty`);
      assert.ok(!val1.includes(','), `${key} slot 1 must not contain commas`);
    }

    // Edit slot 1 nozzle temperature to 260: must preserve slot 0
    await core.call('setOption', { key: 'nozzle_temperature', value: '260', filamentIndex: 1 });
    const updatedCfg = await core.call('getConfig', {});
    assert.equal(
      resolveSlotValue({ rawVal: updatedCfg.nozzle_temperature, filamentSlot: 0, totalSlots: 2 }),
      '220',
      'Slot 0 temperature must remain 220 when slot 1 is edited'
    );
    assert.equal(
      resolveSlotValue({ rawVal: updatedCfg.nozzle_temperature, filamentSlot: 1, totalSlots: 2 }),
      '260',
      'Slot 1 temperature must update to 260'
    );

    core.dispose();
  });
});
